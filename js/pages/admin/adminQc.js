// =====================================================
// adminQC.js (FIXED VERSION)
// หน้า QC Dashboard — ตรวจสอบ อนุมัติ ปฏิเสธ Export
// =====================================================

// =====================================================
// STATE
// =====================================================
let allClaims      = [];
let filteredClaims = [];
let currentClaim   = null;

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
    await loadClaims();
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
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    let timer;
    searchInput.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(applyFilters, 300);
    });
  }

  ['filterStatus', 'filterDateFrom', 'filterDateTo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', applyFilters);
  });

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
// 📋 LOAD CLAIMS
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
  const sumTotal = document.getElementById('sumTotal');
  const sumPending = document.getElementById('sumPending');
  const sumApproved = document.getElementById('sumApproved');
  const sumRejected = document.getElementById('sumRejected');
  
  if (sumTotal) sumTotal.textContent = allClaims.length;
  if (sumPending) sumPending.textContent = allClaims.filter(c => c.status === 'submitted').length;
  if (sumApproved) sumApproved.textContent = allClaims.filter(c => c.status === 'approved').length;
  if (sumRejected) sumRejected.textContent = allClaims.filter(c => c.status === 'rejected').length;
}

// =====================================================
// 🔍 APPLY FILTERS
// =====================================================
function applyFilters() {
  const searchEl = document.getElementById('searchInput');
  const statusEl = document.getElementById('filterStatus');
  const dateFromEl = document.getElementById('filterDateFrom');
  const dateToEl = document.getElementById('filterDateTo');
  
  const search   = searchEl ? searchEl.value.toLowerCase().trim() : '';
  const status   = statusEl ? statusEl.value : '';
  const dateFrom = dateFromEl ? dateFromEl.value : '';
  const dateTo   = dateToEl ? dateToEl.value : '';

  filteredClaims = allClaims.filter(c => {
    if (search) {
      const text = `${c.product || ''} ${c.customer || ''} ${c.emp_name || ''} ${c.area || ''}`.toLowerCase();
      if (!text.includes(search)) return false;
    }
    if (status && c.status !== status) return false;
    if (dateFrom && c.claim_date < dateFrom) return false;
    if (dateTo && c.claim_date > dateTo) return false;
    return true;
  });

  renderTable(filteredClaims);
}

// =====================================================
// ♻️ RESET FILTERS
// =====================================================
function resetFilters() {
  const searchEl = document.getElementById('searchInput');
  const statusEl = document.getElementById('filterStatus');
  const dateFromEl = document.getElementById('filterDateFrom');
  const dateToEl = document.getElementById('filterDateTo');
  
  if (searchEl) searchEl.value = '';
  if (statusEl) statusEl.value = '';
  if (dateFromEl) dateFromEl.value = '';
  if (dateToEl) dateToEl.value = '';

  filteredClaims = [...allClaims];
  renderTable(filteredClaims);
}

// =====================================================
// 🏗️ RENDER TABLE
// =====================================================
function renderTable(claims) {
  const tbody = document.getElementById('qcTableBody');
  if (!tbody) return;

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

    const thumbHtml = buildThumbsHtml(claim.media_urls, 3, 'cell-thumb', 'cell-thumb-video');
    const noMedia = (!claim.media_urls || claim.media_urls.length === 0);

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
// 📂 OPEN MODAL (FIXED - ตรวจสอบ element ก่อนใช้)
// =====================================================
function openModal(claim) {
  if (!claim) return;
  currentClaim = claim;

  const modal = document.getElementById('qcModal');
  if (!modal) return;
  
  modal.classList.add('open');

  // Title
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) {
    modalTitle.textContent = `เคลม #${claim.id.substring(0, 8).toUpperCase()}`;
  }

  // Info Grid
  const modalInfoGrid = document.getElementById('modalInfoGrid');
  if (modalInfoGrid) {
    modalInfoGrid.innerHTML = `
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
      </div>
      ${claim.qc_comment ? `
      <div class="info-row full">
        <div class="info-label">หมายเหตุ QC</div>
        <div class="info-value">${escapeHtml(claim.qc_comment)}</div>
      </div>` : ''}`;
  }

  // Claim Types
  const typesEl = document.getElementById('modalClaimTypes');
  if (typesEl) {
    if (claim.claim_types && claim.claim_types.length > 0) {
      typesEl.innerHTML = claim.claim_types
        .map(t => `<span class="modal-type-tag">${escapeHtml(t)}</span>`)
        .join('');
    } else {
      typesEl.innerHTML = '<span style="color:#94a3b8;">ไม่ระบุ</span>';
    }
  }

  // Detail
  const modalDetail = document.getElementById('modalDetail');
  if (modalDetail) {
    modalDetail.textContent = claim.detail || '—';
  }

  // Media
  renderModalMedia(claim.media_urls);

  // QC Status (ถ้ามี element - อาจถูก comment ออก)
  const qcStatusEl = document.getElementById('qcStatusCurrent');
  if (qcStatusEl) {
    qcStatusEl.innerHTML = `สถานะปัจจุบัน: ${buildStatusBadge(claim.status)}
      ${claim.qc_comment ? `<br><span style="color:#475569;font-size:0.82rem;">💬 ${escapeHtml(claim.qc_comment)}</span>` : ''}`;
  }

  // QC Comment input (ถ้ามี element - อาจถูก comment ออก)
  const qcCommentEl = document.getElementById('qcComment');
  if (qcCommentEl) {
    qcCommentEl.value = claim.qc_comment || '';
  }
}

// =====================================================
// 🖼️ RENDER MEDIA ใน MODAL
// =====================================================
function renderModalMedia(urls) {
  const grid = document.getElementById('modalMediaGrid');
  if (!grid) return;

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
  const modal = document.getElementById('qcModal');
  if (modal) {
    modal.classList.remove('open');
  }
  currentClaim = null;
}

// =====================================================
// ✅ UPDATE CLAIM STATUS (อนุมัติ / ปฏิเสธ)
// =====================================================
async function updateClaimStatus(newStatus) {
  if (!currentClaim) return;

  const qcCommentEl = document.getElementById('qcComment');
  const comment = qcCommentEl ? qcCommentEl.value.trim() : '';
  const label = newStatus === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ';
  const type  = newStatus === 'approved' ? 'success' : 'danger';

  // ตรวจสอบว่ามี ConfirmDialog หรือไม่
  if (typeof ConfirmDialog !== 'undefined') {
    const ok = await ConfirmDialog.show({
      title:   `ยืนยันการ${label}`,
      message: `ยืนยันการ${label}เคลมนี้?`,
      okText:  label,
      type:    type,
    });
    if (!ok) return;
  } else {
    if (!confirm(`ยืนยันการ${label}เคลมนี้?`)) return;
  }

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

    const idx = allClaims.findIndex(c => c.id === currentClaim.id);
    if (idx !== -1) {
      allClaims[idx].status     = newStatus;
      allClaims[idx].qc_comment = comment || null;
      allClaims[idx].qc_by      = user?.id || null;
      allClaims[idx].updated_at = updateData.updated_at;
    }

    updateSummaryCards();
    applyFilters();
    closeModal();
    showToast(`${label}เคลมสำเร็จ`, type);

  } catch (err) {
    console.error('❌ updateClaimStatus error:', err);
    showToast('เกิดข้อผิดพลาด: ' + err.message, 'danger');
  }
}

// =====================================================
// 🔍 LIGHTBOX
// =====================================================
function openLightbox(url) {
  const lb  = document.getElementById('lightbox');
  const img = document.getElementById('lightboxImg');
  if (lb && img) {
    img.src = url;
    lb.classList.add('open');
  }
}

function closeLightbox() {
  const lb = document.getElementById('lightbox');
  const img = document.getElementById('lightboxImg');
  if (lb) lb.classList.remove('open');
  if (img) img.src = '';
}

// =====================================================
// 📄 EXPORT PDF (เคลมเดี่ยว)
// =====================================================
function exportPDF() {
  if (!currentClaim) {
    showToast('กรุณาเลือกเคลมก่อน', 'warning');
    return;
  }

  const c = currentClaim;

  const mediaHtml = (c.media_urls && c.media_urls.length > 0)
    ? c.media_urls.filter(u => !isVideo(u))
        .map(u => `<img src="${escapeHtml(u)}" style="width:180px;height:180px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0;" onerror="this.style.display='none'">`)
        .join('')
    : '<p style="color:#94a3b8;">ไม่มีรูปภาพ</p>';

  const typesHtml = (c.claim_types && c.claim_types.length > 0)
    ? c.claim_types.map(t => `<span style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:20px;padding:3px 12px;font-size:13px;margin-right:4px;">${escapeHtml(t)}</span>`).join('')
    : '—';

  const statusLabel = c.status === 'submitted' ? '⏳ รออนุมัติ' : c.status === 'approved' ? '✅ อนุมัติ' : '❌ ปฏิเสธ';

  const printWin = window.open('', '_blank', 'width=900,height=700');
  if (!printWin) {
    showToast('กรุณาอนุญาต popup เพื่อพิมพ์ PDF', 'warning');
    return;
  }

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
        h1 { font-size: 1.4rem; color: #0f172a; margin-bottom: 4px; }
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
        .approved { background: #dcfce7; color: #166534; }
        .rejected { background: #fee2e2; color: #991b1b; }
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
          <div class="info-box"><div class="info-lbl">สถานะ</div><div class="info-val"><span class="status-badge ${c.status}">${statusLabel}</span></div></div>
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
// 📊 EXPORT CSV (เคลมเดี่ยว - สำหรับปุ่มใน Modal)
// =====================================================
function exportCSV() {
  if (!currentClaim) {
    showToast('กรุณาเลือกเคลมก่อน', 'warning');
    return;
  }

  const c = currentClaim;
  const statusLabel = c.status === 'submitted' ? 'รออนุมัติ' : c.status === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ';

  const rows = [
    ['หัวข้อ', 'ค่า'],
    ['เลขเคลม', c.id],
    ['พนักงานขาย', c.emp_name || '-'],
    ['เขต', c.area || '-'],
    ['ร้านค้า / ลูกค้า', c.customer || '-'],
    ['สินค้า', c.product || '-'],
    ['จำนวน', c.qty || '-'],
    ['ประเภทปัญหา', (c.claim_types || []).join(', ')],
    ['รายละเอียด', (c.detail || '').replace(/\n/g, ' ')],
    ['สถานะ', statusLabel],
    ['วันที่แจ้งเคลม', formatDate(c.claim_date)],
    ['วันที่เปิดบิล', formatDate(c.buy_date)],
    ['วันที่ผลิต', formatDate(c.mfg_date)],
    ['หมายเหตุ QC', c.qc_comment || '-'],
    ['สร้างเมื่อ', formatDateTime(c.created_at)]
  ];

  // UTF-8 BOM สำหรับ Excel ภาษาไทย
  const csv = '\uFEFF' + rows.map(row =>
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  ).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `claim_${c.id.substring(0, 8)}_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('ดาวน์โหลด CSV สำเร็จ', 'success');
}

// =====================================================
// 📊 EXPORT EXCEL (หลายรายการ - สำหรับปุ่ม Filter Bar)
// หรือเคลมเดี่ยว ถ้าอยู่ใน Modal
// =====================================================
function exportExcel() {
  // ถ้าอยู่ใน modal → export เคลมเดี่ยว
  if (currentClaim) {
    exportSingleClaimExcel();
    return;
  }

  // ถ้าไม่มี filter data
  if (!filteredClaims || filteredClaims.length === 0) {
    showToast('ไม่มีข้อมูลสำหรับ Export', 'warning');
    return;
  }

  const rows = [
    ['วันที่แจ้งเคลม', 'พนักงานขาย', 'เขต', 'ร้านค้า', 'สินค้า', 'จำนวน', 'ประเภทปัญหา', 'รายละเอียด', 'สถานะ', 'วันที่บิล', 'วันที่ผลิต', 'หมายเหตุ QC']
  ];

  filteredClaims.forEach(c => {
    const statusLabel = c.status === 'submitted' ? 'รออนุมัติ' : c.status === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ';
    rows.push([
      formatDate(c.claim_date),
      c.emp_name || '',
      c.area || '',
      c.customer || '',
      c.product || '',
      c.qty || '',
      (c.claim_types || []).join(', '),
      (c.detail || '').replace(/\n/g, ' '),
      statusLabel,
      formatDate(c.buy_date),
      formatDate(c.mfg_date),
      c.qc_comment || ''
    ]);
  });

  // ใช้ SheetJS ถ้ามี
  if (typeof XLSX !== 'undefined') {
    try {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      
      // ปรับความกว้างคอลัมน์
      ws['!cols'] = [
        { wch: 14 }, // วันที่แจ้งเคลม
        { wch: 18 }, // พนักงานขาย
        { wch: 12 }, // เขต
        { wch: 20 }, // ร้านค้า
        { wch: 25 }, // สินค้า
        { wch: 8 },  // จำนวน
        { wch: 20 }, // ประเภทปัญหา
        { wch: 30 }, // รายละเอียด
        { wch: 12 }, // สถานะ
        { wch: 14 }, // วันที่บิล
        { wch: 14 }, // วันที่ผลิต
        { wch: 20 }, // หมายเหตุ QC
      ];
      
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Claims");
      XLSX.writeFile(wb, `claims_export_${new Date().toISOString().split('T')[0]}.xlsx`);
      
      showToast(`ดาวน์โหลด ${filteredClaims.length} รายการสำเร็จ`, 'success');
      return;
    } catch (err) {
      console.warn('XLSX export failed, falling back to CSV:', err);
    }
  }

  // Fallback เป็น CSV
  const csv = '\uFEFF' + rows.map(row =>
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  ).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `claims_export_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`ดาวน์โหลด ${filteredClaims.length} รายการสำเร็จ`, 'success');
}

// =====================================================
// 📊 EXPORT SINGLE CLAIM EXCEL (เคลมเดี่ยว)
// =====================================================
function exportSingleClaimExcel() {
  if (!currentClaim) {
    showToast('ไม่พบข้อมูลเคลม', 'warning');
    return;
  }

  const c = currentClaim;
  const statusLabel = c.status === 'submitted' ? 'รออนุมัติ' : c.status === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ';

  const data = [
    ['หัวข้อ', 'ค่า'],
    ['เลขเคลม', c.id],
    ['พนักงานขาย', c.emp_name || '-'],
    ['เขต', c.area || '-'],
    ['ร้านค้า', c.customer || '-'],
    ['สินค้า', c.product || '-'],
    ['จำนวน', c.qty || '-'],
    ['ประเภทปัญหา', (c.claim_types || []).join(', ')],
    ['รายละเอียด', c.detail || '-'],
    ['สถานะ', statusLabel],
    ['วันที่เคลม', formatDate(c.claim_date)],
    ['วันที่บิล', formatDate(c.buy_date)],
    ['วันที่ผลิต', formatDate(c.mfg_date)],
    ['QC Comment', c.qc_comment || '-'],
    ['สร้างเมื่อ', formatDateTime(c.created_at)]
  ];

  // ใช้ SheetJS ถ้ามี
  if (typeof XLSX !== 'undefined') {
    try {
      const ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = [{ wch: 20 }, { wch: 50 }];
      
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Claim Detail");
      XLSX.writeFile(wb, `claim_${c.id.substring(0, 8)}.xlsx`);
      
      showToast('ดาวน์โหลด Excel สำเร็จ', 'success');
      return;
    } catch (err) {
      console.warn('XLSX export failed, falling back to CSV:', err);
    }
  }

  // Fallback เป็น CSV
  const csv = '\uFEFF' + data.map(row =>
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  ).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `claim_${c.id.substring(0, 8)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('ดาวน์โหลด CSV สำเร็จ', 'success');
}

// =====================================================
// 📊 EXPORT EXCEL PRO (พร้อม styling - ใช้ ExcelJS)
// =====================================================
async function exportCurrentClaimExcelPro() {
  if (!currentClaim) {
    showToast('ไม่พบข้อมูล', 'warning');
    return;
  }

  if (typeof ExcelJS === 'undefined') {
    console.warn('ExcelJS not loaded, using basic export');
    exportSingleClaimExcel();
    return;
  }

  const c = currentClaim;
  const statusLabel = c.status === 'submitted' ? 'รออนุมัติ' : c.status === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ';

  try {
    showToast('กำลังสร้างไฟล์...', 'info');

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Claim");

    sheet.columns = [{ width: 25 }, { width: 50 }];

    // Header
    sheet.mergeCells('A1:B1');
    const headerCell = sheet.getCell('A1');
    headerCell.value = "ใบแจ้งเคลมสินค้า";
    headerCell.font = { size: 18, bold: true };
    headerCell.alignment = { horizontal: 'center' };

    sheet.addRow([]);

    // Data rows
    const rows = [
      ["เลขเคลม", c.id],
      ["พนักงานขาย", c.emp_name || '-'],
      ["เขต", c.area || '-'],
      ["ร้านค้า", c.customer || '-'],
      ["สินค้า", c.product || '-'],
      ["จำนวน", c.qty || '-'],
      ["ประเภทปัญหา", (c.claim_types || []).join(', ')],
      ["รายละเอียด", c.detail || '-'],
      ["สถานะ", statusLabel],
      ["วันที่เคลม", formatDate(c.claim_date)],
      ["วันที่บิล", formatDate(c.buy_date)],
      ["วันที่ผลิต", formatDate(c.mfg_date)],
    ];

    rows.forEach(r => {
      const row = sheet.addRow(r);
      row.getCell(1).font = { bold: true };
      row.getCell(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEFEFEF' }
      };
      row.eachCell(cell => {
        cell.border = {
          top: { style: 'thin' },
          bottom: { style: 'thin' },
          left: { style: 'thin' },
          right: { style: 'thin' },
        };
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    
    if (typeof saveAs !== 'undefined') {
      saveAs(new Blob([buffer]), `claim_${c.id.substring(0, 8)}.xlsx`);
    } else {
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `claim_${c.id.substring(0, 8)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    showToast('ดาวน์โหลด Excel สำเร็จ', 'success');

  } catch (err) {
    console.error('Export Excel Pro error:', err);
    showToast('เกิดข้อผิดพลาด กำลัง fallback...', 'warning');
    exportSingleClaimExcel();
  }
}

// =====================================================
// 🔧 UTILITIES
// =====================================================

function isVideo(url) {
  if (!url) return false;
  return /\.(mp4|mov|avi|webm|mkv)(\?|$)/i.test(url);
}

function showTableLoading() {
  const tbody = document.getElementById('qcTableBody');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="table-loading">
          <span class="material-symbols-outlined spin">progress_activity</span>
          กำลังโหลด...
        </td>
      </tr>`;
  }
}

function showTableError(msg) {
  const tbody = document.getElementById('qcTableBody');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="table-loading" style="color:#dc2626;">
          ❌ ${escapeHtml(msg)}
        </td>
      </tr>`;
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

function formatDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return `${formatDate(ts)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// =====================================================
// 🔔 TOAST NOTIFICATION
// =====================================================
function showToast(message, type = 'success') {
  // ลบ toast เก่า
  const existingToast = document.getElementById('ea-toast');
  if (existingToast) existingToast.remove();

  const colorMap = {
    success: { bg: '#10b981', icon: '✅' },
    danger:  { bg: '#ef4444', icon: '❌' },
    warning: { bg: '#f59e0b', icon: '⚠️' },
    info:    { bg: '#3b82f6', icon: 'ℹ️' },
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
    font-family: "Kanit", "IBM Plex Sans Thai", sans-serif;
    font-size: 14px;
    font-weight: 500;
    padding: 12px 20px;
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 99999;
    opacity: 0;
    transform: translateY(12px);
    transition: opacity 0.3s ease, transform 0.3s ease;
  `;
  toast.innerHTML = `<span>${c.icon}</span><span>${escapeHtml(message)}</span>`;
  document.body.appendChild(toast);

  // แสดง
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  // หายเองใน 3 วิ
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(12px)';
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 300);
  }, 3000);
}

// =====================================================
// ✅ LOADED
// =====================================================
console.log('✅ adminQc.js loaded (fixed version)');