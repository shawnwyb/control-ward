export const allowedSources = new Set([
  "https://www.osha.gov/stateplans",
  "https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.269",
  "https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.950",
]);

export function normalizeHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&sect;|&#167;/g, "§")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchApprovedHtml(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  if (!allowedSources.has(url)) throw new Error("source_not_allowlisted");
  const signal = AbortSignal.timeout(15_000);
  const response = await fetcher(url, {
    redirect: "error",
    signal,
    headers: { accept: "text/html", "user-agent": "ControlWardSafetyPilot/1.0" },
  });
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("text/html")
  )
    throw new Error("source_unavailable");
  if (response.url && response.url !== url)
    throw new Error("source_redirect_rejected");
  const limit = 1_500_000;
  if (Number(response.headers.get("content-length") ?? 0) > limit)
    throw new Error("source_too_large");
  if (!response.body) throw new Error("source_empty");
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error("source_too_large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return normalizeHtml(new TextDecoder().decode(joined));
}
export async function contentHash(
  document: string,
  passages: unknown,
): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify({ document, passages })),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
