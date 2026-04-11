// =====================================================
// executiveHome.js - Report Dashboard
// ดูรายงานทั้งหมด + Comment + ติดตามทีม Manager และ Sales
// =====================================================

'use strict';

let localUser = null;

let allReports = [];
let filteredReports = [];
let profilesMap = {};       // ทุก role
let managersMap = {};       // เฉพาะ manager
let salesMap = {};          // เฉพาะ sales
let shopsMap = {};
let productsMap = {};
let commentCountsMap = {};

// Date Range State
let dateStart = null;
let dateEnd = null;

let currentPage = 1;
const PAGE_SIZE = 20;

let activeManagerFilter = null;
let activeSalesFilter = null;
let currentReportId = null;

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
        reject(new Error('supabaseClient ไม่พร้อม'));
      }
    };
    
    check();
  });
}

// =====================================================
// 🚀 INIT
// =====================================================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 Admin Report Dashboard initializing...');

  try {
    await waitForSupabase();

    const session = await getSessionSafely();
    if (!session) {
      showLoginRequired();
      return;
    }

    // ตรวจสอบว่าเป็น admin
    localUser = await loadCurrentUser(session);
    if (!localUser || localUser.role !== 'admin') {
      showAccessDenied();
      return;
    }

    updateHeaderUI();
    initDateRange();
    setupDateControls();

    await Promise.all([
      loadAllProfiles(),
      loadShops(),
      loadProducts()
    ]);

    await loadReports();

    setupEventListeners();
    setupLogout();

    console.log('✅ Admin Report Dashboard ready');

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
    if (error) return null;
    return session;
  } catch (e) {
    return null;
  }
}

// =====================================================
// 👤 LOAD CURRENT USER
// =====================================================
async function loadCurrentUser(session) {
  try {
    const userId = session?.user?.id;
    if (!userId) return null;

    const { data: profile, error } = await supabaseClient
      .from('profiles')
      .select('id, display_name, role, area')
      .eq('id', userId)
      .single();

    if (error) return null;

    return {
      id: profile.id,
      role: profile.role,
      area: profile.area,
      name: profile.display_name || session.user.email
    };
  } catch (e) {
    return null;
  }
}

// =====================================================
// 🎨 UPDATE HEADER UI
// =====================================================
function updateHeaderUI() {
  const nameEl = document.getElementById('userName');
  if (nameEl && localUser?.name) {
    nameEl.textContent = localUser.name;
  }

  const avatarEl = document.getElementById('userAvatar');
  if (avatarEl && localUser?.name) {
    avatarEl.textContent = localUser.name.charAt(0).toUpperCase();
  }
}

// =====================================================
// ⚠️ ERROR STATES
// =====================================================
function showLoginRequired() {
  const container = document.getElementById('reportsContainer');
  if (container) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔐</div>
        <h3>กรุณาเข้าสู่ระบบ</h3>
        <a href="/pages/auth/login.html" class="btn btn-primary">เข้าสู่ระบบ</a>
      </div>
    `;
  }
}

function showAccessDenied() {
  const container = document.getElementById('reportsContainer');
  if (container) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🚫</div>
        <h3>ไม่มีสิทธิ์เข้าถึง</h3>
        <p>หน้านี้สำหรับผู้บริหารเท่านั้น</p>
        <a href="/pages/index.html" class="btn btn-primary">กลับหน้าหลัก</a>
      </div>
    `;
  }
}

function showErrorState(message) {
  const container = document.getElementById('reportsContainer');
  if (container) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <h3>เกิดข้อผิดพลาด</h3>
        <p>${message}</p>
        <button onclick="location.reload()" class="btn btn-primary">ลองใหม่</button>
      </div>
    `;
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
      const range = btn.dataset.range;
      setQuickRange(range);
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
    case 'thisWeek':
      const dow = start.getDay();
      start.setDate(start.getDate() + (dow === 0 ? -6 : 1 - dow));
      break;
    case 'lastWeek':
      const d = start.getDay();
      start.setDate(start.getDate() + (d === 0 ? -6 : 1 - d) - 7);
      end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      break;
    case 'thisMonth':
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      break;
    case 'lastMonth':
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      end = new Date(today.getFullYear(), today.getMonth(), 0);
      end.setHours(23, 59, 59, 999);
      break;
  }
  
  dateStart = start;
  dateEnd = end;
  
  document.getElementById('dateStart').value = formatDateForInput(dateStart);
  document.getElementById('dateEnd').value = formatDateForInput(dateEnd);
  
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
// 👥 LOAD ALL PROFILES (Managers + Sales)
// =====================================================
async function loadAllProfiles() {
  try {
    const { data, error } = await supabaseClient
      .from('profiles')
      .select('id, display_name, role, area, manager_id');

    if (error) throw error;

    profilesMap = {};
    managersMap = {};
    salesMap = {};

    (data || []).forEach(p => {
      profilesMap[p.id] = p;
      
      if (p.role === 'manager') {
        managersMap[p.id] = p;
      } else if (p.role === 'sales' || p.role === 'user') {
        salesMap[p.id] = p;
      }
    });

    // Populate filter dropdowns
    const managerSelect = document.getElementById('filterManager');
    if (managerSelect) {
      managerSelect.innerHTML = '<option value="">— ทั้งหมด —</option>';
      Object.values(managersMap).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.display_name || p.id;
        managerSelect.appendChild(opt);
      });
    }

    const salesSelect = document.getElementById('filterSales');
    if (salesSelect) {
      salesSelect.innerHTML = '<option value="">— ทั้งหมด —</option>';
      Object.values(salesMap).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.display_name || p.id;
        salesSelect.appendChild(opt);
      });
    }

  } catch (e) {
    console.error('loadAllProfiles error:', e);
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
    console.error('loadShops error:', e);
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

    productsMap = {};
    (data || []).forEach(p => { productsMap[p.id] = p.name; });
  } catch (e) {
    console.error('loadProducts error:', e);
  }
}

// =====================================================
// 💬 LOAD COMMENT COUNTS
// =====================================================
async function loadCommentCounts(reportIds) {
  if (!reportIds || !reportIds.length) return;
  
  try {
    const { data, error } = await supabaseClient
      .from('report_comments')
      .select('report_id')
      .in('report_id', reportIds);
    
    if (error) throw error;
    
    commentCountsMap = {};
    (data || []).forEach(c => {
      commentCountsMap[c.report_id] = (commentCountsMap[c.report_id] || 0) + 1;
    });
  } catch (e) {
    console.error('loadCommentCounts error:', e);
  }
}

// =====================================================
// 📊 LOAD REPORTS
// =====================================================
async function loadReports() {
  const container = document.getElementById('reportsContainer');
  if (container) {
    container.innerHTML = '<div class="loading">กำลังโหลดรายงาน...</div>';
  }

  try {
    const { data, error } = await supabaseClient
      .from('reports')
      .select('*')
      .order('submitted_at', { ascending: false, nullsLast: true })
      .order('report_date', { ascending: false, nullsLast: true });

    if (error) throw error;

    // Filter by date range
    const startTime = dateStart.getTime();
    const endTime = dateEnd.getTime();

    allReports = (data || []).filter(r => {
      const date = r.submitted_at || r.report_date || r.created_at;
      if (!date) return false;
      const reportTime = new Date(date).getTime();
      return reportTime >= startTime && reportTime <= endTime;
    });

    filteredReports = [...allReports];
    activeManagerFilter = null;
    activeSalesFilter = null;

    await loadCommentCounts(allReports.map(r => r.id));

    updateSummaryCards();
    updateManagerGrid();
    updateSalesGrid();
    currentPage = 1;
    renderReports();

  } catch (e) {
    console.error('loadReports error:', e);
    if (container) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <h3>เกิดข้อผิดพลาด</h3>
          <p>${e.message}</p>
        </div>
      `;
    }
  }
}

// =====================================================
// 📈 UPDATE SUMMARY CARDS
// =====================================================
function updateSummaryCards() {
  const total = allReports.length;
  const unread = allReports.filter(r => !r.manager_acknowledged).length;
  const read = allReports.filter(r => r.manager_acknowledged).length;
  const commented = allReports.filter(r => commentCountsMap[r.id] > 0).length;

  document.getElementById('totalReports').textContent = total;
  document.getElementById('unreadReports').textContent = unread;
  document.getElementById('readReports').textContent = read;
  document.getElementById('commentedReports').textContent = commented;
}

// =====================================================
// 👔 UPDATE MANAGER GRID
// =====================================================
function updateManagerGrid() {
  const grid = document.getElementById('managerGrid');
  if (!grid) return;

  const entries = Object.entries(managersMap);

  if (!entries.length) {
    grid.innerHTML = '<div class="empty-state"><p>ไม่มีข้อมูลผู้จัดการ</p></div>';
    return;
  }

  // นับรายงานของทีมแต่ละ manager
  grid.innerHTML = entries.map(([id, profile]) => {
    // หา sales ที่อยู่ใต้ manager นี้
    const teamSalesIds = Object.values(salesMap)
      .filter(s => s.manager_id === id)
      .map(s => s.id);
    
    const teamReports = allReports.filter(r => teamSalesIds.includes(r.sale_id));
    const total = teamReports.length;
    const unread = teamReports.filter(r => !r.manager_acknowledged).length;
    const isActive = activeManagerFilter === id;
    const displayName = profile.display_name || '—';

    return `
      <div class="sales-card ${isActive ? 'active' : ''} ${unread > 0 ? 'has-unread' : ''}"
           onclick="filterByManager('${id}')" style="border-left-color: #f0ad4e;">
        <div class="sales-avatar" style="background: linear-gradient(135deg, #f0ad4e, #ec971f); color: #fff;">
          ${displayName.charAt(0).toUpperCase()}
        </div>
        <div class="sales-name">👔 ${escapeHtml(displayName)}</div>
        <div class="sales-stats">
          <div class="stat-item">
            <span class="stat-value">${total}</span>
            <span class="stat-label">รายงาน</span>
          </div>
          <div class="stat-item">
            <span class="stat-value" style="color: ${unread > 0 ? 'var(--danger)' : 'var(--info)'}">${unread}</span>
            <span class="stat-label">ยังไม่อ่าน</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// =====================================================
// 👥 UPDATE SALES GRID
// =====================================================
function updateSalesGrid() {
  const grid = document.getElementById('salesGrid');
  if (!grid) return;

  const entries = Object.entries(salesMap);

  if (!entries.length) {
    grid.innerHTML = '<div class="empty-state"><p>ไม่มีข้อมูลเซลล์</p></div>';
    return;
  }

  grid.innerHTML = entries.map(([id, profile]) => {
    const reports = allReports.filter(r => r.sale_id === id);
    const total = reports.length;
    const unread = reports.filter(r => !r.manager_acknowledged).length;
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
            <span class="stat-label">รายงาน</span>
          </div>
          <div class="stat-item">
            <span class="stat-value" style="color: ${unread > 0 ? 'var(--danger)' : 'var(--info)'}">${unread}</span>
            <span class="stat-label">ยังไม่อ่าน</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// =====================================================
// 🔍 FILTER BY MANAGER
// =====================================================
function filterByManager(managerId) {
  if (activeManagerFilter === managerId) {
    activeManagerFilter = null;
    document.getElementById('filterManager').value = '';
  } else {
    activeManagerFilter = managerId;
    document.getElementById('filterManager').value = managerId;
  }

  updateManagerGrid();
  applyFilter();
}

// =====================================================
// 🔍 FILTER BY SALE
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

// =====================================================
// 🔍 APPLY FILTER
// =====================================================
function applyFilter() {
  const managerId = document.getElementById('filterManager')?.value || '';
  const salesId = document.getElementById('filterSales')?.value || '';
  const status = document.getElementById('filterStatus')?.value || '';
  const search = (document.getElementById('searchInput')?.value || '').toLowerCase();

  filteredReports = allReports.filter(r => {
    // Filter by manager (ดูจาก manager_id ของ sales)
    if (managerId) {
      const salesProfile = salesMap[r.sale_id];
      if (!salesProfile || salesProfile.manager_id !== managerId) return false;
    }

    if (salesId && r.sale_id !== salesId) return false;
    if (status === 'unread' && r.manager_acknowledged) return false;
    if (status === 'read' && !r.manager_acknowledged) return false;
    if (status === 'commented' && !commentCountsMap[r.id]) return false;

    if (search) {
      const shopData = shopsMap[r.shop_id];
      const shopName = shopData?.name || '';
      const shopProvince = shopData?.province || '';
      const productName = productsMap[r.product_id] || '';
      const salesName = profilesMap[r.sale_id]?.display_name || '';
      const note = r.note || '';

      const searchText = [shopName, shopProvince, productName, salesName, note]
        .join(' ')
        .toLowerCase();

      if (!searchText.includes(search)) return false;
    }

    return true;
  });

  currentPage = 1;
  renderReports();
}

// =====================================================
// ↺ RESET FILTER
// =====================================================
function resetFilter() {
  document.getElementById('filterManager').value = '';
  document.getElementById('filterSales').value = '';
  document.getElementById('filterStatus').value = '';
  document.getElementById('searchInput').value = '';

  activeManagerFilter = null;
  activeSalesFilter = null;
  filteredReports = [...allReports];
  currentPage = 1;

  updateManagerGrid();
  updateSalesGrid();
  renderReports();
}

// =====================================================
// 🎨 RENDER REPORTS
// =====================================================
function renderReports() {
  const container = document.getElementById('reportsContainer');
  if (!container) return;

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageReports = filteredReports.slice(start, start + PAGE_SIZE);

  const countEl = document.getElementById('reportCount');
  if (countEl) {
    countEl.textContent = filteredReports.length !== allReports.length
      ? `(${filteredReports.length} / ${allReports.length} รายการ)`
      : `(${allReports.length} รายการ)`;
  }

  if (!pageReports.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <h3>ไม่พบรายงาน</h3>
      </div>
    `;
    renderPagination();
    return;
  }

  container.innerHTML = pageReports.map(report => {
    const profile = profilesMap[report.sale_id];
    const salesName = profile?.display_name || '—';
    const shopData = shopsMap[report.shop_id];
    const shopName = shopData?.name || '—';
    const productName = productsMap[report.product_id] || '—';
    const isUnread = !report.manager_acknowledged;
    
    const commentCount = commentCountsMap[report.id] || 0;
    const commentBadge = commentCount > 0 
      ? `<span class="badge-comment" title="${commentCount} ความคิดเห็น">💬 ${commentCount}</span>` 
      : '';

    // หา manager ของ sales นี้
    const managerName = profile?.manager_id ? (managersMap[profile.manager_id]?.display_name || '') : '';

    return `
      <div class="report-item ${isUnread ? 'unread' : ''}" 
           onclick="openReportModal('${report.id}')">
        <div class="report-icon">${salesName.charAt(0).toUpperCase()}</div>
        <div class="report-info">
          <div class="report-header">
            <span class="report-sales">${escapeHtml(salesName)}</span>
            ${managerName ? `<span style="font-size:11px;color:#888;margin-left:6px;">👔 ${escapeHtml(managerName)}</span>` : ''}
            <span class="report-date">${formatDate(report.report_date || report.submitted_at)}</span>
          </div>
          <div class="report-details">
            <div class="report-detail-item">🏪 ${escapeHtml(shopName)}</div>
            <div class="report-detail-item">📦 ${escapeHtml(productName)}</div>
          </div>
        </div>
        <div class="report-status">
          ${commentBadge}
          <span class="badge ${isUnread ? 'badge-unread' : 'badge-read'}">
            ${isUnread ? '🕐 ยังไม่อ่าน' : '✅ อ่านแล้ว'}
          </span>
        </div>
      </div>
    `;
  }).join('');

  renderPagination();
}

// =====================================================
// 📄 PAGINATION
// =====================================================
function renderPagination() {
  const el = document.getElementById('pagination');
  if (!el) return;

  const totalPages = Math.ceil(filteredReports.length / PAGE_SIZE);
  if (totalPages <= 1) {
    el.innerHTML = '';
    return;
  }

  let html = '';
  
  if (currentPage > 1) {
    html += `<button class="page-btn" onclick="goToPage(${currentPage - 1})">‹</button>`;
  }

  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
      html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
    } else if (i === currentPage - 3 || i === currentPage + 3) {
      html += '<span class="page-dots">...</span>';
    }
  }

  if (currentPage < totalPages) {
    html += `<button class="page-btn" onclick="goToPage(${currentPage + 1})">›</button>`;
  }

  el.innerHTML = html;
}

function goToPage(page) {
  currentPage = page;
  renderReports();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// =====================================================
// 📋 OPEN REPORT MODAL
// =====================================================
async function openReportModal(reportId) {
  const report = allReports.find(r => r.id === reportId);
  if (!report) {
    showToast('❌ ไม่พบรายงาน');
    return;
  }

  currentReportId = reportId;

  const profile = profilesMap[report.sale_id];
  const salesName = profile?.display_name || '—';
  const managerName = profile?.manager_id ? (managersMap[profile.manager_id]?.display_name || '—') : '—';
  const shopData = shopsMap[report.shop_id];

  document.getElementById('modalTitle').textContent = `รายงานของ ${salesName}`;
  
  const statusBadge = document.getElementById('modalStatus');
  statusBadge.className = `badge ${report.manager_acknowledged ? 'badge-read' : 'badge-unread'}`;
  statusBadge.textContent = report.manager_acknowledged ? '✅ อ่านแล้ว' : '🕐 ยังไม่อ่าน';

  const fields = {
    'mReportDate': formatDate(report.report_date || report.submitted_at),
    'mSalesName': salesName,
    'mManagerName': managerName,
    'mShopName': shopData?.name || '—',
    'mProvince': shopData?.province || '—',
    'mProduct': productsMap[report.product_id] || '—',
    'mSource': report.source || '—',
    'mNote': report.note || 'ไม่มีหมายเหตุ'
  };

  Object.entries(fields).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  });

  const qtyEl = document.getElementById('mQty');
  if (qtyEl) {
    if (report.quantity !== undefined && report.quantity !== null) {
      qtyEl.textContent = (report.quantity || 0).toLocaleString('th-TH') + ' ชิ้น';
    } else {
      qtyEl.textContent = '—';
    }
  }

  await loadComments(reportId);
  document.getElementById('commentInput').value = '';

  const modal = document.getElementById('reportModal');
  modal.classList.add('show');
  document.body.style.overflow = 'hidden';
}

// =====================================================
// 💬 LOAD COMMENTS
// =====================================================
async function loadComments(reportId) {
  const container = document.getElementById('commentsHistory');
  if (!container) return;

  try {
    const { data, error } = await supabaseClient
      .from('report_comments')
      .select('comment, created_at, profiles(display_name, role)')
      .eq('report_id', reportId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    if (!data || data.length === 0) {
      container.innerHTML = '<div class="no-comments">ยังไม่มีความคิดเห็น</div>';
      return;
    }

    container.innerHTML = data.map(c => {
      const role = c.profiles?.role || 'user';
      const displayName = c.profiles?.display_name || 'ผู้ใช้';
      
      let roleBadge = '';
      let roleClass = '';
      
      if (role === 'admin') {
        roleBadge = '👑 ผู้บริหาร';
        roleClass = 'comment-admin';
      } else if (role === 'manager') {
        roleBadge = '👔 ผู้จัดการ';
        roleClass = 'comment-manager';
      } else {
        roleBadge = '👤 ' + role;
        roleClass = 'comment-user';
      }
      
      return `
        <div class="comment-item ${roleClass}">
          <div class="comment-meta">
            <span class="comment-author">${escapeHtml(displayName)}</span>
            <span class="comment-role-badge ${roleClass}">${roleBadge}</span>
            <span class="comment-date">${formatDateTime(c.created_at)}</span>
          </div>
          <div class="comment-text">${escapeHtml(c.comment)}</div>
        </div>
      `;
    }).join('');
  } catch (e) {
    container.innerHTML = '<div class="error-text">เกิดข้อผิดพลาด</div>';
  }
}

// =====================================================
// 💬 SAVE COMMENT
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

    if (error)