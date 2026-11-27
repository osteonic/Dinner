// Dinner Plan — static app for GitHub Pages. No build step.
const $ = (s) => document.querySelector(s);
const view = $('#view');
const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// ---------- text polish ----------
const FRAC = { '1/2': '½', '1/3': '⅓', '2/3': '⅔', '1/4': '¼', '3/4': '¾', '1/8': '⅛', '3/8': '⅜' };
const FRAC_RE = '(1/2|1/3|2/3|1/4|3/4|1/8|3/8)(?![\\d/])';
const frac = (s) => String(s ?? '')
  .replace(new RegExp(`(\\d+) ${FRAC_RE}`, 'g'), (m, w, f) => w + FRAC[f])
  .replace(new RegExp(`(?<![\\d/])${FRAC_RE}`, 'g'), (f) => FRAC[f]);
const cap = (s) => String(s ?? '').replace(/^(\W*)([a-z])/, (m, pre, c) => pre + c.toUpperCase());
// "1 (15-oz) can chickpeas, drained" → ["1 (15-oz) can", "Chickpeas, drained"]; no leading amount → [null, text]
const UNITS = 'Tbsp|tsp|cups?|oz|lbs?|pinch|cloves?|slices?|sprigs?|bunch|heads?|cans?|stalks?|links?|bags?';
const QTY_RE = new RegExp(`^((?:\\d[\\d½⅓⅔¼¾⅛⅜.\\/–-]*|[½⅓⅔¼¾⅛⅜])(?:\\s*\\([^)]*\\))?(?:\\s+(?:${UNITS})\\b\\.?)?(?:\\s*\\([^)]*\\))?)\\s+(\\S.*)$`, 'i');
function splitQty(text) {
  const t = frac(text);
  const m = t.match(QTY_RE);
  return m ? [m[1].replace(/-/g, '‑'), cap(m[2])] : [null, cap(t)];   // non-breaking hyphen keeps "15-oz" whole
}
const CHEV = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------- dates ----------
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sundayOf = (d) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -d.getDay());
const fmt = (d, o) => d.toLocaleDateString('en-US', o);
// Holidays get no planned dinner: the household cooks its own special meal.
function holidayOn(d) {
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
  if (m === 11 && day === 24) return 'Christmas Eve';
  if (m === 11 && day === 25) return 'Christmas';
  if (m === 11 && day === 31) return "New Year's Eve";
  if (m === 10 && d.getDay() === 4 && day >= 22 && day <= 28) return 'Thanksgiving';
  const [em, ed] = easter(y);
  if (m === em && day === ed) return 'Easter';
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
// ---------- data ----------
const state = { plans: {}, recipes: null, enc: null, today: new Date() };

async function fetchJSON(url) {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
async function loadPlans() {
  const sun = sundayOf(state.today);
  const [cur, next] = await Promise.all([
    fetchJSON(`data/plans/${iso(sun)}.json`),
    fetchJSON(`data/plans/${iso(addDays(sun, 7))}.json`),
  ]);
  state.plans = { cur, next };
}

// ---------- recipes (encrypted at rest in the repo) ----------
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function decrypt(enc, pass) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass.trim().toLowerCase()), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(enc.salt), iterations: enc.iter }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}
const sig = (enc) => enc ? `${enc.iv}:${enc.ct.length}` : null;
async function loadRecipes() {
  state.enc = await fetchJSON('data/recipes.enc.json');
  const cached = LS.get('dp.recipes');
  if (cached && cached.sig === sig(state.enc)) { state.recipes = cached.data; return; }
  const pass = LS.get('dp.pass');
  if (pass && state.enc) {
    try { await unlock(pass, false); } catch { /* passphrase changed: ask again */ }
  }
}
async function unlock(pass, announce = true) {
  if (!state.enc) state.enc = await fetchJSON('data/recipes.enc.json');
  const data = await decrypt(state.enc, pass);
  state.recipes = data;
  LS.set('dp.pass', pass.trim().toLowerCase());
  LS.set('dp.recipes', { sig: sig(state.enc), data });
  if (announce) toast('Recipes unlocked on this phone');
}

// ---------- ui helpers ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
function header(title, sub = '', back = null) {
  $('#title').textContent = title;
  $('#title').classList.toggle('long', title.length > 30);
  $('#subtitle').textContent = sub;
  const b = $('#back');
  if (back) { b.hidden = false; b.href = back; } else b.hidden = true;
  document.title = title === 'Dinner' ? 'Dinner Plan' : `${title} · Dinner Plan`;
}
function setTab(name) {
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.tab === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}
const optCard = (o, letter, back) => `
  <a class="card opt ${letter === 'B' ? 'b' : 'a'}" href="#/r/${esc(o.id)}?from=${encodeURIComponent(back)}">
    <div>
      <div class="eyebrow">Option ${letter} · ${letter === 'B' ? 'Bigger cook' : 'Quicker'}</div>
      <h3>${esc(o.name)}</h3>
      <div class="time">${esc(frac(o.time))}</div>
    </div>
    ${CHEV}
  </a>`;
const miniRow = (o, letter, back) => `
  <a class="mini" href="#/r/${esc(o.id)}?from=${encodeURIComponent(back)}"><b class="${letter === 'B' ? 'b' : ''}">${letter}</b><span>${esc(o.name)}</span><em>${esc(o.time)}</em></a>`;

// ---------- views ----------
function renderTonight() {
  setTab('tonight');
  const d = state.today;
  header('Tonight', fmt(d, { weekday: 'long', month: 'long', day: 'numeric' }));
  const { cur, next } = state.plans;
  const dayName = DAYS[d.getDay()];
  let html = '';
  if (!cur) {
    html = `<div class="empty">No plan for this week yet.<br>It's added each Saturday morning.</div>`;
  } else {
    const today = cur.days.find((x) => x.day === dayName);
    const hol = today?.holiday || holidayOn(d);
    if (hol) {
      html += `<div class="card holiday"><div class="eyebrow">${esc(hol)}</div><h3>Happy ${esc(hol)}!</h3><p>No plan tonight: enjoy the holiday meal.</p></div>`;
      if (today?.a && today?.b) {   // a plan made before holidays were skipped: keep its options within reach
        html += `<details class="card flush pantry"><summary>If plans change<span>2 options</span></summary><div class="hol-opts">${miniRow(today.a, 'A', '#/')}${miniRow(today.b, 'B', '#/')}</div></details>`;
      }
    } else if (today?.a) {
      html += `<div class="section-label">Pick one</div>`;
      html += optCard(today.a, 'A', '#/') + optCard(today.b, 'B', '#/');
      if (today.prep) html += `<div class="note"><strong>Prep</strong>${esc(frac(today.prep))}</div>`;
    }
    const tmrwPlan = d.getDay() === 6 ? next : cur;
    const tmrw = tmrwPlan?.days.find((x) => x.day === DAYS[(d.getDay() + 1) % 7]);
    const tmrwHol = tmrw?.holiday || holidayOn(addDays(d, 1));
    if (tmrwHol) {
      html += `<div class="section-label">Tomorrow · ${esc(DAYS[(d.getDay() + 1) % 7])}</div><div class="note"><strong>${esc(tmrwHol)}</strong>No plan: it's your holiday meal.</div>`;
    } else if (tmrw?.a) {
      html += `<div class="section-label">Tomorrow · ${esc(tmrw.day)}</div><div class="card day">${miniRow(tmrw.a, 'A', '#/')}${miniRow(tmrw.b, 'B', '#/')}</div>`;
      if (tmrw.prep) html += `<div class="note"><strong>Tomorrow's prep</strong>${esc(frac(tmrw.prep))}</div>`;
    }
  }
  if (next) html += `<a class="card promo" href="#/groceries"><div><strong>Next week is planned</strong><span class="muted">${esc(next.label)} · open the grocery list</span></div>${CHEV}</a>`;
  if (!state.recipes) html += lockedNote();
  view.innerHTML = html;
}

function weekPicker(active) {
  const { cur, next } = state.plans;
  if (!cur || !next) return '';
  return `<div class="seg" role="group" aria-label="Week">
    <button data-w="cur" aria-pressed="${active === 'cur'}">This week</button>
    <button data-w="next" aria-pressed="${active === 'next'}">Next week</button></div>`;
}
function bindWeekPicker(route) {
  view.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { location.hash = `${route}?w=${b.dataset.w}`; }));
}

function renderWeek(params) {
  setTab('week');
  const which = params.get('w') === 'next' && state.plans.next ? 'next' : 'cur';
  const plan = state.plans[which];
  header(which === 'next' ? 'Next week' : 'This week', plan ? plan.label : '');
  if (!plan) { view.innerHTML = `<div class="empty">No plan for this week yet.</div>`; return; }
  const sun = new Date(plan.week + 'T12:00:00');
  const todayIso = iso(state.today);
  const back = `#/week${which === 'next' ? '?w=next' : ''}`;
  let html = weekPicker(which);
  plan.days.forEach((x, i) => {
    const date = addDays(sun, i);
    const hol = x.holiday || holidayOn(date);
    html += `<div class="card day ${iso(date) === todayIso ? 'today' : ''} ${hol ? 'is-holiday' : ''}">
      <div class="day-head"><h3>${esc(x.day)}${hol ? ` <span class="tag">${esc(hol)}</span>` : ''}</h3><span>${fmt(date, { month: 'short', day: 'numeric' })}</span></div>
      ${hol ? `<p class="hol-line">Holiday meal: no plan.</p>` : `${miniRow(x.a, 'A', back)}${miniRow(x.b, 'B', back)}`}
    </div>`;
  });
  view.innerHTML = html;
  bindWeekPicker('#/week');
}

function renderGroceries(params) {
  setTab('groceries');
  const { cur, next } = state.plans;
  // Default to next week's list once it exists (Saturday onward); the toggle can switch back.
  const which = next && params.get('w') !== 'cur' ? 'next' : 'cur';
  const plan = state.plans[which];
  header('Groceries', plan ? `For ${plan.label}` : '');
  if (!plan) { view.innerHTML = `<div class="empty">No grocery list yet.</div>`; return; }
  const key = `dp.g.${plan.week}`;
  const checked = new Set(LS.get(key, []));
  const all = plan.grocery.flatMap((s) => s.items);
  let html = weekPicker(which);
  html += `<div class="progress" id="gp"><div class="bar"><i></i></div><span></span></div>`;
  html += `<div class="row"><button class="btn small" id="copy">Copy remaining</button><button class="btn small ghost" id="reset">Uncheck all</button></div>`;
  plan.grocery.forEach((sec) => {
    html += `<div class="section-label">${esc(sec.section)}<span>${sec.items.length}</span></div><ul class="list card flush">`;
    sec.items.forEach((it) => {
      const [name, rawQty = ''] = it.split(' — ');
      const sugg = /\(suggestion\)\s*$/i.test(rawQty);   // only needed if she follows the guideline suggestions
      const qty = rawQty.replace(/\s*\(suggestion\)\s*$/i, '');
      html += `<li><label class="check"><input type="checkbox" value="${esc(it)}" ${checked.has(it) ? 'checked' : ''}><span class="box"></span><span class="lbl">${esc(cap(frac(name)))}${sugg ? ' <span class="tag sg">Suggestion</span>' : ''}${qty ? `<span class="qty">${esc(frac(qty))}</span>` : ''}</span></label></li>`;
    });
    html += `</ul>`;
  });
  if (plan.pantry?.length) {
    html += `<details class="card flush pantry"><summary>Check the pantry<span>${plan.pantry.length}</span></summary><ul class="list">${plan.pantry.map((p) => `<li class="plain">${esc(cap(frac(p)))}</li>`).join('')}</ul>${plan.pantryNote ? `<p class="muted pantry-note">${esc(plan.pantryNote)}</p>` : ''}</details>`;
  }
  view.innerHTML = html;
  bindWeekPicker('#/groceries');
  const progress = () => {
    const n = all.filter((it) => checked.has(it)).length;
    $('#gp i').style.width = `${all.length ? (100 * n) / all.length : 0}%`;
    $('#gp span').textContent = n === all.length && n ? 'All done' : `${n} of ${all.length} in the cart`;
  };
  progress();
  view.querySelectorAll('input[type=checkbox]').forEach((c) => c.addEventListener('change', () => {
    c.checked ? checked.add(c.value) : checked.delete(c.value);
    LS.set(key, [...checked]);
    progress();
  }));
  $('#reset').addEventListener('click', () => { checked.clear(); LS.set(key, []); renderGroceries(params); });
  $('#copy').addEventListener('click', async () => {
    const lines = plan.grocery.flatMap((s) => s.items).filter((it) => !checked.has(it));
    try { await navigator.clipboard.writeText(lines.join('\n')); toast(`Copied ${lines.length} items — paste into Reminders`); }
    catch { toast('Copy failed — long-press to select instead'); }
  });
}

function lockedNote() {
  return `<div class="note"><strong>Recipes are locked on this phone.</strong> Open the unlock link once, or <a href="#/unlock">enter the passphrase</a>.</div>`;
}

function renderRecipe(id, params) {
  const from = params.get('from') || '#/';
  setTab(from.startsWith('#/week') ? 'week' : from.startsWith('#/groceries') ? 'groceries' : from.startsWith('#/recipes') ? 'recipes' : 'tonight');
  const r = state.recipes?.[id];
  if (!r) {
    const name = Object.values(state.plans).flatMap((p) => p?.days ?? []).flatMap((d) => [d.a, d.b]).find((o) => o.id === id)?.name ?? 'Recipe';
    header(name, '', from);
    view.innerHTML = state.recipes ? `<div class="empty">This recipe isn't in the library.</div>` : lockedNote();
    return;
  }
  header(r.name, r.book || '', from);
  const done = new Set(JSON.parse(sessionStorage.getItem(`dp.r.${id}`) || '[]'));
  const f = recipeFacts(r);
  let html = `<div class="facts">${f.cells.map(([k, v]) => `<div><span>${k}</span><b>${esc(frac(v))}</b></div>`).join('')}</div>`;
  if (f.tags.length) html += `<div class="tags">${f.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>`;
  // The printed recipe is shown untouched; suggestions are woven in as green extras she can hide.
  const groups = mergedIngredients(r);
  const hasExtras = groups.some((g) => g.items.some((it) => it.extra || it.change));
  const printedCount = r.ingredients.reduce((n, g) => n + g.items.length, 0);
  const extraCount = groups.reduce((n, g) => n + g.items.filter((it) => it.extra).length, 0);
  html += `<div class="section-label">Ingredients<span>${printedCount}${extraCount ? ` <em class="xcount">+ ${extraCount} extra</em>` : ''}</span></div>`;
  if (hasExtras) {
    html += `<div class="legend"><span class="swatch"></span><span>Green = extras to meet the guidelines</span>
      <button class="switch" id="xtoggle" type="button" role="switch" aria-checked="true">Show extras</button></div>`;
  }
  html += `<div class="card flush ings">`;
  groups.forEach((g, gi) => {
    if (g.group) html += `<div class="ing-group${g.extra ? ' xgroup' : ''}">${esc(g.group)}${g.extra ? ' <span class="tag sg">Extra</span>' : ''}</div>`;
    html += `<ul class="list${g.extra ? ' xgroup' : ''}">${g.items.map((it, ii) => {
      const key = `${it.extra ? 'x' : 'o'}${gi}.${ii}`;
      const [qty, name] = splitQty(it.text);
      return `<li class="${it.extra ? 'extra' : ''}"><label class="check ing"><input type="checkbox" data-i="${key}" ${done.has(key) ? 'checked' : ''}><span class="box"></span>${qty ? `<span class="q">${esc(qty)}</span>` : ''}<span class="lbl${qty ? '' : ' wide'}">${esc(name)}${it.extra && !g.extra ? ' <span class="tag sg">Extra</span>' : ''}${it.change ? `<span class="chg">${esc(cap(frac(it.change)))}</span>` : ''}</span></label></li>`;
    }).join('')}</ul>`;
  });
  // Lines like "Stovetop: …" or "Oven: …" are the book's alternate method, not a numbered step.
  const isAlt = (s) => /^(Stovetop|Oven)\s*:|^Variation\b/i.test(s);   // "Oven 450°F." is a real step; "Oven: …" is the alternate
  const steps = mergedSteps(r);
  const main = steps.filter((s) => s.extra || !isAlt(s.text)), alts = steps.filter((s) => !s.extra && isAlt(s.text));
  const printedSteps = main.filter((s) => !s.extra).length;
  html += `</div><div class="section-label">Method<span>${printedSteps} steps</span></div><ol class="steps">${main.map((s) => s.extra
    ? `<li class="xstep"><span class="xtra">${esc(cap(frac(s.text)))}</span></li>`
    : `<li>${esc(cap(frac(s.text)))}${s.append.length ? ` <span class="xtra">${esc(s.append.map((a) => cap(frac(a))).join(' '))}</span>` : ''}</li>`).join('')}</ol>`;
  alts.forEach((s) => { html += `<div class="note"><strong>${esc(s.text.match(/^(\w+)/)[1])}</strong>${esc(cap(frac(s.text.replace(/^\w+\s*[:—–-]\s*/, ''))))}</div>`; });
  html += suggestionsCard(r);
  view.innerHTML = html;
  view.querySelectorAll('input[type=checkbox]').forEach((c) => c.addEventListener('change', () => {
    const i = c.dataset.i; c.checked ? done.add(i) : done.delete(i);
    try { sessionStorage.setItem(`dp.r.${id}`, JSON.stringify([...done])); } catch { /* ignore */ }
  }));
  const applyExtras = (on) => {
    view.classList.toggle('hide-extras', !on);
    const b = $('#xtoggle'); if (b) { b.setAttribute('aria-checked', String(on)); b.textContent = on ? 'Show extras' : 'Original only'; }
  };
  applyExtras(LS.get('dp.extras', true));
  $('#xtoggle')?.addEventListener('click', () => { const on = view.classList.contains('hide-extras'); LS.set('dp.extras', on); applyExtras(on); });
  window.scrollTo(0, 0);
}

// ---------- recipe browser ----------
const GROUPINGS = {
  book: { label: 'Book', of: (r) => r.book || 'Other recipes' },
  type: { label: 'Protein', of: (r) => r.type || 'Other', order: ['Chicken', 'Beef', 'Seafood', 'Vegetarian'] },
  method: { label: 'Method', of: (r) => methodOf(r) },
};
const methodOf = (r) => (String(r.meta || '').split(' · ')[1] || 'Other').replace(/\s+[\d–-]+\s*h\b.*$/, '').trim();
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const allIngredients = (r) => (r.ingredients || []).flatMap((g) => g.items || []);
const plannedIds = () => new Set(Object.values(state.plans).flatMap((p) => p?.days ?? []).flatMap((d) => [d.a?.id, d.b?.id]));

// Every word of the query must appear somewhere in the recipe. Returns null (no match),
// or the first ingredient that matched when the name alone didn't, to show why it's listed.
function matchRecipe(r, words) {
  if (!words.length) return { via: null };
  const head = norm([r.name, r.book, r.type, methodOf(r), r.meta].join(' '));
  const ings = [...allIngredients(r), ...(r.suggestions?.items || [])];
  const hay = head + ' ' + norm(ings.join(' '));
  if (!words.every((w) => hay.includes(w))) return null;
  if (words.every((w) => head.includes(w))) return { via: null };
  return { via: ings.find((it) => words.some((w) => !head.includes(w) && norm(it).includes(w))) || null };
}

function renderRecipes(params) {
  setTab('recipes');
  const by = GROUPINGS[params.get('by')] ? params.get('by') : 'book';
  const q = params.get('q') || '';
  const total = state.recipes ? Object.keys(state.recipes).length : 0;
  header('Recipes', total ? `${total} recipes` : '');
  if (!state.recipes) { view.innerHTML = lockedNote(); return; }
  view.innerHTML = `
    <input class="text search" id="rq" type="search" placeholder="Search recipes or ingredients" value="${esc(q)}"
      autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="search" aria-label="Search recipes">
    <div class="seg" role="group" aria-label="Group by">
      ${Object.entries(GROUPINGS).map(([k, g]) => `<button data-by="${k}" aria-pressed="${k === by}">${g.label}</button>`).join('')}
    </div>
    <div id="rlist"></div>`;
  const input = $('#rq');
  const draw = () => {
    const query = input.value;
    const back = `#/recipes?by=${by}${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ''}`;
    history.replaceState(null, '', location.pathname + back);   // so Back from a recipe returns to this search
    $('#rlist').innerHTML = recipeList(by, query, back);
  };
  input.addEventListener('input', draw);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  view.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    const query = input.value.trim();
    location.hash = `#/recipes?by=${b.dataset.by}${query ? `&q=${encodeURIComponent(query)}` : ''}`;
  }));
  draw();
}

function recipeList(by, query, back) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  const planned = plannedIds();
  const g = GROUPINGS[by];
  const groups = new Map();
  Object.entries(state.recipes)
    .map(([id, r]) => ({ id, r, m: matchRecipe(r, words) }))
    .filter((x) => x.m)
    .sort((a, b) => a.r.name.localeCompare(b.r.name))
    .forEach((x) => { const k = g.of(x.r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); });
  if (!groups.size) return `<div class="empty">No recipes match “${esc(query.trim())}”.</div>`;
  const order = g.order || [];
  const keys = [...groups.keys()].sort((a, b) => ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)) || a.localeCompare(b));
  const count = [...groups.values()].reduce((n, xs) => n + xs.length, 0);
  let html = words.length ? `<p class="muted result-count">${count} match${count === 1 ? '' : 'es'}</p>` : '';
  keys.forEach((k) => {
    const xs = groups.get(k);
    html += `<div class="section-label">${esc(k)} · ${xs.length}</div><div class="card rlist">`;
    html += xs.map(({ id, r, m }) => `
      <a class="ritem" href="#/r/${esc(id)}?from=${encodeURIComponent(back)}">
        <span class="rname">${esc(r.name)}${planned.has(id) ? ' <span class="tag">Planned</span>' : ''}</span>
        <span class="rmeta">${esc(by === 'book' ? `${r.type || ''} · ${methodOf(r)}` : by === 'type' ? `${methodOf(r)} · ${r.book || ''}` : `${r.type || ''} · ${r.book || ''}`)}</span>
        ${m.via ? `<span class="rvia">Has ${esc(splitQty(m.via)[1].toLowerCase())}</span>` : ''}
        ${CHEV}
      </a>`).join('');
    html += `</div>`;
  });
  return html;
}

// Printed ingredient groups with the suggestions woven in: changed lines carry a note, extras are flagged.
function mergedIngredients(r) {
  const ops = r.suggestions?.ingredients || [];
  const groups = r.ingredients.map((g) => ({ group: g.group, items: g.items.map((text) => ({ text })) }));
  ops.filter((o) => o.change).forEach((o) => groups.forEach((g) => g.items.forEach((it) => { if (it.text === o.change) it.change = o.to; })));
  ops.filter((o) => o.add).forEach((o) => {
    const item = { text: o.add, extra: true };
    const target = o.after && groups.find((g) => g.items.some((it) => it.text === o.after));
    if (target) { target.items.splice(target.items.findIndex((it) => it.text === o.after) + 1, 0, item); return; }
    ((o.group && groups.find((g) => g.group === o.group)) || groups[0]).items.push(item);
  });
  ops.filter((o) => o.addGroup).forEach((o) => groups.push({ group: o.addGroup, extra: true, items: o.items.map((text) => ({ text, extra: true })) }));
  return groups;
}
// Printed steps with green additions: text appended inside a step, or an extra step after it.
function mergedSteps(r) {
  const ops = r.suggestions?.steps || [];
  const out = ops.filter((o) => o.after === 0).map((o) => ({ text: o.text, extra: true }));
  r.steps.forEach((text, i) => {
    out.push({ text, append: ops.filter((o) => o.step === i + 1).map((o) => o.append) });
    ops.filter((o) => o.after === i + 1).forEach((o) => out.push({ text: o.text, extra: true }));
  });
  return out;
}

// The recipe above stays exactly as printed; this card says what to add or change to meet the guidelines.
const GUIDELINES = 'fiber 9 g or more, sodium 800 mg or less, and at least 1 cup of vegetables per serving';
function suggestionsCard(r) {
  const s = r.suggestions || { items: [] };
  const printed = r.nutrition ? `<div><span>${esc(/as \d/.test(r.nutrition.label) ? `As printed (${r.nutrition.label.match(/as \d+/)[0]})` : 'As printed')}</span><b>${esc(frac(r.nutrition.value))}</b></div>` : '';
  let html = `<div class="section-label">Suggestions<span>for the guidelines</span></div><div class="card suggest">`;
  if (!s.items.length) {
    html += `<p class="ok">Meets the guidelines as printed. No changes needed.</p>`;
  } else {
    html += `<p class="lead">To reach ${GUIDELINES}:</p><ul class="sugg">${s.items.map((it) => `<li>${esc(cap(frac(it)))}</li>`).join('')}</ul>`;
  }
  html += `<div class="nut">${printed}${s.outcome ? `<div><span>With suggestions</span><b>${esc(cap(frac(s.outcome)))}</b></div>` : ''}</div></div>`;
  return html;
}

// "Serves 4 (2 caps each) · Sheet pan · 30 min · Vegetarian" → cells [Serves, Method, Time] + tags
function recipeFacts(r) {
  const parts = String(r.meta || '').split(' · ').map((s) => s.trim()).filter(Boolean);
  const serves = (parts[0] || '').replace(/^Serves\s*/i, '');
  let method = parts[1] || '';
  let time = parts[2] || '';
  const m = method.match(/^(.*?)\s+([\d–-]+\s*h\b.*)$/);   // "Slow cooker 6 h"
  if (m) { method = m[1]; if (!time) time = `${m[2]} on low`; }
  const cells = [['Serves', serves], ['Method', method], ['Time', time]].filter(([, v]) => v);
  return { cells, tags: parts.slice(3) };
}

function renderUnlock() {
  setTab('');
  header('Unlock recipes', 'Once per phone', '#/');
  view.innerHTML = `
    <p class="muted">Recipe text is encrypted in the public repo. Enter the passphrase once and this phone remembers it.</p>
    <form id="uf"><input class="text" id="pp" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="passphrase"><button class="btn" type="submit">Unlock</button></form>
    ${state.recipes ? `<p class="muted">Already unlocked here. <button class="btn ghost" id="forget" type="button">Forget on this phone</button></p>` : ''}`;
  $('#uf').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await unlock($('#pp').value); location.hash = '#/'; }
    catch { toast('That passphrase didn\'t work'); }
  });
  $('#forget')?.addEventListener('click', () => { LS.del('dp.pass'); LS.del('dp.recipes'); state.recipes = null; toast('Forgotten'); renderUnlock(); });
}

// ---------- router ----------
async function handleUnlockLink() {
  const m = location.hash.match(/^#unlock=(.+)$/);
  if (!m) return false;
  try { await unlock(decodeURIComponent(m[1])); } catch { toast('Unlock link didn\'t work'); }
  history.replaceState(null, '', location.pathname + '#/');
  return true;
}

async function route() {
  if (await handleUnlockLink()) return route();
  const raw = location.hash.slice(1) || '/';
  const [path, q] = raw.split('?');
  const params = new URLSearchParams(q || '');
  if (path.startsWith('/r/')) return renderRecipe(decodeURIComponent(path.slice(3)), params);
  if (path === '/week') return renderWeek(params);
  if (path === '/groceries') return renderGroceries(params);
  if (path === '/recipes') return renderRecipes(params);
  if (path === '/unlock') return renderUnlock();
  return renderTonight();
}

async function init() {
  // One-time unlock link: …/#unlock=passphrase (the fragment never reaches the server).
  // route() handles it, on first load and on in-page hash changes.
  await loadPlans();
  if (!/^#unlock=/.test(location.hash)) await loadRecipes();
  window.addEventListener('hashchange', route);
  route();
  // Refresh "today" if the app sits open past midnight
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    const now = new Date();
    if (iso(now) !== iso(state.today)) { state.today = now; await loadPlans(); route(); }
  });
}
init();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
