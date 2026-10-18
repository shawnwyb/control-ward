import { geminiResearch } from "../_shared/automatic-safety/agent.ts";
import { readBounded } from "../_shared/automatic-safety/research.ts";
import type { Snapshot } from "../_shared/automatic-safety/contracts.ts";
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): void;
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
Deno.serve(async (req) => {
  const authorization = req.headers.get("authorization") ?? "";
  const apiKey = req.headers.get("apikey") ?? "";
  if (!authorization.startsWith("Bearer ") || !apiKey)
    return json({ error: "unauthorized" }, 401);
  try {
    if (
      req.method !== "POST" ||
      Deno.env.get("SAFETY_AGENT_ENABLED") !== "true"
    )
      return json({ error: "disabled" }, 403);
    const body = JSON.parse(await readBounded(new Response(req.body), 100000));
    if (typeof body.prompt !== "string" || typeof body.search !== "boolean")
      throw new Error("invalid_request");
    const reserve = Number(Deno.env.get("SAFETY_RESERVED_USD_PER_TURN"));
    const maximum = Number(Deno.env.get("SAFETY_MAX_SPEND_USD") ?? "0.5");
    if (
      !Number.isFinite(reserve) ||
      reserve <= 0 ||
      !Number.isFinite(maximum) ||
      maximum <= 0
    )
      throw new Error("provider_unconfigured");
    // PostgREST verifies the caller's credential and service-only EXECUTE grant.
    // Do not substitute the function's own key before authorization, or a browser
    // could turn this endpoint into a privileged provider proxy.
    const reservation = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/reserve_codeact_model_call`,
      {
        method: "POST",
        headers: {
          authorization,
          apikey: apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          p_run_id: body.run_id,
          p_lease_token: body.lease_token,
          p_prompt_bytes: new TextEncoder().encode(body.prompt).byteLength,
          p_max_calls: Math.min(8, Math.floor(maximum / reserve)),
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!reservation.ok) {
      let failure: { message?: string; code?: string } = {};
      try {
        failure = JSON.parse(
          await readBounded(new Response(reservation.body), 5000),
        );
      } catch {
        /* bounded diagnostics only */
      }
      const category = failure.message?.includes("Inactive CodeAct lease")
        ? "inactive_codeact_lease"
        : failure.message?.includes("CodeAct resource limit")
          ? "resource_limit"
          : failure.message?.includes("Invalid budget")
            ? "invalid_budget"
            : "broker_authorization_failed";
      console.error(
        "codeact-reservation",
        reservation.status,
        /^[A-Z0-9]{5}$/.test(failure.code ?? "") ? failure.code : "unknown",
      );
      return json({ error: category }, 403);
    }
    const snapshot = JSON.parse(
      await readBounded(reservation, 100000),
    ) as Snapshot;
    const model = Deno.env.get("SAFETY_MODEL") ?? "";
    if (snapshot.model !== model)
      throw new Error("model_configuration_changed");
    const result = await geminiResearch(
      Deno.env.get("GEMINI_API_KEY") ?? "",
      model,
      fetch,
      "codeact",
    ).ask(body.prompt, body.search, AbortSignal.timeout(80000));
    const settled = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/settle_codeact_model_call`,
      {
        method: "POST",
        headers: {
          authorization,
          apikey: apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          p_run_id: body.run_id,
          p_lease_token: body.lease_token,
          p_tokens: result.tokens,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    await settled.body?.cancel();
    if (!settled.ok) return json({ error: "resource_limit" }, 403);
    return json(result);
  } catch (error) {
    // Raw provider/REST errors may contain confidential context. Keep them server-side.
    console.error(
      "codeact-safety-model",
      error instanceof Error ? error.name : "Error",
    );
    const allowed = [
      "provider_unconfigured",
      "provider_failed",
      "provider_rate_limited",
      "invalid_model_json",
      "invalid_usage",
      "model_configuration_changed",
    ];
    return json(
      {
        error:
          error instanceof Error && allowed.includes(error.message)
            ? error.message
            : "codeact_request_failed",
      },
      502,
    );
  }
});
