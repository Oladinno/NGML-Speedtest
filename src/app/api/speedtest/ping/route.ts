import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const headers = new Headers();
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  headers.set("Pragma", "no-cache");
  headers.set("Access-Control-Expose-Headers", "x-client-ip, x-client-city, x-client-region, x-client-country, x-as-owner, x-edge-id");

  // Extract Vercel geolocation and network headers
  const clientIp   = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for") || "127.0.0.1";
  const city       = request.headers.get("x-vercel-ip-city") || "";
  const region     = request.headers.get("x-vercel-ip-country-region") || "";
  const country    = request.headers.get("x-vercel-ip-country") || "";
  const asOwner    = request.headers.get("x-vercel-ip-as-owner") || "";
  const edgeId     = request.headers.get("x-vercel-id") || "";

  // Set response headers for client reading (URI-encode non-ASCII strings like city/AS names)
  if (clientIp) headers.set("x-client-ip", clientIp);
  if (city)     headers.set("x-client-city", encodeURIComponent(city));
  if (region)   headers.set("x-client-region", region);
  if (country)  headers.set("x-client-country", country);
  if (asOwner)  headers.set("x-as-owner", encodeURIComponent(asOwner));
  if (edgeId)   headers.set("x-edge-id", edgeId);

  return new NextResponse(null, {
    status: 204,
    headers,
  });
}
