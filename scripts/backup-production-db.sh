#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

EXPECTED_PROJECT_REF="nkovgpzspprmmhorwaxl"
DEFAULT_CLI_VERSION="2.117.0"
REQUIRED_ACK="READ_ONLY_BACKUP_${EXPECTED_PROJECT_REF}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

require_command git
require_command node
require_command npx

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"
CLI_VERSION="${SUPABASE_CLI_VERSION:-${DEFAULT_CLI_VERSION}}"
DATABASE_URL="${LEJAPON_PRODUCTION_DB_URL:-}"
OUTPUT_ROOT="${LEJAPON_BACKUP_OUTPUT_DIR:-}"

[[ -n "${DATABASE_URL}" ]] || fail "LEJAPON_PRODUCTION_DB_URL is required."
[[ -n "${OUTPUT_ROOT}" ]] || fail "LEJAPON_BACKUP_OUTPUT_DIR is required."
[[ "${LEJAPON_BACKUP_ACK:-}" == "${REQUIRED_ACK}" ]] || fail "Set LEJAPON_BACKUP_ACK=${REQUIRED_ACK} after reviewing the target."
[[ "${LEJAPON_BACKUP_ENCRYPTED_DESTINATION_ACK:-}" == "I_CONFIRM_OUTPUT_IS_ENCRYPTED" ]] || fail "The output destination must be encrypted."

case "${DATABASE_URL}" in
  *"${EXPECTED_PROJECT_REF}"*) ;;
  *) fail "The database URL does not contain the expected production project reference." ;;
esac

mkdir -p -- "${OUTPUT_ROOT}"
OUTPUT_ROOT="$(cd -- "${OUTPUT_ROOT}" && pwd -P)"

case "${OUTPUT_ROOT}" in
  "${REPOSITORY_ROOT}"|"${REPOSITORY_ROOT}"/*)
    fail "Backup output must be outside the Git repository."
    ;;
esac

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_ID="${LEJAPON_DB_BACKUP_ID:-lejapon-prod-postgres-${TIMESTAMP}}"
[[ "${BACKUP_ID}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || fail "LEJAPON_DB_BACKUP_ID is invalid."
WORK_DIR="${OUTPUT_ROOT}/.${BACKUP_ID}.partial"
FINAL_DIR="${OUTPUT_ROOT}/${BACKUP_ID}"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

[[ ! -e "${WORK_DIR}" && ! -e "${FINAL_DIR}" ]] || fail "Backup destination already exists."
mkdir -p -- "${WORK_DIR}"

on_error() {
  local exit_code=$?
  trap - ERR
  printf 'status=failed\nbackup_id=%s\nfailed_at=%s\n' \
    "${BACKUP_ID}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${WORK_DIR}/FAILED.txt" 2>/dev/null || true
  printf 'Backup failed. Partial output retained at: %s\n' "${WORK_DIR}" >&2
  exit "${exit_code}"
}
trap on_error ERR

run_dump() {
  local label="$1"
  local output_file="$2"
  shift 2

  printf 'Creating %s...\n' "${label}"
  npx --yes "supabase@${CLI_VERSION}" db dump \
    --db-url "${DATABASE_URL}" \
    --file "${WORK_DIR}/${output_file}" \
    "$@"
  [[ -s "${WORK_DIR}/${output_file}" ]] || fail "${output_file} is empty."
}

run_dump "cluster roles" "roles.sql" --role-only
run_dump "database schema" "schema.sql"
run_dump "database data" "data.sql" \
  --data-only \
  --use-copy \
  --exclude "storage.buckets_vectors" \
  --exclude "storage.vector_indexes"
run_dump "migration history schema" "migration-history-schema.sql" \
  --schema "supabase_migrations"
run_dump "migration history data" "migration-history-data.sql" \
  --schema "supabase_migrations" \
  --data-only \
  --use-copy

checksum_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${file}"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${file}"
  else
    fail "Neither sha256sum nor shasum is available."
  fi
}

(
  cd -- "${WORK_DIR}"
  : > SHA256SUMS
  for file in roles.sql schema.sql data.sql migration-history-schema.sql migration-history-data.sql; do
    checksum_file "${file}" >> SHA256SUMS
  done
)

SOURCE_COMMIT="$(git -C "${REPOSITORY_ROOT}" rev-parse HEAD)"
CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

LEJAPON_MANIFEST_DIR="${WORK_DIR}" \
LEJAPON_BACKUP_ID="${BACKUP_ID}" \
LEJAPON_STARTED_AT="${STARTED_AT}" \
LEJAPON_CREATED_AT="${CREATED_AT}" \
LEJAPON_SOURCE_COMMIT="${SOURCE_COMMIT}" \
LEJAPON_CLI_VERSION="${CLI_VERSION}" \
LEJAPON_PROJECT_REF="${EXPECTED_PROJECT_REF}" \
node <<'NODE'
const fs = require("fs");
const path = require("path");

const directory = process.env.LEJAPON_MANIFEST_DIR;
const checksumLines = fs.readFileSync(path.join(directory, "SHA256SUMS"), "utf8")
  .trim()
  .split("\n")
  .filter(Boolean);

const checksums = new Map(checksumLines.map((line) => {
  const [sha256, ...nameParts] = line.trim().split(/\s+/);
  return [nameParts.join(" ").replace(/^\*/, ""), sha256];
}));

const files = [...checksums.entries()].map(([name, sha256]) => ({
  name,
  bytes: fs.statSync(path.join(directory, name)).size,
  sha256,
}));

const manifest = {
  schema_version: 1,
  backup_id: process.env.LEJAPON_BACKUP_ID,
  status: "complete",
  component: "postgresql-auth",
  started_at: process.env.LEJAPON_STARTED_AT,
  created_at: process.env.LEJAPON_CREATED_AT,
  source: {
    environment: "production",
    supabase_project_ref: process.env.LEJAPON_PROJECT_REF,
    git_commit: process.env.LEJAPON_SOURCE_COMMIT,
  },
  tools: {
    supabase_cli: process.env.LEJAPON_CLI_VERSION,
  },
  files,
  includes: [
    "cluster roles",
    "database schema",
    "database data",
    "supabase migration history schema and data",
  ],
  excludes: [
    "Supabase Storage object binaries",
    "Edge Function source and deployed configuration",
    "secret values",
    "o2switch frontend files",
  ],
  notes: [
    "Validate Auth coverage and restore behavior during the isolated A.1.3 drill.",
    "Storage objects require the separate encrypted bucket backup procedure.",
  ],
};

fs.writeFileSync(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
NODE

(
  cd -- "${WORK_DIR}"
  checksum_file "manifest.json" >> SHA256SUMS
  chmod 600 ./*.sql manifest.json SHA256SUMS
)

trap - ERR
mv -- "${WORK_DIR}" "${FINAL_DIR}"
printf 'Backup completed: %s\n' "${FINAL_DIR}"
printf 'No upload or Git operation was performed.\n'
