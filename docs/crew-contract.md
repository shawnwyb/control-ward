# Crew hazard slice contract

## Decisions for the local implementation

These are explicit demo defaults, not additional requirements from the architecture.

- Hazards and duplicates belong to one site. Membership grants access; the supervisor role is scoped to assigned sites too.
- A duplicate is open, has the same site and type, is at most 100 meters away, and was last confirmed less than 24 hours ago. Pick nearest, then oldest, then UUID for deterministic ties.
- Severity is 1–3. Merging preserves the maximum severity and the canonical pin. Each observation preserves its submitted location and severity.
- Confirmations count accepted submissions and “still there” check-ins, not distinct people. Retrying the same request does not add a confirmation.
- Resolved hazards stay resolved. A later submission creates a new hazard. At 48 hours without confirmation, a hazard stops contributing to metrics, even before the cleanup job runs.
- A site’s configurable radius defaults to 5 km. Risk includes only that site's reports inside its radius; a neighboring site's reports are not implicitly shared.
- Crew contribution: `min(2, sum((severity / 3) * max(0, 1 - age_hours / 48)))`.
- Wildlife score: `min(10, sum(10 * (severity / 3) * max(0, 1 - age_hours / 48)))` for wildlife only. Both formulas use time since last confirmation. Scoring owner should approve these defaults.
- Check-in reminders begin after 12 hours and repeat every 12 hours. “Local crews” currently means assigned site members, not GPS-verified proximity. In-app reminders work locally; SMS/push delivery belongs to the alert service.
- Photos are optional, private, restricted to JPEG/PNG/WebP and 5 MiB. Persist object paths, never expiring signed URLs. Uploads are reserved before submission and can be retried or discarded.
- All client mutation requests carry a UUID idempotency key. Reusing a key with different input is an error; a retry returns the original outcome and report ID.

## Ownership / integration boundary

This slice provides schema, Auth/Storage policies, submission/check-in RPCs, expiry/reminder scheduling, metrics, map-ready views, Realtime updates, and a small crew UI. Weather ingestion, overall site score, Python ML, dashboard, briefing generation, and external notification delivery remain separate consumers.

`sites` and `site_memberships` in the first migration are the minimal shared registry contract. Coordinate these tables with the site-registry owner before integrating into an existing project; do not create a second registry.

External consumers use `crew_hazard_feed` for current report pins and `hazard_observations` for repeated affected areas and history. `get_site_crew_metrics(site_id)` supplies the crew term, wildlife subscore and effective open count. The alert service can consume `hazard_events`; in-app users read `hazard_checkin_tasks`.
