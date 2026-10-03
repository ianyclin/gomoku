// 戰績（規格 F、J、P）：每局一筆存 localStorage `gomoku.games.v1`；摘要、每月勝率趨勢圖（內嵌 SVG）、積分走勢、最近 20 局、匯出匯入、清除。
// 本機帳號（規格 P）也在這裡：`gomoku.profiles.v1`；詰棋紀錄按帳號存在 `gomoku.puzzles.v2`。
// 一筆的欄位：ts（開局時間戳，也是去重鍵）、at（結束時間）、mode 'pve'|'pvp'、tier 1–12（雙人為 null；12＝天元）、tierScale 11、rule、strict、
// human 1|2（雙人為 null）、result（單人 'win'|'loss'|'draw'；雙人 'black'|'white'|'draw'）、n 手數、end 結束原因、
// forbidden 禁手種類、losing 敗著手數（復盤算過才有）、opening 開局代號、moves [[r,c],…]、
// pid（單人：玩家帳號）、pidB／pidW（雙人：執黑／執白的帳號）、elo（結算：{ 帳號 id: { before, after, exp, opp, score, games, badgeBefore, badgeAfter } }）、
// eloSkip（'same'：雙人同帳號不計分）。
// 第五批以前的紀錄沒有 tierScale（九階）與帳號欄位；開頁時一次轉成新格式，歸到預設帳號（見 initProfiles、upgrade）。
(function () {
  'use strict';
  var KEY = 'gomoku.games.v1';
  var PKEY = 'gomoku.profiles.v1';
  var PZ1 = 'gomoku.puzzles.v1';   // 舊：{ 題目 id: { ok, tries, type, n } }
  var PZ2 = 'gomoku.puzzles.v2';   // 新：{ 帳號 id: { 題目 id: { ok, tries, type, n } } }
  var MAX = 500;
  var MAX_PROFILES = 8;
  var START = 600;
  var GROUPS = ['novice', 'easy', 'medium', 'hard', 'expert'];
  // 天元那一批：最強那一級多一段天元（階 12）。tierScale 仍是 11（「十一階那一套編號」：1–11 不變，12 接在後面），舊紀錄不用轉
  var GROUP_TIERS = { novice: [1], easy: [2, 3, 4], medium: [5, 6, 7, 8], hard: [9, 10], expert: [11, 12] };
  var MAX_TIER = 12;
  var LEGACY = { novice: 1, easy: 3, medium: 7, hard: 8, expert: 9 }; // 舊字串檔次（九階的階數；舊紀錄的 easy 視為「弱」）
  var MIG = [0, 1, 2, 3, 4, 5, 6, 8, 10, 11]; // 舊九階 → 新十一階（契約；引擎有 Gomoku.migrateTier 時用引擎的）
  var COLORS = { novice: '#8a8a8a', easy: '#2e7d32', medium: '#1565c0', hard: '#ef6c00', expert: '#c62828' };
  var DAY = 86400000;

  function migrateTier(old) {
    var G = window.Gomoku;
    if (G && typeof G.migrateTier === 'function') return G.migrateTier(old);
    return MIG[old] || null;
  }

  function valid(g) {
    return g && typeof g.ts === 'number' && isFinite(g.ts) && Array.isArray(g.moves) &&
      (g.mode === 'pve' || g.mode === 'pvp') && typeof g.result === 'string';
  }
  function timeOf(g) { return typeof g.at === 'number' ? g.at : g.ts; }
  function byTime(a, b) { return timeOf(a) - timeOf(b) || a.ts - b.ts; }

  function load() {
    var a;
    try { a = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { a = []; }
    return Array.isArray(a) ? a.filter(valid) : [];
  }
  function save(list) {
    list.sort(byTime);
    if (list.length > MAX) list = list.slice(list.length - MAX);
    try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }
  // 同一局（同一個 ts）再存一次就取代（悔棋後重新下完的情形）
  function upsert(rec) {
    var list = load().filter(function (g) { return g.ts !== rec.ts; });
    list.push(rec);
    return save(list);
  }
  function setLosing(ts, moveNo) {
    var list = load(), hit = false;
    list.forEach(function (g) { if (g.ts === ts && g.losing !== moveNo) { g.losing = moveNo; hit = true; } });
    if (hit) save(list);
  }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) { /* 無 */ } }
  function find(ts) {
    var list = load();
    for (var i = 0; i < list.length; i++) if (list[i].ts === ts) return list[i];
    return null;
  }

  // 舊紀錄的階（九階）
  function legacyTier(g) {
    if (typeof g.tier === 'number' && g.tier >= 1 && g.tier <= 9) return g.tier;
    if (typeof g.tier === 'string' && LEGACY[g.tier]) return LEGACY[g.tier];
    if (g.level && LEGACY[g.level]) return LEGACY[g.level];
    return null;
  }
  function tierOf(g) {
    if (g.mode === 'pvp') return null;
    if (g.tierScale === 11) return typeof g.tier === 'number' && g.tier >= 1 && g.tier <= MAX_TIER ? g.tier : null;
    var old = legacyTier(g);
    return old ? migrateTier(old) : null;
  }
  function groupOf(tier) {
    if (!tier) return null;
    return tier <= 1 ? 'novice' : tier <= 4 ? 'easy' : tier <= 8 ? 'medium' : tier <= 10 ? 'hard' : 'expert';
  }

  // 舊格式 → 新格式（原地改；已是新格式的欄位不動，所以重跑無害）。pid：沒有帳號欄位時歸給誰。
  function upgrade(g, pid) {
    var changed = false;
    if (g.tierScale !== 11) {
      g.tier = tierOf(g);
      g.tierScale = 11;
      changed = true;
    }
    if (g.mode === 'pve' && !g.pid && pid) { g.pid = pid; changed = true; }
    if (g.mode === 'pvp' && !g.pidB && !g.pidW && pid) { g.pidB = pid; g.pidW = pid; changed = true; }
    return changed;
  }

  // 這個帳號的紀錄：單人是他下的；雙人是他執黑或執白的
  function involves(g, pid) {
    return g.mode === 'pve' ? g.pid === pid : (g.pidB === pid || g.pidW === pid);
  }
  function loadFor(pid) { return load().filter(function (g) { return involves(g, pid); }); }
  function clearFor(pid) {
    var all = load(), keep = all.filter(function (g) { return !involves(g, pid); });
    if (keep.length !== all.length) save(keep);
    return all.length - keep.length;
  }

  // 積分走勢：這個帳號最近 n 局有結算的，依時間排
  function ratingSeries(pid, n) {
    return load().filter(function (g) { return g.elo && g.elo[pid] && typeof g.elo[pid].after === 'number'; })
      .sort(byTime).slice(-(n || 50)).map(function (g) { return { ts: g.ts, before: g.elo[pid].before, after: g.elo[pid].after }; });
  }

  // ---------------------------------------------------------- 本機帳號（規格 P）
  // 存法：{ v: 1, current: id, defaultId: id, list: [{ id, name, emoji, rating, games, created, badge, pref, theme, forbid }] }
  // badge：目前徽章（降級要有緩衝，所以要記住上一個）；pref：這個帳號在選單選的檔次 { group, sub: { easy, medium, hard } }。

  function newId() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function validProfile(p) { return p && typeof p.id === 'string' && p.id && typeof p.name === 'string'; }
  function cleanProfile(p) {
    return {
      id: p.id, name: String(p.name).slice(0, 24), emoji: typeof p.emoji === 'string' ? p.emoji : '',
      rating: typeof p.rating === 'number' && isFinite(p.rating) ? p.rating : START,
      games: typeof p.games === 'number' && p.games >= 0 ? p.games : 0,
      created: typeof p.created === 'number' ? p.created : Date.now(),
      badge: typeof p.badge === 'string' ? p.badge : null,
      pref: p.pref && typeof p.pref === 'object' ? p.pref : null,
      theme: typeof p.theme === 'string' ? p.theme : null, // 第八批 b：棋盤風格（規格 S，每個帳號可不同；null＝經典）
      // 第十三批 b（規格 U）：連珠規則下黑棋下到不能下的點時：'block' 不讓下／'lose' 算黑棋輸；null＝還沒選過（app.js 當成不讓下）
      forbid: p.forbid === 'block' || p.forbid === 'lose' ? p.forbid : null
    };
  }
  function readProfiles() {
    var st;
    try { st = JSON.parse(localStorage.getItem(PKEY) || 'null'); } catch (e) { st = null; }
    if (!st || !Array.isArray(st.list)) return null;
    st.list = st.list.filter(validProfile).map(cleanProfile);
    if (!st.list.length) return null;
    if (!st.list.some(function (p) { return p.id === st.current; })) st.current = st.list[0].id;
    if (!st.list.some(function (p) { return p.id === st.defaultId; })) st.defaultId = st.list[0].id;
    return st;
  }
  function writeProfiles(st) {
    try { localStorage.setItem(PKEY, JSON.stringify(st)); return true; } catch (e) { return false; }
  }
  function makeProfile(name, emoji, badge) {
    return { id: newId(), name: name, emoji: emoji || '', rating: START, games: 0, created: Date.now(), badge: badge || null, pref: null };
  }

  // 開頁時呼叫一次。還沒有帳號：建預設帳號，舊戰績、舊詰棋紀錄、舊設定的檔次都歸給它。
  // 已經有帳號：把還是舊格式的紀錄（例如上次遷移中途被關掉）補轉成新格式。
  // opts = { name, emoji, badge, pref }
  function initProfiles(opts) {
    var st = readProfiles(), created = false;
    if (!st) {
      var p = makeProfile(opts.name, opts.emoji, opts.badge);
      p.pref = opts.pref || null;
      st = { v: 1, current: p.id, defaultId: p.id, list: [p] };
      writeProfiles(st); // 先存帳號再改紀錄：中途關掉時，下次開頁仍會把紀錄歸給這個帳號
      created = true;
    }
    var list = load(), changed = false;
    list.forEach(function (g) { if (upgrade(g, st.defaultId)) changed = true; });
    if (changed) save(list);
    if (created) {
      var old = null, now = null;
      try { old = JSON.parse(localStorage.getItem(PZ1) || 'null'); now = JSON.parse(localStorage.getItem(PZ2) || 'null'); } catch (e) { old = null; }
      if (old && typeof old === 'object' && !now) {
        var v2 = {};
        v2[st.defaultId] = old;
        try { localStorage.setItem(PZ2, JSON.stringify(v2)); } catch (e) { /* 不存 */ }
      }
    }
    return st;
  }
  function profilesStore() { return readProfiles(); }
  function profileList() { var st = readProfiles(); return st ? st.list : []; }
  function profile(id) {
    var list = profileList();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function current() {
    var st = readProfiles();
    if (!st) return null;
    for (var i = 0; i < st.list.length; i++) if (st.list[i].id === st.current) return st.list[i];
    return null;
  }
  function setCurrent(id) {
    var st = readProfiles();
    if (!st || !st.list.some(function (p) { return p.id === id; })) return false;
    st.current = id;
    return writeProfiles(st);
  }
  function addProfile(name, emoji, badge) {
    var st = readProfiles();
    if (!st || st.list.length >= MAX_PROFILES) return null;
    var p = makeProfile(name, emoji, badge);
    st.list.push(p);
    writeProfiles(st);
    return p;
  }
  function updateProfile(id, patch) {
    var st = readProfiles();
    if (!st) return null;
    var hit = null;
    st.list.forEach(function (p) {
      if (p.id !== id) return;
      Object.keys(patch).forEach(function (k) { if (k !== 'id') p[k] = patch[k]; });
      hit = p;
    });
    if (hit) writeProfiles(st);
    return hit;
  }
  // 刪帳號：連同他的戰績（含雙打）與詰棋紀錄。最後一個不能刪。
  function deleteProfile(id) {
    var st = readProfiles();
    if (!st || st.list.length <= 1 || !st.list.some(function (p) { return p.id === id; })) return false;
    clearFor(id);
    var pz = pzAll();
    if (pz[id]) { delete pz[id]; try { localStorage.setItem(PZ2, JSON.stringify(pz)); } catch (e) { /* 不存 */ } }
    st.list = st.list.filter(function (p) { return p.id !== id; });
    if (st.current === id) st.current = st.list[0].id;
    if (st.defaultId === id) st.defaultId = st.list[0].id;
    return writeProfiles(st);
  }

  // ---------------------------------------------------------- 匯出、匯入（含帳號與積分）

  // 第十二批 c：匯出多帶練習題紀錄（puzzles＝gomoku.puzzles.v2 的內容：{ 帳號 id: { 題目 id: { ok, tries, type, n } } }）
  function exportText() {
    return JSON.stringify({ app: 'gomoku', key: KEY, v: 2, exported: new Date().toISOString(),
      profiles: readProfiles(), games: load(), puzzles: pzAll() }, null, 1);
  }
  // 帳號：id 本機沒有的才加（最多 8 個）；本機已有的帳號保留本機的積分。
  // 對局：以 ts 去重；舊格式（沒有帳號欄位）的歸到 curPid；屬於本機沒有、也沒匯入成功的帳號的，略過（算在 bad）。
  function importText(text, curPid) {
    var data;
    var fail = { error: true, added: 0, dup: 0, bad: 0, profiles: 0 };
    try { data = JSON.parse(text); } catch (e) { return fail; }
    var arr = Array.isArray(data) ? data : data && Array.isArray(data.games) ? data.games : null;
    if (!arr) return fail;
    var st = readProfiles(), known = {}, addedP = 0;
    st.list.forEach(function (p) { known[p.id] = 1; });
    var inc = data && data.profiles ? (Array.isArray(data.profiles) ? data.profiles : data.profiles.list) : null;
    (Array.isArray(inc) ? inc : []).forEach(function (p) {
      if (!validProfile(p) || known[p.id] || st.list.length >= MAX_PROFILES) return;
      st.list.push(cleanProfile(p));
      known[p.id] = 1;
      addedP++;
    });
    if (addedP) writeProfiles(st);
    var list = load(), have = {}, added = 0, dup = 0, bad = 0;
    list.forEach(function (g) { have[g.ts] = 1; });
    arr.forEach(function (g) {
      if (!valid(g)) { bad++; return; }
      upgrade(g, curPid);
      var owner = g.mode === 'pve' ? known[g.pid] : (known[g.pidB] || known[g.pidW]);
      if (!owner) { bad++; return; }
      if (have[g.ts]) { dup++; return; }
      have[g.ts] = 1;
      list.push(g);
      added++;
    });
    save(list);
    // 練習題紀錄（第十二批 c）：只收本機有的帳號（含這次匯入的）；同一個帳號的同一題，本機已經有就保留本機的，沒有才加。
    // 舊的匯出檔沒有 puzzles 這一欄，就跳過這段。
    var pin = data && data.puzzles && typeof data.puzzles === 'object' && !Array.isArray(data.puzzles) ? data.puzzles : null;
    if (pin) {
      var pz = pzAll(), pzChanged = false;
      Object.keys(pin).forEach(function (pid) {
        var src = pin[pid];
        if (!known[pid] || !src || typeof src !== 'object' || Array.isArray(src)) return;
        var dst = pz[pid] && typeof pz[pid] === 'object' ? pz[pid] : {};
        Object.keys(src).forEach(function (qid) {
          var r = src[qid];
          if (Object.prototype.hasOwnProperty.call(dst, qid) || !r || typeof r !== 'object') return;
          dst[qid] = { ok: Number(r.ok) || 0, tries: Number(r.tries) || 0, type: r.type === 'defend' ? 'defend' : 'attack', n: Number(r.n) || 0 };
          pzChanged = true;
        });
        pz[pid] = dst;
      });
      if (pzChanged) { try { localStorage.setItem(PZ2, JSON.stringify(pz)); } catch (e) { /* 不存 */ } }
    }
    return { error: false, added: added, dup: dup, bad: bad, profiles: addedP };
  }

  // ---------------------------------------------------------- 統計

  function pveOnly(list) { return list.filter(function (g) { return g.mode === 'pve' && tierOf(g); }); }

  function summary(list, now) {
    var pve = pveOnly(list);
    var byGroup = {}, byTier = {};
    GROUPS.forEach(function (k) { byGroup[k] = { w: 0, n: 0 }; });
    for (var tr = 1; tr <= MAX_TIER; tr++) byTier[tr] = { w: 0, n: 0 };
    pve.forEach(function (g) {
      var tr2 = tierOf(g), gg = groupOf(tr2);
      byGroup[gg].n++; byTier[tr2].n++;
      if (g.result === 'win') { byGroup[gg].w++; byTier[tr2].w++; }
    });
    var sorted = pve.slice().sort(byTime), streak = 0;
    for (var i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].result !== 'win') break;
      streak++;
    }
    var recent = list.filter(function (g) { return timeOf(g) >= now - 30 * DAY; }).length;
    return { total: list.length, pve: pve.length, pvp: list.length - pve.length, byGroup: byGroup, byTier: byTier, streak: streak, recent30: recent };
  }

  // 最近 12 個月（含本月），每檔每月 {w, n}
  function monthly(list, now) {
    var d = new Date(now), months = [];
    for (var k = 11; k >= 0; k--) {
      var x = new Date(d.getFullYear(), d.getMonth() - k, 1);
      months.push({ y: x.getFullYear(), m: x.getMonth() + 1 });
    }
    var index = {};
    months.forEach(function (mo, i) { index[mo.y * 100 + mo.m] = i; });
    var series = {};
    GROUPS.forEach(function (gk) { series[gk] = months.map(function () { return { w: 0, n: 0 }; }); });
    pveOnly(list).forEach(function (g) {
      var dt = new Date(timeOf(g)), i = index[dt.getFullYear() * 100 + dt.getMonth() + 1];
      if (i == null) return;
      var cell = series[groupOf(tierOf(g))][i];
      cell.n++;
      if (g.result === 'win') cell.w++;
    });
    return { months: months, series: series };
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); }

  function chartSVG(list, now, t) {
    var M = monthly(list, now);
    var W = 340, H = 220, L = 36, Rm = 12, T = 14, B = 30;
    var pw = W - L - Rm, ph = H - T - B;
    function X(i) { return L + i * pw / 11; }
    function Y(v) { return T + (1 - v) * ph; }
    var s = '<svg class="trend" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(t('stats.chartLabel')) + '">';
    [0, 0.5, 1].forEach(function (v) {
      s += '<line x1="' + L + '" y1="' + Y(v) + '" x2="' + (W - Rm) + '" y2="' + Y(v) + '" stroke="#d8c3a0" stroke-width="1"' + (v === 0.5 ? ' stroke-dasharray="3 3"' : '') + '/>';
      s += '<text x="' + (L - 5) + '" y="' + (Y(v) + 4) + '" text-anchor="end" font-size="11" fill="#6b5537">' + Math.round(v * 100) + '%</text>';
    });
    M.months.forEach(function (mo, i) {
      var lab = (mo.m === 1 || i === 0) ? t('chart.monthYear', { y: String(mo.y).slice(2), m: mo.m }) : t('chart.month', { m: mo.m });
      s += '<text x="' + X(i) + '" y="' + (H - 10) + '" text-anchor="middle" font-size="10.5" fill="#6b5537">' + esc(lab) + '</text>';
    });
    var labels = [];
    GROUPS.forEach(function (gk, gi) {
      var pts = [];
      M.series[gk].forEach(function (cell, i) { if (cell.n) pts.push({ i: i, w: cell.w, n: cell.n }); });
      if (!pts.length) return;
      var col = COLORS[gk];
      if (pts.length > 1) {
        s += '<polyline fill="none" stroke="' + col + '" stroke-width="2" points="' +
          pts.map(function (p) { return X(p.i).toFixed(1) + ',' + Y(p.w / p.n).toFixed(1); }).join(' ') + '"/>';
      }
      pts.forEach(function (p) {
        var x = X(p.i), y = Y(p.w / p.n), hollow = p.n < 3;
        s += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="4" fill="' + (hollow ? '#fff' : col) + '" stroke="' + col + '" stroke-width="2"/>';
        // 點旁標勝/局：上下交錯
        var dy = gi % 2 ? 17 : -9;
        if (y + dy > H - B + 4) dy = -8;
        if (y + dy < T - 2) dy = 15;
        labels.push({ i: p.i, x: x, y: y + dy, col: col, text: p.w + '/' + p.n });
      });
    });
    // 同一個月的字依高度排開，至少隔 12px，免得兩條線的點靠太近時字疊在一起
    for (var mi = 0; mi < 12; mi++) {
      var ls = labels.filter(function (l) { return l.i === mi; }).sort(function (a2, b2) { return a2.y - b2.y; });
      for (var k = 1; k < ls.length; k++) if (ls[k].y - ls[k - 1].y < 12) ls[k].y = ls[k - 1].y + 12;
      var over = ls.length ? ls[ls.length - 1].y - (H - B + 8) : 0;
      if (over > 0) ls.forEach(function (l) { l.y -= over; });
    }
    labels.forEach(function (l) {
      // 字留在自己那一欄；最右（本月）與最左兩欄往內靠，免得被切掉
      var anchor = l.i === 11 ? 'end' : l.i === 0 ? 'start' : 'middle';
      var tx = l.i === 11 ? l.x + 4 : l.i === 0 ? l.x - 4 : l.x;
      s += '<text x="' + tx.toFixed(1) + '" y="' + l.y.toFixed(1) + '" text-anchor="' + anchor + '"' +
        ' font-size="11" font-weight="600" fill="' + l.col + '" stroke="#fffaf0" stroke-width="3" paint-order="stroke">' + l.text + '</text>';
    });
    return s + '</svg>';
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtDate(ms) {
    var d = new Date(ms);
    return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function rate(o, t) {
    if (!o.n) return t('stats.none');
    return t('stats.rate', { w: o.w, n: o.n, p: Math.round(100 * o.w / o.n) });
  }

  // ---------------------------------------------------------- 詰棋答題紀錄（規格 O、P；按帳號存 gomoku.puzzles.v2：{ 帳號 id: { 題目 id: { ok, tries, type, n } } }）

  function pzAll() {
    var all;
    try { all = JSON.parse(localStorage.getItem(PZ2) || '{}') || {}; } catch (e) { all = {}; }
    return typeof all === 'object' && !Array.isArray(all) ? all : {};
  }
  function pzLoad(pid) { var a = pzAll()[pid]; return a && typeof a === 'object' ? a : {}; }
  function pzSave(pid, obj) {
    var all = pzAll();
    all[pid] = obj;
    try { localStorage.setItem(PZ2, JSON.stringify(all)); } catch (e) { /* 不存 */ }
  }
  function puzzleStats(pid) {
    var all = pzLoad(pid);
    var out = { attack: {}, defend: {}, tries: 0 };
    [1, 2, 3, 4, 5].forEach(function (n) { out.attack[n] = { ok: 0, tries: 0 }; out.defend[n] = { ok: 0, tries: 0 }; });
    Object.keys(all).forEach(function (id) {
      var r = all[id], k = r && r.type === 'defend' ? 'defend' : 'attack';
      if (!r || !out[k][r.n]) return;
      out[k][r.n].ok += r.ok || 0;
      out[k][r.n].tries += r.tries || 0;
      out.tries += r.tries || 0;
    });
    return out;
  }

  // ---------------------------------------------------------- 畫面

  function mk(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // 積分走勢（規格 P）：最近 50 局一條線；第一點是那一段開始前的積分
  function ratingChartSVG(series, t) {
    var vals = [series[0].before].concat(series.map(function (p) { return p.after; }));
    var W = 340, H = 150, L = 40, Rm = 12, T = 12, B = 14;
    var pw = W - L - Rm, ph = H - T - B;
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var mid = (lo + hi) / 2, span = Math.max(hi - lo, 60) / 2 + 10;
    lo = Math.floor((mid - span) / 10) * 10;
    hi = Math.ceil((mid + span) / 10) * 10;
    function X(i) { return L + (vals.length > 1 ? i * pw / (vals.length - 1) : pw / 2); }
    function Y(v) { return T + (hi - v) / (hi - lo) * ph; }
    var s = '<svg class="trend rating-trend" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(t('stats.ratingChartLabel')) + '">';
    [hi, Math.round((hi + lo) / 2), lo].forEach(function (v, k) {
      s += '<line x1="' + L + '" y1="' + Y(v).toFixed(1) + '" x2="' + (W - Rm) + '" y2="' + Y(v).toFixed(1) + '" stroke="#d8c3a0" stroke-width="1"' + (k === 1 ? ' stroke-dasharray="3 3"' : '') + '/>';
      s += '<text x="' + (L - 5) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="#6b5537">' + v + '</text>';
    });
    var col = '#8b5a2b';
    s += '<polyline fill="none" stroke="' + col + '" stroke-width="2" stroke-linejoin="round" points="' +
      vals.map(function (v, i) { return X(i).toFixed(1) + ',' + Y(v).toFixed(1); }).join(' ') + '"/>';
    var li = vals.length - 1, lx = X(li), ly = Y(vals[li]);
    s += '<circle cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="4" fill="' + col + '"/>';
    s += '<text x="' + (lx - 6).toFixed(1) + '" y="' + (ly < T + 14 ? ly + 16 : ly - 8).toFixed(1) + '" text-anchor="end" font-size="11" font-weight="600" fill="' + col +
      '" stroke="#fffaf0" stroke-width="3" paint-order="stroke">' + Math.round(vals[li]) + '</text>';
    return s + '</svg>';
  }

  // env = { t, tierName, colorName, onReview(rec), pid, profile, badgeId(profile), badgeName(id) }
  function render(root, env) {
    var t = env.t;
    var list = loadFor(env.pid), now = Date.now();
    root.textContent = '';
    // 清除只清這個帳號，沒紀錄就不能按；匯出含全部帳號，永遠可按
    var cb = document.getElementById('clearBtn');
    if (cb) cb.disabled = !list.length;

    // 積分與徽章（沒有對局也顯示）
    var pr = env.profile;
    if (pr) {
      var rc0 = mk('div', 'stat-cell wide rating-cell');
      rc0.appendChild(mk('div', 'stat-label', t('stats.rating')));
      var rv = mk('div', 'stat-value');
      rv.appendChild(document.createTextNode(String(Math.round(pr.rating)) + ' '));
      var bid = env.badgeId(pr);
      if (bid) rv.appendChild(mk('span', 'badge b-' + bid, env.badgeName(bid)));
      rc0.appendChild(rv);
      rc0.appendChild(mk('div', 'stat-sub', t('stats.ratingSub', { games: pr.games })));
      var series = ratingSeries(env.pid, 50);
      rc0.appendChild(mk('div', 'stat-label rating-h', t('stats.ratingTrend', { n: series.length })));
      if (series.length) {
        var rh = mk('div', 'chart');
        rh.innerHTML = ratingChartSVG(series, t);
        rc0.appendChild(rh);
      } else rc0.appendChild(mk('p', 'stat-sub', t('stats.ratingNone')));
      root.appendChild(rc0);
    }

    if (!list.length) {
      root.appendChild(mk('p', 'empty-note', t('stats.empty')));
      var ps0 = puzzleStats(env.pid);
      if (ps0.tries) root.appendChild(puzzleCell(ps0, t));
      return;
    }
    var s = summary(list, now);

    var grid = mk('div', 'stat-grid');
    function cell(label, value, sub) {
      var c = mk('div', 'stat-cell');
      c.appendChild(mk('div', 'stat-label', label));
      c.appendChild(mk('div', 'stat-value', value));
      if (sub) c.appendChild(mk('div', 'stat-sub', sub));
      return c;
    }
    grid.appendChild(cell(t('stats.total'), String(s.total), t('stats.totalSub', { pve: s.pve, pvp: s.pvp })));
    grid.appendChild(cell(t('stats.streak'), String(s.streak)));
    grid.appendChild(cell(t('stats.recent30'), String(s.recent30)));
    root.appendChild(grid);
    // 第十四批（W 第 5 條）：哪些盤會記、悔棋算不算分
    root.appendChild(mk('p', 'stat-sub count-note', t('stats.countNote')));

    var wr = mk('div', 'stat-cell wide');
    wr.appendChild(mk('div', 'stat-label', t('stats.winRate')));
    var tb = mk('table', 'rate-table');
    GROUPS.forEach(function (gk) {
      var tr = mk('tr', 'grp');
      var th = mk('th');
      var dot = mk('i', 'swatch');
      dot.style.background = COLORS[gk];
      th.appendChild(dot);
      th.appendChild(document.createTextNode(t('group.' + gk)));
      tr.appendChild(th);
      tr.appendChild(mk('td', '', rate(s.byGroup[gk], t)));
      tb.appendChild(tr);
      if (GROUP_TIERS[gk].length > 1) {
        GROUP_TIERS[gk].forEach(function (tier) {
          var sr = mk('tr', 'sub');
          sr.appendChild(mk('th', '', env.tierName(tier)));
          sr.appendChild(mk('td', '', rate(s.byTier[tier], t)));
          tb.appendChild(sr);
        });
      }
    });
    wr.appendChild(tb);
    root.appendChild(wr);

    var ch = mk('div', 'stat-cell wide');
    ch.appendChild(mk('div', 'stat-label', t('stats.trend')));
    if (s.pve) {
      var holder = mk('div', 'chart');
      holder.innerHTML = chartSVG(list, now, t);
      ch.appendChild(holder);
      var lg = mk('div', 'chart-legend');
      GROUPS.forEach(function (gk) {
        var it = mk('span', 'lg-item');
        var dot = mk('i', 'swatch');
        dot.style.background = COLORS[gk];
        it.appendChild(dot);
        it.appendChild(document.createTextNode(t('group.' + gk)));
        lg.appendChild(it);
      });
      ch.appendChild(lg);
      ch.appendChild(mk('p', 'stat-sub', t('stats.trendNote')));
    } else ch.appendChild(mk('p', 'empty-note', t('stats.noPve')));
    root.appendChild(ch);

    var rc = mk('div', 'stat-cell wide');
    rc.appendChild(mk('div', 'stat-label', t('stats.recent')));
    var ul = mk('ul', 'game-list');
    list.slice().sort(byTime).reverse().slice(0, 20).forEach(function (g) {
      var li = mk('li');
      var b = mk('button', 'game-row');
      b.type = 'button';
      var who = g.mode === 'pvp' ? t('stats.pvpShort') : env.tierName(tierOf(g));
      var res;
      if (g.mode === 'pvp') res = g.result === 'draw' ? t('stats.draw') : t('stats.colorWin', { color: env.colorName(g.result === 'black' ? 1 : 2) });
      else res = t('stats.res.' + g.result);
      b.appendChild(mk('span', 'gr-date', fmtDate(timeOf(g))));
      // 第二十四批（judge 第十三輪 F3）：名字下面一行小字寫這盤的棋鐘設定、時間用完、教學局（app.js 的 recTags 給字）
      var wb = mk('span', 'gr-who'), tags = env.recTags ? env.recTags(g) : [];
      wb.appendChild(mk('span', 'gr-name', who));
      if (tags.length) wb.appendChild(mk('small', 'gr-tag', tags.join(t('game.infoSep'))));
      b.appendChild(wb);
      b.appendChild(mk('span', 'gr-res res-' + g.result, res));
      b.appendChild(mk('span', 'gr-n', t('stats.moves', { n: g.n || g.moves.length })));
      b.setAttribute('aria-label', t('stats.openReview') + ' ' + b.textContent);
      b.addEventListener('click', function () { env.onReview(g); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    rc.appendChild(ul);
    rc.appendChild(mk('p', 'stat-sub', t('stats.recentNote', { max: MAX })));
    root.appendChild(rc);
    root.appendChild(puzzleCell(puzzleStats(env.pid), t));
  }

  function puzzleCell(ps, t) {
    var cell = mk('div', 'stat-cell wide');
    cell.appendChild(mk('div', 'stat-label', t('stats.puzzles')));
    if (!ps.tries) { cell.appendChild(mk('p', 'stat-sub', t('stats.pzNone'))); return cell; }
    var tb = mk('table', 'rate-table');
    [['attack', 'stats.pzAttack'], ['defend', 'stats.pzDefend']].forEach(function (k) {
      // 第十三批 b：第 1 級叫「入門」
      [1, 2, 3, 4, 5].forEach(function (n) {
        var o = ps[k[0]][n], tr = mk('tr', 'grp');
        tr.appendChild(mk('th', '', n === 1 ? t(k[1] + 'Starter') : t(k[1], { n: n })));
        tr.appendChild(mk('td', '', o.tries ? t('stats.rate', { w: o.ok, n: o.tries, p: Math.round(100 * o.ok / o.tries) }) : t('stats.none')));
        tb.appendChild(tr);
      });
    });
    cell.appendChild(tb);
    return cell;
  }

  window.GStats = {
    KEY: KEY, PKEY: PKEY, MAX: MAX, MAX_PROFILES: MAX_PROFILES, START: START,
    load: load, save: save, upsert: upsert, setLosing: setLosing, clear: clear, find: find, byTime: byTime,
    loadFor: loadFor, clearFor: clearFor, involves: involves, ratingSeries: ratingSeries,
    tierOf: tierOf, groupOf: groupOf, migrateTier: migrateTier, upgrade: upgrade,
    initProfiles: initProfiles, profilesStore: profilesStore, profileList: profileList, profile: profile, current: current,
    setCurrent: setCurrent, addProfile: addProfile, updateProfile: updateProfile, deleteProfile: deleteProfile,
    pzLoad: pzLoad, pzSave: pzSave,
    summary: summary, monthly: monthly, chartSVG: chartSVG, ratingChartSVG: ratingChartSVG, puzzleStats: puzzleStats,
    exportText: exportText, importText: importText,
    render: render
  };
})();
