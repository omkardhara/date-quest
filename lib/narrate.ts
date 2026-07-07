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

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

// Warm, grounded one-liner for a block. Templates only — AI upgrade follows via /api/narrate.
// Every line opens with a direct-address nickname, then stays in second person throughout.
export function narrate(p: Place, ans: Answers): string {
  const lead = `${nick()}, `;

  if (has(p, "muscat")) {
    return lead + pick([
      `a little taste of Muscat. ${p.summary}`,
      `this one is for the twenty years in Oman. ${p.summary}`,
      `closest thing to home. ${p.summary}`,
    ]);
  }
  if (has(p, "spa")) {
    return lead + pick([
      `you'd never book this for yourself, so here it is. ${p.summary}`,
      `this afternoon belongs entirely to you. ${p.summary}`,
    ]);
  }
  if (p.category === "dessert") {
    return lead + pick([
      `the part you actually came for. ${p.summary}`,
      `save room. ${p.summary}`,
      `a sweet end to a good stretch. ${p.summary}`,
    ]);
  }
  if (p.category === "shopping") {
    return lead + pick([
      `time to hunt. ${p.summary}`,
      `you'll find something. ${p.summary}`,
      `a window you browse and a bag you carry home. ${p.summary}`,
    ]);
  }
  if (has(p, "temple") || (p.vibes ?? []).includes("spiritual")) {
    return lead + pick([
      `a quiet hour for you. ${p.summary}`,
      `unhurried and calm. ${p.summary}`,
      `the city goes quiet here. ${p.summary}`,
    ]);
  }
  if (has(p, "sunset") || has(p, "lakeside") || has(p, "waterfall")) {
    return lead + pick([
      `out where it opens up. ${p.summary}`,
      `the kind of view that makes the city worth it. ${p.summary}`,
      `no screen makes this better. ${p.summary}`,
    ]);
  }
  if (p.category === "activity" && !p.indoor) {
    return lead + pick([
      `out where the city turns green. ${p.summary}`,
      `fresh air and a different pace. ${p.summary}`,
      `the version of Mumbai that doesn't feel like Mumbai. ${p.summary}`,
    ]);
  }
  if (p.category === "cafe") {
    return lead + pick([
      `slow down, good plate. ${p.summary}`,
      `a table worth sitting at. ${p.summary}`,
      `coffee, a good plate, no rush. ${p.summary}`,
    ]);
  }
  if (p.category === "rest") return lead + lowerFirst(p.summary);

  const c = (p.cuisines ?? []).find((x) => ans.foods.includes(x));
  if (c) {
    return lead + pick([
      `you wanted ${c}, so here we are. ${p.summary}`,
      `the ${c} stop. ${p.summary}`,
      `this one is for the ${c} craving. ${p.summary}`,
    ]);
  }

  const traits = ans.personality.filter((t) => t !== "queen").join(" and ");
  if (traits) {
    return lead + pick([
      `for the ${traits} in you. ${p.summary}`,
      `built for exactly the ${traits} energy. ${p.summary}`,
    ]);
  }
  return lead + lowerFirst(p.summary);
}

export function greeting(ans: Answers): string {
  const who = ans.who || PROFILE.name;
  const refDate = ans.outingDate ? new Date(ans.outingDate + "T00:00:00") : new Date();
  const [, bm, bd] = PROFILE.birthday.split("-").map(Number);
  const isBirthday = refDate.getMonth() === bm - 1 && refDate.getDate() === bd;
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
