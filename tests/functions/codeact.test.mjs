import test from "node:test";
import assert from "node:assert/strict";
import {
  runCodeAct,
  validateConciseProposal,
} from "../../scripts/safety/codeact/agent.mjs";
import { createSandbox } from "../../scripts/safety/codeact/sandbox.mjs";

const quote =
  "Provide workers with water and a cool place to rest during hot work.";
const snapshot = {
  site: {
    id: "test",
    name: "Test plant",
    latitude: 29.6,
    longitude: -82.3,
    timezone: "America/New_York",
    plant_type: null,
    utility: null,
  },
  work_date: "2026-10-18",
  captured_at: new Date().toISOString(),
  model: "gemini-test",
  hazards: { readings: [], alerts: [], crew: [], lightning: null },
};
const item = {
  kind: "guidance",
  title: "Use water and a cool rest area",
  text: quote,
  conditions: "General workplace heat guidance; confirm task applicability.",
  citations: [{ source_id: "source-1", quote }],
};

test(
  "Python actions compose actual tools, retain state after an error, and adapt using feedback",
  { timeout: 30000 },
  async () => {
    let calls = 0;
    const output = await runCodeAct(snapshot, {
      fetcher: async (url) => {
        if (String(url).includes("geocoding.geo.census.gov"))
          return Response.json({
            result: {
              geographies: {
                States: [{ NAME: "Florida", STUSAB: "FL" }],
                Counties: [{ NAME: "Alachua County" }],
              },
            },
          });
        if (String(url).includes("blocked"))
          return new Response("", { status: 403 });
        return new Response(
          `<p>Official agency heat guidance. ${quote} This evidence is a fictional unit fixture.</p>`,
          { headers: { "content-type": "text/html" } },
        );
      },
      async ask(prompt, search) {
        if (search)
          return {
            value: {
              sources: [
                {
                  url: "https://www.osha.gov/blocked",
                  title: "Blocked fixture",
                  level: "federal",
                  jurisdiction: "United States",
                },
              ],
            },
            grounded: true,
            tokens: 100,
          };
        calls++;
        if (calls === 1)
          return {
            value: {
              type: "execute",
              code: `ctx = get_site_context()\nsources = search_official_sources("heat rules")\ndocs = []\nfor s in sources["sources"]:\n    try:\n        docs.append(read_source(s["id"]))\n    except RuntimeError as e:\n        print(str(e))\nprint([(d["id"], d["text"]) for d in docs])\nraise ValueError("recoverable execution error")`,
            },
            tokens: 100,
          };
        if (calls === 2) {
          assert.match(prompt, /source_http_403/);
          assert.match(prompt, /recoverable execution error/);
          return {
            value: {
              type: "execute",
              code: `assert len(docs) == 1\nitems = ${JSON.stringify([item])}\nprint(check_proposal(items))`,
            },
            tokens: 100,
          };
        }
        assert.match(prompt, /'valid': True/);
        return {
          value: { type: "finish", proposal_id: "proposal-1" },
          tokens: 100,
        };
      },
    });
    assert.equal(output.content.items.length, 1);
    assert.equal(output.trace.filter((e) => e.type === "action").length, 2);
    assert.equal(output.trace.filter((e) => e.type === "tool").length, 5);
    assert.ok(
      output.content.coverage_gaps.some((g) =>
        g.includes("could not be fetched"),
      ),
    );
    assert.ok(
      output.content.coverage_gaps.some((g) => g.includes("Alachua County")),
    );
    assert.equal(output.documents[0].text.includes(quote), true);
  },
);

test(
  "sandbox has no host secrets, host write access or outbound network",
  { timeout: 15000 },
  async () => {
    process.env.CODEACT_TEST_SECRET = "must-not-enter-container";
    const sandbox = createSandbox({ signal: AbortSignal.timeout(12000) });
    try {
      const result = await sandbox.execute(
        `import os, socket\nassert os.getuid() == 65534\nassert os.getenv("CODEACT_TEST_SECRET") is None\ntry:\n    open("/interpreter.py", "w")\n    raise AssertionError("writable host mount")\nexcept OSError:\n    pass\ns = socket.socket()\ns.settimeout(1)\ntry:\n    s.connect(("1.1.1.1", 443))\n    raise AssertionError("outbound network enabled")\nexcept OSError:\n    pass\nprint("isolated")`,
        () => {
          throw new Error("unknown_tool");
        },
      );
      assert.equal(result.error, null);
      assert.equal(result.output.trim(), "isolated");
    } finally {
      sandbox.close();
      delete process.env.CODEACT_TEST_SECRET;
    }
  },
);

test("concise publication rejects fabricated evidence, numbers and excessive instructions", () => {
  const docs = [
    {
      id: "source-1",
      title: "Fixture",
      url: "https://www.cdc.gov/heat",
      text: quote,
    },
  ];
  assert.equal(validateConciseProposal([item], docs).length, 1);
  assert.throws(
    () => validateConciseProposal(Array(6).fill(item), docs),
    /checklist_too_long/,
  );
  assert.throws(
    () =>
      validateConciseProposal(
        [{ ...item, title: "Rest every 15 minutes" }],
        docs,
      ),
    /unsupported_number/,
  );
  assert.throws(
    () =>
      validateConciseProposal(
        [
          {
            ...item,
            citations: [
              {
                source_id: "source-1",
                quote: "Invented instructions with no evidence.",
              },
            ],
          },
        ],
        docs,
      ),
    /unsupported_quote/,
  );
});

test("CodeAct provider output has a bounded allowance and distinguishes truncation", async () => {
  const { geminiResearch } =
    await import("../../supabase/functions/_shared/automatic-safety/agent.ts");
  const model = geminiResearch(
    "fixture-key",
    "gemini-test",
    async (_url, init) => {
      const request = JSON.parse(init.body);
      assert.equal(request.generationConfig.maxOutputTokens, 8192);
      return Response.json({
        candidates: [
          {
            finishReason: "MAX_TOKENS",
            content: { parts: [{ text: '{"type":' }] },
          },
        ],
        usageMetadata: { totalTokenCount: 8192 },
      });
    },
    "codeact",
  );
  await assert.rejects(
    () => model.ask("fixture", false, AbortSignal.timeout(1000)),
    /model_output_truncated/,
  );
});
