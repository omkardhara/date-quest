"use client";
import { motion } from "framer-motion";
import { Plan, PlanBlock } from "@/lib/types";
import { Chibi } from "./Chibi";

function fmt(min: number) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const ap = h < 12 ? "AM" : "PM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${m.toString().padStart(2, "0")} ${ap}`;
}

export function PlanView({ plan, name, onRestart }: { plan: Plan; name: string; onRestart: () => void }) {
  return (
    <div>
      <div className="text-center">
        <Chibi mood="happy" />
        <h1 className="mt-4 text-3xl font-bold">{plan.greeting ?? `Here is the day, ${name}`} ✨</h1>
        <p className="mt-2 text-white/60">
          {plan.blocks.length} stops ·{" "}
          <span className={plan.overBudget ? "text-rose-400" : "text-emerald-400"}>
            ₹{plan.totalCost.toLocaleString("en-IN")}
          </span>{" "}
          of ₹{plan.budget.toLocaleString("en-IN")}
        </p>
      </div>

      <div className="relative mt-8 pl-6">
        <div className="timeline-line absolute left-1.5 top-2 bottom-2 w-0.5 rounded-full" />
        {plan.blocks.map((b, i) => (
          <Block key={i} b={b} i={i} />
        ))}
      </div>

      {plan.signoff && (
        <p className="mt-8 text-center text-white/70 italic">{plan.signoff}</p>
      )}
      <button onClick={onRestart} className="mt-4 w-full rounded-xl border border-white/15 py-3 text-white/70 hover:text-white hover:border-white/30">
        Plan another day
      </button>
    </div>
  );
}

function Block({ b, i }: { b: PlanBlock; i: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: i * 0.08 }}
      className="relative mb-5"
    >
      <div className="absolute -left-[18px] top-1.5 h-3 w-3 rounded-full bg-glow shadow-[0_0_12px_rgba(167,139,250,.8)]" />
      <div className="glass rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-glow">{fmt(b.startMin)} – {fmt(b.endMin)}</span>
          {b.cost > 0 && <span className="text-xs text-white/50">₹{b.cost.toLocaleString("en-IN")}</span>}
        </div>
        <h3 className="mt-1.5 text-lg font-semibold">{b.title}</h3>
        <p className="mt-1 text-sm text-white/70">{b.why}</p>

        {b.transport && (
          <div className="mt-3 grid grid-cols-1 gap-1.5 text-xs text-white/55">
            <span>🚇 {b.transport.publicOption}</span>
            <span>🚗 {b.transport.privateOption}</span>
          </div>
        )}
        {b.backup && <p className="mt-2 text-xs text-amber-300/80">☔ {b.backup}</p>}

        <div className="mt-3 flex gap-2">
          {b.place?.mapsUrl && (
            <a href={b.place.mapsUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-white/8 px-3 py-1.5 text-xs hover:bg-white/15">
              Open in Maps
            </a>
          )}
          {b.place?.bookingUrl && (
            <a href={b.place.bookingUrl} target="_blank" rel="noreferrer" className="btn-primary rounded-lg px-3 py-1.5 text-xs font-medium text-white">
              Book
            </a>
          )}
        </div>
      </div>
    </motion.div>
  );
}
