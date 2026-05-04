// ============================================================
// QcDashboard.js (V2 — Hybrid Layout)
// ────────────────────────────────────────────────────────────
// รวม:
//   1) ตรรกะ Dashboard เดิม (KPI, charts, table)
//   2) helpers จาก index.js ที่ใช้กับ right-panel
//      (profile, avatar upload, calendar, sidebar)
// ============================================================

/* =================================================
   🎨 Chart Color Palette
================================================= */
const CHART_COLORS = {
  pass:        '#10b981',
  fail:        '#ef4444',
  pending:     '#f59e0b',
  donutBorder: '#ffffff',
  axis:        '#6b7280',
  grid:        'rgba(0, 0, 0, 0.05)',
  tooltipBg:   '#1f2937',
  tooltipText: '#f9fafb',
  tooltipDim:  '#9ca3af',
};

/* =================================================
   🔧 Global State
================================================= */
let allClaims = [];
let currentDate = new Date();

/* =================================================
   ⏳ Wait for Supabase
================================================= */
async function waitForSupabase(maxMs = 5000) {
  const start = Date.now();
  while (typeof supabaseClient === 'undefined') {
    if (Date.now() - start > maxMs) return false;
    await new Promise(r => setTimeout(r, 100));
  }
  return true;
}

/* =================================================
   🚀 INIT
================================================= */
document.addEventListener('DOMContentLoaded', async () => {
  setCurrentDate();

  const ready = await waitForSupabase();
  if (!ready) { showLoadingError(); return; }

  // ตรวจสิทธิ์
  if (typeof protectPage === 'function') {
    await protectPage(['admin', 'adminQc', 'manager', 'executive']);
  }

  // โหลด session + profile (สำหรับ right-panel)
  await loadUserProfile();

  // Avatar upload
  initAvatarUpload();

  // Calendar
  renderCalendar();

  // โหลดข้อมูล Dashboard
  await loadDashboardData();

  setupClaimsRealtime();   // ← เปิด realtime subscription

  // Filter
  const filterEl = document.getElementById('filterStatus');
  if (filterEl) filterEl.addEventListener('change', filterTable);
});

/* =================================================
   📅 Set Current Date Chip
================================================= */
function setCurrentDate() {
  const el = document.getElementById('currentDate');
  if (!el) return;
  el.textContent = new Date().toLocaleDateString('th-TH', {
    year: 'numeric', month: 'long', day: '2-digit',
    timeZone: 'Asia/Bangkok'
  });
}

/* =================================================
   👤 Load User Profile (Right Panel)
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

    // ใส่ค่าใน UI
    const displayNameEl = document.getElementById('displayName');
    const userEmailEl   = document.getElementById('userEmail');
    const userRoleEl    = document.getElementById('userRole');
    const profileImg    = document.getElementById('profileImage');

    if (displayNameEl) displayNameEl.textContent = fullName;
    if (userEmailEl)   userEmailEl.textContent   = session.user.email;
    if (userRoleEl)    userRoleEl.textContent    = profile?.role || 'QC Admin';
    if (profileImg && profile?.avatar_url) profileImg.src = profile.avatar_url;

    window.currentUser = {
      id: session.user.id,
      email: session.user.email,
      role: profile?.role || 'adminQc',
      display_name: fullName,
    };
  } catch (err) {
    console.error('โหลด profile ไม่สำเร็จ:', err);
  }
}

/* =================================================
   📊 Load Dashboard Data
================================================= */
async function loadDashboardData() {
  try {
    showSkeletons();

    const { data, error } = await supabaseClient
      .from('claims')
      .select('id,status,claim_date,created_at,emp_name,area,customer,product,qty,claim_types,detail,media_urls,qc_comment')
      .in('status', ['submitted', 'approved', 'rejected'])
      .order('created_at', { ascending: false });

    if (error) throw error;
    allClaims = data || [];

    renderKPICards(allClaims);
    renderPassFailPie(allClaims);
    renderRecentClaims(allClaims);
    renderTable(allClaims);
    renderClaimSummary(allClaims);
    renderTrendChart(allClaims);
    renderTopProductsChart(allClaims);
    renderMiniStats(allClaims);
  } catch (err) {
    console.error(err);
    showLoadingError();
  }
}

// ============================================================
// PATCH: KPI Cards (V3.1 — Self-contained, รวม setKPI)
// ────────────────────────────────────────────────────────────
// แทนที่บล็อก renderKPICards + setKPI เดิมในไฟล์ QcDashboard.js
// (snippet นี้รวม setKPI ไว้ด้วยแล้ว ไม่ต้องพึ่งของเดิม)
// อย่าลืมเพิ่ม setupClaimsRealtime(); ใน init() ด้วย
// ============================================================

/* =================================================
   📊 KPI CARDS — V3.1
================================================= */
function renderKPICards(claims) {
  // ── นับเฉพาะเดือนนี้ ──
  const now = new Date();
  const thisYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthly = claims.filter(c =>
    (c.claim_date || c.created_at || '').startsWith(thisYM)
  );

  // ── นับสถานะ (ใช้ทั้งหมด ไม่เฉพาะเดือน) ──
  const totalMonth = monthly.length;
  const approved   = claims.filter(c => c.status === 'approved').length;
  const inProgress = claims.filter(c => c.status === 'in_progress' || c.status === 'reviewing').length;
  const newPending = claims.filter(c => c.status === 'submitted').length;

  // ── คำนวณอัตรา ──
  const approveRate = totalMonth > 0 ? Math.round(approved / totalMonth * 100) : 0;

  // ── set ค่า KPI ──
  setKPI('kpi-total',   totalMonth, 'ทั้งหมดในเดือนนี้');
  setKPI('kpi-fail',    inProgress, 'รายการที่กำลังตรวจสอบ', 'fail');
  setKPI('kpi-pass',    approved,   `${approveRate}% อัตราอนุมัติ`, 'pass');
  setKPI('kpi-pending', newPending, newPending > 0 ? `มี ${newPending} เคลมรอตรวจ` : 'ไม่มีเคลมใหม่', 'warn');

  // ── 🔔 จัดการ alert mode ──
  toggleNewClaimAlert(newPending);
}

/* =================================================
   🛠️ setKPI — helper ใส่ค่าเข้าใบ KPI
   รองรับทั้ง a.qc-kpi-card และ div.qc-kpi-card
================================================= */
function setKPI(id, value, subText, colorClass) {
  const card = document.getElementById(id);
  if (!card) return;

  const valEl = card.querySelector('.qc-kpi-val');
  const subEl = card.querySelector('.qc-kpi-sub');

  if (valEl) {
    const num = (typeof value === 'number') ? value : 0;
    valEl.textContent = num.toLocaleString();
    valEl.className = 'qc-kpi-val';
    if (colorClass) valEl.classList.add(colorClass);
  }

  if (subEl && subText != null) subEl.textContent = subText;
}

/* =================================================
   🔔 TOGGLE ALERT — เปิด/ปิดกระพริบ + badge
================================================= */
function toggleNewClaimAlert(count) {
  const card  = document.getElementById('kpi-pending');
  const badge = document.getElementById('kpiPendingBadge');
  if (!card) return;

  if (count > 0) {
    card.classList.add('qc-has-new');
    if (badge) {
      badge.hidden = false;
      badge.textContent = count > 99 ? '99+' : count;
    }
    updateDocumentTitleAlert(count);
  } else {
    card.classList.remove('qc-has-new');
    if (badge) {
      badge.hidden = true;
      badge.textContent = '0';
    }
    updateDocumentTitleAlert(0);
  }
}

/* =================================================
   🏷️ Document title — โชว์จำนวนเคลมใหม่ใน tab
================================================= */
function updateDocumentTitleAlert(count) {
  const baseTitle = 'QC Dashboard - EABaseHub';
  document.title = count > 0 ? `(${count}) 🔔 ${baseTitle}` : baseTitle;
}

/* =================================================
   📡 REALTIME — sub claim ใหม่/อัปเดต
   เรียกใน init() หลัง loadDashboardData() สำเร็จ:
       setupClaimsRealtime();
================================================= */
function setupClaimsRealtime() {
  if (typeof supabaseClient === 'undefined') return;

  let isFirstLoad = true;

  supabaseClient
    .channel('qc-dashboard-claims')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'claims' },
      async (payload) => {
        await loadDashboardData();
        if (!isFirstLoad && payload.new?.status === 'submitted') {
          playAlertSound();
          showQcToast(`🔔 เคลมใหม่: ${payload.new.product || 'ไม่ระบุชื่อสินค้า'}`);
        }
      }
    )
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'claims' },
      async () => { await loadDashboardData(); }
    )
    .on('postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'claims' },
      async () => { await loadDashboardData(); }
    )
    .subscribe(() => {
      setTimeout(() => { isFirstLoad = false; }, 2000);
    });
}

/* =================================================
   🔊 Alert Sound
================================================= */
function playAlertSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx  = new AudioContext();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.10, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    osc.stop(ctx.currentTime + 0.25);
  } catch (_) { /* silent */ }
}

/* =================================================
   📣 Mini Toast
================================================= */
function showQcToast(message) {
  const div = document.createElement('div');
  div.textContent = message;
  Object.assign(div.style, {
    position: 'fixed',
    top: '20px',
    right: '20px',
    background: '#1f2937',
    color: '#fff',
    padding: '10px 18px',
    borderRadius: '12px',
    fontSize: '13px',
    fontFamily: "'Kanit', sans-serif",
    zIndex: '9999',
    boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
    transform: 'translateX(120%)',
    transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
  });
  document.body.appendChild(div);
  requestAnimationFrame(() => { div.style.transform = 'translateX(0)'; });
  setTimeout(() => {
    div.style.transform = 'translateX(120%)';
    setTimeout(() => div.remove(), 300);
  }, 3500);
}
/* =================================================
   🍩 PASS / FAIL DONUT
================================================= */
function renderPassFailPie(claims) {
  const total    = claims.length;
  const approved = claims.filter(c => c.status === 'approved').length;
  const rejected = claims.filter(c => c.status === 'rejected').length;
  const pending  = claims.filter(c => c.status === 'submitted').length;

  const pPass = total > 0 ? Math.round(approved / total * 100) : 0;
  const pFail = total > 0 ? Math.round(rejected / total * 100) : 0;
  const pPend = 100 - pPass - pFail;

  const centerEl = document.getElementById('pieCenterNum');
  if (centerEl) centerEl.textContent = total;

  if (window._pfChart) window._pfChart.destroy();
  const canvas = document.getElementById('pfPieChart');
  if (!canvas || typeof Chart === 'undefined') return;

  window._pfChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Pass', 'Fail', 'รอตรวจ'],
      datasets: [{
        data: [approved, rejected, pending],
        backgroundColor: [CHART_COLORS.pass, CHART_COLORS.fail, CHART_COLORS.pending],
        borderColor: CHART_COLORS.donutBorder,
        borderWidth: 3,
        hoverOffset: 8,
        hoverBorderWidth: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: CHART_COLORS.tooltipBg,
          titleColor: CHART_COLORS.tooltipDim,
          bodyColor:  CHART_COLORS.tooltipText,
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: ctx => {
              const pct = total > 0 ? Math.round(ctx.parsed / total * 100) : 0;
              return ` ${ctx.label}: ${ctx.parsed} ราย (${pct}%)`;
            }
          }
        }
      },
    },
  });

  // Legend (ใช้ class .qc-*)
  const legend = document.getElementById('pfLegend');
  if (legend) {
    legend.innerHTML = [
      { cls: 'qc-dot-pass', label: 'Pass',   count: approved, pct: pPass, color: CHART_COLORS.pass },
      { cls: 'qc-dot-fail', label: 'Fail',   count: rejected, pct: pFail, color: CHART_COLORS.fail },
      { cls: 'qc-dot-pend', label: 'รอตรวจ', count: pending,  pct: pPend, color: CHART_COLORS.pending },
    ].map(item => `
      <div class="qc-legend-item">
        <div class="qc-legend-left">
          <span class="qc-dot ${item.cls}"></span>
          <span class="qc-legend-label">${item.label}</span>
        </div>
        <span class="qc-legend-count">${item.count} ราย · ${item.pct}%</span>
      </div>
      <div class="qc-legend-bar">
        <div class="qc-legend-bar-fill" style="width:${item.pct}%;background:${item.color}"></div>
      </div>
    `).join('');
  }
}

/* =================================================
   🆕 RECENT CLAIMS
================================================= */
function renderRecentClaims(claims) {
  const container = document.getElementById('claimList');
  if (!container) return;

  const recent = claims.slice(0, 6);
  if (recent.length === 0) {
    container.innerHTML = `
      <div style="color:var(--text-muted);font-size:12px;padding:10px 0">
        ยังไม่มีข้อมูล
      </div>`;
    return;
  }

  const statusMap = {
    submitted: { label: 'รอพิจารณา', cls: 'qc-sb-pending' },
    approved:  { label: 'อนุมัติ',   cls: 'qc-sb-pass' },
    rejected:  { label: 'ไม่อนุมัติ', cls: 'qc-sb-fail' },
  };

  container.innerHTML = recent.map(c => {
    const s  = statusMap[c.status] || { label: c.status, cls: 'qc-sb-pending' };
    const id = (c.id || '').substring(0, 8).toUpperCase();
    const dt = formatDate(c.claim_date || c.created_at);
    return `
      <div class="qc-claim-row">
        <div>
          <div class="qc-claim-id">CL-${id}</div>
          <div class="qc-claim-meta">${escapeHtml(c.product || '—')} · ${dt}</div>
        </div>
        <span class="qc-status-badge ${s.cls}">${s.label}</span>
      </div>
    `;
  }).join('');
}

/* =================================================
   📋 TABLE
================================================= */
function renderTable(data) {
  const tbody = document.getElementById('productTable');
  if (!tbody) return;

  if (!data || data.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;padding:36px;color:var(--text-muted)">
          ไม่พบข้อมูล
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = data.map(r => {
    const scoreVal   = r.status === 'approved' ? 100 : r.status === 'rejected' ? 30 : 60;
    const scoreColor = r.status === 'approved' ? 'var(--qc-pass)'
                     : r.status === 'rejected' ? 'var(--qc-fail)'
                     : 'var(--qc-warn)';
    const scoreLabel = r.status === 'approved' ? 'ผ่าน'
                     : r.status === 'rejected' ? 'ไม่ผ่าน'
                     : 'รอตรวจ';
    const sMap = {
      submitted: { label: 'รอตรวจ', cls: 'qc-sb-pending' },
      approved:  { label: 'Pass',   cls: 'qc-sb-pass' },
      rejected:  { label: 'Fail',   cls: 'qc-sb-fail' },
    };
    const s = sMap[r.status] || { label: r.status, cls: 'qc-sb-pending' };

    return `
      <tr>
        <td><span class="qc-td-id">${(r.id || '').substring(0, 8).toUpperCase()}</span></td>
        <td class="qc-td-product">${escapeHtml(r.product || '—')}</td>
        <td><span class="qc-td-date">${r.claim_date ? formatDate(r.claim_date) : '—'}</span></td>
        <td class="text-right" style="font-family:var(--qc-mono);font-size:12.5px">${r.qty || '—'}</td>
        <td>
          <div class="qc-score-wrap">
            <span class="qc-score-label" style="color:${scoreColor}">${scoreLabel}</span>
            <div class="qc-score-bar">
              <div class="qc-score-fill" style="width:${scoreVal}%;background:${scoreColor}"></div>
            </div>
          </div>
        </td>
        <td><span class="qc-status-badge ${s.cls}">${s.label}</span></td>
        <td class="qc-td-emp">${escapeHtml(r.emp_name || '—')}</td>
      </tr>
    `;
  }).join('');
}

function filterTable() {
  const filter = document.getElementById('filterStatus')?.value;
  const sMap = { pass: 'approved', fail: 'rejected', pending: 'submitted' };
  const dbStatus = sMap[filter] || filter;
  renderTable(dbStatus ? allClaims.filter(r => r.status === dbStatus) : allClaims);
}

/* =================================================
   📑 CLAIM SUMMARY (ประเภทปัญหา)
================================================= */
function renderClaimSummary(claims) {
  const container = document.getElementById('claimSummary');
  if (!container) return;

  const countMap = {};
  claims.forEach(c => {
    (Array.isArray(c.claim_types) ? c.claim_types : []).forEach(t => {
      countMap[t] = (countMap[t] || 0) + 1;
    });
  });

  const sorted = Object.entries(countMap).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxVal = sorted[0]?.[1] || 1;

  if (sorted.length === 0) {
    container.innerHTML = `
      <div class="qc-sum-row">
        <span class="qc-sum-label" style="color:var(--text-muted)">ยังไม่มีข้อมูล</span>
      </div>`;
    return;
  }

  container.innerHTML = sorted.map(([label, count]) => `
    <div class="qc-sum-row">
      <div class="qc-sum-row-inner">
        <span class="qc-sum-label">${escapeHtml(label)}</span>
        <div class="qc-sum-bar">
          <div class="qc-sum-bar-fill" style="width:${Math.round(count / maxVal * 100)}%"></div>
        </div>
      </div>
      <span class="qc-sum-val">${count}</span>
    </div>
  `).join('') + `
    <div class="qc-sum-total-row">
      <span class="qc-sum-total-label">รวมทั้งหมด</span>
      <span class="qc-sum-total-val">${claims.length} ราย</span>
    </div>
  `;
}

/* =================================================
   📊 TREND CHART
================================================= */
function renderTrendChart(claims) {
  const canvas = document.getElementById('trendChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const months = [], labels = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    labels.push(d.toLocaleDateString('th-TH', { month: 'short' }));
  }

  const passData = months.map(m =>
    claims.filter(c => c.status === 'approved' && (c.claim_date || c.created_at || '').startsWith(m)).length
  );
  const failData = months.map(m =>
    claims.filter(c => c.status === 'rejected' && (c.claim_date || c.created_at || '').startsWith(m)).length
  );

  if (window._trendChart) window._trendChart.destroy();
  window._trendChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Pass (อนุมัติ)', data: passData, backgroundColor: CHART_COLORS.pass, borderRadius: 6, stack: 'stack', borderSkipped: false },
        { label: 'Fail (ปฏิเสธ)', data: failData, backgroundColor: CHART_COLORS.fail, borderRadius: 6, stack: 'stack', borderSkipped: false },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: CHART_COLORS.tooltipBg,
          titleColor: CHART_COLORS.tooltipDim,
          bodyColor:  CHART_COLORS.tooltipText,
          padding: 10,
          cornerRadius: 8,
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y} ราย` }
        }
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          border: { display: false },
          ticks: { color: CHART_COLORS.axis, font: { size: 11, family: "'Kanit', sans-serif" } }
        },
        y: {
          stacked: true,
          grid: { color: CHART_COLORS.grid },
          border: { display: false },
          ticks: {
            color: CHART_COLORS.axis,
            font: { size: 11, family: "'Kanit', sans-serif" },
            stepSize: 1,
            callback: v => Number.isInteger(v) ? v : null
          }
        },
      },
    },
  });
}

/* =================================================
   📊 TOP PRODUCTS CHART
================================================= */
function renderTopProductsChart(claims) {
  const canvas = document.getElementById('topProductChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const map = {};
  claims.forEach(c => {
    if (!c.product) return;
    if (!map[c.product]) map[c.product] = { total: 0, approved: 0, rejected: 0 };
    map[c.product].total++;
    if (c.status === 'approved') map[c.product].approved++;
    if (c.status === 'rejected') map[c.product].rejected++;
  });

  const sorted = Object.entries(map)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 8);

  const labels   = sorted.map(([name]) => name);
  const passData = sorted.map(([, v]) => v.approved);
  const failData = sorted.map(([, v]) => v.rejected);
  const pendData = sorted.map(([, v]) => v.total - v.approved - v.rejected);

  if (window._topProductChart) window._topProductChart.destroy();
  window._topProductChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'อนุมัติ',    data: passData, backgroundColor: CHART_COLORS.pass,    borderRadius: 6, stack: 'stack', borderSkipped: false },
        { label: 'ปฏิเสธ',    data: failData, backgroundColor: CHART_COLORS.fail,    borderRadius: 6, stack: 'stack', borderSkipped: false },
        { label: 'รอตรวจสอบ', data: pendData, backgroundColor: CHART_COLORS.pending, borderRadius: 6, stack: 'stack', borderSkipped: false },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: CHART_COLORS.tooltipBg,
          titleColor: CHART_COLORS.tooltipDim,
          bodyColor:  CHART_COLORS.tooltipText,
          padding: 10,
          cornerRadius: 8,
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.x} ราย` },
        },
      },
      scales: {
        x: {
          stacked: true,
          grid: { color: CHART_COLORS.grid },
          border: { display: false },
          ticks: {
            color: CHART_COLORS.axis,
            font: { size: 11, family: "'Kanit', sans-serif" },
            stepSize: 1,
            callback: v => Number.isInteger(v) ? v : null
          }
        },
        y: {
          stacked: true,
          grid: { display: false },
          border: { display: false },
          ticks: { color: CHART_COLORS.axis, font: { size: 11, family: "'Kanit', sans-serif" } }
        },
      },
    },
  });
}

/* =================================================
   📊 MINI STATS (Right Panel)
================================================= */
function renderMiniStats(claims) {
  const total    = claims.length;
  const approved = claims.filter(c => c.status === 'approved').length;
  const rejected = claims.filter(c => c.status === 'rejected').length;

  const passRate = (approved + rejected) > 0
    ? Math.round(approved / (approved + rejected) * 100)
    : 0;

  // ค่าเฉลี่ย/วัน (30 วันล่าสุด)
  const now = new Date();
  const monthAgo = new Date(now);
  monthAgo.setDate(now.getDate() - 30);
  const recent = claims.filter(c => {
    const d = new Date(c.claim_date || c.created_at);
    return !isNaN(d) && d >= monthAgo;
  });
  const avgPerDay = (recent.length / 30).toFixed(1);

  const passEl = document.getElementById('miniPassRate');
  const avgEl  = document.getElementById('miniAvgPerDay');
  if (passEl) passEl.textContent = `${passRate}%`;
  if (avgEl)  avgEl.textContent  = avgPerDay;
}

/* =================================================
   🗓️ CALENDAR (จาก Index)
================================================= */
function renderCalendar() {
  const grid  = document.getElementById('calendarGrid');
  const title = document.getElementById('calendarTitle');
  if (!grid || !title) return;

  grid.innerHTML = '';

  const year  = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const today = new Date();

  const monthNames = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน',
    'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม',
    'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
  ];
  title.textContent = `${monthNames[month]} ${year}`;

  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // วันที่มีเคลม (highlight ตาม claim_date)
  const claimDates = (allClaims || [])
    .map(c => c.claim_date)
    .filter(Boolean)
    .map(d => d.split('T')[0]);

  ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].forEach(d => {
    const el = document.createElement('div');
    el.className = 'calendar-day-header';
    el.textContent = d;
    grid.appendChild(el);
  });

  for (let i = 0; i < firstDay; i++) {
    grid.appendChild(document.createElement('div'));
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateEl = document.createElement('div');
    dateEl.className = 'calendar-day';
    dateEl.textContent = day;

    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    if (claimDates.includes(dateStr)) dateEl.classList.add('has-report');

    if (
      day   === today.getDate()  &&
      month === today.getMonth() &&
      year  === today.getFullYear()
    ) {
      dateEl.classList.add('today');
    }

    grid.appendChild(dateEl);
  }
}

function prevMonth() {
  currentDate.setMonth(currentDate.getMonth() - 1);
  renderCalendar();
}
function nextMonth() {
  currentDate.setMonth(currentDate.getMonth() + 1);
  renderCalendar();
}

/* =================================================
   📷 AVATAR UPLOAD (จาก Index)
================================================= */
async function initAvatarUpload() {
  const uploadInput   = document.getElementById('uploadAvatar');
  const profileImage  = document.getElementById('profileImage');
  const avatarWrapper = document.querySelector('.avatar-wrapper');
  if (!uploadInput || !profileImage || !avatarWrapper) return;

  avatarWrapper.addEventListener('click', () => uploadInput.click());

  uploadInput.addEventListener('change', async function () {
    const file = this.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('กรุณาเลือกไฟล์รูปภาพเท่านั้น');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      alert('ไฟล์ใหญ่เกินไป (ไม่เกิน 2MB)');
      return;
    }

    // แสดงรูป preview
    const reader = new FileReader();
    reader.onload = (e) => { profileImage.src = e.target.result; };
    reader.readAsDataURL(file);

    await uploadAvatar(file, profileImage, avatarWrapper);
  });
}

async function uploadAvatar(file, imgElement, wrapperElement) {
  try {
    wrapperElement.classList.add('uploading');
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error('ไม่พบ user');

    const fileExt  = file.name.split('.').pop().toLowerCase();
    const fileName = `${user.id}-${Date.now()}.${fileExt}`;

    // ลบรูปเก่า (ถ้ามี)
    try {
      const { data: oldProfile } = await supabaseClient
        .from('profiles').select('avatar_url').eq('id', user.id).single();
      if (oldProfile?.avatar_url) {
        const oldFileName = oldProfile.avatar_url.split('/').pop();
        if (oldFileName && !oldFileName.includes('default')) {
          await supabaseClient.storage.from('avatars').remove([oldFileName]);
        }
      }
    } catch (_) { /* ignore */ }

    const { error: uploadError } = await supabaseClient.storage
      .from('avatars')
      .upload(fileName, file, { cacheControl: '3600', upsert: true });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabaseClient.storage
      .from('avatars')
      .getPublicUrl(fileName);
    const publicUrl = urlData.publicUrl;

    const { error: updateError } = await supabaseClient
      .from('profiles')
      .update({ avatar_url: publicUrl })
      .eq('id', user.id);
    if (updateError) throw updateError;

    imgElement.src = publicUrl + '?t=' + Date.now();
    console.log('✅ อัปโหลดรูปโปรไฟล์สำเร็จ');
  } catch (err) {
    console.error('❌ อัปโหลดรูปไม่สำเร็จ:', err);
    alert('อัปโหลดรูปไม่สำเร็จ: ' + err.message);
  } finally {
    wrapperElement.classList.remove('uploading');
  }
}

/* =================================================
   🚪 LOGOUT
================================================= */
async function logout() {
  try {
    await supabaseClient.auth.signOut();
  } catch (_) { /* ignore */ }
  window.location.href = '/pages/auth/login.html';
}

/* =================================================
   🛠️ UTILITIES
================================================= */
function showSkeletons() {
  const tbody = document.getElementById('productTable');
  if (tbody) tbody.innerHTML = `
    <tr><td colspan="7" style="text-align:center;padding:36px;color:var(--text-muted)">
      ⏳ กำลังโหลดข้อมูล...
    </td></tr>`;
  const cl = document.getElementById('claimList');
  if (cl) cl.innerHTML = `
    <div style="color:var(--text-muted);font-size:12px;padding:10px 0">⏳ กำลังโหลด...</div>`;
}

function showLoadingError() {
  const tbody = document.getElementById('productTable');
  if (tbody) tbody.innerHTML = `
    <tr><td colspan="7" style="text-align:center;padding:36px;color:var(--qc-fail)">
      ❌ โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่
    </td></tr>`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return '—';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

console.log('QC Dashboard V2 (Hybrid) loaded 🚀');