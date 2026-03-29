// =====================================================
// adminQC.js
// หน้า QC Dashboard — ตรวจสอบ อนุมัติ ปฏิเสธ Export
// ต้องโหลดหลัง supabaseClient.js, userService.js, auth.js
// =====================================================

// =====================================================
// STATE — เก็บข้อมูล global ของหน้า
// =====================================================
let allClaims      = [];   // ข้อมูลทั้งหมดจาก DB
let filteredClaims = [];   // ข้อมูลหลัง filter
let currentClaim   = null; // claim ที่กำลังดูใน modal

// =====================================================
// 🛡️ ESCAPE HTML — ป้องกัน XSS
// =====================================================
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// =====================================================
// 🔄 รอให้ Supabase พร้อม
// =====================================================
async function waitForSupabase() {
  let attempts = 0;
  while (typeof supabaseClient === 'undefined' && attempts < 50) {
    await new Promise(r => setTimeout(r, 100));
    attempts++;
  }
  return typeof supabaseClient !== 'undefined';
}

// =====================================================
// 🚀 INIT
// =====================================================
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const ready = await waitForSupabase();
    if (!ready) { alert('ไม่สามารถเชื่อมต่อระบบได้'); return; }
    
    setupLogout();

    await protectPage(["admin", "adminQc", "adminqc"]);

    // โหลดข้อมูล
    await loadClaims();

    // Setup
    setupEventListeners();

  } catch (err) {
    console.error('❌ Init error:', err);
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
});

// =====================================================
// 🎯 SETUP EVENT LISTENERS
// =====================================================
function setupEventListeners() {
  // Search input — debounce 300ms
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    let timer;
    searchInput.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(applyFilters, 300);
    });
  }

  // Filter dropdowns / date
  ['filterStatus', 'filterDateFrom', 'filterDateTo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', applyFilters);
  });

  // ปิด modal เมื่อคลิก overlay
  const modal = document.getElementById('qcModal');
  if (modal) {
    modal.addEventListener('click', e => {
      if (e.target === modal) closeModal();
    });
  }

  console.log('✅ Event listeners ready');
}

function setupLogout() {
  const btn = document.getElementById('logoutBtn');
  if (btn) btn.addEventListener('click', logout);
}

// =====================================================
// 📋 LOAD CLAIMS จาก Supabase
// ดึงเฉพาะ status = submitted, approved, rejected
// =====================================================
async function loadClaims() {
  try {
    showTableLoading();

    const { data, error } = await supabaseClient
      .from('claims')
      .select('*')
      .in('status', ['submitted', 'approved', 'rejected'])
      .order('created_at', { ascending: false });

    if (error) throw error;

    allClaims = data || [];
    filteredClaims = [...allClaims];

    updateSummaryCards();
    renderTable(filteredClaims);

    console.log(`✅ Loaded ${allClaims.length} claims`);

  } catch (err) {
    console.error('❌ loadClaims error:', err);
    showTableError('โหลดข้อมูลไม่สำเร็จ: ' + err.message);
  }
}

// =====================================================
// 📊 UPDATE SUMMARY CARDS
// =====================================================
function updateSummaryCards() {
  document.getElementById('sumTotal').textContent     = allClaims.length;
  document.getElementById('sumPending').textContent   = allClaims.filter(c => c.status === 'submitted').length;
  document.getElementById('sumApproved').textContent  = allClaims.filter(c => c.status === 'approved').length;
  document.getElementById('sumRejected').textContent  = allClaims.filter(c => c.status === 'rejected').length;
}

// =====================================================
// 🔍 APPLY FILTERS
// =====================================================
function applyFilters() {
  const search   = document.getElementById('searchInput').value.toLowerCase().trim();
  const status   = document.getElementById('filterStatus').value;
  const dateFrom = document.getElementById('filterDateFrom').value;
  const dateTo   = document.getElementById('filterDateTo').value;

  filteredClaims = allClaims.filter(c => {
    // ค้นหา
    if (search) {
      const text = `${c.product} ${c.customer} ${c.emp_name} ${c.area}`.toLowerCase();
      if (!text.includes(search)) return false;
    }

    // สถานะ
    if (status && c.status !== status) return false;

    // วันที่
    if (dateFrom && c.claim_date < dateFrom) return false;
    if (dateTo   && c.claim_date > dateTo)   return false;

    return true;
  });

  renderTable(filteredClaims);
}

// =====================================================
// ♻️ RESET FILTERS
// =====================================================
function resetFilters() {
  document.getElementById('searchInput').value   = '';
  document.getElementById('filterStatus').value  = '';
  document.getElementById('filterDateFrom').value = '';
  document.getElementById('filterDateTo').value   = '';

  filteredClaims = [...allClaims];
  renderTable(filteredClaims);
}

// =====================================================
// 🏗️ RENDER TABLE
// =====================================================
function renderTable(claims) {
  const tbody = document.getElementById('qcTableBody');

  if (!claims || claims.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="table-loading" style="color:#94a3b8;">
          ไม่พบข้อมูลที่ตรงกับเงื่อนไข
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = '';

  claims.forEach(claim => {
    const tr = document.createElement('tr');
    tr.onclick = () => openModal(claim);

    // Thumbnails
    const thumbHtml = buildThumbsHtml(claim.media_urls, 3, 'cell-thumb', 'cell-thumb-video');
    const noMedia   = (!claim.media_urls || claim.media_urls.length === 0);

    // Claim types — escape แต่ละ type
    const typesHtml = (claim.claim_types && claim.claim_types.length > 0)
      ? claim.claim_types.map(t => `<span class="type-tag">${escapeHtml(t)}</span>`).join('')
      : '<span style="color:#cbd5e1;font-size:0.75rem;">—</span>';

    tr.innerHTML = `
      <td>
        <div class="cell-date">${formatDate(claim.claim_date)}</div>
        <div class="cell-sub">${formatDateTime(claim.created_at)}</div>
      </td>
      <td>
        <div style="font-weight:500;">${escapeHtml(claim.emp_name) || '—'}</div>
        <div class="cell-sub">${escapeHtml(claim.area) || '—'}</div>
      </td>
      <td>${escapeHtml(claim.customer) || '—'}</td>
      <td class="cell-product">
        <div>${escapeHtml(claim.product) || '—'}</div>
        <div class="cell-sub">${escapeHtml(claim.qty) || ''}</div>
      </td>
      <td><div class="cell-types">${typesHtml}</div></td>
      <td>
        ${noMedia
          ? '<span class="cell-no-media">ไม่มีไฟล์</span>'
          : `<div class="cell-thumbs">${thumbHtml}</div>`
        }
      </td>
      <td>${buildStatusBadge(claim.status)}</td>
      <td>
        <button class="btn-view" onclick="event.stopPropagation(); openModal(window._claims['${claim.id}'])">
          <span class="material-symbols-outlined" style="font-size:1rem;">open_in_new</span>
          ดูรายละเอียด
        </button>
      </td>`;

    tbody.appendChild(tr);
  });

  // เก็บ claims ใน window สำหรับ onclick ใน button
  window._claims = {};
  claims.forEach(c => { window._claims[c.id] = c; });
}

// =====================================================
// 🖼️ BUILD THUMBNAILS HTML
// =====================================================
function buildThumbsHtml(urls, maxShow, imgClass, vidClass) {
  if (!urls || urls.length === 0) return '';

  let html = '';
  const show = urls.slice(0, maxShow);

  show.forEach(url => {
    if (isVideo(url)) {
      html += `<div class="${vidClass}">🎥</div>`;
    } else {
      html += `<img class="${imgClass}" src="${escapeHtml(url)}" onerror="this.style.display='none'" alt="">`;
    }
  });

  if (urls.length > maxShow) {
    html += `<div class="cell-thumb-video" style="background:#64748b;font-size:0.72rem;">+${urls.length - maxShow}</div>`;
  }

  return html;
}

// =====================================================
// 🏷️ BUILD STATUS BADGE
// =====================================================
function buildStatusBadge(status) {
  const map = {
    submitted: { label: '⏳ รออนุมัติ', cls: 'submitted' },
    approved:  { label: '✅ อนุมัติแล้ว', cls: 'approved' },
    rejected:  { label: '❌ ปฏิเสธ',    cls: 'rejected'  },
    draft:     { label: '📝 Draft',      cls: 'draft'     },
  };
  const s = map[status] || { label: escapeHtml(status), cls: '' };
  return `<span class="status-badge ${s.cls}">${s.label}</span>`;
}

// =====================================================
// 📂 OPEN MODAL
// =====================================================
function openModal(claim) {
  if (!claim) return;
  currentClaim = claim;

  const modal = document.getElementById('qcModal');
  modal.classList.add('open');

  // Title
  document.getElementById('modalTitle').textContent =
    `เคลม #${claim.id.substring(0, 8).toUpperCase()}`;

  // Info Grid — escape ทุก field ที่มาจาก DB
  document.getElementById('modalInfoGrid').innerHTML = `
    <div class="info-row">
      <div class="info-label">พนักงานขาย</div>
      <div class="info-value">${escapeHtml(claim.emp_name) || '—'}</div>
    </div>
    <div class="info-row">
      <div class="info-label">เขตการขาย</div>
      <div class="info-value">${escapeHtml(claim.area) || '—'}</div>
    </div>
    <div class="info-row">
      <div class="info-label">ร้านค้า / ลูกค้า</div>
      <div class="info-value">${escapeHtml(claim.customer) || '—'}</div>
    </div>
    <div class="info-row">
      <div class="info-label">วันที่แจ้งเคลม</div>
      <div class="info-value">${formatDate(claim.claim_date)}</div>
    </div>
    <div class="info-row full">
      <div class="info-label">สินค้า</div>
      <div class="info-value">${escapeHtml(claim.product) || '—'}</div>
    </div>
    <div class="info-row">
      <div class="info-label">จำนวน</div>
      <div class="info-value">${escapeHtml(claim.qty) || '—'}</div>
    </div>
    <div class="info-row">
      <div class="info-label">วันที่เปิดบิล</div>
      <div class="info-value">${formatDate(claim.buy_date)}</div>
    </div>
    <div class="info-row">
      <div class="info-label">วันที่ผลิต</div>
      <div class="info-value">${formatDate(claim.mfg_date)}</div>
    </div>
    <div class="info-row">
      <div class="info-label">สถานะ</div>
      <div class="info-value">${buildStatusBadge(claim.status)}</div>
    </div>`;

  // Claim Types — escape แต่ละ type
  const typesEl = document.getElementById('modalClaimTypes');
  if (claim.claim_types && claim.claim_types.length > 0) {
    typesEl.innerHTML = claim.claim_types
      .map(t => `<span class="modal-type-tag">${escapeHtml(t)}</span>`)
      .join('');
  } else {
    typesEl.innerHTML = '<span style="color:#94a3b8;">ไม่ระบุ</span>';
  }

  // Detail — ใช้ textContent ป้องกัน XSS อยู่แล้ว ✓
  document.getElementById('modalDetail').textContent =
    claim.detail || '—';

  // Media
  renderModalMedia(claim.media_urls);

  // QC Status current — escape qc_comment
  document.getElementById('qcStatusCurrent').innerHTML =
    `สถานะปัจจุบัน: ${buildStatusBadge(claim.status)}
     ${claim.qc_comment ? `<br><span style="color:#475569;font-size:0.82rem;">💬 ${escapeHtml(claim.qc_comment)}</span>` : ''}`;

  // ล้าง comment input
  document.getElementById('qcComment').value = claim.qc_comment || '';
}

// =====================================================
// 🖼️ RENDER MEDIA ใน MODAL
// =====================================================
function renderModalMedia(urls) {
  const grid = document.getElementById('modalMediaGrid');

  if (!urls || urls.length === 0) {
    grid.innerHTML = '<div class="media-no-file">ไม่มีรูปภาพหรือวิดีโอที่แนบ</div>';
    return;
  }

  grid.innerHTML = '';

  urls.forEach(url => {
    const item = document.createElement('div');
    item.className = 'media-item';

    if (isVideo(url)) {
      const video = document.createElement('video');
      video.src = url;
      video.preload = 'metadata';

      const playIcon = document.createElement('div');
      playIcon.className = 'media-play-icon';
      playIcon.textContent = '▶';

      const wrap = document.createElement('div');
      wrap.className = 'media-video-wrap';
      wrap.appendChild(video);
      wrap.appendChild(playIcon);
      item.appendChild(wrap);

      item.onclick = () => { window.open(url, '_blank'); };
    } else {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.onerror = function() { this.parentElement.style.display = 'none'; };
      item.appendChild(img);
      item.onclick = () => openLightbox(url);
    }

    grid.appendChild(item);
  });
}

// =====================================================
// ❌ CLOSE MODAL
// =====================================================
function closeModal() {
  document.getElementById('qcModal').classList.remove('open');
  currentClaim = null;
}

// =====================================================
// ✅ UPDATE CLAIM STATUS (อนุมัติ / ปฏิเสธ)
// =====================================================
async function updateClaimStatus(newStatus) {
  if (!currentClaim) return;

  const comment = document.getElementById('qcComment').value.trim();
  const label = newStatus === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ';
  const type  = newStatus === 'approved' ? 'success' : 'danger';

  const ok = await ConfirmDialog.show({
    title:   `ยืนยันการ${label}`,
    message: `ยืนยันการ${label}เคลมนี้?`,
    okText:  label,
    type:    type,
  });
  if (!ok) return;

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();

    const updateData = {
      status:     newStatus,
      qc_comment: comment || null,
      qc_by:      user?.id || null,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabaseClient
      .from('claims')
      .update(updateData)
      .eq('id', currentClaim.id);

    if (error) throw error;

    // อัปเดต local state ให้ครบทุก field
    const idx = allClaims.findIndex(c => c.id === currentClaim.id);
    if (idx !== -1) {
      allClaims[idx].status     = newStatus;
      allClaims[idx].qc_comment = comment || null;
      allClaims[idx].qc_by      = user?.id || null;
      allClaims[idx].updated_at = updateData.updated_at;
    }

    // Refresh UI
    updateSummaryCards();
    applyFilters();

    // ปิด modal แล้วแสดง toast (เรียกครั้งเดียว)
    closeModal();
    showToast(`${label}เคลมสำเร็จ`, type);

  } catch (err) {
    console.error('❌ updateClaimStatus error:', err);
    await ConfirmDialog.show({
      title:   'เกิดข้อผิดพลาด',
      message: err.message,
      okText:  'ตกลง',
      type:    'danger',
    });
  }
}

// =====================================================
// 🔍 LIGHTBOX
// =====================================================
function openLightbox(url) {
  const lb  = document.getElementById('lightbox');
  const img = document.getElementById('lightboxImg');
  img.src   = url;
  lb.classList.add('open');
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  document.getElementById('lightboxImg').src = '';
}

// =====================================================
// 📄 EXPORT PDF
// พิมพ์ modal เป็น PDF ผ่าน browser print
// =====================================================
function exportPDF() {
  if (!currentClaim) return;

  const c = currentClaim;

  // สร้าง HTML สำหรับ print — escape ข้อมูลจาก DB
  const mediaHtml = (c.media_urls && c.media_urls.length > 0)
    ? c.media_urls.filter(u => !isVideo(u))
        .map(u => `<img src="${escapeHtml(u)}" style="width:180px;height:180px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0;" onerror="this.style.display='none'">`)
        .join('')
    : '<p style="color:#94a3b8;">ไม่มีรูปภาพ</p>';

  const typesHtml = (c.claim_types && c.claim_types.length > 0)
    ? c.claim_types.map(t => `<span style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:20px;padding:3px 12px;font-size:13px;margin-right:4px;">${escapeHtml(t)}</span>`).join('')
    : '—';

  const printWin = window.open('', '_blank', 'width=900,height=700');
  printWin.document.write(`
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>ใบแจ้งเคลม — ${escapeHtml(c.id.substring(0,8).toUpperCase())}</title>
      <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600&display=swap" rel="stylesheet">
      <style>
        * { box-sizing: border-box; }
        body { font-family: 'Kanit', sans-serif; color: #1e293b; padding: 32px; max-width: 800px; margin: auto; }
        h1  { font-size: 1.4rem; color: #0f172a; margin-bottom: 4px; }
        .sub { color: #64748b; font-size: 0.85rem; margin-bottom: 24px; }
        .section { margin-bottom: 24px; }
        .section-title { font-weight: 600; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; color: #475569; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 12px; }
        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .info-box { background: #f8fafc; border-radius: 8px; padding: 10px 14px; }
        .info-lbl { font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; }
        .info-val { font-weight: 500; font-size: 0.9rem; }
        .detail-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; line-height: 1.7; min-height: 60px; white-space: pre-wrap; }
        .media-wrap { display: flex; flex-wrap: wrap; gap: 10px; }
        .status-badge { display: inline-block; padding: 4px 14px; border-radius: 20px; font-size: 0.8rem; font-weight: 600; }
        .submitted { background: #fef9c3; color: #854d0e; }
        .approved  { background: #dcfce7; color: #166534; }
        .rejected  { background: #fee2e2; color: #991b1b; }
        .footer-note { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 12px; font-size: 0.75rem; color: #94a3b8; display: flex; justify-content: space-between; }
        @media print { body { padding: 16px; } }
      </style>
    </head>
    <body>
      <h1>⚠️ ใบแจ้งเคลมสินค้า</h1>
      <div class="sub">เลขที่: ${escapeHtml(c.id.toUpperCase())} • สร้างเมื่อ: ${formatDateTime(c.created_at)}</div>

      <div class="section">
        <div class="section-title">ข้อมูลการแจ้งเคลม</div>
        <div class="grid2">
          <div class="info-box"><div class="info-lbl">พนักงานขาย</div><div class="info-val">${escapeHtml(c.emp_name) || '—'}</div></div>
          <div class="info-box"><div class="info-lbl">เขตการขาย</div><div class="info-val">${escapeHtml(c.area) || '—'}</div></div>
          <div class="info-box"><div class="info-lbl">ร้านค้า / ลูกค้า</div><div class="info-val">${escapeHtml(c.customer) || '—'}</div></div>
          <div class="info-box"><div class="info-lbl">วันที่แจ้งเคลม</div><div class="info-val">${formatDate(c.claim_date)}</div></div>
          <div class="info-box" style="grid-column:1/-1"><div class="info-lbl">สินค้า</div><div class="info-val">${escapeHtml(c.product) || '—'}</div></div>
          <div class="info-box"><div class="info-lbl">จำนวน</div><div class="info-val">${escapeHtml(c.qty) || '—'}</div></div>
          <div class="info-box"><div class="info-lbl">สถานะ</div><div class="info-val"><span class="status-badge ${c.status}">${c.status === 'submitted' ? '⏳ รออนุมัติ' : c.status === 'approved' ? '✅ อนุมัติ' : '❌ ปฏิเสธ'}</span></div></div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">ประเภทปัญหา</div>
        <div>${typesHtml}</div>
      </div>

      <div class="section">
        <div class="section-title">รายละเอียด</div>
        <div class="detail-box">${escapeHtml(c.detail) || '—'}</div>
      </div>

      <div class="section">
        <div class="section-title">รูปภาพประกอบ</div>
        <div class="media-wrap">${mediaHtml}</div>
      </div>

      <div class="footer-note">
        <span>EABaseHub — ระบบจัดการเคลมสินค้า</span>
        <span>พิมพ์เมื่อ: ${new Date().toLocaleString('th-TH')}</span>
      </div>
    </body>
    </html>
  `);
  printWin.document.close();
  printWin.onload = () => { printWin.print(); };
}

// =====================================================
// 📊 EXPORT EXCEL (CSV)
// =====================================================
function exportExcel() {
  if (filteredClaims.length === 0) {
    alert('ไม่มีข้อมูลสำหรับ Export');
    return;
  }

  const rows = [
    // Header
    ['วันที่แจ้งเคลม', 'พนักงานขาย', 'เขต', 'ร้านค้า', 'สินค้า', 'จำนวน', 'ประเภทปัญหา', 'รายละเอียด', 'สถานะ', 'วันที่บิล', 'วันที่ผลิต']
  ];

  filteredClaims.forEach(c => {
    rows.push([
      formatDate(c.claim_date),
      c.emp_name || '',
      c.area     || '',
      c.customer || '',
      c.product  || '',
      c.qty      || '',
      (c.claim_types || []).join(', '),
      (c.detail || '').replace(/\n/g, ' '),
      c.status === 'submitted' ? 'รออนุมัติ' : c.status === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ',
      formatDate(c.buy_date),
      formatDate(c.mfg_date),
    ]);
  });

  // แปลงเป็น CSV (UTF-8 BOM สำหรับ Excel ภาษาไทย)
  const csv = '\uFEFF' + rows.map(row =>
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  ).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `claims_export_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  console.log(`✅ Exported ${filteredClaims.length} rows`);
}

// =====================================================
// 🔧 UTILITIES
// =====================================================

// ตรวจว่าเป็น video URL
function isVideo(url) {
  return /\.(mp4|mov|avi|webm|mkv)(\?|$)/i.test(url);
}

// แสดง loading ใน table
function showTableLoading() {
  document.getElementById('qcTableBody').innerHTML = `
    <tr>
      <td colspan="8" class="table-loading">
        <span class="material-symbols-outlined spin">progress_activity</span>
        กำลังโหลด...
      </td>
    </tr>`;
}

// แสดง error ใน table
function showTableError(msg) {
  document.getElementById('qcTableBody').innerHTML = `
    <tr>
      <td colspan="8" class="table-loading" style="color:#dc2626;">
        ❌ ${escapeHtml(msg)}
      </td>
    </tr>`;
}

// แปลงวันที่ dd/mm/yyyy
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return '—';
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

// แปลง timestamp
function formatDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d)) return '—';
  return `${formatDate(ts)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

console.log('✅ adminQc.js loaded');

// =====================================================
// 🔔 TOAST NOTIFICATION
// =====================================================
function showToast(message, type = 'success') {
  // ลบ toast เก่าถ้ามี
  document.getElementById('ea-toast')?.remove();

  const colorMap = {
    success: { bg: '#2e7d32', icon: '✅' },
    danger:  { bg: '#c62828', icon: '❌' },
    warning: { bg: '#e65100', icon: '⚠️' },
    info:    { bg: '#1565c0', icon: 'ℹ️' },
  };
  const c = colorMap[type] || colorMap.success;

  const toast = document.createElement('div');
  toast.id = 'ea-toast';
  toast.style.cssText = `
    position: fixed;
    bottom: 32px;
    right: 32px;
    background: ${c.bg};
    color: #fff;
    font-family: "Kanit", sans-serif;
    font-size: 15px;
    font-weight: 500;
    padding: 14px 24px;
    border-radius: 14px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    display: flex;
    align-items: center;
    gap: 10px;
    z-index: 99999;
    opacity: 0;
    transform: translateY(12px);
    transition: opacity 0.3s ease, transform 0.3s ease;
  `;
  toast.innerHTML = `<span>${c.icon}</span><span>${escapeHtml(message)}</span>`;
  document.body.appendChild(toast);

  // แสดง
  requestAnimationFrame(() => {
    toast.style.opacity   = '1';
    toast.style.transform = 'translateY(0)';
  });

  // หายเองใน 2.5 วิ
  setTimeout(() => {
    toast.style.opacity   = '0';
    toast.style.transform = 'translateY(12px)';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}