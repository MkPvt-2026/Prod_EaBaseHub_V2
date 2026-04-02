// =====================================================
// formActual.js — ใบเดินทางจริงและเคลียร์ค่าใช้จ่าย ๒
// เวอร์ชัน: 2.1 | ปรับปรุง: 2026
// =====================================================
"use strict";

const STORAGE_KEY = "formActualDraft";
let currentPlanId = null;
let planData = null;
let actualId = null;

// =====================================================
// 🚀 INIT
// =====================================================
document.addEventListener("DOMContentLoaded", async () => {
  await loadUserInfo();
  await checkLatestPlan();
  await loadActualDraft();
  if (document.getElementById("tableBody").rows.length === 0) addRow();
  setupSummaryCalculation();
});

// =====================================================
// 👤 LOAD USER INFO
// =====================================================
async function loadUserInfo() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      window.location.href = "login.html";
      return;
    }

    const el = document.getElementById("sidebarEmail");
    if (el) el.textContent = session.user.email;

    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("display_name, area")
      .eq("id", session.user.id)
      .single();

    const empEl = document.getElementById("empName");
    const zoneEl = document.getElementById("empZone");
    if (empEl) empEl.value = profile?.display_name || session.user.email;
    if (zoneEl) zoneEl.value = profile?.area || "";

    console.log("✅ loadUserInfo");
  } catch (err) {
    console.error("❌ loadUserInfo:", err);
  }
}

// =====================================================
// 📋 CHECK LATEST PLAN (trips table)
// =====================================================
async function checkLatestPlan() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return;

    const { data, error } = await supabaseClient
      .from("trips")
      .select("id, user_name, start_date, end_date, area, trips, status, created_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error("❌ checkLatestPlan query:", error.message);
      return;
    }
    if (!data || data.length === 0) return;

    planData = data[0];
    currentPlanId = planData.id;

    const banner = document.getElementById("planBanner");
    const banTx = document.getElementById("planBannerText");
    const refInp = document.getElementById("refPlanId");

    if (refInp) refInp.value = planData.id;
    if (banner) banner.style.display = "flex";

    const fmtD = (d) =>
      d ? new Date(d).toLocaleDateString("th-TH", {
        day: "numeric", month: "short", year: "numeric"
      }) : "";

    if (banTx) {
      const tripCount = Array.isArray(planData.trips) ? planData.trips.length : 0;
      banTx.textContent =
        `พบแผนการเดินทาง (ฟอร์ม ๑) : ${fmtD(planData.start_date)}` +
        (planData.end_date ? ` – ${fmtD(planData.end_date)}` : "") +
        ` (${tripCount} แถว)`;
    }

    console.log("✅ checkLatestPlan:", planData.id, "trips:", Array.isArray(planData.trips) ? planData.trips.length : 0);
  } catch (err) {
    console.error("❌ checkLatestPlan:", err);
  }
}

// =====================================================
// 📥 IMPORT FROM PLAN — ✅ แก้ไข bug อ้างอิง draft ที่ไม่มี
// =====================================================
function importFromPlan() {
  if (!planData) {
    alert("ไม่พบข้อมูลแผน");
    return;
  }

  const tripRows = planData.trips;
  if (!Array.isArray(tripRows) || tripRows.length === 0) {
    alert("แผนนี้ยังไม่มีข้อมูลแถวเดินทาง (trips array ว่าง)");
    return;
  }

  // ล้างตารางเดิม
  document.getElementById("tableBody").innerHTML = "";

  // สร้างแถวจาก trips jsonb
  tripRows.forEach((t) => {
    const parts = [t.from, t.to, t.shop1, t.shop2, t.shop3].filter(
      (v) => v && v.trim() && v !== "-" && v !== "จังหวัด" && v !== "ชื่อร้าน" && v !== ""
    );
    const route = parts.join(" → ");
    addRow(t.date || "", route);
  });

  calcTotal();

  // ✅ แก้ไข: ใช้ planData แทน draft ที่ไม่มีอยู่
  if (planData.allowance_rate !== undefined) {
    const allowanceRateEl = document.getElementById("allowanceRate");
    const allowanceDaysEl = document.getElementById("allowanceDays");
    const hotelRateEl = document.getElementById("hotelRate");
    const hotelNightsEl = document.getElementById("hotelNights");
    const otherCostEl = document.getElementById("otherCost");
    
    if (allowanceRateEl) allowanceRateEl.value = planData.allowance_rate || "";
    if (allowanceDaysEl) allowanceDaysEl.value = planData.allowance_days || "";
    if (hotelRateEl) hotelRateEl.value = planData.hotel_rate || "";
    if (hotelNightsEl) hotelNightsEl.value = planData.hotel_nights || "";
    if (otherCostEl) otherCostEl.value = planData.other_cost || "";
    calculateSummary();
  }

  const hint = document.getElementById("importHint");
  if (hint) hint.style.display = "flex";

  dismissBanner();
  alert(`✅ นำข้อมูล ${tripRows.length} แถวจากแผนมาแล้วค่ะ\nกรอกค่าใช้จ่ายจริงในแต่ละแถวได้เลย`);
}

// =====================================================
// 🔎 LOAD PLAN BY ID
// =====================================================
async function loadPlanById() {
  const id = document.getElementById("refPlanId")?.value?.trim();
  if (!id) {
    alert("กรุณากรอก Plan ID ก่อนค่ะ");
    return;
  }

  try {
    const { data, error } = await supabaseClient
      .from("trips")
      .select("id, user_name, start_date, end_date, area, trips, status")
      .eq("id", id)
      .single();

    if (error || !data) {
      alert("❌ ไม่พบแผน ID: " + id);
      return;
    }

    planData = data;
    currentPlanId = data.id;

    const tripCount = Array.isArray(data.trips) ? data.trips.length : 0;
    const banner = document.getElementById("planBanner");
    const banTx = document.getElementById("planBannerText");
    if (banner) banner.style.display = "flex";
    if (banTx)
      banTx.textContent = `พบแผน ID: ${id.substring(0, 8)}... (${tripCount} แถว) — กด "นำข้อมูลมาใช้" ได้เลยค่ะ`;

    console.log("✅ loadPlanById:", id, "trips:", tripCount);
    alert(`✅ โหลดแผนสำเร็จ (${tripCount} แถว)\nกด "นำข้อมูลมาใช้" เพื่อนำมาใส่ตาราง`);
  } catch (err) {
    alert("❌ เกิดข้อผิดพลาด: " + err.message);
  }
}

// =====================================================
// 🗂️ LOAD ACTUAL DRAFT
// =====================================================
async function loadActualDraft() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return;

    const { data, error } = await supabaseClient
      .from("actuals")
      .select("id, ref_plan_id, start_date, end_date, rows, grand_total, status, allowance_rate, allowance_days, hotel_rate, hotel_nights, other_cost")
      .eq("user_id", session.user.id)
      .eq("status", "draft")
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) return;

    const draft = data[0];
    if (!Array.isArray(draft.rows) || draft.rows.length === 0) return;

    const fmtD = (d) =>
      d ? new Date(d).toLocaleDateString("th-TH", {
        day: "numeric", month: "short", year: "numeric"
      }) : "-";

    const confirm = window.confirm(
      `พบ Draft ที่บันทึกไว้\n` +
      `ช่วงวันที่: ${fmtD(draft.start_date)} – ${fmtD(draft.end_date)}\n` +
      `จำนวน: ${draft.rows.length} แถว\n\n` +
      `ต้องการโหลดต่อไหมคะ?`
    );
    if (!confirm) return;

    actualId = draft.id;
    currentPlanId = draft.ref_plan_id || currentPlanId;

    const refInp = document.getElementById("refPlanId");
    if (refInp && draft.ref_plan_id) refInp.value = draft.ref_plan_id;

    // ล้างตาราง แล้วเติมข้อมูล
    document.getElementById("tableBody").innerHTML = "";
    draft.rows.forEach((r) => {
      addRow(r.date || "", r.route || "");
      const lastRow = document.getElementById("tableBody").lastElementChild;
      const inp = lastRow.querySelectorAll("input");
      if (inp[2]) inp[2].value = r.note || "";
    });
    calcTotal();

    // ✅ โหลดค่าใช้จ่ายจาก draft
    if (draft.allowance_rate !== undefined) {
      const allowanceRateEl = document.getElementById("allowanceRate");
      const allowanceDaysEl = document.getElementById("allowanceDays");
      const hotelRateEl = document.getElementById("hotelRate");
      const hotelNightsEl = document.getElementById("hotelNights");
      const otherCostEl = document.getElementById("otherCost");
      
      if (allowanceRateEl) allowanceRateEl.value = draft.allowance_rate || "";
      if (allowanceDaysEl) allowanceDaysEl.value = draft.allowance_days || "";
      if (hotelRateEl) hotelRateEl.value = draft.hotel_rate || "";
      if (hotelNightsEl) hotelNightsEl.value = draft.hotel_nights || "";
      if (otherCostEl) otherCostEl.value = draft.other_cost || "";
      calculateSummary();
    }

    const hint = document.getElementById("importHint");
    if (hint) {
      hint.style.display = "flex";
      const hintText = hint.querySelector("span:last-child");
      if (hintText) hintText.textContent = "โหลด Draft ที่บันทึกไว้แล้ว — แก้ไขต่อได้เลยค่ะ";
    }

    console.log("✅ loadActualDraft:", actualId);
  } catch (err) {
    console.error("❌ loadActualDraft:", err);
  }
}

function dismissBanner() {
  const b = document.getElementById("planBanner");
  if (b) b.style.display = "none";
}

// =====================================================
// ➕ ADD ROW
// =====================================================
function addRow(date, route) {
  const today = date || new Date().toISOString().split("T")[0];
  const tr = document.createElement("tr");
  const safeRoute = (route || "").replace(/"/g, "&quot;");

  tr.innerHTML =
    `<td><input type="date" value="${today}"></td>` +
    `<td><input type="text" value="${safeRoute}" placeholder="เส้นทาง / ร้านค้า"></td>` +
    `<td><input type="text" placeholder="หมายเหตุ"></td>`;

  document.getElementById("tableBody").appendChild(tr);
}

// =====================================================
// ➖ DELETE ROW
// =====================================================
function deleteRow() {
  const tbody = document.getElementById("tableBody");
  if (tbody.rows.length > 0) {
    tbody.deleteRow(-1);
    calcTotal();
  }
}

// =====================================================
// 🧮 CALC TOTAL
// =====================================================
function calcTotal() {
  let total = 0;
  const rows = document.querySelectorAll("#tableBody tr");
  rows.forEach((row) => {
    row.querySelectorAll("input[type='number']").forEach((inp) => {
      total += Number(inp.value || 0);
    });
  });
  const daysEl = document.getElementById("days");
  const totalEl = document.getElementById("total");
  if (daysEl) daysEl.textContent = rows.length;
  if (totalEl) totalEl.textContent = total.toLocaleString("th-TH", { minimumFractionDigits: 2 });
}

// =====================================================
// 📦 COLLECT FORM DATA
// =====================================================
function collectFormData() {
  const emp = document.getElementById("empName")?.value?.trim() || "";
  const zone = document.getElementById("empZone")?.value?.trim() || "";

  if (!emp) {
    alert("ไม่พบข้อมูลพนักงาน กรุณา Login ก่อนค่ะ");
    return null;
  }

  const rows = [];
  let firstDate = "";
  let lastDate = "";

  document.querySelectorAll("#tableBody tr").forEach((tr, i) => {
    const inp = tr.querySelectorAll("input");
    const date = inp[0]?.value || "";
    if (i === 0) firstDate = date;
    lastDate = date;
    rows.push({ 
      date, 
      route: inp[1]?.value || "", 
      note: inp[2]?.value || "" 
    });
  });

  if (rows.length === 0) {
    alert("กรุณาเพิ่มข้อมูลอย่างน้อย 1 แถวค่ะ");
    return null;
  }

  const allowanceRate = parseFloat(document.getElementById("allowanceRate")?.value) || 0;
  const allowanceDays = parseFloat(document.getElementById("allowanceDays")?.value) || 0;
  const hotelRate = parseFloat(document.getElementById("hotelRate")?.value) || 0;
  const hotelNights = parseFloat(document.getElementById("hotelNights")?.value) || 0;
  const otherCost = parseFloat(document.getElementById("otherCost")?.value) || 0;
  const grandTotal = allowanceRate * allowanceDays + hotelRate * hotelNights + otherCost;

  return {
    emp,
    zone,
    start: firstDate,
    end: lastDate,
    rows,
    grandTotal,
    allowanceRate,
    allowanceDays,
    hotelRate,
    hotelNights,
    otherCost,
    refPlanId: currentPlanId || null,
  };
}

// =====================================================
// 💾 SAVE DRAFT
// =====================================================
async function saveDraft() {
  const d = collectFormData();
  if (!d) return;

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      alert("กรุณา Login ก่อนบันทึกค่ะ");
      return;
    }

    const payload = {
      user_id: session.user.id,
      user_name: d.emp,
      ref_plan_id: d.refPlanId,
      zone: d.zone,
      start_date: d.start || null,
      end_date: d.end || null,
      rows: d.rows,
      grand_total: d.grandTotal,
      status: "draft",
      updated_at: new Date().toISOString(),
      allowance_rate: d.allowanceRate,
      allowance_days: d.allowanceDays,
      hotel_rate: d.hotelRate,
      hotel_nights: d.hotelNights,
      other_cost: d.otherCost,
    };

    let saveError = null;

    if (actualId) {
      const { error } = await supabaseClient
        .from("actuals")
        .update(payload)
        .eq("id", actualId);
      saveError = error;
    } else {
      payload.created_at = new Date().toISOString();
      const { data: inserted, error } = await supabaseClient
        .from("actuals")
        .insert([payload])
        .select("id")
        .single();
      saveError = error;
      if (!error && inserted) actualId = inserted.id;
    }

    if (saveError) throw saveError;

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...d, actualId, savedAt: new Date().toISOString() })
    );

    console.log("✅ saveDraft:", actualId);
    alert("💾 บันทึก Draft เรียบร้อยค่ะ");
  } catch (err) {
    console.error("❌ saveDraft:", err);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...d, savedAt: new Date().toISOString() })
    );
    alert("⚠️ บันทึก Supabase ไม่สำเร็จ\nบันทึก localStorage ไว้แล้ว\n\nError: " + err.message);
  }
}

// =====================================================
// ✅ SAVE COMPLETED
// =====================================================
async function saveCompleted() {
  const d = collectFormData();
  if (!d) return;

  if (!actualId) {
    await saveDraft();
    if (!actualId) return;
  }

  try {
    const { error } = await supabaseClient
      .from("actuals")
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("id", actualId);

    if (error) throw error;

    localStorage.removeItem(STORAGE_KEY);
    console.log("✅ saveCompleted:", actualId);
    alert("✅ บันทึกเอกสารเสร็จสมบูรณ์แล้วค่ะ");
  } catch (err) {
    console.error("❌ saveCompleted:", err);
    alert("❌ บันทึกไม่สำเร็จ: " + err.message);
  }
}

// =====================================================
// 🔍 OPEN PREVIEW
// =====================================================
function openPreview() {
  const d = collectFormData();
  if (!d) return;

  const fmtDate = (s) => {
    if (!s) return "-";
    const [y, m, day] = s.split("-");
    return `${day}/${m}/${y}`;
  };
  const fmt = (n) => Number(n).toLocaleString("th-TH", { minimumFractionDigits: 2 });

  let tRows = "";
  d.rows.forEach((r, i) => {
    const bg = i % 2 === 1 ? ' style="background:#f7f9fb"' : "";
    tRows +=
      `<tr${bg}>` +
      `<td style="white-space:nowrap">${fmtDate(r.date)}</td>` +
      `<td style="text-align:left;padding-left:8px">${r.route || "-"}</td>` +
      `<td style="text-align:left;padding-left:6px">${r.note || ""}</td>` +
      `</tr>`;
  });

  const totalAllow = d.allowanceRate * d.allowanceDays;
  const totalHotel = d.hotelRate * d.hotelNights;
  const today = new Date().toLocaleDateString("th-TH", {
    year: "numeric", month: "long", day: "numeric"
  });
  const planRef = d.refPlanId
    ? `<div><span class="dm-label">อ้างอิงแผน :</span>${d.refPlanId.substring(0, 8)}...</div>`
    : "";

  document.getElementById("previewContent").innerHTML = `
<style>
.dw{font-family:'Kanit',sans-serif;font-size:13px;color:#1a1a1a}
.dc{text-align:center;margin-bottom:4px}
.co{font-size:16px;font-weight:700}
.dt{font-size:14px;font-weight:600;margin-top:2px}
hr.dd{border:none;border-top:2px solid #1a1a1a;margin:8px 0 12px}
.dpd{text-align:right;font-size:11px;color:#777;margin-bottom:8px}
.dm{display:grid;grid-template-columns:1fr 1fr;border:1px solid #bbb;border-radius:4px;margin-bottom:14px;overflow:hidden}
.dmc{padding:7px 12px;font-size:12.5px;line-height:1.9}
.dmc:first-child{border-right:1px solid #bbb}
.dm-label{font-weight:700;color:#444;margin-right:4px}
.dmt{width:100%;border-collapse:collapse;margin-bottom:18px;font-size:12px}
.dmt th{background:#e8f5f4;color:#1a5550;padding:8px 7px;text-align:center;border:1px solid #b2d8d5;font-size:12px}
.dmt td{padding:7px 6px;border:1px solid #ccc;text-align:center;vertical-align:middle}
.dst{font-size:13px;font-weight:700;margin-bottom:6px;padding-bottom:4px;border-bottom:1.5px solid #1a6b64;display:flex;align-items:center;gap:6px}
.dst::before{content:'';display:inline-block;width:3px;height:14px;background:#3FB7AE;border-radius:2px}
.dct{width:60%;margin-left:auto;margin-bottom:20px;border-collapse:collapse;font-size:12.5px}
.dct td,.dct th{border:1px solid #ccc;padding:6px 10px}
.dct td:first-child{font-weight:600;color:#333}
.dct td:nth-child(2){text-align:center;color:#555}
.dct td:last-child{text-align:right;font-variant-numeric:tabular-nums}
.dct .tr th{background:#e8f5f4;color:#1a5550;text-align:right;padding:7px 10px;font-size:13px;border:1px solid #b2d8d5}
.ds{margin-top:40px;display:grid;grid-template-columns:repeat(4,1fr);gap:20px;text-align:center}
.dsb{font-size:12px;line-height:1.8}
.dsl{border-top:1px solid #555;padding-top:20px;margin-top:60px}
.dsn{font-weight:600}.dsr{color:#555}
</style>
<div class="dw">
  <div class="dpd">วันที่พิมพ์: ${today}</div>
  <div class="dc">
    <div class="co">บริษัท เอิร์นนี่ แอดวานซ์ จำกัด</div>
    <div class="dt">ใบเดินทางจริงและเคลียร์ค่าใช้จ่าย ๒</div>
  </div>
  <hr class="dd">
  <div class="dm">
    <div class="dmc">
      <div><span class="dm-label">พนักงานขาย :</span>${d.emp}</div>
      <div><span class="dm-label">เขตการขาย :</span>${d.zone || "-"}</div>
      ${planRef}
    </div>
    <div class="dmc">
      <div><span class="dm-label">ระหว่างวันที่ :</span>${fmtDate(d.start)}</div>
      <div><span class="dm-label">ถึงวันที่ :</span>${fmtDate(d.end)}</div>
      <div><span class="dm-label">จำนวน :</span>${d.rows.length} วัน</div>
    </div>
  </div>
  <table class="dmt">
    <thead><tr>
      <th style="width:100px">ว/ด/ป</th>
      <th>เส้นทางจริง</th>
      <th style="width:120px">หมายเหตุ</th>
    </tr></thead>
    <tbody>${tRows || '<tr><td colspan="3" style="text-align:center;color:#999;padding:16px">ไม่มีข้อมูล</td></tr>'}</tbody>
  </table>
  <div class="dst">สรุปค่าใช้จ่าย</div>
  <table class="dct">
    <tr><td>เบี้ยเลี้ยง</td><td>${fmt(d.allowanceRate)} × ${d.allowanceDays} วัน</td><td>${fmt(totalAllow)} บาท</td></tr>
    <tr><td>ค่าที่พัก</td><td>${fmt(d.hotelRate)} × ${d.hotelNights} คืน</td><td>${fmt(totalHotel)} บาท</td></tr>
    <tr><td>ค่าใช้จ่ายอื่นๆ</td><td style="text-align:center">–</td><td>${fmt(d.otherCost)} บาท</td></tr>
    <tr class="tr">
      <th colspan="2">รวมเบิกทั้งหมด</th>
      <th style="font-size:14px">${fmt(d.grandTotal)} บาท</th>
    </tr>
  </table>
  <div class="ds">
    <div class="dsb"><div class="dsl"><div class="dsn">(${d.emp})</div><div class="dsr">พนักงานขาย</div></div></div>
    <div class="dsb"><div class="dsl"><div class="dsn">(...................................................................)</div><div class="dsr">ผู้จัดการฝ่ายขาย</div></div></div>
    <div class="dsb"><div class="dsl"><div class="dsn">(...................................................................)</div><div class="dsr">ฝ่ายบัญชี</div></div></div>
    <div class="dsb"><div class="dsl"><div class="dsn">(...................................................................)</div><div class="dsr">ผู้อนุมัติ</div></div></div>
  </div>
</div>`;

  document.getElementById("previewModal").style.display = "flex";
}

// =====================================================
// 🔲 MODAL CONTROLS
// =====================================================
function closePreview() {
  document.getElementById("previewModal").style.display = "none";
}

function printPreview() {
  const content = document.getElementById("previewContent")?.innerHTML;
  
  // ✅ ตรวจสอบว่ามี content หรือไม่
  if (!content || content.trim() === "") {
    alert("❌ ไม่มีข้อมูลสำหรับพิมพ์ กรุณากด Preview ก่อน");
    return;
  }

  try {
    const win = window.open("", "_blank", "width=900,height=700");
    
    if (!win) {
      alert("❌ ไม่สามารถเปิดหน้าต่างพิมพ์ได้ กรุณาอนุญาต popup");
      return;
    }

    win.document.write(`<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>ใบเดินทางจริง</title>
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
    @media print {
      @page { size: A4 portrait; margin: 0; }
      html, body { width: 210mm; height: 297mm; overflow: hidden; margin: 0; }
      #print-wrap {
        zoom: var(--zoom-level, 0.82);
        width: calc(210mm / var(--zoom-level, 0.82));
        padding: 5mm 7mm;
        page-break-after: avoid;
        break-after: avoid;
      }
      table, thead, tbody, tr, td, th,
      .ds, .dct, .dmt {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      .ds { margin-top: 20px !important; }
    }
    @media screen {
      body { padding: 10mm; background: #e0e0e0; }
      #print-wrap {
        background: #fff;
        box-shadow: 0 2px 12px rgba(0,0,0,0.15);
        max-width: 190mm;
        margin: 0 auto;
      }
    }
    .dmt td {
      max-width: 120px !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }
    .dmt th { white-space: nowrap !important; }
    .dmt th {
      background: #e8f5f4 !important;
      color: #1a5550 !important;
      border: 1px solid #b2d8d5 !important;
    }
    .dct .tr th {
      background: #e8f5f4 !important;
      color: #1a5550 !important;
    }
    .dsl {
      border-top: 1px solid #555;
      padding-top: 10px !important;
      margin-top: 60px !important;
    }
  </style>
</head>
<body>
  <div id="print-wrap">${content}</div>
  <script>
    document.fonts.ready.then(() => {
      const wrap = document.getElementById('print-wrap');
      const A4_H_PX = 297 * 3.7795;
      const A4_W_PX = 210 * 3.7795;
      const zoomH = (A4_H_PX - 20) / wrap.scrollHeight;
      const zoomW = A4_W_PX / wrap.scrollWidth;
      const zoom  = Math.min(zoomH, zoomW, 1).toFixed(3);
      wrap.style.setProperty('--zoom-level', zoom);
      wrap.style.zoom = zoom;
      setTimeout(() => { window.focus(); window.print(); window.close(); }, 400);
    });
  <\/script>
</body>
</html>`);

    win.document.close();
  } catch (e) {
    console.error("printPreview error:", e);
    alert("❌ เกิดข้อผิดพลาดในการพิมพ์: " + e.message);
  }
}

function exportPDF() {
  printPreview();
}

async function saveAndClose() {
  await saveDraft();
  closePreview();
}

// =====================================================
// 📤 EXPORT CSV — ✅ แก้ไขให้ทำงานได้
// =====================================================
function exportCSV() {
  const d = collectFormData();
  if (!d) return;

  // ✅ ตรวจสอบว่ามีข้อมูลหรือไม่
  if (!d.rows || d.rows.length === 0) {
    alert("❌ ไม่มีข้อมูลให้ Export");
    return;
  }

  try {
    // ✅ สร้าง CSV headers
    const headers = ["วันที่", "เส้นทาง", "หมายเหตุ"];
    
    // ✅ สร้างแถวข้อมูล
    const rows = d.rows.map((r) => [
      r.date || "",
      escapeCsvField(r.route),
      escapeCsvField(r.note),
    ]);

    // ✅ รวมเป็น CSV string
    let csvContent = [
      headers.map(h => escapeCsvField(h)).join(","),
      ...rows.map(r => r.join(","))
    ].join("\n");

    // ✅ เพิ่มสรุปค่าใช้จ่าย
    csvContent += "\n\n";
    csvContent += "สรุปค่าใช้จ่าย\n";
    csvContent += `เบี้ยเลี้ยง,${d.allowanceRate} × ${d.allowanceDays} วัน,${d.allowanceRate * d.allowanceDays}\n`;
    csvContent += `ค่าที่พัก,${d.hotelRate} × ${d.hotelNights} คืน,${d.hotelRate * d.hotelNights}\n`;
    csvContent += `ค่าใช้จ่ายอื่นๆ,-,${d.otherCost}\n`;
    csvContent += `รวมทั้งหมด,,${d.grandTotal}\n`;

    // ✅ สร้าง Blob พร้อม BOM สำหรับ UTF-8
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    
    // ✅ สร้าง download link
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Actual_${d.emp}_${d.start || "nodate"}.csv`;
    
    // ✅ Trigger download
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // ✅ Cleanup
    URL.revokeObjectURL(url);
    
    alert("✅ Export CSV สำเร็จ");
  } catch (e) {
    console.error("exportCSV error:", e);
    alert("❌ Export ไม่สำเร็จ: " + e.message);
  }
}

// ✅ Helper function สำหรับ escape CSV field
function escapeCsvField(text) {
  if (text === null || text === undefined) return "";
  const str = String(text);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// =====================================================
// 📊 SUMMARY CALCULATION
// =====================================================
function calculateSummary() {
  const allowanceRate = parseFloat(document.getElementById("allowanceRate")?.value) || 0;
  const allowanceDays = parseFloat(document.getElementById("allowanceDays")?.value) || 0;
  const hotelRate = parseFloat(document.getElementById("hotelRate")?.value) || 0;
  const hotelNights = parseFloat(document.getElementById("hotelNights")?.value) || 0;
  const otherCost = parseFloat(document.getElementById("otherCost")?.value) || 0;

  const grandTotal = allowanceRate * allowanceDays + hotelRate * hotelNights + otherCost;
  const grandTotalEl = document.getElementById("grandTotal");
  if (grandTotalEl) grandTotalEl.value = grandTotal.toLocaleString("th-TH");
}

function setupSummaryCalculation() {
  ["allowanceRate", "allowanceDays", "hotelRate", "hotelNights", "otherCost"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", calculateSummary);
  });
}

console.log("✅ formActual.js loaded successfully");