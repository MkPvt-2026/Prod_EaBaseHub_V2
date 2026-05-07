// ============================================================
// QcDashboard.js (V3 — Fix status field + Comparison Card)
// ────────────────────────────────────────────────────────────
// แก้:
//   ✅ ใช้ทั้ง qc_status และ status (เดิมตัดข้อมูลทิ้งเพราะ .in())
//   ✅ KPI/Charts/Table ใช้ helper getEffectiveStatus()
//   ✅ Realtime callback ไม่ return Promise (กัน console error)
//   ✅ เพิ่มการ์ดเปรียบเทียบช่วงเวลา (Comparison Card)
// ============================================================

/* =================================================
   🎨 Chart Color Palette
================================================= */
const CHART_COLORS = {
  pass:        '#10b981',
  fail:        '#ef4444',
  pending:     '#f59e0b',
  inProgress:  '#3b82f6',
  donutBorder: '#ffffff',
  axis:        '#6b7280',
  grid:        'rgba(0, 0, 0, 0.05)',
  tooltipBg:   '#1f2937',
  tooltipText: '#f9fafb',
  tooltipDim:  '#9ca3af',
  prevPeriod:  '#cbd5e1',
};

/* =================================================
   🔧 Global State
================================================= */
let allClaims = [];
let currentDate = new Date();
let comparePeriod = '30d'; // ช่วงเริ่มต้นของการ์ดเปรียบเทียบ

/* =================================================
   🧭 STATUS NORMALIZER — ใช้ทั่วทั้งหน้า
   - ถ้ามี qc_status → ใช้ qc_status
   - ไม่งั้น fallback status
   - map ค่าเป็น 4 กลุ่มหลัก: approved, rejected, in_progress, pending
================================================= */
function getEffectiveStatus(claim) {
  const raw = (claim?.qc_status || claim?.status || '').toLowerCase();

  if (raw === 'approved') return 'approved';
  if (raw === 'rejected') return 'rejected';

  // กลุ่ม "กำลังตรวจสอบ" — รวม draft / waiting_ceo / checking / in_progress / reviewing
  if (['checking', 'in_progress', 'reviewing', 'draft', 'waiting_ceo'].includes(raw)) {
    return 'in_progress';
  }

  // submitted / pending / ค่าว่าง → รอตรวจ
  return 'pending';
}

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

  if (typeof protectPage === 'function') {
    await protectPage(['admin', 'adminQc', 'manager', 'executive']);
  }

  await loadUserProfile();
  initAvatarUpload();
  renderCalendar();

  // เพิ่ม Comparison Card เข้า DOM ก่อนโหลดข้อมูล
  injectComparisonCard();

  await loadDashboardData();
  setupClaimsRealtime();

  const filterEl = document.getElementById('filterStatus');
  if (filterEl) filterEl.addEventListener('change', filterTable);

  // Listener ของ comparison card
  const cmpSelect = document.getElementById('cmpPeriodSelect');
  if (cmpSelect) {
    cmpSelect.addEventListener('change', (e) => {
      comparePeriod = e.target.value;
      renderComparisonCard(allClaims);
    });
  }
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
   ⚠️ ลบ .in('status', [...]) ออก — โหลดทั้งหมดแล้ว filter ฝั่ง JS
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

    renderKPICards(allClaims);
    renderPassFailPie(allClaims);
    renderRecentClaims(allClaims);
    renderTable(allClaims);
    renderClaimSummary(allClaims);
    renderTrendChart(allClaims);
    renderTopProductsChart(allClaims);
    renderMiniStats(allClaims);
    renderComparisonCard(allClaims);
  } catch (err) {
    console.error('❌ loadDashboardData error:', err);
    showLoadingError();
  }
}

function summarizeStatuses(claims) {
  const map = {};
  claims.forEach(c => {
    const eff = getEffectiveStatus(c);
    map[eff] = (map[eff] || 0) + 1;
  });
  return map;
}

/* =================================================
   📊 KPI CARDS — V3 (ใช้ getEffectiveStatus)
================================================= */
function renderKPICards(claims) {
  const now = new Date();
  const thisYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthly = claims.filter(c =>
    (c.claim_date || c.created_at || '').startsWith(thisYM)
  );

  const totalMonth = monthly.length;
  const approved   = claims.filter(c => getEffectiveStatus(c) === 'approved').length;
  const inProgress = claims.filter(c => getEffectiveStatus(c) === 'in_progress').length;
  const newPending = claims.filter(c => getEffectiveStatus(c) === 'pending').length;

  const approveRate = (approved + inProgress + newPending) > 0
    ? Math.round(approved / (approved + inProgress + newPending) * 100)
    : 0;

  setKPI('kpi-total',   totalMonth, 'ทั้งหมดในเดือนนี้');
  setKPI('kpi-fail',    inProgress, 'รายการที่กำลังตรวจสอบ', 'fail');
  setKPI('kpi-pass',    approved,   `${approveRate}% อัตราอนุมัติ`, 'pass');
  setKPI('kpi-pending', newPending, newPending > 0 ? `มี ${newPending} เคลมรอตรวจ` : 'ไม่มีเคลมใหม่', 'warn');

  toggleNewClaimAlert(newPending);
}

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

function updateDocumentTitleAlert(count) {
  const baseTitle = 'QC Dashboard - EABaseHub';
  document.title = count > 0 ? `(${count}) 🔔 ${baseTitle}` : baseTitle;
}

/* =================================================
   📡 REALTIME — ไม่ return Promise ใน callback
   (แก้ "message channel closed before a response was received")
================================================= */
function setupClaimsRealtime() {
  if (typeof supabaseClient === 'undefined') return;

  let isFirstLoad = true;

  const handleChange = (payload) => {
    // fire-and-forget — ไม่ return Promise ออกจาก callback
    loadDashboardData().catch(err => console.error('reload error:', err));

    if (!isFirstLoad && payload?.eventType === 'INSERT') {
      const eff = getEffectiveStatus(payload.new || {});
      if (eff === 'pending') {
        playAlertSound();
        showQcToast(`🔔 เคลมใหม่: ${payload.new?.product || 'ไม่ระบุชื่อสินค้า'}`);
      }
    }
  };

  supabaseClient
    .channel('qc-dashboard-claims')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'claims' }, handleChange)
    .subscribe(() => {
      setTimeout(() => { isFirstLoad = false; }, 2000);
    });
}

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
  } catch (_) {}
}

function showQcToast(message) {
  const div = document.createElement('div');
  div.textContent = message;
  Object.assign(div.style, {
    position: 'fixed', top: '20px', right: '20px',
    background: '#1f2937', color: '#fff',
    padding: '10px 18px', borderRadius: '12px',
    fontSize: '13px', fontFamily: "'Kanit', sans-serif",
    zIndex: '9999', boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
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
  const total      = claims.length;
  const approved   = claims.filter(c => getEffectiveStatus(c) === 'approved').length;
  const rejected   = claims.filter(c => getEffectiveStatus(c) === 'rejected').length;
  const inProgress = claims.filter(c => getEffectiveStatus(c) === 'in_progress').length;
  const pending    = claims.filter(c => getEffectiveStatus(c) === 'pending').length;

  const waitingCount = inProgress + pending;

  const centerEl = document.getElementById('pieCenterNum');
  if (centerEl) centerEl.textContent = total.toLocaleString();

  if (window._pfChart) window._pfChart.destroy();

  const canvas = document.getElementById('pfPieChart');
  if (!canvas || typeof Chart === 'undefined') return;

  window._pfChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Pass', 'Fail', 'รอตรวจ'],
      datasets: [{
        data: [approved, rejected, waitingCount],
        backgroundColor: [
          CHART_COLORS.pass,
          CHART_COLORS.fail,
          CHART_COLORS.pending
        ],
        borderColor: '#ffffff',
        borderWidth: 4,
        cutout: '78%',
        circumference: 180,
        rotation: 270,
        borderRadius: 8
      }]
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
            label: ctx => {
              const pct = total > 0 ? Math.round(ctx.parsed / total * 100) : 0;
              return ` ${ctx.label}: ${ctx.parsed} ราย (${pct}%)`;
            }
          }
        }
      }
    }
  });

  const legend = document.getElementById('pfLegend');
  if (legend) {
    legend.innerHTML = `
      <div class="qc-gauge-legend-row">
        <span class="qc-gauge-dot qc-dot-pass"></span>
        <strong>${approved.toLocaleString()}</strong>
        <span>Pass</span>
      </div>

      <div class="qc-gauge-legend-row">
        <span class="qc-gauge-dot qc-dot-fail"></span>
        <strong>${rejected.toLocaleString()}</strong>
        <span>Fail</span>
      </div>

      <div class="qc-gauge-legend-row">
        <span class="qc-gauge-dot qc-dot-pend"></span>
        <strong>${waitingCount.toLocaleString()}</strong>
        <span>รอตรวจ</span>
      </div>
    `;
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
    pending:     { label: 'รอพิจารณา',     cls: 'qc-sb-pending' },
    in_progress: { label: 'กำลังตรวจสอบ', cls: 'qc-sb-pending' },
    approved:    { label: 'อนุมัติ',        cls: 'qc-sb-pass' },
    rejected:    { label: 'ไม่อนุมัติ',     cls: 'qc-sb-fail' },
  };

  container.innerHTML = recent.map(c => {
    const eff = getEffectiveStatus(c);
    const s   = statusMap[eff] || statusMap.pending;
    const id  = (c.id || '').substring(0, 8).toUpperCase();
    const dt  = formatDate(c.claim_date || c.created_at);
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
    const eff = getEffectiveStatus(r);
    const scoreVal   = eff === 'approved' ? 100 : eff === 'rejected' ? 30 : eff === 'in_progress' ? 60 : 40;
    const scoreColor = eff === 'approved' ? 'var(--qc-pass)'
                     : eff === 'rejected' ? 'var(--qc-fail)'
                     : 'var(--qc-warn)';
    const scoreLabel = eff === 'approved' ? 'ผ่าน'
                     : eff === 'rejected' ? 'ไม่ผ่าน'
                     : eff === 'in_progress' ? 'กำลังตรวจ'
                     : 'รอตรวจ';
    const sMap = {
      pending:     { label: 'รอตรวจ',     cls: 'qc-sb-pending' },
      in_progress: { label: 'กำลังตรวจ',  cls: 'qc-sb-pending' },
      approved:    { label: 'Pass',        cls: 'qc-sb-pass' },
      rejected:    { label: 'Fail',        cls: 'qc-sb-fail' },
    };
    const s = sMap[eff] || sMap.pending;

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
  const sMap = { pass: 'approved', fail: 'rejected', pending: 'pending' };
  const target = sMap[filter] || filter;
  if (!target) {
    renderTable(allClaims);
    return;
  }
  const filtered = allClaims.filter(r => {
    const eff = getEffectiveStatus(r);
    if (target === 'pending') return eff === 'pending' || eff === 'in_progress';
    return eff === target;
  });
  renderTable(filtered);
}

/* =================================================
   📑 CLAIM SUMMARY (ประเภทปัญหา)
================================================= */
function renderClaimSummary(claims) {
  const container = document.getElementById('claimSummary');
  if (!container) return;

  const countMap = {};
  claims.forEach(c => {
    const types = Array.isArray(c.claim_types)
      ? c.claim_types
      : (typeof c.claim_types === 'string' ? safeParseArray(c.claim_types) : []);
    types.forEach(t => {
      if (t) countMap[t] = (countMap[t] || 0) + 1;
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

function safeParseArray(value) {
  try {
    const p = JSON.parse(value);
    return Array.isArray(p) ? p : [];
  } catch (_) {
    return String(value).split(',').map(s => s.trim()).filter(Boolean);
  }
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
    claims.filter(c => getEffectiveStatus(c) === 'approved' && (c.claim_date || c.created_at || '').startsWith(m)).length
  );
  const failData = months.map(m =>
    claims.filter(c => getEffectiveStatus(c) === 'rejected' && (c.claim_date || c.created_at || '').startsWith(m)).length
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
  claims.forEach(c => {
    if (!c.product) return;
    if (!map[c.product]) map[c.product] = { total: 0, approved: 0, rejected: 0, waiting: 0 };
    const eff = getEffectiveStatus(c);
    map[c.product].total++;
    if (eff === 'approved') map[c.product].approved++;
    else if (eff === 'rejected') map[c.product].rejected++;
    else map[c.product].waiting++;
  });

  const sorted = Object.entries(map).sort((a, b) => b[1].total - a[1].total).slice(0, 8);
  const labels   = sorted.map(([name]) => name);
  const passData = sorted.map(([, v]) => v.approved);
  const failData = sorted.map(([, v]) => v.rejected);
  const pendData = sorted.map(([, v]) => v.waiting);

  if (window._topProductChart) window._topProductChart.destroy();

  if (sorted.length === 0) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

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
    options: { ...chartBaseOptions(), indexAxis: 'y' },
  });
}

function chartBaseOptions() {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: CHART_COLORS.tooltipBg,
        titleColor: CHART_COLORS.tooltipDim,
        bodyColor:  CHART_COLORS.tooltipText,
        padding: 10, cornerRadius: 8,
        callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y ?? ctx.parsed.x} ราย` }
      }
    },
    scales: {
      x: {
        stacked: true, grid: { display: false }, border: { display: false },
        ticks: { color: CHART_COLORS.axis, font: { size: 11, family: "'Kanit', sans-serif" } }
      },
      y: {
        stacked: true, grid: { color: CHART_COLORS.grid }, border: { display: false },
        ticks: {
          color: CHART_COLORS.axis, font: { size: 11, family: "'Kanit', sans-serif" },
          stepSize: 1, callback: v => Number.isInteger(v) ? v : null
        }
      },
    },
  };
}

/* =================================================
   📊 MINI STATS (Right Panel)
================================================= */
function renderMiniStats(claims) {
  const approved = claims.filter(c => getEffectiveStatus(c) === 'approved').length;
  const rejected = claims.filter(c => getEffectiveStatus(c) === 'rejected').length;

  const passRate = (approved + rejected) > 0
    ? Math.round(approved / (approved + rejected) * 100)
    : 0;

  const now = new Date();
  const monthAgo = new Date(now); monthAgo.setDate(now.getDate() - 30);
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

/* ============================================================
   🆕 COMPARISON CARD — เปรียบเทียบช่วงเวลา (KPI + กราฟ + %)
   ============================================================ */
function injectComparisonCard() {
  // หา anchor — แทรกก่อน "สินค้าที่เคลมบ่อย" (qc-row3 ก็ได้)
  const tableCard = document.querySelector('.qc-table-card');
  if (!tableCard || document.getElementById('cmpCard')) return;

  const html = `
    <section class="qc-card cmp-card" id="cmpCard">
      <style>
        .cmp-card { padding: 18px; }
        .cmp-header { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:14px; }
        .cmp-header h3 { font-size:15px; font-weight:600; margin:0; display:flex; align-items:center; gap:8px; color:#1f2937; }
        .cmp-header h3::before { content:''; width:4px; height:16px; background:var(--role-color, #f97316); border-radius:2px; }
        .cmp-controls { display:flex; align-items:center; gap:8px; }
        .cmp-controls label { font-size:12px; color:#6b7280; }
        .cmp-controls select {
          padding:6px 10px; border:1px solid #e5e7eb; border-radius:8px;
          font-family:'Kanit', sans-serif; font-size:12.5px; background:#fff; cursor:pointer;
        }
        .cmp-controls select:focus { outline:2px solid var(--role-color, #f97316); outline-offset:1px; }
        .cmp-period-info { font-size:11.5px; color:#9ca3af; font-family:'IBM Plex Mono', monospace; }

        .cmp-kpi-grid { display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; margin-bottom:16px; }
        @media (max-width: 768px) { .cmp-kpi-grid { grid-template-columns:repeat(2, 1fr); } }

        .cmp-kpi {
          background:#f9fafb; border:1px solid #e5e7eb; border-radius:10px; padding:12px;
          display:flex; flex-direction:column; gap:4px; min-width:0;
        }
        .cmp-kpi-label { font-size:11px; color:#6b7280; font-weight:500; }
        .cmp-kpi-val { font-size:22px; font-weight:700; color:#111827; line-height:1; font-family:'IBM Plex Mono', monospace; }
        .cmp-kpi-val.pass { color:#10b981; }
        .cmp-kpi-val.fail { color:#ef4444; }
        .cmp-kpi-val.warn { color:#f59e0b; }
        .cmp-kpi-delta { font-size:11px; font-weight:600; display:flex; align-items:center; gap:3px; margin-top:2px; }
        .cmp-kpi-delta.up   { color:#10b981; }
        .cmp-kpi-delta.down { color:#ef4444; }
        .cmp-kpi-delta.flat { color:#9ca3af; }
        .cmp-kpi-prev { font-size:10.5px; color:#9ca3af; }

        .cmp-chart-wrap { position:relative; height:220px; }
        .cmp-empty { text-align:center; color:#9ca3af; font-size:13px; padding:30px; }
      </style>

      <div class="cmp-header">
        <h3>📊 เปรียบเทียบช่วงเวลา</h3>
        <div class="cmp-controls">
          <label for="cmpPeriodSelect">ช่วงเวลา:</label>
          <select id="cmpPeriodSelect">
            <option value="today">วันนี้</option>
            <option value="7d">7 วันล่าสุด</option>
            <option value="30d" selected>30 วันล่าสุด</option>
            <option value="month">เดือนนี้</option>
            <option value="quarter">ไตรมาสนี้</option>
            <option value="year">ปีนี้</option>
          </select>
        </div>
      </div>

      <div class="cmp-period-info" id="cmpPeriodInfo">—</div>

      <div class="cmp-kpi-grid" id="cmpKpiGrid"></div>

      <div class="cmp-chart-wrap">
        <canvas id="cmpChart"></canvas>
      </div>
    </section>
  `;

  tableCard.insertAdjacentHTML('beforebegin', html);
}

function getPeriodRange(period) {
  const now = new Date();
  const end = new Date(now);
  let start = new Date(now);
  let label = '';

  switch (period) {
    case 'today':
      start.setHours(0, 0, 0, 0);
      label = 'วันนี้';
      break;
    case '7d':
      start.setDate(now.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      label = '7 วันล่าสุด';
      break;
    case 'month':
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      label = `เดือน${now.toLocaleDateString('th-TH', { month: 'long' })}`;
      break;
    case 'quarter': {
      const q = Math.floor(now.getMonth() / 3);
      start = new Date(now.getFullYear(), q * 3, 1);
      label = `Q${q + 1} ${now.getFullYear()}`;
      break;
    }
    case 'year':
      start = new Date(now.getFullYear(), 0, 1);
      label = `ปี ${now.getFullYear()}`;
      break;
    case '30d':
    default:
      start.setDate(now.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      label = '30 วันล่าสุด';
  }

  // ช่วงก่อนหน้า — มีระยะเวลาเท่ากัน
  const durationMs = end - start;
  const prevEnd   = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - durationMs);

  return { start, end, prevStart, prevEnd, label };
}

function filterClaimsInRange(claims, start, end) {
  const s = start.getTime();
  const e = end.getTime();
  return claims.filter(c => {
    const d = new Date(c.claim_date || c.created_at);
    if (isNaN(d)) return false;
    const t = d.getTime();
    return t >= s && t <= e;
  });
}

function calcDelta(current, previous) {
  if (previous === 0 && current === 0) return { pct: 0, dir: 'flat' };
  if (previous === 0) return { pct: 100, dir: 'up' };
  const diff = current - previous;
  const pct = Math.round((diff / previous) * 100);
  if (pct === 0) return { pct: 0, dir: 'flat' };
  return { pct: Math.abs(pct), dir: pct > 0 ? 'up' : 'down' };
}

function deltaArrow(dir) {
  if (dir === 'up')   return '▲';
  if (dir === 'down') return '▼';
  return '—';
}

function fmtDate(d) {
  return d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' });
}

function renderComparisonCard(claims) {
  const grid = document.getElementById('cmpKpiGrid');
  const info = document.getElementById('cmpPeriodInfo');
  const canvas = document.getElementById('cmpChart');
  if (!grid || !canvas) return;

  const { start, end, prevStart, prevEnd, label } = getPeriodRange(comparePeriod);

  if (info) {
    info.textContent = `${label} · ${fmtDate(start)} → ${fmtDate(end)}  เทียบกับ  ${fmtDate(prevStart)} → ${fmtDate(prevEnd)}`;
  }

  const cur  = filterClaimsInRange(claims, start, end);
  const prev = filterClaimsInRange(claims, prevStart, prevEnd);

  const stats = (arr) => {
    const total    = arr.length;
    const approved = arr.filter(c => getEffectiveStatus(c) === 'approved').length;
    const rejected = arr.filter(c => getEffectiveStatus(c) === 'rejected').length;
    const waiting  = arr.filter(c => ['in_progress', 'pending'].includes(getEffectiveStatus(c))).length;
    const passRate = (approved + rejected) > 0 ? Math.round(approved / (approved + rejected) * 100) : 0;
    return { total, approved, rejected, waiting, passRate };
  };

  const c = stats(cur);
  const p = stats(prev);

  const kpis = [
    { label: 'ทั้งหมด', cur: c.total,    prev: p.total,    cls: '',     unit: 'ราย' },
    { label: 'Pass',    cur: c.approved, prev: p.approved, cls: 'pass', unit: 'ราย' },
    { label: 'Fail',    cur: c.rejected, prev: p.rejected, cls: 'fail', unit: 'ราย' },
    { label: 'รอตรวจ',  cur: c.waiting,  prev: p.waiting,  cls: 'warn', unit: 'ราย' },
  ];

  grid.innerHTML = kpis.map(k => {
    const d = calcDelta(k.cur, k.prev);
    return `
      <div class="cmp-kpi">
        <div class="cmp-kpi-label">${k.label}</div>
        <div class="cmp-kpi-val ${k.cls}">${k.cur.toLocaleString()}</div>
        <div class="cmp-kpi-delta ${d.dir}">
          ${deltaArrow(d.dir)} ${d.pct}%
        </div>
        <div class="cmp-kpi-prev">ช่วงก่อน: ${k.prev.toLocaleString()} ${k.unit}</div>
      </div>
    `;
  }).join('') + `
    <div class="cmp-kpi" style="grid-column: span 2;">
      <div class="cmp-kpi-label">Pass Rate</div>
      <div class="cmp-kpi-val pass">${c.passRate}%</div>
      <div class="cmp-kpi-delta ${c.passRate >= p.passRate ? 'up' : 'down'}">
        ${deltaArrow(c.passRate >= p.passRate ? 'up' : 'down')} ${Math.abs(c.passRate - p.passRate)} จุด
      </div>
      <div class="cmp-kpi-prev">ช่วงก่อน: ${p.passRate}%</div>
    </div>
  `;

  // ปรับ grid ให้รองรับ Pass Rate ที่ span 2
  grid.style.gridTemplateColumns = 'repeat(4, 1fr)';

  // กราฟเปรียบเทียบ
  if (window._cmpChart) window._cmpChart.destroy();
  if (typeof Chart === 'undefined') return;

  window._cmpChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: ['ทั้งหมด', 'Pass', 'Fail', 'รอตรวจ'],
      datasets: [
        {
          label: `ช่วงก่อน (${fmtDate(prevStart)} - ${fmtDate(prevEnd)})`,
          data: [p.total, p.approved, p.rejected, p.waiting],
          backgroundColor: CHART_COLORS.prevPeriod,
          borderRadius: 6,
        },
        {
          label: `ช่วงนี้ (${fmtDate(start)} - ${fmtDate(end)})`,
          data: [c.total, c.approved, c.rejected, c.waiting],
          backgroundColor: ['#6366f1', CHART_COLORS.pass, CHART_COLORS.fail, CHART_COLORS.pending],
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true, position: 'bottom',
          labels: { font: { size: 11, family: "'Kanit', sans-serif" }, boxWidth: 12, padding: 10 },
        },
        tooltip: {
          backgroundColor: CHART_COLORS.tooltipBg,
          titleColor: CHART_COLORS.tooltipDim,
          bodyColor:  CHART_COLORS.tooltipText,
          padding: 10, cornerRadius: 8,
        }
      },
      scales: {
        x: { grid: { display: false }, border: { display: false },
             ticks: { color: CHART_COLORS.axis, font: { size: 11, family: "'Kanit', sans-serif" } } },
        y: { grid: { color: CHART_COLORS.grid }, border: { display: false },
             ticks: {
               color: CHART_COLORS.axis, font: { size: 11, family: "'Kanit', sans-serif" },
               stepSize: 1, callback: v => Number.isInteger(v) ? v : null
             } },
      },
    },
  });
}

/* =================================================
   🗓️ CALENDAR
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
    if (day === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
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
   📷 AVATAR UPLOAD
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
    if (!file.type.startsWith('image/')) { alert('กรุณาเลือกไฟล์รูปภาพเท่านั้น'); return; }
    if (file.size > 2 * 1024 * 1024) { alert('ไฟล์ใหญ่เกินไป (ไม่เกิน 2MB)'); return; }

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

    try {
      const { data: oldProfile } = await supabaseClient
        .from('profiles').select('avatar_url').eq('id', user.id).single();
      if (oldProfile?.avatar_url) {
        const oldFileName = oldProfile.avatar_url.split('/').pop();
        if (oldFileName && !oldFileName.includes('default')) {
          await supabaseClient.storage.from('avatars').remove([oldFileName]);
        }
      }
    } catch (_) {}

    const { error: uploadError } = await supabaseClient.storage
      .from('avatars')
      .upload(fileName, file, { cacheControl: '3600', upsert: true });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabaseClient.storage.from('avatars').getPublicUrl(fileName);
    const publicUrl = urlData.publicUrl;

    const { error: updateError } = await supabaseClient
      .from('profiles').update({ avatar_url: publicUrl }).eq('id', user.id);
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
  try { await supabaseClient.auth.signOut(); } catch (_) {}
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

console.log('QC Dashboard V3 (Fixed status field + Comparison Card) loaded 🚀');