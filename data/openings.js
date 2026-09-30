/*
 * 連珠 26 種開局（首三手）。資料照 docs/openings-26.md（主線自英文與中文 Wikipedia「Renju opening pattern／連珠開局」
 * 兩張圖轉錄座標；名稱與評價是事實）。評價是「舊 RIF 開局規則下」的簡略評價，不是自由規則的結論。
 * 座標 (r,c)：r 列由上往下 0–14、c 欄由左往右 0–14，天元 (7,7)。黑第一手天元；直止白第二手 (6,7)、斜止 (6,8)。
 * evalKey：black-win 黑必勝、black-adv 黑優勢、black-slight 黑偏優、even 平衡、white-slight 白偏優、white-adv 白優勢、white-win 白必勝。
 * evalNote：中英文版評價用字不同時，括號裡英文版的說法（上面 eval 以中文版為主）。
 * 瀏覽器／Worker：載入後掛在 self.GomokuOpenings；node：module.exports。
 */
(function (root, data) {
  if (typeof module === 'object' && module && module.exports) module.exports = data;
  else root.GomokuOpenings = data;
})(typeof self !== 'undefined' ? self : this, (function () {
  var EVAL = { '黑必勝': 'black-win', '黑優勢': 'black-adv', '黑偏優': 'black-slight', '平衡': 'even', '白偏優': 'white-slight', '白優勢': 'white-adv', '白必勝': 'white-win' };
  // [代號, 名稱, 黑第三手 r, c, 評價, 英文版評價（不同時才寫）]
  var DIRECT = [
    ['D1', '寒星', 5, 7, '黑必勝'],
    ['D2', '溪月', 5, 8, '黑必勝'],
    ['D3', '疏星', 5, 9, '白偏優'],
    ['D4', '花月', 6, 8, '黑必勝'],
    ['D5', '殘月', 6, 9, '黑優勢'],
    ['D6', '雨月', 7, 8, '黑必勝'],
    ['D7', '金星', 7, 9, '黑必勝'],
    ['D8', '松月', 8, 7, '黑優勢', '黑略優'],
    ['D9', '丘月', 8, 8, '黑偏優'],
    ['D10', '新月', 8, 9, '黑必勝', '黑優勢'],
    ['D11', '瑞星', 9, 7, '平衡'],
    ['D12', '山月', 9, 8, '黑優勢'],
    ['D13', '遊星', 9, 9, '白必勝']
  ];
  var INDIRECT = [
    ['I1', '長星', 5, 9, '白優勢'],
    ['I2', '峽月', 6, 9, '黑必勝'],
    ['I3', '恆星', 7, 9, '黑必勝'],
    ['I4', '水月', 8, 9, '黑必勝'],
    ['I5', '流星', 9, 9, '白優勢'],
    ['I6', '雲月', 7, 8, '黑必勝'],
    ['I7', '浦月', 8, 8, '黑必勝'],
    ['I8', '嵐月', 9, 8, '黑必勝'],
    ['I9', '銀月', 8, 7, '黑優勢'],
    ['I10', '明星', 9, 7, '黑必勝'],
    ['I11', '斜月', 8, 6, '黑偏優'],
    ['I12', '名月', 9, 6, '黑優勢'],
    ['I13', '彗星', 9, 5, '白必勝']
  ];
  function build(rows, type, white) {
    return rows.map(function (x) {
      var o = {
        code: x[0], name: x[1], type: type,
        moves: [{ r: 7, c: 7 }, { r: white.r, c: white.c }, { r: x[2], c: x[3] }],
        eval: x[4], evalKey: EVAL[x[4]]
      };
      if (x[5]) o.evalNote = '英文版：' + x[5];
      return o;
    });
  }
  return {
    source: 'docs/openings-26.md（Wikipedia「Renju opening pattern／連珠開局」，舊 RIF 開局規則下的評價）',
    openings: build(DIRECT, 'direct', { r: 6, c: 7 }).concat(build(INDIRECT, 'indirect', { r: 6, c: 8 }))
  };
})());
