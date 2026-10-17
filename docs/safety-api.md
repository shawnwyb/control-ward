# Task safety checklist API

Use an authenticated Supabase client. Site membership and the supervisor role are checked in SQL. Service-role keys and cron secrets belong only in operator processes and Edge workers. Generated RPC types are in `src/database.types.ts`; payload types and browser helpers are in [api.ts](../src/features/safety/api.ts).

## Read a workspace

```ts
const { data: workspace, error } = await supabase.rpc("get_safety_workspace", {
  p_site_id: siteId,
  p_work_date: "2026-10-18", // Local calendar date at the site
});
if (error) throw error;
```

Members receive `enabled`, the current `publication` or null, and freshness information when available. A publication includes its ID, revision ID, publisher, publication time, `valid_until`, status, `needs_review`, `expired`, the current member's `acknowledged` flag, and `worker_payload`. The payload contains approved `worker_items`, `coverage_gaps` and their crew-visible `evidence`.

Supervisors additionally receive `context`, the latest `run`, `revision`, `evidence` and `revision_stale`. Context contains `profile`, `job`, `profile_revision` and `job_revision`. A run exposes its ID, state (`queued`, `running`, `succeeded`, `failed`), attempt, error category and scheduling timestamps. A revision contains its ID, revision number, run ID, content and creation time.

Draft tables are not in Realtime. The safety UI polls this RPC every three seconds; urgent alerts use the existing alert path. Re-fetch after mutations and when switching site or date. Display missing evidence, stale inputs and expiration explicitly.

## Save planned work

Only an assigned supervisor can save context. Read the workspace first and pass its revision numbers; use zero when no profile or job exists.

```ts
const { data: saved, error } = await supabase.rpc("save_safety_context", {
  p_site_id: siteId,
  p_work_date: workDate,
  p_profile_revision: workspace.context.profile_revision,
  p_job_revision: workspace.context.job_revision,
  p_profile: {
    state: "FL",
    employer_sector: "private",
    classification: "operations_maintenance",
    coverage_notes: "Coverage confirmed by the site supervisor",
    enabled: true,
  },
  p_job: {
    task: "electrical_maintenance",
    description: "Planned maintenance briefing",
    equipment: "Equipment identified by the supervisor",
    conditions: "Site conditions confirmed before work",
    energized: "unknown",
  },
});
if (error) throw error;
```

The response is the saved context with updated revision numbers. Profile values also allow employer sector `public` or `unknown`, and classification `construction` or `unknown`. Job tasks also allow `construction` or `other`; energized status also allows `energized` or `deenergized`. These values record uncertainty rather than implying supported legal coverage. Enabling a profile does not enable the global worker.

## Request a draft

```ts
const { data: runId, error } = await supabase.rpc("request_safety_briefing", {
  p_site_id: siteId,
  p_work_date: workDate,
  p_regenerate: false,
});
if (error) throw error;
```

Returns a run UUID immediately; poll the workspace for completion. Identical inputs reuse a request. Set `p_regenerate: true` only for an explicit new generation, including retry after a terminal failure. Generation requires an enabled profile and global configuration. A successful run creates a private draft; it never publishes automatically.

## Review and publish

Draft content contains `supervisor_items`, `worker_items`, `coverage_gaps` and `admin_notes`. Each item has `type` (`legal_requirement`, `company_policy`, `recommendation`, `observed_hazard`), `task`, `text`, `explanation`, `evidence_ids`, `applicability` (`supported`, `conditional`, `unresolved`) and `conditions`.

Select worker instructions from reviewed evidence. Supervisors can remove or reorder instructions, change supported selections and edit private notes. Free-form operating instructions require a reviewed source first. Both SQL and the generation host validate canonical text, evidence IDs, audience, scope and retained conditions.

```ts
const { data: newRevisionId, error: editError } = await supabase.rpc(
  "edit_safety_revision",
  {
    p_revision_id: revision.id,
    p_expected_revision: revision.revision,
    p_content: reviewedContent,
  },
);
if (editError) throw editError;

// Re-fetch the workspace and review the new immutable revision before publishing.
const { data: publicationId, error: publishError } = await supabase.rpc(
  "publish_safety_revision",
  {
    p_revision_id: currentRevision.id,
    p_expected_revision: currentRevision.revision,
  },
);
if (publishError) throw publishError;
```

Edits return a new revision UUID. Publication returns a publication UUID and supersedes the previous publication atomically. Publication rechecks the latest revision and current profile, job, source and hazard inputs. Reload and review again if these changed. Worker payloads omit private notes, model explanations and supervisor-only evidence.

## Withdraw and acknowledge

```ts
// Supervisor only.
const withdrawn = await supabase.rpc("withdraw_safety_publication", {
  p_publication_id: publicationId,
});
if (withdrawn.error) throw withdrawn.error;

// Assigned member; acknowledge the exact publication shown to this user.
const receipt = await supabase.rpc("acknowledge_safety_publication", {
  p_publication_id: currentPublication.id,
});
if (receipt.error) throw receipt.error;
```

Both RPCs return void. Acknowledgement rejects withdrawn, superseded, stale or expired publications. A replacement requires a new receipt. Receipt records that the user acknowledged that publication; it does not establish training, qualification or completion of work.

## Errors and worker boundary

Inspect Supabase's `{ data, error }` result before using data. Authorization failures must not expose private draft content. Revision conflicts require a reload rather than retrying stale edits; unsupported scope and missing sources appear as coverage gaps. Failed runs expose a sanitized error category through the workspace.

Trusted workers alone can claim and finish leased runs, retrieve and bind scoped evidence, stage sources and review source versions. Edge endpoints `generate-safety-briefings` and `refresh-safety-sources` authenticate `X-Cron-Secret`; browser clients use the SQL RPCs above. See the [contract](safety-contract.md) for lifecycle rules and [operations](safety-operations.md) for setup and recovery.
