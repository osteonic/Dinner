// Checks a week's plan file before it is committed.
// Usage: node tools/check-plan.mjs data/plans/2026-11-22.json
// Exits 1 and lists every problem if the file would break the app.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

// The 28 recipes in data/recipes.enc.json. Excluded recipes (#8, #22, #23) are not here.
const IDS = new Set([
  'lemon-chicken-and-brown-rice-pilaf', 'weeknight-chicken-souvlaki', 'seafood-fried-brown-rice',
  'shrimp-quesadillas-with-stuffed-avocados', 'spicy-peanut-chicken-and-vegetables',
  'dijon-maple-chicken-with-brussels-and-butternut', 'caprese-portobello-pizzas',
  'tandoori-chicken-with-vegetables', 'ginger-lime-chicken-with-broccoli-and-carrots', 'carne-asada-fries',
  'garlic-turmeric-salmon-with-rainbow-carrots-cauliflower-and-lemon',
  'curry-roasted-vegetables-and-chickpeas-with-mint-cilantro-chutney', 'chicken-and-lentil-soup', 'coq-au-vin',
  'white-chicken-chili-with-hominy', 'coconut-chicken-and-butternut-curry-in-a-hurry', 'chicken-tortilla-soup',
  'caldo-de-papa-potato-and-short-rib-soup', 'american-style-cheesy-beef-goulash-and-macaroni',
  'glazed-korean-bbq-chicken-wings', 'creamy-butternut-pasta-with-spicy-sausage-and-spinach',
  'gnocchi-with-sausage-and-garlicky-broccoli-rabe', 'chicken-fajita-pasta',
  'loaded-buffalo-chicken-stuffed-sweet-potatoes', 'chipotle-chicken-tostadas',
  'honey-balsamic-grilled-chicken-and-vegetables', 'shawarma-spiced-grilled-chicken-thighs-with-tahini',
  'pot-roast-with-potatoes-and-vegetables',
]);
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SECTIONS = ['Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Canned & Dry', 'Frozen', 'Bakery & Tortillas'];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const str = (v) => typeof v === 'string' && v.trim() !== '';

const file = process.argv[2];
if (!file) { console.error('Usage: node tools/check-plan.mjs data/plans/YYYY-MM-DD.json'); process.exit(1); }
const errs = [];
let p;
try { p = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error(`Not valid JSON: ${e.message}`); process.exit(1); }

const week = basename(file, '.json');
if (p.week !== week) errs.push(`"week" is ${JSON.stringify(p.week)} but the file is named ${week}.json`);
const d = new Date(`${week}T12:00:00Z`);
if (Number.isNaN(d.getTime()) || d.getUTCDay() !== 0) errs.push(`${week} is not a Sunday`);
for (const k of ['label', 'summary']) if (!str(p[k])) errs.push(`"${k}" is missing`);

// Holidays get no recipes: the household makes its own special meal. Keep in step with holidayOn() in app.js.
function holidayOn(date) {
  const y = date.getUTCFullYear(), m = date.getUTCMonth(), d = date.getUTCDate();
  if (m === 11 && d === 24) return 'Christmas Eve';
  if (m === 11 && d === 25) return 'Christmas';
  if (m === 11 && d === 31) return "New Year's Eve";
  if (m === 10 && date.getUTCDay() === 4 && d >= 22 && d <= 28) return 'Thanksgiving';
  const [em, ed] = easter(y);
  if (m === em && d === ed) return 'Easter';
  return null;
}
// Western Easter Sunday (anonymous Gregorian algorithm) → [monthIndex, day]
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return [Math.floor(n / 31) - 1, (n % 31) + 1];
}

if (!Array.isArray(p.days) || p.days.length !== 7) errs.push('"days" must list all 7 days');
else p.days.forEach((day, i) => {
  if (day.day !== DAYS[i]) errs.push(`days[${i}] should be ${DAYS[i]}, not ${JSON.stringify(day.day)}`);
  const date = new Date(d.getTime() + i * 86400000);
  const hol = Number.isNaN(d.getTime()) ? null : holidayOn(date);
  if (hol) {
    if (day.holiday !== hol || day.a || day.b) {
      errs.push(`${DAYS[i]} is ${hol}: it must be exactly {"day": "${DAYS[i]}", "holiday": "${hol}"}, with no recipes`);
    }
    return;
  }
  if (day.holiday) { errs.push(`${DAYS[i]} is marked as a holiday ("${day.holiday}") but isn't Thanksgiving or Christmas`); return; }
  for (const opt of ['a', 'b']) {
    const o = day[opt];
    const where = `${DAYS[i]} ${opt.toUpperCase()}`;
    if (!o || !str(o.id) || !str(o.name) || !str(o.time)) { errs.push(`${where} needs id, name and time`); continue; }
    if (!IDS.has(o.id)) errs.push(`${where}: unknown recipe id "${o.id}"`);
    if (slug(o.name) !== o.id) errs.push(`${where}: id "${o.id}" does not match name "${o.name}"`);
  }
  if (!str(day.protein)) errs.push(`${DAYS[i]}: "protein" is missing`);
});

if (!Array.isArray(p.grocery) || !p.grocery.length) errs.push('"grocery" is missing');
else p.grocery.forEach((g) => {
  if (!SECTIONS.includes(g.section)) errs.push(`unknown grocery section ${JSON.stringify(g.section)}`);
  if (!Array.isArray(g.items) || !g.items.length) errs.push(`grocery section ${g.section} has no items`);
  else g.items.forEach((it) => { if (!str(it) || !it.includes(' — ')) errs.push(`grocery item not "name — quantity": ${JSON.stringify(it)}`); });
});
if (!Array.isArray(p.pantry)) errs.push('"pantry" must be a list');

if (errs.length) { console.error(`${file}: ${errs.length} problem(s)\n- ${errs.join('\n- ')}`); process.exit(1); }
console.log(`${file}: OK`);
