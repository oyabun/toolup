// Icons for things that have no brand logo: a gradient tile with a line drawing chosen from what the thing is about.
// The colour and the drawing depend only on the item's name and category, so an item always looks the same.
import { GLYPHS } from "./glyphs.ts";

// the first rule whose words appear in the name wins, then the description; the category decides otherwise
const RULES: [RegExp, string][] = [
  [/\b(tdd|test|verify|verification|qa|checklist)/, "list-checks"],
  [/\b(debug|diagnos|bug|recover|performance|profil|monitor|observab)/, "activity"],
  [/\b(security|harden|auth|secret|permission)/, "lock"],
  [/\b(review|audit|critique|inspect|find|search|research)/, "search"],
  [/\b(video|motion|animat|frame|remotion)/, "clapperboard"],
  [/\b(film|media|image|photo|screenshot)/, "film"],
  [/\b(design|taste|ui|ux|morphism|brutalis|bento|editorial|minimal|dither|typograph|color|theme|brand)/, "cat-design"],
  [/\b(architect|domain|model|structure|prototype|scaffold)/, "layers"],
  [/\b(database|postgres|sql|data|schema|migration)/, "database"],
  [/\b(browser|web|seo|site|page|crawl|scrape)/, "globe"],
  [/\b(doc|pdf|write|writing|copy|content|blog|article|spec|plan|note|report)/, "file-text"],
  [/\b(grill|brainstorm|interview|chat|message|email|feedback|handoff)/, "message-square"],
  [/\b(pricing|pay|billing|revenue|checkout)/, "cat-pay"],
  [/\b(market|growth|sales|launch|ads?|campaign|funnel|conversion|churn|referral|analytics)/, "cat-biz"],
  [/\b(ai|prompt|agent|llm|model)/, "sparkles"],
  [/\b(deploy|ship|release|cloud|infra|docker|kubernetes)/, "cat-cloud"],
  [/\b(code|refactor|simplif|commit|git|typescript|react|api|sdk|cli)/, "code-xml"],
  [/\b(schedule|time|cron|remind)/, "clock"],
  [/\b(install|package|bundle|plugin)/, "box"],
];

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** A gradient icon. `cls` adds size and shape classes ("round", "mini", "big" ...). */
export function coolIcon(name: string, about: string, cat: string | undefined, fallback: string, cls = "") {
  // what it is called says more than how it is described, so the name is tried first
  const rule = (text: string) => RULES.find(([re]) => re.test(text.toLowerCase()))?.[1];
  const glyph = rule(name) || rule(about) || (cat && GLYPHS[`cat-${cat}`] ? `cat-${cat}` : fallback);
  const h = hash(name) % 360;
  return `<span class="ico cool ${cls}" style="--h:${h}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[glyph] || GLYPHS[fallback]}</svg></span>`;
}
