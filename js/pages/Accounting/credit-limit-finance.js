/* ================================================================
   CREDIT LIMIT ACCOUNTING REVIEW — credit-limit-accounting.js
   Role: accounting / manager / executive / admin
   Features:
     • Auth guard with role & status check
     • Load / filter / search approval_requests
     • Accordion cards built from renderAccountingCard()
     • Private PDF upload → Supabase Storage
     • Save draft / forward to manager / send back to Sale
     • Toast notifications (replaces alert / confirm)
     • Mobile sidebar open/close
================================================================ */

"use strict";

let currentUser    = null;
let currentProfile = null;
let allRequests    = [];
let activeFilter   = "accounting_review";

const BUCKET_NAME    = "approval-financial-docs";
const ACTIVE_STATUSES = ["pending", "accounting_review", "manager_review", "revision_required"];

/* ── Bootstrap ─────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await initAuthAndProfile();
    await loadAccountingRequests();
    wireLogoutButton();
  } catch (err) {
    console.error("Accounting page init error:", err);
    showToast("โหลดหน้าบัญชีไม่สำเร็จ: " + (err.message || err), "error");
  }
});

/* ── Auth & profile ────────────────────────────────────────── */
async function initAuthAndProfile() {
  const db = window.supabaseClient;
  if (!db?.auth) throw new Error("supabaseClient ยังไม่พร้อมใช้งาน");

  const { data: { session }, error: sessionError } = await db.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session?.user) {
    window.location.href = "/pages/auth/login.html";
    return;
  }
  currentUser = session.user;

  const { data: profile, error } = await db
    .from("profiles")
    .select("id, username, display_name, email, role, status")
    .eq("id", currentUser.id)
    .single();

  if (error) throw error;
  if (!profile) throw new Error("ไม่พบข้อมูลผู้ใช้งานในตาราง profiles");

  currentProfile = profile;

  const role   = String(profile.role   || "").toLowerCase();
  const status = String(profile.status || "active").toLowerCase();
  const allowed = ["accounting", "admin", "manager", "executive"];

  if (!allowed.includes(role)) {
    showToast("ไม่มีสิทธิ์เข้าใช้งานหน้านี้", "error");
    setTimeout(() => { window.location.href = "/index.html"; }, 1500);
    return;
  }
  if (status !== "active") {
    showToast("บัญชีนี้ไม่ได้อยู่ในสถานะ Active", "error");
    await db.auth.signOut();
    setTimeout(() => { window.location.href = "/pages/auth/login.html"; }, 1500);
    return;
  }

  renderCurrentUser(profile);
}

function renderCurrentUser(profile) {
  const name   = profile.display_name || profile.username || profile.email || "Accounting";
  const avatar = getAvatarText(name);
  setText("sidebarAvatar",    avatar);
  setText("topbarAvatar",     avatar);
  setText("sidebarDisplayName", name);
  setText("topbarUsername",   name);
  setText("sidebarRole",      profile.role || "accounting");
}

function wireLogoutButton() {
  const btn = document.getElementById("logoutBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (!confirmAction("ยืนยันออกจากระบบ?")) return;
    await window.supabaseClient.auth.signOut();
    window.location.href = "/pages/auth/login.html";
  });
}

/* ── Data loading ──────────────────────────────────────────── */
async function loadAccountingRequests() {
  const list = document.getElementById("requestList");
  if (list) list.innerHTML = `<div class="empty-state">กำลังโหลดข้อมูล...</div>`;

  const { data, error } = await window.supabaseClient
    .from("approval_requests")
    .select("*")
    .eq("request_type", "credit_limit_temp")
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: false });

  if (error) throw error;
  allRequests = await attachSignedPdfUrls(data || []);
  updateSummaryCounts();
  renderRequests();
}

async function attachSignedPdfUrls(rows) {
  const db = window.supabaseClient;
  return Promise.all(rows.map(async (row) => {
    const stored = row.financial_pdf_url || "";
    if (!stored) return { ...row, _financial_pdf_signed_url: "" };
    if (/^https?:\/\//i.test(stored)) return { ...row, _financial_pdf_signed_url: stored };

    const { data, error } = await db.storage
      .from(BUCKET_NAME)
      .createSignedUrl(stored, 60 * 60);   // 1-hour signed URL

    if (error) {
      console.warn("Signed URL failed:", error.message);
      return { ...row, _financial_pdf_signed_url: "" };
    }
    return { ...row, _financial_pdf_signed_url: data?.signedUrl || "" };
  }));
}

/* ── Filter & render ───────────────────────────────────────── */
function setFilter(filter) {
  activeFilter = filter;
  document.querySelectorAll(".summary-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.filter === filter);
  });
  renderRequests();
}

function updateSummaryCounts() {
  setText("countPending",   allRequests.filter((r) => ["pending","accounting_review"].includes(r.status)).length);
  setText("countForwarded", allRequests.filter((r) => r.status === "manager_review").length);
  setText("countRevision",  allRequests.filter((r) => r.status === "revision_required").length);
  setText("countAll",       allRequests.length);
}

function renderRequests() {
  const list = document.getElementById("requestList");
  if (!list) return;

  const keyword = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();
  let rows = [...allRequests];

  if (activeFilter === "accounting_review") {
    rows = rows.filter((r) => ["pending","accounting_review"].includes(r.status));
  } else if (activeFilter !== "all") {
    rows = rows.filter((r) => r.status === activeFilter);
  }

  if (keyword) {
    rows = rows.filter((r) =>
      [getDocNo(r), r.shop_name, r.shop_code, r.sale_order_no, r.sale_name]
        .filter(Boolean).join(" ").toLowerCase().includes(keyword)
    );
  }

  if (!rows.length) {
    list.innerHTML = `<div class="empty-state">ไม่พบรายการคำขอในสถานะนี้</div>`;
    return;
  }

  list.innerHTML = rows.map((row, idx) => renderAccountingCard(row, idx)).join("");
}

/* ── Card template ─────────────────────────────────────────── */
function renderAccountingCard(row, index = 0) {
  const docNo          = getDocNo(row);
  const amount         = formatMoney(row.request_amount);
  const statusText     = getStatusText(row.status);
  const collapsed      = index === 0 ? "" : "collapsed";
  const safeId         = cssSafeId(row.id);
  const pdfName        = escapeHtml(row.financial_pdf_name || "ยังไม่ได้อัปโหลด PDF");
  const pdfUrl         = row._financial_pdf_signed_url || "";
  const recommendedLimit = getRecommendedLimit(row);
  const flow           = getMiniFlow(row.status);

  const riskOptions = [
    ["",       "-- เลือกความเสี่ยง --"],
    ["low",    "ต่ำ"],
    ["medium", "ปานกลาง"],
    ["high",   "สูง"],
  ].map(([val, label]) =>
    `<option value="${val}" ${row.accounting_risk_level === val ? "selected" : ""}>${label}</option>`
  ).join("");

  return `
<article class="request-card ${collapsed}" data-request-id="${escapeAttr(row.id)}">
  <button class="request-head" type="button" onclick="toggleRequestCard(this)" aria-expanded="${index === 0}">
    <div class="request-head-left">
      <span class="expand-icon" aria-hidden="true">⌄</span>
      <div class="request-title">
        <h3>${docNo}</h3>
        <p>${escapeHtml(row.shop_name || "-")} · ${escapeHtml(row.sale_order_no || "-")}</p>
      </div>
    </div>
    <span class="status-pill status-${escapeAttr(row.status || "")}">● ${statusText}</span>
  </button>

  <div class="request-content">
    <div class="request-body">
      <div class="review-layout">

        <!-- Left column -->
        <div class="left-stack">

          <!-- Request info -->
          <section class="panel">
            <div class="panel-head">
              <div class="panel-title">
                <span class="material-symbols-outlined" aria-hidden="true">receipt_long</span>
                ข้อมูลคำขอ
              </div>
            </div>
            <div class="panel-body">
              <div class="customer-grid">
                <div class="customer-item"><label>บริษัท</label><strong>${escapeHtml(row.shop_name || "-")}</strong></div>
                <div class="customer-item"><label>รหัสลูกค้า</label><strong>${escapeHtml(row.shop_code || "-")}</strong></div>
                <div class="customer-item"><label>เลขที่บิล</label><strong>${escapeHtml(row.sale_order_no || "-")}</strong></div>
                <div class="customer-item"><label>ยอดคำขอ</label><strong class="text-red">${amount}</strong></div>
                <div class="customer-item"><label>Sale</label><strong>${escapeHtml(row.sale_name || "-")}</strong></div>
                <div class="customer-item"><label>วันที่ส่งคำขอ</label><strong>${formatDateText(row.created_at || row.request_date)}</strong></div>
              </div>
            </div>
          </section>

          <!-- PDF upload -->
          <section class="panel">
            <div class="panel-head">
              <div class="panel-title">
                <span class="material-symbols-outlined" aria-hidden="true">picture_as_pdf</span>
                เอกสาร PDF ข้อมูลการเงินภายใน
              </div>
            </div>
            <div class="panel-body">
              <div class="upload-box">
                <div class="pdf-main">
                  <div class="pdf-name" id="pdfName-${safeId}">${pdfName}</div>
                  <div class="upload-meta">รองรับไฟล์ .pdf ไม่เกิน 15 MB — เก็บใน Private Storage</div>
                  ${pdfUrl
                    ? '<a class="file-link" href="' + escapeAttr(pdfUrl) + '" target="_blank" rel="noopener noreferrer"><span class="material-symbols-outlined" style="font-size:16px" aria-hidden="true">open_in_new</span>เปิดไฟล์ PDF</a>'
                    : ""}
                </div>
                <div style="flex:0 0 auto;display:flex;flex-direction:column;gap:8px;align-items:flex-end">
                  <input id="pdfInput-${safeId}" type="file" accept="application/pdf,.pdf" hidden
                    onchange="uploadFinancialPdf('${escapeAttr(row.id)}')" />
                  <button class="btn btn-outline" type="button"
                    onclick="document.getElementById('pdfInput-${safeId}').click()">
                    <span class="material-symbols-outlined" aria-hidden="true">upload_file</span>
                    อัปโหลด PDF
                  </button>
                  ${pdfUrl
                    ? '<button class="btn btn-analyze" type="button" id="analyzeBtn-' + safeId + '" onclick="analyzePdfWithClaude(\'' + escapeAttr(row.id) + '\')" ><span class="material-symbols-outlined" aria-hidden="true">auto_awesome</span>อ่านข้อมูลจาก PDF</button>'
                    : '<span class="small-note" style="text-align:right">อัปโหลด PDF ก่อนเพื่ออ่านข้อมูล</span>'}
                </div>
              </div>
            </div>
          </section>

          <!-- PDF analysis result panel -->
          <section class="panel" id="analysisPanel-${safeId}"
            style="${row.financial_analysis && row.financial_analysis.total_outstanding ? '' : 'display:none'}">
            <div class="panel-head">
              <div class="panel-title">
                <span class="material-symbols-outlined" aria-hidden="true">insights</span>
                ผลวิเคราะห์จาก PDF
              </div>
              <span class="analysis-badge" id="analysisBadge-${safeId}">
                ${row.financial_analysis && row.financial_analysis.analyzed_at
                  ? "วิเคราะห์แล้ว · " + formatDateText(row.financial_analysis.analyzed_at)
                  : ""}
              </span>
            </div>
            <div class="panel-body" id="analysisBody-${safeId}">
              ${row.financial_analysis && row.financial_analysis.total_outstanding
                ? renderAnalysisBody(row.financial_analysis, safeId)
                : ""}
            </div>
          </section>

          <!-- Accounting assessment -->
          <section class="panel">
            <div class="panel-head">
              <div class="panel-title">
                <span class="material-symbols-outlined" aria-hidden="true">edit_note</span>
                ผลสรุปและข้อเสนอแนะจากบัญชี
              </div>
            </div>
            <div class="panel-body">
              <div class="accounting-grid">
                <div class="field">
                  <label for="risk-${safeId}">ระดับความเสี่ยง</label>
                  <select id="risk-${safeId}">${riskOptions}</select>
                </div>

                <div class="field">
                  <label for="recommended-${safeId}">วงเงินที่บัญชีแนะนำ (บาท)</label>
                  <input
                    id="recommended-${safeId}"
                    type="text"
                    inputmode="numeric"
                    value="${escapeAttr(recommendedLimit)}"
                    placeholder="เช่น 30,000"
                  />
                </div>

                <div class="field full">
                  <label for="summary-${safeId}">สรุปผลจากบัญชี</label>
                  <textarea
                    id="summary-${safeId}"
                    maxlength="1000"
                    placeholder="สรุปเฉพาะข้อมูลที่ต้องการให้ Manager / Executive เห็น"
                  >${escapeHtml(row.accounting_summary || "")}</textarea>
                </div>

                <div class="field full">
                  <label for="recommend-${safeId}">ความคิดเห็น / ข้อเสนอแนะ</label>
                  <textarea
                    id="recommend-${safeId}"
                    maxlength="1000"
                    placeholder="เช่น แนะนำอนุมัติวงเงินชั่วคราวไม่เกิน ..."
                  >${escapeHtml(row.accounting_recommendation || "")}</textarea>
                  <span class="small-note">ข้อความนี้ใช้สำหรับ Manager / Executive — ไม่แสดงในหน้า Sale</span>
                </div>
              </div>
            </div>
          </section>

        </div><!-- /left-stack -->

        <!-- Right sticky column -->
        <aside class="right-sticky">

          <section class="panel">
            <div class="panel-head">
              <div class="panel-title">
                <span class="material-symbols-outlined" aria-hidden="true">timeline</span>
                ลำดับการดำเนินการ
              </div>
            </div>
            <div class="panel-body">
              <div class="mini-flow">
                <div class="mini-step done">
                  <span class="dot" aria-hidden="true">✓</span>
                  <span>Sale ส่งคำขอ</span>
                </div>
                <div class="mini-step ${flow.accounting}">
                  <span class="dot" aria-hidden="true">2</span>
                  <span>บัญชีตรวจสอบ</span>
                </div>
                <div class="mini-step ${flow.manager}">
                  <span class="dot" aria-hidden="true">3</span>
                  <span>ผู้จัดการอนุมัติ</span>
                </div>
                <div class="mini-step ${flow.final}">
                  <span class="dot" aria-hidden="true">4</span>
                  <span>ผู้บริหาร / ผลสุดท้าย</span>
                </div>
              </div>
            </div>
          </section>

          <section class="action-box">
            <h4>การดำเนินการ</h4>
            <div class="action-row">
              <button class="btn btn-outline" type="button"
                onclick="saveAccountingDraft('${escapeAttr(row.id)}')">
                <span class="material-symbols-outlined" aria-hidden="true">save</span>
                บันทึกข้อมูลบัญชี
              </button>
              <button class="btn btn-danger" type="button"
                onclick="sendBackToSale('${escapeAttr(row.id)}')">
                <span class="material-symbols-outlined" aria-hidden="true">undo</span>
                ส่งกลับให้ Sale แก้ไข
              </button>
              <button class="btn btn-primary" type="button"
                onclick="forwardToManager('${escapeAttr(row.id)}')">
                <span class="material-symbols-outlined" aria-hidden="true">send</span>
                ส่งต่อผู้จัดการ
              </button>
            </div>
          </section>

        </aside><!-- /right-sticky -->

      </div><!-- /review-layout -->
    </div><!-- /request-body -->
  </div><!-- /request-content -->
</article>`;
}

/* ── Accordion toggle ──────────────────────────────────────── */
function toggleRequestCard(button) {
  const card = button.closest(".request-card");
  if (!card) return;
  const collapsed = card.classList.toggle("collapsed");
  button.setAttribute("aria-expanded", String(!collapsed));
}

/* ── PDF upload ────────────────────────────────────────────── */
async function uploadFinancialPdf(requestId) {
  const safeId = cssSafeId(requestId);
  const input  = document.getElementById(`pdfInput-${safeId}`);
  const file   = input?.files?.[0];
  if (!file) return;

  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    showToast("กรุณาเลือกไฟล์ PDF เท่านั้น", "warn");
    input.value = "";
    return;
  }
  const maxMB = 15;
  if (file.size > maxMB * 1024 * 1024) {
    showToast(`ไฟล์ใหญ่เกินไป (สูงสุด ${maxMB} MB)`, "warn");
    input.value = "";
    return;
  }

  const db          = window.supabaseClient;
  const cleanName   = sanitizeFileName(file.name);
  const filePath    = `${requestId}/${Date.now()}-${cleanName}`;

  setPdfName(safeId, "กำลังอัปโหลด...");
  try {
    const { error: uploadError } = await db.storage
      .from(BUCKET_NAME)
      .upload(filePath, file, { cacheControl: "3600", upsert: false, contentType: "application/pdf" });
    if (uploadError) throw uploadError;

    const { error: updateError } = await db
      .from("approval_requests")
      .update({
        financial_pdf_url:   filePath,
        financial_pdf_name:  file.name,
        status:              "accounting_review",
        accounting_status:   "uploaded_pdf",
        accounting_checked_by: currentUser.id,
        accounting_checked_at: new Date().toISOString(),
      })
      .eq("id", requestId);
    if (updateError) throw updateError;

    showToast("อัปโหลด PDF เรียบร้อยแล้ว ✓", "success");
    await loadAccountingRequests();
  } catch (err) {
    console.error("Upload PDF error:", err);
    showToast("อัปโหลดไม่สำเร็จ: " + (err.message || err), "error");
    setPdfName(safeId, file.name + " (ล้มเหลว)");
  } finally {
    input.value = "";
  }
}

function setPdfName(safeId, text) {
  const el = document.getElementById(`pdfName-${safeId}`);
  if (el) el.textContent = text;
}

/* ── Save draft ────────────────────────────────────────────── */
async function saveAccountingDraft(requestId) {
  try {
    const payload = collectAccountingPayload(requestId);
    const { error } = await window.supabaseClient
      .from("approval_requests")
      .update({
        ...payload,
        status:              "accounting_review",
        accounting_status:   "draft",
        accounting_checked_by: currentUser.id,
        accounting_checked_at: new Date().toISOString(),
      })
      .eq("id", requestId);
    if (error) throw error;
    showToast("บันทึกข้อมูลบัญชีเรียบร้อยแล้ว ✓", "success");
    await loadAccountingRequests();
  } catch (err) {
    console.error("Save draft error:", err);
    showToast("บันทึกไม่สำเร็จ: " + (err.message || err), "error");
  }
}

/* ── Forward to manager ────────────────────────────────────── */
async function forwardToManager(requestId) {
  const payload = collectAccountingPayload(requestId);

  if (!payload.accounting_summary?.trim()) {
    showToast("กรุณากรอกสรุปผลจากบัญชีก่อนส่งต่อ", "warn");
    return;
  }
  if (!payload.accounting_recommendation?.trim()) {
    showToast("กรุณากรอกความคิดเห็น / ข้อเสนอแนะก่อนส่งต่อ", "warn");
    return;
  }
  if (!confirmAction("ยืนยันส่งต่อคำขอนี้ให้ผู้จัดการใช่ไหม?")) return;

  try {
    const { error } = await window.supabaseClient
      .from("approval_requests")
      .update({
        ...payload,
        status:              "manager_review",
        accounting_status:   "forwarded_to_manager",
        accounting_checked_by: currentUser.id,
        accounting_checked_at: new Date().toISOString(),
      })
      .eq("id", requestId);
    if (error) throw error;
    showToast("ส่งต่อผู้จัดการเรียบร้อยแล้ว ✓", "success");
    await loadAccountingRequests();
  } catch (err) {
    console.error("Forward to manager error:", err);
    showToast("ส่งต่อไม่สำเร็จ: " + (err.message || err), "error");
  }
}

/* ── Send back to Sale ─────────────────────────────────────── */
async function sendBackToSale(requestId) {
  const payload = collectAccountingPayload(requestId);

  if (!payload.accounting_recommendation?.trim()) {
    showToast("กรุณากรอกความคิดเห็น / ข้อเสนอแนะ เพื่อแจ้งให้ Sale แก้ไข", "warn");
    return;
  }
  if (!confirmAction("ยืนยันส่งกลับให้ Sale แก้ไขใช่ไหม?")) return;

  try {
    const { error } = await window.supabaseClient
      .from("approval_requests")
      .update({
        ...payload,
        status:            "revision_required",
        accounting_status: "sent_back_to_sale",
        accounting_checked_by: currentUser.id,
        accounting_checked_at: new Date().toISOString(),
      })
      .eq("id", requestId);
    if (error) throw error;
    showToast("ส่งกลับให้ Sale แก้ไขเรียบร้อยแล้ว ✓", "success");
    await loadAccountingRequests();
  } catch (err) {
    console.error("Send back to sale error:", err);
    showToast("ส่งกลับไม่สำเร็จ: " + (err.message || err), "error");
  }
}

/* ── Collect form values ───────────────────────────────────── */
function collectAccountingPayload(requestId) {
  const safeId         = cssSafeId(requestId);
  const risk           = getValue(`risk-${safeId}`);
  const recommendedLimit = toNumber(getValue(`recommended-${safeId}`));
  const summary        = getValue(`summary-${safeId}`);
  const recommendation = getValue(`recommend-${safeId}`);

  return {
    accounting_risk_level:     risk           || null,
    accounting_summary:        summary        || null,
    accounting_recommendation: recommendation || null,
    financial_analysis: {
      risk_level:         risk           || null,
      recommended_limit:  recommendedLimit,
      summary,
      recommendation,
      updated_at:  new Date().toISOString(),
      updated_by:  currentUser.id,
    },
  };
}

/* ── Mobile sidebar ────────────────────────────────────────── */
function openSidebar() {
  document.body.classList.add("sidebar-open");
}
function closeSidebar() {
  document.body.classList.remove("sidebar-open");
}

/* ── Toast notification ────────────────────────────────────── */
let _toastTimer = null;
function showToast(message, type = "info", duration = 3000) {
  const el = document.getElementById("toast");
  if (!el) return;

  el.textContent = message;
  el.className   = `toast ${type} show`;

  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, duration);
}

/* ── Confirm (native — can swap for modal later) ───────────── */
function confirmAction(message) {
  return window.confirm(message);
}

/* ── Helpers ───────────────────────────────────────────────── */
function getRecommendedLimit(row) {
  const v = row.financial_analysis?.recommended_limit;
  return (v === null || v === undefined || v === "") ? "" : String(v);
}

function getMiniFlow(status) {
  const done    = ["executive_review","approved","rejected"];
  const mgr     = ["manager_review"];
  const acc     = ["pending","accounting_review","revision_required"];
  return {
    accounting: acc.includes(status) ? "active" : "done",
    manager:    mgr.includes(status) ? "active"
              : done.includes(status) ? "done" : "",
    final:      done.includes(status) ? "active" : "",
  };
}

function getDocNo(row) {
  if (row.doc_no) return escapeHtml(row.doc_no);
  const raw = String(row.id || "NEW").replace(/-/g,"").substring(0,8).toUpperCase();
  return `CRD-${raw}`;
}

function getStatusText(status) {
  const map = {
    pending:            "รอดำเนินการ",
    accounting_review:  "รอดำเนินการ",
    manager_review:     "ส่งต่อผู้จัดการแล้ว",
    revision_required:  "รอ Sale แก้ไข",
    executive_review:   "รอผู้บริหารอนุมัติ",
    approved:           "อนุมัติแล้ว",
    rejected:           "ไม่อนุมัติ",
  };
  return map[status] || status || "-";
}

function formatMoney(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " บาท";
}

function formatDateText(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function getAvatarText(value) {
  const text = String(value || "A").trim();
  return text ? text.slice(0,2).toUpperCase() : "A";
}

function getValue(id) {
  return document.getElementById(id)?.value?.trim() || "";
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "";
}

function toNumber(value) {
  const cleaned = String(value || "").replace(/,/g,"").replace(/[^\d.-]/g,"").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function cssSafeId(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/^(\d)/, "id_$1");
}

function sanitizeFileName(name) {
  // Supabase Storage rejects non-ASCII characters in object keys (400 Bad Request).
  // Strip everything outside [a-zA-Z0-9._-], then collapse/trim underscores.
  // If nothing ASCII-printable remains (e.g. a purely Thai filename), fall back to a
  // timestamp so uploaded files never overwrite each other.
  const base = String(name || "document.pdf")
    .replace(/\.pdf$/i, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .substring(0, 80);
  return `${base || "file_" + Date.now()}.pdf`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g,"&#096;");
}

/* ── Global exports (called from inline HTML onclick) ──────── */
window.setFilter             = setFilter;
window.renderRequests        = renderRequests;
window.loadAccountingRequests = loadAccountingRequests;
window.toggleRequestCard     = toggleRequestCard;
window.uploadFinancialPdf    = uploadFinancialPdf;
window.saveAccountingDraft   = saveAccountingDraft;
window.forwardToManager      = forwardToManager;
window.sendBackToSale        = sendBackToSale;
window.openSidebar           = openSidebar;
window.closeSidebar          = closeSidebar;

/* ================================================================
/* ================================================================
   PDF ANALYSIS — via Supabase Edge Function (CORS-safe proxy)
   Flow:
     1. analyzePdfWithClaude(requestId)
        → get signed URL from allRequests cache
        → fetch PDF bytes → base64
        → POST to /functions/v1/analyze-pdf  ← Edge Function proxy
        → Edge Function calls Anthropic server-side (no CORS)
        → parse JSON response
        → renderAnalysisResult() → show panel
        → auto-fill risk/recommended/summary fields
        → save financial_analysis jsonb to Supabase
================================================================ */

async function analyzePdfWithClaude(requestId) {
  const safeId = cssSafeId(requestId);
  const btn    = document.getElementById("analyzeBtn-" + safeId);

  // ── 1. Find row in local cache ────────────────────────────────
  const row = allRequests.find((r) => r.id === requestId);
  if (!row) { showToast("ไม่พบข้อมูลคำขอ", "error"); return; }

  const signedUrl = row._financial_pdf_signed_url;
  if (!signedUrl) {
    showToast("ไม่พบ URL ของ PDF กรุณา refresh หน้า", "warn");
    return;
  }

  // ── 2. Set loading state ──────────────────────────────────────
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = "<span class=\"material-symbols-outlined spin\" aria-hidden=\"true\">progress_activity</span> กำลังวิเคราะห์...";
  }
  setAnalysisLoading(safeId);

  try {
    // ── 3. Download PDF → base64 ──────────────────────────────────
    const pdfResp = await fetch(signedUrl);
    if (!pdfResp.ok) throw new Error("ดาวน์โหลด PDF ไม่สำเร็จ (" + pdfResp.status + ")");
    const pdfBuffer = await pdfResp.arrayBuffer();
    const base64Pdf = arrayBufferToBase64(pdfBuffer);

    // ── 4. Call Edge Function proxy (avoids CORS) ─────────────────
    //    The Edge Function URL is auto-derived from the Supabase client.
    //    window.supabaseClient.supabaseUrl  →  https://xxxx.supabase.co
    const supabaseUrl = window.supabaseClient.supabaseUrl
      || (window._supabaseUrl || "");    // fallback if exposed differently

    if (!supabaseUrl) throw new Error("ไม่พบ Supabase URL — ตรวจสอบ supabaseClient.js");

    // Retrieve the current session token for Authorization header
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    const accessToken = session?.access_token || "";

    const edgeResp = await fetch(supabaseUrl + "/functions/v1/analyze-pdf", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": "Bearer " + accessToken,
      },
      body: JSON.stringify({ pdf_base64: base64Pdf }),
    });

    const edgeData = await edgeResp.json();
    if (!edgeResp.ok || !edgeData.ok) {
      throw new Error(edgeData.error || "Edge Function ตอบกลับ error " + edgeResp.status);
    }

    // ── 5. Process result ─────────────────────────────────────────
    const parsed = edgeData.data;
    parsed.analyzed_at = new Date().toISOString();
    parsed.analyzed_by = currentUser.id;

    const existing = row.financial_analysis || {};
    const merged = {
      ...existing,
      ...parsed,
      risk_level:        parsed.risk_level,
      recommended_limit: parsed.recommended_limit,
    };

    // ── 6. Render panel ───────────────────────────────────────────
    renderAnalysisResult(safeId, merged);

    // ── 7. Auto-fill form fields ──────────────────────────────────
    autoFillAccountingFields(safeId, parsed);

    // ── 8. Persist to Supabase ────────────────────────────────────
    const { error: saveError } = await window.supabaseClient
      .from("approval_requests")
      .update({
        financial_analysis:    merged,
        accounting_risk_level: parsed.risk_level || null,
        accounting_checked_by: currentUser.id,
        accounting_checked_at: new Date().toISOString(),
      })
      .eq("id", requestId);

    if (saveError) {
      console.warn("Save analysis warning:", saveError.message);
      showToast("วิเคราะห์สำเร็จ แต่บันทึก DB ไม่สำเร็จ: " + saveError.message, "warn");
    } else {
      const idx = allRequests.findIndex((r) => r.id === requestId);
      if (idx !== -1) allRequests[idx].financial_analysis = merged;
      showToast("วิเคราะห์ PDF เรียบร้อยแล้ว ✓", "success");
    }

  } catch (err) {
    console.error("analyzePdfWithClaude error:", err);
    showToast("วิเคราะห์ PDF ไม่สำเร็จ: " + (err.message || err), "error");
    clearAnalysisLoading(safeId);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = "<span class=\"material-symbols-outlined\" aria-hidden=\"true\">auto_awesome</span>อ่านข้อมูลจาก PDF";
    }
  }
}

/* ── Render helpers ────────────────────────────────────────── */

function renderAnalysisResult(safeId, data) {
  const panel = document.getElementById(`analysisPanel-${safeId}`);
  const body  = document.getElementById(`analysisBody-${safeId}`);
  const badge = document.getElementById(`analysisBadge-${safeId}`);
  if (!panel || !body) return;

  body.innerHTML  = renderAnalysisBody(data, safeId);
  if (badge && data.analyzed_at) {
    badge.textContent = "วิเคราะห์แล้ว · " + formatDateText(data.analyzed_at);
  }
  panel.style.display = "";
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderAnalysisBody(data, safeId) {
  if (!data) return "";
  const riskLabel = { low: "ต่ำ", medium: "ปานกลาง", high: "สูง" }[data.risk_level] || "-";
  const riskClass = { low: "risk-low", medium: "risk-medium", high: "risk-high" }[data.risk_level] || "";

  const rows = [
    ["ยอดคงค้างรวม",          data.total_outstanding,  true],
    ["ยังไม่ถึงกำหนด",        data.not_yet_due,         false],
    ["ค้าง 1–7 วัน",           data.overdue_1_7,         false],
    ["ค้าง 8–15 วัน",          data.overdue_8_15,        false],
    ["ค้าง 16–30 วัน",         data.overdue_16_30,       false],
    ["ค้างเกิน 30 วัน",        data.overdue_30_plus,     false],
    ["ค้างเกิน 60 วัน",        data.overdue_60_plus,     false],
  ].filter(([, v]) => v !== undefined && v !== null && v !== 0 || true);

  const amountRows = rows.map(([label, val, isBold]) => {
    if (val === undefined || val === null) return "";
    const fmt = Number.isFinite(Number(val))
      ? Number(val).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : String(val);
    return `<div class="aging-row${isBold ? " aging-total" : ""}">
      <span>${escapeHtml(label)}</span>
      <span>${fmt} บาท</span>
    </div>`;
  }).join("");

  const overduePct = data.total_outstanding > 0
    ? (((data.overdue_30_plus || 0) + (data.overdue_60_plus || 0)) / data.total_outstanding * 100).toFixed(1)
    : "0.0";

  return `
    <div class="aging-grid">
      ${amountRows}
    </div>
    <div class="aging-meta">
      <div class="aging-meta-item">
        <label>ลูกค้า</label>
        <strong>${escapeHtml(data.customer_name || "-")}</strong>
      </div>
      <div class="aging-meta-item">
        <label>วันที่รายงาน</label>
        <strong>${escapeHtml(data.report_date || "-")}</strong>
      </div>
      <div class="aging-meta-item">
        <label>ค้างเกิน 30 วัน (%)</label>
        <strong class="${Number(overduePct) > 30 ? "text-red" : ""}">${overduePct}%</strong>
      </div>
      <div class="aging-meta-item">
        <label>ค้างนานสุด</label>
        <strong class="${(data.oldest_overdue_days || 0) > 60 ? "text-red" : ""}">
          ${data.oldest_overdue_days ? data.oldest_overdue_days + " วัน" : "-"}
        </strong>
      </div>
      <div class="aging-meta-item">
        <label>วงเงินที่แนะนำ</label>
        <strong>${data.recommended_limit
          ? Number(data.recommended_limit).toLocaleString("th-TH") + " บาท"
          : "-"}</strong>
      </div>
      <div class="aging-meta-item">
        <label>ระดับความเสี่ยง</label>
        <strong class="risk-badge ${riskClass}">${riskLabel}</strong>
      </div>
    </div>
    ${data.risk_reason ? `<div class="aging-reason"><span class="material-symbols-outlined" style="font-size:15px;vertical-align:-3px" aria-hidden="true">info</span> ${escapeHtml(data.risk_reason)}</div>` : ""}
    ${data.summary_th  ? `<div class="aging-summary">${escapeHtml(data.summary_th)}</div>` : ""}
    <div class="aging-edit-hint">
      <span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px" aria-hidden="true">edit</span>
      ตัวเลขด้านล่างถูกกรอกอัตโนมัติแล้ว — ตรวจสอบและแก้ไขได้ก่อนบันทึก
    </div>`;
}

function setAnalysisLoading(safeId) {
  const panel = document.getElementById(`analysisPanel-${safeId}`);
  const body  = document.getElementById(`analysisBody-${safeId}`);
  if (!panel || !body) return;
  panel.style.display = "";
  body.innerHTML = `<div class="analysis-loading">
    <span class="material-symbols-outlined spin" aria-hidden="true">progress_activity</span>
    กำลังวิเคราะห์ข้อมูล...
  </div>`;
}

function clearAnalysisLoading(safeId) {
  const body = document.getElementById(`analysisBody-${safeId}`);
  if (body) body.innerHTML = `<div class="analysis-loading text-red">วิเคราะห์ไม่สำเร็จ กรุณาลองใหม่</div>`;
}

/* ── Auto-fill accounting form fields ──────────────────────── */
function autoFillAccountingFields(safeId, data) {
  // Risk level
  const riskEl = document.getElementById(`risk-${safeId}`);
  if (riskEl && data.risk_level && !riskEl.value) {
    riskEl.value = data.risk_level;
  }

  // Recommended limit
  const recEl = document.getElementById(`recommended-${safeId}`);
  if (recEl && data.recommended_limit && !recEl.value) {
    recEl.value = Number(data.recommended_limit).toLocaleString("th-TH");
  }

  // Summary
  const sumEl = document.getElementById(`summary-${safeId}`);
  if (sumEl && data.summary_th && !sumEl.value.trim()) {
    sumEl.value = data.summary_th;
  }
}

/* ── Utility: ArrayBuffer → base64 ─────────────────────────── */
function arrayBufferToBase64(buffer) {
  const bytes  = new Uint8Array(buffer);
  const CHUNK  = 8192;
  let binary   = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/* ── Extra global exports ───────────────────────────────────── */
window.analyzePdfWithClaude = analyzePdfWithClaude;