import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import nodemailer from "npm:nodemailer@6";

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

const missing = "Non renseigné";

const legacyBrandPattern = "Ta" + "pis\\s+Volant";
const legacyTripsPattern = "Tri" + "ps\\s+app";
const BRAND_REPLACEMENTS: Array<[RegExp, string]> = [
  [new RegExp(`L['’]équipe\\s+${legacyBrandPattern}\\s*[—-]\\s*Le\\s+Japon`, "gi"), "L’équipe LeJapon.ma"],
  [new RegExp(`L['’]equipe\\s+${legacyBrandPattern}\\s*[—-]\\s*Le\\s+Japon`, "gi"), "L’équipe LeJapon.ma"],
  [new RegExp(`${legacyBrandPattern}\\s*[—-]\\s*Le\\s+Japon`, "gi"), "LeJapon.ma"],
  [new RegExp(legacyBrandPattern, "gi"), "LeJapon.ma"],
  [new RegExp(legacyTripsPattern, "gi"), "LeJapon.ma"],
];

const sanitizeBranding = (value: unknown) =>
  BRAND_REPLACEMENTS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), String(value ?? ""));

const escapeHtml = (value: unknown) =>
  String(value ?? missing)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const renderTemplateString = (content: unknown, variables: Record<string, unknown>) =>
  sanitizeBranding(content).replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
    const value = variables[key];
    return value === null || value === undefined || value === "" ? missing : sanitizeBranding(value);
  });

async function fetchEmailTemplate(admin: any, key: string, language = "fr") {
  const byKey = await admin
    .from("email_templates")
    .select("*")
    .eq("key", key)
    .eq("language", language)
    .limit(1)
    .maybeSingle();
  if (!byKey.error && byKey.data) return byKey.data;

  const byName = await admin
    .from("email_templates")
    .select("*")
    .eq("name", key)
    .eq("language", language)
    .limit(1)
    .maybeSingle();
  if (!byName.error && byName.data) return byName.data;
  return null;
}

async function renderEmailTemplate(admin: any, key: string, variables: Record<string, unknown>, fallback: { subject: string; html: string; text?: string }) {
  const language = "fr";
  const template = await fetchEmailTemplate(admin, key);
  const safeFallback = {
    subject: sanitizeBranding(fallback.subject),
    html: sanitizeBranding(fallback.html),
    text: sanitizeBranding(fallback.text ?? ""),
  };
  const isActive = template?.is_active ?? template?.is_system ?? true;
  if (!template || isActive === false) {
    return { ...safeFallback, templateKey: key, templateFound: Boolean(template), language, fallbackUsed: true };
  }
  const html = template.body_html ?? template.html_body;
  if (!template.subject || !html) {
    return { ...safeFallback, templateKey: key, templateFound: true, language, fallbackUsed: true };
  }
  return {
    subject: renderTemplateString(template.subject, variables),
    html: renderTemplateString(html, variables),
    text: renderTemplateString(template.body_text ?? template.preheader ?? safeFallback.text ?? "", variables),
    templateKey: key,
    templateFound: true,
    language,
    fallbackUsed: false,
  };
}

const truthy = (value: unknown) => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
};

const plainMissing = (value: unknown) => {
  const text = String(value ?? "").trim();
  return text || missing;
};

const fmtDate = (value: unknown) => {
  if (!value) return missing;
  try {
    return new Date(String(value)).toLocaleDateString("fr-FR", { dateStyle: "medium" });
  } catch {
    return String(value);
  }
};

const adminBaseUrl = () =>
  (Deno.env.get("ADMIN_BASE_URL") || Deno.env.get("SITE_URL") || "https://www.lejapon.ma").replace(/\/$/, "");

const adminRecipient = () => Deno.env.get("ADMIN_NOTIFICATION_EMAIL") || "info@lejapon.ma";

const professionalSituationLabel = (value: unknown) => {
  const labels: Record<string, string> = {
    private_employee: "Salarié du secteur privé",
    civil_servant: "Fonctionnaire",
    business_owner: "Chef d'entreprise / Gérant",
    liberal_profession: "Profession libérale",
    student: "Étudiant",
    retired: "Retraité",
    unemployed: "Sans emploi",
    other: "Autre",
    tourism: "Tourisme",
  };
  return labels[String(value ?? "")] ?? plainMissing(value);
};

function brandedShell(title: string, intro: string, sections: string, action?: { label: string; href: string }) {
  return `
    <div style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#171412">
      <div style="max-width:720px;margin:0 auto;padding:28px 14px">
        <div style="padding:0 0 16px;text-align:center">
          <div style="font-size:24px;font-weight:700;color:#ea5b14;letter-spacing:.02em">LeJapon.ma</div>
          <div style="margin-top:4px;font-size:12px;color:#766f68">Moroccan Express Travel & Events</div>
        </div>
        <div style="background:#ffffff;border-radius:14px;border:1px solid #e8e4e1;padding:26px;box-shadow:0 6px 24px rgba(0,0,0,.05)">
          <div style="border-bottom:3px solid #ea5b14;padding-bottom:14px;margin-bottom:20px">
            <h1 style="margin:0;font-size:22px;line-height:1.3;color:#171412">${escapeHtml(title)}</h1>
          </div>
          <p style="font-size:15px;line-height:1.7;margin:0 0 20px;color:#3a3531">${escapeHtml(intro).replace(/\n/g, "<br>")}</p>
          ${sections}
          ${action ? `<p style="margin:26px 0 0"><a href="${escapeHtml(action.href)}" style="display:inline-block;background:#ea5b14;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">${escapeHtml(action.label)}</a></p>` : ""}
        </div>
        <p style="margin:18px 0 0;text-align:center;color:#8a8178;font-size:12px">LeJapon.ma / Moroccan Express Travel & Events · info@lejapon.ma</p>
      </div>
    </div>
  `;
}

function sectionHtml(title: string, rows: Array<[string, unknown]>) {
  const renderedRows = rows.map(([label, value]) => `
    <tr>
      <td style="padding:9px 0;color:#746960;width:190px;border-bottom:1px solid #f0ece8;vertical-align:top">${escapeHtml(label)}</td>
      <td style="padding:9px 0;border-bottom:1px solid #f0ece8;vertical-align:top"><strong>${escapeHtml(truthy(value) ? value : missing)}</strong></td>
    </tr>
  `).join("");
  return `
    <div style="margin:18px 0 0;padding:16px;border:1px solid #eee7e1;border-radius:12px;background:#fffdfa">
      <h2 style="margin:0 0 10px;font-size:16px;color:#171412">${escapeHtml(title)}</h2>
      <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">${renderedRows}</table>
    </div>
  `;
}

function bodyForStatus(status: string, app: any, extra?: string) {
  const ref = app.reference;
  const name = [app.surname, app.given_names].filter(Boolean).join(" ") || "Cher client";
  const base = `<p>Bonjour ${name},</p>`;
  const sign = `<p style="margin-top:32px">Cordialement,<br/><strong>L'équipe LeJapon.ma</strong></p>`;
  let html = "";
  switch (status) {
    case "submitted":
      html = `${base}<p>Votre demande de visa <strong>${ref}</strong> a bien été soumise.</p>
        <p>Notre équipe va l'examiner sous 24 à 48h ouvrées.</p>
        <p style="background:#fff8e1;padding:12px 16px;border-left:3px solid #d4a017;border-radius:4px"><strong>Prochaine étape :</strong> téléchargez depuis votre espace client la liste personnalisée des documents à fournir ainsi que la procuration, puis envoyez-nous vos documents originaux à l'adresse de l'agence ou téléversez les copies demandées.</p>
        <p><a href="https://www.lejapon.ma/visa-japon-maroc" style="display:inline-block;background:#ea5b14;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px">Accéder à mon espace visa</a></p>`;
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
          <strong>Moroccan Express Travel & Events</strong><br/>
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

function templateKeyForVisaStatus(status: string) {
  const keys: Record<string, string> = {
    submitted: "visa_application_submitted_client",
    application_submitted_client: "visa_application_submitted_client",
    application_new_admin: "visa_application_new_admin",
    awaiting_documents: "visa_documents_requested_client",
    documents_requested: "visa_documents_requested_client",
    documents_received: "visa_documents_received_client",
    submitted_to_embassy: "visa_submitted_to_embassy_client",
    approved: "visa_approved_client",
    issue: "visa_rejected_or_issue_client",
    rejected: "visa_rejected_or_issue_client",
  };
  return keys[status] ?? null;
}

function visaTemplateVariables(app: any, extra?: string) {
  const clientName = [app.surname, app.given_names].filter(Boolean).join(" ") || "Cher client";
  return {
    client_name: clientName,
    visa_reference: app.reference,
    passport_number: app.passport_no,
    status: STATUS_LABEL[String(app.status ?? "")] ?? app.status ?? "",
    download_link: "https://www.lejapon.ma/visa-japon-maroc",
    admin_link: `${adminBaseUrl()}/admin/visa/${app.id}`,
    date: fmtDate(new Date().toISOString()),
    extra: extra ?? "",
    message: extra ?? "",
  };
}

async function buildInternalVisaEmail(admin: any, app: any) {
  const adminUrl = `${adminBaseUrl()}/admin/visa/${app.id}`;
  let trip: any = null;
  let booking: any = null;
  const tripId = app.selected_trip_id || app.document_trip_id || app.trip_id || null;
  if (tripId) {
    const { data } = await admin.from("trips").select("id,title,season,start_date,end_date").eq("id", tripId).maybeSingle();
    trip = data ?? null;
  }
  if (!trip && app.booking_id) {
    const { data } = await admin
      .from("bookings")
      .select("id,reference,trip_id,trips(id,title,season,start_date,end_date)")
      .eq("id", app.booking_id)
      .maybeSingle();
    booking = data ?? null;
    trip = booking?.trips ?? null;
  }

  const { data: docs } = await admin
    .from("visa_documents")
    .select("id,doc_type,file_name")
    .eq("application_id", app.id);
  const docRows = Array.isArray(docs) ? docs : [];
  const hasChecklist = docRows.some((doc: any) => /checklist|liste/i.test(`${doc.doc_type ?? ""} ${doc.file_name ?? ""}`));
  const hasProcuration = docRows.some((doc: any) => /procuration/i.test(`${doc.doc_type ?? ""} ${doc.file_name ?? ""}`));
  const clientName = [app.surname, app.given_names].filter(Boolean).join(" ") || missing;
  const tripLabel = trip ? [trip.season, trip.title].filter(Boolean).join(" — ") : missing;
  const sections = [
    sectionHtml("Dossier visa", [
      ["Référence", app.reference],
      ["Client", clientName],
      ["Email", app.residential_email],
      ["Téléphone", app.residential_mobile || app.residential_tel],
      ["Passeport", app.passport_no],
      ["Nationalité", app.nationality],
      ["Situation professionnelle", professionalSituationLabel(app.professional_situation || app.category)],
    ]),
    sectionHtml("Voyage lié", [
      ["Voyage", tripLabel],
      ["Réservation", booking?.reference || app.booking_id],
      ["Départ", fmtDate(trip?.start_date || app.date_of_arrival)],
      ["Arrivée Japon", fmtDate(app.date_of_arrival)],
      ["Retour / départ Japon", fmtDate(trip?.end_date || app.date_of_departure)],
    ]),
    sectionHtml("Documents", [
      ["Checklist", hasChecklist || app.requested_documents ? "Préparée" : "Non générée"],
      ["Procuration", hasProcuration ? "Générée" : "Non générée"],
      ["Documents reçus", docRows.length ? `${docRows.length} document(s)` : missing],
    ]),
  ].join("");

  const subject = `Nouvelle demande visa — ${clientName} — ${plainMissing(app.passport_no)}`;
  return {
    to: adminRecipient(),
    subject,
    html: brandedShell("Nouvelle demande visa", "Une nouvelle demande visa vient d'être soumise depuis l'espace client.", sections, {
      label: "Ouvrir la demande visa",
      href: adminUrl,
    }),
    text: `Nouvelle demande visa

Référence: ${plainMissing(app.reference)}
Client: ${clientName}
Email: ${plainMissing(app.residential_email)}
Téléphone: ${plainMissing(app.residential_mobile || app.residential_tel)}
Passeport: ${plainMissing(app.passport_no)}
Nationalité: ${plainMissing(app.nationality)}
Situation professionnelle: ${professionalSituationLabel(app.professional_situation || app.category)}
Voyage: ${tripLabel}
Départ: ${fmtDate(trip?.start_date || app.date_of_arrival)}
Arrivée Japon: ${fmtDate(app.date_of_arrival)}
Checklist: ${hasChecklist || app.requested_documents ? "Préparée" : "Non générée"}
Procuration: ${hasProcuration ? "Générée" : "Non générée"}

Ouvrir: ${adminUrl}`,
  };
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

    const { data: smtp, error: smtpErr } = await admin
      .from("email_settings").select("*").eq("is_active", true).maybeSingle();
    if (smtpErr || !smtp) {
      return new Response(JSON.stringify({ skipped: "smtp_not_configured" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const transporter = nodemailer.createTransport({
      host: smtp.smtp_host,
      port: Number(smtp.smtp_port) || 465,
      secure: smtp.smtp_secure === "ssl",
      auth: { user: smtp.smtp_username, pass: smtp.smtp_password },
    });

    const fallbackSubject =
      status === "reminder"
        ? `Rappel — Documents en attente pour votre visa ${app.reference}`
        : status === "form_received"
        ? `Demande de visa Japon – Réception confirmée`
        : `Visa Japon — ${STATUS_LABEL[status] ?? status} (${app.reference})`;
    const fallbackHtml = bodyForStatus(status, app, extra);
    const clientTemplateKey = templateKeyForVisaStatus(status);
    const renderedClient = clientTemplateKey
      ? await renderEmailTemplate(admin, clientTemplateKey, visaTemplateVariables(app, extra), { subject: fallbackSubject, html: fallbackHtml })
      : { subject: fallbackSubject, html: fallbackHtml, text: "", templateKey: null, templateFound: false, language: "fr", fallbackUsed: true };
    const subject = renderedClient.subject;
    const html = renderedClient.html;
    const text = renderedClient.text;
    const sent: Record<string, boolean | string> = {};

    if (app.residential_email) {
      await transporter.sendMail({
        from: `${smtp.from_name} <${smtp.from_email}>`,
        to: app.residential_email,
        replyTo: smtp.reply_to ?? undefined,
        subject,
        html,
        text: text || `Visa Japon — ${STATUS_LABEL[status] ?? status} (${app.reference})`,
      });
      sent.client = true;
    } else {
      sent.client = "skipped_no_recipient_email";
    }

    if (status === "submitted") {
      try {
        const { data, error } = await admin.functions.invoke("send-admin-notification", {
          body: { type: "new_visa_request", payload: { application_id: app.id } },
        });
        sent.internal = error ? `failed: ${error.message}` : Boolean(data?.ok ?? true);
      } catch (error) {
        sent.internal = `failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    transporter.close();

    return new Response(JSON.stringify({ ok: true, sent }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-visa-email error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
