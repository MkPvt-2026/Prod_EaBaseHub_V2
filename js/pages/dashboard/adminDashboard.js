/* ==========================================================
   ADMINISTRATION CONSOLE SCRIPT
   ใช้ render เมนูจาก Array เพื่อให้เพิ่ม/ลบ/แก้เมนูง่าย
   ========================================================== */


/* ----------------------------------------------------------
   1) ข้อมูลเมนูทั้งหมด
   ถ้าต้องการเพิ่มเมนูใหม่ ให้เพิ่ม item ใน array นี้ได้เลย
   ---------------------------------------------------------- */

const adminMenus = [
  {
    group: "User & Access",
    icon: "group",
    items: [
      {
        title: "จัดการผู้ใช้งาน",
        desc: "เพิ่ม / แก้ไข / ปิดใช้งานบัญชีผู้ใช้งานในระบบ",
        icon: "person",
        url: "/pages/admin/admintor.html"
      },
      {
        title: "กำหนดสิทธิ์ Role",
        desc: "จัดการสิทธิ์การเข้าถึงของแต่ละบทบาท",
        icon: "admin_panel_settings",
        url: "/pages/admin/admintor.html"
      },
      {
        title: "ประวัติการเข้าใช้งาน",
        desc: "ตรวจสอบกิจกรรมการเข้าใช้งานของผู้ใช้",
        icon: "history",
        url: "admin-login-log.html"
      }
    ]
  },

  {
    group: "Master Data",
    icon: "widgets",
    items: [
      {
        title: "จัดการร้านค้า",
        desc: "ข้อมูลร้านค้า เขตพื้นที่ และเซลผู้ดูแล",
        icon: "storefront",
        url: "admin-shops.html"
      },
      {
        title: "จัดการสินค้า",
        desc: "หมวดหมู่สินค้า / รายการสินค้า / Attribute",
        icon: "inventory_2",
        url: "admin-products.html"
      },
      {
        title: "จัดการพื้นที่ขาย",
        desc: "โซน จังหวัด และเขตการขาย",
        icon: "location_on",
        url: "admin-areas.html"
      }
    ]
  },

  {
    group: "Workflow Settings",
    icon: "account_tree",
    items: [
      {
        title: "ตั้งค่าการอนุมัติ",
        desc: "กำหนดลำดับการอนุมัติ Manager → Executive",
        icon: "account_tree",
        url: "admin-approval.html"
      },
      {
        title: "ตั้งค่าเอกสาร",
        desc: "เลขที่เอกสาร / เวอร์ชัน / รูปแบบฟอร์ม",
        icon: "description",
        url: "admin-documents.html"
      },
      {
        title: "ตั้งค่าการแจ้งเตือน",
        desc: "LINE / Email / Reminder แจ้งเตือนในระบบ",
        icon: "notifications",
        url: "admin-notifications.html"
      }
    ]
  },

  {
    group: "System Tools",
    icon: "construction",
    items: [
      {
        title: "นำเข้า / ส่งออกข้อมูล",
        desc: "CSV / Excel / Backup ข้อมูลระบบ",
        icon: "upload_file",
        url: "admin-import-export.html"
      },
      {
        title: "Audit Log",
        desc: "ประวัติการแก้ไขข้อมูลสำคัญในระบบ",
        icon: "fact_check",
        url: "admin-audit-log.html"
      },
      {
        title: "System Config",
        desc: "ตั้งค่าระบบเพิ่มเติม และการเชื่อมต่อ",
        icon: "settings",
        url: "admin-config.html"
      }
    ]
  }
];


/* ----------------------------------------------------------
   2) Render เมนูทั้งหมดลงหน้า HTML
   ---------------------------------------------------------- */

function renderAdminMenus(keyword = "") {
  const container = document.getElementById("adminMenuContainer");
  if (!container) return;

  const searchText = keyword.trim().toLowerCase();

  let html = "";
  let foundCount = 0;

  adminMenus.forEach(section => {
    // กรองเมนูตามคำค้นหา
    const filteredItems = section.items.filter(item => {
      return (
        item.title.toLowerCase().includes(searchText) ||
        item.desc.toLowerCase().includes(searchText) ||
        section.group.toLowerCase().includes(searchText)
      );
    });

    // ถ้าไม่มีเมนูในหมวดนี้ ให้ข้าม
    if (filteredItems.length === 0) return;

    foundCount += filteredItems.length;

    html += `
      <div class="menu-section">
        <div class="menu-section-header">
          <div class="menu-section-title">
            <span class="material-symbols-outlined">${section.icon}</span>
            <h2>${section.group}</h2>
          </div>
          <a href="#">ดูทั้งหมด ›</a>
        </div>

        <div class="menu-card-grid">
          ${filteredItems.map(item => `
            <article class="menu-card" data-url="${item.url}">
              <div class="menu-card-icon">
                <span class="material-symbols-outlined">${item.icon}</span>
              </div>
              <h3>${item.title}</h3>
              <p>${item.desc}</p>
            </article>
          `).join("")}
        </div>
      </div>
    `;
  });

  // ถ้าค้นหาแล้วไม่เจอ
  if (foundCount === 0) {
    html = `
      <div class="empty-state">
        <h3>ไม่พบเมนูที่ค้นหา</h3>
        <p>ลองค้นหาด้วยคำอื่น เช่น ผู้ใช้งาน, ร้านค้า, เอกสาร, แจ้งเตือน</p>
      </div>
    `;
  }

  container.innerHTML = html;

  bindMenuCardClick();
}


/* ----------------------------------------------------------
   3) คลิกการ์ดแล้วเปลี่ยนหน้า
   ---------------------------------------------------------- */

function bindMenuCardClick() {
  const cards = document.querySelectorAll(".menu-card");

  cards.forEach(card => {
    card.addEventListener("click", () => {
      const url = card.dataset.url;

      if (!url) return;

      // ถ้ายังไม่อยากให้เปลี่ยนหน้าจริง ให้เปลี่ยนเป็น console.log(url)
      window.location.href = url;
    });
  });
}


/* ----------------------------------------------------------
   4) ค้นหาเมนูแบบ real-time
   ---------------------------------------------------------- */

function setupSearch() {
  const searchInput = document.getElementById("menuSearch");
  if (!searchInput) return;

  searchInput.addEventListener("input", event => {
    renderAdminMenus(event.target.value);
  });
}


/* ----------------------------------------------------------
   5) เริ่มทำงานเมื่อโหลดหน้าเสร็จ
   ---------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", () => {
  renderAdminMenus();
  setupSearch();
});










/* ===========================================
   adminDashboard.js
   path: /js/pages/dashboard/adminDashboard.js

   ใช้ table จริงจาก Supabase:
   - profiles  : id, username, display_name, role, status, area
   - shops     : id, sale_id, shop_code, shop_name, status
=========================================== */
/**
 * sidebar-header.js — Executive Layout Behaviors
 * ครอบคลุม: sidebar collapse/expand, header date, header user, logout
 * วิธีใช้: <script src="/js/core/sidebar-header.js"></script>
 *          เรียกใช้หลัง DOM โหลดเสร็จ (DOMContentLoaded)
 */

/* ════════════════════════════════════════════════════
   SIDEBAR TOGGLE
════════════════════════════════════════════════════ */

/**
 * สลับ collapsed / expanded ของ sidebar
 * อัปเดต margin-left ของ .app-main ตาม
 */
function toggleSidebar() {
  const sidebar = document.getElementById('appSidebar');
  const main    = document.querySelector('.app-main');
  if (!sidebar) return;

  const isCollapsed = sidebar.classList.contains('collapsed');

  if (isCollapsed) {
    // → ขยาย
    sidebar.classList.remove('collapsed');
    sidebar.classList.add('expanded');
    if (main) main.style.marginLeft = '220px';
  } else {
    // → ย่อ
    sidebar.classList.remove('expanded');
    sidebar.classList.add('collapsed');
    if (main) main.style.marginLeft = '';
  }
}

/**
 * ทำ nav item ตรงกับ URL ปัจจุบัน active อัตโนมัติ
 */
function setActiveNavItem() {
  const currentPath = window.location.pathname;
  document.querySelectorAll('.sidebar-nav-item').forEach(item => {
    const href = item.getAttribute('href') || '';
    if (href && currentPath.endsWith(href.split('/').pop())) {
      document.querySelectorAll('.sidebar-nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
    }
  });
}

/* ════════════════════════════════════════════════════
   HEADER — DATE
════════════════════════════════════════════════════ */

/**
 * แสดงวันที่ไทยใน element id="headerDateText"
 */
function updateHeaderDate() {
  const el = document.getElementById('headerDateText');
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleDateString('th-TH', {
    weekday: 'long',
    day:     'numeric',
    month:   'long',
    year:    'numeric',
  });
}

/* ════════════════════════════════════════════════════
   HEADER — USER (ต้องการ supabaseClient)
════════════════════════════════════════════════════ */

/**
 * โหลดชื่อผู้ใช้และแสดงใน header
 * ต้องมี supabaseClient ใน global scope แล้ว
 */
async function renderHeaderUser() {
  const nameEl   = document.getElementById('userName');
  const avatarEl = document.getElementById('userAvatar');
  if (!nameEl || !avatarEl) return;

  // รอ supabaseClient พร้อม (ไม่เกิน 5 วิ)
  let retries = 0;
  while (typeof supabaseClient === 'undefined' && retries < 50) {
    await new Promise(r => setTimeout(r, 100));
    retries++;
  }
  if (typeof supabaseClient === 'undefined') {
    nameEl.textContent = 'Executive';
    avatarEl.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;color:white;">person</span>';
    return;
  }

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const name =
      user?.user_metadata?.display_name ||
      user?.user_metadata?.full_name    ||
      user?.email?.split('@')[0]        ||
      'Executive';
    nameEl.textContent = name;
    // avatar แสดงตัวอักษรแรก
    avatarEl.innerHTML = '';
    avatarEl.textContent = name.charAt(0).toUpperCase();
  } catch (err) {
    console.warn('[Header] renderHeaderUser:', err);
    nameEl.textContent = 'Executive';
    avatarEl.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;color:white;">person</span>';
  }
}

/* ════════════════════════════════════════════════════
   LOGOUT
════════════════════════════════════════════════════ */

/**
 * ออกจากระบบ — sign out จาก Supabase แล้ว redirect ไปหน้า login
 * @param {string} [redirectTo='/index.html'] — URL ที่จะ redirect
 */
async function logout(redirectTo = '/index.html') {
  try {
    if (typeof supabaseClient !== 'undefined') {
      await supabaseClient.auth.signOut();
    }
  } catch (err) {
    console.warn('[Sidebar] logout error:', err);
  } finally {
    window.location.href = redirectTo;
  }
}

/* ════════════════════════════════════════════════════
   TOAST HELPER (global)
════════════════════════════════════════════════════ */

/**
 * แสดง toast notification
 * @param {string} message — ข้อความ
 * @param {'success'|'danger'|'info'|'warning'} [type='success']
 * @param {number} [duration=3000] — ms
 */
function showToast(message, type = 'success', duration = 3000) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  const colorMap = {
    success: '#10b981',
    danger:  '#ef4444',
    info:    '#3b82f6',
    warning: '#f59e0b',
  };

  toast.textContent = message;
  toast.style.background = colorMap[type] || colorMap.success;
  toast.classList.add('show');

  setTimeout(() => toast.classList.remove('show'), duration);
}

/* ════════════════════════════════════════════════════
   INIT — รวม init ทุกอย่างในที่เดียว
════════════════════════════════════════════════════ */

/**
 * เรียกฟังก์ชันนี้ใน DOMContentLoaded หรือ script inline
 * เพื่อ init sidebar + header ทั้งหมด
 */
function initExecutiveLayout() {
  // 1) Default sidebar: collapsed
  const sidebar = document.getElementById('appSidebar');
  if (sidebar && !sidebar.classList.contains('expanded')) {
    sidebar.classList.add('collapsed');
  }

  // 2) Active nav item
  setActiveNavItem();

  // 3) Header date
  updateHeaderDate();

  // 4) Header user (async)
  renderHeaderUser();

  // 5) Collapse toggle button
  const collapseBtn = document.querySelector('.sidebar-collapse-btn');
  if (collapseBtn && !collapseBtn.dataset.bound) {
    collapseBtn.dataset.bound = '1';
    collapseBtn.addEventListener('click', toggleSidebar);
  }

  // 6) Logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn && !logoutBtn.dataset.bound) {
    logoutBtn.dataset.bound = '1';
    logoutBtn.addEventListener('click', () => logout());
  }
}

// Auto-init เมื่อ DOM พร้อม
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initExecutiveLayout);
} else {
  initExecutiveLayout();
}

// ================= END TEMPLATE ================= //







/* ── ดึง supabase client instance (ไม่ใช่ library) ── */
function getSupabase() {
  return window.supabaseClient
      || window._supabase
      || null;
}

/* ── รอ Supabase พร้อม ── */
async function waitForSupabase(maxTries = 50) {
  for (let i = 0; i < maxTries; i++) {
    const db = getSupabase();
    if (db) return db;
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
}

/* ── Counter animation ── */
function animateCounter(el, target) {
  if (!el) return;
  const duration = 900;
  const start = performance.now();
  function step(now) {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(eased * target).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ── Role & Status helpers (ใช้ชื่อ ROLE_DISPLAY เพื่อไม่ซ้ำกับ roleConfig.js) ── */
const ROLE_DISPLAY = {
  user:      { label: 'User',    icon: '👤', cls: 'user'    },
  sales:     { label: 'Sales',   icon: '🏬', cls: 'sales'   },
  admin:     { label: 'Admin',   icon: '🛡️', cls: 'admin'   },
  adminqc:   { label: 'AdminQC', icon: '🛡️', cls: 'adminQc' },
  manager:   { label: 'Manager', icon: '⭐', cls: 'manager'  },
  executive: { label: 'Exec',    icon: '⭐', cls: 'exec'    },
};

function roleKey(role = '') {
  return role.toLowerCase().replace(/\s/g, '');
}

function roleBadgeHTML(role = '') {
  const r = ROLE_DISPLAY[roleKey(role)] || { label: role, icon: '👤', cls: 'user' };
  return `<span class="role-badge role-badge--${r.cls}">${r.icon} ${r.label}</span>`;
}

function statusBadgeHTML(status = '') {
  const isActive = status?.toLowerCase() === 'active';
  return `<span class="status-badge status-badge--${isActive ? 'active' : 'inactive'}">
    ${isActive ? '✅' : '🚫'} ${isActive ? 'Active' : 'Inactive'}
  </span>`;
}

/* ── Render Stats Cards & Role Chips ── */
function renderStats(profiles, shopCountBySaleId) {
  const total      = profiles.length;
  const active     = profiles.filter(u => u.status?.toLowerCase() === 'active').length;
  const inactive   = profiles.filter(u => u.status?.toLowerCase() !== 'active').length;
  const totalShops = Object.values(shopCountBySaleId).reduce((s, c) => s + c, 0);
  const totalSales = profiles.filter(u => roleKey(u.role) === 'sales').length;
  const totalAdmin = profiles.filter(u => ['admin','adminqc'].includes(roleKey(u.role))).length;

  console.log('[Dashboard] renderStats:', { total, active, inactive, totalShops, totalSales, totalAdmin });

  animateCounter(document.getElementById('statTotalUsers'),    total);
  animateCounter(document.getElementById('statActiveUsers'),   active);
  animateCounter(document.getElementById('statInactiveUsers'), inactive);
  animateCounter(document.getElementById('statTotalShops'),    totalShops);
  animateCounter(document.getElementById('statTotalSales'),    totalSales);
  animateCounter(document.getElementById('statTotalAdmin'),    totalAdmin);

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const countByRole = (r) => profiles.filter(u => roleKey(u.role) === r).length;
  set('chipAll',      total);
  set('chipAdmin',    countByRole('admin'));
  set('chipAdminQC',  countByRole('adminqc'));
  set('chipManager',  countByRole('manager'));
  set('chipExec',     countByRole('executive'));
  set('chipSales',    countByRole('sales'));
  set('chipUser',     countByRole('user'));
  set('chipInactive', inactive);
}

/* ── Render Recent Users Table ── */
function renderRecentUsers(profiles) {
  const tbody = document.getElementById('recentUsersBody');
  if (!tbody) return;
  if (!profiles.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="table-loading">ไม่มีข้อมูล</td></tr>`;
    return;
  }
  tbody.innerHTML = profiles.slice(0, 7).map(u => `
    <tr>
      <td>${u.display_name || u.username || '-'}</td>
      <td>${roleBadgeHTML(u.role)}</td>
      <td>${statusBadgeHTML(u.status)}</td>
    </tr>
  `).join('');
}

/* ── Render Sales Table ── */
function renderSalesTable(salesProfiles, shopCountBySaleId) {
  const tbody = document.getElementById('salesBody');
  if (!tbody) return;
  if (!salesProfiles.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="table-loading">ไม่มีข้อมูล</td></tr>`;
    return;
  }
  tbody.innerHTML = salesProfiles.map(s => `
    <tr>
      <td><span class="username-badge">${s.username || '-'}</span></td>
      <td><strong>${s.display_name || '-'}</strong></td>
      <td>
        <span class="area-badge">
          ${s.area || '-'}
        </span>
      </td>
      <td style="font-weight:700;color:#1a73e8;">🏪 ${(shopCountBySaleId[s.id] || 0).toLocaleString()} ร้าน</td>
    </tr>
  `).join('');
}

/* ── Render Shop Info Box ── */
function renderShopInfo(salesProfiles, shopCountBySaleId) {
  const box = document.getElementById('shopInfoBox');
  if (!box) return;
  if (!salesProfiles.length) {
    box.innerHTML = `<div class="table-loading">ไม่มีข้อมูล</div>`;
    return;
  }
  box.innerHTML = salesProfiles.map(s => `
    <div class="shop-info-row">
      <span class="shop-label">${s.username || '-'}</span>
      <span class="shop-area">${s.area || '-'}</span>
      <span class="shop-count">🏪 ${(shopCountBySaleId[s.id] || 0).toLocaleString()} ร้าน</span>
    </div>
  `).join('');
}

/* ── Main ── */
async function loadDashboardData() {
  const db = getSupabase();
  if (!db) {
    console.error('[Dashboard] ไม่พบ supabase client instance');
    return;
  }

  console.log('[Dashboard] กำลังโหลดข้อมูล...');

  try {
    // ── ดึง profiles และ shops พร้อมกัน
    const [profilesRes, shopsRes] = await Promise.all([
      db.from('profiles')
        .select('id, username, display_name, role, status, area')
        .order('created_at', { ascending: false }),
      db.from('shops')
        .select('id, sale_id')
    ]);

    console.log('[Dashboard] profilesRes:', profilesRes);
    console.log('[Dashboard] shopsRes:', shopsRes);

    if (profilesRes.error) {
      console.error('[Dashboard] profiles error:', profilesRes.error);
      throw profilesRes.error;
    }
    if (shopsRes.error) {
      console.error('[Dashboard] shops error:', shopsRes.error);
      throw shopsRes.error;
    }

    const profiles = profilesRes.data || [];
    const shops    = shopsRes.data    || [];

    console.log('[Dashboard] profiles count:', profiles.length);
    console.log('[Dashboard] shops count:', shops.length);

    // ── นับ shop ต่อ sale
    const shopCountBySaleId = {};
    shops.forEach(shop => {
      if (shop.sale_id) {
        shopCountBySaleId[shop.sale_id] = (shopCountBySaleId[shop.sale_id] || 0) + 1;
      }
    });

    const salesProfiles = profiles.filter(u => roleKey(u.role) === 'sales');
    console.log('[Dashboard] salesProfiles count:', salesProfiles.length);

    // ── Render
    renderStats(profiles, shopCountBySaleId);
    renderRecentUsers(profiles);
    renderSalesTable(salesProfiles, shopCountBySaleId);
    renderShopInfo(salesProfiles, shopCountBySaleId);

    console.log('[Dashboard] โหลดข้อมูลสำเร็จ');

  } catch (err) {
    console.error('[Dashboard] loadDashboardData error:', err);
    const el1 = document.getElementById('recentUsersBody');
    const el2 = document.getElementById('salesBody');
    const el3 = document.getElementById('shopInfoBox');
    if (el1) el1.innerHTML = `<tr><td colspan="3" class="table-loading" style="color:#dc2626;">โหลดข้อมูลไม่สำเร็จ: ${err.message || err}</td></tr>`;
    if (el2) el2.innerHTML = `<tr><td colspan="4" class="table-loading" style="color:#dc2626;">โหลดข้อมูลไม่สำเร็จ</td></tr>`;
    if (el3) el3.innerHTML = `<div class="table-loading" style="color:#dc2626;">โหลดข้อมูลไม่สำเร็จ</div>`;
  }
}

/* ── โหลดข้อมูล user ปัจจุบัน (fallback ถ้าไม่มี userService) ── */
async function loadCurrentUserFallback() {
  const db = getSupabase();
  if (!db) return null;

  try {
    const { data: { user }, error } = await db.auth.getUser();
    if (error || !user) {
      console.warn('[Dashboard] ไม่พบ user session');
      return null;
    }

    // ดึง profile จาก profiles table
    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('id, username, display_name, role, status')
      .eq('id', user.id)
      .single();

    if (profileError) {
      console.warn('[Dashboard] ไม่พบ profile:', profileError);
      return { ...user, display_name: user.email };
    }

    return profile;
  } catch (err) {
    console.error('[Dashboard] loadCurrentUserFallback error:', err);
    return null;
  }
}

/* ── Init ── */
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Dashboard] DOMContentLoaded');

  const db = await waitForSupabase();
  if (!db) {
    console.error('[Dashboard] Supabase ไม่พร้อมหลังรอ 5 วินาที');
    document.getElementById('userName').textContent = 'ไม่พบ Supabase';
    return;
  }

  console.log('[Dashboard] Supabase พร้อมแล้ว');

  // ตรวจสอบว่า loadCurrentUser มีหรือไม่
  const hasUserService = typeof loadCurrentUser === 'function' && typeof updateUserNameDisplay === 'function';
  console.log('[Dashboard] hasUserService:', hasUserService);

  try {
    if (hasUserService) {
      // ใช้ userService.js
      await Promise.all([
        loadCurrentUser().then(() => {
          updateUserNameDisplay('#userName');
        }),
        loadDashboardData()
      ]);
    } else {
      // fallback: โหลด user เอง
      const [currentUser] = await Promise.all([
        loadCurrentUserFallback(),
        loadDashboardData()
      ]);

      // แสดงชื่อ user
      const userNameEl = document.getElementById('userName');
      if (userNameEl && currentUser) {
        userNameEl.textContent = currentUser.display_name || currentUser.username || currentUser.email || '-';
      } else if (userNameEl) {
        userNameEl.textContent = 'ไม่พบข้อมูลผู้ใช้';
      }
    }
  } catch (err) {
    console.error('[Dashboard] Init error:', err);
  }

  // logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      const db = getSupabase();
      if (db) {
        await db.auth.signOut();
      }
      window.location.href = '/pages/auth/login.html';
    });
  }

  // ── Loading popup สำหรับลิงก์นำทาง (เช็คว่ามี LoadingPopup หรือไม่)
  if (typeof LoadingPopup !== 'undefined' && LoadingPopup.show) {
    document.querySelectorAll('a[href]').forEach(link => {
      const href = link.getAttribute('href');
      if (!href || href === '#') return;
      link.addEventListener('click', (e) => {
        e.preventDefault();
        LoadingPopup.show('กำลังโหลด...');
        setTimeout(() => { window.location.href = href; }, 150);
      });
    });
  }
});