"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { buildPlan } from "@/lib/engine";
import { Answers, Plan, Place, GetawayPlan } from "@/lib/types";
import { Chibi } from "@/components/Chibi";
import { PlanView } from "@/components/PlanView";
import { GetawayView } from "@/components/GetawayView";
import { PROFILE, randomNickname } from "@/lib/profile";

const MOODS = ["Birthday", "Anniversary", "Romantic", "Date night", "Chill", "Celebrate", "Adventure", "Group outing", "Proposal", "Reunion", "Just because"];
const PERSONALITY = ["Queen", "Adventure", "Peaceful", "Foodie", "Shopper", "Spiritual", "Playful", "Culture", "Nature", "Artsy", "Nightlife", "Cozy", "Luxe", "Romantic"];
const FOODS = ["Lebanese", "Arabic", "Chinese", "Italian", "Sizzler", "Dessert", "Ice cream", "Brunch", "Indian", "Mediterranean", "Continental", "Asian", "Thai", "Japanese", "Seafood", "Street food", "Healthy", "Cafe", "Pizza", "Coffee"];
const ACTIVITIES = ["Watch a movie", "Spa or massage", "Long drive", "Beach time", "Live music", "Art gallery", "Boat ride", "Arcade or gaming", "Workshop", "Sunset point", "Bookstore café", "Picnic"];
const BUDGETS = [2000, 5000, 10000, 20000];
const STARTS = [["6 AM", 360], ["8 AM", 480], ["10 AM", 600], ["12 PM", 720], ["2 PM", 840], ["4 PM", 960], ["6 PM", 1080], ["8 PM", 1200]] as const;
const ENDS = [["10 AM", 600], ["12 PM", 720], ["2 PM", 840], ["4 PM", 960], ["6 PM", 1080], ["8 PM", 1200], ["10 PM", 1320], ["Midnight", 1440]] as const;

const GETAWAYS = [
  { id: "lonavala", name: "Lonavala" },
  { id: "karjat", name: "Karjat" },
  { id: "mulshi", name: "Mulshi" },
  { id: "malshej", name: "Malshej Ghat" },
  { id: "palghar", name: "Palghar" },
];
const NIGHTS = [["Day trip", 0], ["1 night", 1], ["2 nights", 2]] as const;

type Step = "intro" | "mood" | "personality" | "foods" | "activities" | "budget" | "time" | "plan" | "getaway-pick" | "getaway-plan";
const ORDER: Step[] = ["intro", "mood", "personality", "foods", "activities", "budget", "time", "plan"];

const HER_NAME = PROFILE.name;
const OUTING_DATE = PROFILE.birthday; // "YYYY-MM-DD"
const OUTING_DOW = new Date(PROFILE.birthday + "T00:00:00").getDay();
const OUTING_MONTH = new Date(PROFILE.birthday + "T00:00:00").getMonth();
const IS_MONSOON = [5, 6, 7, 8].includes(OUTING_MONTH);

export default function Page() {
  const [step, setStep] = useState<Step>("intro");
  const [mood, setMood] = useState<string[]>([]);
  const [personality, setPersonality] = useState<string[]>([]);
  const [foods, setFoods] = useState<string[]>([]);
  const [activities, setActivities] = useState<string[]>([]);
  const [budget, setBudget] = useState(0);
  const [startMin, setStartMin] = useState(0);
  const [endMin, setEndMin] = useState(0);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [building, setBuilding] = useState(false);
  const [dest, setDest] = useState("");
  const [nights, setNights] = useState(1);
  const [getaway, setGetaway] = useState<GetawayPlan | null>(null);
  const [hello, setHello] = useState("");
  useEffect(() => { setHello(randomNickname()); }, [step]);

  const idx = ORDER.indexOf(step);
  const progress = Math.round((idx / (ORDER.length - 1)) * 100);

  function toggle(list: string[], v: string, set: (x: string[]) => void) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  }

  function setStart(v: number) {
    setStartMin(v);
    if (endMin && endMin <= v) setEndMin(0);
  }

  async function generate() {
    const ans: Answers = {
      who: HER_NAME,
      mood: (mood.length ? mood[0] : "Birthday").toLowerCase(),
      personality: personality.map((p) => p.toLowerCase()),
      foods: foods.map((f) => (f === "Ice cream" ? "icecream" : f.toLowerCase())),
      mustInclude: activities,
      budget: budget || 5000,
      startMin: startMin || 600,
      endMin: endMin || 1320,
      dayOfWeek: OUTING_DOW,
      month: OUTING_MONTH,
      dislikes: PROFILE.dislikes,
    };
    setBuilding(true);

    // Live places to widen the pool + live events for the day, in parallel.
    const eventQ =
      personality.includes("Culture") || personality.includes("Artsy") ? "art exhibitions and events in Mumbai" :
      personality.includes("Nightlife") || personality.includes("Playful") ? "live music and events in Mumbai" :
      "Events in Mumbai";

    const discover = (async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch("/api/discover", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ans), signal: ctrl.signal,
        });
        clearTimeout(t);
        const d = await res.json();
        return Array.isArray(d.places) ? (d.places as Place[]) : [];
      } catch { return []; }
    })();

    const events = (async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(`/api/events?date=${OUTING_DATE}&q=${encodeURIComponent(eventQ)}`, { signal: ctrl.signal });
        clearTimeout(t);
        const d = await res.json();
        return Array.isArray(d.events) ? d.events : [];
      } catch { return []; }
    })();

    const weather = (async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(`/api/weather?date=${OUTING_DATE}&place=mumbai`, { signal: ctrl.signal });
        clearTimeout(t);
        return await res.json();
      } catch { return { available: false }; }
    })();

    const [extra, evts, wx] = await Promise.all([discover, events, weather]);
    if (wx?.available) { ans.wetDay = !!wx.wet; ans.weatherSummary = wx.summary; }
    const p = buildPlan(ans, extra);
    if (evts.length) p.events = evts;
    setPlan(p);
    setBuilding(false);
    setStep("plan");
    upgradeNarration(p, ans);
  }

  async function generateGetaway() {
    if (!dest) return;
    setBuilding(true);
    try {
      const res = await fetch("/api/getaway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destId: dest, nights, monsoon: IS_MONSOON, date: OUTING_DATE }),
      });
      const d = await res.json();
      if (d.plan) { setGetaway(d.plan); setStep("getaway-plan"); }
    } catch {
      /* ignore */
    }
    setBuilding(false);
  }

  async function upgradeNarration(p: Plan, ans: Answers) {
    try {
      const blocks = p.blocks
        .filter((b) => b.place)
        .map((b) => ({ id: b.place!.id, title: b.title, summary: b.place!.summary, category: b.kind, tags: b.place!.tags ?? [] }));
      const res = await fetch("/api/narrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: ans, blocks }),
      });
      const data = await res.json();
      if (!data.ok || !data.lines) return;
      setPlan({
        ...p,
        blocks: p.blocks.map((b) => (b.place && data.lines[b.place.id] ? { ...b, why: data.lines[b.place.id] } : b)),
      });
    } catch {
      /* keep templated narration */
    }
  }

  const chibiMood =
    step === "intro" ? "wave" :
    step === "plan" ? "happy" :
    personality.includes("Adventure") || mood.includes("Adventure") ? "excited" : "neutral";

  if (building) {
    return (
      <main className="mx-auto max-w-xl px-5 py-8 min-h-screen flex items-center justify-center">
        <Screen>
          <Chibi mood="excited" size={160} />
          <h2 className="mt-4 text-2xl font-semibold">Planning the day…</h2>
          <p className="mt-2 text-white/60">Pulling real, current places near your route and putting them in order.</p>
        </Screen>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-5 py-8 min-h-screen flex flex-col">
      {ORDER.includes(step) && step !== "plan" && step !== "intro" && (
        <div className="mb-6 h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
          <motion.div className="h-full btn-primary" animate={{ width: `${progress}%` }} />
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -18 }}
          transition={{ duration: 0.28 }}
          className="flex-1"
        >
          {step === "intro" && (
            <Screen>
              <Chibi mood={chibiMood} size={180} />
              {hello && <p className="mt-4 text-glow font-medium">Hey {hello} 👋</p>}
              <h1 className="mt-2 text-3xl font-bold tracking-tight">A quest for your perfect day</h1>
              <p className="mt-3 text-white/70">
                Tell me a few quick things and I will plan it for real. Real places, real timings, made for your mood.
              </p>
              <PrimaryBtn onClick={() => setStep("mood")}>Plan a day in Mumbai</PrimaryBtn>
              <button
                onClick={() => setStep("getaway-pick")}
                className="mt-3 w-full rounded-xl border border-white/15 py-3.5 font-semibold text-white/80 hover:text-white hover:border-white/30"
              >
                Plan a weekend getaway
              </button>
            </Screen>
          )}

          {step === "getaway-pick" && (
            <Screen>
              <Chibi mood="excited" />
              <Q>A weekend away. Where to?</Q>
              <Hint>Quick escapes from Mumbai. {IS_MONSOON ? "It's monsoon, so the green hill spots shine right now." : ""}</Hint>
              <Chips options={GETAWAYS.map((g) => g.name)} selected={dest ? [GETAWAYS.find((g) => g.id === dest)!.name] : []} onTap={(v) => setDest(GETAWAYS.find((g) => g.name === v)!.id)} />
              <p className="mt-4 text-sm text-white/50">How long?</p>
              <Chips options={NIGHTS.map((n) => n[0])} selected={NIGHTS.filter((n) => n[1] === nights).map((n) => n[0])} onTap={(v) => setNights(NIGHTS.find((n) => n[0] === v)![1])} />
              <Nav onBack={() => setStep("intro")} onNext={generateGetaway} canNext={!!dest} nextLabel="Plan the trip" />
            </Screen>
          )}

          {step === "mood" && (
            <Screen>
              <Chibi mood={chibiMood} />
              <Q>What is the occasion or mood?</Q>
              <Hint>Pick as many as fit, or add your own.</Hint>
              <ChipsInput options={MOODS} selected={mood} onToggle={(v) => toggle(mood, v, setMood)} placeholder="Add another mood…" />
              <Nav onBack={() => setStep("intro")} onNext={() => setStep("personality")} canNext={mood.length > 0} />
            </Screen>
          )}

          {step === "personality" && (
            <Screen>
              <Chibi mood={chibiMood} />
              <Q>Pick the energy. Choose as many as fit.</Q>
              <Hint>Or type a vibe that is not here.</Hint>
              <ChipsInput options={PERSONALITY} selected={personality} onToggle={(v) => toggle(personality, v, setPersonality)} placeholder="Add a vibe…" />
              <Nav onBack={() => setStep("mood")} onNext={() => setStep("foods")} canNext={personality.length > 0} />
            </Screen>
          )}

          {step === "foods" && (
            <Screen>
              <Chibi mood="excited" />
              <Q>What are we eating?</Q>
              <Hint>Pick favourites or type a cuisine.</Hint>
              <ChipsInput options={FOODS} selected={foods} onToggle={(v) => toggle(foods, v, setFoods)} placeholder="Add a cuisine…" />
              <Nav onBack={() => setStep("personality")} onNext={() => setStep("activities")} canNext={foods.length > 0} />
            </Screen>
          )}

          {step === "activities" && (
            <Screen>
              <Chibi mood={chibiMood} />
              <Q>Anything you already want to do?</Q>
              <Hint>Optional. Pick or type specific things and I will build the day around them.</Hint>
              <ChipsInput options={ACTIVITIES} selected={activities} onToggle={(v) => toggle(activities, v, setActivities)} placeholder="e.g. Ferris wheel, pottery class…" />
              <Nav onBack={() => setStep("foods")} onNext={() => setStep("budget")} canNext nextLabel={activities.length ? "Next" : "Skip"} />
            </Screen>
          )}

          {step === "budget" && (
            <Screen>
              <Chibi mood="neutral" />
              <Q>What is the budget for the day?</Q>
              <Hint>For two people. Pick one or enter your own.</Hint>
              <Chips
                options={BUDGETS.map((b) => `₹${b.toLocaleString("en-IN")}`)}
                selected={budget && BUDGETS.includes(budget) ? [`₹${budget.toLocaleString("en-IN")}`] : []}
                onTap={(v) => setBudget(Number(v.replace(/[₹,]/g, "")))}
              />
              <div className="mt-3 flex items-center gap-2">
                <span className="text-white/50">₹</span>
                <input
                  type="number"
                  min={0}
                  value={budget || ""}
                  onChange={(e) => setBudget(Number(e.target.value) || 0)}
                  placeholder="Enter a custom amount"
                  className="flex-1 rounded-xl bg-white/5 border border-white/15 px-4 py-2.5 text-sm outline-none focus:border-glow"
                />
              </div>
              <Nav onBack={() => setStep("activities")} onNext={() => setStep("time")} canNext={!!budget} />
            </Screen>
          )}

          {step === "time" && (
            <Screen>
              <Chibi mood={chibiMood} />
              <Q>How long is the day?</Q>
              <Hint>Start and end any time. The plan fills whatever window you pick.</Hint>
              <p className="mt-3 text-sm text-white/50">Start</p>
              <Chips
                options={STARTS.map((s) => s[0])}
                selected={STARTS.filter((s) => s[1] === startMin).map((s) => s[0])}
                onTap={(v) => setStart(STARTS.find((s) => s[0] === v)![1])}
              />
              <p className="mt-4 text-sm text-white/50">End</p>
              <Chips
                options={ENDS.filter((e) => !startMin || e[1] > startMin).map((e) => e[0])}
                selected={ENDS.filter((e) => e[1] === endMin).map((e) => e[0])}
                onTap={(v) => setEndMin(ENDS.find((e) => e[0] === v)![1])}
              />
              <Nav onBack={() => setStep("budget")} onNext={generate} canNext={!!startMin && !!endMin} nextLabel="Plan my day" />
            </Screen>
          )}

          {step === "plan" && plan && (
            <PlanView plan={plan} name={HER_NAME} onRestart={() => setStep("intro")} />
          )}

          {step === "getaway-plan" && getaway && (
            <GetawayView plan={getaway} onRestart={() => setStep("intro")} />
          )}
        </motion.div>
      </AnimatePresence>
    </main>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="glass rounded-3xl p-7">{children}</div>;
}
function Q({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-6 text-2xl font-semibold leading-snug">{children}</h2>;
}
function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-sm text-white/50">{children}</p>;
}
function PrimaryBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="btn-primary mt-7 w-full rounded-xl py-3.5 font-semibold text-white">
      {children}
    </button>
  );
}
function Chips({ options, selected, onTap }: { options: string[]; selected: string[]; onTap: (v: string) => void }) {
  const customs = selected.filter((s) => !options.includes(s));
  return (
    <div className="mt-5 flex flex-wrap gap-2.5">
      {options.map((o) => (
        <button key={o} onClick={() => onTap(o)} className={`chip rounded-full px-4 py-2 text-sm ${selected.includes(o) ? "chip-on" : "text-white/85"}`}>
          {o}
        </button>
      ))}
      {customs.map((c) => (
        <button key={c} onClick={() => onTap(c)} className="chip chip-on rounded-full px-4 py-2 text-sm">
          {c} <span className="opacity-60">✕</span>
        </button>
      ))}
    </div>
  );
}
function ChipsInput({ options, selected, onToggle, placeholder }: { options: string[]; selected: string[]; onToggle: (v: string) => void; placeholder: string }) {
  const [val, setVal] = useState("");
  const add = () => {
    const v = val.trim();
    if (!v) return;
    if (!selected.some((s) => s.toLowerCase() === v.toLowerCase())) onToggle(v);
    setVal("");
  };
  return (
    <div>
      <Chips options={options} selected={selected} onTap={onToggle} />
      <div className="mt-3 flex gap-2">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={placeholder}
          className="flex-1 rounded-xl bg-white/5 border border-white/15 px-4 py-2.5 text-sm outline-none focus:border-glow"
        />
        <button onClick={add} className="rounded-xl bg-white/10 px-5 text-sm font-medium hover:bg-white/20">Add</button>
      </div>
    </div>
  );
}
function Nav({ onBack, onNext, canNext, nextLabel = "Next" }: { onBack: () => void; onNext: () => void; canNext: boolean; nextLabel?: string }) {
  return (
    <div className="mt-8 flex items-center justify-between">
      <button onClick={onBack} className="text-white/50 hover:text-white/80 text-sm">Back</button>
      <button onClick={onNext} disabled={!canNext} className="btn-primary rounded-xl px-6 py-3 font-semibold text-white disabled:opacity-40 disabled:shadow-none">
        {nextLabel}
      </button>
    </div>
  );
}
