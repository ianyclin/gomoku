// 局後復盤（規格 A、C、G 的復盤部分）：控制列、Worker 逐手分析、威脅標記、敗著／較好下法／妙手、必勝手順播放、說明句、複製棋譜。
// 分析本身在引擎（ai-worker.js 的 'analyze' 訊息）；這裡只負責顯示。app.js 用 GReview.init(deps) 把棋盤與工具交進來。
(function () {
  'use strict';
  var G = window.Gomoku;
  var I = window.I18N;
  var t = I.t;
  var N = G.SIZE;
  var MAX_MARKS = 6;
  // 第八批 b：標記的顏色由棋盤風格提供（themes.js 的 mk）。棋盤上傳標記名，棋盤繪圖照目前風格上色；
  // 圖例用 hex() 換成色碼。沒載入 themes.js 時退回經典的顏色。
  // 第十二批 c：unverified 不再畫淡綠圈（betterWeak 的顏色留在 themes.js，這裡不用）
  var COLOR = { own: 'own', opp: 'opp', losing: 'losing', better: 'better', brilliant: 'brilliant' };
  var CLASSIC = { own: '#12a38f', opp: '#c2185b', losing: '#e0261b', better: '#1e9e3a', brilliant: '#1f6fd1' };
  function hex(k) { return window.GThemes ? window.GThemes.color(k) : CLASSIC[k] || k; }

  var D = null;     // app.js 交進來的工具
  var R = null;     // 目前的復盤
  var cache = {};   // 同一局（同樣手順）不重跑分析

  function $(id) { return document.getElementById(id); }
  function mk(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function pt(m) {
    if (!m) return null;
    if (Array.isArray(m)) return { r: m[0], c: m[1] };
    if (typeof m.r === 'number') return { r: m.r, c: m.c };
    if (m.move) return pt(m.move);
    return null;
  }
  // 點的清單；引擎的活四／活三項目是 { points, stones }，取 points（成五點／成活四點）
  function ptList(list) {
    var out = [];
    (list || []).forEach(function (m) {
      if (m && Array.isArray(m.points)) out = out.concat(ptList(m.points));
      else { var q = pt(m); if (q) out.push(q); }
    });
    return out;
  }

  function boardAt(n) {
    var b = G.createBoard();
    for (var i = 0; i < n; i++) b[R.moves[i].r][R.moves[i].c] = R.moves[i].p;
    return b;
  }

  // p 下一手就能成五的點（連珠黑棋只算剛好五）
  function fivePoints(board, p, rule) {
    var out = [];
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        if (board[r][c]) continue;
        board[r][c] = p;
        var w = G.checkWin(board, r, c, rule);
        board[r][c] = 0;
        if (w && w.player === p) out.push({ r: r, c: c });
      }
    }
    return out;
  }

  // 引擎（ai.js analyzeGameStep）回傳的每手結果 → 這裡用的形狀。
  // winningLine 是「下完這手後對手」的必勝手順（補到成五）；只有第一個會輸的手 losingMove 為 true。
  function norm(res) {
    if (!res) return null;
    var wl = res.winningLine, line = null, kind = res.winningKind || null;
    if (Array.isArray(wl)) line = ptList(wl);
    else if (wl && (wl.line || wl.moves)) { line = ptList(wl.line || wl.moves); kind = kind || wl.type || wl.kind || null; }
    return {
      threats: res.threatsBefore || null,
      losing: !!res.losingMove,
      better: pt(res.betterMove),
      betterStatus: res.betterStatus || null,
      // 第十批：found 的較好下法有過嚴格驗證（'strict6'）；none 時電腦查了幾個候選
      betterVerified: res.betterVerified || null,
      betterChecked: typeof res.betterChecked === 'number' ? res.betterChecked : null,
      line: line && line.length ? line : null,
      kind: kind ? String(kind).toLowerCase() : null,
      brilliant: !!res.brilliant,
      forbidden: res.forbidden || null,
      win: !!res.win,
      // 這手之前沒算完的手數（第六批引擎契約；舊引擎沒有這欄時 null，改由這裡自己數）
      uncertainBefore: typeof res.uncertainBefore === 'number' ? res.uncertainBefore : null,
      analyzed: res.analyzed !== false
    };
  }

  // 分析沒回來（引擎不能分析）時，嚴格模式的禁手那一手照樣標出來
  function resultAt(i) {
    var x = R.results[i] || null;
    if (!x && i === R.forbIdx) return { forbidden: R.info.forbidden || true, analyzed: true };
    return x;
  }

  // 這一手沒算完（引擎回 analyzed:false，或整盤時間用完沒輪到）→ 畫面上用灰色標出。引擎不能分析時不標。
  function unanalyzed(i) {
    var x = resultAt(i);
    if (x) return !x.analyzed && !x.forbidden;
    return R.state !== 'running' && R.state !== 'failed' && i < R.total;
  }

  function firstLosing() {
    for (var i = 0; i < R.N; i++) {
      var x = resultAt(i);
      if (x && (x.losing || (x.forbidden && i === R.forbIdx && !R.results[i]))) return i;
    }
    return -1;
  }

  // ---------------------------------------------------------- 整盤摘要（第六批：誠實交代沒算完的部分）
  // 引擎在 analyzeDone 帶 summary { firstLosing, unanalyzedCount, unanalyzedBeforeLosing, tailUnanalyzed, forbiddenLoss }；
  // 沒帶（舊引擎、同步版、還在分析中）時從逐手結果自己算。兩邊算法一致：
  //   沒算完＝analyzed:false（或整盤結束了還沒輪到）；成五、禁手那一手本身不算。

  function countUnanalyzed(from, to) {
    var k = 0;
    for (var i = from; i < to; i++) if (unanalyzed(i)) k++;
    return k;
  }
  // 尾巴一整段沒算完的手數（最後一手是成五或禁手時跳過它往前數）
  function tailCount() {
    var j = R.N - 1, x = resultAt(j);
    if (x && (x.win || x.forbidden)) j--;
    var k = 0;
    while (j >= 0 && unanalyzed(j)) { k++; j--; }
    return k;
  }
  // 嚴格模式黑棋下禁手判負的那一手：{ i, kind }；沒有就 null
  function forbiddenLoss() {
    var sm = R.summary && R.summary.forbiddenLoss, i, x;
    if (sm && typeof sm === 'object' && typeof sm.index === 'number') {
      x = resultAt(sm.index);
      return { i: sm.index, kind: sm.kind || (x && typeof x.forbidden === 'string' ? x.forbidden : R.info.forbidden) };
    }
    if (typeof sm === 'number' && sm >= 0) {
      x = resultAt(sm);
      return { i: sm, kind: x && typeof x.forbidden === 'string' ? x.forbidden : R.info.forbidden };
    }
    for (i = 0; i < R.N; i++) {
      x = resultAt(i);
      if (x && x.forbidden) return { i: i, kind: typeof x.forbidden === 'string' ? x.forbidden : R.info.forbidden };
    }
    return null;
  }
  // 第 i 手（敗著）之前沒算完的手數：摘要 → 那一手的 uncertainBefore → 自己數
  function uncertainBefore(i, isFirstLosing) {
    var sm = R.summary;
    if (isFirstLosing && sm && typeof sm.unanalyzedBeforeLosing === 'number') return sm.unanalyzedBeforeLosing;
    var x = resultAt(i);
    if (x && typeof x.uncertainBefore === 'number') return x.uncertainBefore;
    return countUnanalyzed(0, i);
  }
  function unanalyzedTotal() {
    var sm = R.summary;
    return sm && typeof sm.unanalyzedCount === 'number' ? sm.unanalyzedCount : countUnanalyzed(0, R.N);
  }
  function tailUnanalyzed() {
    var sm = R.summary, v = sm ? sm.tailUnanalyzed : null;
    if (typeof v === 'number') return v;
    if (v === true) return Math.max(1, tailCount());
    if (v === false) return 0;
    return tailCount();
  }

  // 威脅清單可能的形狀：{1:T,2:T}、{black,white}、{own,opp}（輪走方視角）、[T1,T2]
  function threatsOf(tb, p, toMove) {
    if (!tb) return null;
    if (tb[p] && typeof tb[p] === 'object' && !Array.isArray(tb[p])) return tb[p];
    var nm = p === 1 ? 'black' : 'white';
    if (tb[nm]) return tb[nm];
    if (tb.own || tb.opp) return p === toMove ? tb.own || null : tb.opp || null;
    if (Array.isArray(tb)) return tb[p - 1] || null;
    return null;
  }
  function markPoints(T) {
    if (!T) return [];
    var seen = {}, out = [];
    [T.openFours, T.fours, T.threes].forEach(function (list) {
      ptList(list).forEach(function (q) {
        var k = q.r * N + q.c;
        if (seen[k] || out.length >= MAX_MARKS) return;
        seen[k] = 1;
        out.push(q);
      });
    });
    return out;
  }

  function lineOf(i) {
    var x = resultAt(i);
    if (!x || !x.line) return null;
    return { line: x.line, attacker: 3 - R.moves[i].p }; // 攻方＝下這手的對手
  }

  function view() {
    var n = R.n, b = boardAt(n);
    var toMove = n < R.N ? R.moves[n].p : (n ? 3 - R.moves[n - 1].p : 1);
    var v = { board: b, coords: true, last: n ? R.moves[n - 1] : null };
    // v0.5.14（規格 AU）：棋子上顯示手數（「手數」膠囊，預設開）：只編到目前這一步
    if (D.numsOn && D.numsOn()) v.nums = R.moves.slice(0, n);
    var finalPos = n === R.N && R.info.over;
    if (R.info.rule === 'renju' && toMove === 1 && !finalPos) v.forbidden = true;
    if (finalPos && n) {
      var lm = R.moves[n - 1], w = G.checkWin(b, lm.r, lm.c, R.info.rule);
      if (w) v.winCells = w.cells;
      // v0.5.6（複審）：禁手輸的那盤，最後一手和對局一樣畫讓它變成禁手的線＋那顆子上的紅 ×（v.endForbid；線算一次記在 R.endForbid）
      if (R.info.end === 'forbidden' && D.forbidLines) {
        if (!R.endForbid) R.endForbid = { r: lm.r, c: lm.c, lines: D.forbidLines(b, lm) };
        v.endForbid = R.endForbid;
      }
    }
    var cur = R.results[n];
    if (cur && cur.threats) {
      var own = markPoints(threatsOf(cur.threats, toMove, toMove));
      var opp = markPoints(threatsOf(cur.threats, 3 - toMove, toMove));
      v.marks = own.map(function (q) { return { r: q.r, c: q.c, color: COLOR.own }; })
        .concat(opp.map(function (q) { return { r: q.r, c: q.c, color: COLOR.opp }; }));
    }
    if (n > 0) {
      var prev = resultAt(n - 1), lm2 = R.moves[n - 1];
      if (prev && (prev.losing || prev.forbidden)) {
        v.frames = [{ r: lm2.r, c: lm2.c, color: COLOR.losing }];
        // 第十二批 c：unverified（沒驗完）不推薦任何點、不畫圈——新引擎這時 betterMove 是 null，舊引擎仍帶點，也不畫
        if (prev.better && prev.betterStatus !== 'unverified') v.rings = [{ r: prev.better.r, c: prev.better.c, color: COLOR.better, dash: true }];
      } else if (prev && prev.brilliant) v.frames = [{ r: lm2.r, c: lm2.c, color: COLOR.brilliant }];
      var L = lineOf(n - 1);
      if (L) {
        var upto = R.play ? R.play.step : L.line.length;
        v.ghosts = L.line.slice(0, upto).map(function (q, k) {
          return { r: q.r, c: q.c, p: k % 2 ? 3 - L.attacker : L.attacker, num: k + 1 };
        });
      }
    }
    // v0.5.15（規格 AU 第二版）：盤上畫著帶編號的半透明子（這條路、播放這條路）時，先不寫真的手數——不會同時有兩串 1、2、3；
    // 那條路收起（跳到別步、停在沒有路的那一步）就回來。播放剛開始還沒擺出第一顆時也先藏（不閃一下）
    if (v.nums && ((v.ghosts && v.ghosts.length) || R.play)) v.nums = null;
    return v;
  }

  function redraw() { if (R) D.boardView.draw(view()); }

  // ---------------------------------------------------------- 說明句

  function moveNo(i) { return i + 1; }

  // 必勝手順的兩個數字（第七批 b）：k＝攻方還要下幾手、n＝整段手順幾手（含守方的應手，到成五為止）。
  // 不再寫「沖四」「活三」這類種類詞：手順裡可能混著別的棋形，寫死會錯。
  function lineCounts(L) { return { k: Math.ceil(L.line.length / 2), n: L.line.length }; }

  // 黑棋要擋的點全是禁手（連珠）
  function forcedForbidden(n) {
    if (R.info.rule !== 'renju' || n === 0) return null;
    var toMove = n < R.N ? R.moves[n].p : 3 - R.moves[n - 1].p;
    if (toMove !== 1) return null;
    var b = boardAt(n);
    if (fivePoints(b, 1, 'renju').length) return null;
    var wf = fivePoints(b, 2, 'renju');
    if (!wf.length) return null;
    for (var i = 0; i < wf.length; i++) if (!G.isForbidden(b, wf[i].r, wf[i].c)) return null;
    return { pt: wf[0], kind: G.isForbidden(b, wf[0].r, wf[0].c) };
  }

  function addLine(box, key, params, cls) {
    var p = mk('p', cls || '');
    p.appendChild(I.node(key, params));
    box.appendChild(p);
    return p;
  }

  function render() {
    if (!R) return;
    var n = R.n;
    $('rvCount').textContent = n + '/' + R.N;
    var range = $('rvRange');
    range.max = String(R.N);
    range.value = String(n);
    $('rvFirst').disabled = $('rvPrev').disabled = n === 0;
    $('rvNext').disabled = $('rvLast').disabled = n === R.N;
    // 沒算完的手：手數變灰、進度條下方在那幾手的位置畫灰塊（第 i 手在進度條的 i+1 格）
    $('rvCount').classList.toggle('rv-gray', n > 0 && unanalyzed(n - 1));
    var marks = $('rvMarks');
    marks.textContent = '';
    for (var mi = 0; mi < R.N; mi++) {
      if (!unanalyzed(mi)) continue;
      var tick = mk('i', 'rv-mark');
      tick.style.left = (100 * (mi + 1) / R.N).toFixed(2) + '%';
      tick.style.width = 'max(3px, ' + (100 / R.N).toFixed(2) + '%)';
      marks.appendChild(tick);
    }

    var info = R.info;
    D.setStatus(t(info.over ? 'review.statusOver' : 'review.statusMid', { result: info.over ? D.endText(info) : '', n: R.N }), info.over ? info.winner : 0, false);
    var op = D.detectOpening(R.moves);
    D.setSubStatus(op ? D.openingLabel(op) : '');

    var panel = $('reviewPanel');
    panel.textContent = '';

    // 1. 分析進度與整局結論
    var sum = mk('div', 'rv-summary');
    var st;
    if (R.state === 'running') st = t('review.analyzing', { i: R.got, n: R.total });
    else if (R.state === 'failed') st = t('review.unavailable');
    else if (R.state === 'partial') {
      var tk = tailUnanalyzed(), lastX = resultAt(R.N - 1);
      var j0 = R.N - 1 - (lastX && (lastX.win || lastX.forbidden) ? 1 : 0);
      st = t('review.partial', { a: Math.max(1, j0 - tk + 2), b: j0 + 1, n: tk,
        why: R.tailWhy === 'total' ? t('review.why.total') : R.tailWhy === 'perMove' ? t('review.why.perMove') : '' });
    }
    else if (R.state === 'empty') st = '';
    else st = t('review.done');
    if (st) sum.appendChild(mk('div', 'rv-progress', st));
    if (R.state === 'running' && R.total) {
      var bar = mk('div', 'rv-pbar');
      var fill = mk('div', 'rv-pfill');
      fill.style.width = Math.round(100 * R.got / R.total) + '%';
      bar.appendChild(fill);
      sum.appendChild(bar);
    }
    var fl = firstLosing(), fb = forbiddenLoss();
    var finished = R.state === 'done' || R.state === 'partial';
    // 敗著（禁手判負那一手本身就是第一個敗著時，只寫禁手那句）
    if (fl >= 0 && !(fb && fb.i === fl)) {
      var row = mk('div', 'rv-first');
      row.appendChild(I.node('review.firstLosing', { n: moveNo(fl), color: D.colorName(R.moves[fl].p), opp: D.colorName(3 - R.moves[fl].p) }));
      if (n !== fl + 1) {
        var jb = mk('button', 'link', t('review.jump'));
        jb.type = 'button';
        jb.addEventListener('click', function () { go(fl + 1); });
        row.appendChild(jb);
      }
      sum.appendChild(row);
    }
    // 嚴格模式黑棋下禁手判負：一定寫，更早另有敗著也寫
    if (fb) {
      // 規格 AK：禁手的種類（三三／四四／長連）可以點，開名詞對照表
      var fbRow = mk('div', 'rv-first rv-forb');
      fbRow.appendChild(I.node('review.forbiddenSummary', {
        n: moveNo(fb.i), color: D.colorName(R.moves[fb.i].p), kind: I.forbiddenTerm(fb.kind), winner: D.colorName(2)
      }));
      sum.appendChild(fbRow);
    }
    var firstBad = fl >= 0 ? fl : fb ? fb.i : -1;
    if (firstBad >= 0) {
      // 敗著之前有沒算完的手：敗著可能更早
      var ub = uncertainBefore(firstBad, firstBad === fl);
      if (ub > 0) sum.appendChild(mk('div', 'rv-uncertain', t('review.uncertainBefore', { n: ub })));
    } else if (finished) {
      // 沒找到敗著：沒算完的手過半就不下「沒有敗著」的結論
      var un = unanalyzedTotal();
      if (un * 2 > R.N) sum.appendChild(mk('div', 'rv-first rv-uncertain', t('review.incomplete', { n: un })));
      else if (un > 0) sum.appendChild(mk('div', 'rv-first', t('review.noLosingSome', { n: un })));
      else sum.appendChild(mk('div', 'rv-first', t('review.noLosing')));
    }
    panel.appendChild(sum);

    // 2. 這一手
    var cur = mk('div', 'rv-move');
    if (n === 0) addLine(cur, 'review.start');
    else {
      var i = n - 1, m = R.moves[i], x = resultAt(i);
      var color = D.colorName(m.p), oppColor = D.colorName(3 - m.p);
      addLine(cur, 'review.moveInfo', { n: moveNo(i), color: color, coord: D.coordName(m.r, m.c) }, 'rv-coord');
      var L = lineOf(i);
      if (x && x.forbidden) {
        addLine(cur, 'review.forbiddenLoss', { kind: I.forbiddenTerm(typeof x.forbidden === 'string' ? x.forbidden : info.forbidden) }, 'rv-bad');
      }
      if (x && x.losing) {
        if (!x.forbidden) addLine(cur, 'review.losingMove', { n: moveNo(i), color: color, opp: oppColor }, 'rv-bad');
        if (L) { var lc = lineCounts(L); addLine(cur, 'review.losingDetail', { opp: oppColor, k: lc.k, n: lc.n }); }
        // 較好的下法（第十二批 c，作者核准的第 3 節第 2 條甲）：found 只說電腦試了什麼（「試了很多種攻法，都沒找到…」），不寫肯定句；
        // unverified＝沒驗完：不推薦任何點（新引擎 betterMove 是 null；舊引擎帶的點也不用），只說試了幾種、有的還沒算完；
        // none＝試過的每一種都會輸，改說問題可能在更前面。
        // 禁手判負那一手（下的人當時是優勢方）不用「守」的說法，只說不會犯禁手。
        if (x.betterStatus === 'unverified') {
          var nu = x.betterChecked;
          addLine(cur, nu > 0 ? 'review.betterUnverified' : 'review.betterUnverified.some', { n: nu });
        } else if (x.better) addLine(cur, x.forbidden ? 'review.betterForbidden' : 'review.better', { coord: D.coordName(x.better.r, x.better.c) }, 'rv-good');
        else if (x.betterStatus === 'unknown') addLine(cur, 'review.betterUnknown');
        else if (!x.forbidden) addLine(cur, x.betterChecked > 0 ? 'review.betterNone' : 'review.noSafe', { n: x.betterChecked });
      } else if (x && L) {
        // 敗著之後的手：對手仍有必勝
        var lc2 = lineCounts(L);
        addLine(cur, 'review.stillLosing', { opp: oppColor, k: lc2.k, n: lc2.n });
      } else if (x && x.brilliant) {
        addLine(cur, 'review.brilliant', { n: moveNo(i), color: color }, 'rv-brilliant');
      } else if (unanalyzed(i)) {
        addLine(cur, 'review.notAnalyzed', null, 'rv-gray');
      }
    }
    var ff = forcedForbidden(n);
    if (ff) addLine(cur, 'review.forcedForbidden', { coord: D.coordName(ff.pt.r, ff.pt.c), kind: I.forbiddenTerm(ff.kind) }, 'rv-bad');
    panel.appendChild(cur);

    // 3. 按鈕
    var acts = mk('div', 'rv-actions');
    if (n > 0 && lineOf(n - 1)) {
      var pb = mk('button', 'secondary', t(R.play ? 'review.stop' : 'review.play'));
      pb.type = 'button';
      pb.id = 'rvPlay';
      pb.addEventListener('click', togglePlay);
      acts.appendChild(pb);
    }
    var cb = mk('button', 'secondary', t('review.copy'));
    cb.type = 'button';
    cb.addEventListener('click', copyKifu);
    acts.appendChild(cb);
    // v0.5.15（規格 AU 第二版）：「從這一步研究」＝把現在這一步的盤面（規則、照順序的手）帶進擺棋盤研究
    if (D.onResearch) {
      var sb = mk('button', 'secondary', t('review.research'));
      sb.type = 'button';
      sb.id = 'rvResearch';
      sb.addEventListener('click', function () { D.onResearch(R.info, R.moves.slice(0, R.n), R.n); });
      acts.appendChild(sb);
    }
    // 第十六批：上方已經有同一顆「回到這盤棋」（對局中進來的，狀態列旁）時，面板這顆不再重複
    if (!D.hideBack || !D.hideBack()) {
      var bb = mk('button', 'secondary', D.backLabel());
      bb.type = 'button';
      bb.addEventListener('click', function () { D.onExit(); });
      acts.appendChild(bb);
    }
    panel.appendChild(acts);
    if (R.copyMsg) panel.appendChild(mk('p', 'rv-copymsg', R.copyMsg));
    if (R.copyFallback) {
      var ta = mk('textarea', 'rv-kifu');
      ta.value = R.copyFallback;
      ta.readOnly = true;
      ta.rows = 6;
      panel.appendChild(ta);
    }

    // 4. 圖例
    var lg = mk('div', 'rv-legend');
    var toMove = n < R.N ? R.moves[n].p : (n ? 3 - R.moves[n - 1].p : 1);
    lg.appendChild(legendItem(COLOR.own, I.node('review.legendOwn', { color: D.colorName(toMove) }), 'sq'));
    lg.appendChild(legendItem(COLOR.opp, I.node('review.legendOpp', { color: D.colorName(3 - toMove) }), 'sq'));
    lg.appendChild(legendItem(COLOR.losing, t('review.legendLosing'), 'frame'));
    // 第十三批 b：棋盤上這一步真的畫了綠圈才列「較好的下法」
    var vw = view();
    if (vw.rings && vw.rings.some(function (q) { return q.color === COLOR.better; })) lg.appendChild(legendItem(COLOR.better, t('review.legendBetter'), 'ring'));
    lg.appendChild(legendItem(COLOR.brilliant, t('review.legendBrilliant'), 'frame'));
    panel.appendChild(lg);

    // 5. 固定的免責句（第十二批 c：「最多幾次進攻」讀引擎的常數，不在介面另寫一份）。
    // 第十四批（W 第 2 條）：主面板只留一句，其餘摺疊在「電腦檢查的限制」裡；引擎沒給次數時摺疊的那一段不出現
    var dis = mk('div', 'rv-disclaimer');
    dis.appendChild(mk('p', '', t('review.disclaimerMain')));
    var dd = threatDepth();
    if (dd) {
      var det = mk('details', 'rv-limits');
      det.appendChild(mk('summary', '', t('review.limitsTitle')));
      det.appendChild(mk('p', '', t('review.disclaimer', { d: dd })));
      if (R.limitsOpen) det.open = true;
      det.addEventListener('toggle', function () { if (R) R.limitsOpen = det.open; }); // 一步一步看時保持開合
      dis.appendChild(det);
    }
    panel.appendChild(dis);

    redraw();
  }

  // 整盤檢查的威脅次數上限（引擎的 ANALYZE_THREATS）：第十四批起引擎公開 Gomoku.ANALYZE_THREATS（W 第 9 條），介面不再寫死 6。
  // 舊引擎沒公開時看 analyzeGameInit 回傳的 maxThreats；都沒有就回 null（免責句不寫次數那一段）
  function threatDepth() {
    if (G.ANALYZE_THREATS > 0) return G.ANALYZE_THREATS;
    var st = G.analyzeGameInit ? G.analyzeGameInit([], 'free') : null;
    return st && st.maxThreats > 0 ? st.maxThreats : null;
  }

  function legendItem(color, text, shape) {
    var s = mk('span', 'lg-item');
    var k = mk('i', 'lg-' + shape);
    if (shape === 'sq') k.style.background = hex(color); else k.style.borderColor = hex(color);
    s.appendChild(k);
    s.appendChild(typeof text === 'string' ? document.createTextNode(text) : text); // 規格 AK：圖例的名詞可以點（I.node 的片段）
    return s;
  }

  // ---------------------------------------------------------- 播放必勝手順

  function stopPlay() {
    if (R && R.play) { clearInterval(R.play.timer); R.play = null; }
  }
  function togglePlay() {
    if (!R) return;
    if (R.play) { stopPlay(); render(); return; }
    var L = lineOf(R.n - 1);
    if (!L) return;
    R.play = { step: 0, timer: setInterval(function () {
      if (!R || !R.play) return;
      R.play.step++;
      if (R.play.step >= L.line.length) { stopPlay(); render(); return; }
      redraw();
    }, 700) };
    render();
  }

  // ---------------------------------------------------------- 棋譜

  function kifuText() {
    var info = R.info, lines = [];
    lines.push(t('kifu.title', { version: D.version }));
    lines.push(t('kifu.rule', { rule: D.ruleLabel(info.rule, info.strict) }));
    if (info.mode === 'pvp') lines.push(t('kifu.pvp'));
    else lines.push(t('kifu.pve', { tier: D.tierName(info.tier), side: D.colorName(info.human) }));
    if (info.over) lines.push(t('kifu.result', { result: D.endText(info) }));
    var d = new Date(info.at || info.ts || Date.now());
    lines.push(t('kifu.date', { date: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') +
      ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }));
    var op = D.detectOpening(R.moves);
    if (op) lines.push(D.openingLabel(op));
    R.moves.forEach(function (m, i) {
      lines.push(t('kifu.move', { n: i + 1, color: D.colorName(m.p), coord: D.coordName(m.r, m.c) }));
    });
    return lines.join('\n');
  }

  function copyKifu() {
    var text = kifuText();
    D.copyText(text, function () {
      R.copyMsg = t('review.copied');
      R.copyFallback = null;
      render();
    }, function () {
      R.copyMsg = t('review.copyFail');
      R.copyFallback = text;
      render();
    });
  }

  // ---------------------------------------------------------- 開關

  function go(n) {
    if (!R) return;
    stopPlay();
    R.n = Math.max(0, Math.min(R.N, n));
    R.copyMsg = null;
    render();
  }

  function keyOf(info, moves) {
    return (info.ts || 0) + ':' + info.rule + ':' + moves.map(function (m) { return m.r * N + m.c; }).join(',');
  }

  function open(info) {
    close();
    var moves = info.moves.map(function (m, i) {
      var q = pt(m);
      return { r: q.r, c: q.c, p: m.p || (i % 2 ? 2 : 1) };
    });
    R = { info: info, moves: moves, N: moves.length, n: moves.length, results: [], got: 0, total: 0,
      lastIdx: -1, state: 'running', cancel: null, play: null, forbIdx: -1, copyMsg: null, copyFallback: null, summary: null, tailWhy: null, endForbid: null };
    if (info.end === 'forbidden') R.forbIdx = moves.length - 1;
    var send = moves; // 嚴格模式的禁手那一手也送：引擎會標 forbidden 並停在那裡
    R.total = send.length;
    var key = keyOf(info, moves);
    var hit = cache[key];
    if (hit) {
      R.results = hit.results; R.got = hit.got; R.lastIdx = hit.lastIdx; R.state = hit.state; R.summary = hit.summary || null; R.tailWhy = hit.tailWhy || null;
    } else if (!R.total) {
      R.state = 'empty';
      reportLosing();
    } else {
      var mine = R;
      R.cancel = D.requestAnalysis(send, info.rule, function (index, res) {
        if (R !== mine || typeof index !== 'number') return;
        if (!R.results[index]) R.got++;
        R.results[index] = norm(res);
        if (index > R.lastIdx) R.lastIdx = index;
        render();
      }, function (ok, summary) {
        if (R !== mine) return;
        R.cancel = null;
        R.summary = ok && summary && typeof summary === 'object' ? summary : null;
        // 「後段未分析」只指尾巴一整段沒算完（整盤時間用完）；中間個別手查不完，在那一手上說。
        // 引擎有給 summary.tailUnanalyzed 就用它；沒有就自己數（最後一手成五或禁手時跳過那一手——
        // 上一版沒跳過，終局那手永遠算「算完」，所以這個狀態從來不會出現）。
        var lastOK = -1;
        for (var i = 0; i < R.total; i++) if (R.results[i] && R.results[i].analyzed) lastOK = i;
        R.state = !ok && !R.got ? 'failed' : 'done';
        if (R.state !== 'failed' && tailUnanalyzed() > 0) R.state = 'partial';
        R.tailWhy = R.state === 'partial' ? tailWhy(R.summary) : null;
        if (R.state !== 'failed') {
          R.lastIdx = lastOK;
          cache[key] = { results: R.results, got: R.got, lastIdx: R.lastIdx, state: R.state, summary: R.summary, tailWhy: R.tailWhy };
          reportLosing();
        }
        render();
      });
    }
    render();
  }

  // 尾段沒算完的原因：'total'（整盤能用的時間用完）、'perMove'（每手的時間不夠）、null（不寫原因）。
  // 第十二批 c：第十一批起引擎的整盤時限會順延嚴格驗證用掉的時間，介面用「送出到做完幾秒」去猜會猜錯，所以只看引擎給的
  // summary.tailReason（'total'；'wall'＝整盤牆鐘上限，也算整盤時間用完；'perMove'）。引擎沒給就不寫原因。
  function tailWhy(sm) {
    var r = sm && sm.tailReason;
    if (r === 'total' || r === 'wall') return 'total';
    if (r === 'perMove') return 'perMove';
    return null;
  }

  function reportLosing() {
    var fl = firstLosing();
    if (fl >= 0 && D.onLosingFound) D.onLosingFound(R.info, fl + 1);
  }

  function close() {
    if (!R) return;
    stopPlay();
    if (R.cancel) R.cancel();
    R = null;
  }

  function init(deps) {
    D = deps;
    $('rvFirst').addEventListener('click', function () { go(0); });
    $('rvPrev').addEventListener('click', function () { go(R.n - 1); });
    $('rvNext').addEventListener('click', function () { go(R.n + 1); });
    $('rvLast').addEventListener('click', function () { go(R.N); });
    $('rvRange').addEventListener('input', function () { go(Number(this.value)); });
  }

  window.GReview = {
    init: init,
    open: open,
    close: close,
    render: render,
    redraw: redraw,
    go: go,
    info: function () { return R ? R.info : null; },
    state: function () { return R; },
    kifuText: function () { return R ? kifuText() : ''; }
  };
})();
