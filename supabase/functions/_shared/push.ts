// Pure helpers for web push. The subscription is stored as JSON in push_subscriptions.address.
export interface WebPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function parseSubscription(address: string): WebPushSubscription | null {
  try {
    const sub = JSON.parse(address);
    if (
      typeof sub?.endpoint === "string" &&
      sub.endpoint.startsWith("https://") &&
      typeof sub?.keys?.p256dh === "string" &&
      typeof sub?.keys?.auth === "string"
    )
      return { endpoint: sub.endpoint, keys: sub.keys };
  } catch {
    // fall through
  }
  return null;
}

export interface PushRow {
  id: string;
  site_id: string;
  kind: "manual" | "alert" | "forecast" | "briefing";
  title: string;
  body: string;
}

export function pushPayload(row: PushRow): string {
  return JSON.stringify({
    title: row.title,
    body: row.body,
    tag: `${row.kind}:${row.site_id}`,
    kind: row.kind,
    siteId: row.site_id,
    // Stop-work alerts stay on screen until the worker dismisses them.
    urgent: row.kind === "alert" && row.title.startsWith("STOP WORK"),
  });
}

// 404 and 410 mean the browser has dropped the subscription for good.
export const isGone = (status: number | undefined): boolean =>
  status === 404 || status === 410;
