// 五子棋介面主程式：分頁（下棋／練習／紀錄／我）、對局、威脅提醒、結算、練習題與開局、關於頁、語言切換。
// 第四批 b 從 index.html 的內嵌腳本搬出並擴充。AI 在 ai.js（引擎），復盤在 review.js，戰績在 stats.js，所有文字在 i18n.js。
(function () {
  'use strict';
  var G = window.Gomoku;
  var I = window.I18N;
  var t = I.t;
  var GS = window.GStats;
  var RV = window.GReview;
  var GT = window.GThemes; // 棋盤與棋子風格（themes.js，第八批 b）
  var N = G.SIZE;
  var COLS = 'ABCDEFGHIJKLMNO';
  var STARS = [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]];
  var GROUPS = ['novice', 'easy', 'medium', 'hard', 'expert'];
  // 十一階（第五批契約）：入門、弱 1–3、中 1–4、強 1–2、最強
  var GROUP_TIERS = { novice: [1], easy: [2, 3, 4], medium: [5, 6, 7, 8], hard: [9, 10], expert: [11] };
  var MAX_TIER = 11;
  // 各檔預設段（帳號的 pref 沒存這一檔時用）：舊九階預設（弱・2、中・3、強）用 migrateTier 換過去的階。
  // 第六批起，新帳號一建立就把 pref 設成「推薦對手」那一階（newProfilePref），所以這組只影響既有帳號沒選過的檔；
  // 注意中・4 的 AI 積分比新玩家 1200 分高很多，這組不是「適合新手」的預設。
  var DEFAULT_SUB = { easy: 3, medium: 8, hard: 10 };
  var SKEY = 'gomoku.settings.v1';
  var RT = window.GomokuRating || null; // rating.js（引擎批）；沒載入時不結算、不顯示積分
  var EMOJIS = ['🙂', '😎', '🐯', '🐼', '🦊', '🐱', '🐶', '🐰', '🐻', '🐸', '🦄', '🐲', '🌟', '🚀', '⚽', '🎨'];

  function $(id) { return document.getElementById(id); }
  function mk(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function coordName(r, c) { return COLS.charAt(c) + (N - r); }
  function colorName(p) { return t(p === 1 ? 'color.black' : 'color.white'); }
  function tierName(tier) { return t('tier.' + tier); }
  function tierGroup(tier) {
    return tier <= 1 ? 'novice' : tier <= 4 ? 'easy' : tier <= 8 ? 'medium' : tier <= 10 ? 'hard' : 'expert';
  }
  // 引擎已是十一階就直接送階數；還是九階時送最接近的舊階；更舊（沒有 Gomoku.TIERS）送舊的檔次字串
  function levelArg(tier) {
    if (G.TIERS && G.TIERS.length >= MAX_TIER) return tier;
    var old = [0, 1, 2, 3, 4, 5, 6, 7, 7, 8, 8, 9][tier] || 7;
    if (G.TIERS) return old;
    return old <= 4 ? 'easy' : old <= 7 ? 'medium' : old === 8 ? 'hard' : 'expert';
  }

  // ---------------------------------------------------------- 積分（rating.js 的轉接：回傳形狀不確定的地方都在這裡收）

  // AI 的固定積分（TIERS.rating）。0 或負數當成「還沒校正」：不顯示、不結算
  function aiRating(tier) {
    var row = G.TIERS && G.TIERS[tier - 1];
    return row && typeof row.rating === 'number' && row.rating > 0 ? row.rating : null;
  }
  function numOf(x, keys) {
    if (typeof x === 'number' && isFinite(x)) return x;
    if (x && typeof x === 'object') for (var i = 0; i < keys.length; i++) if (typeof x[keys[i]] === 'number') return x[keys[i]];
    return null;
  }
  // rating.js 的 badge() 回 'wood'…'diamond'；回物件時取 key／id
  function badgeId(b) {
    if (b && typeof b === 'object') b = b.key || b.id || null;
    if (typeof b !== 'string' || !b) return null;
    return b.toLowerCase();
  }
  function badgeName(id) { return id ? t('badge.' + id) : ''; }
  function badgeOf(p) {
    if (!p) return null;
    if (p.badge) return p.badge;
    return RT && RT.badge ? badgeId(RT.badge(p.rating)) : null;
  }
  // 一方的結算紀錄：p 帳號、rb 對手積分、s 得分（勝 1／和 0.5／負 0）、u 是 rating.js update／settle 給這一方的結果
  // （rating.js 回 { rating, delta, expected, k }；只回數字也收）
  function eloPack(p, rb, s, u) {
    var after = numOf(u, ['rating', 'newRating', 'after']);
    if (after == null && u && typeof u.delta === 'number') after = p.rating + u.delta;
    var bb = badgeOf(p);
    var ba = after == null ? bb : RT.badgeAfter ? badgeId(RT.badgeAfter(bb, after)) : badgeId(RT.badge(after));
    var e = u && typeof u.expected === 'number' ? u.expected : RT.expected(p.rating, rb);
    return { before: p.rating, after: after, exp: e, opp: rb, score: s, games: p.games, badgeBefore: bb, badgeAfter: ba || bb };
  }
  function eloStep(p, rb, s) { return eloPack(p, rb, s, RT.update(p.rating, rb, s, p.games)); }
  function recommendTier(r) {
    if (!RT || !RT.recommendTier || !G.TIERS) return null;
    var x = RT.recommendTier(r, G.TIERS);
    if (x && typeof x === 'object') x = x.tier;
    return typeof x === 'number' && x >= 1 && x <= MAX_TIER ? x : null;
  }
  // 對局資訊行、棋譜用（第十三批 b，規格 U）：連珠規則一定帶「不讓下／下了就輸」
  function ruleLabel(rule, strict) {
    if (rule !== 'renju') return t('rule.free');
    return strict ? t('rule.renjuLose') : t('rule.renjuBlock');
  }
  function cloneBoard(b) { return b.map(function (row) { return row.slice(); }); }

  // ---------------------------------------------------------- 設定（存 localStorage）

  // 檔次（group／sub）第五批起改存在各帳號的 pref；舊設定裡的由 legacyPref() 在建預設帳號時搬過去。
  // J 段的自動調整（auto、autoDecl）已由 P 段的提示與「推薦對手」取代。
  // 第十四批（規格 V）：「更多」區塊拿掉（原本的 more 不再用）。hints 威脅提醒預設改成開；hintsOpen 對局畫面的提醒列展開或收起；
  // last＝上一次從下棋分頁開始的那盤的設定（setupKey()）。卡片目前的設定和它一樣時，大按鈕寫「再下一盤」、下方小字寫這組設定；
  // 沒有上次、或卡片改過了，就寫「開始下棋」、不寫小字
  // 第八批 b：scheme 介面顏色（'system' 跟隨系統／'light'／'dark'）、anim 動畫（預設開）、sound 落子音效（預設關）。
  // 這三項跟著這台裝置（系統深色、減少動態都是裝置的設定）；棋盤風格跟著帳號（存在帳號的 theme）。
  // 第十三批 b：strict（黑棋下禁手就輸）不再是這台裝置的設定，改存在帳號的 forbid（見 migrateStrict）
  // 第十六批（主線拍板 2026-10-01）：威脅提醒對「沒有明確設定過的人」一律開。第十三批以前預設關、而且 saveSettings 會把整組設定
  // 寫回去，所以舊使用者的 hints: false 分不出是自己關的還是預設值；改用 hintsSet（在「我」分頁按過開關才是 true）判斷，
  // 沒有 hintsSet 的一律當成沒設定過、開。
  var DEFAULTS = { mode: 'pve', rule: 'free', side: 1, hints: true, hintsSet: false, hintsOpen: true, last: null, learnSide: 2, pvpB: null, pvpW: null,
    scheme: 'system', anim: true, sound: false };

  function rawSettings() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem(SKEY) || '{}') || {}; } catch (e) { s = {}; }
    return s;
  }
  function loadSettings() {
    var s = rawSettings();
    var o = {};
    Object.keys(DEFAULTS).forEach(function (k) { o[k] = s[k] !== undefined ? s[k] : DEFAULTS[k]; });
    if (o.mode !== 'pvp') o.mode = 'pve';
    if (o.rule !== 'renju') o.rule = 'free';
    o.side = o.side === 2 ? 2 : 1;
    o.learnSide = o.learnSide === 1 ? 1 : 2;
    o.hintsSet = s.hintsSet === true;
    o.hints = o.hintsSet ? !!o.hints : true;
    o.hintsOpen = o.hintsOpen !== false;
    if (typeof o.last !== 'string') o.last = null;
    if (['system', 'light', 'dark'].indexOf(o.scheme) < 0) o.scheme = 'system';
    o.anim = o.anim !== false; o.sound = !!o.sound;
    return o;
  }
  var settings = loadSettings();
  function saveSettings() {
    try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch (e) { /* 私密模式等：不存 */ }
  }

  // ---------------------------------------------------------- 外觀（規格 R：深色模式、動畫、落子音效；第八批 b）

  function mq(q) { return window.matchMedia ? window.matchMedia(q) : null; }
  function onMq(m, fn) {
    if (!m) return;
    if (m.addEventListener) m.addEventListener('change', fn); else if (m.addListener) m.addListener(fn);
  }
  var mqDark = mq('(prefers-color-scheme: dark)');
  var mqReduce = mq('(prefers-reduced-motion: reduce)');
  function systemReduce() { return !!(mqReduce && mqReduce.matches); }
  // 動畫：「動畫」開關開著、而且系統沒有要求減少動態
  function motionOK() { return settings.anim && !systemReduce(); }
  function schemeNow() {
    return settings.scheme === 'dark' || (settings.scheme === 'system' && mqDark && mqDark.matches) ? 'dark' : 'light';
  }
  function applyScheme() {
    var dark = schemeNow() === 'dark', root = document.documentElement;
    root.setAttribute('data-scheme', dark ? 'dark' : 'light');
    root.classList.toggle('no-motion', !motionOK());
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#1c1814' : '#5c3a1e'); // 第十五批：A 的 bg（深色）／wood（淺色）
  }
  applyScheme();
  onMq(mqDark, applyScheme);

  // 落子音效：WebAudio 當場合成一聲短促的「叩」（三角波快速降頻＋一小段帶通雜音），不用音檔
  var audio = null, soundCount = 0;
  function knock() {
    if (!settings.sound) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      if (!audio) audio = new AC();
      if (audio.state === 'suspended' && audio.resume) audio.resume();
      var t0 = audio.currentTime + 0.005;
      var o = audio.createOscillator(), og = audio.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(820, t0);
      o.frequency.exponentialRampToValueAtTime(260, t0 + 0.06);
      og.gain.setValueAtTime(0.0001, t0);
      og.gain.exponentialRampToValueAtTime(0.32, t0 + 0.004);
      og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
      o.connect(og); og.connect(audio.destination);
      o.start(t0); o.stop(t0 + 0.1);
      var len = Math.floor(audio.sampleRate * 0.03), buf = audio.createBuffer(1, len, audio.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      var ns = audio.createBufferSource(), bp = audio.createBiquadFilter(), ng = audio.createGain();
      ns.buffer = buf;
      bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 1.2;
      ng.gain.value = 0.22;
      ns.connect(bp); bp.connect(ng); ng.connect(audio.destination);
      ns.start(t0);
      soundCount++;
    } catch (e) { /* 沒有聲音就算了，不影響下棋 */ }
  }

  // 舊設定（九階）的檔次 → 新十一階的 pref
  function legacyPref() {
    var s = rawSettings(), pr = { group: GROUPS.indexOf(s.group) >= 0 ? s.group : 'medium', sub: {} };
    if (s.sub && typeof s.sub === 'object') {
      ['easy', 'medium'].forEach(function (g) { if (typeof s.sub[g] === 'number') pr.sub[g] = GS.migrateTier(s.sub[g]); });
    }
    return pr;
  }
  function normPref(pr) {
    var o = { group: pr && GROUPS.indexOf(pr.group) >= 0 ? pr.group : 'medium', sub: {} };
    Object.keys(DEFAULT_SUB).forEach(function (g) {
      var v = pr && pr.sub ? pr.sub[g] : null;
      o.sub[g] = GROUP_TIERS[g].indexOf(v) >= 0 ? v : DEFAULT_SUB[g];
    });
    return o;
  }

  // ---------------------------------------------------------- 本機帳號（規格 P；存取在 stats.js）

  // 舊設定（第四批）有存檔次＝從舊版升上來的使用者，照舊搬；沒有＝全新使用者
  function hasLegacyPref() {
    var s = rawSettings();
    return GROUPS.indexOf(s.group) >= 0 || !!(s.sub && typeof s.sub === 'object');
  }
  // 新帳號的檔次：第十四批（W 第 12 條，作者 2026-10-01 拍板）起一律「入門」，選單旁邊寫「下贏了再換更強的」。
  // （第六批 b 到第十三批是起始積分的「推薦對手」那一階。）只在建帳號時用一次；既有帳號的 pref 不動。
  function newProfilePref() {
    return normPref({ group: 'novice', sub: {} });
  }

  // 第七批 b：從第四批升上來、有戰績但從沒存過檔次的人也算舊使用者——維持舊版預設（legacyPref 沒有檔次時＝中檔、DEFAULT_SUB 的中・4），
  // 不當成新帳號給推薦對手。只在還沒有任何帳號（initProfiles 要建預設帳號）時有作用。
  function isUpgradingUser() { return hasLegacyPref() || GS.load().length > 0; }

  GS.initProfiles({
    name: t('profile.defaultName'), emoji: EMOJIS[0],
    badge: RT && RT.badge ? badgeId(RT.badge(GS.START)) : null, pref: isUpgradingUser() ? legacyPref() : newProfilePref()
  });
  function me() { return GS.current(); }
  function pref() { return normPref(me().pref); }
  function savePref(pr) { GS.updateProfile(me().id, { pref: pr }); }
  // 第十三批 b（規格 U）：連珠規則下黑棋下到不能下的點時怎麼辦，存在帳號：'block'＝不讓下（練習用，預設）、'lose'＝算黑棋輸
  function myForbid() { var p = me(); return p && p.forbid === 'lose' ? 'lose' : 'block'; }
  // 舊版是這台裝置設定裡的 strict（「更多」的開關）：第一次開新版時搬到每個還沒選過的帳號（true→'lose'、false→'block'），
  // 然後從設定裡拿掉（saveSettings 寫回的 settings 已經沒有 strict），以後新建的帳號用預設「不讓下」
  (function migrateStrict() {
    var s = rawSettings();
    if (s.strict === undefined) return;
    var v = s.strict === true ? 'lose' : 'block';
    GS.profileList().forEach(function (p) {
      if (p.forbid !== 'lose' && p.forbid !== 'block') GS.updateProfile(p.id, { forbid: v });
    });
    saveSettings();
  })();
  function menuTier() {
    var pr = pref(), g = pr.group;
    return GROUP_TIERS[g].length > 1 ? pr.sub[g] : GROUP_TIERS[g][0];
  }
  // 雙打兩邊的帳號：記住上次選的；帳號不在了就預設黑＝目前帳號、白＝另一個帳號（只有一個帳號時兩邊同一個）
  function pvpPids() {
    var list = GS.profileList(), ids = list.map(function (p) { return p.id; });
    var b = ids.indexOf(settings.pvpB) >= 0 ? settings.pvpB : me().id;
    var w = ids.indexOf(settings.pvpW) >= 0 ? settings.pvpW : null;
    if (!w) {
      var other = ids.filter(function (id) { return id !== b; });
      w = other.length ? other[0] : b;
    }
    return { b: b, w: w };
  }

  // ---------------------------------------------------------- 狀態

  var S = {
    mode: 'pve', tier: 7, rule: 'free', strict: false, human: 1,
    board: G.createBoard(), history: [], turn: 1,
    over: false, winner: 0, endReason: null, forbiddenKind: null, winCells: null,
    thinking: false, aiTimer: null, pending: null, gen: 0,
    flash: null, flashTimer: null,
    gameTs: 0, recorded: false, preset: null, presetN: 0,
    hintFlash: null, hintFlashTimer: null, hintSeq: 0,
    pid: null, pidB: null, pidW: null, // 這局的帳號：單人是玩家；雙打是執黑、執白
    lastRec: null, lastFresh: false,   // 這局結束時的紀錄（結算畫面用）
    review: null // 復盤中：'game'（從對局進來）或 'stats'（從戰績進來）
  };

  // ---------------------------------------------------------- 棋盤繪圖（對局、復盤、練習題共用）

  function BoardView(canvas) {
    var ctx = canvas.getContext('2d');
    // 第十五批：畫座標時棋盤外側多留 COORD_PAD（CSS 像素）的邊，座標寫在邊上，不再被角落的棋子蓋住；不畫座標時沒有這道邊
    var COORD_PAD = 14;
    var geo = { css: 0, dpr: 1, cell: 0, margin: 0, pad: 0 };
    var lastView = null;

    function layout(coords) {
      geo.pad = coords ? COORD_PAD : 0;
      geo.cell = (geo.css - 2 * geo.pad) / N;
      geo.margin = geo.pad + geo.cell / 2;
    }
    function setSize(size) {
      var dpr = window.devicePixelRatio || 1;
      canvas.style.width = size + 'px';
      canvas.style.height = size + 'px';
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      geo.css = size;
      geo.dpr = canvas.width / size;
      layout(!!(lastView && lastView.coords));
      if (lastView) draw(lastView);
    }

    function cellAt(clientX, clientY) {
      var rect = canvas.getBoundingClientRect();
      if (!rect.width) return null;
      var scale = geo.css / rect.width;
      var c = Math.round(((clientX - rect.left) * scale - geo.margin) / geo.cell);
      var r = Math.round(((clientY - rect.top) * scale - geo.margin) / geo.cell);
      if (r < 0 || r >= N || c < 0 || c >= N) return null;
      return { r: r, c: c };
    }

    // 動畫（規格 R，第八批 b）：新落的子 0.16 秒內從略大縮回原大小並淡入；勝利的五顆子依序描出紅圈。
    // motionOK() 為假（「動畫」開關關閉，或系統「減少動態」開啟）時一律不做動畫、直接畫最後的樣子。
    var DROP_MS = 160, WIN_STEP = 80, WIN_RING = 200;
    var anim = { drop: null, win: null, raf: 0 };
    var drawn = { count: -1, last: null, winKey: null }; // 上一次畫的子數、最後一手、勝利五子：比對出「剛落的一顆」
    var bgCache = { key: '', cv: null };                 // 底、格線、星位先畫在離屏畫布，動畫每一格只要貼上

    function stoneCount(b) {
      var k = 0;
      for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) if (b[r][c]) k++;
      return k;
    }
    function startAnims(v) {
      var count = stoneCount(v.board), last = v.last ? v.last.r * N + v.last.c : null, now = performance.now();
      var winKey = v.winCells ? v.winCells.map(function (w) { return w[0] * N + w[1]; }).join(',') : null;
      var ok = motionOK();
      // 只有「比上一次多一顆、而且就是最後一手」才算剛落子（退一手、換局、跳到別手都不動）
      if (ok && last != null && v.board[v.last.r][v.last.c] && drawn.count >= 0 && count === drawn.count + 1 && last !== drawn.last) {
        anim.drop = { r: v.last.r, c: v.last.c, t0: now };
      } else if (!ok || (anim.drop && last !== anim.drop.r * N + anim.drop.c)) anim.drop = null;
      if (!ok || !winKey) anim.win = null;
      else if (winKey !== drawn.winKey) anim.win = { t0: now + (anim.drop ? DROP_MS : 0) };
      drawn.count = count; drawn.last = last; drawn.winKey = winKey;
    }
    function schedule() {
      if (anim.raf || !(anim.drop || anim.win)) return;
      anim.raf = requestAnimationFrame(function () { anim.raf = 0; if (lastView) paint(lastView); });
    }

    // v = { board, last:{r,c}, winCells:[[r,c]], forbidden:bool（畫黑棋禁手 ×）, coords:bool,
    //       marks:[{r,c,color}] 小色塊, frames:[{r,c,color}] 方框, rings:[{r,c,color,dash}] 圈，
    //       ghosts:[{r,c,p,num}] 半透明編號子, flash:[{r,c}] 橘色閃點, crosses:[{r,c}] 指定點的紅 × }
    // color 可以是風格的標記名（'own'、'opp'、'losing'、'better'、'brilliant'、'follow'），由目前風格給顏色；也可以直接給色碼。
    function draw(v) {
      lastView = v;
      if (geo.pad !== (v.coords ? COORD_PAD : 0)) layout(!!v.coords);
      if (!canvas.width) return;
      startAnims(v);
      paint(v);
    }
    // 換風格、換大小時重畫，不啟動動畫
    function redraw() { if (lastView && canvas.width) paint(lastView); }

    function paint(v) {
      var W = canvas.width;
      if (!W) return;
      var th = GT.current(), mk = th.mk, now = performance.now();
      var dpr = geo.dpr;
      var cell = geo.cell * dpr;
      var m = geo.margin * dpr;
      var lw = GT.lineW(th, dpr);
      var off = lw % 2 ? 0.5 : 0;
      function px(i) { return Math.round(m + i * cell) + off; }
      function col(k) { return mk[k] || k; }
      var gm = { ctx: ctx, W: W, n: N, cell: cell, dpr: dpr, lw: lw, stars: STARS, px: px };
      var i, r, c;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      var key = th.id + '|' + W + '|' + lw + '|' + geo.pad;
      if (bgCache.key !== key) {
        var cv = bgCache.cv || document.createElement('canvas');
        cv.width = W;
        cv.height = W;
        var bctx = cv.getContext('2d');
        th.board({ ctx: bctx, W: W, n: N, cell: cell, dpr: dpr, lw: lw, stars: STARS, px: px });
        bgCache = { key: key, cv: cv };
      }
      ctx.clearRect(0, 0, W, W);
      ctx.drawImage(bgCache.cv, 0, 0);
      ctx.lineCap = 'square';
      ctx.lineJoin = 'miter';

      // 座標（復盤、練習題）：欄 A–O 在下緣、列 1–15 在左緣。第十五批：寫在棋盤外側那道邊（geo.pad）的正中，不和棋子重疊
      if (v.coords) {
        var pd = geo.pad * dpr;
        ctx.fillStyle = mk.coord;
        ctx.font = '600 ' + (10 * dpr).toFixed(1) + 'px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (i = 0; i < N; i++) {
          ctx.fillText(COLS.charAt(i), px(i), W - pd / 2);
          ctx.fillText(String(N - i), pd / 2, px(i));
        }
      }

      var R = cell * 0.44;
      var b = v.board;
      var drop = anim.drop;
      if (drop && !b[drop.r][drop.c]) drop = anim.drop = null;
      for (r = 0; r < N; r++) {
        for (c = 0; c < N; c++) {
          if (!b[r][c] || (drop && r === drop.r && c === drop.c)) continue;
          th.stone(gm, px(c), px(r), R, b[r][c], { seed: r * 32 + c + 1 });
        }
      }
      if (drop) {
        var dk = Math.min(1, Math.max(0, (now - drop.t0) / DROP_MS)), de = 1 - Math.pow(1 - dk, 3);
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.65 * de;
        th.stone(gm, px(drop.c), px(drop.r), R * (1.18 - 0.18 * de), b[drop.r][drop.c], { seed: drop.r * 32 + drop.c + 1 });
        ctx.restore();
        if (dk >= 1) anim.drop = null;
      }

      if (v.ghosts && v.ghosts.length) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '700 ' + (cell * 0.42).toFixed(1) + 'px -apple-system, BlinkMacSystemFont, sans-serif';
        v.ghosts.forEach(function (q) {
          if (b[q.r][q.c]) return;
          ctx.globalAlpha = mk.ghostAlpha;
          th.stone(gm, px(q.c), px(q.r), R, q.p, { seed: q.r * 32 + q.c + 1, ghost: true });
          ctx.globalAlpha = 1;
          ctx.fillStyle = q.p === 1 ? mk.numB : mk.numW;
          ctx.fillText(String(q.num), px(q.c), px(q.r) + cell * 0.02);
        });
      }

      // 標記的線：風格有給描邊（mk.halo）時，先畫一道稍寬的描邊再畫本色；path() 每次重新描路徑
      var hw = Math.max(1, dpr * 0.9);
      function strokeKey(key, width, path) {
        var halo = mk.halo && mk.halo[key];
        if (halo) {
          ctx.strokeStyle = halo;
          ctx.lineWidth = width + hw * 2;
          path();
          ctx.stroke();
        }
        ctx.strokeStyle = col(key);
        ctx.lineWidth = width;
        path();
        ctx.stroke();
      }

      // 勝利五子的紅圈：有動畫時沿著連線一顆一顆描出來
      if (v.winCells) {
        var wa = anim.win, wc = v.winCells.slice().sort(function (a1, a2) { return a1[0] - a2[0] || a1[1] - a2[1]; });
        wc.forEach(function (w, j) {
          var f = wa ? Math.min(1, Math.max(0, (now - wa.t0 - j * WIN_STEP) / WIN_RING)) : 1;
          if (f <= 0) return;
          strokeKey('win', Math.max(2, cell * 0.09), function () {
            ctx.beginPath();
            ctx.arc(px(w[1]), px(w[0]), R * 0.98, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f);
          });
        });
        if (wa && now - wa.t0 >= (wc.length - 1) * WIN_STEP + WIN_RING) anim.win = null;
      }

      if (v.last) GT.lastMark(th, ctx, px(v.last.c), px(v.last.r), R, b[v.last.r][v.last.c] || 1, cell, dpr);

      // v.crosses（第十二批 c，練習題的禁手擋點）：指定的點畫同樣的紅 ×，那一點有子了就不畫
      if (v.forbidden || v.crosses) {
        var h = cell * 0.2, fx = [];
        if (v.forbidden) {
          for (r = 0; r < N; r++) {
            for (c = 0; c < N; c++) if (!b[r][c] && G.isForbidden(b, r, c)) fx.push([px(c), px(r)]);
          }
        }
        (v.crosses || []).forEach(function (q) { if (!b[q.r][q.c]) fx.push([px(q.c), px(q.r)]); });
        if (fx.length) {
          ctx.lineCap = 'round';
          strokeKey('forbid', Math.max(1.5, cell * 0.07), function () {
            ctx.beginPath();
            fx.forEach(function (p) {
              ctx.moveTo(p[0] - h, p[1] - h); ctx.lineTo(p[0] + h, p[1] + h);
              ctx.moveTo(p[0] + h, p[1] - h); ctx.lineTo(p[0] - h, p[1] + h);
            });
          });
          ctx.lineCap = 'square';
        }
      }

      if (v.marks) {
        var sq = cell * 0.24;
        v.marks.forEach(function (k) {
          ctx.fillStyle = col(k.color);
          ctx.fillRect(px(k.c) + cell * 0.2, px(k.r) - cell * 0.2 - sq, sq, sq);
          ctx.strokeStyle = mk.markEdge;
          ctx.lineWidth = Math.max(1, dpr); // 第十二批 c：描邊加粗一點（0.8 → 1 個 CSS 像素），和棋盤底對比 ≥ 3:1 的是這道邊
          ctx.strokeRect(px(k.c) + cell * 0.2, px(k.r) - cell * 0.2 - sq, sq, sq);
        });
      }

      if (v.frames) {
        v.frames.forEach(function (f) {
          var s = cell * 0.52;
          strokeKey(f.color, Math.max(2, cell * 0.1), function () {
            ctx.beginPath();
            ctx.rect(px(f.c) - s, px(f.r) - s, s * 2, s * 2);
          });
        });
      }

      if (v.rings) {
        v.rings.forEach(function (q) {
          // 虛線圈要用平頭線端：方頭會把每段往兩邊各延長半個線寬，把間隔補滿、看起來像實線
          ctx.lineCap = 'butt';
          ctx.setLineDash(q.dash ? [cell * 0.14, cell * 0.1] : []);
          strokeKey(q.color, Math.max(2, cell * 0.1), function () {
            ctx.beginPath();
            ctx.arc(px(q.c), px(q.r), R * 0.95, 0, Math.PI * 2);
          });
          ctx.setLineDash([]);
        });
      }

      if (v.flash) {
        v.flash.forEach(function (f) {
          strokeKey('flash', Math.max(3, cell * 0.14), function () {
            ctx.beginPath();
            ctx.arc(px(f.c), px(f.r), R * 1.02, 0, Math.PI * 2);
          });
        });
      }
      schedule();
    }

    return { canvas: canvas, geo: geo, setSize: setSize, draw: draw, redraw: redraw, cellAt: cellAt,
      animState: function () { return { drop: !!anim.drop, win: !!anim.win }; },
      view: function () { return lastView; } }; // 第十二批 c：測試讀目前畫的內容（圈、×、五連）
  }

  var bv = BoardView($('board'));

  // ---------------------------------------------------------- 背景執行緒：一個給 AI 下棋，一個給威脅提醒與復盤分析

  var workerOK = typeof Worker !== 'undefined';
  var aiWorker = null;
  var helper = null;
  var helperSeq = 0;
  var helperCb = {};

  // file:// 開啟時 new Worker 會拋錯 → 以後都用同步版
  function makeAIWorker() {
    if (!workerOK) return null;
    try {
      var w = new Worker('ai-worker.js');
      w.onmessage = onAIReply;
      w.onerror = function (e) {
        // 腳本載入失敗或 Worker 內出錯：改用同步版，並把手上這個請求補算
        if (e && e.preventDefault) e.preventDefault();
        workerOK = false;
        if (aiWorker === w) aiWorker = null;
        try { w.terminate(); } catch (err) { /* 已停 */ }
        if (S.thinking && S.pending) runSync(S.pending);
      };
      return w;
    } catch (e) {
      workerOK = false;
      return null;
    }
  }

  function failHelperPending() {
    var cbs = helperCb;
    helperCb = {};
    Object.keys(cbs).forEach(function (k) { cbs[k]({ type: 'error' }); });
  }

  function getHelper() {
    if (!workerOK) return null;
    if (helper) return helper;
    try {
      var w = new Worker('ai-worker.js');
      w.onmessage = function (e) {
        var d = e.data;
        if (!d || d.id == null || !helperCb[d.id]) return;
        helperCb[d.id](d);
      };
      w.onerror = function (e) {
        // 引擎還不認得這種訊息，或 Worker 內出錯：手上等回覆的全部當作失敗
        if (e && e.preventDefault) e.preventDefault();
        failHelperPending();
      };
      helper = w;
      return w;
    } catch (e) {
      workerOK = false;
      return null;
    }
  }

  function resetHelper() {
    failHelperPending();
    if (helper) { try { helper.terminate(); } catch (e) { /* 已停 */ } }
    helper = null;
  }

  // 威脅清單：cb(result 或 null)
  function requestThreats(board, player, rule, cb) {
    var w = getHelper();
    if (w) {
      var id = ++helperSeq;
      helperCb[id] = function (d) {
        delete helperCb[id];
        // 契約寫 'threats'；引擎批實作回 'threatsResult'，兩種都收
        cb(d && (d.type === 'threatsResult' || d.type === 'threats') ? d.result || null : null);
      };
      w.postMessage({ type: 'threats', id: id, board: cloneBoard(board), player: player, rule: rule });
      return;
    }
    setTimeout(function () {
      var res = null;
      if (G.listThreats) { try { res = G.listThreats(board, player, rule); } catch (e) { res = null; } }
      cb(res);
    }, 0);
  }

  // 整局分析：onProgress(index, result)、onDone(ok, summary)。回傳取消函式。
  // 時間預算不在這裡定：不傳 opts，一律用引擎（ai.js）的預設（作者 2026-09-29 拍板每手 800 ms、整盤 30 秒），只有一個來源。
  // summary：引擎在 analyzeDone 帶的整盤摘要（firstLosing、unanalyzedCount…）；沒有時是 null，review.js 自己從逐手結果算。
  function requestAnalysis(moves, rule, onProgress, onDone) {
    var w = getHelper();
    var plain = moves.map(function (m) { return { r: m.r, c: m.c }; });
    if (w) {
      var id = ++helperSeq;
      var live = true;
      helperCb[id] = function (d) {
        if (!live) return;
        if (d.type === 'analyzeProgress') onProgress(d.index, d.result);
        else if (d.type === 'analyzeDone') { live = false; delete helperCb[id]; onDone(true, d.summary || null); }
        else { live = false; delete helperCb[id]; onDone(false, null); }
      };
      w.postMessage({ type: 'analyze', id: id, moves: plain, rule: rule });
      return function cancel() {
        if (!live) return;
        live = false;
        delete helperCb[id];
        resetHelper(); // 整盤分析可能要幾十秒（上限見 ai.js）：直接停掉 Worker，不讓它在背景白算
      };
    }
    // 沒有 Worker（file:// 開啟）：若引擎有同步版 analyzeGame 就用它（會卡住畫面一陣子）
    var stop = false;
    setTimeout(function () {
      if (stop) return;
      if (!G.analyzeGame) { onDone(false, null); return; }
      var ok = true, out = null;
      try {
        out = G.analyzeGame(plain, rule, {
          onProgress: function (index, result) { if (!stop) onProgress(index, result); }
        });
      } catch (e) { ok = false; }
      // 同步版若也帶摘要（掛在回傳值的 summary 上）就一併交出；沒有就 null
      if (!stop) onDone(ok, ok && out && out.summary ? out.summary : null);
    }, 30);
    return function cancel() { stop = true; };
  }

  // ---------------------------------------------------------- AI 下棋

  function runSync(req) {
    // 先讓瀏覽器畫出玩家剛下的子與「AI 思考中」，再開始算
    if (S.aiTimer) clearTimeout(S.aiTimer);
    S.aiTimer = setTimeout(function () {
      S.aiTimer = null;
      if (req.id !== S.gen) return;
      var m = G.getMove(req.board, req.player, req.level, { rule: req.rule });
      onAIReply({ data: { id: req.id, move: m } });
    }, 30);
  }

  function onAIReply(e) {
    var d = e.data;
    if (!d || d.id !== S.gen || !S.thinking) return; // 舊請求的回覆
    S.thinking = false;
    S.pending = null;
    var m = d.move;
    if (m && !S.board[m.r][m.c]) play(m.r, m.c);
    else {
      // AI 沒有合法著法（回傳 null 或落在有子的點）：不落子、不換手，這局以和局結束
      endGame(0, 'noMove');
    }
  }

  function isAITurn() {
    return S.mode === 'pve' && !S.over && S.turn !== S.human;
  }

  // 回選單、重新開始、悔棋、進復盤時呼叫：AI 若在 Worker 裡算，直接停掉 Worker 再建一個新的
  function cancelAI() {
    if (S.aiTimer) clearTimeout(S.aiTimer);
    S.aiTimer = null;
    if (S.thinking && aiWorker) {
      aiWorker.terminate();
      aiWorker = makeAIWorker();
    }
    S.thinking = false;
    S.pending = null;
    S.gen++;
  }

  function maybeAI() {
    if (!isAITurn() || S.review) return;
    S.thinking = true;
    updateStatus();
    refreshHints();
    var req = { id: ++S.gen, board: cloneBoard(S.board), player: S.turn, level: levelArg(S.tier), rule: S.rule };
    S.pending = req;
    if (!aiWorker) aiWorker = makeAIWorker();
    if (aiWorker) aiWorker.postMessage(req);
    else runSync(req);
  }

  // ---------------------------------------------------------- 流程

  function readMenu() {
    S.mode = settings.mode;
    S.tier = menuTier();
    S.rule = settings.rule;
    S.strict = settings.rule === 'renju' && myForbid() === 'lose';
    S.human = settings.side;
    S.pid = me().id;
    var pp = pvpPids();
    S.pidB = pp.b;
    S.pidW = pp.w;
  }

  // preset：開局教學帶進來的前幾手；side：學習頁指定的執子
  function startGame(preset, side) {
    readMenu();
    if (side) S.human = side;
    S.preset = preset || null;
    if (!preset && !side) { settings.last = setupKey(); saveSettings(); }
    showPage('game');
    newGame();
  }

  function newGame() {
    cancelAI();
    S.board = G.createBoard();
    S.history = [];
    S.turn = 1;
    S.over = false;
    S.winner = 0;
    S.endReason = null;
    S.forbiddenKind = null;
    S.winCells = null;
    S.gameTs = Date.now();
    S.recorded = false;
    S.lastRec = null;
    renderResult();
    clearFlash();
    clearHintFlash();
    (S.preset || []).forEach(function (m) {
      S.board[m.r][m.c] = S.turn;
      S.history.push({ r: m.r, c: m.c, p: S.turn });
      S.turn = 3 - S.turn;
    });
    S.presetN = S.history.length;
    renderOppInfo();
    resize();
    refresh();
    maybeAI();
  }

  function backToMenu() {
    cancelAI();
    showPage('play');
  }

  // 第十四批（W 第 3 條）：下到一半（開局教學擺好的幾手之後有人下過、還沒結束）按「重新開始」「回到選單」先問一次
  function midGame() { return !S.over && S.history.length > S.presetN; }
  function confirmAbandon(go) {
    if (!midGame()) { go(); return; }
    showDialog(t('game.abandonAsk'), [
      { label: t('game.abandonYes'), primary: true, onClick: go },
      { label: t('game.abandonNo') } // Esc＝最後一個＝繼續下
    ]);
  }

  function blackHasLegal(board) {
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) if (!board[r][c] && !G.isForbidden(board, r, c)) return true;
    }
    return false;
  }

  function play(r, c) {
    var p = S.turn;
    S.board[r][c] = p;
    S.history.push({ r: r, c: c, p: p });
    knock();
    clearFlash();
    clearHintFlash();
    var w = G.checkWin(S.board, r, c, S.rule);
    if (w) {
      S.winCells = w.cells;
      endGame(w.player, 'five');
      return;
    }
    if (G.isFull(S.board)) { endGame(0, 'full'); return; }
    S.turn = 3 - p;
    // 連珠：輪到黑棋而剩下的空點全是禁手 → 和局（原本人類執黑時會卡住）
    if (S.rule === 'renju' && S.turn === 1 && !blackHasLegal(S.board)) { endGame(0, 'blackStuck'); return; }
    refresh();
    maybeAI();
  }

  // 嚴格模式：黑棋下在禁手點，真的落子並判白勝
  function playForbidden(r, c, kind) {
    S.board[r][c] = 1;
    S.history.push({ r: r, c: c, p: 1 });
    knock();
    S.forbiddenKind = kind;
    clearFlash();
    clearHintFlash();
    endGame(2, 'forbidden');
  }

  function endGame(winner, reason) {
    S.over = true;
    S.winner = winner;
    S.endReason = reason;
    S.thinking = false;
    refresh();
    recordGame();
  }

  function popOne() {
    var h = S.history.pop();
    S.board[h.r][h.c] = 0;
    return h;
  }

  // 雙人：退一手。單人：一路退到把玩家的上一手也退掉（平常是兩手；AI 思考中則是一手，並取消這次思考）。
  // 開局教學擺好的前幾手不退。
  function canUndo() {
    if (S.history.length <= S.presetN) return false;
    if (S.mode === 'pvp') return true;
    return S.history.slice(S.presetN).some(function (h) { return h.p === S.human; });
  }
  function undo() {
    if (!canUndo()) return;
    cancelAI();
    clearFlash();
    clearHintFlash();
    if (S.mode === 'pvp') popOne();
    else {
      while (S.history.length > S.presetN) {
        if (popOne().p === S.human) break;
      }
    }
    S.over = false;
    S.winner = 0;
    S.endReason = null;
    S.forbiddenKind = null;
    S.winCells = null;
    S.recorded = false;
    S.lastRec = null;
    renderResult();
    S.turn = S.history.length ? 3 - S.history[S.history.length - 1].p : 1;
    refresh();
    maybeAI();
  }

  // ---------------------------------------------------------- 戰績紀錄、積分結算（P）

  function recordGame() {
    if (!S.history.length || S.recorded) return;
    S.recorded = true;
    var result;
    if (S.mode === 'pvp') result = S.winner === 1 ? 'black' : S.winner === 2 ? 'white' : 'draw';
    else result = !S.winner ? 'draw' : S.winner === S.human ? 'win' : 'loss';
    var op = currentOpening();
    var rec = {
      ts: S.gameTs,
      at: Date.now(),
      mode: S.mode,
      tier: S.mode === 'pve' ? S.tier : null,
      rule: S.rule,
      strict: S.strict,
      human: S.mode === 'pve' ? S.human : null,
      result: result,
      n: S.history.length,
      end: S.endReason,
      forbidden: S.forbiddenKind || null,
      losing: null,
      opening: op ? op.code : null,
      moves: S.history.map(function (h) { return [h.r, h.c]; }),
      tierScale: 11,
      pid: S.mode === 'pve' ? S.pid : null,
      pidB: S.mode === 'pvp' ? S.pidB : null,
      pidW: S.mode === 'pvp' ? S.pidW : null,
      elo: null
    };
    // 每局只結算一次（第一次結束時）；悔棋後重下完，紀錄的結果會換成新的，但積分不再動
    var prev = GS.find(S.gameTs);
    var fresh = !(prev && (prev.elo || prev.eloSkip));
    if (fresh) settle(rec);
    else { rec.elo = prev.elo || null; if (prev.eloSkip) rec.eloSkip = prev.eloSkip; }
    GS.upsert(rec);
    S.lastRec = rec;
    S.lastFresh = fresh;
    renderResult();
    renderOppInfo();
  }

  // 結算：改帳號的積分、局數、徽章，並把每一方的結算寫進 rec.elo
  function settle(rec) {
    if (!RT) return;
    var x;
    if (rec.mode === 'pve') {
      var p = GS.profile(rec.pid), rb = aiRating(rec.tier);
      if (!p || rb == null) return;
      x = eloStep(p, rb, rec.result === 'win' ? 1 : rec.result === 'draw' ? 0.5 : 0);
      if (x.after == null) return;
      rec.elo = {};
      rec.elo[p.id] = x;
      GS.updateProfile(p.id, { rating: x.after, games: p.games + 1, badge: x.badgeAfter });
      return;
    }
    var pb = GS.profile(rec.pidB), pw = GS.profile(rec.pidW);
    if (!pb || !pw) return;
    if (pb.id === pw.id) { rec.eloSkip = 'same'; return; } // 同一個帳號對戰不計分
    var sb = rec.result === 'black' ? 1 : rec.result === 'white' ? 0 : 0.5;
    var xb, xw; // 兩邊都用賽前積分、各自的 K
    if (RT.settle) {
      var r = RT.settle({ rating: pb.rating, games: pb.games, id: pb.id }, { rating: pw.rating, games: pw.games, id: pw.id }, sb);
      if (!r || r.rated === false) { rec.eloSkip = 'same'; return; }
      xb = eloPack(pb, pw.rating, sb, r.a);
      xw = eloPack(pw, pb.rating, 1 - sb, r.b);
    } else {
      xb = eloStep(pb, pw.rating, sb);
      xw = eloStep(pw, pb.rating, 1 - sb);
    }
    if (xb.after == null || xw.after == null) return;
    rec.elo = {};
    rec.elo[pb.id] = xb;
    rec.elo[pw.id] = xw;
    GS.updateProfile(pb.id, { rating: xb.after, games: pb.games + 1, badge: xb.badgeAfter });
    GS.updateProfile(pw.id, { rating: xw.after, games: pw.games + 1, badge: xw.badgeAfter });
  }

  // 同一 AI 對手（同一階）連勝 5 局／連敗 3 局的提示（只提示）；和局或換階就斷
  function streakHint(rec) {
    if (rec.mode !== 'pve' || (rec.result !== 'win' && rec.result !== 'loss')) return null;
    var list = GS.loadFor(rec.pid).filter(function (g) { return g.mode === 'pve'; }).sort(GS.byTime);
    var k = 0;
    for (var i = list.length - 1; i >= 0; i--) {
      if (GS.tierOf(list[i]) !== rec.tier || list[i].result !== rec.result) break;
      k++;
    }
    if (rec.result === 'win' && k >= 5) return 'elo.hintUp';
    if (rec.result === 'loss' && k >= 3) return 'elo.hintDown';
    return null;
  }

  function whoText(p) {
    return t('info.who', { emoji: p.emoji || '', name: p.name, badge: badgeName(badgeOf(p)), rating: Math.round(p.rating) });
  }

  // 局末結算卡（第十四批，規格 V、W 第 6 條）：下完時取代下方兩排按鈕。主行只寫分數變了多少（「你多了 14 分」「分數不變」），
  // 對手分數與「照分數算，你贏的機會」放小字；前 10 盤（這盤之前算過分的不到 10 盤）多一句「分數還在找你的程度」。
  // 兩顆大按鈕「再來一盤」「回頭看這盤」，小的「回到選單」「退一步」。回頭看時收起，回到對局再顯示。
  // 第十六批（judge 第八輪）：兩人一起下的主行改內文字級（整句有名字，24 太大）、「分數還在找…的程度」兩人合出一次；
  // 棋盤縮到最小（240）結算卡仍超出首屏時，小字（rs-small）摺進最後的「看詳細」
  function renderResult() {
    var box = $('resultBox'), rec = S.lastRec;
    var wasHidden = box.hidden, ctlWas = $('controls').hidden;
    box.hidden = !S.over || !!S.review;
    $('controls').hidden = !!S.review || S.over;
    $('rsUndo').hidden = !canUndo();
    fillResult(rec, false);
    if (!box.hidden) {
      resize();
      if (rec && box.getBoundingClientRect().bottom > window.innerHeight + 0.5) { fillResult(rec, true); resize(); }
    } else if (box.hidden !== wasHidden || $('controls').hidden !== ctlWas) resize();
  }
  function fillResult(rec, fold) {
    var lines = $('resultLines'), det = null;
    lines.textContent = '';
    if (rec && !S.review) {
      var line = function (text, cls) {
        var d = mk('div', 'rs-line' + (cls ? ' ' + cls : ''), text);
        if (fold && cls === 'rs-small') {
          if (!det) { det = mk('details', 'rs-more'); det.appendChild(mk('summary', '', t('result.more'))); }
          det.appendChild(d);
        } else lines.appendChild(d);
        return d;
      };
      var badgeLine = function (x, who) {
        if (!x.badgeBefore || !x.badgeAfter) return;
        var from = badgeName(x.badgeBefore), to = badgeName(x.badgeAfter);
        if (x.badgeAfter === x.badgeBefore) {
          if (!who) line(t('elo.now', { rating: Math.round(x.after), badge: to }), 'muted');
          return;
        }
        var up = x.after > x.before;
        var el = line(t((up ? 'elo.up' : 'elo.down') + (who ? 'Who' : ''), { who: who, from: from, to: to }), up ? 'badge-up' : 'badge-down');
        if (up && S.lastFresh) el.appendChild(mk('span', 'badge big b-' + x.badgeAfter, to));
      };
      var d;
      if (rec.mode === 'pve') {
        var x = rec.elo && rec.elo[rec.pid];
        if (x) {
          d = Math.round(x.after) - Math.round(x.before);
          line(d > 0 ? t('elo.mainUp', { n: d }) : d < 0 ? t('elo.mainDown', { n: -d }) : t('elo.mainSame'), 'rs-main');
          line(t('elo.detail', { tier: tierName(rec.tier), opp: Math.round(x.opp), exp: Math.round(100 * x.exp) }), 'rs-small');
          if (x.games < 10) line(t('elo.early'), 'rs-small');
          badgeLine(x, null);
        }
        var h = streakHint(rec);
        if (h) line(t(h), 'rs-hint');
      } else if (rec.eloSkip === 'same') {
        line(t('elo.same'), 'muted');
      } else if (rec.elo) {
        var early = [];
        [[rec.pidB, 1], [rec.pidW, 2]].forEach(function (a) {
          var y = rec.elo[a[0]];
          if (!y) return;
          var p = GS.profile(a[0]);
          var who = p ? (p.emoji || '') + p.name : '';
          var dy = Math.round(y.after) - Math.round(y.before), pa = { who: who, color: colorName(a[1]), n: Math.abs(dy), rating: Math.round(y.after) };
          line(t(dy > 0 ? 'elo.pvpUp' : dy < 0 ? 'elo.pvpDown' : 'elo.pvpSame', pa), 'rs-main rs-pvp');
          line(t('elo.pvpExp', { who: who, exp: Math.round(100 * y.exp) }), 'rs-small');
          if (y.games < 10) early.push(who);
          badgeLine(y, who);
        });
        // 兩人都還在前 10 盤：「你們」；只有一人：寫出是誰
        if (early.length) line(early.length > 1 ? t('elo.earlyBoth') : t('elo.earlyWho', { who: early[0] }), 'rs-small');
      }
      if (!S.lastFresh && rec.elo) line(t('elo.already'), 'muted');
    }
    if (det) lines.appendChild(det);
  }

  // 換階（推薦對手用）：寫進目前帳號的 pref、選單跟著改
  function setTier(tier) {
    tier = Math.max(1, Math.min(MAX_TIER, tier));
    var g = tierGroup(tier), pr = pref();
    pr.group = g;
    if (GROUP_TIERS[g].length > 1) pr.sub[g] = tier;
    savePref(pr);
    setupChanged();
    S.tier = tier;
  }

  // ---------------------------------------------------------- 狀態列、對手資訊、開局

  function clearFlash() {
    if (S.flashTimer) clearTimeout(S.flashTimer);
    S.flashTimer = null;
    S.flash = null;
  }

  // 狀態列閃一句話 1.5 秒
  function flash(text) {
    clearFlash();
    S.flash = text;
    S.flashTimer = setTimeout(function () {
      S.flashTimer = null;
      S.flash = null;
      updateStatus();
    }, 1500);
    updateStatus();
  }

  function forbiddenName(f) { return I.forbiddenName(f); }

  // 對局結束時的一句話（復盤也用）
  function endText(g) {
    if (g.end === 'noMove') return t('status.noMove');
    if (g.end === 'blackStuck') return t('status.blackStuck');
    if (g.end === 'forbidden') return t('status.forbiddenLoss', { kind: forbiddenName(g.forbidden) });
    if (!g.winner) return t('status.draw');
    if (g.mode === 'pvp') return t('status.winColor', { color: colorName(g.winner) });
    return g.winner === g.human ? t('status.youWin') : t('status.aiWins', { tier: tierName(g.tier) });
  }

  function setStatus(text, dotP, warn) {
    var el = $('status');
    el.classList.toggle('warn', !!warn);
    el.textContent = '';
    if (dotP) el.appendChild(mk('span', 'dot ' + (dotP === 1 ? 'b' : 'w')));
    el.appendChild(document.createTextNode(text));
  }

  function updateStatus() {
    if (S.review) return;
    var text;
    if (S.over) {
      text = endText({ end: S.endReason, forbidden: S.forbiddenKind, winner: S.winner, mode: S.mode, human: S.human, tier: S.tier });
    } else if (S.flash) text = S.flash;
    else if (S.thinking) text = t('status.thinking', { tier: tierName(S.tier) });
    else if (S.mode === 'pvp') text = t('status.turnColor', { color: colorName(S.turn) });
    else text = t('status.yourTurn', { color: colorName(S.turn) });
    setStatus(text, S.over ? S.winner : S.turn, (!!S.flash && !S.over) || S.endReason === 'forbidden');
    $('undoBtn').disabled = !canUndo();
    // 第十四批（W 第 12 條）：跟電腦下時，「回頭看這盤」要等這盤下完（灰掉、小字「下完才能看」）；兩人一起下隨時可以
    var early = S.mode === 'pve' && !S.over;
    $('reviewBtn').disabled = !S.history.length || early;
    $('reviewNote').hidden = !early;
  }
  function canReview() { return S.history.length > 0 && (S.mode === 'pvp' || S.over); }

  // K：對局畫面固定一條對手資訊。對局中（沒有 info）加上雙方積分與徽章，分兩行：誰對誰、規則與執子。
  // 復盤（有 info）照舊一行，只寫當時的階與規則。
  function renderOppInfo(info) {
    var box = $('oppInfo');
    box.textContent = '';
    if (info) {
      var rule0 = ruleLabel(info.rule, info.strict);
      box.textContent = info.mode === 'pvp'
        ? t('info.pvp', { rule: rule0 })
        : t('info.pve', { tier: tierName(info.tier), rule: rule0, side: t(info.human === 2 ? 'info.youWhite' : 'info.youBlack') });
      return;
    }
    var rule = ruleLabel(S.rule, S.strict), l1, l2;
    if (S.mode === 'pvp') {
      var pb = GS.profile(S.pidB), pw = GS.profile(S.pidW);
      l1 = pb && pw ? t('info.pvpPlayers', { b: whoText(pb), w: whoText(pw) }) : '';
      l2 = t('info.pvp', { rule: rule });
    } else {
      var p = GS.profile(S.pid) || me(), opp = aiRating(S.tier);
      l1 = t('info.players', { badge: badgeName(badgeOf(p)), rating: Math.round(p.rating), tier: tierName(S.tier), opp: opp == null ? '' : Math.round(opp) });
      l2 = t('info.ruleSide', { rule: rule, side: t(S.human === 2 ? 'info.youWhite' : 'info.youBlack') });
    }
    [l1, l2].forEach(function (s) { if (s) box.appendChild(mk('div', 'oi-line', s.replace(/\s+/g, ' ').trim())); });
  }

  function openingsData() {
    var d = window.GomokuOpenings;
    return d && d.openings ? d.openings : null;
  }
  function openingByCode(code) {
    var list = openingsData() || [];
    for (var i = 0; i < list.length; i++) if (list[i].code === code) return list[i];
    return null;
  }
  function openingName(op) {
    var full = openingByCode(op.code) || op;
    var name = full.name || op.name || '';
    if (I.getLang() !== 'en') return name;
    var en = full.nameEn || I.ROMAJI[op.code] || '';
    if (!en) return name;
    return en.indexOf(name) >= 0 ? en : en + ' ' + name;
  }
  function openingLabel(op) { return t('opening.label', { name: openingName(op), code: op.code }); }
  function detectOpening(moves) {
    if (!G.detectOpening || moves.length < 3) return null;
    try { return G.detectOpening(moves.slice(0, 3).map(function (m) { return { r: m.r, c: m.c }; })) || null; }
    catch (e) { return null; }
  }
  function currentOpening() { return detectOpening(S.history); }

  function updateSubStatus() {
    if (S.review) return;
    var op = currentOpening();
    $('subStatus').textContent = op ? openingLabel(op) : '';
  }

  // ---------------------------------------------------------- B：威脅提醒（棋盤外文字）

  function clearHintFlash() {
    if (S.hintFlashTimer) clearTimeout(S.hintFlashTimer);
    S.hintFlashTimer = null;
    S.hintFlash = null;
  }
  function flashPoints(pts) {
    clearHintFlash();
    S.hintFlash = pts;
    draw();
    S.hintFlashTimer = setTimeout(function () {
      S.hintFlashTimer = null;
      S.hintFlash = null;
      draw();
    }, 2000);
  }

  // 點的清單；引擎的活四／活三項目是 { points, stones }，取 points（成五點／成活四點）
  function pts(list) {
    if (!list) return [];
    var out = [];
    list.forEach(function (m) {
      if (!m) return;
      if (Array.isArray(m.points)) out = out.concat(pts(m.points));
      else if (Array.isArray(m)) out.push({ r: m[0], c: m[1] });
      else if (typeof m.r === 'number') out.push({ r: m.r, c: m.c });
    });
    return out;
  }
  // 連珠下黑棋的三三／四四點本身是禁手，不是威脅
  function dropForbidden(list, p, rule, board) {
    if (rule !== 'renju' || p !== 1) return list;
    return list.filter(function (m) { return !board[m.r][m.c] && !G.isForbidden(board, m.r, m.c); });
  }

  function hintVisible() {
    return settings.hints && !S.review && !$('game').hidden;
  }

  // 第十四批（規格 V、W 第 1 條）：提醒列可以收起（記在這台裝置的 hintsOpen）；收起時只剩「展開提醒」一顆鈕。
  // 下完之後（結算卡出現）整條不顯示
  function renderHintToggle() {
    var open = settings.hintsOpen;
    $('hintBody').hidden = !open;
    $('hints').classList.toggle('closed', !open);
    var tg = $('hintToggle');
    tg.textContent = t(open ? 'hint.hide' : 'hint.show');
    tg.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function refreshHints() {
    var box = $('hints'), body = $('hintBody');
    box.hidden = !settings.hints || !!S.review || S.over;
    if (box.hidden) return;
    renderHintToggle();
    var seq = ++S.hintSeq;
    body.textContent = '';
    // 單人模式只在人類回合；結束後不提醒
    if (S.over || S.thinking || isAITurn()) return;
    var me = S.turn, opp = 3 - me;
    var board = cloneBoard(S.board), rule = S.rule;
    var got = {};
    function done() {
      if (seq !== S.hintSeq || !hintVisible()) return;
      if (!('opp' in got) || !('own' in got)) return;
      renderHints(got.opp, got.own, me, opp, board, rule);
    }
    requestThreats(board, opp, rule, function (res) { got.opp = res; done(); });
    requestThreats(board, me, rule, function (res) { got.own = res; done(); });
  }

  // 一句提醒。第十四批（W 第 1 條）：句子裡的名詞不再是可點的字，改在句尾放一顆「？」（開規則說明面板的那個名詞）；
  // 整句可點＝在棋盤上閃出位置（有位置時）
  function hintItem(key, params, points, cls) {
    var d = mk('div', 'hint-item' + (cls ? ' ' + cls : ''));
    // 第十五批（規格 V）：提醒列只有「注意：」這個前綴用 danger 色，句子其餘是 ink
    var txt = t(key, params), wp = t('hint.watch');
    if (wp && txt.indexOf(wp) === 0) { d.appendChild(mk('span', 'hint-watch', wp)); txt = txt.slice(wp.length); }
    d.appendChild(document.createTextNode(txt));
    var tm = I.terms(key, params)[0];
    if (tm) {
      var q = mk('button', 'term term-q', t('hint.q'));
      q.type = 'button';
      q.setAttribute('data-term', tm);
      q.setAttribute('aria-label', t('hint.what', { term: I.termText(tm) }));
      d.appendChild(q);
    }
    if (points && points.length) {
      d.classList.add('has-pts');
      d.tabIndex = 0;
      d.setAttribute('role', 'button');
      var fire = function (e) {
        if (e.target.closest && e.target.closest('.term')) return; // 點「？」是開說明，不閃點
        flashPoints(points);
      };
      d.addEventListener('click', fire);
      d.addEventListener('keydown', function (e) {
        if (e.target !== d) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(e); }
      });
    }
    return d;
  }
  function hasVCF(x) { return !!(x && x.vcf && (x.vcf.move || (x.vcf.line && x.vcf.line.length))); }

  function renderHints(o, s, me, opp, board, rule) {
    var box = $('hintBody');
    box.textContent = '';
    if (!o && !s) {
      box.appendChild(hintItem('hint.unavailable', null, null, 'muted'));
      return;
    }
    var line1 = mk('div', 'hint-line'), line1b = null;
    // 第十二批 c：自己下一步就能連成五時，對手的提醒不出現（不然「對手有活四，已經擋不住了」和「你下一步就能連成五」會同時出現；
    // 輪到自己，先連成五就贏了）
    var own5 = s ? pts(s.fours).concat(pts(s.openFours)) : [];
    if (own5.length) o = null;
    if (o) {
      var of4 = pts(o.openFours), f4 = pts(o.fours), f3 = pts(o.threes);
      var fourThree = dropForbidden(pts(o.fourThree), opp, rule, board);
      var d3 = dropForbidden(pts(o.doubleThree), opp, rule, board);
      var d4 = dropForbidden(pts(o.doubleFour), opp, rule, board);
      var any = false;
      if (of4.length) { line1.appendChild(hintItem('hint.oppOpenFour', null, of4)); any = true; }
      // 第十四批（W 第 1 條）：有活四時不再同時說「對手有四，要馬上擋」
      else if (f4.length) { line1.appendChild(hintItem('hint.oppFour', null, f4)); any = true; }
      var kinds = [], dpts = [];
      if (fourThree.length) { kinds.push('[[fourThree.pt]]'); dpts = dpts.concat(fourThree); }
      if (d4.length) { kinds.push('[[doubleFour.pt]]'); dpts = dpts.concat(d4); }
      if (d3.length) { kinds.push('[[doubleThree.pt]]'); dpts = dpts.concat(d3); }
      if (kinds.length) { line1.appendChild(hintItem('hint.oppDouble', { kinds: kinds.join(t('list.sep')) }, dpts)); any = true; }
      if (f3.length) { line1.appendChild(hintItem('hint.oppThrees', { n: (o.threes || []).length }, f3)); any = true; }
      if (!any) line1.appendChild(hintItem('hint.oppNone', null, null));
      // 對手能一路用四逼到贏（listThreats 的 vcf）：另出一行。對手已經有四或活四時，vcf 就是那個四，上面已經說了
      if (hasVCF(o) && !of4.length && !f4.length) {
        line1b = mk('div', 'hint-line');
        line1b.appendChild(hintItem('hint.oppVCF', null, pts([o.vcf.move || o.vcf.line[0]])));
      }
    }
    var line2 = null;
    if (s) {
      line2 = mk('div', 'hint-line own');
      if (own5.length) line2.appendChild(hintItem('hint.ownFour', null, own5));
      var okinds = [], opts2 = [];
      var ft = dropForbidden(pts(s.fourThree), me, rule, board);
      var dd4 = dropForbidden(pts(s.doubleFour), me, rule, board);
      var dd3 = dropForbidden(pts(s.doubleThree), me, rule, board);
      if (ft.length) { okinds.push('[[fourThree.pt]]'); opts2 = opts2.concat(ft); }
      if (dd4.length) { okinds.push('[[doubleFour.pt]]'); opts2 = opts2.concat(dd4); }
      if (dd3.length) { okinds.push('[[doubleThree.pt]]'); opts2 = opts2.concat(dd3); }
      if (okinds.length) line2.appendChild(hintItem('hint.ownDouble', { kinds: okinds.join(t('list.sep')) }, opts2));
      if (!own5.length && hasVCF(s)) {
        line2.appendChild(hintItem('hint.ownVCF', null, pts([s.vcf.move || s.vcf.line[0]])));
      }
    }
    var rows = [line1, line1b, line2].filter(function (x) { return x && x.children.length; });
    rows.forEach(function (x) { box.appendChild(x); });
    // 行尾小字「點這行，棋盤會閃出位置」：只在有可以閃的句子時出現，放在第一個有可閃句子的那一行最後
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].querySelector('.has-pts')) { rows[i].appendChild(mk('small', 'hint-tip', t('hint.tip'))); break; }
    }
  }

  // ---------------------------------------------------------- 畫面更新

  function gameView() {
    return {
      board: S.board,
      last: S.history.length ? S.history[S.history.length - 1] : null,
      winCells: S.winCells,
      forbidden: S.rule === 'renju' && !S.over && S.turn === 1,
      flash: S.hintFlash
    };
  }

  function draw() {
    if (S.review) RV.redraw();
    else bv.draw(gameView());
  }

  function refresh() {
    draw();
    updateStatus();
    updateSubStatus();
    refreshHints();
  }

  function resize() {
    var game = $('game');
    if (game.hidden) return;
    var wrap = $('boardWrap');
    var availW = wrap.clientWidth;
    var reserved = 0;
    Array.prototype.forEach.call(game.children, function (ch) {
      // 復盤面板在棋盤下方、可以往下捲，不算進去。第十四批：結算卡取代了下方兩排按鈕、上面有「再來一盤」，要算進去
      // （所以下完時棋盤會縮一點，換結算卡在首屏看得到）
      if (ch === wrap || ch.hidden || ch.id === 'reviewPanel') return;
      var cs = getComputedStyle(ch);
      reserved += ch.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
    });
    var availH = window.innerHeight - reserved - 32;
    var size = Math.floor(Math.min(availW, availH, 640));
    if (size < 240) size = Math.floor(Math.min(availW, 240));
    bv.setSize(size);
    draw();
  }

  // ---------------------------------------------------------- 輸入

  $('board').addEventListener('click', function (e) {
    if (S.review || S.over || S.thinking || isAITurn()) return;
    var p = bv.cellAt(e.clientX, e.clientY);
    if (!p || S.board[p.r][p.c]) return;
    if (S.rule === 'renju' && S.turn === 1) {
      var f = G.isForbidden(S.board, p.r, p.c);
      if (f) {
        if (S.strict) { playForbidden(p.r, p.c, f); return; }
        flash(t('status.forbidden', { kind: forbiddenName(f) })); // 不落子、不判負
        return;
      }
    }
    play(p.r, p.c);
  });

  // ---------------------------------------------------------- 復盤（review.js）

  function gameInfoFromState() {
    return {
      moves: S.history.slice(), rule: S.rule, strict: S.strict, tier: S.tier, mode: S.mode, human: S.human,
      over: S.over, end: S.over ? S.endReason : null, winner: S.winner, forbidden: S.forbiddenKind,
      ts: S.gameTs, recorded: S.recorded
    };
  }
  function gameInfoFromRecord(rec) {
    var winner = 0;
    if (rec.mode === 'pvp') winner = rec.result === 'black' ? 1 : rec.result === 'white' ? 2 : 0;
    else if (rec.result === 'win') winner = rec.human;
    else if (rec.result === 'loss') winner = 3 - rec.human;
    return {
      moves: rec.moves.map(function (m) { return { r: m[0], c: m[1] }; }),
      rule: rec.rule === 'renju' ? 'renju' : 'free', strict: !!rec.strict, tier: GS.tierOf(rec), mode: rec.mode,
      human: rec.human || 1, over: true, end: rec.end || (winner ? 'five' : 'full'), winner: winner,
      forbidden: rec.forbidden || null, ts: rec.ts, recorded: true, at: rec.at
    };
  }

  // 第十四批：回頭看時收起提醒列、下方兩排按鈕與結算卡；棋盤上方那一列放「換風格」，
  // 對局中（還沒下完）進來的再加「回到這盤棋」（W 第 2 條：放在狀態列旁）
  function setReviewUI(on, info) {
    $('hints').hidden = on || !settings.hints || S.over;
    $('gameExtra').hidden = !on;
    $('rvBackBtn').hidden = !(on && S.review === 'game' && info && !info.over);
    $('reviewBar').hidden = !on;
    $('reviewPanel').hidden = !on;
    renderResult(); // 復盤時收起結算與按鈕，回到對局再顯示
  }

  function enterReview(info, from) {
    if (!info.moves.length) return;
    if (from === 'game' && !canReview()) return; // 跟電腦下時要等這盤下完（W 第 12 條）
    cancelAI();
    clearHintFlash();
    S.review = from;
    showPage('game');
    setReviewUI(true, info);
    renderOppInfo(info);
    RV.open(info);
    resize();
  }

  function exitReview() {
    var from = S.review;
    RV.close();
    S.review = null;
    setReviewUI(false);
    if (from === 'stats') { showPage('stats'); return; }
    renderOppInfo();
    resize();
    refresh();
    maybeAI();
  }

  function copyText(text, ok, fail) {
    function legacy() {
      var ta = mk('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var done = false;
      try { done = document.execCommand('copy'); } catch (e) { done = false; }
      document.body.removeChild(ta);
      if (done) ok(); else fail();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, legacy);
    } else legacy();
  }

  RV.init({
    boardView: bv,
    requestAnalysis: requestAnalysis,
    setStatus: setStatus,
    setSubStatus: function (text) { $('subStatus').textContent = text || ''; },
    endText: endText,
    coordName: coordName,
    colorName: colorName,
    tierName: tierName,
    ruleLabel: ruleLabel,
    detectOpening: detectOpening,
    openingLabel: openingLabel,
    copyText: copyText,
    onExit: exitReview,
    backLabel: function () { return t(S.review === 'stats' ? 'review.backStats' : 'review.backGame'); },
    // 第十六批（judge 第八輪）：兩人一起下、對局中進回頭看時有兩顆「回到這盤棋」。留上方那顆（W 第 2 條指定放在狀態列旁、
    // 不用捲就看得到），面板底下那顆不畫；下完才進來的、從紀錄進來的，上方沒有，面板那顆照舊
    hideBack: function () { return !$('rvBackBtn').hidden; },
    onLosingFound: function (info, moveNo) { if (info.recorded && info.ts) GS.setLosing(info.ts, moveNo); },
    version: window.GOMOKU_VERSION || ''
  });

  // ---------------------------------------------------------- 對話框（自動調整、清除確認）與焦點鎖

  var dialogReturn = null;
  function showDialog(text, buttons) {
    var box = $('dialogBtns');
    $('dialogText').textContent = text;
    box.textContent = '';
    dialogReturn = document.activeElement;
    buttons.forEach(function (b) {
      var btn = mk('button', b.primary ? '' : 'secondary', b.label);
      btn.type = 'button';
      if (b.danger) btn.classList.add('danger');
      btn.addEventListener('click', function () {
        closeDialog();
        if (b.onClick) b.onClick();
      });
      box.appendChild(btn);
    });
    $('dialog').hidden = false;
    box.firstChild.focus();
  }
  function closeDialog() {
    if ($('dialog').hidden) return;
    $('dialog').hidden = true;
    if (dialogReturn && dialogReturn.focus) dialogReturn.focus();
    dialogReturn = null;
  }

  function openModal() {
    var ms = document.querySelectorAll('.modal');
    for (var i = ms.length - 1; i >= 0; i--) if (!ms[i].hidden) return ms[i];
    return null;
  }
  // Tab／Shift+Tab 只在開著的面板裡轉
  document.addEventListener('keydown', function (e) {
    var m = openModal();
    if (!m) return;
    if (e.key === 'Escape') {
      if (m.id === 'ruleHelp') closeRuleHelp();
      else if (m.id === 'themePanel') closeThemePanel();
      else if (m.id === 'moreSheet') closeMoreSheet(true);
      else if (m.id === 'profiles') { if (!$('profileForm').hidden) closeProfileForm(); else closeProfiles(); }
      else if (m.id === 'dialog') {
        var btns = $('dialogBtns').querySelectorAll('button');
        if (btns.length) btns[btns.length - 1].click(); // Esc = 最後一個（先不要／取消）
      }
      return;
    }
    if (e.key !== 'Tab') return;
    var f = Array.prototype.filter.call(
      m.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      function (x) {
        if (x.disabled || x.offsetParent === null) return false;
        // 同一組單選鈕在 Tab 順序裡只算一站（選中的那個；都沒選時第一個），和瀏覽器自己的 Tab 一致（第九批 b：換風格面板）
        if (x.type === 'radio' && x.name) {
          var grp = m.querySelectorAll('input[type="radio"][name="' + x.name + '"]'), chk = null;
          for (var gi = 0; gi < grp.length; gi++) if (grp[gi].checked) chk = grp[gi];
          return x === (chk || grp[0]);
        }
        return true;
      });
    if (!f.length) { e.preventDefault(); return; }
    var first = f[0], last = f[f.length - 1];
    var inside = m.contains(document.activeElement);
    if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
  });

  // ---------------------------------------------------------- 規則說明面板

  // 9×9 局部棋盤示意圖。'B' 黑、'W' 白、'5' 黑（成五，加紅圈）、'x' 禁手點（紅 ×）、'+' 黑下這一點（橘圈）、'.' 空。
  var FIGS = {
    free: ['.........', '.........', '......W..', '.........', '..55555..', '...W.....', '.....W...', '.........', '.........'],
    '33': ['.........', '.........', '.........', '.........', '..BBx....', '....B....', '....B....', '.........', '.........'],
    '44': ['.........', '.........', '.........', '.........', 'WBBBx....', '....B....', '....B....', '....B....', '....W....'],
    '6': ['.........', '.........', '.........', '.........', '.BBBxBB..', '.........', '.........', '.........', '.........'],
    openFour: ['.........', '.........', '.........', '.........', '..BBBB...', '.........', '.........', '.........', '.........'],
    four: ['.........', '.........', '.........', '.........', '.WBBBB...', '.........', '.........', '.........', '.........'],
    openThree: ['.........', '.........', '.........', '.........', '...BBB...', '.........', '.........', '.........', '.........'],
    fourThree: ['.........', '.........', '.........', '.........', '.WBBB+...', '.....B...', '.....B...', '.........', '.........']
  };

  // 小圖的底、線、子（第八批 b：顏色跟著目前的棋盤風格；themes.js 的 svg 色表）
  function svgBoard(n, span, rx) {
    var P = GT.current().svg;
    // 底色和面板很像的風格（紙本、高對比）給小圖加一圈外框，才看得出棋盤的範圍
    var s = '<rect width="' + span + '" height="' + span + '" rx="' + rx + '" fill="' + P.bg + '"' +
      (P.frame ? ' stroke="' + P.frame + '" stroke-width="2"' : '') + '/><g stroke="' + P.line + '" stroke-width="' + P.lineW + '">';
    for (var i = 0; i < n; i++) {
      var v = 10 + i * 20;
      s += '<line x1="0" y1="' + v + '" x2="' + span + '" y2="' + v + '"/><line x1="' + v + '" y1="0" x2="' + v + '" y2="' + span + '"/>';
    }
    return s + '</g>';
  }
  function svgStone(x, y, black) {
    var P = GT.current().svg;
    if (black) return '<circle cx="' + x + '" cy="' + y + '" r="8.5" fill="' + P.black + '"' + (P.blackEdge ? ' stroke="' + P.blackEdge + '" stroke-width="1"' : '') + '/>';
    var w = P.whiteEdgeW;
    return '<circle cx="' + x + '" cy="' + y + '" r="' + (8.5 - (w > 1 ? w / 2 : 0)) + '" fill="' + P.white + '" stroke="' + P.whiteEdge + '" stroke-width="' + w + '"/>';
  }

  function figSVG(rows) {
    var n = rows.length, span = n * 20, P = GT.current().svg;
    var s = svgBoard(n, span, 8);
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        var ch = rows[r].charAt(c), x = 10 + c * 20, y = 10 + r * 20;
        if (ch === 'B' || ch === '5') s += svgStone(x, y, true);
        if (ch === '5') s += '<circle cx="' + x + '" cy="' + y + '" r="8.5" fill="none" stroke="' + P.five + '" stroke-width="2"/>';
        if (ch === 'W') s += svgStone(x, y, false);
        if (ch === '+') s += '<circle cx="' + x + '" cy="' + y + '" r="8" fill="none" stroke="' + P.plus + '" stroke-width="3"/>';
        if (ch === 'x') s += '<path d="M' + (x - 6) + ' ' + (y - 6) + 'L' + (x + 6) + ' ' + (y + 6) + 'M' + (x + 6) + ' ' + (y - 6) + 'L' + (x - 6) + ' ' + (y + 6) +
          '" stroke="' + P.forbid + '" stroke-width="3" stroke-linecap="round"/>';
      }
    }
    return s;
  }

  function renderFigs() {
    document.querySelectorAll('svg[data-fig]').forEach(function (el) {
      var rows = FIGS[el.getAttribute('data-fig')];
      el.setAttribute('viewBox', '0 0 ' + rows.length * 20 + ' ' + rows.length * 20);
      el.innerHTML = figSVG(rows);
    });
  }

  // 名詞 → 規則說明面板裡的圖
  var TERM_FIG = {
    openThree: 'openThree', four: 'four', openFour: 'openFour', fourThree: 'fourThree',
    doubleThree: 'doubleThree', doubleFour: 'doubleFour', overline: 'overline', vcf: 'vcf', vct: 'vct',
    forbidden: 'doubleThree', renju: 'doubleThree'
  };

  var helpReturnFocus = null;
  function openRuleHelp(e, term) {
    helpReturnFocus = (e && e.currentTarget && e.currentTarget.focus) ? e.currentTarget : document.activeElement;
    var box = $('ruleHelp');
    box.hidden = false;
    var panel = box.querySelector('.panel');
    panel.scrollTop = 0;
    Array.prototype.forEach.call(panel.querySelectorAll('.hl'), function (x) { x.classList.remove('hl'); });
    if (term) {
      var target = $('fig-' + (TERM_FIG[term] || term));
      if (target) {
        target.classList.add('hl');
        panel.scrollTop = Math.max(0, target.offsetTop - panel.offsetTop - 12);
      }
    }
    $('ruleHelpClose').focus();
  }
  function closeRuleHelp() {
    if ($('ruleHelp').hidden) return;
    $('ruleHelp').hidden = true;
    if (helpReturnFocus && helpReturnFocus.focus) helpReturnFocus.focus();
    helpReturnFocus = null;
  }
  document.querySelectorAll('[data-rule-help]').forEach(function (el) {
    el.addEventListener('click', openRuleHelp);
  });
  $('ruleHelpClose').addEventListener('click', closeRuleHelp);
  $('ruleHelp').addEventListener('click', function (e) { if (e.target === this) closeRuleHelp(); }); // 點面板外的暗處關閉
  // 說明句裡的名詞（i18n.js 產生的 .term 按鈕）
  document.addEventListener('click', function (e) {
    var term = e.target.closest && e.target.closest('.term');
    if (!term) return;
    e.preventDefault();
    openRuleHelp({ currentTarget: term }, term.getAttribute('data-term'));
  });

  // ---------------------------------------------------------- 頁面切換

  // 第十四批（規格 V）：四個分頁（下棋 play、練習 practice、紀錄 stats、我 me）＋第二層（練習題／開局 learn 在練習下、關於 about 在我下）
  // ＋對局畫面 game（不顯示分頁列）。切換只換顯示：每個分頁記得自己停在哪一頁、捲到哪裡；練習題的盤面和計時不重來。
  var PAGES = ['play', 'practice', 'learn', 'stats', 'me', 'about', 'game'];
  var TAB_OF = { play: 'play', practice: 'practice', learn: 'practice', stats: 'record', me: 'me', about: 'me' };
  var tabView = { play: 'play', practice: 'practice', record: 'stats', me: 'me' };
  var scrollOf = {}, curPage = 'play';
  function showPage(name) {
    if (PAGES.indexOf(name) < 0) name = 'play';
    if (curPage !== 'game') scrollOf[curPage] = window.scrollY;
    PAGES.forEach(function (p) { $(p).hidden = p !== name; });
    curPage = name;
    var tab = TAB_OF[name] || null;
    $('tabbar').hidden = !tab;
    document.body.classList.toggle('has-tabbar', !!tab);
    if (tab) {
      tabView[tab] = name;
      Array.prototype.forEach.call(document.querySelectorAll('#tabbar [data-tab]'), function (b) {
        var on = b.getAttribute('data-tab') === tab;
        b.classList.toggle('on', on);
        if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      });
    }
    if (name !== 'game' && S.review) { RV.close(); S.review = null; setReviewUI(false); }
    if (name !== 'learn') pzLeave(); // 第十二批 d：離開練習題就不再算對手的贏法（回來時重新出這一題）；計時暫停
    if (name === 'play') syncMenuInputs(); // 剛下完的局可能改了積分
    if (name === 'stats') renderStats();
    if (name === 'learn') renderLearn();
    window.scrollTo(0, name === 'game' ? 0 : scrollOf[name] || 0);
  }
  document.querySelectorAll('#tabbar [data-tab]').forEach(function (b) {
    b.addEventListener('click', function () { showPage(tabView[b.getAttribute('data-tab')]); });
  });

  // ---------------------------------------------------------- 選單

  function radioValue(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }
  function setRadio(name, v) {
    var el = document.querySelector('input[name="' + name + '"][value="' + v + '"]');
    if (el) el.checked = true;
  }

  var recNote = null; // 按「推薦對手」後的那句話；手動改檔次就清掉

  function syncMenuInputs() {
    setRadio('mode', settings.mode);
    setRadio('rule', settings.rule);
    setRadio('side', String(settings.side));
    var pr = pref(), g = pr.group, subs = GROUP_TIERS[g];
    setRadio('level', g);
    $('subSeg').hidden = subs.length < 2;
    Array.prototype.forEach.call(document.querySelectorAll('#subSeg label'), function (lab, i) { lab.hidden = i >= subs.length; });
    if (subs.length > 1) setRadio('sub', String(subs.indexOf(pr.sub[g]) + 1));
    $('optHints').checked = settings.hints;
    setRadio('forbid', myForbid());
    $('aiOpts').hidden = settings.mode !== 'pve';
    $('sideCard').hidden = settings.mode !== 'pve';
    $('pvpOpts').hidden = settings.mode !== 'pvp';
    $('forbidOpts').hidden = settings.rule !== 'renju';
    $('ruleText').textContent = t(settings.rule === 'renju' ? 'rule.textRenju' : 'rule.textFree');
    renderLevelNote();
    renderProfileChips();
    renderPvpPicks();
    renderLook();
    renderStartBtn();
  }

  // 這一組卡片設定的代號（比對「和上次一樣」用）：跟電腦下看帳號、階與執子，兩人一起下看兩邊的帳號；連珠再加二選一
  // 第十六批（judge 第八輪）：跟電腦下也要含帳號——新帳號（或換到另一個帳號）沒下過，應該看到「開始下棋」
  function setupKey() {
    var k = [settings.mode, settings.rule, settings.rule === 'renju' ? myForbid() : ''];
    if (settings.mode === 'pvp') { var pp = pvpPids(); k.push(pp.b, pp.w); } else k.push(me().id, menuTier(), settings.side);
    return k.join('|');
  }
  // 第十六批（judge 第八輪）：任何會改到 setupKey() 的事件都呼叫這一個（存設定、選單與大按鈕重畫）。
  // 事件地圖（docs/ui-notes.md 第十六批）：對手、規則、等級、段數、執子、連珠二選一、幫我挑對手、兩人一起下的黑白帳號、
  // 換／新增／刪除／改帳號、匯入紀錄；開始下棋（寫 settings.last）之後回到下棋分頁由 showPage('play') 重畫。
  // 以後新增會改這幾項的控制項，也要走這裡。
  function setupChanged() {
    saveSettings();
    syncMenuInputs();
  }
  // 下棋分頁的大按鈕（第十四批，規格 V）：和上次一樣＝「再下一盤」＋下方小字寫上次的設定；沒有上次或改過＝「開始下棋」
  function renderStartBtn() {
    var again = !!settings.last && settings.last === setupKey();
    $('startBtn').textContent = t(again ? 'menu.again' : 'menu.start');
    var sub = $('startSub');
    sub.hidden = !again;
    if (!again) { sub.textContent = ''; return; }
    var rule = ruleLabel(settings.rule, settings.rule === 'renju' && myForbid() === 'lose');
    sub.textContent = settings.mode === 'pvp' ? t('menu.lastPvp', { rule: rule })
      : t('menu.lastPve', { tier: tierName(menuTier()), rule: rule, color: colorName(settings.side) });
  }

  function renderLevelNote() {
    var tier = menuTier(), r = aiRating(tier);
    $('recommendBtn').hidden = !RT || !RT.recommendTier || !G.TIERS;
    var note = recNote || (r == null ? '' : t('level.note', { tier: tierName(tier), rating: Math.round(r) }));
    // 第十四批（W 第 12 條）：選「入門」時旁邊一句「下贏了再換更強的」
    if (tier === 1) note = (note ? note + (I.getLang() === 'en' ? '. ' : '。') : '') + t('level.noviceTip');
    $('levelNote').textContent = note;
  }

  function onMenuChange() {
    settings.mode = radioValue('mode') === 'pvp' ? 'pvp' : 'pve';
    settings.rule = radioValue('rule') === 'renju' ? 'renju' : 'free';
    var g = radioValue('level'), pr = pref();
    if (GROUPS.indexOf(g) >= 0 && g !== pr.group) { pr.group = g; savePref(pr); recNote = null; }
    settings.side = radioValue('side') === '2' ? 2 : 1;
    setupChanged();
  }
  function onSubChange() {
    var pr = pref(), g = pr.group;
    if (GROUP_TIERS[g].length < 2) return;
    var k = Number(radioValue('sub')) || 1;
    pr.sub[g] = GROUP_TIERS[g][k - 1] || pr.sub[g];
    savePref(pr);
    recNote = null;
    setupChanged(); // 第十六批：原本只重畫等級旁的小字，大按鈕的「再下一盤」沒跟著換
  }

  document.querySelectorAll('input[name="mode"], input[name="rule"], input[name="level"], input[name="side"]')
    .forEach(function (el) { el.addEventListener('change', onMenuChange); });
  // 威脅提醒（「我」分頁）：不影響 setupKey；按過就記 hintsSet，以後照使用者選的
  $('optHints').addEventListener('change', function () {
    settings.hints = this.checked;
    settings.hintsSet = true;
    saveSettings();
  });
  // 連珠的二選一（第十三批 b）：存在目前的帳號
  document.querySelectorAll('input[name="forbid"]').forEach(function (el) {
    el.addEventListener('change', function () {
      GS.updateProfile(me().id, { forbid: this.value === 'lose' ? 'lose' : 'block' });
      setupChanged();
    });
  });

  document.querySelectorAll('input[name="sub"]').forEach(function (el) { el.addEventListener('change', onSubChange); });

  // 「我 → 外觀」（第八批 b；第十四批從「更多」搬到「我」分頁）：棋盤風格跟著帳號；介面顏色、動畫、音效跟著裝置
  function myTheme() { var p = me(); return p && GT.has(p.theme) ? p.theme : 'classic'; }
  function drawThemePreviews() {
    document.querySelectorAll('canvas[data-theme-preview]').forEach(function (cv) { GT.preview(cv, cv.getAttribute('data-theme-preview'), 48); });
  }
  // 換風格只重畫：對局、復盤、詰棋的狀態都不動（不重新開局）
  function applyTheme() {
    GT.set(myTheme());
    setRadio('theme', GT.currentId());
    setRadio('themeQuick', GT.currentId());
    renderFigs();
    bv.redraw();
    if (S.review) RV.render(); // 圖例的顏色跟著換
    if (pzView) pzView.redraw();
    if (!$('learn').hidden && learnTab === 'openings') renderOpenings();
    else learnDone.openings = false; // 開局的小圖跟著風格換色：下次進來再畫
  }
  function renderLook() {
    setRadio('theme', GT.currentId());
    setRadio('scheme', settings.scheme);
    // 系統要求減少動態時，動畫開關顯示關、不能開
    $('optAnim').checked = motionOK();
    $('optAnim').disabled = systemReduce();
    $('optSound').checked = settings.sound;
  }
  // 「更多 → 外觀」的五格和換風格面板的五格（第九批 b）是同一個設定：都存進目前帳號、只重畫
  document.querySelectorAll('input[name="theme"], input[name="themeQuick"]').forEach(function (el) {
    el.addEventListener('change', function () {
      GS.updateProfile(me().id, { theme: this.value });
      applyTheme();
    });
  });

  // 第九批 b：對局、回頭看、練習題畫面的「換風格」面板。Esc、點面板外、關閉鈕都能關；焦點鎖在面板內，關掉後回到打開它的按鈕
  var themeReturn = null;
  function openThemePanel(e) {
    themeReturn = (e && e.currentTarget && e.currentTarget.focus) ? e.currentTarget : document.activeElement;
    setRadio('themeQuick', GT.currentId());
    $('themePanel').hidden = false;
    placeThemePanel();
    var cur = document.querySelector('input[name="themeQuick"]:checked');
    if (cur) cur.parentNode.scrollIntoView({ block: 'nearest', inline: 'nearest' }); // 選中的那格捲進看得到的地方
    (cur || $('themePanelClose')).focus({ preventScroll: true });
  }
  // 第十二批 c：面板放在畫面底部或頂端，哪一邊不會蓋到棋盤就放哪一邊。兩邊都不夠時，先試著把頁面往下捲、讓棋盤底下空出面板的高度；
  // 捲不動就放在空間比較大的那一邊。
  function placeThemePanel() {
    var box = $('themePanel'), panel = box.querySelector('.panel');
    var bd = $('game').hidden ? $('pzBoard') : $('board');
    box.classList.remove('at-top');
    var cs = getComputedStyle(box), pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
    var h = panel.offsetHeight, vh = window.innerHeight, r = bd.getBoundingClientRect();
    if (vh - r.bottom >= h + pb) return;
    if (r.top >= h + pt) { box.classList.add('at-top'); return; }
    var need = h + pb - (vh - r.bottom), room = document.documentElement.scrollHeight - vh - window.scrollY;
    if (room >= need && r.top - need >= 0) { window.scrollBy(0, need); return; }
    if (r.top > vh - r.bottom) box.classList.add('at-top');
  }
  function closeThemePanel() {
    if ($('themePanel').hidden) return;
    $('themePanel').hidden = true;
    if (themeReturn && themeReturn.focus) themeReturn.focus();
    themeReturn = null;
  }
  document.querySelectorAll('[data-theme-open]').forEach(function (el) { el.addEventListener('click', openThemePanel); });
  $('themePanelClose').addEventListener('click', closeThemePanel);
  $('themePanel').addEventListener('click', function (e) { if (e.target === this) closeThemePanel(); });
  document.querySelectorAll('input[name="scheme"]').forEach(function (el) {
    el.addEventListener('change', function () { settings.scheme = this.value; saveSettings(); applyScheme(); });
  });
  $('optAnim').addEventListener('change', function () {
    if (systemReduce()) return;
    settings.anim = this.checked;
    saveSettings();
    applyScheme();
  });
  $('optSound').addEventListener('change', function () {
    settings.sound = this.checked;
    saveSettings();
    knock(); // 打開時馬上敲一聲：讓人知道聲音長什麼樣，也在這次點擊裡啟動音訊（iOS 要使用者動作才能出聲）
  });
  onMq(mqReduce, function () { applyScheme(); renderLook(); });

  // P：推薦對手（積分最接近、略高的 AI 階；挑法在 rating.js）
  $('recommendBtn').addEventListener('click', function () {
    var p = me(), tr = recommendTier(p.rating);
    if (!tr) { recNote = t('rec.none'); renderLevelNote(); return; }
    setTier(tr);
    recNote = t('rec.done', { tier: tierName(tr), rating: Math.round(aiRating(tr)), mine: Math.round(p.rating) });
    renderLevelNote();
  });

  // 雙打：兩邊各選帳號
  function renderPvpPicks() {
    var pp = pvpPids(), list = GS.profileList();
    [['pvpB', pp.b], ['pvpW', pp.w]].forEach(function (a) {
      var sel = $(a[0]);
      sel.textContent = '';
      list.forEach(function (p) {
        var o = mk('option', '', t('pvp.option', { emoji: p.emoji || '', name: p.name, badge: badgeName(badgeOf(p)), rating: Math.round(p.rating) }));
        o.value = p.id;
        sel.appendChild(o);
      });
      sel.value = a[1];
    });
    $('pvpNote').hidden = pp.b !== pp.w;
    $('pvpNote').textContent = t('pvp.same');
  }
  ['pvpB', 'pvpW'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      settings[id] = this.value;
      var pp = pvpPids();
      settings.pvpB = pp.b; settings.pvpW = pp.w;
      setupChanged(); // 第十六批：原本只重畫兩個下拉選單，大按鈕的「再下一盤」沒跟著換
    });
  });

  // ---------------------------------------------------------- 帳號面板（P）：切換、新增、改名、選圖示、刪除

  function renderProfileChips() {
    var p = me(), bid = badgeOf(p);
    Array.prototype.forEach.call(document.querySelectorAll('.profile-chip'), function (b) {
      b.textContent = '';
      b.appendChild(mk('span', 'pc-name', t('profile.chip', { emoji: p.emoji || '', name: p.name })));
      if (bid) b.appendChild(mk('span', 'badge b-' + bid, badgeName(bid)));
      b.appendChild(mk('span', 'pc-rating', String(Math.round(p.rating))));
      b.setAttribute('aria-label', t('profile.chipLabel', { name: p.name, badge: badgeName(bid), rating: Math.round(p.rating) }));
    });
  }

  var profilesReturn = null, editingId = null, pickedEmoji = EMOJIS[0];

  function openProfiles(e) {
    profilesReturn = (e && e.currentTarget) || document.activeElement;
    closeProfileForm(true);
    renderProfiles();
    $('profiles').hidden = false;
    $('profilesClose').focus();
  }
  function closeProfiles() {
    if ($('profiles').hidden) return;
    $('profiles').hidden = true;
    afterProfileChange();
    if (profilesReturn && profilesReturn.focus) profilesReturn.focus();
    profilesReturn = null;
  }
  // 換了帳號或改了名字：選單、戰績頁跟著更新
  function afterProfileChange() {
    applyTheme(); // 換帳號＝換成那個帳號的棋盤風格
    setupChanged();
    if (!$('stats').hidden) renderStats();
  }

  function renderProfiles() {
    var ul = $('profileList'), list = GS.profileList(), cur = me().id;
    ul.textContent = '';
    list.forEach(function (p) {
      var li = mk('li', 'profile-row' + (p.id === cur ? ' current' : ''));
      var info = mk('div', 'pr-info');
      info.appendChild(mk('div', 'pr-name', (p.emoji ? p.emoji + ' ' : '') + p.name));
      var bid = badgeOf(p);
      info.appendChild(mk('div', 'pr-sub', t('profile.rowInfo', { badge: badgeName(bid), rating: Math.round(p.rating), games: p.games }).trim()));
      li.appendChild(info);
      var acts = mk('div', 'pr-acts');
      if (p.id === cur) acts.appendChild(mk('span', 'pr-cur', t('profile.current')));
      else {
        var use = mk('button', '', t('profile.use'));
        use.type = 'button';
        use.addEventListener('click', function () {
          GS.setCurrent(p.id);
          recNote = null;
          renderProfiles();
          afterProfileChange();
          $('profilesClose').focus();
        });
        acts.appendChild(use);
      }
      var ed = mk('button', 'secondary', t('profile.edit'));
      ed.type = 'button';
      ed.addEventListener('click', function () { openProfileForm(p.id); });
      acts.appendChild(ed);
      var del = mk('button', 'secondary danger', t('profile.delete'));
      del.type = 'button';
      del.disabled = list.length <= 1;
      del.addEventListener('click', function () {
        showDialog(t('profile.deleteAsk', { name: p.name }), [
          { label: t('profile.deleteYes'), primary: true, danger: true, onClick: function () {
            GS.deleteProfile(p.id);
            renderProfiles();
            afterProfileChange();
            $('profilesClose').focus();
          } },
          { label: t('dialog.cancel') }
        ]);
      });
      acts.appendChild(del);
      li.appendChild(acts);
      ul.appendChild(li);
    });
    $('profileAdd').disabled = list.length >= GS.MAX_PROFILES;
    $('profileLimit').textContent = t('profile.limit', { max: GS.MAX_PROFILES });
  }

  function renderEmojiPick() {
    var box = $('emojiPick');
    box.textContent = '';
    EMOJIS.forEach(function (em) {
      var b = mk('button', 'emoji' + (em === pickedEmoji ? ' on' : ''), em);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', em === pickedEmoji ? 'true' : 'false');
      b.addEventListener('click', function () { pickedEmoji = em; renderEmojiPick(); box.querySelector('.on').focus(); });
      box.appendChild(b);
    });
  }

  // id：改這個帳號；null：新增
  function openProfileForm(id) {
    var list = GS.profileList();
    editingId = id;
    var p = id ? GS.profile(id) : null;
    if (p) {
      $('profileFormTitle').textContent = t('profile.formEdit', { name: p.name });
      $('profileName').value = p.name;
      pickedEmoji = p.emoji || EMOJIS[0];
    } else {
      $('profileFormTitle').textContent = t('profile.formAdd');
      $('profileName').value = t('profile.newName', { n: list.length + 1 });
      var used = list.map(function (q) { return q.emoji; });
      pickedEmoji = EMOJIS.filter(function (em) { return used.indexOf(em) < 0; })[0] || EMOJIS[0];
    }
    renderEmojiPick();
    $('profileForm').hidden = false;
    $('profileList').hidden = $('profileAdd').hidden = $('profileLimit').hidden = true;
    $('profileName').focus();
    $('profileName').select();
  }
  function closeProfileForm(quiet) {
    $('profileForm').hidden = true;
    $('profileList').hidden = $('profileAdd').hidden = $('profileLimit').hidden = false;
    editingId = null;
    if (!quiet) { renderProfiles(); $('profilesClose').focus(); }
  }
  $('profileForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('profileName').value.replace(/\s+/g, ' ').trim().slice(0, 12);
    if (editingId) {
      if (!name) name = GS.profile(editingId).name;
      GS.updateProfile(editingId, { name: name, emoji: pickedEmoji });
    } else {
      var p = GS.addProfile(name || t('profile.newName', { n: GS.profileList().length + 1 }), pickedEmoji,
        RT && RT.badge ? badgeId(RT.badge(GS.START)) : null);
      if (p) {
        var np = newProfilePref();
        if (np) GS.updateProfile(p.id, { pref: np }); // 新帳號的預設對手＝推薦對手
        GS.setCurrent(p.id); // 新增後直接切到新帳號
      }
    }
    closeProfileForm();
    afterProfileChange();
  });
  $('profileCancel').addEventListener('click', function () { closeProfileForm(); });
  $('profileAdd').addEventListener('click', function () { openProfileForm(null); });
  $('profilesClose').addEventListener('click', closeProfiles);
  $('profiles').addEventListener('click', function (e) { if (e.target === this) closeProfiles(); });
  document.querySelectorAll('[data-profiles]').forEach(function (el) { el.addEventListener('click', openProfiles); });

  // ---------------------------------------------------------- 戰績頁（stats.js）

  function renderStats() {
    var p = me();
    renderProfileChips();
    GS.render($('statsBody'), {
      t: t,
      tierName: tierName,
      colorName: colorName,
      onReview: function (rec) { enterReview(gameInfoFromRecord(rec), 'stats'); },
      pid: p.id,
      profile: p,
      badgeId: badgeOf,
      badgeName: badgeName
    });
  }

  $('exportBtn').addEventListener('click', function () {
    var text = GS.exportText();
    var d = new Date();
    var name = 'gomoku-games-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '.json';
    var blob = new Blob([text], { type: 'application/json' });
    var a = mk('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  $('importBtn').addEventListener('click', function () { $('importFile').value = ''; $('importFile').click(); });
  $('importFile').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var r = GS.importText(String(rd.result), me().id);
      setupChanged(); // 第十六批：匯入可能多出帳號（兩人一起下的白方預設會換人）
      showDialog(r.error ? t('stats.importBad') : t('stats.importDone', { added: r.added, dup: r.dup, bad: r.bad, profiles: r.profiles }),
        [{ label: t('dialog.ok'), primary: true }]);
      renderStats();
    };
    rd.readAsText(f);
  });
  // 清除只清目前帳號的紀錄（積分不動）
  $('clearBtn').addEventListener('click', function () {
    var p = me(), n = GS.loadFor(p.id).length;
    if (!n) return;
    showDialog(t('stats.clearAsk', { n: n, name: p.name }), [
      { label: t('stats.clearYes'), primary: true, danger: true, onClick: function () { GS.clearFor(p.id); renderStats(); } },
      { label: t('dialog.cancel') }
    ]);
  });

  // ---------------------------------------------------------- 學習頁（M、O）：26 種開局、詰棋

  // 練習分頁的第二層是哪一個（'puzzles'／'openings'，由練習分頁的卡片決定）；learnDone：這一個已經畫好、回來時不重畫（分頁切換狀態保留）
  var learnTab = 'puzzles';
  var learnDone = { puzzles: false, openings: false };

  function miniSVG(moves) {
    // 5×5（天元周圍 ±2）；三手都在這範圍內。顏色跟著棋盤風格（第八批 b）
    var P = GT.current().svg;
    var s = svgBoard(5, 100, 6);
    moves.forEach(function (m, k) {
      var x = 10 + (m.c - 5) * 20, y = 10 + (m.r - 5) * 20, black = k % 2 === 0;
      s += svgStone(x, y, black);
      s += '<text x="' + x + '" y="' + (y + 4) + '" text-anchor="middle" font-size="11" font-weight="700" fill="' + (black ? P.numB : P.numW) + '">' + (k + 1) + '</text>';
    });
    return '<svg viewBox="0 0 100 100" role="img" aria-hidden="true">' + s + '</svg>';
  }

  function normMoves(list) { return pts(list); }

  // 評價：中文顯示中文版用字（英文版不同時括號註明）；英文優先用英文版的說法
  function evalText(o) {
    var base = o.eval, note = o.evalNote || null;
    if (I.getLang() === 'en' && note) {
      var alt = String(note).split(/[:\uFF1A]/).pop().trim();
      if (I.has('eval.' + alt)) base = alt;
      note = null;
    }
    var s = I.has('eval.' + base) ? t('eval.' + base) : String(base == null ? '' : base);
    return s;
  }

  function renderOpenings() {
    var box = $('learnOpenings');
    box.textContent = '';
    var data = openingsData();
    if (!data || !data.length) { box.appendChild(mk('p', 'muted', t('learn.noOpenings'))); return; }
    var sideSeg = $('learnSideSeg');
    sideSeg.hidden = false;
    [['direct', 'learn.direct'], ['indirect', 'learn.indirect']].forEach(function (grp) {
      var items = data.filter(function (o) { return o.type === grp[0]; });
      if (!items.length) return;
      box.appendChild(mk('h3', 'learn-h', t(grp[1])));
      var ul = mk('ul', 'op-list');
      items.forEach(function (o) {
        var li = mk('li', 'op-item');
        var fig = mk('div', 'op-fig');
        fig.innerHTML = miniSVG(normMoves(o.moves));
        li.appendChild(fig);
        var body = mk('div', 'op-body');
        body.appendChild(mk('div', 'op-name', t('learn.opName', { name: openingName(o), code: o.code })));
        body.appendChild(mk('div', 'op-eval', t('learn.evalLine', { eval: evalText(o) })));
        var btn = mk('button', 'link', t('learn.useOpening'));
        btn.type = 'button';
        btn.addEventListener('click', function () {
          startGame(normMoves(o.moves), settings.learnSide);
        });
        body.appendChild(btn);
        li.appendChild(body);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    });
  }

  // 詰棋（規格 O）：攻擊題「N 手內必勝」、防守題「對方 N 手內必勝，找守法」，N＝2～5。
  // 題目欄位：id、type、n、rule、board、player、answers、line、stones（舊格式的 answer／attackerMoves 也收）。
  // 第十四批（W 第 4 條）：預設級數「入門」（n 1）。stale：離開時正在算對手的贏法（算被取消了），回來要重新出這一題
  var PZ = { list: null, loading: false, failed: false, kind: 'attack', n: 1, idx: 0, state: 'ask', anim: null, board: null,
    t0: 0, acc: 0, timer: null, elapsed: 0, calc: null, stale: false };
  var pzView = BoardView($('pzBoard'));

  // type 可能是 'attack'／'defend'（或 defense）或中文；中文比對字典，程式裡不寫死中文
  function pzKind(p) {
    var ty = String(p.type || ''), low = ty.toLowerCase(), id = String(p.id || '');
    if (low.indexOf('def') >= 0 || ty.indexOf(I.DICT['zh-TW']['puzzle.typeDefend']) >= 0 || /^def/i.test(id)) return 'defend';
    return 'attack';
  }
  function pzN(p) { return Number(p.n || p.attackerMoves || 0); }
  // 防守題小字的兩個數字（第十三批 b）：題庫 verifiedStages 裡 lambda 0（一路逼你擋）與 lambda 1（先下一步準備再逼）的 T。
  // lambda 0 取不到用後備 10（現行題庫的值）；第十四批（W 第 11 條）：lambda 1 取不到就是 null，小字拿掉那半句
  var PZ_STAGE_FALLBACK = { a: 10 };
  function pzStages(p) {
    var o = { a: PZ_STAGE_FALLBACK.a, b: null };
    (p && Array.isArray(p.verifiedStages) ? p.verifiedStages : []).forEach(function (st) {
      if (!st || !(st.T > 0)) return;
      if (st.lambda === 0) o.a = st.T;
      else if (st.lambda === 1) o.b = st.T;
    });
    return o;
  }
  // 第十四批（W 第 4 條）：防守題小字＝主句一句＋摺疊的「細節」（兩種檢查方法各查到幾次）
  function renderDefendNote(el, p) {
    var st = pzStages(p);
    el.textContent = '';
    el.appendChild(document.createTextNode(t('learn.pzDefendNote')));
    var det = mk('details', 'pz-more'), sum = mk('summary', '', t('learn.pzDefendMore'));
    det.appendChild(sum);
    var body = t(st.b != null ? 'learn.pzDefendLead2' : 'learn.pzDefendLead1') + (I.getLang() === 'en' ? ' ' : '') + t('learn.pzDefendNoteA', { a: st.a });
    if (st.b != null) body += (I.getLang() === 'en' ? ' ' : '') + t('learn.pzDefendNoteB', { b: st.b });
    det.appendChild(mk('p', '', body));
    el.appendChild(det);
  }
  // 第 1 級（入門）的題目用規則驗（verifier 'rule'，第十三批引擎題庫）：防守題小字講的兩種檢查不適用，答對也不說「試了很多種攻法」
  function pzByRule(p) { return !!p && p.verifier === 'rule'; }
  // 防守題「這一手之後還要接著下哪裡才守得住」（第七批題庫）：needsFollowUp 為真時，followUp 是
  // [{ answer: 正解, exchange: [攻方擋四…], move: 守方接著要下的那一手 }]，按玩家點的正解 m 找那一筆；
  // 沒有對應這個正解的（例如同一題的另一個正解不用接手）就是 null。也收單一 {r,c}（對所有正解都適用）。
  var PZ_FOLLOW_COLOR = 'follow'; // 風格的標記名（經典＝#1f6fd1，和復盤「妙手」同一個藍）
  function pzFollowUp(p, m) {
    if (!p || !p.needsFollowUp || !p.followUp) return null;
    var q = null;
    if (Array.isArray(p.followUp)) {
      p.followUp.forEach(function (f) {
        var a = f && pts([f.answer])[0];
        if (!q && a && a.r === m.r && a.c === m.c) q = pts([f.move])[0] || null;
      });
    } else q = pts([p.followUp])[0] || null;
    return q && q.r >= 0 && q.r < N && q.c >= 0 && q.c < N ? q : null;
  }
  // 同一級內照 difficultyHint 由小到大（第十三批 b）；沒有這欄的排在有的後面，彼此照題庫原順序
  function pzList() {
    var out = [];
    (PZ.list || []).forEach(function (p, i) { if (pzKind(p) === PZ.kind && pzN(p) === PZ.n) out.push({ p: p, i: i }); });
    function hint(x) { return typeof x.p.difficultyHint === 'number' && isFinite(x.p.difficultyHint) ? x.p.difficultyHint : Infinity; }
    out.sort(function (x, y) { var a = hint(x), b = hint(y); return a < b ? -1 : a > b ? 1 : x.i - y.i; });
    return out.map(function (x) { return x.p; });
  }
  function pzRule(p) { return p.rule === 'renju' ? 'renju' : 'free'; }
  function pzBoard(p) {
    if (Array.isArray(p.board) && p.board.length === N) return cloneBoard(p.board);
    var b = G.createBoard();
    if (Array.isArray(p.stones)) {
      p.stones.forEach(function (s) {
        var q = pts([s])[0];
        var who = s.p || s.player || (Array.isArray(s) ? s[2] : 0);
        if (q && who) b[q.r][q.c] = who;
      });
    }
    return b;
  }
  function pzAnswers(p) {
    var out = [], seen = {};
    pts([p.answer]).concat(pts(p.answers || [])).forEach(function (a) {
      var k = a.r * N + a.c;
      if (!seen[k]) { seen[k] = 1; out.push(a); }
    });
    return out;
  }

  // 答題紀錄（按帳號）：{ id: { ok, tries, type, n } }；戰績頁的「詰棋」表讀這裡
  function pzRecord(p, ok) {
    var pid = me().id, all = GS.pzLoad(pid);
    var id = String(p.id || (pzKind(p) + '-' + pzN(p) + '-' + PZ.idx));
    var r = all[id] || { ok: 0, tries: 0 };
    r.tries++;
    if (ok) r.ok++;
    r.type = pzKind(p);
    r.n = pzN(p);
    all[id] = r;
    GS.pzSave(pid, all);
  }

  function loadPuzzles() {
    if (PZ.list || PZ.loading) return;
    PZ.loading = true;
    var done = function (list) {
      PZ.loading = false;
      if (list && list.puzzles) list = list.puzzles;
      if (Array.isArray(list)) PZ.list = list; else PZ.failed = true;
      renderPuzzle();
    };
    if (!window.fetch) { done(null); return; }
    fetch('data/puzzles.json').then(function (r) { return r.ok ? r.json() : null; }).then(done, function () { done(null); });
  }

  function stopPzAnim() { if (PZ.anim) clearInterval(PZ.anim); PZ.anim = null; }
  // 第十六批（judge 第八輪）：計時改成時間戳累加。acc＝之前幾段（切分頁前）累計的毫秒，t0＝這一段開始的時間（停著時是 0）。
  // 原本回來時用「已顯示的整秒數」倒推 t0，每切一次分頁就丟掉不到 1 秒的零頭
  function pzMs() { return PZ.acc + (PZ.t0 ? Date.now() - PZ.t0 : 0); }
  function stopPzTimer() {
    if (PZ.timer) clearInterval(PZ.timer);
    PZ.timer = null;
    if (PZ.t0) { PZ.acc += Date.now() - PZ.t0; PZ.t0 = 0; PZ.elapsed = Math.floor(PZ.acc / 1000); }
  }
  function showPzTime() { $('pzTimer').textContent = t('learn.pzTimer', { s: PZ.elapsed }); }
  function runPzTimer() {
    PZ.t0 = Date.now();
    showPzTime();
    PZ.timer = setInterval(function () {
      if ($('learn').hidden) { stopPzTimer(); return; }
      PZ.elapsed = Math.floor(pzMs() / 1000);
      showPzTime();
    }, 1000);
  }
  function startPzTimer() {
    stopPzTimer();
    PZ.acc = 0;
    PZ.elapsed = 0;
    runPzTimer();
  }
  // 第十四批：離開練習題（換分頁、回練習）時：正在算就取消、回來重新出這一題；計時暫停，回來接著算
  function pzLeave() {
    stopPzTimer();
    if (PZ.calc) { pzCancelCalc(); PZ.stale = true; }
  }
  function pzResume() {
    if (PZ.state !== 'ask' || PZ.timer || !pzList()[PZ.idx]) return;
    runPzTimer();
  }

  function renderPuzzle() {
    var info = $('pzInfo'), msg = $('pzMsg');
    // 練習題沒顯示時（例如題庫載入完的時候已經換到別的分頁）先不畫：棋盤大小要在看得到時才量得準，回來時再出題
    if ($('learn').hidden || learnTab !== 'puzzles') { learnDone.puzzles = false; return; }
    stopPzAnim();
    stopPzTimer();
    pzCancelCalc();
    PZ.stale = false;
    setRadio('pztype', PZ.kind);
    setRadio('pzn', String(PZ.n));
    // 防守題的「守得住」只是 AI 查到某個深度為止的結論，題目頁要註明
    var dn = $('pzDefendNote'), sn = $('pzStarterNote');
    dn.hidden = PZ.kind !== 'defend' || PZ.n === 1;
    sn.hidden = true;
    renderDefendNote(dn, null);
    if (!PZ.list) {
      info.textContent = PZ.failed ? t('learn.pzLoadFail') : t('learn.pzLoading');
      msg.textContent = '';
      $('pzArea').hidden = true;
      return;
    }
    var list = pzList();
    msg.removeAttribute('data-fb');
    $('pzArea').hidden = !list.length;
    if (!list.length) { info.textContent = t('learn.pzNone'); msg.textContent = ''; return; }
    if (PZ.idx >= list.length) PZ.idx = 0;
    if (PZ.idx < 0) PZ.idx = list.length - 1;
    var p = list[PZ.idx];
    renderDefendNote(dn, p);
    // 防守題小字只給 N≥2（嚴格驗證器驗的）；入門題（N＝1，規則驗）改顯示一句入門小字（第十三批 c）
    dn.hidden = PZ.kind !== 'defend' || pzN(p) === 1 || pzByRule(p);
    sn.hidden = pzN(p) !== 1;
    sn.textContent = pzN(p) === 1 ? t(PZ.kind === 'defend' ? 'learn.pzStarterNoteDefend' : 'learn.pzStarterNoteAttack') : '';
    PZ.board = pzBoard(p);
    PZ.state = 'ask';
    var player = p.player === 2 ? 2 : 1;
    // 練習題不是對局設定，規則只寫名稱（不帶「不讓下／下了就輸」）
    info.textContent = t('learn.pzInfo', { i: PZ.idx + 1, n: list.length, color: colorName(player), rule: t(pzRule(p) === 'renju' ? 'rule.renju' : 'rule.free') });
    msg.textContent = '';
    var ask = PZ.kind === 'defend' ? 'learn.pzAskDefend' : 'learn.pzAskAttack';
    msg.appendChild(I.node(pzN(p) === 1 ? ask + '1' : ask, { n: pzN(p), color: colorName(player), opp: colorName(3 - player) }));
    $('pzShow').hidden = true;
    pzFit();
    pzDraw();
    startPzTimer();
  }

  // 第十二批 c：棋盤不超過首屏——寬度之外，高度也不超過「畫面高度減掉棋盤上緣（頁面頂端算起）」，最小 260
  // 第十六批（judge 第八輪）：抽出來；答題後訊息變長（答錯的句子、算對手贏法的「取消」、小字）會把棋盤往下推，
  // 所以訊息的高度一變就重算（ResizeObserver 看 #pzMsg，不用每條答題路徑各補一次）
  function pzFit(shrinkOnly) {
    if ($('learn').hidden || $('pzArea').hidden) return;
    var w = Math.min($('pzArea').clientWidth || 340, 420);
    var top = $('pzBoard').parentNode.getBoundingClientRect().top + window.scrollY;
    var tb = $('tabbar').hidden ? 0 : $('tabbar').offsetHeight; // 第十四批：底部分頁列蓋住的高度不算
    w = Math.floor(Math.min(w, Math.max(260, window.innerHeight - top - 8 - tb)));
    // 出題時照算出來的大小；答題後（shrinkOnly）只縮不放大，訊息變短時棋盤不跟著跳大
    if (w !== pzView.geo.css && !(shrinkOnly && w > pzView.geo.css)) pzView.setSize(w); // setSize 會用上次的畫面重畫（播放中也一樣）
  }
  if (window.ResizeObserver) new ResizeObserver(function () { pzFit(true); }).observe($('pzMsg'));

  function pzDraw(extra) {
    var p = pzList()[PZ.idx];
    if (!p) return;
    // 第十四批（W 第 4 條「棋盤畫座標或句子不寫座標，選一」）：選畫座標，答案句裡的「H8」在棋盤邊上找得到
    var v = { board: PZ.board, coords: true, forbidden: pzRule(p) === 'renju' && (p.player === 2 ? 2 : 1) === 1 && PZ.state === 'ask' };
    if (extra) Object.keys(extra).forEach(function (k) { v[k] = extra[k]; });
    pzView.draw(v);
  }

  // 從 board 起，first 先下，逐手擺出 line；keep 是一直畫著的標記（例如正解綠圈）
  function pzAnimate(board, line, first, rule, keep) {
    stopPzAnim();
    var b = board, k = 0, last = null;
    PZ.board = b;
    pzDraw(keep);
    PZ.anim = setInterval(function () {
      var extra = {};
      if (keep) Object.keys(keep).forEach(function (x) { extra[x] = keep[x]; });
      if (k >= line.length) {
        stopPzAnim();
        var win = last ? G.checkWin(b, last.r, last.c, rule) : null;
        extra.last = last;
        extra.winCells = win ? win.cells : null;
        pzDraw(extra);
        return;
      }
      var m = line[k];
      if (!b[m.r][m.c]) b[m.r][m.c] = k % 2 ? 3 - first : first;
      last = m;
      k++;
      extra.last = last;
      pzDraw(extra);
    }, 650);
  }

  // 第十二批 c：播放前一律先模擬一遍。從 board 起、first 先下、兩邊輪流：每一手都要落在盤內的空點（連珠黑棋不能下禁手），
  // 中途沒有人先連成五，最後一手是 first 下的、而且真的連成五。合格才播。
  function pzLineOK(board, line, first, rule) {
    if (!line || !line.length) return false;
    var b = cloneBoard(board), who = first;
    for (var i = 0; i < line.length; i++) {
      var m = line[i];
      if (!m || !(m.r >= 0 && m.r < N && m.c >= 0 && m.c < N) || b[m.r][m.c]) return false;
      if (rule === 'renju' && who === 1 && G.isForbidden(b, m.r, m.c)) return false;
      b[m.r][m.c] = who;
      var w = G.checkWin(b, m.r, m.c, rule);
      if (i === line.length - 1) return who === first && !!w && w.player === first;
      if (w) return false;
      who = 3 - who;
    }
    return false;
  }

  // 第十二批 d：播之前除了 pzLineOK，還要「沿路守方沒有可反擊的四」。每次輪到守方（攻方剛下完、還沒成五）時檢查：
  // 守方能直接成五 → 不合格；攻方有兩個以上的成五點 → 守方只剩成五能救（上一條）；攻方正好一個成五點 → 守方非擋不可，
  // 擋的那一點若讓守方成四（反擊）→ 不合格；攻方沒有成五點（剛做出活三之類）→ 守方任何一點能下出四 → 不合格。
  function pzMakesFour(b, r, c, p, rule) {
    for (var d = 0; d < 4; d++) {
      var dr = [0, 1, 1, 1][d], dc = [1, 0, 1, -1][d], own = 0, k, rr, cc;
      for (k = -4; k <= 4; k++) {
        rr = r + k * dr; cc = c + k * dc;
        if (k && rr >= 0 && rr < N && cc >= 0 && cc < N && b[rr][cc] === p) own++;
      }
      if (own < 3) continue; // 下在 (r,c) 之後這條線 ±4 格內要另有 3 顆自己的子（連這一顆共 4 顆）才可能成四
      for (k = -4; k <= 4; k++) {
        rr = r + k * dr; cc = c + k * dc;
        if (!k || rr < 0 || rr >= N || cc < 0 || cc >= N || b[rr][cc]) continue;
        b[rr][cc] = p;
        var w = G.checkWin(b, rr, cc, rule);
        b[rr][cc] = 0;
        if (w && w.player === p) return true;
      }
    }
    return false;
  }
  function pzCounter(b, d, rule) {
    if (fivePointsOf(b, d, rule).length) return true;
    var af = fivePointsOf(b, 3 - d, rule), cand = [];
    if (af.length >= 2) return false;
    if (af.length === 1) cand = af;
    else for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) if (!b[r][c]) cand.push({ r: r, c: c });
    for (var i = 0; i < cand.length; i++) {
      var x = cand[i];
      if (rule === 'renju' && d === 1 && G.isForbidden(b, x.r, x.c)) continue;
      b[x.r][x.c] = d;
      var four = pzMakesFour(b, x.r, x.c, d, rule);
      b[x.r][x.c] = 0;
      if (four) return true;
    }
    return false;
  }
  function pzLineSafe(board, line, first, rule) {
    if (!pzLineOK(board, line, first, rule)) return false;
    var b = cloneBoard(board);
    for (var i = 0; i < line.length - 1; i++) {
      b[line[i].r][line[i].c] = i % 2 ? 3 - first : first;
      if (i % 2 === 0 && pzCounter(b, 3 - first, rule)) return false;
    }
    return true;
  }

  // 防守題答錯（第十二批 d）：玩家那手擺上去，算對手的必勝手順，補到成五，模擬合格（pzLineSafe）才播。
  // ai-worker.js 沒有「算 VCT」的訊息型別（只有下一手、analyze、threats），工作單不准改它，所以先在主執行緒算：
  // 威脅數 1、2、…、PZ_CALC_THREATS 一層一層叫 findVCT，層與層之間讓出（畫面更新、「取消」按得到），合計 PZ_CALC_MS。
  // 算不出來（或算出的模擬不過）就退回題目存的 line：擺上玩家那一顆之後模擬合格才播，另補一句「這是題目原本的贏法」；
  // 也不合格就不播、只標答案。done(line, how)：how＝'computed'／'puzzle'／'none'。
  var PZ_CALC_MS = 3000, PZ_CALC_THREATS = 10, PZ_CALC_NODES = 2000000;
  function pzCalcOppLine(p, board, opp, job, done) {
    var rule = pzRule(p), t0 = Date.now(), depth = 1;
    function fallback() {
      var own = pts(p.line || []);
      if (own.length && pzLineSafe(board, own, opp, rule)) done(own, 'puzzle');
      else done(null, 'none');
    }
    function step() {
      if (job.cancelled) return;
      var left = PZ_CALC_MS - (Date.now() - t0), r = null;
      if (!G.findVCT || left <= 0) { fallback(); return; }
      try { r = G.findVCT(board, opp, { rule: rule, maxThreats: depth, maxNodes: PZ_CALC_NODES, timeLimit: left }); } catch (e) { r = null; }
      if (job.cancelled) return;
      if (r && r.line && r.line.length) {
        var line = completeToFive(board, pts(r.line), opp, rule);
        // findVCT 的手順常停在四三、雙三這種「已經擋不住、但還沒有成五點」的局面，completeToFive 補不到成五；
        // 這時從手順的最後一手起叫 forcedWinAfter（引擎公開的函式：攻方剛下完、守方先應，手順已補到成五）接上去
        if (!pzLineOK(board, line, opp, rule) && G.forcedWinAfter) {
          var raw = pts(r.line), be = cloneBoard(board), fw = null, clash = false;
          raw.forEach(function (x, i) { if (be[x.r][x.c]) clash = true; else be[x.r][x.c] = i % 2 ? 3 - opp : opp; });
          if (raw.length % 2 && !clash) {
            try {
              fw = G.forcedWinAfter(be, opp, { rule: rule, maxThreats: PZ_CALC_THREATS, maxNodes: PZ_CALC_NODES,
                timeLimit: Math.max(100, PZ_CALC_MS - (Date.now() - t0)) });
            } catch (e) { fw = null; }
          }
          if (job.cancelled) return;
          if (fw && fw.status === 'win' && fw.line) line = completeToFive(board, raw.concat(pts(fw.line)), opp, rule);
        }
        if (pzLineSafe(board, line, opp, rule)) done(line, 'computed');
        else fallback();
        return;
      }
      if (depth >= PZ_CALC_THREATS || Date.now() - t0 >= PZ_CALC_MS) { fallback(); return; }
      depth++;
      setTimeout(step, 0);
    }
    setTimeout(step, 50); // 先讓「電腦在算…」畫出來
  }
  function pzCancelCalc() {
    if (!PZ) return;
    if (PZ.calc) PZ.calc.cancelled = true;
    PZ.calc = null;
  }

  // 連珠禁手擋點題（第十二批 c；題庫的 forbiddenAt: { r, c, kind }）：黑棋要擋的那一點是禁手。沒有這欄或不合法時 null
  function pzForbiddenAt(p) {
    var f = p && p.forbiddenAt, q = f ? pts([f])[0] : null;
    return q && q.r >= 0 && q.r < N && q.c >= 0 && q.c < N ? { r: q.r, c: q.c, kind: f.kind } : null;
  }
  // 訊息後面接一句（英文句子之間要空格）
  function pzAppend(msg, key, params) {
    msg.appendChild(document.createTextNode((I.getLang() === 'en' ? ' ' : '') + t(key, params)));
  }
  function pzAppendNode(msg, node) {
    msg.appendChild(document.createTextNode(' '));
    msg.appendChild(node);
  }
  // 答完後：有 forbiddenAt 就在訊息後面補一句、回傳要畫 × 的點（同一題只補一次）
  function pzForbiddenNote(p, msg) {
    var fb = pzForbiddenAt(p);
    if (!fb) return null;
    if (!msg.getAttribute('data-fb')) {
      pzAppend(msg, 'learn.pzForbiddenBlock', { kind: forbiddenName(fb.kind) });
      msg.setAttribute('data-fb', '1');
    }
    return [{ r: fb.r, c: fb.c }];
  }

  // 求解器的手順常停在活四／四三（已經擋不住）；照「守方擋一個成五點、攻方下另一個」補到真的成五，最多 6 手
  function fivePointsOf(b, p, rule) {
    var out = [];
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        if (b[r][c]) continue;
        b[r][c] = p;
        var w = G.checkWin(b, r, c, rule);
        b[r][c] = 0;
        if (w && w.player === p) out.push({ r: r, c: c });
      }
    }
    return out;
  }
  function completeToFive(board, line, att, rule) {
    var b = cloneBoard(board), out = line.slice(), who = att;
    for (var i = 0; i < line.length; i++) { if (!b[line[i].r][line[i].c]) b[line[i].r][line[i].c] = who; who = 3 - who; }
    // 第十二批 d：已經補到成五的手順（例如接上 forcedWinAfter 的）就不再加
    var lm = line[line.length - 1], lw = lm && b[lm.r][lm.c] === att ? G.checkWin(b, lm.r, lm.c, rule) : null;
    if (lw && lw.player === att) return out;
    for (var k = 0; k < 6; k++) {
      var f = fivePointsOf(b, att, rule);
      if (who === att) {
        if (!f.length) break;
        out.push(f[0]);
        break;
      }
      if (!f.length) break;
      var blk = f[0];
      if (rule === 'renju' && who === 1) {
        // 連珠黑棋守：挑一個不是禁手的成五點來擋
        blk = f.filter(function (x) { return !G.isForbidden(b, x.r, x.c); })[0] || f[0];
      }
      if (rule === 'renju' && who === 1 && G.isForbidden(b, blk.r, blk.c)) {
        // 第十二批 d：黑棋要擋的點全是禁手（擋不了）：黑棋下一手不相干的棋（從右下角往回找第一個不是禁手、不成五、
        // 也不在白棋成五點上的空點），白棋再成五。out.fb 記下那個禁手點與種類，畫面上打 × 並補一句（和題庫的 forbiddenAt 一樣）
        var fill = null;
        for (var r = N - 1; r >= 0 && !fill; r--) {
          for (var c = N - 1; c >= 0 && !fill; c--) {
            if (b[r][c] || G.isForbidden(b, r, c) || f.some(function (x) { return x.r === r && x.c === c; })) continue;
            b[r][c] = 1;
            var w5 = G.checkWin(b, r, c, rule);
            b[r][c] = 0;
            if (!w5) fill = { r: r, c: c };
          }
        }
        if (!fill) break;
        out.fb = { r: blk.r, c: blk.c, kind: G.isForbidden(b, blk.r, blk.c) };
        b[fill.r][fill.c] = 1;
        out.push(fill);
        out.push(blk);
        break;
      }
      b[blk.r][blk.c] = who;
      out.push(blk);
      who = att;
    }
    return out;
  }

  // 顏色用風格的標記名：正解＝'better'（綠），點錯＝'losing'（紅）
  function ringsOf(list) { return list.map(function (a) { return { r: a.r, c: a.c, color: 'better', dash: true }; }); }
  function coordsOf(list) { return list.map(function (a) { return coordName(a.r, a.c); }).join(t('list.sep')); }

  $('pzBoard').addEventListener('click', function (e) {
    var p = pzList()[PZ.idx];
    if (!p || PZ.state !== 'ask') return;
    var m = pzView.cellAt(e.clientX, e.clientY);
    if (!m || PZ.board[m.r][m.c]) return;
    var player = p.player === 2 ? 2 : 1, rule = pzRule(p);
    var ans = pzAnswers(p);
    var ok = ans.some(function (a) { return a.r === m.r && a.c === m.c; });
    stopPzTimer();
    pzRecord(p, ok);
    var msg = $('pzMsg');
    msg.removeAttribute('data-fb');
    if (PZ.kind === 'attack') {
      var line = pts(p.line || []);
      if (ok) {
        PZ.state = 'right';
        // 題目的手順從某個正解開始；玩家點的是另一個正解時，就只播題目那一條。模擬不過就不播（第十二批 c）
        if (pzLineOK(pzBoard(p), line, player, rule)) {
          // 第十四批（W 第 4、11 條）：入門（一步就連成五）答對用短句，不說「來看完整的下法」
          msg.textContent = t(pzN(p) === 1 ? 'learn.pzRightShort' : 'learn.pzRight', { s: PZ.elapsed });
          var cx = pzForbiddenNote(p, msg);
          pzAnimate(pzBoard(p), line, player, rule, cx ? { crosses: cx } : null);
        } else {
          msg.textContent = t('learn.pzRightShort', { s: PZ.elapsed });
          var cx2 = pzForbiddenNote(p, msg);
          PZ.board[m.r][m.c] = player;
          pzDraw({ last: m, crosses: cx2 });
        }
      } else {
        PZ.state = 'wrong';
        // 第十四批（W 第 4 條）：題庫的答案是全寬求解器算出的全部解，所以不在答案裡＝這一步沒辦法在 n 步之內贏
        msg.textContent = t('learn.pzWrongAttack', { n: pzN(p), coords: coordsOf(ans) });
        $('pzShow').hidden = !pzLineOK(pzBoard(p), line, player, rule);
        pzDraw({ frames: [{ r: m.r, c: m.c, color: 'losing' }], rings: ringsOf(ans) });
      }
      return;
    }
    // 防守題
    if (ok) {
      PZ.state = 'right';
      msg.textContent = pzByRule(p) ? t('learn.pzRightShort', { s: PZ.elapsed }) : t('learn.pzRightDefend', { s: PZ.elapsed, coords: coordsOf(ans) });
      PZ.board[m.r][m.c] = player;
      // 守住要靠之後的另一手（題庫 needsFollowUp＋followUp，第七批引擎契約）：句子寫出來、棋盤上用藍圈標出
      var fu = pzFollowUp(p, m);
      var rings = ringsOf(ans);
      if (fu) {
        pzAppend(msg, 'learn.pzFollowUp', { coord: coordName(fu.r, fu.c) });
        rings.push({ r: fu.r, c: fu.c, color: PZ_FOLLOW_COLOR });
      }
      pzDraw({ last: m, rings: rings, crosses: pzForbiddenNote(p, msg) });
    } else {
      PZ.state = 'calc';
      var b = pzBoard(p);
      b[m.r][m.c] = player;
      PZ.board = b;
      pzDraw({ last: m });
      // 第十二批 d：算的時候顯示「電腦在算對手會怎麼贏…」和「取消」
      var job = { cancelled: false };
      pzCancelCalc();
      PZ.calc = job;
      msg.textContent = t('learn.pzCalc');
      var stop = document.createElement('button');
      stop.type = 'button';
      stop.className = 'link pz-calc-stop';
      stop.textContent = t('dialog.cancel');
      stop.addEventListener('click', function () {
        if (PZ.calc !== job) return;
        pzCancelCalc();
        // 取消：不播、不說電腦算了什麼，只標答案
        PZ.state = 'wrong';
        msg.textContent = t('learn.pzWrong', { coords: coordsOf(ans) });
        pzDraw({ last: m, rings: ringsOf(ans) });
      });
      pzAppendNode(msg, stop);
      pzCalcOppLine(p, cloneBoard(b), 3 - player, job, function (oline, how) {
        if (PZ.calc !== job) return;
        PZ.calc = null;
        PZ.state = 'wrong';
        if (oline) {
          // 退回題目手順時多一句（放在答案那句前面，免得「這是題目原本的贏法」被讀成在講綠圈）
          msg.textContent = t(how === 'puzzle' ? 'learn.pzWrongDefendPuzzle' : 'learn.pzWrongDefend', { coords: coordsOf(ans) });
          var cross = pzForbiddenNote(p, msg);
          // 第十二批 d：補到成五時黑棋擋不了（禁手）：和題庫的 forbiddenAt 一樣打 ×、補一句
          if (!cross && oline.fb) {
            pzAppend(msg, 'learn.pzForbiddenBlock', { kind: forbiddenName(oline.fb.kind) });
            cross = [{ r: oline.fb.r, c: oline.fb.c }];
          }
          var keep = { frames: [{ r: m.r, c: m.c, color: 'losing' }], rings: ringsOf(ans), crosses: cross };
          pzAnimate(b, oline, 3 - player, rule, keep);
        } else {
          // 第十二批 c：算不出對手怎麼贏（或算出的下法模擬不過）就不播，只標出答案
          msg.textContent = t('learn.pzWrongNoLine', { coords: coordsOf(ans) });
          msg.appendChild(mk('small', 'pz-small', t('learn.pzWrongNoLineNote')));
          pzDraw({ last: m, rings: ringsOf(ans) });
        }
      });
    }
  });
  $('pzShow').addEventListener('click', function () {
    var p = pzList()[PZ.idx];
    if (!p) return;
    var ans = pzAnswers(p), player = p.player === 2 ? 2 : 1, line = pts(p.line || []);
    if (!pzLineOK(pzBoard(p), line, player, pzRule(p))) { $('pzShow').hidden = true; return; }
    pzAnimate(pzBoard(p), line, player, pzRule(p), { rings: ringsOf(ans), crosses: pzForbiddenNote(p, $('pzMsg')) });
  });
  $('pzPrev').addEventListener('click', function () { PZ.idx--; renderPuzzle(); });
  $('pzNext').addEventListener('click', function () { PZ.idx++; renderPuzzle(); });
  $('pzRetry').addEventListener('click', function () { renderPuzzle(); });
  document.querySelectorAll('input[name="pztype"]').forEach(function (el) {
    el.addEventListener('change', function () { PZ.kind = this.value === 'defend' ? 'defend' : 'attack'; PZ.idx = 0; renderPuzzle(); });
  });
  document.querySelectorAll('input[name="pzn"]').forEach(function (el) {
    el.addEventListener('change', function () { PZ.n = Number(this.value) || 2; PZ.idx = 0; renderPuzzle(); });
  });
  // 練習分頁的三張卡：練習題、26 種開局（進第二層），規則說明（開面板，data-rule-help）
  $('pracPuzzles').addEventListener('click', function () { learnTab = 'puzzles'; showPage('learn'); });
  $('pracOpenings').addEventListener('click', function () { learnTab = 'openings'; showPage('learn'); });
  document.querySelectorAll('input[name="learnSide"]').forEach(function (el) {
    el.addEventListener('change', function () { settings.learnSide = this.value === '1' ? 1 : 2; saveSettings(); });
  });

  function renderLearn() {
    $('learnTitle').textContent = t(learnTab === 'puzzles' ? 'learn.tabPuzzles' : 'learn.tabOpenings');
    setRadio('learnSide', String(settings.learnSide));
    $('learnOpeningsWrap').hidden = learnTab !== 'openings';
    $('learnPuzzles').hidden = learnTab !== 'puzzles';
    if (learnTab === 'openings') {
      if (!learnDone.openings) renderOpenings();
    } else {
      loadPuzzles();
      if (!learnDone.puzzles || PZ.stale || !PZ.list) renderPuzzle(); else pzResume();
    }
    learnDone[learnTab] = true;
  }

  // ---------------------------------------------------------- 語言

  function applyLang() {
    I.apply(document);
    document.documentElement.lang = I.getLang() === 'en' ? 'en' : 'zh-Hant';
    document.title = t('app.title');
    $('langBtn').textContent = t('lang.switch');
    $('langBtn').setAttribute('aria-label', t('lang.switchLabel'));
    $('aboutVersion').textContent = t('about.name', { version: window.GOMOKU_VERSION || '' });
    recNote = null;
    syncMenuInputs();
    if (!$('game').hidden) {
      if (S.review) { renderOppInfo(RV.info()); RV.render(); }
      else { renderOppInfo(); refresh(); renderResult(); }
    }
    if (!$('profiles').hidden) { renderProfiles(); if (!$('profileForm').hidden) renderEmojiPick(); }
    if (!$('stats').hidden) renderStats();
    learnDone = { puzzles: false, openings: false }; // 練習題與開局的字是畫的時候寫進去的：下次進來重畫
    if (!$('learn').hidden) renderLearn();
  }
  $('langBtn').addEventListener('click', function () {
    I.setLang(I.getLang() === 'en' ? 'zh-TW' : 'en');
    applyLang();
  });

  // ---------------------------------------------------------- 按鈕

  $('startBtn').addEventListener('click', function () { startGame(null); });
  $('undoBtn').addEventListener('click', undo);
  $('restartBtn').addEventListener('click', function () { confirmAbandon(newGame); });
  $('aboutBtn').addEventListener('click', function () { showPage('about'); });
  // 第二層的返回鈕：data-back＝回到哪一頁（練習、我）
  document.querySelectorAll('[data-back]').forEach(function (el) {
    el.addEventListener('click', function () { showPage(el.getAttribute('data-back')); });
  });
  $('hintToggle').addEventListener('click', function () {
    settings.hintsOpen = !settings.hintsOpen;
    saveSettings();
    renderHintToggle();
    resize();
  });

  // 第十四批：結算卡的按鈕。「再來一盤」＝同一組設定重新開一盤（開局教學帶進來的前幾手照舊擺好）
  $('rsAgain').addEventListener('click', newGame);
  $('rsReview').addEventListener('click', function () { enterReview(gameInfoFromState(), 'game'); });
  $('rsMenu').addEventListener('click', backToMenu);
  $('rsUndo').addEventListener('click', undo);
  $('rvBackBtn').addEventListener('click', function () { if (S.review) exitReview(); });

  // 第十四批（規格 V）：對局畫面第二排的「⋯」：回頭看這盤、規則說明、換風格、回到選單（底部面板；Esc、點面板外、關閉鈕都能關）
  var sheetReturn = null;
  function openMoreSheet() {
    sheetReturn = $('moreBtn');
    updateStatus();
    $('moreSheet').hidden = false;
    var first = $('moreSheet').querySelector('button:not(:disabled)');
    if (first) first.focus();
  }
  // back：關掉後把焦點還給「⋯」（接著要開別的面板時不還，讓那個面板記住「⋯」）
  function closeMoreSheet(back) {
    if ($('moreSheet').hidden) return;
    $('moreSheet').hidden = true;
    if (back && sheetReturn && sheetReturn.focus) sheetReturn.focus();
  }
  $('moreBtn').addEventListener('click', openMoreSheet);
  $('moreSheetClose').addEventListener('click', function () { closeMoreSheet(true); });
  $('moreSheet').addEventListener('click', function (e) { if (e.target === this) closeMoreSheet(true); });
  $('reviewBtn').addEventListener('click', function () { closeMoreSheet(false); enterReview(gameInfoFromState(), 'game'); });
  $('gameHelpBtn').addEventListener('click', function () { closeMoreSheet(false); openRuleHelp({ currentTarget: $('moreBtn') }); });
  $('gameThemeBtn').addEventListener('click', function () { closeMoreSheet(false); openThemePanel({ currentTarget: $('moreBtn') }); });
  $('menuBtn').addEventListener('click', function () { closeMoreSheet(true); confirmAbandon(backToMenu); });
  window.addEventListener('resize', function () { resize(); if (!$('themePanel').hidden) placeThemePanel(); });
  window.addEventListener('orientationchange', resize);

  // 測試用的小門：無頭瀏覽器驗收時讀狀態。只在網址帶 ?test=1 時掛上，一般開啟不會有。
  // 第十二批 c：index.html 的 GOMOKU_RELEASE 是 true（正式版）時，帶 ?test=1 也不掛。
  if (window.GOMOKU_RELEASE !== true && /[?&]test=1(?:&|$)/.test(location.search)) {
    window.__gomokuApp = { S: S, settings: settings, setTier: setTier, startGame: startGame, enterReview: enterReview, endGame: endGame,
      gameInfoFromRecord: gameInfoFromRecord, showPage: showPage, refreshHints: refreshHints, me: me, menuTier: menuTier,
      // 第八批 b：外觀
      applyTheme: applyTheme, motionOK: motionOK, anim: function () { return bv.animState(); }, soundCount: function () { return soundCount; },
      // 第十二批 c：練習題狀態、兩個棋盤畫的內容
      PZ: PZ, renderPuzzle: renderPuzzle, pzList: pzList, boardView: function () { return bv.view(); }, pzView: function () { return pzView.view(); },
      // 第十二批 d：答錯播放前的模擬
      pzLineOK: pzLineOK, pzLineSafe: pzLineSafe, pzCounter: pzCounter, completeToFive: completeToFive,
      // 第十四批：分頁、結算卡、提醒列
      curPage: function () { return curPage; }, tabView: tabView, renderResult: renderResult, renderHints: renderHints,
      setLearnTab: function (x) { learnTab = x; }, confirmAbandon: confirmAbandon,
      // 第十五批：棋盤的格位（畫座標時外側多一道邊，測試不能再用「寬度 ÷ 15」算點）
      geo: function (id) { var g = (id === 'pzBoard' ? pzView : bv).geo; return { css: g.css, cell: g.cell, margin: g.margin, pad: g.pad }; } };
  }

  drawThemePreviews();
  applyTheme();
  applyLang();
  showPage('play');
})();
