"use client";
import { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plan, GetawayPlan } from "@/lib/types";

interface Msg { role: "user" | "assistant"; content: string }

const STARTERS = [
  "Best time of year for the butterfly garden?",
  "What movies are on at Infiniti Mall right now?",
  "Any good rain-friendly spots?",
];

const ITINERARY_STARTERS = [
  "What's the best time to visit my first stop?",
  "How do I get to my next stop from here?",
  "Any good shopping spots near my plan?",
];

function fmtTime(min: number): string {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  const ap = h < 12 ? "AM" : "PM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${m.toString().padStart(2, "0")} ${ap}`;
}

// Summarizes whatever itinerary is currently on screen so the model can
// answer "this place" / "the shopping stop" / "my plan" questions against
// the actual stops shown, instead of only generic curated/live lookups.
function buildItinerarySummary(plan?: Plan | null, getaway?: GetawayPlan | null): string {
  if (getaway) {
    const lines = getaway.days.flatMap((day) =>
      day.blocks
        .filter((b) => b.kind !== "buffer")
        .map((b) => `${day.label}, ${fmtTime(b.startMin)}: ${b.title}${b.place?.area ? ` (${b.place.area})` : ""} — ₹${b.cost}`)
    );
    if (!lines.length) return "";
    return `Weekend getaway to ${getaway.destination} (${getaway.nights} night${getaway.nights === 1 ? "" : "s"}):\n${lines.join("\n")}`;
  }
  if (plan?.blocks?.length) {
    const lines = plan.blocks.map((b) =>
      `${fmtTime(b.startMin)}–${fmtTime(b.endMin)}: ${b.title}${b.place?.area ? ` (${b.place.area})` : ""} — ₹${b.cost}`
    );
    return `Today's Mumbai plan:\n${lines.join("\n")}`;
  }
  return "";
}

// Crops the full-body chibi art down to just the face, since /public/chibi/*.png
// is a portrait meant for a tall hero area, not a small round avatar.
function ChibiAvatar({ size }: { size: number }) {
  return (
    <div
      className="shrink-0 overflow-hidden rounded-full bg-white/10"
      style={{
        height: size,
        width: size,
        backgroundImage: "url(/chibi/happy.png)",
        backgroundSize: "250% auto",
        backgroundPosition: "center 10%",
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}

export function ChatWidget({ plan, getaway }: { plan?: Plan | null; getaway?: GetawayPlan | null }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const itinerary = useMemo(() => buildItinerarySummary(plan, getaway), [plan, getaway]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, open]);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    const next: Msg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content, history: next.slice(-8), itinerary }),
      });
      const data = await res.json();
      setMessages([...next, { role: "assistant", content: data.reply ?? "Something went wrong — try again in a moment." }]);
    } catch {
      setMessages([...next, { role: "assistant", content: "Couldn't reach the chat service — try again in a moment." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg ring-2 ring-white/20"
        aria-label={open ? "Close chat" : "Ask about a spot"}
      >
        {open ? (
          <span className="btn-primary flex h-full w-full items-center justify-center rounded-full text-2xl">✕</span>
        ) : (
          <ChibiAvatar size={56} />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ duration: 0.18 }}
            className="glass fixed bottom-24 right-5 z-50 flex h-[min(70vh,520px)] w-[min(92vw,360px)] flex-col overflow-hidden rounded-2xl"
          >
            <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-3">
              <ChibiAvatar size={36} />
              <div>
                <p className="font-display text-sm font-semibold hero-text">Ask about a spot</p>
                <p className="text-xs text-white/45">{itinerary ? "Ask about your plan, movies, what's nearby…" : "Movies, best times to visit, what's nearby…"}</p>
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {messages.length === 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-white/40">Try asking:</p>
                  {(itinerary ? ITINERARY_STARTERS : STARTERS).map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="chip block w-full rounded-xl px-3 py-2 text-left text-xs text-white/75"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-snug ${
                  m.role === "user" ? "ml-auto bg-glow/20 text-white/90" : "bg-white/6 text-white/80"
                }`}>
                  {m.content}
                </div>
              ))}
              {loading && (
                <div className="max-w-[70%] rounded-2xl bg-white/6 px-3 py-2 text-sm text-white/50">
                  Thinking…
                </div>
              )}
            </div>

            <div className="flex gap-2 border-t border-white/10 p-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }}
                placeholder="Ask a question…"
                className="flex-1 rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-sm outline-none focus:border-glow"
              />
              <button
                onClick={() => send()}
                disabled={loading || !input.trim()}
                className="btn-primary rounded-xl px-4 text-sm font-medium disabled:opacity-40 disabled:shadow-none"
              >
                Send
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
