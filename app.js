// Dinner Plan — static app for GitHub Pages. No build step.
const $ = (s) => document.querySelector(s);
const view = $('#view');
const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------- dates ----------
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sundayOf = (d) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -d.getDay());
const fmt = (d, o) => d.toLocaleDateString('en-US', o);

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
  <a class="card opt" href="#/r/${esc(o.id)}?from=${encodeURIComponent(back)}">
    <div class="badge ${letter === 'B' ? 'b' : ''}">${letter}</div>
    <div><h3>${esc(o.name)}</h3><div class="time">${esc(o.time)}</div></div>
    <div class="chev" aria-hidden="true">›</div>
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
    html += `<div class="section-label">Pick one</div>`;
    html += optCard(today.a, 'A', '#/') + optCard(today.b, 'B', '#/');
    if (today.prep) html += `<div class="note"><strong>Prep:</strong> ${esc(today.prep)}</div>`;
    const tmrwPlan = d.getDay() === 6 ? next : cur;
    const tmrw = tmrwPlan?.days.find((x) => x.day === DAYS[(d.getDay() + 1) % 7]);
    if (tmrw) {
      html += `<div class="section-label">Tomorrow · ${esc(tmrw.day)}</div><div class="card day">${miniRow(tmrw.a, 'A', '#/')}${miniRow(tmrw.b, 'B', '#/')}</div>`;
      if (tmrw.prep) html += `<div class="note"><strong>Tomorrow's prep:</strong> ${esc(tmrw.prep)}</div>`;
    }
  }
  if (next) html += `<a class="card" href="#/groceries" style="text-align:center"><strong>Next week (${esc(next.label)}) is planned.</strong><br><span class="muted">Open the grocery list ›</span></a>`;
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
    html += `<div class="card day ${iso(date) === todayIso ? 'today' : ''}">
      <div class="day-head"><h3>${esc(x.day)}</h3><span>${fmt(date, { month: 'short', day: 'numeric' })}</span></div>
      ${miniRow(x.a, 'A', back)}${miniRow(x.b, 'B', back)}
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
  let html = weekPicker(which);
  html += `<div class="row"><button class="btn" id="copy">Copy remaining</button><button class="btn ghost" id="reset">Uncheck all</button></div>`;
  plan.grocery.forEach((sec) => {
    html += `<div class="section-label">${esc(sec.section)}</div><ul class="list">`;
    sec.items.forEach((it) => {
      const [name, qty] = it.split(' — ');
      html += `<li><label class="check"><input type="checkbox" value="${esc(it)}" ${checked.has(it) ? 'checked' : ''}><span class="box">✓</span><span class="lbl">${esc(name)}${qty ? ` <span class="qty">· ${esc(qty)}</span>` : ''}</span></label></li>`;
    });
    html += `</ul>`;
  });
  if (plan.pantry?.length) {
    html += `<details><summary>Check the pantry (${plan.pantry.length})</summary><ul class="list">${plan.pantry.map((p) => `<li class="check" style="cursor:default"><span class="lbl">${esc(p)}</span></li>`).join('')}</ul>${plan.pantryNote ? `<p class="muted">${esc(plan.pantryNote)}</p>` : ''}</details>`;
  }
  view.innerHTML = html;
  bindWeekPicker('#/groceries');
  view.querySelectorAll('input[type=checkbox]').forEach((c) => c.addEventListener('change', () => {
    c.checked ? checked.add(c.value) : checked.delete(c.value);
    LS.set(key, [...checked]);
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
  header(r.name, '', from);
  const done = new Set(JSON.parse(sessionStorage.getItem(`dp.r.${id}`) || '[]'));
  let html = `<p class="recipe-meta">${esc(r.meta)}</p><div class="section-label">Ingredients</div>`;
  let k = 0;
  r.ingredients.forEach((g) => {
    if (g.group) html += `<div class="ing-group">${esc(g.group)}</div>`;
    html += `<ul class="list">${g.items.map((it) => { const i = k++; return `<li><label class="check"><input type="checkbox" data-i="${i}" ${done.has(i) ? 'checked' : ''}><span class="box">✓</span><span class="lbl">${esc(it)}</span></label></li>`; }).join('')}</ul>`;
  });
  html += `<div class="section-label">Steps</div><ol class="steps">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  view.innerHTML = html;
  view.querySelectorAll('input[type=checkbox]').forEach((c) => c.addEventListener('change', () => {
    const i = +c.dataset.i; c.checked ? done.add(i) : done.delete(i);
    try { sessionStorage.setItem(`dp.r.${id}`, JSON.stringify([...done])); } catch { /* ignore */ }
  }));
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
  const ings = allIngredients(r);
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
        ${m.via ? `<span class="rvia">Has: ${esc(m.via)}</span>` : ''}
      </a>`).join('');
    html += `</div>`;
  });
  return html;
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
