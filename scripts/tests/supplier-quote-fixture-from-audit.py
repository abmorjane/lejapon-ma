"""Generate a LOCAL-ONLY fixture from the read-only catalog export; does not connect to a database.
Usage: python3 scripts/tests/supplier-quote-fixture-from-audit.py EXPORT.csv OUTPUT.sql
Synthetic dependencies outside the quote audit are minimal test fixtures, not schema assumptions for production.
"""
import csv,json,pathlib,sys
csv.field_size_limit(sys.maxsize)
with open(sys.argv[1],newline="") as audit_csv:
    export=list(csv.DictReader(audit_csv))
if len(export)!=1 or len(export[0])!=1:
    raise SystemExit("Expected the complete single-row JSON schema audit CSV")
A=json.loads(next(iter(export[0].values())))
if A["audit"]["transaction_read_only"] not in (True,"on"):
    raise SystemExit("Expected a read-only audit")
out=['''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.trips(id uuid PRIMARY KEY,archived_at timestamptz,title text);
CREATE TABLE public.suppliers(id uuid PRIMARY KEY,name text);
CREATE TABLE public.profiles(id uuid PRIMARY KEY,full_name text,role text);
CREATE TYPE public.app_role AS ENUM ('super_admin','admin','manager','agent','content_manager','sales','sales_user','staff','supplier'); CREATE TABLE public.user_roles(user_id uuid,role public.app_role);
CREATE TABLE public.supplier_portal_notifications(id uuid DEFAULT gen_random_uuid(),supplier_id uuid,type text,title text,message text,entity_type text,entity_id uuid,link text,dedupe_key text UNIQUE,email_delivery_status text,email_scheduled_at timestamptz);
CREATE TABLE public.trip_messages(id uuid PRIMARY KEY,trip_id uuid);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
''']
for t in A['tables']:
 name=t['table_name'];cols=[]
 for c in A['columns']:
  if c['table_name']!=name:continue
  typ=c['data_type'];typ=({'USER-DEFINED':'public.'+c['udt_name'],'ARRAY':c['udt_name'].lstrip('_')+'[]'}).get(typ,typ)
  definition='"'+c['column_name']+'" '+typ
  if c['column_default']:definition+=' DEFAULT '+c['column_default']
  if c['is_nullable']=='NO':definition+=' NOT NULL'
  cols.append(definition)
 out.append('CREATE TABLE public.'+name+'('+','.join(cols)+');')
for c in sorted(A['constraints'],key=lambda c: c['contype']=='f'):
 out.append('ALTER TABLE public.'+c['table_name']+' ADD CONSTRAINT '+c['conname']+' '+c['definition']+';')
for i in A['indexes']:
 # Avoid indexes already created by constraints.
 if not any(c['conname']==i.get('index_name',i.get('indexname')) for c in A['constraints']):
  out.append(i.get('definition',i.get('indexdef'))+';')
# Function compilation dependencies: defer body check to execution, exact audited pg_get_functiondef preserved.
out.append('SET check_function_bodies=off;')
for f in A['functions']:
 if f['signature'].startswith('auth.'):continue
 out.append(f['definition']+';')
 out.append('REVOKE ALL ON FUNCTION public.'+f['signature']+' FROM PUBLIC,anon,authenticated,service_role;')
 for role,key in [('anon','anon_execute'),('authenticated','authenticated_execute'),('service_role','service_role_execute')]:
  if f[key]:out.append('GRANT EXECUTE ON FUNCTION public.'+f['signature']+' TO '+role+';')
for t in A['tables']:out.append('ALTER TABLE public.'+t['table_name']+' ENABLE ROW LEVEL SECURITY;')
for p in A['policies']:
 s='CREATE POLICY "'+p['policyname']+'" ON public.'+p['tablename']+' AS '+p['permissive']+' FOR '+p['cmd']+' TO '+','.join(p['roles'])
 if p['qual']:s+=' USING ('+p['qual']+')'
 if p['with_check']:s+=' WITH CHECK ('+p['with_check']+')'
 out.append(s+';')
for g in A['table_grants']:
 # audit fields introspected below
 role=g.get('role_name',g.get('role')); t=g['table_name']
 perms=[p for p in ['SELECT','INSERT','UPDATE','DELETE'] if g.get(p.lower()+'_grant',False)]
 if perms:out.append('GRANT '+','.join(perms)+' ON public.'+t+' TO '+role+';')
for tr in A['triggers']:
 if tr['table_name']=='trip_suppliers':continue # notifier dependencies outside audited scope
 out.append(tr['definition']+';')
pathlib.Path(sys.argv[2]).write_text('\n'.join(out))
print('Local fixture written; do not execute it against production.')
