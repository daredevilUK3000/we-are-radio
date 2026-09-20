import { Hono } from "hono";
import type { Env } from "../lib/types";
import { newId, nowIso } from "../lib/id";
import { CAPSULE_STATUSES, isRealDate, parseCapsuleFields, stationToday } from "../lib/capsules";

/**
 * Studio side of Time Capsules: the request queue, editing, attaching the
 * recording, and scheduling. Requests arrive from the public form (see
 * routes/public.ts) as "requested"; nothing airs until Kizzi has attached a
 * recording and scheduled it.
 */
export const timeCapsuleRoutes = new Hono<{ Bindings: Env }>();

const SELECT = `SELECT tc.*, aa.audio_url, aa.duration_seconds, aa.title AS audio_title
                FROM time_capsules tc LEFT JOIN audio_assets aa ON aa.id = tc.audio_asset_id`;

timeCapsuleRoutes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(`${SELECT} ORDER BY tc.scheduled_date ASC, tc.created_at ASC LIMIT 1000`).all();
  return c.json({ capsules: results, today: stationToday() });
});

// Kizzi can add one herself (a request that came by phone, a gift she wants to make).
timeCapsuleRoutes.post("/", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const parsed = parseCapsuleFields(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const v = parsed.value;

  const id = newId("cap");
  const ts = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO time_capsules (id, requester_name, recipient_name, occasion_label, message_note, notify_email,
                                scheduled_date, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?, 'requested', ?, ?)`
  )
    .bind(id, v.requester_name, v.recipient_name, v.occasion_label, v.message_note, v.notify_email, v.scheduled_date, ts, ts)
    .run();
  return c.json({ id }, 201);
});

timeCapsuleRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<Record<string, unknown>>();
  const current = await c.env.DB.prepare("SELECT * FROM time_capsules WHERE id = ?")
    .bind(id)
    .first<Record<string, any>>();
  if (!current) return c.json({ error: "not found" }, 404);

  // Merge the change onto what's there, then validate the whole result: one
  // rule set for edits, attaching a recording, and moving between statuses.
  const merged = {
    requester_name: body.requester_name ?? current.requester_name,
    recipient_name: body.recipient_name ?? current.recipient_name,
    occasion_label: body.occasion_label ?? current.occasion_label,
    message_note: body.message_note ?? current.message_note,
    notify_email: "notify_email" in body ? body.notify_email : current.notify_email,
    scheduled_date: body.scheduled_date ?? current.scheduled_date,
  };
  const parsed = parseCapsuleFields(merged);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const audioAssetId = "audio_asset_id" in body ? (body.audio_asset_id as string | null) : current.audio_asset_id;
  if (audioAssetId) {
    const asset = await c.env.DB.prepare("SELECT id FROM audio_assets WHERE id = ?").bind(audioAssetId).first();
    if (!asset) return c.json({ error: "that recording doesn't exist" }, 400);
  }

  const status = (body.status ?? current.status) as string;
  if (!(CAPSULE_STATUSES as readonly string[]).includes(status)) {
    return c.json({ error: `status must be one of ${CAPSULE_STATUSES.join(", ")}` }, 400);
  }
  if ((status === "recorded" || status === "scheduled") && !audioAssetId) {
    return c.json({ error: "Record or upload the message first." }, 400);
  }
  if (status === "scheduled" && !isRealDate(parsed.value.scheduled_date)) {
    return c.json({ error: "Choose a date first." }, 400);
  }
  if (status === "scheduled" && parsed.value.scheduled_date < stationToday()) {
    return c.json({ error: "That date has already passed - pick a new date to schedule it." }, 400);
  }

  const ts = nowIso();
  await c.env.DB.prepare(
    `UPDATE time_capsules SET requester_name = ?, recipient_name = ?, occasion_label = ?, message_note = ?,
       notify_email = ?, scheduled_date = ?, audio_asset_id = ?, status = ?,
       aired_at = CASE WHEN ? = 'aired' THEN COALESCE(aired_at, ?) ELSE NULL END, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      parsed.value.requester_name,
      parsed.value.recipient_name,
      parsed.value.occasion_label,
      parsed.value.message_note,
      parsed.value.notify_email,
      parsed.value.scheduled_date,
      audioAssetId ?? null,
      status,
      status,
      ts,
      ts,
      id
    )
    .run();
  return c.json({ ok: true });
});

timeCapsuleRoutes.delete("/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM time_capsules WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});
