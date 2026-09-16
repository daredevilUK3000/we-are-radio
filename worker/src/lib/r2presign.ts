import { AwsClient } from "aws4fetch";
import type { Env } from "./types";

/**
 * R2 exposes an S3-compatible API, so we sign a PUT URL the same way we
 * would for S3. This lets the browser upload large audio/artwork files
 * directly to R2 without routing bytes through the Worker.
 */
export async function createPresignedUploadUrl(
  env: Env,
  key: string,
  contentType: string,
  expiresInSeconds = 60 * 10
): Promise<string> {
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });

  // aws4fetch (1.0.x) has no `expires` option - for service "s3" it hardcodes
  // X-Amz-Expires to 86400 unless the query param is already on the URL, so
  // it has to be set here before signing.
  const endpoint = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${key}?X-Amz-Expires=${expiresInSeconds}`;

  const signed = await client.sign(
    new Request(endpoint, {
      method: "PUT",
      headers: { "Content-Type": contentType },
    }),
    {
      aws: { signQuery: true },
    } as any
  );

  return signed.url;
}

export function publicMediaUrl(env: Env, key: string): string {
  // Assumes a public bucket / custom domain, or a Worker route that proxies reads.
  return `/media/${key}`;
}
