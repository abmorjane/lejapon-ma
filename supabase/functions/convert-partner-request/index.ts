import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const function_version = "convert-partner-request-v3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Warning = {
  step: string;
  message: string;
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

function publicError(errorCode: string, message: string, status: number, warnings: Warning[] = []) {
  return json({
    success: false,
    ok: false,
    error_code: errorCode,
    code: errorCode,
    message,
    error: message,
    http_status: status,
    warnings,
  }, status);
}

function warn(warnings: Warning[], step: string, message: string, detail?: unknown) {
  warnings.push({ step, message });
  console.warn(`[${function_version}] ${step}: ${message}`, detail ?? "");
}

function logServerError(step: string, error: unknown, detail?: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
  console.error(`[${function_version}] ${step}: ${message}`, detail ?? "");
}

function cleanString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function errorCode(error: unknown) {
  return String((error as { code?: unknown } | null)?.code ?? "");
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String((error as { message?: unknown } | null)?.message ?? error ?? "Unknown error");
}

function sanitizedRequestSnapshot(request: PartnerRequest | null | undefined) {
  if (!request) return null;
  return {
    partner_request_id: request.id,
    agency_name: request.agency_name,
    has_email: Boolean(normalizeEmail(request.email)),
    has_phone: Boolean(cleanString(request.phone)),
    partnership_type: request.partnership_type,
    status: request.status,
  };
}

function sanitizedPayloadSnapshot(body: Record<string, unknown>) {
  const requestSnapshot = body.request_snapshot && typeof body.request_snapshot === "object"
    ? body.request_snapshot as Record<string, unknown>
    : {};

  return {
    partner_request_id: cleanString(body.partner_request_id),
    partnership_request_id: cleanString(body.partnership_request_id),
    request_id: cleanString(body.request_id),
    lead_id: cleanString(body.lead_id),
    id: cleanString(body.id),
    request_snapshot: {
      id: cleanString(requestSnapshot.id),
      agency_name: cleanString(requestSnapshot.agency_name),
      has_email: Boolean(cleanString(requestSnapshot.email)),
      has_phone: Boolean(cleanString(requestSnapshot.phone)),
      partnership_type: cleanString(requestSnapshot.partnership_type),
      status: cleanString(requestSnapshot.status),
    },
  };
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

function isDuplicateError(error: unknown) {
  const anyError = error as { code?: string; message?: string } | null;
  return anyError?.code === "23505" || /duplicate key|unique constraint/i.test(anyError?.message ?? "");
}

function isMissingColumnError(error: unknown) {
  const message = errorMessage(error);
  return errorCode(error) === "42703" || /column .* does not exist|schema cache|could not find .* column/i.test(message);
}

function onboardingInsertPublicError(error: unknown) {
  const message = errorMessage(error);
  if (isMissingColumnError(error)) {
    const missingColumn = message.match(/(?:column|Column) ['"]?([a-zA-Z0-9_]+)['"]?/i)?.[1] ?? null;
    return {
      errorCode: "ONBOARDING_SCHEMA_MISSING_COLUMN",
      message: missingColumn
        ? `La base de données n'est pas à jour : la colonne ${missingColumn} manque sur le dossier d'onboarding. Appliquez la migration SQL onboarding.`
        : "La base de données n'est pas à jour pour les dossiers d'onboarding. Appliquez la migration SQL onboarding.",
      status: 500,
    };
  }

  if (/violates not-null constraint/i.test(message)) {
    return {
      errorCode: "ONBOARDING_NOT_NULL_CONSTRAINT",
      message: "La création du dossier d'onboarding viole une contrainte obligatoire en base.",
      status: 500,
    };
  }

  if (/violates check constraint|invalid input value for enum/i.test(message)) {
    return {
      errorCode: "ONBOARDING_STATUS_CONSTRAINT",
      message: "Le statut utilisé pour le dossier d'onboarding n'est pas autorisé par la base.",
      status: 500,
    };
  }

  if (isDuplicateError(error)) {
    return {
      errorCode: "ONBOARDING_DUPLICATE",
      message: "Un dossier d'onboarding existe déjà pour cette demande.",
      status: 409,
    };
  }

  return {
    errorCode: "ONBOARDING_CREATE_FAILED",
    message: "Impossible de créer le dossier d'onboarding en base.",
    status: 500,
  };
}

function onboardingFormData(request: PartnerRequest) {
  const { city, country } = splitCityCountry(request.city_country);
  return {
    agency_information: {
      legal_name: request.agency_name ?? "",
      commercial_name: request.agency_name ?? "",
      registration_number: "",
      tax_number: "",
      website: request.website_social ?? "",
      address: "",
      city: city ?? "",
      country: country ?? "",
    },
    contact_person: {
      full_name: request.manager_name ?? "",
      position: "Owner",
      email: normalizeEmail(request.email),
      phone: request.phone ?? "",
    },
    documents: {},
    digital_signature_acknowledged: false,
    digital_signature_acknowledged_at: null,
    source_request: {
      partner_request_id: request.id,
      partnership_type: request.partnership_type,
      message: request.message,
    },
  };
}

async function maybeSingleOrNull(query: any) {
  const { data, error } = await query.maybeSingle();
  if (error) return { data: null, error };
  return { data, error: null };
}

async function callerIsInternal(admin: any, callerId: string) {
  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", callerId)
    .in("role", ["super_admin", "admin", "manager"]);

  if (error) return { ok: false, isSuperAdmin: false, error };
  const roles = (data ?? []).map((row: any) => String(row.role));
  return {
    ok: roles.includes("super_admin") || roles.includes("admin") || roles.includes("manager"),
    isSuperAdmin: roles.includes("super_admin"),
    error: null,
  };
}

async function findAuthUserByEmail(admin: any, email: string, warnings: Warning[]) {
  const target = normalizeEmail(email);
  const perPage = 1000;
  let page = 1;

  try {
    while (true) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      const found = data.users.find((user: any) => normalizeEmail(user.email) === target);
      if (found) return found;
      if (data.users.length < perPage) return null;
      page += 1;
    }
  } catch (error) {
    warn(warnings, "find_auth_user", "Impossible de vérifier l'utilisateur Auth existant.");
    logServerError("find_auth_user", error);
    return null;
  }
}

async function findOnboardingCaseByRequest(admin: any, requestId: string, warnings: Warning[]) {
  const result = await maybeSingleOrNull(
    admin
      .from("partner_onboarding_cases")
      .select("*")
      .eq("partner_request_id", requestId)
      .order("created_at", { ascending: false })
      .limit(1)
  );

  if (!result.error) return result.data;
  warn(warnings, "find_onboarding_case_by_request", "Recherche du dossier par demande impossible.");
  logServerError("find_onboarding_case_by_request", result.error, { requestId });
  return null;
}

async function findOrganization(admin: any, request: PartnerRequest, existingCase: any, warnings: Warning[]) {
  if (existingCase?.organization_id) {
    const byCase = await maybeSingleOrNull(
      admin.from("organizations").select("*").eq("id", existingCase.organization_id)
    );
    if (!byCase.error && byCase.data) return byCase.data;
    if (byCase.error) {
      warn(warnings, "find_organization_by_case", "Organisation liée au dossier introuvable.");
      logServerError("find_organization_by_case", byCase.error, { organizationId: existingCase.organization_id });
    }
  }

  const byMetadata = await maybeSingleOrNull(
    admin
      .from("organizations")
      .select("*")
      .contains("metadata", { partner_request_id: request.id })
      .limit(1)
  );
  if (!byMetadata.error && byMetadata.data) return byMetadata.data;
  if (byMetadata.error) logServerError("find_organization_by_metadata", byMetadata.error, { requestId: request.id });

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
    if (byEmail.error) logServerError("find_organization_by_email", byEmail.error, { email: safeEmail });
  }

  const safeName = cleanString(request.agency_name);
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
    if (byName.error) logServerError("find_organization_by_name", byName.error, { requestId: request.id });
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
    warn(warnings, "create_organization", "Création de l'organisation agence impossible.");
    logServerError("create_organization", error, { requestId: request.id });
    return { data: null, error };
  }
  return { data, error: null };
}

async function ensureOrganizationSuspended(admin: any, organization: any, onboardingCase: any, warnings: Warning[]) {
  const onboardingApproved = String(onboardingCase?.status ?? "").toLowerCase() === "approved";
  if (!organization?.id || organization.status === "suspended" || onboardingApproved) return organization;

  const { data, error } = await admin
    .from("organizations")
    .update({ status: "suspended" })
    .eq("id", organization.id)
    .select("*")
    .single();

  if (error) {
    warn(warnings, "suspend_organization", "Impossible de suspendre l'organisation pendant l'onboarding.");
    logServerError("suspend_organization", error, { organizationId: organization.id });
    return organization;
  }

  return data;
}

async function ensureAgencyProfile(admin: any, organizationId: string, request: PartnerRequest, warnings: Warning[]) {
  const existing = await maybeSingleOrNull(
    admin.from("agency_profiles").select("organization_id").eq("organization_id", organizationId)
  );
  if (!existing.error && existing.data) return true;
  if (existing.error) logServerError("find_agency_profile", existing.error, { organizationId });

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
    warn(warnings, "ensure_agency_profile", "Profil agence non créé.");
    logServerError("ensure_agency_profile", error, { organizationId, requestId: request.id });
    return false;
  }
  return true;
}

async function ensureAuthUser(admin: any, request: PartnerRequest, warnings: Warning[]) {
  const email = normalizeEmail(request.email);
  if (!email) {
    warn(warnings, "ensure_auth_user", "La demande partenaire n'a pas d'email.");
    return { user: null, temporaryPassword: null };
  }

  const existing = await findAuthUserByEmail(admin, email, warnings);
  if (existing) return { user: existing, temporaryPassword: null };

  const temporaryPassword = makeTemporaryPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { full_name: request.manager_name ?? request.agency_name ?? "" },
  });
  if (error) {
    warn(warnings, "create_auth_user", "Utilisateur agence non créé.");
    logServerError("create_auth_user", error, { requestId: request.id, email });
    const retryExisting = await findAuthUserByEmail(admin, email, warnings);
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
  if (error) {
    warn(warnings, "ensure_profile", "Profil utilisateur non synchronisé.");
    logServerError("ensure_profile", error, { userId });
  }
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
      if (error) logServerError("reactivate_member", error, { memberId: existing.data.id });
    }
    return existing.data;
  }
  if (existing.error) logServerError("find_member", existing.error, { organizationId, userId });

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
    warn(warnings, "create_member", "Membre organisation non créé.");
    logServerError("create_member", error, { organizationId, userId });
    return null;
  }
  return data;
}

async function ensureMemberProfile(admin: any, member: any, request: PartnerRequest, warnings: Warning[]) {
  if (!member?.id || !member.user_id || !member.organization_id) return false;
  const { error } = await admin.from("organization_member_profiles").upsert({
    organization_member_id: member.id,
    user_id: member.user_id,
    organization_id: member.organization_id,
    full_name: request.manager_name ?? null,
    email: normalizeEmail(request.email) || null,
    phone: request.phone ?? null,
    position_title: "Owner",
    notes: `Created from partner request ${request.id}`,
  }, { onConflict: "organization_member_id" });
  if (error) {
    warn(warnings, "ensure_member_profile", "Profil membre non créé.");
    logServerError("ensure_member_profile", error, { memberId: member.id });
    return false;
  }
  return true;
}

async function linkExistingOnboardingCase(admin: any, onboardingCase: any, request: PartnerRequest, callerId: string, warnings: Warning[]) {
  if (!onboardingCase?.id || onboardingCase.partner_request_id === request.id) return onboardingCase;
  if (onboardingCase.partner_request_id) return onboardingCase;

  const { data, error } = await admin
    .from("partner_onboarding_cases")
    .update({
      partner_request_id: request.id,
      updated_by: callerId,
      form_data: onboardingCase.form_data ?? onboardingFormData(request),
    })
    .eq("id", onboardingCase.id)
    .select("*")
    .single();

  if (error) {
    warn(warnings, "link_existing_onboarding_case", "Dossier existant trouvé mais non lié à la demande.");
    logServerError("link_existing_onboarding_case", error, { caseId: onboardingCase.id, requestId: request.id });
    return onboardingCase;
  }

  return data;
}

async function findOnboardingCaseByOrganization(admin: any, organizationId: string, warnings: Warning[]) {
  const byOrganization = await maybeSingleOrNull(
    admin
      .from("partner_onboarding_cases")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(1)
  );
  if (!byOrganization.error) return byOrganization.data;
  warn(warnings, "find_onboarding_case_by_org", "Recherche du dossier par organisation impossible.");
  logServerError("find_onboarding_case_by_org", byOrganization.error, { organizationId });
  return null;
}

async function createOnboardingCase(admin: any, organizationId: string, request: PartnerRequest, callerId: string, warnings: Warning[]) {
  const payload = {
    organization_id: organizationId,
    partner_request_id: request.id,
    status: "draft",
    form_data: onboardingFormData(request),
    metadata: {
      partner_request_id: request.id,
      partnership_type: request.partnership_type,
      source: "convert-partner-request",
      function_version,
    },
    created_by: callerId,
    updated_by: callerId,
  };

  const { data, error } = await admin.from("partner_onboarding_cases").insert(payload).select("*").single();
  if (!error && data) return { data, alreadyExists: false, error: null };

  if (isDuplicateError(error)) {
    const existing = await findOnboardingCaseByRequest(admin, request.id, warnings);
    if (existing) return { data: existing, alreadyExists: true, error: null };
  }

  const publicFailure = onboardingInsertPublicError(error);
  warn(warnings, "create_onboarding_case", publicFailure.message);
  logServerError("create_onboarding_case", error, { organizationId, requestId: request.id });
  return { data: null, alreadyExists: false, error, ...publicFailure };
}

async function ensureOnboardingCase(admin: any, organizationId: string, request: PartnerRequest, callerId: string, existingCase: any, warnings: Warning[]) {
  if (existingCase?.id) return { data: existingCase, alreadyExists: true, error: null };

  const byOrganization = await findOnboardingCaseByOrganization(admin, organizationId, warnings);
  if (byOrganization?.id) {
    const linked = await linkExistingOnboardingCase(admin, byOrganization, request, callerId, warnings);
    return { data: linked, alreadyExists: true, error: null };
  }

  return await createOnboardingCase(admin, organizationId, request, callerId, warnings);
}

async function markRequestConverted(admin: any, requestId: string, callerId: string, warnings: Warning[]) {
  const { error } = await admin.from("partner_requests").update({
    status: "converted",
    reviewed_by: callerId,
    reviewed_at: new Date().toISOString(),
  }).eq("id", requestId);

  if (!error) return true;
  warn(warnings, "mark_request_converted", "Le dossier est créé mais la demande n'a pas pu passer au statut converti.");
  logServerError("mark_request_converted", error, { requestId });
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const warnings: Warning[] = [];

  try {
    if (req.method !== "POST") {
      return publicError("METHOD_NOT_ALLOWED", "Méthode non autorisée.", 405, warnings);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return publicError("UNAUTHORIZED", "Session admin requise.", 401, warnings);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const ANON = Deno.env.get("SUPABASE_ANON_KEY");
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !ANON || !SERVICE) {
      console.error(`[${function_version}] Missing Supabase env`, {
        hasUrl: Boolean(SUPABASE_URL),
        hasAnon: Boolean(ANON),
        hasServiceRole: Boolean(SERVICE),
      });
      return publicError("MISSING_ENV", "Configuration serveur incomplète pour créer le dossier d'onboarding.", 500, warnings);
    }

    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      logServerError("verify_user", userError ?? "No user");
      return publicError("UNAUTHORIZED", "Session admin invalide ou expirée.", 401, warnings);
    }

    const callerId = userData.user.id;
    const admin = createClient(SUPABASE_URL, SERVICE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const internal = await callerIsInternal(admin, callerId);
    if (internal.error) {
      logServerError("verify_role", internal.error, { callerId });
      return publicError("ROLE_CHECK_FAILED", "Impossible de vérifier les droits administrateur.", 500, warnings);
    }
    if (!internal.ok) {
      return publicError("FORBIDDEN", "Action réservée aux administrateurs et managers.", 403, warnings);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return publicError("INVALID_PAYLOAD", "Payload JSON invalide.", 400, warnings);
    }
    const payload = body as Record<string, unknown>;
    console.info(`[${function_version}] incoming_payload`, sanitizedPayloadSnapshot(payload));

    const partnerRequestId = cleanString(
      payload.partner_request_id ??
        payload.partnership_request_id ??
        payload.request_id ??
        payload.lead_id ??
        payload.id
    );
    if (!partnerRequestId) {
      return publicError("MISSING_PARTNERSHIP_REQUEST_ID", "Identifiant de demande de partenariat manquant.", 400, warnings);
    }

    const { data: request, error: requestError } = await admin
      .from("partner_requests")
      .select("*")
      .eq("id", partnerRequestId)
      .maybeSingle();

    if (requestError) {
      logServerError("load_partner_request", requestError, { partnerRequestId });
      return publicError("PARTNERSHIP_REQUEST_LOAD_FAILED", "Impossible de charger la demande de partenariat.", 500, warnings);
    }
    if (!request) {
      return publicError("PARTNERSHIP_REQUEST_NOT_FOUND", "La demande de partenariat est introuvable.", 404, warnings);
    }

    const partnerRequest = request as PartnerRequest;
    console.info(`[${function_version}] loaded_partner_request`, sanitizedRequestSnapshot(partnerRequest));
    if (!cleanString(partnerRequest.agency_name)) {
      return publicError("PARTNERSHIP_REQUEST_MISSING_AGENCY_NAME", "La demande de partenariat n'a pas de nom d'agence.", 422, warnings);
    }
    if (!normalizeEmail(partnerRequest.email)) {
      return publicError("PARTNERSHIP_REQUEST_MISSING_EMAIL", "La demande de partenariat n'a pas d'email de contact.", 422, warnings);
    }

    let onboardingCase = await findOnboardingCaseByRequest(admin, partnerRequest.id, warnings);
    let organization = await findOrganization(admin, partnerRequest, onboardingCase, warnings);

    if (!organization) {
      const created = await createOrganization(admin, partnerRequest, warnings);
      if (created.error) {
        return publicError("ORGANIZATION_CREATE_FAILED", "Impossible de créer l'organisation agence.", 500, warnings);
      }
      organization = created.data;
    }

    organization = await ensureOrganizationSuspended(admin, organization, onboardingCase, warnings);
    const organizationId = organization?.id ?? null;
    if (!organizationId) {
      return publicError("ORGANIZATION_MISSING_AFTER_CONVERSION", "Organisation agence indisponible après conversion.", 500, warnings);
    }

    await ensureAgencyProfile(admin, organizationId, partnerRequest, warnings);

    const authResult = await ensureAuthUser(admin, partnerRequest, warnings);
    const authUser = authResult.user;
    if (authUser?.id) await ensureProfile(admin, authUser.id, partnerRequest, warnings);

    const member = authUser?.id
      ? await ensureMember(admin, organizationId, authUser.id, callerId, warnings)
      : null;
    if (member) await ensureMemberProfile(admin, member, partnerRequest, warnings);

    const onboardingResult = await ensureOnboardingCase(admin, organizationId, partnerRequest, callerId, onboardingCase, warnings);
    if (onboardingResult.error || !onboardingResult.data?.id) {
      return publicError(
        onboardingResult.errorCode ?? "ONBOARDING_CREATE_FAILED",
        onboardingResult.message ?? "Impossible de créer le dossier d'onboarding.",
        onboardingResult.status ?? 500,
        warnings
      );
    }
    onboardingCase = onboardingResult.data;

    await markRequestConverted(admin, partnerRequest.id, callerId, warnings);

    return json({
      success: true,
      ok: true,
      already_exists: onboardingResult.alreadyExists,
      already_converted: partnerRequest.status === "converted",
      message: onboardingResult.alreadyExists
        ? "Un dossier d'onboarding existe déjà pour cette demande."
        : "Dossier d'onboarding créé.",
      organization_id: organizationId,
      onboarding_case_id: onboardingCase.id,
      partner_request_id: partnerRequest.id,
      user_id: authUser?.id ?? null,
      member_id: member?.id ?? null,
      organization_status: organization?.status ?? null,
      email_sent: false,
      warnings,
      ...(internal.isSuperAdmin && authResult.temporaryPassword
        ? { temporary_password: authResult.temporaryPassword }
        : {}),
    });
  } catch (error) {
    logServerError("unhandled", error);
    return publicError(
      "UNEXPECTED_ERROR",
      "Erreur serveur inattendue pendant la création du dossier d'onboarding.",
      500,
      warnings
    );
  }
});
