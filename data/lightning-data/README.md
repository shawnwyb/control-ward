# lightning-data

`glm_fetch.py` pulls historical lightning flash detections from NOAA GOES-East's
Geostationary Lightning Mapper (GLM) satellite archive — the same public, keyless
source and decode logic the live app uses in `supabase/functions/ingest-lightning/`,
but for any past date instead of "now" (that pipeline only has data from whenever
it was deployed onward).

**Heads up on volume:** NOAA publishes one file every 20 seconds regardless of your
query area — a full day is ~4,320 files / ~1.1GB of transient downloads. Use
`--hour-start`/`--hour-end` to narrow it.

See the module docstring in `glm_fetch.py` (`python glm_fetch.py flashes --help`)
for full usage and exit codes. Every output file gets a `<out>.manifest.json`
sidecar.
