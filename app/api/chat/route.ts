import { NextRequest, NextResponse } from "next/server";
import { findNearby, findRelevantPlaces, findVenueReviews, isFoodQuestion, isTravelQuestion, liveSearchSnippets, needsLiveSearch, travelAdvice } from "@/lib/chat";

export const runtime = "nodejs";

interface ChatMessage { role: "user" | "assistant"; content: string }

// Answers freeform questions about Mumbai activities/venues for the chat widget.
// Grounds venue-specific facts in data/places.json, pulls live search snippets
// for time-sensitive questions (showtimes, current events), and otherwise lets
// the model answer from general knowledge (e.g. seasonal advice).
export async function POST(req: NextRequest) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, reply: "Chat isn't set up yet — DEEPSEEK_API_KEY is missing." });
  }

  try {
    const body = await req.json();
    const message: string = (body.message ?? "").trim();
    const history: ChatMessage[] = Array.isArray(body.history) ? body.history.slice(-8) : [];
    const itinerary: string = (body.itinerary ?? "").trim();
    if (!message) return NextResponse.json({ ok: false, reply: "Ask me something about a Mumbai spot or activity!" });

    const isFoodQ = isFoodQuestion(message);
    const isTravelQ = isTravelQuestion(message);

    // "N good <category> places near X" — zone-aware, not just word overlap. Live-searches
    // the exact locality named (e.g. Powai) when curated data there is thin, rather than
    // silently answering with a different neighbourhood.
    const nearby = await findNearby(message, itinerary);
    const places = nearby?.places.length ? nearby.places : findRelevantPlaces(message);

    // Food/menu questions ("what to order at X") are answered from real Google
    // review excerpts for the named venue — a generic web search mostly surfaces
    // "10 best X restaurants" listicles rather than anything about the specific
    // place asked about, especially for small/lightly-reviewed spots.
    const venueReviews = isFoodQ ? await findVenueReviews(message) : null;
    const liveSnippets = needsLiveSearch(message) && !venueReviews ? await liveSearchSnippets(`${message} Mumbai`) : [];

    // "How do I get there" — grounds in the app's own real drive-time data
    // instead of letting the model invent bus numbers or transit specifics.
    const travel = isTravelQ ? travelAdvice(message) : null;

    const sys = [
      "You are the Date Quest assistant — a friendly, concise guide inside a Mumbai day-planning app.",
      "Answer questions about specific activities, restaurants, and locations in and around Mumbai.",
      "If 'Current itinerary' context is given, that is the exact plan already generated and shown to the user on screen right now. When they say 'this place', 'here', 'my plan', 'the first/next stop', or refer to a stop without naming it, resolve it against that itinerary first — don't ask them to clarify which place they mean if the itinerary makes it clear.",
      "If 'Spots found' context is given, ground venue-specific facts (area, vibe, monsoon suitability, cost, top dishes) STRICTLY in that data — never invent an address, price, opening hours, or dish for a place listed there. These are real places — some from curated data, some pulled live from Google just now — treat both the same way: state them confidently as real options, don't caveat live-sourced ones as less certain. Check ALL the entries given, not just the first: if two entries share a similar name (different branches of the same place), each is a real, separate location — match the user's question to whichever entry's area fits what they asked, and answer using that one directly. Only tell the user their stated area is wrong if NONE of the given entries for that name are in the area they mentioned.",
      "When the user asks for a category of place in a specific area (e.g. 'dessert places in Powai', 'a sizzler restaurant in Thane') and 'Spots found' lists real options, ANSWER WITH THOSE — never say the data doesn't cover that area or tell them to go check Zomato/Google themselves; that data was just pulled live for exactly this question, so refusing defeats the point of asking. Only say you don't have something specific if 'Spots found' is genuinely empty for that question.",
      "Never state a specific dish, drink, or menu item for a venue unless it's explicitly named in that venue's curated summary/topDishes or in 'Recent Google reviews' context below — don't infer plausible-sounding specifics from the cuisine type or your general knowledge. If you don't have named specifics, describe it at the level of detail the given data actually supports (e.g. 'known for mezze and grills' rather than naming dishes that aren't listed).",
      "If 'Recent Google reviews' are given, use them to name specific dishes/drinks reviewers actually praised — mention 1-3 by name if they come up, and say it's based on recent reviews, not an official menu.",
      "If 'Live search results' are given, use them for anything time-sensitive (movie showtimes, current events, weather) and note that it can change — don't state it as a certain fact.",
      "If 'Travel info' is given, use ONLY that for drive time and transport modes — never invent a specific bus number, train line, or fare you weren't given. If no drive time is given, just share the general transport options and the maps link.",
      "Only say you don't have data and suggest checking elsewhere (Zomato/Google reviews for dishes, BookMyShow for movies, Google Maps for live transit) as a genuine last resort — after 'Spots found' truly has nothing relevant. Don't default to this for questions 'Spots found' already answers.",
      "For general knowledge (best season for butterflies, typical Mumbai monsoon months, etc.) answer normally from what you know.",
      "Keep answers short: 2-4 sentences, conversational. Plain text only — no markdown at all (no **bold**, no headers, no bullet lists, no asterisks); the chat widget renders this as raw text so markdown symbols would show up literally.",
    ].join(" ");

    const contextParts: string[] = [];
    if (itinerary) {
      contextParts.push(`Current itinerary (exactly what the user sees on screen right now):\n${itinerary}`);
    }
    if (places.length) {
      contextParts.push("Spots found:\n" + places.map((p) =>
        `- ${p.name} (${p.area}${p.distanceKm !== undefined ? `, ~${p.distanceKm} km away` : ""}): ${p.summary}${p.bestTime ? ` Best time of day: ${p.bestTime}.` : ""}${p.monsoonRisk ? ` Monsoon: ${p.monsoonRisk}.` : ""}${p.safety ? ` Note: ${p.safety}` : ""}${p.topDishes?.length ? ` Top dishes: ${p.topDishes.join(", ")}.` : ""}`
      ).join("\n"));
    }
    if (venueReviews) {
      contextParts.push(
        `Recent Google reviews for ${venueReviews.name}${venueReviews.rating ? ` (${venueReviews.rating}★, ${venueReviews.userRatings ?? 0} reviews)` : ""}:\n` +
        venueReviews.reviews.map((r) => `- "${r}"`).join("\n")
      );
    }
    if (liveSnippets.length) {
      contextParts.push("Live search results:\n" + liveSnippets.map((s) => `- ${s.title}: ${s.snippet}`).join("\n"));
    }
    if (travel) {
      contextParts.push(
        `Travel info to ${travel.venueName} (${travel.venueArea}), from home in ${travel.homeArea}:\n` +
        (travel.mins ? `- Approx drive time: ${travel.mins} min${travel.minsIsExact ? " (real map data)" : " (rough estimate)"}.\n` : "") +
        `- Public transport: ${travel.transport.publicOption}\n` +
        `- Private transport: ${travel.transport.privateOption}\n` +
        `- Directions: ${travel.directionsUrl}`
      );
    }

    const messages = [
      { role: "system", content: sys },
      ...(contextParts.length ? [{ role: "system", content: contextParts.join("\n\n") }] : []),
      ...history,
      { role: "user", content: message },
    ];

    const ctrl = new AbortController();
    // DeepSeek doesn't have Groq's LPU-speed inference — give it more room before aborting.
    const t = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 0.4,
        messages,
      }),
    });
    clearTimeout(t);

    if (!r.ok) return NextResponse.json({ ok: false, reply: "Couldn't reach the chat service — try again in a moment." });
    const data = await r.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();
    if (!reply) return NextResponse.json({ ok: false, reply: "Didn't quite catch that — try rephrasing?" });
    return NextResponse.json({ ok: true, reply });
  } catch {
    return NextResponse.json({ ok: false, reply: "Something went wrong — try again in a moment." });
  }
}
