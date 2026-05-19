import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Role = "super_admin" | "admin" | "manager" | "agent" | "content_manager" | "supplier";

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

    // Caller must be super_admin
    const { data: isSuper } = await admin.rpc("has_role", { _user_id: callerId, _role: "super_admin" });
    if (!isSuper) return json({ error: "Forbidden — super_admin only" }, 403);

    const body = await req.json();
    const action = body.action as string;

    if (action === "list") {
      const { data: list, error } = await admin.auth.admin.listUsers({ perPage: 200 });
      if (error) throw error;
      const ids = list.users.map((u) => u.id);
      const { data: roles } = await admin.from("user_roles").select("user_id, role").in("user_id", ids);
      const { data: profiles } = await admin.from("profiles").select("id, full_name").in("id", ids);
      const users = list.users.map((u) => ({
        id: u.id,
        email: u.email,
        full_name: profiles?.find((p) => p.id === u.id)?.full_name ?? null,
        created_at: u.created_at,
        roles: (roles ?? []).filter((r) => r.user_id === u.id).map((r) => r.role),
      }));
      return json({ users });
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

    if (action === "set_roles") {
      const { user_id, roles } = body as { user_id: string; roles: Role[] };
      await admin.from("user_roles").delete().eq("user_id", user_id);
      if (roles?.length) {
        await admin.from("user_roles").insert(roles.map((role) => ({ user_id, role })));
      }
      return json({ ok: true });
    }

    if (action === "delete") {
      const { user_id } = body as { user_id: string };
      if (user_id === callerId) return json({ error: "Vous ne pouvez pas vous supprimer." }, 400);
      const { error } = await admin.auth.admin.deleteUser(user_id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}