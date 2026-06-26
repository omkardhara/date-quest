# Date Quest — project context for Claude Code

A game-styled web app that asks a few questions and plans a full day out in Mumbai.
Built for reuse (any date or trip), preconfigured for Amruta's birthday (8 July).

## Stack
- Next.js 14 (App Router), React 18, TypeScript
- Tailwind CSS, Framer Motion
- Deploys free on Vercel from a GitHub repo

## Where things live
- `app/page.tsx` — the question flow + plan screen (client state machine)
- `lib/profile.ts` — Amruta's profile: name, nicknames, veg days, dislikes, loves, transport
- `data/places.json` — verified Mumbai places (the only place to add spots)
- `lib/engine.ts` — matching engine (veg-day rule, dislikes, tag preference, timeline + buffers)
- `lib/narrate.ts` — warm templated narration (free, offline)
- `app/api/narrate/route.ts` — optional Groq upgrade for warmer copy

## Hard rules
- Verified links only. Never invent a place, price, or URL. Use Google Maps search links.
- Respect her diet: no mutton; veg on Mon/Thu/Sat; avoid mushroom, capsicum, oily.
- Writing style: simple, warm, specific. No em dashes. No "not X but Y". No hype words.

## Common tasks
- Add a place: copy an entry in `data/places.json`, fill all fields, commit.
- Add a nickname: edit the `nicknames` array in `lib/profile.ts`.
- Turn on AI narration: set `GROQ_API_KEY` (local `.env.local`, or Vercel env var).

## Deploy
- Push to GitHub, import on vercel.com, add `GROQ_API_KEY` env var (optional), deploy.
