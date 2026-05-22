// executive-Approval.js
// Executive Approval Center — รองรับงานอนุมัติหลายประเภท + ยังเปิดรายละเอียดเคลมเดิมได้
// ประเภทงานหลัก:
// 1) temp_credit_limit      = อนุมัติวงเงิน (ชั่วคราว)
// 2) special_price          = ขออนุมัติราคา (กรณีพิเศษ)
// 3) claim                  = เคลมสินค้า
// 4) promotion              = โปรโมชั่น
// 5) new_area_shop          = เปิดร้านค้าในเขตใหม่

const APPROVAL_TYPE_META = {
  temp_credit_limit: {
    label: "อนุมัติวงเงิน (ชั่วคราว)",
    shortLabel: "วงเงินชั่วคราว",
    icon: "account_balance_wallet",
    className: "type-credit",
  },
  temporary_credit_limit: {
    label: "อนุมัติวงเงิน (ชั่วคราว)",
    shortLabel: "วงเงินชั่วคราว",
    icon: "account_balance_wallet",
    className: "type-credit",
  },
  credit_limit: {
    label: "อนุมัติวงเงิน (ชั่วคราว)",
    shortLabel: "วงเงินชั่วคราว",
    icon: "account_balance_wallet",
    className: "type-credit",
  },
  special_price: {
    label: "ขออนุมัติราคา (กรณีพิเศษ)",
    shortLabel: "ราคาพิเศษ",
    icon: "sell",
    className: "type-price",
  },
  claim: {
    label: "เคลมสินค้า",
    shortLabel: "เคลมสินค้า",
    icon: "inventory_2",
    className: "type-claim",
  },
  promotion: {
    label: "โปรโมชั่น",
    shortLabel: "โปรโมชั่น",
    icon: "campaign",
    className: "type-promotion",
  },
  new_area_shop: {
    label: "เปิดร้านค้าในเขตใหม่",
    shortLabel: "เปิดเขตใหม่",
    icon: "storefront",
    className: "type-shop",
  },
};

const APPROVAL_STATUS_META = {
  pending: {
    label: "รอพิจารณา",
    badge: `<span class="status-badge waiting">⏳ รอพิจารณา</span>`,
  },
  approved: {
    label: "อนุมัติ",
    badge: `<span class="status-badge approved">✅ อนุมัติแล้ว</span>`,
  },
  rejected: {
    label: "ปฏิเสธ",
    badge: `<span class="status-badge rejected">❌ ปฏิเสธ</span>`,
  },
  request_more_info: {
    label: "ขอข้อมูลเพิ่ม",
    badge: `<span class="status-badge in-progress">📝 ขอข้อมูลเพิ่ม</span>`,
  },
};

const CEO_VISIBLE_QC_STATUSES = [
  "waiting_ceo",
  "exec_approved",
  "exec_rejected",
  "approved",
  "rejected",
];

let allExecClaims = [];
let filteredExecClaims = [];
let currentExecClaim = null;

const _ceoClaimsCache = new Map();
const _approverNameCache = new Map();

/* ---------- UTILS ---------- */
function formatDate(d) {
  if (!d || d === "—") return "—";
  try {
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("th-TH", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch (_) {
    return "—";
  }
}

function formatDateTime(d) {
  if (!d || d === "—") return "—";
  try {
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("th-TH", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (_) {
    return "—";
  }
}

function formatMoney(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return n.toLocaleString("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function escapeHtml(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function val(...items) {
  return items.find((v) => v !== undefined && v !== null && v !== "") || "—";
}

function normalizeApprovalType(type) {
  const raw = String(type || "other").trim();
  if (raw === "temporary_credit_limit" || raw === "credit_limit") return "temp_credit_limit";
  return raw || "other";
}

function getApprovalTypeMeta(type) {
  const key = normalizeApprovalType(type);
  return (
    APPROVAL_TYPE_META[key] || {
      label: key === "other" ? "งานอนุมัติอื่น ๆ" : key,
      shortLabel: key === "other" ? "อื่น ๆ" : key,
      icon: "approval",
      className: "type-other",
    }
  );
}

function mapQcStatusToRequestStatus(qcStatus) {
  const s = String(qcStatus || "").toLowerCase();
  if (s === "exec_approved" || s === "approved") return "approved";
  if (s === "exec_rejected" || s === "rejected") return "rejected";
  return "pending";
}

function getApprovalStatus(row) {
  if (row?.request_status) return row.request_status;
  if (row?.exec_status) return row.exec_status;
  if (row?.qc_status) return mapQcStatusToRequestStatus(row.qc_status);
  return "pending";
}

function getApprovalStatusMeta(row) {
  return APPROVAL_STATUS_META[getApprovalStatus(row)] || APPROVAL_STATUS_META.pending;
}

function getClaimNo(c) {
  const raw =
    c?.claim_no || c?.claim_code || c?.claim_id || c?.source_id || c?.id || "";
  return String(raw).substring(0, 8).toUpperCase() || "—";
}

function getApprovalDocNo(row) {
  const year = new Date(
    row?.approved_at || row?.exec_at || row?.created_at || Date.now()
  ).getFullYear();
  const claimNo = getClaimNo(row);
  const type = normalizeApprovalType(row?.request_type || "claim");
  if (type === "claim") return `APP-${year}-${claimNo}`;
  const prefix = type.toUpperCase().replace(/[^A-Z0-9]/g, "-");
  return `APP-${year}-${prefix}-${claimNo}`;
}

function normalizeMediaUrls(value) {
  if (!value || value === "—") return [];
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

function isImageUrl(url) {
  return /\.(jpg|jpeg|png|webp|gif)(\?|#|$)/i.test(url || "");
}

async function waitForSupabase() {
  let i = 0;
  while (typeof supabaseClient === "undefined" && i < 50) {
    await new Promise((r) => setTimeout(r, 100));
    i++;
  }
  return typeof supabaseClient !== "undefined";
}

async function getApproverName(userId) {
  if (!userId) return "CEO / Executive";
  if (_approverNameCache.has(userId)) return _approverNameCache.get(userId);

  try {
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;

    const name = data?.display_name?.trim();
    if (name) {
      _approverNameCache.set(userId, name);
      return name;
    }
  } catch (e) {
    console.warn("[CEO] fetch approver name failed:", e);
  }

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (user?.id === userId && user.email) {
      const fallback = user.email.split("@")[0];
      _approverNameCache.set(userId, fallback);
      return fallback;
    }
  } catch (_) {}

  return "CEO / Executive";
}

function getQcResult(claim) {
  const raw = claim?.qc_result;
  if (!raw) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw) || {}; } catch (_) { return {}; }
  }
  return raw;
}

function getGradeRows(qc) {
  return [
    ["A", "คืนสต็อก / พร้อมขาย", qc.grade_a_qty],
    ["B", "ขายเกรดรอง / Outlet", qc.grade_b_qty],
    ["R", "ส่งกลับบด / หลอมใหม่", qc.repair_qty ?? qc.grade_r_qty],
    ["S", "สำรองอะไหล่ / ใช้ภายใน", qc.spare_qty ?? qc.grade_s_qty],
    ["C", "ทิ้ง / ตัดจ่าย / คืน Supplier", qc.scrap_qty ?? qc.grade_c_qty],
  ];
}

function getClaimTotalQty(claim) {
  const qc = getQcResult(claim);
  const totalFromQc = getGradeRows(qc).reduce((s, [, , q]) => s + Number(q || 0), 0);
  return totalFromQc || Number(claim?.qty || claim?.quantity || claim?.claim_qty || 0);
}

function buildStatusBadge(row) { return getApprovalStatusMeta(row).badge; }
function getExecText(row) { return getApprovalStatusMeta(row).label; }
function isFinalized(row) { return ["approved", "rejected"].includes(getApprovalStatus(row)); }

function getRequesterText(row) {
  return val(
    row?.requester_name, row?.request_by_name, row?.created_by_name,
    row?.emp_name, row?.request_by, row?.created_by, "—"
  );
}

function getApprovalTitle(row) {
  if (row?.request_title) return row.request_title;
  if (normalizeApprovalType(row?.request_type) === "claim") {
    return `อนุมัติเคลมสินค้า ${val(row?.product, row?.product_name, "")}`;
  }
  return getApprovalTypeMeta(row?.request_type).label;
}

function getApprovalDetail(row) {
  return val(
    row?.request_detail, row?.detail, row?.claim_detail,
    row?.problem_detail, row?.description, "—"
  );
}

function getApprovalAmount(row) {
  return val(row?.amount, row?.total_amount, row?.credit_amount, row?.price_amount, "");
}

function getSignatureValue(row) { return row?.exec_signature || row?.approval_signature || ""; }
function getApprovalCommentValue(row) { return row?.exec_comment || row?.approval_comment || ""; }

function adaptLegacyClaimRow(claim) {
  const requestStatus = mapQcStatusToRequestStatus(claim.qc_status || claim.exec_status);
  return {
    id: claim.id,
    approval_request_id: null,
    _legacy_claim: true,
    request_type: "claim",
    request_title:
      claim.request_title ||
      `อนุมัติเคลมสินค้า ${val(claim.product, claim.product_name, "")}`,
    request_detail: val(claim.detail, claim.claim_detail, claim.problem_detail, claim.description, "—"),
    request_status: requestStatus,
    priority: claim.priority || "normal",
    amount: claim.amount || claim.total_amount || null,
    requester_name: getRequesterText(claim),
    source_table: "claims",
    source_id: claim.id,
    ...claim,
    approval_comment: claim.exec_comment || claim.approval_comment || null,
    approval_signature: claim.exec_signature || claim.approval_signature || null,
    approved_by: claim.exec_by || claim.approved_by || null,
    approved_at: claim.exec_at || claim.approved_at || null,
    created_at: claim.created_at || claim.claim_date || null,
  };
}

/* ================================================================
   LOAD DATA
================================================================ */
async function loadExecClaims() {
  const tbody = document.getElementById("ceoTableBody");
  const cardList = document.getElementById("ceoCardList");

  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="table-loading">
          <span class="material-symbols-outlined spin">progress_activity</span>
          กำลังโหลด...
        </td>
      </tr>`;
  }
  if (cardList) {
    cardList.innerHTML = `
      <div class="table-loading" style="text-align:center;color:var(--muted);padding:30px 0;">
        <span class="material-symbols-outlined spin">progress_activity</span>
        กำลังโหลด...
      </div>`;
  }

  try {
    const approvalQuery = supabaseClient
      .from("approval_requests")
      .select("*")
      .order("created_at", { ascending: false });

    const claimsQuery = supabaseClient
      .from("claims")
      .select("*")
      .in("qc_status", CEO_VISIBLE_QC_STATUSES)
      .order("created_at", { ascending: false });

    const [approvalRes, claimsRes] = await Promise.all([approvalQuery, claimsQuery]);

    if (approvalRes.error) throw approvalRes.error;
    const approvalRows = approvalRes.data || [];

    let claimRows = [];
    if (claimsRes.error) {
      console.warn("[CEO] load legacy claims failed:", claimsRes.error.message || claimsRes.error);
    } else {
      claimRows = claimsRes.data || [];
    }

    const linkedClaimIds = new Set(
      approvalRows
        .filter((r) => r.source_table === "claims" && r.source_id)
        .map((r) => String(r.source_id))
    );

    const legacyOnlyClaims = claimRows
      .filter((c) => !linkedClaimIds.has(String(c.id)))
      .map(adaptLegacyClaimRow);

    const merged = [...approvalRows, ...legacyOnlyClaims].sort((a, b) => {
      const da = new Date(a.created_at || 0).getTime();
      const db = new Date(b.created_at || 0).getTime();
      return db - da;
    });

    allExecClaims = merged;
    updateExecSummary();
    applyFilters();
  } catch (err) {
    console.error("loadExecClaims error:", err);
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="table-loading" style="color:var(--danger);">
            โหลดข้อมูลไม่สำเร็จ: ${escapeHtml(err.message || err)}
          </td>
        </tr>`;
    }
    if (cardList) {
      cardList.innerHTML = `
        <div class="table-loading" style="color:var(--danger);text-align:center;padding:24px;">
          โหลดข้อมูลไม่สำเร็จ: ${escapeHtml(err.message || err)}
        </div>`;
    }
  }
}

/* ================================================================
   SUMMARY + PULSE ALERT
================================================================ */
function updateExecSummary() {
  const wait     = allExecClaims.filter((c) => getApprovalStatus(c) === "pending").length;
  const approved = allExecClaims.filter((c) => getApprovalStatus(c) === "approved").length;
  const rejected = allExecClaims.filter((c) => getApprovalStatus(c) === "rejected").length;

  const w = document.getElementById("sumWaiting");
  const a = document.getElementById("sumExecApproved");
  const r = document.getElementById("sumExecRejected");

  if (w) w.textContent = wait;
  if (a) a.textContent = approved;
  if (r) r.textContent = rejected;

  // ✨ Toggle pulse alert ที่การ์ดรออนุมัติ
  const pendingCard = document.getElementById("cardPending");
  if (pendingCard) {
    pendingCard.classList.toggle("has-alert", wait > 0);
    if (wait > 0) {
      pendingCard.setAttribute("aria-label", `มี ${wait} รายการรออนุมัติ`);
    } else {
      pendingCard.removeAttribute("aria-label");
    }
  }
}

/* ================================================================
   FILTERS
================================================================ */
function applyFilters() {
  const search = document.getElementById("searchInput")?.value.toLowerCase().trim() || "";
  const type = document.getElementById("filterScope")?.value || "";
  const status = document.getElementById("filterExecStatus")?.value || "";
  const dateFrom = document.getElementById("filterDateFrom")?.value || "";
  const dateTo = document.getElementById("filterDateTo")?.value || "";

  filteredExecClaims = allExecClaims.filter((row) => {
    const rowType = normalizeApprovalType(row.request_type);
    const rowStatus = getApprovalStatus(row);
    const rowDate = String(row.created_at || row.request_date || "").slice(0, 10);

    if (type && rowType !== type) return false;
    if (status && rowStatus !== status) return false;
    if (dateFrom && rowDate && rowDate < dateFrom) return false;
    if (dateTo && rowDate && rowDate > dateTo) return false;

    if (search) {
      const text = `
        ${getApprovalTitle(row)}
        ${getApprovalDetail(row)}
        ${getApprovalTypeMeta(rowType).label}
        ${rowType}
        ${getRequesterText(row)}
        ${row.source_table || ""}
        ${row.source_id || ""}
        ${row.priority || ""}
        ${row.product || ""}
        ${row.product_name || ""}
        ${row.customer || ""}
        ${row.customer_name || ""}
      `.toLowerCase();
      if (!text.includes(search)) return false;
    }
    return true;
  });

  renderExecTable(filteredExecClaims);
  renderExecCardList(filteredExecClaims);
}

function resetFilters() {
  const defaults = {
    searchInput: "",
    filterScope: "",
    filterExecStatus: "",
    filterDateFrom: "",
    filterDateTo: "",
  };
  Object.entries(defaults).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  });
  applyFilters();
}

function hydrateApprovalTypeFilter() {
  const select = document.getElementById("filterScope");
  if (!select) return;
  const currentValue = select.value || "";
  // ปล่อยให้ HTML จัดการ options เริ่มต้น — แค่คงค่าที่เลือกไว้
  select.value = currentValue;
}

/* ================================================================
   RENDER TABLE (desktop)
================================================================ */
function renderExecTable(list) {
  const tbody = document.getElementById("ceoTableBody");
  if (!tbody) return;

  _ceoClaimsCache.clear();

  if (!list || list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="table-loading" style="color:var(--muted);">
          <span class="material-symbols-outlined" style="font-size:32px;opacity:.5;">inbox</span>
          <div style="margin-top:8px;">ไม่มีรายการอนุมัติตามเงื่อนไขที่เลือก</div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = list
    .map((item) => {
      _ceoClaimsCache.set(item.id, item);
      const type = normalizeApprovalType(item.request_type);
      const meta = getApprovalTypeMeta(type);
      const amount = getApprovalAmount(item);

      return `
        <tr>
          <td>
            <div class="cell-date">${formatDate(item.created_at)}</div>
            <div class="cell-sub">${formatDateTime(item.created_at)}</div>
          </td>
          <td>
            <span class="scope-pill ${escapeHtml(meta.className)}">
              <span class="material-symbols-outlined" style="font-size:14px;">${escapeHtml(meta.icon)}</span>
              ${escapeHtml(meta.shortLabel)}
            </span>
          </td>
          <td class="cell-title">
            <div class="cell-strong cell-clamp-1" title="${escapeHtml(getApprovalTitle(item))}">${escapeHtml(getApprovalTitle(item))}</div>
            <div class="cell-sub">ผู้ขอ: ${escapeHtml(getRequesterText(item))}</div>
          </td>
          <td class="cell-product">
            <div class="cell-strong cell-clamp-2" title="${escapeHtml(getApprovalDetail(item))}">${escapeHtml(getApprovalDetail(item))}</div>
            <div class="cell-sub">
              ${amount !== "—" && amount ? `วงเงิน/มูลค่า: ${escapeHtml(formatMoney(amount))}` : `เลขที่: ${escapeHtml(getApprovalDocNo(item))}`}
            </div>
          </td>
          <td>
            <div class="cell-strong">${escapeHtml(item.priority || "normal")}</div>
            <div class="cell-sub">ประเภท: ${escapeHtml(meta.label)}</div>
          </td>
          <td>${buildStatusBadge(item)}</td>
          <td>
            <button class="btn-view" type="button" onclick="openCeoModalByApprovalId('${escapeHtml(item.id)}')">
              <span class="material-symbols-outlined" style="font-size:1rem;">open_in_new</span>
              ดู/อนุมัติ
            </button>
          </td>
        </tr>`;
    })
    .join("");
}

/* ================================================================
   RENDER CARD LIST (mobile)
================================================================ */
function renderExecCardList(list) {
  const wrap = document.getElementById("ceoCardList");
  if (!wrap) return;

  if (!list || list.length === 0) {
    wrap.innerHTML = `
      <div class="table-loading" style="color:var(--muted);text-align:center;padding:30px 12px;">
        <span class="material-symbols-outlined" style="font-size:32px;opacity:.5;">inbox</span>
        <div style="margin-top:8px;">ไม่มีรายการอนุมัติตามเงื่อนไขที่เลือก</div>
      </div>`;
    return;
  }

  wrap.innerHTML = list
    .map((item) => {
      // ใส่ลง cache เผื่อเปิด modal จาก card list ก่อน
      _ceoClaimsCache.set(item.id, item);

      const type = normalizeApprovalType(item.request_type);
      const meta = getApprovalTypeMeta(type);
      const amount = getApprovalAmount(item);

      return `
        <div class="qc-card-item">
          <div class="qc-card-row">
            <span class="scope-pill ${escapeHtml(meta.className)}">
              <span class="material-symbols-outlined" style="font-size:14px;">${escapeHtml(meta.icon)}</span>
              ${escapeHtml(meta.shortLabel)}
            </span>
            ${buildStatusBadge(item)}
          </div>

          <div class="qc-card-title">${escapeHtml(getApprovalTitle(item))}</div>

          <div class="qc-card-detail">${escapeHtml(getApprovalDetail(item))}</div>

          <div class="qc-card-meta">
            <span><strong>${escapeHtml(formatDateTime(item.created_at))}</strong></span>
            <span>ผู้ขอ: ${escapeHtml(getRequesterText(item))}</span>
            ${
              amount !== "—" && amount
                ? `<span>มูลค่า: ${escapeHtml(formatMoney(amount))}</span>`
                : `<span>เลขที่: ${escapeHtml(getApprovalDocNo(item))}</span>`
            }
          </div>

          <div class="qc-card-foot">
            <span style="font-size:12px;color:var(--muted);">${escapeHtml(meta.label)}</span>
            <button class="btn-view" type="button" onclick="openCeoModalByApprovalId('${escapeHtml(item.id)}')">
              <span class="material-symbols-outlined" style="font-size:1rem;">open_in_new</span>
              ดู/อนุมัติ
            </button>
          </div>
        </div>`;
    })
    .join("");
}

/* ================================================================
   MODAL — extra sections + media
================================================================ */
function ensureExecutiveSections() {
  const modalBody = document.querySelector("#ceoModal .qc-modal-body");
  if (!modalBody) return;

  if (!document.getElementById("ceoMediaGrid")) {
    const mediaSection = document.createElement("div");
    mediaSection.className = "modal-section";
    mediaSection.innerHTML = `
      <div class="modal-section-label">
        <span class="material-symbols-outlined">image</span>
        เอกสารแนบ / รูปประกอบ
      </div>
      <div class="ceo-media-grid" id="ceoMediaGrid"></div>
    `;

    const detailSection = document.getElementById("ceoQcSummary")?.closest(".modal-section");
    if (detailSection) detailSection.before(mediaSection);
    else modalBody.prepend(mediaSection);
  }

  if (!document.getElementById("approvalDocumentPreviewBtn")) {
    const footer = document.querySelector("#ceoModal .qc-action-btns");
    if (footer) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = "approvalDocumentPreviewBtn";
      btn.innerHTML = `<span class="material-symbols-outlined">description</span> ดูเอกสารอนุมัติ`;
      btn.addEventListener("click", () => {
        if (currentExecClaim) openApprovalDocument(currentExecClaim);
      });
      footer.prepend(btn);
    }
  }
}

function renderMediaSection(row) {
  const grid = document.getElementById("ceoMediaGrid");
  if (!grid) return;

  const urls = normalizeMediaUrls(
    val(row.media_urls, row.attachments, row.files, row.attachment_urls, "")
  );

  if (!urls.length) {
    grid.innerHTML = `<div class="modal-detail-box">ไม่มีเอกสารแนบ / รูปประกอบ</div>`;
    return;
  }

  grid.innerHTML = urls
    .map((url, idx) => {
      const safeAttr = escapeHtml(url);
      if (isImageUrl(url)) {
        return `
          <button class="media-thumb" type="button" data-media-url="${safeAttr}" data-media-idx="${idx}">
            <img src="${safeAttr}" alt="เอกสารแนบ ${idx + 1}" onerror="this.parentElement.style.display='none'">
          </button>`;
      }
      return `
        <a class="media-file" href="${safeAttr}" target="_blank" rel="noopener noreferrer">
          <span class="material-symbols-outlined">attach_file</span>
          เปิดไฟล์แนบ
        </a>`;
    })
    .join("");

  grid.querySelectorAll(".media-thumb").forEach((btn) => {
    btn.addEventListener("click", () => {
      const u = btn.getAttribute("data-media-url");
      if (u) openLightbox(u);
    });
  });
}

function setApprovalFormState(row) {
  const done = isFinalized(row);
  const finalStatus = getApprovalStatus(row);

  document.querySelectorAll("input[name='execDecision']").forEach((radio) => {
    if (done) radio.checked = radio.value === finalStatus;
    else radio.checked = false;
    radio.disabled = done;
  });

  const comment = document.getElementById("execComment");
  if (comment) {
    comment.value = getApprovalCommentValue(row) || "";
    comment.disabled = done;
  }

  const saveBtn = document.querySelector(".btn-save-draft");
  if (saveBtn) {
    saveBtn.disabled = done;
    saveBtn.innerHTML = done
      ? `<span class="material-symbols-outlined">lock</span> พิจารณาแล้ว`
      : `<span class="material-symbols-outlined">done_all</span> บันทึกผลการพิจารณา`;
  }

  const clearBtn = document.querySelector(".btn-clear-signature");
  if (clearBtn) clearBtn.disabled = done;
}

function buildGenericInfoGrid(row) {
  const typeMeta = getApprovalTypeMeta(row.request_type);
  const amount = getApprovalAmount(row);

  return `
    <div class="info-row">
      <div class="info-label">เลขอ้างอิง</div>
      <div class="info-value">${escapeHtml(getApprovalDocNo(row))}</div>
    </div>
    <div class="info-row">
      <div class="info-label">ประเภทงาน</div>
      <div class="info-value">${escapeHtml(typeMeta.label)}</div>
    </div>
    <div class="info-row full">
      <div class="info-label">หัวข้ออนุมัติ</div>
      <div class="info-value">${escapeHtml(getApprovalTitle(row))}</div>
    </div>
    <div class="info-row">
      <div class="info-label">ผู้ขออนุมัติ</div>
      <div class="info-value">${escapeHtml(getRequesterText(row))}</div>
    </div>
    <div class="info-row">
      <div class="info-label">วันที่ส่งคำขอ</div>
      <div class="info-value">${escapeHtml(formatDateTime(row.created_at))}</div>
    </div>
    <div class="info-row">
      <div class="info-label">มูลค่า / วงเงิน</div>
      <div class="info-value">${escapeHtml(amount !== "—" && amount ? formatMoney(amount) : "—")}</div>
    </div>
    <div class="info-row">
      <div class="info-label">ความเร่งด่วน</div>
      <div class="info-value">${escapeHtml(row.priority || "normal")}</div>
    </div>
    <div class="info-row full">
      <div class="info-label">รายละเอียดคำขอ</div>
      <div class="info-value">${escapeHtml(getApprovalDetail(row))}</div>
    </div>
    <div class="info-row full">
      <div class="info-label">แหล่งข้อมูลอ้างอิง</div>
      <div class="info-value">${escapeHtml(val(row.source_table, "—"))} / ${escapeHtml(val(row.source_id, "—"))}</div>
    </div>
  `;
}

function buildGenericDetailHtml(row) {
  const typeMeta = getApprovalTypeMeta(row.request_type);
  const amount = getApprovalAmount(row);

  return `
    <div class="document-block">
      <div class="doc-headline">${escapeHtml(typeMeta.label)}</div>
      <div class="qc-detail-grid">
        <div class="qc-detail-card">
          <div class="qc-detail-label">
            <span class="material-symbols-outlined">${escapeHtml(typeMeta.icon)}</span>
            ประเภทงาน
          </div>
          <div class="qc-detail-value">${escapeHtml(typeMeta.label)}</div>
        </div>
        <div class="qc-detail-card">
          <div class="qc-detail-label">
            <span class="material-symbols-outlined">payments</span>
            มูลค่า / วงเงิน
          </div>
          <div class="qc-detail-value">${escapeHtml(amount !== "—" && amount ? formatMoney(amount) : "—")}</div>
        </div>
        <div class="qc-detail-card">
          <div class="qc-detail-label">
            <span class="material-symbols-outlined">priority_high</span>
            ความเร่งด่วน
          </div>
          <div class="qc-detail-value">${escapeHtml(row.priority || "normal")}</div>
        </div>
        <div class="qc-detail-card">
          <div class="qc-detail-label">
            <span class="material-symbols-outlined">hourglass_top</span>
            สถานะ
          </div>
          <div class="qc-detail-value">${escapeHtml(getExecText(row))}</div>
        </div>
        <div class="qc-detail-card full">
          <div class="qc-detail-label">
            <span class="material-symbols-outlined">description</span>
            รายละเอียดประกอบการตัดสินใจ
          </div>
          <div class="qc-detail-value">${escapeHtml(getApprovalDetail(row))}</div>
        </div>
      </div>
    </div>
  `;
}

function buildClaimInfoGrid(claim) {
  return `
    <div class="info-row">
      <div class="info-label">เลขเคลม</div>
      <div class="info-value">${escapeHtml(getClaimNo(claim))}</div>
    </div>
    <div class="info-row">
      <div class="info-label">ประเภทเคลม</div>
      <div class="info-value">${claim.claim_scope === "internal" ? "เคลมภายใน" : "เคลมภายนอก"}</div>
    </div>
    <div class="info-row">
      <div class="info-label">ผู้แจ้ง</div>
      <div class="info-value">${escapeHtml(val(claim.emp_name, claim.created_by_name, claim.reporter_name))}</div>
    </div>
    <div class="info-row">
      <div class="info-label">แผนก / พื้นที่</div>
      <div class="info-value">${escapeHtml(val(claim.area, claim.department, claim.sale_area))}</div>
    </div>
    <div class="info-row">
      <div class="info-label">ลูกค้า</div>
      <div class="info-value">${escapeHtml(val(claim.customer, claim.customer_name, claim.client_name))}</div>
    </div>
    <div class="info-row">
      <div class="info-label">วันที่แจ้ง</div>
      <div class="info-value">${formatDate(val(claim.claim_date, claim.created_at))}</div>
    </div>
    <div class="info-row full">
      <div class="info-label">สินค้า</div>
      <div class="info-value">${escapeHtml(val(claim.product, claim.product_name, claim.item_name))}</div>
    </div>
    <div class="info-row">
      <div class="info-label">จำนวนที่แจ้ง</div>
      <div class="info-value">${escapeHtml(val(claim.qty, claim.quantity, claim.claim_qty))}</div>
    </div>
    <div class="info-row">
      <div class="info-label">จำนวนจากผล QC</div>
      <div class="info-value">${escapeHtml(getClaimTotalQty(claim))}</div>
    </div>
    <div class="info-row full">
      <div class="info-label">รายละเอียดปัญหาที่แจ้ง</div>
      <div class="info-value">${escapeHtml(val(claim.detail, claim.claim_detail, claim.problem_detail, claim.description))}</div>
    </div>
  `;
}

function buildClaimQcDetailHtml(claim) {
  const qc = getQcResult(claim);
  const gradeRows = getGradeRows(qc)
    .map(([grade, label, qty]) => `
        <tr>
          <td>
            <label class="modal-check">
              <input type="checkbox" ${Number(qty || 0) > 0 ? "checked" : ""} disabled>
              <span>${grade}</span>
            </label>
          </td>
          <td>${escapeHtml(label)}</td>
          <td style="text-align:right;">${Number(qty || 0).toLocaleString()}</td>
        </tr>`)
    .join("");

  return `
    <div class="document-block">
      <div class="doc-headline">สรุปผลตรวจ QC เพื่อประกอบการอนุมัติ</div>
      <table class="qc-doc-table">
        <thead>
          <tr><th>เกรด</th><th>คำอธิบาย</th><th style="text-align:right;">จำนวน</th></tr>
        </thead>
        <tbody>${gradeRows}</tbody>
      </table>

      <div class="qc-detail-grid">
        <div class="qc-detail-card">
          <div class="qc-detail-label"><span class="material-symbols-outlined">error</span>สาเหตุหลัก</div>
          <div class="qc-detail-value">${escapeHtml(qc.defect_reason || "-")}</div>
        </div>
        <div class="qc-detail-card">
          <div class="qc-detail-label"><span class="material-symbols-outlined">badge</span>ผู้รับผิดชอบ</div>
          <div class="qc-detail-value">${escapeHtml(qc.responsibility || "-")}</div>
        </div>
        <div class="qc-detail-card full">
          <div class="qc-detail-label"><span class="material-symbols-outlined">comment</span>ความเห็น QC</div>
          <div class="qc-detail-value">${escapeHtml(String(val(claim.qc_comment, qc.comment, "-")))}</div>
        </div>
      </div>
    </div>
  `;
}

function openCeoModal(row) {
  if (!row) return;

  currentExecClaim = row;
  ensureExecutiveSections();

  const modal = document.getElementById("ceoModal");
  if (!modal) return;

  modal.classList.add("open");
  document.body.style.overflow = "hidden";

  const type = normalizeApprovalType(row.request_type);
  const typeMeta = getApprovalTypeMeta(type);

  const title = document.getElementById("ceoModalTitle");
  if (title) {
    title.textContent =
      type === "claim"
        ? `เคลม #${getClaimNo(row)}`
        : `${typeMeta.label} #${getClaimNo(row)}`;
  }

  const info = document.getElementById("ceoInfoGrid");
  if (info) {
    info.innerHTML = type === "claim" ? buildClaimInfoGrid(row) : buildGenericInfoGrid(row);
  }

  const sumBox = document.getElementById("ceoQcSummary");
  if (sumBox) {
    sumBox.innerHTML = type === "claim" ? buildClaimQcDetailHtml(row) : buildGenericDetailHtml(row);
  }

  renderMediaSection(row);
  setApprovalFormState(row);

  requestAnimationFrame(() => {
    initExecSignaturePad();
    const savedSignature = getSignatureValue(row);
    if (savedSignature && isFinalized(row)) {
      drawSavedSignature(savedSignature);
    } else {
      clearExecSignature(true);
    }
  });
}

/* ================================================================
   HEADER (date + user)
================================================================ */
document.addEventListener("DOMContentLoaded", () => {
  initExecutiveHeader();
});

function initExecutiveHeader() {
  renderHeaderDate();
  renderHeaderUser();
}

function renderHeaderDate() {
  const el = document.getElementById("appHeaderDateText");
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleDateString("th-TH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

async function renderHeaderUser() {
  const nameEl = document.getElementById("userName");
  const avatarEl = document.getElementById("userAvatar");
  if (!nameEl || !avatarEl) return;

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const name =
      user?.user_metadata?.display_name ||
      user?.user_metadata?.full_name ||
      user?.email?.split("@")[0] ||
      "Executive";
    nameEl.textContent = name;
    avatarEl.textContent = name.charAt(0).toUpperCase();
  } catch (err) {
    console.error("โหลดข้อมูลผู้ใช้ไม่สำเร็จ", err);
    nameEl.textContent = "Executive";
    avatarEl.textContent = "E";
  }
}

/* ================================================================
   OPEN MODAL BY ID
================================================================ */
async function openCeoModalByApprovalId(rowId) {
  const row = _ceoClaimsCache.get(rowId);
  if (!row) return;

  const type = normalizeApprovalType(row.request_type);

  if (row._legacy_claim) {
    openCeoModal(row);
    return;
  }

  if (type === "claim" && row.source_table === "claims" && row.source_id) {
    const { data: claim, error } = await supabaseClient
      .from("claims")
      .select("*")
      .eq("id", row.source_id)
      .single();

    if (error) {
      console.error("load claim detail error:", error);
      if (typeof showToast === "function") showToast("โหลดรายละเอียดเคลมไม่สำเร็จ", "danger");
      else alert("โหลดรายละเอียดเคลมไม่สำเร็จ");
      return;
    }

    const mergedClaim = {
      ...claim,
      request_type: "claim",
      request_title: row.request_title,
      request_detail: row.request_detail,
      request_status: row.request_status,
      approval_request_id: row.id,
      approval_comment: row.approval_comment,
      approval_signature: row.approval_signature,
      approved_by: row.approved_by,
      approved_at: row.approved_at,
      priority: row.priority,
      amount: row.amount,
      source_table: row.source_table,
      source_id: row.source_id,
    };

    openCeoModal(mergedClaim);
    return;
  }

  openCeoModal({ ...row, approval_request_id: row.id });
}

function closeCeoModal() {
  const modal = document.getElementById("ceoModal");
  if (modal) modal.classList.remove("open");
  document.body.style.overflow = "";
  currentExecClaim = null;
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeCeoModal();
    closeLightbox();
  }
});

/* ================================================================
   SAVE DECISION
================================================================ */
async function saveExecDecision() {
  if (!currentExecClaim) return;

  if (isFinalized(currentExecClaim)) {
    alert("รายการนี้ผ่านการพิจารณาแล้ว ไม่สามารถบันทึกซ้ำได้");
    return;
  }

  const decisionEl = document.querySelector("input[name='execDecision']:checked");
  if (!decisionEl) {
    alert("กรุณาเลือกผลการพิจารณา (อนุมัติ / ปฏิเสธ)");
    return;
  }

  const decision = decisionEl.value;
  if (!["approved", "rejected"].includes(decision)) {
    alert("ค่าผลการพิจารณาไม่ถูกต้อง");
    return;
  }

  const comment = document.getElementById("execComment")?.value.trim() || "";

  if (decision === "rejected" && !comment) {
    alert("กรุณาระบุเหตุผลในการปฏิเสธ");
    document.getElementById("execComment")?.focus();
    return;
  }

  if (!hasExecSignature()) {
    alert("กรุณาเซ็นชื่อก่อนบันทึกผลการพิจารณา");
    return;
  }

  const signatureData = getExecSignatureData();
  if (!signatureData) {
    alert("ไม่สามารถบันทึกลายเซ็นได้ กรุณาเซ็นใหม่อีกครั้ง");
    return;
  }

  if (!confirm(`ยืนยันการ${decision === "approved" ? "อนุมัติ" : "ปฏิเสธ"}รายการนี้?`)) return;

  const saveBtn = document.querySelector(".btn-save-draft");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.classList.add("loading");
  }

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const now = new Date().toISOString();
    const approvalRequestId = currentExecClaim.approval_request_id || null;
    const type = normalizeApprovalType(currentExecClaim.request_type);
    const isLegacyClaim = !!currentExecClaim._legacy_claim;

    let finalDocumentRow = {
      ...currentExecClaim,
      exec_status: decision,
      exec_comment: comment || null,
      exec_signature: signatureData,
      exec_by: user?.id || null,
      exec_at: now,
      request_status: decision,
      approved_by: user?.id || null,
      approved_at: now,
    };

    if (approvalRequestId) {
      const { data: updatedApproval, error: approvalError } = await supabaseClient
        .from("approval_requests")
        .update({
          request_status: decision,
          approval_comment: comment || null,
          approval_signature: signatureData,
          approved_by: user?.id || null,
          approved_at: now,
          updated_at: now,
        })
        .eq("id", approvalRequestId)
        .select()
        .maybeSingle();

      if (approvalError) throw approvalError;
      if (!updatedApproval) {
        throw new Error("อัปเดต approval_requests ไม่สำเร็จ: ไม่พบรายการ หรือสิทธิ์ RLS ไม่อนุญาตให้อ่านหลังอัปเดต");
      }

      finalDocumentRow = {
        ...finalDocumentRow,
        ...updatedApproval,
        approval_request_id: approvalRequestId,
      };
    }

    if (type === "claim" && currentExecClaim.id) {
      const updatePayload = {
        exec_status: decision,
        qc_status: decision === "approved" ? "exec_approved" : "exec_rejected",
        exec_comment: comment || null,
        exec_signature: signatureData,
        exec_by: user?.id || null,
        exec_at: now,
        updated_at: now,
      };

      const claimId = isLegacyClaim ? currentExecClaim.id : currentExecClaim.id;

      const { data: updatedClaim, error: claimError } = await supabaseClient
        .from("claims")
        .update(updatePayload)
        .eq("id", claimId)
        .select()
        .maybeSingle();

      if (claimError) throw claimError;
      if (!updatedClaim) {
        throw new Error("อัปเดต claims ไม่สำเร็จ: ไม่พบเคลม หรือสิทธิ์ RLS ไม่อนุญาตให้อ่านหลังอัปเดต");
      }

      finalDocumentRow = {
        ...finalDocumentRow,
        ...updatedClaim,
        request_type: "claim",
        request_status: decision,
      };
    }

    if (!approvalRequestId && type !== "claim") {
      console.warn("[CEO] No approval_request_id and not a claim — nothing was written.");
    }

    if (typeof showToast === "function") {
      showToast("บันทึกผลการพิจารณาเรียบร้อย", "success");
    } else {
      alert("✅ บันทึกผลการพิจารณาเรียบร้อย");
    }

    openApprovalDocument(finalDocumentRow);
    closeCeoModal();
    await loadExecClaims();
  } catch (e) {
    console.error("[CEO] saveExecDecision error:", e);
    alert("บันทึกไม่สำเร็จ:\n\n" + (e.message || e));
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.classList.remove("loading");
    }
  }
}

/* ================================================================
   APPROVAL DOCUMENT (claim + generic)
================================================================ */
function buildClaimApprovalDocumentHtml(claim, approverName) {
  const qc = getQcResult(claim);
  const docNo = getApprovalDocNo(claim);
  const statusText = getExecText(claim);
  const statusClass = getApprovalStatus(claim) === "approved" ? "approved" : "rejected";
  const finalApprover = approverName && approverName.trim() ? approverName.trim() : "CEO / Executive";

  const gradeRows = getGradeRows(qc)
    .map(([grade, label, qty]) => `
    <tr>
      <td>
        <label class="pdf-check">
          <input type="checkbox" ${Number(qty || 0) > 0 ? "checked" : ""} disabled>
          <span>${grade}</span>
        </label>
      </td>
      <td>${escapeHtml(label)}</td>
      <td class="num">${Number(qty || 0).toLocaleString()}</td>
    </tr>`)
    .join("");

  return buildDocumentShell({
    docNo,
    title: "ใบอนุมัติการเคลมสินค้า",
    subtitle: "Claim Approval Document · EABaseHub",
    statusText,
    statusClass,
    mainHtml: `
      <div class="grid">
        <div class="box"><div class="label">เลขเคลม</div><div class="value">${escapeHtml(getClaimNo(claim))}</div></div>
        <div class="box"><div class="label">วันที่อนุมัติ</div><div class="value">${escapeHtml(formatDateTime(claim.exec_at || claim.approved_at))}</div></div>
        <div class="box"><div class="label">ประเภทเคลม</div><div class="value">${claim.claim_scope === "internal" ? "เคลมภายใน" : "เคลมภายนอก"}</div></div>
        <div class="box"><div class="label">ผู้แจ้ง / พื้นที่</div><div class="value">${escapeHtml(val(claim.emp_name, claim.created_by_name))} · ${escapeHtml(val(claim.area, claim.department))}</div></div>
        <div class="box"><div class="label">ลูกค้า</div><div class="value">${escapeHtml(val(claim.customer, claim.customer_name))}</div></div>
        <div class="box"><div class="label">สินค้า / จำนวน</div><div class="value">${escapeHtml(val(claim.product, claim.product_name))} · ${escapeHtml(val(claim.qty, claim.quantity))}</div></div>
        <div class="box full"><div class="label">รายละเอียดปัญหา</div><div class="value">${escapeHtml(val(claim.detail, claim.claim_detail, claim.problem_detail, claim.description))}</div></div>
      </div>

      <h2>ผลตรวจสอบจาก QC</h2>
      <table>
        <thead><tr><th style="width:18%;">เกรด</th><th>คำอธิบาย</th><th class="num" style="width:15%;">จำนวน</th></tr></thead>
        <tbody>${gradeRows}</tbody>
      </table>

      <div class="grid" style="margin-top:6px;">
        <div class="box"><div class="label">สาเหตุหลัก</div><div class="value">${escapeHtml(qc.defect_reason || "-")}</div></div>
        <div class="box"><div class="label">ผู้รับผิดชอบ</div><div class="value">${escapeHtml(qc.responsibility || "-")}</div></div>
        <div class="box full"><div class="label">ความเห็น QC</div><div class="value">${escapeHtml(val(claim.qc_comment, qc.comment, "-"))}</div></div>
      </div>

      ${buildDecisionDocumentSection(claim, finalApprover)}
    `,
  });
}

function buildGenericApprovalDocumentHtml(row, approverName) {
  const typeMeta = getApprovalTypeMeta(row.request_type);
  const docNo = getApprovalDocNo(row);
  const statusText = getExecText(row);
  const statusClass = getApprovalStatus(row) === "approved" ? "approved" : "rejected";
  const finalApprover = approverName && approverName.trim() ? approverName.trim() : "CEO / Executive";
  const amount = getApprovalAmount(row);

  return buildDocumentShell({
    docNo,
    title: `ใบอนุมัติ${typeMeta.label}`,
    subtitle: "Executive Approval Document · EABaseHub",
    statusText,
    statusClass,
    mainHtml: `
      <div class="grid">
        <div class="box"><div class="label">เลขที่เอกสาร</div><div class="value">${escapeHtml(docNo)}</div></div>
        <div class="box"><div class="label">วันที่อนุมัติ</div><div class="value">${escapeHtml(formatDateTime(row.approved_at || row.exec_at))}</div></div>
        <div class="box"><div class="label">ประเภทงาน</div><div class="value">${escapeHtml(typeMeta.label)}</div></div>
        <div class="box"><div class="label">ผู้ขออนุมัติ</div><div class="value">${escapeHtml(getRequesterText(row))}</div></div>
        <div class="box full"><div class="label">หัวข้ออนุมัติ</div><div class="value">${escapeHtml(getApprovalTitle(row))}</div></div>
        <div class="box"><div class="label">มูลค่า / วงเงิน</div><div class="value">${escapeHtml(amount !== "—" && amount ? formatMoney(amount) : "—")}</div></div>
        <div class="box"><div class="label">ความเร่งด่วน</div><div class="value">${escapeHtml(row.priority || "normal")}</div></div>
        <div class="box full"><div class="label">รายละเอียดประกอบการตัดสินใจ</div><div class="value">${escapeHtml(getApprovalDetail(row))}</div></div>
      </div>

      ${buildDecisionDocumentSection(row, finalApprover)}
    `,
  });
}

function buildDecisionDocumentSection(row, finalApprover) {
  const statusText = getExecText(row);
  const signature = getSignatureValue(row);
  const comment = getApprovalCommentValue(row);

  return `
    <h2>ผลการพิจารณาผู้บริหาร</h2>
    <div class="approval">
      <div class="approval-row"><strong>ผลการพิจารณา:</strong> ${escapeHtml(statusText)}</div>
      <div class="approval-row"><strong>หมายเหตุ / เงื่อนไข:</strong> ${escapeHtml(comment || "-")}</div>
      <div class="signature-row">
        <div class="signature-wrap">
          <div class="label">ลายเซ็นผู้บริหาร</div>
          <div class="signature-box">${signature ? `<img src="${escapeHtml(signature)}" alt="signature">` : `<span class="no-sig">ไม่มีลายเซ็น</span>`}</div>
        </div>
        <div class="approver-stack">
          <div class="box">
            <div class="label">ผู้อนุมัติ</div>
            <div class="value">${escapeHtml(finalApprover)}</div>
          </div>
          <div class="box">
            <div class="label">วันที่และเวลา</div>
            <div class="value">${escapeHtml(formatDateTime(row.exec_at || row.approved_at))}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function buildDocumentShell({ docNo, title, subtitle, statusText, statusClass, mainHtml }) {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(docNo)}</title>
  <style>
    @page { size: A4; margin: 10mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: "Kanit", "Sarabun", Tahoma, sans-serif;
      color: #0f172a; background: #e2e8f0; font-size: 11.5px; line-height: 1.4;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
      min-height: 100vh; padding: 20px 0 40px;
    }
    .doc { width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff; padding: 10mm; box-shadow:0 1px 3px rgba(15,23,42,.1),0 10px 40px rgba(15,23,42,.15); border-radius:2px; position:relative; }
    .top { display:flex; justify-content:space-between; gap:12px; border-bottom:2.5px solid #7c3aed; padding-bottom:8px; margin-bottom:10px;}
    .brand h1 { margin:0; font-size:18px; font-weight:700; color:#0f172a; }
    .brand p { margin: 2px 0 0; color:#475569; font-size:11px; }
    .doc-no { text-align:right; }
    .doc-no > div { color:#475569; font-size:10.5px; }
    .doc-no strong { display:block; font-size:13px; color:#5b21b6; margin:1px 0 4px; }
    .status { display:inline-block; padding:3px 10px; border-radius:999px; font-weight:700; font-size:11px; }
    .status.approved { background:#dcfce7; color:#14532d; }
    .status.rejected { background:#fee2e2; color:#7f1d1d; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
    .box { border:1px solid #cbd5e1; border-radius:7px; padding:6px 9px; background:#f8fafc; }
    .box.full { grid-column:1 / -1; }
    .label { color:#475569; font-size:10px; margin-bottom:1px; font-weight:500; }
    .value { font-weight:600; color:#0f172a; font-size:11.5px; word-break:break-word; white-space:pre-wrap; }
    h2 { font-size:12.5px; margin:10px 0 5px; color:#4c1d95; border-left:3px solid #7c3aed; padding-left:7px; font-weight:700; }
    table { width:100%; border-collapse:collapse; margin-top:4px; }
    th, td { border:1px solid #cbd5e1; padding:4px 7px; text-align:left; font-size:11px; }
    th { background:#ede9fe; color:#4c1d95; font-weight:700; }
    .num { text-align:right; }
    .pdf-check { display:flex; align-items:center; gap:6px; font-weight:700; color:#0f172a; }
    .approval { margin-top:8px; border:1.8px solid #7c3aed; border-radius:9px; padding:9px 12px; background:#faf5ff; }
    .approval-row { font-size:11.5px; color:#0f172a; margin-bottom:4px; }
    .approval-row strong { color:#4c1d95; font-weight:700; }
    .signature-row { display:grid; grid-template-columns:1.4fr 1fr; gap:12px; margin-top:8px; align-items:stretch; }
    .signature-box { border:1px solid #94a3b8; border-radius:7px; height:90px; display:flex; align-items:center; justify-content:center; background:#fff; padding:4px; overflow:hidden; }
    .signature-box img { max-width:100%; max-height:100%; width:auto; height:auto; object-fit:contain; filter: contrast(1.6) brightness(0.75) saturate(0); mix-blend-mode: multiply; }
    .approver-stack { display:grid; gap:5px; }
    .footer { margin-top:10px; padding-top:6px; border-top:1px solid #cbd5e1; color:#64748b; font-size:10px; display:flex; justify-content:space-between; }
    .actions { position:fixed; right:14px; top:14px; display:flex; gap:8px; z-index:10; }
    .actions button { border:0; border-radius:8px; padding:8px 14px; background:#7c3aed; color:#fff; cursor:pointer; font-weight:700; font-family:inherit; font-size:13px; box-shadow:0 4px 12px rgba(124,58,237,0.3); }
    .actions button:hover { background:#6d28d9; }
    @media print { @page { size:A4; margin:8mm; } html,body{background:#fff!important;padding:0!important;min-height:0!important;} .actions{display:none!important;} .doc{width:100%!important;min-height:0!important;margin:0!important;padding:0!important;box-shadow:none!important;border-radius:0!important;background:#fff!important;} body{font-size:11px;} }
  </style>
</head>
<body>
  <div class="actions">
    <button onclick="window.print()">🖨️ พิมพ์ / Save PDF</button>
  </div>
  <div class="doc">
    <div class="top">
      <div class="brand">
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(subtitle)}</p>
      </div>
      <div class="doc-no">
        <div>เลขที่เอกสาร</div>
        <strong>${escapeHtml(docNo)}</strong>
        <span class="status ${escapeHtml(statusClass)}">${escapeHtml(statusText)}</span>
      </div>
    </div>
    ${mainHtml}
    <div class="footer">
      <span>Generated by EABaseHub</span>
      <span>${escapeHtml(docNo)}</span>
    </div>
  </div>
</body>
</html>`;
}

function buildApprovalDocumentHtml(row, approverName) {
  const type = normalizeApprovalType(row?.request_type);
  if (type === "claim") return buildClaimApprovalDocumentHtml(row, approverName);
  return buildGenericApprovalDocumentHtml(row, approverName);
}

async function openApprovalDocument(row) {
  if (!row) return;

  const type = normalizeApprovalType(row?.request_type);
  const externalOpen = window.ApprovalDocument?.open;
  if (
    type === "claim" &&
    typeof externalOpen === "function" &&
    externalOpen !== openApprovalDocument
  ) {
    try {
      await externalOpen(row);
      return;
    } catch (e) {
      console.warn("[CEO] ApprovalDocument.open failed, fallback to internal builder:", e);
    }
  }

  const win = window.open("", "_blank");
  if (!win) {
    alert("เบราว์เซอร์บล็อก popup กรุณาอนุญาต popup ก่อนเปิดเอกสาร");
    return;
  }

  win.document.open();
  win.document.write(`<!doctype html><html><head><meta charset="UTF-8"><title>กำลังโหลด...</title>
    <style>body{font-family:"Kanit",sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#475569;background:#f8fafc;}</style>
    </head><body>⏳ กำลังจัดเตรียมเอกสาร...</body></html>`);
  win.document.close();

  try {
    const approverName = await getApproverName(row.exec_by || row.approved_by);
    const html = buildApprovalDocumentHtml(row, approverName);
    win.document.open();
    win.document.write(html);
    win.document.close();
  } catch (e) {
    console.error("[CEO] openApprovalDocument error:", e);
    const html = buildApprovalDocumentHtml(row, null);
    win.document.open();
    win.document.write(html);
    win.document.close();
  }
}

function downloadApprovalDocument(row) {
  if (!row) return;
  const type = normalizeApprovalType(row?.request_type);
  const externalDownload = window.ApprovalDocument?.download;
  if (
    type === "claim" &&
    typeof externalDownload === "function" &&
    externalDownload !== downloadApprovalDocument
  ) {
    try { externalDownload(row); return; }
    catch (e) { console.warn("[CEO] ApprovalDocument.download failed, fallback:", e); }
  }

  const win = window.open("", "_blank");
  if (!win) { alert("เบราว์เซอร์บล็อก popup กรุณาอนุญาต popup"); return; }

  win.document.open();
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Preparing...</title></head><body style="font-family:Kanit, Arial, sans-serif;">⏳ กำลังเตรียมเอกสาร...</body></html>`);
  win.document.close();

  getApproverName(row.exec_by || row.approved_by)
    .catch(() => null)
    .then((approverName) => {
      try {
        const html = buildApprovalDocumentHtml(row, approverName);
        win.document.open();
        win.document.write(html);
        win.document.close();
        win.focus();
        setTimeout(() => {
          try { win.print(); } catch (e) { console.warn("[CEO] print failed:", e); }
        }, 700);
      } catch (e) {
        console.error("[CEO] downloadApprovalDocument error:", e);
        openApprovalDocument(row);
      }
    });
}

async function shareApprovalDocument(row) {
  if (!row) return;
  const type = normalizeApprovalType(row?.request_type);
  const externalShare = window.ApprovalDocument?.share;
  if (
    type === "claim" &&
    typeof externalShare === "function" &&
    externalShare !== shareApprovalDocument
  ) {
    try { await externalShare(row); return; }
    catch (e) { console.warn("[CEO] ApprovalDocument.share failed, fallback:", e); }
  }

  try {
    const approverName = await getApproverName(row.exec_by || row.approved_by).catch(() => null);
    const html = buildApprovalDocumentHtml(row, approverName);
    const blob = new Blob([html], { type: "text/html" });
    const fileName = `${getApprovalDocNo(row)}.html`;
    const file = new File([blob], fileName, { type: "text/html" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: `เอกสารอนุมัติ ${getApprovalDocNo(row)}`,
        text: `เอกสารอนุมัติ ${getApprovalDocNo(row)}`,
      });
      if (window.showToast) window.showToast("แชร์เอกสารเรียบร้อย", "success");
      else alert("แชร์เอกสารเรียบร้อย");
      return;
    }

    try {
      await navigator.clipboard.writeText(`${getApprovalDocNo(row)} — ดูเอกสารในระบบ`);
      if (window.showToast) window.showToast("คัดลอกข้อมูลเอกสารไปยังคลิปบอร์ดแล้ว", "info");
    } catch (_) {}

    openApprovalDocument(row);
  } catch (e) {
    console.error("[CEO] shareApprovalDocument error:", e);
    alert("แชร์เอกสารไม่สำเร็จ (อาจไม่รองรับในเบราว์เซอร์นี้)");
  }
}

/* ================================================================
   EXPORT EXCEL (CSV)
================================================================ */
function exportExecExcel() {
  if (!filteredExecClaims || filteredExecClaims.length === 0) {
    alert("ไม่มีข้อมูลที่จะ export");
    return;
  }

  const headers = [
    "เลขอ้างอิง", "วันที่ส่งคำขอ", "ประเภทงาน", "หัวข้อ", "รายละเอียด",
    "ผู้ขอ", "มูลค่า/วงเงิน", "ความเร่งด่วน", "สถานะ",
    "ความเห็นผู้บริหาร", "วันที่อนุมัติ/ปฏิเสธ",
  ];

  const rows = filteredExecClaims.map((row) => {
    const typeMeta = getApprovalTypeMeta(row.request_type);
    const amount = getApprovalAmount(row);
    return [
      getApprovalDocNo(row),
      formatDateTime(row.created_at),
      typeMeta.label,
      getApprovalTitle(row),
      getApprovalDetail(row),
      getRequesterText(row),
      amount !== "—" && amount ? formatMoney(amount) : "",
      row.priority || "normal",
      getExecText(row),
      getApprovalCommentValue(row),
      row.approved_at ? formatDateTime(row.approved_at) : "",
    ];
  });

  const csv =
    "\uFEFF" +
    [headers, ...rows]
      .map((row) =>
        row
          .map((cell) => {
            const text = String(cell ?? "");
            if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
            return text;
          })
          .join(",")
      )
      .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `executive-approval-center-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ================================================================
   LIGHTBOX
================================================================ */
function openLightbox(src) {
  const lb = document.getElementById("lightbox");
  const img = document.getElementById("lightboxImg");
  if (!lb || !img) return;
  img.src = src;
  lb.classList.add("open");
}

function closeLightbox() {
  const lb = document.getElementById("lightbox");
  const img = document.getElementById("lightboxImg");
  if (lb) lb.classList.remove("open");
  if (img) img.src = "";
}

/* ================================================================
   SIGNATURE PAD
================================================================ */
let _sigCtx = null;
let _sigDrawing = false;
let _sigHasInk = false;
let _sigBoundCanvas = null;

function initExecSignaturePad() {
  const canvas = document.getElementById("execSignaturePad");
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#000000";
  _sigCtx = ctx;
  _sigHasInk = false;

  if (_sigBoundCanvas === canvas) return;
  _sigBoundCanvas = canvas;

  const getPos = (e) => {
    const r = canvas.getBoundingClientRect();
    if (e.touches && e.touches[0]) {
      return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top };
    }
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const start = (e) => {
    if (!_sigCtx || isFinalized(currentExecClaim)) return;
    e.preventDefault();
    _sigDrawing = true;
    const p = getPos(e);
    _sigCtx.beginPath();
    _sigCtx.moveTo(p.x, p.y);
  };

  const move = (e) => {
    if (!_sigDrawing || !_sigCtx || isFinalized(currentExecClaim)) return;
    e.preventDefault();
    const p = getPos(e);
    _sigCtx.lineTo(p.x, p.y);
    _sigCtx.stroke();
    _sigHasInk = true;
  };

  const end = () => { _sigDrawing = false; };

  canvas.addEventListener("mousedown", start);
  canvas.addEventListener("mousemove", move);
  canvas.addEventListener("mouseup", end);
  canvas.addEventListener("mouseleave", end);
  canvas.addEventListener("touchstart", start, { passive: false });
  canvas.addEventListener("touchmove", move, { passive: false });
  canvas.addEventListener("touchend", end);
  canvas.addEventListener("touchcancel", end);
}

function clearExecSignature(force = false) {
  if (!force && isFinalized(currentExecClaim)) return;
  const canvas = document.getElementById("execSignaturePad");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  _sigHasInk = false;
}

function drawSavedSignature(signatureData) {
  const canvas = document.getElementById("execSignaturePad");
  if (!canvas || !signatureData) return;
  const ctx = canvas.getContext("2d");
  const img = new Image();
  img.onload = () => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  };
  img.onerror = () => console.warn("[CEO] failed to load saved signature image");
  img.src = signatureData;
}

function hasExecSignature() { return _sigHasInk; }

function getExecSignatureData() {
  const canvas = document.getElementById("execSignaturePad");
  if (!canvas) return null;
  try { return canvas.toDataURL("image/png"); }
  catch (e) { console.error("[CEO] canvas.toDataURL failed:", e); return null; }
}

/* ================================================================
   INIT
================================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  hydrateApprovalTypeFilter();