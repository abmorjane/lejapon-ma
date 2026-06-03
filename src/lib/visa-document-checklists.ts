export type ProfessionalSituationKey =
  | "salarie_prive"
  | "fonctionnaire"
  | "chef_entreprise"
  | "profession_liberale"
  | "etudiant"
  | "retraite"
  | "sans_emploi"
  | "autre";

export type CrmProfessionalSituationKey =
  | "private_employee"
  | "civil_servant"
  | "business_owner"
  | "liberal_profession"
  | "student"
  | "retired"
  | "unemployed"
  | "other";

export type VisaChecklistItem = {
  id?: string;
  title_fr: string;
  title_en?: string | null;
  title_ar?: string | null;
  notes?: string | null;
  required: boolean;
  original_required: boolean;
  copy_upload_required: boolean;
  active: boolean;
  display_order: number;
};

export type VisaChecklistConfig = {
  id: string;
  category: string;
  label: string;
  description?: string | null;
  items: VisaChecklistItem[];
  is_active?: boolean;
  sort_order?: number;
};

export const PROFESSIONAL_SITUATIONS: Array<{ value: ProfessionalSituationKey; label: string }> = [
  { value: "salarie_prive", label: "Salarié du secteur privé" },
  { value: "fonctionnaire", label: "Fonctionnaire" },
  { value: "chef_entreprise", label: "Chef d'entreprise / Gérant" },
  { value: "profession_liberale", label: "Profession libérale" },
  { value: "etudiant", label: "Étudiant" },
  { value: "retraite", label: "Retraité" },
  { value: "sans_emploi", label: "Sans emploi" },
  { value: "autre", label: "Autre" },
];

export const CRM_PROFESSIONAL_SITUATIONS: Array<{ value: CrmProfessionalSituationKey; label: string }> = [
  { value: "private_employee", label: "Salarié du secteur privé" },
  { value: "civil_servant", label: "Fonctionnaire" },
  { value: "business_owner", label: "Chef d'entreprise / Gérant" },
  { value: "liberal_profession", label: "Profession libérale" },
  { value: "student", label: "Étudiant" },
  { value: "retired", label: "Retraité" },
  { value: "unemployed", label: "Sans emploi" },
  { value: "other", label: "Autre" },
];

const CRM_TO_VISA_SITUATION: Record<CrmProfessionalSituationKey, ProfessionalSituationKey> = {
  private_employee: "salarie_prive",
  civil_servant: "fonctionnaire",
  business_owner: "chef_entreprise",
  liberal_profession: "profession_liberale",
  student: "etudiant",
  retired: "retraite",
  unemployed: "sans_emploi",
  other: "autre",
};

export const crmSituationToVisaSituation = (value?: string | null) => {
  if (!value) return "";
  return CRM_TO_VISA_SITUATION[value as CrmProfessionalSituationKey] ?? value;
};

export const professionalSituationLabel = (value?: string | null) =>
  PROFESSIONAL_SITUATIONS.find((item) => item.value === value)?.label ||
  CRM_PROFESSIONAL_SITUATIONS.find((item) => item.value === value)?.label ||
  value ||
  "Non renseignée";

export const mapProfessionTextToCrmSituation = (value?: string | null): CrmProfessionalSituationKey | "" => {
  const text = String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!text.trim()) return "";
  if (/fonctionnaire|public|etat|ministere/.test(text)) return "civil_servant";
  if (/salarie|employe|employee|secteur prive/.test(text)) return "private_employee";
  if (/etudiant|student|eleve|ecole|universite/.test(text)) return "student";
  if (/retraite|retired|pension/.test(text)) return "retired";
  if (/sans emploi|chomeur|unemployed|inactive/.test(text)) return "unemployed";
  if (/commercant|gerant|gérant|entrepreneur|patron|business|societe|dirigeant/.test(text)) return "business_owner";
  if (/medecin|médecin|avocat|architecte|notaire|pharmacien|dentiste|expert comptable|consultant/.test(text)) return "liberal_profession";
  return "";
};

const asRecord = (value: unknown): Record<string, any> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, any> : null;

export const normalizeVisaChecklistItems = (items: unknown): VisaChecklistItem[] => {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index) => {
      if (typeof item === "string") {
        const title = item.trim();
        if (!title) return null;
        return {
          id: `legacy-${index}`,
          title_fr: title,
          title_en: null,
          title_ar: null,
          notes: null,
          required: true,
          original_required: true,
          copy_upload_required: true,
          active: true,
          display_order: index + 1,
        } satisfies VisaChecklistItem;
      }
      const record = asRecord(item);
      if (!record) return null;
      const title = String(record.title_fr ?? record.title ?? record.label ?? "").trim();
      if (!title) return null;
      return {
        id: String(record.id ?? `item-${index}`),
        title_fr: title,
        title_en: record.title_en ? String(record.title_en) : null,
        title_ar: record.title_ar ? String(record.title_ar) : null,
        notes: record.notes ?? record.description ? String(record.notes ?? record.description) : null,
        required: record.required !== false,
        original_required: record.original_required === true,
        copy_upload_required: record.copy_upload_required !== false,
        active: record.active !== false,
        display_order: Number(record.display_order ?? index + 1),
      } satisfies VisaChecklistItem;
    })
    .filter((item): item is VisaChecklistItem => Boolean(item))
    .filter((item) => item.active)
    .sort((a, b) => a.display_order - b.display_order);
};

export const normalizeVisaChecklistConfig = (row: any): VisaChecklistConfig => ({
  id: String(row.id),
  category: String(row.category ?? ""),
  label: String(row.label ?? row.category ?? ""),
  description: row.description ?? null,
  items: normalizeVisaChecklistItems(row.items),
  is_active: row.is_active !== false,
  sort_order: Number(row.sort_order ?? 0),
});

export const findChecklistForSituation = (rows: any[], situation?: string | null) => {
  const configs = (rows ?? []).map(normalizeVisaChecklistConfig).filter((row) => row.is_active !== false);
  const normalizedSituation = crmSituationToVisaSituation(situation);
  return configs.find((row) => row.category === situation || row.category === normalizedSituation) ?? null;
};

export const checklistSnapshotText = (items: VisaChecklistItem[]) =>
  items.map((item, index) => {
    const flags = [
      item.required ? "obligatoire" : "si applicable",
      item.original_required ? "original requis" : null,
      item.copy_upload_required ? "copie / scan requis" : null,
    ].filter(Boolean).join(", ");
    return `${index + 1}. ${item.title_fr}${flags ? ` (${flags})` : ""}${item.notes ? ` — ${item.notes}` : ""}`;
  }).join("\n");

export const checklistItemsForStorage = (items: VisaChecklistItem[]) =>
  items.map((item, index) => ({
    ...item,
    display_order: item.display_order || index + 1,
  }));
