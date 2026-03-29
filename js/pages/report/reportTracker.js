// =====================================================
// reportTracker.js - Manager Report Review Page
// ใช้ area แทน team_id
// =====================================================

// ⚠️ ไม่ประกาศ let currentUser ซ้ำ เพราะ userService.js
// ใช้ window.currentUser แทน — เก็บ reference ไว้ใน localUser
let localUser = null;

let allReports = [];
let filteredReports = [];
let profilesMap = {};
let shopsMap = {};
let productsMap = {};

let weekOffset = 0;
let currentPage = 1;
const PAGE_SIZE = 20;

let activeSalesFilter = null;
let currentReportId = null;

// =====================================================
// 🚀 INIT
// =====================================================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 Report Manager initializing...');

  try {
    await protectPage(['admin', 'manager']);
  } catch (e) {
    console.error('❌ protectPage failed:', e);
    return;
  }

  // ใช้ window.currentUser จาก userService (โหลดโดย protectPage → initUserService)
  if (window.currentUser && window.currentUser.id) {
    localUser = {
      id:   window.currentUser.id,
      role: window.currentUser.role,
      area: window.currentUser.area,
      name: window.currentUser.display_name
             || window.currentUser.username
             || window.currentUser.email
             || 'Manager'
    };
    console.log('✅ Using window.currentUser:', localUser);
  } else {
    // fallback — ดึงจาก DB ตรงๆ
    localUser = await loadCurrentUserFallback();
    if (!localUser) {
      console.error('❌ No current user');
      return;
    }
    console.log('✅ Fallback user loaded:', localUser);
  }

  // อัปเดต header
  const nameEl = document.getElementById('userName');
  if (nameEl) nameEl.textContent = localUser.name;

  const avatarEl = document.getElementById('userAvatar');
  if (avatarEl) avatarEl.textContent = localUser.name.charAt(0).toUpperCase();

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
});

// =====================================================
// 👤 LOAD CURRENT USER (fallback)
// ใช้เมื่อ window.currentUser ยังไม่พร้อม
// =====================================================
async function loadCurrentUserFallback() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return null;

    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('id, display_name, role, area')
      .eq('id', session.user.id)
      .single();

    return {
      id:   session.user.id,
      role: profile?.role,
      area: profile?.area,
      name: profile?.display_name || session.user.email
    };
  } catch (e) {
    console.error('❌ loadCurrentUserFallback error:', e);
    return null;
  }
}

// =====================================================
// 👥 LOAD PROFILES (sales ทั้งหมด)
// Manager + Admin ดู sales ทุกคนได้ ไม่ filter area
// =====================================================
async function loadProfiles() {
  try {
    console.log('📥 Loading profiles...');

    const query = supabaseClient
      .from('profiles')
      .select('id, display_name, role, area')
      .in('role', ['sales', 'user']);

    const { data, error } = await query;
    if (error) throw error;

    console.log('✅ Profiles loaded:', data?.length || 0);

    profilesMap = Object.fromEntries((data || []).map(p => [p.id, p]));

    // Populate filter dropdown
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
      .select('id, shop_name')
      .order('shop_name');

    if (error) {
      console.error('❌ loadShops error:', error);
      console.warn('⚠️ อาจเป็นปัญหา RLS — ตรวจสอบว่า manager มีสิทธิ์ SELECT จาก shops');
      return;
    }

    console.log('✅ Shops loaded:', data?.length || 0);

    if (!data || data.length === 0) {
      console.warn('⚠️ Shops = 0 — ตรวจสอบ RLS policy ของตาราง shops');
    }

    shopsMap = Object.fromEntries((data || []).map(s => [s.id, s.shop_name]));
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

    if (error) throw error;
    console.log('✅ Products loaded:', data?.length || 0);

    if (data) {
      data.forEach(p => { productsMap[p.id] = p.name; });
    }
  } catch (e) {
    console.error('❌ loadProducts error:', e);
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

    const { start, end } = getWeekRange(weekOffset);
    updateWeekDisplay(start, end);

    console.log('📅 Week range:', start.toISOString(), 'to', end.toISOString());

    let query = supabaseClient
      .from('reports')
      .select('*')
      .order('submitted_at', { ascending: false, nullsLast: true })
      .order('report_date', { ascending: false, nullsLast: true });

    // Admin + Manager ดู report ทั้งหมด (ไม่ filter by sale_id)
    // ถ้าอนาคตต้องการจำกัด → เพิ่ม filter ตรงนี้

    const { data, error } = await query;

    if (error) {
      console.error('❌ reports query error:', error);
      console.warn('⚠️ ตรวจสอบ RLS policy ของตาราง reports');
      throw error;
    }

    console.log('✅ Raw reports from DB:', data?.length || 0);

    // Filter วันที่ใน JavaScript
    const startTime = start.getTime();
    const endTime = end.getTime();

    const filtered = (data || []).filter(r => {
      const date = r.submitted_at || r.report_date || r.created_at;
      if (!date) return false;

      const reportTime = new Date(date).getTime();
      return reportTime >= startTime && reportTime <= endTime;
    });

    console.log('✅ Reports in week range:', filtered.length);

    // ถ้า raw > 0 แต่ filtered = 0 → อาจอยู่สัปดาห์อื่น
    if ((data?.length || 0) > 0 && filtered.length === 0) {
      console.log('ℹ️ มี report ใน DB แต่ไม่อยู่ในสัปดาห์นี้ — ลองเลื่อนสัปดาห์ดู');
    }

    allReports = filtered;
    filteredReports = [...allReports];
    activeSalesFilter = null;

    updateSummaryCards();
    updateSalesGrid();
    currentPage = 1;
    renderReports();

    console.log('=== ✅ LOADING COMPLETE ===');
  } catch (e) {
    console.error('❌ loadReports error:', e);
    if (container) {
      container.innerHTML = `
        <div class="loading">
          เกิดข้อผิดพลาด: ${e.message}<br>
          <small>กรุณาเปิด Console เพื่อดู log</small>
        </div>`;
    }
  }
}

// =====================================================
// 📅 WEEK HELPERS
// =====================================================
function getWeekRange(offset = 0) {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Monday

  const monday = new Date(now);
  monday.setDate(now.getDate() + diff + (offset * 7));
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { start: monday, end: sunday };
}

function updateWeekDisplay(start, end) {
  const fmt = d => d.toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

  let label = '';
  if (weekOffset === 0) label = 'สัปดาห์นี้';
  else if (weekOffset === -1) label = 'สัปดาห์ที่แล้ว';
  else if (weekOffset < -1) label = `${Math.abs(weekOffset)} สัปดาห์ก่อน`;
  else label = `อีก ${weekOffset} สัปดาห์`;

  document.getElementById('weekLabel').textContent = label;
  document.getElementById('weekRange').textContent = `${fmt(start)} – ${fmt(end)}`;
}

async function changeWeek(direction) {
  weekOffset += direction;
  await loadReports();
}

// =====================================================
// 📈 UPDATE SUMMARY CARDS
// =====================================================
function updateSummaryCards() {
  const total = allReports.length;
  const unread = allReports.filter(r => !r.manager_acknowledged).length;
  const read = allReports.filter(r => r.manager_acknowledged).length;
  const activeSalesCount = new Set(allReports.map(r => r.sale_id).filter(Boolean)).size;

  document.getElementById('totalReports').textContent = total;
  document.getElementById('unreadReports').textContent = unread;
  document.getElementById('readReports').textContent = read;
  document.getElementById('activeSales').textContent = activeSalesCount;
}

// =====================================================
// 👥 UPDATE SALES GRID
// =====================================================
function updateSalesGrid() {
  const grid = document.getElementById('salesGrid');
  if (!grid) return;

  const entries = Object.entries(profilesMap);

  if (!entries.length) {
    grid.innerHTML = '<div class="loading">ไม่มีข้อมูลเซลล์</div>';
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
            <span class="stat-value" style="color: ${unread > 0 ? 'var(--accent3)' : 'var(--accent2)'}">
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

  const salesId = document.getElementById('filterSales').value;
  const status = document.getElementById('filterStatus').value;
  const search = document.getElementById('searchInput').value.toLowerCase();

  filteredReports = allReports.filter(r => {
    if (salesId && r.sale_id !== salesId) return false;
    if (status === 'unread' && r.manager_acknowledged) return false;
    if (status === 'read' && !r.manager_acknowledged) return false;

    if (search) {
      const shopName = shopsMap[r.shop_id] || '';
      const productName = productsMap[r.product_id] || '';
      const salesName = profilesMap[r.sale_id]?.display_name || '';
      const note = r.note || '';

      const searchText = [shopName, productName, salesName, note]
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
  document.getElementById('filterSales').value = '';
  document.getElementById('filterStatus').value = '';
  document.getElementById('searchInput').value = '';

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
    container.innerHTML = '<div class="loading">ไม่มีรายงาน</div>';
    renderPagination();
    return;
  }

  container.innerHTML = pageReports.map(report => {
    const profile = profilesMap[report.sale_id];
    const salesName = profile?.display_name || '—';
    const shopName = shopsMap[report.shop_id] || '—';
    const productName = productsMap[report.product_id] || '—';
    const isUnread = !report.manager_acknowledged;

    return `
      <div class="report-item ${isUnread ? 'unread' : ''}" 
           onclick="openReportModal('${report.id}')">
        <div class="report-icon">${salesName.charAt(0).toUpperCase()}</div>
        <div class="report-info">
          <div class="report-header">
            <span class="report-sales">${escapeHtml(salesName)}</span>
            <span class="report-date">${formatDate(report.submitted_at || report.report_date)}</span>
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
  for (let i = 1; i <= totalPages; i++) {
    html += `
      <button class="page-btn ${i === currentPage ? 'active' : ''}"
              onclick="goToPage(${i})">
        ${i}
      </button>
    `;
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
    return;
  }

  currentReportId = reportId;

  const profile = profilesMap[report.sale_id];
  const salesName = profile?.display_name || '—';

  document.getElementById('modalTitle').textContent = `รายงานของ ${salesName}`;

  const statusBadge = document.getElementById('modalStatus');
  if (statusBadge) {
    statusBadge.className = `badge ${report.manager_acknowledged ? 'badge-read' : 'badge-unread'}`;
    statusBadge.textContent = report.manager_acknowledged ? '✅ อ่านแล้ว' : '🕐 ยังไม่อ่าน';
  }

  document.getElementById('mReportDate').textContent = formatDate(report.submitted_at || report.report_date);
  document.getElementById('mSalesName').textContent = salesName;
  document.getElementById('mShopName').textContent = shopsMap[report.shop_id] || '—';
  document.getElementById('mProduct').textContent = productsMap[report.product_id] || '—';
  document.getElementById('mSource').textContent = report.source || '—';
  document.getElementById('mNote').textContent = report.note || 'ไม่มีหมายเหตุ';

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
  document.getElementById('commentInput').value = '';

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
    const { data, error } = await supabaseClient
      .from('report_comments')
      .select('comment, created_at, profiles(display_name)')
      .eq('report_id', reportId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    if (!data || data.length === 0) {
      container.innerHTML = '<div class="loading">ยังไม่มีความคิดเห็น</div>';
      return;
    }

    container.innerHTML = data.map(c => `
      <div class="comment-item">
        <div class="comment-meta">
          <span class="comment-author">${escapeHtml(c.profiles?.display_name || 'ผู้จัดการ')}</span>
          <span class="comment-date">${formatDate(c.created_at)}</span>
        </div>
        <div class="comment-text">${escapeHtml(c.comment)}</div>
      </div>
    `).join('');
  } catch (e) {
    console.error('❌ loadComments error:', e);
    container.innerHTML = '<div class="loading">เกิดข้อผิดพลาด</div>';
  }
}

// =====================================================
// 💬 SAVE COMMENT
// =====================================================
async function saveComment() {
  if (!currentReportId) return;

  const text = document.getElementById('commentInput').value.trim();
  if (!text) {
    showToast('⚠️ กรุณาพิมพ์ความคิดเห็น');
    return;
  }

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();

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
    document.getElementById('commentInput').value = '';
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
    const { data: { session } } = await supabaseClient.auth.getSession();

    const text = document.getElementById('commentInput').value.trim();
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

    // Update local state
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
// 📥 EXPORT CSV
// =====================================================
function exportCSV() {
  if (!filteredReports.length) {
    showToast('⚠️ ไม่มีข้อมูลสำหรับ export');
    return;
  }

  const headers = ['วันที่', 'เซลล์', 'ร้านค้า', 'สินค้า', 'สถานะ'];

  const rows = filteredReports.map(r => [
    formatDate(r.submitted_at || r.report_date),
    profilesMap[r.sale_id]?.display_name || '—',
    shopsMap[r.shop_id] || '—',
    productsMap[r.product_id] || '—',
    r.manager_acknowledged ? 'อ่านแล้ว' : 'ยังไม่อ่าน'
  ]);

  const csv = '\uFEFF' + [
    headers.join(','),
    ...rows.map(r => r.map(v => `"${v}"`).join(','))
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reports_${new Date().toISOString().slice(0, 10)}.csv`;
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
}

// =====================================================
// 🚪 SETUP LOGOUT
// =====================================================
function setupLogout() {
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    window.location.href = '/pages/auth/login.html';
  });
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