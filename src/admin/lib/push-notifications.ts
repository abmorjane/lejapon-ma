import { supabase } from "@/integrations/supabase/client";

type PushKeys = {
  p256dh?: string;
  auth?: string;
};

const vapidPublicKey = () => import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export const adminPushSupported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
};

const subscriptionKeys = (subscription: PushSubscription): PushKeys => {
  const json = subscription.toJSON();
  return json.keys ?? {};
};

export async function registerAdminPushSubscription(userId?: string | null) {
  if (!adminPushSupported()) {
    throw new Error("Les notifications push ne sont pas supportées par ce navigateur.");
  }

  const publicKey = vapidPublicKey();
  if (!publicKey) {
    throw new Error("VITE_VAPID_PUBLIC_KEY n'est pas configurée.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Autorisation de notification refusée.");
  }

  const registration = await navigator.serviceWorker.register("/sw.js");
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const keys = subscriptionKeys(subscription);
  if (!keys.p256dh || !keys.auth) {
    throw new Error("Abonnement push incomplet.");
  }

  const { error } = await (supabase as any)
    .from("admin_push_subscriptions")
    .upsert({
      user_id: userId ?? null,
      endpoint: subscription.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: navigator.userAgent,
      enabled: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "endpoint" });

  if (error) throw error;
  return subscription;
}
