#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=scripts/lib/backup-common.sh
source "${SCRIPT_DIR}/lib/backup-common.sh"
# shellcheck source=scripts/lib/backup-rclone.sh
source "${SCRIPT_DIR}/lib/backup-rclone.sh"

backup_require_command git
backup_require_command node
backup_require_command rclone
backup_require_env "LEJAPON_STORAGE_OUTPUT_DIR"

[[ "${LEJAPON_BACKUP_ACK:-}" == "READ_ONLY_BACKUP_${LEJAPON_BACKUP_PROJECT_REF}" ]] || \
  backup_fail "LEJAPON_BACKUP_ACK must confirm the expected production project."

REPOSITORY_ROOT="$(backup_repository_root)"
OUTPUT_ROOT="$LEJAPON_STORAGE_OUTPUT_DIR"
backup_assert_outside_repository "$OUTPUT_ROOT" "$REPOSITORY_ROOT"
OUTPUT_ROOT="$(cd -- "$OUTPUT_ROOT" && pwd -P)"
STORAGE_ROOT="${OUTPUT_ROOT}/storage"
LOG_ROOT="${OUTPUT_ROOT}/logs"
MANIFEST_PATH="${STORAGE_ROOT}/storage-manifest.json"
BUCKET_RESULTS="${STORAGE_ROOT}/.bucket-results.jsonl"
ACTUAL_BUCKETS_FILE="${STORAGE_ROOT}/.actual-buckets.txt"

mkdir -p -- "$STORAGE_ROOT" "$LOG_ROOT"
: > "$BUCKET_RESULTS"

on_error() {
  local exit_code=$?
  trap - ERR
  printf 'status=failed\nfailed_at=%s\n' "$(backup_timestamp)" > "${STORAGE_ROOT}/FAILED.txt" 2>/dev/null || true
  backup_warn "Storage backup failed. Diagnostic files were retained at ${OUTPUT_ROOT}."
  exit "$exit_code"
}
trap on_error ERR

backup_configure_source_rclone

backup_log "Listing live Supabase Storage buckets."
rclone lsf "supabase_source:" \
  --dirs-only \
  --max-depth 1 \
  --log-file "${LOG_ROOT}/storage-list.log" \
  --log-level NOTICE \
  | sed 's:/$::' \
  | sed '/^[[:space:]]*$/d' \
  | LC_ALL=C sort -u > "$ACTUAL_BUCKETS_FILE"

[[ -s "$ACTUAL_BUCKETS_FILE" ]] || backup_fail "No Storage buckets were returned by the source."

is_expected_bucket() {
  local candidate="$1"
  local expected
  for expected in "${LEJAPON_EXPECTED_STORAGE_BUCKETS[@]}"; do
    [[ "$candidate" == "$expected" ]] && return 0
  done
  return 1
}

is_actual_bucket() {
  grep -Fqx -- "$1" "$ACTUAL_BUCKETS_FILE"
}

while IFS= read -r bucket; do
  backup_validate_identifier "$bucket" "Storage bucket name"
done < "$ACTUAL_BUCKETS_FILE"

new_buckets=()
missing_buckets=()
while IFS= read -r bucket; do
  if ! is_expected_bucket "$bucket"; then
    new_buckets+=("$bucket")
    backup_warn "New production bucket detected and included in this backup: ${bucket}"
  fi
done < "$ACTUAL_BUCKETS_FILE"
for bucket in "${LEJAPON_EXPECTED_STORAGE_BUCKETS[@]}"; do
  if ! is_actual_bucket "$bucket"; then
    missing_buckets+=("$bucket")
    backup_warn "Expected production bucket is missing: ${bucket}"
  fi
done

overall_failure=0
while IFS= read -r bucket; do
  bucket_output="${STORAGE_ROOT}/${bucket}"
  mkdir -p -- "$bucket_output"
  backup_log "Copying Storage bucket: ${bucket}"
  bucket_expected=0
  if is_expected_bucket "$bucket"; then
    bucket_expected=1
  fi

  if rclone copy "supabase_source:${bucket}" "$bucket_output" \
      --fast-list \
      --checkers "${RCLONE_CHECKERS:-8}" \
      --transfers "${RCLONE_TRANSFERS:-4}" \
      --retries "${RCLONE_RETRIES:-5}" \
      --low-level-retries "${RCLONE_LOW_LEVEL_RETRIES:-10}" \
      --stats 60s \
      --stats-one-line \
      --log-file "${LOG_ROOT}/storage-${bucket}.log" \
      --log-level NOTICE \
    && rclone check "supabase_source:${bucket}" "$bucket_output" \
      --checkers "${RCLONE_CHECKERS:-8}" \
      --one-way \
      --log-file "${LOG_ROOT}/storage-${bucket}-check.log" \
      --log-level NOTICE; then
    size_json="$(rclone size "$bucket_output" --json)"
    BUCKET_NAME="$bucket" \
    BUCKET_EXPECTED="$bucket_expected" \
    BUCKET_SIZE_JSON="$size_json" \
    node <<'NODE' >> "$BUCKET_RESULTS"
const size = JSON.parse(process.env.BUCKET_SIZE_JSON);
process.stdout.write(`${JSON.stringify({
  name: process.env.BUCKET_NAME,
  expected: process.env.BUCKET_EXPECTED === "1",
  status: "complete",
  object_count: Number(size.count ?? 0),
  bytes: Number(size.bytes ?? 0),
  verification: "rclone check --one-way",
})}\n`);
NODE
  else
    overall_failure=1
    BUCKET_NAME="$bucket" \
    BUCKET_EXPECTED="$bucket_expected" \
    node <<'NODE' >> "$BUCKET_RESULTS"
process.stdout.write(`${JSON.stringify({
  name: process.env.BUCKET_NAME,
  expected: process.env.BUCKET_EXPECTED === "1",
  status: "failed",
  object_count: null,
  bytes: null,
  verification: "failed",
})}\n`);
NODE
  fi
done < "$ACTUAL_BUCKETS_FILE"

EXPECTED_BUCKETS_JSON="$(printf '%s\n' "${LEJAPON_EXPECTED_STORAGE_BUCKETS[@]}" | node -e 'const fs=require("fs"); console.log(JSON.stringify(fs.readFileSync(0,"utf8").trim().split("\n").filter(Boolean)))')"
NEW_BUCKETS_JSON="$(printf '%s\n' "${new_buckets[@]:-}" | node -e 'const fs=require("fs"); console.log(JSON.stringify(fs.readFileSync(0,"utf8").trim().split("\n").filter(Boolean)))')"
MISSING_BUCKETS_JSON="$(printf '%s\n' "${missing_buckets[@]:-}" | node -e 'const fs=require("fs"); console.log(JSON.stringify(fs.readFileSync(0,"utf8").trim().split("\n").filter(Boolean)))')"

STORAGE_RESULTS_FILE="$BUCKET_RESULTS" \
STORAGE_EXPECTED_JSON="$EXPECTED_BUCKETS_JSON" \
STORAGE_NEW_JSON="$NEW_BUCKETS_JSON" \
STORAGE_MISSING_JSON="$MISSING_BUCKETS_JSON" \
STORAGE_GENERATED_AT="$(backup_timestamp)" \
STORAGE_PROJECT_REF="$LEJAPON_BACKUP_PROJECT_REF" \
STORAGE_OVERALL_FAILURE="$overall_failure" \
node <<'NODE' > "$MANIFEST_PATH"
const fs = require("fs");
const lines = fs.readFileSync(process.env.STORAGE_RESULTS_FILE, "utf8").trim().split("\n").filter(Boolean);
const buckets = lines.map((line) => JSON.parse(line));
const missing = JSON.parse(process.env.STORAGE_MISSING_JSON);
const failed = buckets.filter((bucket) => bucket.status !== "complete");
const manifest = {
  schema_version: 1,
  component: "supabase-storage",
  status: failed.length === 0 && missing.length === 0 && process.env.STORAGE_OVERALL_FAILURE === "0" ? "complete" : "failed",
  generated_at: process.env.STORAGE_GENERATED_AT,
  project_ref: process.env.STORAGE_PROJECT_REF,
  expected_buckets: JSON.parse(process.env.STORAGE_EXPECTED_JSON),
  actual_buckets: buckets.map((bucket) => bucket.name),
  new_buckets: JSON.parse(process.env.STORAGE_NEW_JSON),
  missing_buckets: missing,
  bucket_count: buckets.length,
  total_objects: buckets.reduce((sum, bucket) => sum + (bucket.object_count ?? 0), 0),
  total_bytes: buckets.reduce((sum, bucket) => sum + (bucket.bytes ?? 0), 0),
  layout: "storage/<bucket>/<original-path>",
  transfer_method: "rclone copy",
  buckets,
};
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
NODE

rm -f -- "$BUCKET_RESULTS" "$ACTUAL_BUCKETS_FILE"
chmod 600 "$MANIFEST_PATH"

if (( ${#missing_buckets[@]} > 0 )); then
  overall_failure=1
fi
if (( overall_failure != 0 )); then
  backup_fail "One or more Storage buckets could not be backed up or an expected bucket is missing."
fi

trap - ERR
backup_log "Storage backup completed: ${MANIFEST_PATH}"
