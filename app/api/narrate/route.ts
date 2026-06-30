import { NextRequest, NextResponse } from "next/server";
import { PROFILE } from "@/lib/profile";

export const runtime = "nodejs";

// Upgrades the templated "why" lines into warmer copy using Groq.
// If GROQ_API_KEY is missing or the call fails, returns ok:false and the
// app keeps the free templated narration. Never invents places or links.
export async function POST(req: NextRequest) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return NextResponse.json({ ok: false, reason: "no-key" });

  try {
    const body = await req.json();
    const blocks: Array<{ id: string; title: string; summary: string; category: string; tags: string[] }> = body.blocks ?? [];
    const answers = body.answers ?? {};

    const sys = [
      "You write warm, short one-liners for a birthday day-out planner.",
      `The day is for ${PROFILE.name}. Pet names you may use sparingly: ${PROFILE.nicknames.join(", ")}.`,
      `She lived in Muscat 20 years and misses it; for any stop tagged "muscat" lean into that nostalgia gently.`,
      "Rules: 1 to 2 sentences per stop. Ground every line ONLY in the given place name and summary. Never invent a place, dish, price, or link. No em dashes. Do not use the pattern 'not X but Y'. No hype words. Simple, specific, kind.",
      "Return strict JSON: {\"lines\":[{\"id\":\"<id>\",\"text\":\"<line>\"}]}.",
    ].join(" ");

    const user = JSON.stringify({
      mood: answers.mood,
      personality: answers.personality,
      foods: answers.foods,
      stops: blocks.map((b) => ({ id: b.id, name: b.title, summary: b.summary, category: b.category, tags: b.tags })),
    });

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
      }),
    });

    clearTimeout(t);
    if (!r.ok) return NextResponse.json({ ok: false, reason: `groq-${r.status}` });
    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text);
    const map: Record<string, string> = {};
    for (const l of parsed.lines ?? []) if (l?.id && l?.text) map[l.id] = l.text;
    return NextResponse.json({ ok: true, lines: map });
  } catch (e) {
    return NextResponse.json({ ok: false, reason: "error" });
  }
}
