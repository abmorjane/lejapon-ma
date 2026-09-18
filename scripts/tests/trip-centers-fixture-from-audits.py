"""LOCAL ONLY: build Messages/Documents test fixtures from the two read-only CSV audits.

Usage: python3 scripts/tests/trip-centers-fixture-from-audits.py QUOTE.csv CENTERS.csv BASE.sql ADDON.sql
Load BASE, the existing synthetic quote seed, the existing quote-business migration,
then ADDON in a disposable PostgreSQL database. Never execute fixtures in production.
No database connection, credentials, network, message content or financial data are read.
"""
import csv
import json
import pathlib
import subprocess
import sys

csv.field_size_limit(sys.maxsize)
quote_csv, centers_csv, base_file, addon_file = sys.argv[1:]
with open(centers_csv, newline="") as source:
    rows = list(csv.DictReader(source))
if len(rows) != 1 or len(rows[0]) != 1:
    raise SystemExit("Expected the complete single-result schema audit CSV")
audit = json.loads(next(iter(rows[0].values())))
if audit["audit"]["transaction_read_only"] != "on":
    raise SystemExit("Expected a read-only audit")
subprocess.run([sys.executable, "scripts/tests/supplier-quote-fixture-from-audit.py", quote_csv, base_file], check=True)
with open(base_file, "a") as base:
    base.write("\n-- Remove the original fixture's EMPTY placeholder: live audit confirms absence.\nDROP TABLE public.trip_messages;\n")

def ident(value):
    return '"' + value.replace('"', '""') + '"'

def literal(value):
    return "'" + value.replace("'", "''") + "'"

out = ["-- LOCAL ONLY. Synthetic dependencies outside the audits are explicitly minimal.\nCREATE SCHEMA storage;"]
enum_groups = {}
for enum in audit["enum_values"]:
    enum_groups.setdefault((enum["schema_name"], enum["type_name"]), []).append(enum["label"])
for (schema, name), labels in enum_groups.items():
    if schema == "storage" or name == "trip_status":
        out.append(f"CREATE TYPE {ident(schema)}.{ident(name)} AS ENUM ({','.join(map(literal, labels))});")
out.append("ALTER TABLE public.trips ADD COLUMN status public.trip_status NOT NULL DEFAULT 'open';")
for table in ["buckets", "objects"]:
    fields = []
    for col in audit["columns"]:
        if (col["schema_name"], col["table_name"]) != ("storage", table):
            continue
        field = ident(col["column_name"]) + " " + col["type"]
        expression = col["default_or_generation_expression"]
        if col["generated_kind"]:
            field += " GENERATED ALWAYS AS (" + expression + ") STORED"
        elif expression:
            field += " DEFAULT " + expression
        if col["not_null"]:
            field += " NOT NULL"
        fields.append(field)
    out.append(f"CREATE TABLE storage.{table} ({','.join(fields)});")
for con in sorted(audit["constraints"], key=lambda con: con["type"] == "f"):
    if con["schema_name"] == "storage":
        out.append(f"ALTER TABLE storage.{ident(con['table_name'])} ADD CONSTRAINT {ident(con['name'])} {con['definition']};")
for index in audit["indexes"]:
    if index["schemaname"] == "storage" and not any(con["schema_name"] == "storage" and con["name"] == index["indexname"] for con in audit["constraints"]):
        out.append(index["indexdef"] + ";")

out.append("SET check_function_bodies=off;")
helpers = {"auth.uid()", "is_staff(uuid)", "has_role(uuid,app_role)", "user_supplier_ids(uuid)",
           "supplier_can_access_trip(uuid,uuid)", "supplier_can_edit_trip(uuid,uuid)",
           "supplier_can_access_trip_document_file(uuid,text)", "guard_archived_trip_supplier_writes()"}
for function in audit["functions"]:
    signature = function["signature"]
    if signature not in helpers and not signature.startswith("storage."):
        continue
    qualified = signature if signature.startswith(("storage.", "auth.")) else "public." + signature
    out.append(function["definition"] + ";")
    out.append(f"REVOKE ALL ON FUNCTION {qualified} FROM PUBLIC,anon,authenticated,service_role;")
    for role in ["anon", "authenticated", "service_role"]:
        if function[role + "_execute"]:
            out.append(f"GRANT EXECUTE ON FUNCTION {qualified} TO {role};")
out.append("CREATE TABLE public.fit_supplier_requests(id uuid PRIMARY KEY,supplier_id uuid);")
for table in ["storage.objects", "storage.buckets", "public.trips"]:
    out.append("ALTER TABLE " + table + " ENABLE ROW LEVEL SECURITY;")
out.append("GRANT USAGE ON SCHEMA storage TO anon,authenticated,service_role; GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects,storage.buckets TO anon,authenticated,service_role; GRANT SELECT ON public.trips,public.fit_supplier_requests TO anon,authenticated,service_role;")
for policy in audit["policies"]:
    expression = (policy["qual"] or "") + " " + (policy["with_check"] or "")
    # Exact audited target-bucket policies and representative unrelated public
    # asset policy. Other module dependencies are not fabricated for this test.
    relevant = policy["schemaname"] == "public" and policy["tablename"] == "trips"
    relevant |= policy["schemaname"] == "storage" and ("trip-documents" in expression or "trip-message-attachments" in expression or policy["policyname"] == "public read article-images")
    if not relevant:
        continue
    sql = f"CREATE POLICY {ident(policy['policyname'])} ON {ident(policy['schemaname'])}.{ident(policy['tablename'])} AS {policy['permissive']} FOR {policy['cmd']} TO " + ",".join(policy["roles"])
    if policy["qual"]:
        sql += " USING (" + policy["qual"] + ")"
    if policy["with_check"]:
        sql += " WITH CHECK (" + policy["with_check"] + ")"
    out.append(sql + ";")
for trigger in audit["triggers"]:
    if trigger["schema_name"] == "storage":
        out.append(trigger["definition"] + ";")
out.append("""
-- Emulate production's permissive historical DEFAULT privileges; the new
-- migration must explicitly revoke anon and PUBLIC grants on module tables.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
INSERT INTO public.user_roles VALUES
 ('00000000-0000-0000-0000-000000000001','supplier'),
 ('00000000-0000-0000-0000-000000000002','supplier');
INSERT INTO public.trips(id,title,archived_at) VALUES
 ('21000000-0000-0000-0000-000000000001','Synthetic module A',null),
 ('21000000-0000-0000-0000-000000000002','Synthetic module B',null),
 ('21000000-0000-0000-0000-000000000003','Synthetic archived A',now());
INSERT INTO public.trip_suppliers(trip_id,supplier_id,status) VALUES
 ('21000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','assigned'),
 ('21000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','assigned'),
 ('21000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','assigned');
INSERT INTO public.suppliers(id,name) VALUES ('11111111-1111-4111-8111-111111111111','Synthetic FIT supplier');
INSERT INTO public.supplier_members(supplier_id,user_id) VALUES
 ('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000001');
INSERT INTO public.fit_supplier_requests VALUES
 ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111');
CREATE TABLE public.trip_centers_quote_snapshot AS SELECT id,to_jsonb(q) AS data FROM public.supplier_trip_quotes q;
CREATE TABLE public.trip_centers_financial_snapshot AS
 SELECT 'hotels' AS category,to_jsonb(r) AS data FROM public.supplier_quote_hotel_rows r
 UNION ALL SELECT 'transport',to_jsonb(r) FROM public.supplier_quote_transport_rows r
 UNION ALL SELECT 'activities',to_jsonb(r) FROM public.supplier_quote_activity_rows r
 UNION ALL SELECT 'guides',to_jsonb(r) FROM public.supplier_quote_guide_rows r
 UNION ALL SELECT 'other',to_jsonb(r) FROM public.supplier_quote_other_rows r;
CREATE TABLE public.trip_centers_policy_snapshot AS SELECT * FROM pg_policies
 WHERE (schemaname='public' AND (tablename='trips' OR tablename LIKE 'supplier_quote_%' OR tablename='supplier_trip_quotes'))
 OR (schemaname='storage' AND policyname IN ('supplier FIT document read','supplier FIT document upload','public read article-images'));
"""
)
pathlib.Path(addon_file).write_text("\n".join(out))
print("Local addon fixture written. Do not execute fixtures against production.")
