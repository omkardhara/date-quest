// Live weather via Open-Meteo (free, no API key). Forecast reaches ~16 days out,
// so it covers an outing planned for the coming days; beyond that we report
// "unavailable" and the planner falls back to seasonal (monsoon) assumptions.

export const COORDS: Record<string, [number, number]> = {
  mumbai:   [19.07, 72.88],
  lonavala: [18.75, 73.41],
  karjat:   [18.91, 73.33],
  mulshi:   [18.49, 73.49],
  malshej:  [19.33, 73.77],
  palghar:  [19.69, 72.77],
};

export interface Weather {
  date: string;
  tMax?: number;
  tMin?: number;
  precipMm?: number;
  summary: string;
  wet: boolean;       // is meaningful rain expected
  available: boolean; // did we get a real forecast
}

function codeText(c?: number): string {
  if (c == null) return "Weather";
  if (c === 0) return "Clear sky";
  if (c <= 3) return "Partly cloudy";
  if (c <= 48) return "Cloudy / misty";
  if (c <= 57) return "Drizzle";
  if (c <= 67) return "Rain";
  if (c <= 77) return "Snow";
  if (c <= 82) return "Rain showers";
  if (c <= 86) return "Snow showers";
  return "Thunderstorm";
}

const RAIN_CODES = [61, 63, 65, 80, 81, 82, 95, 96, 99];
const cache = new Map<string, Weather>();

export async function getWeather(lat: number, lng: number, dateISO: string): Promise<Weather> {
  const key = `${lat},${lng},${dateISO}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const miss: Weather = { date: dateISO, summary: "", wet: false, available: false };
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&daily=precipitation_sum,temperature_2m_max,temperature_2m_min,weathercode` +
      `&timezone=Asia%2FKolkata&start_date=${dateISO}&end_date=${dateISO}`;
    const r = await fetch(url);
    if (!r.ok) { cache.set(key, miss); return miss; }
    const d = await r.json();
    const precip = d?.daily?.precipitation_sum?.[0];
    const tMax = d?.daily?.temperature_2m_max?.[0];
    const tMin = d?.daily?.temperature_2m_min?.[0];
    const code = d?.daily?.weathercode?.[0];
    if (precip == null && tMax == null) { cache.set(key, miss); return miss; }

    const wet = (precip ?? 0) >= 5 || (code != null && RAIN_CODES.includes(code));
    const tempStr = tMin != null && tMax != null ? `, ${Math.round(tMin)}–${Math.round(tMax)}°C` : "";
    const summary = `${codeText(code)}${tempStr}` +
      (precip != null ? `, ~${Math.round(precip)}mm rain` : "");
    const w: Weather = { date: dateISO, tMax, tMin, precipMm: precip, summary, wet, available: true };
    cache.set(key, w);
    return w;
  } catch {
    cache.set(key, miss);
    return miss;
  }
}
