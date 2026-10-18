// Delivers queued push messages (push_outbox) to each recipient's browser with Web Push (VAPID).
import webpush from "npm:web-push@3.6.7";
import { rpc, serve } from "../_shared/runtime.ts";
import {
  isGone,
  parseSubscription,
  pushPayload,
  type PushRow,
} from "../_shared/push.ts";

declare const Deno: { env: { get(name: string): string | undefined } };

interface Recipient {
  user_id: string;
  subscription_id: string;
  address: string;
}

serve("send-push", async () => {
  const pub = Deno.env.get("VAPID_PUBLIC_KEY");
  const priv = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!pub || !priv)
    throw new Error("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are required");
  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
    pub,
    priv,
  );

  const claimed = await rpc<PushRow[]>("claim_push_outbox", { p_limit: 20 });
  let sent = 0,
    failed = 0,
    removed = 0;
  for (const row of claimed) {
    try {
      const recipients = await rpc<Recipient[]>("push_recipients", {
        p_id: row.id,
      });
      const payload = pushPayload(row);
      let ok = 0,
        bad = 0;
      for (const r of recipients) {
        const sub = parseSubscription(r.address);
        if (!sub) {
          bad++;
          await rpc("delete_push_subscription", { p_id: r.subscription_id });
          removed++;
          continue;
        }
        try {
          await webpush.sendNotification(sub, payload, {
            TTL: row.kind === "alert" ? 600 : 3600,
            urgency: row.kind === "alert" ? "high" : "normal",
          });
          ok++;
        } catch (error) {
          bad++;
          if (isGone((error as { statusCode?: number }).statusCode)) {
            await rpc("delete_push_subscription", { p_id: r.subscription_id });
            removed++;
          }
        }
      }
      sent += ok;
      failed += bad;
      await rpc("finish_push", {
        p_id: row.id,
        p_status: "sent",
        p_result: { recipients: recipients.length, delivered: ok, failed: bad },
      });
    } catch (error) {
      await rpc("finish_push", {
        p_id: row.id,
        p_status: "failed",
        p_result: { error: String(error) },
      });
    }
  }
  return { messages: claimed.length, delivered: sent, failed, removed };
});
