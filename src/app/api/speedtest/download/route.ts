import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Fix #1: Pre-allocate a single 1MB buffer at module load time with a
// deterministic incompressible pattern. This is reused across all requests,
// eliminating the per-chunk crypto.getRandomValues() CPU bottleneck that was
// capping throughput on the server side.
const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
const FILLER_CHUNK = (() => {
  const buf = new Uint8Array(CHUNK_SIZE);
  for (let i = 0; i < buf.length; i++) {
    // Simple bit-mixed pattern — incompressible but CPU-cheap to generate
    buf[i] = ((i * 0x9e3779b9) ^ (i >> 16)) & 0xff;
  }
  return buf;
})();

export async function GET(request: NextRequest) {
  const sizeParam = request.nextUrl.searchParams.get("size") || "150";
  const sizeMB = Math.min(Math.max(parseInt(sizeParam, 10) || 150, 1), 500);
  const totalBytes = sizeMB * 1024 * 1024;

  let sent = 0;

  // Fix #2: Use pull()-based ReadableStream. The controller calls pull() only
  // when the consumer is ready for more data — proper backpressure without any
  // artificial setTimeout delays that were throttling throughput.
  const stream = new ReadableStream({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const remaining = totalBytes - sent;
      const len = Math.min(CHUNK_SIZE, remaining);
      // subarray() returns a view — no data copy, no allocation
      controller.enqueue(FILLER_CHUNK.subarray(0, len));
      sent += len;
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(totalBytes),
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
