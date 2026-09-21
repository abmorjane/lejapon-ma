#!/usr/bin/env bash

set -Eeuo pipefail
set +x
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=scripts/lib/backup-common.sh
source "${SCRIPT_DIR}/lib/backup-common.sh"
# shellcheck source=scripts/lib/backup-rclone.sh
source "${SCRIPT_DIR}/lib/backup-rclone.sh"

backup_require_command git
backup_require_command node
backup_require_command npx
backup_require_command rclone

for required_variable in \
  SUPABASE_DB_URL \
  SUPABASE_BACKUP_S3_ENDPOINT \
  SUPABASE_BACKUP_S3_ACCESS_KEY_ID \
  SUPABASE_BACKUP_S3_SECRET_ACCESS_KEY \
  BACKUP_S3_ENDPOINT \
  BACKUP_S3_REGION \
  BACKUP_S3_BUCKET \
  BACKUP_S3_ACCESS_KEY_ID \
  BACKUP_S3_SECRET_ACCESS_KEY \
  BACKUP_CRYPT_PASSWORD \
  BACKUP_CRYPT_SALT; do
  backup_require_env "$required_variable"
done

case "$SUPABASE_DB_URL" in
  *"${LEJAPON_BACKUP_PROJECT_REF}"*) ;;
  *) backup_fail "SUPABASE_DB_URL does not reference the expected production project." ;;
esac

RETENTION_CLASS="${BACKUP_RETENTION_CLASS:-daily}"
backup_validate_retention_class "$RETENTION_CLASS"

REPOSITORY_ROOT="$(backup_repository_root)"
WORK_ROOT="${LEJAPON_BACKUP_WORK_ROOT:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/lejapon-backups}"
backup_assert_outside_repository "$WORK_ROOT" "$REPOSITORY_ROOT"
WORK_ROOT="$(cd -- "$WORK_ROOT" && pwd -P)"

BACKUP_ID="${LEJAPON_BACKUP_ID:-${LEJAPON_BACKUP_PROJECT_NAME}-$(backup_id_timestamp)}"
backup_validate_identifier "$BACKUP_ID" "backup ID"
WORK_DIR="${WORK_ROOT}/.${BACKUP_ID}.partial"
BUNDLE_ROOT="${WORK_DIR}/bundle"
RUNTIME_LOG_ROOT="${WORK_DIR}/runtime-logs"
RESULT_FILE="${LEJAPON_BACKUP_RESULT_FILE:-${WORK_ROOT}/last-backup-result.env}"
REMOTE_PATH="${LEJAPON_BACKUP_PROJECT_NAME}/${RETENTION_CLASS}/${BACKUP_ID}"
STARTED_AT="$(backup_timestamp)"

[[ ! -e "$WORK_DIR" ]] || backup_fail "Backup work directory already exists."
mkdir -p -- "$BUNDLE_ROOT/database" "$BUNDLE_ROOT/logs" "$RUNTIME_LOG_ROOT"

exec > >(tee -a "${RUNTIME_LOG_ROOT}/orchestrator.log") 2>&1

on_error() {
  local exit_code=$?
  trap - ERR
  printf 'status=failed\nbackup_id=%s\nfailed_at=%s\n' \
    "$BACKUP_ID" "$(backup_timestamp)" > "${WORK_DIR}/FAILED.txt" 2>/dev/null || true
  backup_warn "Backup failed. Diagnostics retained at ${WORK_DIR}."
  exit "$exit_code"
}
trap on_error ERR

backup_log "Starting backup ${BACKUP_ID} (${RETENTION_CLASS})."

LEJAPON_PRODUCTION_DB_URL="$SUPABASE_DB_URL" \
LEJAPON_BACKUP_OUTPUT_DIR="${BUNDLE_ROOT}/database" \
LEJAPON_DB_BACKUP_ID="postgres" \
LEJAPON_BACKUP_ACK="READ_ONLY_BACKUP_${LEJAPON_BACKUP_PROJECT_REF}" \
LEJAPON_BACKUP_ENCRYPTED_DESTINATION_ACK="I_CONFIRM_OUTPUT_IS_ENCRYPTED" \
SUPABASE_CLI_VERSION="${SUPABASE_CLI_VERSION:-${LEJAPON_BACKUP_DEFAULT_SUPABASE_CLI_VERSION}}" \
  "${SCRIPT_DIR}/backup-production-db.sh" 2>&1 | tee "${BUNDLE_ROOT}/logs/database.log"

LEJAPON_STORAGE_OUTPUT_DIR="$BUNDLE_ROOT" \
LEJAPON_BACKUP_ACK="READ_ONLY_BACKUP_${LEJAPON_BACKUP_PROJECT_REF}" \
  "${SCRIPT_DIR}/backup-production-storage.sh"

GIT_COMMIT="$(git -C "$REPOSITORY_ROOT" rev-parse HEAD)"
GIT_BRANCH="${GITHUB_REF_NAME:-$(git -C "$REPOSITORY_ROOT" branch --show-current)}"
RCLONE_VERSION="$(rclone version | sed -n '1s/^rclone //p')"
SUPABASE_VERSION="${SUPABASE_CLI_VERSION:-${LEJAPON_BACKUP_DEFAULT_SUPABASE_CLI_VERSION}}"
COMPONENT_BYTES="$(backup_file_size_bytes "$BUNDLE_ROOT")"
COMPLETED_AT="$(backup_timestamp)"

BACKUP_MANIFEST_ROOT="$BUNDLE_ROOT" \
BACKUP_ID="$BACKUP_ID" \
BACKUP_STARTED_AT="$STARTED_AT" \
BACKUP_COMPLETED_AT="$COMPLETED_AT" \
BACKUP_PROJECT_NAME="$LEJAPON_BACKUP_PROJECT_NAME" \
BACKUP_PROJECT_REF="$LEJAPON_BACKUP_PROJECT_REF" \
BACKUP_GIT_COMMIT="$GIT_COMMIT" \
BACKUP_GIT_BRANCH="$GIT_BRANCH" \
BACKUP_RETENTION_CLASS="$RETENTION_CLASS" \
BACKUP_REMOTE_PATH="$REMOTE_PATH" \
BACKUP_SUPABASE_VERSION="$SUPABASE_VERSION" \
BACKUP_RCLONE_VERSION="$RCLONE_VERSION" \
BACKUP_COMPONENT_BYTES="$COMPONENT_BYTES" \
node <<'NODE' > "${BUNDLE_ROOT}/manifest.json"
const fs = require("fs");
const path = require("path");
const root = process.env.BACKUP_MANIFEST_ROOT;
const database = JSON.parse(fs.readFileSync(path.join(root, "database/postgres/manifest.json"), "utf8"));
const storage = JSON.parse(fs.readFileSync(path.join(root, "storage/storage-manifest.json"), "utf8"));

const manifest = {
  schema_version: 1,
  backup_id: process.env.BACKUP_ID,
  status: database.status === "complete" && storage.status === "complete" ? "complete" : "failed",
  started_at: process.env.BACKUP_STARTED_AT,
  completed_at: process.env.BACKUP_COMPLETED_AT,
  project: {
    name: process.env.BACKUP_PROJECT_NAME,
    ref: process.env.BACKUP_PROJECT_REF,
  },
  source: {
    git_commit: process.env.BACKUP_GIT_COMMIT,
    git_branch: process.env.BACKUP_GIT_BRANCH,
  },
  destination: {
    retention_class: process.env.BACKUP_RETENTION_CLASS,
    remote_path: process.env.BACKUP_REMOTE_PATH,
    encrypted: true,
  },
  tools: {
    supabase_cli: process.env.BACKUP_SUPABASE_VERSION,
    rclone: process.env.BACKUP_RCLONE_VERSION,
    node: process.version,
  },
  encryption: {
    method: "rclone crypt",
    filename_encryption: "standard",
    directory_name_encryption: true,
    key_material_in_manifest: false,
  },
  checksum: {
    algorithm: "SHA-256",
    file: "SHA256SUMS",
  },
  postgresql: {
    status: database.status,
    version: null,
    version_note: "Not queried separately; validate server version during the restore drill.",
    artifact_directory: "database/postgres",
    files: database.files,
  },
  storage: {
    status: storage.status,
    expected_bucket_count: storage.expected_buckets.length,
    bucket_count: storage.bucket_count,
    buckets: storage.actual_buckets,
    new_buckets: storage.new_buckets,
    missing_buckets: storage.missing_buckets,
    total_objects: storage.total_objects,
    total_bytes: storage.total_bytes,
    manifest: "storage/storage-manifest.json",
  },
  components: {
    database: "complete",
    storage: storage.status,
    checksums: "complete",
  },
  total_bytes: Number(process.env.BACKUP_COMPONENT_BYTES),
  total_bytes_scope: "component artifacts before root manifest and SHA256SUMS",
  retention: {
    class: process.env.BACKUP_RETENTION_CLASS,
    deletion_enabled: false,
    future_policy: { daily: 14, weekly: 8, monthly: 12 },
  },
};

if (manifest.status !== "complete") throw new Error("A backup component is incomplete.");
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
NODE

backup_write_sha256sums "$BUNDLE_ROOT"
"${SCRIPT_DIR}/verify-production-backup.sh" --local-dir "$BUNDLE_ROOT"

backup_configure_destination_rclone
backup_log "Uploading encrypted backup to retention path ${RETENTION_CLASS}/${BACKUP_ID}."
rclone copy "$BUNDLE_ROOT" "backup_crypt:${REMOTE_PATH}" \
  --immutable \
  --checkers "${RCLONE_CHECKERS:-8}" \
  --transfers "${RCLONE_TRANSFERS:-4}" \
  --retries "${RCLONE_RETRIES:-5}" \
  --low-level-retries "${RCLONE_LOW_LEVEL_RETRIES:-10}" \
  --stats 60s \
  --stats-one-line \
  --log-file "${RUNTIME_LOG_ROOT}/upload.log" \
  --log-level NOTICE

rclone check "$BUNDLE_ROOT" "backup_crypt:${REMOTE_PATH}" \
  --checkers "${RCLONE_CHECKERS:-8}" \
  --log-file "${RUNTIME_LOG_ROOT}/remote-check.log" \
  --log-level NOTICE

"${SCRIPT_DIR}/verify-production-backup.sh" --remote-path "$REMOTE_PATH"

mkdir -p -- "$(dirname -- "$RESULT_FILE")"
printf 'BACKUP_ID=%s\nRETENTION_CLASS=%s\nREMOTE_PATH=%s\nCOMPLETED_AT=%s\n' \
  "$BACKUP_ID" "$RETENTION_CLASS" "$REMOTE_PATH" "$(backup_timestamp)" > "$RESULT_FILE"
chmod 600 "$RESULT_FILE"

trap - ERR
rm -rf -- "$WORK_DIR"
backup_log "Backup ${BACKUP_ID} completed, verified, and cleaned locally."
