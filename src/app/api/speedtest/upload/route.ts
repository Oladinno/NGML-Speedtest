import { NextResponse } from "next/server";

// ─── Stateless upload receiver — platform-agnostic ────────────────────────────
// Streams the incoming body byte-by-byte (no buffering), measures throughput,
// and returns a JSON response. No body-parser middleware — we read the raw stream
// directly so the function stays within platform memory limits.
//
// The client drives the test window by firing repeated small (~4 MB) XHR requests
// via measureUploadSpeed() in speedtest.ts. This is the industry standard approach
// used by fast.com, Cloudflare Speed Test, and Speedtest.net.
//
// maxDuration is set conservatively (30s) — each individual 4 MB upload completes
// in well under 10s on any real connection.
export const dynamic    = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  if (!request.body) {
    return NextResponse.json({ error: "No body" }, { status: 400 });
  }

  const reader = request.body.getReader();
  let receivedBytes = 0;
  let startTime     = 0;

  // Stream the body as it arrives — start the clock on the first byte.
  // This excludes connection setup time from the measurement (more accurate).
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    if (receivedBytes === 0) {
      startTime = performance.now();
    }
    receivedBytes += value?.length ?? 0;
  }

  const endTime        = performance.now();
  const elapsedSeconds = Math.max((endTime - startTime) / 1000, 0.001);
  const mbps           = (receivedBytes * 8) / elapsedSeconds / 1_000_000;

  return NextResponse.json({
    received:  receivedBytes,
    elapsedMs: endTime - startTime,
    speedMbps: Math.round(mbps * 100) / 100,
  });
}
