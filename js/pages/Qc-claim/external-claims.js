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

function isExecLocked(claim) {
  const qcStatus = normalizeStatus(claim);
  const execStatus = claim?.exec_status || "";
  return (
    ["exec_approved", "exec_rejected"].includes(qcStatus) ||
    ["approved", "rejected"].includes(execStatus)
  );
}

// เคลมที่ CEO พิจารณาเสร็จแล้ว (มีเอกสารอนุมัติให้ดู)
function hasApprovalDocument(claim) {
  return ["approved", "rejected"].includes(claim?.exec_status);
}

function normalizeMediaUrls(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch (_) {}

    return value
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
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

    return value
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

function getClaimNo(claim) {
  const raw =
    claim?.claim_no || claim?.claim_code || claim?.claim_id || claim?.id || "";

  return (
    String(raw || "")
      .substring(0, 8)
      .toUpperCase() || "—"
  );
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

  return `${String(d.getDate()).padStart(2, "0")}/${String(
    d.getMonth() + 1,
  ).padStart(2, "0")}/${d.getFullYear()}`;
}

function formatDateTime(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "—";

  return `${formatDate(dateStr)} ${String(d.getHours()).padStart(
    2,
    "0",
  )}:${String(d.getMinutes()).padStart(2, "0")}`;
}

async function waitForSupabase() {
  let attempts = 0;

  while (typeof supabaseClient === "undefined" && attempts < 50) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    attempts++;
  }

  return typeof supabaseClient !== "undefined";
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

// ---------- QC Form Helpers ----------
function getQcFormData() {
  const comment = document.getElementById("qcComment")?.value.trim() || "";

  return {
    comment,
    qcResult: {
      grade_a_qty: Number(document.getElementById("qcGradeAQty")?.value || 0),
      grade_b_qty: Number(document.getElementById("qcGradeBQty")?.value || 0),
      repair_qty: Number(document.getElementById("qcRepairQty")?.value || 0),
      spare_qty: Number(document.getElementById("qcSpareQty")?.value || 0),
      scrap_qty: Number(document.getElementById("qcScrapQty")?.value || 0),
      defect_reason: document.getElementById("qcDefectReason")?.value || "",
      responsibility: document.getElementById("qcResponsibility")?.value || "",
      comment,
    },
  };
}

function setInputValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? "";
}

function syncQtyCheckbox(qtyId, checkId) {
  const qtyEl = document.getElementById(qtyId);
  const checkEl = document.getElementById(checkId);
  if (!qtyEl || !checkEl) return;

  checkEl.checked = Number(qtyEl.value || 0) > 0;
}

function updateQcTotal() {
  const a = Number(document.getElementById("qcGradeAQty")?.value || 0);
  const b = Number(document.getElementById("qcGradeBQty")?.value || 0);
  const r = Number(document.getElementById("qcRepairQty")?.value || 0);
  const s = Number(document.getElementById("qcSpareQty")?.value || 0);
  const c = Number(document.getElementById("qcScrapQty")?.value || 0);

  const totalEl = document.getElementById("qcTotalQty");
  if (totalEl) totalEl.textContent = (a + b + r + s + c).toLocaleString();
}

function fillQcFormData(claim) {
  const res = claim?.qc_result || {};

  setInputValue("qcGradeAQty", res.grade_a_qty || 0);
  setInputValue("qcGradeBQty", res.grade_b_qty || 0);
  setInputValue("qcRepairQty", res.repair_qty || 0);
  setInputValue("qcSpareQty", res.spare_qty || 0);
  setInputValue("qcScrapQty", res.scrap_qty || 0);

  setInputValue("qcDefectReason", res.defect_reason || "");
  setInputValue("qcResponsibility", res.responsibility || "");

  const commentEl = document.getElementById("qcComment");
  if (commentEl) commentEl.value = claim?.qc_comment || res.comment || "";

  syncQtyCheckbox("qcGradeAQty", "qcGradeACheck");
  syncQtyCheckbox("qcGradeBQty", "qcGradeBCheck");
  syncQtyCheckbox("qcRepairQty", "qcRepairCheck");
  syncQtyCheckbox("qcSpareQty", "qcSpareCheck");
  syncQtyCheckbox("qcScrapQty", "qcScrapCheck");

  updateQcTotal();
}

function stepQty(inputId, step) {
  if (currentClaim && isExecLocked(currentClaim)) {
    showToast("CEO พิจารณาแล้ว แก้ไขไม่ได้", "warning");
    return;
  }

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

function setQcModalReadonly(isLocked) {
  const selector = [
    "#qcModal input",
    "#qcModal select",
    "#qcModal textarea",
    "#qcModal .qty-stepper button",
    "#qcModal .qc-action-btns button",
  ].join(", ");

  document.querySelectorAll(selector).forEach((el) => {
    el.disabled = isLocked;
  });

  const modal = document.getElementById("qcModal");
  if (modal) modal.classList.toggle("is-readonly", isLocked);
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

    if (avatarEl) {
      avatarEl.textContent = displayName.trim().charAt(0).toUpperCase() || "👤";
    }
  } catch (err) {
    console.warn("loadCurrentUserInfo failed:", err);
  }
}

// ---------- Loading / Errors ----------
function showTableLoading() {
  const tbody = document.getElementById("qcTableBody");
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="9" class="table-loading">
        <span class="material-symbols-outlined spin">progress_activity</span>
        กำลังโหลด...
      </td>
    </tr>
  `;
}

function showTableError(message) {
  const tbody = document.getElementById("qcTableBody");
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="9" class="table-loading" style="color:#dc2626;">
        ❌ ${escapeHtml(message)}
      </td>
    </tr>
  `;
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
    ["checking", "in_progress", "draft", "waiting_ceo"].includes(
      normalizeStatus(c),
    ),
  ).length;

  const approved = allClaims.filter((c) =>
    ["approved", "exec_approved"].includes(normalizeStatus(c)),
  ).length;

  const rejected = allClaims.filter((c) =>
    ["rejected", "exec_rejected"].includes(normalizeStatus(c)),
  ).length;

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
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
      closeLightbox();
    }
  });

  setupQcInputListeners();
}

function setupQcInputListeners() {
  const qtyMap = {
    qcGradeAQty: "qcGradeACheck",
    qcGradeBQty: "qcGradeBCheck",
    qcRepairQty: "qcRepairCheck",
    qcSpareQty: "qcSpareCheck",
    qcScrapQty: "qcScrapCheck",
  };

  Object.entries(qtyMap).forEach(([qtyId, checkId]) => {
    const qtyEl = document.getElementById(qtyId);

    if (qtyEl) {
      qtyEl.addEventListener("input", () => {
        syncQtyCheckbox(qtyId, checkId);
        updateQcTotal();
      });
    }

    const checkEl = document.getElementById(checkId);

    if (checkEl && qtyEl) {
      checkEl.addEventListener("change", () => {
        if (currentClaim && isExecLocked(currentClaim)) {
          checkEl.checked = Number(qtyEl.value || 0) > 0;
          showToast("CEO พิจารณาแล้ว แก้ไขไม่ได้", "warning");
          return;
        }

        if (checkEl.checked && Number(qtyEl.value || 0) === 0) {
          qtyEl.value = 1;
        } else if (!checkEl.checked) {
          qtyEl.value = 0;
        }

        updateQcTotal();
      });
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
    submitted: { label: "📩 ส่งแล้ว", cls: "submitted" },
    pending: { label: "📩 ส่งแล้ว", cls: "submitted" },
    checking: { label: "🔍 กำลังตรวจสอบ", cls: "in-progress" },
    in_progress: { label: "🔍 กำลังตรวจสอบ", cls: "in-progress" },
    draft: { label: "📝 บันทึกร่าง", cls: "draft" },
    waiting_ceo: { label: "⏳ รอ CEO", cls: "waiting-ceo" },
    approved: { label: "✅ QC อนุมัติ", cls: "approved" },
    rejected: { label: "❌ QC ปฏิเสธ", cls: "rejected" },
    exec_approved: { label: "✅ CEO อนุมัติแล้ว", cls: "approved" },
    exec_rejected: { label: "❌ CEO ปฏิเสธ", cls: "rejected" },
  };

  const s = map[normalized] || map.pending;

  return `<span class="status-badge ${s.cls}">${s.label}</span>`;
}

function getExecDecisionHtml(claim) {
  if (!claim?.exec_status || claim.exec_status === "pending") {
    return "⏳ รออนุมัติ";
  }

  if (claim.exec_status === "approved") {
    return "✅ CEO อนุมัติ";
  }

  if (claim.exec_status === "rejected") {
    return "❌ CEO ปฏิเสธ";
  }

  return escapeHtml(claim.exec_status);
}

function getStatusLabel(status) {
  const normalized = normalizeStatus(status);

  const map = {
    pending: "ส่งแล้ว",
    checking: "กำลังตรวจสอบ",
    in_progress: "กำลังตรวจสอบ",
    draft: "บันทึกร่าง",
    waiting_ceo: "รอ CEO อนุมัติ",
    approved: "QC อนุมัติ",
    rejected: "QC ปฏิเสธ",
    exec_approved: "CEO อนุมัติแล้ว",
    exec_rejected: "CEO ปฏิเสธ",
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
        : `<img class="cell-thumb" src="${escapeHtml(
            url,
          )}" onerror="this.style.display='none'" alt="">`,
    )
    .join("");

  if (urls.length > maxShow) {
    html += `<div class="cell-thumb-video" style="background:#64748b;font-size:0.72rem;">+${
      urls.length - maxShow
    }</div>`;
  }

  return html;
}

// ---------- เปิดเอกสารอนุมัติ (delegate ไปยัง shared module) ----------
function openApprovalDocFor(claimId) {
  const claim = (window._claims || {})[claimId];
  if (!claim) {
    showToast ? showToast("ไม่พบข้อมูลเคลม", "danger") : alert("ไม่พบข้อมูลเคลม");
    return;
  }

  if (!hasApprovalDocument(claim)) {
    showToast ? showToast("ยังไม่มีเอกสารอนุมัติ (CEO ยังไม่พิจารณา)", "warning") : alert("ยังไม่มีเอกสารอนุมัติ (CEO ยังไม่พิจารณา)");
    return;
  }

  if (typeof window.ApprovalDocument?.open !== "function") {
    showToast ? showToast("ไม่พบ approval-document.js — กรุณาเช็คการ load script", "danger") : alert("ไม่พบ approval-document.js — กรุณาเช็คการ load script");
    return;
  }

  window.ApprovalDocument.open(claim);
}

function buildApprovalDocCellHtml(claim) {
  if (!hasApprovalDocument(claim)) {
    return `<span class="cell-no-media">—</span>`;
  }

  const cid = escapeHtml(claim.id);

  return `
    <div class="doc-action-group" onclick="event.stopPropagation()">
      <button
        class="btn-doc-view"
        type="button"
        onclick="event.stopPropagation(); window.ApprovalDocument?.open && window.ApprovalDocument.open(window._claims['${cid}'])"
        title="ดูเอกสารอนุมัติ"
      >
        <span class="material-symbols-outlined" style="font-size:0.9rem;">description</span>
        ดู
      </button>

      <button
        class="btn-doc-download"
        type="button"
        onclick="event.stopPropagation(); window.ApprovalDocument?.download && window.ApprovalDocument.download(window._claims['${cid}'])"
        title="ดาวน์โหลด / Save PDF"
      >
        <span class="material-symbols-outlined" style="font-size:0.9rem;">download</span>
      </button>

      <button
        class="btn-doc-share"
        type="button"
        onclick="event.stopPropagation(); window.ApprovalDocument?.share && window.ApprovalDocument.share(window._claims['${cid}'])"
        title="แชร์เอกสาร"
      >
        <span class="material-symbols-outlined" style="font-size:0.9rem;">share</span>
      </button>
    </div>
  `;
}

function renderTable(claims) {
  const tbody = document.getElementById("qcTableBody");
  if (!tbody) return;

  if (!claims || claims.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="table-loading" style="color:#64748b;">
          ไม่พบรายการเคลมลูกค้าที่รับเรื่องแล้ว
        </td>
      </tr>
    `;
    return;
  }

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
      <td>
        <div class="cell-date">${formatDate(claim.claim_date)}</div>
        <div class="cell-sub">${formatDateTime(claim.created_at)}</div>
      </td>

      <td>
        <div style="font-weight:500;">${escapeHtml(claim.emp_name) || "—"}</div>
        <div class="cell-sub">${escapeHtml(claim.area) || "—"}</div>
      </td>

      <td>${escapeHtml(claim.customer) || "—"}</td>

      <td class="cell-product">
        <div>${escapeHtml(claim.product) || "—"}</div>
        <div class="cell-sub">
          จำนวน: ${escapeHtml(claim.qty) || "—"}
          ${claim.detail ? ` · ${escapeHtml(claim.detail)}` : ""}
        </div>
      </td>

      <td><div class="cell-types">${typesHtml}</div></td>

      <td>
        ${
          mediaUrls.length === 0
            ? '<span class="cell-no-media">ไม่มีไฟล์</span>'
            : `<div class="cell-thumbs">${buildThumbsHtml(mediaUrls, 3)}</div>`
        }
      </td>

      <td>${buildStatusBadge(claim)}</td>

      <td onclick="event.stopPropagation()">
        ${buildApprovalDocCellHtml(claim)}
      </td>

      <td>
        <div class="cell-action-group">
          <button
            class="btn-view"
            type="button"
            onclick="event.stopPropagation(); openModal(window._claims['${claim.id}'])"
          >
            <span class="material-symbols-outlined" style="font-size:1rem;">open_in_new</span>
            ดู
          </button>
        </div>
      </td>
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

  const locked = isExecLocked(claim);

  const modalTitle = document.getElementById("modalTitle");
  if (modalTitle) modalTitle.textContent = `เคลมลูกค้า #${getClaimNo(claim)}`;

  const modalInfoGrid = document.getElementById("modalInfoGrid");
  if (modalInfoGrid) {
    modalInfoGrid.innerHTML = `
      <div class="info-row">
        <div class="info-label">ผู้แจ้ง / พนักงาน</div>
        <div class="info-value">${escapeHtml(claim.emp_name) || "—"}</div>
      </div>

      <div class="info-row">
        <div class="info-label">แผนก / เขต</div>
        <div class="info-value">${escapeHtml(claim.area) || "—"}</div>
      </div>

      <div class="info-row">
        <div class="info-label">ร้านค้า / ลูกค้า</div>
        <div class="info-value">${escapeHtml(claim.customer) || "—"}</div>
      </div>

      <div class="info-row">
        <div class="info-label">วันที่แจ้งเคลม</div>
        <div class="info-value">${formatDate(claim.claim_date)}</div>
      </div>

      <div class="info-row full">
        <div class="info-label">สินค้า</div>
        <div class="info-value">${escapeHtml(claim.product) || "—"}</div>
      </div>

      <div class="info-row">
        <div class="info-label">จำนวน</div>
        <div class="info-value">${escapeHtml(claim.qty) || "—"}</div>
      </div>

      <div class="info-row">
        <div class="info-label">วันที่รับเรื่อง</div>
        <div class="info-value">${formatDateTime(claim.picked_at)}</div>
      </div>
    `;
  }

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

  fillQcFormData(claim);

  const statusEl = document.getElementById("qcStatusCurrent");
  if (statusEl) {
    statusEl.innerHTML = `${buildStatusBadge(claim)}`;

    if (locked) {
      statusEl.innerHTML += `
        <span class="status-badge approved" style="margin-left:8px;">
          🔒 CEO พิจารณาแล้ว ดูได้อย่างเดียว
        </span>
      `;
    }
  }

  renderModalMedia(normalizeMediaUrls(claim.media_urls));

  setQcModalReadonly(locked);
}

function closeModal() {
  const modal = document.getElementById("qcModal");
  if (modal) {
    modal.classList.remove("open");
    modal.classList.remove("is-readonly");
  }

  setQcModalReadonly(false);
  currentClaim = null;
}

// ---------- Modal media renderer ----------
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
      item.innerHTML = `
        <div class="media-video-wrap">
          <video src="${escapeHtml(url)}" preload="metadata"></video>
          <div class="media-play-icon">▶</div>
        </div>
      `;
      item.onclick = () => window.open(url, "_blank");
    } else {
      item.innerHTML = `<img src="${escapeHtml(url)}" alt="">`;
      item.onclick = () => openLightbox(url);
    }

    grid.appendChild(item);
  });
}

// ---------- QC Actions ----------
async function updateClaimStatus(newStatus) {
  if (!currentClaim) return;

  if (isExecLocked(currentClaim)) {
    showToast("CEO พิจารณาแล้ว แก้ไขไม่ได้", "warning");
    return;
  }

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

  if (isExecLocked(currentClaim)) {
    showToast("CEO พิจารณาแล้ว บันทึกร่างไม่ได้", "warning");
    return;
  }

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

  if (isExecLocked(currentClaim)) {
    showToast("CEO พิจารณาแล้ว ส่งซ้ำไม่ได้", "warning");
    return;
  }

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
function buildExportRows(claims) {
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
      "ผล CEO",
      "วันที่รับเรื่อง",
      "หมายเหตุ QC",
      "A",
      "B",
      "R",
      "S",
      "C",
      "สาเหตุ",
      "ผู้รับผิดชอบ",
    ],
  ];

  claims.forEach((c) => {
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
      c.exec_status || "",
      formatDateTime(c.picked_at),
      c.qc_comment || r.comment || "",
      r.grade_a_qty ?? "",
      r.grade_b_qty ?? "",
      r.repair_qty ?? "",
      r.spare_qty ?? "",
      r.scrap_qty ?? "",
      r.defect_reason ?? "",
      r.responsibility ?? "",
    ]);
  });

  return rows;
}

function exportExcelAll() {
  if (!filteredClaims || filteredClaims.length === 0) {
    showToast("ไม่มีข้อมูลสำหรับ Export", "warning");
    return;
  }

  const rows = buildExportRows(filteredClaims);

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

  exportRowsAsCsv(rows, `${CLAIM_SCOPE}_claims_${new Date().toISOString().slice(0, 10)}.csv`);
}

function exportRowsAsCsv(rows, filename) {
  const csv =
    "\uFEFF" +
    rows
      .map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = filename;

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
  showToast("ดาวน์โหลด CSV สำเร็จ", "success");
}

function exportExcel() {
  exportExcelAll();
}

function exportClaimCSV() {
  if (!currentClaim) {
    showToast("ยังไม่ได้เลือกเคลม", "warning");
    return;
  }

  const rows = buildExportRows([currentClaim]);
  exportRowsAsCsv(rows, `${CLAIM_SCOPE}_${getClaimNo(currentClaim)}.csv`);
}

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
  toast.style.cssText = `
    position:fixed;
    bottom:28px;
    right:28px;
    z-index:99999;
    background:${colorMap[type] || colorMap.success};
    color:#fff;
    padding:12px 18px;
    border-radius:12px;
    font-family:"Kanit",sans-serif;
    font-size:14px;
    box-shadow:0 8px 24px rgba(0,0,0,.18);
  `;
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

    if (typeof protectPage === "function") {
      await protectPage(["admin", "adminQc", "adminqc"]);
    }

    await loadCurrentUserInfo();
    await loadClaims();
    setupEventListeners();

    console.log(`✅ ${CLAIM_SCOPE}-claims init done`);
  } catch (err) {
    console.error(`❌ ${CLAIM_SCOPE} init error:`, err);
    showTableError("โหลดหน้าไม่สำเร็จ: " + (err?.message ?? err));
  }
});

// expose สำหรับเรียกใน onclick
window.openApprovalDocFor = openApprovalDocFor;

console.log(`✅ ${CLAIM_SCOPE}-claims.js loaded`);