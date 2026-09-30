/*
 * 五子棋：積分與徽章（規格 P 段）。純函式，不碰 DOM、不碰 localStorage。
 * 瀏覽器下掛到 window.GomokuRating（Worker 下 self.GomokuRating），node／jsc 用 require('./rating.js')。
 *
 * Elo：期望勝率 E = 1/(1+10^((Rb−Ra)/400))；賽後 Ra' = Ra + K×(S−E)，S 勝 1／和 0.5／負 0。
 * K：這個帳號賽前已下的局數 < 10 時 40，之後 20。積分一律是整數（起始 1200）；每局的 delta 四捨五入到整數
 * （正負對稱：±0.5 都往遠離 0 的方向進位，所以同一個 K 時 A 加的分數一定等於 B 扣的）。
 */
(function (root, factory) {
  var R = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = R;
  else root.GomokuRating = R;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var START = 1200;          // 新帳號的起始積分
  var PROVISIONAL_GAMES = 10; // 前 10 局 K＝40
  var K_NEW = 40, K_NORMAL = 20;
  var DEMOTE_BUFFER = 50;    // 降級緩衝：要低於該徽章下限 50 分才降

  // 徽章：min 是下限（含）。木沒有下限。
  var BADGES = [
    { key: 'wood', min: -Infinity, zh: '木', en: 'Wood' },
    { key: 'bronze', min: 900, zh: '銅', en: 'Bronze' },
    { key: 'silver', min: 1100, zh: '銀', en: 'Silver' },
    { key: 'gold', min: 1300, zh: '金', en: 'Gold' },
    { key: 'platinum', min: 1500, zh: '白金', en: 'Platinum' },
    { key: 'diamond', min: 1700, zh: '鑽石', en: 'Diamond' }
  ];

  // 四捨五入到整數，正負對稱（-2.5 → -3，2.5 → 3）
  function roundSym(x) { return x < 0 ? -Math.round(-x) : Math.round(x); }

  // A 對 B 的期望得分（0–1）
  function expected(ra, rb) {
    return 1 / (1 + Math.pow(10, (rb - ra) / 400));
  }

  // 賽前已下的局數 → K
  function kFactor(games) {
    return (games || 0) < PROVISIONAL_GAMES ? K_NEW : K_NORMAL;
  }

  // A 的結算。score：A 勝 1／和 0.5／負 0；gamesA：A 賽前已下的局數（決定 K）。
  // 回傳 { rating: 新積分（整數）, delta: 變動（整數）, expected: 賽前期望得分, k }
  function update(ra, rb, score, gamesA) {
    var e = expected(ra, rb), k = kFactor(gamesA);
    var delta = roundSym(k * (score - e));
    return { rating: Math.round(ra) + delta, delta: delta, expected: e, k: k };
  }

  // 雙方同時結算（雙打；也可以給 AI 用，AI 那邊的結果不存即可）。都用賽前分數，各自的 K。
  // a、b：{ rating, games, id（可省略） }；result：A 的得分，1／0.5／0。
  // 回傳 { a: {rating, delta, expected, k}, b: {…}, rated: 有沒有計分 }。
  // a.id 與 b.id 都有而且相同（同一個帳號自己對下）時不計分：delta 都是 0、rated 為 false。
  // 同一個 K 時 b.delta 一定等於 −a.delta；K 不同（一方還在前 10 局）時兩邊不對稱是預期的。
  function settle(a, b, result) {
    var ra = a.rating, rb = b.rating;
    if (a.id != null && a.id === b.id) {
      return {
        a: { rating: ra, delta: 0, expected: expected(ra, rb), k: 0 },
        b: { rating: rb, delta: 0, expected: expected(rb, ra), k: 0 },
        rated: false
      };
    }
    var ua = update(ra, rb, result, a.games), ub = update(rb, ra, 1 - result, b.games);
    if (ua.k === ub.k) { ub.delta = -ua.delta; ub.rating = Math.round(rb) + ub.delta; }
    return { a: ua, b: ub, rated: true };
  }

  function badgeIndex(key) {
    for (var i = 0; i < BADGES.length; i++) if (BADGES[i].key === key) return i;
    return -1;
  }

  // 積分所在區間的徽章（不管緩衝）→ 'wood'…'diamond'
  function badge(rating) {
    for (var i = BADGES.length - 1; i > 0; i--) if (rating >= BADGES[i].min) return BADGES[i].key;
    return BADGES[0].key;
  }

  // 有緩衝的徽章：升級立即；降級要低於「目前徽章的下限 − 50」才降，
  // 降到哪一級也照同一條規則逐級看（掉到比下一級下限 − 50 還低，才再往下降）；最低降到 badge(rating)。
  // prevBadge 認不得（null、舊資料）時就回傳 badge(rating)。
  function badgeAfter(prevBadge, rating) {
    var now = badge(rating), pi = badgeIndex(prevBadge), ni = badgeIndex(now);
    if (pi < 0 || ni >= pi) return now;
    for (var i = pi; i > ni; i--) if (rating >= BADGES[i].min - DEMOTE_BUFFER) return BADGES[i].key;
    return now;
  }

  // 推薦對手：在 tiers（[{ tier, rating }…]，省略時用已載入的 Gomoku.TIERS）裡，
  // 積分比玩家高 50–150 分的階中挑最接近玩家的；沒有這種階就挑積分最接近的（同距離挑高的那一階）。
  // 回傳階數（整數）；tiers 是空的回傳 null。
  function recommendTier(rating, tiers) {
    tiers = tiers || (root && root.Gomoku && root.Gomoku.TIERS) || [];
    var best = null, bestD = Infinity, i, d;
    for (i = 0; i < tiers.length; i++) {
      d = tiers[i].rating - rating;
      if (d >= 50 && d <= 150 && d < bestD) { best = tiers[i]; bestD = d; }
    }
    if (best) return best.tier;
    for (i = 0; i < tiers.length; i++) {
      d = Math.abs(tiers[i].rating - rating);
      if (d < bestD || (d === bestD && best && tiers[i].rating > best.rating)) { best = tiers[i]; bestD = d; }
    }
    return best ? best.tier : null;
  }

  return {
    START: START,
    BADGES: BADGES,
    DEMOTE_BUFFER: DEMOTE_BUFFER,
    expected: expected,
    kFactor: kFactor,
    update: update,
    settle: settle,
    badge: badge,
    badgeAfter: badgeAfter,
    recommendTier: recommendTier
  };
});
