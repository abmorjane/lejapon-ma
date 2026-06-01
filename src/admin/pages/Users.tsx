import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Copy, Edit, KeyRound, Loader2, Plus, ShieldOff, Trash2, UserX } from "lucide-react";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { Textarea } from "@/components/ui/textarea";
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
  organization_member_profile_id: string | null;
  user_id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  secondary_phone: string | null;
  secondary_email: string | null;
  position_title: string | null;
  point_of_sale: string | null;
  notes: string | null;
  avatar_url: string | null;
  organization_id: string;
  organization_name: string | null;
  organization_legal_name: string | null;
  organization_website: string | null;
  organization_type: string | null;
  organization_status: string | null;
  role: string;
  status: string;
  created_at: string | null;
  raw_member?: Record<string, any> | null;
  raw_profile?: Record<string, any> | null;
  raw_organization?: Record<string, any> | null;
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

type ProfileEditState = {
  user_id: string;
  member_id?: string | null;
  organization_id?: string | null;
  organization_member_profile_id?: string | null;
  email: string;
  organization_name?: string;
  full_name: string;
  phone: string;
  secondary_phone: string;
  secondary_email: string;
  position_title: string;
  point_of_sale: string;
  notes: string;
  role: string;
  status: string;
  isExternal: boolean;
};

type VisaFilter = "hide_staff" | "all";

type DeleteAction = {
  title: string;
  description: string;
  label: string;
  action: "delete_user_safely" | "remove_organization_member" | "delete_external_user_safely" | "deactivate_user";
  user_id?: string;
  member_id?: string;
  remove_memberships?: boolean;
};

type DbClient = {
  from: (table: string) => any;
};

const db = supabase as unknown as DbClient;

async function readFunctionError(error: any) {
  const context = error?.context;
  const result: {
    status?: number;
    statusText?: string;
    message?: string;
    json?: any;
    text?: string;
  } = {
    status: context?.status,
    statusText: context?.statusText,
    message: error?.message,
  };

  if (context && typeof context.clone === "function") {
    try {
      result.json = await context.clone().json();
      return result;
    } catch {
      try {
        result.text = await context.clone().text();
      } catch {
        result.text = null as any;
      }
      return result;
    }
  }

  if (context && typeof context.json === "function") {
    try {
      result.json = await context.json();
      return result;
    } catch {
      if (typeof context.text === "function") {
        try {
          result.text = await context.text();
        } catch {
          result.text = null as any;
        }
      }
    }
  }

  return result;
}

const functionErrorMessage = async (error: any) => {
  const body = await readFunctionError(error);
  return body?.json?.detail || body?.json?.error || body?.text || body?.message || error?.message || "Edge Function returned a non-2xx status code.";
};

const ORGANIZATION_MEMBER_PROFILE_COLUMNS = [
  "id",
  "organization_member_id",
  "user_id",
  "organization_id",
  "full_name",
  "email",
  "phone",
  "secondary_phone",
  "secondary_email",
  "position_title",
  "point_of_sale",
  "notes",
].join(",");

const cleanDisplay = (value: unknown) => (typeof value === "string" && value.trim().length ? value.trim() : null);

export default function UsersAdmin() {
  const { user, isSuperAdmin } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [externalMembers, setExternalMembers] = useState<ExternalMemberRow[]>([]);
  const [visaClients, setVisaClients] = useState<VisaClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [openCreate, setOpenCreate] = useState(false);
  const [profileEdit, setProfileEdit] = useState<ProfileEditState | null>(null);
  const [resetResult, setResetResult] = useState<ResetResult | null>(null);
  const [deleteAction, setDeleteAction] = useState<DeleteAction | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [rawError, setRawError] = useState<string | null>(null);
  const [externalRawResponse, setExternalRawResponse] = useState<string | null>(null);
  const [externalRequestPayload, setExternalRequestPayload] = useState<string | null>(null);
  const [externalDebugResponse, setExternalDebugResponse] = useState<string | null>(null);
  const [externalDebugOpen, setExternalDebugOpen] = useState(false);
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

  const loadExternalMembersDirect = async (authUserMap: Map<string, any>) => {
    const queries = {
      organization_members:
        "organization_members.select(id, organization_id, user_id, role, status, created_at).order(created_at desc)",
      organization_member_profiles:
        "organization_member_profiles.select(id, organization_member_id, user_id, organization_id, full_name, email, phone, secondary_phone, secondary_email, position_title, point_of_sale, notes).in(organization_member_id)",
      organizations:
        "organizations.select(id, display_name, legal_name, type, status, email, phone, website).in(id)",
    };

    const membersResult = await db
      .from("organization_members")
      .select("id,organization_id,user_id,role,status,created_at")
      .order("created_at", { ascending: false, nullsFirst: false });

    if (membersResult.error) {
      setExternalMembers([]);
      setExternalRawResponse(JSON.stringify({ queries, organization_members_error: membersResult.error }, null, 2));
      toast.error(`Utilisateurs externes: ${membersResult.error.message}`);
      return;
    }

    const memberRows = (membersResult.data ?? []) as Record<string, any>[];
    const memberIds = Array.from(new Set(memberRows.map((member) => member.id).filter(Boolean)));
    const organizationIds = Array.from(new Set(memberRows.map((member) => member.organization_id).filter(Boolean)));

    const profilesResult = memberIds.length
      ? await db
          .from("organization_member_profiles")
          .select(ORGANIZATION_MEMBER_PROFILE_COLUMNS)
          .in("organization_member_id", memberIds)
      : { data: [], error: null };

    const organizationsResult = organizationIds.length
      ? await db
          .from("organizations")
          .select("id,display_name,legal_name,type,status,email,phone,website")
          .in("id", organizationIds)
      : { data: [], error: null };

    const profileRows = (profilesResult.data ?? []) as Record<string, any>[];
    const organizationRows = (organizationsResult.data ?? []) as Record<string, any>[];
    const profileByMemberId = new Map(profileRows.map((profile) => [profile.organization_member_id, profile]));
    const organizationById = new Map(organizationRows.map((organization) => [organization.id, organization]));

    const rows = memberRows.map((member) => {
      const memberProfile = profileByMemberId.get(member.id) ?? null;
      const organization = organizationById.get(member.organization_id) ?? null;
      const authUser = authUserMap.get(member.user_id);
      return {
        member_id: member.id,
        organization_member_profile_id: memberProfile?.id ?? null,
        user_id: member.user_id ?? "",
        organization_id: member.organization_id ?? "",
        email: cleanDisplay(memberProfile?.email) ?? cleanDisplay(authUser?.email),
        full_name: cleanDisplay(memberProfile?.full_name) ?? cleanDisplay(authUser?.full_name),
        phone: cleanDisplay(memberProfile?.phone) ?? cleanDisplay(authUser?.phone),
        secondary_phone: cleanDisplay(memberProfile?.secondary_phone),
        secondary_email: cleanDisplay(memberProfile?.secondary_email),
        position_title: cleanDisplay(memberProfile?.position_title),
        point_of_sale: cleanDisplay(memberProfile?.point_of_sale),
        notes: cleanDisplay(memberProfile?.notes),
        avatar_url: cleanDisplay(authUser?.avatar_url),
        organization_name: cleanDisplay(organization?.display_name) ?? cleanDisplay(organization?.legal_name),
        organization_legal_name: cleanDisplay(organization?.legal_name),
        organization_website: cleanDisplay(organization?.website),
        organization_type: cleanDisplay(organization?.type),
        organization_status: cleanDisplay(organization?.status),
        role: member.role ?? "viewer",
        status: member.status ?? "suspended",
        created_at: member.created_at ?? null,
        raw_member: member,
        raw_profile: memberProfile,
        raw_organization: organization,
      } as ExternalMemberRow;
    });

    const debugPayload = {
      queries,
      organization_members: memberRows,
      organization_member_profiles: profileRows,
      organizations: organizationRows,
      errors: {
        organization_member_profiles: profilesResult.error ?? null,
        organizations: organizationsResult.error ?? null,
      },
      merged_rows: rows,
    };
    console.log("[admin/users external diagnostic]", debugPayload);
    setExternalRawResponse(JSON.stringify(debugPayload, null, 2));
    setExternalMembers(rows);
  };

  const loadUsers = async () => {
    setLoading(true);
    setRawError(null);
    setExternalRequestPayload(null);
    setExternalDebugResponse(null);
    setAdminUsersFunctionVersion(null);

    setExternalRequestPayload(
      JSON.stringify(
        {
          source: "direct Supabase reads",
          tables: ["organization_members", "organization_member_profiles", "organizations"],
        },
        null,
        2
      )
    );

    const [usersResult, visaResult] = await Promise.all([
      supabase.functions.invoke("admin-users", { body: { action: "list" } }),
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

    const authUserMap = new Map<string, any>();
    if (!usersResult.error && usersResult.data) {
      const rawUsers = ((usersResult.data as any)?.users ?? []) as any[];
      rawUsers.forEach((u: any) => authUserMap.set(u.id, u));
    }

    await loadExternalMembersDirect(authUserMap);

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
    const { data, error } = await supabase.functions.invoke("admin-users", {
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
    const temporaryPassword = payload.temporary_password || payload.password || null;
    if (payload.function_version) setAdminUsersFunctionVersion(payload.function_version);
    setResetResult({
      user_id: userId,
      email,
      temporary_password: temporaryPassword,
      email_sent: payload.email_sent ?? null,
      raw: payload,
    });
    setRawError(JSON.stringify(payload, null, 2));
    if (temporaryPassword) toast.warning("Mot de passe provisoire généré. Copiez-le depuis la fenêtre.");
    else toast.success("Mot de passe réinitialisé.");
  };

  const copyTemporaryPassword = async () => {
    if (!resetResult?.temporary_password) return;
    try {
      await navigator.clipboard.writeText(resetResult.temporary_password);
      toast.success("Mot de passe copié.");
    } catch {
      toast.error("Copie impossible. Sélectionnez le mot de passe manuellement.");
    }
  };

  const saveProfile = async () => {
    if (!profileEdit) return;
    setBusy(true);

    if (profileEdit.isExternal) {
      if (!profileEdit.member_id || !profileEdit.organization_id) {
        setBusy(false);
        toast.error("Membre organisation introuvable pour ce profil.");
        return;
      }

      const profilePayload = {
        organization_member_id: profileEdit.member_id,
        user_id: profileEdit.user_id,
        organization_id: profileEdit.organization_id,
        full_name: profileEdit.full_name.trim() || null,
        email: profileEdit.email.trim() || null,
        phone: profileEdit.phone.trim() || null,
        secondary_phone: profileEdit.secondary_phone.trim() || null,
        secondary_email: profileEdit.secondary_email.trim() || null,
        position_title: profileEdit.position_title.trim() || null,
        point_of_sale: profileEdit.point_of_sale.trim() || null,
        notes: profileEdit.notes.trim() || null,
      };

      const profileRequest = profileEdit.organization_member_profile_id
        ? db
            .from("organization_member_profiles")
            .update(profilePayload)
            .eq("id", profileEdit.organization_member_profile_id)
            .select(ORGANIZATION_MEMBER_PROFILE_COLUMNS)
            .maybeSingle()
        : db
            .from("organization_member_profiles")
            .upsert(profilePayload, { onConflict: "organization_member_id" })
            .select(ORGANIZATION_MEMBER_PROFILE_COLUMNS)
            .maybeSingle();

      const { data: savedProfile, error: profileError } = await profileRequest;
      if (profileError) {
        setBusy(false);
        setRawError(JSON.stringify({ table: "organization_member_profiles", payload: profilePayload, error: profileError }, null, 2));
        toast.error(profileError.message);
        return;
      }

      const memberPatch: Record<string, string> = {};
      if (profileEdit.role) memberPatch.role = profileEdit.role;
      if (profileEdit.status) memberPatch.status = profileEdit.status;
      if (Object.keys(memberPatch).length > 0) {
        const { error: memberError } = await db.from("organization_members").update(memberPatch).eq("id", profileEdit.member_id);
        if (memberError) {
          setBusy(false);
          setRawError(JSON.stringify({ saved_profile: savedProfile, organization_members_error: memberError }, null, 2));
          toast.error(memberError.message);
          return;
        }
      }

      setRawError(JSON.stringify({ saved_organization_member_profile: savedProfile }, null, 2));
    } else {
      const { data: profileData, error } = await supabase.functions.invoke("admin-users", {
        body: {
          action: "update_profile",
          user_id: profileEdit.user_id,
          full_name: profileEdit.full_name,
          phone: profileEdit.phone,
        },
      });
      if (error) {
        setBusy(false);
        toast.error(await functionErrorMessage(error));
        return;
      }
      const payload = (profileData ?? {}) as any;
      if (payload.warnings?.length) {
        setRawError(JSON.stringify(payload, null, 2));
        toast.warning("Profil mis à jour avec avertissement. Vérifiez la réponse brute.");
      }
    }

    toast.success("Profil mis à jour.");
    setProfileEdit(null);
    await loadUsers();
    setBusy(false);
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

  const openDeleteAction = (action: DeleteAction) => {
    setDeleteAction(action);
    setDeleteConfirm("");
  };

  const runDeleteAction = async () => {
    if (!deleteAction || deleteConfirm !== "DELETE") return;

    const requestPayload = {
      action: deleteAction.action,
      user_id: deleteAction.user_id,
      member_id: deleteAction.member_id,
      remove_memberships: deleteAction.remove_memberships,
    };

    setBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-users", {
      body: requestPayload,
    });
    setBusy(false);

    if (error) {
      const body = await readFunctionError(error);
      const message = await functionErrorMessage(error);
      setRawError(JSON.stringify({ request: requestPayload, response: body ?? { error: message } }, null, 2));
      toast.error(message);
      return;
    }

    const payload = (data ?? {}) as any;
    setRawError(JSON.stringify({ request: requestPayload, response: payload }, null, 2));

    if (payload.success === false) {
      const reasons = (payload.blocked_reasons ?? []).join(", ") || payload.error || "Action bloquée.";
      toast.error(`Action bloquée: ${reasons}`);
      return;
    }

    toast.success("Action de nettoyage exécutée.");
    setDeleteAction(null);
    setDeleteConfirm("");
    loadUsers();
  };

  const openProfileEdit = (userId: string, fullName?: string | null, phone?: string | null) => {
    setProfileEdit({
      user_id: userId,
      organization_id: null,
      organization_member_profile_id: null,
      email: "",
      full_name: fullName ?? "",
      phone: phone ?? "",
      secondary_phone: "",
      secondary_email: "",
      position_title: "",
      point_of_sale: "",
      notes: "",
      role: "viewer",
      status: "active",
      isExternal: false,
    });
  };

  const openExternalProfileEdit = (member: ExternalMemberRow) => {
    setProfileEdit({
      user_id: member.user_id,
      member_id: member.member_id,
      organization_id: member.organization_id,
      organization_member_profile_id: member.organization_member_profile_id,
      email: member.email ?? "",
      organization_name: member.organization_name || member.organization_legal_name || member.organization_id,
      full_name: member.full_name ?? "",
      phone: member.phone ?? "",
      secondary_phone: member.secondary_phone ?? "",
      secondary_email: member.secondary_email ?? "",
      position_title: member.position_title ?? "",
      point_of_sale: member.point_of_sale ?? "",
      notes: member.notes ?? "",
      role: member.role,
      status: member.status,
      isExternal: true,
    });
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
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            openDeleteAction({
                              title: "Supprimer définitivement ce staff ?",
                              label: staff.full_name || staff.email || staff.id,
                              description:
                                externalMembers.some((member) => member.user_id === staff.id)
                                  ? "Les rôles internes seront supprimés, les appartenances organisation seront retirées, puis le compte Auth sera supprimé. L'action sera bloquée si ce compte est le dernier super admin ou possède des demandes visa."
                                  : "Les rôles internes seront supprimés puis le compte Auth sera supprimé. L'action sera bloquée si ce compte est le dernier super admin ou possède des demandes visa.",
                              action: "delete_user_safely",
                              user_id: staff.id,
                              remove_memberships: externalMembers.some((member) => member.user_id === staff.id),
                            })
                          }
                          disabled={busy || staff.id === user?.id}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Supprimer
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
          <Collapsible open={externalDebugOpen} onOpenChange={setExternalDebugOpen} className="mb-3">
            <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 px-4 py-3 text-sm">
              <p className="text-muted-foreground">
                Profils externes fusionnés: <span className="font-semibold text-foreground">{externalMembers.length}</span>
              </p>
              <CollapsibleTrigger asChild>
                <Button variant="outline" size="sm">Debug</Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="space-y-3 rounded-b-lg border-x border-b border-border bg-secondary/20 px-4 py-3 text-sm text-muted-foreground">
              {externalRequestPayload && (
                <div>
                  <p className="font-medium text-foreground">Payload envoyé à admin-users</p>
                  <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-background p-3 text-xs text-muted-foreground">
                    {externalRequestPayload}
                  </pre>
                </div>
              )}
              {externalDebugResponse && (
                <div>
                  <p className="font-medium text-foreground">Réponse debug_echo</p>
                  <pre className="mt-1 max-h-56 overflow-auto rounded-md bg-background p-3 text-xs text-muted-foreground">
                    {externalDebugResponse}
                  </pre>
                </div>
              )}
              {externalRawResponse && (
                <div>
                  <p className="font-medium text-foreground">Rows brutes stable V2</p>
                  <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-background p-3 text-xs text-muted-foreground">
                    {externalRawResponse}
                  </pre>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
          <Card className="overflow-hidden">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-secondary/50">
                <tr className="text-left">
                  <th className="p-4 font-semibold">Utilisateur</th>
                  <th className="p-4 font-semibold">Contact agence</th>
                  <th className="p-4 font-semibold">Organisation</th>
                  <th className="p-4 font-semibold">Rôle organisation</th>
                  <th className="p-4 font-semibold">Statut membre</th>
                  <th className="p-4 font-semibold">Créé le</th>
                  <th className="p-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Chargement…</td></tr>}
                {!loading && externalMembers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="space-y-3 p-8 text-center text-muted-foreground">
                      <p>Aucun utilisateur externe.</p>
                    </td>
                  </tr>
                )}
                {externalMembers.map((member) => {
                  const authUser = usersById.get(member.user_id);
                  const displayName = member.full_name ?? authUser?.full_name ?? member.user_id;
                  const displayEmail = member.email ?? authUser?.email;
                  const organizationLabel = member.organization_name || member.organization_legal_name || member.organization_id;
                  const organizationMeta = [member.organization_type, member.organization_status, member.organization_website].filter(Boolean).join(" · ");

                  return (
                  <tr key={member.member_id} className="align-top hover:bg-secondary/30">
                    <td className="p-4">
                      <div className="flex items-start gap-3">
                        {member.avatar_url ? (
                          <img src={member.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                        ) : (
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-muted-foreground">
                            {displayName.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-medium">{displayName}</p>
                          <p className="break-all text-xs text-muted-foreground">{displayEmail || "Email non renseigné"}</p>
                        </div>
                      </div>
                      {usersById.get(member.user_id)?.roles?.length ? (
                        <Badge variant="outline" className="mt-2 border-amber-200 bg-amber-50 text-amber-800">Accès mixte interne + organisation</Badge>
                      ) : null}
                    </td>
                    <td className="p-4">
                      <p className="font-medium">{member.phone || "Téléphone non renseigné"}</p>
                      <p className="text-xs text-muted-foreground">{member.secondary_phone || "Téléphone secondaire —"}</p>
                      <p className="mt-2 text-xs text-muted-foreground">{member.position_title || "Fonction —"}</p>
                      <p className="text-xs text-muted-foreground">{member.point_of_sale || "Point de vente —"}</p>
                    </td>
                    <td className="p-4">
                      <p className="font-medium">{organizationLabel}</p>
                      <p className="text-xs text-muted-foreground">{organizationMeta || "Informations organisation non renseignées"}</p>
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
                        <Button size="sm" variant="outline" onClick={() => openExternalProfileEdit(member)}>
                          <Edit className="h-3.5 w-3.5" />
                          Profil
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => resetPassword(member.user_id, displayEmail)} disabled={busy}>
                          <KeyRound className="h-3.5 w-3.5" />
                          Réinitialiser
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            openDeleteAction({
                              title: "Retirer ce membre de l'organisation ?",
                              label: displayName,
                              description: "Seule l'appartenance à cette organisation sera supprimée. Le compte Auth restera disponible s'il existe.",
                              action: "remove_organization_member",
                              member_id: member.member_id,
                            })
                          }
                          disabled={busy}
                        >
                          <UserX className="h-3.5 w-3.5" />
                          Retirer
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            openDeleteAction({
                              title: "Supprimer définitivement cet utilisateur externe ?",
                              label: displayName,
                              description:
                                "Toutes ses appartenances organisation seront retirées, puis le compte Auth sera supprimé. L'action sera bloquée si ce compte possède des rôles internes ou des demandes visa.",
                              action: "delete_external_user_safely",
                              user_id: member.user_id,
                            })
                          }
                          disabled={busy || member.user_id === user?.id}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Supprimer compte
                        </Button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
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
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" onClick={() => resetPassword(visa.user_id, authUser.email || visa.residential_email)} disabled={busy}>
                              <KeyRound className="h-3.5 w-3.5" />
                              Réinitialiser
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() =>
                                openDeleteAction({
                                  title: "Désactiver l'accès Auth de ce client visa ?",
                                  label: authUser.email || visa.residential_email || visa.user_id,
                                  description:
                                    "Le compte Auth sera désactivé, mais les demandes visa ne seront pas supprimées. Utilisez cette option pour retirer l'accès sans perdre l'historique.",
                                  action: "deactivate_user",
                                  user_id: visa.user_id,
                                })
                              }
                              disabled={busy || visa.user_id === user?.id}
                            >
                              <ShieldOff className="h-3.5 w-3.5" />
                              Désactiver
                            </Button>
                          </div>
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
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{profileEdit?.isExternal ? "Profil utilisateur externe" : "Modifier le profil"}</DialogTitle>
          </DialogHeader>
          {profileEdit && (
            <div className="space-y-4">
              {profileEdit.isExternal && (
                <div className="rounded-lg border border-border bg-secondary/30 p-4 text-sm">
                  <p className="font-medium">{profileEdit.organization_name || "Organisation"}</p>
                  <p className="text-xs text-muted-foreground">{profileEdit.email || "Email non renseigné"}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Les champs additionnels sont stockés dans <span className="font-mono">organization_member_profiles</span>.
                  </p>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="profile_full_name">Nom complet</Label>
                  <Input id="profile_full_name" value={profileEdit.full_name} onChange={(event) => setProfileEdit({ ...profileEdit, full_name: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="profile_phone">Téléphone</Label>
                  <Input id="profile_phone" value={profileEdit.phone} onChange={(event) => setProfileEdit({ ...profileEdit, phone: event.target.value })} />
                </div>
              </div>

              {profileEdit.isExternal && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="secondary_phone">Téléphone secondaire</Label>
                      <Input id="secondary_phone" value={profileEdit.secondary_phone} onChange={(event) => setProfileEdit({ ...profileEdit, secondary_phone: event.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="secondary_email">Email secondaire</Label>
                      <Input id="secondary_email" type="email" value={profileEdit.secondary_email} onChange={(event) => setProfileEdit({ ...profileEdit, secondary_email: event.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="position_title">Fonction / titre</Label>
                      <Input id="position_title" value={profileEdit.position_title} onChange={(event) => setProfileEdit({ ...profileEdit, position_title: event.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="point_of_sale">Point de vente</Label>
                      <Input id="point_of_sale" value={profileEdit.point_of_sale} onChange={(event) => setProfileEdit({ ...profileEdit, point_of_sale: event.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Rôle organisation</Label>
                      <Select value={profileEdit.role} onValueChange={(value) => setProfileEdit({ ...profileEdit, role: value })}>
                        <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ORG_ROLES.map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Statut membre</Label>
                      <Select value={profileEdit.status} onValueChange={(value) => setProfileEdit({ ...profileEdit, status: value })}>
                        <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ORG_STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="external_notes">Notes</Label>
                      <Textarea id="external_notes" rows={4} value={profileEdit.notes} onChange={(event) => setProfileEdit({ ...profileEdit, notes: event.target.value })} />
                    </div>
                  </div>

                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                    <p className="font-semibold">Sécurité mot de passe</p>
                    <p className="mt-1 text-xs">Le mot de passe provisoire est affiché une seule fois après réinitialisation et n'est jamais stocké en base.</p>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-3 bg-background"
                      onClick={() => resetPassword(profileEdit.user_id, profileEdit.email)}
                      disabled={busy}
                    >
                      <KeyRound className="h-4 w-4" />
                      Générer un mot de passe provisoire
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setProfileEdit(null)}>Annuler</Button>
            <Button onClick={saveProfile} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(resetResult)} onOpenChange={(open) => !open && setResetResult(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Mot de passe réinitialisé</DialogTitle>
          </DialogHeader>
          {resetResult && (
            <div className="space-y-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <p className="font-semibold">Utilisateur: {resetResult.email || resetResult.user_id}</p>
                {resetResult.temporary_password ? (
                  <>
                    <Label className="mt-4 block">Temporary password</Label>
                    <div className="mt-2 flex items-center gap-2">
                      <code className="min-w-0 flex-1 break-all rounded-md bg-background px-3 py-2 font-mono text-base">
                        {resetResult.temporary_password}
                      </code>
                      <Button type="button" variant="outline" size="icon" onClick={copyTemporaryPassword} aria-label="Copier le mot de passe">
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="mt-3 text-xs">
                      À communiquer manuellement à l'utilisateur. Il doit changer ce mot de passe après sa connexion.
                    </p>
                  </>
                ) : (
                  <p className="mt-2">
                    Aucun mot de passe provisoire n'a été retourné par la fonction.
                  </p>
                )}
              </div>

              <div>
                <Label>Réponse JSON exacte</Label>
                <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                  {JSON.stringify(resetResult.raw, null, 2)}
                </pre>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setResetResult(null)}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteAction)} onOpenChange={(open) => !open && setDeleteAction(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {deleteAction?.title ?? "Confirmer le nettoyage"}
            </DialogTitle>
          </DialogHeader>
          {deleteAction && (
            <div className="space-y-4">
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
                <p className="font-semibold">{deleteAction.label}</p>
                <p className="mt-2 text-muted-foreground">{deleteAction.description}</p>
              </div>
              <div>
                <Label htmlFor="delete_confirm">Tapez DELETE pour confirmer</Label>
                <Input
                  id="delete_confirm"
                  value={deleteConfirm}
                  onChange={(event) => setDeleteConfirm(event.target.value)}
                  placeholder="DELETE"
                  className="mt-2"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteAction(null)} disabled={busy}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={runDeleteAction} disabled={busy || deleteConfirm !== "DELETE"}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Confirmer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
