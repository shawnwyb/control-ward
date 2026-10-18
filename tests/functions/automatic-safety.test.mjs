import { test } from "node:test";
import assert from "node:assert/strict";
import {
  automaticFailureDiagnostics,
  runAutomaticSafety,
  validateItems,
  geminiResearch,
} from "../../supabase/functions/_shared/automatic-safety/agent.ts";
import {
  resolveJurisdiction,
  sourceCandidates,
  officialUrl,
  fetchOfficialDocument,
} from "../../supabase/functions/_shared/automatic-safety/research.ts";
import { scopeGap } from "../../supabase/functions/_shared/automatic-safety/contracts.ts";

const site = {
  id: "site-a",
  name: "Fixture power plant",
  latitude: 29.652,
  longitude: -82.325,
  timezone: "America/New_York",
  plant_type: "Generator",
  utility: "Fixture utility",
};
const geography = {
  result: {
    geographies: {
      States: [{ NAME: "Florida", STUSAB: "FL" }],
      Counties: [{ NAME: "Alachua County" }],
      "Incorporated Places": [{ NAME: "Gainesville city" }],
    },
  },
};
const quote =
  "FICTIONAL TEST SOURCE: provide drinking water for workers exposed to heat.";
const snapshot = {
  site,
  work_date: "2026-10-18",
  captured_at: "2026-10-18T12:00:00Z",
  model: "fake-auto",
  input_key: "fixture",
  hazards: {
    readings: [
      {
        id: 12,
        hazard: "heat",
        value: 92,
        unit: "F",
        observed_at: "2026-10-18T11:55:00Z",
        forecast_for: "-infinity",
        source: "fixture",
      },
    ],
    alerts: [],
    crew: [],
    lightning: null,
  },
};
const discovery = {
  sources: [
    {
      url: "https://www.florida.gov/workers",
      title: "Fixture state guidance",
      level: "state",
      jurisdiction: "Florida",
    },
    {
      url: "https://alachuacounty.gov/workers",
      title: "Fixture county guidance",
      level: "county",
      jurisdiction: "Alachua County",
    },
    {
      url: "https://gainesville.gov/workers",
      title: "Fixture city guidance",
      level: "city",
      jurisdiction: "Gainesville city",
    },
  ],
};
const items = {
  items: [
    {
      kind: "guidance",
      title: "Heat precautions",
      text: quote,
      conditions: "Fictional fixture; scope depends on work and employer.",
      citations: [{ source_id: "source-1", quote }],
    },
  ],
};
const fetcher = async (target) =>
  String(target).startsWith("https://geocoding.geo.census.gov/")
    ? Response.json(geography)
    : new Response(
        `<html><body>${quote} Additional fictional source context for the offline fixture.</body></html>`,
        { headers: { "content-type": "text/html" } },
      );
const fixtureModel = (transform = (v) => v) => ({
  async ask(prompt, search) {
    if (search) assert.ok(prompt.includes("Alachua County"));
    else assert.ok(prompt.includes('"value":92'));
    return {
      value: transform(search ? discovery : items, search),
      grounded: search,
      tokens: 100,
    };
  },
});

test("automatic site research finds state/county/city sources and produces a cited heat checklist without a job or admin approval", async () => {
  const output = await runAutomaticSafety(snapshot, fixtureModel(), {
    fetcher,
    reservedUsdPerTurn: 0.1,
  });
  assert.equal(output.content.jurisdiction.state_code, "FL");
  assert.equal(output.content.jurisdiction.city, "Gainesville city");
  assert.equal(output.content.items[0].text, quote);
  assert.deepEqual(output.content.conditions, snapshot.hazards.readings);
  assert.ok(output.content.coverage_gaps.includes(scopeGap));
  assert.ok(
    !output.content.coverage_gaps.some(
      (g) =>
        g.startsWith("No state") ||
        g.startsWith("No county") ||
        g.startsWith("No city"),
    ),
  );
  assert.equal(output.diagnostics.turns, 2);
  assert.equal(output.diagnostics.tokens, 200);
  assert.equal(output.diagnostics.reserved_spend_usd, 0.2);
  assert.ok(!JSON.stringify(output.diagnostics).includes(quote));
});
test("geography uses containing incorporated places, never the nearest city or a census-designated place", async () => {
  const data = structuredClone(geography);
  delete data.result.geographies["Incorporated Places"];
  data.result.geographies["Census Designated Places"] = [
    { NAME: "Nearby town" },
  ];
  const result = await resolveJurisdiction(
    site,
    AbortSignal.timeout(1000),
    async () => Response.json(data),
  );
  assert.equal(result.city, null);
  assert.equal(result.county, "Alachua County");
});
test("source discovery rejects another jurisdiction and arbitrary URLs, credentials, ports and local hosts", async () => {
  const jurisdiction = await resolveJurisdiction(
    site,
    AbortSignal.timeout(1000),
    fetcher,
  );
  assert.equal(
    sourceCandidates(
      {
        sources: [
          ...discovery.sources,
          {
            ...discovery.sources[0],
            jurisdiction: "California",
            url: "https://ca.gov/workers",
          },
        ],
      },
      jurisdiction,
    ).length,
    3,
  );
  for (const url of [
    "http://osha.gov/",
    "https://user:pass@osha.gov/",
    "https://osha.gov:8080/",
    "https://127.0.0.1/",
    "https://osha.gov.evil.com/",
    "https://example.com/",
    "file:///tmp/key",
  ])
    assert.equal(officialUrl(url), null);
  assert.ok(officialUrl("https://osha.gov/"));
  assert.ok(officialUrl("https://www.leg.state.fl.us/"));
});
test("official redirects are validated at every hop and oversized sources are rejected", async () => {
  const source = {
    id: "source-1",
    ...discovery.sources[0],
    checked_at: "2026-10-18",
  };
  let calls = 0;
  await assert.rejects(
    fetchOfficialDocument(source, AbortSignal.timeout(1000), async () => {
      calls++;
      return new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/admin" },
      });
    }),
    /redirect_not_official/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    fetchOfficialDocument(
      source,
      AbortSignal.timeout(1000),
      async () =>
        new Response("large", {
          headers: { "content-type": "text/html", "content-length": "2000000" },
        }),
    ),
    /too_large/,
  );
});
test("fabricated passages, changed instructions and numeric controls cannot reach a checklist", () => {
  const documents = [
    {
      ...discovery.sources[0],
      id: "source-1",
      checked_at: "2026-10-18",
      text: quote,
    },
  ];
  assert.throws(
    () =>
      validateItems(
        {
          items: [
            { ...items.items[0], citations: [{ source_id: "missing", quote }] },
          ],
        },
        documents,
      ),
    /unsupported_quote/,
  );
  assert.throws(
    () =>
      validateItems(
        { items: [{ ...items.items[0], text: "Invented rule" }] },
        documents,
      ),
    /not_in_source/,
  );
  assert.throws(
    () =>
      validateItems(
        { items: [{ ...items.items[0], conditions: "Rest every 15 minutes" }] },
        documents,
      ),
    /unsupported_number/,
  );
  const proposed = [
    {
      ...documents[0],
      title: "Proposed heat rule",
      url: "https://osha.gov/laws-regs/proposed-heat",
    },
  ];
  assert.equal(
    validateItems(
      { items: [{ ...items.items[0], kind: "regulation" }] },
      proposed,
    )[0].kind,
    "guidance",
  );
});
test("unavailable geography and sources yield explicit gaps and current conditions, never invented regulations", async () => {
  const output = await runAutomaticSafety(
    snapshot,
    {
      async ask(_prompt, search) {
        assert.equal(search, true);
        return { value: discovery, tokens: 10, grounded: false };
      },
    },
    {
      fetcher: async () => new Response("Unavailable", { status: 503 }),
      reservedUsdPerTurn: 0.1,
    },
  );
  assert.equal(output.content.items.length, 0);
  assert.equal(output.content.jurisdiction.resolved, false);
  assert.ok(
    output.content.coverage_gaps.some((g) =>
      g.includes("Jurisdiction lookup is unavailable"),
    ),
  );
  assert.ok(
    output.content.coverage_gaps.some((g) =>
      g.includes("Search grounding was unavailable"),
    ),
  );
  assert.deepEqual(output.content.conditions, snapshot.hazards.readings);
});
test("model and spend limits bound automatic discovery and generation", async () => {
  await assert.rejects(
    runAutomaticSafety(snapshot, fixtureModel(), {
      fetcher,
      reservedUsdPerTurn: 0.3,
      maxSpendUsd: 0.5,
    }),
    /resource_limit/,
  );
  await assert.rejects(
    runAutomaticSafety(snapshot, fixtureModel(), {
      fetcher,
      reservedUsdPerTurn: NaN,
    }),
    /unconfigured/,
  );
});
test("Gemini performs grounded discovery and ignores thought text while retaining search attribution", async () => {
  let request;
  const adapter = geminiResearch(
    "fixture-key",
    "gemini-3.8-flash",
    async (_url, init) => {
      request = JSON.parse(init.body);
      return Response.json({
        candidates: [
          {
            content: {
              parts: [
                { thought: true, text: "private thought" },
                { text: JSON.stringify(discovery) },
              ],
            },
            groundingMetadata: {
              groundingChunks: [{ web: { uri: discovery.sources[0].url } }],
              searchEntryPoint: {
                renderedContent: "<p>Google Search suggestions</p>",
              },
            },
          },
        ],
        usageMetadata: { totalTokenCount: 123 },
      });
    },
  );
  const result = await adapter.ask(
    "Find official safety sources",
    true,
    AbortSignal.timeout(1000),
  );
  assert.deepEqual(request.tools, [{ google_search: {} }]);
  assert.equal(request.generationConfig.thinkingConfig.includeThoughts, false);
  assert.deepEqual(result.value, discovery);
  assert.equal(result.grounded, true);
  assert.equal(result.tokens, 123);
  assert.match(result.search_entry_point, /Google Search/);
});

test("failed and interrupted runs retain bounded partial usage without source bodies", async () => {
  for (const interrupted of [false, true]) {
    const controller = new AbortController();
    const model = {
      async ask(prompt, search) {
        if (search) return fixtureModel().ask(prompt, search);
        if (!interrupted) throw new Error("provider_failed");
        controller.abort(new Error("fixture_abort"));
        return new Promise(() => {}); // A provider that ignores cancellation must not retain the host.
      },
    };
    await assert.rejects(
      runAutomaticSafety(snapshot, model, {
        fetcher,
        reservedUsdPerTurn: 0.1,
        signal: controller.signal,
      }),
      (error) => {
        const diag = automaticFailureDiagnostics(error);
        assert.equal(diag.turns, 2);
        assert.equal(diag.tokens, 100);
        assert.equal(diag.reserved_spend_usd, 0.2);
        assert.equal(diag.usage_complete, false);
        assert.ok(!JSON.stringify(diag).includes(quote));
        return true;
      },
    );
  }
});
test("fresh non-heat readings cannot hide missing heat data", async () => {
  const input = structuredClone(snapshot);
  input.hazards.readings[0].hazard = "wind";
  const output = await runAutomaticSafety(input, fixtureModel(), {
    fetcher,
    reservedUsdPerTurn: 0.1,
  });
  assert.ok(
    output.content.coverage_gaps.some((g) =>
      g.startsWith("Current heat readings are missing"),
    ),
  );
});

test("blocked OSHA pages retain their failure status and do not prevent independently fetched CDC guidance", async () => {
  const output = await runAutomaticSafety(snapshot, fixtureModel(), {
    reservedUsdPerTurn: 0.1,
    fetcher: async (url) =>
      String(url).includes("osha.gov")
        ? new Response("Forbidden", { status: 403 })
        : fetcher(url),
  });
  assert.ok(
    output.content.sources.some((s) =>
      s.url.startsWith("https://www.cdc.gov/niosh/"),
    ),
  );
  assert.equal(output.research.fetch_failures.length, 2);
  assert.ok(
    output.research.fetch_failures.every(
      (f) => f.category === "source_http_403",
    ),
  );
});
