// =====================================================
// formPlan.js v4.0 — แผนการเดินทางและเบิกทดลองจ่าย (ฟอร์ม ๑)
//
// โครงข้อมูลที่บันทึก (ไม่เปลี่ยน — ฟอร์ม ๒ อ่านต่อ):
//   trips.trips = { rows: [{ date, from, to, shop1..3, shop1Id..3, note }], expense: {...} }
//
// v4.0
//  - หน้าตาใหม่ (แท็บเล็ตแนวนอน): ฟอร์มซ้าย / ร่าง + แผนที่ส่งแล้วด้านขวา
//  - แก้: ร้านที่ไม่ได้เลือกถูกบันทึกเป็นคำว่า "ชื่อร้าน" ลงเอกสาร
//  - แก้: เปิดร่าง/แผนเดิมแล้วร้านที่เลือกไว้หาย (id ตัวเลข vs ข้อความ)
//  - แก้: เปิดร่างแล้วค่าใช้จ่ายของแผนก่อนหน้าค้างอยู่
//  - แก้: ร่างในเครื่องปนกันระหว่างผู้ใช้ที่ใช้แท็บเล็ตเครื่องเดียวกัน
//  - แก้: หมายเหตุที่มีเครื่องหมาย " ทำให้ช่องเพี้ยน (escape HTML)
//  - ตรวจก่อนส่ง: วันที่สิ้นสุด ≥ เริ่ม, ทุกแถวมีวันที่และจังหวัด, วันที่อยู่ในช่วง, จำนวนวัน/คืนไม่เกินช่วง
//  - "จำนวน (วัน)" ในเอกสาร = จำนวนวันที่ไม่ซ้ำในแผน (เดิมนับจำนวนแถว)
// =====================================================
"use strict";

let trips = [];
let currentDraftKey = null;
let currentPlanId = null;
let currentDocNo = null;
let currentVersion = 1;
let myShops = [];
let _completedCache = [];
const DRAFT_PREFIX = "formPlan_draft_";

// =====================================================
// 🚀 INIT
// =====================================================
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof supabaseClient === "undefined") { alert("ระบบยังไม่พร้อม กรุณารีเฟรชหน้า"); return; }
  const ok = await checkAuthorization();
  if (!ok) return;
  await initUserInfo();
  await loadMyShops();
  setDefaultDates();
  setupEventListeners();
  calculateSummary();
  refreshRowState();
  loadLocalDraftList();
  await loadCompletedList();
});

async function checkAuthorization() {
  try {
    if (typeof protectPage === "function") {
      await protectPage(["admin", "sales", "manager", "user"]);
    } else {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) { window.location.href = "/pages/auth/login.html"; return false; }
    }
    return true;
  } catch (e) { console.error("Auth:", e); return false; }
}

// =====================================================
// 👤 USER
// =====================================================
async function initUserInfo() {
  if (typeof initUserService === "function") {
    await initUserService();
    if (typeof autoFillUserData === "function") autoFillUserData({ display_name: "empName", area: "area", readonly: ["display_name", "area"] });
  }
  if (!document.getElementById("empName").value) await loadUserInfoBasic();
  const name = document.getElementById("empName").value;
  const un = document.getElementById("userName"); if (un && name) un.textContent = name;
  const av = document.getElementById("userAvatar"); if (av && name) av.textContent = name.trim().charAt(0).toUpperCase();
  ["empName", "area"].forEach((id) => { const el = document.getElementById(id); if (el) el.readOnly = true; });
}
async function loadUserInfoBasic() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession(); if (!session) return;
    const { data: p } = await supabaseClient.from("profiles").select("display_name,area").eq("id", session.user.id).maybeSingle();
    document.getElementById("empName").value = p?.display_name || session.user.email;
    document.getElementById("area").value = p?.area || "";
  } catch (e) { console.error("loadUserInfoBasic:", e); }
}

// =====================================================
// 🏪 SHOPS
// =====================================================
async function loadMyShops() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession(); if (!session) return;
    const { data: p } = await supabaseClient.from("profiles").select("role,area").eq("id", session.user.id).maybeSingle();
    const role = String(p?.role || "").toLowerCase();
    let q = supabaseClient.from("shops").select("id,shop_name,province,status").eq("status", "Active");
    if (role === "sales" || role === "sale") q = q.eq("sale_id", session.user.id);
    else if (role === "manager" && p?.area) q = q.eq("province", p.area);
    const { data, error } = await q;
    if (error) throw error;
    myShops = (data || []).sort((a, b) => String(a.shop_name).localeCompare(String(b.shop_name), "th"));
  } catch (e) {
    console.error("loadMyShops:", e);
    myShops = [];
  }
  const el = document.getElementById("shopCount"); if (el) el.textContent = myShops.length;
}

// =====================================================
// 📅 DATES
// =====================================================
function toISO(d) { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); }
function parseISO(s) { if (!s) return null; const d = new Date(s + "T00:00:00"); return isNaN(d) ? null : d; }
function addDays(s, n) { const d = parseISO(s); if (!d) return ""; d.setDate(d.getDate() + n); return toISO(d); }
function daysBetween(a, b) { const x = parseISO(a), y = parseISO(b); if (!x || !y) return null; return Math.round((y - x) / 86400000) + 1; }

function setDefaultDates() {
  const s = document.getElementById("startDate"), e = document.getElementById("endDate");
  if (s && !s.value) s.value = toISO(new Date());
  if (e && !e.value) e.value = addDays(s.value, 6); // 1 สัปดาห์ (7 วัน รวมวันแรก)
  updatePeriod();
}
function updatePeriod() {
  const s = document.getElementById("startDate").value, e = document.getElementById("endDate").value;
  const n = daysBetween(s, e);
  const el = document.getElementById("periodDays");
  if (el) {
    el.textContent = n === null ? "–" : n < 1 ? "วันที่ไม่ถูกต้อง" : `${n} วัน`;
    el.classList.toggle("is-bad", n !== null && n < 1);
  }
  document.querySelectorAll("#tripTableBody .trip-date").forEach((inp) => { inp.min = s || ""; inp.max = e || ""; });
}

function setupEventListeners() {
  const s = document.getElementById("startDate"), e = document.getElementById("endDate");
  s?.addEventListener("change", () => {
    // เลื่อนวันสิ้นสุดตาม ถ้าตอนนี้อยู่ก่อนวันเริ่ม
    if (e.value && e.value < s.value) e.value = addDays(s.value, 6);
    updatePeriod();
    markDirty();
  });
  e?.addEventListener("change", () => { updatePeriod(); markDirty(); });
  ["allowanceRate", "allowanceDays", "hotelRate", "hotelNights", "otherCost"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", () => { calculateSummary(); markDirty(); });
  });
  const tbody = document.getElementById("tripTableBody");
  tbody?.addEventListener("change", (ev) => {
    if (ev.target.classList.contains("to-province")) handleProvinceChange(ev.target);
    markDirty();
  });
  tbody?.addEventListener("input", markDirty);
  document.getElementById("previewModal")?.addEventListener("click", (ev) => { if (ev.target.id === "previewModal") closePreview(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { closePreview(); closeCompletedPopup(); } });
}

// =====================================================
// ➕ TABLE ROWS
// =====================================================
function escHtml(t) {
  return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function generateProvinceOptions(sel = "") {
  const p = [...new Set(myShops.map((s) => s.province).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th"));
  if (sel && !p.includes(sel)) p.unshift(sel); // จังหวัดในแผนเก่าที่ไม่อยู่ในรายการแล้ว
  return `<option value="">จังหวัด</option>` + p.map((v) => `<option value="${escHtml(v)}"${v === sel ? " selected" : ""}>${escHtml(v)}</option>`).join("");
}
function generateShopOptions(prov = "", selId = "", selName = "") {
  let h = `<option value="">— ไม่ระบุ —</option>`;
  const list = prov ? myShops.filter((x) => x.province === prov) : [];
  let found = false;
  list.forEach((x) => {
    const on = selId !== "" && selId != null && String(x.id) === String(selId);
    if (on) found = true;
    h += `<option value="${escHtml(x.id)}"${on ? " selected" : ""}>${escHtml(x.shop_name)}</option>`;
  });
  // ร้านในแผนเก่าที่ไม่อยู่ในรายการปัจจุบันแล้ว → ยังแสดงไว้ ไม่ให้ข้อมูลหาย
  if (!found && selName && isRealShopName(selName)) h += `<option value="${escHtml(selId || "")}" selected>${escHtml(selName)}</option>`;
  return h;
}
function isRealShopName(t) {
  const s = String(t || "").trim();
  return !!s && s !== "-" && s !== "ชื่อร้าน" && s !== "— ไม่ระบุ —";
}
function buildRowHTML(t = {}) {
  const s = document.getElementById("startDate")?.value || "", e = document.getElementById("endDate")?.value || "";
  return `
    <td class="c-date"><input type="date" class="trip-date" value="${escHtml(t.date || "")}" min="${s}" max="${e}" aria-label="วันที่"></td>
    <td class="c-prov"><select class="from-province" aria-label="จากจังหวัด">${generateProvinceOptions(t.from || "")}</select></td>
    <td class="c-prov"><select class="to-province" aria-label="ไปจังหวัด">${generateProvinceOptions(t.to || "")}</select></td>
    <td><select class="shop1" aria-label="ร้านค้า 1">${generateShopOptions(t.to, t.shop1Id, t.shop1)}</select></td>
    <td><select class="shop2" aria-label="ร้านค้า 2">${generateShopOptions(t.to, t.shop2Id, t.shop2)}</select></td>
    <td><select class="shop3" aria-label="ร้านค้า 3">${generateShopOptions(t.to, t.shop3Id, t.shop3)}</select></td>
    <td class="c-note"><input type="text" class="note" value="${escHtml(t.note || "")}" placeholder="หมายเหตุ" aria-label="หมายเหตุ"></td>
    <td class="c-del"><button type="button" class="fp-row-del" onclick="removeRowAt(this)" title="ลบวันนี้" aria-label="ลบแถว"><span class="material-symbols-outlined">delete</span></button></td>`;
}
// เพิ่มแถวใหม่: วันที่ = วันถัดจากแถวสุดท้าย, "จากจังหวัด" = จังหวัดปลายทางของวันก่อน
function addRow(prefill) {
  const tbody = document.getElementById("tripTableBody");
  let t = prefill;
  if (!t) {
    const last = tbody.rows[tbody.rows.length - 1];
    const lastDate = last?.querySelector(".trip-date")?.value;
    const lastTo = last?.querySelector(".to-province")?.value;
    const start = document.getElementById("startDate").value;
    t = { date: lastDate ? addDays(lastDate, 1) : start, from: lastTo || "" };
    const end = document.getElementById("endDate").value;
    if (t.date && end && t.date > end) t.date = "";
  }
  const row = document.createElement("tr");
  row.innerHTML = buildRowHTML(t);
  tbody.appendChild(row);
  refreshRowState();
  markDirty();
  if (!prefill) row.querySelector(".to-province")?.focus();
  return row;
}
function removeRow() { const t = document.getElementById("tripTableBody"); if (t.rows.length > 0) t.deleteRow(-1); refreshRowState(); markDirty(); }
function removeRowAt(btn) {
  const tr = btn.closest("tr"); if (!tr) return;
  const hasData = tr.querySelector(".to-province")?.value || tr.querySelector(".note")?.value;
  if (hasData && !confirm("ลบวันนี้ออกจากแผน?")) return;
  tr.remove(); refreshRowState(); markDirty();
}
// สร้างแถวครบทุกวันในช่วงเวลา (เติมเฉพาะวันที่ยังไม่มี)
function fillDaysFromRange() {
  const s = document.getElementById("startDate").value, e = document.getElementById("endDate").value;
  const n = daysBetween(s, e);
  if (!n || n < 1) { alert("กรุณาเลือกช่วงวันที่ให้ถูกต้องก่อน"); return; }
  if (n > 31) { alert("ช่วงวันที่ยาวเกิน 31 วัน — กรุณาตรวจวันที่อีกครั้ง"); return; }
  const have = new Set([...document.querySelectorAll("#tripTableBody .trip-date")].map((i) => i.value).filter(Boolean));
  let added = 0;
  for (let i = 0; i < n; i++) {
    const d = addDays(s, i);
    if (!have.has(d)) { addRow({ date: d }); added++; }
  }
  sortRowsByDate();
  showNotification(added ? `เพิ่ม ${added} วันแล้ว` : "มีครบทุกวันในช่วงแล้ว", added ? "success" : "info");
}
function sortRowsByDate() {
  const tbody = document.getElementById("tripTableBody");
  [...tbody.rows]
    .sort((a, b) => (a.querySelector(".trip-date").value || "9999").localeCompare(b.querySelector(".trip-date").value || "9999"))
    .forEach((r) => tbody.appendChild(r));
}
function handleProvinceChange(sel) {
  const row = sel.closest("tr");
  ["shop1", "shop2", "shop3"].forEach((c) => {
    const s = row.querySelector(`.${c}`);
    s.innerHTML = generateShopOptions(sel.value);
  });
}
function refreshRowState() {
  const n = document.querySelectorAll("#tripTableBody tr").length;
  const empty = document.getElementById("emptyRows"); if (empty) empty.hidden = n > 0;
  const rc = document.getElementById("rowCount");
  if (rc) {
    const days = distinctTripDays(collectTableData());
    rc.textContent = n ? `${n} แถว · ${days} วัน` : "";
  }
}

// =====================================================
// 📦 COLLECT
// =====================================================
function shopText(sel) {
  if (!sel || !sel.value) return "";
  return sel.selectedOptions?.[0]?.text || "";
}
function collectTableData() {
  trips = [...document.querySelectorAll("#tripTableBody tr")].map((r) => ({
    date: r.querySelector(".trip-date")?.value || "",
    from: r.querySelector(".from-province")?.value || "",
    to: r.querySelector(".to-province")?.value || "",
    shop1: shopText(r.querySelector(".shop1")),
    shop2: shopText(r.querySelector(".shop2")),
    shop3: shopText(r.querySelector(".shop3")),
    shop1Id: r.querySelector(".shop1")?.value || "",
    shop2Id: r.querySelector(".shop2")?.value || "",
    shop3Id: r.querySelector(".shop3")?.value || "",
    note: (r.querySelector(".note")?.value || "").trim(),
  }));
  return trips;
}
function distinctTripDays(rows) { return new Set((rows || []).map((t) => t.date).filter(Boolean)).size; }
function num(id) { const v = parseFloat(document.getElementById(id)?.value); return isFinite(v) && v > 0 ? v : 0; }
function collectSummaryData() {
  return { allowance_rate: num("allowanceRate"), allowance_days: num("allowanceDays"), hotel_rate: num("hotelRate"), hotel_nights: num("hotelNights"), other_cost: num("otherCost") };
}
function buildTripsPayload() { collectTableData(); return { rows: trips, expense: collectSummaryData() }; }
function setExpense(exp) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ? v : ""; };
  exp = exp || {};
  set("allowanceRate", exp.allowance_rate); set("allowanceDays", exp.allowance_days);
  set("hotelRate", exp.hotel_rate); set("hotelNights", exp.hotel_nights); set("otherCost", exp.other_cost);
  calculateSummary();
}
function restoreRows(rows) {
  const tbody = document.getElementById("tripTableBody"); tbody.innerHTML = "";
  (rows || []).forEach((t) => {
    // แผนเก่าบันทึก "ชื่อร้าน"/"จังหวัด" (ช่องว่าง) ไว้เป็นข้อความ → ล้างทิ้ง
    const clean = { ...t };
    ["shop1", "shop2", "shop3"].forEach((k) => { if (!isRealShopName(clean[k])) { clean[k] = ""; clean[k + "Id"] = ""; } });
    if (clean.from === "จังหวัด") clean.from = "";
    if (clean.to === "จังหวัด") clean.to = "";
    addRow(clean);
  });
  trips = rows || [];
  refreshRowState();
}
function restoreFromTripsPayload(payload) {
  let rows = [], expense = null;
  if (Array.isArray(payload)) rows = payload;
  else if (payload && typeof payload === "object") { rows = payload.rows || []; expense = payload.expense || null; }
  restoreRows(rows);
  setExpense(expense);
}

// =====================================================
// 📊 SUMMARY
// =====================================================
const fmtMoney = (n) => (n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function calculateSummary() {
  const e = collectSummaryData();
  const a = e.allowance_rate * e.allowance_days, h = e.hotel_rate * e.hotel_nights, o = e.other_cost;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = fmtMoney(v); };
  set("subAllowance", a); set("subHotel", h); set("subOther", o);
  const gt = document.getElementById("grandTotal"); if (gt) { gt.value = fmtMoney(a + h + o); gt.textContent = fmtMoney(a + h + o); }
  return a + h + o;
}
// ใช้จำนวนวันจากแผน: วัน = จำนวนวันที่ไม่ซ้ำ, คืน = วัน − 1
function autoFillDays() {
  const d = distinctTripDays(collectTableData());
  if (!d) { alert("ยังไม่มีวันที่ในแผน"); return; }
  document.getElementById("allowanceDays").value = d;
  document.getElementById("hotelNights").value = Math.max(d - 1, 0);
  calculateSummary(); markDirty();
  showNotification(`ใส่ ${d} วัน / ${Math.max(d - 1, 0)} คืน แล้ว (แก้ได้)`, "info");
}

// =====================================================
// ✅ VALIDATION — คืนรายการปัญหา (errors ห้ามส่ง / warnings เตือน)
// =====================================================
function validatePlan() {
  const errors = [], warnings = [];
  const s = document.getElementById("startDate").value, e = document.getElementById("endDate").value;
  const n = daysBetween(s, e);
  if (!s || !e) errors.push("ยังไม่ได้เลือกช่วงวันที่");
  else if (n < 1) errors.push("วันที่สิ้นสุดอยู่ก่อนวันที่เริ่ม");
  const rows = collectTableData();
  if (!rows.length) errors.push("ยังไม่มีแผนรายวัน");
  rows.forEach((t, i) => {
    const no = `แถวที่ ${i + 1}`;
    if (!t.date) errors.push(`${no}: ยังไม่ได้ใส่วันที่`);
    else if (s && e && (t.date < s || t.date > e)) errors.push(`${no}: วันที่ ${formatDateTH(t.date)} อยู่นอกช่วง ${formatDateTH(s)}–${formatDateTH(e)}`);
    if (!t.to) errors.push(`${no}: ยังไม่ได้เลือก "ไปจังหวัด"`);
    const ids = [t.shop1Id, t.shop2Id, t.shop3Id].filter(Boolean);
    if (new Set(ids).size !== ids.length) warnings.push(`${no}: เลือกร้านซ้ำกัน`);
  });
  const exp = collectSummaryData();
  const days = distinctTripDays(rows);
  if (exp.allowance_days > (n || 0) && n > 0) warnings.push(`เบี้ยเลี้ยง ${exp.allowance_days} วัน มากกว่าช่วงเดินทาง ${n} วัน`);
  if (exp.hotel_nights > Math.max((n || 0) - 1, 0) && n > 0) warnings.push(`ค่าที่พัก ${exp.hotel_nights} คืน มากกว่าจำนวนคืนในช่วง (${Math.max(n - 1, 0)} คืน)`);
  if (exp.allowance_rate && !exp.allowance_days) warnings.push("ใส่อัตราเบี้ยเลี้ยงแล้ว แต่ยังไม่ได้ใส่จำนวนวัน");
  if (exp.hotel_rate && !exp.hotel_nights) warnings.push("ใส่ราคาที่พักแล้ว แต่ยังไม่ได้ใส่จำนวนคืน");
  if (days && exp.allowance_days && exp.allowance_days !== days) warnings.push(`จำนวนวันเบี้ยเลี้ยง (${exp.allowance_days}) ไม่ตรงกับจำนวนวันในแผน (${days})`);
  return { errors, warnings };
}
function showWarnBox(res) {
  const box = document.getElementById("fpWarn"); if (!box) return;
  const items = [...res.errors.map((t) => `<li class="is-err">${escHtml(t)}</li>`), ...res.warnings.map((t) => `<li>${escHtml(t)}</li>`)];
  box.hidden = !items.length;
  box.innerHTML = items.length ? `<b>ตรวจพบ</b><ul>${items.join("")}</ul>` : "";
}

// =====================================================
// 🏷 สถานะฟอร์ม (ใหม่ / ร่าง / แก้แผนเดิม)
// =====================================================
let _dirty = false;
function markDirty() {
  _dirty = true; refreshRowState(); updateStatus();
  // ถ้ากล่อง "ตรวจพบ" แสดงอยู่ ให้อัปเดตตามข้อมูลล่าสุด (แก้ครบแล้วกล่องจะหายเอง)
  const box = document.getElementById("fpWarn");
  if (box && !box.hidden) showWarnBox(validatePlan());
}
function updateStatus() {
  const st = document.getElementById("fpStatus"), banner = document.getElementById("fpEditBanner"), txt = document.getElementById("fpEditText");
  let label = "แผนใหม่ (ยังไม่บันทึก)", bannerText = "";
  if (currentPlanId) { label = `แก้ไข ${currentDocNo || "แผนเดิม"} → จะบันทึกเป็น v${currentVersion + 1}`; bannerText = `กำลังแก้ไขแผน ${currentDocNo || ""} (v${currentVersion}) — ส่งเข้าระบบแล้วจะเป็น v${currentVersion + 1}`; }
  else if (currentDraftKey) { label = _dirty ? "ร่าง (มีการแก้ไขที่ยังไม่บันทึก)" : "ร่าง (บันทึกในเครื่องแล้ว)"; bannerText = "กำลังแก้ไขร่างที่เก็บในเครื่อง"; }
  else if (_dirty) label = "แผนใหม่ (ยังไม่บันทึก)";
  if (st) st.textContent = label;
  if (banner) banner.hidden = !bannerText;
  if (txt) txt.textContent = bannerText;
  document.getElementById("planForm")?.classList.toggle("is-editing", !!bannerText);
}

// =====================================================
// 💾 LOCAL DRAFT (แยกตามผู้ใช้)
// =====================================================
function currentUid() { return (typeof getUserData === "function" && getUserData("id")) || window.currentUser?.id || null; }
function generateDraftKey() { return DRAFT_PREFIX + Date.now() + "_" + Math.random().toString(36).slice(2, 8); }
function getAllLocalDrafts() {
  const uid = currentUid(), d = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(DRAFT_PREFIX)) continue;
      try {
        const v = JSON.parse(localStorage.getItem(k));
        if (v.user_id && uid && v.user_id !== uid) continue; // ร่างของผู้ใช้อื่นในเครื่องเดียวกัน
        v._key = k; d.push(v);
      } catch (e) { /* ข้ามร่างที่เสีย */ }
    }
  } catch (e) { console.warn("localStorage:", e); }
  d.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  return d;
}
function saveDraftToLocal() {
  collectTableData();
  let created = new Date().toISOString();
  try { if (currentDraftKey) created = JSON.parse(localStorage.getItem(currentDraftKey))?.created_at || created; } catch (e) { /* ignore */ }
  const dd = {
    user_id: currentUid(),
    user_name: document.getElementById("empName")?.value || "",
    area: document.getElementById("area")?.value || "",
    start_date: document.getElementById("startDate")?.value || "",
    end_date: document.getElementById("endDate")?.value || "",
    trips,
    expense: collectSummaryData(),
    plan_id: currentPlanId || null, // ร่างที่แก้จากแผนในระบบ
    doc_no: currentDocNo || null,
    version: currentVersion,
    created_at: created,
    updated_at: new Date().toISOString(),
  };
  if (!currentDraftKey) currentDraftKey = generateDraftKey();
  try {
    localStorage.setItem(currentDraftKey, JSON.stringify(dd));
  } catch (e) { alert("บันทึกร่างไม่สำเร็จ (พื้นที่ในเครื่องเต็มหรือถูกปิดไว้)"); return; }
  _dirty = false;
  showNotification("บันทึกร่างในเครื่องแล้ว", "success");
  loadLocalDraftList(); updateStatus();
}
function loadLocalDraftById(key) {
  try {
    const raw = localStorage.getItem(key); if (!raw) { alert("ไม่พบร่างนี้"); loadLocalDraftList(); return; }
    if (_dirty && !confirm("ข้อมูลในฟอร์มตอนนี้ยังไม่ได้บันทึก — เปิดร่างนี้แทน?")) return;
    const d = JSON.parse(raw);
    currentDraftKey = key;
    currentPlanId = d.plan_id || null;
    currentDocNo = d.doc_no || null;
    currentVersion = d.version || 1;
    document.getElementById("startDate").value = d.start_date || "";
    document.getElementById("endDate").value = d.end_date || "";
    updatePeriod();
    restoreRows(Array.isArray(d.trips) ? d.trips : []);
    setExpense(d.expense);
    _dirty = false;
    loadLocalDraftList(); updateStatus(); showWarnBox({ errors: [], warnings: [] });
    document.getElementById("planForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
    showNotification("เปิดร่างแล้ว", "success");
  } catch (e) { alert("เปิดร่างไม่สำเร็จ: " + e.message); }
}
function deleteLocalDraft(key) {
  if (!confirm("ลบร่างนี้? (กู้คืนไม่ได้)")) return;
  try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  if (currentDraftKey === key) { currentDraftKey = null; updateStatus(); }
  loadLocalDraftList();
}
function planTotal(exp) {
  exp = exp || {};
  return (exp.allowance_rate || 0) * (exp.allowance_days || 0) + (exp.hotel_rate || 0) * (exp.hotel_nights || 0) + (exp.other_cost || 0);
}
function loadLocalDraftList() {
  const c = document.getElementById("localDraftList"), b = document.getElementById("localDraftCountBadge"); if (!c) return;
  const drafts = getAllLocalDrafts();
  if (b) b.textContent = drafts.length;
  if (!drafts.length) { c.innerHTML = `<div class="fp-empty">ยังไม่มีร่าง<br><small>กด “บันทึกร่าง” เพื่อเก็บไว้ทำต่อ</small></div>`; return; }
  c.innerHTML = drafts.map((d) => {
    const rows = Array.isArray(d.trips) ? d.trips : [];
    const tot = planTotal(d.expense);
    return `
      <div class="fp-item${d._key === currentDraftKey ? " is-active" : ""}">
        <button type="button" class="fp-item-main" onclick="loadLocalDraftById('${d._key}')">
          <span class="fp-item-title">${formatDateTH(d.start_date)} – ${formatDateTH(d.end_date)}${d.doc_no ? ` <small>(แก้ ${escHtml(d.doc_no)})</small>` : ""}</span>
          <span class="fp-item-sub"><span>${distinctTripDays(rows)} วัน</span>${tot ? `<span>${fmtMoney(tot)} บาท</span>` : ""}<span>แก้ไข ${formatDateTimeTH(d.updated_at)}</span></span>
        </button>
        <div class="fp-item-actions">
          <button type="button" onclick="loadLocalDraftById('${d._key}')"><span class="material-symbols-outlined">edit</span>เปิด</button>
          <button type="button" class="is-danger" onclick="deleteLocalDraft('${d._key}')"><span class="material-symbols-outlined">delete</span>ลบ</button>
        </div>
      </div>`;
  }).join("");
}

// =====================================================
// 🔢 DOC NO
// =====================================================
async function generateDocNo() {
  const year = new Date().getFullYear();
  const { data, error } = await supabaseClient.rpc("get_next_trip_number");
  if (error) throw error;
  return `TRIP-${year}-${String(data).padStart(4, "0")}`;
}

// =====================================================
// 💾 SAVE → SUPABASE
// =====================================================
let _saving = false;
async function saveCompletedToDatabase() {
  if (_saving) return;
  const res = validatePlan();
  showWarnBox(res);
  renderPreviewIssues(res);
  if (res.errors.length) { alert("ยังส่งไม่ได้:\n• " + res.errors.join("\n• ")); return; }
  if (res.warnings.length && !confirm("มีข้อควรตรวจ:\n• " + res.warnings.join("\n• ") + "\n\nส่งเข้าระบบต่อเลยไหม?")) return;
  if (!res.warnings.length && !confirm(currentPlanId ? `บันทึกแผน ${currentDocNo || ""} เป็นเวอร์ชันใหม่ (v${currentVersion + 1})?` : "ส่งแผนนี้เข้าระบบ?")) return;

  _saving = true;
  const btn = document.querySelector(".pa-primary");
  if (btn) { btn.disabled = true; btn.dataset.t = btn.innerHTML; btn.textContent = "กำลังบันทึก..."; }
  try {
    const { userId, userName, userZone } = await getCurrentUserInfo();
    if (!userId) { alert("ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่"); return; }
    const tp = buildTripsPayload();
    let docNo = null, version = 1;

    if (currentPlanId) {
      const { data: old, error: oldErr } = await supabaseClient.from("trips").select("*").eq("id", currentPlanId).single();
      if (oldErr) throw oldErr;
      docNo = old.doc_no; version = (old.version || 1) + 1;
      const { error: vErr } = await supabaseClient.from("trip_versions").insert([{ trip_id: currentPlanId, version: old.version || 1, data: old }]);
      if (vErr) console.warn("trip_versions:", vErr); // เก็บประวัติไม่สำเร็จ ไม่ควรขวางการบันทึก
    } else {
      docNo = await generateDocNo();
    }

    const pd = {
      doc_no: docNo, version, is_latest: true,
      user_id: userId, user_name: userName,
      start_date: document.getElementById("startDate").value,
      end_date: document.getElementById("endDate").value,
      area: document.getElementById("area")?.value || userZone,
      trips: tp, status: "completed",
      updated_at: new Date().toISOString(),
    };
    let result;
    if (currentPlanId) result = await supabaseClient.from("trips").update(pd).eq("id", currentPlanId).select();
    else { pd.created_at = new Date().toISOString(); result = await supabaseClient.from("trips").insert([pd]).select(); }
    if (result.error) throw result.error;
    if (!currentPlanId && result.data?.length) currentPlanId = result.data[0].id;
    currentDocNo = docNo; currentVersion = version;

    if (currentDraftKey) { try { localStorage.removeItem(currentDraftKey); } catch (e) { /* ignore */ } currentDraftKey = null; loadLocalDraftList(); }
    _dirty = false;
    closePreview();
    // ส่งเสร็จ → เริ่มแผนใหม่ (แผนที่ส่งแล้วดู/พิมพ์/แก้ไขได้จากแผงด้านขวา)
    currentPlanId = null; currentDocNo = null; currentVersion = 1; currentDraftKey = null;
    document.getElementById("tripTableBody").innerHTML = "";
    setExpense(null);
    document.getElementById("startDate").value = ""; document.getElementById("endDate").value = "";
    setDefaultDates(); refreshRowState(); updateStatus(); showWarnBox({ errors: [], warnings: [] });
    await loadCompletedList();
    showNotification(`ส่ง ${docNo} v${version} เข้าระบบแล้ว — ดู/พิมพ์ได้ที่แผงด้านขวา`, "success");
  } catch (e) {
    alert("บันทึกไม่สำเร็จ: " + e.message);
  } finally {
    _saving = false;
    if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.t || "ส่งเข้าระบบ"; }
  }
}

// =====================================================
// 📋 COMPLETED LIST
// =====================================================
async function loadCompletedList() {
  const c = document.getElementById("completedList"), b = document.getElementById("completedCountBadge"); if (!c) return;
  c.innerHTML = `<div class="fp-empty">กำลังโหลด...</div>`;
  try {
    const uid = await getCurrentUserId(); if (!uid) { c.innerHTML = `<div class="fp-empty">กรุณาเข้าสู่ระบบ</div>`; return; }
    const { data, error } = await supabaseClient.from("trips")
      .select("id,doc_no,version,user_name,area,start_date,end_date,status,trips,created_at,updated_at")
      .eq("user_id", uid).order("updated_at", { ascending: false });
    if (error) throw error;
    _completedCache = data || [];
    if (b) b.textContent = _completedCache.length;
    if (!_completedCache.length) { c.innerHTML = `<div class="fp-empty">ยังไม่มีแผนในระบบ</div>`; return; }
    c.innerHTML = _completedCache.map(buildCompletedCard).join("");
  } catch (e) {
    c.innerHTML = `<div class="fp-empty is-error">โหลดไม่สำเร็จ: ${escHtml(e.message)}<br><button type="button" class="fp-link-btn" onclick="loadCompletedList()">ลองใหม่</button></div>`;
  }
}
function planRowsOf(plan) {
  if (Array.isArray(plan.trips)) return { rows: plan.trips, expense: {} };
  if (plan.trips && typeof plan.trips === "object") return { rows: Array.isArray(plan.trips.rows) ? plan.trips.rows : [], expense: plan.trips.expense || {} };
  return { rows: [], expense: {} };
}
function buildCompletedCard(plan) {
  const { rows, expense } = planRowsOf(plan);
  const tot = planTotal(expense);
  const pid = escHtml(plan.id);
  const active = String(plan.id) === String(currentPlanId);
  return `
    <div class="fp-item${active ? " is-active" : ""}" id="cdraft-${pid}">
      <button type="button" class="fp-item-main" onclick="openCompletedPopup('${pid}')">
        <span class="fp-item-title">${escHtml(plan.doc_no || "ไม่มีเลขที่")} <small>v${plan.version || 1}</small>
          ${plan.status === "completed" ? `<span class="fp-badge is-ok">ส่งแล้ว</span>` : `<span class="fp-badge">${escHtml(plan.status || "")}</span>`}</span>
        <span class="fp-item-sub"><span>${formatDateTH(plan.start_date)} – ${formatDateTH(plan.end_date)}</span><span>${distinctTripDays(rows)} วัน</span>${tot ? `<span>${fmtMoney(tot)} บาท</span>` : ""}</span>
      </button>
      <div class="fp-item-actions">
        <button type="button" onclick="openCompletedPopup('${pid}')"><span class="material-symbols-outlined">visibility</span>ดู</button>
        <button type="button" onclick="printCompletedById('${pid}')"><span class="material-symbols-outlined">print</span>พิมพ์</button>
        <button type="button" onclick="editCompleted('${pid}')"><span class="material-symbols-outlined">edit</span>แก้ไข</button>
        <button type="button" class="is-danger" onclick="deleteCompletedById('${pid}')"><span class="material-symbols-outlined">delete</span>ลบ</button>
      </div>
    </div>`;
}
function findCompletedPlan(id) { return _completedCache.find((p) => String(p.id) === String(id)) || null; }

// =====================================================
// 🧾 เอกสาร A4 (ใช้ทั้งตัวอย่าง พิมพ์ และ PDF)
// =====================================================
function buildPreviewHTMLFromPlan(plan) {
  const { rows, expense } = planRowsOf(plan);
  const fd = (d) => formatDateTH(d);
  const cell = (v) => escHtml(isRealShopName(v) ? v : "-");
  let tRows = rows.map((t, i) => `<tr${i % 2 ? ' style="background:#f7f9fb"' : ""}><td>${fd(t.date)}</td><td>${escHtml(t.from && t.from !== "จังหวัด" ? t.from : "-")}</td><td>${escHtml(t.to && t.to !== "จังหวัด" ? t.to : "-")}</td><td>${cell(t.shop1)}</td><td>${cell(t.shop2)}</td><td>${cell(t.shop3)}</td><td style="text-align:left;padding-left:4px">${escHtml(t.note || "")}</td></tr>`).join("");
  if (!tRows) tRows = `<tr><td colspan="7" style="text-align:center;color:#999;padding:10px">ไม่มีข้อมูล</td></tr>`;
  const ar = expense.allowance_rate || 0, ad = expense.allowance_days || 0, hr = expense.hotel_rate || 0, hn = expense.hotel_nights || 0, oc = expense.other_cost || 0;
  const ta = ar * ad, th = hr * hn, gt = ta + th + oc;
  const emp = escHtml(plan.user_name || "-"), area = escHtml(plan.area || "-");
  const pd = new Date().toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" });
  return `
<style>
.dw{font-family:'Kanit',sans-serif;font-size:11px;color:#1a1a1a;line-height:1.35}
.dc{text-align:center;margin-bottom:2px}.dc .cn{font-size:18px;font-weight:700}.dc .tt{font-size:14px;font-weight:600;margin-top:1px}
hr.dv{border:none;border-top:1.5px solid #1a1a1a;margin:4px 0 8px}
.dm{display:grid;grid-template-columns:1fr 1fr;border:1px solid #999;border-radius:3px;margin-bottom:8px;overflow:hidden}
.dmc{padding:4px 10px;font-size:14px;line-height:1.6}.dmc:first-child{border-right:1px solid #999}
.ml{font-weight:700;color:#444;margin-right:3px}
.dt{width:100%;border-collapse:collapse;margin-bottom:8px;table-layout:fixed}
.dt th{background:#e8f5f4;color:#1a5550;padding:4px 2px;text-align:center;font-weight:700;font-size:13px;border:1px solid #b2d8d5}
.dt td{padding:3px 4px;text-align:center;border:1px solid #ccc;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.st{font-size:12px;font-weight:700;margin-bottom:3px;padding-bottom:2px;border-bottom:1.5px solid #b2d8d5}
.ct{width:55%;margin-left:auto;margin-bottom:10px;border-collapse:collapse;font-size:13px}
.ct td,.ct th{border:1px solid #ccc;padding:2px 6px}.ct td:first-child{font-weight:600;color:#333}.ct td:nth-child(2){text-align:center;color:#555}.ct td:last-child{text-align:right}
.ct .tr th{background:#e8f5f4;color:#1a5550;text-align:right;padding:3px 6px;font-size:14px;border:1px solid #b2d8d5;font-weight:700}
.sg{margin-top:16px;display:grid;grid-template-columns:repeat(4,1fr);gap:12px;text-align:center}
.sb{font-size:12.5px;line-height:1.5}.sl{border-top:1px solid #555;padding-top:24px;margin-top:40px}.sn{font-weight:600}.sr{color:#555}
.dpd{text-align:right;font-size:9px;color:#777;margin-bottom:3px}
</style>
<div class="dw">
  <div class="dpd">วันที่พิมพ์: ${pd}</div>
  <div style="text-align:right;font-size:12px;margin-bottom:4px">เลขที่เอกสาร: ${escHtml(plan.doc_no || "(ยังไม่ออกเลข)")}<br>Version: v${plan.version || 1}</div>
  <hr style="margin:4px 0;">
  <div class="dc"><div class="cn">บริษัท เอิร์นนี่ แอดวานซ์ จำกัด</div><div class="tt">แผนการเดินทางและเบิกทดลองจ่าย ๑</div></div>
  <hr class="dv">
  <div class="dm">
    <div class="dmc"><div><span class="ml">พนักงานขาย :</span>${emp}</div><div><span class="ml">เขตการขาย :</span>${area}</div></div>
    <div class="dmc"><div><span class="ml">ระหว่างวันที่ :</span>${fd(plan.start_date)}</div><div><span class="ml">ถึงวันที่ :</span>${fd(plan.end_date)}</div><div><span class="ml">จำนวน :</span>${distinctTripDays(rows)} วัน</div></div>
  </div>
  <table class="dt"><thead><tr><th style="width:11%">ว/ด/ป</th><th style="width:13%">จากจังหวัด</th><th style="width:13%">ไปจังหวัด</th><th style="width:18%">ร้านค้า 1</th><th style="width:18%">ร้านค้า 2</th><th style="width:15%">ร้านค้า 3</th><th style="width:12%">หมายเหตุ</th></tr></thead><tbody>${tRows}</tbody></table>
  <div class="st">สรุปค่าใช้จ่าย</div>
  <table class="ct">
    <tr><td>เบี้ยเลี้ยง</td><td>${fmtMoney(ar)} × ${ad} วัน</td><td>${fmtMoney(ta)} บาท</td></tr>
    <tr><td>ค่าที่พัก</td><td>${fmtMoney(hr)} × ${hn} คืน</td><td>${fmtMoney(th)} บาท</td></tr>
    <tr><td>อื่น ๆ</td><td>–</td><td>${fmtMoney(oc)} บาท</td></tr>
    <tr class="tr"><th colspan="2">รวมเบิกทั้งหมด</th><th>${fmtMoney(gt)} บาท</th></tr>
  </table>
  <div class="sg">
    <div class="sb"><div class="sl"><div class="sn">(${emp})</div><div class="sr">พนักงานขาย</div></div></div>
    <div class="sb"><div class="sl"><div class="sn">(.............................................)</div><div class="sr">ผจก.ฝ่ายขาย</div></div></div>
    <div class="sb"><div class="sl"><div class="sn">(.............................................)</div><div class="sr">ฝ่ายบัญชี</div></div></div>
    <div class="sb"><div class="sl"><div class="sn">(.............................................)</div><div class="sr">ผู้อนุมัติ</div></div></div>
  </div>
</div>`;
}
// แผนจากฟอร์มปัจจุบัน (ยังไม่บันทึก)
function currentFormAsPlan() {
  return {
    doc_no: currentDocNo,
    version: currentPlanId ? currentVersion + 1 : 1,
    user_name: document.getElementById("empName")?.value,
    area: document.getElementById("area")?.value,
    start_date: document.getElementById("startDate")?.value,
    end_date: document.getElementById("endDate")?.value,
    trips: buildTripsPayload(),
  };
}
function buildPreviewHTML() { return buildPreviewHTMLFromPlan(currentFormAsPlan()); }

function renderPreviewIssues(res) {
  const box = document.getElementById("previewIssues"); if (!box) return;
  const items = [...res.errors.map((t) => `<li class="is-err">${escHtml(t)}</li>`), ...res.warnings.map((t) => `<li>${escHtml(t)}</li>`)];
  box.hidden = !items.length;
  box.innerHTML = items.length ? `<b>${res.errors.length ? "ต้องแก้ก่อนส่ง" : "ข้อควรตรวจ"}</b><ul>${items.join("")}</ul>` : "";
  const sendBtn = document.querySelector(".pa-primary");
  if (sendBtn) sendBtn.disabled = res.errors.length > 0;
}
function openPreview() {
  const res = validatePlan();
  showWarnBox(res);
  renderPreviewIssues(res);
  document.getElementById("previewContent").innerHTML = buildPreviewHTML();
  document.getElementById("previewModal").style.display = "flex";
}
function closePreview() { const m = document.getElementById("previewModal"); if (m) m.style.display = "none"; }

// ---------- พิมพ์ / PDF (เปิดหน้าใหม่ แล้วใช้ "Save as PDF" ของเครื่อง) ----------
function buildPrintPageHTML(body, autoPrint) {
  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>แผนการเดินทาง</title>
<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}html,body{width:100%;background:#fff;font-family:'Kanit',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.print-wrap{width:190mm;margin:0 auto;padding:10mm 0}
.no-print{text-align:center;padding:12px;background:#f8fafc;border-bottom:1px solid #e2e8f0}
.no-print button{font-family:'Kanit',sans-serif;font-size:15px;font-weight:600;padding:12px 28px;margin:4px;border-radius:10px;cursor:pointer;border:none;color:#fff;min-width:150px}
.no-print p{font-size:12px;color:#64748b;margin-top:6px}
.b1{background:#1E40AF}.b2{background:#64748b}.page-break{break-after:page;page-break-after:always}
@media print{@page{size:A4 portrait;margin:10mm}html,body{width:210mm}.print-wrap{padding:0}.no-print{display:none!important}}
</style></head><body>
<div class="no-print"><button class="b1" onclick="window.print()">พิมพ์ / Save as PDF</button><button class="b2" onclick="window.close()">ปิด</button><p>เลือก "Save as PDF" ในหน้าพิมพ์ เพื่อเก็บเป็นไฟล์ PDF</p></div>
${body}
${autoPrint ? `<script>document.fonts.ready.then(function(){setTimeout(function(){window.print()},400)});<\/script>` : ""}
</body></html>`;
}
function openPrintWindow(html) {
  const w = window.open("", "_blank");
  if (w) { w.document.open(); w.document.write(html); w.document.close(); return; }
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
function printPreview() { openPrintWindow(buildPrintPageHTML(`<div class="print-wrap">${buildPreviewHTML()}</div>`, false)); }
function exportPDF() { printPreview(); }
function printCompletedById(id) {
  const plan = findCompletedPlan(id); if (!plan) { alert("ไม่พบข้อมูล กรุณารีเฟรช"); return; }
  openPrintWindow(buildPrintPageHTML(`<div class="print-wrap">${buildPreviewHTMLFromPlan(plan)}</div>`, false));
}
function exportCompletedPDF(id) {
  const plan = findCompletedPlan(id); if (!plan) { alert("ไม่พบข้อมูล กรุณารีเฟรช"); return; }
  openPrintWindow(buildPrintPageHTML(`<div class="print-wrap">${buildPreviewHTMLFromPlan(plan)}</div>`, true));
}
function exportAllCompletedPDF() {
  if (!_completedCache.length) { alert("ยังไม่มีแผนในระบบ"); return; }
  const pages = _completedCache.map((p, i) => `<div class="print-wrap${i < _completedCache.length - 1 ? " page-break" : ""}">${buildPreviewHTMLFromPlan(p)}</div>`).join("");
  openPrintWindow(buildPrintPageHTML(pages, true));
}

// ---------- ดูแผนที่ส่งแล้ว ----------
function ensureCompletedPopupModal() {
  if (document.getElementById("completedPopupModal")) return;
  const modal = document.createElement("div");
  modal.id = "completedPopupModal";
  modal.className = "preview-modal";
  modal.innerHTML = `<div class="preview-wrapper"><div class="preview-actions" id="completedPopupActions"></div><div id="completedPopupContent" class="a4-page"></div></div>`;
  modal.addEventListener("click", (e) => { if (e.target === modal) closeCompletedPopup(); });
  document.body.appendChild(modal);
}
function openCompletedPopup(id) {
  const plan = findCompletedPlan(id); if (!plan) { alert("ไม่พบข้อมูล กรุณารีเฟรช"); return; }
  ensureCompletedPopupModal();
  document.getElementById("completedPopupContent").innerHTML = buildPreviewHTMLFromPlan(plan);
  document.getElementById("completedPopupActions").innerHTML = `
    <span class="preview-title">${escHtml(plan.doc_no || "แผนการเดินทาง")} v${plan.version || 1}</span>
    <button type="button" onclick="printCompletedById('${escHtml(plan.id)}')"><span class="material-symbols-outlined">print</span>พิมพ์ / PDF</button>
    <button type="button" onclick="closeCompletedPopup();editCompleted('${escHtml(plan.id)}')"><span class="material-symbols-outlined">edit</span>แก้ไข</button>
    <button type="button" onclick="location.href='/pages/forms/formActual.html?plan=${encodeURIComponent(plan.id)}'"><span class="material-symbols-outlined">receipt_long</span>ทำใบเดินทางจริง (ฟอร์ม ๒)</button>
    <button type="button" class="pa-close" onclick="closeCompletedPopup()" aria-label="ปิด"><span class="material-symbols-outlined">close</span></button>`;
  document.getElementById("completedPopupModal").style.display = "flex";
}
function closeCompletedPopup() { const m = document.getElementById("completedPopupModal"); if (m) m.style.display = "none"; }

// =====================================================
// ✏️ EDIT / DELETE COMPLETED
// =====================================================
async function editCompleted(id) {
  if (_dirty && !confirm("ข้อมูลในฟอร์มตอนนี้ยังไม่ได้บันทึก — เปิดแผนนี้มาแก้ไขแทน?")) return;
  await loadCompletedById(id);
}
async function loadCompletedById(id) {
  try {
    const { data, error } = await supabaseClient.from("trips").select("*").eq("id", id).maybeSingle();
    if (error) throw error; if (!data) { alert("ไม่พบข้อมูล"); return; }
    currentPlanId = data.id; currentDraftKey = null;
    currentDocNo = data.doc_no || null; currentVersion = data.version || 1;
    document.getElementById("startDate").value = data.start_date || "";
    document.getElementById("endDate").value = data.end_date || "";
    updatePeriod();
    restoreFromTripsPayload(data.trips);
    _dirty = false;
    updateStatus(); showWarnBox({ errors: [], warnings: [] }); loadLocalDraftList();
    document.querySelectorAll("#completedList .fp-item").forEach((el) => el.classList.toggle("is-active", el.id === `cdraft-${data.id}`));
    document.getElementById("planForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
    showNotification(`เปิด ${data.doc_no || "แผน"} มาแก้ไขแล้ว`, "success");
  } catch (e) { alert("เปิดแผนไม่สำเร็จ: " + e.message); }
}
async function deleteCompletedById(id) {
  const plan = findCompletedPlan(id);
  if (!confirm(`ลบแผน ${plan?.doc_no || ""} ออกจากระบบ?\n\nถ้าใช้แผนนี้ทำฟอร์ม ๒ แล้ว การอ้างอิงจะหายไป`)) return;
  try {
    const { error } = await supabaseClient.from("trips").delete().eq("id", id);
    if (error) throw error;
    if (String(currentPlanId) === String(id)) { currentPlanId = null; currentDocNo = null; currentVersion = 1; updateStatus(); }
    showNotification("ลบแผนแล้ว", "success");
    await loadCompletedList();
  } catch (e) { alert("ลบไม่สำเร็จ: " + e.message); }
}

// =====================================================
// 📤 CSV (คงไว้เผื่อใช้)
// =====================================================
function esc(t) { if (t == null) return ""; const s = String(t); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
const escapeCsv = esc;
function exportTrips() {
  collectTableData(); if (!trips.length) { alert("ยังไม่มีข้อมูล"); return; }
  const hd = ["ลำดับ", "วันที่", "จาก", "ไป", "ร้านค้า1", "ร้านค้า2", "ร้านค้า3", "หมายเหตุ"];
  const rows = trips.map((t, i) => [i + 1, t.date, esc(t.from), esc(t.to), esc(t.shop1), esc(t.shop2), esc(t.shop3), esc(t.note)]);
  const csv = [hd.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a"); a.href = url; a.download = `Plan_${document.getElementById("startDate").value || "nodate"}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

// =====================================================
// 🔄 CLEAR
// =====================================================
function clearForm() {
  if ((_dirty || currentPlanId || currentDraftKey) && !confirm("เริ่มแผนใหม่? ข้อมูลที่ยังไม่บันทึกในฟอร์มจะหาย")) return;
  currentDraftKey = null; currentPlanId = null; currentDocNo = null; currentVersion = 1; trips = [];
  document.getElementById("tripTableBody").innerHTML = "";
  setExpense(null);
  document.getElementById("startDate").value = ""; document.getElementById("endDate").value = "";
  setDefaultDates();
  _dirty = false;
  refreshRowState(); updateStatus(); showWarnBox({ errors: [], warnings: [] }); loadLocalDraftList();
  document.querySelectorAll("#completedList .fp-item.is-active").forEach((el) => el.classList.remove("is-active"));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// =====================================================
// 🔔 NOTIFICATION
// =====================================================
function showNotification(msg, type = "info") {
  document.getElementById("topNotification")?.remove();
  const div = document.createElement("div");
  div.id = "topNotification";
  div.className = `fp-toast is-${type}`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => { div.classList.add("is-out"); setTimeout(() => div.remove(), 300); }, 2600);
}

// =====================================================
// 🛠️ UTILITY
// =====================================================
async function getCurrentUserId() {
  const u = currentUid(); if (u) return u;
  const { data: { user } } = await supabaseClient.auth.getUser(); return user?.id || null;
}
async function getCurrentUserInfo() {
  if (typeof getUserData === "function" && getUserData("id")) return { userId: getUserData("id"), userName: getUserData("display_name") || document.getElementById("empName").value, userZone: getUserData("area") };
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return { userId: null };
  const { data: p } = await supabaseClient.from("profiles").select("display_name,area").eq("id", user.id).maybeSingle();
  return { userId: user.id, userName: p?.display_name || user.email, userZone: p?.area || null };
}
function formatDateTH(ds) { if (!ds) return "-"; const p = String(ds).slice(0, 10).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : ds; }
function formatDateTimeTH(iso) { if (!iso) return "-"; return new Date(iso).toLocaleString("th-TH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
async function logout() {
  try { await supabaseClient.auth.signOut(); } catch (e) { /* ignore */ }
  window.location.href = "/pages/auth/login.html";
}
async function loadHistory(tripId) {
  const { data } = await supabaseClient.from("trip_versions").select("*").eq("trip_id", tripId).order("version", { ascending: false });
  return data;
}

// เตือนก่อนออกจากหน้าถ้ายังไม่ได้บันทึก
window.addEventListener("beforeunload", (e) => {
  if (_dirty) { e.preventDefault(); e.returnValue = ""; }
});
