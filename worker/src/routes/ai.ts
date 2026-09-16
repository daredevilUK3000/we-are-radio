import { Hono } from "hono";
import type { Env, Track } from "../lib/types";

export const aiRoutes = new Hono<{ Bindings: Env }>();

const AI_MODEL = "claude-sonnet-5";

interface ProposedItem {
  item_type: "song" | "link" | "station_id" | "feature" | "interview";
  track_id?: string;
  label?: string;
}

interface ProgrammeProposal {
  title: string;
  description: string;
  items: ProposedItem[];
}

/**
 * AI-assisted programme creation (Section 15/42's "first AI capability").
 * Kizzi describes a programme in natural language; we hand Claude the real
 * catalogue metadata (never invented tracks) and ask for a *proposed*
 * running order. Nothing here writes to programme_items - the Studio must
 * call PUT /api/programmes/:id/items itself once Kizzi approves/edits it.
 */
aiRoutes.post("/propose-programme", async (c) => {
  const { brief, channel_id } = await c.req.json<{ brief: string; channel_id?: string }>();
  if (!brief) return c.json({ error: "brief is required" }, 400);

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: "AI producer is not configured (missing ANTHROPIC_API_KEY)" }, 503);
  }

  const { results: tracks } = await c.env.DB.prepare(
    `SELECT id, title, genre, subgenre, energy, tempo_bpm, duration_seconds, description
     FROM tracks WHERE status = 'published' LIMIT 300`
  ).all<Track>();

  const { results: assets } = await c.env.DB.prepare(
    `SELECT id, type, title, duration_seconds FROM audio_assets WHERE status = 'published' LIMIT 100`
  ).all();

  const systemPrompt = `You are Kizzi Radio's AI production assistant. You propose radio programme
running orders using ONLY the catalogue provided below - never invent tracks or durations.
Respond with strict JSON matching this shape, and nothing else:
{
  "title": string,
  "description": string,
  "items": [
    { "item_type": "song", "track_id": string }
    | { "item_type": "link" | "station_id" | "feature" | "interview", "label": string }
  ]
}
Prefer using tags/genre/energy/description to match the mood requested. This is a PROPOSAL for
Kizzi to review, edit and approve - it will not be published automatically.`;

  const userPrompt = `Channel: ${channel_id ?? "unspecified"}
Request: ${brief}

Available tracks (JSON): ${JSON.stringify(tracks)}
Available spoken/station audio assets (JSON): ${JSON.stringify(assets)}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": c.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    return c.json({ error: "AI request failed", detail: errText }, 502);
  }

  const data = await response.json<{ content: Array<{ type: string; text?: string }> }>();
  const text = data.content.find((block) => block.type === "text")?.text ?? "";

  let proposal: ProgrammeProposal;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    proposal = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    return c.json({ error: "AI returned unparseable output", raw: text }, 502);
  }

  return c.json({ proposal });
});
