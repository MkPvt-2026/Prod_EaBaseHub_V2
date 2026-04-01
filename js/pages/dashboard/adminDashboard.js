/* ===========================================
   adminDashboard.js
   path: /js/pages/dashboard/adminDashboard.js

   ใช้ table จริงจาก Supabase:
   - profiles  : id, username, display_name, role, status, area
   - shops     : id, sale_id, shop_code, shop_name, status
=========================================== */


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

<<<<<<< HEAD
/* ── Role & Status helpers ── */
const ROLE_CONFIG = {
=======
/* ── Role & Status helpers (ใช้ชื่อ ROLE_DISPLAY เพื่อไม่ซ้ำกับ roleConfig.js) ── */
const ROLE_DISPLAY = {
>>>>>>> 6a6183de9074f71dfaeeaf6728915012883bba86
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
<<<<<<< HEAD
  const r = ROLE_CONFIG[roleKey(role)] || { label: role, icon: '👤', cls: 'user' };
=======
  const r = ROLE_DISPLAY[roleKey(role)] || { label: role, icon: '👤', cls: 'user' };
>>>>>>> 6a6183de9074f71dfaeeaf6728915012883bba86
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
<<<<<<< HEAD
  const totalAdmin = profiles.filter(u => ['admin','adminQc'].includes(roleKey(u.role))).length;
=======
  const totalAdmin = profiles.filter(u => ['admin','adminqc'].includes(roleKey(u.role))).length;

  console.log('[Dashboard] renderStats:', { total, active, inactive, totalShops, totalSales, totalAdmin });
>>>>>>> 6a6183de9074f71dfaeeaf6728915012883bba86

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
        <span style="background:#e8f0fe;color:#1a73e8;border-radius:6px;padding:2px 10px;font-size:0.75rem;font-weight:600;">
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

<<<<<<< HEAD
=======
  console.log('[Dashboard] กำลังโหลดข้อมูล...');

>>>>>>> 6a6183de9074f71dfaeeaf6728915012883bba86
  try {
    // ── ดึง profiles และ shops พร้อมกัน
    const [profilesRes, shopsRes] = await Promise.all([
      db.from('profiles')
        .select('id, username, display_name, role, status, area')
        .order('created_at', { ascending: false }),
      db.from('shops')
        .select('id, sale_id')
    ]);

<<<<<<< HEAD
    if (profilesRes.error) throw profilesRes.error;
    if (shopsRes.error)    throw shopsRes.error;
=======
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
>>>>>>> 6a6183de9074f71dfaeeaf6728915012883bba86

    const profiles = profilesRes.data || [];
    const shops    = shopsRes.data    || [];

<<<<<<< HEAD
=======
    console.log('[Dashboard] profiles count:', profiles.length);
    console.log('[Dashboard] shops count:', shops.length);

>>>>>>> 6a6183de9074f71dfaeeaf6728915012883bba86
    // ── นับ shop ต่อ sale
    const shopCountBySaleId = {};
    shops.forEach(shop => {
      if (shop.sale_id) {
        shopCountBySaleId[shop.sale_id] = (shopCountBySaleId[shop.sale_id] || 0) + 1;
      }
    });

    const salesProfiles = profiles.filter(u => roleKey(u.role) === 'sales');
<<<<<<< HEAD
=======
    console.log('[Dashboard] salesProfiles count:', salesProfiles.length);
>>>>>>> 6a6183de9074f71dfaeeaf6728915012883bba86

    // ── Render
    renderStats(profiles, shopCountBySaleId);
    renderRecentUsers(profiles);
    renderSalesTable(salesProfiles, shopCountBySaleId);
    renderShopInfo(salesProfiles, shopCountBySaleId);

<<<<<<< HEAD
=======
    console.log('[Dashboard] โหลดข้อมูลสำเร็จ');

>>>>>>> 6a6183de9074f71dfaeeaf6728915012883bba86
  } catch (err) {
    console.error('[Dashboard] loadDashboardData error:', err);
    const el1 = document.getElementById('recentUsersBody');
    const el2 = document.getElementById('salesBody');
    const el3 = document.getElementById('shopInfoBox');
<<<<<<< HEAD
    if (el1) el1.innerHTML = `<tr><td colspan="3" class="table-loading" style="color:#dc2626;">โหลดข้อมูลไม่สำเร็จ</td></tr>`;
=======
    if (el1) el1.innerHTML = `<tr><td colspan="3" class="table-loading" style="color:#dc2626;">โหลดข้อมูลไม่สำเร็จ: ${err.message || err}</td></tr>`;
>>>>>>> 6a6183de9074f71dfaeeaf6728915012883bba86
    if (el2) el2.innerHTML = `<tr><td colspan="4" class="table-loading" style="color:#dc2626;">โหลดข้อมูลไม่สำเร็จ</td></tr>`;
    if (el3) el3.innerHTML = `<div class="table-loading" style="color:#dc2626;">โหลดข้อมูลไม่สำเร็จ</div>`;
  }
}

<<<<<<< HEAD
/* ── Init ── */
document.addEventListener('DOMContentLoaded', async () => {
  const db = await waitForSupabase();
  if (!db) {
    console.error('[Dashboard] Supabase ไม่พร้อมหลังรอ 5 วินาที');
    return;
  }

  // โหลด user และ dashboard พร้อมกัน
  await Promise.all([
    loadCurrentUser().then(() => {
      updateUserNameDisplay('#userName');   // แสดงชื่อใน header
    }),
    loadDashboardData()
  ]);
=======
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
>>>>>>> 6a6183de9074f71dfaeeaf6728915012883bba86

  // logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
<<<<<<< HEAD
      await supabaseClient.auth.signOut();
=======
      const db = getSupabase();
      if (db) {
        await db.auth.signOut();
      }
>>>>>>> 6a6183de9074f71dfaeeaf6728915012883bba86
      window.location.href = '/pages/auth/login.html';
    });
  }

<<<<<<< HEAD
  // ── Loading popup สำหรับลิงก์นำทาง ← เพิ่มตรงนี้
  document.querySelectorAll('a[href]').forEach(link => {
    const href = link.getAttribute('href');
    if (!href || href === '#') return; // ข้าม href="#"
    link.addEventListener('click', (e) => {
      e.preventDefault();
      LoadingPopup.show('กำลังโหลด...');
      setTimeout(() => { window.location.href = href; }, 150);
    });
  });
=======
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
>>>>>>> 6a6183de9074f71dfaeeaf6728915012883bba86
});