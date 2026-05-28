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
const APP_CONFIG = {
  loginPath: '/pages/auth/login.html',
};
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

  await initNotificationWidget();

  // ✅ เพิ่มบรรทัดนี้ — ต้องรอ loadUserProfile ก่อนเพื่อให้ window.currentUser พร้อม
  if (typeof AnnouncementsModule !== 'undefined') {
    await AnnouncementsModule.init(window.currentUser);
  }

   // ✅ เพิ่มตรงนี้
  await loadSummaryCards();
  subscribeRealtimeSummary();
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
      window.location.href = APP_CONFIG.loginPath;
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
    window.location.href = APP_CONFIG.loginPath;
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




// =================================================
// 🔔 NOTIFICATION WIDGET
// =================================================
async function initNotificationWidget() {
  const root = document.getElementById('notifWidgetRoot');
  if (!root) return;

  root.innerHTML = '<div class="nw-skeleton"></div>';

  const { data: { session } } = await supabaseClient.auth.getSession();

  if (!session?.user) {
    root.innerHTML = '<div class="nw-error">⚠️ กรุณาเข้าสู่ระบบ</div>';
    return;
  }

  const user = session.user;

  root.innerHTML = `
    <div class="nw">
      <a class="nw-link" href="/pages/dashboard/messages-New.html">
        <div class="nw-card no-new" id="nwCard">
          <div class="nw-dot"></div>

          <div class="nw-icon-wrap">
            <div class="nw-icon-bg">
              <span class="material-symbols-outlined">notifications</span>
            </div>
            <div class="nw-badge" id="nwBadge" hidden>0</div>
          </div>

          <div class="nw-text">
            <div class="nw-title" id="nwTitle">ข้อความแจ้งเตือน</div>
            <div class="nw-sub" id="nwSub">กำลังโหลด…</div>
          </div>

          <div class="nw-arrow">›</div>
        </div>
      </a>
    </div>
  `;

  async function refreshNotificationWidget() {
    try {
      const { data: all, error: e1 } = await supabaseClient
        .from('announcements')
        .select('id')
        .eq('status', 'published');

      if (e1) throw e1;

      const { data: read, error: e2 } = await supabaseClient
        .from('announcement_reads')
        .select('announcement_id')
        .eq('user_id', user.id);

      if (e2) throw e2;

      const readIds = new Set((read || []).map((r) => r.announcement_id));
      const unread = (all || []).filter((a) => !readIds.has(a.id)).length;

      updateNotificationCard(unread);
    } catch (err) {
      console.error('[Notification Widget] refresh error:', err);
      const sub = document.getElementById('nwSub');
      if (sub) sub.textContent = 'โหลดแจ้งเตือนไม่สำเร็จ';
    }
  }

  function updateNotificationCard(unread) {
    const card = document.getElementById('nwCard');
    const badge = document.getElementById('nwBadge');
    const title = document.getElementById('nwTitle');
    const sub = document.getElementById('nwSub');

    if (!card || !badge || !title || !sub) return;

    if (unread > 0) {
      card.classList.remove('no-new');
      card.classList.add('has-new');

      badge.textContent = unread > 99 ? '99+' : unread;
      badge.hidden = false;

      title.textContent = 'มีข้อความใหม่';
      sub.textContent = `${unread} ข้อความที่ยังไม่ได้อ่าน`;
    } else {
      card.classList.remove('has-new');
      card.classList.add('no-new');

      badge.hidden = true;

      title.textContent = 'ข้อความแจ้งเตือน';
      sub.textContent = 'ไม่มีข้อความใหม่';
    }
  }

  await refreshNotificationWidget();

  supabaseClient
    .channel(`notification-widget-${user.id}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'announcements' },
      refreshNotificationWidget
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'announcement_reads',
        filter: `user_id=eq.${user.id}`,
      },
      refreshNotificationWidget
    )
    .subscribe();
}



/* =================================================
   📊 SUMMARY CARDS — Pending Approvals & New Reports
================================================= */
async function loadSummaryCards() {
  try {
    // ─── Card 1: รออนุมัติ — นับจาก approval_requests ทั้งหมด ไม่กรองสัปดาห์ ───
    const { data: pending } = await supabaseClient
      .from('approval_requests')
      .select('id')
      .eq('request_status', 'pending');

    const pendingCount = pending?.length ?? 0;
    const elWaiting = document.getElementById('sumWaiting');
    if (elWaiting) elWaiting.textContent = pendingCount;

    const card1 = document.getElementById('cardPending');
    if (card1) card1.classList.toggle('card-pulse', pendingCount > 0);

    // ─── Card 2: รายงานใหม่ — นับ reports สัปดาห์นี้ที่ยังไม่อ่าน ───
    const today = new Date();
    const dayOfWeek = today.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diff);
    monday.setHours(0, 0, 0, 0);

    const { data: newReports } = await supabaseClient
      .from('reports')
      .select('id')
      .eq('manager_acknowledged', false)
      .gte('submitted_at', monday.toISOString());

    const newReportCount = newReports?.length ?? 0;
    const elReport = document.getElementById('sumExecApproved');
    if (elReport) elReport.textContent = newReportCount;

    const card2 = document.getElementById('cardNewReport');
    if (card2) card2.classList.toggle('card-pulse', newReportCount > 0);

  } catch (err) {
    console.error('[loadSummaryCards] error:', err);
  }
}

/* =================================================
   🔴 Realtime — subscribe ทั้ง claims + reports
================================================= */
function subscribeRealtimeSummary() {
  supabaseClient
    .channel('exec-summary-realtime')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'approval_requests' },
      async () => await loadSummaryCards()
    )
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'reports' },
      async () => await loadSummaryCards()
    )
    .subscribe();
}















