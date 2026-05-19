import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Days of inactivity before sending a reminder
const REMINDER_AFTER_DAYS = 3;
// Don't re-send a reminder within this many days
const REMINDER_COOLDOWN_DAYS = 4;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const cutoff = new Date(Date.now() - REMINDER_AFTER_DAYS * 24 * 3600 * 1000).toISOString();
    const cooldown = new Date(Date.now() - REMINDER_COOLDOWN_DAYS * 24 * 3600 * 1000).toISOString();

    // Applications stuck waiting for documents
    const { data: apps, error } = await admin
      .from("visa_applications")
      .select("id, reference, status, residential_email, documents_requested_at, submitted_at, admin_notes, requested_documents")
      .in("status", ["awaiting_documents", "submitted"])
      .not("residential_email", "is", null);

    if (error) throw new Error(error.message);

    const results: Array<{ id: string; sent: boolean; reason?: string }> = [];

    for (const app of apps ?? []) {
      // Reference timestamp = when documents were requested (or submission date as fallback)
      const refTs = app.documents_requested_at ?? app.submitted_at;
      if (!refTs || refTs > cutoff) {
        results.push({ id: app.id, sent: false, reason: "too_recent" });
        continue;
      }

      // Skip if a reminder was already sent recently (tracked in admin_notes)
      const lastReminder = (app.admin_notes ?? "").match(/\[REMINDER_SENT:([^\]]+)\]/);
      if (lastReminder && lastReminder[1] > cooldown) {
        results.push({ id: app.id, sent: false, reason: "cooldown" });
        continue;
      }

      const { error: invokeErr } = await admin.functions.invoke("send-visa-email", {
        body: {
          application_id: app.id,
          status: "reminder",
          extra: app.requested_documents ?? null,
        },
      });

      if (invokeErr) {
        results.push({ id: app.id, sent: false, reason: invokeErr.message });
        continue;
      }

      // Stamp reminder timestamp in admin_notes (cleaning previous stamps)
      const cleaned = (app.admin_notes ?? "").replace(/\s*\[REMINDER_SENT:[^\]]+\]/g, "").trim();
      const stamp = `[REMINDER_SENT:${new Date().toISOString()}]`;
      const newNotes = cleaned ? `${cleaned}\n${stamp}` : stamp;
      await admin.from("visa_applications").update({ admin_notes: newNotes }).eq("id", app.id);

      results.push({ id: app.id, sent: true });
    }

    return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-visa-reminders error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});