/* ================================================================
   CREDIT LIMIT ACCOUNTING REVIEW — credit-limit-finance.js

   หลักการ:
   • ไม่มี HTML string / template literal ในไฟล์นี้เลย
   • UI ทั้งหมดอยู่ใน <template> ใน .html
   • JS ทำหน้าที่:  clone template → fill data → wire events
================================================================ */

"use strict";

let currentUser = null;
let currentProfile = null;
let allRequests = [];
let activeFilter = "accounting_review";

const BUCKET_NAME = "approval-financial-docs";
const ACTIVE_STATUSES = [
  "pending",
  "accounting_review",
  "manager_review",
  "revision_required",
];

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

  const {
    data: { session },
    error: sessionError,
  } = await db.auth.getSession();
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

  const role = String(profile.role || "").toLowerCase();
  const status = String(profile.status || "active").toLowerCase();
  const allowed = ["accounting", "admin", "manager", "executive"];

  if (!allowed.includes(role)) {
    showToast("ไม่มีสิทธิ์เข้าใช้งานหน้านี้", "error");
    setTimeout(() => {
      window.location.href = "/index.html";
    }, 1500);
    return;
  }
  if (status !== "active") {
    showToast("บัญชีนี้ไม่ได้อยู่ในสถานะ Active", "error");
    await db.auth.signOut();
    setTimeout(() => {
      window.location.href = "/pages/auth/login.html";
    }, 1500);
    return;
  }

  renderCurrentUser(profile);
}

function renderCurrentUser(profile) {
  const name =
    profile.display_name || profile.username || profile.email || "Accounting";
  const avatar = getAvatarText(name);
  setText("sidebarAvatar", avatar);
  setText("topbarAvatar", avatar);
  setText("sidebarDisplayName", name);
  setText("topbarUsername", name);
  setText("sidebarRole", profile.role || "accounting");
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
  if (list) {
    list.innerHTML = "";
    list.appendChild(makeEmptyState("กำลังโหลดข้อมูล..."));
  }

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
  return Promise.all(
    rows.map(async (row) => {
      const stored = row.financial_pdf_url || "";
      if (!stored) return { ...row, _financial_pdf_signed_url: "" };
      if (/^https?:\/\//i.test(stored))
        return { ...row, _financial_pdf_signed_url: stored };

      const { data, error } = await db.storage
        .from(BUCKET_NAME)
        .createSignedUrl(stored, 60 * 60);

      if (error) {
        console.warn("Signed URL failed:", error.message);
        return { ...row, _financial_pdf_signed_url: "" };
      }
      return { ...row, _financial_pdf_signed_url: data?.signedUrl || "" };
    }),
  );
}

async function getSignedPdfUrl(requestId) {
  const row = allRequests.find((r) => r.id === requestId);
  if (!row?.financial_pdf_url) return "";

  const stored = row.financial_pdf_url;
  if (/^https?:\/\//i.test(stored)) return stored;

  const { data, error } = await window.supabaseClient.storage
    .from(BUCKET_NAME)
    .createSignedUrl(stored, 60 * 60);

  if (error) {
    console.warn("Signed URL refresh failed:", error.message);
    return "";
  }
  const freshUrl = data?.signedUrl || "";
  row._financial_pdf_signed_url = freshUrl;
  return freshUrl;
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
  setText(
    "countPending",
    allRequests.filter((r) =>
      ["pending", "accounting_review"].includes(r.status),
    ).length,
  );
  setText(
    "countForwarded",
    allRequests.filter((r) => r.status === "manager_review").length,
  );
  setText("countAll", allRequests.length);
}

function renderRequests() {
  const list = document.getElementById("requestList");
  if (!list) return;

  const keyword = (document.getElementById("searchInput")?.value || "")
    .trim()
    .toLowerCase();
  let rows = [...allRequests];

  if (activeFilter === "accounting_review") {
    rows = rows.filter((r) =>
      ["pending", "accounting_review"].includes(r.status),
    );
  } else if (activeFilter !== "all") {
    rows = rows.filter((r) => r.status === activeFilter);
  }

  if (keyword) {
    rows = rows.filter((r) =>
      [getDocNo(r), r.shop_name, r.shop_code, r.sale_order_no, r.sale_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(keyword),
    );
  }

  list.innerHTML = "";

  if (!rows.length) {
    list.appendChild(makeEmptyState("ไม่พบรายการคำขอในสถานะนี้"));
    return;
  }

  rows.forEach((row, idx) => {
    const card = buildRequestCard(row, idx);
    list.appendChild(card);
  });
}

/* ================================================================
   TEMPLATE CLONING — แทน renderAccountingCard() ที่ return string
   ทุก UI อยู่ใน <template id="tpl-request-card"> ในไฟล์ .html
================================================================ */

function buildRequestCard(row, index = 0) {
  const tpl = document.getElementById("tpl-request-card");
  const card = tpl.content.cloneNode(true).querySelector(".request-card");

  card.dataset.requestId = row.id;

  if (index !== 0) card.classList.add("collapsed");

  card
    .querySelector(".request-head")
    ?.setAttribute("aria-expanded", String(index === 0));

  const docNo = getDocNo(row);

  bind(card, "docNo", docNo);
  bind(card, "shopName", row.shop_name || "-");
  bind(card, "saleOrderNo", row.sale_order_no || "-");
  bind(card, "shopName2", row.shop_name || "-");
  bind(card, "shopCode", row.shop_code || "-");
  bind(card, "saleOrderNo2", row.sale_order_no || "-");
  bind(card, "requestAmount", formatMoney(row.request_amount));
  bind(card, "currentCreditLimit", formatMoney(row.current_credit_limit));
  bind(card, "saleName", row.sale_name || "-");
  bind(card, "createdAt", formatDateText(row.created_at || row.request_date));

  const pill = card.querySelector("[data-bind='statusPill']");
  if (pill) {
    pill.className = `status-pill status-${row.status || ""}`;
    pill.textContent = "● " + getStatusText(row.status);
  }

  const riskEl = card.querySelector("[data-field='risk']");
  if (riskEl && row.accounting_risk_level) {
    riskEl.value = row.accounting_risk_level;
  }

  const verifiedEl = card.querySelector("[data-field='verifiedCredit']");
  if (verifiedEl && row.accounting_verified_credit_limit) {
    verifiedEl.value = Number(
      row.accounting_verified_credit_limit
    ).toLocaleString("th-TH");
  }

  const summaryEl = card.querySelector("[data-field='summary']");
  if (summaryEl) summaryEl.value = row.accounting_summary || "";

  const recommendEl = card.querySelector("[data-field='recommend']");
  if (recommendEl) recommendEl.value = row.accounting_recommendation || "";

  const pdfNameEl = card.querySelector("[data-bind='pdfName']");
  const pdfLink = card.querySelector(".js-pdf-link");
  const analyzeBtn = card.querySelector(".js-analyze-btn");
  const noPdfNote = card.querySelector(".js-no-pdf-note");
  const pdfInput = card.querySelector("[data-field='pdfInput']");
  const deletePdfBtn = card.querySelector(".js-delete-pdf-btn");

  const hasPdf = !!row.financial_pdf_url || !!row._financial_pdf_signed_url;

  if (pdfNameEl) {
    pdfNameEl.textContent =
      row.financial_pdf_name || "ยังไม่ได้อัปโหลด PDF";
  }

  if (pdfLink) {
    pdfLink.style.display = hasPdf ? "" : "none";
  }

  if (analyzeBtn) {
    analyzeBtn.style.display = hasPdf ? "" : "none";
  }

  if (noPdfNote) {
    noPdfNote.style.display = hasPdf ? "none" : "";
  }

  if (deletePdfBtn) {
    deletePdfBtn.style.display = hasPdf ? "inline-flex" : "none";
    deletePdfBtn.addEventListener("click", () => {
      deleteFinancialPdf(row.id);
    });
  }

  if (pdfInput) {
    pdfInput.addEventListener("change", () => {
      uploadFinancialPdf(row.id, card);
    });
  }

  if (pdfLink) {
    pdfLink.addEventListener("click", async (e) => {
      e.preventDefault();

      const url = await getSignedPdfUrl(row.id);

      if (!url) {
        showToast("ไม่สามารถเปิดไฟล์ PDF ได้", "error");
        return;
      }

      window.open(url, "_blank", "noopener,noreferrer");
    });
  }

  if (analyzeBtn) {
    analyzeBtn.addEventListener("click", () => {
      analyzePdfWithClaude(row.id, card);
    });
  }

  initSignatureSection(card, row);

  card
    .querySelector(".js-btn-save")
    ?.addEventListener("click", () => saveAccountingDraft(row.id, card));

  card
    .querySelector(".js-btn-forward")
    ?.addEventListener("click", () => forwardToManager(row.id, card));

  applyMiniFlow(card, row.status);

  /* ── FIX: เช็ค financial_analysis มีข้อมูลที่อ่านได้ ไม่ใช่แค่ total_outstanding ── */
  const fa = row.financial_analysis;
  if (fa && (fa.total_outstanding != null || fa.customer_name)) {
    const completed = completeFinancialAnalysis(row.id, card, fa);
    renderAnalysisInCard(card, completed);
  }

  return card;
}


/* ── Accordion toggle ──────────────────────────────────────── */
function toggleRequestCard(button) {
  const card = button.closest(".request-card");
  if (!card) return;
  const collapsed = card.classList.toggle("collapsed");
  button.setAttribute("aria-expanded", String(!collapsed));
}

/* ── Mini-flow state ───────────────────────────────────────── */
function applyMiniFlow(card, status) {
  const flow = getMiniFlow(status);

  const steps = [
    {
      cardSel: ".js-flow-accounting",
      dotSel: ".js-flow-accounting-dot",
      state: flow.accounting,
    },
    {
      cardSel: ".js-flow-manager",
      dotSel: ".js-flow-manager-dot",
      state: flow.manager,
    },
    {
      cardSel: ".js-flow-final",
      dotSel: ".js-flow-final-dot",
      state: flow.final,
    },
  ];

  steps.forEach(({ cardSel, dotSel, state }) => {
    const cardEl = card.querySelector(cardSel);
    const dotEl = card.querySelector(dotSel);

    if (cardEl) cardEl.className = `mini-flow-card ${state}`;

    if (dotEl) {
      dotEl.className = `mini-flow-indicator ${state}`;
      if (state === "done") {
        dotEl.innerHTML = `<span class="material-symbols-outlined">check</span>`;
      } else {
        dotEl.innerHTML = "";
      }
    }
  });
}

/* ── PDF upload ────────────────────────────────────────────── */
async function uploadFinancialPdf(requestId, card) {
  const input = card.querySelector("[data-field='pdfInput']");
  const file = input?.files?.[0];
  if (!file) return;

  if (
    file.type !== "application/pdf" &&
    !file.name.toLowerCase().endsWith(".pdf")
  ) {
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

  const db = window.supabaseClient;
  const cleanName = sanitizeFileName(file.name);
  const filePath = `${requestId}/${Date.now()}-${cleanName}`;

  setPdfNameInCard(card, "กำลังอัปโหลด...");
  try {
    const { error: uploadError } = await db.storage
      .from(BUCKET_NAME)
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: "application/pdf",
      });
    if (uploadError) throw uploadError;

    const { error: updateError } = await db
      .from("approval_requests")
      .update({
        financial_pdf_url: filePath,
        financial_pdf_name: file.name,
        status: "accounting_review",
        accounting_status: "uploaded_pdf",
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
    setPdfNameInCard(card, file.name + " (ล้มเหลว)");
  } finally {
    input.value = "";
  }
}

async function deleteFinancialPdf(requestId) {
  const row = allRequests.find((r) => r.id === requestId);

  if (!row?.financial_pdf_url) {
    showToast("ไม่พบไฟล์ PDF ที่ต้องลบ", "warn");
    return;
  }

  if (!confirmAction("ยืนยันลบไฟล์ PDF นี้ใช่ไหม?")) return;

  try {
    const storedPath = row.financial_pdf_url;

    if (!/^https?:\/\//i.test(storedPath)) {
      const { error: removeError } = await window.supabaseClient.storage
        .from(BUCKET_NAME)
        .remove([storedPath]);

      if (removeError) throw removeError;
    }

    const { error: updateError } = await window.supabaseClient
      .from("approval_requests")
      .update({
        financial_pdf_url: null,
        financial_pdf_name: null,
        financial_analysis: null,
        accounting_status: "pdf_deleted",
        accounting_checked_at: new Date().toISOString(),
      })
      .eq("id", requestId);

    if (updateError) throw updateError;

    showToast("ลบไฟล์ PDF เรียบร้อยแล้ว ✓", "success");
    await loadAccountingRequests();
  } catch (err) {
    console.error("Delete PDF error:", err);
    showToast("ลบไฟล์ไม่สำเร็จ: " + (err.message || err), "error");
  }
}

function setPdfNameInCard(card, text) {
  const el = card.querySelector("[data-bind='pdfName']");
  if (el) el.textContent = text;
}

/* ── Save draft ────────────────────────────────────────────── */
async function saveAccountingDraft(requestId, card) {
  try {
    const payload = collectAccountingPayload(requestId, card);
    const { error } = await window.supabaseClient
      .from("approval_requests")
      .update({
        ...payload,
        status: "accounting_review",
        accounting_status: "draft",
        accounting_checked_by: currentUser.id,
        accounting_checked_at: new Date().toISOString(),
      })
      .eq("id", requestId);
    if (error) throw error;

    /* ── FIX: อัปเดต allRequests ใน memory ให้ตรงกับที่เพิ่ง save ──
       ไม่ต้อง reload ทั้งหน้า — แค่ sync ข้อมูลใน cache แล้ว re-render
       เฉพาะ card นี้ เพื่อไม่ให้ analysis panel หาย                   */
    const rowIdx = allRequests.findIndex((r) => r.id === requestId);
    if (rowIdx !== -1) {
      allRequests[rowIdx] = {
        ...allRequests[rowIdx],
        ...payload,
        status: "accounting_review",
        accounting_status: "draft",
        accounting_checked_by: currentUser.id,
      };
    }

    updateSummaryCounts();
    showSuccessModal(
  "บันทึกข้อมูลสำเร็จ",
  "ระบบบันทึกข้อมูลฝ่ายบัญชีเรียบร้อยแล้ว"
);
    // showToast("บันทึกข้อมูลบัญชีเรียบร้อยแล้ว ✓", "success");
  } catch (err) {
    console.error("Save draft error:", err);
    showToast("บันทึกไม่สำเร็จ: " + (err.message || err), "error");
  }
}

/* ── Forward to manager ────────────────────────────────────── */
async function forwardToManager(requestId, card) {
  const payload = collectAccountingPayload(requestId, card);

  if (!payload.accounting_recommendation?.trim()) {
    showToast("กรุณากรอกข้อเสนอแนะจากฝ่ายบัญชีก่อนส่งต่อ", "warn");
    return;
  }

  /* ── เปิด forward-confirm modal แทน window.confirm ── */
  showForwardConfirmModal(requestId, card, payload);
}

/* ── Forward confirm modal ─────────────────────────────────── */
function showForwardConfirmModal(requestId, card, payload) {
  const tpl = document.getElementById("tpl-forward-confirm");
  if (!tpl) {
    /* fallback ถ้าไม่มี template */
    _doForwardToManager(requestId, card, payload);
    return;
  }

  const modal = tpl.content.cloneNode(true).querySelector(".forward-confirm-modal");

  const fa = payload.financial_analysis || {};

  const totalOutstanding = Number(fa.total_outstanding || 0);
  const overdue30 = Number(fa.overdue_30_plus || 0);
  const overdue60 = Number(fa.overdue_60_plus || 0);
  const overdue30Total = overdue30 + overdue60;
  const overduePct = totalOutstanding > 0
    ? ((overdue30Total / totalOutstanding) * 100).toFixed(1) + "%"
    : "-";

  const verifiedCredit = Number(payload.accounting_verified_credit_limit || 0);
  const creditRemaining = payload.credit_remaining;
  const riskLevel = payload.accounting_risk_level || fa.risk_level || "";
  const riskLabel = { low: "ต่ำ", medium: "ปานกลาง", high: "สูง" }[riskLevel] || riskLevel || "-";
  const creditStatus = payload.credit_status || fa.credit_status || "-";
  const oldest = fa.oldest_overdue_days ? fa.oldest_overdue_days + " วัน" : "-";

  bindModal(modal, "cs-total", formatMoney(totalOutstanding));
  bindModal(modal, "cs-overdue30", formatMoney(overdue30Total));
  bindModal(modal, "cs-overduePct", overduePct);
  bindModal(modal, "cs-oldest", oldest);
  bindModal(modal, "cs-credit", verifiedCredit ? Number(verifiedCredit).toLocaleString("th-TH") + " บาท" : "-");
  bindModal(modal, "cs-remaining", creditRemaining != null ? Number(creditRemaining).toLocaleString("th-TH") + " บาท" : "-");
  bindModal(modal, "cs-risk", riskLabel);
  bindModal(modal, "cs-status", creditStatus);

  const recommendEl = modal.querySelector("[data-bind='cs-recommend']");
  if (recommendEl) recommendEl.textContent = payload.accounting_recommendation || "-";

  /* color coding */
  const pctEl = modal.querySelector(".js-cs-pct");
  if (pctEl && parseFloat(overduePct) > 30) pctEl.classList.add("text-red");

  const oldestEl = modal.querySelector(".js-cs-oldest");
  if (oldestEl && Number(fa.oldest_overdue_days || 0) > 60) oldestEl.classList.add("text-red");

  const remEl = modal.querySelector(".js-cs-remaining");
  if (remEl) remEl.classList.add(Number(creditRemaining || 0) < 0 ? "text-red" : "text-green");

  const riskEl = modal.querySelector(".js-cs-risk");
  if (riskEl) {
    riskEl.classList.add(
      riskLevel === "high" ? "text-red" : riskLevel === "medium" ? "text-orange" : "text-green"
    );
  }

  const statusEl = modal.querySelector(".js-cs-status");
  if (statusEl) {
    statusEl.classList.add(
      Number(creditRemaining || 0) < 0 ? "text-red" :
      creditStatus === "ใกล้เต็มวงเงิน" ? "text-orange" : "text-green"
    );
  }

  modal.querySelector(".js-forward-close")?.addEventListener("click", () => modal.remove());
  modal.querySelector(".js-forward-cancel")?.addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });

  modal.querySelector(".js-forward-confirm")?.addEventListener("click", async () => {
    modal.remove();
    await _doForwardToManager(requestId, card, payload);
  });

  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add("show"));
}

function bindModal(root, key, value) {
  root.querySelectorAll(`[data-bind="${key}"]`).forEach((el) => {
    el.textContent = value ?? "";
  });
}

async function _doForwardToManager(requestId, card, payload) {
  try {
    const { error } = await window.supabaseClient
      .from("approval_requests")
      .update({
        ...payload,
        status: "manager_review",
        accounting_status: "forwarded_to_manager",
        accounting_checked_by: currentUser.id,
        accounting_checked_at: new Date().toISOString(),
      })
      .eq("id", requestId);
    if (error) throw error;
    showSuccessModal("ส่งต่อผู้จัดการเรียบร้อยแล้ว ✓", "success");
    await loadAccountingRequests();
  } catch (err) {
    console.error("Forward to manager error:", err);
    showToast("ส่งต่อไม่สำเร็จ: " + (err.message || err), "error");
  }
}

/* ── Send back to Sale ─────────────────────────────────────── */
async function sendBackToSale(requestId, card) {
  const payload = collectAccountingPayload(requestId, card);

  if (!payload.accounting_recommendation?.trim()) {
    showToast(
      "กรุณากรอกความคิดเห็น / ข้อเสนอแนะ เพื่อแจ้งให้ Sale แก้ไข",
      "warn",
    );
    return;
  }
  if (!confirmAction("ยืนยันส่งกลับให้ Sale แก้ไขใช่ไหม?")) return;

  try {
    const { error } = await window.supabaseClient
      .from("approval_requests")
      .update({
        ...payload,
        status: "revision_required",
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

/* ── Collect form values from card DOM ─────────────────────── */
function collectAccountingPayload(requestId, card) {
  const row = allRequests.find((r) => r.id === requestId) || {};

  const risk = card.querySelector("[data-field='risk']")?.value?.trim() || "";
  const verifiedCreditLimit = toNumber(
    card.querySelector("[data-field='verifiedCredit']")?.value || "",
  );
  const summary =
    card.querySelector("[data-field='summary']")?.value?.trim() || "";
  const recommendation =
    card.querySelector("[data-field='recommend']")?.value?.trim() || "";
  const signatureData =
    card.dataset.accountingSignatureData ||
    row.financial_analysis?.accounting_signature_data ||
    null;

  const totalOutstanding = Number(
    row.financial_analysis?.total_outstanding || 0,
  );
  const safeTotalOutstanding = Number.isFinite(totalOutstanding)
    ? totalOutstanding
    : 0;

  const creditRemaining =
    verifiedCreditLimit === null
      ? null
      : verifiedCreditLimit - safeTotalOutstanding;

  const creditStatus = getCreditStatus(
    creditRemaining,
    verifiedCreditLimit,
    safeTotalOutstanding,
  );

  /* ── FIX: preserve ทุก field จาก financial_analysis เดิม ──
     spread row.financial_analysis ก่อน แล้วค่อย override
     ที่เปลี่ยนแปลงจาก form — ป้องกัน total_outstanding และ
     ข้อมูล aging อื่นๆ หายหลัง save                          */
  const mergedAnalysis = {
    ...(row.financial_analysis || {}),
    verified_credit_limit: verifiedCreditLimit,
    credit_remaining: creditRemaining,
    risk_level: risk || row.financial_analysis?.risk_level || null,
    summary,
    recommendation,
    accounting_signature_data: signatureData,
    updated_at: new Date().toISOString(),
    updated_by: currentUser?.id || null,
    credit_status: creditStatus,
  };

  return {
    credit_status: creditStatus,
    accounting_verified_credit_limit: verifiedCreditLimit,
    credit_remaining: creditRemaining,
    accounting_risk_level: risk || null,
    accounting_summary: summary || null,
    accounting_recommendation: recommendation || null,
    financial_analysis: mergedAnalysis,
  };
}

/* ── Credit status helper ──────────────────────────────────── */
function getCreditStatus(remaining, verifiedLimit, totalOutstanding) {
  if (!verifiedLimit || verifiedLimit <= 0) return "ยังไม่กรอกวงเงิน";
  if (remaining === null || remaining === undefined) return "-";
  if (remaining < 0) return "เกินวงเงิน";
  if (remaining <= verifiedLimit * 0.1) return "ใกล้เต็มวงเงิน";
  if (totalOutstanding >= verifiedLimit * 0.7) return "ใช้วงเงินสูง";
  return "ปกติ";
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
  el.className = `toast ${type} show`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove("show"), duration);
}

function confirmAction(message) {
  return window.confirm(message);
}

/* ── Helpers ───────────────────────────────────────────────── */
function getMiniFlow(status) {
  const fullyDone = ["approved", "rejected"];
  const execActive = ["executive_review"];
  const mgr = ["manager_review"];
  const acc = ["pending", "accounting_review", "revision_required"];
  return {
    accounting: acc.includes(status) ? "active" : "done",
    manager: mgr.includes(status)
      ? "active"
      : execActive.includes(status) || fullyDone.includes(status)
        ? "done"
        : "",
    final: execActive.includes(status)
      ? "active"
      : fullyDone.includes(status)
        ? "done"
        : "",
  };
}

function getDocNo(row) {
  if (row.doc_no) return row.doc_no;
  return (
    "CRD-" +
    String(row.id || "NEW")
      .replace(/-/g, "")
      .substring(0, 8)
      .toUpperCase()
  );
}

function getStatusText(status) {
  const map = {
    pending: "รอดำเนินการ",
    accounting_review: "รอดำเนินการ",
    manager_review: "ส่งต่อผู้จัดการแล้ว",
    revision_required: "รอ Sale แก้ไข",
    executive_review: "รอผู้บริหารอนุมัติ",
    approved: "อนุมัติแล้ว",
    rejected: "ไม่อนุมัติ",
  };
  return map[status] || status || "-";
}

function formatMoney(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return (
    n.toLocaleString("th-TH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " บาท"
  );
}

function formatDateText(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getAvatarText(value) {
  const text = String(value || "A").trim();
  return text ? text.slice(0, 2).toUpperCase() : "A";
}

function toNumber(value) {
  const cleaned = String(value || "")
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function sanitizeFileName(name) {
  const base = String(name || "document.pdf")
    .replace(/\.pdf$/i, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .substring(0, 80);
  return `${base || "file_" + Date.now()}.pdf`;
}

function bind(root, key, value) {
  root.querySelectorAll(`[data-bind="${key}"]`).forEach((el) => {
    el.textContent = value ?? "";
  });
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "";
}

/* ================================================================
   PDF ANALYSIS — pdfjs + local regex parser
================================================================ */

async function analyzePdfWithClaude(requestId, card) {
  const analyzeBtn = card.querySelector(".js-analyze-btn");
  if (analyzeBtn) {
    analyzeBtn.disabled = true;
    setButtonContent(analyzeBtn, "progress_activity", "กำลังอ่าน...");
  }

  try {
    const pdfUrl = await getSignedPdfUrl(requestId);
    if (!pdfUrl) {
      showToast("ไม่พบไฟล์ PDF", "warn");
      return;
    }

    showToast("กำลังอ่านข้อความจาก PDF...", "info");

    const pdfText = await extractTextFromPdfUrl(pdfUrl);
    console.log("===== PDF TEXT START =====");
    console.log(pdfText);
    console.log("===== PDF TEXT END =====");

    const parsed = parseAgingText(pdfText);

    parsed.analyzed_at = new Date().toISOString();
    parsed.analyzed_by = currentUser.id;

    const completed = completeFinancialAnalysis(requestId, card, parsed);

    renderAnalysisInCard(card, completed);
    autoFillAccountingFields(card, completed);

    /* ── อัปเดต allRequests cache ทันทีหลัง analyze ──
       เพื่อให้ buildRequestCard ครั้งต่อไปได้ข้อมูลครบ  */
    const rowIdx = allRequests.findIndex((r) => r.id === requestId);
    if (rowIdx !== -1) {
      allRequests[rowIdx] = {
        ...allRequests[rowIdx],
        financial_analysis: completed,
        accounting_risk_level: completed.risk_level,
        credit_status: completed.credit_status,
        credit_remaining: completed.credit_remaining,
      };
    }

    const { error } = await window.supabaseClient
      .from("approval_requests")
      .update({
        financial_analysis: completed,
        accounting_risk_level: completed.risk_level,
        credit_status: completed.credit_status,
        credit_remaining: completed.credit_remaining,
        accounting_checked_by: currentUser.id,
        accounting_checked_at: new Date().toISOString(),
      })
      .eq("id", requestId);
    if (error) throw error;

    showSuccessModal(
  "อ่าน PDF สำเร็จ",
  "ระบบอ่าน PDF และคำนวณข้อมูลเรียบร้อยแล้ว"
);
  } catch (err) {
    console.error(err);
    showToast("อ่าน PDF ไม่สำเร็จ: " + (err.message || err), "error");
  } finally {
    if (analyzeBtn) {
      analyzeBtn.disabled = false;
      setButtonContent(analyzeBtn, "auto_awesome", "อ่านข้อมูลจาก PDF");
    }
  }
}

async function extractTextFromPdfUrl(url) {
  const pdf = await pdfjsLib.getDocument(url).promise;
  let fullText = "";
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    fullText += content.items.map((item) => item.str).join(" ") + "\n";
  }
  return fullText;
}

function parseAgingText(text) {
  const raw = String(text || "");

  const clean = raw
    .replace(/,/g, "")
    .replace(/[□■\uFFFD]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const reportDate = findText(clean, /วันที่\s*:\s*(\d{2}\/\d{2}\/\d{2})/);

  const customerMatch = clean.match(/รวม\s+(.+?)\s+\/([ก-ฮ]\d+)/);
  const customerName = cleanCustomerName(customerMatch?.[1] || "-");
  const customerCode = customerMatch?.[2]?.trim() || "-";

  const totalLineMatch = clean.match(
    /รวมทั้งสิ้น\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/,
  );

  if (!totalLineMatch) {
    throw new Error(
      "อ่านยอดรวมจาก PDF ไม่ได้: ไม่พบบรรทัด 'รวมทั้งสิ้น' ที่มีตัวเลขครบ 8 คอลัมน์ กรุณาตรวจสอบว่า PDF เป็นรายงาน Aging ที่ถูกต้อง และไม่ใช่ไฟล์สแกน",
    );
  }

  const nums = totalLineMatch.slice(1).map(Number);

  const overdue60 = nums[0] || 0;
  const within60 = nums[1] || 0;
  const within30 = nums[2] || 0;
  const overdue1_7 = nums[3] || 0;
  const overdue8_15 = nums[4] || 0;
  const overdue16_30 = nums[5] || 0;
  const overdue30 = nums[6] || 0;
  const total = nums[7] || 0;

  const overdue30Total = overdue30 + overdue60;
  const overdue30Percent = total > 0 ? (overdue30Total / total) * 100 : 0;

  const oldestOverdueDays = findOldestOverdueDays(raw);

  let riskLevel = "low";
  let riskReason = "ยอดค้างเกิน 30 วันอยู่ในระดับต่ำ";
  let reduceRate = 0;

  if (oldestOverdueDays > 45 || overdue30Percent > 40 || overdue60 > 0) {
    riskLevel = "high";
    riskReason = "มีบิลค้างเกินกำหนดหลายรายการ หรือค้างนานเกิน 45 วัน";
    reduceRate = 0.4;
  } else if (oldestOverdueDays > 30 || overdue30Percent >= 20) {
    riskLevel = "medium";
    riskReason =
      "มีบิลค้างเกินกำหนดเกิน 30 วัน หรือยอดค้างเกิน 30 วันอยู่ในระดับปานกลาง";
    reduceRate = 0.2;
  }

  const recommendedLimit = Math.round(total * 1.2 * (1 - reduceRate));

  return {
    customer_name: customerName,
    customer_code: customerCode,
    report_date: reportDate || "-",

    total_outstanding: total,
    not_yet_due: within30 + within60,
    overdue_1_7: overdue1_7,
    overdue_8_15: overdue8_15,
    overdue_16_30: overdue16_30,
    overdue_30_plus: overdue30,
    overdue_60_plus: overdue60,

    oldest_overdue_days: oldestOverdueDays,
    total_invoices: countInvoices(clean),
    partial_payment_count: countPartialPayments(clean),
    has_credit_note: clean.includes("RE"),

    risk_level: riskLevel,
    risk_reason: riskReason,
    recommended_limit: recommendedLimit,

    summary_th:
      `ยอดคงค้างรวม ${formatMoney(total)} ` +
      `มียอดค้างเกิน 30 วัน ${formatMoney(overdue30Total)} ` +
      `คิดเป็น ${overdue30Percent.toFixed(1)}% ของยอดรวม ` +
      `ค้างนานสุด ${oldestOverdueDays || "-"} วัน ` +
      `ระบบประเมินความเสี่ยงระดับ ${
        riskLevel === "low" ? "ต่ำ" : riskLevel === "medium" ? "ปานกลาง" : "สูง"
      }`,
  };
}

function cleanCustomerName(name) {
  return String(name || "-")
    .replace(/[□■\uFFFD]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findOldestOverdueDays(text) {
  const raw = String(text || "");
  const days = [];

  const cleaned = raw.replace(/-[\d,]+\.\d{2}\s+\d+/g, "SKIP");

  const matches = cleaned.matchAll(/[\d,]+\.\d{2}\s+(\d{1,3})(?=\s)/g);
  for (const m of matches) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 500) days.push(n);
  }

  return days.length ? Math.max(...days) : 0;
}

function completeFinancialAnalysis(requestId, card, data) {
  const row = allRequests.find((r) => r.id === requestId) || {};

  const verifiedInput = toNumber(
    card.querySelector("[data-field='verifiedCredit']")?.value || "",
  );

  const verifiedCredit =
    verifiedInput ||
    Number(row.accounting_verified_credit_limit || 0) ||
    Number(row.current_credit_limit || 0) ||
    Number(data.verified_credit_limit || 0) ||
    null;

  const totalOutstanding = Number(data.total_outstanding || 0);

  const creditRemaining = verifiedCredit
    ? verifiedCredit - totalOutstanding
    : null;

  const creditStatus = getCreditStatus(
    creditRemaining,
    verifiedCredit,
    totalOutstanding,
  );

  return {
    ...data,
    verified_credit_limit: verifiedCredit,
    credit_remaining: creditRemaining,
    credit_status: creditStatus,
    risk_level: data.risk_level || "low",
    risk_reason: data.risk_reason || "ยอดค้างเกิน 30 วันอยู่ในระดับต่ำ",
  };
}

function findText(text, regex) {
  return text.match(regex)?.[1]?.trim() || "";
}
function countInvoices(text) {
  return (text.match(/\bIV\d{7}\b/g) || []).length;
}
function countPartialPayments(text) {
  return (text.match(/\?IV\d{7}/g) || []).length;
}

/* ================================================================
   TEMPLATE CLONING — analysis body
================================================================ */

function renderAnalysisInCard(card, data) {
  const panel = card.querySelector(".js-analysis-panel");
  const body = card.querySelector(".js-analysis-body");
  const badge = card.querySelector(".js-analysis-badge");
  if (!panel || !body || !data) return;

  const tpl = document.getElementById("tpl-analysis-body");
  const fragment = tpl.content.cloneNode(true);

  const agingGrid = fragment.querySelector(".aging-grid");
  const rowTpl = document.getElementById("tpl-aging-row");

  const rowDefs = [
    ["ยอดคงค้างรวม", data.total_outstanding, true],
    ["ยังไม่ถึงกำหนด", data.not_yet_due, false],
    ["ค้าง 1–7 วัน", data.overdue_1_7, false],
    ["ค้าง 8–15 วัน", data.overdue_8_15, false],
    ["ค้าง 16–30 วัน", data.overdue_16_30, false],
    ["ค้างเกิน 30 วัน", data.overdue_30_plus, false],
    ["ค้างเกิน 60 วัน", data.overdue_60_plus, false],
  ];

  rowDefs.forEach(([label, val, isBold]) => {
    if (val === undefined || val === null) return;

    const rowEl = rowTpl.content.cloneNode(true).querySelector(".aging-row");
    if (isBold) rowEl.classList.add("aging-total");

    rowEl.querySelector("[data-bind='label']").textContent = label;
    rowEl.querySelector("[data-bind='value']").textContent =
      Number(val).toLocaleString("th-TH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) + " บาท";

    agingGrid.appendChild(rowEl);
  });

  const overdue30 = Number(data.overdue_30_plus || 0);
  const overdue60 = Number(data.overdue_60_plus || 0);
  const totalOutstanding = Number(data.total_outstanding || 0);

  const overduePct =
    totalOutstanding > 0
      ? (((overdue30 + overdue60) / totalOutstanding) * 100).toFixed(1)
      : "0.0";

  bind(fragment, "customerName", data.customer_name || "-");
  bind(fragment, "reportDate", data.report_date || "-");
  bind(fragment, "overduePct", overduePct + "%");

  bind(
    fragment,
    "oldestOverdue",
    data.oldest_overdue_days ? data.oldest_overdue_days + " วัน" : "-",
  );

  bind(
    fragment,
    "verifiedCreditLimit",
    data.verified_credit_limit
      ? Number(data.verified_credit_limit).toLocaleString("th-TH") + " บาท"
      : "-",
  );

  bind(
    fragment,
    "creditRemaining",
    data.credit_remaining !== undefined && data.credit_remaining !== null
      ? Number(data.credit_remaining).toLocaleString("th-TH") + " บาท"
      : "-",
  );

  const riskLevel = data.risk_level || "";
  const riskLabel =
    data.risk_label ||
    {
      low: "ต่ำ",
      medium: "ปานกลาง",
      high: "สูง",
    }[riskLevel] ||
    "-";

  const riskClass =
    {
      low: "risk-low",
      medium: "risk-medium",
      high: "risk-high",
    }[riskLevel] || "";

  const riskBadge = fragment.querySelector(".risk-badge");
  if (riskBadge) {
    riskBadge.textContent = riskLabel;
    if (riskClass) riskBadge.classList.add(riskClass);
  }

  bind(fragment, "creditStatus", data.credit_status || "-");

  const overduePctEl = fragment.querySelector(".js-overdue-pct");
  if (overduePctEl && Number(overduePct) > 30) {
    overduePctEl.classList.add("text-red");
  }

  const oldestEl = fragment.querySelector(".js-oldest-overdue");
  if (oldestEl && Number(data.oldest_overdue_days || 0) > 60) {
    oldestEl.classList.add("text-red");
  }

  const remainEl = fragment.querySelector(".js-credit-remaining");
  if (remainEl) {
    remainEl.classList.add(
      Number(data.credit_remaining || 0) < 0 ? "text-red" : "text-green",
    );
  }

  const statusEl = fragment.querySelector(".js-credit-status");
  if (statusEl) {
    const remaining = Number(data.credit_remaining || 0);

    if (remaining < 0) {
      statusEl.classList.add("text-red");
    } else if (data.credit_status === "ใกล้เต็มวงเงิน") {
      statusEl.classList.add("text-orange");
    } else {
      statusEl.classList.add("text-green");
    }
  }

  const reasonEl = fragment.querySelector(".js-aging-reason");
  if (reasonEl && data.risk_reason) {
    bind(fragment, "riskReason", data.risk_reason);
    reasonEl.style.display = "";
  }

  const summaryEl = fragment.querySelector(".js-aging-summary");
  if (summaryEl && data.summary_th) {
    bind(fragment, "summaryTh", data.summary_th);
    summaryEl.style.display = "";
  }

  body.innerHTML = "";
  body.appendChild(fragment);

  if (badge && data.analyzed_at) {
    badge.textContent = "วิเคราะห์แล้ว · " + formatDateText(data.analyzed_at);
  }

  panel.style.display = "";
}

/* ── Auto-fill accounting form fields ──────────────────────── */
function autoFillAccountingFields(card, data) {
  const riskEl = card.querySelector("[data-field='risk']");
  if (riskEl && data.risk_level && !riskEl.value)
    riskEl.value = data.risk_level;

  const verifiedEl = card.querySelector("[data-field='verifiedCredit']");
  if (verifiedEl && !verifiedEl.value.trim() && data.verified_credit_limit) {
    verifiedEl.value = Number(data.verified_credit_limit).toLocaleString(
      "th-TH",
    );
  }

  const sumEl = card.querySelector("[data-field='summary']");
  if (sumEl && data.summary_th && !sumEl.value.trim())
    sumEl.value = data.summary_th;
}

/* ── Accounting signature canvas ────────────────────────── */
function initSignatureSection(card, row) {
  const modal = card.querySelector(".js-signature-modal");
  const canvas = card.querySelector(".js-signature-canvas");
  const hint = card.querySelector(".js-signature-hint");
  const img = card.querySelector(".js-signature-image");
  const imgWrap = card.querySelector(".js-signature-image-wrap");
  const empty = card.querySelector(".js-signature-empty");

  if (!modal || !canvas) return;

  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const existingSignature =
    row.financial_analysis?.accounting_signature_data || "";
  if (existingSignature) {
    card.dataset.accountingSignatureData = existingSignature;
    showSignaturePreview(card, existingSignature);
    restoreSignatureToCanvas(canvas, existingSignature);
  }

  let drawing = false;

  function getPos(evt) {
    const rect = canvas.getBoundingClientRect();
    const source = evt.touches?.[0] || evt.changedTouches?.[0] || evt;
    return {
      x: (source.clientX - rect.left) * (canvas.width / rect.width),
      y: (source.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function startDraw(evt) {
    evt.preventDefault();
    drawing = true;
    const pos = getPos(evt);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    hint?.classList.add("hidden");
  }

  function draw(evt) {
    if (!drawing) return;
    evt.preventDefault();
    const pos = getPos(evt);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }

  function stopDraw() {
    drawing = false;
  }

  canvas.addEventListener("mousedown", startDraw);
  canvas.addEventListener("mousemove", draw);
  window.addEventListener("mouseup", stopDraw);
  canvas.addEventListener("mouseleave", stopDraw);
  canvas.addEventListener("touchstart", startDraw, { passive: false });
  canvas.addEventListener("touchmove", draw, { passive: false });
  canvas.addEventListener("touchend", stopDraw);

  card.querySelector(".js-open-signature")?.addEventListener("click", () => {
    modal.classList.add("show");
    setTimeout(
      () =>
        resizeSignatureCanvas(
          canvas,
          hint,
          card.dataset.accountingSignatureData,
        ),
      30,
    );
  });

  card.querySelector(".js-close-signature")?.addEventListener("click", () => {
    modal.classList.remove("show");
  });

  modal.addEventListener("click", (evt) => {
    if (evt.target === modal) modal.classList.remove("show");
  });

  card.querySelector(".js-clear-signature")?.addEventListener("click", () => {
    clearSignatureCanvas(canvas, hint);
  });

  card.querySelector(".js-save-signature")?.addEventListener("click", () => {
    if (isCanvasBlank(canvas)) {
      showToast("กรุณาเซ็นลายเซ็นก่อนบันทึก", "warn");
      return;
    }

    const dataUrl = canvas.toDataURL("image/png");
    card.dataset.accountingSignatureData = dataUrl;
    showSignaturePreview(card, dataUrl);
    modal.classList.remove("show");
    showToast("บันทึกลายเซ็นในหน้านี้แล้ว ✓", "success");
  });

  card
    .querySelector(".js-clear-signature-display")
    ?.addEventListener("click", () => {
      delete card.dataset.accountingSignatureData;
      clearSignatureCanvas(canvas, hint);
      if (img) img.removeAttribute("src");
      imgWrap?.classList.add("hidden");
      empty?.classList.remove("hidden");
      showToast("ลบลายเซ็นออกจากหน้านี้แล้ว", "info");
    });
}

function showSignaturePreview(card, dataUrl) {
  const img = card.querySelector(".js-signature-image");
  const imgWrap = card.querySelector(".js-signature-image-wrap");
  const empty = card.querySelector(".js-signature-empty");

  if (img) img.src = dataUrl;
  imgWrap?.classList.remove("hidden");
  empty?.classList.add("hidden");
}

function clearSignatureCanvas(canvas, hint) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  hint?.classList.remove("hidden");
}

function restoreSignatureToCanvas(canvas, dataUrl) {
  const img = new Image();
  img.onload = () => {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };
  img.src = dataUrl;
}

function resizeSignatureCanvas(canvas, hint, dataUrl = "") {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const oldDataUrl =
    dataUrl || (isCanvasBlank(canvas) ? "" : canvas.toDataURL("image/png"));
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);

  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2.6 * ratio;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (oldDataUrl) {
    restoreSignatureToCanvas(canvas, oldDataUrl);
    hint?.classList.add("hidden");
  } else {
    hint?.classList.remove("hidden");
  }
}

function isCanvasBlank(canvas) {
  const ctx = canvas.getContext("2d");
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return !pixels.some((value) => value !== 0);
}



function showSuccessModal(title, message) {
  document.getElementById("successTitle").textContent = title;
  document.getElementById("successMessage").textContent = message;

  document
    .getElementById("successModal")
    .classList.remove("hidden");
}

function closeSuccessModal() {
  document
    .getElementById("successModal")
    .classList.add("hidden");
}



/* ── Small DOM helpers ─────────────────────────────────────── */

function makeEmptyState(message) {
  const el = document.createElement("div");
  el.className = "empty-state";
  el.textContent = message;
  return el;
}

function setButtonContent(btn, iconName, label) {
  btn.textContent = "";
  const icon = document.createElement("span");
  icon.className = "material-symbols-outlined";
  icon.textContent = iconName;
  btn.appendChild(icon);
  btn.appendChild(document.createTextNode(label));
}

/* ── Global exports ─────────────────────────────────────────── */
window.setFilter = setFilter;
window.renderRequests = renderRequests;
window.loadAccountingRequests = loadAccountingRequests;
window.toggleRequestCard = toggleRequestCard;
window.openSidebar = openSidebar;
window.closeSidebar = closeSidebar;