// =====================================================
// special-price-sale.js v2.1 — ขออนุมัติราคาพิเศษ (ฝั่งผู้ขอ · เซลล์ / การตลาด)
// ต้องโหลด special-price-common.js ก่อน (สถานะ ลำดับอนุมัติ เอกสาร ลายเซ็น)
//
// ส่งคำขอ → approval_requests: request_type "special_price", request_status "waiting_manager"
//   → Manager อนุมัติ (special-price-manager) → ผู้บริหารอนุมัติ (ศูนย์อนุมัติ executive-Approval)
// =====================================================
"use strict";

const DRAFT_PREFIX = "spSale_draft_";
const ALLOWED_ROLES = ["admin", "sales", "sale", "marketing"]; // Manager อนุมัติอย่างเดียว (หน้า special-price-manager)

let me = { id: null, name: "", role: "" };
let pickedShop = null;
let sig = null;
let currentDraftKey = null;
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
  if (typeof supabaseClient === "undefined") { alert("ระบบยังไม่พร้อม กรุณารีเฟรชหน้า"); return; }
  if (!(await checkAuthorization())) return;
  me = await spLoadMe();
  setText("requesterName", me.name || "-");
  setText("requesterRole", me.position || "-");
  setText("shopScopeHint", isSales() ? "แสดงเฉพาะร้านที่คุณดูแล" : "ค้นหาได้ทุกร้านที่เปิดใช้งาน");
  setupBackLink();
  setupEvents();
  sig = createSignaturePad("sigCanvas", "sigWrap", "sigHint", markDirty);
  document.getElementById("docDate").value = todayISO();
  loadProducts();
  addItem(null, true);
  recalc();
  updateStatus();
  loadDraftList();
  await loadMyRequests();
  _dirty = false;
});

async function checkAuthorization() {
  try {
    if (typeof protectPage === "function") await protectPage(ALLOWED_ROLES);
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { window.location.href = "/pages/auth/login.html"; return false; }
    return true;
  } catch (e) { console.error("Auth:", e); return false; }
}
function isSales() { return me.role === "sales" || me.role === "sale"; }

// ลิงก์กลับ: เซลล์ → แบบฟอร์ม, การตลาด/ผู้จัดการ → งานการตลาด
function setupBackLink() {
  const a = document.getElementById("backLink"); if (!a) return;
  if (isSales()) { a.href = "/pages/forms/formHub.html"; setText("backText", "แบบฟอร์ม"); }
  else if (me.role === "marketing") { a.href = "/pages/marketing/marketingHome.html"; setText("backText", "งานการตลาด"); }
  else { a.href = "/index.html"; setText("backText", "หน้าแรก"); }
  // แถบเมนูเซลล์แสดงเฉพาะเซลล์ (ผู้ใช้กลุ่มอื่นมีเมนูของตัวเอง)
  const nav = document.getElementById("salesNav"); if (nav) nav.hidden = !isSales();
}

function setupEvents() {
  const s = document.getElementById("shopSearch");
  s.addEventListener("input", () => { if (pickedShop && s.value !== shopLabel(pickedShop)) { pickedShop = null; renderPickedShop(); } scheduleShopSearch(); markDirty(); });
  s.addEventListener("focus", () => { if (s.value.trim() && !pickedShop) scheduleShopSearch(); });
  s.addEventListener("keydown", onShopKey);
  document.addEventListener("click", (e) => { if (!e.target.closest(".sp-combo")) hideShopResults(); });

  document.getElementById("itemBody").addEventListener("input", () => { recalc(); markDirty(); });
  ["docDate", "quoteNo", "reasonText"].forEach((id) => document.getElementById(id).addEventListener("input", markDirty));
  document.getElementById("reasonText").addEventListener("input", updateReasonCount);
  document.querySelectorAll('input[name="reason"]').forEach((r) => r.addEventListener("change", markDirty));

  document.querySelectorAll("#reqFilter button").forEach((b) => b.addEventListener("click", () => {
    _reqFilter = b.dataset.f;
    document.querySelectorAll("#reqFilter button").forEach((x) => x.classList.toggle("is-on", x === b));
    renderRequests();
  }));
  document.getElementById("previewModal")?.addEventListener("click", (ev) => { if (ev.target.id === "previewModal") closePreview(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { closePreview(); closeViewPopup(); hideShopResults(); } });
}

// =====================================================
// 🏪 ลูกค้า (ค้นหาจากตาราง shops)
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
      .ilike("status", "active")
      .or(`shop_name.ilike.%${safe}%,shop_code.ilike.%${safe}%`)
      .order("shop_name", { ascending: true }).limit(20);
    if (isSales()) query = query.eq("sale_id", me.id);
    const { data, error } = await query;
    if (seq !== _searchSeq) return; // พิมพ์ใหม่แล้ว
    if (error) throw error;
    const rows = data || [];
    window._shopResults = rows;
    if (!rows.length) {
      box.innerHTML = `<div class="sp-combo-empty">ไม่พบร้าน “${escHtml(q)}”${isSales() ? " ในร้านที่คุณดูแล" : ""}<br><small>ส่งต่อได้โดยใช้ชื่อที่พิมพ์ (ระบบจะเตือนว่าไม่ใช่ลูกค้าในระบบ)</small></div>`;
      return;
    }
    box.innerHTML = rows.map((s, i) => `
      <button type="button" class="sp-combo-item" role="option" onclick="pickShop(${i})">
        <b>${escHtml(s.shop_name || "-")}</b>
        <span>${escHtml(s.shop_code || "ไม่มีรหัส")}${s.province ? " · " + escHtml(s.province) : ""}</span>
      </button>`).join("");
  } catch (e) {
    if (seq !== _searchSeq) return;
    box.innerHTML = `<div class="sp-combo-empty is-error">ค้นหาไม่สำเร็จ: ${escHtml(e.message)}</div>`;
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
function pickShop(i) { const s = (window._shopResults || [])[i]; if (!s) return; setPickedShop(s); markDirty(); }
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
function customerName() { return pickedShop ? pickedShop.shop_name : document.getElementById("shopSearch").value.trim(); }

// =====================================================
// 📦 สินค้า
// =====================================================
async function loadProducts() {
  try {
    const { data, error } = await supabaseClient.from("products").select("id,name").order("name");
    if (error) throw error;
    const names = [...new Set((data || []).map((p) => p.name).filter(Boolean))];
    document.getElementById("productList").innerHTML = names.map((n) => `<option value="${escHtml(n)}"></option>`).join("");
  } catch (e) { console.warn("loadProducts:", e); }
}
function itemRowHTML(it = {}) {
  const v = (x) => (x === 0 || x) ? escHtml(x) : "";
  return `
    <td class="c-no"><span class="sp-no"></span></td>
    <td><input type="text" class="it-name" list="productList" value="${v(it.name)}" placeholder="ชื่อสินค้า" aria-label="สินค้า"></td>
    <td class="c-code"><input type="text" class="it-code" value="${v(it.code)}" placeholder="-" aria-label="รหัสสินค้า"></td>
    <td class="c-qty"><input type="number" inputmode="decimal" min="0" step="any" class="it-qty num" value="${v(it.qty)}" placeholder="0" aria-label="จำนวน"></td>
    <td class="c-unit"><input type="text" class="it-unit" list="unitList" value="${v(it.unit)}" placeholder="หน่วย" aria-label="หน่วย"></td>
    <td class="c-price"><input type="number" inputmode="decimal" min="0" step="any" class="it-normal num" value="${v(it.normal_price)}" placeholder="0.00" aria-label="ราคาปกติต่อหน่วย"></td>
    <td class="c-price"><input type="number" inputmode="decimal" min="0" step="any" class="it-req num" value="${v(it.request_price)}" placeholder="0.00" aria-label="ราคาที่ขอต่อหน่วย"></td>
    <td class="c-pct num"><span class="it-pct">–</span></td>
    <td class="c-diff num"><span class="it-diff">–</span></td>
    <td class="c-del"><button type="button" class="fp-row-del" onclick="removeItem(this)" title="ลบรายการ" aria-label="ลบรายการ"><span class="material-symbols-outlined">delete</span></button></td>`;
}
function addItem(it, quiet) {
  const tr = document.createElement("tr");
  tr.innerHTML = itemRowHTML(it || {});
  document.getElementById("itemBody").appendChild(tr);
  renumber(); recalc();
  if (!quiet) { markDirty(); tr.querySelector(".it-name")?.focus(); }
  return tr;
}
function removeItem(btn) {
  const tr = btn.closest("tr"); if (!tr) return;
  if ([...tr.querySelectorAll("input")].some((i) => i.value.trim()) && !confirm("ลบสินค้ารายการนี้?")) return;
  tr.remove(); renumber(); recalc(); markDirty();
}
function renumber() {
  const rows = [...document.querySelectorAll("#itemBody tr")];
  rows.forEach((tr, i) => { tr.querySelector(".sp-no").textContent = i + 1; });
  document.getElementById("emptyRows").hidden = rows.length > 0;
}
function readItem(tr) {
  const g = (c) => (tr.querySelector(c)?.value || "").trim();
  return { name: g(".it-name"), code: g(".it-code"), unit: g(".it-unit"), qty: numOf(g(".it-qty")), normal_price: numOf(g(".it-normal")), request_price: numOf(g(".it-req")),
    _any: !!(g(".it-name") || g(".it-code") || g(".it-qty") || g(".it-normal") || g(".it-req")) };
}
// รายการที่มีข้อมูล (แถวว่างทั้งแถวไม่นับ)
function collectItems() {
  return [...document.querySelectorAll("#itemBody tr")].map(readItem).filter((it) => it._any)
    .map((it) => { const c = calcItem(it); delete c._any; return c; });
}
function recalc() {
  document.querySelectorAll("#itemBody tr").forEach((tr) => {
    const it = calcItem(readItem(tr));
    const ok = it.normal_price > 0 && it.request_price > 0;
    tr.querySelector(".it-pct").textContent = ok ? fmtPct(it.discount_pct) : "–";
    tr.querySelector(".it-diff").textContent = ok && it.qty > 0 ? fmtMoney(it.diff_total) : "–";
    const bad = ok && it.request_price >= it.normal_price;
    tr.classList.toggle("is-bad", bad);
    tr.classList.toggle("is-high", ok && !bad && it.discount_pct > SP_HIGH_DISCOUNT_PCT);
  });
  const t = totalsOf(collectItems());
  setText("sumNormal", fmtMoney(t.normal)); setText("sumRequest", fmtMoney(t.request));
  setText("sumDiff", fmtMoney(t.diff)); setText("sumPct", fmtPct(t.pct));
  setText("rowCount", t.count ? `${t.count} รายการ` : "");
  return t;
}

// =====================================================
// ✍️ ลายเซ็น / 📝 เหตุผล
// =====================================================
function clearSignature() { sig.clear(); markDirty(); }
function reasonType() { return document.querySelector('input[name="reason"]:checked')?.value || ""; }
function setReasonType(v) { document.querySelectorAll('input[name="reason"]').forEach((r) => { r.checked = r.value === v; }); }
function updateReasonCount() { setText("reasonCount", `${document.getElementById("reasonText").value.length}/1000`); }

// =====================================================
// ✅ ตรวจความถูกต้อง
// =====================================================
function validate() {
  const errors = [], warnings = [];
  const items = collectItems(), cust = customerName();
  if (!cust) errors.push("ยังไม่ได้เลือกลูกค้า");
  else if (!pickedShop) warnings.push(`“${cust}” ไม่ได้เลือกจากรายชื่อลูกค้าในระบบ`);
  if (!items.length) errors.push("ยังไม่มีสินค้าที่ขอราคาพิเศษ");
  items.forEach((it, i) => {
    const label = `รายการ ${i + 1}${it.name ? ` (${it.name})` : ""}`;
    if (!it.name) errors.push(`${label}: ยังไม่ใส่ชื่อสินค้า`);
    if (!(it.qty > 0)) errors.push(`${label}: จำนวนต้องมากกว่า 0`);
    if (!(it.normal_price > 0)) errors.push(`${label}: ยังไม่ใส่ราคาปกติ`);
    if (!(it.request_price > 0)) errors.push(`${label}: ยังไม่ใส่ราคาที่ขอ`);
    else if (it.normal_price > 0 && it.request_price >= it.normal_price) errors.push(`${label}: ราคาที่ขอ (${fmtMoney(it.request_price)}) ต้องต่ำกว่าราคาปกติ (${fmtMoney(it.normal_price)})`);
    else if (it.discount_pct > SP_HIGH_DISCOUNT_PCT) warnings.push(`${label}: ส่วนลดสูง ${fmtPct(it.discount_pct)}`);
    if (!it.unit) warnings.push(`${label}: ยังไม่ระบุหน่วย`);
  });
  const seen = new Map();
  items.forEach((it) => { const k = (it.code || it.name).toLowerCase(); if (k) seen.set(k, (seen.get(k) || 0) + 1); });
  const dups = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
  if (dups.length) warnings.push(`มีสินค้าซ้ำ: ${dups.join(", ")}`);
  if (!reasonType()) errors.push("ยังไม่เลือกเหตุผลการขอราคาพิเศษ");
  if (document.getElementById("reasonText").value.trim().length < 10) errors.push("กรุณาเขียนรายละเอียดเหตุผลอย่างน้อย 10 ตัวอักษร");
  if (!sig.get()) errors.push("ยังไม่ได้เซ็นชื่อผู้ขอ");
  const dd = document.getElementById("docDate").value;
  if (!dd) errors.push("ยังไม่ใส่วันที่เอกสาร");
  else if (dd > todayISO()) warnings.push(`วันที่เอกสาร ${formatDateTH(dd)} เป็นวันในอนาคต`);
  return { errors, warnings };
}
function showWarnBox(res) {
  const box = document.getElementById("fpWarn"); if (!box) return;
  renderIssues("fpWarn", res, "ตรวจพบ");
  if (!box.hidden) box.querySelector("b").textContent = "ตรวจพบ";
}

// =====================================================
// 🏷 สถานะฟอร์ม
// =====================================================
function markDirty() {
  _dirty = true; updateStatus();
  const box = document.getElementById("fpWarn");
  if (box && !box.hidden) showWarnBox(validate());
}
function updateStatus() {
  let label = "คำขอใหม่ (ยังไม่บันทึก)", banner = "";
  if (currentDraftKey) { label = _dirty ? "ร่าง (มีการแก้ไขที่ยังไม่บันทึก)" : "ร่าง (บันทึกในเครื่องแล้ว)"; banner = "กำลังแก้ไขร่างที่เก็บในเครื่อง"; }
  setText("fpStatus", label);
  const b = document.getElementById("fpEditBanner"); if (b) b.hidden = !banner;
  setText("fpEditText", banner);
  document.getElementById("spForm")?.classList.toggle("is-editing", !!banner);
}

// =====================================================
// 💾 ร่างในเครื่อง (แยกผู้ใช้ · บันทึกทับร่างเดิม)
// =====================================================
function formSnapshot() {
  return {
    user_id: me.id,
    shop: pickedShop, customer_text: pickedShop ? "" : document.getElementById("shopSearch").value.trim(),
    doc_date: document.getElementById("docDate").value,
    quote_no: document.getElementById("quoteNo").value.trim(),
    items: collectItems().map(({ name, code, unit, qty, normal_price, request_price }) => ({ name, code, unit, qty, normal_price, request_price })),
    reason_type: reasonType(),
    reason_text: document.getElementById("reasonText").value,
    signature: sig.get(),
  };
}
function getDrafts() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(DRAFT_PREFIX)) continue;
      try { const v = JSON.parse(localStorage.getItem(k)); if (v.user_id && me.id && v.user_id !== me.id) continue; v._key = k; out.push(v); } catch (e) { /* ข้าม */ }
    }
  } catch (e) { console.warn("localStorage:", e); }
  return out.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
}
function saveDraft() {
  const s = formSnapshot();
  if (!s.shop && !s.customer_text && !s.items.length) { alert("ยังไม่มีข้อมูลให้บันทึก"); return; }
  let created = new Date().toISOString();
  try { if (currentDraftKey) created = JSON.parse(localStorage.getItem(currentDraftKey))?.created_at || created; } catch (e) { /* ignore */ }
  if (!currentDraftKey) currentDraftKey = DRAFT_PREFIX + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  try { localStorage.setItem(currentDraftKey, JSON.stringify({ ...s, created_at: created, updated_at: new Date().toISOString() })); }
  catch (e) { alert("บันทึกร่างไม่สำเร็จ (พื้นที่ในเครื่องเต็มหรือถูกปิดไว้)"); return; }
  _dirty = false;
  showNotification("บันทึกร่างในเครื่องแล้ว", "success");
  loadDraftList(); updateStatus();
}
function applySnapshot(d) {
  if (d.shop) setPickedShop(d.shop);
  else { pickedShop = null; document.getElementById("shopSearch").value = d.customer_text || ""; renderPickedShop(); }
  document.getElementById("docDate").value = d.doc_date || todayISO();
  document.getElementById("quoteNo").value = d.quote_no || "";
  document.getElementById("itemBody").innerHTML = "";
  (d.items || []).forEach((it) => addItem(it, true));
  if (!(d.items || []).length) addItem(null, true);
  renumber(); recalc();
  setReasonType(d.reason_type || "");
  document.getElementById("reasonText").value = d.reason_text || "";
  updateReasonCount();
  sig.set(d.signature || null);
}
function openDraft(key) {
  try {
    const raw = localStorage.getItem(key); if (!raw) { alert("ไม่พบร่างนี้"); loadDraftList(); return; }
    if (_dirty && !confirm("ข้อมูลในฟอร์มตอนนี้ยังไม่ได้บันทึก — เปิดร่างนี้แทน?")) return;
    applySnapshot(JSON.parse(raw));
    currentDraftKey = key; _dirty = false;
    loadDraftList(); updateStatus(); showWarnBox({ errors: [], warnings: [] });
    document.getElementById("spForm").scrollIntoView({ behavior: "smooth", block: "start" });
    showNotification("เปิดร่างแล้ว", "success");
  } catch (e) { alert("เปิดร่างไม่สำเร็จ: " + e.message); }
}
function deleteDraft(key) {
  if (!confirm("ลบร่างนี้? (กู้คืนไม่ได้)")) return;
  try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  if (currentDraftKey === key) { currentDraftKey = null; updateStatus(); }
  loadDraftList();
}
function loadDraftList() {
  const c = document.getElementById("draftList"), drafts = getDrafts();
  setText("draftCountBadge", drafts.length);
  if (!drafts.length) { c.innerHTML = `<div class="fp-empty">ยังไม่มีร่าง<br><small>กด “บันทึกร่าง” เพื่อเก็บไว้ทำต่อ</small></div>`; return; }
  c.innerHTML = drafts.map((d) => {
    const t = totalsOf((d.items || []).map(calcItem)), k = escHtml(d._key);
    return `
      <div class="fp-item${d._key === currentDraftKey ? " is-active" : ""}">
        <button type="button" class="fp-item-main" onclick="openDraft('${k}')">
          <span class="fp-item-title">${escHtml(d.shop?.shop_name || d.customer_text || "ยังไม่เลือกลูกค้า")}</span>
          <span class="fp-item-sub"><span>${t.count} รายการ</span>${t.diff ? `<span>ส่วนต่าง ${fmtMoney(t.diff)}</span>` : ""}<span>แก้ไข ${formatDateTimeTH(d.updated_at)}</span></span>
        </button>
        <div class="fp-item-actions">
          <button type="button" onclick="openDraft('${k}')"><span class="material-symbols-outlined">edit</span>เปิด</button>
          <button type="button" class="is-danger" onclick="deleteDraft('${k}')"><span class="material-symbols-outlined">delete</span>ลบ</button>
        </div>
      </div>`;
  }).join("");
}

// =====================================================
// 📤 ส่งคำขอ → approval_requests (ขั้นแรก: Manager)
// =====================================================
function buildDetailText(items, t, cust) {
  const lines = items.map((it, i) => `${i + 1}. ${it.name}${it.code ? ` (${it.code})` : ""} ${fmtQty(it.qty)} ${it.unit || ""} · ปกติ ${fmtMoney(it.normal_price)} → ขอ ${fmtMoney(it.request_price)} (-${fmtPct(it.discount_pct)}) · ส่วนต่าง ${fmtMoney(it.diff_total)}`);
  return [
    `ลูกค้า: ${cust}`,
    `เหตุผล: ${reasonType()} — ${document.getElementById("reasonText").value.trim()}`,
    `รายการสินค้า:`, ...lines,
    `รวมราคาปกติ ${fmtMoney(t.normal)} บาท · ราคาที่ขอ ${fmtMoney(t.request)} บาท · ส่วนต่าง ${fmtMoney(t.diff)} บาท (ส่วนลดเฉลี่ย ${fmtPct(t.pct)})`,
  ].join("\n");
}
async function submitRequest() {
  if (_saving) return;
  const res = validate();
  showWarnBox(res); renderPreviewIssues(res);
  if (res.errors.length) { alert("ยังส่งไม่ได้:\n• " + res.errors.join("\n• ")); return; }
  const items = collectItems(), t = totalsOf(items), cust = customerName();
  if (!confirm((res.warnings.length ? "มีข้อควรตรวจ:\n• " + res.warnings.join("\n• ") + "\n\n" : "") +
    `ส่งคำขอราคาพิเศษให้ ${cust} ไปที่ Manager?\n${items.length} รายการ · ส่วนต่างรวม ${fmtMoney(t.diff)} บาท (${fmtPct(t.pct)})\n\nManager อนุมัติแล้วระบบจะส่งต่อให้ผู้บริหารอัตโนมัติ`)) return;

  _saving = true;
  const btn = document.querySelector("#previewModal .pa-primary");
  if (btn) { btn.disabled = true; btn.dataset.t = btn.innerHTML; btn.textContent = "กำลังส่ง..."; }
  try {
    const now = new Date().toISOString();
    const reasonText = document.getElementById("reasonText").value.trim();
    const row = {
      request_type: SP_TYPE,
      request_title: `ขอราคาพิเศษ ${cust} · ${items.length} รายการ · ส่วนลดเฉลี่ย ${fmtPct(t.pct)}`,
      request_detail: buildDetailText(items, t, cust),
      request_status: "waiting_manager",
      status: "manager_review",
      priority: "normal",
      sale_id: me.id,
      created_by: me.id,
      request_by: me.id,
      sale_name: me.name,
      shop_id: pickedShop?.id || null,
      shop_code: pickedShop?.shop_code || null,
      shop_name: cust,
      province: pickedShop?.province || null,
      sale_order_no: document.getElementById("quoteNo").value.trim() || null,
      request_date: document.getElementById("docDate").value || null,
      request_amount: t.request,
      reason: `${reasonType()} — ${reasonText}`,
      signature: sig.get(),
      payload: {
        form_version: "special-price-sale-v2",
        requester: { id: me.id, name: me.name, role: me.role, area: me.area, position: me.position },
        shop: pickedShop,
        items: items.map(({ name, code, unit, qty, normal_price, request_price, discount_pct, diff_total, normal_total, request_total }) => ({ name, code, unit, qty, normal_price, request_price, discount_pct, diff_total, normal_total, request_total })),
        totals: t,
        reason_type: reasonType(),
        reason_text: reasonText,
        manager: null,
      },
      created_at: now,
      updated_at: now,
    };
    const { error } = await supabaseClient.from("approval_requests").insert(row);
    if (error) throw error;
    if (currentDraftKey) { try { localStorage.removeItem(currentDraftKey); } catch (e) { /* ignore */ } }
    resetForm();
    closePreview();
    await loadMyRequests();
    showNotification("ส่งคำขอถึง Manager แล้ว — ติดตามผลได้ที่ “คำขอของฉัน”", "success");
  } catch (e) {
    alert("ส่งคำขอไม่สำเร็จ: " + e.message);
  } finally {
    _saving = false;
    if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.t || "ส่งคำขอ"; }
  }
}

// =====================================================
// 📋 คำขอของฉัน
// =====================================================
async function loadMyRequests() {
  const c = document.getElementById("requestList");
  c.innerHTML = `<div class="fp-empty">กำลังโหลด...</div>`;
  try {
    const { data, error } = await supabaseClient.from("approval_requests").select("*")
      .eq("request_type", SP_TYPE).eq("request_by", me.id)
      .order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    _requests = data || [];
    renderRequests();
  } catch (e) {
    c.innerHTML = `<div class="fp-empty is-error">โหลดไม่สำเร็จ: ${escHtml(e.message)}<br><button type="button" class="fp-link-btn" onclick="loadMyRequests()">ลองใหม่</button></div>`;
  }
}
function renderRequests() {
  const c = document.getElementById("requestList");
  setText("requestCountBadge", _requests.length);
  const rows = _requests.filter((r) => _reqFilter === "all" || (_reqFilter === "done" ? spStatus(r).done : !spStatus(r).done));
  if (!rows.length) { c.innerHTML = `<div class="fp-empty">${_requests.length ? "ไม่มีรายการในกลุ่มนี้" : "ยังไม่มีคำขอราคาพิเศษ"}</div>`; return; }
  c.innerHTML = rows.map((r) => {
    const st = spStatus(r), items = itemsOf(r), t = items.length ? totalsOf(items) : null, id = escHtml(r.id), m = spManager(r);
    const notes = [];
    if (m?.comment) notes.push(`<span class="sp-comment"><span class="material-symbols-outlined">forum</span><b>Manager:</b> ${escHtml(m.comment)}</span>`);
    const ec = r.approval_comment || r.exec_comment;
    if (ec && spReachedExec(r)) notes.push(`<span class="sp-comment"><span class="material-symbols-outlined">forum</span><b>ผู้บริหาร:</b> ${escHtml(ec)}</span>`);
    return `
      <div class="fp-item">
        <button type="button" class="fp-item-main" onclick="openViewPopup('${id}')">
          <span class="fp-item-title">${escHtml(r.shop_name || "-")} <span class="fp-badge ${st.cls}">${escHtml(st.label)}</span></span>
          <span class="fp-item-sub"><span>${items.length || "-"} รายการ</span>${t ? `<span>ลด ${fmtPct(t.pct)}</span><span>ส่วนต่าง ${fmtMoney(t.diff)}</span>` : ""}<span>${formatDateTimeTH(r.created_at)}</span></span>
          ${spStepsMini(r)}
          ${notes.join("")}
        </button>
        <div class="fp-item-actions">
          <button type="button" onclick="openViewPopup('${id}')"><span class="material-symbols-outlined">visibility</span>ดู</button>
          <button type="button" onclick="printRequestById('${id}')"><span class="material-symbols-outlined">print</span>พิมพ์</button>
          <button type="button" onclick="copyRequest('${id}')" title="คัดลอกเป็นคำขอใหม่"><span class="material-symbols-outlined">content_copy</span>${st.key === "request_more_info" ? "แก้แล้วส่งใหม่" : "ทำซ้ำ"}</button>
          ${st.key === "waiting_manager" ? `<button type="button" class="is-danger" onclick="cancelRequest('${id}')"><span class="material-symbols-outlined">block</span>ยกเลิก</button>` : ""}
        </div>
      </div>`;
  }).join("");
}
// แถบความคืบหน้า 3 ขั้นแบบย่อ (ส่ง → Manager → ผู้บริหาร)
function spStepsMini(r) {
  const st = spStatus(r), m = spManager(r);
  const mgr = m ? (m.decision === "approved" ? "ok" : m.decision === "rejected" ? "bad" : "warn") : (st.key === "waiting_manager" ? "now" : (spReachedExec(r) ? "ok" : ""));
  let ex = "";
  if (spReachedExec(r)) ex = ({ pending: "now", approved: "ok", rejected: "bad", request_more_info: "warn" })[st.key] || "";
  return `<span class="sp-mini"><i class="is-ok">ส่ง</i><i class="${mgr ? "is-" + mgr : ""}">Manager</i><i class="${ex ? "is-" + ex : ""}">ผู้บริหาร</i></span>`;
}
function findRequest(id) { return _requests.find((r) => String(r.id) === String(id)) || null; }
// ใช้คำขอเดิมเป็นต้นแบบ (เช่น ถูกขอข้อมูลเพิ่ม/ไม่อนุมัติ แล้วยื่นใหม่) — ไม่คัดลอกลายเซ็น
function copyRequest(id) {
  const r = findRequest(id); if (!r) return;
  if (_dirty && !confirm("ข้อมูลในฟอร์มตอนนี้ยังไม่ได้บันทึก — แทนที่ด้วยคำขอนี้?")) return;
  const p = r.payload || {};
  applySnapshot({
    shop: p.shop || (r.shop_id ? { id: r.shop_id, shop_code: r.shop_code, shop_name: r.shop_name, province: r.province } : null),
    customer_text: r.shop_id ? "" : r.shop_name,
    doc_date: todayISO(), quote_no: r.sale_order_no || "",
    items: (p.items || []).map(({ name, code, unit, qty, normal_price, request_price }) => ({ name, code, unit, qty, normal_price, request_price })),
    reason_type: p.reason_type || "", reason_text: p.reason_text || "", signature: null,
  });
  currentDraftKey = null; _dirty = true; updateStatus();
  document.getElementById("spForm").scrollIntoView({ behavior: "smooth", block: "start" });
  showNotification("คัดลอกมาเป็นคำขอใหม่แล้ว — แก้ไข เซ็นชื่อ แล้วส่งได้เลย", "info");
}
// ยกเลิกได้เฉพาะคำขอที่ Manager ยังไม่พิจารณา
async function cancelRequest(id) {
  const r = findRequest(id);
  if (!confirm(`ยกเลิกคำขอราคาพิเศษของ ${r?.shop_name || ""}?\n(ลบออกจากระบบ Manager จะไม่เห็นรายการนี้อีก)`)) return;
  try {
    const { data, error } = await supabaseClient.from("approval_requests").delete().eq("id", id).eq("request_status", "waiting_manager").select("id");
    if (error) throw error;
    if (Array.isArray(data) && !data.length) throw new Error("คำขอนี้ Manager พิจารณาไปแล้ว หรือไม่มีสิทธิ์ยกเลิก");
    showNotification("ยกเลิกคำขอแล้ว", "success");
    await loadMyRequests();
  } catch (e) { alert("ยกเลิกไม่สำเร็จ: " + e.message); }
}

// =====================================================
// 🧾 ตัวอย่าง / พิมพ์
// =====================================================
function docFromForm() {
  const s = formSnapshot();
  return { customer: customerName(), shop_code: pickedShop?.shop_code, province: pickedShop?.province, quote_no: s.quote_no, requester: me.name, doc_date: s.doc_date, items: s.items, reason_type: s.reason_type, reason_text: s.reason_text.trim(), signature: s.signature };
}
function renderPreviewIssues(res) {
  renderIssues("previewIssues", res);
  const b = document.querySelector("#previewModal .pa-primary"); if (b) b.disabled = res.errors.length > 0;
}
function openPreview() {
  const res = validate();
  showWarnBox(res); renderPreviewIssues(res);
  document.getElementById("previewContent").innerHTML = spBuildDocHTML(docFromForm());
  document.getElementById("previewModal").style.display = "flex";
}
function closePreview() { const m = document.getElementById("previewModal"); if (m) m.style.display = "none"; }
function printPreview() { spOpenPrint(spPrintPage(spBuildDocHTML(docFromForm()))); }
function printRequestById(id) { const r = findRequest(id); if (!r) { alert("ไม่พบข้อมูล กรุณารีเฟรช"); return; } spOpenPrint(spPrintPage(spBuildDocHTML(spDocFromRow(r)))); }

function openViewPopup(id) {
  const r = findRequest(id); if (!r) { alert("ไม่พบข้อมูล กรุณารีเฟรช"); return; }
  let m = document.getElementById("viewPopupModal");
  if (!m) {
    m = document.createElement("div"); m.id = "viewPopupModal"; m.className = "preview-modal";
    m.innerHTML = `<div class="preview-wrapper"><div class="preview-actions" id="viewPopupActions"></div><div id="viewPopupTl" class="sp-tl-wrap"></div><div id="viewPopupContent" class="a4-page"></div></div>`;
    m.addEventListener("click", (e) => { if (e.target === m) closeViewPopup(); });
    document.body.appendChild(m);
  }
  const sid = escHtml(r.id);
  document.getElementById("viewPopupTl").innerHTML = spTimelineHTML(r);
  document.getElementById("viewPopupContent").innerHTML = spBuildDocHTML(spDocFromRow(r));
  document.getElementById("viewPopupActions").innerHTML = `
    <span class="preview-title">${escHtml(r.shop_name || "คำขอราคาพิเศษ")} · ${escHtml(spStatus(r).label)}</span>
    <button type="button" onclick="printRequestById('${sid}')"><span class="material-symbols-outlined">print</span>พิมพ์ / PDF</button>
    <button type="button" onclick="closeViewPopup();copyRequest('${sid}')"><span class="material-symbols-outlined">content_copy</span>ทำซ้ำเป็นคำขอใหม่</button>
    <button type="button" class="pa-close" onclick="closeViewPopup()" aria-label="ปิด"><span class="material-symbols-outlined">close</span></button>`;
  m.style.display = "flex";
}
function closeViewPopup() { const m = document.getElementById("viewPopupModal"); if (m) m.style.display = "none"; }

// =====================================================
// 🔄 CLEAR
// =====================================================
function resetForm() {
  currentDraftKey = null;
  applySnapshot({ shop: null, customer_text: "", doc_date: todayISO(), quote_no: "", items: [], reason_type: "", reason_text: "", signature: null });
  _dirty = false;
  updateStatus(); showWarnBox({ errors: [], warnings: [] }); loadDraftList();
}
function clearForm() {
  if ((_dirty || currentDraftKey) && !confirm("เริ่มคำขอใหม่? ข้อมูลที่ยังไม่บันทึกในฟอร์มจะหาย")) return;
  resetForm();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
window.addEventListener("beforeunload", (e) => { if (_dirty) { e.preventDefault(); e.returnValue = ""; } });
