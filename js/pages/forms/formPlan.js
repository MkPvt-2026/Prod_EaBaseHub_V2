// =====================================================
// formPlan.js
// ระบบแผนการเดินทางและเบิกจ่าย (Travel Plan & Expense System)
// เวอร์ชัน: 2.2 | ปรับปรุง: 2026
// =====================================================

"use strict";

// =====================================================
// 🌐 GLOBAL STATE
// =====================================================

// ✅ แก้: เดิม trips ถูก comment ออกจนไม่ได้ declare → ทำให้ saveTableData / exportTrips พัง
/** @type {Array<Object>} รายการทริปทั้งหมดในแผนปัจจุบัน */
let trips = [];

/** @type {string|null} ID ของแผนการเดินทางในฐานข้อมูล */
let currentPlanId = null;

/** @type {Array<Object>} รายการร้านค้าทั้งหมดที่ User มีสิทธิ์ดู */
let myShops = [];

// =====================================================
// 🚀 INITIALIZE PAGE
// =====================================================

document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 FormPlan page loaded");

  if (typeof supabaseClient === "undefined") {
    console.error("❌ Supabase client not found!");
    alert("❌ ระบบยังไม่พร้อม กรุณาตรวจสอบการเชื่อมต่อ");
    return;
  }

  const isAuthorized = await checkAuthorization();
  if (!isAuthorized) return;

  await initUserInfo();
  await initializePageData();
  await loadMyShops();

  setDefaultDates();
  setupEventListeners();
  setupSummaryCalculation();
});

// =====================================================
// 🔐 AUTHORIZATION
// =====================================================

async function checkAuthorization() {
  try {
    if (typeof protectPage === "function") {
      await protectPage(["admin", "sales", "manager", "user"]);
    } else {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) {
        alert("❌ กรุณา Login ก่อนใช้งาน");
        window.location.href = "login.html";
        return false;
      }
    }
    console.log("✅ Auth check passed");
    return true;
  } catch (error) {
    console.error("❌ Auth error:", error);
    return false;
  }
}

// =====================================================
// 👤 USER INFO
// =====================================================

async function initUserInfo() {
  if (typeof initUserService === "function") {
    await initUserService();
    if (typeof autoFillUserData === "function") {
      autoFillUserData({
        display_name: "empName",
        // ✅ แก้: เดิมส่ง area: "zone" แต่ element จริงคือ id="area"
        area: "area",
        readonly: ["empName", "area"],
      });
    }
  } else {
    await loadUserInfoBasic();
  }
}

async function loadUserInfoBasic() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return;

    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("display_name, area")
      .eq("id", session.user.id)
      .maybeSingle();

    // แสดงอีเมลใน sidebar
    const sidebarEmail = document.getElementById("sidebarEmail");
    if (sidebarEmail) sidebarEmail.textContent = session.user.email;

    const empNameInput = document.getElementById("empName");
    if (empNameInput) {
      empNameInput.value    = profile?.display_name || session.user.email;
      empNameInput.readOnly = true;
    }

    // ✅ แก้: เดิมอ้าง id="zone" แต่ใน HTML ใช้ id="area"
    const areaInput = document.getElementById("area");
    if (areaInput) {
      areaInput.value    = profile?.area || "";
      areaInput.readOnly = true;
    }

    console.log("✅ User info loaded");
  } catch (error) {
    console.error("❌ loadUserInfoBasic error:", error);
  }
}

// =====================================================
// 🏪 SHOP MANAGEMENT
// =====================================================

function updateShopCount() {
  const shopCountEl = document.getElementById("shopCount");
  if (shopCountEl) shopCountEl.textContent = myShops.length;
}

async function loadMyShops() {
  console.log("🔍 loadMyShops: เริ่มต้น...");

  const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
  if (sessionError || !session) {
    console.warn("⚠️ loadMyShops: ไม่มี session");
    return;
  }

  const { data: profile, error: profileError } = await supabaseClient
    .from("profiles")
    .select("role, area")
    .eq("id", session.user.id)
    .maybeSingle();

  if (profileError) {
    console.error("❌ loadMyShops: โหลด profile ไม่สำเร็จ", profileError);
    return;
  }

  let query = supabaseClient.from("shops").select("*").eq("status", "Active");

  if (profile.role === "sales") {
    query = query.eq("sale_id", session.user.id);
  } else if (profile.role === "manager") {
    query = query.eq("province", profile.area);
  }

  const { data, error } = await query;
  if (error) {
    console.error("❌ loadMyShops: query shops error", error);
    return;
  }

  myShops = data || [];
  updateShopCount();
  console.log(`✅ Loaded ${myShops.length} shops`);
}

// =====================================================
// 📦 PAGE DATA INITIALIZATION
// =====================================================

async function initializePageData() {
  try {
    await loadExistingTrips();
    await loadDraftList();
    console.log("✅ All page data loaded");
  } catch (error) {
    console.error("❌ initializePageData error:", error);
  }
}

function setDefaultDates() {
  const today = new Date();

  const startDateInput = document.getElementById("startDate");
  if (startDateInput) startDateInput.valueAsDate = today;

  const endDateInput = document.getElementById("endDate");
  if (endDateInput) {
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    endDateInput.valueAsDate = nextWeek;
  }
}

// =====================================================
// 🎯 EVENT LISTENERS
// =====================================================

function setupEventListeners() {
  document.getElementById("startDate")?.addEventListener("change", updateEndDate);
}

function updateEndDate() {
  const startDateValue = document.getElementById("startDate")?.value;
  const endDateInput   = document.getElementById("endDate");
  if (startDateValue && endDateInput) {
    const start = new Date(startDateValue);
    start.setDate(start.getDate() + 7);
    endDateInput.valueAsDate = start;
  }
}

// =====================================================
// 📥 LOAD EXISTING TRIPS
// =====================================================

async function loadExistingTrips() {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return;

    const { data, error } = await supabaseClient
      .from("trips")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) throw error;
    if (!data || data.length === 0) {
      console.log("ℹ️ No draft plan found");
      return;
    }

    const plan = data[0];
    currentPlanId = plan.id;

    // โหลดวันที่
    if (plan.start_date) document.getElementById("startDate").value = plan.start_date;
    if (plan.end_date)   document.getElementById("endDate").value   = plan.end_date;

    // โหลดเขต
    const areaInput = document.getElementById("area");
    if (areaInput && plan.area) areaInput.value = plan.area;

    // ✅ โหลดแถวตารางกลับมา
    if (plan.trips && Array.isArray(plan.trips) && plan.trips.length > 0) {
      const tbody = document.getElementById("tripTableBody");
      tbody.innerHTML = ""; // ล้างก่อน

      plan.trips.forEach((t) => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td><input type="date" class="trip-date" value="${t.date || ""}"></td>
          <td>
            <select class="from-province">
              ${generateProvinceOptions(t.from)}
            </select>
          </td>
          <td>
            <select class="to-province" onchange="handleProvinceChange(this)">
              ${generateProvinceOptions(t.to)}
            </select>
          </td>
          <td><select class="shop1">${generateShopOptions(t.to, t.shop1Id, t.shop1)}</select></td>
          <td><select class="shop2">${generateShopOptions(t.to, t.shop2Id, t.shop2)}</select></td>
          <td><select class="shop3">${generateShopOptions(t.to, t.shop3Id, t.shop3)}</select></td>
          <td><input type="text" class="note" value="${t.note || ""}" placeholder="หมายเหตุ"></td>
        `;
        tbody.appendChild(row);
      });

      // sync trips array
      trips = plan.trips;
      console.log(`✅ Restored ${trips.length} trip rows`);
    }

    console.log("✅ Loaded existing plan:", currentPlanId);
  } catch (error) {
    console.error("❌ loadExistingTrips error:", error);
  }
}
// =====================================================
// ➕ TABLE ROW MANAGEMENT
// =====================================================

function addRow() {
  const tbody = document.getElementById("tripTableBody");
  const row   = document.createElement("tr");

  row.innerHTML = `
    <td><input type="date" class="trip-date"></td>
    <td>
      <select class="from-province">
        ${generateProvinceOptions()}
      </select>
    </td>
    <td>
      <select class="to-province" onchange="handleProvinceChange(this)">
        ${generateProvinceOptions()}
      </select>
    </td>
    <td><select class="shop1"><option value="">ชื่อร้าน</option></select></td>
    <td><select class="shop2"><option value="">ชื่อร้าน</option></select></td>
    <td><select class="shop3"><option value="">ชื่อร้าน</option></select></td>
    <td><input type="text" class="note" placeholder="หมายเหตุ"></td>
  `;

  tbody.appendChild(row);
}

function removeRow() {
  const tbody = document.getElementById("tripTableBody");
  if (tbody.rows.length > 0) tbody.deleteRow(-1);
}

function generateProvinceOptions() {
  const provinces = [...new Set(myShops.map((s) => s.province))].sort();
  let html = `<option value="">จังหวัด</option>`;
  provinces.forEach((p) => {
    html += `<option value="${p}">${p}</option>`;
  });
  return html;
}

// ✅ generate province options พร้อม pre-select ค่าที่บันทึกไว้
function generateProvinceOptions(selectedValue = "") {
  const provinces = [...new Set(myShops.map((s) => s.province))].sort();
  let html = `<option value="">จังหวัด</option>`;
  provinces.forEach((p) => {
    const selected = p === selectedValue ? 'selected' : '';
    html += `<option value="${p}" ${selected}>${p}</option>`;
  });
  return html;
}

// ✅ generate shop options พร้อม pre-select ร้านที่บันทึกไว้
function generateShopOptions(province = "", selectedId = "", selectedName = "") {
  let html = `<option value="">ชื่อร้าน</option>`;

  const shops = province
    ? myShops.filter((s) => s.province === province)
    : [];

  if (shops.length > 0) {
    shops.forEach((s) => {
      const selected = s.id === selectedId ? 'selected' : '';
      html += `<option value="${s.id}" ${selected}>${s.shop_name}</option>`;
    });
  } else if (selectedId && selectedName) {
    // ✅ กรณี province ไม่ตรง แต่ยังมีค่าเดิม — แสดงชื่อร้านไว้ก่อน
    html += `<option value="${selectedId}" selected>${selectedName}</option>`;
  }

  return html;
}

function handleProvinceChange(selectElement) {
  const province = selectElement.value;
  const row      = selectElement.closest("tr");
  const shops    = myShops.filter((s) => s.province === province);
  const options  = shops
    .map((s) => `<option value="${s.id}">${s.shop_name}</option>`)
    .join("");

  ["shop1", "shop2", "shop3"].forEach((cls) => {
    row.querySelector(`.${cls}`).innerHTML =
      `<option value="">ชื่อร้าน</option>` + options;
  });
}

// =====================================================
// 💾 SAVE PLAN TO DATABASE
// =====================================================

async function savePlanToDatabase(status = "draft") {
  try {
    const { userId, userName, userZone } = await getCurrentUserInfo();
    if (!userId) {
      console.error("❌ No user ID");
      return;
    }

    // เก็บข้อมูลจากตาราง
    saveTableData(false); // false = ไม่แสดง alert

    const planData = {
      user_id:    userId,
      user_name:  userName,
      start_date: document.getElementById("startDate")?.value,
      end_date:   document.getElementById("endDate")?.value,
      // ✅ แก้: เดิมอ้าง id="zone" → แก้เป็น id="area"
      area:       document.getElementById("area")?.value || userZone,
      trips:      trips,
      status:     status,
      updated_at: new Date().toISOString(),
    };

    if (currentPlanId) {
      const { error } = await supabaseClient
        .from("trips")
        .update(planData)
        .eq("id", currentPlanId);
      if (error) throw error;
      console.log("✅ Plan updated:", currentPlanId);
    } else {
      planData.created_at = new Date().toISOString();
      const { data, error } = await supabaseClient
        .from("trips")
        .insert([planData])
        .select();
      if (error) throw error;
      if (data && data.length > 0) {
        currentPlanId = data[0].id;
        console.log("✅ New plan created:", currentPlanId);
      }
    }

    if (status === "draft") alert("💾 บันทึก Draft เรียบร้อย");
    if (status === "completed") alert("✅ บันทึกสำเร็จ");

  } catch (error) {
    console.error("❌ savePlanToDatabase error:", error);
    alert("❌ บันทึกไม่สำเร็จ: " + error.message);
  }
}

// =====================================================
// 📦 COLLECT TABLE DATA
// =====================================================

// showAlert = true เมื่อเรียกจากปุ่มโดยตรง, false เมื่อเรียกก่อน save
function saveTableData(showAlert = true) {
  const rows = document.querySelectorAll("#tripTableBody tr");
  trips = [];

  rows.forEach((row) => {
    trips.push({
      date:   row.querySelector(".trip-date")?.value    || "",
      from:   row.querySelector(".from-province")?.value || "",
      to:     row.querySelector(".to-province")?.value   || "",
      shop1:  row.querySelector(".shop1")?.selectedOptions?.[0]?.text || "",
      shop2:  row.querySelector(".shop2")?.selectedOptions?.[0]?.text || "",
      shop3:  row.querySelector(".shop3")?.selectedOptions?.[0]?.text || "",
      shop1Id: row.querySelector(".shop1")?.value || "",
      shop2Id: row.querySelector(".shop2")?.value || "",
      shop3Id: row.querySelector(".shop3")?.value || "",
      note:   row.querySelector(".note")?.value || "",
    });
  });

  console.log("📦 ข้อมูลที่บันทึก:", trips);
  if (showAlert) alert("✅ บันทึกข้อมูลเรียบร้อย");
}

// =====================================================
// 📊 SUMMARY CALCULATION
// =====================================================

// ✅ แก้: เดิม calculateSummary() ถูก declare 2 ครั้ง → รวมเป็นครั้งเดียว
function calculateSummary() {
  const allowanceRate  = parseFloat(document.getElementById("allowanceRate")?.value)  || 0;
  const allowanceDays  = parseFloat(document.getElementById("allowanceDays")?.value)  || 0;
  const hotelRate      = parseFloat(document.getElementById("hotelRate")?.value)       || 0;
  const hotelNights    = parseFloat(document.getElementById("hotelNights")?.value)     || 0;
  const otherCost      = parseFloat(document.getElementById("otherCost")?.value)       || 0;

  const grandTotal = (allowanceRate * allowanceDays) + (hotelRate * hotelNights) + otherCost;
  document.getElementById("grandTotal").value = grandTotal.toLocaleString("th-TH");
}

function setupSummaryCalculation() {
  ["allowanceRate", "allowanceDays", "hotelRate", "hotelNights", "otherCost"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", calculateSummary);
  });
}

// =====================================================
// 🔍 PREVIEW MODAL
// =====================================================

function openPreview() {
  saveTableData(false); // sync trips ก่อน render

  // ── helper: แปลงวันที่เป็น dd/mm/yyyy ──
  function fmtDate(d) {
    if (!d) return "-";
    const [y, m, day] = d.split("-");
    return `${day}/${m}/${y}`;
  }

  // ── สร้างแถวตาราง ──
  let tableRows = "";
  trips.forEach((t, i) => {
    const rowBg = i % 2 === 0 ? "" : 'style="background:#f7f9fb"';
    tableRows += `
      <tr ${rowBg}>
        <td style="white-space:nowrap">${fmtDate(t.date)}</td>
        <td>${t.from || "-"}</td>
        <td>${t.to   || "-"}</td>
        <td>${t.shop1 || "-"}</td>
        <td>${t.shop2 || "-"}</td>
        <td>${t.shop3 || "-"}</td>
        <td style="text-align:left;padding-left:6px">${t.note || ""}</td>
      </tr>`;
  });

  if (!tableRows) {
    tableRows = `<tr><td colspan="7" style="text-align:center;color:#999;padding:14px">ไม่มีข้อมูล</td></tr>`;
  }

  // ── ข้อมูลค่าใช้จ่าย ──
  const allowanceRate = parseFloat(document.getElementById("allowanceRate")?.value) || 0;
  const allowanceDays = parseFloat(document.getElementById("allowanceDays")?.value) || 0;
  const hotelRate     = parseFloat(document.getElementById("hotelRate")?.value)      || 0;
  const hotelNights   = parseFloat(document.getElementById("hotelNights")?.value)    || 0;
  const otherCost     = parseFloat(document.getElementById("otherCost")?.value)      || 0;
  const totalAllow    = allowanceRate * allowanceDays;
  const totalHotel    = hotelRate * hotelNights;
  const grandTotal    = totalAllow + totalHotel + otherCost;

  const fmt = (n) => n.toLocaleString("th-TH", { minimumFractionDigits: 2 });

  // ── ข้อมูลพนักงาน ──
  const empName = document.getElementById("empName")?.value || "-";
  const area    = document.getElementById("area")?.value    || "-";
  const start   = fmtDate(document.getElementById("startDate")?.value);
  const end     = fmtDate(document.getElementById("endDate")?.value);

  // ── วันที่พิมพ์ ──
  const printDate = new Date().toLocaleDateString("th-TH", {
    year: "numeric", month: "long", day: "numeric"
  });

  document.getElementById("previewContent").innerHTML = `
  <style>
    /* ── สไตล์เฉพาะ preview content ── */
    .doc-wrap { font-family: 'Kanit', sans-serif; font-size: 13px; color: #1a1a1a; }

    /* หัวเอกสาร */
    .doc-company { text-align:center; margin-bottom:4px; }
    .doc-company .company-name {
      font-size: 16px; font-weight: 700; color: #1a1a1a; letter-spacing: 0.3px;
    }
    .doc-company .doc-title {
      font-size: 14px; font-weight: 600; color: #1a1a1a; margin-top: 2px;
    }
    .doc-divider {
      border: none; border-top: 2px solid #1a1a1a; margin: 8px 0 12px;
    }

    /* กล่องข้อมูลพนักงาน */
    .doc-meta {
      display: grid; grid-template-columns: 1fr 1fr;
      border: 1px solid #bbb; border-radius: 4px;
      margin-bottom: 14px; overflow: hidden;
    }
    .doc-meta-cell {
      padding: 7px 12px; font-size: 12.5px; line-height: 1.8;
    }
    .doc-meta-cell:first-child { border-right: 1px solid #bbb; }
    .doc-meta-label { font-weight: 700; color: #444; margin-right: 4px; }

    /* ตารางหลัก */
    .doc-trip-table {
      width: 100%; border-collapse: collapse; margin-bottom: 18px;
      font-size: 12px;
    }
    .doc-trip-table th {
      background: #e8f5f4; color: #1a5550;
      padding: 8px 7px; text-align: center;
      font-weight: 700; font-size: 12px;
      border: 1px solid #b2d8d5;
    }
    .doc-trip-table td {
      padding: 5px 6px; text-align: center;
      border: 1px solid #ccc; vertical-align: middle;
      font-size: 11px;
      /* ✅ ชื่อร้านพอดี 1 บรรทัด */
      max-width: 100px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }


    .doc-trip-table tbody tr:last-child td { border-bottom: 1px solid #ccc; }

    /* หัวสรุป */
    .doc-summary-title {
      font-size: 13px; font-weight: 700; color: #1a1a1a;
      margin-bottom: 6px; padding-bottom: 4px;
      border-bottom: 1.5px solid #b2d8d5;
      display: flex; align-items: center; gap: 6px;
    }
    .doc-summary-title::before {
      content: ''; display: inline-block;
      width: 3px; height: 14px;
      background: #7ec8c3; border-radius: 2px;
    }

    /* ตารางสรุปค่าใช้จ่าย */
    .doc-cost-table {
      width: 55%; margin-left: auto; margin-bottom: 20px;
      border-collapse: collapse; font-size: 12.5px;
    }
    .doc-cost-table td, .doc-cost-table th {
      border: 1px solid #ccc; padding: 6px 10px;
    }
    .doc-cost-table td:first-child { font-weight: 600; color: #333; }
    .doc-cost-table td:nth-child(2) { text-align: center; color: #555; }
    .doc-cost-table td:last-child { text-align: right; font-variant-numeric: tabular-nums; }

    .doc-cost-table .total-row th {
      background: #e8f5f4; color: #1a5550;
      text-align: right; padding: 7px 10px; font-size: 13px;
      border: 1px solid #b2d8d5; font-weight: 700;
    }

    /* ลายเซ็น */
        .doc-sign {
      margin-top: 40px;
      display: grid; grid-template-columns: repeat(4, 1fr);
      gap: 24px; text-align: center;
    }
    .doc-sign-box { font-size: 12px; line-height: 1.8; }
    .doc-sign-line {
      border-top: 1px solid #555;
      padding-top: 20px;
      margin-top: 60px;      /* ✅ เพิ่มระยะห่างเส้น-ชื่อ */
    }
    .doc-sign-name {
      font-weight: 600;
      color: #1a1a1a;
      margin-bottom: 2px;    /* ✅ ระยะห่างชื่อ-ตำแหน่ง */
    }
    .doc-sign-role {
      color: #555;
      margin-top: 2px;
    }
    /* วันที่พิมพ์ */
    .doc-print-date {
      text-align: right; font-size: 11px; color: #777; margin-bottom: 10px;
    }
  </style>

  <div class="doc-wrap">

    <!-- วันที่พิมพ์ -->
    <div class="doc-print-date">วันที่พิมพ์: ${printDate}</div>

    <!-- หัวเอกสาร -->
    <div class="doc-company">
      <div class="company-name">บริษัท เอิร์นนี่ แอดวานซ์ จำกัด</div>
      <div class="doc-title">แผนการเดินทางและเบิกทดลองจ่าย ๑</div>
    </div>
    <hr class="doc-divider">

    <!-- ข้อมูลพนักงาน -->
    <div class="doc-meta">
      <div class="doc-meta-cell">
        <div><span class="doc-meta-label">พนักงานขาย :</span>${empName}</div>
        <div><span class="doc-meta-label">เขตการขาย :</span>${area}</div>
      </div>
      <div class="doc-meta-cell">
        <div><span class="doc-meta-label">ระหว่างวันที่ :</span>${start}</div>
        <div><span class="doc-meta-label">ถึงวันที่ :</span>${end}</div>
      </div>
    </div>

    <!-- ตารางเดินทาง -->
    <table class="doc-trip-table">
      <thead>
        <tr>
          <th style="width:90px">ว/ด/ป</th>
          <th>จากจังหวัด</th>
          <th>ไปจังหวัด</th>
          <th>ร้านค้า 1</th>
          <th>ร้านค้า 2</th>
          <th>ร้านค้า 3</th>
          <th style="width:80px">หมายเหตุ</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>

    <!-- สรุปค่าใช้จ่าย -->
    <div class="doc-summary-title">สรุปค่าใช้จ่าย</div>
    <table class="doc-cost-table">
      <tr>
        <td>เบี้ยเลี้ยง</td>
        <td>${fmt(allowanceRate)} × ${allowanceDays} วัน</td>
        <td>${fmt(totalAllow)} บาท</td>
      </tr>
      <tr>
        <td>ค่าที่พัก</td>
        <td>${fmt(hotelRate)} × ${hotelNights} คืน</td>
        <td>${fmt(totalHotel)} บาท</td>
      </tr>
      <tr>
        <td>ค่าใช้จ่ายอื่นๆ</td>
        <td style="text-align:center">–</td>
        <td>${fmt(otherCost)} บาท</td>
      </tr>
      <tr class="total-row">
        <th colspan="2">รวมเบิกทั้งหมด</th>
        <th style="font-size:14px">${fmt(grandTotal)} บาท</th>
      </tr>
    </table>

    <!-- ลายเซ็น -->
    <div class="doc-sign">
      <div class="doc-sign-box">
        <div class="doc-sign-line">
          <div class="doc-sign-name">(${empName})</div>
          <div class="doc-sign-role">พนักงานขาย</div>
        </div>
      </div>
      <div class="doc-sign-box">
        <div class="doc-sign-line">
          <div class="doc-sign-name">(...................................................................)</div>
          <div class="doc-sign-role">ผู้จัดการฝ่ายขาย</div>
        </div>
      </div>
      <div class="doc-sign-box">
        <div class="doc-sign-line">
          <div class="doc-sign-name">(...................................................................)</div>
          <div class="doc-sign-role">ฝ่ายบัญชี</div>
        </div>
      </div>
      <div class="doc-sign-box">
        <div class="doc-sign-line">
          <div class="doc-sign-name">(...................................................................)</div>
          <div class="doc-sign-role">ผู้อนุมัติ</div>
        </div>
      </div>
    </div>

  </div>`;

  document.getElementById("previewModal").style.display = "flex";
}

function closePreview() {
  document.getElementById("previewModal").style.display = "none";
}

function printPreview() {
  const content = document.getElementById("previewContent").innerHTML;
  const win = window.open("", "_blank", "width=900,height=700");

  win.document.write(`<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>แผนการเดินทาง</title>
  <link href="https://fonts.googleapis.com/css2?family=Kanit&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    html, body {
      width: 210mm;
      margin: 0 auto;
      background: #fff;
      font-family: 'Kanit', sans-serif;
    }

    #print-wrap {
      width: 100%;
      padding: 6mm 8mm;
    }

    /* ✅ บังคับทุกอย่างอยู่หน้าเดียว ไม่ตัดหน้า */
    * {
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }

    @media print {
      @page {
        size: A4 portrait;
        margin: 0;
      }

      html, body {
        width: 210mm;
        height: 297mm;
        overflow: hidden;
        margin: 0;
      }

      #print-wrap {
        /* ✅ zoom แทน transform — Chrome print รองรับได้จริง */
        zoom: var(--zoom-level, 0.78);
        width: calc(210mm / var(--zoom-level, 0.78));
        padding: 5mm 7mm;
        page-break-after: avoid;
        break-after: avoid;
      }

      /* ✅ ห้ามตัดหน้าทุก element */
      table, thead, tbody, tr, td, th,
      .doc-sign, .doc-cost-table, .doc-trip-table {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }

      /* ซ่อน signature section ถ้าเกิน — optional */
      .doc-sign { margin-top: 20px !important; }
    }

    /* preview (ก่อนกด print) จัดกลาง */
    @media screen {
      body { padding: 10mm; background: #e0e0e0; }
      #print-wrap {
        background: #fff;
        box-shadow: 0 2px 12px rgba(0,0,0,0.15);
        max-width: 190mm;
        margin: 0 auto;
      }
    }

    /* ✅ ชื่อร้านพอดี 1 บรรทัด */
    .doc-trip-table td {
      max-width: 90px !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }
    .doc-trip-table th { white-space: nowrap !important; }

    /* สีอ่อนลง */
    .doc-trip-table th {
      background: #e8f5f4 !important;
      color: #1a5550 !important;
      border: 1px solid #b2d8d5 !important;
    }
    .doc-cost-table .total-row th {
      background: #e8f5f4 !important;
      color: #1a5550 !important;
    }
  </style>
</head>
<body>
  <div id="print-wrap">${content}</div>

  <script>
    document.fonts.ready.then(() => {
      // คำนวณ zoom จากความสูงจริงของ content
      const wrap = document.getElementById('print-wrap');
      const A4_H_PX = 297 * 3.7795;   // 297mm → px
      const A4_W_PX = 210 * 3.7795;
      const contentH = wrap.scrollHeight;
      const contentW = wrap.scrollWidth;

      const zoomH = (A4_H_PX - 20) / contentH;
      const zoomW = A4_W_PX / contentW;
      const zoom  = Math.min(zoomH, zoomW, 1).toFixed(3); // ไม่ขยาย ถ้าเล็กกว่า A4

      wrap.style.setProperty('--zoom-level', zoom);
      wrap.style.zoom = zoom;

      console.log('zoom:', zoom, 'contentH:', contentH);

      setTimeout(() => {
        window.focus();
        window.print();
        window.close();
      }, 400);
    });
  <\/script>
</body>
</html>`);

  win.document.close();
}

function exportPDF() {
  printPreview(); // ใช้ฟังก์ชันเดียวกัน
}

// function exportPDF() {
//   window.print();
// }

// =====================================================
// 📤 EXPORT CSV
// =====================================================

function exportTrips() {
  if (trips.length === 0) {
    alert("❌ ไม่มีข้อมูลทริปให้ Export");
    return;
  }

  const empName = document.getElementById("empName")?.value || "User";
  const area    = document.getElementById("area")?.value    || "";
  const start   = document.getElementById("startDate")?.value || "";

  let csv = "ลำดับ,วันที่,เดินทางจาก,ไปจังหวัด,ร้านค้า 1,ร้านค้า 2,ร้านค้า 3,หมายเหตุ\n";
  trips.forEach((t, i) => {
    csv += [
      i + 1,
      t.date,
      escapeCsv(t.from),
      escapeCsv(t.to),
      escapeCsv(t.shop1),
      escapeCsv(t.shop2),
      escapeCsv(t.shop3),
      escapeCsv(t.note),
    ].join(",") + "\n";
  });

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href     = url;
  link.download = `Trip_Plan_${empName}_${area}_${start}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  alert("✅ Export สำเร็จ");
}

// =====================================================
// 🛠️ UTILITY
// =====================================================

async function getCurrentUserId() {
  if (typeof getUserData === "function") return getUserData("id");
  const { data: { user } } = await supabaseClient.auth.getUser();
  return user?.id || null;
}

async function getCurrentUserInfo() {
  if (typeof getUserData === "function") {
    return {
      userId:   getUserData("id"),
      userName: getUserData("display_name"),
      userZone: getUserData("area"),
    };
  }
  const { data: { user } } = await supabaseClient.auth.getUser();
  const { data: profile }  = await supabaseClient
    .from("profiles")
    .select("display_name, area")
    .eq("id", user.id)
    .maybeSingle();
  return {
    userId:   user.id,
    userName: profile?.display_name || user.email,
    userZone: profile?.area || null,
  };
}

function escapeCsv(text) {
  if (!text) return "";
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

console.log("✅ formPlan.js loaded successfully");


// =====================================================
// 📋 DRAFT MANAGER
// =====================================================

async function loadDraftList() {
  const container = document.getElementById("draftList");
  const badge     = document.getElementById("draftCountBadge");
  if (!container) return;

  container.innerHTML = `<p style="text-align:center;color:#aaa;padding:20px 0;font-size:13px;">กำลังโหลด...</p>`;

  try {
    const userId = await getCurrentUserId();
    if (!userId) return;

    const { data, error } = await supabaseClient
      .from("trips")
      .select("id, user_name, area, start_date, end_date, status, trips, created_at, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      badge.textContent = "0 รายการ";
      container.innerHTML = `
        <div style="text-align:center;padding:32px;color:#aaa;font-size:13px;
          border:1px dashed #ddd;border-radius:12px;">
          ยังไม่มีแผนที่บันทึกไว้
        </div>`;
      return;
    }

    badge.textContent = `${data.length} รายการ`;

    container.innerHTML = data.map(plan => {
      const rowCount  = Array.isArray(plan.trips) ? plan.trips.length : 0;
      const startFmt  = formatDateTH(plan.start_date);
      const endFmt    = formatDateTH(plan.end_date);
      const updFmt    = formatDateTimeTH(plan.updated_at);
      const isDraft   = plan.status === "draft";

      const statusBadge = isDraft
        ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;
            padding:2px 8px;border-radius:999px;background:#FAEEDA;
            color:#633806;border:1px solid #EF9F27;">
            <span style="width:6px;height:6px;border-radius:50%;background:#EF9F27;display:inline-block;"></span>
            Draft</span>`
        : `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;
            padding:2px 8px;border-radius:999px;background:#E1F5EE;
            color:#085041;border:1px solid #1D9E75;">
            <span style="width:6px;height:6px;border-radius:50%;background:#1D9E75;display:inline-block;"></span>
            Completed</span>`;

      return `
        <div id="draft-${plan.id}" style="
          background:#fff; border:1px solid #e2e8f0; border-radius:12px;
          padding:14px 16px; margin-bottom:8px;
          display:grid; grid-template-columns:1fr auto;
          gap:10px; align-items:center;
          cursor:pointer; transition:border-color 0.15s, background 0.15s;"
          onclick="selectDraftCard('${plan.id}')"
          onmouseenter="this.style.borderColor='#5DCAA5'; this.style.background='#f4fcfa';"
          onmouseleave="this.style.borderColor='#e2e8f0'; this.style.background='#fff';">

          <div>
            <div style="font-weight:700;font-size:14px;color:#1e293b;margin-bottom:3px;">
              ${plan.user_name || "ไม่ระบุชื่อ"} — ${plan.area || "ไม่ระบุเขต"}
            </div>
            <div style="font-size:12px;color:#64748b;margin-bottom:6px;display:flex;gap:12px;flex-wrap:wrap;">
              <span>📅 ${startFmt} – ${endFmt}</span>
              <span>·</span>
              <span>${rowCount} แถว</span>
              <span>·</span>
              <span>อัปเดต: ${updFmt}</span>
            </div>
            <div>${statusBadge}</div>
          </div>

          <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
            <button type="button"
              onclick="event.stopPropagation(); loadDraftById('${plan.id}')"
              style="background:#e8f5f4;color:#0f6e56;border:1px solid #5DCAA5;
                border-radius:8px;padding:7px 14px;font-size:13px;
                cursor:pointer;font-weight:600;white-space:nowrap;
                font-family:inherit;">
              ✏️ โหลดแก้ไข
            </button>
            <button type="button"
              onclick="event.stopPropagation(); deleteDraftById('${plan.id}')"
              style="background:none;border:1px solid #fca5a5;border-radius:8px;
                padding:7px 10px;font-size:13px;cursor:pointer;color:#dc2626;
                font-family:inherit;" title="ลบ">
              🗑
            </button>
          </div>
        </div>`;
    }).join("");

  } catch (err) {
    console.error("❌ loadDraftList error:", err);
    container.innerHTML = `<p style="color:red;text-align:center;">โหลดไม่สำเร็จ: ${err.message}</p>`;
  }
}

// ── ไฮไลต์การ์ดที่เลือก ──
function selectDraftCard(id) {
  document.querySelectorAll('[id^="draft-"]').forEach(el => {
    el.style.borderColor = "#e2e8f0";
    el.style.background  = "#fff";
    el.style.borderWidth = "1px";
  });
  const card = document.getElementById(`draft-${id}`);
  if (card) {
    card.style.borderColor = "#1D9E75";
    card.style.borderWidth = "1.5px";
    card.style.background  = "#f0fbf7";
  }
}

// ── โหลดแผนมาใส่ฟอร์ม ──
async function loadDraftById(id) {
  try {
    const { data, error } = await supabaseClient
      .from("trips")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!data) { alert("ไม่พบข้อมูล"); return; }

    currentPlanId = data.id;

    // โหลดวันที่
    if (data.start_date) document.getElementById("startDate").value = data.start_date;
    if (data.end_date)   document.getElementById("endDate").value   = data.end_date;

    // โหลดเขต
    const areaInput = document.getElementById("area");
    if (areaInput && data.area) areaInput.value = data.area;

    // โหลดค่าใช้จ่าย (ถ้าบันทึกไว้)
    if (data.allowance_rate)  document.getElementById("allowanceRate").value  = data.allowance_rate;
    if (data.allowance_days)  document.getElementById("allowanceDays").value  = data.allowance_days;
    if (data.hotel_rate)      document.getElementById("hotelRate").value       = data.hotel_rate;
    if (data.hotel_nights)    document.getElementById("hotelNights").value     = data.hotel_nights;
    if (data.other_cost)      document.getElementById("otherCost").value       = data.other_cost;
    calculateSummary();

    // โหลดแถวตาราง
    if (Array.isArray(data.trips) && data.trips.length > 0) {
      const tbody = document.getElementById("tripTableBody");
      tbody.innerHTML = "";

      data.trips.forEach((t) => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td><input type="date" class="trip-date" value="${t.date || ""}"></td>
          <td><select class="from-province">${generateProvinceOptions(t.from)}</select></td>
          <td><select class="to-province" onchange="handleProvinceChange(this)">${generateProvinceOptions(t.to)}</select></td>
          <td><select class="shop1">${generateShopOptions(t.to, t.shop1Id, t.shop1)}</select></td>
          <td><select class="shop2">${generateShopOptions(t.to, t.shop2Id, t.shop2)}</select></td>
          <td><select class="shop3">${generateShopOptions(t.to, t.shop3Id, t.shop3)}</select></td>
          <td><input type="text" class="note" value="${t.note || ""}" placeholder="หมายเหตุ"></td>
        `;
        tbody.appendChild(row);
      });

      trips = data.trips;
    }

    // ไฮไลต์การ์ดที่โหลด
    selectDraftCard(id);

    // เลื่อนขึ้นไปที่ฟอร์ม
    document.querySelector(".section")?.scrollIntoView({ behavior: "smooth" });
    alert(`✅ โหลดแผนเรียบร้อย (ID: ${id.slice(0,8)}...)`);

  } catch (err) {
    console.error("❌ loadDraftById error:", err);
    alert("❌ โหลดไม่สำเร็จ: " + err.message);
  }
}

// ── ลบแผน ──
async function deleteDraftById(id) {
  if (!confirm("ต้องการลบแผนนี้?")) return;
  try {
    const { error } = await supabaseClient
      .from("trips")
      .delete()
      .eq("id", id);

    if (error) throw error;

    // ลบการ์ดออกจาก UI
    document.getElementById(`draft-${id}`)?.remove();

    // อัปเดต badge
    const remaining = document.querySelectorAll('[id^="draft-"]').length;
    const badge = document.getElementById("draftCountBadge");
    if (badge) badge.textContent = `${remaining} รายการ`;

    if (remaining === 0) {
      document.getElementById("draftList").innerHTML = `
        <div style="text-align:center;padding:32px;color:#aaa;font-size:13px;
          border:1px dashed #ddd;border-radius:12px;">
          ยังไม่มีแผนที่บันทึกไว้
        </div>`;
    }

    // ถ้าลบแผนที่กำลังแก้อยู่ — reset
    if (currentPlanId === id) currentPlanId = null;

    alert("✅ ลบเรียบร้อย");
  } catch (err) {
    console.error("❌ deleteDraftById error:", err);
    alert("❌ ลบไม่สำเร็จ: " + err.message);
  }
}

// ── helper: แปลงวันที่ ──
function formatDateTH(dateStr) {
  if (!dateStr) return "-";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

function formatDateTimeTH(isoStr) {
  if (!isoStr) return "-";
  const d = new Date(isoStr);
  return d.toLocaleString("th-TH", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

// =====================================================
// 🚪 LOGOUT
// =====================================================
async function logout() {
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;

    if (typeof showToast === "function") showToast("ออกจากระบบแล้ว", "info");

    setTimeout(() => {
      window.location.href = "/pages/auth/login.html";
    }, 500);

  } catch (err) {
    console.error("❌ Logout error:", err);
    alert("ออกจากระบบไม่สำเร็จ: " + err.message);
  }
}