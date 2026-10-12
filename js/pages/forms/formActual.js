// =====================================================
// formActual.js v3.0 — ใบเดินทางจริงและเคลียร์ค่าใช้จ่าย (ฟอร์ม ๒)
//
// โครงข้อมูลตาราง actuals (ไม่เปลี่ยน — reportTracker อ่านต่อ):
//   user_id, user_name, ref_plan_id, zone, start_date, end_date,
//   rows: [{ date, route, note }], grand_total, status,
//   allowance_rate, allowance_days, hotel_rate, hotel_nights, other_cost,
//   created_at, updated_at
//
// v3.0
//  - หน้าตาใหม่แบบเดียวกับฟอร์ม ๑ (แท็บเล็ตแนวนอน): ฟอร์มซ้าย / ร่าง + ใบที่ส่งแล้วด้านขวา
//  - แก้: ใบที่ส่งเข้าระบบแล้วไม่แสดงในหน้า (กล่องรายการหายไปจาก HTML)
//  - แก้: ระบบผูก "อ้างอิงแผน" กับแผนล่าสุดเองแม้ผู้ใช้ไม่ได้เลือก → ตอนนี้เลือกจากรายการแผน (แสดงเลขที่เอกสาร)
//  - แก้: เปิดร่างในระบบแล้วส่ง → เกิดรายการซ้ำ (ตอนนี้อัปเดตรายการเดิม)
//  - แก้: บันทึกร่างซ้ำได้หลายชุด, ร่างปนกันระหว่างผู้ใช้, ร่างไม่จำแผนที่อ้างอิง
//  - แก้: วันเริ่ม/สิ้นสุดเอาจากแถวแรก/แถวสุดท้าย (ตอนนี้ใช้วันแรกสุด/วันหลังสุดจริง)
//  - แก้: "จำนวน วัน" นับจำนวนแถว (ตอนนี้นับวันที่ไม่ซ้ำ)
//  - แก้: ข้อความที่มี < > " ทำให้เอกสารเพี้ยน (escape HTML)
//  - ตรวจก่อนส่ง + ยืนยัน + กันกดส่งซ้ำ, เทียบยอดกับเงินที่เบิกล่วงหน้าตามแผน
// =====================================================
"use strict";

const DRAFT_PREFIX = "formActual_draft_";
const LEGACY_DRAFT_KEY = "formActualDrafts";

let myPlans = [];            // แผน (trips) ของผู้ใช้
let refPlanId = null;        // แผนที่อ้างอิง (เลือกเองเท่านั้น)
let currentActualId = null;  // แก้ไขรายการเดิมในระบบ
let currentActualStatus = null;
let currentDraftKey = null;  // ร่างในเครื่องที่เปิดอยู่
let _completedCache = [];
let _dirty = false;
let _saving = false;

// =====================================================
// 🚀 INIT
// =====================================================
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof supabaseClient === "undefined") { alert("ระบบยังไม่พร้อม กรุณารีเฟรชหน้า"); return; }
  const ok = await checkAuthorization();
  if (!ok) return;
  await initUserInfo();
  setupEventListeners();
  migrateLegacyDrafts();
  await loadMyPlans();
  await loadCompletedActuals();
  renderPlanOptions();
  preselectPlan();
  calculateSummary();
  refreshRowState();
  updateStatus();
  loadDraftListLocal();
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
    try {
      await initUserService();
      if (typeof autoFillUserData === "function") autoFillUserData({ display_name: "empName", area: "empZone", readonly: ["display_name", "area"] });
    } catch (e) { console.warn("userService:", e); }
  }
  if (!document.getElementById("empName").value) await loadUserInfoBasic();
  const name = document.getElementById("empName").value;
  const un = document.getElementById("userName"); if (un && name) un.textContent = name;
  const av = document.getElementById("userAvatar"); if (av && name) av.textContent = name.trim().charAt(0).toUpperCase();
  ["empName", "empZone"].forEach((id) => { const el = document.getElementById(id); if (el) el.readOnly = true; });
}
async function loadUserInfoBasic() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession(); if (!session) return;
    const { data: p } = await supabaseClient.from("profiles").select("display_name,area").eq("id", session.user.id).maybeSingle();
    document.getElementById("empName").value = p?.display_name || session.user.email;
    document.getElementById("empZone").value = p?.area || "";
  } catch (e) { console.error("loadUserInfoBasic:", e); }
}
function currentUid() { return (typeof getUserData === "function" && getUserData("id")) || window.currentUser?.id || null; }
async function getCurrentUserId() {
  const u = currentUid(); if (u) return u;
  const { data: { user } } = await supabaseClient.auth.getUser(); return user?.id || null;
}

function setupEventListeners() {
  ["allowanceRate", "allowanceDays", "hotelRate", "hotelNights", "otherCost"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", () => { calculateSummary(); markDirty(); });
  });
  const tbody = document.getElementById("tableBody");
  tbody?.addEventListener("input", markDirty);
  tbody?.addEventListener("change", markDirty);
  document.getElementById("previewModal")?.addEventListener("click", (ev) => { if (ev.target.id === "previewModal") closePreview(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { closePreview(); closeViewPopup(); } });
}

// =====================================================
// 📅 / 🔤 HELPERS
// =====================================================
function toISO(d) { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); }
function parseISO(s) { if (!s) return null; const d = new Date(String(s).slice(0, 10) + "T00:00:00"); return isNaN(d) ? null : d; }
function addDays(s, n) { const d = parseISO(s); if (!d) return ""; d.setDate(d.getDate() + n); return toISO(d); }
function todayISO() { return toISO(new Date()); }
function escHtml(t) {
  return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const fmtMoney = (n) => (Number(n) || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function formatDateTH(ds) { if (!ds) return "-"; const p = String(ds).slice(0, 10).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : ds; }
function formatDateTimeTH(iso) { if (!iso) return "-"; return new Date(iso).toLocaleString("th-TH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
function isRealText(t) { const s = String(t || "").trim(); return !!s && s !== "-" && s !== "จังหวัด" && s !== "ชื่อร้าน" && s !== "— ไม่ระบุ —"; }

// =====================================================
// 📋 แผน (ฟอร์ม ๑)
// =====================================================
async function loadMyPlans() {
  try {
    const uid = await getCurrentUserId(); if (!uid) return;
    const { data, error } = await supabaseClient.from("trips")
      .select("id,doc_no,version,is_latest,user_name,area,start_date,end_date,status,trips,created_at,updated_at")
      .eq("user_id", uid).order("start_date", { ascending: false });
    if (error) throw error;
    myPlans = (data || []).filter((p) => p.is_latest !== false);
  } catch (e) {
    console.error("loadMyPlans:", e);
    myPlans = [];
  }
}
function findPlan(id) { return id ? myPlans.find((p) => String(p.id) === String(id)) || null : null; }
function planParts(plan) {
  if (!plan) return { rows: [], expense: {} };
  if (Array.isArray(plan.trips)) return { rows: plan.trips, expense: {} };
  if (plan.trips && typeof plan.trips === "object") return { rows: Array.isArray(plan.trips.rows) ? plan.trips.rows : [], expense: plan.trips.expense || {} };
  return { rows: [], expense: {} };
}
function expenseTotal(e) {
  e = e || {};
  return (Number(e.allowance_rate) || 0) * (Number(e.allowance_days) || 0) + (Number(e.hotel_rate) || 0) * (Number(e.hotel_nights) || 0) + (Number(e.other_cost) || 0);
}
function planAdvance(plan) { return expenseTotal(planParts(plan).expense); }
function planLabel(plan) { return plan ? `${plan.doc_no || "แผน"}${plan.version ? " v" + plan.version : ""}` : ""; }
// ใบฟอร์ม ๒ อื่นที่อ้างอิงแผนนี้แล้ว (ไม่นับใบที่กำลังแก้)
function actualsOfPlan(planId) {
  return _completedCache.filter((a) => a.ref_plan_id && String(a.ref_plan_id) === String(planId) && String(a.id) !== String(currentActualId));
}

function renderPlanOptions() {
  const sel = document.getElementById("refPlanSelect"); if (!sel) return;
  let html = `<option value="">— ไม่อ้างอิงแผน —</option>`;
  // แผนที่อ้างอิงอยู่แต่ไม่อยู่ในรายการ (เช่น ถูกลบไปแล้ว) → ยังคงแสดงไว้
  if (refPlanId && !findPlan(refPlanId)) html += `<option value="${escHtml(refPlanId)}">แผนอ้างอิงเดิม (ไม่พบในรายการ)</option>`;
  html += myPlans.map((p) => {
    const used = actualsOfPlan(p.id).length;
    const adv = planAdvance(p);
    return `<option value="${escHtml(p.id)}">${escHtml(planLabel(p))} · ${formatDateTH(p.start_date)} – ${formatDateTH(p.end_date)}${adv ? ` · เบิก ${fmtMoney(adv)}` : ""}${used ? " · ทำฟอร์ม ๒ แล้ว" : ""}</option>`;
  }).join("");
  sel.innerHTML = html;
  sel.value = refPlanId || "";
  if (!myPlans.length) sel.title = "ยังไม่มีแผนในระบบ";
}

// เลือกแผนให้อัตโนมัติ: ?plan=<id> จากหน้าแผน หรือแผนล่าสุดที่ยังไม่ได้ทำฟอร์ม ๒ (ผู้ใช้เปลี่ยนได้)
function preselectPlan() {
  const q = new URLSearchParams(location.search).get("plan");
  let pick = q && findPlan(q) ? q : null;
  let auto = false;
  if (!pick) {
    const today = todayISO();
    const cand = myPlans.find((p) => p.start_date && p.start_date <= today && !actualsOfPlan(p.id).length);
    if (cand) { pick = cand.id; auto = true; }
  }
  if (!pick) { renderPlanInfo(); return; }
  setRefPlan(pick, { silent: true });
  const info = document.getElementById("planInfo");
  if (auto && info) info.insertAdjacentHTML("afterbegin", `<p class="fa-auto-note"><span class="material-symbols-outlined">auto_awesome</span>เลือกแผนล่าสุดที่ยังไม่ได้ทำฟอร์ม ๒ ให้แล้ว — เปลี่ยนได้ที่ช่องด้านบน</p>`);
  if (q && !auto) importFromPlan({ quiet: true });
}

function onPlanSelect(id) { setRefPlan(id || null); }
function setRefPlan(id, opt = {}) {
  refPlanId = id || null;
  const sel = document.getElementById("refPlanSelect"); if (sel && sel.value !== (refPlanId || "")) sel.value = refPlanId || "";
  renderPlanInfo();
  calculateSummary();
  if (!opt.silent) markDirty();
}
function renderPlanInfo() {
  const box = document.getElementById("planInfo"), btn = document.getElementById("importPlanBtn");
  const plan = findPlan(refPlanId);
  if (btn) btn.disabled = !plan;
  if (!box) return;
  if (!refPlanId) { box.hidden = true; box.innerHTML = ""; return; }
  if (!plan) { box.hidden = false; box.innerHTML = `<p class="fa-plan-meta">อ้างอิงแผนรหัส ${escHtml(String(refPlanId).slice(0, 8))}… (ไม่พบแผนนี้ในรายการของคุณ)</p>`; return; }
  const { rows, expense } = planParts(plan);
  const days = new Set(rows.map((r) => r.date).filter(Boolean)).size;
  const used = actualsOfPlan(plan.id);
  box.hidden = false;
  box.innerHTML = `
    <div class="fa-plan-stats">
      <div><span>เลขที่</span><b>${escHtml(planLabel(plan))}</b></div>
      <div><span>ช่วงตามแผน</span><b>${formatDateTH(plan.start_date)} – ${formatDateTH(plan.end_date)}</b></div>
      <div><span>วันในแผน</span><b>${days} วัน</b></div>
      <div><span>เบิกล่วงหน้า</span><b>${fmtMoney(expenseTotal(expense))} บาท</b></div>
    </div>
    ${used.length ? `<p class="fa-plan-warn"><span class="material-symbols-outlined">info</span>แผนนี้มีใบเดินทางจริงในระบบแล้ว ${used.length} ใบ — ถ้าจะแก้ไข ให้กด “แก้ไข” ที่ใบเดิมด้านข้างแทนการทำใบใหม่</p>` : ""}`;
}

// นำเส้นทาง + ค่าใช้จ่ายจากแผนมาเป็นค่าเริ่มต้น
function importFromPlan(opt = {}) {
  const plan = findPlan(refPlanId);
  if (!plan) { alert("กรุณาเลือกแผนก่อน"); return; }
  const { rows, expense } = planParts(plan);
  if (!rows.length) { alert("แผนนี้ยังไม่มีเส้นทางรายวัน"); return; }
  if (!opt.quiet && collectRows().length && !confirm("แทนที่เส้นทางในตารางตอนนี้ด้วยเส้นทางจากแผน?")) return;
  const list = rows.slice().sort((a, b) => String(a.date || "9999").localeCompare(String(b.date || "9999")));
  document.getElementById("tableBody").innerHTML = "";
  list.forEach((t) => addRow({ date: t.date || "", route: routeFromPlanRow(t), note: t.note || "" }, true));
  setExpense(expense);
  refreshRowState();
  markDirty();
  if (!opt.quiet) showNotification(`นำ ${list.length} วันจากแผนมาแล้ว — แก้ให้ตรงกับที่ไปจริงได้เลย`, "success");
}
function routeFromPlanRow(t) {
  const from = isRealText(t.from) ? t.from : "", to = isRealText(t.to) ? t.to : "";
  const prov = from && to && from !== to ? `${from} → ${to}` : (to || from);
  const shops = [t.shop1, t.shop2, t.shop3].filter(isRealText);
  return [prov, shops.join(", ")].filter(Boolean).join(" : ");
}

// =====================================================
// ➕ ROWS
// =====================================================
function buildRowHTML(r = {}) {
  return `
    <td class="c-date"><input type="date" class="fa-date" value="${escHtml(r.date || "")}" aria-label="วันที่"></td>
    <td><input type="text" class="fa-route" value="${escHtml(r.route || "")}" placeholder="เช่น ขอนแก่น → อุดรธานี : ร้าน ก, ร้าน ข" aria-label="เส้นทาง"></td>
    <td class="c-note"><input type="text" class="fa-note" value="${escHtml(r.note || "")}" placeholder="หมายเหตุ" aria-label="หมายเหตุ"></td>
    <td class="c-del"><button type="button" class="fp-row-del" onclick="removeRowAt(this)" title="ลบวันนี้" aria-label="ลบแถว"><span class="material-symbols-outlined">delete</span></button></td>`;
}
// เพิ่มแถว: วันที่ = วันถัดจากแถวสุดท้าย (หรือวันเริ่มของแผนที่อ้างอิง / วันนี้)
function addRow(prefill, bulk) {
  const tbody = document.getElementById("tableBody");
  let r = prefill;
  if (!r) {
    const last = tbody.rows[tbody.rows.length - 1];
    const lastDate = last?.querySelector(".fa-date")?.value;
    const plan = findPlan(refPlanId);
    r = { date: lastDate ? addDays(lastDate, 1) : (plan?.start_date || todayISO()) };
  }
  const tr = document.createElement("tr");
  tr.innerHTML = buildRowHTML(r);
  tbody.appendChild(tr);
  if (!bulk) { refreshRowState(); markDirty(); tr.querySelector(".fa-route")?.focus(); }
  return tr;
}
function removeRowAt(btn) {
  const tr = btn.closest("tr"); if (!tr) return;
  const hasData = tr.querySelector(".fa-route")?.value.trim() || tr.querySelector(".fa-note")?.value.trim();
  if (hasData && !confirm("ลบวันนี้ออกจากตาราง?")) return;
  tr.remove(); refreshRowState(); markDirty();
}
// แถวที่มีข้อมูล (แถวว่างทั้งแถวไม่นับ)
function collectRows() {
  const out = [];
  document.querySelectorAll("#tableBody tr").forEach((tr) => {
    const date = tr.querySelector(".fa-date")?.value || "";
    const route = (tr.querySelector(".fa-route")?.value || "").trim();
    const note = (tr.querySelector(".fa-note")?.value || "").trim();
    if (date || route || note) out.push({ date, route, note });
  });
  return out;
}
function restoreRows(rows) {
  document.getElementById("tableBody").innerHTML = "";
  (Array.isArray(rows) ? rows : []).forEach((r) => addRow({ date: r.date || "", route: r.route || "", note: r.note || "" }, true));
  refreshRowState();
}
function periodOf(rows) {
  const dates = [...new Set(rows.map((r) => r.date).filter(Boolean))].sort();
  return { start: dates[0] || "", end: dates[dates.length - 1] || "", days: dates.length };
}
function refreshRowState() {
  const n = document.querySelectorAll("#tableBody tr").length;
  const empty = document.getElementById("emptyRows"); if (empty) empty.hidden = n > 0;
  const rows = collectRows(), p = periodOf(rows);
  const rc = document.getElementById("rowCount"); if (rc) rc.textContent = n ? `${n} แถว · ${p.days} วัน` : "";
  const pt = document.getElementById("periodText");
  if (pt) {
    pt.textContent = p.start ? `ช่วงเดินทางจริง ${formatDateTH(p.start)} – ${formatDateTH(p.end)} · ${p.days} วัน` : "ยังไม่มีวันเดินทาง";
    pt.classList.toggle("is-set", !!p.start);
  }
}

// =====================================================
// 💰 ค่าใช้จ่าย
// =====================================================
function num(id) { const v = parseFloat(document.getElementById(id)?.value); return isFinite(v) && v > 0 ? v : 0; }
function collectExpense() {
  return { allowance_rate: num("allowanceRate"), allowance_days: num("allowanceDays"), hotel_rate: num("hotelRate"), hotel_nights: num("hotelNights"), other_cost: num("otherCost") };
}
function setExpense(e) {
  e = e || {};
  const put = (id, v) => { const el = document.getElementById(id); if (el) el.value = Number(v) > 0 ? v : ""; };
  put("allowanceRate", e.allowance_rate); put("allowanceDays", e.allowance_days);
  put("hotelRate", e.hotel_rate); put("hotelNights", e.hotel_nights); put("otherCost", e.other_cost);
  calculateSummary();
}
function calculateSummary() {
  const e = collectExpense();
  const a = e.allowance_rate * e.allowance_days, h = e.hotel_rate * e.hotel_nights, total = a + h + e.other_cost;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("subAllowance", fmtMoney(a)); set("subHotel", fmtMoney(h)); set("subOther", fmtMoney(e.other_cost));
  set("grandTotal", fmtMoney(total));
  // เทียบกับเงินเบิกล่วงหน้าในแผน
  const plan = findPlan(refPlanId), box = document.getElementById("compareBox");
  if (box) {
    box.hidden = !plan;
    if (plan) {
      const adv = planAdvance(plan), diff = adv - total;
      set("cmpPlan", fmtMoney(adv)); set("cmpActual", fmtMoney(total));
      set("cmpDiffLabel", diff > 0 ? "คืนบริษัท" : diff < 0 ? "เบิกเพิ่ม" : "ส่วนต่าง");
      set("cmpDiff", fmtMoney(Math.abs(diff)));
      const d = document.getElementById("cmpDiffBox");
      if (d) { d.classList.toggle("is-return", diff > 0); d.classList.toggle("is-more", diff < 0); }
    }
  }
  return total;
}
function autoFillDays() {
  const p = periodOf(collectRows());
  if (!p.days) { alert("ยังไม่มีวันในตารางเส้นทาง"); return; }
  document.getElementById("allowanceDays").value = p.days;
  document.getElementById("hotelNights").value = Math.max(0, p.days - 1);
  calculateSummary(); markDirty();
  showNotification(`ใส่เบี้ยเลี้ยง ${p.days} วัน · ที่พัก ${Math.max(0, p.days - 1)} คืน`, "info");
}

// =====================================================
// ✅ ตรวจความถูกต้อง
// =====================================================
function validateActual() {
  const errors = [], warnings = [];
  const rows = collectRows();
  const emp = document.getElementById("empName")?.value?.trim();
  if (!emp) errors.push("ไม่พบชื่อพนักงาน กรุณาเข้าสู่ระบบใหม่");
  if (!rows.length) errors.push("ยังไม่มีเส้นทางที่ไปจริง (อย่างน้อย 1 วัน)");
  rows.forEach((r, i) => {
    const label = `แถว ${i + 1}${r.date ? ` (${formatDateTH(r.date)})` : ""}`;
    if (!r.date) errors.push(`${label}: ยังไม่ใส่วันที่`);
    if (!r.route) errors.push(`${label}: ยังไม่ใส่เส้นทาง / ร้านที่ไป`);
  });
  const seen = new Set(), dup = new Set();
  rows.forEach((r) => { if (!r.date) return; if (seen.has(r.date)) dup.add(r.date); seen.add(r.date); });
  if (dup.size) warnings.push(`วันที่ซ้ำกัน: ${[...dup].map(formatDateTH).join(", ")}`);
  const today = todayISO();
  const future = rows.filter((r) => r.date && r.date > today);
  if (future.length) warnings.push(`มีวันที่ยังไม่ถึง: ${future.map((r) => formatDateTH(r.date)).join(", ")} — ใบเดินทางจริงควรทำหลังเดินทางแล้ว`);

  const p = periodOf(rows), e = collectExpense();
  if (p.days && e.allowance_days > p.days) warnings.push(`เบี้ยเลี้ยง ${e.allowance_days} วัน มากกว่าจำนวนวันที่เดินทาง (${p.days} วัน)`);
  if (p.days && e.hotel_nights > p.days) warnings.push(`ค่าที่พัก ${e.hotel_nights} คืน มากกว่าจำนวนวันที่เดินทาง (${p.days} วัน)`);
  if (e.allowance_rate && !e.allowance_days) warnings.push("ใส่อัตราเบี้ยเลี้ยงแล้ว แต่จำนวนวันเป็น 0");
  if (!e.allowance_rate && e.allowance_days) warnings.push("ใส่จำนวนวันเบี้ยเลี้ยงแล้ว แต่อัตราเป็น 0");
  if (e.hotel_rate && !e.hotel_nights) warnings.push("ใส่ค่าที่พักแล้ว แต่จำนวนคืนเป็น 0");
  if (!e.hotel_rate && e.hotel_nights) warnings.push("ใส่จำนวนคืนที่พักแล้ว แต่ค่าที่พักเป็น 0");
  if (rows.length && expenseTotal(e) === 0) warnings.push("ยอดค่าใช้จ่ายจริงเป็น 0 บาท");

  const plan = findPlan(refPlanId);
  if (!refPlanId) warnings.push("ไม่ได้อ้างอิงแผน (ฟอร์ม ๑) — จะเทียบยอดเบิกล่วงหน้าไม่ได้");
  if (plan) {
    const out = rows.filter((r) => r.date && ((plan.start_date && r.date < plan.start_date) || (plan.end_date && r.date > plan.end_date)));
    if (out.length) warnings.push(`วันที่อยู่นอกช่วงแผน ${formatDateTH(plan.start_date)} – ${formatDateTH(plan.end_date)}: ${out.map((r) => formatDateTH(r.date)).join(", ")}`);
    const used = actualsOfPlan(plan.id);
    if (used.length) warnings.push(`แผน ${planLabel(plan)} มีใบเดินทางจริงในระบบแล้ว ${used.length} ใบ — ส่งใบนี้จะเป็นอีกใบหนึ่ง`);
  }
  return { errors, warnings };
}
function showWarnBox(res) {
  const box = document.getElementById("fpWarn"); if (!box) return;
  const items = [...res.errors.map((t) => `<li class="is-err">${escHtml(t)}</li>`), ...res.warnings.map((t) => `<li>${escHtml(t)}</li>`)];
  box.hidden = !items.length;
  box.innerHTML = items.length ? `<b>ตรวจพบ</b><ul>${items.join("")}</ul>` : "";
}

// =====================================================
// 🏷 สถานะฟอร์ม
// =====================================================
function markDirty() {
  _dirty = true; refreshRowState(); updateStatus();
  const box = document.getElementById("fpWarn");
  if (box && !box.hidden) showWarnBox(validateActual());
}
function currentActualLabel() {
  const a = _completedCache.find((x) => String(x.id) === String(currentActualId));
  return a ? `${formatDateTH(a.start_date)} – ${formatDateTH(a.end_date)}` : "";
}
function updateStatus() {
  const st = document.getElementById("fpStatus"), banner = document.getElementById("fpEditBanner"), txt = document.getElementById("fpEditText");
  let label = "ใบใหม่ (ยังไม่บันทึก)", bannerText = "";
  if (currentActualId) {
    const what = currentActualStatus === "completed" ? "ใบที่ส่งแล้ว" : "ร่างในระบบ";
    label = `แก้ไข${what} → ส่งแล้วจะอัปเดตใบเดิม`;
    bannerText = `กำลังแก้ไข${what} ${currentActualLabel()} — กดส่งแล้วจะบันทึกทับใบเดิม (ไม่สร้างใบซ้ำ)`;
  } else if (currentDraftKey) {
    label = _dirty ? "ร่าง (มีการแก้ไขที่ยังไม่บันทึก)" : "ร่าง (บันทึกในเครื่องแล้ว)";
    bannerText = "กำลังแก้ไขร่างที่เก็บในเครื่อง";
  }
  if (st) st.textContent = label;
  if (banner) banner.hidden = !bannerText;
  if (txt) txt.textContent = bannerText;
  document.getElementById("actualForm")?.classList.toggle("is-editing", !!bannerText);
}

// =====================================================
// 💾 ร่างในเครื่อง (แยกตามผู้ใช้ · บันทึกทับร่างเดิม)
// =====================================================
function generateDraftKey() { return DRAFT_PREFIX + Date.now() + "_" + Math.random().toString(36).slice(2, 8); }
// ย้ายร่างรูปแบบเก่า (array เดียว) มาเป็นแบบใหม่ครั้งเดียว
function migrateLegacyDrafts() {
  try {
    const raw = localStorage.getItem(LEGACY_DRAFT_KEY); if (!raw) return;
    const list = JSON.parse(raw);
    (Array.isArray(list) ? list : []).forEach((d, i) => {
      const t = d.savedAt || new Date().toISOString();
      localStorage.setItem(`${DRAFT_PREFIX}legacy_${d.id || Date.now()}_${i}`, JSON.stringify({
        user_id: null, user_name: d.emp || "", zone: d.zone || "",
        ref_plan_id: d.refPlanId || null, actual_id: null,
        rows: Array.isArray(d.rows) ? d.rows : [],
        expense: { allowance_rate: d.allowanceRate || 0, allowance_days: d.allowanceDays || 0, hotel_rate: d.hotelRate || 0, hotel_nights: d.hotelNights || 0, other_cost: d.otherCost || 0 },
        created_at: t, updated_at: t,
      }));
    });
    localStorage.removeItem(LEGACY_DRAFT_KEY);
  } catch (e) { console.warn("migrateLegacyDrafts:", e); }
}
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
function saveDraft() {
  const rows = collectRows();
  if (!rows.length && !expenseTotal(collectExpense()) && !refPlanId) { alert("ยังไม่มีข้อมูลให้บันทึก"); return; }
  let created = new Date().toISOString();
  try { if (currentDraftKey) created = JSON.parse(localStorage.getItem(currentDraftKey))?.created_at || created; } catch (e) { /* ignore */ }
  const dd = {
    user_id: currentUid(),
    user_name: document.getElementById("empName")?.value || "",
    zone: document.getElementById("empZone")?.value || "",
    ref_plan_id: refPlanId,
    actual_id: currentActualId,
    actual_status: currentActualStatus,
    rows,
    expense: collectExpense(),
    created_at: created,
    updated_at: new Date().toISOString(),
  };
  if (!currentDraftKey) currentDraftKey = generateDraftKey();
  try { localStorage.setItem(currentDraftKey, JSON.stringify(dd)); }
  catch (e) { alert("บันทึกร่างไม่สำเร็จ (พื้นที่ในเครื่องเต็มหรือถูกปิดไว้)"); return; }
  _dirty = false;
  showNotification("บันทึกร่างในเครื่องแล้ว", "success");
  loadDraftListLocal(); updateStatus();
}
function loadDraftLocal(key) {
  try {
    const raw = localStorage.getItem(key); if (!raw) { alert("ไม่พบร่างนี้"); loadDraftListLocal(); return; }
    if (_dirty && !confirm("ข้อมูลในฟอร์มตอนนี้ยังไม่ได้บันทึก — เปิดร่างนี้แทน?")) return;
    const d = JSON.parse(raw);
    currentDraftKey = key;
    currentActualId = d.actual_id || null;
    currentActualStatus = d.actual_status || null;
    refPlanId = d.ref_plan_id || null;
    renderPlanOptions(); renderPlanInfo();
    restoreRows(d.rows);
    setExpense(d.expense);
    _dirty = false;
    loadDraftListLocal(); updateStatus(); showWarnBox({ errors: [], warnings: [] }); markActiveCompleted();
    document.getElementById("actualForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
    showNotification("เปิดร่างแล้ว", "success");
  } catch (e) { alert("เปิดร่างไม่สำเร็จ: " + e.message); }
}
function deleteDraftLocal(key) {
  if (!confirm("ลบร่างนี้? (กู้คืนไม่ได้)")) return;
  try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  if (currentDraftKey === key) { currentDraftKey = null; updateStatus(); }
  loadDraftListLocal();
}
function loadDraftListLocal() {
  const c = document.getElementById("draftList"), b = document.getElementById("draftCountBadge"); if (!c) return;
  const drafts = getAllLocalDrafts();
  if (b) b.textContent = drafts.length;
  if (!drafts.length) { c.innerHTML = `<div class="fp-empty">ยังไม่มีร่าง<br><small>กด “บันทึกร่าง” เพื่อเก็บไว้ทำต่อ</small></div>`; return; }
  c.innerHTML = drafts.map((d) => {
    const rows = Array.isArray(d.rows) ? d.rows : [];
    const p = periodOf(rows), tot = expenseTotal(d.expense), plan = findPlan(d.ref_plan_id);
    const k = escHtml(d._key);
    return `
      <div class="fp-item${d._key === currentDraftKey ? " is-active" : ""}">
        <button type="button" class="fp-item-main" onclick="loadDraftLocal('${k}')">
          <span class="fp-item-title">${p.start ? `${formatDateTH(p.start)} – ${formatDateTH(p.end)}` : "ยังไม่มีวันที่"}${d.actual_id ? ` <small>(แก้ใบเดิม)</small>` : ""}</span>
          <span class="fp-item-sub"><span>${p.days} วัน</span>${tot ? `<span>${fmtMoney(tot)} บาท</span>` : ""}${plan ? `<span>${escHtml(planLabel(plan))}</span>` : ""}<span>แก้ไข ${formatDateTimeTH(d.updated_at)}</span></span>
        </button>
        <div class="fp-item-actions">
          <button type="button" onclick="loadDraftLocal('${k}')"><span class="material-symbols-outlined">edit</span>เปิด</button>
          <button type="button" class="is-danger" onclick="deleteDraftLocal('${k}')"><span class="material-symbols-outlined">delete</span>ลบ</button>
        </div>
      </div>`;
  }).join("");
}

// =====================================================
// ✅ ส่งเข้าระบบ
// =====================================================
async function saveAndClose() {
  if (_saving) return;
  const res = validateActual();
  showWarnBox(res);
  renderPreviewIssues(res);
  if (res.errors.length) { alert("ยังส่งไม่ได้:\n• " + res.errors.join("\n• ")); return; }
  const total = calculateSummary();
  const ask = currentActualId ? `บันทึกทับใบเดิม (ยอด ${fmtMoney(total)} บาท)?` : `ส่งใบเดินทางจริงเข้าระบบ (ยอด ${fmtMoney(total)} บาท)?`;
  if (!confirm((res.warnings.length ? "มีข้อควรตรวจ:\n• " + res.warnings.join("\n• ") + "\n\n" : "") + ask)) return;

  _saving = true;
  const btn = document.querySelector("#previewModal .pa-primary");
  if (btn) { btn.disabled = true; btn.dataset.t = btn.innerHTML; btn.textContent = "กำลังบันทึก..."; }
  try {
    const uid = await getCurrentUserId();
    if (!uid) { alert("ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่"); return; }
    const rows = collectRows().sort((a, b) => a.date.localeCompare(b.date));
    const p = periodOf(rows), e = collectExpense(), now = new Date().toISOString();
    const payload = {
      user_id: uid,
      user_name: document.getElementById("empName").value.trim(),
      ref_plan_id: refPlanId || null,
      zone: document.getElementById("empZone").value.trim(),
      start_date: p.start || null,
      end_date: p.end || null,
      rows,
      grand_total: expenseTotal(e),
      status: "completed",
      updated_at: now,
      ...e,
    };
    let result;
    if (currentActualId) result = await supabaseClient.from("actuals").update(payload).eq("id", currentActualId).select();
    else result = await supabaseClient.from("actuals").insert([{ ...payload, created_at: now }]).select();
    if (result.error) throw result.error;

    if (currentDraftKey) { try { localStorage.removeItem(currentDraftKey); } catch (er) { /* ignore */ } }
    const wasEdit = !!currentActualId;
    resetForm();
    closePreview();
    await loadCompletedActuals();
    renderPlanOptions(); renderPlanInfo();
    showNotification(wasEdit ? "อัปเดตใบเดิมเรียบร้อย" : "ส่งใบเดินทางจริงเข้าระบบแล้ว — ดู/พิมพ์ได้ที่แผงด้านข้าง", "success");
  } catch (err) {
    alert("บันทึกไม่สำเร็จ: " + err.message);
  } finally {
    _saving = false;
    if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.t || "ส่งเข้าระบบ"; }
  }
}

// =====================================================
// 📋 ใบที่ส่งแล้ว
// =====================================================
async function loadCompletedActuals() {
  const c = document.getElementById("completedActualList"), b = document.getElementById("completedCountBadge");
  if (c) c.innerHTML = `<div class="fp-empty">กำลังโหลด...</div>`;
  try {
    const uid = await getCurrentUserId();
    if (!uid) { if (c) c.innerHTML = `<div class="fp-empty">กรุณาเข้าสู่ระบบ</div>`; return; }
    const { data, error } = await supabaseClient.from("actuals")
      .select("id,user_name,zone,ref_plan_id,start_date,end_date,status,rows,grand_total,created_at,updated_at,allowance_rate,allowance_days,hotel_rate,hotel_nights,other_cost")
      .eq("user_id", uid).order("updated_at", { ascending: false });
    if (error) throw error;
    _completedCache = data || [];
    if (b) b.textContent = _completedCache.length;
    if (!c) return;
    if (!_completedCache.length) { c.innerHTML = `<div class="fp-empty">ยังไม่มีใบเดินทางจริงในระบบ</div>`; return; }
    c.innerHTML = _completedCache.map(buildCompletedCard).join("");
  } catch (e) {
    if (c) c.innerHTML = `<div class="fp-empty is-error">โหลดไม่สำเร็จ: ${escHtml(e.message)}<br><button type="button" class="fp-link-btn" onclick="loadCompletedActuals()">ลองใหม่</button></div>`;
  }
}
function actualTotal(a) { return a.grand_total != null ? Number(a.grand_total) || 0 : expenseTotal(a); }
function statusBadge(s) {
  if (s === "completed") return `<span class="fp-badge is-ok">ส่งแล้ว</span>`;
  if (s === "draft") return `<span class="fp-badge">ร่างในระบบ</span>`;
  return `<span class="fp-badge">${escHtml(s || "รอดำเนินการ")}</span>`;
}
function buildCompletedCard(a) {
  const rows = Array.isArray(a.rows) ? a.rows : [];
  const p = periodOf(rows), plan = findPlan(a.ref_plan_id), id = escHtml(a.id);
  return `
    <div class="fp-item${String(a.id) === String(currentActualId) ? " is-active" : ""}" id="act-${id}">
      <button type="button" class="fp-item-main" onclick="openViewPopup('${id}')">
        <span class="fp-item-title">${formatDateTH(a.start_date)} – ${formatDateTH(a.end_date)} ${statusBadge(a.status)}</span>
        <span class="fp-item-sub"><span>${p.days || rows.length} วัน</span><span>${fmtMoney(actualTotal(a))} บาท</span>${plan ? `<span>${escHtml(planLabel(plan))}</span>` : a.ref_plan_id ? "<span>อ้างอิงแผน</span>" : ""}<span>${formatDateTimeTH(a.updated_at || a.created_at)}</span></span>
      </button>
      <div class="fp-item-actions">
        <button type="button" onclick="openViewPopup('${id}')"><span class="material-symbols-outlined">visibility</span>ดู</button>
        <button type="button" onclick="printActualById('${id}')"><span class="material-symbols-outlined">print</span>พิมพ์</button>
        <button type="button" onclick="editActual('${id}')"><span class="material-symbols-outlined">edit</span>แก้ไข</button>
        <button type="button" class="is-danger" onclick="deleteActualById('${id}')"><span class="material-symbols-outlined">delete</span>ลบ</button>
      </div>
    </div>`;
}
function findActual(id) { return _completedCache.find((a) => String(a.id) === String(id)) || null; }
function markActiveCompleted() {
  document.querySelectorAll("#completedActualList .fp-item").forEach((el) => el.classList.toggle("is-active", !!currentActualId && el.id === `act-${currentActualId}`));
}

async function editActual(id) {
  if (_dirty && !confirm("ข้อมูลในฟอร์มตอนนี้ยังไม่ได้บันทึก — เปิดใบนี้มาแก้ไขแทน?")) return;
  try {
    const { data, error } = await supabaseClient.from("actuals").select("*").eq("id", id).maybeSingle();
    if (error) throw error; if (!data) { alert("ไม่พบข้อมูล"); return; }
    currentActualId = data.id; currentActualStatus = data.status || null; currentDraftKey = null;
    refPlanId = data.ref_plan_id || null;
    renderPlanOptions(); renderPlanInfo();
    restoreRows(data.rows);
    setExpense(data);
    _dirty = false;
    updateStatus(); showWarnBox({ errors: [], warnings: [] }); loadDraftListLocal(); markActiveCompleted();
    document.getElementById("actualForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
    showNotification("เปิดใบเดิมมาแก้ไขแล้ว", "success");
  } catch (e) { alert("เปิดไม่สำเร็จ: " + e.message); }
}
async function deleteActualById(id) {
  const a = findActual(id);
  if (!confirm(`ลบใบเดินทางจริง ${a ? formatDateTH(a.start_date) + " – " + formatDateTH(a.end_date) : ""} ออกจากระบบ?\n(กู้คืนไม่ได้)`)) return;
  try {
    const { error } = await supabaseClient.from("actuals").delete().eq("id", id);
    if (error) throw error;
    if (String(currentActualId) === String(id)) { currentActualId = null; currentActualStatus = null; updateStatus(); }
    showNotification("ลบแล้ว", "success");
    await loadCompletedActuals();
    renderPlanOptions(); renderPlanInfo();
  } catch (e) { alert("ลบไม่สำเร็จ: " + e.message); }
}

// =====================================================
// 🧾 เอกสาร A4 (ตัวอย่าง / พิมพ์ / PDF)
// =====================================================
function buildActualPreviewFromData(d) {
  const rows = (Array.isArray(d.rows) ? d.rows : []).slice().sort((a, b) => String(a.date || "9999").localeCompare(String(b.date || "9999")));
  const p = periodOf(rows);
  const ar = Number(d.allowance_rate) || 0, ad = Number(d.allowance_days) || 0, hr = Number(d.hotel_rate) || 0, hn = Number(d.hotel_nights) || 0, oc = Number(d.other_cost) || 0;
  const ta = ar * ad, th = hr * hn, gt = ta + th + oc;
  const today = new Date().toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" });
  const plan = findPlan(d.ref_plan_id);
  const planRef = d.ref_plan_id ? `<div><span class="ml">อ้างอิงแผน :</span>${plan ? escHtml(planLabel(plan)) : escHtml(String(d.ref_plan_id).slice(0, 8)) + "…"}</div>` : "";
  let cmp = "";
  if (plan) {
    const adv = planAdvance(plan), diff = adv - gt;
    cmp = `<tr><td>เบิกล่วงหน้า (ตามแผน)</td><td>–</td><td>${fmtMoney(adv)} บาท</td></tr>
    <tr class="tr"><th colspan="2">${diff > 0 ? "คืนบริษัท" : diff < 0 ? "เบิกเพิ่ม" : "ส่วนต่าง"}</th><th>${fmtMoney(Math.abs(diff))} บาท</th></tr>`;
  }
  const tRows = rows.map((r, i) => `<tr${i % 2 ? ' style="background:#f7f9fb"' : ""}><td>${formatDateTH(r.date)}</td><td style="text-align:left;padding-left:6px">${escHtml(r.route || "-")}</td><td style="text-align:left;padding-left:4px">${escHtml(r.note || "")}</td></tr>`).join("");
  return `
<style>
.dw{font-family:'Kanit',sans-serif;font-size:11px;color:#1a1a1a;line-height:1.35}
.dc{text-align:center;margin-bottom:2px}.dc .cn{font-size:18px;font-weight:700}.dc .tt{font-size:14px;font-weight:600;margin-top:1px}
hr.dv{border:none;border-top:1.5px solid #1a1a1a;margin:4px 0 8px}
.dpd{text-align:right;font-size:9px;color:#777;margin-bottom:3px}
.dm{display:grid;grid-template-columns:1fr 1fr;border:1px solid #999;border-radius:3px;margin-bottom:8px;overflow:hidden}
.dmc{padding:4px 10px;font-size:14px;line-height:1.6}.dmc:first-child{border-right:1px solid #999}
.ml{font-weight:700;color:#444;margin-right:3px}
.dt{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:10px;table-layout:fixed}
.dt th{background:#e8f5f4;color:#1a5550;padding:4px 4px;text-align:center;border:1px solid #b2d8d5;font-size:14px;font-weight:700}
.dt td{padding:3px 4px;border:1px solid #ccc;text-align:center;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st{font-size:11px;font-weight:700;margin-bottom:3px;padding-bottom:2px;border-bottom:1.5px solid #1a6b64;display:flex;align-items:center;gap:4px}
.st::before{content:'';display:inline-block;width:3px;height:12px;background:#3FB7AE;border-radius:2px}
.ct{width:50%;margin-left:auto;margin-bottom:10px;border-collapse:collapse;font-size:14px}
.ct td,.ct th{border:1px solid #ccc;padding:2px 6px}.ct td:first-child{font-weight:600;color:#333}.ct td:nth-child(2){text-align:center;color:#555}.ct td:last-child{text-align:right}
.ct .tr th{background:#e8f5f4;color:#1a5550;text-align:right;padding:3px 6px;font-size:14px;border:1px solid #b2d8d5;font-weight:700}
.sg{margin-top:16px;display:grid;grid-template-columns:repeat(4,1fr);gap:12px;text-align:center}
.sb{font-size:12.5px;line-height:1.5}.sl{border-top:1px solid #555;padding-top:24px;margin-top:40px}
.sn{font-weight:600}.sr{color:#555}
</style>
<div class="dw">
  <div class="dpd">วันที่พิมพ์: ${today}</div>
  <div class="dc"><div class="cn">บริษัท เอิร์นนี่ แอดวานซ์ จำกัด</div><div class="tt">ใบเดินทางจริงและเคลียร์ค่าใช้จ่าย ๒</div></div>
  <hr class="dv">
  <div class="dm"><div class="dmc"><div><span class="ml">พนักงานขาย :</span>${escHtml(d.user_name || "-")}</div><div><span class="ml">เขตการขาย :</span>${escHtml(d.zone || "-")}</div>${planRef}</div><div class="dmc"><div><span class="ml">ระหว่างวันที่ :</span>${formatDateTH(p.start || d.start_date)}</div><div><span class="ml">ถึงวันที่ :</span>${formatDateTH(p.end || d.end_date)}</div><div><span class="ml">จำนวน :</span>${p.days} วัน</div></div></div>
  <table class="dt"><thead><tr><th style="width:15%">ว/ด/ป</th><th style="width:65%">เส้นทางจริง</th><th style="width:20%">หมายเหตุ</th></tr></thead><tbody>${tRows || '<tr><td colspan="3" style="text-align:center;color:#999;padding:10px">ไม่มีข้อมูล</td></tr>'}</tbody></table>
  <div class="st">สรุปค่าใช้จ่าย</div>
  <table class="ct">
    <tr><td>เบี้ยเลี้ยง</td><td>${fmtMoney(ar)} × ${ad} วัน</td><td>${fmtMoney(ta)} บาท</td></tr>
    <tr><td>ค่าที่พัก</td><td>${fmtMoney(hr)} × ${hn} คืน</td><td>${fmtMoney(th)} บาท</td></tr>
    <tr><td>อื่นๆ</td><td style="text-align:center">–</td><td>${fmtMoney(oc)} บาท</td></tr>
    <tr class="tr"><th colspan="2">รวมค่าใช้จ่ายจริง</th><th style="font-size:14px">${fmtMoney(gt)} บาท</th></tr>
    ${cmp}
  </table>
  <div class="sg">
    <div class="sb"><div class="sl"><div class="sn">(${escHtml(d.user_name || " - ")})</div><div class="sr">พนักงานขาย</div></div></div>
    <div class="sb"><div class="sl"><div class="sn">(...............................................................)</div><div class="sr">ผจก.ฝ่ายขาย</div></div></div>
    <div class="sb"><div class="sl"><div class="sn">(...............................................................)</div><div class="sr">ฝ่ายบัญชี</div></div></div>
    <div class="sb"><div class="sl"><div class="sn">(...............................................................)</div><div class="sr">ผู้อนุมัติ</div></div></div>
  </div>
</div>`;
}
function currentFormAsData() {
  const rows = collectRows(), p = periodOf(rows);
  return {
    user_name: document.getElementById("empName")?.value || "",
    zone: document.getElementById("empZone")?.value || "",
    ref_plan_id: refPlanId, start_date: p.start, end_date: p.end, rows,
    ...collectExpense(),
  };
}
function renderPreviewIssues(res) {
  const box = document.getElementById("previewIssues"); if (!box) return;
  const items = [...res.errors.map((t) => `<li class="is-err">${escHtml(t)}</li>`), ...res.warnings.map((t) => `<li>${escHtml(t)}</li>`)];
  box.hidden = !items.length;
  box.innerHTML = items.length ? `<b>${res.errors.length ? "ต้องแก้ก่อนส่ง" : "ข้อควรตรวจ"}</b><ul>${items.join("")}</ul>` : "";
  const sendBtn = document.querySelector("#previewModal .pa-primary");
  if (sendBtn) sendBtn.disabled = res.errors.length > 0;
}
function openPreview() {
  const res = validateActual();
  showWarnBox(res);
  renderPreviewIssues(res);
  document.getElementById("previewContent").innerHTML = buildActualPreviewFromData(currentFormAsData());
  document.getElementById("previewModal").style.display = "flex";
}
function closePreview() { const m = document.getElementById("previewModal"); if (m) m.style.display = "none"; }

function buildFullPageHTML(body) {
  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>ใบเดินทางจริง</title>
<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}html,body{width:100%;background:#fff;font-family:'Kanit',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
#print-wrap{width:190mm;margin:0 auto;padding:10mm 0}
.no-print{text-align:center;padding:12px;background:#f8fafc;border-bottom:1px solid #e2e8f0}
.no-print button{font-family:'Kanit',sans-serif;font-size:15px;font-weight:600;padding:12px 28px;margin:4px;border-radius:10px;cursor:pointer;border:none;color:#fff;min-width:150px}
.no-print p{font-size:12px;color:#64748b;margin-top:6px}
.b1{background:#1E40AF}.b2{background:#64748b}
@media print{@page{size:A4 portrait;margin:10mm}html,body{width:210mm}#print-wrap{padding:0}.no-print{display:none!important}}
.dt th,.ct .tr th{background:#e8f5f4!important;color:#1a5550!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
</style></head><body>
<div class="no-print"><button class="b1" onclick="window.print()">พิมพ์ / Save as PDF</button><button class="b2" onclick="window.close()">ปิด</button><p>เลือก "Save as PDF" ในหน้าพิมพ์ เพื่อเก็บเป็นไฟล์ PDF</p></div>
<div id="print-wrap">${body}</div>
</body></html>`;
}
function openPrintWindow(html) {
  const w = window.open("", "_blank");
  if (w) { w.document.open(); w.document.write(html); w.document.close(); return; }
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
function printPreview() { openPrintWindow(buildFullPageHTML(buildActualPreviewFromData(currentFormAsData()))); }
function exportPDF() { printPreview(); }
function printActualById(id) {
  const a = findActual(id); if (!a) { alert("ไม่พบข้อมูล กรุณารีเฟรช"); return; }
  openPrintWindow(buildFullPageHTML(buildActualPreviewFromData(a)));
}

// ---------- ดูใบที่ส่งแล้ว ----------
function openViewPopup(id) {
  const a = findActual(id); if (!a) { alert("ไม่พบข้อมูล กรุณารีเฟรช"); return; }
  let m = document.getElementById("viewPopupModal");
  if (!m) {
    m = document.createElement("div");
    m.id = "viewPopupModal"; m.className = "preview-modal";
    m.innerHTML = `<div class="preview-wrapper"><div class="preview-actions" id="viewPopupActions"></div><div id="viewPopupContent" class="a4-page"></div></div>`;
    m.addEventListener("click", (e) => { if (e.target === m) closeViewPopup(); });
    document.body.appendChild(m);
  }
  const sid = escHtml(a.id);
  document.getElementById("viewPopupContent").innerHTML = buildActualPreviewFromData(a);
  document.getElementById("viewPopupActions").innerHTML = `
    <span class="preview-title">ใบเดินทางจริง ${formatDateTH(a.start_date)} – ${formatDateTH(a.end_date)}</span>
    <button type="button" onclick="printActualById('${sid}')"><span class="material-symbols-outlined">print</span>พิมพ์ / PDF</button>
    <button type="button" onclick="closeViewPopup();editActual('${sid}')"><span class="material-symbols-outlined">edit</span>แก้ไข</button>
    <button type="button" class="pa-close" onclick="closeViewPopup()" aria-label="ปิด"><span class="material-symbols-outlined">close</span></button>`;
  m.style.display = "flex";
}
function closeViewPopup() { const m = document.getElementById("viewPopupModal"); if (m) m.style.display = "none"; }

// =====================================================
// 📤 CSV (คงไว้เผื่อใช้)
// =====================================================
function exportCSV() {
  const rows = collectRows();
  if (!rows.length) { alert("ยังไม่มีข้อมูล"); return; }
  const esc = (t) => { if (t == null) return ""; const s = String(t); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const e = collectExpense();
  let csv = "วันที่,เส้นทาง,หมายเหตุ\n" + rows.map((r) => [r.date, esc(r.route), esc(r.note)].join(",")).join("\n");
  csv += `\n\nสรุปค่าใช้จ่าย\nเบี้ยเลี้ยง,${e.allowance_rate}×${e.allowance_days}วัน,${e.allowance_rate * e.allowance_days}\nค่าที่พัก,${e.hotel_rate}×${e.hotel_nights}คืน,${e.hotel_rate * e.hotel_nights}\nอื่นๆ,-,${e.other_cost}\nรวม,,${expenseTotal(e)}\n`;
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a"); a.href = url; a.download = `Actual_${periodOf(rows).start || "nodate"}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

// =====================================================
// 🔄 CLEAR
// =====================================================
function resetForm() {
  currentDraftKey = null; currentActualId = null; currentActualStatus = null; refPlanId = null;
  document.getElementById("tableBody").innerHTML = "";
  setExpense(null);
  renderPlanOptions(); renderPlanInfo();
  _dirty = false;
  refreshRowState(); updateStatus(); showWarnBox({ errors: [], warnings: [] }); loadDraftListLocal(); markActiveCompleted();
}
function clearForm() {
  if ((_dirty || currentActualId || currentDraftKey) && !confirm("เริ่มใบใหม่? ข้อมูลที่ยังไม่บันทึกในฟอร์มจะหาย")) return;
  resetForm();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// =====================================================
// 🔔 NOTIFICATION / LOGOUT
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
async function logout() {
  try { await supabaseClient.auth.signOut(); } catch (e) { /* ignore */ }
  window.location.href = "/pages/auth/login.html";
}

// เตือนก่อนออกจากหน้าถ้ายังไม่ได้บันทึก
window.addEventListener("beforeunload", (e) => {
  if (_dirty) { e.preventDefault(); e.returnValue = ""; }
});
