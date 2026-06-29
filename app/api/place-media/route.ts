import { NextRequest, NextResponse } from "next/server";
import { searchPlace, hasKey } from "@/lib/google";

export const runtime = "nodejs";

// Generic words that don't help confirm we found the right venue.
const STOP = new Set([
  "café", "bar", "the", "and", "diner",
  "by", "at", "of", "mumbai",
]);

function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).filter(w => !STOP.has(w));
}

// Confirm the place Google returned is actually the venue we asked for.
// Uses a 3-char minimum so short names like "Ali", "Bay", "Le" still match.
function nameMatches(expected: string, got?: string): boolean {
  if (!got) return false;
  const e = tokens(expected);
  const g = tokens(got);
  if (!e.length) return false;
  return e.some(t => t.length >= 3 && g.some(x => x.length >= 3 && (x.startsWith(t) || t.startsWith(x))));
}

// Returns rating/address + proxied photo & map URLs, only when we're confident
// the result is the real venue (so we never show the wrong place's photo).
export async function GET(req: NextRequest) {
  if (!hasKey()) return NextResponse.json({ found: false, noKey: true });

  const sp = req.nextUrl.searchParams;
  const name = (sp.get("name") ?? sp.get("q") ?? "").trim();
  const area = (sp.get("area") ?? "").trim();
  if (!name) return NextResponse.json({ found: false });

  // Area already carries the locality (e.g. "Bandra West" or "Lonavala"); only
  // fall back to "Mumbai" when we have no area at all.
  const q = (area ? `${name} ${area}` : `${name} Mumbai`).replace(/\s+/g, " ").trim();
  const m = await searchPlace(q);
  if (!m.found || !nameMatches(name, m.name)) return NextResponse.json({ found: false });

  const photo = m.photoRef ? `/api/place-photo?ref=${encodeURIComponent(m.photoRef)}` : null;
  const map = m.lat != null && m.lng != null ? `/api/static-map?lat=${m.lat}&lng=${m.lng}` : null;

  return NextResponse.json(
    { found: true, name: m.name, address: m.address, rating: m.rating, userRatings: m.userRatings, photo, map },
    { headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
