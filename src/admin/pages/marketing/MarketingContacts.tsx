import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/admin/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, UserMinus, UserPlus } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { toast } from "sonner";

const statusBadge: Record<string, string> = {
  subscribed: "bg-success/15 text-success",
  unsubscribed: "bg-destructive/15 text-destructive",
  bounced: "bg-gold/15 text-foreground",
  complained: "bg-secondary text-foreground/70",
};
const statusLabel: Record<string, string> = {
  subscribed: "Abonné", unsubscribed: "Désinscrit", bounced: "Bounce", complained: "Plainte",
};

export default function MarketingContacts() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [language, setLanguage] = useState("all");

  const load = async () => {
    let query = supabase.from("marketing_contacts_view").select("*").order("created_at", { ascending: false }).limit(500);
    if (status !== "all") query = query.eq("marketing_status", status);
    if (language !== "all") query = query.eq("language", language);
    const { data } = await query;
    let out = data ?? [];
    if (q) out = out.filter((c: any) =>
      c.email?.toLowerCase().includes(q.toLowerCase()) ||
      c.full_name?.toLowerCase().includes(q.toLowerCase())
    );
    setRows(out);
  };
  useEffect(() => { load(); }, [status, language]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [q]);

  const setMarketingStatus = async (clientId: string, newStatus: string) => {
    const patch: any = { marketing_status: newStatus };
    if (newStatus === "unsubscribed") patch.marketing_unsubscribed_at = new Date().toISOString();
    if (newStatus === "subscribed") patch.marketing_unsubscribed_at = null;
    const { error } = await supabase.from("clients").update(patch).eq("id", clientId);
    if (error) toast.error(error.message);
    else { toast.success("Statut mis à jour"); load(); }
  };

  return (
    <div>
      <PageHeader title="Contacts marketing" description="Base unifiée : clients CRM, abonnés newsletter, demandes visa." />
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Email ou nom…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous statuts</SelectItem>
            <SelectItem value="subscribed">Abonnés</SelectItem>
            <SelectItem value="unsubscribed">Désinscrits</SelectItem>
            <SelectItem value="bounced">Bounces</SelectItem>
            <SelectItem value="complained">Plaintes</SelectItem>
          </SelectContent>
        </Select>
        <Select value={language} onValueChange={setLanguage}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes langues</SelectItem>
            <SelectItem value="fr">Français</SelectItem>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="ar">العربية</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-background border border-border rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-left">
            <tr>
              <th className="p-3">Contact</th>
              <th className="p-3">Source</th>
              <th className="p-3">Voyages</th>
              <th className="p-3">Langue</th>
              <th className="p-3">Statut</th>
              <th className="p-3">Inscrit le</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Aucun contact.</td></tr>}
            {rows.map((c) => (
              <tr key={`${c.client_id || c.email}`} className="hover:bg-secondary/30">
                <td className="p-3">
                  <div className="font-medium">{c.full_name || "—"}</div>
                  <div className="text-xs text-muted-foreground">{c.email}</div>
                </td>
                <td className="p-3 text-xs text-muted-foreground">{c.source || "—"}</td>
                <td className="p-3">{c.trips_completed}</td>
                <td className="p-3 uppercase text-xs">{c.language || "—"}</td>
                <td className="p-3"><span className={`badge-pill ${statusBadge[c.marketing_status]}`}>{statusLabel[c.marketing_status]}</span></td>
                <td className="p-3 text-xs text-muted-foreground">{fmtDate(c.created_at)}</td>
                <td className="p-3 text-right">
                  {c.client_id && (c.marketing_status === "subscribed" ? (
                    <Button size="sm" variant="ghost" onClick={() => setMarketingStatus(c.client_id, "unsubscribed")}><UserMinus className="w-3.5 h-3.5" /> Désinscrire</Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setMarketingStatus(c.client_id, "subscribed")}><UserPlus className="w-3.5 h-3.5" /> Réabonner</Button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}