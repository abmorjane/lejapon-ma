#!/usr/bin/env bash

# Shared constants and helpers for the LeJapon.ma backup scripts.
# This file is sourced by executable scripts and must not contain secrets.

readonly LEJAPON_BACKUP_PROJECT_NAME="lejapon-prod"
readonly LEJAPON_BACKUP_PROJECT_REF="nkovgpzspprmmhorwaxl"
readonly LEJAPON_BACKUP_DEFAULT_SUPABASE_CLI_VERSION="2.117.0"

readonly -a LEJAPON_EXPECTED_STORAGE_BUCKETS=(
  "agency-fit-requests"
  "article-images"
  "booking-docs"
  "database_export_19_09_26"
  "hotel-images"
  "international-payments"
  "media"
  "partner-onboarding"
  "passports"
  "programme-images"
  "programme-pdfs"
  "trip-documents"
  "trip-message-attachments"
  "visa-docs"
)

backup_timestamp() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

backup_id_timestamp() {
  date -u +%Y%m%dT%H%M%SZ
}

backup_log() {
  printf '[%s] %s\n' "$(backup_timestamp)" "$*"
}

backup_warn() {
  printf '[%s] WARNING: %s\n' "$(backup_timestamp)" "$*" >&2
}

backup_fail() {
  printf '[%s] ERROR: %s\n' "$(backup_timestamp)" "$*" >&2
  exit 1
}

backup_require_command() {
  command -v "$1" >/dev/null 2>&1 || backup_fail "Required command not found: $1"
}

backup_require_env() {
  local variable_name="$1"
  [[ -n "${!variable_name:-}" ]] || backup_fail "Required environment variable is missing: ${variable_name}"
}

backup_repository_root() {
  git rev-parse --show-toplevel 2>/dev/null || backup_fail "The backup scripts must run from a Git checkout."
}

backup_assert_outside_repository() {
  local target="$1"
  local repository_root="$2"
  local parent

  mkdir -p -- "$target"
  target="$(cd -- "$target" && pwd -P)"
  parent="$(cd -- "$repository_root" && pwd -P)"

  case "$target" in
    "$parent"|"$parent"/*)
      backup_fail "Backup output must be outside the Git repository."
      ;;
  esac
}

backup_validate_identifier() {
  local value="$1"
  local label="$2"
  [[ "$value" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || backup_fail "Invalid ${label}."
}

backup_validate_retention_class() {
  case "$1" in
    daily|weekly|monthly) ;;
    *) backup_fail "BACKUP_RETENTION_CLASS must be daily, weekly, or monthly." ;;
  esac
}

backup_write_sha256sums() {
  local directory="$1"

  BACKUP_HASH_ROOT="$directory" node <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = process.env.BACKUP_HASH_ROOT;
const output = path.join(root, "SHA256SUMS");
const files = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (absolute === output) continue;
    if (entry.isDirectory()) walk(absolute);
    if (entry.isFile()) files.push(absolute);
  }
}

walk(root);
files.sort((a, b) => a.localeCompare(b));

async function digest(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

(async () => {
  const lines = [];
  for (const file of files) {
    lines.push(`${await digest(file)}  ${path.relative(root, file).split(path.sep).join("/")}`);
  }
  fs.writeFileSync(output, `${lines.join("\n")}\n`, { mode: 0o600 });
})().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
NODE
}

backup_file_size_bytes() {
  local directory="$1"
  BACKUP_SIZE_ROOT="$directory" node <<'NODE'
const fs = require("fs");
const path = require("path");
let total = 0;
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    if (entry.isFile()) total += fs.statSync(absolute).size;
  }
}
walk(process.env.BACKUP_SIZE_ROOT);
process.stdout.write(String(total));
NODE
}
