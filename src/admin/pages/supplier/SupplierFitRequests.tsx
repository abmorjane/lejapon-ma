import { supplierErrorMessage, useSupplierTranslation } from "@/i18n/supplier/SupplierLanguageProvider";
import { useEffect, useState } from "react";
import { CheckCircle2, FileUp, Loader2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const db=supabase as any;
const serviceTypes: Record<string, string> = { hotel: "Hôtel", transport: "Transport", activity: "Activité", activities: "Activités", guide: "Guides", guides: "Guides", other: "Other", flight: "Flights" };
const labels:Record<string,string>={sent:"Sent",waiting_supplier:"Waiting supplier",supplier_replied:"Supplier replied",option_hold:"Option / Hold",confirmed:"Confirmed",unavailable:"Unavailable",alternative_proposed:"Alternative proposed"};
export default function SupplierFitRequests(){
  const { t } = useSupplierTranslation();const{user}=useAuth();const[rows,setRows]=useState<any[]>([]);const[drafts,setDrafts]=useState<Record<string,any>>({});const[attachments,setAttachments]=useState<any[]>([]);const[busy,setBusy]=useState("");
  const load=async()=>{const[{data:r,error},{data:a}]=await Promise.all([db.from("fit_supplier_requests").select("*").order("updated_at",{ascending:false}),db.from("fit_supplier_request_attachments").select("*").order("created_at",{ascending:false})]);if(error)return toast.error(supplierErrorMessage(t, error));setRows(r||[]);setAttachments(a||[]);setDrafts(Object.fromEntries((r||[]).map((x:any)=>[x.id,{status:["sent","waiting_supplier"].includes(x.status)?"supplier_replied":x.status,response:x.supplier_response||"",quoted:x.supplier_quoted_cost??"",confirmed:x.confirmed_cost??"",confirmation:x.confirmation_number||"",hold:x.hold_release_deadline?String(x.hold_release_deadline).slice(0,16):"",notes:x.supplier_notes||"",altTitle:"",altDescription:"",altCost:"",altImpact:""}])))};
  useEffect(()=>{void load()},[]);const update=(id:string,k:string,v:any)=>setDrafts(c=>({...c,[id]:{...c[id],[k]:v}}));
  const save=async(row:any)=>{const d=drafts[row.id];setBusy(row.id);const alt=d.status==="alternative_proposed"?{title:d.altTitle,description:d.altDescription,proposed_cost:Number(d.altCost||0),currency:row.currency,operational_impact:d.altImpact}:null;const{error}=await db.rpc("supplier_update_fit_request_v5",{p_request_id:row.id,p_status:d.status,p_response:d.response||null,p_quoted_cost:d.quoted===""?null:Number(d.quoted),p_confirmed_cost:d.confirmed===""?null:Number(d.confirmed),p_confirmation_number:d.confirmation||null,p_hold_deadline:d.hold?new Date(d.hold).toISOString():null,p_notes:d.notes||null,p_alternative:alt});setBusy("");if(error)return toast.error(supplierErrorMessage(t, error));toast.success(t("Supplier response saved."));void load()};
  const upload=async(row:any,file:File|null)=>{if(!file||!user)return;setBusy(`file-${row.id}`);const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,"-");const path=`fit/${row.supplier_id}/${row.id}/${crypto.randomUUID()}-${safe}`;const up=await supabase.storage.from("trip-documents").upload(path,file);if(up.error){setBusy("");return toast.error(supplierErrorMessage(t, up.error))}const{error}=await db.from("fit_supplier_request_attachments").insert({request_id:row.id,document_type:row.status==="confirmed"?"confirmation":"response",file_name:file.name,storage_path:path,mime_type:file.type,size_bytes:file.size,uploaded_by:user.id});setBusy("");if(error)return toast.error(supplierErrorMessage(t, error));toast.success(t("Document uploaded."));void load()};
  return <div className="space-y-5">
    <div>
      <h1 className="font-display text-2xl">{t("FIT requests")}</h1>
      <p className="text-sm text-muted-foreground">{t("Only services assigned to your supplier account are visible. Client prices and internal margins are never shown.")}</p>
    </div>
    {rows.length===0
      ? <Card className="p-10 text-center text-muted-foreground">{t("No FIT supplier request assigned.")}</Card>
      : rows.map(row=>{const d=drafts[row.id]||{};return <Card key={row.id} className="rounded-md p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="font-semibold">{row.service_label}</h2><p className="text-xs text-muted-foreground">{t(serviceTypes[row.service_type] || row.service_type)} {t("· Version")} {row.version_number}</p></div>
          <Badge variant={row.status==="confirmed"?"default":"outline"}>{t(labels[row.status]||row.status)}</Badge>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label={t("Response status")}><Select value={d.status} onValueChange={v=>update(row.id,"status",v)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{["supplier_replied","option_hold","confirmed","unavailable","alternative_proposed"].map(s=><SelectItem key={s} value={s}>{t(labels[s])}</SelectItem>)}</SelectContent></Select></Field>
          <Field label={t("Quoted cost")}><Input inputMode="decimal" value={d.quoted} onChange={e=>update(row.id,"quoted",e.target.value)}/></Field>
          {d.status==="confirmed"&&<>
            <Field label={t("Confirmed cost")}><Input inputMode="decimal" value={d.confirmed} onChange={e=>update(row.id,"confirmed",e.target.value)}/></Field>
            <Field label={t("Confirmation number")}><Input value={d.confirmation} onChange={e=>update(row.id,"confirmation",e.target.value)}/></Field>
          </>}
          {d.status==="option_hold"&&<Field label={t("Hold release deadline")}><Input type="datetime-local" value={d.hold} onChange={e=>update(row.id,"hold",e.target.value)}/></Field>}
          <Field label={t("Response")}><Textarea value={d.response} onChange={e=>update(row.id,"response",e.target.value)}/></Field>
          <Field label={t("Supplier notes")}><Textarea value={d.notes} onChange={e=>update(row.id,"notes",e.target.value)}/></Field>
          {d.status==="alternative_proposed"&&<>
            <Field label={t("Alternative name")}><Input value={d.altTitle} onChange={e=>update(row.id,"altTitle",e.target.value)}/></Field>
            <Field label={t("Alternative cost")}><Input inputMode="decimal" value={d.altCost} onChange={e=>update(row.id,"altCost",e.target.value)}/></Field>
            <Field label={t("Description")}><Textarea value={d.altDescription} onChange={e=>update(row.id,"altDescription",e.target.value)}/></Field>
            <Field label={t("Operational impact")}><Textarea value={d.altImpact} onChange={e=>update(row.id,"altImpact",e.target.value)}/></Field>
          </>}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={()=>save(row)} disabled={busy===row.id}>{busy===row.id?<Loader2 className="h-4 w-4 animate-spin"/>:<Save className="h-4 w-4"/>} {t("Save response")}</Button>
          <Button variant="outline" asChild><label className="cursor-pointer"><FileUp className="h-4 w-4"/>{busy===`file-${row.id}`?t("Uploading…"):t("Upload document")}<input className="sr-only" type="file" accept="application/pdf,image/*" onChange={e=>void upload(row,e.target.files?.[0]||null)}/></label></Button>
        </div>
        {attachments.filter(a=>a.request_id===row.id).length>0&&<div className="mt-3 text-xs text-muted-foreground"><CheckCircle2 className="mr-1 inline h-4 w-4"/>{attachments.filter(a=>a.request_id===row.id).length} {t("document(s) uploaded")}</div>}
      </Card>})}
  </div>}
function Field({label,children}:{label:string;children:any}){
  const { t } = useSupplierTranslation();return <div className="space-y-1.5"><Label>{t(label)}</Label>{children}</div>}
