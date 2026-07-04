/**
 * Date Quest — launch readiness audit
 * Checks: variety, geographic cohesion, same-environment doubles,
 *         budget adherence, swap coherence, time consistency.
 * Usage: node scripts/launch-audit.mjs
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const PLACES = JSON.parse(readFileSync(join(__dir, "../data/places.json"), "utf8"));

// ── helpers mirroring engine.ts ──────────────────────────────────────────────
const LOVES = ["dessert","nature","lowcrowd","instagrammable","exoticfruit","brunch","waterfall",
               "lakeside","forest","sizzler","shopping","thrift","temple","serene","muscat",
               "arabic","sunset","spa"];
const VEG_DAYS = [1, 4, 6];
const CORRIDOR_ZONES = {
  bandra_hub:      ["bandra","andheri_w","central","multiple"],
  south_loop:      ["south","central","bandra","multiple"],
  north_adventure: ["borivali","andheri_w","bandra","multiple"],
  thane_east:      ["thane","home","andheri_w","multiple"],
  full_day_out:    ["karjat","kolad","gorai","multiple"],
};
const TRAVEL_BASE = {
  "andheri_w-bandra":20,"andheri_w-borivali":35,"andheri_w-central":40,
  "andheri_w-home":20,"andheri_w-south":55,"andheri_w-thane":55,
  "bandra-central":30,"bandra-home":35,"bandra-south":35,"bandra-thane":65,
  "borivali-home":60,"borivali-vasai":50,"central-home":40,"central-south":20,
  "central-thane":50,"gorai-home":75,"gorai-vasai":75,"karjat-kolad":60,"karjat-vasai":200,
  "karjat-gorai":180,"kolad-vasai":220,"kolad-gorai":190,"home-south":60,"home-thane":45,"home-vasai":90,
  "home-karjat":150,"home-kolad":150,"home-gorai":75,"home-borivali":60,"thane-vasai":140,
};
const FAR_RETURN = { vasai:90, karjat:130, kolad:150, gorai:70, borivali:50, thane:45 };

function travelMin(from, to, atMin = 720) {
  if (from === to) return 10;
  if (from === "multiple" || to === "multiple") {
    const far = from === "multiple" ? FAR_RETURN[to] : FAR_RETURN[from];
    return far ?? 15;
  }
  const base = TRAVEL_BASE[[from, to].sort().join("-")] ?? 60;
  if (atMin >= 1020 && atMin < 1200) return Math.round(base * 1.4);
  if (atMin >= 720  && atMin < 900)  return Math.round(base * 1.2);
  return base;
}

function overlap(a = [], b = []) { return (a||[]).filter(x => (b||[]).includes(x)).length; }
function bandFor(m) {
  if (m < 720) return "morning"; if (m < 1020) return "afternoon";
  if (m < 1200) return "evening"; return "night";
}
function timeAllowed(p, atMin) {
  switch (p.bestTime) {
    case "morning":   return atMin < 780;
    case "afternoon": return atMin >= 660 && atMin < 1140;
    case "evening":   return atMin >= 1020;
    case "night":     return atMin >= 1080;
    default:          return true;
  }
}
function blocked(p, ans) {
  const foody = ["food","dessert"];
  if (foody.includes(p.category) && ans.dayOfWeek !== undefined &&
      VEG_DAYS.includes(ans.dayOfWeek) && p.veg === false) return true;
  if (ans.wetDay && p.outdoor && p.monsoonRisk === "avoid") return true;
  if (ans.dayOfWeek !== undefined && (p.closedDays??[]).includes(ans.dayOfWeek)) return true;
  return false;
}
function environment(p) {
  // Food venues are always "food" regardless of location or tags.
  if (["food","cafe","dessert"].includes(p.category)) return "food";
  const name = (p.name||"").toLowerCase();
  const tags = p.tags ?? [];
  if (tags.some(t=>["beach","sea","promenade","waterfront","causeway","lake","river"].includes(t))||
      ["sea","beach","promenade","causeway","lake","river","coast"].some(w=>name.includes(w))) return "sea";
  if (tags.some(t=>["garden","park","forest","nature","trek"].includes(t))||
      ["garden","park","colony","forest","hill","trail","nature"].some(w=>name.includes(w))) return "park";
  // Shopping check before heritage — a shopping place is "shopping" even if its name has "walk"
  if (tags.some(t=>["shopping","browse","market","fashion","bazaar"].includes(t))||p.category==="shopping") return "shopping";
  if (tags.some(t=>["heritage","architecture","walk","historic","fort","spiritual"].includes(t))||
      ["heritage","walk","fort","temple","basilica","dargah","tank","mandir","ashram","mosque","church"].some(w=>name.includes(w))) return "heritage";
  if (p.indoor) return "indoor";
  return "outdoor";
}
function baseScore(p, ans, band, rem) {
  let s = 0;
  const FOODY = ["food","cafe","dessert"];
  const vibesWeight = FOODY.includes(p.category) ? 1 : 3;
  s += overlap(p.vibes??[], ans.personality) * vibesWeight;
  const allMoods = ans.moodList ?? [ans.mood];
  if ((p.moods??[]).some(m => allMoods.includes(m))) s += 2;
  if (p.bestTime === band || p.bestTime === "any") s += 2;
  if (["food","dessert"].includes(p.category)) s += overlap(p.cuisines??[], ans.foods) * 4;
  s += overlap(p.tags??[], LOVES);
  const cost = p.costPerPerson * 2;
  if (cost <= rem) s += 2; else if (cost > rem * 1.3) s -= 5;
  if (cost > 0 && rem > ans.budget * 0.2) {
    const budgetScale = ans.budget / 5000;
    const leftRatio   = rem / ans.budget;
    s += Math.min(budgetScale * 25, (p.costPerPerson / ans.budget) * 100 * budgetScale) * leftRatio;
  }
  if (ans.personality.includes("adventure")) s += (p.adventureLevel??0);
  if (ans.personality.includes("peaceful"))  s += 3 - (p.adventureLevel??0);
  if (p.rating) s += (p.rating - 3.6) * 3;
  if (p.source === "live") s += 2;
  return s;
}
function weightedPick(arr) {
  if (arr.length <= 1) return arr[0];
  const w = arr.map((_,i) => Math.pow(0.75, i));
  const sum = w.reduce((a,b)=>a+b,0);
  let r = Math.random() * sum;
  for (let i=0;i<arr.length;i++){r-=w[i];if(r<=0)return arr[i];}
  return arr[arr.length-1];
}
function detectCorridor(ans) {
  const p = ans.personality; const allMoods = ans.moodList ?? [ans.mood];
  const dayMins = ans.endMin - ans.startMin;
  const isRomantic = allMoods.some(m=>["romantic","anniversary"].includes(m));
  if (isRomantic && !p.includes("adventure"))
    return p.includes("culture")||p.includes("spiritual") ? "south_loop" : "bandra_hub";
  if (!ans.wetDay && p.includes("adventure") && ans.startMin<=480 && dayMins>=660) return "full_day_out";
  if (p.includes("adventure") && ans.startMin<=600 && dayMins>=480) return "north_adventure";
  if (p.includes("adventure")) return "thane_east";
  if (p.includes("culture")||p.includes("spiritual")||allMoods.includes("romantic")) return "south_loop";
  return "bandra_hub";
}

function isSpiritual(p) {
  const name = (p.name||"").toLowerCase();
  return (p.tags??[]).includes("spiritual") ||
    ["temple","mandir","ashram","mosque","church","basilica","gurudwara","dargah","iskcon","vitthal","sadbhakti"].some(w=>name.includes(w));
}

function stem(w) {
  if (w.endsWith("ies")&&w.length>4) return w.slice(0,-3)+"y";
  if (w.endsWith("es") &&w.length>4) return w.slice(0,-2);
  if (w.endsWith("s")  &&w.length>3) return w.slice(0,-1);
  return w;
}
function matchesRequest(p, requests) {
  if (!requests.length) return false;
  const tokens = [p.name, p.area, ...(p.tags??[]), ...(p.cuisines??[]), ...(p.vibes??[])]
    .join(" ").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem);
  return requests.some(term =>
    term.toLowerCase().split(/\s+/).map(stem).filter(w=>w.length>=3).some(w => tokens.some(t=>t===w))
  );
}

function pick(pool, ans, band, cats, used, zone, czones, atMin, rem, usedCuisines=new Set(), pending=[], recentEnvs=[], spirUsed=false, cuisineFilter) {
  let base = pool.filter(p =>
    cats.includes(p.category) && !used.has(p.id) && !blocked(p,ans) &&
    timeAllowed(p,atMin) && p.costPerPerson*2 <= rem &&
    (czones.includes(p.zone??"multiple")||(p.zone??"multiple")==="multiple") &&
    !(spirUsed && isSpiritual(p))
  );
  if (pending.length>0 && !base.some(p=>matchesRequest(p,pending))) {
    const wider = pool.filter(p =>
      cats.includes(p.category) && !used.has(p.id) && !blocked(p,ans) &&
      timeAllowed(p,atMin) && p.costPerPerson*2<=rem &&
      matchesRequest(p,pending) && !base.some(b=>b.id===p.id)
    );
    if (wider.length) base = [...base, ...wider];
  }
  if (!base.length) return null;
  if (cuisineFilter?.length) {
    const f = base.filter(p => overlap(p.cuisines??[], cuisineFilter)>0);
    if (f.length) base = f;
  }
  // Hard-exclude a second shopping trip or a second sea/waterfront stop — both are repetitive.
  if (recentEnvs.includes("shopping")) {
    const noShop = base.filter(p => environment(p) !== "shopping");
    if (noShop.length) base = noShop;
    else return null; // no non-shopping alternatives — skip this slot rather than doubling up
  }
  if (recentEnvs.includes("sea")) {
    const noSea = base.filter(p => environment(p) !== "sea");
    if (noSea.length) base = noSea;
    else return null; // all remaining options are sea — skip this slot
  }
  // Heritage: culture/spiritual plans can visit multiple sites; all others get one heritage stop max.
  const culturalDay = ans.personality.some(t=>["culture","spiritual"].includes(t));
  if (!culturalDay && recentEnvs.includes("heritage")) {
    const noHeritage = base.filter(p => environment(p) !== "heritage");
    if (noHeritage.length) base = noHeritage;
    else return null; // all remaining options are heritage — skip this slot
  }
  const FAR = new Set(["borivali","thane","south","vasai","karjat","kolad","gorai"]);
  const primaryFar = czones.find(z=>FAR.has(z));
  const ranked = base.map(p => {
    const z = p.zone??"multiple";
    let v = baseScore(p,ans,band,rem) - travelMin(zone,z,atMin)/8;
    if (z!=="multiple"&&z===zone) v += overlap(p.vibes??[],ans.personality)>0 ? 4 : 1;
    if (primaryFar&&z===primaryFar&&zone!==primaryFar) v+=6;
    const cr = overlap(p.cuisines??[], Array.from(usedCuisines));
    if (cr>0) v -= 8*cr;
    if (pending.length&&matchesRequest(p,pending)) v+=25;
    const env = environment(p);
    // "outdoor" is a catch-all — multiple outdoor activities per adventure day is expected.
    if (env!=="food"&&env!=="outdoor"&&recentEnvs.includes(env)&&!matchesRequest(p,pending)) {
      const li = recentEnvs.lastIndexOf(env);
      const d = recentEnvs.length-1-li;
      const envCount = recentEnvs.filter(e=>e===env).length;
      v -= Math.max(6, 22-d*2) * Math.min(envCount, 2);
    }
    v += (Math.random()-0.5)*5;
    return {p,v};
  }).sort((a,b)=>b.v-a.v);
  const top = ranked[0].v;
  const contenders = ranked.filter(r=>r.v>=top-10).slice(0,8).map(r=>r.p);
  const best = weightedPick(contenders);
  // Build alternatives: same category + zone first
  const bestZone = best.zone??"multiple";
  const allAlts = ranked.map(r=>r.p).filter(p=>p.id!==best.id);
  const sameCatAlts = allAlts.filter(p=>p.category===best.category);
  const sameZoneSameCat = sameCatAlts.filter(p=>(p.zone??"multiple")===bestZone);
  const sameZone = allAlts.filter(p=>(p.zone??"multiple")===bestZone);
  const alts = sameZoneSameCat.length>=1 ? sameZoneSameCat.slice(0,3)
             : sameCatAlts.length>=1 ? sameCatAlts.slice(0,3)
             : sameZone.length>=1 ? sameZone.slice(0,3)
             : allAlts.slice(0,3);
  return { place: best, alts };
}

function buildPlan(ans) {
  const used = new Set(), usedCuisines = new Set(), mealCuisines = new Set();
  const blocks = [], recentEnvs = [];
  let cursor = ans.startMin, zone = "home", cost = 0, lastMealEnd = 0, spirUsed = false;
  const corridor = detectCorridor(ans);
  const czones = CORRIDOR_ZONES[corridor];
  const end = ans.endMin, dayMins = end-ans.startMin;
  const FULL_MEALS = ["food","cafe"];
  const pending = [...(ans.mustInclude??[])];

  const freshFoodFilter = (base) => {
    if (!base?.length||!mealCuisines.size) return base;
    const f = base.filter(c=>!mealCuisines.has(c));
    return f.length>0 ? f : undefined;
  };

  const add = (res, kind) => {
    if (!res||cursor>=end) return;
    const {place:p, alts} = res;
    const z = p.zone??"multiple";
    const arr = cursor + travelMin(zone, z, cursor);
    if (arr+20>end) return;
    const isFullMeal = FULL_MEALS.includes(p.category);
    if (isFullMeal&&lastMealEnd>0&&arr-lastMealEnd<90) return;
    const c = p.costPerPerson*2;
    if (blocks.length>0&&c>0&&cost+c>ans.budget) return;
    used.add(p.id);
    const filteredAlts = (alts||[]).filter(a => timeAllowed(a, arr));
    blocks.push({ id:p.id, name:p.name, cat:p.category, zone:z, startMin:arr, endMin:arr+Math.min(p.durationMins,end-arr), cost:c, kind, env:environment(p), bestTime:p.bestTime, alts:filteredAlts });
    cost+=c; cursor=arr+Math.min(p.durationMins,end-arr);
    if(isFullMeal)lastMealEnd=cursor;
    (p.cuisines??[]).forEach(c=>usedCuisines.add(c));
    if(kind==="food")(p.cuisines??[]).forEach(c=>mealCuisines.add(c));
    if(isSpiritual(p))spirUsed=true;
    for(let i=pending.length-1;i>=0;i--) if(matchesRequest(p,[pending[i]]))pending.splice(i,1);
    if(z!=="multiple")zone=z;
    if(!FULL_MEALS.includes(p.category)&&p.category!=="rest"){
      recentEnvs.push(environment(p));
      if(recentEnvs.length>8)recentEnvs.shift();
    }
  };

  const b = ()=>bandFor(cursor);
  const rem = ()=>ans.budget-cost;
  const dinnerRes = ()=>end>1140?Math.floor(ans.budget*0.20):0;
  const pendingRes = ()=>{
    if(pending.length !== 1) return 0; // only reserve when exactly one request is pending
    const matches = PLACES.filter(p=>matchesRequest(p,pending)&&!used.has(p.id));
    if(!matches.length) return 0;
    return matches.reduce((mn,p)=>Math.min(mn,p.costPerPerson*2), Infinity)||0;
  };
  const actBudget = ()=>Math.max(0,rem()-dinnerRes()-pendingRes());
  const p = (cats,bud,cf)=>pick(PLACES,ans,b(),cats,used,zone,czones,cursor,bud,usedCuisines,pending,recentEnvs,spirUsed,cf);

  if(ans.startMin<660){
    add(p(["activity","experience"],actBudget()),"activity");
    add(p(["cafe"],Math.min(rem(),Math.max(800,Math.round(ans.budget*0.20)))),"cafe");
  }
  if(cursor<960&&end>780){
    add(p(["food"],actBudget(),undefined),"food"); // reserve dinner+pendingRes before picking lunch
  }
  if(end>840) add(p(["experience","activity","shopping"],actBudget()),"experience");
  // Second lunch: fires when early-morning café blocked the first food slot (meal spacing).
  // cursor>=600 catches adventure days (end=1080) where cursor rarely reaches 900.
  if(cursor>=600&&cursor<1050&&end>900&&end<=1140&&!blocks.some(bl=>bl.cat==="food")){
    add(p(["food"],actBudget(),undefined),"food");
  }
  if(dayMins>=360&&cursor<1080&&end>960) add(p(["experience","activity","shopping"],actBudget()),"activity");
  if(dayMins>=720&&cursor<1020&&end>1080) add(p(["experience","activity","shopping"],actBudget()),"experience");
  const homeRestOk = ["bandra_hub","thane_east","north_adventure"].includes(corridor);
  if(homeRestOk&&dayMins>=720&&cursor<960&&rem()>=2500&&blocks.length>=4&&["home","andheri_w","bandra"].includes(zone)){
    const rest=PLACES.find(p=>p.category==="rest");
    if(rest)add({place:rest,alts:[]},"rest");
  }
  // Pre-dinner must-include loop (attempt 1) — fires BEFORE evening when cursor is already ≥1080
  for(let _pi=0;_pi<3&&pending.length>0&&cursor>=1080&&end>1200&&cursor<end-160;_pi++){
    const _pc=cursor; add(p(["experience","activity"],rem()),"experience"); if(cursor===_pc)break;
  }
  if(end>1080&&!(end>1140&&(end-cursor)<180)) add(p(["activity","experience","shopping"],actBudget()),"activity");
  // Pre-dinner must-include loop (attempt 2) — catches plans where cursor was <1080 before evening
  for(let _pi=0;_pi<3&&pending.length>0&&cursor>=1080&&end>1200&&cursor<end-160;_pi++){
    const _pc=cursor; add(p(["experience","activity"],rem()),"experience"); if(cursor===_pc)break;
  }
  if(end>1140) add(p(["food"],rem(),freshFoodFilter(ans.foods)),"food");
  if(pending.length>0&&end>1200&&cursor<end-90) add(p(["experience","activity"],rem()),"experience");
  if(end-cursor>20) add(p(["dessert"],rem(),ans.foods),"dessert");
  return { blocks, cost, budget: ans.budget, corridor, pending };
}

// ── Test matrix ──────────────────────────────────────────────────────────────
const SCENARIOS = [
  { label:"shopper-queen 8am-10pm ₹5k",  ans:{ who:"Amruta",mood:"birthday",moodList:["birthday","romantic"],personality:["shopper","queen"],foods:["dessert"],budget:5000,startMin:480,endMin:1320,dayOfWeek:6,month:6,wetDay:false }},
  { label:"culture-south 10am-8pm ₹8k",  ans:{ who:"Amruta",mood:"romantic",moodList:["romantic"],personality:["culture","spiritual"],foods:["indian"],budget:8000,startMin:600,endMin:1200,dayOfWeek:3,month:6,wetDay:false }},
  { label:"adventure 6am-6pm ₹5k",       ans:{ who:"Amruta",mood:"adventure",moodList:["adventure"],personality:["adventure","peaceful"],foods:[],budget:5000,startMin:360,endMin:1080,dayOfWeek:6,month:2,wetDay:false }},
  { label:"foodie noon-midnight ₹10k",   ans:{ who:"Amruta",mood:"birthday",moodList:["birthday"],personality:["foodie","queen"],foods:["asian","dessert"],budget:10000,startMin:720,endMin:1440,dayOfWeek:6,month:0,wetDay:false }},
  { label:"artsy-playful 2pm-11pm ₹3k",  ans:{ who:"Amruta",mood:"chill",moodList:["chill"],personality:["artsy","playful"],foods:[],budget:3000,startMin:840,endMin:1380,dayOfWeek:6,month:3,wetDay:false,mustInclude:["Stand up comedy"]}},
  { label:"artsy-playful 2pm-11pm ₹5k",  ans:{ who:"Amruta",mood:"chill",moodList:["chill"],personality:["artsy","playful"],foods:[],budget:5000,startMin:840,endMin:1380,dayOfWeek:6,month:3,wetDay:false,mustInclude:["Arcade or gaming","Stand up comedy"]}},
  { label:"peaceful 10am-8pm ₹5k",       ans:{ who:"Amruta",mood:"chill",moodList:["chill"],personality:["peaceful","nature"],foods:[],budget:5000,startMin:600,endMin:1200,dayOfWeek:3,month:1,wetDay:false }},
  { label:"luxe 12pm-11pm ₹20k",         ans:{ who:"Amruta",mood:"anniversary",moodList:["anniversary","romantic"],personality:["luxe","queen"],foods:["continental","seafood"],budget:20000,startMin:720,endMin:1380,dayOfWeek:6,month:11,wetDay:false }},
];

const RUNS = 10; // runs per scenario to test variety

// ── Metrics ──────────────────────────────────────────────────────────────────
let totalPlans=0, budgetFailures=[], geoViolations=[], envDoubles=[], varietyFails=[], swapIssues=[], requestMisses=[];

for (const { label, ans } of SCENARIOS) {
  const plans = [];
  for (let r=0; r<RUNS; r++) {
    try { plans.push(buildPlan(ans)); } catch(e) { console.error("Build error:", label, e.message); }
  }
  totalPlans += plans.length;

  // 1. VARIETY: fingerprint = ordered list of non-food place IDs
  const fingerprints = plans.map(pl => pl.blocks.filter(b=>b.cat!=="food"&&b.cat!=="dessert"&&b.cat!=="cafe").map(b=>b.id).join("|"));
  const uniqueFPs = new Set(fingerprints);
  if (uniqueFPs.size < Math.ceil(RUNS * 0.6)) {
    varietyFails.push({ label, unique: uniqueFPs.size, runs: RUNS, fps: [...uniqueFPs] });
  }

  for (const pl of plans) {
    // 2. BUDGET ADHERENCE: plan should reach ≥ 70% of budget
    const pct = Math.round(pl.cost / pl.budget * 100);
    if (pl.budget >= 1000 && pct < 70) {
      budgetFailures.push({ label, budget: pl.budget, spent: pl.cost, pct, blocks: pl.blocks.map(b=>b.name).join(" → ") });
    }

    // 3. GEOGRAPHIC COHESION: no block in a zone far outside the corridor
    const allowedZones = new Set([...CORRIDOR_ZONES[pl.corridor], "home", "multiple"]);
    for (const b of pl.blocks) {
      if (b.zone !== "multiple" && !allowedZones.has(b.zone)) {
        geoViolations.push({ label, block: b.name, blockZone: b.zone, corridor: pl.corridor, allowed: [...allowedZones] });
      }
    }

    // 4. SAME-ENVIRONMENT DOUBLES: two non-food places with same environment
    // Exempt blocks that match mustInclude requests — user explicitly asked for both
    // (e.g. gaming + comedy are both "indoor"; that's expected, not a bug).
    const planPending = ans.mustInclude ?? [];
    const nonFoodBlocks = pl.blocks.filter(b=>!["food","cafe","dessert","rest"].includes(b.cat));
    const countableEnvBlocks = nonFoodBlocks.filter(b=>{
      const full = PLACES.find(pl=>pl.id===b.id);
      return !planPending.some(req=>full&&matchesRequest(full,[req]));
    });
    const envCounts = {};
    for (const b of countableEnvBlocks) envCounts[b.env] = (envCounts[b.env]??0)+1;
    for (const [env, cnt] of Object.entries(envCounts)) {
      // "outdoor"/"indoor": too generic to restrict (waterfall ≠ rocky banks; movie ≠ spa).
      // "park": too broad — an ashram with gardens and a lakeside walk are fine together.
      if (cnt >= 2 && env !== "food" && env !== "outdoor" && env !== "indoor" && env !== "park") {
        envDoubles.push({ label, env, count:cnt, plan: pl.blocks.map(b=>b.name+"["+b.env+"]").join(" → ") });
      }
    }

    // 5. SWAP COHERENCE: check each block's alternatives
    for (const b of pl.blocks.filter(bl=>bl.alts&&bl.alts.length>0)) {
      for (const alt of b.alts) {
        // Alt must be time-compatible with the block's start time
        if (!timeAllowed(alt, b.startMin)) {
          swapIssues.push({ label, block: b.name, alt: alt.name, issue: `time: alt bestTime=${alt.bestTime} but slot startMin=${b.startMin} (${bandFor(b.startMin)})` });
        }
        // Alt zone should be in corridor or same zone as original
        const altZone = alt.zone ?? "multiple";
        const corridorAllowed = [...CORRIDOR_ZONES[pl.corridor], "home","multiple"];
        if (altZone !== "multiple" && !corridorAllowed.includes(altZone)) {
          swapIssues.push({ label, block: b.name, alt: alt.name, issue: `zone: alt zone=${altZone} not in corridor ${pl.corridor}` });
        }
      }
    }

    // 6. PENDING REQUESTS: if user asked for something, it must be in the plan
    if (pl.pending?.length > 0) {
      requestMisses.push({ label, missing: pl.pending, plan: pl.blocks.map(b=>b.name).join(" → ") });
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────────
console.log(`\n╔══ Date Quest — Launch Readiness Audit ═════════════════════════╗`);
console.log(`  ${SCENARIOS.length} scenarios × ${RUNS} runs = ${totalPlans} plans`);
console.log(`╚════════════════════════════════════════════════════════════════╝\n`);

const section = (title, items, ok) => {
  const status = items.length === 0 ? "✅ PASS" : `❌ ${items.length} FAILURES`;
  console.log(`── ${title} ${status} ──`);
  if (items.length && !ok) {
    for (const i of items.slice(0,5)) {
      console.log("  •", JSON.stringify(i).slice(0,160));
    }
    if (items.length>5) console.log(`  … and ${items.length-5} more`);
  }
  console.log();
};

section("1. VARIETY (≥60% unique plans per scenario)", varietyFails);
section("2. BUDGET ADHERENCE (≥70% spent)", budgetFailures);
section("3. GEOGRAPHIC COHESION (all stops within corridor zones)", geoViolations);
section("4. SAME-ENVIRONMENT DOUBLES (no 2 beaches / 2 temples in same plan)", envDoubles);
section("5. SWAP COHERENCE (alternatives time+zone compatible)", swapIssues);
section("6. MUST-INCLUDE REQUESTS (all requested activities appear)", requestMisses);

// Summary score
const checks = [varietyFails, budgetFailures, geoViolations, envDoubles, swapIssues, requestMisses];
const passing = checks.filter(c=>c.length===0).length;
console.log(`\n══ OVERALL: ${passing}/6 checks passing ══\n`);

// Detailed env doubles for fixing
if (envDoubles.length) {
  console.log("ENV DOUBLES DETAIL (unique scenarios):");
  const seen = new Set();
  for (const d of envDoubles) {
    const k = d.env+"@"+d.label;
    if (!seen.has(k)) { seen.add(k); console.log(`  ${d.env} x${d.count} in ${d.label}`); }
  }
}
if (swapIssues.length) {
  console.log("\nSWAP ISSUES DETAIL (first 10):");
  for (const s of swapIssues.slice(0,10)) {
    console.log(`  block:"${s.block}" alt:"${s.alt}" → ${s.issue}`);
  }
}
