#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd -P)"
# shellcheck source=scripts/lib/backup-common.sh
source "${REPOSITORY_ROOT}/scripts/lib/backup-common.sh"

fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/lejapon-backup-fixture.XXXXXX")"
trap 'rm -rf -- "$fixture_root"' EXIT

mkdir -p -- "$fixture_root/database/postgres" "$fixture_root/storage" "$fixture_root/logs"
for file in roles.sql schema.sql data.sql migration-history-schema.sql migration-history-data.sql; do
  printf '%s\n' "synthetic ${file}" > "$fixture_root/database/postgres/$file"
done
printf '%s\n' '{"schema_version":1,"component":"postgresql-auth","status":"complete","files":[]}' > "$fixture_root/database/postgres/manifest.json"
backup_write_sha256sums "$fixture_root/database/postgres"

bucket_json="$(printf '%s\n' "${LEJAPON_EXPECTED_STORAGE_BUCKETS[@]}" | node -e 'const fs=require("fs"); console.log(JSON.stringify(fs.readFileSync(0,"utf8").trim().split("\n")))')"
for bucket in "${LEJAPON_EXPECTED_STORAGE_BUCKETS[@]}"; do
  mkdir -p -- "$fixture_root/storage/$bucket"
done

FIXTURE_BUCKETS="$bucket_json" node <<'NODE' > "$fixture_root/storage/storage-manifest.json"
const buckets = JSON.parse(process.env.FIXTURE_BUCKETS);
process.stdout.write(`${JSON.stringify({
  schema_version: 1,
  component: "supabase-storage",
  status: "complete",
  expected_buckets: buckets,
  actual_buckets: buckets,
  new_buckets: [],
  missing_buckets: [],
  bucket_count: buckets.length,
  total_objects: 0,
  total_bytes: 0,
  buckets: buckets.map((name) => ({ name, expected: true, status: "complete", object_count: 0, bytes: 0 })),
}, null, 2)}\n`);
NODE

FIXTURE_BUCKETS="$bucket_json" \
FIXTURE_PROJECT_REF="$LEJAPON_BACKUP_PROJECT_REF" \
FIXTURE_PROJECT_NAME="$LEJAPON_BACKUP_PROJECT_NAME" \
node <<'NODE' > "$fixture_root/manifest.json"
const buckets = JSON.parse(process.env.FIXTURE_BUCKETS);
process.stdout.write(`${JSON.stringify({
  schema_version: 1,
  backup_id: "synthetic-backup",
  status: "complete",
  project: { name: process.env.FIXTURE_PROJECT_NAME, ref: process.env.FIXTURE_PROJECT_REF },
  postgresql: { status: "complete", artifact_directory: "database/postgres" },
  storage: { status: "complete", bucket_count: buckets.length, buckets },
}, null, 2)}\n`);
NODE

printf '%s\n' 'synthetic log without customer data' > "$fixture_root/logs/test.log"
backup_write_sha256sums "$fixture_root"

"${REPOSITORY_ROOT}/scripts/verify-production-backup.sh" --local-dir "$fixture_root"

printf '%s\n' 'tampered' >> "$fixture_root/database/postgres/schema.sql"
if "${REPOSITORY_ROOT}/scripts/verify-production-backup.sh" --local-dir "$fixture_root" >/dev/null 2>&1; then
  printf 'ERROR: checksum tampering was not detected.\n' >&2
  exit 1
fi

fake_bin="$fixture_root/fake-bin"
storage_output="$fixture_root/storage-run"
mkdir -p -- "$fake_bin"
cat > "$fake_bin/rclone" <<'FAKE_RCLONE'
#!/usr/bin/env bash
set -Eeuo pipefail
command_name="${1:-}"
shift || true
case "$command_name" in
  lsf)
    cat <<'BUCKETS'
agency-fit-requests/
article-images/
booking-docs/
database_export_19_09_26/
future-assets/
hotel-images/
international-payments/
media/
partner-onboarding/
passports/
programme-images/
programme-pdfs/
trip-documents/
trip-message-attachments/
visa-docs/
BUCKETS
    ;;
  copy)
    destination="${2:?destination required}"
    mkdir -p -- "$destination"
    printf '%s\n' 'synthetic object' > "$destination/object.txt"
    ;;
  check)
    exit 0
    ;;
  size)
    printf '%s\n' '{"count":1,"bytes":17}'
    ;;
  *)
    printf 'unsupported fake rclone command: %s\n' "$command_name" >&2
    exit 1
    ;;
esac
FAKE_RCLONE
chmod 750 "$fake_bin/rclone"

PATH="$fake_bin:$PATH" \
LEJAPON_STORAGE_OUTPUT_DIR="$storage_output" \
LEJAPON_BACKUP_ACK="READ_ONLY_BACKUP_${LEJAPON_BACKUP_PROJECT_REF}" \
SUPABASE_BACKUP_S3_ENDPOINT="https://${LEJAPON_BACKUP_PROJECT_REF}.example.invalid/storage/v1/s3" \
SUPABASE_BACKUP_S3_ACCESS_KEY_ID="synthetic-access-key" \
SUPABASE_BACKUP_S3_SECRET_ACCESS_KEY="synthetic-secret-key" \
  "${REPOSITORY_ROOT}/scripts/backup-production-storage.sh" >/dev/null

STORAGE_TEST_MANIFEST="$storage_output/storage/storage-manifest.json" node <<'NODE'
const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync(process.env.STORAGE_TEST_MANIFEST, "utf8"));
if (manifest.status !== "complete") throw new Error("Synthetic Storage backup is incomplete.");
if (manifest.bucket_count !== 15) throw new Error("Live bucket count was not preserved.");
if (!manifest.new_buckets.includes("future-assets")) throw new Error("New bucket drift was not detected.");
if (manifest.missing_buckets.length !== 0) throw new Error("Expected bucket was incorrectly reported missing.");
NODE

printf 'Synthetic backup and checksum tests passed.\n'
