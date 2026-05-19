import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PUBLIC_BASE = (Deno.env.get('PUBLIC_SITE_URL') || '').replace(/\/$/, '');

function renderTokens(html: string, ctx: Record<string, string>) {
  return html.replace(/\{\{(\w+)\}\}/g, (_, k) => ctx[k] ?? '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const auth = req.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: claims } = await userClient.auth.getClaims(auth.replace('Bearer ', ''));
    if (!claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const userId = claims.claims.sub as string;

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', userId);
    const allowed = (roles ?? []).some((r: any) => ['super_admin', 'admin', 'marketing_manager'].includes(r.role));
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json().catch(() => ({}));
    const { campaign_id, test_email, schedule_at } = body as { campaign_id?: string; test_email?: string; schedule_at?: string };
    if (!campaign_id) {
      return new Response(JSON.stringify({ error: 'campaign_id is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: campaign, error: cErr } = await supabase.from('email_campaigns').select('*').eq('id', campaign_id).single();
    if (cErr || !campaign) {
      return new Response(JSON.stringify({ error: 'Campaign not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: settings } = await supabase.from('email_settings').select('*').eq('is_active', true).limit(1).maybeSingle();
    if (!settings) {
      return new Response(JSON.stringify({ error: 'SMTP settings not configured' }), { status: 412, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ---- TEST MODE: send immediately to one address, no queue, no DB writes ----
    if (test_email) {
      const transporter = nodemailer.createTransport({
        host: settings.smtp_host, port: settings.smtp_port,
        secure: settings.smtp_secure === 'ssl',
        auth: { user: settings.smtp_username, pass: settings.smtp_password },
      });
      const ctx = {
        first_name: 'Test', full_name: 'Test',
        email: test_email,
        company_name: campaign.company_name ?? settings.company_name ?? '',
        unsubscribe_url: '#',
      };
      await transporter.sendMail({
        from: `"${campaign.from_name || settings.from_name}" <${campaign.from_email || settings.from_email}>`,
        to: test_email,
        replyTo: campaign.reply_to || settings.reply_to || (campaign.from_email || settings.from_email),
        subject: '[TEST] ' + renderTokens(campaign.subject || '', ctx),
        html: renderTokens(campaign.html_body || '', ctx),
      });
      return new Response(JSON.stringify({ ok: true, mode: 'test', sent: 1 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (campaign.status === 'sent' || campaign.status === 'sending') {
      return new Response(JSON.stringify({ error: 'Campaign already sent or in progress' }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ---- Build recipient list and enqueue ----
    const segId = campaign.segment_id;
    let resolved: any[] = [];
    if (segId) {
      const { data } = await supabase.rpc('resolve_marketing_segment', { _segment_id: segId });
      resolved = data ?? [];
    } else {
      const { data } = await supabase.from('clients')
        .select('id,email,full_name,unsubscribe_token')
        .eq('marketing_status', 'subscribed')
        .not('email', 'is', null);
      resolved = (data ?? []).map((c: any) => ({ client_id: c.id, email: (c.email || '').toLowerCase(), full_name: c.full_name }));
    }

    // Dedupe by email
    const seen = new Set<string>();
    const rows = resolved
      .filter((r: any) => r.email && !seen.has(r.email) && seen.add(r.email))
      .map((r: any) => ({ campaign_id, client_id: r.client_id ?? null, email: r.email, full_name: r.full_name ?? null }));

    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: 'No recipients matched' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Insert in chunks of 500 to keep payload reasonable
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error: insErr } = await supabase.from('email_campaign_recipients').insert(chunk);
      if (insErr) throw insErr;
    }

    // Schedule or activate
    const willSchedule = schedule_at && new Date(schedule_at).getTime() > Date.now();
    await supabase.from('email_campaigns').update({
      status: willSchedule ? 'scheduled' : 'sending',
      scheduled_at: willSchedule ? schedule_at : null,
      total_recipients: rows.length,
    }).eq('id', campaign_id);

    // Kick the dispatcher once for an immediate first batch (cron drains the rest)
    if (!willSchedule) {
      fetch(`${SUPABASE_URL}/functions/v1/process-marketing-queue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SERVICE_ROLE}`,
          'apikey': SERVICE_ROLE,
        },
        body: JSON.stringify({ campaign_id }),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({
      ok: true,
      mode: willSchedule ? 'scheduled' : 'queued',
      enqueued: rows.length,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});