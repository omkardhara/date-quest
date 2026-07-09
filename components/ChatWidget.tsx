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

// Wraps the per-stop lines (reported by PlanView/GetawayView, swap-aware)
// with a header identifying which kind of itinerary this is. The lines
// themselves already reflect whatever the user currently has swapped in.
function buildItinerarySummary(plan?: Plan | null, getaway?: GetawayPlan | null, lines: string[] = []): string {
  if (!lines.length) return "";
  if (getaway) return `Weekend getaway to ${getaway.destination} (${getaway.nights} night${getaway.nights === 1 ? "" : "s"}):\n${lines.join("\n")}`;
  if (plan) return `Today's Mumbai plan:\n${lines.join("\n")}`;
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

// ── Draggable positioning ───────────────────────────────────────────────────
// The floating button used to be pinned to bottom-right always, which on a
// phone can sit right over other controls (e.g. the swap/regenerate buttons
// on a plan card). Repositionable via drag (mouse) or touch-drag, and the
// chosen spot is remembered across visits.
const BUTTON_SIZE = 56;
const EDGE_MARGIN = 16;
const PANEL_W_EST = 360;
const PANEL_H_EST = 520;
const POS_KEY = "dateQuest.chatWidgetPos";
const DRAG_THRESHOLD = 6; // px of movement before a press counts as a drag, not a tap

function clampPos(x: number, y: number): { x: number; y: number } {
  const maxX = Math.max(EDGE_MARGIN, window.innerWidth - BUTTON_SIZE - EDGE_MARGIN);
  const maxY = Math.max(EDGE_MARGIN, window.innerHeight - BUTTON_SIZE - EDGE_MARGIN);
  return { x: Math.min(Math.max(EDGE_MARGIN, x), maxX), y: Math.min(Math.max(EDGE_MARGIN, y), maxY) };
}

function defaultPos(): { x: number; y: number } {
  return clampPos(window.innerWidth - BUTTON_SIZE - EDGE_MARGIN, window.innerHeight - BUTTON_SIZE - EDGE_MARGIN);
}

// Where the chat panel should open relative to the (possibly relocated) button,
// staying on-screen and preferring to open upward/leftward from the button
// (matching the original bottom-right-anchored layout) but flipping when there
// isn't room.
function panelPos(btn: { x: number; y: number }): { left: number; top: number } {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(vw * 0.92, PANEL_W_EST);
  const h = Math.min(vh * 0.70, PANEL_H_EST);
  let left = btn.x + BUTTON_SIZE - w;
  let top = btn.y - h - 12;
  if (top < EDGE_MARGIN) top = Math.min(btn.y + BUTTON_SIZE + 12, vh - h - EDGE_MARGIN);
  if (left < EDGE_MARGIN) left = EDGE_MARGIN;
  if (left + w > vw - EDGE_MARGIN) left = vw - w - EDGE_MARGIN;
  if (top < EDGE_MARGIN) top = EDGE_MARGIN;
  return { left, top };
}

export function ChatWidget({ plan, getaway, itineraryLines }: { plan?: Plan | null; getaway?: GetawayPlan | null; itineraryLines?: string[] }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const itinerary = useMemo(() => buildItinerarySummary(plan, getaway, itineraryLines), [plan, getaway, itineraryLines]);

  // null until mounted — avoids an SSR/client mismatch (window isn't available on the server).
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragState = useRef({ pointerX: 0, pointerY: 0, startX: 0, startY: 0, moved: false });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(POS_KEY);
      if (saved) { setPos(clampPos(...(JSON.parse(saved) as [number, number]))); return; }
    } catch { /* ignore malformed saved position */ }
    setPos(defaultPos());
  }, []);

  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clampPos(p.x, p.y) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, open]);

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (!pos) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { pointerX: e.clientX, pointerY: e.clientY, startX: pos.x, startY: pos.y, moved: false };
    setDragging(true);
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!dragging) return;
    const dx = e.clientX - dragState.current.pointerX;
    const dy = e.clientY - dragState.current.pointerY;
    if (!dragState.current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    dragState.current.moved = true;
    setPos(clampPos(dragState.current.startX + dx, dragState.current.startY + dy));
  }

  function onPointerUp() {
    if (!dragging) return;
    setDragging(false);
    if (dragState.current.moved) {
      setPos((p) => {
        if (p) { try { localStorage.setItem(POS_KEY, JSON.stringify([p.x, p.y])); } catch { /* storage unavailable */ } }
        return p;
      });
    } else {
      setOpen((o) => !o); // no real movement — treat as a tap
    }
  }

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

  if (!pos) return null; // wait for mount so we have real viewport dimensions

  const panel = panelPos(pos);

  return (
    <>
      <button
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="fixed z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg ring-2 ring-white/20 touch-none select-none"
        style={{ left: pos.x, top: pos.y, cursor: dragging ? "grabbing" : "grab" }}
        aria-label={open ? "Close chat" : "Ask about a spot — drag to reposition"}
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
            className="glass fixed z-50 flex h-[min(70vh,520px)] w-[min(92vw,360px)] flex-col overflow-hidden rounded-2xl"
            style={{ left: panel.left, top: panel.top }}
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
