import { z } from "zod";
import { readMediaFile } from "@/server/admin/media";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/media?id=…&v=original|poster — files uploaded through the studio desk.
 * An id never changes its bytes (a new upload is a new id), so responses are cached for a year.
 * Range requests are answered with 206: Safari won't play a video without them.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = z.uuid().safeParse(url.searchParams.get("id"));
  const variant = url.searchParams.get("v") === "poster" ? "poster" : "original";
  if (!id.success) return new Response("Not found", { status: 404 });

  const file = await readMediaFile(await getDb(), id.data, variant);
  if (!file) return new Response("Not found", { status: 404 });

  const bytes = file.data;
  const total = bytes.byteLength;
  const headers: Record<string, string> = {
    "Content-Type": file.mimeType,
    "Cache-Control": "public, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
  };

  const range = request.headers.get("range");
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, total - Number(m[2]));
    let end = m[1] && m[2] ? Number(m[2]) : total - 1;
    if (start >= total || start > end) {
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${total}` } });
    }
    end = Math.min(end, total - 1);
    start = Math.max(0, start);
    const chunk = bytes.subarray(start, end + 1);
    return new Response(chunk as unknown as BodyInit, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Length": String(chunk.byteLength) },
    });
  }

  return new Response(bytes as unknown as BodyInit, { headers: { ...headers, "Content-Length": String(total) } });
}
