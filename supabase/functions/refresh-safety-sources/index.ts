import { rpc, serve } from "../_shared/runtime.ts";
import { officialCorpus } from "../_shared/safety-agent/corpus.ts";
import {
  contentHash,
  fetchApprovedHtml,
} from "../_shared/safety-agent/ingestion.ts";
serve("refresh-safety-sources", async () => {
  const results = [];
  for (const { passages, ...source } of officialCorpus) {
    try {
      const document = await fetchApprovedHtml(source.url);
      // A changed curated passage requires an operator to update the manifest; never invent replacements.
      const matches = passages.every((p) => document.includes(p.excerpt));
      const id = await rpc("stage_safety_source", {
        p_source: source,
        p_hash: await contentHash(document, passages),
        p_passages: matches
          ? passages
          : [
              {
                anchor: "changed-source-review",
                excerpt: document.slice(0, 1000),
                instruction: "Source changed; human review required.",
                conditions:
                  "Do not approve until passages, exceptions and instructions are reviewed.",
              },
            ],
        p_document: document,
      });
      results.push({ source: source.key, id, passages_match: matches });
    } catch {
      results.push({ source: source.key, error: "source_unavailable" });
    }
  }
  return { results };
});
