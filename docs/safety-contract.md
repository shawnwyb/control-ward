# Automatic safety checklist contract

## Scope and behavior

The agent automatically prepares worker checklists from existing worksite coordinates, official federal/state/local safety sources and recorded local conditions, including heat. Supervisors do not enter job plans, approve sources, request drafts or publish checklists. Workers and supervisors open their assigned site, read the checklist and acknowledge its exact version.

The checklist supplements weather briefings, risk scores, live alerts, lightning countdowns and stop-work rules. Those systems continue independently and take effect immediately. Generation defaults off until server configuration is complete.

The current site registry covers US power plants. Automatic eligibility requires an EIA registry ID and at least one site membership. Coordinates resolve through the Census geography service to the containing state, county and incorporated municipality. A nearby city or Census Designated Place is not treated as municipal jurisdiction. Failed lookups and missing jurisdictions are explicit gaps.

Location does not establish employer sector, task, qualification or complete legal coverage. The agent retains scope limitations and distinguishes guidance from regulatory excerpts. It does not infer energized work or invent electrical clearances, PPE ratings, exposure limits or work/rest schedules. No company procedures are supplied to this automatic workflow.

## Research and evidence

Each run requests Google Search through the Gemini Interactions API to discover current federal, state, county and city sources dynamically. Search suggestions are not evidence: the host separately fetches the official page. Accepted hosts are HTTPS `.gov` and `*.state.XX.us`, with credentials, custom ports and nonofficial redirects rejected. Pages on delegated commercial code hosts, PDFs, blocked pages and unsupported formats cannot supply instructions in this version; their absence remains a coverage gap.

Fetched HTML/plain text is bounded to 1.5 MB and 55,000 normalized characters per source, with eight seconds per request and at most four requests in a redirect chain. At most eight sources are retained. The model sees bounded excerpts of those documents and the site's existing conditions. State/local suggestions must name the resolved jurisdiction. Missing evidence is never a conclusion that no local requirement exists.

The host validates every citation against fetched text. An item's instruction must equal its first citation's exact quote; numeric claims in titles/conditions must already occur in cited passages. Obvious proposed/draft rules and nonregulatory pages are labeled guidance. SQL independently checks shape, source identity, official URLs, jurisdiction, document text, citations, scope gap, and unchanged readings/alerts before publication. Extra private fields cannot enter published content. Citation checks establish provenance; they do not prove the model selected every applicable rule or interpreted its scope correctly.

Published evidence contains source metadata and selected quotes. Full fetched documents remain in service-only run records. Historical checklist versions and their receipts remain intact when a replacement is published. Targeted supervisor alerts are excluded from site-wide snapshots.

## Scheduling and freshness

A minute schedule automatically enqueues today's checklist for assigned registry sites, plus tomorrow's after 18:00 in the site's timezone. Generation refreshes in two-hour buckets and when material inputs change. The key includes site metadata, local work date, model, material hazard revision, heat value buckets and whether readings remain fresh. Ordinary polling does not generate work.

A unique site/date/fingerprint prevents duplicate requests. Queued or running work for the same site/date is not duplicated. The worker processes one run per invocation. Claims use row locks with `SKIP LOCKED`, a 150-second lease and UUID fencing token. Late workers cannot finish another lease. Runs retry up to three attempts with 30/60-second delays; terminal failures can be retried automatically in a later refresh bucket. There is no supervisor retry gate.

Successful finish validates current inputs and atomically supersedes the previous checklist. Changed inputs reject the result. Disabling the database switch prevents an in-flight successful run from publishing. Validity ends at the next midnight in the site's timezone. A checklist is current only while unexpired, less than four hours old and matched to current material inputs. Stale content stays visible with an explicit warning and cannot be acknowledged.

## Model limits and diagnostics

The host allows at most two model turns: grounded source discovery and extraction of cited instructions. Limits are 50,000 reported tokens, a conservative UTF-8 prompt bound, 4,096 output tokens per turn and 80 seconds overall. Configured per-turn reservations are checked before each call against a default $0.50 run ceiling. Reservations must include current model, thinking and search costs; they are accounting bounds, not provider billing guarantees or a deployment-wide daily spending limit.

Diagnostics include model, turns, known tokens, reserved spend, duration, verified source IDs and failed fetch count. Failed attempts retain available partial usage with `usage_complete=false`. Keys, prompts, raw documents and thought text are excluded from diagnostics. Provider calls that fail before reporting usage may still be billable and require reconciliation.

## Access and integration

Membership in `site_memberships` controls access for both roles. Browser RPCs use a fixed empty SQL search path, membership checks and revoked direct writes. RLS isolates site checklists and each member's receipts. Runs and full source documents are service-only. A receipt belongs to one member and one checklist; acknowledging an old version never acknowledges a replacement.

The automatic tables/RPCs are additive. Earlier profiles, job plans, reviewed-source records and private draft/publication history remain available for compatibility, but the current UI and worker do not depend on them. Old enqueue/input/source-review schedules are retired; existing weather scheduling is retained.

Tests cover jurisdiction lookup, wrong-jurisdiction suggestions, redirects, fabricated quotes/numbers, missing conditions, budget/cancellation failures, automatic publication, site isolation, exact receipts, replacement freshness and both roles' UI. Synthetic fixtures verify behavior without paid model calls. The [API](safety-api.md) describes payloads; [operations](safety-operations.md) describes setup and verification.
