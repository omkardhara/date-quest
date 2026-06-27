// Server-only Google Maps Platform helpers. The key is read from the
// GOOGLE_MAPS_API_KEY env var and never leaves the server: photo and map bytes
// are proxied through our own /api routes so the browser never sees the key.

const KEY = process.env.GOOGLE_MAPS_API_KEY;

export interface PlaceMedia {
  found: boolean;
  name?: string;
  address?: string;
  rating?: number;
  userRatings?: number;
  lat?: number;
  lng?: number;
  photoRef?: string; // Places API (New) photo resource name
}

export function hasKey(): boolean {
  return !!KEY;
}

// Simple in-process cache so repeated plans don't burn quota.
const cache = new Map<string, PlaceMedia>();

export async function searchPlace(q: string): Promise<PlaceMedia> {
  if (!KEY) return { found: false };
  const cacheKey = q.toLowerCase().trim();
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": KEY,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.photos",
      },
      body: JSON.stringify({ textQuery: q, maxResultCount: 1, regionCode: "IN" }),
    });
    if (!res.ok) {
      const miss = { found: false };
      cache.set(cacheKey, miss);
      return miss;
    }
    const data = await res.json();
    const p = data?.places?.[0];
    if (!p) {
      const miss = { found: false };
      cache.set(cacheKey, miss);
      return miss;
    }
    const media: PlaceMedia = {
      found: true,
      name: p.displayName?.text,
      address: p.formattedAddress,
      rating: p.rating,
      userRatings: p.userRatingCount,
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      photoRef: p.photos?.[0]?.name,
    };
    cache.set(cacheKey, media);
    return media;
  } catch {
    return { found: false };
  }
}

export function photoMediaUrl(ref: string, widthPx = 800): string {
  return `https://places.googleapis.com/v1/${ref}/media?maxWidthPx=${widthPx}&key=${KEY}`;
}

export function staticMapUrl(lat: number, lng: number): string {
  const c = `${lat},${lng}`;
  return `https://maps.googleapis.com/maps/api/staticmap?center=${c}&zoom=15&size=600x240&scale=2&markers=color:0xa78bfa%7C${c}&key=${KEY}`;
}
