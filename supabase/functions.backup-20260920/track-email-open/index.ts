import { createClient } from 'npm:@supabase/supabase-js@2';

const PIXEL = Uint8Array.from([
  0x47,0x49,0x46,0x38,0x39,0x61,0x01,0x00,0x01,0x00,0x80,0x00,0x00,0x00,0x00,0x00,
  0xff,0xff,0xff,0x21,0xf9,0x04,0x01,0x00,0x00,0x00,0x00,0x2c,0x00,0x00,0x00,0x00,
  0x01,0x00,0x01,0x00,0x00,0x02,0x02,0x44,0x01,0x00,0x3b
]);

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

async function hashIp(ip: string) {
  const data = new TextEncoder().encode(ip + 'salt');
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const c = url.searchParams.get('c');
  const r = url.searchParams.get('r');
  const t = url.searchParams.get('t');

  if (c && r && t) {
    try {
      const { data: rcp } = await supabase.from('email_campaign_recipients').select('id,first_opened_at,open_count').eq('id', r).eq('campaign_id', c).eq('tracking_token', t).maybeSingle();
      if (rcp) {
        await supabase.from('email_campaign_recipients').update({
          open_count: (rcp.open_count ?? 0) + 1,
          first_opened_at: rcp.first_opened_at ?? new Date().toISOString(),
        }).eq('id', rcp.id);
        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
        await supabase.from('email_events').insert({
          campaign_id: c, recipient_id: rcp.id, event_type: 'opened',
          user_agent: req.headers.get('user-agent') ?? null,
          ip_hash: ip ? await hashIp(ip) : null,
        });
        await supabase.rpc('recompute_campaign_stats', { _campaign_id: c });
      }
    } catch (_) { /* swallow */ }
  }

  return new Response(PIXEL, { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' } });
});