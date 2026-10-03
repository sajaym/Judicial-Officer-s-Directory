(() => {
  'use strict';

  const DATA = window.DIRECTORY;
  const people = DATA.people;
  const Search = window.DirSearch;
  const byId = new Map(people.map(p => [p.id, p]));
  const $ = id => document.getElementById(id);
  const fmt = n => n.toLocaleString('en-IN');
  const CHUNK = 60;

  const CATS = [
    { id: 'all', label: 'Everyone' },
    { id: 'judges', label: "Hon'ble Judges" },
    { id: 'jo', label: 'Judicial Officers' },
    { id: 'registry', label: 'Registry' },
    { id: 'rslsa', label: 'Legal Services' },
    { id: 'rsja', label: 'Judicial Academy' },
  ];
  const GROUP_NAMES = {
    judges: "Hon'ble Judges",
    rslsa: 'Rajasthan State Legal Services Authority',
    rsja: 'Rajasthan State Judicial Academy',
  };
  // Judicial Officers from the most to the least senior designation.
  const ROLE_ORDER = ['District & Sessions Judge', 'Additional District & Sessions Judge', 'Chief Judicial Magistrate',
    'Additional Chief Judicial Magistrate', 'Civil Judge', 'Under Training'];
  const ROLE_PLURAL = {
    'District & Sessions Judge': 'District & Sessions Judges',
    'Additional District & Sessions Judge': 'Additional District & Sessions Judges',
    'Chief Judicial Magistrate': 'Chief Judicial Magistrates',
    'Additional Chief Judicial Magistrate': 'Additional Chief Judicial Magistrates',
    'Civil Judge': 'Civil Judges',
    'Under Training': 'Under Training',
  };
  const CAT_TIER = { judges: 1, registry: 2, rslsa: 3, rsja: 4, jo: 5 };
  const AGE_LABELS = { u35: 'Under 35', 35: '35 – 44', 45: '45 – 54', 55: '55 and above' };
  const SVC_LABELS = { u5: 'Under 5 yrs', 5: '5 – 9 yrs', 10: '10 – 19 yrs', 20: '20+ yrs' };
  const QUAL_LABELS = { llm: 'LL.M.', phd: 'Ph.D.', masters: "Other master's degree", diploma: 'Law / PG diploma' };
  const SORTS = {
    dir: 'Hierarchy', batch: 'Batch order', az: 'Name A to Z', za: 'Name Z to A',
    age_old: 'Age: oldest first', age_young: 'Age: youngest first',
    appt_old: 'Service: longest first', appt_new: 'Service: newest first',
  };
  const SORT_KEY = { age_old: ['dob', 1], age_young: ['dob', -1], appt_old: ['appt', 1], appt_new: ['appt', -1] };
  const AVATAR_HUES = [215, 200, 230, 36, 165, 262, 12];
  const NO_DETAILS = ['Date of birth', 'Qualification', 'Home district'];
  const PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>';

  // ---------- helpers ----------
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
  };
  const isoDate = iso => new Date(iso + 'T00:00:00');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDate = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  // Calendar difference between an ISO date and today, as whole years / months / days.
  const TODAY = new Date();
  function span(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    let Y = TODAY.getFullYear() - y, M = TODAY.getMonth() + 1 - m, D = TODAY.getDate() - d;
    if (D < 0) { M--; D += new Date(TODAY.getFullYear(), TODAY.getMonth(), 0).getDate(); }
    if (M < 0) { Y--; M += 12; }
    return Y < 0 ? null : { y: Y, m: M, d: D };
  }
  const spanShort = s => `${s.y}y ${s.m}m ${s.d}d`;
  const spanLong = s => [s.y && plural(s.y, 'year'), s.m && plural(s.m, 'month'), s.d && plural(s.d, 'day')].filter(Boolean).join(', ') || 'Today';
  const ageBucket = a => (a < 35 ? 'u35' : a < 45 ? '35' : a < 55 ? '45' : '55');
  const svcBucket = y => (y < 5 ? 'u5' : y < 10 ? '5' : y < 20 ? '10' : '20');

  Search.prepare(people);
  for (const p of people) {
    p._ageSpan = p.dob ? span(p.dob) : null;
    p._age = p._ageSpan ? p._ageSpan.y : null;
    p._bucket = p._age == null ? null : ageBucket(p._age);
    p._svcSpan = p.appt ? span(p.appt) : null;
    p._svcBucket = p._svcSpan ? svcBucket(p._svcSpan.y) : null;
    p._tier = p.role === 'Chief Justice' ? 0 : p.cat === 'jo' ? CAT_TIER.jo + Math.max(0, ROLE_ORDER.indexOf(p.role)) : CAT_TIER[p.cat];
  }

  // "Mr. Gyan Prakash Gupta" -> { hon: "Mr.", core: "Gyan Prakash Gupta" }; judges get "Hon'ble Justice".
  function nameParts(p) {
    const j = p.name.match(/^Justice\s+(.*)$/i);
    if (j) return { hon: "Hon'ble Justice", core: j[1] };
    const m = p.name.match(/^(Dr|Mr|Mrs|Ms|Miss|Smt)\.?\s+(.*)$/i);
    if (m) return { hon: m[1] + '.', core: m[2] };
    return { hon: p.title || '', core: p.name };
  }

  // ---------- state ----------
  const FILTER_KEYS = ['role', 'batch', 'dist', 'age', 'svc', 'qual', 'title'];
  const JO_ONLY = ['batch', 'role', 'dist']; // these only make sense for Judicial Officers
  const state = { q: '', cat: 'all', role: '', batch: '', dist: '', age: '', svc: '', qual: '', title: '', sort: 'dir', view: store.get('view') === 'list' ? 'list' : 'grid' };
  let list = [];
  let result = { tokens: [], fuzzy: false, suggestion: null };
  let shown = 0;
  let lastKey = null;
  let groupCounts = new Map();
  let grouped = false;

  const el = {
    q: $('q'), tabs: $('tabs'), grid: $('grid'), count: $('count'), empty: $('empty'), notice: $('notice'),
    fSort: $('fSort'), reset: $('reset'), bar: $('bar'), subbar: $('subbar'),
    drawer: $('drawer'), dBody: $('dBody'), dPos: $('dPos'), sentinel: $('sentinel'),
    sel: { role: $('fRole'), batch: $('fBatch'), dist: $('fDist'), age: $('fAge'), svc: $('fSvc'), qual: $('fQual'), title: $('fTitle') },
  };

  // ---------- one-time setup ----------
  function setup() {
    const count = id => people.filter(p => p.cat === id).length;
    const jo = people.filter(p => p.cat === 'jo');
    const batches = new Set(jo.map(p => p.batch).filter(Boolean));
    const dists = new Set(jo.map(p => p.dist).filter(Boolean));
    $('stats').innerHTML = [
      [jo.length, 'Judicial Officers'],
      [count('judges'), "Hon'ble Judges"],
      [batches.size, 'Batches'],
      [dists.size, 'Home districts'],
    ].map(([n, l]) => `<div><dt>${l}</dt><dd>${fmt(n)}</dd></div>`).join('');
    $('scraped').textContent = isoDate(DATA.scraped).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

    el.tabs.innerHTML = CATS.map(c =>
      `<button class="tab" role="tab" data-cat="${c.id}" aria-selected="false">${c.label}<small>${fmt(c.id === 'all' ? people.length : count(c.id))}</small></button>`).join('');

    const tally = (arr, key) => arr.reduce((m, p) => (p[key] && m.set(p[key], (m.get(p[key]) || 0) + 1), m), new Map());
    const opts = (sel, entries, label) => sel.insertAdjacentHTML('beforeend',
      entries.map(([v, n]) => `<option value="${esc(v)}">${esc(label ? label(v) : v)} (${fmt(n)})</option>`).join(''));
    opts(el.sel.batch, [...tally(jo, 'batch')].sort((a, b) => b[0] - a[0]), v => 'Batch ' + v);
    const roles = tally(jo, 'role');
    opts(el.sel.role, ROLE_ORDER.filter(r => roles.has(r)).map(r => [r, roles.get(r)]));
    opts(el.sel.dist, [...tally(jo, 'dist')].sort((a, b) => a[0].localeCompare(b[0])));

    const ages = tally(people.map(p => ({ b: p._bucket })), 'b');
    opts(el.sel.age, ['u35', '35', '45', '55'].filter(k => ages.has(k)).map(k => [k, ages.get(k)]), k => AGE_LABELS[k]);
    const svcs = tally(people.map(p => ({ b: p._svcBucket })), 'b');
    opts(el.sel.svc, ['u5', '5', '10', '20'].filter(k => svcs.has(k)).map(k => [k, svcs.get(k)]), k => SVC_LABELS[k]);
    const titles = tally(people, 'title');
    opts(el.sel.title, ['Mr.', 'Mrs.', 'Ms.', 'Miss.', 'Dr.'].filter(t => titles.has(t)).map(t => [t, titles.get(t)]));
    const quals = new Map();
    people.forEach(p => (p.q || []).forEach(k => quals.set(k, (quals.get(k) || 0) + 1)));
    opts(el.sel.qual, ['llm', 'phd', 'masters', 'diploma'].filter(k => quals.has(k)).map(k => [k, quals.get(k)]), k => QUAL_LABELS[k]);
    el.fSort.innerHTML = Object.entries(SORTS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  }

  // ---------- filtering & sorting ----------
  const joAllowed = () => state.cat === 'all' || state.cat === 'jo';

  function matchesFilters(p) {
    const jo = joAllowed();
    return (state.cat === 'all' || p.cat === state.cat) &&
      (!jo || !state.batch || String(p.batch) === state.batch) &&
      (!jo || !state.role || p.role === state.role) &&
      (!jo || !state.dist || p.dist === state.dist) &&
      (!state.age || p._bucket === state.age) &&
      (!state.svc || p._svcBucket === state.svc) &&
      (!state.title || p.title === state.title) &&
      (!state.qual || (p.q || []).includes(state.qual));
  }

  function apply() {
    result = Search.search(people.filter(matchesFilters), state.q);
    list = result.list;
    if (state.sort === 'az') list.sort((a, b) => a.sort.localeCompare(b.sort));
    else if (state.sort === 'za') list.sort((a, b) => b.sort.localeCompare(a.sort));
    else if (state.sort === 'dir' && !result.tokens.length) list.sort((a, b) => a._tier - b._tier || a.id - b.id);
    else if (SORT_KEY[state.sort]) {
      const [key, dir] = SORT_KEY[state.sort];
      list.sort((a, b) => {
        const x = a[key], y = b[key];
        if (!x || !y) return (x ? -1 : 0) - (y ? -1 : 0) || a.id - b.id; // people without a value go last
        return (x < y ? -1 : x > y ? 1 : 0) * dir || a.id - b.id;
      });
    }
    // Section headings only make sense in plain directory order (not while searching by relevance).
    grouped = (state.sort === 'dir' || state.sort === 'batch') && !result.tokens.length;
    groupCounts = new Map();
    if (grouped) list.forEach(p => groupCounts.set(groupKey(p), (groupCounts.get(groupKey(p)) || 0) + 1));
  }

  function groupKey(p) {
    if (p.cat === 'jo') return state.sort === 'dir' ? (ROLE_PLURAL[p.role] || p.role) : p.batch ? 'Batch ' + p.batch : 'Batch not yet listed';
    if (p.cat === 'registry') return p.loc === 'Registrar General' ? p.loc : 'Registry · ' + p.loc;
    if (p.role === 'Chief Justice') return 'Chief Justice';
    return GROUP_NAMES[p.cat];
  }

  // ---------- rendering ----------
  function hl(text, p) {
    const words = p && p._m ? [...p._m] : [...result.tokens];
    if (!words.length) return esc(text);
    const re = new RegExp('(' + words.sort((a, b) => b.length - a.length).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig');
    return String(text).split(re).map((part, i) => i % 2 ? `<mark>${esc(part)}</mark>` : esc(part)).join('');
  }

  const initials = p => {
    const w = nameParts(p).core.split(/\s+/).filter(Boolean);
    return ((w[0] || '')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
  };
  const avatar = p => `<div class="avatar" style="--hue:${AVATAR_HUES[p.id % AVATAR_HUES.length]}" aria-hidden="true">${esc(initials(p))}</div>`;

  // Whatever the user filtered or sorted by is surfaced on each card (age, service ...) so it is easy to verify.
  function lens(p) {
    const out = [];
    if ((state.age || state.sort.startsWith('age')) && p._ageSpan) out.push(['Age', spanShort(p._ageSpan)]);
    if ((state.svc || state.sort.startsWith('appt')) && p._svcSpan) out.push(['Service', spanShort(p._svcSpan)]);
    return out;
  }

  function nameHTML(p) {
    const n = nameParts(p);
    return (n.hon ? `<span class="hon">${esc(n.hon)}</span> ` : '') + hl(n.core, p);
  }

  function card(p) {
    const photo = p.ph ? `<img src="img/t/${p.img}.jpg" alt="" loading="lazy" decoding="async" width="320" height="400">` : avatar(p);
    const where = p.dist || p.loc;
    const tags = [
      where ? `<span class="dist">${PIN}${hl(where, p)}</span>` : '',
      p.batch ? `<span class="batch">Batch ${p.batch}</span>` : '',
    ].join('');
    const ls = lens(p);
    return `<a class="card${ls.length ? ' has-lens' : ''}" href="#p=${p.id}" data-id="${p.id}">
      <div class="photo">${photo}</div>
      ${p.code ? `<span class="rj" title="RJ code">${hl(p.code, p)}</span>` : ''}
      <div class="info">
        <h3 class="name">${nameHTML(p)}</h3>
        ${p.role ? `<div class="role">${hl(p.role, p)}</div>` : ''}
        ${tags ? `<div class="tags">${tags}</div>` : ''}
        ${ls.length ? `<div class="lens">${ls.map(([k, v]) => `<span><small>${k}</small><b>${v}</b></span>`).join('')}</div>` : ''}
      </div></a>`;
  }

  // The Chief Justice leads the hierarchy with a calm, minimal feature card.
  function featureCard(p) {
    const since = (p.d || []).find(([k]) => /^Chief Justice/.test(k));
    const bits = [p._ageSpan && `Age ${p._ageSpan.y}`, since && `In office since ${since[1]}`].filter(Boolean);
    const photo = p.ph ? `<img src="img/t/${p.img}.jpg" alt="" width="320" height="400">` : avatar(p);
    return `<a class="card feature" href="#p=${p.id}" data-id="${p.id}">
      <div class="photo">${photo}</div>
      <div class="info">
        <span class="kicker">Chief Justice</span>
        <h3 class="name">${nameHTML(p)}</h3>
        <div class="role">High Court of Judicature for Rajasthan</div>
        ${bits.length ? `<div class="f-meta">${bits.map(b => `<span>${esc(b)}</span>`).join('')}</div>` : ''}
      </div></a>`;
  }

  function renderChunk() {
    if (shown >= list.length) return;
    let html = '';
    for (const p of list.slice(shown, shown + CHUNK)) {
      const feature = grouped && state.sort === 'dir' && state.view === 'grid' && p.role === 'Chief Justice';
      if (grouped && !feature) {
        const k = groupKey(p);
        if (k !== lastKey) {
          lastKey = k;
          html += `<div class="group"><h2>${esc(k)}</h2><span>${fmt(groupCounts.get(k))}</span></div>`;
        }
      }
      html += feature ? featureCard(p) : card(p);
    }
    shown = Math.min(list.length, shown + CHUNK);
    el.grid.insertAdjacentHTML('beforeend', html);
  }

  const activeKeys = () => FILTER_KEYS.filter(k => state[k] && (joAllowed() || !JO_ONLY.includes(k)));

  function render({ scroll = false } = {}) {
    apply();
    shown = 0; lastKey = null;
    el.grid.innerHTML = '';
    el.grid.className = 'grid' + (state.view === 'list' ? ' list' : '');
    renderChunk();

    const jo = joAllowed();
    const active = activeKeys();
    const filtered = result.tokens.length || active.length || state.cat !== 'all';
    el.count.innerHTML = filtered
      ? `Showing <b>${fmt(list.length)}</b> of ${fmt(people.length)} people`
      : `<b>${fmt(people.length)}</b> people`;
    el.reset.hidden = !(active.length || result.tokens.length);
    el.empty.hidden = list.length > 0;

    // Spelling-correction notice.
    if (result.fuzzy && result.tokens.length && list.length) {
      el.notice.hidden = false;
      el.notice.innerHTML = `No exact match for <b>“${esc(state.q)}”</b>, so these are the closest matches.` +
        (result.suggestion ? ` Did you mean <button type="button" class="link" data-suggest="${esc(result.suggestion)}">${esc(result.suggestion)}</button>?` : '');
    } else {
      el.notice.hidden = true;
    }

    el.tabs.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.cat === state.cat)));
    for (const k of FILTER_KEYS) {
      const off = JO_ONLY.includes(k) && !jo;
      el.sel[k].disabled = off;
      el.sel[k].value = off ? '' : state[k];
      el.sel[k].parentElement.classList.toggle('on', !off && !!state[k]);
    }
    el.fSort.value = state.sort;
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));

    syncURL();
    fill();
    if (scroll) {
      const sticky = getComputedStyle(el.subbar).position === 'sticky';
      const stickTo = sticky ? el.subbar.getBoundingClientRect().bottom : el.bar.getBoundingClientRect().bottom;
      document.documentElement.style.scrollPaddingTop = Math.ceil(stickTo - 0 + 8) + 'px';
      if ($('results').getBoundingClientRect().top < stickTo) $('results').scrollIntoView({ block: 'start' });
    }
  }

  function syncURL() {
    const sp = new URLSearchParams();
    if (state.q) sp.set('q', state.q);
    if (state.cat !== 'all') sp.set('cat', state.cat);
    FILTER_KEYS.forEach(k => state[k] && sp.set(k, state[k]));
    if (state.sort !== 'dir') sp.set('sort', state.sort);
    const qs = sp.toString();
    try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash); } catch (e) { /* file:// quirks */ }
  }

  function readURL() {
    const sp = new URLSearchParams(location.search);
    state.q = sp.get('q') || '';
    state.cat = CATS.some(c => c.id === sp.get('cat')) ? sp.get('cat') : 'all';
    FILTER_KEYS.forEach(k => { state[k] = sp.get(k) || ''; });
    state.sort = SORTS[sp.get('sort')] ? sp.get('sort') : 'dir';
    if (['grid', 'list'].includes(sp.get('view'))) state.view = sp.get('view');
    el.q.value = state.q;
  }

  // ---------- profile card ----------
  let currentId = null;

  // Parse "16 Sep 2013 (as Judge, ...)" or "1991" into a sortable date, the display text and an optional note.
  function parseWhen(v) {
    const m = String(v).match(/^(\d{1,2} [A-Za-z]{3} \d{4}|\d{4})\s*(?:\((.*)\))?\s*$/);
    if (!m) return { text: v, note: '', t: Infinity };
    const t = /^\d{4}$/.test(m[1]) ? new Date(Number(m[1]), 0, 1).getTime() : new Date(m[1]).getTime();
    return { text: m[1], note: m[2] || '', t: isNaN(t) ? Infinity : t };
  }

  function milestones(p) {
    const label = k => (k === 'Date of appointment' ? (p.cat === 'jo' ? 'Joined judicial service' : 'Appointed as Judge') : k);
    return (p.d || []).filter(([k]) => !NO_DETAILS.includes(k))
      .map(([k, v], i) => ({ label: label(k), i, ...parseWhen(v) }))
      .sort((a, b) => a.t - b.t || a.i - b.i);
  }

  const copyIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>';

  function tile(label, s, sub) {
    const big = s.y ? `<b>${s.y}</b><span>${s.y === 1 ? 'year' : 'years'}</span>` : `<b>${s.m}</b><span>${s.m === 1 ? 'month' : 'months'}</span>`;
    const rest = s.y ? [s.m && plural(s.m, 'month'), s.d && plural(s.d, 'day')].filter(Boolean).join(', ') : (s.d ? plural(s.d, 'day') : '');
    return `<div class="tile"><small>${label}</small><div class="big">${big}</div>
      <p>${rest ? esc(rest) : '&nbsp;'}</p><em>${esc(sub)}</em></div>`;
  }

  function openProfile(id, { push = true } = {}) {
    const p = byId.get(id);
    if (!p) return;
    currentId = id;
    const idx = list.findIndex(x => x.id === id);
    el.dPos.textContent = idx >= 0 ? `${idx + 1} of ${fmt(list.length)}` : '';
    $('dPrev').disabled = idx <= 0;
    $('dNext').disabled = idx < 0 || idx >= list.length - 1;

    const n = nameParts(p);
    const detail = k => (p.d || []).find(([x]) => x === k)?.[1];
    const isCJ = p.role === 'Chief Justice';
    const photo = p.ph ? `<img src="img/f/${p.img}.jpg" alt="Photograph of ${esc(p.name)}" width="168" height="210">` : avatar(p);
    const chips = [
      p.code && `<button type="button" class="code-pill" data-copy="${esc(p.code)}" title="Copy RJ code" aria-label="RJ code ${esc(p.code)}, click to copy"><span>${esc(p.code)}</span>${copyIcon}</button>`,
      p.batch && `<span class="chip">Batch ${p.batch}</span>`,
      p.loc && p.loc !== p.role && `<span class="chip">${esc(p.loc)}</span>`,
    ].filter(Boolean).join('');

    const tiles = [
      p._ageSpan && tile('Age', p._ageSpan, 'Born ' + fmtDate(p.dob)),
      p._svcSpan && tile(p.cat === 'jo' ? 'In service' : 'As a Judge', p._svcSpan, 'Since ' + fmtDate(p.appt)),
    ].filter(Boolean).join('');

    const facts = [['Home district', detail('Home district')], ['Qualification', detail('Qualification')]]
      .filter(([, v]) => v).map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');

    const ms = milestones(p);
    const timeline = ms.length ? `<section class="d-sec"><h3>Career</h3><ol class="timeline">${ms.map(m =>
      `<li><b>${esc(m.label)}</b><time>${esc(m.text)}${m.note ? ' · ' + esc(m.note) : ''}</time></li>`).join('')}</ol></section>` : '';

    el.dBody.innerHTML = `
      <div class="d-hero${isCJ ? ' cj' : ''}"></div>
      <div class="d-head">
        <div class="d-photo">${photo}</div>
        <div class="d-id">
          ${isCJ ? '<span class="kicker">Chief Justice</span>' : n.hon ? `<span class="hon">${esc(n.hon)}</span>` : ''}
          <h2>${esc(n.core)}</h2>
          ${p.role ? `<p class="d-role">${esc(isCJ ? 'Rajasthan High Court' : p.role)}</p>` : ''}
        </div>
      </div>
      ${chips ? `<div class="d-chips">${chips}</div>` : ''}
      ${tiles ? `<div class="d-tiles">${tiles}</div>` : ''}
      ${facts ? `<dl class="d-facts">${facts}</dl>` : ''}
      ${timeline}
      ${!tiles && !facts && !timeline ? '<p class="d-note">No further details are listed for this person in the source directory.</p>' : ''}`;
    el.dBody.scrollTop = 0;

    if (!el.drawer.open) {
      el.drawer.showModal();
      document.documentElement.style.overflow = 'hidden';
    }
    if (push) { try { history.replaceState(null, '', location.pathname + location.search + '#p=' + id); } catch (e) { /* ignore */ } }
  }

  function step(delta) {
    const idx = list.findIndex(x => x.id === currentId);
    const next = list[idx + delta];
    if (next) openProfile(next.id);
  }

  el.drawer.addEventListener('close', () => {
    document.documentElement.style.overflow = '';
    currentId = null;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
  });
  el.drawer.addEventListener('click', e => { if (e.target === el.drawer) el.drawer.close(); });
  $('dClose').addEventListener('click', () => el.drawer.close());
  el.dBody.addEventListener('click', e => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    const label = b.querySelector('span');
    const shownText = label.textContent;
    const done = () => { label.textContent = 'Copied'; setTimeout(() => { label.textContent = shownText; }, 1400); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(b.dataset.copy).then(done, () => {});
    else { // file:// and other non-secure contexts
      const t = Object.assign(document.createElement('textarea'), { value: b.dataset.copy });
      t.style.cssText = 'position:fixed;opacity:0';
      el.drawer.appendChild(t); t.select();
      try { if (document.execCommand('copy')) done(); } catch (err) { /* copy unsupported */ }
      t.remove();
    }
  });
  $('dPrev').addEventListener('click', () => step(-1));
  $('dNext').addEventListener('click', () => step(1));

  // ---------- events ----------
  let timer;
  el.q.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = el.q.value.trim(); render({ scroll: true }); }, 140);
  });

  el.tabs.addEventListener('click', e => {
    const t = e.target.closest('.tab');
    if (!t) return;
    state.cat = t.dataset.cat;
    if (!joAllowed()) JO_ONLY.forEach(k => { state[k] = ''; });
    render({ scroll: true });
  });

  FILTER_KEYS.forEach(k => el.sel[k].addEventListener('change', e => {
    state[k] = e.target.value;
    if (e.target.value && JO_ONLY.includes(k) && state.cat !== 'jo') state.cat = 'jo';
    render({ scroll: true });
  }));
  el.fSort.addEventListener('change', e => { state.sort = e.target.value; render({ scroll: true }); });

  el.notice.addEventListener('click', e => {
    const b = e.target.closest('[data-suggest]');
    if (b) { state.q = b.dataset.suggest; el.q.value = state.q; render(); }
  });

  function resetAll() {
    Object.assign(state, { q: '', cat: 'all', role: '', batch: '', dist: '', age: '', svc: '', qual: '', title: '', sort: 'dir' });
    el.q.value = '';
    render({ scroll: true });
  }
  $('reset').addEventListener('click', resetAll);
  $('emptyReset').addEventListener('click', resetAll);

  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
    state.view = b.dataset.view;
    store.set('view', state.view);
    render();
  }));

  el.grid.addEventListener('click', e => {
    const a = e.target.closest('.card');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    openProfile(Number(a.dataset.id));
  });
  // Broken/missing photo -> initials avatar.
  el.grid.addEventListener('error', e => {
    if (e.target.tagName !== 'IMG') return;
    const holder = e.target.parentElement;
    const p = byId.get(Number(e.target.closest('.card').dataset.id));
    e.target.remove();
    holder.insertAdjacentHTML('afterbegin', avatar(p));
  }, true);
  el.dBody.addEventListener('error', e => {
    if (e.target.tagName !== 'IMG') return;
    const holder = e.target.parentElement;
    const p = byId.get(currentId);
    e.target.remove();
    if (p) holder.insertAdjacentHTML('afterbegin', avatar(p));
  }, true);

  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (e.key === '/' && !typing && !el.drawer.open) { e.preventDefault(); el.q.focus(); el.q.select(); }
    else if (el.drawer.open && e.key === 'ArrowLeft') step(-1);
    else if (el.drawer.open && e.key === 'ArrowRight') step(1);
    else if (e.key === 'Escape' && document.activeElement === el.q && el.q.value) { el.q.value = ''; state.q = ''; render(); }
  });

  // Lazy-render the rest of the list as the user scrolls.
  function fill() {
    for (let guard = 0; guard < 50 && shown < list.length && el.sentinel.getBoundingClientRect().top < innerHeight + 900; guard++) renderChunk();
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => { if (entries[0].isIntersecting) fill(); }, { rootMargin: '900px 0px' }).observe(el.sentinel);
  } else {
    addEventListener('scroll', fill, { passive: true });
  }

  // Theme
  $('themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('theme', next);
  });

  // ---------- boot ----------
  setup();
  readURL();
  if (!joAllowed()) JO_ONLY.forEach(k => { state[k] = ''; });
  render();
  const m = location.hash.match(/^#p=(\d+)/);
  if (m) openProfile(Number(m[1]), { push: false });
})();
