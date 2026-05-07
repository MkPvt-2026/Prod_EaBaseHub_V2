// =====================================================
// internal-claims.js
// หน้า QC ตรวจสอบเคลมภายใน
// =====================================================

const CLAIM_SCOPE = 'internal';

let allClaims = [];
let filteredClaims = [];
let currentClaim = null;

function escapeHtml(value) {
  if (value == null) return '';
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
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
    try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return parsed.filter(Boolean); } catch (_) {}
    return value.split(',').map(x => x.trim()).filter(Boolean);
  }
  return [];
}

function normalizeClaimTypes(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return parsed.filter(Boolean); } catch (_) {}
    return value.split(',').map(x => x.trim()).filter(Boolean);
  }
  return [];
}

function getClaimNo(claim) {
  const raw = claim?.claim_no || claim?.claim_code || claim?.claim_id || claim?.id || '';
  return String(raw || '').substring(0, 8).toUpperCase() || '—';
}

function getClaimSearchText(claim) {
  return `${claim?.emp_name || ''} ${claim?.area || ''} ${claim?.customer || ''} ${claim?.product || ''} ${claim?.detail || ''} ${getClaimNo(claim)}`.toLowerCase();
}

function isVideo(url) { return url ? /\.(mp4|mov|avi|webm|mkv)(\?|$)/i.test(url) : false; }

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  return `${formatDate(dateStr)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function waitForSupabase() {
  let attempts = 0;
  while (typeof supabaseClient === 'undefined' && attempts < 50) {
    await new Promise(resolve => setTimeout(resolve, 100));
    attempts++;
  }
  return typeof supabaseClient !== 'undefined';
}

function setupLogout() {
  const btn = document.getElementById('logoutBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (typeof logout === 'function') { await logout(); return; }
    await supabaseClient.auth.signOut();
    window.location.href = '/index.html';
  });
}

async function loadCurrentUserInfo() {
  try {
    const nameEl = document.getElementById('userName');
    const avatarEl = document.getElementById('userAvatar');
    if (!nameEl) return;
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabaseClient.from('profiles').select('display_name, username, role').eq('id', user.id).single();
    const displayName = profile?.display_name || profile?.username || user.email || 'ผู้ใช้งาน';
    nameEl.textContent = displayName;
    if (avatarEl) avatarEl.textContent = displayName.trim().charAt(0).toUpperCase() || '👤';
  } catch (err) { console.warn('loadCurrentUserInfo failed:', err); }
}

function showTableLoading() {
  const tbody = document.getElementById('qcTableBody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" class="table-loading"><span class="material-symbols-outlined spin">progress_activity</span>กำลังโหลด...</td></tr>`;
}

function showTableError(message) {
  const tbody = document.getElementById('qcTableBody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" class="table-loading" style="color:#dc2626;">❌ ${escapeHtml(message)}</td></tr>`;
}

async function loadClaims() {
  try {
    showTableLoading();
    const { data, error } = await supabaseClient
      .from('claims')
      .select('*')
      .eq('claim_scope', CLAIM_SCOPE)
      .not('picked_at', 'is', null)
      .order('picked_at', { ascending: false });
    if (error) throw error;
    console.log(`${CLAIM_SCOPE} claims =`, data);
    allClaims = data || [];
    filteredClaims = [...allClaims];
    populateCustomerFilter();
    updateSummaryCards();
    renderTable(filteredClaims);
  } catch (err) {
    console.error('❌ loadClaims error:', err);
    showTableError('โหลดข้อมูลไม่สำเร็จ: ' + err.message);
  }
}

function updateSummaryCards() {
  const sumTotal      = document.getElementById('sumTotal');
  const sumPending    = document.getElementById('sumPending');
  const sumInProgress = document.getElementById('sumInProgress');
  const sumApproved   = document.getElementById('sumApproved');
  const sumRejected   = document.getElementById('sumRejected');

  const pending = allClaims.filter(c => (c.qc_status || 'pending') === 'pending').length;

  const checking = allClaims.filter(c =>
    ['checking', 'in_progress'].includes(c.qc_status)
  ).length;

  const approved = allClaims.filter(c => c.qc_status === 'approved').length;

  const rejected = allClaims.filter(c => c.qc_status === 'rejected').length;

  if (sumTotal) {
    sumTotal.textContent = allClaims.length;
  }

  // หน้า internal/external = รับเรื่องแล้วทั้งหมด
  if (sumPending) {
    sumPending.textContent = 0;
  }

  if (sumInProgress) {
    sumInProgress.textContent = pending + checking;
  }

  if (sumApproved) {
    sumApproved.textContent = approved;
  }

  if (sumRejected) {
    sumRejected.textContent = rejected;
  }
}

function populateCustomerFilter() {
  const filterCustomer = document.getElementById('filterCustomer');
  if (!filterCustomer) return;
  const current = filterCustomer.value;
  const customers = [...new Set(allClaims.map(c => c.customer).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'th'));
  filterCustomer.innerHTML = `<option value="">ทุกลูกค้า</option>`;
  customers.forEach(customer => {
    const opt = document.createElement('option');
    opt.value = customer; opt.textContent = customer; filterCustomer.appendChild(opt);
  });
  filterCustomer.value = current;
}

function setupEventListeners() {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    let timer;
    searchInput.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(applyFilters, 250); });
  }
  ['filterStatus','filterDateFrom','filterDateTo','filterDept','filterCustomer'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', applyFilters);
  });
  const modal = document.getElementById('qcModal');
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeLightbox(); } });
}

function applyFilters() {
  const search = document.getElementById('searchInput')?.value.toLowerCase().trim() || '';
  const status = document.getElementById('filterStatus')?.value || '';
  const dateFrom = document.getElementById('filterDateFrom')?.value || '';
  const dateTo = document.getElementById('filterDateTo')?.value || '';
  const dept = document.getElementById('filterDept')?.value || '';
  const customer = document.getElementById('filterCustomer')?.value || '';
  filteredClaims = allClaims.filter(claim => {
    if (search && !getClaimSearchText(claim).includes(search)) return false;
    if (status && normalizeStatus(claim) !== normalizeStatus(status)) return false;
    if (dateFrom && claim.claim_date < dateFrom) return false;
    if (dateTo && claim.claim_date > dateTo) return false;
    if (dept && claim.area !== dept) return false;
    if (customer && claim.customer !== customer) return false;
    return true;
  });
  renderTable(filteredClaims);
}

function resetFilters() {
  ['searchInput','filterStatus','filterDateFrom','filterDateTo','filterDept','filterCustomer'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  filteredClaims = [...allClaims];
  renderTable(filteredClaims);
}

function buildStatusBadge(status) {
  const normalized = normalizeStatus(status);
  const map = {
    pending: { label: '⏳ รอตรวจสอบ', cls: 'submitted' },
    checking: { label: '🔍 กำลังตรวจสอบ', cls: 'in-progress' },
    in_progress: { label: '🔍 กำลังตรวจสอบ', cls: 'in-progress' },
    approved: { label: '✅ อนุมัติแล้ว', cls: 'approved' },
    rejected: { label: '❌ ปฏิเสธ', cls: 'rejected' },
  };
  const s = map[normalized] || map.pending;
  return `<span class="status-badge ${s.cls}">${s.label}</span>`;
}

function getStatusLabel(status) {
  const normalized = normalizeStatus(status);
  const map = { pending:'รอตรวจสอบ', checking:'กำลังตรวจสอบ', in_progress:'กำลังตรวจสอบ', approved:'อนุมัติแล้ว', rejected:'ปฏิเสธ' };
  return map[normalized] || normalized;
}

function buildThumbsHtml(urls, maxShow = 3) {
  if (!urls || urls.length === 0) return '';
  const show = urls.slice(0, maxShow);
  let html = show.map(url => isVideo(url) ? `<div class="cell-thumb-video">🎥</div>` : `<img class="cell-thumb" src="${escapeHtml(url)}" onerror="this.style.display='none'" alt="">`).join('');
  if (urls.length > maxShow) html += `<div class="cell-thumb-video" style="background:#64748b;font-size:0.72rem;">+${urls.length - maxShow}</div>`;
  return html;
}

function renderTable(claims) {
  const tbody = document.getElementById('qcTableBody');
  if (!tbody) return;
  if (!claims || claims.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-loading" style="color:#64748b;">ไม่พบรายการเคลมภายในที่รับเรื่องแล้ว</td></tr>`;
    return;
  }
  tbody.innerHTML = '';
  claims.forEach(claim => {
    const tr = document.createElement('tr');
    tr.onclick = () => openModal(claim);
    const mediaUrls = normalizeMediaUrls(claim.media_urls);
    const claimTypes = normalizeClaimTypes(claim.claim_types);
    const typesHtml = claimTypes.length ? claimTypes.map(t => `<span class="type-tag">${escapeHtml(t)}</span>`).join('') : '<span style="color:#cbd5e1;font-size:0.75rem;">—</span>';
    tr.innerHTML = `
      <td><div class="cell-date">${formatDate(claim.claim_date)}</div><div class="cell-sub">${formatDateTime(claim.created_at)}</div></td>
      <td><div style="font-weight:500;">${escapeHtml(claim.emp_name) || '—'}</div><div class="cell-sub">${escapeHtml(claim.area) || '—'}</div></td>
      
      <td class="cell-product"><div>${escapeHtml(claim.product) || '—'}</div><div class="cell-sub">${escapeHtml(claim.qty) || ''}</div></td>
      <td><div class="cell-types">${typesHtml}</div></td>
      <td>${mediaUrls.length === 0 ? '<span class="cell-no-media">ไม่มีไฟล์</span>' : `<div class="cell-thumbs">${buildThumbsHtml(mediaUrls, 3)}</div>`}</td>
      <td>${buildStatusBadge(claim)}</td>
      <td><div class="cell-action-group"><button class="btn-view" type="button" onclick="event.stopPropagation(); openModal(window._claims['${claim.id}'])"><span class="material-symbols-outlined" style="font-size:1rem;">open_in_new</span>ดู</button></div></td>
    `;
    tbody.appendChild(tr);
  });
  window._claims = {};
  claims.forEach(c => { window._claims[c.id] = c; });
}

function openModal(claim) {
  if (!claim) return;
  currentClaim = claim;
  const modal = document.getElementById('qcModal');
  if (!modal) return;
  modal.classList.add('open');
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.textContent = `เคลมภายใน #${getClaimNo(claim)}`;
  const modalInfoGrid = document.getElementById('modalInfoGrid');
  if (modalInfoGrid) {
    modalInfoGrid.innerHTML = `
      <div class="info-row"><div class="info-label">ผู้แจ้ง / พนักงาน</div><div class="info-value">${escapeHtml(claim.emp_name) || '—'}</div></div>
      <div class="info-row"><div class="info-label">แผนก / เขต</div><div class="info-value">${escapeHtml(claim.area) || '—'}</div></div>
      <div class="info-row"><div class="info-label">ร้านค้า / ลูกค้า</div><div class="info-value">${escapeHtml(claim.customer) || '—'}</div></div>
      <div class="info-row"><div class="info-label">วันที่แจ้งเคลม</div><div class="info-value">${formatDate(claim.claim_date)}</div></div>
      <div class="info-row full"><div class="info-label">สินค้า</div><div class="info-value">${escapeHtml(claim.product) || '—'}</div></div>
      <div class="info-row"><div class="info-label">จำนวน</div><div class="info-value">${escapeHtml(claim.qty) || '—'}</div></div>
      <div class="info-row"><div class="info-label">วันที่รับเรื่อง</div><div class="info-value">${formatDateTime(claim.picked_at)}</div></div>
      <div class="info-row"><div class="info-label">สถานะ QC</div><div class="info-value">${buildStatusBadge(claim)}</div></div>
      ${claim.qc_comment ? `<div class="info-row full"><div class="info-label">หมายเหตุ QC</div><div class="info-value">${escapeHtml(claim.qc_comment)}</div></div>` : ''}
    `;
  }
  const typesEl = document.getElementById('modalClaimTypes');
  if (typesEl) {
    const claimTypes = normalizeClaimTypes(claim.claim_types);
    typesEl.innerHTML = claimTypes.length ? claimTypes.map(t => `<span class="modal-type-tag">${escapeHtml(t)}</span>`).join('') : '<span style="color:#94a3b8;">ไม่ระบุ</span>';
  }
  const detailEl = document.getElementById('modalDetail');
  if (detailEl) detailEl.textContent = claim.detail || '—';
  const commentEl = document.getElementById('qcComment');
  if (commentEl) commentEl.value = claim.qc_comment || '';
  const statusEl = document.getElementById('qcStatusCurrent');
  if (statusEl) statusEl.innerHTML = `สถานะปัจจุบัน: ${buildStatusBadge(claim)}`;
  renderModalMedia(normalizeMediaUrls(claim.media_urls));
  const isDecided = ['approved', 'rejected'].includes(normalizeStatus(claim));
  document.querySelectorAll('.qc-action-btns button').forEach(btn => { btn.disabled = isDecided; });
}

function closeModal() {
  const modal = document.getElementById('qcModal');
  if (modal) modal.classList.remove('open');
  currentClaim = null;
}

function renderModalMedia(urls) {
  const grid = document.getElementById('modalMediaGrid');
  if (!grid) return;
  if (!urls || urls.length === 0) { grid.innerHTML = '<div class="media-no-file">ไม่มีรูปภาพหรือวิดีโอที่แนบ</div>'; return; }
  grid.innerHTML = '';
  urls.forEach(url => {
    const item = document.createElement('div'); item.className = 'media-item';
    if (isVideo(url)) {
      item.innerHTML = `<div class="media-video-wrap"><video src="${escapeHtml(url)}" preload="metadata"></video><div class="media-play-icon">▶</div></div>`;
      item.onclick = () => window.open(url, '_blank');
    } else {
      item.innerHTML = `<img src="${escapeHtml(url)}" alt="">`;
      item.onclick = () => openLightbox(url);
    }
    grid.appendChild(item);
  });
}

async function updateClaimStatus(newStatus) {
  if (!currentClaim) return;
  const comment = document.getElementById('qcComment')?.value.trim() || '';
  const label = newStatus === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ';
  if (!confirm(`ยืนยันการ${label}เคลมนี้?`)) return;
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const { error } = await supabaseClient.from('claims').update({ qc_status: newStatus, qc_comment: comment || null, qc_by: user?.id || null, updated_at: new Date().toISOString() }).eq('id', currentClaim.id);
    if (error) throw error;
    showToast(`${label}เคลมสำเร็จ`, 'success');
    closeModal();
    await loadClaims();
  } catch (err) {
    console.error('❌ updateClaimStatus error:', err);
    showToast('บันทึกผลไม่สำเร็จ: ' + err.message, 'danger');
  }
}

async function sendToCEO() {
  if (!currentClaim) return;
  if (!confirm('ส่งรายการนี้ให้ CEO อนุมัติใช่ไหม?')) return;
  try {
    const { error } = await supabaseClient.from('claims').update({ qc_status: 'approved', exec_status: 'pending', updated_at: new Date().toISOString() }).eq('id', currentClaim.id);
    if (error) throw error;
    showToast('ส่งให้ CEO อนุมัติแล้ว', 'success');
    closeModal();
    await loadClaims();
  } catch (err) {
    console.error('❌ sendToCEO error:', err);
    showToast('ส่งให้ CEO ไม่สำเร็จ: ' + err.message, 'danger');
  }
}

function openLightbox(url) {
  const lb = document.getElementById('lightbox');
  const img = document.getElementById('lightboxImg');
  if (!lb || !img) { window.open(url, '_blank'); return; }
  img.src = url; lb.classList.add('open');
}

function closeLightbox() {
  const lb = document.getElementById('lightbox');
  const img = document.getElementById('lightboxImg');
  if (lb) lb.classList.remove('open');
  if (img) img.src = '';
}

function exportExcel() {
  if (!filteredClaims || filteredClaims.length === 0) { showToast('ไม่มีข้อมูลสำหรับ Export', 'warning'); return; }
  const rows = [['เลขเคลม','วันที่แจ้ง','ผู้แจ้ง','เขต/แผนก','ลูกค้า','สินค้า','จำนวน','ประเภทปัญหา','รายละเอียด','สถานะ QC','วันที่รับเรื่อง','หมายเหตุ QC']];
  filteredClaims.forEach(c => rows.push([getClaimNo(c), formatDate(c.claim_date), c.emp_name || '', c.area || '', c.customer || '', c.product || '', c.qty || '', normalizeClaimTypes(c.claim_types).join(', '), c.detail || '', getStatusLabel(c), formatDateTime(c.picked_at), c.qc_comment || '']));
  if (typeof XLSX !== 'undefined') {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Claims');
    XLSX.writeFile(wb, `${CLAIM_SCOPE}_claims_${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast('ดาวน์โหลด Excel สำเร็จ', 'success');
    return;
  }
  const csv = '\uFEFF' + rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${CLAIM_SCOPE}_claims_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  showToast('ดาวน์โหลด CSV สำเร็จ', 'success');
}

function showToast(message, type = 'success') {
  const old = document.getElementById('ea-toast'); if (old) old.remove();
  const colorMap = { success:'#10b981', danger:'#ef4444', warning:'#f59e0b', info:'#3b82f6' };
  const toast = document.createElement('div');
  toast.id = 'ea-toast';
  toast.style.cssText = `position:fixed;bottom:28px;right:28px;z-index:99999;background:${colorMap[type] || colorMap.success};color:#fff;padding:12px 18px;border-radius:12px;font-family:"Kanit",sans-serif;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,.18);`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    console.log(`🚀 ${CLAIM_SCOPE}-claims init start`);
    const ready = await waitForSupabase();
    if (!ready) { alert('ไม่สามารถเชื่อมต่อ Supabase ได้'); return; }
    setupLogout();
    if (typeof protectPage === 'function') await protectPage(['admin', 'adminQc', 'adminqc']);
    await loadCurrentUserInfo();
    await loadClaims();
    setupEventListeners();
    console.log(`✅ ${CLAIM_SCOPE}-claims init done`);
  } catch (err) {
    console.error(`❌ ${CLAIM_SCOPE} init error:`, err);
    showTableError('โหลดหน้าไม่สำเร็จ: ' + err.message);
  }
});

console.log(`✅ ${CLAIM_SCOPE}-claims.js loaded`);
