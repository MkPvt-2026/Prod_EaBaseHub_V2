// ======================================================
// rfmDashboard.js
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
// 🎨 SEGMENT CONFIG (v7: 4 segments)
// ======================================================
const SEGMENT_META = {
  'ลูกค้าประจำ': {
    class: 'seg-regular',
    color: '#1D9E75',
    icon: '🟢',
    desc: 'ซื้อล่าสุด · บ่อย · ใช้เงินสูง',
    action: 'รักษาเป็น VIP, ให้สิทธิพิเศษ, early access สินค้าใหม่, ขอ testimonial เพื่อ marketing'
  },
  'ลูกค้าใหม่/เริ่มซื้อ': {
    class: 'seg-new',
    color: '#378ADD',
    icon: '🔵',
    desc: 'ซื้อล่าสุด · ยอดยังไม่สูง',
    action: 'กระตุ้นให้ซื้อต่อ, แนะนำสินค้าเพิ่ม, สร้าง engagement, ให้ส่วนลดการซื้อครั้งถัดไป'
  },
  'ลูกค้าเก่าหายไป': {
    class: 'seg-lost-back',
    color: '#E24B4A',
    icon: '🟠',
    desc: 'เคยซื้อดี · แต่หายไปนาน',
    action: 'Win-back ด่วน, โทรสอบถามจากพนักงานขาย, เสนอโปรโมชั่นแรง, ติดต่อส่วนตัวจากผู้บริหาร'
  },
  'ลูกค้าทิ้งห่าง': {
    class: 'seg-inactive',
    color: '#888780',
    icon: '⚪',
    desc: 'ห่างหายนาน · ยอดน้อย',
    action: 'พิจารณาลด cost การตลาด, ทำ final win-back campaign, หรือยอมรับว่าลูกค้าเปลี่ยนไป'
  }
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

  // 🔥 Interaction filter (ใช้ sync ทั้ง dashboard)
  let interactionFilter = {
    segment: null,
    r: null,
    f: null
  };

  // 🆕 Drill-down state (3 ชั้น: segment → province → customer)
  let drillState = {
    level: 'segment',   // 'segment' | 'province' | 'customer'
    segment: null,
    province: null
  };

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
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
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
      console.log('📥 Loading customer_rfm...');

      const range = (typeof DateFilter !== 'undefined') ? DateFilter.getRange() : { start: null, end: null };
      const hasFilter = range.start || range.end;

      const all = [];

      if (hasFilter) {
        // ใช้ RPC เมื่อมี filter
        const { data, error } = await supabaseClient.rpc('get_customer_rfm_by_range', {
          p_start_date: range.start,
          p_end_date: range.end
        });
        if (error) throw error;
        all.push(...(data || []));
      } else {
        // ไม่มี filter ใช้ view ตรงๆ (paginate)
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
      }

      allData = all;
      console.log(`✅ Loaded ${allData.length} customer records`);

      const latest = allData
        .map(r => r.last_purchase_date)
        .filter(Boolean)
        .sort()
        .pop();
      $('lastUpdated').textContent = latest
        ? new Date(latest).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
        : '-';
      $('totalRowsInfo').textContent = `${fmt(allData.length)} ลูกค้า` + (hasFilter ? ' (ในช่วงที่กรอง)' : '');

      hideEl('loadingBox');
      showEl('dashboard');

      // reset interaction filter และ drill state เมื่อ reload ข้อมูลใหม่
      interactionFilter = { segment: null, r: null, f: null };
      drillState = { level: 'segment', segment: null, province: null };

      populateFilters();
      applyFilters();
      renderActionList();
      renderDrillBreadcrumb();

    } catch (err) {
      console.error('❌ loadData error:', err);
      hideEl('loadingBox');
      showError('โหลดข้อมูลไม่สำเร็จ: ' + (err.message || err) +
                ' (ตรวจสอบว่าสร้าง view customer_rfm และ function get_customer_rfm_by_range ใน Supabase แล้ว)');
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
      // 🔹 filter ปกติ
      if (seg && r.segment !== seg) return false;
      if (emp && r.employee_name !== emp) return false;
      if (prov && r.province !== prov) return false;

      if (q) {
        const hay = `${r.client_id || ''} ${r.client_name || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      // 🔥 filter จากการคลิก (interactionFilter เดิม)
      if (interactionFilter.segment && r.segment !== interactionFilter.segment) return false;
      if (interactionFilter.r && r.r_score != interactionFilter.r) return false;
      if (interactionFilter.f && r.f_score != interactionFilter.f) return false;

      // 🆕 drill filter
      if (drillState.segment && r.segment !== drillState.segment) return false;
      if (drillState.province && r.province !== drillState.province) return false;

      return true;
    });

    currentPage = 1;
    sortData();
    updateActiveLabel();
    renderAll(); // 🔥 ทำให้ทุกอย่าง sync
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
  // ACTIVE LABEL
  // -----------------------------
  function updateActiveLabel() {
    const el = $('activeFilterLabel');
    if (!el) return;

    let text = '';
    // แสดง drill state ก่อน ถ้ามี
    if (drillState.province) {
      text = `กำลังดูจังหวัด: ${drillState.province} (ใน ${drillState.segment})`;
    } else if (drillState.segment) {
      text = `กำลังดู Segment: ${drillState.segment} → แบ่งตามจังหวัด`;
    } else if (interactionFilter.segment) {
      text = `กำลังดู Segment: ${interactionFilter.segment}`;
    } else if (interactionFilter.r) {
      text = `กำลังดู R=${interactionFilter.r}, F=${interactionFilter.f}`;
    }
    el.textContent = text;
    el.style.display = text ? 'inline-block' : 'none';
  }

  // -----------------------------
  // RESET INTERACTION
  // -----------------------------
  function resetInteraction() {

  // =========================
  // RESET INTERACTION STATE
  // =========================
  interactionFilter = {
    segment: null,
    r: null,
    f: null
  };

  drillState = {
    level: 'segment',
    segment: null,
    province: null
  };

  // =========================
  // RESET SEARCH / FILTER
  // =========================
  document.getElementById('searchInput').value = '';
  document.getElementById('segmentFilter').value = '';
  document.getElementById('employeeFilter').value = '';
  document.getElementById('provinceFilter').value = '';

  // =========================
  // RESET ACTIVE LABEL
  // =========================
  const label = document.getElementById('activeFilterLabel');

  if (label) {
    label.style.display = 'none';
    label.innerHTML = '';
  }

  // =========================
  // RESET DATE FILTER
  // =========================
  if (typeof DateFilter !== 'undefined') {
    DateFilter.reset();
  }

  // =========================
  // RESET PRODUCT FILTERS
  // =========================
  const productSearch = document.getElementById('productSearchInput');
  const productCategory = document.getElementById('productCategoryFilter');
  const productBrand = document.getElementById('productBrandFilter');

  if (productSearch) productSearch.value = '';
  if (productCategory) productCategory.value = '';
  if (productBrand) productBrand.value = '';

  // =========================
  // RESET PRODUCT DRILLDOWN
  // =========================
  if (typeof Product !== 'undefined') {

    Product.drillPath = [];

    const dimension = document.getElementById('drillDimension');
    const sortBy = document.getElementById('drillSortBy');
    const topN = document.getElementById('drillTopN');

    if (dimension) dimension.value = 'category';
    if (sortBy) sortBy.value = 'revenue';
    if (topN) topN.value = '20';

    if (typeof Product.drillReset === 'function') {
      Product.drillReset();
    }

    if (typeof Product.applyFilters === 'function') {
      Product.applyFilters();
    }
  }

  // =========================
  // RENDER + RELOAD
  // =========================
  renderDrillBreadcrumb();
  applyFilters();
}

  // -----------------------------
  // 🆕 DRILL-DOWN FUNCTIONS
  // -----------------------------

  /**
   * แสดง breadcrumb ตาม drillState ปัจจุบัน
   */
  function renderDrillBreadcrumb() {
    const el = $('drillBreadcrumb');
    if (!el) return;

    let html = `<span class="breadcrumb-item" onclick="RFM.drillReset()">🏠 ทั้งหมด</span>`;

    if (drillState.segment) {
      html += ` <span class="breadcrumb-sep">›</span>
                <span class="breadcrumb-item" onclick="RFM.drillToSegment('${escapeHtml(drillState.segment)}')">
                  ${escapeHtml(drillState.segment)}
                </span>`;
    }

    if (drillState.province) {
      html += ` <span class="breadcrumb-sep">›</span>
                <span class="breadcrumb-current">${escapeHtml(drillState.province)}</span>`;
    }

    el.innerHTML = html;
  }

  /**
   * รีเซ็ต drill กลับมาระดับ segment
   */
  function drillReset() {
    drillState = { level: 'segment', segment: null, province: null };
    renderDrillBreadcrumb();
    applyFilters();
  }

  /**
   * ไป level จังหวัดของ segment ที่เลือก
   */
  function drillToSegment(seg) {
    drillState.level = 'province';
    drillState.segment = seg;
    drillState.province = null;
    renderDrillBreadcrumb();
    applyFilters();
  }

  /**
   * ไป level ลูกค้าของจังหวัดที่เลือก
   */
  function drillToProvince(province) {
    drillState.level = 'customer';
    drillState.province = province;
    renderDrillBreadcrumb();
    applyFilters();
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
    const champs = filteredData.filter(r => r.segment === 'ลูกค้าประจำ').length;
    const atRisk = filteredData.filter(r => r.segment === 'ลูกค้าเก่าหายไป' || r.segment === 'ลูกค้าทิ้งห่าง').length;
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
    // 🆕 เลือก groupKey ตาม drill level
    const groupKey = drillState.level === 'province' || drillState.level === 'customer'
      ? 'province'
      : 'segment';

    const byGroup = {};
    filteredData.forEach(r => {
      const key = r[groupKey] || 'ไม่ระบุ';
      if (!byGroup[key]) byGroup[key] = { count: 0, revenue: 0 };
      byGroup[key].count++;
      byGroup[key].revenue += Number(r.monetary_value || 0);
    });

    const labels = Object.keys(byGroup).sort((a, b) => byGroup[b].revenue - byGroup[a].revenue);
    const counts = labels.map(l => byGroup[l].count);
    const revenues = labels.map(l => byGroup[l].revenue);

    // สีตาม groupKey
    const colors = groupKey === 'segment'
      ? labels.map(s => SEGMENT_META[s]?.color || '#888780')
      : labels.map((_, i) => `hsl(${(i * 37) % 360}, 55%, 50%)`);

    // 🆕 chart title ตาม level
    const segTitle = drillState.level === 'province' || drillState.level === 'customer'
      ? 'จำนวนลูกค้าตามจังหวัด'
      : 'จำนวนลูกค้าตาม Segment';
    const revTitle = drillState.level === 'province' || drillState.level === 'customer'
      ? 'รายได้ตามจังหวัด'
      : 'รายได้ตาม Segment';

    // อัปเดต heading ถ้ามี element
    const segChart = document.querySelector('#chartSegments')?.closest('.chart-card')?.querySelector('h3');
    const revChart = document.querySelector('#chartRevenue')?.closest('.chart-card')?.querySelector('h3');
    if (segChart) segChart.textContent = segTitle;
    if (revChart) revChart.textContent = revTitle;

    // Donut: count — คลิกได้
    if (charts.segments) charts.segments.destroy();
    charts.segments = new Chart($('chartSegments'), {
      type: 'doughnut',
      data: { labels, datasets: [{ data: counts, backgroundColor: colors, borderWidth: 0 }] },
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
        },
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const clickedLabel = labels[elements[0].index];
          _handleChartClick(clickedLabel);
        }
      }
    });

    // Bar: revenue — คลิกได้
    if (charts.revenue) charts.revenue.destroy();
    charts.revenue = new Chart($('chartRevenue'), {
      type: 'bar',
      data: { labels, datasets: [{ data: revenues, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => fmtCompact(ctx.parsed.y) } }
        },
        scales: {
          y: { beginAtZero: true, ticks: { callback: v => fmtCompact(v), font: { size: 11 } } },
          x: { ticks: { font: { size: 10 }, maxRotation: 45, autoSkip: false } }
        },
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const clickedLabel = labels[elements[0].index];
          _handleChartClick(clickedLabel);
        }
      }
    });
  }

  /**
   * 🆕 Handler คลิก chart → drill ตาม level ปัจจุบัน
   */
  function _handleChartClick(label) {
    if (drillState.level === 'segment') {
      // ระดับ segment → ไปจังหวัด
      drillState.level = 'province';
      drillState.segment = label;
      drillState.province = null;
      // ล้าง interactionFilter เก่าออก
      interactionFilter = { segment: null, r: null, f: null };

    } else if (drillState.level === 'province') {
      // ระดับจังหวัด → ไปลูกค้า
      drillState.level = 'customer';
      drillState.province = label;

    } else {
      // ระดับ customer (ลูกค้า) → ไม่ drill ต่อแล้ว ตารางด้านล่างแสดงอยู่แล้ว
      return;
    }

    renderDrillBreadcrumb();
    applyFilters();
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

        // 🔥 highlight ช่องที่กำลัง active
        const isActive = interactionFilter.r == r && interactionFilter.f == f;
        const border = isActive ? '2px solid #000' : 'none';

        html += `
          <div class="heat-cell"
               data-r="${r}"
               data-f="${f}"
               style="background:${bg}; color:${color}; border:${border}"
               title="R=${r}, F=${f}: ${count} ลูกค้า">
            ${count || ''}
          </div>`;
      }
    }
    $('heatmap').innerHTML = html;

    // 🔥 ใส่ event คลิก heatmap → filter R/F
    document.querySelectorAll('.heat-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        interactionFilter.r = cell.dataset.r;
        interactionFilter.f = cell.dataset.f;
        interactionFilter.segment = null;

        applyFilters();
      });
    });
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
        <div class="seg-card ${meta.class} clickable"
             onclick="RFM.filterBySegment('${escapeHtml(seg).replace(/'/g, "\\'")}')"
             title="คลิกเพื่อดูรายชื่อลูกค้าในกลุ่มนี้">
          <div class="seg-title">${meta.icon || ''} ${escapeHtml(seg)} <span class="seg-arrow">→</span></div>
          <div class="seg-count">${segCounts[seg]} ลูกค้า · ${escapeHtml(meta.desc || '')}</div>
          <div class="seg-action">${escapeHtml(meta.action)}</div>
        </div>
      `).join('');

    $('actionList').innerHTML = html || '<div class="empty">ยังไม่มีข้อมูล</div>';
  }

  // -----------------------------
  // 🆕 FILTER BY SEGMENT (เรียกจาก action card)
  // -----------------------------
  function filterBySegment(segment) {
    // เซ็ต DOM dropdown ให้ตรงกับที่คลิก
    $('segmentFilter').value = segment;
    $('searchInput').value = '';
    $('employeeFilter').value = '';
    $('provinceFilter').value = '';

    // เคลียร์ interaction & drill state แล้วเซ็ต segment filter ใหม่
    interactionFilter = { segment: null, r: null, f: null };
    drillState = { level: 'segment', segment: null, province: null };
    renderDrillBreadcrumb();

    applyFilters();

    // Smooth scroll ไปที่ตาราง + pulse highlight
    const tableCard = document.querySelector('#tab-rfm .table-card');
    if (tableCard) {
      tableCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      tableCard.classList.add('highlight-pulse');
      setTimeout(() => tableCard.classList.remove('highlight-pulse'), 1500);
    }
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
      const meta = SEGMENT_META[r.segment] || { class: 'seg-inactive' };
      return `
        <tr>
          <!-- <td>${escapeHtml(r.client_id || '')}</td> -->
          <td title="รหัสลูกค้า: ${escapeHtml(r.client_id || '')}">🏪 ${escapeHtml(r.client_name || '')}</td>
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
      // 'รหัสลูกค้า': r.client_id,
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
   document.getElementById('searchInput')
  .addEventListener('input', debounce(applyFilters, 250));
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

  // -----------------------------
  // PUBLIC API
  // -----------------------------
  return {
    init,
    reload,
    exportCSV,
    exportXLSX,
    nextPage,
    prevPage,
    resetInteraction,   // ล้าง interactionFilter + drillState
    drillReset,         // 🆕 กลับ level แรก
    drillToSegment,     // 🆕 breadcrumb: กลับไป segment level
    drillToProvince,    // 🆕 breadcrumb: กลับไป province level (ถ้าต้องการ)
    filterBySegment     // 🆕 คลิก action card → filter ดูร้านในกลุ่ม
  };

})();

// Export to window
window.RFM = RFM;

console.log('✅ rfm-dashboard.js loaded (drill-down 3 ชั้น)');