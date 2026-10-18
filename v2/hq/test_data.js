/* 验证总部演示数据是否自洽、预警是否合理 */
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8') +
  '\nexports.__ = { HQ, hqShopMetrics, hqTotals, hqAlerts, hqPct };';
const M = { exports: {} };
new Function('exports', 'module', code)(M.exports, M);
const { HQ, hqShopMetrics, hqTotals, hqAlerts } = M.exports.__;

const res = [];
const chk = (n, c, d) => { res.push({ n, pass: !!c, d }); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  | ' + d : ''}`); };

console.log('=== 5 家店 ===');
const ms = HQ.shops.map(hqShopMetrics);
ms.forEach(m => {
  console.log(`${m.name.padEnd(12)} 营收¥${m.revenue.toLocaleString().padStart(7)} ` +
    `环比${(m.revenueChg*100).toFixed(0).padStart(4)}% ` +
    `到店率${(m.arriveRate*100).toFixed(0)}% ` +
    `人效${(m.utilization*100).toFixed(0)}% ` +
    `复购${(m.repeatRate*100).toFixed(0)}% ` +
    `卡余额${m.cardHolding}人/¥${m.cardAmount.toLocaleString()}`);
});

console.log('\n=== 公司合计 ===');
const t = hqTotals();
console.log(`门店 ${t.shopCount} · 营收 ¥${t.revenue.toLocaleString()} (环比 ${(t.revenueChg*100).toFixed(0)}%) · 预约 ${t.bookings} · 到店率 ${(t.arriveRate*100).toFixed(0)}% · 客单价 ¥${t.avgTicket.toFixed(0)}`);

console.log('\n=== 预警 ===');
const alerts = hqAlerts();
alerts.forEach(a => console.log(`[${a.level}] ${a.shop} ${a.icon} ${a.title}`));

console.log('\n=== 断言 ===');

chk('5 家店', ms.length === 5, `${ms.length}`);
chk('营收合计合理（25-35万区间）', t.revenue > 250000 && t.revenue < 350000, `¥${t.revenue}`);

/* 数据自洽：每店 营收 ≈ 客单价 × 订单数 */
let consistent = true;
HQ.shops.forEach(s => {
  const expect = s.cur.avgTicket * s.cur.orders;
  const diff = Math.abs(expect - s.cur.revenue) / s.cur.revenue;
  if (diff > 0.02) { consistent = false; console.log(`  ✗ ${s.name} 营收${s.cur.revenue} vs 客单×单${expect} 偏差${(diff*100).toFixed(1)}%`); }
});
chk('每店 营收 ≈ 客单价×订单数（偏差<2%）', consistent);

/* 到店率必须 ≤ 100% */
chk('所有到店率 ≤ 100%', ms.every(m => m.arriveRate <= 1),
  ms.map(m => (m.arriveRate*100).toFixed(0)+'%').join(','));

/* 高新店必须被识别为"差" */
const gx = ms.find(m => m.name.includes('高新'));
chk('高新店营收环比为负', gx.revenueChg < 0, `${(gx.revenueChg*100).toFixed(0)}%`);
chk('高新店到店率 < 75%', gx.arriveRate < 0.75, `${(gx.arriveRate*100).toFixed(0)}%`);
chk('高新店卡内余额 ≥ 3万（挽回价值）', gx.cardAmount >= 30000, `¥${gx.cardAmount}`);

/* 城东店必须"好" */
const cd = ms.find(m => m.name.includes('城东'));
chk('城东店营收环比为正', cd.revenueChg > 0, `${(cd.revenueChg*100).toFixed(0)}%`);
chk('城东店到店率 > 85%', cd.arriveRate > 0.85, `${(cd.arriveRate*100).toFixed(0)}%`);

/* 预警必须包含高新店 */
chk('★ 预警中必须出现高新店', alerts.some(a => a.shop.includes('高新')),
  alerts.filter(a => a.shop.includes('高新')).length + ' 条');
chk('预警数量合理（3-10 条）', alerts.length >= 3 && alerts.length <= 10, `${alerts.length} 条`);
chk('红色预警排在前面',
  alerts.findIndex(a => a.level === 'amber') === -1 ||
  alerts.findIndex(a => a.level === 'red') < alerts.findIndex(a => a.level === 'amber'));

/* 万达店是新店，复购率低但不应被误报为"差" */
const wd = ms.find(m => m.name.includes('万达'));
chk('万达新店营收环比为正（在增长）', wd.revenueChg > 0, `${(wd.revenueChg*100).toFixed(0)}%`);

console.log();
const pass = res.filter(r => r.pass).length;
console.log(`===== ${pass}/${res.length} 通过 =====`);
process.exit(pass === res.length ? 0 : 1);
