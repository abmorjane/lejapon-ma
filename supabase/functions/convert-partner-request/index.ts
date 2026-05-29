import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const function_version = "convert-partner-request-v2-debug";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Warning = {
  step: string;
  message: string;
  detail?: unknown;
};

type PartnerRequest = {
  id: string;
  agency_name: string;
  manager_name: string | null;
  email: string | null;
  phone: string | null;
  city_country: string | null;
  website_social: string | null;
  partnership_type: string | null;
  message: string | null;
  status: string | null;
};

function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify({ function_version, ...payload }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function warn(warnings: Warning[], step: string, message: string, detail?: unknown) {
  const entry = { step, message, detail };
  warnings.push(entry);
  console.warn(`[${function_version}] ${step}: ${message}`, detail ?? "");
}

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function makeTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function splitCityCountry(value: string | null) {
  const text = String(value ?? "").trim();
  if (!text) return { city: null, country: null };
  const parts = text.split(/[,/|-]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return { city: parts[0], country: parts.slice(1).join(", ") };
  return { city: text, country: null };
}

async function callerIsInternal(admin: any, callerId: string) {
  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", callerId)
    .in("role", ["super_admin", "admin"]);
  if (error) return { ok: false, isSuperAdmin: false, error };
  const roles = (data ?? []).map((row: any) => row.role);
  return {
    ok: roles.includes("super_admin") || roles.includes("admin"),
    isSuperAdmin: roles.includes("super_admin"),
    error: null,
  };
}

async function findAuthUserByEmail(admin: any, email: string) {
  const target = normalizeEmail(email);
  const perPage = 1000;
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = data.users.find((user: any) => normalizeEmail(user.email) === target);
    if (found) return found;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

async function maybeSingleOrNull(query: any) {
  const { data, error } = await query.maybeSingle();
  if (error) return { data: null, error };
  return { data, error: null };
}

async function findOnboardingCase(admin: any, requestId: string, warnings: Warning[]) {
  const byRequest = await maybeSingleOrNull(
    admin
      .from("partner_onboarding_cases")
      .select("*")
      .eq("partner_request_id", requestId)
      .order("created_at", { ascending: false })
      .limit(1)
  );
  if (!byRequest.error) return byRequest.data;
  warn(warnings, "find_onboarding_case", "Could not query by partner_request_id", byRequest.error.message);
  return null;
}

async function findOrganization(admin: any, request: PartnerRequest, existingCase: any, warnings: Warning[]) {
  if (existingCase?.organization_id) {
    const byCase = await maybeSingleOrNull(
      admin.from("organizations").select("*").eq("id", existingCase.organization_id)
    );
    if (!byCase.error && byCase.data) return byCase.data;
    if (byCase.error) warn(warnings, "find_organization_by_case", byCase.error.message);
  }

  const byMetadata = await maybeSingleOrNull(
    admin
      .from("organizations")
      .select("*")
      .contains("metadata", { partner_request_id: request.id })
      .limit(1)
  );
  if (!byMetadata.error && byMetadata.data) return byMetadata.data;
  if (byMetadata.error) warn(warnings, "find_organization_by_metadata", byMetadata.error.message);

  const safeName = String(request.agency_name ?? "").trim();
  const safeEmail = normalizeEmail(request.email);
  if (safeEmail) {
    const byEmail = await maybeSingleOrNull(
      admin
        .from("organizations")
        .select("*")
        .eq("type", "agency")
        .eq("email", safeEmail)
        .limit(1)
    );
    if (!byEmail.error && byEmail.data) return byEmail.data;
  }

  if (safeName) {
    const byName = await maybeSingleOrNull(
      admin
        .from("organizations")
        .select("*")
        .eq("type", "agency")
        .eq("display_name", safeName)
        .limit(1)
    );
    if (!byName.error && byName.data) return byName.data;
  }

  return null;
}

async function createOrganization(admin: any, request: PartnerRequest, warnings: Warning[]) {
  const { city, country } = splitCityCountry(request.city_country);
  const payload = {
    type: "agency",
    status: "suspended",
    display_name: request.agency_name,
    legal_name: request.agency_name,
    email: normalizeEmail(request.email) || null,
    phone: request.phone,
    website: request.website_social,
    city,
    country,
    notes: request.message,
    metadata: {
      partner_request_id: request.id,
      partnership_type: request.partnership_type,
      source: "convert-partner-request",
      function_version,
    },
  };
  const { data, error } = await admin.from("organizations").insert(payload).select("*").single();
  if (error) {
    warn(warnings, "create_organization", error.message);
    return null;
  }
  return data;
}

async function ensureOrganizationSuspended(admin: any, organization: any, existingCase: any, warnings: Warning[]) {
  const onboardingApproved = String(existingCase?.status ?? "").toLowerCase() === "approved";
  if (!organization?.id || organization.status === "suspended" || onboardingApproved) return organization;
  const { data, error } = await admin
    .from("organizations")
    .update({ status: "suspended" })
    .eq("id", organization.id)
    .select("*")
    .single();
  if (error) {
    warn(warnings, "suspend_organization", error.message);
    return organization;
  }
  return data;
}

async function ensureAgencyProfile(admin: any, organizationId: string, request: PartnerRequest, warnings: Warning[]) {
  const existing = await maybeSingleOrNull(
    admin.from("agency_profiles").select("organization_id").eq("organization_id", organizationId)
  );
  if (!existing.error && existing.data) return true;

  const payload = {
    organization_id: organizationId,
    commercial_name: request.agency_name,
    contact_name: request.manager_name,
    contact_email: normalizeEmail(request.email) || null,
    contact_phone: request.phone,
    website: request.website_social,
    market_country: request.city_country,
    commercial_notes: request.message,
    notes: `Created from partner request ${request.id}`,
  };
  const { error } = await admin.from("agency_profiles").insert(payload);
  if (error) {
    warn(warnings, "ensure_agency_profile", error.message);
    return false;
  }
  return true;
}

async function ensureAuthUser(admin: any, request: PartnerRequest, warnings: Warning[]) {
  const email = normalizeEmail(request.email);
  if (!email) {
    warn(warnings, "ensure_auth_user", "Partner request has no email");
    return { user: null, temporaryPassword: null };
  }

  const existing = await findAuthUserByEmail(admin, email);
  if (existing) return { user: existing, temporaryPassword: null };

  const temporaryPassword = makeTemporaryPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { full_name: request.manager_name ?? request.agency_name ?? "" },
  });
  if (error) {
    warn(warnings, "create_auth_user", error.message);
    const retryExisting = await findAuthUserByEmail(admin, email);
    return { user: retryExisting, temporaryPassword: retryExisting ? null : temporaryPassword };
  }

  return { user: data.user, temporaryPassword };
}

async function ensureProfile(admin: any, userId: string, request: PartnerRequest, warnings: Warning[]) {
  const { error } = await admin.from("profiles").upsert({
    id: userId,
    full_name: request.manager_name ?? null,
    phone: request.phone ?? null,
  });
  if (error) warn(warnings, "ensure_profile", error.message);
}

async function ensureMember(admin: any, organizationId: string, userId: string, callerId: string, warnings: Warning[]) {
  const existing = await maybeSingleOrNull(
    admin
      .from("organization_members")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .limit(1)
  );
  if (!existing.error && existing.data) {
    if (existing.data.status !== "active") {
      const { data, error } = await admin
        .from("organization_members")
        .update({ status: "active" })
        .eq("id", existing.data.id)
        .select("*")
        .single();
      if (!error && data) return data;
      if (error) warn(warnings, "reactivate_member", error.message);
    }
    return existing.data;
  }

  const { data, error } = await admin
    .from("organization_members")
    .insert({
      organization_id: organizationId,
      user_id: userId,
      role: "owner",
      status: "active",
      created_by: callerId,
    })
    .select("*")
    .single();
  if (error) {
    warn(warnings, "create_member", error.message);
    return null;
  }
  return data;
}

async function createOnboardingCaseWithFallbacks(admin: any, organizationId: string, requestId: string, callerId: string, warnings: Warning[]) {
  const attempts = [
    { organization_id: organizationId, partner_request_id: requestId, status: "draft", created_by: callerId },
    { organization_id: organizationId, partner_request_id: requestId, status: "draft" },
    { organization_id: organizationId, partner_request_id: requestId },
    { organization_id: organizationId, status: "draft", created_by: callerId },
    { organization_id: organizationId, status: "draft" },
    { organization_id: organizationId },
  ];

  for (const payload of attempts) {
    const { data, error } = await admin.from("partner_onboarding_cases").insert(payload).select("*").single();
    if (!error && data) return data;
    warn(warnings, "create_onboarding_case_attempt", error?.message ?? "Unknown insert error", payload);
  }
  return null;
}

async function ensureOnboardingCase(admin: any, organizationId: string, requestId: string, callerId: string, existingCase: any, warnings: Warning[]) {
  if (existingCase?.id) return existingCase;

  const byOrganization = await maybeSingleOrNull(
    admin
      .from("partner_onboarding_cases")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(1)
  );
  if (!byOrganization.error && byOrganization.data) return byOrganization.data;
  if (byOrganization.error) warn(warnings, "find_onboarding_case_by_org", byOrganization.error.message);

  return await createOnboardingCaseWithFallbacks(admin, organizationId, requestId, callerId, warnings);
}

async function markRequestConverted(admin: any, requestId: string, callerId: string, warnings: Warning[]) {
  const payloads = [
    { status: "converted", reviewed_by: callerId, reviewed_at: new Date().toISOString() },
    { status: "converted" },
  ];
  for (const payload of payloads) {
    const { error } = await admin.from("partner_requests").update(payload).eq("id", requestId);
    if (!error) return true;
    warn(warnings, "mark_request_converted", error.message, payload);
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  console.info(`[${function_version}] invoked`);

  const warnings: Warning[] = [];

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "Unauthorized", warnings }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const ANON = Deno.env.get("SUPABASE_ANON_KEY");
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !ANON || !SERVICE) {
      return json({ ok: false, error: "Missing Supabase Edge Function secrets", warnings }, 500);
    }

    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ ok: false, error: "Unauthorized", warnings }, 401);

    const callerId = userData.user.id;
    const admin = createClient(SUPABASE_URL, SERVICE);
    const internal = await callerIsInternal(admin, callerId);
    if (internal.error) return json({ ok: false, error: "Could not verify caller role", detail: internal.error.message, warnings }, 500);
    if (!internal.ok) return json({ ok: false, error: "Forbidden — admin/super_admin only", warnings }, 403);

    const body = await req.json().catch(() => ({}));
    const partnerRequestId = body.partner_request_id ?? body.request_id ?? body.id;
    if (!partnerRequestId) return json({ ok: false, error: "partner_request_id required", warnings }, 400);

    const { data: request, error: requestError } = await admin
      .from("partner_requests")
      .select("*")
      .eq("id", partnerRequestId)
      .maybeSingle();
    if (requestError) return json({ ok: false, error: "partner_request load failed", detail: requestError.message, warnings }, 500);
    if (!request) return json({ ok: false, error: "partner_request not found", warnings }, 404);

    const partnerRequest = request as PartnerRequest;
    const alreadyConverted = partnerRequest.status === "converted";
    if (alreadyConverted) warn(warnings, "idempotency", "Request already marked converted; running repair mode.");

    let onboardingCase = await findOnboardingCase(admin, partnerRequest.id, warnings);
    let organization = await findOrganization(admin, partnerRequest, onboardingCase, warnings);
    if (!organization) organization = await createOrganization(admin, partnerRequest, warnings);
    if (organization) organization = await ensureOrganizationSuspended(admin, organization, onboardingCase, warnings);

    const organizationId = organization?.id ?? null;
    if (organizationId) await ensureAgencyProfile(admin, organizationId, partnerRequest, warnings);

    const authResult = await ensureAuthUser(admin, partnerRequest, warnings);
    const authUser = authResult.user;
    if (authUser?.id) await ensureProfile(admin, authUser.id, partnerRequest, warnings);

    const member = organizationId && authUser?.id
      ? await ensureMember(admin, organizationId, authUser.id, callerId, warnings)
      : null;

    if (organizationId) {
      onboardingCase = await ensureOnboardingCase(admin, organizationId, partnerRequest.id, callerId, onboardingCase, warnings);
    }

    await markRequestConverted(admin, partnerRequest.id, callerId, warnings);

    const response = {
      ok: Boolean(organizationId && onboardingCase?.id && authUser?.id && member?.id && organization?.status),
      already_converted: alreadyConverted,
      organization_id: organizationId,
      onboarding_case_id: onboardingCase?.id ?? null,
      user_id: authUser?.id ?? null,
      member_id: member?.id ?? null,
      organization_status: organization?.status ?? null,
      email_sent: false,
      warnings,
      ...(internal.isSuperAdmin && authResult.temporaryPassword
        ? { temporary_password: authResult.temporaryPassword }
        : {}),
    };

    if (!response.ok) {
      return json({ ...response, error: "Conversion incomplete; required related records are missing." }, 200);
    }

    return json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(warnings, "unhandled", message);
    return json({ ok: false, error: message, warnings }, 500);
  }
});
