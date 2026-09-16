import { Hono } from "hono";
import type { Env } from "../lib/types";
import { createPresignedUploadUrl } from "../lib/r2presign";
import { newId } from "../lib/id";

export const uploadRoutes = new Hono<{ Bindings: Env }>();

// Studio requests a presigned URL, uploads the file straight to R2 from the
// browser, then saves the resulting key against a track/programme/asset record.
uploadRoutes.post("/presign", async (c) => {
  const { filename, content_type, folder } = await c.req.json<{
    filename: string;
    content_type: string;
    folder: "audio" | "artwork" | "masters";
  }>();

  if (!filename || !content_type || !folder) {
    return c.json({ error: "filename, content_type and folder are required" }, 400);
  }

  const safeName = filename.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const key = `${folder}/${newId("upl")}-${safeName}`;

  const uploadUrl = await createPresignedUploadUrl(c.env, key, content_type);

  return c.json({ upload_url: uploadUrl, key });
});
