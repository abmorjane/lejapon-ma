import JSZip from "jszip";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { PLATFORM_RELEASE_CHANNEL, PLATFORM_VERSION, SITE_VERSION } from "@/config/version";

export type BackupProgress = {
  step: string;
  detail?: string;
  done: number;
  total: number;
};

export type BackupTableResult = {
  table: string;
  status: "exported" | "error";
  row_count: number;
  error?: string;
};

export type BackupResult = {
  blob: Blob;
  filename: string;
  info: Record<string, unknown>;
  tables: BackupTableResult[];
  storageFileCount: number;
  authUserCount: number;
};

type StorageFileEntry = {
  bucket_id: string;
  path: string;
  name: string;
  public: boolean | null;
  size: number | null;
  mimetype: string | null;
  id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_accessed_at?: string | null;
  public_url?: string | null;
};

const CHUNK_SIZE = 1000;
export const BACKUP_PLATFORM_LABEL = `${PLATFORM_VERSION} ${PLATFORM_RELEASE_CHANNEL}`;

const BUSINESS_TABLES = [
  "clients",
  "client_notes",
  "client_rewards",
  "bookings",
  "booking_participants",
  "booking_extras",
  "booking_documents",
  "booking_audit_log",
  "payments",
  "visa_applications",
  "visa_documents",
  "visa_settings",
  "visa_document_checklists",
  "trips",
  "trip_hotels",
  "trip_rooms",
  "room_assignments",
  "booking_participant_activities",
  "trip_japan_payments",
  "itinerary_days",
  "pricing_tiers",
  "trip_suppliers",
  "suppliers",
  "supplier_members",
  "supplier_day_costs",
  "extras",
  "programmes",
  "programme_days",
  "pages",
  "articles",
  "article_categories",
  "media",
  "route_slugs",
  "faqs",
  "content_translations",
  "newsletter_subscribers",
  "contact_messages",
  "email_templates",
  "email_campaigns",
  "email_campaign_recipients",
  "email_events",
  "marketing_segments",
  "email_settings",
  "email_logs",
  "admin_email_logs",
  "agency_settings",
  "agencies",
  "agency_users",
  "agency_commissions",
  "profiles",
  "user_roles",
  "crm_export_logs",
  "admin_logs",
] as const;

const STORAGE_BUCKETS = [
  { id: "passports", public: false },
  { id: "visa-docs", public: false },
  { id: "booking-docs", public: false },
  { id: "programme-pdfs", public: true },
  { id: "media", public: true },
  { id: "article-images", public: true },
  { id: "programme-images", public: true },
] as const;

const text = (value: unknown) => String(value ?? "").trim();

function csvEscape(value: unknown) {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  return [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
}

function parseProjectId() {
  const url = import.meta.env.VITE_SUPABASE_URL ?? "";
  try {
    return new URL(url).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

function downloadSafeTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function exportTable(table: string) {
  const rows: Record<string, unknown>[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await (supabase.from(table as any) as any)
      .select("*")
      .range(from, from + CHUNK_SIZE - 1);

    if (error) throw error;
    const chunk = (data ?? []) as Record<string, unknown>[];
    rows.push(...chunk);
    if (chunk.length < CHUNK_SIZE) break;
    from += CHUNK_SIZE;
  }

  return rows;
}

async function exportAuthUsers() {
  const { data, error } = await supabase.functions.invoke("admin-users", {
    body: { action: "list" },
  });
  if (error) throw error;
  const users = ((data as any)?.users ?? []) as Array<Record<string, unknown>>;
  return users.map((user) => ({
    id: user.id ?? null,
    email: user.email ?? null,
    full_name: user.full_name ?? null,
    role: Array.isArray(user.roles) ? user.roles.join(",") : user.roles ?? null,
    roles: user.roles ?? [],
    created_at: user.created_at ?? null,
  }));
}

async function getBucketPublicStatus(bucketId: string, fallback: boolean): Promise<boolean | null> {
  const { data, error } = await supabase.storage.getBucket(bucketId);
  if (error) return fallback;
  return data?.public ?? fallback;
}

function isStorageFolder(item: any) {
  return item?.id === null || item?.metadata === null;
}

async function listBucketFiles(bucketId: string, isPublic: boolean | null, prefix = ""): Promise<StorageFileEntry[]> {
  const files: StorageFileEntry[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage.from(bucketId).list(prefix, {
      limit: CHUNK_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;

    const items = data ?? [];
    for (const item of items) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (isStorageFolder(item)) {
        files.push(...await listBucketFiles(bucketId, isPublic, path));
        continue;
      }

      const publicUrl = isPublic
        ? supabase.storage.from(bucketId).getPublicUrl(path).data.publicUrl
        : null;
      files.push({
        bucket_id: bucketId,
        path,
        name: item.name,
        public: isPublic,
        size: Number((item as any).metadata?.size ?? 0) || null,
        mimetype: (item as any).metadata?.mimetype ?? null,
        id: item.id ?? null,
        created_at: item.created_at ?? null,
        updated_at: item.updated_at ?? null,
        last_accessed_at: item.last_accessed_at ?? null,
        public_url: publicUrl,
      });
    }

    if (items.length < CHUNK_SIZE) break;
    offset += CHUNK_SIZE;
  }

  return files;
}

async function exportStorageManifest() {
  const buckets = [];
  const files: StorageFileEntry[] = [];

  for (const bucket of STORAGE_BUCKETS) {
    const publicStatus = await getBucketPublicStatus(bucket.id, bucket.public);
    try {
      const bucketFiles = await listBucketFiles(bucket.id, publicStatus);
      files.push(...bucketFiles);
      buckets.push({
        id: bucket.id,
        public: publicStatus,
        file_count: bucketFiles.length,
        status: "exported",
      });
    } catch (error: any) {
      buckets.push({
        id: bucket.id,
        public: publicStatus,
        file_count: 0,
        status: "error",
        error: error?.message ?? String(error),
      });
    }
  }

  return {
    generated_at: new Date().toISOString(),
    buckets,
    files,
  };
}

async function logBackupExport(user: User, status: "started" | "success" | "failed", metadata: Record<string, unknown>) {
  const { error } = await (supabase.from("admin_logs" as any) as any).insert({
    user_id: user.id,
    user_email: user.email ?? null,
    action: "platform_backup_export",
    entity_type: "system_backup",
    status,
    metadata,
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
  });
  if (error) throw error;
}

export async function generatePlatformBackup(user: User, onProgress?: (progress: BackupProgress) => void): Promise<BackupResult> {
  const exportDate = new Date();
  const total = BUSINESS_TABLES.length + STORAGE_BUCKETS.length + 4;
  let done = 0;

  const progress = (step: string, detail?: string) => {
    onProgress?.({ step, detail, done, total });
  };

  const generatedBy = {
    id: user.id,
    email: user.email ?? null,
  };

  await logBackupExport(user, "started", {
    platform_version: BACKUP_PLATFORM_LABEL,
    export_date: exportDate.toISOString(),
  });
  done += 1;

  const zip = new JSZip();
  const tableResults: BackupTableResult[] = [];
  let authUsers: Record<string, unknown>[] = [];
  let storageManifest: Awaited<ReturnType<typeof exportStorageManifest>> = {
    generated_at: new Date().toISOString(),
    buckets: [],
    files: [],
  };

  try {
    for (const table of BUSINESS_TABLES) {
      progress("Export base de données", table);
      try {
        const rows = await exportTable(table);
        tableResults.push({ table, status: "exported", row_count: rows.length });
        zip.file(`database/json/${table}.json`, JSON.stringify({ table, row_count: rows.length, rows }, null, 2));
        zip.file(`database/csv/${table}.csv`, toCsv(rows));
      } catch (error: any) {
        const message = error?.message ?? String(error);
        tableResults.push({ table, status: "error", row_count: 0, error: message });
        zip.file(`database/json/${table}.json`, JSON.stringify({ table, row_count: 0, rows: [], error: message }, null, 2));
        zip.file(`database/csv/${table}.csv`, "");
        zip.file(`database/errors/${table}.json`, JSON.stringify({ table, error: message }, null, 2));
      }
      done += 1;
    }

    progress("Export utilisateurs auth", "emails, rôles, dates de création");
    authUsers = await exportAuthUsers();
    zip.file("auth/auth-users.json", JSON.stringify({ row_count: authUsers.length, users: authUsers }, null, 2));
    zip.file("auth/auth-users.csv", toCsv(authUsers));
    done += 1;

    progress("Manifest stockage", "buckets et chemins fichiers");
    storageManifest = await exportStorageManifest();
    zip.file("storage-manifest.json", JSON.stringify(storageManifest, null, 2));
    done += STORAGE_BUCKETS.length;

    const backupInfo = {
      platform: "LeJapon.ma",
      platform_version: BACKUP_PLATFORM_LABEL,
      site_version: SITE_VERSION,
      export_date: exportDate.toISOString(),
      supabase_project_id: parseProjectId(),
      environment: import.meta.env.MODE,
      origin: typeof window !== "undefined" ? window.location.origin : null,
      generated_by: generatedBy,
      export_format: "zip/json/csv",
      database: {
        chunk_size: CHUNK_SIZE,
        tables_requested: BUSINESS_TABLES.length,
        tables_exported: tableResults.filter((result) => result.status === "exported").length,
        tables_with_errors: tableResults.filter((result) => result.status === "error").length,
        results: tableResults,
      },
      auth: {
        source: "admin-users edge function",
        row_count: authUsers.length,
        note: "Supabase Auth users are exported through the existing super_admin-only edge function; no service_role key is exposed to the browser.",
      },
      storage: {
        buckets_requested: STORAGE_BUCKETS.map((bucket) => bucket.id),
        files_listed: storageManifest.files.length,
        buckets: storageManifest.buckets,
      },
    };

    progress("Création du ZIP", "compression des exports");
    zip.file("backup-info.json", JSON.stringify(backupInfo, null, 2));
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    done += 1;

    const filename = `lejapon-platform-backup-${downloadSafeTimestamp(exportDate)}.zip`;
    await logBackupExport(user, "success", {
      filename,
      platform_version: BACKUP_PLATFORM_LABEL,
      table_count: tableResults.length,
      table_errors: tableResults.filter((result) => result.status === "error").length,
      auth_user_count: authUsers.length,
      storage_file_count: storageManifest.files.length,
    });
    done += 1;
    progress("Backup prêt", filename);

    return {
      blob,
      filename,
      info: backupInfo,
      tables: tableResults,
      storageFileCount: storageManifest.files.length,
      authUserCount: authUsers.length,
    };
  } catch (error: any) {
    await logBackupExport(user, "failed", {
      platform_version: BACKUP_PLATFORM_LABEL,
      error: text(error?.message) || String(error),
    }).catch(() => undefined);
    throw error;
  }
}
