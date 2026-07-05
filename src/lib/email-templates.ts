export type EmailTemplateCategory =
  | "Réservations"
  | "Paiements"
  | "Visa"
  | "Agences"
  | "Fournisseurs"
  | "Système";

export type EmailTemplateDefinition = {
  key: string;
  name: string;
  category: EmailTemplateCategory;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  allowedVariables: string[];
  requiredVariables: string[];
};

const baseFooter = `
  <p style="margin-top:28px">L'équipe LeJapon.ma</p>
  <p style="font-size:13px;color:#667085">Moroccan Express Travel and Events<br/>info@lejapon.ma · +212 711 449 838</p>
`;

const legacyBrandPattern = "Ta" + "pis\\s+Volant";
const legacyTripsPattern = "Tri" + "ps\\s+app";
const BRAND_REPLACEMENTS: Array<[RegExp, string]> = [
  [new RegExp(`L['’]équipe\\s+${legacyBrandPattern}\\s*[—-]\\s*Le\\s+Japon`, "gi"), "L’équipe LeJapon.ma"],
  [new RegExp(`L['’]equipe\\s+${legacyBrandPattern}\\s*[—-]\\s*Le\\s+Japon`, "gi"), "L’équipe LeJapon.ma"],
  [new RegExp(`${legacyBrandPattern}\\s*[—-]\\s*Le\\s+Japon`, "gi"), "LeJapon.ma"],
  [new RegExp(legacyBrandPattern, "gi"), "LeJapon.ma"],
  [new RegExp(legacyTripsPattern, "gi"), "LeJapon.ma"],
];

export const sanitizeEmailBranding = (value: unknown) =>
  BRAND_REPLACEMENTS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), String(value ?? ""));

const shell = (title: string, body: string) => `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f6f3ef;padding:24px;color:#0f172a">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #eadfd7;border-radius:18px;padding:28px">
      <div style="font-size:24px;font-weight:800;color:#f97316;margin-bottom:18px">LeJapon.ma</div>
      <h1 style="font-size:22px;line-height:1.3;margin:0 0 18px">${title}</h1>
      <div style="font-size:15px;line-height:1.7;color:#253041">${body}</div>
      ${baseFooter}
    </div>
  </div>
`;

const common = [
  "client_name",
  "booking_reference",
  "trip_title",
  "amount",
  "payment_method",
  "visa_reference",
  "passport_number",
  "agency_name",
  "admin_link",
  "download_link",
  "status",
  "date",
  "message",
];

export const REQUIRED_EMAIL_TEMPLATES: EmailTemplateDefinition[] = [
  {
    key: "booking_received_client",
    name: "Réservation reçue — client",
    category: "Réservations",
    subject: "Votre demande de réservation LeJapon.ma a bien été reçue",
    bodyHtml: shell("Votre demande de réservation est bien reçue", "<p>Bonjour {{client_name}},</p><p>Nous avons bien reçu votre demande pour <strong>{{trip_title}}</strong>.</p><p>Référence : <strong>{{booking_reference}}</strong></p><p>Votre réservation sera confirmée après réception du premier acompte.</p>"),
    bodyText: "Bonjour {{client_name}},\n\nNous avons bien reçu votre demande pour {{trip_title}}.\nRéférence : {{booking_reference}}\n\nVotre réservation sera confirmée après réception du premier acompte.\n\nL'équipe LeJapon.ma",
    allowedVariables: common,
    requiredVariables: ["client_name", "booking_reference", "trip_title"],
  },
  {
    key: "booking_new_admin",
    name: "Nouvelle réservation — admin",
    category: "Réservations",
    subject: "Nouvelle réservation LeJapon.ma — {{client_name}} — {{trip_title}}",
    bodyHtml: shell("Nouvelle réservation", "<p>Une nouvelle réservation a été créée.</p><p><strong>Client :</strong> {{client_name}}<br/><strong>Voyage :</strong> {{trip_title}}<br/><strong>Référence :</strong> {{booking_reference}}</p><p><a href=\"{{admin_link}}\">Ouvrir la réservation</a></p>"),
    bodyText: "Nouvelle réservation\nClient : {{client_name}}\nVoyage : {{trip_title}}\nRéférence : {{booking_reference}}\nOuvrir : {{admin_link}}",
    allowedVariables: common,
    requiredVariables: ["client_name", "booking_reference", "trip_title", "admin_link"],
  },
  {
    key: "booking_status_updated_client",
    name: "Statut réservation mis à jour — client",
    category: "Réservations",
    subject: "Mise à jour de votre réservation LeJapon.ma — {{booking_reference}}",
    bodyHtml: shell("Mise à jour de votre réservation", "<p>Bonjour {{client_name}},</p><p>Le statut de votre réservation <strong>{{booking_reference}}</strong> est maintenant : <strong>{{status}}</strong>.</p>"),
    bodyText: "Bonjour {{client_name}},\n\nLe statut de votre réservation {{booking_reference}} est maintenant : {{status}}.\n\nL'équipe LeJapon.ma",
    allowedVariables: common,
    requiredVariables: ["client_name", "booking_reference", "status"],
  },
  {
    key: "booking_payment_reminder_client",
    name: "Rappel paiement réservation — client",
    category: "Réservations",
    subject: "Rappel paiement — réservation {{booking_reference}}",
    bodyHtml: shell("Rappel de paiement", "<p>Bonjour {{client_name}},</p><p>Un règlement reste attendu pour votre réservation <strong>{{booking_reference}}</strong>.</p><p>Montant : <strong>{{amount}}</strong></p>"),
    bodyText: "Bonjour {{client_name}},\n\nUn règlement reste attendu pour votre réservation {{booking_reference}}.\nMontant : {{amount}}\n\nL'équipe LeJapon.ma",
    allowedVariables: common,
    requiredVariables: ["client_name", "booking_reference", "amount"],
  },
  {
    key: "payment_received_client",
    name: "Paiement reçu — client",
    category: "Paiements",
    subject: "Paiement reçu — LeJapon.ma",
    bodyHtml: shell("Paiement reçu", "<p>Bonjour {{client_name}},</p><p>Nous confirmons la réception de votre paiement de <strong>{{amount}}</strong>.</p><p>Mode : {{payment_method}}</p>"),
    bodyText: "Bonjour {{client_name}},\n\nNous confirmons la réception de votre paiement de {{amount}}.\nMode : {{payment_method}}\n\nL'équipe LeJapon.ma",
    allowedVariables: common,
    requiredVariables: ["client_name", "amount"],
  },
  {
    key: "payment_new_admin",
    name: "Nouveau paiement — admin",
    category: "Paiements",
    subject: "Nouveau paiement LeJapon.ma — {{client_name}} — {{amount}}",
    bodyHtml: shell("Nouveau paiement", "<p>Un nouveau paiement a été enregistré.</p><p><strong>Client :</strong> {{client_name}}<br/><strong>Montant :</strong> {{amount}}<br/><strong>Méthode :</strong> {{payment_method}}</p><p><a href=\"{{admin_link}}\">Ouvrir la réservation</a></p>"),
    bodyText: "Nouveau paiement\nClient : {{client_name}}\nMontant : {{amount}}\nMéthode : {{payment_method}}\nOuvrir : {{admin_link}}",
    allowedVariables: common,
    requiredVariables: ["client_name", "amount", "admin_link"],
  },
  {
    key: "payment_receipt_client",
    name: "Reçu de paiement — client",
    category: "Paiements",
    subject: "Votre reçu de paiement LeJapon.ma",
    bodyHtml: shell("Votre reçu de paiement", "<p>Bonjour {{client_name}},</p><p>Votre reçu de paiement est disponible.</p><p><a href=\"{{download_link}}\">Télécharger le reçu</a></p>"),
    bodyText: "Bonjour {{client_name}},\n\nVotre reçu de paiement est disponible : {{download_link}}\n\nL'équipe LeJapon.ma",
    allowedVariables: common,
    requiredVariables: ["client_name", "download_link"],
  },
  {
    key: "visa_account_created",
    name: "Compte visa créé",
    category: "Visa",
    subject: "Bienvenue sur LeJapon.ma — votre espace visa est prêt",
    bodyHtml: shell("Bienvenue dans votre espace visa", "<p>Bonjour {{client_name}},</p><p>Votre espace visa Japon est prêt. Vous pouvez compléter votre demande, téléverser vos documents et suivre l'avancement depuis votre espace client.</p><p><a href=\"{{download_link}}\">Accéder à mon espace visa</a></p>"),
    bodyText: "Bonjour {{client_name}},\n\nVotre espace visa Japon est prêt.\nAccéder : {{download_link}}\n\nL'équipe LeJapon.ma",
    allowedVariables: common,
    requiredVariables: ["client_name", "download_link"],
  },
  {
    key: "visa_application_submitted_client",
    name: "Demande visa soumise — client",
    category: "Visa",
    subject: "Votre demande de visa Japon a bien été soumise — {{visa_reference}}",
    bodyHtml: shell("Demande visa soumise", "<p>Bonjour {{client_name}},</p><p>Votre demande de visa <strong>{{visa_reference}}</strong> a bien été soumise.</p><p>Merci de préparer les documents demandés.</p>"),
    bodyText: "Bonjour {{client_name}},\n\nVotre demande de visa {{visa_reference}} a bien été soumise.\n\nL'équipe LeJapon.ma",
    allowedVariables: common,
    requiredVariables: ["client_name", "visa_reference"],
  },
  {
    key: "visa_application_new_admin",
    name: "Nouvelle demande visa — admin",
    category: "Visa",
    subject: "Nouvelle demande visa — {{client_name}} — {{passport_number}}",
    bodyHtml: shell("Nouvelle demande visa", "<p>Une nouvelle demande visa a été soumise.</p><p><strong>Client :</strong> {{client_name}}<br/><strong>Passeport :</strong> {{passport_number}}<br/><strong>Référence :</strong> {{visa_reference}}</p><p><a href=\"{{admin_link}}\">Ouvrir la demande</a></p>"),
    bodyText: "Nouvelle demande visa\nClient : {{client_name}}\nPasseport : {{passport_number}}\nRéférence : {{visa_reference}}\nOuvrir : {{admin_link}}",
    allowedVariables: common,
    requiredVariables: ["client_name", "visa_reference", "admin_link"],
  },
  {
    key: "visa_documents_requested_client",
    name: "Documents visa demandés — client",
    category: "Visa",
    subject: "Documents à fournir pour votre visa Japon — {{visa_reference}}",
    bodyHtml: shell("Documents à fournir", "<p>Bonjour {{client_name}},</p><p>Des documents sont attendus pour votre demande visa <strong>{{visa_reference}}</strong>.</p><p><a href=\"{{download_link}}\">Consulter la liste</a></p>"),
    bodyText: "Bonjour {{client_name}},\n\nDes documents sont attendus pour votre demande visa {{visa_reference}}.\nListe : {{download_link}}\n\nL'équipe LeJapon.ma",
    allowedVariables: common,
    requiredVariables: ["client_name", "visa_reference"],
  },
  {
    key: "visa_documents_received_client",
    name: "Documents visa reçus client",
    category: "Visa",
    subject: "Visa Japon — Documents reçus ({{visa_reference}})",
    bodyHtml: shell("Documents visa reçus", "<p>Bonjour {{client_name}},</p><p>Nous avons bien reçu les documents liés à votre demande visa <strong>{{visa_reference}}</strong>.</p><p>Notre équipe prépare votre dossier pour la suite du traitement.</p>"),
    bodyText: "Bonjour {{client_name}},\n\nNous avons bien reçu les documents liés à votre demande visa {{visa_reference}}.\nNotre équipe prépare votre dossier pour la suite du traitement.\n\nL'équipe LeJapon.ma",
    allowedVariables: common,
    requiredVariables: ["client_name", "visa_reference"],
  },
  {
    key: "visa_submitted_to_embassy_client",
    name: "Visa déposé à l'ambassade — client",
    category: "Visa",
    subject: "Votre dossier visa a été déposé à l'ambassade — {{visa_reference}}",
    bodyHtml: shell("Dossier déposé à l'ambassade", "<p>Bonjour {{client_name}},</p><p>Votre dossier visa <strong>{{visa_reference}}</strong> a été déposé à l'ambassade du Japon.</p>"),
    bodyText: "Bonjour {{client_name}},\n\nVotre dossier visa {{visa_reference}} a été déposé à l'ambassade du Japon.\n\nL'équipe LeJapon.ma",
    allowedVariables: common,
    requiredVariables: ["client_name", "visa_reference"],
  },
  {
    key: "visa_approved_client",
    name: "Visa approuvé — client",
    category: "Visa",
    subject: "Votre visa Japon est approuvé — {{visa_reference}}",
    bodyHtml: shell("Visa approuvé", "<p>Bonjour {{client_name}},</p><p>Bonne nouvelle : votre visa <strong>{{visa_reference}}</strong> a été approuvé.</p>"),
    bodyText: "Bonjour {{client_name}},\n\nBonne nouvelle : votre visa {{visa_reference}} a été approuvé.\n\nL'équipe LeJapon.ma",
    allowedVariables: common,
    requiredVariables: ["client_name", "visa_reference"],
  },
  {
    key: "visa_rejected_or_issue_client",
    name: "Visa refusé / complément demandé — client",
    category: "Visa",
    subject: "Mise à jour importante concernant votre visa — {{visa_reference}}",
    bodyHtml: shell("Mise à jour visa", "<p>Bonjour {{client_name}},</p><p>Une mise à jour importante concerne votre demande visa <strong>{{visa_reference}}</strong>.</p><p>Statut : {{status}}</p>"),
    bodyText: "Bonjour {{client_name}},\n\nUne mise à jour importante concerne votre demande visa {{visa_reference}}.\nStatut : {{status}}\n\nL'équipe LeJapon.ma",
    allowedVariables: common,
    requiredVariables: ["client_name", "visa_reference", "status"],
  },
  {
    key: "agency_onboarding_submitted_admin",
    name: "Dossier agence soumis — admin",
    category: "Agences",
    subject: "Nouveau dossier partenaire — {{agency_name}}",
    bodyHtml: shell("Nouveau dossier partenaire", "<p>L'agence <strong>{{agency_name}}</strong> a soumis son dossier partenaire.</p><p><a href=\"{{admin_link}}\">Ouvrir le dossier</a></p>"),
    bodyText: "Nouveau dossier partenaire : {{agency_name}}\nOuvrir : {{admin_link}}",
    allowedVariables: common,
    requiredVariables: ["agency_name", "admin_link"],
  },
  {
    key: "agency_onboarding_approved_agency",
    name: "Dossier agence approuvé",
    category: "Agences",
    subject: "Votre partenariat LeJapon.ma est approuvé",
    bodyHtml: shell("Partenariat approuvé", "<p>Bonjour {{agency_name}},</p><p>Votre dossier partenaire LeJapon.ma est approuvé.</p>"),
    bodyText: "Bonjour {{agency_name}},\n\nVotre dossier partenaire LeJapon.ma est approuvé.\n\nL'équipe LeJapon.ma",
    allowedVariables: common,
    requiredVariables: ["agency_name"],
  },
  {
    key: "agency_booking_new_admin",
    name: "Nouvelle réservation agence — admin",
    category: "Agences",
    subject: "Nouvelle réservation agence — {{agency_name}} — {{client_name}}",
    bodyHtml: shell("Nouvelle réservation agence", "<p><strong>Agence :</strong> {{agency_name}}<br/><strong>Client :</strong> {{client_name}}<br/><strong>Voyage :</strong> {{trip_title}}</p><p><a href=\"{{admin_link}}\">Ouvrir</a></p>"),
    bodyText: "Nouvelle réservation agence\nAgence : {{agency_name}}\nClient : {{client_name}}\nVoyage : {{trip_title}}\nOuvrir : {{admin_link}}",
    allowedVariables: common,
    requiredVariables: ["agency_name", "client_name", "trip_title"],
  },
  {
    key: "agency_payment_new_admin",
    name: "Nouveau paiement agence — admin",
    category: "Agences",
    subject: "Nouveau paiement agence — {{agency_name}} — {{amount}}",
    bodyHtml: shell("Nouveau paiement agence", "<p>L'agence <strong>{{agency_name}}</strong> a enregistré un paiement de <strong>{{amount}}</strong>.</p>"),
    bodyText: "Nouveau paiement agence\nAgence : {{agency_name}}\nMontant : {{amount}}",
    allowedVariables: common,
    requiredVariables: ["agency_name", "amount"],
  },
  {
    key: "agency_booking_confirmation_client",
    name: "Confirmation réservation agence — client",
    category: "Agences",
    subject: "Votre réservation via {{agency_name}} est bien enregistrée",
    bodyHtml: shell("Réservation enregistrée", "<p>Bonjour {{client_name}},</p><p>Votre réservation pour <strong>{{trip_title}}</strong> est bien enregistrée via notre agence partenaire <strong>{{agency_name}}</strong>.</p>"),
    bodyText: "Bonjour {{client_name}},\n\nVotre réservation pour {{trip_title}} est bien enregistrée via {{agency_name}}.\n\nL'équipe LeJapon.ma",
    allowedVariables: common,
    requiredVariables: ["client_name", "trip_title", "agency_name"],
  },
  {
    key: "supplier_quote_requested",
    name: "Demande devis fournisseur",
    category: "Fournisseurs",
    subject: "Demande de devis Bureau Japon — {{trip_title}}",
    bodyHtml: shell("Demande de devis", "<p>Merci de préparer un devis pour le voyage <strong>{{trip_title}}</strong>.</p><p><a href=\"{{admin_link}}\">Ouvrir le devis</a></p>"),
    bodyText: "Demande de devis pour {{trip_title}}\nOuvrir : {{admin_link}}",
    allowedVariables: common,
    requiredVariables: ["trip_title", "admin_link"],
  },
  {
    key: "supplier_quote_submitted_admin",
    name: "Devis fournisseur soumis — admin",
    category: "Fournisseurs",
    subject: "Devis fournisseur soumis — {{trip_title}}",
    bodyHtml: shell("Devis fournisseur soumis", "<p>Le devis fournisseur pour <strong>{{trip_title}}</strong> a été soumis.</p><p><a href=\"{{admin_link}}\">Ouvrir</a></p>"),
    bodyText: "Devis fournisseur soumis pour {{trip_title}}\nOuvrir : {{admin_link}}",
    allowedVariables: common,
    requiredVariables: ["trip_title", "admin_link"],
  },
  {
    key: "supplier_row_assigned",
    name: "Ligne devis assignée",
    category: "Fournisseurs",
    subject: "Une ligne de devis vous est assignée — {{trip_title}}",
    bodyHtml: shell("Ligne assignée", "<p>Une ligne de devis vous est assignée pour <strong>{{trip_title}}</strong>.</p><p><a href=\"{{admin_link}}\">Ouvrir</a></p>"),
    bodyText: "Une ligne de devis vous est assignée pour {{trip_title}}\nOuvrir : {{admin_link}}",
    allowedVariables: common,
    requiredVariables: ["trip_title", "admin_link"],
  },
  {
    key: "password_reset_custom",
    name: "Réinitialisation mot de passe",
    category: "Système",
    subject: "Réinitialisation de votre mot de passe LeJapon.ma",
    bodyHtml: shell("Réinitialisation mot de passe", "<p>Bonjour {{client_name}},</p><p>Vous pouvez réinitialiser votre mot de passe avec le lien ci-dessous.</p><p><a href=\"{{download_link}}\">Réinitialiser</a></p>"),
    bodyText: "Bonjour {{client_name}},\n\nRéinitialisez votre mot de passe : {{download_link}}\n\nL'équipe LeJapon.ma",
    allowedVariables: common,
    requiredVariables: ["download_link"],
  },
  {
    key: "user_invitation",
    name: "Invitation utilisateur",
    category: "Système",
    subject: "Invitation à rejoindre LeJapon.ma",
    bodyHtml: shell("Invitation LeJapon.ma", "<p>Bonjour {{client_name}},</p><p>Vous êtes invité à rejoindre l'espace LeJapon.ma.</p><p><a href=\"{{download_link}}\">Accéder à votre compte</a></p>"),
    bodyText: "Bonjour {{client_name}},\n\nVous êtes invité à rejoindre l'espace LeJapon.ma : {{download_link}}\n\nL'équipe LeJapon.ma",
    allowedVariables: common,
    requiredVariables: ["download_link"],
  },
];

export const extractTemplateVariables = (content: string) =>
  Array.from(new Set(Array.from(content.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)).map((match) => match[1]))).sort();

export function renderEmailTemplateString(content: string, variables: Record<string, unknown>) {
  return sanitizeEmailBranding(content).replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
    const value = variables[key];
    return value === null || value === undefined || value === "" ? "Non renseigné" : sanitizeEmailBranding(value);
  });
}

export function sampleVariablesForTemplate(definition: EmailTemplateDefinition) {
  const defaults: Record<string, string> = {
    client_name: "Yassine Amrani",
    booking_reference: "LJ-2026-042",
    trip_title: "Tokyo, Kyoto & Osaka",
    amount: "12 000 MAD",
    payment_method: "Virement bancaire",
    visa_reference: "VISA-2026-018",
    passport_number: "AB1234567",
    agency_name: "Agence Sakura Travel",
    admin_link: "https://www.lejapon.ma/admin",
    download_link: "https://www.lejapon.ma/visa-japon-maroc",
    status: "Confirmé",
    date: "05/06/2026",
    message: "Votre dossier avance normalement.",
  };
  return Object.fromEntries(definition.allowedVariables.map((key) => [key, defaults[key] ?? `Exemple ${key}`]));
}
