// =====================================================
// special-price-common.js — ใช้ร่วมกันระหว่างหน้าผู้ขอ (special-price-sale) และหน้า Manager (special-price-manager)
//
// ลำดับอนุมัติ (ตาราง approval_requests · request_type = "special_price")
//   1) ผู้ขอส่ง        → request_status "waiting_manager"   status "manager_review"
//   2) Manager อนุมัติ → request_status "pending"           status "executive_review"  (ศูนย์อนุมัติผู้บริหารจึงเห็น)
//      Manager ไม่อนุมัติ → "rejected" / "manager_rejected" · ขอข้อมูลเพิ่ม → "request_more_info" / "manager_more_info"
//   3) ผู้บริหาร        → request_status "approved" / "rejected" / "request_more_info" (ศูนย์อนุมัติเดิมเป็นผู้บันทึก)
//   ผลของ Manager เก็บใน payload.manager = { decision, comment, signature, by, name, at }
// =====================================================
"use strict";

const SP_TYPE = "special_price";
const SP_HIGH_DISCOUNT_PCT = 30;

// ---------- ตัวช่วยทั่วไป ----------
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function escHtml(t) { return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function toISO(d) { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); }
function todayISO() { return toISO(new Date()); }
const fmtMoney = (n) => (Number(n) || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = (n) => (Number(n) || 0).toLocaleString("th-TH", { maximumFractionDigits: 2 });
const fmtPct = (n) => `${(Number(n) || 0).toFixed(2)}%`;
function formatDateTH(ds) { if (!ds) return "-"; const p = String(ds).slice(0, 10).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : ds; }
function formatDateTimeTH(iso) { if (!iso) return "-"; return new Date(iso).toLocaleString("th-TH", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }); }
function numOf(v) { const n = parseFloat(String(v ?? "").replace(/,/g, "")); return isFinite(n) ? n : 0; }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function roleLabel(r) { return ({ sales: "พนักงานขาย", sale: "พนักงานขาย", marketing: "การตลาด", manager: "ผู้จัดการ", admin: "ผู้ดูแลระบบ", executive: "ผู้บริหาร" })[r] || r || "-"; }

// ---------- ผู้ใช้ปัจจุบัน ----------
async function spLoadMe() {
  const me = { id: null, name: "", role: "", area: "", position: "" };
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    me.id = session.user.id;
    const cu = window.currentUser; // protectPage → userService โหลดไว้แล้ว
    const p = cu?.id === me.id && cu.role ? cu
      : (await supabaseClient.from("profiles").select("display_name,full_name,role,area,position").eq("id", me.id).maybeSingle()).data;
    me.name = p?.display_name || p?.full_name || session.user.email || "";
    me.role = String(p?.role || "").toLowerCase();
    me.area = p?.area || "";
    me.position = p?.position || roleLabel(me.role);
  } catch (e) { console.error("spLoadMe:", e); }
  setText("userName", me.name || "-");
  setText("userAvatar", (me.name || "?").trim().charAt(0).toUpperCase());
  return me;
}

// ---------- คำนวณ ----------
function calcItem(it) {
  const qty = Number(it.qty) || 0, np = Number(it.normal_price) || 0, rp = Number(it.request_price) || 0;
  const discount_pct = np > 0 ? round2(((np - rp) / np) * 100) : 0;
  return { ...it, qty, normal_price: np, request_price: rp, discount_pct, diff_total: round2((np - rp) * qty), normal_total: round2(np * qty), request_total: round2(rp * qty) };
}
// ส่วนลดเฉลี่ย = ส่วนต่างรวม ÷ มูลค่าราคาปกติ (ถ่วงตามมูลค่า)
function totalsOf(items) {
  const normal = round2(items.reduce((s, i) => s + i.normal_total, 0));
  const request = round2(items.reduce((s, i) => s + i.request_total, 0));
  const diff = round2(normal - request);
  return { normal, request, diff, pct: normal > 0 ? round2((diff / normal) * 100) : 0, count: items.length };
}
function itemsOf(r) { return Array.isArray(r?.payload?.items) ? r.payload.items.map(calcItem) : []; }

// ---------- สถานะ ----------
function spManager(r) { return r?.payload?.manager || null; }
function spStatus(r) {
  const rs = r?.request_status || r?.status || "waiting_manager";
  const m = spManager(r);
  const byMgr = (d) => m && m.decision === d;
  switch (rs) {
    case "waiting_manager": return { key: rs, label: "รอ Manager อนุมัติ", cls: "", stage: 2, done: false };
    case "pending": return { key: rs, label: "รอผู้บริหารอนุมัติ", cls: "is-info", stage: 3, done: false };
    case "approved": case "exec_approved": return { key: "approved", label: "อนุมัติแล้ว", cls: "is-ok", stage: 4, done: true };
    case "rejected": case "exec_rejected":
      return { key: "rejected", label: byMgr("rejected") ? "Manager ไม่อนุมัติ" : "ผู้บริหารไม่อนุมัติ", cls: "is-bad", stage: byMgr("rejected") ? 2 : 3, done: true };
    case "request_more_info":
      return { key: rs, label: byMgr("request_more_info") ? "Manager ขอข้อมูลเพิ่ม" : "ผู้บริหารขอข้อมูลเพิ่ม", cls: "is-warn", stage: byMgr("request_more_info") ? 2 : 3, done: true };
    default: return { key: rs, label: rs, cls: "", stage: 2, done: false };
  }
}
// ถึงขั้นผู้บริหารแล้วหรือยัง (Manager อนุมัติแล้ว · คำขอรุ่นเก่าที่ไม่มีขั้น Manager ถือว่าถึงแล้ว)
function spReachedExec(r) {
  const m = spManager(r), rs = r?.request_status || r?.status || "waiting_manager";
  return m ? m.decision === "approved" : rs !== "waiting_manager";
}
function spDocNo(r) {
  const y = new Date(r.created_at || Date.now()).getFullYear();
  return `APP-${y}-SPECIAL-PRICE-${String(r.id || "").slice(0, 8).toUpperCase()}`;
}
// ไทม์ไลน์ 3 ขั้น สำหรับการ์ด/รายละเอียด
function spTimelineHTML(r) {
  const s = spStatus(r), m = spManager(r);
  const mgrState = m ? (m.decision === "approved" ? "ok" : m.decision === "rejected" ? "bad" : "warn") : (s.key === "waiting_manager" ? "now" : "");
  let execState = "";
  if (spReachedExec(r)) execState = ({ pending: "now", approved: "ok", rejected: "bad", request_more_info: "warn" })[s.key] || "";
  const step = (st, label, sub) => `<li class="${st ? "is-" + st : ""}"><i></i><b>${label}</b>${sub ? `<span>${escHtml(sub)}</span>` : ""}</li>`;
  return `<ol class="sp-tl">
    ${step("ok", "ส่งคำขอ", formatDateTimeTH(r.created_at))}
    ${step(mgrState, "Manager", m ? `${m.name || ""} · ${formatDateTimeTH(m.at)}` : (s.key === "waiting_manager" ? "กำลังพิจารณา" : ""))}
    ${step(execState, "ผู้บริหาร", execState === "now" ? "กำลังพิจารณา" : r.approved_at ? formatDateTimeTH(r.approved_at) : "")}
  </ol>`;
}

// ---------- ลายเซ็นบนจอ ----------
function createSignaturePad(canvasId, wrapId, hintId, onInk) {
  const c = document.getElementById(canvasId), wrap = document.getElementById(wrapId), hint = document.getElementById(hintId);
  const ctx = c.getContext("2d");
  let hasInk = false, dataUrl = null, drawing = false, last = null;
  const style = () => { ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0f172a"; };
  const drawImage = (url) => {
    const img = new Image();
    img.onload = () => {
      const w = c.clientWidth, h = c.clientHeight;
      ctx.clearRect(0, 0, w, h);
      const s = Math.min(w / img.width, h / img.height); // พอดีกรอบ คงสัดส่วน
      ctx.drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s);
    };
    img.src = url;
  };
  const fit = () => {
    const r = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.max(1, Math.round(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); style();
    if (dataUrl) drawImage(dataUrl);
  };
  const pos = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  c.addEventListener("pointerdown", (e) => { drawing = true; last = pos(e); c.setPointerCapture(e.pointerId); e.preventDefault(); });
  c.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p;
    if (!hasInk) { hasInk = true; if (hint) hint.hidden = true; }
  });
  const end = () => { if (drawing && hasInk) { dataUrl = c.toDataURL("image/png"); onInk && onInk(); } drawing = false; };
  ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => c.addEventListener(ev, end));
  fit();
  window.addEventListener("resize", () => { clearTimeout(c._fitT); c._fitT = setTimeout(fit, 150); });
  return {
    get: () => dataUrl,
    clear() { ctx.clearRect(0, 0, c.width, c.height); hasInk = false; dataUrl = null; if (hint) hint.hidden = false; },
    set(url) { this.clear(); if (url) { dataUrl = url; hasInk = true; if (hint) hint.hidden = true; drawImage(url); } },
    refit: fit,
  };
}

// ---------- เอกสาร A4 ----------
// d: { id, created_at, status(row หรือ null), customer, shop_code, province, quote_no, requester, doc_date, items, reason_type, reason_text,
//      signature, manager{...}, approver_signature, approved_at, exec_comment }
function spBuildDocHTML(d) {
  const items = (d.items || []).map(calcItem);
  const t = totalsOf(items);
  const st = d.row ? spStatus(d.row) : null;
  const m = d.manager || null;
  const rows = items.map((it, i) => `<tr${i % 2 ? ' class="z"' : ""}><td>${i + 1}</td><td class="l">${escHtml(it.name)}${it.code ? `<small>${escHtml(it.code)}</small>` : ""}</td><td>${fmtQty(it.qty)} ${escHtml(it.unit || "")}</td><td class="r">${fmtMoney(it.normal_price)}</td><td class="r">${fmtMoney(it.request_price)}</td><td class="r">${fmtPct(it.discount_pct)}</td><td class="r">${fmtMoney(it.diff_total)}</td></tr>`).join("")
    || `<tr><td colspan="7" style="color:#999;padding:10px">ไม่มีรายการ</td></tr>`;
  const sig = (url, name, role, date, note) => `<div class="sb"><div class="si">${url ? `<img src="${escHtml(url)}" alt="ลายเซ็น">` : ""}</div><div class="sn">(${escHtml(name || "..........................................")})</div><div class="sr">${escHtml(role)}${note ? ` · <b>${escHtml(note)}</b>` : ""}</div><div class="sd">${date ? "วันที่ " + escHtml(date) : "วันที่ ......../......../........"}</div></div>`;
  const decWord = (x) => ({ approved: "อนุมัติ", rejected: "ไม่อนุมัติ", request_more_info: "ขอข้อมูลเพิ่ม" })[x] || "";
  const execDone = !!(st && d.row && spReachedExec(d.row) && st.done);
  const execDecision = execDone ? (st.key === "approved" ? "อนุมัติ" : st.key === "rejected" ? "ไม่อนุมัติ" : "ขอข้อมูลเพิ่ม") : "";
  return `
<style>
.sp-doc{font-family:'Kanit',sans-serif;font-size:12px;color:#1a1a1a;line-height:1.4}
.sp-doc .hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1.5px solid #1a1a1a;padding-bottom:6px;margin-bottom:10px}
.sp-doc .cn{font-size:17px;font-weight:700}.sp-doc .tt{font-size:14px;font-weight:600}
.sp-doc .no{text-align:right;font-size:11.5px;color:#444}.sp-doc .no b{display:block;font-size:12.5px;color:#111}
.sp-doc .meta{display:grid;grid-template-columns:1fr 1fr;border:1px solid #999;border-radius:3px;margin-bottom:10px}
.sp-doc .meta>div{padding:5px 10px;font-size:13px;line-height:1.7}.sp-doc .meta>div:first-child{border-right:1px solid #999}
.sp-doc .ml{font-weight:700;color:#444;margin-right:4px}
.sp-doc table.it{width:100%;border-collapse:collapse;margin-bottom:8px;table-layout:fixed}
.sp-doc .it th{background:#eef2f7;color:#1e293b;padding:5px 4px;border:1px solid #c8d1dc;font-size:12px;font-weight:700}
.sp-doc .it td{padding:4px 5px;border:1px solid #ccc;text-align:center;font-size:12px;vertical-align:top}
.sp-doc .it td.l{text-align:left}.sp-doc .it td.r{text-align:right;font-variant-numeric:tabular-nums}.sp-doc .it tr.z td{background:#f8fafc}
.sp-doc .it small{display:block;color:#64748b;font-size:10.5px}
.sp-doc .tot{width:55%;margin-left:auto;border-collapse:collapse;margin-bottom:10px;font-size:13px}
.sp-doc .tot td{border:1px solid #ccc;padding:3px 8px}.sp-doc .tot td:last-child{text-align:right;font-variant-numeric:tabular-nums}
.sp-doc .tot tr.k td{background:#eef2f7;font-weight:700}
.sp-doc .rs{border:1px solid #ccc;border-radius:3px;padding:6px 10px;margin-bottom:8px;font-size:13px;white-space:pre-wrap}
.sp-doc .dec{border:1px solid #999;border-radius:3px;padding:6px 10px;margin-bottom:6px;font-size:13px;white-space:pre-wrap}
.sp-doc .sg{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;text-align:center;margin-top:14px}
.sp-doc .si{height:58px;border-bottom:1px solid #555;display:flex;align-items:flex-end;justify-content:center}.sp-doc .si img{max-height:56px;max-width:100%}
.sp-doc .sn{font-weight:600;margin-top:4px}.sp-doc .sr,.sp-doc .sd{color:#555;font-size:11.5px}
</style>
<div class="sp-doc">
  <div class="hd"><div><div class="cn">บริษัท เอิร์นนี่ แอดวานซ์ จำกัด</div><div class="tt">ใบขออนุมัติราคาพิเศษ</div></div>
    <div class="no">${d.id ? `เลขที่<b>${escHtml(spDocNo(d))}</b>` : "<b>ร่าง — ยังไม่ส่ง</b>"}${st ? `สถานะ: ${escHtml(st.label)}` : ""}</div></div>
  <div class="meta">
    <div><div><span class="ml">ลูกค้า :</span>${escHtml(d.customer || "-")}</div><div><span class="ml">รหัส / จังหวัด :</span>${escHtml(d.shop_code || "-")}${d.province ? " / " + escHtml(d.province) : ""}</div><div><span class="ml">ใบเสนอราคา / SO :</span>${escHtml(d.quote_no || "-")}</div></div>
    <div><div><span class="ml">ผู้ขอ :</span>${escHtml(d.requester || "-")}</div><div><span class="ml">วันที่เอกสาร :</span>${formatDateTH(d.doc_date)}</div><div><span class="ml">วันที่ส่ง :</span>${d.created_at ? formatDateTimeTH(d.created_at) : "-"}</div></div>
  </div>
  <table class="it"><thead><tr><th style="width:5%">#</th><th style="width:31%">สินค้า</th><th style="width:13%">จำนวน</th><th style="width:13%">ราคาปกติ/หน่วย</th><th style="width:13%">ราคาที่ขอ/หน่วย</th><th style="width:10%">ส่วนลด</th><th style="width:15%">ส่วนต่าง (บาท)</th></tr></thead><tbody>${rows}</tbody></table>
  <table class="tot">
    <tr><td>มูลค่าตามราคาปกติ</td><td>${fmtMoney(t.normal)} บาท</td></tr>
    <tr><td>มูลค่าตามราคาที่ขอ</td><td>${fmtMoney(t.request)} บาท</td></tr>
    <tr class="k"><td>ส่วนต่างรวม (ส่วนลดเฉลี่ย ${fmtPct(t.pct)})</td><td>${fmtMoney(t.diff)} บาท</td></tr>
  </table>
  <div class="rs"><span class="ml">เหตุผล :</span>${escHtml(d.reason_type || "-")}${d.reason_text ? "\n" + escHtml(d.reason_text) : ""}</div>
  ${m ? `<div class="dec"><span class="ml">ความเห็น Manager :</span>${escHtml(decWord(m.decision))}${m.comment ? " — " + escHtml(m.comment) : ""}</div>` : ""}
  ${execDone ? `<div class="dec"><span class="ml">ผลพิจารณาผู้บริหาร :</span>${escHtml(execDecision)}${d.exec_comment ? " — " + escHtml(d.exec_comment) : ""}</div>` : ""}
  <div class="sg">
    ${sig(d.signature, d.requester, "ผู้ขออนุมัติ", d.created_at ? formatDateTH(String(d.created_at).slice(0, 10)) : formatDateTH(d.doc_date))}
    ${sig(m?.signature, m?.name, "ผู้จัดการ (Manager)", m?.at ? formatDateTH(String(m.at).slice(0, 10)) : "", decWord(m?.decision))}
    ${sig(execDone ? d.approver_signature : null, null, "ผู้บริหาร", execDone && d.approved_at ? formatDateTH(String(d.approved_at).slice(0, 10)) : "", execDecision)}
  </div>
</div>`;
}
function spDocFromRow(r) {
  const p = r.payload || {};
  return {
    row: r, id: r.id, created_at: r.created_at, approved_at: r.approved_at,
    customer: r.shop_name, shop_code: r.shop_code, province: r.province, quote_no: r.sale_order_no,
    requester: r.sale_name || p.requester?.name, doc_date: r.request_date, items: p.items || [],
    reason_type: p.reason_type || r.reason, reason_text: p.reason_text || "",
    signature: r.signature, manager: p.manager || null,
    approver_signature: r.approval_signature || r.exec_signature, exec_comment: r.approval_comment || r.exec_comment,
  };
}
function spPrintPage(body) {
  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>ใบขออนุมัติราคาพิเศษ</title>
<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}html,body{background:#fff;font-family:'Kanit',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pw{width:190mm;margin:0 auto;padding:10mm 0}
.no-print{text-align:center;padding:12px;background:#f8fafc;border-bottom:1px solid #e2e8f0}
.no-print button{font-family:'Kanit',sans-serif;font-size:15px;font-weight:600;padding:12px 28px;margin:4px;border-radius:10px;cursor:pointer;border:none;color:#fff;min-width:150px}
.no-print p{font-size:12px;color:#64748b;margin-top:6px}.b1{background:#1E40AF}.b2{background:#64748b}
@media print{@page{size:A4 portrait;margin:10mm}.pw{padding:0}.no-print{display:none!important}}
</style></head><body>
<div class="no-print"><button class="b1" onclick="window.print()">พิมพ์ / Save as PDF</button><button class="b2" onclick="window.close()">ปิด</button><p>เลือก "Save as PDF" ในหน้าพิมพ์ เพื่อเก็บเป็นไฟล์ PDF</p></div>
<div class="pw">${body}</div></body></html>`;
}
function spOpenPrint(html) {
  const w = window.open("", "_blank");
  if (w) { w.document.open(); w.document.write(html); w.document.close(); return; }
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  window.open(url, "_blank"); setTimeout(() => URL.revokeObjectURL(url), 15000);
}

// ---------- อื่น ๆ ----------
function renderIssues(boxId, res, titleOk) {
  const box = document.getElementById(boxId); if (!box) return;
  const items = [...res.errors.map((t) => `<li class="is-err">${escHtml(t)}</li>`), ...res.warnings.map((t) => `<li>${escHtml(t)}</li>`)];
  box.hidden = !items.length;
  box.innerHTML = items.length ? `<b>${res.errors.length ? "ต้องแก้ก่อนส่ง" : titleOk || "ข้อควรตรวจ"}</b><ul>${items.join("")}</ul>` : "";
}
function showNotification(msg, type = "info") {
  document.getElementById("topNotification")?.remove();
  const div = document.createElement("div");
  div.id = "topNotification"; div.className = `fp-toast is-${type}`; div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => { div.classList.add("is-out"); setTimeout(() => div.remove(), 300); }, 2600);
}
async function logout() {
  try { await supabaseClient.auth.signOut(); } catch (e) { /* ignore */ }
  window.location.href = "/pages/auth/login.html";
}
