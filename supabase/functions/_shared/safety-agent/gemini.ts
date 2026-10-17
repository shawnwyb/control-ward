import type { Message, ModelAdapter, ModelReply } from "./contracts.ts";
import { systemPrompt } from "./agent.ts";
export const declarations = [
  ...["get_job_context", "get_site_hazards"].map((name) => ({
    name,
    description: "Read the server-bound run snapshot.",
    parameters: { type: "OBJECT", properties: {} },
  })),
  ...["search_regulations", "search_site_documents"].map((name) => ({
    name,
    description:
      "Search approved, authorized, in-scope passages; never arbitrary URLs.",
    parameters: {
      type: "OBJECT",
      properties: { query: { type: "STRING" } },
      required: ["query"],
    },
  })),
  {
    name: "read_source_passage",
    description:
      "Read the exact authorized passage and retained context/conditions already retrieved.",
    parameters: {
      type: "OBJECT",
      properties: { passage_id: { type: "STRING" } },
      required: ["passage_id"],
    },
  },
];
// REST adapter checked against official Generate Content function-calling/thought-signature docs.
// No SDK/model default; deployment selects and prices a supported function-calling model.
export function geminiAdapter(
  key: string,
  model: string,
  fetcher: typeof fetch = fetch,
): ModelAdapter {
  if (!key || !/^gemini-[a-z0-9.-]+$/.test(model))
    throw new Error("provider_unconfigured");
  return {
    async turn(
      messages: Message[],
      signal: AbortSignal,
      maxOutputTokens: number,
    ): Promise<ModelReply> {
      const response = await fetcher(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": key,
          },
          signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: messages,
            tools: [{ functionDeclarations: declarations }],
            generationConfig: { temperature: 0.1, maxOutputTokens },
          }),
        },
      );
      if (!response.ok)
        throw new Error(
          response.status === 429 ? "provider_rate_limited" : "provider_failed",
        );
      const raw = await response.text();
      if (raw.length > 150000) throw new Error("provider_output_limit");
      const body = JSON.parse(raw);
      const content = body.candidates?.[0]?.content;
      if (!content?.parts) throw new Error("provider_empty");
      const calls = content.parts
        .filter((p: { functionCall?: unknown }) => p.functionCall)
        .map(
          (p: {
            functionCall: {
              id?: string;
              name: string;
              args: Record<string, unknown>;
            };
          }) => p.functionCall,
        );
      const text = content.parts
        .filter((p: { thought?: boolean }) => !p.thought)
        .map((p: { text?: string }) => p.text ?? "")
        .join("");
      let final: unknown;
      if (!calls.length) {
        try {
          final = JSON.parse(
            text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""),
          );
        } catch {
          final = null;
        }
      }
      return {
        calls,
        final,
        tokens: body.usageMetadata?.totalTokenCount ?? 0,
        opaque: content,
      };
    },
  };
}
