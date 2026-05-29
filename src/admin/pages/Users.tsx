import { useEffect, useMemo, useState } from "react";
import { Edit, KeyRound, Loader2, Plus, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "../components/PageHeader";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, Role } from "../lib/permissions";
import { fmtDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const ALL_ROLES: Role[] = ["super_admin", "admin", "manager", "agent", "content_manager", "supplier", "marketing_manager"];
const ORG_ROLES = ["owner", "admin", "agent", "finance", "operations", "viewer"] as const;
const ORG_STATUSES = ["active", "suspended"] as const;

type UserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  created_at: string | null;
  roles: Role[];
};

type ExternalMemberRow = {
  member_id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  organization_id: string;
  organization_name: string | null;
  organization_type: string | null;
  organization_status: string | null;
  role: string;
  status: string;
  created_at: string | null;
};

type VisaClientRow = {
  id: string;
  reference: string;
  user_id: string;
  surname: string | null;
  given_names: string | null;
  residential_email: string | null;
  passport_no: string | null;
  status: string;
  created_at: string | null;
  submitted_at: string | null;
};

type ResetResult = {
  user_id: string;
  email: string | null;
  temporary_password: string | null;
  email_sent: boolean | null;
  raw: unknown;
};

type VisaFilter = "hide_staff" | "all";

type DbClient = {
  from: (table: string) => any;
};

const db = supabase as unknown as DbClient;

async function readFunctionError(error: any) {
  const context = error?.context;
  if (context && typeof context.json === "function") {
    try {
      return await context.json();
    } catch {
      return null;
    }
  }
  return null;
}

const functionErrorMessage = async (error: any) => {
  const body = await readFunctionError(error);
  return body?.detail || body?.error || error?.message || "Edge Function returned a non-2xx status code.";
};

export default function UsersAdmin() {
  const { isSuperAdmin } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [externalMembers, setExternalMembers] = useState<ExternalMemberRow[]>([]);
  const [visaClients, setVisaClients] = useState<VisaClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [openCreate, setOpenCreate] = useState(false);
  const [profileEdit, setProfileEdit] = useState<{ user_id: string; full_name: string; phone: string } | null>(null);
  const [resetResult, setResetResult] = useState<ResetResult | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
  const [externalRawResponse, setExternalRawResponse] = useState<string | null>(null);
  const [adminUsersFunctionVersion, setAdminUsersFunctionVersion] = useState<string | null>(null);
  const [visaFilter, setVisaFilter] = useState<VisaFilter>("hide_staff");
  const [form, setForm] = useState({ email: "", password: "", full_name: "", roles: [] as Role[] });

  const staffUsers = useMemo(() => users.filter((user) => user.roles.length > 0), [users]);
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const visibleVisaClients = useMemo(
    () =>
      visaFilter === "all"
        ? visaClients
        : visaClients.filter((visa) => !(usersById.get(visa.user_id)?.roles?.length)),
    [usersById, visaClients, visaFilter]
  );

  const loadUsers = async () => {
    setLoading(true);
    setRawError(null);
    setAdminUsersFunctionVersion(null);

    const [usersResult, externalResult, visaResult] = await Promise.all([
      supabase.functions.invoke("admin-users", { body: { action: "list" } }),
      supabase.functions.invoke("admin-users", { body: { action: "list_external_members" } }),
      db
        .from("visa_applications")
        .select("id,reference,user_id,surname,given_names,residential_email,passport_no,status,created_at,submitted_at")
        .order("created_at", { ascending: false })
        .limit(250),
    ]);

    if (usersResult.error) {
      const body = await readFunctionError(usersResult.error);
      const message = await functionErrorMessage(usersResult.error);
      toast.error(message);
      setRawError(JSON.stringify(body ?? { error: message }, null, 2));
      setUsers([]);
    } else {
      const payload = (usersResult.data as any) ?? {};
      setAdminUsersFunctionVersion(payload.function_version ?? null);
      setUsers((payload.users ?? []) as UserRow[]);
    }

    if (externalResult.error) {
      const body = await readFunctionError(externalResult.error);
      const message = await functionErrorMessage(externalResult.error);
      toast.error(`Utilisateurs externes: ${message}`);
      setRawError(JSON.stringify(body ?? { error: message }, null, 2));
      setExternalRawResponse(JSON.stringify(body ?? { error: message }, null, 2));
      if (body?.function_version) setAdminUsersFunctionVersion(body.function_version);
      setExternalMembers([]);
    } else {
      const payload = (externalResult.data as any) ?? {};
      const rows = ((payload.external_members ?? []) as any[]).map((member) => ({
        ...member,
        role: member.role ?? member.member_role ?? "viewer",
        status: member.status ?? member.member_status ?? "suspended",
      }));
      if (payload.function_version) setAdminUsersFunctionVersion(payload.function_version);
      setExternalRawResponse(JSON.stringify(payload, null, 2));
      setExternalMembers(rows as ExternalMemberRow[]);
    }

    if (visaResult.error) {
      setVisaClients([]);
      setRawError(visaResult.error.message);
    } else {
      setVisaClients((visaResult.data ?? []) as VisaClientRow[]);
    }

    setLoading(false);
  };

  useEffect(() => {
    if (isSuperAdmin) loadUsers();
    else setLoading(false);
  }, [isSuperAdmin]);

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
          <ShieldOff className="h-6 w-6 text-muted-foreground" />
        </div>
        <h2 className="font-display text-xl">Réservé aux Super Admins</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Seul un Super Admin peut gérer les comptes utilisateurs.
        </p>
      </div>
    );
  }

  const toggleRole = (target: Role, list: Role[], set: (roles: Role[]) => void) => {
    set(list.includes(target) ? list.filter((role) => role !== target) : [...list, target]);
  };

  const createStaff = async () => {
    if (!form.email || !form.password) {
      toast.error("Email et mot de passe requis.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.functions.invoke("admin-users", {
      body: { action: "create", ...form },
    });
    setBusy(false);
    if (error) {
      toast.error(await functionErrorMessage(error));
      return;
    }
    toast.success("Utilisateur staff créé.");
    setOpenCreate(false);
    setForm({ email: "", password: "", full_name: "", roles: [] });
    loadUsers();
  };

  const updateRoles = async (userId: string, nextRoles: Role[]) => {
    setBusy(true);
    const { error } = await supabase.functions.invoke("admin-users", {
      body: { action: "set_roles", user_id: userId, roles: nextRoles },
    });
    setBusy(false);
    if (error) toast.error(await functionErrorMessage(error));
    else {
      toast.success("Rôles staff mis à jour.");
      loadUsers();
    }
  };

  const resetPassword = async (userId: string, email: string | null) => {
    setBusy(true);
    setResetResult(null);
    const { data, error } = await supabase.functions.invoke("admin-users", {
      body: { action: "reset_password", user_id: userId },
    });
    setBusy(false);
    if (error) {
      const body = await readFunctionError(error);
      const message = await functionErrorMessage(error);
      setRawError(JSON.stringify(body ?? { error: message }, null, 2));
      toast.error(message);
      return;
    }
    const payload = (data ?? {}) as any;
    if (payload.function_version) setAdminUsersFunctionVersion(payload.function_version);
    setResetResult({
      user_id: userId,
      email,
      temporary_password: payload.temporary_password ?? null,
      email_sent: payload.email_sent ?? null,
      raw: payload,
    });
    if (payload.temporary_password) toast.warning("Mot de passe provisoire généré. À communiquer manuellement.");
    else toast.success("Mot de passe réinitialisé.");
  };

  const saveProfile = async () => {
    if (!profileEdit) return;
    setBusy(true);
    const { error } = await supabase.functions.invoke("admin-users", {
      body: {
        action: "update_profile",
        user_id: profileEdit.user_id,
        full_name: profileEdit.full_name,
        phone: profileEdit.phone,
      },
    });
    setBusy(false);
    if (error) {
      toast.error(await functionErrorMessage(error));
      return;
    }
    toast.success("Profil mis à jour.");
    setProfileEdit(null);
    loadUsers();
  };

  const updateExternalMember = async (member: ExternalMemberRow, patch: Record<string, string>) => {
    setBusy(true);
    const { error } = await db.from("organization_members").update(patch).eq("id", member.member_id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Membre organisation mis à jour.");
    loadUsers();
  };

  const openProfileEdit = (userId: string, fullName?: string | null, phone?: string | null) => {
    setProfileEdit({ user_id: userId, full_name: fullName ?? "", phone: phone ?? "" });
  };

  const SummaryCards = () => (
    <div className="grid gap-3 sm:grid-cols-3">
      <Card className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Staff interne</p>
        <p className="mt-1 text-2xl font-semibold">{staffUsers.length}</p>
      </Card>
      <Card className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Utilisateurs externes</p>
        <p className="mt-1 text-2xl font-semibold">{externalMembers.length}</p>
      </Card>
      <Card className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Clients visa</p>
        <p className="mt-1 text-2xl font-semibold">{visibleVisaClients.length}</p>
      </Card>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Utilisateurs"
        description="Les utilisateurs staff ont accès au backoffice interne. Les utilisateurs externes sont gérés depuis leurs organisations et n'ont pas de rôle interne."
        action={
          <Button onClick={() => setOpenCreate(true)} className="min-h-11">
            <Plus className="h-4 w-4" />
            Créer staff interne
          </Button>
        }
      />

      <SummaryCards />

      {rawError && (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">Dernière réponse/erreur brute</p>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs">{rawError}</pre>
        </Card>
      )}

      {!adminUsersFunctionVersion && !loading && (
        <Card className="border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          admin-users Edge Function is not deployed or old version is running.
        </Card>
      )}

      {resetResult?.temporary_password && (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">Mot de passe provisoire à communiquer manuellement</p>
          <p className="mt-1">Utilisateur: {resetResult.email || resetResult.user_id}</p>
          <p className="mt-2 font-mono text-base">{resetResult.temporary_password}</p>
        </Card>
      )}

      <Tabs defaultValue="staff" className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-1 sm:grid-cols-3">
          <TabsTrigger value="staff">Staff interne</TabsTrigger>
          <TabsTrigger value="external">Utilisateurs externes</TabsTrigger>
          <TabsTrigger value="visa">Clients visa</TabsTrigger>
        </TabsList>

        <TabsContent value="staff" className="mt-0">
          <Card className="overflow-hidden">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-secondary/50">
                <tr className="text-left">
                  <th className="p-4 font-semibold">Utilisateur</th>
                  <th className="p-4 font-semibold">Rôles internes</th>
                  <th className="p-4 font-semibold">Créé le</th>
                  <th className="p-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">Chargement…</td></tr>}
                {!loading && staffUsers.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">Aucun staff interne.</td></tr>}
                {staffUsers.map((staff) => (
                  <tr key={staff.id} className="align-top hover:bg-secondary/30">
                    <td className="p-4">
                      <p className="font-medium">{staff.full_name || "—"}</p>
                      <p className="text-xs text-muted-foreground">{staff.email}</p>
                      {externalMembers.some((member) => member.user_id === staff.id) && (
                        <Badge variant="outline" className="mt-2 border-amber-200 bg-amber-50 text-amber-800">Accès mixte interne + organisation</Badge>
                      )}
                    </td>
                    <td className="p-4">
                      <div className="flex max-w-xl flex-wrap gap-1.5">
                        {ALL_ROLES.map((role) => {
                          const active = staff.roles.includes(role);
                          return (
                            <button
                              key={role}
                              onClick={() => updateRoles(staff.id, active ? staff.roles.filter((item) => item !== role) : [...staff.roles, role])}
                              className={cn(
                                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                                active
                                  ? "border-accent bg-accent text-accent-foreground"
                                  : "border-border bg-background text-muted-foreground hover:border-accent/50"
                              )}
                            >
                              {ROLE_LABELS[role]}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td className="p-4 text-xs text-muted-foreground">{fmtDateTime(staff.created_at)}</td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => openProfileEdit(staff.id, staff.full_name, staff.phone)}>
                          <Edit className="h-3.5 w-3.5" />
                          Profil
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => resetPassword(staff.id, staff.email)} disabled={busy}>
                          <KeyRound className="h-3.5 w-3.5" />
                          Réinitialiser
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        <TabsContent value="external" className="mt-0">
          <div className="mb-3 rounded-lg border border-border bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
            organization_members retournés: <span className="font-semibold text-foreground">{externalMembers.length}</span>
          </div>
          <Card className="overflow-hidden">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-secondary/50">
                <tr className="text-left">
                  <th className="p-4 font-semibold">Utilisateur</th>
                  <th className="p-4 font-semibold">Organisation</th>
                  <th className="p-4 font-semibold">Rôle organisation</th>
                  <th className="p-4 font-semibold">Statut membre</th>
                  <th className="p-4 font-semibold">Créé le</th>
                  <th className="p-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Chargement…</td></tr>}
                {!loading && externalMembers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="space-y-3 p-8 text-center text-muted-foreground">
                      <p>Aucun utilisateur externe.</p>
                      {externalRawResponse && (
                        <pre className="mx-auto max-h-64 max-w-3xl overflow-auto rounded-lg bg-muted p-3 text-left text-xs text-muted-foreground">
                          {externalRawResponse}
                        </pre>
                      )}
                    </td>
                  </tr>
                )}
                {externalMembers.map((member) => (
                  <tr key={member.member_id} className="align-top hover:bg-secondary/30">
                    <td className="p-4">
                      <p className="font-medium">{member.full_name || "—"}</p>
                      <p className="text-xs text-muted-foreground">{member.email || member.user_id}</p>
                      {usersById.get(member.user_id)?.roles?.length ? (
                        <Badge variant="outline" className="mt-2 border-amber-200 bg-amber-50 text-amber-800">Accès mixte interne + organisation</Badge>
                      ) : null}
                    </td>
                    <td className="p-4">
                      <p className="font-medium">{member.organization_name || "—"}</p>
                      <p className="text-xs text-muted-foreground">{member.organization_type || "—"} · {member.organization_status || "—"}</p>
                    </td>
                    <td className="p-4">
                      <Select value={member.role} onValueChange={(value) => updateExternalMember(member, { role: value })}>
                        <SelectTrigger className="h-9 min-w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ORG_ROLES.map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-4">
                      <Select value={member.status} onValueChange={(value) => updateExternalMember(member, { status: value })}>
                        <SelectTrigger className="h-9 min-w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ORG_STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-4 text-xs text-muted-foreground">{fmtDateTime(member.created_at)}</td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => openProfileEdit(member.user_id, member.full_name, member.phone)}>
                          <Edit className="h-3.5 w-3.5" />
                          Profil
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => resetPassword(member.user_id, member.email)} disabled={busy}>
                          <KeyRound className="h-3.5 w-3.5" />
                          Réinitialiser
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        <TabsContent value="visa" className="mt-0">
          <Card className="p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Cette version restaurée montre les demandes visa liées à des comptes Auth via <span className="font-mono">visa_applications.user_id</span>. Les comptes staff utilisés pour tester sont masqués par défaut.
              </p>
              <Select value={visaFilter} onValueChange={(value) => setVisaFilter(value as VisaFilter)}>
                <SelectTrigger className="min-h-11 w-full sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hide_staff">Masquer staff/tests</SelectItem>
                  <SelectItem value="all">Afficher tout</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Card>
          <Card className="mt-4 overflow-hidden">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-secondary/50">
                <tr className="text-left">
                  <th className="p-4 font-semibold">Client visa</th>
                  <th className="p-4 font-semibold">Compte Auth</th>
                  <th className="p-4 font-semibold">Passeport</th>
                  <th className="p-4 font-semibold">Statut</th>
                  <th className="p-4 font-semibold">Créé le</th>
                  <th className="p-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Chargement…</td></tr>}
                {!loading && visibleVisaClients.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Aucun dossier visa visible.</td></tr>}
                {visibleVisaClients.map((visa) => {
                  const authUser = usersById.get(visa.user_id);
                  const isStaffTest = Boolean(authUser?.roles?.length);
                  return (
                    <tr key={visa.id} className="hover:bg-secondary/30">
                      <td className="p-4">
                        <p className="font-medium">{[visa.given_names, visa.surname].filter(Boolean).join(" ") || "—"}</p>
                        <p className="text-xs text-muted-foreground">{visa.reference}</p>
                        {isStaffTest && (
                          <Badge variant="outline" className="mt-2 border-amber-200 bg-amber-50 text-amber-800">
                            Compte staff utilisé pour test
                          </Badge>
                        )}
                      </td>
                      <td className="p-4">
                        <p className="font-medium">{authUser?.email || visa.residential_email || "—"}</p>
                        <p className="text-xs text-muted-foreground">{visa.user_id}</p>
                      </td>
                      <td className="p-4">{visa.passport_no || "—"}</td>
                      <td className="p-4"><Badge variant="outline">{visa.status}</Badge></td>
                      <td className="p-4 text-xs text-muted-foreground">{fmtDateTime(visa.created_at)}</td>
                      <td className="p-4">
                        {authUser ? (
                          <Button size="sm" variant="outline" onClick={() => resetPassword(visa.user_id, authUser.email || visa.residential_email)} disabled={busy}>
                            <KeyRound className="h-3.5 w-3.5" />
                            Réinitialiser
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">Compte Auth non résolu</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Créer un staff interne</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="fn">Nom complet</Label>
              <Input id="fn" value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} />
            </div>
            <div>
              <Label htmlFor="em">Email</Label>
              <Input id="em" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </div>
            <div>
              <Label htmlFor="pw">Mot de passe temporaire</Label>
              <Input id="pw" type="text" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
            </div>
            <div>
              <Label>Rôles internes backoffice</Label>
              <div className="mt-2 grid gap-2">
                {ALL_ROLES.map((role) => (
                  <label key={role} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-secondary/50">
                    <Checkbox
                      checked={form.roles.includes(role)}
                      onCheckedChange={() => toggleRole(role, form.roles, (next) => setForm({ ...form, roles: next }))}
                    />
                    <div>
                      <p className="text-sm font-medium">{ROLE_LABELS[role]}</p>
                      <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCreate(false)}>Annuler</Button>
            <Button onClick={createStaff} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Créer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(profileEdit)} onOpenChange={(open) => !open && setProfileEdit(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Modifier le profil</DialogTitle></DialogHeader>
          {profileEdit && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="profile_full_name">Nom complet</Label>
                <Input id="profile_full_name" value={profileEdit.full_name} onChange={(event) => setProfileEdit({ ...profileEdit, full_name: event.target.value })} />
              </div>
              <div>
                <Label htmlFor="profile_phone">Téléphone</Label>
                <Input id="profile_phone" value={profileEdit.phone} onChange={(event) => setProfileEdit({ ...profileEdit, phone: event.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setProfileEdit(null)}>Annuler</Button>
            <Button onClick={saveProfile} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
