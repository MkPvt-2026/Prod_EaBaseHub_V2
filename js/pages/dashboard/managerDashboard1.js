// =====================================================
// managerDashboard.js — Sales Intelligence Dashboard v5
// =====================================================
// เพิ่ม: Daily Summary Section (ยอดขายรวมรายวัน)
// - การ์ดสรุป: วันนี้ (ข้อมูลวันก่อน) / เมื่อวาน / สัปดาห์นี้
// - ตารางยอดขายรายวัน 7 วันล่าสุด
// =====================================================

'use strict';

// ── State ─────────────────────────────────────────────────
let salesData     = [];   // จาก sales_data (period ปัจจุบัน)
let prevSalesData = [];   // จาก sales_data (period ก่อน)
let reportsData   = [];   // จาก reports (period ปัจจุบัน — ใช้เฉพาะ heatmap)

let profilesMap   = {};   // uid → { display_name, role, team_id }
let shopsMap      = {};   // id  → shop_name

let currentUser   = null;

// ── Date Range State ──
let dateStart = null;  // Date object
let dateEnd   = null;  // Date object

// ── Daily Section State ──
let dailyChartInst = null;
let selectedDate = null;  // วันที่เลือกดู (null = แสดงทุกวัน)

// ── Daily Summary State (ข้อมูลรายวันแยก) ──
let dailySummaryData = [];  // ข้อมูล 30 วันล่าสุดสำหรับ daily summary

// Chart instances
let chartSalesInst, chartCustomerInst, chartProductInst, chartWeeklyInst;
let chartProfitBySalesInst, chartMarginBySalesInst;

const TARGET_PER_SALES = 500000; // เป้าหมายยอดขายต่อเซลล์ (ปรับได้)

// =====================================================
// 🚀 INIT
// =====================================================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 Manager Dashboard initializing...');
  
  try { 
    await protectPage(['admin', 'manager']); 
  } catch (e) { 
    console.error('❌ protectPage failed:', e);
    return; 
  }

  currentUser = await loadCurrentUser();
  if (!currentUser) {
    console.error('❌ No current user');
    return;
  }

  console.log('✅ User loaded:', currentUser.name);

  // ตั้งค่าเริ่มต้น: 30 วันล่าสุด
  initDateRange();
  setupDateControls();

  await Promise.all([loadProfiles(), loadShops()]);
  
  // โหลด Daily Summary ก่อน (ไม่ขึ้นกับ date range)
  await loadDailySummaryData();
  renderDailySummarySection();
  
  await loadDashboard();
  setupLogout();
  
  console.log('✅ Dashboard initialized successfully');
});

// =====================================================
// 📅 DATE RANGE CONTROLS
// =====================================================
function initDateRange() {
  // ค่าเริ่มต้น: 30 วันล่าสุด
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  
  const start = new Date();
  start.setDate(start.getDate() - 29);
  start.setHours(0, 0, 0, 0);
  
  dateEnd   = today;
  dateStart = start;
  
  // ตั้งค่า input
  const startInput = document.getElementById('dateStart');
  const endInput   = document.getElementById('dateEnd');
  
  if (startInput) startInput.value = formatDateForInput(dateStart);
  if (endInput)   endInput.value   = formatDateForInput(dateEnd);
  
  updateDateRangeLabel();
}

function setupDateControls() {
  // Date inputs
  const startInput = document.getElementById('dateStart');
  const endInput   = document.getElementById('dateEnd');
  
  if (startInput) {
    startInput.addEventListener('change', () => {
      dateStart = new Date(startInput.value);
      dateStart.setHours(0, 0, 0, 0);
      updateDateRangeLabel();
      loadDashboard();
    });
  }
  
  if (endInput) {
    endInput.addEventListener('change', () => {
      dateEnd = new Date(endInput.value);
      dateEnd.setHours(23, 59, 59, 999);
      updateDateRangeLabel();
      loadDashboard();
    });
  }
  
  // Quick buttons
  document.querySelectorAll('.quick-range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const range = btn.dataset.range;
      setQuickRange(range);
      
      // Update active state
      document.querySelectorAll('.quick-range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

function setQuickRange(range) {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  
  let start = new Date();
  start.setHours(0, 0, 0, 0);
  
  let end = new Date(today);
  
  switch (range) {
    case 'today':
      // วันนี้
      break;
      
    case '7days':
      start.setDate(start.getDate() - 6);
      break;
      
    case '30days':
      start.setDate(start.getDate() - 29);
      break;
      
    case 'thisWeek':
      // จันทร์ของสัปดาห์นี้
      const dayOfWeek = start.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      start.setDate(start.getDate() + diff);
      break;
      
    case 'thisMonth':
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      break;
      
    case 'lastMonth':
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      end = new Date(today.getFullYear(), today.getMonth(), 0);
      end.setHours(23, 59, 59, 999);
      break;
      
    case 'thisQuarter':
      const q = Math.floor(today.getMonth() / 3);
      start = new Date(today.getFullYear(), q * 3, 1);
      break;
      
    case 'thisYear':
      start = new Date(today.getFullYear(), 0, 1);
      break;
      
    default:
      start.setDate(start.getDate() - 29);
  }
  
  dateStart = start;
  dateEnd   = end;
  
  // Update inputs
  const startInput = document.getElementById('dateStart');
  const endInput   = document.getElementById('dateEnd');
  if (startInput) startInput.value = formatDateForInput(dateStart);
  if (endInput)   endInput.value   = formatDateForInput(dateEnd);
  
  updateDateRangeLabel();
  loadDashboard();
}

function updateDateRangeLabel() {
  const label = document.getElementById('dateRangeLabel');
  if (!label) return;
  
  const days = Math.ceil((dateEnd - dateStart) / (1000 * 60 * 60 * 24)) + 1;
  const fmt = d => d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
  
  label.textContent = `${fmt(dateStart)} – ${fmt(dateEnd)} (${days} วัน)`;
}

function formatDateForInput(date) {
  return date.toISOString().split('T')[0];
}

// =====================================================
// 👤 CURRENT USER
// =====================================================
async function loadCurrentUser() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return null;

    const { data: p } = await supabaseClient
      .from('profiles')
      .select('id, display_name, role, team_id')
      .eq('id', session.user.id)
      .single();

    const name = p?.display_name || session.user.email;
    setEl('userName',   name);
    setEl('userAvatar', name.charAt(0).toUpperCase());

    return { id: session.user.id, role: p?.role, team_id: p?.team_id, name };
  } catch (e) {
    console.error('loadCurrentUser', e);
    return null;
  }
}

// =====================================================
// 👥 PROFILES & 🏪 SHOPS
// =====================================================
async function loadProfiles() {
  try {
    let q = supabaseClient
      .from('profiles')
      .select('id, display_name, role, team_id')
      .in('role', ['sales', 'user']);

    if (currentUser.role === 'manager' && currentUser.team_id) {
      q = q.eq('team_id', currentUser.team_id);
    }
    const { data } = await q;
    profilesMap = Object.fromEntries((data || []).map(p => [p.id, p]));
    console.log(`✅ Profiles loaded: ${Object.keys(profilesMap).length}`);
  } catch (e) { console.error('loadProfiles', e); }
}

async function loadShops() {
  try {
    const { data } = await supabaseClient
      .from('shops').select('id, shop_name').order('shop_name');
    shopsMap = Object.fromEntries((data || []).map(s => [s.id, s.shop_name]));
    console.log(`✅ Shops loaded: ${Object.keys(shopsMap).length}`);
  } catch (e) { console.error('loadShops', e); }
}

// =====================================================
// 📆 DAILY SUMMARY DATA (ข้อมูลรายวัน 30 วัน)
// =====================================================
async function loadDailySummaryData() {
  try {
    // ดึงข้อมูล 30 วันล่าสุด
    const d30 = new Date();
    d30.setDate(d30.getDate() - 29);
    d30.setHours(0, 0, 0, 0);
    
    const startStr = d30.toISOString().split('T')[0];
    const endStr = new Date().toISOString().split('T')[0];
    
    const { data, error } = await supabaseClient
      .from('sales_data')
      .select('report_date, amount_net, profit, qty_net, sales_code, product_code')
      .gte('report_date', startStr)
      .lte('report_date', endStr);
    
    if (error) throw error;
    
    dailySummaryData = data || [];
    console.log(`✅ Daily summary data loaded: ${dailySummaryData.length} records`);
    
  } catch (e) {
    console.error('loadDailySummaryData', e);
    dailySummaryData = [];
  }
}

// =====================================================
// 📊 DAILY SUMMARY SECTION (การ์ด + ตาราง)
// =====================================================
function renderDailySummarySection() {
  renderDailySummaryCards();
  renderDailySummaryTable();
}

function renderDailySummaryCards() {
  // "วันนี้" = วันก่อนหน้า (เพราะข้อมูลต้องรอ sync)
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const dayBefore = new Date(today);
  dayBefore.setDate(dayBefore.getDate() - 2);
  
  // วันที่ในรูปแบบ YYYY-MM-DD
  const todayStr = yesterday.toISOString().split('T')[0];      // "วันนี้" = วันก่อน
  const yesterdayStr = dayBefore.toISOString().split('T')[0];  // "เมื่อวาน" = 2 วันก่อน
  
  // คำนวณสัปดาห์นี้ (จันทร์ถึงวันก่อนหน้า)
  const weekStart = new Date(yesterday);
  const dayOfWeek = weekStart.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  weekStart.setDate(weekStart.getDate() + diffToMonday);
  const weekStartStr = weekStart.toISOString().split('T')[0];
  
  // รวมยอดตามวัน
  const byDate = {};
  dailySummaryData.forEach(r => {
    const date = r.report_date;
    if (!byDate[date]) {
      byDate[date] = { amount: 0, profit: 0, qty: 0, sales: new Set(), products: new Set() };
    }
    byDate[date].amount += (r.amount_net || 0);
    byDate[date].profit += (r.profit || 0);
    byDate[date].qty += (r.qty_net || 0);
    if (r.sales_code) byDate[date].sales.add(r.sales_code);
    if (r.product_code) byDate[date].products.add(r.product_code);
  });
  
  // ยอดวันนี้ (= วันก่อน)
  const todayData = byDate[todayStr] || { amount: 0, profit: 0, qty: 0 };
  
  // ยอดเมื่อวาน (= 2 วันก่อน)
  const yesterdayData = byDate[yesterdayStr] || { amount: 0, profit: 0, qty: 0 };
  
  // ยอดสัปดาห์นี้
  let weekAmount = 0, weekProfit = 0, weekQty = 0;
  Object.entries(byDate).forEach(([date, d]) => {
    if (date >= weekStartStr && date <= todayStr) {
      weekAmount += d.amount;
      weekProfit += d.profit;
      weekQty += d.qty;
    }
  });
  
  // เปรียบเทียบกับวันก่อนหน้า
  const todayGrowth = yesterdayData.amount > 0 
    ? ((todayData.amount - yesterdayData.amount) / yesterdayData.amount * 100).toFixed(1)
    : null;
  
  // เปรียบเทียบสัปดาห์ก่อน
  const prevWeekStart = new Date(weekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const prevWeekEnd = new Date(weekStart);
  prevWeekEnd.setDate(prevWeekEnd.getDate() - 1);
  const prevWeekStartStr = prevWeekStart.toISOString().split('T')[0];
  const prevWeekEndStr = prevWeekEnd.toISOString().split('T')[0];
  
  let prevWeekAmount = 0;
  Object.entries(byDate).forEach(([date, d]) => {
    if (date >= prevWeekStartStr && date <= prevWeekEndStr) {
      prevWeekAmount += d.amount;
    }
  });
  
  const weekGrowth = prevWeekAmount > 0 
    ? ((weekAmount - prevWeekAmount) / prevWeekAmount * 100).toFixed(1)
    : null;
  
  // วันที่แสดง (วันก่อนหน้า)
  const displayDate = yesterday.toLocaleDateString('th-TH', { 
    weekday: 'long',
    day: 'numeric', 
    month: 'short'
  });
  
  // Set values
  setEl('todaySalesAmount', '฿' + fmtNum(todayData.amount));
  setEl('todaySalesProfit', '฿' + fmtNum(todayData.profit));
  setEl('todaySalesQty', fmtNum(todayData.qty) + ' ชิ้น');
  setEl('todaySalesDate', displayDate);
  
  setEl('yesterdaySalesAmount', '฿' + fmtNum(yesterdayData.amount));
  
  setEl('weekSalesAmount', '฿' + fmtNum(weekAmount));
  setEl('weekSalesProfit', '฿' + fmtNum(weekProfit));
  
  // Growth indicators
  const todayGrowthEl = document.getElementById('todaySalesGrowth');
  if (todayGrowthEl && todayGrowth !== null) {
    const up = parseFloat(todayGrowth) >= 0;
    todayGrowthEl.textContent = (up ? '▲ +' : '▼ ') + todayGrowth + '%';
    todayGrowthEl.className = 'daily-growth ' + (up ? 'up' : 'down');
  }
  
  const weekGrowthEl = document.getElementById('weekSalesGrowth');
  if (weekGrowthEl && weekGrowth !== null) {
    const up = parseFloat(weekGrowth) >= 0;
    weekGrowthEl.textContent = (up ? '▲ +' : '▼ ') + weekGrowth + '% vs สัปดาห์ก่อน';
    weekGrowthEl.className = 'daily-growth ' + (up ? 'up' : 'down');
  }
}

function renderDailySummaryTable() {
  const container = document.getElementById('dailySummaryTable');
  if (!container) return;
  
  // รวมยอดตามวัน
  const byDate = {};
  dailySummaryData.forEach(r => {
    const date = r.report_date;
    if (!byDate[date]) {
      byDate[date] = { amount: 0, profit: 0, qty: 0, sales: new Set(), products: new Set() };
    }
    byDate[date].amount += (r.amount_net || 0);
    byDate[date].profit += (r.profit || 0);
    byDate[date].qty += (r.qty_net || 0);
    if (r.sales_code) byDate[date].sales.add(r.sales_code);
    if (r.product_code) byDate[date].products.add(r.product_code);
  });
  
  // เรียงตามวันที่ล่าสุด และเอา 7 วัน
  const sorted = Object.entries(byDate)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 7);
  
  if (!sorted.length) {
    container.innerHTML = '<div class="loading-text">ไม่มีข้อมูลยอดขายรายวัน</div>';
    return;
  }
  
  // หาค่า max สำหรับ progress bar
  const maxAmount = Math.max(...sorted.map(([, d]) => d.amount)) || 1;
  
  let html = `
    <table class="summary-table">
      <thead>
        <tr>
          <th>วันที่</th>
          <th>ยอดขาย</th>
          <th class="hide-mobile">กำไร</th>
          <th class="hide-mobile">จำนวน</th>
          <th>กราฟ</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  sorted.forEach(([date, d], index) => {
    const dateObj = new Date(date);
    const dayLabel = dateObj.toLocaleDateString('th-TH', { 
      weekday: 'short',
      day: 'numeric', 
      month: 'short'
    });
    
    // หมายเหตุวันล่าสุด
    let badge = '';
    if (index === 0) {
      badge = '<span class="date-badge latest">ล่าสุด</span>';
    }
    
    const pct = Math.round(d.amount / maxAmount * 100);
    const profitMargin = d.amount > 0 ? (d.profit / d.amount * 100).toFixed(1) : 0;
    
    html += `
      <tr>
        <td class="date-col">
          <span class="date-text">${dayLabel}</span>
          ${badge}
        </td>
        <td class="amount-col">
          <span class="amount-value">฿${fmtNum(d.amount)}</span>
        </td>
        <td class="profit-col hide-mobile">
          <span class="profit-value">฿${fmtNum(d.profit)}</span>
          <span class="profit-pct">(${profitMargin}%)</span>
        </td>
        <td class="qty-col hide-mobile">${fmtNum(d.qty)} ชิ้น</td>
        <td class="bar-col">
          <div class="mini-bar-track">
            <div class="mini-bar-fill" style="width: ${pct}%"></div>
          </div>
        </td>
      </tr>
    `;
  });
  
  html += '</tbody></table>';
  container.innerHTML = html;
}

// =====================================================
// 📊 MAIN LOAD
// =====================================================
async function loadDashboard() {
  try {
    showLoadingState(true);

    const startStr = dateStart.toISOString().split('T')[0];
    const endStr   = dateEnd.toISOString().split('T')[0];
    
    // คำนวณ previous period (ช่วงก่อนหน้าที่มีความยาวเท่ากัน)
    const daysDiff = Math.ceil((dateEnd - dateStart) / (1000 * 60 * 60 * 24));
    const prevEnd   = new Date(dateStart);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - daysDiff);
    
    const psStr = prevStart.toISOString().split('T')[0];
    const peStr = prevEnd.toISOString().split('T')[0];

    console.log(`📅 Current: ${startStr} → ${endStr}`);
    console.log(`📅 Previous: ${psStr} → ${peStr}`);

    // ── ดึง sales_data (หลัก) ──
    const [sdCur, sdPrev] = await Promise.all([
      supabaseClient
        .from('sales_data')
        .select('*')
        .gte('report_date', startStr)
        .lte('report_date', endStr),

      supabaseClient
        .from('sales_data')
        .select('sales_code, sales_name, amount_net, profit, profit_percent, qty_net, product_name, product_code, customer_name, customer_code, report_date')
        .gte('report_date', psStr)
        .lte('report_date', peStr),
    ]);

    if (sdCur.error) throw sdCur.error;

    salesData     = sdCur.data  || [];
    prevSalesData = sdPrev.data || [];

    // ── ดึง reports แยก (ไม่ให้ error block ทั้งหน้า) ──
    try {
      const rpCur = await buildReportsQuery(dateStart, dateEnd);
      reportsData = rpCur.data || [];
    } catch (e) {
      console.warn('⚠️ reports query failed (heatmap จะไม่แสดง):', e.message);
      reportsData = [];
    }

    console.log(`✅ sales_data: ${salesData.length} | prev: ${prevSalesData.length} | reports: ${reportsData.length}`);

    // ── Render ทุกส่วน ──
    renderKPIs();
    renderInsightPills();
    renderTargetBars();
    renderLeaderboard();
    renderTopProductsList();
    renderTopProfitProducts();
    renderSlowMovingList();
    renderSalesChart();
    renderCustomerChart();
    renderProductChart();
    renderProfitBySalesChart();
    renderMarginBySalesChart();
    await renderWeeklyTrendChart();
    renderHeatmap();
    
    // ── Daily Section ──
    initDailyProductSection();

    showLoadingState(false);

  } catch (e) {
    console.error('loadDashboard', e);
    showToast('❌ โหลดข้อมูลไม่สำเร็จ: ' + e.message);
    showLoadingState(false);
  }
}

function buildReportsQuery(start, end) {
  let q = supabaseClient
    .from('reports')
    .select('submitted_at, shop_id, sale_id, status')
    .eq('status', 'submitted')
    .gte('submitted_at', start.toISOString())
    .lte('submitted_at', end.toISOString());

  if (currentUser.role === 'manager' && currentUser.team_id) {
    const ids = Object.keys(profilesMap);
    if (ids.length) q = q.in('sale_id', ids);
  }
  return q;
}

// =====================================================
// 📈 KPI CARDS
// =====================================================
function renderKPIs() {
  const totalAmount = salesData.reduce((s, r) => s + (r.amount_net || 0), 0);
  const totalProfit = salesData.reduce((s, r) => s + (r.profit     || 0), 0);
  const totalQty    = salesData.reduce((s, r) => s + (r.qty_net    || 0), 0);
  const prevAmount  = prevSalesData.reduce((s, r) => s + (r.amount_net || 0), 0);
  const prevProfit  = prevSalesData.reduce((s, r) => s + (r.profit     || 0), 0);

  const uniqueSales    = new Set(salesData.map(r => r.sales_code).filter(Boolean));
  const uniqueCustomers = new Set(salesData.map(r => r.customer_code).filter(v => v && v !== 'EMPTY' && v !== ''));
  const uniqueProducts  = new Set(salesData.map(r => r.product_code).filter(Boolean));
  const totalProfiles   = Object.keys(profilesMap).length;

  // เป้าหมาย
  const targetTotal = uniqueSales.size * TARGET_PER_SALES || 1;
  const targetPct   = Math.round(totalAmount / targetTotal * 100);

  // Growth
  const growth = prevAmount > 0
    ? ((totalAmount - prevAmount) / prevAmount * 100).toFixed(1) : null;
  const profitGrowth = prevProfit > 0
    ? ((totalProfit - prevProfit) / prevProfit * 100).toFixed(1) : null;

  // Set KPIs
  setEl('kpiAmount',     fmtNum(totalAmount));
  setEl('kpiTargetPct',  targetPct + '%');
  setEl('kpiTargetSub',  `เป้า: ฿${fmtNum(targetTotal)}`);
  setEl('kpiProfit',     fmtNum(totalProfit));
  setEl('kpiSalesCount', uniqueSales.size.toString());
  setEl('kpiSalesSub',   `จากทั้งหมด ${totalProfiles || '—'} คน`);
  setEl('kpiCustomers',  uniqueCustomers.size > 0 ? uniqueCustomers.size.toLocaleString() : 'ไม่มีข้อมูล');
  setEl('kpiCustomersSub', uniqueCustomers.size > 0 ? `${salesData.length.toLocaleString()} รายการขาย` : 'customer_code เป็น EMPTY');
  setEl('kpiProducts',   uniqueProducts.size.toLocaleString());
  setEl('kpiQtyTotal',   `รวม ${fmtNum(totalQty)} ชิ้น`);

  // Target badge
  setEl('targetBadge', `เป้า ฿${fmtNum(TARGET_PER_SALES)}/คน`);

  // Growth indicators
  setGrowthEl('kpiAmountChange', growth, 'ยอดขาย');
  setGrowthEl('kpiProfitChange', profitGrowth, 'กำไร');
}

function setGrowthEl(id, growth, label) {
  const el = document.getElementById(id);
  if (!el) return;
  if (growth !== null) {
    const up = parseFloat(growth) >= 0;
    el.textContent = (up ? '▲ +' : '▼ ') + growth + '% vs ช่วงก่อน';
    el.className   = 'kpi-change ' + (up ? 'up' : 'down');
  } else {
    el.textContent = 'ไม่มีข้อมูลช่วงก่อน';
    el.className   = 'kpi-change';
  }
}

// =====================================================
// 💡 INSIGHT PILLS
// =====================================================
function renderInsightPills() {
  const salesMap = {}, prodMap = {}, custMap = {};

  for (const r of salesData) {
    const sKey = r.sales_name || r.sales_code || 'ไม่ระบุ';
    const pKey = r.product_name || r.product_code || 'ไม่ระบุ';
    const cKey = r.customer_name && r.customer_name !== 'EMPTY' ? r.customer_name : (r.customer_code && r.customer_code !== 'EMPTY' ? r.customer_code : '');
    salesMap[sKey] = (salesMap[sKey] || 0) + (r.amount_net || 0);
    prodMap[pKey]  = (prodMap[pKey]  || 0) + (r.qty_net    || 0);
    if (cKey) custMap[cKey] = (custMap[cKey] || 0) + (r.amount_net || 0);
  }

  const top = obj => Object.entries(obj).sort((a, b) => b[1] - a[1])[0];
  const topS = top(salesMap);
  const topP = top(prodMap);
  const topC = top(custMap);

  if (topS) setEl('topSale',     topS[0]);
  if (topP) setEl('topProduct',  topP[0]);
  if (topC) setEl('topCustomer', topC[0]);

  // Growth
  const prevAmt = prevSalesData.reduce((s, r) => s + (r.amount_net || 0), 0);
  const curAmt  = salesData.reduce((s, r) => s + (r.amount_net || 0), 0);
  const growth  = prevAmt > 0 ? ((curAmt - prevAmt) / prevAmt * 100).toFixed(1) : null;

  if (growth !== null) {
    const el = document.getElementById('growthRate');
    if (el) {
      el.textContent = (parseFloat(growth) >= 0 ? '+' : '') + growth + '%';
      el.style.color = parseFloat(growth) >= 0 ? 'var(--accent)' : 'var(--accent3)';
    }
  }

  // อัตรากำไรเฉลี่ย
  const totalAmt    = salesData.reduce((s, r) => s + (r.amount_net || 0), 0);
  const totalProfit = salesData.reduce((s, r) => s + (r.profit || 0), 0);
  const avgMargin   = totalAmt > 0 ? (totalProfit / totalAmt * 100).toFixed(1) : 0;
  setEl('avgProfitPct', avgMargin + '%');
}

// =====================================================
// 🎯 TARGET BARS (sales_data)
// =====================================================
function renderTargetBars() {
  const map = {};
  for (const r of salesData) {
    const key = r.sales_code || 'ไม่ระบุ';
    if (!map[key]) map[key] = { name: r.sales_name || key, total: 0 };
    map[key].total += (r.amount_net || 0);
  }

  const sorted = Object.values(map).sort((a, b) => b.total - a.total);
  const el = document.getElementById('targetSection');
  if (!el) return;
  
  if (!sorted.length) {
    el.innerHTML = '<div class="loading-text">ไม่มีข้อมูลในช่วงเวลาที่เลือก</div>';
    return;
  }

  el.innerHTML = sorted.map(({ name, total }) => {
    const pct = Math.min(Math.round(total / TARGET_PER_SALES * 100), 100);
    const cls = pct >= 100 ? '' : pct >= 60 ? 'warning' : 'danger';
    return `
      <div class="target-row">
        <div class="target-name" title="${name}">${name}</div>
        <div class="target-track"><div class="target-fill ${cls}" style="width:${pct}%"></div></div>
        <div class="target-pct">${pct}%</div>
        <div class="target-val">฿${fmtNum(total)}</div>
      </div>`;
  }).join('');
}

// =====================================================
// 🏆 LEADERBOARD (sales_data)
// =====================================================
function renderLeaderboard() {
  const map = {};
  for (const r of salesData) {
    const key = r.sales_code || 'ไม่ระบุ';
    if (!map[key]) map[key] = { name: r.sales_name || key, total: 0, profit: 0 };
    map[key].total  += (r.amount_net || 0);
    map[key].profit += (r.profit || 0);
  }

  const sorted = Object.values(map).sort((a, b) => b.total - a.total).slice(0, 8);
  const el = document.getElementById('leaderboard');
  if (!el) return;
  
  if (!sorted.length) {
    el.innerHTML = '<div class="loading-text">ไม่มีข้อมูลในช่วงเวลาที่เลือก</div>';
    return;
  }

  const medals  = ['🥇','🥈','🥉'];
  const rankCls = ['r1','r2','r3'];
  el.innerHTML = sorted.map(({ name, total, profit }, i) => `
    <div class="lb-row">
      <div class="lb-rank ${rankCls[i] || 'other'}">${i < 3 ? medals[i] : i + 1}</div>
      <div class="lb-name">${name}</div>
      <div class="lb-amount">฿${fmtNum(total)}</div>
    </div>`).join('');
}

// =====================================================
// 📦 TOP PRODUCTS — จำนวน (qty_net)
// =====================================================
function renderTopProductsList() {
  const map = {};
  for (const r of salesData) {
    const key = r.product_name || r.product_code || 'ไม่ระบุ';
    map[key] = (map[key] || 0) + (r.qty_net || 0);
  }

  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const el = document.getElementById('topProductsList');
  if (!el) return;
  
  if (!sorted.length) {
    el.innerHTML = '<div class="loading-text">ไม่มีข้อมูลในช่วงเวลาที่เลือก</div>';
    return;
  }

  const maxVal = sorted[0][1] || 1;
  el.innerHTML = sorted.map(([name, qty], i) => `
    <div class="product-row">
      <div class="product-rank">${i + 1}</div>
      <div class="product-name">${name}</div>
      <div class="product-bar-wrap">
        <div class="product-bar-bg">
          <div class="product-bar-fg" style="width:${Math.round(qty / maxVal * 100)}%"></div>
        </div>
      </div>
      <div class="product-amount">${fmtNum(qty)} ชิ้น</div>
    </div>`).join('');
}

// =====================================================
// 💎 TOP PROFIT PRODUCTS — กำไร (฿)
// =====================================================
function renderTopProfitProducts() {
  const map = {};
  for (const r of salesData) {
    const key = r.product_name || r.product_code || 'ไม่ระบุ';
    if (!map[key]) map[key] = { profit: 0, amount: 0 };
    map[key].profit += (r.profit || 0);
    map[key].amount += (r.amount_net || 0);
  }

  const sorted = Object.entries(map)
    .map(([name, d]) => ({ name, profit: d.profit, margin: d.amount > 0 ? (d.profit / d.amount * 100) : 0 }))
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 8);

  const el = document.getElementById('topProfitProducts');
  if (!el) return;
  
  if (!sorted.length) {
    el.innerHTML = '<div class="loading-text">ไม่มีข้อมูลในช่วงเวลาที่เลือก</div>';
    return;
  }

  const maxVal = sorted[0].profit || 1;
  el.innerHTML = sorted.map((item, i) => `
    <div class="product-row">
      <div class="product-rank">${i + 1}</div>
      <div class="product-name">${item.name}</div>
      <div class="product-bar-wrap">
        <div class="product-bar-bg">
          <div class="product-bar-fg" style="width:${Math.round(item.profit / maxVal * 100)}%; background: linear-gradient(90deg, var(--accent2), #ffd54f);"></div>
        </div>
      </div>
      <div class="product-amount">฿${fmtNum(item.profit)}</div>
    </div>`).join('');
}

// =====================================================
// 🐌 SLOW-MOVING PRODUCTS
// =====================================================
function renderSlowMovingList() {
  const map = {};
  for (const r of salesData) {
    const key = r.product_name || r.product_code || 'ไม่ระบุ';
    if (!map[key]) map[key] = { qty: 0, amount: 0 };
    map[key].qty    += (r.qty_net    || 0);
    map[key].amount += (r.amount_net || 0);
  }

  const sorted = Object.entries(map)
    .map(([name, d]) => ({ name, qty: d.qty, amount: d.amount }))
    .filter(item => item.qty > 0)
    .sort((a, b) => a.qty - b.qty)
    .slice(0, 10);

  const el = document.getElementById('slowMovingList');
  if (!el) return;
  
  if (!sorted.length) {
    el.innerHTML = '<div class="loading-text">ไม่มีข้อมูลในช่วงเวลาที่เลือก</div>';
    return;
  }

  el.innerHTML = sorted.map((item, i) => `
    <div class="product-row">
      <div class="product-rank" style="color: var(--accent3);">${i + 1}</div>
      <div class="product-name">${item.name}</div>
      <div class="product-amount" style="color: var(--accent3);">${item.qty} ชิ้น</div>
      <div class="product-amount">฿${fmtNum(item.amount)}</div>
    </div>`).join('');
}

// =====================================================
// 📊 CHARTS
// =====================================================
function destroyChart(inst) { if (inst) { try { inst.destroy(); } catch (_) {} } }

const CHART_COLORS = [
  '#00d4aa','#f5a623','#e74c8b','#4d9fff','#a855f7',
  '#f97316','#06b6d4','#84cc16','#fbbf24','#ec4899'
];

const chartOpts = {
  responsive: true, maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#7a9cc0', font: { family: 'Kanit', size: 12 } } },
    tooltip: {
      backgroundColor: '#1e2d42', titleColor: '#e8f0fe', bodyColor: '#7a9cc0',
      borderColor: 'rgba(0,212,170,0.3)', borderWidth: 1,
      titleFont: { family: 'Kanit' }, bodyFont: { family: 'Kanit' },
    }
  },
  scales: {
    x: { ticks: { color: '#7a9cc0', font: { family: 'Kanit', size: 11 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
    y: { ticks: { color: '#7a9cc0', font: { family: 'Kanit', size: 11 }, callback: v => fmtNum(v) }, grid: { color: 'rgba(255,255,255,0.04)' } }
  }
};

// Bar: ยอดขายแยกเซลล์
function renderSalesChart() {
  const ctx = document.getElementById('chartSales'); if (!ctx) return;
  destroyChart(chartSalesInst);
  const map = {};
  salesData.forEach(r => {
    const k = r.sales_name || r.sales_code || 'ไม่ระบุ';
    map[k] = (map[k] || 0) + (r.amount_net || 0);
  });
  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
  
  if (!sorted.length) return;
  
  chartSalesInst = new Chart(ctx, {
    type: 'bar',
    data: { labels: sorted.map(([k]) => k),
      datasets: [{ label: 'ยอดขาย (฿)', data: sorted.map(([, v]) => v),
        backgroundColor: CHART_COLORS.slice(0, sorted.length), borderRadius: 6, borderSkipped: false }]
    },
    options: { ...chartOpts, plugins: { ...chartOpts.plugins, legend: { display: false } } }
  });
}

// Doughnut: ยอดขายแยกลูกค้า Top 8
function renderCustomerChart() {
  const ctx = document.getElementById('chartCustomer'); if (!ctx) return;
  destroyChart(chartCustomerInst);
  const map = {};
  salesData.forEach(r => {
    const cName = r.customer_name && r.customer_name !== 'EMPTY' ? r.customer_name : '';
    const cCode = r.customer_code && r.customer_code !== 'EMPTY' ? r.customer_code : '';
    const k = cName || cCode;
    if (k) {
      map[k] = (map[k] || 0) + (r.amount_net || 0);
    }
  });
  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8);

  if (!sorted.length) return;

  chartCustomerInst = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: sorted.map(([k]) => k),
      datasets: [{ data: sorted.map(([, v]) => v),
        backgroundColor: CHART_COLORS, borderColor: '#162032', borderWidth: 2, hoverOffset: 8 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '60%',
      plugins: {
        legend: { position: 'bottom', labels: { color: '#7a9cc0', font: { family: 'Kanit', size: 11 }, padding: 8 } },
        tooltip: chartOpts.plugins.tooltip
      }
    }
  });
}

// Horizontal bar: ยอดรวมแยกสินค้า
function renderProductChart() {
  const ctx = document.getElementById('chartProduct'); if (!ctx) return;
  destroyChart(chartProductInst);
  const map = {};
  salesData.forEach(r => {
    const k = r.product_name || r.product_code || 'ไม่ระบุ';
    map[k] = (map[k] || 0) + (r.amount_net || 0);
  });
  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8);
  
  if (!sorted.length) return;
  
  chartProductInst = new Chart(ctx, {
    type: 'bar',
    data: { labels: sorted.map(([k]) => k),
      datasets: [{ label: 'ยอดรวม (฿)', data: sorted.map(([, v]) => v),
        backgroundColor: 'rgba(168,85,247,0.75)', borderColor: '#a855f7', borderWidth: 1, borderRadius: 6 }]
    },
    options: { ...chartOpts, indexAxis: 'y', plugins: { ...chartOpts.plugins, legend: { display: false } } }
  });
}

// Bar: กำไรแยกเซลล์
function renderProfitBySalesChart() {
  const ctx = document.getElementById('chartProfitBySales'); if (!ctx) return;
  destroyChart(chartProfitBySalesInst);
  const map = {};
  salesData.forEach(r => {
    const k = r.sales_name || r.sales_code || 'ไม่ระบุ';
    map[k] = (map[k] || 0) + (r.profit || 0);
  });
  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
  
  if (!sorted.length) return;
  
  chartProfitBySalesInst = new Chart(ctx, {
    type: 'bar',
    data: { labels: sorted.map(([k]) => k),
      datasets: [{ label: 'กำไร (฿)', data: sorted.map(([, v]) => v),
        backgroundColor: 'rgba(245,166,35,0.75)', borderColor: '#f5a623', borderWidth: 1, borderRadius: 6, borderSkipped: false }]
    },
    options: { ...chartOpts, plugins: { ...chartOpts.plugins, legend: { display: false } } }
  });
}

// Bar: อัตรากำไร % แยกเซลล์
function renderMarginBySalesChart() {
  const ctx = document.getElementById('chartMarginBySales'); if (!ctx) return;
  destroyChart(chartMarginBySalesInst);
  const map = {};
  salesData.forEach(r => {
    const k = r.sales_name || r.sales_code || 'ไม่ระบุ';
    if (!map[k]) map[k] = { amount: 0, profit: 0 };
    map[k].amount += (r.amount_net || 0);
    map[k].profit += (r.profit || 0);
  });
  const sorted = Object.entries(map)
    .map(([name, d]) => [name, d.amount > 0 ? (d.profit / d.amount * 100) : 0])
    .sort((a, b) => b[1] - a[1]);

  if (!sorted.length) return;

  chartMarginBySalesInst = new Chart(ctx, {
    type: 'bar',
    data: { labels: sorted.map(([k]) => k),
      datasets: [{ label: 'อัตรากำไร (%)', data: sorted.map(([, v]) => parseFloat(v.toFixed(1))),
        backgroundColor: sorted.map(([, v]) => v >= 20 ? 'rgba(0,212,170,0.75)' : v >= 10 ? 'rgba(245,166,35,0.75)' : 'rgba(231,76,139,0.75)'),
        borderRadius: 6, borderSkipped: false }]
    },
    options: {
      ...chartOpts,
      plugins: { ...chartOpts.plugins, legend: { display: false } },
      scales: {
        ...chartOpts.scales,
        y: { ...chartOpts.scales.y, ticks: { ...chartOpts.scales.y.ticks, callback: v => v + '%' } }
      }
    }
  });
}

// Line: แนวโน้มยอดขาย (ตามช่วงที่เลือก)
async function renderWeeklyTrendChart() {
  const ctx = document.getElementById('chartWeekly'); if (!ctx) return;
  destroyChart(chartWeeklyInst);

  if (!salesData.length) return;

  try {
    // กลุ่มตามวัน
    const amtTotals = {}, profTotals = {};
    salesData.forEach(r => {
      const key = r.report_date; // YYYY-MM-DD
      amtTotals[key]  = (amtTotals[key]  || 0) + (r.amount_net || 0);
      profTotals[key] = (profTotals[key] || 0) + (r.profit || 0);
    });

    const labels = Object.keys(amtTotals).sort();
    const amtVals  = labels.map(k => amtTotals[k]);
    const profVals = labels.map(k => profTotals[k]);

    const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 240);
    gradient.addColorStop(0, 'rgba(0,212,170,0.3)');
    gradient.addColorStop(1, 'rgba(0,212,170,0)');

    const gradient2 = ctx.getContext('2d').createLinearGradient(0, 0, 0, 240);
    gradient2.addColorStop(0, 'rgba(245,166,35,0.2)');
    gradient2.addColorStop(1, 'rgba(245,166,35,0)');

    setEl('trendBadge', `${labels.length} วัน`);

    chartWeeklyInst = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels.map(k => {
          const d = new Date(k);
          return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
        }),
        datasets: [
          {
            label: 'ยอดขาย (฿)', data: amtVals,
            borderColor: '#00d4aa', backgroundColor: gradient, fill: true, tension: 0.4,
            pointRadius: 5, pointBackgroundColor: '#00d4aa', pointBorderColor: '#0f1923', pointBorderWidth: 2
          },
          {
            label: 'กำไร (฿)', data: profVals,
            borderColor: '#f5a623', backgroundColor: gradient2, fill: true, tension: 0.4,
            pointRadius: 4, pointBackgroundColor: '#f5a623', pointBorderColor: '#0f1923', pointBorderWidth: 2,
            borderDash: [5, 3]
          }
        ]
      },
      options: { ...chartOpts }
    });
  } catch (e) { console.error('weeklyChart', e); }
}

// =====================================================
// 🗓️ HEATMAP (reports — 30 วัน)
// =====================================================
async function renderHeatmap() {
  const wrap = document.getElementById('heatmapWrap'); if (!wrap) return;
  try {
    const d30 = new Date(); d30.setDate(d30.getDate() - 29); d30.setHours(0, 0, 0, 0);
    let q = supabaseClient.from('reports').select('submitted_at')
      .eq('status', 'submitted').gte('submitted_at', d30.toISOString());
    if (currentUser.role === 'manager' && currentUser.team_id) {
      const ids = Object.keys(profilesMap);
      if (ids.length) q = q.in('sale_id', ids);
    }

    const { data, error } = await q;
    if (error) {
      console.warn('⚠️ Heatmap: reports query error:', error.message);
      wrap.innerHTML = '<div class="loading-text">ไม่สามารถโหลด heatmap ได้</div>';
      return;
    }
    const counts = {};
    const today  = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      counts[d.toISOString().split('T')[0]] = 0;
    }
    (data || []).forEach(r => {
      const key = r.submitted_at.split('T')[0];
      if (key in counts) counts[key]++;
    });

    const maxC    = Math.max(...Object.values(counts), 1);
    const dayTH   = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];
    const entries = Object.entries(counts);
    const firstDay = new Date(entries[0][0]);
    const pad      = (firstDay.getDay() + 6) % 7;
    let week = [], weeks = [];
    for (let i = 0; i < pad; i++) week.push(null);
    for (const [date, cnt] of entries) {
      week.push({ date, cnt });
      if (week.length === 7) { weeks.push(week); week = []; }
    }
    if (week.length) weeks.push(week);

    let html = `<table class="heatmap-table"><thead><tr><th></th>`;
    dayTH.forEach(d => html += `<th>${d}</th>`);
    html += `</tr></thead><tbody>`;
    weeks.forEach(w => {
      const first = w.find(x => x);
      const label = first ? new Date(first.date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '';
      html += `<tr><th style="font-size:10px;color:var(--text-muted);padding-right:8px;white-space:nowrap">${label}</th>`;
      for (let d = 0; d < 7; d++) {
        const cell = w[d];
        if (!cell) { html += `<td class="heat-0">—</td>`; continue; }
        const lvl = cell.cnt === 0 ? 0 : cell.cnt <= maxC * 0.25 ? 1 : cell.cnt <= maxC * 0.50 ? 2 : cell.cnt <= maxC * 0.75 ? 3 : 4;
        html += `<td class="heat-${lvl}" title="${cell.date}: ${cell.cnt} รายงาน">${cell.cnt || ''}</td>`;
      }
      html += `</tr>`;
    });
    html += `</tbody></table>`;
    wrap.innerHTML = html;
  } catch (e) {
    console.error('heatmap', e);
    wrap.innerHTML = '<div class="loading-text">โหลดไม่สำเร็จ</div>';
  }
}

// =====================================================
// 📦 DAILY PRODUCT SECTION
// =====================================================
function initDailyProductSection() {
  setupDateDropdown();
  renderDailyProductTable();
  renderDailyProductChart();
}

function setupDateDropdown() {
  const dropdown = document.getElementById('dailyDateSelect');
  if (!dropdown) return;
  
  // รวบรวมวันที่ทั้งหมดจาก salesData
  const dates = [...new Set(salesData.map(r => r.report_date))].sort().reverse();
  
  // สร้าง options
  let html = '<option value="">📅 ทุกวัน (รวม)</option>';
  dates.forEach(date => {
    const d = new Date(date);
    const label = d.toLocaleDateString('th-TH', { 
      weekday: 'short', 
      day: 'numeric', 
      month: 'short', 
      year: '2-digit' 
    });
    html += `<option value="${date}">${label}</option>`;
  });
  
  dropdown.innerHTML = html;
  
  // Event listener
  dropdown.addEventListener('change', () => {
    selectedDate = dropdown.value || null;
    renderDailyProductTable();
    renderDailyProductChart();
    updateDailySummaryInSection();
  });
}

function updateDailySummaryInSection() {
  const filtered = selectedDate 
    ? salesData.filter(r => r.report_date === selectedDate)
    : salesData;
  
  const totalQty = filtered.reduce((s, r) => s + (r.qty_net || 0), 0);
  const totalAmount = filtered.reduce((s, r) => s + (r.amount_net || 0), 0);
  const uniqueProducts = new Set(filtered.map(r => r.product_code).filter(Boolean)).size;
  const uniqueSales = new Set(filtered.map(r => r.sales_code).filter(Boolean)).size;
  
  setEl('dailyTotalQty', fmtNum(totalQty) + ' ชิ้น');
  setEl('dailyTotalAmount', '฿' + fmtNum(totalAmount));
  setEl('dailyProductCount', uniqueProducts + ' รายการ');
  setEl('dailySalesCount', uniqueSales + ' คน');
  
  // Update badge
  const badge = document.getElementById('dailyDateBadge');
  if (badge) {
    if (selectedDate) {
      const d = new Date(selectedDate);
      badge.textContent = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
    } else {
      const days = [...new Set(salesData.map(r => r.report_date))].length;
      badge.textContent = `${days} วัน`;
    }
  }
}

function renderDailyProductTable() {
  const container = document.getElementById('dailyProductTable');
  if (!container) return;
  
  // กรองตามวันที่เลือก
  const filtered = selectedDate 
    ? salesData.filter(r => r.report_date === selectedDate)
    : salesData;
  
  if (!filtered.length) {
    container.innerHTML = '<div class="loading-text">ไม่มีข้อมูลในวันที่เลือก</div>';
    updateDailySummaryInSection();
    return;
  }
  
  // จัดกลุ่มตามวัน
  const byDate = {};
  filtered.forEach(r => {
    const date = r.report_date;
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(r);
  });
  
  // สร้าง HTML
  let html = '';
  const sortedDates = Object.keys(byDate).sort().reverse();
  
  sortedDates.forEach(date => {
    const records = byDate[date];
    const d = new Date(date);
    const dateLabel = d.toLocaleDateString('th-TH', { 
      weekday: 'long', 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    });
    
    // สรุปของวัน
    const dayTotal = records.reduce((s, r) => s + (r.amount_net || 0), 0);
    const dayQty = records.reduce((s, r) => s + (r.qty_net || 0), 0);
    const dayProfit = records.reduce((s, r) => s + (r.profit || 0), 0);
    
    // จัดกลุ่มสินค้า
    const productMap = {};
    records.forEach(r => {
      const pKey = r.product_code || r.product_name || 'ไม่ระบุ';
      if (!productMap[pKey]) {
        productMap[pKey] = {
          name: r.product_name || r.product_code || 'ไม่ระบุ',
          qty: 0,
          amount: 0,
          profit: 0,
          sellers: new Set()
        };
      }
      productMap[pKey].qty += (r.qty_net || 0);
      productMap[pKey].amount += (r.amount_net || 0);
      productMap[pKey].profit += (r.profit || 0);
      if (r.sales_name || r.sales_code) {
        productMap[pKey].sellers.add(r.sales_name || r.sales_code);
      }
    });
    
    const products = Object.values(productMap).sort((a, b) => b.amount - a.amount);
    
    html += `
      <div class="daily-date-group">
        <div class="daily-date-header">
          <div class="daily-date-title">
            <span class="daily-date-icon">📆</span>
            <span>${dateLabel}</span>
          </div>
          <div class="daily-date-summary">
            <span class="daily-stat">📦 ${fmtNum(dayQty)} ชิ้น</span>
            <span class="daily-stat">💰 ฿${fmtNum(dayTotal)}</span>
            <span class="daily-stat">💎 ฿${fmtNum(dayProfit)}</span>
          </div>
        </div>
        
        <div class="daily-table-wrap">
          <table class="daily-table">
            <thead>
              <tr>
                <th>#</th>
                <th>สินค้า</th>
                <th>จำนวน</th>
                <th>ยอดขาย</th>
                <th>เซลล์</th>
              </tr>
            </thead>
            <tbody>
              ${products.map((p, i) => `
                <tr>
                  <td class="rank-col">${i + 1}</td>
                  <td class="product-col">${p.name}</td>
                  <td class="qty-col">${fmtNum(p.qty)} ชิ้น</td>
                  <td class="amount-col">฿${fmtNum(p.amount)}</td>
                  <td class="seller-col">
                    ${[...p.sellers].slice(0, 3).map(s => `<span class="seller-tag">${s}</span>`).join('')}
                    ${p.sellers.size > 3 ? `<span class="seller-more">+${p.sellers.size - 3}</span>` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
  updateDailySummaryInSection();
}

function renderDailyProductChart() {
  const ctx = document.getElementById('chartDailyProducts');
  if (!ctx) return;
  
  if (dailyChartInst) {
    try { dailyChartInst.destroy(); } catch (_) {}
  }
  
  // กรองตามวันที่เลือก
  const filtered = selectedDate 
    ? salesData.filter(r => r.report_date === selectedDate)
    : salesData;
  
  if (!filtered.length) return;
  
  if (selectedDate) {
    // แสดง Bar Chart: สินค้า Top 10 ของวันนั้น
    renderSingleDayChart(ctx, filtered);
  } else {
    // แสดง Stacked Bar: ยอดขายแต่ละวัน แยกตามสินค้า Top 5
    renderMultiDayChart(ctx, filtered);
  }
}

function renderSingleDayChart(ctx, data) {
  // รวมยอดตามสินค้า
  const productMap = {};
  data.forEach(r => {
    const name = r.product_name || r.product_code || 'ไม่ระบุ';
    if (!productMap[name]) productMap[name] = { qty: 0, amount: 0 };
    productMap[name].qty += (r.qty_net || 0);
    productMap[name].amount += (r.amount_net || 0);
  });
  
  const sorted = Object.entries(productMap)
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, 10);
  
  dailyChartInst = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(([name]) => name.length > 20 ? name.slice(0, 20) + '...' : name),
      datasets: [
        {
          label: 'ยอดขาย (฿)',
          data: sorted.map(([, d]) => d.amount),
          backgroundColor: 'rgba(0,212,170,0.7)',
          borderColor: '#00d4aa',
          borderWidth: 1,
          borderRadius: 6,
          yAxisID: 'y'
        },
        {
          label: 'จำนวน (ชิ้น)',
          data: sorted.map(([, d]) => d.qty),
          backgroundColor: 'rgba(77,159,255,0.7)',
          borderColor: '#4d9fff',
          borderWidth: 1,
          borderRadius: 6,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { 
          position: 'top',
          labels: { color: '#7a9cc0', font: { family: 'Kanit', size: 11 } }
        },
        tooltip: {
          backgroundColor: '#1e2d42',
          titleColor: '#e8f0fe',
          bodyColor: '#7a9cc0',
          borderColor: 'rgba(0,212,170,0.3)',
          borderWidth: 1,
          titleFont: { family: 'Kanit' },
          bodyFont: { family: 'Kanit' }
        }
      },
      scales: {
        x: { 
          ticks: { color: '#7a9cc0', font: { family: 'Kanit', size: 10 }, maxRotation: 45 },
          grid: { color: 'rgba(255,255,255,0.04)' }
        },
        y: {
          type: 'linear',
          position: 'left',
          ticks: { color: '#00d4aa', font: { family: 'Kanit', size: 10 }, callback: v => '฿' + fmtNum(v) },
          grid: { color: 'rgba(255,255,255,0.04)' }
        },
        y1: {
          type: 'linear',
          position: 'right',
          ticks: { color: '#4d9fff', font: { family: 'Kanit', size: 10 } },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

function renderMultiDayChart(ctx, data) {
  // หาสินค้า Top 5 โดยรวม
  const totalByProduct = {};
  data.forEach(r => {
    const name = r.product_name || r.product_code || 'ไม่ระบุ';
    totalByProduct[name] = (totalByProduct[name] || 0) + (r.amount_net || 0);
  });
  const top5Products = Object.entries(totalByProduct)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);
  
  // จัดกลุ่มตามวัน
  const dates = [...new Set(data.map(r => r.report_date))].sort();
  const datasets = [];
  
  const colors = [
    { bg: 'rgba(0,212,170,0.7)', border: '#00d4aa' },
    { bg: 'rgba(245,166,35,0.7)', border: '#f5a623' },
    { bg: 'rgba(77,159,255,0.7)', border: '#4d9fff' },
    { bg: 'rgba(168,85,247,0.7)', border: '#a855f7' },
    { bg: 'rgba(231,76,139,0.7)', border: '#e74c8b' }
  ];
  
  top5Products.forEach((product, i) => {
    const amounts = dates.map(date => {
      const dayData = data.filter(r => r.report_date === date);
      return dayData
        .filter(r => (r.product_name || r.product_code) === product)
        .reduce((s, r) => s + (r.amount_net || 0), 0);
    });
    
    datasets.push({
      label: product.length > 15 ? product.slice(0, 15) + '...' : product,
      data: amounts,
      backgroundColor: colors[i].bg,
      borderColor: colors[i].border,
      borderWidth: 1,
      borderRadius: 4
    });
  });
  
  // เพิ่ม "อื่นๆ"
  const otherAmounts = dates.map(date => {
    const dayData = data.filter(r => r.report_date === date);
    return dayData
      .filter(r => !top5Products.includes(r.product_name || r.product_code))
      .reduce((s, r) => s + (r.amount_net || 0), 0);
  });
  
  if (otherAmounts.some(v => v > 0)) {
    datasets.push({
      label: 'อื่นๆ',
      data: otherAmounts,
      backgroundColor: 'rgba(120,140,160,0.5)',
      borderColor: '#788ca0',
      borderWidth: 1,
      borderRadius: 4
    });
  }
  
  dailyChartInst = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: dates.map(d => {
        const dt = new Date(d);
        return dt.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
      }),
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { 
          position: 'top',
          labels: { color: '#7a9cc0', font: { family: 'Kanit', size: 10 }, boxWidth: 12 }
        },
        tooltip: {
          backgroundColor: '#1e2d42',
          titleColor: '#e8f0fe',
          bodyColor: '#7a9cc0',
          borderColor: 'rgba(0,212,170,0.3)',
          borderWidth: 1,
          titleFont: { family: 'Kanit' },
          bodyFont: { family: 'Kanit' },
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ฿${fmtNum(ctx.raw)}`
          }
        }
      },
      scales: {
        x: { 
          stacked: true,
          ticks: { color: '#7a9cc0', font: { family: 'Kanit', size: 10 } },
          grid: { color: 'rgba(255,255,255,0.04)' }
        },
        y: {
          stacked: true,
          ticks: { color: '#7a9cc0', font: { family: 'Kanit', size: 10 }, callback: v => '฿' + fmtNum(v) },
          grid: { color: 'rgba(255,255,255,0.04)' }
        }
      }
    }
  });
}

// =====================================================
// HELPERS
// =====================================================
function fmtNum(n) {
  if (!n && n !== 0) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString('th-TH');
}

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function showToast(msg) {
  const t = document.getElementById('toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function showLoadingState(loading) {
  ['kpiAmount','kpiTargetPct','kpiProfit','kpiSalesCount','kpiCustomers','kpiProducts'].forEach(id => {
    const el = document.getElementById(id);
    if (el && loading) el.textContent = '...';
  });
}

function setupLogout() {
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    window.location.href = '/pages/auth/login.html';
  });
}