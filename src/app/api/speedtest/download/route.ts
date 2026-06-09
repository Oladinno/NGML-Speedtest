import { NextRequest, NextResponse } from "next/server";

// ─── Stateless byte-pump — platform-agnostic ──────────────────────────────────
// This route is intentionally minimal: it streams N megabytes of incompressible
// data and returns. No state, no session, no side-effects.
//
// The client drives the test window by firing repeated requests via
// measureDownloadSpeed() in speedtest.ts. This pattern works identically on:
//   • Vercel Serverless / Edge Functions
//   • AWS Lambda / API Gateway
//   • Railway / Render / Fly.io containers
//   • Self-hosted Node.js / Bun servers
//
// maxDuration is set conservatively (30s) — each individual request only
// transfers 4–8 MB which completes in well under 10s on any real connection.
export const dynamic    = "force-dynamic";
export const maxDuration = 30;

// Pre-allocate a single 1MB filler buffer at module load time with a
// deterministic incompressible pattern. Reused across all requests — no
// per-chunk allocation or crypto overhead.
const CHUNK_SIZE = 1024 * 1024; // 1 MB
const FILLER_CHUNK = (() => {
  const buf = new Uint8Array(CHUNK_SIZE);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = ((i * 0x9e3779b9) ^ (i >> 16)) & 0xff;
  }
  return buf;
})();

export async function GET(request: NextRequest) {
  const sizeParam = request.nextUrl.searchParams.get("size") || "4";

  // Cap at 8 MB per request — safe on every serverless platform.
  // The client loops requests to saturate the link over the full test window.
  const sizeMB    = Math.min(Math.max(parseInt(sizeParam, 10) || 4, 1), 8);
  const totalBytes = sizeMB * 1024 * 1024;

  let sent = 0;

  // pull()-based ReadableStream: the runtime calls pull() only when the consumer
  // is ready — proper backpressure, no artificial delays.
  const stream = new ReadableStream({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const remaining = totalBytes - sent;
      const len = Math.min(CHUNK_SIZE, remaining);
      // subarray() is a zero-copy view — no allocation per chunk
      controller.enqueue(FILLER_CHUNK.subarray(0, len));
      sent += len;
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type":             "application/octet-stream",
      "Content-Length":           String(totalBytes),
      "Cache-Control":            "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma":                   "no-cache",
      "X-Content-Type-Options":   "nosniff",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
