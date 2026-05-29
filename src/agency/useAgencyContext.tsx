import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { AgencyMembership, AgencyOrganization } from "./agencyTypes";

type DbClient = {
  from: (table: string) => any;
};

const db = supabase as unknown as DbClient;

type AgencyContextValue = {
  loading: boolean;
  error: string | null;
  memberships: AgencyMembership[];
  currentMembership: AgencyMembership | null;
  organization: AgencyOrganization | null;
  setCurrentOrganizationId: (id: string) => void;
  reload: () => Promise<void>;
  hasAgencyAccess: boolean;
  isSuspendedAgency: boolean;
  isActiveAgency: boolean;
};

const AgencyContext = createContext<AgencyContextValue | null>(null);

const MEMBER_COLUMNS = "id,organization_id,user_id,role,status,created_at";
const ORG_COLUMNS = "id,type,status,display_name,legal_name,email,phone,website,address_line_1,address_line_2,city,postal_code,country";

export function AgencyProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<AgencyMembership[]>([]);
  const [currentOrganizationId, setCurrentOrganizationId] = useState("");

  const load = async () => {
    if (authLoading) return;
    if (!user) {
      setMemberships([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const { data: memberRows, error: membersError } = await db
      .from("organization_members")
      .select(MEMBER_COLUMNS)
      .eq("user_id", user.id)
      .eq("status", "active");

    if (membersError) {
      setMemberships([]);
      setError(`organization_members: ${membersError.message}`);
      setLoading(false);
      return;
    }

    const members = (memberRows ?? []) as Omit<AgencyMembership, "organization">[];
    if (members.length === 0) {
      setMemberships([]);
      setError("no organization_members row");
      setLoading(false);
      return;
    }

    const organizationIds = Array.from(new Set(members.map((member) => member.organization_id).filter(Boolean)));
    const { data: orgRows, error: orgError } = await db
      .from("organizations")
      .select(ORG_COLUMNS)
      .in("id", organizationIds)
      .eq("type", "agency")
      .in("status", ["active", "suspended"]);

    if (orgError) {
      setMemberships([]);
      setError(`organizations: ${orgError.message}`);
      setLoading(false);
      return;
    }

    const orgById = new Map<string, AgencyOrganization>();
    ((orgRows ?? []) as AgencyOrganization[]).forEach((organization) => orgById.set(organization.id, organization));

    const resolved = members
      .map((member) => {
        const organization = orgById.get(member.organization_id);
        if (!organization) return null;
        return { ...member, organization } as AgencyMembership;
      })
      .filter(Boolean) as AgencyMembership[];

    setMemberships(resolved);
    setError(resolved.length ? null : "no active agency organization");
    if (resolved.length && !resolved.some((membership) => membership.organization_id === currentOrganizationId)) {
      setCurrentOrganizationId(resolved[0].organization_id);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [user?.id, authLoading]);

  const currentMembership = useMemo(() => {
    if (!memberships.length) return null;
    return memberships.find((membership) => membership.organization_id === currentOrganizationId) ?? memberships[0];
  }, [currentOrganizationId, memberships]);

  const organization = currentMembership?.organization ?? null;

  return (
    <AgencyContext.Provider
      value={{
        loading: authLoading || loading,
        error,
        memberships,
        currentMembership,
        organization,
        setCurrentOrganizationId,
        reload: load,
        hasAgencyAccess: Boolean(currentMembership),
        isSuspendedAgency: organization?.status === "suspended",
        isActiveAgency: organization?.status === "active",
      }}
    >
      {children}
    </AgencyContext.Provider>
  );
}

export function useAgencyContext() {
  const context = useContext(AgencyContext);
  if (!context) throw new Error("useAgencyContext must be used within AgencyProvider");
  return context;
}
