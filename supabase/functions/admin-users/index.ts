import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Role = "super_admin" | "admin" | "manager" | "agent" | "content_manager" | "supplier" | "marketing_manager";

const FUNCTION_VERSION = "admin-users-v2-recovery";
const SUPPORTED_ACTIONS = [
  "list",
  "create",
  "set_roles",
  "delete",
  "list_external_members",
  "update_profile",
  "reset_password",
  "create_external_user",
];
const PROFILE_COLUMNS = "id, full_name, phone";

function makeTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

async function listAllAuthUsers(admin: any) {
  const usersList: any[] = [];
  const perPage = 1000;
  let page = 1;
  while (true) {
    const { data: list, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    usersList.push(...list.users);
    if (list.users.length < perPage) break;
    page += 1;
  }
  return usersList;
}

function cleanString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function authUserName(user: any) {
  return (
    cleanString(user?.user_metadata?.full_name) ??
    cleanString(user?.user_metadata?.name) ??
    cleanString(user?.user_metadata?.display_name) ??
    null
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const callerId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE);

    // Caller must be super_admin. Support both legacy and newer helper names.
    let isSuper = false;
    const { data: isSuperViaIsSuperAdmin, error: isSuperAdminError } = await admin.rpc("is_super_admin", { _user_id: callerId });
    if (!isSuperAdminError) isSuper = Boolean(isSuperViaIsSuperAdmin);
    if (!isSuper) {
      const { data: isSuperViaHasRole, error: hasRoleError } = await admin.rpc("has_role", { _user_id: callerId, _role: "super_admin" });
      if (!hasRoleError) isSuper = Boolean(isSuperViaHasRole);
    }
    if (!isSuper) return json({ error: "Forbidden — super_admin only" }, 403);

    const body = await req.json();
    const action = body.action as string;

    if (action === "list") {
      const usersList = await listAllAuthUsers(admin);
      const ids = usersList.map((u) => u.id);
      const { data: roles } = await admin.from("user_roles").select("user_id, role").in("user_id", ids);
      const { data: profiles } = await admin.from("profiles").select(PROFILE_COLUMNS).in("id", ids);
      const users = usersList.map((u) => ({
        id: u.id,
        email: u.email,
        full_name: profiles?.find((p) => p.id === u.id)?.full_name ?? authUserName(u),
        phone: profiles?.find((p) => p.id === u.id)?.phone ?? null,
        created_at: u.created_at,
        roles: (roles ?? []).filter((r) => r.user_id === u.id).map((r) => r.role),
      }));
      return json({ users });
    }

    if (action === "list_external_members") {
      const usersList = await listAllAuthUsers(admin);

      const { data: members, error: membersError } = await admin
        .from("organization_members")
        .select("id, organization_id, user_id, role, status, created_at");
      if (membersError) return json({ error: "organization_members query failed", detail: membersError.message }, 500);

      const userIds = Array.from(new Set((members ?? []).map((m) => m.user_id).filter(Boolean)));
      const orgIds = Array.from(new Set((members ?? []).map((m) => m.organization_id).filter(Boolean)));
      const { data: profiles } = userIds.length
        ? await admin.from("profiles").select(PROFILE_COLUMNS).in("id", userIds)
        : { data: [] };
      const { data: organizations } = orgIds.length
        ? await admin.from("organizations").select("id, display_name, type, status").in("id", orgIds)
        : { data: [] };

      const authById = new Map(usersList.map((u) => [u.id, u]));
      const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
      const organizationById = new Map((organizations ?? []).map((o) => [o.id, o]));

      const external_members = (members ?? []).map((member) => {
        const authUser = authById.get(member.user_id);
        const profile = profileById.get(member.user_id);
        const organization = organizationById.get(member.organization_id);
        const email = authUser?.email ?? null;
        return {
          member_id: member.id,
          user_id: member.user_id,
          email,
          full_name: profile?.full_name ?? authUserName(authUser) ?? email,
          phone: profile?.phone ?? null,
          organization_id: member.organization_id,
          organization_name: organization?.display_name ?? null,
          organization_type: organization?.type ?? null,
          organization_status: organization?.status ?? null,
          member_role: member.role,
          member_status: member.status,
          role: member.role,
          status: member.status,
          created_at: member.created_at,
        };
      });

      return json({
        external_members,
        count: external_members.length,
        debug: {
          organization_members_count: members?.length ?? 0,
          auth_users_count: usersList.length,
          profiles_count: profiles?.length ?? 0,
          organizations_count: organizations?.length ?? 0,
        },
      });
    }

    if (action === "create") {
      const { email, password, full_name, roles } = body as {
        email: string; password: string; full_name?: string; roles?: Role[];
      };
      const { data: created, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { full_name: full_name ?? "" },
      });
      if (error) throw error;
      const newId = created.user!.id;
      // Profile is created by trigger; ensure full_name set
      if (full_name) {
        await admin.from("profiles").upsert({ id: newId, full_name });
      }
      if (roles?.length) {
        await admin.from("user_roles").insert(roles.map((role) => ({ user_id: newId, role })));
      }
      return json({ user_id: newId });
    }

    if (action === "create_external_user") {
      const { organization_id, email, full_name, phone, role } = body as {
        organization_id: string;
        email: string;
        full_name?: string | null;
        phone?: string | null;
        role?: string | null;
      };

      const normalizedEmail = cleanString(email)?.toLowerCase();
      if (!organization_id) return json({ error: "organization_id required" }, 400);
      if (!normalizedEmail) return json({ error: "email required" }, 400);

      const allowedRoles = ["owner", "admin", "agent", "finance", "operations", "viewer"];
      const organizationRole = allowedRoles.includes(role ?? "") ? role : "agent";

      const { data: organization, error: organizationError } = await admin
        .from("organizations")
        .select("id, display_name, type, status")
        .eq("id", organization_id)
        .maybeSingle();
      if (organizationError) return json({ error: "organization lookup failed", detail: organizationError.message }, 500);
      if (!organization) return json({ error: "organization not found" }, 404);

      const usersList = await listAllAuthUsers(admin);
      let authUser = usersList.find((user) => String(user.email ?? "").toLowerCase() === normalizedEmail);
      let temporaryPassword: string | null = null;
      let createdAuthUser = false;

      if (!authUser) {
        temporaryPassword = makeTemporaryPassword();
        const { data: created, error } = await admin.auth.admin.createUser({
          email: normalizedEmail,
          password: temporaryPassword,
          email_confirm: true,
          user_metadata: { full_name: full_name ?? "" },
        });
        if (error) return json({ error: "auth user creation failed", detail: error.message }, 500);
        authUser = created.user;
        createdAuthUser = true;
      }

      const userId = authUser?.id;
      if (!userId) return json({ error: "auth user id missing after create/reuse" }, 500);

      const profilePayload: Record<string, string | null> = { id: userId };
      const cleanName = cleanString(full_name);
      const cleanPhone = cleanString(phone);
      if (cleanName !== null) profilePayload.full_name = cleanName;
      if (cleanPhone !== null) profilePayload.phone = cleanPhone;
      if (Object.keys(profilePayload).length > 1) {
        const { error: profileError } = await admin.from("profiles").upsert(profilePayload);
        if (profileError) return json({ error: "profile upsert failed", detail: profileError.message }, 500);
      }

      const { data: existingMember, error: existingMemberError } = await admin
        .from("organization_members")
        .select("id, organization_id, user_id, role, status, created_at")
        .eq("organization_id", organization_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (existingMemberError) return json({ error: "membership lookup failed", detail: existingMemberError.message }, 500);

      let member = existingMember;
      if (!member) {
        const { data: insertedMember, error: memberError } = await admin
          .from("organization_members")
          .insert({
            organization_id,
            user_id: userId,
            role: organizationRole,
            status: "active",
            created_by: callerId,
          })
          .select("id, organization_id, user_id, role, status, created_at")
          .single();
        if (memberError) return json({ error: "organization member insert failed", detail: memberError.message }, 500);
        member = insertedMember;
      }

      return json({
        ok: true,
        user_id: userId,
        member_id: member.id,
        organization_id,
        organization_name: organization.display_name,
        member_role: member.role,
        member_status: member.status,
        created_auth_user: createdAuthUser,
        reused_user: !createdAuthUser,
        email_sent: false,
        temporary_password: temporaryPassword,
        message: temporaryPassword
          ? "External user created. Communicate the temporary password manually."
          : "Existing auth user added/reused. No password was changed.",
      });
    }

    if (action === "set_roles") {
      const { user_id, roles } = body as { user_id: string; roles: Role[] };
      await admin.from("user_roles").delete().eq("user_id", user_id);
      if (roles?.length) {
        await admin.from("user_roles").insert(roles.map((role) => ({ user_id, role })));
      }
      return json({ ok: true });
    }

    if (action === "update_profile") {
      const { user_id, full_name, phone } = body as { user_id: string; full_name?: string | null; phone?: string | null };
      if (!user_id) return json({ error: "user_id required" }, 400);
      const { error } = await admin.from("profiles").upsert({
        id: user_id,
        full_name: full_name ?? null,
        phone: phone ?? null,
      });
      if (error) return json({ error: "profile update failed", detail: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "reset_password") {
      const { user_id } = body as { user_id: string };
      if (!user_id) return json({ error: "user_id required" }, 400);
      if (user_id === callerId) return json({ error: "Vous ne pouvez pas réinitialiser votre propre mot de passe ici." }, 400);
      const temporaryPassword = makeTemporaryPassword();
      const { error } = await admin.auth.admin.updateUserById(user_id, {
        password: temporaryPassword,
        email_confirm: true,
      });
      if (error) return json({ error: "password reset failed", detail: error.message }, 500);
      return json({
        ok: true,
        email_sent: false,
        temporary_password: temporaryPassword,
        message: "Temporary password generated. Communicate it manually to the user.",
      });
    }

    if (action === "delete") {
      const { user_id } = body as { user_id: string };
      if (user_id === callerId) return json({ error: "Vous ne pouvez pas vous supprimer." }, 400);
      const { error } = await admin.auth.admin.deleteUser(user_id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Unknown action", received_action: action ?? null, supported_actions: SUPPORTED_ACTIONS }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  const enriched =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? { function_version: FUNCTION_VERSION, ...payload }
      : payload;
  return new Response(JSON.stringify(enriched), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
