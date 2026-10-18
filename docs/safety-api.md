# Automatic safety checklist API

Use an authenticated Supabase client. Site membership is authoritative. Supervisors and workers receive the same automatic checklist; generating and publishing require no browser mutation. Generated RPC types are in `src/database.types.ts`; payload types and client helpers are in [api.ts](../src/features/safety/api.ts).

## Read a checklist

```ts
const { data: workspace, error } = await supabase.rpc(
  "get_automatic_safety_workspace",
  {
    p_site_id: siteId,
    p_work_date: "2026-10-18", // Calendar date in the site's timezone
  },
);
if (error) throw error;
```

The response contains:

| Field       | Meaning                                                       |
| ----------- | ------------------------------------------------------------- |
| `enabled`   | Database generation switch is on and a model is configured    |
| `run`       | Latest state, attempt and sanitized error category, or null   |
| `checklist` | Latest unsuperseded checklist for this site and date, or null |

A checklist contains `id`, `work_date`, `content`, `generated_at`, `valid_until`, `current` and the current member's `acknowledged` flag. `current` requires matching material inputs, generation within four hours and an unexpired validity window. `enabled` does not prove the Edge worker or provider is healthy; inspect `run` and checklist freshness too.

Content includes the resolved `jurisdiction`, recorded `conditions`, site-wide `alerts`, source-backed `items`, verified `sources`, and explicit `coverage_gaps`. Each item has a stable ID within that checklist, `kind` (`regulation` or `guidance`), title, exact source wording, applicability conditions and citations. Citations reference source IDs and verbatim quotes. Sources retain URL, title, jurisdiction level/name and check time. Optional `search_entry_point` is provider attribution HTML; render only in a sandboxed iframe, never as application HTML.

The UI polls every three seconds. Its Refresh button only reads the workspace. Reading does not enqueue a run. A scheduled worker generates checklists even when no browser is open.

## Acknowledge a version

```ts
const { error } = await supabase.rpc("acknowledge_automatic_safety_checklist", {
  p_checklist_id: workspace.checklist.id,
});
if (error) throw error;
```

Both roles can acknowledge. SQL rejects nonmembers, old versions, expired checklists and changed inputs. Repeating the same acknowledgement is harmless. A replacement requires a new acknowledgement. A receipt records that this member read that version; it does not establish training or task completion.

## Worker interfaces

Only the service role can call these RPCs:

| RPC                                   | Purpose                                                 |
| ------------------------------------- | ------------------------------------------------------- |
| `enqueue_automatic_safety_checklists` | Capture eligible sites and local dates automatically    |
| `claim_automatic_safety_runs`         | Claim one run with a fenced lease                       |
| `finish_automatic_safety_run`         | Validate and publish, or record a bounded retry/failure |

`generate-safety-briefings` authenticates `X-Cron-Secret`, enqueues, claims one run, resolves location, researches sources, generates supported items and calls finish. Provider credentials and source documents stay server-side. Browsers cannot claim runs, submit source text or publish instructions.

Tables are `automatic_safety_runs`, `automatic_safety_checklists` and `automatic_safety_reads`. Runs and full fetched documents are service-only. Members can read their site's checklists and their own receipts under RLS; direct browser writes are revoked.

The earlier profile, planned-work, source-approval and draft-publication RPCs remain for historical compatibility. The current UI and automatic worker do not call them. See the [contract](safety-contract.md) and [operations](safety-operations.md).
