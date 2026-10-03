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
  const AGE_LABELS = { u35: 'Under 35', 35: '35 to 44', 45: '45 to 54', 55: '55 and above' };
  const QUAL_LABELS = { llm: 'LL.M.', phd: 'Ph.D.', masters: "Other master's degree", diploma: 'Law / PG diploma' };
  const SORTS = {
    dir: 'Default order', az: 'Name A to Z', za: 'Name Z to A',
    age_old: 'Age: oldest first', age_young: 'Age: youngest first',
    appt_old: 'Service: longest first', appt_new: 'Service: newest first',
  };
  const SORT_KEY = { age_old: ['dob', 1], age_young: ['dob', -1], appt_old: ['appt', 1], appt_new: ['appt', -1] };
  const AVATAR_HUES = [215, 200, 230, 36, 165, 262, 12];

  // ---------- helpers ----------
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
  };
  const isoDate = iso => new Date(iso + 'T00:00:00');
  const monthYear = iso => isoDate(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  function ageOf(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const t = new Date();
    let a = t.getFullYear() - y;
    if (t.getMonth() + 1 < m || (t.getMonth() + 1 === m && t.getDate() < d)) a--;
    return a;
  }
  const ageBucket = a => (a < 35 ? 'u35' : a < 45 ? '35' : a < 55 ? '45' : '55');

  Search.prepare(people);
  for (const p of people) {
    p._age = p.dob ? ageOf(p.dob) : null;
    p._bucket = p._age == null ? null : ageBucket(p._age);
  }

  // ---------- state ----------
  const FILTER_KEYS = ['batch', 'role', 'dist', 'age', 'title', 'qual'];
  const JO_ONLY = ['batch', 'role', 'dist']; // these only make sense for Judicial Officers
  const state = { q: '', cat: 'all', batch: '', role: '', dist: '', age: '', title: '', qual: '', sort: 'dir', view: store.get('view') === 'list' ? 'list' : 'grid' };
  let list = [];
  let result = { tokens: [], fuzzy: false, suggestion: null };
  let shown = 0;
  let lastKey = null;
  let groupCounts = new Map();
  let grouped = false;

  const el = {
    q: $('q'), tabs: $('tabs'), grid: $('grid'), count: $('count'), chips: $('chips'), empty: $('empty'), notice: $('notice'),
    filters: $('filters'), filtersBtn: $('filtersBtn'), filterCount: $('filterCount'), fSort: $('fSort'),
    drawer: $('drawer'), dBody: $('dBody'), dPos: $('dPos'), sentinel: $('sentinel'),
    sel: { batch: $('fBatch'), role: $('fRole'), dist: $('fDist'), age: $('fAge'), title: $('fTitle'), qual: $('fQual') },
  };

  // ---------- one-time setup ----------
  function setup() {
    const count = id => people.filter(p => p.cat === id).length;
    const batches = [...new Set(people.filter(p => p.batch).map(p => p.batch))];
    $('stats').innerHTML = [
      [count('jo'), 'Judicial Officers'],
      [count('judges'), "Hon'ble Judges"],
      [batches.length, 'Batches'],
    ].map(([n, l]) => `<div><dt>${l}</dt><dd>${fmt(n)}</dd></div>`).join('');
    $('scraped').textContent = isoDate(DATA.scraped).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

    el.tabs.innerHTML = CATS.map(c =>
      `<button class="tab" role="tab" data-cat="${c.id}" aria-selected="false">${c.label}<small>${fmt(c.id === 'all' ? people.length : count(c.id))}</small></button>`).join('');

    const jo = people.filter(p => p.cat === 'jo');
    const tally = (arr, key) => arr.reduce((m, p) => (p[key] && m.set(p[key], (m.get(p[key]) || 0) + 1), m), new Map());
    const opts = (sel, entries, label) => sel.insertAdjacentHTML('beforeend',
      entries.map(([v, n]) => `<option value="${esc(v)}">${esc(label ? label(v) : v)} (${fmt(n)})</option>`).join(''));
    opts(el.sel.batch, [...tally(jo, 'batch')].sort((a, b) => b[0] - a[0]), v => 'Batch ' + v);
    const roleOrder = ['District & Sessions Judge', 'Additional District & Sessions Judge', 'Chief Judicial Magistrate',
      'Additional Chief Judicial Magistrate', 'Civil Judge', 'Under Training'];
    const roles = tally(jo, 'role');
    opts(el.sel.role, roleOrder.filter(r => roles.has(r)).map(r => [r, roles.get(r)]));
    opts(el.sel.dist, [...tally(jo, 'dist')].sort((a, b) => a[0].localeCompare(b[0])));

    const ages = tally(people.map(p => ({ b: p._bucket })), 'b');
    opts(el.sel.age, ['u35', '35', '45', '55'].filter(k => ages.has(k)).map(k => [k, ages.get(k)]), k => AGE_LABELS[k]);
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
      (!state.title || p.title === state.title) &&
      (!state.qual || (p.q || []).includes(state.qual));
  }

  function apply() {
    result = Search.search(people.filter(matchesFilters), state.q);
    list = result.list;
    if (state.sort === 'az') list.sort((a, b) => a.sort.localeCompare(b.sort));
    else if (state.sort === 'za') list.sort((a, b) => b.sort.localeCompare(a.sort));
    else if (SORT_KEY[state.sort]) {
      const [key, dir] = SORT_KEY[state.sort];
      list.sort((a, b) => {
        const x = a[key], y = b[key];
        if (!x || !y) return (x ? -1 : 0) - (y ? -1 : 0) || a.id - b.id; // people without a value go last
        return (x < y ? -1 : x > y ? 1 : 0) * dir || a.id - b.id;
      });
    }
    // Section headings only make sense in plain directory order (not while searching by relevance).
    grouped = state.sort === 'dir' && !result.tokens.length;
    groupCounts = new Map();
    if (grouped) list.forEach(p => groupCounts.set(groupKey(p), (groupCounts.get(groupKey(p)) || 0) + 1));
  }

  function groupKey(p) {
    if (p.cat === 'jo') return p.batch ? 'Batch ' + p.batch : 'Batch not yet listed';
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

  const initials = name => {
    const w = name.replace(/^(Dr|Mr|Mrs|Ms|Miss|Smt)\.\s+/i, '').replace(/^Justice\s+/i, '').split(/\s+/).filter(Boolean);
    return ((w[0] || '')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
  };
  const avatar = p => `<div class="avatar" style="--hue:${AVATAR_HUES[p.id % AVATAR_HUES.length]}" aria-hidden="true">${esc(initials(p.name))}</div>`;

  // The value being sorted on is surfaced on each card so the order is easy to verify.
  function metric(p) {
    if (state.sort.startsWith('age') && p._age != null) return `Age ${p._age}`;
    if (state.sort.startsWith('appt') && p.appt) return `Since ${monthYear(p.appt)}`;
    return '';
  }

  function card(p) {
    const photo = p.ph ? `<img src="img/t/${p.img}.jpg" alt="" loading="lazy" decoding="async" width="320" height="400">` : avatar(p);
    const m = metric(p);
    const tags = [
      m ? `<span class="metric">${m}</span>` : '',
      p.batch ? `<span class="batch">Batch ${p.batch}</span>` : '',
      p.dist ? `<span class="dist">${hl(p.dist, p)}</span>` : '',
    ].join('');
    return `<a class="card" href="#p=${p.id}" data-id="${p.id}">
      <div class="photo">${photo}</div>
      <div class="info">
        <h3 class="name">${hl(p.name, p)}</h3>
        ${p.code ? `<span class="rj" title="RJ code">${hl(p.code, p)}</span>` : ''}
        ${p.role ? `<div class="role">${hl(p.role, p)}</div>` : ''}
        ${tags ? `<div class="tags">${tags}</div>` : ''}
      </div></a>`;
  }

  function renderChunk() {
    if (shown >= list.length) return;
    let html = '';
    for (const p of list.slice(shown, shown + CHUNK)) {
      if (grouped) {
        const k = groupKey(p);
        if (k !== lastKey) {
          lastKey = k;
          html += `<div class="group"><h2>${esc(k)}</h2><span>${fmt(groupCounts.get(k))} ${groupCounts.get(k) === 1 ? 'person' : 'people'}</span></div>`;
        }
      }
      html += card(p);
    }
    shown = Math.min(list.length, shown + CHUNK);
    el.grid.insertAdjacentHTML('beforeend', html);
  }

  function filterLabel(key) {
    const v = state[key];
    return { batch: 'Batch ' + v, role: v, dist: 'District: ' + v, age: 'Age: ' + AGE_LABELS[v], title: 'Title: ' + v, qual: QUAL_LABELS[v] }[key];
  }

  function render({ scroll = false } = {}) {
    apply();
    shown = 0; lastKey = null;
    el.grid.innerHTML = '';
    el.grid.className = 'grid' + (state.view === 'list' ? ' list' : '');
    renderChunk();

    const jo = joAllowed();
    const active = FILTER_KEYS.filter(k => state[k] && (jo || !JO_ONLY.includes(k)));
    const filtered = result.tokens.length || active.length || state.cat !== 'all';
    el.count.innerHTML = filtered
      ? `<b>${fmt(list.length)}</b> of ${fmt(people.length)} people`
      : `<b>${fmt(people.length)}</b> people`;
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
    }
    el.fSort.value = state.sort;
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));

    el.chips.innerHTML = active.map(k =>
      `<span class="chip">${esc(filterLabel(k))}<button type="button" data-clear="${k}" aria-label="Remove filter ${esc(filterLabel(k))}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></span>`).join('');
    el.filterCount.hidden = !active.length;
    el.filterCount.textContent = active.length;

    syncURL();
    fill();
    if (scroll) {
      const top = $('results').getBoundingClientRect().top;
      if (top < $('bar').offsetHeight) $('results').scrollIntoView({ block: 'start' });
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

  // ---------- detail drawer ----------
  let currentId = null;

  function openProfile(id, { push = true } = {}) {
    const p = byId.get(id);
    if (!p) return;
    currentId = id;
    const idx = list.findIndex(x => x.id === id);
    el.dPos.textContent = idx >= 0 ? `${idx + 1} of ${fmt(list.length)}` : '';
    $('dPrev').disabled = idx <= 0;
    $('dNext').disabled = idx < 0 || idx >= list.length - 1;

    const photo = p.ph ? `<img src="img/f/${p.img}.jpg" alt="Photograph of ${esc(p.name)}" width="168" height="210">` : avatar(p);
    const copyIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>';
    const pills = [p.code && `<button type="button" class="pill mono code-pill" data-copy="${esc(p.code)}" title="Copy RJ code" aria-label="RJ code ${esc(p.code)}, click to copy"><span>${esc(p.code)}</span>${copyIcon}</button>`, p.batch && `<span class="pill">Batch ${p.batch}</span>`,
      p._age != null && `<span class="pill">Age ${p._age}</span>`, p.loc && `<span class="pill">${esc(p.loc)}</span>`].filter(Boolean).join('');
    const rows = (p.d || []).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    el.dBody.innerHTML = `
      <div class="d-photo">${photo}</div>
      <h2>${esc(p.name)}</h2>
      ${p.role ? `<p class="d-role">${esc(p.role)}</p>` : ''}
      ${pills ? `<div class="d-pills">${pills}</div>` : ''}
      ${rows ? `<dl class="d-list">${rows}</dl>` : '<p class="d-note">No further details are listed for this person in the source directory.</p>'}`;
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
    const label = b.firstElementChild;
    const done = () => { label.textContent = 'Copied'; setTimeout(() => { label.textContent = b.dataset.copy; }, 1400); };
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

  el.chips.addEventListener('click', e => {
    const b = e.target.closest('[data-clear]');
    if (b) { state[b.dataset.clear] = ''; render(); }
  });
  el.notice.addEventListener('click', e => {
    const b = e.target.closest('[data-suggest]');
    if (b) { state.q = b.dataset.suggest; el.q.value = state.q; render(); }
  });

  function resetAll() {
    Object.assign(state, { q: '', cat: 'all', batch: '', role: '', dist: '', age: '', title: '', qual: '', sort: 'dir' });
    el.q.value = '';
    render({ scroll: true });
  }
  $('reset').addEventListener('click', resetAll);
  $('emptyReset').addEventListener('click', resetAll);

  el.filtersBtn.addEventListener('click', () => {
    const open = el.filters.hidden;
    el.filters.hidden = !open;
    el.filtersBtn.setAttribute('aria-expanded', String(open));
  });

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
  if (FILTER_KEYS.some(k => state[k])) { el.filters.hidden = false; el.filtersBtn.setAttribute('aria-expanded', 'true'); }
  render();
  const m = location.hash.match(/^#p=(\d+)/);
  if (m) openProfile(Number(m[1]), { push: false });
})();
