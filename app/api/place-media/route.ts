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

// A word-prefix relation only counts as a match when the words are close enough
// in length to be spelling/plural variants (e.g. "cafe"/"caf", "restaurants"/
// "restaurant") — otherwise unrelated words that happen to share a prefix
// (e.g. "Birds" vs "Birdsong") would falsely match two different venues.
function sameWord(a: string, b: string): boolean {
  return a === b || ((a.startsWith(b) || b.startsWith(a)) && Math.abs(a.length - b.length) <= 2);
}

// Confirm the place Google returned is actually the venue we asked for.
// Uses a 3-char minimum so short names like "Ali", "Bay", "Le" still match.
// Only compares against the text before the first comma: some nearby shops
// list themselves as "Shop Name, ground floor, next to <landmark>" on Maps,
// and matching against that trailing descriptor would let a neighboring
// business's photo/rating get attached to the landmark we actually asked for.
function nameMatches(expected: string, got?: string): boolean {
  if (!got) return false;
  const e = tokens(expected);
  const g = tokens(got.split(",")[0]);
  if (!e.length) return false;
  return e.some(t => t.length >= 3 && g.some(x => x.length >= 3 && sameWord(t, x)));
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
