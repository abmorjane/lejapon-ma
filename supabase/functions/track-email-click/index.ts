import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PUBLIC_SITE_URL = (Deno.env.get('PUBLIC_SITE_URL') || 'https://www.lejapon.ma').replace(/\/$/, '');
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

async function hashIp(ip: string) {
  const data = new TextEncoder().encode(ip + 'salt');
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeDestination(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const campaignId = url.searchParams.get('c');
  const recipientId = url.searchParams.get('r');
  const token = url.searchParams.get('t');
  const requestedDestination = safeDestination(url.searchParams.get('u'));
  let destination = PUBLIC_SITE_URL;

  if (campaignId && recipientId && token) {
    try {
      const { data: recipient } = await supabase
        .from('email_campaign_recipients')
        .select('id,first_clicked_at,click_count')
        .eq('id', recipientId)
        .eq('campaign_id', campaignId)
        .eq('tracking_token', token)
        .maybeSingle();

      if (recipient) {
        if (requestedDestination) destination = requestedDestination;

        await supabase
          .from('email_campaign_recipients')
          .update({
            click_count: (recipient.click_count ?? 0) + 1,
            first_clicked_at: recipient.first_clicked_at ?? new Date().toISOString(),
          })
          .eq('id', recipient.id);

        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
        await supabase.from('email_events').insert({
          campaign_id: campaignId,
          recipient_id: recipient.id,
          event_type: 'click',
          url: requestedDestination,
          user_agent: req.headers.get('user-agent') ?? null,
          ip_hash: ip ? await hashIp(ip) : null,
        });

        await supabase.rpc('recompute_campaign_stats', { _campaign_id: campaignId });
      }
    } catch (error) {
      console.error('[track-email-click] tracking failed', error);
    }
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: destination,
      'Cache-Control': 'no-store',
    },
  });
});
