/*
 * 五子棋：規則與 AI（15×15，黑先）
 *   rule 'free'  自由規則：五連以上即勝，無禁手
 *   rule 'renju' 連珠禁手：黑棋只有恰好五連算勝；黑棋三三、四四、長連是禁手；白棋五連以上即勝
 * 不依賴 DOM。瀏覽器／Worker 下掛到 self.Gomoku，node 下 module.exports。
 * 開局庫資料在 data/openings.js（瀏覽器／Worker 要先載入它，掛在 self.GomokuOpenings；node 用 require）；
 * 沒載入時開局庫與 detectOpening 自動停用，其餘照常。
 * 天元開局庫（規格 AI，只有階 12 用）在 data/tengen-book.js（掛在 self.GomokuTengenBook；node 用 require）；沒載入時天元照一般流程。
 */
(function (root, factory) {
  var G = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = G;
  else root.Gomoku = G;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var SIZE = 15;
  var CENTER = 7;
  var DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  function realNow() {
    return (typeof performance !== 'undefined' && performance && performance.now)
      ? performance.now() : Date.now();
  }
  // 第十一批：測試用的假時鐘。_internal.setClockScale(k) 之後，引擎看到的時間走得比真的快 k 倍（模擬慢 k 倍的裝置）；
  // k＝1 恢復真時鐘（時間會跳回真的時間，所以只在兩次分析之間切換）。遊戲流程不用。
  // 天元步驟 0（規格 AE）：_internal.setClock(fn) 之後，引擎所有計時都改讀 fn()（例如 selfplay／bookbot 的節點時鐘：
  // 每讀一次走固定虛擬毫秒，強檔結果可重現、不受負載影響）；setClock(null) 還原真時鐘。設了 fn 時 setClockScale 不起作用。
  var clockFn = null;
  function setClock(fn) { clockFn = typeof fn === 'function' ? fn : null; }
  var clockScale = 1, clockReal0 = 0, clockFake0 = 0;
  // 時鐘權重（2026-10-02，README「天元／時鐘權重與表上限」）：每個讀時鐘的地方帶一個權重 w＝「這裡兩次讀時鐘之間平均做了幾個
  // α-β 節點那麼久的事」，now(w) 原封交給 setClock 的 fn（節點時鐘每讀一次走 STEP × w 虛擬毫秒）；真時鐘與 setClockScale 不看 w。
  // 鍵＝讀時鐘的地方（全部列在 README）：negamax 每個節點；leaf 每 256 個共用 ctx.nodes；vcf 每 128 個共用 ctx.nodes；
  // vct 每 16 個 VCT 節點（vctTick）；ww 每 16 個 winWithin 節點；strict 嚴格驗證器每 32 個節點；strictVcf 嚴格驗證器的 VCF 每 128 個節點；
  // deepen 每個深度開始與搜完；search strongSearch／mediumMove 的期限計算；veto 否決關卡每個候選；quiet 安靜棋檢查每個安靜棋與應手；
  // once 其他只讀一次的（API 入口的期限、復盤）。NODE_STEP＝節點時鐘預設的每單位虛擬毫秒（≈ 這台機器自由規則 negamax 每讀一次的真毫秒）。
  // 兩種規則各一份（連珠的禁手判定讓每讀一次的真時間約是自由規則的 3.5 倍，各處的比例也不同，一份權重對不上兩種規則）；
  // 搜尋用 ctx.cw（newCtx 依規則挑）。數字是 2026-10-02 在這台機器空機、真時鐘下量的（t1-positions 200 局面 × 階 9–12 × 兩種規則，
  // 每一段兩次讀時鐘之間的真時間記在後一次讀的地方），四捨五入到 0.25（加總不會有浮點誤差）。
  var CLOCK_W = {
    free: { negamax: 1, leaf: 3.75, vcf: 17.75, vct: 9, ww: 21, strict: 55.5, strictVcf: 39.75, deepen: 1.75, search: 5.75, veto: 1.75, quiet: 4, once: 1 },
    renju: { negamax: 3.5, leaf: 24.5, vcf: 47.75, vct: 41.5, ww: 50, strict: 117.75, strictVcf: 113.75, deepen: 5, search: 7, veto: 6.25, quiet: 15.25, once: 1 }
  };
  function clockW(rule) { return rule === 'renju' ? CLOCK_W.renju : CLOCK_W.free; }
  var NODE_STEP = 0.022;
  function now(w) {
    if (clockFn) return clockFn(w);
    var t = realNow();
    return clockScale === 1 ? t : clockFake0 + (t - clockReal0) * clockScale;
  }
  function setClockScale(k) {
    var f = now();
    clockReal0 = realNow();
    clockFake0 = f;
    clockScale = k > 0 ? k : 1;
  }

  // ---------------------------------------------------------------- 規則

  function createBoard() {
    var b = [];
    for (var r = 0; r < SIZE; r++) {
      var row = [];
      for (var c = 0; c < SIZE; c++) row.push(0);
      b.push(row);
    }
    return b;
  }

  function inside(r, c) {
    return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  }

  // 以 (r,c) 這顆子為準檢查是否獲勝。
  // 自由規則與白棋：連成 5 以上即勝，長連回傳整條連線。
  // rule === 'renju' 的黑棋：只有恰好 5 連才算，6 連以上不算。
  // 一手同時連成兩條以上時，回傳全部連線格（合併、去重）。
  function checkWin(board, r, c, rule) {
    if (!inside(r, c)) return null;
    var p = board[r][c];
    if (!p) return null;
    var exact = rule === 'renju' && p === 1;
    var all = [], seen = {};
    for (var d = 0; d < 4; d++) {
      var dr = DIRS[d][0], dc = DIRS[d][1];
      var cells = [[r, c]];
      var rr = r - dr, cc = c - dc;
      while (inside(rr, cc) && board[rr][cc] === p) { cells.unshift([rr, cc]); rr -= dr; cc -= dc; }
      rr = r + dr; cc = c + dc;
      while (inside(rr, cc) && board[rr][cc] === p) { cells.push([rr, cc]); rr += dr; cc += dc; }
      if (exact ? cells.length !== 5 : cells.length < 5) continue;
      for (var i = 0; i < cells.length; i++) {
        var k = cells[i][0] * SIZE + cells[i][1];
        if (seen[k]) continue;
        seen[k] = 1;
        all.push(cells[i]);
      }
    }
    return all.length ? { player: p, cells: all } : null;
  }

  // (r,c) 上已有 p，沿 (dr,dc) 數經過它的連續 p 子數。
  function runLen(board, r, c, dr, dc, p) {
    var n = 1, rr = r + dr, cc = c + dc;
    while (inside(rr, cc) && board[rr][cc] === p) { n++; rr += dr; cc += dc; }
    rr = r - dr; cc = c - dc;
    while (inside(rr, cc) && board[rr][cc] === p) { n++; rr -= dr; cc -= dc; }
    return n;
  }

  // ---------------------------------------------------------------- 連珠禁手
  //
  // 定義（只對黑棋）：
  //   四：再下一子能成「恰好五」。同一條線上兩個成五點若正好夾著四顆連子（_XXXX_，活四）算一個四，
  //       否則每個成五點各算一個四（例如 X_XXX_X 的中間那子同一線兩個四）。
  //   活三：再下一子能成活四（_XXXX_，兩端都能成恰好五），而且那一子本身不是禁手點。遞迴判定。
  //   長連：6 連以上。
  // 該手同時成恰好五則是贏，不算禁手。

  // 黑子已在 (r,c)：沿 (dr,dc) 前後 4 格內，再下一子能讓經過 (r,c) 的連線成恰好五的點（回傳位移 k，遞增）。
  function exactFivePoints(board, r, c, dr, dc) {
    var out = [];
    for (var k = -4; k <= 4; k++) {
      if (!k) continue;
      var qr = r + dr * k, qc = c + dc * k;
      if (!inside(qr, qc) || board[qr][qc]) continue;
      board[qr][qc] = 1;
      var n = runLen(board, r, c, dr, dc, 1);
      board[qr][qc] = 0;
      if (n === 5) out.push(k);
    }
    return out;
  }

  function isStraightFour(F) {
    return F.length === 2 && F[1] - F[0] === 5;
  }

  // 黑子已在 (r,c) 時的禁手判定
  function forbiddenPlaced(board, r, c) {
    var d, dr, dc, k, over = false;
    for (d = 0; d < 4; d++) {
      var n = runLen(board, r, c, DIRS[d][0], DIRS[d][1], 1);
      if (n === 5) return null;       // 成五優先
      if (n > 5) over = true;
    }
    if (over) return '長連';
    var fours = 0, threeDirs = [];
    for (d = 0; d < 4; d++) {
      dr = DIRS[d][0]; dc = DIRS[d][1];
      var F = exactFivePoints(board, r, c, dr, dc);
      if (F.length) { fours += isStraightFour(F) ? 1 : F.length; continue; }
      var qs = [];
      for (k = -4; k <= 4; k++) {
        if (!k) continue;
        var qr = r + dr * k, qc = c + dc * k;
        if (!inside(qr, qc) || board[qr][qc]) continue;
        board[qr][qc] = 1;
        var straight = isStraightFour(exactFivePoints(board, r, c, dr, dc));
        board[qr][qc] = 0;
        if (straight) qs.push([qr, qc]);
      }
      if (qs.length) threeDirs.push(qs);
    }
    if (fours >= 2) return '四四';
    if (threeDirs.length < 2) return null;
    var real = 0;
    for (var i = 0; i < threeDirs.length; i++) {
      for (var j = 0; j < threeDirs[i].length; j++) {
        if (!isForbidden(board, threeDirs[i][j][0], threeDirs[i][j][1])) { real++; break; }
      }
    }
    return real >= 2 ? '三三' : null;
  }

  // 黑棋下在空點 (r,c) 是否禁手：回傳 null | '三三' | '四四' | '長連'。不改動 board。
  function isForbidden(board, r, c) {
    if (!inside(r, c) || board[r][c]) return null;
    board[r][c] = 1;
    try { return forbiddenPlaced(board, r, c); }
    finally { board[r][c] = 0; }
  }

  function isFull(board) {
    for (var r = 0; r < SIZE; r++)
      for (var c = 0; c < SIZE; c++)
        if (!board[r][c]) return false;
    return true;
  }

  // ---------------------------------------------------------------- 型態辨識
  //
  // 對某空點假設 p 落子，沿一個方向取前後各 4 格共 9 格的「視窗」：
  //   0 = 空、1 = 自己、2 = 擋住（對手子或盤外）。中心（index 4）固定是自己。
  // 型態用遞迴定義，只看「經過中心」的五連：
  //   連五：經過中心已連 5 以上
  //   活四：再下一子能成五的空點 ≥ 2；沖四：恰 1
  //   活三：再下一子能成活四；眠三：再下一子最多成沖四
  //   活二：再下一子能成活三；眠二：再下一子最多成眠三
  // 結果依 3^9 的鍵值快取，第一次查到才算。

  var NONE = 0, ONE = 1, SLEEP2 = 2, LIVE2 = 3, SLEEP3 = 4, LIVE3 = 5, RUSH4 = 6, LIVE4 = 7, FIVE = 8;
  var SHAPE_SCORE = [0, 10, 30, 200, 300, 3000, 4000, 100000, 10000000];
  // 「再下一子最多能成 X」→ 現在是什麼型態
  var DOWNGRADE = [NONE, ONE, ONE, ONE, SLEEP2, LIVE2, SLEEP3, LIVE3, LIVE4];
  var POW3 = [1, 3, 9, 27, 81, 243, 729, 2187, 6561];
  var shapeTable = new Int8Array(19683);
  for (var t = 0; t < shapeTable.length; t++) shapeTable[t] = -1;
  var work = [0, 0, 0, 0, 1, 0, 0, 0, 0];

  function runThroughCenter(w) {
    var n = 1, i;
    for (i = 3; i >= 0 && w[i] === 1; i--) n++;
    for (i = 5; i <= 8 && w[i] === 1; i++) n++;
    return n;
  }

  function windowKey(w) {
    var k = 0;
    for (var i = 0; i < 9; i++) k += w[i] * POW3[i];
    return k;
  }

  function classify(w) {
    var key = windowKey(w);
    var cached = shapeTable[key];
    if (cached >= 0) return cached;
    var res, i;
    if (runThroughCenter(w) >= 5) {
      res = FIVE;
    } else {
      var fives = 0;
      for (i = 0; i < 9; i++) {
        if (w[i] !== 0) continue;
        w[i] = 1;
        if (runThroughCenter(w) >= 5) fives++;
        w[i] = 0;
      }
      if (fives >= 2) res = LIVE4;
      else if (fives === 1) res = RUSH4;
      else {
        var best = NONE;
        for (i = 0; i < 9; i++) {
          if (w[i] !== 0) continue;
          w[i] = 1;
          var s = classify(w);
          w[i] = 0;
          if (s > best) best = s;
        }
        res = DOWNGRADE[best];
      }
    }
    shapeTable[key] = res;
    return res;
  }

  function cellValue(board, r, c, p) {
    if (!inside(r, c)) return 2;
    var v = board[r][c];
    return v === 0 ? 0 : (v === p ? 1 : 2);
  }

  function shapeAt(board, r, c, p, dr, dc) {
    var key = POW3[4];
    for (var k = 1; k <= 4; k++) {
      key += cellValue(board, r + dr * k, c + dc * k, p) * POW3[4 + k];
      key += cellValue(board, r - dr * k, c - dc * k, p) * POW3[4 - k];
    }
    var s = shapeTable[key];
    if (s >= 0) return s;
    for (var i = 0; i < 9; i++) work[i] = Math.floor(key / POW3[i]) % 3;
    return classify(work);
  }

  // p 下在 (r,c) 的進攻價值；同時把四個方向裡最強的型態留在 lastMax。
  // lastHot：這點「可能是黑棋禁手」（某方向 ≥ 活四或長連，或兩個方向 ≥ 活三），用來省下多數禁手判定。
  var lastMax = NONE, lastHot = false;
  function pointScore(board, r, c, p) {
    var C = cachePeek(board);
    if (C === null) return pointScoreFull(board, r, c, p);
    var v = pointScoreC(C, r * SIZE + c, p);
    if (cacheCheck) {
      var m = lastMax, h = lastHot;
      checkSame('pointScore', [v, m, h], fullOf(function () { var x = pointScoreFull(board, r, c, p); return [x, lastMax, lastHot]; }));
      lastMax = m; lastHot = h;
    }
    return v;
  }

  // 天元步驟 2：同 pointScoreFull，四個方向的型態讀快取（x＝r*SIZE+c）
  function pointScoreC(C, x, p) {
    var sum = 0, fours = 0, threes = 0, max = NONE, hot3 = 0, shp = C.shp, b = ((p - 1) * NCELL + x) * 4;
    for (var d = 0; d < 4; d++) {
      var s = shp[b + d];
      if (s > max) max = s;
      sum += SHAPE_SCORE[s];
      if (s === RUSH4) fours++;
      else if (s === LIVE3) threes++;
      if (s >= LIVE3) hot3++;
    }
    lastMax = max;
    lastHot = max >= LIVE4 || hot3 >= 2;
    if (max === FIVE) return SHAPE_SCORE[FIVE];
    if (fours >= 2) sum += 100000;              // 雙四
    else if (fours >= 1 && threes >= 1) sum += 50000; // 四三
    else if (threes >= 2) sum += 20000;         // 雙活三
    return sum;
  }

  function pointScoreFull(board, r, c, p) {
    var sum = 0, fours = 0, threes = 0, max = NONE, hot3 = 0;
    for (var d = 0; d < 4; d++) {
      var s = shapeAt(board, r, c, p, DIRS[d][0], DIRS[d][1]);
      if (s > max) max = s;
      sum += SHAPE_SCORE[s];
      if (s === RUSH4) fours++;
      else if (s === LIVE3) threes++;
      if (s >= LIVE3) hot3++;
    }
    lastMax = max;
    lastHot = max >= LIVE4 || hot3 >= 2;
    if (max === FIVE) return SHAPE_SCORE[FIVE];
    if (fours >= 2) sum += 100000;              // 雙四
    else if (fours >= 1 && threes >= 1) sum += 50000; // 四三
    else if (threes >= 2) sum += 20000;         // 雙活三
    return sum;
  }

  // ---------------------------------------------------------------- 候選點

  var mark = new Uint8Array(SIZE * SIZE);

  // 已有棋子周圍切比雪夫距離 2 以內的空點；盤上若沒有這種點（空盤或極端情況）就回傳全部空點。
  // 順序（很重要：後面的排序是穩定排序，同分者照這個順序）：棋子照列優先，每顆子的 5×5 鄰格照 (dr, dc) 列優先，第一次碰到時加入。
  function candidates(board) {
    var C = cacheOf(board);
    if (C === null) return candidatesFull(board);
    var list = candidatesC(C);
    if (cacheCheck) checkSame('candidates', list, fullOf(candidatesFull, board));
    return list;
  }

  function candidatesFull(board) {
    for (var i = 0; i < mark.length; i++) mark[i] = 0;
    var list = [];
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (!board[r][c]) continue;
        for (var dr = -2; dr <= 2; dr++) {
          for (var dc = -2; dc <= 2; dc++) {
            var rr = r + dr, cc = c + dc;
            if (!inside(rr, cc) || board[rr][cc]) continue;
            var idx = rr * SIZE + cc;
            if (mark[idx]) continue;
            mark[idx] = 1;
            list.push(idx);
          }
        }
      }
    }
    if (!list.length) {
      for (var r2 = 0; r2 < SIZE; r2++)
        for (var c2 = 0; c2 < SIZE; c2++)
          if (!board[r2][c2]) list.push(r2 * SIZE + c2);
    }
    return list;
  }

  // ---------------------------------------------------------------- 增量型態快取（天元步驟 2，規格 AE）
  //
  // getMove 在自己複製的棋盤上掛一份快取（SC，同時只有一份；離開 getMove 就拿掉），其他棋盤一律走原本的整盤重算。
  // 快取的內容（雙方各一份，全盤 225 格 × 4 個方向，有子的格也算，evaluateLines 要用）：
  //   key：shapeAt 的 3^9 視窗鍵（中心當自己、前後 4 格），shp：那個鍵的型態（shapeTable）；
  //   flag（只對空點有意義）：1 有成五形、2 有沖四／活四形、4 有活三形、8 活二形 ≥ 2 個方向；
  //   兩個集合（只放空點）：A＝flag & 3、B＝flag & 12；occ：每格的子（0／1／2）、stones：子數。
  // 落子／提子（place／unplace，或 setStone／clearStone）只改經過那一點的四條線上前後 4 格（最多 32 格 × 雙方）的 key、shp、flag。
  // 讀快取的函式：candidates、pointScore、analyze、scanThreats、fourMoves、threatPoints、allFivePoints、isW4Move、is43Point、
  // attackMoves、evaluateLines。只要「某格有某種形」才可能有輸出的函式（scanThreats、fourMoves、threatPoints、allFivePoints、
  // 不帶 extended 的 attackMoves）只看集合裡的點，再照 candidates 的順序排好（見 gatherC），每一點的判定照原本的程式；
  // 其餘的點原本就不會有輸出，所以結果（含順序）和整盤重算逐項相同。
  // 禁手（isForbidden）、成五（isFivePoint、makesFive、fivePointsNear）照原本直接讀棋盤：長連、三三、四四要看的不只前後 4 格的形，不進快取。
  // 原本直接寫棋盤、寫完又讀型態的兩處（ruleMoves、threatMakers）改用 setStone／clearStone；其餘直接寫棋盤的地方
  // （isForbidden、isFivePoint、isW4Move、blackFourClass、fourMoves、vcfReplay…）寫完到還原之間只讀棋盤、不讀快取，照舊。
  // 除錯用 _internal.setCacheCheck(true)：每次讀快取前把整份快取和整盤重算逐項比對，每個讀快取的函式也再用原本的程式算一次比對，
  // 不同就丟例外（很慢，只給測試與工具）。_internal.setShapeCache(false)：getMove 不掛快取（量加速倍數用）。
  var NCELL = SIZE * SIZE;
  var SC = null, cacheEnabled = true, cacheCheck = false, cacheChecks = 0;
  // UPD[x]：x 落子時要改的 (Y×4＋d, 3^位置) 對——Y 在 x 的四條線上前後 4 格，x 在 Y 方向 d 的視窗第「位置」格。
  // NBR25[x]：x 當棋子時 candidates 依序檢查的 5×5 鄰格（盤內，(dr, dc) 列優先）。
  // WIN25[x]：x 當空點時，可能讓它成為候選點的棋子 s（5×5 內，列優先）與 x 在 s 的鄰格裡的序號，成對存（見 gatherC）。
  var UPD = [], NBR25 = [], WIN25 = [];
  (function () {
    for (var x = 0; x < NCELL; x++) {
      var r = (x / SIZE) | 0, c = x % SIZE, u = [], nb = [], w = [], d, k, dr, dc;
      for (d = 0; d < 4; d++) {
        dr = DIRS[d][0]; dc = DIRS[d][1];
        for (k = 1; k <= 4; k++) {
          if (inside(r - dr * k, c - dc * k)) u.push(((r - dr * k) * SIZE + (c - dc * k)) * 4 + d, POW3[4 + k]);
          if (inside(r + dr * k, c + dc * k)) u.push(((r + dr * k) * SIZE + (c + dc * k)) * 4 + d, POW3[4 - k]);
        }
      }
      for (dr = -2; dr <= 2; dr++) {
        for (dc = -2; dc <= 2; dc++) {
          if (!inside(r + dr, c + dc)) continue;
          nb.push((r + dr) * SIZE + c + dc);
          w.push((r + dr) * SIZE + c + dc, (2 - dr) * 5 + (2 - dc));
        }
      }
      UPD.push(new Int32Array(u)); NBR25.push(new Int16Array(nb)); WIN25.push(new Int16Array(w));
    }
  })();

  function shapeOfKey(key) {
    var s = shapeTable[key];
    if (s >= 0) return s;
    var w = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (var i = 0; i < 9; i++) w[i] = Math.floor(key / POW3[i]) % 3;
    return classify(w);
  }

  function makeCache(board) {
    var C = {
      board: board, key: new Int32Array(2 * NCELL * 4), shp: new Int8Array(2 * NCELL * 4), flag: new Uint8Array(2 * NCELL),
      occ: new Uint8Array(NCELL), stones: 0, setList: [], setPos: [], setN: new Int32Array(4),
      mark: new Int32Array(NCELL), gen: 0, pend: new Int32Array(PEND_MAX), np: 0
    };
    var x, p, d, k;
    for (var i = 0; i < 4; i++) { C.setList.push(new Int16Array(NCELL)); C.setPos.push(new Int16Array(NCELL).fill(-1)); }
    for (x = 0; x < NCELL; x++) {
      C.occ[x] = board[(x / SIZE) | 0][x % SIZE];
      if (C.occ[x]) C.stones++;
    }
    for (p = 1; p <= 2; p++) {
      for (x = 0; x < NCELL; x++) {
        var r = (x / SIZE) | 0, c = x % SIZE;
        for (d = 0; d < 4; d++) {
          var dr = DIRS[d][0], dc = DIRS[d][1], key = POW3[4];
          for (k = 1; k <= 4; k++) {
            key += cellValue(board, r + dr * k, c + dc * k, p) * POW3[4 + k];
            key += cellValue(board, r - dr * k, c - dc * k, p) * POW3[4 - k];
          }
          var j = ((p - 1) * NCELL + x) * 4 + d;
          C.key[j] = key;
          C.shp[j] = shapeOfKey(key);
        }
      }
    }
    for (x = 0; x < NCELL; x++) if (!C.occ[x]) { refreshFlag(C, 0, x); refreshFlag(C, 1, x); }
    return C;
  }

  function setTo(C, id, x, on) {
    var pos = C.setPos[id], at = pos[x];
    if (on) {
      if (at < 0) { var n = C.setN[id]++; pos[x] = n; C.setList[id][n] = x; }
    } else if (at >= 0) {
      var list = C.setList[id], last = list[--C.setN[id]];
      list[at] = last; pos[last] = at; pos[x] = -1;
    }
  }

  // 空點 x、玩家 pi＋1：由四個方向的 shp 重算 flag，flag 變了才動集合。
  // 不變式：空點的集合成員照 flag；有子的格 flag＝0、不在任何集合（cachePut 清掉）。
  function refreshFlag(C, pi, x) {
    var b = (pi * NCELL + x) * 4, shp = C.shp, f = 0, l2 = 0, fi = pi * NCELL + x;
    for (var d = 0; d < 4; d++) {
      var s = shp[b + d];
      if (s === FIVE) f |= 1;
      else if (s >= RUSH4) f |= 2;
      else if (s === LIVE3) f |= 4;
      else if (s === LIVE2) l2++;
    }
    if (l2 >= 2) f |= 8;
    var old = C.flag[fi];
    if (f === old) return;
    C.flag[fi] = f;
    if (((f ^ old) & 3) !== 0 && ((f & 3) === 0 || (old & 3) === 0)) setTo(C, pi * 2, x, (f & 3) !== 0);
    if (((f ^ old) & 12) !== 0 && ((f & 12) === 0 || (old & 12) === 0)) setTo(C, pi * 2 + 1, x, (f & 12) !== 0);
  }

  // 空點 x 下 q。型態沒變的格不必重算 flag。
  function cachePut(C, x, q) {
    var key = C.key, shp = C.shp, occ = C.occ, flag = C.flag, U = UPD[x], a1 = q === 1 ? 1 : 2, a2 = 3 - a1;
    var k, t, s1, s2, y, half = NCELL * 4;
    occ[x] = q; C.stones++;
    if (flag[x] & 3) setTo(C, 0, x, false);
    if (flag[x] & 12) setTo(C, 1, x, false);
    if (flag[NCELL + x] & 3) setTo(C, 2, x, false);
    if (flag[NCELL + x] & 12) setTo(C, 3, x, false);
    flag[x] = 0; flag[NCELL + x] = 0;
    for (var j = 0; j < U.length; j += 2) {
      s1 = U[j]; s2 = s1 + half; y = s1 >> 2;
      k = key[s1] += U[j + 1] * a1;
      t = shapeTable[k]; if (t < 0) t = shapeOfKey(k);
      if (t !== shp[s1]) { shp[s1] = t; if (!occ[y]) refreshFlag(C, 0, y); }
      k = key[s2] += U[j + 1] * a2;
      t = shapeTable[k]; if (t < 0) t = shapeOfKey(k);
      if (t !== shp[s2]) { shp[s2] = t; if (!occ[y]) refreshFlag(C, 1, y); }
    }
  }

  // x 上的 q 拿掉
  function cacheTake(C, x, q) {
    var key = C.key, shp = C.shp, occ = C.occ, U = UPD[x], a1 = q === 1 ? 1 : 2, a2 = 3 - a1;
    var k, t, s1, s2, y, half = NCELL * 4;
    occ[x] = 0; C.stones--;
    for (var j = 0; j < U.length; j += 2) {
      s1 = U[j]; s2 = s1 + half; y = s1 >> 2;
      k = key[s1] -= U[j + 1] * a1;
      t = shapeTable[k]; if (t < 0) t = shapeOfKey(k);
      if (t !== shp[s1]) { shp[s1] = t; if (!occ[y]) refreshFlag(C, 0, y); }
      k = key[s2] -= U[j + 1] * a2;
      t = shapeTable[k]; if (t < 0) t = shapeOfKey(k);
      if (t !== shp[s2]) { shp[s2] = t; if (!occ[y]) refreshFlag(C, 1, y); }
    }
    refreshFlag(C, 0, x); refreshFlag(C, 1, x);
  }

  // 寫棋盤一律經過這兩個（掛了快取的棋盤順便記下）；place／unplace 也用。
  // 快取晚一步更新：落子／提子先記在 pend（x×4＋子，提子再加 2×NCELL×4），下一次讀快取（cacheOf）才照順序套用；
  // 下了又提、中間沒讀快取的（例如 vcf 裡沖四之後對手沒有成五點就退回）直接互相抵掉，不必更新。
  var PEND_MAX = 1024;
  function setStone(board, r, c, p) {
    board[r][c] = p;
    var C = SC;
    if (C !== null && C.board === board) {
      if (C.np === PEND_MAX) cacheFlush(C);
      C.pend[C.np++] = (r * SIZE + c) * 4 + p;
    }
  }

  function clearStone(board, r, c) {
    var q = board[r][c], C = SC;
    board[r][c] = 0;
    if (q && C !== null && C.board === board) {
      var e = (r * SIZE + c) * 4 + q;
      if (C.np > 0 && C.pend[C.np - 1] === e) C.np--;
      else {
        if (C.np === PEND_MAX) cacheFlush(C);
        C.pend[C.np++] = e + NCELL * 8;
      }
    }
  }

  function cacheFlush(C) {
    var pend = C.pend, n = C.np;
    C.np = 0;
    for (var i = 0; i < n; i++) {
      var e = pend[i];
      if (e >= NCELL * 8) { e -= NCELL * 8; cacheTake(C, e >> 2, e & 3); }
      else cachePut(C, e >> 2, e & 3);
    }
  }

  // 這個棋盤掛著快取就回傳快取（先套用還沒套的落子／提子），否則 null（空盤也回 null：candidates 的「全部空點」退路走原本的程式）
  function cacheOf(board) {
    var C = SC;
    if (C === null || C.board !== board) return null;
    if (C.np > 0) cacheFlush(C);
    if (C.stones === 0) return null;
    if (cacheCheck) cacheVerify(C);
    return C;
  }

  // 只問一點的函式（pointScore、isW4Move、is43Point）用：快取是乾淨的（沒有待套用的落子）才用，否則回 null、照原本直接讀棋盤
  // （算一點只要讀 32 格，比先套用一手的更新便宜；例如 defenseSet 每個防點下了只問一兩點就提掉）。結果兩條路相同。
  function cachePeek(board) {
    var C = SC;
    if (C === null || C.board !== board || C.np > 0) return null;
    return cacheOf(board);
  }

  // 除錯：整份快取和整盤重算逐項比對
  function cacheVerify(C) {
    var F = makeCache(C.board), i, x, pi;
    cacheChecks++;
    function bad(what) { throw new Error('型態快取不一致：' + what); }
    if (F.stones !== C.stones) bad('stones ' + C.stones + '≠' + F.stones);
    for (x = 0; x < NCELL; x++) if (F.occ[x] !== C.occ[x]) bad('occ #' + x);
    for (i = 0; i < F.key.length; i++) {
      if (F.key[i] !== C.key[i]) bad('key #' + i);
      if (F.shp[i] !== C.shp[i]) bad('shp #' + i);
    }
    for (pi = 0; pi < 2; pi++) {
      for (x = 0; x < NCELL; x++) {
        for (var id = pi * 2; id < pi * 2 + 2; id++) {
          var inC = C.setPos[id][x] >= 0;
          if (inC && C.setList[id][C.setPos[id][x]] !== x) bad('set ' + id + ' pos #' + x);
          if (inC !== (F.setPos[id][x] >= 0)) bad('set ' + id + ' #' + x);
        }
        if ((C.occ[x] ? 0 : F.flag[pi * NCELL + x]) !== C.flag[pi * NCELL + x]) bad('flag ' + pi + ' #' + x);
      }
    }
    for (i = 0; i < 4; i++) if (F.setN[i] !== C.setN[i]) bad('setN ' + i);
  }

  // 除錯：用原本的程式（不讀快取）再算一次
  function fullOf(fn) {
    var saved = SC, args = Array.prototype.slice.call(arguments, 1);
    SC = null;
    try { return fn.apply(null, args); } finally { SC = saved; }
  }

  function checkSame(name, a, b) {
    var sa = JSON.stringify(a), sb = JSON.stringify(b);
    cacheChecks++;
    if (sa !== sb) throw new Error('型態快取不一致：' + name + '\n快取 ' + sa + '\n重算 ' + sb);
  }

  // candidates 的快取版：同一個演算法（同一個順序），棋盤改讀 occ、鄰格查表、標記用世代號不必每次清空
  function candidatesC(C) {
    var occ = C.occ, mk = C.mark, list = [];
    if (++C.gen > 2000000000) { mk.fill(0); C.gen = 1; }
    var g = C.gen;
    for (var s = 0; s < NCELL; s++) {
      if (!occ[s]) continue;
      var nb = NBR25[s];
      for (var j = 0; j < nb.length; j++) {
        var x = nb[j];
        if (occ[x] || mk[x] === g) continue;
        mk[x] = g;
        list.push(x);
      }
    }
    return list;
  }

  // 集合 ids 裡的空點（去重），只留候選點，照 candidates 的順序排好。
  // candidates 的順序：空點 x 由「5×5 內列優先第一顆子 s」加入，序號是 x 在 s 的鄰格裡的序號；所以 (s, 序號) 就是 x 在清單裡的先後。
  var IDS_A = [[0], [2]], IDS_AB = [[0, 1], [2, 3]], IDS_ALL = [0, 1, 2, 3];
  function gatherC(C, ids) {
    var occ = C.occ, mk = C.mark, out = [], i, j, n;
    if (++C.gen > 2000000000) { mk.fill(0); C.gen = 1; }
    var g = C.gen;
    for (var t = 0; t < ids.length; t++) {
      var list = C.setList[ids[t]];
      for (i = 0, n = C.setN[ids[t]]; i < n; i++) {
        var x = list[i];
        if (mk[x] === g) continue;
        mk[x] = g;
        var W = WIN25[x], ord = -1;
        for (j = 0; j < W.length; j += 2) if (occ[W[j]]) { ord = W[j] * 25 + W[j + 1]; break; }
        if (ord >= 0) out.push(ord * NCELL + x);
      }
    }
    for (i = 1; i < out.length; i++) {         // 插入排序（通常只有幾個到二三十個）
      var v = out[i];
      for (j = i - 1; j >= 0 && out[j] > v; j--) out[j + 1] = out[j];
      out[j + 1] = v;
    }
    for (i = 0; i < out.length; i++) out[i] %= NCELL;
    return out;
  }

  var DEF = 0.9; // 防守價值係數（略小於 1）

  // 連珠規則：黑棋的禁手點從黑棋候選中剔除；白棋評分時，黑棋下不了的點不必防（防守分與型態歸零）。
  // 因此黑棋的「長連點」不算成五點，成四點是禁手的活三也不會觸發必擋活三。
  function analyze(board, p, rule) {
    var C = cacheOf(board), out = analyzeImpl(board, p, rule, C);
    if (C !== null && cacheCheck) checkSame('analyze', out, fullOf(analyzeImpl, board, p, rule, null));
    return out;
  }

  // C：快取（null＝原本的整盤重算）
  function analyzeImpl(board, p, rule, C) {
    var o = 3 - p, idxs = C ? candidatesC(C) : candidates(board), out = [], renju = rule === 'renju';
    for (var i = 0; i < idxs.length; i++) {
      var r = (idxs[i] / SIZE) | 0, c = idxs[i] % SIZE;
      var a = C ? pointScoreC(C, idxs[i], p) : pointScore(board, r, c, p), am = lastMax, ah = lastHot;
      var d = C ? pointScoreC(C, idxs[i], o) : pointScore(board, r, c, o), dm = lastMax, dh = lastHot;
      if (renju && (p === 1 ? ah : dh) && isForbidden(board, r, c)) {
        if (p === 1) continue;
        d = 0; dm = NONE;
      }
      out.push({ r: r, c: c, att: a, def: d, myMax: am, oppMax: dm, score: a + DEF * d });
    }
    return out;
  }

  // 連珠規則下黑棋候選點全是禁手時的退路：全盤非禁手空點。
  function legalFallback(board) {
    var out = [];
    for (var r = 0; r < SIZE; r++)
      for (var c = 0; c < SIZE; c++)
        if (!board[r][c] && !isForbidden(board, r, c))
          out.push({ r: r, c: c, att: 0, def: 0, myMax: NONE, oppMax: NONE, score: 0 });
    return out;
  }

  // 硬規則：1 自己能成五一定下；2 對手能成五一定擋；
  // 3（useRule3）對手有活三、自己沒有任何成四以上的點 → 只能下在「對手下了會成活四」的點。
  // 第十九批（judge F5）：「自己有沒有四」照規則算。連珠黑棋的形狀沖四可能是假的（`XXX__X` 補上去成六連），
  // 這時改用 fourMoves（非禁手、下了真的有成五點）；其他情況形狀就是規則，照舊用 myMax。
  // 第二十批 a（judge 第十輪 F5）：對稱的另一側——連珠白棋要擋的是黑棋照規則的 W4 點（threatPoints），
  // 不看形狀的活四：`O_XXX__X` 這種「假活三」補上去一邊成長連，黑棋其實沒有擋不完的四。
  function forcedMoves(list, useRule3, board, p, rule) {
    var i, out = [];
    for (i = 0; i < list.length; i++) if (list[i].myMax === FIVE) out.push(list[i]);
    if (out.length) return out;
    for (i = 0; i < list.length; i++) if (list[i].oppMax === FIVE) out.push(list[i]);
    if (out.length) return out;
    if (useRule3) {
      if (board && rule === 'renju' && p === 1) { if (fourMoves(board, p, rule).length) return null; }
      else for (i = 0; i < list.length; i++) if (list[i].myMax >= RUSH4) return null;
      if (board && rule === 'renju' && p === 2) {
        var real = {}, w4 = threatPoints(board, 1, rule);
        for (i = 0; i < w4.length; i++) real[w4[i].r * SIZE + w4[i].c] = 1;
        for (i = 0; i < list.length; i++) if (real[list[i].r * SIZE + list[i].c]) out.push(list[i]);
      } else for (i = 0; i < list.length; i++) if (list[i].oppMax === LIVE4) out.push(list[i]);
      if (out.length) return out;
    }
    return null;
  }

  function randomPick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function byScoreDesc(a, b) { return b.score - a.score; }

  // 評分前 n 名（同分者順序隨機）
  function topN(list, n) {
    return shuffle(list.slice()).sort(byScoreDesc).slice(0, n);
  }

  // ---------------------------------------------------------------- easy

  // 簡單評分：四個方向上，緊鄰這一點的自己連子數＋對手連子數。
  function easyScore(board, r, c, p) {
    var s = 0;
    for (var d = 0; d < 4; d++) {
      var dr = DIRS[d][0], dc = DIRS[d][1];
      for (var who = 1; who <= 2; who++) {
        var k = 1;
        while (inside(r + dr * k, c + dc * k) && board[r + dr * k][c + dc * k] === who) { s++; k++; }
        k = 1;
        while (inside(r - dr * k, c - dc * k) && board[r - dr * k][c - dc * k] === who) { s++; k++; }
      }
    }
    return s;
  }

  // trace（測試與互搏用，可省略）：記下這一手是怎麼決定的
  function note(trace, why) { if (trace) trace.reason = why; }

  // 階 1（入門）。硬規則一、二（能成五就下、必擋五）一定遵守；其餘在緊鄰數前 5 名隨機。
  // 第二十三批（規格 AB）：入門完全不動（原本的 block3 擲骰在階 1 是 0、不擲，拿掉後亂數序列與著法相同）。
  function easyMove(board, p, list, trace) {
    var forced = forcedMoves(list, false);
    if (forced) { note(trace, 'forced'); return randomPick(forced); }
    note(trace, 'random');
    var scored = [];
    for (var i = 0; i < list.length; i++) {
      scored.push({ r: list[i].r, c: list[i].c, score: easyScore(board, list[i].r, list[i].c, p) });
    }
    shuffle(scored);
    scored.sort(byScoreDesc); // 穩定排序：同分者保留洗牌後的隨機順序
    return randomPick(scored.slice(0, 5));
  }

  // ---------------------------------------------------------------- 難度 v3 的規則與誤差（第二十三批，規格 AB）

  // 標準常態亂數（Box–Muller）。用 Math.random（selfplay.js 給了種子就會接管），每次用兩個均勻亂數、回傳一個值。
  function gauss() {
    var u = 1 - Math.random(), v = Math.random(); // u ∈ (0, 1]，log 不會是 -Infinity
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // items 裡挑 valueOf(x) + σ×N(0,1) 最高的。勝負已定的值（|v| ≥ WIN/2）不加誤差（誤差不會讓它放掉已算到的勝、
  // 或走進已算到的敗）。σ ≤ 0 時不擲骰：取最高、同分隨機。
  function noisyBest(items, valueOf, sigma) {
    var i, v, best = null, bv = -Infinity;
    if (!(sigma > 0)) {
      var ties = [];
      for (i = 0; i < items.length; i++) {
        v = valueOf(items[i]);
        if (v > bv) { bv = v; ties = [items[i]]; } else if (v === bv) ties.push(items[i]);
      }
      return ties.length ? randomPick(ties) : items[0];
    }
    for (i = 0; i < items.length; i++) {
      v = valueOf(items[i]);
      if (Math.abs(v) < WIN / 2) v += sigma * gauss();
      if (best === null || v > bv) { best = items[i]; bv = v; }
    }
    return best;
  }

  function scoreOf(x) { return x.score; }

  // 弱與中共用的規則（第二十三批，規格 AB；強與最強不用）：成五 → 擋五 → 一步 W4 → 對手有 W4 點時限定候選。
  // 回傳 { m }（一步 W4，直接下）、{ set, hard12 }（只能在 set 裡挑），或 null（規則沒決定）。
  // 第 4 條（judge v3 F1，主線拍板）：對手照規則有 W4 點（threatPoints：活三、跳三、雙四點、連珠白沖四逼黑擋禁手點…）時，
  // 只能下在「防點 ∪ 自己的成四點」：防點＝候選裡下了之後對手**一個 W4 點都沒有**的點（整盤重算 threatPoints，
  // 所以連珠黑棋「擋了之後白另一個沖四的成五點變黑禁手」那種點不算防點）；自己的成四點照規則（fourMoves）。
  // 黑白、自由連珠同一套；集合只有一點也照這個集合。修之前用 forcedMoves 的硬規則 3（只收形狀上的活四點，
  // 自己有四時不成立），連珠黑棋會漏掉不是活四形的 W4、也會把假防點當擋點。集合是空的（擋不完、也沒有四，已經輸了）就退回中檔原本的硬規則 3（擋其中一個形狀活四點），那也沒有才當規則沒決定。
  // trace 記 'w4'、'forced'（成五／擋五）、'block3'（第 4 條）。
  function ruleMoves(board, p, list, rule, trace) {
    var f5 = forcedMoves(list, false);
    if (f5) { note(trace, 'forced'); return { set: f5, hard12: true }; }
    var w4 = threatPoints(board, p, rule);
    if (w4.length) { note(trace, 'w4'); return { m: pickW4(board, p, w4, list, true) }; }
    var o = 3 - p;
    if (!threatPoints(board, o, rule).length) return null;
    var mine = fourMoves(board, p, rule), isMine = {}, set = [], i, e, ok;
    for (i = 0; i < mine.length; i++) isMine[mine[i].r * SIZE + mine[i].c] = 1;
    for (i = 0; i < list.length; i++) {
      e = list[i];
      if (isMine[e.r * SIZE + e.c]) { set.push(e); continue; }
      setStone(board, e.r, e.c, p); // 天元步驟 2：寫完要讀型態，經過快取
      try { ok = !threatPoints(board, o, rule).length; } finally { clearStone(board, e.r, e.c); }
      if (ok) set.push(e);
    }
    if (!set.length) {
      // 擋不完（例如兩個分開的活三）也沒有四：已經輸了，退回中檔原本的硬規則 3（只擋形狀上的活四點，至少擋掉一個）
      set = forcedMoves(list, true, board, p, rule);
      if (!set) return null;
    }
    note(trace, 'block3');
    return { set: set, hard12: false };
  }

  // 階 2–4（弱）。規則（ruleMoves）一定照做；規則給了一組點就在那組裡挑，沒決定就在全部候選裡挑：
  // 點評分（攻＋守，analyze 的 score）加誤差 σ×N(0,1)，取最高。沒被規則決定的那一手 trace 記 'noise'。
  function weakMove(board, p, list, rule, sigma, trace) {
    var rm = ruleMoves(board, p, list, rule, trace);
    if (rm && rm.m) return rm.m;
    if (!rm) note(trace, 'noise');
    return noisyBest(rm ? rm.set : list, scoreOf, sigma);
  }

  // v0.5.13（規格 AF）：入門・2（內部階號 13，選單排在入門・1 與弱・1 之間，見 TIERS 與 TIER_ORDER）。
  // 會主動做活三，但看不懂對方的活三：硬規則只有入門・1 那兩條（能成五就下、對手能成五就擋；forcedMoves 不開規則 3），
  // 其餘在全部候選裡挑「自己的進攻分（analyze 的 att，含雙三、四三的交叉分）＋ defw ×（對手的形狀分，每個方向最多算到
  // DEF_CAP_N2＝活三的 3000）」加誤差 σ×N(0,1) 最高的（σ＝TIERS 的 noise、defw＜1，所以偏重自己的進攻）。
  // 防守分逐方向封頂、不加對手的交叉分：對方活三的擋點（對方下了成活四）在那個方向只算 3000，跟「對方的活二再一子成活三」的點一樣，
  // 所以分不出哪個是活三、不會刻意去擋（量到的擋三機率不高於入門・1 碰巧擋到的機率，見 test.js）。對方的四只靠「擋五」那一條。
  // 連珠黑棋的禁手點 analyze 已經剔除；連珠白棋時黑棋下不了的點 analyze 已把 def 歸零，這裡跟著不算防守分。
  // trace 記 'attack'（成五／擋五記 'forced'）。σ 與 defw 是校正值（README「階梯校正紀錄／v0.5.13」）。
  var DEF_CAP_N2 = SHAPE_SCORE[LIVE3];
  function cappedDef(board, r, c, o) {
    var s = 0;
    for (var d = 0; d < 4; d++) s += Math.min(SHAPE_SCORE[shapeAt(board, r, c, o, DIRS[d][0], DIRS[d][1])], DEF_CAP_N2);
    return s;
  }
  function novice2Move(board, p, list, rule, sigma, defw, trace) {
    var forced = forcedMoves(list, false);
    if (forced) { note(trace, 'forced'); return randomPick(forced); }
    note(trace, 'attack');
    var o = 3 - p;
    return noisyBest(list, function (e) {
      if (!(defw > 0) || (e.def === 0 && e.oppMax === NONE)) return e.att;
      return e.att + defw * cappedDef(board, e.r, e.c, o);
    }, sigma);
  }

  // ---------------------------------------------------------------- 各檔設定

  var WIN = 1e9;
  var TIMEOUT = { timeout: true };

  // 中：α-β 2 層（自己、對手）＋擋活三，葉節點用下面的靜態評分（不做威脅延伸）。
  var MEDIUM = { time: 1000, width: 10, depths: [2], qDepth: 0 };
  // 強：6 層迭代加深＋雙方 VCF＋自己 VCT 4／否決 VCT 5＋威脅延伸。
  var HARD = {
    time: 1500, width: 12, depths: [2, 4, 6], qDepth: 4,
    ownThreats: 4, vetoThreats: 5, vctNodes: 20000
  };
  // 最強：10 層迭代加深＋雙方 VCF＋自己 VCT 8／否決 VCT 8＋威脅延伸。
  // floor：先把強檔的整套流程原樣做完（保底），剩下的時間才加深；
  // skipGrowth：只用在加深那一段，預估搜不完的深度不開（見 strongMove、deepen）。
  var EXPERT = {
    time: 5000, width: 12, depths: [2, 4, 6, 8, 10], qDepth: 4,
    ownThreats: 8, vetoThreats: 8, vctNodes: 100000, floor: HARD, skipGrowth: 4
  };
  // 天元（階 12，規格 AC／AE，實作中）：最強的整套流程，每步 8 秒；第二段的 VCT 手數與節點預算用天元步驟 1 量測挑的
  // 10 手／30 萬（另量了 8／10 萬、12／30 萬：各深度完成率幾乎一樣，每步最長 7.7／7.9 秒，12 手離 8.1 秒上限太近；見 README「天元」）。
  // 自己一份參數物件，不動 EXPERT。
  var TENGEN = {
    time: 8000, width: 12, depths: [2, 4, 6, 8, 10], qDepth: 4,
    ownThreats: 10, vetoThreats: 10, vctNodes: 300000, floor: HARD, skipGrowth: 4
  };
  // 第六批實驗：否決關卡多看一手安靜棋（見 quietCheck）。實驗沒過留的判準（書譜機器人對強・2 從 10 勝降到 9 勝），
  // 所以 TIERS 目前沒有一階開 quiet；程式留著，selfplay.js 可用參數覆寫 10:quiet=1 打開，數字見 README「第六批實驗」。
  // k：對手評分前幾名的安靜棋；threats：之後的 VCT 手數；
  // replies：每個安靜棋最多試幾個己方應手（10 個時強・2 在書譜 2 那一手的檢查 1500 ms 內做不完，改 6）。只用在 TIERS 標 quiet 的階。
  var QUIET = { k: 6, threats: 5, replies: 6 };

  // ---------------------------------------------------------------- 威脅辨識（VCT、威脅延伸、靜態分類共用）
  //
  // 「W4 點」：p 下了之後擋不完的點——成五點 ≥ 2（活四、雙四），
  // 或連珠白棋只有一個成五點、而那一點是黑棋禁手（黑棋擋不了）。
  // 連珠黑棋：禁手點不是 W4 點；長連不算五。

  function isW4Move(board, r, c, p, rule) {
    var C = cachePeek(board), v = isW4MoveImpl(board, r, c, p, rule, C);
    if (C !== null && cacheCheck) checkSame('isW4Move', v, fullOf(isW4MoveImpl, board, r, c, p, rule, null));
    return v;
  }

  function isW4MoveImpl(board, r, c, p, rule, C) {
    var l4 = 0, f4 = 0, renju = rule === 'renju', b = ((p - 1) * NCELL + r * SIZE + c) * 4;
    for (var d = 0; d < 4; d++) {
      var s = C ? C.shp[b + d] : shapeAt(board, r, c, p, DIRS[d][0], DIRS[d][1]);
      if (s === FIVE) { if (!renju || p === 2) return true; }
      else if (s === LIVE4) l4++;
      else if (s === RUSH4) f4++;
    }
    if (!renju) return l4 > 0 || f4 >= 2;
    if (!l4 && !f4) return false;
    if (p === 2 && (l4 || f4 >= 2)) return true;
    if (p === 1 && isForbidden(board, r, c)) return false;
    // 第二十批 a（judge 第十輪 F1）：白棋唯一成五點是不是禁手，要在白子還在 (r,c) 時判——白子和擋點同線，
    // 先拿掉再判，黑棋那條線可能多出活三而誤判成三三。
    board[r][c] = p;
    var fp = fivePointsNear(board, r, c, p, rule);
    var w4 = fp.length >= 2 || (p === 2 && fp.length === 1 && !!isForbidden(board, fp[0].r, fp[0].c));
    board[r][c] = 0;
    return w4;
  }

  // p 目前全部的 W4 點（p 有活三／跳三時才會有）
  // 快取版只看 p 的集合 A（isW4Move 成立一定要有成五形或沖四／活四形）
  function threatPoints(board, p, rule) {
    var C = cacheOf(board), out = threatPointsImpl(board, p, rule, C);
    if (C !== null && cacheCheck) checkSame('threatPoints', out, fullOf(threatPointsImpl, board, p, rule, null));
    return out;
  }

  function threatPointsImpl(board, p, rule, C) {
    var idxs = C ? gatherC(C, IDS_A[p - 1]) : candidates(board), out = [];
    for (var i = 0; i < idxs.length; i++) {
      var r = (idxs[i] / SIZE) | 0, c = idxs[i] % SIZE;
      if (C ? isW4MoveImpl(board, r, c, p, rule, C) : isW4Move(board, r, c, p, rule)) out.push({ r: r, c: c });
    }
    return out;
  }

  // 攻方 att 有 W4 點 w4 時，守方的全部防點：守方下了之後，w4 裡每一點都不再是 W4 點。
  // 一個防點一定要破掉 w4[0]，所以只需試 w4[0] 本身與它四條線上前後 4 格。
  // 連珠黑棋守方不試禁手點。
  function defenseSet(ctx, board, att, w4) {
    var def = 3 - att, rule = ctx.rule, w = w4[0], out = [], seen = {};
    var cells = [[w.r, w.c]];
    for (var d = 0; d < 4; d++)
      for (var k = -4; k <= 4; k++)
        if (k) cells.push([w.r + DIRS[d][0] * k, w.c + DIRS[d][1] * k]);
    for (var i = 0; i < cells.length; i++) {
      var qr = cells[i][0], qc = cells[i][1], key = qr * SIZE + qc;
      if (!inside(qr, qc) || board[qr][qc] || seen[key]) continue;
      seen[key] = 1;
      if (rule === 'renju' && def === 1 && isForbidden(board, qr, qc)) continue;
      var ok = true;
      place(ctx, board, qr, qc, def);
      try {
        for (var j = 0; j < w4.length && ok; j++) {
          var x = w4[j];
          if (!board[x.r][x.c] && isW4Move(board, x.r, x.c, att, rule)) ok = false;
        }
      } finally { unplace(ctx, board, qr, qc, def); }
      if (ok) out.push({ r: qr, c: qc });
    }
    return out;
  }

  // ---------------------------------------------------------------- 靜態評分（中、強、最強共用）
  //
  // 輪到 p。先做盤面分類（Wine 2.6 的五條，輪走方視角）：
  //   自己有四（成五點）→ WIN；對手兩個以上的四 → 輸；對手一個四 → 擋了再遞迴；
  //   自己有 W3 點（活四／雙四點、四三點；雙三點只在對手沒有活三時）→ WIN − k；
  //   其餘才用 evaluateLines（以線為單位）＋交叉型（四三、雙三、雙活二）分數。
  // 對手的活三在輪自己走時只算中等威脅分（見 evaluateLines 的 OPP_LIVE3）。

  var W3_VALUE = [0, WIN - 3000, WIN - 2000, WIN - 1000]; // 雙三、四三、活四／雙四點
  var CROSS_OPP43 = 8000, CROSS_OPP33 = 5000, CROSS_22 = 400;
  var BLOCK_CAP = 8; // 「對手一個四 → 擋」最多連續遞迴幾次

  // 第十九批（judge F6）：連珠黑棋在 (r,c) 有形狀上的活四／沖四時，照規則重算等級（3 活四／雙四、2 四三、1 雙三、0）：
  // 形狀的四可能是假的（補上去成長連），所以實際下下去數成五點（恰好五）。禁手點由呼叫端另外歸零。
  // l3：形狀上的活三方向數（沿用，不另驗）。
  function blackFourClass(board, r, c, rule, l3) {
    board[r][c] = 1;
    var n = fivePointsNear(board, r, c, 1, rule).length;
    board[r][c] = 0;
    return n >= 2 ? 3 : (n === 1 && l3) ? 2 : (l3 >= 2) ? 1 : 0;
  }

  // 快取版只看雙方集合 A、B 裡的點：p 或 o 在某點有任何輸出（成五、t／ot > 0、雙活二）都要那一方 flag 不是 0
  function scanThreats(board, p, rule) {
    var C = cacheOf(board), res = scanThreatsImpl(board, p, rule, C);
    if (C !== null && cacheCheck) checkSame('scanThreats', res, fullOf(scanThreatsImpl, board, p, rule, null));
    return res;
  }

  function scanThreatsImpl(board, p, rule, C) {
    var o = 3 - p, idxs = C ? gatherC(C, IDS_ALL) : candidates(board), renju = rule === 'renju';
    var res = { pFive: false, oFive: [], pW3: 0, oW4: [], p22: 0, o43: 0, o33: 0, o22: 0 };
    var bp = (p - 1) * NCELL * 4, bo = (o - 1) * NCELL * 4, shp = C ? C.shp : null;
    for (var i = 0; i < idxs.length; i++) {
      var r = (idxs[i] / SIZE) | 0, c = idxs[i] % SIZE, d, s;
      // 輪走方 p
      var five = false, l4 = 0, f4 = 0, l3 = 0, l2 = 0;
      for (d = 0; d < 4; d++) {
        s = shp ? shp[bp + idxs[i] * 4 + d] : shapeAt(board, r, c, p, DIRS[d][0], DIRS[d][1]);
        if (s === FIVE) five = true;
        else if (s === LIVE4) l4++;
        else if (s === RUSH4) f4++;
        else if (s === LIVE3) l3++;
        else if (s === LIVE2) l2++;
      }
      if (five && (!(renju && p === 1) || isFivePoint(board, r, c, 1, rule))) { res.pFive = true; return res; }
      var t = (renju && p === 1 && (l4 || f4)) ? blackFourClass(board, r, c, rule, l3)
        : (l4 || f4 >= 2) ? 3 : (f4 && l3) ? 2 : (l3 >= 2) ? 1 : 0;
      if (t && renju && p === 1 && isForbidden(board, r, c)) t = 0;
      if (t > res.pW3) res.pW3 = t;
      if (!t && l2 >= 2) res.p22++;
      // 對手 o
      five = false; l4 = f4 = l3 = l2 = 0;
      for (d = 0; d < 4; d++) {
        s = shp ? shp[bo + idxs[i] * 4 + d] : shapeAt(board, r, c, o, DIRS[d][0], DIRS[d][1]);
        if (s === FIVE) five = true;
        else if (s === LIVE4) l4++;
        else if (s === RUSH4) f4++;
        else if (s === LIVE3) l3++;
        else if (s === LIVE2) l2++;
      }
      if (five) {
        if (!(renju && o === 1) || isFivePoint(board, r, c, 1, rule)) res.oFive.push({ r: r, c: c });
        continue;
      }
      var ot = (renju && o === 1 && (l4 || f4)) ? blackFourClass(board, r, c, rule, l3)
        : (l4 || f4 >= 2) ? 3 : (f4 && l3) ? 2 : (l3 >= 2) ? 1 : 0;
      if (ot && renju && o === 1 && isForbidden(board, r, c)) ot = 0;
      if (ot === 3) res.oW4.push({ r: r, c: c });
      else if (ot === 2) res.o43++;
      else if (ot === 1) res.o33++;
      else if (l2 >= 2) res.o22++;
    }
    return res;
  }

  function staticValue(board, p, s) {
    var v = evaluateLines(board, p);
    if (v >= WIN / 2 || v <= -WIN / 2) return v;
    v += CROSS_22 * (Math.min(s.p22, 3) - DEF * Math.min(s.o22, 3));
    v -= DEF * (CROSS_OPP43 * Math.min(s.o43, 2) + CROSS_OPP33 * Math.min(s.o33, 2));
    return v;
  }

  // 葉節點（含威脅延伸）。q：剩下幾層威脅延伸；只走強制著——
  // 對手一個四 → 擋；對手有活三／跳三（W4 點）→ 全部防點＋自己的沖四。q 用完就靜態評分。
  function leaf(ctx, board, p, alpha, beta, q) {
    if ((++ctx.nodes & 255) === 0 && now(ctx.cw.leaf) > ctx.deadline) throw TIMEOUT;
    var o = 3 - p, rule = ctx.rule, s = scanThreats(board, p, rule), i;
    if (s.pFive) return WIN;
    if (s.oFive.length >= 2) return -(WIN - 1);
    if (s.oFive.length === 1) {
      var f = s.oFive[0];
      if (rule === 'renju' && p === 1 && isForbidden(board, f.r, f.c)) return -(WIN - 1);
      if (q <= -BLOCK_CAP) return staticValue(board, p, s);
      place(ctx, board, f.r, f.c, p);
      try { return -leaf(ctx, board, o, -beta, -alpha, q - 1); }
      finally { unplace(ctx, board, f.r, f.c, p); }
    }
    if (s.pW3 >= 2 || (s.pW3 === 1 && !s.oW4.length)) return W3_VALUE[s.pW3];
    if (q > 0 && s.oW4.length) {
      var moves = defenseSet(ctx, board, o, s.oW4), fm = fourMoves(board, p, rule);
      for (i = 0; i < fm.length; i++) {
        var dup = false;
        for (var j = 0; j < moves.length; j++) if (moves[j].r === fm[i].r && moves[j].c === fm[i].c) { dup = true; break; }
        if (!dup) moves.push(fm[i]);
      }
      if (!moves.length) return -(WIN - 1000); // 擋不了對手的活三，也沒有四可以反擊
      var best = -Infinity;
      for (i = 0; i < moves.length; i++) {
        var m = moves[i], v;
        place(ctx, board, m.r, m.c, p);
        try { v = -leaf(ctx, board, o, -beta, -alpha, q - 1); }
        finally { unplace(ctx, board, m.r, m.c, p); }
        if (v > best) best = v;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    }
    // 延伸用完：對手的活三（可能不只一個）若沒有共同防點，當成輸（有沖四可拖延的算輕一點）。
    if (s.oW4.length && !defenseSet(ctx, board, o, s.oW4).length)
      return fourMoves(board, p, rule).length ? -W3_VALUE[1] : -W3_VALUE[3];
    return staticValue(board, p, s);
  }

  // ---------------------------------------------------------------- medium

  // α-β 2 層（自己、對手）；硬規則同強檔（能成五就下、必擋五、對手活三且自己無四就擋）。同分隨機。
  // 第十九批（規格 X、主線拍板 R3 乙）：硬規則一、二之後多一條同級的——一步做得出擋不完的四（活四、雙四、
  // 連珠白棋逼黑擋在禁手點；照規則判）就直接下（trace 記 w4）。規則抽成 ruleMoves，弱段共用。
  // 第二十三批（規格 AB）：「手滑」拿掉，改成 sigma > 0（階 5–7）時根節點每個候選都用寬窗口搜出精確值，
  // 加誤差 σ×N(0,1) 取最高（trace 記 noise；規則給了擋點時只在擋點裡挑，記 forced／block3）。
  // sigma 0（階 8）走原本的迭代加深、同分隨機，著法與亂數用量和改之前完全相同。
  function mediumMove(board, p, list, rule, sigma, trace) {
    var rm = ruleMoves(board, p, list, rule, trace);
    if (rm && rm.m) return rm.m;
    var forced = rm ? rm.set : null;
    if (!rm) note(trace, sigma > 0 ? 'noise' : 'search');
    if (forced && (forced.length === 1 || forced[0].myMax === FIVE)) return forced[0];
    var roots = topN(forced || list, MEDIUM.width);
    var ctx = newCtx(board, rule, now(clockW(rule).search) + MEDIUM.time, MEDIUM.width, false);
    ctx.qDepth = MEDIUM.qDepth;
    if (sigma > 0) return noisyRoot(ctx, board, roots, p, sigma);
    var res = deepen(ctx, board, roots, MEDIUM.depths, p);
    var ties = [];
    for (var i = 0; i < res.length; i++) if (res[i].v === res[0].v) ties.push(res[i].m);
    return randomPick(ties);
  }

  // 中檔加誤差（sigma > 0）：searchRoot 只保證最佳者的值精確（其餘是上界），加誤差要比的是真值，
  // 所以每個候選都用寬窗口（alpha = -Infinity）搜到中檔的深度。逾時就只比已搜完的；一個都沒搜完就下第一個候選。
  function noisyRoot(ctx, board, roots, p, sigma) {
    var depth = MEDIUM.depths[MEDIUM.depths.length - 1], vals = [];
    try {
      for (var i = 0; i < roots.length; i++) vals.push({ m: roots[i], v: rootValue(ctx, board, roots[i], depth, p, -Infinity) });
    } catch (e) {
      if (e !== TIMEOUT) throw e;
    }
    if (!vals.length) return roots[0];
    return noisyBest(vals, function (x) { return x.v; }, sigma).m;
  }

  // ---------------------------------------------------------------- 雜湊（zobrist）

  // 第十三批（judge 第六輪）：多一組 ZOB3（h3），只給嚴格驗證器的置換表當校驗用（見 ttCheck）
  var ZOB1 = new Int32Array(2 * SIZE * SIZE), ZOB2 = new Int32Array(2 * SIZE * SIZE), ZOB3 = new Int32Array(2 * SIZE * SIZE);
  for (var zi = 0; zi < ZOB1.length; zi++) {
    ZOB1[zi] = (Math.random() * 4294967296) | 0;
    ZOB2[zi] = (Math.random() * 4294967296) | 0;
    ZOB3[zi] = (Math.random() * 4294967296) | 0;
  }
  var SIDE1 = (Math.random() * 4294967296) | 0, SIDE3 = (Math.random() * 4294967296) | 0;

  // 表上限（2026-10-02，README「天元／時鐘權重與表上限」）：遊戲內搜尋的四張表（α-β 置換表 ctx.tt、VCF 失敗表 ctx.vcfFail、
  // VCT 置換表 ctx.vtt[1]、ctx.vtt[2]）各自到上限筆數時，下一筆新的寫入前整張換成空表（同嚴格驗證器的 TT_MAX：表只是快取，
  // 清掉不改變結論，只是之後要重算）。沒有上限時節點時鐘的長步會長到幾百萬筆：Map 長到 2^k＋1 筆時整張重建，一次卡 36–444 ms，
  // 2^24 筆會丟 RangeError。上限照每筆的記憶體分開定（這台 node：失敗表每筆約 44 位元組、tt 約 100、vtt 約 116 以上）：
  // 失敗表 2^20（約 44 MB），tt、vtt 各 2^18（約 25–30 MB）；真時鐘下量到的最大值是失敗表約 50 萬、tt 約 10 萬、vtt 約 7 萬筆。
  // _internal.setTableCap(n)：四張表都改成 n（0＝不設上限，重現 2026-10-02 以前的記錄用；不給或 null＝還原預設）；capClears 數清過幾次（量測用）。
  var TABLE_CAP = { tt: 262144, vcfFail: 1048576, vtt: 262144 };
  var capTT = TABLE_CAP.tt, capFail = TABLE_CAP.vcfFail, capVtt = TABLE_CAP.vtt;
  var capClears = { tt: 0, vcfFail: 0, vtt1: 0, vtt2: 0 }, lastTables = null;
  function setTableCap(n) {
    if (n == null) { capTT = TABLE_CAP.tt; capFail = TABLE_CAP.vcfFail; capVtt = TABLE_CAP.vtt; return; }
    capTT = capFail = capVtt = n > 0 ? n : Infinity;
  }
  function vcfFailSet(ctx, key, plies) {
    if (ctx.vcfFail.size >= capFail) { ctx.vcfFail = new Map(); capClears.vcfFail++; }
    ctx.vcfFail.set(key, plies);
  }

  function newCtx(board, rule, deadline, width, useHash) {
    var ctx = {
      deadline: deadline, vcfDeadline: deadline, rule: rule, width: width, qDepth: 0,
      hash: !!useHash, h1: 0, h2: 0, h3: 0, tt: useHash ? new Map() : null, vcfFail: new Map(), nodes: 0,
      vtt: [null, new Map(), new Map()], vctNodes: 0, vctNodeLimit: 0, vctDeadline: 0, cw: clockW(rule),
      layers: [] // 規格 T1：deepen 每搜完一個深度記 { depth, m, gap }（最強檔兩段共用同一個 ctx），見 shouldStop
    };
    if (useHash) {
      for (var r = 0; r < SIZE; r++)
        for (var c = 0; c < SIZE; c++)
          if (board[r][c]) {
            var zi = (board[r][c] - 1) * SIZE * SIZE + r * SIZE + c;
            ctx.h1 ^= ZOB1[zi]; ctx.h2 ^= ZOB2[zi]; ctx.h3 ^= ZOB3[zi];
          }
    }
    return ctx;
  }

  function place(ctx, board, r, c, p) {
    setStone(board, r, c, p);
    if (ctx.hash) { var zi = (p - 1) * SIZE * SIZE + r * SIZE + c; ctx.h1 ^= ZOB1[zi]; ctx.h2 ^= ZOB2[zi]; ctx.h3 ^= ZOB3[zi]; }
  }

  function unplace(ctx, board, r, c, p) {
    clearStone(board, r, c);
    if (ctx.hash) { var zi = (p - 1) * SIZE * SIZE + r * SIZE + c; ctx.h1 ^= ZOB1[zi]; ctx.h2 ^= ZOB2[zi]; ctx.h3 ^= ZOB3[zi]; }
  }

  // 局面＋輪到誰 → 53 位元整數鍵
  function ttKey(ctx, p) {
    var a = (p === 2 ? (ctx.h1 ^ SIDE1) : ctx.h1) >>> 0;
    return a * 2097152 + ((ctx.h2 >>> 0) >>> 11);
  }

  // 第十三批（judge 第六輪）：ttKey 只有 53 位元（h1 全部＋h2 高 21 位）。嚴格驗證器的置換表另外把這個校驗值存進表項、取的時候比對，
  // 不一樣就當沒查到（鍵相撞不會拿到別的局面的結論）：h2 沒進鍵的低 11 位＋h3（第三組 zobrist，含輪誰走），合計鍵＋校驗 96 位元。
  // 43 位元的整數，double 表示得精確。遊戲內的搜尋（negamax、VCT、vcf、winWithin）沒有用它。
  function ttCheck(ctx, p) {
    var c = (p === 2 ? (ctx.h3 ^ SIDE3) : ctx.h3) >>> 0;
    return (ctx.h2 & 0x7FF) * 4294967296 + c;
  }

  // ---------------------------------------------------------------- 搜尋（hard 與 expert 共用）

  var TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;

  function negamax(ctx, board, depth, alpha, beta, p) {
    if (now(ctx.cw.negamax) > ctx.deadline) throw TIMEOUT;
    if (depth === 0) return leaf(ctx, board, p, alpha, beta, ctx.qDepth);
    var key = 0, ent = null, alpha0 = alpha, ttBest = -1;
    if (ctx.tt) {
      key = ttKey(ctx, p);
      ent = ctx.tt.get(key);
      if (ent) {
        if (ent.depth >= depth) {
          if (ent.flag === TT_EXACT) return ent.v;
          if (ent.flag === TT_LOWER && ent.v >= beta) return ent.v;
          if (ent.flag === TT_UPPER && ent.v <= alpha) return ent.v;
        }
        ttBest = ent.best;
      }
    }
    var list = analyze(board, p, ctx.rule);
    if (!list.length) return 0; // 下滿：和局
    var i, moves = [];
    for (i = 0; i < list.length; i++) if (list[i].myMax === FIVE) return WIN + depth;
    for (i = 0; i < list.length; i++) if (list[i].oppMax === FIVE) moves.push(list[i]);
    if (!moves.length) {
      list.sort(byScoreDesc);
      moves = list.slice(0, ctx.width);
    }
    if (ttBest >= 0) {
      for (i = 1; i < moves.length; i++) {
        if (moves[i].r * SIZE + moves[i].c === ttBest) { var t = moves[i]; moves.splice(i, 1); moves.unshift(t); break; }
      }
    }
    var best = -Infinity, bestIdx = -1;
    for (i = 0; i < moves.length; i++) {
      var m = moves[i], v;
      place(ctx, board, m.r, m.c, p);
      try { v = -negamax(ctx, board, depth - 1, -beta, -alpha, 3 - p); }
      finally { unplace(ctx, board, m.r, m.c, p); }
      if (v > best) { best = v; bestIdx = m.r * SIZE + m.c; }
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    if (ctx.tt) {
      if (ctx.tt.size >= capTT) { ctx.tt = new Map(); capClears.tt++; } // 表上限（見 TABLE_CAP）
      ctx.tt.set(key, {
        depth: depth, v: best, best: bestIdx,
        flag: best <= alpha0 ? TT_UPPER : (best >= beta ? TT_LOWER : TT_EXACT)
      });
    }
    return best;
  }

  // 隨機容許差：和最佳值差距在 ε 以內才算「一樣好」。ε＝|值| 的 1% 或 500 取大者；
  // 勝負已定的分數（|值| ≥ WIN/2）不容許差距，只有完全同分才算。
  function epsOf(v) {
    var a = Math.abs(v);
    if (a >= WIN / 2) return 0;
    return Math.max(a * 0.01, 500);
  }

  // 根節點下了 m 之後的值；下界 alpha 以下只保證是上界（fail-low）。
  function rootValue(ctx, board, m, depth, p, alpha) {
    place(ctx, board, m.r, m.c, p);
    try { return -negamax(ctx, board, depth - 1, -Infinity, -alpha, 3 - p); }
    finally { unplace(ctx, board, m.r, m.c, p); }
  }

  // 根節點：每個候選都用「下界 = 目前最佳 − 1」的窗口搜，所以和最佳同分的值是精確值（exact），其餘是上界。
  // （和最佳差距在 ε 以內、需要精確值的著法，到否決關卡再用較寬的窗口重搜，見 strongMove；
  //   迭代加深時就用寬窗口會少剪很多枝、搜不深，最強檔實測明顯變弱。）
  // 回傳依值由高到低排好的 [{ m, v, exact, depth }]。
  function searchRoot(ctx, board, roots, depth, p) {
    var best = -Infinity, vals = [];
    for (var i = 0; i < roots.length; i++) {
      var m = roots[i];
      var alpha = best === -Infinity ? -Infinity : best - 1;
      var v = rootValue(ctx, board, m, depth, p, alpha);
      vals.push({ m: m, v: v, exact: alpha === -Infinity || v > alpha, depth: depth });
      if (v > best) best = v;
    }
    vals.sort(function (a, b) { return b.v - a.v; }); // 穩定排序：同分者保留上一輪的順序
    return vals;
  }

  // 迭代加深；回傳最後一個完成深度的結果（依值排好）。連第一個深度都沒完成時，
  // 回傳靜態評分的順序（v 為 -Infinity、不精確）。
  // ctx.skipGrowth > 0（最強檔）：上一個深度花了 T，若 now + T × skipGrowth 已超過 deadline，就不開下一個深度
  // （多半搜不完、搜不完的深度結果本來就丟掉），省下的時間留給後面的否決關卡。
  // stop（規格 T1，強與最強才給）：每個深度開跑之前看 shouldStop，成立就不再加深，記 ctx.earlyStop。
  // 量測記錄（天元步驟 0，tools/depth-stats.js 讀 trace.deepen）：ctx.deepenLog 每個深度一筆
  // { stage: 第幾次呼叫 deepen（最強檔 1＝第一段、2＝第二段）, depth, ms, end: 'done' 搜完／'timeout' 搜不完丟掉／'skip' skipGrowth 不開／'stop' 提早收手 }。
  // 不多讀時鐘（節點時鐘下讀一次就走一格，多讀會改變結果）：搜不完的那一層 ms 記「deadline − 開始」（逾時只在讀時鐘時發現，差一個讀取間隔）。
  // lastT0（天元步驟 1，規格 AE；最強檔第二段才給）：接續前一次 deepen 時，前一次最後搜完那一層的耗時（ctx.lastLayerMs），
  // 讓這一次的第一個深度也受 skipGrowth 保護（之前第二段的第一個深度一定開，搜不完的時間全丟掉）。
  // 每搜完一層都把耗時記在 ctx.lastLayerMs。
  function deepen(ctx, board, roots, depths, p, stop, lastT0) {
    var res = roots.map(function (m) { return { m: m, v: -Infinity, exact: false }; });
    var lastT = lastT0 >= 0 ? lastT0 : -1, log = ctx.deepenLog || (ctx.deepenLog = []), stage = ctx.deepenStage = (ctx.deepenStage || 0) + 1;
    for (var i = 0; i < depths.length; i++) {
      var t0 = now(ctx.cw.deepen);
      if (ctx.skipGrowth > 0 && lastT >= 0 && t0 + lastT * ctx.skipGrowth > ctx.deadline) {
        log.push({ stage: stage, depth: depths[i], ms: 0, end: 'skip' });
        break;
      }
      if (stop && shouldStop(ctx, board, p, stop)) {
        ctx.earlyStop = { atDepth: ctx.layers[ctx.layers.length - 1].depth, skipped: depths[i] };
        log.push({ stage: stage, depth: depths[i], ms: 0, end: 'stop' });
        break;
      }
      try {
        res = searchRoot(ctx, board, roots, depths[i], p);
        lastT = ctx.lastLayerMs = now(ctx.cw.deepen) - t0;
        log.push({ stage: stage, depth: depths[i], ms: lastT, end: 'done' });
        roots = res.map(function (x) { return x.m; });
        // res：這一層的整份結果（不另複製；只給 trace 與 tools/t1-bench.js 查兩個著法的值，非最佳者的 v 是上界）
        ctx.layers.push({ depth: depths[i], m: res[0].m, gap: res.length > 1 ? res[0].v - res[1].v : Infinity, res: res });
        if (res[0].v >= WIN - 10) break; // 已找到必勝
      } catch (e) {
        if (e !== TIMEOUT) throw e;
        log.push({ stage: stage, depth: depths[i], ms: Math.max(0, ctx.deadline - t0), end: 'timeout' });
        break;
      }
    }
    return res;
  }

  // 規格 T1「簡單局面少算」：stop = { minDepth, margin, enabled }。四條全部成立才不開下一個深度：
  //   (a) ctx.layers 最後兩層的最佳步是同一點；(b) 最後一層的 gap > stop.margin；
  //   (c) 盤上雙方都沒有四、活三、跳三（listThreats 的 fours／openFours／threes 全空）；(d) 最後一層深度 ≥ stop.minDepth。
  // gap 為什麼保守：searchRoot 對最佳以外的候選用「下界 = 目前最佳 − 1」的窗口、negamax 是 fail-soft，
  // 所以 res[1].v 是第二名真值的上界、res[0].v − res[1].v 是真差距的下界——用它過門檻只會少停、不會多停。
  // (c) 在同一步裡不會變：懶惰算一次存 ctx.quietPos（true／false；undefined＝還沒算），而且只在 (a)(b)(d) 都成立時才算
  // （listThreats 要掃全盤、還會產生四三／雙四點，不便宜）。
  function shouldStop(ctx, board, p, stop) {
    if (!stop.enabled) return false;
    var L = ctx.layers, n = L.length;
    if (n < 2) return false;
    var last = L[n - 1], prev = L[n - 2];
    if (last.m.r !== prev.m.r || last.m.c !== prev.m.c) return false;   // (a)
    if (!(last.gap > stop.margin)) return false;                        // (b)
    if (last.depth < stop.minDepth) return false;                       // (d)
    if (ctx.quietPos === undefined) {                                   // (c)
      ctx.quietPos = true;
      for (var s = 1; s <= 2 && ctx.quietPos; s++) {
        var t = listThreats(board, s, ctx.rule, { vcfMs: 0 });
        if (t.fours.length || t.openFours.length || t.threes.length) ctx.quietPos = false;
      }
    }
    return ctx.quietPos;
  }

  // ---------------------------------------------------------------- expert

  var EXPERT_TIME_LIMIT = EXPERT.time; // ms，可由 getMove 的 opts.timeLimit 覆寫（強檔同）
  var EXPERT_WIDTH = EXPERT.width;
  var VCF_PLIES = 16;           // 雙方合計手數（攻方最多 8 次沖四）

  // 以線為單位的葉節點評分。每條線上，每一組己方棋子（組內相鄰兩子間空格 ≤ 2、中間沒有對手子）
  // 只計一次，取組內最強的型態；分數沿用 medium 的點評分尺度：一組型態的價值＝「這條線上最好的那一點
  // 能成的型態」的分數（活三 → 活四的分數，眠三 → 沖四的分數…），不再被它周圍每個空點各算一次。
  // 例外：輪到 p 時，對手 o 的一個活三只算中等威脅分 OPP_LIVE3（p 這一手就能擋），不和活四同量級。
  var GROUP_SCORE = [0, 10, 300, 3000, 4000, 100000, 0, 0, 0];
  var OPP_LIVE3 = 6000;

  // 規格 T1 提早收手的門檻（見 shouldStop）。margin 用搜尋值的尺度＝葉節點 GROUP_SCORE：一個活二＝3000；
  // （SHAPE_SCORE[LIVE2]＝200 是候選排序用的點評分尺度，和 α-β 回的值不同量級，不是這個。）
  // enabled：getMove 沒給 opts.earlyStop 時的預設。測試與 tools/t1-bench.js 經 _internal.EARLY_STOP 改。
  // 第二十一批量測（tools/t1-bench.js，200 局面）：強・1、強・2、最強平均只縮短 0.4%、0.8%、-0.2%，
  // 遠低於規格的 30%；門檻降到 0 的上界也到不了，照規格不留，預設關（同 EXTEND_VCT 的做法）。
  var EARLY_STOP = { margin: GROUP_SCORE[LIVE2], enabled: false };

  function evaluateLines(board, p) {
    var C = cacheOf(board), v = evaluateLinesImpl(board, p, C);
    if (C !== null && cacheCheck) checkSame('evaluateLines', v, fullOf(evaluateLinesImpl, board, p, null));
    return v;
  }

  function evaluateLinesImpl(board, p, C) {
    var o = 3 - p, shp = C ? C.shp : null;
    var cnt = [null, [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0]];
    var sum = [0, 0, 0];
    var lastPos = [0, -99, -99], cur = [0, -1, -1];
    function flush(pl) {
      if (cur[pl] >= 0) { cnt[pl][cur[pl]]++; sum[pl] += GROUP_SCORE[cur[pl]]; }
      cur[pl] = -1; lastPos[pl] = -99;
    }
    for (var d = 0; d < 4; d++) {
      var dr = DIRS[d][0], dc = DIRS[d][1];
      for (var sr = 0; sr < SIZE; sr++) {
        for (var sc = 0; sc < SIZE; sc++) {
          if (inside(sr - dr, sc - dc)) continue; // 只從每條線的起點開始走
          var r = sr, c = sc, pos = 0;
          cur[1] = cur[2] = -1; lastPos[1] = lastPos[2] = -99;
          while (inside(r, c)) {
            var v = board[r][c];
            if (v) {
              flush(3 - v);
              var s = shp ? shp[((v - 1) * NCELL + r * SIZE + c) * 4 + d] : shapeAt(board, r, c, v, dr, dc);
              if (cur[v] >= 0 && pos - lastPos[v] <= 3) { if (s > cur[v]) cur[v] = s; }
              else { flush(v); cur[v] = s; }
              lastPos[v] = pos;
            }
            pos++; r += dr; c += dc;
          }
          flush(1); flush(2);
        }
      }
    }
    var mine = cnt[p], his = cnt[o];
    if (mine[FIVE]) return WIN;
    if (his[FIVE]) return -WIN;
    if (mine[RUSH4] + mine[LIVE4] > 0) return WIN - 1;     // 輪到 p，下一手成五
    if (his[LIVE4] > 0) return -(WIN - 2);                  // 對手活四，擋不完
    var v2 = sum[p] - DEF * (sum[o] - his[LIVE3] * (GROUP_SCORE[LIVE3] - OPP_LIVE3));
    if (his[RUSH4] >= 2) v2 -= SHAPE_SCORE[LIVE4];          // 對手兩個沖四（多半擋不完）
    return v2;
  }

  // ---------------------------------------------------------------- VCF（連續沖四）

  // (r,c) 上已有 p：是否成五（連珠黑棋要恰好五）
  function makesFive(board, r, c, p, rule) {
    var exact = rule === 'renju' && p === 1;
    for (var d = 0; d < 4; d++) {
      var n = runLen(board, r, c, DIRS[d][0], DIRS[d][1], p);
      if (exact ? n === 5 : n >= 5) return true;
    }
    return false;
  }

  function isFivePoint(board, r, c, p, rule) {
    if (!inside(r, c) || board[r][c]) return false;
    board[r][c] = p;
    var ok = makesFive(board, r, c, p, rule);
    board[r][c] = 0;
    return ok;
  }

  // (r,c) 上已有 p：沿四個方向前後 4 格內，p 再下一子就成五的點（去重）
  function fivePointsNear(board, r, c, p, rule) {
    var out = [];
    for (var d = 0; d < 4; d++) {
      var dr = DIRS[d][0], dc = DIRS[d][1];
      for (var k = -4; k <= 4; k++) {
        if (!k) continue;
        var qr = r + dr * k, qc = c + dc * k;
        if (!isFivePoint(board, qr, qc, p, rule)) continue;
        var dup = false;
        for (var i = 0; i < out.length; i++) if (out[i].r === qr && out[i].c === qc) dup = true;
        if (!dup) out.push({ r: qr, c: qc });
      }
    }
    return out;
  }

  // 快取版只看 p 的集合 A 裡有成五形的點（成五點一定有成五形）
  function allFivePoints(board, p, rule) {
    var C = cacheOf(board), out = allFivePointsImpl(board, p, rule, C);
    if (C !== null && cacheCheck) checkSame('allFivePoints', out, fullOf(allFivePointsImpl, board, p, rule, null));
    return out;
  }

  function allFivePointsImpl(board, p, rule, C) {
    var idxs = C ? gatherC(C, IDS_A[p - 1]) : candidates(board), out = [], fl = C ? C.flag : null, fb = (p - 1) * NCELL;
    for (var i = 0; i < idxs.length; i++) {
      if (fl && !(fl[fb + idxs[i]] & 1)) continue;
      var r = (idxs[i] / SIZE) | 0, c = idxs[i] % SIZE;
      if (isFivePoint(board, r, c, p, rule)) out.push({ r: r, c: c });
    }
    return out;
  }

  // p 下了會成四（有成五點）的點；連珠黑棋排除禁手點。評分高的在前。
  // 快取版只看 p 的集合 A 裡有沖四／活四形的點
  function fourMoves(board, p, rule) {
    var C = cacheOf(board), out = fourMovesImpl(board, p, rule, C);
    if (C !== null && cacheCheck) checkSame('fourMoves', out, fullOf(fourMovesImpl, board, p, rule, null));
    return out;
  }

  function fourMovesImpl(board, p, rule, C) {
    var idxs = C ? gatherC(C, IDS_A[p - 1]) : candidates(board), out = [], renjuBlack = rule === 'renju' && p === 1;
    for (var i = 0; i < idxs.length; i++) {
      var r = (idxs[i] / SIZE) | 0, c = idxs[i] % SIZE, has = false;
      if (C) has = (C.flag[(p - 1) * NCELL + idxs[i]] & 2) !== 0;
      else for (var d = 0; d < 4 && !has; d++) {
        var s = shapeAt(board, r, c, p, DIRS[d][0], DIRS[d][1]);
        if (s === RUSH4 || s === LIVE4) has = true;
      }
      if (!has) continue;
      if (renjuBlack) {
        if (isForbidden(board, r, c)) continue;
        board[r][c] = 1;
        var ok = fivePointsNear(board, r, c, 1, rule).length > 0;
        board[r][c] = 0;
        if (!ok) continue;
      }
      out.push({ r: r, c: c, score: C ? pointScoreC(C, idxs[i], p) : pointScore(board, r, c, p) });
    }
    return out.sort(byScoreDesc);
  }

  // 攻方 p 連續沖四求勝。lastDef：守方上一手（守方的新成五點只可能出現在它的線上）；null 表示守方目前沒有成五點。
  // 回傳整串手順 [攻, 守, 攻, 守, …, 攻] 或 null。
  function vcf(ctx, board, p, plies, lastDef) {
    if ((++ctx.nodes & 127) === 0 && now(ctx.cw.vcf) > ctx.vcfDeadline) throw TIMEOUT;
    if (plies <= 0) return null;
    var o = 3 - p, rule = ctx.rule, key = ttKey(ctx, p);
    var seen = ctx.vcfFail.get(key);
    if (seen !== undefined && seen >= plies) return null;
    var moves = null;
    if (lastDef) {
      var threats = fivePointsNear(board, lastDef.r, lastDef.c, o, rule);
      if (threats.length >= 2) { vcfFailSet(ctx, key, plies); return null; }
      if (threats.length === 1) {
        var t = threats[0];
        if (rule === 'renju' && p === 1 && isForbidden(board, t.r, t.c)) { vcfFailSet(ctx, key, plies); return null; }
        moves = [t]; // 先擋對方的四，這一擋本身要是四才能續攻
      }
    }
    if (!moves) moves = fourMoves(board, p, rule);
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i], res = null;
      place(ctx, board, m.r, m.c, p);
      try {
        if (makesFive(board, m.r, m.c, p, rule)) res = [m];
        else {
          var fp = fivePointsNear(board, m.r, m.c, p, rule);
          if (fp.length >= 2) res = [m];                         // 活四或雙四：擋不完
          else if (fp.length === 1) {
            var q = fp[0];
            if (rule === 'renju' && o === 1 && isForbidden(board, q.r, q.c)) res = [m]; // 黑棋擋點是禁手，擋不了
            else if (plies > 2) {
              place(ctx, board, q.r, q.c, o);
              try {
                if (!makesFive(board, q.r, q.c, o, rule)) {
                  var sub = vcf(ctx, board, p, plies - 2, q);
                  if (sub) res = [m, q].concat(sub);
                }
              } finally { unplace(ctx, board, q.r, q.c, o); }
            }
          }
        }
      } finally { unplace(ctx, board, m.r, m.c, p); }
      if (res) return res;
    }
    vcfFailSet(ctx, key, plies);
    return null;
  }

  // 第七批：守方剛下了 q（棋盤上已有）之後，攻方 p 照 VCF 手順 L（[攻, 守, 攻, …, 攻]，守方沒下 q 時找到的）原樣重走還成立嗎？
  // 每一步照 vcf 的規則重驗：攻方每手成四、唯一的成五點就是 L 的下一手（已成五、兩個成五點、連珠黑棋擋點是禁手 → 成立）；
  // 守方擋下去不成五也不成四（守方成四時攻方得改擋，手順不再是原樣）。q 本身是反四就不成立。不改動棋盤。
  function vcfReplay(board, p, rule, L, q) {
    var o = 3 - p, placed = [], ok = false, who = p, i;
    if (fivePointsNear(board, q.r, q.c, o, rule).length) return false;
    try {
      for (i = 0; i < L.length; i++) {
        var m = L[i];
        if (board[m.r][m.c]) return false;
        if (who === p) {
          if (rule === 'renju' && p === 1 && isForbidden(board, m.r, m.c)) return false;
          board[m.r][m.c] = p; placed.push(m);
          if (makesFive(board, m.r, m.c, p, rule)) { ok = true; break; }
          var fps = fivePointsNear(board, m.r, m.c, p, rule);
          if (fps.length >= 2) { ok = true; break; }
          if (!fps.length) return false;
          if (rule === 'renju' && o === 1 && isForbidden(board, fps[0].r, fps[0].c)) { ok = true; break; }
          var n = L[i + 1];
          if (!n || n.r !== fps[0].r || n.c !== fps[0].c) return false;
        } else {
          board[m.r][m.c] = o; placed.push(m);
          if (makesFive(board, m.r, m.c, o, rule) || fivePointsNear(board, m.r, m.c, o, rule).length) return false;
        }
        who = 3 - who;
      }
      return ok;
    } finally {
      for (i = placed.length - 1; i >= 0; i--) board[placed[i].r][placed[i].c] = 0;
    }
  }

  function tryVCF(ctx, board, p, lastDef, plies) {
    try { return vcf(ctx, board, p, plies > 0 ? plies : VCF_PLIES, lastDef); }
    catch (e) { if (e !== TIMEOUT) throw e; return null; }
  }

  // 第十九批（規格 X、judge F3）：vcf 是深度優先、找到就停，第一條不一定最短。已找到長度 L 的 seq（L > 1）時，
  // 用同一個 ctx（失敗表沿用：多手數都失敗的局面少手數一定也失敗）依 plies 1、3、5…到 L−2 逐步加深，
  // 先找到的就是最短的，換掉 seq；時限（ctx.vcfDeadline）到了就保留目前的。只用在根節點（守方沒有成五點）。
  // floor：已知不存在的最短長度下限（例如已確認沒有一步 W4 時傳 1，從 3 開始），0 表示從 1 開始。
  function shortestVCF(ctx, board, p, seq, floor) {
    if (!seq || seq.length <= 1) return seq;
    for (var k = floor > 0 ? floor + 2 : 1; k <= seq.length - 2; k += 2) {
      var s;
      try { s = vcf(ctx, board, p, k, null); }
      catch (e) { if (e !== TIMEOUT) throw e; return seq; }
      if (s) return s;
    }
    return seq;
  }

  // 第十九批：p 一步就能做出的 W4 點（threatPoints）有好幾個時選哪個：點評分（攻＋0.9 守；有 list 就用 list 裡的 score）最高的。
  // rnd：同分隨機（對局用）；否則取同分裡的第一個（findVCF、listThreats 用，結果固定）。
  function pickW4(board, p, w4, list, rnd) {
    var best = [], bs = -Infinity;
    for (var i = 0; i < w4.length; i++) {
      var sc = null, m = w4[i];
      if (list) for (var j = 0; j < list.length; j++) if (list[j].r === m.r && list[j].c === m.c) { sc = list[j].score; break; }
      if (sc === null) sc = pointScore(board, m.r, m.c, p) + DEF * pointScore(board, m.r, m.c, 3 - p);
      if (sc > bs) { bs = sc; best = [m]; }
      else if (sc === bs) best.push(m);
    }
    return rnd ? randomPick(best) : best[0];
  }

  // 對手有 VCF 時，找出下了之後對手就沒有 VCF 的點。
  // 檢查範圍：對手 VCF 手順上的點、自己的沖四點、評分前 EXPERT_WIDTH 名；只限於 roots 裡的點。
  function findBreakers(ctx, board, p, roots, seq) {
    var o = 3 - p, byIdx = {}, order = [], i, idx;
    for (i = 0; i < roots.length; i++) byIdx[roots[i].r * SIZE + roots[i].c] = roots[i];
    function add(m) {
      idx = m.r * SIZE + m.c;
      if (byIdx[idx] && order.indexOf(idx) < 0) order.push(idx);
    }
    for (i = 0; i < seq.length; i++) add(seq[i]);
    var fm = fourMoves(board, p, ctx.rule);
    for (i = 0; i < fm.length; i++) add(fm[i]);
    var top = topN(roots, EXPERT_WIDTH);
    for (i = 0; i < top.length; i++) add(top[i]);
    var out = [];
    for (i = 0; i < order.length; i++) {
      var m = byIdx[order[i]], r;
      place(ctx, board, m.r, m.c, p);
      try { r = vcf(ctx, board, o, VCF_PLIES, m); }
      catch (e) { if (e !== TIMEOUT) throw e; break; }
      finally { unplace(ctx, board, m.r, m.c, p); }
      if (!r) out.push(m);
    }
    return out;
  }

  // ---------------------------------------------------------------- VCT（BMM 式威脅搜尋）
  //
  // 攻方節點（vctA，輪攻方）：自己能成五 → 勝；守方有兩個四 → 敗；守方一個四 → 先擋（擋完輪守方）；
  //   自己有 VCF → 勝；威脅手數用完 → 敗；否則試全盤「使自己成四（含沖四）或活三／跳三」的著法，先四後三。
  // 守方節點（vctD，輪守方）：守方能成五 → 敗；攻方兩個四 → 勝；攻方一個四 → 唯一擋點（連珠黑棋擋點是禁手 → 勝）；
  //   攻方沒有 W4 點但有 VCF（四三點；或守方沖四、攻方擋完之後）→ 守方要破掉這條 VCF（見 vctDefendVCF）；
  //   攻方連 VCF 都沒有 → 威脅斷了（見下面「沖四拖延」）；守方有 VCF → 敗；否則守方的全部防點＋守方自己的反四
  //   （反四後攻方必須擋，擋完仍輪守方）都要攻方贏才算勝。
  // 深度以攻方威脅手數計（沖四與活三都算一手；節點上的 VCF 不另計）。置換表以 zobrist 記錄已證明的勝與敗；
  // 超過節點或時間預算就放棄（回傳 null＝未知）。
  //
  // 第七批（judge 第四輪）兩個盲點：
  //   一、攻方著法漏了「做出雙四點或四三點」的著法（也是非應不可的威脅）：EXTEND_VCT 打開時 attackMoves 帶 extended
  //       （遊戲內實驗沒過留的判準，目前關著；嚴格驗證器照用）。攻方剛做出四三點（沒有 W4 點、但有 VCF）時守方的應法見 vctDefendVCF。
  //   二、沖四拖延：守方沖四、攻方擋完，輪守方而攻方沒有現成威脅時，原本直接判「威脅斷了、守住」；
  //       其實守方只是換到一手，攻方的攻勢可能還在。遊戲內不窮舉守方這一手（太貴），改成：攻方若「守方放棄這一手」
  //       仍有 t 手內的 VCT，這個「守住」就標成沒證明（ctx.vctTaint；置換表連同標記一起記）。
  //       runVCT／runVCTAfter 最後的「沒找到」若帶這個標記，ctx.vctDelayed 與 ctx.vctUnknown 都是 true——
  //       否決關卡、復盤、forcedWinAfter、findVCT 的 report 都把它當「查不完」，不當成安全。
  //       守方連續反四超過 VCT_CF_MAX 層也一樣標記。嚴格的判定（守方窮舉全盤）見本檔的 makeStrict（第十批從 tools/strict-verify.js
  //       搬進來）：題庫工具與測試用，遊戲流程只有復盤的較好下法（findBetterMove）用。

  var VCT_BUDGET = { budget: true };
  var VCT_CF_MAX = 4; // 守方連續反四的層數上限；超過就當成攻擊沒證明成功（第七批起標成沒證明，見上）
  // 第七批：VCT 的攻方著法加上「做出雙四點或四三點」的著法（見 threatMakers）。實驗沒過留的判準（同種子量兩次：
  // 第一次 10–11 階梯 40 局只剩 48%；收尾重跑書譜機器人強・2 只剩 8 勝，判準 9），所以關掉；程式留著（嚴格驗證器一直用），
  // selfplay.js 與 bookbot.js 可用參數 ext=1 打開。數字見 README「階梯校正紀錄／第七批」。
  var EXTEND_VCT = false;

  // 節點預算只數攻方／守方節點（vctA、vctD）；節點裡呼叫的 VCF 子搜尋不計入，由時間預算管。
  function vctTick(ctx) {
    if (++ctx.vctNodes > ctx.vctNodeLimit) throw VCT_BUDGET;
    if ((ctx.vctNodes & 15) === 0 && now(ctx.cw.vct) > ctx.vctDeadline) throw VCT_BUDGET;
  }

  // 置換表：w＝幾手內證明勝（line 是手順），f＝幾手內證明不勝，ft＝那個「不勝」有沒有沖四拖延的標記。
  // 查到「不勝」時把標記放回 ctx.vctTaint。
  function vttGet(ctx, att, key, t) {
    var e = ctx.vtt[att].get(key);
    if (!e) return undefined;
    if (e.w <= t) { ctx.vctTaint = false; return e.line; }
    if (e.f >= t) { ctx.vctTaint = e.ft; return null; }
    return undefined;
  }

  function vttPut(ctx, att, key, t, line, taint) {
    var map = ctx.vtt[att], e = map.get(key);
    if (!e) {
      if (map.size >= capVtt) { map = ctx.vtt[att] = new Map(); capClears[att === 1 ? 'vtt1' : 'vtt2']++; } // 表上限（見 TABLE_CAP）
      e = { w: Infinity, f: -1, ft: false, line: null }; map.set(key, e);
    }
    if (line) { if (t < e.w) { e.w = t; e.line = line; } }
    else if (t > e.f) { e.f = t; e.ft = !!taint; }
    else if (t === e.f && !taint) e.ft = false;
  }

  // 攻方的威脅著：成四（含沖四）的在前、成活三／跳三的在後，各自依點評分排序（四三、雙三點自然排最前）。
  // extended（第七批）：後面再接「做出雙四點或四三點」的著法（見 threatMakers）；嚴格驗證（makeStrict）用 true，
  // VCT（EXTEND_VCT 打開時）在成四、活三都試過之後才用 'only' 只算這一段。
  // 快取版：不帶 extended 時只看 p 的集合 A、B（成四、活三一定有對應的形）；帶 extended 時全部候選點照原本的順序看（型態讀快取）
  function attackMoves(board, p, rule, extended) {
    var C = cacheOf(board), out = attackMovesImpl(board, p, rule, extended, C);
    if (C !== null && cacheCheck) checkSame('attackMoves', out, fullOf(attackMovesImpl, board, p, rule, extended, null));
    return out;
  }

  function attackMovesImpl(board, p, rule, extended, C) {
    var idxs = C ? (extended ? candidatesC(C) : gatherC(C, IDS_AB[p - 1])) : candidates(board);
    var fours = [], threes = [], renjuBlack = rule === 'renju' && p === 1, pb = (p - 1) * NCELL * 4;
    var rest = extended ? [] : null, f4 = extended ? {} : null;
    for (var i = 0; i < idxs.length; i++) {
      var r = (idxs[i] / SIZE) | 0, c = idxs[i] % SIZE;
      var nf = 0, n3 = 0, sum = 0, d2 = 0, d3 = 0;
      for (var d = 0; d < 4; d++) {
        var s = C ? C.shp[pb + idxs[i] * 4 + d] : shapeAt(board, r, c, p, DIRS[d][0], DIRS[d][1]);
        sum += SHAPE_SCORE[s];
        if (s === RUSH4 || s === LIVE4 || s === FIVE) nf++;
        else if (s === LIVE3) n3++;
        if (extended) {
          if (s >= SLEEP2) d2 |= 1 << d;
          if (s === SLEEP3) d3 |= 1 << d;
          if (s === RUSH4) f4[idxs[i]] = 1;
        }
      }
      if (!nf && !n3) {
        if (extended && d2) rest.push({ r: r, c: c, score: sum, d2: d2, d3: d3 });
        continue;
      }
      if (renjuBlack && isForbidden(board, r, c)) continue;
      if (nf && n3) sum += 50000;
      else if (n3 >= 2) sum += 20000;
      (nf ? fours : threes).push({ r: r, c: c, score: sum });
    }
    fours.sort(byScoreDesc);
    threes.sort(byScoreDesc);
    var out = extended === 'only' ? [] : fours.concat(threes); // 'only'：只要後面那一段（VCT 在成四、活三都沒成功後才算）
    return extended ? out.concat(threatMakers(board, p, rule, rest, f4)) : out;
  }

  // p 下 (r,c) 會成四三（一個方向沖四、另一個方向活三）的點；連珠黑棋的禁手點不算。(r,c) 要是空點。
  function is43Point(board, r, c, p, rule) {
    var C = cachePeek(board), v = is43PointImpl(board, r, c, p, rule, C);
    if (C !== null && cacheCheck) checkSame('is43Point', v, fullOf(is43PointImpl, board, r, c, p, rule, null));
    return v;
  }

  function is43PointImpl(board, r, c, p, rule, C) {
    var f4 = 0, l3 = 0, b = ((p - 1) * NCELL + r * SIZE + c) * 4;
    for (var d = 0; d < 4; d++) {
      var s = C ? C.shp[b + d] : shapeAt(board, r, c, p, DIRS[d][0], DIRS[d][1]);
      if (s === RUSH4) f4++;
      else if (s === LIVE3) l3++;
    }
    if (!f4 || !l3) return false;
    return !(rule === 'renju' && p === 1 && isForbidden(board, r, c));
  }

  // 第七批（judge 第四輪）：「做出雙四點或四三點」的著法——p 下了之後自己不成四、也不成活三，但盤上多出一個 p 的
  // 雙四點（W4 點）或四三點；對手不應，p 下一手就是雙四或四三（等於 VCF 的威脅），所以也是非應不可的威脅著。
  // 新的點只可能在 p 下的那一點四條線上前後 4 格，而且：那個方向 p 下了只成眠二／活二時，新點一定原本就是 p 的沖四點
  // （f4：原本某方向下了成沖四的點；新點要靠這一手在這條線上多一個活三）；成眠三時線上每個空點都要看。
  // rest：attackMoves 第一輪留下的 { r, c, score, d2（≥ 眠二的方向）, d3（眠三的方向） }。回傳依點評分排序；連珠黑棋不含禁手點。
  function threatMakers(board, p, rule, rest, f4) {
    var out = [], renjuBlack = rule === 'renju' && p === 1;
    for (var i = 0; i < rest.length; i++) {
      var e = rest[i], hit = false;
      setStone(board, e.r, e.c, p); // 天元步驟 2：寫完要讀型態（isW4Move、is43Point），經過快取
      for (var d = 0; d < 4 && !hit; d++) {
        if (!((e.d2 >> d) & 1)) continue;
        var all = (e.d3 >> d) & 1, dr = DIRS[d][0], dc = DIRS[d][1];
        for (var k = -4; k <= 4 && !hit; k++) {
          var qr = e.r + dr * k, qc = e.c + dc * k;
          if (!k || !inside(qr, qc) || board[qr][qc]) continue;
          if (!all && !f4[qr * SIZE + qc]) continue;
          if (isW4Move(board, qr, qc, p, rule) || is43Point(board, qr, qc, p, rule)) hit = true;
        }
      }
      clearStone(board, e.r, e.c);
      if (hit && renjuBlack && isForbidden(board, e.r, e.c)) hit = false;
      if (hit) out.push({ r: e.r, c: e.c, score: e.score });
    }
    return out.sort(byScoreDesc);
  }

  // 攻方 p 走。t：剩下的威脅手數。回傳勝的手順（陣列）或 null。回傳 null 時 ctx.vctTaint＝這個「不勝」有沒有沖四拖延的標記。
  function vctA(ctx, board, p, t) {
    vctTick(ctx);
    var o = 3 - p, rule = ctx.rule;
    var own = allFivePoints(board, p, rule);
    if (own.length) { ctx.vctTaint = false; return [own[0]]; }
    var key = ttKey(ctx, p), hit = vttGet(ctx, p, key, t);
    if (hit !== undefined) return hit;
    var res = null, taint = false, theirs = allFivePoints(board, o, rule), i;
    if (theirs.length === 1) {
      var f = theirs[0];
      if (!(rule === 'renju' && p === 1 && isForbidden(board, f.r, f.c))) {
        place(ctx, board, f.r, f.c, p);
        try {
          var sub = vctD(ctx, board, p, t, 0, true);
          if (sub) res = [f].concat(sub);
          else taint = ctx.vctTaint;
        } finally { unplace(ctx, board, f.r, f.c, p); }
      }
    } else if (!theirs.length) {
      var v = vcf(ctx, board, p, VCF_PLIES, null);
      if (v) res = v;
      else if (t > 0) {
        // 先試成四、活三；都不成才算「做出雙四點／四三點」的著法（EXTEND_VCT）
        for (var pass = 0; pass < (EXTEND_VCT ? 2 : 1) && !res; pass++) {
          var moves = attackMoves(board, p, rule, pass ? 'only' : false);
          for (i = 0; i < moves.length && !res; i++) {
            var m = moves[i];
            place(ctx, board, m.r, m.c, p);
            try {
              var sub2 = vctD(ctx, board, p, t - 1, 0, false);
              if (sub2) res = [m].concat(sub2);
              else if (ctx.vctTaint) taint = true;
            } finally { unplace(ctx, board, m.r, m.c, p); }
          }
        }
      }
    }
    if (res) taint = false;
    vttPut(ctx, p, key, t, res, taint);
    ctx.vctTaint = taint;
    return res;
  }

  // 守方 o＝3−p 走。回傳攻方勝的手順（沿第一個防點展開）或 null（守方守得住；ctx.vctTaint 見 vctA）。
  // afterBlock：上一手是攻方擋守方的四（守方沖四換來的這一手，見檔頭「沖四拖延」）。
  function vctD(ctx, board, p, t, cf, afterBlock) {
    vctTick(ctx);
    var o = 3 - p, rule = ctx.rule;
    ctx.vctTaint = false;
    if (allFivePoints(board, o, rule).length) return null;
    var fp = allFivePoints(board, p, rule);
    if (fp.length >= 2) return [];
    if (fp.length === 1) {
      var f = fp[0];
      if (rule === 'renju' && o === 1 && isForbidden(board, f.r, f.c)) return [];
      place(ctx, board, f.r, f.c, o);
      try {
        var s1 = vctA(ctx, board, p, t);
        return s1 ? [f].concat(s1) : null;
      } finally { unplace(ctx, board, f.r, f.c, o); }
    }
    var key = ttKey(ctx, o), hit = vttGet(ctx, p, key, t);
    if (hit !== undefined) return hit;
    var w4 = threatPoints(board, p, rule), res;
    if (w4.length) res = vctDefend(ctx, board, p, t, cf, w4);
    else {
      var L = vcf(ctx, board, p, VCF_PLIES, null);
      if (!L) {
        // 攻方沒有現成的威脅（這兩種結果和 afterBlock 有關，不進置換表）
        if (!afterBlock) { ctx.vctTaint = false; return null; } // 攻方上一手其實不是威脅
        // 沖四拖延：守方「放棄這一手」時攻方仍有 t 手內的 VCT → 守方得下對這一手；遊戲內不窮舉，標成沒證明
        var nm = vctA(ctx, board, p, t);
        ctx.vctTaint = !!nm || ctx.vctTaint;
        return null;
      }
      res = vctDefendVCF(ctx, board, p, t, cf, L);
    }
    var taint = ctx.vctTaint;
    vttPut(ctx, p, key, t, res, taint);
    ctx.vctTaint = taint;
    return res;
  }

  // 攻方有 W4 點 w4：守方的全部防點都要攻方贏，再試守方的反四（見 vctCounterFours）。
  function vctDefend(ctx, board, p, t, cf, w4) {
    var o = 3 - p, i, sub;
    if (vcf(ctx, board, o, VCF_PLIES, null)) { ctx.vctTaint = false; return null; } // 守方有 VCF 反殺
    var defs = defenseSet(ctx, board, p, w4), line = null, skip = {};
    for (i = 0; i < defs.length; i++) {
      var q = defs[i];
      skip[q.r * SIZE + q.c] = 1;
      place(ctx, board, q.r, q.c, o);
      try { sub = vctA(ctx, board, p, t); }
      finally { unplace(ctx, board, q.r, q.c, o); }
      if (!sub) return null;
      if (!line) line = [q].concat(sub);
    }
    return vctCounterFours(ctx, board, p, t, cf, skip, line);
  }

  // 第七批：攻方沒有 W4 點、但有 VCF 手順 L（攻方剛做出四三點；或守方沖四、攻方擋完之後攻方仍有連續沖四）。
  // 守方要破掉 L：L 上每一點四條線前後 4 格以外的點動不到 L 的任何一手（攻方照 L 走一樣贏），所以只試這些點；
  // 其中下了之後 L 照原樣重走還成立的（vcfReplay）也直接算輸。守方的反四另外試（見 vctCounterFours）。
  function vctDefendVCF(ctx, board, p, t, cf, L) {
    var o = 3 - p, rule = ctx.rule, i, d, k, sub;
    if (vcf(ctx, board, o, VCF_PLIES, null)) { ctx.vctTaint = false; return null; }
    var skip = {}, cands = [], line = null;
    var cfs = fourMoves(board, o, rule);
    for (i = 0; i < cfs.length; i++) skip[cfs[i].r * SIZE + cfs[i].c] = 1;
    function add(r, c) {
      if (!inside(r, c) || board[r][c]) return;
      var idx = r * SIZE + c;
      if (skip[idx]) return;
      skip[idx] = 1;
      if (rule === 'renju' && o === 1 && isForbidden(board, r, c)) return;
      cands.push({ r: r, c: c });
    }
    for (i = 0; i < L.length; i++) add(L[i].r, L[i].c);
    for (i = 0; i < L.length; i++)
      for (d = 0; d < 4; d++)
        for (k = -4; k <= 4; k++) if (k) add(L[i].r + DIRS[d][0] * k, L[i].c + DIRS[d][1] * k);
    for (i = 0; i < cands.length; i++) {
      var q = cands[i];
      place(ctx, board, q.r, q.c, o);
      try { sub = vcfReplay(board, p, rule, L, q) ? L : vctA(ctx, board, p, t); }
      finally { unplace(ctx, board, q.r, q.c, o); }
      if (!sub) return null;
      if (!line) line = [q].concat(sub);
    }
    return vctCounterFours(ctx, board, p, t, cf, {}, line); // cands 不含反四點，反四全部在這裡試
  }

  // 守方的反四（skip 裡的點已經試過）：反四後攻方必須擋，擋完仍輪守方（vctD 的 afterBlock）。
  // 每個反四之後都要攻方贏才算勝；守方連續反四超過 VCT_CF_MAX 層就當成沒證明（標記，見檔頭）。
  function vctCounterFours(ctx, board, p, t, cf, skip, line) {
    var o = 3 - p, rule = ctx.rule;
    var cfs = fourMoves(board, o, rule);
    for (var i = 0; i < cfs.length; i++) {
      var c = cfs[i];
      if (skip[c.r * SIZE + c.c]) continue;
      if (cf >= VCT_CF_MAX) { ctx.vctTaint = true; return null; }
      var ok = false;
      ctx.vctTaint = false;
      place(ctx, board, c.r, c.c, o);
      try {
        var cp = fivePointsNear(board, c.r, c.c, o, rule);
        if (cp.length === 1 && !makesFive(board, c.r, c.c, o, rule)) {
          var f = cp[0];
          if (!(rule === 'renju' && p === 1 && isForbidden(board, f.r, f.c))) {
            place(ctx, board, f.r, f.c, p);
            try {
              if (makesFive(board, f.r, f.c, p, rule)) ok = true;
              else ok = !!vctD(ctx, board, p, t, cf + 1, true);
            } finally { unplace(ctx, board, f.r, f.c, p); }
          }
        }
      } finally { unplace(ctx, board, c.r, c.c, o); }
      if (!ok) return null;
    }
    ctx.vctTaint = false;
    return line || [];
  }

  // 在 ctx 上找 p 的 VCT（輪到 p）。回傳手順或 null（沒有或超過預算）。棋盤一定還原。
  // 回傳 null 時，ctx.vctUnknown 表示「是超過預算才停的」（未知），false 表示整棵樹搜完、確定沒有。
  // 第七批：整棵樹搜完、但「守住」靠的是沖四拖延（見 VCT 檔頭）時，ctx.vctDelayed 與 ctx.vctUnknown 都是 true。
  function runVCT(ctx, board, p, maxThreats, maxNodes, deadline) {
    var saved = ctx.vcfDeadline;
    ctx.vctNodeLimit = ctx.vctNodes + maxNodes;
    ctx.vctDeadline = deadline;
    ctx.vcfDeadline = deadline;
    ctx.vctUnknown = false;
    ctx.vctDelayed = false;
    try {
      for (var t = 1; t <= maxThreats; t++) {
        var r = vctA(ctx, board, p, t);
        if (r) return r.length ? r : null;
      }
      if (ctx.vctTaint) ctx.vctDelayed = ctx.vctUnknown = true;
      return null;
    } catch (e) {
      if (e !== TIMEOUT && e !== VCT_BUDGET) throw e;
      ctx.vctUnknown = true;
      return null;
    } finally {
      ctx.vcfDeadline = saved;
    }
  }

  // ---------------------------------------------------------------- 強、最強的根節點決策
  //
  // 1 硬規則三條（第 3 條換成全部防點，見 threeBlocks）→ 2 自己的 VCF、VCT → 3 對手的 VCF（只從破解點裡選）→ 4 α-β 迭代加深 →
  // 5 否決關卡：依值由高到低，下了之後對手有 VCT 就否決換下一個；都沒通過時的退路見 vetoGate →
  // 6 只在通過關卡、且和最佳通過值差距在 ε 以內（都是精確值）的著法之間隨機。
  // 時間分配：自己的 VCF＋VCT 到 20%，對手的 VCF 與破解點到 30%，α-β 到 70%，否決到 100%。
  //
  // 最強檔（cfg.floor＝強檔設定）分兩段：
  //   第一段「保底」＝強檔的 1～6 原樣照做（強檔的 VCT 手數、節點預算、深度 2→4→6、時間比例），
  //   所以同樣時限下，第一段選出的著法和強檔同分布。
  //   第二段「加深」只用第一段做完剩下的時間（第一段的否決關卡找到通過的著法、後面的候選值差太多就提早結束，
  //   300 ms 時中位數約剩三成，但這點時間幾乎搜不完下一個深度）：第一段的否決關卡若沒有確定通過的著法，就先把它做完；
  //   否則自己的 VCT 加深到 8 手 → α-β 從第一段搜完的深度接著往下（第一段只搜完 4 層就從 6 層起，
  //   預估搜不完的深度不開，見 deepen 的 skipGrowth）→ 用新的排序再過一次 8 手的否決關卡。
  //   第二段每一步做不完就沿用第一段的結果；第二段換掉第一段的著法時，新著法一定通過了 8 手的否決。
  //
  // 規格 T1：earlyStop 為 true 時，兩段的 deepen 共用同一個 stop（minDepth＝cfg.depths 最大值的一半：強 3、最強 5），
  // 見 shouldStop。trace 有給、而且走到建 ctx 之後時，結束前填 trace.layers（ctx.layers 的淺拷貝）、trace.nodes（ctx.nodes）、
  // trace.earlyStop（有提早收手才有，同 ctx.earlyStop）、trace.deepen（每個深度的量測記錄，見 deepen）。
  function strongMove(board, p, list, stones, rule, cfg, timeLimit, quiet, earlyStop, trace) {
    var box = {};
    try { return strongSearch(board, p, list, stones, rule, cfg, timeLimit, quiet, earlyStop, box); }
    finally {
      var ctx = box.ctx;
      if (ctx) lastTables = { tt: ctx.tt ? ctx.tt.size : 0, vcfFail: ctx.vcfFail.size, vtt1: ctx.vtt[1].size, vtt2: ctx.vtt[2].size }; // 量測用（tableStats）
      if (trace && ctx) {
        trace.layers = ctx.layers.slice();
        trace.nodes = ctx.nodes;
        trace.deepen = (ctx.deepenLog || []).slice(); // 量測用（tools/depth-stats.js），見 deepen
        if (ctx.earlyStop) trace.earlyStop = { atDepth: ctx.earlyStop.atDepth, skipped: ctx.earlyStop.skipped };
        else delete trace.earlyStop;
      }
    }
  }

  function strongSearch(board, p, list, stones, rule, cfg, timeLimit, quiet, earlyStop, box) {
    var limit = timeLimit > 0 ? timeLimit : cfg.time;
    var start = now(clockW(rule).search), end = start + limit, o = 3 - p;
    var base = cfg.floor || cfg;
    var forced = forcedMoves(list, true, board, p, rule);
    var mustBlockFive = !!forced && forced[0].oppMax === FIVE;
    if (forced && (forced[0].myMax === FIVE || (mustBlockFive && forced.length === 1))) return forced[0];
    if (!forced && stones <= 2) return randomPick(topN(list, 3));
    var ctx = newCtx(board, rule, end, cfg.width, true);
    ctx.qDepth = cfg.qDepth;
    box.ctx = ctx;
    var stop = { minDepth: Math.max.apply(null, cfg.depths) / 2, margin: EARLY_STOP.margin, enabled: !!earlyStop };
    if (forced && !mustBlockFive) {                  // 硬規則 3（對手活三／跳三）：換成全部防點再搜，見 threeBlocks
      forced = threeBlocks(ctx, board, o, list, forced);
      if (forced && forced.length === 1) return forced[0];
    }
    var roots = (forced || list).slice();
    if (!mustBlockFive) {
      // 第十九批（規格 X、judge F1／F2）：一步做出擋不完的四（活四、雙四、連珠白棋逼黑擋在禁手點）就直接下，
      // 照規則判（isW4Move），不看形狀分；VCF 的第一手可能是沖四，比這慢。
      var w4 = threatPoints(board, p, rule);
      if (w4.length) return pickW4(board, p, w4, list, true);
      ctx.vcfDeadline = start + limit * 0.2;
      var mine = shortestVCF(ctx, board, p, tryVCF(ctx, board, p, null), 1); // 上一行已確認沒有一步 W4，從 3 手找起
      if (mine) return mine[0];
      var vct = runVCT(ctx, board, p, base.ownThreats, base.vctNodes, start + limit * 0.2);
      if (vct) return vct[0];
      ctx.vcfDeadline = start + limit * 0.3;
      var theirs = tryVCF(ctx, board, o, null);
      if (theirs) {
        var breakers = findBreakers(ctx, board, p, roots, theirs);
        if (breakers.length) roots = breakers;
      }
    }
    roots = topN(roots, cfg.width);
    ctx.deadline = start + limit * 0.7;
    var ordered = deepen(ctx, board, roots, base.depths, p, stop);
    if (mustBlockFive) return ordered[0].m;
    var gate = vetoGate(ctx, board, p, ordered, base.vetoThreats, base.vctNodes, end, null, quiet, base === cfg);
    if (base === cfg || now(clockW(rule).search) >= end) return gate.pick;

    // ---- 第二段（最強檔）：只用剩下的時間
    // 第一段的否決關卡沒有一個確定通過（時間或節點不夠，時限短時常見）：剩下的時間全拿來把它做完，
    // 手數仍用強檔的，節點預算用最強檔的。
    // （quiet：pending＝通過第一關、安靜棋那關查不完的，當成「有通過的」；見 vetoGate）
    if (!gate.passed.length && !gate.pending.length) {
      var retry = vetoGate(ctx, board, p, ordered, base.vetoThreats, cfg.vctNodes, end, gate.bad, quiet, true);
      if (retry.passed.length || retry.pending.length || retry.bad[gate.pick.r * SIZE + gate.pick.c]) return retry.pick;
      return gate.pick;
    }
    var own = runVCT(ctx, board, p, cfg.ownThreats, cfg.vctNodes, now(clockW(rule).search) + (end - now(clockW(rule).search)) * 0.25);
    if (own) return own[0];
    ctx.deadline = now(clockW(rule).search) + (end - now(clockW(rule).search)) * 0.6;
    ctx.skipGrowth = cfg.skipGrowth || 0;
    var reached = ordered[0].depth || 0;             // 第一段最後搜完的深度（300 ms 時多半只到 4 層）
    // 天元步驟 1：帶入第一段最後一層的耗時，第一個深度也照 skipGrowth 預估，搜不完就不開，省下的時間留給下面的否決關卡
    var deeper = deepen(ctx, board, ordered.map(function (x) { return x.m; }), cfg.depths.filter(function (d) {
      return d > reached;
    }), p, stop, ctx.lastLayerMs);
    if (deeper[0].depth) ordered = deeper;           // 下一個深度沒搜完就沿用第一段的排序與值
    var gate2 = vetoGate(ctx, board, p, ordered, cfg.vetoThreats, cfg.vctNodes, end, gate.bad, quiet, true);
    if (gate2.passed.length) return gate2.pick;
    // 加深的否決一個確定通過的都沒有：用第一段通過的著法，但去掉第二段證明會輸的；
    // 全被證明會輸，就用第二段查不完或還沒查的（gate2.pick 不在 bad 裡時就是這種）
    var keep = gate.passed.filter(function (m) { return !gate2.bad[m.r * SIZE + m.c]; });
    if (keep.length) return randomPick(keep);
    // quiet：兩段都只有「安靜棋那關查不完」的，先用第二段的、再用第一段沒被第二段證明會輸的
    if (gate2.pending.length) return gate2.pick;
    var keepP = gate.pending.filter(function (m) { return !gate2.bad[m.r * SIZE + m.c]; });
    if (keepP.length) return randomPick(keepP);
    return gate2.bad[gate2.pick.r * SIZE + gate2.pick.c] ? gate.pick : gate2.pick;
  }

  // 強、最強的硬規則 3：對手 o 有活三／跳三、自己沒有四時，候選換成「全部防點」——下了之後 o 沒有
  // 一手成活四或雙四的點（和 VCT 守方同一個 defenseSet）；只限 list 裡的點（連珠黑棋已排除禁手）。
  // 「o 下了會成活四的點」只是防點的一部分：跳三 X_XX 的成活四點只有中間的空格，但兩端外側也擋得住，
  // 而那一格可能正是下了會被對手 VCT 的點（書譜機器人強檔第 7、11 局）。找不到共同防點
  // （例如兩個分開的活三）就沿用原來的點。
  // 第二十批 a（judge 第十輪 F5）：o 照規則沒有 W4 點（形狀上的活三是假的）就不是硬規則 3，回 null、照一般候選搜，
  // 不退回形狀清單。
  function threeBlocks(ctx, board, o, list, forced) {
    var w4 = threatPoints(board, o, ctx.rule);
    if (!w4.length) return null;
    var defs = defenseSet(ctx, board, o, w4), byIdx = {}, out = [], i;
    for (i = 0; i < list.length; i++) byIdx[list[i].r * SIZE + list[i].c] = list[i];
    for (i = 0; i < defs.length; i++) {
      var e = byIdx[defs[i].r * SIZE + defs[i].c];
      if (e) out.push(e);
    }
    return out.length ? out : forced;
  }

  // 否決關卡。ordered：依值排好的 [{ m, v, exact, depth }]。knownBad：先前已證明「下了對手有 VCT」的點（跳過）。
  // 每個候選的 VCT 檢查最多用剩餘時間的 1/3，免得一個查不完的候選吃掉整段否決時間；
  // 查不完（未知）的先記著，只有在一個「確定沒有 VCT」的候選都找不到時才用。
  // 回傳 { pick, passed: [m…], pending: [m…]（只有 quiet 時會有：通過第一關、安靜棋那關查不完），bad: { idx: true } }。
  // quiet（第六批實驗，只有 TIERS 標 quiet 的階）：通過「對手立刻有 VCT」的候選，再做 quietCheck（對手先下一手安靜棋再 VCT）；
  // 判輸的（qBad）跳過，查不完的（pending）先記著。quietFull：安靜棋檢查可以用到關卡的期限（否則每個候選最多剩餘時間的 1/3）。
  // 挑選順序：兩關都通過的 → 只通過第一關、安靜棋查不完的 → 第一關查不完的 → 安靜棋那關判輸的 → 還沒查的 → 已證明會輸的第一名。
  function vetoGate(ctx, board, p, ordered, threats, nodes, deadline, knownBad, quiet, quietFull) {
    var o = 3 - p, passed = [], first = null, unknown = null, bad = {}, k, qPend = [], qBad = null;
    if (knownBad) for (k in knownBad) bad[k] = true;
    ctx.deadline = deadline;
    for (var i = 0; i < ordered.length; i++) {
      var e = ordered[i], tNow = now(ctx.cw.veto), idx = e.m.r * SIZE + e.m.c;
      if (tNow > deadline) break;
      if (bad[idx]) continue;
      if (first) {
        if (!first.exact) break;                 // 第一個通過的值不精確，就不隨機
        var lo = first.v - epsOf(first.v);
        if (e.v < lo) break;                     // 上界已在 ε 之外；後面的只會更低
        if (!e.exact) {                          // 上界在 ε 以內：用 ε 窗口重搜同一深度拿精確值
          try { e.v = rootValue(ctx, board, e.m, e.depth, p, lo - 1); }
          catch (err) { if (err !== TIMEOUT) throw err; break; }
          e.exact = e.v > lo - 1;
          if (!e.exact || e.v < lo) continue;
        }
      }
      var hit, slice = Math.min(deadline, tNow + Math.max(40, (deadline - tNow) / 3));
      place(ctx, board, e.m.r, e.m.c, p);
      try { hit = runVCT(ctx, board, o, threats, nodes, slice); }
      finally { unplace(ctx, board, e.m.r, e.m.c, p); }
      if (hit) { bad[idx] = true; continue; }
      // 第十二批（judge 第五輪 F7）試過把「沖四拖延、沒證明」（vctDelayed）和「通過」放同一順位：200 個中盤局面、假時鐘量測，
      // 被嚴格驗證器證明會輸的選點 6 個，比 33e790b 的 5 個多，沒過留的判準，已還原（README「階梯校正紀錄／第十二批」）。
      if (ctx.vctUnknown) { if (!unknown) unknown = e; continue; }
      if (quiet) {
        // 最後一道關卡（強檔唯一的一道、最強第二段）把剩下的時間都給安靜棋檢查；最強第一段照每個候選 1/3，留時間給第二段
        var tq = now(ctx.cw.veto), qs = quietCheck(ctx, board, p, e.m, quiet, nodes, quietFull ? deadline : Math.min(deadline, tq + Math.max(40, (deadline - tq) / 3)));
        if (qs === 'bad') { if (!qBad) qBad = e; continue; }
        if (!first) first = e;                   // ε 的基準：第一個沒被判輸的
        if (qs === 'unknown') { qPend.push(e.m); continue; }
        passed.push(e.m);
        continue;
      }
      if (!first) first = e;
      passed.push(e.m);
    }
    // 安靜棋那關判輸的排在「第一關查不完的」之後（和原本「查不完的先於證明會輸的」同一個原則；安靜棋只試有限的應手，判輸不是證明）
    if (!passed.length && (qPend.length || (qBad && !unknown))) {
      return { pick: qPend.length ? randomPick(qPend) : qBad.m, passed: passed, pending: qPend, bad: bad };
    }
    // 沒有通過的：先用查不完的；再用時間到了還沒查的（值最高的那個）；都沒有才用已證明會輸的第一名
    if (!passed.length && !unknown) {
      for (k = i; k < ordered.length && !unknown; k++) if (!bad[ordered[k].m.r * SIZE + ordered[k].m.c]) unknown = ordered[k];
    }
    var pick = passed.length ? randomPick(passed) : (unknown || ordered[0]).m;
    return { pick: pick, passed: passed, pending: qPend, bad: bad };
  }

  // 第六批實驗：p 下 m 之後，對手 o 先下一手「安靜棋」（評分前 cfg.k 名、不是成四或成活三的著法），再有 VCT（cfg.threats 手內）嗎？
  // 安靜棋之後輪 p，所以 o 有 VCT 只是威脅：再試 p 的應手（o 的 VCT 手順上的點、p 的沖四點、p 評分前幾名，合計最多 cfg.replies 個），
  // 有一個應手之後 o 確定沒有 VCT 就算守得住。回傳 'ok'（每個安靜棋都守得住）、'bad'（有一個安靜棋，試過的應手全被 VCT）、
  // 'unknown'（時間或節點不夠）。只看有限的安靜棋與應手，所以 'bad' 不是證明，'ok' 也不是。
  function quietCheck(ctx, board, p, m, cfg, nodes, deadline) {
    var o = 3 - p, rule = ctx.rule, unknown = false, i, j;
    place(ctx, board, m.r, m.c, p);
    try {
      var qs = rankedMoves(board, o, rule).filter(function (x) { return !x.threat; }).slice(0, cfg.k);
      for (i = 0; i < qs.length; i++) {
        if (now(ctx.cw.quiet) > deadline) return 'unknown';
        var q = qs[i], res = null;
        place(ctx, board, q.r, q.c, o);
        try {
          var line = runVCT(ctx, board, o, cfg.threats, nodes, deadline);
          if (!line) { if (ctx.vctUnknown) unknown = true; continue; }
          // p 的應手
          var reps = [], seen = {};
          var add = function (x) {
            var key = x.r * SIZE + x.c;
            if (reps.length >= cfg.replies || seen[key] || board[x.r][x.c]) return;
            if (rule === 'renju' && p === 1 && isForbidden(board, x.r, x.c)) return;
            seen[key] = 1; reps.push({ r: x.r, c: x.c });
          };
          for (j = 0; j < line.length; j++) add(line[j]);
          var fm = fourMoves(board, p, rule);
          for (j = 0; j < fm.length; j++) add(fm[j]);
          var top = rankedMoves(board, p, rule);
          for (j = 0; j < top.length && reps.length < cfg.replies; j++) add(top[j]);
          var defended = false, repUnknown = false;
          for (j = 0; j < reps.length && !defended; j++) {
            if (now(ctx.cw.quiet) > deadline) { repUnknown = true; break; }
            var rp = reps[j], v, won = false;
            place(ctx, board, rp.r, rp.c, p);
            try {
              won = !!checkWin(board, rp.r, rp.c, rule);
              v = won ? null : runVCT(ctx, board, o, cfg.threats, nodes, deadline);
            } finally { unplace(ctx, board, rp.r, rp.c, p); }
            if (won || (!v && !ctx.vctUnknown)) defended = true;
            else if (!v) repUnknown = true;
          }
          if (!defended) res = repUnknown ? 'unknown' : 'bad';
        } finally { unplace(ctx, board, q.r, q.c, o); }
        if (res === 'bad') return 'bad';
        if (res === 'unknown') unknown = true;
      }
      return unknown ? 'unknown' : 'ok';
    } finally { unplace(ctx, board, m.r, m.c, p); }
  }

  // p 的候選點依點評分（攻＋0.9 守）由高到低；threat：下了會成四或活三／跳三（VCT 攻方著法產生器認得的威脅著），
  // 其餘是「安靜手」。連珠黑棋不含禁手點。board 會暫時改動、一定還原。
  function rankedMoves(board, p, rule) {
    var list = analyze(board, p, rule), am = attackMoves(board, p, rule), th = {}, i;
    for (i = 0; i < am.length; i++) th[am[i].r * SIZE + am[i].c] = true;
    list.sort(byScoreDesc);
    return list.map(function (x) { return { r: x.r, c: x.c, score: x.score, threat: !!th[x.r * SIZE + x.c] }; });
  }

  function hardMove(board, p, list, stones, rule, timeLimit, quiet, earlyStop, trace) {
    return strongMove(board, p, list, stones, rule, HARD, timeLimit, quiet, earlyStop, trace);
  }

  // params：最強用 EXPERT、天元用 TENGEN（省略時 EXPERT）
  function expertMove(board, p, list, stones, rule, timeLimit, quiet, earlyStop, trace, params) {
    return strongMove(board, p, list, stones, rule, params || EXPERT, timeLimit, quiet, earlyStop, trace);
  }

  // p 目前有沒有 VCF（假設輪到 p）。對手已有成五點時回傳 null。
  // opts = { rule, timeLimit ms（預設 2000）, maxPlies（雙方合計手數上限，預設 16；攻方 k 手的 VCF 要 2k−1） }
  function findVCF(board, player, opts) {
    opts = opts || {};
    var p = player === 2 ? 2 : 1, rule = opts.rule === 'renju' ? 'renju' : 'free';
    var b = [];
    for (var r = 0; r < SIZE; r++) b.push(board[r].slice());
    var own = allFivePoints(b, p, rule);
    if (own.length) return [own[0]];
    if (allFivePoints(b, 3 - p, rule).length) return null;
    // 第十九批：一步就做得出擋不完的四（活四等，照規則判）就回這一手（長度 1），不去找從沖四開始的長線；
    // 否則找到的線再縮成最短（shortestVCF，同一個時限）。
    var w4 = threatPoints(b, p, rule);
    if (w4.length) { var w = pickW4(b, p, w4, null, false); return [{ r: w.r, c: w.c }]; }
    var ctx = newCtx(b, rule, 0, EXPERT_WIDTH, true);
    ctx.vcfDeadline = now(ctx.cw.once) + (opts.timeLimit > 0 ? opts.timeLimit : 2000);
    var seq = shortestVCF(ctx, b, p, tryVCF(ctx, b, p, null, opts.maxPlies), 1);
    return seq ? seq.map(function (m) { return { r: m.r, c: m.c }; }) : null;
  }

  // p 目前有沒有 VCT（假設輪到 p）。opts = { rule, maxThreats（預設 5）, maxNodes（預設 20000）, timeLimit ms（預設 2000），
  //   report：物件（可省略），回傳 null 時會填 report.unknown＝是不是超過預算才停的（第七批起也包括「沖四拖延」，
  //   這時 report.delayed 是 true，見 VCT 檔頭）}。
  // 回傳 null（沒有，或超過預算未知）或 { move: {r,c}, line: [{r,c}…] }（line 沿守方第一個防點展開）。
  function findVCT(board, player, opts) {
    opts = opts || {};
    var p = player === 2 ? 2 : 1, rule = opts.rule === 'renju' ? 'renju' : 'free';
    var b = [];
    for (var r = 0; r < SIZE; r++) b.push(board[r].slice());
    var ctx = newCtx(b, rule, 0, EXPERT_WIDTH, true);
    var seq = runVCT(ctx, b, p,
      opts.maxThreats > 0 ? opts.maxThreats : 5,
      opts.maxNodes > 0 ? opts.maxNodes : 20000,
      now(ctx.cw.once) + (opts.timeLimit > 0 ? opts.timeLimit : 2000));
    if (opts.report) {
      opts.report.unknown = !seq && !!ctx.vctUnknown;
      opts.report.delayed = !seq && !!ctx.vctDelayed; // 第七批：unknown 是因為沖四拖延（見 VCT 檔頭），不是預算用完
    }
    if (!seq) return null;
    var line = seq.map(function (m) { return { r: m.r, c: m.c }; });
    return { move: line[0], line: line };
  }

  // v0.5.15（規格 AU 第二版）：擺棋盤研究的「誰能一路逼到贏」。假設輪到 p：先找連續沖四（findVCF，最多 opts.vcfMs，預設 1000 ms），
  // 沒找到再用剩下的時間找連續進攻（findVCT）；兩段合計最多 opts.timeLimit（預設 3000 ms）。
  // 回傳 { status: 'found' | 'none', kind: 'five'（一步就連成五）| 'vcf' | 'vct' | null, line: [{r,c}…]（p 先下、攻守輪流、補到成五）或 null,
  //   k: p 要下幾手（含成五那一手）, forbidBlock: true（line 裡有 { pass: true }＝守方黑棋要擋的點是禁手、擋不了；見 finishLine） }。'none' 只表示這段時間、這個深度內沒找到，不代表一定沒有（介面照實說）。不改動傳入的棋盤。
  function researchWin(board, player, opts) {
    opts = opts || {};
    var p = player === 2 ? 2 : 1, rule = opts.rule === 'renju' ? 'renju' : 'free';
    var total = opts.timeLimit > 0 ? opts.timeLimit : 3000, t0 = now(clockW(rule).once);
    var b = [];
    for (var r = 0; r < SIZE; r++) b.push(board[r].slice());
    function out(kind, line) {
      line = finishLine(b, p, line, rule);
      var o = { status: 'found', kind: kind, line: line, k: Math.ceil(line.length / 2) };
      if (line.some(function (m) { return m.pass; })) o.forbidBlock = true;
      return o;
    }
    var own = allFivePoints(b, p, rule);
    if (own.length) return out('five', [pt(own[0].r, own[0].c)]);
    var seq = findVCF(b, p, { rule: rule, timeLimit: Math.min(total, opts.vcfMs > 0 ? opts.vcfMs : 1000) });
    if (seq && seq.length) return out('vcf', completeLine(b, p, seq, true, rule));
    var left = total - (now(clockW(rule).once) - t0);
    if (left >= 50) {
      var v = findVCT(b, p, { rule: rule, timeLimit: left, maxThreats: opts.maxThreats > 0 ? opts.maxThreats : 8, maxNodes: opts.maxNodes > 0 ? opts.maxNodes : 2000000 });
      if (v && v.line && v.line.length) return out('vct', completeLine(b, p, v.line, true, rule));
    }
    return { status: 'none', kind: null, line: null, k: 0 };
  }

  // v0.5.15 複審（judge）：研究的路一定補到攻方連成五。連珠時守方（黑棋）要擋的成五點全是禁手＝擋不了：連續沖四、連續進攻都停在那個四，
  // completeLine 也補不下去（守方沒有能擋的點就停），路就少了最後連成五那一手、「N 步」少一步。這裡照 line 擺一次，攻方最後一手沒連成五、
  // 輪到守方黑棋、攻方的成五點全是黑棋的禁手時，補一格 { pass: true }（黑棋這一手擋不了；播放時不擺子、說明為什麼）和攻方連成五那一手。
  // v0.5.16：原本叫 researchFinish、只給研究用；改名 finishLine，所有畫給人看的路都接它：研究（researchWin）、教學（listThreats 的
  // vcf.line）、回頭看（analyzeOne 的 winningLine）。line 一律是攻方 p 先下。completeLine 本身不動；forcedWinAfter、winWithin（練習題的
  // 播放與出題工具，練習題有自己的補法 completeToFive）不接。只改回傳給介面的那份路，引擎選著法用不到。不改動 board
  function finishLine(board, p, line, rule) {
    var b = [], r, who = p, last = null;
    for (r = 0; r < SIZE; r++) b.push(board[r].slice());
    for (var i = 0; i < line.length; i++) {
      var m = line[i];
      if (m.pass) { who = 3 - who; continue; }
      if (!inside(m.r, m.c) || b[m.r][m.c]) return line;
      b[m.r][m.c] = who;
      last = { r: m.r, c: m.c, p: who };
      who = 3 - who;
    }
    if (!last || last.p !== p || checkWin(b, last.r, last.c, rule)) return line;
    if (rule !== 'renju' || who !== 1) return line;
    var fp = allFivePoints(b, p, rule);
    if (!fp.length) return line;
    for (i = 0; i < fp.length; i++) if (!isForbidden(b, fp[i].r, fp[i].c)) return line;
    return line.concat([{ pass: true }, pt(fp[0].r, fp[0].c)]);
  }

  // v0.5.15（規格 AU 第二版）：ai-worker.js 的 'research' 訊息。mover＝輪到的那一方。盤上已經有連成五（連珠黑棋只算剛好五）就不找，five＝誰連成五；
  // 否則先找 mover（opts.moverMs，預設 3000），mover 沒找到再找另一方「要是它先下」（opts.otherMs，預設 2000；0＝不找）。
  // 回傳 { mover, five: 0 | 1 | 2, sides: [{ p, status, kind, line, k }…]（見 researchWin） }
  function researchSearch(board, mover, rule, opts) {
    opts = opts || {};
    var p = mover === 2 ? 2 : 1, ru = rule === 'renju' ? 'renju' : 'free', res = { mover: p, five: 0, sides: [] };
    for (var r = 0; r < SIZE && !res.five; r++) {
      for (var c = 0; c < SIZE && !res.five; c++) {
        if (!board[r][c]) continue;
        var w = checkWin(board, r, c, ru);
        if (w) res.five = w.player || board[r][c];
      }
    }
    if (res.five) return res;
    function side(q, ms) { var x = researchWin(board, q, { rule: ru, timeLimit: ms }); x.p = q; return x; }
    res.sides.push(side(p, opts.moverMs > 0 ? opts.moverMs : 3000));
    var om = opts.otherMs === 0 ? 0 : opts.otherMs > 0 ? opts.otherMs : 2000;
    if (res.sides[0].status !== 'found' && om > 0) res.sides.push(side(3 - p, om));
    return res;
  }

  // ---------------------------------------------------------------- 入口

  // ---------------------------------------------------------------- 十一階階梯（J、H、L、P 段；第五批改十一階）
  //
  // 一階一行。engine：用哪一套下法（easy＝上面的 easyMove、weak＝weakMove、medium＝mediumMove、hard／expert＝strongMove）；
  // noise：誤差 σ（第二十三批，規格 AB；取代 block3 與 slip）——弱段加在點評分、中段加在根節點的搜尋值，只用在沒被規則決定的著法之間；
  // 階 8 為 0（＝改之前的中・4）；入門與強、最強不讀。book：前三手用開局庫（只有階 11；作者 2026-09-29 拍板，
  // 第四批的書譜機器人顯示強檔加開局庫可能變弱，所以中・4、強・1、強・2 都不用）；
  // time：每步時限 ms（只有強・1、強・2、最強有，可用 getMove 的 opts.timeLimit 覆寫）；
  // rating：AI 的固定積分（P 段），由最後一輪相鄰階互搏的高階勝率換算，見 README「AI 積分」。
  // 每行行尾註：最後一次相鄰階互搏（selfplay.js ladder，自由規則、每組 20 局、先後手各半、種子 5101、時限照本表，
  // 2026-09-29 第五批）這一階對低一階的高階勝率。目標 55%–80%；校正三輪後階 5 手滑 70%→80%、強・1 300→200 ms，
  // 4 對 5 仍在區間外（85%）。開局庫改成只給最強之後，7–8、8–9、9–10、10–11 用最終設定重跑一次，行尾是重跑的數字；
  // 第六批再把 8–9、9–10、10–11 各單獨跑 60 局（種子 6301），階 9–11 的行尾與積分用這一次的數字。
  // 第十九批（中檔加了「一步 W4 一定下」）把 4–5、5–6、6–7、7–8 各單獨跑 40 局（種子 1901）：階 6 手滑 45%→55%，
  // 階 5–8 的行尾是這一次的數字；4–5 仍在區間外（階 5 手滑 100% 也是 88%，見 README）。積分整條重算（階 9–11 的相鄰差不變、整段跟著位移）。
  // 第二十三批（規格 AB，難度階梯 v3）：手滑與擋三機率拿掉，弱段（階 2–4）與中段（階 5–8）改成「規則一定照做＋誤差 σ」；
  // 1–2…7–8 各跑 400 局（種子 6302；judge v3 F1 修正「對手有 W4 點就限定防點∪沖四點」之後重跑），階 1–8 的行尾是這一次的數字；積分改以階 8＝1799 為錨往下推，階 8–11 不變。
  // v0.5.13（規格 AF）：入門拆成入門・1（階 1）、入門・2（階 13，接在最後、不重編號）；1–13、13–2 各跑 400 局（種子 6302），階 13 與階 2 的行尾是這一次的數字。
  // 詳見 README「階梯校正紀錄」。
  // quiet：第六批實驗「否決關卡多看一手安靜棋」的開關（見 QUIET、quietCheck）；實驗沒過留的判準，目前沒有一階開。
  var TIERS = [
    { tier: 1, zh: '入門・1', en: 'Novice 1', engine: 'easy', book: false, rating: 634 }, // v0.5.13（規格 AF）：名稱「入門」→「入門・1」，下法不變；積分改接在入門・2 下面（528→634）
    { tier: 2, zh: '弱・1', en: 'Easy 1', engine: 'weak', noise: 8000, book: false, rating: 1039 },          // 對階 13（入門・2）：75%（301:99，400 局；v0.5.13）。對階 1 是 95%（380:20）
    { tier: 3, zh: '弱・2', en: 'Easy 2', engine: 'weak', noise: 4000, book: false, rating: 1214 },          // 對階 2：73%（293:101，和 6，400 局）
    { tier: 4, zh: '弱・3', en: 'Easy 3', engine: 'weak', noise: 2000, book: false, rating: 1309 },          // 對階 3：63%（253:109，和 38，400 局）
    { tier: 5, zh: '中・1', en: 'Medium 1', engine: 'medium', noise: 1000000, book: false, rating: 1426 },   // 對階 4：66%（265:110，和 25，400 局）
    { tier: 6, zh: '中・2', en: 'Medium 2', engine: 'medium', noise: 12000, book: false, rating: 1559 },     // 對階 5：68%（273:119，和 8，400 局）
    { tier: 7, zh: '中・3', en: 'Medium 3', engine: 'medium', noise: 4000, book: false, rating: 1670 },      // 對階 6：66%（262:133，和 5，400 局）
    { tier: 8, zh: '中・4', en: 'Medium 4', engine: 'medium', noise: 0, book: false, rating: 1799 },         // 對階 7：68%（271:124，和 5，400 局）；積分的錨
    { tier: 9, zh: '強・1', en: 'Hard 1', engine: 'hard', book: false, time: 200, rating: 1907 },  // 對階 8：65%（39:21）
    { tier: 10, zh: '強・2', en: 'Hard 2', engine: 'hard', book: false, time: HARD.time, rating: 2002 },   // 對階 9：63%（38:18，和 4）
    { tier: 11, zh: '最強', en: 'Expert', engine: 'expert', book: true, time: EXPERT.time, rating: 2109 }, // 對階 10：65%（39:20，和 1）
    // 天元（規格 AC／AE／AI）：engine 同最強（介面的 noHintTier 對階 11、12 都不給提示），參數用 TENGEN（見 getMove）。
    // 積分 2158（規格 AN，暫定）＝最強＋49：12 對 11 共 100 盤贏 57、輸 33、和 10（README「開局庫（規格 AI）」的補跑結果），
    // 照既有算法和棋不算勝：p＝57／100，400 × log10(0.57 ÷ 0.43)＝+48.96，接在最強未取整的 2108.98 後面＝2157.94 → 2158。
    { tier: 12, zh: '天元', en: 'Tengen', engine: 'expert', book: true, time: TENGEN.time, rating: 2158 },
    // v0.5.13（規格 AF）：入門・2。階號用新的 13（不重編號）：1–12 存在設定、紀錄、接著下的存檔、匯出檔裡的意思一個都不變；
    // 選單與階梯的先後看 TIER_ORDER（入門・1 → 入門・2 → 弱・1）。engine novice2（見 novice2Move）。
    // 積分照既有算法（和棋不算勝、以中・4 為錨往下推，先累加不取整）：弱・1 未取整 1039.26 − d(13→2)（75%，301:99）＝846.08 → 846；
    // 入門・1 ＝ 846.08 − d(1→13)（77%，309:91）＝633.72 → 634。弱・1 以上一階都不動。
    { tier: 13, zh: '入門・2', en: 'Novice 2', engine: 'novice2', noise: 2200, defw: 0.85, book: false, rating: 846 } // 對階 1：77%（309:91，400 局）
  ];
  var TIER_COUNT = TIERS.length;
  // v0.5.13（規格 AF）：由弱到強的先後（選單、階梯互搏、推薦、提示門檻都照這個比，不直接比階號）。
  var TIER_ORDER = [1, 13, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  // 階號 → 先後（0 起算）；認不得的回傳 -1
  function tierRank(tier) { return TIER_ORDER.indexOf(tier); }

  // 舊的檔次字串 → 階
  var LEVEL_ALIAS = { novice: 1, easy: 3, medium: 8, hard: 10, expert: 11 };
  var DEFAULT_TIER = 8; // 認不得的 level 當「中・4」（舊版的預設 medium）

  // level：1–12 的數字、'1'–'12'、{ tier: 1–12 }，或舊字串 novice／easy／medium／hard／expert。認不得的當階 8。
  // 注意：數字一律當新的階數（十一階加天元）；第四批（九階）存下來的數字要先過 migrateTier。
  function tierOf(level) {
    if (level && typeof level === 'object') level = level.tier;
    if (typeof level === 'string') {
      if (Object.prototype.hasOwnProperty.call(LEVEL_ALIAS, level)) return LEVEL_ALIAS[level];
      if (/^(?:[1-9]|1[0-3])$/.test(level)) return +level; // v0.5.13（規格 AF）：多了 13（入門・2）
      return DEFAULT_TIER;
    }
    if (typeof level === 'number' && level >= 1 && level <= TIER_COUNT && Math.floor(level) === level) return level;
    return DEFAULT_TIER;
  }

  // 第四批九階的階數 → 十一階。1–6 不變（名稱與機制一樣；中・1、中・2 的手滑率改了）、
  // 7 中・3（手滑 0）→ 8 中・4、8 強 → 10 強・2、9 最強 → 11（第四批的 7、8 有開局庫，十一階的 8、10 沒有）。
  // 也收 '1'–'9'、{ tier } 與舊字串（舊字串照 tierOf）；認不得的當階 8。
  var MIGRATE_9_TO_11 = [0, 1, 2, 3, 4, 5, 6, 8, 10, 11];
  function migrateTier(old9) {
    if (old9 && typeof old9 === 'object') old9 = old9.tier;
    if (typeof old9 === 'string' && /^[1-9]$/.test(old9)) old9 = +old9;
    if (typeof old9 === 'number' && old9 >= 1 && old9 <= 9 && Math.floor(old9) === old9) return MIGRATE_9_TO_11[old9];
    if (typeof old9 === 'string' && Object.prototype.hasOwnProperty.call(LEVEL_ALIAS, old9)) return LEVEL_ALIAS[old9];
    return DEFAULT_TIER;
  }

  // 顯示名。lang 以 'en' 開頭給英文，其餘給繁體中文。
  function tierName(tier, lang) {
    var t = TIERS[tierOf(tier) - 1];
    return (typeof lang === 'string' && lang.slice(0, 2) === 'en') ? t.en : t.zh;
  }

  // ---------------------------------------------------------------- 開局庫（M 段）
  //
  // 資料：data/openings.js（26 種連珠開局，黑第一手天元，白第二手直止 (6,7) 或斜止 (6,8)，黑第三手）。
  // 以天元為中心的 8 種對稱：k 的 1 位元左右翻、2 位元上下翻、4 位元轉置（和 bookbot.js 同一套）。

  var openingCache = null;
  function openingList() {
    if (openingCache) return openingCache;
    var d = root && root.GomokuOpenings;
    if (!d && typeof require === 'function' && typeof module === 'object' && module && module.exports) {
      try { d = require('./data/openings.js'); } catch (e) { d = null; }
    }
    if (d && d.openings && d.openings.length) openingCache = d.openings;
    return openingCache;
  }

  function symPoint(k, r, c) {
    var dr = r - CENTER, dc = c - CENTER, t;
    if (k & 1) dc = -dc;
    if (k & 2) dr = -dr;
    if (k & 4) { t = dr; dr = dc; dc = t; }
    return { r: dr + CENTER, c: dc + CENTER };
  }

  // 前三手（moves：[{r,c}…]，黑先）若是 26 種開局之一（含 8 種對稱）→ { code, name }，否則 null。
  // 黑第一手必須在天元；只看前三手，後面的手不管。
  function detectOpening(moves) {
    var hit = detectOpeningSym(moves);
    return hit ? { code: hit.code, name: hit.name } : null;
  }
  // v0.5.18（規格 AQ）：同 detectOpening，多回傳這盤的方向 sym：symPoint(sym, 這盤的點)＝data/openings.js 標準方向的點，
  // 反過來 symPointInv(sym, 標準方向的點)＝這盤的點（開局介紹的小棋盤照這盤的方向畫）。開局本身左右對稱時有好幾個 sym 都對，回傳第一個（畫出來一樣）
  function detectOpeningSym(moves) {
    var list = openingList();
    if (!list || !moves || moves.length < 3) return null;
    var a = moves[0], w = moves[1], x = moves[2];
    if (!a || !w || !x || a.r !== CENTER || a.c !== CENTER) return null;
    for (var k = 0; k < 8; k++) {
      var w2 = symPoint(k, w.r, w.c), x2 = symPoint(k, x.r, x.c);
      for (var i = 0; i < list.length; i++) {
        var o = list[i].moves;
        if (o[1].r === w2.r && o[1].c === w2.c && o[2].r === x2.r && o[2].c === x2.c) return { code: list[i].code, name: list[i].name, sym: k };
      }
    }
    return null;
  }
  // v0.5.18（規格 AQ）：symPoint 的反運算（先轉置、再上下翻、再左右翻）：symPointInv(k, symPoint(k, r, c))＝{ r, c }
  function symPointInv(k, r, c) {
    var dr = r - CENTER, dc = c - CENTER, t;
    if (k & 4) { t = dr; dr = dc; dc = t; }
    if (k & 2) dr = -dr;
    if (k & 1) dc = -dc;
    return { r: dr + CENTER, c: dc + CENTER };
  }

  // 階 11（最強）與階 12（天元，同一份開局庫；天元專用開局表是規格 AE 步驟 3）的前三手。白（盤上只有天元一子）：天元周圍 8 點均勻隨機（直止 4 點、斜止 4 點＝兩種各含對稱）。
  // 黑（盤上是天元＋白一子、白子緊鄰天元）：同一種止法裡評價「黑必勝」或「黑優勢」的開局隨機一種，
  // 再從把標準白子位置對到實際白子的對稱（2 種）裡隨機一種。其餘情形回傳 null（照一般流程）。
  function openingBookMove(b, p, stones) {
    var list = openingList();
    if (!list || b[CENTER][CENTER] !== 1) return null;
    var dr, dc, ring = [];
    if (stones === 1 && p === 2) {
      for (dr = -1; dr <= 1; dr++) for (dc = -1; dc <= 1; dc++) if (dr || dc) ring.push({ r: CENTER + dr, c: CENTER + dc });
      return randomPick(ring);
    }
    if (stones !== 2 || p !== 1) return null;
    var w = null;
    for (dr = -1; dr <= 1; dr++) for (dc = -1; dc <= 1; dc++) if (b[CENTER + dr][CENTER + dc] === 2) w = { r: CENTER + dr, c: CENTER + dc };
    if (!w) return null;
    var type = (w.r === CENTER || w.c === CENTER) ? 'direct' : 'indirect';
    var pool = list.filter(function (o) { return o.type === type && (o.evalKey === 'black-win' || o.evalKey === 'black-adv'); });
    if (!pool.length) return null;
    var ks = [];
    for (var k = 0; k < 8; k++) {
      var s = symPoint(k, pool[0].moves[1].r, pool[0].moves[1].c);
      if (s.r === w.r && s.c === w.c) ks.push(k);
    }
    var o = randomPick(pool), m = symPoint(randomPick(ks), o.moves[2].r, o.moves[2].c);
    return b[m.r][m.c] ? null : m;
  }

  // ---------------------------------------------------------------- 天元開局庫（規格 AI）
  //
  // 資料：data/tengen-book.js（tools/make-tengen-book.js 用 Rapfi 離線算；瀏覽器／Worker 掛在 self.GomokuTengenBook，node 用 require）。
  // 只有天元（階 12）用：輪天元走、盤上 1～(maxMove−1) 子、局面在庫裡（含以天元為中心的 8 種對稱）就照庫下，不思考；
  // 查不到（含資料檔沒載入）照原本的流程（含上面最強那份前三手的開局庫）。
  // 每條 "鍵:著法:勝率"：鍵＝黑子座標排序接白子座標排序（每個座標兩個字母 a–o：列、行），8 種對稱（symPoint）裡字串最小的；
  // 著法＝正規化局面上的並列最佳手（每手兩個字母）。
  var tengenRaw = null;     // 找到的資料（格式對才記住；沒找到下次再找，同 openingList）
  var tengenForced;         // setTengenBook 設的：undefined＝照常載入；null＝當作沒有資料；物件＝用這一份
  var tengenMaps = null;    // { free: {鍵: 著法字串}, renju: {…} }
  var SYM_INV = [];         // 對稱 k 的反運算
  (function () {
    for (var k = 0; k < 8; k++) for (var j = 0; j < 8; j++) {
      var a = symPoint(k, 8, 10), z = symPoint(j, a.r, a.c);
      if (z.r === 8 && z.c === 10) { SYM_INV[k] = j; break; }
    }
  })();
  function tengenData() {
    if (tengenForced !== undefined) return tengenForced;
    if (tengenRaw) return tengenRaw;
    var d = root && root.GomokuTengenBook;
    if (!d && typeof require === 'function' && typeof module === 'object' && module && module.exports) {
      try { d = require('./data/tengen-book.js'); } catch (e) { d = null; }
    }
    if (d && d.format === 1 && typeof d.free === 'string' && typeof d.renju === 'string') tengenRaw = d;
    return tengenRaw;
  }
  function tengenMap(rule) {
    var d = tengenData();
    if (!d) return null;
    if (!tengenMaps) {
      tengenMaps = {};
      ['free', 'renju'].forEach(function (ru) {
        var m = Object.create(null);
        d[ru].split(' ').forEach(function (e) {
          var f = e.split(':');
          if (f.length >= 2 && f[1]) m[f[0]] = f[1];
        });
        tengenMaps[ru] = m;
      });
    }
    return tengenMaps[rule === 'renju' ? 'renju' : 'free'];
  }
  // 測試用：d＝資料物件（換一份）、null（當作沒有資料檔）、undefined（還原成照常載入）
  function setTengenBook(d) { tengenForced = d === undefined ? undefined : d && d.format === 1 ? d : null; tengenMaps = null; }
  function sqCode(r, c) { return String.fromCharCode(97 + r, 97 + c); }
  // 輪 p 走的局面在庫裡的著法（已換回原局面的座標、去掉不合法的），沒有就 null。stones＝盤上子數。
  function tengenBookMoves(b, p, rule, stones) {
    var d = tengenData();
    if (!d || stones < 1 || stones > (d.maxMove || 8) - 1) return null;
    if (p !== (stones % 2 === 0 ? 1 : 2)) return null;
    var map = tengenMap(rule), bl = [], wh = [], r, c, k;
    for (r = 0; r < SIZE; r++) for (c = 0; c < SIZE; c++) {
      if (b[r][c] === 1) bl.push(r * SIZE + c); else if (b[r][c] === 2) wh.push(r * SIZE + c);
    }
    if (bl.length !== ((stones + 1) >> 1) || wh.length !== (stones >> 1)) return null;
    function part(k, list) {
      var out = [];
      for (var i = 0; i < list.length; i++) { var s = symPoint(k, (list[i] / SIZE) | 0, list[i] % SIZE); out.push(sqCode(s.r, s.c)); }
      return out.sort().join('');
    }
    var best = null, bk = 0;
    for (k = 0; k < 8; k++) {
      var key = part(k, bl) + part(k, wh);
      if (best === null || key < best) { best = key; bk = k; }
    }
    var mv = map[best];
    if (!mv) return null;
    var out = [];
    for (var i = 0; i + 1 < mv.length; i += 2) {
      var m = symPoint(SYM_INV[bk], mv.charCodeAt(i) - 97, mv.charCodeAt(i + 1) - 97);
      if (!inside(m.r, m.c) || b[m.r][m.c]) continue;
      if (rule === 'renju' && p === 1 && isForbidden(b, m.r, m.c)) continue;
      out.push(m);
    }
    return out.length ? out : null;
  }

  // level：見 tierOf；opts = { rule: 'free' | 'renju', timeLimit: 毫秒（只影響階 9–12；省略時用 TIERS 的 time）, trace: 物件（可省略，會填 reason），
  //   earlyStop: false 時關掉規格 T1 的提早收手（省略時照 _internal.EARLY_STOP.enabled） }
  // 階 9–12 走到搜尋時 trace 另填 layers、nodes、earlyStop、deepen（見 strongMove）。
  // trace.reason：'center' 空盤天元、'book' 開局庫、'tengen-book' 天元開局庫（只有階 12）、'forced' 成五／擋五、'w4' 一步 W4、'block3' 擋活三／跳三（弱、中）、
  //   'random' 入門前 5 名隨機、'noise' 弱與中・1～3 加誤差選的、'search' 中・4 搜尋、'strong' 強／最強流程。
  function getMove(board, player, level, opts) {
    opts = opts || {};
    var rule = opts.rule === 'renju' ? 'renju' : 'free';
    var p = player === 2 ? 2 : 1;
    var cfg = TIERS[tierOf(level) - 1], trace = opts.trace || null;
    if (trace) trace.reason = '';
    var b = [], stones = 0;
    for (var r = 0; r < SIZE; r++) {
      b.push(board[r].slice());
      for (var c = 0; c < SIZE; c++) if (board[r][c]) stones++;
    }
    if (stones === 0) { note(trace, 'center'); return { r: CENTER, c: CENTER }; }
    if (cfg.tier === 12) { // 天元開局庫（規格 AI）：只有天元查；並列的幾手用 Math.random 均勻挑一個（只有一手時不擲骰）
      var tb = tengenBookMoves(b, p, rule, stones);
      if (tb) { note(trace, 'tengen-book'); return tb.length > 1 ? randomPick(tb) : tb[0]; }
    }
    if (cfg.book && stones <= 2) {
      var bm = openingBookMove(b, p, stones);
      if (bm) { note(trace, 'book'); return bm; }
    }
    // 天元步驟 2：在自己複製的棋盤 b 上掛增量型態快取，離開時拿掉（見「增量型態快取」）
    var savedSC = SC;
    if (cacheEnabled) SC = makeCache(b);
    try {
      var list = analyze(b, p, rule);
      if (!list.length && rule === 'renju' && p === 1) list = legalFallback(b);
      if (!list.length) return null; // 盤面已滿（或黑棋無處可下）
      var m;
      var early = opts.earlyStop == null ? EARLY_STOP.enabled : opts.earlyStop !== false; // 規格 T1 開關
      if (cfg.engine === 'easy') m = easyMove(b, p, list, trace);
      else if (cfg.engine === 'weak') m = weakMove(b, p, list, rule, cfg.noise || 0, trace);
      else if (cfg.engine === 'novice2') m = novice2Move(b, p, list, rule, cfg.noise || 0, cfg.defw || 0, trace); // v0.5.13（規格 AF）
      else if (cfg.engine === 'hard') { note(trace, 'strong'); m = hardMove(b, p, list, stones, rule, opts.timeLimit > 0 ? opts.timeLimit : cfg.time, cfg.quiet ? QUIET : null, early, trace); }
      else if (cfg.engine === 'expert') {
        note(trace, 'strong');
        m = expertMove(b, p, list, stones, rule, opts.timeLimit > 0 ? opts.timeLimit : cfg.time, cfg.quiet ? QUIET : null, early, trace,
          cfg.tier === 12 ? TENGEN : EXPERT); // 天元用自己的參數
      }
      else m = mediumMove(b, p, list, rule, cfg.noise || 0, trace);
      return { r: m.r, c: m.c };
    } finally { SC = savedSC; }
  }

  // ---------------------------------------------------------------- 威脅清單（B 段威脅提醒、A 段威脅標記）

  // (r,c) 上已有 p：沿 (dr,dc) 前後 4 格內，p 再下一子就讓經過 (r,c) 的連線成五的位移（連珠黑棋要恰好五）。
  function lineFives(board, r, c, dr, dc, p, rule) {
    var out = [], exact = rule === 'renju' && p === 1;
    for (var k = -4; k <= 4; k++) {
      if (!k) continue;
      var qr = r + dr * k, qc = c + dc * k;
      if (!inside(qr, qc) || board[qr][qc]) continue;
      board[qr][qc] = p;
      var n = runLen(board, r, c, dr, dc, p);
      board[qr][qc] = 0;
      if (exact ? n === 5 : n >= 5) out.push(k);
    }
    return out;
  }

  // 位移清單裡有沒有相差 5 的一對（兩端都能成五＝活四），有就回傳較小的那個，否則 null
  function straightPair(F) {
    for (var i = 0; i < F.length; i++) if (F.indexOf(F[i] + 5) >= 0) return F[i];
    return null;
  }

  function pt(r, c) { return { r: r, c: c }; }

  // p 在這個局面上的威脅（不管輪到誰；vcf 一項假設輪到 p）。opts = { vcfMs：VCF 時限，預設 200，0 表示不查 }。
  // 回傳：
  //   fours：p 再下一子就成五的點（對手必擋點）[{r,c}]
  //   openFours：活四 [{ points: [兩個成五點], stones: [四子] }]
  //   threes：活三與跳三 [{ points: [p 下了成活四的點], stones: [三子] }]（同一條線上同一組三子只算一個）
  //   fourThree／doubleFour／doubleThree：p 下一手就成四三／雙四／雙三的點 [{r,c}]（候選用 VCT 的攻方著法產生器；
  //     下了就成五的點不列（在 fours）；連珠黑棋的禁手點不列；雙四、雙三對連珠黑棋本來就是禁手，所以一定是空的）
  //   vcf：{ move, line } 或 null（line 補到成五；v0.5.16 起連珠黑棋擋不了時中間有一格 { pass: true }，見 finishLine）；vcfStatus：'found' | 'none' | 'unknown'（時限內沒算完）| 'skipped'（vcfMs 為 0）
  //     對手已經有成五點時（p 得先擋）不查，記 'none'。
  function listThreats(board, player, rule, opts) {
    opts = opts || {};
    var p = player === 2 ? 2 : 1;
    rule = rule === 'renju' ? 'renju' : 'free';
    var renjuBlack = rule === 'renju' && p === 1;
    var b = [], r, c, d, k, i;
    for (r = 0; r < SIZE; r++) b.push(board[r].slice());
    var res = { fours: [], openFours: [], threes: [], fourThree: [], doubleFour: [], doubleThree: [], vcf: null, vcfStatus: 'skipped' };

    // 四、活四
    res.fours = allFivePoints(b, p, rule).map(function (m) { return pt(m.r, m.c); });
    var seenOpen = {};
    for (i = 0; i < res.fours.length; i++) {
      var f = res.fours[i];
      for (d = 0; d < 4; d++) {
        var dr = DIRS[d][0], dc = DIRS[d][1], ok = true, st = [];
        for (k = 1; k <= 4 && ok; k++) {
          if (!inside(f.r + dr * k, f.c + dc * k) || b[f.r + dr * k][f.c + dc * k] !== p) ok = false;
          else st.push(pt(f.r + dr * k, f.c + dc * k));
        }
        if (!ok || !isFivePoint(b, f.r + dr * 5, f.c + dc * 5, p, rule)) continue;
        var ko = d + ':' + st[0].r + ',' + st[0].c;
        if (seenOpen[ko]) continue;
        seenOpen[ko] = 1;
        res.openFours.push({ points: [pt(f.r, f.c), pt(f.r + dr * 5, f.c + dc * 5)], stones: st });
      }
    }

    // 活三、跳三：空點 q 在某方向下了成活四（兩端都能成五）；三子＝活四的四子去掉 q
    var idxs = candidates(b), groups = {}, forb = {};
    function forbiddenAt(qr, qc) {
      var key = qr * SIZE + qc;
      if (forb[key] === undefined) forb[key] = !!isForbidden(b, qr, qc);
      return forb[key];
    }
    for (i = 0; i < idxs.length; i++) {
      r = (idxs[i] / SIZE) | 0; c = idxs[i] % SIZE;
      for (d = 0; d < 4; d++) {
        var ddr = DIRS[d][0], ddc = DIRS[d][1];
        if (shapeAt(b, r, c, p, ddr, ddc) !== LIVE4) continue;
        if (renjuBlack && forbiddenAt(r, c)) break;
        b[r][c] = p;
        var k0 = straightPair(lineFives(b, r, c, ddr, ddc, p, rule));
        b[r][c] = 0;
        if (k0 === null) continue;
        var stones = [];
        for (k = k0 + 1; k < k0 + 5; k++) if (k) stones.push(pt(r + ddr * k, c + ddc * k));
        var key = d + ':' + stones.map(function (s) { return s.r * SIZE + s.c; }).sort(function (x, y) { return x - y; }).join(',');
        if (!groups[key]) { groups[key] = { points: [], stones: stones }; res.threes.push(groups[key]); }
        groups[key].points.push(pt(r, c));
      }
    }

    // 四三、雙四、雙三點。下了就成五的點（p 已經有四時的成五點）跳過：它已列在 fours，
    // 而且線上已連五時 lineFives 會把線上每個空點都算成成五點，誤判成雙四。
    var am = attackMoves(b, p, rule);
    for (i = 0; i < am.length; i++) {
      var m = am[i], fourDirs = 0, fives = 0, straight = false, threeDirs = 0;
      if (isFivePoint(b, m.r, m.c, p, rule)) continue;
      b[m.r][m.c] = p;
      for (d = 0; d < 4; d++) {
        var er = DIRS[d][0], ec = DIRS[d][1], F = lineFives(b, m.r, m.c, er, ec, p, rule);
        if (F.length) { fourDirs++; fives += F.length; if (straightPair(F) !== null) straight = true; continue; }
        for (k = -4; k <= 4; k++) {
          var qr = m.r + er * k, qc = m.c + ec * k;
          if (!k || !inside(qr, qc) || b[qr][qc]) continue;
          if (renjuBlack && isForbidden(b, qr, qc)) continue;
          b[qr][qc] = p;
          var s3 = straightPair(lineFives(b, m.r, m.c, er, ec, p, rule)) !== null;
          b[qr][qc] = 0;
          if (s3) { threeDirs++; break; }
        }
      }
      b[m.r][m.c] = 0;
      if (straight) continue; // 下了就是活四：算在 threes 裡
      if (fourDirs >= 2 || (fourDirs === 1 && fives >= 2)) res.doubleFour.push(pt(m.r, m.c));
      else if (fourDirs === 1 && threeDirs >= 1) res.fourThree.push(pt(m.r, m.c));
      else if (!fourDirs && threeDirs >= 2) res.doubleThree.push(pt(m.r, m.c));
    }

    // VCF
    var vcfMs = opts.vcfMs === undefined ? 200 : +opts.vcfMs;
    if (vcfMs > 0) {
      if (res.fours.length) {
        res.vcf = { move: res.fours[0], line: [res.fours[0]] };
        res.vcfStatus = 'found';
      } else if (allFivePoints(b, 3 - p, rule).length) {
        res.vcfStatus = 'none';
      } else {
        var ctx = newCtx(b, rule, 0, EXPERT_WIDTH, true);
        ctx.vcfDeadline = now(ctx.cw.once) + vcfMs;
        try {
          // 第十九批：和 findVCF 同樣的前置（一步 W4 就指它）與最短線；縮短途中時間到就用已找到的那條。
          var w4 = threatPoints(b, p, rule);
          var seq = w4.length ? [pickW4(b, p, w4, null, false)] : shortestVCF(ctx, b, p, vcf(ctx, b, p, VCF_PLIES, null), 1);
          if (seq) {
            // v0.5.16：教學播放的路也補到成五（連珠黑棋擋不了時中間一格 { pass: true }，見 finishLine）；move 照舊是第一手
            var line = finishLine(b, p, completeLine(b, p, seq, true, rule), rule);
            res.vcf = { move: line[0], line: line };
          }
          res.vcfStatus = seq ? 'found' : 'none';
        } catch (e) {
          if (e !== TIMEOUT) throw e;
          res.vcfStatus = 'unknown';
        }
      }
    }
    return res;
  }

  // 必勝手順補到成五：line 是 att 的必勝手順（attFirst：第一手是不是 att 下的）。照手順下完後，
  // 若還沒成五（例如搜尋在雙三、雙四、活四就停），就往下補（最多 10 手）：攻方有成五點就下，沒有就下 W4 點（成活四／雙四）；
  // 守方擋一個成五點，沒有成五點就佔一個攻方的 W4 點。守方沒有能擋的點（連珠黑棋的擋點都是禁手）
  // 或補不下去時，就停在那裡。回傳新陣列 [{r,c}]，不改動 board。
  function completeLine(board, att, line, attFirst, rule) {
    var b = [], r, i, out = [], who = attFirst ? att : 3 - att, last = null;
    for (r = 0; r < SIZE; r++) b.push(board[r].slice());
    for (i = 0; i < line.length; i++) {
      var m = line[i];
      if (!inside(m.r, m.c) || b[m.r][m.c]) return line.map(function (x) { return pt(x.r, x.c); });
      b[m.r][m.c] = who;
      out.push(pt(m.r, m.c));
      last = { r: m.r, c: m.c, p: who };
      who = 3 - who;
    }
    for (var n = 0; n < 10; n++) {
      if (last && last.p === att && checkWin(b, last.r, last.c, rule)) break;
      var fp = allFivePoints(b, att, rule);
      if (!fp.length) fp = threatPoints(b, att, rule);
      if (!fp.length) break;
      var mv = null;
      if (who === att) mv = fp[0];
      else {
        for (i = 0; i < fp.length && !mv; i++) if (!(rule === 'renju' && who === 1 && isForbidden(b, fp[i].r, fp[i].c))) mv = fp[i];
        if (!mv) break;
      }
      b[mv.r][mv.c] = who;
      out.push(pt(mv.r, mv.c));
      last = { r: mv.r, c: mv.c, p: who };
      who = 3 - who;
    }
    return out;
  }

  // 輪到 p 的「對手」、而 p 剛下完：p 是不是已經必勝（對手怎麼應都擋不住，威脅 maxThreats 手內，含 VCF）。
  // 回傳 { status: 'win' | 'none' | 'unknown', line }；line 從對手的應手開始，已補到成五。
  // 「none」只表示在這個威脅深度內證明不了，不代表沒有。opts = { rule, maxThreats（預設 6）, maxNodes（預設 20 萬）, timeLimit（預設 2000） }
  // 第七批：對手靠沖四拖延才「擋得住」時（見 VCT 檔頭）回 'unknown'，不回 'none'。
  function runVCTAfter(ctx, board, p, maxThreats, maxNodes, deadline) {
    var saved = ctx.vcfDeadline;
    ctx.vctNodeLimit = ctx.vctNodes + maxNodes;
    ctx.vctDeadline = deadline;
    ctx.vcfDeadline = deadline;
    ctx.vctUnknown = false;
    ctx.vctDelayed = false;
    try {
      for (var t = 0; t < maxThreats; t++) {
        var r = vctD(ctx, board, p, t, 0, false);
        if (r) return r;
      }
      if (ctx.vctTaint) ctx.vctDelayed = ctx.vctUnknown = true;
      return null;
    } catch (e) {
      if (e !== TIMEOUT && e !== VCT_BUDGET) throw e;
      ctx.vctUnknown = true;
      return null;
    } finally {
      ctx.vcfDeadline = saved;
    }
  }

  // 給測試與工具：player 的候選點依評分排好 [{ r, c, score, threat }]（見 rankedMoves）。不改動傳入的棋盤。
  function rankMoves(board, player, rule) {
    var b = [];
    for (var r = 0; r < SIZE; r++) b.push(board[r].slice());
    return rankedMoves(b, player === 2 ? 2 : 1, rule === 'renju' ? 'renju' : 'free');
  }

  function forcedWinAfter(board, player, opts) {
    opts = opts || {};
    var p = player === 2 ? 2 : 1, rule = opts.rule === 'renju' ? 'renju' : 'free';
    var b = [];
    for (var r = 0; r < SIZE; r++) b.push(board[r].slice());
    var ctx = newCtx(b, rule, 0, EXPERT_WIDTH, true);
    var line = runVCTAfter(ctx, b, p,
      opts.maxThreats > 0 ? opts.maxThreats : 6,
      opts.maxNodes > 0 ? opts.maxNodes : 200000,
      now(ctx.cw.once) + (opts.timeLimit > 0 ? opts.timeLimit : 2000));
    if (line) return { status: 'win', line: completeLine(b, p, line, false, rule) };
    return { status: ctx.vctUnknown ? 'unknown' : 'none', line: null };
  }

  // ---------------------------------------------------------------- N 手內必勝（O 段詰棋）
  //
  // 輪到攻方 p：p 能不能在自己的 n 手內（含成五那一手）一定成五，不管守方怎麼應。
  // 攻方只走威脅著：成四的（剩 ≥ 2 手才有用）、成活三／跳三的（剩 ≥ 3 手才有用：三、成活四、成五）；
  // 守方有一個四要擋（連珠黑棋擋點是禁手就擋不了），沒有四時試全部防點（defenseSet）＋自己的反四
  // （反四逼攻方擋，攻方的手數少一手）。攻方沒有威脅時算「證明不了」（和 VCT 一樣保守：不走安靜手）。
  // 手數算法：雙四之後守方擋一個、攻方成五＝2 手；四三＝沖四、成活四、成五＝3 手。

  var WW_BUDGET = { wwBudget: true };

  function wwTick(ctx) {
    if (++ctx.wwNodes > ctx.wwLimit) throw WW_BUDGET;
    if ((ctx.wwNodes & 15) === 0 && now(ctx.cw.ww) > ctx.wwDeadline) throw WW_BUDGET;
  }

  function wwGet(ctx, side, n) {
    var e = ctx.wwt.get(ttKey(ctx, side));
    return e ? e[n] : undefined;
  }

  function wwPut(ctx, side, n, v) {
    var k = ttKey(ctx, side), e = ctx.wwt.get(k);
    if (!e) { e = []; ctx.wwt.set(k, e); }
    e[n] = v;
  }

  // 攻方 p 走、還剩 n 手。回傳手順（到成五）或 null。
  function wwA(ctx, b, p, n) {
    wwTick(ctx);
    var o = 3 - p, rule = ctx.rule, i;
    var own = allFivePoints(b, p, rule);
    if (own.length) return [own[0]];
    if (n <= 1) return null;
    var hit = wwGet(ctx, p, n);
    if (hit !== undefined) return hit;
    var res = null, theirs = allFivePoints(b, o, rule);
    if (theirs.length === 1) {
      var f = theirs[0];
      if (!(rule === 'renju' && p === 1 && isForbidden(b, f.r, f.c))) {
        place(ctx, b, f.r, f.c, p);
        try {
          var s1 = wwD(ctx, b, p, n - 1);
          if (s1) res = [f].concat(s1);
        } finally { unplace(ctx, b, f.r, f.c, p); }
      }
    } else if (!theirs.length) {
      var moves = attackMoves(b, p, rule);
      for (i = 0; i < moves.length && !res; i++) res = wwTry(ctx, b, p, n, moves[i]);
    }
    wwPut(ctx, p, n, res);
    return res;
  }

  // 攻方 p 在還剩 n 手時下 m（威脅著）：成功回傳 [m, …] 否則 null。
  function wwTry(ctx, b, p, n, m) {
    var rule = ctx.rule, res = null;
    place(ctx, b, m.r, m.c, p);
    try {
      if (makesFive(b, m.r, m.c, p, rule)) res = [m];
      else {
        var four = fivePointsNear(b, m.r, m.c, p, rule).length > 0;
        if (four || n >= 3) {
          var sub = wwD(ctx, b, p, n - 1);
          if (sub) res = [m].concat(sub);
        }
      }
    } finally { unplace(ctx, b, m.r, m.c, p); }
    return res;
  }

  // 守方 o＝3−p 走、攻方還剩 n 手。回傳攻方勝的手順（沿第一個防點展開，可能沒補到成五）或 null。
  function wwD(ctx, b, p, n) {
    wwTick(ctx);
    if (n < 1) return null;
    var o = 3 - p, rule = ctx.rule, i, j;
    if (allFivePoints(b, o, rule).length) return null;
    var fp = allFivePoints(b, p, rule);
    if (fp.length >= 2) return [];
    if (fp.length === 1) {
      var f = fp[0];
      if (rule === 'renju' && o === 1 && isForbidden(b, f.r, f.c)) return [];
      place(ctx, b, f.r, f.c, o);
      try {
        var s1 = wwA(ctx, b, p, n);
        return s1 ? [f].concat(s1) : null;
      } finally { unplace(ctx, b, f.r, f.c, o); }
    }
    if (n < 2) return null;
    var hit = wwGet(ctx, o, n);
    if (hit !== undefined) return hit;
    var res = wwDefend(ctx, b, p, n);
    wwPut(ctx, o, n, res);
    return res;
  }

  function wwDefend(ctx, b, p, n) {
    var o = 3 - p, rule = ctx.rule, i, j, sub;
    var w4 = threatPoints(b, p, rule);
    if (!w4.length) return null;
    var defs = defenseSet(ctx, b, p, w4), line = null;
    for (i = 0; i < defs.length; i++) {
      var q = defs[i];
      place(ctx, b, q.r, q.c, o);
      try { sub = wwA(ctx, b, p, n); }
      finally { unplace(ctx, b, q.r, q.c, o); }
      if (!sub) return null;
      if (!line) line = [q].concat(sub);
    }
    var cfs = fourMoves(b, o, rule);
    for (i = 0; i < cfs.length; i++) {
      var c = cfs[i], isDef = false;
      for (j = 0; j < defs.length; j++) if (defs[j].r === c.r && defs[j].c === c.c) { isDef = true; break; }
      if (isDef) continue;
      var ok = false;
      place(ctx, b, c.r, c.c, o);
      try {
        var cp = fivePointsNear(b, c.r, c.c, o, rule);
        if (cp.length === 1 && !makesFive(b, c.r, c.c, o, rule)) {
          var f = cp[0];
          if (!(rule === 'renju' && p === 1 && isForbidden(b, f.r, f.c))) {
            place(ctx, b, f.r, f.c, p);
            try {
              if (makesFive(b, f.r, f.c, p, rule)) ok = true;
              else ok = !!wwD(ctx, b, p, n - 1);
            } finally { unplace(ctx, b, f.r, f.c, p); }
          }
        }
      } finally { unplace(ctx, b, c.r, c.c, o); }
      if (!ok) return null;
    }
    return line || [];
  }

  // 輪到 player：能不能在自己的 n 手內（含成五）一定成五。opts = { rule, maxNodes（預設 50 萬）, timeLimit ms（預設 3000）,
  //   all：true 時另外回傳 answers＝全部「下了之後 n 手內必勝」的第一手（攻方只算威脅著）}。
  // 回傳 { status: 'win' | 'none' | 'unknown', line（補到成五）, answers? }。有 all 時，任何一個第一手查不完就是 'unknown'。
  function winWithin(board, player, n, opts) {
    opts = opts || {};
    var p = player === 2 ? 2 : 1, rule = opts.rule === 'renju' ? 'renju' : 'free';
    var b = [];
    for (var r = 0; r < SIZE; r++) b.push(board[r].slice());
    var ctx = newCtx(b, rule, 0, EXPERT_WIDTH, true);
    ctx.wwt = new Map();
    ctx.wwNodes = 0;
    ctx.wwLimit = opts.maxNodes > 0 ? opts.maxNodes : 500000;
    ctx.wwDeadline = now(ctx.cw.once) + (opts.timeLimit > 0 ? opts.timeLimit : 3000);
    try {
      var line = wwA(ctx, b, p, n), answers = null;
      if (opts.all) {
        answers = [];
        var own = allFivePoints(b, p, rule), theirs = allFivePoints(b, 3 - p, rule), moves;
        if (own.length) moves = own;
        else if (theirs.length === 1) moves = theirs;
        else if (theirs.length) moves = [];
        else moves = attackMoves(b, p, rule);
        for (var i = 0; i < moves.length; i++) {
          var m = moves[i], ok;
          if (own.length) ok = true;
          else if (theirs.length) {
            place(ctx, b, m.r, m.c, p);
            try { ok = !!wwD(ctx, b, p, n - 1); } finally { unplace(ctx, b, m.r, m.c, p); }
          } else ok = !!wwTry(ctx, b, p, n, m);
          if (ok) answers.push(pt(m.r, m.c));
        }
      }
      var out = { status: line ? 'win' : 'none', line: line ? completeLine(b, p, line, true, rule) : null };
      if (answers) out.answers = answers;
      return out;
    } catch (e) {
      if (e !== WW_BUDGET && e !== TIMEOUT) throw e;
      return { status: 'unknown', line: null };
    }
  }

  // ---------------------------------------------------------------- 復盤分析（A 段）
  //
  // 逐手分析一盤棋。moves：[{r,c}…]（黑先）。每手回傳（輪走方＝下這手的一方 p，對手 o）：
  //   index、player、move
  //   threatsBefore：{ black, white } 下這手之前雙方的 listThreats（不查 VCF）
  //   opponentWins：下完這手後 o 有 VCF 或 VCT（威脅 ≤ 6 手）
  //   losingMove：整盤第一個 opponentWins 的手；另外連珠嚴格模式下黑棋下禁手的那一手也一定是 true（即使更早已有敗著，
  //     所以整盤最多兩手是 true），見 forbidden 與摘要的 forbiddenLoss
  //   winningLine／winningKind：o 的必勝手順（補到成五；v0.5.16 起連珠黑棋擋不了時中間有一格 { pass: true }，見 finishLine）與 'VCF'（攻方每手都是四）或 'VCT'；禁手判負那一手是 'forbidden'（winningLine null）；
  //     沒有就是 null
  //   uncertainBefore：這手之前 analyzed:false 的手數
  //   betterMove／betterStatus／betterVerified／betterChecked：只算 losingMove 那一手——從這手之前的評分前 12 名
  //     （不含實際下的那手）裡依評分高低逐一檢查：先看下完後 o 有沒有 VCT（≤ 6 手，遊戲內的 VCT），沒有的再用嚴格驗證
  //     （守方窮舉，T＝6，見 makeStrict；第十批）。status：
  //     'found'：嚴格驗證 6 次威脅內攻不進來（betterVerified 'strict6'）——仍只是「這些威脅著裡攻不進來」，不是證明守得住；
  //     'unverified'：沒有 found 的，但有一點沒被證明會輸、只是嚴格驗證沒查完（或預算用完、沒驗）——
  //       第十二批（judge 第五輪 F3）起**不回傳推薦點**（betterMove null）：沒驗完的點不推薦。betterChecked＝查了幾個候選；
  //       betterLimit 說第一個沒驗完的點碰到哪一種預算：'nodes'（節點預算，各裝置相同）
  //       或 'time'（牆鐘保險，只有裝置很慢或整盤 60 秒上限時才會碰到）；其餘狀態 betterLimit 是 null；
  //     'none'：查過的候選全部被證明會輸（betterChecked＝查了幾個）；
  //     'unknown'：原本檢查的時間用完、沒查完全部候選，又沒有可推薦的點（或敗著時整盤時間已用完）。
  //     第七批的 unverified（靠沖四拖延）現在也一律過嚴格驗證：書譜 1 的 5,3 就是被證明會輸而丟掉的。
  //   （第七批：o 的必勝沒算完、或 p 靠沖四拖延才沒被找到攻法時，analyzed 都是 false）
  //   brilliant：下完這手後 p 已經必勝（o 怎麼應都擋不住，威脅 ≤ 6 手），而 p 的上一手還沒有——也就是必勝從這手開始
  //   forbidden：連珠規則下黑棋這手是禁手時的種類（'三三'／'四四'／'長連'），否則 null；遇到就結束分析
  //   win：這手成五（分析到此結束）
  //   analyzed：這手的「o 有沒有必勝」有算完（查不完或整盤時間用完就是 false，這時 opponentWins 一定是 false）
  // 時間：每手 opts.perMoveMs（預設 800）；敗著那一手找 betterMove 另給一份 perMoveMs（遊戲內 VCT），嚴格驗證另計
  // （第十一批：主預算是節點數，見 findBetterMove 上面；用掉的牆鐘時間不佔 totalMs、整盤時限照實順延）；整盤 opts.totalMs
  // （預設 30000），用完之後的手只給 threatsBefore、analyzed:false。整盤另有牆鐘總上限 ANALYZE_WALL_MS（60 秒，從開始算）：
  // 過了就不再驗、也不再分析（其餘的手 analyzed:false）。
  // 整盤摘要：analyzeGameSummary(state)，analyzeGame 回傳的陣列上也掛一份 .summary。

  var ANALYZE_THREATS = 6, ANALYZE_NODES = 200000, BETTER_TOP = 12;
  // 預設預算（作者 2026-09-29 拍板：400 → 800 ms、20 → 30 秒；第四批 104 手長局 400 ms 時 20 手查不完）
  var ANALYZE_PER_MOVE_MS = 800, ANALYZE_TOTAL_MS = 30000;
  // 第十一批（主線拍板）：整盤牆鐘總上限。嚴格驗證用掉的時間照實順延 totalMs，但從開始算超過這麼多就停
  var ANALYZE_WALL_MS = 60000;

  function analyzeGameInit(moves, rule, opts) {
    opts = opts || {};
    return {
      moves: moves || [], rule: rule === 'renju' ? 'renju' : 'free',
      perMoveMs: opts.perMoveMs > 0 ? opts.perMoveMs : ANALYZE_PER_MOVE_MS,
      totalMs: opts.totalMs > 0 ? opts.totalMs : ANALYZE_TOTAL_MS,
      board: createBoard(), index: 0, start: now(clockW(rule).once), firstLosing: -1, proved: [false, false, false], done: false,
      unanalyzed: 0, unanalyzedBeforeLosing: 0, tail: 0, forbiddenLoss: null,
      strictUsed: 0 // 第十批：較好下法的嚴格驗證用掉的毫秒數（不佔 totalMs；第十一批起整盤只受 ANALYZE_WALL_MS 限制）
    };
  }

  // 整盤摘要（做到一半呼叫就是到目前為止的）：
  //   firstLosing：第一個 losingMove 的 index（含禁手判負），沒有是 null
  //   unanalyzedCount：analyzed:false 的手數
  //   unanalyzedBeforeLosing：第一個敗著之前 analyzed:false 的手數（>0 時真正的敗著可能在更早、沒算完的那幾手）；
  //     沒有敗著時等於 unanalyzedCount
  //   tailUnanalyzed：從最後一手往前連續 analyzed:false 的手數；最後一手若是成五或禁手（分出勝負、本身不用分析）就從它前一手數起
  //   forbiddenLoss：連珠黑棋下禁手判負的那一手的 index，沒有是 null（即使更早已有敗著也列）
  function analyzeGameSummary(st) {
    var lost = st.firstLosing >= 0;
    return {
      firstLosing: lost ? st.firstLosing : null,
      unanalyzedCount: st.unanalyzed,
      unanalyzedBeforeLosing: lost ? st.unanalyzedBeforeLosing : st.unanalyzed,
      tailUnanalyzed: st.tail,
      forbiddenLoss: st.forbiddenLoss
    };
  }

  function winKind(board, att, line, rule) {
    var b = [], who = att;
    for (var r = 0; r < SIZE; r++) b.push(board[r].slice());
    for (var i = 0; i < line.length; i++) {
      var m = line[i];
      b[m.r][m.c] = who;
      if (who === att && !checkWin(b, m.r, m.c, rule) && !fivePointsNear(b, m.r, m.c, att, rule).length) return 'VCT';
      who = 3 - who;
    }
    return 'VCF';
  }

  // 第十批：較好下法的嚴格驗證（主線拍板：電腦保證不了的事不寫肯定句；已經能證明會輸的下法更不能推薦）。
  // 每個候選先做原本的檢查（遊戲內 VCT），沒被找到必勝的再用嚴格驗證（STRICT.verifyAfter，T＝6）：
  //   'win'（對手必勝）→ 丟掉；'safe' → 回傳 found（betterVerified 'strict6'）；'unknown'（預算用完）→ 記成備胎、繼續試。
  // 預算（第十一批，主線拍板：結論不看裝置快慢）：主預算是節點數（嚴格驗證器的節點，sA／sD 各算一個），同一盤棋在哪台裝置都得到
  //   同一個結論；牆鐘時間只當保險上限，碰到才會因裝置快慢而不同。這台 Mac（jsc）量到約 13,800 節點／秒（README「較好下法的預算」）：
  //   每個候選 30,000 節點（約 2.2 秒）、一個敗著合計 110,000 節點（約 8 秒）；牆鐘保險每個候選 8 秒、一個敗著合計 20 秒，
  //   整盤另受 ANALYZE_WALL_MS 限制（見 analyzeOne）。遊戲內 VCT 已證明會輸的候選不花嚴格驗證的預算。
  // 第十二批：嚴格驗證器的攻方威脅著改用空著測試定義（照定義、不設 λ 上限），同一個證明要的節點多了：書譜 4 另一線的 4,3
  //   從 26,253 變 35,631 節點（這台 Mac 約 2.4 秒），所以每個候選調成 40,000 節點（約 2.7 秒）；一個敗著合計不變。
  var BETTER_STRICT_T = 6;
  var BETTER_STRICT_EACH_NODES = 40000, BETTER_STRICT_MOVE_NODES = 110000;
  var BETTER_STRICT_EACH_MS = 8000, BETTER_STRICT_MOVE_MS = 20000;
  var BETTER_STRICT_MIN_MS = 20; // 牆鐘保險剩不到這麼多就不驗（當作查不完，betterLimit 'time'）
  var STRICT = null;             // makeStrict 的結果，模組最後設定

  // board：這手之前的局面（會暫時改動、一定還原）。deadline：原本檢查（遊戲內 VCT）的時限；嚴格驗證用掉的時間會順延它。
  // strictMs：這一手嚴格驗證的牆鐘保險（毫秒；省略＝BETTER_STRICT_MOVE_MS，0＝不驗）。節點預算固定（見上面）。
  // 回傳 { move（只有 found 時有；第十二批起 unverified 是 null）, status: 'found'|'unverified'|'none'|'unknown', verified?: 'strict6'（found 時）,
  //   checked?（none、unverified 時：查了幾個候選）, limit?（unverified 時：第一個沒驗完的點碰到 'nodes'、'time' 還是 'nullmove-budget'）,
  //   strictMs（嚴格驗證實際用掉的毫秒數）, strictNodes（用掉的節點數） }
  function findBetterMove(board, p, played, rule, deadline, strictMs) {
    var o = 3 - p, list = analyze(board, p, rule), unknown = false;
    if (!list.length && rule === 'renju' && p === 1) list = legalFallback(board);
    list.sort(byScoreDesc);
    var cands = [];
    for (var i = 0; i < list.length && cands.length < BETTER_TOP; i++)
      if (list[i].r !== played.r || list[i].c !== played.c) cands.push(list[i]);
    var ctx = newCtx(board, rule, 0, BETTER_TOP, true), backup = null, backupLimit = null, used = 0, nodesUsed = 0;
    strictMs = strictMs === undefined ? BETTER_STRICT_MOVE_MS : strictMs > 0 ? strictMs : 0;
    function out(r) { r.strictMs = Math.round(used); r.strictNodes = nodesUsed; return r; }
    for (i = 0; i < cands.length; i++) {
      var m = cands[i], tNow = now(clockW(rule).once), dl = deadline + used;
      if (tNow >= dl) { unknown = true; break; }
      var nodesLeft = BETTER_STRICT_MOVE_NODES - nodesUsed, msLeft = strictMs - used;
      if (backup && (nodesLeft <= 0 || msLeft < BETTER_STRICT_MIN_MS)) break; // 已有備胎、又不能再驗：後面的最多也只是備胎
      var slice = Math.min(dl, tNow + Math.max(40, (dl - tNow) / 3)), hit;
      place(ctx, board, m.r, m.c, p);
      try {
        if (checkWin(board, m.r, m.c, rule)) return out({ move: pt(m.r, m.c), status: 'found', verified: 'strict6' }); // 自己成五
        hit = runVCT(ctx, board, o, ANALYZE_THREATS, ANALYZE_NODES, slice);
      } finally { unplace(ctx, board, m.r, m.c, p); }
      if (hit) continue; // 遊戲內 VCT 找到對手的必勝手順：這一手也會輸
      // 遊戲內 VCT 沒找到（乾淨、靠沖四拖延、或查不完）：嚴格驗證
      var sv = null, why = null;
      if (nodesLeft <= 0) why = 'nodes';
      else if (msLeft < BETTER_STRICT_MIN_MS) why = 'time';
      else {
        var maxN = Math.min(BETTER_STRICT_EACH_NODES, nodesLeft), s0 = now(clockW(rule).once);
        sv = STRICT.verifyAfter(board, p, m, BETTER_STRICT_T, { rule: rule, maxNodes: maxN, timeLimit: Math.min(BETTER_STRICT_EACH_MS, msLeft) });
        used += now(clockW(rule).once) - s0;
        nodesUsed += Math.min(sv.nodes, maxN); // 碰到節點上限時 sv.nodes 是 maxN＋1
        if (sv.status === 'unknown') why = sv.reason === 'nullmove-budget' ? 'nullmove-budget' : sv.nodes > maxN ? 'nodes' : 'time';
      }
      if (sv && sv.status === 'win') continue;
      if (sv && sv.status === 'safe') return out({ move: pt(m.r, m.c), status: 'found', verified: 'strict6' });
      if (!backup) { backup = m; backupLimit = why; }
    }
    // 第十二批（judge 第五輪 F3）：沒驗完的點不推薦——unverified 不回傳 move，只留查了幾個（checked）與碰到哪種預算（limit）
    if (backup) return out({ move: null, status: 'unverified', limit: backupLimit, checked: Math.min(i, cands.length) });
    if (unknown) return out({ move: null, status: 'unknown' });
    return out({ move: null, status: 'none', checked: cands.length });
  }

  // 分析下一手；全部做完回傳 null。回傳值就是那一手的結果（含 index），Worker 可以逐手 postMessage。
  // 每手另有 uncertainBefore：這手之前 analyzed:false 的手數（敗著前面有沒算完的手時，真正的敗著可能更早）。
  function analyzeGameStep(st) {
    var before = st.unanalyzed, res = analyzeOne(st);
    if (!res) return null;
    res.uncertainBefore = before;
    if (!res.analyzed) { st.unanalyzed++; st.tail++; }
    else if (!res.win && !res.forbidden) st.tail = 0; // 成五、禁手是分出勝負的最後一手，不打斷「後段未分析」的計數
    return res;
  }

  function analyzeOne(st) {
    if (st.done || st.index >= st.moves.length) { st.done = true; return null; }
    var i = st.index++, mv = st.moves[i], p = i % 2 ? 2 : 1, o = 3 - p, b = st.board, rule = st.rule;
    if (!mv || !inside(mv.r, mv.c) || b[mv.r][mv.c]) {
      st.done = true;
      throw new Error('analyzeGame：第 ' + (i + 1) + ' 手不合法 ' + JSON.stringify(mv));
    }
    var res = {
      index: i, player: p, move: pt(mv.r, mv.c), analyzed: false,
      threatsBefore: { black: listThreats(b, 1, rule, { vcfMs: 0 }), white: listThreats(b, 2, rule, { vcfMs: 0 }) },
      opponentWins: false, losingMove: false, winningLine: null, winningKind: null,
      betterMove: null, betterStatus: null, betterVerified: null, betterChecked: null, betterLimit: null,
      brilliant: false, forbidden: null, win: false
    };
    // 整盤時限＝start＋totalMs＋嚴格驗證已用掉的時間（嚴格驗證不佔一般分析的 totalMs），但不超過 start＋ANALYZE_WALL_MS
    var t0 = now(clockW(st.rule).once), wallEnd = st.start + ANALYZE_WALL_MS;
    var gameEnd = Math.min(st.start + st.totalMs + st.strictUsed, wallEnd), budgetLeft = gameEnd - t0;
    // always：禁手判負那一手即使不是第一個敗著也標 losingMove（見 forbiddenLoss）
    function markLosing(always) {
      if (st.firstLosing >= 0 && !always) return;
      if (st.firstLosing < 0) { st.firstLosing = i; st.unanalyzedBeforeLosing = st.unanalyzed; }
      res.losingMove = true;
      if (budgetLeft <= 0) { res.betterStatus = 'unknown'; return; }
      var bt = findBetterMove(b, p, mv, rule, Math.min(now(clockW(rule).once) + st.perMoveMs, gameEnd),
        Math.max(0, Math.min(BETTER_STRICT_MOVE_MS, wallEnd - now(clockW(rule).once))));
      st.strictUsed += bt.strictMs;
      res.betterMove = bt.move;
      res.betterStatus = bt.status;
      if (bt.verified) res.betterVerified = bt.verified;
      if (bt.status === 'none' || bt.status === 'unverified') res.betterChecked = bt.checked;
      if (bt.status === 'unverified') res.betterLimit = bt.limit || null;
    }
    if (rule === 'renju' && p === 1) {
      var fb = isForbidden(b, mv.r, mv.c);
      if (fb) {
        res.forbidden = fb;
        res.analyzed = true;
        res.opponentWins = true;
        res.winningKind = 'forbidden';
        st.forbiddenLoss = i;
        markLosing(true);
        b[mv.r][mv.c] = p;
        st.done = true;
        return res;
      }
    }
    b[mv.r][mv.c] = p;
    if (checkWin(b, mv.r, mv.c, rule)) { res.win = true; res.analyzed = true; st.done = true; return res; }
    if (budgetLeft <= 0) return res;
    var deadline = Math.min(t0 + st.perMoveMs, gameEnd);
    var ctx = newCtx(b, rule, 0, BETTER_TOP, true);
    var line = runVCT(ctx, b, o, ANALYZE_THREATS, ANALYZE_NODES, t0 + (deadline - t0) * 0.6);
    var unknown = !line && ctx.vctUnknown;
    if (line) {
      res.opponentWins = true;
      res.winningLine = completeLine(b, o, line, true, rule);
      res.winningKind = winKind(b, o, res.winningLine, rule);
      // v0.5.16：回頭看畫的路補到成五（連珠黑棋擋不了時中間一格 { pass: true }，見 finishLine）；種類照補之前的路算（不變）
      res.winningLine = finishLine(b, o, res.winningLine, rule);
      st.proved[p] = false;
      res.analyzed = true;
      b[mv.r][mv.c] = 0;
      try { markLosing(); } finally { b[mv.r][mv.c] = p; }
      return res;
    }
    res.analyzed = !unknown;
    var mine = now(ctx.cw.once) < deadline ? runVCTAfter(ctx, b, p, ANALYZE_THREATS, ANALYZE_NODES, deadline) : null;
    res.brilliant = !!mine && !st.proved[p];
    st.proved[p] = !!mine;
    return res;
  }

  // 一次跑完整盤；opts.onProgress(index, result) 每手呼叫一次。回傳每手結果的陣列，陣列另掛 summary（見 analyzeGameSummary）。
  function analyzeGame(moves, rule, opts) {
    var st = analyzeGameInit(moves, rule, opts), out = [], r;
    while ((r = analyzeGameStep(st))) {
      out.push(r);
      if (opts && typeof opts.onProgress === 'function') opts.onProgress(r.index, r);
    }
    out.summary = analyzeGameSummary(st);
    return out;
  }

  // ---------------------------------------------------------------- 嚴格驗證（守方窮舉；第七批寫在 tools/strict-verify.js，第十批搬進來）
  //
  // 問題：攻方 att 先走，att 能不能在 T 次威脅內一定成五，不管守方怎麼應？回傳 'win'／'safe'／'unknown'。
  //   'safe' 的意思是「T 次威脅內（威脅著照下面 threatSearch 的定義），證明不了必勝」，不是證明守方不會輸。
  //
  // 和遊戲內的 VCT（vctA／vctD）差在守方：
  //   遊戲內的守方只試「破掉攻方 W4 點的防點＋自己的反四」，攻方沒有現成威脅就當「威脅斷了、守住」。
  //   這裡的守方每一步窮舉全盤合法點（連珠黑棋不下禁手）。所以守方沖四、攻方擋完之後，
  //   守方那一手「怎麼下都守不住」的情形（沖四拖延）會被算成攻方勝，不會誤判成守住。
  //   為了跑得完，守方的每個應手先做便宜的檢查：守方「放棄這一手」時攻方的 VCF 手順 L，下了這點之後照原樣重走一遍還成立，
  //   這一點就直接算輸（不用再搜）；重走不成立的點才遞迴。守方的點依「破掉 W4 點的防點 → 反四 → L 上的點 → L 各點四線 4 格內 →
  //   評分 → 其餘全盤」排，守得住的點通常很早就找到。
  //
  // 攻方節點（輪攻方）：自己能成五 → 勝；守方兩個以上成五點 → 不勝；守方一個成五點 → 擋（連珠黑棋擋點是禁手 → 不勝），
  //   擋完輪守方、威脅數不變；攻方有 VCF（sVCF，雙方合計 23 手；第十一批以前是 16）→ 勝（VCF 不計威脅數）；威脅數用完 → 不勝；
  //   否則試攻方的威脅著，每一手用掉一次威脅。第十二批起威脅著用空著測試定義（見 threatSearch：下了之後守方空著一手、
  //   攻方在剩下的威脅數內必勝的著法）；第七～十一批是列舉（成四、成活三／跳三、做出雙四點或四三點），judge 第五輪查出漏洞。
  // 守方節點（輪守方）：守方能成五 → 不勝；攻方兩個以上成五點 → 勝；攻方一個成五點 → 擋（連珠黑棋擋點是禁手 → 勝）；
  //   守方有 VCF → 不勝；否則守方全盤每個合法點都要讓攻方勝才算勝（守方下沖四時，攻方節點會先擋，擋完又輪守方窮舉）。
  // 置換表：局面（zobrist）＋輪誰走＋空著測試還能巢狀幾層，記「幾次威脅內證明勝」與「幾次威脅內證明不勝」。
  // 節點數或時間超過預算就回 'unknown'（第十二批起帶 reason：'nodes'、'time'、'nullmove-budget'）。
  //
  // API（掛在 Gomoku.strict；tools/strict-verify.js 只是轉出這一份，jsc 掛 GomokuStrict、node require 都拿到同一個物件）：
  //   verify(board, attacker, T, { rule, maxNodes（預設 300 萬）, timeLimit ms（預設 60000）, lambda（空著測試巢狀層數上限，
  //     省略＝照定義不設上限）, nullNodes（每次空著測試的節點預算，預設 2 萬） })
  //     → { status, reason?, line（勝時的手順，沿守方第一個應手展開，不一定補到成五）, threats（找到勝法那一輪的威脅數）, nodes, ms,
  //         lambda（用的上限，null＝不設）, nullStat（第三段空著測試做了幾次、成立幾次、被截斷幾次） }
  //   verifyAfter(board, defender, move, T, opts)：守方先下 move，再問攻方（3 − defender）→ 同上；move 不合法回 status 'illegal'
  //   verifyReply(board, attacker, move, T, opts)：攻方下 move 之後（輪守方），守方怎麼應都擋不住嗎（攻擊題的正解）→ 同上
  //   followUp(board, defender, move, T, opts)：守方的 move 是沖四時，跟完「攻方擋（和之後的連續強制應手）」，
  //     到守方能自由下的那一手：攻方若「守方放棄這一手」T 次威脅內仍必勝，守方就得下對那一手——回傳
  //     { exchange: [攻方擋點, …], needed: true, move: 守得住的那一手 | null, status: 'safe'|'win'|'unknown' }；
  //     放棄也守得住就是 { exchange, needed: false }；move 不是沖四回傳 null。
  // 遊戲流程只在復盤的 findBetterMove 用 verifyAfter（T＝6、照定義、節點預算＋牆鐘保險）；其餘給題庫工具與測試。
  // 第十二批改寫了攻方著法（threatSearch、nullTest）、置換表（多一維 lam）、VCF（sVCF）；守方節點（sD、sDefend、orderDefense）
  // 和第七批相同，只多了「守得住的那一手沒證明完」的標記（sTaint）。
  function makeStrict(G) {
    var I = G._internal, SIZE = G.SIZE, DIRS = I.DIRS, now = I.now;
    var BUDGET = { strictBudget: true }, NULL_BUDGET = { strictNullBudget: true };
    var DEFAULT_NODES = 3000000, DEFAULT_MS = 60000;
    // 第十二批：嚴格驗證器裡的 VCF（每個節點的 VCF、守方的 VCF、空著測試的 VCF）都用這個深度：雙方合計 23 手＝攻方 12 手沖四。
    // 遊戲內的 VCF 仍是 I.VCF_PLIES（16）。
    var S_VCF_PLIES = 23;
    // 第十二批：空著測試第三層（空著後遞迴呼叫驗證器自己）每一次的節點預算（opts.nullNodes 可改；見 threatSearch）。
    var DEFAULT_NULL_NODES = 20000;

    function inside(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }
    function copy(board) { return board.map(function (row) { return row.slice(); }); }
    function pt(m) { return { r: m.r, c: m.c }; }

    function forbiddenFor(ctx, b, r, c, who) {
      return ctx.rule === 'renju' && who === 1 && !!G.isForbidden(b, r, c);
    }

    function tick(ctx) {
      if (++ctx.sNodes > ctx.sLimit) { ctx.why = 'nodes'; throw BUDGET; }
      if ((ctx.sNodes & 31) === 0 && now(ctx.cw.strict) > ctx.sDeadline) { ctx.why = 'time'; throw BUDGET; }
      if (ctx.sNodes > ctx.nullLimit) throw NULL_BUDGET;
    }

    // 置換表（第十二批：多一維 lam＝空著測試還能巢狀幾層，見 threatSearch）：w[lam]＝幾次威脅內證明勝，f[lam]＝幾次威脅內證明不勝。
    // 勝對更大的 t、更大的 lam 也成立；不勝對更小的 t、更小的 lam 也成立。
    // 每一階 lam 各一個 Map：F[lam]（key → 證明不勝的最大 t，存數字）、W[lam]（key → { t, line }）。長時間的驗證（幾分鐘、幾百萬節點）
    // 表會很大：合計超過 TT_MAX 筆就整個清掉重來（置換表只是快取，清掉不改變結果，只是之後要重算）。
    var TT_MAX = 3000000;
    // 第十三批（judge 第六輪）：鍵（I.ttKey）只有 53 位元，表項另外存校驗值 chk（I.ttCheck，43 位元）：取的時候不相符就當沒查到，
    // 存的時候不相符就蓋掉（鍵相撞時留新的）。W 的表項 { t, line, c: chk }；F 的表項是一個數字 chk × 64 ＋ t（t 一定小於 64）。
    function newTable() { return { W: [], F: [], n: 0 }; }
    function ttGet(tab, key, chk, t, lam) {
      var l, e, W = tab.W, F = tab.F;
      for (l = 0; l <= lam && l < W.length; l++) if (W[l] && (e = W[l].get(key)) !== undefined && e.c === chk && e.t <= t) return e.line;
      for (l = F.length - 1; l >= lam; l--) if (F[l] && (e = F[l].get(key)) !== undefined && e - e % 64 === chk * 64 && e % 64 >= t) return null;
      return undefined;
    }

    function ttPut(tab, key, chk, t, lam, line) {
      if (tab.n > TT_MAX) { tab.W = []; tab.F = []; tab.n = 0; }
      var m, e;
      if (line) {
        m = tab.W[lam] || (tab.W[lam] = new Map());
        e = m.get(key);
        if (e === undefined) { tab.n++; m.set(key, { t: t, line: line, c: chk }); }
        else if (e.c !== chk || t < e.t) { e.t = t; e.line = line; e.c = chk; }
      } else {
        m = tab.F[lam] || (tab.F[lam] = new Map());
        e = m.get(key);
        if (e === undefined) { tab.n++; m.set(key, chk * 64 + t); }
        else if (e - e % 64 !== chk * 64 || t > e % 64) m.set(key, chk * 64 + t);
      }
    }

    // 剩 t 次威脅時 lam 最多有用到 t−1（每巢狀一層空著測試用掉一次威脅）；統一成這個值，置換表比較容易命中
    function normLam(lam, t) { return Math.min(lam, t > 1 ? t - 1 : 0); }

    // 第十二批：嚴格驗證器自己的 VCF。定義和遊戲內的 vcf 一樣（攻方連續沖四、守方只擋成五點；守方擋下去成五就失敗、成四就要攻方先擋；
    // 連珠黑棋不下禁手、白棋可以逼黑棋擋在禁手點）。差別只在效率：自由規則下，下一層的「攻方成四點」只重新檢查上一層的成四點與
    // 攻方新子四條線前後 4 格的點（守方的子不會替攻方多出四，攻方的新子只影響自己四條線上的點），不再掃全盤。
    // prev：上一層（或呼叫者）算好的成四點清單（null＝掃全盤）；add：比 prev 那個局面多下的攻方子（可以是 null）。
    // ctx.vcfTouch 有值時記下搜尋時下過的點（vcfZone 用）。遊戲流程不用這一份。
    // 失敗表 ctx.vcfFail：這裡存的值是「校驗值 × 32 ＋ plies」（第十三批），遊戲內 vcf 的失敗表只存 plies，格式不同，
    // 不可與遊戲內 vcf 共用同一個 Map（共用會把對方存的值讀錯）。
    function sVCF(ctx, b, p, plies, lastDef, prev, add) {
      if ((++ctx.nodes & 127) === 0) {
        if (now(ctx.cw.strictVcf) > ctx.vcfDeadline) throw I.TIMEOUT;
        if (ctx.vcfFail.size > TT_MAX) ctx.vcfFail = new Map(); // 失敗表太大就清掉（只是快取，見 ttPut）
      }
      if (plies <= 0) return null;
      // 第十三批：失敗表的值＝校驗值（I.ttCheck）× 32 ＋ plies（plies ≤ 23），校驗不相符就當沒查到
      var o = 3 - p, rule = ctx.rule, key = I.ttKey(ctx, p), chk = I.ttCheck(ctx, p) * 32;
      var seen = ctx.vcfFail.get(key);
      if (seen !== undefined && seen - seen % 32 === chk && seen % 32 >= plies) return null;
      var moves = null, fours = null;
      // 快的路（增量成四點、fivesThrough）只用在「不用管禁手」的那一方：自由規則，或連珠的白棋（白棋沒有禁手、長連也算五）
      var free = rule === 'free' || p === 2, oFree = rule === 'free' || o === 2;
      if (lastDef) {
        var threats = oFree ? fivesThrough(b, lastDef.r, lastDef.c, o) : I.fivePointsNear(b, lastDef.r, lastDef.c, o, rule);
        if (threats.length >= 2) { ctx.vcfFail.set(key, chk + plies); return null; }
        if (threats.length === 1) {
          var t0 = threats[0];
          if (rule === 'renju' && p === 1 && G.isForbidden(b, t0.r, t0.c)) { ctx.vcfFail.set(key, chk + plies); return null; }
          moves = [t0]; // 先擋對方的四，這一擋本身要是四才能續攻
        }
      }
      if (!moves) moves = fours = free && prev ? incrFours(b, p, prev, add, lastDef) : I.fourMoves(b, p, rule);
      for (var i = 0; i < moves.length; i++) {
        var m = moves[i], res = null;
        if (ctx.vcfTouch) ctx.vcfTouch[m.r * SIZE + m.c] = 1;
        I.place(ctx, b, m.r, m.c, p);
        try {
          if (I.makesFive(b, m.r, m.c, p, rule)) res = [m];
          else {
            var fp = free ? fivesThrough(b, m.r, m.c, p) : I.fivePointsNear(b, m.r, m.c, p, rule);
            if (fp.length >= 2) res = [m];                         // 活四或雙四：擋不完
            else if (fp.length === 1) {
              var q = fp[0];
              if (rule === 'renju' && o === 1 && G.isForbidden(b, q.r, q.c)) res = [m]; // 黑棋擋點是禁手，擋不了
              else if (plies > 2) {
                if (ctx.vcfTouch) ctx.vcfTouch[q.r * SIZE + q.c] = 1;
                I.place(ctx, b, q.r, q.c, o);
                try {
                  if (!I.makesFive(b, q.r, q.c, o, rule)) {
                    var sub = sVCF(ctx, b, p, plies - 2, q, fours, m);
                    if (sub) res = [m, q].concat(sub);
                  }
                } finally { I.unplace(ctx, b, q.r, q.c, o); }
              }
            }
          }
        } finally { I.unplace(ctx, b, m.r, m.c, p); }
        if (res) return res;
      }
      ctx.vcfFail.set(key, chk + plies);
      return null;
    }

    // 自由規則（或連珠的白棋 p：白棋的成四點只看型態，沒有禁手）：現在局面 p 的成四點＝prev（之前某個局面 p 的成四點）之後
    // 多了 add（p 的子，可以是 null）與 block（對手的子，可以是 null）。
    //   prev 的點：被佔了就不算；在 block 四條線前後 4 格內的重新檢查（可能被擋掉）；其餘照舊（攻方多一子不會讓成四點消失）。
    //   新的點只可能在 add 四條線前後 4 格內、而且是那條線的方向成四（其他方向的型態沒變，原本就成四的話已在 prev）。
    //   成四點一定在某顆子周圍 2 格內，所以和全盤掃描（I.fourMoves）的集合相同（第十二批用兩萬個局面比對過，見 test.js）。
    // 排序：prev 的點沿用原本的分數，新的點用點評分；由高到低（只影響先試哪一手，不影響有沒有 VCF）。
    function incrFours(b, p, prev, add, block) {
      var out = [], seen = new Uint8Array(SIZE * SIZE), i, d, k, r, c;
      function isFourAny(r, c) {
        for (var dd = 0; dd < 4; dd++) {
          var s = I.shapeAt(b, r, c, p, DIRS[dd][0], DIRS[dd][1]);
          if (s === I.RUSH4 || s === I.LIVE4) return true;
        }
        return false;
      }
      function onLine(x, r, c) {
        if (!x) return false;
        var dr = r - x.r, dc = c - x.c;
        return (dr === 0 || dc === 0 || dr === dc || dr === -dc) && Math.abs(dr) <= 4 && Math.abs(dc) <= 4;
      }
      for (i = 0; i < prev.length; i++) {
        var y = prev[i];
        r = y.r; c = y.c;
        if (b[r][c] || seen[r * SIZE + c]) continue;
        seen[r * SIZE + c] = 1;
        if (onLine(block, r, c) && !isFourAny(r, c)) continue;
        out.push({ r: r, c: c, score: y.score || 0 });
      }
      if (add)
        for (d = 0; d < 4; d++)
          for (k = -4; k <= 4; k++) {
            if (!k) continue;
            r = add.r + DIRS[d][0] * k; c = add.c + DIRS[d][1] * k;
            if (!inside(r, c) || b[r][c] || seen[r * SIZE + c]) continue;
            var s = I.shapeAt(b, r, c, p, DIRS[d][0], DIRS[d][1]);
            if (s !== I.RUSH4 && s !== I.LIVE4) continue;
            seen[r * SIZE + c] = 1;
            out.push({ r: r, c: c, score: I.pointScore(b, r, c, p) });
          }
      return out.sort(function (x, y) { return y.score - x.score; });
    }

    // 自由規則（或連珠的白棋 p，長連也算五）：(r,c) 上已有 p 的子，而 p 在這一子之前沒有成五點——p 現在的成五點
    // （一定和 (r,c) 在同一條線、前後 4 格內）。
    // 只看「經過 (r,c) 那個方向已經成四」的線（和 I.fivePointsNear 在這個前提下的結果相同，但快很多）。
    function fivesThrough(b, r, c, p) {
      var out = [];
      for (var d = 0; d < 4; d++) {
        var dr = DIRS[d][0], dc = DIRS[d][1];
        if (I.shapeAt(b, r, c, p, dr, dc) < I.RUSH4) continue;
        for (var k = -4; k <= 4; k++) {
          if (!k) continue;
          var yr = r + dr * k, yc = c + dc * k;
          if (!inside(yr, yc) || b[yr][yc]) continue;
          var n = 1, j;
          for (j = 1; j <= 4 && inside(yr + dr * j, yc + dc * j) && b[yr + dr * j][yc + dc * j] === p; j++) n++;
          for (j = 1; j <= 4 && inside(yr - dr * j, yc - dc * j) && b[yr - dr * j][yc - dc * j] === p; j++) n++;
          if (n >= 5) out.push({ r: yr, c: yc });
        }
      }
      return out;
    }

    function newCtx(b, rule, opts) {
      var ctx = I.newCtx(b, rule, 0, 12, true);
      ctx.sat = newTable();
      ctx.sdt = newTable();
      ctx.sNodes = 0;
      ctx.sLimit = opts.maxNodes > 0 ? opts.maxNodes : DEFAULT_NODES;
      ctx.sDeadline = now(ctx.cw.once) + (opts.timeLimit > 0 ? opts.timeLimit : DEFAULT_MS);
      ctx.vcfDeadline = ctx.sDeadline;
      ctx.nullNodes = opts.nullNodes > 0 ? opts.nullNodes : DEFAULT_NULL_NODES;
      ctx.nullLimit = Infinity; // 目前這一層空著測試的節點上限（巢狀時取最小）
      ctx.sTaint = false;       // 上一個回傳 null 的 sA／sD：「不勝」是不是靠一個沒做完的空著測試（見 threatSearch）
      ctx.why = null;           // 預算用完的原因：'nodes' | 'time'
      ctx.nullStat = { tests: 0, wins: 0, cut: 0 };
      // opts.lambda：空著測試最多巢狀幾層（0＝只做第一、二段；省略＝照定義不設上限，實際上限是剩下的威脅數）
      ctx.lamMax = opts.lambda >= 0 ? Math.floor(opts.lambda) : 99;
      return ctx;
    }

    // 攻方 p 走、剩 t 次威脅、空著測試還能巢狀 lam 層。回傳勝的手順或 null。hint：先試的攻方著法（守方上一個應手之後攻方贏的那一手）。
    // 回傳 null 時 ctx.sTaint 表示這個「不勝」沒證明完（有空著測試碰到自己的節點預算），這種結果不進置換表。
    // 每個節點先用 lam−1 找一次（逐層加深；便宜的勝法先找到），找不到才用 lam。
    function sA(ctx, b, p, t, hint, lam) {
      tick(ctx);
      lam = normLam(lam, t);
      var o = 3 - p, rule = ctx.rule;
      var own = I.allFivePoints(b, p, rule);
      if (own.length) { ctx.sTaint = false; return [pt(own[0])]; }
      var key = I.ttKey(ctx, p), chk = I.ttCheck(ctx, p), hit = ttGet(ctx.sat, key, chk, t, lam);
      if (hit !== undefined) { ctx.sTaint = false; return hit; }
      var res = null, taint = false, theirs = I.allFivePoints(b, o, rule);
      if (lam > 0) {
        res = sA(ctx, b, p, t, hint, lam - 1);
        if (res) { ttPut(ctx.sat, key, chk, t, lam, res); ctx.sTaint = false; return res; }
      }
      if (theirs.length === 1) {
        var f = theirs[0];
        if (!forbiddenFor(ctx, b, f.r, f.c, p)) {
          I.place(ctx, b, f.r, f.c, p);
          try {
            var sub = sD(ctx, b, p, t, lam);
            if (sub) res = [pt(f)].concat(sub);
            else taint = ctx.sTaint;
          } finally { I.unplace(ctx, b, f.r, f.c, p); }
        }
      } else if (!theirs.length) {
        var v = sVCF(ctx, b, p, S_VCF_PLIES, null, null, null);
        if (v) res = v.map(pt);
        else if (t > 0) {
          res = threatSearch(ctx, b, p, t, hint, lam);
          taint = !res && ctx.sTaint;
        }
      }
      if (res || !taint) ttPut(ctx.sat, key, chk, t, lam, res);
      ctx.sTaint = !res && taint;
      return res;
    }

    // 第十二批（judge 第五輪，主線拍板「不再逐類補洞，改用定義」）：攻方的威脅著用空著測試定義——
    //   候選著 m 是威脅著，若且唯若「攻方下 m、守方空著一手（pass）之後，攻方在剩下的 t−1 次威脅內必勝」。
    //   成五、成四、活三／跳三、做出雙四點／四三點、逼出連續沖四，都是這個定義的特例。
    // 候選範圍：任一棋子周圍 2 格內的空點（連珠黑棋排除禁手）。依便宜到貴分三段，每一段找到的威脅著立刻去試（sD，守方窮舉）：
    //   一、便宜的篩：成四、活三、做出雙四點／四三點（attackMoves extended）——不用空著測試，直接收（它們一定符合定義）；
    //   二、空著後 VCF：下 m、守方空著，攻方有 VCF（S_VCF_PLIES）；
    //   三、空著後遞迴：下 m、守方空著，sA(t−1)（驗證器自己，同一份置換表：同一局面＋同一方＋同一 t 只算一次）。
    //       每一次給自己的節點預算 ctx.nullNodes（巢狀的取最小）；碰到了，這個 m 算「沒分類完」，
    //       這個節點的「不勝」就標成沒證明（ctx.sTaint），最後的 safe 會變成 unknown（原因 'nullmove-budget'）。
    //       lam：第三段還能巢狀幾層（照定義不設上限時，實際上限是剩下的威脅數；opts.lambda 可以設上限，見 README）。
    //       lam＝0 時沒有第三段：威脅著＝便宜的篩＋空著後 VCF（文獻上的 λ² 著法，λ-search：Thomsen 2000）；lam＝1 多了
    //       「空著後 λ² 必勝」的著法（λ³），依此類推。
    // 多試幾手不在定義裡的著法不會讓 win 變假（守方仍窮舉全盤），所以 hint（守方上一個應手之後贏的那一手）不論哪一段都先試。
    function threatSearch(ctx, b, p, t, hint, lam) {
      var rule = ctx.rule, seen = new Uint8Array(SIZE * SIZE), taint = false, i, m, sub;
      function attempt(mv) {
        I.place(ctx, b, mv.r, mv.c, p);
        try {
          var s = sD(ctx, b, p, t - 1, lam);
          if (s) return [pt(mv)].concat(s);
          if (ctx.sTaint) taint = true;
          return null;
        } finally { I.unplace(ctx, b, mv.r, mv.c, p); }
      }
      if (hint && inside(hint.r, hint.c) && !b[hint.r][hint.c] && !forbiddenFor(ctx, b, hint.r, hint.c, p)) {
        seen[hint.r * SIZE + hint.c] = 1;
        if ((sub = attempt(hint))) return sub;
      }
      // 一、便宜的篩
      var cheap = I.attackMoves(b, p, rule, true);
      for (i = 0; i < cheap.length; i++) {
        m = cheap[i];
        if (seen[m.r * SIZE + m.c]) continue;
        seen[m.r * SIZE + m.c] = 1;
        if ((sub = attempt(m))) return sub;
      }
      // 其餘候選（評分高的在前）
      var rest = [], list = I.analyze(b, p, rule).sort(function (x, y) { return y.score - x.score; });
      for (i = 0; i < list.length; i++) {
        m = list[i];
        if (seen[m.r * SIZE + m.c]) continue;
        seen[m.r * SIZE + m.c] = 1;
        rest.push({ r: m.r, c: m.c }); // analyze 已排除連珠黑棋的禁手點
      }
      // 捷徑（不改變結果）：守方若在攻方放棄這一手時就有 VCF（DV），其餘候選 m 下了之後守方仍有 VCF 的，守方照 VCF 走就贏
      // （m 不成四，攻方沒有成五點可以打斷）——試 m 的結果一定是「不勝」，不必做空著測試。先用 DV 原樣重走（vcfReplay），不成立再重找。
      var o = 3 - p, DV = sVCF(ctx, b, o, S_VCF_PLIES, null, null, null);
      // 捷徑（不改變結果，只用在自由規則）：這個局面攻方沒有 VCF（sA 剛查過）。VCF 搜尋只看「下過的點」四條線前後 4 格內的格子，
      // 所以 m 不在那些格子裡（zone）、m 的四條線前後 4 格內也沒有任何「攻方下了成四」的空點時，下 m 之後 VCF 的搜尋樹一模一樣，
      // 一樣沒有 VCF，不必再找。連珠規則的禁手判定會看得更遠，不用這個捷徑。
      var zone = rule === 'free' && rest.length ? vcfZone(ctx, b, p) : null;
      // 自由規則（和連珠的白棋攻方）：這個局面攻方的成四點算一次，下 m 之後的 VCF 從這裡增量產生（sVCF 的 prev）
      var F0 = (rule === 'free' || p === 2) && rest.length ? I.fourMoves(b, p, rule) : null;
      // 二、空著後 VCF
      var later = [];
      for (i = 0; i < rest.length; i++) {
        m = rest[i];
        var v, dead = false;
        I.place(ctx, b, m.r, m.c, p);
        try {
          if (DV) dead = I.vcfReplay(b, o, rule, DV, m) || !!sVCF(ctx, b, o, S_VCF_PLIES, null, null, null);
          if (dead) v = null;
          else if (zone && !zone[m.r * SIZE + m.c] && !fourNear(b, m, p)) v = null;
          else v = sVCF(ctx, b, p, S_VCF_PLIES, null, F0, m);
        } finally { I.unplace(ctx, b, m.r, m.c, p); }
        if (dead) continue;
        if (!v) { later.push(m); continue; }
        if ((sub = attempt(m))) return sub;
      }
      // 三、空著後遞迴（t−1 為 0 時就是第二段，不用再做）
      if (t - 1 >= 1 && lam >= 1) {
        for (i = 0; i < later.length; i++) {
          m = later[i];
          var nt = nullTest(ctx, b, p, t - 1, m, lam - 1);
          if (nt === 'cut') { taint = true; continue; }
          if (!nt) continue;
          if ((sub = attempt(m))) return sub;
        }
      }
      ctx.sTaint = taint;
      return null;
    }

    // 攻方 p（輪 p 走、沒有 VCF）重新找一次 VCF（新的失敗表，才能記到整棵搜尋樹），回傳「下過的點四條線前後 4 格內」的格子標記。
    function vcfZone(ctx, b, p) {
      var saveFail = ctx.vcfFail, touch = new Uint8Array(SIZE * SIZE), zone = new Uint8Array(SIZE * SIZE), v, i, d, k;
      ctx.vcfFail = new Map();
      ctx.vcfTouch = touch;
      try { v = sVCF(ctx, b, p, S_VCF_PLIES, null, null, null); } finally { ctx.vcfTouch = null; ctx.vcfFail = saveFail; }
      if (v) return null;
      for (i = 0; i < SIZE * SIZE; i++) {
        if (!touch[i]) continue;
        var r = (i / SIZE) | 0, c = i % SIZE;
        for (d = 0; d < 4; d++)
          for (k = -4; k <= 4; k++) {
            var rr = r + DIRS[d][0] * k, cc = c + DIRS[d][1] * k;
            if (inside(rr, cc)) zone[rr * SIZE + cc] = 1;
          }
      }
      return zone;
    }

    // m（棋盤上已有攻方 p 的子）四條線前後 4 格內，有沒有「攻方下了在這條線上成四以上」的空點
    function fourNear(b, m, p) {
      for (var d = 0; d < 4; d++)
        for (var k = -4; k <= 4; k++) {
          if (!k) continue;
          var r = m.r + DIRS[d][0] * k, c = m.c + DIRS[d][1] * k;
          if (inside(r, c) && !b[r][c] && I.shapeAt(b, r, c, p, DIRS[d][0], DIRS[d][1]) >= I.RUSH4) return true;
        }
      return false;
    }

    // 下 m、守方空著：攻方 k 次威脅內必勝嗎？回傳 true、false，或 'cut'（碰到空著測試的節點預算，或結果沒證明完）。
    function nullTest(ctx, b, p, k, m, lam) {
      var saved = ctx.nullLimit;
      ctx.nullLimit = Math.min(saved, ctx.sNodes + ctx.nullNodes);
      ctx.nullStat.tests++;
      I.place(ctx, b, m.r, m.c, p);
      try {
        var r = sA(ctx, b, p, k, null, lam);
        if (r) { ctx.nullStat.wins++; return true; }
        return ctx.sTaint ? 'cut' : false;
      } catch (e) {
        if (e !== NULL_BUDGET || ctx.sNodes > saved) throw e; // 外層的預算也用完了：交給外層
        ctx.nullStat.cut++;
        return 'cut';
      } finally {
        I.unplace(ctx, b, m.r, m.c, p);
        ctx.nullLimit = saved;
      }
    }

    // 守方 o＝3−p 走、攻方剩 t 次威脅。回傳攻方勝的手順（沿守方第一個應手展開）或 null（守方有一手守得住）。
    // 回傳 null 時 ctx.sTaint 見 sA。
    function sD(ctx, b, p, t, lam) {
      tick(ctx);
      lam = normLam(lam, t);
      var o = 3 - p, rule = ctx.rule;
      ctx.sTaint = false;
      if (I.allFivePoints(b, o, rule).length) return null;
      var fp = I.allFivePoints(b, p, rule);
      if (fp.length >= 2) return [];
      if (fp.length === 1) {
        var f = fp[0];
        if (forbiddenFor(ctx, b, f.r, f.c, o)) return [];
        I.place(ctx, b, f.r, f.c, o);
        try {
          var s1 = sA(ctx, b, p, t, null, lam);
          return s1 ? [pt(f)].concat(s1) : null;
        } finally { I.unplace(ctx, b, f.r, f.c, o); }
      }
      var key = I.ttKey(ctx, o), chk = I.ttCheck(ctx, o), hit = ttGet(ctx.sdt, key, chk, t, lam);
      if (hit !== undefined) { ctx.sTaint = false; return hit; }
      var res = sDefend(ctx, b, p, t, lam), taint = !res && ctx.sTaint;
      if (res || !taint) ttPut(ctx.sdt, key, chk, t, lam, res);
      ctx.sTaint = taint;
      return res;
    }

    // 守方的應手：找到一手「攻方證明不了必勝」就守住。那一手的「不勝」若沒證明完（sTaint），先記著、繼續找乾淨的；
    // 找不到乾淨的，而其餘都被證明會輸，就回傳 null 並標 sTaint。
    function sDefend(ctx, b, p, t, lam) {
      var o = 3 - p, rule = ctx.rule, i, d, k, q, sub, line = null, hint = null, tried = null, held = false;
      if (sVCF(ctx, b, o, S_VCF_PLIES, null, null, null)) { ctx.sTaint = false; return null; } // 守方有 VCF（攻方沒有成五點，守方連續沖四就贏）
      // 第一輪：攻方有 W4 點時，先試破掉 W4 點的防點（多半第一個就守得住，省下後面的 VCF）
      var w4 = I.threatPoints(b, p, rule);
      if (w4.length) {
        var defs = I.defenseSet(ctx, b, p, w4);
        tried = new Uint8Array(SIZE * SIZE);
        for (i = 0; i < defs.length; i++) {
          q = defs[i];
          tried[q.r * SIZE + q.c] = 1;
          I.place(ctx, b, q.r, q.c, o);
          try { sub = sA(ctx, b, p, t, hint, lam); } finally { I.unplace(ctx, b, q.r, q.c, o); }
          if (!sub) { if (!ctx.sTaint) return null; held = true; continue; }
          if (!line) line = [pt(q)].concat(sub);
          if (sub.length) hint = sub[0];
        }
      }
      var L = sVCF(ctx, b, p, S_VCF_PLIES, null, null, null); // 守方放棄這一手時，攻方的 VCF
      var fours = I.fourMoves(b, o, rule), Lp = L ? L.map(pt) : null, near = null;
      // 自由規則：守方下的點若不在 L 任一點四條線前後 4 格內、本身也不是反四，L 的每一手（攻方的四、成五點，守方的擋點
      // 會不會成五成四）都不受影響，攻方照 L 走一樣贏，不必重走。連珠規則的禁手判定會牽動更遠的點，一律重走（vcfReplay）。
      if (L && rule === 'free') {
        near = new Uint8Array(SIZE * SIZE);
        for (i = 0; i < fours.length; i++) near[fours[i].r * SIZE + fours[i].c] = 1;
        for (i = 0; i < L.length; i++)
          for (d = 0; d < 4; d++)
            for (k = -4; k <= 4; k++) {
              var rr = L[i].r + DIRS[d][0] * k, cc = L[i].c + DIRS[d][1] * k;
              if (inside(rr, cc)) near[rr * SIZE + cc] = 1;
            }
      }
      var order = orderDefense(ctx, b, p, L, fours);
      for (i = 0; i < order.length; i++) {
        q = order[i];
        if (tried && tried[q.r * SIZE + q.c]) continue;
        if (near && !near[q.r * SIZE + q.c]) sub = Lp;
        else {
          I.place(ctx, b, q.r, q.c, o);
          try {
            sub = L && I.vcfReplay(b, p, rule, L, q) ? Lp : sA(ctx, b, p, t, hint, lam);
          } finally { I.unplace(ctx, b, q.r, q.c, o); }
        }
        if (!sub) { if (!ctx.sTaint) return null; held = true; continue; }
        if (!line) line = [pt(q)].concat(sub);
        if (sub.length) hint = sub[0];
      }
      if (held) { ctx.sTaint = true; return null; }
      ctx.sTaint = false;
      return line || [];
    }

    // 守方的全部合法點，依可能守得住的程度排：破掉攻方 W4 點的防點、L 上的點、守方的反四（fours）、L 各點四線 4 格內、
    // （沒有 L 時）守方評分由高到低、其餘全盤。連珠黑棋不含禁手點。
    function orderDefense(ctx, b, p, L, fours) {
      var o = 3 - p, rule = ctx.rule, seen = new Uint8Array(SIZE * SIZE), out = [], i, d, k;
      function add(r, c) {
        if (!inside(r, c) || b[r][c]) return;
        var idx = r * SIZE + c;
        if (seen[idx]) return;
        seen[idx] = 1;
        if (forbiddenFor(ctx, b, r, c, o)) return;
        out.push({ r: r, c: c });
      }
      var w4 = I.threatPoints(b, p, rule);
      if (w4.length) I.defenseSet(ctx, b, p, w4).forEach(function (m) { add(m.r, m.c); });
      if (L) for (i = 0; i < L.length; i++) add(L[i].r, L[i].c);
      (fours || I.fourMoves(b, o, rule)).forEach(function (m) { add(m.r, m.c); });
      if (L) {
        for (i = 0; i < L.length; i++)
          for (d = 0; d < 4; d++)
            for (k = -4; k <= 4; k++) if (k) add(L[i].r + DIRS[d][0] * k, L[i].c + DIRS[d][1] * k);
      } else {
        var list = I.analyze(b, o, rule).sort(function (x, y) { return y.score - x.score; });
        for (i = 0; i < list.length; i++) add(list[i].r, list[i].c);
      }
      for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) add(r, c);
      return out;
    }

    // 輪 p 走，1..T 次威脅逐次加深；外層是空著測試的巢狀層數 lam＝0、1、…（便宜的勝法先找到，第十二批）。
    // 回傳 { line, threats（找到的那一輪用了幾次威脅；不一定是最少）} 或 null；超過預算丟 BUDGET／TIMEOUT。
    function solve(ctx, b, p, T) {
      var L = Math.min(ctx.lamMax, T > 1 ? T - 1 : 0);
      for (var lam = 0; lam <= L; lam++)
        for (var t = 1; t <= T; t++) {
          var r = sA(ctx, b, p, t, null, lam);
          if (r) return { line: r, threats: t };
        }
      return null;
    }

    // 第十二批：unknown 帶 reason——'nodes'（節點預算）、'time'（時間預算）、'nullmove-budget'（整棵樹搜完了，
    // 但有空著測試碰到自己的節點預算、沒分類完，所以「證明不了必勝」不成立）。nullStat：空著測試（第三段）做了幾次、幾次成立、幾次被截斷。
    function run(ctx, fn) {
      var t0 = now(ctx.cw.once);
      var out;
      try {
        var r = fn();
        if (!r && ctx.sTaint) out = { status: 'unknown', reason: 'nullmove-budget', line: null, threats: null };
        else out = { status: r ? 'win' : 'safe', line: r ? r.line : null, threats: r ? r.threats : null };
      } catch (e) {
        if (e !== BUDGET && e !== I.TIMEOUT) throw e;
        out = { status: 'unknown', reason: e === I.TIMEOUT ? 'time' : ctx.why || 'nodes', line: null, threats: null };
      }
      out.nodes = ctx.sNodes; out.ms = Math.round(now(ctx.cw.once) - t0); out.nullStat = ctx.nullStat;
      out.lambda = ctx.lamMax >= 99 ? null : ctx.lamMax; // null＝照定義不設上限
      return out;
    }

    function ruleOf(opts) { return opts && opts.rule === 'renju' ? 'renju' : 'free'; }

    function verify(board, attacker, T, opts) {
      opts = opts || {};
      var p = attacker === 2 ? 2 : 1, b = copy(board), ctx = newCtx(b, ruleOf(opts), opts);
      return run(ctx, function () { return solve(ctx, b, p, T); });
    }

    function verifyAfter(board, defender, move, T, opts) {
      opts = opts || {};
      var d = defender === 2 ? 2 : 1, rule = ruleOf(opts), b = copy(board);
      if (!inside(move.r, move.c) || b[move.r][move.c] || (rule === 'renju' && d === 1 && G.isForbidden(b, move.r, move.c)))
        return { status: 'illegal', line: null, threats: null, nodes: 0, ms: 0 };
      b[move.r][move.c] = d;
      if (G.checkWin(b, move.r, move.c, rule)) return { status: 'safe', line: null, threats: null, nodes: 0, ms: 0, defenderWins: true };
      var ctx = newCtx(b, rule, opts);
      return run(ctx, function () { return solve(ctx, b, 3 - d, T); });
    }

    // 攻方 attacker 下 move 之後（輪守方），守方怎麼應都擋不住嗎（攻方在 T 次威脅內成五；move 本身不算一次）？攻擊題的正解用這個驗。
    function verifyReply(board, attacker, move, T, opts) {
      opts = opts || {};
      var p = attacker === 2 ? 2 : 1, rule = ruleOf(opts), b = copy(board);
      if (!inside(move.r, move.c) || b[move.r][move.c] || (rule === 'renju' && p === 1 && G.isForbidden(b, move.r, move.c)))
        return { status: 'illegal', line: null, threats: null, nodes: 0, ms: 0 };
      b[move.r][move.c] = p;
      if (G.checkWin(b, move.r, move.c, rule)) return { status: 'win', line: [], threats: 0, nodes: 0, ms: 0 };
      var ctx = newCtx(b, rule, opts);
      return run(ctx, function () {
        var L = Math.min(ctx.lamMax, T > 1 ? T - 1 : 0);
        for (var lam = 0; lam <= L; lam++)
          for (var t = 0; t <= T; t++) {
            var r = sD(ctx, b, p, t, lam);
            if (r) return { line: r, threats: t };
          }
        return null;
      });
    }

    function followUp(board, defender, move, T, opts) {
      opts = opts || {};
      var d = defender === 2 ? 2 : 1, a = 3 - d, rule = ruleOf(opts), b = copy(board);
      b[move.r][move.c] = d;
      if (!I.allFivePoints(b, d, rule).length || G.checkWin(b, move.r, move.c, rule)) return null;
      var exchange = [];
      // 連續強制應手：守方有成五點 → 攻方擋；攻方擋完若有成五點 → 守方擋；…直到輪守方、攻方沒有成五點
      for (var guard = 0; guard < 20; guard++) {
        var dv = I.allFivePoints(b, d, rule);
        if (!dv.length) break;
        if (dv.length >= 2) return { exchange: exchange, needed: false, defenderWins: true };
        if (I.allFivePoints(b, a, rule).length) return { exchange: exchange, needed: true, move: null, status: 'win' };
        b[dv[0].r][dv[0].c] = a; exchange.push(pt(dv[0]));
        var av = I.allFivePoints(b, a, rule);
        if (!av.length) break;
        if (av.length >= 2 || forbiddenFor({ rule: rule }, b, av[0].r, av[0].c, d)) return { exchange: exchange, needed: true, move: null, status: 'win' };
        b[av[0].r][av[0].c] = d; exchange.push(pt(av[0]));
      }
      // 整個 followUp 共用一份時間預算（放棄檢查＋逐點找守得住的那一手）
      var end = now(I.clockW(rule).once) + (opts.timeLimit > 0 ? opts.timeLimit : DEFAULT_MS);
      function left() { return { maxNodes: opts.maxNodes, timeLimit: Math.max(1, end - now(I.clockW(rule).once)), lambda: opts.lambda, nullNodes: opts.nullNodes }; }
      var ctx = newCtx(b, rule, left()), out = { exchange: exchange, needed: true, move: null, status: 'unknown' };
      var pass = run(ctx, function () { return solve(ctx, b, a, T); });
      if (pass.status === 'safe') return { exchange: exchange, needed: false };
      if (pass.status === 'unknown') { out.needed = 'unknown'; return out; }
      // 放棄這一手會輸：找守得住的那一手（依 orderDefense 的順序，第一個查得完、攻方證明不了必勝的點）
      var L = null;
      try { L = sVCF(ctx, b, a, S_VCF_PLIES, null, null, null); } catch (e) { if (e !== I.TIMEOUT) throw e; }
      var order = orderDefense(ctx, b, a, L, null), sawUnknown = false;
      for (var i = 0; i < order.length; i++) {
        if (now(I.clockW(rule).once) >= end) { sawUnknown = true; break; }
        var q = order[i];
        b[q.r][q.c] = d;
        var c2 = newCtx(b, rule, left());
        var r = run(c2, function () { return solve(c2, b, a, T); });
        b[q.r][q.c] = 0;
        if (r.status === 'safe') { out.move = pt(q); out.status = 'safe'; return out; }
        if (r.status === 'unknown') sawUnknown = true;
      }
      out.status = sawUnknown ? 'unknown' : 'win';
      return out;
    }

    // _vcf：只給測試比對 sVCF 和遊戲內 vcf（輪 p 走，board 不改動）；prevBoard 給了就用「prevBoard 的成四點＋add」增量產生
    function testVCF(board, p, rule, add) {
      var b = copy(board), ctx = newCtx(b, rule === 'renju' ? 'renju' : 'free', {});
      var prev = null;
      if (add) { b[add.r][add.c] = 0; prev = I.fourMoves(b, p, ctx.rule); b[add.r][add.c] = p; ctx = newCtx(b, ctx.rule, {}); }
      return sVCF(ctx, b, p, S_VCF_PLIES, null, prev, add || null);
    }
    return { verify: verify, verifyAfter: verifyAfter, verifyReply: verifyReply, followUp: followUp, _vcf: testVCF };
  }

  var API = {
    SIZE: SIZE,
    EXPERT_TIME_LIMIT: EXPERT_TIME_LIMIT,
    HARD_TIME_LIMIT: HARD.time,
    createBoard: createBoard,
    checkWin: checkWin,
    isFull: isFull,
    isForbidden: isForbidden,
    findVCF: findVCF,
    findVCT: findVCT,
    researchWin: researchWin, researchSearch: researchSearch, // v0.5.15（規格 AU 第二版）：擺棋盤研究
    forcedWinAfter: forcedWinAfter,
    rankMoves: rankMoves,
    winWithin: winWithin,
    getMove: getMove,
    TIERS: TIERS,
    tierOf: tierOf,
    tierName: tierName,
    migrateTier: migrateTier,
    TIER_ORDER: TIER_ORDER, // v0.5.13（規格 AF）
    tierRank: tierRank,
    detectOpening: detectOpening,
    detectOpeningSym: detectOpeningSym, symPoint: symPoint, symPointInv: symPointInv, // v0.5.18（規格 AQ）：開局介紹的小棋盤照這盤的方向畫
    listThreats: listThreats,
    analyzeGame: analyzeGame,
    analyzeGameInit: analyzeGameInit,
    analyzeGameStep: analyzeGameStep,
    analyzeGameSummary: analyzeGameSummary,
    // 第十四批：整盤檢查（analyzeGame）的威脅次數上限，介面的免責句讀這個數（不在介面另寫一份）
    ANALYZE_THREATS: ANALYZE_THREATS,
    // 第七批：只給嚴格驗證（makeStrict）、離線工具與測試用的內部函式，遊戲流程不用
    _internal: {
      now: now, DIRS: DIRS, TIMEOUT: TIMEOUT, VCF_PLIES: VCF_PLIES,
      newCtx: newCtx, place: place, unplace: unplace, ttKey: ttKey, ttCheck: ttCheck, candidates: candidates, analyze: analyze,
      allFivePoints: allFivePoints, fivePointsNear: fivePointsNear, makesFive: makesFive, fourMoves: fourMoves,
      isW4Move: isW4Move, is43Point: is43Point, threatPoints: threatPoints, defenseSet: defenseSet,
      forcedMoves: forcedMoves, threeBlocks: threeBlocks,
      attackMoves: attackMoves, vcf: vcf, vcfReplay: vcfReplay, completeLine: completeLine, finishLine: finishLine,
      shapeAt: shapeAt, RUSH4: RUSH4, LIVE4: LIVE4, pointScore: pointScore,
      TENGEN: TENGEN, // 天元的參數物件（tools/depth-stats.js 量 VCT 參數時直接改）
      // 天元開局庫（規格 AI）：tengenBookMoves(盤, 輪誰, 規則, 子數) → 庫裡的著法（原局面座標）或 null；setTengenBook(資料／null／undefined) 測試用
      tengenBookMoves: tengenBookMoves, setTengenBook: setTengenBook, symPoint: symPoint,
      findBetterMove: findBetterMove, setClockScale: setClockScale, setClock: setClock, EARLY_STOP: EARLY_STOP, shouldStop: shouldStop,
      // 時鐘權重與表上限（2026-10-02）：CLOCK_W 各讀時鐘處的權重（工具可讀；量校準時可暫時改成標籤）、NODE_STEP 節點時鐘預設的虛擬 ms／單位；
      // setTableCap(n)（四張表都改成 n；0＝不設上限；null＝還原預設 TABLE_CAP）；tableStats() → { cap, clears（各表清過幾次，累計）, last（上一次強檔搜尋結束時各表筆數） }
      CLOCK_W: CLOCK_W, clockW: clockW, NODE_STEP: NODE_STEP, TABLE_CAP: TABLE_CAP,
      setTableCap: setTableCap,
      tableStats: function () {
        return { cap: { tt: capTT, vcfFail: capFail, vtt: capVtt }, clears: { tt: capClears.tt, vcfFail: capClears.vcfFail, vtt1: capClears.vtt1, vtt2: capClears.vtt2 }, last: lastTables };
      },
      resetTableStats: function () { capClears = { tt: 0, vcfFail: 0, vtt1: 0, vtt2: 0 }; lastTables = null; },
      setExtendVCT: function (on) { EXTEND_VCT = !!on; }, extendVCT: function () { return EXTEND_VCT; },
      // 天元步驟 2：增量型態快取的開關（量加速用；預設開）、除錯自我檢查（預設關；開著時每次讀快取都和整盤重算比對，不同就丟例外）、
      // 自我檢查做過幾次比對（工具與測試用來報告樣本數）
      setShapeCache: function (on) { cacheEnabled = !!on; },
      setCacheCheck: function (on) { cacheCheck = !!on; },
      cacheCheckCount: function () { return cacheChecks; }
    }
  };
  // 第十批：嚴格驗證（見上面 makeStrict）。復盤的 findBetterMove 用 STRICT，工具與測試用 Gomoku.strict（同一個物件）。
  STRICT = API.strict = makeStrict(API);
  return API;
});
