import { rpc, serve } from "../_shared/runtime.ts";
import {
  automaticFailureDiagnostics,
  providerFailureInfo,
  geminiResearch,
  runAutomaticSafety,
} from "../_shared/automatic-safety/agent.ts";
import type { Snapshot } from "../_shared/automatic-safety/contracts.ts";
declare const Deno: { env: { get(name: string): string | undefined } };

serve("generate-safety-briefings", async () => {
  if (Deno.env.get("SAFETY_AGENT_ENABLED") !== "true")
    return { disabled: true };
  const key = Deno.env.get("GEMINI_API_KEY") ?? "";
  const model = Deno.env.get("SAFETY_MODEL") ?? "";
  const reserve = Number(Deno.env.get("SAFETY_RESERVED_USD_PER_TURN"));
  if (!key || !model || !Number.isFinite(reserve) || reserve <= 0)
    throw new Error("provider_unconfigured");
  // Enqueue is independent of page views, job plans, supervisor forms and cron ordering.
  await rpc("enqueue_automatic_safety_checklists", {});
  const runs = await rpc<
    { id: string; lease_token: string; input_snapshot: Snapshot }[]
  >("claim_automatic_safety_runs", {});
  const results = [];
  for (const run of runs) {
    try {
      if (run.input_snapshot.model !== model)
        throw new Error("model_configuration_changed");
      const output = await runAutomaticSafety(
        run.input_snapshot,
        geminiResearch(key, model),
        {
          reservedUsdPerTurn: reserve,
          maxSpendUsd: Number(Deno.env.get("SAFETY_MAX_SPEND_USD") ?? "0.5"),
        },
      );
      const saved = await rpc("finish_automatic_safety_run", {
        p_run_id: run.id,
        p_lease_token: run.lease_token,
        p_content: output.content,
        p_documents: output.documents,
        p_diagnostics: output.diagnostics,
      });
      results.push({ run_id: run.id, saved, research: output.research });
    } catch (error) {
      const allowed = [
        "provider_unconfigured",
        "provider_rate_limited",
        "provider_failed",
        "model_configuration_changed",
        "resource_limit",
        "invalid_usage",
        "invalid_model_json",
        "invalid_checklist",
        "invalid_item",
        "invalid_citation",
        "unsupported_quote",
        "instruction_not_in_source",
        "unsupported_number",
      ];
      const category =
        error instanceof Error && allowed.includes(error.message)
          ? error.message
          : "generation_failed";
      await rpc("finish_automatic_safety_run", {
        p_run_id: run.id,
        p_lease_token: run.lease_token,
        p_error: category,
        p_diagnostics: automaticFailureDiagnostics(error),
      });
      results.push({
        run_id: run.id,
        error: category,
        provider: providerFailureInfo(error),
      });
    }
  }
  return { results };
});
