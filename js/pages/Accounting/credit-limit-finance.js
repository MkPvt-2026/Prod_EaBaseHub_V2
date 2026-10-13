/* ================================================================
   credit-limit-finance.js v2 — ฝ่ายบัญชีตรวจสอบคำขอวงเงินชั่วคราว
   ต้องโหลด special-price-common.js + credit-limit-common.js ก่อน
   (escHtml, fmtMoney, formatDateTH, createSignaturePad, clStatus, clDocNo, clPayments, clBuildDocHTML ...)

   ลำดับ (approval_requests · request_type "credit_limit_temp" · ดูขั้นจากคอลัมน์ status):
     เซลล์ส่ง          → status "accounting_review"
     ฝ่ายบัญชี (หน้านี้)  → ส่งต่อ Manager: status / request_status "manager_review" (accounting_status "forwarded_to_manager")
                         ส่งกลับให้แก้ไข: status / request_status "revision_required" (accounting_status "sent_back_to_sale")
                         เซลล์แก้แล้วส่งกลับ → status "accounting_review" + accounting_status "resubmitted"
     Manager → ผู้บริหาร (executive-ApprovalDoc) อนุมัติขั้นสุดท้าย
   บันทึก / ส่งต่อ / ส่งกลับ ทำได้เฉพาะคำขอที่ยังอยู่ขั้นบัญชี (กันกดซ้ำ / ทับขั้นถัดไป)
   ผลตรวจ: accounting_* + credit_remaining / credit_status + financial_analysis (ยอดจาก PDF, ลายเซ็นบัญชี)
   PDF รายงานลูกหนี้: Storage bucket "approval-financial-docs" (ส่วนตัว · เปิดด้วยลิงก์ชั่วคราว)
================================================================ */
"use strict";

const BUCKET_NAME = "approval-financial-docs";
const CL_TYPES = ["credit_limit_temp", "temporary_credit_limit", "credit_limit"];
const ACC_STAGE = ["accounting_review", "pending"];
const RISK = { low: "ต่ำ", medium: "ปานกลาง", high: "สูง" };
const LIST_COLS = "id, request_type, status, request_status, accounting_status, shop_name, shop_code, province, sale_name, sale_order_no, request_amount, current_credit_limit, accounting_risk_level, accounting_checked_at, financial_pdf_name, approved_at, created_at, updated_at";
const TAB_OF = { accounting: "review", draft: "review", revision: "revision", manager: "forwarded", executive: "forwarded", approved: "closed", rejected: "closed" };

const $ = (id) => document.getElementById(id);
const money = (n) => (n === null || n === undefined || n === "" || !isFinite(Number(n)) ? "-" : `${fmtMoney(n)} บาท`);
const numOrNull = (v) => { const s = String(v ?? "").replace(/,/g, "").replace(/[^\d.-]/g, "").trim(); if (!s) return null; const n = Number(s); return isFinite(n) ? n : null; };
const fmtInput = (n) => (n === null || n === undefined || n === "" ? "" : Number(n).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

let me = { id: null, name: "" };
let rows = [];          // รายการ (แบบเบา)
let R = null;           // คำขอที่เปิดอยู่ (แถวเต็ม)
let tab = "review";
let accSig = null;
let dirty = false;
let busy = false;
let _openSeq = 0;

/* ================================================================
   เริ่มต้น
================================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  const hd = $("headerDateText");
  if (hd) hd.textContent = new Date().toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" });
  for (let i = 0; i < 50 && typeof supabaseClient === "undefined"; i++) await new Promise((r) => setTimeout(r, 100));
  if (typeof supabaseClient === "undefined") return;

  accSig = createSignaturePad("fSigCanvas", "fSigWrap", "fSigHint", markDirty);
  $("cfTabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-tab]"); if (b) setTab(b.dataset.tab); });
  $("cfSearch").addEventListener("input", renderList);
  ["fVerified", "fOutstanding"].forEach((id) => {
    const el = $(id);
    el.addEventListener("input", () => { markDirty(); renderCalc(); });
    el.addEventListener("blur", () => { const n = numOrNull(el.value); el.value = n === null ? "" : fmtInput(n); });
    el.addEventListener("focus", () => { const n = numOrNull(el.value); el.value = n === null ? "" : String(n); });
  });
  ["fSummary", "fRecommend"].forEach((id) => $(id).addEventListener("input", markDirty));
  document.querySelectorAll("input[name='fRisk']").forEach((r) => r.addEventListener("change", markDirty));
  $("btnSave").addEventListener("click", saveDraft);
  $("btnBack").addEventListener("click", askSendBack);
  $("btnForward").addEventListener("click", askForward);
  $("pdfInput").addEventListener("change", uploadPdf);
  $("cfModal").addEventListener("click", (e) => { if (e.target.id === "cfModal") closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  loadMe();
  await loadList();
  const q = new URLSearchParams(location.search).get("id");
  if (q) openRequest(q);
});

async function loadMe() {
  try {
    const { session, profile } = typeof eaGetMyProfile === "function" ? await eaGetMyProfile() : {};
    me.id = session?.user?.id || null;
    me.name = profile?.display_name || profile?.full_name || session?.user?.email || "ฝ่ายบัญชี";
  } catch (e) { /* ignore */ }
  setText("userName", me.name);
  setText("fWho", me.name);
}

/* ================================================================
   รายการคำขอ
================================================================ */
function tabOf(r) { return TAB_OF[clStatus(r).key] || "review"; }
const inAccStage = (r) => !!r && clStatus(r).key === "accounting";

async function loadList() {
  const box = $("cfItems");
  box.innerHTML = `<div class="ed-state">กำลังโหลด...</div>`;
  try {
    const q = (sel) => supabaseClient.from("approval_requests").select(sel).in("request_type", CL_TYPES).order("created_at", { ascending: false }).limit(300);
    let { data, error } = await q(LIST_COLS);
    if (error) { console.warn("loadList (light):", error.message); ({ data, error } = await q("*")); if (error) throw error; }
    rows = (data || []).filter((r) => clStatus(r).key !== "draft");
    renderList();
    if (R) { const fresh = rows.find((x) => String(x.id) === String(R.id)); if (fresh) highlight(); }
  } catch (e) {
    box.innerHTML = `<div class="ed-state is-error">โหลดไม่สำเร็จ: ${escHtml(e.message || "")}<br><button type="button" class="er-btn is-ghost" onclick="loadList()">ลองใหม่</button></div>`;
  }
}

function setTab(t) {
  tab = t;
  document.querySelectorAll("#cfTabs button").forEach((b) => b.classList.toggle("is-on", b.dataset.tab === t));
  renderList();
}

function waitDays(r) {
  const from = new Date(r.accounting_status === "resubmitted" && r.updated_at ? r.updated_at : r.created_at);
  return Math.max(0, Math.floor((Date.now() - from) / 86400000));
}

function renderList() {
  const cnt = { review: 0, revision: 0, forwarded: 0, closed: 0 };
  rows.forEach((r) => { cnt[tabOf(r)]++; });
  setText("cntReview", cnt.review); setText("cntRevision", cnt.revision); setText("cntForwarded", cnt.forwarded); setText("cntClosed", cnt.closed);
  const nb = $("navPendingBadge"); if (nb) { nb.hidden = !cnt.review; nb.textContent = cnt.review > 99 ? "99+" : cnt.review; }

  const kw = $("cfSearch").value.trim().toLowerCase();
  const list = rows.filter((r) => tabOf(r) === tab).filter((r) => !kw || [clDocNo(r), r.shop_name, r.shop_code, r.sale_name, r.sale_order_no, r.province].join(" ").toLowerCase().includes(kw));
  if (tab === "review") list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); // มาก่อนตรวจก่อน
  const box = $("cfItems");
  if (!list.length) {
    box.innerHTML = `<div class="ed-state">${kw ? "ไม่พบรายการที่ค้นหา" : tab === "review" ? "ไม่มีคำขอรอตรวจสอบ 🎉" : "ยังไม่มีรายการ"}</div>`;
    return;
  }
  box.innerHTML = list.map((r) => {
    const st = clStatus(r), d = waitDays(r);
    const ratio = Number(r.current_credit_limit) > 0 ? Math.round((Number(r.request_amount) / Number(r.current_credit_limit)) * 100) : null;
    return `<button type="button" class="cf-item${R && String(R.id) === String(r.id) ? " is-active" : ""}" data-id="${escHtml(r.id)}" onclick="openRequest('${escHtml(r.id)}')">
      <span class="cf-item-top"><b>${escHtml(r.shop_name || "-")}</b>${tab === "review" ? `<span class="cf-wait${d >= 3 ? " is-late" : ""}">${d ? `รอ ${d} วัน` : "วันนี้"}</span>` : `<span class="er-pill ${pillCls(st)}">${escHtml(st.label)}</span>`}</span>
      <span class="cf-item-sub">${escHtml(r.sale_name || "-")} · ${escHtml(clDocNo(r))}</span>
      <span class="cf-item-sub"><span class="cf-amt">${money(r.request_amount)}</span>${ratio !== null ? `<span class="${ratio > 100 ? "is-high" : ""}">${ratio}% ของวงเงิน</span>` : ""}${r.financial_pdf_name ? `<span class="material-symbols-outlined" title="มี PDF รายงานลูกหนี้">picture_as_pdf</span>` : ""}</span>
      ${r.accounting_status === "resubmitted" && tab === "review" ? `<span class="cf-tag">เซลล์แก้ไขแล้วส่งกลับ</span>` : ""}
    </button>`;
  }).join("");
}
function highlight() { document.querySelectorAll(".cf-item").forEach((b) => b.classList.toggle("is-active", R && b.dataset.id === String(R.id))); }
function pillCls(st) { return ({ approved: "is-ok", rejected: "is-bad", revision: "is-warn", accounting: "is-warn" })[st.key] || "is-info"; }

/* ================================================================
   เปิดคำขอ (ดึงแถวเต็ม)
================================================================ */
async function openRequest(id) {
  if (R && String(R.id) === String(id)) return;
  if (dirty && !confirm("ข้อมูลที่กรอกยังไม่บันทึก — เปิดคำขออื่น?")) return;
  const seq = ++_openSeq;
  $("cfEmpty").hidden = true; $("cfBody").hidden = false;
  $("cfBody").classList.add("is-loading");
  try {
    const { data, error } = await supabaseClient.from("approval_requests").select("*").eq("id", id).maybeSingle();
    if (seq !== _openSeq) return;
    if (error) throw error;
    if (!data) { toast("ไม่พบคำขอนี้ หรือไม่มีสิทธิ์เปิดดู", true); return; }
    R = data;
    const lite = rows.find((x) => String(x.id) === String(id));
    if (lite) Object.assign(lite, pick(R, LIST_COLS));
    if (tabOf(R) !== tab) setTab(tabOf(R)); else highlight();
    history.replaceState(null, "", `?id=${encodeURIComponent(R.id)}`);
    renderDetail();
    if (window.innerWidth <= 1100) $("cfDetail").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    toast("เปิดคำขอไม่สำเร็จ: " + (e.message || e), true);
  } finally {
    if (seq === _openSeq) $("cfBody").classList.remove("is-loading");
  }
}
function pick(o, cols) { return Object.fromEntries(cols.split(",").map((c) => c.trim()).filter((c) => c in o).map((c) => [c, o[c]])); }

function renderDetail() {
  const r = R, st = clStatus(r);
  setText("dShop", r.shop_name || "-");
  setText("dNo", clDocNo(r));
  setText("dSub", `เซลล์ ${r.sale_name || "-"} · ส่งเมื่อ ${formatDateTimeTH(r.created_at)}`);
  const sp = $("dStatus"); sp.textContent = st.label; sp.className = `er-pill ${pillCls(st)}`;
  $("dResub").hidden = r.accounting_status !== "resubmitted" || !inAccStage(r);
  renderSteps();

  // ข้อมูลคำขอ
  const lim = Number(r.current_credit_limit) || 0, amt = Number(r.request_amount) || 0;
  const ratio = lim > 0 ? `${Math.round((amt / lim) * 100)}% ของวงเงิน` : "";
  const info = [
    ["ลูกค้า", `${escHtml(r.shop_name || "-")}${r.shop_code ? ` <small>(${escHtml(r.shop_code)})</small>` : ""}`],
    ["จังหวัด", escHtml(r.province || "-")],
    ["เซลล์", escHtml(r.sale_name || "-")],
    ["เลขที่ SO / ใบกำกับ", escHtml(r.sale_order_no || "-")],
    ["วันที่เอกสาร", formatDateTH(r.request_date)],
    ["เครดิต (วัน)", escHtml(r.credit_term || "-")],
    ["วิธีชำระ", escHtml(clPayments(r).join(", ") || "-")],
    ["วงเงินปัจจุบัน (เซลล์แจ้ง)", money(r.current_credit_limit)],
    ["ยอดบิลที่ขอเปิด", `<b class="cf-key">${money(r.request_amount)}</b>${ratio ? ` <small class="${amt > lim ? "is-high" : ""}">${ratio}</small>` : ""}`],
  ];
  $("dInfo").innerHTML = info.map(([k, v]) => `<div><dt>${escHtml(k)}</dt><dd>${v}</dd></div>`).join("");
  $("dReason").innerHTML = `<b>เหตุผลของเซลล์</b><p>${escHtml(r.reason || r.request_detail || "-")}</p>`;

  renderPdf();

  // ฟอร์ม / อ่านอย่างเดียว
  const editable = inAccStage(r);
  $("accForm").hidden = !editable;
  $("accReadonly").hidden = editable;
  if (editable) fillForm();
  else $("accReadonly").innerHTML = readonlyHTML();
  dirty = false; $("fDirty").hidden = true; err("");
}

function renderSteps() {
  const s = clStatus(R);
  const at = (n) => (s.stage > n ? "ok" : s.stage === n ? (s.key === "revision" ? "warn" : "now") : "");
  let ex = at(4); if (s.key === "approved") ex = "ok"; if (s.key === "rejected") ex = "bad";
  const step = (state, label, sub) => `<li class="${state ? "is-" + state : ""}"><i></i><b>${label}</b><span>${escHtml(sub || "")}</span></li>`;
  $("dSteps").innerHTML =
    step("ok", "เซลล์ส่งคำขอ", formatDateTimeTH(R.created_at)) +
    step(at(2), "ฝ่ายบัญชีตรวจสอบ", s.key === "revision" ? "ส่งกลับให้แก้ไข" : s.stage > 2 ? (R.accounting_checked_at ? formatDateTimeTH(R.accounting_checked_at) : "ตรวจแล้ว") : "กำลังตรวจ") +
    step(at(3), "Manager", s.stage === 3 ? "กำลังพิจารณา" : s.stage > 3 ? "ผ่าน" : "") +
    step(ex, "ผู้บริหาร", s.key === "executive" ? "กำลังพิจารณา" : R.approved_at ? formatDateTimeTH(R.approved_at) : "");
}

function readonlyHTML() {
  const r = R, fa = r.financial_analysis || {}, s = clStatus(r);
  const head = s.key === "revision"
    ? `<div class="cf-note is-warn"><span class="material-symbols-outlined">assignment_return</span><div><b>ส่งกลับให้เซลล์แก้ไขแล้ว</b><p>${escHtml(r.accounting_recommendation || "-")}</p><small>รอเซลล์แก้ไขแล้วส่งกลับ — จะกลับมาอยู่ในแท็บ “รอตรวจสอบ”</small></div></div>`
    : `<div class="cf-note"><span class="material-symbols-outlined">verified</span><div><b>${escHtml(s.key === "approved" ? "ผู้บริหารอนุมัติแล้ว" : s.key === "rejected" ? "ไม่อนุมัติ" : "ส่งต่อแล้ว — " + s.label)}</b><small>ตรวจโดยฝ่ายบัญชี ${r.accounting_checked_at ? "· " + escHtml(formatDateTimeTH(r.accounting_checked_at)) : ""}</small></div></div>`;
  const dl = [
    ["วงเงินที่ยืนยัน", money(r.accounting_verified_credit_limit ?? fa.verified_credit_limit)],
    ["ยอดค้างชำระรวม", money(fa.total_outstanding)],
    ["วงเงินคงเหลือ", money(r.credit_remaining ?? fa.credit_remaining)],
    ["สถานะวงเงิน", escHtml(r.credit_status || fa.credit_status || "-")],
    ["ความเสี่ยง", escHtml(RISK[r.accounting_risk_level || fa.risk_level] || "-")],
    ["สรุปผลตรวจ", escHtml(r.accounting_summary || fa.summary || "-")],
    ["ความเห็นถึง Manager", escHtml(s.key === "revision" ? "-" : r.accounting_recommendation || "-")],
  ];
  const sig = fa.accounting_signature_data ? `<div class="cf-sig-ro"><img src="${escHtml(fa.accounting_signature_data)}" alt="ลายเซ็นฝ่ายบัญชี"></div>` : "";
  const hist = (fa.sendbacks || []).slice().reverse().map((h) => `<li>${escHtml(formatDateTimeTH(h.at))} · ${escHtml(h.by_name || "")}: ${escHtml(h.note || "")}</li>`).join("");
  return `${head}<dl class="ad-dl">${dl.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>${sig}${hist ? `<details class="cf-hist"><summary>ประวัติการส่งกลับ (${fa.sendbacks.length})</summary><ul>${hist}</ul></details>` : ""}`;
}

/* ---------- ฟอร์มผลตรวจ ---------- */
function fillForm() {
  const r = R, fa = r.financial_analysis || {};
  $("fVerified").value = fmtInput(r.accounting_verified_credit_limit ?? fa.verified_credit_limit ?? null);
  $("fOutstanding").value = fmtInput(fa.total_outstanding ?? null);
  setText("fOutSrc", fa.total_outstanding != null ? (fa.total_outstanding_source === "manual" ? "· กรอกเอง" : fa.analyzed_at ? "· จาก PDF" : "") : "");
  const risk = r.accounting_risk_level || fa.risk_level || "";
  document.querySelectorAll("input[name='fRisk']").forEach((x) => { x.checked = x.value === risk; });
  setText("fRiskHint", fa.analyzed_at && fa.risk_level ? `ระบบประเมินจาก PDF: ${RISK[fa.risk_level] || fa.risk_level}` : "");
  $("fSummary").value = r.accounting_summary || fa.summary || "";
  $("fRecommend").value = r.accounting_status === "sent_back_to_sale" ? "" : (r.accounting_recommendation || fa.recommendation || "");
  accSig.set(fa.accounting_signature_data || null);
  requestAnimationFrame(() => accSig.refit());
  renderCalc();
}

// ตัวเลขสรุป: คงเหลือ = วงเงินที่ยืนยัน − ยอดค้าง · หลังเปิดบิลนี้ = คงเหลือ − ยอดบิลที่ขอ
function calcNow() {
  const verified = numOrNull($("fVerified").value), outstanding = numOrNull($("fOutstanding").value);
  const remaining = verified === null ? null : verified - (outstanding || 0);
  const after = remaining === null ? null : remaining - (Number(R?.request_amount) || 0);
  return { verified, outstanding, remaining, after, status: getCreditStatus(remaining, verified, outstanding || 0) };
}
function renderCalc() {
  if (!R) return;
  const c = calcNow();
  const cls = (n) => (n === null ? "" : n < 0 ? "is-bad" : "is-ok");
  $("fCalc").innerHTML = `
    <div><span>วงเงินคงเหลือ</span><b class="${cls(c.remaining)}">${money(c.remaining)}</b></div>
    <div><span>ยอดบิลที่ขอเปิด</span><b>${money(R.request_amount)}</b></div>
    <div class="is-key"><span>คงเหลือหลังเปิดบิลนี้</span><b class="${cls(c.after)}">${c.after === null ? "-" : (c.after < 0 ? "เกิน " + money(-c.after) : money(c.after))}</b></div>
    <div><span>สถานะวงเงิน</span><b>${escHtml(c.status)}</b></div>`;
}

function getCreditStatus(remaining, verifiedLimit, totalOutstanding) {
  if (!verifiedLimit || verifiedLimit <= 0) return "ยังไม่กรอกวงเงิน";
  if (remaining === null || remaining === undefined) return "-";
  if (remaining < 0) return "เกินวงเงิน";
  if (remaining <= verifiedLimit * 0.1) return "ใกล้เต็มวงเงิน";
  if (totalOutstanding >= verifiedLimit * 0.7) return "ใช้วงเงินสูง";
  return "ปกติ";
}

function markDirty() { if (!R || !inAccStage(R)) return; dirty = true; $("fDirty").hidden = false; }
function err(msg) { $("fErr").textContent = msg; $("fErr").hidden = !msg; }

// ค่าที่จะบันทึก (รวม financial_analysis เดิมไว้ไม่ให้ข้อมูลจาก PDF หาย)
function collect() {
  const r = R, fa = r.financial_analysis || {}, c = calcNow();
  const risk = document.querySelector("input[name='fRisk']:checked")?.value || null;
  const summary = $("fSummary").value.trim(), recommendation = $("fRecommend").value.trim();
  const outChanged = c.outstanding !== (fa.total_outstanding ?? null);
  const analysis = {
    ...fa,
    total_outstanding: c.outstanding,
    ...(outChanged ? { total_outstanding_source: "manual" } : {}),
    verified_credit_limit: c.verified, credit_remaining: c.remaining, credit_status: c.status,
    risk_level: risk || fa.risk_level || null, summary, recommendation,
    accounting_signature_data: accSig.get() || null,
    accounting_name: me.name, updated_at: new Date().toISOString(), updated_by: me.id,
  };
  return {
    accounting_verified_credit_limit: c.verified, credit_remaining: c.remaining, credit_status: c.status,
    accounting_risk_level: risk, accounting_summary: summary || null, accounting_recommendation: recommendation || null,
    financial_analysis: analysis, accounting_checked_by: me.id, accounting_checked_at: new Date().toISOString(),
  };
}

// อัปเดตเฉพาะคำขอที่ยังอยู่ขั้นบัญชี · ไม่มีแถวกลับมา = ถูกส่งต่อไปแล้ว / ไม่มีสิทธิ์ (RLS)
async function writeAcc(update) {
  const { data, error } = await supabaseClient.from("approval_requests").update({ ...update, updated_at: new Date().toISOString() })
    .eq("id", R.id).in("status", ACC_STAGE).select();
  if (error) throw error;
  if (!data || !data.length) throw new Error("คำขอนี้ไม่ได้อยู่ขั้นฝ่ายบัญชีแล้ว หรือไม่มีสิทธิ์แก้ไข — กรุณารีเฟรช");
  return data[0];
}
async function afterWrite(row, msg) {
  R = { ...R, ...row };
  dirty = false; $("fDirty").hidden = true;
  const lite = rows.find((x) => String(x.id) === String(R.id));
  if (lite) Object.assign(lite, pick(R, LIST_COLS));
  renderList(); renderDetail();
  toast(msg);
}

async function saveDraft() {
  if (busy || !inAccStage(R)) return;
  err(""); busy = true; setBusy(true);
  try {
    const row = await writeAcc({ ...collect(), accounting_status: R.accounting_status === "resubmitted" ? "resubmitted" : "draft" });
    await afterWrite(row, "บันทึกร่างผลตรวจแล้ว");
  } catch (e) { err("บันทึกไม่สำเร็จ: " + (e.message || e)); }
  finally { busy = false; setBusy(false); }
}
function setBusy(on) { ["btnSave", "btnBack", "btnForward"].forEach((id) => { $(id).disabled = on; }); }

/* ---------- ส่งต่อ Manager ---------- */
function askForward() {
  if (busy || !inAccStage(R)) return;
  const p = collect(), c = calcNow(), problems = [];
  if (!(c.verified > 0)) problems.push("ยังไม่กรอกวงเงินเครดิตที่ยืนยัน");
  if (!p.accounting_risk_level) problems.push("ยังไม่เลือกระดับความเสี่ยง");
  if ((p.accounting_recommendation || "").length < 5) problems.push("กรุณาเขียนความเห็นถึง Manager (อย่างน้อย 5 ตัวอักษร)");
  if (!accSig.get()) problems.push("ยังไม่ได้ลงนามผู้ตรวจสอบ");
  if (problems.length) { err("ยังส่งต่อไม่ได้: " + problems.join(" · ")); return; }
  err("");
  const warn = c.outstanding === null ? `<div class="cf-note is-warn"><span class="material-symbols-outlined">warning</span><div><b>ยังไม่มียอดค้างชำระ</b><small>ไม่ได้อัปโหลด PDF หรือกรอกยอดค้าง — Manager จะไม่เห็นยอดค้างของลูกค้า</small></div></div>` : "";
  openModal("ยืนยันส่งต่อ Manager", `${warn}
    <dl class="ad-dl cf-confirm">
      <dt>ลูกค้า</dt><dd>${escHtml(R.shop_name || "-")} · ${escHtml(clDocNo(R))}</dd>
      <dt>ยอดบิลที่ขอเปิด</dt><dd><b>${money(R.request_amount)}</b></dd>
      <dt>วงเงินที่ยืนยัน</dt><dd>${money(c.verified)}</dd>
      <dt>ยอดค้างชำระรวม</dt><dd>${money(c.outstanding)}</dd>
      <dt>คงเหลือหลังเปิดบิล</dt><dd class="${c.after < 0 ? "is-bad" : ""}">${c.after === null ? "-" : c.after < 0 ? "เกิน " + money(-c.after) : money(c.after)}</dd>
      <dt>ความเสี่ยง</dt><dd>${escHtml(RISK[p.accounting_risk_level] || "-")} · ${escHtml(c.status)}</dd>
      <dt>ความเห็นถึง Manager</dt><dd>${escHtml(p.accounting_recommendation)}</dd>
    </dl>`,
    `<button type="button" class="er-btn is-ghost" onclick="closeModal()">กลับไปแก้ไข</button>
     <button type="button" class="er-btn cf-primary" id="mOk"><span class="material-symbols-outlined">send</span>ยืนยันส่งต่อ Manager</button>`);
  $("mOk").onclick = doForward;
}
async function doForward() {
  if (busy) return;
  busy = true; setBusy(true); $("mOk").disabled = true;
  try {
    const row = await writeAcc({ ...collect(), status: "manager_review", request_status: "manager_review", accounting_status: "forwarded_to_manager" });
    // แจ้ง Manager ของเซลล์ (คำขอผ่านบัญชีแล้ว) + แจ้งเซลล์ว่าผ่านขั้นบัญชี
    window.eaApprovalNotify?.notifyNewRequest({ type: "credit_limit_temp", id: R.id, requesterId: R.request_by, requesterName: R.sale_name, shopName: R.shop_name });
    window.eaApprovalNotify?.notifyDecision({ type: "credit_limit_temp", requesterId: R.request_by, shopName: R.shop_name, decision: "forwarded", by: "ฝ่ายบัญชี" });
    closeModal();
    await afterWrite(row, "ส่งต่อ Manager แล้ว");
  } catch (e) { closeModal(); err("ส่งต่อไม่สำเร็จ: " + (e.message || e)); }
  finally { busy = false; setBusy(false); }
}

/* ---------- ส่งกลับให้เซลล์แก้ไข ---------- */
function askSendBack() {
  if (busy || !inAccStage(R)) return;
  openModal("ส่งกลับให้เซลล์แก้ไข", `
    <p class="ad-muted">เซลล์จะเห็นข้อความนี้ในหน้า “ขออนุมัติวงเงินชั่วคราว” แล้วแก้ไขคำขอเดิมส่งกลับมา</p>
    <label class="ad-field"><span>สิ่งที่ต้องแก้ / ข้อมูลที่ต้องเพิ่ม <i>*</i></span>
      <textarea id="mNote" rows="4" maxlength="1000" placeholder="เช่น ยอดค้างชำระ 2 บิลเกิน 60 วัน กรุณาแนบกำหนดชำระจากลูกค้า และแก้ยอดบิลให้ตรงใบสั่งขาย"></textarea></label>
    <div class="ad-err" id="mErr" hidden></div>`,
    `<button type="button" class="er-btn is-ghost" onclick="closeModal()">ยกเลิก</button>
     <button type="button" class="er-btn is-warn" id="mOk"><span class="material-symbols-outlined">assignment_return</span>ส่งกลับให้เซลล์</button>`);
  setTimeout(() => $("mNote")?.focus(), 50);
  $("mOk").onclick = doSendBack;
}
async function doSendBack() {
  if (busy) return;
  const note = $("mNote").value.trim();
  if (note.length < 10) { $("mErr").textContent = "กรุณาเขียนสิ่งที่ต้องแก้อย่างน้อย 10 ตัวอักษร"; $("mErr").hidden = false; return; }
  busy = true; setBusy(true); $("mOk").disabled = true;
  try {
    const p = collect();
    const fa = { ...p.financial_analysis, sendbacks: [...(R.financial_analysis?.sendbacks || []), { at: new Date().toISOString(), by: me.id, by_name: me.name, note }] };
    // ข้อความถึงเซลล์ใช้ช่อง accounting_recommendation (หน้าเซลล์แสดงช่องนี้)
    const row = await writeAcc({ ...p, financial_analysis: fa, accounting_recommendation: note, status: "revision_required", request_status: "revision_required", accounting_status: "sent_back_to_sale" });
    window.eaApprovalNotify?.notifyDecision({ type: "credit_limit_temp", requesterId: R.request_by, shopName: R.shop_name, decision: "revision", by: "ฝ่ายบัญชี", comment: note });
    closeModal();
    await afterWrite(row, "ส่งกลับให้เซลล์แก้ไขแล้ว");
  } catch (e) { $("mErr").textContent = "ส่งกลับไม่สำเร็จ: " + (e.message || e); $("mErr").hidden = false; }
  finally { busy = false; setBusy(false); if ($("mOk")) $("mOk").disabled = false; }
}

/* ---------- เอกสาร A4 (รวมค่าที่กรอกอยู่ แม้ยังไม่บันทึก) ---------- */
function openDocPreview() {
  if (!R) return;
  const row = inAccStage(R) ? { ...R, ...collect() } : R;
  const html = clBuildDocHTML(clDocFromRow(row));
  openModal(`เอกสาร ${clDocNo(R)}`, `<div class="cf-paper">${html}</div>`,
    `${inAccStage(R) && dirty ? `<small class="cf-dirty">แสดงค่าที่กรอกอยู่ (ยังไม่บันทึก)</small>` : ""}
     <button type="button" class="er-btn is-ghost" onclick="closeModal()">ปิด</button>
     <button type="button" class="er-btn" id="mPrint"><span class="material-symbols-outlined">print</span>พิมพ์ / PDF</button>`, true);
  $("mPrint").onclick = () => spOpenPrint(clPrintPage(html));
}

/* ---------- modal ---------- */
function openModal(title, body, foot, wide) {
  setText("cfModalTitle", title);
  $("cfModalBody").innerHTML = body;
  $("cfModalFoot").innerHTML = foot;
  $("cfModal").classList.toggle("is-wide", !!wide);
  $("cfModal").hidden = false;
}
function closeModal() { $("cfModal").hidden = true; $("cfModalBody").innerHTML = ""; }

let _toastT = null;
function toast(msg, bad) {
  const el = $("erToast");
  el.textContent = msg;
  el.classList.toggle("is-err", !!bad);
  el.classList.add("is-show");
  clearTimeout(_toastT);
  _toastT = setTimeout(() => el.classList.remove("is-show"), 3200);
}
window.addEventListener("beforeunload", (e) => { if (dirty && !busy) { e.preventDefault(); e.returnValue = ""; } });

/* ================================================================
   PDF รายงานลูกหนี้ — อัปโหลด / เปิด / ลบ / อ่านตัวเลข (pdf.js + ตัวแยกข้อความ)
================================================================ */
function renderPdf() {
  const r = R, fa = r.financial_analysis || {}, canEdit = inAccStage(r);
  const has = !!r.financial_pdf_url;
  setText("pdfBadge", fa.analyzed_at ? `อ่านแล้ว · ${formatDateTimeTH(fa.analyzed_at)}` : "");
  $("pdfBox").innerHTML = has
    ? `<div class="cf-file"><span class="material-symbols-outlined">picture_as_pdf</span>
        <div><b>${escHtml(r.financial_pdf_name || "รายงานลูกหนี้.pdf")}</b><small>ไฟล์ส่วนตัว · เปิดด้วยลิงก์ชั่วคราว</small></div>
        <button type="button" class="er-btn is-ghost" onclick="openPdf()"><span class="material-symbols-outlined">open_in_new</span>เปิด</button>
        ${canEdit ? `<button type="button" class="er-icon-btn" onclick="deletePdf()" title="ลบไฟล์" aria-label="ลบไฟล์ PDF"><span class="material-symbols-outlined">delete</span></button>` : ""}
      </div>
      ${canEdit ? `<button type="button" class="er-btn cf-analyze" id="btnAnalyze" onclick="analyzePdf()"><span class="material-symbols-outlined">auto_awesome</span>${fa.analyzed_at ? "อ่านตัวเลขจาก PDF อีกครั้ง" : "อ่านตัวเลขจาก PDF"}</button>` : ""}`
    : canEdit
      ? `<button type="button" class="cf-drop" id="pdfDrop" onclick="document.getElementById('pdfInput').click()">
          <span class="material-symbols-outlined">upload_file</span><b>อัปโหลดรายงานลูกหนี้คงค้าง (PDF)</b><small>คลิกหรือลากไฟล์มาวาง · ไม่เกิน 15MB · ไม่บังคับ (กรอกยอดค้างเองได้)</small></button>`
      : `<p class="ad-muted">ไม่ได้แนบรายงานลูกหนี้</p>`;
  const drop = $("pdfDrop");
  if (drop) {
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("is-over"); }));
    drop.addEventListener("drop", (e) => { const f = e.dataTransfer?.files?.[0]; if (f) uploadPdf({ target: { files: [f], value: "" } }); });
  }
  renderAging(fa);
}

function renderAging(fa) {
  const box = $("agingBox");
  if (!fa || fa.total_outstanding == null || !fa.analyzed_at) { box.hidden = true; box.innerHTML = ""; return; }
  const total = Number(fa.total_outstanding) || 0;
  const over = (Number(fa.overdue_30_plus) || 0) + (Number(fa.overdue_60_plus) || 0);
  const pct = total > 0 ? (over / total) * 100 : 0;
  const rowsDef = [["ยังไม่ถึงกำหนด", fa.not_yet_due], ["ค้าง 1–7 วัน", fa.overdue_1_7], ["ค้าง 8–15 วัน", fa.overdue_8_15], ["ค้าง 16–30 วัน", fa.overdue_16_30], ["ค้างเกิน 30 วัน", fa.overdue_30_plus, true], ["ค้างเกิน 60 วัน", fa.overdue_60_plus, true]];
  box.hidden = false;
  box.innerHTML = `
    <table class="cf-aging-t"><tbody>
      ${rowsDef.map(([k, v, warn]) => `<tr${warn && Number(v) > 0 ? ' class="is-warn"' : ""}><td>${k}</td><td>${money(v || 0)}</td></tr>`).join("")}
      <tr class="is-total"><td>ยอดคงค้างรวม (ตาม PDF)</td><td>${money(total)}</td></tr>
    </tbody></table>
    <div class="cf-aging-meta">
      <span>ลูกค้าใน PDF <b>${escHtml(fa.customer_name || "-")}</b></span>
      <span>วันที่รายงาน <b>${escHtml(fa.report_date || "-")}</b></span>
      <span>ค้างเกิน 30 วัน <b class="${pct > 30 ? "is-bad" : ""}">${pct.toFixed(1)}%</b></span>
      <span>ค้างนานสุด <b class="${Number(fa.oldest_overdue_days) > 60 ? "is-bad" : ""}">${fa.oldest_overdue_days ? fa.oldest_overdue_days + " วัน" : "-"}</b></span>
    </div>
    ${fa.risk_reason ? `<p class="cf-aging-why"><span class="material-symbols-outlined">info</span>${escHtml(fa.risk_reason)}</p>` : ""}`;
}

async function signedPdfUrl() {
  const stored = R?.financial_pdf_url || "";
  if (!stored) return "";
  if (/^https?:\/\//i.test(stored)) return stored;
  const { data, error } = await supabaseClient.storage.from(BUCKET_NAME).createSignedUrl(stored, 60 * 60);
  if (error) { console.warn("signed url:", error.message); return ""; }
  return data?.signedUrl || "";
}
async function openPdf() {
  const w = window.open("", "_blank");
  const url = await signedPdfUrl();
  if (!url) { w?.close(); toast("เปิดไฟล์ PDF ไม่ได้", true); return; }
  if (w) w.location.href = url; else window.open(url, "_blank", "noopener");
}

async function uploadPdf(e) {
  const input = e.target, file = input?.files?.[0];
  if (!file || !R || !inAccStage(R)) return;
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) { toast("กรุณาเลือกไฟล์ PDF เท่านั้น", true); input.value = ""; return; }
  if (file.size > 15 * 1024 * 1024) { toast("ไฟล์ใหญ่เกินไป (สูงสุด 15MB)", true); input.value = ""; return; }
  const path = `${R.id}/${Date.now()}-${sanitizeFileName(file.name)}`;
  $("pdfBox").innerHTML = `<div class="ed-state">กำลังอัปโหลด ${escHtml(file.name)}...</div>`;
  try {
    const { error: upErr } = await supabaseClient.storage.from(BUCKET_NAME).upload(path, file, { cacheControl: "3600", upsert: false, contentType: "application/pdf" });
    if (upErr) throw upErr;
    const old = R.financial_pdf_url;
    const row = await writeAcc({ financial_pdf_url: path, financial_pdf_name: file.name, accounting_status: R.accounting_status === "resubmitted" ? "resubmitted" : "uploaded_pdf", accounting_checked_by: me.id, accounting_checked_at: new Date().toISOString() });
    if (old && !/^https?:\/\//i.test(old)) supabaseClient.storage.from(BUCKET_NAME).remove([old]).catch(() => {});
    R = { ...R, ...row };
    renderPdf();
    toast("อัปโหลด PDF แล้ว — กด “อ่านตัวเลขจาก PDF” เพื่อกรอกยอดค้างอัตโนมัติ");
  } catch (e2) {
    console.error("upload pdf:", e2);
    toast("อัปโหลดไม่สำเร็จ: " + (e2.message || e2), true);
    renderPdf();
  } finally { if (input) input.value = ""; }
}

async function deletePdf() {
  if (!R?.financial_pdf_url || !inAccStage(R)) return;
  if (!confirm("ลบไฟล์ PDF และผลอ่านตัวเลขจาก PDF ของคำขอนี้?")) return;
  try {
    const stored = R.financial_pdf_url;
    const fa = { ...(R.financial_analysis || {}) };
    ["customer_name", "customer_code", "report_date", "not_yet_due", "overdue_1_7", "overdue_8_15", "overdue_16_30", "overdue_30_plus", "overdue_60_plus", "oldest_overdue_days", "total_invoices", "partial_payment_count", "has_credit_note", "risk_reason", "recommended_limit", "summary_th", "analyzed_at", "analyzed_by"].forEach((k) => delete fa[k]);
    if (fa.total_outstanding_source !== "manual") delete fa.total_outstanding;
    const row = await writeAcc({ financial_pdf_url: null, financial_pdf_name: null, financial_analysis: fa, accounting_status: "pdf_deleted" });
    if (!/^https?:\/\//i.test(stored)) supabaseClient.storage.from(BUCKET_NAME).remove([stored]).catch((e) => console.warn("remove pdf:", e));
    R = { ...R, ...row };
    renderPdf(); fillForm();
    toast("ลบไฟล์ PDF แล้ว");
  } catch (e) { toast("ลบไม่สำเร็จ: " + (e.message || e), true); }
}

async function analyzePdf() {
  if (!R || !inAccStage(R)) return;
  if (!window.pdfjsLib) { toast("โหลดตัวอ่าน PDF ไม่สำเร็จ — ตรวจอินเทอร์เน็ตแล้วรีเฟรช", true); return; }
  const btn = $("btnAnalyze");
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="material-symbols-outlined">progress_activity</span>กำลังอ่าน...`; }
  try {
    const url = await signedPdfUrl();
    if (!url) throw new Error("ไม่พบไฟล์ PDF");
    const parsed = parseAgingText(await extractTextFromPdfUrl(url));
    parsed.analyzed_at = new Date().toISOString();
    parsed.analyzed_by = me.id;
    // ผลอ่าน → ยอดค้าง + ความเสี่ยง (ถ้ายังไม่เลือก) · วงเงินที่ยืนยันยังเป็นของผู้ตรวจ (ถ้าว่างใช้วงเงินที่เซลล์แจ้ง)
    const fa = { ...(R.financial_analysis || {}), ...parsed };
    delete fa.total_outstanding_source;
    const verified = numOrNull($("fVerified").value) ?? (Number(R.accounting_verified_credit_limit) || Number(R.current_credit_limit) || null);
    const remaining = verified === null ? null : verified - parsed.total_outstanding;
    fa.verified_credit_limit = verified; fa.credit_remaining = remaining; fa.credit_status = getCreditStatus(remaining, verified, parsed.total_outstanding);
    const pickedRisk = document.querySelector("input[name='fRisk']:checked")?.value || R.accounting_risk_level || parsed.risk_level;
    const row = await writeAcc({
      financial_analysis: fa, accounting_risk_level: pickedRisk, credit_remaining: remaining, credit_status: fa.credit_status,
      accounting_verified_credit_limit: verified, accounting_checked_by: me.id, accounting_checked_at: new Date().toISOString(),
    });
    // เก็บสิ่งที่ผู้ตรวจพิมพ์ไว้ (สรุป/ความเห็น/ลายเซ็น) ไม่ให้หาย
    const keep = { summary: $("fSummary").value, recommend: $("fRecommend").value, sig: accSig.get() };
    R = { ...R, ...row };
    renderPdf(); fillForm();
    $("fSummary").value = keep.summary || parsed.summary_th || "";
    $("fRecommend").value = keep.recommend;
    if (keep.sig) accSig.set(keep.sig);
    if (keep.summary !== $("fSummary").value || keep.sig) markDirty();
    toast("อ่านตัวเลขจาก PDF แล้ว — ตรวจและแก้ไขได้ก่อนส่งต่อ");
  } catch (e) {
    console.error("analyze pdf:", e);
    toast("อ่าน PDF ไม่สำเร็จ: " + (e.message || e), true);
    if (btn) { btn.disabled = false; btn.innerHTML = `<span class="material-symbols-outlined">auto_awesome</span>อ่านตัวเลขจาก PDF`; }
  }
}

function sanitizeFileName(name) {
  const base = String(name || "document.pdf").replace(/\.pdf$/i, "").replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").substring(0, 80);
  return `${base || "file_" + Date.now()}.pdf`;
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

// รายงาน Aging (บรรทัด "รวมทั้งสิ้น" 8 คอลัมน์: >60 · ≤60 · ≤30 · 1–7 · 8–15 · 16–30 · >30 · รวม)
function parseAgingText(text) {
  const raw = String(text || "");
  const clean = raw.replace(/,/g, "").replace(/[□■�]/g, "").replace(/\s+/g, " ").trim();
  const reportDate = (clean.match(/วันที่\s*:\s*(\d{2}\/\d{2}\/\d{2})/) || [])[1] || "";
  const customerMatch = clean.match(/รวม\s+(.+?)\s+\/([ก-ฮ]\d+)/);
  const customerName = String(customerMatch?.[1] || "-").replace(/[□■�]/g, "").replace(/\s+/g, " ").trim();
  const customerCode = customerMatch?.[2]?.trim() || "-";
  const n = "(-?\\d+(?:\\.\\d+)?)";
  const totalLine = clean.match(new RegExp(`รวมทั้งสิ้น\\s+${Array(8).fill(n).join("\\s+")}`));
  if (!totalLine) throw new Error("ไม่พบบรรทัด “รวมทั้งสิ้น” ที่มีตัวเลขครบ 8 คอลัมน์ — ตรวจว่าเป็นรายงาน Aging (ไม่ใช่ไฟล์สแกน) หรือกรอกยอดค้างเอง");
  const [overdue60, within60, within30, overdue1_7, overdue8_15, overdue16_30, overdue30, total] = totalLine.slice(1).map((x) => Number(x) || 0);
  const overdue30Total = overdue30 + overdue60;
  const overdue30Percent = total > 0 ? (overdue30Total / total) * 100 : 0;
  const oldest = findOldestOverdueDays(raw);

  let riskLevel = "low", riskReason = "ยอดค้างเกิน 30 วันอยู่ในระดับต่ำ", reduceRate = 0;
  if (oldest > 45 || overdue30Percent > 40 || overdue60 > 0) { riskLevel = "high"; riskReason = "มีบิลค้างเกิน 60 วัน หรือค้างนานเกิน 45 วัน หรือยอดค้างเกิน 30 วันเกิน 40%"; reduceRate = 0.4; }
  else if (oldest > 30 || overdue30Percent >= 20) { riskLevel = "medium"; riskReason = "มีบิลค้างเกิน 30 วัน หรือยอดค้างเกิน 30 วันอยู่ระหว่าง 20–40%"; reduceRate = 0.2; }

  return {
    customer_name: customerName, customer_code: customerCode, report_date: reportDate || "-",
    total_outstanding: total, not_yet_due: within30 + within60,
    overdue_1_7: overdue1_7, overdue_8_15: overdue8_15, overdue_16_30: overdue16_30, overdue_30_plus: overdue30, overdue_60_plus: overdue60,
    oldest_overdue_days: oldest,
    total_invoices: (clean.match(/\bIV\d{7}\b/g) || []).length,
    partial_payment_count: (clean.match(/\?IV\d{7}/g) || []).length,
    has_credit_note: /\bRE\d/.test(clean),
    risk_level: riskLevel, risk_reason: riskReason, recommended_limit: Math.round(total * 1.2 * (1 - reduceRate)),
    summary_th: `ยอดคงค้างรวม ${money(total)} ค้างเกิน 30 วัน ${money(overdue30Total)} (${overdue30Percent.toFixed(1)}%) ค้างนานสุด ${oldest || "-"} วัน · ระบบประเมินความเสี่ยง${RISK[riskLevel]}`,
  };
}
function findOldestOverdueDays(text) {
  const cleaned = String(text || "").replace(/-[\d,]+\.\d{2}\s+\d+/g, "SKIP");
  const days = [];
  for (const m of cleaned.matchAll(/[\d,]+\.\d{2}\s+(\d{1,3})(?=\s)/g)) { const n = Number(m[1]); if (n >= 1 && n <= 500) days.push(n); }
  return days.length ? Math.max(...days) : 0;
}

window.loadList = loadList;
window.openRequest = openRequest;
