// =====================================================
// credit-limit-sale.js v2.0 — ขออนุมัติวงเงินเครดิตชั่วคราว (ฝั่งเซลล์)
// ต้องโหลด special-price-common.js + credit-limit-common.js ก่อน
//
// ส่งคำขอ → approval_requests: request_type "credit_limit_temp", status / request_status "accounting_review"
//   → ฝ่ายบัญชีตรวจ (credit-limit-finance): ส่งต่อ Manager หรือ "ส่งกลับให้แก้ไข" (status "revision_required")
//   → Manager → ผู้บริหาร (executive-ApprovalDoc) อนุมัติขั้นสุดท้าย
// บัญชีส่งกลับ → เซลล์กด "แก้ไขแล้วส่งกลับ" = อัปเดตคำขอเดิม (ไม่สร้างใหม่) แล้วกลับไปขั้นบัญชี
// ร่างเก็บในเครื่อง 1 ร่างต่อผู้ใช้ · ยกเลิกได้เฉพาะตอนบัญชียังไม่ส่งต่อ
// =====================================================
"use strict";

const ALLOWED_ROLES = ["admin", "sales", "sale", "manager"];
const DRAFT_KEY = () => `creditLimitDraft:v2:${me.id || "x"}`;

let me = { id: null, name: "", role: "" };
let pickedShop = null;
let sig = null;
let editingId = null;     // แก้ไขคำขอที่บัญชีส่งกลับ
let _dirty = false;
let _saving = false;
let _requests = [];
let _reqFilter = "all";
let _searchTimer = null;
let _searchSeq = 0;

// =====================================================
// 🚀 INIT
// =====================================================
document.addEventListener("DOMContentLoaded", async () => {
  for (let i = 0; i < 50 && typeof supabaseClient === "undefined"; i++) await new Promise((r) => setTimeout(r, 100));
  if (typeof supabaseClient === "undefined") { alert("ระบบยังไม่พร้อม กรุณารีเฟรชหน้า"); return; }
  if (typeof protectPage === "function") protectPage(ALLOWED_ROLES);
  if (!window.currentUser?.id && typeof loadCurrentUser === "function") { try { await loadCurrentUser(); } catch (e) { /* ignore */ } }
  me = await spLoadMe();
  setText("requesterName", me.name || "-");
  setText("requesterRole", me.position || "-");
  setText("shopScopeHint", isSales() ? "แสดงเฉพาะร้านที่คุณดูแล" : "ค้นหาได้ทุกร้านที่เปิดใช้งาน");
  const nav = document.getElementById("salesNav"); if (nav) nav.hidden = !isSales();
  setupEvents();
  sig = createSignaturePad("sigCanvas", "sigWrap", "sigHint", markDirty);
  document.getElementById("docDate").value = todayISO();
  recalc(); updateReasonCount();
  restoreDraft();
  updateStatus();
  await loadMyRequests();
  const q = new URLSearchParams(location.search).get("revise");
  if (q) startRevise(q);
});

const isSales = () => me.role === "sales" || me.role === "sale";

function setupEvents() {
  const s = document.getElementById("shopSearch");
  s.addEventListener("input", () => { if (pickedShop && s.value !== shopLabel(pickedShop)) { pickedShop = null; renderPickedShop(); } scheduleShopSearch(); markDirty(); });
  s.addEventListener("focus", () => { if (s.value.trim() && !pickedShop) scheduleShopSearch(); });
  s.addEventListener("keydown", onShopKey);
  document.addEventListener("click", (e) => { if (!e.target.closest(".sp-combo")) hideShopResults(); });
  ["currentLimit", "requestAmount"].forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener("input", () => { recalc(); markDirty(); });
    el.addEventListener("blur", () => { const n = numOf(el.value); el.value = el.value.trim() ? n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""; });
    el.addEventListener("focus", () => { if (el.value) el.value = String(numOf(el.value) || ""); });
  });
  ["creditTerm", "soNo", "docDate", "reasonText"].forEach((id) => document.getElementById(id).addEventListener("input", markDirty));
  document.getElementById("reasonText").addEventListener("input", updateReasonCount);
  document.querySelectorAll('input[name="pay"]').forEach((c) => c.addEventListener("change", markDirty));
  document.querySelectorAll("#reqFilter button").forEach((b) => b.addEventListener("click", () => {
    _reqFilter = b.dataset.f;
    document.querySelectorAll("#reqFilter button").forEach((x) => x.classList.toggle("is-on", x === b));
    renderRequests();
  }));
  document.getElementById("previewModal")?.addEventListener("click", (ev) => { if (ev.target.id === "previewModal") closePreview(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { closePreview(); closeViewPopup(); hideShopResults(); } });
}

// =====================================================
// 🏪 ลูกค้า (ค้นหาจาก shops · เซลล์เห็นเฉพาะร้านที่ดูแล)
// =====================================================
function shopLabel(s) { return s ? `${s.shop_code ? s.shop_code + " · " : ""}${s.shop_name || "-"}` : ""; }
function scheduleShopSearch() { clearTimeout(_searchTimer); _searchTimer = setTimeout(searchShops, 220); }
async function searchShops() {
  const q = document.getElementById("shopSearch").value.trim();
  const box = document.getElementById("shopResults");
  if (pickedShop || !q) { hideShopResults(); return; }
  const seq = ++_searchSeq;
  box.hidden = false;
  box.innerHTML = `<div class="sp-combo-empty">กำลังค้นหา...</div>`;
  try {
    const safe = q.replace(/[%,()*]/g, " ").trim();
    let query = supabaseClient.from("shops").select("id,shop_code,shop_name,province,sale_id,status")
      .ilike("status", "active").or(`shop_name.ilike.%${safe}%,shop_code.ilike.%${safe}%`)
      .order("shop_name", { ascending: true }).limit(20);
    if (isSales()) query = query.eq("sale_id", me.id);
    const { data, error } = await query;
    if (seq !== _searchSeq) return;
    if (error) throw error;
    window._shopResults = data || [];
    box.innerHTML = window._shopResults.length ? window._shopResults.map((s, i) => `
      <button type="button" class="sp-combo-item" role="option" onclick="pickShop(${i})">
        <b>${escHtml(s.shop_name || "-")}</b><span>${escHtml(s.shop_code || "ไม่มีรหัส")}${s.province ? " · " + escHtml(s.province) : ""}</span>
      </button>`).join("") : `<div class="sp-combo-empty">ไม่พบร้าน “${escHtml(q)}”${isSales() ? " ในร้านที่คุณดูแล" : ""}</div>`;
  } catch (e) {
    if (seq === _searchSeq) box.innerHTML = `<div class="sp-combo-empty is-error">ค้นหาไม่สำเร็จ: ${escHtml(e.message)}</div>`;
  }
}
function onShopKey(e) {
  const box = document.getElementById("shopResults");
  const items = [...box.querySelectorAll(".sp-combo-item")];
  if (!items.length || box.hidden) return;
  let i = items.findIndex((x) => x.classList.contains("is-hl"));
  if (e.key === "ArrowDown") { e.preventDefault(); i = Math.min(items.length - 1, i + 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); i = Math.max(0, i - 1); }
  else if (e.key === "Enter") { e.preventDefault(); pickShop(i >= 0 ? i : 0); return; }
  else return;
  items.forEach((x, k) => x.classList.toggle("is-hl", k === i));
  items[i]?.scrollIntoView({ block: "nearest" });
}
function pickShop(i) { const s = (window._shopResults || [])[i]; if (s) { setPickedShop(s); markDirty(); document.getElementById("currentLimit").focus(); } }
function setPickedShop(s) {
  pickedShop = s ? { id: s.id, shop_code: s.shop_code || "", shop_name: s.shop_name || "", province: s.province || "", sale_id: s.sale_id || null } : null;
  document.getElementById("shopSearch").value = pickedShop ? shopLabel(pickedShop) : "";
  hideShopResults(); renderPickedShop();
}
function clearShop() { pickedShop = null; const s = document.getElementById("shopSearch"); s.value = ""; s.focus(); renderPickedShop(); markDirty(); }
function hideShopResults() { const b = document.getElementById("shopResults"); if (b) b.hidden = true; }
function renderPickedShop() {
  const box = document.getElementById("shopPicked");
  document.getElementById("shopClear").hidden = !(pickedShop || document.getElementById("shopSearch").value.trim());
  document.querySelector(".sp-combo-box")?.classList.toggle("is-picked", !!pickedShop);
  if (pickedShop) {
    box.hidden = false;
    box.innerHTML = `<span class="material-symbols-outlined">storefront</span><b>${escHtml(pickedShop.shop_name)}</b><span>${escHtml(pickedShop.shop_code || "ไม่มีรหัส")}${pickedShop.province ? " · " + escHtml(pickedShop.province) : ""}</span>`;
  } else { box.hidden = true; box.innerHTML = ""; }
}

// =====================================================
// 🔢 ตัวเลข / ฟอร์ม
// =====================================================
const payments = () => [...document.querySelectorAll('input[name="pay"]:checked')].map((c) => c.value);
function setPayments(list) { document.querySelectorAll('input[name="pay"]').forEach((c) => { c.checked = (list || []).includes(c.value); }); }
function recalc() {
  const lim = numOf(document.getElementById("currentLimit").value), amt = numOf(document.getElementById("requestAmount").value);
  setText("sumLimit", fmtMoney(lim));
  setText("sumAmount", fmtMoney(amt));
  const r = document.getElementById("sumRatio");
  if (lim > 0 && amt > 0) { const p = (amt / lim) * 100; r.textContent = `${p.toLocaleString("th-TH", { maximumFractionDigits: 0 })}% ของวงเงิน`; r.classList.toggle("is-high", p > 100); }
  else { r.textContent = "-"; r.classList.remove("is-high"); }
}
function updateReasonCount() { setText("reasonCount", `${document.getElementById("reasonText").value.length}/500`); }
function clearSignature() { sig.clear(); markDirty(); }

function formSnapshot() {
  return {
    user_id: me.id, shop: pickedShop,
    current_credit_limit: numOf(document.getElementById("currentLimit").value),
    credit_term: document.getElementById("creditTerm").value.trim(),
    payment_methods: payments(),
    sale_order_no: document.getElementById("soNo").value.trim(),
    request_date: document.getElementById("docDate").value,
    request_amount: numOf(document.getElementById("requestAmount").value),
    reason: document.getElementById("reasonText").value,
    signature: sig.get(),
  };
}
function applySnapshot(d) {
  setPickedShop(d.shop || null);
  const m = (n) => (n ? Number(n).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
  document.getElementById("currentLimit").value = m(d.current_credit_limit);
  document.getElementById("creditTerm").value = d.credit_term || "";
  setPayments(d.payment_methods);
  document.getElementById("soNo").value = d.sale_order_no || "";
  document.getElementById("docDate").value = d.request_date || todayISO();
  document.getElementById("requestAmount").value = m(d.request_amount);
  document.getElementById("reasonText").value = d.reason || "";
  updateReasonCount(); recalc();
  sig.set(d.signature || null);
}

function validate() {
  const errors = [], warnings = [], d = formSnapshot();
  if (!pickedShop) errors.push("ยังไม่ได้เลือกลูกค้าจากรายชื่อในระบบ");
  if (!(d.current_credit_limit > 0)) errors.push("ยังไม่ใส่วงเงินเครดิตปัจจุบัน");
  if (!d.credit_term) errors.push("ยังไม่ใส่เครดิต (วัน)");
  else if (!/^\d+$/.test(d.credit_term)) warnings.push(`เครดิต “${d.credit_term}” ควรเป็นจำนวนวัน`);
  if (!d.payment_methods.length) errors.push("ยังไม่เลือกวิธีชำระเงิน");
  if (!(d.request_amount > 0)) errors.push("ยังไม่ใส่ยอดบิลที่ต้องการเปิด");
  else if (d.current_credit_limit > 0 && d.request_amount > d.current_credit_limit * 3) warnings.push(`ยอดบิลสูงกว่าวงเงินปัจจุบันมาก (${Math.round((d.request_amount / d.current_credit_limit) * 100)}%)`);
  if (d.reason.trim().length < 10) errors.push("กรุณาเขียนเหตุผลอย่างน้อย 10 ตัวอักษร");
  if (!d.signature) errors.push("ยังไม่ได้เซ็นชื่อผู้ขอ");
  if (!d.request_date) errors.push("ยังไม่ใส่วันที่");
  else if (d.request_date > todayISO()) warnings.push(`วันที่ ${formatDateTH(d.request_date)} เป็นวันในอนาคต`);
  const dup = _requests.find((r) => !clStatus(r).done && r.shop_id && pickedShop && String(r.shop_id) === String(pickedShop.id) && String(r.id) !== String(editingId));
  if (dup) warnings.push(`ร้านนี้มีคำขอที่ยังไม่ทราบผลอยู่แล้ว (${clDocNo(dup)} · ${clStatus(dup).label})`);
  return { errors, warnings };
}
function showWarnBox(res) {
  renderIssues("fpWarn", res, "ตรวจพบ");
  const box = document.getElementById("fpWarn");
  if (box && !box.hidden) box.querySelector("b").textContent = "ตรวจพบ";
}

// =====================================================
// 🏷 สถานะฟอร์ม + ร่าง (1 ร่างต่อผู้ใช้ ในเครื่องนี้)
// =====================================================
function markDirty() {
  _dirty = true; updateStatus();
  const box = document.getElementById("fpWarn");
  if (box && !box.hidden) showWarnBox(validate());
}
function updateStatus() {
  let label = _dirty ? "คำขอใหม่ (ยังไม่บันทึก)" : "คำขอใหม่", banner = "";
  if (editingId) {
    const r = findRequest(editingId);
    label = "กำลังแก้ไขคำขอที่บัญชีส่งกลับ";
    banner = `แก้ไขคำขอ ${r ? clDocNo(r) : ""} — ส่งแล้วจะกลับไปที่ฝ่ายบัญชีอีกครั้ง`;
  } else if (hasDraft()) label = _dirty ? "ร่าง (มีการแก้ไขที่ยังไม่บันทึก)" : "ร่าง (บันทึกในเครื่องแล้ว)";
  setText("fpStatus", label);
  const b = document.getElementById("fpEditBanner"); if (b) b.hidden = !banner;
  setText("fpEditText", banner);
  document.getElementById("clForm")?.classList.toggle("is-editing", !!banner);
  setText("submitText", editingId ? "ตรวจ & ส่งกลับ" : "ตรวจ & ส่งคำขอ");
  setText("sendText", editingId ? "ส่งกลับให้ฝ่ายบัญชี" : "ส่งให้ฝ่ายบัญชี");
  document.getElementById("draftBtn").hidden = !!editingId;
}
function hasDraft() { try { return !!localStorage.getItem(DRAFT_KEY()); } catch (e) { return false; } }
function saveDraft() {
  const s = formSnapshot();
  if (!s.shop && !s.request_amount && !s.reason.trim()) { alert("ยังไม่มีข้อมูลให้บันทึก"); return; }
  try { localStorage.setItem(DRAFT_KEY(), JSON.stringify({ ...s, updated_at: new Date().toISOString() })); }
  catch (e) { alert("บันทึกร่างไม่สำเร็จ (พื้นที่ในเครื่องเต็มหรือถูกปิดไว้)"); return; }
  _dirty = false; updateStatus();
  showNotification("บันทึกร่างในเครื่องแล้ว", "success");
}
function restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY()) || localStorage.getItem(`creditLimitDraft:${me.id}`); // รวมร่างรุ่นเก่า
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.shop_id && !d.shop) d.shop = { id: d.shop_id, shop_code: d.shop_code, shop_name: d.shop_name, province: d.province };
    if (d.signature === undefined) d.signature = null;
    applySnapshot(d);
    _dirty = false;
    showNotification("เปิดร่างที่บันทึกไว้ในเครื่องแล้ว", "info");
  } catch (e) { console.warn("restoreDraft:", e); }
}

// =====================================================
// 📤 ส่งคำขอ (ใหม่) / ส่งกลับ (แก้ไขตามที่บัญชีขอ)
// =====================================================
function rowFromForm() {
  const d = formSnapshot();
  const reason = d.reason.trim();
  return {
    request_type: CL_TYPE,
    request_title: `ขออนุมัติวงเงินเกิน ${pickedShop?.shop_name || ""} · ${fmtMoney(d.request_amount)} บาท`.trim(),
    request_detail: reason,
    sale_id: me.id, created_by: me.id, request_by: me.id, sale_name: me.name,
    shop_id: pickedShop?.id || null, shop_code: pickedShop?.shop_code || null, shop_name: pickedShop?.shop_name || null, province: pickedShop?.province || null,
    current_credit_limit: d.current_credit_limit, credit_term: d.credit_term || null, payment_methods: d.payment_methods,
    sale_order_no: d.sale_order_no || null, request_date: d.request_date || null, request_amount: d.request_amount,
    reason, signature: d.signature,
    payload: { form_version: "credit-limit-sale-v2", requester: { id: me.id, name: me.name, role: me.role, area: me.area, position: me.position }, shop: pickedShop },
  };
}
async function submitRequest() {
  if (_saving) return;
  const res = validate();
  showWarnBox(res); renderIssues("previewIssues", res);
  if (res.errors.length) { alert("ยังส่งไม่ได้:\n• " + res.errors.join("\n• ")); return; }
  const d = formSnapshot();
  if (!confirm((res.warnings.length ? "มีข้อควรตรวจ:\n• " + res.warnings.join("\n• ") + "\n\n" : "") +
    `${editingId ? "ส่งคำขอที่แก้ไขกลับ" : "ส่งคำขอ"}วงเงินชั่วคราวของ ${pickedShop.shop_name}\nยอดบิล ${fmtMoney(d.request_amount)} บาท ไปที่ฝ่ายบัญชี?`)) return;

  _saving = true;
  const btn = document.getElementById("sendBtn");
  btn.disabled = true;
  try {
    const now = new Date().toISOString();
    const row = { ...rowFromForm(), status: "accounting_review", request_status: "accounting_review", updated_at: now };
    if (editingId) {
      // แก้ไขคำขอเดิม — เฉพาะที่บัญชีส่งกลับมา
      delete row.created_by; delete row.request_by; delete row.sale_id;
      const { data, error } = await supabaseClient.from("approval_requests")
        .update({ ...row, accounting_status: "resubmitted" })
        .eq("id", editingId).eq("status", "revision_required").select("id");
      if (error) throw error;
      if (!data || !data.length) throw new Error("คำขอนี้ไม่ได้อยู่ในสถานะ “ส่งกลับให้แก้ไข” แล้ว หรือไม่มีสิทธิ์แก้ไข");
    } else {
      const { error } = await supabaseClient.from("approval_requests").insert({ ...row, created_at: now });
      if (error) throw error;
      try { localStorage.removeItem(DRAFT_KEY()); localStorage.removeItem(`creditLimitDraft:${me.id}`); } catch (e) { /* ignore */ }
    }
    const wasEdit = !!editingId;
    resetForm(); closePreview();
    await loadMyRequests();
    showNotification(wasEdit ? "ส่งคำขอที่แก้ไขกลับให้ฝ่ายบัญชีแล้ว" : "ส่งคำขอถึงฝ่ายบัญชีแล้ว — ติดตามผลได้ที่ “คำขอของฉัน”", "success");
  } catch (e) {
    alert("ส่งคำขอไม่สำเร็จ: " + e.message);
  } finally {
    _saving = false; btn.disabled = false;
  }
}

// บัญชีส่งกลับ → เปิดคำขอเดิมขึ้นฟอร์มเพื่อแก้ไข (ต้องเซ็นใหม่)
function startRevise(id) {
  const r = findRequest(id);
  if (!r || clStatus(r).key !== "revision") return;
  if (_dirty && !confirm("ข้อมูลในฟอร์มตอนนี้ยังไม่ได้บันทึก — แทนที่ด้วยคำขอที่ต้องแก้ไข?")) return;
  editingId = r.id;
  applySnapshot({
    shop: r.payload?.shop || (r.shop_id ? { id: r.shop_id, shop_code: r.shop_code, shop_name: r.shop_name, province: r.province } : null),
    current_credit_limit: r.current_credit_limit, credit_term: r.credit_term, payment_methods: clPayments(r),
    sale_order_no: r.sale_order_no, request_date: r.request_date, request_amount: r.request_amount,
    reason: r.reason || r.request_detail, signature: null,
  });
  const box = document.getElementById("reviseBox");
  box.hidden = false;
  box.innerHTML = `<span class="material-symbols-outlined">assignment_return</span><div><b>ฝ่ายบัญชีขอให้แก้ไข</b><p>${escHtml(r.accounting_recommendation || r.accounting_summary || "ไม่ได้ระบุรายละเอียด")}</p><small>แก้ไขข้อมูล เซ็นชื่อใหม่ แล้วกด “ตรวจ & ส่งกลับ”</small></div>`;
  _dirty = true; updateStatus();
  document.getElementById("clForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

// =====================================================
// 📋 คำขอของฉัน
// =====================================================
async function loadMyRequests() {
  const c = document.getElementById("requestList");
  c.innerHTML = `<div class="fp-empty">กำลังโหลด...</div>`;
  try {
    const { data, error } = await supabaseClient.from("approval_requests")
      .select("id, request_type, request_status, status, accounting_status, shop_id, shop_code, shop_name, province, sale_name, request_amount, current_credit_limit, credit_term, payment_methods, sale_order_no, request_date, reason, request_detail, accounting_recommendation, accounting_summary, accounting_checked_at, approval_comment, approved_at, created_at, payload")
      .eq("request_type", CL_TYPE).eq("request_by", me.id)
      .order("created_at", { ascending: false }).limit(100);
    let rows = data;
    if (error) { // คอลัมน์ไม่ตรง → ดึงแบบเต็ม
      console.warn("loadMyRequests (light):", error.message);
      const r2 = await supabaseClient.from("approval_requests").select("*").eq("request_type", CL_TYPE).eq("request_by", me.id).order("created_at", { ascending: false }).limit(100);
      if (r2.error) throw r2.error;
      rows = r2.data;
    }
    _requests = rows || [];
    renderRequests();
  } catch (e) {
    c.innerHTML = `<div class="fp-empty is-error">โหลดไม่สำเร็จ: ${escHtml(e.message)}<br><button type="button" class="fp-link-btn" onclick="loadMyRequests()">ลองใหม่</button></div>`;
  }
}
function findRequest(id) { return _requests.find((r) => String(r.id) === String(id)) || null; }
function renderRequests() {
  const c = document.getElementById("requestList");
  setText("requestCountBadge", _requests.length);
  const nAct = _requests.filter((r) => clStatus(r).action).length;
  setText("cntAction", nAct ? nAct : "");
  const pick = (r) => { const s = clStatus(r); return _reqFilter === "all" || (_reqFilter === "action" ? s.action : _reqFilter === "done" ? s.done : !s.done && !s.action); };
  const rows = _requests.filter(pick);
  if (!rows.length) { c.innerHTML = `<div class="fp-empty">${_requests.length ? "ไม่มีรายการในกลุ่มนี้" : "ยังไม่มีคำขอวงเงินชั่วคราว"}</div>`; return; }
  c.innerHTML = rows.map((r) => {
    const st = clStatus(r), id = escHtml(r.id);
    const notes = [];
    if (st.key === "revision" && (r.accounting_recommendation || r.accounting_summary)) notes.push(`<span class="sp-comment is-warn"><span class="material-symbols-outlined">forum</span><b>บัญชี:</b> ${escHtml(r.accounting_recommendation || r.accounting_summary)}</span>`);
    if (st.done && r.approval_comment) notes.push(`<span class="sp-comment"><span class="material-symbols-outlined">forum</span><b>ผู้บริหาร:</b> ${escHtml(r.approval_comment)}</span>`);
    return `
      <div class="fp-item${st.action ? " is-attn" : ""}">
        <button type="button" class="fp-item-main" onclick="openViewPopup('${id}')">
          <span class="fp-item-title">${escHtml(r.shop_name || "-")} <span class="fp-badge ${st.cls}">${escHtml(st.label)}</span></span>
          <span class="fp-item-sub"><span>ยอดบิล ${fmtMoney(r.request_amount)}</span><span>${clDocNo(r)}</span><span>${formatDateTimeTH(r.created_at)}</span></span>
          ${miniSteps(r)}
          ${notes.join("")}
        </button>
        <div class="fp-item-actions">
          ${st.action ? `<button type="button" class="is-primary" onclick="startRevise('${id}')"><span class="material-symbols-outlined">edit</span>แก้ไขแล้วส่งกลับ</button>` : ""}
          <button type="button" onclick="openViewPopup('${id}')"><span class="material-symbols-outlined">visibility</span>ดู</button>
          <button type="button" onclick="printRequestById('${id}')"><span class="material-symbols-outlined">print</span>พิมพ์</button>
          ${st.key === "accounting" && !["forwarded_to_manager"].includes(r.accounting_status) ? `<button type="button" class="is-danger" onclick="cancelRequest('${id}')"><span class="material-symbols-outlined">block</span>ยกเลิก</button>` : ""}
        </div>
      </div>`;
  }).join("");
}
function miniSteps(r) {
  const s = clStatus(r);
  const cls = (n) => (s.stage > n ? "is-ok" : s.stage === n ? (s.key === "revision" ? "is-warn" : "is-now") : "");
  const ex = s.key === "approved" ? "is-ok" : s.key === "rejected" ? "is-bad" : cls(4);
  return `<span class="sp-mini"><i class="is-ok">ส่ง</i><i class="${cls(2)}">บัญชี</i><i class="${cls(3)}">Manager</i><i class="${ex}">ผู้บริหาร</i></span>`;
}
// ยกเลิกได้เฉพาะตอนยังอยู่ขั้นบัญชี (ยังไม่ส่งต่อ)
async function cancelRequest(id) {
  const r = findRequest(id);
  if (!confirm(`ยกเลิกคำขอวงเงินของ ${r?.shop_name || ""}?\n(ลบออกจากระบบ ฝ่ายบัญชีจะไม่เห็นรายการนี้อีก)`)) return;
  try {
    const { data, error } = await supabaseClient.from("approval_requests").delete()
      .eq("id", id).in("status", ["accounting_review", "pending"]).select("id");
    if (error) throw error;
    if (!data || !data.length) throw new Error("คำขอนี้ถูกส่งต่อไปแล้ว หรือไม่มีสิทธิ์ยกเลิก");
    showNotification("ยกเลิกคำขอแล้ว", "success");
    await loadMyRequests();
  } catch (e) { alert("ยกเลิกไม่สำเร็จ: " + e.message); }
}

// =====================================================
// 🧾 เอกสาร: ตัวอย่างก่อนส่ง / ดู / พิมพ์
// =====================================================
function docFromForm() {
  const d = formSnapshot();
  return { customer: pickedShop?.shop_name || document.getElementById("shopSearch").value.trim(), shop_code: pickedShop?.shop_code, province: pickedShop?.province,
    requester: me.name, sale_order_no: d.sale_order_no, current_credit_limit: d.current_credit_limit || null, credit_term: d.credit_term,
    payment_methods: d.payment_methods, request_amount: d.request_amount || null, reason: d.reason.trim(), signature: d.signature, doc_date: d.request_date };
}
function openPreview() {
  const res = validate();
  showWarnBox(res); renderIssues("previewIssues", res);
  document.getElementById("sendBtn").disabled = res.errors.length > 0;
  setText("previewTitle", editingId ? "ตรวจคำขอที่แก้ไขก่อนส่งกลับ" : "ตรวจคำขอก่อนส่ง");
  document.getElementById("previewContent").innerHTML = clBuildDocHTML(docFromForm());
  document.getElementById("previewModal").style.display = "flex";
}
function closePreview() { const m = document.getElementById("previewModal"); if (m) m.style.display = "none"; }
function printPreview() { spOpenPrint(clPrintPage(clBuildDocHTML(docFromForm()))); }

// ดู/พิมพ์คำขอที่ส่งแล้ว — ดึงแถวเต็ม (มีลายเซ็น / ผลบัญชี) เฉพาะตอนเปิด
async function fullRow(id) {
  const { data, error } = await supabaseClient.from("approval_requests").select("*").eq("id", id).maybeSingle();
  if (error || !data) throw error || new Error("ไม่พบคำขอ");
  return data;
}
async function printRequestById(id) {
  try { spOpenPrint(clPrintPage(clBuildDocHTML(clDocFromRow(await fullRow(id))))); } catch (e) { alert("เปิดเอกสารไม่สำเร็จ: " + e.message); }
}
async function openViewPopup(id) {
  let m = document.getElementById("viewPopupModal");
  if (!m) {
    m = document.createElement("div"); m.id = "viewPopupModal"; m.className = "preview-modal";
    m.innerHTML = `<div class="preview-wrapper"><div class="preview-actions" id="viewPopupActions"></div><div id="viewPopupTl" class="sp-tl-wrap"></div><div id="viewPopupContent" class="a4-page"></div></div>`;
    m.addEventListener("click", (e) => { if (e.target === m) closeViewPopup(); });
    document.body.appendChild(m);
  }
  document.getElementById("viewPopupContent").innerHTML = `<div class="fp-empty">กำลังโหลด...</div>`;
  m.style.display = "flex";
  try {
    const r = await fullRow(id);
    const st = clStatus(r), sid = escHtml(r.id);
    document.getElementById("viewPopupTl").innerHTML = clTimelineHTML(r);
    document.getElementById("viewPopupContent").innerHTML = clBuildDocHTML(clDocFromRow(r));
    document.getElementById("viewPopupActions").innerHTML = `
      <span class="preview-title">${escHtml(r.shop_name || "คำขอวงเงิน")} · ${escHtml(st.label)}</span>
      ${st.action ? `<button type="button" class="pa-primary" onclick="closeViewPopup();startRevise('${sid}')"><span class="material-symbols-outlined">edit</span>แก้ไขแล้วส่งกลับ</button>` : ""}
      <button type="button" onclick="printRequestById('${sid}')"><span class="material-symbols-outlined">print</span>พิมพ์ / PDF</button>
      <button type="button" class="pa-close" onclick="closeViewPopup()" aria-label="ปิด"><span class="material-symbols-outlined">close</span></button>`;
  } catch (e) {
    document.getElementById("viewPopupContent").innerHTML = `<div class="fp-empty is-error">เปิดเอกสารไม่สำเร็จ: ${escHtml(e.message || "")}</div>`;
  }
}
function closeViewPopup() { const m = document.getElementById("viewPopupModal"); if (m) m.style.display = "none"; }

// =====================================================
// 🔄 CLEAR
// =====================================================
function resetForm() {
  editingId = null;
  document.getElementById("reviseBox").hidden = true;
  applySnapshot({ shop: null, request_date: todayISO(), payment_methods: [], signature: null });
  _dirty = false;
  updateStatus(); showWarnBox({ errors: [], warnings: [] });
}
function clearForm() {
  if ((_dirty || editingId) && !confirm("เริ่มคำขอใหม่? ข้อมูลที่ยังไม่บันทึกในฟอร์มจะหาย")) return;
  try { localStorage.removeItem(DRAFT_KEY()); } catch (e) { /* ignore */ }
  resetForm();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
window.addEventListener("beforeunload", (e) => { if (_dirty && !_saving) { e.preventDefault(); e.returnValue = ""; } });
