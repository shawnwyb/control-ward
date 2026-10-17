import { supabase } from "./supabase";

const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export type PushSupport =
  "ready" | "unsupported" | "not-configured" | "needs-install";

export function pushSupport(): PushSupport {
  if (!vapidKey) return "not-configured";
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    // iOS only exposes push to web apps added to the home screen.
    return /iPhone|iPad/.test(navigator.userAgent)
      ? "needs-install"
      : "unsupported";
  }
  return "ready";
}

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration() {
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

/** Shows a notification from this device only, to check that the OS lets the browser display them. */
export async function showTestNotification(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  if (!reg) throw new Error("Turn notifications on first.");
  await reg.showNotification("PlanIT test", {
    body: "If you can see this, notifications work on this device.",
    tag: `test:${Date.now()}`,
    icon: "/icon.svg",
  });
}

export async function isPushEnabled(): Promise<boolean> {
  if (pushSupport() !== "ready") return false;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  return Boolean(await reg?.pushManager.getSubscription());
}

// A stable id per browser profile, so turning notifications off and on replaces its subscription
// instead of adding another one that can never be delivered to.
function deviceId(): string {
  try {
    let id = localStorage.getItem("planit.deviceId");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("planit.deviceId", id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

async function removeOwn(userId: string, fragment: string) {
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", userId)
    .eq("channel", "web_push")
    .like("address", `%${fragment}%`);
  if (error) throw error;
}

export async function enablePush(userId: string): Promise<void> {
  if (pushSupport() !== "ready") throw new Error("Push isn’t available here.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error(
      "Notifications are blocked. Allow them in browser settings.",
    );
  const reg = await registration();
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(vapidKey!),
    }));
  const json = sub.toJSON();
  const id = deviceId();
  // Drop whatever this browser registered before, under this id or under the same endpoint.
  await removeOwn(userId, `"deviceId":"${id}"`);
  if (json.endpoint) await removeOwn(userId, `"endpoint":"${json.endpoint}"`);
  // Two overlapping calls (e.g. the page-load re-register and a click) may insert the same row.
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      channel: "web_push",
      address: JSON.stringify({ ...json, deviceId: id }),
    },
    { onConflict: "user_id,channel,address", ignoreDuplicates: true },
  );
  if (error) throw error;
}

export async function disablePush(userId: string): Promise<void> {
  await removeOwn(userId, `"deviceId":"${deviceId()}"`);
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await removeOwn(userId, `"endpoint":"${sub.endpoint}"`);
    await sub.unsubscribe();
  }
}
