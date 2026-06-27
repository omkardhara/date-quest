import { NextRequest, NextResponse } from "next/server";
import { photoMediaUrl, hasKey } from "@/lib/google";

export const runtime = "nodejs";

// Proxies a Google Places photo so the API key stays server-side.
export async function GET(req: NextRequest) {
  if (!hasKey()) return new NextResponse(null, { status: 404 });

  const ref = req.nextUrl.searchParams.get("ref");
  if (!ref) return new NextResponse(null, { status: 400 });

  try {
    const r = await fetch(photoMediaUrl(ref, 800));
    if (!r.ok) return new NextResponse(null, { status: 502 });
    const buf = await r.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": r.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
