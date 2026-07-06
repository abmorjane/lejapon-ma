import { supabase } from "@/integrations/supabase/client";

export async function syncVisaApplicationToClient(applicationId: string) {
  if (!applicationId) return { clientId: null as string | null, synced: false };

  const { data, error } = await (supabase as any).rpc("sync_visa_application_to_client", {
    p_application_id: applicationId,
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    clientId: row?.client_id ?? null,
    synced: Boolean(row?.client_id),
  };
}
