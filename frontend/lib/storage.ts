// Object storage for uploaded inspection images (Node runtime).
//
// Production (Vercel/AWS): writes to an S3-compatible bucket via the S3 API, so
// the same code works against AWS S3, Cloudflare R2, or Supabase Storage — only
// the S3_* env vars change. Vercel's filesystem is ephemeral, so images MUST go
// to a bucket there.
//
// Local dev: when S3_BUCKET is unset, falls back to writing public/uploads so
// `npm run dev` needs zero cloud setup. The returned URL is the only difference
// the rest of the app sees.

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BUCKET = process.env.S3_BUCKET;

const globalForS3 = globalThis as unknown as { __s3?: S3Client };
function client(): S3Client {
  if (globalForS3.__s3) return globalForS3.__s3;
  const c = new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    // R2 / Supabase Storage need an explicit endpoint + path-style addressing;
    // native AWS S3 leaves both unset and addresses by region + virtual host.
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle:
      process.env.S3_FORCE_PATH_STYLE === "1" || Boolean(process.env.S3_ENDPOINT),
    // Explicit keys for R2/Supabase/non-AWS; omit on AWS to use the instance's
    // IAM role via the default credential chain.
    credentials:
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          }
        : undefined,
  });
  globalForS3.__s3 = c;
  return c;
}

/**
 * Store an image and return a URL the browser can load.
 * `key` is a flat object key (e.g. "1719500000_ab12cd.jpg").
 */
export async function putImage(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  if (!BUCKET) {
    // No bucket is only valid in local dev. In production this would write to the
    // read-only/ephemeral serverless filesystem and silently lose images, so fail loudly.
    if (process.env.VERCEL || process.env.NODE_ENV === "production") {
      throw new Error(
        "S3_BUCKET is not configured. Set S3_BUCKET (+ S3_* credentials and S3_PUBLIC_BASE_URL) for production image storage.",
      );
    }
    // ponytail: local-dev fallback to public/uploads — no bucket needed for dev.
    const dir = join(process.cwd(), "public", "uploads");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, key), body);
    return `/uploads/${key}`;
  }

  await client().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );

  // The browser-loadable public URL scheme differs per provider (R2 r2.dev/custom
  // domain, Supabase /storage/v1/object/public/...), and is NOT the S3 API
  // endpoint — so require it explicitly rather than guessing and persisting a
  // broken URL into images.file_url.
  const base = process.env.S3_PUBLIC_BASE_URL;
  if (!base) {
    throw new Error(
      "S3_PUBLIC_BASE_URL is required when S3_BUCKET is set — the bucket's public URL base " +
        "(e.g. an R2 r2.dev/custom domain, or Supabase /storage/v1/object/public/<bucket>).",
    );
  }
  return `${base.replace(/\/+$/, "")}/${key}`;
}
