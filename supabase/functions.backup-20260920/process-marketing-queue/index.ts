import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PUBLIC_BASE = (Deno.env.get('PUBLIC_SITE_URL') || '').replace(/\/$/, '');
const BATCH_SIZE = parseInt(Deno.env.get('MARKETING_BATCH_SIZE') || '25', 10);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

function renderTokens(html: string, ctx: Record<string, string>) {
  return html.replace(/\{\{(\w+)\}\}/g, (_, k) => ctx[k] ?? '');
}
function injectTracking(html: string, campaignId: string, recipientId: string, token: string, fnBase: string) {
  const rewritten = html.replace(/href="([^"]+)"/gi, (_m, url) => {
    if (/^(mailto:|#|\{\{)/i.test(url)) return `href="${url}"`;
    return `href="${fnBase}/track-email-click?c=${campaignId}&r=${recipientId}&t=${token}&u=${encodeURIComponent(url)}"`;
  });
  const pixel = `<img src="${fnBase}/track-email-open?c=${campaignId}&r=${recipientId}&t=${token}" width="1" height="1" alt="" style="display:block;border:0;" />`;
  return /<\/body>/i.test(rewritten) ? rewritten.replace(/<\/body>/i, `${pixel}</body>`) : rewritten + pixel;
}

async function processCampaign(campaign: any, settings: any): Promise<{ sent: number; failed: number; remaining: number }> {
  const transporter = nodemailer.createTransport({
    host: settings.smtp_host, port: settings.smtp_port,
    secure: settings.smtp_secure === 'ssl',
    auth: { user: settings.smtp_username, pass: settings.smtp_password },
  });
  const fromName = campaign.from_name || settings.from_name;
  const fromEmail = campaign.from_email || settings.from_email;
  const replyTo = campaign.reply_to || settings.reply_to || fromEmail;
  const fnBase = `${SUPABASE_URL}/functions/v1`;
  const siteBase = PUBLIC_BASE;

  const { data: batch, error } = await supabase.rpc('claim_marketing_batch', { _campaign_id: campaign.id, _limit: BATCH_SIZE });
  if (error) throw error;
  let sent = 0, failed = 0;

  for (const r of (batch ?? []) as any[]) {
    const unsubscribeUrl = r.unsubscribe_token && siteBase ? `${siteBase}/unsubscribe/${r.unsubscribe_token}` : '#';
    const ctx: Record<string, string> = {
      first_name: (r.full_name?.split(' ')[0]) ?? '',
      full_name: r.full_name ?? '',
      email: r.email,
      company_name: campaign.company_name ?? settings.company_name ?? '',
      unsubscribe_url: unsubscribeUrl,
    };
    const subject = renderTokens(campaign.subject || '', ctx);
    const html = injectTracking(renderTokens(campaign.html_body || '', ctx), campaign.id, r.id, r.tracking_token, fnBase);

    try {
      await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: r.email,
        replyTo,
        subject,
        html,
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` },
      });
      await supabase.from('email_campaign_recipients')
        .update({ status: 'sent', sent_at: new Date().toISOString(), error_message: null })
        .eq('id', r.id);
      sent++;
    } catch (e) {
      const msg = String((e as Error).message || e).slice(0, 500);
      const isBounce = /bounce|recipient|invalid|mailbox|user unknown|550/i.test(msg);
      await supabase.from('email_campaign_recipients')
        .update({ status: isBounce ? 'bounced' : 'failed', error_message: msg })
        .eq('id', r.id);
      if (isBounce) {
        await supabase.from('email_events').insert({ campaign_id: campaign.id, recipient_id: r.id, event_type: 'bounced' });
      }
      failed++;
    }
  }

  // Recompute stats and check completion
  await supabase.rpc('recompute_campaign_stats', { _campaign_id: campaign.id });

  const { count } = await supabase.from('email_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id)
    .in('status', ['pending', 'sending']);

  if ((count ?? 0) === 0) {
    await supabase.from('email_campaigns').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', campaign.id);
  }

  return { sent, failed, remaining: count ?? 0 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { data: settings } = await supabase.from('email_settings').select('*').eq('is_active', true).limit(1).maybeSingle();
    if (!settings) {
      return new Response(JSON.stringify({ error: 'SMTP settings not configured' }), { status: 412, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Promote scheduled campaigns whose time has come
    await supabase.from('email_campaigns')
      .update({ status: 'sending' })
      .eq('status', 'scheduled')
      .lte('scheduled_at', new Date().toISOString());

    let body: any = {};
    try { body = await req.json(); } catch (_) {}
    const explicitId: string | undefined = body?.campaign_id;

    let campaigns: any[] = [];
    if (explicitId) {
      const { data } = await supabase.from('email_campaigns').select('*').eq('id', explicitId).eq('status', 'sending');
      campaigns = data ?? [];
    } else {
      const { data } = await supabase.from('email_campaigns').select('*').eq('status', 'sending').order('scheduled_at', { ascending: true, nullsFirst: true }).limit(3);
      campaigns = data ?? [];
    }

    const results = [];
    for (const c of campaigns) {
      const r = await processCampaign(c, settings);
      results.push({ campaign_id: c.id, ...r });
    }
    return new Response(JSON.stringify({ ok: true, processed: results }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});