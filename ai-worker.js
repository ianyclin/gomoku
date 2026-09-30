// AI 在背景執行緒算，主執行緒（畫面、點擊）不卡。訊息：
//   下一手（原本的格式，沒有 type）：收 { id, board, player, level, rule }，回 { id, move }。
//   復盤：收 { type: 'analyze', id, moves: [{r,c}…], rule, opts: { perMoveMs, totalMs } }（opts 可省略，照 ai.js 的預設：每手 800 ms、整盤 30000 ms），
//         每分析完一手回 { type: 'analyzeProgress', id, index, result }（result 見 ai.js 的 analyzeGameStep），
//         全部做完回 { type: 'analyzeDone', id, summary }（summary 見 ai.js 的 analyzeGameSummary：firstLosing、unanalyzedCount、
//         unanalyzedBeforeLosing、tailUnanalyzed、forbiddenLoss）；手順不合法時回 { type: 'analyzeError', id, message }。
//         兩手之間用 setTimeout 讓出，期間收到的其他訊息（例如下一手）會先處理。
//   威脅清單：收 { type: 'threats', id, board, player, rule, opts }，回 { type: 'threatsResult', id, result }（見 ai.js 的 listThreats）。
try { importScripts('data/openings.js'); } catch (e) { /* 沒有開局庫也能下，只是不用開局庫、認不出開局 */ }
importScripts('ai.js');

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

self.onmessage = function (e) {
  var d = e.data;
  if (d && d.type === 'analyze') { runAnalyze(d); return; }
  if (d && d.type === 'threats') {
    self.postMessage({ type: 'threatsResult', id: d.id, result: self.Gomoku.listThreats(d.board, d.player, d.rule, d.opts) });
    return;
  }
  var move = self.Gomoku.getMove(d.board, d.player, d.level, { rule: d.rule });
  self.postMessage({ id: d.id, move: move });
};
