// =====================================================
// formPlan.js
// ระบบแผนการเดินทางและเบิกจ่าย (Travel Plan & Expense System)
// เวอร์ชัน: 3.1 | ปรับปรุง: 2026-04-02
// Draft = localStorage | Completed = Supabase
// ค่าใช้จ่ายเก็บรวมใน JSONB field "trips" (ไม่ต้อง ALTER TABLE)
// =====================================================

"use strict";

let trips = [];
let currentDraftKey = null;
let currentPlanId = null;
let myShops = [];
const DRAFT_PREFIX = "formPlan_draft_";

// =====================================================
// 🚀 INITIALIZE
// =====================================================
document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 FormPlan v3.1 loaded");
  if (typeof supabaseClient === "undefined") {
    alert("❌ ระบบยังไม่พร้อม"); return;
  }
  const isAuth = await checkAuthorization();
  if (!isAuth) return;
  await initUserInfo();
  await loadMyShops();
  setDefaultDates();
  setupEventListeners();
  setupSummaryCalculation();
  loadLocalDraftList();
  await loadCompletedList();
});

// =====================================================
// 🔐 AUTH
// =====================================================
async function checkAuthorization() {
  try {
    if (typeof protectPage === "function") {
      await protectPage(["admin","sales","manager","user"]);
    } else {
      const { data:{session} } = await supabaseClient.auth.getSession();
      if (!session) { alert("❌ กรุณา Login ก่อน"); window.location.href="login.html"; return false; }
    }
    return true;
  } catch(e) { console.error("❌ Auth:",e); return false; }
}

// =====================================================
// 👤 USER INFO
// =====================================================
async function initUserInfo() {
  if (typeof initUserService === "function") {
    await initUserService();
    if (typeof autoFillUserData === "function") {
      autoFillUserData({ display_name:"empName", area:"area", readonly:["empName","area"] });
    }
  } else { await loadUserInfoBasic(); }
}

async function loadUserInfoBasic() {
  try {
    const { data:{session} } = await supabaseClient.auth.getSession();
    if (!session) return;
    const { data:profile } = await supabaseClient.from("profiles").select("display_name, area").eq("id",session.user.id).maybeSingle();
    const se = document.getElementById("sidebarEmail");
    if (se) se.textContent = session.user.email;
    const en = document.getElementById("empName");
    if (en) { en.value = profile?.display_name || session.user.email; en.readOnly = true; }
    const ai = document.getElementById("area");
    if (ai) { ai.value = profile?.area || ""; ai.readOnly = true; }
  } catch(e) { console.error("❌ loadUserInfoBasic:",e); }
}

// =====================================================
// 🏪 SHOPS
// =====================================================
function updateShopCount() {
  const el = document.getElementById("shopCount");
  if (el) el.textContent = myShops.length;
}

async function loadMyShops() {
  const { data:{session}, error:se } = await supabaseClient.auth.getSession();
  if (se || !session) return;
  const { data:profile, error:pe } = await supabaseClient.from("profiles").select("role, area").eq("id",session.user.id).maybeSingle();
  if (pe) return;
  let q = supabaseClient.from("shops").select("*").eq("status","Active");
  if (profile.role==="sales") q = q.eq("sale_id",session.user.id);
  else if (profile.role==="manager") q = q.eq("province",profile.area);
  const { data, error } = await q;
  if (error) return;
  myShops = data || [];
  updateShopCount();
}

// =====================================================
// 📅 DATES
// =====================================================
function setDefaultDates() {
  const today = new Date();
  const s = document.getElementById("startDate");
  if (s && !s.value) s.valueAsDate = today;
  const e = document.getElementById("endDate");
  if (e && !e.value) { const nw = new Date(today); nw.setDate(nw.getDate()+7); e.valueAsDate = nw; }
}

function setupEventListeners() {
  document.getElementById("startDate")?.addEventListener("change", updateEndDate);
}

function updateEndDate() {
  const sv = document.getElementById("startDate")?.value;
  const ei = document.getElementById("endDate");
  if (sv && ei) { const d = new Date(sv); d.setDate(d.getDate()+7); ei.valueAsDate = d; }
}

// =====================================================
// ➕ TABLE ROWS
// =====================================================
function addRow() {
  const tbody = document.getElementById("tripTableBody");
  const row = document.createElement("tr");
  row.innerHTML = `
    <td><input type="date" class="trip-date"></td>
    <td><select class="from-province">${generateProvinceOptions()}</select></td>
    <td><select class="to-province" onchange="handleProvinceChange(this)">${generateProvinceOptions()}</select></td>
    <td><select class="shop1"><option value="">ชื่อร้าน</option></select></td>
    <td><select class="shop2"><option value="">ชื่อร้าน</option></select></td>
    <td><select class="shop3"><option value="">ชื่อร้าน</option></select></td>
    <td><input type="text" class="note" placeholder="หมายเหตุ"></td>`;
  tbody.appendChild(row);
}

function removeRow() {
  const tbody = document.getElementById("tripTableBody");
  if (tbody.rows.length > 0) tbody.deleteRow(-1);
}

function generateProvinceOptions(sel="") {
  const provs = [...new Set(myShops.map(s=>s.province))].sort();
  let h = `<option value="">จังหวัด</option>`;
  provs.forEach(p => { h += `<option value="${p}" ${p===sel?"selected":""}>${p}</option>`; });
  return h;
}

function generateShopOptions(prov="", selId="", selName="") {
  let h = `<option value="">ชื่อร้าน</option>`;
  const shops = prov ? myShops.filter(s=>s.province===prov) : [];
  if (shops.length>0) { shops.forEach(s => { h += `<option value="${s.id}" ${s.id===selId?"selected":""}>${s.shop_name}</option>`; }); }
  else if (selId && selName) { h += `<option value="${selId}" selected>${selName}</option>`; }
  return h;
}

function handleProvinceChange(sel) {
  const prov = sel.value;
  const row = sel.closest("tr");
  const shops = myShops.filter(s=>s.province===prov);
  const opts = shops.map(s=>`<option value="${s.id}">${s.shop_name}</option>`).join("");
  ["shop1","shop2","shop3"].forEach(c => {
    row.querySelector(`.${c}`).innerHTML = `<option value="">ชื่อร้าน</option>` + opts;
  });
}

// =====================================================
// 📦 COLLECT DATA
// =====================================================
function collectTableData() {
  const rows = document.querySelectorAll("#tripTableBody tr");
  trips = [];
  rows.forEach(row => {
    trips.push({
      date: row.querySelector(".trip-date")?.value || "",
      from: row.querySelector(".from-province")?.value || "",
      to: row.querySelector(".to-province")?.value || "",
      shop1: row.querySelector(".shop1")?.selectedOptions?.[0]?.text || "",
      shop2: row.querySelector(".shop2")?.selectedOptions?.[0]?.text || "",
      shop3: row.querySelector(".shop3")?.selectedOptions?.[0]?.text || "",
      shop1Id: row.querySelector(".shop1")?.value || "",
      shop2Id: row.querySelector(".shop2")?.value || "",
      shop3Id: row.querySelector(".shop3")?.value || "",
      note: row.querySelector(".note")?.value || "",
    });
  });
  return trips;
}

function collectSummaryData() {
  return {
    allowance_rate: parseFloat(document.getElementById("allowanceRate")?.value)||0,
    allowance_days: parseFloat(document.getElementById("allowanceDays")?.value)||0,
    hotel_rate: parseFloat(document.getElementById("hotelRate")?.value)||0,
    hotel_nights: parseFloat(document.getElementById("hotelNights")?.value)||0,
    other_cost: parseFloat(document.getElementById("otherCost")?.value)||0,
  };
}

function buildTripsPayload() {
  collectTableData();
  return { rows: trips, expense: collectSummaryData() };
}

function restoreFromTripsPayload(payload) {
  let tripRows = [], expense = null;
  if (Array.isArray(payload)) { tripRows = payload; }
  else if (payload && typeof payload === "object") { tripRows = payload.rows||[]; expense = payload.expense||null; }
  const tbody = document.getElementById("tripTableBody");
  tbody.innerHTML = "";
  tripRows.forEach(t => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input type="date" class="trip-date" value="${t.date||""}"></td>
      <td><select class="from-province">${generateProvinceOptions(t.from)}</select></td>
      <td><select class="to-province" onchange="handleProvinceChange(this)">${generateProvinceOptions(t.to)}</select></td>
      <td><select class="shop1">${generateShopOptions(t.to,t.shop1Id,t.shop1)}</select></td>
      <td><select class="shop2">${generateShopOptions(t.to,t.shop2Id,t.shop2)}</select></td>
      <td><select class="shop3">${generateShopOptions(t.to,t.shop3Id,t.shop3)}</select></td>
      <td><input type="text" class="note" value="${t.note||""}" placeholder="หมายเหตุ"></td>`;
    tbody.appendChild(row);
  });
  trips = tripRows;
  if (expense) {
    if (expense.allowance_rate) document.getElementById("allowanceRate").value = expense.allowance_rate;
    if (expense.allowance_days) document.getElementById("allowanceDays").value = expense.allowance_days;
    if (expense.hotel_rate) document.getElementById("hotelRate").value = expense.hotel_rate;
    if (expense.hotel_nights) document.getElementById("hotelNights").value = expense.hotel_nights;
    if (expense.other_cost) document.getElementById("otherCost").value = expense.other_cost;
    calculateSummary();
  }
}

// =====================================================
// 💾 LOCAL DRAFT (localStorage)
// =====================================================
function generateDraftKey() { return DRAFT_PREFIX + Date.now() + "_" + Math.random().toString(36).slice(2,8); }

function getAllLocalDrafts() {
  const drafts = [];
  for (let i=0; i<localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith(DRAFT_PREFIX)) {
      try { const d = JSON.parse(localStorage.getItem(key)); d._key = key; drafts.push(d); } catch(e) {}
    }
  }
  drafts.sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at));
  return drafts;
}

function saveDraftToLocal() {
  collectTableData();
  const summary = collectSummaryData();
  const draftData = {
    user_name: document.getElementById("empName")?.value||"",
    area: document.getElementById("area")?.value||"",
    start_date: document.getElementById("startDate")?.value||"",
    end_date: document.getElementById("endDate")?.value||"",
    trips: trips,
    expense: summary,
    created_at: currentDraftKey ? (JSON.parse(localStorage.getItem(currentDraftKey))?.created_at || new Date().toISOString()) : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (!currentDraftKey) currentDraftKey = generateDraftKey();
  localStorage.setItem(currentDraftKey, JSON.stringify(draftData));
  showNotification("💾 บันทึก Draft เรียบร้อย (เก็บในเครื่อง)", "success");
  loadLocalDraftList();
}

function loadLocalDraftById(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) { alert("ไม่พบ Draft นี้"); return; }
    const data = JSON.parse(raw);
    currentDraftKey = key; currentPlanId = null;
    if (data.start_date) document.getElementById("startDate").value = data.start_date;
    if (data.end_date) document.getElementById("endDate").value = data.end_date;
    const ai = document.getElementById("area");
    if (ai && data.area) ai.value = data.area;
    const tbody = document.getElementById("tripTableBody"); tbody.innerHTML = "";
    if (Array.isArray(data.trips) && data.trips.length>0) {
      data.trips.forEach(t => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td><input type="date" class="trip-date" value="${t.date||""}"></td>
          <td><select class="from-province">${generateProvinceOptions(t.from)}</select></td>
          <td><select class="to-province" onchange="handleProvinceChange(this)">${generateProvinceOptions(t.to)}</select></td>
          <td><select class="shop1">${generateShopOptions(t.to,t.shop1Id,t.shop1)}</select></td>
          <td><select class="shop2">${generateShopOptions(t.to,t.shop2Id,t.shop2)}</select></td>
          <td><select class="shop3">${generateShopOptions(t.to,t.shop3Id,t.shop3)}</select></td>
          <td><input type="text" class="note" value="${t.note||""}" placeholder="หมายเหตุ"></td>`;
        tbody.appendChild(row);
      });
      trips = data.trips;
    }
    if (data.expense) {
      if (data.expense.allowance_rate) document.getElementById("allowanceRate").value = data.expense.allowance_rate;
      if (data.expense.allowance_days) document.getElementById("allowanceDays").value = data.expense.allowance_days;
      if (data.expense.hotel_rate) document.getElementById("hotelRate").value = data.expense.hotel_rate;
      if (data.expense.hotel_nights) document.getElementById("hotelNights").value = data.expense.hotel_nights;
      if (data.expense.other_cost) document.getElementById("otherCost").value = data.expense.other_cost;
      calculateSummary();
    }
    highlightDraftCard(key);
    document.querySelector(".section")?.scrollIntoView({behavior:"smooth"});
    showNotification("✅ โหลด Draft เรียบร้อย","success");
  } catch(err) { alert("❌ โหลดไม่สำเร็จ: "+err.message); }
}

function deleteLocalDraft(key) {
  if (!confirm("ต้องการลบ Draft นี้?")) return;
  localStorage.removeItem(key);
  if (currentDraftKey===key) currentDraftKey=null;
  loadLocalDraftList();
}

// =====================================================
// 📋 LOCAL DRAFT LIST UI
// =====================================================
function loadLocalDraftList() {
  const container = document.getElementById("localDraftList");
  const badge = document.getElementById("localDraftCountBadge");
  if (!container) return;
  const drafts = getAllLocalDrafts();
  if (badge) badge.textContent = `${drafts.length} รายการ`;
  if (drafts.length===0) {
    container.innerHTML = `<div style="text-align:center;padding:32px;color:#aaa;font-size:13px;border:1px dashed #ddd;border-radius:12px;">ยังไม่มี Draft ในเครื่อง</div>`;
    return;
  }
  container.innerHTML = drafts.map(plan => {
    const key = plan._key;
    const rowCount = Array.isArray(plan.trips)?plan.trips.length:0;
    const startFmt = formatDateTH(plan.start_date);
    const endFmt = formatDateTH(plan.end_date);
    const updFmt = formatDateTimeTH(plan.updated_at);
    const exp = plan.expense||{};
    const total = ((exp.allowance_rate||0)*(exp.allowance_days||0))+((exp.hotel_rate||0)*(exp.hotel_nights||0))+(exp.other_cost||0);
    const totalFmt = total>0 ? total.toLocaleString("th-TH")+" บาท" : "";
    return `
      <div id="ldraft-${key}" class="draft-card" style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin-bottom:8px;display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;cursor:pointer;transition:border-color 0.15s,background 0.15s;"
        onclick="highlightDraftCard('${key}')"
        onmouseenter="this.style.borderColor='#EF9F27';this.style.background='#fffdf7';"
        onmouseleave="if(!this.classList.contains('selected')){this.style.borderColor='#e2e8f0';this.style.background='#fff';}">
        <div>
          <div style="font-weight:700;font-size:14px;color:#1e293b;margin-bottom:3px;">${plan.user_name||"ไม่ระบุชื่อ"} — ${plan.area||"ไม่ระบุเขต"}</div>
          <div style="font-size:12px;color:#64748b;margin-bottom:6px;display:flex;gap:12px;flex-wrap:wrap;">
            <span>📅 ${startFmt} – ${endFmt}</span><span>·</span><span>${rowCount} แถว</span>
            ${totalFmt?`<span>·</span><span>💰 ${totalFmt}</span>`:""}<span>·</span><span>อัปเดต: ${updFmt}</span>
          </div>
          <span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:2px 8px;border-radius:999px;background:#FAEEDA;color:#633806;border:1px solid #EF9F27;">
            <span style="width:6px;height:6px;border-radius:50%;background:#EF9F27;display:inline-block;"></span>Draft (Local)</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
          <button type="button" onclick="event.stopPropagation();loadLocalDraftById('${key}')" style="background:#FAEEDA;color:#633806;border:1px solid #EF9F27;border-radius:8px;padding:7px 14px;font-size:13px;cursor:pointer;font-weight:600;white-space:nowrap;font-family:inherit;">✏️ โหลดแก้ไข</button>
          <button type="button" onclick="event.stopPropagation();deleteLocalDraft('${key}')" style="background:none;border:1px solid #fca5a5;border-radius:8px;padding:7px 10px;font-size:13px;cursor:pointer;color:#dc2626;font-family:inherit;" title="ลบ">🗑</button>
        </div>
      </div>`;
  }).join("");
}

function highlightDraftCard(key) {
  document.querySelectorAll('[id^="ldraft-"],[id^="cdraft-"]').forEach(el => {
    el.style.borderColor="#e2e8f0"; el.style.background="#fff"; el.style.borderWidth="1px"; el.classList.remove("selected");
  });
  const card = document.getElementById(`ldraft-${key}`);
  if (card) { card.style.borderColor="#EF9F27"; card.style.borderWidth="1.5px"; card.style.background="#fffdf7"; card.classList.add("selected"); }
}

// =====================================================
// 💾 SAVE COMPLETED → SUPABASE
// =====================================================
async function saveCompletedToDatabase() {
  try {
    const { userId, userName, userZone } = await getCurrentUserInfo();
    if (!userId) return;
    const tripsPayload = buildTripsPayload();
    if (!tripsPayload.rows || tripsPayload.rows.length===0) { alert("❌ กรุณาเพิ่มข้อมูลแผนการเดินทางก่อน"); return; }
    if (!confirm("ยืนยันบันทึกแผนการเดินทางนี้?\n(ข้อมูลจะถูกส่งเข้าระบบ)")) return;

    const planData = {
      user_id: userId, user_name: userName,
      start_date: document.getElementById("startDate")?.value,
      end_date: document.getElementById("endDate")?.value,
      area: document.getElementById("area")?.value || userZone,
      trips: tripsPayload,
      status: "completed",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseClient.from("trips").insert([planData]).select();
    if (error) throw error;
    if (data?.length>0) currentPlanId = data[0].id;

    if (currentDraftKey) { localStorage.removeItem(currentDraftKey); currentDraftKey=null; loadLocalDraftList(); }
    showNotification("✅ บันทึกแผนสำเร็จ! (ข้อมูลเข้าระบบแล้ว)","success");
    await loadCompletedList();
    closePreview();
  } catch(error) { alert("❌ บันทึกไม่สำเร็จ: "+error.message); }
}

// =====================================================
// 📋 COMPLETED LIST (Supabase)
// =====================================================
async function loadCompletedList() {
  const container = document.getElementById("completedList");
  const badge = document.getElementById("completedCountBadge");
  if (!container) return;
  container.innerHTML = `<p style="text-align:center;color:#aaa;padding:20px 0;font-size:13px;">กำลังโหลด...</p>`;
  try {
    const userId = await getCurrentUserId();
    if (!userId) return;
    const { data, error } = await supabaseClient.from("trips")
      .select("id,user_name,area,start_date,end_date,status,trips,created_at,updated_at")
      .eq("user_id",userId).order("updated_at",{ascending:false});
    if (error) throw error;
    if (!data||data.length===0) {
      if (badge) badge.textContent="0 รายการ";
      container.innerHTML=`<div style="text-align:center;padding:32px;color:#aaa;font-size:13px;border:1px dashed #ddd;border-radius:12px;">ยังไม่มีแผนที่บันทึกในระบบ</div>`;
      return;
    }
    if (badge) badge.textContent=`${data.length} รายการ`;
    container.innerHTML = data.map(plan => {
      let rowCount=0, totalFmt="";
      if (Array.isArray(plan.trips)) { rowCount=plan.trips.length; }
      else if (plan.trips && typeof plan.trips==="object") {
        rowCount = Array.isArray(plan.trips.rows)?plan.trips.rows.length:0;
        const exp=plan.trips.expense||{};
        const total=((exp.allowance_rate||0)*(exp.allowance_days||0))+((exp.hotel_rate||0)*(exp.hotel_nights||0))+(exp.other_cost||0);
        if (total>0) totalFmt=total.toLocaleString("th-TH")+" บาท";
      }
      const startFmt=formatDateTH(plan.start_date), endFmt=formatDateTH(plan.end_date), updFmt=formatDateTimeTH(plan.updated_at);
      const statusBadge = plan.status==="completed"
        ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:2px 8px;border-radius:999px;background:#E1F5EE;color:#085041;border:1px solid #1D9E75;"><span style="width:6px;height:6px;border-radius:50%;background:#1D9E75;display:inline-block;"></span>Completed</span>`
        : `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:2px 8px;border-radius:999px;background:#FAEEDA;color:#633806;border:1px solid #EF9F27;"><span style="width:6px;height:6px;border-radius:50%;background:#EF9F27;display:inline-block;"></span>${plan.status}</span>`;
      return `
        <div id="cdraft-${plan.id}" style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin-bottom:8px;display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;cursor:pointer;transition:border-color 0.15s,background 0.15s;"
          onmouseenter="this.style.borderColor='#1D9E75';this.style.background='#f4fcfa';"
          onmouseleave="this.style.borderColor='#e2e8f0';this.style.background='#fff';">
          <div>
            <div style="font-weight:700;font-size:14px;color:#1e293b;margin-bottom:3px;">${plan.user_name||"ไม่ระบุชื่อ"} — ${plan.area||"ไม่ระบุเขต"}</div>
            <div style="font-size:12px;color:#64748b;margin-bottom:6px;display:flex;gap:12px;flex-wrap:wrap;">
              <span>📅 ${startFmt} – ${endFmt}</span><span>·</span><span>${rowCount} แถว</span>
              ${totalFmt?`<span>·</span><span>💰 ${totalFmt}</span>`:""}<span>·</span><span>อัปเดต: ${updFmt}</span>
            </div>
            <div>${statusBadge}</div>
          </div>
          <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
            <button type="button" onclick="event.stopPropagation();loadCompletedById('${plan.id}')" style="background:#e8f5f4;color:#0f6e56;border:1px solid #5DCAA5;border-radius:8px;padding:7px 14px;font-size:13px;cursor:pointer;font-weight:600;white-space:nowrap;font-family:inherit;">👁 ดูข้อมูล</button>
            <button type="button" onclick="event.stopPropagation();deleteCompletedById('${plan.id}')" style="background:none;border:1px solid #fca5a5;border-radius:8px;padding:7px 10px;font-size:13px;cursor:pointer;color:#dc2626;font-family:inherit;" title="ลบ">🗑</button>
          </div>
        </div>`;
    }).join("");
  } catch(err) { container.innerHTML=`<p style="color:red;text-align:center;">โหลดไม่สำเร็จ: ${err.message}</p>`; }
}

async function loadCompletedById(id) {
  try {
    const { data, error } = await supabaseClient.from("trips").select("*").eq("id",id).maybeSingle();
    if (error) throw error;
    if (!data) { alert("ไม่พบข้อมูล"); return; }
    currentPlanId=data.id; currentDraftKey=null;
    if (data.start_date) document.getElementById("startDate").value=data.start_date;
    if (data.end_date) document.getElementById("endDate").value=data.end_date;
    const ai=document.getElementById("area");
    if (ai && data.area) ai.value=data.area;
    restoreFromTripsPayload(data.trips);
    document.querySelector(".section")?.scrollIntoView({behavior:"smooth"});
    showNotification("✅ โหลดข้อมูลเรียบร้อย","success");
  } catch(err) { alert("❌ โหลดไม่สำเร็จ: "+err.message); }
}

async function deleteCompletedById(id) {
  if (!confirm("ต้องการลบแผนนี้จากระบบ?")) return;
  try {
    const { error } = await supabaseClient.from("trips").delete().eq("id",id);
    if (error) throw error;
    if (currentPlanId===id) currentPlanId=null;
    showNotification("✅ ลบเรียบร้อย","success");
    await loadCompletedList();
  } catch(err) { alert("❌ ลบไม่สำเร็จ: "+err.message); }
}

// =====================================================
// 📊 SUMMARY CALCULATION
// =====================================================
function calculateSummary() {
  const ar=parseFloat(document.getElementById("allowanceRate")?.value)||0;
  const ad=parseFloat(document.getElementById("allowanceDays")?.value)||0;
  const hr=parseFloat(document.getElementById("hotelRate")?.value)||0;
  const hn=parseFloat(document.getElementById("hotelNights")?.value)||0;
  const oc=parseFloat(document.getElementById("otherCost")?.value)||0;
  document.getElementById("grandTotal").value = ((ar*ad)+(hr*hn)+oc).toLocaleString("th-TH");
}

function setupSummaryCalculation() {
  ["allowanceRate","allowanceDays","hotelRate","hotelNights","otherCost"].forEach(id => {
    document.getElementById(id)?.addEventListener("input",calculateSummary);
  });
}

// =====================================================
// 🔍 PREVIEW
// =====================================================
function buildPreviewHTML() {
  collectTableData();
  function fmtDate(d) { if(!d) return"-"; const[y,m,day]=d.split("-"); return`${day}/${m}/${y}`; }
  let tableRows = "";
  trips.forEach((t,i) => {
    const bg = i%2===0?"":"style=\"background:#f7f9fb\"";
    tableRows += `<tr ${bg}><td style="white-space:nowrap">${fmtDate(t.date)}</td><td>${t.from||"-"}</td><td>${t.to||"-"}</td><td>${t.shop1||"-"}</td><td>${t.shop2||"-"}</td><td>${t.shop3||"-"}</td><td style="text-align:left;padding-left:6px">${t.note||""}</td></tr>`;
  });
  if (!tableRows) tableRows=`<tr><td colspan="7" style="text-align:center;color:#999;padding:14px">ไม่มีข้อมูล</td></tr>`;
  const ar=parseFloat(document.getElementById("allowanceRate")?.value)||0;
  const ad=parseFloat(document.getElementById("allowanceDays")?.value)||0;
  const hr=parseFloat(document.getElementById("hotelRate")?.value)||0;
  const hn=parseFloat(document.getElementById("hotelNights")?.value)||0;
  const oc=parseFloat(document.getElementById("otherCost")?.value)||0;
  const ta=ar*ad, th=hr*hn, gt=ta+th+oc;
  const fmt=n=>n.toLocaleString("th-TH",{minimumFractionDigits:2});
  const empName=document.getElementById("empName")?.value||"-";
  const area=document.getElementById("area")?.value||"-";
  const start=fmtDate(document.getElementById("startDate")?.value);
  const end=fmtDate(document.getElementById("endDate")?.value);
  const printDate=new Date().toLocaleDateString("th-TH",{year:"numeric",month:"long",day:"numeric"});

  return `
  <style>
    .doc-wrap{font-family:'Kanit',sans-serif;font-size:13px;color:#1a1a1a}
    .doc-company{text-align:center;margin-bottom:4px}
    .doc-company .company-name{font-size:16px;font-weight:700;letter-spacing:.3px}
    .doc-company .doc-title{font-size:14px;font-weight:600;margin-top:2px}
    .doc-divider{border:none;border-top:2px solid #1a1a1a;margin:8px 0 12px}
    .doc-meta{display:grid;grid-template-columns:1fr 1fr;border:1px solid #bbb;border-radius:4px;margin-bottom:14px;overflow:hidden}
    .doc-meta-cell{padding:7px 12px;font-size:12.5px;line-height:1.8}
    .doc-meta-cell:first-child{border-right:1px solid #bbb}
    .doc-meta-label{font-weight:700;color:#444;margin-right:4px}
    .doc-trip-table{width:100%;border-collapse:collapse;margin-bottom:18px;font-size:12px}
    .doc-trip-table th{background:#e8f5f4;color:#1a5550;padding:8px 7px;text-align:center;font-weight:700;font-size:12px;border:1px solid #b2d8d5}
    .doc-trip-table td{padding:5px 6px;text-align:center;border:1px solid #ccc;font-size:11px;max-width:100px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .doc-summary-title{font-size:13px;font-weight:700;margin-bottom:6px;padding-bottom:4px;border-bottom:1.5px solid #b2d8d5;display:flex;align-items:center;gap:6px}
    .doc-summary-title::before{content:'';display:inline-block;width:3px;height:14px;background:#7ec8c3;border-radius:2px}
    .doc-cost-table{width:55%;margin-left:auto;margin-bottom:20px;border-collapse:collapse;font-size:12.5px}
    .doc-cost-table td,.doc-cost-table th{border:1px solid #ccc;padding:6px 10px}
    .doc-cost-table td:first-child{font-weight:600;color:#333}
    .doc-cost-table td:nth-child(2){text-align:center;color:#555}
    .doc-cost-table td:last-child{text-align:right;font-variant-numeric:tabular-nums}
    .doc-cost-table .total-row th{background:#e8f5f4;color:#1a5550;text-align:right;padding:7px 10px;font-size:13px;border:1px solid #b2d8d5;font-weight:700}
    .doc-sign{margin-top:40px;display:grid;grid-template-columns:repeat(4,1fr);gap:24px;text-align:center}
    .doc-sign-box{font-size:12px;line-height:1.8}
    .doc-sign-line{border-top:1px solid #555;padding-top:20px;margin-top:60px}
    .doc-sign-name{font-weight:600;margin-bottom:2px}
    .doc-sign-role{color:#555;margin-top:2px}
    .doc-print-date{text-align:right;font-size:11px;color:#777;margin-bottom:10px}
  </style>
  <div class="doc-wrap">
    <div class="doc-print-date">วันที่พิมพ์: ${printDate}</div>
    <div class="doc-company"><div class="company-name">บริษัท เอิร์นนี่ แอดวานซ์ จำกัด</div><div class="doc-title">แผนการเดินทางและเบิกทดลองจ่าย ๑</div></div>
    <hr class="doc-divider">
    <div class="doc-meta"><div class="doc-meta-cell"><div><span class="doc-meta-label">พนักงานขาย :</span>${empName}</div><div><span class="doc-meta-label">เขตการขาย :</span>${area}</div></div><div class="doc-meta-cell"><div><span class="doc-meta-label">ระหว่างวันที่ :</span>${start}</div><div><span class="doc-meta-label">ถึงวันที่ :</span>${end}</div></div></div>
    <table class="doc-trip-table"><thead><tr><th style="width:90px">ว/ด/ป</th><th>จากจังหวัด</th><th>ไปจังหวัด</th><th>ร้านค้า 1</th><th>ร้านค้า 2</th><th>ร้านค้า 3</th><th style="width:80px">หมายเหตุ</th></tr></thead><tbody>${tableRows}</tbody></table>
    <div class="doc-summary-title">สรุปค่าใช้จ่าย</div>
    <table class="doc-cost-table">
      <tr><td>เบี้ยเลี้ยง</td><td>${fmt(ar)} × ${ad} วัน</td><td>${fmt(ta)} บาท</td></tr>
      <tr><td>ค่าที่พัก</td><td>${fmt(hr)} × ${hn} คืน</td><td>${fmt(th)} บาท</td></tr>
      <tr><td>ค่าใช้จ่ายอื่นๆ</td><td style="text-align:center">–</td><td>${fmt(oc)} บาท</td></tr>
      <tr class="total-row"><th colspan="2">รวมเบิกทั้งหมด</th><th style="font-size:14px">${fmt(gt)} บาท</th></tr>
    </table>
    <div class="doc-sign">
      <div class="doc-sign-box"><div class="doc-sign-line"><div class="doc-sign-name">(${empName})</div><div class="doc-sign-role">พนักงานขาย</div></div></div>
      <div class="doc-sign-box"><div class="doc-sign-line"><div class="doc-sign-name">(...................................................................)</div><div class="doc-sign-role">ผู้จัดการฝ่ายขาย</div></div></div>
      <div class="doc-sign-box"><div class="doc-sign-line"><div class="doc-sign-name">(...................................................................)</div><div class="doc-sign-role">ฝ่ายบัญชี</div></div></div>
      <div class="doc-sign-box"><div class="doc-sign-line"><div class="doc-sign-name">(...................................................................)</div><div class="doc-sign-role">ผู้อนุมัติ</div></div></div>
    </div>
  </div>`;
}

function openPreview() {
  document.getElementById("previewContent").innerHTML = buildPreviewHTML();
  document.getElementById("previewModal").style.display = "flex";
}

function closePreview() { document.getElementById("previewModal").style.display="none"; }

// =====================================================
// 🖨️ PRINT / EXPORT — ✅ TABLET + MOBILE COMPATIBLE
// =====================================================
function buildFullPageHTML(bodyContent) {
  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>แผนการเดินทาง</title>
<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;background:#fff;font-family:'Kanit',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
#print-wrap{width:100%;padding:8mm;max-width:210mm;margin:0 auto}
.no-print{margin:16px auto;text-align:center;padding:12px}
.no-print button{font-family:'Kanit',sans-serif;font-size:16px;font-weight:600;padding:14px 32px;margin:6px;border-radius:12px;cursor:pointer;border:none;color:#fff;min-width:160px;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.btn-print{background:#1D9E75}
.btn-close{background:#64748b}
@media print{
  @page{size:A4 portrait;margin:8mm}
  html,body{width:210mm}
  #print-wrap{padding:0;max-width:none}
  .no-print{display:none!important}
}
.doc-trip-table td{max-width:90px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.doc-trip-table th{background:#e8f5f4!important;color:#1a5550!important;border:1px solid #b2d8d5!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.doc-cost-table .total-row th{background:#e8f5f4!important;color:#1a5550!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
</style></head><body>
<div class="no-print">
  <button class="btn-print" onclick="window.print()">🖨 พิมพ์ / Save PDF</button>
  <button class="btn-close" onclick="window.close()">✖ ปิดหน้านี้</button>
</div>
<div id="print-wrap">${bodyContent}</div>
</body></html>`;
}

function printPreview() {
  const content = document.getElementById("previewContent")?.innerHTML;
  if (!content||content.trim()==="") {
    document.getElementById("previewContent").innerHTML = buildPreviewHTML();
  }
  const previewHTML = document.getElementById("previewContent").innerHTML;
  const fullHTML = buildFullPageHTML(previewHTML);

  // ✅ เปิด Tab ใหม่ — ทำงานบน Tablet/Mobile ดีที่สุด
  const w = window.open("","_blank");
  if (w) { w.document.open(); w.document.write(fullHTML); w.document.close(); }
  else {
    // Fallback: Blob URL
    const blob = new Blob([fullHTML],{type:"text/html;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    window.open(url,"_blank");
    setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
}

function exportPDF() { printPreview(); }

// =====================================================
// 📤 EXPORT CSV
// =====================================================
function exportTrips() {
  collectTableData();
  if (!trips||trips.length===0) { alert("❌ ไม่มีข้อมูลทริปให้ Export"); return; }
  try {
    const empName=document.getElementById("empName")?.value||"User";
    const area=document.getElementById("area")?.value||"";
    const start=document.getElementById("startDate")?.value||"";
    const headers=["ลำดับ","วันที่","เดินทางจาก","ไปจังหวัด","ร้านค้า 1","ร้านค้า 2","ร้านค้า 3","หมายเหตุ"];
    const rows=trips.map((t,i)=>[i+1,t.date||"",escapeCsv(t.from),escapeCsv(t.to),escapeCsv(t.shop1),escapeCsv(t.shop2),escapeCsv(t.shop3),escapeCsv(t.note)]);
    const csv=[headers.map(h=>escapeCsv(h)).join(","),...rows.map(r=>r.join(","))].join("\n");
    const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob);
    const link=document.createElement("a"); link.href=url; link.download=`Trip_Plan_${empName}_${area}_${start||"nodate"}.csv`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
    showNotification("✅ Export สำเร็จ","success");
  } catch(e) { alert("❌ Export ไม่สำเร็จ: "+e.message); }
}

// =====================================================
// 🔄 CLEAR FORM
// =====================================================
function clearForm() {
  if (!confirm("ล้างข้อมูลทั้งหมดเพื่อสร้างแผนใหม่?")) return;
  currentDraftKey=null; currentPlanId=null; trips=[];
  document.getElementById("tripTableBody").innerHTML="";
  ["allowanceRate","allowanceDays","hotelRate","hotelNights","otherCost"].forEach(id=>{const el=document.getElementById(id);if(el)el.value="";});
  document.getElementById("grandTotal").value="";
  setDefaultDates();
  document.querySelectorAll('[id^="ldraft-"],[id^="cdraft-"]').forEach(el=>{el.style.borderColor="#e2e8f0";el.style.background="#fff";el.style.borderWidth="1px";el.classList.remove("selected");});
  window.scrollTo({top:0,behavior:"smooth"});
}

// =====================================================
// 🔔 NOTIFICATION
// =====================================================
function showNotification(message, type="info") {
  const old=document.getElementById("topNotification"); if(old) old.remove();
  const colors={success:{bg:"#E1F5EE",border:"#1D9E75",text:"#085041"},error:{bg:"#FEE2E2",border:"#EF4444",text:"#991B1B"},info:{bg:"#EFF6FF",border:"#3B82F6",text:"#1E40AF"}};
  const c=colors[type]||colors.info;
  const div=document.createElement("div"); div.id="topNotification";
  div.style.cssText=`position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:99999;padding:12px 28px;border-radius:12px;background:${c.bg};border:1.5px solid ${c.border};color:${c.text};font-size:14px;font-weight:600;font-family:'Kanit',sans-serif;box-shadow:0 4px 20px rgba(0,0,0,.12);animation:notifSlide .3s ease;max-width:90vw;text-align:center;`;
  div.textContent=message;
  if(!document.getElementById("notifStyle")){const s=document.createElement("style");s.id="notifStyle";s.textContent="@keyframes notifSlide{from{opacity:0;transform:translateX(-50%) translateY(-20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}";document.head.appendChild(s);}
  document.body.appendChild(div);
  setTimeout(()=>{div.style.transition="opacity .3s";div.style.opacity="0";setTimeout(()=>div.remove(),300);},2500);
}

// =====================================================
// 🛠️ UTILITY
// =====================================================
async function getCurrentUserId() {
  if (typeof getUserData==="function") return getUserData("id");
  const{data:{user}}=await supabaseClient.auth.getUser(); return user?.id||null;
}

async function getCurrentUserInfo() {
  if (typeof getUserData==="function") return{userId:getUserData("id"),userName:getUserData("display_name"),userZone:getUserData("area")};
  const{data:{user}}=await supabaseClient.auth.getUser();
  const{data:profile}=await supabaseClient.from("profiles").select("display_name,area").eq("id",user.id).maybeSingle();
  return{userId:user.id,userName:profile?.display_name||user.email,userZone:profile?.area||null};
}

function escapeCsv(text) {
  if(text===null||text===undefined)return""; const str=String(text);
  if(str.includes(",")||str.includes('"')||str.includes("\n")||str.includes("\r")) return'"'+str.replace(/"/g,'""')+'"';
  return str;
}

function formatDateTH(ds) { if(!ds)return"-"; const[y,m,d]=ds.split("-"); return`${d}/${m}/${y}`; }
function formatDateTimeTH(iso) { if(!iso)return"-"; return new Date(iso).toLocaleString("th-TH",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}); }

// =====================================================
// 🚪 LOGOUT
// =====================================================
async function logout() {
  try { await supabaseClient.auth.signOut(); setTimeout(()=>{window.location.href="/pages/auth/login.html";},500); }
  catch(err) { alert("ออกจากระบบไม่สำเร็จ: "+err.message); }
}

console.log("✅ formPlan.js v3.1 loaded");