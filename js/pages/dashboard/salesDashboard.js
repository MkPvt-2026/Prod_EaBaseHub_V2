/* ============================================================
   EABaseHub · Sales Dashboard — Script
   ดึงข้อมูลจริงจาก Supabase (ตาราง sales_data)
   ============================================================ */

'use strict';

// ── Chart config ──────────────────────────────────────────
const GRID_COLOR = 'rgba(0,0,0,.05)';
const TICK_FONT  = { family: "'Kanit', sans-serif", size: 11, weight: '300' };
const GREEN_COLORS = ['#1b5e20','#33913f','#4caf50','#81c784','#c8e6c9','#e8f5e9'];

// ── Chart instances ───────────────────────────────────────
let barChartInst   = null;
let donutChartInst = null;
let lineChartInst  = null;

// ── Sidebar (Responsive) ──────────────────────────────────
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('active');
  document.body.style.overflow = '';
}

window.addEventListener('resize', () => {
  if (window.innerWidth >= 1024) closeSidebar();
});

// ── Format helpers ────────────────────────────────────────
function fmtMoney(val) {
  if (val >= 1_000_000) return '฿' + (val / 1_000_000).toFixed(2) + 'M';
  if (val >= 1_000)     return '฿' + (val / 1_000).toFixed(1) + 'K';
  return '฿' + val.toFixed(0);
}

function fmtNum(val) {
  return val.toLocaleString('th-TH');
}

// ── Fetch data from Supabase ──────────────────────────────
async function fetchSalesData() {
  if (!window.supabaseClient) {
    console.error('❌ Supabase client not ready');
    return null;
  }

  // ดึงทุก record (ถ้าข้อมูลเยอะอาจต้องใช้ pagination)
  const { data, error } = await window.supabaseClient
    .from('sales_data')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('❌ Fetch error:', error.message);
    return null;
  }

  console.log('✅ Fetched', data.length, 'records');
  return data;
}

// ── Compute metrics ───────────────────────────────────────
function computeMetrics(data) {
  const totalAmount  = data.reduce((s, r) => s + (r.amount_net || 0), 0);
  const totalProfit  = data.reduce((s, r) => s + (r.profit || 0), 0);
  const uniqueShops  = new Set(data.map(r => r.customer_code).filter(Boolean)).size;
  const uniqueSales  = new Set(data.map(r => r.sales_code).filter(Boolean)).size;

  return { totalAmount, totalProfit, uniqueShops, uniqueSales };
}

// ── Update metric cards ───────────────────────────────────
function updateMetrics(metrics) {
  document.getElementById('m-total').textContent  = fmtMoney(metrics.totalAmount);
  document.getElementById('m-orders').textContent = fmtNum(metrics.uniqueShops);
  document.getElementById('m-shops').textContent  = fmtNum(metrics.uniqueSales);
  document.getElementById('m-avg').textContent    = fmtMoney(metrics.totalProfit);
}

// ── Build Bar chart (ยอดขายรายพนักงาน) ───────────────────
function buildBarChart(data) {
  // Group by sales_name → sum amount_net
  const map = {};
  data.forEach(r => {
    const key = r.sales_name || r.sales_code || 'ไม่ระบุ';
    map[key] = (map[key] || 0) + (r.amount_net || 0);
  });

  // เรียงจากมากไปน้อย
  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(([k]) => k);
  const values = sorted.map(([, v]) => parseFloat((v / 1000).toFixed(1))); // หน่วย K฿

  if (barChartInst) barChartInst.destroy();
  barChartInst = new Chart(document.getElementById('barChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'ยอดขาย (K฿)',
        data: values,
        backgroundColor: '#33913f',
        borderRadius: 4,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: TICK_FONT,
            maxRotation: 30,
            callback: function(val, idx) {
              // ตัดชื่อยาวให้สั้นลง
              const label = this.getLabelForValue(val);
              return label.length > 8 ? label.slice(0, 8) + '…' : label;
            }
          }
        },
        y: {
          grid: { color: GRID_COLOR },
          ticks: { font: TICK_FONT, callback: v => `${v}K` }
        }
      }
    }
  });
}

// ── Build Donut chart (สัดส่วนตามพนักงาน) ────────────────
function buildDonutChart(data) {
  // Group by sales_name → sum amount_net
  const map = {};
  data.forEach(r => {
    const key = r.sales_name || r.sales_code || 'ไม่ระบุ';
    map[key] = (map[key] || 0) + (r.amount_net || 0);
  });

  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(([k]) => k);
  const values = sorted.map(([, v]) => v);
  const colors = labels.map((_, i) => GREEN_COLORS[i % GREEN_COLORS.length]);

  // Legend
  const container = document.getElementById('donut-legend');
  container.innerHTML = '';
  labels.forEach((label, i) => {
    const total = values.reduce((s, v) => s + v, 0);
    const pct = total > 0 ? ((values[i] / total) * 100).toFixed(1) : 0;
    container.innerHTML += `
      <span>
        <span class="leg-dot" style="background:${colors[i]}"></span>
        ${label.length > 8 ? label.slice(0, 8) + '…' : label} ${pct}%
      </span>`;
  });

  if (donutChartInst) donutChartInst.destroy();
  donutChartInst = new Chart(document.getElementById('donutChart'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderWidth: 0,
        hoverOffset: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: { legend: { display: false } }
    }
  });
}

// ── Build Line chart (ยอดขายรายวัน จาก created_at) ───────
function buildLineChart(data) {
  // Group by วันที่ (YYYY-MM-DD) → sum amount_net
  const map = {};
  data.forEach(r => {
    if (!r.created_at) return;
    const day = r.created_at.slice(0, 10); // "2025-03-01"
    map[day] = (map[day] || 0) + (r.amount_net || 0);
  });

  const sorted = Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  const labels = sorted.map(([k]) => {
    // แสดงเฉพาะวัน/เดือน เช่น "1/3"
    const [, m, d] = k.split('-');
    return `${parseInt(d)}/${parseInt(m)}`;
  });
  const values = sorted.map(([, v]) => parseFloat((v / 1000).toFixed(1)));

  if (lineChartInst) lineChartInst.destroy();
  lineChartInst = new Chart(document.getElementById('lineChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'ยอดขาย (K฿)',
        data: values,
        borderColor: '#33913f',
        backgroundColor: 'rgba(51,145,63,.1)',
        borderWidth: 2,
        pointRadius: 2.5,
        pointBackgroundColor: '#33913f',
        tension: 0.4,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: TICK_FONT, maxTicksLimit: 10 }
        },
        y: {
          grid: { color: GRID_COLOR },
          ticks: { font: TICK_FONT, callback: v => `${v}K` }
        }
      }
    }
  });
}

// ── Build Top Sales table (แทน Top Areas) ─────────────────
function buildAreaTable(data) {
  // Group by sales_name → sum amount_net
  const map = {};
  data.forEach(r => {
    const key = r.sales_name || r.sales_code || 'ไม่ระบุ';
    map[key] = (map[key] || 0) + (r.amount_net || 0);
  });

  const sorted = Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5); // Top 5

  const maxVal = sorted[0]?.[1] || 1;
  const container = document.getElementById('area-list');
  container.innerHTML = '';

  sorted.forEach(([name, val]) => {
    const prog = Math.round((val / maxVal) * 100);
    const valM = (val / 1_000_000).toFixed(2);
    container.innerHTML += `
      <div class="tbl-row">
        <div>
          <span class="area-badge">${name}</span>
          <div class="prog-wrap">
            <div class="prog-bar">
              <div class="prog-fill" style="width:${prog}%"></div>
            </div>
          </div>
        </div>
        <div class="num-right">${valM}</div>
        <div class="pct-right delta-up">+0%</div>
      </div>`;
  });
}

// ── Period filter (กรองจาก created_at) ───────────────────
let allData = null;

function filterByPeriod(period, data) {
  if (!data) return [];
  const now = new Date();

  return data.filter(r => {
    if (!r.created_at) return true; // ถ้าไม่มีวันที่ แสดงทั้งหมด
    const d = new Date(r.created_at);
    if (period === 'week') {
      const diff = (now - d) / (1000 * 60 * 60 * 24);
      return diff <= 7;
    }
    if (period === 'month') {
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }
    if (period === 'quarter') {
      const diff = (now - d) / (1000 * 60 * 60 * 24);
      return diff <= 90;
    }
    return true;
  });
}

function setPeriod(period, btn) {
  document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const filtered = filterByPeriod(period, allData);
  renderAll(filtered);
}

// ── Render everything ─────────────────────────────────────
function renderAll(data) {
  if (!data || data.length === 0) {
    console.warn('⚠️ No data to render');
    return;
  }
  const metrics = computeMetrics(data);
  updateMetrics(metrics);
  buildBarChart(data);
  buildDonutChart(data);
  buildLineChart(data);
  buildAreaTable(data);
}

// ── Loading state ─────────────────────────────────────────
function showLoading(show) {
  // แสดง/ซ่อน indicator อย่างง่าย
  const cards = document.querySelectorAll('.mcard-val');
  cards.forEach(el => {
    if (show) el.textContent = '...';
  });
}

// ── Init ──────────────────────────────────────────────────
(async function init() {
  console.log('🚀 Dashboard init...');
  showLoading(true);

  // รอ supabaseClient พร้อม
  let attempts = 0;
  while (!window.supabaseClient && attempts < 50) {
    await new Promise(r => setTimeout(r, 100));
    attempts++;
  }

  allData = await fetchSalesData();

  if (!allData || allData.length === 0) {
    console.warn('⚠️ ไม่มีข้อมูลใน sales_data หรือ fetch ล้มเหลว');
    showLoading(false);
    return;
  }

  // แสดงข้อมูลเดือนปัจจุบันเป็นค่าเริ่มต้น
  const monthData = filterByPeriod('month', allData);
  // ถ้าเดือนนี้ไม่มีข้อมูล ให้แสดงทั้งหมด
  renderAll(monthData.length > 0 ? monthData : allData);

  console.log('✅ Dashboard ready');
})();