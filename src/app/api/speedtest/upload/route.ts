import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  // Fix: Stream the body as it arrives and measure from first byte to last byte.
  // This is more accurate than Date.now() before request.blob() because blob()
  // starts counting BEFORE any data has arrived.
  if (!request.body) {
    return NextResponse.json({ error: "No body" }, { status: 400 });
  }

  const reader = request.body.getReader();
  let receivedBytes = 0;
  let startTime = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    // Start the clock when the first byte arrives (not before)
    if (receivedBytes === 0) {
      startTime = performance.now();
    }
    receivedBytes += value?.length ?? 0;
  }

  const endTime = performance.now();
  const elapsedSeconds = Math.max((endTime - startTime) / 1000, 0.001);
  const mbps = (receivedBytes * 8) / elapsedSeconds / 1_000_000;

  return NextResponse.json({
    received: receivedBytes,
    elapsedMs: endTime - startTime,
    speedMbps: Math.round(mbps * 100) / 100,
  });
}
