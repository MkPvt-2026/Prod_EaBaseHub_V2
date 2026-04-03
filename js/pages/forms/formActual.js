// =====================================================
// formActual.js v2.3 — ใบเดินทางจริงและเคลียร์ค่าใช้จ่าย ๒
// + Tablet print fix + Fit 1 A4
// =====================================================
"use strict";

const STORAGE_KEY = "formActualDrafts";
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
  loadDraftListLocal();
  if (document.getElementById("tableBody").rows.length === 0) addRow();
  setupSummaryCalculation();
});

// =====================================================
// 👤 LOAD USER INFO
// =====================================================
async function loadUserInfo() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { window.location.href = "login.html"; return; }
    const el = document.getElementById("sidebarEmail");
    if (el) el.textContent = session.user.email;
    const { data: profile } = await supabaseClient.from("profiles").select("display_name, area").eq("id", session.user.id).single();
    const empEl = document.getElementById("empName");
    const zoneEl = document.getElementById("empZone");
    if (empEl) empEl.value = profile?.display_name || session.user.email;
    if (zoneEl) zoneEl.value = profile?.area || "";
  } catch (err) { console.error("❌ loadUserInfo:", err); }
}

// =====================================================
// 📋 CHECK LATEST PLAN
// =====================================================
async function checkLatestPlan() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return;
    const { data, error } = await supabaseClient.from("trips")
      .select("id, user_name, start_date, end_date, area, trips, status, created_at")
      .eq("user_id", session.user.id).order("created_at", { ascending: false }).limit(1);
    if (error || !data || data.length === 0) return;

    planData = data[0];
    currentPlanId = planData.id;

    const banner = document.getElementById("planBanner");
    const banTx = document.getElementById("planBannerText");
    const refInp = document.getElementById("refPlanId");
    if (refInp) refInp.value = planData.id;
    if (banner) banner.style.display = "flex";

    const fmtD = d => d ? new Date(d).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) : "";

    if (banTx) {
      // รองรับ format ใหม่ (object) และเก่า (array)
      let tripCount = 0;
      if (Array.isArray(planData.trips)) tripCount = planData.trips.length;
      else if (planData.trips?.rows) tripCount = planData.trips.rows.length;
      banTx.textContent = `พบแผนการเดินทาง (ฟอร์ม ๑) : ${fmtD(planData.start_date)}` +
        (planData.end_date ? ` – ${fmtD(planData.end_date)}` : "") + ` (${tripCount} แถว)`;
    }
  } catch (err) { console.error("❌ checkLatestPlan:", err); }
}

// =====================================================
// 📥 IMPORT FROM PLAN
// =====================================================
function importFromPlan() {
  if (!planData) { alert("ไม่พบข้อมูลแผน"); return; }

  // รองรับ format ใหม่ { rows, expense } และเก่า (array)
  let tripRows, expense = null;
  if (Array.isArray(planData.trips)) {
    tripRows = planData.trips;
  } else if (planData.trips && typeof planData.trips === "object") {
    tripRows = planData.trips.rows || [];
    expense = planData.trips.expense || null;
  } else {
    tripRows = [];
  }

  if (tripRows.length === 0) { alert("แผนนี้ยังไม่มีข้อมูลแถวเดินทาง"); return; }

  document.getElementById("tableBody").innerHTML = "";
  tripRows.forEach(t => {
    const parts = [t.from, t.to, t.shop1, t.shop2, t.shop3].filter(
      v => v && v.trim() && v !== "-" && v !== "จังหวัด" && v !== "ชื่อร้าน" && v !== ""
    );
    addRow(t.date || "", parts.join(" → "));
  });
  calcTotal();

  // Fill expense from new format
  if (expense) {
    if (expense.allowance_rate) document.getElementById("allowanceRate").value = expense.allowance_rate;
    if (expense.allowance_days) document.getElementById("allowanceDays").value = expense.allowance_days;
    if (expense.hotel_rate) document.getElementById("hotelRate").value = expense.hotel_rate;
    if (expense.hotel_nights) document.getElementById("hotelNights").value = expense.hotel_nights;
    if (expense.other_cost) document.getElementById("otherCost").value = expense.other_cost;
    calculateSummary();
  }

  const hint = document.getElementById("importHint");
  if (hint) hint.style.display = "flex";
  dismissBanner();
  alert(`✅ นำข้อมูล ${tripRows.length} แถวจากแผนมาแล้ว`);
}

// =====================================================
// 🔎 LOAD PLAN BY ID
// =====================================================
async function loadPlanById() {
  const id = document.getElementById("refPlanId")?.value?.trim();
  if (!id) { alert("กรุณากรอก Plan ID"); return; }
  try {
    const { data, error } = await supabaseClient.from("trips").select("id, user_name, start_date, end_date, area, trips, status").eq("id", id).single();
    if (error || !data) { alert("❌ ไม่พบแผน ID: " + id); return; }
    planData = data; currentPlanId = data.id;
    let tripCount = Array.isArray(data.trips) ? data.trips.length : (data.trips?.rows?.length || 0);
    const banner = document.getElementById("planBanner"), banTx = document.getElementById("planBannerText");
    if (banner) banner.style.display = "flex";
    if (banTx) banTx.textContent = `พบแผน ID: ${id.substring(0, 8)}... (${tripCount} แถว)`;
    alert(`✅ โหลดแผนสำเร็จ (${tripCount} แถว)`);
  } catch (err) { alert("❌ เกิดข้อผิดพลาด: " + err.message); }
}

// =====================================================
// 🗂️ LOAD ACTUAL DRAFT
// =====================================================
async function loadActualDraft() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return;
    const { data, error } = await supabaseClient.from("actuals")
      .select("id, ref_plan_id, start_date, end_date, rows, grand_total, status, allowance_rate, allowance_days, hotel_rate, hotel_nights, other_cost")
      .eq("user_id", session.user.id).eq("status", "draft").order("updated_at", { ascending: false }).limit(1);
    if (error || !data || data.length === 0) return;
    const draft = data[0];
    if (!Array.isArray(draft.rows) || draft.rows.length === 0) return;
    const fmtD = d => d ? new Date(d).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) : "-";
    if (!window.confirm(`พบ Draft\n${fmtD(draft.start_date)} – ${fmtD(draft.end_date)}\n${draft.rows.length} แถว\n\nโหลดต่อไหม?`)) return;
    actualId = draft.id; currentPlanId = draft.ref_plan_id || currentPlanId;
    const refInp = document.getElementById("refPlanId"); if (refInp && draft.ref_plan_id) refInp.value = draft.ref_plan_id;
    document.getElementById("tableBody").innerHTML = "";
    draft.rows.forEach(r => {
      addRow(r.date || "", r.route || "");
      const last = document.getElementById("tableBody").lastElementChild;
      const inp = last.querySelectorAll("input"); if (inp[2]) inp[2].value = r.note || "";
    });
    calcTotal();
    if (draft.allowance_rate !== undefined) {
      document.getElementById("allowanceRate").value = draft.allowance_rate || "";
      document.getElementById("allowanceDays").value = draft.allowance_days || "";
      document.getElementById("hotelRate").value = draft.hotel_rate || "";
      document.getElementById("hotelNights").value = draft.hotel_nights || "";
      document.getElementById("otherCost").value = draft.other_cost || "";
      calculateSummary();
    }
  } catch (err) { console.error("❌ loadActualDraft:", err); }
}

function dismissBanner() { const b = document.getElementById("planBanner"); if (b) b.style.display = "none"; }

// =====================================================
// ➕➖ ROWS
// =====================================================
function addRow(date, route) {
  const today = date || new Date().toISOString().split("T")[0];
  const tr = document.createElement("tr");
  const safeRoute = (route || "").replace(/"/g, "&quot;");
  tr.innerHTML = `<td><input type="date" value="${today}"></td><td><input type="text" value="${safeRoute}" placeholder="เส้นทาง / ร้านค้า"></td><td><input type="text" placeholder="หมายเหตุ"></td>`;
  document.getElementById("tableBody").appendChild(tr);
}
function deleteRow() { const t = document.getElementById("tableBody"); if (t.rows.length > 0) { t.deleteRow(-1); calcTotal(); } }

// =====================================================
// 🧮 CALC
// =====================================================
function calcTotal() {
  let total = 0;
  const rows = document.querySelectorAll("#tableBody tr");
  rows.forEach(r => { r.querySelectorAll("input[type='number']").forEach(inp => { total += Number(inp.value || 0); }); });
  const dEl = document.getElementById("days"), tEl = document.getElementById("total");
  if (dEl) dEl.textContent = rows.length;
  if (tEl) tEl.textContent = total.toLocaleString("th-TH", { minimumFractionDigits: 2 });
}

// =====================================================
// 📦 COLLECT
// =====================================================
function collectFormData() {
  const emp = document.getElementById("empName")?.value?.trim() || "";
  const zone = document.getElementById("empZone")?.value?.trim() || "";
  if (!emp) { alert("ไม่พบข้อมูลพนักงาน"); return null; }
  const rows = []; let firstDate = "", lastDate = "";
  document.querySelectorAll("#tableBody tr").forEach((tr, i) => {
    const inp = tr.querySelectorAll("input");
    const date = inp[0]?.value || "";
    if (i === 0) firstDate = date; lastDate = date;
    rows.push({ date, route: inp[1]?.value || "", note: inp[2]?.value || "" });
  });
  if (rows.length === 0) { alert("กรุณาเพิ่มข้อมูลอย่างน้อย 1 แถว"); return null; }
  const ar = parseFloat(document.getElementById("allowanceRate")?.value) || 0;
  const ad = parseFloat(document.getElementById("allowanceDays")?.value) || 0;
  const hr = parseFloat(document.getElementById("hotelRate")?.value) || 0;
  const hn = parseFloat(document.getElementById("hotelNights")?.value) || 0;
  const oc = parseFloat(document.getElementById("otherCost")?.value) || 0;
  return { emp, zone, start: firstDate, end: lastDate, rows, grandTotal: ar * ad + hr * hn + oc, allowanceRate: ar, allowanceDays: ad, hotelRate: hr, hotelNights: hn, otherCost: oc, refPlanId: currentPlanId || null };
}

// =====================================================
// 💾 DRAFT (localStorage)
// =====================================================
function saveDraftLocal(d) {
  const drafts = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  drafts.unshift({ id: Date.now(), ...d, savedAt: new Date().toISOString() });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
}
async function saveDraft() {
  const d = collectFormData(); if (!d) return;
  saveDraftLocal(d);
  alert("💾 บันทึก Draft ในเครื่องแล้ว");
  loadDraftListLocal();
}
function loadDraftListLocal() {
  const c = document.getElementById("draftList"); if (!c) return;
  const drafts = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  if (drafts.length === 0) { c.innerHTML = `<div style="color:#999">ไม่มี Draft</div>`; return; }
  c.innerHTML = "";
  drafts.forEach(d => {
    const el = document.createElement("div"); el.className = "draft-item";
    const dateText = d.start ? new Date(d.start).toLocaleDateString("th-TH") : "-";
    el.innerHTML = `<div><div>📅 ${dateText}</div><div style="font-size:12px;color:#666">${d.rows?.length || 0} แถว</div></div><div style="display:flex;gap:6px"><button onclick="loadDraftLocal(${d.id})">แก้ไข</button><button onclick="deleteDraftLocal(${d.id})">ลบ</button></div>`;
    c.appendChild(el);
  });
}
function loadDraftLocal(id) {
  const drafts = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  const d = drafts.find(x => x.id === id); if (!d) return;
  document.getElementById("tableBody").innerHTML = "";
  d.rows.forEach(r => { addRow(r.date, r.route); const last = document.getElementById("tableBody").lastElementChild; last.querySelectorAll("input")[2].value = r.note || ""; });
  document.getElementById("allowanceRate").value = d.allowanceRate || "";
  document.getElementById("allowanceDays").value = d.allowanceDays || "";
  document.getElementById("hotelRate").value = d.hotelRate || "";
  document.getElementById("hotelNights").value = d.hotelNights || "";
  document.getElementById("otherCost").value = d.otherCost || "";
  calculateSummary(); alert("✅ โหลด Draft แล้ว");
}
function deleteDraftLocal(id) {
  if (!confirm("ลบ Draft นี้?")) return;
  let drafts = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  drafts = drafts.filter(d => d.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  loadDraftListLocal();
}

// =====================================================
// ✅ SAVE COMPLETED
// =====================================================
async function saveAndClose() {
  const d = collectFormData(); if (!d) return;
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { alert("กรุณา Login ก่อน"); return; }
    const payload = { user_id: session.user.id, user_name: d.emp, ref_plan_id: d.refPlanId, zone: d.zone, start_date: d.start || null, end_date: d.end || null, rows: d.rows, grand_total: d.grandTotal, status: "completed", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), allowance_rate: d.allowanceRate, allowance_days: d.allowanceDays, hotel_rate: d.hotelRate, hotel_nights: d.hotelNights, other_cost: d.otherCost };
    const { error } = await supabaseClient.from("actuals").insert([payload]);
    if (error) throw error;
    alert("✅ บันทึกลงระบบเรียบร้อย"); closePreview();
  } catch (err) { alert("❌ บันทึกไม่สำเร็จ: " + err.message); }
}

// =====================================================
// 📊 SUMMARY
// =====================================================
function calculateSummary() {
  const ar = parseFloat(document.getElementById("allowanceRate")?.value) || 0;
  const ad = parseFloat(document.getElementById("allowanceDays")?.value) || 0;
  const hr = parseFloat(document.getElementById("hotelRate")?.value) || 0;
  const hn = parseFloat(document.getElementById("hotelNights")?.value) || 0;
  const oc = parseFloat(document.getElementById("otherCost")?.value) || 0;
  const el = document.getElementById("grandTotal");
  if (el) el.value = (ar * ad + hr * hn + oc).toLocaleString("th-TH");
}
function setupSummaryCalculation() {
  ["allowanceRate", "allowanceDays", "hotelRate", "hotelNights", "otherCost"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", calculateSummary);
  });
}

// =====================================================
// 🔍 PREVIEW — ✅ FIT 1 A4
// =====================================================
function openPreview() {
  const d = collectFormData(); if (!d) return;
  const fd = s => { if (!s) return "-"; const [y, m, day] = s.split("-"); return `${day}/${m}/${y}`; };
  const fm = n => Number(n).toLocaleString("th-TH", { minimumFractionDigits: 2 });

  let tRows = "";
  d.rows.forEach((r, i) => {
    const bg = i % 2 === 1 ? ' style="background:#f7f9fb"' : "";
    tRows += `<tr${bg}><td>${fd(r.date)}</td><td style="text-align:left;padding-left:6px">${r.route || "-"}</td><td style="text-align:left;padding-left:4px">${r.note || ""}</td></tr>`;
  });

  const ta = d.allowanceRate * d.allowanceDays, th = d.hotelRate * d.hotelNights;
  const today = new Date().toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" });
  const planRef = d.refPlanId ? `<div><span class="ml">อ้างอิงแผน :</span>${d.refPlanId.substring(0, 8)}...</div>` : "";

  document.getElementById("previewContent").innerHTML = `
<style>
.dw{font-family:'Kanit',sans-serif;font-size:11px;color:#1a1a1a;line-height:1.4}
.dc{text-align:center;margin-bottom:2px}
.dc .cn{font-size:14px;font-weight:700}.dc .tt{font-size:12px;font-weight:600;margin-top:1px}
hr.dv{border:none;border-top:1.5px solid #1a1a1a;margin:4px 0 8px}
.dpd{text-align:right;font-size:9px;color:#777;margin-bottom:4px}
.dm{display:grid;grid-template-columns:1fr 1fr;border:1px solid #bbb;border-radius:3px;margin-bottom:8px;overflow:hidden}
.dmc{padding:4px 10px;font-size:11px;line-height:1.7}.dmc:first-child{border-right:1px solid #bbb}
.ml{font-weight:700;color:#444;margin-right:3px}
.dt{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:10px}
.dt th{background:#e8f5f4;color:#1a5550;padding:4px 5px;text-align:center;border:1px solid #b2d8d5;font-size:10px;font-weight:700}
.dt td{padding:4px 5px;border:1px solid #ccc;text-align:center;font-size:10px}
.st{font-size:11px;font-weight:700;margin-bottom:4px;padding-bottom:2px;border-bottom:1.5px solid #1a6b64;display:flex;align-items:center;gap:4px}
.st::before{content:'';display:inline-block;width:3px;height:12px;background:#3FB7AE;border-radius:2px}
.ct{width:55%;margin-left:auto;margin-bottom:12px;border-collapse:collapse;font-size:10.5px}
.ct td,.ct th{border:1px solid #ccc;padding:3px 8px}
.ct td:first-child{font-weight:600;color:#333}.ct td:nth-child(2){text-align:center;color:#555}.ct td:last-child{text-align:right}
.ct .tr th{background:#e8f5f4;color:#1a5550;text-align:right;padding:4px 8px;font-size:11px;border:1px solid #b2d8d5;font-weight:700}
.sg{margin-top:20px;display:grid;grid-template-columns:repeat(4,1fr);gap:16px;text-align:center}
.sb{font-size:10px;line-height:1.6}.sl{border-top:1px solid #555;padding-top:8px;margin-top:36px}
.sn{font-weight:600}.sr{color:#555}
</style>
<div class="dw">
  <div class="dpd">วันที่พิมพ์: ${today}</div>
  <div class="dc"><div class="cn">บริษัท เอิร์นนี่ แอดวานซ์ จำกัด</div><div class="tt">ใบเดินทางจริงและเคลียร์ค่าใช้จ่าย ๒</div></div>
  <hr class="dv">
  <div class="dm"><div class="dmc"><div><span class="ml">พนักงานขาย :</span>${d.emp}</div><div><span class="ml">เขตการขาย :</span>${d.zone || "-"}</div>${planRef}</div><div class="dmc"><div><span class="ml">ระหว่างวันที่ :</span>${fd(d.start)}</div><div><span class="ml">ถึงวันที่ :</span>${fd(d.end)}</div><div><span class="ml">จำนวน :</span>${d.rows.length} วัน</div></div></div>
  <table class="dt"><thead><tr><th style="width:80px">ว/ด/ป</th><th>เส้นทางจริง</th><th style="width:100px">หมายเหตุ</th></tr></thead><tbody>${tRows || '<tr><td colspan="3" style="text-align:center;color:#999;padding:10px">ไม่มีข้อมูล</td></tr>'}</tbody></table>
  <div class="st">สรุปค่าใช้จ่าย</div>
  <table class="ct">
    <tr><td>เบี้ยเลี้ยง</td><td>${fm(d.allowanceRate)} × ${d.allowanceDays} วัน</td><td>${fm(ta)} บาท</td></tr>
    <tr><td>ค่าที่พัก</td><td>${fm(d.hotelRate)} × ${d.hotelNights} คืน</td><td>${fm(th)} บาท</td></tr>
    <tr><td>อื่นๆ</td><td style="text-align:center">–</td><td>${fm(d.otherCost)} บาท</td></tr>
    <tr class="tr"><th colspan="2">รวมเบิกทั้งหมด</th><th style="font-size:12px">${fm(d.grandTotal)} บาท</th></tr>
  </table>
  <div class="sg">
    <div class="sb"><div class="sl"><div class="sn">(${d.emp})</div><div class="sr">พนักงานขาย</div></div></div>
    <div class="sb"><div class="sl"><div class="sn">(..................................)</div><div class="sr">ผจก.ฝ่ายขาย</div></div></div>
    <div class="sb"><div class="sl"><div class="sn">(..................................)</div><div class="sr">ฝ่ายบัญชี</div></div></div>
    <div class="sb"><div class="sl"><div class="sn">(..................................)</div><div class="sr">ผู้อนุมัติ</div></div></div>
  </div>
</div>`;
  document.getElementById("previewModal").style.display = "flex";
}

function closePreview() { document.getElementById("previewModal").style.display = "none"; }

// =====================================================
// 🖨️ PRINT — ✅ TABLET + FIT A4
// =====================================================
function buildFullPageHTML(body) {
  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>ใบเดินทางจริง</title>
<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;background:#fff;font-family:'Kanit',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
#print-wrap{width:100%;padding:6mm 8mm;max-width:210mm;margin:0 auto}
.no-print{margin:12px auto;text-align:center;padding:10px}
.no-print button{font-family:'Kanit',sans-serif;font-size:16px;font-weight:600;padding:14px 32px;margin:6px;border-radius:12px;cursor:pointer;border:none;color:#fff;min-width:160px;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.btn-print{background:#1D9E75}.btn-close{background:#64748b}
@media print{
  @page{size:A4 portrait;margin:6mm 8mm}
  html,body{width:210mm}
  #print-wrap{padding:0;max-width:none}
  .no-print{display:none!important}
}
.dt th{background:#e8f5f4!important;color:#1a5550!important;border:1px solid #b2d8d5!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.ct .tr th{background:#e8f5f4!important;color:#1a5550!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sl{border-top:1px solid #555;padding-top:8px;margin-top:36px}
</style></head><body>
<div class="no-print">
  <button class="btn-print" onclick="window.print()">🖨 พิมพ์ / Save PDF</button>
  <button class="btn-close" onclick="window.close()">✖ ปิดหน้านี้</button>
</div>
<div id="print-wrap">${body}</div>
</body></html>`;
}

function printPreview() {
  const content = document.getElementById("previewContent")?.innerHTML;
  if (!content || content.trim() === "") { alert("❌ กรุณากด Preview ก่อน"); return; }
  const full = buildFullPageHTML(content);
  // ✅ เปิด Tab ใหม่ — รองรับ Tablet
  const w = window.open("", "_blank");
  if (w) { w.document.open(); w.document.write(full); w.document.close(); }
  else {
    const blob = new Blob([full], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}
function exportPDF() { printPreview(); }

// =====================================================
// 📤 CSV
// =====================================================
function exportCSV() {
  const d = collectFormData(); if (!d || !d.rows.length) { alert("❌ ไม่มีข้อมูล"); return; }
  try {
    const esc = t => { if (t == null) return ""; const s = String(t); return (s.includes(",") || s.includes('"') || s.includes("\n")) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    let csv = "วันที่,เส้นทาง,หมายเหตุ\n";
    d.rows.forEach(r => { csv += [r.date || "", esc(r.route), esc(r.note)].join(",") + "\n"; });
    csv += `\nสรุปค่าใช้จ่าย\nเบี้ยเลี้ยง,${d.allowanceRate}×${d.allowanceDays}วัน,${d.allowanceRate * d.allowanceDays}\nค่าที่พัก,${d.hotelRate}×${d.hotelNights}คืน,${d.hotelRate * d.hotelNights}\nอื่นๆ,-,${d.otherCost}\nรวม,,${d.grandTotal}\n`;
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = `Actual_${d.emp}_${d.start || "nodate"}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    alert("✅ Export CSV สำเร็จ");
  } catch (e) { alert("❌ " + e.message); }
}

console.log("✅ formActual.js v2.3 loaded");