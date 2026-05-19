import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon",
  submitted: "Soumise",
  awaiting_documents: "En attente des documents",
  documents_received: "Documents reçus",
  in_review: "En traitement",
  submitted_to_embassy: "Soumise à l'ambassade",
  approved: "Approuvée",
  rejected: "Rejetée",
  completed: "Terminée",
  reminder: "Rappel — documents en attente",
  form_received: "Formulaire de visa reçu",
};

function bodyForStatus(status: string, app: any, extra?: string) {
  const ref = app.reference;
  const name = [app.surname, app.given_names].filter(Boolean).join(" ") || "Cher client";
  const base = `<p>Bonjour ${name},</p>`;
  const sign = `<p style="margin-top:32px">Cordialement,<br/><strong>L'équipe Tapis Volant — Le Japon</strong></p>`;
  let html = "";
  switch (status) {
    case "submitted":
      html = `${base}<p>Votre demande de visa <strong>${ref}</strong> a bien été soumise.</p>
        <p>Notre équipe va l'examiner sous 24 à 48h ouvrées.</p>
        <p style="background:#fff8e1;padding:12px 16px;border-left:3px solid #d4a017;border-radius:4px"><strong>Prochaine étape :</strong> envoyez-nous vos documents originaux à l'adresse de l'agence, ou téléversez les copies demandées dans votre espace client.</p>`;
      break;
    case "awaiting_documents":
      html = `${base}<p>Concernant votre demande <strong>${ref}</strong>, nous attendons les documents suivants pour pouvoir avancer&nbsp;:</p>
        <div style="background:#f8f5ef;padding:14px 18px;border-radius:6px;white-space:pre-wrap">${extra ?? "Voir détail dans votre espace client."}</div>
        <p style="margin-top:16px"><strong>Merci d'envoyer les documents originaux à notre agence</strong> et de téléverser les copies dans votre espace client.</p>`;
      break;
    case "documents_received":
      html = `${base}<p>Bonne nouvelle&nbsp;: nous avons bien reçu vos documents pour la demande <strong>${ref}</strong>.</p>
        <p>Nous préparons votre dossier pour le déposer à l'ambassade.</p>`;
      break;
    case "form_received":
      html = `${base}<p>Nous avons bien reçu votre formulaire de demande de visa pour le Japon.</p>
        <p>Nous vous prions de rassembler les autres documents nécessaires afin de compléter votre dossier de demande de visa, puis de les déposer à l'agence ou de les envoyer par courrier recommandé à l'adresse suivante&nbsp;:</p>
        <div style="background:#f8f5ef;padding:14px 18px;border-radius:6px;margin:12px 0">
          <strong>Moroccan Express Travel and Events</strong><br/>
          Rue Annour, El Wifaq, Témara
        </div>
        <p>Nous vous remercions pour votre attention et restons à votre disposition pour toute question.</p>`;
      break;
    case "in_review":
      html = `${base}<p>Votre dossier <strong>${ref}</strong> est en cours de traitement par notre équipe.</p>`;
      break;
    case "submitted_to_embassy":
      html = `${base}<p>Votre dossier <strong>${ref}</strong> a été déposé à l'ambassade du Japon.</p>
        <p>Le délai habituel de réponse est de 5 à 10 jours ouvrés. Nous vous tiendrons informé(e) dès réception.</p>`;
      break;
    case "approved":
      html = `${base}<p>🎉 Excellente nouvelle&nbsp;! Votre visa <strong>${ref}</strong> a été <strong>approuvé</strong>.</p>
        <p>Nous vous contactons rapidement pour la remise de votre passeport.</p>`;
      break;
    case "rejected":
      html = `${base}<p>Concernant votre demande <strong>${ref}</strong>, l'ambassade n'a malheureusement pas approuvé le visa.</p>
        ${extra ? `<p>Motif communiqué&nbsp;: ${extra}</p>` : ""}
        <p>Notre équipe reste à votre disposition pour vous accompagner dans les prochaines démarches.</p>`;
      break;
    case "completed":
      html = `${base}<p>Votre dossier <strong>${ref}</strong> est clôturé. Merci de votre confiance&nbsp;!</p>`;
      break;
    case "reminder":
      html = `${base}<p>Petit rappel concernant votre demande de visa <strong>${ref}</strong>&nbsp;: nous n'avons pas encore reçu vos documents originaux.</p>
        ${extra ? `<div style="background:#f8f5ef;padding:14px 18px;border-radius:6px;white-space:pre-wrap;margin:12px 0">${extra}</div>` : ""}
        <p><strong>Merci d'envoyer les documents originaux à notre agence</strong> dès que possible afin que nous puissions déposer votre dossier à l'ambassade du Japon.</p>
        <p style="font-size:13px;color:#666">Si vous avez déjà envoyé vos documents, merci d'ignorer ce message.</p>`;
      break;
    default:
      html = `${base}<p>Le statut de votre demande <strong>${ref}</strong> est désormais&nbsp;: <strong>${STATUS_LABEL[status] ?? status}</strong>.</p>`;
  }
  return html + sign;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { application_id, status, extra } = await req.json();
    if (!application_id || !status) {
      return new Response(JSON.stringify({ error: "Missing application_id/status" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: app, error: appErr } = await admin
      .from("visa_applications").select("*").eq("id", application_id).maybeSingle();
    if (appErr || !app) throw new Error(appErr?.message ?? "Demande introuvable");

    const recipient = app.residential_email;
    if (!recipient) {
      return new Response(JSON.stringify({ skipped: "no_recipient_email" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: smtp, error: smtpErr } = await admin
      .from("email_settings").select("*").eq("is_active", true).maybeSingle();
    if (smtpErr || !smtp) {
      return new Response(JSON.stringify({ skipped: "smtp_not_configured" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const client = new SMTPClient({
      connection: {
        hostname: smtp.smtp_host,
        port: Number(smtp.smtp_port) || 465,
        tls: smtp.smtp_secure === "ssl",
        auth: { username: smtp.smtp_username, password: smtp.smtp_password },
      },
    });

    const subject =
      status === "reminder"
        ? `Rappel — Documents en attente pour votre visa ${app.reference}`
        : status === "form_received"
        ? `Demande de visa Japon – Réception confirmée`
        : `Visa Japon — ${STATUS_LABEL[status] ?? status} (${app.reference})`;
    const html = bodyForStatus(status, app, extra);

    await client.send({
      from: `${smtp.from_name} <${smtp.from_email}>`,
      to: recipient,
      replyTo: smtp.reply_to ?? undefined,
      subject,
      html,
      content: "auto",
    });
    await client.close();

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-visa-email error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});