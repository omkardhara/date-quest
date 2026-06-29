import { Place, Answers } from "./types";
import { PROFILE } from "./profile";

function nick() {
  return PROFILE.nicknames[Math.floor(Math.random() * PROFILE.nicknames.length)];
}
function has(p: Place, t: string) {
  return (p.tags ?? []).includes(t);
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Warm, grounded one-liner for a block. Templates only — AI upgrade follows via /api/narrate.
export function narrate(p: Place, ans: Answers): string {
  const useNick = Math.random() < 0.4;
  const n = useNick ? `, ${nick()}` : "";

  if (has(p, "muscat")) {
    return pick([
      `A little taste of Muscat${n}. ${p.summary}`,
      `This one is for the twenty years in Oman${n}. ${p.summary}`,
      `Closest thing to home${n}. ${p.summary}`,
    ]);
  }
  if (has(p, "spa")) {
    return pick([
      `She would never book this for herself${n}. ${p.summary}`,
      `An afternoon that belongs entirely to her${n}. ${p.summary}`,
    ]);
  }
  if (p.category === "dessert") {
    return pick([
      `The part you actually came for${n}. ${p.summary}`,
      `Save room. ${p.summary}`,
      `A sweet end to a good stretch${n}. ${p.summary}`,
    ]);
  }
  if (p.category === "shopping") {
    return pick([
      `Time to hunt${n}. ${p.summary}`,
      `She will find something. ${p.summary}`,
      `A window you browse and a bag you carry home${n}. ${p.summary}`,
    ]);
  }
  if (has(p, "temple") || (p.vibes ?? []).includes("spiritual")) {
    return pick([
      `A quiet hour for you${n}. ${p.summary}`,
      `Unhurried and calm${n}. ${p.summary}`,
      `The city goes quiet here${n}. ${p.summary}`,
    ]);
  }
  if (has(p, "sunset") || has(p, "lakeside") || has(p, "waterfall")) {
    return pick([
      `Out where it opens up. ${p.summary}`,
      `The kind of view that makes the city worth it. ${p.summary}`,
      `No screen makes this better. ${p.summary}`,
    ]);
  }
  if (p.category === "activity" && !p.indoor) {
    return pick([
      `Out where the city turns green. ${p.summary}`,
      `Fresh air and a different pace. ${p.summary}`,
      `The version of Mumbai that doesn't feel like Mumbai. ${p.summary}`,
    ]);
  }
  if (p.category === "cafe") {
    return pick([
      `Slow start, pretty plate. ${p.summary}`,
      `The morning deserves a good table${n}. ${p.summary}`,
      `Coffee, a good plate, no rush. ${p.summary}`,
    ]);
  }
  if (p.category === "rest") return p.summary;

  const c = (p.cuisines ?? []).find((x) => ans.foods.includes(x));
  if (c) {
    return pick([
      `You wanted ${c}, so here we are${n}. ${p.summary}`,
      `The ${c} stop${n}. ${p.summary}`,
      `This one is for the ${c} craving${n}. ${p.summary}`,
    ]);
  }

  const traits = ans.personality.filter((t) => t !== "queen").join(" and ");
  if (traits) {
    return pick([
      `For the ${traits} in you. ${p.summary}`,
      `Built for exactly the ${traits} energy. ${p.summary}`,
    ]);
  }
  return p.summary;
}

export function greeting(ans: Answers): string {
  const who = ans.who || PROFILE.name;
  const today = new Date();
  const isBirthday = today.getMonth() === 6 && today.getDate() === 8; // July 8
  if (isBirthday) return `Happy birthday, ${who}. Here is your whole day, start to finish.`;

  const allMoods = ans.moodList ?? [ans.mood];
  if (allMoods.includes("anniversary")) return `${who}. A whole day, just the two of you. Start to finish.`;
  if (allMoods.includes("proposal")) return `${who}. A day she will remember for the rest of her life.`;
  if (allMoods.includes("birthday")) return `Here is the day, ${who}. Yours, start to finish.`;
  if (allMoods.includes("romantic")) return `The whole day, ${who}. Made for the two of you.`;
  return `Here is the day, ${who}. Start to finish.`;
}

export function signoff(): string {
  return pick([
    `Whatever the day does, it is yours. Go enjoy it, ${nick()}.`,
    `Now go. It is all planned, ${nick()}. You just have to show up.`,
    `The day is ready, ${nick()}. Go live it.`,
  ]);
}
