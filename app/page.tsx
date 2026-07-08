"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { buildPlan } from "@/lib/engine";
import { Answers, Plan, Place, GetawayPlan } from "@/lib/types";
import { Chibi } from "@/components/Chibi";
import { PlanView } from "@/components/PlanView";
import { GetawayView } from "@/components/GetawayView";
import { Memories } from "@/components/Memories";
import { ChatWidget } from "@/components/ChatWidget";
import { PROFILE, randomNickname } from "@/lib/profile";
import { AREA_OPTIONS, resolveZone } from "@/lib/areas";

const MOODS = ["Birthday", "Anniversary", "Romantic", "Date night", "Chill", "Celebrate", "Adventure", "Group outing", "Proposal", "Reunion", "Just because"];
const PERSONALITY = ["Queen", "Adventure", "Peaceful", "Foodie", "Shopper", "Spiritual", "Playful", "Culture", "Nature", "Artsy", "Nightlife", "Cozy", "Luxe", "Romantic"];
const FOODS = ["Lebanese", "Arabic", "Chinese", "Italian", "Sizzler", "Dessert", "Ice cream", "Brunch", "Indian", "Mediterranean", "Continental", "Asian", "Thai", "Japanese", "Seafood", "Street food", "Healthy", "Cafe", "Pizza", "Coffee"];
const ACTIVITIES = ["Watch a movie", "Spa or massage", "Long drive", "Beach time", "Live music", "Stand up comedy", "Art gallery", "Boat ride", "Arcade or gaming", "Workshop", "Sunset point", "Bookstore café", "Picnic"];
const BUDGETS = [0, 1000, 2000, 5000, 10000, 20000];
const BUDGET_LABELS: Record<number, string> = { 0: "Free 🌊" };
// "Free 🌊" maps to ₹400 in the engine — just enough for 1-2 street food stops, nothing else.
const BUDGET_ENGINE_VALUE: Record<number, number> = { 0: 400 };
const STARTS = [["6 AM", 360], ["8 AM", 480], ["10 AM", 600], ["12 PM", 720], ["2 PM", 840], ["4 PM", 960], ["6 PM", 1080], ["8 PM", 1200]] as const;
const ENDS = [["10 AM", 600], ["12 PM", 720], ["2 PM", 840], ["4 PM", 960], ["6 PM", 1080], ["8 PM", 1200], ["10 PM", 1320], ["Midnight", 1440]] as const;

const GETAWAYS = [
  { id: "lonavala",      name: "Lonavala" },
  { id: "alibaug",       name: "Alibaug" },
  { id: "karjat",        name: "Karjat" },
  { id: "mulshi",        name: "Mulshi" },
  { id: "malshej",       name: "Malshej Ghat" },
  { id: "bhandardara",   name: "Bhandardara" },
  { id: "nashik",        name: "Nashik" },
  { id: "mahabaleshwar", name: "Mahabaleshwar" },
  { id: "palghar",       name: "Palghar" },
  { id: "jawhar",        name: "Jawhar" },
  { id: "goa",           name: "Goa" },
];
const GETAWAY_VIBES = ["Trekking & hikes", "Water spots", "Scenic photography", "Relaxed resort", "History & culture", "Wildlife & nature", "Camping & bonfire", "Wine & food"];
const NIGHTS = [["Day trip", 0], ["1 night", 1], ["2 nights", 2]] as const;

type Step = "intro" | "mood" | "personality" | "foods" | "activities" | "areas" | "budget" | "time" | "plan" | "getaway-pick" | "getaway-plan";
const ORDER: Step[] = ["intro", "mood", "personality", "foods", "activities", "areas", "budget", "time", "plan"];

const HER_NAME = PROFILE.name;

export default function Page() {
  const [step, setStep] = useState<Step>("intro");
  const [mood, setMood] = useState<string[]>([]);
  const [personality, setPersonality] = useState<string[]>([]);
  const [foods, setFoods] = useState<string[]>([]);
  const [activities, setActivities] = useState<string[]>([]);
  const [areas, setAreas] = useState<string[]>([]); // area labels, e.g. "Bandra"
  const [budget, setBudget] = useState(0);
  const [startMin, setStartMin] = useState(0);
  const [endMin, setEndMin] = useState(0);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState(false);
  const [lastAns, setLastAns] = useState<Answers | null>(null);
  const [dest, setDest] = useState("");
  const [nights, setNights] = useState(1);
  const [getaway, setGetaway] = useState<GetawayPlan | null>(null);
  const [itineraryLines, setItineraryLines] = useState<string[]>([]);
  const [getawayVibes, setGetawayVibes] = useState<string[]>([]);
  const [hotelBooked, setHotelBooked] = useState<"" | "booked" | "need-suggestions">("");
  const [customStops, setCustomStops] = useState<string[]>([]);
  const [stopInput, setStopInput] = useState("");
  const [outingDate, setOutingDate] = useState(PROFILE.birthday); // "YYYY-MM-DD"
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

  function addStop() {
    const v = stopInput.trim();
    if (!v || customStops.includes(v)) return;
    setCustomStops([...customStops, v]);
    setStopInput("");
  }

  async function generate() {
    const d = new Date(outingDate + "T00:00:00");
    const ans: Answers = {
      who: HER_NAME,
      mood: (mood.length ? mood[0] : "Birthday").toLowerCase(),
      moodList: mood.map((m) => m.toLowerCase()),
      personality: personality.map((p) => p.toLowerCase()),
      foods: foods.map((f) =>
        f === "Ice cream" ? "icecream" : f === "Street food" ? "street" : f.toLowerCase()
      ),
      mustInclude: activities,
      areas: areas.length
        ? Array.from(new Set(areas.map(resolveZone).filter((z): z is string => Boolean(z))))
        : undefined,
      // Raw typed/picked labels (e.g. "Powai"), so the engine can narrow within a zone to
      // the actual named locality instead of any place sharing that zone's broad code.
      areaLabels: areas.length ? areas : undefined,
      budget: BUDGET_ENGINE_VALUE[budget] ?? (budget != null ? budget : 5000),
      startMin: startMin || 600,
      endMin: endMin || 1320,
      dayOfWeek: d.getDay(),
      month: d.getMonth(),
      dislikes: PROFILE.dislikes,
      outingDate,
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
        const data = await res.json();
        return Array.isArray(data.places) ? (data.places as Place[]) : [];
      } catch { return []; }
    })();

    const events = (async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(`/api/events?date=${outingDate}&q=${encodeURIComponent(eventQ)}`, { signal: ctrl.signal });
        clearTimeout(t);
        const data = await res.json();
        return Array.isArray(data.events) ? data.events : [];
      } catch { return []; }
    })();

    const moviesReq = (async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch("/api/movies", { signal: ctrl.signal });
        clearTimeout(t);
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      } catch { return []; }
    })();

    const weather = (async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(`/api/weather?date=${outingDate}&place=mumbai`, { signal: ctrl.signal });
        clearTimeout(t);
        return await res.json();
      } catch { return { available: false }; }
    })();

    const [extra, evts, moviesData, wx] = await Promise.all([discover, events, moviesReq, weather]);
    if (wx?.available) { ans.wetDay = !!wx.wet; ans.weatherSummary = wx.summary; }
    try {
      const p = buildPlan(ans, extra, moviesData);
      p.outingDate = outingDate;
      if (budget === 0) p.budget = 0;
      const OUT_ZONES = new Set(["karjat", "kolad", "gorai", "vasai"]);
      const isOutOfCity = p.blocks.some(b => OUT_ZONES.has(b.place?.zone ?? ""));
      if (evts.length && !isOutOfCity) p.events = evts;
      setLastAns(ans);
      setPlan(p);
      setStep("plan");
      upgradeNarration(p, ans);
    } finally {
      setBuilding(false);
    }
  }

  async function generateGetaway() {
    if (!dest || building) return;
    setBuilding(true);
    setBuildError(false);
    try {
      const destId = dest === "random"
        ? GETAWAYS[Math.floor(Math.random() * GETAWAYS.length)].id
        : dest;
      const res = await fetch("/api/getaway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destId, nights, monsoon: [5,6,7,8].includes(new Date(outingDate+"T00:00:00").getMonth()), date: outingDate, preferences: getawayVibes, hotelBooked, customStops }),
      });
      const d = await res.json();
      if (d.plan) { setGetaway(d.plan); setStep("getaway-plan"); }
      else setBuildError(true);
    } catch {
      setBuildError(true);
    } finally {
      setBuilding(false);
    }
  }

  async function regenerate() {
    if (!lastAns) return;
    setBuilding(true);
    // Re-fetch live places so different ones may surface; weather/events from cache.
    const discover = (async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch("/api/discover", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(lastAns), signal: ctrl.signal,
        });
        clearTimeout(t);
        const d = await res.json();
        return Array.isArray(d.places) ? (d.places as Place[]) : [];
      } catch { return []; }
    })();
    const extra = await discover;
    const moviesForRegen = plan?.blocks.find(b => b.movie)
      ? [] // already have a movie, don't re-fetch for regen
      : await fetch("/api/movies").then(r => r.json()).catch(() => []);
    try {
      const p = buildPlan(lastAns, extra, moviesForRegen);
      p.outingDate = outingDate;
      if (plan?.events?.length) p.events = plan.events;
      if (budget === 0) p.budget = 0;
      setPlan(p);
      setStep("plan");
      upgradeNarration(p, lastAns);
    } finally {
      setBuilding(false);
    }
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
          <h2 className="mt-4 font-display text-2xl font-semibold hero-text">Planning something good…</h2>
          <p className="mt-2 text-white/60">Checking the weather, pulling real places near your route, and putting them in order.</p>
        </Screen>
      </main>
    );
  }

  return (
    <>
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
              <Chibi mood={chibiMood} size={150} />
              {hello && <p className="mt-3 font-hand text-2xl text-amber-200/90">hey {hello} 👋</p>}
              <h1 className="mt-1 font-display text-4xl font-semibold leading-[1.05] hero-text">A day made for you</h1>
              <p className="mt-3 text-white/70">
                From Muscat to Mumbai, here is a day planned for real, around your mood, the weather, and the things you love.
              </p>

              <div className="mt-6">
                <Memories title="our little archive" />
              </div>

              <PrimaryBtn onClick={() => setStep("mood")}>Plan a day in Mumbai</PrimaryBtn>
              <button
                onClick={() => setStep("getaway-pick")}
                className="mt-3 w-full rounded-xl border border-white/15 py-3.5 font-semibold text-white/80 hover:text-white hover:border-white/30"
              >
                Plan a weekend away
              </button>
            </Screen>
          )}

          {step === "getaway-pick" && (
            <Screen>
              <Chibi mood="excited" />
              <Q>A weekend away. Where to?</Q>
              <Hint>Quick escapes from Mumbai. {[5,6,7,8].includes(new Date(outingDate+"T00:00:00").getMonth()) ? "It's monsoon, so the green hill spots shine right now." : ""}</Hint>
              <Chips
                options={["Surprise me", ...GETAWAYS.map((g) => g.name)]}
                selected={dest === "random" ? ["Surprise me"] : dest ? [GETAWAYS.find((g) => g.id === dest)?.name ?? ""] : []}
                onTap={(v) => {
                  if (v === "Surprise me") { setDest("random"); return; }
                  setDest(GETAWAYS.find((g) => g.name === v)?.id ?? "");
                }}
              />
              <p className="mt-4 text-sm text-white/50">How long?</p>
              <Chips options={NIGHTS.map((n) => n[0])} selected={NIGHTS.filter((n) => n[1] === nights).map((n) => n[0])} onTap={(v) => setNights(NIGHTS.find((n) => n[0] === v)![1])} />
              <p className="mt-4 text-sm text-white/50">When?</p>
              <div className="mt-2">
                <input
                  type="date"
                  value={outingDate}
                  onChange={(e) => setOutingDate(e.target.value || PROFILE.birthday)}
                  style={{ colorScheme: "dark" }}
                  className="w-full rounded-xl bg-white/5 border border-white/15 px-4 py-2.5 text-sm text-white outline-none focus:border-glow"
                />
              </div>

              <p className="mt-5 text-sm text-white/50">What kind of trip? (optional)</p>
              <Chips options={GETAWAY_VIBES} selected={getawayVibes} onTap={(v) => toggle(getawayVibes, v, setGetawayVibes)} />

              {nights > 0 && (
                <>
                  <p className="mt-5 text-sm text-white/50">Stay sorted?</p>
                  <Chips
                    options={["Yes, already booked", "Need suggestions"]}
                    selected={hotelBooked === "booked" ? ["Yes, already booked"] : hotelBooked === "need-suggestions" ? ["Need suggestions"] : []}
                    onTap={(v) => {
                      const val = v === "Yes, already booked" ? "booked" : "need-suggestions";
                      setHotelBooked(hotelBooked === val ? "" : val);
                    }}
                  />
                </>
              )}

              <p className="mt-5 text-sm text-white/50">Any must-see spot? (optional)</p>
              <div className="mt-2 flex gap-2">
                <input
                  value={stopInput}
                  onChange={(e) => setStopInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addStop(); } }}
                  placeholder="e.g. Duke's Nose, Tiger's Leap…"
                  className="flex-1 rounded-xl bg-white/5 border border-white/15 px-4 py-2.5 text-sm outline-none focus:border-glow"
                />
                <button onClick={addStop} className="rounded-xl bg-white/10 px-5 text-sm font-medium hover:bg-white/20">Add</button>
              </div>
              {customStops.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {customStops.map((s) => (
                    <button key={s} onClick={() => setCustomStops(customStops.filter(x => x !== s))} className="chip chip-on rounded-full px-4 py-2 text-sm">
                      {s} <span className="opacity-60">✕</span>
                    </button>
                  ))}
                </div>
              )}

              {buildError && <p className="mt-3 text-sm text-rose-400">Couldn't build the trip — check your connection and try again.</p>}
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
              <Nav onBack={() => setStep("foods")} onNext={() => setStep("areas")} canNext nextLabel={activities.length ? "Next" : "Skip"} />
            </Screen>
          )}

          {step === "areas" && (
            <Screen>
              <Chibi mood="neutral" />
              <Q>Stick to any particular part of Mumbai?</Q>
              <Hint>Optional. Pick one or more, or type an area (like Khar or Colaba) — the whole day will stay within those areas. Leave blank and I will pick the best fit for the mood.</Hint>
              <ChipsInput options={AREA_OPTIONS.map((a) => a[0])} selected={areas} onToggle={(v) => toggle(areas, v, setAreas)} placeholder="Type an area, e.g. Khar, Colaba…" />
              <Nav onBack={() => setStep("activities")} onNext={() => setStep("budget")} canNext nextLabel={areas.length ? "Next" : "Skip"} />
            </Screen>
          )}

          {step === "budget" && (
            <Screen>
              <Chibi mood="neutral" />
              <Q>What is the budget for the day?</Q>
              <Hint>For two people. Pick one or enter your own.</Hint>
              <Chips
                options={BUDGETS.map((b) => BUDGET_LABELS[b] ?? `₹${b.toLocaleString("en-IN")}`)}
                selected={BUDGETS.includes(budget) ? [BUDGET_LABELS[budget] ?? `₹${budget.toLocaleString("en-IN")}`] : []}
                onTap={(v) => {
                  const match = BUDGETS.find((b) => (BUDGET_LABELS[b] ?? `₹${b.toLocaleString("en-IN")}`) === v);
                  if (match !== undefined) setBudget(match);
                }}
              />
              <div className="mt-3 flex items-center gap-2">
                <span className="text-white/50">₹</span>
                <input
                  type="number"
                  min={0}
                  value={budget > 0 ? budget : ""}
                  onChange={(e) => setBudget(Number(e.target.value) || 0)}
                  placeholder="Enter a custom amount"
                  className="flex-1 rounded-xl bg-white/5 border border-white/15 px-4 py-2.5 text-sm outline-none focus:border-glow"
                />
              </div>
              <Nav onBack={() => setStep("areas")} onNext={() => setStep("time")} canNext={budget >= 0 && BUDGETS.includes(budget) || budget > 0} />
            </Screen>
          )}

          {step === "time" && (
            <Screen>
              <Chibi mood={chibiMood} />
              <Q>When is the day?</Q>
              <Hint>Pick any date and time window. The plan fills the whole slot.</Hint>
              <p className="mt-5 text-sm text-white/50">Date</p>
              <div className="mt-2">
                <input
                  type="date"
                  value={outingDate}
                  onChange={(e) => setOutingDate(e.target.value || PROFILE.birthday)}
                  style={{ colorScheme: "dark" }}
                  className="w-full rounded-xl bg-white/5 border border-white/15 px-4 py-2.5 text-sm text-white outline-none focus:border-glow"
                />
                {outingDate === PROFILE.birthday && (
                  <p className="mt-1.5 text-xs text-amber-200/60">🎂 Your birthday</p>
                )}
              </div>
              <p className="mt-5 text-sm text-white/50">Start</p>
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
            <PlanView plan={plan} name={HER_NAME} onRestart={() => setStep("intro")} onRegenerate={regenerate} onItineraryChange={setItineraryLines} />
          )}

          {step === "getaway-plan" && getaway && (
            <GetawayView plan={getaway} onRestart={() => setStep("intro")} onItineraryChange={setItineraryLines} />
          )}
        </motion.div>
      </AnimatePresence>
    </main>
    <ChatWidget plan={plan} getaway={getaway} itineraryLines={itineraryLines} />
    </>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="glass rounded-3xl p-7">{children}</div>;
}
function Q({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-6 font-display text-2xl font-semibold leading-snug">{children}</h2>;
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
