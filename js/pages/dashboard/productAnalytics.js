// ======================================================
// product-analytics.js
// Tab 2: Product & Sales Analytics
// ต้องโหลดหลัง supabaseClient.js, Chart.js, xlsx.js
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
  let monthlySales = [];     // รายเดือน
  let products = [];         // สินค้า (SKU)
  let categories = [];       // หมวด
  let categoryMonthly = [];  // หมวด × เดือน (seasonality)
  let filteredProducts = [];
  let charts = {};

  // Drill-down state
  let drillFilters = {};     // { category: 'ตาข่าย_ม้วน', brand: 'ช้าง' }
  let drillCurrentLevel = null;

  // Table pagination
  let prodSortKey = 'revenue';
  let prodSortDir = 'desc';
  let prodCurrentPage = 1;
  const PAGE_SIZE = 50;

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
  // INITIALIZE (lazy-load เมื่อคลิก tab)
  // -----------------------------
  async function init() {
    if (loaded) return;
    console.log('📦 Product Analytics initializing...');
    await loadAllData();
    attachEvents();
    loaded = true;
  }

  async function loadAllData() {
    try {
      // โหลด views หลายตัวพร้อมกัน
      const [monthlyRes, productsRes, categoriesRes, catMonthlyRes] = await Promise.all([
        loadAllRows('monthly_sales', 'year, month'),
        loadAllRows('product_sales', 'revenue_rank'),
        loadAllRows('category_sales', 'revenue', { ascending: false }),
        loadAllRows('category_seasonality', 'category, month')
      ]);

      monthlySales = monthlyRes;
      products = productsRes;
      categories = categoriesRes;
      categoryMonthly = catMonthlyRes;

      console.log(`✅ Loaded: ${monthlySales.length} months, ${products.length} products, ${categories.length} categories`);

      // Render ทั้งหมด
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

  // Helper: paginate ดึงทุก rows
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
  // INSIGHT GENERATION (narrative)
  // -----------------------------
  function renderInsight() {
    const totalRevenue = monthlySales.reduce((s, m) => s + Number(m.revenue || 0), 0);
    const totalSku = products.length;

    // YoY comparison
    const rev2024 = monthlySales.filter(m => m.year === 2024).reduce((s, m) => s + Number(m.revenue), 0);
    const rev2025 = monthlySales.filter(m => m.year === 2025).reduce((s, m) => s + Number(m.revenue), 0);
    const yoyPct = rev2024 ? ((rev2025 - rev2024) / rev2024 * 100) : 0;
    const yoyDir = yoyPct >= 0 ? 'เติบโต' : 'ลดลง';
    const yoyColor = yoyPct >= 0 ? 'positive' : 'negative';

    // Peak month (สะสมตลอดช่วง)
    const monthTotals = Array(12).fill(0);
    monthlySales.forEach(m => { monthTotals[m.month - 1] += Number(m.revenue); });
    const peakMonthIdx = monthTotals.indexOf(Math.max(...monthTotals));
    const lowMonthIdx = monthTotals.indexOf(Math.min(...monthTotals.filter(v => v > 0)));

    // Top category
    const topCat = categories[0];

    // Top product
    const topProd = products.find(p => p.revenue_rank === 1);

    // Pareto
    const totalProdRev = products.reduce((s, p) => s + Number(p.revenue), 0);
    let cumRev = 0;
    let pareto80 = 0;
    for (const p of products) {
      cumRev += Number(p.revenue);
      pareto80++;
      if (cumRev >= totalProdRev * 0.8) break;
    }
    const paretoPct = totalSku ? (pareto80 / totalSku * 100).toFixed(1) : 0;

    // สร้าง narrative
    const narrative = `
      ในช่วง 2 ปีที่ผ่านมา บริษัทขายสินค้า <strong>${fmt(totalSku)} SKU</strong>
      แบ่งเป็น <strong>${categories.length} หมวด</strong> รวมรายได้ <strong>${fmtCompact(totalRevenue)}</strong>
      ยอดขายปี 2025 ${yoyDir}จาก 2024
      <strong style="color: ${yoyPct >= 0 ? '#1D9E75' : '#A32D2D'}">${Math.abs(yoyPct).toFixed(1)}%</strong>
      หมวดที่ทำเงินสูงสุดคือ <strong>${escapeHtml(topCat?.category || '-')}</strong>
      (${fmtCompact(topCat?.revenue || 0)})
      เดือนขายดีสุดคือ <strong>${THAI_MONTHS[peakMonthIdx]}</strong>
      ส่วนเดือนเงียบสุดคือ <strong>${THAI_MONTHS[lowMonthIdx]}</strong>
      สินค้าเพียง <strong>${pareto80} SKU (${paretoPct}%)</strong>
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

    const topCat = categories[0];
    $('pKpiTopCategory').textContent = topCat?.category || '-';

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
    $('pKpiTopSku').textContent = topProd?.product_code || '-';
    $('pKpiTopSku').title = topProd?.product_code || '';
  }

  // -----------------------------
  // TREND CHART (Line 2024 vs 2025)
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
          {
            label: '2024',
            data: data2024,
            borderColor: '#888780',
            backgroundColor: 'rgba(136, 135, 128, 0.1)',
            borderWidth: 2,
            tension: 0.3,
            borderDash: [5, 5]
          },
          {
            label: '2025',
            data: data2025,
            borderColor: '#1D9E75',
            backgroundColor: 'rgba(29, 158, 117, 0.15)',
            borderWidth: 2.5,
            tension: 0.3,
            fill: true
          }
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

    // Trend insight
    const max2025 = Math.max(...data2025.filter(v => v != null));
    const min2025 = Math.min(...data2025.filter(v => v != null));
    const maxIdx = data2025.indexOf(max2025);
    const minIdx = data2025.indexOf(min2025);
    $('trendInsight').innerHTML = `
      ปี 2025 เดือนยอดสูงสุดคือ <strong>${THAI_MONTHS[maxIdx]}</strong> (${fmtCompact(max2025)})
      เดือนต่ำสุดคือ <strong>${THAI_MONTHS[minIdx]}</strong> (${fmtCompact(min2025)})
      ส่วนต่างสูงสุด-ต่ำสุดคิดเป็น <strong>${(((max2025 - min2025) / max2025) * 100).toFixed(0)}%</strong>
      — ควรวางแผนสต็อกและการขายตามฤดูกาล
    `;
  }

  // -----------------------------
  // TOP / BOTTOM 10 CHARTS
  // -----------------------------
  function renderTopBottomCharts() {
    // Top 10 by revenue
    const top10 = [...products].sort((a, b) => Number(b.revenue) - Number(a.revenue)).slice(0, 10);
    // Bottom 10 (ที่มียอดขาย > 0, ไม่เอาที่ revenue = 0)
    const bottom10 = [...products]
      .filter(p => Number(p.revenue) > 0)
      .sort((a, b) => Number(a.revenue) - Number(b.revenue))
      .slice(0, 10);

    renderHBarChart('chartTop10', 'top', top10, '#1D9E75');
    renderHBarChart('chartBottom10', 'bottom', bottom10, '#E24B4A');
  }

  function renderHBarChart(canvasId, key, data, color) {
    const labels = data.map(p => {
      const raw = p.product_code || '';
      // ตัดให้สั้น ถ้ายาวเกิน
      return raw.length > 50 ? raw.substring(0, 47) + '...' : raw;
    });
    const values = data.map(p => Number(p.revenue));

    if (charts[key]) charts[key].destroy();
    charts[key] = new Chart($(canvasId), {
      type: 'bar',
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: color, borderWidth: 0 }]
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => data[items[0].dataIndex].product_code,
              label: (ctx) => {
                const p = data[ctx.dataIndex];
                return [
                  'รายได้: ' + fmtCompact(p.revenue),
                  'ขาย: ' + fmt(p.total_units) + ' ' + (p.unit_name || ''),
                  'ลูกค้า: ' + fmt(p.unique_clients) + ' ราย'
                ];
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
  // PARETO CHART
  // -----------------------------
  function renderParetoChart() {
    const sorted = [...products].sort((a, b) => Number(b.revenue) - Number(a.revenue));
    const total = sorted.reduce((s, p) => s + Number(p.revenue), 0);

    // ทำเป็น bucket 20 จุด (แทนที่จะ plot ทุก 3500 SKU)
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
          {
            label: 'รายได้สะสม (กลุ่มสินค้า)',
            data: bars,
            backgroundColor: '#378ADD',
            borderWidth: 0,
            yAxisID: 'y'
          },
          {
            label: 'สะสม %',
            data: cumLine,
            type: 'line',
            borderColor: '#E24B4A',
            backgroundColor: 'transparent',
            borderWidth: 2,
            tension: 0.2,
            yAxisID: 'y1',
            pointRadius: 3
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 10, font: { size: 11 } } }
        },
        scales: {
          y: {
            beginAtZero: true, position: 'left',
            title: { display: true, text: 'รายได้', font: { size: 10 } },
            ticks: { callback: v => fmtCompact(v), font: { size: 10 } }
          },
          y1: {
            beginAtZero: true, max: 100, position: 'right',
            title: { display: true, text: 'สะสม %', font: { size: 10 } },
            ticks: { callback: v => v + '%', font: { size: 10 } },
            grid: { drawOnChartArea: false }
          },
          x: { title: { display: true, text: 'กลุ่มสินค้า (เรียงจากขายดี → ขายน้อย)', font: { size: 10 } }, ticks: { font: { size: 10 } } }
        }
      }
    });

    // Pareto insight
    let count80 = 0;
    let cumForInsight = 0;
    for (const p of sorted) {
      cumForInsight += Number(p.revenue);
      count80++;
      if (cumForInsight >= total * 0.8) break;
    }
    const pct80 = sorted.length ? (count80 / sorted.length * 100).toFixed(1) : 0;
    $('paretoInsight').innerHTML = `
      สินค้า <strong>${fmt(count80)} SKU</strong> (${pct80}% ของทั้งหมด)
      สร้างรายได้ <strong>80%</strong> — ควรโฟกัสบริหารสต็อกและโปรโมชั่นกับกลุ่มนี้
      ส่วนสินค้าที่เหลือ <strong>${fmt(sorted.length - count80)} SKU</strong>
      ทำรายได้แค่ 20% — อาจพิจารณาลด SKU ที่ขายไม่ออกเลย
    `;
  }

  // -----------------------------
  // SEASONALITY HEATMAP (Category × Month)
  // -----------------------------
  function renderSeasonalityHeatmap() {
    // เลือก top 10 หมวดตามรายได้
    const topCats = categories.slice(0, 10).map(c => c.category);

    // สร้าง matrix [category][month]
    const matrix = {};
    topCats.forEach(c => { matrix[c] = Array(12).fill(0); });
    categoryMonthly.forEach(row => {
      if (matrix[row.category]) {
        matrix[row.category][row.month - 1] += Number(row.revenue || 0);
      }
    });

    // หา max ใน matrix ทั้งหมดเพื่อ normalize สี
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
        const bg = `rgba(29, 158, 117, ${0.08 + intensity * 0.8})`;
        const color = intensity > 0.5 ? 'white' : '#2c2c2a';
        const display = val >= 1e6 ? (val / 1e6).toFixed(1) : (val >= 1e3 ? (val / 1e3).toFixed(0) + 'K' : '');
        html += `<td style="background:${bg}; color:${color}" title="${escapeHtml(cat)} — ${THAI_MONTHS[i]}: ${fmtCurrency(val)}">${display}</td>`;
      });
      html += `<td style="background: #f7f7f5; color: #2c2c2a; font-weight: 500;">${fmtCompact(rowSum)}</td>`;
      html += '</tr>';
    });

    html += '</tbody></table>';
    $('seasonalityHeatmap').innerHTML = html;
  }

  // -----------------------------
  // DRILL-DOWN (Interactive exploration)
  // -----------------------------
  function drillReset() {
    drillFilters = {};
    drillCurrentLevel = null;
    renderDrillChart();
  }

  function renderDrillBreadcrumb() {
    const bc = $('drillBreadcrumb');
    const items = [];
    items.push(`<a class="breadcrumb-item" onclick="Product.drillReset()">🏠 ทั้งหมด</a>`);

    const order = ['category', 'brand', 'size', 'product_code'];
    const labels = { category: 'หมวด', brand: 'Brand', size: 'ขนาด', product_code: 'SKU' };

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

    // filter products ตาม drillFilters
    let filtered = [...products];
    if (drillFilters.category) filtered = filtered.filter(p => p.category === drillFilters.category);
    if (drillFilters.brand) filtered = filtered.filter(p => p.brand === drillFilters.brand);
    if (drillFilters.size) filtered = filtered.filter(p => p.size === drillFilters.size);

    // group ตาม dimension
    const grouped = {};
    filtered.forEach(p => {
      const key = p[dim] || '(ไม่ระบุ)';
      if (!grouped[key]) {
        grouped[key] = { revenue: 0, units: 0, clients: new Set(), count: 0 };
      }
      grouped[key].revenue += Number(p.revenue || 0);
      grouped[key].units += Number(p.total_units || 0);
      grouped[key].count++;
      // สำหรับ drill: clients เราใช้ unique_clients ของ SKU โดยประมาณ
      grouped[key].clients.add(p.unique_clients);
    });

    let items = Object.entries(grouped).map(([key, v]) => ({
      label: key,
      revenue: v.revenue,
      units: v.units,
      skus: v.count
    }));

    // Sort
    switch (sortBy) {
      case 'revenue':      items.sort((a, b) => b.revenue - a.revenue); break;
      case 'revenue_asc':  items.sort((a, b) => a.revenue - b.revenue); break;
      case 'units':        items.sort((a, b) => b.units - a.units); break;
      case 'clients':      items.sort((a, b) => b.skus - a.skus); break;
    }

    items = items.slice(0, topN);

    const labels = items.map(i => i.label.length > 45 ? i.label.substring(0, 42) + '...' : i.label);
    const values = items.map(i => i.revenue);

    // กำหนดความสูง canvas ตามจำนวนรายการ
    const wrap = $('drillChartWrap');
    wrap.style.height = Math.max(400, items.length * 28 + 60) + 'px';

    if (charts.drill) charts.drill.destroy();
    charts.drill = new Chart($('chartDrill'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: '#378ADD', borderWidth: 0 }]
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        onClick: (evt, elements) => {
          if (elements.length > 0) {
            const idx = elements[0].index;
            const clickedValue = items[idx].label;
            drillInto(dim, clickedValue);
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (ctx) => items[ctx[0].dataIndex].label,
              label: (ctx) => {
                const item = items[ctx.dataIndex];
                return [
                  'รายได้: ' + fmtCompact(item.revenue),
                  'จำนวนขาย: ' + fmt(item.units),
                  'จำนวน SKU: ' + fmt(item.skus),
                  '👆 คลิกเพื่อ drill-down'
                ];
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
    // ตรวจว่า drill ได้ไหม (บางระดับ drill ไม่ได้)
    const hierarchy = ['category', 'brand', 'size', 'product_code'];
    const idx = hierarchy.indexOf(dim);

    if (dim === 'product_code') {
      // ถ้าคลิก SKU → เปลี่ยนไปโหมด "ดูรายละเอียดสินค้า"
      showProductDetail(value);
      return;
    }

    drillFilters[dim] = value;

    // ถ้ามี level ถัดไป → เปลี่ยน dropdown อัตโนมัติ
    if (idx < hierarchy.length - 1) {
      $('drillDimension').value = hierarchy[idx + 1];
    }

    renderDrillChart();
  }

  function showProductDetail(productCode) {
    const p = products.find(x => x.product_code === productCode);
    if (!p) return;
    alert(
      `รายละเอียดสินค้า\n\n` +
      `รหัส: ${p.product_code}\n` +
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
  // PRODUCT TABLE
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
      if (q && !(p.product_code || '').toLowerCase().includes(q)) return false;
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

    const html = rows.map(p => `
      <tr>
        <td class="num">${p.revenue_rank || '-'}</td>
        <td>${escapeHtml(p.product_code || '')}</td>
        <td>${escapeHtml(p.category || '-')}</td>
        <td>${escapeHtml(p.brand || '-')}</td>
        <td>${escapeHtml(p.size || '-')}</td>
        <td class="num">${fmtCurrency(p.revenue || 0)}</td>
        <td class="num">${fmt(p.total_units || 0)}</td>
        <td class="num">${fmt(p.unique_clients || 0)}</td>
        <td class="num">${fmtCurrency(p.avg_price || 0)}</td>
      </tr>
    `).join('');

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

  // -----------------------------
  // MODAL: สินค้าที่ลูกค้าซื้อ
  // -----------------------------
  let currentModalClient = null;
  let currentModalProducts = [];

  async function showClientProducts(clientId, clientName) {
    const modal = $('clientProductsModal');
    const title = $('modalTitle');
    const body = $('modalTableBody');
    const summary = $('modalSummary');

    title.textContent = `สินค้าที่ "${clientName || clientId}" ซื้อ`;
    body.innerHTML = '<tr><td colspan="8" class="empty">กำลังโหลด...</td></tr>';
    summary.innerHTML = '';
    modal.classList.remove('hidden');
    currentModalClient = { id: clientId, name: clientName };

    try {
      const { data, error } = await supabaseClient
        .from('client_product_sales')
        .select('*')
        .eq('client_id', clientId)
        .order('revenue', { ascending: false });
      if (error) throw error;

      currentModalProducts = data || [];

      // Summary
      const totalRevenue = currentModalProducts.reduce((s, r) => s + Number(r.revenue || 0), 0);
      const totalItems = currentModalProducts.reduce((s, r) => s + Number(r.total_units || 0), 0);
      const uniqueCats = new Set(currentModalProducts.map(r => r.category).filter(Boolean)).size;

      summary.innerHTML = `
        <div class="modal-summary-item">รายได้รวม <strong>${fmtCurrency(totalRevenue)}</strong></div>
        <div class="modal-summary-item">จำนวน SKU <strong>${fmt(currentModalProducts.length)}</strong></div>
        <div class="modal-summary-item">หมวด <strong>${fmt(uniqueCats)}</strong></div>
        <div class="modal-summary-item">จำนวนรวม <strong>${fmt(totalItems)}</strong></div>
      `;

      // Render rows
      if (!currentModalProducts.length) {
        body.innerHTML = '<tr><td colspan="8" class="empty">ลูกค้ารายนี้ยังไม่มีประวัติซื้อสินค้า</td></tr>';
        return;
      }

      const rowsHtml = currentModalProducts.map(r => `
        <tr>
          <td>${escapeHtml(r.product_code || '')}</td>
          <td>${escapeHtml(r.category || '-')}</td>
          <td>${escapeHtml(r.brand || '-')}</td>
          <td>${escapeHtml(r.size || '-')}</td>
          <td class="num">${fmt(r.purchase_count || 0)}</td>
          <td class="num">${fmt(r.total_units || 0)}</td>
          <td class="num">${fmtCurrency(r.revenue || 0)}</td>
          <td>${r.last_purchased ? new Date(r.last_purchased).toLocaleDateString('th-TH') : '-'}</td>
        </tr>
      `).join('');

      body.innerHTML = rowsHtml;

    } catch (err) {
      body.innerHTML = `<tr><td colspan="8" class="empty">เกิดข้อผิดพลาด: ${escapeHtml(err.message || err)}</td></tr>`;
      console.error(err);
    }
  }

  function closeModal() {
    $('clientProductsModal').classList.add('hidden');
    currentModalClient = null;
    currentModalProducts = [];
  }

  // -----------------------------
  // EXPORT
  // -----------------------------
  function exportXLSX() {
    if (!filteredProducts.length) { alert('ไม่มีข้อมูล'); return; }
    const rows = filteredProducts.map(p => ({
      'อันดับ': p.revenue_rank,
      'รหัสสินค้า': p.product_code,
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
    if (!currentModalProducts.length) { alert('ไม่มีข้อมูล'); return; }
    const rows = currentModalProducts.map(r => ({
      'รหัสลูกค้า': r.client_id,
      'ชื่อลูกค้า': r.client_name,
      'จังหวัด': r.province,
      'รหัสสินค้า': r.product_code,
      'หมวด': r.category,
      'Brand': r.brand,
      'ขนาด': r.size,
      'จำนวนครั้งที่ซื้อ': Number(r.purchase_count) || 0,
      'จำนวนรวม': Number(r.total_units) || 0,
      'ยอดรวม (บาท)': Number(r.revenue) || 0,
      'ซื้อล่าสุด': r.last_purchased
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Client Products');
    const filename = `${currentModalClient?.id || 'client'}_products_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, filename);
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
    isLoaded,
    drillReset,
    nextPage,
    prevPage,
    exportXLSX,
    showClientProducts,
    closeModal,
    exportClientProductsXLSX
  };

})();

window.Product = Product;

console.log('✅ product-analytics.js loaded');