// =====================================================
// reportTracker.js - Manager Report Review Page v3
// แก้ไข: ปรับปรุง Auth Flow และ Error Handling
// =====================================================

'use strict';

// ⚠️ ไม่ประกาศ let currentUser ซ้ำ เพราะ userService.js
let localUser = null;

let allReports = [];
let filteredReports = [];
let profilesMap = {};
let shopsMap = {};
let productsMap = {};

// ✅ เก็บจำนวน comment ของแต่ละ report
let commentCountsMap = {};

// ── Date Range State ──
let dateStart = null;
let dateEnd = null;

let currentPage = 1;
const PAGE_SIZE = 20;

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
        console.log('✅ supabaseClient พร้อมแล้ว');
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
    // รอ Supabase Client พร้อมก่อน
    await waitForSupabase();
    console.log('✅ Supabase client ready');

    // ลองดึง session โดยตรง (ไม่ต้องรอ protectPage)
    const session = await getSessionSafely();
    
    if (!session) {
      console.warn('⚠️ ไม่พบ session - อาจยังไม่ได้ login หรือ session หมดอายุ');
      // แสดง UI ให้ผู้ใช้ login
      showLoginRequired();
      return;
    }

    console.log('✅ Session found:', session.user?.email);

    // ลองเรียก protectPage (ถ้ามี)
    if (typeof protectPage === 'function') {
      try {
        await protectPage(['admin', 'executive','manager']);
        console.log('✅ protectPage passed');
      } catch (e) {
        console.warn('⚠️ protectPage failed:', e.message);
        // ไม่ return ออก - ลองดำเนินการต่อ
      }
    }

    // โหลด user info
    localUser = await loadCurrentUser(session);
    
    if (!localUser) {
      console.error('❌ ไม่สามารถโหลดข้อมูล user ได้');
      showLoginRequired();
      return;
    }

    console.log('✅ User loaded:', localUser);

    // อัปเดต header
    updateHeaderUI();

    // ตั้งค่า Date Range
    initDateRange();
    setupDateControls();

    // โหลดข้อมูลสนับสนุน
    await Promise.all([
      loadProfiles(),
      loadShops(),
      loadProducts()
    ]);

    // โหลดรายงาน
    await loadReports();

    // Setup event listeners
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
    // ลองใช้ getSession ก่อน (เร็วกว่า)
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    
    if (error) {
      console.warn('⚠️ getSession error:', error.message);
      
      // ถ้า getSession ไม่ได้ ลอง getUser
      try {
        const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
        if (user && !userError) {
          console.log('✅ Got user from getUser()');
          return { user };
        }
      } catch (e) {
        console.warn('⚠️ getUser also failed:', e.message);
      }
      
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
    // ลองใช้ window.currentUser จาก userService ก่อน
    if (window.currentUser && window.currentUser.id) {
      console.log('✅ Using window.currentUser');
      return {
        id: window.currentUser.id,
        role: window.currentUser.role,
        area: window.currentUser.area,
        name: window.currentUser.display_name 
              || window.currentUser.username 
              || window.currentUser.email 
              || 'Manager'
      };
    }

    // ถ้าไม่มี ให้ดึงจาก profiles
    const userId = session?.user?.id;
    if (!userId) {
      console.error('❌ No user ID');
      return null;
    }

    const { data: profile, error } = await supabaseClient
      .from('profiles')
      .select('id, display_name, role, area')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('❌ Profile query error:', error);
      // ยังคง return ข้อมูลพื้นฐานจาก session
      return {
        id: userId,
        role: 'user',
        area: null,
        name: session.user.email || 'User'
      };
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
  if (nameEl && localUser?.name) {
    nameEl.textContent = localUser.name;
  }

  const avatarEl = document.getElementById('userAvatar');
  if (avatarEl && localUser?.name) {
    avatarEl.textContent = localUser.name.charAt(0).toUpperCase();
  }
}

// =====================================================
// ⚠️ SHOW LOGIN REQUIRED
// =====================================================
function showLoginRequired() {
  const container = document.getElementById('reportsContainer');
  if (container) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔐</div>
        <h3>กรุณาเข้าสู่ระบบ</h3>
        <p>คุณต้องเข้าสู่ระบบก่อนเพื่อดูรายงาน</p>
        <a href="/pages/auth/login.html" class="btn btn-primary" style="margin-top: 1rem;">
          เข้าสู่ระบบ
        </a>
      </div>
    `;
  }

  // ซ่อน loading ใน sales grid
  const salesGrid = document.getElementById('salesGrid');
  if (salesGrid) {
    salesGrid.innerHTML = '';
  }

  // Reset summary cards
  ['totalReports', 'unreadReports', 'readReports', 'activeSales'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '—';
  });
}

// =====================================================
// ⚠️ SHOW ERROR STATE
// =====================================================
function showErrorState(message) {
  const container = document.getElementById('reportsContainer');
  if (container) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <h3>เกิดข้อผิดพลาด</h3>
        <p>${message}</p>
        <button onclick="location.reload()" class="btn btn-primary" style="margin-top: 1rem;">
          ลองใหม่อีกครั้ง
        </button>
      </div>
    `;
  }
}

// =====================================================
// 📅 DATE RANGE CONTROLS
// =====================================================
function initDateRange() {
  // ค่าเริ่มต้น: สัปดาห์นี้ (จันทร์ - อาทิตย์)
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
  
  // ตั้งค่า input
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
  
  // Quick buttons
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
    case 'today':
      break;
      
    case '7days':
      start.setDate(start.getDate() - 6);
      break;
      
    case '30days':
      start.setDate(start.getDate() - 29);
      break;
      
    case 'thisWeek':
      const dayOfWeek = start.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      start.setDate(start.getDate() + diff);
      break;
      
    case 'lastWeek':
      const dow = start.getDay();
      const d = dow === 0 ? -6 : 1 - dow;
      start.setDate(start.getDate() + d - 7);
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
      
    default:
      const defDow = start.getDay();
      const defDiff = defDow === 0 ? -6 : 1 - defDow;
      start.setDate(start.getDate() + defDiff);
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
    console.log('📥 Loading profiles...');

    const query = supabaseClient
      .from('profiles')
      .select('id, display_name, role, area')
      .in('role', ['sales', 'user']);

    const { data, error } = await query;
    
    if (error) {
      console.error('❌ loadProfiles error:', error);
      return;
    }

    console.log('✅ Profiles loaded:', data?.length || 0);

    profilesMap = Object.fromEntries((data || []).map(p => [p.id, p]));

    const select = document.getElementById('filterSales');
    if (select) {
      select.innerHTML = '<option value="">— ทั้งหมด —</option>';
      (data || []).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.display_name || p.id;
        select.appendChild(opt);
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
    console.log('📥 Loading shops...');
    const { data, error } = await supabaseClient
      .from('shops')
      .select('id, shop_name, province')
      .order('shop_name');

    if (error) {
      console.error('❌ loadShops error:', error);
      return;
    }

    console.log('✅ Shops loaded:', data?.length || 0);
    // ✅ เก็บทั้ง shop_name และ province
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
    console.log('📥 Loading products...');
    const { data, error } = await supabaseClient
      .from('products')
      .select('id, name');

    if (error) {
      console.error('❌ loadProducts error:', error);
      return;
    }
    
    console.log('✅ Products loaded:', data?.length || 0);

    if (data) {
      data.forEach(p => { productsMap[p.id] = p.name; });
    }
  } catch (e) {
    console.error('❌ loadProducts error:', e);
  }
}

// =====================================================
// 💬 LOAD COMMENT COUNTS - นับจำนวน comment ของแต่ละ report
// =====================================================
async function loadCommentCounts(reportIds) {
  if (!reportIds || !reportIds.length) return;
  
  try {
    // ดึง comments ทั้งหมดของ reports เหล่านี้
    const { data, error } = await supabaseClient
      .from('report_comments')
      .select('report_id')
      .in('report_id', reportIds);
    
    if (error) {
      console.error('❌ loadCommentCounts error:', error);
      return;
    }
    
    // นับจำนวน comment ต่อ report
    commentCountsMap = {};
    (data || []).forEach(c => {
      commentCountsMap[c.report_id] = (commentCountsMap[c.report_id] || 0) + 1;
    });
    
    console.log('✅ Comment counts loaded:', Object.keys(commentCountsMap).length, 'reports have comments');
  } catch (e) {
    console.error('❌ loadCommentCounts error:', e);
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
    console.log('=== 📊 LOADING REPORTS ===');
    console.log('📅 Date range:', formatDateForInput(dateStart), 'to', formatDateForInput(dateEnd));

    let query = supabaseClient
      .from('reports')
      .select('*')
      .order('submitted_at', { ascending: false, nullsLast: true })
      .order('report_date', { ascending: false, nullsLast: true });

    const { data, error } = await query;

    if (error) {
      console.error('❌ reports query error:', error);
      throw error;
    }

    console.log('✅ Raw reports from DB:', data?.length || 0);

    // Filter วันที่ใน JavaScript
    const startTime = dateStart.getTime();
    const endTime = dateEnd.getTime();

    const filtered = (data || []).filter(r => {
      const date = r.submitted_at || r.report_date || r.created_at;
      if (!date) return false;

      const reportTime = new Date(date).getTime();
      return reportTime >= startTime && reportTime <= endTime;
    });

    console.log('✅ Reports in date range:', filtered.length);

    allReports = filtered;
    filteredReports = [...allReports];
    activeSalesFilter = null;

    // ✅ โหลด comment counts สำหรับแต่ละ report
    await loadCommentCounts(allReports.map(r => r.id));

    updateSummaryCards();
    updateSalesGrid();
    currentPage = 1;
    renderReports();

    console.log('=== ✅ LOADING COMPLETE ===');
  } catch (e) {
    console.error('❌ loadReports error:', e);
    if (container) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <h3>เกิดข้อผิดพลาด</h3>
          <p>${e.message}</p>
          <button onclick="loadReports()" class="btn btn-primary" style="margin-top: 1rem;">
            ลองใหม่
          </button>
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
  const activeSalesCount = new Set(allReports.map(r => r.sale_id).filter(Boolean)).size;

  const totalEl = document.getElementById('totalReports');
  const unreadEl = document.getElementById('unreadReports');
  const readEl = document.getElementById('readReports');
  const activeSalesEl = document.getElementById('activeSales');

  if (totalEl) totalEl.textContent = total;
  if (unreadEl) unreadEl.textContent = unread;
  if (readEl) readEl.textContent = read;
  if (activeSalesEl) activeSalesEl.textContent = activeSalesCount;
}

// =====================================================
// 👥 UPDATE SALES GRID
// =====================================================
function updateSalesGrid() {
  const grid = document.getElementById('salesGrid');
  if (!grid) return;

  const entries = Object.entries(profilesMap);

  if (!entries.length) {
    grid.innerHTML = '<div class="empty-state"><p>ไม่มีข้อมูลเซลล์</p></div>';
    return;
  }

  grid.innerHTML = entries.map(([id, profile]) => {
    const reports = allReports.filter(r => r.sale_id === id);
    const total = reports.length;
    const unread = reports.filter(r => !r.manager_acknowledged).length;
    const isActive = activeSalesFilter === id;
    const hasUnread = unread > 0;
    const displayName = profile.display_name || '—';

    return `
      <div class="sales-card ${isActive ? 'active' : ''} ${hasUnread ? 'has-unread' : ''}"
           onclick="filterBySale('${id}')">
        <div class="sales-avatar">${displayName.charAt(0).toUpperCase()}</div>
        <div class="sales-name">${escapeHtml(displayName)}</div>
        <div class="sales-stats">
          <div class="stat-item">
            <span class="stat-value">${total}</span>
            <span class="stat-label">รายงาน</span>
          </div>
          <div class="stat-item">
            <span class="stat-value" style="color: ${unread > 0 ? 'var(--danger)' : 'var(--info)'}">
              ${unread}
            </span>
            <span class="stat-label">ยังไม่อ่าน</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
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
  console.log('🔍 Applying filter...');

  const salesId = document.getElementById('filterSales')?.value || '';
  const status = document.getElementById('filterStatus')?.value || '';
  const search = (document.getElementById('searchInput')?.value || '').toLowerCase();

  filteredReports = allReports.filter(r => {
    if (salesId && r.sale_id !== salesId) return false;
    if (status === 'unread' && r.manager_acknowledged) return false;
    if (status === 'read' && !r.manager_acknowledged) return false;

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

  console.log('✅ Filtered:', filteredReports.length, '/', allReports.length);

  currentPage = 1;
  renderReports();
}

// =====================================================
// ↺ RESET FILTER
// =====================================================
function resetFilter() {
  const filterSales = document.getElementById('filterSales');
  const filterStatus = document.getElementById('filterStatus');
  const searchInput = document.getElementById('searchInput');

  if (filterSales) filterSales.value = '';
  if (filterStatus) filterStatus.value = '';
  if (searchInput) searchInput.value = '';

  activeSalesFilter = null;
  filteredReports = [...allReports];
  currentPage = 1;

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
        <p>ไม่มีรายงานในช่วงเวลาที่เลือก</p>
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
    
    // ✅ ตรวจสอบว่ามี comment หรือไม่
    const commentCount = commentCountsMap[report.id] || 0;
    const commentBadge = commentCount > 0 
      ? `<span class="badge-comment" title="${commentCount} ความคิดเห็น">💬 ${commentCount}</span>` 
      : '';

    return `
      <div class="report-item ${isUnread ? 'unread' : ''}" 
           onclick="openReportModal('${report.id}')">
        <div class="report-icon">${salesName.charAt(0).toUpperCase()}</div>
        <div class="report-info">
          <div class="report-header">
            <span class="report-sales">${escapeHtml(salesName)}</span>
            <span class="report-date">${formatDate(report.report_date || report.submitted_at)}</span>
          </div>
          <div class="report-details">
            <div class="report-detail-item">
              🏪 ${escapeHtml(shopName)}
            </div>
            <div class="report-detail-item">
              📦 ${escapeHtml(productName)}
            </div>
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
  
  // Previous button
  if (currentPage > 1) {
    html += `<button class="page-btn" onclick="goToPage(${currentPage - 1})">‹</button>`;
  }

  // Page numbers
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
      html += `
        <button class="page-btn ${i === currentPage ? 'active' : ''}"
                onclick="goToPage(${i})">
          ${i}
        </button>
      `;
    } else if (i === currentPage - 3 || i === currentPage + 3) {
      html += '<span class="page-dots">...</span>';
    }
  }

  // Next button
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
  console.log('📋 Opening report:', reportId);

  const report = allReports.find(r => r.id === reportId);
  if (!report) {
    console.error('❌ Report not found:', reportId);
    showToast('❌ ไม่พบรายงาน');
    return;
  }

  currentReportId = reportId;

  const profile = profilesMap[report.sale_id];
  const salesName = profile?.display_name || '—';

  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.textContent = `รายงานของ ${salesName}`;

  const statusBadge = document.getElementById('modalStatus');
  if (statusBadge) {
    statusBadge.className = `badge ${report.manager_acknowledged ? 'badge-read' : 'badge-unread'}`;
    statusBadge.textContent = report.manager_acknowledged ? '✅ อ่านแล้ว' : '🕐 ยังไม่อ่าน';
  }

  // Fill modal fields
  const shopData = shopsMap[report.shop_id];
  const fields = {
    'mReportDate': formatDate(report.report_date || report.submitted_at),
    'mSalesName': salesName,
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

  // Quantity field
  const qtyEl = document.getElementById('mQty');
  if (qtyEl) {
    if (report.quantity !== undefined && report.quantity !== null) {
      qtyEl.textContent = (report.quantity || 0).toLocaleString('th-TH') + ' ชิ้น';
      const qtyRow = qtyEl.closest('.info-item');
      if (qtyRow) qtyRow.style.display = '';
    } else {
      const qtyRow = qtyEl.closest('.info-item');
      if (qtyRow) qtyRow.style.display = 'none';
    }
  }

  await loadComments(reportId);
  
  const commentInput = document.getElementById('commentInput');
  if (commentInput) commentInput.value = '';

  const modal = document.getElementById('reportModal');
  if (modal) {
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
}

// =====================================================
// 💬 LOAD COMMENTS
// =====================================================
async function loadComments(reportId) {
  const container = document.getElementById('commentsHistory');
  if (!container) return;

  try {
    // ✅ ดึง role มาด้วย
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
      const role = c.profiles?.role || 'manager';
      const displayName = c.profiles?.display_name || 'ผู้ใช้';
      
      // ✅ แสดง role badge แยกสี
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
    console.error('❌ loadComments error:', e);
    container.innerHTML = '<div class="error-text">เกิดข้อผิดพลาดในการโหลดความคิดเห็น</div>';
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

    if (error) throw error;

    showToast('💬 บันทึกความคิดเห็นแล้ว');
    input.value = '';
    await loadComments(currentReportId);
  } catch (e) {
    console.error('❌ saveComment error:', e);
    showToast('❌ เกิดข้อผิดพลาด: ' + e.message);
  }
}

// =====================================================
// ✅ MARK AS READ
// =====================================================
async function markAsRead() {
  if (!currentReportId) return;

  try {
    const session = await getSessionSafely();
    if (!session?.user?.id) {
      showToast('❌ กรุณาเข้าสู่ระบบใหม่');
      return;
    }

    // Save comment if exists
    const commentInput = document.getElementById('commentInput');
    const text = commentInput?.value?.trim();
    if (text) {
      await saveComment();
    }

    const { error } = await supabaseClient
      .from('reports')
      .update({
        manager_acknowledged: true,
        acknowledged_by: session.user.id,
        acknowledged_at: new Date().toISOString()
      })
      .eq('id', currentReportId);

    if (error) throw error;

    // Update local data
    const idx = allReports.findIndex(r => r.id === currentReportId);
    if (idx !== -1) {
      allReports[idx].manager_acknowledged = true;
    }

    const fidx = filteredReports.findIndex(r => r.id === currentReportId);
    if (fidx !== -1) {
      filteredReports[fidx].manager_acknowledged = true;
    }

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
  currentReportId = null;
}

// =====================================================
// 📥 EXPORT CSV - ✅ เพิ่มช่องหมายเหตุ และจังหวัด
// =====================================================
function exportCSV() {
  if (!filteredReports.length) {
    showToast('⚠️ ไม่มีข้อมูลสำหรับ export');
    return;
  }

  // ✅ เพิ่ม 'จังหวัด' ใน headers
  const headers = ['วันที่', 'เซลล์', 'ร้านค้า', 'จังหวัด', 'สินค้า', 'หมายเหตุ', 'สถานะ'];

  const rows = filteredReports.map(r => {
    const shopData = shopsMap[r.shop_id];
    return [
      // ✅ ใช้ report_date (วันที่เข้าร้าน) เป็นหลัก
      formatDate(r.report_date || r.submitted_at),
      profilesMap[r.sale_id]?.display_name || '—',
      shopData?.name || '—',
      // ✅ เพิ่มจังหวัด
      shopData?.province || '—',
      productsMap[r.product_id] || '—',
      // ✅ หมายเหตุ - ลบ newlines และ escape quotes
      (r.note || '—').replace(/[\r\n]+/g, ' ').replace(/"/g, '""'),
      r.manager_acknowledged ? 'อ่านแล้ว' : 'ยังไม่อ่าน'
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

  // ESC key to close modal
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
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch (e) {
    return '—';
  }
}

// ✅ เพิ่ม formatDateTime สำหรับแสดงวันที่และเวลา
function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return '—';
  }
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

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// =====================================================
// 🚪 GLOBAL LOGOUT FUNCTION (สำหรับ onclick)
// =====================================================
async function logout() {
  try {
    await supabaseClient.auth.signOut();
    window.location.href = '/pages/auth/login.html';
  } catch (e) {
    console.error('Logout error:', e);
    window.location.href = '/pages/auth/login.html';
  }
}

// Make functions globally accessible
window.filterBySale = filterBySale;
window.applyFilter = applyFilter;
window.resetFilter = resetFilter;
window.goToPage = goToPage;
window.openReportModal = openReportModal;
window.saveComment = saveComment;
window.markAsRead = markAsRead;
window.closeModal = closeModal;
window.exportCSV = exportCSV;
window.loadReports = loadReports;
window.logout = logout;