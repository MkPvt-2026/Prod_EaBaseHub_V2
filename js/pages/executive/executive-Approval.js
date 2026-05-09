// ============================================================
//  CEO APPROVALS PAGE - executive-Approval.js
//  ✅ Debug-friendly + รองรับ qc_status หลายแบบ
// ============================================================

const CLAIM_SCOPE_ALL = ["internal", "external"];

// ✅ ค่า status ทั้งหมดที่อาจอยู่ใน DB ตอนรอ/ผ่านมือ CEO แล้ว
//    ปรับตรงนี้ให้ตรงกับ DB จริงของคุณ
const CEO_VISIBLE_STATUSES = [
  "waiting_ceo",       // QC ส่งให้ CEO
  "exec_approved",     // CEO อนุมัติแล้ว (flow ใหม่)
  "exec_rejected",     // CEO ปฏิเสธแล้ว (flow ใหม่)
  "approved",          // เผื่อ DB ใช้ค่าเดิม
  "rejected",          // เผื่อ DB ใช้ค่าเดิม
];

let allExecClaims = [];
let filteredExecClaims = [];
let currentExecClaim = null;

// ============================================================
//  UTILITIES
// ============================================================
function formatDate(d) {
  if (!d) return "—";
  try {
    const date = new Date(d);
    if (isNaN(date)) return "—";
    return date.toLocaleDateString("th-TH", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

function formatDateTime(d) {
  if (!d) return "—";
  try {
    const date = new Date(d);
    if (isNaN(date)) return "—";
    return date.toLocaleString("th-TH", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
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

function val(...items) {
  return items.find((v) => v !== undefined && v !== null && v !== "") || "—";
}

function getClaimNo(c) {
  const raw = c?.claim_no || c?.claim_code || c?.id || "";
  return String(raw).substring(0, 8).toUpperCase();
}

async function waitForSupabase() {
  let i = 0;
  while (typeof supabaseClient === "undefined" && i < 50) {
    await new Promise((r) => setTimeout(r, 100));
    i++;
  }
  return typeof supabaseClient !== "undefined";
}

// ============================================================
//  STATUS BADGES
// ============================================================
// แสดงสถานะ badge เดียว — ใช้ exec_status เป็นแหล่งความจริง
function buildStatusBadge(claim) {
  const exec = claim?.exec_status;

  if (exec === "approved") {
    return `<span class="status-badge approved">✅ CEO อนุมัติ</span>`;
  }
  if (exec === "rejected") {
    return `<span class="status-badge rejected">❌ CEO ปฏิเสธ</span>`;
  }
  // ยังไม่ตัดสินใจ → รอ CEO
  return `<span class="status-badge waiting">⏳ รอ CEO พิจารณา</span>`;
}

// ============================================================
//  LOAD DATA
// ============================================================
async function loadExecClaims() {
  const tbody = document.getElementById("ceoTableBody");
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-loading"><span class="material-symbols-outlined spin">progress_activity</span>กำลังโหลด...</td></tr>`;
  }

  try {
    const { data, error } = await supabaseClient
      .from("claims")
      .select("*")
      .in("qc_status", CEO_VISIBLE_STATUSES)
      .order("created_at", { ascending: false });

    if (error) throw error;

    allExecClaims = data || [];
    console.log(
      `[CEO] โหลด ${allExecClaims.length} รายการ`,
      allExecClaims.map((c) => ({
        id: getClaimNo(c),
        qc_status: c.qc_status,
        exec_status: c.exec_status,
      })),
    );

    updateExecSummary();
    applyFilters();
  } catch (err) {
    console.error("loadExecClaims error:", err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" class="table-loading" style="color:var(--danger);">โหลดข้อมูลไม่สำเร็จ: ${escapeHtml(err.message || err)}</td></tr>`;
    }
  }
}

function updateExecSummary() {
  const wait = allExecClaims.filter(
    (c) =>
      (c.exec_status || "pending") === "pending" &&
      (c.qc_status === "waiting_ceo" || c.qc_status === "approved"),
  ).length;
  const approved = allExecClaims.filter((c) => c.exec_status === "approved").length;
  const rejected = allExecClaims.filter((c) => c.exec_status === "rejected").length;

  const w = document.getElementById("sumWaiting");
  const a = document.getElementById("sumExecApproved");
  const r = document.getElementById("sumExecRejected");
  if (w) w.textContent = wait;
  if (a) a.textContent = approved;
  if (r) r.textContent = rejected;
}

// ============================================================
//  FILTERS
// ============================================================
function applyFilters() {
  const search =
    document.getElementById("searchInput")?.value.toLowerCase().trim() || "";
  const scope = document.getElementById("filterScope")?.value || "";
  const execStatus = document.getElementById("filterExecStatus")?.value;
  const dateFrom = document.getElementById("filterDateFrom")?.value || "";
  const dateTo = document.getElementById("filterDateTo")?.value || "";

  filteredExecClaims = allExecClaims.filter((c) => {
    if (scope && c.claim_scope !== scope) return false;

    if (execStatus !== undefined && execStatus !== "") {
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
    filterExecStatus: "", // "" = ทั้งหมด
    filterDateFrom: "",
    filterDateTo: "",
  };
  Object.entries(defaults).forEach(([id, v]) => {
    const el = document.getElementById(id);
    if (el) el.value = v;
  });
  applyFilters();
}

// ============================================================
//  RENDER TABLE
// ============================================================
const _ceoClaimsCache = new Map();

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

  list.forEach((c) => {
    _ceoClaimsCache.set(c.id, c);

    const tr = document.createElement("tr");
    const scopeLabel = c.claim_scope === "internal" ? "เคลมภายใน" : "เคลมภายนอก";
    const qcRes = c.qc_result || {};
    const gradeText = [
      qcRes.grade_a_qty ? `A:${qcRes.grade_a_qty}` : "",
      qcRes.grade_b_qty ? `B:${qcRes.grade_b_qty}` : "",
      qcRes.grade_r_qty ? `R:${qcRes.grade_r_qty}` : "",
      qcRes.grade_s_qty ? `S:${qcRes.grade_s_qty}` : "",
      qcRes.grade_c_qty ? `C:${qcRes.grade_c_qty}` : "",
    ]
      .filter(Boolean)
      .join(" / ");

    tr.innerHTML = `
      <td>
        <div class="cell-date">${formatDate(c.claim_date)}</div>
        <div class="cell-sub">${formatDateTime(c.created_at)}</div>
      </td>
      <td><span class="scope-pill ${c.claim_scope || ""}">${scopeLabel}</span></td>
      <td>
        <div class="cell-strong">${escapeHtml(val(c.emp_name, c.created_by_name))}</div>
        <div class="cell-sub">${escapeHtml(val(c.customer, c.customer_name))}</div>
      </td>
      <td class="cell-product">
        <div class="cell-strong">${escapeHtml(val(c.product, c.product_name))}</div>
        <div class="cell-sub">จำนวน: ${escapeHtml(val(c.qty, c.quantity))}</div>
      </td>
      <td>
        <div class="cell-strong">${escapeHtml(gradeText || "—")}</div>
        <div class="cell-sub">เหตุ: ${escapeHtml(qcRes.defect_reason || "-")}</div>
      </td>
      <td>
        ${buildStatusBadge(c)}
      </td>
      <td>
        <button class="btn-view" type="button" data-claim-id="${escapeHtml(c.id)}">
          <span class="material-symbols-outlined" style="font-size:1rem;">open_in_new</span>
          ดู/อนุมัติ
        </button>
      </td>
    `;

    tr.querySelector(".btn-view")?.addEventListener("click", (e) => {
      const id = e.currentTarget.getAttribute("data-claim-id");
      const claim = _ceoClaimsCache.get(id);
      if (claim) openCeoModal(claim);
    });

    frag.appendChild(tr);
  });

  tbody.innerHTML = "";
  tbody.appendChild(frag);
}

// ============================================================
//  MODAL
// ============================================================
function openCeoModal(claim) {
  if (!claim) return;
  currentExecClaim = claim;
  const modal = document.getElementById("ceoModal");
  if (!modal) return;
  modal.classList.add("open");
  document.body.style.overflow = "hidden";

  document.getElementById("ceoModalTitle").textContent = `เคลม #${getClaimNo(claim)}`;

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
        <div class="info-label">จำนวน</div>
        <div class="info-value">${escapeHtml(val(claim.qty, claim.quantity, claim.claim_qty))}</div>
      </div>
      <div class="info-row">
        <div class="info-label">ล็อต / รหัสสินค้า</div>
        <div class="info-value">${escapeHtml(val(claim.lot_no, claim.product_code, claim.item_code))}</div>
      </div>
      <div class="info-row full">
        <div class="info-label">รายละเอียดปัญหาที่แจ้ง</div>
        <div class="info-value">${escapeHtml(val(claim.detail, claim.claim_detail, claim.problem_detail, claim.description))}</div>
      </div>
      <div class="info-row full">
        <div class="info-label">ข้อเสนอจาก QC</div>
        <div class="info-value">${escapeHtml(val(claim.qc_comment, claim.qc_note, claim.remark))}</div>
      </div>
    `;
  }

  const qcRes = claim.qc_result || {};
  const gradeSummary = [
    qcRes.grade_a_qty ? `A: ${qcRes.grade_a_qty}` : "",
    qcRes.grade_b_qty ? `B: ${qcRes.grade_b_qty}` : "",
    qcRes.grade_r_qty ? `R: ${qcRes.grade_r_qty}` : "",
    qcRes.grade_s_qty ? `S: ${qcRes.grade_s_qty}` : "",
    qcRes.grade_c_qty ? `C: ${qcRes.grade_c_qty}` : "",
  ]
    .filter(Boolean)
    .join(" | ");

  const sumBox = document.getElementById("ceoQcSummary");
  if (sumBox) {
    sumBox.innerHTML = `
      <div class="qc-summary-row"><strong>ผลการคัดแยก:</strong> ${escapeHtml(gradeSummary || "ไม่ระบุ")}</div>
      <div class="qc-summary-row"><strong>สาเหตุ:</strong> ${escapeHtml(qcRes.defect_reason || "-")}</div>
      <div class="qc-summary-row"><strong>ผู้รับผิดชอบ:</strong> ${escapeHtml(qcRes.responsibility || "-")}</div>
      ${claim.qc_comment ? `<div class="qc-summary-row" style="margin-top:6px;color:var(--muted);"><strong>หมายเหตุ QC:</strong> ${escapeHtml(claim.qc_comment)}</div>` : ""}
    `;
  }

  const decision = claim.exec_status === "rejected" ? "rejected" : "approved";
  document.querySelectorAll("input[name='execDecision']").forEach((r) => {
    r.checked = r.value === decision;
  });

  const cmt = document.getElementById("execComment");
  if (cmt) cmt.value = claim.exec_comment || "";

  requestAnimationFrame(() => {
    initExecSignaturePad();
    clearExecSignature();
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

// ============================================================
//  ✅ SAVE DECISION (verbose debug + RLS check)
// ============================================================
async function saveExecDecision() {
  if (!currentExecClaim) return;

  const decision =
    document.querySelector("input[name='execDecision']:checked")?.value || "approved";

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

  if (!confirm(`ยืนยันการ${decision === "approved" ? "อนุมัติ" : "ปฏิเสธ"}เคลมนี้?`)) {
    return;
  }

  const saveBtn = document.querySelector(".btn-save-draft");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.classList.add("loading");
  }

  try {
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();

    const updatePayload = {
      exec_status: decision,
      qc_status: decision === "approved" ? "exec_approved" : "exec_rejected",
      exec_comment: comment || null,
      exec_signature: signatureData,
      exec_by: user?.id || null,
      exec_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    console.log("[CEO] กำลังอัปเดตเคลม:", currentExecClaim.id);
    console.log("[CEO] payload:", { ...updatePayload, exec_signature: "(base64 truncated)" });

    // ✅ ใช้ .select() ต่อท้าย — บังคับให้คืน row ที่ถูกอัปเดตจริง
    //    ถ้า RLS บล็อก จะคืน [] แทนที่จะเป็น error
    const { data: updated, error } = await supabaseClient
      .from("claims")
      .update(updatePayload)
      .eq("id", currentExecClaim.id)
      .select();

    if (error) {
      console.error("[CEO] ❌ Supabase error:", error);
      throw error;
    }

    console.log("[CEO] ✅ updated rows:", updated);

    // ✅ ถ้า array ว่าง = RLS บล็อก หรือ id ไม่ match
    if (!updated || updated.length === 0) {
      throw new Error(
        "ไม่สามารถบันทึกได้ — อาจเป็นเพราะสิทธิ์ของผู้ใช้ (RLS policy) ไม่อนุญาตให้แก้ไข\n" +
          "หรือไม่พบเคลม id นี้ในตาราง claims\n\n" +
          "วิธีตรวจ:\n" +
          "1) เปิด Supabase Dashboard → Authentication → ดู role ของ user ปัจจุบัน\n" +
          "2) Table Editor → claims → Policies → ตรวจ UPDATE policy\n" +
          "3) ลอง query test ใน SQL Editor:\n" +
          "   UPDATE claims SET exec_status='approved' WHERE id='" +
          currentExecClaim.id +
          "' RETURNING *;",
      );
    }

    alert("✅ บันทึกผลการพิจารณาเรียบร้อย");
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

// ============================================================
//  EXPORT EXCEL
// ============================================================
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

  const rows = filteredExecClaims.map((c) => {
    const qc = c.qc_result || {};
    const grades = [
      qc.grade_a_qty ? `A:${qc.grade_a_qty}` : "",
      qc.grade_b_qty ? `B:${qc.grade_b_qty}` : "",
      qc.grade_r_qty ? `R:${qc.grade_r_qty}` : "",
      qc.grade_s_qty ? `S:${qc.grade_s_qty}` : "",
      qc.grade_c_qty ? `C:${qc.grade_c_qty}` : "",
    ]
      .filter(Boolean)
      .join(" / ");

    return [
      getClaimNo(c),
      formatDate(c.claim_date),
      c.claim_scope === "internal" ? "เคลมภายใน" : "เคลมภายนอก",
      val(c.emp_name, c.created_by_name),
      val(c.customer, c.customer_name),
      val(c.product, c.product_name),
      val(c.qty, c.quantity),
      grades,
      qc.defect_reason || "",
      c.qc_status || "",
      c.exec_status || "pending",
      c.exec_comment || "",
      c.exec_at ? formatDateTime(c.exec_at) : "",
    ];
  });

  const csv =
    "\uFEFF" +
    [headers, ...rows]
      .map((r) =>
        r
          .map((cell) => {
            const s = String(cell ?? "");
            if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
            return s;
          })
          .join(","),
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

// ============================================================
//  LIGHTBOX
// ============================================================
function openLightbox(src) {
  const lb = document.getElementById("lightbox");
  const img = document.getElementById("lightboxImg");
  if (!lb || !img) return;
  img.src = src;
  lb.classList.add("open");
}

function closeLightbox() {
  const lb = document.getElementById("lightbox");
  if (lb) lb.classList.remove("open");
}

// ============================================================
//  SIGNATURE PAD
// ============================================================
let _sigCtx = null;
let _sigDrawing = false;
let _sigHasInk = false;
let _sigInitialized = false;

function initExecSignaturePad() {
  const canvas = document.getElementById("execSignaturePad");
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#0f172a";
  _sigCtx = ctx;
  _sigHasInk = false;

  if (_sigInitialized) return;
  _sigInitialized = true;

  const getPos = (e) => {
    const r = canvas.getBoundingClientRect();
    if (e.touches && e.touches[0]) {
      return {
        x: e.touches[0].clientX - r.left,
        y: e.touches[0].clientY - r.top,
      };
    }
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const start = (e) => {
    e.preventDefault();
    if (!_sigCtx) return;
    _sigDrawing = true;
    const p = getPos(e);
    _sigCtx.beginPath();
    _sigCtx.moveTo(p.x, p.y);
  };
  const move = (e) => {
    if (!_sigDrawing || !_sigCtx) return;
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

function clearExecSignature() {
  const canvas = document.getElementById("execSignaturePad");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  _sigHasInk = false;
}

function hasExecSignature() {
  return _sigHasInk;
}

function getExecSignatureData() {
  const canvas = document.getElementById("execSignaturePad");
  if (!canvas) return null;
  return canvas.toDataURL("image/png");
}

// ============================================================
//  INIT
// ============================================================
document.addEventListener("DOMContentLoaded", async () => {
  const ready = await waitForSupabase();
  if (!ready) {
    alert("ไม่สามารถเชื่อมต่อ Supabase ได้");
    return;
  }

  if (typeof protectPage === "function") {
    await protectPage(["admin", "executive"]);
  }

  ["searchInput", "filterScope", "filterExecStatus", "filterDateFrom", "filterDateTo"].forEach(
    (id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", applyFilters);
      el.addEventListener("change", applyFilters);
    },
  );

  const modal = document.getElementById("ceoModal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeCeoModal();
    });
  }

  await loadExecClaims();
});

window.resetFilters = resetFilters;
window.exportExecExcel = exportExecExcel;
window.closeCeoModal = closeCeoModal;
window.saveExecDecision = saveExecDecision;
window.clearExecSignature = clearExecSignature;
window.closeLightbox = closeLightbox;
window.openLightbox = openLightbox;