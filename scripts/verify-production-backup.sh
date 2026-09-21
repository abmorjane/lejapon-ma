#!/usr/bin/env bash

set -Eeuo pipefail
set +x
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=scripts/lib/backup-common.sh
source "${SCRIPT_DIR}/lib/backup-common.sh"
# shellcheck source=scripts/lib/backup-rclone.sh
source "${SCRIPT_DIR}/lib/backup-rclone.sh"

backup_require_command node

VERIFY_TEMP_ROOT=""
cleanup_verify_temp() {
  if [[ -n "$VERIFY_TEMP_ROOT" && -d "$VERIFY_TEMP_ROOT" ]]; then
    rm -rf -- "$VERIFY_TEMP_ROOT"
  fi
}
trap cleanup_verify_temp EXIT

LOCAL_DIR=""
REMOTE_PATH=""
while (( $# > 0 )); do
  case "$1" in
    --local-dir)
      [[ $# -ge 2 ]] || backup_fail "--local-dir requires a value."
      LOCAL_DIR="$2"
      shift 2
      ;;
    --remote-path)
      [[ $# -ge 2 ]] || backup_fail "--remote-path requires a value."
      REMOTE_PATH="$2"
      shift 2
      ;;
    *) backup_fail "Unknown argument: $1" ;;
  esac
done

[[ -n "$LOCAL_DIR" || -n "$REMOTE_PATH" ]] || backup_fail "Provide --local-dir, --remote-path, or both."
EXPECTED_BUCKETS_JSON="$(printf '%s\n' "${LEJAPON_EXPECTED_STORAGE_BUCKETS[@]}" | node -e 'const fs=require("fs"); console.log(JSON.stringify(fs.readFileSync(0,"utf8").trim().split("\n").filter(Boolean)))')"

verify_local_directory() {
  local root="$1"
  [[ -d "$root" ]] || backup_fail "Local backup directory does not exist."

  VERIFY_ROOT="$(cd -- "$root" && pwd -P)" \
  VERIFY_EXPECTED_BUCKETS="$EXPECTED_BUCKETS_JSON" \
  VERIFY_PROJECT_REF="$LEJAPON_BACKUP_PROJECT_REF" \
  VERIFY_PROJECT_NAME="$LEJAPON_BACKUP_PROJECT_NAME" \
  node <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = process.env.VERIFY_ROOT;
const expectedBuckets = JSON.parse(process.env.VERIFY_EXPECTED_BUCKETS);
const required = [
  "manifest.json",
  "SHA256SUMS",
  "database/postgres/manifest.json",
  "database/postgres/SHA256SUMS",
  "database/postgres/roles.sql",
  "database/postgres/schema.sql",
  "database/postgres/data.sql",
  "database/postgres/migration-history-schema.sql",
  "database/postgres/migration-history-data.sql",
  "storage/storage-manifest.json",
];

function fail(message) {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
}

for (const relative of required) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) fail(`Required backup artifact is missing: ${relative}`);
  if (fs.statSync(absolute).size === 0) fail(`Critical backup artifact is empty: ${relative}`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const storage = JSON.parse(fs.readFileSync(path.join(root, "storage/storage-manifest.json"), "utf8"));
if (manifest.status !== "complete") fail("General manifest is not complete.");
if (manifest.project?.name !== process.env.VERIFY_PROJECT_NAME) fail("Unexpected project name in manifest.");
if (manifest.project?.ref !== process.env.VERIFY_PROJECT_REF) fail("Unexpected project ref in manifest.");
if (manifest.postgresql?.status !== "complete") fail("PostgreSQL component is incomplete.");
if (manifest.storage?.status !== "complete" || storage.status !== "complete") fail("Storage component is incomplete.");

const manifestBuckets = new Set(manifest.storage?.buckets ?? []);
const storageBuckets = new Set(storage.actual_buckets ?? []);
for (const bucket of expectedBuckets) {
  if (!manifestBuckets.has(bucket) || !storageBuckets.has(bucket)) fail(`Expected bucket is absent from manifests: ${bucket}`);
  if (!fs.existsSync(path.join(root, "storage", bucket))) fail(`Expected bucket directory is absent: ${bucket}`);
}
if ((storage.missing_buckets ?? []).length > 0) fail("Storage manifest reports missing buckets.");
if ((storage.buckets ?? []).some((bucket) => bucket.status !== "complete")) fail("Storage manifest reports a failed bucket.");
if (Number(storage.bucket_count) !== (storage.actual_buckets ?? []).length) fail("Storage bucket count is inconsistent.");

const checksumFile = fs.readFileSync(path.join(root, "SHA256SUMS"), "utf8").trim().split("\n").filter(Boolean);
if (checksumFile.length < required.length - 1) fail("Checksum list is unexpectedly short.");
async function digest(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

(async () => {
  for (const line of checksumFile) {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    if (!match) fail("Malformed SHA256SUMS entry.");
    const relative = match[2];
    if (relative.includes("..") || path.isAbsolute(relative)) fail("Unsafe path in SHA256SUMS.");
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) fail(`Checksummed artifact is missing: ${relative}`);
    const actual = await digest(absolute);
    if (actual !== match[1]) fail(`Checksum mismatch: ${relative}`);
  }
  process.stdout.write(`Local backup verification passed: ${manifest.backup_id}\n`);
})().catch((error) => fail(error.message));
NODE
}

verify_remote_path() {
  local remote_path="$1"
  backup_require_command rclone
  [[ "$remote_path" =~ ^lejapon-prod/(daily|weekly|monthly)/[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || \
    backup_fail "Remote backup path is invalid."

  if [[ -z "${RCLONE_CONFIG_BACKUP_CRYPT_TYPE:-}" ]]; then
    backup_configure_destination_rclone
  fi

  local temp_root
  temp_root="$(mktemp -d "${TMPDIR:-/tmp}/lejapon-verify.XXXXXX")"
  VERIFY_TEMP_ROOT="$temp_root"

  rclone lsf "backup_crypt:${remote_path}" \
    --recursive \
    --files-only \
    --format "sp" \
    --separator "|" > "${temp_root}/remote-files.txt"

  rclone copy "backup_crypt:${remote_path}" "$temp_root" \
    --include "manifest.json" \
    --include "SHA256SUMS" \
    --include "storage/storage-manifest.json" \
    --include "database/postgres/manifest.json" \
    --include "database/postgres/SHA256SUMS" \
    --exclude "*"

  REMOTE_VERIFY_ROOT="$temp_root" \
  REMOTE_VERIFY_EXPECTED_BUCKETS="$EXPECTED_BUCKETS_JSON" \
  REMOTE_VERIFY_PROJECT_REF="$LEJAPON_BACKUP_PROJECT_REF" \
  node <<'NODE'
const fs = require("fs");
const path = require("path");
const root = process.env.REMOTE_VERIFY_ROOT;
const expectedBuckets = JSON.parse(process.env.REMOTE_VERIFY_EXPECTED_BUCKETS);

function fail(message) {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
}

for (const relative of ["manifest.json", "SHA256SUMS", "storage/storage-manifest.json", "database/postgres/manifest.json", "database/postgres/SHA256SUMS"]) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute) || fs.statSync(absolute).size === 0) fail(`Remote critical artifact is unreadable: ${relative}`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const storage = JSON.parse(fs.readFileSync(path.join(root, "storage/storage-manifest.json"), "utf8"));
if (manifest.status !== "complete" || manifest.project?.ref !== process.env.REMOTE_VERIFY_PROJECT_REF) fail("Remote manifest is invalid.");
for (const bucket of expectedBuckets) {
  if (!(storage.actual_buckets ?? []).includes(bucket)) fail(`Remote manifest is missing bucket: ${bucket}`);
}

const entries = new Map();
for (const line of fs.readFileSync(path.join(root, "remote-files.txt"), "utf8").trim().split("\n").filter(Boolean)) {
  const separator = line.indexOf("|");
  if (separator < 1) fail("Malformed rclone remote listing.");
  entries.set(line.slice(separator + 1), Number(line.slice(0, separator)));
}
for (const critical of ["manifest.json", "SHA256SUMS", "database/postgres/schema.sql", "database/postgres/data.sql", "storage/storage-manifest.json"]) {
  if (!entries.has(critical) || entries.get(critical) <= 0) fail(`Remote critical artifact is missing or empty: ${critical}`);
}
if (entries.size < 10) fail("Remote backup contains too few artifacts.");
process.stdout.write(`Encrypted remote backup is readable: ${manifest.backup_id}\n`);
NODE

  rm -rf -- "$temp_root"
  VERIFY_TEMP_ROOT=""
}

if [[ -n "$LOCAL_DIR" ]]; then
  verify_local_directory "$LOCAL_DIR"
fi
if [[ -n "$REMOTE_PATH" ]]; then
  verify_remote_path "$REMOTE_PATH"
fi

backup_log "Backup verification completed successfully."
