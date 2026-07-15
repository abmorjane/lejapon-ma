import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { canAccess, ModuleKey } from "@/admin/lib/permissions";
import { hasAdminRole, hasInternalStaffRole, hasSupplierRole, isSupplierOnlyRole } from "@/admin/lib/portal-access";

type AuthCtx = {
  user: User | null;
  session: Session | null;
  roles: string[];
  isStaff: boolean;
  isInternalStaff: boolean;
  isSupplier: boolean;
  isSupplierOnly: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  can: (module: ModuleKey) => boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    metadata?: Record<string, unknown>,
    emailRedirectTo?: string
  ) => Promise<{ error: Error | null; data?: unknown }>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const loadedRolesForUser = useRef<string | null>(null);

  const loadRoles = async (uid: string) => {
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", uid);
    const nextRoles = (data ?? []).map((r) => r.role as string);
    setRoles(nextRoles);
    return nextRoles;
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        const shouldReloadRoles = loadedRolesForUser.current !== s.user.id || event === "SIGNED_IN" || event === "USER_UPDATED";
        if (shouldReloadRoles) {
          if (loadedRolesForUser.current !== s.user.id) setLoading(true);
          setTimeout(() => {
            void loadRoles(s.user.id).then(() => {
              loadedRolesForUser.current = s.user.id;
            }).finally(() => setLoading(false));
          }, 0);
        }
      } else {
        loadedRolesForUser.current = null;
        setRoles([]);
        setLoading(false);
      }
    });
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        await loadRoles(s.user.id);
        loadedRolesForUser.current = s.user.id;
      }
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }, []);
  const signUp = useCallback(async (
    email: string,
    password: string,
    fullName: string,
    metadata: Record<string, unknown> = {},
    emailRedirectTo = `${window.location.origin}/admin`
  ) => {
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { emailRedirectTo, data: { full_name: fullName, ...metadata } },
    });
    return { data, error };
  }, []);
  const signOut = useCallback(async () => { await supabase.auth.signOut(); }, []);

  const isInternalStaff = hasInternalStaffRole(roles);
  const isSupplier = hasSupplierRole(roles);
  const isSupplierOnly = isSupplierOnlyRole(roles);
  const isStaff = isInternalStaff;
  const isAdmin = hasAdminRole(roles);
  const isSuperAdmin = roles.includes("super_admin");
  const can = useCallback((module: ModuleKey) => canAccess(roles, module), [roles]);
  const value = useMemo(
    () => ({ user, session, roles, isStaff, isInternalStaff, isSupplier, isSupplierOnly, isAdmin, isSuperAdmin, can, loading, signIn, signUp, signOut }),
    [user, session, roles, isStaff, isInternalStaff, isSupplier, isSupplierOnly, isAdmin, isSuperAdmin, can, loading, signIn, signUp, signOut],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
    </Ctx.Provider>
  );
};

export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
};
