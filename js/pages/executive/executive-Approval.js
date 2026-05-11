// executive-Approval.js
// CEO approvals page — full script (รวมฟังก์ชันเปิดเอกสาร, ดาวน์โหลด, แชร์, signature pad)

const CLAIM_SCOPE_ALL = ["internal", "external"];

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

function escapeHtml(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeJsString(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
}

function val(...items) {
  return items.find((v) => v !== undefined && v !== null && v !== "") || "—";
}

function getClaimNo(c) {
  const raw = c?.claim_no || c?.claim_code || c?.claim_id || c?.id || "";
  return String(raw).substring(0, 8).toUpperCase() || "—";
}

function getApprovalDocNo(claim) {
  const year = new Date(claim?.exec_at || Date.now()).getFullYear();
  return `APP-${year}-${getClaimNo(claim)}`;
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
  if (_approverNameCache.has(userId)) {
    return _approverNameCache.get(userId);
  }

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
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();
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
    try {
      return JSON.parse(raw) || {};
    } catch (_) {
      return {};
    }
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

function getGradeSummary(qc) {
  return (
    getGradeRows(qc)
      .filter(([, , qty]) => Number(qty || 0) > 0)
      .map(([grade, label, qty]) => `${grade}: ${qty} (${label})`)
      .join(" | ") || "ไม่ระบุ"
  );
}

function getClaimTotalQty(claim) {
  const qc = getQcResult(claim);
  const totalFromQc = getGradeRows(qc).reduce(
    (sum, [, , qty]) => sum + Number(qty || 0),
    0
  );
  return totalFromQc || Number(claim?.qty || claim?.quantity || claim?.claim_qty || 0);
}

function buildStatusBadge(claim) {
  const exec = claim?.exec_status || "pending";
  if (exec === "approved") {
    return `<span class="status-badge approved">✅ CEO อนุมัติ</span>`;
  }
  if (exec === "rejected") {
    return `<span class="status-badge rejected">❌ CEO ปฏิเสธ</span>`;
  }
  return `<span class="status-badge waiting">⏳ รอ CEO พิจารณา</span>`;
}

function getExecText(claim) {
  if (claim?.exec_status === "approved") return "อนุมัติ";
  if (claim?.exec_status === "rejected") return "ปฏิเสธ";
  return "รอพิจารณา";
}

function isFinalized(claim) {
  return ["approved", "rejected"].includes(claim?.exec_status);
}

async function loadExecClaims() {
  const tbody = document.getElementById("ceoTableBody");
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="table-loading">
          <span class="material-symbols-outlined spin">progress_activity</span>
          กำลังโหลด...
        </td>
      </tr>`;
  }

  try {
    const { data, error } = await supabaseClient
      .from("claims")
      .select("*")
      .in("qc_status", CEO_VISIBLE_QC_STATUSES)
      .order("created_at", { ascending: false });

    if (error) throw error;

    allExecClaims = data || [];
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
  }
}

function updateExecSummary() {
  const wait = allExecClaims.filter((c) => !isFinalized(c)).length;
  const approved = allExecClaims.filter((c) => c.exec_status === "approved").length;
  const rejected = allExecClaims.filter((c) => c.exec_status === "rejected").length;

  const w = document.getElementById("sumWaiting");
  const a = document.getElementById("sumExecApproved");
  const r = document.getElementById("sumExecRejected");
  if (w) w.textContent = wait;
  if (a) a.textContent = approved;
  if (r) r.textContent = rejected;
}

function applyFilters() {
  const search = document.getElementById("searchInput")?.value.toLowerCase().trim() || "";
  const scope = document.getElementById("filterScope")?.value || "";
  const execStatus = document.getElementById("filterExecStatus")?.value || "";
  const dateFrom = document.getElementById("filterDateFrom")?.value || "";
  const dateTo = document.getElementById("filterDateTo")?.value || "";

  filteredExecClaims = allExecClaims.filter((c) => {
    if (scope && c.claim_scope !== scope) return false;

    if (execStatus) {
      const cur = c.exec_status || "pending";
      if (cur !== execStatus) return false;
    }

    if (dateFrom && c.claim_date && c.claim_date < dateFrom) return false;
    if (dateTo && c.claim_date && c.claim_date > dateTo) return false;

    if (search) {
      const text = `${c.emp_name || ""} ${c.customer || ""} ${c.product || ""} ${getClaimNo(c)}`.toLowerCase();
      if (!text.includes(search)) return false;
    }

    return true;
  });

  renderExecTable(filteredExecClaims);
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

function renderExecTable(list) {
  const tbody = document.getElementById("ceoTableBody");
  if (!tbody) return;

  _ceoClaimsCache.clear();

  if (!list || list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="table-loading" style="color:var(--muted);">
          <span class="material-symbols-outlined" style="font-size:32px;opacity:.5;">inbox</span>
          <div style="margin-top:8px;">ไม่มีรายการเคลมตามเงื่อนไขที่เลือก</div>
        </td>
      </tr>`;
    return;
  }

  const frag = document.createDocumentFragment();

  list.forEach((claim) => {
    _ceoClaimsCache.set(claim.id, claim);

    const tr = document.createElement("tr");
    const scopeLabel = claim.claim_scope === "internal" ? "เคลมภายใน" : "เคลมภายนอก";
    const qc = getQcResult(claim);

    tr.innerHTML = `
      <td>
        <div class="cell-date">${formatDate(claim.claim_date)}</div>
        <div class="cell-sub">${formatDateTime(claim.created_at)}</div>
      </td>
      <td><span class="scope-pill ${escapeHtml(claim.claim_scope || "")}">${scopeLabel}</span></td>
      <td>
        <div class="cell-strong">${escapeHtml(val(claim.emp_name, claim.created_by_name))}</div>
        <div class="cell-sub">${escapeHtml(val(claim.customer, claim.customer_name))}</div>
      </td>
      <td class="cell-product">
        <div class="cell-strong">${escapeHtml(val(claim.product, claim.product_name))}</div>
        <div class="cell-sub">จำนวน: ${escapeHtml(val(claim.qty, claim.quantity, claim.claim_qty))}</div>
      </td>
      <td>
        <div class="cell-strong">${escapeHtml(getGradeSummary(qc))}</div>
        <div class="cell-sub">เหตุ: ${escapeHtml(qc.defect_reason || "-")}</div>
      </td>
      <td>${buildStatusBadge(claim)} ${escapeHtml(claim.exec_status ? ` · ${claim.exec_status}` : "")}</td>
      <td>
        <div class="cell-action-group">
          <button class="btn-view" type="button" data-claim-id="${escapeHtml(claim.id)}">
            <span class="material-symbols-outlined" style="font-size:1rem;">open_in_new</span>
            ดู/อนุมัติ
          </button>
        </div>
      </td>
    `;

    tr.querySelector(".btn-view")?.addEventListener("click", (e) => {
      const id = e.currentTarget.getAttribute("data-claim-id");
      const cached = _ceoClaimsCache.get(id);
      if (cached) openCeoModal(cached);
    });

    frag.appendChild(tr);
  });

  tbody.innerHTML = "";
  tbody.appendChild(frag);
}

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

    const qcSection = document.getElementById("ceoQcSummary")?.closest(".modal-section");
    if (qcSection) qcSection.before(mediaSection);
    else modalBody.prepend(mediaSection);
  }

  if (!document.getElementById("approvalDocumentPreviewBtn")) {
    const footer = document.querySelector("#ceoModal .qc-action-btns");
    if (footer) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-filter-reset";
      btn.id = "approvalDocumentPreviewBtn";
      btn.innerHTML = `<span class="material-symbols-outlined">description</span> ดูเอกสารอนุมัติ`;
      btn.addEventListener("click", () => {
        if (currentExecClaim) openApprovalDocument(currentExecClaim);
      });
      footer.prepend(btn);
    }
  }
}

function renderMediaSection(claim) {
  const grid = document.getElementById("ceoMediaGrid");
  if (!grid) return;

  const urls = normalizeMediaUrls(val(claim.media_urls, claim.attachments, claim.files, ""));

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

function setApprovalFormState(claim) {
  const done = isFinalized(claim);

  document.querySelectorAll("input[name='execDecision']").forEach((radio) => {
    if (done) {
      radio.checked = radio.value === claim.exec_status;
    } else {
      radio.checked = false;
    }
    radio.disabled = done;
  });

  const comment = document.getElementById("execComment");
  if (comment) {
    comment.value = claim.exec_comment || "";
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

function openCeoModal(claim) {
  if (!claim) return;
  currentExecClaim = claim;
  ensureExecutiveSections();

  const modal = document.getElementById("ceoModal");
  if (!modal) return;

  modal.classList.add("open");
  document.body.style.overflow = "hidden";

  const title = document.getElementById("ceoModalTitle");
  if (title) title.textContent = `เคลม #${getClaimNo(claim)}`;

  const info = document.getElementById("ceoInfoGrid");
  if (info) {
    info.innerHTML = `
      <div class="info-row">
        <div class="info-label">เลขเคลม</div>
        <div class="info-value">${getClaimNo(claim)}</div>
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

  const qc = getQcResult(claim);
  const sumBox = document.getElementById("ceoQcSummary");
  if (sumBox) {
    const gradeRows = getGradeRows(qc)
      .map(([grade, label, qty]) => `
        <tr>
          <td>
            <label class="modal-check">
              <input
                type="checkbox"
                ${Number(qty || 0) > 0 ? "checked" : ""}
                disabled
              >
              <span>${grade}</span>
            </label>
          </td>
          <td>${escapeHtml(label)}</td>
          <td style="text-align:right;">${Number(qty || 0).toLocaleString()}</td>
        </tr>`)
      .join("");

    const defectReason = qc.defect_reason || "-";
    const responsibility = qc.responsibility || "-";
    const qcComment = String(val(claim.qc_comment, qc.comment, "-"));

    sumBox.innerHTML = `
      <div class="document-block">
        <div class="doc-headline">สรุปผลตรวจ QC เพื่อประกอบการอนุมัติ</div>
        <table class="qc-doc-table">
          <thead>
            <tr>
              <th>เกรด</th>
              <th>คำอธิบาย</th>
              <th style="text-align:right;">จำนวน</th>
            </tr>
          </thead>
          <tbody>${gradeRows}</tbody>
        </table>

        <div class="qc-detail-grid">
          <div class="qc-detail-card">
            <div class="qc-detail-label">
              <span class="material-symbols-outlined">error</span>
              สาเหตุหลัก
            </div>
            <div class="qc-detail-value">${escapeHtml(defectReason)}</div>
          </div>
          <div class="qc-detail-card">
            <div class="qc-detail-label">
              <span class="material-symbols-outlined">badge</span>
              ผู้รับผิดชอบ
            </div>
            <div class="qc-detail-value">${escapeHtml(responsibility)}</div>
          </div>
          <div class="qc-detail-card full">
            <div class="qc-detail-label">
              <span class="material-symbols-outlined">comment</span>
              ความเห็น QC
            </div>
            <div class="qc-detail-value">${escapeHtml(qcComment)}</div>
          </div>
        </div>
      </div>
    `;
  }

  renderMediaSection(claim);
  setApprovalFormState(claim);

  requestAnimationFrame(() => {
    initExecSignaturePad();

    if (claim.exec_signature && isFinalized(claim)) {
      drawSavedSignature(claim.exec_signature);
    } else {
      clearExecSignature(true);
    }
  });
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

async function saveExecDecision() {
  if (!currentExecClaim) return;
  if (isFinalized(currentExecClaim)) {
    alert("เคลมนี้ผ่านการพิจารณาแล้ว ไม่สามารถบันทึกซ้ำได้");
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

  if (!confirm(`ยืนยันการ${decision === "approved" ? "อนุมัติ" : "ปฏิเสธ"}เคลมนี้?`)) return;

  const saveBtn = document.querySelector(".btn-save-draft");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.classList.add("loading");
  }

  try {
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();

    const now = new Date().toISOString();

    const updatePayload = {
      exec_status: decision,
      qc_status: decision === "approved" ? "exec_approved" : "exec_rejected",
      exec_comment: comment || null,
      exec_signature: signatureData,
      exec_by: user?.id || null,
      exec_at: now,
      updated_at: now,
    };

    const { data: updated, error } = await supabaseClient
      .from("claims")
      .update(updatePayload)
      .eq("id", currentExecClaim.id)
      .select();

    if (error) throw error;

    if (!updated || updated.length === 0) {
      throw new Error("ไม่สามารถบันทึกได้ อาจเกิดจาก RLS policy หรือไม่พบ id เคลมนี้");
    }

    const approvedClaim = updated[0];
    alert("✅ บันทึกผลการพิจารณาเรียบร้อย");

    openApprovalDocument(approvedClaim);
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

function buildApprovalDocumentHtml(claim, approverName) {
  const qc = getQcResult(claim);
  const docNo = getApprovalDocNo(claim);
  const statusText = claim.exec_status === "approved" ? "อนุมัติ" : "ปฏิเสธ";
  const statusClass = claim.exec_status === "approved" ? "approved" : "rejected";
  const finalApprover = approverName && approverName.trim() ? approverName.trim() : "CEO / Executive";

  const gradeRows = getGradeRows(qc)
    .map(
      ([grade, label, qty]) => `
    <tr>
      <td>
        <label class="pdf-check">
          <input type="checkbox" ${Number(qty || 0) > 0 ? "checked" : ""} disabled>
          <span>${grade}</span>
        </label>
      </td>
      <td>${escapeHtml(label)}</td>
      <td class="num">${Number(qty || 0).toLocaleString()}</td>
    </tr>`
    )
    .join("");

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
      color: #0f172a;
      background: #e2e8f0;
      font-size: 11.5px;
      line-height: 1.4;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      min-height: 100vh;
      padding: 20px 0 40px;
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
    .value { font-weight:600; color:#0f172a; font-size:11.5px; word-break:break-word; }
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
        <h1>ใบอนุมัติการเคลมสินค้า</h1>
        <p>Claim Approval Document · EABaseHub</p>
      </div>
      <div class="doc-no">
        <div>เลขที่เอกสาร</div>
        <strong>${escapeHtml(docNo)}</strong>
        <span class="status ${statusClass}">${statusText}</span>
      </div>
    </div>

    <div class="grid">
      <div class="box"><div class="label">เลขเคลม</div><div class="value">${escapeHtml(getClaimNo(claim))}</div></div>
      <div class="box"><div class="label">วันที่อนุมัติ</div><div class="value">${escapeHtml(formatDateTime(claim.exec_at))}</div></div>
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

    <h2>ผลการพิจารณาผู้บริหาร</h2>
    <div class="approval">
      <div class="approval-row"><strong>ผลการพิจารณา:</strong> ${statusText}</div>
      <div class="approval-row"><strong>หมายเหตุ / เงื่อนไข:</strong> ${escapeHtml(claim.exec_comment || "-")}</div>
      <div class="signature-row">
        <div class="signature-wrap">
          <div class="label">ลายเซ็นผู้บริหาร</div>
          <div class="signature-box">${claim.exec_signature ? `<img src="${escapeHtml(claim.exec_signature)}" alt="signature">` : `<span class="no-sig">ไม่มีลายเซ็น</span>`}</div>
        </div>
        <div class="approver-stack">
          <div class="box">
            <div class="label">ผู้อนุมัติ</div>
            <div class="value">${escapeHtml(finalApprover)}</div>
          </div>
          <div class="box">
            <div class="label">วันที่และเวลา</div>
            <div class="value">${escapeHtml(formatDateTime(claim.exec_at))}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="footer">
      <span>Generated by EABaseHub</span>
      <span>${escapeHtml(docNo)}</span>
    </div>
  </div>
</body>
</html>`;
}

async function openApprovalDocument(claim) {
  if (!claim) return;

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
    const approverName = await getApproverName(claim.exec_by);
    const html = buildApprovalDocumentHtml(claim, approverName);
    win.document.open();
    win.document.write(html);
    win.document.close();
  } catch (e) {
    console.error("[CEO] openApprovalDocument error:", e);
    const html = buildApprovalDocumentHtml(claim, null);
    win.document.open();
    win.document.write(html);
    win.document.close();
  }
}

function downloadApprovalDocument(claim) {
  if (!claim) return;
  const win = window.open("", "_blank");
  if (!win) {
    alert("เบราว์เซอร์บล็อก popup กรุณาอนุญาต popup");
    return;
  }
  win.document.open();
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Preparing...</title></head><body style="font-family:Kanit, Arial, sans-serif;">⏳ กำลังเตรียมเอกสาร...</body></html>`);
  win.document.close();

  getApproverName(claim.exec_by).catch(() => null).then((approverName) => {
    try {
      const html = buildApprovalDocumentHtml(claim, approverName);
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => {
        try { win.print(); } catch (e) { console.warn("[CEO] print failed:", e); }
      }, 700);
    } catch (e) {
      console.error("[CEO] downloadApprovalDocument error:", e);
      openApprovalDocument(claim);
    }
  });
}

async function shareApprovalDocument(claim) {
  if (!claim) return;
  try {
    const approverName = await getApproverName(claim.exec_by).catch(() => null);
    const html = buildApprovalDocumentHtml(claim, approverName);
    const blob = new Blob([html], { type: "text/html" });
    const fileName = `${getApprovalDocNo(claim)}.html`;
    const file = new File([blob], fileName, { type: "text/html" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: `เอกสารอนุมัติ ${getApprovalDocNo(claim)}`,
        text: `ใบอนุญาตเคลม ${getApprovalDocNo(claim)}`,
      });
      if (window.showToast) window.showToast("แชร์เอกสารเรียบร้อย", "success");
      else alert("แชร์เอกสารเรียบร้อย");
      return;
    }

    try { await navigator.clipboard.writeText(`${getApprovalDocNo(claim)} — ดูเอกสารในระบบ`); if (window.showToast) window.showToast("คัดลอกข้อมูลเอกสารไปยังคลิปบอร์ดแล้ว", "info"); } catch (_) {}
    openApprovalDocument(claim);
  } catch (e) {
    console.error("[CEO] shareApprovalDocument error:", e);
    alert("แชร์เอกสารไม่สำเร็จ (อาจไม่รองรับในเบราว์เซอร์นี้)");
  }
}

// CSV/Excel export for CEO page
function exportExecExcel() {
  if (!filteredExecClaims || filteredExecClaims.length === 0) {
    alert("ไม่มีข้อมูลที่จะ export");
    return;
  }

  const headers = [
    "เลขเคลม",
    "วันที่แจ้ง",
    "ประเภทเคลม",
    "ผู้แจ้ง",
    "ลูกค้า",
    "สินค้า",
    "จำนวน",
    "ผลการคัดแยก (QC)",
    "สาเหตุ",
    "สถานะ QC",
    "สถานะ CEO",
    "ความเห็น CEO",
    "วันที่อนุมัติ/ปฏิเสธ",
  ];

  const rows = filteredExecClaims.map((claim) => {
    const qc = getQcResult(claim);
    return [
      getClaimNo(claim),
      formatDate(claim.claim_date),
      claim.claim_scope === "internal" ? "เคลมภายใน" : "เคลมภายนอก",
      val(claim.emp_name, claim.created_by_name),
      val(claim.customer, claim.customer_name),
      val(claim.product, claim.product_name),
      val(claim.qty, claim.quantity),
      getGradeSummary(qc),
      qc.defect_reason || "",
      claim.qc_status || "",
      claim.exec_status || "pending",
      claim.exec_comment || "",
      claim.exec_at ? formatDateTime(claim.exec_at) : "",
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
  a.download = `ceo-approvals-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Lightbox used also by this page
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

// Signature pad
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

  const end = () => {
    _sigDrawing = false;
  };

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
  img.onerror = () => {
    console.warn("[CEO] failed to load saved signature image");
  };
  img.src = signatureData;
}

function hasExecSignature() {
  return _sigHasInk;
}

function getExecSignatureData() {
  const canvas = document.getElementById("execSignaturePad");
  if (!canvas) return null;
  try {
    return canvas.toDataURL("image/png");
  } catch (e) {
    console.error("[CEO] canvas.toDataURL failed:", e);
    return null;
  }
}

function injectExecutiveApprovalStyles() {
  if (document.getElementById("executive-approval-extra-styles")) return;

  const style = document.createElement("style");
  style.id = "executive-approval-extra-styles";
  style.textContent = `
    .ceo-media-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
      gap: 10px;
    }

    .media-thumb,
    .media-file {
      min-height: 92px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: var(--bg-soft);
      overflow: hidden;
      cursor: pointer;
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      gap: 6px;
      font-family: inherit;
      font-size: 13px;
      padding: 6px;
      transition: border-color .15s ease, transform .15s ease;
    }

    .media-thumb:hover,
    .media-file:hover {
      border-color: var(--ceo-light);
      transform: translateY(-1px);
    }

    .media-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .document-block {
      display: grid;
      gap: 12px;
    }

    .doc-headline {
      font-weight: 700;
      color: var(--text-strong);
    }

    .qc-doc-table {
      width: 100%;
      border-collapse: collapse;
      overflow: hidden;
      border-radius: 12px;
    }

    .qc-doc-table th,
    .qc-doc-table td {
      border: 1px solid var(--border);
      padding: 9px 10px;
      font-size: 13px;
    }

    .qc-doc-table th {
      background: var(--ceo-soft);
      color: var(--ceo-main);
      text-align: left;
    }

    .modal-check {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
    }

    .modal-check input {
      width: 16px;
      height: 16px;
      accent-color: var(--ceo-main);
    }

    .qc-detail-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-top: 4px;
    }

    .qc-detail-card {
      background: var(--bg-soft);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px 14px;
      transition: border-color .15s ease, background .15s ease;
    }

    .qc-detail-card.full {
      grid-column: 1 / -1;
    }

    .qc-detail-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 6px;
      font-weight: 500;
    }

    .qc-detail-label .material-symbols-outlined {
      font-size: 16px;
      color: var(--ceo-main);
    }

    [data-theme="dark"] .qc-detail-label .material-symbols-outlined {
      color: var(--ceo-light);
    }

    .qc-detail-value {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-strong);
      line-height: 1.6;
      word-break: break-word;
      white-space: pre-wrap;
    }

    @media (max-width: 600px) {
      .qc-detail-grid {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.appendChild(style);
}

document.addEventListener("DOMContentLoaded", async () => {
  injectExecutiveApprovalStyles();

  const ready = await waitForSupabase();
  if (!ready) {
    alert("ไม่สามารถเชื่อมต่อ Supabase ได้");
    return;
  }

  if (typeof protectPage === "function") {
    await protectPage(["admin", "executive", "ceo"]);
  }

  ["searchInput", "filterScope", "filterExecStatus", "filterDateFrom", "filterDateTo"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", applyFilters);
    el.addEventListener("change", applyFilters);
  });

  const modal = document.getElementById("ceoModal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeCeoModal();
    });
  }

  window.addEventListener("resize", () => {
    const modalEl = document.getElementById("ceoModal");
    if (modalEl?.classList.contains("open") && currentExecClaim) {
      const canvas = document.getElementById("execSignaturePad");
      const wasFinalized = isFinalized(currentExecClaim);
      if (canvas && wasFinalized && currentExecClaim.exec_signature) {
        initExecSignaturePad();
        drawSavedSignature(currentExecClaim.exec_signature);
      }
    }
  });

  await loadExecClaims();
});

// Expose functions to global scope for use by other scripts
window.resetFilters = resetFilters;
window.exportExecExcel = exportExecExcel;
window.closeCeoModal = closeCeoModal;
window.saveExecDecision = saveExecDecision;
window.clearExecSignature = clearExecSignature;
window.closeLightbox = closeLightbox;
window.openLightbox = openLightbox;
window.openApprovalDocument = openApprovalDocument;

// Provide small API used by external-claims.js
window.ApprovalDocument = window.ApprovalDocument || {};
window.ApprovalDocument.open = window.ApprovalDocument.open || openApprovalDocument;
window.ApprovalDocument.download = window.ApprovalDocument.download || downloadApprovalDocument;
window.ApprovalDocument.share = window.ApprovalDocument.share || shareApprovalDocument;