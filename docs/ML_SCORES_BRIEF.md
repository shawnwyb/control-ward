# Project brief: per-model ML scores in Supabase

Status: agreed in interview, awaiting final confirmation. The hazard-index brief stays in `docs/PROJECT_BRIEF.md`.

## Context
`ml_scores` has PK `(site_id, horizon)`, so the mud-trafficability model (`stram`) and the hazard index (`hazidx`) overwrite each other. `model_version` is only a label. `compute_site_risk` reads one ML score per horizon and has no staleness check. Findings: `20261017000700_monitoring_schema.sql:81-88`, `20261017000800_monitoring_rpcs.sql:94-108`, `20261017001200_scheduling.sql:42-79`, `models/mud-trafficability/stram/push.py`, `models/hazard-index/hazidx/dryrun.py`.

## Agreed (user answers)
- Separate rows per model.
- Show the scores separately in the app or dashboard.
- Include a staleness cutoff.

## In scope
1. **Migration (hosted, `supabase db push --linked`)**: add a `model` column (stable key, e.g. `mud`, `hazard_index`) to `ml_scores`. Make the PK `(site_id, horizon, model)`. Backfill existing rows (stram label -> `mud`).
2. **`upsert_ml_scores`**: read `model` per item and conflict on the new key. Keep the 1000-item cap and the service_role grant.
3. **`compute_site_risk`**: take the max across fresh rows per horizon (`computed_at` within the cutoff). Set `top_driver` to the winning model, e.g. 'ML mud trafficability 6.2' or 'ML hazard index 5.1'.
4. **Display**: add a read path (view or RPC) returning each model's score per site and horizon, readable by site members (reuse the `ml_read` RLS pattern). Surface it in the UI.
5. **Python pushers**: `stram/push.py` sends `model='mud'`, and its clear step deletes by `model` instead of the version label. Add a hazard-index push (`dryrun.py` payload gets `model='hazard_index'` and a resolved `site_id` via `eia_plant_id`, as stram does). Fix `RUNBOOK.md:104`.
6. **Docs**: update `docs/api-contract.md` (ml_scores/upsert_ml_scores) and CLAUDE.md (remove the "only one can feed live risk" note).

## Out of scope
Model retraining or calibration, hazard-index per-family columns (stay in the CSV), applying any push to hosted without the typed project ref.

## Assumptions (confirm or change)
- Staleness cutoff default: 36 h for `now`, 48 h for `tomorrow`, as a constant in the SQL function.
- `model` is a check-constrained text column.
- Stale rows are ignored, not deleted.
- The UI surface is the existing crew app or monitoring dashboard; the exact location is open.

## Acceptance criteria
- Pushing both models leaves 240 rows (60 sites × 2 horizons × 2 models) and neither overwrites the other.
- `push --clear` for one model leaves the other model's rows untouched.
- `compute_site_risk` uses the max of fresh scores. A row older than the cutoff no longer raises risk.
- `verify:monitoring` / `verify:rules` extended with these cases and passing against hosted (rolled back).
- Per-model scores are visible to site members and not to outsiders.

## Risks
- Migrating a live hosted PK. Do the backfill in one transaction.
- Edits to `compute_site_risk` change live risk numbers. Verify with the rolled-back SQL checks first.
- `hazidx` and `stram` pushes run from separate tooling, so keep the payload shape identical.

## Open questions
- Where the separate scores should appear in the UI.
- Final staleness values.

## Verification
`npm run verify:monitoring`, `npm run verify:rules`, `npm run test:functions`, `python -m unittest` in both model directories, then a dry-run push of each model (preview only) before any `--apply`.

