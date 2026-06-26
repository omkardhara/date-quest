import { Place, Answers } from "./types";
import { PROFILE } from "./profile";

function nick() {
  return PROFILE.nicknames[Math.floor(Math.random() * PROFILE.nicknames.length)];
}
function has(p: Place, t: string) {
  return (p.tags ?? []).includes(t);
}

// Warm, grounded one-liner for a block. Templates only, no external calls.
export function narrate(p: Place, ans: Answers): string {
  const useNick = Math.random() < 0.4;
  const name = useNick ? `, ${nick()}` : "";

  if (has(p, "muscat")) {
    return `A little taste of Muscat${name}. ${p.summary}`;
  }
  if (p.category === "dessert") {
    return `The part you actually came for${name}. ${p.summary}`;
  }
  if (p.category === "shopping") {
    return `Time to hunt${name}. ${p.summary}`;
  }
  if (has(p, "temple") || (p.vibes ?? []).includes("spiritual")) {
    return `A quiet hour for you${name}. ${p.summary}`;
  }
  if (p.category === "activity" && !p.indoor) {
    return `Out where the city turns green. ${p.summary}`;
  }
  if (p.category === "cafe") {
    return `Slow start, pretty plate. ${p.summary}`;
  }
  if (p.category === "rest") return p.summary;
  const c = (p.cuisines ?? []).find((x) => ans.foods.includes(x));
  if (c) return `You wanted ${c}, so here we are${name}. ${p.summary}`;

  const traits = ans.personality.filter((t) => t !== "queen").join(" and ");
  if (traits) return `For the ${traits} in you. ${p.summary}`;
  return p.summary;
}

export function greeting(ans: Answers): string {
  const who = ans.who || PROFILE.name;
  const today = new Date();
  const isBirthday = today.getMonth() === 6 && today.getDate() === 8; // July 8
  if (isBirthday) return `Happy birthday, ${who}. Here is your whole day, start to finish.`;
  return `Here is the day, ${who}. Start to finish.`;
}

export function signoff(): string {
  return `Whatever the day does, it is yours. Go enjoy it, ${nick()}.`;
}
