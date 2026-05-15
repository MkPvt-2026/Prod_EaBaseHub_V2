// ============================================================
// external-claims.js  (v4 — FIXED confirm dialog + showSuccessPopup)
// หน้า QC ตรวจสอบเคลมลูกค้า (External Claims)
//
// ✅ Changelog v4:
//   1) FIX: แก้ HTML structure ของ showConfirmDialog (เพิ่ม .ea-confirm-actions wrapper)
//   2) NEW: เพิ่ม showSuccessPopup() — modal กลางจอ พร้อม animation
//   3) FIX: signature pad cleanup event listeners ให้ถูก
//   4) IMPROVE: error handling + null checks
// ============================================================

const CLAIM_SCOPE = "external";

let allClaims = [];
let filteredClaims = [];
let currentClaim = null;

// ============================================================
// Map: qty input id → checkbox id
// ============================================================
const QTY_CHECKBOX_MAP = {
  qcGradeAQty: "qcGradeA",
  qcGradeBQty: "qcGradeB",
  qcGradeRQty: "qcGradeR",
  qcGradeCQty: "qcGradeC",
};

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
    if (claimOrStatus.qc_status) return claimOrStatus.qc_status;
    if (claimOrStatus.picked_at) return "checking";
    return claimOrStatus.status || "pending";
  }

  if (claimOrStatus === "submitted") return "pending";
  if (claimOrStatus === "in_progress") return "checking";

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

// ============================================================
// QC Form: Read / Write / Sync
// ============================================================
function getQcFormData() {
  const comment = document.getElementById("qcComment")?.value.trim() || "";

  const gradeA = Number(document.getElementById("qcGradeAQty")?.value || 0);
  const gradeB = Number(document.getElementById("qcGradeBQty")?.value || 0);
  const gradeR = Number(document.getElementById("qcGradeRQty")?.value || 0);
  const gradeC = Number(document.getElementById("qcGradeCQty")?.value || 0);

  const productSource =
    document.getElementById("qcProductSource")?.value || "in_house";
  const rootCause =
    document.getElementById("qcClaimRootCause")?.value || "logistics";

  const mainCause = document.getElementById("mainCause")?.value.trim() || "";
  const responsiblePerson =
    document.getElementById("responsiblePerson")?.value.trim() || "";

  const signature = getQcSignatureDataUrl();

  return {
    comment,
    signature,
    qcResult: {
      product_source: productSource,
      claim_root_cause: rootCause,

      grade_a_qty: gradeA,
      grade_b_qty: gradeB,
      grade_r_qty: gradeR,
      grade_c_qty: gradeC,
      total_qty: gradeA + gradeB + gradeR + gradeC,

      main_cause: mainCause,
      responsible_person: responsiblePerson,

      // legacy field name (เพื่อเข้ากับ approval-document.js เดิม)
      defect_reason: mainCause,
      responsibility: responsiblePerson,

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
  const r = Number(document.getElementById("qcGradeRQty")?.value || 0);
  const c = Number(document.getElementById("qcGradeCQty")?.value || 0);

  const totalEl = document.getElementById("qcTotalQty");
  if (totalEl) totalEl.textContent = (a + b + r + c).toLocaleString();
}

// Trading = ซื้อมาขายไป → ห้าม Grade R
function applyProductSourceConstraint() {
  const sourceEl = document.getElementById("qcProductSource");
  const recycleRow = document.getElementById("recycleRow");
  const gradeRCheck = document.getElementById("qcGradeR");
  const gradeRQty = document.getElementById("qcGradeRQty");
  if (!sourceEl) return;

  const isTrading = sourceEl.value === "trading";

  if (recycleRow) {
    recycleRow.style.opacity = isTrading ? "0.45" : "1";
    recycleRow.style.pointerEvents = isTrading ? "none" : "auto";
    recycleRow.title = isTrading ? "สินค้าซื้อมาขายไป — รีไซเคิลไม่ได้" : "";
  }

  if (isTrading) {
    if (gradeRQty) gradeRQty.value = 0;
    if (gradeRCheck) gradeRCheck.checked = false;
    updateQcTotal();
  }
}

function fillQcFormData(claim) {
  const res = claim?.qc_result || {};

  setInputValue("qcProductSource", res.product_source || "in_house");
  setInputValue("qcClaimRootCause", res.claim_root_cause || "logistics");

  setInputValue("qcGradeAQty", res.grade_a_qty ?? 0);
  setInputValue("qcGradeBQty", res.grade_b_qty ?? 0);
  setInputValue("qcGradeRQty", res.grade_r_qty ?? res.repair_qty ?? 0);
  setInputValue("qcGradeCQty", res.grade_c_qty ?? res.scrap_qty ?? 0);

  setInputValue("mainCause", res.main_cause ?? res.defect_reason ?? "");
  setInputValue(
    "responsiblePerson",
    res.responsible_person ?? res.responsibility ?? "",
  );

  const commentEl = document.getElementById("qcComment");
  if (commentEl) commentEl.value = claim?.qc_comment || res.comment || "";

  Object.entries(QTY_CHECKBOX_MAP).forEach(([qtyId, checkId]) => {
    syncQtyCheckbox(qtyId, checkId);
  });

  updateQcTotal();
  applyProductSourceConstraint();

  loadQcSignatureFromUrl(claim?.qc_signature || null);
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

  const checkId = QTY_CHECKBOX_MAP[inputId];
  if (checkId) syncQtyCheckbox(inputId, checkId);
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

// ============================================================
// QC Signature Pad (canvas — base64 export)
// ✅ v4: cleanup listeners ถูกต้อง
// ============================================================
const qcSignature = {
  canvas: null,
  ctx: null,
  drawing: false,
  hasInk: false,
  lastPoint: null,
  // เก็บ handler reference ไว้ remove ได้
  handlers: {
    start: null,
    move: null,
    end: null,
  },
};

function teardownQcSignaturePad() {
  // ลบ window-level listener (mouseup) ของ instance เก่าออก
  if (qcSignature.handlers.end) {
    window.removeEventListener("mouseup", qcSignature.handlers.end);
  }
  qcSignature.handlers = { start: null, move: null, end: null };
}

function initQcSignaturePad() {
  // cleanup ก่อนเสมอ ป้องกัน listener ซ้ำ
  teardownQcSignaturePad();

  const oldCanvas = document.getElementById("qcSignatureCanvas");
  if (!oldCanvas) return;

  // clone เพื่อล้าง canvas-level listeners เก่า
  const canvas = oldCanvas.cloneNode(true);
  oldCanvas.replaceWith(canvas);

  qcSignature.canvas = canvas;
  qcSignature.ctx = canvas.getContext("2d");
  qcSignature.hasInk = false;
  qcSignature.lastPoint = null;

  resizeQcSignatureCanvas();
  updateQcSignatureUi();

  const start = (e) => {
    if (currentClaim && isExecLocked(currentClaim)) return;
    e.preventDefault();
    qcSignature.drawing = true;
    qcSignature.lastPoint = getPointerPos(e);
  };

  const move = (e) => {
    if (!qcSignature.drawing) return;
    e.preventDefault();
    const pt = getPointerPos(e);
    drawLine(qcSignature.lastPoint, pt);
    qcSignature.lastPoint = pt;
    qcSignature.hasInk = true;
    updateQcSignatureUi();
  };

  const end = () => {
    qcSignature.drawing = false;
    qcSignature.lastPoint = null;
  };

  qcSignature.handlers.start = start;
  qcSignature.handlers.move = move;
  qcSignature.handlers.end = end;

  // Mouse
  canvas.addEventListener("mousedown", start);
  canvas.addEventListener("mousemove", move);
  window.addEventListener("mouseup", end);

  // Touch
  canvas.addEventListener("touchstart", start, { passive: false });
  canvas.addEventListener("touchmove", move, { passive: false });
  canvas.addEventListener("touchend", end);
  canvas.addEventListener("touchcancel", end);
}

function getPointerPos(e) {
  const canvas = qcSignature.canvas;
  if (!canvas) return { x: 0, y: 0 };
  const rect = canvas.getBoundingClientRect();
  const point = e.touches ? e.touches[0] : e;
  return {
    x: point.clientX - rect.left,
    y: point.clientY - rect.top,
  };
}

function drawLine(from, to) {
  const ctx = qcSignature.ctx;
  if (!ctx || !from || !to) return;
  ctx.strokeStyle = "#1e3a8a";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function resizeQcSignatureCanvas() {
  const canvas = qcSignature.canvas;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  let prev = null;
  if (qcSignature.hasInk) prev = canvas.toDataURL("image/png");

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = rect.width + "px";
  canvas.style.height = rect.height + "px";

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  qcSignature.ctx = ctx;

  if (prev) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
    img.src = prev;
  }
}

function updateQcSignatureUi() {
  const wrap = qcSignature.canvas?.parentElement;
  if (!wrap) return;
  wrap.classList.toggle("has-signature", qcSignature.hasInk);

  const clearBtn = document.querySelector(".qc-sig-btn-clear");
  if (clearBtn) clearBtn.disabled = !qcSignature.hasInk;
}

function clearQcSignature() {
  if (currentClaim && isExecLocked(currentClaim)) return;
  const canvas = qcSignature.canvas;
  const ctx = qcSignature.ctx;
  if (!canvas || !ctx) return;

  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  qcSignature.hasInk = false;
  updateQcSignatureUi();
}

function getQcSignatureDataUrl() {
  if (!qcSignature.hasInk || !qcSignature.canvas) return null;
  return qcSignature.canvas.toDataURL("image/png");
}

function loadQcSignatureFromUrl(dataUrl) {
  const canvas = qcSignature.canvas;
  const ctx = qcSignature.ctx;
  if (!canvas || !ctx) return;

  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  qcSignature.hasInk = false;

  if (!dataUrl) {
    updateQcSignatureUi();
    return;
  }

  const img = new Image();
  img.onload = () => {
    const rect = canvas.getBoundingClientRect();
    ctx.drawImage(img, 0, 0, rect.width, rect.height);
    qcSignature.hasInk = true;
    updateQcSignatureUi();
  };
  img.src = dataUrl;
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
  const sumWaiting = document.getElementById("sumWaiting");
  const sumApproved = document.getElementById("sumApproved");
  const sumRejected = document.getElementById("sumRejected");

  const pending = allClaims.filter(
    (c) => normalizeStatus(c) === "pending",
  ).length;
  const inProgress = allClaims.filter((c) =>
    ["checking", "in_progress", "draft"].includes(normalizeStatus(c)),
  ).length;
  const waiting = allClaims.filter(
    (c) => normalizeStatus(c) === "waiting_ceo",
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
  if (sumWaiting) sumWaiting.textContent = waiting;
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
  Object.entries(QTY_CHECKBOX_MAP).forEach(([qtyId, checkId]) => {
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

  const sourceEl = document.getElementById("qcProductSource");
  if (sourceEl) {
    sourceEl.addEventListener("change", () => {
      if (currentClaim && isExecLocked(currentClaim)) return;
      applyProductSourceConstraint();
    });
  }
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
    if (status && normalizeStatus(claim) !== normalizeStatus(status))
      return false;
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
    submitted: { label: "⏳ รอรับเรื่อง", cls: "submitted" },
    pending: { label: "⏳ รอรับเรื่อง", cls: "submitted" },

    checking: { label: "🔍 กำลังตรวจสอบ", cls: "in-progress" },
    in_progress: { label: "🔍 กำลังตรวจสอบ", cls: "in-progress" },

    draft: { label: "📝 บันทึกร่าง", cls: "draft" },

    waiting_ceo: { label: "⏳ รออนุมัติ CEO", cls: "waiting-ceo" },

    approved: { label: "✅ QC อนุมัติ", cls: "approved" },
    rejected: { label: "❌ QC ปฏิเสธ", cls: "rejected" },

    exec_approved: { label: "✅ CEO อนุมัติแล้ว", cls: "approved" },
    exec_rejected: { label: "❌ CEO ปฏิเสธ", cls: "rejected" },
  };

  const s = map[normalized] || map.pending;
  return `<span class="status-badge ${s.cls}">${s.label}</span>`;
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
        : `<img class="cell-thumb" src="${escapeHtml(url)}" onerror="this.style.display='none'" alt="">`,
    )
    .join("");

  if (urls.length > maxShow) {
    html += `<div class="cell-thumb-video" style="background:#64748b;font-size:0.72rem;">+${urls.length - maxShow}</div>`;
  }
  return html;
}

// ---------- Approval document ----------
function openApprovalDocFor(claimId) {
  const claim = (window._claims || {})[claimId];
  if (!claim) {
    showToast("ไม่พบข้อมูลเคลม", "danger");
    return;
  }
  if (!hasApprovalDocument(claim)) {
    showToast("ยังไม่มีเอกสารอนุมัติ (CEO ยังไม่พิจารณา)", "warning");
    return;
  }
  if (typeof window.ApprovalDocument?.open !== "function") {
    showToast(
      "ไม่พบ approval-document.js — กรุณาเช็คการ load script",
      "danger",
    );
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
      <button class="btn-doc-view" type="button"
        onclick="event.stopPropagation(); window.ApprovalDocument?.open && window.ApprovalDocument.open(window._claims['${cid}'])"
        title="ดูเอกสารอนุมัติ">
        <span class="material-symbols-outlined" style="font-size:0.9rem;">description</span>
        ดู
      </button>
      <button class="btn-doc-download" type="button"
        onclick="event.stopPropagation(); window.ApprovalDocument?.download && window.ApprovalDocument.download(window._claims['${cid}'])"
        title="ดาวน์โหลด / Save PDF">
        <span class="material-symbols-outlined" style="font-size:0.9rem;">download</span>
      </button>
      <button class="btn-doc-share" type="button"
        onclick="event.stopPropagation(); window.ApprovalDocument?.share && window.ApprovalDocument.share(window._claims['${cid}'])"
        title="แชร์เอกสาร">
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
          <button class="btn-view" type="button"
            onclick="event.stopPropagation(); openModal(window._claims['${claim.id}'])">
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

  // init signature pad ก่อน fill data (รอ modal animation)
  setTimeout(() => {
    initQcSignaturePad();
    fillQcFormData(claim);
  }, 60);

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
  teardownQcSignaturePad(); // ✅ cleanup เมื่อปิด modal
  currentClaim = null;
}

function renderModalMedia(urls) {
  const grid = document.getElementById("modalMediaGrid");
  if (!grid) return;

  if (!urls || urls.length === 0) {
    grid.innerHTML =
      '<div class="media-no-file">ไม่มีรูปภาพหรือวิดีโอที่แนบ</div>';
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
function validateQcFormBeforeSend() {
  const { qcResult } = getQcFormData();
  const total = qcResult.total_qty;

  if (total <= 0) {
    showToast(
      "กรุณาระบุจำนวนสินค้าอย่างน้อย 1 ชิ้นใน Grade ใดก็ได้",
      "warning",
    );
    return false;
  }

  if (qcResult.product_source === "trading" && qcResult.grade_r_qty > 0) {
    showToast(
      "สินค้าซื้อมาขายไป (trading) ไม่สามารถส่งบด/หลอม (Grade R) ได้",
      "warning",
    );
    return false;
  }

  return true;
}

async function saveQcDraft() {
  if (!currentClaim) return;
  if (isExecLocked(currentClaim)) {
    showToast("CEO พิจารณาแล้ว บันทึกร่างไม่ได้", "warning");
    return;
  }

  const { comment, signature, qcResult } = getQcFormData();

  try {
    const userId = await getCurrentUserId();

    const { error } = await supabaseClient
      .from("claims")
      .update({
        qc_status: "draft",
        qc_result: qcResult,
        qc_comment: comment || null,
        qc_signature: signature,
        qc_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", currentClaim.id);

    if (error) throw error;

    currentClaim.qc_status = "draft";
    currentClaim.qc_result = qcResult;
    currentClaim.qc_comment = comment || null;
    currentClaim.qc_signature = signature;
    if (window._claims && window._claims[currentClaim.id]) {
      window._claims[currentClaim.id] = currentClaim;
    }

    await showSuccessPopup({
      title: "บันทึกร่างสำเร็จ",
      message:
        "ระบบได้บันทึกข้อมูล QC เรียบร้อยแล้ว\nคุณสามารถกลับมาแก้ไขต่อภายหลังได้",
      buttonText: "ตกลง",
    });

    await loadClaims();
  } catch (err) {
    console.error("❌ saveQcDraft error:", err);
    showToast("บันทึกร่างไม่สำเร็จ: " + (err?.message ?? err), "danger");
  }
}

// ============================================================
// ✅ NEW v4: Success Popup — modal กลางจอ พร้อม animation
// ============================================================
function showSuccessPopup({
  title = "สำเร็จ",
  message = "ดำเนินการเรียบร้อยแล้ว",
  buttonText = "ตกลง",
  icon = "check_circle",
  autoCloseMs = 0, // 0 = ไม่ auto close
} = {}) {
  return new Promise((resolve) => {
    document.getElementById("ea-success-popup")?.remove();

    const wrap = document.createElement("div");
    wrap.id = "ea-success-popup";
    wrap.className = "ea-success-overlay";

    wrap.innerHTML = `
      <div class="ea-success-box" role="dialog" aria-modal="true" aria-labelledby="eaSuccessTitle">
        <div class="ea-success-icon-wrap">
          <svg class="ea-success-checkmark" viewBox="0 0 52 52">
            <circle class="ea-success-circle" cx="26" cy="26" r="24" fill="none"/>
            <path class="ea-success-check" fill="none" d="M14 27 L22 35 L38 18"/>
          </svg>
        </div>

        <div class="ea-success-body">
          <h3 id="eaSuccessTitle" class="ea-success-title">${escapeHtml(title)}</h3>
          <p class="ea-success-message">${escapeHtml(message).replace(/\n/g, "<br>")}</p>
        </div>

        <div class="ea-success-actions">
          <button type="button" class="ea-success-btn-ok">
            <span class="material-symbols-outlined">${escapeHtml(icon)}</span>
            ${escapeHtml(buttonText)}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(wrap);

    const okBtn = wrap.querySelector(".ea-success-btn-ok");
    let autoTimer = null;

    function cleanup() {
      wrap.classList.add("closing");
      document.removeEventListener("keydown", onKey);
      if (autoTimer) clearTimeout(autoTimer);
      setTimeout(() => {
        wrap.remove();
        resolve(true);
      }, 220);
    }

    function onKey(e) {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        cleanup();
      }
    }

    okBtn.addEventListener("click", cleanup);
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) cleanup();
    });
    document.addEventListener("keydown", onKey);

    if (autoCloseMs > 0) {
      autoTimer = setTimeout(cleanup, autoCloseMs);
    }

    requestAnimationFrame(() => {
      wrap.classList.add("open");
      if (okBtn) okBtn.focus();
    });
  });
}

// ============================================================
// ✅ FIXED v4: Confirm Dialog — แก้ HTML structure ที่พัง
// ============================================================
function showConfirmDialog({
  title = "ยืนยันการดำเนินการ",
  message = "ต้องการดำเนินการต่อหรือไม่?",
  noteLabel = "หมายเหตุ / ความเห็นเพิ่มเติม",
  notePlaceholder = "พิมพ์ข้อความ... (ไม่บังคับ)",
  initialNote = "",
  confirmText = "ยืนยัน",
  cancelText = "ยกเลิก",
  icon = "forward_to_inbox",
  variant = "primary", // "primary" | "danger" | "warning"
  showNote = true,
} = {}) {
  return new Promise((resolve) => {
    document.getElementById("ea-confirm-dialog")?.remove();

    const wrap = document.createElement("div");
    wrap.id = "ea-confirm-dialog";
    wrap.className = "ea-confirm-overlay";

    // ✅ FIX: รวม HTML structure ใหม่ทั้งหมดให้ถูกต้อง
    const cancelBtnHtml = cancelText
      ? `<button type="button" class="ea-confirm-btn-cancel">
           <span class="material-symbols-outlined">close</span>
           ${escapeHtml(cancelText)}
         </button>`
      : "";

    const noteHtml = showNote
      ? `<div class="ea-confirm-body">
           <label for="eaConfirmNote" class="ea-confirm-label">${escapeHtml(noteLabel)}</label>
           <textarea
             id="eaConfirmNote"
             class="ea-confirm-textarea"
             placeholder="${escapeHtml(notePlaceholder)}"
             rows="3"
           >${escapeHtml(initialNote)}</textarea>
           <div class="ea-confirm-hint">
             <span class="material-symbols-outlined">keyboard</span>
             กด <kbd>Ctrl</kbd> + <kbd>Enter</kbd> เพื่อยืนยัน  ·  <kbd>Esc</kbd> เพื่อยกเลิก
           </div>
         </div>`
      : "";

    wrap.innerHTML = `
      <div class="ea-confirm-box ea-confirm-${escapeHtml(variant)}" role="dialog" aria-modal="true" aria-labelledby="eaConfirmTitle">
        <div class="ea-confirm-header">
          <div class="ea-confirm-icon">
            <span class="material-symbols-outlined">${escapeHtml(icon)}</span>
          </div>
          <div class="ea-confirm-title-wrap">
            <h3 id="eaConfirmTitle" class="ea-confirm-title">${escapeHtml(title)}</h3>
            <p class="ea-confirm-message">${escapeHtml(message).replace(/\n/g, "<br>")}</p>
          </div>
          <button type="button" class="ea-confirm-close" aria-label="ปิด">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        ${noteHtml}

        <div class="ea-confirm-actions">
          ${cancelBtnHtml}
          <button type="button" class="ea-confirm-btn-ok">
            <span class="material-symbols-outlined">${escapeHtml(icon)}</span>
            ${escapeHtml(confirmText)}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(wrap);

    const noteEl = wrap.querySelector("#eaConfirmNote");
    const okBtn = wrap.querySelector(".ea-confirm-btn-ok");
    const cancelBtn = wrap.querySelector(".ea-confirm-btn-cancel");
    const closeBtn = wrap.querySelector(".ea-confirm-close");

    function cleanup(result) {
      wrap.classList.add("closing");
      document.removeEventListener("keydown", onKey);
      setTimeout(() => {
        wrap.remove();
        resolve(result);
      }, 180);
    }

    function onConfirm() {
      cleanup({ confirmed: true, note: (noteEl?.value || "").trim() });
    }

    function onCancel() {
      cleanup({ confirmed: false, note: "" });
    }

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onConfirm();
      }
    }

    okBtn.addEventListener("click", onConfirm);
    if (cancelBtn) cancelBtn.addEventListener("click", onCancel);
    closeBtn.addEventListener("click", onCancel);
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) onCancel();
    });
    document.addEventListener("keydown", onKey);

    requestAnimationFrame(() => {
      wrap.classList.add("open");
      if (noteEl) noteEl.focus();
      else if (okBtn) okBtn.focus();
    });
  });
}
// -----------SEND TO CEO------

async function sendToCEO() {
  if (!currentClaim) return;

  if (isExecLocked(currentClaim)) {
    showToast("CEO พิจารณาแล้ว ส่งซ้ำไม่ได้", "warning");
    return;
  }

  if (!validateQcFormBeforeSend()) return;

  const { comment, signature, qcResult } = getQcFormData();

  if (!signature) {
    showToast("กรุณาเซ็นชื่อก่อนส่งให้ CEO", "warning");
    return;
  }

  try {
    const userId = await getCurrentUserId();
    const now = new Date().toISOString();

    const { error: claimError } = await supabaseClient
      .from("claims")
      .update({
        qc_status: "waiting_ceo",
        exec_status: "pending",
        qc_result: qcResult,
        qc_comment: comment || null,
        qc_signature: signature,
        qc_by: userId,
        sent_to_ceo_at: now,
        updated_at: now,
      })
      .eq("id", currentClaim.id);

    if (claimError) throw claimError;

    const { error: approvalError } = await supabaseClient
      .from("approval_requests")
      .upsert(
        {
          request_type: "claim",
          request_title: `อนุมัติเคลมสินค้า ${
            currentClaim.product || currentClaim.product_name || ""
          }`,
          request_detail:
            currentClaim.detail ||
            currentClaim.claim_detail ||
            currentClaim.problem_detail ||
            "",

          source_table: "claims",
          source_id: currentClaim.id,

          request_status: "pending",
          request_by: userId,
          priority: "normal",
          updated_at: now,
        },
        {
          onConflict: "source_table,source_id",
        }
      );

    if (approvalError) throw approvalError;

    await showSuccessPopup({
      title: "ส่งอนุมัติสำเร็จ",
      message: `เคลม #${getClaimNo(
        currentClaim
      )} ถูกส่งให้ CEO พิจารณาแล้ว\nกรุณารอผลการอนุมัติ`,
      buttonText: "ตกลง",
      icon: "send",
    });

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
const PRODUCT_SOURCE_LABELS = {
  in_house: "ผลิตเอง",
  trading: "ซื้อมาขายไป",
};

const ROOT_CAUSE_LABELS = {
  logistics: "ขนส่ง",
  production: "ผลิต/โรงงาน",
  wrong_delivery: "ส่งผิดสเปก",
};

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
      "ประเภทสินค้า",
      "ต้นเหตุ",
      "Grade A (คืนสต็อก)",
      "Grade B (Outlet)",
      "Grade R (บด/หลอม)",
      "Grade C (ทิ้ง)",
      "รวม",
      "สาเหตุหลัก",
      "ผู้รับผิดชอบ",
    ],
  ];

  claims.forEach((c) => {
    const r = c.qc_result || {};
    const total =
      Number(r.grade_a_qty || 0) +
      Number(r.grade_b_qty || 0) +
      Number(r.grade_r_qty || r.repair_qty || 0) +
      Number(r.grade_c_qty || r.scrap_qty || 0);

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
      PRODUCT_SOURCE_LABELS[r.product_source] || "",
      ROOT_CAUSE_LABELS[r.claim_root_cause] || "",
      r.grade_a_qty ?? 0,
      r.grade_b_qty ?? 0,
      r.grade_r_qty ?? r.repair_qty ?? 0,
      r.grade_c_qty ?? r.scrap_qty ?? 0,
      total,
      r.main_cause ?? r.defect_reason ?? "",
      r.responsible_person ?? r.responsibility ?? "",
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

  exportRowsAsCsv(
    rows,
    `${CLAIM_SCOPE}_claims_${new Date().toISOString().slice(0, 10)}.csv`,
  );
}

function exportRowsAsCsv(rows, filename) {
  const csv =
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
          .join(","),
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

function exportPDF() {
  if (!currentClaim) {
    showToast("ยังไม่ได้เลือกเคลม", "warning");
    return;
  }
  if (typeof window.ApprovalDocument?.download === "function") {
    window.ApprovalDocument.download(currentClaim);
  } else {
    window.print();
  }
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

// ---------- Header Date ----------
function updateHeaderDate() {
  const el = document.getElementById("appHeaderDateText");
  if (!el) return;
  const months = [
    "มกราคม",
    "กุมภาพันธ์",
    "มีนาคม",
    "เมษายน",
    "พฤษภาคม",
    "มิถุนายน",
    "กรกฎาคม",
    "สิงหาคม",
    "กันยายน",
    "ตุลาคม",
    "พฤศจิกายน",
    "ธันวาคม",
  ];
  const now = new Date();
  const day = now.getDate();
  const month = months[now.getMonth()];
  const year = now.getFullYear() + 543;
  el.textContent = `${day} ${month} ${year}`;
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
    updateHeaderDate();

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

// expose for onclick handlers
window.openApprovalDocFor = openApprovalDocFor;
window.clearQcSignature = clearQcSignature;
window.stepQty = stepQty;
window.resetFilters = resetFilters;
window.exportExcel = exportExcel;
window.exportCSV = exportCSV;
window.exportPDF = exportPDF;
window.closeModal = closeModal;
window.closeLightbox = closeLightbox;
window.saveQcDraft = saveQcDraft;
window.sendToCEO = sendToCEO;
window.openModal = openModal;
window.showConfirmDialog = showConfirmDialog;
window.showSuccessPopup = showSuccessPopup; // ✅ NEW

console.log(`✅ ${CLAIM_SCOPE}-claims.js (v4) loaded`);
