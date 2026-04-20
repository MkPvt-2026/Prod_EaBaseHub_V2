// =====================================================
// reportTracker.js v4 — Group by Shop Visit
// 1 รายการ = 1 ร้านค้า (รวมสินค้าทั้งหมด)
// =====================================================

'use strict';

let localUser = null;

let allReports = [];        // raw rows from DB
let groupedReports = [];    // grouped by shop visit
let filteredGroups = [];    // after filter
let profilesMap = {};
let shopsMap = {};
let productsMap = {};
let commentCountsMap = {};

let dateStart = null;
let dateEnd = null;

let currentPage = 1;
const PAGE_SIZE = 20;

let activeSalesFilter = null;
let currentReportId = null;
let currentGroupKey = null;   // key ของกลุ่มที่เปิด modal อยู่
let currentGroupRows = [];    // report rows ของกลุ่มที่เปิด modal

// =====================================================
// 🔧 HELPER: รอ Supabase Client พร้อม
// =====================================================
function waitForSupabase(maxAttempts = 50) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      if (typeof supabaseClient !== 'undefined' && supabaseClient?.auth) {
        resolve(supabaseClient);
      } else if (attempts < maxAttempts) {
        setTimeout(check, 100);
      } else {
        reject(new Error('supabaseClient ไม่พร้อมหลังจากรอนานเกินไป'));
      }
    };
    check();
  });
}

// =====================================================
// 🚀 INIT
// =====================================================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 Report Manager initializing...');

  try {
    await waitForSupabase();

    const session = await getSessionSafely();
    if (!session) {
      showLoginRequired();
      return;
    }

    if (typeof protectPage === 'function') {
      try { await protectPage(['admin', 'executive', 'manager']); }
      catch (e) { console.warn('⚠️ protectPage failed:', e.message); }
    }

    localUser = await loadCurrentUser(session);
    if (!localUser) {
      showLoginRequired();
      return;
    }

    updateHeaderUI();
    initDateRange();
    setupDateControls();

    await Promise.all([loadProfiles(), loadShops(), loadProducts()]);
    await loadReports();

    setupEventListeners();
    setupLogout();

    console.log('✅ Report Manager ready');
  } catch (e) {
    console.error('❌ Init error:', e);
    showErrorState(e.message);
  }
});

// =====================================================
// 🔐 GET SESSION SAFELY
// =====================================================
async function getSessionSafely() {
  try {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error) {
      try {
        const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
        if (user && !userError) return { user };
      } catch (e) { /* ignore */ }
      return null;
    }
    return session;
  } catch (e) {
    console.error('❌ getSessionSafely error:', e);
    return null;
  }
}

// =====================================================
// 👤 LOAD CURRENT USER
// =====================================================
async function loadCurrentUser(session) {
  try {
    if (window.currentUser && window.currentUser.id) {
      return {
        id: window.currentUser.id,
        role: window.currentUser.role,
        area: window.currentUser.area,
        name: window.currentUser.display_name || window.currentUser.username || window.currentUser.email || 'Manager'
      };
    }

    const userId = session?.user?.id;
    if (!userId) return null;

    const { data: profile, error } = await supabaseClient
      .from('profiles')
      .select('id, display_name, role, area')
      .eq('id', userId)
      .single();

    if (error) {
      return { id: userId, role: 'user', area: null, name: session.user.email || 'User' };
    }

    return {
      id: profile.id,
      role: profile.role,
      area: profile.area,
      name: profile.display_name || session.user.email || 'User'
    };
  } catch (e) {
    console.error('❌ loadCurrentUser error:', e);
    return null;
  }
}

// =====================================================
// 🎨 UPDATE HEADER UI
// =====================================================
function updateHeaderUI() {
  const nameEl = document.getElementById('userName');
  if (nameEl && localUser?.name) nameEl.textContent = localUser.name;

  const avatarEl = document.getElementById('userAvatar');
  if (avatarEl && localUser?.name) avatarEl.textContent = localUser.name.charAt(0).toUpperCase();
}

// =====================================================
// ⚠️ UI STATES
// =====================================================
function showLoginRequired() {
  const container = document.getElementById('reportsContainer');
  if (container) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔐</div>
        <h3>กรุณาเข้าสู่ระบบ</h3>
        <p>คุณต้องเข้าสู่ระบบก่อนเพื่อดูรายงาน</p>
        <a href="/pages/auth/login.html" class="btn btn-primary" style="margin-top:1rem;">เข้าสู่ระบบ</a>
      </div>`;
  }
  const salesGrid = document.getElementById('salesGrid');
  if (salesGrid) salesGrid.innerHTML = '';
  ['totalReports', 'unreadReports', 'readReports', 'activeSales'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '—';
  });
}

function showErrorState(message) {
  const container = document.getElementById('reportsContainer');
  if (container) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <h3>เกิดข้อผิดพลาด</h3>
        <p>${message}</p>
        <button onclick="location.reload()" class="btn btn-primary" style="margin-top:1rem;">ลองใหม่อีกครั้ง</button>
      </div>`;
  }
}

// =====================================================
// 📅 DATE RANGE CONTROLS
// =====================================================
function initDateRange() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const monday = new Date(today);
  monday.setDate(today.getDate() + diff);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  dateStart = monday;
  dateEnd = sunday;

  const startInput = document.getElementById('dateStart');
  const endInput = document.getElementById('dateEnd');
  if (startInput) startInput.value = formatDateForInput(dateStart);
  if (endInput) endInput.value = formatDateForInput(dateEnd);

  updateDateRangeLabel();
}

function setupDateControls() {
  const startInput = document.getElementById('dateStart');
  const endInput = document.getElementById('dateEnd');

  if (startInput) {
    startInput.addEventListener('change', () => {
      dateStart = new Date(startInput.value);
      dateStart.setHours(0, 0, 0, 0);
      updateDateRangeLabel();
      clearQuickRangeActive();
      loadReports();
    });
  }

  if (endInput) {
    endInput.addEventListener('change', () => {
      dateEnd = new Date(endInput.value);
      dateEnd.setHours(23, 59, 59, 999);
      updateDateRangeLabel();
      clearQuickRangeActive();
      loadReports();
    });
  }

  document.querySelectorAll('.quick-range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setQuickRange(btn.dataset.range);
      document.querySelectorAll('.quick-range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

function clearQuickRangeActive() {
  document.querySelectorAll('.quick-range-btn').forEach(b => b.classList.remove('active'));
}

function setQuickRange(range) {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  let start = new Date();
  start.setHours(0, 0, 0, 0);
  let end = new Date(today);

  switch (range) {
    case 'today': break;
    case '7days': start.setDate(start.getDate() - 6); break;
    case '30days': start.setDate(start.getDate() - 29); break;
    case 'thisWeek': {
      const d = start.getDay();
      start.setDate(start.getDate() + (d === 0 ? -6 : 1 - d));
      break;
    }
    case 'lastWeek': {
      const d = start.getDay();
      start.setDate(start.getDate() + (d === 0 ? -6 : 1 - d) - 7);
      end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      break;
    }
    case 'thisMonth':
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      break;
    case 'lastMonth':
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      end = new Date(today.getFullYear(), today.getMonth(), 0);
      end.setHours(23, 59, 59, 999);
      break;
    default: {
      const dd = start.getDay();
      start.setDate(start.getDate() + (dd === 0 ? -6 : 1 - dd));
    }
  }

  dateStart = start;
  dateEnd = end;

  const startInput = document.getElementById('dateStart');
  const endInput = document.getElementById('dateEnd');
  if (startInput) startInput.value = formatDateForInput(dateStart);
  if (endInput) endInput.value = formatDateForInput(dateEnd);

  updateDateRangeLabel();
  loadReports();
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
// 👥 LOAD PROFILES
// =====================================================
async function loadProfiles() {
  try {
    // โหลดทุก role ที่เป็น sales/user + manager
    const { data: salesData } = await supabaseClient
      .from('profiles')
      .select('id, display_name, role, area')
      .in('role', ['sales', 'user']);

    const { data: mgrData } = await supabaseClient
      .from('profiles')
      .select('id, display_name, role, area')
      .in('role', ['manager']);

    // รวม profiles ทั้งหมดเพื่อ lookup
    const allProfiles = [...(salesData || []), ...(mgrData || [])];
    profilesMap = Object.fromEntries(allProfiles.map(p => [p.id, p]));

    // Sales dropdown
    const selectSales = document.getElementById('filterSales');
    if (selectSales) {
      selectSales.innerHTML = '<option value="">— ทั้งหมด —</option>';
      (salesData || []).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.display_name || p.id;
        selectSales.appendChild(opt);
      });
    }

    // Manager dropdown
    const selectMgr = document.getElementById('filterManager');
    if (selectMgr) {
      selectMgr.innerHTML = '<option value="">— ทั้งหมด —</option>';
      (mgrData || []).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.display_name || p.id;
        selectMgr.appendChild(opt);
      });
    }
  } catch (e) {
    console.error('❌ loadProfiles error:', e);
  }
}

// =====================================================
// 🏪 LOAD SHOPS
// =====================================================
async function loadShops() {
  try {
    const { data, error } = await supabaseClient
      .from('shops')
      .select('id, shop_name, province')
      .order('shop_name');
    if (error) throw error;
    shopsMap = Object.fromEntries((data || []).map(s => [s.id, {
      name: s.shop_name,
      province: s.province || '—'
    }]));
  } catch (e) {
    console.error('❌ loadShops error:', e);
  }
}

// =====================================================
// 📦 LOAD PRODUCTS
// =====================================================
async function loadProducts() {
  try {
    const { data, error } = await supabaseClient
      .from('products')
      .select('id, name');
    if (error) throw error;
    if (data) data.forEach(p => { productsMap[p.id] = p.name; });
  } catch (e) {
    console.error('❌ loadProducts error:', e);
  }
}

// =====================================================
// 💬 LOAD COMMENT COUNTS
// =====================================================
async function loadCommentCounts(reportIds) {
  commentCountsMap = {};
  if (!reportIds || !reportIds.length) return;
  try {
    const { data, error } = await supabaseClient
      .from('report_comments')
      .select('report_id')
      .in('report_id', reportIds);
    if (error) throw error;
    (data || []).forEach(c => {
      commentCountsMap[c.report_id] = (commentCountsMap[c.report_id] || 0) + 1;
    });
  } catch (e) {
    console.error('❌ loadCommentCounts error:', e);
  }
}

// =====================================================
// 🔗 GROUP REPORTS — รวมร้านเดียวกัน/วันเดียวกัน/เซลล์เดียวกัน
// =====================================================
function makeGroupKey(r) {
  const dateKey = r.report_date || (r.submitted_at ? r.submitted_at.split('T')[0] : 'no-date');
  return `${r.sale_id}__${r.shop_id}__${dateKey}`;
}

function groupReportRows(reports) {
  const map = new Map();

  for (const r of reports) {
    const key = makeGroupKey(r);

    if (!map.has(key)) {
      map.set(key, {
        key,
        sale_id: r.sale_id,
        shop_id: r.shop_id,
        report_date: r.report_date,
        submitted_at: r.submitted_at,
        created_at: r.created_at,
        status_visit: r.status_visit,
        note: r.note,
        product_interest: r.product_interest,
        source: r.source,
        // ใช้ manager_acknowledged จาก row แรก — จะ update จาก all rows ข้างล่าง
        manager_acknowledged: r.manager_acknowledged,
        // สะสม products
        products: [],
        // เก็บ report ids ทั้งหมด
        reportIds: []
      });
    }

    const group = map.get(key);
    group.reportIds.push(r.id);

    // ถ้ามี product_id ให้เก็บ
    if (r.product_id) {
      group.products.push({
        product_id: r.product_id,
        attributes: r.attributes || {},
        quantity: r.quantity
      });
    }

    // ถ้า note ยังว่างแต่ row นี้มี ให้เอามา
    if (!group.note && r.note) group.note = r.note;
    if (!group.product_interest && r.product_interest) group.product_interest = r.product_interest;
    if (!group.status_visit && r.status_visit) group.status_visit = r.status_visit;

    // manager_acknowledged: ถ้ามี row ไหนยังไม่อ่าน → group ยังไม่อ่าน
    if (!r.manager_acknowledged) {
      group.manager_acknowledged = false;
    }
  }

  // เรียงลำดับ: ล่าสุดก่อน
  return [...map.values()].sort((a, b) => {
    const da = new Date(a.submitted_at || a.report_date || a.created_at || 0);
    const db = new Date(b.submitted_at || b.report_date || b.created_at || 0);
    return db - da;
  });
}

// =====================================================
// 💬 COUNT COMMENTS PER GROUP
// =====================================================
function getGroupCommentCount(group) {
  let total = 0;
  for (const rid of group.reportIds) {
    total += (commentCountsMap[rid] || 0);
  }
  return total;
}

// =====================================================
// 📊 LOAD REPORTS
// =====================================================
async function loadReports() {
  const container = document.getElementById('reportsContainer');
  if (container) container.innerHTML = '<div class="loading">กำลังโหลดรายงาน...</div>';

  try {
    let query = supabaseClient
      .from('reports')
      .select('*')
      .order('submitted_at', { ascending: false, nullsLast: true })
      .order('report_date', { ascending: false, nullsLast: true });

    const { data, error } = await query;
    if (error) throw error;

    // Filter วันที่
    const startTime = dateStart.getTime();
    const endTime = dateEnd.getTime();

    allReports = (data || []).filter(r => {
      const date = r.submitted_at || r.report_date || r.created_at;
      if (!date) return false;
      const t = new Date(date).getTime();
      return t >= startTime && t <= endTime;
    });

    // โหลด comment counts
    await loadCommentCounts(allReports.map(r => r.id));

    // 🔗 Group by shop visit
    groupedReports = groupReportRows(allReports);
    filteredGroups = [...groupedReports];
    activeSalesFilter = null;

    updateSummaryCards();
    updateManagerGrid();
    updateSalesGrid();
    currentPage = 1;
    renderReports();

    console.log(`✅ Loaded ${allReports.length} rows → ${groupedReports.length} shop visits`);
  } catch (e) {
    console.error('❌ loadReports error:', e);
    if (container) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <h3>เกิดข้อผิดพลาด</h3>
          <p>${e.message}</p>
          <button onclick="loadReports()" class="btn btn-primary" style="margin-top:1rem;">ลองใหม่</button>
        </div>`;
    }
  }
}

// =====================================================
// 📈 UPDATE SUMMARY CARDS
// =====================================================
function updateSummaryCards() {
  const total = groupedReports.length;
  const unread = groupedReports.filter(g => !g.manager_acknowledged).length;
  const read = groupedReports.filter(g => g.manager_acknowledged).length;
  const commented = groupedReports.filter(g => getGroupCommentCount(g) > 0).length;

  const el = id => document.getElementById(id);
  if (el('totalReports'))     el('totalReports').textContent = total;
  if (el('unreadReports'))    el('unreadReports').textContent = unread;
  if (el('readReports'))      el('readReports').textContent = read;
  if (el('commentedReports')) el('commentedReports').textContent = commented;
}

// =====================================================
// 👔 UPDATE MANAGER GRID
// =====================================================
function updateManagerGrid() {
  const grid = document.getElementById('managerGrid');
  if (!grid) return;

  // หา managers จาก profilesMap
  const managers = Object.entries(profilesMap).filter(([, p]) => p.role === 'manager');

  if (!managers.length) {
    grid.innerHTML = '<div class="empty-state"><p>ไม่มีข้อมูลผู้จัดการ</p></div>';
    return;
  }

  // TODO: ถ้ามี manager_id ใน reports ให้ใช้ แต่ตอนนี้แสดงเป็น card เปล่าก่อน
  grid.innerHTML = managers.map(([id, profile]) => {
    const displayName = profile.display_name || '—';
    return `
      <div class="sales-card" onclick="filterByManager('${id}')">
        <div class="sales-avatar">${displayName.charAt(0).toUpperCase()}</div>
        <div class="sales-name">${escapeHtml(displayName)}</div>
        <div class="sales-stats">
          <div class="stat-item">
            <span class="stat-label">👔 ผู้จัดการ</span>
          </div>
        </div>
      </div>`;
  }).join('');
}

// =====================================================
// 👥 UPDATE SALES GRID
// =====================================================
function updateSalesGrid() {
  const grid = document.getElementById('salesGrid');
  if (!grid) return;

  const salesEntries = Object.entries(profilesMap).filter(([, p]) => p.role === 'sales' || p.role === 'user');

  if (!salesEntries.length) {
    grid.innerHTML = '<div class="empty-state"><p>ไม่มีข้อมูลเซลล์</p></div>';
    return;
  }

  grid.innerHTML = salesEntries.map(([id, profile]) => {
    const groups = groupedReports.filter(g => g.sale_id === id);
    const total = groups.length;
    const unread = groups.filter(g => !g.manager_acknowledged).length;
    const isActive = activeSalesFilter === id;
    const displayName = profile.display_name || '—';

    return `
      <div class="sales-card ${isActive ? 'active' : ''} ${unread > 0 ? 'has-unread' : ''}"
           onclick="filterBySale('${id}')">
        <div class="sales-avatar">${displayName.charAt(0).toUpperCase()}</div>
        <div class="sales-name">${escapeHtml(displayName)}</div>
        <div class="sales-stats">
          <div class="stat-item">
            <span class="stat-value">${total}</span>
            <span class="stat-label">ร้านค้า</span>
          </div>
          <div class="stat-item">
            <span class="stat-value" style="color:${unread > 0 ? 'var(--danger)' : 'var(--info)'}">
              ${unread}
            </span>
            <span class="stat-label">ยังไม่อ่าน</span>
          </div>
        </div>
      </div>`;
  }).join('');
}

// =====================================================
// 🔍 FILTERS
// =====================================================
function filterBySale(saleId) {
  if (activeSalesFilter === saleId) {
    activeSalesFilter = null;
    document.getElementById('filterSales').value = '';
  } else {
    activeSalesFilter = saleId;
    document.getElementById('filterSales').value = saleId;
  }
  updateSalesGrid();
  applyFilter();
}

function filterByManager(mgrId) {
  const select = document.getElementById('filterManager');
  if (select) select.value = mgrId;
  applyFilter();
}

function applyFilter() {
  const salesId = document.getElementById('filterSales')?.value || '';
  const mgrId = document.getElementById('filterManager')?.value || '';
  const status = document.getElementById('filterStatus')?.value || '';
  const search = (document.getElementById('searchInput')?.value || '').toLowerCase();

  filteredGroups = groupedReports.filter(g => {
    if (salesId && g.sale_id !== salesId) return false;

    // Filter สถานะ
    if (status === 'unread' && g.manager_acknowledged) return false;
    if (status === 'read' && !g.manager_acknowledged) return false;
    if (status === 'commented' && getGroupCommentCount(g) === 0) return false;

    // Search
    if (search) {
      const shopData = shopsMap[g.shop_id];
      const shopName = shopData?.name || '';
      const province = shopData?.province || '';
      const salesName = profilesMap[g.sale_id]?.display_name || '';
      const note = g.note || '';
      const productNames = g.products.map(p => productsMap[p.product_id] || '').join(' ');
      const productInterest = g.product_interest || '';

      const searchText = [shopName, province, salesName, note, productNames, productInterest].join(' ').toLowerCase();
      if (!searchText.includes(search)) return false;
    }

    return true;
  });

  currentPage = 1;
  renderReports();
}

function resetFilter() {
  ['filterSales', 'filterManager', 'filterStatus'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';

  activeSalesFilter = null;
  filteredGroups = [...groupedReports];
  currentPage = 1;

  updateSalesGrid();
  renderReports();
}

// =====================================================
// 🎨 RENDER REPORTS — grouped
// =====================================================
function renderReports() {
  const container = document.getElementById('reportsContainer');
  if (!container) return;

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageGroups = filteredGroups.slice(start, start + PAGE_SIZE);

  const countEl = document.getElementById('reportCount');
  if (countEl) {
    countEl.textContent = filteredGroups.length !== groupedReports.length
      ? `(${filteredGroups.length} / ${groupedReports.length} ร้านค้า)`
      : `(${groupedReports.length} ร้านค้า)`;
  }

  if (!pageGroups.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <h3>ไม่พบรายงาน</h3>
        <p>ไม่มีรายงานในช่วงเวลาที่เลือก</p>
      </div>`;
    renderPagination();
    return;
  }

  container.innerHTML = pageGroups.map(g => {
    const profile = profilesMap[g.sale_id];
    const salesName = profile?.display_name || '—';
    const shopData = shopsMap[g.shop_id];
    const shopName = shopData?.name || '—';
    const province = shopData?.province || '';
    const isUnread = !g.manager_acknowledged;

    // สรุปสินค้า
    const productCount = g.products.length;
    let productSummary = '—';
    if (productCount === 1) {
      productSummary = productsMap[g.products[0].product_id] || '—';
    } else if (productCount > 1) {
      const firstName = productsMap[g.products[0].product_id] || '—';
      productSummary = `${firstName} +${productCount - 1} รายการ`;
    } else if (productCount === 0) {
      productSummary = 'ไม่มีสินค้า';
    }

    // Comment badge
    const commentCount = getGroupCommentCount(g);
    const commentBadge = commentCount > 0
      ? `<span class="badge-comment" title="${commentCount} ความคิดเห็น">💬 ${commentCount}</span>`
      : '';

    // Status visit badge
    const visitBadge = g.status_visit
      ? `<span class="badge-visit">${escapeHtml(g.status_visit)}</span>`
      : '';

    return `
      <div class="report-item ${isUnread ? 'unread' : ''}"
           onclick="openGroupModal('${g.key}')">
        <div class="report-icon">${salesName.charAt(0).toUpperCase()}</div>
        <div class="report-info">
          <div class="report-header">
            <span class="report-sales">${escapeHtml(salesName)}</span>
            <span class="report-date">${formatDate(g.report_date || g.submitted_at)}</span>
          </div>
          <div class="report-details">
            <div class="report-detail-item">
              🏪 ${escapeHtml(shopName)}${province ? ` <span style="color:#999;font-size:11px;">(${escapeHtml(province)})</span>` : ''}
            </div>
            <div class="report-detail-item">
              📦 ${escapeHtml(productSummary)}
            </div>
          </div>
        </div>
        <div class="report-status">
          ${visitBadge}
          ${commentBadge}
          <span class="badge ${isUnread ? 'badge-unread' : 'badge-read'}">
            ${isUnread ? '🕐 ยังไม่อ่าน' : '✅ อ่านแล้ว'}
          </span>
        </div>
      </div>`;
  }).join('');

  renderPagination();
}

// =====================================================
// 📄 PAGINATION
// =====================================================
function renderPagination() {
  const el = document.getElementById('pagination');
  if (!el) return;

  const totalPages = Math.ceil(filteredGroups.length / PAGE_SIZE);
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  let html = '';
  if (currentPage > 1) html += `<button class="page-btn" onclick="goToPage(${currentPage - 1})">‹</button>`;

  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
      html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
    } else if (i === currentPage - 3 || i === currentPage + 3) {
      html += '<span class="page-dots">...</span>';
    }
  }

  if (currentPage < totalPages) html += `<button class="page-btn" onclick="goToPage(${currentPage + 1})">›</button>`;
  el.innerHTML = html;
}

function goToPage(page) {
  currentPage = page;
  renderReports();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// =====================================================
// 📋 OPEN GROUP MODAL — แสดงสินค้าทั้งหมดของ visit นั้น
// =====================================================
async function openGroupModal(groupKey) {
  const group = groupedReports.find(g => g.key === groupKey);
  if (!group) {
    showToast('❌ ไม่พบรายงาน');
    return;
  }

  currentGroupKey = groupKey;
  currentGroupRows = allReports.filter(r => group.reportIds.includes(r.id));
  // ยังเก็บ currentReportId สำหรับ comment (ใช้ id แรกของกลุ่ม)
  currentReportId = group.reportIds[0];

  const profile = profilesMap[group.sale_id];
  const salesName = profile?.display_name || '—';
  const shopData = shopsMap[group.shop_id];

  // Modal title
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.textContent = `รายงานของ ${salesName}`;

  // Status badge
  const statusBadge = document.getElementById('modalStatus');
  if (statusBadge) {
    statusBadge.className = `badge ${group.manager_acknowledged ? 'badge-read' : 'badge-unread'}`;
    statusBadge.textContent = group.manager_acknowledged ? '✅ อ่านแล้ว' : '🕐 ยังไม่อ่าน';
  }

  // Fill fields
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val || '—';
  };

  set('mReportDate', formatDate(group.report_date || group.submitted_at));
  set('mSalesName', salesName);
  set('mShopName', shopData?.name || '—');
  set('mProvince', shopData?.province || '—');
  set('mSource', group.source || '—');
  set('mNote', group.note || 'ไม่มีหมายเหตุ');

  // 📦 สินค้า — แสดงรายการทั้งหมด
  const productEl = document.getElementById('mProduct');
  if (productEl) {
    if (group.products.length === 0) {
      productEl.innerHTML = '<span style="color:#999;">ไม่มีสินค้า</span>';
    } else {
      productEl.innerHTML = group.products.map(p => {
        const name = productsMap[p.product_id] || '—';
        const attrParts = [];
        if (p.attributes && Object.keys(p.attributes).length) {
          // แสดง attribute values แบบ inline
          Object.values(p.attributes).forEach(v => { if (v) attrParts.push(v); });
        }
        const attrText = attrParts.length ? ` <span style="color:#888;font-size:12px;">(${escapeHtml(attrParts.join(', '))})</span>` : '';
        return `<div style="padding:2px 0;">• ${escapeHtml(name)}${attrText}</div>`;
      }).join('');
    }
  }

  // Quantity — ซ่อนถ้าไม่มี
  const qtyEl = document.getElementById('mQty');
  if (qtyEl) {
    const totalQty = group.products.reduce((sum, p) => sum + (p.quantity || 0), 0);
    if (totalQty > 0) {
      qtyEl.textContent = totalQty.toLocaleString('th-TH') + ' ชิ้น';
      const row = qtyEl.closest('.info-item');
      if (row) row.style.display = '';
    } else {
      const row = qtyEl.closest('.info-item');
      if (row) row.style.display = 'none';
    }
  }

  // โหลด comments (จาก report id แรก — ถ้า comment ผูกกับ report_id ตัวใดตัวหนึ่ง)
  await loadCommentsForGroup(group.reportIds);

  const commentInput = document.getElementById('commentInput');
  if (commentInput) commentInput.value = '';

  const modal = document.getElementById('reportModal');
  if (modal) {
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
}

// =====================================================
// 💬 LOAD COMMENTS FOR GROUP — รวม comments จากทุก report id ในกลุ่ม
// =====================================================
async function loadCommentsForGroup(reportIds) {
  const container = document.getElementById('commentsHistory');
  if (!container) return;

  try {
    const { data, error } = await supabaseClient
      .from('report_comments')
      .select('comment, created_at, report_id, profiles(display_name, role)')
      .in('report_id', reportIds)
      .order('created_at', { ascending: true });

    if (error) throw error;

    if (!data || data.length === 0) {
      container.innerHTML = '<div class="no-comments">ยังไม่มีความคิดเห็น</div>';
      return;
    }

    // Deduplicate (ถ้ามี comment เดียวกันจากหลาย report id)
    const seen = new Set();
    const unique = data.filter(c => {
      const key = `${c.created_at}__${c.comment}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    container.innerHTML = unique.map(c => {
      const role = c.profiles?.role || 'manager';
      const displayName = c.profiles?.display_name || 'ผู้ใช้';

      let roleBadge = '', roleClass = '';
      if (role === 'admin') {
        roleBadge = '👑 ผู้บริหาร'; roleClass = 'comment-admin';
      } else if (role === 'manager') {
        roleBadge = '👔 ผู้จัดการ'; roleClass = 'comment-manager';
      } else {
        roleBadge = '👤 ' + role; roleClass = 'comment-user';
      }

      return `
        <div class="comment-item ${roleClass}">
          <div class="comment-meta">
            <span class="comment-author">${escapeHtml(displayName)}</span>
            <span class="comment-role-badge ${roleClass}">${roleBadge}</span>
            <span class="comment-date">${formatDateTime(c.created_at)}</span>
          </div>
          <div class="comment-text">${escapeHtml(c.comment)}</div>
        </div>`;
    }).join('');
  } catch (e) {
    console.error('❌ loadCommentsForGroup error:', e);
    container.innerHTML = '<div class="error-text">เกิดข้อผิดพลาดในการโหลดความคิดเห็น</div>';
  }
}

// =====================================================
// 💬 SAVE COMMENT — ผูกกับ report id แรกของกลุ่ม
// =====================================================
async function saveComment() {
  if (!currentReportId) return;

  const input = document.getElementById('commentInput');
  const text = input?.value?.trim();
  if (!text) {
    showToast('⚠️ กรุณาพิมพ์ความคิดเห็น');
    return;
  }

  try {
    const session = await getSessionSafely();
    if (!session?.user?.id) {
      showToast('❌ กรุณาเข้าสู่ระบบใหม่');
      return;
    }

    const { error } = await supabaseClient
      .from('report_comments')
      .insert([{
        report_id: currentReportId,
        manager_id: session.user.id,
        comment: text,
        created_at: new Date().toISOString()
      }]);

    if (error) throw error;

    showToast('💬 บันทึกความคิดเห็นแล้ว');
    input.value = '';

    // Reload comments
    const group = groupedReports.find(g => g.key === currentGroupKey);
    if (group) {
      await loadCommentsForGroup(group.reportIds);
    }
  } catch (e) {
    console.error('❌ saveComment error:', e);
    showToast('❌ เกิดข้อผิดพลาด: ' + e.message);
  }
}

// =====================================================
// ✅ MARK AS READ — mark ทุก report ในกลุ่ม
// =====================================================
async function markAsRead() {
  if (!currentGroupKey) return;

  const group = groupedReports.find(g => g.key === currentGroupKey);
  if (!group) return;

  try {
    const session = await getSessionSafely();
    if (!session?.user?.id) {
      showToast('❌ กรุณาเข้าสู่ระบบใหม่');
      return;
    }

    // Save comment ถ้ามี
    const commentInput = document.getElementById('commentInput');
    const text = commentInput?.value?.trim();
    if (text) await saveComment();

    // Update ทุก report id ในกลุ่ม
    const { error } = await supabaseClient
      .from('reports')
      .update({
        manager_acknowledged: true,
        acknowledged_by: session.user.id,
        acknowledged_at: new Date().toISOString()
      })
      .in('id', group.reportIds);

    if (error) throw error;

    // Update local data
    group.manager_acknowledged = true;
    for (const rid of group.reportIds) {
      const r = allReports.find(x => x.id === rid);
      if (r) r.manager_acknowledged = true;
    }

    // Update filtered
    const fg = filteredGroups.find(g => g.key === currentGroupKey);
    if (fg) fg.manager_acknowledged = true;

    showToast('✅ ทำเครื่องหมายว่าอ่านแล้ว');

    updateSummaryCards();
    updateSalesGrid();
    renderReports();
    closeModal();
  } catch (e) {
    console.error('❌ markAsRead error:', e);
    showToast('❌ เกิดข้อผิดพลาด: ' + e.message);
  }
}

// =====================================================
// ✕ CLOSE MODAL
// =====================================================
function closeModal() {
  const modal = document.getElementById('reportModal');
  if (modal) {
    modal.classList.remove('show');
    document.body.style.overflow = '';
  }
  currentGroupKey = null;
  currentGroupRows = [];
  currentReportId = null;
}

// =====================================================
// 📥 EXPORT CSV — grouped
// =====================================================
function exportCSV() {
  if (!filteredGroups.length) {
    showToast('⚠️ ไม่มีข้อมูลสำหรับ export');
    return;
  }

  const headers = ['วันที่', 'เซลล์', 'ร้านค้า', 'จังหวัด', 'สินค้า', 'จำนวนสินค้า', 'หมายเหตุ', 'สินค้าที่ร้านแนะนำ', 'สถานะ'];

  const rows = filteredGroups.map(g => {
    const shopData = shopsMap[g.shop_id];
    const productNames = g.products.map(p => productsMap[p.product_id] || '—').join(', ') || 'ไม่มีสินค้า';

    return [
      formatDate(g.report_date || g.submitted_at),
      profilesMap[g.sale_id]?.display_name || '—',
      shopData?.name || '—',
      shopData?.province || '—',
      productNames,
      g.products.length,
      (g.note || '—').replace(/[\r\n]+/g, ' ').replace(/"/g, '""'),
      (g.product_interest || '—').replace(/[\r\n]+/g, ' ').replace(/"/g, '""'),
      g.manager_acknowledged ? 'อ่านแล้ว' : 'ยังไม่อ่าน'
    ];
  });

  const csv = '\uFEFF' + [
    headers.join(','),
    ...rows.map(r => r.map(v => `"${v}"`).join(','))
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reports_${formatDateForInput(dateStart)}_${formatDateForInput(dateEnd)}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  showToast('📥 Export สำเร็จ');
}

// =====================================================
// 🔧 SETUP EVENT LISTENERS
// =====================================================
function setupEventListeners() {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') applyFilter();
    });
  }

  const modal = document.getElementById('reportModal');
  if (modal) {
    modal.addEventListener('click', e => {
      if (e.target === modal) closeModal();
    });
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
}

// =====================================================
// 🚪 SETUP LOGOUT
// =====================================================
function setupLogout() {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await supabaseClient.auth.signOut();
      window.location.href = '/pages/auth/login.html';
    });
  }
}

// =====================================================
// 🔧 HELPERS
// =====================================================
function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('th-TH', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  } catch (e) { return '—'; }
}

function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch (e) { return '—'; }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

async function logout() {
  try {
    await supabaseClient.auth.signOut();
    window.location.href = '/pages/auth/login.html';
  } catch (e) {
    window.location.href = '/pages/auth/login.html';
  }
}

// =====================================================
// 🌐 GLOBAL FUNCTIONS
// =====================================================
window.filterBySale = filterBySale;
window.filterByManager = filterByManager;
window.applyFilter = applyFilter;
window.resetFilter = resetFilter;
window.goToPage = goToPage;
window.openGroupModal = openGroupModal;
window.saveComment = saveComment;
window.markAsRead = markAsRead;
window.closeModal = closeModal;
window.exportCSV = exportCSV;
window.loadReports = loadReports;
window.logout = logout;