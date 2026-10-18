# ControlWard UI revamp — design

Date: 2026-10-17 · Status: draft for approval

Mockups (open in a browser; they are reference, not production code):
[`supervisor-sites.html`](2026-10-17-ui-revamp-mockups/supervisor-sites.html) (option 1 is the chosen icon style),
[`crew-reporting.html`](2026-10-17-ui-revamp-mockups/crew-reporting.html) (option A is chosen),
[`landing.html`](2026-10-17-ui-revamp-mockups/landing.html).

## Why

The current UI ("Field Ledger": beige paper, cobalt, IBM Plex, 1px rules, square corners, no motion)
reads like a printed form. The team finds the theme, the crew reporting layout and the supervisor
dashboard robotic, reporting clunky, and there is no landing page. The app is being judged at
SwampHacks 2026, so first impressions for judges matter as much as day-to-day use.

## Goals

1. **Notion-like theme** across the whole app: calm, friendly, quietly polished.
2. **Landing page for hackathon judges** that explains the product in seconds and leads into the live demo.
3. **Supervisor view** rebuilt around a ranked site table next to a live, geographically informative map.
4. **Crew reporting** that feels as quick as reporting a crash in Waze.
5. **Purposeful motion** so the app feels alive, not robotic.

## Non-goals

- No native mobile app. Everything stays in the existing React + Vite web app. Laptop is the primary
  target for crews and supervisors; phone-width browsers must still work but are not the design target.
- No backend, schema, RPC or Edge Function changes. The revamp is frontend only and reads the data the
  app already reads.
- No new product features beyond what the brief already asks for and the app already does.
- Dark mode is out of scope _(my call; easy to add later because everything goes through tokens)_.

## Anti-goals (would be a failure even if it works)

- Hazard danger that looks cute. Pastels are for brand and the landing page; severity must stay
  unmistakable (red/orange/yellow/green scale, always paired with a number or label).
- Losing an existing capability. Every current supervisor and crew feature must still be reachable.
- Motion that slows people down or blocks input, or that ignores `prefers-reduced-motion`.
- Apple-style color emoji anywhere in the UI.

## Constraints

- Stack stays: React 19, TypeScript, CSS Modules, MapLibre GL, Supabase client. No UI framework or
  animation library is required; CSS transitions/keyframes and small hooks are enough _(my call; the
  builder may add one small dependency if it clearly saves time, e.g. a router)_.
- **The judges' live demo runs on the hosted Supabase project with the 60 real plants.** The team
  provides demo credentials themselves; the UI only needs the normal sign-in. Nothing in the UI may
  embed or display passwords.
- `npm run dev:design` (mock backend) must keep working because it drives the UI tests and local
  development. Its `site_overview` handler currently answers only single-site queries with identical
  numbers; extend the mock so a list query works and sites get varied scores (mock-only change).
- Existing Playwright suites (`tests/ui`, `tests/ui-design`) must pass at the end. They target
  accessible names and a few ids (`#site`, `#push-title-input`, `#push-body`, `#push-blocker`,
  `#safety-checklist`, `#crew-roster`, button names like "Sign in", "Send alert", "Acknowledge",
  "Generate safety draft"). Keep those names/ids where the control still exists; where a layout change
  makes a test's navigation wrong, update the test, never delete coverage.
- Accessibility stays at least as good as today: keyboard reachable, visible focus, labelled controls,
  severity never conveyed by color alone.

## Decisions

### Theme (Notion-like)

- **Surfaces:** page `#ffffff`; sidebar `#f7f7f5`; subtle fills `#f1f1ef`; hover `rgba(55,53,47,.06)`.
- **Ink:** `#37352f` text, `#787774` secondary, `#9b9a97` tertiary. Dividers `rgba(55,53,47,.09)`.
- **Type:** system UI sans stack (`ui-sans-serif, -apple-system, "Segoe UI", Helvetica, Arial`).
  Drop IBM Plex. Page titles large and bold (Notion page-title feel); body 14px.
- **Shape:** 4–6px radius on controls, 10–12px on cards, floating panels use Notion's layered shadow
  (`0 0 0 1px rgba(15,15,15,.05), 0 3px 6px rgba(15,15,15,.1), 0 9px 24px rgba(15,15,15,.2)`).
- **Primary action:** dark ink buttons (`#37352f` with white text). Links/accent blue `#2383e2`.
- **Tags:** Notion tag palette (red `#ffe2dd/#5d1715`, orange `#fadec9/#49290e`, yellow
  `#fdecc8/#402c1b`, green `#dbeddb/#1c3829`, blue `#d3e5ef/#183347`, gray `#e3e2e0/#32302c`,
  purple `#e8deee/#412454`, brown `#eee0da`).
- **Hazard index scale (0–10):** keep the rules engine's existing three bands and labels from
  `riskLevel()` (≥7 High = red, ≥4 Elevated = orange, else Low = green), so briefing and push wording
  stay consistent. Shown as a tag with the number (and the label where space allows), and as the map
  pin color with the number on it _(my call)_.
- **Icons:** thin gray outline icons (Lucide-like: 24 grid, ~1.7 stroke, round caps), one color
  (`#91918e`), extending the existing `Icon.tsx` string-based set so map popups can reuse them. Color
  only appears in tags and on the map. No emoji.
- All values live in `src/styles/tokens.css`, replacing the Field Ledger tokens.

### App shell

- Notion-style **left sidebar** replaces the top bar + section nav for signed-in users: workspace name
  ("ControlWard"), site switcher, page links, and the account/sign-out control at the bottom.
- Pages are shown one at a time in the main area (not one long scrolling page).

**Supervisor sidebar:** Sites · Alerts (count badge) · Next-day briefing · Crew · Reports.
**Crew sidebar:** My site · Alerts (count badge) · Tomorrow's briefing · Reports.

**One current site** _(my call)_: there is a single `selectedSiteId`. The sidebar site switcher and
selecting a row in the Sites table set the same value. Alerts, Briefing, Crew, Reports and the
stop-work banner all follow the selected site, exactly as today's per-site components do. Cross-site
awareness comes only from the Sites table, which shows each site's index and active alert count from
`site_overview` (`active_alert_count`). The sidebar Alerts badge is the selected site's count. No
cross-site alerts query.

**Reports page** _(my call)_: lists every report at the site, as today, so the shared "Still there /
Gone" check-in flow stays; a "Mine" filter narrows it to the user's own reports (`reporter_id`).

Where today's components land (re-skinned, logic kept):

| Today                                                   | New home                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| `RiskPanel` (site risk, subscores)                      | Sites page: detail for the selected site (subscore bars)    |
| `AlertsSection` / `AlertsPanel`, lightning state        | Alerts page, plus the stop-work banner on map pages         |
| `BriefingPanel`, `SafetyPanel`                          | Next-day briefing page                                      |
| `CrewPanel`, `CrewAccess`, `RemoveCrew`, `PushComposer` | Crew page (supervisor)                                      |
| `ReportFeed`, `HistoryView`                             | Reports page (with a "Mine" filter)                         |
| `CrewTools` (location sharing, crew alerts)             | My site page (crew) and Alerts page                         |
| `ReportForm`                                            | Report drawer on the map (crew; supervisors can report too) |
| `StatusStrip` connection state                          | Small status line in the sidebar footer                     |

The builder decides the exact routing mechanism (hash routes, a tiny router, or state) as long as
browser back/forward works between pages and a page can be linked directly.

### Supervisor: Sites page (layout C)

- Left: Notion-style database view titled **Sites**, with a Table / Map view switcher (Board optional,
  may be omitted). Columns: name (with the top-hazard icon), hazard index tag, top hazards as tags.
  Rows sorted by current hazard index, highest first.
- Right: the live map. Clicking a row selects it and flies the map to that site; selected row is
  highlighted. Layer toggles float over the map as pill chips. They are the map's existing weather
  layers (Radar, Rain, Wind, Temperature/heat, Forecast) restyled as chips; there is no map data for
  flood, wildfire, soil or wildlife, so those appear as the site's top hazards in the table and detail,
  not as map layers _(my call)_.
- Data: one query of the `site_overview` view for all sites the user can see (RLS already scopes it),
  instead of one request per site.
- A site's detail (subscore bars, tomorrow's index, open hazards) appears for the selected site, e.g.
  in a panel under the table or a floating card on the map _(builder's call)_.

### Map

- Must convey geography and hazards: water, wetlands/landcover, roads and place labels must be readable.
  Replace the very pale Positron basemap with a more informative OpenFreeMap style (e.g. "liberty"),
  toned down if needed so hazard overlays stay the loudest layer _(my call)_.
- Keep the existing weather/radar/wind layers and markers; restyle markers to rounded score pins
  (number on a colored pill with a pointer) and gray line icons for reports.
- Lightning: the browser cannot read individual strikes, only `lightning_state` per site. When a site
  is in stop-work, draw a dashed 10-mile ring around the **site** (the stop-work radius) with a bolt
  marker, and show the last strike distance in the banner _(my call)_.

### Crew: My site page with report drawer (option A)

- The crew home is their site's live map with hazards, the site's index, and the stop-work banner
  (strike distance + live all-clear countdown) pinned top-left when active.
- **"Report hazard"** (floating dark button, bottom-right) slides a drawer in from the right:
  - Hazard tiles: Debris, Wildlife, Downed line, Washout, Other (from `hazardLabels`).
  - The pin drops at the user's current location as soon as the drawer opens; clicking the map moves it.
    No latitude/longitude fields. If location is unavailable or denied, the pin starts at the site
    center and a one-line hint says to click the map.
  - Severity: Low / Moderate / High segmented control.
  - Optional note _(only if the backend already accepts one; otherwise omit — no backend changes)_.
  - **Optional photo** drop zone ("Add photo (optional) · drop a file or choose one"), same limits as
    today (JPEG/PNG/WebP, 5 MB).
  - **Send report**. Existing duplicate-merge behavior and messages stay.
- After sending: drawer closes, a short "Report sent" toast, the new pin drops onto the map.
- Phone-width fallback: the drawer becomes a bottom sheet.

### Landing page (for judges)

Shown to signed-out visitors at the root; "Sign in" / "Open live demo" lead to sign-in.

1. **Nav:** logo + ControlWard, How it works, Features, Data, Sign in, **Open live demo**.
2. **Hero:** badge "Built for utility field crews · SwampHacks 2026"; headline
   "Every hazard on site. _One picture._" (highlighted second line); buttons "Open live demo →" and
   "See how it works". **No gray paragraph under the headline.** Right side: six pastel jigsaw pieces
   (Extreme heat, Lightning, Flooding, Soil, Wildfire, Wildlife, each with a short reading) fly in one
   by one and snap into a 3×2 grid, then a score card pops in below: "Big Cypress Sub · Hazard index
   8.6 · Stop work". Replays on a small "↻ replay" link.
3. **"6:45 AM, the Everglades."** The brief's scenario as four hazard cards.
4. **"What ControlWard does":** a horizontal sliding carousel of wide cards, each with a picture of
   the app on top and number + title + description below. Six cards: one risk picture per site,
   instant stop-work alerts, 6 PM next-day briefing, crew hazard reports, supervisor dashboard,
   hazard index 0–10 (7-day forecast). Auto-advances every ~4.5s, pauses on hover, arrows + dots.
   Pictures may be HTML/SVG recreations of the app or real screenshots _(builder's call; recreations
   stay crisp and need no asset pipeline)_.
5. **"See it running":** an animated, looping recreation of the supervisor Sites view: a lightning
   strike near Big Cypress Sub, its index counts 6.1 → 8.6 in table and pin, the row slides to the top,
   the stop-work banner drops in with a live countdown, the Alerts badge appears, a cursor clicks the
   row and the map zooms in. Starts when scrolled into view; ~11s loop.
6. **"Built on public data":** EIA-860M, NOAA Storm Events, Iowa Environmental Mesonet, OSHA Severe
   Injury Reports, National Levee Database, NOAA Tides & Currents, FEMA Flood Maps.
7. **Closing CTA:** "Plan ahead instead of reacting." · "Try it with 50+ real power plant sites."
   (Not "Florida".)

Landing visuals use static/mock numbers; it does not call the backend.

### Motion

- Report drawer slides in; pin drops with a small bounce; "Report sent" toast.
- Site table re-sorts smoothly when scores change (rows animate to new positions); score tags
  count/transition when values change.
- Stop-work banner drops in; alert badges fade in.
- Page changes: quick fade/slide (≤200ms).
- Hover lift on cards; map fly-to on row select.
- Landing: puzzle snap, score pop, carousel, "See it running" loop.
- Everything respects `prefers-reduced-motion` (no movement; instant state changes).

## Left to the builder

- Component structure, file organization, routing mechanism, and how the existing components are split
  or wrapped to fit the new pages.
- Exact OpenFreeMap style choice and any paint tweaks, within the "informative but calm" rule.
- Whether the landing carousel uses recreations or screenshots.
- Copy polish for empty, loading and error states, in the same plain friendly voice.
