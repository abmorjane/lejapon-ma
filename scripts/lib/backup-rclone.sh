#!/usr/bin/env bash

# Ephemeral rclone configuration. Values are supplied by environment variables;
# no rclone.conf file is created and no secret value is printed.

backup_configure_source_rclone() {
  backup_require_env "SUPABASE_BACKUP_S3_ENDPOINT"
  backup_require_env "SUPABASE_BACKUP_S3_ACCESS_KEY_ID"
  backup_require_env "SUPABASE_BACKUP_S3_SECRET_ACCESS_KEY"

  case "$SUPABASE_BACKUP_S3_ENDPOINT" in
    *"${LEJAPON_BACKUP_PROJECT_REF}"*) ;;
    *) backup_fail "SUPABASE_BACKUP_S3_ENDPOINT does not reference the expected production project." ;;
  esac

  export RCLONE_CONFIG_SUPABASE_SOURCE_TYPE="s3"
  export RCLONE_CONFIG_SUPABASE_SOURCE_PROVIDER="${SUPABASE_BACKUP_S3_PROVIDER:-Other}"
  export RCLONE_CONFIG_SUPABASE_SOURCE_ENV_AUTH="false"
  export RCLONE_CONFIG_SUPABASE_SOURCE_ACCESS_KEY_ID="$SUPABASE_BACKUP_S3_ACCESS_KEY_ID"
  export RCLONE_CONFIG_SUPABASE_SOURCE_SECRET_ACCESS_KEY="$SUPABASE_BACKUP_S3_SECRET_ACCESS_KEY"
  export RCLONE_CONFIG_SUPABASE_SOURCE_ENDPOINT="$SUPABASE_BACKUP_S3_ENDPOINT"
  export RCLONE_CONFIG_SUPABASE_SOURCE_REGION="${SUPABASE_BACKUP_S3_REGION:-auto}"
  export RCLONE_CONFIG_SUPABASE_SOURCE_FORCE_PATH_STYLE="${SUPABASE_BACKUP_S3_FORCE_PATH_STYLE:-true}"
  export RCLONE_CONFIG_SUPABASE_SOURCE_NO_CHECK_BUCKET="true"
}

backup_configure_destination_rclone() {
  backup_require_env "BACKUP_S3_ENDPOINT"
  backup_require_env "BACKUP_S3_REGION"
  backup_require_env "BACKUP_S3_BUCKET"
  backup_require_env "BACKUP_S3_ACCESS_KEY_ID"
  backup_require_env "BACKUP_S3_SECRET_ACCESS_KEY"
  backup_require_env "BACKUP_CRYPT_PASSWORD"
  backup_require_env "BACKUP_CRYPT_SALT"

  local crypt_password_obscured
  local crypt_salt_obscured

  # rclone crypt expects obscured config values. The original secrets are never
  # written to disk or logs; xtrace must remain disabled in callers.
  crypt_password_obscured="$(rclone obscure "$BACKUP_CRYPT_PASSWORD")"
  crypt_salt_obscured="$(rclone obscure "$BACKUP_CRYPT_SALT")"

  export RCLONE_CONFIG_BACKUP_RAW_TYPE="s3"
  export RCLONE_CONFIG_BACKUP_RAW_PROVIDER="${BACKUP_S3_PROVIDER:-Other}"
  export RCLONE_CONFIG_BACKUP_RAW_ENV_AUTH="false"
  export RCLONE_CONFIG_BACKUP_RAW_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
  export RCLONE_CONFIG_BACKUP_RAW_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
  export RCLONE_CONFIG_BACKUP_RAW_ENDPOINT="$BACKUP_S3_ENDPOINT"
  export RCLONE_CONFIG_BACKUP_RAW_REGION="$BACKUP_S3_REGION"
  export RCLONE_CONFIG_BACKUP_RAW_FORCE_PATH_STYLE="${BACKUP_S3_FORCE_PATH_STYLE:-true}"
  export RCLONE_CONFIG_BACKUP_RAW_NO_CHECK_BUCKET="true"

  export RCLONE_CONFIG_BACKUP_CRYPT_TYPE="crypt"
  export RCLONE_CONFIG_BACKUP_CRYPT_REMOTE="backup_raw:${BACKUP_S3_BUCKET}"
  export RCLONE_CONFIG_BACKUP_CRYPT_FILENAME_ENCRYPTION="standard"
  export RCLONE_CONFIG_BACKUP_CRYPT_DIRECTORY_NAME_ENCRYPTION="true"
  export RCLONE_CONFIG_BACKUP_CRYPT_PASSWORD="$crypt_password_obscured"
  export RCLONE_CONFIG_BACKUP_CRYPT_PASSWORD2="$crypt_salt_obscured"

  unset BACKUP_CRYPT_PASSWORD BACKUP_CRYPT_SALT
}
