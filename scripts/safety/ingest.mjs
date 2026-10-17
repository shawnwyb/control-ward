// Explicit operator action. Stages candidates only; never approves or publishes.
import { resolve, dirname } from "node:path";
import { readFile } from "node:fs/promises";
import {
  officialCorpus,
  demoProcedure,
} from "../../supabase/functions/_shared/safety-agent/corpus.ts";
import {
  fetchApprovedHtml,
  contentHash,
} from "../../supabase/functions/_shared/safety-agent/ingestion.ts";
const url = process.env.SUPABASE_URL,
  key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key)
  throw new Error(
    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on this operator process only",
  );
const file = process.argv[2];
const sources =
  file && file !== "--demo"
    ? JSON.parse(await readFile(file, "utf8"))
    : file === "--demo"
      ? [
          demoProcedure(
            process.argv[3] ?? "11111111-1111-4111-8111-111111111111",
          ),
        ]
      : officialCorpus;
for (const { document_file, passages, ...source } of sources) {
  const document =
    source.category === "official"
      ? await fetchApprovedHtml(source.url)
      : document_file
        ? await readFile(resolve(dirname(file), document_file), "utf8")
        : passages.map((p) => p.excerpt).join("\n");
  for (const p of passages)
    if (!document.includes(p.excerpt))
      throw new Error(
        `Passage changed/missing in ${source.key}: ${p.anchor}; review official text`,
      );
  const response = await fetch(`${url}/rest/v1/rpc/stage_safety_source`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      p_source: source,
      p_hash: await contentHash(document, passages),
      p_passages: passages,
      p_document: document,
    }),
  });
  if (!response.ok) throw new Error(`Staging failed (${response.status})`);
  console.log(
    source.key,
    await response.json(),
    "candidate only; review required",
  );
}
