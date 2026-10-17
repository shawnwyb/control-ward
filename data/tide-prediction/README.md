# tide-prediction

`tide_fetch.py` pulls tide predictions and station metadata from NOAA CO-OPS
(`api.tidesandcurrents.noaa.gov`), a free public API with no key required.

See the module docstring in `tide_fetch.py` (`python tide_fetch.py --help`,
or `python tide_fetch.py predictions --help` / `stations --help`) for usage,
parameters, and exit codes. Every output file gets a `<out>.manifest.json`
sidecar recording the exact requests made, a SHA-256 of the output, and the
row count.
