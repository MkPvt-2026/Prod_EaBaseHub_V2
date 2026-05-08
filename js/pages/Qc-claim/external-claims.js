// ============================================================
// external-claims.js
// หน้า QC ตรวจสอบเคลมลูกค้า (External Claims)
// ============================================================

const CLAIM_SCOPE = "external";

let allClaims = [];
let filteredClaims = [];
let currentClaim = null;

// ---------- Utilities ----------
function escapeHtml(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeStatus(claimOrStatus) {
  if (typeof claimOrStatus === "object" && claimOrStatus !== null) {
    return claimOrStatus.qc_status || claimOrStatus.status || "pending";
  }
  if (claimOrStatus === "submitted") return "pending";
  return claimOrStatus || "pending";
}

function normalizeMediaUrls(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch (_) {}
    return value.split(",").map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

function normalizeClaimTypes(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch (_) {}
    return value.split(",").map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

function getClaimNo(claim) {
  const raw =
    claim?.claim_no || claim?.claim_code || claim?.claim_id || claim?.id || "";
  return String(raw || "").substring(0, 8).toUpperCase() || "—";
}

function getClaimSearchText(claim) {
  return `${claim?.emp_name || ""} ${claim?.area || ""} ${claim?.customer || ""} ${claim?.product || ""} ${claim?.detail || ""} ${getClaimNo(claim)}`.toLowerCase();
}

function isVideo(url) {
  return url ? /\.(mp4|mov|avi|webm|mkv)(\?|$)/i.test(url) : false;
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function formatDateTime(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatDate(dateStr)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

async function waitForSupabase() {
  let attempts = 0;
  while (typeof supabaseClient === "undefined" && attempts < 50) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    attempts++;
  }
  return typeof supabaseClient !== "undefined";
}

// ---------- QC Form Helpers (ใช้ร่วมกัน) ----------
// ---------- อัปเดตฟังก์ชันดึงข้อมูลฟอร์ม (รองรับ 5 เกรด + สาเหตุ) ----------
function getQcFormData() {
  return {
    qcResult: {
      material_type: document.getElementById("qcMaterialType")?.value,
      grade_a_qty: Number(document.getElementById("qcGradeAQty")?.value || 0),
      grade_b_qty: Number(document.getElementById("qcGradeBQty")?.value || 0),
      regrind_qty: Number(document.getElementById("qcRegrindQty")?.value || 0),
      waste_qty: Number(document.getElementById("qcWasteQty")?.value || 0),
      defect_reason: document.getElementById("qcDefectReason")?.value,
      responsibility: document.getElementById("qcResponsibility")?.value,
      comment: document.getElementById("qcComment")?.value.trim()
    }
  };
}

// ฟังก์ชันอัปเดตยอดรวม (Weight/Unit)
function updateQcTotal() {
  const a = Number(document.getElementById("qcGradeAQty")?.value || 0);
  const b = Number(document.getElementById("qcGradeBQty")?.value || 0);
  const r = Number(document.getElementById("qcRegrindQty")?.value || 0);
  const w = Number(document.getElementById("qcWasteQty")?.value || 0);
  
  const totalEl = document.getElementById("qcTotalQty");
  if (totalEl) totalEl.textContent = (a + b + r + w).toLocaleString();
}


// ---------- อัปเดตการแสดงผลใน Modal เมื่อเปิดดูข้อมูลเก่า ----------
// (แก้ไขส่วนหนึ่งใน openModal)
function fillQcFormData(claim) {
  const res = claim.qc_result || {};
  
  document.getElementById("qcGradeAQty").value = res.grade_a_qty || 0;
  document.getElementById("qcGradeBQty").value = res.grade_b_qty || 0;
  document.getElementById("qcRepairQty").value = res.repair_qty || 0;
  document.getElementById("qcSpareQty").value = res.spare_qty || 0;
  document.getElementById("qcScrapQty").value = res.scrap_qty || 0;
  
  document.getElementById("qcDefectReason").value = res.defect_reason || "";
  document.getElementById("qcResponsibility").value = res.responsibility || "";
  document.getElementById("qcComment").value = claim.qc_comment || "";

  // Sync Checkboxes
  syncQtyCheckbox("qcGradeAQty", "qcGradeACheck");
  syncQtyCheckbox("qcGradeBQty", "qcGradeBCheck");
  syncQtyCheckbox("qcRepairQty", "qcRepairCheck");
  syncQtyCheckbox("qcSpareQty", "qcSpareCheck");
  syncQtyCheckbox("qcScrapQty", "qcScrapCheck");
  
  updateQcTotal();
}

// ---------- อัปเดตฟังก์ชันรวมยอด ----------
function updateQcTotal() {
  const a = Number(document.getElementById("qcGradeAQty")?.value || 0);
  const b = Number(document.getElementById("qcGradeBQty")?.value || 0);
  const r = Number(document.getElementById("qcRepairQty")?.value || 0);
  const s = Number(document.getElementById("qcSpareQty")?.value || 0);
  const c = Number(document.getElementById("qcScrapQty")?.value || 0);
  
  const totalEl = document.getElementById("qcTotalQty");
  if (totalEl) totalEl.textContent = (a + b + r + s + c);
}

// ---------- แก้ไขฟังก์ชัน stepQty ให้รองรับ ID ใหม่ ----------
function stepQty(inputId, step) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const next = Math.max(0, Number(input.value || 0) + step);
  input.value = next;

  const checkboxMap = {
    qcGradeAQty: "qcGradeACheck",
    qcGradeBQty: "qcGradeBCheck",
    qcRepairQty: "qcRepairCheck",
    qcSpareQty: "qcSpareCheck",
    qcScrapQty: "qcScrapCheck",
  };
  syncQtyCheckbox(inputId, checkboxMap[inputId]);
  updateQcTotal();
}


async function getCurrentUserId() {
  try {
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();
    return user?.id || null;
  } catch (_) {
    return null;
  }
}

// ---------- Auth / Header ----------
function setupLogout() {
  const btn = document.getElementById("logoutBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (typeof logout === "function") {
      await logout();
      return;
    }
    await supabaseClient.auth.signOut();
    window.location.href = "/index.html";
  });
}

async function loadCurrentUserInfo() {
  try {
    const nameEl = document.getElementById("userName");
    const avatarEl = document.getElementById("userAvatar");
    if (!nameEl) return;
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("display_name, username, role")
      .eq("id", user.id)
      .single();
    const displayName =
      profile?.display_name || profile?.username || user.email || "ผู้ใช้งาน";
    nameEl.textContent = displayName;
    if (avatarEl)
      avatarEl.textContent = displayName.trim().charAt(0).toUpperCase() || "👤";
  } catch (err) {
    console.warn("loadCurrentUserInfo failed:", err);
  }
}

// ---------- Loading / Errors ----------
function showTableLoading() {
  const tbody = document.getElementById("qcTableBody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="8" class="table-loading"><span class="material-symbols-outlined spin">progress_activity</span>กำลังโหลด...</td></tr>`;
}

function showTableError(message) {
  const tbody = document.getElementById("qcTableBody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="8" class="table-loading" style="color:#dc2626;">❌ ${escapeHtml(message)}</td></tr>`;
}

// ---------- Load Claims ----------
async function loadClaims() {
  try {
    showTableLoading();
    const { data, error } = await supabaseClient
      .from("claims")
      .select("*")
      .eq("claim_scope", CLAIM_SCOPE)
      .not("picked_at", "is", null)
      .order("picked_at", { ascending: false });
    if (error) throw error;
    console.log(`${CLAIM_SCOPE} claims =`, data);
    allClaims = data || [];
    filteredClaims = [...allClaims];
    populateCustomerFilter();
    updateSummaryCards();
    renderTable(filteredClaims);
  } catch (err) {
    console.error("❌ loadClaims error:", err);
    showTableError("โหลดข้อมูลไม่สำเร็จ: " + err.message);
  }
}

function updateSummaryCards() {
  const sumTotal = document.getElementById("sumTotal");
  const sumPending = document.getElementById("sumPending");
  const sumInProgress = document.getElementById("sumInProgress");
  const sumApproved = document.getElementById("sumApproved");
  const sumRejected = document.getElementById("sumRejected");

  const pending = allClaims.filter((c) => normalizeStatus(c) === "pending").length;

  const inProgress = allClaims.filter((c) =>
    ["checking", "in_progress", "draft", "waiting_ceo"].includes(normalizeStatus(c))
  ).length;

  const approved = allClaims.filter((c) => normalizeStatus(c) === "approved").length;
  const rejected = allClaims.filter((c) => normalizeStatus(c) === "rejected").length;

  if (sumTotal) sumTotal.textContent = allClaims.length;
  if (sumPending) sumPending.textContent = pending;
  if (sumInProgress) sumInProgress.textContent = inProgress;
  if (sumApproved) sumApproved.textContent = approved;
  if (sumRejected) sumRejected.textContent = rejected;
}

function populateCustomerFilter() {
  const filterCustomer = document.getElementById("filterCustomer");
  if (!filterCustomer) return;
  const current = filterCustomer.value;
  const customers = [
    ...new Set(allClaims.map((c) => c.customer).filter(Boolean)),
  ].sort((a, b) => String(a).localeCompare(String(b), "th"));
  filterCustomer.innerHTML = `<option value="">ทุกลูกค้า</option>`;
  customers.forEach((customer) => {
    const opt = document.createElement("option");
    opt.value = customer;
    opt.textContent = customer;
    filterCustomer.appendChild(opt);
  });
  filterCustomer.value = current;
}

// ---------- Filters ----------
function setupEventListeners() {
  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    let timer;
    searchInput.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(applyFilters, 250);
    });
  }
  [
    "filterStatus",
    "filterDateFrom",
    "filterDateTo",
    "filterDept",
    "filterCustomer",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", applyFilters);
  });
  const modal = document.getElementById("qcModal");
  if (modal)
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
      closeLightbox();
    }
  });
}

function applyFilters() {
  const search =
    document.getElementById("searchInput")?.value.toLowerCase().trim() || "";
  const status = document.getElementById("filterStatus")?.value || "";
  const dateFrom = document.getElementById("filterDateFrom")?.value || "";
  const dateTo = document.getElementById("filterDateTo")?.value || "";
  const dept = document.getElementById("filterDept")?.value || "";
  const customer = document.getElementById("filterCustomer")?.value || "";
  filteredClaims = allClaims.filter((claim) => {
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
  [
    "searchInput",
    "filterStatus",
    "filterDateFrom",
    "filterDateTo",
    "filterDept",
    "filterCustomer",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  filteredClaims = [...allClaims];
  renderTable(filteredClaims);
}

// ---------- Render Table ----------
function buildStatusBadge(status) {
  const normalized = normalizeStatus(status);
  const map = {
    pending: { label: "🔍 กำลังตรวจสอบ", cls: "in-progress" },
    checking: { label: "🔍 กำลังตรวจสอบ", cls: "in-progress" },
    in_progress: { label: "🔍 กำลังตรวจสอบ", cls: "in-progress" },
    draft: { label: "📝 ร่าง", cls: "in-progress" },
    waiting_ceo: { label: "⏳ รอ CEO อนุมัติ", cls: "in-progress" },
    approved: { label: "✅ อนุมัติแล้ว", cls: "approved" },
    rejected: { label: "❌ ปฏิเสธ", cls: "rejected" },
  };
  const s = map[normalized] || map.pending;
  return `<span class="status-badge ${s.cls}">${s.label}</span>`;
}

function getStatusLabel(status) {
  const normalized = normalizeStatus(status);
  const map = {
    pending: "รอตรวจสอบ",
    checking: "กำลังตรวจสอบ",
    in_progress: "กำลังตรวจสอบ",
    draft: "ร่าง",
    waiting_ceo: "รอ CEO อนุมัติ",
    approved: "อนุมัติแล้ว",
    rejected: "ปฏิเสธ",
  };
  return map[normalized] || normalized;
}

function buildThumbsHtml(urls, maxShow = 3) {
  if (!urls || urls.length === 0) return "";
  const show = urls.slice(0, maxShow);
  let html = show
    .map((url) =>
      isVideo(url)
        ? `<div class="cell-thumb-video">🎥</div>`
        : `<img class="cell-thumb" src="${escapeHtml(url)}" onerror="this.style.display='none'" alt="">`,
    )
    .join("");
  if (urls.length > maxShow)
    html += `<div class="cell-thumb-video" style="background:#64748b;font-size:0.72rem;">+${urls.length - maxShow}</div>`;
  return html;
}

function renderTable(claims) {
  const tbody = document.getElementById("qcTableBody");
  if (!tbody) return;
  if (!claims || claims.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-loading" style="color:#64748b;">ไม่พบรายการเคลมลูกค้าที่รับเรื่องแล้ว</td></tr>`;
    return;
  }

  // เก็บ map ของ claim ก่อนสร้าง row เพื่อให้ปุ่ม "ดู" อ้างถึงได้แน่นอน
  window._claims = {};
  claims.forEach((c) => {
    window._claims[c.id] = c;
  });

  tbody.innerHTML = "";
  claims.forEach((claim) => {
    const tr = document.createElement("tr");
    tr.onclick = () => openModal(claim);
    const mediaUrls = normalizeMediaUrls(claim.media_urls);
    const claimTypes = normalizeClaimTypes(claim.claim_types);
    const typesHtml = claimTypes.length
      ? claimTypes
          .map((t) => `<span class="type-tag">${escapeHtml(t)}</span>`)
          .join("")
      : '<span style="color:#cbd5e1;font-size:0.75rem;">—</span>';
    tr.innerHTML = `
      <td><div class="cell-date">${formatDate(claim.claim_date)}</div><div class="cell-sub">${formatDateTime(claim.created_at)}</div></td>
      <td><div style="font-weight:500;">${escapeHtml(claim.emp_name) || "—"}</div><div class="cell-sub">${escapeHtml(claim.area) || "—"}</div></td>
      <td>${escapeHtml(claim.customer) || "—"}</td>
      <td class="cell-product">
        <div>${escapeHtml(claim.product) || "—"}</div>
        <div class="cell-sub">
          จำนวน: ${escapeHtml(claim.qty) || "—"}
          ${claim.detail ? ` · ${escapeHtml(claim.detail)}` : ""}
        </div>
      </td>
      <td><div class="cell-types">${typesHtml}</div></td>
      <td>${mediaUrls.length === 0 ? '<span class="cell-no-media">ไม่มีไฟล์</span>' : `<div class="cell-thumbs">${buildThumbsHtml(mediaUrls, 3)}</div>`}</td>
      <td>${buildStatusBadge(claim)}</td>
      <td><div class="cell-action-group"><button class="btn-view" type="button" onclick="event.stopPropagation(); openModal(window._claims['${claim.id}'])"><span class="material-symbols-outlined" style="font-size:1rem;">open_in_new</span>ดู</button></div></td>
    `;
    tbody.appendChild(tr);
  });
}

// ---------- Modal ----------
function openModal(claim) {
  if (!claim) return;
  currentClaim = claim;
  const modal = document.getElementById("qcModal");
  if (!modal) return;
  modal.classList.add("open");

  const modalTitle = document.getElementById("modalTitle");
  if (modalTitle) modalTitle.textContent = `เคลมลูกค้า #${getClaimNo(claim)}`;

  const modalInfoGrid = document.getElementById("modalInfoGrid");
  if (modalInfoGrid) {
    modalInfoGrid.innerHTML = `
      <div class="info-row"><div class="info-label">ผู้แจ้ง / พนักงาน</div><div class="info-value">${escapeHtml(claim.emp_name) || "—"}</div></div>
      <div class="info-row"><div class="info-label">แผนก / เขต</div><div class="info-value">${escapeHtml(claim.area) || "—"}</div></div>
      <div class="info-row"><div class="info-label">ร้านค้า / ลูกค้า</div><div class="info-value">${escapeHtml(claim.customer) || "—"}</div></div>
      <div class="info-row"><div class="info-label">วันที่แจ้งเคลม</div><div class="info-value">${formatDate(claim.claim_date)}</div></div>
      <div class="info-row full"><div class="info-label">สินค้า</div><div class="info-value">${escapeHtml(claim.product) || "—"}</div></div>
      <div class="info-row"><div class="info-label">จำนวน</div><div class="info-value">${escapeHtml(claim.qty) || "—"}</div></div>
      <div class="info-row"><div class="info-label">วันที่รับเรื่อง</div><div class="info-value">${formatDateTime(claim.picked_at)}</div></div>
      <div class="info-row"><div class="info-label">สถานะ QC</div><div class="info-value">${buildStatusBadge(claim)}</div></div>
      ${claim.qc_comment ? `<div class="info-row full"><div class="info-label">หมายเหตุ QC</div><div class="info-value">${escapeHtml(claim.qc_comment)}</div></div>` : ""}
    `;
  }

  // แต่ง modal ด้วย class เสริม
  modal.classList.add("qc-polish-modal");

  const qcBox = document.querySelector(".qc-result-box");
  if (qcBox) qcBox.classList.add("qc-result-box--polished");

  document.querySelectorAll(".qc-check-row").forEach((row) => {
    row.classList.add("qc-check-row--polished");
  });

  document.querySelectorAll(".qty-stepper").forEach((stepper) => {
    stepper.classList.add("qty-stepper--polished");
  });

  document.querySelectorAll(".btn-save-draft").forEach((btn) => {
    btn.classList.add("btn-save-draft--polished");
  });

  document.querySelectorAll(".btn-send-ceo").forEach((btn) => {
    btn.classList.add("btn-send-ceo--polished");
  });

  const typesEl = document.getElementById("modalClaimTypes");
  if (typesEl) {
    const claimTypes = normalizeClaimTypes(claim.claim_types);
    typesEl.innerHTML = claimTypes.length
      ? claimTypes
          .map((t) => `<span class="modal-type-tag">${escapeHtml(t)}</span>`)
          .join("")
      : '<span style="color:#94a3b8;">ไม่ระบุ</span>';
  }

  const detailEl = document.getElementById("modalDetail");
  if (detailEl) detailEl.textContent = claim.detail || "—";

  const commentEl = document.getElementById("qcComment");
  if (commentEl) commentEl.value = claim.qc_comment || "";

  // เติมค่า qc_result
  const qcResult = claim.qc_result || {};
  const goodEl = document.getElementById("qcGoodQty");
  const repairEl = document.getElementById("qcRepairQty");
  const scrapEl = document.getElementById("qcScrapQty");
  if (goodEl) goodEl.value = qcResult.good_qty ?? 0;
  if (repairEl) repairEl.value = qcResult.repair_qty ?? 0;
  if (scrapEl) scrapEl.value = qcResult.scrap_qty ?? 0;

  syncQtyCheckbox("qcGoodQty", "qcGoodCheck");
  syncQtyCheckbox("qcRepairQty", "qcRepairCheck");
  syncQtyCheckbox("qcScrapQty", "qcScrapCheck");
  updateQcTotal();

  const statusEl = document.getElementById("qcStatusCurrent");
  if (statusEl) statusEl.innerHTML = `สถานะปัจจุบัน: ${buildStatusBadge(claim)}`;

  renderModalMedia(normalizeMediaUrls(claim.media_urls));

  const isDecided = ["approved", "rejected"].includes(normalizeStatus(claim));
  document.querySelectorAll(".qc-action-btns button").forEach((btn) => {
    btn.disabled = isDecided;
  });
}

function closeModal() {
  const modal = document.getElementById("qcModal");
  if (modal) modal.classList.remove("open");
  currentClaim = null;
}

// Modal media renderer
function renderModalMedia(urls) {
  const grid = document.getElementById("modalMediaGrid");
  if (!grid) return;
  if (!urls || urls.length === 0) {
    grid.innerHTML = '<div class="media-no-file">ไม่มีรูปภาพหรือวิดีโอที่แนบ</div>';
    return;
  }
  grid.innerHTML = "";
  urls.forEach((url) => {
    const item = document.createElement("div");
    item.className = "media-item";
    if (isVideo(url)) {
      item.innerHTML = `<div class="media-video-wrap"><video src="${escapeHtml(url)}" preload="metadata"></video><div class="media-play-icon">▶</div></div>`;
      item.onclick = () => window.open(url, "_blank");
    } else {
      item.innerHTML = `<img src="${escapeHtml(url)}" alt="">`;
      item.onclick = () => openLightbox(url);
    }
    grid.appendChild(item);
  });
}

// ---------- QC Actions (Approve / Reject / Draft / Send to CEO) ----------
async function updateClaimStatus(newStatus) {
  if (!currentClaim) return;

  const { comment, qcResult } = getQcFormData();
  const label = newStatus === "approved" ? "อนุมัติ" : "ปฏิเสธ";
  if (!confirm(`ยืนยันการ${label}เคลมนี้?`)) return;

  try {
    const userId = await getCurrentUserId();
    const { error } = await supabaseClient
      .from("claims")
      .update({
        qc_status: newStatus,
        qc_comment: comment || null,
        qc_result: qcResult,
        qc_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", currentClaim.id);
    if (error) throw error;

    showToast(`${label}เคลมสำเร็จ`, "success");
    closeModal();
    await loadClaims();
  } catch (err) {
    console.error("❌ updateClaimStatus error:", err);
    showToast("บันทึกผลไม่สำเร็จ: " + (err?.message ?? err), "danger");
  }
}

async function saveQcDraft() {
  if (!currentClaim) return;

  const { comment, qcResult } = getQcFormData();

  try {
    const userId = await getCurrentUserId();
    const { error } = await supabaseClient
      .from("claims")
      .update({
        qc_status: "draft",
        qc_result: qcResult,
        qc_comment: comment || null,
        qc_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", currentClaim.id);
    if (error) throw error;

    showToast("บันทึกร่างสำเร็จ", "success");
    await loadClaims();
  } catch (err) {
    console.error("❌ saveQcDraft error:", err);
    showToast("บันทึกร่างไม่สำเร็จ: " + (err?.message ?? err), "danger");
  }
}

async function sendToCEO() {
  if (!currentClaim) return;

  const { comment, qcResult } = getQcFormData();
  if (!confirm("ยืนยันส่งเคลมนี้ให้ CEO อนุมัติ?")) return;

  try {
    const userId = await getCurrentUserId();
    const { error } = await supabaseClient
      .from("claims")
      .update({
        qc_status: "waiting_ceo",
        exec_status: "pending",
        qc_result: qcResult,
        qc_comment: comment || null,
        qc_by: userId,
        sent_to_ceo_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", currentClaim.id);
    if (error) throw error;

    showToast("ส่งให้ CEO อนุมัติแล้ว", "success");
    closeModal();
    await loadClaims();
  } catch (err) {
    console.error("❌ sendToCEO error:", err);
    showToast("ส่งอนุมัติไม่สำเร็จ: " + (err?.message ?? err), "danger");
  }
}

// ============================================================
// Patch สำหรับ external-claims.js
// แทนที่ฟังก์ชัน stepQty และ syncQtyCheckbox ของเดิม
// แล้วเพิ่ม updateQcTotal เข้าไป
// ============================================================

// ---------- Sync checkbox ตามค่า qty ----------
function syncQtyCheckbox(qtyId, checkId) {
  const qtyEl = document.getElementById(qtyId);
  const checkEl = document.getElementById(checkId);
  if (!qtyEl || !checkEl) return;
  checkEl.checked = Number(qtyEl.value || 0) > 0;
}

// ---------- อัปเดตยอดรวมในกล่อง summary ----------
function updateQcTotal() {
  const good = Number(document.getElementById("qcGoodQty")?.value || 0);
  const repair = Number(document.getElementById("qcRepairQty")?.value || 0);
  const scrap = Number(document.getElementById("qcScrapQty")?.value || 0);
  const totalEl = document.getElementById("qcTotalQty");
  if (totalEl) totalEl.textContent = good + repair + scrap;
}

// ---------- Step +/- ----------
function stepQty(inputId, step) {
  const input = document.getElementById(inputId);
  if (!input) return;

  const current = Number(input.value || 0);
  const next = Math.max(0, current + step);
  input.value = next;

  const checkboxMap = {
    qcGoodQty: "qcGoodCheck",
    qcRepairQty: "qcRepairCheck",
    qcScrapQty: "qcScrapCheck",
  };
  const checkId = checkboxMap[inputId];
  if (checkId) syncQtyCheckbox(inputId, checkId);

  updateQcTotal();
}

// ---------- ผูก event ให้ input number พิมพ์เองก็อัปเดต ----------
document.addEventListener("DOMContentLoaded", () => {
  ["qcGoodQty", "qcRepairQty", "qcScrapQty"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      const checkboxMap = {
        qcGoodQty: "qcGoodCheck",
        qcRepairQty: "qcRepairCheck",
        qcScrapQty: "qcScrapCheck",
      };
      syncQtyCheckbox(id, checkboxMap[id]);
      updateQcTotal();
    });
  });

  // ผูก checkbox: ติ๊กแล้ว qty ยังเป็น 0 -> เซ็ตเป็น 1, ติ๊กออก -> 0
  const checkMap = {
    qcGoodCheck: "qcGoodQty",
    qcRepairCheck: "qcRepairQty",
    qcScrapCheck: "qcScrapQty",
  };
  Object.entries(checkMap).forEach(([checkId, qtyId]) => {
    const checkEl = document.getElementById(checkId);
    const qtyEl = document.getElementById(qtyId);
    if (!checkEl || !qtyEl) return;
    checkEl.addEventListener("change", () => {
      if (checkEl.checked && Number(qtyEl.value || 0) === 0) {
        qtyEl.value = 1;
      } else if (!checkEl.checked) {
        qtyEl.value = 0;
      }
      updateQcTotal();
    });
  });
});

// ---------- Lightbox ----------
function openLightbox(url) {
  const lb = document.getElementById("lightbox");
  const img = document.getElementById("lightboxImg");
  if (!lb || !img) {
    window.open(url, "_blank");
    return;
  }
  img.src = url;
  lb.classList.add("open");
}

function closeLightbox() {
  const lb = document.getElementById("lightbox");
  const img = document.getElementById("lightboxImg");
  if (lb) lb.classList.remove("open");
  if (img) img.src = "";
}

// ---------- Export ----------
function exportExcelAll() {
  if (!filteredClaims || filteredClaims.length === 0) {
    showToast("ไม่มีข้อมูลสำหรับ Export", "warning");
    return;
  }
  const rows = [
    [
      "เลขเคลม",
      "วันที่แจ้ง",
      "ผู้แจ้ง",
      "เขต/แผนก",
      "ลูกค้า",
      "สินค้า",
      "จำนวน",
      "ประเภทปัญหา",
      "รายละเอียด",
      "สถานะ QC",
      "วันที่รับเรื่อง",
      "หมายเหตุ QC",
      "ของดี",
      "ซ่อม",
      "ทิ้ง",
    ],
  ];
  filteredClaims.forEach((c) => {
    const r = c.qc_result || {};
    rows.push([
      getClaimNo(c),
      formatDate(c.claim_date),
      c.emp_name || "",
      c.area || "",
      c.customer || "",
      c.product || "",
      c.qty || "",
      normalizeClaimTypes(c.claim_types).join(", "),
      c.detail || "",
      getStatusLabel(c),
      formatDateTime(c.picked_at),
      c.qc_comment || "",
      r.good_qty ?? "",
      r.repair_qty ?? "",
      r.scrap_qty ?? "",
    ]);
  });

  if (typeof XLSX !== "undefined") {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Claims");
    XLSX.writeFile(
      wb,
      `${CLAIM_SCOPE}_claims_${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
    showToast("ดาวน์โหลด Excel สำเร็จ", "success");
    return;
  }

  // Fallback CSV
  const csv =
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${CLAIM_SCOPE}_claims_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("ดาวน์โหลด CSV สำเร็จ", "success");
}

// Wrapper for backward compatibility
function exportExcel() {
  exportExcelAll();
}

function exportClaimCSV() {
  if (!currentClaim) {
    showToast("ยังไม่ได้เลือกเคลม", "warning");
    return;
  }
  const c = currentClaim;
  const r = c.qc_result || {};

  const header = [
    "เลขเคลม",
    "วันที่แจ้ง",
    "ผู้แจ้ง",
    "เขต/แผนก",
    "ลูกค้า",
    "สินค้า",
    "จำนวน",
    "ประเภทปัญหา",
    "รายละเอียด",
    "สถานะ QC",
    "วันที่รับเรื่อง",
    "หมายเหตุ QC",
    "ของดี",
    "ซ่อม",
    "ทิ้ง",
  ];

  const row = [
    getClaimNo(c),
    formatDate(c.claim_date),
    c.emp_name || "",
    c.area || "",
    c.customer || "",
    c.product || "",
    c.qty || "",
    normalizeClaimTypes(c.claim_types).join(", "),
    c.detail || "",
    getStatusLabel(c),
    formatDateTime(c.picked_at),
    c.qc_comment || "",
    r.good_qty ?? "",
    r.repair_qty ?? "",
    r.scrap_qty ?? "",
  ];

  const csv =
    "\uFEFF" +
    [header, row]
      .map((r) =>
        r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${CLAIM_SCOPE}_${getClaimNo(c)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("ดาวน์โหลด CSV รายการนี้สำเร็จ", "success");
}

// Backward-compatible wrappers for modal CSV button
function exportCSV() {
  exportClaimCSV();
}

// ---------- Toast ----------
function showToast(message, type = "success") {
  const old = document.getElementById("ea-toast");
  if (old) old.remove();
  const colorMap = {
    success: "#10b981",
    danger: "#ef4444",
    warning: "#f59e0b",
    info: "#3b82f6",
  };
  const toast = document.createElement("div");
  toast.id = "ea-toast";
  toast.style.cssText = `position:fixed;bottom:28px;right:28px;z-index:99999;background:${colorMap[type] || colorMap.success};color:#fff;padding:12px 18px;border-radius:12px;font-family:"Kanit",sans-serif;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,.18);`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ---------- Init ----------
document.addEventListener("DOMContentLoaded", async () => {
  try {
    console.log(`🚀 ${CLAIM_SCOPE}-claims init start`);
    const ready = await waitForSupabase();
    if (!ready) {
      alert("ไม่สามารถเชื่อมต่อ Supabase ได้");
      return;
    }
    setupLogout();
    if (typeof protectPage === "function")
      await protectPage(["admin", "adminQc", "adminqc"]);
    await loadCurrentUserInfo();
    await loadClaims();
    setupEventListeners();
    console.log(`✅ ${CLAIM_SCOPE}-claims init done`);
  } catch (err) {
    console.error(`❌ ${CLAIM_SCOPE} init error:`, err);
    showTableError("โหลดหน้าไม่สำเร็จ: " + (err?.message ?? err));
  }
});

console.log(`✅ ${CLAIM_SCOPE}-claims.js loaded`);