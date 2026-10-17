# Task safety checklist contract

## Scope and coverage

The checklist supplements the existing weather briefing, site risk, live alerts, lightning countdown and stop-work rules. A supervisor saves planned work, requests a private draft, reviews its evidence and gaps, and publishes a crew checklist. Crew acknowledge the exact publication they receive. Generation defaults off.

The supported pilot requires an explicitly confirmed Florida, private-sector, electrical operations and maintenance profile with task `electrical_maintenance`. West County Energy Center (registry EIA 56407) is the proposed pilot site; its registry entry does not establish employer coverage, membership or company approval. Construction, other jurisdictions and unknown employer/classification produce explicit coverage gaps. Construction references provide scope context and cannot supply maintenance instructions.

Energized status remains explicit: `unknown`, `energized` or `deenergized`. The current corpus supports briefing preparation. Electrical operating instructions, clearance distances, PPE ratings and work/rest schedules require separately reviewed applicable sources. A few retrieved passages do not establish complete legal coverage. Unknown effective or superseded dates remain null. Demo procedures are fictional and cannot be approved for real registry sites.

## Access and ownership

`site_memberships.role` is authoritative; client flags and email addresses do not grant access. Supervisors can read their site's profiles, planned work, runs, evidence, drafts and private notes. Assigned members can read publications and their own acknowledgement receipts. Sources are shared official material or private to one site, with a `crew` or `supervisor` audience. Worker citations require crew-visible evidence. Targeted supervisor alerts are excluded from site-wide safety snapshots.

Browser mutations use authenticated RPCs with membership checks, a fixed empty SQL search path and revoked direct table writes. Row-level security protects reads. Drafts are not broadcast through Realtime. A publication contains only approved worker items, required gaps and their crew-visible evidence, along with publication provenance.

## Revisions and publication

- Profiles and planned work use optimistic revision numbers. Stale saves fail.
- Each run has an immutable input snapshot and evidence ledger. Generated and edited draft revisions are immutable.
- Publication validates the latest revision against current profile, job, source and material-hazard inputs in one transaction. Stale drafts cannot be published.
- Publishing a replacement supersedes the previous publication. A supervisor can withdraw current guidance. Content never changes silently.
- Material input changes set `needs_review`. Validity ends at the next midnight in the site's timezone for the work date. Reads expose expiration and freshness.
- Acknowledgement belongs to one publication and one member. Withdrawn, superseded, stale or expired publications cannot be acknowledged. Receipt does not prove training, qualification or work completion.

## Evidence and generation

Items distinguish `legal_requirement`, `company_policy`, `recommendation` and `observed_hazard`. Evidence retains source/version/passage IDs, verbatim excerpts, canonical instructions, conditions, authority, dates and audience. Hazard evidence retains observation time, units and observation/forecast labels. Company policy stays distinct from law.

Worker actions select reviewed canonical instructions from retrieved evidence. Both the host and SQL reject fabricated citations, changed canonical text, omitted conditions, mismatched types, conditional legal actions and inaccessible evidence. Supervisors can select, remove and reorder supported instructions and edit private notes; new operating text requires source review. Citation integrity still requires human assessment of semantic support and applicability.

Generation uses a bounded model loop with five read-only tools: `get_job_context`, `get_site_hazards`, `search_regulations`, `search_site_documents` and `read_source_passage`. Site/date and access scope are bound by the host. Required context, hazards and source classes are gathered by the host. The model cannot execute code, fetch arbitrary URLs, mutate records, approve sources or publish. One repair attempt is allowed for invalid output.

The host limits a run to 8 turns, 12 tool calls, 50000 tokens, 4096 output tokens per turn, 80 seconds total and 8 seconds per tool. The default maximum spend reservation is $0.50. Model and per-turn pricing reservation must be configured explicitly. Prompt size uses a conservative UTF-8 byte bound; reservations require reconciliation with actual provider billing. No thought text is requested or retained.

Diagnostics retain sanitized tool names and argument shapes, evidence IDs, timing, model/prompt/tool versions, token usage and reserved spend. They exclude keys, raw queries, private document bodies and thought text. Failures retain available partial usage with `usage_complete=false`.

## Sources and freshness

Official sources come from an allowlisted manifest. Company procedures are versioned text with site ownership and audience. Retrieval uses only approved, available, applicable versions checked within 30 days. A changed source becomes a candidate; human review is required before it replaces approved evidence. Failed refreshes mark sources unavailable immediately. Conflicting sources cannot supply worker actions until resolved. Historical versions and citations remain intact.

The fetcher rejects redirects and non-allowlisted URLs, limits requests to 15 seconds and 1.5 MB, and accepts HTML only. A source's identity or audience change requires a new source key. Refresh placeholders are never approved as canonical instructions. See [source setup](safety-operations.md#sources-and-review).

## Scheduling and recovery

Requests deduplicate by site, local date, profile/job revisions, source set, material-hazard epoch, prompt and model. Explicit regeneration adds a nonce. Polling and routine sensor readings do not trigger generation. Material alert/status/severity changes mark publications for review and debounce a replacement request for one minute; urgent alerts remain immediate.

Runs move from `queued` to `running`, then `succeeded` or `failed`; retryable failures return to `queued`. Claims use `FOR UPDATE SKIP LOCKED`, 120-second leases and UUID fencing tokens. Expired leases recover, and late workers cannot complete another lease. Three attempts are allowed, with 30- and 60-second retry delays. Terminal failures require explicit regeneration after correcting the cause.

Evening enqueue runs hourly and selects next-day work at the site's local 18:00 boundary. Separate minute jobs refresh inputs and invoke the worker; sources refresh weekly. Workers await a bounded batch of one run. Existing deterministic weather briefing generation remains independent.

## Integration and verification

| Interface                                                                        | Consumer                                     |
| -------------------------------------------------------------------------------- | -------------------------------------------- |
| `save_safety_context`, `request_safety_briefing`, `get_safety_workspace`         | Supervisor planning and draft review         |
| `edit_safety_revision`, `publish_safety_revision`, `withdraw_safety_publication` | Supervisor revision and publication controls |
| `get_safety_workspace`, `acknowledge_safety_publication`                         | Crew checklist and receipt                   |
| `generate-safety-briefings`, `refresh-safety-sources`                            | Cron-secret-authenticated workers            |
| Reviewed source versions and immutable evidence                                  | Retrieval, review and historical citations   |

Release checks require every authorization, citation, queue and unsupported-scope fixture to pass, plus all labeled pilot retrieval passages. Tests cover wrong state, unknown coverage, construction, missing procedures, stale hazards, changed/unavailable/conflicting sources, fabricated citations/numbers, prompt injection, private audience and cross-site access, concurrent claims/retries, exact receipts, local dates and DST, and independent weather behavior.

Fake-model and synthetic-source tests verify workflow and integrity. Human reviewers must approve each pilot instruction, retained exception, scope and evidence support. Real model quality, acceptance, latency and billing require a staged provider check. Request/response examples are in the [API](safety-api.md); setup, test commands and release steps are in [operations](safety-operations.md).
