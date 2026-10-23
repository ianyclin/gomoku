// AI 在背景執行緒算，主執行緒（畫面、點擊）不卡。訊息：
//   下一手（原本的格式，沒有 type）：收 { id, board, player, level, rule }，回 { id, move }。
//   復盤：收 { type: 'analyze', id, moves: [{r,c}…], rule, opts: { perMoveMs, totalMs } }（opts 可省略，照 ai.js 的預設：每手 800 ms、整盤 30000 ms），
//         每分析完一手回 { type: 'analyzeProgress', id, index, result }（result 見 ai.js 的 analyzeGameStep），
//         全部做完回 { type: 'analyzeDone', id, summary }（summary 見 ai.js 的 analyzeGameSummary：firstLosing、unanalyzedCount、
//         unanalyzedBeforeLosing、tailUnanalyzed、forbiddenLoss）；手順不合法時回 { type: 'analyzeError', id, message }。
//         兩手之間用 setTimeout 讓出，期間收到的其他訊息（例如下一手）會先處理。
//   威脅清單：收 { type: 'threats', id, board, player, rule, opts }，回 { type: 'threatsResult', id, result }（見 ai.js 的 listThreats）。
//   擺棋盤研究（v0.5.15，規格 AU 第二版）：收 { type: 'research', id, board, player（輪到誰）, rule, opts: { moverMs, otherMs } }，
//         回 { type: 'researchResult', id, result }（result 見 ai.js 的 researchSearch：{ mover, five, sides: [{ p, status, kind, line, k }] }）；
//         出錯回 { type: 'researchResult', id, result: null, error }。頁面用自己開的一個 Worker 送這個（一次最多約 5 秒），
//         取消＝直接關掉那個 Worker（下一手、威脅清單、回頭看的分析不受影響）。
//   預先思考（規格 T2，第二十一批 b）：收 { type: 'ponder', gen, board, player（人）, level, rule, k }。先取人最可能的 k 步
//         （ponderGuesses：引擎候選評分前 k 名；連珠黑棋的候選已排除禁手點），依序對每一步回 { type: 'ponderStart', gen, move }、
//         把那步放上盤算電腦的回應，回 { type: 'ponderResult', gen, move, reply }（reply 就是 getMove 的結果，可能是 null）。
//         人下那步就成五或下滿盤的猜測不算（對局會結束，用不到回應）。每做完一步用 setTimeout 讓出；讓出前後都檢查
//         curPonderGen 仍是這批的 gen，否則停（收到新的 ponder 訊息就換 curPonderGen）。頁面平常直接關掉這個 Worker 來取消。
//         這個 Worker 是頁面另開的第二個（專做預先思考），和下一手的 Worker 分開：getMove 算的時候收不到訊息。
//   防守題答錯、對手怎麼贏（v0.5.25 後）：收 { type: 'oppWin', id, board, player（攻方＝對手）, rule, opts: { maxThreats, maxNodes, timeLimit } }，
//         回 { type: 'oppWinResult', id, result }（result 見下面的 oppWin；出錯時 result 是 null、另附 error）。只收盤面、攻方、規則、預算；
//         補到成五（completeToFive）和播之前的檢查都在頁面那一邊。頁面用自己開的一個 Worker 送這個，取消＝直接關掉那個 Worker。
// 第十八批：主執行緒用 ai-worker.js 加 v 參數（版本號）開這支，importScripts 的三個檔也帶同一個 v，改版時一起換新
var VQ = (/[?&]v=([^&#]*)/.exec(self.location.href) || [])[1];
VQ = VQ ? '?v=' + VQ : '';
try { importScripts('data/openings.js' + VQ); } catch (e) { /* 沒有開局庫也能下，只是不用開局庫、認不出開局 */ }
try { importScripts('data/tengen-book.js' + VQ); } catch (e) { /* 天元開局庫（規格 AI）：沒有也能下，天元照一般流程 */ }
importScripts('ai.js' + VQ);
// 第二十批 b（judge F4）：這支檔案自己的版本號（和 index.html 的 GOMOKU_VERSION 同一個值；release.py 兩處一起改）。
// 頁面開著時發布了新版，重建 Worker 會拿到新檔：一啟動就把自己的版本號（和網址上的 v）告訴頁面，頁面比對不一樣就提示重新整理
var GOMOKU_WORKER_VERSION = 'v0.5.26';
self.postMessage({ type: 'hello', version: GOMOKU_WORKER_VERSION, urlV: VQ ? decodeURIComponent(VQ.slice(3)) : '' });

function runAnalyze(d) {
  var G = self.Gomoku, st;
  try { st = G.analyzeGameInit(d.moves, d.rule, d.opts); }
  catch (err) { self.postMessage({ type: 'analyzeError', id: d.id, message: String(err && err.message || err) }); return; }
  (function step() {
    var r;
    try { r = G.analyzeGameStep(st); }
    catch (err) { self.postMessage({ type: 'analyzeError', id: d.id, message: String(err && err.message || err) }); return; }
    if (!r) { self.postMessage({ type: 'analyzeDone', id: d.id, summary: G.analyzeGameSummary(st) }); return; }
    self.postMessage({ type: 'analyzeProgress', id: d.id, index: r.index, result: r });
    setTimeout(step, 0);
  })();
}

// 預先思考的猜測：人（player）最可能下的 k 步＝引擎候選評分（analyze 的 score）前 k 名。
// tools/t2-sim.js 也載入這支檔案用同一個函式算命中率，所以引擎由參數傳入（G＝self.Gomoku 或 node 的 require）
// 空盤時 analyze 的候選是全盤空點、分數都一樣（會猜到角落），所以只猜天元
function ponderGuesses(G, board, player, rule, k) {
  var mid = (board.length / 2) | 0;
  if (board.every(function (row) { return row.every(function (x) { return !x; }); })) return [{ r: mid, c: mid }];
  var list = G._internal.analyze(board, player, rule === 'renju' ? 'renju' : 'free').slice();
  list.sort(function (a, b) { return b.score - a.score; });
  return list.slice(0, k > 0 ? k : 3).map(function (m) { return { r: m.r, c: m.c }; });
}

// 防守題答錯：攻方 player 先下，叫一次 findVCT（威脅數、節點數、時間照 opts；findVCT 自己由淺到深找，不用一層一層重叫）。
// 找到時手順最後輪到守方、最後一手還沒成五，再從手順最後一手叫 forcedWinAfter（守方先應、已補到成五），時間是剩下的、至少 100 ms。
// 回傳 null（沒找到或超過預算）或 { line: findVCT 的手順, fw: forcedWinAfter 的手順或 null }，都是 [{r,c}…]、不改動 board。
// test.js 也載入這支檔案用同一個函式（引擎由參數傳入）
function oppWin(G, board, player, rule, opts) {
  opts = opts || {};
  var t0 = Date.now(), ms = opts.timeLimit > 0 ? opts.timeLimit : 8000;
  var bud = { rule: rule, maxThreats: opts.maxThreats, maxNodes: opts.maxNodes, timeLimit: ms };
  var v = G.findVCT(board, player, bud);
  if (!v || !v.line || !v.line.length) return null;
  var raw = v.line.map(function (m) { return { r: m.r, c: m.c }; }), fw = null, clash = false;
  var b = board.map(function (row) { return row.slice(); });
  raw.forEach(function (x, i) { if (b[x.r][x.c]) clash = true; else b[x.r][x.c] = i % 2 ? 3 - player : player; });
  var lm = raw[raw.length - 1];
  if (raw.length % 2 && !clash && !G.checkWin(b, lm.r, lm.c, rule)) {
    bud.timeLimit = Math.max(100, ms - (Date.now() - t0));
    var f = G.forcedWinAfter(b, player, bud);
    if (f && f.status === 'win' && f.line) fw = f.line.map(function (m) { return { r: m.r, c: m.c }; });
  }
  return { line: raw, fw: fw };
}

var curPonderGen = 0;
function runPonder(d) {
  var G = self.Gomoku, gen = d.gen, rule = d.rule === 'renju' ? 'renju' : 'free', guesses, i = 0;
  curPonderGen = gen;
  try { guesses = ponderGuesses(G, d.board, d.player, rule, d.k); } catch (err) { return; }
  (function step() {
    if (curPonderGen !== gen) return;
    while (i < guesses.length) {
      var mv = guesses[i++], b = d.board.map(function (row) { return row.slice(); });
      b[mv.r][mv.c] = d.player;
      if (G.checkWin(b, mv.r, mv.c, rule) || G.isFull(b)) continue; // 這步下了對局就結束，不用想回應
      self.postMessage({ type: 'ponderStart', gen: gen, move: mv });
      var reply = G.getMove(b, 3 - d.player, d.level, { rule: rule });
      if (curPonderGen !== gen) return;
      self.postMessage({ type: 'ponderResult', gen: gen, move: mv, reply: reply });
      setTimeout(step, 0);
      return;
    }
  })();
}

self.onmessage = function (e) {
  var d = e.data;
  if (d && d.type === 'ponder') { runPonder(d); return; }
  if (d && d.type === 'analyze') { runAnalyze(d); return; }
  if (d && d.type === 'research') {
    var rr = null, err = null;
    try { rr = self.Gomoku.researchSearch(d.board, d.player, d.rule, d.opts); } catch (e) { err = String(e && e.message || e); }
    self.postMessage({ type: 'researchResult', id: d.id, result: rr, error: err });
    return;
  }
  if (d && d.type === 'oppWin') {
    var ow = null, oerr = null;
    try { ow = oppWin(self.Gomoku, d.board, d.player, d.rule === 'renju' ? 'renju' : 'free', d.opts); } catch (e) { oerr = String(e && e.message || e); }
    self.postMessage({ type: 'oppWinResult', id: d.id, result: ow, error: oerr });
    return;
  }
  if (d && d.type === 'threats') {
    self.postMessage({ type: 'threatsResult', id: d.id, result: self.Gomoku.listThreats(d.board, d.player, d.rule, d.opts) });
    return;
  }
  var move = self.Gomoku.getMove(d.board, d.player, d.level, { rule: d.rule });
  self.postMessage({ id: d.id, move: move });
};
