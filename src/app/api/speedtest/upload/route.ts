import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const startTime = Date.now();
  const blob = await request.blob();
  const sizeBytes = blob.size;
  const endTime = Date.now();

  const elapsedSeconds = (endTime - startTime) / 1000;
  const bits = sizeBytes * 8;
  const mbps = bits / elapsedSeconds / 1_000_000;

  return NextResponse.json({
    received: sizeBytes,
    elapsedMs: endTime - startTime,
    speedMbps: Math.round(mbps * 100) / 100,
  });
}
