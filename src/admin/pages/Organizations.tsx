import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Building2,
  CheckCircle2,
  Edit,
  Loader2,
  PauseCircle,
  Percent,
  Plus,
  RefreshCw,
  Search,
  ShieldOff,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/admin/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type OrganizationType = "internal" | "agency" | "japan_partner" | "supplier";
type OrganizationStatus = "pending" | "active" | "suspended" | "archived";
type OrganizationRole = "owner" | "admin" | "agent" | "finance" | "operations" | "viewer";
type MemberStatus = "active" | "suspended";
type CommissionScopeType = "global" | "destination" | "product";
type CommissionType = "percentage" | "fixed_amount";
type CommissionAppliesTo = "booking_total" | "base_trip_price";
type CommissionStatus = "active" | "inactive" | "archived";

type OrganizationRow = {
  id: string;
  type: OrganizationType;
  status: OrganizationStatus;
  display_name: string;
  legal_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  tax_identifier: string | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

type OrganizationForm = {
  display_name: string;
  type: OrganizationType;
  status: OrganizationStatus;
  legal_name: string;
  email: string;
  phone: string;
  website: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  postal_code: string;
  country: string;
  tax_identifier: string;
  notes: string;
};

type OrganizationMemberRow = {
  id: string;
  organization_id: string;
  user_id: string;
  role: OrganizationRole;
  status: MemberStatus;
  created_by: string | null;
  created_at: string | null;
  profile?: OrganizationMemberProfileRow | null;
};

type OrganizationMemberProfileRow = {
  id: string;
  organization_member_id: string;
  user_id: string;
  organization_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  secondary_phone: string | null;
  secondary_email: string | null;
  position_title: string | null;
  point_of_sale: string | null;
  notes: string | null;
};

type OrganizationDeleteCheck = {
  organization: OrganizationRow;
  checking: boolean;
  blockers: string[];
  warnings: string[];
  membersCount: number;
};

type OnboardingReview = {
  organization: OrganizationRow;
  caseRow: Record<string, any> | null;
  agencyProfile: AgencyProfileRow | null;
  documents: Record<string, any>[];
  loading: boolean;
  error: string | null;
};

type ExistingUserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone?: string | null;
  created_at: string | null;
};

type ExternalUserForm = {
  full_name: string;
  email: string;
  phone: string;
  role: OrganizationRole;
};

type ExternalUserResult = {
  user_id: string;
  member_id: string;
  temporary_password: string | null;
  email_sent: boolean | null;
  raw: unknown;
};

type AgencyProfileRow = {
  organization_id: string;
  agency_code: string | null;
  commercial_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website: string | null;
  market_country: string | null;
  preferred_language: string | null;
  billing_legal_name: string | null;
  billing_email: string | null;
  billing_phone: string | null;
  billing_address_line_1: string | null;
  billing_address_line_2: string | null;
  billing_city: string | null;
  billing_postal_code: string | null;
  billing_country: string | null;
  tax_identifier: string | null;
  payment_terms: string | null;
  default_commission_type: CommissionType | null;
  default_commission_value: number | null;
  commission_currency: string | null;
  commission_notes: string | null;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  commercial_notes: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type AgencyProfileForm = Omit<AgencyProfileRow, "organization_id" | "created_at" | "updated_at"> & {
  default_commission_value: string;
};

type CommissionRuleRow = {
  id: string;
  organization_id: string;
  scope: CommissionScopeType;
  destination: string | null;
  product_trip_id: string | null;
  rule_name: string | null;
  commission_type: CommissionType;
  commission_value: number;
  currency: string;
  applies_to: CommissionAppliesTo;
  effective_from: string;
  effective_to: string | null;
  status: CommissionStatus;
  priority: number | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type CommissionRuleForm = {
  scope: CommissionScopeType;
  destination: string;
  product_trip_id: string;
  rule_name: string;
  commission_type: CommissionType;
  commission_value: string;
  currency: string;
  applies_to: CommissionAppliesTo;
  effective_from: string;
  effective_to: string;
  status: CommissionStatus;
  priority: string;
  notes: string;
};

type TripOption = {
  id: string;
  title: string;
};

type DbClient = {
  from: (table: string) => any;
};

const db = supabase as unknown as DbClient;

const ORGANIZATION_COLUMNS = [
  "id",
  "type",
  "status",
  "display_name",
  "legal_name",
  "email",
  "phone",
  "website",
  "address_line_1",
  "address_line_2",
  "city",
  "postal_code",
  "country",
  "tax_identifier",
  "notes",
  "metadata",
  "created_at",
  "updated_at",
].join(",");

const ORGANIZATION_MEMBER_COLUMNS = [
  "id",
  "organization_id",
  "user_id",
  "role",
  "status",
  "created_by",
  "created_at",
].join(",");

const ORGANIZATION_MEMBER_PROFILE_COLUMNS = [
  "id",
  "organization_member_id",
  "user_id",
  "organization_id",
  "full_name",
  "email",
  "phone",
  "secondary_phone",
  "secondary_email",
  "position_title",
  "point_of_sale",
  "notes",
].join(",");

const AGENCY_PROFILE_COLUMNS = [
  "organization_id",
  "agency_code",
  "commercial_name",
  "contact_name",
  "contact_email",
  "contact_phone",
  "website",
  "market_country",
  "preferred_language",
  "billing_legal_name",
  "billing_email",
  "billing_phone",
  "billing_address_line_1",
  "billing_address_line_2",
  "billing_city",
  "billing_postal_code",
  "billing_country",
  "tax_identifier",
  "payment_terms",
  "default_commission_type",
  "default_commission_value",
  "commission_currency",
  "commission_notes",
  "bank_name",
  "bank_account_name",
  "bank_account_number",
  "commercial_notes",
  "notes",
  "created_at",
  "updated_at",
].join(",");

const COMMISSION_RULE_COLUMNS = [
  "id",
  "organization_id",
  "scope",
  "destination",
  "product_trip_id",
  "rule_name",
  "commission_type",
  "commission_value",
  "currency",
  "applies_to",
  "effective_from",
  "effective_to",
  "status",
  "priority",
  "notes",
  "metadata",
  "created_by",
  "created_at",
  "updated_at",
].join(",");

const TYPE_LABELS: Record<OrganizationType, string> = {
  internal: "Interne",
  agency: "Agence",
  japan_partner: "Partenaire Japon",
  supplier: "Fournisseur",
};

const STATUS_LABELS: Record<OrganizationStatus, string> = {
  pending: "Pending",
  active: "Active",
  suspended: "Suspendue",
  archived: "Archivée",
};

const ROLE_LABELS: Record<OrganizationRole, string> = {
  owner: "Owner",
  admin: "Admin organisation",
  agent: "Agent",
  finance: "Finance",
  operations: "Operations",
  viewer: "Viewer",
};

const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  active: "Actif",
  suspended: "Suspendu",
};

const ORGANIZATION_ROLES: OrganizationRole[] = [
  "owner",
  "admin",
  "agent",
  "finance",
  "operations",
  "viewer",
];

const COMMISSION_STATUS_LABELS: Record<CommissionStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  archived: "Archivée",
};

const defaultAgencyProfileForm = (): AgencyProfileForm => ({
  agency_code: "",
  commercial_name: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  website: "",
  market_country: "",
  preferred_language: "",
  billing_legal_name: "",
  billing_email: "",
  billing_phone: "",
  billing_address_line_1: "",
  billing_address_line_2: "",
  billing_city: "",
  billing_postal_code: "",
  billing_country: "",
  tax_identifier: "",
  payment_terms: "",
  default_commission_type: "percentage",
  default_commission_value: "",
  commission_currency: "MAD",
  commission_notes: "",
  bank_name: "",
  bank_account_name: "",
  bank_account_number: "",
  commercial_notes: "",
  notes: "",
});

const toAgencyProfileForm = (profile: AgencyProfileRow | null): AgencyProfileForm => {
  if (!profile) return defaultAgencyProfileForm();
  return {
    agency_code: profile.agency_code ?? "",
    commercial_name: profile.commercial_name ?? "",
    contact_name: profile.contact_name ?? "",
    contact_email: profile.contact_email ?? "",
    contact_phone: profile.contact_phone ?? "",
    website: profile.website ?? "",
    market_country: profile.market_country ?? "",
    preferred_language: profile.preferred_language ?? "",
    billing_legal_name: profile.billing_legal_name ?? "",
    billing_email: profile.billing_email ?? "",
    billing_phone: profile.billing_phone ?? "",
    billing_address_line_1: profile.billing_address_line_1 ?? "",
    billing_address_line_2: profile.billing_address_line_2 ?? "",
    billing_city: profile.billing_city ?? "",
    billing_postal_code: profile.billing_postal_code ?? "",
    billing_country: profile.billing_country ?? "",
    tax_identifier: profile.tax_identifier ?? "",
    payment_terms: profile.payment_terms ?? "",
    default_commission_type: profile.default_commission_type ?? "percentage",
    default_commission_value: profile.default_commission_value == null ? "" : String(profile.default_commission_value),
    commission_currency: profile.commission_currency ?? "MAD",
    commission_notes: profile.commission_notes ?? "",
    bank_name: profile.bank_name ?? "",
    bank_account_name: profile.bank_account_name ?? "",
    bank_account_number: profile.bank_account_number ?? "",
    commercial_notes: profile.commercial_notes ?? "",
    notes: profile.notes ?? "",
  };
};

const defaultRuleForm = (): CommissionRuleForm => ({
  scope: "global",
  destination: "",
  product_trip_id: "",
  rule_name: "",
  commission_type: "percentage",
  commission_value: "",
  currency: "MAD",
  applies_to: "booking_total",
  effective_from: new Date().toISOString().slice(0, 10),
  effective_to: "",
  status: "active",
  priority: "100",
  notes: "",
});

const toRuleForm = (rule: CommissionRuleRow): CommissionRuleForm => ({
  scope: rule.scope,
  destination: rule.destination ?? "",
  product_trip_id: rule.product_trip_id ?? "",
  rule_name: rule.rule_name ?? "",
  commission_type: rule.commission_type,
  commission_value: String(rule.commission_value ?? ""),
  currency: rule.currency ?? "MAD",
  applies_to: rule.applies_to ?? "booking_total",
  effective_from: rule.effective_from ?? new Date().toISOString().slice(0, 10),
  effective_to: rule.effective_to ?? "",
  status: rule.status ?? "active",
  priority: rule.priority == null ? "100" : String(rule.priority),
  notes: rule.notes ?? "",
});

const defaultForm = (): OrganizationForm => ({
  display_name: "",
  type: "agency",
  status: "active",
  legal_name: "",
  email: "",
  phone: "",
  website: "",
  address_line_1: "",
  address_line_2: "",
  city: "",
  postal_code: "",
  country: "",
  tax_identifier: "",
  notes: "",
});

const defaultExternalUserForm = (): ExternalUserForm => ({
  full_name: "",
  email: "",
  phone: "",
  role: "agent",
});

const toForm = (organization: OrganizationRow): OrganizationForm => ({
  display_name: organization.display_name ?? "",
  type: organization.type ?? "agency",
  status: organization.status ?? "active",
  legal_name: organization.legal_name ?? "",
  email: organization.email ?? "",
  phone: organization.phone ?? "",
  website: organization.website ?? "",
  address_line_1: organization.address_line_1 ?? "",
  address_line_2: organization.address_line_2 ?? "",
  city: organization.city ?? "",
  postal_code: organization.postal_code ?? "",
  country: organization.country ?? "",
  tax_identifier: organization.tax_identifier ?? "",
  notes: organization.notes ?? "",
});

const clean = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const cleanUnknown = (value: unknown) => (typeof value === "string" && value.trim().length ? value.trim() : null);

const normalizeOnboardingMetadata = (metadata: Record<string, any> | null | undefined) => {
  const agency = metadata?.agency_information ?? metadata?.agencyInfo ?? {};
  const contact = metadata?.contact_person ?? metadata?.contactPerson ?? {};
  return {
    agency_information: {
      legal_name: cleanUnknown(agency.legal_name),
      commercial_name: cleanUnknown(agency.commercial_name),
      registration_number: cleanUnknown(agency.registration_number),
      tax_number: cleanUnknown(agency.tax_number),
      website: cleanUnknown(agency.website),
      address: cleanUnknown(agency.address),
      city: cleanUnknown(agency.city),
      country: cleanUnknown(agency.country),
    },
    contact_person: {
      full_name: cleanUnknown(contact.full_name),
      position: cleanUnknown(contact.position),
      email: cleanUnknown(contact.email),
      phone: cleanUnknown(contact.phone),
    },
    documents: metadata?.documents && typeof metadata.documents === "object" ? metadata.documents : {},
    digital_signature_acknowledged: Boolean(metadata?.digital_signature_acknowledged),
    digital_signature_acknowledged_at: metadata?.digital_signature_acknowledged_at ?? null,
  };
};

const buildOnboardingDisplayData = (
  metadata: ReturnType<typeof normalizeOnboardingMetadata> | null,
  agencyProfile: AgencyProfileRow | null,
  organization: OrganizationRow | null
) => ({
  agency_information: {
    legal_name: metadata?.agency_information.legal_name ?? agencyProfile?.billing_legal_name ?? organization?.legal_name ?? null,
    commercial_name: metadata?.agency_information.commercial_name ?? agencyProfile?.commercial_name ?? organization?.display_name ?? null,
    registration_number: metadata?.agency_information.registration_number ?? agencyProfile?.agency_code ?? null,
    tax_number: metadata?.agency_information.tax_number ?? agencyProfile?.tax_identifier ?? organization?.tax_identifier ?? null,
    website: metadata?.agency_information.website ?? agencyProfile?.website ?? organization?.website ?? null,
    address: metadata?.agency_information.address ?? agencyProfile?.billing_address_line_1 ?? organization?.address_line_1 ?? null,
    city: metadata?.agency_information.city ?? agencyProfile?.billing_city ?? organization?.city ?? null,
    country: metadata?.agency_information.country ?? agencyProfile?.billing_country ?? organization?.country ?? null,
  },
  contact_person: {
    full_name: metadata?.contact_person.full_name ?? agencyProfile?.contact_name ?? null,
    position: metadata?.contact_person.position ?? null,
    email: metadata?.contact_person.email ?? agencyProfile?.contact_email ?? organization?.email ?? null,
    phone: metadata?.contact_person.phone ?? agencyProfile?.contact_phone ?? organization?.phone ?? null,
  },
  documents: metadata?.documents ?? {},
  digital_signature_acknowledged: metadata?.digital_signature_acknowledged ?? false,
  digital_signature_acknowledged_at: metadata?.digital_signature_acknowledged_at ?? null,
});

const formToPayload = (form: OrganizationForm) => ({
  display_name: form.display_name.trim(),
  type: form.type,
  status: form.status,
  legal_name: clean(form.legal_name),
  email: clean(form.email),
  phone: clean(form.phone),
  website: clean(form.website),
  address_line_1: clean(form.address_line_1),
  address_line_2: clean(form.address_line_2),
  city: clean(form.city),
  postal_code: clean(form.postal_code),
  country: clean(form.country),
  tax_identifier: clean(form.tax_identifier),
  notes: clean(form.notes),
});

const statusBadgeClass = (status: OrganizationStatus) =>
  ({
    pending: "border-sky-200 bg-sky-50 text-sky-700",
    active: "border-emerald-200 bg-emerald-50 text-emerald-700",
    suspended: "border-amber-200 bg-amber-50 text-amber-800",
    archived: "border-stone-200 bg-stone-50 text-stone-600",
  })[status];

const isMissingTableError = (message: string) =>
  /organizations|schema cache|relation .* does not exist|could not find/i.test(message);

const isMissingMembersTableError = (message: string) =>
  /organization_members|schema cache|relation .* does not exist|could not find/i.test(message);

const memberDisplay = (member: OrganizationMemberRow, fallbackUser?: ExistingUserRow) => ({
  full_name: member.profile?.full_name || fallbackUser?.full_name || "—",
  email: member.profile?.email || fallbackUser?.email || member.user_id,
  phone: member.profile?.phone || fallbackUser?.phone || null,
});

const isMissingAgencyProfileTableError = (message: string) =>
  /agency_profiles|schema cache|relation .* does not exist|could not find/i.test(message);

const isMissingCommissionRulesTableError = (message: string) =>
  /commission_engine_rules|commission_rules|schema cache|relation .* does not exist|could not find/i.test(message);

const isMissingOptionalRelationError = (message: string) =>
  /schema cache|relation .* does not exist|does not exist|could not find|column .* does not exist/i.test(message);

const ACTIVE_BOOKING_STATUSES = ["lead", "confirmed", "paid"];

export default function OrganizationsAdmin() {
  const { user, isSuperAdmin } = useAuth();
  const [organizations, setOrganizations] = useState<OrganizationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [memberBusy, setMemberBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | OrganizationType>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | OrganizationStatus>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<OrganizationRow | null>(null);
  const [form, setForm] = useState<OrganizationForm>(defaultForm);
  const [statusAction, setStatusAction] = useState<{
    organization: OrganizationRow;
    status: OrganizationStatus;
  } | null>(null);
  const [deleteCheck, setDeleteCheck] = useState<OrganizationDeleteCheck | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [onboardingReview, setOnboardingReview] = useState<OnboardingReview | null>(null);
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [memberOrganization, setMemberOrganization] = useState<OrganizationRow | null>(null);
  const [members, setMembers] = useState<OrganizationMemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [existingUsers, setExistingUsers] = useState<ExistingUserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRole, setSelectedRole] = useState<OrganizationRole>("agent");
  const [externalUserForm, setExternalUserForm] = useState<ExternalUserForm>(defaultExternalUserForm);
  const [externalUserResult, setExternalUserResult] = useState<ExternalUserResult | null>(null);
  const [memberAction, setMemberAction] = useState<{
    member: OrganizationMemberRow;
    type: "remove" | "suspend" | "reactivate";
  } | null>(null);
  const [agencyProfileOpen, setAgencyProfileOpen] = useState(false);
  const [agencyOrganization, setAgencyOrganization] = useState<OrganizationRow | null>(null);
  const [agencyProfile, setAgencyProfile] = useState<AgencyProfileRow | null>(null);
  const [agencyProfileForm, setAgencyProfileForm] = useState<AgencyProfileForm>(defaultAgencyProfileForm);
  const [agencyProfileLoading, setAgencyProfileLoading] = useState(false);
  const [agencyProfileSaving, setAgencyProfileSaving] = useState(false);
  const [agencyProfileError, setAgencyProfileError] = useState<string | null>(null);
  const [commissionRules, setCommissionRules] = useState<CommissionRuleRow[]>([]);
  const [commissionRulesLoading, setCommissionRulesLoading] = useState(false);
  const [commissionRulesError, setCommissionRulesError] = useState<string | null>(null);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<CommissionRuleRow | null>(null);
  const [ruleForm, setRuleForm] = useState<CommissionRuleForm>(defaultRuleForm);
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleAction, setRuleAction] = useState<CommissionRuleRow | null>(null);
  const [trips, setTrips] = useState<TripOption[]>([]);

  const loadOrganizations = async () => {
    if (!isSuperAdmin) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);

    const { data, error } = await db
      .from("organizations")
      .select(ORGANIZATION_COLUMNS)
      .order("updated_at", { ascending: false, nullsFirst: false });

    if (error) {
      const message = error.message ?? "Impossible de charger les organisations.";
      setLoadError(
        isMissingTableError(message)
          ? "La table public.organizations est introuvable ou non accessible. Vérifiez que la migration V2.0.0 Foundation est appliquée dans Lovable/Supabase."
          : message
      );
      setOrganizations([]);
    } else {
      setOrganizations((data ?? []) as OrganizationRow[]);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadOrganizations();
  }, [isSuperAdmin]);

  const filteredOrganizations = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return organizations.filter((organization) => {
      if (!showArchived && statusFilter !== "archived" && organization.status === "archived") return false;
      if (typeFilter !== "all" && organization.type !== typeFilter) return false;
      if (statusFilter !== "all" && organization.status !== statusFilter) return false;
      if (!needle) return true;

      return [organization.display_name, organization.legal_name, organization.email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [organizations, query, showArchived, statusFilter, typeFilter]);

  const counts = useMemo(
    () => ({
      total: organizations.length,
      visible: filteredOrganizations.length,
      archived: organizations.filter((organization) => organization.status === "archived").length,
    }),
    [filteredOrganizations.length, organizations]
  );

  const userById = useMemo(() => {
    const map = new Map<string, ExistingUserRow>();
    existingUsers.forEach((existingUser) => map.set(existingUser.id, existingUser));
    return map;
  }, [existingUsers]);

  const filteredExistingUsers = useMemo(() => {
    const needle = userSearch.trim().toLowerCase();
    const list = needle
      ? existingUsers.filter((existingUser) =>
          [existingUser.email, existingUser.full_name]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(needle))
        )
      : existingUsers;

    return list.slice(0, 80);
  }, [existingUsers, userSearch]);

  const existingUserOptions = useMemo(() => {
    if (!selectedUserId) return filteredExistingUsers;
    const selected = existingUsers.find((existingUser) => existingUser.id === selectedUserId);
    if (!selected || filteredExistingUsers.some((existingUser) => existingUser.id === selectedUserId)) {
      return filteredExistingUsers;
    }
    return [selected, ...filteredExistingUsers];
  }, [existingUsers, filteredExistingUsers, selectedUserId]);

  const activeRules = useMemo(
    () => commissionRules.filter((rule) => rule.status === "active"),
    [commissionRules]
  );

  const tripById = useMemo(() => {
    const map = new Map<string, TripOption>();
    trips.forEach((trip) => map.set(trip.id, trip));
    return map;
  }, [trips]);

  const openCreate = () => {
    setEditing(null);
    setForm(defaultForm());
    setDialogOpen(true);
  };

  const openEdit = (organization: OrganizationRow) => {
    setEditing(organization);
    setForm(toForm(organization));
    setDialogOpen(true);
  };

  const saveOrganization = async () => {
    if (!form.display_name.trim()) {
      toast.error("Le nom affiché est obligatoire.");
      return;
    }

    setSaving(true);
    const payload = formToPayload(form);

    const request = editing
      ? db.from("organizations").update(payload).eq("id", editing.id).select(ORGANIZATION_COLUMNS).single()
      : db.from("organizations").insert(payload).select(ORGANIZATION_COLUMNS).single();

    const { data, error } = await request;

    if (error) {
      toast.error(error.message ?? "Impossible d'enregistrer l'organisation.");
      setSaving(false);
      return;
    }

    const saved = data as OrganizationRow;
    setOrganizations((current) =>
      editing
        ? current.map((organization) => (organization.id === saved.id ? saved : organization))
        : [saved, ...current]
    );
    toast.success(editing ? "Organisation mise à jour." : "Organisation créée.");
    setDialogOpen(false);
    setSaving(false);
  };

  const changeStatus = async () => {
    if (!statusAction) return;
    setSaving(true);

    const { data, error } = await db
      .from("organizations")
      .update({ status: statusAction.status })
      .eq("id", statusAction.organization.id)
      .select(ORGANIZATION_COLUMNS)
      .single();

    if (error) {
      toast.error(error.message ?? "Impossible de changer le statut.");
      setSaving(false);
      return;
    }

    const updated = data as OrganizationRow;
    setOrganizations((current) =>
      current.map((organization) => (organization.id === updated.id ? updated : organization))
    );
    toast.success(`Organisation ${STATUS_LABELS[updated.status].toLowerCase()}.`);
    setStatusAction(null);
    setSaving(false);
  };

  const countLinkedRows = async (
    table: string,
    column: string,
    value: string,
    options: { optional?: boolean; label: string }
  ) => {
    const { count, error } = await db
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq(column, value);

    if (!error) return { count: count ?? 0, warning: null as string | null, blocker: null as string | null };

    const message = error.message ?? `Impossible de vérifier ${options.label}.`;
    if (options.optional && isMissingOptionalRelationError(message)) {
      return {
        count: 0,
        warning: `${options.label}: table/colonne absente, vérification ignorée.`,
        blocker: null,
      };
    }

    return {
      count: 0,
      warning: null,
      blocker: `${options.label}: vérification impossible (${message})`,
    };
  };

  const countActiveBookings = async (organizationId: string) => {
    const { count, error } = await db
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("agency_organization_id", organizationId)
      .in("status", ACTIVE_BOOKING_STATUSES);

    if (!error) return { count: count ?? 0, warning: null as string | null, blocker: null as string | null };

    const message = error.message ?? "Impossible de vérifier les réservations actives.";
    return {
      count: 0,
      warning: null,
      blocker: `Réservations actives: vérification impossible (${message})`,
    };
  };

  const deleteOptionalRows = async (table: string, column: string, value: string, label: string) => {
    const { error } = await db.from(table).delete().eq(column, value);
    if (!error) return null;
    const message = error.message ?? `Impossible de nettoyer ${label}.`;
    if (isMissingOptionalRelationError(message)) return `${label}: table/colonne absente, nettoyage ignoré.`;
    throw new Error(`${label}: ${message}`);
  };

  const openPermanentDelete = async (organization: OrganizationRow) => {
    setDeleteConfirm("");
    setDeleteCheck({ organization, checking: true, blockers: [], warnings: [], membersCount: 0 });

    const blockers: string[] = [];
    const warnings: string[] = [];

    const checks = [
      await countActiveBookings(organization.id),
      await countLinkedRows("partner_onboarding_cases", "organization_id", organization.id, {
        optional: true,
        label: "Dossiers onboarding",
      }),
      await countLinkedRows("partner_onboarding_documents", "organization_id", organization.id, {
        optional: true,
        label: "Documents onboarding",
      }),
      await countLinkedRows("partner_contracts", "organization_id", organization.id, {
        optional: true,
        label: "Contrats partenaires",
      }),
      await countLinkedRows("commission_rules", "organization_id", organization.id, {
        optional: true,
        label: "Anciennes règles de commission",
      }),
      await countLinkedRows("commission_engine_rules", "organization_id", organization.id, {
        optional: true,
        label: "Règles de commission",
      }),
      await countLinkedRows("organization_members", "organization_id", organization.id, {
        optional: true,
        label: "Membres organisation",
      }),
    ];

    const [bookings, onboardingCases, onboardingDocuments, partnerContracts, legacyCommissionRules, commissionRules, organizationMembers] = checks;

    if (bookings.count > 0) blockers.push(`${bookings.count} réservation(s) active(s) liée(s). Annulez/terminez ces réservations avant suppression.`);
    if (onboardingCases.count > 0) warnings.push(`${onboardingCases.count} dossier(s) d'onboarding seront supprimés.`);
    if (onboardingDocuments.count > 0) warnings.push(`${onboardingDocuments.count} document(s) d'onboarding seront supprimés.`);
    if (partnerContracts.count > 0) warnings.push(`${partnerContracts.count} contrat(s) partenaire seront supprimés.`);
    if (legacyCommissionRules.count > 0) warnings.push(`${legacyCommissionRules.count} ancienne(s) règle(s) de commission seront supprimées.`);
    if (commissionRules.count > 0) warnings.push(`${commissionRules.count} règle(s) de commission seront supprimées.`);

    checks.forEach((check) => {
      if (check.warning) warnings.push(check.warning);
      if (check.blocker) blockers.push(check.blocker);
    });

    setDeleteCheck({
      organization,
      checking: false,
      blockers,
      warnings,
      membersCount: organizationMembers.count,
    });
  };

  const deleteOrganizationPermanently = async () => {
    if (!deleteCheck || deleteConfirm !== "DELETE" || deleteCheck.blockers.length > 0) return;

    setSaving(true);
    const organizationId = deleteCheck.organization.id;

    try {
      const cleanupWarnings = [
        await deleteOptionalRows("partner_contract_signatures", "organization_id", organizationId, "Signatures contrat"),
        await deleteOptionalRows("partner_contract_signatures", "agency_organization_id", organizationId, "Signatures contrat"),
        await deleteOptionalRows("partner_onboarding_documents", "organization_id", organizationId, "Documents onboarding"),
        await deleteOptionalRows("partner_contracts", "organization_id", organizationId, "Contrats partenaires"),
        await deleteOptionalRows("partner_onboarding_cases", "organization_id", organizationId, "Dossiers onboarding"),
        await deleteOptionalRows("commission_engine_rules", "organization_id", organizationId, "Règles de commission"),
        await deleteOptionalRows("commission_rules", "organization_id", organizationId, "Règles de commission"),
        await deleteOptionalRows("agency_profiles", "organization_id", organizationId, "Profil agence"),
        await deleteOptionalRows("organization_members", "organization_id", organizationId, "Membres organisation"),
      ].filter(Boolean);

      const { error } = await db.from("organizations").delete().eq("id", organizationId);

      if (error) {
        toast.error(error.message ?? "Suppression définitive impossible.");
        setSaving(false);
        return;
      }

      setOrganizations((current) => current.filter((organization) => organization.id !== organizationId));
      toast.success(
        cleanupWarnings.length
          ? `Organisation supprimée. ${cleanupWarnings.length} avertissement(s) de nettoyage ignoré(s).`
          : "Organisation supprimée définitivement."
      );
      setDeleteCheck(null);
      setDeleteConfirm("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Suppression définitive impossible.");
    }

    setSaving(false);
  };

  const openOnboardingReview = async (organization: OrganizationRow) => {
    setOnboardingReview({ organization, caseRow: null, agencyProfile: null, documents: [], loading: true, error: null });

    const [{ data, error }, profileResult] = await Promise.all([
      db
      .from("partner_onboarding_cases")
      .select("*")
      .eq("organization_id", organization.id)
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(1)
        .maybeSingle(),
      db
        .from("agency_profiles")
        .select(AGENCY_PROFILE_COLUMNS)
        .eq("organization_id", organization.id)
        .maybeSingle(),
    ]);

    let documents: Record<string, any>[] = [];
    if (data?.id) {
      const docsResult = await db
        .from("partner_onboarding_documents")
        .select("*")
        .eq("onboarding_case_id", data.id)
        .order("created_at", { ascending: false, nullsFirst: false });
      if (!docsResult.error) {
        documents = (docsResult.data ?? []) as Record<string, any>[];
      }
    }

    setOnboardingReview({
      organization,
      caseRow: (data ?? null) as Record<string, any> | null,
      agencyProfile: profileResult.error ? null : ((profileResult.data ?? null) as AgencyProfileRow | null),
      documents,
      loading: false,
      error: error?.message ?? null,
    });
  };

  const reviewOnboarding = async (status: "approved" | "rejected") => {
    if (!onboardingReview?.caseRow?.id) return;
    setOnboardingBusy(true);

    let { data: updatedCase, error: caseError } = await db
      .from("partner_onboarding_cases")
      .update({
        status,
        reviewed_by: user?.id ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", onboardingReview.caseRow.id)
      .select("*")
      .single();

    if (caseError && isMissingOptionalRelationError(caseError.message ?? "")) {
      const fallback = await db
        .from("partner_onboarding_cases")
        .update({ status })
        .eq("id", onboardingReview.caseRow.id)
        .select("*")
        .single();
      updatedCase = fallback.data;
      caseError = fallback.error;
    }

    if (caseError) {
      toast.error(caseError.message ?? "Impossible de mettre à jour le dossier onboarding.");
      setOnboardingBusy(false);
      return;
    }

    const nextOrgStatus: OrganizationStatus = status === "approved" ? "active" : "suspended";
    const { data: updatedOrganization, error: orgError } = await db
      .from("organizations")
      .update({ status: nextOrgStatus })
      .eq("id", onboardingReview.organization.id)
      .select(ORGANIZATION_COLUMNS)
      .single();

    if (orgError) {
      toast.error(orgError.message ?? "Dossier mis à jour, mais statut organisation non modifié.");
      setOnboardingReview((current) => current ? { ...current, caseRow: updatedCase as Record<string, any> } : current);
      setOnboardingBusy(false);
      return;
    }

    const organization = updatedOrganization as OrganizationRow;
    setOrganizations((current) => current.map((row) => (row.id === organization.id ? organization : row)));
    setOnboardingReview((current) => current ? { ...current, organization, caseRow: updatedCase as Record<string, any> } : current);
    toast.success(status === "approved" ? "Onboarding approuvé. Agence activée." : "Onboarding rejeté. Agence suspendue.");
    setOnboardingBusy(false);
  };

  const loadExistingUsers = async () => {
    setUsersLoading(true);
    setUsersError(null);

    const { data, error } = await supabase.functions.invoke("admin-users", {
      body: { action: "list" },
    });

    if (error) {
      setUsersError(error.message ?? "Impossible de charger les utilisateurs existants.");
      setExistingUsers([]);
    } else {
      const users = (((data as any)?.users ?? []) as any[]).map((existingUser) => ({
        id: existingUser.id,
        email: existingUser.email ?? null,
        full_name: existingUser.full_name ?? null,
        phone: existingUser.phone ?? null,
        created_at: existingUser.created_at ?? null,
      }));
      setExistingUsers(users);
    }

    setUsersLoading(false);
  };

  const loadMembers = async (organization: OrganizationRow) => {
    setMembersLoading(true);
    setMembersError(null);

    const { data, error } = await db
      .from("organization_members")
      .select(ORGANIZATION_MEMBER_COLUMNS)
      .eq("organization_id", organization.id)
      .order("created_at", { ascending: false, nullsFirst: false });

    if (error) {
      const message = error.message ?? "Impossible de charger les membres.";
      setMembersError(
        isMissingMembersTableError(message)
          ? "La table public.organization_members est introuvable ou non accessible. Vérifiez que la migration V2.0.0 Foundation est appliquée dans Lovable/Supabase."
          : message
      );
      setMembers([]);
    } else {
      const memberRows = (data ?? []) as OrganizationMemberRow[];
      let profileRows: OrganizationMemberProfileRow[] = [];
      if (memberRows.length > 0) {
        const { data: profilesData, error: profilesError } = await db
          .from("organization_member_profiles")
          .select(ORGANIZATION_MEMBER_PROFILE_COLUMNS)
          .in("organization_member_id", memberRows.map((member) => member.id));
        if (!profilesError) profileRows = (profilesData ?? []) as OrganizationMemberProfileRow[];
      }
      const profileByMemberId = new Map(profileRows.map((profile) => [profile.organization_member_id, profile]));
      setMembers(memberRows.map((member) => ({ ...member, profile: profileByMemberId.get(member.id) ?? null })));
    }

    setMembersLoading(false);
  };

  const openMembers = (organization: OrganizationRow) => {
    setMemberOrganization(organization);
    setMembersOpen(true);
    setMembers([]);
    setMembersError(null);
    setSelectedUserId("");
    setSelectedRole("agent");
    setExternalUserForm(defaultExternalUserForm());
    setExternalUserResult(null);
    setUserSearch("");
    loadMembers(organization);
    loadExistingUsers();
  };

  const addMember = async () => {
    if (!memberOrganization) return;
    if (!selectedUserId) {
      toast.error("Sélectionnez un utilisateur existant.");
      return;
    }
    if (members.some((member) => member.user_id === selectedUserId)) {
      toast.error("Cet utilisateur est déjà membre de cette organisation.");
      return;
    }

    setMemberBusy(true);
    const { data, error } = await db
      .from("organization_members")
      .insert({
        organization_id: memberOrganization.id,
        user_id: selectedUserId,
        role: selectedRole,
        status: "active",
        created_by: user?.id ?? null,
      })
      .select(ORGANIZATION_MEMBER_COLUMNS)
      .single();

    if (error) {
      const message = error.message ?? "Impossible d'ajouter le membre.";
      toast.error(/duplicate|unique/i.test(message) ? "Cet utilisateur est déjà membre de cette organisation." : message);
      setMemberBusy(false);
      return;
    }

    const member = data as OrganizationMemberRow;
    const selectedUser = existingUsers.find((existingUser) => existingUser.id === selectedUserId);
    const { data: profileData, error: profileError } = await db.from("organization_member_profiles").upsert({
      organization_member_id: member.id,
      user_id: member.user_id,
      organization_id: member.organization_id,
      full_name: selectedUser?.full_name ?? null,
      email: selectedUser?.email ?? null,
      phone: selectedUser?.phone ?? null,
    }, { onConflict: "organization_member_id" }).select(ORGANIZATION_MEMBER_PROFILE_COLUMNS).single();
    if (profileError) toast.warning(`Profil membre non créé: ${profileError.message}`);

    setMembers((current) => [{ ...member, profile: (profileData ?? null) as OrganizationMemberProfileRow | null }, ...current]);
    setSelectedUserId("");
    setSelectedRole("agent");
    toast.success("Membre ajouté à l'organisation.");
    setMemberBusy(false);
  };

  const createExternalUser = async () => {
    if (!memberOrganization) return;
    if (!externalUserForm.email.trim()) {
      toast.error("Email requis.");
      return;
    }

    setMemberBusy(true);
    setExternalUserResult(null);
    const { data, error } = await supabase.functions.invoke("admin-users", {
      body: {
        action: "create_external_user",
        organization_id: memberOrganization.id,
        email: externalUserForm.email.trim(),
        full_name: externalUserForm.full_name.trim() || null,
        phone: externalUserForm.phone.trim() || null,
        role: externalUserForm.role,
      },
    });

    if (error) {
      toast.error(error.message ?? "Impossible de créer l'utilisateur externe.");
      setMemberBusy(false);
      return;
    }

    const payload = (data ?? {}) as any;
    setExternalUserResult({
      user_id: payload.user_id,
      member_id: payload.member_id,
      temporary_password: payload.temporary_password ?? null,
      email_sent: payload.email_sent ?? null,
      raw: payload,
    });

    if (payload.temporary_password) {
      toast.warning("Utilisateur externe créé. Mot de passe provisoire à communiquer manuellement.");
    } else if (payload.reused_user) {
      toast.success("Utilisateur existant ajouté ou réutilisé dans l'organisation.");
    } else {
      toast.success("Utilisateur externe créé et ajouté à l'organisation.");
    }

    setExternalUserForm(defaultExternalUserForm());
    await Promise.all([loadMembers(memberOrganization), loadExistingUsers()]);
    setMemberBusy(false);
  };

  const updateMemberRole = async (member: OrganizationMemberRow, role: OrganizationRole) => {
    if (member.role === role) return;
    setMemberBusy(true);

    const { data, error } = await db
      .from("organization_members")
      .update({ role })
      .eq("id", member.id)
      .select(ORGANIZATION_MEMBER_COLUMNS)
      .single();

    if (error) {
      toast.error(error.message ?? "Impossible de modifier le rôle organisation.");
    } else {
      setMembers((current) => current.map((row) => (row.id === member.id ? { ...(data as OrganizationMemberRow), profile: row.profile } : row)));
      toast.success("Rôle organisation mis à jour.");
    }

    setMemberBusy(false);
  };

  const updateMemberStatus = async (member: OrganizationMemberRow, status: MemberStatus) => {
    setMemberBusy(true);

    const { data, error } = await db
      .from("organization_members")
      .update({ status })
      .eq("id", member.id)
      .select(ORGANIZATION_MEMBER_COLUMNS)
      .single();

    if (error) {
      toast.error(error.message ?? "Impossible de modifier le statut du membre.");
    } else {
      setMembers((current) => current.map((row) => (row.id === member.id ? { ...(data as OrganizationMemberRow), profile: row.profile } : row)));
      toast.success(status === "active" ? "Membre réactivé." : "Membre suspendu.");
    }

    setMemberBusy(false);
  };

  const removeMember = async (member: OrganizationMemberRow) => {
    setMemberBusy(true);

    const { error } = await db.from("organization_members").delete().eq("id", member.id);

    if (error) {
      toast.error(error.message ?? "Impossible de retirer le membre.");
    } else {
      setMembers((current) => current.filter((row) => row.id !== member.id));
      toast.success("Membre retiré de l'organisation.");
    }

    setMemberBusy(false);
  };

  const runMemberAction = async () => {
    if (!memberAction) return;
    if (memberAction.type === "remove") await removeMember(memberAction.member);
    if (memberAction.type === "suspend") await updateMemberStatus(memberAction.member, "suspended");
    if (memberAction.type === "reactivate") await updateMemberStatus(memberAction.member, "active");
    setMemberAction(null);
  };

  const loadTrips = async () => {
    const { data } = await db
      .from("trips")
      .select("id,title")
      .order("title", { ascending: true });
    setTrips(((data ?? []) as TripOption[]).filter((trip) => trip.id && trip.title));
  };

  const loadAgencyProfile = async (organization: OrganizationRow) => {
    setAgencyProfileLoading(true);
    setAgencyProfileError(null);

    const { data, error } = await db
      .from("agency_profiles")
      .select(AGENCY_PROFILE_COLUMNS)
      .eq("organization_id", organization.id)
      .maybeSingle();

    if (error) {
      const message = error.message ?? "Impossible de charger le profil agence.";
      setAgencyProfileError(
        isMissingAgencyProfileTableError(message)
          ? "La table public.agency_profiles est introuvable ou non accessible. Vérifiez que la migration V2 agency profiles est appliquée dans Lovable/Supabase."
          : message
      );
      setAgencyProfile(null);
      setAgencyProfileForm(defaultAgencyProfileForm());
    } else {
      const profile = (data ?? null) as AgencyProfileRow | null;
      setAgencyProfile(profile);
      setAgencyProfileForm(toAgencyProfileForm(profile));
    }

    setAgencyProfileLoading(false);
  };

  const loadCommissionRules = async (organization: OrganizationRow) => {
    setCommissionRulesLoading(true);
    setCommissionRulesError(null);

    const { data, error } = await db
      .from("commission_engine_rules")
      .select(COMMISSION_RULE_COLUMNS)
      .eq("organization_id", organization.id)
      .order("status", { ascending: true })
      .order("priority", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false, nullsFirst: false });

    if (error) {
      const message = error.message ?? "Impossible de charger les règles de commission.";
      setCommissionRulesError(
        isMissingCommissionRulesTableError(message)
          ? "La table public.commission_engine_rules est introuvable ou non accessible. Vérifiez que la migration V2 Commission Engine V1 est appliquée dans Lovable/Supabase."
          : message
      );
      setCommissionRules([]);
    } else {
      setCommissionRules((data ?? []) as CommissionRuleRow[]);
    }

    setCommissionRulesLoading(false);
  };

  const openAgencyProfile = (organization: OrganizationRow) => {
    setAgencyOrganization(organization);
    setAgencyProfileOpen(true);
    setAgencyProfile(null);
    setAgencyProfileForm(defaultAgencyProfileForm());
    setAgencyProfileError(null);
    setCommissionRules([]);
    setCommissionRulesError(null);
    loadAgencyProfile(organization);
    loadCommissionRules(organization);
    loadTrips();
  };

  const saveAgencyProfile = async () => {
    if (!agencyOrganization) return;

    setAgencyProfileSaving(true);
    const agencyCode = clean(agencyProfileForm.agency_code ?? "");

    if (agencyCode) {
      const { data: duplicate, error: duplicateError } = await db
        .from("agency_profiles")
        .select("organization_id,agency_code")
        .eq("agency_code", agencyCode)
        .neq("organization_id", agencyOrganization.id)
        .maybeSingle();

      if (duplicateError) {
        toast.error(duplicateError.message ?? "Impossible de vérifier le code agence.");
        setAgencyProfileSaving(false);
        return;
      }

      if (duplicate) {
        toast.error("Ce code agence est déjà utilisé par une autre organisation.");
        setAgencyProfileSaving(false);
        return;
      }
    }

    const payload = {
      organization_id: agencyOrganization.id,
      agency_code: agencyCode,
      commercial_name: clean(agencyProfileForm.commercial_name ?? ""),
      contact_name: clean(agencyProfileForm.contact_name ?? ""),
      contact_email: clean(agencyProfileForm.contact_email ?? ""),
      contact_phone: clean(agencyProfileForm.contact_phone ?? ""),
      website: clean(agencyProfileForm.website ?? ""),
      market_country: clean(agencyProfileForm.market_country ?? ""),
      preferred_language: clean(agencyProfileForm.preferred_language ?? ""),
      billing_legal_name: clean(agencyProfileForm.billing_legal_name ?? ""),
      billing_email: clean(agencyProfileForm.billing_email ?? ""),
      billing_phone: clean(agencyProfileForm.billing_phone ?? ""),
      billing_address_line_1: clean(agencyProfileForm.billing_address_line_1 ?? ""),
      billing_address_line_2: clean(agencyProfileForm.billing_address_line_2 ?? ""),
      billing_city: clean(agencyProfileForm.billing_city ?? ""),
      billing_postal_code: clean(agencyProfileForm.billing_postal_code ?? ""),
      billing_country: clean(agencyProfileForm.billing_country ?? ""),
      tax_identifier: clean(agencyProfileForm.tax_identifier ?? ""),
      payment_terms: clean(agencyProfileForm.payment_terms ?? ""),
      default_commission_type: agencyProfileForm.default_commission_type,
      default_commission_value: agencyProfileForm.default_commission_value
        ? Number(agencyProfileForm.default_commission_value)
        : null,
      commission_currency: clean(agencyProfileForm.commission_currency ?? "") ?? "MAD",
      commission_notes: clean(agencyProfileForm.commission_notes ?? ""),
      bank_name: clean(agencyProfileForm.bank_name ?? ""),
      bank_account_name: clean(agencyProfileForm.bank_account_name ?? ""),
      bank_account_number: clean(agencyProfileForm.bank_account_number ?? ""),
      commercial_notes: clean(agencyProfileForm.commercial_notes ?? ""),
      notes: clean(agencyProfileForm.notes ?? ""),
    };

    const request = agencyProfile
      ? db.from("agency_profiles").update(payload).eq("organization_id", agencyOrganization.id).select(AGENCY_PROFILE_COLUMNS).single()
      : db.from("agency_profiles").insert(payload).select(AGENCY_PROFILE_COLUMNS).single();

    const { data, error } = await request;

    if (error) {
      const message = error.message ?? "Impossible d'enregistrer le profil agence.";
      toast.error(/agency_code|duplicate|unique/i.test(message) ? "Ce code agence est déjà utilisé." : message);
      setAgencyProfileSaving(false);
      return;
    }

    const saved = data as AgencyProfileRow;
    setAgencyProfile(saved);
    setAgencyProfileForm(toAgencyProfileForm(saved));
    toast.success("Profil agence enregistré.");
    setAgencyProfileSaving(false);
  };

  const openCreateRule = (scope: CommissionScopeType = "global") => {
    setEditingRule(null);
    setRuleForm({ ...defaultRuleForm(), scope });
    setRuleDialogOpen(true);
  };

  const openEditRule = (rule: CommissionRuleRow) => {
    setEditingRule(rule);
    setRuleForm(toRuleForm(rule));
    setRuleDialogOpen(true);
  };

  const saveCommissionRule = async () => {
    if (!agencyOrganization) return;
    const value = Number(ruleForm.commission_value);
    if (!Number.isFinite(value) || value < 0) {
      toast.error("La valeur de commission est obligatoire.");
      return;
    }
    if (ruleForm.scope === "destination" && !ruleForm.destination.trim()) {
      toast.error("Renseignez une destination pour cette règle.");
      return;
    }
    if (ruleForm.scope === "product" && !ruleForm.product_trip_id) {
      toast.error("Sélectionnez un voyage/produit pour cette règle.");
      return;
    }
    if (ruleForm.effective_to && ruleForm.effective_from && ruleForm.effective_to < ruleForm.effective_from) {
      toast.error("La date de fin doit être postérieure à la date de début.");
      return;
    }

    const duplicateActive = ruleForm.status === "active" && commissionRules.some((rule) => {
      if (editingRule?.id === rule.id || rule.status !== "active" || rule.scope !== ruleForm.scope) return false;
      if (ruleForm.scope === "global") return true;
      if (ruleForm.scope === "destination") return rule.destination?.toLowerCase() === ruleForm.destination.trim().toLowerCase();
      return rule.product_trip_id === ruleForm.product_trip_id;
    });

    if (duplicateActive) {
      toast.error(
        ruleForm.scope === "global"
          ? "Une règle globale active existe déjà pour cette agence."
          : ruleForm.scope === "destination"
            ? "Une règle active existe déjà pour cette destination."
            : "Une règle active existe déjà pour ce produit."
      );
      return;
    }

    setRuleSaving(true);
    const payload = {
      organization_id: agencyOrganization.id,
      scope: ruleForm.scope,
      destination: ruleForm.scope === "destination" ? clean(ruleForm.destination) : null,
      product_trip_id: ruleForm.scope === "product" ? ruleForm.product_trip_id : null,
      rule_name: clean(ruleForm.rule_name),
      commission_type: ruleForm.commission_type,
      commission_value: value,
      currency: clean(ruleForm.currency) ?? "MAD",
      applies_to: ruleForm.applies_to,
      effective_from: ruleForm.effective_from || new Date().toISOString().slice(0, 10),
      effective_to: clean(ruleForm.effective_to),
      status: ruleForm.status,
      priority: ruleForm.priority ? Number(ruleForm.priority) : 100,
      notes: clean(ruleForm.notes),
      created_by: user?.id ?? null,
    };

    const request = editingRule
      ? db.from("commission_engine_rules").update(payload).eq("id", editingRule.id).select(COMMISSION_RULE_COLUMNS).single()
      : db.from("commission_engine_rules").insert(payload).select(COMMISSION_RULE_COLUMNS).single();

    const { data, error } = await request;

    if (error) {
      const message = error.message ?? "Impossible d'enregistrer la règle de commission.";
      toast.error(/duplicate|unique/i.test(message) ? "Une règle active existe déjà pour cette portée." : message);
      setRuleSaving(false);
      return;
    }

    const saved = data as CommissionRuleRow;
    setCommissionRules((current) =>
      editingRule
        ? current.map((rule) => (rule.id === saved.id ? saved : rule))
        : [saved, ...current]
    );
    toast.success(editingRule ? "Règle de commission mise à jour." : "Règle de commission créée.");
    const { error: auditError } = await db.from("audit_logs").insert({
      action: editingRule ? "commission_rule.updated" : "commission_rule.created",
      resource_type: "commission_engine_rule",
      resource_id: saved.id,
      after_data: saved,
    });
    if (auditError) console.warn("[commission-engine] audit log failed", auditError);
    setRuleDialogOpen(false);
    setRuleSaving(false);
  };

  const archiveCommissionRule = async () => {
    if (!ruleAction) return;
    setRuleSaving(true);

    const { data, error } = await db
      .from("commission_engine_rules")
      .update({ status: "archived" })
      .eq("id", ruleAction.id)
      .select(COMMISSION_RULE_COLUMNS)
      .single();

    if (error) {
      toast.error(error.message ?? "Impossible d'archiver la règle.");
    } else {
      const archived = data as CommissionRuleRow;
      setCommissionRules((current) => current.map((rule) => (rule.id === archived.id ? archived : rule)));
      const { error: auditError } = await db.from("audit_logs").insert({
        action: "commission_rule.archived",
        resource_type: "commission_engine_rule",
        resource_id: archived.id,
        after_data: archived,
      });
      if (auditError) console.warn("[commission-engine] audit log failed", auditError);
      toast.success("Règle archivée.");
    }

    setRuleAction(null);
    setRuleSaving(false);
  };

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
          <ShieldOff className="h-6 w-6 text-muted-foreground" />
        </div>
        <h2 className="font-display text-xl">Réservé aux Super Admins</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          La gestion des organisations V2 est réservée au Super Admin.
        </p>
      </div>
    );
  }

  const profileInput = (key: keyof AgencyProfileForm, label: string, type = "text") => (
    <div className="space-y-2">
      <Label htmlFor={`agency_${String(key)}`}>{label}</Label>
      <Input
        id={`agency_${String(key)}`}
        type={type}
        value={(agencyProfileForm[key] as string | null) ?? ""}
        onChange={(event) =>
          setAgencyProfileForm((current) => ({ ...current, [key]: event.target.value }))
        }
        className="min-h-11"
      />
    </div>
  );

  const profileTextarea = (key: keyof AgencyProfileForm, label: string) => (
    <div className="space-y-2">
      <Label htmlFor={`agency_${String(key)}`}>{label}</Label>
      <Textarea
        id={`agency_${String(key)}`}
        value={(agencyProfileForm[key] as string | null) ?? ""}
        onChange={(event) =>
          setAgencyProfileForm((current) => ({ ...current, [key]: event.target.value }))
        }
        rows={4}
      />
    </div>
  );

  const onboardingMetadata = onboardingReview?.caseRow
    ? normalizeOnboardingMetadata(onboardingReview.caseRow.form_data)
    : null;
  const onboardingDisplayData = buildOnboardingDisplayData(
    onboardingMetadata,
    null,
    null
  );
  const onboardingDocumentsByType = new Map<string, Record<string, any>>();
  for (const document of onboardingReview?.documents ?? []) {
    const type = String(document.document_type ?? "");
    if (type && !onboardingDocumentsByType.has(type)) onboardingDocumentsByType.set(type, document);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organizations"
        description="V2 Foundation · Gestion super_admin des organisations et membres, sans intégration booking ni commissions."
        action={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button variant="outline" onClick={loadOrganizations} disabled={loading} className="min-h-11">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Actualiser
            </Button>
            <Button onClick={openCreate} className="min-h-11">
              <Plus className="h-4 w-4" />
              Créer
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Total</p>
          <p className="mt-1 text-2xl font-semibold">{counts.total}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Affichées</p>
          <p className="mt-1 text-2xl font-semibold">{counts.visible}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Archivées</p>
          <p className="mt-1 text-2xl font-semibold">{counts.archived}</p>
        </Card>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_180px_180px_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher par nom, raison sociale ou email"
              className="min-h-11 pl-9"
            />
          </div>
          <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as typeof typeFilter)}>
            <SelectTrigger className="min-h-11">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les types</SelectItem>
              <SelectItem value="internal">Interne</SelectItem>
              <SelectItem value="agency">Agence</SelectItem>
              <SelectItem value="japan_partner">Partenaire Japon</SelectItem>
              <SelectItem value="supplier">Fournisseur</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
            <SelectTrigger className="min-h-11">
              <SelectValue placeholder="Statut" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              <SelectItem value="active">Actives</SelectItem>
              <SelectItem value="suspended">Suspendues</SelectItem>
              <SelectItem value="archived">Archivées</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm">
            <Checkbox
              checked={showArchived}
              onCheckedChange={(checked) => setShowArchived(Boolean(checked))}
            />
            Show archived
          </label>
        </div>
      </Card>

      {loadError && (
        <Card className="border-amber-200 bg-amber-50 p-5 text-amber-950">
          <div className="flex gap-3">
            <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <h2 className="font-semibold">Organizations indisponible</h2>
              <p className="mt-1 text-sm">{loadError}</p>
            </div>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement des organisations…
          </div>
        ) : filteredOrganizations.length === 0 ? (
          <div className="p-12 text-center">
            <Building2 className="mx-auto h-10 w-10 text-muted-foreground" />
            <h2 className="mt-3 font-display text-xl">Aucune organisation</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Ajustez les filtres ou créez une première organisation V2.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organisation</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Mise à jour</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrganizations.map((organization) => (
                    <TableRow key={organization.id}>
                      <TableCell>
                        <div className="font-medium">{organization.display_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {organization.legal_name || organization.city || "—"}
                        </div>
                      </TableCell>
                      <TableCell>{TYPE_LABELS[organization.type] ?? organization.type}</TableCell>
                      <TableCell>
                        <div>{organization.email || "—"}</div>
                        <div className="text-xs text-muted-foreground">{organization.phone || organization.website || ""}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("font-medium", statusBadgeClass(organization.status))}>
                          {STATUS_LABELS[organization.status] ?? organization.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {fmtDateTime(organization.updated_at ?? organization.created_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => openMembers(organization)}>
                            <Users className="h-3.5 w-3.5" />
                            Members
                          </Button>
                          {organization.type === "agency" && (
                            <Button size="sm" variant="outline" onClick={() => openAgencyProfile(organization)}>
                              <Percent className="h-3.5 w-3.5" />
                              Profil agence
                            </Button>
                          )}
                          {organization.type === "agency" && (
                            <Button size="sm" variant="outline" onClick={() => openOnboardingReview(organization)}>
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Onboarding
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => openEdit(organization)}>
                            <Edit className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                          {organization.status !== "active" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setStatusAction({ organization, status: "active" })}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Réactiver
                            </Button>
                          )}
                          {organization.status !== "suspended" && organization.status !== "archived" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setStatusAction({ organization, status: "suspended" })}
                            >
                              <PauseCircle className="h-3.5 w-3.5" />
                              Suspendre
                            </Button>
                          )}
                          {organization.status !== "archived" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setStatusAction({ organization, status: "archived" })}
                            >
                              <Archive className="h-3.5 w-3.5" />
                              Archiver
                            </Button>
                          )}
                          {isSuperAdmin && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => openPermanentDelete(organization)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Supprimer définitivement
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="divide-y md:hidden">
              {filteredOrganizations.map((organization) => (
                <div key={organization.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold">{organization.display_name}</h2>
                      <p className="text-xs text-muted-foreground">{organization.legal_name || organization.email || "—"}</p>
                    </div>
                    <Badge variant="outline" className={cn("shrink-0", statusBadgeClass(organization.status))}>
                      {STATUS_LABELS[organization.status]}
                    </Badge>
                  </div>
                  <div className="grid gap-1 text-sm text-muted-foreground">
                    <p>{TYPE_LABELS[organization.type]}</p>
                    <p>{organization.phone || organization.website || organization.city || "Contact non renseigné"}</p>
                    <p>MAJ: {fmtDateTime(organization.updated_at ?? organization.created_at)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => openMembers(organization)}>
                      <Users className="h-3.5 w-3.5" />
                      Members
                    </Button>
                    {organization.type === "agency" && (
                      <Button size="sm" variant="outline" onClick={() => openAgencyProfile(organization)}>
                        <Percent className="h-3.5 w-3.5" />
                        Profil agence
                      </Button>
                    )}
                    {organization.type === "agency" && (
                      <Button size="sm" variant="outline" onClick={() => openOnboardingReview(organization)}>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Onboarding
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => openEdit(organization)}>
                      <Edit className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                    {organization.status !== "active" && (
                      <Button size="sm" variant="outline" onClick={() => setStatusAction({ organization, status: "active" })}>
                        Réactiver
                      </Button>
                    )}
                    {organization.status !== "suspended" && organization.status !== "archived" && (
                      <Button size="sm" variant="outline" onClick={() => setStatusAction({ organization, status: "suspended" })}>
                        Suspendre
                      </Button>
                    )}
                    {organization.status !== "archived" && (
                      <Button size="sm" variant="outline" onClick={() => setStatusAction({ organization, status: "archived" })}>
                        Archiver
                      </Button>
                    )}
                    {isSuperAdmin && (
                      <Button size="sm" variant="destructive" onClick={() => openPermanentDelete(organization)}>
                        <Trash2 className="h-3.5 w-3.5" />
                        Supprimer définitivement
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <Dialog open={membersOpen} onOpenChange={setMembersOpen}>
        <DialogContent className="flex max-h-[92vh] flex-col overflow-hidden sm:max-w-5xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              Membres · {memberOrganization?.display_name ?? "Organisation"}
            </DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="space-y-5">
              <Card className="border-dashed p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
                  <div className="grid flex-1 gap-3 md:grid-cols-[1fr_1fr_180px]">
                    <div className="space-y-2">
                      <Label htmlFor="member_user_search">Rechercher utilisateur existant</Label>
                      <Input
                        id="member_user_search"
                        value={userSearch}
                        onChange={(event) => setUserSearch(event.target.value)}
                        placeholder="Nom ou email"
                        className="min-h-11"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Utilisateur</Label>
                      <Select value={selectedUserId} onValueChange={setSelectedUserId} disabled={usersLoading || Boolean(usersError)}>
                        <SelectTrigger className="min-h-11">
                          <SelectValue placeholder={usersLoading ? "Chargement…" : "Sélectionner"} />
                        </SelectTrigger>
                        <SelectContent>
                          {existingUserOptions.map((existingUser) => {
                            const alreadyMember = members.some((member) => member.user_id === existingUser.id);
                            return (
                              <SelectItem key={existingUser.id} value={existingUser.id} disabled={alreadyMember}>
                                {existingUser.email || existingUser.id}
                                {existingUser.full_name ? ` · ${existingUser.full_name}` : ""}
                                {alreadyMember ? " · déjà membre" : ""}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Rôle organisation</Label>
                      <Select value={selectedRole} onValueChange={(value) => setSelectedRole(value as OrganizationRole)}>
                        <SelectTrigger className="min-h-11">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ORGANIZATION_ROLES.map((role) => (
                            <SelectItem key={role} value={role}>
                              {ROLE_LABELS[role]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Button onClick={addMember} disabled={memberBusy || membersLoading || usersLoading || !selectedUserId} className="min-h-11">
                    {memberBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                    Ajouter
                  </Button>
                </div>

                <p className="mt-3 text-xs text-muted-foreground">
                  Ces rôles appartiennent uniquement à l'organisation. Ils ne créent aucun rôle interne et n'accordent pas d'accès staff.
                </p>

                {usersError && (
                  <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                    Utilisateurs indisponibles: {usersError}
                  </p>
                )}
              </Card>

              <Card className="border-dashed p-4">
                <div className="flex flex-col gap-1">
                  <h3 className="font-semibold">Créer utilisateur externe</h3>
                  <p className="text-xs text-muted-foreground">
                    Ce compte sera ajouté uniquement à cette organisation. Aucun rôle interne backoffice ne sera créé.
                  </p>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_160px_180px_auto] xl:items-end">
                  <div className="space-y-2">
                    <Label htmlFor="external_full_name">Nom complet</Label>
                    <Input
                      id="external_full_name"
                      value={externalUserForm.full_name}
                      onChange={(event) => setExternalUserForm((current) => ({ ...current, full_name: event.target.value }))}
                      placeholder="Nom du contact"
                      className="min-h-11"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="external_email">Email</Label>
                    <Input
                      id="external_email"
                      type="email"
                      value={externalUserForm.email}
                      onChange={(event) => setExternalUserForm((current) => ({ ...current, email: event.target.value }))}
                      placeholder="contact@agence.ma"
                      className="min-h-11"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="external_phone">Téléphone</Label>
                    <Input
                      id="external_phone"
                      value={externalUserForm.phone}
                      onChange={(event) => setExternalUserForm((current) => ({ ...current, phone: event.target.value }))}
                      placeholder="+212..."
                      className="min-h-11"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Rôle organisation</Label>
                    <Select
                      value={externalUserForm.role}
                      onValueChange={(value) => setExternalUserForm((current) => ({ ...current, role: value as OrganizationRole }))}
                    >
                      <SelectTrigger className="min-h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ORGANIZATION_ROLES.map((role) => (
                          <SelectItem key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button onClick={createExternalUser} disabled={memberBusy || !externalUserForm.email.trim()} className="min-h-11">
                    {memberBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                    Créer
                  </Button>
                </div>

                {externalUserResult?.temporary_password && (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                    <p className="font-semibold">Email non envoyé. Mot de passe provisoire à communiquer manuellement:</p>
                    <p className="mt-2 font-mono text-base">{externalUserResult.temporary_password}</p>
                  </div>
                )}
              </Card>

              {membersError && (
                <Card className="border-amber-200 bg-amber-50 p-4 text-amber-950">
                  <h3 className="font-semibold">Membres indisponibles</h3>
                  <p className="mt-1 text-sm">{membersError}</p>
                </Card>
              )}

              <Card className="overflow-hidden">
                {membersLoading ? (
                  <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Chargement des membres…
                  </div>
                ) : members.length === 0 ? (
                  <div className="p-10 text-center">
                    <Users className="mx-auto h-9 w-9 text-muted-foreground" />
                    <h3 className="mt-3 font-display text-lg">Aucun membre</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Ajoutez un utilisateur existant pour lui donner un accès organisation.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="hidden md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Utilisateur</TableHead>
                            <TableHead>Rôle organisation</TableHead>
                            <TableHead>Statut</TableHead>
                            <TableHead>Créé le</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {members.map((member) => {
                            const memberUser = userById.get(member.user_id);
                            const display = memberDisplay(member, memberUser);
                            return (
                              <TableRow key={member.id}>
                                <TableCell>
                                  <div className="font-medium">{display.full_name}</div>
                                  <div className="text-xs text-muted-foreground">{display.email}</div>
                                  {display.phone && <div className="text-xs text-muted-foreground">{display.phone}</div>}
                                </TableCell>
                                <TableCell>
                                  <Select
                                    value={member.role}
                                    onValueChange={(value) => updateMemberRole(member, value as OrganizationRole)}
                                    disabled={memberBusy}
                                  >
                                    <SelectTrigger className="h-9 min-w-36">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {ORGANIZATION_ROLES.map((role) => (
                                        <SelectItem key={role} value={role}>
                                          {ROLE_LABELS[role]}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      member.status === "active"
                                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                        : "border-amber-200 bg-amber-50 text-amber-800"
                                    )}
                                  >
                                    {MEMBER_STATUS_LABELS[member.status]}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {fmtDateTime(member.created_at)}
                                </TableCell>
                                <TableCell>
                                  <div className="flex justify-end gap-2">
                                    {member.status === "active" ? (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setMemberAction({ member, type: "suspend" })}
                                      >
                                        Suspendre
                                      </Button>
                                    ) : (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setMemberAction({ member, type: "reactivate" })}
                                      >
                                        Réactiver
                                      </Button>
                                    )}
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="text-destructive hover:text-destructive"
                                      onClick={() => setMemberAction({ member, type: "remove" })}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                      Retirer
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>

                    <div className="divide-y md:hidden">
                      {members.map((member) => {
                        const memberUser = userById.get(member.user_id);
                        const display = memberDisplay(member, memberUser);
                        return (
                          <div key={member.id} className="space-y-3 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h3 className="truncate font-medium">{display.full_name}</h3>
                                <p className="break-all text-xs text-muted-foreground">{display.email}</p>
                                {display.phone && <p className="text-xs text-muted-foreground">{display.phone}</p>}
                              </div>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "shrink-0",
                                  member.status === "active"
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                    : "border-amber-200 bg-amber-50 text-amber-800"
                                )}
                              >
                                {MEMBER_STATUS_LABELS[member.status]}
                              </Badge>
                            </div>

                            <div className="space-y-2">
                              <Label>Rôle organisation</Label>
                              <Select
                                value={member.role}
                                onValueChange={(value) => updateMemberRole(member, value as OrganizationRole)}
                                disabled={memberBusy}
                              >
                                <SelectTrigger className="min-h-11">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {ORGANIZATION_ROLES.map((role) => (
                                    <SelectItem key={role} value={role}>
                                      {ROLE_LABELS[role]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <p className="text-xs text-muted-foreground">Créé le {fmtDateTime(member.created_at)}</p>

                            <div className="flex flex-wrap gap-2">
                              {member.status === "active" ? (
                                <Button size="sm" variant="outline" onClick={() => setMemberAction({ member, type: "suspend" })}>
                                  Suspendre
                                </Button>
                              ) : (
                                <Button size="sm" variant="outline" onClick={() => setMemberAction({ member, type: "reactivate" })}>
                                  Réactiver
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setMemberAction({ member, type: "remove" })}
                              >
                                Retirer
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </Card>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMembersOpen(false)} disabled={memberBusy}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifier l'organisation" : "Créer une organisation"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="display_name">Nom affiché *</Label>
              <Input
                id="display_name"
                value={form.display_name}
                onChange={(event) => setForm((current) => ({ ...current, display_name: event.target.value }))}
                className="min-h-11"
              />
            </div>

            <div className="space-y-2">
              <Label>Type *</Label>
              <Select
                value={form.type}
                onValueChange={(value) => setForm((current) => ({ ...current, type: value as OrganizationType }))}
              >
                <SelectTrigger className="min-h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="internal">Interne</SelectItem>
                  <SelectItem value="agency">Agence</SelectItem>
                  <SelectItem value="japan_partner">Partenaire Japon</SelectItem>
                  <SelectItem value="supplier">Fournisseur</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Statut</Label>
              <Select
                value={form.status}
                onValueChange={(value) => setForm((current) => ({ ...current, status: value as OrganizationStatus }))}
              >
                <SelectTrigger className="min-h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="suspended">Suspendue</SelectItem>
                  <SelectItem value="archived">Archivée</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {[
              ["legal_name", "Raison sociale"],
              ["email", "Email"],
              ["phone", "Téléphone"],
              ["website", "Site web"],
              ["address_line_1", "Adresse ligne 1"],
              ["address_line_2", "Adresse ligne 2"],
              ["city", "Ville"],
              ["postal_code", "Code postal"],
              ["country", "Pays"],
              ["tax_identifier", "Identifiant fiscal"],
            ].map(([key, label]) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={key}>{label}</Label>
                <Input
                  id={key}
                  value={form[key as keyof OrganizationForm] as string}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, [key]: event.target.value }))
                  }
                  className="min-h-11"
                />
              </div>
            ))}

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                rows={4}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Annuler
            </Button>
            <Button onClick={saveOrganization} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(statusAction)} onOpenChange={(open) => !open && setStatusAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer le changement de statut</AlertDialogTitle>
            <AlertDialogDescription>
              {statusAction
                ? `L'organisation "${statusAction.organization.display_name}" passera au statut ${STATUS_LABELS[
                    statusAction.status
                  ].toLowerCase()}.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={changeStatus} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={Boolean(deleteCheck)} onOpenChange={(open) => !open && setDeleteCheck(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Supprimer définitivement l'organisation ?
            </DialogTitle>
          </DialogHeader>
          {deleteCheck && (
            <div className="space-y-4 text-sm">
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
                <p className="font-semibold">{deleteCheck.organization.display_name}</p>
                <p className="mt-1 text-muted-foreground">
                  Cette action supprimera l'organisation, ses membres, ses dossiers onboarding, ses contrats partenaires,
                  son profil agence et ses règles de commission. L'archivage reste l'action normale pour préserver les données.
                </p>
              </div>

              {deleteCheck.checking ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Vérification des liens avant suppression…
                </div>
              ) : (
                <>
                  {deleteCheck.blockers.length > 0 ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950">
                      <p className="font-semibold">Suppression bloquée</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {deleteCheck.blockers.map((blocker) => (
                          <li key={blocker}>{blocker}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
                      <p className="font-semibold">Suppression autorisée</p>
                      {deleteCheck.membersCount > 0 ? (
                        <p className="mt-2">
                          Cette organisation contient {deleteCheck.membersCount} membre(s). Confirmer retirera aussi ces membres.
                        </p>
                      ) : (
                        <p className="mt-2">Aucune réservation active détectée.</p>
                      )}
                    </div>
                  )}

                  {deleteCheck.warnings.length > 0 && (
                    <div className="rounded-lg border border-border bg-secondary/40 p-4">
                      <p className="font-semibold">Avertissements</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                        {deleteCheck.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {deleteCheck.blockers.length === 0 && (
                    <div>
                      <Label htmlFor="delete_org_confirm">Tapez DELETE pour confirmer</Label>
                      <Input
                        id="delete_org_confirm"
                        value={deleteConfirm}
                        onChange={(event) => setDeleteConfirm(event.target.value)}
                        placeholder="DELETE"
                        className="mt-2"
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteCheck(null)} disabled={saving}>
              Annuler
            </Button>
            <Button
              variant="destructive"
              onClick={deleteOrganizationPermanently}
              disabled={saving || deleteConfirm !== "DELETE" || Boolean(deleteCheck?.checking) || Boolean(deleteCheck?.blockers.length)}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Supprimer définitivement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(onboardingReview)} onOpenChange={(open) => !open && setOnboardingReview(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Validation onboarding · {onboardingReview?.organization.display_name ?? "Agence"}</DialogTitle>
          </DialogHeader>
          {onboardingReview?.loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Chargement du dossier…
            </div>
          ) : onboardingReview?.error ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              {onboardingReview.error}
            </div>
          ) : !onboardingReview?.caseRow ? (
            <div className="rounded-lg border border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
              Aucun dossier onboarding trouvé pour cette organisation.
            </div>
          ) : (
            <div className="space-y-5 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">Statut dossier: {String(onboardingReview.caseRow.status ?? "—")}</Badge>
                <Badge variant="outline">Organisation: {onboardingReview.organization.status}</Badge>
                <Badge variant="outline">Créé le {fmtDateTime(onboardingReview.caseRow.created_at)}</Badge>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Card className="p-4">
                  <p className="font-semibold">Agence</p>
                  <div className="mt-2 space-y-2 text-muted-foreground">
                    <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Raison sociale</p><p className="mt-0.5 break-words font-medium">{onboardingDisplayData.agency_information.legal_name || "—"}</p></div>
                    <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Nom commercial</p><p className="mt-0.5 break-words font-medium">{onboardingDisplayData.agency_information.commercial_name || "—"}</p></div>
                    <div><p className="text-xs uppercase tracking-wide text-muted-foreground">RC</p><p className="mt-0.5 break-words font-medium">{onboardingDisplayData.agency_information.registration_number || "—"}</p></div>
                    <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Tax</p><p className="mt-0.5 break-words font-medium">{onboardingDisplayData.agency_information.tax_number || "—"}</p></div>
                    <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Site web</p><p className="mt-0.5 break-words font-medium">{onboardingDisplayData.agency_information.website || "—"}</p></div>
                    <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Adresse</p><p className="mt-0.5 break-words font-medium">{onboardingDisplayData.agency_information.address || "—"}</p></div>
                    <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Ville</p><p className="mt-0.5 break-words font-medium">{onboardingDisplayData.agency_information.city || "—"}</p></div>
                    <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Pays</p><p className="mt-0.5 break-words font-medium">{onboardingDisplayData.agency_information.country || "—"}</p></div>
                  </div>
                </Card>
                <Card className="p-4">
                  <p className="font-semibold">Contact</p>
                  <div className="mt-2 space-y-2 text-muted-foreground">
                    <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Nom complet</p><p className="mt-0.5 break-words font-medium">{onboardingDisplayData.contact_person.full_name || "—"}</p></div>
                    <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Fonction</p><p className="mt-0.5 break-words font-medium">{onboardingDisplayData.contact_person.position || "—"}</p></div>
                    <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Email</p><p className="mt-0.5 break-words font-medium">{onboardingDisplayData.contact_person.email || "—"}</p></div>
                    <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Téléphone</p><p className="mt-0.5 break-words font-medium">{onboardingDisplayData.contact_person.phone || "—"}</p></div>
                  </div>
                </Card>
              </div>

              <Card className="p-4">
                <p className="font-semibold">Documents reçus</p>
                <div className="mt-3 grid gap-2">
                  {[
                    { key: "company_registration", label: "Company registration" },
                    { key: "tax_certificate", label: "Tax certificate" },
                    { key: "id_passport", label: "ID / passport" },
                    { key: "bank_certificate", label: "Bank certificate" },
                  ].map(({ key, label }) => {
                    const doc = onboardingDocumentsByType.get(key) ?? onboardingDisplayData.documents?.[key];
                    const fileName = doc?.file_name ?? doc?.filename ?? doc?.name ?? null;
                    return (
                      <div key={key} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                        <div className="min-w-0">
                          <span>{label}</span>
                          {fileName && <p className="truncate text-xs text-muted-foreground">{fileName}</p>}
                        </div>
                        <Badge variant="outline" className={doc ? "border-emerald-200 bg-emerald-50 text-emerald-700" : ""}>
                          {doc ? String(doc.status ?? "Reçu") : "Manquant"}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </Card>

              <Card className="p-4">
                <p className="font-semibold">Signature digitale</p>
                <p className="mt-2 text-muted-foreground">
                  {onboardingDisplayData.digital_signature_acknowledged
                    ? `Accusé accepté le ${fmtDateTime(onboardingDisplayData.digital_signature_acknowledged_at)}`
                    : "Accusé non accepté"}
                </p>
              </Card>
            </div>
          )}

          {onboardingReview?.caseRow && (
            <details className="rounded-lg border border-border p-4 text-xs">
              <summary className="cursor-pointer font-mono font-semibold text-muted-foreground hover:text-foreground">
                🐛 Debug: onboarding raw data
              </summary>
              <div className="mt-3 grid gap-4 md:grid-cols-3">
                <div>
                  <p className="mb-2 font-semibold text-muted-foreground">onboarding_case</p>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">{JSON.stringify(onboardingReview.caseRow, null, 2)}</pre>
                </div>
                <div>
                  <p className="mb-2 font-semibold text-muted-foreground">agency_profile</p>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">{JSON.stringify(onboardingReview.agencyProfile, null, 2)}</pre>
                </div>
                <div>
                  <p className="mb-2 font-semibold text-muted-foreground">organization</p>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">{JSON.stringify(onboardingReview.organization, null, 2)}</pre>
                </div>
              </div>
            </details>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOnboardingReview(null)} disabled={onboardingBusy}>
              Fermer
            </Button>
            <Button
              variant="destructive"
              onClick={() => reviewOnboarding("rejected")}
              disabled={onboardingBusy || !onboardingReview?.caseRow}
            >
              {onboardingBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              Rejeter
            </Button>
            <Button
              onClick={() => reviewOnboarding("approved")}
              disabled={onboardingBusy || !onboardingReview?.caseRow}
            >
              {onboardingBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Approuver
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(memberAction)} onOpenChange={(open) => !open && setMemberAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer l'action membre</AlertDialogTitle>
            <AlertDialogDescription>
              {memberAction?.type === "remove" && "Ce membre sera retiré de l'organisation. Aucun rôle interne ne sera modifié."}
              {memberAction?.type === "suspend" && "Ce membre sera suspendu pour cette organisation uniquement."}
              {memberAction?.type === "reactivate" && "Ce membre sera réactivé pour cette organisation."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={memberBusy}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={runMemberAction} disabled={memberBusy}>
              {memberBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(ruleAction)} onOpenChange={(open) => !open && setRuleAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archiver cette règle ?</AlertDialogTitle>
            <AlertDialogDescription>
              La règle ne sera pas supprimée. Son statut passera à archivée et elle ne devra plus être utilisée comme règle active.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={ruleSaving}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={archiveCommissionRule} disabled={ruleSaving}>
              {ruleSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              Archiver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
