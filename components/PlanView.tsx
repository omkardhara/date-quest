"use client";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Plan, PlanBlock, AltPlace } from "@/lib/types";
import { Chibi } from "./Chibi";

interface Media { photo?: string | null; map?: string | null; rating?: number; userRatings?: number; address?: string; }

// Fetches a real venue photo + mini-map, via our key-safe API proxy.
function useMedia(name: string | null, area: string | null): Media | null {
  const [media, setMedia] = useState<Media | null>(null);
  useEffect(() => {
    if (!name) { setMedia(null); return; }
    let active = true;
    fetch(`/api/place-media?name=${encodeURIComponent(name)}&area=${encodeURIComponent(area ?? "")}`)
      .then((r) => r.json())
      .then((d) => { if (active) setMedia(d?.found ? d : null); })
      .catch(() => { if (active) setMedia(null); });
    return () => { active = false; };
  }, [name, area]);
  return media;
}

function fmt(min: number) {
  const h  = Math.floor(min / 60) % 24;
  const m  = min % 60;
  const ap = h < 12 ? "AM" : "PM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${m.toString().padStart(2, "0")} ${ap}`;
}

const CAT: Record<string, { label: string; cls: string }> = {
  food:       { label: "Dining",     cls: "bg-rose-400/15 text-rose-200" },
  cafe:       { label: "Café",       cls: "bg-amber-400/15 text-amber-200" },
  dessert:    { label: "Dessert",    cls: "bg-pink-400/15 text-pink-200" },
  activity:   { label: "Activity",   cls: "bg-emerald-400/15 text-emerald-200" },
  experience: { label: "Experience", cls: "bg-violet-400/15 text-violet-200" },
  shopping:   { label: "Shopping",   cls: "bg-sky-400/15 text-sky-200" },
  rest:       { label: "Break",      cls: "bg-slate-400/15 text-slate-200" },
};

// What a card actually shows, after any swap is applied.
interface Shown { title: string; area?: string; blurb: string; cost: number; mapsUrl?: string; topDishes?: string[]; mustBook?: boolean; }

export function PlanView({ plan, name, onRestart }: { plan: Plan; name: string; onRestart: () => void }) {
  // swaps[i] = 0 → original place; 1..n → that alternative
  const [swaps, setSwaps] = useState<Record<number, number>>({});

  const shownFor = (b: PlanBlock, i: number): Shown => {
    const idx = swaps[i] ?? 0;
    if (idx > 0 && b.alternatives?.[idx - 1]) {
      const a = b.alternatives[idx - 1];
      return { title: a.name, area: a.area, blurb: a.summary, cost: a.cost, mapsUrl: a.mapsUrl, topDishes: a.topDishes, mustBook: a.mustBook };
    }
    return { title: b.title, area: b.place?.area, blurb: b.why, cost: b.cost, mapsUrl: b.place?.mapsUrl, topDishes: b.place?.topDishes, mustBook: b.place?.mustBook };
  };

  const liveTotal = plan.blocks.reduce((s, b, i) => s + shownFor(b, i).cost, 0);
  const over = liveTotal > plan.budget;

  const cycle = (i: number, alts?: AltPlace[]) => {
    if (!alts?.length) return;
    setSwaps((s) => ({ ...s, [i]: ((s[i] ?? 0) + 1) % (alts.length + 1) }));
  };

  return (
    <div>
      <div className="text-center">
        <Chibi mood="happy" />
        <h1 className="mt-4 text-3xl font-bold">{plan.greeting ?? `Here is the day, ${name}`} ✨</h1>
        <p className="mt-2 text-white/60">
          {plan.blocks.length} stops ·{" "}
          <span className={over ? "text-rose-400" : "text-emerald-400"}>₹{liveTotal.toLocaleString("en-IN")}</span>{" "}
          of ₹{plan.budget.toLocaleString("en-IN")}
        </p>

        {plan.fullDayMapUrl && (
          <a href={plan.fullDayMapUrl} target="_blank" rel="noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white/8 px-4 py-2 text-sm hover:bg-white/15">
            🗺️ View full day route on Maps
          </a>
        )}
      </div>

      {/* Early heads-up flags */}
      {plan.flags && plan.flags.length > 0 && (
        <div className="mt-6 space-y-2">
          {plan.flags.map((f, i) => (
            <div key={i} className="flex gap-2.5 rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white/80">
              <span className="shrink-0">{f.icon}</span>
              <span>{f.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Outfit suggestion */}
      {plan.outfit && (
        <div className="mt-3 rounded-xl border border-glow/30 bg-glow/5 px-4 py-3">
          <p className="text-xs font-medium text-glow">👗 What to wear</p>
          <p className="mt-1 text-sm text-white/80">{plan.outfit}</p>
        </div>
      )}

      {/* Live events happening around the day */}
      {plan.events && plan.events.length > 0 && (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <p className="text-xs font-medium text-glow">🎉 Happening around her day</p>
          <p className="mt-0.5 mb-2 text-xs text-white/40">Real events on or near the date. Tap to check, and slot one in if it fits.</p>
          <div className="space-y-2">
            {plan.events.map((e, i) => (
              <a key={i} href={e.link || "#"} target="_blank" rel="noreferrer"
                className="flex gap-3 rounded-lg bg-white/5 p-2 hover:bg-white/10">
                {e.thumbnail && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={e.thumbnail} alt="" className="h-12 w-12 rounded-md object-cover shrink-0" loading="lazy" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white/85 leading-snug">{e.title}</p>
                  <p className="text-xs text-white/45 truncate">
                    {[e.when, e.venue].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Requested activities */}
      {plan.requests && plan.requests.length > 0 && (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <p className="text-xs font-medium text-white/60">You wanted to include</p>
          <p className="mt-1 text-sm text-white/80">{plan.requests.join(" · ")}</p>
          <p className="mt-1 text-xs text-white/40">Worked in where it fits. Anything not matched to a spot, slot it in yourself.</p>
        </div>
      )}

      <div className="relative mt-8 pl-6">
        <div className="timeline-line absolute left-1.5 top-2 bottom-2 w-0.5 rounded-full" />
        {plan.blocks.map((b, i) => (
          <div key={i}>
            {b.travelFromPrev && (
              <TravelSegment mins={b.travelFromPrev.mins} fromLabel={b.travelFromPrev.fromLabel} directionsUrl={b.travelFromPrev.directionsUrl} />
            )}
            <Block b={b} i={i} shown={shownFor(b, i)} swapped={(swaps[i] ?? 0) > 0} onSwap={() => cycle(i, b.alternatives)} />
          </div>
        ))}
      </div>

      {plan.signoff && <p className="mt-8 text-center text-white/70 italic">{plan.signoff}</p>}
      <button onClick={onRestart} className="mt-4 w-full rounded-xl border border-white/15 py-3 text-white/70 hover:text-white hover:border-white/30">
        Plan another day
      </button>
    </div>
  );
}

function TravelSegment({ mins, fromLabel, directionsUrl }: { mins: number; fromLabel: string; directionsUrl: string }) {
  return (
    <div className="my-1 flex items-center gap-2 pl-1 text-xs text-white/40">
      <div className="h-4 w-0.5 bg-white/15 mx-1 shrink-0" />
      <span>🚗 {mins} min from {fromLabel}</span>
      <a href={directionsUrl} target="_blank" rel="noreferrer"
        className="ml-auto rounded-md bg-white/6 px-2 py-0.5 text-white/50 hover:text-white/80 hover:bg-white/12 shrink-0">
        Directions ↗
      </a>
    </div>
  );
}

function Block({ b, i, shown, swapped, onSwap }: { b: PlanBlock; i: number; shown: Shown; swapped: boolean; onSwap: () => void }) {
  const cat = CAT[b.kind] ?? CAT.activity;
  const hasAlts = (b.alternatives?.length ?? 0) > 0;
  const noVenue = b.kind === "rest" || b.place?.id === "movie-premium" || !shown.area;
  const mediaName = noVenue ? null : shown.title.replace(/\(.*?\)/g, "").trim();
  const mediaArea = shown.area && !/multiple|pick a/i.test(shown.area) ? shown.area : "";
  const media = useMedia(mediaName, mediaArea);

  return (
    <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }} className="relative mb-2">
      <div className="absolute -left-[18px] top-1.5 h-3 w-3 rounded-full bg-glow shadow-[0_0_12px_rgba(167,139,250,.8)]" />
      <div className="glass rounded-2xl overflow-hidden">
        {media?.photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media.photo} alt={shown.title} className="h-40 w-full object-cover" loading="lazy" />
        )}
        <div className="p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-glow">{fmt(b.startMin)} – {fmt(b.endMin)}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cat.cls}`}>{cat.label}</span>
          </div>
          {shown.cost > 0 && <span className="text-xs text-white/50">₹{shown.cost.toLocaleString("en-IN")}</span>}
        </div>

        <div className="mt-1.5 flex items-start justify-between gap-2">
          <h3 className="text-lg font-semibold leading-snug">{shown.title}</h3>
          {shown.mustBook && (
            <span className="shrink-0 rounded-md bg-amber-400/15 px-2 py-1 text-[10px] font-semibold text-amber-200">📅 Book ahead</span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-white/40">
          {shown.area && <span>📍 {shown.area}</span>}
          {media?.rating && <span className="text-amber-200/80">⭐ {media.rating}{media.userRatings ? ` (${media.userRatings.toLocaleString("en-IN")})` : ""}</span>}
        </div>
        <p className="mt-2 text-sm text-white/70">{shown.blurb}</p>

        {shown.topDishes && shown.topDishes.length > 0 && (
          <p className="mt-2 text-xs text-white/60"><span className="text-white/40">Order:</span> {shown.topDishes.join(" · ")}</p>
        )}

        {b.restroom && <p className="mt-2 text-xs text-white/45">🚻 {b.restroom}</p>}
        {b.backup && <p className="mt-2 text-xs text-amber-300/80">☔ {b.backup}</p>}

        {media?.map && (
          <a href={shown.mapsUrl} target="_blank" rel="noreferrer" className="mt-3 block overflow-hidden rounded-xl border border-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={media.map} alt="map" className="h-28 w-full object-cover" loading="lazy" />
          </a>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {shown.mapsUrl && (
            <a href={shown.mapsUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-white/8 px-3 py-1.5 text-xs hover:bg-white/15">Open in Maps</a>
          )}
          {b.place?.bookingUrl && (
            <a href={b.place.bookingUrl} target="_blank" rel="noreferrer" className="btn-primary rounded-lg px-3 py-1.5 text-xs font-medium text-white">Book</a>
          )}
          {hasAlts && (
            <button onClick={onSwap} className="ml-auto rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:text-white hover:border-white/30">
              ↻ {swapped ? "Try another" : "Swap"}
            </button>
          )}
        </div>
        </div>
      </div>
    </motion.div>
  );
}
