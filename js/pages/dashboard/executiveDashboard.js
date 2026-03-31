/* ============================================================
   EXECVIEW — app.js
   ดึงข้อมูลจาก Supabase แล้ว render charts ทั้งหมด
   Tables: sales_summary_by_product, sales_summary_daily, sales_summary_monthly
   ============================================================ */

/* ─── Globals ────────────────────────────────────────────── */
const PALETTE = {
  accent:  '#E8FF47',
  green:   '#3DFF9A',
  blue:    '#4DA8FF',
  orange:  '#FF8A35',
  purple:  '#C46FFF',
  red:     '#FF4D6A',
  cyan:    '#00E5FF',
  pink:    '#FF6B9D',
};
const COLORS = Object.values(PALETTE);

// Chart instances (kept for destroy/rebuild on refresh)
const charts = {};

/* ─── Utility ────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const fmtNum = (n, d = 0) => new Intl.NumberFormat('th-TH', {
  minimumFractionDigits: d, maximumFractionDigits: d
}).format(n);

function fmtShort(n) {
  if (n == null || isNaN(n)) return '—';
  if (Math.abs(n) >= 1e9) return '฿' + (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return '฿' + (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return '฿' + (n / 1e3).toFixed(1) + 'K';
  return '฿' + fmtNum(n, 0);
}

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

/* ─── Chart Defaults ─────────────────────────────────────── */
Chart.defaults.color = '#666';
Chart.defaults.font.family = "'DM Mono', monospace";
Chart.defaults.font.size = 10;

const tooltipDefaults = {
  backgroundColor: '#181818',
  borderColor: '#333',
  borderWidth: 1,
  padding: 12,
  titleColor: '#888',
  bodyColor: '#F0F0F0',
};

/* ─── Loading UI ─────────────────────────────────────────── */
function setLoadingProgress(pct, text) {
  const bar = $('loadingBar');
  const status = $('loadingStatus');
  if (bar) bar.style.width = pct + '%';
  if (status) status.textContent = text;
}
function hideLoading() {
  const overlay = $('loadingOverlay');
  if (overlay) overlay.classList.add('hidden');
}

/* ─── Date Display ───────────────────────────────────────── */
function updateDate() {
  const el = $('dateDisplay');
  if (!el) return;
  el.textContent = new Date().toLocaleString('th-TH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}
updateDate();
setInterval(updateDate, 60000);

/* ─── Tab Navigation ─────────────────────────────────────── */
const tabMap = {
  overview: 'tabOverview',
  products: 'tabProducts',
  daily:    'tabDaily',
  monthly:  'tabMonthly',
};
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    Object.values(tabMap).forEach(id => {
      const el = $(id);
      if (el) el.style.display = 'none';
    });
    const target = tabMap[btn.dataset.tab];
    if (target) { const el = $(target); if (el) el.style.display = 'flex'; }
  });
});

/* ─── Sparkline ──────────────────────────────────────────── */
function makeSparkline(id, data, color) {
  destroyChart('spark_' + id);
  const canvas = $(id);
  if (!canvas || !data?.length) return;
  charts['spark_' + id] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: data.map((_, i) => i),
      datasets: [{
        data,
        borderColor: color,
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.4,
        fill: true,
        backgroundColor: ctx => {
          const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 40);
          g.addColorStop(0, color + '44');
          g.addColorStop(1, 'transparent');
          return g;
        }
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
      animation: { duration: 800 }
    }
  });
}

/* ════════════════════════════════════════════════════════════
   FETCH FUNCTIONS
   ════════════════════════════════════════════════════════════ */
const db = window.supabaseClient;

async function fetchByProduct() {
  const { data, error } = await db
    .from('sales_summary_by_product')
    .select('product_code, product_name, total_transactions, total_qty_sold, unit, total_revenue')
    .order('total_revenue', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function fetchDaily() {
  const { data, error } = await db
    .from('sales_summary_daily')
    .select('*')
    .order('sale_date', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchMonthly() {
  const { data, error } = await db
    .from('sales_summary_monthly')
    .select('*')
    .order('sale_month', { ascending: true });
  if (error) throw error;
  return data || [];
}

/* ════════════════════════════════════════════════════════════
   RENDER: KPI Cards
   ════════════════════════════════════════════════════════════ */
function renderKPIs(byProduct, daily, monthly) {
  const totalRevenue  = byProduct.reduce((s, r) => s + (+r.total_revenue || 0), 0);
  const totalTxn      = byProduct.reduce((s, r) => s + (+r.total_transactions || 0), 0);
  const totalQty      = byProduct.reduce((s, r) => s + (+r.total_qty_sold || 0), 0);
  const uniqueProducts= byProduct.length;
  const avgRevenue    = uniqueProducts > 0 ? totalRevenue / uniqueProducts : 0;

  // Animate counter
  function animateTo(el, target, prefix = '', suffix = '', decimals = 0) {
    if (!el) return;
    const start = performance.now();
    const duration = 1200;
    function tick(now) {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      const val = ease * target;
      el.textContent = prefix + fmtNum(val, decimals) + suffix;
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  animateTo($('kpiTotalRevenue'), totalRevenue, '฿', '', 0);
  animateTo($('kpiTotalTxn'), totalTxn, '', '', 0);
  animateTo($('kpiTotalQty'), totalQty, '', '', 0);
  animateTo($('kpiAvgRevenue'), avgRevenue, '฿', '', 0);
  animateTo($('kpiUniqueProducts'), uniqueProducts, '', '', 0);

  // Deltas from monthly data (last 2 months)
  if (monthly.length >= 2) {
    const last = monthly[monthly.length - 1];
    const prev = monthly[monthly.length - 2];
    const revField  = last.total_revenue ?? last.revenue ?? last.total_sales ?? null;
    const prevField = prev.total_revenue ?? prev.revenue ?? prev.total_sales ?? null;
    if (revField != null && prevField != null && prevField > 0) {
      const pct = ((revField - prevField) / prevField * 100).toFixed(1);
      const el = $('kpiRevenueDelta');
      if (el) {
        el.className = 'kpi-delta ' + (pct >= 0 ? 'positive' : 'negative');
        el.innerHTML = `<svg viewBox="0 0 16 16" style="${pct < 0 ? 'transform:rotate(180deg)' : ''}"><polyline points="2,12 8,4 14,12"/></svg>${pct >= 0 ? '+' : ''}${pct}% vs เดือนก่อน`;
      }
    }
  }

  // Sparklines from monthly
  if (monthly.length > 1) {
    const revenueKey = Object.keys(monthly[0]).find(k =>
      k.includes('revenue') || k.includes('sales') || k.includes('amount')
    );
    const txnKey = Object.keys(monthly[0]).find(k =>
      k.includes('transaction') || k.includes('order') || k.includes('count')
    );
    if (revenueKey) {
      const vals = monthly.map(m => +(m[revenueKey] || 0));
      makeSparkline('sparkRevenue', vals.slice(-12), PALETTE.accent);
      makeSparkline('sparkPipeline', vals.slice(-12), PALETTE.purple);
    }
    if (txnKey) {
      const vals = monthly.map(m => +(m[txnKey] || 0));
      makeSparkline('sparkOrders', vals.slice(-12), PALETTE.green);
    }
  }

  // Sparklines from byProduct
  const revs = byProduct.slice(0, 20).map(r => +(r.total_revenue || 0));
  makeSparkline('sparkDeal', revs, PALETTE.blue);
  makeSparkline('sparkWin', byProduct.slice(0, 20).map(r => +(r.total_qty_sold || 0)), PALETTE.orange);

  // Bottom stats
  const qsActual = $('qsActual'); if (qsActual) qsActual.textContent = fmtShort(totalRevenue);
  const qsOrders = $('qsOrders'); if (qsOrders) qsOrders.textContent = fmtNum(totalTxn);
  const qsProds  = $('qsProducts'); if (qsProds) qsProds.textContent = fmtNum(uniqueProducts);
}

/* ════════════════════════════════════════════════════════════
   RENDER: Monthly Revenue Trend
   ════════════════════════════════════════════════════════════ */
function renderMonthlyTrend(monthly) {
  destroyChart('revenueTrend');
  const canvas = $('chartRevenueTrend');
  if (!canvas || !monthly.length) return;

  // ตรวจหา field names
  const sample = monthly[0];
  const dateKey = Object.keys(sample).find(k =>
    k.includes('month') || k.includes('date') || k.includes('period') || k.includes('year')
  ) || Object.keys(sample)[0];
  const revKey = Object.keys(sample).find(k =>
    k.includes('revenue') || k.includes('sales') || k.includes('amount') || k.includes('total')
  );
  const txnKey = Object.keys(sample).find(k =>
    k.includes('transaction') || k.includes('order') || k.includes('count') || k.includes('qty')
  );

  const labels = monthly.map(m => {
    const v = m[dateKey];
    if (!v) return '—';
    const d = new Date(v);
    return isNaN(d) ? String(v).slice(0, 7) : d.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' });
  });

  const revenueData = revKey ? monthly.map(m => +(m[revKey] || 0)) : [];
  const txnData     = txnKey ? monthly.map(m => +(m[txnKey] || 0)) : [];

  const datasets = [];
  if (revenueData.length) {
    datasets.push({
      label: 'Revenue',
      data: revenueData,
      type: 'bar',
      backgroundColor: ctx => {
        const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 250);
        g.addColorStop(0, PALETTE.accent + 'cc');
        g.addColorStop(1, PALETTE.accent + '22');
        return g;
      },
      borderColor: PALETTE.accent,
      borderWidth: 1,
      borderRadius: 3,
      borderSkipped: false,
      yAxisID: 'yRev',
      order: 2,
    });
  }
  if (txnData.length) {
    datasets.push({
      label: 'Transactions',
      data: txnData,
      type: 'line',
      borderColor: PALETTE.blue,
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: PALETTE.blue,
      tension: 0.3,
      fill: false,
      yAxisID: 'yTxn',
      order: 1,
    });
  }

  const scales = {
    x: { grid: { color: '#1e1e1e' }, ticks: { color: '#555' }, border: { color: '#2a2a2a' } },
  };
  if (revenueData.length) scales.yRev = {
    type: 'linear', position: 'left',
    grid: { color: '#1e1e1e' },
    ticks: { color: '#555', callback: v => fmtShort(v) },
    border: { color: '#2a2a2a' }
  };
  if (txnData.length) scales.yTxn = {
    type: 'linear', position: 'right',
    grid: { drawOnChartArea: false },
    ticks: { color: PALETTE.blue, callback: v => fmtNum(v) },
    border: { color: '#2a2a2a' }
  };

  charts.revenueTrend = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { ...tooltipDefaults, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtShort(ctx.parsed.y)}` } }
      },
      scales
    }
  });
}

/* ════════════════════════════════════════════════════════════
   RENDER: Top Products Donut
   ════════════════════════════════════════════════════════════ */
function renderTopProductsDonut(byProduct) {
  destroyChart('topDonut');
  const canvas = $('chartCategory');
  const legendEl = $('categoryLegend');
  if (!canvas) return;

  const top5 = byProduct.filter(r => (r.total_revenue || 0) > 0).slice(0, 5);
  const totalRev = byProduct.reduce((s, r) => s + (+r.total_revenue || 0), 0);

  // Update donut center
  const donutTotal = $('donutTotal');
  if (donutTotal) donutTotal.textContent = fmtShort(totalRev);

  if (!top5.length) return;

  const labels = top5.map(r => r.product_name || r.product_code || '—');
  const values = top5.map(r => +(r.total_revenue || 0));

  charts.topDonut = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: COLORS.slice(0, 5).map(c => c + 'cc'),
        borderColor: COLORS.slice(0, 5),
        borderWidth: 1.5,
        hoverOffset: 8,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: { ...tooltipDefaults, callbacks: { label: ctx => ` ${fmtShort(ctx.parsed)}` } }
      }
    }
  });

  // Legend
  if (legendEl) {
    legendEl.innerHTML = '';
    top5.forEach((r, i) => {
      const pct = totalRev > 0 ? ((r.total_revenue / totalRev) * 100).toFixed(1) : 0;
      const item = document.createElement('div');
      item.className = 'donut-legend-item';
      item.innerHTML = `
        <div class="donut-legend-left">
          <div class="donut-legend-dot" style="background:${COLORS[i]}"></div>
          <span style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.product_name}">${r.product_name || r.product_code}</span>
        </div>
        <div class="donut-legend-pct">${pct}%</div>
      `;
      legendEl.appendChild(item);
    });
  }
}

/* ════════════════════════════════════════════════════════════
   RENDER: Daily Revenue Chart
   ════════════════════════════════════════════════════════════ */
function renderDailyChart(daily, canvasId = 'chartDaily', limit = 30) {
  destroyChart('daily_' + canvasId);
  const canvas = $(canvasId);
  if (!canvas || !daily.length) return;

  const sample = daily[0];
  const dateKey = Object.keys(sample).find(k =>
    k.includes('date') || k.includes('day') || k.includes('period')
  ) || Object.keys(sample)[0];
  const revKey = Object.keys(sample).find(k =>
    k.includes('revenue') || k.includes('sales') || k.includes('amount') || k.includes('total')
  );
  const txnKey = Object.keys(sample).find(k =>
    k.includes('transaction') || k.includes('order') || k.includes('count')
  );

  const sliced = limit ? daily.slice(-limit) : daily;
  const labels = sliced.map(d => {
    const v = d[dateKey];
    const dt = new Date(v);
    return isNaN(dt) ? String(v).slice(5) : dt.toLocaleDateString('th-TH', { month: 'short', day: 'numeric' });
  });
  const revenueData = revKey ? sliced.map(d => +(d[revKey] || 0)) : [];

  charts['daily_' + canvasId] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Revenue',
        data: revenueData,
        backgroundColor: PALETTE.accent + '88',
        borderColor: PALETTE.accent,
        borderWidth: 1,
        borderRadius: 2,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...tooltipDefaults, callbacks: { label: ctx => ` ฿${fmtNum(ctx.parsed.y)}` } }
      },
      scales: {
        x: { grid: { color: '#1a1a1a' }, ticks: { color: '#555', maxRotation: 45 }, border: { color: '#2a2a2a' } },
        y: { grid: { color: '#1a1a1a' }, ticks: { color: '#555', callback: v => fmtShort(v) }, border: { color: '#2a2a2a' } }
      }
    }
  });

  // Daily Transactions (separate canvas if exists)
  const txnCanvas = $('chartDailyTxn');
  if (txnCanvas && txnKey) {
    destroyChart('dailyTxn');
    const txnData = (limit ? daily.slice(-limit) : daily).map(d => +(d[txnKey] || 0));
    charts.dailyTxn = new Chart(txnCanvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Transactions',
          data: txnData,
          borderColor: PALETTE.blue,
          borderWidth: 2,
          pointRadius: 2,
          pointBackgroundColor: PALETTE.blue,
          tension: 0.3,
          fill: true,
          backgroundColor: PALETTE.blue + '22',
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { ...tooltipDefaults } },
        scales: {
          x: { grid: { color: '#1a1a1a' }, ticks: { color: '#555', maxRotation: 45 }, border: { color: '#2a2a2a' } },
          y: { grid: { color: '#1a1a1a' }, ticks: { color: '#555' }, border: { color: '#2a2a2a' } }
        }
      }
    });
  }
}

/* ════════════════════════════════════════════════════════════
   RENDER: Top Products by Qty
   ════════════════════════════════════════════════════════════ */
function renderQtyTopChart(byProduct) {
  destroyChart('qtyTop');
  const canvas = $('chartQtyTop');
  if (!canvas) return;

  const top10 = byProduct
    .filter(r => (r.total_qty_sold || 0) > 0)
    .sort((a, b) => b.total_qty_sold - a.total_qty_sold)
    .slice(0, 10);

  charts.qtyTop = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: top10.map(r => {
        const name = r.product_name || r.product_code || '—';
        return name.length > 20 ? name.slice(0, 20) + '…' : name;
      }),
      datasets: [{
        data: top10.map(r => +(r.total_qty_sold || 0)),
        backgroundColor: COLORS.map(c => c + 'aa'),
        borderColor: COLORS,
        borderWidth: 1.5,
        borderRadius: 3,
        borderSkipped: false,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...tooltipDefaults, callbacks: { label: ctx => ` Qty: ${fmtNum(ctx.parsed.x)}` } }
      },
      scales: {
        x: { grid: { color: '#1a1a1a' }, ticks: { color: '#555' }, border: { color: '#2a2a2a' } },
        y: { grid: { color: 'transparent' }, ticks: { color: '#888', font: { size: 10 } }, border: { color: '#2a2a2a' } }
      }
    }
  });
}

/* ════════════════════════════════════════════════════════════
   RENDER: Leaderboard
   ════════════════════════════════════════════════════════════ */
function renderLeaderboard(byProduct) {
  const wrap = $('leaderboard');
  if (!wrap) return;
  wrap.innerHTML = '';

  const top10 = byProduct.filter(r => (r.total_revenue || 0) > 0).slice(0, 10);
  const maxRev = top10[0]?.total_revenue || 1;

  top10.forEach((r, i) => {
    const pct = Math.round((r.total_revenue / maxRev) * 100);
    const row = document.createElement('div');
    row.className = 'lb-row' + (i === 0 ? ' lb-top' : '');
    const name = r.product_name || r.product_code || '—';
    row.innerHTML = `
      <div class="lb-rank">${i + 1}</div>
      <div class="lb-info">
        <div class="lb-name" title="${name}">${name.length > 28 ? name.slice(0, 28) + '…' : name}</div>
        <div class="lb-code">${r.product_code || ''}</div>
        <div class="lb-bar-wrap"><div class="lb-bar" data-pct="${pct}"></div></div>
      </div>
      <div class="lb-right">
        <div class="lb-revenue">${fmtShort(r.total_revenue)}</div>
        <div class="lb-qty">Qty: ${fmtNum(r.total_qty_sold || 0)}</div>
      </div>
    `;
    wrap.appendChild(row);
  });

  setTimeout(() => {
    document.querySelectorAll('.lb-bar').forEach(bar => {
      bar.style.width = bar.dataset.pct + '%';
    });
  }, 400);
}

/* ════════════════════════════════════════════════════════════
   RENDER: Unit Gauge
   ════════════════════════════════════════════════════════════ */
function renderUnitGauge(byProduct) {
  destroyChart('gauge');
  const canvas = $('chartGauge');
  if (!canvas) return;

  // Group by unit
  const unitMap = {};
  byProduct.forEach(r => {
    const u = r.unit || 'อื่นๆ';
    unitMap[u] = (unitMap[u] || 0) + (+r.total_revenue || 0);
  });
  const sorted = Object.entries(unitMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topUnit = sorted[0];
  const total = sorted.reduce((s, [, v]) => s + v, 0);
  const topPct = total > 0 ? Math.round((topUnit[1] / total) * 100) : 0;

  const pctEl = $('gaugePct');
  if (pctEl) pctEl.textContent = topUnit ? topUnit[0] : '—';

  charts.gauge = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: sorted.map(([u]) => u),
      datasets: [{
        data: sorted.map(([, v]) => v),
        backgroundColor: COLORS.slice(0, sorted.length).map(c => c + 'dd'),
        borderColor: COLORS.slice(0, sorted.length),
        borderWidth: 1.5,
        circumference: 240,
        rotation: 240,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '72%',
      plugins: {
        legend: { display: false },
        tooltip: { ...tooltipDefaults, callbacks: { label: ctx => ` ${ctx.label}: ${fmtShort(ctx.parsed)}` } }
      },
      animation: { duration: 1400, easing: 'easeOutQuart' }
    }
  });
}

/* ════════════════════════════════════════════════════════════
   RENDER: Data Source Alerts
   ════════════════════════════════════════════════════════════ */
function renderAlerts(byProduct, daily, monthly) {
  const wrap = $('alertsList');
  if (!wrap) return;
  wrap.innerHTML = '';

  const now = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

  const items = [
    {
      type: 'success',
      title: '✅ sales_summary_by_product',
      desc: `โหลดสำเร็จ — ${fmtNum(byProduct.length)} records`,
      time: now
    },
    {
      type: daily.length ? 'success' : 'warn',
      title: daily.length ? '✅ sales_summary_daily' : '⚠ sales_summary_daily',
      desc: daily.length ? `โหลดสำเร็จ — ${fmtNum(daily.length)} records` : 'ไม่มีข้อมูลหรือ permission ถูกปิด',
      time: now
    },
    {
      type: monthly.length ? 'success' : 'warn',
      title: monthly.length ? '✅ sales_summary_monthly' : '⚠ sales_summary_monthly',
      desc: monthly.length ? `โหลดสำเร็จ — ${fmtNum(monthly.length)} records` : 'ไม่มีข้อมูลหรือ permission ถูกปิด',
      time: now
    },
  ];

  // Top product alert
  if (byProduct.length > 0) {
    const top = byProduct[0];
    items.push({
      type: 'info',
      title: `🏆 สินค้ายอดนิยม: ${(top.product_name || top.product_code || '—').slice(0, 30)}`,
      desc: `Revenue: ${fmtShort(top.total_revenue)} | Qty: ${fmtNum(top.total_qty_sold || 0)}`,
      time: now
    });
  }

  const badgeEl = $('alertCount');
  if (badgeEl) badgeEl.textContent = items.length;

  items.forEach(a => {
    const el = document.createElement('div');
    el.className = `alert-item alert-${a.type}`;
    el.innerHTML = `
      <div class="alert-title">${a.title}</div>
      <div class="alert-desc">${a.desc}</div>
      <div class="alert-time">${a.time}</div>
    `;
    wrap.appendChild(el);
  });
}

/* ════════════════════════════════════════════════════════════
   RENDER: Products Tab — All Products Bar
   ════════════════════════════════════════════════════════════ */
function renderAllProductsChart(byProduct) {
  destroyChart('allProducts');
  const canvas = $('chartAllProducts');
  if (!canvas) return;

  const top20 = byProduct.filter(r => (r.total_revenue || 0) > 0).slice(0, 20);

  charts.allProducts = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: top20.map(r => {
        const n = r.product_name || r.product_code || '—';
        return n.length > 24 ? n.slice(0, 24) + '…' : n;
      }),
      datasets: [{
        label: 'Revenue',
        data: top20.map(r => +(r.total_revenue || 0)),
        backgroundColor: top20.map((_, i) => COLORS[i % COLORS.length] + 'bb'),
        borderColor: top20.map((_, i) => COLORS[i % COLORS.length]),
        borderWidth: 1.5,
        borderRadius: 3,
        borderSkipped: false,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...tooltipDefaults, callbacks: { label: ctx => ` ${fmtShort(ctx.parsed.x)}` } }
      },
      scales: {
        x: { grid: { color: '#1a1a1a' }, ticks: { color: '#555', callback: v => fmtShort(v) }, border: { color: '#2a2a2a' } },
        y: { grid: { color: 'transparent' }, ticks: { color: '#888', font: { size: 9 } }, border: { color: '#2a2a2a' } }
      }
    }
  });
}

/* ════════════════════════════════════════════════════════════
   RENDER: Products Tab — Scatter
   ════════════════════════════════════════════════════════════ */
function renderScatterChart(byProduct) {
  destroyChart('scatter');
  const canvas = $('chartScatter');
  if (!canvas) return;

  const data = byProduct
    .filter(r => r.total_revenue > 0 && r.total_qty_sold > 0)
    .slice(0, 100)
    .map(r => ({ x: +(r.total_qty_sold || 0), y: +(r.total_revenue || 0), label: r.product_name }));

  charts.scatter = new Chart(canvas, {
    type: 'scatter',
    data: {
      datasets: [{
        label: 'Products',
        data,
        backgroundColor: PALETTE.accent + '99',
        borderColor: PALETTE.accent,
        borderWidth: 1,
        pointRadius: 5,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...tooltipDefaults, callbacks: { label: ctx => ` Qty: ${fmtNum(ctx.parsed.x)} | Rev: ${fmtShort(ctx.parsed.y)}` } }
      },
      scales: {
        x: { grid: { color: '#1a1a1a' }, ticks: { color: '#555', callback: v => fmtNum(v) }, border: { color: '#2a2a2a' }, title: { display: true, text: 'Qty Sold', color: '#555' } },
        y: { grid: { color: '#1a1a1a' }, ticks: { color: '#555', callback: v => fmtShort(v) }, border: { color: '#2a2a2a' }, title: { display: true, text: 'Revenue', color: '#555' } }
      }
    }
  });
}

/* ════════════════════════════════════════════════════════════
   RENDER: Products Tab — Unit Donut
   ════════════════════════════════════════════════════════════ */
function renderUnitDonut(byProduct) {
  destroyChart('unitDonut');
  const canvas = $('chartUnitDonut');
  if (!canvas) return;

  const unitMap = {};
  byProduct.forEach(r => {
    const u = r.unit || 'อื่นๆ';
    unitMap[u] = (unitMap[u] || 0) + (+r.total_revenue || 0);
  });
  const sorted = Object.entries(unitMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const total = sorted.reduce((s, [, v]) => s + v, 0);

  const donutTotalEl = $('unitDonutTotal');
  if (donutTotalEl) donutTotalEl.textContent = fmtShort(total);

  charts.unitDonut = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: sorted.map(([u]) => u),
      datasets: [{
        data: sorted.map(([, v]) => v),
        backgroundColor: COLORS.slice(0, sorted.length).map(c => c + 'cc'),
        borderColor: COLORS.slice(0, sorted.length),
        borderWidth: 1.5,
        hoverOffset: 6,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: { position: 'bottom', labels: { color: '#888', font: { size: 10 }, padding: 8 } },
        tooltip: { ...tooltipDefaults, callbacks: { label: ctx => ` ${ctx.label}: ${fmtShort(ctx.parsed)}` } }
      }
    }
  });
}

/* ════════════════════════════════════════════════════════════
   RENDER: Monthly Tab
   ════════════════════════════════════════════════════════════ */
function renderMonthlyFullChart(monthly) {
  destroyChart('monthlyFull');
  const canvas = $('chartMonthlyFull');
  if (!canvas || !monthly.length) return;

  const sample = monthly[0];
  const dateKey = Object.keys(sample).find(k => k.includes('month') || k.includes('date')) || Object.keys(sample)[0];
  const revKey  = Object.keys(sample).find(k => k.includes('revenue') || k.includes('sales') || k.includes('amount') || k.includes('total'));
  const txnKey  = Object.keys(sample).find(k => k.includes('transaction') || k.includes('order') || k.includes('count'));

  const labels = monthly.map(m => {
    const v = m[dateKey];
    const d = new Date(v);
    return isNaN(d) ? String(v).slice(0, 7) : d.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' });
  });

  const revenueData = revKey ? monthly.map(m => +(m[revKey] || 0)) : [];

  charts.monthlyFull = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Revenue',
        data: revenueData,
        backgroundColor: ctx => {
          const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 300);
          g.addColorStop(0, PALETTE.accent + 'cc');
          g.addColorStop(1, PALETTE.accent + '11');
          return g;
        },
        borderColor: PALETTE.accent,
        borderWidth: 1,
        borderRadius: 4,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { ...tooltipDefaults, callbacks: { label: ctx => ` ${fmtShort(ctx.parsed.y)}` } } },
      scales: {
        x: { grid: { color: '#1a1a1a' }, ticks: { color: '#555' }, border: { color: '#2a2a2a' } },
        y: { grid: { color: '#1a1a1a' }, ticks: { color: '#555', callback: v => fmtShort(v) }, border: { color: '#2a2a2a' } }
      }
    }
  });

  // MoM Growth
  destroyChart('momGrowth');
  const momCanvas = $('chartMoMGrowth');
  if (momCanvas && revenueData.length > 1) {
    const momData = revenueData.map((v, i) => {
      if (i === 0) return 0;
      const prev = revenueData[i - 1];
      return prev > 0 ? +((v - prev) / prev * 100).toFixed(2) : 0;
    });
    charts.momGrowth = new Chart(momCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'MoM Growth %',
          data: momData,
          backgroundColor: momData.map(v => (v >= 0 ? PALETTE.green : PALETTE.red) + '99'),
          borderColor: momData.map(v => v >= 0 ? PALETTE.green : PALETTE.red),
          borderWidth: 1.5,
          borderRadius: 3,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { ...tooltipDefaults, callbacks: { label: ctx => ` ${ctx.parsed.y > 0 ? '+' : ''}${ctx.parsed.y}%` } } },
        scales: {
          x: { grid: { color: '#1a1a1a' }, ticks: { color: '#555' }, border: { color: '#2a2a2a' } },
          y: { grid: { color: '#1a1a1a' }, ticks: { color: '#555', callback: v => v + '%' }, border: { color: '#2a2a2a' } }
        }
      }
    });
  }

  // Cumulative
  destroyChart('cumulative');
  const cumCanvas = $('chartCumulative');
  if (cumCanvas && revenueData.length) {
    let cum = 0;
    const cumData = revenueData.map(v => (cum += v));
    charts.cumulative = new Chart(cumCanvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Cumulative Revenue',
          data: cumData,
          borderColor: PALETTE.purple,
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: PALETTE.purple,
          tension: 0.3,
          fill: true,
          backgroundColor: PALETTE.purple + '22',
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { ...tooltipDefaults, callbacks: { label: ctx => ` ${fmtShort(ctx.parsed.y)}` } } },
        scales: {
          x: { grid: { color: '#1a1a1a' }, ticks: { color: '#555' }, border: { color: '#2a2a2a' } },
          y: { grid: { color: '#1a1a1a' }, ticks: { color: '#555', callback: v => fmtShort(v) }, border: { color: '#2a2a2a' } }
        }
      }
    });
  }
}

/* ════════════════════════════════════════════════════════════
   MAIN — Load All Data
   ════════════════════════════════════════════════════════════ */
async function loadDashboard() {
  const refreshBtn = $('refreshBtn');
  if (refreshBtn) refreshBtn.classList.add('spinning');

  try {
    setLoadingProgress(10, 'กำลังดึงข้อมูล sales_summary_by_product...');
    const byProduct = await fetchByProduct();

    setLoadingProgress(40, 'กำลังดึงข้อมูล sales_summary_daily...');
    let daily = [];
    try { daily = await fetchDaily(); } catch (e) { console.warn('⚠ sales_summary_daily:', e.message); }

    setLoadingProgress(70, 'กำลังดึงข้อมูล sales_summary_monthly...');
    let monthly = [];
    try { monthly = await fetchMonthly(); } catch (e) { console.warn('⚠ sales_summary_monthly:', e.message); }

    setLoadingProgress(90, 'กำลัง render charts...');

    // ─── Overview Tab ───────────────────────────────────────
    renderKPIs(byProduct, daily, monthly);
    renderMonthlyTrend(monthly);
    renderTopProductsDonut(byProduct);
    renderDailyChart(daily, 'chartDaily', 30);
    renderQtyTopChart(byProduct);
    renderLeaderboard(byProduct);
    renderAlerts(byProduct, daily, monthly);
    renderUnitGauge(byProduct);

    // ─── Products Tab ────────────────────────────────────────
    renderAllProductsChart(byProduct);
    renderScatterChart(byProduct);
    renderUnitDonut(byProduct);

    // ─── Daily Tab ───────────────────────────────────────────
    renderDailyChart(daily, 'chartDailyFull', 0);

    // ─── Monthly Tab ─────────────────────────────────────────
    renderMonthlyFullChart(monthly);

    setLoadingProgress(100, '✅ โหลดข้อมูลเสร็จสมบูรณ์');
    setTimeout(hideLoading, 500);

    console.log(`✅ Loaded: ${byProduct.length} products | ${daily.length} daily | ${monthly.length} monthly`);

  } catch (err) {
    console.error('❌ Dashboard error:', err);
    setLoadingProgress(100, '❌ เกิดข้อผิดพลาด: ' + err.message);
    setTimeout(hideLoading, 2000);
  } finally {
    if (refreshBtn) refreshBtn.classList.remove('spinning');
  }
}

/* ─── Refresh Button ─────────────────────────────────────── */
const refreshBtn = $('refreshBtn');
if (refreshBtn) {
  refreshBtn.addEventListener('click', () => {
    const overlay = $('loadingOverlay');
    if (overlay) {
      overlay.classList.remove('hidden');
      const bar = $('loadingBar');
      if (bar) bar.style.width = '0%';
    }
    loadDashboard();
  });
}

/* ─── Boot ───────────────────────────────────────────────── */
loadDashboard();

/* ════════════════════════════════════════════════════════════
   LOGOUT
   ════════════════════════════════════════════════════════════ */
(function initLogout() {
  const logoutBtn      = $('logoutBtn');
  const backdrop       = $('logoutModalBackdrop');
  const cancelBtn      = $('logoutCancel');
  const confirmBtn     = $('logoutConfirm');

  if (!logoutBtn || !backdrop) return;

  // เปิด modal
  logoutBtn.addEventListener('click', () => {
    backdrop.classList.add('visible');
  });

  // ปิด modal (ยกเลิก)
  cancelBtn?.addEventListener('click', closeModal);

  // ปิด modal เมื่อคลิก backdrop
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) closeModal();
  });

  // ปิด modal เมื่อกด Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && backdrop.classList.contains('visible')) closeModal();
  });

  // ยืนยัน Logout
  confirmBtn?.addEventListener('click', async () => {
    confirmBtn.classList.add('loading');
    confirmBtn.innerHTML = `
      <svg viewBox="0 0 24 24" style="animation:spin 0.8s linear infinite">
        <circle cx="12" cy="12" r="10" stroke-dasharray="31.4" stroke-dashoffset="10"/>
      </svg>
      กำลังออก...
    `;

    try {
      // ── วิธีที่ 1: ใช้ Supabase Auth signOut ──────────────
      if (window.supabaseClient?.auth) {
        await window.supabaseClient.auth.signOut();
      }

      // ── วิธีที่ 2: ใช้ userService ถ้ามี ─────────────────
      if (typeof window.userService?.logout === 'function') {
        await window.userService.logout();
      }

      // ── วิธีที่ 3: ใช้ auth.js ถ้ามี ─────────────────────
      if (typeof window.auth?.logout === 'function') {
        await window.auth.logout();
      }

      // Clear local/session storage
      localStorage.clear();
      sessionStorage.clear();

      // แสดง loading overlay ก่อน redirect
      const overlay = $('loadingOverlay');
      const status  = $('loadingStatus');
      const bar     = $('loadingBar');
      if (overlay) { overlay.classList.remove('hidden'); }
      if (status)  { status.textContent = 'กำลังออกจากระบบ...'; }
      if (bar)     { bar.style.width = '100%'; }

      // Reload หน้า (auth.js จะ redirect ไป login เอง)
      setTimeout(() => { window.location.reload(); }, 600);

    } catch (err) {
      console.error('Logout error:', err);
      // fallback — reload อย่างเดียว
      window.location.reload();
    }
  });

  function closeModal() {
    backdrop.classList.remove('visible');
  }
})();