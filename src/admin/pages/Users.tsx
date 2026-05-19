import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "../components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { ROLE_LABELS, ROLE_DESCRIPTIONS, Role } from "../lib/permissions";
import { Plus, Trash2, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { fmtDateTime } from "@/lib/format";

const ALL_ROLES: Role[] = ["super_admin", "admin", "manager", "agent", "content_manager", "supplier"];

type UserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string | null;
  roles: Role[];
};

export default function UsersAdmin() {
  const { isSuperAdmin } = useAuth();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({ email: "", password: "", full_name: "", roles: [] as Role[] });

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("admin-users", { body: { action: "list" } });
    if (error) toast.error(error.message);
    setRows((data as any)?.users ?? []);
    setLoading(false);
  };

  useEffect(() => { if (isSuperAdmin) load(); else setLoading(false); }, [isSuperAdmin]);

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center text-center py-20 gap-3">
        <div className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center">
          <ShieldOff className="w-6 h-6 text-muted-foreground" />
        </div>
        <h2 className="font-display text-xl">Réservé aux Super Admins</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Seul un Super Admin peut gérer les utilisateurs et leurs rôles.
        </p>
      </div>
    );
  }

  const toggleRole = (target: Role, list: Role[], set: (r: Role[]) => void) => {
    set(list.includes(target) ? list.filter((r) => r !== target) : [...list, target]);
  };

  const create = async () => {
    if (!form.email || !form.password) { toast.error("Email et mot de passe requis"); return; }
    setBusy(true);
    const { error } = await supabase.functions.invoke("admin-users", {
      body: { action: "create", ...form },
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Utilisateur créé");
    setOpen(false);
    setForm({ email: "", password: "", full_name: "", roles: [] });
    load();
  };

  const updateRoles = async (userId: string, nextRoles: Role[]) => {
    const { error } = await supabase.functions.invoke("admin-users", {
      body: { action: "set_roles", user_id: userId, roles: nextRoles },
    });
    if (error) toast.error(error.message);
    else { toast.success("Rôles mis à jour"); load(); }
  };

  const remove = async (userId: string) => {
    if (!confirm("Supprimer définitivement cet utilisateur ?")) return;
    const { error } = await supabase.functions.invoke("admin-users", {
      body: { action: "delete", user_id: userId },
    });
    if (error) toast.error(error.message);
    else { toast.success("Supprimé"); load(); }
  };

  return (
    <div>
      <PageHeader
        title="Utilisateurs & Rôles"
        description="Créez les comptes de l'équipe et attribuez les permissions par module."
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4" /> Nouvel utilisateur</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Créer un utilisateur</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="fn">Nom complet</Label>
                  <Input id="fn" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="em">Email</Label>
                  <Input id="em" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="pw">Mot de passe temporaire</Label>
                  <Input id="pw" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </div>
                <div>
                  <Label>Rôles</Label>
                  <div className="grid grid-cols-1 gap-2 mt-2">
                    {ALL_ROLES.map((r) => (
                      <label key={r} className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-secondary/50 cursor-pointer">
                        <Checkbox
                          checked={form.roles.includes(r)}
                          onCheckedChange={() => toggleRole(r, form.roles, (next) => setForm({ ...form, roles: next }))}
                        />
                        <div>
                          <p className="text-sm font-medium">{ROLE_LABELS[r]}</p>
                          <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
                <Button onClick={create} disabled={busy}>{busy ? "…" : "Créer"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="bg-background rounded-2xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50">
            <tr className="text-left">
              <th className="p-4 font-semibold">Utilisateur</th>
              <th className="p-4 font-semibold">Rôles</th>
              <th className="p-4 font-semibold">Créé le</th>
              <th className="p-4 font-semibold w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading && <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">Chargement…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">Aucun utilisateur.</td></tr>}
            {rows.map((u) => (
              <tr key={u.id} className="hover:bg-secondary/30 align-top">
                <td className="p-4">
                  <p className="font-medium">{u.full_name || "—"}</p>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                </td>
                <td className="p-4">
                  <div className="flex flex-wrap gap-1.5 max-w-md">
                    {ALL_ROLES.map((r) => {
                      const active = u.roles.includes(r);
                      return (
                        <button
                          key={r}
                          onClick={() => updateRoles(u.id, active ? u.roles.filter((x) => x !== r) : [...u.roles, r])}
                          className={
                            "text-xs px-2.5 py-1 rounded-full border transition-colors " +
                            (active
                              ? "bg-accent text-accent-foreground border-accent"
                              : "bg-background border-border text-muted-foreground hover:border-accent/50")
                          }
                        >
                          {ROLE_LABELS[r]}
                        </button>
                      );
                    })}
                  </div>
                </td>
                <td className="p-4 text-xs text-muted-foreground">{u.created_at ? fmtDateTime(u.created_at) : "—"}</td>
                <td className="p-4">
                  <Button size="sm" variant="ghost" onClick={() => remove(u.id)} className="text-destructive hover:text-destructive">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}