// Builds a next-day work plan draft for one site: hourly forecast around the site, nearby sites, and
// Gemini (with Google Search grounding) for traffic, school and wildlife context. A supervisor reviews it.
import { fetchJson, rpc, serve } from "../_shared/runtime.ts";
import { openMeteoUrl, parseLocations } from "../_shared/openmeteo.ts";
import {
  clampWindow,
  hourlyPlan,
  parseGemini,
  ringPoints,
  rulesSummary,
  workWindow,
} from "../_shared/briefing.ts";

declare const Deno: { env: { get(name: string): string | undefined } };

interface Inputs {
  site: {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    timezone: string;
    utility: string | null;
    plant_type: string | null;
  };
  for_date: string;
  briefing: Record<string, unknown>;
  risk: Record<string, { risk: number; driver: string | null }>;
  subscores: Record<string, number> | null;
  active_alerts: { kind: string; level: string }[];
  neighbors: {
    name: string;
    distance_km: number;
    risk_now: number | null;
    risk_tomorrow: number | null;
    driver: string | null;
  }[];
}

async function askGemini(prompt: string): Promise<string | null> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return null;
  const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!res.ok)
    throw new Error(
      `Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  const body = await res.json();
  return (
    body?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("") ?? null
  );
}

serve("generate-briefing-draft", async (req) => {
  const { site_id } = await req.json();
  if (typeof site_id !== "string") throw new Error("site_id required");
  const inputs = await rpc<Inputs>("get_briefing_inputs", {
    p_site_id: site_id,
  });
  const { site, for_date } = inputs;

  const ring = ringPoints(site.latitude, site.longitude);
  const forecast = parseLocations(await fetchJson<unknown>(openMeteoUrl(ring)));
  const hours = hourlyPlan(forecast, site.timezone, for_date);
  const safe = workWindow(hours);
  const base = rulesSummary(safe, hours);

  let content: Record<string, unknown> = {
    for_date,
    work_window: safe,
    summary: base.summary,
    reasons: base.reasons,
    context: { traffic: "", school: "", wildlife: "" },
    hourly: hours,
    neighbors: inputs.neighbors,
    risk: inputs.risk,
    hazards: (inputs.briefing as { hazards?: unknown }).hazards ?? [],
    open_crew_hazards:
      (inputs.briefing as { open_crew_hazards?: unknown }).open_crew_hazards ??
      [],
  };
  let source: "gemini" | "rules" = "rules";
  let geminiError: string | null = null;

  try {
    const prompt = `You help a utility field-crew supervisor plan outdoor work for ${for_date} at "${site.name}"${site.plant_type ? ` (${site.plant_type} plant)` : ""} near ${site.latitude.toFixed(3)}, ${site.longitude.toFixed(3)} (time zone ${site.timezone}).

Safety data (authoritative, do not contradict it):
- Weather-safe working window from the hourly forecast: ${safe ? `${safe.start} to ${safe.end}` : "none"}.
- Hour-by-hour (worst point within 20 km): ${JSON.stringify(hours.filter((h) => h.hour >= 5 && h.hour <= 20))}
- Computed risk: ${JSON.stringify(inputs.risk)}; subscores: ${JSON.stringify(inputs.subscores)}
- Active alerts now: ${JSON.stringify(inputs.active_alerts)}
- Crew-reported open hazards: ${JSON.stringify((inputs.briefing as { open_crew_hazards?: unknown }).open_crew_hazards ?? [])}
- Nearby sites within 50 km: ${JSON.stringify(inputs.neighbors)}

Use Google Search for local conditions on ${for_date} near the site: road closures, major events or heavy-traffic periods that affect commuting or deliveries; whether local schools are in session, their start and dismissal times, and bus or crossing activity near the site; and seasonal wildlife activity (nesting, snakes, bears, gators, migration) relevant to the area and month.

Recommend a working window INSIDE the weather-safe window (you may shorten it for traffic, school or wildlife reasons, never extend it). Reply with ONLY a JSON object:
{"work_window":{"start":"HH:MM","end":"HH:MM"} or null,"summary":"2-3 plain sentences for the crew","reasons":["short reason", ...],"context":{"traffic":"1-2 sentences","school":"1-2 sentences","wildlife":"1-2 sentences"}}
If you cannot verify something, say so in that context field instead of guessing.`;
    const answer = await askGemini(prompt);
    const parsed = answer ? parseGemini(answer) : null;
    if (parsed) {
      content = {
        ...content,
        work_window: clampWindow(parsed.work_window, safe),
        summary: parsed.summary,
        reasons: [...base.reasons, ...parsed.reasons],
        context: parsed.context,
      };
      source = "gemini";
    }
  } catch (error) {
    geminiError = String(error);
    console.error("gemini", error);
  }

  if (source === "rules")
    content.ai_note = geminiError
      ? `AI context unavailable: ${geminiError.slice(0, 200)}`
      : "AI context unavailable: no usable answer.";

  await rpc("store_briefing_draft", {
    p_site_id: site.id,
    p_for_date: for_date,
    p_content: content,
    p_source: source,
  });
  return {
    site_id: site.id,
    for_date,
    source,
    window: content.work_window,
    geminiError,
  };
});
