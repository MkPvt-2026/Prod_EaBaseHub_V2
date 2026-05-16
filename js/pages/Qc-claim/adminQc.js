// =====================================================
// adminQC.js (FULL VERSION — LINE notify ENABLED ✅)
// หน้า QC Dashboard — ตรวจสอบ อนุมัติ ปฏิเสธ Export
// =====================================================

// =====================================================
// 📲 IMPORT LINE NOTIFY SERVICE
// =====================================================
import { sendLineNotify } from "/js/services/lineNotify.js";

/** อ่าน Supabase project URL จาก supabaseClient ที่ init ไว้แล้ว */
function getSupabaseUrl() {
  // supabase-js v2 — มี property supabaseUrl
  if (supabaseClient?.supabaseUrl) {
    return supabaseClient.supabaseUrl.replace(/\/$/, '');
  }
  // fallback — ดึงจาก rest URL
  const restUrl = supabaseClient?.rest?.url || '';
  return restUrl.replace(/\/rest\/v1\/?$/, '');
}
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

function normalizeStatus(claimOrStatus) {
  if (typeof claimOrStatus === 'object' && claimOrStatus !== null) {
    return claimOrStatus.qc_status || claimOrStatus.status || 'pending';
  }
  if (claimOrStatus === 'submitted') return 'pending';
  return claimOrStatus || 'pending';
}

function normalizeMediaUrls(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch (_) {}
    return value.split(',').map(x => x.trim()).filter(Boolean);
  }
  return [];
}

function normalizeClaimTypes(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch (_) {}
    return value.split(',').map(x => x.trim()).filter(Boolean);
  }
  return [];
}

function getClaimNo(claim) {
  const raw = claim?.claim_no || claim?.claim_code || claim?.claim_id || claim?.id || '';
  return String(raw || '').substring(0, 8).toUpperCase() || '—';
}

function getClaimSearchText(claim) {
  return `${claim.product || ''} ${claim.customer || ''} ${claim.emp_name || ''} ${claim.area || ''} ${claim.detail || ''} ${getClaimNo(claim)}`.toLowerCase();
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
    await loadCurrentUserInfo();
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

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      closeLightbox();
    }
  });

  console.log('✅ Event listeners ready');
}

function setupLogout() {
  const btn = document.getElementById('logoutBtn');
  if (btn) btn.addEventListener('click', logout);
}

async function loadCurrentUserInfo() {
  try {
    const nameEl = document.getElementById('userName');
    const avatarEl = document.getElementById('userAvatar');
    if (!nameEl || typeof supabaseClient === 'undefined') return;

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('display_name, username, role')
      .eq('id', user.id)
      .single();

    const displayName = profile?.display_name || profile?.username || user.email || 'ผู้ใช้งาน';
    nameEl.textContent = displayName;
    if (avatarEl) avatarEl.textContent = displayName.trim().charAt(0).toUpperCase() || '👤';
  } catch (err) {
    console.warn('loadCurrentUserInfo failed:', err);
  }
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
      .order('created_at', { ascending: false });

    if (error) throw error;

    allClaims = data || [];
    filteredClaims = allClaims.filter(c => !c.picked_at);

    updateSummaryCards();
    renderTable(filteredClaims);

  } catch (err) {
    console.error('❌ loadClaims error:', err);
    showTableError('โหลดข้อมูลไม่สำเร็จ: ' + err.message);
  }
}

// =====================================================
// 📊 UPDATE SUMMARY CARDS
// =====================================================
function updateSummaryCards() {
  const sumTotal      = document.getElementById('sumTotal');
  const sumPending    = document.getElementById('sumPending');
  const sumInProgress = document.getElementById('sumInProgress');
  const sumApproved   = document.getElementById('sumApproved');
  const sumRejected   = document.getElementById('sumRejected');

  const pendingClaims = allClaims.filter(c => !c.picked_at);
  const pickedClaims  = allClaims.filter(c => c.picked_at);

  if (sumTotal)      sumTotal.textContent      = allClaims.length;
  if (sumPending)    sumPending.textContent    = pendingClaims.length;
  if (sumInProgress) sumInProgress.textContent = pickedClaims.filter(c => (c.qc_status || 'pending') === 'pending').length;
  if (sumApproved)   sumApproved.textContent   = allClaims.filter(c => c.qc_status === 'approved').length;
  if (sumRejected)   sumRejected.textContent   = allClaims.filter(c => c.qc_status === 'rejected').length;
}

// =====================================================
// 🔍 APPLY FILTERS
// =====================================================
function applyFilters() {
  const searchEl   = document.getElementById('searchInput');
  const statusEl   = document.getElementById('filterStatus');
  const dateFromEl = document.getElementById('filterDateFrom');
  const dateToEl   = document.getElementById('filterDateTo');

  const search   = searchEl   ? searchEl.value.toLowerCase().trim() : '';
  const status   = statusEl   ? statusEl.value   : '';
  const dateFrom = dateFromEl ? dateFromEl.value : '';
  const dateTo   = dateToEl   ? dateToEl.value   : '';

  filteredClaims = allClaims.filter(c => {
    if (search) {
      const text = getClaimSearchText(c);
      if (!text.includes(search)) return false;
    }
    if (status && normalizeStatus(c.status) !== status) return false;
    if (dateFrom && c.claim_date < dateFrom) return false;
    if (dateTo && c.claim_date > dateTo) return false;
    return true;
  });

  renderTable(filteredClaims);
}

function resetFilters() {
  const searchEl   = document.getElementById('searchInput');
  const statusEl   = document.getElementById('filterStatus');
  const dateFromEl = document.getElementById('filterDateFrom');
  const dateToEl   = document.getElementById('filterDateTo');

  if (searchEl)   searchEl.value   = '';
  if (statusEl)   statusEl.value   = '';
  if (dateFromEl) dateFromEl.value = '';
  if (dateToEl)   dateToEl.value   = '';

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

    const mediaUrls = normalizeMediaUrls(claim.media_urls);
    const thumbHtml = buildThumbsHtml(mediaUrls, 3, 'cell-thumb', 'cell-thumb-video');
    const noMedia   = mediaUrls.length === 0;

    const claimTypes = normalizeClaimTypes(claim.claim_types);
    const typesHtml = (claimTypes.length > 0)
      ? claimTypes.map(t => `<span class="type-tag">${escapeHtml(t)}</span>`).join('')
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
      <td>${buildStatusBadge(normalizeStatus(claim))}</td>
      <td>
        <div class="cell-action-group">
          <button class="btn-view" onclick="event.stopPropagation(); openModal(window._claims['${claim.id}'])">
            <span class="material-symbols-outlined" style="font-size:1rem;">open_in_new</span>
            ดู
          </button>
          ${!claim.picked_at ? `
            <button class="btn-pick" onclick="event.stopPropagation(); pickClaim('${claim.id}')">
              <span class="material-symbols-outlined" style="font-size:1rem;">how_to_reg</span>
              รับเรื่อง
            </button>
          ` : ''}
        </div>
      </td>`;

    tbody.appendChild(tr);
  });

  window._claims = {};
  claims.forEach(c => { window._claims[c.id] = c; });
}

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
  const normalized = normalizeStatus(status);
  const map = {
    submitted:     { label: "⏳ รอรับเรื่อง", cls: "submitted" },
    pending:       { label: "⏳ รอรับเรื่อง", cls: "submitted" },
    checking:      { label: "🔍 กำลังตรวจสอบ", cls: "in-progress" },
    in_progress:   { label: "🔍 กำลังตรวจสอบ", cls: "in-progress" },
    draft:         { label: "📝 บันทึกร่าง", cls: "draft" },
    waiting_ceo:   { label: "⏳ รออนุมัติ CEO", cls: "waiting-ceo" },
    approved:      { label: "✅ อนุมัติแล้ว", cls: "approved" },
    rejected:      { label: "❌ ปฏิเสธ", cls: "rejected" },
    exec_approved: { label: "✅ CEO อนุมัติแล้ว", cls: "approved" },
    exec_rejected: { label: "❌ CEO ปฏิเสธ", cls: "rejected" },
  };
  const s = map[normalized] || map.pending;
  return `<span class="status-badge ${s.cls}">${s.label}</span>`;
}

function getStatusLabel(status) {
  const map = {
    submitted:   'รออนุมัติ',
    in_progress: 'กำลังตรวจสอบ',
    approved:    'อนุมัติ',
    rejected:    'ปฏิเสธ',
    draft:       'ฉบับร่าง',
  };
  return map[normalizeStatus(status)] || status;
}

// =====================================================
// 📂 OPEN MODAL
// =====================================================
function openModal(claim) {
  if (!claim) return;
  currentClaim = claim;

  const modal = document.getElementById('qcModal');
  if (!modal) return;

  modal.classList.add('open');

  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.textContent = `เคลม #${getClaimNo(claim)}`;

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
        <div class="info-value">${buildStatusBadge(normalizeStatus(claim))}</div>
      </div>
      ${claim.qc_comment ? `
      <div class="info-row full">
        <div class="info-label">หมายเหตุ QC</div>
        <div class="info-value">${escapeHtml(claim.qc_comment)}</div>
      </div>` : ''}`;
  }

  const typesEl = document.getElementById('modalClaimTypes');
  if (typesEl) {
    const claimTypes = normalizeClaimTypes(claim.claim_types);
    typesEl.innerHTML = claimTypes.length > 0
      ? claimTypes.map(t => `<span class="modal-type-tag">${escapeHtml(t)}</span>`).join('')
      : '<span style="color:#94a3b8;">ไม่ระบุ</span>';
  }

  const modalDetail = document.getElementById('modalDetail');
  if (modalDetail) modalDetail.textContent = claim.detail || '—';

  renderModalMedia(normalizeMediaUrls(claim.media_urls));

  const qcStatusEl = document.getElementById('qcStatusCurrent');
  if (qcStatusEl) {
    qcStatusEl.innerHTML = `สถานะปัจจุบัน: ${buildStatusBadge(normalizeStatus(claim))}
      ${claim.qc_comment ? `<br><span style="color:#475569;font-size:0.82rem;">💬 ${escapeHtml(claim.qc_comment)}</span>` : ''}`;
  }

  const qcCommentEl = document.getElementById('qcComment');
  if (qcCommentEl) qcCommentEl.value = claim.qc_comment || '';

  const actionSection = document.querySelector('.qc-action-section');
  const actionButtons = document.querySelectorAll('.qc-action-btns button');
  const isDecided = ['approved', 'rejected'].includes(normalizeStatus(claim));
  if (actionSection) actionSection.classList.toggle('is-readonly', isDecided);
  actionButtons.forEach(btn => { btn.disabled = isDecided; });
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

function closeModal() {
  const modal = document.getElementById('qcModal');
  if (modal) modal.classList.remove('open');
  currentClaim = null;
}

// =====================================================
// getClaimScope
// =====================================================
function getClaimScope(claim) {
  const claimTypes = normalizeClaimTypes(claim?.claim_types);
  const text = `
    ${claim?.claim_scope || ''}
    ${claim?.product_type || ''}
    ${claim?.category || ''}
    ${claim?.customer || ''}
    ${claim?.product || ''}
    ${claimTypes.join(' ')}
  `.toLowerCase();

  if (claim?.claim_scope === 'internal') return 'internal';
  if (claim?.claim_scope === 'external') return 'external';

  if (
    text.includes('ภายใน') ||
    text.includes('internal') ||
    text.includes('วัตถุดิบ') ||
    text.includes('สินค้าภายใน') ||
    text.includes('ผลิต') ||
    text.includes('คลังสินค้า') ||
    text.includes('qc') ||
    text.includes('วิศวกรรม')
  ) return 'internal';

  return 'external';
}

// =====================================================
// ✋ PICK CLAIM — รับเรื่อง + LINE notify
// =====================================================
async function pickClaim(claimId) {
  console.log("📌 claimId ที่กด =", claimId);

  const claim = (window._claims || {})[claimId]
    || allClaims.find(c => String(c.id) === String(claimId));

  if (!claim) {
    showToast("ไม่พบข้อมูลเคลม", 'danger');
    return;
  }

  try {
    const claimScope = claim.claim_scope || getClaimScope(claim) || "external";
    const { data: { user } } = await supabaseClient.auth.getUser();

    const { data, error } = await supabaseClient
      .from("claims")
      .update({
        status:      "in_progress",
        qc_status:   "checking",
        claim_scope: claimScope,
        picked_by:   user?.id || null,
        picked_at:   new Date().toISOString(),
        updated_at:  new Date().toISOString()
      })
      .eq("id", claim.id)
      .select("*");

    if (error) {
      console.error('❌ update error:', error);
      showToast("รับเรื่องไม่สำเร็จ: " + error.message, 'danger');
      return;
    }

    if (!data || data.length === 0) {
      showToast("กดแล้วแต่ไม่มีแถวถูกอัปเดต — น่าจะติด RLS UPDATE policy", 'warning');
      return;
    }

    const updatedClaim = data[0];
    const idx = allClaims.findIndex(c => c.id === claim.id);
    if (idx !== -1) allClaims[idx] = updatedClaim;

    // ── แจ้งเตือน LINE ──
    try {
      await notifyLine('claim_picked', {
        claim: updatedClaim,
        actor: { name: await getCurrentUserName(), role: 'qc' },
      });
      showToast('รับเรื่องสำเร็จ — แจ้งเตือน LINE แล้ว', 'success');
    } catch (lineErr) {
      console.warn('LINE notify failed (non-critical):', lineErr);
      showToast('รับเรื่องสำเร็จ (แต่แจ้ง LINE ไม่สำเร็จ)', 'warning');
    }

    setTimeout(() => {
      if (claimScope === "internal") {
        window.location.href = "/pages/Qc-claim/internal-claims.html";
      } else {
        window.location.href = "/pages/Qc-claim/external-claims.html";
      }
    }, 800);

  } catch (err) {
    console.error('❌ pickClaim error:', err);
    showToast('รับเรื่องไม่สำเร็จ: ' + err.message, 'danger');
  }
}

// =====================================================
// ✅ UPDATE CLAIM STATUS — อนุมัติ/ปฏิเสธ + LINE notify
// =====================================================
async function updateClaimStatus(newStatus) {
  if (!currentClaim) return;

  const qcCommentEl = document.getElementById('qcComment');
  const comment = qcCommentEl ? qcCommentEl.value.trim() : '';
  const label   = newStatus === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ';
  const type    = newStatus === 'approved' ? 'success' : 'danger';

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

    const claimSnapshot = (idx !== -1 ? allClaims[idx] : currentClaim);
    closeModal();

    // ── แจ้งเตือน LINE ──
    try {
      await notifyLine(
        newStatus === 'approved' ? 'claim_approved' : 'claim_rejected',
        {
          claim:   claimSnapshot,
          actor:   { name: await getCurrentUserName(), role: 'qc' },
          comment: comment,
        }
      );
      showToast(`${label}เคลมสำเร็จ — แจ้งเตือน LINE แล้ว`, type);
    } catch (lineErr) {
      console.warn('LINE notify failed (non-critical):', lineErr);
      showToast(`${label}เคลมสำเร็จ (แต่แจ้ง LINE ไม่สำเร็จ)`, 'warning');
    }

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
  const lb  = document.getElementById('lightbox');
  const img = document.getElementById('lightboxImg');
  if (lb)  lb.classList.remove('open');
  if (img) img.src = '';
}

// =====================================================
// 📄 EXPORT PDF
// =====================================================
function exportPDF() {
  if (!currentClaim) {
    showToast('กรุณาเลือกเคลมก่อน', 'warning');
    return;
  }

  const c = currentClaim;

  const mediaHtml = (normalizeMediaUrls(c.media_urls).length > 0)
    ? normalizeMediaUrls(c.media_urls).filter(u => !isVideo(u))
        .map(u => `<img src="${escapeHtml(u)}" style="width:180px;height:180px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0;" onerror="this.style.display='none'">`)
        .join('')
    : '<p style="color:#94a3b8;">ไม่มีรูปภาพ</p>';

  const pdfClaimTypes = normalizeClaimTypes(c.claim_types);
  const typesHtml = pdfClaimTypes.length > 0
    ? pdfClaimTypes.map(t => `<span style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:20px;padding:3px 12px;font-size:13px;margin-right:4px;">${escapeHtml(t)}</span>`).join('')
    : '—';

  const statusEmojiMap = {
    submitted:   '⏳ รออนุมัติ',
    in_progress: '🔍 กำลังตรวจสอบ',
    approved:    '✅ อนุมัติ',
    rejected:    '❌ ปฏิเสธ',
  };
  const normalizedStatus = normalizeStatus(c.status);
  const statusLabel = statusEmojiMap[normalizedStatus] || normalizedStatus;

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
      <title>ใบแจ้งเคลม — ${escapeHtml(getClaimNo(c))}</title>
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
        .submitted   { background: #fef9c3; color: #854d0e; }
        .in_progress { background: #dbeafe; color: #1e40af; }
        .approved    { background: #dcfce7; color: #166534; }
        .rejected    { background: #fee2e2; color: #991b1b; }
        .footer-note { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 12px; font-size: 0.75rem; color: #94a3b8; display: flex; justify-content: space-between; }
        @media print { body { padding: 16px; } }
      </style>
    </head>
    <body>
      <h1>⚠️ ใบแจ้งเคลมสินค้า</h1>
      <div class="sub">เลขที่: ${escapeHtml(String(c.id || getClaimNo(c)).toUpperCase())} • สร้างเมื่อ: ${formatDateTime(c.created_at)}</div>

      <div class="section">
        <div class="section-title">ข้อมูลการแจ้งเคลม</div>
        <div class="grid2">
          <div class="info-box"><div class="info-lbl">พนักงานขาย</div><div class="info-val">${escapeHtml(c.emp_name) || '—'}</div></div>
          <div class="info-box"><div class="info-lbl">เขตการขาย</div><div class="info-val">${escapeHtml(c.area) || '—'}</div></div>
          <div class="info-box"><div class="info-lbl">ร้านค้า / ลูกค้า</div><div class="info-val">${escapeHtml(c.customer) || '—'}</div></div>
          <div class="info-box"><div class="info-lbl">วันที่แจ้งเคลม</div><div class="info-val">${formatDate(c.claim_date)}</div></div>
          <div class="info-box" style="grid-column:1/-1"><div class="info-lbl">สินค้า</div><div class="info-val">${escapeHtml(c.product) || '—'}</div></div>
          <div class="info-box"><div class="info-lbl">จำนวน</div><div class="info-val">${escapeHtml(c.qty) || '—'}</div></div>
          <div class="info-box"><div class="info-lbl">สถานะ</div><div class="info-val"><span class="status-badge ${normalizedStatus}">${statusLabel}</span></div></div>
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
// 📊 EXPORT CSV
// =====================================================
function exportCSV() {
  if (!currentClaim) {
    showToast('กรุณาเลือกเคลมก่อน', 'warning');
    return;
  }

  const c = currentClaim;
  const statusLabel = getStatusLabel(c.status);

  const rows = [
    ['หัวข้อ', 'ค่า'],
    ['เลขเคลม', c.id],
    ['พนักงานขาย', c.emp_name || '-'],
    ['เขต', c.area || '-'],
    ['ร้านค้า / ลูกค้า', c.customer || '-'],
    ['สินค้า', c.product || '-'],
    ['จำนวน', c.qty || '-'],
    ['ประเภทปัญหา', normalizeClaimTypes(c.claim_types).join(', ')],
    ['รายละเอียด', (c.detail || '').replace(/\n/g, ' ')],
    ['สถานะ', statusLabel],
    ['วันที่แจ้งเคลม', formatDate(c.claim_date)],
    ['วันที่เปิดบิล', formatDate(c.buy_date)],
    ['วันที่ผลิต', formatDate(c.mfg_date)],
    ['หมายเหตุ QC', c.qc_comment || '-'],
    ['สร้างเมื่อ', formatDateTime(c.created_at)]
  ];

  const csv = '\uFEFF' + rows.map(row =>
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  ).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `claim_${getClaimNo(c)}_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('ดาวน์โหลด CSV สำเร็จ', 'success');
}

// =====================================================
// 📊 EXPORT EXCEL
// =====================================================
function exportExcel() {
  if (currentClaim) {
    exportSingleClaimExcel();
    return;
  }

  if (!filteredClaims || filteredClaims.length === 0) {
    showToast('ไม่มีข้อมูลสำหรับ Export', 'warning');
    return;
  }

  const rows = [
    ['วันที่แจ้งเคลม', 'พนักงานขาย', 'เขต', 'ร้านค้า', 'สินค้า', 'จำนวน', 'ประเภทปัญหา', 'รายละเอียด', 'สถานะ', 'วันที่บิล', 'วันที่ผลิต', 'หมายเหตุ QC']
  ];

  filteredClaims.forEach(c => {
    rows.push([
      formatDate(c.claim_date),
      c.emp_name || '',
      c.area || '',
      c.customer || '',
      c.product || '',
      c.qty || '',
      normalizeClaimTypes(c.claim_types).join(', '),
      (c.detail || '').replace(/\n/g, ' '),
      getStatusLabel(c.status),
      formatDate(c.buy_date),
      formatDate(c.mfg_date),
      c.qc_comment || ''
    ]);
  });

  if (typeof XLSX !== 'undefined') {
    try {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [
        { wch: 14 }, { wch: 18 }, { wch: 12 }, { wch: 20 }, { wch: 25 },
        { wch: 8 },  { wch: 20 }, { wch: 30 }, { wch: 14 }, { wch: 14 },
        { wch: 14 }, { wch: 20 },
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

function exportSingleClaimExcel() {
  if (!currentClaim) {
    showToast('ไม่พบข้อมูลเคลม', 'warning');
    return;
  }

  const c = currentClaim;
  const statusLabel = getStatusLabel(c.status);

  const data = [
    ['หัวข้อ', 'ค่า'],
    ['เลขเคลม', c.id],
    ['พนักงานขาย', c.emp_name || '-'],
    ['เขต', c.area || '-'],
    ['ร้านค้า', c.customer || '-'],
    ['สินค้า', c.product || '-'],
    ['จำนวน', c.qty || '-'],
    ['ประเภทปัญหา', normalizeClaimTypes(c.claim_types).join(', ')],
    ['รายละเอียด', c.detail || '-'],
    ['สถานะ', statusLabel],
    ['วันที่เคลม', formatDate(c.claim_date)],
    ['วันที่บิล', formatDate(c.buy_date)],
    ['วันที่ผลิต', formatDate(c.mfg_date)],
    ['QC Comment', c.qc_comment || '-'],
    ['สร้างเมื่อ', formatDateTime(c.created_at)]
  ];

  if (typeof XLSX !== 'undefined') {
    try {
      const ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = [{ wch: 20 }, { wch: 50 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Claim Detail");
      XLSX.writeFile(wb, `claim_${getClaimNo(c)}.xlsx`);
      showToast('ดาวน์โหลด Excel สำเร็จ', 'success');
      return;
    } catch (err) {
      console.warn('XLSX export failed, falling back to CSV:', err);
    }
  }

  const csv = '\uFEFF' + data.map(row =>
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  ).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `claim_${getClaimNo(c)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('ดาวน์โหลด CSV สำเร็จ', 'success');
}

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
  const statusLabel = getStatusLabel(c.status);

  try {
    showToast('กำลังสร้างไฟล์...', 'info');

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Claim");
    sheet.columns = [{ width: 25 }, { width: 50 }];

    sheet.mergeCells('A1:B1');
    const headerCell = sheet.getCell('A1');
    headerCell.value = "ใบแจ้งเคลมสินค้า";
    headerCell.font = { size: 18, bold: true };
    headerCell.alignment = { horizontal: 'center' };

    sheet.addRow([]);

    const rows = [
      ["เลขเคลม", c.id],
      ["พนักงานขาย", c.emp_name || '-'],
      ["เขต", c.area || '-'],
      ["ร้านค้า", c.customer || '-'],
      ["สินค้า", c.product || '-'],
      ["จำนวน", c.qty || '-'],
      ["ประเภทปัญหา", normalizeClaimTypes(c.claim_types).join(', ')],
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
          top: { style: 'thin' }, bottom: { style: 'thin' },
          left: { style: 'thin' }, right: { style: 'thin' },
        };
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();

    if (typeof saveAs !== 'undefined') {
      saveAs(new Blob([buffer]), `claim_${getClaimNo(c)}.xlsx`);
    } else {
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `claim_${getClaimNo(c)}.xlsx`;
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
// 📲 LINE NOTIFY HELPER — ใช้ sendLineNotify ที่มีอยู่แล้ว
// =====================================================
/**
 * ส่งแจ้งเตือน LINE ผ่าน Edge Function (multi-event)
 *
 * @param {string} eventType  'claim_picked' | 'claim_approved' | 'claim_rejected' ...
 * @param {object} payload    { claim, actor, comment }
 */
async function notifyLine(eventType, payload) {
  return sendLineNotify({
    type:    eventType,
    claim:   payload.claim,
    actor:   payload.actor   || null,
    comment: payload.comment || '',
  });
}




async function notifyLine(eventType, payload) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('ไม่ได้ login');

  const res = await fetch(LINE_CONFIG.SUPABASE_URL + LINE_CONFIG.ENDPOINT, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      type:    eventType,
      claim:   payload.claim,
      actor:   payload.actor   || null,
      comment: payload.comment || '',
    }),
  });

  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(result)}`);
  return result;
}

async function getCurrentUserName() {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return 'ระบบ';

    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('display_name, username')
      .eq('id', user.id)
      .single();

    return profile?.display_name || profile?.username || user.email || 'ระบบ';
  } catch (err) {
    console.warn('getCurrentUserName failed:', err);
    return 'ระบบ';
  }
}

// alias สำหรับโค้ดเก่าที่อาจเรียก getCurrentQcName
const getCurrentQcName = getCurrentUserName;

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

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(12px)';
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 300);
  }, 3000);
}

console.log('✅ adminQc.js loaded (LINE notify ENABLED — multi-event support)');