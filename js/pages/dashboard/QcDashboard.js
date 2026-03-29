// ============================================================
// QcDashboard.js
// ============================================================

let allClaims = [];

async function waitForSupabase(maxMs = 5000) {
  const start = Date.now();
  while (typeof supabaseClient === 'undefined') {
    if (Date.now() - start > maxMs) return false;
    await new Promise(r => setTimeout(r, 100));
  }
  return true;
}

document.addEventListener('DOMContentLoaded', async () => {
  setCurrentDate();

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn && typeof logout === 'function') logoutBtn.addEventListener('click', logout);

  const ready = await waitForSupabase();
  if (!ready) { showLoadingError(); return; }

  if (typeof protectPage === 'function')
    await protectPage(['admin','adminQc','manager','executive']);
  
  await loadDashboardData();

  const filterEl = document.getElementById('filterStatus');
  if (filterEl) filterEl.addEventListener('change', filterTable);
});

function setCurrentDate() {
  const el = document.getElementById('currentDate');
  if (!el) return;
  el.textContent = new Date().toLocaleDateString('th-TH', { year:'numeric', month:'long', timeZone:'Asia/Bangkok' });
}

async function loadDashboardData() {
  try {
    showSkeletons();
    const { data, error } = await supabaseClient
      .from('claims')
      .select('id,status,claim_date,created_at,emp_name,area,customer,product,qty,claim_types,detail,media_urls,qc_comment')
      .in('status', ['submitted','approved','rejected'])
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
  } catch (err) {
    console.error(err);
    showLoadingError();
  }
}

function renderKPICards(claims) {
  const total    = claims.length;
  const approved = claims.filter(c => c.status === 'approved').length;
  const rejected = claims.filter(c => c.status === 'rejected').length;
  const pending  = claims.filter(c => c.status === 'submitted').length;
  const passRate = (approved + rejected) > 0 ? Math.round(approved / (approved + rejected) * 100) : 0;
  const approveRate = total > 0 ? Math.round(approved / total * 100) : 0;
  setKPI('kpi-total',    total,    `จาก ${total} รายการ`);
  setKPI('kpi-pass',     approved, `${passRate}% อัตราผ่าน`, 'pass');
  setKPI('kpi-fail',     rejected, `${100-passRate}% ไม่ผ่าน`, 'fail');
  setKPI('kpi-pending',  pending,  'รอพิจารณา', 'warn');
  setKPI('kpi-claims',   total,    'เดือนนี้');
  setKPI('kpi-approved', approved, `${approveRate}% อัตราอนุมัติ`, 'pass');
}

function setKPI(id, value, subText, colorClass) {
  const card = document.getElementById(id);
  if (!card) return;
  const valEl = card.querySelector('.kpi-val');
  const subEl = card.querySelector('.kpi-sub');
  if (valEl) { valEl.textContent = value.toLocaleString(); valEl.className = 'kpi-val'; if (colorClass) valEl.classList.add(colorClass); }
  if (subEl && subText) subEl.textContent = subText;
}

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
      labels: ['Pass','Fail','รอตรวจ'],
      datasets: [{ data:[approved,rejected,pending], backgroundColor:['#3fb950','#f85149','#d29922'], borderColor:['#161b22','#161b22','#161b22'], borderWidth:3, hoverOffset:6 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%',
      plugins: { legend:{ display:false }, tooltip:{ callbacks:{ label: ctx => { const pct = total > 0 ? Math.round(ctx.parsed/total*100) : 0; return ` ${ctx.label}: ${ctx.parsed} ราย (${pct}%)`; } } } },
    },
  });
  const legend = document.getElementById('pfLegend');
  if (legend) {
    legend.innerHTML = [
      { cls:'dot-pass', label:'Pass',   count:approved, pct:pPass, color:'#3fb950' },
      { cls:'dot-fail', label:'Fail',   count:rejected, pct:pFail, color:'#f85149' },
      { cls:'dot-pend', label:'รอตรวจ', count:pending,  pct:pPend, color:'#d29922' },
    ].map(item => `
      <div class="legend-item">
        <div class="legend-left"><span class="dot ${item.cls}"></span><span class="legend-label">${item.label}</span></div>
        <span class="legend-count">${item.count} ราย · ${item.pct}%</span>
      </div>
      <div class="legend-bar" style="margin-bottom:4px">
        <div class="legend-bar-fill" style="width:${item.pct}%;background:${item.color}"></div>
      </div>`).join('');
  }
}

function renderRecentClaims(claims) {
  const container = document.getElementById('claimList');
  if (!container) return;
  const recent = claims.slice(0, 5);
  if (recent.length === 0) { container.innerHTML = `<div style="color:var(--text-2);font-size:.75rem;padding:10px 0">ยังไม่มีข้อมูล</div>`; return; }
  const statusMap = { submitted:{label:'รอพิจารณา',cls:'sb-pending'}, approved:{label:'อนุมัติ',cls:'sb-pass'}, rejected:{label:'ไม่อนุมัติ',cls:'sb-fail'} };
  container.innerHTML = recent.map(c => {
    const s  = statusMap[c.status] || { label:c.status, cls:'sb-pending' };
    const id = (c.id||'').substring(0,8).toUpperCase();
    const dt = formatDate(c.claim_date || c.created_at);
    return `<div class="claim-row"><div><div class="claim-id">CL-${id}</div><div class="claim-meta">${c.product||'—'} · ${dt}</div></div><span class="status-badge ${s.cls}">${s.label}</span></div>`;
  }).join('');
}

function renderTable(data) {
  const tbody = document.getElementById('productTable');
  if (!tbody) return;
  if (!data || data.length === 0) { tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:36px;color:var(--text-2)">ไม่พบข้อมูล</td></tr>`; return; }
  tbody.innerHTML = data.map(r => {
    const scoreVal   = r.status === 'approved' ? 100 : r.status === 'rejected' ? 30 : 60;
    const scoreColor = r.status === 'approved' ? 'var(--pass)' : r.status === 'rejected' ? 'var(--fail)' : 'var(--warn)';
    const scoreLabel = r.status === 'approved' ? 'ผ่าน' : r.status === 'rejected' ? 'ไม่ผ่าน' : 'รอตรวจ';
    const sMap = { submitted:{label:'รอตรวจ',cls:'sb-pending'}, approved:{label:'Pass',cls:'sb-pass'}, rejected:{label:'Fail',cls:'sb-fail'} };
    const s = sMap[r.status] || { label:r.status, cls:'sb-pending' };
    return `<tr>
      <td><span class="td-id">${(r.id||'').substring(0,8).toUpperCase()}</span></td>
      <td class="td-product">${r.product||'—'}</td>
      <td><span class="td-date">${r.claim_date ? formatDate(r.claim_date) : '—'}</span></td>
      <td class="text-right" style="font-family:var(--mono);font-size:.78rem">${r.qty||'—'}</td>
      <td><div class="score-wrap"><span class="score-label" style="color:${scoreColor}">${scoreLabel}</span><div class="score-bar"><div class="score-fill" style="width:${scoreVal}%;background:${scoreColor}"></div></div></div></td>
      <td><span class="status-badge ${s.cls}">${s.label}</span></td>
      <td class="td-emp">${r.emp_name||'—'}</td>
    </tr>`;
  }).join('');
}

function filterTable() {
  const filter = document.getElementById('filterStatus')?.value;
  const sMap = { pass:'approved', fail:'rejected', pending:'submitted' };
  const dbStatus = sMap[filter] || filter;
  renderTable(dbStatus ? allClaims.filter(r => r.status === dbStatus) : allClaims);
}

function renderClaimSummary(claims) {
  const container = document.getElementById('claimSummary');
  if (!container) return;
  const countMap = {};
  claims.forEach(c => { (Array.isArray(c.claim_types) ? c.claim_types : []).forEach(t => { countMap[t] = (countMap[t]||0)+1; }); });
  const sorted = Object.entries(countMap).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const maxVal = sorted[0]?.[1] || 1;
  if (sorted.length === 0) { container.innerHTML = `<div class="sum-row"><span class="sum-label" style="color:var(--text-2)">ยังไม่มีข้อมูล</span></div>`; return; }
  container.innerHTML = sorted.map(([label,count]) => `
    <div class="sum-row">
      <div class="sum-row-inner"><span class="sum-label">${label}</span><div class="sum-bar"><div class="sum-bar-fill" style="width:${Math.round(count/maxVal*100)}%"></div></div></div>
      <span class="sum-val">${count}</span>
    </div>`).join('') + `<div class="sum-total-row"><span class="sum-total-label">รวมทั้งหมด</span><span class="sum-total-val">${claims.length} ราย</span></div>`;
}

function renderTrendChart(claims) {
  const canvas = document.getElementById('trendChart');
  if (!canvas || typeof Chart === 'undefined') return;
  const months = [], labels = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
    labels.push(d.toLocaleDateString('th-TH', { month:'short' }));
  }
  const passData = months.map(m => claims.filter(c => c.status==='approved' && (c.claim_date||c.created_at||'').startsWith(m)).length);
  const failData = months.map(m => claims.filter(c => c.status==='rejected' && (c.claim_date||c.created_at||'').startsWith(m)).length);
  if (window._trendChart) window._trendChart.destroy();
  window._trendChart = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets: [
      { label:'Pass (อนุมัติ)', data:passData, backgroundColor:'#3fb950', borderRadius:4, stack:'stack', borderSkipped:false },
      { label:'Fail (ปฏิเสธ)', data:failData, backgroundColor:'#f85149', borderRadius:4, stack:'stack', borderSkipped:false },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend:{display:false}, tooltip:{ backgroundColor:'#21262d', borderColor:'rgba(255,255,255,.1)', borderWidth:1, titleColor:'#8b949e', bodyColor:'#e6edf3', callbacks:{ label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y} ราย` } } },
      scales: {
        x: { stacked:true, grid:{display:false}, border:{display:false}, ticks:{color:'#484f58', font:{size:11,family:"'IBM Plex Sans Thai',sans-serif"}} },
        y: { stacked:true, grid:{color:'rgba(255,255,255,.05)'}, border:{display:false}, ticks:{color:'#484f58', font:{size:11,family:"'IBM Plex Sans Thai',sans-serif"}, stepSize:1, callback: v => Number.isInteger(v)?v:null} },
      },
    },
  });
}

function showSkeletons() {
  const tbody = document.getElementById('productTable');
  if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:36px;color:var(--text-2)">⏳ กำลังโหลดข้อมูล...</td></tr>`;
  const cl = document.getElementById('claimList');
  if (cl) cl.innerHTML = `<div style="color:var(--text-2);font-size:.75rem;padding:10px 0">⏳ กำลังโหลด...</div>`;
}

function showLoadingError() {
  const tbody = document.getElementById('productTable');
  if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:36px;color:var(--fail)">❌ โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่</td></tr>`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return '—';
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

function renderTopProductsChart(claims) {
  const canvas = document.getElementById('topProductChart');
  if (!canvas || typeof Chart === 'undefined') return;

  // นับจำนวนตามชื่อสินค้า
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
        { label: 'อนุมัติ',      data: passData, backgroundColor: '#3fb950', borderRadius: 4, stack: 'stack', borderSkipped: false },
        { label: 'ปฏิเสธ',      data: failData, backgroundColor: '#f85149', borderRadius: 4, stack: 'stack', borderSkipped: false },
        { label: 'รอตรวจสอบ',   data: pendData, backgroundColor: '#d29922', borderRadius: 4, stack: 'stack', borderSkipped: false },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#21262d',
          borderColor: 'rgba(255,255,255,.1)',
          borderWidth: 1,
          titleColor: '#8b949e',
          bodyColor: '#e6edf3',
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.x} ราย` },
        },
      },
      scales: {
        x: { stacked: true, grid: { color: 'rgba(255,255,255,.05)' }, border: { display: false }, ticks: { color: '#484f58', font: { size: 11, family: "'IBM Plex Sans Thai',sans-serif" }, stepSize: 1, callback: v => Number.isInteger(v) ? v : null } },
        y: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { color: '#8b949e', font: { size: 11, family: "'IBM Plex Sans Thai',sans-serif" } } },
      },
    },
  });
}