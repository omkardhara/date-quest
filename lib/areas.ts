// Shared area/zone picker data — used by the questionnaire UI (chip labels + free-text
// resolution) and by the engine/discovery layer (resolving a typed locality back to a zone
// so live search + locality filtering stay in sync with what the user typed).
export const AREA_OPTIONS: [string, string][] = [
  ["Bandra", "bandra"],
  ["Andheri", "andheri_w"],
  ["Powai", "andheri_w"],
  ["South Mumbai", "south"],
  ["Central Mumbai", "central"],
  ["Borivali / Aarey", "borivali"],
  ["Thane", "thane"],
  ["Navi Mumbai", "navi_mumbai"],
  ["Vasai", "vasai"],
  ["Gorai", "gorai"],
];
const AREA_ZONE: Record<string, string> = Object.fromEntries(AREA_OPTIONS);

// Locality aliases for freely-typed area names, so "Khar" or "Juhu" resolve to the right
// zone even though only the broader zone/chip names are offered as chips.
export const AREA_ALIASES: Record<string, string> = {
  bandra: "bandra", khar: "bandra", "pali hill": "bandra", "carter road": "bandra",
  bandstand: "bandra", "linking road": "bandra", "hill road": "bandra",
  andheri: "andheri_w", juhu: "andheri_w", versova: "andheri_w", powai: "andheri_w",
  "vile parle": "andheri_w", "madh island": "andheri_w", "seven bungalows": "andheri_w",
  colaba: "south", fort: "south", churchgate: "south", "nariman point": "south",
  "marine lines": "south", "marine drive": "south", "kala ghoda": "south", "malabar hill": "south",
  walkeshwar: "south", girgaum: "south", "ballard estate": "south", cst: "south",
  "mumbai central": "south", "cuffe parade": "south", "grant road": "south",
  "lower parel": "central", worli: "central", dadar: "central", byculla: "central",
  parel: "central", matunga: "central", tardeo: "central", "opera house": "central",
  bkc: "central", "bandra kurla": "central", prabhadevi: "central", mahalaxmi: "central",
  borivali: "borivali", malad: "borivali", goregaon: "borivali", aarey: "borivali",
  kandivali: "borivali",
  thane: "thane", mulund: "thane", ghatkopar: "thane",
  vasai: "vasai", virar: "vasai", nallasopara: "vasai",
  "navi mumbai": "navi_mumbai", vashi: "navi_mumbai", nerul: "navi_mumbai",
  kharghar: "navi_mumbai", belapur: "navi_mumbai", panvel: "navi_mumbai",
  karjat: "karjat", kolad: "kolad", gorai: "gorai",
};

// Resolves a chip label (exact) or a freely-typed area name (best-effort substring match) to a zone key.
export function resolveZone(label: string): string | undefined {
  if (AREA_ZONE[label]) return AREA_ZONE[label];
  const key = label.trim().toLowerCase();
  for (const [alias, zone] of Object.entries(AREA_ALIASES)) {
    if (key.includes(alias)) return zone;
  }
  return undefined;
}
