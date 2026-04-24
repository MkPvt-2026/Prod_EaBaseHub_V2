// ======================================================
// rfm-dashboard.js
// RFM Analysis Dashboard for Executive/Admin
// ต้องโหลด supabaseClient.js + Chart.js + xlsx.js ก่อนไฟล์นี้
// ======================================================

// ตรวจสอบ dependencies
if (typeof supabaseClient === 'undefined') {
  console.error('❌ supabaseClient ไม่พร้อมใช้งาน!');
}
if (typeof Chart === 'undefined') {
  console.error('❌ Chart.js ไม่พร้อมใช้งาน!');
}

// ======================================================
// 🎨 SEGMENT CONFIG
// ข้อมูล metadata ของแต่ละ segment (สี + action แนะนำ)
// ======================================================
const SEGMENT_META = {
  'Champions':          { class: 'seg-champions',   color: '#1D9E75', action: 'ให้รางวัล VIP, เชิญเป็น brand advocate, ส่ง early access สินค้าใหม่' },
  'Loyal Customers':    { class: 'seg-loyal',       color: '#7F77DD', action: 'เสนอ upsell/cross-sell, โปรแกรม referral, ขอ testimonial' },
  'Potential Loyalist': { class: 'seg-potential',   color: '#378ADD', action: 'สร้าง engagement, ให้สิทธิพิเศษสมาชิก, แนะนำสินค้าเพิ่มเติม' },
  'New Customers':      { class: 'seg-new',         color: '#639922', action: 'ต้อนรับด้วย onboarding, ให้ส่วนลดการซื้อครั้งที่ 2 เพื่อสร้างนิสัย' },
  'Promising':          { class: 'seg-promising',   color: '#888780', action: 'สร้าง brand awareness, แคมเปญสร้างความสัมพันธ์' },
  'Need Attention':     { class: 'seg-attention',   color: '#BA7517', action: 'ส่งข้อเสนอพิเศษจำกัดเวลา, สำรวจความพึงพอใจ' },
  'At Risk':            { class: 'seg-risk',        color: '#E24B4A', action: 'แคมเปญ win-back ด่วน, ติดต่อส่วนตัว, เสนอโปรโมชั่นแรง' },
  'Cant Lose Them':     { class: 'seg-cant-lose',   color: '#D4537E', action: 'ติดต่อโดยตรงจากผู้บริหาร, ข้อเสนอพิเศษเฉพาะบุคคล' },
  'Hibernating':        { class: 'seg-hibernating', color: '#5F5E5A', action: 'Reactivation campaign, ส่งเนื้อหามีคุณค่า, กระตุ้นด้วยสินค้าใหม่' },
  'About to Sleep':     { class: 'seg-sleep',       color: '#D85A30', action: 'แคมเปญฟื้นสัมพันธ์, ส่วนลดพิเศษ, เตือนถึงสินค้าที่เคยซื้อ' },
  'Lost':               { class: 'seg-lost',        color: '#B4B2A9', action: 'พิจารณาประหยัด cost การตลาด หรือทำ final win-back' }
};

// ======================================================
// 🌐 RFM NAMESPACE
// ======================================================
const RFM = (function () {

  // -----------------------------
  // State
  // -----------------------------
  let allData = [];
  let filteredData = [];
  let charts = {};
  let sortKey = 'monetary_value';
  let sortDir = 'desc';
  let currentPage = 1;
  const PAGE_SIZE = 50;

  // -----------------------------
  // Utilities
  // -----------------------------
  function fmt(n) { return Math.round(Number(n) || 0).toLocaleString('th-TH'); }
  function fmtCurrency(n) { return '฿' + fmt(n); }
  function fmtCompact(n) {
    if (!n) return '฿0';
    if (n >= 1e6) return '฿' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '฿' + (n / 1e3).toFixed(1) + 'K';
    return '฿' + fmt(n);
  }
  function $(id) { return document.getElementById(id); }
  function showEl(id) { $(id)?.classList.remove('hidden'); }
  function hideEl(id) { $(id)?.classList.add('hidden'); }
  function showError(msg) {
    const box = $('errorBox');
    box.textContent = '⚠️ ' + msg;
    box.classList.remove('hidden');
  }

  // -----------------------------
  // INITIALIZE
  // -----------------------------
  async function init() {
    console.log('🎯 RFM Dashboard initializing...');
    await loadData();
    attachEvents();
  }

  async function reload() {
    hideEl('dashboard');
    showEl('loadingBox');
    await loadData();
  }

  // -----------------------------
  // LOAD DATA FROM SUPABASE
  // -----------------------------
  async function loadData() {
    try {
      console.log('📥 Loading customer_rfm from Supabase...');

      // Paginate เพราะ Supabase default limit = 1000
      const all = [];
      const PAGE = 1000;
      let from = 0;

      while (true) {
        const { data, error } = await supabaseClient
          .from('customer_rfm')
          .select('*')
          .range(from, from + PAGE - 1);

        if (error) throw error;
        all.push(...data);
        if (data.length < PAGE) break;
        from += PAGE;
      }

      allData = all;
      console.log(`✅ Loaded ${allData.length} customer records`);

      // แสดงวันที่อัปเดตล่าสุด (ใช้ last_purchase_date ล่าสุด)
      const latest = allData
        .map(r => r.last_purchase_date)
        .filter(Boolean)
        .sort()
        .pop();
      $('lastUpdated').textContent = latest
        ? new Date(latest).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
        : '-';
      $('totalRowsInfo').textContent = `${fmt(allData.length)} ลูกค้า`;

      hideEl('loadingBox');
      showEl('dashboard');

      populateFilters();
      applyFilters();
      renderActionList();

    } catch (err) {
      console.error('❌ loadData error:', err);
      hideEl('loadingBox');
      showError('โหลดข้อมูลไม่สำเร็จ: ' + (err.message || err) +
                ' (ตรวจสอบว่าสร้าง view customer_rfm ใน Supabase แล้ว)');
    }
  }

  // -----------------------------
  // FILTERS
  // -----------------------------
  function populateFilters() {
    const segSet = [...new Set(allData.map(r => r.segment).filter(Boolean))].sort();
    const empSet = [...new Set(allData.map(r => r.employee_name).filter(Boolean))].sort();
    const provSet = [...new Set(allData.map(r => r.province).filter(Boolean))].sort();

    fillSelect('segmentFilter', segSet);
    fillSelect('employeeFilter', empSet);
    fillSelect('provinceFilter', provSet);
  }

  function fillSelect(id, values) {
    const el = $(id);
    const current = el.value;
    el.innerHTML = '<option value="">ทั้งหมด</option>' +
      values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    el.value = current;
  }

  function applyFilters() {
    const q = $('searchInput').value.toLowerCase().trim();
    const seg = $('segmentFilter').value;
    const emp = $('employeeFilter').value;
    const prov = $('provinceFilter').value;

    filteredData = allData.filter(r => {
      if (seg && r.segment !== seg) return false;
      if (emp && r.employee_name !== emp) return false;
      if (prov && r.province !== prov) return false;
      if (q) {
        const hay = `${r.client_id || ''} ${r.client_name || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    currentPage = 1;
    sortData();
    renderAll();
  }

  function sortBy(key) {
    if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else { sortKey = key; sortDir = 'desc'; }
    sortData();
    renderTable();
  }

  function sortData() {
    filteredData.sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (av == null) av = '';
      if (bv == null) bv = '';
      if (typeof av === 'number' || !isNaN(Number(av))) {
        return sortDir === 'asc' ? Number(av) - Number(bv) : Number(bv) - Number(av);
      }
      return sortDir === 'asc'
        ? String(av).localeCompare(String(bv), 'th')
        : String(bv).localeCompare(String(av), 'th');
    });
  }

  // -----------------------------
  // RENDER
  // -----------------------------
  function renderAll() {
    renderKPIs();
    renderCharts();
    renderHeatmap();
    renderTable();
  }

  function renderKPIs() {
    const totalCustomers = filteredData.length;
    const totalRevenue = filteredData.reduce((s, r) => s + Number(r.monetary_value || 0), 0);
    const aov = totalCustomers ? totalRevenue / totalCustomers : 0;
    const champs = filteredData.filter(r => r.segment === 'Champions').length;
    const atRisk = filteredData.filter(r => ['At Risk', 'Cant Lose Them', 'About to Sleep'].includes(r.segment)).length;
    const avgRecency = totalCustomers
      ? filteredData.reduce((s, r) => s + Number(r.recency_days || 0), 0) / totalCustomers
      : 0;

    $('kpiCustomers').textContent = fmt(totalCustomers);
    $('kpiRevenue').textContent = fmtCompact(totalRevenue);
    $('kpiAov').textContent = fmtCompact(aov);
    $('kpiChampions').textContent = totalCustomers
      ? ((champs / totalCustomers) * 100).toFixed(1) + '%'
      : '0%';
    $('kpiAtRisk').textContent = totalCustomers
      ? ((atRisk / totalCustomers) * 100).toFixed(1) + '%'
      : '0%';
    $('kpiRecency').textContent = fmt(avgRecency) + ' วัน';
  }

  function renderCharts() {
    const bySeg = {};
    filteredData.forEach(r => {
      if (!r.segment) return;
      if (!bySeg[r.segment]) bySeg[r.segment] = { count: 0, revenue: 0 };
      bySeg[r.segment].count++;
      bySeg[r.segment].revenue += Number(r.monetary_value || 0);
    });

    const segs = Object.keys(bySeg).sort((a, b) => bySeg[b].revenue - bySeg[a].revenue);
    const counts = segs.map(s => bySeg[s].count);
    const revenues = segs.map(s => bySeg[s].revenue);
    const colors = segs.map(s => SEGMENT_META[s]?.color || '#888780');

    // Donut: count
    if (charts.segments) charts.segments.destroy();
    charts.segments = new Chart($('chartSegments'), {
      type: 'doughnut',
      data: { labels: segs, datasets: [{ data: counts, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const total = counts.reduce((a, b) => a + b, 0);
                const pct = total ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
                return `${ctx.label}: ${fmt(ctx.parsed)} คน (${pct}%)`;
              }
            }
          }
        }
      }
    });

    // Bar: revenue
    if (charts.revenue) charts.revenue.destroy();
    charts.revenue = new Chart($('chartRevenue'), {
      type: 'bar',
      data: { labels: segs, datasets: [{ data: revenues, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => fmtCompact(ctx.parsed.y) } }
        },
        scales: {
          y: { beginAtZero: true, ticks: { callback: v => fmtCompact(v), font: { size: 11 } } },
          x: { ticks: { font: { size: 10 }, maxRotation: 45, autoSkip: false } }
        }
      }
    });
  }

  function renderHeatmap() {
    // Matrix 5x5: F (rows, top=5) × R (cols)
    const matrix = Array(5).fill(0).map(() => Array(5).fill(0));
    filteredData.forEach(r => {
      const ri = (r.r_score || 1) - 1;
      const fi = (r.f_score || 1) - 1;
      if (ri >= 0 && ri < 5 && fi >= 0 && fi < 5) matrix[fi][ri]++;
    });
    const max = Math.max(...matrix.flat(), 1);

    let html = '<div class="heat-label">F\\R</div>';
    for (let r = 1; r <= 5; r++) html += `<div class="heat-label">R=${r}</div>`;
    for (let f = 5; f >= 1; f--) {
      html += `<div class="heat-label">F=${f}</div>`;
      for (let r = 1; r <= 5; r++) {
        const count = matrix[f - 1][r - 1];
        const intensity = count / max;
        const bg = `rgba(29, 158, 117, ${0.08 + intensity * 0.72})`;
        const color = intensity > 0.5 ? 'white' : '#2c2c2a';
        html += `<div class="heat-cell" style="background:${bg}; color:${color}" title="R=${r}, F=${f}: ${count} ลูกค้า">${count || ''}</div>`;
      }
    }
    $('heatmap').innerHTML = html;
  }

  function renderActionList() {
    const segCounts = {};
    allData.forEach(r => {
      if (r.segment) segCounts[r.segment] = (segCounts[r.segment] || 0) + 1;
    });

    const html = Object.entries(SEGMENT_META)
      .filter(([seg]) => segCounts[seg])
      .sort((a, b) => (segCounts[b[0]] || 0) - (segCounts[a[0]] || 0))
      .map(([seg, meta]) => `
        <div class="seg-card ${meta.class}">
          <div class="seg-title">${escapeHtml(seg)}</div>
          <div class="seg-count">${segCounts[seg]} ลูกค้า</div>
          <div class="seg-action">${escapeHtml(meta.action)}</div>
        </div>
      `).join('');

    $('actionList').innerHTML = html || '<div class="empty">ยังไม่มีข้อมูล</div>';
  }

  function renderTable() {
    $('rowCount').textContent = `${fmt(filteredData.length)} รายการ`;

    // Pagination
    const totalPages = Math.max(1, Math.ceil(filteredData.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, filteredData.length);
    const rows = filteredData.slice(start, end);

    const html = rows.map(r => {
      const meta = SEGMENT_META[r.segment] || { class: 'seg-lost' };
      return `
        <tr>
          <td>${escapeHtml(r.client_id || '')}</td>
          <td>${escapeHtml(r.client_name || '')}</td>
          <td>${escapeHtml(r.province || '')}</td>
          <td>${escapeHtml(r.employee_name || '')}</td>
          <td class="num">${fmt(r.recency_days || 0)}</td>
          <td class="num">${r.frequency_months || 0}</td>
          <td class="num">${fmtCurrency(r.monetary_value || 0)}</td>
          <td><code style="font-size: 11px;">${escapeHtml(r.rfm_score || '')}</code></td>
          <td><span class="badge ${meta.class}">${escapeHtml(r.segment || '')}</span></td>
          <td style="text-align: center;">
            <button class="btn-icon" onclick="Product.showClientProducts('${escapeHtml(r.client_id)}', '${escapeHtml(r.client_name || '')}')">📦</button>
          </td>
        </tr>`;
    }).join('');

    $('tableBody').innerHTML = html ||
      '<tr><td colspan="10" class="empty">ไม่พบข้อมูล</td></tr>';

    $('pageInfo').textContent = `แสดง ${fmt(start + 1)}-${fmt(end)} จาก ${fmt(filteredData.length)} รายการ (หน้า ${currentPage}/${totalPages})`;
  }

  // -----------------------------
  // PAGINATION
  // -----------------------------
  function nextPage() {
    const totalPages = Math.ceil(filteredData.length / PAGE_SIZE);
    if (currentPage < totalPages) {
      currentPage++;
      renderTable();
    }
  }
  function prevPage() {
    if (currentPage > 1) {
      currentPage--;
      renderTable();
    }
  }

  // -----------------------------
  // EXPORT
  // -----------------------------
  function exportCSV() {
    if (!filteredData.length) { alert('ไม่มีข้อมูลให้ export'); return; }
    const headers = ['รหัสลูกค้า', 'ชื่อลูกค้า', 'จังหวัด', 'พนักงาน', 'ซื้อล่าสุด',
                     'Recency_วัน', 'Frequency_เดือน', 'Monetary', 'R', 'F', 'M', 'RFM', 'Segment'];
    const rows = filteredData.map(r => [
      r.client_id, r.client_name, r.province, r.employee_name,
      r.last_purchase_date, r.recency_days, r.frequency_months, r.monetary_value,
      r.r_score, r.f_score, r.m_score, r.rfm_score, r.segment
    ]);
    const csv = [headers, ...rows]
      .map(row => row.map(v => `"${(v ?? '').toString().replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `rfm_export_${today()}.csv`);
  }

  function exportXLSX() {
    if (!filteredData.length) { alert('ไม่มีข้อมูลให้ export'); return; }
    const rows = filteredData.map(r => ({
      'รหัสลูกค้า': r.client_id,
      'ชื่อลูกค้า': r.client_name,
      'จังหวัด': r.province,
      'พนักงาน': r.employee_name,
      'ซื้อล่าสุด': r.last_purchase_date,
      'Recency (วัน)': r.recency_days,
      'Frequency (เดือน)': r.frequency_months,
      'Monetary (บาท)': r.monetary_value,
      'R': r.r_score, 'F': r.f_score, 'M': r.m_score,
      'RFM Score': r.rfm_score,
      'Segment': r.segment
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'RFM');
    XLSX.writeFile(wb, `rfm_export_${today()}.xlsx`);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // -----------------------------
  // EVENT LISTENERS
  // -----------------------------
  function attachEvents() {
    $('searchInput').addEventListener('input', debounce(applyFilters, 250));
    $('segmentFilter').addEventListener('change', applyFilters);
    $('employeeFilter').addEventListener('change', applyFilters);
    $('provinceFilter').addEventListener('change', applyFilters);

    // Sort ตาราง: ใช้ data-sort attribute
    document.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => sortBy(th.dataset.sort));
    });
  }

  // -----------------------------
  // HELPERS
  // -----------------------------
  function today() { return new Date().toISOString().slice(0, 10); }
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // -----------------------------
  // PUBLIC API
  // -----------------------------
  return {
    init,
    reload,
    exportCSV,
    exportXLSX,
    nextPage,
    prevPage
  };

})();

// Export to window
window.RFM = RFM;

console.log('✅ rfm-dashboard.js loaded');