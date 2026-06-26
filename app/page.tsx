"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { buildPlan } from "@/lib/engine";
import { Answers, Plan } from "@/lib/types";
import { Chibi } from "@/components/Chibi";
import { PlanView } from "@/components/PlanView";
import { PROFILE, randomNickname } from "@/lib/profile";

const MOODS = ["Birthday", "Anniversary", "Romantic", "Chill", "Celebrate", "Adventure", "Group Outing"];
const PERSONALITY = ["Queen", "Adventure", "Peaceful", "Foodie", "Shopper", "Spiritual", "Playful", "Culture"];
const FOODS = ["Lebanese", "Arabic", "Chinese", "Italian", "Sizzler", "Dessert", "Ice cream", "Brunch", "Indian", "Mediterranean"];
const BUDGETS = [2000, 5000, 10000, 20000];
const STARTS = [["7 AM", 420], ["8 AM", 480], ["9 AM", 540], ["10 AM", 600]] as const;
const ENDS = [["6 PM", 1080], ["8 PM", 1200], ["10 PM", 1320], ["Midnight", 1440]] as const;

type Step = "intro" | "mood" | "personality" | "foods" | "budget" | "time" | "plan";
const ORDER: Step[] = ["intro", "mood", "personality", "foods", "budget", "time", "plan"];

const HER_NAME = PROFILE.name;
const OUTING_DOW = new Date(PROFILE.birthday + "T00:00:00").getDay();

export default function Page() {
  const [step, setStep] = useState<Step>("intro");
  const [name, setName] = useState("");
  const [mood, setMood] = useState<string[]>([]);
  const [personality, setPersonality] = useState<string[]>([]);
  const [foods, setFoods] = useState<string[]>([]);
  const [budget, setBudget] = useState(0);
  const [startMin, setStartMin] = useState(0);
  const [endMin, setEndMin] = useState(0);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [hello, setHello] = useState("");
  useEffect(() => { setHello(randomNickname()); }, [step]);

  const idx = ORDER.indexOf(step);
  const progress = Math.round((idx / (ORDER.length - 1)) * 100);

  function toggle(list: string[], v: string, set: (x: string[]) => void) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  }

  function generate() {
    const ans: Answers = {
      who: name || HER_NAME,
      mood: (mood.length ? mood[0] : "Birthday").toLowerCase(),
      personality: personality.map((p) => p.toLowerCase()),
      foods: foods.map((f) => (f === "Ice cream" ? "icecream" : f.toLowerCase())),
      budget: budget || 5000,
      startMin: startMin || 480,
      endMin: endMin || 1320,
      dayOfWeek: OUTING_DOW,
      dislikes: PROFILE.dislikes,
    };
    const p = buildPlan(ans);
    setPlan(p);
    setStep("plan");
    upgradeNarration(p, ans);
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

  return (
    <main className="mx-auto max-w-xl px-5 py-8 min-h-screen flex flex-col">
      {step !== "plan" && (
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
                Answer a few quick things and I will plan the whole day for you. Real places, real plan, made for your mood.
              </p>
              <PrimaryBtn onClick={() => setStep("mood")}>Press start</PrimaryBtn>
            </Screen>
          )}

          {step === "mood" && (
            <Screen>
              <Chibi mood={chibiMood} />
              <Q>What is the mood today?</Q>
              <Chips options={[...MOODS]} selected={mood} onTap={(v) => toggle(mood, v, setMood)} multi />
              <Nav onBack={() => setStep("intro")} onNext={() => setStep("personality")} canNext={mood.length > 0} />
            </Screen>
          )}

          {step === "personality" && (
            <Screen>
              <Chibi mood={chibiMood} />
              <Q>Pick the energy. Choose as many as fit.</Q>
              <Chips options={[...PERSONALITY]} selected={personality} onTap={(v) => toggle(personality, v, setPersonality)} multi />
              <Nav onBack={() => setStep("mood")} onNext={() => setStep("foods")} canNext={personality.length > 0} />
            </Screen>
          )}

          {step === "foods" && (
            <Screen>
              <Chibi mood="excited" />
              <Q>What are we eating?</Q>
              <Chips options={[...FOODS]} selected={foods} onTap={(v) => toggle(foods, v, setFoods)} multi />
              <Nav onBack={() => setStep("personality")} onNext={() => setStep("budget")} canNext={foods.length > 0} />
            </Screen>
          )}

          {step === "budget" && (
            <Screen>
              <Chibi mood="neutral" />
              <Q>What is the budget for the day?</Q>
              <Chips
                options={BUDGETS.map((b) => `₹${b.toLocaleString("en-IN")}`)}
                selected={budget ? [`₹${budget.toLocaleString("en-IN")}`] : []}
                onTap={(v) => setBudget(Number(v.replace(/[₹,]/g, "")))}
              />
              <Nav onBack={() => setStep("foods")} onNext={() => setStep("time")} canNext={!!budget} />
            </Screen>
          )}

          {step === "time" && (
            <Screen>
              <Chibi mood={chibiMood} />
              <Q>How long is the day?</Q>
              <p className="mt-2 text-sm text-white/50">Start</p>
              <Chips options={STARTS.map((s) => s[0])} selected={STARTS.filter((s) => s[1] === startMin).map((s) => s[0])} onTap={(v) => setStartMin(STARTS.find((s) => s[0] === v)![1])} />
              <p className="mt-4 text-sm text-white/50">End</p>
              <Chips options={ENDS.map((s) => s[0])} selected={ENDS.filter((s) => s[1] === endMin).map((s) => s[0])} onTap={(v) => setEndMin(ENDS.find((s) => s[0] === v)![1])} />
              <Nav onBack={() => setStep("budget")} onNext={generate} canNext={!!startMin && !!endMin} nextLabel="Plan my day" />
            </Screen>
          )}

          {step === "plan" && plan && (
            <PlanView plan={plan} name={name || HER_NAME} onRestart={() => setStep("intro")} />
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
function PrimaryBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="btn-primary mt-7 w-full rounded-xl py-3.5 font-semibold text-white">
      {children}
    </button>
  );
}
function Chips({ options, selected, onTap }: { options: string[]; selected: string[]; onTap: (v: string) => void; multi?: boolean }) {
  return (
    <div className="mt-5 flex flex-wrap gap-2.5">
      {options.map((o) => (
        <button key={o} onClick={() => onTap(o)} className={`chip rounded-full px-4 py-2 text-sm ${selected.includes(o) ? "chip-on" : "text-white/85"}`}>
          {o}
        </button>
      ))}
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
