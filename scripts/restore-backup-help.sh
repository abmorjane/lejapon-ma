#!/usr/bin/env bash

set -Eeuo pipefail
set +x
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=scripts/lib/backup-common.sh
source "${SCRIPT_DIR}/lib/backup-common.sh"
# shellcheck source=scripts/lib/backup-rclone.sh
source "${SCRIPT_DIR}/lib/backup-rclone.sh"

backup_require_command rclone

BACKUP_ID="${1:-}"
RETENTION_CLASS="${2:-daily}"
[[ -n "$BACKUP_ID" ]] || backup_fail "Usage: restore-backup-help.sh <backup_id> [daily|weekly|monthly]"
backup_validate_identifier "$BACKUP_ID" "backup ID"
backup_validate_retention_class "$RETENTION_CLASS"

REMOTE_PATH="${LEJAPON_BACKUP_PROJECT_NAME}/${RETENTION_CLASS}/${BACKUP_ID}"
backup_configure_destination_rclone

if ! rclone lsf "backup_crypt:${REMOTE_PATH}" --max-depth 1 >/dev/null; then
  backup_fail "The requested encrypted backup could not be read."
fi

cat <<EOF
Backup found and readable: ${BACKUP_ID}
Retention class: ${RETENTION_CLASS}

This helper performs no restore and changes no remote or Supabase data.

Required Disaster Recovery sequence:
1. Obtain written approval and create a completely isolated target project.
2. Disable cron, marketing workers, visa reminders, external email, push,
   payment callbacks, webhooks, OCR, and AI integrations on the target.
3. Retrieve the decryption password and salt from the offline recovery vault.
4. Copy the encrypted backup through the rclone crypt remote to an encrypted
   local recovery volume:

   rclone copy "backup_crypt:${REMOTE_PATH}" "<encrypted-local-recovery-dir>" --immutable

5. Run the read-only verifier before using any artifact:

   ./scripts/verify-production-backup.sh --local-dir "<encrypted-local-recovery-dir>"

6. Review manifest.json, SHA256SUMS, database/postgres/manifest.json, and
   storage/storage-manifest.json. Confirm project ref, bucket drift, counts,
   tool versions, and successful component states.
7. Restore PostgreSQL/Auth only with the documented Supabase CLI procedure and
   a target database URL belonging to the isolated project. Review SQL before
   execution and keep all automation disabled.
8. Recreate bucket settings and policies, then restore one bucket at a time
   from storage/<bucket>/<original-path>.
9. Validate Auth identities, UUID relationships, private Storage access, RLS,
   Edge Functions with test secrets, and the staging frontend.
10. Confirm that no real customer received any message before enabling a
    single integration or cron job.

Refer to docs/DISASTER-RECOVERY.md and docs/BACKUP-AUTOMATION.md for the full drill.
EOF
