/* Typo-tolerant search for the directory.
 *
 * 1. Exact pass: every query word must appear somewhere in a person's text.
 * 2. If nothing matches exactly, a fuzzy pass tolerates spelling mistakes:
 *    - edit distance (typos, missing / extra / swapped letters, partial words)
 *    - a phonetic key tuned for Indian names (Sharma = Sarma, Preetam = Pritam,
 *      Mohan = Mohn, Vyas = Wyas, Mahendra = Mahendar ...)
 *    Closest matches are returned together with a "did you mean" suggestion.
 */
(() => {
  'use strict';

  const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();

  // Rough phonetic key: collapses common spelling variants of Indian names.
  function phon(word) {
    let s = word.replace(/[^a-z]/g, '');
    s = s.replace(/ksh/g, 'x').replace(/chh|ch/g, 'C').replace(/ph/g, 'f').replace(/sh/g, 's')
      .replace(/([bdgjkpt])h/g, '$1')
      .replace(/w/g, 'v').replace(/z/g, 'j').replace(/q/g, 'k').replace(/c/g, 'k').replace(/y/g, 'i')
      .replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/ou/g, 'u').replace(/ai|ei/g, 'e')
      .replace(/(.)\1+/g, '$1')
      .replace(/C/g, 'c')
      .replace(/[ah]$/, '');
    return s;
  }

  // Optimal-string-alignment distance (insert / delete / substitute / transpose) with early exit.
  function dist(a, b, max) {
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    let prev2 = null;
    let prev = Array.from({ length: lb + 1 }, (_, j) => j);
    for (let i = 1; i <= la; i++) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= lb; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev; prev = cur;
    }
    return prev[lb];
  }

  // Distance between a typed word and a vocabulary word, allowing the typed word to be a prefix.
  function prefixDist(t, w, max) {
    let d = dist(t, w, max);
    if (w.length > t.length) d = Math.min(d, dist(t, w.slice(0, t.length), max));
    return d;
  }

  const allowedEdits = len => (len < 4 ? 0 : len < 7 ? 1 : 2);

  const vocab = new Map(); // word -> phonetic key

  function prepare(people) {
    for (const p of people) {
      const words = new Set(norm([p.name, p.role, p.dist, p.loc].filter(Boolean).join(' ')).split(' ')
        .filter(w => w.length >= 3 && /^[a-z]+$/.test(w)));
      p._w = [...words];
      p._n = norm([p.name, p.code, p.code && p.code.replace(/^RJ0+/i, 'RJ'), p.role, p.dist,
        p.batch && 'batch ' + p.batch, p.loc].filter(Boolean).join(' '));
      for (const w of p._w) if (!vocab.has(w)) vocab.set(w, phon(w));
    }
  }

  // Score every vocabulary word against one query word. Higher is better, 0 = no match.
  function scoreVocab(token) {
    const out = new Map();
    if (token.length < 4 || /\d/.test(token)) return out;
    const me = allowedEdits(token.length);
    const pt = phon(token);
    const pm = pt.length >= 5 ? 1 : 0;
    for (const [w, pw] of vocab) {
      let best = 0;
      const d = prefixDist(token, w, me);
      if (d <= me) best = 3 - 0.9 * d;
      if (pt.length >= 3) {
        const pd = pw.startsWith(pt) ? 0 : prefixDist(pt, pw, pm);
        if (pd <= pm) best = Math.max(best, 3.2 - 0.7 * pd);
      }
      if (best > 0) out.set(w, best);
    }
    return out;
  }

  // Exact-mode ordering: name matches, especially at the start of a word, come first.
  function rank(p, tokens) {
    const n = norm(p.name);
    return tokens.reduce((s, t) => s + (n.startsWith(t) || n.includes(' ' + t) ? 2 : n.includes(t) ? 1 : 0), 0);
  }

  function search(base, query) {
    const tokens = norm(query).split(' ').filter(Boolean);
    for (const p of base) p._m = null;
    if (!tokens.length) return { list: base.slice(), tokens, fuzzy: false, suggestion: null };

    const exact = base.filter(p => tokens.every(t => p._n.includes(t)));
    if (exact.length) {
      exact.sort((a, b) => rank(b, tokens) - rank(a, tokens) || a.id - b.id);
      return { list: exact, tokens, fuzzy: false, suggestion: null };
    }

    const maps = tokens.map(scoreVocab);
    const scored = [];
    for (const p of base) {
      let total = 0;
      const matched = [];
      let ok = true;
      for (let i = 0; i < tokens.length && ok; i++) {
        const t = tokens[i];
        if (p._n.includes(t)) { total += 4; matched.push(t); continue; }
        let bestS = 0, bestW = null;
        for (const w of p._w) {
          const s = maps[i].get(w);
          if (s && s > bestS) { bestS = s; bestW = w; }
        }
        if (!bestS) ok = false; else { total += bestS; matched.push(bestW); }
      }
      if (ok) scored.push({ p, total, matched });
    }
    if (!scored.length) return { list: [], tokens, fuzzy: true, suggestion: null };

    const top = Math.max(...scored.map(x => x.total));
    const keep = scored.filter(x => x.total >= top - 1.3 * tokens.length)
      .sort((a, b) => b.total - a.total || a.p.id - b.p.id).slice(0, 200);
    keep.forEach(x => { x.p._m = new Set(x.matched); });

    // "Did you mean": the most common corrected spelling of each word among the best results.
    const words = tokens.map((t, i) => {
      const tally = new Map();
      keep.slice(0, 12).forEach(x => tally.set(x.matched[i], (tally.get(x.matched[i]) || 0) + 1));
      return [...tally].sort((a, b) => b[1] - a[1])[0][0];
    });
    const suggestion = words.join(' ') !== tokens.join(' ') ? words.join(' ') : null;
    return { list: keep.map(x => x.p), tokens, fuzzy: true, suggestion };
  }

  window.DirSearch = { prepare, search, norm, phon, dist };
})();
