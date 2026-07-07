"use client";
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Msg { role: "user" | "assistant"; content: string }

const STARTERS = [
  "Best time of year for the butterfly garden?",
  "What movies are on at Infiniti Mall right now?",
  "Any good rain-friendly spots?",
];

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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
        body: JSON.stringify({ message: content, history: next.slice(-8) }),
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
        className="btn-primary fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full text-2xl shadow-lg"
        aria-label={open ? "Close chat" : "Ask about a spot"}
      >
        {open ? "✕" : "💬"}
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
            <div className="border-b border-white/10 px-4 py-3">
              <p className="font-display text-sm font-semibold hero-text">Ask about a spot</p>
              <p className="text-xs text-white/45">Movies, best times to visit, what's nearby…</p>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {messages.length === 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-white/40">Try asking:</p>
                  {STARTERS.map((s) => (
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
