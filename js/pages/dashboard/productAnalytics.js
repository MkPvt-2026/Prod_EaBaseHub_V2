// ======================================================
// productAnalytics.js v6
// 🆕 รวมสินค้าตามชื่อ (group by name) แทนรหัส
// 🆕 Modal "ดูสินค้าของลูกค้า" มี date filter + expand รหัสย่อย + ประวัติ transactions
// ======================================================

if (typeof supabaseClient === 'undefined') {
  console.error('❌ supabaseClient ไม่พร้อมใช้งาน!');
}

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                     'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const Product = (function () {

  // -----------------------------
  // STATE
  // -----------------------------
  let loaded = false;
  let monthlySales = [];
  let products = [];        // group by product_name
  let categories = [];
  let categoryMonthly = [];
  let filteredProducts = [];
  let charts = {};

  // Drill-down state
  let drillFilters = {};
  let drillCurrentLevel = null;

  // Table pagination
  let prodSortKey = 'revenue';
  let prodSortDir = 'desc';
  let prodCurrentPage = 1;
  const PAGE_SIZE = 50;

  // Modal state
  let modalClient = null;       // { id, name }
  let modalProducts = [];       // products of current client
  let modalDateRange = { start: null, end: null };
  let expandedRows = new Set(); // track expanded product names

  // -----------------------------
  // UTILITIES
  // -----------------------------
  function $(id) { return document.getElementById(id); }
  function fmt(n) { return Math.round(Number(n) || 0).toLocaleString('th-TH'); }
  function fmtCurrency(n) { return '฿' + fmt(n); }
  function fmtCompact(n) {
    n = Number(n) || 0;
    if (Math.abs(n) >= 1e6) return '฿' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '฿' + (n / 1e3).toFixed(1) + 'K';
    return '฿' + fmt(n);
  }
  function fmtThaiDate(d) {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  }
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }
  function isLoaded() { return loaded; }

  // -----------------------------
  // INIT
  // -----------------------------
  async function init() {
    if (loaded) return;
    console.log('📦 Product Analytics initializing...');
    await loadAllData();
    attachEvents();
    loaded = true;
  }

  async function reload() {
    if (!loaded) return;
    console.log('🔄 Product reload (date filter changed)...');
    await loadAllData();
  }

  async function loadAllData() {
    try {
      const range = (typeof DateFilter !== 'undefined') ? DateFilter.getRange() : { start: null, end: null };
      const hasFilter = range.start || range.end;

      let monthlyRes, productsRes, categoriesRes, catMonthlyRes;

      if (hasFilter) {
        [monthlyRes, productsRes, categoriesRes, catMonthlyRes] = await Promise.all([
          callRpcAll('get_monthly_sales_by_range', range),
          callRpcAll('get_product_sales_by_range', range),
          callRpcAll('get_category_sales_by_range', range),
          callRpcAll('get_category_seasonality_by_range', range)
        ]);
      } else {
        [monthlyRes, productsRes, categoriesRes, catMonthlyRes] = await Promise.all([
          loadAllRows('monthly_sales', 'year, month'),
          loadAllRows('product_sales', 'revenue_rank'),
          loadAllRows('category_sales', 'revenue', { ascending: false }),
          loadAllRows('category_seasonality', 'category, month')
        ]);
      }

      monthlySales = monthlyRes;
      products = productsRes;
      categories = categoriesRes;
      categoryMonthly = catMonthlyRes;

      console.log(`✅ Loaded: ${monthlySales.length} months, ${products.length} products (grouped), ${categories.length} categories`);

      renderInsight();
      renderKPIs();
      renderTrendChart();
      renderTopBottomCharts();
      renderParetoChart();
      renderSeasonalityHeatmap();
      populateProductFilters();
      applyProductFilters();
      drillReset();

    } catch (err) {
      console.error('❌ Product loadAllData error:', err);
      alert('โหลดข้อมูลสินค้าไม่สำเร็จ: ' + (err.message || err));
    }
  }

  async function callRpcAll(fnName, range) {
    const { data, error } = await supabaseClient.rpc(fnName, {
      p_start_date: range.start,
      p_end_date: range.end
    });
    if (error) throw error;
    return data || [];
  }

  async function loadAllRows(tableName, orderCol, orderOpts = {}) {
    const all = [];
    const PAGE = 1000;
    let from = 0;
    while (true) {
      let query = supabaseClient.from(tableName).select('*').range(from, from + PAGE - 1);
      if (orderCol) {
        orderCol.split(',').forEach(col => {
          query = query.order(col.trim(), orderOpts);
        });
      }
      const { data, error } = await query;
      if (error) throw error;
      all.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    return all;
  }

  // -----------------------------
  // INSIGHT
  // -----------------------------
  function renderInsight() {
    const totalRevenue = monthlySales.reduce((s, m) => s + Number(m.revenue || 0), 0);
    const totalProducts = products.length;

    const rev2024 = monthlySales.filter(m => m.year === 2024).reduce((s, m) => s + Number(m.revenue), 0);
    const rev2025 = monthlySales.filter(m => m.year === 2025).reduce((s, m) => s + Number(m.revenue), 0);
    const yoyPct = rev2024 ? ((rev2025 - rev2024) / rev2024 * 100) : 0;
    const yoyDir = yoyPct >= 0 ? 'เติบโต' : 'ลดลง';

    const monthTotals = Array(12).fill(0);
    monthlySales.forEach(m => { monthTotals[m.month - 1] += Number(m.revenue); });
    const peakMonthIdx = monthTotals.indexOf(Math.max(...monthTotals));
    const lowMonthIdx = monthTotals.filter(v => v > 0).length
      ? monthTotals.indexOf(Math.min(...monthTotals.filter(v => v > 0)))
      : 0;

    const topCat = categories[0];

    // Pareto
    const totalProdRev = products.reduce((s, p) => s + Number(p.revenue), 0);
    let cumRev = 0;
    let pareto80 = 0;
    for (const p of products) {
      cumRev += Number(p.revenue);
      pareto80++;
      if (cumRev >= totalProdRev * 0.8) break;
    }
    const paretoPct = totalProducts ? (pareto80 / totalProducts * 100).toFixed(1) : 0;

    const narrative = `
      ในช่วงที่เลือก บริษัทขายสินค้า <strong>${fmt(totalProducts)} รายการ</strong> (รวมตามชื่อ)
      แบ่งเป็น <strong>${categories.length} หมวด</strong> รวมรายได้ <strong>${fmtCompact(totalRevenue)}</strong>
      ยอดขายปี 2025 ${yoyDir}จาก 2024
      <strong style="color: ${yoyPct >= 0 ? '#1D9E75' : '#A32D2D'}">${Math.abs(yoyPct).toFixed(1)}%</strong>
      หมวดที่ทำเงินสูงสุดคือ <strong>${escapeHtml(topCat?.category || '-')}</strong>
      (${fmtCompact(topCat?.revenue || 0)})
      เดือนขายดีสุดคือ <strong>${THAI_MONTHS[peakMonthIdx]}</strong>
      สินค้าเพียง <strong>${pareto80} รายการ (${paretoPct}%)</strong>
      สร้างรายได้ถึง 80% ของทั้งหมด — กฎ 80/20 เป็นจริงในธุรกิจนี้
    `;
    $('productInsight').innerHTML = narrative;
  }

  // -----------------------------
  // KPI
  // -----------------------------
  function renderKPIs() {
    $('pKpiSkus').textContent = fmt(products.length);
    $('pKpiCategories').textContent = fmt(categories.length);
    $('pKpiTopCategory').textContent = categories[0]?.category || '-';

    const rev2024 = monthlySales.filter(m => m.year === 2024).reduce((s, m) => s + Number(m.revenue), 0);
    const rev2025 = monthlySales.filter(m => m.year === 2025).reduce((s, m) => s + Number(m.revenue), 0);
    const yoyPct = rev2024 ? ((rev2025 - rev2024) / rev2024 * 100) : 0;
    const yoyEl = $('pKpiYoY');
    yoyEl.textContent = (yoyPct >= 0 ? '+' : '') + yoyPct.toFixed(1) + '%';
    yoyEl.className = 'kpi-value ' + (yoyPct >= 0 ? 'positive' : 'negative');

    const monthTotals = Array(12).fill(0);
    monthlySales.forEach(m => { monthTotals[m.month - 1] += Number(m.revenue); });
    const peakMonthIdx = monthTotals.indexOf(Math.max(...monthTotals));
    $('pKpiPeakMonth').textContent = THAI_MONTHS[peakMonthIdx];

    const topProd = products.find(p => p.revenue_rank === 1);
    const topName = topProd?.product_name || '-';
    $('pKpiTopSku').textContent = topName.length > 25 ? topName.substring(0, 22) + '...' : topName;
    $('pKpiTopSku').title = `${topName}\nรวมจาก ${topProd?.codes_count || 0} รหัส: ${topProd?.codes_list || '-'}`;
  }

  // -----------------------------
  // TREND CHART
  // -----------------------------
  function renderTrendChart() {
    const data2024 = Array(12).fill(null);
    const data2025 = Array(12).fill(null);
    monthlySales.forEach(m => {
      if (m.year === 2024) data2024[m.month - 1] = Number(m.revenue);
      if (m.year === 2025) data2025[m.month - 1] = Number(m.revenue);
    });

    if (charts.trend) charts.trend.destroy();
    charts.trend = new Chart($('chartTrend'), {
      type: 'line',
      data: {
        labels: THAI_MONTHS,
        datasets: [
          { label: '2024', data: data2024, borderColor: '#888780', backgroundColor: 'rgba(136,135,128,0.1)', borderWidth: 2, tension: 0.3, borderDash: [5, 5] },
          { label: '2025', data: data2025, borderColor: '#1D9E75', backgroundColor: 'rgba(29,158,117,0.15)', borderWidth: 2.5, tension: 0.3, fill: true }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtCompact(ctx.parsed.y)}` } }
        },
        scales: {
          y: { beginAtZero: true, ticks: { callback: v => fmtCompact(v), font: { size: 11 } } },
          x: { ticks: { font: { size: 11 } } }
        }
      }
    });

    const max25 = Math.max(...data2025.filter(v => v != null));
    const min25 = Math.min(...data2025.filter(v => v != null));
    const maxIdx = data2025.indexOf(max25);
    const minIdx = data2025.indexOf(min25);
    $('trendInsight').innerHTML = `
      ปี 2025 เดือนยอดสูงสุดคือ <strong>${THAI_MONTHS[maxIdx]}</strong> (${fmtCompact(max25)})
      เดือนต่ำสุดคือ <strong>${THAI_MONTHS[minIdx]}</strong> (${fmtCompact(min25)})
      ส่วนต่างคิดเป็น <strong>${(((max25 - min25) / max25) * 100).toFixed(0)}%</strong>
      — ควรวางแผนสต็อกตามฤดูกาล
    `;
  }

  // -----------------------------
  // TOP / BOTTOM 10 CHARTS — รวมตามชื่อ
  // -----------------------------
  function renderTopBottomCharts() {
    const top10 = [...products].sort((a, b) => Number(b.revenue) - Number(a.revenue)).slice(0, 10);
    const bottom10 = [...products]
      .filter(p => Number(p.revenue) > 0)
      .sort((a, b) => Number(a.revenue) - Number(b.revenue))
      .slice(0, 10);

    renderHBarChart('chartTop10', 'top', top10, '#1D9E75');
    renderHBarChart('chartBottom10', 'bottom', bottom10, '#E24B4A');
  }

  function renderHBarChart(canvasId, key, data, color) {
    const labels = data.map(p => {
      const raw = p.product_name || '';
      return raw.length > 50 ? raw.substring(0, 47) + '...' : raw;
    });
    const values = data.map(p => Number(p.revenue));

    if (charts[key]) charts[key].destroy();
    charts[key] = new Chart($(canvasId), {
      type: 'bar',
      data: { labels, datasets: [{ data: values, backgroundColor: color, borderWidth: 0 }] },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => data[items[0].dataIndex].product_name,
              label: (ctx) => {
                const p = data[ctx.dataIndex];
                const lines = [
                  'รายได้: ' + fmtCompact(p.revenue),
                  'ขาย: ' + fmt(p.total_units) + ' ' + (p.unit_name || ''),
                  'ลูกค้า: ' + fmt(p.unique_clients) + ' ราย'
                ];
                if (p.codes_count > 1) {
                  lines.push(`📌 รวมจาก ${p.codes_count} รหัส`);
                }
                return lines;
              }
            }
          }
        },
        scales: {
          x: { ticks: { callback: v => fmtCompact(v), font: { size: 10 } } },
          y: { ticks: { font: { size: 10 }, autoSkip: false } }
        }
      }
    });
  }

  // -----------------------------
  // PARETO
  // -----------------------------
  function renderParetoChart() {
    const sorted = [...products].sort((a, b) => Number(b.revenue) - Number(a.revenue));
    const total = sorted.reduce((s, p) => s + Number(p.revenue), 0);

    const buckets = 20;
    const bucketSize = Math.ceil(sorted.length / buckets);
    const labels = [];
    const bars = [];
    const cumLine = [];
    let cum = 0;

    for (let i = 0; i < buckets; i++) {
      const start = i * bucketSize;
      const end = Math.min(start + bucketSize, sorted.length);
      const slice = sorted.slice(start, end);
      const sum = slice.reduce((s, p) => s + Number(p.revenue), 0);
      cum += sum;
      labels.push(`${start + 1}-${end}`);
      bars.push(sum);
      cumLine.push(total ? (cum / total * 100) : 0);
    }

    if (charts.pareto) charts.pareto.destroy();
    charts.pareto = new Chart($('chartPareto'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'รายได้สะสม (กลุ่มสินค้า)', data: bars, backgroundColor: '#378ADD', borderWidth: 0, yAxisID: 'y' },
          { label: 'สะสม %', data: cumLine, type: 'line', borderColor: '#E24B4A', backgroundColor: 'transparent', borderWidth: 2, tension: 0.2, yAxisID: 'y1', pointRadius: 3 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 11 } } } },
        scales: {
          y: { beginAtZero: true, position: 'left', ticks: { callback: v => fmtCompact(v), font: { size: 10 } } },
          y1: { beginAtZero: true, max: 100, position: 'right', ticks: { callback: v => v + '%', font: { size: 10 } }, grid: { drawOnChartArea: false } },
          x: { ticks: { font: { size: 10 } } }
        }
      }
    });

    let count80 = 0, cumForInsight = 0;
    for (const p of sorted) {
      cumForInsight += Number(p.revenue);
      count80++;
      if (cumForInsight >= total * 0.8) break;
    }
    const pct80 = sorted.length ? (count80 / sorted.length * 100).toFixed(1) : 0;
    $('paretoInsight').innerHTML = `
      สินค้า <strong>${fmt(count80)} รายการ</strong> (${pct80}% ของทั้งหมด)
      สร้างรายได้ <strong>80%</strong> — ควรโฟกัสบริหารสต็อกและโปรโมชั่นกับกลุ่มนี้
    `;
  }

  // -----------------------------
  // SEASONALITY
  // -----------------------------
  function renderSeasonalityHeatmap() {
    const topCats = categories.slice(0, 10).map(c => c.category);
    const matrix = {};
    topCats.forEach(c => { matrix[c] = Array(12).fill(0); });
    categoryMonthly.forEach(row => {
      if (matrix[row.category]) {
        matrix[row.category][row.month - 1] += Number(row.revenue || 0);
      }
    });
    let maxVal = 0;
    Object.values(matrix).forEach(arr => arr.forEach(v => { if (v > maxVal) maxVal = v; }));

    let html = '<table class="seasonality-table"><thead><tr><th>หมวด</th>';
    THAI_MONTHS.forEach(m => html += `<th>${m}</th>`);
    html += '<th>รวม</th></tr></thead><tbody>';

    topCats.forEach(cat => {
      const row = matrix[cat];
      const rowSum = row.reduce((a, b) => a + b, 0);
      html += `<tr><td title="${escapeHtml(cat)}">${escapeHtml(cat)}</td>`;
      row.forEach((val, i) => {
        const intensity = maxVal ? val / maxVal : 0;
        const bg = `rgba(29,158,117,${0.08 + intensity * 0.8})`;
        const color = intensity > 0.5 ? 'white' : '#2c2c2a';
        const display = val >= 1e6 ? (val / 1e6).toFixed(1) : (val >= 1e3 ? (val / 1e3).toFixed(0) + 'K' : '');
        html += `<td style="background:${bg};color:${color}" title="${escapeHtml(cat)} — ${THAI_MONTHS[i]}: ${fmtCurrency(val)}">${display}</td>`;
      });
      html += `<td style="background:#f7f7f5;color:#2c2c2a;font-weight:500;">${fmtCompact(rowSum)}</td></tr>`;
    });
    html += '</tbody></table>';
    $('seasonalityHeatmap').innerHTML = html;
  }

  // -----------------------------
  // DRILL-DOWN
  // -----------------------------
  function drillReset() {
    drillFilters = {};
    renderDrillChart();
  }

  function renderDrillBreadcrumb() {
    const bc = $('drillBreadcrumb');
    const items = [`<a class="breadcrumb-item" onclick="Product.drillReset()">🏠 ทั้งหมด</a>`];
    const order = ['category', 'brand', 'size', 'product_name'];
    const labels = { category: 'หมวด', brand: 'Brand', size: 'ขนาด', product_name: 'สินค้า' };

    order.forEach(key => {
      if (drillFilters[key]) {
        items.push('<span class="breadcrumb-sep">›</span>');
        items.push(`<span class="breadcrumb-current">${labels[key]}: ${escapeHtml(drillFilters[key])}</span>`);
      }
    });

    if (items.length === 1) {
      bc.innerHTML = '<span class="breadcrumb-empty">ยังไม่ได้เลือก — คลิกที่แท่งกราฟเพื่อ drill-down</span>';
    } else {
      bc.innerHTML = items.join(' ');
    }
  }

  function renderDrillChart() {
    const dim = $('drillDimension').value;
    const sortBy = $('drillSortBy').value;
    const topN = parseInt($('drillTopN').value);

    let filtered = [...products];
    if (drillFilters.category) filtered = filtered.filter(p => p.category === drillFilters.category);
    if (drillFilters.brand) filtered = filtered.filter(p => p.brand === drillFilters.brand);
    if (drillFilters.size) filtered = filtered.filter(p => p.size === drillFilters.size);

    const grouped = {};
    filtered.forEach(p => {
      const key = (dim === 'product_code' ? p.product_name : p[dim]) || '(ไม่ระบุ)';
      if (!grouped[key]) {
        grouped[key] = { revenue: 0, units: 0, count: 0, codes: 0 };
      }
      grouped[key].revenue += Number(p.revenue || 0);
      grouped[key].units += Number(p.total_units || 0);
      grouped[key].count++;
      grouped[key].codes += Number(p.codes_count || 0);
    });

    let items = Object.entries(grouped).map(([key, v]) => ({
      label: key, revenue: v.revenue, units: v.units, skus: v.count, codes: v.codes
    }));

    switch (sortBy) {
      case 'revenue':     items.sort((a, b) => b.revenue - a.revenue); break;
      case 'revenue_asc': items.sort((a, b) => a.revenue - b.revenue); break;
      case 'units':       items.sort((a, b) => b.units - a.units); break;
      case 'clients':     items.sort((a, b) => b.skus - a.skus); break;
    }
    items = items.slice(0, topN);

    const labels = items.map(i => i.label.length > 45 ? i.label.substring(0, 42) + '...' : i.label);
    const values = items.map(i => i.revenue);

    const wrap = $('drillChartWrap');
    wrap.style.height = Math.max(400, items.length * 28 + 60) + 'px';

    if (charts.drill) charts.drill.destroy();
    charts.drill = new Chart($('chartDrill'), {
      type: 'bar',
      data: { labels, datasets: [{ data: values, backgroundColor: '#378ADD', borderWidth: 0 }] },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        onClick: (evt, elements) => {
          if (elements.length > 0) {
            const idx = elements[0].index;
            drillInto(dim, items[idx].label);
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (ctx) => items[ctx[0].dataIndex].label,
              label: (ctx) => {
                const item = items[ctx.dataIndex];
                const lines = [
                  'รายได้: ' + fmtCompact(item.revenue),
                  'จำนวนขาย: ' + fmt(item.units),
                  'จำนวนสินค้า: ' + fmt(item.skus),
                ];
                if (dim === 'product_code' && item.codes > 1) {
                  lines.push('📌 รวมจาก ' + item.codes + ' รหัส');
                }
                lines.push('👆 คลิกเพื่อ drill-down');
                return lines;
              }
            }
          }
        },
        scales: {
          x: { ticks: { callback: v => fmtCompact(v), font: { size: 10 } } },
          y: { ticks: { font: { size: 10 }, autoSkip: false } }
        }
      }
    });

    renderDrillBreadcrumb();
  }

  function drillInto(dim, value) {
    const hierarchy = ['category', 'brand', 'size', 'product_code'];
    const idx = hierarchy.indexOf(dim);

    if (dim === 'product_code') {
      showProductDetail(value);
      return;
    }

    drillFilters[dim] = value;
    if (idx < hierarchy.length - 1) {
      $('drillDimension').value = hierarchy[idx + 1];
    }
    renderDrillChart();
  }

  function showProductDetail(productName) {
    const p = products.find(x => x.product_name === productName);
    if (!p) return;
    alert(
      `รายละเอียดสินค้า\n\n` +
      `ชื่อ: ${p.product_name}\n` +
      `รหัส: ${p.codes_list || '-'}\n` +
      `จำนวนรหัส: ${p.codes_count || 1}\n` +
      `หมวด: ${p.category || '-'}\n` +
      `Brand: ${p.brand || '-'}\n` +
      `ขนาด: ${p.size || '-'}\n` +
      `รายได้: ${fmtCurrency(p.revenue)}\n` +
      `ขาย: ${fmt(p.total_units)} ${p.unit_name || ''}\n` +
      `ลูกค้า: ${fmt(p.unique_clients)} ราย\n` +
      `ราคาเฉลี่ย: ${fmtCurrency(p.avg_price)}\n` +
      `อันดับรายได้: #${p.revenue_rank}`
    );
  }

  // -----------------------------
  // PRODUCT TABLE — แสดงตามชื่อ
  // -----------------------------
  function populateProductFilters() {
    const cats = [...new Set(products.map(p => p.category).filter(Boolean))].sort();
    const brands = [...new Set(products.map(p => p.brand).filter(Boolean))].sort();

    $('productCategoryFilter').innerHTML = '<option value="">ทั้งหมด</option>' +
      cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    $('productBrandFilter').innerHTML = '<option value="">ทั้งหมด</option>' +
      brands.map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
  }

  function applyProductFilters() {
    const q = $('productSearchInput').value.toLowerCase().trim();
    const cat = $('productCategoryFilter').value;
    const brand = $('productBrandFilter').value;

    filteredProducts = products.filter(p => {
      if (cat && p.category !== cat) return false;
      if (brand && p.brand !== brand) return false;
      if (q) {
        const hay = ((p.product_name || '') + ' ' + (p.codes_list || '')).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    prodCurrentPage = 1;
    sortProducts();
    renderProductTable();
  }

  function sortProducts() {
    filteredProducts.sort((a, b) => {
      let av = a[prodSortKey], bv = b[prodSortKey];
      if (av == null) av = '';
      if (bv == null) bv = '';
      const numA = Number(av), numB = Number(bv);
      if (!isNaN(numA) && !isNaN(numB)) {
        return prodSortDir === 'asc' ? numA - numB : numB - numA;
      }
      return prodSortDir === 'asc'
        ? String(av).localeCompare(String(bv), 'th')
        : String(bv).localeCompare(String(av), 'th');
    });
  }

  function sortProductsBy(key) {
    if (prodSortKey === key) prodSortDir = prodSortDir === 'asc' ? 'desc' : 'asc';
    else { prodSortKey = key; prodSortDir = 'desc'; }
    sortProducts();
    renderProductTable();
  }

  function renderProductTable() {
    $('productRowCount').textContent = `${fmt(filteredProducts.length)} รายการ`;

    const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
    if (prodCurrentPage > totalPages) prodCurrentPage = totalPages;
    const start = (prodCurrentPage - 1) * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, filteredProducts.length);
    const rows = filteredProducts.slice(start, end);

    const html = rows.map(p => {
      const codesBadge = p.codes_count > 1
        ? `<span class="codes-badge" title="รวมจากรหัส: ${escapeHtml(p.codes_list || '')}">${p.codes_count} รหัส</span>`
        : '';
      const tooltip = p.codes_count > 1
        ? `รวมจาก ${p.codes_count} รหัส: ${escapeHtml(p.codes_list)}`
        : `รหัส: ${escapeHtml(p.codes_list || '-')}`;
      return `
      <tr>
        <td class="num">${p.revenue_rank || '-'}</td>
        <td title="${tooltip}">${escapeHtml(p.product_name || '')} ${codesBadge}</td>
        <td>${escapeHtml(p.category || '-')}</td>
        <td>${escapeHtml(p.brand || '-')}</td>
        <td>${escapeHtml(p.size || '-')}</td>
        <td class="num">${fmtCurrency(p.revenue || 0)}</td>
        <td class="num">${fmt(p.total_units || 0)} ${escapeHtml(p.unit_name || '')}</td>
        <td class="num">${fmt(p.unique_clients || 0)}</td>
        <td class="num">${fmtCurrency(p.avg_price || 0)}</td>
      </tr>`;
    }).join('');

    $('productTableBody').innerHTML = html ||
      '<tr><td colspan="9" class="empty">ไม่พบข้อมูล</td></tr>';

    $('productPageInfo').textContent =
      `แสดง ${fmt(start + 1)}-${fmt(end)} จาก ${fmt(filteredProducts.length)} (หน้า ${prodCurrentPage}/${totalPages})`;
  }

  function nextPage() {
    const tot = Math.ceil(filteredProducts.length / PAGE_SIZE);
    if (prodCurrentPage < tot) { prodCurrentPage++; renderProductTable(); }
  }
  function prevPage() {
    if (prodCurrentPage > 1) { prodCurrentPage--; renderProductTable(); }
  }

  // ============================================================================
  // 🆕 MODAL: ดูสินค้าของลูกค้า — รวมตามชื่อ + date filter + drill-down
  // ============================================================================
  async function showClientProducts(clientId, clientName) {
    modalClient = { id: clientId, name: clientName };
    modalDateRange = { start: null, end: null };  // reset
    expandedRows.clear();

    $('modalTitle').textContent = `สินค้าที่ "${clientName || clientId}" ซื้อ`;
    $('clientProductsModal').classList.remove('hidden');

    // Render UI
    renderModalControls();
    await loadModalData();
  }

  function renderModalControls() {
    const html = `
      <div class="modal-date-bar">
        <span class="modal-date-label">📅 ช่วงเวลา:</span>
        <div class="modal-presets">
          <button class="preset-btn modal-preset active" data-preset="all">ทั้งหมด</button>
          <button class="preset-btn modal-preset" data-preset="ytd">ปีนี้</button>
          <button class="preset-btn modal-preset" data-preset="ly">ปีที่แล้ว</button>
          <button class="preset-btn modal-preset" data-preset="last12">12 เดือน</button>
          <button class="preset-btn modal-preset" data-preset="last6">6 เดือน</button>
          <button class="preset-btn modal-preset" data-preset="last3">3 เดือน</button>
        </div>
        <div class="modal-custom-range">
          <input type="date" id="modalDateStart" class="date-input">
          <span>ถึง</span>
          <input type="date" id="modalDateEnd" class="date-input">
          <button class="btn-primary-sm" onclick="Product._applyModalCustom()">ปรับใช้</button>
        </div>
      </div>

      <div id="modalSummary" class="modal-summary">
        <div class="modal-summary-item">กำลังโหลด... <strong>-</strong></div>
      </div>

      <div id="modalProductsTable" class="modal-products-wrap">
        <div class="loading-box"><div class="spinner"></div><p>กำลังโหลด...</p></div>
      </div>
    `;
    $('modalBody').innerHTML = html;

    // Attach preset events
    document.querySelectorAll('.modal-preset').forEach(btn => {
      btn.addEventListener('click', () => applyModalPreset(btn.dataset.preset, btn));
    });
  }

  function applyModalPreset(preset, btn) {
    const dataRange = (typeof DateFilter !== 'undefined') ? DateFilter.getDataRange() : { min: null, max: null };
    if (!dataRange.max) return;

    const max = new Date(dataRange.max);
    let start = null, end = null;

    switch (preset) {
      case 'all': break;
      case 'ytd':
        start = new Date(max.getFullYear(), 0, 1); end = max; break;
      case 'ly':
        start = new Date(max.getFullYear() - 1, 0, 1);
        end = new Date(max.getFullYear() - 1, 11, 31); break;
      case 'last12':
        start = new Date(max); start.setMonth(start.getMonth() - 12); end = max; break;
      case 'last6':
        start = new Date(max); start.setMonth(start.getMonth() - 6); end = max; break;
      case 'last3':
        start = new Date(max); start.setMonth(start.getMonth() - 3); end = max; break;
    }

    modalDateRange.start = start ? toISODate(start) : null;
    modalDateRange.end = end ? toISODate(end) : null;

    document.querySelectorAll('.modal-preset').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    if (modalDateRange.start) $('modalDateStart').value = modalDateRange.start;
    else $('modalDateStart').value = '';
    if (modalDateRange.end) $('modalDateEnd').value = modalDateRange.end;
    else $('modalDateEnd').value = '';

    expandedRows.clear();
    loadModalData();
  }

  function _applyModalCustom() {
    const s = $('modalDateStart').value;
    const e = $('modalDateEnd').value;
    if (s && e && s > e) {
      alert('วันที่เริ่มต้องน้อยกว่าวันที่สิ้นสุด');
      return;
    }
    modalDateRange.start = s || null;
    modalDateRange.end = e || null;
    document.querySelectorAll('.modal-preset').forEach(b => b.classList.remove('active'));
    expandedRows.clear();
    loadModalData();
  }

  function toISODate(d) {
    if (!d) return null;
    if (typeof d === 'string') return d.slice(0, 10);
    return d.toISOString().slice(0, 10);
  }

  async function loadModalData() {
    if (!modalClient) return;

    try {
      const { data, error } = await supabaseClient.rpc('get_client_products_by_range', {
        p_client_id: modalClient.id,
        p_start_date: modalDateRange.start,
        p_end_date: modalDateRange.end
      });
      if (error) throw error;

      modalProducts = data || [];
      renderModalSummary();
      renderModalProducts();
    } catch (err) {
      $('modalProductsTable').innerHTML = `<div class="empty">โหลดไม่สำเร็จ: ${escapeHtml(err.message || err)}</div>`;
      console.error(err);
    }
  }

  function renderModalSummary() {
    const totalRevenue = modalProducts.reduce((s, r) => s + Number(r.revenue || 0), 0);
    const totalPurchases = modalProducts.reduce((s, r) => s + Number(r.purchase_count || 0), 0);
    const uniqueCats = new Set(modalProducts.map(r => r.category).filter(Boolean)).size;

    let dateLabel = 'ทุกช่วง';
    if (modalDateRange.start || modalDateRange.end) {
      dateLabel = `${fmtThaiDate(modalDateRange.start) || 'เริ่ม'} - ${fmtThaiDate(modalDateRange.end) || 'ล่าสุด'}`;
    }

    $('modalSummary').innerHTML = `
      <div class="modal-summary-item">รายได้รวม <strong>${fmtCurrency(totalRevenue)}</strong></div>
      <div class="modal-summary-item">สินค้า <strong>${fmt(modalProducts.length)} รายการ</strong></div>
      <div class="modal-summary-item">หมวด <strong>${fmt(uniqueCats)}</strong></div>
      <div class="modal-summary-item">ครั้งที่ซื้อ <strong>${fmt(totalPurchases)}</strong></div>
      <div class="modal-summary-item">ช่วงเวลา <strong>${dateLabel}</strong></div>
    `;
  }

  function renderModalProducts() {
    if (!modalProducts.length) {
      $('modalProductsTable').innerHTML = '<div class="empty">ไม่มีสินค้าในช่วงเวลาที่เลือก</div>';
      return;
    }

    let html = `
      <table class="modal-table">
        <thead>
          <tr>
            <th style="width:24px;"></th>
            <th>ชื่อสินค้า</th>
            <th>หมวด</th>
            <th class="num">ครั้ง</th>
            <th class="num">จำนวน</th>
            <th>หน่วย</th>
            <th class="num">ราคาเฉลี่ย</th>
            <th class="num">ยอดรวม</th>
            <th>ล่าสุด</th>
          </tr>
        </thead>
        <tbody>
    `;

    modalProducts.forEach((r, idx) => {
      const rowKey = r.product_name;
      const isExpanded = expandedRows.has(rowKey);
      const codesBadge = r.codes_count > 1
        ? `<span class="codes-badge" title="${escapeHtml(r.codes_list || '')}">${r.codes_count} รหัส</span>`
        : '';
      const expandIcon = isExpanded ? '▼' : '▶';

      html += `
        <tr class="modal-product-row" onclick="Product._toggleRow('${escapeHtml(rowKey).replace(/'/g, "\\'")}')">
          <td class="expand-icon">${expandIcon}</td>
          <td>${escapeHtml(r.product_name || '')} ${codesBadge}</td>
          <td>${escapeHtml(r.category || '-')}</td>
          <td class="num">${fmt(r.purchase_count || 0)}</td>
          <td class="num">${fmt(r.total_units || 0)}</td>
          <td>${escapeHtml(r.unit_name || '-')}</td>
          <td class="num">${fmtCurrency(r.avg_price || 0)}</td>
          <td class="num">${fmtCurrency(r.revenue || 0)}</td>
          <td>${fmtThaiDate(r.last_purchased)}</td>
        </tr>
      `;

      if (isExpanded) {
        html += `<tr class="modal-detail-row"><td colspan="9" id="detail-${idx}">
          <div class="loading-box mini"><div class="spinner small"></div><span>กำลังโหลด...</span></div>
        </td></tr>`;
      }
    });

    html += '</tbody></table>';
    $('modalProductsTable').innerHTML = html;

    // Load detail สำหรับแถวที่ expand อยู่
    modalProducts.forEach((r, idx) => {
      if (expandedRows.has(r.product_name)) {
        loadProductDetail(r.product_name, idx);
      }
    });
  }

  async function _toggleRow(productName) {
    if (expandedRows.has(productName)) {
      expandedRows.delete(productName);
    } else {
      expandedRows.add(productName);
    }
    renderModalProducts();
  }

  async function loadProductDetail(productName, rowIdx) {
    const detailEl = $('detail-' + rowIdx);
    if (!detailEl) return;

    try {
      // ดึง 2 ข้อมูลพร้อมกัน: รหัสย่อย + ประวัติ transactions
      const [codesRes, historyRes] = await Promise.all([
        supabaseClient.rpc('get_client_product_codes', {
          p_client_id: modalClient.id,
          p_product_name: productName,
          p_start_date: modalDateRange.start,
          p_end_date: modalDateRange.end
        }),
        supabaseClient.rpc('get_client_product_history', {
          p_client_id: modalClient.id,
          p_product_name: productName,
          p_start_date: modalDateRange.start,
          p_end_date: modalDateRange.end
        })
      ]);

      if (codesRes.error) throw codesRes.error;
      if (historyRes.error) throw historyRes.error;

      const codes = codesRes.data || [];
      const history = historyRes.data || [];

      let html = '<div class="modal-detail-content">';

      // Codes (ถ้ามีหลายรหัส)
      if (codes.length > 1) {
        html += `<div class="detail-section">
          <div class="detail-title">🏷️ รหัสที่ใช้บันทึก (รวมจาก ${codes.length} รหัส)</div>
          <table class="detail-mini-table">
            <thead><tr><th>รหัส</th><th class="num">ครั้ง</th><th class="num">จำนวน</th><th class="num">ยอดรวม</th><th>ล่าสุด</th></tr></thead>
            <tbody>`;
        codes.forEach(c => {
          html += `<tr>
            <td><code>${escapeHtml(c.product_code_only || '-')}</code></td>
            <td class="num">${fmt(c.purchase_count)}</td>
            <td class="num">${fmt(c.total_units)}</td>
            <td class="num">${fmtCurrency(c.revenue)}</td>
            <td>${fmtThaiDate(c.last_purchased)}</td>
          </tr>`;
        });
        html += '</tbody></table></div>';
      }

      // History (transactions)
      html += `<div class="detail-section">
        <div class="detail-title">📅 ประวัติการซื้อ (${history.length} ครั้ง)</div>
        <div class="detail-history-wrap">
          <table class="detail-mini-table">
            <thead><tr><th>วันที่</th><th>รหัส</th><th class="num">จำนวน</th><th>หน่วย</th><th class="num">ราคา/หน่วย</th><th class="num">ยอดรวม</th></tr></thead>
            <tbody>`;
      history.slice(0, 50).forEach(h => {
        html += `<tr>
          <td>${fmtThaiDate(h.transaction_date)}</td>
          <td><code style="font-size:11px;">${escapeHtml(h.product_code_only || '-')}</code></td>
          <td class="num">${fmt(h.sales_unit)}</td>
          <td>${escapeHtml(h.unit_name || '-')}</td>
          <td class="num">${h.unit_price ? fmtCurrency(h.unit_price) : '-'}</td>
          <td class="num">${fmtCurrency(h.sales_value)}</td>
        </tr>`;
      });
      html += '</tbody></table>';
      if (history.length > 50) {
        html += `<div class="detail-more">แสดง 50 ครั้งล่าสุด · ทั้งหมด ${history.length} ครั้ง</div>`;
      }
      html += '</div></div>';

      html += '</div>';
      detailEl.innerHTML = html;

    } catch (err) {
      detailEl.innerHTML = `<div class="empty">โหลดไม่สำเร็จ: ${escapeHtml(err.message || err)}</div>`;
      console.error(err);
    }
  }

  function closeModal() {
    $('clientProductsModal').classList.add('hidden');
    modalClient = null;
    modalProducts = [];
    expandedRows.clear();
  }

  // -----------------------------
  // EXPORT
  // -----------------------------
  function exportXLSX() {
    if (!filteredProducts.length) { alert('ไม่มีข้อมูล'); return; }
    const rows = filteredProducts.map(p => ({
      'อันดับ': p.revenue_rank,
      'ชื่อสินค้า': p.product_name,
      'จำนวนรหัส': p.codes_count,
      'รหัสที่รวม': p.codes_list,
      'หมวด': p.category,
      'Brand': p.brand,
      'ขนาด': p.size,
      'สี': p.color,
      'รายได้ (บาท)': Number(p.revenue) || 0,
      'จำนวนขาย': Number(p.total_units) || 0,
      'หน่วย': p.unit_name,
      'จำนวนลูกค้า': Number(p.unique_clients) || 0,
      'ราคาเฉลี่ย': Number(p.avg_price) || 0,
      'ขายล่าสุด': p.last_sold_date
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Products');
    XLSX.writeFile(wb, `products_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function exportClientProductsXLSX() {
    if (!modalProducts.length) { alert('ไม่มีข้อมูล'); return; }
    const rows = modalProducts.map(r => ({
      'รหัสลูกค้า': modalClient?.id,
      'ชื่อลูกค้า': modalClient?.name,
      'ชื่อสินค้า': r.product_name,
      'จำนวนรหัส': r.codes_count,
      'รหัสที่รวม': r.codes_list,
      'หมวด': r.category,
      'Brand': r.brand,
      'ขนาด': r.size,
      'จำนวนครั้งที่ซื้อ': Number(r.purchase_count) || 0,
      'จำนวนรวม': Number(r.total_units) || 0,
      'หน่วย': r.unit_name,
      'ราคาเฉลี่ย': Number(r.avg_price) || 0,
      'ยอดรวม (บาท)': Number(r.revenue) || 0,
      'ซื้อครั้งแรก': r.first_purchased,
      'ซื้อล่าสุด': r.last_purchased
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Client Products');
    let dateRangeLabel = '';
    if (modalDateRange.start || modalDateRange.end) {
      dateRangeLabel = `_${modalDateRange.start || ''}_${modalDateRange.end || ''}`;
    }
    XLSX.writeFile(wb, `${modalClient?.id || 'client'}_products${dateRangeLabel}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // -----------------------------
  // EVENTS
  // -----------------------------
  function attachEvents() {
    $('productSearchInput').addEventListener('input', debounce(applyProductFilters, 250));
    $('productCategoryFilter').addEventListener('change', applyProductFilters);
    $('productBrandFilter').addEventListener('change', applyProductFilters);

    $('drillDimension').addEventListener('change', renderDrillChart);
    $('drillSortBy').addEventListener('change', renderDrillChart);
    $('drillTopN').addEventListener('change', renderDrillChart);

    document.querySelectorAll('th[data-psort]').forEach(th => {
      th.addEventListener('click', () => sortProductsBy(th.dataset.psort));
    });
  }

  // -----------------------------
  // PUBLIC API
  // -----------------------------
  return {
    init,
    reload,
    isLoaded,
    drillReset,
    nextPage,
    prevPage,
    exportXLSX,
    showClientProducts,
    closeModal,
    exportClientProductsXLSX,
    _toggleRow,
    _applyModalCustom
  };

})();

window.Product = Product;

console.log('✅ product-analytics.js v6 (group by name) loaded');