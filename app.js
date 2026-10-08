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
  // 天元那一批（規格 AC、AN）：最強那一級多一段「天元」（階 12）：選「最強」後段數列出現「最強」「天元」兩顆（用名字不用數字）
  // v0.5.13（規格 AF）：入門也分兩段「入門・1」（階 1）「入門・2」（階 13）。入門・2 用新的階號 13、不重編號：設定、紀錄、接著下的存檔、
  // 匯出檔裡的 1–12 意思一個都不變，不用遷移。所以階號不再代表強弱：比強弱一律用 tierRank（照 TIER_ORDER 的先後），不直接比大小。
  var GROUP_TIERS = { novice: [1, 13], easy: [2, 3, 4], medium: [5, 6, 7, 8], hard: [9, 10], expert: [11, 12] };
  var MAX_TIER = 13;       // 認得的最大階號（檢查存檔、紀錄用）；不是最強的那一階（最強的是 TOP_TIER）
  var TENGEN_TIER = 12;
  var TOP_TIER = TENGEN_TIER; // v0.5.13：最強的對手（連勝不再叫你「換強一點的」）
  var NOVICE2_TIER = 13;
  // 由弱到強的先後（同 ai.js 的 TIER_ORDER；test.js 驗兩份一樣）
  var TIER_ORDER = [1, 13, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  function tierRank(tier) { return TIER_ORDER.indexOf(tier); }
  // 不給提示的階（規格 Z9 第 4 條、AC「提示：階 12 同最強」）：最強（11）與天元（12）。寫死 11，不要用 MAX_TIER（以後再加階也不會跟著動）
  // v0.5.13：照先後比（階 13 入門・2 的號碼比 11 大，但它是第二弱的）
  var NO_HINT_TIER = 11;
  function noHintTier(tier) { return tierRank(tier) >= tierRank(NO_HINT_TIER); }
  // 各檔預設段（帳號的 pref 沒存這一檔時用）：舊九階預設（弱・2、中・3、強）用 migrateTier 換過去的階。
  // 第六批起，新帳號一建立就把 pref 設成「推薦對手」那一階（newProfilePref），所以這組只影響既有帳號沒選過的檔；
  // 注意中・4 的 AI 積分比新玩家 1200 分高很多，這組不是「適合新手」的預設。
  // 天元那一批：最強那一級預設「最強」（舊帳號存的 group: 'expert' 沒有 sub.expert，照舊是階 11）
  // v0.5.13（規格 AF）：入門那一級預設「入門・1」（舊帳號存的 group: 'novice' 沒有 sub.novice，照舊是階 1）
  var DEFAULT_SUB = { novice: 1, easy: 3, medium: 8, hard: 10, expert: 11 };
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
  // 天元那一批（規格 AN「天元字樣全面統一」）：選單按鈕、座位條小框、金色結算卡上的「天元」。中文＝書法字（志莽行書＋飛白，index.html 開頭的
  // #kg-zmx-T／Y 與 #kFb），金色漸層（#kGold）寫在 fill 屬性（CSS 的 url(#…) 在外部樣式表裡不一定指到這一頁）；讀屏念 aria-label。
  // 英文＝「Tengen」用宋體粗字＋金色漸層字（.tg-t）
  var SVG_NS = 'http://www.w3.org/2000/svg';
  function tgMark() {
    if (I.getLang() === 'en') return mk('b', 'tg-t', tierName(TENGEN_TIER));
    var svg = document.createElementNS(SVG_NS, 'svg'), g = document.createElementNS(SVG_NS, 'g');
    svg.setAttribute('class', 'tg-cal');
    svg.setAttribute('viewBox', '0 0 2000 1000');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', tierName(TENGEN_TIER));
    g.setAttribute('mask', 'url(#kFb)');
    g.setAttribute('fill', 'url(#kGold)');
    ['T', 'Y'].forEach(function (c, i) {
      var u = document.createElementNS(SVG_NS, 'use');
      u.setAttribute('href', '#kg-zmx-' + c);
      if (i) u.setAttribute('x', '1000');
      g.appendChild(u);
    });
    svg.appendChild(g);
    return svg;
  }
  // v0.5.13（規格 AF）：照 GROUP_TIERS 查（原本比大小，13 會被當成最強那一級）
  function tierGroup(tier) {
    for (var i = 0; i < GROUPS.length; i++) if (GROUP_TIERS[GROUPS[i]].indexOf(tier) >= 0) return GROUPS[i];
    return 'medium';
  }
  // 引擎已是十一階（或加了天元的十二階）就直接送階數（引擎沒有天元時送它最強的那一階）；還是九階時送最接近的舊階；
  // 更舊（沒有 Gomoku.TIERS）送舊的檔次字串
  // v0.5.13：引擎還沒有入門・2（階 13）時送入門・1（不會被 Math.min 夾成天元）
  function levelArg(tier) {
    if (tier === NOVICE2_TIER && !(G.TIERS && G.TIERS.length >= NOVICE2_TIER)) tier = 1;
    if (G.TIERS && G.TIERS.length >= 11) return Math.min(tier, G.TIERS.length);
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
    var x = RT.recommendTier(r, G.TIERS.slice(0, MAX_TIER));   // 只推薦介面有列的階（天元那一批起含天元；v0.5.13 起含入門・2〔階 13〕）
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
  // 第二十批 b：recalSeen＝看過「電腦分數重量過」的告知（有舊戰績的帳號第一次開下棋分頁時出現一次）
  // 第二十一批 b（規格 T2）：ponder＝電腦先想（預先思考），預設開；跟著這台裝置（多用的是這台裝置的電）
  // 第二十二批（規格 Y 第 6 條）：ownRoad＝「提示我的必勝路」（提醒列裡「小幫手看到你有一路用四逼到贏」那一句），預設關
  // 第二十四批（規格 Z1、Z8、AB）：pvpLay＝兩人一起下時手機怎麼放（'flat' 平放在中間，上方整條轉 180°；'hand' 輪流拿，都不轉），
  // 跟著這台裝置、記住上次選的；recalSeen 改成版本鍵：'v3'＝看過難度 v3 的分數告知
  // （第二十批 b 存的 true＝看過上一次的告知，這一版還要再看一次）。
  // 規格 Z8 最後一條（提示開關合併成兩個）：hints＝「威脅提醒」只管對手（句子＋對手棋子的橘色光環與標籤）；ownRoad 改名「提示我的機會」，
  // 管自己的全部機會（你有四、雙重威脅、必勝路：句子＋綠色光環與標籤），已開的人維持開。
  // 規格 Z9（作者再拍板）：對局頁沒有提醒卡，提醒句只給讀屏（aria-live、畫面隱藏），所以第十四批的 hintsOpen（收起／展開）拿掉。
  // ownRoad 三態：null＝沒動過（照規格 Z9 第 4 條的表預設）／true／false；最強一律不提供（見 ownRoadOn）。
  // 規格 Z10：teach＝「教學：顯示連續逼殺路」，預設關；兩個提示開關在當下都生效時才有作用（teachOn）。連續逼殺路（VCF）只屬於教學
  // 第二十二批的 DEFAULTS 是 ownRoad: false，而 saveSettings 會把整組設定寫回去，所以存著的 false 分不出是自己關的還是預設值：
  // 跟 hintsSet 同一個做法，ownRoadSet（在「我」分頁按過開關才是 true）為真時 false 才算數；沒有 ownRoadSet 的 false 當成沒動過。
  // 存著的 true 一定是自己打開的（第二十二批預設是 false），照舊是 true
  // 規格 AL：pvpHintB／pvpHintW＝兩人一起下時黑、白各自的「提示」（取代兩人共用的「危險提醒」「機會提示」），跟著這台裝置、記住上次的。
  // v0.5.5（作者拍板）：從開關改成四選一：'off' 關（預設）／'danger' 危險（只提醒對手的危險）／'chance' 機會（只提示自己的好棋）／'both' 危險＋機會。
  // v0.5.4 存的 true／false：true＝危險＋機會、其他＝關
  var DEFAULTS = { mode: 'pve', rule: 'free', side: 1, hints: true, hintsSet: false, last: null, learnSide: 2, pvpB: null, pvpW: null,
    scheme: 'system', anim: true, sound: false, recalSeen: false, ponder: true, ownRoad: null, ownRoadSet: false, pvpLay: 'flat', teach: false, badgeVer: 0,
    pvpHintB: 'off', pvpHintW: 'off', placeMode: 'direct', numsGame: false, numsReview: true };
  // v0.5.14（規格 AU）：棋子上顯示手數，對局與回頭看各一個開關、各自記住（跟著這台裝置）：numsGame 對局（「⋯」面板，預設關：下棋時數字會分心）、
  // numsReview 回頭看（步數控制旁的「手數」膠囊，預設開：回頭看正是要看順序）。練習題不顯示
  var PVP_HINTS = ['off', 'danger', 'chance', 'both'];
  function normPvpHint(v) { return v === true ? 'both' : PVP_HINTS.indexOf(v) >= 0 ? v : 'off'; }
  // 規格 AM：placeMode＝下子方式：'direct' 直接下（預設）／'confirm' 點兩下確認（第一下出半透明預覽子，同一點再點一下才下）；跟著這台裝置
  var RECAL_VER = 'af';

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
    if (typeof o.last !== 'string') o.last = null;
    if (['system', 'light', 'dark'].indexOf(o.scheme) < 0) o.scheme = 'system';
    o.anim = o.anim !== false; o.sound = !!o.sound;
    o.recalSeen = o.recalSeen === RECAL_VER ? RECAL_VER : o.recalSeen === true;
    o.ponder = o.ponder !== false;
    o.ownRoadSet = s.ownRoadSet === true;
    o.ownRoad = s.ownRoad === true ? true : o.ownRoadSet && s.ownRoad === false ? false : null;
    o.pvpLay = o.pvpLay === 'hand' ? 'hand' : 'flat';
    o.teach = o.teach === true;
    o.pvpHintB = normPvpHint(o.pvpHintB); o.pvpHintW = normPvpHint(o.pvpHintW);
    o.placeMode = o.placeMode === 'confirm' ? 'confirm' : 'direct';
    o.numsGame = o.numsGame === true; o.numsReview = o.numsReview !== false; // v0.5.14（規格 AU）
    o.badgeVer = typeof o.badgeVer === 'number' ? o.badgeVer : 0;
    return o;
  }
  var settings = loadSettings();
  function saveSettings() {
    try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch (e) { /* 私密模式等：不存 */ }
  }

  // ---------------------------------------------------------- 外觀（規格 R：深色模式、動畫、落子音效；第八批 b）

  function mq(q) { return window.matchMedia ? window.matchMedia(q) : null; }
  // v0.5.10（規格 AS）：平板版面。只看視窗的寬高（和 style.css 的 media query 同一組條件），不認裝置——桌機瀏覽器開大視窗一樣適用：
  // 'land'＝橫拿（寬 ≥ 900 且寬 > 高）：對局、回頭看、練習題棋盤在左、右邊一欄；'port'＝直拿平板（寬 ≥ 700、直的）；''＝手機版面（照舊，一點都不變）
  var MQ_LAND = '(min-width: 900px) and (orientation: landscape)', MQ_PORT = '(min-width: 700px) and (orientation: portrait)';
  var BOARD_MAX = 960, SIDE_MIN = 320, SIDE_GAP = 24; // 平板的棋盤上限（手機照舊 640）；橫拿時右欄最窄的寬度、和棋盤的間距（style.css 同一組數字）
  function tabletMode() {
    var l = mq(MQ_LAND), p = mq(MQ_PORT);
    return l && l.matches ? 'land' : p && p.matches ? 'port' : '';
  }
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
    if (meta) meta.setAttribute('content', dark ? '#1c1814' : '#f5f0e6'); // 第十五批：A 的 bg（深色）／wood（淺色）；v0.5.5：淺色也改成 bg（iPhone 狀態列後面的白霧）
    // 天元那一批複審：黑漆罐「輪到」的白光暈分淺色、深色兩種（drawCup 的快取鍵含 schemeNow()），換畫面顏色時在對局頁重畫棋罐
    if (S && !$('game').hidden) renderCups();
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
  // 第二十四批（規格 Z4）：棋鐘快到時每秒輕響一聲（短促的正弦「嗶」，比落子聲輕）。只在開了音效時響
  var beepCount = 0;
  function beep() {
    if (!settings.sound) return;
    beepCount++;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      if (!audio) audio = new AC();
      if (audio.state === 'suspended' && audio.resume) audio.resume();
      var t0 = audio.currentTime + 0.005, o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(1320, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      o.connect(g); g.connect(audio.destination);
      o.start(t0); o.stop(t0 + 0.14);
    } catch (e) { /* 沒有聲音就算了 */ }
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
    if (pr && pr.clock && typeof pr.clock === 'object') o.clock = pr.clock; // 第二十四批：棋鐘設定（見 myClock）
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
  // 作者 2026-10-01 拍板新徽章表（木 <800、銅 800、銀 1150、金 1400、白金 1650、鑽石 1850、大師 2050；rating.js）：
  // 這台裝置上的帳號照新表重新對應一次（RT.badge(分數)，不套降級緩衝），寫回、記 settings.badgeVer＝2，之後照常 badgeAfter。
  // rating.js 還是舊表時（RT.badge(2100) 不是 'master'）不做也不記，等新表到了再對應。
  // 要排在 migrateStrict 後面：這裡的 saveSettings 會把整組設定寫回去，舊設定裡的 strict 就不見了（t13b_items 抓到）
  var BADGE_VER = 2;
  (function remapBadges() {
    if (settings.badgeVer >= BADGE_VER || !RT || !RT.badge || badgeId(RT.badge(2100)) !== 'master') return;
    GS.profileList().forEach(function (p) { GS.updateProfile(p.id, { badge: badgeId(RT.badge(p.rating)) }); });
    settings.badgeVer = BADGE_VER;
    saveSettings();
  })();
  // v0.5.17（規格 AV）：成就。舊帳號第一次開新版：從既有紀錄回推（日期用當初那一盤的；練習題題數回推不了日期，記成「這天以前」；
  // 每日一題的連續天數從現在開始算）。之後每次開頁也靜靜補一次（別的視窗下完的盤），都不出「拿到成就」那一行
  (function achBackfill() {
    GS.profileList().forEach(function (p) { GS.achSync(p.id, Date.now()); });
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

  // ---------------------------------------------------------- 棋鐘（規格 Z4、Z7 第 2 條、AA 第 3 條；第二十四批）
  // 設定存在目前帳號的 pref.clock（stats.js 讀帳號時只留認得的欄位，pref 整個保留，所以放在 pref 裡）：
  //   { kind: 'none'|'move'|'game', move: 每步秒數, game: 每盤分鐘, split: 兩人時間不同,
  //   moveB／moveW、gameB／gameW：分開時黑、白各自的值 }。模式（每步／每盤）兩人共用，只有時間分開。
  // 跟電腦下只有「不限時／每步限時」：存的是 'game'（在兩人一起下選的）時，跟電腦下當成不限時（選單也顯示不限時）。
  // v0.5.10（規格 AT）：兩人時間不同時，黑、白各自可以選「不限時」＝moveB／moveW、gameB／gameW 存 CLOCK_NONE（0）。
  //   只有分開的四個值能是 0（共用的 move／game 照舊沒有 0，非分開模式的不限時是 kind 'none'）；舊設定沒有 0，照常讀。
  //   打開「兩人時間不同」時兩邊照舊從共用的時間開始（不會是不限時）
  var CLOCK_MOVE = [10, 20, 30, 60], CLOCK_GAME = [3, 5, 10, 15], CLOCK_NONE = 0;
  function normClock(c) {
    c = c && typeof c === 'object' ? c : {};
    var o = {
      kind: ['none', 'move', 'game'].indexOf(c.kind) >= 0 ? c.kind : 'none',
      move: CLOCK_MOVE.indexOf(c.move) >= 0 ? c.move : 30,
      game: CLOCK_GAME.indexOf(c.game) >= 0 ? c.game : 5,
      split: c.split === true
    };
    var ok = function (list, v) { return v === CLOCK_NONE || list.indexOf(v) >= 0; };
    o.moveB = ok(CLOCK_MOVE, c.moveB) ? c.moveB : o.move;
    o.moveW = ok(CLOCK_MOVE, c.moveW) ? c.moveW : o.move;
    o.gameB = ok(CLOCK_GAME, c.gameB) ? c.gameB : o.game;
    o.gameW = ok(CLOCK_GAME, c.gameW) ? c.gameW : o.game;
    return o;
  }
  function myClock() { var p = me(); return normClock(p && p.pref && p.pref.clock); }
  function saveClock(c) { var pr = pref(); pr.clock = normClock(c); savePref(pr); }
  // 這一盤實際用的棋鐘：null＝不限時。sides＝有鐘的那幾方（跟電腦下只有人；電腦不計時）；limit 是毫秒
  // v0.5.10（規格 AT）：兩人時間不同時選「不限時」的那一方 limit 是 0、不在 sides 裡＝沒有鐘、不會超時（clockState 只算 sides）；
  //   兩方都不限時＝null（整盤不限時，和選「不限時」一模一樣）
  function clockCfg(mode, human, c) {
    var kind = c.kind;
    if (mode !== 'pvp' && kind === 'game') kind = 'none';
    if (kind === 'none') return null;
    var split = mode === 'pvp' && c.split;
    function sec(p) {
      if (kind === 'move') return split ? (p === 1 ? c.moveB : c.moveW) : c.move;
      return 60 * (split ? (p === 1 ? c.gameB : c.gameW) : c.game);
    }
    var limit = { 1: sec(1) * 1000, 2: sec(2) * 1000 };
    var sides = mode === 'pvp' ? [1, 2].filter(function (p) { return limit[p] > 0; }) : [human];
    if (!sides.length) return null;
    return { kind: kind, split: split, limit: limit, sides: sides };
  }
  // 純函式：棋鐘設定＋事件序列＋目前時間 → 狀態（不讀任何全域；測試用假時鐘直接餵時間）。
  // 事件 { t: 毫秒, e: 'start'|'turn'|'undo'|'pause'|'resume'|'stop', p: 這時候輪到誰（start、turn、undo） }。
  //   start＝開局；turn＝下了一手換人（每步限時重新倒數）；undo＝悔棋（每盤限時不退時間；每步限時重新倒數）；
  //   pause／resume＝背景、回頭看、「⋯」面板；stop＝這盤結束（悔棋回來時 undo 會讓鐘再走）。
  //   v0.5.12（規格 AP-1）：load＝接著下（取代 start）：輪到 p、各方已經用掉的 used、輪到的那一方這一步已經用掉的 mv（resumeClockEv 算）。
  // 回傳 { kind, turn, run（正在走的那一方，0＝都停）, left: {1,2}（每盤：剩下的總時間；每步：輪到的那一方這一步剩下的時間，
  //   可以是負的＝超過時間；不是輪到的那一方是整步的時間）, level: {1,2}（''／'amber'／'red'／'over'）, flag（每盤限時用完的那一方，0＝沒有） }
  function clockState(cfg, events, now) {
    var used = { 1: 0, 2: 0 }, moveUsed = 0, turn = 0, last = null, paused = false, stopped = false;
    function charge(t) {
      if (turn && last != null && !paused && !stopped && cfg.sides.indexOf(turn) >= 0) {
        var d = Math.max(0, t - last);
        used[turn] += d;
        moveUsed += d;
      }
      last = t;
    }
    (events || []).forEach(function (ev) {
      charge(ev.t);
      if (ev.e === 'start' || ev.e === 'turn' || ev.e === 'undo') { turn = ev.p; moveUsed = 0; if (ev.e !== 'turn') stopped = false; }
      else if (ev.e === 'load') { turn = ev.p; used = { 1: +ev.used[1] || 0, 2: +ev.used[2] || 0 }; moveUsed = +ev.mv || 0; stopped = false; }
      else if (ev.e === 'pause') paused = true;
      else if (ev.e === 'resume') paused = false;
      else if (ev.e === 'stop') stopped = true;
    });
    charge(now);
    var st = { kind: cfg.kind, turn: turn, run: turn && !paused && !stopped && cfg.sides.indexOf(turn) >= 0 ? turn : 0,
      paused: paused, stopped: stopped, left: {}, level: {}, flag: 0 };
    [1, 2].forEach(function (p) {
      var left;
      if (cfg.kind === 'game') left = Math.max(0, cfg.limit[p] - used[p]);
      else left = p === turn ? cfg.limit[p] - moveUsed : cfg.limit[p];
      st.left[p] = left;
      var amber = cfg.kind === 'game' ? 30000 : 10000, red = cfg.kind === 'game' ? 10000 : 5000, lv = '';
      if (cfg.kind === 'move' && left < 0) lv = 'over';
      else if (left <= red) lv = 'red';
      else if (left <= amber) lv = 'amber';
      st.level[p] = cfg.sides.indexOf(p) >= 0 ? lv : '';
      if (cfg.kind === 'game' && cfg.sides.indexOf(p) >= 0 && used[p] >= cfg.limit[p]) st.flag = st.flag || p;
    });
    return st;
  }
  // 鐘面上的字：每盤 m:ss；每步 0:ss；超過時間＝往上數「+0:07」
  function clockText(ms) {
    var neg = ms < 0, s = neg ? Math.floor(-ms / 1000) : Math.ceil(ms / 1000);
    var txt = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    return neg ? '+' + txt : txt;
  }
  // 「每步 30 秒」「每盤 5 分鐘」「黑 10 分／白 3 分」（選單大按鈕第二行、「⋯」面板頂端、結算卡、紀錄）
  // v0.5.10（規格 AT）：不限時的那一方寫「不限時」（「黑 不限時／白 5 分」）
  function clockLabel(cfg) {
    if (!cfg) return t('clock.noneShort');
    var unit = function (p) {
      if (!(cfg.limit[p] > 0)) return t('clock.unlimited');
      return cfg.kind === 'move' ? t('clock.sec', { n: cfg.limit[p] / 1000 }) : t('clock.min', { n: cfg.limit[p] / 60000 });
    };
    if (cfg.split && cfg.limit[1] !== cfg.limit[2]) return t(cfg.kind === 'move' ? 'clock.splitMove' : 'clock.splitGame', { b: unit(1), w: unit(2) });
    return t(cfg.kind === 'move' ? 'clock.perMove' : 'clock.perGame', { v: unit(1) });
  }
  // 紀錄裡存的棋鐘設定（秒）：{ kind, b, w }；不限時存 null。v0.5.10（規格 AT）：不限時的那一方 b／w 是 0
  function clockRec(cfg) { return cfg ? { kind: cfg.kind, b: cfg.limit[1] / 1000, w: cfg.limit[2] / 1000, split: !!cfg.split } : null; }
  function cfgFromRec(c) {
    if (!c || (c.kind !== 'move' && c.kind !== 'game')) return null;
    var limit = { 1: c.b * 1000, 2: c.w * 1000 }, sides = [1, 2].filter(function (p) { return limit[p] > 0; });
    return sides.length ? { kind: c.kind, split: !!c.split, limit: limit, sides: sides } : null;
  }

  // ---------------------------------------------------------- v0.5.12（規格 AP-1）：關掉再開能接著下——存檔的純函式
  // 下到一半的盤整盤存在 localStorage `gomoku.resume.v1`（這台裝置一份；同時開兩個分頁＝最後寫的算）。下面三個是純函式（不讀任何全域，
  // test.js 切出來直接驗）；什麼時候存、清、問在「流程」那一段（saveResume、offerResume）。存的欄位：
  //   v 1（格式版本；不是 1 的一律丟掉）、at 存的時間（只是記錄）、ts 開局時間（＝紀錄的 ts，也是去重鍵：同一盤不會記兩次、不會算兩次分）、
  //   mode、tier、rule、strict、human、pid、pidB、pidW（這盤的帳號）、hintB／hintW／lay（兩人一起下：兩位的提示、怎麼放）、
  //   preset（開局教學擺好的 [[r,c]…]，沒有是 null）、moves（[[r,c,p]…]，含開局教學那幾手）、maxN（這盤下到過最多幾手，放棄算不算輸看它）、
  //   teach（這盤出現過連續逼殺路的標籤＝教學局不計分）、clockSet（這盤的棋鐘設定，normClock 的形狀）、
  //   clock（有棋鐘時：{ turn, left: [黑剩下, 白剩下] } 毫秒，存的那一刻的 clockState；不限時是 null）
  //   v0.5.12 複審：recAt（這盤自己記過的紀錄的 at：下完記過、悔棋又在下的盤；沒記過是 null）——同一個 ts 的紀錄 at 不一樣＝別的視窗結束了這盤
  var RESUME_KEY = 'gomoku.resume.v1';
  function resumePack(g, st, dev, now) {
    return {
      v: 1, at: now, ts: g.gameTs, recAt: typeof g.recAt === 'number' ? g.recAt : null, mode: g.mode, tier: g.tier, rule: g.rule, strict: !!g.strict, human: g.human,
      pid: g.pid, pidB: g.pidB, pidW: g.pidW, hintB: dev.pvpHintB, hintW: dev.pvpHintW, lay: dev.pvpLay,
      preset: g.preset ? g.preset.map(function (m) { return [m.r, m.c]; }) : null,
      moves: g.history.map(function (h) { return [h.r, h.c, h.p]; }),
      maxN: Math.max(g.maxN || 0, g.history.length), teach: !!g.teachShown, clockSet: g.clockSet || null,
      clock: st ? { turn: st.turn, left: [st.left[1], st.left[2]] } : null
    };
  }
  // 讀回來、檢查、整理成接著下要用的形狀；壞掉、舊版本、對不起來的一律回 null（呼叫的地方靜靜丟掉）。
  // ctx：size 棋盤邊長、maxTier、profile(id)（帳號不在了回 null＝丟掉）、normClock、normHint、ended(moves, rule)（盤面已經分出勝負＝丟掉，可省略）、
  //   clockCfg（v0.5.12 複審：用這盤的棋鐘設定把剩下的時間夾在合理範圍：每盤 0～總時間、每步 −1 小時～這一步的時間；不限時的那一方不看）
  var RESUME_OVER_MAX = 3600000;
  function resumeParse(raw, ctx) {
    var o;
    try { o = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return null; }
    if (!o || typeof o !== 'object' || o.v !== 1) return null;
    var size = ctx.size, i;
    function isInt(x, lo, hi) { return typeof x === 'number' && x % 1 === 0 && x >= lo && x <= hi; }
    function isTime(x) { return typeof x === 'number' && isFinite(x) && x > 0; }
    if ((o.mode !== 'pve' && o.mode !== 'pvp') || (o.rule !== 'free' && o.rule !== 'renju') || (o.human !== 1 && o.human !== 2)) return null;
    if (!isTime(o.ts) || !isTime(o.at)) return null;
    if (o.mode === 'pve' ? !isInt(o.tier, 1, ctx.maxTier) || !ctx.profile(o.pid) : !ctx.profile(o.pidB) || !ctx.profile(o.pidW)) return null;
    if (!Array.isArray(o.moves) || o.moves.length > size * size) return null;
    var moves = [], seen = {};
    for (i = 0; i < o.moves.length; i++) {
      var m = o.moves[i];
      // 黑先、一黑一白輪流（開局教學擺好的也是）；同一點不會下兩次
      if (!Array.isArray(m) || !isInt(m[0], 0, size - 1) || !isInt(m[1], 0, size - 1) || m[2] !== (i % 2 ? 2 : 1) || seen[m[0] * size + m[1]]) return null;
      seen[m[0] * size + m[1]] = 1;
      moves.push({ r: m[0], c: m[1], p: m[2] });
    }
    var preset = null;
    if (o.preset != null && !(Array.isArray(o.preset) && !o.preset.length)) { // v0.5.12 複審：[]＝沒有開局教學（null）
      if (!Array.isArray(o.preset) || o.preset.length > moves.length) return null;
      preset = [];
      for (i = 0; i < o.preset.length; i++) {
        var q = o.preset[i];
        if (!Array.isArray(q) || q[0] !== moves[i].r || q[1] !== moves[i].c) return null;
        preset.push({ r: q[0], c: q[1] });
      }
    }
    var presetN = preset ? preset.length : 0, turn = moves.length % 2 ? 2 : 1;
    if (moves.length <= presetN) return null; // 開局教學擺好的幾手之後沒有人下過：沒有東西好接著下
    if (!isInt(o.maxN, moves.length, size * size)) return null;
    if (ctx.ended && ctx.ended(moves, o.rule)) return null;
    var clock = null, clockSet = ctx.normClock(o.clockSet);
    if (o.clock != null) {
      var c = o.clock;
      if (typeof c !== 'object' || c.turn !== turn || !Array.isArray(c.left) || c.left.length !== 2) return null;
      if (!c.left.every(function (x) { return typeof x === 'number' && isFinite(x); })) return null;
      clock = { turn: turn, left: { 1: c.left[0], 2: c.left[1] } };
      var cfg = ctx.clockCfg ? ctx.clockCfg(o.mode, o.human, clockSet) : null;
      if (ctx.clockCfg && !cfg) clock = null; // 這盤的設定是不限時：存的剩下時間不用
      else if (cfg) [1, 2].forEach(function (p) {
        var lim = cfg.limit[p], lo = cfg.kind === 'game' ? 0 : -RESUME_OVER_MAX;
        clock.left[p] = cfg.sides.indexOf(p) < 0 ? lim : Math.max(lo, Math.min(lim, clock.left[p]));
      });
    }
    var pvp = o.mode === 'pvp', str = function (x) { return typeof x === 'string' ? x : null; };
    return {
      ts: o.ts, at: o.at, recAt: isTime(o.recAt) ? o.recAt : null, mode: o.mode, tier: isInt(o.tier, 1, ctx.maxTier) ? o.tier : 1, rule: o.rule, strict: o.rule === 'renju' && o.strict === true,
      human: o.human, pid: str(o.pid), pidB: str(o.pidB), pidW: str(o.pidW),
      hintB: ctx.normHint(pvp ? o.hintB : null), hintW: ctx.normHint(pvp ? o.hintW : null), lay: o.lay === 'hand' ? 'hand' : 'flat',
      preset: preset, presetN: presetN, moves: moves, turn: turn, maxN: o.maxN, teach: o.teach === true,
      clockSet: clockSet, clock: clock
    };
  }
  // v0.5.12 複審：問句裡「什麼時候下的」：今天／昨天＋時:分，更早的寫月/日＋時:分（at、now 是毫秒；用這台裝置的時區）
  function resumeWhen(at, now) {
    var a = new Date(at), d0 = new Date(now), day = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    var hm = a.getHours() + ':' + String(a.getMinutes()).padStart(2, '0'), diff = Math.round((day(d0) - day(a)) / 86400000);
    if (diff === 0) return { key: 'resume.today', p: { t: hm } };
    if (diff === 1) return { key: 'resume.yesterday', p: { t: hm } };
    return { key: 'resume.date', p: { m: a.getMonth() + 1, d: a.getDate(), t: hm } };
  }
  // 接著下時棋鐘的第一個事件（取代 start）：從存的那一刻剩下的時間接著走，關掉的那段不算。
  // 每盤限時：各方已經用掉＝總時間 − 剩下；每步限時：輪到的那一方這一步已經用掉＝這一步的時間 − 剩下（超過時間＝剩下是負的，照樣接著往上數）
  function resumeClockEv(cfg, c, turn, now) {
    var used = { 1: 0, 2: 0 }, mv = 0;
    if (cfg.kind === 'game') [1, 2].forEach(function (p) { used[p] = Math.max(0, Math.min(cfg.limit[p], cfg.limit[p] - c.left[p])); });
    else if (cfg.sides.indexOf(turn) >= 0) mv = Math.max(0, cfg.limit[turn] - c.left[turn]);
    return { t: now, e: 'load', p: turn, used: used, mv: mv };
  }

  // ---------------------------------------------------------- 狀態

  var S = {
    mode: 'pve', tier: 7, rule: 'free', strict: false, human: 1,
    board: G.createBoard(), history: [], turn: 1,
    over: false, winner: 0, endReason: null, forbiddenKind: null, winCells: null,
    // v0.5.5：endHold＝分出勝負以後、結算卡出來之前的那一下（{ reason, t0, ms, timer }）；forbidCue＝禁手輸時那顆子與讓它變成禁手的線
    endHold: null, forbidCue: null,
    thinking: false, aiTimer: null, pending: null, gen: 0,
    flash: null, flashTimer: null,
    gameTs: 0, recorded: false, preset: null, presetN: 0,
    hintFlash: null, hintFlashTimer: null, hintSeq: 0,
    pid: null, pidB: null, pidW: null, // 這局的帳號：單人是玩家；雙打是執黑、執白
    lastRec: null, lastFresh: false,   // 這局結束時的紀錄（結算畫面用）
    lastAch: null,                     // v0.5.17（規格 AV）：這局記好時新拿到的成就 [{ id, pid }]（結算卡最下面那一行）
    review: null, // 復盤中：'game'（從對局進來）或 'stats'（從戰績進來）
    // 第二十四批：棋鐘（cfg＝clockCfg 的結果或 null、ev＝事件序列、pause＝讓鐘停的原因：hidden／review／sheet）
    clk: { cfg: null, ev: [], pause: {} },
    lit: 0, breathe: 0, // 棋罐：亮著的是哪一色；換手時呼吸的次數（測試讀）
    halo: { keys: {}, rings: [], labels: [], groups: [] }, // 規格 Z8、Z9：光環與懸浮標籤（refreshHints 算）
    // 天元那一批（規格 AN）：card＝開場字卡正在播（播完或跳過之前不開始下：棋鐘停、電腦不想、棋罐不亮）；cardTimer、cardN（播過幾次，測試讀）、sweep（座位條小框掃光的次數）
    card: false, cardTimer: null, cardN: 0, sweep: 0,
    // 規格 AM：preview＝「點兩下確認」第一下的預覽點 { r, c }（下了子、換手、換盤、悔棋就清掉）；cardEndAt＝字卡收起的時間（剛收起的那一下點擊不算下子）
    preview: null, cardEndAt: 0,
    // v0.5.12（規格 AP-1）：live＝這一盤還在下、要存起來接著下（newGame、接著下時打開；endGame、放棄、回到選單時關掉；見 saveResume）
    live: false
  };

  // ---------------------------------------------------------- 棋盤繪圖（對局、復盤、練習題共用）

  // '#rrggbb' → rgba(...)（光環的漸層要帶透明度）
  function hexA(hex, a) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return hex;
    var n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')';
  }
  // 光環的亮度（0–1）：出現後 0.4 秒、1.2 秒各亮一次（呼吸兩下，1.6 秒），之後停在 0.55（淡光環）。
  // 時序照對照稿 mock2 的 threat-ring（0 .1／6.7% 1／13.3% .35／20% 1／26.7% .55，以 6 秒為一輪＝0.4 秒一格）。live＝還在呼吸
  var HALO_KEYS = [[0, 0.1], [400, 1], [800, 0.35], [1200, 1], [1600, 0.55]], HALO_REST = 0.55, HALO_MS = 1600;
  function haloAlpha(t0, now) {
    if (!motionOK() || t0 == null) return { v: HALO_REST, live: false };
    var d = now - t0;
    if (d >= HALO_MS || d < 0) return { v: HALO_REST, live: false };
    for (var i = 1; i < HALO_KEYS.length; i++) {
      if (d <= HALO_KEYS[i][0]) {
        var a = HALO_KEYS[i - 1], b = HALO_KEYS[i], f = (d - a[0]) / (b[0] - a[0]);
        f = f * f * (3 - 2 * f); // ease-in-out
        return { v: a[1] + (b[1] - a[1]) * f, live: true };
      }
    }
    return { v: HALO_REST, live: false };
  }

  // v0.5.19（規格 AW）：opts＝{ dpr, still }——分享圖片用的離屏棋盤：dpr 固定（不看這台裝置的 devicePixelRatio，每台畫出來一樣大）、
  // still＝不做動畫（第一次畫就是最後的樣子：勝負線、禁手 ×、剛落的子都直接畫好）。對局、回頭看、練習題、研究的棋盤不帶 opts，照舊
  function BoardView(canvas, opts) {
    var ctx = canvas.getContext('2d'), fixed = opts || {};
    // 第十五批：畫座標時棋盤外側多留 COORD_PAD（CSS 像素）的邊，座標寫在邊上，不再被角落的棋子蓋住；不畫座標時沒有這道邊
    var COORD_PAD = 14;
    var geo = { css: 0, dpr: 1, cell: 0, margin: 0, pad: 0 };
    var lastView = null;
    // 規格 AM：放大停下來後用「倍數」倍的解析度重畫（res），畫布的 CSS 大小不變，放大靠外層的 transform；onSize＝大小真的變了（換版面）時叫（放大還原）
    var res = 1, hooks = { onSize: null };

    function layout(coords) {
      geo.pad = coords ? COORD_PAD : 0;
      geo.cell = (geo.css - 2 * geo.pad) / N;
      geo.margin = geo.pad + geo.cell / 2;
    }
    function setSize(size) {
      var dpr = fixed.dpr || window.devicePixelRatio || 1;
      if (size !== geo.css && geo.css && hooks.onSize) hooks.onSize();
      // 背後的像素最多 ZOOM_RES_CAP 邊長（iPhone 的畫布記憶體有限）
      var k = Math.max(1, Math.min(res, ZOOM_RES_CAP / (size * dpr)));
      canvas.style.width = size + 'px';
      canvas.style.height = size + 'px';
      canvas.width = Math.round(size * dpr * k);
      canvas.height = Math.round(size * dpr * k);
      geo.css = size;
      geo.dpr = canvas.width / size;
      layout(!!(lastView && lastView.coords));
      if (lastView) draw(lastView);
    }
    function setRes(k, quiet) {
      if (k === res) return;
      res = k;
      if (!quiet && geo.css) setSize(geo.css); // quiet：正要 setSize（換大小）時只記下來
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
    // v0.5.5（作者：勝負那一刻先看清楚）：五連的紅圈描完以後，一條線從一頭畫到另一頭（WIN_LINE 毫秒）；
    // 禁手輸：那顆子上的紅 × 閃兩下、讓它變成禁手的幾條線（三三、四四、長連）一條一條畫出來（FORBID_MS 內）
    var WIN_LINE = 400, FORBID_MS = 700;
    var anim = { drop: null, win: null, forbid: null, raf: 0, halo: false };
    var drawn = { count: -1, last: null, winKey: null, forbidKey: null }; // 上一次畫的子數、最後一手、勝利五子：比對出「剛落的一顆」
    var bgCache = { key: '', cv: null };                 // 底、格線、星位先畫在離屏畫布，動畫每一格只要貼上
    var numLog = [];                                     // v0.5.14（規格 AU）：上一次畫的手數（測試讀）

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
      var forbidKey = v.endForbid ? v.endForbid.r * N + v.endForbid.c : null;
      if (!ok || forbidKey == null) anim.forbid = null;
      else if (forbidKey !== drawn.forbidKey) anim.forbid = { t0: now + (anim.drop ? DROP_MS : 0) };
      drawn.count = count; drawn.last = last; drawn.winKey = winKey; drawn.forbidKey = forbidKey;
    }
    function schedule() {
      if (anim.raf || !(anim.drop || anim.win || anim.forbid || anim.halo)) return;
      anim.raf = requestAnimationFrame(function () { anim.raf = 0; if (lastView) paint(lastView); });
    }

    // v = { board, last:{r,c}, winCells:[[r,c]], forbidden:bool（畫黑棋禁手 ×）, coords:bool,
    //       marks:[{r,c,color}] 小色塊, frames:[{r,c,color}] 方框, rings:[{r,c,color,dash}] 圈，
    //       ghosts:[{r,c,p,num}] 半透明編號子, flash:[{r,c}] 橘色閃點, crosses:[{r,c}] 指定點的紅 ×,
    //       nums:[{r,c}] 照下的順序排的手（v0.5.14 規格 AU：棋子上寫手數；沒給＝不寫） }
    // color 可以是風格的標記名（'own'、'opp'、'losing'、'better'、'brilliant'、'follow'），由目前風格給顏色；也可以直接給色碼。
    function draw(v) {
      lastView = v;
      if (geo.pad !== (v.coords ? COORD_PAD : 0)) layout(!!v.coords);
      if (!canvas.width) return;
      if (!fixed.still) startAnims(v);
      paint(v);
    }
    // 換風格、換大小時重畫，不啟動動畫
    function redraw() { if (lastView && canvas.width) paint(lastView); }

    function paint(v) {
      var W = canvas.width;
      if (!W || !(geo.cell > 0)) return; // 第二十四批：還沒排版（setSize 前畫布是預設的 300 寬、格寬 0 或負的）時不畫
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
      // 第二十四批（規格 Z8）：威脅光環。畫在格線之上、棋子之下（鄰近的子會蓋住光暈，光暈不蓋到別的子）；
      // 對手＝主題的 flash 橘、自己＝主題的 ownGlow 綠。出現那一刻呼吸兩下（約 1.6 秒）後停成淡光環；不能動時直接是淡光環
      anim.halo = false;
      if (v.halos && v.halos.length) {
        v.halos.forEach(function (h) {
          if (!b[h.r][h.c]) return;
          var a = haloAlpha(h.t0, now);
          if (a.live) anim.halo = true;
          var hx = px(h.c), hy = px(h.r), hc = col(h.own ? 'ownGlow' : 'flash');
          var g = ctx.createRadialGradient(hx, hy, R * 0.85, hx, hy, R * 1.55);
          g.addColorStop(0, hexA(hc, 0.95 * a.v));
          g.addColorStop(0.4, hexA(hc, 0.55 * a.v));
          g.addColorStop(1, hexA(hc, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(hx, hy, R * 1.55, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = hexA(hc, Math.min(1, 0.4 + 0.6 * a.v));
          ctx.lineWidth = Math.max(1.5 * dpr, cell * 0.05);
          ctx.beginPath();
          ctx.arc(hx, hy, R * 1.1, 0, Math.PI * 2);
          ctx.stroke();
        });
      }
      var drop = anim.drop;
      if (drop && !b[drop.r][drop.c]) drop = anim.drop = null;
      // v0.5.14（規格 AU）：棋子上顯示手數。v.nums＝照下的順序排的手（第 k 個寫 k＋1；開局教學擺好的子也在裡面，照實際手數編號）。
      // numAt[點]＝手數；那一點真的有子才寫
      var numAt = {}, numN = 0;
      (v.nums || []).forEach(function (q, k) { if (b[q.r] && b[q.r][q.c]) { numAt[q.r * N + q.c] = k + 1; numN = k + 1; } });
      for (r = 0; r < N; r++) {
        for (c = 0; c < N; c++) {
          if (!b[r][c] || (drop && r === drop.r && c === drop.c)) continue;
          th.stone(gm, px(c), px(r), R, b[r][c], { seed: r * 32 + c + 1, num: !!numAt[r * N + c] });
        }
      }
      if (drop) {
        var dk = Math.min(1, Math.max(0, (now - drop.t0) / DROP_MS)), de = 1 - Math.pow(1 - dk, 3);
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.65 * de;
        th.stone(gm, px(drop.c), px(drop.r), R * (1.18 - 0.18 * de), b[drop.r][drop.c], { seed: drop.r * 32 + drop.c + 1, num: !!numAt[drop.r * N + drop.c] });
        ctx.restore();
        if (dk >= 1) anim.drop = null;
      }
      // 數字畫在棋子正中：黑子白字、白子黑字（風格的 numB／numW，和半透明編號子同一組）；字級隨格距（1–2 位數 0.42 格、三位數 0.32 格，
      // 再用 fillText 的寬度上限收在子裡）。最後一手（v.last）的數字是紅的、不畫紅點（下面 lastMark 跳過）。
      // 畫在棋子之上、勝負線與禁手 × 之下（那些照常疊在上面）；放大時格距是放大後的像素，字跟著變清楚。numLog＝這一次寫了什麼（測試讀）
      var lastNum = 0;
      numLog = [];
      if (numN) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        var lastKey = v.last ? v.last.r * N + v.last.c : -1;
        (v.nums || []).forEach(function (q) {
          var key2 = q.r * N + q.c, n = numAt[key2];
          if (!n) return;
          var p = b[q.r][q.c], isLast = key2 === lastKey && n === numN, x = px(q.c), y = px(q.r) + cell * 0.02;
          var fs = cell * (n >= 100 ? 0.32 : 0.42), maxW = R * 1.5, fill = isLast ? (p === 1 ? mk.numLastB : mk.numLastW) : (p === 1 ? mk.numB : mk.numW);
          ctx.font = '700 ' + fs.toFixed(1) + 'px -apple-system, BlinkMacSystemFont, sans-serif';
          if (isLast && p === 1 && mk.numLastEdge) {
            ctx.strokeStyle = mk.numLastEdge;
            ctx.lineWidth = Math.max(1.5 * dpr, fs * 0.2);
            ctx.strokeText(String(n), x, y, maxW);
          }
          ctx.fillStyle = fill;
          ctx.fillText(String(n), x, y, maxW);
          if (isLast) lastNum = n;
          numLog.push({ r: q.r, c: q.c, n: n, p: p, fill: fill, last: isLast, font: +(fs / dpr).toFixed(2), dev: +fs.toFixed(1) });
        });
        ctx.lineJoin = 'miter';
      }

      // 規格 AM「點兩下確認」：第一下的半透明預覽子（v.preview＝{ r, c, p }），那一點有子了就不畫
      if (v.preview && !b[v.preview.r][v.preview.c]) {
        ctx.save();
        ctx.globalAlpha = mk.ghostAlpha;
        th.stone(gm, px(v.preview.c), px(v.preview.r), R, v.preview.p, { seed: v.preview.r * 32 + v.preview.c + 1, ghost: true });
        ctx.restore();
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
        // v0.5.5：圈描完以後，一條線穿過五顆子（主題的 win 色，從一頭畫到另一頭）；不能動時直接畫好
        var lineAt = (wc.length - 1) * WIN_STEP + WIN_RING, a0 = wc[0], a1 = wc[wc.length - 1];
        var lf = wa ? Math.min(1, Math.max(0, (now - wa.t0 - lineAt) / WIN_LINE)) : 1;
        if (lf > 0 && wc.length >= 2) {
          var le = 1 - Math.pow(1 - lf, 2), ux = Math.sign(a1[1] - a0[1]), uy = Math.sign(a1[0] - a0[0]), ext = R * 0.55;
          var x0 = px(a0[1]) - ux * ext, y0 = px(a0[0]) - uy * ext, x1 = px(a1[1]) + ux * ext, y1 = px(a1[0]) + uy * ext;
          ctx.lineCap = 'round';
          strokeKey('win', Math.max(2.5, cell * 0.12), function () {
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x0 + (x1 - x0) * le, y0 + (y1 - y0) * le);
          });
          ctx.lineCap = 'square';
        }
        if (wa && now - wa.t0 >= lineAt + WIN_LINE) anim.win = null;
      }

      // v0.5.5：禁手輸（v.endForbid＝{ r, c, lines:[[r1,c1,r2,c2]] }）：讓它變成禁手的幾條線（禁手色，一條接一條畫出來）＋那顆子上的紅 ×（閃兩下）
      if (v.endForbid) {
        var ef = v.endForbid, fa = anim.forbid, ft = fa ? now - fa.t0 : Infinity, nl = ef.lines.length || 1, seg = (FORBID_MS * 0.6) / nl;
        ctx.lineCap = 'round';
        ef.lines.forEach(function (L, j) {
          var q = Math.min(1, Math.max(0, (ft - j * seg) / seg));
          if (q <= 0) return;
          var lx0 = px(L[1]), ly0 = px(L[0]), lx1 = px(L[3]), ly1 = px(L[2]);
          strokeKey('forbid', Math.max(2, cell * 0.09), function () {
            ctx.beginPath();
            ctx.moveTo(lx0, ly0);
            ctx.lineTo(lx0 + (lx1 - lx0) * q, ly0 + (ly1 - ly0) * q);
          });
        });
        var pulse = fa && ft < FORBID_MS ? 1 + 0.35 * Math.abs(Math.sin(Math.max(0, ft) / FORBID_MS * Math.PI * 2)) : 1, xh = cell * 0.26 * pulse, fxp = px(ef.c), fyp = px(ef.r);
        strokeKey('forbid', Math.max(2, cell * 0.1), function () {
          ctx.beginPath();
          ctx.moveTo(fxp - xh, fyp - xh); ctx.lineTo(fxp + xh, fyp + xh);
          ctx.moveTo(fxp + xh, fyp - xh); ctx.lineTo(fxp - xh, fyp + xh);
        });
        ctx.lineCap = 'square';
        if (fa && ft >= FORBID_MS) anim.forbid = null;
      }

      if (v.last && !lastNum) GT.lastMark(th, ctx, px(v.last.c), px(v.last.r), R, b[v.last.r][v.last.c] || 1, cell, dpr); // v0.5.14（規格 AU）：寫了紅色手數就不畫紅點

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

    return { canvas: canvas, geo: geo, setSize: setSize, draw: draw, redraw: redraw, cellAt: cellAt, setRes: setRes, hooks: hooks,
      res: function () { return res; },
      animState: function () { return { drop: !!anim.drop, win: !!anim.win, forbid: !!anim.forbid, halo: !!anim.halo }; },
      nums: function () { return numLog.slice(); }, // v0.5.14（規格 AU）：上一次畫在棋子上的手數 [{ r, c, n, p, fill, last, font, dev }]
      view: function () { return lastView; } }; // 第十二批 c：測試讀目前畫的內容（圈、×、五連）
  }

  // ---------------------------------------------------------- 棋盤放大（規格 AM）
  // 兩指撥開／捏合：棋盤在自己的框（.zoom-frame，overflow 藏起來）裡放大到最多 3 倍，以兩指中點為中心；外層 .zoom-layer 用 transform
  // （translate＋scale，原點左上），座位條、棋罐、選單都不動，也不是瀏覽器整頁縮放。放大時一指拖曳＝移動視野；手指動超過 8 px 算拖曳、
  // 不算點（touchend 取消預設，瀏覽器不會再送 click）；沒動＝點一下，照原本的 click 下子（cellAt 用 getBoundingClientRect，已經含 transform）。
  // 1 倍時一指照常交給瀏覽器（練習題頁可以捲）；兩指一碰到就接手（touchstart 取消預設，瀏覽器不縮放整頁）。不做「點兩下放大」：
  // 框的 touch-action 是 pan-x pan-y（放大時 none），瀏覽器也不會點兩下放大。捏回 1 倍（< 1.05）就還原；角落「還原」鈕；
  // afterPlace()＝真的下了子：約 0.2 秒平滑縮回（減少動態效果時直接還原）。停下來後用倍數倍的解析度重畫（BoardView.setRes），放大後不糊。
  // v0.5.4：手指只算按在這個框裡的（own；平放時對手按在座位條上的那一指不會讓點一下變成兩指捏、也不會讓拖完當成點）。
  // 點一下（沒動）時兩種情況自己送 click、取消瀏覽器的（touchend preventDefault，之後來的原生 click 也擋掉）：
  // (a) 跟上一次點一下相隔 < 350 ms、< 20 px（連點兩下；保險 iOS Safari 不認 pan-x pan-y 時會點兩下放大）；(b) 框外還有手指按著（瀏覽器可能不送 click）。
  var ZOOM_MAX = 3, ZOOM_DRAG = 8, ZOOM_BACK_MS = 200, ZOOM_RES_CAP = 2560, DBL_MS = 350, DBL_PX = 20;
  function BoardZoom(view, frame, layer, btn) {
    var z = 1, tx = 0, ty = 0, g = null, resTimer = 0, blockNext = 0, own = {}, lastTap = null, synth = 0;
    // 還按著、而且是按在這個框裡的手指（順便把已經放開的從 own 拿掉）
    function mine(e) {
      var out = [], keep = {};
      for (var i = 0; i < e.touches.length; i++) { var t = e.touches[i]; if (own[t.identifier]) { out.push(t); keep[t.identifier] = 1; } }
      own = keep;
      return out;
    }
    function S0() { return view.geo.css || frame.clientWidth || 1; }
    function clamp() {
      var s = S0();
      z = Math.min(ZOOM_MAX, Math.max(1, z));
      tx = Math.min(0, Math.max(s * (1 - z), tx));
      ty = Math.min(0, Math.max(s * (1 - z), ty));
    }
    function apply(anim) {
      layer.classList.toggle('zoom-anim', !!anim && motionOK());
      layer.style.transform = z === 1 && !tx && !ty ? '' : 'translate(' + tx + 'px, ' + ty + 'px) scale(' + z + ')';
      frame.classList.toggle('zoomed', z > 1);
      btn.hidden = z <= 1;
    }
    function sharpen(delay) {
      if (resTimer) clearTimeout(resTimer);
      resTimer = setTimeout(function () { resTimer = 0; view.setRes(z); }, delay || 0);
    }
    function reset(anim) {
      g = null;
      if (z === 1 && !tx && !ty) { if (view.res() !== 1) sharpen(0); return; }
      z = 1; tx = 0; ty = 0;
      var a = !!anim && motionOK();
      apply(a);
      sharpen(a ? ZOOM_BACK_MS : 0);
    }
    function pt(t) { var r = frame.getBoundingClientRect(); return { x: t.clientX - r.left, y: t.clientY - r.top }; }
    function pinchStart(ts) {
      var a = pt(ts[0]), b = pt(ts[1]);
      layer.classList.remove('zoom-anim');
      if (resTimer) { clearTimeout(resTimer); resTimer = 0; }
      g = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, z0: z, tx0: tx, ty0: ty, moved: true };
    }
    function oneStart(t, moved, afterPinch) {
      var p = pt(t);
      g = { kind: 'one', id: t.identifier, x0: p.x, y0: p.y, tx0: tx, ty0: ty, moved: !!moved, afterPinch: !!afterPinch };
    }
    frame.addEventListener('touchstart', function (e) {
      blockNext = 0; // 新的一下開始了：之前留著擋 click 的記號作廢
      for (var i = 0; i < e.changedTouches.length; i++) own[e.changedTouches[i].identifier] = 1;
      var ts = mine(e);
      if (ts.length >= 2) { pinchStart(ts); if (e.cancelable) e.preventDefault(); }
      else if (ts.length === 1) oneStart(ts[0], false);
    }, { passive: false });
    frame.addEventListener('touchmove', function (e) {
      if (!g) return;
      var ts = mine(e);
      if (g.kind === 'pinch' && ts.length >= 2) {
        var a = pt(ts[0]), b = pt(ts[1]);
        var d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        // 兩指一開始中點下的那一點（棋盤上的位置）跟著現在的中點走
        var cx = (g.m0.x - g.tx0) / g.z0, cy = (g.m0.y - g.ty0) / g.z0;
        z = Math.min(ZOOM_MAX, Math.max(1, g.z0 * d / g.d0));
        tx = m.x - cx * z; ty = m.y - cy * z;
        clamp();
        apply(false);
        if (e.cancelable) e.preventDefault();
        return;
      }
      if (g.kind !== 'one') return;
      var t = null;
      for (var i = 0; i < ts.length; i++) if (ts[i].identifier === g.id) t = ts[i];
      if (!t) return;
      var p = pt(t), dx = p.x - g.x0, dy = p.y - g.y0;
      if (!g.moved && Math.hypot(dx, dy) > ZOOM_DRAG) g.moved = true;
      if (z > 1) {
        if (e.cancelable) e.preventDefault();
        if (g.moved) { tx = g.tx0 + dx; ty = g.ty0 + dy; clamp(); apply(false); }
      }
    }, { passive: false });
    function end(e) {
      if (!g) return;
      var was = g, ts = mine(e);
      if (ts.length >= 2) { pinchStart(ts); return; }
      if (ts.length === 1) {
        // 兩指放開一指：剩下那一指接著拖（這一下已經不是點）
        if (was.kind === 'pinch' && z < 1.05) reset(false);
        oneStart(ts[0], true, was.kind === 'pinch' || was.afterPinch);
        return;
      }
      g = null;
      if (was.kind === 'pinch' || was.moved) {
        if (e.cancelable) e.preventDefault(); // 拖過、捏過：不算點（瀏覽器不送 click）
        blockNext = performance.now() + 600;
      }
      if (was.kind === 'pinch' || was.afterPinch) { if (z < 1.05) reset(false); else sharpen(0); }
      if (was.kind === 'one' && !was.moved && e.type === 'touchend') tapEnd(e, was);
    }
    // 點一下放開：連點兩下或框外還有手指時，自己把 click 送給手指下的元素（棋盤、標籤、「還原」），瀏覽器的 click 取消／擋掉
    function tapEnd(e, was) {
      var t = null;
      for (var i = 0; i < e.changedTouches.length; i++) if (e.changedTouches[i].identifier === was.id) t = e.changedTouches[i];
      if (!t) return;
      var now = performance.now(), x = t.clientX, y = t.clientY;
      var dbl = !!lastTap && now - lastTap.t < DBL_MS && Math.hypot(x - lastTap.x, y - lastTap.y) < DBL_PX;
      lastTap = { t: now, x: x, y: y };
      if (!dbl && !e.touches.length) return; // 一般的點一下：照舊交給瀏覽器的 click
      var el = document.elementFromPoint(x, y);
      if (!el || !frame.contains(el)) return;
      if (e.cancelable) e.preventDefault();
      synth++;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, screenX: t.screenX, screenY: t.screenY }));
      blockNext = performance.now() + 600; // 瀏覽器要是還送原生 click（取消不了時），擋掉，不會算兩次
    }
    frame.addEventListener('touchend', end, { passive: false });
    frame.addEventListener('touchcancel', function (e) { end(e); }, { passive: false });
    // Safari：兩指手勢不要縮放整頁
    ['gesturestart', 'gesturechange'].forEach(function (n) { frame.addEventListener(n, function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false }); });
    // 保險：拖過、捏過之後、下一次碰到之前來的 click 不算（有些瀏覽器 touchend 取消預設後仍會送）
    frame.addEventListener('click', function (e) {
      var block = blockNext && performance.now() < blockNext && e.target !== btn;
      blockNext = 0;
      if (block) { e.stopPropagation(); e.preventDefault(); }
    }, true);
    btn.addEventListener('click', function (e) { e.stopPropagation(); reset(true); });
    view.hooks.onSize = function () { z = 1; tx = 0; ty = 0; g = null; if (resTimer) { clearTimeout(resTimer); resTimer = 0; } apply(false); view.setRes(1, true); };
    return {
      reset: reset,
      afterPlace: function () { if (z > 1) reset(true); },
      state: function () { return { z: z, tx: tx, ty: ty, res: view.res(), btn: !btn.hidden, gesture: g ? g.kind : null, synth: synth }; },
      // 測試用：直接設倍數與位移（同 pinch 的結果）
      set: function (nz, ntx, nty) { z = nz; tx = ntx; ty = nty; clamp(); apply(false); sharpen(0); }
    };
  }

  var bv = BoardView($('board'));
  var bz = BoardZoom(bv, $('boardFrame'), $('boardLayer'), $('boardZoomReset'));

  // ---------------------------------------------------------- 背景執行緒：一個給 AI 下棋，一個給威脅提醒與復盤分析

  var workerOK = typeof Worker !== 'undefined';
  var aiWorker = null;
  var helper = null;
  var helperSeq = 0;
  var helperCb = {};

  // 第十八批：載入網址帶版本號（index.html 的 gomokuUrl：檔名後加 v 參數＝GOMOKU_VERSION）。沒有 gomokuUrl 時照原檔名
  function vurl(p) { return typeof window.gomokuUrl === 'function' ? window.gomokuUrl(p) : p; }

  // 第二十批 b（judge F4）：Worker 一啟動就回 { type: 'hello', version }（ai-worker.js 自己的版本號）。頁面開著時發布了新版，
  // 重建 Worker（cancelAI、resetHelper 之後）會從伺服器拿到新檔；和這一頁的 GOMOKU_VERSION 不一樣時，顯示「有新版本，請重新整理」膠囊。
  // 不自動重整（對局會不見）；點膠囊才重新整理。舊版 ai-worker.js 沒有 hello，就不比對。
  function isHello(d) {
    if (!d || d.type !== 'hello') return false;
    var mine = window.GOMOKU_VERSION || '';
    if (d.version && mine && d.version !== mine) $('updateBox').hidden = false;
    return true;
  }
  $('updatePill').addEventListener('click', function () { location.reload(); });

  // file:// 開啟時 new Worker 會拋錯 → 以後都用同步版
  function makeAIWorker() {
    if (!workerOK) return null;
    try {
      var w = new Worker(vurl('ai-worker.js'));
      w.onmessage = function (e) { if (!isHello(e.data)) onAIReply(e); };
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
      var w = new Worker(vurl('ai-worker.js'));
      w.onmessage = function (e) {
        var d = e.data;
        if (isHello(d)) return;
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

  // 威脅清單：cb(result 或 null)。opts（v0.5.15，擺棋盤研究）：照傳給 listThreats（{ vcfMs: 0 }＝不查連續沖四）；對局不給
  function requestThreats(board, player, rule, cb, opts) {
    var w = getHelper();
    if (w) {
      var id = ++helperSeq;
      helperCb[id] = function (d) {
        delete helperCb[id];
        // 契約寫 'threats'；引擎批實作回 'threatsResult'，兩種都收
        cb(d && (d.type === 'threatsResult' || d.type === 'threats') ? d.result || null : null);
      };
      w.postMessage({ type: 'threats', id: id, board: cloneBoard(board), player: player, rule: rule, opts: opts });
      return;
    }
    setTimeout(function () {
      var res = null;
      if (G.listThreats) { try { res = G.listThreats(board, player, rule, opts); } catch (e) { res = null; } }
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
    // v0.5.11 複審（規格 AO）：確認框（認輸、求和、放棄…）開著時電腦不落子：先收著，框關掉以後再下（flushHeldReply）。
    // 不然框裡寫的手數（「盤上才 10 手…不算輸贏」）和按下去時盤上的手數會不一樣，框底下也會冒出新的子
    if (!$('dialog').hidden) { S.heldReply = e; return; }
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
  // 第二十一批 b（judge 第十一輪 F4）：只有正式請求真的送進 aiWorker、還沒回（S.pending.sent）才重建；
  //   用預先思考的結果（等 300 ms 的計時、等某一步算完的 waitKey）時 aiWorker 沒在算，不重建
  function cancelAI() {
    if (S.aiTimer) clearTimeout(S.aiTimer);
    S.aiTimer = null;
    S.heldReply = null; // v0.5.11 複審：確認框開著時收著的電腦那一手一起丟
    if (S.thinking && aiWorker && S.pending && S.pending.sent) {
      aiWorker.terminate();
      aiWorker = makeAIWorker();
    }
    S.thinking = false;
    S.pending = null;
    S.gen++;
    cancelPonder(); // 第二十一批 b：悔棋、重開、回選單、進回頭看都走這裡，預先思考的舊結果一起丟
    stopCard();     // 天元那一批：開場字卡播到一半就換盤、回選單時收起（不開始下）
    stopSay();      // 天元那一批複審：「對手：天元」還沒念的計時一起收掉
    stopEndHold();  // v0.5.5：分出勝負後、結算卡出來前就悔棋、換盤、回選單、進回頭看：不再等
  }

  // v0.5.11 複審：確認框關掉以後，把框開著時收著的電腦那一手下出去（認輸、放棄已經 cancelAI → S.gen 換了，onAIReply 自己丟掉）
  function flushHeldReply() {
    var h = S.heldReply;
    S.heldReply = null;
    if (h && $('dialog').hidden) onAIReply(h);
  }

  function sendAI(req) {
    S.pending = req;
    if (!aiWorker) aiWorker = makeAIWorker();
    if (aiWorker) { req.sent = true; aiWorker.postMessage(req); }
    else runSync(req);
  }

  // 第二十一批 b（規格 T2）：送正式請求之前先查預先思考。人剛下的那步（盤面一致：只比預先思考開始時多一手）
  //   有結果 → 直接用（仍等 PONDER_MIN_WAIT，不秒回）；正在算這一步 → 等它算完（ponderResult 交給 onAIReply）；
  //   都不是 → 停掉預先思考（人落子的瞬間，不搶正式搜尋的時間）再照原流程送
  function maybeAI() {
    if (!isAITurn() || S.review) return;
    S.thinking = true;
    updateStatus();
    refreshHints();
    var req = { id: ++S.gen, board: cloneBoard(S.board), player: S.turn, level: levelArg(S.tier), rule: S.rule };
    var last = S.history[S.history.length - 1];
    var key = last && last.p === S.human && S.history.length === P.stones + 1 ? last.r + ',' + last.c : null;
    if (key && Object.prototype.hasOwnProperty.call(P.results, key)) {
      var reply = P.results[key];
      S.pending = req;
      cancelPonder();
      S.aiTimer = setTimeout(function () {
        S.aiTimer = null;
        onAIReply({ data: { id: req.id, move: reply } });
      }, PONDER_MIN_WAIT);
      return;
    }
    if (key && P.active && P.active.key === key) {
      req.waitKey = key;
      req.since = Date.now();
      S.pending = req;
      return;
    }
    cancelPonder();
    sendAI(req);
  }

  // ---------------------------------------------------------- 預先思考（規格 T2，第二十一批 b）
  // 人的回合開始時，另一個專用 Worker 猜人最可能下的 PONDER_K 步、先算好電腦對每一步的回應（訊息格式見 ai-worker.js）。
  // P.gen 是預先思考自己的世代編號，和 S.gen 分開：換帳號、換階、換規則發生在選單，若動 S.gen 會把正在算的正式回覆丟掉。
  // P.active：正在算的那一步 { key: 'r,c', since }；P.results：'r,c' → 電腦的回應；P.stones：開始時盤上幾手
  // judge 第十一輪：F2 強・1（階 9）每步只有約 0.2 秒，先想反而變慢，改成強・2（階 10）以上；
  //   F1 瀏覽器的 terminate 不會中斷 Worker 裡正在跑的同步搜尋（殘留最多約 2 秒、和正式搜尋搶 CPU），
  //   所以 navigator.hardwareConcurrency 是數字而且 ≥ PONDER_MIN_CORES 才先想；拿不到或比較少一律不先想（不顯示小字）
  var PONDER_MIN_TIER = 10, PONDER_MIN_CORES = 4, PONDER_K = 3, PONDER_MIN_WAIT = 300;
  var P = { gen: 0, worker: null, active: null, results: {}, stones: 0, lowBattery: false };

  // 停掉預先思考、丟掉結果。若正式回覆正在等某一步的預先思考（S.pending.waitKey），改送正式請求，不會卡在「電腦在想」
  function cancelPonder() {
    P.gen++;
    P.active = null;
    P.results = {};
    if (P.worker) {
      try { P.worker.terminate(); } catch (e) { /* 已停 */ }
      P.worker = null;
    }
    var pd = S.pending;
    if (S.thinking && pd && pd.waitKey) {
      pd.waitKey = null;
      sendAI(pd);
    }
  }

  function enoughCores() {
    var n = navigator.hardwareConcurrency;
    return typeof n === 'number' && n >= PONDER_MIN_CORES;
  }

  function ponderWanted() {
    return S.mode === 'pve' && tierRank(S.tier) >= tierRank(PONDER_MIN_TIER) && settings.ponder !== false && enoughCores(); // v0.5.13：照先後比
  }

  function maybePonder() {
    // 天元那一批複審：開場字卡播放中還沒開始下，也不先想（字卡播完由 finishCard 叫）
    if (!ponderWanted() || S.over || S.review || S.card || S.turn !== S.human || P.lowBattery || curPage !== 'game' || !workerOK || S.thinking) return;
    cancelPonder();
    var w;
    try { w = new Worker(vurl('ai-worker.js')); } catch (e) { return; }
    P.worker = w;
    P.stones = S.history.length;
    w.onmessage = onPonderMessage;
    w.onerror = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      if (P.worker === w) cancelPonder();
    };
    w.postMessage({ type: 'ponder', gen: P.gen, board: cloneBoard(S.board), player: S.human, level: levelArg(S.tier), rule: S.rule, k: PONDER_K });
  }

  function onPonderMessage(e) {
    var d = e.data;
    if (isHello(d)) return;
    if (!d || d.gen !== P.gen || !d.move) return; // 舊世代
    var key = d.move.r + ',' + d.move.c;
    if (d.type === 'ponderStart') { P.active = { key: key, since: Date.now() }; return; }
    if (d.type !== 'ponderResult') return;
    P.results[key] = d.reply;
    if (P.active && P.active.key === key) P.active = null;
    var pd = S.pending;
    if (S.thinking && pd && pd.waitKey === key) {
      pd.waitKey = null;
      cancelPonder();
      S.aiTimer = setTimeout(function () {
        S.aiTimer = null;
        onAIReply({ data: { id: pd.id, move: d.reply } });
      }, Math.max(0, PONDER_MIN_WAIT - (Date.now() - pd.since)));
    }
  }

  // 電量低（< 20%）又沒在充電時不先想；沒有 getBattery（iOS 等）就永遠當作電量夠
  function watchBattery() {
    if (!navigator.getBattery) return;
    var pr;
    try { pr = Promise.resolve(navigator.getBattery()); } catch (e) { return; }
    pr.then(function (b) {
      function upd() {
        var low = typeof b.level === 'number' && b.level < 0.2 && !b.charging;
        if (low === P.lowBattery) return;
        P.lowBattery = low;
        if (low) cancelPonder();
        else maybePonder();
        if (curPage === 'game' && !S.review) renderOppInfo();
      }
      upd();
      if (b && b.addEventListener) {
        b.addEventListener('levelchange', upd);
        b.addEventListener('chargingchange', upd);
      }
    }, function () { /* 拿不到就當作電量夠 */ });
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
    S.clockSet = myClock(); // 第二十四批：棋鐘設定（目前帳號的；「再來一盤」「重新開始」沿用）
  }

  // preset：開局教學帶進來的前幾手；side：學習頁指定的執子
  function startGame(preset, side) {
    // v0.5.12 複審（規格 AP-1）：還存著一盤沒下完的（開網頁時按了「先留著」）：開新的一盤之前再問一次——不然新的一盤一下子就把它蓋掉，
    // 「先留著」就變成不算輸的放棄。不要了＝照放棄的規則處理完再開新的；接著下＝回那一盤；先留著＝這次不開
    if (!S.live && offerResume(function () { startGame(preset, side); })) return;
    readMenu();
    if (side) S.human = side;
    S.preset = preset || null;
    if (!preset && !side) { settings.last = setupKey(); saveSettings(); }
    recNote = null; // 第十七批（judge 第九輪）：「已經幫你選好…（你 N 分）」只在按完當下有用；開過一盤回來改回一般的「對手 X：N 分」
    showPage('game', true);
    newGame();
  }

  function newGame() {
    cancelAI();
    clearResume(S.gameTs); // v0.5.12（規格 AP-1）：開新的一盤＝上一盤存的不要了（放棄算輸的在 confirmAbandon 已經記好）；只清這個視窗那一盤的
    S.live = true;
    S.recAt = null; // v0.5.12 複審：這盤自己記過的紀錄（at）
    S.preview = null; // 規格 AM：換盤時預覽子清掉、放大還原
    bz.reset(false);
    S.board = G.createBoard();
    S.history = [];
    S.turn = 1;
    S.over = false;
    S.winner = 0;
    S.endReason = null;
    S.forbiddenKind = null;
    S.winCells = null;
    S.forbidCue = null;
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
    S.maxN = S.history.length; // v0.5.11 複審：這盤下到過最多幾手（開局教學擺好的也算）
    clearHalos();
    stopTeach();
    S.halo.seen = {};
    S.lit = 0;
    S.teachShown = false;
    // 天元那一批（規格 AN）：跟天元下的每一盤（含再來一盤）先播開場字卡；播完或點一下跳過才開始下（棋鐘停、電腦不想、棋罐不亮）。
    // 減少動態效果時不出字卡，直接開始；讀屏兩種都念「對手：天元」
    S.card = cardWanted();
    startClock();
    if (S.card) setClockPause('card', true);
    renderOppInfo();
    sayTengen(); // 天元那一批複審：先念「對手：天元」，「換你囉」等它念完才寫（減少動態效果時沒有字卡，兩句會連著念）
    resize();
    refresh();
    if (S.card) { showCard(); return; }
    maybeAI();
    maybePonder();
  }

  function backToMenu() {
    cancelAI();
    dropResume(); // v0.5.12（規格 AP-1）：離開對局頁＝這盤不接著下了（下到一半的已經在 confirmAbandon 處理過）
    showPage('play');
  }

  // 第十四批（W 第 3 條）：下到一半（開局教學擺好的幾手之後有人下過、還沒結束）按「重新開始」「回到選單」先問一次
  function midGame() { return !S.over && S.history.length > S.presetN; }
  // v0.5.11（規格 AO）：放棄這盤。跟電腦下、雙方合計下超過 10 手（GS.ABANDON_FREE；開局教學擺好的幾手也算在盤上的手數裡）＝算你輸
  //（照一般輸棋算分、紀錄標「放棄」）；10 手以內照舊不記（剛開局點錯想重來）。兩人一起下放棄一律不記（同一台裝置分不出是誰按的；
  // 要分輸贏用「認輸」「求和」）。確認框寫清楚這次會不會算輸。會走到這裡的路：「⋯」的「重新開始」「回到選單」——對局頁沒有分頁列，
  // 下到一半只有這兩條路離開；回到選單以後再按「開始下棋／再下一盤」或開局教學，那一盤已經在這裡處理過了
  function confirmAbandon(go) {
    if (!midGame()) { go(); return; }
    // v0.5.11 複審：看這盤「下到過」最多幾手（S.maxN），悔棋退回 10 手以內照樣算輸；框開著時電腦不落子（onAIReply 收著），框裡的字和按下去的結果一致
    var n = S.history.length, max = Math.max(S.maxN || 0, n), lose = GS.abandonIsLoss(S.mode, max);
    var key = S.mode === 'pvp' ? 'game.abandonPvp' : !lose ? 'game.abandonFree' : max > n ? 'game.abandonLossUndone' : 'game.abandonLoss';
    showDialog(t(key, { n: n, max: max, free: GS.ABANDON_FREE }), [
      { label: t(lose ? 'game.abandonYesLoss' : 'game.abandonYes'), primary: true, onClick: function () { abandonGame(lose); go(); } },
      { label: t('game.abandonNo') } // Esc＝最後一個＝繼續下；一開始的焦點也在它
    ], { focusLast: true });
  }
  // 放棄：算輸的照認輸那條路結束（記成 end 'abandon'、照常算分，接著 go 換盤或回選單、結算卡不會停在畫面上）；不算的只把電腦與棋鐘停下
  function abandonGame(lose) {
    if (lose) { endByChoice(3 - S.human, 'abandon'); return; }
    dropResume(); // v0.5.12（規格 AP-1）：不算輸的放棄也清掉存的盤（先清：下面的 clockEv 不會再存回去）
    cancelAI();
    clockEv('stop');
  }
  // v0.5.11（規格 AO）：自己選的結束（認輸、說好和棋、放棄）。棋鐘停（endGame）、電腦與預先思考停、天元字卡收起、分出勝負那一下收掉（cancelAI）、
  // 教學播放與點兩下的預覽子收起、光環與標籤清掉、放大還原；不播分出勝負的那一下（endHoldMs 回 0），直接出結算卡（剛按過確認框，盤面已經看過了）
  function endByChoice(winner, reason) {
    cancelAI();
    stopTeach();
    S.preview = null;
    bz.reset(false);
    clearFlash();
    clearHintFlash();
    clearHalos();
    endGame(winner, reason);
  }

  // v0.5.12（規格 AP-1）：關掉再開能接著下。存的格式見 resumePack。
  // 存：這一盤還在下（S.live）、在對局頁、還沒結束時，每一次狀態變了當下就同步寫一次（下一手、電腦回一手、悔棋、棋鐘的每個事件〔換手、暫停、
  //   接著走：切到背景時也是這一下存到剩下的時間〕、兩人一起下改提示、出現連續逼殺路的標籤）。iOS 主畫面 app 在背景可能直接被收掉、
  //   沒有 unload 事件，所以不靠關掉網頁時才存。開局教學擺好的幾手之後還沒有人下過＝清掉（沒有東西好接著下）。
  // 清：endGame（每一種結束）、不算輸的放棄（abandonGame）、回到選單（backToMenu）、開新的一盤（newGame）、接著下時選「不要了」。
  // v0.5.12 複審：清的時候只清「這個視窗這一盤」（存的 ts 一樣才清）——另一個視窗可能正在下別的盤；
  //   棋鐘在走時每 5 秒也存一次（tickClock），網頁被收掉前（pagehide）再存一次：前景直接被殺掉時最多少算 5 秒
  var RESUME_TICK_MS = 5000, resumeSavedAt = 0;
  function saveResume() {
    if (!S.live || S.over || curPage !== 'game') return;
    if (!midGame()) { clearResume(S.gameTs); return; }
    resumeSavedAt = Date.now();
    try { localStorage.setItem(RESUME_KEY, JSON.stringify(resumePack(S, clockSt(), settings, Date.now()))); } catch (e) { /* 存不下（私密模式、滿了）就算了，下棋不受影響 */ }
  }
  // ts：只在存的是這一盤時才清（不給＝不管是哪一盤都清：壞掉的存檔）
  function clearResume(ts) {
    try {
      if (ts != null) {
        var o = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null');
        if (o && typeof o === 'object' && o.ts !== ts) return;
      }
      localStorage.removeItem(RESUME_KEY);
    } catch (e) { /* 無 */ }
  }
  function dropResume() {
    S.live = false;
    clearResume(S.gameTs);
  }
  // 存的盤面已經分出勝負：一手一手重下，每一手都看有沒有連成五（v0.5.12 複審：不是只看最後一手）；連珠的黑棋下在禁手點
  // （下了就輸＝那一手就結束了；不讓下＝本來就下不到，存檔不對）；最後下滿、或連珠輪到黑棋卻沒有地方下，也是結束了
  function resumeEnded(moves, rule) {
    var b = G.createBoard();
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      if (rule === 'renju' && m.p === 1 && G.isForbidden(b, m.r, m.c)) return true;
      b[m.r][m.c] = m.p;
      if (G.checkWin(b, m.r, m.c, rule)) return true;
    }
    if (G.isFull(b)) return true;
    return rule === 'renju' && moves.length % 2 === 0 && !blackHasLegal(b);
  }
  function readResume() {
    var raw = null;
    try { raw = localStorage.getItem(RESUME_KEY); } catch (e) { return null; }
    if (raw == null) return null;
    var snap = resumeParse(raw, { size: N, maxTier: MAX_TIER, profile: GS.profile, normClock: normClock, normHint: normPvpHint, ended: resumeEnded, clockCfg: clockCfg });
    if (!snap) clearResume(); // 壞掉、舊版本、帳號刪了、階不在了：靜靜丟掉，不記、不說
    return snap;
  }
  // 開網頁時（下棋分頁）有存著下到一半的盤就問一次；開新的一盤之前也問（startGame，after＝不要了以後接著開新的）。回傳有沒有問。
  // 確認框的字寫清楚「不要了」會不會算輸（規格 AO 的放棄：跟電腦下、這盤下到過超過 10 手＝算輸；10 手以內、兩人一起下都不記），
  // 算輸時寫是誰輸（v0.5.12 複審：存的帳號不是現在選的帳號時寫名字），還有這盤上次是什麼時候下的。用現在的語言組字（存的時候不存字）。
  // v0.5.12 複審：三顆［不要了］［先留著］［接著下］。先留著＝關掉這個框、存的不動、不記，下次開網頁（或開新的一盤）再問——
  //   另一個視窗正在下這盤時不用把它放棄掉。焦點在「接著下」（Enter）；Esc＝先留著。「不要了」可能算輸，按錯不能回頭，所以兩個鍵都不是它
  function offerResume(after) {
    var snap = readResume();
    if (!snap) return false;
    var n = snap.moves.length, max = snap.maxN, lose = GS.abandonIsLoss(snap.mode, max), who, then;
    if (snap.mode === 'pvp') {
      var pb = GS.profile(snap.pidB), pw = GS.profile(snap.pidW);
      who = pb.id === pw.id ? t('resume.whoPvpSame') : t('resume.whoPvp', { b: pb.name, w: pw.name });
      then = t('resume.pvp');
    } else {
      who = t('resume.whoPve', { tier: tierName(snap.tier) });
      var pl = GS.profile(snap.pid), other = pl && pl.id !== me().id, sfx = other ? 'Name' : '';
      then = !lose ? t('resume.free', { n: n, free: GS.ABANDON_FREE })
        : max > n ? t('resume.loseUndone' + sfx, { max: max, free: GS.ABANDON_FREE, name: other ? pl.name : '' })
        : t('resume.lose' + sfx, { n: n, free: GS.ABANDON_FREE, name: other ? pl.name : '' });
    }
    var w = resumeWhen(snap.at, Date.now());
    showDialog(t('resume.ask', { who: who, rule: ruleLabel(snap.rule, snap.strict), n: n, when: t(w.key, w.p), then: then }), [
      { label: t('resume.no'), onClick: function () { dropSaved(snap, lose); if (after) after(); } },
      { label: t('resume.later'), esc: true }, // 先留著：什麼都不動
      { label: t('resume.yes'), primary: true, onClick: function () { resumeGame(snap); } } // 一開始的焦點在它（Enter）
    ], { focusLast: true });
    return true;
  }
  // v0.5.12 複審：這盤（同一個 ts）在別的視窗已經結束、記了紀錄（紀錄的 at 不是這個視窗自己記的那一筆）：
  // 這個視窗就不再記、不再算分、不再存，跟玩家說一聲、回選單
  function endedElsewhere() {
    var r = GS.find(S.gameTs);
    return !!r && r.at !== S.recAt;
  }
  function stopElsewhere() {
    S.live = false;
    cancelAI();
    stopTeach();
    clearHalos();
    if (S.clk.cfg) clockEv('stop');
    if ($('game').hidden) return;
    showDialog(t('resume.elsewhere'), [{ label: t('resume.toMenu'), primary: true, onClick: backToMenu }]);
  }
  window.addEventListener('storage', function (e) {
    if ((e.key === GS.KEY || e.key === null) && S.live && !S.over && endedElsewhere()) stopElsewhere();
  });
  window.addEventListener('pagehide', function () { saveResume(); });
  // 把存的盤放回 S（照 newGame 的順序，但不清盤面）：盤面、手數、悔棋（開局教學那幾手照舊不退）、下到過幾手、帳號、棋鐘（從存的剩下時間接著走）、
  // 教學局的記號；光環與標籤重算（refreshHints）；天元的開場字卡不重播
  function loadSnap(snap) {
    cancelAI();
    S.preview = null;
    bz.reset(false);
    S.mode = snap.mode; S.tier = snap.tier; S.rule = snap.rule; S.strict = snap.strict; S.human = snap.human;
    S.pid = snap.pid || me().id; S.pidB = snap.pidB; S.pidW = snap.pidW;
    S.clockSet = snap.clockSet;
    if (snap.mode === 'pvp') { // 兩位的提示、怎麼放（跟著這台裝置的設定）照存的那一刻
      settings.pvpHintB = snap.hintB; settings.pvpHintW = snap.hintW; settings.pvpLay = snap.lay;
      saveSettings();
    }
    S.preset = snap.preset;
    S.board = G.createBoard();
    S.history = [];
    snap.moves.forEach(function (m) { S.board[m.r][m.c] = m.p; S.history.push({ r: m.r, c: m.c, p: m.p }); });
    S.turn = snap.turn;
    S.over = false; S.winner = 0; S.endReason = null; S.forbiddenKind = null; S.winCells = null; S.forbidCue = null;
    S.gameTs = snap.ts; // 紀錄的 ts（去重鍵）、開局日期都和沒關掉時一樣
    S.recAt = snap.recAt; // v0.5.12 複審：這盤自己先前記過的那一筆（下完又悔棋的盤）
    S.recorded = false; S.lastRec = null;
    renderResult();
    clearFlash();
    clearHintFlash();
    S.presetN = snap.presetN;
    S.maxN = snap.maxN;
    clearHalos();
    stopTeach();
    S.halo.seen = {};
    S.lit = 0;
    S.teachShown = snap.teach;
    S.card = false;
    startClock();
    if (S.clk.cfg && snap.clock) S.clk.ev[0] = resumeClockEv(S.clk.cfg, snap.clock, S.turn, S.clk.ev[0].t);
  }
  // 「接著下」：回到對局頁、從存的地方接著下；輪到電腦就重新想，預先思考照原本的條件
  function resumeGame(snap) {
    recNote = null;
    showPage('game', true);
    loadSnap(snap);
    S.live = true;
    renderOppInfo();
    resize();
    refresh();
    saveResume();
    maybeAI();
    maybePonder();
  }
  // 「不要了」＝放棄這盤（規格 AO）：算輸的照「⋯」放棄算輸那條路記（end 'abandon'、照一般輸棋算分一次；同一盤先前下完記過的照舊不再算分）；
  // 不算輸的什麼都不記。都留在下棋分頁
  function dropSaved(snap, lose) {
    clearResume(snap.ts);
    if (!lose) return;
    loadSnap(snap);
    endByChoice(3 - S.human, 'abandon');
    syncMenuInputs(); // 選單上的分數跟著改
  }
  // 「⋯」的「認輸」。跟電腦下＝你認輸。兩人一起下＝輪到的那一方認輸（輪流拿著時手上拿著的就是他；平放時確認框轉向他）：
  // 確認框寫明是誰認輸、誰贏，不用「你」。棋盤上還沒有人下過（開局教學擺好的不算）時按不下去
  function askResign() {
    if (!midGame()) return;
    var pvp = S.mode === 'pvp', loser = pvp ? S.turn : S.human;
    var text = pvp ? t('game.resignAskPvp', seatNames(loser)) : t('game.resignAsk');
    showDialog(text, [
      { label: t('game.resignYes'), primary: true, onClick: function () { if (midGame()) endByChoice(3 - loser, 'resign'); } },
      { label: t('game.abandonNo') }
    ], { flip: pvp && faceTop(loser), focusLast: true });
  }
  // 「⋯」的「求和」（只有兩人一起下）：輪到的那一方提議，確認框問對方（「黑棋（玩家）想求和。白棋（小明）同意嗎？」），
  // 平放時轉向對方；同意＝記成平手（end 'agreed'，照平手算分，同一個帳號照舊不算分），繼續下＝什麼都不變
  function askDraw() {
    if (!midGame() || S.mode !== 'pvp') return;
    var from = S.turn;
    showDialog(t('game.drawAsk', seatNames(from)), [
      { label: t('game.drawYes'), primary: true, onClick: function () { if (midGame()) endByChoice(0, 'agreed'); } },
      { label: t('game.abandonNo') }
    ], { flip: faceTop(3 - from), focusLast: true });
  }
  // 確認框的「誰」：a＝這一方、b＝另一方（顏色＋帳號名字）
  function seatNames(side) {
    var pa = seatProfile(side), pb = seatProfile(3 - side);
    return { a: colorName(side), aName: pa ? pa.name : '', b: colorName(3 - side), bName: pb ? pb.name : '' };
  }
  // 平放在兩人中間時，問的是坐上方（白）的人：確認框轉 180°
  function faceTop(side) { return S.mode === 'pvp' && $('game').classList.contains('lay-flat') && seatSides().top === side; }

  function blackHasLegal(board) {
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) if (!board[r][c] && !G.isForbidden(board, r, c)) return true;
    }
    return false;
  }

  function play(r, c) {
    stopTeach();
    S.preview = null; // 規格 AM
    var p = S.turn;
    S.board[r][c] = p;
    S.history.push({ r: r, c: c, p: p });
    S.maxN = Math.max(S.maxN || 0, S.history.length); // v0.5.11 複審（規格 AO）：這盤下到過最多幾手（悔棋退回 10 手以內，放棄照樣算輸）
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
    clockEv('turn', S.turn); // 第二十四批：棋鐘換邊（每步限時重新倒數）
    refresh();
    saveResume(); // v0.5.12（規格 AP-1）：每下一手（人或電腦）當下就存
    maybeAI();
    maybePonder();
  }

  // 嚴格模式：黑棋下在禁手點，真的落子並判白勝
  function playForbidden(r, c, kind) {
    S.preview = null; // 規格 AM
    S.board[r][c] = 1;
    S.history.push({ r: r, c: c, p: 1 });
    S.maxN = Math.max(S.maxN || 0, S.history.length);
    knock();
    S.forbiddenKind = kind;
    clearFlash();
    clearHintFlash();
    endGame(2, 'forbidden');
  }

  function endGame(winner, reason) {
    // v0.5.12（規格 AP-1）：分出勝負（連成五、禁手、時間用完、和棋、認輸、說好和棋、放棄算輸，都走這裡）先清掉存的盤再記紀錄：
    // 同一個同步流程裡記好，分出勝負那一下的動畫播到一半重新整理也已經記了、不會再問要不要接著下
    dropResume();
    cancelPonder(); // 第二十一批 b：人那一手就分出勝負時，預先思考也停
    if (reason === 'time') cancelAI();
    S.over = true;
    clockEv('stop');
    S.winner = winner;
    S.endReason = reason;
    S.thinking = false;
    if (reason === 'forbidden') {
      var lm = S.history[S.history.length - 1];
      S.forbidCue = { r: lm.r, c: lm.c, lines: forbidLines(S.board, lm) };
    }
    startEndHold(reason); // v0.5.5：先讓人看清楚怎麼分出勝負，結算卡晚一點出來
    refresh();
    recordGame();
  }

  // ---------------------------------------------------------- v0.5.5（作者）：分出勝負的那一下
  // 結算卡不馬上出來，先讓人看清楚怎麼分的：五連＝紅圈一顆一顆描出來、再一條線穿過五顆（約 1.1 秒），1.3 秒後出結算卡；
  // 禁手輸＝那顆子上的紅 × 閃兩下、讓它變成禁手的線畫出來，0.9 秒後；時間用完＝用完那一方的鐘變紅、寫「時間到」閃兩下，0.8 秒後；
  // 和棋（下滿、黑棋沒地方下）＝停 0.6 秒讓最後一手看得到。棋鐘、電腦、預先思考在分出勝負那一刻就停（endGame）。
  // 點棋盤任何地方＝馬上出結算卡；悔棋、換盤、回選單（cancelAI）收掉。減少動態效果時不做動畫：線、×、「時間到」直接畫好，0.6 秒後出結算卡。
  // 讀屏只念一次：等待時結算卡的 aria-live（#resultLines）是空的，結算卡出來時才寫進去。
  // 測試：網址帶 ?test=1&endhold=0 時不等（舊的瀏覽器測試看結算卡內容用；發布版不認）
  var END_HOLD = { five: 1300, forbidden: 900, time: 800, draw: 600 }, END_STILL = 600;
  var END_HOLD_OFF = window.GOMOKU_RELEASE !== true && /[?&]test=1(?:&|$)/.test(location.search) && /[?&]endhold=0(?:&|$)/.test(location.search);
  // v0.5.11（規格 AO）：認輸、說好和棋、放棄是自己按確認框結束的，沒有「怎麼分的」可看：不等，直接出結算卡
  var END_CHOSEN = { resign: 1, agreed: 1, abandon: 1 };
  function endHoldMs(reason) {
    if (END_HOLD_OFF || END_CHOSEN[reason]) return 0;
    if (!motionOK()) return END_STILL;
    return END_HOLD[reason === 'five' || reason === 'forbidden' || reason === 'time' ? reason : 'draw'];
  }
  function startEndHold(reason) {
    stopEndHold();
    var ms = endHoldMs(reason);
    if (!ms) return;
    S.endHold = { reason: reason, t0: performance.now(), ms: ms, timer: setTimeout(releaseEndHold, ms) };
    if (reason === 'time') markTimeUp(3 - S.winner);
  }
  function releaseEndHold() {
    if (!S.endHold) return;
    stopEndHold();
    renderResult();
  }
  function stopEndHold() {
    if (S.endHold) clearTimeout(S.endHold.timer);
    S.endHold = null;
    markTimeUp(0);
  }
  // 時間用完的那一方：座位條的鐘蓋一層紅底「時間到」，閃兩下（side＝0：拿掉）
  function markTimeUp(side) {
    var sd = seatSides();
    [['turnBottom', sd.bottom], ['turnTop', sd.top]].forEach(function (a) {
      var el = $(a[0]), on = !!side && a[1] === side;
      el.classList.toggle('time-up', on);
      if (on) el.setAttribute('data-up', t('clock.timeUp'));
      else el.removeAttribute('data-up');
    });
  }
  // 禁手輸：經過那顆子、讓它變成禁手的線（長連＝6 顆以上的那一串；四四、三三＝經過它能成四或活三的線，照 lineStonesAt 的判法），回傳 [[r1,c1,r2,c2]]
  function forbidLines(board, m) {
    var out = [];
    try {
      // 長連：經過它有 6 顆以上連在一起的那一串（有就只畫這幾條；kind 是 ai.js 給的中文種類，這裡不比字，直接數）
      HALO_DIRS.forEach(function (d) {
        var a = 0, z = 0;
        while (inBoard(m.r - d[0] * (a + 1), m.c - d[1] * (a + 1)) && board[m.r - d[0] * (a + 1)][m.c - d[1] * (a + 1)] === 1) a++;
        while (inBoard(m.r + d[0] * (z + 1), m.c + d[1] * (z + 1)) && board[m.r + d[0] * (z + 1)][m.c + d[1] * (z + 1)] === 1) z++;
        if (a + z + 1 >= 6) out.push([m.r - d[0] * a, m.c - d[1] * a, m.r + d[0] * z, m.c + d[1] * z]);
      });
      if (out.length) return out;
      var b = cloneBoard(board);
      b[m.r][m.c] = 0;
      var st = lineStonesAt(b, m, 1, 'renju');
      HALO_DIRS.forEach(function (d) {
        var ks = st.map(function (x) {
          var dr = x.r - m.r, dc = x.c - m.c;
          if (dr * d[1] !== dc * d[0]) return null;
          var k = d[0] ? dr / d[0] : dc / d[1];
          return Math.abs(k) <= 5 ? k : null;
        }).filter(function (k) { return k != null; });
        if (!ks.length) return;
        var lo = Math.min(0, Math.min.apply(null, ks)), hi = Math.max(0, Math.max.apply(null, ks));
        out.push([m.r + d[0] * lo, m.c + d[1] * lo, m.r + d[0] * hi, m.c + d[1] * hi]);
      });
    } catch (e) { /* 算不出來就只閃那顆子上的 × */ }
    return out;
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
    if (S.over && END_CHOSEN[S.endReason]) return false; // v0.5.11（規格 AO）：認輸、說好和棋、放棄以後不能退（同時間用完：結算卡沒有「退一步」、悔棋灰掉）
    if (S.mode === 'pvp') return true;
    return S.history.slice(S.presetN).some(function (h) { return h.p === S.human; });
  }
  function undo() {
    if (!canUndo()) return;
    stopTeach();
    S.preview = null; // 規格 AM
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
    S.forbidCue = null;
    S.recorded = false;
    S.lastRec = null;
    renderResult();
    S.turn = S.history.length ? 3 - S.history[S.history.length - 1].p : 1;
    clockEv('undo', S.turn); // 第二十四批：悔棋不退時間（每步限時重新倒數）；下完了又悔棋時鐘接著走
    refresh();
    // v0.5.12（規格 AP-1）：悔棋後照樣存（下完了又悔棋＝這盤又在下了；紀錄已經記過的，之後再下完照舊不再算分，看 ts）
    S.live = true;
    saveResume();
    maybeAI();
    maybePonder();
  }

  // ---------------------------------------------------------- 戰績紀錄、積分結算（P）

  function recordGame() {
    if (!S.history.length || S.recorded) return;
    S.recorded = true;
    // v0.5.12 複審（規格 AP-1）：同一盤在別的視窗已經結束、記好了（不是這個視窗記的那一筆）：不記、不算分，跟玩家說一聲。
    // 不然這邊贏了會蓋成「贏」卻帶著那邊放棄時扣的分（結果和分數對不起來）
    if (endedElsewhere()) { stopElsewhere(); return; }
    var result;
    if (S.mode === 'pvp') result = S.winner === 1 ? 'black' : S.winner === 2 ? 'white' : 'draw';
    else result = !S.winner ? 'draw' : S.winner === S.human ? 'win' : 'loss';
    var op = currentOpening();
    var rec = {
      ts: S.gameTs,
      at: Date.now(),
      mode: S.mode,
      tier: S.mode === 'pve' ? S.tier : null,
      // 第二十批 b（judge F7）：這一盤當時電腦的分數（階梯重校正以後，現在的 TIERS 不等於當時的值）。回頭看的對戰條優先用它
      oppRating: S.mode === 'pve' ? aiRating(S.tier) : null,
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
      tierScale: 11, // 「十一階那一套編號」（天元那一批起含階 12、v0.5.13 起含階 13 入門・2，都是接在後面，不用轉；stats.js 的 tierOf）
      pid: S.mode === 'pve' ? S.pid : null,
      pidB: S.mode === 'pvp' ? S.pidB : null,
      pidW: S.mode === 'pvp' ? S.pidW : null,
      elo: null,
      clock: clockRec(S.clk.cfg), // 第二十四批（規格 Z4）：這盤的棋鐘設定（秒；不限時是 null）
      ladder: RECAL_VER,          // 第二十四批：難度 v3 的電腦下的（積分重算告知用：沒有這欄＝這一版以前的紀錄）
      teach: false                // 規格 Z10：教學局（下面結算時定：這盤真的因為教學沒計分才是 true；judge 第十三輪 F4）
    };
    // 每局只結算一次（第一次結束時）；悔棋後重下完，紀錄的結果會換成新的，但積分不再動
    var prev = GS.find(S.gameTs);
    var fresh = !(prev && (prev.elo || prev.eloSkip));
    // 規格 Z10：教學局不計分（第一次結束時判；之後悔棋重下完照舊不再動積分）
    if (fresh) { if (S.teachShown) rec.eloSkip = 'teach'; else settle(rec); }
    else { rec.elo = prev.elo || null; if (prev.eloSkip) rec.eloSkip = prev.eloSkip; }
    rec.teach = rec.eloSkip === 'teach';
    GS.upsert(rec);
    S.recAt = rec.at; // v0.5.12 複審：這個視窗自己記的那一筆（悔棋後再下完時認得是自己的）
    S.lastRec = rec;
    S.lastFresh = fresh;
    S.lastAch = achAfterGame(rec);
    renderResult();
    renderOppInfo();
  }

  // v0.5.17（規格 AV）：這盤記好以後，盤上每個帳號（跟電腦下＝玩家；兩人一起下＝執黑、執白，同一個帳號只算一次）照紀錄補成就。
  // 結算卡那一行只寫「這一盤」讓它成立的（回推的日期＝這一盤的 at），別的（例如另一個視窗下完的盤）照樣記下、不寫在這張卡上。
  // 認輸、說好和棋一樣出結算卡；放棄算輸（「⋯」的放棄、接著下的「不要了」）沒有結算卡，成就照樣記下、不出這一行
  function achAfterGame(rec) {
    var pids = rec.mode === 'pve' ? [rec.pid] : [rec.pidB, rec.pidW], out = [];
    pids.forEach(function (pid, i) {
      if (!pid || pids.indexOf(pid) !== i) return;
      // 練習題、每日一題的成就不是這一盤給的（它們新成立時記「當下」的時間，可能剛好跟 rec.at 同一毫秒），不寫在結算卡上
      GS.achSync(pid, Date.now()).forEach(function (x) { if (x.at === rec.at && !/^(pz|daily)/.test(x.id)) out.push({ id: x.id, pid: pid }); });
    });
    return out;
  }
  // 「拿到成就：第一次贏電腦、連贏 3 盤」；兩人一起下（兩個帳號）在每個成就後面寫是誰：「第一盤下完（玩家、小明）」
  function achText(list, names) {
    var ids = [], who = {};
    list.forEach(function (x) {
      if (!who[x.id]) { who[x.id] = []; ids.push(x.id); }
      var p = GS.profile(x.pid);
      if (p && who[x.id].indexOf(p.name) < 0) who[x.id].push(p.name);
    });
    GS.ACH.forEach(function (id) { if (ids.indexOf(id) >= 0) ids.push(ids.splice(ids.indexOf(id), 1)[0]); }); // 照紀錄頁的順序
    return t('ach.earned', { n: ids.length, list: ids.map(function (id) {
      return names ? t('ach.who', { title: t('ach.' + id), names: who[id].join(t('list.sep')) }) : t('ach.' + id);
    }).join(t('list.sep')) });
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
    // 天元那一批：已經是最強的對手（天元）就沒有「換強一點的對手」可說，不提示
    if (rec.result === 'win' && k >= 5) return rec.tier === TOP_TIER ? null : 'elo.hintUp'; // v0.5.13：MAX_TIER 是 13（入門・2），改看 TOP_TIER
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
  // 第十七批（judge 第九輪）：兩人一起下時徽章升降那兩行也一起摺（兩人都長名又同時換徽章，667 放不下）
  // 第二十四批（規格 Z）：結算卡浮在棋盤上（對照稿畫面 6）：標題＝這盤的結果（每盤限時用完＝「時間用完了」），下面照舊；
  // 卡片超出視窗時小字摺進「看詳細」。每盤限時用完的不給「退一步」（悔棋不退時間，退了馬上又是用完）
  // 規格 AN：「贏的機會大約六成」——機率 × 10 四捨五入、夾在 1～9（不說零成、十成）；中文用國字，英文用數字（about 6 in 10）。
  // 1～9 的寫法在字典 elo.chanceDigits（中文國字、英文阿拉伯數字），程式檔不放中文
  // 天元那一批（用字複審）：機率不是有限的數字（舊紀錄、rating.js 回的形狀不對）時回 null，呼叫的地方不寫「機會大約幾成」那句（不編一個「一成」）
  function chanceTenths(p) {
    if (typeof p !== 'number' || !isFinite(p)) return null;
    var n = Math.max(1, Math.min(9, Math.round(p * 10)));
    return Array.from(t('elo.chanceDigits'))[n - 1] || String(n);
  }
  function renderResult() {
    var box = $('resultBox'), rec = S.lastRec;
    box.hidden = !S.over || !!S.review || !!S.endHold;
    if (box.hidden && !$('rsShareMsg').hidden) { $('rsShareMsg').hidden = true; $('rsShareMsg').textContent = ''; } // v0.5.19（規格 AW）：分享的小字跟著收
    if (S.endHold) { $('resultLines').textContent = ''; return; } // v0.5.5：分出勝負的那一下還沒播完（讀屏等結算卡出來才念）
    $('rsUndo').hidden = !canUndo() || S.endReason === 'time';
    $('rsSwap').hidden = S.mode !== 'pvp'; // v0.5.10（規格 AT）：「換邊再下一盤」只在兩人一起下
    $('resultTitle').textContent = !S.over ? '' : S.endReason === 'time' ? t('result.timeUp')
      : endText({ end: S.endReason, forbidden: S.forbiddenKind, winner: S.winner, mode: S.mode, human: S.human, tier: S.tier });
    // 規格 AK：黑棋下到禁手輸的標題，禁手的種類可以點（開名詞對照表）
    if (S.over && S.endReason === 'forbidden') {
      $('resultTitle').textContent = '';
      $('resultTitle').appendChild(I.node('status.forbiddenLoss', { kind: I.forbiddenTerm(S.forbiddenKind) }));
    }
    // 天元那一批（規格 AC 第 5 條、AN）：打贏天元＝金色版——外圈細金框、標題「你贏了天元！」放在黑漆帶上（天元用書法字），後面一顆小金點。
    // 下面的分數與按鈕照舊、不會動；輸了和平常一樣
    var tgWin = S.over && S.mode === 'pve' && S.tier === TENGEN_TIER && S.winner === S.human;
    box.classList.toggle('tg-win', tgWin);
    if (tgWin) {
      var title = $('resultTitle'), parts = t('result.tgWin').split('{tg}'), ln = mk('span', 'tg-line');
      title.textContent = '';
      if (I.getLang() === 'en') ln.appendChild(mk('b', 'tg-t', t('result.tgWin', { tg: tierName(TENGEN_TIER) }))); // 英文整句一段字（字間的空白才不會被吃掉）
      else parts.forEach(function (p, i) {
        if (i) ln.appendChild(tgMark());
        if (p) ln.appendChild(mk('b', 'tg-t', p));
      });
      title.appendChild(ln);
      var star = mk('i', 'tg-star');
      star.setAttribute('aria-hidden', 'true');
      title.appendChild(star);
    }
    fillResult(rec, false);
    if (!box.hidden && rec) {
      var r = box.getBoundingClientRect();
      if (r.bottom > window.innerHeight + 0.5 || r.top < -0.5) fillResult(rec, true);
    }
  }
  function fillResult(rec, fold) {
    var lines = $('resultLines'), det = null;
    lines.textContent = '';
    if (rec && !S.review) {
      // canFold：兩人一起下的徽章行（第十七批，judge 第九輪：兩人都 12 字長名又同時換徽章時 667 放不下）
      var line = function (text, cls, canFold) {
        var d = mk('div', 'rs-line' + (cls ? ' ' + cls : ''), text);
        if (fold && (cls === 'rs-small' || canFold)) {
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
        var el = line(t((up ? 'elo.up' : 'elo.down') + (who ? 'Who' : ''), { who: who, from: from, to: to }), up ? 'badge-up' : 'badge-down', !!who);
        if (up && S.lastFresh) el.appendChild(mk('span', 'badge big b-' + x.badgeAfter, to));
      };
      var d;
      if (rec.mode === 'pve') {
        var x = rec.elo && rec.elo[rec.pid];
        if (x) {
          d = Math.round(x.after) - Math.round(x.before);
          line(d > 0 ? t('elo.mainUp', { n: d }) : d < 0 ? t('elo.mainDown', { n: -d }) : t('elo.mainSame'), 'rs-main');
          var ch = chanceTenths(x.exp);
          line(t(ch == null ? 'elo.detailOpp' : 'elo.detail', { tier: tierName(rec.tier), opp: Math.round(x.opp), exp: Math.round(100 * x.exp), chance: ch }), 'rs-small');
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
          var ch2 = chanceTenths(y.exp);
          if (ch2 != null) line(t('elo.pvpExp', { who: who, exp: Math.round(100 * y.exp), chance: ch2 }), 'rs-small');
          if (y.games < 10) early.push(who);
          badgeLine(y, who);
        });
        // 兩人都還在前 10 盤：「你們」；只有一人：寫出是誰
        if (early.length) line(early.length > 1 ? t('elo.earlyBoth') : t('elo.earlyWho', { who: early[0] }), 'rs-small');
      }
      if (!S.lastFresh && rec.elo) line(t('elo.already'), 'muted');
      if (rec.eloSkip === 'teach') line(t('result.teach'), 'rs-teach');
      // judge 第十三輪 F4：第一次下完已經算過分、悔棋後才出現逼殺路的標籤：說明分數不再改
      else if (!S.lastFresh && S.teachShown && rec.elo) line(t('result.teachLate'), 'rs-teach');
      // 第二十四批（規格 Z4）：每盤限時用完寫是誰的時間用完；有棋鐘就寫這盤的棋鐘設定
      if (rec.end === 'time') line(t('result.timeLine', { loser: colorName(3 - S.winner), winner: colorName(S.winner) }), 'rs-time');
      if (rec.clock) line(t('result.clock', { v: clockLabel(cfgFromRec(rec.clock)) }), 'rs-small');
      // v0.5.17（規格 AV）：這一盤拿到的成就，一行小字放最下面（不摺進「看詳細」、不另跳框）；跟著結算卡的 aria-live 念一次
      if (S.lastAch && S.lastAch.length) line(achText(S.lastAch, rec.mode === 'pvp' && rec.pidB !== rec.pidW), 'rs-ach');
    }
    if (det) lines.appendChild(det);
  }

  // ---------------------------------------------------------- 分享成圖片（v0.5.19，規格 AW）
  // v0.5.19（規格 AW）：結算卡與回頭看的「分享圖片」。離屏畫一張直式、1080 寬的 PNG：上方一行結果（「黑棋贏了・玩家 對 電腦 中・1・連珠規則・31 手」，
  // 太寬就在「・」處換行；回頭看多一行「回頭看・第 12 步」）、棋盤（同一個 BoardView 畫：照目前的棋盤風格與手數開關，勝負線、禁手輸的線與 × 照畫）、
  // 下方小字 app 名稱與網址。深色模式也用淺色紙底（圖片拿到哪裡看都清楚）。不放積分變化；名字照畫面上的帳號名，太長的刪成「…」。
  // 使用者動作：iOS Safari 要在點擊的那一下（transient activation）裡叫 navigator.share()，中間隔了非同步（toBlob、fetch、await）可能被擋
  // （NotAllowedError）。所以圖片在點擊的當下同步做好：畫 canvas → toDataURL → 同步轉成 Blob、File → canShare → share，中間沒有任何非同步，
  // 也不用事先做好放著（不會拿到換了風格、手數、語言之前的舊圖）。沒有系統分享（或不能分享檔案）就直接下載 PNG（gomoku-YYYYMMDD-HHMM.png）；
  // 使用者取消（AbortError）不出字；其他錯誤改成下載，再出一行小字
  var SHARE_W = 1080, SHARE_PAD = 64, SHARE_BOARD = SHARE_W - 2 * SHARE_PAD, SHARE_BOARD_CSS = 340; // 棋盤 952 px＝340 CSS px × 2.8（像手機上的畫法）
  var SHARE_NAME_W = 320;                                     // 一個名字最寬幾 px（結果那一行的字級，約 7 個中文字），再長就刪成「…」：兩個長名字＋「黑棋贏了・」仍是一行
  var SHARE_URL = 'https://ianyclin.github.io/gomoku/';
  var SHARE_INK = { bg: '#f5f0e6', ink: '#2b2118', ink2: '#5b4d3f' }; // style.css :root 淺色的 --bg、--ink、--ink-2（深色模式也用這一組）
  var shareMsgTimer = null, shareLog = [];                     // shareLog：測試讀（每一次按下去走了哪一條路）

  // 字型用 style.css 的 --font-body／--font-title 同一串（canvas 沒有繼承 CSS，iOS 要寫出 PingFang 這類名字中文才是同一個字型）。
  // 字串 canvas 不認時（ctx.font 沒換成這個大小）退回 sans-serif
  function shareFont(ctx, weight, px, cssVar) {
    var fam = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim() || 'sans-serif';
    ctx.font = weight + ' ' + px + 'px ' + fam;
    if (ctx.font.indexOf(px + 'px') < 0) ctx.font = weight + ' ' + px + 'px sans-serif';
    return ctx.font;
  }
  function shareFit(ctx, s, maxW) {
    s = String(s || '');
    if (ctx.measureText(s).width <= maxW) return s;
    var ch = Array.from(s);
    while (ch.length > 1 && ctx.measureText(ch.join('') + '…').width > maxW) ch.pop();
    return ch.join('').replace(/\s+$/, '') + '…';
  }
  // 一段一段接成行（分隔號留在行尾）；一段自己就放不下時，英文照空白拆、中文一個字一個字拆
  function shareWrap(ctx, parts, sep, maxW) {
    var lines = [], cur = '', wd = function (s) { return ctx.measureText(s.replace(/\s+$/, '')).width; };
    parts.forEach(function (p, i) {
      var s = i < parts.length - 1 ? p + sep : p;
      if (wd(cur + s) <= maxW) { cur += s; return; }
      if (cur) { lines.push(cur); cur = ''; }
      if (wd(s) <= maxW) { cur = s; return; }
      (/\s/.test(p) ? s.match(/\S+\s*|\s+/g) : Array.from(s)).forEach(function (tk) {
        if (cur && wd(cur + tk) > maxW) { lines.push(cur); cur = ''; }
        cur += tk;
      });
    });
    if (cur) lines.push(cur);
    return lines.map(function (l) { return l.replace(/\s+$/, ''); });
  }
  // 結果：連成五寫「黑棋贏了」；其他照結算卡標題（endText），但一律用黑棋、白棋說（圖片給別人看，「你」不知道是誰）
  function shareResult(info) {
    if (!info.over) return null;
    var w = info.winner;
    if (w && (!info.end || info.end === 'five')) return t('share.won', { color: colorName(w) });
    if (info.end === 'abandon' && w) return t('share.abandon', { loser: colorName(3 - w), winner: colorName(w) });
    return endText({ end: info.end, forbidden: info.forbidden, winner: w, mode: 'pvp', human: info.human, tier: info.tier });
  }
  // 名字照畫面上的（renderOppInfo）：兩人一起下＝黑、白兩位的帳號名（帳號刪了寫黑、白）；跟電腦下＝玩家的帳號名（回頭看是現在的帳號）
  function shareNames(info, review) {
    if (info.mode === 'pvp') {
      var pb = GS.profile(info.pidB), pw = GS.profile(info.pidW);
      return { b: pb ? pb.name : colorName(1), w: pw ? pw.name : colorName(2) };
    }
    var p = (review ? null : GS.profile(S.pid)) || me();
    return { name: p ? p.name : '' };
  }
  // 要分享的是哪一盤、哪個盤面：回頭看＝目前這一步（review.js 的 shareView）；結算卡＝這盤下完的盤面（同對局的棋盤，不畫光環、標籤、預覽）
  function shareSource() {
    var R = S.review ? RV.state() : null;
    if (R) return { info: R.info, view: RV.shareView(), n: R.n, total: R.N, review: true };
    return { info: gameInfoFromState(), total: S.history.length, review: false, view: {
      board: S.board, last: S.history.length ? S.history[S.history.length - 1] : null, winCells: S.winCells,
      endForbid: S.over && S.endReason === 'forbidden' ? S.forbidCue : null, nums: settings.numsGame ? S.history : null } };
  }
  function shareBoardCanvas(view) {
    var c = document.createElement('canvas'), b = BoardView(c, { dpr: SHARE_BOARD / SHARE_BOARD_CSS, still: true });
    b.setSize(SHARE_BOARD_CSS);
    b.draw(view);
    return c;
  }
  function shareImage(src) {
    src = src || shareSource();
    var info = src.info, cv = document.createElement('canvas'), ctx = cv.getContext('2d'), sep = t('game.infoSep');
    var LH = 56, SUB_LH = 44, GAP = 28, FOOT_GAP = 36, FOOT_LH = 40, PAD_B = 48;
    var font = shareFont(ctx, 700, 36, '--font-body'), nm = shareNames(info, src.review), names;
    if (info.mode === 'pvp') names = { b: shareFit(ctx, nm.b, SHARE_NAME_W), w: shareFit(ctx, nm.w, SHARE_NAME_W) };
    else names = { name: shareFit(ctx, nm.name, SHARE_NAME_W) };
    var parts = [shareResult(info),
      info.mode === 'pvp' ? t('share.pvp', names) : t('share.pve', { name: names.name, color: colorName(info.human === 2 ? 2 : 1), tier: tierName(info.tier) }),
      t(info.rule === 'renju' ? 'rule.renju' : 'rule.free'), t('share.moves', { n: src.total })].filter(Boolean);
    var lines = shareWrap(ctx, parts, sep, SHARE_BOARD);
    var sub = src.review ? (src.n ? t('share.review', { n: src.n }) : t('share.reviewStart')) : null;
    var by = SHARE_PAD + lines.length * LH + (sub ? SUB_LH : 0) + GAP, H = by + SHARE_BOARD + FOOT_GAP + FOOT_LH + PAD_B;
    cv.width = SHARE_W;
    cv.height = H;
    ctx.fillStyle = SHARE_INK.bg;
    ctx.fillRect(0, 0, SHARE_W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = SHARE_INK.ink;
    shareFont(ctx, 700, 36, '--font-body');
    lines.forEach(function (l, i) { ctx.fillText(l, SHARE_W / 2, SHARE_PAD + LH * i + LH / 2, SHARE_BOARD); });
    if (sub) {
      ctx.fillStyle = SHARE_INK.ink2;
      shareFont(ctx, 600, 30, '--font-body');
      ctx.fillText(sub, SHARE_W / 2, SHARE_PAD + lines.length * LH + SUB_LH / 2, SHARE_BOARD);
    }
    // 棋盤：先畫一塊同大小的底帶一點陰影（同對局棋盤的 --sh-board），再把離屏畫好的棋盤原樣貼上（整數位置、不縮放）
    var bc = shareBoardCanvas(src.view);
    ctx.save();
    ctx.shadowColor = 'rgba(43, 33, 24, .2)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = SHARE_INK.bg;
    ctx.fillRect(SHARE_PAD, by, SHARE_BOARD, SHARE_BOARD);
    ctx.restore();
    ctx.drawImage(bc, SHARE_PAD, by);
    var foot = t('app.title') + sep + SHARE_URL;
    ctx.fillStyle = SHARE_INK.ink2;
    shareFont(ctx, 600, 26, '--font-body');
    ctx.fillText(foot, SHARE_W / 2, by + SHARE_BOARD + FOOT_GAP + FOOT_LH / 2, SHARE_BOARD);
    return { canvas: cv, meta: { w: SHARE_W, h: H, board: { x: SHARE_PAD, y: by, size: SHARE_BOARD, css: SHARE_BOARD_CSS }, lines: lines,
      text: parts.join(sep), parts: parts, sub: sub, foot: foot, names: names, font: font, review: !!src.review, view: src.view } };
  }
  function shareFileName(d) {
    var p = function (x) { return String(x).padStart(2, '0'); };
    return 'gomoku-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + '.png';
  }
  // data:image/png;base64,… → Blob（同步；不用 toBlob、fetch，點擊的那一下不會斷掉）
  function shareBlob(url) {
    var bin = atob(url.slice(url.indexOf(',') + 1)), n = bin.length, u8 = new Uint8Array(n);
    for (var i = 0; i < n; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: 'image/png' });
  }
  function shareDownload(blob, name) {
    var a = document.createElement('a'), u = URL.createObjectURL(blob);
    a.href = u;
    a.download = name;
    a.rel = 'noopener';
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
  }
  // 小字：回頭看寫在按鈕列下面（同「已複製棋譜」）；結算卡寫在小鈕那一排下面（#rsShareMsg，5 秒後收起；結算卡收起時也收）
  function shareMsg(text) {
    if (S.review) { RV.note(text); return; }
    var el = $('rsShareMsg');
    el.textContent = text;
    el.hidden = false;
    if (shareMsgTimer) clearTimeout(shareMsgTimer);
    shareMsgTimer = setTimeout(function () { shareMsgTimer = null; el.hidden = true; el.textContent = ''; }, 5000);
  }
  function shareNow() {
    var name = shareFileName(new Date()), blob, file = null, can = false, p;
    try { blob = shareBlob(shareImage().canvas.toDataURL('image/png')); } catch (e) { shareLog.push({ path: 'fail', err: String(e) }); shareMsg(t('share.fail')); return; }
    try { file = new File([blob], name, { type: 'image/png' }); } catch (e) { file = null; }
    try { can = !!(file && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })); } catch (e) { can = false; }
    if (!can) { shareLog.push({ path: 'download', name: name }); shareDownload(blob, name); return; }
    shareLog.push({ path: 'share', name: name });
    try { p = navigator.share({ files: [file], title: t('app.title') }); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(function () { shareLog.push({ path: 'shared' }); }, function (err) {
      if (err && err.name === 'AbortError') { shareLog.push({ path: 'abort' }); return; } // 使用者自己取消：不算錯、不出字
      shareLog.push({ path: 'error-download', name: name, err: err && err.name });
      shareDownload(blob, name);
      shareMsg(t('share.fallback'));
    });
  }

  // 換階（推薦對手用）：寫進目前帳號的 pref、選單跟著改
  function setTier(tier) {
    cancelPonder(); // 第二十一批 b：換階＝舊階算的回應不能用
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
    $('flashTip').hidden = true;
  }

  // 狀態列閃一句話 1.5 秒。第二十四批：對局頁沒有狀態行，改浮在棋盤上緣（#flashTip，role=status）
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
    if (g.end === 'time') return t('status.timeLoss', { loser: colorName(3 - g.winner), winner: colorName(g.winner) });
    if (g.end === 'blackStuck') return t('status.blackStuck');
    if (g.end === 'forbidden') return t('status.forbiddenLoss', { kind: forbiddenName(g.forbidden) });
    // v0.5.11（規格 AO）：認輸、說好和棋、放棄（結算卡標題、回頭看的狀態行、棋譜都用這一句）
    if (g.end === 'agreed') return t('status.agreed');
    if (g.end === 'resign' && g.winner) {
      return g.mode === 'pvp' ? t('status.resignColor', { loser: colorName(3 - g.winner), winner: colorName(g.winner) }) : t('status.resignYou', { tier: tierName(g.tier) });
    }
    if (g.end === 'abandon' && g.winner && g.mode !== 'pvp') return t('status.abandonYou', { tier: tierName(g.tier) });
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
    lightVs(); // 第十八批：對戰條跟著輪到誰亮
    // 第二十四批：對局頁沒有狀態行——輪到誰看棋罐與棋鐘的位置（renderSeats）；閃一句話浮在棋盤上緣
    var ft = $('flashTip');
    ft.hidden = !(S.flash && !S.over);
    if (!ft.hidden) ft.textContent = S.flash;
    renderSeats();
    $('undoBtn').disabled = !canUndo() || S.endReason === 'time';
    // 第十四批（W 第 12 條）：跟電腦下時，「回頭看這盤」要等這盤下完（灰掉、小字「下完才能看」）；兩人一起下隨時可以
    var early = S.mode === 'pve' && !S.over;
    $('reviewBtn').disabled = !S.history.length || early;
    $('reviewNote').hidden = !early;
    // v0.5.11（規格 AO）：「⋯」的「認輸」（兩種對手都有）與「求和」（只有兩人一起下）；下完了不出現，還沒有人下過時灰掉
    $('resignBtn').hidden = $('endBtns').hidden = S.over;
    $('drawBtn').hidden = S.over || S.mode !== 'pvp';
    $('resignBtn').disabled = $('drawBtn').disabled = !midGame();
  }
  function canReview() { return S.history.length > 0 && (S.mode === 'pvp' || S.over); }

  // K：對局畫面固定一條對手資訊。
  // 第十八批（主線追加）：改成「對戰條」——左右各一張小卡（表情或電腦圖示、名字、徽章小章、分數），中間一黑一白兩顆小子表示各自執哪色
  // （黑子靠執黑那一側）；輪到誰，那張卡亮起（wood 邊框＋凸起）、另一張淡下去（lightVs）。規則是對戰條下方居中的小膠囊。
  // 跟電腦下：左＝玩家帳號、右＝電腦（第一行「電腦」，第二行級數＋電腦的分數，和左卡的「徽章＋分數」同一個位置——
  // 英文「Computer Medium 4」一行要 132px，375 寬一張卡只放得下約 110px）；兩人一起下：左＝執黑、右＝執白的帳號。
  // 回頭看（有 info）用同一個元件、不亮燈；不寫徽章與分數（帳號現在的值不是當時的；電腦的分數是固定的，照寫）。
  var COMPUTER_FACE = '\uD83D\uDCBB'; // 💻
  function vsCard(color, face, name, badge, rating, tier) {
    var c = mk('div', 'vs-card');
    c.setAttribute('data-color', String(color));
    var f = mk('span', 'vs-face', face || (name ? name.charAt(0) : ''));
    f.setAttribute('aria-hidden', 'true');
    if (!face) f.classList.add('initial');
    c.appendChild(f);
    var tx = mk('span', 'vs-text');
    tx.appendChild(mk('span', 'vs-name', name));
    if (badge || rating != null || tier) {
      var meta = mk('span', 'vs-meta');
      if (badge) meta.appendChild(mk('span', 'badge vs-badge b-' + badge, badgeName(badge)));
      if (tier) meta.appendChild(mk('span', 'vs-tier', tier));
      if (rating != null) meta.appendChild(mk('span', 'vs-rating', String(Math.round(rating))));
      tx.appendChild(meta);
    }
    c.appendChild(tx);
    return c;
  }
  function renderOppInfo(info) {
    var box = $('oppInfo');
    box.textContent = '';
    var src = info || S, review = !!info, cards, mid;
    if (src.mode === 'pvp') {
      var pb = GS.profile(review ? info.pidB : S.pidB), pw = GS.profile(review ? info.pidW : S.pidW);
      var nb = pb ? pb.name : colorName(1), nw = pw ? pw.name : colorName(2);
      cards = [
        vsCard(1, pb ? pb.emoji : '', nb, pb && !review ? badgeOf(pb) : null, pb && !review ? pb.rating : null),
        vsCard(2, pw ? pw.emoji : '', nw, pw && !review ? badgeOf(pw) : null, pw && !review ? pw.rating : null)
      ];
      mid = t('info.pvpPlayers', { b: nb, w: nw });
    } else {
      // 第二十批 b（F7）：回頭看用紀錄存的當時分數，舊紀錄沒有才用現在的 TIERS
      var human = src.human === 2 ? 2 : 1, p = (review ? null : GS.profile(S.pid)) || me();
      var opp = review && typeof info.oppRating === 'number' ? info.oppRating : aiRating(src.tier);
      cards = [
        vsCard(human, p ? p.emoji : '', p ? p.name : '', p && !review ? badgeOf(p) : null, p && !review ? p.rating : null),
        vsCard(3 - human, COMPUTER_FACE, t('info.computer'), null, opp, tierName(src.tier))
      ];
      cards[1].classList.add('ai');
      mid = t(human === 2 ? 'info.youWhite' : 'info.youBlack');
    }
    cards[1].classList.add('right');
    var bar = mk('div', 'vs');
    var stones = mk('span', 'vs-mid');
    stones.setAttribute('role', 'img');
    stones.setAttribute('aria-label', mid);
    var leftColor = +cards[0].getAttribute('data-color');
    stones.appendChild(mk('span', 'vs-stone ' + (leftColor === 1 ? 'b' : 'w')));
    stones.appendChild(mk('span', 'vs-stone ' + (leftColor === 1 ? 'w' : 'b')));
    bar.appendChild(cards[0]); bar.appendChild(stones); bar.appendChild(cards[1]);
    box.appendChild(bar);
    var rule = mk('div', 'vs-rule');
    // 第二十四批：回頭看時規則膠囊後面接這盤的棋鐘設定（紀錄存的 clock；不限時不寫）
    var clk = review && info.clock ? cfgFromRec(info.clock) : null;
    rule.appendChild(mk('span', 'vs-pill', ruleLabel(src.rule, src.strict) + (clk ? t('game.infoSep') + clockLabel(clk) : '')
      + (review && info.teach ? t('game.infoSep') + t('game.teachTag') : '')));
    box.appendChild(rule);
    // 第二十一批 b（規格 T2）：電量低而沒有先想時，膠囊下面多一行小字（只在原本會先想的對局：跟電腦下、強・2 以上、開關開著、核心 ≥ 4）
    if (!review && P.lowBattery && ponderWanted()) box.appendChild(mk('div', 'vs-note', t('info.lowBattery')));
    lightVs();
    if (!review) { renderSeats(); renderGameInfo(); } // 第二十四批：對局頁用座位條與棋盤下那一行小字
  }
  // 輪到誰亮誰（對局中、還沒下完）；下完、回頭看都不亮燈
  function lightVs() {
    var lit = S.review || S.over ? 0 : S.turn;
    [].forEach.call($('oppInfo').querySelectorAll('.vs-card'), function (c) {
      var col = +c.getAttribute('data-color');
      c.classList.toggle('on', !!lit && col === lit);
      c.classList.toggle('off', !!lit && col !== lit);
    });
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
  // v0.5.18（規格 AQ）：同 detectOpening，多這盤的方向 sym（ai.js detectOpeningSym；開局介紹的小棋盤照這個方向畫）。舊的 ai.js 沒有時方向當成標準方向
  function detectOpeningSym(moves) {
    var op = detectOpening(moves);
    if (!op) return null;
    var hit = null;
    try { hit = G.detectOpeningSym ? G.detectOpeningSym(moves.slice(0, 3).map(function (m) { return { r: m.r, c: m.c }; })) : null; }
    catch (e) { hit = null; }
    return { code: op.code, name: op.name, sym: hit && hit.code === op.code ? hit.sym : 0 };
  }
  // v0.5.18（規格 AQ）：開局名稱按鈕（[[opening:名字]]）帶上「是哪一個開局、這盤的方向、這盤的規則」，點了開這個開局的介紹（openOpeningSheet）。
  // rule 沒給（開局列表）＝點的時候看選單的規則
  function openingTerm(key, op, sym, rule) {
    var frag = I.node(key, { name: '[[opening:' + openingName(op) + ']]', code: op.code });
    var b = frag.querySelector ? frag.querySelector('button.term') : null;
    if (b) {
      b.setAttribute('data-op', op.code);
      b.setAttribute('data-op-sym', String(sym || 0));
      if (rule) b.setAttribute('data-op-rule', rule === 'renju' ? 'renju' : 'free');
    }
    return frag;
  }
  // v0.5.18（規格 AQ）：回頭看狀態行下面那一行「開局：浦月」（名稱可以點）；不是 26 種之一就空白
  function setOpeningStatus(moves, rule) {
    var el = $('subStatus'), op = detectOpeningSym(moves || []);
    el.textContent = '';
    if (op) el.appendChild(openingTerm('opening.label', op, op.sym, rule));
  }

  function updateSubStatus() {
    if (S.review) return;
    var op = currentOpening();
    $('subStatus').textContent = op ? openingLabel(op) : '';
    renderGameInfo();
  }
  // 第二十四批（規格 Z2）：棋盤正下方一行小字「自由規則・開局 水月（I4）」（兩人一起下也只放這一行，不轉）；
  // 電量低而沒有先想時接在後面（原本在對戰條規則膠囊下面）
  // 規格 AK：開局名稱可以點（開名詞對照表「開局名稱」）
  // v0.5.18（規格 AQ）：改成打開這個開局的介紹（照這盤的方向與規則）
  function renderGameInfo() {
    var op = detectOpeningSym(S.history), parts = [ruleLabel(S.rule, S.strict)];
    if (op) parts.push(t('game.opening', { name: openingName(op), code: op.code }));
    if (P.lowBattery && ponderWanted()) parts.push(t('info.lowBattery'));
    var el = $('gameInfo'), txt = parts.join(t('game.infoSep'));
    el.textContent = '';
    parts.forEach(function (p, i) {
      if (i) el.appendChild(document.createTextNode(t('game.infoSep')));
      if (op && i === 1) el.appendChild(openingTerm('game.opening', op, op.sym, S.rule));
      else el.appendChild(document.createTextNode(p));
    });
    el.title = txt;
  }

  // ---------------------------------------------------------- B：威脅提醒（棋盤外文字）

  function clearHintFlash() {
    if (S.hintFlashTimer) clearTimeout(S.hintFlashTimer);
    S.hintFlashTimer = null;
    S.hintFlash = null;
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
    return !S.review && !$('game').hidden;
  }

  // 規格 Z9 第 4 條（作者 2026-10-01）：兩種提示在哪些對手下出現。
  //   威脅提醒（hints，預設開）：入門～強・2、兩人一起下照開關；最強（階 11）與天元（階 12）一律不提供（開關無效；noHintTier）。
  //   提示我的機會（ownRoad 三態）：null＝入門～中・4 開、強・1／強・2 關、兩人一起下關；true＝入門～強・2 與兩人一起下都出現；
  //   false＝都不出現；最強、天元一律不提供。mode／tier 不給時看這一盤（S），選單與「我」分頁給目前選的對手
  // 規格 AL：兩人一起下時改看「那位玩家」自己選的提示（side 不給時＝這一盤輪到的那一方）。v0.5.5（作者拍板）：四選一——
  //   危險＝危險提醒、機會＝機會提示、危險＋機會＝兩種都有（教學也只有這一種，而且「我」分頁的教學開關要開著）、關＝什麼都沒有。
  //   「我」分頁的「危險提醒」「機會提示」兩個開關不管兩人一起下
  function pvpHintFor(side) { return side === 1 ? settings.pvpHintB : side === 2 ? settings.pvpHintW : 'off'; }
  function hintsOn(mode, tier, side) {
    mode = mode || S.mode; tier = tier || S.tier;
    if (mode === 'pvp') { var h = pvpHintFor(side || S.turn); return h === 'danger' || h === 'both'; }
    return settings.hints && !(mode === 'pve' && noHintTier(tier));
  }
  function ownRoadOn(mode, tier, side) {
    mode = mode || S.mode; tier = tier || S.tier;
    if (mode === 'pve' && noHintTier(tier)) return false;
    if (mode === 'pvp') { var h = pvpHintFor(side || S.turn); return h === 'chance' || h === 'both'; }
    if (settings.ownRoad === true) return true;
    if (settings.ownRoad === false) return false;
    return mode === 'pve' && tierRank(tier) >= 0 && tierRank(tier) <= tierRank(8); // v0.5.13：入門～中・4 照先後比（含階 13 入門・2）
  }

  // 規格 Z10：「教學：顯示連續逼殺路」只在兩個提示開關當下都生效時有作用（最強已經被 hintsOn 排除）
  // v0.5.5：兩人一起下＝那位玩家選「危險＋機會」而且教學開關開著
  function teachOn(mode, tier, side) {
    if ((mode || S.mode) === 'pvp') return settings.teach === true && pvpHintFor(side || S.turn) === 'both';
    return settings.teach === true && hintsOn(mode, tier, side) && ownRoadOn(mode, tier, side);
  }

  // 第二十四批（規格 Z8、Z9）：提醒句只給讀屏（#hints 一律 sr-only、aria-live），畫面上是光環與懸浮標籤。
  // 對手那邊（威脅提醒）：跟電腦下兩邊都要看——電腦在想時也重算一次，人擋掉的威脅馬上收掉光環；句子只在人的回合念。
  // 自己那邊（提示我的機會）：只在提醒對象的回合。兩人一起下：提醒對象＝輪到的那一方
  function refreshHints() {
    var box = $('hints'), body = $('hintBody');
    var side = S.mode === 'pvp' ? S.turn : S.human, opp = 3 - side;
    var wantOpp = hintsOn(), wantOwn = ownRoadOn();
    var seq = ++S.hintSeq;
    box.hidden = !(wantOpp || wantOwn) || !!S.review || S.over;
    if (box.hidden || !hintVisible()) { body.textContent = ''; if (!S.review) { clearHalos(); draw(); } return; }
    var myTurn = !S.thinking && !isAITurn();
    if (!myTurn) body.textContent = '';
    var board = cloneBoard(S.board), rule = S.rule, got = {}, need = 0;
    function done() {
      if (seq !== S.hintSeq || !hintVisible()) return;
      if (--need > 0) return;
      var o = wantOpp ? got.opp : null, s = wantOwn && myTurn ? got.own : null;
      setHalos(haloGroups(o, s, side, board, rule), side, wantOwn && !myTurn);
      if (myTurn) renderHints(got.opp, got.own, side, opp, board, rule);
    }
    if (wantOpp) { need++; requestThreats(board, opp, rule, function (res) { got.opp = res; done(); }); }
    if (wantOwn && myTurn) { need++; requestThreats(board, side, rule, function (res) { got.own = res; done(); }); }
    if (!need) { setHalos([], side); }
  }

  // 一句提醒（讀屏用的純文字）。兩人一起下時句子帶顏色：「白棋注意：…」「白棋：你有四…」
  function hintItem(key, params, points, cls) {
    var d = mk('div', 'hint-item' + (cls ? ' ' + cls : ''));
    var txt = t(key, params), wp = t('hint.watch');
    if (S.mode === 'pvp') {
      var who = S.turn;
      if (wp && txt.indexOf(wp) === 0) { wp = t('hint.watchColor', { color: colorName(who) }); txt = txt.slice(t('hint.watch').length); }
      else { wp = t('hint.forColor', { color: colorName(who) }); }
      d.appendChild(mk('span', 'hint-watch', wp));
    } else if (wp && txt.indexOf(wp) === 0) { d.appendChild(mk('span', 'hint-watch', wp)); txt = txt.slice(wp.length); }
    d.appendChild(document.createTextNode(txt));
    return d;
  }
  function hasVCF(x) { return !!(x && x.vcf && (x.vcf.move || (x.vcf.line && x.vcf.line.length))); }

  // o：對手的威脅（威脅提醒開著才念）；s：自己的（提示我的機會開著才念）。兩邊都要了卻都拿不到才說「暫時無法使用」
  function renderHints(o, s, me, opp, board, rule) {
    var box = $('hintBody');
    box.textContent = '';
    var wantO = hintsOn(), wantS = ownRoadOn();
    if (!wantO) o = null;
    if (!wantS) s = null;
    if (!o && !s) {
      if (wantO || wantS) box.appendChild(hintItem('hint.unavailable', null, null, 'muted'));
      return;
    }
    var line1 = mk('div', 'hint-line'), line1b = null;
    // 第十二批 c：自己下一步就能連成五時，對手的提醒不出現（輪到自己，先連成五就贏了）
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
      // 對手能一路用四逼到贏（listThreats 的 vcf）：另出一行（規格 Z9：只給讀屏，畫面上沒有提示）。對手已經有四或活四時不出；
      // 第二十批 b（judge F6）：vcf 的第一步就是某個活三的成活四點時也不出
      var vm = hasVCF(o) ? pts([o.vcf.move || o.vcf.line[0]])[0] : null;
      var vcfOnThree = !!vm && f3.some(function (m) { return m.r === vm.r && m.c === vm.c; });
      if (teachOn() && hasVCF(o) && !of4.length && !f4.length && !vcfOnThree) { // 規格 Z10：連續逼殺路只屬於教學
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
      if (!own5.length && hasVCF(s) && teachOn()) line2.appendChild(hintItem('hint.ownVCF', null, pts([s.vcf.move || s.vcf.line[0]])));
    }
    var rows = [line1, line1b, line2].filter(function (x) { return x && x.children.length; });
    rows.forEach(function (x) { box.appendChild(x); });
  }

  // ---------------------------------------------------------- 對局頁 v2「對坐」（規格 Z1、Z2、Z7；第二十四批）
  // 下方＝跟電腦下的人（不管下黑或白）／兩人一起下的黑；上方＝電腦／兩人一起下的白
  function seatSides() {
    return S.mode === 'pvp' ? { bottom: 1, top: 2 } : { bottom: S.human, top: 3 - S.human };
  }
  function seatProfile(color) {
    if (S.mode === 'pvp') return GS.profile(color === 1 ? S.pidB : S.pidW);
    return GS.profile(S.pid) || me();
  }
  function isAISide(color) { return S.mode === 'pve' && color !== S.human; }
  // 名字＋徽章＋分數（兩行）。電腦：筆電圖示、「電腦」、級數＋分數
  // 天元那一批（規格 AC 第 2 條）：電腦是天元時，級數換成黑漆金字的小框（.tg-cap，書法字）；開局時掃一次金光（sweepCap）。
  // 掃光是 CSS 動畫，元素重建就會斷掉，所以天元那一側內容沒變時不重畫（data-key）
  function renderWho(el, color) {
    var tgKey = isAISide(color) && S.tier === TENGEN_TIER ? 'tg|' + I.getLang() + '|' + color + '|' + aiRating(S.tier) : '';
    if (tgKey && el.getAttribute('data-key') === tgKey) return;
    el.setAttribute('data-key', tgKey);
    el.textContent = '';
    var face, name, meta = mk('span', 'seat-meta');
    if (isAISide(color)) {
      face = mk('span', 'seat-face', COMPUTER_FACE);
      name = t('info.computer');
      if (tgKey) {
        var cap = mk('span', 'seat-tier tg-cap');
        cap.appendChild(tgMark());
        meta.appendChild(cap);
      } else meta.appendChild(mk('span', 'seat-tier', tierName(S.tier)));
      var r = aiRating(S.tier);
      if (r != null) meta.appendChild(mk('span', 'seat-rating', String(Math.round(r))));
    } else {
      var p = seatProfile(color);
      name = p ? p.name : colorName(color);
      face = mk('span', 'seat-face' + (p && p.emoji ? '' : ' initial'), p && p.emoji ? p.emoji : name.charAt(0));
      if (p) {
        var bd = badgeOf(p);
        if (bd) meta.appendChild(mk('span', 'badge b-' + bd, badgeName(bd)));
        meta.appendChild(mk('span', 'seat-rating', String(Math.round(p.rating))));
      }
    }
    face.setAttribute('aria-hidden', 'true');
    var tx = mk('span', 'seat-text');
    tx.appendChild(mk('span', 'seat-name', name));
    tx.appendChild(meta);
    el.appendChild(face);
    el.appendChild(tx);
    el.setAttribute('data-color', String(color));
  }
  function renderSeats() {
    var sd = seatSides(), game = $('game');
    game.classList.toggle('lay-flat', S.mode === 'pvp' && settings.pvpLay !== 'hand');
    renderWho($('whoBottom'), sd.bottom);
    renderWho($('whoTop'), sd.top);
    renderCups();
    renderTurn();
  }

  // 棋鐘的位置（Z7 第 4 條）：有棋鐘＝鐘（走動的亮、停的灰，快到時琥珀、紅，超過時間紅字往上數）；
  // 沒有棋鐘＝輪到的那一方「換你囉」、電腦那一側「在想…」（三點動畫）。只在內容變了才重畫（不讓「在想…」的動畫每一跳重來）
  function thinkEl() {
    var s = mk('span', 'turn-think', t('turn.thinking'));
    var d = mk('span', 'think-dots');
    for (var i = 0; i < 3; i++) d.appendChild(mk('span', '', '.'));
    d.setAttribute('aria-hidden', 'true');
    s.appendChild(d);
    return s;
  }
  function clockEl(st, p) {
    var run = st.run === p, lv = st.level[p], left = st.left[p];
    var el = mk('span', 'clock ' + (run ? 'run' : 'stop') + (lv ? ' ' + lv : ''));
    el.setAttribute('role', 'timer');
    var who = S.mode === 'pvp' ? t('clock.whoColor', { color: colorName(p) }) : t('clock.whoYou');
    if (lv === 'over') {
      el.appendChild(mk('span', 'clock-over', t('clock.over')));
      el.appendChild(mk('span', 'clock-t', clockText(left)));
      el.setAttribute('aria-label', t('clock.ariaOver', { who: who, time: clockText(-left).replace(/^\+/, '') }));
    } else {
      el.appendChild(mk('span', 'clock-t', clockText(left)));
      el.setAttribute('aria-label', t('clock.aria', { who: who, time: clockText(left) }));
    }
    el.setAttribute('data-state', (run ? 'run' : 'stop') + (lv ? '-' + lv : ''));
    return el;
  }
  var turnKeys = { top: '', bottom: '' };
  function renderTurn(st) {
    var sd = seatSides(), cfg = S.clk.cfg;
    if (cfg && !st) st = clockSt();
    [['bottom', sd.bottom, 'turnBottom'], ['top', sd.top, 'turnTop']].forEach(function (a) {
      var p = a[1], el = $(a[2]), key, node = null;
      if (cfg && cfg.sides.indexOf(p) >= 0) {
        key = 'c|' + st.run + '|' + st.level[p] + '|' + clockText(st.left[p]);
        if (key !== turnKeys[a[0]]) node = clockEl(st, p);
      } else if (isAISide(p)) {
        key = S.thinking && !S.over && !S.review ? 'think' : '';
        if (key !== turnKeys[a[0]]) node = key ? thinkEl() : null;
      } else {
        key = !S.over && !S.review && !S.card && S.turn === p ? 'yours' : ''; // 天元那一批：字卡播放中還沒開始下
        if (key !== turnKeys[a[0]]) node = key ? mk('span', 'turn-text', t('turn.yours')) : null;
      }
      if (key === turnKeys[a[0]] && el.getAttribute('data-lang') === I.getLang()) return;
      turnKeys[a[0]] = key;
      el.setAttribute('data-lang', I.getLang());
      el.setAttribute('data-turn', key.split('|')[0]);
      el.textContent = '';
      if (!node && key) node = key === 'think' ? thinkEl() : key === 'yours' ? mk('span', 'turn-text', t('turn.yours')) : clockEl(st, p);
      if (node) el.appendChild(node);
    });
    // 讀屏：「換你囉（黑）」「電腦在想」（換手時念一次）
    var live = '';
    if (!S.over && !S.review && !S.card && !S.sayTimer) { // S.sayTimer：「對手：天元」還沒念（sayTengen），先不寫
      if (S.thinking || isAITurn()) live = t('turn.liveThinking');
      else live = t('turn.liveYours', { color: colorName(S.turn) });
    }
    var tl = $('turnLive');
    if (tl.textContent !== live) tl.textContent = live;
  }

  // ---------------------------------------------------------- 棋罐（規格 Z7 第 3 條：照真品木製棋罐，canvas 畫，不用圖片檔）
  // 斜上方約 30° 看；矮胖圓罐（高 ≈ 寬 0.6）、大開口（口緣寬 ≈ 罐寬 80%）、口緣是罐身往內收的一圈厚唇、櫻桃木橘棕＋淡直紋、
  // 不加蓋、沒有金邊；棋子先用底色鋪滿開口，再密鋪一層互相重疊的子、疊出很低的圓丘。座標照對照稿 mock2 的 cup()（64×64 的 viewBox）。
  // 三張畫布：cup-glow（輪到時的暖金光暈＋細深金邊，呼吸用它的透明度）、cup-thick（減少動態時的粗金邊）、cup-jar（罐子本身）
  var J4_D = 'M9.6 20 C6.5 22.5 4 26 4 31 C4 44 17 54 32 54 C47 54 60 44 60 31 C60 26 57.5 22.5 54.4 20 Z';
  var J4 = { cy: 20, lrx: 22.4, lry: 10, orx: 18.6, ory: 8.1, ocy: 20.5, w: 56 };
  function seeded(seed) { // mulberry32
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var x = Math.imul(seed ^ seed >>> 15, 1 | seed);
      x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x;
      return ((x ^ x >>> 14) >>> 0) / 4294967296;
    };
  }
  var cupFill = {};
  // heap：子堆的高度倍數（木罐 1；天元黑罐 1.5，照設計稿：棋子鋪滿、堆得高一點）
  function genFill(size, heap) {
    heap = heap || 1;
    var fkey = size + '|' + heap;
    if (cupFill[fkey]) return cupFill[fkey];
    var r = size <= 48 ? 6.0 : 4.6, R = seeded(size <= 48 ? 4800 : 6400), U = function (a, b) { return a + (b - a) * R(); };
    var rp = J4.orx, k = J4.ory / J4.orx, hmax = J4.w * 0.07 * 0.87 * heap, raw = [], z = -rp + r * 0.45, row = 0, i;
    while (z < rp - r * 0.05) {
      var half = Math.sqrt(Math.max(0, rp * rp - z * z)), dx = r * 1.7, x = -half + r * 0.35 + (row % 2) * dx / 2;
      while (x <= half - r * 0.1) { raw.push([x + U(-0.18, 0.18) * r, z + U(-0.15, 0.15) * r, false]); x += dx; }
      z += r * 1.3; row++;
    }
    for (i = 0; i < (size <= 48 ? 2 : 3); i++) { var a = U(0, 2 * Math.PI), d = U(0, rp * 0.5); raw.push([Math.cos(a) * d, Math.sin(a) * d, true]); }
    raw.sort(function (p, q) { return (p[2] - q[2]) || (p[1] - q[1]); });
    var stones = raw.map(function (s) {
      var dd = Math.min(1, Math.hypot(s[0], s[1]) / rp), h = hmax * (1 - dd * dd) + (s[2] ? 1 : 0), rx = r * U(0.93, 1.06);
      return { x: 32 + s[0], y: J4.ocy + s[1] * k - h, rx: rx, ry: rx * U(0.45, 0.7), rot: U(-14, 14), shade: U(-1, 1) };
    });
    var grain = [];
    for (i = 0; i < 30; i++) grain.push([32 + U(-rp, rp) * 0.95, J4.ocy + U(-1, 1) * J4.ory * 0.9, U(1.2, 2.6)]);
    cupFill[fkey] = { stones: stones, grain: grain };
    return cupFill[fkey];
  }
  // 天元黑罐的金粉（梨地）：罐身下半，越往下越密（照設計稿 genDust）
  var cupDust = null;
  function genDust() {
    if (cupDust) return cupDust;
    var R = seeded(1212), out = [], i;
    for (i = 0; i < 150; i++) {
      var x = 5 + R() * 54, y = 34 + Math.pow(R(), 0.6) * 20;
      out.push([x, y, 0.22 + R() * 0.3, 0.35 + R() * 0.55]);
    }
    cupDust = out;
    return cupDust;
  }
  var cupGrain = null;
  function genGrain() {
    if (cupGrain) return cupGrain;
    var R = seeded(77), U = function (a, b) { return a + (b - a) * R(); }, ts = [], i;
    for (i = 0; i < 13; i++) ts.push(U(-0.85, 0.85));
    ts.sort(function (a, b) { return a - b; });
    cupGrain = ts.map(function (tt, j) {
      var mid = 32 + tt * 29.5 + U(-0.8, 0.8);
      return { top: [32 + tt * 24, 23 + U(0, 3)], c1: [mid, 31], c2: [mid + U(-1, 1), 42], bot: [32 + tt * 10, 54 - U(0, 4)],
        col: j % 3 ? 'rgba(70,28,6,' + U(0.08, 0.12).toFixed(3) + ')' : 'rgba(255,214,170,' + U(0.08, 0.1).toFixed(3) + ')', w: U(0.3, 0.5) };
    });
    return cupGrain;
  }
  function jarOutline() {
    var p = new Path2D(J4_D);
    p.ellipse(32, J4.cy, J4.lrx, J4.lry, 0, 0, Math.PI * 2);
    return p;
  }
  // rim：天元黑罐的黑子加一圈淡淡的亮邊（不然會和黑罐混在一起）
  function cupStone(ctx, color, s, rim) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot * Math.PI / 180);
    var black = color === 1;
    ctx.fillStyle = black ? '#0c0907' : '#b3a998';
    ctx.beginPath(); ctx.ellipse(0, s.ry * 0.38, s.rx, s.ry, 0, 0, Math.PI * 2); ctx.fill();
    var g = ctx.createRadialGradient(-s.rx * 0.24, -s.ry * 0.4, 0, -s.rx * 0.24, -s.ry * 0.4, s.rx * 1.6);
    var st = black ? ['#5e5650', '#1f1a17', '#14100e'] : ['#ffffff', '#f6f2ea', '#ddd5c7'];
    g.addColorStop(0, st[0]); g.addColorStop(0.55, st[1]); g.addColorStop(1, st[2]);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, s.rx, s.ry, 0, 0, Math.PI * 2); ctx.fill();
    if (!black) { ctx.strokeStyle = '#a89f92'; ctx.lineWidth = 0.5; ctx.stroke(); }
    else if (rim) { ctx.strokeStyle = 'rgba(236,224,198,.62)'; ctx.lineWidth = 0.5; ctx.stroke(); }
    ctx.fillStyle = s.shade < 0 ? 'rgba(0,0,0,' + (-s.shade * (black ? 0.14 : 0.1)).toFixed(3) + ')' : 'rgba(255,255,255,' + (s.shade * (black ? 0.14 : 0.1)).toFixed(3) + ')';
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,' + (black ? 0.42 : 0.95) + ')';
    ctx.beginPath(); ctx.ellipse(-s.rx * 0.3, -s.ry * 0.34, s.rx * 0.34, s.ry * 0.26, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function prepCanvas(cv, css, scale) {
    var dpr = window.devicePixelRatio || 1, px = Math.round(css * dpr);
    if (cv.width !== px) { cv.width = px; cv.height = px; }
    var ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, px, px);
    ctx.setTransform(px / css * scale, 0, 0, px / css * scale, 0, 0);
    return ctx;
  }
  // 木罐的罐身與厚唇（第二十四批原本的畫法，天元那一批從 drawCup 拆出來，數字不變）
  function woodBody(ctx, body) {
    var gx = ctx.createLinearGradient(4, 0, 60, 0);
    gx.addColorStop(0, '#a85a24'); gx.addColorStop(0.26, '#c8793a'); gx.addColorStop(0.56, '#a85a24'); gx.addColorStop(1, '#6b3412');
    ctx.fillStyle = gx; ctx.fill(body);
    ctx.save();
    ctx.clip(body);
    genGrain().forEach(function (g) {
      ctx.strokeStyle = g.col; ctx.lineWidth = g.w;
      ctx.beginPath(); ctx.moveTo(g.top[0], g.top[1]); ctx.bezierCurveTo(g.c1[0], g.c1[1], g.c2[0], g.c2[1], g.bot[0], g.bot[1]); ctx.stroke();
    });
    var gy = ctx.createLinearGradient(0, 0, 0, 64);
    gy.addColorStop(0, 'rgba(58,26,6,.12)'); gy.addColorStop(0.45, 'rgba(58,26,6,0)'); gy.addColorStop(1, 'rgba(58,26,6,.45)');
    ctx.fillStyle = gy; ctx.fillRect(0, 0, 64, 64);
    ctx.save();
    ctx.translate(17, 33); ctx.rotate(32 * Math.PI / 180); ctx.scale(6.5 / 11, 1);
    var gh = ctx.createRadialGradient(0, 0, 0, 0, 0, 11);
    gh.addColorStop(0, 'rgba(255,241,223,.5)'); gh.addColorStop(1, 'rgba(255,241,223,0)');
    ctx.fillStyle = gh; ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(70,28,6,.14)'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.ellipse(32, 21.6, 22.4, 10, 0, 0, Math.PI); ctx.stroke();
    ctx.restore();
    // 厚唇：外圈＋上緣亮光
    var gl = ctx.createLinearGradient(9.6, 10, 54.4, 30);
    gl.addColorStop(0, '#d48a4a'); gl.addColorStop(0.6, '#b8692f'); gl.addColorStop(1, '#8a4519');
    ctx.fillStyle = gl; ctx.beginPath(); ctx.ellipse(32, J4.cy, J4.lrx, J4.lry, 0, 0, Math.PI * 2); ctx.fill();
    var glh = ctx.createLinearGradient(11.5, 0, 52.5, 0);
    glh.addColorStop(0, 'rgba(255,233,207,.75)'); glh.addColorStop(0.55, 'rgba(255,233,207,.35)'); glh.addColorStop(1, 'rgba(255,233,207,.08)');
    ctx.strokeStyle = glh; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(32, J4.cy + 0.2, J4.lrx - 1.9, J4.lry - 0.85, 0, 0, Math.PI * 2); ctx.stroke();
  }
  function goldGrad(ctx, x0, y0, x1, y1) {
    var g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, '#f2d27a'); g.addColorStop(0.5, '#c9a44a'); g.addColorStop(1, '#8a6a24');
    return g;
  }
  // 天元黑罐（規格 AC 第 3 條，照設計稿 lacquerBody）：黑漆（#1d1a17～#3a332c）、左側反光、金粉（梨地）、兩道金色流水紋（蒔繪）、厚唇描金。不畫蓋子（AN）
  function lacquerBody(ctx, body) {
    var gx = ctx.createLinearGradient(4, 0, 60, 0);
    gx.addColorStop(0, '#2c2621'); gx.addColorStop(0.24, '#3a332c'); gx.addColorStop(0.52, '#1d1a17'); gx.addColorStop(1, '#0d0b09');
    ctx.fillStyle = gx; ctx.fill(body);
    ctx.save();
    ctx.clip(body);
    var gy = ctx.createLinearGradient(0, 0, 0, 64);
    gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(0.5, 'rgba(0,0,0,0)'); gy.addColorStop(1, 'rgba(0,0,0,.45)');
    ctx.fillStyle = gy; ctx.fillRect(0, 0, 64, 64);
    genDust().forEach(function (d) {
      ctx.fillStyle = 'rgba(226,186,92,' + (d[3] * 0.75).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(d[0], d[1], d[2], 0, Math.PI * 2); ctx.fill();
    });
    ctx.lineCap = 'round';
    [[37.5, 1.0, 0.95], [41.2, 0.7, 0.7]].forEach(function (w, j) {
      ctx.strokeStyle = goldGrad(ctx, 6, 30, 58, 46);
      ctx.globalAlpha = w[2];
      ctx.lineWidth = w[1];
      ctx.beginPath();
      for (var s = 0; s <= 40; s++) {
        var x = 5 + s / 40 * 54, tt = (x - 32) / 28, sag = 5.5 * (1 - tt * tt);
        var y = w[0] + sag * 0.55 + Math.sin(s / 40 * Math.PI * 4 + j * 1.3) * 1.3;
        if (s) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(16.5, 34); ctx.rotate(28 * Math.PI / 180); ctx.scale(5.2 / 11, 1);
    var gh = ctx.createRadialGradient(0, 0, 0, 0, 0, 11);
    gh.addColorStop(0, 'rgba(255,248,236,.55)'); gh.addColorStop(0.5, 'rgba(255,248,236,.16)'); gh.addColorStop(1, 'rgba(255,248,236,0)');
    ctx.fillStyle = gh; ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,240,220,.22)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(8.2, 23.5); ctx.bezierCurveTo(5.6, 27, 5.6, 36, 11, 43); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.ellipse(32, 21.6, 22.4, 10, 0, 0, Math.PI); ctx.stroke();
    ctx.restore();
    var gl = ctx.createLinearGradient(9.6, 10, 54.4, 30);
    gl.addColorStop(0, '#4a4138'); gl.addColorStop(0.55, '#2a2520'); gl.addColorStop(1, '#141210');
    ctx.fillStyle = gl; ctx.beginPath(); ctx.ellipse(32, J4.cy, J4.lrx, J4.lry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = goldGrad(ctx, 10, 12, 54, 28); ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.ellipse(32, J4.cy + 0.15, J4.lrx - 1.0, J4.lry - 0.5, 0, 0, Math.PI * 2); ctx.stroke();
  }
  // 天元黑罐的「輪到」（AN）：罐子外面一圈白邊＋一層柔光（淺色畫面的柔光帶冷灰藍，深色是淡白；style.css 的 --halo-ring／--halo-soft）。
  // glow＝平常（換手時呼吸三下）、thick＝減少動態效果時不動的粗白框。換淺深色時重畫（drawCup 的 key 帶畫面顏色）
  function haloCue(cup, glow, thick, size, u) {
    var cs = getComputedStyle(cup), ring = cs.getPropertyValue('--halo-ring').trim() || '#fff', soft = cs.getPropertyValue('--halo-soft').trim() || 'rgba(255,255,255,.7)';
    var dpr = window.devicePixelRatio || 1;
    [[glow, 1.5, 9, 3], [thick, 2.8, 5, 2]].forEach(function (a) {
      var c2 = prepCanvas(a[0], size * 1.36, u), out = jarOutline();
      c2.translate(64 * 0.18, 64 * 0.18);
      c2.lineJoin = 'round';
      c2.save();
      c2.shadowColor = soft;
      c2.shadowBlur = a[2] * u * dpr;
      c2.strokeStyle = soft;
      c2.lineWidth = a[3] * 2;
      c2.stroke(out);
      c2.stroke(out);
      c2.restore();
      c2.strokeStyle = ring;
      c2.lineWidth = a[1] * 2;
      c2.stroke(out);
    });
  }
  // lq：天元的黑罐（只給天元那一側用）；木罐照第二十四批原樣
  function drawCup(cup, color, size, lq) {
    var key = color + '|' + size + '|' + (window.devicePixelRatio || 1) + (lq ? '|lq|' + schemeNow() : '');
    if (cup.getAttribute('data-key') === key) return;
    cup.setAttribute('data-key', key);
    cup.setAttribute('data-color', String(color));
    cup.setAttribute('data-size', String(size));
    cup.setAttribute('data-mat', lq ? 'lacquer' : 'wood');
    var jar = cup.querySelector('.cup-jar'), glow = cup.querySelector('.cup-glow'), thick = cup.querySelector('.cup-thick');
    var u = size / 64;
    // 罐子
    var ctx = prepCanvas(jar, size, u), body = new Path2D(J4_D), fill = genFill(size, lq ? 1.5 : 1), i;
    if (lq) lacquerBody(ctx, body); else woodBody(ctx, body);
    // 開口：棋子底色鋪滿＋顆粒陰影＋密鋪的子（最前面一圈被前唇擋住一部分；黑罐的子堆得高，上緣放寬）
    ctx.fillStyle = color === 1 ? '#2a2826' : '#e9e6df';
    ctx.beginPath(); ctx.ellipse(32, J4.ocy, J4.orx, J4.ory, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    var clip = new Path2D();
    clip.moveTo(32 - J4.orx, J4.ocy);
    clip.ellipse(32, J4.ocy, J4.orx, lq ? 12.5 : 9.8, 0, Math.PI, Math.PI * 2);
    clip.ellipse(32, J4.ocy, J4.orx, J4.ory, 0, 0, Math.PI);
    clip.closePath();
    ctx.clip(clip);
    ctx.fillStyle = color === 1 ? 'rgba(0,0,0,.45)' : 'rgba(90,80,64,.22)';
    fill.grain.forEach(function (g) { ctx.beginPath(); ctx.ellipse(g[0], g[1], g[2], g[2] * 0.45, 0, 0, Math.PI * 2); ctx.fill(); });
    for (i = 0; i < fill.stones.length; i++) cupStone(ctx, color, fill.stones[i], lq);
    ctx.restore();
    ctx.strokeStyle = lq ? 'rgba(217,180,90,.75)' : 'rgba(60,24,4,.45)'; ctx.lineWidth = lq ? 0.55 : 0.6;
    ctx.beginPath(); ctx.ellipse(32, J4.ocy, J4.orx, J4.ory, 0, 0, Math.PI * 2); ctx.stroke();
    if (lq) { haloCue(cup, glow, thick, size, u); return; }
    // 光暈（畫布比罐子大 1.36 倍，往左上偏 0.18：罐子的座標要平移 64×0.18 個單位；style.css 的 .cup-glow 同一組數字）
    [[glow, 2.5, 1.2, 1], [thick, 3.2, 2.6, 0.55]].forEach(function (a) {
      var c2 = prepCanvas(a[0], size * 1.36, u), out = jarOutline();
      c2.translate(64 * 0.18, 64 * 0.18);
      c2.lineJoin = 'round';
      c2.save();
      c2.shadowColor = 'rgba(242,196,90,' + a[3] + ')';
      c2.shadowBlur = 7 * u * (window.devicePixelRatio || 1);
      c2.strokeStyle = 'rgba(242,196,90,' + a[3] + ')';
      c2.lineWidth = a[1] * 2;
      c2.stroke(out);
      c2.fillStyle = '#f2c45a';
      c2.fill(out);
      c2.restore();
      c2.strokeStyle = '#b8862b';
      c2.lineWidth = a[2] * 2;
      c2.stroke(out);
    });
  }
  // 輪到誰，誰的棋罐亮（暖金光暈、上浮）；換手那一刻呼吸三下再停（.breathe，2.4 秒，只做一次）。下完、回頭看都不亮
  function renderCups() {
    var sd = seatSides(), size = $('game').getAttribute('data-cup') === '48' ? 48 : 64;
    // 天元那一批：字卡播放中不亮（字卡跑完才「輪到」，那一刻呼吸三下）；電腦是天元時那一側用黑罐
    var lit = S.over || S.review || S.card ? 0 : S.turn;
    [['cupBottom', sd.bottom], ['cupTop', sd.top]].forEach(function (a) {
      var cup = $(a[0]), on = lit === a[1];
      drawCup(cup, a[1], size, isAISide(a[1]) && S.tier === TENGEN_TIER);
      cup.classList.toggle('lit', on);
      cup.setAttribute('aria-label', t(on ? 'cup.labelLit' : 'cup.label', { color: colorName(a[1]) }));
    });
    if (lit !== S.lit) {
      S.lit = lit;
      [$('cupBottom'), $('cupTop')].forEach(function (c) { c.classList.remove('breathe'); });
      if (lit) {
        var cup = $(sd.bottom === lit ? 'cupBottom' : 'cupTop');
        void cup.offsetWidth; // 重新觸發動畫
        cup.classList.add('breathe');
        S.breathe++;
      }
    }
  }

  // 對局頁的版面（不在回頭看）：#game 高＝視窗高減掉 main 的上下留白；上下座位條固定高、上下兩區一樣高（各放得下規則與開局那一行），
  // 棋盤夾在中間、寬度照舊（main 左右留白）。棋罐 64px（座位條 72px）；「可用高度放不下兩條 72px 座位條＋上下兩區＋全寬的棋盤」時
  // 改 48px（座位條 56px）——例：iPhone SE 的 Safari（視窗約 375×548）。棋盤＝min(全寬, 640, 剩下的高度)，最小 200
  // v0.5.10（規格 AS）：平板。直拿平板（tabletMode 'port'）一樣上下兩條座位條，但棋盤上限 960（BOARD_MAX）、座位條貼著棋盤（style.css）；
  // 橫拿（'land'）棋盤在左、吃滿高度，右邊一欄（至少 SIDE_MIN 寬、和棋盤隔 SIDE_GAP）放座位條與規則那一行，棋罐一律 64。
  // 棋盤大小另外寫到 #game 的 --bsz（style.css 用來排欄寬、座位條寬）。手機（''）照舊
  var SEAT_H = { 64: 72, 48: 56 };
  function layoutSeats() {
    var game = $('game'), cs = getComputedStyle(game.parentNode), lay = tabletMode();
    var H = Math.max(0, window.innerHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0));
    game.style.height = H + 'px';
    var W = game.clientWidth, info = $('gameInfo'), size, cup;
    if (lay === 'land') {
      cup = 64;
      size = Math.max(200, Math.floor(Math.min(H, W - SIDE_GAP - SIDE_MIN, BOARD_MAX)));
    } else {
      var zone = info.offsetHeight + (parseFloat(getComputedStyle(info).marginTop) || 0);
      var full = Math.min(W, lay ? BOARD_MAX : 640);
      // v0.5.10 複審（judge）：直拿平板的上方區固定 8px（style.css），只扣「下方區＋8」；手機照舊上下各扣一份（棋盤上方留一樣高）
      var zones = lay === 'port' ? zone + 8 : 2 * zone;
      cup = H - 2 * SEAT_H[64] - zones >= full ? 64 : 48;
      size = Math.floor(Math.min(full, H - 2 * SEAT_H[cup] - zones));
      if (size < 200) size = Math.floor(Math.min(full, 200));
    }
    game.setAttribute('data-cup', String(cup));
    game.style.setProperty('--bsz', size + 'px');
    // v0.5.10 複審（judge）：橫拿時棋盤比可用高度矮（上限 960、或被寬度限制）→ #game 上下各留一半，右欄兩條座位條才對齊棋盤上下緣（style.css 的 --bpadv）
    if (lay === 'land') game.style.setProperty('--bpadv', Math.max(0, Math.floor((H - size) / 2)) + 'px');
    else game.style.removeProperty('--bpadv');
    if (size !== bv.geo.css) bv.setSize(size);
    renderCups();
    draw();
    placeLabels();
    if (S.card) placeCard();
  }

  // ---------------------------------------------------------- 天元：開場字卡與開局掃光（規格 AC 第 2、4 條、AN；天元那一批）
  // 字卡 D「落子揮毫」1.6 秒（style.css 的 #tgCard；書法字一筆一筆寫出來與掃光由 cardInk 畫在 canvas 上，其他動畫在 CSS）；點一下跳過；每一盤都出；「動畫」關或系統減少動態效果時不出
  var CARD_MS = 1600;
  function cardWanted() { return S.mode === 'pve' && S.tier === TENGEN_TIER && motionOK(); }
  // 字卡疊在棋盤的格線範圍上（畫座標時扣掉外側那道邊）：正中央＝天元點，cqw 的一格＝格距
  function placeCard() {
    var el = $('tgCard'), cv = $('boardFrame'), pad = bv.geo.pad, w = bv.geo.css - 2 * pad; // 規格 AM：棋盤包在放大框裡，位置看框
    el.style.left = (cv.offsetLeft + pad) + 'px';
    el.style.top = (cv.offsetTop + pad) + 'px';
    el.style.width = w + 'px';
    el.style.height = w + 'px';
    el.style.setProperty('--cq', (w / 100) + 'px'); // 天元那一批複審：容器單位（cqw）的備用值（style.css 的 var(--cq, 1cqw)）
    cardInk.place(w * 0.6); // v0.5.5：書法字的框寬＝字卡的 60%（style.css 的 .tg-ink）
  }

  // v0.5.5（作者：「一筆一筆的效果沒出來」）：書法字「天元」照筆順一筆一筆寫出來。畫在 canvas（#tgInk）上，每一幀用 requestAnimationFrame 重畫：
  // 1. 先把「到這一刻寫到哪裡」的筆畫中線（圓頭、每段自己的寬度）畫成不透明的底；2. 用 source-in 疊上事先畫好的整張金字（金色漸層＋飛白），
  //    只留下寫到的部分；3. 寫完以後一道光掃過（source-atop，只落在字上）。不用 SVG 遮罩裡的 CSS 動畫（WebKit 不一定重畫）。
  // 筆畫中線：天＝橫、橫（含從第一橫回鋒下來的牽絲）、撇（含往左挑出去再回來）、捺；元＝橫（含回鋒的牽絲）、橫、撇、豎彎鉤。
  // 座標跟 #kg-zmx-T／Y 一樣是 1000×1000 的格子；p 是中線的控制點（Catmull-Rom 曲線穿過每一點），w 是那一段的寬度（蓋滿那一筆）。
  // 驗過：四筆全畫完時，字的像素沒蓋到的 天 0.23%、元 0.28%（寫完的那一幀直接畫整張字，不靠筆畫蓋滿）。
  // 時間（毫秒，從字卡開始算）：WRITE0–WRITE1 寫字，每一筆的時間照中線長度分，兩個字中間停 GAP；每一筆稍微先慢後快再慢；GL0–GL1 掃光。
  // canvas 或 Path2D 不能用、或畫的時候出錯：字卡加 .ink-static，改淡入不帶筆畫的靜態字（index.html 的 .tg-static）。
  var INK_STROKES = [
    [ // 天
      [{ w: 120, p: [268, 212, 340, 206, 430, 160, 520, 105, 600, 98] }],
      [{ w: 80, p: [595, 130, 520, 195, 440, 250, 380, 320, 390, 400, 440, 455] }, { w: 125, p: [440, 455, 530, 422, 620, 408, 720, 405] }],
      [{ w: 100, p: [335, 360, 335, 430, 330, 490, 270, 535, 170, 580, 100, 598] }, { w: 60, p: [100, 598, 180, 640, 260, 632, 310, 615] },
        { w: 110, p: [320, 590, 352, 660, 335, 730, 295, 800, 225, 865, 100, 925] }],
      [{ w: 130, p: [450, 490, 415, 570, 470, 640, 600, 758, 700, 840, 800, 890, 895, 915] }]
    ],
    [ // 元
      [{ w: 100, p: [305, 188, 350, 198, 450, 165, 530, 135, 610, 95, 665, 72, 685, 92] }, { w: 60, p: [685, 92, 660, 115, 590, 170, 520, 220, 450, 275, 400, 320] }],
      [{ w: 100, p: [300, 425, 250, 470, 205, 530, 215, 575, 290, 540, 400, 458, 500, 395, 580, 330, 615, 290, 670, 320] }],
      [{ w: 105, p: [485, 475, 450, 540, 363, 640, 258, 750, 158, 850, 85, 905] }],
      [{ w: 80, p: [670, 320, 600, 420, 545, 500, 535, 570, 525, 640, 495, 730, 470, 820, 468, 880] }, { w: 100, p: [468, 880, 510, 910, 620, 910, 740, 905, 820, 890, 880, 872] },
        { w: 130, p: [880, 872, 874, 800, 862, 720, 866, 668] }]
    ]
  ];
  var INK_T = { WRITE0: 440, WRITE1: 1200, GAP: 60, GL0: 1200, GL1: 1440 };
  var cardInk = (function () {
    var cv = $('tgInk'), card = $('tgCard'), ok = false, plan = null, full = null, css = 0, px = 0, dpr = 1;
    var raf = 0, t0 = 0, last = -1, safety = null, failNext = false;
    try { ok = typeof Path2D === 'function' && !!cv.getContext && !!cv.getContext('2d') && !!new Path2D('M0 0L1 1'); } catch (e) { ok = false; }
    // 中線取樣（Catmull-Rom，約每 6 單位一點）、每一段的累計長度；每一筆排進時間軸（照長度分，兩個字中間停 GAP）
    function sample(p) {
      var pts = [], out, i, k;
      for (i = 0; i < p.length; i += 2) pts.push([p[i], p[i + 1]]);
      out = [pts[0]];
      for (i = 0; i < pts.length - 1; i++) {
        var a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[i + 1], d = pts[Math.min(pts.length - 1, i + 2)];
        var n = Math.max(1, Math.ceil(Math.hypot(c[0] - b[0], c[1] - b[1]) / 6));
        for (k = 1; k <= n; k++) {
          var u = k / n, u2 = u * u, u3 = u2 * u, q = [0, 0];
          for (var j = 0; j < 2; j++) q[j] = 0.5 * (2 * b[j] + (c[j] - a[j]) * u + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * u2 + (3 * b[j] - a[j] - 3 * c[j] + d[j]) * u3);
          out.push(q);
        }
      }
      return out;
    }
    function makePlan() {
      var strokes = [], total = 0;
      INK_STROKES.forEach(function (ch, ci) {
        ch.forEach(function (st) {
          var segs = st.map(function (s) {
            var q = sample(s.p), L = [0];
            for (var i = 1; i < q.length; i++) L.push(L[i - 1] + Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]));
            return { w: s.w, q: q, L: L, len: L[L.length - 1] };
          });
          var len = segs.reduce(function (a, s) { return a + s.len; }, 0);
          strokes.push({ ch: ci, segs: segs, len: len });
          total += len;
        });
      });
      var ms = INK_T.WRITE1 - INK_T.WRITE0 - INK_T.GAP, at = INK_T.WRITE0;
      strokes.forEach(function (s, i) {
        if (i > 0 && s.ch !== strokes[i - 1].ch) at += INK_T.GAP;
        s.t0 = at; at += ms * s.len / total; s.t1 = at;
      });
      return strokes;
    }
    // 整張金字（不帶筆畫）：每個字自己的金色漸層（跟 #kGold 一樣：字的上下範圍 8%→92%），再用 destination-out 刷掉飛白（照 #kFbP 的線：轉 -9 度、每格 2000×420）
    var GLYPH_Y = [[50, 950], [53, 947]]; // 兩個字外框的上下（getBBox 量的，取整）
    function makeFull() {
      var c = document.createElement('canvas'), x;
      c.width = px; c.height = px / 2;
      x = c.getContext('2d');
      x.setTransform(px / 2000, 0, 0, px / 2000, 0, 0);
      ['kg-zmx-T', 'kg-zmx-Y'].forEach(function (id, i) {
        var g = x.createLinearGradient(0, GLYPH_Y[i][0], 0, GLYPH_Y[i][1]);
        g.addColorStop(0.08, '#f2d27a'); g.addColorStop(0.92, '#c9a44a');
        x.save(); x.translate(i * 1000, 0); x.fillStyle = g; x.fill(new Path2D($(id).getAttribute('d'))); x.restore();
      });
      try {
        var lines = [].map.call(document.querySelectorAll('#kFbP path'), function (e) {
          return { y: +/M0 ([\d.]+)/.exec(e.getAttribute('d'))[1], w: +e.getAttribute('stroke-width'), op: +e.getAttribute('stroke-opacity'),
            dash: e.getAttribute('stroke-dasharray').split(/[\s,]+/).map(Number), off: +e.getAttribute('stroke-dashoffset') };
        });
        x.globalCompositeOperation = 'destination-out';
        x.rotate(-9 * Math.PI / 180);
        x.lineCap = 'round';
        for (var ti = -1; ti <= 1; ti++) for (var tj = -1; tj <= 4; tj++) lines.forEach(function (l) {
          x.setLineDash(l.dash); x.lineDashOffset = l.off; x.lineWidth = l.w; x.strokeStyle = 'rgba(0,0,0,' + l.op + ')';
          x.beginPath(); x.moveTo(ti * 2000, tj * 420 + l.y); x.lineTo(ti * 2000 + 2000, tj * 420 + l.y); x.stroke();
        });
      } catch (e) { /* 飛白畫不出來就只有金字 */ }
      return c;
    }
    function ease(u) { return 0.5 * u + 0.5 * u * u * (3 - 2 * u); }
    // 畫到第 ms 毫秒的那一幀
    function draw(ms) {
      if (failNext) { failNext = false; throw new Error('ink test failure'); }
      if (!full) return;
      var x = cv.getContext('2d'), s = px / 2000;
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.globalCompositeOperation = 'source-over';
      x.clearRect(0, 0, cv.width, cv.height);
      if (ms >= INK_T.WRITE1) x.drawImage(full, 0, 0);
      else {
        x.setTransform(s, 0, 0, s, 0, 0);
        x.strokeStyle = '#000'; x.lineCap = 'round'; x.lineJoin = 'round';
        plan.forEach(function (st) {
          if (ms <= st.t0) return;
          var left = st.len * (ms >= st.t1 ? 1 : ease((ms - st.t0) / (st.t1 - st.t0)));
          x.save(); x.translate(st.ch * 1000, 0);
          for (var i = 0; i < st.segs.length && left > 0.5; i++) {
            var g = st.segs[i], q = g.q, L = g.L, upto = Math.min(left, g.len), j;
            x.lineWidth = g.w; x.beginPath(); x.moveTo(q[0][0], q[0][1]);
            for (j = 1; j < q.length && L[j] <= upto; j++) x.lineTo(q[j][0], q[j][1]);
            if (j < q.length && upto > L[j - 1]) { var f = (upto - L[j - 1]) / (L[j] - L[j - 1]); x.lineTo(q[j - 1][0] + f * (q[j][0] - q[j - 1][0]), q[j - 1][1] + f * (q[j][1] - q[j - 1][1])); }
            x.stroke();
            left -= g.len;
          }
          x.restore();
        });
        x.setTransform(1, 0, 0, 1, 0, 0);
        x.globalCompositeOperation = 'source-in';
        x.drawImage(full, 0, 0);
        x.globalCompositeOperation = 'source-over';
      }
      // 掃光：斜 18 度、寬 420 的一道淡金白光，從左到右掃過兩個字（只落在字上）
      if (ms > INK_T.GL0 && ms < INK_T.GL1) {
        var u = (ms - INK_T.GL0) / (INK_T.GL1 - INK_T.GL0), gx = -700 + 3000 * u * u * (3 - 2 * u), gr;
        x.setTransform(s, 0, 0, s, 0, 0);
        x.transform(1, 0, Math.tan(-18 * Math.PI / 180), 1, 0, 0);
        gr = x.createLinearGradient(gx, 0, gx + 420, 0);
        gr.addColorStop(0, 'rgba(255,248,224,0)'); gr.addColorStop(0.5, 'rgba(255,248,224,.9)'); gr.addColorStop(1, 'rgba(255,248,224,0)');
        x.globalCompositeOperation = 'source-atop';
        x.fillStyle = gr; x.fillRect(gx, 0, 420, 1000);
        x.globalCompositeOperation = 'source-over';
      }
      last = ms;
    }
    // 出錯：改用靜態字，從現在算起 WRITE0 之前的時間淡入（已經過了就馬上淡入）
    function toStatic(elapsed) {
      stopLoop();
      card.querySelector('.tg-static').style.animationDelay = Math.max(0, INK_T.WRITE0 - (elapsed || 0)) + 'ms';
      card.classList.add('ink-static');
    }
    function safe(ms) { try { draw(ms); return true; } catch (e) { toStatic(ms); return false; } }
    function stopLoop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (safety) clearTimeout(safety);
      safety = null;
    }
    function tick() {
      raf = 0;
      var ms = performance.now() - t0;
      if (!safe(Math.min(ms, INK_T.GL1))) return;
      if (ms < INK_T.GL1) raf = requestAnimationFrame(tick);
    }
    return {
      // placeCard 給的框寬（CSS px）：大小變了才重設解析度、重畫整張金字（播放中就馬上重畫目前這一幀）
      place: function (w) {
        if (!ok) return;
        try {
          dpr = Math.min(window.devicePixelRatio || 1, 3);
          var p = Math.max(2, Math.round(w * dpr / 2) * 2);
          if (p === px && full) return;
          css = w; px = p; cv.width = px; cv.height = px / 2;
          if (!plan) plan = makePlan();
          full = makeFull();
          if (last >= 0) safe(last);
        } catch (e) { ok = false; toStatic(raf ? performance.now() - t0 : 0); }
      },
      start: function () {
        stopLoop();
        last = -1;
        card.querySelector('.tg-static').style.animationDelay = '';
        card.classList.toggle('ink-static', !ok);
        if (!ok) return;
        t0 = performance.now();
        if (!safe(0)) return;
        raf = requestAnimationFrame(tick);
        // requestAnimationFrame 慢下來或停了（省電、分頁在背景）：寫字的時間到了還沒寫完就直接畫完整的字
        safety = setTimeout(function () { safety = null; if (last < INK_T.WRITE1) safe(INK_T.WRITE1); }, INK_T.WRITE1 + 40);
      },
      // 字卡收起：停掉、畫完整的字（下次出來前會先清掉）
      stop: function () { stopLoop(); if (ok && full && !card.classList.contains('ink-static')) safe(INK_T.GL1); },
      // 測試用：停在第 ms 毫秒那一幀、讀狀態、下一幀故意出錯
      seek: function (ms) { stopLoop(); if (ok) safe(ms); },
      state: function () { return { ok: ok, mode: card.classList.contains('ink-static') ? 'static' : 'canvas', last: last, running: !!raf, w: cv.width, h: cv.height, css: css, dpr: dpr,
        strokes: plan ? plan.map(function (s) { return { ch: s.ch, t0: Math.round(s.t0), t1: Math.round(s.t1), len: Math.round(s.len) }; }) : null }; },
      failNext: function () { failNext = true; }
    };
  })();
  function showCard() {
    var el = $('tgCard');
    el.hidden = false;
    placeCard();
    el.classList.remove('run');
    void el.offsetWidth; // 重新觸發動畫（再來一盤）
    el.classList.add('run');
    cardInk.start(); // v0.5.5：書法字一筆一筆寫（canvas）
    S.cardN++;
    S.cardTimer = setTimeout(finishCard, CARD_MS);
  }
  // 收起字卡、不開始下（換盤、回選單走 cancelAI 時）
  function stopCard() {
    if (S.cardTimer) clearTimeout(S.cardTimer);
    S.cardTimer = null;
    var el = $('tgCard');
    el.hidden = true;
    el.classList.remove('run');
    cardInk.stop();
    if (S.card) { S.card = false; setClockPause('card', false); }
  }
  // 字卡跑完或點一下跳過：開始下——棋鐘走、輪到的棋罐亮起並呼吸三下、天元小框掃一次金光、輪到電腦就開始想
  function finishCard() {
    if (!S.card) return;
    stopCard();
    // 規格 AM：字卡剛收起時落在棋盤上的那一下（手指按在字卡上、字卡先收起）不下子；v0.5.4：只在收起時字卡上還有手指（滑鼠）按著才擋，自己播完就不擋
    S.cardEndAt = cardPressed() ? performance.now() : 0;
    refresh();
    sweepCap();
    maybeAI();
    maybePonder();
  }
  $('tgCard').addEventListener('click', finishCard);
  // v0.5.4：按在字卡上、還沒放開的手指／滑鼠（pointerId）；放開或取消就拿掉（字卡藏起來後 pointerup 不一定落在字卡上，聽 window）
  var cardDown = {};
  function cardPressed() { for (var k in cardDown) return true; return false; }
  $('tgCard').addEventListener('pointerdown', function (e) { cardDown[e.pointerId] = 1; });
  ['pointerup', 'pointercancel'].forEach(function (n) { window.addEventListener(n, function (e) { delete cardDown[e.pointerId]; }, true); });
  // 座位條天元小框的金光（AC 第 2 條：開局時由左到右掃一次，之後靜止）；減少動態效果時不掃
  function sweepCap() {
    var cap = document.querySelector('#game .tg-cap');
    if (!cap || !motionOK()) return;
    cap.classList.remove('sweep');
    void cap.offsetWidth;
    cap.classList.add('sweep');
    S.sweep++;
  }
  // 讀屏：跟天元下的每一盤開始時念「對手：天元」（字卡給眼睛看；沒有字卡時也念）。先清空再寫，同一句也會再念一次
  // 天元那一批複審：念的順序是「對手：天元」→「換你囉」：等待中（S.sayTimer）renderTurn 不寫 #turnLive，念完再寫。換盤、回選單時 stopSay 收掉計時
  var SAY_MS = 60;
  function sayTengen() {
    var el = $('tgSay');
    stopSay();
    el.textContent = '';
    if (!(S.mode === 'pve' && S.tier === TENGEN_TIER)) return;
    $('turnLive').textContent = '';
    S.sayTimer = setTimeout(function () {
      el.textContent = t('tg.cardSay');
      S.sayTimer = setTimeout(function () { S.sayTimer = null; if (curPage === 'game' && !S.review) renderTurn(); }, SAY_MS);
    }, SAY_MS);
  }
  function stopSay() {
    if (S.sayTimer) clearTimeout(S.sayTimer);
    S.sayTimer = null;
  }
  // 天元那一批複審：鍵盤也能跳過字卡（Esc、Enter、空白鍵）；字卡本身不拿焦點
  // v0.5.6（複審）：分出勝負的那一下也一樣，按這三個鍵＝點棋盤（馬上出結算卡）；有面板開著時不管（點棋盤也點不到）
  document.addEventListener('keydown', function (e) {
    if (curPage !== 'game') return;
    if (!(e.key === 'Escape' || e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar')) return;
    if (S.card) { e.preventDefault(); finishCard(); return; }
    if (S.endHold && !S.review && !openModal()) { e.preventDefault(); releaseEndHold(); }
  });

  // ---------------------------------------------------------- 棋鐘的流程（規格 Z4；第二十四批）
  // 時間一律從 cnow() 拿：測試把 fakeNow 設成數字就是假時鐘（__gomokuApp.clockFake），不用真的等。
  // 事件寫進 S.clk.ev，狀態都由 clockState（純函式）算；每 250 ms 檢查一次（每盤限時用完判負、快到時輕響、重畫鐘面）
  var fakeNow = null;
  function cnow() { return fakeNow != null ? fakeNow : Date.now(); }
  function clockSt() { return S.clk.cfg ? clockState(S.clk.cfg, S.clk.ev, cnow()) : null; }
  function clockEv(e, p) {
    if (!S.clk.cfg) return;
    S.clk.ev.push({ t: cnow(), e: e, p: p });
    tickClock();
    saveResume(); // v0.5.12（規格 AP-1）：棋鐘的每個事件都存（切到背景的暫停＝存到剩下的時間；iOS 在背景被收掉也不會多送時間）
  }
  function startClock() {
    S.clk = { cfg: clockCfg(S.mode, S.human, S.clockSet || normClock(null)), ev: [], pause: {}, beepSec: null };
    if (document.hidden) S.clk.pause.hidden = 1;
    if (!S.clk.cfg) return;
    S.clk.ev.push({ t: cnow(), e: 'start', p: S.turn });
    if (document.hidden) S.clk.ev.push({ t: cnow(), e: 'pause' });
  }
  // 讓鐘停的原因：hidden（切到背景）、review（回頭看）、sheet（「⋯」面板）。有任何一個就停，全部解除才接著走
  function setClockPause(reason, on) {
    var pz = S.clk.pause, was = Object.keys(pz).length > 0;
    if (on) pz[reason] = 1; else delete pz[reason];
    var now = Object.keys(pz).length > 0;
    if (was !== now && S.clk.cfg) clockEv(now ? 'pause' : 'resume');
  }
  function tickClock() {
    if (!S.clk.cfg || $('game').hidden || S.review) return;
    var st = clockSt();
    if (st.flag && !S.over) { endGame(3 - st.flag, 'time'); return; }
    if (st.run && st.level[st.run] === 'red' && !S.over) {
      var sec = Math.ceil(st.left[st.run] / 1000);
      if (sec > 0 && sec !== S.clk.beepSec) { S.clk.beepSec = sec; beep(); }
    }
    renderTurn(st);
    // v0.5.12 複審（規格 AP-1）：鐘在走時每 5 秒存一次剩下的時間（前景直接被收掉、沒有切到背景那一下時，最多少算 5 秒）
    if (st.run && S.live && !S.over && Date.now() - resumeSavedAt >= RESUME_TICK_MS) saveResume();
  }
  setInterval(tickClock, 250);
  document.addEventListener('visibilitychange', function () { setClockPause('hidden', document.hidden); });

  // ---------------------------------------------------------- 威脅光環與懸浮標籤（規格 Z8、Z9；第二十四批）
  // 「威脅提醒」＝對手的威脅棋子畫橘色光環（活四、四、活三／跳三、能一步做出雙重威脅的那幾顆）；
  // 「提示我的機會」＝自己的四、雙重威脅、必勝路第一手會用到的己方棋子畫綠色光環。只標棋子，不標擋點或要下的點。
  // 威脅「出現那一刻」：光環呼吸兩下（BoardView 的 haloAlpha）、浮出小標籤約 3 秒；同一個威脅還在時不再跳。點發光的棋子再叫出標籤
  var HALO_DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
  function inBoard(r, c) { return r >= 0 && r < N && c >= 0 && c < N; }
  function cellsMinus(cells, skip) {
    return cells.filter(function (x) { return !skip.some(function (s) { return s.r === x[0] && s.c === x[1]; }); })
      .map(function (x) { return { r: x[0], c: x[1] }; });
  }
  // 在 pt 下 p 就連成五時，那條線上已有的四顆
  function fiveStones(board, pt, p, rule) {
    var b = cloneBoard(board);
    b[pt.r][pt.c] = p;
    var w = G.checkWin(b, pt.r, pt.c, rule);
    return w && w.cells ? cellsMinus(w.cells, [pt]) : [];
  }
  // 在 m 下 p 之後，經過 m、能成四（再一子成五）或成活三（再一子成活四）的那幾條線上已有的 p 棋子（不含 m）
  function lineStonesAt(board, m, p, rule) {
    var b = cloneBoard(board), out = [], seen = {};
    b[m.r][m.c] = p;
    function add(list) { list.forEach(function (x) { var k = x.r * N + x.c; if (!seen[k] && b[x.r][x.c] === p && !(x.r === m.r && x.c === m.c)) { seen[k] = 1; out.push(x); } }); }
    function fivesOn(d, extra) { // 這條線上 p 再下一子就成五（而且五連經過 m）的點，和那條五連
      var res = [];
      for (var k = -4; k <= 4; k++) {
        var qr = m.r + d[0] * k, qc = m.c + d[1] * k;
        if (!k || !inBoard(qr, qc) || b[qr][qc]) continue;
        b[qr][qc] = p;
        var w = G.checkWin(b, qr, qc, rule);
        b[qr][qc] = 0;
        if (w && w.cells && w.cells.some(function (x) { return x[0] === m.r && x[1] === m.c; })) res.push(cellsMinus(w.cells, [m, { r: qr, c: qc }].concat(extra || [])));
      }
      return res;
    }
    HALO_DIRS.forEach(function (d) {
      var f = fivesOn(d);
      if (f.length) { f.forEach(add); return; }
      for (var k = -4; k <= 4; k++) {
        var qr = m.r + d[0] * k, qc = m.c + d[1] * k;
        if (!k || !inBoard(qr, qc) || b[qr][qc]) continue;
        if (rule === 'renju' && p === 1 && G.isForbidden(b, qr, qc)) continue;
        b[qr][qc] = p;
        var f2 = fivesOn(d, [{ r: qr, c: qc }]);
        b[qr][qc] = 0;
        if (f2.length >= 2) { f2.forEach(add); break; }
      }
    });
    return out;
  }
  // 三顆子在同一條線上、頭尾相隔超過 2 格＝中間有空格（跳三）
  function isSplit(st) {
    if (st.length < 2) return false;
    var span = 0;
    st.forEach(function (a) { st.forEach(function (b) { span = Math.max(span, Math.abs(a.r - b.r), Math.abs(a.c - b.c)); }); });
    return span > st.length - 1;
  }
  function stoneKey(list) { return list.map(function (x) { return x.r * N + x.c; }).sort(function (a, b) { return a - b; }).join(','); }
  // 威脅清單 → 光環的組：{ key, own, kind, label（i18n 鍵）, term, stones, block（空的擋點／要下的點：標籤要避開）, rank（越小越嚴重） }
  function haloGroups(o, s, side, board, rule) {
    var out = [], seen = {}, opp = 3 - side;
    function push(own, kind, label, term, stones, block, rank) {
      if (!stones.length) return;
      var k = (own ? 'own' : 'opp') + (own ? side : opp) + ':' + stoneKey(stones);
      if (seen[k]) { seen[k].block = seen[k].block.concat(block); return; }
      seen[k] = { key: k, own: own, kind: kind, label: label, term: term, stones: stones, block: block.slice(), rank: rank };
      out.push(seen[k]);
    }
    var own5 = s ? pts(s.fours).concat(pts(s.openFours)) : [], teach = teachOn();
    // 規格 Z10（教學）：連續逼殺路的組（自己綠「必勝路」、對手橘「對手可逼殺」）：標第一手會用到的棋子，帶整條路（點標籤播放）
    function pushVCF(own, x, who) {
      var m = pts([x.vcf.move || x.vcf.line[0]])[0];
      if (!m) return;
      var st = lineStonesAt(board, m, who, rule);
      if (!st.length) return;
      var k = 'vcf' + who + ':' + m.r + ',' + m.c + ':' + stoneKey(st);
      if (seen[k]) return;
      seen[k] = { key: k, own: own, kind: 'vcf', label: own ? 'halo.ownVCF' : 'halo.oppVCF', term: 'vcf', stones: st, block: [m], rank: 2,
        line: x.vcf.line && x.vcf.line.length ? linePts(x.vcf.line) : [m], attacker: who }; // v0.5.16：留著 { pass: true }（linePts）
      out.push(seen[k]);
    }
    if (o && !own5.length) {
      // 和提醒句同一個規則（第二十批 b F6）：對手已經有四或活四、或逼殺路的第一步就是某個活三的成活四點時不另標（活三的標籤已經說了）
      var vm0 = hasVCF(o) ? pts([o.vcf.move || o.vcf.line[0]])[0] : null;
      var onThree = !!vm0 && pts(o.threes).some(function (m) { return m.r === vm0.r && m.c === vm0.c; });
      if (teach && vm0 && !onThree && !pts(o.openFours).length && !pts(o.fours).length) pushVCF(false, o, opp);
      (o.openFours || []).forEach(function (x) { push(false, 'openFour', 'halo.openFour', 'openFour', pts(x.stones), pts(x.points), 0); });
      pts(o.fours).forEach(function (pt) { push(false, 'four', 'halo.four', 'four', fiveStones(board, pt, opp, rule), [pt], 1); });
      [['fourThree', o.fourThree], ['doubleFour', o.doubleFour], ['doubleThree', o.doubleThree]].forEach(function (a) {
        dropForbidden(pts(a[1]), opp, rule, board).forEach(function (pt) {
          push(false, 'double', 'halo.' + a[0], a[0], lineStonesAt(board, pt, opp, rule), [pt], 2); // 規格 AN：標籤直接寫四三／三三／四四
        });
      });
      // judge 第十三輪 F6：跳三（三顆子之間有空格）的標籤寫「跳三」；讀屏句照舊
      (o.threes || []).forEach(function (x) {
        var st = pts(x.stones), split = isSplit(st);
        push(false, split ? 'splitThree' : 'openThree', split ? 'halo.splitThree' : 'halo.openThree', split ? 'splitThree' : 'openThree', st, pts(x.points), 3);
      });
    }
    if (s) {
      (s.openFours || []).forEach(function (x) { push(true, 'ownFour', 'halo.ownFour', 'four', pts(x.stones), pts(x.points), 0); });
      pts(s.fours).forEach(function (pt) { push(true, 'ownFour', 'halo.ownFour', 'four', fiveStones(board, pt, side, rule), [pt], 0); });
      [['fourThree', s.fourThree, 'halo.ownFourThree'], ['doubleFour', s.doubleFour, 'halo.ownDoubleFour'], ['doubleThree', s.doubleThree, 'halo.ownDoubleThree']].forEach(function (a) {
        dropForbidden(pts(a[1]), side, rule, board).forEach(function (pt) {
          push(true, a[0], a[2], a[0], lineStonesAt(board, pt, side, rule), [pt], 1);
        });
      });
      if (teach && !own5.length && hasVCF(s)) pushVCF(true, s, side);
    }
    return out;
  }
  // v0.5.15（規格 AU 第二版）：光環與標籤的「宿主」。對局（S.halo、#board、#haloLabels）與擺棋盤研究（RS.halo、#rbBoard、#rbLabels）共用
  // setHalos／clearHalos／showLabels／placeLabels／標籤淡出這一套；最後一個參數不給＝對局（原本的行為一點都不變）。
  // st＝光環狀態、view＝BoardView、canvas／box＝畫布與標籤容器的 id、board()＝盤面、rot()＝標籤要不要轉 180°、redraw()＝重畫、game＝是不是對局
  var GAME_HALO = { st: function () { return S.halo; }, view: bv, canvas: 'board', box: 'haloLabels', board: function () { return S.board; },
    rot: function () { return S.mode === 'pvp' && settings.pvpLay !== 'hand' && S.turn === 2; }, redraw: function () { draw(); }, game: true, timer: null };
  // 換一組光環。side＝提醒的對象（跟電腦下＝人；兩人一起下＝輪到的那一方）；新出現的組（同一個對象上次沒看過）才呼吸、浮標籤
  // keepOwn：這一次沒有算自己的機會（跟電腦下、電腦在想的時候）——記得的「自己那幾組」留著，輪回人的時候同一組不再當成新的
  function setHalos(groups, side, keepOwn, host) {
    host = host || GAME_HALO;
    var H = host.st(), now = performance.now(), seen = H.seen || (H.seen = {}), prev = seen[side] || {}, fresh = [];
    groups = groups || [];
    var keys = {};
    if (keepOwn) Object.keys(prev).forEach(function (k) { if (k.indexOf('own') === 0 || k.indexOf('vcf' + side + ':') === 0) keys[k] = prev[k]; });
    groups.forEach(function (g) {
      keys[g.key] = prev[g.key] != null ? prev[g.key] : now;
      g.t0 = keys[g.key];
      if (prev[g.key] == null) fresh.push(g);
    });
    if (side) seen[side] = keys;
    H.groups = groups;
    var ring = {};
    groups.forEach(function (g) {
      g.stones.forEach(function (x) {
        var k = x.r * N + x.c;
        if (!ring[k] || ring[k].t0 < g.t0) ring[k] = { r: x.r, c: x.c, own: g.own, t0: g.t0 };
      });
    });
    H.rings = Object.keys(ring).map(function (k) { return ring[k]; });
    // 標籤：已經不在的組收掉；新出現的組最多浮 3 個（越嚴重越先）
    // v0.5.15：留下來的標籤換成這一次的組（擺棋盤研究換手時同一組會從綠變橘；對局的組 key 裡就有 own／opp，不會變）
    H.labels = H.labels.filter(function (l) {
      var ng = null;
      groups.forEach(function (g) { if (g.key === l.key) ng = g; });
      if (!ng && l.el) l.el.remove();
      if (ng) { l.group = ng; l.own = ng.own; if (l.el) l.el.classList.toggle('own', !!ng.own); }
      return !!ng;
    });
    fresh.sort(function (a, b) { return (a.own - b.own) || (a.rank - b.rank); });
    // judge 第十三輪 F5：教學的標籤（必勝路、對手可逼殺）另外算，最多再加 2 個，不被一般的 3 個擠掉
    showLabels(fresh.filter(function (g) { return g.kind !== 'vcf'; }).slice(0, 3).concat(fresh.filter(function (g) { return g.kind === 'vcf'; }).slice(0, 2)), host);
    host.redraw();
  }
  function clearHalos(host) {
    var H = (host || GAME_HALO).st();
    H.labels.forEach(function (l) { if (l.el) l.el.remove(); });
    H.labels = []; H.rings = []; H.groups = [];
  }
  var LABEL_MS = 3000, LABEL_FADE = 600;
  function showLabels(groups, host) {
    host = host || GAME_HALO;
    var H = host.st(), until = performance.now() + LABEL_MS, teach0 = S.teachShown;
    groups.forEach(function (g) {
      var old = H.labels.filter(function (l) { return l.key === g.key; })[0];
      if (old) { old.until = until; if (old.el) old.el.classList.remove('fade'); return; }
      var el = mk('button', 'halo-label' + (g.own ? ' own' : ''), t(g.label));
      el.type = 'button';
      el.setAttribute('data-term', g.term);
      el.setAttribute('data-gl', I.glossaryId(g.term) || '');
      el.setAttribute('data-key', g.key);
      el.setAttribute('aria-label', t('halo.aria', { label: t(g.label), term: I.termText(g.term) }));
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        // judge 第十三輪 F8：標籤 3 秒後會被拿掉，說明關掉後焦點回到棋盤（#board 有 tabindex=-1）
        // 規格 AK：點標籤開名詞對照表的那一條
        if (g.kind === 'vcf') playTeach(g); else openGlossary({ currentTarget: $(host.canvas) }, I.glossaryId(g.term), g.term);
      });
      if (g.kind === 'vcf' && host.game) S.teachShown = true; // 規格 Z10：這盤出現過連續逼殺路的標籤＝教學局（不計分）
      $(host.box).appendChild(el);
      H.labels.push({ key: g.key, own: g.own, text: t(g.label), term: g.term, until: until, el: el, group: g });
    });
    if (host.game && S.teachShown !== teach0) saveResume(); // v0.5.12（規格 AP-1）：變成教學局（不計分）也要存，接著下以後照樣不計分
    placeLabels(host);
    scheduleLabelFade(host);
  }
  function scheduleLabelFade(host) {
    host = host || GAME_HALO;
    if (host.timer) clearTimeout(host.timer);
    host.timer = null;
    var H = host.st();
    if (!H.labels.length) return;
    var next = Math.min.apply(null, H.labels.map(function (l) { return l.until; }));
    host.timer = setTimeout(function () { expireLabels(false, host); }, Math.max(0, next - performance.now()));
  }
  // 時間到的標籤淡出（減少動態時直接拿掉）；force＝測試用，全部當作時間到
  function expireLabels(force, host) {
    host = host || GAME_HALO;
    host.timer = null;
    var now = performance.now(), H = host.st(), keep = [];
    H.labels.forEach(function (l) {
      if (force !== true && l.until > now + 5) { keep.push(l); return; }
      var el = l.el;
      if (!el) return;
      if (motionOK() && force !== true) { el.classList.add('fade'); setTimeout(function () { el.remove(); }, LABEL_FADE); }
      else el.remove();
    });
    H.labels = keep;
    scheduleLabelFade(host);
  }
  // 標籤的位置：放在那組棋子那條線延長方向的外側（離端點那顆子 0.6 格），依序試：線的後端、前端、最上面那顆的上方、下方、右邊、左邊；
  // 要在棋盤裡、不蓋到空的擋點（每組的 block 點）和別的標籤，第一輪也不蓋到任何棋子。都放不下時縮成「!」圓點（端點那顆子的四個斜角）
  function placeLabels(host) {
    host = host || GAME_HALO;
    var H = host.st(), cv = $(host.canvas), g = host.view.geo, cell = g.cell, bd = host.board();
    if (!H.labels.length || !cell) return;
    var box = $(host.box);
    box.style.left = cv.offsetLeft + 'px';
    box.style.top = cv.offsetTop + 'px';
    // 兩人一起下、手機平放：輪到上方（白）時標籤轉 180°，讓坐對面的人看正的
    box.classList.toggle('rot', !!host.rot());
    function cx(c) { return g.margin + c * cell; }
    var blocks = [];
    H.groups.forEach(function (gr) { gr.block.forEach(function (b) { if (!bd[b.r][b.c]) blocks.push(b); }); });
    var stones = [];
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) if (bd[r][c]) stones.push({ r: r, c: c });
    var placed = [], half = cell * 0.42;
    function hitCells(rect, list) {
      return list.some(function (b) {
        var x = cx(b.c), y = cx(b.r);
        return rect.l < x + half && rect.r > x - half && rect.t < y + half && rect.b > y - half;
      });
    }
    function ok(rect, strict) {
      if (rect.l < 0 || rect.t < 0 || rect.r > g.css || rect.b > g.css) return false;
      if (hitCells(rect, blocks)) return false;
      if (strict && hitCells(rect, stones)) return false;
      return !placed.some(function (q) { return rect.l < q.r && rect.r > q.l && rect.t < q.b && rect.b > q.t; });
    }
    H.labels.forEach(function (l) {
      var el = l.el, st = l.group.stones.slice().sort(function (a, b) { return a.r - b.r || a.c - b.c; });
      el.classList.remove('dot');
      el.textContent = l.text;
      var w = el.offsetWidth || 40, h = el.offsetHeight || 24, cands = [];
      function along(s, dr, dc, more) {
        var len = Math.hypot(dr, dc), ux = dc / len, uy = dr / len, ext = Math.abs(ux) * w / 2 + Math.abs(uy) * h / 2;
        var k = cell * (0.6 + (more || 0) * len) + ext;
        return { x: cx(s.c) + ux * k, y: cx(s.r) + uy * k };
      }
      if (st.length >= 2) {
        var a = st[0], z = st[st.length - 1], dr = Math.sign(z.r - a.r), dc = Math.sign(z.c - a.c);
        // 線的兩端緊鄰常常就是擋點（活三兩頭）：先試緊貼端點，再試隔過一格（擋點外側），仍在線的延長方向上
        if (dr || dc) cands.push(along(z, dr, dc), along(a, -dr, -dc), along(z, dr, dc, 1), along(a, -dr, -dc, 1));
      }
      var top = st.reduce(function (p, q) { return q.r < p.r ? q : p; }), bot = st.reduce(function (p, q) { return q.r > p.r ? q : p; });
      var rt = st.reduce(function (p, q) { return q.c > p.c ? q : p; }), lf = st.reduce(function (p, q) { return q.c < p.c ? q : p; });
      cands.push(along(top, -1, 0), along(bot, 1, 0), along(rt, 0, 1), along(lf, 0, -1));
      var pick = null;
      [true, false].some(function (strict) {
        return cands.some(function (p) {
          var rect = { l: p.x - w / 2, r: p.x + w / 2, t: p.y - h / 2, b: p.y + h / 2 };
          if (ok(rect, strict)) { pick = { x: p.x, y: p.y, rect: rect, dot: false }; return true; }
          return false;
        });
      });
      if (!pick) {
        var d = 22, e = st[st.length - 1];
        [[-1, 1], [-1, -1], [1, 1], [1, -1]].some(function (o) {
          var x = cx(e.c) + o[1] * cell * 0.55, y = cx(e.r) + o[0] * cell * 0.55;
          var rect = { l: x - d / 2, r: x + d / 2, t: y - d / 2, b: y + d / 2 };
          if (ok(rect, false)) { pick = { x: x, y: y, rect: rect, dot: true }; return true; }
          return false;
        });
        if (!pick) {
          var x0 = cx(e.c) + cell * 0.55, y0 = cx(e.r) - cell * 0.55;
          pick = { x: x0, y: y0, rect: { l: x0 - d / 2, r: x0 + d / 2, t: y0 - d / 2, b: y0 + d / 2 }, dot: true };
        }
      }
      if (pick.dot) { el.classList.add('dot'); el.textContent = '!'; }
      el.style.left = pick.x + 'px';
      el.style.top = pick.y + 'px';
      placed.push(pick.rect);
      l.x = pick.x; l.y = pick.y; l.rect = pick.rect; l.dot = pick.dot;
    });
  }

  // ---------------------------------------------------------- 教學：播放連續逼殺路（規格 Z10）
  // 點「必勝路」「對手可逼殺」的標籤：在棋盤上用半透明、帶編號的棋子一步一步擺出整條路（沿用回頭看「播放這條路」的畫法與速度：
  // BoardView 的 ghosts、每 700 毫秒一步）。播完停一下就收起；播放中點棋盤任何地方也收起。只畫，不改棋局
  var TEACH_MS = 700;
  // v0.5.16：畫給人看的路（教學、回頭看、擺棋盤研究共用）。line 是攻方 att 先下、攻守輪流；可能有一格 { pass: true }＝守方黑棋要擋的點是禁手、
  // 擋不了（ai.js 的 finishLine）：那一格不擺子，編號照格數走（後面那一手照樣是它在路上的第幾步）。回傳前 step 格的
  // ghosts（半透明編號子）與 crosses：停在 pass 那一格時，在擋不了的那一點（下一格、攻方連成五的點）畫 ×；否則 null
  function lineGhosts(line, step, att) {
    var g = [];
    line.slice(0, step).forEach(function (q, k) { if (!q.pass) g.push({ r: q.r, c: q.c, p: k % 2 ? 3 - att : att, num: k + 1 }); });
    var q = step > 0 ? line[step - 1] : null, nx = line[step];
    return { ghosts: g, crosses: q && q.pass && nx && !nx.pass ? [{ r: nx.r, c: nx.c }] : null };
  }
  // 路的第 i 格（1 起算）是不是擋不了的那一格；是的話回那一行說明「黑棋擋不了（要擋的點是禁手）」，不是回 ''
  function linePassNote(line, i, att) {
    var q = i > 0 ? line[i - 1] : null;
    return q && q.pass ? t('rs.passStep', { color: colorName((i - 1) % 2 ? 3 - att : att) }) : '';
  }
  // 引擎給的路 → 介面用的路：點照 pts 的讀法，{ pass: true } 留著（pts 會把它丟掉）
  function linePts(list) {
    var out = [];
    (list || []).forEach(function (m) {
      if (m && m.pass) out.push({ pass: true });
      else { var q = pts([m])[0]; if (q) out.push(q); }
    });
    return out;
  }
  function teachGhosts() {
    var P2 = S.teach;
    if (!P2) return null;
    return lineGhosts(P2.line, P2.step, P2.att).ghosts;
  }
  function teachCrosses() {
    var P2 = S.teach;
    return P2 ? lineGhosts(P2.line, P2.step, P2.att).crosses : null;
  }
  function playTeach(g) {
    stopTeach();
    if (!g.line || !g.line.length) return;
    S.teach = { line: g.line, att: g.attacker, step: 1, key: g.key, done: false };
    S.teach.timer = setInterval(function () {
      var P2 = S.teach;
      if (!P2) return;
      if (P2.step >= P2.line.length) { stopTeach(); return; } // 播完再停一拍（最後一步也顯示 700 毫秒）就收起
      P2.step++;
      // v0.5.16：走到黑棋擋不了的那一格（{ pass: true }）：盤上在那一點畫 ×（gameView 的 crosses），棋盤上緣閃一句「黑棋擋不了（要擋的點是禁手）」
      var note = linePassNote(P2.line, P2.step, P2.att);
      if (note) flash(note);
      draw();
    }, TEACH_MS);
    draw();
  }
  function stopTeach() {
    if (!S.teach) return;
    clearInterval(S.teach.timer);
    S.teach = null;
    draw();
  }

  // ---------------------------------------------------------- 畫面更新

  function gameView() {
    return {
      board: S.board,
      last: S.history.length ? S.history[S.history.length - 1] : null,
      winCells: S.winCells,
      endForbid: S.over && S.endReason === 'forbidden' ? S.forbidCue : null, // v0.5.5：禁手輸的那顆子與線
      forbidden: S.rule === 'renju' && !S.over && S.turn === 1,
      flash: S.hintFlash,
      halos: S.over ? null : S.halo.rings, // 第二十四批：威脅光環（規格 Z8）
      ghosts: teachGhosts(), // 規格 Z10：教學播放連續逼殺路（半透明、帶編號的棋子）
      crosses: teachCrosses(), // v0.5.16：停在黑棋擋不了的那一格時，擋不了的那一點畫 ×
      preview: S.preview && !S.over ? { r: S.preview.r, c: S.preview.c, p: S.turn } : null, // 規格 AM：點兩下確認的預覽子
      // v0.5.14（規格 AU）：「⋯」的「棋子上顯示手數」（開局教學擺好的子也在 history 裡，照實際手數編號）。
      // v0.5.15（規格 AU 第二版）：教學播放（帶編號的半透明子）時先不寫真的手數，盤上不會同時有兩串 1、2、3；播完收起就回來
      nums: settings.numsGame && !S.teach ? S.history : null
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

  // 對局（不在回頭看）：layoutSeats（座位條、棋罐尺寸、棋盤置中）。
  // 回頭看：照原本的算法——對戰條、狀態行、回頭看列等看得到的塊都算進去（回頭看面板在棋盤下方、可以往下捲，不算），剩下的高度給棋盤。
  // 第二十四批：提醒列不在畫面上了（只給讀屏），第二十批 b 的提醒列限高與 ResizeObserver 拿掉
  var resizeRecheck = 0;
  function resize() {
    var game = $('game');
    if (game.hidden) return;
    // v0.5.10 第二輪複審（judge）：轉向時上一個方向留下的 --bsz 可能把橫拿的欄撐到比頁寬還寬 → 行動版瀏覽器把整頁縮小、innerHeight 讀錯
    //（1024×768 直→橫：讀到 801、整頁多捲 32px）。量之前先拿掉兩個變數；量完下一幀 innerHeight 若變了（縮放剛恢復）再算一次
    game.style.removeProperty('--bsz');
    game.style.removeProperty('--bpadv');
    var ih = window.innerHeight;
    if (!resizeRecheck) resizeRecheck = requestAnimationFrame(function () {
      resizeRecheck = 0;
      if (window.innerHeight !== ih) resize();
    });
    game.classList.toggle('playing', !S.review);
    if (!S.review) { layoutSeats(); return; }
    game.style.height = '';
    // v0.5.10（規格 AS）：平板。橫拿：棋盤在左（main 上下留白之間的高度）、右欄放對戰條、說明、步數控制與拉桿、分析（style.css 把棋盤 sticky，
    // 右欄往下捲時棋盤不動）；直拿：照原本的算法，但扣的是 main 真正的上下留白（有安全區時不只 32）、上限 960，步數控制與拉桿也在第一屏
    var lay = tabletMode(), mcs = getComputedStyle(game.parentNode);
    var padV = (parseFloat(mcs.paddingTop) || 0) + (parseFloat(mcs.paddingBottom) || 0);
    var wrap = $('boardWrap'), size;
    if (lay === 'land') {
      size = Math.max(240, Math.floor(Math.min(window.innerHeight - padV, game.clientWidth - SIDE_GAP - SIDE_MIN, BOARD_MAX)));
    } else {
      var availW = wrap.clientWidth;
      var reserved = 0;
      Array.prototype.forEach.call(game.children, function (ch) {
        if (ch === wrap || ch.hidden || ch.id === 'reviewPanel') return;
        var cs = getComputedStyle(ch);
        if (cs.display === 'none' || cs.position === 'absolute') return;
        reserved += ch.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
      });
      var availH = lay ? window.innerHeight - reserved - padV - 8 : window.innerHeight - reserved - 32;
      size = Math.floor(Math.min(availW, availH, lay ? BOARD_MAX : 640));
      if (size < 240) size = Math.floor(Math.min(availW, 240));
    }
    game.style.setProperty('--bsz', size + 'px');
    bv.setSize(size);
    draw();
  }

  // ---------------------------------------------------------- 輸入

  // 規格 AM：點兩下確認——這一下是不是點在預覽子上（是＝真的下）；不是就把預覽移到這一點、重畫，回傳 false
  var CARD_GUARD_MS = 350;
  function confirmTap(p) {
    if (settings.placeMode !== 'confirm') return true;
    if (S.preview && S.preview.r === p.r && S.preview.c === p.c) return true;
    S.preview = { r: p.r, c: p.c };
    draw();
    return false;
  }
  $('board').addEventListener('click', function (e) {
    if (S.card) { finishCard(); return; } // 天元那一批：開場字卡播放中點棋盤＝跳過（字卡本身蓋在棋盤上，這裡是保險）
    if (S.cardEndAt && performance.now() - S.cardEndAt < CARD_GUARD_MS) return; // 規格 AM：字卡剛收起，這一下是按在字卡上的
    if (S.teach) { stopTeach(); return; } // 規格 Z10：播放中點棋盤任何地方就收起（不落子）
    if (S.endHold && !S.review) { releaseEndHold(); return; } // v0.5.5：分出勝負的那一下，點棋盤＝馬上出結算卡
    if (S.review || S.over) return;
    var p = bv.cellAt(e.clientX, e.clientY);
    // 第二十四批（規格 Z9）：點發光的棋子，再叫出那幾組的標籤（約 3 秒）
    if (p && S.board[p.r][p.c]) {
      var gs = S.halo.groups.filter(function (g) { return g.stones.some(function (x) { return x.r === p.r && x.c === p.c; }); });
      if (gs.length) showLabels(gs);
      return;
    }
    if (S.thinking || isAITurn()) return;
    if (!p) return;
    if (S.rule === 'renju' && S.turn === 1) {
      var f = G.isForbidden(S.board, p.r, p.c);
      if (f) {
        // 下了就輸（S.strict）也是真的下子：點兩下確認時先出預覽
        if (S.strict) { if (!confirmTap(p)) return; bz.afterPlace(); playForbidden(p.r, p.c, f); return; }
        flash(t('status.forbidden', { kind: forbiddenName(f) })); // 不落子、不判負（預覽子不動）
        return;
      }
    }
    if (!confirmTap(p)) return;
    bz.afterPlace(); // 規格 AM：真的下了子，放大的棋盤縮回原大小
    play(p.r, p.c);
  });

  // ---------------------------------------------------------- 復盤（review.js）

  function gameInfoFromState() {
    return {
      moves: S.history.slice(), rule: S.rule, strict: S.strict, tier: S.tier, mode: S.mode, human: S.human,
      over: S.over, end: S.over ? S.endReason : null, winner: S.winner, forbidden: S.forbiddenKind,
      ts: S.gameTs, recorded: S.recorded, pidB: S.pidB, pidW: S.pidW, // 第十八批：回頭看的對戰條寫雙打兩人的名字
      clock: clockRec(S.clk.cfg),
      teach: !!(S.lastRec && S.lastRec.eloSkip === 'teach') // judge 第十三輪 F4：真的沒計分才寫「教學局」
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
      forbidden: rec.forbidden || null, ts: rec.ts, recorded: true, at: rec.at, pidB: rec.pidB || null, pidW: rec.pidW || null,
      oppRating: typeof rec.oppRating === 'number' ? rec.oppRating : null, // 第二十批 b（F7）：舊紀錄沒有這欄
      clock: rec.clock || null, // 第二十四批：這盤的棋鐘設定（回頭看的規則膠囊後面寫）
      teach: rec.eloSkip === 'teach' // 規格 Z10：教學局（judge 第十三輪 F4：真的沒計分才算）
    };
  }

  // 第十四批：回頭看時收起提醒列、下方兩排按鈕與結算卡；棋盤上方那一列放「換風格」，
  // 對局中（還沒下完）進來的再加「回到這盤棋」（W 第 2 條：放在狀態列旁）
  // 第二十五批（作者 2026-10-01）：拿掉「換風格」，那一列只在有「回到這盤棋」時出現
  // 第二十四批：回頭看時棋鐘停（回來接著走）、座位條與兩區藏起來（resize 拿掉 #game 的 playing）
  function setReviewUI(on, info) {
    $('hints').hidden = on || !(hintsOn() || ownRoadOn()) || S.over;
    setClockPause('review', !!on);
    $('game').classList.toggle('playing', !on);
    $('rvBackBtn').hidden = !(on && S.review === 'game' && info && !info.over);
    $('gameExtra').hidden = $('rvBackBtn').hidden; // 第二十五批：「換風格」拿掉後這一列只有「回到這盤棋」
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
    S.preview = null; // v0.5.4：點兩下確認的預覽子不帶進回頭看
    bz.reset(false); // 規格 AM：進回頭看時棋盤從原大小開始（回頭看可以放大，按「還原」才縮回）
    showPage('game');
    setReviewUI(true, info);
    renderOppInfo(info);
    resize(); // 第二十四批：結算卡不再帶動 resize，先排好棋盤再開回頭看（從紀錄進來時棋盤可能還沒排過）
    RV.open(info);
    resize();
  }

  function exitReview() {
    var from = S.review;
    RV.close();
    S.review = null;
    S.preview = null; // v0.5.4：回到這盤棋時沒有舊的預覽子
    bz.reset(false); // 規格 AM
    setReviewUI(false);
    if (from === 'stats') { showPage('stats'); return; }
    renderOppInfo();
    resize();
    refresh();
    maybeAI();
    maybePonder();
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
    setOpeningStatus: setOpeningStatus, // v0.5.18（規格 AQ）
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
    forbidLines: forbidLines, // v0.5.6（複審）：禁手輸的那盤，回頭看最後一手也畫讓它變成禁手的線與 ×
    numsOn: function () { return settings.numsReview; }, // v0.5.14（規格 AU）：回頭看的「手數」膠囊
    onResearch: function (info, moves, n) { researchFromReview(info, moves, n); }, // v0.5.15（規格 AU 第二版）：「從這一步研究」
    onShare: function () { shareNow(); }, // v0.5.19（規格 AW）：「分享圖片」＝目前這一步的盤面
    lineGhosts: lineGhosts, linePassNote: linePassNote, // v0.5.16：路的畫法與擋不了的那一行說明（同教學、研究）
    version: window.GOMOKU_VERSION || ''
  });

  // ---------------------------------------------------------- 對話框（自動調整、清除確認）與焦點鎖

  var dialogReturn = null;
  // opts.flip（v0.5.11，規格 AO）：兩人平放時問坐上方的人（求和問對方、認輸問輪到的那一方），整個框轉 180°
  // opts.focusLast（v0.5.11 複審）：一開始的焦點放在最後一顆（繼續下）——認輸、求和、放棄的框按 Enter（或按住 Enter 連發）不會就這樣結束這盤
  function showDialog(text, buttons, opts) {
    var box = $('dialogBtns');
    $('dialog').classList.toggle('flip', !!(opts && opts.flip));
    $('dialogText').textContent = text;
    box.textContent = '';
    dialogReturn = document.activeElement;
    buttons.forEach(function (b) {
      var btn = mk('button', b.primary ? '' : 'secondary', b.label);
      btn.type = 'button';
      if (b.danger) btn.classList.add('danger');
      if (b.esc) btn.setAttribute('data-esc', ''); // v0.5.12 複審：Esc 按這一顆（沒有標的框照舊是最後一顆）
      btn.addEventListener('click', function () {
        closeDialog();
        if (b.onClick) b.onClick();
        flushHeldReply(); // v0.5.11 複審：框開著時電腦算好的那一手，關掉以後才下（這盤因為這個框結束了就丟掉）
      });
      box.appendChild(btn);
    });
    $('dialog').hidden = false;
    setClockPause('dialog', true); // judge 第十三輪 F1（規格 Z4 補）：確認框開著時棋鐘停，任何一顆按鈕關掉都解除
    (opts && opts.focusLast ? box.lastChild : box.firstChild).focus();
  }
  function closeDialog() {
    if ($('dialog').hidden) return;
    $('dialog').hidden = true;
    setClockPause('dialog', false);
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
        var esc = $('dialogBtns').querySelector('[data-esc]') || btns[btns.length - 1];
        if (esc) esc.click(); // Esc = 最後一個（先不要／取消）；v0.5.12 複審：有 data-esc 的按那一顆（「要接著下嗎？」的先留著）
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

  // 規格 AK（修正）：名詞對照表。和規則說明同一個面板（#ruleHelp），兩個畫面切換；條目照 I18N.GLOSSARY 畫
  // 小圖例：● 黑、○ 白、・ 空 → 一條線上的小棋子（讀屏念「例子：空、黑、黑…」）
  function glossaryExample(ex) {
    var box = mk('div', 'gl-ex');
    box.setAttribute('role', 'img');
    var said = [];
    ex.forEach(function (row, i) {
      if (i) box.appendChild(mk('span', 'gl-or', t('gl.or')));
      var line = mk('span', 'gl-line'), words = [];
      Array.prototype.forEach.call(row, function (ch) {
        var k = ch === '●' ? 'b' : ch === '○' ? 'w' : ch === '・' ? 'e' : null;
        if (!k) return;
        line.appendChild(mk('span', 'gl-st ' + k));
        words.push(t(k === 'b' ? 'gl.black' : k === 'w' ? 'gl.white' : 'gl.empty'));
      });
      box.appendChild(line);
      said.push(words.join(t('gl.stoneSep')));
    });
    box.setAttribute('aria-label', t('gl.ex', { stones: said.join(t('gl.exSep')) }));
    return box;
  }
  function renderGlossary() {
    var ul = $('glossaryList');
    ul.textContent = '';
    I.GLOSSARY.forEach(function (g) {
      var li = mk('li', 'gl-item');
      li.id = 'gl-' + g.id;
      li.tabIndex = -1;
      li.setAttribute('aria-labelledby', 'gl-' + g.id + '-t');
      var h = mk('h3', 'gl-term', t('gl.' + g.id));
      h.id = 'gl-' + g.id + '-t';
      li.appendChild(h);
      li.appendChild(mk('p', 'gl-plain', t('gl.' + g.id + '.plain')));
      if (g.ex && g.ex.length) li.appendChild(glossaryExample(g.ex));
      if (g.fig) {
        var b = mk('button', 'link gl-fig', t('gl.fig'));
        b.type = 'button';
        b.setAttribute('data-fig-of', g.fig);
        // 天元那一批（用字複審）：對照表的 fig 就是規則說明的 id（fig-<fig>），不再過 TERM_FIG（那張表把 renju 對到三三的圖，連珠規則、禁手兩條會跳錯）
        b.addEventListener('click', function () { showHelpView('rules', g.fig, true); });
        li.appendChild(b);
      }
      ul.appendChild(li);
    });
  }
  // view：'rules'（規則說明）或 'gloss'（名詞對照表）；mark＝要標出來並捲到的那一段（規則說明的 fig-<mark>、對照表的 gl-<mark>）
  // exact：mark 就是規則說明的 fig-<mark>（名詞對照表的「看圖」用），不經過 TERM_FIG
  // v0.5.18（規格 AQ）：多一個 view 'opening'（這個開局的介紹，#helpOpening；標題由 renderOpeningSheet 寫開局名稱）
  function showHelpView(view, mark, exact) {
    var gloss = view === 'gloss', opv = view === 'opening', panel = $('ruleHelp').querySelector('.panel');
    if (gloss) renderGlossary();
    $('helpRules').hidden = gloss || opv;
    $('helpGloss').hidden = !gloss;
    $('helpOpening').hidden = !opv;
    $('ruleHelpTitle').textContent = opv ? '' : t(gloss ? 'gl.title' : 'help.title');
    panel.scrollTop = 0;
    Array.prototype.forEach.call(panel.querySelectorAll('.hl'), function (x) { x.classList.remove('hl'); });
    var target = mark ? $((gloss ? 'gl-' : 'fig-') + (gloss || exact ? mark : (TERM_FIG[mark] || mark))) : null;
    if (target) {
      target.classList.add('hl');
      panel.scrollTop = Math.max(0, target.offsetTop - panel.offsetTop - 12);
      // 焦點移到那一條／那一段，讀屏從這裡念（規則說明的圖和段落本身不能 Tab 到，給 tabindex=-1）
      if (target.tabIndex < 0 && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    } else if (gloss || opv) $('ruleHelpTitle').focus();
    else $('ruleHelpClose').focus();
  }
  var helpReturnFocus = null;
  function openHelpPanel(e) {
    var box = $('ruleHelp');
    // 面板已經開著（例如點圖說裡的名詞）：關掉時焦點還是回到最早開面板的地方
    if (box.hidden) helpReturnFocus = (e && e.currentTarget && e.currentTarget.focus) ? e.currentTarget : document.activeElement;
    box.hidden = false;
  }
  function openRuleHelp(e, term) {
    openHelpPanel(e);
    showHelpView('rules', typeof term === 'string' ? term : null);
  }
  // 名詞按鈕、光環標籤 → 名詞對照表的那一條（找不到條目的名詞退回規則說明的圖）
  function openGlossary(e, gl, term) {
    openHelpPanel(e);
    if (gl) showHelpView('gloss', gl);
    else showHelpView('rules', term || null);
  }

  // ---------------------------------------------------------- v0.5.18（規格 AQ）：點開局名稱看這個開局的介紹

  // 開局表（data/opening-table.json：Rapfi 當老師離線算的資料，只有資料、沒有 Rapfi 的程式）。第一次打開開局介紹時才讀，讀到就留著；
  // 讀不到（例如直接開 file://）這次顯示「打不開」，下次打開再試
  var OT = { data: null, loading: false, failed: false, waiters: [] };
  function loadOpeningTable(cb) {
    if (OT.data) { cb(); return; }
    OT.waiters.push(cb);
    if (OT.loading) return;
    OT.loading = true;
    OT.failed = false;
    var done = function (d) {
      OT.loading = false;
      if (d && Array.isArray(d.openings)) OT.data = d; else OT.failed = true;
      var w = OT.waiters;
      OT.waiters = [];
      w.forEach(function (f) { f(); });
    };
    if (!window.fetch) { done(null); return; }
    fetch(vurl('data/opening-table.json')).then(function (r) { return r.ok ? r.json() : null; }).then(done, function () { done(null); });
  }
  // 這個開局在這個規則下的那一份（free／renju）；前三手和 data/openings.js 對不上、或缺欄位就當成沒有資料
  function openingTableEntry(o, rule) {
    if (!OT.data || !o) return null;
    var list = OT.data.openings, hit = null;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].code === o.code) hit = list[i];
    if (!hit || !Array.isArray(hit.moves) || hit.moves.length !== 3) return null;
    for (var j = 0; j < 3; j++) if (hit.moves[j].r !== o.moves[j].r || hit.moves[j].c !== o.moves[j].c) return null;
    var x = hit[rule];
    if (!x || !Array.isArray(x.white4) || !x.white4.length || !I.has('opd.grade.' + x.grade)) return null;
    return x;
  }
  // 規格未定（主線再定）：「正確應手」＝黑方勝率和最好的一手差 OPD_NEAR 個百分點以內（同 AH-1 判斷題「答案」的界線）。
  // 白第 4 手：黑方勝率最低的那一手起算（white4 已經照對白最好的排好）；黑第 5 手：白第 4 手第一名之後，黑方勝率最高的那一手起算
  var OPD_NEAR = 5;
  function opdWhite4(x) {
    var best = x.white4[0].black;
    return x.white4.filter(function (w) { return typeof w.black === 'number' && w.black - best <= OPD_NEAR; });
  }
  function opdBlack5(x) {
    var b5 = x.white4[0].black5 || [];
    if (!b5.length) return [];
    var best = b5[0].black;
    b5.forEach(function (b) { if (b.black > best) best = b.black; });
    return b5.filter(function (b) { return typeof b.black === 'number' && best - b.black <= OPD_NEAR; });
  }
  // 小棋盤：stones＝[{r,c,black,n}]（實心子、寫手數）、marks＝[{r,c,black,n}]（半透明子＋橘圈、寫手數）。座標是這盤的方向；
  // 範圍＝天元周圍 R 格（opdRange：兩個小棋盤要畫的點離天元最遠的距離，至少 3 → 7×7；現行資料最遠就是 3）
  function opdRange(list) {
    var R = 3;
    list.forEach(function (m) { R = Math.max(R, Math.abs(m.r - 7), Math.abs(m.c - 7)); });
    return Math.min(R, 7);
  }
  function opdSVG(stones, marks, R) {
    var P = GT.current().svg;
    var n = 2 * R + 1, span = n * 20, s = svgBoard(n, span, 6);
    var xy = function (m) { return { x: 10 + (m.c - 7 + R) * 20, y: 10 + (m.r - 7 + R) * 20 }; };
    var num = function (p, k, black) {
      return '<text x="' + p.x + '" y="' + (p.y + 4) + '" text-anchor="middle" font-size="11" font-weight="700" fill="' + (black ? P.numB : P.numW) + '">' + k + '</text>';
    };
    // 每一顆包一層 <g data-kind data-pt data-n>（測試讀畫了什麼、畫在哪）
    var tag = function (kind, m) { return '<g data-kind="' + kind + '" data-pt="' + m.r + ',' + m.c + '" data-n="' + m.n + '" data-black="' + (m.black ? 1 : 0) + '">'; };
    stones.forEach(function (m) { var p = xy(m); s += tag('stone', m) + svgStone(p.x, p.y, m.black) + num(p, m.n, m.black) + '</g>'; });
    marks.forEach(function (m) {
      var p = xy(m);
      s += tag('mark', m) + '<g opacity="0.6">' + svgStone(p.x, p.y, m.black) + '</g>' +
        '<circle cx="' + p.x + '" cy="' + p.y + '" r="9" fill="none" stroke="' + P.plus + '" stroke-width="2"/>' + num(p, m.n, m.black) + '</g>';
    });
    return '<svg viewBox="0 0 ' + span + ' ' + span + '" aria-hidden="true" focusable="false">' + s + '</svg>';
  }
  function opdFigure(svg, cap, cls) {
    var f = mk('figure', 'opd-fig' + (cls ? ' ' + cls : ''));
    f.innerHTML = svg;
    f.appendChild(mk('figcaption', '', cap));
    return f;
  }

  // 開著的是哪一個開局：code、sym（這盤的方向，見 ai.js detectOpeningSym）、rule（'free'／'renju'）；seq：讀表回來時確認還是同一次打開。
  // v0.5.18 複審（主線）：live＝正在下、還沒下完的盤（對局頁、不是回頭看、還沒分出勝負）——介紹裡只放名稱、直止／斜止、前三步，
  // 不放等級、好點、接下來怎麼下、舊評價（都是提示；最強、天元與計分的盤本來不給提示），改成一句「下完這盤…可以看」；
  // noLink＝還沒下完的盤（含下到一半從「⋯」進的回頭看）：不放「看這個開局」的連結（資訊面板的連結不能讓人放棄這盤）
  var opd = { seq: 0, code: null, sym: 0, rule: 'free', live: false, noLink: false };
  function opdUnfinished() { return curPage === 'game' && S.review !== 'stats' && !S.over; }
  function openOpeningSheet(e, code, sym, rule) {
    var o = openingByCode(code);
    // 不是 26 種之一（代號對不到、資料沒載入）：照舊開名詞對照表「開局名稱」
    if (!o) { openGlossary(e, 'opening', 'opening'); return; }
    openHelpPanel(e);
    opd = { seq: opd.seq + 1, code: o.code, sym: sym >= 0 && sym < 8 ? sym | 0 : 0, rule: rule === 'renju' ? 'renju' : 'free',
      live: opdUnfinished(), noLink: opdUnfinished() }; // 主線：兩人下到一半從「⋯」進回頭看也算正在下（盤還沒結束，看好點等於提示）
    showHelpView('opening');
    if (!OT.data && !opd.live) {
      var seq = opd.seq;
      loadOpeningTable(function () {
        if (seq === opd.seq && !$('ruleHelp').hidden && !$('helpOpening').hidden) renderOpeningSheet();
      });
    }
    renderOpeningSheet();
  }
  function renderOpeningSheet() {
    var o = openingByCode(opd.code), box = $('helpOpening'), k = opd.sym;
    if (!o) return;
    $('ruleHelpTitle').textContent = openingName(o);
    box.textContent = '';
    var game = function (m) { return G.symPointInv ? G.symPointInv(k, m.r, m.c) : { r: m.r, c: m.c }; };
    var coords = function (list) { return list.map(function (m) { return coordName(m.r, m.c); }).join(t('opd.coordSep')); };
    var three = o.moves.map(function (m, i) { var p = game(m); return { r: p.r, c: p.c, black: i % 2 === 0, n: i + 1 }; });
    var x = opd.live ? null : openingTableEntry(o, opd.rule);
    var w4 = x ? opdWhite4(x).map(game) : [], b5 = x ? opdBlack5(x).map(game) : [], w0 = x ? game(x.white4[0]) : null;
    // 小棋盤：有資料時兩個（白棋第 4 步的好點；白棋下了第一名以後，黑棋第 5 步的好點），沒有資料時只畫前三步
    var figs = mk('div', 'opd-figs'), R = opdRange(three.concat(w4, b5));
    if (w4.length) {
      figs.appendChild(opdFigure(opdSVG(three, w4.map(function (p) { return { r: p.r, c: p.c, black: false, n: 4 }; }), R), t('opd.fig4'), 'opd-w4'));
      if (b5.length) {
        figs.appendChild(opdFigure(opdSVG(three.concat([{ r: w0.r, c: w0.c, black: false, n: 4 }]),
          b5.map(function (p) { return { r: p.r, c: p.c, black: true, n: 5 }; }), R), t('opd.fig5'), 'opd-b5'));
      }
    } else figs.appendChild(opdFigure(opdSVG(three, [], R), t('opd.fig3'), 'opd-three'));
    box.appendChild(figs);
    var ty = mk('p', 'opd-type');
    ty.appendChild(I.node(o.type === 'indirect' ? 'opd.type.indirect' : 'opd.type.direct'));
    box.appendChild(ty);
    // v0.5.18 複審：正在下的盤到這裡為止，只多一句去哪裡看
    if (opd.live) { box.appendChild(mk('p', 'opd-live', t('opd.live'))); return; }
    // 這個規則下誰比較有利（等級名照 AK 白話；不顯示勝率數字）
    box.appendChild(mk('h3', '', t('opd.gradeH')));
    if (x) {
      box.appendChild(mk('p', 'opd-grade', t('opd.grade', { rule: t(opd.rule === 'renju' ? 'rule.renju' : 'rule.free'), grade: t('opd.grade.' + x.grade) })));
      box.appendChild(mk('p', 'note opd-note', t('opd.gradeNote')));
      box.appendChild(mk('h3', '', t('opd.howH')));
      box.appendChild(mk('p', 'opd-w4line', t('opd.w4', { coords: coords(w4), n: w4.length })));
      if (b5.length) box.appendChild(mk('p', 'opd-b5line', t('opd.b5', { w: coordName(w0.r, w0.c), coords: coords(b5), n: b5.length })));
    } else {
      box.appendChild(mk('p', 'note opd-state', t(OT.loading ? 'opd.loading' : OT.failed ? 'opd.loadFail' : 'opd.noData')));
    }
    // 國際比賽的舊評價（data/openings.js，Wikipedia 轉錄；註明是以前連珠比賽規則下的看法）
    if (o.eval) box.appendChild(mk('p', 'opd-rif', t('opd.rif', { eval: evalText(o) })));
    if (opd.noLink) return; // 下到一半從「⋯」進的回頭看：沒有連結
    var go = mk('button', 'link opd-learn', t('opd.toLearn'));
    go.type = 'button';
    go.addEventListener('click', function () { goLearnOpening(o.code); });
    var gp = mk('p', 'opd-go');
    gp.appendChild(go);
    box.appendChild(gp);
  }
  // 「在練習 → 26 種開局看這個開局」：關掉面板、到開局列表、捲到這一個並標出來。
  // v0.5.18 複審：還沒下完的盤不放這個連結（noLink），萬一走到這裡也不離開這盤、不問放棄；下完的盤照「回到選單」收掉電腦與存的盤再走
  function goLearnOpening(code) {
    closeRuleHelp();
    if (opdUnfinished()) return;
    if (curPage === 'game' && S.review !== 'stats') { cancelAI(); dropResume(); }
    learnTab = 'openings';
    showPage('learn');
    markOpening(code);
  }
  function markOpening(code) {
    [].forEach.call(document.querySelectorAll('#learnOpenings .op-item.hl'), function (x) { x.classList.remove('hl'); });
    var li = $('op-' + code);
    if (!li) return;
    li.classList.add('hl');
    li.addEventListener('blur', function off() { li.classList.remove('hl'); li.removeEventListener('blur', off); });
    if (li.scrollIntoView) li.scrollIntoView({ block: 'center' });
    li.focus({ preventScroll: true });
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
  $('glossaryOpen').addEventListener('click', function () { showHelpView('gloss'); });
  $('glossaryBack').addEventListener('click', function () { showHelpView('rules'); });
  // 說明句裡的名詞（i18n.js 產生的 .term 按鈕、規則說明圖說裡的粗體名詞）→ 名詞對照表
  document.addEventListener('click', function (e) {
    var term = e.target.closest && e.target.closest('.term');
    if (!term) return;
    e.preventDefault();
    // v0.5.18（規格 AQ）：開局名稱 → 這個開局的介紹（不是對照表的通用條目）；方向、規則記在按鈕上（開局列表的沒有規則＝看選單的規則）
    if (term.hasAttribute('data-op')) {
      openOpeningSheet({ currentTarget: term }, term.getAttribute('data-op'), +term.getAttribute('data-op-sym') || 0,
        term.getAttribute('data-op-rule') || settings.rule);
      return;
    }
    var name = term.getAttribute('data-term');
    openGlossary({ currentTarget: term }, term.getAttribute('data-gl') || I.glossaryId(name), name);
  });

  // ---------------------------------------------------------- 頁面切換

  // 第十四批（規格 V）：四個分頁（下棋 play、練習 practice、紀錄 stats、我 me）＋第二層（練習題／開局 learn 在練習下、關於 about 在我下）
  // ＋對局畫面 game（不顯示分頁列）。切換只換顯示：每個分頁記得自己停在哪一頁、捲到哪裡；練習題的盤面和計時不重來。
  // v0.5.15（規格 AU 第二版）：擺棋盤研究 research 也在練習下（分頁列照常；兩人一起下、還沒下完時從回頭看進來的不顯示分頁列，見 researchFromReview）
  var PAGES = ['play', 'practice', 'learn', 'research', 'stats', 'me', 'about', 'game'];
  var TAB_OF = { play: 'play', practice: 'practice', learn: 'practice', research: 'practice', stats: 'record', me: 'me', about: 'me' };
  var tabView = { play: 'play', practice: 'practice', record: 'stats', me: 'me' };
  var scrollOf = {}, curPage = 'play';
  // noPonder：startGame 用（這時 S 還是上一盤，接著 newGame 會換盤面、自己先想），不在這裡先開一個馬上又關掉的預先思考
  function showPage(name, noPonder) {
    if (PAGES.indexOf(name) < 0) name = 'play';
    var prev = curPage;
    if (curPage !== 'game') scrollOf[curPage] = window.scrollY;
    PAGES.forEach(function (p) { $(p).hidden = p !== name; });
    curPage = name;
    document.body.setAttribute('data-page', name); // v0.5.10（規格 AS）：平板版面看這個（練習題／開局由 renderLearn 再細分）
    var tab = TAB_OF[name] || null;
    if (name === 'research' && RS.live) tab = null; // v0.5.15：下到一半的盤從回頭看進來研究，不給分頁列（只能按返回）
    if (prev === 'research' && name !== 'research') rsLeave();
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
    if (name !== 'game') cancelPonder(); // 第二十一批 b：不在對局畫面就不先想
    else if (prev !== 'game' && !noPonder) maybePonder(); // judge 第十一輪 F3：從別的分頁回到對局、輪到人時重新先想（條件 maybePonder 自己查）
    if (name !== 'learn') pzLeave(); // 第十二批 d：離開練習題就不再算對手的贏法（回來時重新出這一題）；計時暫停
    if (name === 'play') { syncMenuInputs(); maybeRecalNote(); } // 剛下完的局可能改了積分
    if (name === 'stats') renderStats();
    if (name === 'practice') { loadPuzzles(); renderDailyCard(); } // v0.5.17（規格 AV）：今天的題目那張卡要題庫才知道是哪一題
    if (name === 'learn') renderLearn();
    window.scrollTo(0, name === 'game' ? 0 : scrollOf[name] || 0);
    if (name === 'research') rsEnter(); // v0.5.15：捲回原位以後再量棋盤（量的是棋盤上緣離頁面頂端多遠）
  }
  document.querySelectorAll('#tabbar [data-tab]').forEach(function (b) {
    b.addEventListener('click', function () { showPage(tabView[b.getAttribute('data-tab')]); });
  });

  // 第二十批 b（主線核准）：v0.5.2 重量了電腦每一級的分數。目前帳號有「沒有 oppRating 欄位」的紀錄＝這一版以前下的（這一版起每一盤
  // 都寫這個欄位，兩人對下寫 null），就在下棋分頁說一次；出現時就記成看過（recalSeen），關掉或離開都不再出現。新帳號不出現
  // 第二十四批（規格 AB）：難度 v3 重新設計了入門到中・3 的電腦、分數也重新量過。recalSeen 改成版本鍵（RECAL_VER）：
  // 看過上一次告知的（存 true）還要再看一次。「舊」＝目前帳號有沒有 ladder 欄位的紀錄（這一版起每一盤都寫 ladder；兩人對下的也算，
  // 和第二十批 b 一樣：推薦對手看的是帳號分數對電腦的分數，有戰績的帳號都受影響）
  function maybeRecalNote() {
    if (settings.recalSeen === RECAL_VER || !$('recalNote').hidden) return;
    var pr = me();
    if (!pr) return;
    var old = GS.loadFor(pr.id).some(function (g) { return g.ladder !== RECAL_VER; });
    if (!old) return;
    $('recalNote').hidden = false;
    settings.recalSeen = RECAL_VER;
    saveSettings();
  }
  $('recalClose').addEventListener('click', function () { $('recalNote').hidden = true; });

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

  // 段數列的一顆（天元那一批，規格 AC 第 1 條、AN）：弱、中、強寫數字 1–4；最強那一級寫名字「最強」「天元」（用名字不用數字）。
  // 天元那顆是黑漆金字（.tg）：字前一個金色小勾（選到才看得到）、書法字、字旁一顆小金點（棋盤正中央那一點）。只在內容變了才重畫
  function renderSubLabel(lab, g, tier, i) {
    if (tier == null) return; // 天元那一批複審：這一級沒有這一段（藏起來的那幾顆）不寫字（原本寫成 tier.undefined）
    var sp = lab.querySelector('span'), tg = tier === TENGEN_TIER;
    var key = g === 'expert' ? (tg ? 'tg|' : 'n|') + I.getLang() + '|' + tier : 'd|' + (i + 1);
    lab.classList.toggle('tg', tg);
    if (sp.getAttribute('data-k') === key) return;
    sp.setAttribute('data-k', key);
    sp.textContent = '';
    if (g !== 'expert') { sp.textContent = String(i + 1); return; }
    if (!tg) { sp.textContent = tierName(tier); return; }
    var ck = document.createElementNS(SVG_NS, 'svg'), path = document.createElementNS(SVG_NS, 'path');
    ck.setAttribute('class', 'tg-ck');
    ck.setAttribute('viewBox', '0 0 12 12');
    ck.setAttribute('aria-hidden', 'true');
    path.setAttribute('d', 'M2.2 6.4 4.9 9.1 9.8 3');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.9');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    ck.appendChild(path);
    sp.appendChild(ck);
    sp.appendChild(tgMark());
    var star = mk('i', 'tg-star');
    star.setAttribute('aria-hidden', 'true');
    sp.appendChild(star);
  }

  function syncMenuInputs() {
    setRadio('mode', settings.mode);
    setRadio('rule', settings.rule);
    setRadio('side', String(settings.side));
    var pr = pref(), g = pr.group, subs = GROUP_TIERS[g];
    setRadio('level', g);
    $('subSeg').hidden = subs.length < 2;
    Array.prototype.forEach.call(document.querySelectorAll('#subSeg label'), function (lab, i) { lab.hidden = i >= subs.length; renderSubLabel(lab, g, subs[i], i); });
    if (subs.length > 1) setRadio('sub', String(subs.indexOf(pr.sub[g]) + 1));
    renderHintSwitches();
    setRadio('pvpLay', settings.pvpLay);
    renderClockCard();
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
  // 第二十四批：加上棋鐘（這盤實際用的：跟電腦下存著每盤限時＝不限時）
  function setupKey() {
    var k = [settings.mode, settings.rule, settings.rule === 'renju' ? myForbid() : ''];
    if (settings.mode === 'pvp') { var pp = pvpPids(); k.push(pp.b, pp.w); } else k.push(me().id, menuTier(), settings.side);
    k.push(JSON.stringify(clockRec(clockCfg(settings.mode, settings.side, myClock()))));
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
  // 下棋分頁的大按鈕（第十四批，規格 V）：和上次一樣＝「再下一盤」；沒有上次或改過＝「開始下棋」
  // 第二十二批（規格 Y 第 2 條、選單 A）：按鈕裡的第二行一律寫「按下去會用的設定」（不是上次），卡片改了跟著變；原本按鈕下方「上次：…」那行拿掉
  function renderStartBtn() {
    var again = !!settings.last && settings.last === setupKey();
    $('startMain').textContent = t(again ? 'menu.again' : 'menu.start');
    var rule = ruleLabel(settings.rule, settings.rule === 'renju' && myForbid() === 'lose');
    var sub = settings.mode === 'pvp' ? t('menu.setupPvp', { rule: rule })
      : t('menu.setupPve', { tier: tierName(menuTier()), rule: rule, color: colorName(settings.side) });
    // 第二十四批（規格 Z4）：大按鈕第二行寫棋鐘設定（不限時不寫）
    var cfg = clockCfg(settings.mode, settings.side, myClock());
    if (cfg) sub += t('game.infoSep') + clockLabel(cfg);
    $('startSub').textContent = sub;
  }

  // 第二十四批（規格 Z4、Z7 第 2 條、AA 第 3 條）：選單的棋鐘卡。跟電腦下：不限時／每步限時（提醒、不判輸、不影響分數）；
  // 兩人一起下多「每盤限時」（用完判輸）與「兩人時間不同」開關（模式共用，只分時間：黑、白兩排）。存在目前帳號
  function radioSeg(name, opts, cur, label) {
    var seg = mk('div', 'seg');
    seg.setAttribute('role', 'radiogroup');
    if (label) seg.setAttribute('aria-label', label);
    opts.forEach(function (o) {
      var lab = mk('label'), inp = mk('input');
      inp.type = 'radio'; inp.name = name; inp.value = String(o.v);
      inp.checked = String(o.v) === String(cur);
      lab.appendChild(inp);
      lab.appendChild(mk('span', '', o.text));
      seg.appendChild(lab);
    });
    return seg;
  }
  function renderClockCard() {
    var c = myClock(), pvp = settings.mode === 'pvp';
    var kind = !pvp && c.kind === 'game' ? 'none' : c.kind;
    var kinds = [{ v: 'none', text: t('clock.none') }, { v: 'move', text: t('clock.move') }];
    if (pvp) kinds.push({ v: 'game', text: t('clock.game') });
    var box = $('clockKind');
    box.textContent = '';
    [].slice.call(radioSeg('clockKind', kinds, kind).childNodes).forEach(function (n) { box.appendChild(n); });
    // v0.5.5：時間、兩人時間不同、小字都在 #clockSub 小區裡（不限時就整個藏起來），小標「每步幾秒／每盤幾分鐘」
    $('clockSub').hidden = kind === 'none';
    $('clockSubLabel').textContent = kind === 'none' ? '' : t(kind === 'move' ? 'clock.subMove' : 'clock.subGame');
    $('clockSplitRow').hidden = !pvp || kind === 'none';
    $('clockSplit').checked = pvp && c.split;
    var opts = $('clockOpts');
    opts.textContent = '';
    if (kind !== 'none') {
      var list = kind === 'move' ? CLOCK_MOVE : CLOCK_GAME;
      var text = function (v) { return kind === 'move' ? t('clock.sec', { n: v }) : t('clock.min', { n: v }); };
      var items = list.map(function (v) { return { v: v, text: text(v) }; });
      if (pvp && c.split) {
        var pp = pvpPids();
        // v0.5.10（規格 AT）：兩人時間不同時，每一排最前面多一個「不限時」（大人讓小孩、高手讓新手）
        var rowItems = [{ v: CLOCK_NONE, text: t('clock.none') }].concat(items);
        [[1, 'B', pp.b], [2, 'W', pp.w]].forEach(function (a) {
          var p = GS.profile(a[2]);
          var lb = t('clock.rowColor', { color: colorName(a[0]), name: p ? p.name : '' });
          opts.appendChild(mk('p', 'clock-row-label', lb));
          var seg = radioSeg('clockVal' + a[1], rowItems, c[kind + a[1]], lb);
          seg.classList.add('clock-row'); // 一排五格：數字和單位不拆成兩行（style.css v0.5.10 規格 AT）
          opts.appendChild(seg);
        });
      } else opts.appendChild(radioSeg('clockVal', items, c[kind], t(kind === 'move' ? 'clock.move' : 'clock.game')));
    }
    $('clockNote').textContent = kind === 'move' ? t(pvp ? 'clock.noteMovePvp' : 'clock.noteMove') : kind === 'game' ? t('clock.noteGame') : '';
  }
  $('play').addEventListener('change', function (e) {
    var el = e.target, n = el && el.name;
    if (n !== 'clockKind' && n !== 'clockVal' && n !== 'clockValB' && n !== 'clockValW' && el.id !== 'clockSplit') return;
    var c = myClock();
    if (n === 'clockKind') c.kind = el.value;
    else if (el.id === 'clockSplit') {
      c.split = el.checked;
      if (c.split) { c.moveB = c.moveW = c.move; c.gameB = c.gameW = c.game; } // 剛打開時兩邊從目前的時間開始
    } else {
      var v = Number(el.value), key = c.kind + (n === 'clockValB' ? 'B' : n === 'clockValW' ? 'W' : '');
      c[key] = v;
    }
    saveClock(c);
    setupChanged();
  });
  // 兩人一起下：手機平放在中間（上方座位條轉 180°）／輪流拿手機（都不轉）。跟著這台裝置、記住上次選的；不影響「再下一盤」
  document.querySelectorAll('input[name="pvpLay"]').forEach(function (el) {
    el.addEventListener('change', function () {
      settings.pvpLay = this.value === 'hand' ? 'hand' : 'flat';
      saveSettings();
    });
  });

  function renderLevelNote() {
    var tier = menuTier(), r = aiRating(tier);
    $('recommendBtn').hidden = !RT || !RT.recommendTier || !G.TIERS;
    var note = recNote || (r == null ? '' : t('level.note', { tier: tierName(tier), rating: Math.round(r) }));
    // 第十四批（W 第 12 條）：選「入門」時旁邊一句「下贏了再換更強的」（v0.5.13：入門・1、入門・2 都有）
    if (tierGroup(tier) === 'novice') note = (note ? note + (I.getLang() === 'en' ? '. ' : '。') : '') + t('level.noviceTip');
    $('levelNote').textContent = note;
  }

  function onMenuChange() {
    cancelPonder(); // 第二十一批 b：換對手、規則、等級、執子
    settings.mode = radioValue('mode') === 'pvp' ? 'pvp' : 'pve';
    settings.rule = radioValue('rule') === 'renju' ? 'renju' : 'free';
    var g = radioValue('level'), pr = pref();
    if (GROUPS.indexOf(g) >= 0 && g !== pr.group) { pr.group = g; savePref(pr); recNote = null; }
    settings.side = radioValue('side') === '2' ? 2 : 1;
    setupChanged();
  }
  function onSubChange() {
    cancelPonder(); // 第二十一批 b：換段數也是換階
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
  // 「我」分頁的兩個提示開關（規格 Z8 最後一條、Z9 第 4 條）：顯示「目前選的對手」下的實際狀態；最強不提供（關、灰掉）。
  // 一動就寫成 true／false（hintsSet、ownRoadSet 記下「動過了」）。不影響 setupKey；對局中切換時馬上重算
  // 規格 AL（v0.5.5 作者拍板）：選單選了兩人一起下時，「危險提醒」「機會提示」都不管兩人一起下（每位玩家在選玩家的地方各自選）：
  // 兩個都灰掉、顯示存著的值（跟電腦下時用的），下面一行說去哪裡選；教學可以開，小字寫只對選「危險＋機會」的玩家有用
  function renderHintSwitches() {
    var mode = settings.mode, tier = menuTier(), top = mode === 'pve' && noHintTier(tier), pvp = mode === 'pvp';
    $('optHints').checked = pvp ? !!settings.hints : hintsOn(mode, tier);
    $('optHints').disabled = top || pvp;
    $('hintsPvpNote').textContent = pvp ? t('opt.hintsPvp') : '';
    var own = pvp ? settings.ownRoad === true : ownRoadOn(mode, tier);
    $('optOwnRoad').checked = own;
    $('optOwnRoad').disabled = top || pvp;
    // 規格 Z10：教學開關要兩個提示開關當下都生效才能開；不能開時灰掉並寫原因（兩人一起下：看每位玩家選的）
    var can = pvp ? true : hintsOn(mode, tier) && own;
    $('optTeach').checked = can && settings.teach === true;
    $('optTeach').disabled = !can;
    $('teachNote').textContent = pvp ? t('opt.teachPvp') : can ? '' : t(top ? 'opt.teachNoExpert' : 'opt.teachNeed');
  }
  $('optHints').addEventListener('change', function () {
    settings.hints = this.checked;
    settings.hintsSet = true;
    saveSettings();
    renderHintSwitches();
    refreshHints();
  });
  $('optOwnRoad').addEventListener('change', function () {
    settings.ownRoad = this.checked;
    settings.ownRoadSet = true;
    saveSettings();
    renderHintSwitches();
    refreshHints();
  });
  $('optTeach').addEventListener('change', function () {
    settings.teach = this.checked;
    saveSettings();
    refreshHints();
  });
  // 電腦先想（「我」分頁，第二十一批 b）：關掉時馬上停
  $('optPonder').addEventListener('change', function () {
    settings.ponder = this.checked;
    saveSettings();
    if (!settings.ponder) cancelPonder();
    else maybePonder();
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
    $('game').setAttribute('data-theme', GT.currentId()); // 第二十四批：高對比風格時棋罐「輪到」改粗框（CSS）
    setRadio('theme', GT.currentId());
    setRadio('themeQuick', GT.currentId());
    renderFigs();
    bv.redraw();
    if (S.review) RV.render(); // 圖例的顏色跟著換
    if (pzView) pzView.redraw();
    if (rsView) rsView.redraw(); // v0.5.15 複審：擺棋盤研究的棋盤也跟著換風格
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
    $('optPonder').checked = settings.ponder !== false;
    setRadio('placeMode', settings.placeMode);
  }
  // 「更多 → 外觀」的五格和換風格面板的五格（第九批 b）是同一個設定：都存進目前帳號、只重畫
  document.querySelectorAll('input[name="theme"], input[name="themeQuick"]').forEach(function (el) {
    el.addEventListener('change', function () {
      GS.updateProfile(me().id, { theme: this.value });
      applyTheme();
    });
  });

  // 第九批 b：對局、回頭看、練習題畫面的「換風格」面板。Esc、點面板外、關閉鈕都能關；焦點鎖在面板內，關掉後回到打開它的按鈕
  // 第二十五批：回頭看與練習題的「換風格」鈕拿掉，面板只從對局「⋯」的「外觀」（#gameThemeBtn）打開
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
  // 規格 AM：下子方式（跟著這台裝置）。換了就把還沒確認的預覽子收掉
  document.querySelectorAll('input[name="placeMode"]').forEach(function (el) {
    el.addEventListener('change', function () {
      settings.placeMode = this.value === 'confirm' ? 'confirm' : 'direct';
      saveSettings();
      S.preview = null; PZ.preview = null;
    });
  });
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
    fillHintSel($('pvpHintB'), settings.pvpHintB);
    fillHintSel($('pvpHintW'), settings.pvpHintW);
  }
  // v0.5.5：每位玩家的提示是一個小下拉選單（關／危險／機會／危險＋機會）
  function fillHintSel(sel, v) {
    sel.textContent = '';
    PVP_HINTS.forEach(function (k) { var o = mk('option', '', t('pvp.hint.' + k)); o.value = k; sel.appendChild(o); });
    sel.value = v;
  }
  // 規格 AL：每位玩家的提示（選單、對局「⋯」兩處是同一個設定）。不影響「再下一盤」；對局中改了馬上重算
  function setPvpHint(side, v) {
    settings[side === 1 ? 'pvpHintB' : 'pvpHintW'] = normPvpHint(v);
    saveSettings();
    renderPvpPicks();
    renderSheetHints();
    if (!$('game').hidden && S.mode === 'pvp') refreshHints();
    saveResume(); // v0.5.12（規格 AP-1）：對局中在「⋯」改了提示，接著下時照改過的
  }
  function renderSheetHints() {
    var pvp = S.mode === 'pvp';
    $('sheetHints').hidden = !pvp;
    if (!pvp) return;
    [[1, 'B', S.pidB], [2, 'W', S.pidW]].forEach(function (a) {
      var p = GS.profile(a[2]);
      $('sheetHint' + a[1] + 'Text').textContent = t('pvp.hintSheet', { color: colorName(a[0]), name: p ? p.name : '' });
      fillHintSel($('sheetHint' + a[1]), pvpHintFor(a[0]));
    });
  }
  $('pvpHintB').addEventListener('change', function () { setPvpHint(1, this.value); });
  $('pvpHintW').addEventListener('change', function () { setPvpHint(2, this.value); });
  $('sheetHintB').addEventListener('change', function () { setPvpHint(1, this.value); });
  $('sheetHintW').addEventListener('change', function () { setPvpHint(2, this.value); });
  ['pvpB', 'pvpW'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      settings[id] = this.value;
      var pp = pvpPids();
      settings.pvpB = pp.b; settings.pvpW = pp.w;
      setupChanged(); // 第十六批：原本只重畫兩個下拉選單，大按鈕的「再下一盤」沒跟著換
    });
  });
  // v0.5.10（規格 AT）：交換黑白。兩位玩家對調，提示（pvpHintB／W）跟著人走，「兩人時間不同」的時間也跟著人走（moveB↔moveW、gameB↔gameW）。
  // 「兩人時間不同」關著時也一起對調（用不到；再打開時兩邊照舊從共用的時間開始），這樣開關怎麼切都不會把時間配錯人。
  // b、w：要換成的黑、白帳號（選單的「⇅ 交換」用選單上的兩位；結算卡的「換邊再下一盤」用這盤的兩位）
  function swapClockSides(c) {
    var m = c.moveB, g = c.gameB;
    c.moveB = c.moveW; c.moveW = m;
    c.gameB = c.gameW; c.gameW = g;
    return c;
  }
  function swapPvpSetup(b, w) {
    var h = settings.pvpHintB;
    settings.pvpB = b; settings.pvpW = w;
    settings.pvpHintB = settings.pvpHintW; settings.pvpHintW = h;
    saveClock(swapClockSides(myClock()));
  }
  $('pvpSwap').addEventListener('click', function () {
    var pp = pvpPids();
    swapPvpSetup(pp.w, pp.b);
    setupChanged(); // 存設定、選單（兩位玩家、提示、棋鐘的黑白兩排）與大按鈕第二行重畫
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
    cancelPonder(); // 第二十一批 b
    applyTheme(); // 換帳號＝換成那個帳號的棋盤風格
    setupChanged();
    if (!$('stats').hidden) renderStats();
    if (!$('practice').hidden) renderDailyCard(); // v0.5.17（規格 AV）：每日一題每個帳號各自記
    // v0.5.17 複審（judge）：今天的題目頁是上一個帳號的（做對了、解好的盤面）：下次進去重新出題，正開著就馬上重出
    learnDone.daily = false;
    if (!$('learn').hidden && learnTab === 'daily') renderLearn();
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

  // 紀錄列表每一筆的小字：棋鐘設定（不限時不寫）、時間用完、教學局（真的沒計分的那種）
  function recTags(g) {
    var out = [], cfg = cfgFromRec(g.clock);
    if (cfg) out.push(clockLabel(cfg));
    if (g.end === 'time') out.push(t('stats.timeUp'));
    // v0.5.11（規格 AO）：認輸、求和（說好和棋）、放棄（跟電腦下超過 10 手）分得出來；舊紀錄沒有這三種
    var tag = GS.endTag(g);
    if (tag) out.push(t('stats.tag.' + tag));
    if (g.eloSkip === 'teach') out.push(t('game.teachTag'));
    return out;
  }
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
      badgeName: badgeName,
      recTags: recTags // judge 第十三輪 F3：列表每筆的棋鐘設定、時間用完、教學局
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
  var learnDone = { puzzles: false, openings: false, daily: false }; // v0.5.17：多「今天的題目」（daily）

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
      var hd = mk('h3', 'learn-h');
      hd.appendChild(I.node(grp[1])); // 規格 AK：直止／斜止可以點
      box.appendChild(hd);
      var ul = mk('ul', 'op-list');
      items.forEach(function (o) {
        var li = mk('li', 'op-item');
        li.id = 'op-' + o.code; // v0.5.18（規格 AQ）：開局介紹的「在練習 → 26 種開局看這個開局」捲到這一個、標出來（markOpening）
        li.tabIndex = -1;
        var fig = mk('div', 'op-fig');
        fig.innerHTML = miniSVG(normMoves(o.moves));
        li.appendChild(fig);
        var body = mk('div', 'op-body');
        var nm = mk('div', 'op-name');
        nm.appendChild(openingTerm('learn.opName', o, 0, null)); // 規格 AK：開局名稱可以點；v0.5.18（規格 AQ）：打開這個開局的介紹（標準方向、選單的規則）
        body.appendChild(nm);
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
    t0: 0, acc: 0, timer: null, elapsed: 0, calc: null, stale: false,
    daily: null, saved: null, dailyNote: null }; // v0.5.17（規格 AV）：dailyNote＝下一次那一行前面加的一句（日期變了）；daily＝正在出今天的題目 { key 那天的日期, id 題目 id }；saved＝進今天的題目之前一般練習題的題型、步數、第幾題
  var pzView = BoardView($('pzBoard'));
  var pzZoom = BoardZoom(pzView, $('pzFrame'), $('pzLayer'), $('pzZoomReset')); // 規格 AM：練習題的棋盤也能放大

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
      if (!$('practice').hidden) renderDailyCard(); // v0.5.17（規格 AV）
    };
    if (!window.fetch) { done(null); return; }
    fetch(vurl('data/puzzles.json')).then(function (r) { return r.ok ? r.json() : null; }).then(done, function () { done(null); });
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
    // v0.5.17（規格 AV）：「今天的題目」（learnTab 'daily'）用同一個畫面
    if ($('learn').hidden || (learnTab !== 'puzzles' && learnTab !== 'daily')) { learnDone.puzzles = false; learnDone.daily = false; return; }
    pzSyncMode();
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
    $('pzWrongNote').hidden = true; // 第十七批：答錯小字（棋盤下方）只屬於這一題的這一次作答
    $('pzWrongNote').textContent = '';
    $('pzDaily').hidden = true; // v0.5.17：出好題目才寫（renderPzDaily）
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
    PZ.preview = null; // 規格 AM
    pzZoom.reset(false);
    var player = p.player === 2 ? 2 : 1;
    // 練習題不是對局設定，規則只寫名稱（不帶「不讓下／下了就輸」）
    // v0.5.17（規格 AV）：今天的題目不寫「第幾題」，改寫題型與步數（同練習分頁的卡）
    var ruleName = t(pzRule(p) === 'renju' ? 'rule.renju' : 'rule.free');
    info.textContent = PZ.daily ? t('daily.info', { what: dailyWhat(p), color: colorName(player), rule: ruleName })
      : t('learn.pzInfo', { i: PZ.idx + 1, n: list.length, color: colorName(player), rule: ruleName });
    renderPzDaily();
    msg.textContent = '';
    var ask = PZ.kind === 'defend' ? 'learn.pzAskDefend' : 'learn.pzAskAttack';
    msg.appendChild(I.node(pzN(p) === 1 ? ask + '1' : ask, { n: pzN(p), color: colorName(player), opp: colorName(3 - player) }));
    $('pzShow').hidden = true;
    $('pzShow').textContent = t(PZ.daily ? 'daily.pzShow' : 'learn.pzShow'); // v0.5.17 複審：今天的題目叫「看答案」（進攻、防守都有）
    pzFit();
    pzDraw();
    startPzTimer();
  }

  // 第十二批 c：棋盤不超過首屏——寬度之外，高度也不超過「畫面高度減掉棋盤上緣（頁面頂端算起）」，最小 260
  // 第十六批（judge 第八輪）：抽出來；答題後訊息變長（答錯的句子、算對手贏法的「取消」、小字）會把棋盤往下推，
  // 所以訊息的高度一變就重算（ResizeObserver 看 #pzMsg，不用每條答題路徑各補一次）
  // v0.5.10（規格 AS）：平板。直拿：上限從 420 改 960，高度再扣掉棋盤下那排按鈕（上一題／再試一次／下一題也在第一屏）；
  // 橫拿：棋盤在左（style.css 把 #pzArea 攤平成兩欄的格子），寬＝練習題頁的寬扣掉右欄，高＝棋盤上緣到分頁列。棋盤大小寫到 #learn 的 --pzsz。
  // pzFitW＝上次算的時候視窗多寬（轉向後在別頁、回來時要重算）
  var pzFitW = 0;
  // v0.5.10 複審（judge）：開局那一頁（#learnPuzzles 藏著）時也不算——原本在開局頁轉向時量到寬 0、退回 340，又記下 pzFitW，回到練習題就不再重算
  function pzFit(shrinkOnly) {
    if ($('learn').hidden || $('learnPuzzles').hidden || $('pzArea').hidden) return;
    var lay = tabletMode(), w;
    pzFitW = window.innerWidth;
    var top = $('pzFrame').parentNode.getBoundingClientRect().top + window.scrollY; // 規格 AM：量 .pz-board（放大那一層有 transform，不量它）
    var tb = $('tabbar').hidden ? 0 : $('tabbar').offsetHeight; // 第十四批：底部分頁列蓋住的高度不算
    if (lay === 'land') {
      // v0.5.10 複審（judge）：高度扣 main 的下留白（分頁列＋安全區＋12），不是分頁列＋8——原本整頁多 4px、會捲
      var padB = parseFloat(getComputedStyle(document.querySelector('main')).paddingBottom) || (tb + 8);
      w = Math.floor(Math.min($('learn').clientWidth - SIDE_GAP - SIDE_MIN, BOARD_MAX, Math.max(260, window.innerHeight - top - padB)));
    } else {
      w = Math.min($('pzArea').clientWidth || 340, lay ? BOARD_MAX : 420);
      var room = window.innerHeight - top - 8 - tb;
      if (lay) { var rb = $('pzArea').querySelector('.row-btns'); room -= rb.offsetHeight + (parseFloat(getComputedStyle(rb).marginTop) || 0); }
      w = Math.floor(Math.min(w, Math.max(260, room)));
    }
    // 出題時照算出來的大小；答題後（shrinkOnly）只縮不放大，訊息變短時棋盤不跟著跳大
    if (w !== pzView.geo.css && !(shrinkOnly && w > pzView.geo.css)) pzView.setSize(w); // setSize 會用上次的畫面重畫（播放中也一樣）
    $('learn').style.setProperty('--pzsz', pzView.geo.css + 'px');
  }
  if (window.ResizeObserver) new ResizeObserver(function () { pzFit(true); }).observe($('pzMsg'));

  function pzDraw(extra) {
    var p = pzList()[PZ.idx];
    if (!p) return;
    // 第十四批（W 第 4 條「棋盤畫座標或句子不寫座標，選一」）：選畫座標，答案句裡的「H8」在棋盤邊上找得到
    var v = { board: PZ.board, coords: true, forbidden: pzRule(p) === 'renju' && (p.player === 2 ? 2 : 1) === 1 && PZ.state === 'ask' };
    if (PZ.preview && PZ.state === 'ask') v.preview = { r: PZ.preview.r, c: PZ.preview.c, p: p.player === 2 ? 2 : 1 }; // 規格 AM：點兩下確認的預覽子
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
  // 規格 AK：句子裡的名詞（禁手種類）做成可點的按鈕；開頭的空白照 pzAppend
  function pzAppendTerms(msg, key, params) {
    msg.appendChild(document.createTextNode(I.getLang() === 'en' ? ' ' : ''));
    msg.appendChild(I.node(key, params));
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
      pzAppendTerms(msg, 'learn.pzForbiddenBlock', { kind: I.forbiddenTerm(fb.kind) });
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
    // 規格 AM：點兩下確認——第一下出預覽子（點別處就移過去），同一點再點一下才算作答；作答後放大的棋盤縮回原大小
    if (settings.placeMode === 'confirm' && !(PZ.preview && PZ.preview.r === m.r && PZ.preview.c === m.c)) {
      PZ.preview = { r: m.r, c: m.c };
      pzDraw();
      return;
    }
    PZ.preview = null;
    pzZoom.afterPlace();
    var player = p.player === 2 ? 2 : 1, rule = pzRule(p);
    var ans = pzAnswers(p);
    var ok = ans.some(function (a) { return a.r === m.r && a.c === m.c; });
    stopPzTimer();
    pzRecord(p, ok);
    dailyAnswer(p, ok ? 'right' : 'wrong'); // v0.5.17（規格 AV）：今天的題目另外記（做對＝今天完成；第一次作答對不對另記）
    var msg = $('pzMsg');
    msg.removeAttribute('data-fb');
    // v0.5.17 複審（judge）：今天的題目答錯不露答案——不寫座標、不畫綠圈、防守題也不播對手怎麼贏（對手的第一手常常就是答案那一點）；
    // 只說這一步不對、框出剛點的那一點。要看答案按「看答案」（進攻、防守都有），按了今天就不算完成（見 pzDailyShow）。一般練習題照舊
    if (!ok && PZ.daily) {
      PZ.state = 'wrong';
      msg.textContent = t(PZ.kind === 'defend' ? 'daily.pzWrongDefend' : pzN(p) === 1 ? 'daily.pzWrongAttack1' : 'daily.pzWrongAttack', { n: pzN(p) });
      $('pzShow').hidden = false;
      pzDraw({ frames: [{ r: m.r, c: m.c, color: 'losing' }] });
      return;
    }
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
        pzAchLine(msg);
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
      pzAchLine(msg);
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
            pzAppendTerms(msg, 'learn.pzForbiddenBlock', { kind: I.forbiddenTerm(oline.fb.kind) });
            cross = [{ r: oline.fb.r, c: oline.fb.c }];
          }
          var keep = { frames: [{ r: m.r, c: m.c, color: 'losing' }], rings: ringsOf(ans), crosses: cross };
          pzAnimate(b, oline, 3 - player, rule, keep);
        } else {
          // 第十二批 c：算不出對手怎麼贏（或算出的下法模擬不過）就不播，只標出答案
          msg.textContent = t('learn.pzWrongNoLine', { coords: coordsOf(ans) });
          // 第十七批（judge 第九輪）：三種原因的小字放棋盤下方（#pzWrongNote），不放訊息裡——英文五行時 667 棋盤會壓到分頁列
          $('pzWrongNote').textContent = t('learn.pzWrongNoLineNote');
          $('pzWrongNote').hidden = false;
          pzDraw({ last: m, rings: ringsOf(ans) });
        }
      });
    }
  });
  $('pzShow').addEventListener('click', function () {
    var p = pzList()[PZ.idx];
    if (!p) return;
    if (PZ.daily) { pzDailyShow(p); return; } // v0.5.17 複審：今天的題目的「看答案」
    var ans = pzAnswers(p), player = p.player === 2 ? 2 : 1, line = pts(p.line || []);
    if (!pzLineOK(pzBoard(p), line, player, pzRule(p))) { $('pzShow').hidden = true; return; }
    pzAnimate(pzBoard(p), line, player, pzRule(p), { rings: ringsOf(ans), crosses: pzForbiddenNote(p, $('pzMsg')) });
  });
  // v0.5.17 複審（judge）：今天的題目答錯以後的「看答案」（進攻、防守都有）：記成看過答案（之後再做對也不算今天完成），
  // 寫出答案、畫綠圈（防守題要接著下的那一手畫藍圈）；進攻題的下法模擬得過就照一般練習題播一次。按「重來」可以自己再下
  function pzDailyShow(p) {
    dailyAnswer(p, 'peek');
    $('pzShow').hidden = true;
    var ans = pzAnswers(p), player = p.player === 2 ? 2 : 1, line = pts(p.line || []), rule = pzRule(p), msg = $('pzMsg');
    msg.textContent = t('daily.pzAnswer', { coords: coordsOf(ans) });
    msg.removeAttribute('data-fb');
    var keep = { rings: ringsOf(ans), crosses: pzForbiddenNote(p, msg) }, fu = PZ.kind === 'defend' && ans.length ? pzFollowUp(p, ans[0]) : null;
    if (fu) { pzAppend(msg, 'learn.pzFollowUp', { coord: coordName(fu.r, fu.c) }); keep.rings.push({ r: fu.r, c: fu.c, color: PZ_FOLLOW_COLOR }); }
    if (PZ.kind === 'attack' && pzLineOK(pzBoard(p), line, player, rule)) pzAnimate(pzBoard(p), line, player, rule, keep);
    else { PZ.board = pzBoard(p); pzDraw(keep); }
  }
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
  $('pracDaily').addEventListener('click', function () { learnTab = 'daily'; showPage('learn'); }); // v0.5.17（規格 AV）
  $('pracOpenings').addEventListener('click', function () { learnTab = 'openings'; showPage('learn'); });
  document.querySelectorAll('input[name="learnSide"]').forEach(function (el) {
    el.addEventListener('change', function () { settings.learnSide = this.value === '1' ? 1 : 2; saveSettings(); });
  });

  function renderLearn() {
    // v0.5.17（規格 AV）：今天的題目（'daily'）是練習題畫面：版面同練習題（data-page learn-puzzles），#learn.daily 藏起題型、步數、上一題／下一題
    var pz = learnTab !== 'openings';
    document.body.setAttribute('data-page', 'learn-' + (pz ? 'puzzles' : 'openings')); // v0.5.10（規格 AS）：練習題在平板放寬／分兩欄，開局維持一欄
    $('learn').classList.toggle('daily', learnTab === 'daily');
    $('learnTitle').textContent = t(learnTab === 'puzzles' ? 'learn.tabPuzzles' : learnTab === 'daily' ? 'daily.title' : 'learn.tabOpenings');
    setRadio('learnSide', String(settings.learnSide));
    $('learnOpeningsWrap').hidden = learnTab !== 'openings';
    $('learnPuzzles').hidden = !pz;
    if (learnTab === 'openings') {
      if (!learnDone.openings) renderOpenings();
    } else {
      loadPuzzles();
      // v0.5.17：從今天的題目換到一般練習題（或反過來）、或今天的題目已經換日了，就重新出題
      var modeOff = (learnTab === 'daily') !== !!PZ.daily || (PZ.daily && PZ.daily.key !== dailyKeyNow());
      if (!learnDone[learnTab] || PZ.stale || !PZ.list || modeOff) renderPuzzle(); else { pzResume(); if (pzFitW !== window.innerWidth) pzFit(); } // v0.5.10：在別頁轉過向，回來重算棋盤
    }
    learnDone[learnTab] = true;
  }

  // ---------------------------------------------------------- v0.5.17（規格 AV）：每日一題
  // 練習分頁最上面一張卡「今天的題目」：題目難度、今天做過沒（做對打勾）、連續天數。點進去＝一般的練習題畫面（同一套 PZ、棋盤、計時、
  // 每題的答題紀錄照記），只是標題寫「今天的題目」、題型與步數兩列和上一題／下一題藏起來、題目上面多一行今天的狀態（#pzDaily）。
  // 哪一題：stats.js 的 dailyPick（照本機日期決定、不靠亂數）。做對、答錯、看答案怎麼記，連續天數怎麼算，見 stats.js 的 dailyMark、dailyStreak。
  // 日期一律是這台裝置的本機日期（dailyNow；測試可以換成假的 dailyFake）。半夜換日：每次切回這個網頁（visibilitychange）與一個計時器
  //（下一個半夜、最多一小時看一次）重畫卡片；今天的題目頁開著時換日，那一題就是昨天的題，做對不記，那一行說明要回練習分頁。
  var dailyFakeNow = null, dailyTimer = null;
  function dailyNow() { return dailyFakeNow != null ? dailyFakeNow : Date.now(); }
  function dailyKeyNow() { return GS.dayKey(dailyNow()); }
  function dailyPuzzle(key) { return PZ.list ? GS.dailyPick(PZ.list, key) : null; }
  function dailyWhat(p) {
    return t('daily.what', { kind: t(pzKind(p) === 'defend' ? 'learn.pzDefend' : 'learn.pzAttack'), level: pzN(p) === 1 ? t('learn.pzLevel1') : t('daily.steps', { n: pzN(p) }) });
  }
  // 今天的狀態 → 字典的鍵（'done' 一次就對另一句）
  var DAILY_ST = { todo: 'daily.stTodo', tried: 'daily.stTried', peek: 'daily.stPeek', past: 'daily.stPast' };
  function dailyStKey(s) { return s.st === 'done' ? (s.first ? 'daily.stDoneFirst' : 'daily.stDone') : DAILY_ST[s.st]; }
  function dailyStreakText(st, n) {
    if (!n) return t('daily.streakNone');
    if (st === 'done' || st === 'past') return t('daily.streak', { n: n });
    return st === 'peek' ? t('daily.streakYdayOnly', { n: n }) : t('daily.streakYday', { n: n, m: n + 1 });
  }
  function renderDailyCard() {
    var key = dailyKeyNow(), p = dailyPuzzle(key), days = GS.dailyDays(me().id), s = GS.dailyState(days, key);
    $('dailyWhat').textContent = p ? dailyWhat(p) : t(PZ.failed ? 'daily.loadFail' : 'daily.loading');
    $('pracDaily').classList.toggle('done', s.st === 'done');
    $('dailyCheck').hidden = s.st !== 'done';
    $('dailyState').textContent = t(dailyStKey(s));
    $('dailyStreak').textContent = dailyStreakText(s.st, GS.dailyStreak(days, key));
  }
  // 今天的題目頁的那一行（不是 live：答題的那句 #pzMsg 已經會念）
  function renderPzDaily() {
    var el = $('pzDaily');
    el.hidden = !PZ.daily;
    if (!PZ.daily) return;
    var key = dailyKeyNow(), days = GS.dailyDays(me().id), s = GS.dailyState(days, key);
    el.classList.toggle('done', key === PZ.daily.key && s.st === 'done');
    if (key !== PZ.daily.key) { el.textContent = t('daily.pzRolled'); return; } // v0.5.17 複審：日期往前、往後變都用同一句（不說「過了半夜」）
    el.textContent = (PZ.dailyNote ? t(PZ.dailyNote) + (I.getLang() === 'en' ? ' ' : '') : '') +
      (s.st === 'done' ? t(s.first ? 'daily.pzDoneFirst' : 'daily.pzDone', { n: GS.dailyStreak(days, key) })
        : t(s.st === 'peek' ? 'daily.pzPeek' : s.st === 'past' ? 'daily.stPast' : 'daily.pzTodo'));
    PZ.dailyNote = null;
  }
  // 今天的題目頁、或回到一般練習題：PZ 的題型、步數、第幾題換成今天那一題（原本的記在 PZ.saved，回一般練習題時還原）
  function pzSyncMode() {
    if (learnTab === 'daily') {
      var key = dailyKeyNow(), p = dailyPuzzle(key);
      if (!p) return;
      if (!PZ.daily) PZ.saved = { kind: PZ.kind, n: PZ.n, idx: PZ.idx };
      PZ.daily = { key: key, id: String(p.id) };
      PZ.kind = pzKind(p);
      PZ.n = pzN(p);
      PZ.idx = pzList().indexOf(p);
    } else if (PZ.daily) {
      PZ.daily = null;
      if (PZ.saved) { PZ.kind = PZ.saved.kind; PZ.n = PZ.saved.n; PZ.idx = PZ.saved.idx; }
      PZ.saved = null;
    }
  }
  // 今天的題目頁的作答（'right'／'wrong'）與「看答案怎麼下」（'peek'）。題目頁開著時換日了（PZ.daily.key 不是今天）：不記（不能補做以前的題）
  function dailyAnswer(p, what) {
    if (!PZ.daily || String(p.id) !== PZ.daily.id) return;
    var key = dailyKeyNow();
    if (key === PZ.daily.key) GS.dailyMark(me().id, key, PZ.daily.id, what, dailyNow());
    renderPzDaily();
  }
  // 練習題答對（一般或今天的題目）：練習題題數、每日一題連續天數的成就，答對那句後面接一行「拿到成就：…」（同一個 aria-live，念一次）
  function pzAchLine(msg) {
    var pid = me().id, got = GS.achSync(pid, dailyNow()).filter(function (x) { return /^(pz|daily)/.test(x.id); });
    if (!got.length) return;
    msg.appendChild(mk('span', 'ach-line pz-ach', achText(got.map(function (x) { return { id: x.id, pid: pid }; }), false)));
  }
  // v0.5.17 複審（judge）：今天的題目頁開著時日期變了（半夜、換時區、改時鐘；往前往後都一樣）：馬上換成今天的題目重新出題，
  // 那一行前面加一句「日期變了，換成今天的題目。」——不留著舊的那一題（往西飛時那一題其實是「明天」的題，不該先露出來）
  function dailyTick() {
    if (!$('practice').hidden) renderDailyCard();
    if (!$('learn').hidden && PZ.daily && learnTab === 'daily') {
      if (PZ.daily.key !== dailyKeyNow() && PZ.list) { PZ.dailyNote = 'daily.pzChanged'; renderPuzzle(); }
      else renderPzDaily();
    }
    if (dailyTimer) clearTimeout(dailyTimer);
    var d = new Date(dailyNow()), next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 1);
    dailyTimer = setTimeout(dailyTick, Math.min(Math.max(1000, next - d), 3600000)); // 最多一小時看一次：時鐘被改過、裝置睡過也會對回來
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) dailyTick(); });

  // ---------------------------------------------------------- 擺棋盤研究（v0.5.15，規格 AU 第二版）
  // 從練習分頁的「擺棋盤研究」卡片、或回頭看的「從這一步研究」（帶入那一步的盤面：規則＋照順序的手，手數照樣對得上）進來。
  // 自己擺子（輪流／只擺黑／只擺白／擦掉）、退一步、清空（盤上有子時先問）、規則（自由／連珠：連珠時黑棋的禁手點畫 ×、不讓擺）；
  // 問小幫手（按了才算）：「誰有危險」＝雙方的活三、沖四、四三、三三（沿用光環與標籤：輪到的那一方綠、另一方橘），開著時每改一次盤面就重算；
  // 「誰能一路逼到贏」＝自己開的一個 Worker 跑連續沖四、再跑連續進攻（輪到的那一方最多 3 秒，沒找到再看另一方「要是它先下」最多 2 秒），
  // 找到的路用半透明編號子一步一步看（看的時候先不寫真的手數）。「複製局面」「貼上局面」（同回頭看「複製棋譜」的格式）。
  // 不算分、不留紀錄、不存接著下；這次開著網頁的期間離開再回來，盤面還在（只放在記憶體）。放大（AM）、點兩下確認照對局。
  //   RS.moves＝盤上的子，照擺上去的順序（擦掉的拿掉、後面的往前補；手數照這個順序寫）；輪到誰＝最後一顆的另一色（沒有子＝黑），見 rsMover。
  //   RS.undo＝「退一步」的堆疊，每一格是改之前的 { moves, rule }：擺一顆、擦一顆、清空各一格；整個換掉的（貼上、從回頭看帶進來）
  //   照順序一顆一顆疊（退一步一次拿掉一顆，拿光了再退一次回到換掉之前的盤面）。改規則不算一格（不改盤上的子）。
  var RS_CAPS = { mover: 3000, other: 2000 }; // 誰能一路逼到贏：輪到的那一方最多想 3 秒、另一方 2 秒（測試小門可以改）
  var RS_UNDO_MAX = 600;
  var RS = { rule: 'free', moves: [], mode: 'alt', undo: [], preview: null, from: null, live: false,
    danger: false, dangerSeq: 0, dangerRes: null, halo: { keys: {}, rings: [], labels: [], groups: [], seen: {} },
    search: null, line: null, tip: null, copyMsg: null, copyText: null, pasteOpen: false, said: '' };
  // v0.5.15 複審（judge）：RS.tip、RS.copyMsg 存「畫的時候才組字」的函式（換語言後重畫就是新語言）；RS.said＝上一次給讀屏念的句子（一樣的不再念）
  var rsView = BoardView($('rbBoard'));
  var rsZoom = BoardZoom(rsView, $('rbFrame'), $('rbLayer'), $('rbZoomReset'));
  var RS_HALO = { st: function () { return RS.halo; }, view: rsView, canvas: 'rbBoard', box: 'rbLabels', board: function () { return rsBoard(); },
    rot: function () { return false; }, redraw: function () { rsDraw(); }, game: false, timer: null };
  var rsWorker = null, rsSeq = 0, rsBacking = false, rsFitW = 0;

  // 輪到誰：最後擺上去那一顆的另一色；沒有子＝黑（純函式，test.js 驗）
  function rsMover(moves) { return moves && moves.length ? 3 - moves[moves.length - 1].p : 1; }
  // 「複製局面」的文字：head（標題、規則那幾行）＋一行一手「1. 黑 H8」（同回頭看「複製棋譜」的 kifu.move，中英都是「手數. 顏色 座標」）
  function rsFormat(head, moves, colorOf) {
    return head.concat(moves.map(function (m, i) { return (i + 1) + '. ' + colorOf(m.p) + ' ' + COLS.charAt(m.c) + (N - m.r); })).join('\n');
  }
  // 「貼上局面」：讀 rsFormat 寫的文字，也讀回頭看「複製棋譜」的（標題、對手、日期、開局那幾行不管）。全形字先換成半形（NFKC）。
  //   棋步一行「1. 黑 H8」（顏色：黑、白、黑棋、白棋、Black、White、B、W；座標 A–O＋1–15，大小寫都可以）；規則看「規則：…」「Rules: …」那一行
  //   （有「連珠」或 Renju＝連珠，其他＝自由；沒有這一行＝自由）。回 { ok: true, rule, moves: [{ r, c, p }] }，或
  //   { ok: false, err: 'long'（超過 20000 字）| 'none'（沒有棋步也沒有規則）| 'coord'（像棋步、但看不懂）| 'order'（手數不是 1、2、3… 照順序）
  //   | 'dup'（同一點兩次）, line（第幾行，從 1 數）, text（那一行）, coord }（純函式，test.js 驗）
  function rsParse(text) {
    var src = String(text == null ? '' : text);
    if (src.length > 20000) return { ok: false, err: 'long' };
    if (src.normalize) src = src.normalize('NFKC');
    // 程式檔不放中文（t14_layout.py）：中文的字用 \u 寫——\u9ed1＝黑、\u767d＝白、\u68cb＝棋、\u898f\u5247＝規則、\u9023\u73e0＝連珠、\u3001＝、
    var MOVE = /^(\d{1,3})\s*[.\u3001)]?\s*(\u9ed1\u68cb|\u767d\u68cb|\u9ed1|\u767d|black|white|b|w)\s*[:,]?\s*([a-o])\s*(\d{1,2})$/i;
    var LOOKS = /^\d{1,3}\s*[.\u3001)]?\s*(\u9ed1|\u767d|black\b|white\b|b\b|w\b)/i, RULE = /^(\u898f\u5247|rules?)\s*:/i, WHITE = /^(\u767d|white|w)/i;
    var lines = src.split(/\r\n|\r|\n/), rule = null, moves = [], seen = {};
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].replace(/\s+/g, ' ').trim(), m;
      if (!ln) continue;
      if (RULE.test(ln)) { rule = /\u9023\u73e0|renju/i.test(ln) ? 'renju' : 'free'; continue; }
      m = MOVE.exec(ln);
      if (!m) {
        if (LOOKS.test(ln)) return { ok: false, err: 'coord', line: i + 1, text: ln };
        continue;
      }
      var row = Number(m[4]), c = COLS.indexOf(m[3].toUpperCase()), r = N - row;
      if (row < 1 || row > N || c < 0) return { ok: false, err: 'coord', line: i + 1, text: ln };
      if (Number(m[1]) !== moves.length + 1) return { ok: false, err: 'order', line: i + 1, text: ln };
      var key = r * N + c, coord = COLS.charAt(c) + row;
      if (seen[key]) return { ok: false, err: 'dup', line: i + 1, text: ln, coord: coord };
      seen[key] = 1;
      moves.push({ r: r, c: c, p: WHITE.test(m[2]) ? 2 : 1 });
    }
    if (!moves.length && rule == null) return { ok: false, err: 'none' };
    return { ok: true, rule: rule || 'free', moves: moves };
  }
  function rsParseErr(x) {
    if (x.err === 'long') return t('rs.errLong');
    if (x.err === 'coord') return t('rs.errCoord', { line: x.line, text: x.text.length > 40 ? x.text.slice(0, 40) + '…' : x.text });
    if (x.err === 'order') return t('rs.errOrder', { line: x.line });
    if (x.err === 'dup') return t('rs.errDup', { line: x.line, coord: x.coord });
    return t('rs.errNone');
  }
  function rsCopyString() {
    return rsFormat([t('rs.kifuTitle', { version: window.GOMOKU_VERSION || '' }), t('kifu.rule', { rule: t(RS.rule === 'renju' ? 'rule.renju' : 'rule.free') })],
      RS.moves, colorName);
  }

  function rsBoard() {
    var b = G.createBoard();
    RS.moves.forEach(function (m) { b[m.r][m.c] = m.p; });
    return b;
  }
  // 點棋盤會擺哪一色：輪流＝輪到的那一方；擦掉＝0
  function rsPlaceColor() {
    return RS.mode === 'b' ? 1 : RS.mode === 'w' ? 2 : RS.mode === 'erase' ? 0 : rsMover(RS.moves);
  }
  // 盤上的連成五（連珠黑棋只算剛好五）：{ player, cells } 或 null
  function rsFive(b) {
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      if (!b[r][c]) continue;
      var w = G.checkWin(b, r, c, RS.rule);
      if (w) return w;
    }
    return null;
  }
  // v0.5.15 複審（judge）：路上可能有一格 { pass: true }＝守方黑棋要擋的點是禁手、擋不了（ai.js 的 finishLine）：那一格不擺子，
  // 編號照格數走（後面那一手照樣是它在路上的第幾步，同步數的「第 i 步」）；停在那一格時，在擋不了的那一點畫 ×（rsLineCross）。
  // v0.5.16：畫法搬到 lineGhosts（教學、回頭看共用）
  function rsGhosts() {
    var L = RS.line;
    return L ? lineGhosts(L.line, L.step, L.att).ghosts : null;
  }
  function rsLineCross() {
    var L = RS.line;
    return L ? lineGhosts(L.line, L.step, L.att).crosses : null;
  }
  // 第 i 步是什麼：「黑 J8」，擋不了的那一格說「黑棋擋不了（要擋的點是禁手）」
  function rsStepWhat(L, i) {
    var q = L.line[i - 1], p = (i - 1) % 2 ? 3 - L.att : L.att;
    if (!q) return '';
    return q.pass ? t('rs.passStep', { color: colorName(p) }) : colorName(p) + ' ' + coordName(q.r, q.c);
  }
  // 給讀屏念（#rbSay，aria-live）：一樣的句子不重念；#rbOut 本身不是 live，擺一顆子不會把整塊回答再念一次
  function rsSay(text) {
    if (!text || text === RS.said) return;
    RS.said = text;
    $('rbSay').textContent = text;
  }
  function rsDraw() {
    var b = rsBoard(), pc = rsPlaceColor(), five = rsFive(b);
    rsView.draw({
      board: b, coords: true, last: RS.moves.length ? RS.moves[RS.moves.length - 1] : null,
      winCells: five ? five.cells : null,
      forbidden: RS.rule === 'renju' && pc === 1, // 下一顆要擺黑棋時才畫禁手點的 ×（只擺白、擦掉時不畫）
      halos: RS.danger ? RS.halo.rings : null,
      ghosts: rsGhosts(),
      crosses: rsLineCross(),
      preview: RS.preview && pc && !b[RS.preview.r][RS.preview.c] ? { r: RS.preview.r, c: RS.preview.c, p: pc } : null,
      nums: settings.numsReview && !RS.line ? RS.moves : null // 手數跟著回頭看的「手數」開關；看一路逼到贏的那條路時先不寫
    });
  }

  function rsModeHint() {
    if (RS.mode === 'b') return t('rs.hintB');
    if (RS.mode === 'w') return t('rs.hintW');
    if (RS.mode === 'erase') return t('rs.hintErase');
    return t('rs.hintAlt', { color: colorName(rsMover(RS.moves)) });
  }
  function rsRender() {
    var n = RS.moves.length;
    $('rbBack').textContent = t(RS.from ? 'rs.backReview' : 'nav.backPractice');
    setRadio('rbMode', RS.mode);
    setRadio('rbRule', RS.rule);
    $('rbStatus').textContent = t('rs.status', { n: n, color: colorName(rsMover(RS.moves)) });
    $('rbTip').textContent = RS.tip ? RS.tip() : rsModeHint();
    $('rbUndo').disabled = !RS.undo.length;
    $('rbClear').disabled = !n;
    $('rbNums').setAttribute('aria-pressed', settings.numsReview ? 'true' : 'false');
    $('rbDanger').setAttribute('aria-pressed', RS.danger ? 'true' : 'false');
    $('rbWin').disabled = !!(RS.search && RS.search.state === 'run');
    $('rbCopyMsg').textContent = RS.copyMsg ? RS.copyMsg() : '';
    $('rbCopyText').hidden = RS.copyText == null;
    if (RS.copyText != null) $('rbCopyText').value = RS.copyText;
    $('rbPasteBox').hidden = !RS.pasteOpen;
    rsRenderOut();
    rsDraw();
  }

  // 小幫手的回答（#rbOut）：誰有危險（開著時）、誰能一路逼到贏（按過、盤面沒改過時）
  function rsRenderOut() {
    var out = $('rbOut');
    out.textContent = '';
    if (RS.danger && RS.dangerRes) {
      var dz = mk('div', 'rb-danger'), d = RS.dangerRes, mv = d.mover, sayD = []; // 讀屏只念兩方各一行（變了才念；換手時開頭那句跟著變，不念）
      if (!d.ok) dz.appendChild(mk('p', '', t('rs.fail')));
      else {
        dz.appendChild(mk('p', 'rb-dhead', t('rs.dangerHead', { color: colorName(mv), opp: colorName(3 - mv) })));
        [mv, 3 - mv].forEach(function (c) {
          var cnt = {}, order = [];
          d.groups.forEach(function (g) {
            if (g.color !== c) return;
            var lb = t(g.label);
            if (!cnt[lb]) { cnt[lb] = 0; order.push({ lb: lb, rank: g.rank }); }
            cnt[lb]++;
          });
          order.sort(function (a, b) { return a.rank - b.rank; });
          var p = mk('p', 'rb-dside' + (order.length ? (c === mv ? ' own' : ' opp') : '')); // 有形才上色（綠＝輪到的那一方、紅＝另一方）
          p.textContent = order.length ? t('rs.dangerSide', { color: colorName(c), list: order.map(function (o) { return t('rs.dangerItem', { label: o.lb, n: cnt[o.lb] }); }).join(t('list.sep')) })
            : t('rs.dangerNone', { color: colorName(c) });
          dz.appendChild(p);
          sayD.push(p.textContent);
        });
        rsSay(sayD.join(' '));
      }
      out.appendChild(dz);
    }
    var se = RS.search;
    if (!se) return;
    var sz = mk('div', 'rb-search');
    if (se.state === 'run') sz.appendChild(mk('p', 'rb-thinking', t('rs.thinking', { s: Math.round((se.caps.mover + se.caps.other) / 1000) })));
    else if (se.state === 'fail' || !se.res) sz.appendChild(mk('p', '', t('rs.fail')));
    else if (se.res.five) sz.appendChild(mk('p', 'rb-head', t('rs.five', { color: colorName(se.res.five) })));
    else {
      se.res.sides.forEach(function (sd, i) {
        var other = i > 0, col = colorName(sd.p), opp = colorName(3 - sd.p), box = mk('div', 'rb-side');
        if (sd.status === 'found' && sd.line && sd.line.length) {
          box.appendChild(mk('p', 'rb-head ' + (other ? 'opp' : 'own'), t(other ? 'rs.foundOther' : 'rs.found', { color: col, opp: opp, n: sd.k })));
          var how = mk('p', 'rb-how');
          // v0.5.15 複審：守方黑棋要擋的點是禁手、擋不了的路，不說「只能一直擋」
          how.appendChild(I.node(sd.kind === 'five' ? 'rs.howFive' : (sd.kind === 'vct' ? 'rs.howVct' : 'rs.howVcf') + (sd.forbidBlock ? 'Forbid' : ''), { opp: opp }));
          box.appendChild(how);
          box.appendChild(rsLineControls(i, sd));
        } else {
          box.appendChild(mk('p', 'rb-head', t(other ? 'rs.noneOther' : 'rs.none', { color: col, s: Math.round((other ? se.caps.other : se.caps.mover) / 1000) })));
        }
        sz.appendChild(box);
      });
      sz.appendChild(mk('p', 'rb-limit', t('rs.limit')));
    }
    out.appendChild(sz);
    if (se.state !== 'run') rsSay([].map.call(sz.querySelectorAll('.rb-head, .rb-how'), function (e) { return e.textContent; }).join(' ') || sz.textContent);
  }
  // 找到的路：還沒打開時一顆「一步一步看」；打開後 ◀ 第幾步 ▶、播放／停止、收起
  function rsLineControls(i, sd) {
    var L = RS.line, row = mk('div', 'rb-line');
    function btn(id, label, aria, fn) {
      var b = mk('button', 'secondary', label);
      b.type = 'button';
      b.id = id;
      if (aria) b.setAttribute('aria-label', aria);
      b.addEventListener('click', fn);
      row.appendChild(b);
      return b;
    }
    if (!L || L.idx !== i) {
      btn('rbShowLine' + i, t('rs.showLine'), null, function () { rsShowLine(i); });
      return row;
    }
    btn('rbLinePrev', t('rs.prev'), t('rs.prevLabel'), function () { rsLineStep(-1); });
    var st = mk('span', 'rb-step');
    st.id = 'rbLineStep';
    row.appendChild(st);
    btn('rbLineNext', t('rs.next'), t('rs.nextLabel'), function () { rsLineStep(1); });
    btn('rbLinePlay', '', null, rsLinePlay);
    btn('rbLineHide', t('rs.hide'), null, rsHideLine);
    var note = mk('p', 'rb-linenote');
    note.id = 'rbLineNote';
    row.appendChild(note);
    rsLineUpdate(row);
    return row;
  }
  // 只換步數那幾個（不重做整塊：按著的鈕不會掉焦點）
  function rsLineUpdate(root) {
    var L = RS.line;
    if (!L) return;
    function q(id) { return root ? root.querySelector('#' + id) : $(id); }
    var st = q('rbLineStep'), pv = q('rbLinePrev'), nx = q('rbLineNext'), pl = q('rbLinePlay'), nt = q('rbLineNote');
    if (!st) return;
    st.textContent = L.step + '/' + L.line.length;
    // v0.5.15 複審：讀屏念第幾步、誰下在哪（「第 3 步，共 5 步：黑 J8」）；擋不了的那一格也說出來（畫面上寫在下面一行）
    st.setAttribute('aria-label', L.step ? t('rs.stepLabel', { i: L.step, n: L.line.length, what: rsStepWhat(L, L.step) }) : t('rs.stepLabel0', { n: L.line.length }));
    var cur = L.step ? L.line[L.step - 1] : null;
    if (nt) nt.textContent = cur && cur.pass ? rsStepWhat(L, L.step) : '';
    pv.disabled = L.step <= 0;
    nx.disabled = L.step >= L.line.length;
    pl.textContent = t(L.timer ? 'rs.stop' : 'rs.play');
  }
  function rsShowLine(i) {
    var se = RS.search, sd = se && se.res && se.res.sides[i];
    if (!sd || !sd.line) return;
    rsStopLine();
    RS.line = { idx: i, att: sd.p, line: sd.line, step: 1, timer: null };
    rsRender();
    var nx = $('rbLineNext');
    if (nx && !nx.disabled) nx.focus(); else if ($('rbLineHide')) $('rbLineHide').focus();
  }
  function rsLineStep(d) {
    var L = RS.line;
    if (!L) return;
    rsStopLine();
    L.step = Math.max(0, Math.min(L.line.length, L.step + d));
    rsLineUpdate();
    rsDraw();
  }
  function rsLinePlay() {
    var L = RS.line;
    if (!L) return;
    if (L.timer) { rsStopLine(); rsLineUpdate(); return; }
    if (L.step >= L.line.length) L.step = 0;
    L.timer = setInterval(function () {
      if (RS.line !== L) return;
      L.step++;
      if (L.step >= L.line.length) rsStopLine(); // 播到最後一步停住（留在盤上看）
      rsLineUpdate();
      rsDraw();
    }, TEACH_MS);
    rsLineUpdate();
    rsDraw();
  }
  function rsStopLine() {
    if (RS.line && RS.line.timer) { clearInterval(RS.line.timer); RS.line.timer = null; }
  }
  // 收起：焦點回到打開它的那一顆「一步一步看」（沒有就回「誰能一路逼到贏」）
  function rsHideLine() {
    var i = RS.line ? RS.line.idx : 0;
    rsStopLine();
    RS.line = null;
    rsRender();
    var b = $('rbShowLine' + i) || $('rbWin');
    if (b) b.focus();
  }

  // 盤面變了（擺、擦、退一步、清空、貼上、換規則）：預覽子、那條路、還在想的與想好的答案都作廢；誰有危險開著就重算。
  // tip＝這一次要說的話（組字的函式，見 RS.tip；也給讀屏念）
  function rsChanged(tip) {
    RS.preview = null;
    rsStopLine();
    RS.line = null;
    rsCancelSearch();
    RS.tip = tip || null;
    RS.copyMsg = null;
    if (tip) rsSay(tip());
    RS.copyText = null;
    rsRefreshDanger();
    rsRender();
  }
  // v0.5.15 複審（judge）：只有「整個換掉之前」那一格記規則（withRule）：擺、擦、清空、換掉之後一顆一顆疊的那幾格都不記，
  // 退一步不會把自己剛選的規則也退回去；退到換掉之前那一格才連規則一起回去
  function rsPushUndo(withRule) {
    var s = { moves: RS.moves.slice() };
    if (withRule) s.rule = RS.rule;
    RS.undo.push(s);
    if (RS.undo.length > RS_UNDO_MAX) RS.undo.shift();
  }
  // 整個換掉（貼上、從回頭看帶進來）：先記換掉之前的盤面，再照順序一顆一顆疊（退一步一次拿掉一顆）
  function rsLoad(moves, rule, tip) {
    rsPushUndo(true);
    for (var j = 0; j < moves.length; j++) {
      var top = RS.undo[RS.undo.length - 1];
      if (!j && top && !top.moves.length && top.rule === rule) continue; // 換掉之前就是空盤、同規則：不用多記一格空盤
      RS.undo.push({ moves: moves.slice(0, j) });
    }
    while (RS.undo.length > RS_UNDO_MAX) RS.undo.shift();
    RS.moves = moves.slice();
    RS.rule = rule === 'renju' ? 'renju' : 'free';
    rsChanged(tip);
  }
  function rsUndo() {
    if (!RS.undo.length) return;
    var s = RS.undo.pop();
    RS.moves = s.moves.slice();
    if (s.rule) RS.rule = s.rule;
    rsChanged();
  }
  function rsTip(fn) {
    RS.tip = fn;
    $('rbTip').textContent = fn();
    rsSay(fn());
  }

  // 誰有危險：雙方各要一次威脅清單（不查連續沖四），照對局的 haloGroups 分組（標籤一律寫形：活三、沖四、四三、三三…）；
  // 輪到的那一方＝綠（機會）、另一方＝橘（威脅）。同一組換手時只換顏色，不重新呼吸
  function rsRefreshDanger() {
    var seq = ++RS.dangerSeq;
    if (!RS.danger) { clearHalos(RS_HALO); RS.halo.seen = {}; RS.dangerRes = null; return; }
    var b = rsBoard(), rule = RS.rule, got = {}, need = 2;
    function done() {
      if (seq !== RS.dangerSeq || !RS.danger || --need > 0) return;
      var mover = rsMover(RS.moves), groups = [];
      [1, 2].forEach(function (c) {
        if (!got[c]) return;
        haloGroups(got[c], null, 3 - c, b, rule).forEach(function (g) { g.own = c === mover; g.color = c; groups.push(g); });
      });
      RS.dangerRes = { mover: mover, groups: groups, ok: !!(got[1] && got[2]) };
      setHalos(groups, 1, false, RS_HALO);
      if (!$('research').hidden) rsRenderOut();
    }
    [1, 2].forEach(function (c) { requestThreats(b, c, rule, function (res) { got[c] = res; done(); }, { vcfMs: 0 }); });
  }

  // 誰能一路逼到贏：自己開的 Worker（ai-worker.js 的 'research'；和下一手、威脅清單、回頭看的分析分開，取消＝直接關掉它）
  function rsKillWorker() {
    if (rsWorker) { try { rsWorker.terminate(); } catch (e) { /* 已停 */ } }
    rsWorker = null;
  }
  function rsCancelSearch() {
    if (RS.search && RS.search.state === 'run') rsKillWorker();
    RS.search = null;
  }
  function rsSearch() {
    rsCancelSearch();
    rsStopLine();
    RS.line = null;
    var board = rsBoard(), mover = rsMover(RS.moves), rule = RS.rule, id = ++rsSeq;
    var caps = { mover: RS_CAPS.mover, other: RS_CAPS.other }, opts = { moverMs: caps.mover, otherMs: caps.other };
    var se = RS.search = { id: id, state: 'run', res: null, caps: caps, t0: performance.now(), ms: 0 };
    function done(res) {
      if (RS.search !== se) return;
      se.state = res ? 'done' : 'fail';
      se.res = res || null;
      se.ms = Math.round(performance.now() - se.t0);
      if (!$('research').hidden) rsRender();
      if (se.res) { var b0 = document.querySelector('#rbOut [id^="rbShowLine"]'); if (b0 && document.activeElement === $('rbWin')) b0.focus(); }
    }
    var w = null;
    if (workerOK) {
      try {
        w = rsWorker || new Worker(vurl('ai-worker.js'));
        rsWorker = w;
        w.onmessage = function (e) {
          var d = e.data;
          if (isHello(d)) return;
          if (d && d.type === 'researchResult' && d.id === id) done(d.result && d.result.sides ? d.result : null);
        };
        w.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); rsKillWorker(); done(null); };
        w.postMessage({ type: 'research', id: id, board: board, player: mover, rule: rule, opts: opts });
      } catch (e) { w = null; rsWorker = null; }
    }
    if (!w) {
      // 沒有 Worker（file:// 開啟）：在畫面這一邊算（會卡住幾秒），先讓「正在想」畫出來
      setTimeout(function () {
        if (RS.search !== se) return;
        var r = null;
        try { r = G.researchSearch ? G.researchSearch(board, mover, rule, opts) : null; } catch (err) { r = null; }
        done(r);
      }, 30);
    }
    rsRender();
  }

  // 進出這一頁。離開：還在想的停掉、播放停住、標籤收起、預覽子拿掉、放大還原；不是按返回鈕離開的，「回到回頭看」作廢
  function rsEnter() {
    rsZoom.reset(false);
    RS.preview = null;
    rsRender();
    rsFit();
    if (RS.danger) rsRefreshDanger();
  }
  function rsLeave() {
    if (RS.search && RS.search.state === 'run') rsCancelSearch();
    rsStopLine();
    expireLabels(true, RS_HALO);
    RS.preview = null;
    RS.pasteOpen = false;
    rsZoom.reset(false);
    if (!rsBacking) {
      if (RS.live) setClockPause('research', false);
      RS.live = false;
      RS.from = null;
    }
  }
  // 回頭看的「從這一步研究」。兩人一起下、還沒下完時從回頭看進來的（live）：這段時間棋鐘照樣停（原因 'research'），研究頁不顯示分頁列
  // （對局頁沒有分頁列：下到一半的盤只能從「⋯」離開，不能從這裡繞過放棄的確認）
  function researchFromReview(info, moves, n) {
    var live = S.review === 'game' && !info.over;
    if (live && !RS.live) setClockPause('research', true);
    RS.live = live;
    RS.from = { info: info, n: n, review: S.review };
    RS.mode = 'alt';
    rsLoad(moves.map(function (m) { return { r: m.r, c: m.c, p: m.p }; }), info.rule === 'renju' ? 'renju' : 'free');
    showPage('research');
  }
  // 返回鈕：從回頭看來的回到回頭看的同一步；從練習分頁來的（或回頭看已經回不去）回到練習分頁
  function researchBack() {
    var f = RS.from, ok = false;
    if (f) {
      rsBacking = true;
      try {
        if (f.review !== 'game' || canReview()) { enterReview(f.info, f.review); ok = !!S.review; if (ok) RV.go(f.n); }
      } finally { rsBacking = false; }
      RS.from = null;
      if (RS.live) { RS.live = false; setClockPause('research', false); } // 回頭看自己會停鐘（'review'），這時才放掉 'research'
      if (ok) return;
    }
    showPage('practice');
  }

  // 棋盤大小（同練習題的 pzFit）：手機＝寬度，高度上限是棋盤上緣到分頁列（棋盤一定整個在第一屏）；直拿平板上限 960，
  // 而且棋盤下面那一行字與「退一步」那一排也在第一屏；橫拿＝棋盤在左（高＝棋盤上緣到 main 的下留白）、右欄 320～440。大小寫到 #research 的 --rssz
  function rsFit() {
    if ($('research').hidden) return;
    var lay = tabletMode(), w;
    rsFitW = window.innerWidth;
    var top = $('rbFrame').parentNode.getBoundingClientRect().top + window.scrollY;
    var tb = $('tabbar').hidden ? 0 : $('tabbar').offsetHeight;
    if (lay === 'land') {
      var padB = parseFloat(getComputedStyle(document.querySelector('main')).paddingBottom) || (tb + 8);
      w = Math.floor(Math.min($('research').clientWidth - SIDE_GAP - SIDE_MIN, BOARD_MAX, Math.max(260, window.innerHeight - top - padB)));
    } else {
      w = Math.min($('rbWrap').clientWidth || 340, lay ? BOARD_MAX : 640);
      var room = window.innerHeight - top - 8 - tb;
      if (lay) {
        var er = document.querySelector('#rbWrap .rb-edit');
        room -= $('rbTip').offsetHeight + (parseFloat(getComputedStyle($('rbTip')).marginTop) || 0) + er.offsetHeight + (parseFloat(getComputedStyle(er).marginTop) || 0);
      }
      w = Math.floor(Math.min(w, Math.max(260, room)));
    }
    if (w !== rsView.geo.css) rsView.setSize(w);
    $('research').style.setProperty('--rssz', rsView.geo.css + 'px');
    placeLabels(RS_HALO);
  }

  $('pracResearch').addEventListener('click', function () {
    if (RS.live) { setClockPause('research', false); RS.live = false; }
    RS.from = null;
    showPage('research');
  });
  $('rbBack').addEventListener('click', researchBack);
  $('rbBoard').addEventListener('click', function (e) {
    var p = rsView.cellAt(e.clientX, e.clientY);
    if (!p) return;
    var b = rsBoard(), pc = rsPlaceColor();
    if (RS.mode === 'erase') {
      if (!b[p.r][p.c]) return;
      rsPushUndo();
      RS.moves = RS.moves.filter(function (m) { return !(m.r === p.r && m.c === p.c); });
      rsChanged();
      return;
    }
    if (b[p.r][p.c]) {
      // 同對局：點發光的棋子，再叫出那幾組的標籤
      if (RS.danger) {
        var gs = RS.halo.groups.filter(function (g) { return g.stones.some(function (x) { return x.r === p.r && x.c === p.c; }); });
        if (gs.length) showLabels(gs, RS_HALO);
      }
      return;
    }
    if (RS.rule === 'renju' && pc === 1) {
      var f = G.isForbidden(b, p.r, p.c);
      if (f) { RS.preview = null; rsTip(function () { return t('status.forbidden', { kind: forbiddenName(f) }); }); RS.said = ''; rsDraw(); return; } // 同一點再點一次也再念
    }
    // 規格 AM：點兩下確認——第一下出預覽子，同一點再點一下才擺；擺了以後放大的棋盤縮回
    if (settings.placeMode === 'confirm' && !(RS.preview && RS.preview.r === p.r && RS.preview.c === p.c)) {
      RS.preview = { r: p.r, c: p.c };
      rsDraw();
      return;
    }
    rsZoom.afterPlace();
    rsPushUndo();
    RS.moves.push({ r: p.r, c: p.c, p: pc });
    rsChanged();
  });
  document.querySelectorAll('input[name="rbMode"]').forEach(function (el) {
    el.addEventListener('change', function () { RS.mode = this.value; RS.preview = null; RS.tip = null; rsRender(); });
  });
  document.querySelectorAll('input[name="rbRule"]').forEach(function (el) {
    el.addEventListener('change', function () { if (this.value === RS.rule) return; RS.rule = this.value === 'renju' ? 'renju' : 'free'; rsChanged(); });
  });
  $('rbUndo').addEventListener('click', rsUndo);
  $('rbClear').addEventListener('click', function () {
    var n = RS.moves.length;
    if (!n) return;
    showDialog(t('rs.clearAsk', { n: n }), [
      { label: t('rs.clearYes'), primary: true, onClick: function () { rsPushUndo(); RS.moves = []; rsChanged(); } },
      { label: t('rs.clearNo') }
    ], { focusLast: true });
  });
  $('rbNums').addEventListener('click', function () { setNums('numsReview', !settings.numsReview); });
  $('rbDanger').addEventListener('click', function () {
    RS.danger = !RS.danger;
    rsRefreshDanger();
    rsRender();
  });
  $('rbWin').addEventListener('click', rsSearch);
  $('rbCopy').addEventListener('click', function () {
    var text = rsCopyString();
    copyText(text, function () { RS.copyMsg = function () { return t('rs.copied'); }; RS.copyText = null; rsRender(); rsSay(t('rs.copied')); },
      function () { RS.copyMsg = function () { return t('rs.copyFail'); }; RS.copyText = text; rsRender(); rsSay(t('rs.copyFail')); });
  });
  function rsPasteApply() {
    var x = rsParse($('rbPasteText').value);
    if (!x.ok) { $('rbPasteMsg').textContent = rsParseErr(x); return false; }
    RS.pasteOpen = false;
    $('rbPasteMsg').textContent = '';
    RS.mode = 'alt';
    rsLoad(x.moves, x.rule, function () { return t('rs.pasted', { n: x.moves.length, rule: t(x.rule === 'renju' ? 'rule.renju' : 'rule.free') }); });
    $('rbPaste').focus();
    return true;
  }
  // 貼上局面：打開一個貼文字的框；瀏覽器肯讓我們讀剪貼簿時先讀，讀得懂就直接擺上去（讀不懂的留在框裡、說哪一行不對）
  $('rbPaste').addEventListener('click', function () {
    RS.pasteOpen = true;
    $('rbPasteText').value = '';
    $('rbPasteMsg').textContent = '';
    rsRender();
    $('rbPasteText').focus();
    if (navigator.clipboard && navigator.clipboard.readText) {
      try {
        navigator.clipboard.readText().then(function (txt) {
          if (!RS.pasteOpen || !txt || $('rbPasteText').value) return;
          $('rbPasteText').value = txt;
          rsPasteApply();
        }, function () { /* 不讓讀：自己貼 */ });
      } catch (e) { /* 不讓讀 */ }
    }
  });
  $('rbPasteGo').addEventListener('click', rsPasteApply);
  $('rbPasteCancel').addEventListener('click', function () { RS.pasteOpen = false; $('rbPasteMsg').textContent = ''; rsRender(); $('rbPaste').focus(); });

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
    learnDone = { puzzles: false, openings: false, daily: false }; // 練習題、今天的題目與開局的字是畫的時候寫進去的：下次進來重畫
    if (!$('learn').hidden) renderLearn();
    if (!$('practice').hidden) renderDailyCard(); // v0.5.17（規格 AV）：今天的題目那張卡的字
    if (!$('research').hidden) { rsRender(); rsFit(); } // v0.5.15（規格 AU 第二版）：擺棋盤研究的字（回答、步數）也是畫的時候寫的
  }
  $('langBtn').addEventListener('click', function () {
    I.setLang(I.getLang() === 'en' ? 'zh-TW' : 'en');
    applyLang();
  });

  // ---------------------------------------------------------- 按鈕

  $('startBtn').addEventListener('click', function () { startGame(null); });
  $('undoBtn').addEventListener('click', undo);
  // 第二十四批（規格 Z3、Z7 第 1 條）：「重新開始」在「⋯」面板裡；悔棋在下方座位條（一下就能按）
  $('restartBtn').addEventListener('click', function () { closeMoreSheet(true); confirmAbandon(newGame); });
  $('aboutBtn').addEventListener('click', function () { showPage('about'); });
  // 第二層的返回鈕：data-back＝回到哪一頁（練習、我）
  document.querySelectorAll('[data-back]').forEach(function (el) {
    el.addEventListener('click', function () { showPage(el.getAttribute('data-back')); });
  });

  // 第十四批：結算卡的按鈕。「再來一盤」＝同一組設定重新開一盤（開局教學帶進來的前幾手照舊擺好）
  $('rsAgain').addEventListener('click', newGame);
  // v0.5.10（規格 AT）：兩人一起下的「換邊再下一盤」＝交換黑白（同選單的「⇅ 交換」：玩家、提示、兩人不同的時間都跟著人走）＋再來一盤（同規則、同棋鐘，走 newGame）。
  // 選單也跟著換成這盤換邊後的兩位；選單原本就是這盤的設定（大按鈕寫「再下一盤」）時，換完仍算「和上次一樣」
  $('rsSwap').addEventListener('click', function () {
    if (S.mode !== 'pvp') return;
    var same = settings.last === setupKey();
    var b = S.pidW, w = S.pidB;
    S.pidB = b; S.pidW = w;
    S.clockSet = swapClockSides(normClock(S.clockSet));
    swapPvpSetup(b, w);
    if (same) settings.last = setupKey();
    setupChanged();
    newGame();
  });
  $('rsReview').addEventListener('click', function () { enterReview(gameInfoFromState(), 'game'); });
  $('rsMenu').addEventListener('click', backToMenu);
  $('rsUndo').addEventListener('click', undo);
  $('rsShare').addEventListener('click', shareNow); // v0.5.19（規格 AW）
  $('rvBackBtn').addEventListener('click', function () { if (S.review) exitReview(); });

  // 第十四批（規格 V）：對局畫面的「⋯」（底部面板；Esc、點面板外、關閉鈕都能關）。
  // 第二十四批（規格 Z3、Z7）：重新開始、回頭看這盤、規則說明、外觀、回到選單；頂端一行小字寫這盤的設定；打開時棋鐘停
  var sheetReturn = null;
  function sheetSetupText() {
    var rule = ruleLabel(S.rule, S.strict), clk = S.clk.cfg ? clockLabel(S.clk.cfg) : t('clock.noneShort');
    return S.mode === 'pvp' ? t('sheet.setupPvp', { rule: rule, clock: clk }) : t('sheet.setupPve', { tier: tierName(S.tier), rule: rule, clock: clk });
  }
  function openMoreSheet() {
    sheetReturn = $('moreBtn');
    updateStatus();
    $('sheetSetup').textContent = sheetSetupText();
    renderSheetHints(); // 規格 AL：兩人一起下時每位玩家的提示開關
    setClockPause('sheet', true);
    $('moreSheet').hidden = false;
    var first = $('moreSheet').querySelector('button:not(:disabled)');
    if (first) first.focus();
  }
  // back：關掉後把焦點還給「⋯」（接著要開別的面板時不還，讓那個面板記住「⋯」）
  function closeMoreSheet(back) {
    if ($('moreSheet').hidden) return;
    $('moreSheet').hidden = true;
    setClockPause('sheet', false);
    if (back && sheetReturn && sheetReturn.focus) sheetReturn.focus();
  }
  $('moreBtn').addEventListener('click', openMoreSheet);
  $('moreSheetClose').addEventListener('click', function () { closeMoreSheet(true); });
  $('moreSheet').addEventListener('click', function (e) { if (e.target === this) closeMoreSheet(true); });
  $('reviewBtn').addEventListener('click', function () { closeMoreSheet(false); enterReview(gameInfoFromState(), 'game'); });
  $('gameHelpBtn').addEventListener('click', function () { closeMoreSheet(false); openRuleHelp({ currentTarget: $('moreBtn') }); });
  $('gameThemeBtn').addEventListener('click', function () { closeMoreSheet(false); openThemePanel({ currentTarget: $('moreBtn') }); });
  $('menuBtn').addEventListener('click', function () { closeMoreSheet(true); confirmAbandon(backToMenu); });
  // v0.5.14（規格 AU）：棋子上顯示手數的兩個開關（對局＝「⋯」面板的 #numsBtn、回頭看＝拉桿旁的 #rvNums），各自記在這台裝置。
  // 按了馬上重畫棋盤；「⋯」面板不收起（面板上面看得到棋盤）
  function renderNums() {
    $('numsBtn').setAttribute('aria-checked', settings.numsGame ? 'true' : 'false');
    $('rvNums').setAttribute('aria-pressed', settings.numsReview ? 'true' : 'false');
    $('rbNums').setAttribute('aria-pressed', settings.numsReview ? 'true' : 'false'); // v0.5.15：擺棋盤研究的「手數」
  }
  // v0.5.15（規格 AU 第二版）：擺棋盤研究的「手數」鈕和回頭看共用 numsReview
  function setNums(key, on) {
    settings[key] = !!on;
    saveSettings();
    renderNums();
    if (!$('game').hidden) draw();
    if (!$('research').hidden) rsRender();
  }
  $('numsBtn').addEventListener('click', function () { setNums('numsGame', !settings.numsGame); });
  $('rvNums').addEventListener('click', function () { setNums('numsReview', !settings.numsReview); });
  renderNums();
  // v0.5.11（規格 AO）：認輸、求和
  $('resignBtn').addEventListener('click', function () { closeMoreSheet(true); askResign(); });
  $('drawBtn').addEventListener('click', function () { closeMoreSheet(true); askDraw(); });
  // v0.5.10（規格 AS）：視窗變寬變窄（轉向、桌機拉視窗）時練習題的棋盤也重算（只看寬度：iPhone 網址列收放只改高度，棋盤不跟著跳）
  window.addEventListener('resize', function () {
    resize(); if (!$('themePanel').hidden) placeThemePanel(); if (window.innerWidth !== pzFitW) pzFit();
    if (window.innerWidth !== rsFitW) rsFit(); // v0.5.15（規格 AU 第二版）：擺棋盤研究的棋盤（同練習題，只看寬度）
  });
  window.addEventListener('orientationchange', resize);

  // 測試用的小門：無頭瀏覽器驗收時讀狀態。只在網址帶 ?test=1 時掛上，一般開啟不會有。
  // 第十二批 c：index.html 的 GOMOKU_RELEASE 是 true（正式版）時，帶 ?test=1 也不掛。
  if (window.GOMOKU_RELEASE !== true && /[?&]test=1(?:&|$)/.test(location.search)) {
    window.__gomokuApp = { S: S, settings: settings, setTier: setTier, startGame: startGame, enterReview: enterReview, endGame: endGame,
      gameInfoFromRecord: gameInfoFromRecord, showPage: showPage, refreshHints: refreshHints, me: me, menuTier: menuTier,
      // 第二十一批 b：預先思考（規格 T2）；onPonderMessage 讓測試餵假的舊世代訊息
      P: P, maybePonder: maybePonder, cancelPonder: cancelPonder, maybeAI: maybeAI, cancelAI: cancelAI, play: play, undo: undo,
      newGame: newGame, backToMenu: backToMenu, onPonderMessage: onPonderMessage,
      aiWorkerRef: function () { return aiWorker; }, // judge 第十一輪 F4：悔棋時 aiWorker 有沒有被換掉
      // 第八批 b：外觀
      applyTheme: applyTheme, motionOK: motionOK, anim: function () { return bv.animState(); }, soundCount: function () { return soundCount; },
      // 第十二批 c：練習題狀態、兩個棋盤畫的內容
      PZ: PZ, renderPuzzle: renderPuzzle, pzList: pzList, boardView: function () { return bv.view(); }, pzView: function () { return pzView.view(); },
      // 第十二批 d：答錯播放前的模擬
      pzLineOK: pzLineOK, pzLineSafe: pzLineSafe, pzCounter: pzCounter, completeToFive: completeToFive,
      // 第十四批：分頁、結算卡、提醒列
      curPage: function () { return curPage; }, tabView: tabView, renderResult: renderResult, renderHints: renderHints,
      setLearnTab: function (x) { learnTab = x; }, confirmAbandon: confirmAbandon,
      // v0.5.18（規格 AQ）：開局介紹（開局表讀取的狀態、開著的是哪一個）
      OT: OT, opd: function () { return opd; }, loadOpeningTable: loadOpeningTable,
      // v0.5.11（規格 AO）：認輸、求和（測試也可以直接按「⋯」裡的鈕）、紀錄的小標籤
      askResign: askResign, askDraw: askDraw, recTags: recTags, canUndo: canUndo,
      // v0.5.12（規格 AP-1）：接著下（存的鍵、讀出來的樣子、再問一次）
      RESUME_KEY: RESUME_KEY, readResume: readResume, offerResume: offerResume, resumeParse: resumeParse,
      resumeWhen: resumeWhen, recAt: function () { return S.recAt; }, // v0.5.12 複審
      // 第十五批：棋盤的格位（畫座標時外側多一道邊，測試不能再用「寬度 ÷ 15」算點）
      geo: function (id) { var g = (id === 'pzBoard' ? pzView : id === 'rbBoard' ? rsView : bv).geo; return { css: g.css, cell: g.cell, margin: g.margin, pad: g.pad }; },
      // v0.5.15（規格 AU 第二版）：擺棋盤研究（狀態、純函式、畫的內容與手數、放大、光環與標籤、小幫手的時限、從回頭看進來）
      RS: RS, rsParse: rsParse, rsFormat: rsFormat, rsMover: rsMover, rsCopyString: rsCopyString, rsCaps: RS_CAPS,
      rsView: function () { return rsView.view(); }, rsNums: function () { return rsView.nums(); }, rsAnim: function () { return rsView.animState(); },
      rsZoom: function () { return rsZoom.state(); }, rsZoomSet: function (z, x, y) { rsZoom.set(z, x, y); },
      rsWorker: function () { return rsWorker; }, rsExpire: function () { expireLabels(true, RS_HALO); },
      rsHalo: function () {
        return { rings: RS.halo.rings.map(function (x) { return { r: x.r, c: x.c, own: x.own }; }),
          groups: RS.halo.groups.map(function (g) { return { key: g.key, own: g.own, color: g.color, kind: g.kind, label: t(g.label), stones: g.stones }; }),
          labels: RS.halo.labels.map(function (l) { return { key: l.key, own: l.own, text: l.el ? l.el.textContent : l.text, inDom: !!(l.el && l.el.isConnected), cls: l.el ? l.el.className : '' }; }) };
      },
      // 第二十四批：棋鐘（純函式與假時鐘：clockFake(毫秒) 之後所有時間都是這個值，null 換回真時鐘）、座位條、光環與標籤
      clockState: clockState, clockCfg: clockCfg, normClock: normClock, clockLabel: clockLabel, clockText: clockText,
      clockFake: function (ms) { fakeNow = ms; }, clockNow: cnow, clockSt: clockSt, clockTick: tickClock, setClockPause: setClockPause,
      beepCount: function () { return beepCount; }, layoutSeats: layoutSeats, renderSeats: renderSeats,
      hintsOn: hintsOn, ownRoadOn: ownRoadOn, teachOn: teachOn, renderClockCard: renderClockCard, stopTeach: stopTeach,
      setHalos: setHalos, // judge 第十三輪 F5 的檢查：餵假的組
      // 規格 AM：棋盤放大（state＝倍數、位移、畫布解析度倍數、「還原」鈕、進行中的手勢）、點兩下確認的預覽子
      zoom: function (id) { return (id === 'pzBoard' ? pzZoom : bz).state(); }, zoomSet: function (id, z, x, y) { (id === 'pzBoard' ? pzZoom : bz).set(z, x, y); },
      preview: function () { return { game: S.preview, pz: PZ.preview || null }; },
      // v0.5.14（規格 AU）：上一次畫在棋子上的手數（board＝對局與回頭看、pzBoard＝練習題）、兩個開關
      nums: function (id) { return (id === 'pzBoard' ? pzView : bv).nums(); }, setNums: setNums,
      // 天元那一批：開場字卡（cardHold 停住計時、讓測試看播到一半的樣子；cardSkip＝點一下跳過）、掃光次數、不給提示的階
      cardState: function () { return { card: S.card, n: S.cardN, sweep: S.sweep, hidden: $('tgCard').hidden, run: $('tgCard').classList.contains('run'), timer: !!S.cardTimer }; },
      cardHold: function () { if (S.cardTimer) clearTimeout(S.cardTimer); S.cardTimer = null; }, cardSkip: finishCard,
      // v0.5.5：書法字的 canvas（cardInk：state＝模式、解析度、每一筆的時間；inkSeek 停在第幾毫秒那一幀；inkFail 讓下一幀出錯，驗改用靜態字）
      // v0.5.5：分出勝負的那一下（endHold：還在等就回 { reason, ms, left }；endSkip＝點棋盤跳過）
      endHold: function () { return S.endHold ? { reason: S.endHold.reason, ms: S.endHold.ms, left: Math.round(S.endHold.ms - (performance.now() - S.endHold.t0)) } : null; },
      endSkip: releaseEndHold, forbidCue: function () { return S.forbidCue; },
      cardInk: function () { return cardInk.state(); }, inkSeek: function (ms) { cardInk.seek(ms); }, inkFail: function () { cardInk.failNext(); }, noHintTier: noHintTier, streakHint: streakHint, chanceTenths: chanceTenths,
      ponderWanted: ponderWanted, tierRank: tierRank, // v0.5.13（規格 AF）：入門・2 不先想、先後
      // v0.5.17（規格 AV）：每日一題的假日期（dailyFake(ms)：之後「今天」照這個時間算，順便跑一次換日的檢查——noTick 就不跑，
      // 讓測試自己派 visibilitychange；null 換回真時間）、換日檢查（＝計時器、切回網頁時做的事）、今天的題目、這盤結算卡的成就
      dailyFake: function (ms, noTick) { dailyFakeNow = ms; if (!noTick) dailyTick(); }, dailyTick: dailyTick, dailyKeyNow: dailyKeyNow, dailyNow: dailyNow,
      dailyPuzzle: dailyPuzzle, renderDailyCard: renderDailyCard, lastAch: function () { return S.lastAch; }, achText: achText,
      // v0.5.19（規格 AW）：分享圖片——shareImage()＝現在按下去會做的那張（dataURL＋版面與字）、shareBoard(view)＝另外畫一個一樣的棋盤（比對像素）、
      // shareLog()＝每一次按下去走了哪一條路（share／shared／abort／error-download／download／fail）、shareFileName(毫秒)
      shareImage: function () { var r = shareImage(); return { url: r.canvas.toDataURL('image/png'), meta: r.meta }; },
      shareBoard: function (view) { return shareBoardCanvas(view).toDataURL('image/png'); },
      shareLog: function () { return shareLog.slice(); }, shareFileName: function (ms) { return shareFileName(new Date(ms)); }, shareNow: shareNow,
      afterProfileChange: afterProfileChange, // v0.5.17 複審：換帳號以後今天的題目頁重出（帳號面板換帳號時走這裡）
      teachPlay: function (key) { var g = S.halo.groups.filter(function (x) { return x.key === key; })[0]; if (g) playTeach(g); },
      teachState: function () { return S.teach ? { step: S.teach.step, n: S.teach.line.length, ghosts: teachGhosts() } : null; }, expireLabels: function () { expireLabels(true); },
      haloState: function () {
        return { rings: S.halo.rings.map(function (x) { return { r: x.r, c: x.c, own: x.own, t0: x.t0 }; }),
          groups: S.halo.groups.map(function (g) { return { key: g.key, own: g.own, kind: g.kind, label: t(g.label), stones: g.stones, block: g.block }; }),
          labels: S.halo.labels.map(function (l) { return { key: l.key, own: l.own, text: l.el ? l.el.textContent : l.text, x: l.x, y: l.y, rect: l.rect, dot: !!l.dot,
            fade: !!(l.el && l.el.classList.contains('fade')), inDom: !!(l.el && l.el.isConnected) }; }),
          anim: bv.animState() };
      } };
  }

  drawThemePreviews();
  applyTheme();
  applyLang();
  showPage('play');
  dailyTick(); // v0.5.17（規格 AV）：排好半夜換日的計時器
  watchBattery();
  offerResume(); // v0.5.12（規格 AP-1）：上一盤還沒下完就問要不要接著下
})();
