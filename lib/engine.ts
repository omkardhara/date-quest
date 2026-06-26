import placesData from "@/data/places.json";
import { Answers, Place, Plan, PlanBlock, Category } from "./types";
import { PROFILE } from "./profile";
import { narrate, greeting, signoff } from "./narrate";

const PLACES = placesData as Place[];
const TRAVEL_BUFFER = 30;
const FOODY: Category[] = ["food", "dessert"];

function bandFor(min: number) {
  if (min < 720) return "morning";
  if (min < 1020) return "afternoon";
  if (min < 1200) return "evening";
  return "night";
}
function overlap(a: string[] = [], b: string[] = []) {
  return a.filter((x) => b.includes(x)).length;
}

function score(p: Place, ans: Answers, band: string): number {
  let s = 0;
  s += overlap(p.vibes, ans.personality) * 3;
  if (p.moods.includes(ans.mood)) s += 2;
  if (p.bestTime === band || p.bestTime === "any") s += 2;
  if (FOODY.includes(p.category)) s += overlap(p.cuisines, ans.foods) * 4;
  s += overlap(p.tags, PROFILE.loves) * 2; // her standing loves
  const perHead = ans.budget / 2;
  if (p.costPerPerson * 2 <= perHead) s += 1;
  if (ans.personality.includes("adventure")) s += p.adventureLevel;
  if (ans.personality.includes("peaceful")) s += 3 - p.adventureLevel;
  return s;
}

function blocked(p: Place, ans: Answers): boolean {
  // veg-day rule
  if (
    FOODY.includes(p.category) &&
    ans.dayOfWeek !== undefined &&
    PROFILE.vegDays.includes(ans.dayOfWeek) &&
    p.veg === false
  )
    return true;
  // dislikes
  if (ans.dislikes && overlap(p.contains, ans.dislikes) > 0) return true;
  return false;
}

function pick(ans: Answers, band: string, cats: Category[], used: Set<string>, cuisineFilter?: string[]): Place | undefined {
  const pool = PLACES.filter(
    (p) =>
      cats.includes(p.category) &&
      !used.has(p.id) &&
      !blocked(p, ans) &&
      (!cuisineFilter || cuisineFilter.length === 0 || overlap(p.cuisines, cuisineFilter) > 0)
  );
  if (pool.length === 0) return undefined;
  return pool.sort((a, b) => score(b, ans, band) - score(a, ans, band))[0];
}

function transportFor() {
  return { publicOption: PROFILE.transport.publicOption, privateOption: PROFILE.transport.privateOption };
}
function backupFor(p: Place): string | undefined {
  if (p.safety) return p.safety;
  if (!p.indoor) {
    const alt = PLACES.find((x) => x.indoor && x.category === p.category && x.id !== p.id);
    return alt ? `If it pours or gets too hot: swap for ${alt.name}.` : undefined;
  }
  return undefined;
}

export function buildPlan(ans: Answers): Plan {
  const used = new Set<string>();
  const blocks: PlanBlock[] = [];
  let cursor = ans.startMin;
  const end = ans.endMin;
  const vegDay = ans.dayOfWeek !== undefined && PROFILE.vegDays.includes(ans.dayOfWeek);

  const add = (p: Place | undefined, kind: Category) => {
    if (!p || cursor >= end) return;
    const dur = Math.min(p.durationMins, Math.max(20, end - cursor));
    used.add(p.id);
    blocks.push({
      startMin: cursor,
      endMin: cursor + dur,
      title: p.name,
      place: p,
      why: narrate(p, ans),
      cost: p.costPerPerson * 2,
      transport: blocks.length === 0 ? undefined : transportFor(),
      backup: backupFor(p),
      kind,
    });
    cursor += dur + TRAVEL_BUFFER;
  };

  const longDay = end - ans.startMin > 480;

  if (ans.startMin < 660) {
    add(pick(ans, "morning", ["activity", "experience"], used), "activity");
    add(pick(ans, "morning", ["cafe"], used), "cafe");
  }
  if (cursor < 900 && end > 780) add(pick(ans, "afternoon", ["food"], used, ans.foods), "food");
  if (end > 900) add(pick(ans, "afternoon", ["experience", "activity", "shopping"], used), "experience");
  if (longDay && cursor < 1140) add(PLACES.find((p) => p.category === "rest"), "rest");
  if (end > 1080) add(pick(ans, "evening", ["activity", "experience", "shopping", "cafe"], used), "activity");
  if (end > 1140) add(pick(ans, "night", ["food"], used, ans.foods), "food");
  if (end - cursor > 15) add(pick(ans, "night", ["dessert"], used, ans.foods), "dessert");

  const totalCost = blocks.reduce((s, b) => s + b.cost, 0);
  const plan: Plan = { blocks, totalCost, budget: ans.budget, overBudget: totalCost > ans.budget, greeting: greeting(ans), signoff: signoff() };
  // attach a veg-day note via first block backup if relevant
  if (vegDay && blocks.length) {
    blocks[0].backup = `Heads up: it's a veg day (Mon, Thu, Sat), so every food stop is vegetarian. ${blocks[0].backup ?? ""}`.trim();
  }
  return plan;
}
