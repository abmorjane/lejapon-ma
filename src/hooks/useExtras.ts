import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTranslatedTable } from "./useTranslated";

export type Extra = {
  id: string;
  name: string;
  description: string | null;
  price_mad: number;
  image_url: string | null;
  alt_text: string | null;
  category: string | null;
  city: string | null;
  sort_order: number;
};

/**
 * Single source of truth for extra activities.
 * Reads from the `extras` table managed in admin (only is_active rows).
 */
export function useExtras() {
  const [extras, setExtras] = useState<Extra[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("extras")
        .select("id,name,description,price_mad,image_url,alt_text,category,city,sort_order")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (active) {
        setExtras((data ?? []) as Extra[]);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const translated = useTranslatedTable("extras", extras, [
    "name",
    "description",
    "alt_text",
    "category",
    "city",
  ] as (keyof Extra & string)[]);

  return { extras: translated, loading };
}

export const fmtExtraPrice = (n: number) =>
  new Intl.NumberFormat("fr-FR").format(Math.round(n)) + " MAD";