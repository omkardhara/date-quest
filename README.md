# Date Quest

A little game that asks a few questions and plans a full day out in Mumbai. Built for reuse: every date or trip, answer the prompts and get a fresh plan from a verified set of real places.

## What works right now (v0.1)
- Sleek game-style question flow: name, mood, personality, food, budget, time window.
- A matching engine that builds a timeline with rest buffers, one public + one private transport option per leg, and a rain/backup note.
- A starter database of 12 real Mumbai spots (we will grow this together).
- Animated chibi placeholder (real chibi art drops in next).

## Coming next
- Her chibi avatar generated from photos (into `/public/chibi/`).
- AI narration layer for warmer, personal "because you love..." copy.
- A bigger, fully verified places database with live booking links.

## Run it on your computer
1. Install Node.js (LTS) from nodejs.org.
2. In this folder: `npm install`, then `npm run dev`.
3. Open http://localhost:3000

## Put it online for free (GitHub + Vercel)
1. Make a free GitHub account at github.com.
2. Create a new repository called `date-quest` (keep it private).
3. Upload this whole folder to that repo (GitHub web: "Add file" > "Upload files", drag everything EXCEPT `node_modules` and `.next`).
4. Go to vercel.com, sign in with GitHub, click "Add New > Project", pick `date-quest`, click Deploy.
5. Vercel gives you a live link like `date-quest-xxxx.vercel.app`. That is the link you send her.

## How to add a place
Open `data/places.json` and copy an existing entry. Fill in name, area, tags, cost, timing, a Google Maps link, and an honest one-line summary. Commit. It appears automatically.

## Personalize
- In `app/page.tsx`, set `HER_NAME` to her name (or leave it for her to type).
- Real chibi art goes in `public/chibi/` as `wave.png`, `neutral.png`, `excited.png`, `happy.png`.

## Optional: warmer AI narration (Groq, free)
The app works fully without this. To turn on AI-written stop descriptions:
1. Get a free key at https://console.groq.com (API Keys).
2. Local: copy `.env.local.example` to `.env.local` and paste your key.
3. On Vercel: Project > Settings > Environment Variables > add `GROQ_API_KEY`, then redeploy.
If the key is missing or the call fails, the built-in narration is used automatically.
