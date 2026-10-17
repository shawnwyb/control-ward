import { rpc, serve } from "../_shared/runtime.ts";
import { runAgent } from "../_shared/safety-agent/agent.ts";
import { geminiAdapter } from "../_shared/safety-agent/gemini.ts";
import type {
  Evidence,
  InputSnapshot,
  ToolAdapter,
} from "../_shared/safety-agent/contracts.ts";
declare const Deno: { env: { get(name: string): string | undefined } };
interface Run {
  id: string;
  lease_token: string;
  input_snapshot: InputSnapshot;
}
serve("generate-safety-briefings", async () => {
  if (Deno.env.get("SAFETY_AGENT_ENABLED") !== "true")
    return { disabled: true };
  const key = Deno.env.get("GEMINI_API_KEY") ?? "",
    model = Deno.env.get("SAFETY_MODEL") ?? "";
  const reserve = Number(Deno.env.get("SAFETY_RESERVED_USD_PER_TURN"));
  // Price reservation must conservatively include the maximum prompt+output+thinking tokens at current pricing.
  if (!key || !model || !Number.isFinite(reserve) || reserve <= 0)
    return { configured: false };
  const runs = await rpc<Run[]>("claim_safety_runs", { p_limit: 1 });
  const results = [];
  for (const run of runs) {
    try {
      if (run.input_snapshot.model !== model)
        throw new Error("model_configuration_changed");
      const bound = await rpc<{
        evidence: Evidence[];
        hazards: unknown;
        coverage_gaps: string[];
      }>("bind_safety_hazards", {
        p_run_id: run.id,
        p_lease_token: run.lease_token,
      });
      const tools: ToolAdapter = {
        async call(name, args, signal) {
          signal.throwIfAborted();
          if (name === "get_job_context")
            return { data: { ...run.input_snapshot, hazards: undefined } };
          if (name === "get_site_hazards")
            return { data: bound, evidence: bound.evidence };
          const evidence = await rpc<Evidence[]>("retrieve_safety_evidence", {
            p_run_id: run.id,
            p_lease_token: run.lease_token,
            p_tool: name,
            p_query: args.query ?? "",
            p_passage_id: args.passage_id ?? null,
          });
          return { data: evidence, evidence };
        },
      };
      const output = await runAgent(
        run.input_snapshot,
        geminiAdapter(key, model),
        tools,
        {
          reservedUsdPerTurn: reserve,
          maxSpendUsd: Number(Deno.env.get("SAFETY_MAX_SPEND_USD") ?? "0.5"),
        },
      );
      const saved = await rpc("finish_safety_run", {
        p_run_id: run.id,
        p_lease_token: run.lease_token,
        p_content: output.draft,
        p_diagnostics: output.diagnostics,
      });
      results.push({ run_id: run.id, saved });
    } catch (error) {
      const allowed = [
        "provider_rate_limited",
        "provider_failed",
        "model_configuration_changed",
        "resource_limit",
        "step_limit",
        "tool_limit",
        "token_limit",
        "tool_failed",
        "validation_failed",
        "timeout",
      ];
      const category =
        error instanceof Error && allowed.includes(error.message)
          ? error.message
          : "generation_failed";
      await rpc("finish_safety_run", {
        p_run_id: run.id,
        p_lease_token: run.lease_token,
        p_error: category,
      });
      results.push({ run_id: run.id, error: category });
    }
  }
  return { results };
});
