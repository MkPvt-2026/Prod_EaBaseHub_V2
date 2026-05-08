// ceo-approvals.js

const CLAIM_SCOPE_ALL = ["internal", "external"];

let allExecClaims = [];
let filteredExecClaims = [];
let currentExecClaim = null;

// Utility re-use จากไฟล์อื่น (คุณสามารถ import หรือ copy ฟังก์ชันเดิมได้)
function formatDate(d) {
  /* copy จากไฟล์เดิม */
}
function formatDateTime(d) {
  /* copy จากไฟล์เดิม */
}
function escapeHtml(v) {
  /* copy จากไฟล์เดิม */
}
function normalizeMediaUrls(v) {
  /* copy จากไฟล์เดิม */
}
function isVideo(url) {
  /* copy จากไฟล์เดิม */
}
function normalizeStatus(c) {
  return c.qc_status || "pending";
}
function getClaimNo(c) {
  const raw = c.claim_no || c.claim_code || c.id || "";
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

function buildStatusBadge(status) {
  const map = {

    pending: {
      label:"🔍 QC กำลังตรวจสอบ",
      cls:"in-progress"
    },

    waiting_ceo: {
      label:"⏳ รอ CEO",
      cls:"in-progress"
    },

    approved: {
      label:"✅ QC อนุมัติ",
      cls:"approved"
    },

    rejected: {
      label:"❌ QC ปฏิเสธ",
      cls:"rejected"
    },

    exec_approved: {
      label:"✅ CEO อนุมัติ",
      cls:"approved"
    },

    exec_rejected: {
      label:"❌ CEO ปฏิเสธ",
      cls:"rejected"
    },
  };

  const s = map[normalizeStatus(status)] || map.pending;

  return `
    <span class="status-badge ${s.cls}">
      ${s.label}
    </span>
  `;
}

function buildExecBadge(exec) {
  const map = {
    pending: { label: "รอ CEO", cls: "in-progress" },
    approved: { label: "CEO อนุมัติ", cls: "approved" },
    rejected: { label: "CEO ปฏิเสธ", cls: "rejected" },
  };
  const s = map[exec || "pending"];
  return `<span class="status-badge ${s.cls}">${s.label}</span>`;
}

// -------- Load data --------
async function loadExecClaims() {
  const tbody = document.getElementById("ceoTableBody");
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-loading"><span class="material-symbols-outlined spin">progress_activity</span>กำลังโหลด...</td></tr>`;
  }

  const { data, error } = await supabaseClient
    .from("claims")
    .select("*")
    .in("qc_status", ["waiting_ceo", "approved", "rejected"])
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    if (tbody)
      tbody.innerHTML = `<tr><td colspan="7" class="table-loading" style="color:#dc2626;">โหลดข้อมูลไม่สำเร็จ</td></tr>`;
    return;
  }

  allExecClaims = data || [];
  filteredExecClaims = [...allExecClaims];
  updateExecSummary();
  renderExecTable(filteredExecClaims);
}

function updateExecSummary() {
  const wait = allExecClaims.filter(
    (c) => c.exec_status === "pending" && c.qc_status === "waiting_ceo",
  ).length;
  const approved = allExecClaims.filter(
    (c) => c.exec_status === "approved",
  ).length;
  const rejected = allExecClaims.filter(
    (c) => c.exec_status === "rejected",
  ).length;
  document.getElementById("sumWaiting").textContent = wait;
  document.getElementById("sumExecApproved").textContent = approved;
  document.getElementById("sumExecRejected").textContent = rejected;
}

// -------- Filters --------
function applyFilters() {
  const search =
    document.getElementById("searchInput")?.value.toLowerCase().trim() || "";
  const scope = document.getElementById("filterScope")?.value || "";
  const execStatus = document.getElementById("filterExecStatus")?.value || "";
  const dateFrom = document.getElementById("filterDateFrom")?.value || "";
  const dateTo = document.getElementById("filterDateTo")?.value || "";

  filteredExecClaims = allExecClaims.filter((c) => {
    if (scope && c.claim_scope !== scope) return false;
    if (execStatus && c.exec_status !== execStatus) return false;
    if (dateFrom && c.claim_date < dateFrom) return false;
    if (dateTo && c.claim_date > dateTo) return false;

    if (search) {
      const text =
        `${c.emp_name || ""} ${c.customer || ""} ${c.product || ""} ${getClaimNo(c)}`.toLowerCase();
      if (!text.includes(search)) return false;
    }
    return true;
  });

  renderExecTable(filteredExecClaims);
}

function resetFilters() {
  [
    "searchInput",
    "filterScope",
    "filterExecStatus",
    "filterDateFrom",
    "filterDateTo",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = id === "filterExecStatus" ? "pending" : "";
  });
  filteredExecClaims = [...allExecClaims];
  renderExecTable(filteredExecClaims);
}

// -------- Render table --------
function renderExecTable(list) {
  const tbody = document.getElementById("ceoTableBody");
  if (!tbody) return;

  if (!list || list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-loading" style="color:#64748b;">ไม่มีรายการเคลมสำหรับ CEO</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  window._ceoClaims = {};

  list.forEach((c) => {
    window._ceoClaims[c.id] = c;
    const tr = document.createElement("tr");
    const scopeLabel =
      c.claim_scope === "internal" ? "เคลมภายใน" : "เคลมภายนอก";
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
      <td><div class="cell-date">${formatDate(c.claim_date)}</div><div class="cell-sub">${formatDateTime(c.created_at)}</div></td>
      <td>${scopeLabel}</td>
      <td>
        <div>${escapeHtml(c.emp_name) || "—"}</div>
        <div class="cell-sub">${escapeHtml(c.customer) || "—"}</div>
      </td>
      <td class="cell-product">
        <div>${escapeHtml(c.product) || "—"}</div>
        <div class="cell-sub">จำนวน: ${escapeHtml(c.qty) || "—"}</div>
      </td>
      <td>
        <div class="cell-sub">${gradeText || "—"}</div>
        <div class="cell-sub">เหตุ: ${escapeHtml(qcRes.defect_reason || "-")}</div>
      </td>
      <td>
        <div>${buildStatusBadge(c)}</div>
        <div class="cell-sub">${buildExecBadge(c.exec_status || "pending")}</div>
      </td>
      <td>
        <button class="btn-view" type="button" onclick="openCeoModal(window._ceoClaims['${c.id}'])">
          <span class="material-symbols-outlined" style="font-size:1rem;">open_in_new</span>ดู/อนุมัติ
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// -------- Modal CEO --------
function openCeoModal(claim) {
  if (!claim) return;
  currentExecClaim = claim;
  const modal = document.getElementById("ceoModal");
  modal.classList.add("open");

  document.getElementById("ceoModalTitle").textContent =
    `เคลม #${getClaimNo(claim)}`;

  const info = document.getElementById("ceoInfoGrid");
  const qcRes = claim.qc_result || {};
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
      <div>ผลการคัดแยก: ${gradeSummary || "ไม่ระบุ"}</div>
      <div>สาเหตุ: ${escapeHtml(qcRes.defect_reason || "-")}</div>
      <div>ผู้รับผิดชอบ: ${escapeHtml(qcRes.responsibility || "-")}</div>
      ${claim.qc_comment ? `<div style="margin-top:6px;color:#64748b;">หมายเหตุ QC: ${escapeHtml(claim.qc_comment)}</div>` : ""}
    `;
  }

  setTimeout(() => {
    initExecSignaturePad();
    clearExecSignature();
  }, 100);

  // set default decision ตาม exec_status ปัจจุบัน
  const decision = claim.exec_status || "pending";
  document.querySelectorAll("input[name='execDecision']").forEach((r) => {
    if (decision === "approved" && r.value === "approved") r.checked = true;
    else if (decision === "rejected" && r.value === "rejected")
      r.checked = true;
  });
  document.getElementById("execComment").value = claim.exec_comment || "";
}

function closeCeoModal() {
  const modal = document.getElementById("ceoModal");
  modal.classList.remove("open");
  currentExecClaim = null;
}

// -------- Save CEO decision --------
async function saveExecDecision() {
  if (!currentExecClaim) return;

  const decision =
    document.querySelector("input[name='execDecision']:checked")?.value ||
    "approved";

  const comment = document.getElementById("execComment")?.value.trim() || "";

  const signatureData = getExecSignatureData();

  if (!signatureData) {
    alert("กรุณาเซ็นชื่อก่อนบันทึกผลการพิจารณา");
    return;
  }

  if (
    !confirm(
      `ยืนยันการ${decision === "approved" ? "อนุมัติ" : "ปฏิเสธ"}เคลมนี้?`,
    )
  )
    return;

  try {
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();

    const { error } = await supabaseClient
      .from("claims")
      .update({
        exec_status: decision,

        qc_status: decision === "approved" ? "exec_approved" : "exec_rejected",

        exec_comment: comment || null,
        exec_signature: signatureData,

        exec_by: user?.id || null,
        exec_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", currentExecClaim.id);

    if (error) throw error;

    alert("บันทึกผลการพิจารณาแล้ว");
    closeCeoModal();
    await loadExecClaims();
  } catch (e) {
    console.error(e);
    alert("บันทึกไม่สำเร็จ: " + e.message);
  }
}

// -------- Init --------
document.addEventListener("DOMContentLoaded", async () => {
  const ready = await waitForSupabase();
  if (!ready) {
    alert("ไม่สามารถเชื่อมต่อ Supabase ได้");
    return;
  }

  if (typeof protectPage === "function") {
    await protectPage(["admin", "executive"]); // ปรับตาม role ที่คุณใช้
  }

  // bind filters
  [
    "searchInput",
    "filterScope",
    "filterExecStatus",
    "filterDateFrom",
    "filterDateTo",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", applyFilters);
    el.addEventListener("change", applyFilters);
  });

  await loadExecClaims();
});

function val(...items) {
  return items.find((v) => v !== undefined && v !== null && v !== "") || "—";
}

let execSignaturePad;
let isSigning = false;

function initExecSignaturePad() {
  const canvas = document.getElementById("execSignaturePad");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111827";
  }

  resizeCanvas();

  canvas.onmousedown = (e) => {
    isSigning = true;
    ctx.beginPath();
    ctx.moveTo(e.offsetX, e.offsetY);
  };

  canvas.onmousemove = (e) => {
    if (!isSigning) return;
    ctx.lineTo(e.offsetX, e.offsetY);
    ctx.stroke();
  };

  canvas.onmouseup = () => (isSigning = false);
  canvas.onmouseleave = () => (isSigning = false);

  canvas.ontouchstart = (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const t = e.touches[0];
    isSigning = true;
    ctx.beginPath();
    ctx.moveTo(t.clientX - rect.left, t.clientY - rect.top);
  };

  canvas.ontouchmove = (e) => {
    e.preventDefault();
    if (!isSigning) return;
    const rect = canvas.getBoundingClientRect();
    const t = e.touches[0];
    ctx.lineTo(t.clientX - rect.left, t.clientY - rect.top);
    ctx.stroke();
  };

  canvas.ontouchend = () => (isSigning = false);

  execSignaturePad = canvas;
}

function clearExecSignature() {
  const canvas = document.getElementById("execSignaturePad");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function getExecSignatureData() {
  const canvas = document.getElementById("execSignaturePad");
  if (!canvas) return null;
  return canvas.toDataURL("image/png");
}
