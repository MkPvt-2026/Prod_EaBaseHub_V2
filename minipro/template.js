// ============================================================
// executive-Dashboard.js — Base Template Script
// ────────────────────────────────────────────────────────────
// ✅ Sidebar toggle + mobile overlay close
// ✅ User profile loader (Supabase)
// ✅ Calendar widget
// ✅ Current date chip
// ✅ Toast helper
// ✅ Logout
// ✅ Avatar upload preview
// ============================================================

/* =================================================
   ⏳ Wait for Supabase
================================================= */
async function waitForSupabase(maxMs = 5000) {
  const start = Date.now();
  while (typeof supabaseClient === 'undefined') {
    if (Date.now() - start > maxMs) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
}

/* =================================================
   🚀 INIT
================================================= */
let _calendarDate = new Date();

document.addEventListener('DOMContentLoaded', async () => {
  // วันที่ปัจจุบัน
  setCurrentDate();

  // รอ Supabase
  const ready = await waitForSupabase();
  if (!ready) {
    console.warn('⚠️ Supabase ไม่พร้อม');
    return;
  }

  // ป้องกัน role (แก้ไข roles ตามต้องการ)
  if (typeof protectPage === 'function') {
    await protectPage(['admin', 'adminQc', 'manager', 'executive']);
  }

  // โหลด profile + calendar
  await loadUserProfile();
  initAvatarUpload();
  renderCalendar();

  // ─── เพิ่ม page-specific init ที่นี่ ───
  // await loadPageData();
  // ────────────────────────────────────────
});

/* =================================================
   📅 Set Current Date Chip
================================================= */
function setCurrentDate() {
  const el = document.getElementById('currentDate');
  if (!el) return;
  el.textContent = new Date().toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'long',
    day: '2-digit',
    timeZone: 'Asia/Bangkok',
  });
}

/* =================================================
   👤 Load User Profile
================================================= */
async function loadUserProfile() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      window.location.href = '/pages/auth/login.html';
      return;
    }

    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('display_name, username, role, avatar_url')
      .eq('id', session.user.id)
      .single();

    const fullName = profile?.display_name || profile?.username || session.user.email;

    const displayNameEl = document.getElementById('displayName');
    const userEmailEl   = document.getElementById('userEmail');
    const userRoleEl    = document.getElementById('userRole');
    const profileImg    = document.getElementById('profileImage');

    if (displayNameEl) displayNameEl.textContent = fullName;
    if (userEmailEl)   userEmailEl.textContent   = session.user.email;
    if (userRoleEl)    userRoleEl.textContent     = profile?.role || 'QC Admin';
    if (profileImg && profile?.avatar_url) profileImg.src = profile.avatar_url;

    window.currentUser = {
      id:           session.user.id,
      email:        session.user.email,
      role:         profile?.role || 'adminQc',
      display_name: fullName,
    };
  } catch (err) {
    console.error('โหลด profile ไม่สำเร็จ:', err);
  }
}

/* =================================================
   📷 Avatar Upload Preview
================================================= */
function initAvatarUpload() {
  const wrapper = document.querySelector('.avatar-wrapper');
  const input   = document.getElementById('uploadAvatar');
  const img     = document.getElementById('profileImage');

  if (!wrapper || !input || !img) return;

  wrapper.addEventListener('click', () => input.click());
  input.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.readAsDataURL(file);
  });
}

/* =================================================
   📆 CALENDAR
================================================= */
function renderCalendar() {
  const title = document.getElementById('calendarTitle');
  const grid  = document.getElementById('calendarGrid');
  if (!title || !grid) return;

  const year  = _calendarDate.getFullYear();
  const month = _calendarDate.getMonth();

  title.textContent = _calendarDate.toLocaleDateString('th-TH', {
    month: 'long',
    year:  'numeric',
  });

  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today       = new Date();

  let html = '';
  ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].forEach((d) => {
    html += `<div class="calendar-day-name">${d}</div>`;
  });

  for (let i = 0; i < firstDay; i++) html += '<div class="calendar-day empty"></div>';

  for (let day = 1; day <= daysInMonth; day++) {
    const isToday =
      day === today.getDate() &&
      month === today.getMonth() &&
      year === today.getFullYear();
    html += `<div class="calendar-day ${isToday ? 'today' : ''}">${day}</div>`;
  }

  grid.innerHTML = html;
}

function prevMonth() {
  _calendarDate.setMonth(_calendarDate.getMonth() - 1);
  renderCalendar();
}

function nextMonth() {
  _calendarDate.setMonth(_calendarDate.getMonth() + 1);
  renderCalendar();
}

/* =================================================
   🔲 SIDEBAR
================================================= */
function toggleEaSidebar() {
  document.body.classList.toggle('sidebar-expanded');
}

// ปิด sidebar ถ้าคลิกนอกพื้นที่ (mobile)
document.addEventListener('click', (e) => {
  const sidebar = document.getElementById('eaSidebar');
  if (
    window.innerWidth <= 768 &&
    document.body.classList.contains('sidebar-expanded') &&
    sidebar &&
    !sidebar.contains(e.target)
  ) {
    document.body.classList.remove('sidebar-expanded');
  }
});

/* =================================================
   🔔 TOAST HELPER
================================================= */
function showToast(message, duration = 3500) {
  const div = document.createElement('div');
  div.className = 'page-toast';
  div.textContent = message;
  document.body.appendChild(div);

  requestAnimationFrame(() => div.classList.add('show'));
  setTimeout(() => {
    div.classList.remove('show');
    setTimeout(() => div.remove(), 300);
  }, duration);
}

/* =================================================
   🚪 LOGOUT
================================================= */
async function logout() {
  try {
    if (typeof supabaseClient !== 'undefined') {
      await supabaseClient.auth.signOut();
    }
  } catch (err) {
    console.error('logout error:', err);
  } finally {
    window.location.href = '/pages/auth/login.html';
  }
}

/* =================================================
   🛠 UTILITIES
================================================= */

/** แปลง value → วันที่ภาษาไทย */
function formatDateTH(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('th-TH', {
    day:   '2-digit',
    month: 'short',
    year:  '2-digit',
  });
}

/** Escape HTML เพื่อป้องกัน XSS */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Safe JSON parse → array */
function safeParseArray(value) {
  try {
    const p = JSON.parse(value);
    return Array.isArray(p) ? p : [];
  } catch (_) {
    return String(value).split(',').map((s) => s.trim()).filter(Boolean);
  }
}