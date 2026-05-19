import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { resolveContent } from "@/lib/i18n-content";

const cache = new Map<string, any>();
const listeners = new Map<string, Set<(v: any) => void>>();

async function fetchContent(slug: string) {
  const { data } = await supabase.from("pages").select("content").eq("slug", slug).maybeSingle();
  return (data?.content ?? {}) as Record<string, any>;
}

export function useSiteContent<T = any>(slug: string, fallback: T): T {
  const { i18n } = useTranslation();
  const [raw, setRaw] = useState<Record<string, any>>(() => cache.get(slug) ?? {});

  useEffect(() => {
    let mounted = true;
    if (!listeners.has(slug)) listeners.set(slug, new Set());
    const set = listeners.get(slug)!;
    const onChange = (v: any) => mounted && setRaw(v ?? {});
    set.add(onChange);

    if (cache.has(slug)) setRaw(cache.get(slug));
    fetchContent(slug).then((c) => {
      cache.set(slug, c);
      listeners.get(slug)?.forEach((fn) => fn(c));
    });

    return () => {
      set.delete(onChange);
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  return useMemo(
    () => ({ ...(fallback as any), ...resolveContent<any>(raw, i18n.language) }) as T,
    [raw, i18n.language, fallback],
  );
}

export async function saveSiteContent(slug: string, content: Record<string, any>) {
  const { error } = await supabase.from("pages").update({ content }).eq("slug", slug);
  if (error) throw error;
  cache.set(slug, content);
  listeners.get(slug)?.forEach((fn) => fn(content));
}