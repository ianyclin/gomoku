// 戰績（規格 F、J、P）：每局一筆存 localStorage `gomoku.games.v1`；摘要、每月勝率趨勢圖（內嵌 SVG）、積分走勢、最近 20 局、匯出匯入、清除。
// 本機帳號（規格 P）也在這裡：`gomoku.profiles.v1`；詰棋紀錄按帳號存在 `gomoku.puzzles.v2`。
// 一筆的欄位：ts（開局時間戳，也是去重鍵）、at（結束時間）、mode 'pve'|'pvp'、tier 1–13（雙人為 null；12＝天元、13＝入門・2〔v0.5.13〕）、tierScale 11、rule、strict、
// human 1|2（雙人為 null）、result（單人 'win'|'loss'|'draw'；雙人 'black'|'white'|'draw'）、n 手數、end 結束原因、
// forbidden 禁手種類、losing 敗著手數（復盤算過才有）、opening 開局代號、moves [[r,c],…]、
// pid（單人：玩家帳號）、pidB／pidW（雙人：執黑／執白的帳號）、elo（結算：{ 帳號 id: { before, after, exp, opp, score, games, badgeBefore, badgeAfter } }）、
// eloSkip（'same'：雙人同帳號不計分）。
// v0.5.11（規格 AO）：end 多三種——'resign' 認輸（跟電腦下＝你認輸；兩人一起下＝輸的那一方認輸）、'agreed' 兩人說好和棋（求和，result 'draw'）、
// 'abandon' 跟電腦下超過 10 手放棄（result 'loss'）。舊紀錄沒有這三種（或沒有 end）照舊讀；result 照舊是勝負，統計不用另外算。
// 第五批以前的紀錄沒有 tierScale（九階）與帳號欄位；開頁時一次轉成新格式，歸到預設帳號（見 initProfiles、upgrade）。
// v0.5.17（規格 AV）：每日一題與成就的純函式、存取（存在帳號資料裡）、紀錄頁的「成就」區塊也在這裡（見「每日一題、成就」那一段）。
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
  // v0.5.13（規格 AF）：入門分成入門・1（階 1）、入門・2（新的階號 13，不重編號）。tierScale 照舊是 11：1–12 的意思不變、13 接在後面，
  // 舊紀錄、舊匯出檔一筆都不用轉；MAX_TIER 是「認得的最大階號」，不是最強的那一階（先後看 GROUP_TIERS 的分組，不比階號大小）
  var GROUP_TIERS = { novice: [1, 13], easy: [2, 3, 4], medium: [5, 6, 7, 8], hard: [9, 10], expert: [11, 12] };
  var MAX_TIER = 13;
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
  // v0.5.11（規格 AO）：放棄這盤算不算輸。雙方合計下超過 ABANDON_FREE 手、而且是跟電腦下才算（算你輸）；
  // 10 手以內照舊不記（剛開局點錯想重來）；兩人一起下放棄一律不記（同一台裝置，分不出是誰按的；要分輸贏用「認輸」「求和」）
  var ABANDON_FREE = 10;
  function abandonIsLoss(mode, n) { return mode === 'pve' && typeof n === 'number' && n > ABANDON_FREE; }
  // 紀錄怎麼結束的小標籤（紀錄頁用）：'resign'／'agreed'／'abandon'；一般的勝負、和棋、舊紀錄回 null
  function endTag(g) {
    var e = g && g.end;
    return e === 'resign' || e === 'agreed' || e === 'abandon' ? e : null;
  }
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
  // v0.5.13（規格 AF）：照 GROUP_TIERS 查（階 13＝入門・2 在入門這一級；原本比大小會把 13 當成最強）
  function groupOf(tier) {
    if (!tier) return null;
    for (var i = 0; i < GROUPS.length; i++) if (GROUP_TIERS[GROUPS[i]].indexOf(tier) >= 0) return GROUPS[i];
    return null;
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
      forbid: p.forbid === 'block' || p.forbid === 'lose' ? p.forbid : null,
      // v0.5.17（規格 AV）：每日一題（daily）與成就（ach）存在帳號裡，跟著匯出匯入；格式見下面「每日一題、成就」那一段。
      // ach 是 null＝這個帳號還沒回推過（舊帳號第一次開新版時 achSync 從紀錄回推）
      daily: cleanDaily(p.daily),
      ach: cleanAch(p.ach)
    };
  }
  // v0.5.17 複審（judge）：帳號資料多了每日一題（一個帳號最多 800 天），每次都整份檢查一遍太慢（3 個帳號 × 365 天每讀一次約 3.5 ms，
  // 下一手棋會讀好幾次）。記住上一次讀到的原始字串與檢查完的結果（存成字串）：字串沒變（日期也還是同一天：cleanDaily、cleanAch 看今天）就直接
  // 解開上次的結果——每次回傳的都是新的物件，呼叫的地方照舊可以改它（updateProfile、setCurrent 都會改了再寫回），不會改到快取
  var profCache = { raw: null, day: null, out: 'null' };
  function readProfiles() {
    var raw = null, day = dayKey(Date.now());
    try { raw = localStorage.getItem(PKEY); } catch (e) { raw = null; }
    if (raw !== null && raw === profCache.raw && day === profCache.day) return JSON.parse(profCache.out);
    var st;
    try { st = JSON.parse(raw || 'null'); } catch (e) { st = null; }
    if (!st || !Array.isArray(st.list)) st = null;
    else {
      st.list = st.list.filter(validProfile).map(cleanProfile);
      if (!st.list.length) st = null;
      else {
        if (!st.list.some(function (p) { return p.id === st.current; })) st.current = st.list[0].id;
        if (!st.list.some(function (p) { return p.id === st.defaultId; })) st.defaultId = st.list[0].id;
      }
    }
    profCache = { raw: raw, day: day, out: JSON.stringify(st) }; // 存成字串：之後改 st 不會改到快取
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
    p.ach = { init: Date.now(), got: {} }; // v0.5.17（規格 AV）：新建的帳號沒有舊紀錄可回推，成就從現在開始算
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
    var today = dayKey(Date.now()), mergedP = 0;
    (Array.isArray(inc) ? inc : []).forEach(function (p) {
      if (!validProfile(p)) return;
      // v0.5.17（規格 AV）：本機已有的帳號，積分照舊用本機的，每日一題與成就合併（同一天有一邊做對就算做對、成就取比較早的日期）；
      // 舊的匯出檔沒有這兩欄＝不動。新加的帳號照帶來的（cleanProfile 檢查過；日期比明天還晚的天數丟掉）
      if (known[p.id]) {
        st.list.forEach(function (q) {
          if (q.id !== p.id) return;
          var d = dailyMerge(q.daily, cleanDaily(p.daily, true), today), a = achMerge(q.ach, cleanAch(p.ach));
          if (JSON.stringify(d) !== JSON.stringify(q.daily) || JSON.stringify(a) !== JSON.stringify(q.ach)) { q.daily = d; q.ach = a; mergedP++; }
        });
        return;
      }
      if (st.list.length >= MAX_PROFILES) return;
      var np = cleanProfile(p);
      np.daily = dailyMerge(null, np.daily, today);
      st.list.push(np);
      known[p.id] = 1;
      addedP++;
    });
    if (addedP || mergedP) writeProfiles(st);
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
          dst[qid] = { ok: Number(r.ok) || 0, tries: Number(r.tries) || 0, type: r.type === 'defend' || r.type === 'trap' ? r.type : 'attack', n: Number(r.n) || 0 }; // v0.5.20 複審：陷阱題的紀錄照樣是 trap（不變成 attack，不會算進練習題成就）
          pzChanged = true;
        });
        pz[pid] = dst;
      });
      if (pzChanged) { try { localStorage.setItem(PZ2, JSON.stringify(pz)); } catch (e) { /* 不存 */ } }
    }
    // v0.5.17（規格 AV）：匯入的紀錄可能讓成就成立（日期用那一盤的日期）：每個帳號靜靜補一次，不出「拿到成就」那一行
    readProfiles().list.forEach(function (p) { achSync(p.id, Date.now()); });
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
    // v0.5.20（規格 AJ）：陷阱題（type 'trap'，沒有步數）另記在 trap，不混進進攻題（陷阱題 v0.5.20 複審起延後、畫面上沒有這一列；紀錄留著照算）
    var out = { attack: {}, defend: {}, trap: { ok: 0, tries: 0 }, tries: 0 };
    [1, 2, 3, 4, 5].forEach(function (n) { out.attack[n] = { ok: 0, tries: 0 }; out.defend[n] = { ok: 0, tries: 0 }; });
    Object.keys(all).forEach(function (id) {
      var r = all[id], k = r && r.type === 'defend' ? 'defend' : 'attack';
      if (r && r.type === 'trap') {
        out.trap.ok += r.ok || 0;
        out.trap.tries += r.tries || 0; // 不加進 out.tries（畫面上沒有陷阱題那一列，只做過陷阱題時照舊寫「還沒有做過練習題」）
        return;
      }
      if (!r || !out[k][r.n]) return;
      out[k][r.n].ok += r.ok || 0;
      out[k][r.n].tries += r.tries || 0;
      out.tries += r.tries || 0;
    });
    return out;
  }

  // ---------------------------------------------------------- v0.5.17（規格 AV）：每日一題、成就
  // 都存在帳號資料裡（gomoku.profiles.v1 的 list[i]），跟著匯出匯入、刪帳號一起刪；「清除紀錄」只清對局，這兩樣不動。
  //   daily：{ days: { 'YYYY-MM-DD'（本機日期）: { q 題目 id, ok 今天做對了（沒按看答案）0|1, first 第一次作答就對 0|1, peek 按過看答案 0|1,
  //            tries 這一天在「今天的題目」答了幾次, at 做對的時間（ms；沒做對是 0） } } }，只記有作答的日子，最多留最近 DAILY_KEEP 天。
  //   ach：{ init 開始算成就的時間（舊帳號＝第一次開新版、回推的那一刻；新帳號＝建立時）, got: { 成就 id: { at 拿到的時間, old 1＝回推時日期不明 } } }。
  // 日期一律是「本機日期」的字串，換成天數（dayNum）時用 UTC 算，夏令時間、時區都不會讓同一個日期算出兩個天數。
  var DAILY_KEEP = 800;
  var DAILY_MUL = [97, 89, 83, 79, 73, 71, 67, 61, 59, 53], DAILY_ADD = 37;
  function dayKey(ms) { var d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dayNum(key) { var a = String(key).split('-'); return Math.round(Date.UTC(+a[0], +a[1] - 1, +a[2]) / DAY); }
  function keyOfNum(n) { var d = new Date(n * DAY); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  // v0.5.17 複審：isKey 只看樣子（讀帳號時每一天都要看，要便宜）；validKey 另外確定是真的日期（2 月 30 日不行），只在寫入、匯入時用
  var KEY_RE = /^\d{4}-\d\d-\d\d$/;
  function isKey(k) { return typeof k === 'string' && k.length === 10 && KEY_RE.test(k); }
  function validKey(k) { return isKey(k) && keyOfNum(dayNum(k)) === k; }
  // 比 today 晚超過一天的日子不算（時鐘曾經被調快時做的題）：明天還算（往東飛過時區，本機日期會先到明天）
  function dailyLimit(today) { return keyOfNum(dayNum(today) + 1); }
  function gcd(a, b) { while (b) { var x = a % b; a = b; b = x; } return a; }
  // 每日一題：題庫照題目 id 排好（跟檔案裡的順序無關），第 dayNum 天取第 (A × (dayNum mod 題數) + B) mod 題數 題。
  // A 跟題數互質＝固定的一個排列：任何連續「題數」天裡每一題剛好出一次（現在 166 題＝166 天內不重複，比規格的 30 天長）。不靠亂數、不存狀態，
  // 每台裝置同一個日期算出同一題；題庫題數變了（改版）排列跟著換
  function dailyIndex(key, count) {
    if (!(count > 0)) return -1;
    var a = 1;
    for (var i = 0; i < DAILY_MUL.length; i++) if (gcd(DAILY_MUL[i] % count, count) === 1) { a = DAILY_MUL[i]; break; }
    var n = ((dayNum(key) % count) + count) % count;
    return (a * n + DAILY_ADD) % count;
  }
  function dailyOrder(list) {
    return (list || []).filter(function (p) { return p && p.id != null; }).slice().sort(function (x, y) {
      var a = String(x.id), b = String(y.id);
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }
  function dailyPick(list, key) { var o = dailyOrder(list), i = dailyIndex(key, o.length); return i >= 0 ? o[i] : null; }

  function cleanDay(e) {
    var n = function (v) { return typeof v === 'number' && isFinite(v) && v >= 0 ? Math.floor(v) : 0; };
    return { q: typeof e.q === 'string' ? e.q.slice(0, 40) : '', ok: e.ok ? 1 : 0, first: e.first ? 1 : 0, peek: e.peek ? 1 : 0, tries: n(e.tries), at: n(e.at) };
  }
  // strict：寫入、匯入時連日期是不是真的日期都查（讀帳號時只看樣子，見 isKey）。
  // v0.5.17 複審（主線）：讀、寫都不丟比「明天」還晚的日子——裝置的時鐘暫時往回調（例如一個禮拜）時，那幾天其實是真的記錄，丟了就找不回來；
  // 算錨點、連續天數、要不要拒絕寫入時不看它們就夠了（dailyLatest）。只有匯入時丟（dailyMerge）。
  // 超過 DAILY_KEEP 天要修剪時：「明天」以前的留最近 DAILY_KEEP 天，比明天還晚的另外最多留 DAILY_FUTURE 天（離今天最近的），
  // 所以幾筆亂寫的遠方日期擠不掉真的日子；沒超過就全部留著
  var DAILY_FUTURE = 10;
  function cleanDaily(d, strict) {
    if (!d || typeof d !== 'object' || !d.days || typeof d.days !== 'object' || Array.isArray(d.days)) return null;
    var keys = Object.keys(d.days).filter(function (k) { return strict ? validKey(k) : isKey(k); }).sort(), days = {};
    if (keys.length > DAILY_KEEP) {
      var limit = dailyLimit(dayKey(Date.now()));
      var past = keys.filter(function (k) { return k <= limit; }), fut = keys.filter(function (k) { return k > limit; });
      keys = past.slice(Math.max(0, past.length - DAILY_KEEP)).concat(fut.slice(0, DAILY_FUTURE));
    }
    keys.forEach(function (k) { var e = d.days[k]; if (e && typeof e === 'object') days[k] = cleanDay(e); });
    return { days: days };
  }
  function dailyDays(pid) { var p = profile(pid); return p && p.daily ? p.daily.days : {}; }
  // 有記錄的最後一天（做對或只是作答過）；給了 today 就不看比 today 晚超過一天的日子
  function dailyLatest(days, today) {
    var lim = today ? dailyLimit(today) : null;
    var ks = Object.keys(days || {}).filter(function (k) { return isKey(k) && (!lim || k <= lim); }).sort();
    return ks.length ? ks[ks.length - 1] : null;
  }
  // 連續天數：從「錨點」往回數連續做對的天數。錨點＝今天；但已經有比今天晚的日子（往西飛過時區、裝置的時鐘往回調一天）時＝那最後一天，
  // 所以本機日期退回一天不會讓連續天數歸零。比今天晚超過一天的日子不算（v0.5.17 複審）。錨點那天還沒做對就從前一天數起（「到昨天」的連續天數）。
  function dailyStreak(days, today) {
    days = days || {};
    var l = dailyLatest(days, today), a = l && l > today ? l : today, n = dayNum(a);
    if (!(days[a] && days[a].ok)) n--;
    var k = 0;
    while (days[keyOfNum(n)] && days[keyOfNum(n)].ok) { k++; n--; }
    return k;
  }
  // 今天的狀態：'done' 做對了（first＝一次就對）、'peek' 看過答案、'tried' 答錯過、'todo' 還沒做、'past' 裝置的日期比記錄裡最後一天早（做對也不記）
  function dailyState(days, today) {
    days = days || {};
    var e = days[today], l = dailyLatest(days, today);
    if (e && e.ok) return { st: 'done', first: !!e.first, e: e };
    if (l && l > today) return { st: 'past', e: e || null };
    if (e && e.peek) return { st: 'peek', e: e };
    if (e && e.tries) return { st: 'tried', e: e };
    return { st: 'todo', e: e || null };
  }
  // 記一次作答（what：'right'／'wrong'／'peek'）。只記「今天的題目」頁的作答；這一天已經做對就不再動。
  // 日期比記錄裡最後一天早（時鐘往回調）：不記，回 { refused: 'past' }——不能補做以前的題，也不會把以前斷掉的日子補起來
  function dailyMark(pid, key, q, what, now) {
    var p = profile(pid);
    if (!p || !validKey(key)) return null;
    var days = {}, src = p.daily ? p.daily.days : {};
    Object.keys(src).forEach(function (k) { days[k] = src[k]; });
    var l = dailyLatest(days, key);
    if (l && key < l) return { refused: 'past' };
    var e = days[key] ? cleanDay(days[key]) : null, done = false;
    if (e && e.ok) return { entry: e, done: false };
    if (!e || e.q !== q) e = { q: String(q).slice(0, 40), ok: 0, first: 0, peek: 0, tries: 0, at: 0 }; // 同一天題目換了（題庫改版）：重新記
    if (what === 'peek') e.peek = 1;
    else {
      e.tries++;
      if (e.tries === 1) e.first = what === 'right' ? 1 : 0;
      if (what === 'right' && !e.peek) { e.ok = 1; e.at = now; done = true; }
    }
    days[key] = e;
    updateProfile(pid, { daily: cleanDaily({ days: days }, true) });
    return { entry: e, done: done };
  }
  // 匯入時合併兩份（同一個帳號在兩台裝置上）：同一天任一邊做對就算做對（做對的時間取早的、一次就對取任一邊），兩邊都沒做對時任一邊看過答案就算看過。
  // 只會把真的有記錄的日子並起來，不會把天數相加；日期比「明天」還晚的（時鐘被調快）丟掉。同一份檔匯入兩次結果一樣
  function dailyMerge(a, b, today) {
    var limit = keyOfNum(dayNum(today) + 1), days = {}, any = false;
    [a, b].forEach(function (src, si) {
      if (!src || !src.days) return;
      Object.keys(src.days).forEach(function (k) {
        if (!validKey(k) || (si === 1 && k > limit)) return;
        var x = cleanDay(src.days[k]), y = days[k];
        any = true;
        if (!y) { days[k] = x; return; }
        var ok = y.ok || x.ok;
        days[k] = {
          q: y.ok || !x.ok ? y.q : x.q, ok: ok ? 1 : 0, first: y.first || x.first ? 1 : 0,
          peek: !ok && (y.peek || x.peek) ? 1 : 0, tries: Math.max(y.tries, x.tries),
          at: !ok ? 0 : y.ok && x.ok ? Math.min(y.at || x.at, x.at || y.at) : y.ok ? y.at : x.at
        };
      });
    });
    return any || a || b ? cleanDaily({ days: days }, true) : null;
  }
  // 最早一段連續 n 天做對，第 n 天做對的時間（沒有就 null；那天的時間不明是 -1）
  function dailyRunAt(days, n) {
    var ks = Object.keys(days || {}).filter(function (k) { return isKey(k) && days[k].ok; }).sort(), run = 0, prev = null;
    for (var i = 0; i < ks.length; i++) {
      var d = dayNum(ks[i]);
      run = prev != null && d === prev + 1 ? run + 1 : 1;
      prev = d;
      if (run >= n) return days[ks[i]].at > 0 ? days[ks[i]].at : -1;
    }
    return null;
  }

  // 成就（第一批，規格 AV）。不影響分數。順序＝紀錄頁的順序。
  // 「贏電腦」類（firstWin、beat*、win3、renjuWin）只看跟電腦下、沒開教學（eloSkip 'teach'）的盤：兩人一起下、同一個帳號自己對下、教學局都不算；
  // 「贏過 X」＝贏過 X 那一級任一段、或比它強的電腦（照 GROUP_TIERS 排的先後，不比階號大小：入門・2 是階 13，排在入門・1 後面、弱・1 前面）。
  // 「下完」（firstGame、games50）算這個帳號所有留下紀錄的對局：輸贏和、認輸、超過 10 手放棄（算輸）、兩人說好和棋、兩人一起下（執黑或執白）都算；
  // 10 手以內放棄、兩人一起下放棄不留紀錄，所以不算。
  var ACH = ['firstGame', 'firstWin', 'beatNovice2', 'beatEasy', 'beatMedium', 'beatHard', 'beatExpert', 'beatTengen', 'win3', 'renjuWin',
    'games50', 'pz10', 'pz50', 'daily3', 'daily7', 'daily30'];
  var TIER_ORDER = [];
  GROUPS.forEach(function (g) { TIER_ORDER = TIER_ORDER.concat(GROUP_TIERS[g]); });
  function tierRank(tier) { return TIER_ORDER.indexOf(tier); }
  var ACH_BEAT = { beatNovice2: GROUP_TIERS.novice[1], beatEasy: GROUP_TIERS.easy[0], beatMedium: GROUP_TIERS.medium[0],
    beatHard: GROUP_TIERS.hard[0], beatExpert: GROUP_TIERS.expert[0] };
  var TENGEN = 12;
  function isTeachGame(g) { return g.eloSkip === 'teach' || g.teach === true; }
  function achWin(g, pid) { return g.mode === 'pve' && g.pid === pid && g.result === 'win' && !isTeachGame(g) && tierOf(g) != null; }
  // 從紀錄、練習題紀錄、每日一題回推：{ 成就 id: 成立的時間（ms；成立但時間不明是 -1） }，不成立的不在裡面
  function achDerive(list, pz, days, pid) {
    var out = {}, mine = (list || []).filter(function (g) { return valid(g) && involves(g, pid); }).sort(byTime);
    function set(id, at) { if (!(id in out)) out[id] = at; }
    if (mine.length) set('firstGame', timeOf(mine[0]));
    if (mine.length >= 50) set('games50', timeOf(mine[49]));
    var run = 0;
    mine.forEach(function (g) {
      if (achWin(g, pid)) {
        var tr = tierOf(g), at = timeOf(g);
        set('firstWin', at);
        Object.keys(ACH_BEAT).forEach(function (id) { if (tierRank(tr) >= tierRank(ACH_BEAT[id])) set(id, at); });
        if (tr === TENGEN) set('beatTengen', at);
        if (g.rule === 'renju') set('renjuWin', at);
      }
      // 連贏 3 盤：這個帳號跟電腦下的盤照時間排；教學局跳過（不算也不斷），輸、和（含認輸、放棄）就重算；兩人一起下不看
      if (g.mode !== 'pve' || g.pid !== pid || tierOf(g) == null || isTeachGame(g)) return;
      run = g.result === 'win' ? run + 1 : 0;
      if (run === 3) set('win3', timeOf(g));
    });
    // v0.5.20（規格 AJ，主線定）：陷阱題（type 'trap'）不算——標了字母的只有 2～4 個，猜得中（陷阱題這一版延後，紀錄若有也不算）
    var solved = Object.keys(pz || {}).filter(function (id) { return pz[id] && pz[id].ok > 0 && pz[id].type !== 'trap'; }).length; // 做對過的不同題目數（同一題做對幾次都算一題）
    if (solved >= 10) set('pz10', -1);
    if (solved >= 50) set('pz50', -1);
    [3, 7, 30].forEach(function (n) { var at = dailyRunAt(days, n); if (at != null) set('daily' + n, at); });
    return out;
  }
  // v0.5.17 複審（judge）：時間要合理（2020-01-01 到明天；不合理的成就丟掉、開始的時間當成 0），匯入的檔再怎麼亂寫，畫面也不會出現 NaN 或 1970 年
  var ACH_FLOOR = Date.UTC(2020, 0, 1);
  function saneAt(v) { return typeof v === 'number' && isFinite(v) && v >= ACH_FLOOR && v <= Date.now() + DAY; }
  function cleanAch(a) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
    var got = {}, src = a.got && typeof a.got === 'object' ? a.got : {};
    ACH.forEach(function (id) {
      var x = src[id];
      if (!x || !saneAt(x.at)) return;
      got[id] = x.old ? { at: x.at, old: 1 } : { at: x.at };
    });
    return { init: saneAt(a.init) ? a.init : 0, got: got };
  }
  // 匯入時合併：拿到的成就取聯集、日期取早的；開始算的時間取早的
  function achMerge(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    var got = {};
    ACH.forEach(function (id) {
      var x = a.got[id], y = b.got[id];
      if (x || y) got[id] = !y || (x && x.at <= y.at) ? x : y;
    });
    return { init: a.init && b.init ? Math.min(a.init, b.init) : a.init || b.init, got: got };
  }
  // 照現在的紀錄補上新成立的成就，回傳這次新加的 [{ id, at }]（日期照回推的；練習題的題數沒有日期，用 now）。
  // 這個帳號還沒回推過（ach 是 null，舊帳號第一次開新版）：全部記下來、回空陣列（不出「拿到成就」那一行）；回推不了日期的記成 old（紀錄頁寫「某天以前」）。
  // 已經拿到的不會因為紀錄被清掉、悔棋改了結果而拿掉
  function achSync(pid, now) {
    var p = profile(pid);
    if (!p) return [];
    var d = achDerive(loadFor(pid), pzLoad(pid), p.daily ? p.daily.days : {}, pid);
    var fresh = !p.ach, a = fresh ? { init: now, got: {} } : p.ach, out = [], changed = fresh;
    ACH.forEach(function (id) {
      if (a.got[id] || !(id in d)) return;
      var at = d[id];
      a.got[id] = saneAt(at) ? { at: at } : fresh ? { at: a.init, old: 1 } : { at: now }; // 紀錄的時間不合理（cleanAch 會丟）時當成日期不明
      changed = true;
      if (!fresh) out.push({ id: id, at: a.got[id].at });
    });
    if (changed) updateProfile(pid, { ach: a });
    return out;
  }
  function achList(pid) {
    var p = profile(pid), got = p && p.ach ? p.ach.got : {};
    return ACH.map(function (id) { return { id: id, got: got[id] || null }; });
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
      root.appendChild(achCell(env.pid, t)); // v0.5.17（規格 AV）：沒有對局也顯示成就（還沒拿到的寫怎麼拿）
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
    root.appendChild(achCell(env.pid, t)); // v0.5.17（規格 AV）：成就放在紀錄頁最下面（上面的版面都不動）
  }

  // v0.5.17（規格 AV）：「成就」區塊。拿到的亮（★、寫哪一天拿到；回推時日期不明的寫「某天以前就做到了」）、
  // 還沒拿到的灰（☆、寫怎麼拿；讀屏多念「還沒拿到」）。手機一欄，夠寬（平板）兩欄（style.css .ach-list）
  function achCell(pid, t) {
    var items = achList(pid), n = items.filter(function (x) { return x.got; }).length;
    var cell = mk('div', 'stat-cell wide ach-cell');
    cell.appendChild(mk('div', 'stat-label', t('stats.ach', { n: n, all: items.length })));
    var ul = mk('ul', 'ach-list');
    items.forEach(function (x) {
      var li = mk('li', 'ach-item ' + (x.got ? 'got' : 'locked'));
      li.setAttribute('data-ach', x.id);
      li.appendChild(mk('span', 'ach-mark', x.got ? '\u2605' : '\u2606')).setAttribute('aria-hidden', 'true');
      var body = mk('div', 'ach-body');
      if (!x.got) body.appendChild(mk('span', 'sr-only', t('ach.lockedSr')));
      body.appendChild(mk('b', 'ach-title', t('ach.' + x.id)));
      var d = x.got ? new Date(x.got.at) : null;
      body.appendChild(mk('small', 'ach-sub', x.got ? t(x.got.old ? 'ach.gotOld' : 'ach.got', { date: t('ach.date', { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), mm: pad(d.getMonth() + 1), dd: pad(d.getDate()) }) })
        : t('ach.' + x.id + '.how')));
      li.appendChild(body);
      ul.appendChild(li);
    });
    cell.appendChild(ul);
    cell.appendChild(mk('p', 'stat-sub', t('ach.note')));
    return cell;
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
    ABANDON_FREE: ABANDON_FREE, abandonIsLoss: abandonIsLoss, endTag: endTag,
    summary: summary, monthly: monthly, chartSVG: chartSVG, ratingChartSVG: ratingChartSVG, puzzleStats: puzzleStats,
    exportText: exportText, importText: importText,
    // v0.5.17（規格 AV）：每日一題、成就
    dayKey: dayKey, dayNum: dayNum, keyOfNum: keyOfNum, validKey: validKey, dailyIndex: dailyIndex, dailyOrder: dailyOrder, dailyPick: dailyPick,
    dailyDays: dailyDays, dailyLatest: dailyLatest, dailyStreak: dailyStreak, dailyState: dailyState, dailyMark: dailyMark, dailyMerge: dailyMerge,
    dailyRunAt: dailyRunAt, cleanDaily: cleanDaily, ACH: ACH, achDerive: achDerive, achSync: achSync, achList: achList, achMerge: achMerge, cleanAch: cleanAch,
    render: render
  };
})();
