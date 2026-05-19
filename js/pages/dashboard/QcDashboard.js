// ============================================================
// QcDashboard.js (V3.2 — Balance layout + New claim count fix)
// ────────────────────────────────────────────────────────────
// ✅ การ์ด “แจ้งเคลมใหม่” นับเฉพาะเคลมใหม่ที่ยังไม่กดรับเคลม
//    เงื่อนไข: effective status = pending และ picked_at ยังว่าง
// ✅ Realtime แจ้งเตือนเฉพาะ INSERT ที่เป็นเคลมใหม่และยังไม่ถูกกดรับ
// ✅ เพิ่ม helper isUnpickedNewClaim() เพื่อใช้จุดเดียวกันทั้ง KPI และ Realtime
// ============================================================

/* =================================================
   🎨 Chart Color Palette
================================================= */
const CHART_COLORS = {
  pass: '#10b981',
  fail: '#ef4444',
  pending: '#f59e0b',
  inProgress: '#3b82f6',
  donutBorder: '#ffffff',
  axis: '#6b7280',
  grid: 'rgba(0, 0, 0, 0.05)',
  tooltipBg: '#1f2937',
  tooltipText: '#f9fafb',
  tooltipDim: '#9ca3af',
  prevPeriod: '#cbd5e1',
};

/* =================================================
   🔧 Global State
================================================= */
let allClaims = [];
let currentDate = new Date();
let comparePeriod = '30d';
let realtimeChannel = null;

/* =================================================
   🧭 STATUS NORMALIZER
================================================= */
function getEffectiveStatus(claim) {
  const raw = (claim?.qc_status || claim?.status || '').toLowerCase();

  if (raw === 'approved') return 'approved';
  if (raw === 'rejected') return 'rejected';

  if (['checking', 'in_progress', 'reviewing', 'draft', 'waiting_ceo'].includes(raw)) {
    return 'in_progress';
  }

  return 'pending';
}

/* =================================================
   🆕 NEW CLAIM HELPER
   นับเฉพาะ “ยังไม่กดรับเคลม”
================================================= */
function isUnpickedNewClaim(claim) {
  const eff = getEffectiveStatus(claim);
  const pickedAt = claim?.picked_at;
  return eff === 'pending' && (pickedAt === null || pickedAt === undefined || pickedAt === '');
}

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
document.addEventListener('DOMContentLoaded', async () => {
  setCurrentDate();

  const ready = await waitForSupabase();
  if (!ready) {
    showLoadingError();
    return;
  }

  if (typeof protectPage === 'function') {
    await protectPage(['admin', 'adminQc', 'manager', 'executive']);
  }

  await loadUserProfile();
  initAvatarUpload();
  renderCalendar();

  if (typeof injectComparisonCard === 'function') injectComparisonCard();

  await loadDashboardData();
  setupClaimsRealtime();

  const filterEl = document.getElementById('filterStatus');
  if (filterEl) filterEl.addEventListener('change', filterTable);

  const cmpSelect = document.getElementById('cmpPeriodSelect');
  if (cmpSelect) {
    cmpSelect.addEventListener('change', (e) => {
      comparePeriod = e.target.value;
      if (typeof renderComparisonCard === 'function') renderComparisonCard(allClaims);
    });
  }

  window.addEventListener('beforeunload', () => {
    if (realtimeChannel) {
      try {
        supabaseClient.removeChannel(realtimeChannel);
      } catch (_) {}
      realtimeChannel = null;
    }
  });
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
    const userEmailEl = document.getElementById('userEmail');
    const userRoleEl = document.getElementById('userRole');
    const profileImg = document.getElementById('profileImage');

    if (displayNameEl) displayNameEl.textContent = fullName;
    if (userEmailEl) userEmailEl.textContent = session.user.email;
    if (userRoleEl) userRoleEl.textContent = profile?.role || 'QC Admin';
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
      .select('id,status,qc_status,claim_date,created_at,emp_name,area,customer,product,qty,claim_types,detail,media_urls,qc_comment,picked_at,claim_scope')
      .order('created_at', { ascending: false });

    if (error) throw error;
    allClaims = data || [];

    console.log(`📦 โหลด claims ทั้งหมด: ${allClaims.length} รายการ`);
    console.log('📊 status breakdown:', summarizeStatuses(allClaims));
    console.log('🔔 unpicked new claims:', allClaims.filter(isUnpickedNewClaim).length);

    renderKPICards(allClaims);
    renderPassFailPie(allClaims);
    renderRecentClaims(allClaims);
    renderTable(allClaims);
    renderClaimSummary(allClaims);
    renderTrendChart(allClaims);
    renderTopProductsChart(allClaims);
    renderMiniStats(allClaims);
    if (typeof renderComparisonCard === 'function') renderComparisonCard(allClaims);
  } catch (err) {
    console.error('❌ loadDashboardData error:', err);
    showLoadingError();
  }
}

function summarizeStatuses(claims) {
  const map = {};
  claims.forEach((c) => {
    const eff = getEffectiveStatus(c);
    map[eff] = (map[eff] || 0) + 1;
  });
  return map;
}

/* =================================================
   📊 KPI CARDS
================================================= */
function renderKPICards(claims) {
  const now = new Date();
  const thisYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthly = claims.filter((c) =>
    (c.claim_date || c.created_at || '').startsWith(thisYM)
  );

  const totalMonth = monthly.length;
  const approved = claims.filter((c) => getEffectiveStatus(c) === 'approved').length;
  const inProgress = claims.filter((c) => getEffectiveStatus(c) === 'in_progress').length;

  // ✅ จุดสำคัญ: แจ้งเคลมใหม่ = pending + ยังไม่กดรับเคลมเท่านั้น
  const newPending = claims.filter(isUnpickedNewClaim).length;

  const approveRate = claims.length > 0 ? Math.round((approved / claims.length) * 100) : 0;

  setKPI('kpi-total', totalMonth, 'ทั้งหมดในเดือนนี้');
  setKPI('kpi-fail', inProgress, 'รายการที่กำลังตรวจสอบ', 'fail');
  setKPI('kpi-pass', approved, `${approveRate}% อัตราอนุมัติ`, 'pass');
  setKPI(
    'kpi-pending',
    newPending,
    newPending > 0 ? `มี ${newPending} เคลมใหม่ยังไม่กดรับ` : 'ไม่มีเคลมใหม่',
    'warn'
  );

  toggleNewClaimAlert(newPending);
}

function setKPI(id, value, subText, colorClass) {
  const card = document.getElementById(id);
  if (!card) return;

  const valEl = card.querySelector('.qc-kpi-val');
  const subEl = card.querySelector('.qc-kpi-sub');

  if (valEl) {
    const num = typeof value === 'number' ? value : 0;
    valEl.textContent = num.toLocaleString();
    valEl.className = 'qc-kpi-val';
    if (colorClass) valEl.classList.add(colorClass);
  }
  if (subEl && subText != null) subEl.textContent = subText;
}

function toggleNewClaimAlert(count) {
  const card = document.getElementById('kpi-pending');
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

function updateDocumentTitleAlert(count) {
  const baseTitle = 'QC Dashboard - EABaseHub';
  document.title = count > 0 ? `(${count}) 🔔 ${baseTitle}` : baseTitle;
}

/* =================================================
   📡 REALTIME
================================================= */
function setupClaimsRealtime() {
  if (typeof supabaseClient === 'undefined') return;

  if (realtimeChannel) {
    try {
      supabaseClient.removeChannel(realtimeChannel);
    } catch (_) {}
    realtimeChannel = null;
  }

  let isFirstLoad = true;

  const handleChange = (payload) => {
    loadDashboardData().catch((err) => console.error('reload error:', err));

    if (!isFirstLoad && payload?.eventType === 'INSERT') {
      if (isUnpickedNewClaim(payload.new || {})) {
        playAlertSound();
        showQcToast(`🔔 เคลมใหม่: ${payload.new?.product || 'ไม่ระบุชื่อสินค้า'}`);
      }
    }
  };

  realtimeChannel = supabaseClient
    .channel('qc-dashboard-claims')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'claims' }, handleChange)
    .subscribe(() => {
      setTimeout(() => {
        isFirstLoad = false;
      }, 2000);
    });
}

function playAlertSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    osc.stop(ctx.currentTime + 0.25);
  } catch (_) {}
}

function showQcToast(message) {
  const div = document.createElement('div');
  div.className = 'qc-toast';
  div.textContent = message;
  document.body.appendChild(div);

  requestAnimationFrame(() => div.classList.add('show'));
  setTimeout(() => {
    div.classList.remove('show');
    setTimeout(() => div.remove(), 300);
  }, 3500);
}

/* =================================================
   🍩 PASS / FAIL DONUT
================================================= */
function renderPassFailPie(claims) {
  const containerCard = document.getElementById('pfLegend')?.closest('.qc-card');
  const chartWrap = document.querySelector('.qc-pie-chart-wrap');
  const legend = document.getElementById('pfLegend');
  const centerEl = document.getElementById('pieCenterNum');

  const total = claims.length;
  const approved = claims.filter((c) => getEffectiveStatus(c) === 'approved').length;
  const rejected = claims.filter((c) => getEffectiveStatus(c) === 'rejected').length;
  const inProgress = claims.filter((c) => getEffectiveStatus(c) === 'in_progress').length;
  const pending = claims.filter((c) => getEffectiveStatus(c) === 'pending').length;

  if (centerEl) centerEl.textContent = total.toLocaleString();
  if (window._pfChart) window._pfChart.destroy();

  // ✅ เปลี่ยนส่วน “สถานะ” เป็นหลอดยาว ตาม mockup
  if (chartWrap) chartWrap.style.display = 'none';
  if (!legend) return;

  const items = [
    { label: 'รอดำเนินการ (Pending)', count: pending, color: CHART_COLORS.pending },
    { label: 'กำลังตรวจสอบ (In Progress)', count: inProgress, color: CHART_COLORS.inProgress },
    { label: 'ไม่ผ่าน (Fail)', count: rejected, color: CHART_COLORS.fail },
    { label: 'ผ่าน (Pass)', count: approved, color: CHART_COLORS.pass },
  ];

  legend.className = 'qc-status-bars';
  legend.innerHTML = items.map((item) => {
    const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
    return `
      <div class="qc-status-bar-row">
        <div class="qc-status-bar-head">
          <span>${item.label}</span>
          <strong>${item.count.toLocaleString()} รายการ (${pct}%)</strong>
        </div>
        <div class="qc-status-track">
          <div class="qc-status-fill" style="width:${pct}%;background:${item.color}"></div>
        </div>
      </div>
    `;
  }).join('') + `
    <div class="qc-status-total">
      <span>รวมทั้งหมด</span>
      <strong>${total.toLocaleString()} รายการ</strong>
    </div>
  `;

  if (containerCard) containerCard.classList.add('qc-card-status-bars');
}

/* =================================================
   🆕 RECENT CLAIMS
================================================= */
function renderRecentClaims(claims) {
  const container = document.getElementById('claimList');
  if (!container) return;

  const recent = claims.slice(0, 6);
  if (recent.length === 0) {
    container.innerHTML = `<div class="qc-empty-text">ยังไม่มีข้อมูล</div>`;
    return;
  }

  const statusMap = {
    pending: { label: 'รอรับเคลม', cls: 'qc-sb-pending' },
    in_progress: { label: 'กำลังตรวจสอบ', cls: 'qc-sb-pending' },
    approved: { label: 'อนุมัติ', cls: 'qc-sb-pass' },
    rejected: { label: 'ไม่อนุมัติ', cls: 'qc-sb-fail' },
  };

  container.innerHTML = recent.map((c) => {
    const eff = getEffectiveStatus(c);
    const s = statusMap[eff] || statusMap.pending;
    const id = (c.id || '').substring(0, 8).toUpperCase();
    const dt = formatDate(c.claim_date || c.created_at);
    const unpickedMark = isUnpickedNewClaim(c) ? '<span class="qc-new-dot">NEW</span>' : '';

    return `
      <div class="qc-claim-row">
        <div>
          <div class="qc-claim-id">CL-${id} ${unpickedMark}</div>
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
        <td colspan="7" class="qc-empty-cell">ไม่พบข้อมูล</td>
      </tr>`;
    return;
  }

  tbody.innerHTML = data.map((r) => {
    const eff = getEffectiveStatus(r);

    const scoreVal = eff === 'approved' ? 100
      : eff === 'rejected' ? 30
        : eff === 'in_progress' ? 60
          : 40;

    const scoreColor = eff === 'approved' ? 'var(--qc-pass)'
      : eff === 'rejected' ? 'var(--qc-fail)'
        : eff === 'in_progress' ? 'var(--qc-info)'
          : 'var(--qc-warn)';

    const scoreLabel = eff === 'approved' ? 'ผ่านการตรวจสอบ'
      : eff === 'rejected' ? 'ไม่ผ่านการตรวจสอบ'
        : eff === 'in_progress' ? 'กำลังตรวจ'
          : 'รอรับเคลม';

    const sMap = {
      pending: {
        label: 'รอรับเคลม',
        cls: 'qc-sb-pending',
        icon: 'hourglass_empty',
        rowCls: 'qc-row-pending',
      },
      in_progress: {
        label: 'กำลังตรวจ',
        cls: 'qc-sb-progress',
        icon: 'schedule',
        rowCls: 'qc-row-progress',
      },
      approved: {
        label: 'ผ่านการตรวจสอบ',
        cls: 'qc-sb-pass',
        icon: 'hourglass_empty',
        rowCls: 'qc-row-pass',
      },
      rejected: {
        label: 'ไม่ผ่านการตรวจสอบ',
        cls: 'qc-sb-fail',
        icon: 'hourglass_empty',
        rowCls: 'qc-row-fail',
      },
    };

    const s = sMap[eff] || sMap.pending;

    return `
      <tr class="${s.rowCls}">
        <td><span class="qc-td-id">${(r.id || '').substring(0, 8).toUpperCase()}</span></td>
        <td class="qc-td-product">${escapeHtml(r.product || '—')}</td>
        <td><span class="qc-td-date">${r.claim_date ? formatDate(r.claim_date) : '—'}</span></td>
        <td class="text-right qc-mono-cell">${r.qty || '—'}</td>
        <td>
          <div class="qc-score-wrap">
            <span class="qc-score-label" style="color:${scoreColor}">${scoreLabel}</span>
            <div class="qc-score-bar">
              <div class="qc-score-fill" style="width:${scoreVal}%;background:${scoreColor}"></div>
            </div>
          </div>
        </td>
        <td>
          <span class="qc-status-badge ${s.cls}">
            <span class="material-symbols-outlined qc-status-icon">${s.icon}</span>
            ${s.label}
          </span>
        </td>
        <td class="qc-td-emp">${escapeHtml(r.emp_name || '—')}</td>
      </tr>
    `;
  }).join('');
}

/* =================================================
   🔍 FILTER TABLE
================================================= */
function filterTable() {
  const filter = document.getElementById('filterStatus')?.value;

  if (!filter) {
    renderTable(allClaims);
    return;
  }

  const filtered = allClaims.filter((r) => {
    const eff = getEffectiveStatus(r);
    if (filter === 'pass') return eff === 'approved';
    if (filter === 'fail') return eff === 'rejected';
    if (filter === 'pending') return eff === 'pending' || eff === 'in_progress';
    if (filter === 'new') return isUnpickedNewClaim(r);
    return eff === filter;
  });

  renderTable(filtered);
}

/* =================================================
   📑 CLAIM SUMMARY
================================================= */
function renderClaimSummary(claims) {
  const container = document.getElementById('claimSummary');
  if (!container) return;

  const countMap = {};
  claims.forEach((c) => {
    const types = Array.isArray(c.claim_types)
      ? c.claim_types
      : (typeof c.claim_types === 'string' ? safeParseArray(c.claim_types) : []);
    types.forEach((t) => {
      if (t) countMap[t] = (countMap[t] || 0) + 1;
    });
  });

  const sorted = Object.entries(countMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const total = sorted.reduce((sum, [, count]) => sum + count, 0);

  if (window._claimSummaryChart) window._claimSummaryChart.destroy();

  if (sorted.length === 0) {
    container.innerHTML = `<div class="qc-sum-row"><span class="qc-sum-label muted">ยังไม่มีข้อมูล</span></div>`;
    return;
  }

  const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'];

  container.innerHTML = `
    <div class="qc-summary-donut-layout">
      <div class="qc-summary-chart-wrap">
        <canvas id="claimSummaryChart"></canvas>
        <div class="qc-summary-center">
          <strong>${claims.length.toLocaleString()}</strong>
          <span>รายการ</span>
        </div>
      </div>
      <div class="qc-summary-legend">
        ${sorted.map(([label, count], index) => {
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return `
            <div class="qc-summary-legend-row">
              <span class="qc-summary-dot" style="background:${colors[index % colors.length]}"></span>
              <span class="qc-summary-name">${escapeHtml(label)}</span>
              <strong>${count} รายการ</strong>
              <em>${pct}%</em>
            </div>
          `;
        }).join('')}
        <div class="qc-summary-total">
          <span>รวมทั้งหมด</span>
          <strong>${claims.length.toLocaleString()} รายการ</strong>
        </div>
      </div>
    </div>
  `;

  const canvas = document.getElementById('claimSummaryChart');
  if (!canvas || typeof Chart === 'undefined') return;

  window._claimSummaryChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: sorted.map(([label]) => label),
      datasets: [{
        data: sorted.map(([, count]) => count),
        backgroundColor: colors,
        borderColor: '#ffffff',
        borderWidth: 4,
        cutout: '72%',
        circumference: 180,
        rotation: 270,
        borderRadius: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: CHART_COLORS.tooltipBg,
          titleColor: CHART_COLORS.tooltipDim,
          bodyColor: CHART_COLORS.tooltipText,
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: (ctx) => {
              const pct = total > 0 ? Math.round((ctx.parsed / total) * 100) : 0;
              return ` ${ctx.label}: ${ctx.parsed} ราย (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

function safeParseArray(value) {
  try {
    const p = JSON.parse(value);
    return Array.isArray(p) ? p : [];
  } catch (_) {
    return String(value).split(',').map((s) => s.trim()).filter(Boolean);
  }
}

/* =================================================
   📊 TREND CHART
================================================= */
function renderTrendChart(claims) {
  const canvas = document.getElementById('trendChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const months = [];
  const labels = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    labels.push(d.toLocaleDateString('th-TH', { month: 'short' }));
  }

  const passData = months.map((m) =>
    claims.filter((c) => getEffectiveStatus(c) === 'approved' && (c.claim_date || c.created_at || '').startsWith(m)).length
  );
  const failData = months.map((m) =>
    claims.filter((c) => getEffectiveStatus(c) === 'rejected' && (c.claim_date || c.created_at || '').startsWith(m)).length
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
    options: chartBaseOptions(),
  });
}

/* =================================================
   📊 TOP PRODUCTS CHART
================================================= */
function renderTopProductsChart(claims) {
  const canvas = document.getElementById('topProductChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const map = {};
  claims.forEach((c) => {
    if (!c.product) return;
    if (!map[c.product]) map[c.product] = { total: 0, approved: 0, rejected: 0, waiting: 0 };
    const eff = getEffectiveStatus(c);
    map[c.product].total++;
    if (eff === 'approved') map[c.product].approved++;
    else if (eff === 'rejected') map[c.product].rejected++;
    else map[c.product].waiting++;
  });

  const sorted = Object.entries(map).sort((a, b) => b[1].total - a[1].total).slice(0, 8);
  const labels = sorted.map(([name]) => name);
  const totals = sorted.map(([, v]) => v.total);

  if (window._topProductChart) window._topProductChart.destroy();

  if (sorted.length === 0) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const barColors = ['#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#14b8a6', '#ec4899', '#fb923c', '#64748b'];

  window._topProductChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'จำนวนเคลม',
        data: totals,
        backgroundColor: barColors,
        borderRadius: 8,
        borderSkipped: false,
        maxBarThickness: 46,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: CHART_COLORS.tooltipBg,
          titleColor: CHART_COLORS.tooltipDim,
          bodyColor: CHART_COLORS.tooltipText,
          padding: 10,
          cornerRadius: 8,
          callbacks: { label: (ctx) => ` จำนวนเคลม: ${ctx.parsed.y} รายการ` },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: CHART_COLORS.axis,
            font: { size: 11, family: "'Kanit', sans-serif" },
            callback(value) {
              const label = this.getLabelForValue(value);
              return label.length > 14 ? label.substring(0, 14) + '…' : label;
            },
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: CHART_COLORS.grid },
          border: { display: false },
          ticks: {
            precision: 0,
            color: CHART_COLORS.axis,
            font: { size: 11, family: "'Kanit', sans-serif" },
          },
        },
      },
    },
  });
}

function chartBaseOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: CHART_COLORS.tooltipBg,
        titleColor: CHART_COLORS.tooltipDim,
        bodyColor: CHART_COLORS.tooltipText,
        padding: 10,
        cornerRadius: 8,
        callbacks: {
          label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y ?? ctx.parsed.x} ราย`,
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        grid: { display: false },
        border: { display: false },
        ticks: { color: CHART_COLORS.axis, font: { size: 11, family: "'Kanit', sans-serif" } },
      },
      y: {
        stacked: true,
        grid: { color: CHART_COLORS.grid },
        border: { display: false },
        ticks: {
          color: CHART_COLORS.axis,
          font: { size: 11, family: "'Kanit', sans-serif" },
          callback(value) {
            const label = this.getLabelForValue(value);
            return label.length > 18 ? label.substring(0, 18) + '…' : label;
          },
        },
      },
    },
  };
}

/* =================================================
   MINI STATS
================================================= */
function renderMiniStats(claims) {
  const passRateEl = document.getElementById('miniPassRate');
  const avgEl = document.getElementById('miniAvgPerDay');

  const approved = claims.filter((c) => getEffectiveStatus(c) === 'approved').length;
  const rate = claims.length ? Math.round((approved / claims.length) * 100) : 0;

  if (passRateEl) passRateEl.textContent = `${rate}%`;

  const now = new Date();
  const days = Math.max(1, now.getDate());
  const thisYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthly = claims.filter((c) => (c.claim_date || c.created_at || '').startsWith(thisYM));
  const avg = monthly.length / days;

  if (avgEl) avgEl.textContent = avg.toFixed(1);
}

/* =================================================
   AVATAR UPLOAD
================================================= */
function initAvatarUpload() {
  const wrapper = document.querySelector('.avatar-wrapper');
  const input = document.getElementById('uploadAvatar');
  const img = document.getElementById('profileImage');

  if (!wrapper || !input || !img) return;

  wrapper.addEventListener('click', () => input.click());
  input.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* =================================================
   CALENDAR
================================================= */
function renderCalendar() {
  const title = document.getElementById('calendarTitle');
  const grid = document.getElementById('calendarGrid');
  if (!title || !grid) return;

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  title.textContent = currentDate.toLocaleDateString('th-TH', {
    month: 'long',
    year: 'numeric',
  });

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  let html = '';
  ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].forEach((d) => {
    html += `<div class="calendar-day-name">${d}</div>`;
  });

  for (let i = 0; i < firstDay; i++) html += '<div class="calendar-day empty"></div>';

  for (let day = 1; day <= daysInMonth; day++) {
    const isToday =
      day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    html += `<div class="calendar-day ${isToday ? 'today' : ''}">${day}</div>`;
  }

  grid.innerHTML = html;
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
   SIDEBAR / LOGOUT
================================================= */
function toggleEaSidebar() {
  document.body.classList.toggle('sidebar-expanded');
}

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
   COMMON HELPERS
================================================= */
function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('th-TH', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showSkeletons() {
  // เว้นไว้ให้ใช้ skeleton เพิ่มภายหลังได้
}

function showLoadingError() {
  const ids = ['productTable', 'claimList', 'claimSummary'];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === 'productTable') {
      el.innerHTML = `<tr><td colspan="7" class="qc-empty-cell">โหลดข้อมูลไม่สำเร็จ</td></tr>`;
    } else {
      el.innerHTML = `<div class="qc-empty-text">โหลดข้อมูลไม่สำเร็จ</div>`;
    }
  });
}
