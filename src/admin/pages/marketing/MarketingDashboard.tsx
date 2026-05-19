import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/admin/components/PageHeader";
import { fmtDateTime } from "@/lib/format";
import { Mail, Send, Clock, CheckCircle2, MousePointerClick, UserMinus, Users } from "lucide-react";

const Card = ({ icon: Icon, label, value, hint }: any) => (
  <div className="bg-background border border-border rounded-2xl p-5">
    <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2"><Icon className="w-4 h-4" /> {label}</div>
    <div className="font-display text-3xl">{value}</div>
    {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
  </div>
);

const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)} %` : "—");

export default function MarketingDashboard() {
  const [stats, setStats] = useState<any>({
    contacts: 0, drafts: 0, scheduled: 0, sent: 0,
    sentTotal: 0, openTotal: 0, clickTotal: 0, unsubTotal: 0,
  });
  const [recent, setRecent] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const [{ count: contactCount }, { data: campaigns }] = await Promise.all([
        supabase.from("clients").select("id", { count: "exact", head: true }).eq("marketing_status", "subscribed"),
        supabase.from("email_campaigns").select("*").order("updated_at", { ascending: false }),
      ]);
      const all = campaigns ?? [];
      const drafts = all.filter((c) => c.status === "draft").length;
      const scheduled = all.filter((c) => c.status === "scheduled").length;
      const sent = all.filter((c) => c.status === "sent").length;
      const sentTotal = all.reduce((s, c) => s + (c.sent_count || 0), 0);
      const openTotal = all.reduce((s, c) => s + (c.unique_open_count || 0), 0);
      const clickTotal = all.reduce((s, c) => s + (c.unique_click_count || 0), 0);
      const unsubTotal = all.reduce((s, c) => s + (c.unsubscribed_count || 0), 0);
      setStats({ contacts: contactCount || 0, drafts, scheduled, sent, sentTotal, openTotal, clickTotal, unsubTotal });
      setRecent(all.filter((c) => c.status === "sent").slice(0, 5));
    })();
  }, []);

  return (
    <div>
      <PageHeader title="Emailing marketing" description="Préparez, segmentez et suivez vos campagnes." />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card icon={Users} label="Contacts abonnés" value={stats.contacts} />
        <Card icon={Mail} label="Brouillons" value={stats.drafts} />
        <Card icon={Clock} label="Programmées" value={stats.scheduled} />
        <Card icon={CheckCircle2} label="Envoyées" value={stats.sent} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card icon={Send} label="Total envoyés" value={stats.sentTotal} />
        <Card icon={Mail} label="Taux d'ouverture" value={pct(stats.openTotal, stats.sentTotal)} hint={`${stats.openTotal} ouvertures uniques`} />
        <Card icon={MousePointerClick} label="Taux de clic" value={pct(stats.clickTotal, stats.sentTotal)} hint={`${stats.clickTotal} clics uniques`} />
        <Card icon={UserMinus} label="Désinscriptions" value={pct(stats.unsubTotal, stats.sentTotal)} hint={`${stats.unsubTotal} désinscrits`} />
      </div>

      <div className="bg-background border border-border rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <h3 className="font-display">Derniers envois</h3>
          <Link to="/admin/marketing/campaigns" className="text-sm text-accent">Toutes les campagnes →</Link>
        </div>
        {recent.length === 0 ? (
          <p className="p-8 text-center text-muted-foreground text-sm">Aucune campagne envoyée pour le moment.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-left">
              <tr><th className="p-3">Campagne</th><th className="p-3">Envoyée le</th><th className="p-3">Destinataires</th><th className="p-3">Ouvertures</th><th className="p-3">Clics</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recent.map((c) => (
                <tr key={c.id}>
                  <td className="p-3"><Link to={`/admin/marketing/campaigns/${c.id}`} className="text-accent">{c.name}</Link></td>
                  <td className="p-3 text-muted-foreground">{fmtDateTime(c.sent_at)}</td>
                  <td className="p-3">{c.sent_count}</td>
                  <td className="p-3">{pct(c.unique_open_count, c.sent_count)}</td>
                  <td className="p-3">{pct(c.unique_click_count, c.sent_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}