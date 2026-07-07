"use client";
import { useState, useEffect } from "react";
import { AltPlace, GetawayPlan } from "@/lib/types";
import { Chibi } from "./Chibi";
import { Memories } from "./Memories";
import { Block, resolveShown } from "./PlanView";

function fmt(min: number) {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  const ap = h < 12 ? "AM" : "PM"; const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${m.toString().padStart(2, "0")} ${ap}`;
}

export function GetawayView({ plan, onRestart, onItineraryChange }: { plan: GetawayPlan; onRestart: () => void; onItineraryChange?: (lines: string[]) => void }) {
  // Keyed by "<dayIndex>-<blockIndex>" since blocks are nested under days.
  const [swaps, setSwaps] = useState<Record<string, number>>({});
  const cycle = (key: string, alts?: AltPlace[]) => {
    if (!alts?.length) return;
    setSwaps((s) => ({ ...s, [key]: ((s[key] ?? 0) + 1) % (alts.length + 1) }));
  };

  // Reports the currently-displayed itinerary (swaps applied) up to the page,
  // so the chat widget always knows what's actually on screen right now.
  useEffect(() => {
    if (!onItineraryChange) return;
    const lines = plan.days.flatMap((day, di) =>
      day.blocks
        .map((b, bi) => ({ b, bi }))
        .filter(({ b }) => b.kind !== "buffer")
        .map(({ b, bi }) => {
          const shown = resolveShown(b, swaps[`${di}-${bi}`] ?? 0);
          return `${day.label}, ${fmt(b.startMin)}: ${shown.title}${shown.area ? ` (${shown.area})` : ""} — ₹${shown.cost}`;
        })
    );
    onItineraryChange(lines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, swaps]);

  return (
    <div>
      <div className="text-center">
        <Chibi mood="happy" />
        <h1 className="mt-4 font-display text-4xl font-semibold hero-text">{plan.destination}</h1>
        <p className="mt-1 text-sm text-white/50">{plan.region} · {plan.nights === 0 ? "day trip" : `${plan.nights}-night escape`}</p>
        <p className="mt-3 text-white/70">{plan.summary}</p>
        <p className="mt-2 text-xs text-white/45">{plan.driveNote}</p>
        <p className="mt-1 text-xs text-white/40">Best months: {plan.bestMonths}</p>
      </div>

      {plan.flags.length > 0 && (
        <div className="mt-6 space-y-2">
          {plan.flags.map((f, i) => (
            <div key={i} className="flex gap-2.5 rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white/80">
              <span className="shrink-0">{f.icon}</span><span>{f.text}</span>
            </div>
          ))}
        </div>
      )}

      {plan.outfit && (
        <div className="mt-3 rounded-xl border border-glow/30 bg-glow/5 px-4 py-3">
          <p className="text-xs font-medium text-glow">👗 What to pack / wear</p>
          <p className="mt-1 text-sm text-white/80">{plan.outfit}</p>
        </div>
      )}

      {plan.stays && plan.stays.length > 0 && (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <p className="text-xs font-medium text-glow">🏨 Where to stay</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {plan.stays.slice(0, 5).map((s, i) => (
              <a key={i} href={s.mapsUrl} target="_blank" rel="noreferrer"
                className="rounded-lg bg-white/8 px-3 py-1.5 text-xs hover:bg-white/15">{s.name}</a>
            ))}
          </div>
        </div>
      )}

      {plan.events && plan.events.length > 0 && (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <p className="text-xs font-medium text-glow">🎉 Happening around then</p>
          <div className="mt-2 space-y-2">
            {plan.events.map((e, i) => (
              <a key={i} href={e.link || "#"} target="_blank" rel="noreferrer" className="block rounded-lg bg-white/5 p-2 hover:bg-white/10">
                <p className="text-sm font-medium text-white/85 leading-snug">{e.title}</p>
                <p className="text-xs text-white/45 truncate">{[e.when, e.venue].filter(Boolean).join(" · ")}</p>
              </a>
            ))}
          </div>
        </div>
      )}

      {plan.days.map((day, di) => (
        <div key={di} className="mt-8">
          <div className="mb-3">
            <h2 className="text-xl font-bold text-glow">{day.label}</h2>
            {day.subtitle && <p className="text-sm text-white/50">{day.subtitle}</p>}
          </div>
          <div className="relative pl-6">
            <div className="timeline-line absolute left-1.5 top-2 bottom-2 w-0.5 rounded-full" />
            {day.blocks.map((b, bi) => (
              b.kind === "buffer" ? (
                <div key={bi} className="relative mb-2 flex items-center gap-2 text-xs text-white/45">
                  <div className="absolute -left-[16px] top-2 h-2 w-2 rounded-full bg-white/30" />
                  <span>🚗 {fmt(b.startMin)} — {b.title}. {b.why}</span>
                </div>
              ) : (() => {
                const key = `${di}-${bi}`;
                const idx = swaps[key] ?? 0;
                return (
                  <Block key={bi} b={b} i={bi} shown={resolveShown(b, idx)} swapped={idx > 0}
                    onSwap={() => cycle(key, b.alternatives)} />
                );
              })()
            ))}
          </div>
        </div>
      ))}

      <div className="mt-10">
        <Memories title="a weekend worth remembering" />
      </div>

      <button onClick={onRestart} className="mt-6 w-full rounded-xl border border-white/15 py-3 text-white/70 hover:text-white hover:border-white/30">
        Plan something else
      </button>
    </div>
  );
}
