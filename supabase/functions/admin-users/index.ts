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
  "external_members",
  "listExternalMembers",
  "list_organization_members",
  "update_profile",
  "reset_password",
  "create_external_user",
  "delete_user_safely",
  "remove_organization_member",
  "delete_external_user_safely",
  "deactivate_user",
];
const EXTERNAL_MEMBER_LIST_ACTIONS = new Set([
  "list_external_members",
  "external_members",
  "listExternalMembers",
  "list_organization_members",
]);
const PROFILE_COLUMNS = "id, full_name, phone";
const PROFILE_COLUMNS_WITH_AVATAR = "id, full_name, phone, avatar_url";
const ORGANIZATION_MEMBER_COLUMNS = "id, organization_id, user_id, role, status, created_at";
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
  const metadata = user?.raw_user_meta_data ?? user?.user_metadata ?? {};
  return (
    cleanString(metadata?.full_name) ??
    cleanString(metadata?.name) ??
    cleanString(metadata?.display_name) ??
    null
  );
}

function authUserPhone(user: any) {
  const metadata = user?.raw_user_meta_data ?? user?.user_metadata ?? {};
  return cleanString(user?.phone) ?? cleanString(metadata?.phone);
}

function authUserAvatar(user: any) {
  const metadata = user?.raw_user_meta_data ?? user?.user_metadata ?? {};
  return cleanString(metadata?.avatar_url) ?? cleanString(metadata?.picture);
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message);
  return String(error ?? "Unknown error");
}

function errorStack(error: unknown) {
  return error instanceof Error ? error.stack ?? null : null;
}

async function countRows(admin: any, table: string, column: string, value: string) {
  const { count, error } = await admin
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(column, value);
  if (error) throw error;
  return count ?? 0;
}

async function getUserRoles(admin: any, userId: string) {
  const { data, error } = await admin.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw error;
  return ((data ?? []) as Array<{ role: string }>).map((row) => row.role);
}

async function getUserMemberships(admin: any, userId: string) {
  const { data, error } = await admin
    .from("organization_members")
    .select("id, organization_id, user_id, role, status, created_at")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; organization_id: string; user_id: string; role: string; status: string; created_at: string | null }>;
}

async function deleteMemberships(admin: any, membershipIds: string[]) {
  if (membershipIds.length === 0) return 0;
  const { error } = await admin.from("organization_members").delete().in("id", membershipIds);
  if (error) throw error;
  return membershipIds.length;
}

async function deleteAuthUser(admin: any, userId: string) {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw error;
}

async function deleteUserRoles(admin: any, userId: string) {
  const { error } = await admin.from("user_roles").delete().eq("user_id", userId);
  if (error) throw error;
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
    const action = (body.action || body.type || body.operation || body.name || body.actionName) as string | undefined;

    if (action === "list") {
      const usersList = await listAllAuthUsers(admin);
      const ids = usersList.map((u) => u.id);
      const { data: roles } = await admin.from("user_roles").select("user_id, role").in("user_id", ids);
      const { data: profiles } = await admin.from("profiles").select(PROFILE_COLUMNS).in("id", ids);
      const users = usersList.map((u) => ({
        id: u.id,
        email: u.email,
        full_name: profiles?.find((p) => p.id === u.id)?.full_name ?? authUserName(u),
        phone: profiles?.find((p) => p.id === u.id)?.phone ?? authUserPhone(u),
        created_at: u.created_at,
        roles: (roles ?? []).filter((r) => r.user_id === u.id).map((r) => r.role),
      }));
      return json({ users });
    }

    if (action && EXTERNAL_MEMBER_LIST_ACTIONS.has(action)) {
      let step = "start";
      const warnings: string[] = [];

      try {
        step = "query organization_members";
        const membersResult: any = await admin
          .from("organization_members")
          .select(ORGANIZATION_MEMBER_COLUMNS)
          .order("created_at", { ascending: false });
        const { data: members, error: membersError } = membersResult as { data: any[] | null; error: any };
        if (membersError) throw membersError;

        const memberRows = members ?? [];
        const memberIds = [...new Set(memberRows.map((member) => member.id).filter(Boolean))];
        const userIds = [...new Set(memberRows.map((member) => member.user_id).filter(Boolean))];
        const organizationIds = [...new Set(memberRows.map((member) => member.organization_id).filter(Boolean))];

        step = "query organization_member_profiles";
        const memberProfilesByMemberId = new Map<string, any>();
        if (memberIds.length > 0) {
          const { data: memberProfiles, error: memberProfilesError } = await admin
            .from("organization_member_profiles")
            .select(ORGANIZATION_MEMBER_PROFILE_COLUMNS)
            .in("organization_member_id", memberIds);
          if (memberProfilesError) {
            warnings.push(`organization_member_profiles enrichment skipped: ${memberProfilesError.message}`);
          } else {
            for (const memberProfile of (memberProfiles ?? []) as any[]) {
              memberProfilesByMemberId.set(memberProfile.organization_member_id, memberProfile);
            }
          }
        }

        step = "query organizations";
        const organizationsById = new Map<string, any>();
        if (organizationIds.length > 0) {
          let organizationsError: any = null;
          let organizations: any[] | null = null;
          const orgResult = await admin
            .from("organizations")
            .select("id, display_name, legal_name, type, status, email, phone, website")
            .in("id", organizationIds);
          if (orgResult.error) {
            warnings.push(`organizations enrichment (full) skipped: ${orgResult.error.message}`);
            const fallbackResult = await admin
              .from("organizations")
              .select("id, display_name, legal_name")
              .in("id", organizationIds);
            organizations = fallbackResult.data;
            organizationsError = fallbackResult.error;
            if (!fallbackResult.error) warnings.push("organizations enrichment recovered with fallback columns.");
          } else {
            organizations = orgResult.data;
          }
          if (organizationsError) {
            warnings.push(`organizations enrichment skipped: ${organizationsError.message}`);
          } else {
            for (const organization of organizations ?? []) {
              organizationsById.set(organization.id, organization);
            }
          }
        }

        step = "resolve auth users";
        const authUsersById = new Map<string, any>();
        if (userIds.length > 0) {
          try {
            const authUsers = await listAllAuthUsers(admin);
            for (const user of authUsers) {
              if (userIds.includes(user.id)) authUsersById.set(user.id, user);
            }
          } catch (authError) {
            warnings.push(`auth users enrichment skipped: ${errorMessage(authError)}`);
          }
        }

        step = "query profiles";
        const profilesById = new Map<string, any>();
        if (userIds.length > 0) {
          let profilesByIdRows: any[] | null = null;
          let profilesByIdError: any = null;
          const profilesByIdResult = await admin
            .from("profiles")
            .select(PROFILE_COLUMNS_WITH_AVATAR)
            .in("id", userIds);
          profilesByIdRows = profilesByIdResult.data;
          profilesByIdError = profilesByIdResult.error;
          if (profilesByIdError) {
            const fallback = await admin
              .from("profiles")
              .select(PROFILE_COLUMNS)
              .in("id", userIds);
            profilesByIdRows = fallback.data;
            profilesByIdError = fallback.error;
            if (!profilesByIdError) warnings.push("profiles.avatar_url unavailable: using profile name/phone fallback.");
          }
          if (profilesByIdError) {
            warnings.push(`profiles.id enrichment skipped: ${profilesByIdError.message}`);
          } else {
            for (const profile of profilesByIdRows ?? []) {
              profilesById.set(profile.id, profile);
            }
          }

          let profilesByUserIdRows: any[] | null = null;
          let profilesByUserIdError: any = null;
          const profilesByUserIdResult = await admin
            .from("profiles")
            .select("user_id, full_name, phone, avatar_url")
            .in("user_id", userIds);
          profilesByUserIdRows = profilesByUserIdResult.data;
          profilesByUserIdError = profilesByUserIdResult.error;
          if (profilesByUserIdError) {
            const fallback = await admin
              .from("profiles")
              .select("user_id, full_name, phone")
              .in("user_id", userIds);
            profilesByUserIdRows = fallback.data;
            profilesByUserIdError = fallback.error;
            if (!profilesByUserIdError) warnings.push("profiles.user_id avatar_url unavailable: using profile name/phone fallback.");
          }
          if (profilesByUserIdError) {
            warnings.push(`profiles.user_id enrichment skipped: ${profilesByUserIdError.message}`);
          } else {
            for (const profile of profilesByUserIdRows ?? []) {
              if (profile.user_id && !profilesById.has(profile.user_id)) {
                profilesById.set(profile.user_id, profile);
              }
            }
          }
        }

        step = "map enriched organization_members";
        const rows = (members ?? []).map((member) => {
          const authUser = authUsersById.get(member.user_id);
          const profile = profilesById.get(member.user_id);
          const memberProfile = memberProfilesByMemberId.get(member.id);
          const organization = organizationsById.get(member.organization_id);
          if (!organization) warnings.push(`organization missing for member ${member.id}: ${member.organization_id}`);
          if (!authUser) warnings.push(`auth user missing for member ${member.id}: ${member.user_id}`);

          const email =
            cleanString(memberProfile?.email) ??
            cleanString(authUser?.email);
          const fullName =
            cleanString(memberProfile?.full_name) ??
            cleanString(profile?.full_name) ??
            authUserName(authUser) ??
            null;
          const phone =
            cleanString(memberProfile?.phone) ??
            cleanString(profile?.phone) ??
            authUserPhone(authUser);
          const avatarUrl =
            cleanString(profile?.avatar_url) ??
            authUserAvatar(authUser);
          const organizationName =
            cleanString(organization?.display_name) ??
            cleanString(organization?.legal_name) ??
            cleanString(member.organization_id);

          return {
            member_id: member.id,
            user_id: member.user_id,
            email,
            full_name: fullName,
            phone,
            organization_member_profile_id: memberProfile?.id ?? null,
            secondary_phone: cleanString(memberProfile?.secondary_phone),
            secondary_email: cleanString(memberProfile?.secondary_email),
            position_title: cleanString(memberProfile?.position_title),
            point_of_sale: cleanString(memberProfile?.point_of_sale),
            notes: cleanString(memberProfile?.notes),
            avatar_url: avatarUrl,
            organization_id: member.organization_id,
            organization_name: organizationName,
            organization_legal_name: organization?.legal_name ?? null,
            organization_website: organization?.website ?? null,
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
          action: "list_external_members",
          success: true,
          count: rows.length,
          rows,
          external_members: rows,
          members: rows,
          items: rows,
          organization_members: rows,
          warnings: [...new Set(warnings)],
        });
      } catch (error) {
        return json({
          action: "list_external_members",
          success: false,
          error: errorMessage(error),
          details: error,
          stack: errorStack(error),
          step,
        }, 200);
      }
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

      const { error: memberProfileError } = await admin.from("organization_member_profiles").upsert({
        organization_member_id: member.id,
        user_id: userId,
        organization_id,
        full_name: cleanName,
        email: normalizedEmail,
        phone: cleanPhone,
      }, { onConflict: "organization_member_id" });
      if (memberProfileError) return json({ error: "organization member profile upsert failed", detail: memberProfileError.message }, 500);

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
      const {
        user_id,
        member_id,
        full_name,
        phone,
        secondary_phone,
        secondary_email,
        position_title,
        point_of_sale,
        notes,
        role,
        status,
      } = body as {
        user_id: string;
        member_id?: string | null;
        full_name?: string | null;
        phone?: string | null;
        secondary_phone?: string | null;
        secondary_email?: string | null;
        position_title?: string | null;
        point_of_sale?: string | null;
        notes?: string | null;
        role?: string | null;
        status?: string | null;
      };
      if (!user_id) return json({ error: "user_id required" }, 400);
      const warnings: string[] = [];
      const { error } = await admin.from("profiles").upsert({
        id: user_id,
        full_name: full_name ?? null,
        phone: phone ?? null,
      });
      if (error) return json({ error: "profile update failed", detail: error.message }, 500);

      try {
        const { data: authUserData } = await admin.auth.admin.getUserById(user_id);
        const authUser = authUserData?.user as any;
        const currentMetadata = authUser?.user_metadata ?? authUser?.raw_user_meta_data ?? {};
        const { error: authUpdateError } = await admin.auth.admin.updateUserById(user_id, {
          user_metadata: {
            ...currentMetadata,
            full_name: full_name ?? currentMetadata.full_name ?? currentMetadata.name ?? "",
            name: full_name ?? currentMetadata.name ?? currentMetadata.full_name ?? "",
            phone: phone ?? currentMetadata.phone ?? "",
          },
        });
        if (authUpdateError) warnings.push(`auth metadata update failed: ${authUpdateError.message}`);
      } catch (authError) {
        warnings.push(`auth metadata update failed: ${errorMessage(authError)}`);
      }

      if (member_id) {
        const memberPatch: Record<string, unknown> = {};
        if (role && ["owner", "admin", "agent", "finance", "operations", "viewer"].includes(role)) memberPatch.role = role;
        if (status && ["active", "suspended"].includes(status)) memberPatch.status = status;

        const { data: memberForProfile, error: memberForProfileError } = await admin
          .from("organization_members")
          .select("id, user_id, organization_id")
          .eq("id", member_id)
          .maybeSingle();
        if (memberForProfileError) {
          warnings.push(`organization_members profile lookup failed: ${memberForProfileError.message}`);
        } else if (memberForProfile) {
          const { data: authUserData } = await admin.auth.admin.getUserById(user_id);
          const profileEmail = cleanString(authUserData?.user?.email);
          const { error: memberProfileError } = await admin.from("organization_member_profiles").upsert({
            organization_member_id: member_id,
            user_id: memberForProfile.user_id,
            organization_id: memberForProfile.organization_id,
            full_name: cleanString(full_name),
            email: profileEmail,
            phone: cleanString(phone),
            secondary_phone: cleanString(secondary_phone),
            secondary_email: cleanString(secondary_email),
            position_title: cleanString(position_title),
            point_of_sale: cleanString(point_of_sale),
            notes: cleanString(notes),
          }, { onConflict: "organization_member_id" });
          if (memberProfileError) warnings.push(`organization_member_profiles update failed: ${memberProfileError.message}`);
        }

        if (Object.keys(memberPatch).length > 0) {
          const { error: memberUpdateError } = await admin.from("organization_members").update(memberPatch).eq("id", member_id);
          if (memberUpdateError) return json({ error: "member role/status update failed", detail: memberUpdateError.message }, 500);
        }
      }

      return json({ ok: true, success: true, warnings });
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
        success: true,
        email_sent: false,
        temporary_password: temporaryPassword,
        password: temporaryPassword,
      });
    }

    if (action === "remove_organization_member") {
      const { member_id } = body as { member_id: string };
      if (!member_id) return json({ error: "member_id required" }, 400);

      const { data: member, error: lookupError } = await admin
        .from("organization_members")
        .select("id, organization_id, user_id, role, status")
        .eq("id", member_id)
        .maybeSingle();
      if (lookupError) return json({ error: "membership lookup failed", detail: lookupError.message }, 500);
      if (!member) return json({ success: true, removed_memberships: 0, warnings: ["membership already missing"] });

      await deleteMemberships(admin, [member_id]);
      return json({
        success: true,
        deleted_user: false,
        removed_memberships: 1,
        removed_member: member,
        blocked_reasons: [],
        warnings: [],
      });
    }

    if (action === "delete_external_user_safely") {
      try {
        const { user_id } = body as { user_id: string };
        if (!user_id) {
          return json({
            success: false,
            deleted_user: false,
            removed_memberships: 0,
            blocked_reasons: ["user_id_required"],
            warnings: [],
          });
        }
        if (user_id === callerId) {
          return json({
            success: false,
            deleted_user: false,
            removed_memberships: 0,
            blocked_reasons: ["current_user"],
            warnings: ["Vous ne pouvez pas supprimer votre propre compte."],
          });
        }

        const warnings: string[] = [];
        const blockedReasons: string[] = [];
        const roles = await getUserRoles(admin, user_id);
        if (roles.length > 0) blockedReasons.push("user_has_internal_roles");

        let visaApplicationsCount = 0;
        try {
          visaApplicationsCount = await countRows(admin, "visa_applications", "user_id", user_id);
          if (visaApplicationsCount > 0) blockedReasons.push("user_has_visa_applications");
        } catch (error) {
          warnings.push(`visa_applications check skipped: ${errorMessage(error)}`);
        }

        if (blockedReasons.length > 0) {
          return json({
            success: false,
            deleted_user: false,
            removed_memberships: 0,
            blocked_reasons: blockedReasons,
            warnings,
            roles,
            visa_applications_count: visaApplicationsCount,
          });
        }

        const memberships = await getUserMemberships(admin, user_id);
        const removedMemberships = await deleteMemberships(admin, memberships.map((member) => member.id));
        await deleteAuthUser(admin, user_id);

        return json({
          success: true,
          deleted_user: true,
          removed_memberships: removedMemberships,
          blocked_reasons: [],
          warnings,
        });
      } catch (error) {
        return json({
          success: false,
          deleted_user: false,
          removed_memberships: 0,
          blocked_reasons: ["delete_external_user_failed"],
          warnings: [errorMessage(error)],
        });
      }
    }

    if (action === "delete_user_safely") {
      const { user_id, remove_memberships } = body as { user_id: string; remove_memberships?: boolean };
      if (!user_id) return json({ error: "user_id required" }, 400);
      if (user_id === callerId) {
        return json({
          success: false,
          deleted_user: false,
          removed_memberships: 0,
          blocked_reasons: ["current_user"],
          warnings: ["Vous ne pouvez pas supprimer votre propre compte."],
        });
      }

      const warnings: string[] = [];
      const blockedReasons: string[] = [];
      const roles = await getUserRoles(admin, user_id);
      const memberships = await getUserMemberships(admin, user_id);

      if (roles.includes("super_admin")) {
        const superAdminCount = await countRows(admin, "user_roles", "role", "super_admin");
        if (superAdminCount <= 1) blockedReasons.push("last_super_admin");
      }

      let visaApplicationsCount = 0;
      try {
        visaApplicationsCount = await countRows(admin, "visa_applications", "user_id", user_id);
        if (visaApplicationsCount > 0) blockedReasons.push("user_has_visa_applications");
      } catch (error) {
        warnings.push(`visa_applications check skipped: ${errorMessage(error)}`);
      }

      if (memberships.length > 0 && !remove_memberships) blockedReasons.push("user_has_organization_memberships");

      if (blockedReasons.length > 0) {
        return json({
          success: false,
          deleted_user: false,
          removed_memberships: 0,
          blocked_reasons: blockedReasons,
          warnings,
          roles,
          memberships_count: memberships.length,
          visa_applications_count: visaApplicationsCount,
        });
      }

      const removedMemberships = await deleteMemberships(admin, memberships.map((member) => member.id));
      await deleteUserRoles(admin, user_id);
      await deleteAuthUser(admin, user_id);

      return json({
        success: true,
        deleted_user: true,
        removed_memberships: removedMemberships,
        blocked_reasons: [],
        warnings,
      });
    }

    if (action === "deactivate_user") {
      const { user_id } = body as { user_id: string };
      if (!user_id) return json({ error: "user_id required" }, 400);
      if (user_id === callerId) return json({ error: "Vous ne pouvez pas désactiver votre propre compte." }, 400);

      const { error } = await admin.auth.admin.updateUserById(user_id, {
        ban_duration: "876000h",
      });
      if (error) return json({ error: "user deactivation failed", detail: error.message }, 500);
      return json({
        success: true,
        deactivated_user: true,
        deleted_user: false,
        removed_memberships: 0,
        blocked_reasons: [],
        warnings: [],
      });
    }

    if (action === "delete") {
      const { user_id } = body as { user_id: string };
      if (user_id === callerId) return json({ error: "Vous ne pouvez pas vous supprimer." }, 400);
      const { error } = await admin.auth.admin.deleteUser(user_id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({
      error: "Unknown action",
      received_body: body,
      normalized_action: action ?? null,
      supported_actions: SUPPORTED_ACTIONS,
    }, 400);
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
