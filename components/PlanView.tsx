"use client";
import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plan, PlanBlock, AltPlace, MovieInfo } from "@/lib/types";
import { Chibi } from "./Chibi";
import { Memories } from "./Memories";

interface Media { photo?: string | null; map?: string | null; rating?: number; userRatings?: number; address?: string; }

function buildDirectionsUrl(fromName: string, fromArea: string, toName: string, toArea: string): string {
  const origin = encodeURIComponent(`${fromName}, ${fromArea}, Mumbai`);
  const dest   = encodeURIComponent(`${toName}, ${toArea}, Mumbai`);
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=driving`;
}

// Mirrors engine.ts TRAVEL_BASE for client-side swap recalculation.
const TRAVEL_BASE_CLIENT: Record<string, number> = {
  "andheri_w-bandra":   20, "andheri_w-borivali": 35, "andheri_w-central":  40,
  "andheri_w-home":     20, "andheri_w-south":    55, "andheri_w-thane":    55,
  "bandra-central":     30, "bandra-home":         35, "bandra-south":       35,
  "bandra-thane":       65, "borivali-bandra":     50, "borivali-central":   55,
  "borivali-home":      60, "central-home":        40, "central-south":      20,
  "central-thane":      50, "home-south":          60, "home-thane":         45,
  "gorai-home":         75,
};
// Only called when a block is swapped — applies rush-hour multiplier like the engine.
function approxTravelMins(fromZone: string, toZone: string, atMin?: number): number {
  if (fromZone === toZone) return 10;
  const key = [fromZone, toZone].sort().join("-");
  const base = TRAVEL_BASE_CLIENT[key] ?? 45;
  const m = atMin ?? 0;
  const mult = (m >= 1020 && m <= 1200) ? 1.4 : (m >= 720 && m <= 900) ? 1.2 : 1;
  return Math.round(base * mult);
}

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
export interface Shown { title: string; area?: string; zone?: string; blurb: string; cost: number; mapsUrl?: string; topDishes?: string[]; mustBook?: boolean; }

// Non-swapped view of a block (used by the getaway view before swapping existed).
export function shownFromBlock(b: PlanBlock): Shown {
  return { title: b.title, area: b.place?.area, zone: b.place?.zone, blurb: b.why, cost: b.cost, mapsUrl: b.place?.mapsUrl, topDishes: b.place?.topDishes, mustBook: b.place?.mustBook };
}

// altIdx: 0 = original place, 1..n = that alternative. Shared by PlanView and
// GetawayView so both apply a swap the same way.
export function resolveShown(b: PlanBlock, altIdx: number): Shown {
  if (altIdx > 0 && b.alternatives?.[altIdx - 1]) {
    const a = b.alternatives[altIdx - 1];
    return { title: a.name, area: a.area, zone: a.zone, blurb: a.summary, cost: a.cost, mapsUrl: a.mapsUrl, topDishes: a.topDishes, mustBook: a.mustBook };
  }
  return { title: b.title, area: b.place?.area, zone: b.place?.zone, blurb: b.why, cost: b.cost, mapsUrl: b.place?.mapsUrl, topDishes: b.place?.topDishes, mustBook: b.place?.mustBook };
}

export function PlanView({ plan, name, onRestart, onRegenerate, onItineraryChange }: { plan: Plan; name: string; onRestart: () => void; onRegenerate?: () => void; onItineraryChange?: (lines: string[]) => void }) {
  // swaps[i] = 0 → original place; 1..n → that alternative
  const [swaps, setSwaps] = useState<Record<number, number>>({});

  const shownFor = (b: PlanBlock, i: number): Shown => resolveShown(b, swaps[i] ?? 0);

  // Reports the currently-displayed itinerary (swaps applied) up to the page,
  // so the chat widget always knows what's actually on screen right now.
  useEffect(() => {
    if (!onItineraryChange) return;
    const lines = plan.blocks.map((b, i) => {
      const shown = shownFor(b, i);
      return `${fmt(b.startMin)}–${fmt(b.endMin)}: ${shown.title}${shown.area ? ` (${shown.area})` : ""} — ₹${shown.cost}`;
    });
    onItineraryChange(lines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, swaps]);

  const liveTotal = plan.blocks.reduce((s, b, i) => s + shownFor(b, i).cost, 0);
  const isFreeDay = plan.budget === 0;
  const over = !isFreeDay && liveTotal > plan.budget;
  const budgetFreed = !isFreeDay ? plan.budget - liveTotal : 0;
  const hasSwapped = Object.values(swaps).some(v => v > 0);

  // Pick the bonus suggestion whose cost fits within the freed budget.
  const bonusToShow = useMemo(() => {
    if (!plan.bonusSuggestions?.length || budgetFreed < 400) return null;
    return plan.bonusSuggestions.find(s => s.cost <= budgetFreed) ?? null;
  }, [plan.bonusSuggestions, budgetFreed]);
  const isBirthday = (plan.greeting ?? "").toLowerCase().includes("happy birthday");

  const cycle = (i: number, alts?: AltPlace[]) => {
    if (!alts?.length) return;
    setSwaps((s) => ({ ...s, [i]: ((s[i] ?? 0) + 1) % (alts.length + 1) }));
  };

  return (
    <div>
      <div className="text-center">
        <Chibi mood="happy" />
        <h1 className={`mt-4 font-display text-3xl font-semibold leading-tight ${isBirthday ? "birthday-shimmer" : "hero-text"}`}>
          {plan.greeting ?? `Here is the day, ${name}`}
        </h1>
        <p className="mt-2 text-white/60">
          {plan.blocks.length} stops ·{" "}
          <span className={over ? "text-rose-400" : "text-emerald-400"}>
            {isFreeDay && liveTotal === 0 ? "Free 🌊" : `₹${liveTotal.toLocaleString("en-IN")}`}
          </span>
          {isFreeDay ? (liveTotal > 0 ? " (street food only)" : "") : ` of ₹${plan.budget.toLocaleString("en-IN")}`}
        </p>
        {plan.blocks.length > 0 && (() => {
          const s = plan.blocks[0].startMin;
          const e = plan.blocks[plan.blocks.length - 1].endMin;
          const dateLabel = plan.outingDate
            ? new Date(plan.outingDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
            : "";
          return <p className="mt-0.5 text-xs text-amber-200/50">{dateLabel && `${dateLabel} · `}{fmt(s)} – {fmt(e)}</p>;
        })()}

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
          <p className="text-xs font-medium text-glow">🎉 Happening around your day</p>
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

      {plan.blocks.length === 0 && (
        <p className="mt-10 text-center text-sm text-white/50">
          The window is too short or the budget too tight for this combination.<br />Try a wider time range or bump the budget slightly.
        </p>
      )}

      <div className="relative mt-8 pl-6">
        <div className="timeline-line absolute left-1.5 top-2 bottom-2 w-0.5 rounded-full" />
        {plan.blocks.map((b, i) => {
          const currentShown = shownFor(b, i);
          const prevShown = i > 0 ? shownFor(plan.blocks[i - 1], i - 1) : null;
          const fromLabel = prevShown ? prevShown.title : b.travelFromPrev?.fromLabel ?? "";
          const fromArea  = prevShown?.area ?? "";
          const dirUrl    = b.travelFromPrev
            ? buildDirectionsUrl(fromLabel, fromArea, currentShown.title, currentShown.area ?? "")
            : "";
          // Use engine's rush-hour-aware value unless a swap changed the zones.
          const travelMinsVal = (() => {
            if (!b.travelFromPrev) return 0;
            const isSwapped = (swaps[i] ?? 0) > 0 || (swaps[i - 1] ?? 0) > 0;
            if (isSwapped) {
              const prevZone = prevShown?.zone;
              const curZone  = currentShown?.zone;
              if (prevZone && curZone) return approxTravelMins(prevZone, curZone, b.startMin);
            }
            return b.travelFromPrev.mins;
          })();
          return (
            <div key={i}>
              {b.travelFromPrev && (
                <TravelSegment mins={travelMinsVal} fromLabel={fromLabel} directionsUrl={dirUrl} />
              )}
              <Block b={b} i={i} shown={currentShown} swapped={(swaps[i] ?? 0) > 0} onSwap={() => cycle(i, b.alternatives)} />
            </div>
          );
        })}
        {/* Return home */}
        {plan.returnTravel && (() => {
          const lastBlock = plan.blocks[plan.blocks.length - 1];
          const lastShown = lastBlock ? shownFor(lastBlock, plan.blocks.length - 1) : null;
          const homeLabel = lastShown ? lastShown.title : plan.returnTravel.fromLabel;
          const homeArea  = lastShown?.area ?? "";
          const homeUrl   = lastShown
            ? buildDirectionsUrl(lastShown.title, homeArea, "Home", "Marol, Andheri East")
            : plan.returnTravel.directionsUrl;
          const lastIdx   = plan.blocks.length - 1;
          const lastSwapped = (swaps[lastIdx] ?? 0) > 0;
          const homeMins  = (lastSwapped && lastShown?.zone)
            ? approxTravelMins(lastShown.zone, "home", lastBlock?.endMin)
            : plan.returnTravel.mins;
          return (
            <>
              <TravelSegment mins={homeMins} fromLabel={homeLabel} directionsUrl={homeUrl} />
              <div className="mb-2 flex items-center gap-2 pl-1 text-sm text-white/50">
                <div className="absolute -left-[18px] h-3 w-3 rounded-full border-2 border-white/30" />
                🏠 Home · Marol, Andheri East
              </div>
            </>
          );
        })()}
      </div>

      {/* Budget gap banner — appears when a swap saves meaningful budget */}
      <AnimatePresence>
        {hasSwapped && bonusToShow && (
          <motion.div
            key="bonus"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="mt-6 rounded-2xl border border-emerald-400/25 bg-emerald-500/8 p-4"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-emerald-400 text-sm font-semibold">
                ✦ ₹{budgetFreed.toLocaleString("en-IN")} freed up
              </span>
              <span className="text-xs text-white/40">— want to squeeze in one more?</span>
            </div>
            <a
              href={bonusToShow.mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-start gap-3 rounded-xl bg-white/5 hover:bg-white/10 p-3 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white/90 leading-snug">{bonusToShow.name}</p>
                {bonusToShow.area && <p className="text-xs text-white/45 mt-0.5">📍 {bonusToShow.area}</p>}
                <p className="text-xs text-white/60 mt-1 line-clamp-2">{bonusToShow.summary}</p>
              </div>
              <div className="shrink-0 text-right">
                <span className="text-xs text-emerald-300/80 font-medium">
                  {bonusToShow.cost === 0 ? "Free" : `₹${bonusToShow.cost.toLocaleString("en-IN")}`}
                </span>
                <p className="text-[10px] text-white/30 mt-0.5">↗ Maps</p>
              </div>
            </a>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-10">
        <Memories title="and today, we add one more" />
      </div>

      {plan.signoff && <p className="mt-6 text-center font-hand text-2xl text-amber-200/90">{plan.signoff}</p>}
      <div className="mt-5 flex gap-3">
        {onRegenerate && (
          <button onClick={onRegenerate} className="flex-1 rounded-xl border border-glow/30 py-3 text-glow hover:bg-glow/10">
            ↺ Different picks
          </button>
        )}
        <button onClick={onRestart} className={`rounded-xl border border-white/15 py-3 text-white/70 hover:text-white hover:border-white/30 ${onRegenerate ? "flex-1" : "w-full"}`}>
          Plan another day
        </button>
      </div>
    </div>
  );
}

function MovieChip({ movie }: { movie: MovieInfo }) {
  return (
    <div className="mt-3 flex items-center gap-3 rounded-xl bg-violet-500/10 border border-violet-400/20 px-3 py-2.5">
      {movie.poster && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={movie.poster} alt={movie.title} className="h-16 w-11 rounded-md object-cover shrink-0" loading="lazy" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-violet-300/70">🎬 Now Playing</p>
        <p className="text-sm font-semibold text-white/90 leading-snug">{movie.title}</p>
        {(movie.genre || movie.language) && (
          <p className="mt-0.5 text-[10px] text-white/45">
            {[movie.genre, movie.language].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
    </div>
  );
}

function TravelSegment({ mins, fromLabel, directionsUrl }: { mins: number; fromLabel: string; directionsUrl: string }) {
  // Shorten very long place names so they don't overflow on mobile.
  const label = fromLabel.length > 28 ? fromLabel.slice(0, 26) + "…" : fromLabel;
  return (
    <div className="my-1 flex items-center gap-2 pl-1 text-xs text-white/40">
      <div className="h-4 w-0.5 bg-white/15 mx-1 shrink-0" />
      <span className="truncate min-w-0">🚗 {mins} min from {label}</span>
      <a href={directionsUrl} target="_blank" rel="noreferrer"
        className="ml-auto rounded-md bg-white/6 px-2 py-0.5 text-white/50 hover:text-white/80 hover:bg-white/12 shrink-0">
        Directions ↗
      </a>
    </div>
  );
}

export function Block({ b, i, shown, swapped, onSwap }: { b: PlanBlock; i: number; shown: Shown; swapped: boolean; onSwap: () => void }) {
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

        {b.movie
          ? <MovieChip movie={b.movie} />
          : b.place?.tags?.includes("cinema") && (
            <a href="https://in.bookmyshow.com/explore/movies-mumbai" target="_blank" rel="noreferrer"
              className="mt-3 flex items-center gap-2 rounded-xl bg-violet-500/10 border border-violet-400/20 px-3 py-2.5 hover:bg-violet-500/15">
              <span className="text-lg leading-none">🎬</span>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-violet-300/70">Now Playing</p>
                <p className="text-xs text-white/60">Check what's showing on BookMyShow →</p>
              </div>
            </a>
          )
        }

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
          {(b.movie?.link || b.place?.bookingUrl) && (
            <a href={b.movie?.link ?? b.place?.bookingUrl} target="_blank" rel="noreferrer" className="btn-primary rounded-lg px-3 py-1.5 text-xs font-medium text-white">
              {b.movie ? "Book tickets ↗" : "Book"}
            </a>
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
