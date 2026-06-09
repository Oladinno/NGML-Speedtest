import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CHUNK_SIZE = 65536;

export async function GET(request: NextRequest) {
  const sizeParam = request.nextUrl.searchParams.get("size") || "25";
  const sizeMB = Math.min(parseInt(sizeParam, 10) || 25, 100);
  const totalBytes = sizeMB * 1024 * 1024;

  const stream = new ReadableStream({
    async start(controller) {
      let sent = 0;

      while (sent < totalBytes) {
        const remaining = totalBytes - sent;
        const len = Math.min(CHUNK_SIZE, remaining);
        const chunk = new Uint8Array(len);
        crypto.getRandomValues(chunk);
        controller.enqueue(chunk);
        sent += len;

        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      controller.close();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(totalBytes),
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
