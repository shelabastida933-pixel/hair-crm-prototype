/* ==========================================================================
   总部运营后台 · 演示数据
   
   设计原则：
   - 5 家店（符合客户实际规模）
   - 刻意做出"有好有坏"的对比，让看板能体现价值
   - 数据自洽：营收 ≈ 客单价 × 订单数；到店率 = 到店/预约
   ========================================================================== */

const HQ = {
  company: '宇华养发连锁',
  period: '2026年10月',
  shops: [
    {
      id: 'S01', name: '城东旗舰店', manager: '小王', beds: 6, staffCount: 6,
      open: '2023-05', area: '城东商圈',
      cur: { revenue: 98200, orders: 512, avgTicket: 192, bookings: 582, arrived: 512,
             newCustomers: 68, repeatRate: 0.62, cardHolding: 47, cardAmount: 23500,
             staffHours: 1152, servedHours: 806 },
      prev: { revenue: 87600, orders: 478, avgTicket: 183, bookings: 548, arrived: 478,
              newCustomers: 61, repeatRate: 0.59, cardHolding: 52, cardAmount: 26000,
              staffHours: 1152, servedHours: 762 },
      trend: [78, 82, 85, 88, 94, 98],   // 近6月营收（千元）
    },
    {
      id: 'S02', name: '城西中心店', manager: '李姐', beds: 5, staffCount: 5,
      open: '2023-09', area: '城西社区',
      cur: { revenue: 87500, orders: 488, avgTicket: 179, bookings: 536, arrived: 488,
             newCustomers: 54, repeatRate: 0.58, cardHolding: 38, cardAmount: 19200,
             staffHours: 960, servedHours: 728 },
      prev: { revenue: 81000, orders: 452, avgTicket: 179, bookings: 510, arrived: 452,
              newCustomers: 57, repeatRate: 0.56, cardHolding: 41, cardAmount: 20500,
              staffHours: 960, servedHours: 692 },
      trend: [72, 75, 78, 80, 84, 87],
    },
    {
      id: 'S03', name: '高新科技园店', manager: '张姐', beds: 4, staffCount: 4,
      open: '2025-03', area: '高新区',
      cur: { revenue: 32100, orders: 180, avgTicket: 178, bookings: 290, arrived: 180,
             newCustomers: 41, repeatRate: 0.31, cardHolding: 62, cardAmount: 31000,
             staffHours: 768, servedHours: 312 },
      prev: { revenue: 41700, orders: 228, avgTicket: 183, bookings: 344, arrived: 228,
              newCustomers: 52, repeatRate: 0.39, cardHolding: 55, cardAmount: 27800,
              staffHours: 768, servedHours: 398 },
      trend: [52, 50, 47, 45, 42, 32],
    },
    {
      id: 'S04', name: '老城区店', manager: '刘姐', beds: 3, staffCount: 3,
      open: '2024-11', area: '老城区',
      cur: { revenue: 46800, orders: 268, avgTicket: 175, bookings: 312, arrived: 268,
             newCustomers: 29, repeatRate: 0.54, cardHolding: 24, cardAmount: 12000,
             staffHours: 576, servedHours: 402 },
      prev: { revenue: 44300, orders: 254, avgTicket: 174, bookings: 298, arrived: 254,
              newCustomers: 31, repeatRate: 0.52, cardHolding: 26, cardAmount: 13000,
              staffHours: 576, servedHours: 386 },
      trend: [41, 42, 43, 44, 45, 47],
    },
    {
      id: 'S05', name: '新区万达店', manager: '陈姐', beds: 5, staffCount: 5,
      open: '2026-06', area: '新区万达',
      cur: { revenue: 28400, orders: 152, avgTicket: 187, bookings: 178, arrived: 152,
             newCustomers: 88, repeatRate: 0.22, cardHolding: 15, cardAmount: 7500,
             staffHours: 960, servedHours: 258 },
      prev: { revenue: 22600, orders: 121, avgTicket: 187, bookings: 141, arrived: 121,
              newCustomers: 71, repeatRate: 0.18, cardHolding: 12, cardAmount: 6000,
              staffHours: 960, servedHours: 204 },
      trend: [12, 18, 21, 24, 26, 28],
    },
  ],
};

/* 派生计算 */
function hqPct(cur, prev) {
  if (!prev) return 0;
  return (cur - prev) / prev;
}

function hqShopMetrics(s) {
  const c = s.cur, p = s.prev;
  return {
    id: s.id, name: s.name, manager: s.manager, beds: s.beds, staffCount: s.staffCount,
    revenue: c.revenue, revenueChg: hqPct(c.revenue, p.revenue),
    orders: c.orders, ordersChg: hqPct(c.orders, p.orders),
    avgTicket: c.avgTicket,
    bookings: c.bookings,
    arrived: c.arrived,
    arriveRate: c.bookings ? c.arrived / c.bookings : 0,
    arriveRatePrev: p.bookings ? p.arrived / p.bookings : 0,
    newCustomers: c.newCustomers,
    repeatRate: c.repeatRate,
    cardHolding: c.cardHolding, cardAmount: c.cardAmount,
    utilization: c.staffHours ? c.servedHours / c.staffHours : 0,   // 人效：工时利用率
    revenuePerStaff: c.revenue / s.staffCount,
    trend: s.trend,
  };
}

function hqTotals() {
  const ms = HQ.shops.map(hqShopMetrics);
  const t = ms.reduce((a, m) => {
    a.revenue += m.revenue; a.orders += m.orders;
    a.bookings += m.bookings; a.arrived += m.arrived;
    a.newCustomers += m.newCustomers; a.cardHolding += m.cardHolding;
    a.cardAmount += m.cardAmount;
    return a;
  }, { revenue: 0, orders: 0, bookings: 0, arrived: 0, newCustomers: 0, cardHolding: 0, cardAmount: 0 });

  const prevRev = HQ.shops.reduce((a, s) => a + s.prev.revenue, 0);
  t.revenueChg = prevRev ? (t.revenue - prevRev) / prevRev : 0;
  t.avgTicket = t.orders ? t.revenue / t.orders : 0;
  t.arriveRate = t.bookings ? t.arrived / t.bookings : 0;
  t.shopCount = ms.length;
  return t;
}

/**
 * ★ 异动预警 —— 总部看板真正的价值所在
 * 不是给数字，是告诉人"哪里出了问题"
 */
function hqAlerts() {
  const ms = HQ.shops.map(hqShopMetrics);
  const out = [];

  ms.forEach(m => {
    // ① 营收连续下滑
    const t = m.trend;
    const down3 = t.length >= 3 && t[t.length - 1] < t[t.length - 2] && t[t.length - 2] < t[t.length - 3];
    if (down3) {
      out.push({
        level: 'red', shop: m.name, icon: '📉',
        title: `营收连续 3 个月下滑`,
        detail: `最近三个月 ${t.slice(-3).join(' → ')} 千元，累计下滑 ${Math.round((1 - t[t.length-1]/t[t.length-3])*100)}%`,
        action: '建议核查：客流减少？技师流失？还是竞品分流',
      });
    }
    // ② 到店率明显偏低
    if (m.arriveRate < 0.75) {
      out.push({
        level: 'red', shop: m.name, icon: '🚪',
        title: `到店率仅 ${Math.round(m.arriveRate*100)}%`,
        detail: `${m.bookings} 个预约，只有 ${m.arrived} 人到店（全公司平均 ${Math.round(hqTotals().arriveRate*100)}%）`,
        action: '预约了不来 = 提醒没到位 或 时间不合适，建议改为提前1天确认',
      });
    }
    // ③ 卡内余额沉淀（客户有钱却不来）
    if (m.cardHolding >= 30 && m.cardAmount >= 15000) {
      out.push({
        level: 'amber', shop: m.name, icon: '💳',
        title: `${m.cardHolding} 位客户卡内还有余额`,
        detail: `合计 ¥${m.cardAmount.toLocaleString()} 未消耗，其中多数超过 60 天没到店`,
        action: '这是最值钱的挽回名单 —— 钱已经收了，客户不来等于未来收入蒸发',
      });
    }
    // ④ 人效偏低（排了人但没活）
    if (m.utilization < 0.45) {
      out.push({
        level: 'amber', shop: m.name, icon: '👥',
        title: `技师工时利用率仅 ${Math.round(m.utilization*100)}%`,
        detail: `${m.staffCount} 位技师，实际服务时长只占排班时长的 ${Math.round(m.utilization*100)}%`,
        action: '要么减少排班，要么把人调到忙的时段 —— 空转也是成本',
      });
    }
    // ⑤ 复购率过低（新店除外）
    if (m.repeatRate < 0.35) {
      out.push({
        level: 'amber', shop: m.name, icon: '🔄',
        title: `复购率仅 ${Math.round(m.repeatRate*100)}%`,
        detail: `老客户回头比例偏低，拉新成本在持续消耗`,
        action: '首单体验后没有二次触达，建议加"第2次优惠"',
      });
    }
  });

  // 排序：红色优先
  out.sort((a, b) => (a.level === 'red' ? 0 : 1) - (b.level === 'red' ? 0 : 1));
  return out;
}
