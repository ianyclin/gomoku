// 棋盤與棋子風格（規格 S，第八批 b）。全部用 canvas 程式繪製，不用圖片檔。
// 每種風格提供：board(g) 畫底、格線、星位；stone(g, x, y, R, p, o) 畫一顆子；mk 標記顏色；svg 規則說明與學習頁小圖的顏色。
// g = { ctx, W（畫布像素寬）, n（格線數）, px(i)（第 i 條線的像素座標）, cell（格寬像素）, dpr, lw（格線寬）, stars:[[r,c]] }
// o = { seed（固定亂數種子：同一點每次畫都一樣）, ghost（半透明編號子：不加裝飾） }
// 所有風格的棋子都以黑、白兩色為基礎（作者 2026-09-30 拍板）；風格只改質感、外形與棋盤。
(function () {
  'use strict';
  var IDS = ['classic', 'slate', 'paper', 'playful', 'contrast'];
  var TAU = Math.PI * 2;

  // 固定種子的亂數（mulberry32）：紙本的鉛筆線、木紋、石板顆粒每次重畫都一樣，不會跳動
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); }

  function grid(g, color, lw, cap) {
    var ctx = g.ctx, n = g.n, a = g.px(0), b = g.px(n - 1);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = cap || 'square';
    ctx.lineJoin = cap === 'round' ? 'round' : 'miter';
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      ctx.moveTo(a, g.px(i)); ctx.lineTo(b, g.px(i));
      ctx.moveTo(g.px(i), a); ctx.lineTo(g.px(i), b);
    }
    ctx.stroke();
  }
  function starDots(g, color, rad) {
    g.ctx.fillStyle = color;
    g.stars.forEach(function (s) { circle(g.ctx, g.px(s[1]), g.px(s[0]), rad); g.ctx.fill(); });
  }

  // 經典的細木紋：淺色的斜向細紋，位置只看種子與畫布比例
  function woodGrain(g) {
    var ctx = g.ctx, W = g.W, rnd = rng(7), k = Math.round(W / g.dpr / 7);
    ctx.save();
    for (var i = 0; i < k; i++) {
      var y = rnd() * W, amp = (0.004 + rnd() * 0.01) * W, ph = rnd() * TAU, fr = 1 + rnd() * 2;
      ctx.strokeStyle = 'rgba(110, 62, 18, ' + (0.025 + rnd() * 0.045).toFixed(3) + ')';
      ctx.lineWidth = (0.4 + rnd() * 0.9) * g.dpr;
      ctx.beginPath();
      for (var s = 0; s <= 24; s++) {
        var x = s / 24 * W, yy = y + Math.sin(ph + s / 24 * TAU * fr) * amp + s / 24 * W * 0.04;
        if (s) ctx.lineTo(x, yy); else ctx.moveTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // 顆粒（石板、紙）：固定種子的小點
  function specks(g, seed, perPx, colors) {
    var ctx = g.ctx, W = g.W, rnd = rng(seed), css = W / g.dpr, k = Math.round(css * css / perPx), sz = Math.max(1, g.dpr);
    for (var i = 0; i < k; i++) {
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(Math.floor(rnd() * W), Math.floor(rnd() * W), sz, sz);
    }
  }

  // 手繪的線：兩端之間分段，每段垂直方向偏一點點（種子固定）
  function wobblyLine(ctx, x0, y0, x1, y1, amp, rnd, segs) {
    var dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx * dx + dy * dy) || 1, nx = -dy / len, ny = dx / len;
    ctx.moveTo(x0 + nx * (rnd() - 0.5) * amp, y0 + ny * (rnd() - 0.5) * amp);
    for (var s = 1; s <= segs; s++) {
      var f = s / segs, o = (rnd() - 0.5) * amp * 2;
      ctx.lineTo(x0 + dx * f + nx * o, y0 + dy * f + ny * o);
    }
  }
  // 手繪的圓：半徑隨角度微微起伏
  function wobblyCircle(ctx, x, y, R, rnd, amt) {
    var k = 28, p0 = rnd() * TAU, ph2 = rnd() * TAU;
    ctx.beginPath();
    for (var i = 0; i <= k; i++) {
      var a = p0 + i / k * TAU, rr = R * (1 + Math.sin(a * 2 + ph2) * amt);
      if (i) ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
  }

  // 四角星（童趣的星星高光）
  function sparkle(ctx, x, y, s, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.quadraticCurveTo(x + s * 0.18, y - s * 0.18, x + s, y);
    ctx.quadraticCurveTo(x + s * 0.18, y + s * 0.18, x, y + s);
    ctx.quadraticCurveTo(x - s * 0.18, y + s * 0.18, x - s, y);
    ctx.quadraticCurveTo(x - s * 0.18, y - s * 0.18, x, y - s);
    ctx.fill();
  }

  // 經典的標記顏色（第七批以前的顏色，一個都沒改）
  var MK_CLASSIC = {
    lastStyle: 'dot', last: '#e8261b', win: '#e8261b', forbid: '#d0201a', flash: '#f08a00',
    // 第十二批 c：復盤「四和活三」小方塊的邊改成黑色（原本白色 .85，和木紋底對比不到 2.2，方塊本色也只有 1.3–3.4）：
    // 黑邊和亮的棋盤底 ≥ 8.6，方塊本色和黑邊 ≥ 3.58。經典、紙本、童趣共用這道邊
    coord: 'rgba(43, 33, 24, .9)', markEdge: '#000000', // 第十五批：座標字改 A 的 ink（寫在棋盤外側那道邊上）
    numB: '#fff', numW: '#111', ghostAlpha: 0.55,
    own: '#12a38f', opp: '#c2185b', losing: '#e0261b', better: '#1e9e3a', brilliant: '#1f6fd1', follow: '#1f6fd1',
    // 第十批：復盤「可能比較好」（betterStatus unverified）的綠圈：同一個綠、半透明、不加描邊，比 better 淡
    betterWeak: 'rgba(30, 158, 58, .5)',
    // 第二十四批（規格 Z8 最後一條）：「提示我的機會」的己方棋子光環＝moss 綠（對手的威脅光環用上面的 flash 橘）。
    // 介面的 --moss #2e5b45 在木紋底上太暗、光暈看不出來，棋盤上用同一個色相調亮的綠
    ownGlow: '#3f9a63'
  };
  function extend(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }
  // 標記的描邊（halo）：顏色和棋盤底色對比不到 3:1 的標記，先畫一道稍寬的白邊或深邊再畫本色，本色和描邊的對比 ≥ 3:1。
  // 只加描邊、不換色（經典的標記顏色沿用第七批以前的）。
  var HALO_W = 'rgba(255, 255, 255, .9)', HALO_D = 'rgba(43, 29, 14, .85)', SLATE_HALO = 'rgba(18, 20, 23, .9)';
  MK_CLASSIC.halo = { forbid: HALO_W, win: HALO_W, losing: HALO_W, better: HALO_W, brilliant: HALO_W, follow: HALO_W, flash: HALO_D };

  var THEMES = {
    classic: {
      board: function (g) {
        var ctx = g.ctx, W = g.W, bg = ctx.createLinearGradient(0, 0, W, W);
        bg.addColorStop(0, '#e6bf7e');
        bg.addColorStop(1, '#cf9d58');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, W);
        woodGrain(g);
        grid(g, '#5a3c1c', g.lw);
        starDots(g, '#5a3c1c', Math.max(2 * g.dpr, g.cell * 0.09));
      },
      stone: function (g, x, y, R, p) {
        var ctx = g.ctx, gr = ctx.createRadialGradient(x - R * 0.35, y - R * 0.35, R * 0.1, x, y, R);
        if (p === 1) { gr.addColorStop(0, '#6a6a6a'); gr.addColorStop(1, '#0d0d0d'); }
        else { gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#cdcdcd'); }
        ctx.fillStyle = gr;
        circle(ctx, x, y, R);
        ctx.fill();
        if (p === 2) {
          ctx.strokeStyle = '#8a8a8a';
          ctx.lineWidth = Math.max(1, g.dpr * 0.75);
          ctx.stroke();
        }
      },
      mk: MK_CLASSIC,
      svg: { bg: '#dcae68', line: '#5a3c1c', lineW: 1, black: '#151515', blackEdge: null, white: '#fafafa', whiteEdge: '#8a8a8a', whiteEdgeW: 1,
        numB: '#fff', numW: '#111', five: '#e8261b', forbid: '#d0201a', plus: '#f08a00' }
    },

    slate: {
      board: function (g) {
        var ctx = g.ctx, W = g.W, bg = ctx.createLinearGradient(0, 0, W, W);
        bg.addColorStop(0, '#585e65');
        bg.addColorStop(1, '#454a50');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, W);
        specks(g, 11, 22, ['rgba(255,255,255,.06)', 'rgba(0,0,0,.10)', 'rgba(255,255,255,.035)']);
        grid(g, '#c8cdd3', g.lw);
        starDots(g, '#c8cdd3', Math.max(2 * g.dpr, g.cell * 0.09));
      },
      stone: function (g, x, y, R, p) {
        // 霧面：漸層很淡、沒有亮點；黑子加一圈淺色細邊，深灰底上也看得清輪廓
        var ctx = g.ctx, gr = ctx.createRadialGradient(x - R * 0.25, y - R * 0.25, R * 0.2, x, y, R);
        if (p === 1) { gr.addColorStop(0, '#34363a'); gr.addColorStop(1, '#141517'); }
        else { gr.addColorStop(0, '#fbf6e9'); gr.addColorStop(1, '#e3d9c1'); }
        ctx.fillStyle = gr;
        circle(ctx, x, y, R);
        ctx.fill();
        ctx.strokeStyle = p === 1 ? 'rgba(255,255,255,.45)' : 'rgba(0,0,0,.35)';
        ctx.lineWidth = Math.max(1, g.dpr * 0.75);
        ctx.stroke();
      },
      mk: extend(MK_CLASSIC, {
        last: '#e0251a', win: '#ff4b3e', forbid: '#ff6f63', flash: '#ffa726', coord: 'rgba(236, 240, 244, .95)', markEdge: 'rgba(0,0,0,.55)',
        // 第十二批 c：復盤「四和活三」小方塊的本色調亮，和石板底（含顆粒，全盤取樣最亮處）≥ 3:1——深色的邊和底不到 3:1，不能靠邊。
        // own #26c6ac → #48dac2、opp #ff5c9f → #ff9ac6（改前全盤取樣最低 2.98／2.27 左右，數字見 docs/ui-notes.md 第十二批 c）
        own: '#48dac2', opp: '#ff9ac6', losing: '#ff4b3e', better: '#4ad66a', brilliant: '#64adff', follow: '#64adff', ghostAlpha: 0.6,
        betterWeak: 'rgba(74, 214, 106, .5)', ownGlow: '#7fdca2', // 第二十四批：深色石板底上的綠光環調亮
        halo: { win: SLATE_HALO, losing: SLATE_HALO, forbid: SLATE_HALO, brilliant: SLATE_HALO, follow: SLATE_HALO }
      }),
      svg: { bg: '#4e545a', line: '#c8cdd3', lineW: 1, black: '#16171a', blackEdge: 'rgba(255,255,255,.4)', white: '#f3ecd9', whiteEdge: '#8f8a7c', whiteEdgeW: 1,
        numB: '#fff', numW: '#111', five: '#ff4b3e', forbid: '#ff6f63', plus: '#ffa726' }
    },

    paper: {
      board: function (g) {
        var ctx = g.ctx, W = g.W, n = g.n;
        ctx.fillStyle = '#f7f2e4';
        ctx.fillRect(0, 0, W, W);
        specks(g, 23, 40, ['rgba(120,100,60,.07)', 'rgba(120,100,60,.04)']);
        // 鉛筆線：每條線一個固定種子，畫兩遍（第二遍淡、略偏），像手描
        var amp = Math.max(0.5 * g.dpr, g.cell * 0.016), a = g.px(0), b = g.px(n - 1);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        [[0.88, g.lw, 0], [0.28, g.lw, 1]].forEach(function (pass) {
          ctx.strokeStyle = 'rgba(52, 52, 52, ' + pass[0] + ')';
          ctx.lineWidth = pass[1];
          ctx.beginPath();
          for (var i = 0; i < n; i++) {
            var rh = rng(1000 + i * 31 + pass[2] * 7), rv = rng(2000 + i * 37 + pass[2] * 7), d = pass[2] * g.dpr * 0.8;
            wobblyLine(ctx, a - g.cell * 0.04, g.px(i) + d, b + g.cell * 0.04, g.px(i) + d, amp, rh, n - 1);
            wobblyLine(ctx, g.px(i) + d, a - g.cell * 0.04, g.px(i) + d, b + g.cell * 0.04, amp, rv, n - 1);
          }
          ctx.stroke();
        });
        var rs = rng(77);
        ctx.fillStyle = 'rgba(40, 40, 40, .85)';
        g.stars.forEach(function (s) {
          wobblyCircle(ctx, g.px(s[1]), g.px(s[0]), Math.max(2 * g.dpr, g.cell * 0.085), rs, 0.12);
          ctx.fill();
        });
      },
      // 黑：實心圈；白：空心圈（紙色填滿＋粗筆畫）。形狀用這一點的固定種子，重畫不會變
      stone: function (g, x, y, R, p, o) {
        var ctx = g.ctx, seed = (o && o.seed) || 1, r1 = rng(seed * 13 + 5), r2 = rng(seed * 13 + 9);
        ctx.lineJoin = 'round';
        if (p === 1) {
          ctx.fillStyle = '#202020';
          wobblyCircle(ctx, x, y, R * 0.96, r1, 0.035);
          ctx.fill();
          ctx.strokeStyle = 'rgba(20,20,20,.7)';
          ctx.lineWidth = Math.max(1, g.dpr * 0.8);
          wobblyCircle(ctx, x + R * 0.02, y - R * 0.02, R * 0.98, r2, 0.04);
          ctx.stroke();
        } else {
          ctx.fillStyle = '#fbf8ef';
          wobblyCircle(ctx, x, y, R * 0.92, r1, 0.035);
          ctx.fill();
          ctx.strokeStyle = '#262626';
          ctx.lineWidth = Math.max(1.5 * g.dpr, R * 0.13);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(38,38,38,.35)';
          ctx.lineWidth = Math.max(1, g.dpr * 0.7);
          wobblyCircle(ctx, x - R * 0.03, y + R * 0.02, R * 0.96, r2, 0.05);
          ctx.stroke();
        }
      },
      mk: extend(MK_CLASSIC, { coord: 'rgba(40, 40, 40, .88)', halo: { flash: HALO_D } }), // 第十二批 c：markEdge 沿用經典的黑邊（原白邊和紙底 1.11）
      svg: { bg: '#f7f2e4', frame: '#8a7a5c', line: '#3a3a3a', lineW: 1, black: '#202020', blackEdge: null, white: '#fbf8ef', whiteEdge: '#262626', whiteEdgeW: 2,
        numB: '#fff', numW: '#111', five: '#e8261b', forbid: '#d0201a', plus: '#f08a00' }
    },

    playful: {
      board: function (g) {
        var ctx = g.ctx, W = g.W, bg = ctx.createRadialGradient(W * 0.5, W * 0.45, W * 0.05, W * 0.5, W * 0.5, W * 0.75);
        bg.addColorStop(0, '#e4f2fb');
        bg.addColorStop(1, '#cfe5f4');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, W);
        // 圓角格線：線端做圓頭；外框是圓角方形（內線只畫第 2 到倒數第 2 條，外框的四角才不會凸出去）
        var lw = Math.max(1.5, Math.round(g.lw * 1.5)), a = g.px(0), b = g.px(g.n - 1), rr = g.cell * 0.35;
        ctx.strokeStyle = '#6f90b0';
        ctx.lineWidth = lw;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (var i = 1; i < g.n - 1; i++) {
          ctx.moveTo(a, g.px(i)); ctx.lineTo(b, g.px(i));
          ctx.moveTo(g.px(i), a); ctx.lineTo(g.px(i), b);
        }
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(a + rr, a); ctx.lineTo(b - rr, a); ctx.arcTo(b, a, b, a + rr, rr);
        ctx.lineTo(b, b - rr); ctx.arcTo(b, b, b - rr, b, rr);
        ctx.lineTo(a + rr, b); ctx.arcTo(a, b, a, b - rr, rr);
        ctx.lineTo(a, a + rr); ctx.arcTo(a, a, a + rr, a, rr);
        ctx.closePath();
        ctx.lineWidth = lw * 1.6;
        ctx.stroke();
        starDots(g, '#6f90b0', Math.max(2.5 * g.dpr, g.cell * 0.11));
      },
      // 仍是黑與白；更圓潤（略大、有柔和的影子與大亮面），加一顆星星高光（黑子淺灰、白子深灰）
      stone: function (g, x, y, R, p, o) {
        var ctx = g.ctx, r = R * 1.03, gr = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.15, x, y, r);
        if (p === 1) { gr.addColorStop(0, '#5c5c5c'); gr.addColorStop(0.55, '#262626'); gr.addColorStop(1, '#141414'); }
        else { gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.7, '#f4f4f4'); gr.addColorStop(1, '#d6d6d6'); }
        ctx.save();
        if (!(o && o.ghost)) {
          ctx.shadowColor = 'rgba(40, 70, 100, .28)';
          ctx.shadowBlur = r * 0.25;
          ctx.shadowOffsetY = r * 0.1;
        }
        ctx.fillStyle = gr;
        circle(ctx, x, y, r);
        ctx.fill();
        ctx.restore();
        if (p === 2) {
          ctx.strokeStyle = '#98a3ad';
          ctx.lineWidth = Math.max(1, g.dpr * 0.9);
          circle(ctx, x, y, r);
          ctx.stroke();
        }
        if (!(o && o.ghost)) sparkle(ctx, x - r * 0.38, y - r * 0.38, r * 0.26, p === 1 ? '#d4d4d4' : '#8a8a8a');
      },
      mk: extend(MK_CLASSIC, { coord: 'rgba(40, 62, 86, .9)', brilliant: '#1a56b8', follow: '#1a56b8', better: '#178a33', betterWeak: 'rgba(23, 138, 51, .5)', halo: { flash: HALO_D } }),
      svg: { bg: '#d6ebf7', line: '#6f90b0', lineW: 1.5, black: '#262626', blackEdge: null, white: '#ffffff', whiteEdge: '#98a3ad', whiteEdgeW: 1.2,
        numB: '#fff', numW: '#111', five: '#e8261b', forbid: '#d0201a', plus: '#f08a00' }
    },

    contrast: {
      lineW: function (dpr) { return Math.max(2, Math.round(2 * dpr)); },
      board: function (g) {
        var ctx = g.ctx;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, g.W, g.W);
        grid(g, '#000000', g.lw);
        starDots(g, '#000000', Math.max(3 * g.dpr, g.cell * 0.14));
      },
      // 黑：純黑；白：白底粗黑框
      stone: function (g, x, y, R, p) {
        var ctx = g.ctx;
        if (p === 1) {
          ctx.fillStyle = '#000000';
          circle(ctx, x, y, R);
          ctx.fill();
          return;
        }
        var w = Math.max(2 * g.dpr, R * 0.16);
        ctx.fillStyle = '#ffffff';
        circle(ctx, x, y, R);
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = w;
        circle(ctx, x, y, R - w / 2);
        ctx.stroke();
      },
      // 最後一手用粗框不用紅點：子的正中央畫一個反色的粗方框（黑子上白框、白子上黑框）
      mk: extend(MK_CLASSIC, {
        lastStyle: 'frame', last: '#000000', win: '#d0001a', forbid: '#d0001a', flash: '#e06000', coord: '#000000', markEdge: '#000000',
        own: '#00806c', opp: '#c2185b', losing: '#d0001a', better: '#007a2a', brilliant: '#0047c2', follow: '#0047c2', ghostAlpha: 0.6, halo: null,
        betterWeak: 'rgba(0, 122, 42, .55)', ownGlow: '#00803f'
      }),
      svg: { bg: '#ffffff', frame: '#000000', line: '#000000', lineW: 2, black: '#000000', blackEdge: null, white: '#ffffff', whiteEdge: '#000000', whiteEdgeW: 2.5,
        numB: '#fff', numW: '#000', five: '#d0001a', forbid: '#d0001a', plus: '#e06000' }
    }
  };
  IDS.forEach(function (id) { THEMES[id].id = id; });

  var cur = 'classic';
  function has(id) { return IDS.indexOf(id) >= 0; }
  function get(id) { return THEMES[has(id) ? id : cur]; }
  function lineW(th, dpr) { return th.lineW ? th.lineW(dpr) : Math.max(1, Math.round(dpr)); }

  // 最後一手的標記（對局、復盤、詰棋、小預覽共用）
  function lastMark(th, ctx, x, y, R, p, cell, dpr) {
    var mk = th.mk;
    if (mk.lastStyle === 'frame') {
      var s = R * 0.46, w = Math.max(2 * dpr, R * 0.2);
      ctx.strokeStyle = p === 1 ? '#ffffff' : '#000000';
      ctx.lineWidth = w;
      ctx.lineJoin = 'miter';
      ctx.strokeRect(x - s, y - s, s * 2, s * 2);
      return;
    }
    ctx.fillStyle = mk.last;
    circle(ctx, x, y, Math.max(2.5 * dpr, cell * 0.12));
    ctx.fill();
  }

  // 「更多 → 外觀」的小預覽：同一套 board／stone／lastMark，畫 5×5 的一角
  function preview(canvas, id, size) {
    var th = THEMES[has(id) ? id : 'classic'], dpr = window.devicePixelRatio || 1;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    var ctx = canvas.getContext('2d'), W = canvas.width, n = 5, cell = W / n, m = cell / 2;
    var lw = lineW(th, dpr), off = lw % 2 ? 0.5 : 0;
    var g = { ctx: ctx, W: W, n: n, cell: cell, dpr: dpr, lw: lw, stars: [[2, 2]], px: function (i) { return Math.round(m + i * cell) + off; } };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    th.board(g);
    var R = cell * 0.44, stones = [[1, 1, 1], [1, 2, 2], [2, 2, 1], [3, 2, 2], [2, 3, 1]];
    stones.forEach(function (s) { th.stone(g, g.px(s[1]), g.px(s[0]), R, s[2], { seed: s[0] * 32 + s[1] + 1 }); });
    lastMark(th, ctx, g.px(3), g.px(2), R, 1, cell, dpr);
  }

  window.GThemes = {
    ids: IDS.slice(),
    has: has,
    get: get,
    current: function () { return THEMES[cur]; },
    currentId: function () { return cur; },
    set: function (id) { cur = has(id) ? id : 'classic'; return cur; },
    // 標記顏色：傳 'own'、'losing' 這類名字取目前風格的顏色；傳色碼就原樣回
    color: function (k) { return THEMES[cur].mk[k] || k; },
    lineW: lineW,
    lastMark: lastMark,
    preview: preview,
    rng: rng
  };
})();
