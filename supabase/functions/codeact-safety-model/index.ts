import { rpc } from "../_shared/runtime.ts";
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
  const expected = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`;
  const actual = req.headers.get("authorization") ?? "";
  let diff = expected.length ^ actual.length;
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ (actual.charCodeAt(i) || 0);
  if (diff || expected === "Bearer ")
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
    const snapshot = await rpc<Snapshot>("reserve_codeact_model_call", {
      p_run_id: body.run_id,
      p_lease_token: body.lease_token,
      p_prompt_bytes: new TextEncoder().encode(body.prompt).byteLength,
      p_max_calls: Math.min(8, Math.floor(maximum / reserve)),
    });
    const model = Deno.env.get("SAFETY_MODEL") ?? "";
    if (snapshot.model !== model)
      throw new Error("model_configuration_changed");
    return json(
      await geminiResearch(
        Deno.env.get("GEMINI_API_KEY") ?? "",
        model,
        fetch,
        "codeact",
      ).ask(body.prompt, body.search, AbortSignal.timeout(80000)),
    );
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
