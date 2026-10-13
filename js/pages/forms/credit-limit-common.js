// =====================================================
// credit-limit-common.js — ขออนุมัติวงเงินเครดิตชั่วคราว (ใช้ร่วม: หน้าเซลล์ / ผู้บริหาร)
// ต้องโหลด special-price-common.js ก่อน (escHtml, fmtMoney, formatDateTH, formatDateTimeTH ฯลฯ)
//
// ลำดับอนุมัติ (approval_requests · request_type = "credit_limit_temp") — ดูจากคอลัมน์ status
//   1) เซลล์ส่ง            → status "accounting_review"   (request_status "accounting_review")
//   2) ฝ่ายบัญชีตรวจ        → ส่งต่อ: status "manager_review" · ส่งกลับแก้ไข: status "revision_required"
//                            (credit-limit-finance · ผลตรวจเก็บใน accounting_* และ financial_analysis)
//   3) Manager อนุมัติ      → status "executive_review"
//   4) ผู้บริหาร (ขั้นสุดท้าย) → request_status + status "approved" / "rejected" (executive-ApprovalDoc)
// =====================================================
"use strict";

const CL_TYPE = "credit_limit_temp";
const CL_PAYMENTS = ["โอนเงิน", "เช็ค", "เงินสด"];

function clFinal(r) {
  const rs = r?.request_status, st = r?.status;
  if (["approved", "exec_approved"].includes(rs) || st === "approved") return "approved";
  if (["rejected", "exec_rejected"].includes(rs) || st === "rejected") return "rejected";
  return "";
}

/** สถานะสำหรับแสดงผล: key · label · cls · stage (1 ส่ง, 2 บัญชี, 3 Manager, 4 ผู้บริหาร) · done · action */
function clStatus(r) {
  const fin = clFinal(r);
  if (fin === "approved") return { key: "approved", label: "อนุมัติแล้ว", cls: "is-ok", stage: 5, done: true };
  if (fin === "rejected") return { key: "rejected", label: "ไม่อนุมัติ", cls: "is-bad", stage: 4, done: true };
  const st = String(r?.status || r?.request_status || "accounting_review");
  if (st === "revision_required") return { key: "revision", label: "บัญชีส่งกลับให้แก้ไข", cls: "is-warn", stage: 2, done: false, action: true };
  if (st === "manager_review" || st === "waiting_manager") return { key: "manager", label: "รอ Manager อนุมัติ", cls: "is-info", stage: 3, done: false };
  if (st === "executive_review" || st === "waiting_ceo") return { key: "executive", label: "รอผู้บริหารอนุมัติ", cls: "is-info", stage: 4, done: false };
  if (st === "draft") return { key: "draft", label: "ร่าง", cls: "", stage: 1, done: false };
  return { key: "accounting", label: "รอฝ่ายบัญชีตรวจสอบ", cls: "", stage: 2, done: false };
}

function clDocNo(r) {
  const y = new Date(r?.created_at || Date.now()).getFullYear();
  return `APP-${y}-CREDIT-${String(r?.id || "").slice(0, 8).toUpperCase()}`;
}

function clPayments(r) {
  const p = r?.payment_methods;
  if (Array.isArray(p)) return p;
  if (typeof p === "string" && p.trim()) { try { const a = JSON.parse(p); if (Array.isArray(a)) return a; } catch (e) { return p.split(",").map((x) => x.trim()).filter(Boolean); } }
  return [];
}

// ไทม์ไลน์ 4 ขั้น (ใช้ class .sp-tl เดียวกับราคาพิเศษ)
function clTimelineHTML(r) {
  const s = clStatus(r);
  const at = (n) => (s.stage > n ? "ok" : s.stage === n ? (s.key === "revision" ? "warn" : "now") : "");
  let exec = at(4);
  if (s.key === "approved") exec = "ok";
  if (s.key === "rejected") exec = "bad";
  const step = (st, label, sub) => `<li class="${st ? "is-" + st : ""}"><i></i><b>${label}</b>${sub ? `<span>${escHtml(sub)}</span>` : ""}</li>`;
  return `<ol class="sp-tl is-4">
    ${step("ok", "ส่งคำขอ", formatDateTimeTH(r.created_at))}
    ${step(at(2), "ฝ่ายบัญชี", s.key === "revision" ? "ส่งกลับให้แก้ไข" : s.stage > 2 ? (r.accounting_checked_at ? formatDateTimeTH(r.accounting_checked_at) : "ตรวจแล้ว") : s.stage === 2 ? "กำลังตรวจสอบ" : "")}
    ${step(at(3), "Manager", s.stage === 3 ? "กำลังพิจารณา" : s.stage > 3 ? "ผ่าน" : "")}
    ${step(exec, "ผู้บริหาร", s.key === "executive" ? "กำลังพิจารณา" : r.approved_at ? formatDateTimeTH(r.approved_at) : "")}
  </ol>`;
}

// แผนที่จากแถวในฐานข้อมูล → ข้อมูลเอกสาร
function clDocFromRow(r) {
  const fa = r.financial_analysis || {};
  const fin = clFinal(r);
  return {
    row: r, id: r.id, created_at: r.created_at, doc_date: r.request_date,
    customer: r.shop_name, shop_code: r.shop_code, province: r.province,
    requester: r.sale_name, sale_order_no: r.sale_order_no,
    current_credit_limit: r.current_credit_limit, credit_term: r.credit_term, payment_methods: clPayments(r),
    request_amount: r.request_amount, reason: r.reason || r.request_detail,
    signature: r.signature,
    accounting: (r.accounting_summary || r.accounting_recommendation || r.accounting_verified_credit_limit || fa.total_outstanding) ? {
      verified: r.accounting_verified_credit_limit ?? fa.verified_credit_limit, outstanding: fa.total_outstanding,
      remaining: r.credit_remaining ?? fa.credit_remaining, credit_status: r.credit_status || fa.credit_status,
      risk: r.accounting_risk_level || fa.risk_level, summary: r.accounting_summary || fa.summary,
      recommendation: r.accounting_recommendation || fa.recommendation, signature: fa.accounting_signature_data || null,
      at: r.accounting_checked_at,
    } : null,
    exec: fin ? { decision: fin, comment: r.approval_comment || r.exec_comment, signature: r.approval_signature || r.exec_signature, at: r.approved_at } : null,
  };
}

// เอกสาร A4 ใบขออนุมัติวงเงินเครดิตชั่วคราว (ใช้ทั้งตัวอย่างก่อนส่ง / หน้าเซลล์ / หน้าผู้บริหาร)
function clBuildDocHTML(d) {
  const st = d.row ? clStatus(d.row) : null;
  const a = d.accounting;
  const money = (n) => (n === null || n === undefined || n === "" ? "-" : `${fmtMoney(n)} บาท`);
  const stamp = d.exec ? `<div class="cl-stamp ${d.exec.decision === "approved" ? "ok" : "bad"}">${d.exec.decision === "approved" ? "อนุมัติ" : "ไม่อนุมัติ"}</div>` : "";
  const sig = (url, name, role, date, note) => `<div class="sb"><div class="si">${url ? `<img src="${escHtml(url)}" alt="ลายเซ็น">` : ""}</div><div class="sn">(${escHtml(name || "..........................................")})</div><div class="sr">${escHtml(role)}${note ? ` · <b>${escHtml(note)}</b>` : ""}</div><div class="sd">${date ? "วันที่ " + escHtml(date) : "วันที่ ......../......../........"}</div></div>`;
  const pm = (d.payment_methods || []);
  return `
<style>
.cl-doc{font-family:'Kanit',sans-serif;font-size:12.5px;color:#1a1a1a;line-height:1.45;position:relative}
.cl-doc .hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1.5px solid #1a1a1a;padding-bottom:6px;margin-bottom:10px}
.cl-doc .cn{font-size:17px;font-weight:700}.cl-doc .tt{font-size:14px;font-weight:600}.cl-doc .st{font-size:11px;color:#555}
.cl-doc .no{text-align:right;font-size:11.5px;color:#444}.cl-doc .no b{display:block;font-size:12.5px;color:#111}
.cl-doc table{width:100%;border-collapse:collapse;margin-bottom:10px;table-layout:fixed}
.cl-doc .mt th{width:17%;text-align:left;background:#f4f6f9;color:#444;font-weight:600;border:1px solid #c8ced6;padding:5px 8px;vertical-align:top}
.cl-doc .mt td{border:1px solid #c8ced6;padding:5px 9px;white-space:pre-wrap}
.cl-doc .am{width:62%;margin-left:auto}.cl-doc .am td{border:1px solid #c8ced6;padding:5px 10px;font-size:13px}.cl-doc .am td:last-child{text-align:right;font-variant-numeric:tabular-nums}
.cl-doc .am tr.k td{background:#eef2f7;font-weight:700}
.cl-doc .bx{border:1px solid #b7bec8;border-radius:3px;padding:6px 10px;margin-bottom:8px;white-space:pre-wrap;font-size:13px}
.cl-doc .ml{font-weight:700;color:#444;margin-right:4px}
.cl-doc h4{margin:12px 0 6px;font-size:13px;font-weight:700;border-left:3px solid #1a1a1a;padding-left:7px}
.cl-doc .ck{display:inline-flex;align-items:center;gap:4px;margin-right:14px}.cl-doc .ck i{width:12px;height:12px;border:1px solid #333;display:inline-grid;place-items:center;font-style:normal;font-size:10px;line-height:1}
.cl-doc .sg{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;text-align:center;margin-top:18px}
.cl-doc .si{height:56px;border-bottom:1px solid #555;display:flex;align-items:flex-end;justify-content:center}.cl-doc .si img{max-height:54px;max-width:100%;mix-blend-mode:multiply}
.cl-doc .sn{font-weight:600;margin-top:4px;font-size:12px}.cl-doc .sr,.cl-doc .sd{color:#555;font-size:11px}
.cl-doc .cl-stamp{position:absolute;right:170px;top:-6px;transform:rotate(-8deg);padding:3px 14px;border:3px solid;border-radius:8px;font-size:19px;font-weight:700;opacity:.85}
.cl-doc .cl-stamp.ok{color:#15803d;border-color:#15803d}.cl-doc .cl-stamp.bad{color:#b91c1c;border-color:#b91c1c}
</style>
<div class="cl-doc">
  ${stamp}
  <div class="hd"><div><div class="cn">บริษัท เอิร์นนี่ แอดวานซ์ จำกัด</div><div class="tt">ใบขออนุมัติวงเงินเครดิตชั่วคราว</div><div class="st">Temporary Credit Limit Approval</div></div>
    <div class="no">${d.id ? `เลขที่<b>${escHtml(clDocNo(d.row || d))}</b>` : "<b>ร่าง — ยังไม่ส่ง</b>"}${st ? `สถานะ: ${escHtml(st.label)}` : ""}</div></div>
  <table class="mt"><tbody>
    <tr><th>ลูกค้า</th><td>${escHtml(d.customer || "-")}</td><th>รหัส / จังหวัด</th><td>${escHtml(d.shop_code || "-")}${d.province ? " / " + escHtml(d.province) : ""}</td></tr>
    <tr><th>ผู้ขอ (เซลล์)</th><td>${escHtml(d.requester || "-")}</td><th>วันที่เอกสาร</th><td>${formatDateTH(d.doc_date)}</td></tr>
    <tr><th>เลขที่ SO / ใบกำกับ</th><td>${escHtml(d.sale_order_no || "-")}</td><th>เครดิต (วัน)</th><td>${escHtml(d.credit_term || "-")}</td></tr>
    <tr><th>วิธีชำระเงิน</th><td colspan="3">${CL_PAYMENTS.map((p) => `<span class="ck"><i>${pm.includes(p) ? "✓" : ""}</i>${p}</span>`).join("")}${pm.filter((p) => !CL_PAYMENTS.includes(p)).map((p) => `<span class="ck"><i>✓</i>${escHtml(p)}</span>`).join("")}</td></tr>
  </tbody></table>
  <table class="am"><tbody>
    <tr><td>วงเงินเครดิตปัจจุบัน</td><td>${money(d.current_credit_limit)}</td></tr>
    <tr class="k"><td>ยอดบิลที่ขอเปิด (รวมภาษี)</td><td>${money(d.request_amount)}</td></tr>
  </tbody></table>
  <div class="bx"><span class="ml">เหตุผลการขอ :</span>${escHtml(d.reason || "-")}</div>
  ${a ? `<h4>ผลตรวจสอบฝ่ายบัญชี</h4>
  <table class="mt"><tbody>
    <tr><th>วงเงินที่บัญชียืนยัน</th><td>${money(a.verified)}</td><th>ยอดค้างชำระรวม</th><td>${money(a.outstanding)}</td></tr>
    <tr><th>วงเงินคงเหลือ</th><td>${money(a.remaining)}</td><th>สถานะเครดิต / ความเสี่ยง</th><td>${escHtml([a.credit_status, a.risk].filter(Boolean).join(" · ") || "-")}</td></tr>
    ${a.summary ? `<tr><th>สรุป</th><td colspan="3">${escHtml(a.summary)}</td></tr>` : ""}
    ${a.recommendation ? `<tr><th>ความเห็นบัญชี</th><td colspan="3">${escHtml(a.recommendation)}</td></tr>` : ""}
  </tbody></table>` : ""}
  ${d.exec ? `<div class="bx"><span class="ml">ผลพิจารณาผู้บริหาร :</span>${d.exec.decision === "approved" ? "อนุมัติ" : "ไม่อนุมัติ"}${d.exec.comment ? " — " + escHtml(d.exec.comment) : ""}</div>` : ""}
  <div class="sg">
    ${sig(d.signature, d.requester, "ผู้ขออนุมัติ (เซลล์)", d.created_at ? formatDateTH(String(d.created_at).slice(0, 10)) : formatDateTH(d.doc_date))}
    ${sig(a?.signature, null, "ฝ่ายบัญชี (ตรวจสอบ)", a?.at ? formatDateTH(String(a.at).slice(0, 10)) : "")}
    ${sig(null, null, "ผู้จัดการ (Manager)", "")}
    ${sig(d.exec?.signature, null, "ผู้บริหาร (อนุมัติขั้นสุดท้าย)", d.exec?.at ? formatDateTH(String(d.exec.at).slice(0, 10)) : "", d.exec ? (d.exec.decision === "approved" ? "อนุมัติ" : "ไม่อนุมัติ") : "")}
  </div>
</div>`;
}

function clPrintPage(body) {
  return spPrintPage(body).replace("<title>ใบขออนุมัติราคาพิเศษ</title>", "<title>ใบขออนุมัติวงเงินเครดิตชั่วคราว</title>");
}
