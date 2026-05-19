import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/admin/components/PageHeader";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";
import { toast } from "sonner";

export default function MarketingTemplates() {
  const [rows, setRows] = useState<any[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    supabase.from("email_templates").select("*").order("is_system", { ascending: false }).order("name").then(({ data }) => setRows(data ?? []));
  }, []);

  const useTemplate = async (t: any) => {
    const { data, error } = await supabase.from("email_campaigns").insert({
      name: `${t.name} — ${new Date().toLocaleDateString("fr-FR")}`,
      subject: t.subject, preheader: t.preheader, html_body: t.html_body,
      cta_label: t.cta_label, cta_url: t.cta_url, hero_image_url: t.hero_image_url,
      language: t.language, template_id: t.id, status: "draft",
    } as any).select("id").single();
    if (error) return toast.error(error.message);
    navigate(`/admin/marketing/campaigns/${data!.id}`);
  };

  return (
    <div>
      <PageHeader title="Templates" description="Modèles d'emails prêts à l'emploi." />
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map((t) => (
          <div key={t.id} className="bg-background border border-border rounded-2xl p-5 flex flex-col">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-9 h-9 rounded bg-secondary flex items-center justify-center"><FileText className="w-4 h-4" /></div>
              <div className="min-w-0">
                <h3 className="font-medium truncate">{t.name}</h3>
                <p className="text-xs text-muted-foreground truncate">{t.subject}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mb-4 flex-1 line-clamp-3">{t.preheader || "—"}</p>
            <Button size="sm" onClick={() => useTemplate(t)}>Utiliser ce template</Button>
          </div>
        ))}
      </div>
    </div>
  );
}