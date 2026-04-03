// =====================================================
// formPlan.js v3.3 — localStorage Draft + Supabase Completed
// + Tablet print + Fit 1 A4 + จัดกลาง ไม่ล้นขอบ
// =====================================================
"use strict";

let trips = [];
let currentDraftKey = null;
let currentPlanId = null;
let myShops = [];
const DRAFT_PREFIX = "formPlan_draft_";

// =====================================================
// 🚀 INIT
// =====================================================
document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 FormPlan v3.3 loaded");
  if (typeof supabaseClient === "undefined") { alert("❌ ระบบยังไม่พร้อม"); return; }
  const ok = await checkAuthorization();
  if (!ok) return;
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
    if (typeof protectPage === "function") { await protectPage(["admin","sales","manager","user"]); }
    else { const{data:{session}}=await supabaseClient.auth.getSession(); if(!session){alert("❌ กรุณา Login ก่อน");window.location.href="login.html";return false;} }
    return true;
  } catch(e){console.error("❌ Auth:",e);return false;}
}

// =====================================================
// 👤 USER
// =====================================================
async function initUserInfo() {
  if (typeof initUserService==="function") {
    await initUserService();
    if (typeof autoFillUserData==="function") autoFillUserData({display_name:"empName",area:"area",readonly:["empName","area"]});
  } else await loadUserInfoBasic();
}
async function loadUserInfoBasic() {
  try {
    const{data:{session}}=await supabaseClient.auth.getSession(); if(!session)return;
    const{data:p}=await supabaseClient.from("profiles").select("display_name,area").eq("id",session.user.id).maybeSingle();
    const se=document.getElementById("sidebarEmail"); if(se) se.textContent=session.user.email;
    const en=document.getElementById("empName"); if(en){en.value=p?.display_name||session.user.email;en.readOnly=true;}
    const ai=document.getElementById("area"); if(ai){ai.value=p?.area||"";ai.readOnly=true;}
  }catch(e){console.error("❌ loadUserInfoBasic:",e);}
}

// =====================================================
// 🏪 SHOPS
// =====================================================
function updateShopCount(){const el=document.getElementById("shopCount");if(el)el.textContent=myShops.length;}
async function loadMyShops() {
  const{data:{session},error:se}=await supabaseClient.auth.getSession(); if(se||!session)return;
  const{data:p,error:pe}=await supabaseClient.from("profiles").select("role,area").eq("id",session.user.id).maybeSingle(); if(pe)return;
  let q=supabaseClient.from("shops").select("*").eq("status","Active");
  if(p.role==="sales")q=q.eq("sale_id",session.user.id); else if(p.role==="manager")q=q.eq("province",p.area);
  const{data,error}=await q; if(error)return;
  myShops=data||[]; updateShopCount();
}

// =====================================================
// 📅 DATES
// =====================================================
function setDefaultDates(){
  const t=new Date();
  const s=document.getElementById("startDate"); if(s&&!s.value)s.valueAsDate=t;
  const e=document.getElementById("endDate"); if(e&&!e.value){const n=new Date(t);n.setDate(n.getDate()+7);e.valueAsDate=n;}
}
function setupEventListeners(){document.getElementById("startDate")?.addEventListener("change",updateEndDate);}
function updateEndDate(){const v=document.getElementById("startDate")?.value,e=document.getElementById("endDate");if(v&&e){const d=new Date(v);d.setDate(d.getDate()+7);e.valueAsDate=d;}}

// =====================================================
// ➕ TABLE
// =====================================================
function addRow(){
  const tbody=document.getElementById("tripTableBody"),row=document.createElement("tr");
  row.innerHTML=`<td><input type="date" class="trip-date"></td><td><select class="from-province">${generateProvinceOptions()}</select></td><td><select class="to-province" onchange="handleProvinceChange(this)">${generateProvinceOptions()}</select></td><td><select class="shop1"><option value="">ชื่อร้าน</option></select></td><td><select class="shop2"><option value="">ชื่อร้าน</option></select></td><td><select class="shop3"><option value="">ชื่อร้าน</option></select></td><td><input type="text" class="note" placeholder="หมายเหตุ"></td>`;
  tbody.appendChild(row);
}
function removeRow(){const t=document.getElementById("tripTableBody");if(t.rows.length>0)t.deleteRow(-1);}
function generateProvinceOptions(sel=""){
  const p=[...new Set(myShops.map(s=>s.province))].sort();
  let h=`<option value="">จังหวัด</option>`;p.forEach(v=>{h+=`<option value="${v}"${v===sel?" selected":""}>${v}</option>`;});return h;
}
function generateShopOptions(prov="",selId="",selName=""){
  let h=`<option value="">ชื่อร้าน</option>`;
  const s=prov?myShops.filter(x=>x.province===prov):[];
  if(s.length>0)s.forEach(x=>{h+=`<option value="${x.id}"${x.id===selId?" selected":""}>${x.shop_name}</option>`;});
  else if(selId&&selName)h+=`<option value="${selId}" selected>${selName}</option>`;
  return h;
}
function handleProvinceChange(sel){
  const prov=sel.value,row=sel.closest("tr"),shops=myShops.filter(s=>s.province===prov);
  const opts=shops.map(s=>`<option value="${s.id}">${s.shop_name}</option>`).join("");
  ["shop1","shop2","shop3"].forEach(c=>{row.querySelector(`.${c}`).innerHTML=`<option value="">ชื่อร้าน</option>`+opts;});
}

// =====================================================
// 📦 COLLECT
// =====================================================
function collectTableData(){
  const rows=document.querySelectorAll("#tripTableBody tr"); trips=[];
  rows.forEach(r=>{trips.push({date:r.querySelector(".trip-date")?.value||"",from:r.querySelector(".from-province")?.value||"",to:r.querySelector(".to-province")?.value||"",shop1:r.querySelector(".shop1")?.selectedOptions?.[0]?.text||"",shop2:r.querySelector(".shop2")?.selectedOptions?.[0]?.text||"",shop3:r.querySelector(".shop3")?.selectedOptions?.[0]?.text||"",shop1Id:r.querySelector(".shop1")?.value||"",shop2Id:r.querySelector(".shop2")?.value||"",shop3Id:r.querySelector(".shop3")?.value||"",note:r.querySelector(".note")?.value||""});});
  return trips;
}
function collectSummaryData(){return{allowance_rate:parseFloat(document.getElementById("allowanceRate")?.value)||0,allowance_days:parseFloat(document.getElementById("allowanceDays")?.value)||0,hotel_rate:parseFloat(document.getElementById("hotelRate")?.value)||0,hotel_nights:parseFloat(document.getElementById("hotelNights")?.value)||0,other_cost:parseFloat(document.getElementById("otherCost")?.value)||0};}
function buildTripsPayload(){collectTableData();return{rows:trips,expense:collectSummaryData()};}
function restoreFromTripsPayload(payload){
  let tripRows=[],expense=null;
  if(Array.isArray(payload)){tripRows=payload;}else if(payload&&typeof payload==="object"){tripRows=payload.rows||[];expense=payload.expense||null;}
  const tbody=document.getElementById("tripTableBody");tbody.innerHTML="";
  tripRows.forEach(t=>{const row=document.createElement("tr");row.innerHTML=`<td><input type="date" class="trip-date" value="${t.date||""}"></td><td><select class="from-province">${generateProvinceOptions(t.from)}</select></td><td><select class="to-province" onchange="handleProvinceChange(this)">${generateProvinceOptions(t.to)}</select></td><td><select class="shop1">${generateShopOptions(t.to,t.shop1Id,t.shop1)}</select></td><td><select class="shop2">${generateShopOptions(t.to,t.shop2Id,t.shop2)}</select></td><td><select class="shop3">${generateShopOptions(t.to,t.shop3Id,t.shop3)}</select></td><td><input type="text" class="note" value="${t.note||""}" placeholder="หมายเหตุ"></td>`;tbody.appendChild(row);});
  trips=tripRows;
  if(expense){if(expense.allowance_rate)document.getElementById("allowanceRate").value=expense.allowance_rate;if(expense.allowance_days)document.getElementById("allowanceDays").value=expense.allowance_days;if(expense.hotel_rate)document.getElementById("hotelRate").value=expense.hotel_rate;if(expense.hotel_nights)document.getElementById("hotelNights").value=expense.hotel_nights;if(expense.other_cost)document.getElementById("otherCost").value=expense.other_cost;calculateSummary();}
}

// =====================================================
// 💾 LOCAL DRAFT
// =====================================================
function generateDraftKey(){return DRAFT_PREFIX+Date.now()+"_"+Math.random().toString(36).slice(2,8);}
function getAllLocalDrafts(){
  const d=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k.startsWith(DRAFT_PREFIX)){try{const v=JSON.parse(localStorage.getItem(k));v._key=k;d.push(v);}catch(e){}}}
  d.sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));return d;
}
function saveDraftToLocal(){
  collectTableData();const s=collectSummaryData();
  const dd={user_name:document.getElementById("empName")?.value||"",area:document.getElementById("area")?.value||"",start_date:document.getElementById("startDate")?.value||"",end_date:document.getElementById("endDate")?.value||"",trips,expense:s,created_at:currentDraftKey?(JSON.parse(localStorage.getItem(currentDraftKey))?.created_at||new Date().toISOString()):new Date().toISOString(),updated_at:new Date().toISOString()};
  if(!currentDraftKey)currentDraftKey=generateDraftKey();
  localStorage.setItem(currentDraftKey,JSON.stringify(dd));
  showNotification("💾 บันทึก Draft เรียบร้อย","success");loadLocalDraftList();
}
function loadLocalDraftById(key){
  try{
    const raw=localStorage.getItem(key);if(!raw){alert("ไม่พบ Draft");return;}
    const d=JSON.parse(raw);currentDraftKey=key;currentPlanId=null;
    if(d.start_date)document.getElementById("startDate").value=d.start_date;
    if(d.end_date)document.getElementById("endDate").value=d.end_date;
    const ai=document.getElementById("area");if(ai&&d.area)ai.value=d.area;
    const tbody=document.getElementById("tripTableBody");tbody.innerHTML="";
    if(Array.isArray(d.trips)&&d.trips.length>0){d.trips.forEach(t=>{const row=document.createElement("tr");row.innerHTML=`<td><input type="date" class="trip-date" value="${t.date||""}"></td><td><select class="from-province">${generateProvinceOptions(t.from)}</select></td><td><select class="to-province" onchange="handleProvinceChange(this)">${generateProvinceOptions(t.to)}</select></td><td><select class="shop1">${generateShopOptions(t.to,t.shop1Id,t.shop1)}</select></td><td><select class="shop2">${generateShopOptions(t.to,t.shop2Id,t.shop2)}</select></td><td><select class="shop3">${generateShopOptions(t.to,t.shop3Id,t.shop3)}</select></td><td><input type="text" class="note" value="${t.note||""}" placeholder="หมายเหตุ"></td>`;tbody.appendChild(row);});trips=d.trips;}
    if(d.expense){if(d.expense.allowance_rate)document.getElementById("allowanceRate").value=d.expense.allowance_rate;if(d.expense.allowance_days)document.getElementById("allowanceDays").value=d.expense.allowance_days;if(d.expense.hotel_rate)document.getElementById("hotelRate").value=d.expense.hotel_rate;if(d.expense.hotel_nights)document.getElementById("hotelNights").value=d.expense.hotel_nights;if(d.expense.other_cost)document.getElementById("otherCost").value=d.expense.other_cost;calculateSummary();}
    highlightDraftCard(key);document.querySelector(".section")?.scrollIntoView({behavior:"smooth"});
    showNotification("✅ โหลด Draft เรียบร้อย","success");
  }catch(e){alert("❌ โหลดไม่สำเร็จ: "+e.message);}
}
function deleteLocalDraft(key){if(!confirm("ต้องการลบ Draft นี้?"))return;localStorage.removeItem(key);if(currentDraftKey===key)currentDraftKey=null;loadLocalDraftList();}

// =====================================================
// 📋 DRAFT LIST UI
// =====================================================
function loadLocalDraftList(){
  const c=document.getElementById("localDraftList"),b=document.getElementById("localDraftCountBadge");if(!c)return;
  const drafts=getAllLocalDrafts();if(b)b.textContent=`${drafts.length} รายการ`;
  if(drafts.length===0){c.innerHTML=`<div style="text-align:center;padding:32px;color:#aaa;font-size:13px;border:1px dashed #ddd;border-radius:12px;">ยังไม่มี Draft ในเครื่อง</div>`;return;}
  c.innerHTML=drafts.map(plan=>{
    const key=plan._key,rc=Array.isArray(plan.trips)?plan.trips.length:0,sf=formatDateTH(plan.start_date),ef=formatDateTH(plan.end_date),uf=formatDateTimeTH(plan.updated_at);
    const exp=plan.expense||{},tot=((exp.allowance_rate||0)*(exp.allowance_days||0))+((exp.hotel_rate||0)*(exp.hotel_nights||0))+(exp.other_cost||0),tf=tot>0?tot.toLocaleString("th-TH")+" บาท":"";
    return`<div id="ldraft-${key}" class="draft-card" style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin-bottom:8px;display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;cursor:pointer;transition:.15s;" onclick="highlightDraftCard('${key}')" onmouseenter="this.style.borderColor='#EF9F27';this.style.background='#fffdf7'" onmouseleave="if(!this.classList.contains('selected')){this.style.borderColor='#e2e8f0';this.style.background='#fff'}"><div><div style="font-weight:700;font-size:14px;color:#1e293b;margin-bottom:3px">${plan.user_name||"-"} — ${plan.area||"-"}</div><div style="font-size:12px;color:#64748b;margin-bottom:6px;display:flex;gap:12px;flex-wrap:wrap"><span>📅 ${sf}–${ef}</span><span>·</span><span>${rc} แถว</span>${tf?`<span>·</span><span>💰 ${tf}</span>`:""}<span>·</span><span>${uf}</span></div><span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:2px 8px;border-radius:999px;background:#FAEEDA;color:#633806;border:1px solid #EF9F27"><span style="width:6px;height:6px;border-radius:50%;background:#EF9F27;display:inline-block"></span>Draft (Local)</span></div><div style="display:flex;gap:6px;flex-shrink:0"><button type="button" onclick="event.stopPropagation();loadLocalDraftById('${key}')" style="background:#FAEEDA;color:#633806;border:1px solid #EF9F27;border-radius:8px;padding:7px 14px;font-size:13px;cursor:pointer;font-weight:600;font-family:inherit">✏️ โหลดแก้ไข</button><button type="button" onclick="event.stopPropagation();deleteLocalDraft('${key}')" style="background:none;border:1px solid #fca5a5;border-radius:8px;padding:7px 10px;font-size:13px;cursor:pointer;color:#dc2626;font-family:inherit">🗑</button></div></div>`;
  }).join("");
}
function highlightDraftCard(key){
  document.querySelectorAll('[id^="ldraft-"],[id^="cdraft-"]').forEach(el=>{el.style.borderColor="#e2e8f0";el.style.background="#fff";el.style.borderWidth="1px";el.classList.remove("selected");});
  const card=document.getElementById(`ldraft-${key}`);if(card){card.style.borderColor="#EF9F27";card.style.borderWidth="1.5px";card.style.background="#fffdf7";card.classList.add("selected");}
}

// =====================================================
// 💾 COMPLETED → SUPABASE
// =====================================================
async function saveCompletedToDatabase(){
  try{
    const{userId,userName,userZone}=await getCurrentUserInfo();if(!userId)return;
    const tp=buildTripsPayload();if(!tp.rows||tp.rows.length===0){alert("❌ กรุณาเพิ่มข้อมูลแผนก่อน");return;}
    if(!confirm("ยืนยันบันทึกแผนนี้เข้าระบบ?"))return;
    const pd={user_id:userId,user_name:userName,start_date:document.getElementById("startDate")?.value,end_date:document.getElementById("endDate")?.value,area:document.getElementById("area")?.value||userZone,trips:tp,status:"completed",created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
    const{data,error}=await supabaseClient.from("trips").insert([pd]).select();if(error)throw error;
    if(data?.length>0)currentPlanId=data[0].id;
    if(currentDraftKey){localStorage.removeItem(currentDraftKey);currentDraftKey=null;loadLocalDraftList();}
    showNotification("✅ บันทึกแผนสำเร็จ!","success");await loadCompletedList();closePreview();
  }catch(e){alert("❌ บันทึกไม่สำเร็จ: "+e.message);}
}

// =====================================================
// 📋 COMPLETED LIST
// =====================================================
async function loadCompletedList(){
  const c=document.getElementById("completedList"),b=document.getElementById("completedCountBadge");if(!c)return;
  c.innerHTML=`<p style="text-align:center;color:#aaa;padding:20px 0;font-size:13px">กำลังโหลด...</p>`;
  try{
    const uid=await getCurrentUserId();if(!uid)return;
    const{data,error}=await supabaseClient.from("trips").select("id,user_name,area,start_date,end_date,status,trips,created_at,updated_at").eq("user_id",uid).order("updated_at",{ascending:false});
    if(error)throw error;
    if(!data||data.length===0){if(b)b.textContent="0 รายการ";c.innerHTML=`<div style="text-align:center;padding:32px;color:#aaa;font-size:13px;border:1px dashed #ddd;border-radius:12px">ยังไม่มีแผนในระบบ</div>`;return;}
    if(b)b.textContent=`${data.length} รายการ`;
    c.innerHTML=data.map(plan=>{
      let rc=0,tf="";if(Array.isArray(plan.trips))rc=plan.trips.length;else if(plan.trips&&typeof plan.trips==="object"){rc=Array.isArray(plan.trips.rows)?plan.trips.rows.length:0;const exp=plan.trips.expense||{};const tot=((exp.allowance_rate||0)*(exp.allowance_days||0))+((exp.hotel_rate||0)*(exp.hotel_nights||0))+(exp.other_cost||0);if(tot>0)tf=tot.toLocaleString("th-TH")+" บาท";}
      const sf=formatDateTH(plan.start_date),ef=formatDateTH(plan.end_date),uf=formatDateTimeTH(plan.updated_at);
      const sb=plan.status==="completed"?`<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:2px 8px;border-radius:999px;background:#E1F5EE;color:#085041;border:1px solid #1D9E75"><span style="width:6px;height:6px;border-radius:50%;background:#1D9E75;display:inline-block"></span>Completed</span>`:`<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:2px 8px;border-radius:999px;background:#FAEEDA;color:#633806;border:1px solid #EF9F27"><span style="width:6px;height:6px;border-radius:50%;background:#EF9F27;display:inline-block"></span>${plan.status}</span>`;
      return`<div id="cdraft-${plan.id}" style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin-bottom:8px;display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;cursor:pointer;transition:.15s" onmouseenter="this.style.borderColor='#1D9E75';this.style.background='#f4fcfa'" onmouseleave="this.style.borderColor='#e2e8f0';this.style.background='#fff'"><div><div style="font-weight:700;font-size:14px;color:#1e293b;margin-bottom:3px">${plan.user_name||"-"} — ${plan.area||"-"}</div><div style="font-size:12px;color:#64748b;margin-bottom:6px;display:flex;gap:12px;flex-wrap:wrap"><span>📅 ${sf}–${ef}</span><span>·</span><span>${rc} แถว</span>${tf?`<span>·</span><span>💰 ${tf}</span>`:""}<span>·</span><span>${uf}</span></div><div>${sb}</div></div><div style="display:flex;gap:6px;flex-shrink:0"><button type="button" onclick="event.stopPropagation();loadCompletedById('${plan.id}')" style="background:#e8f5f4;color:#0f6e56;border:1px solid #5DCAA5;border-radius:8px;padding:7px 14px;font-size:13px;cursor:pointer;font-weight:600;font-family:inherit">👁 ดูข้อมูล</button><button type="button" onclick="event.stopPropagation();deleteCompletedById('${plan.id}')" style="background:none;border:1px solid #fca5a5;border-radius:8px;padding:7px 10px;font-size:13px;cursor:pointer;color:#dc2626;font-family:inherit">🗑</button></div></div>`;
    }).join("");
  }catch(e){c.innerHTML=`<p style="color:red;text-align:center">โหลดไม่สำเร็จ: ${e.message}</p>`;}
}
async function loadCompletedById(id){
  try{const{data,error}=await supabaseClient.from("trips").select("*").eq("id",id).maybeSingle();if(error)throw error;if(!data){alert("ไม่พบข้อมูล");return;}
  currentPlanId=data.id;currentDraftKey=null;
  if(data.start_date)document.getElementById("startDate").value=data.start_date;
  if(data.end_date)document.getElementById("endDate").value=data.end_date;
  const ai=document.getElementById("area");if(ai&&data.area)ai.value=data.area;
  restoreFromTripsPayload(data.trips);document.querySelector(".section")?.scrollIntoView({behavior:"smooth"});showNotification("✅ โหลดข้อมูลเรียบร้อย","success");
  }catch(e){alert("❌ โหลดไม่สำเร็จ: "+e.message);}
}
async function deleteCompletedById(id){
  if(!confirm("ต้องการลบแผนนี้?"))return;
  try{const{error}=await supabaseClient.from("trips").delete().eq("id",id);if(error)throw error;if(currentPlanId===id)currentPlanId=null;showNotification("✅ ลบเรียบร้อย","success");await loadCompletedList();}catch(e){alert("❌ ลบไม่สำเร็จ: "+e.message);}
}

// =====================================================
// 📊 SUMMARY
// =====================================================
function calculateSummary(){
  const ar=parseFloat(document.getElementById("allowanceRate")?.value)||0,ad=parseFloat(document.getElementById("allowanceDays")?.value)||0,hr=parseFloat(document.getElementById("hotelRate")?.value)||0,hn=parseFloat(document.getElementById("hotelNights")?.value)||0,oc=parseFloat(document.getElementById("otherCost")?.value)||0;
  document.getElementById("grandTotal").value=((ar*ad)+(hr*hn)+oc).toLocaleString("th-TH");
}
function setupSummaryCalculation(){["allowanceRate","allowanceDays","hotelRate","hotelNights","otherCost"].forEach(id=>{document.getElementById(id)?.addEventListener("input",calculateSummary);});}

// =====================================================
// 🔍 PREVIEW — ✅ FIT 1 A4 + จัดกลาง
// =====================================================
function buildPreviewHTML(){
  collectTableData();
  const fd=d=>{if(!d)return"-";const[y,m,day]=d.split("-");return`${day}/${m}/${y}`;};
  let tRows="";
  trips.forEach((t,i)=>{const bg=i%2===0?"":'style="background:#f7f9fb"';tRows+=`<tr ${bg}><td>${fd(t.date)}</td><td>${t.from||"-"}</td><td>${t.to||"-"}</td><td>${t.shop1||"-"}</td><td>${t.shop2||"-"}</td><td>${t.shop3||"-"}</td><td style="text-align:left;padding-left:4px">${t.note||""}</td></tr>`;});
  if(!tRows)tRows=`<tr><td colspan="7" style="text-align:center;color:#999;padding:10px">ไม่มีข้อมูล</td></tr>`;
  const ar=parseFloat(document.getElementById("allowanceRate")?.value)||0,ad=parseFloat(document.getElementById("allowanceDays")?.value)||0,hr=parseFloat(document.getElementById("hotelRate")?.value)||0,hn=parseFloat(document.getElementById("hotelNights")?.value)||0,oc=parseFloat(document.getElementById("otherCost")?.value)||0;
  const ta=ar*ad,th=hr*hn,gt=ta+th+oc;
  const fm=n=>n.toLocaleString("th-TH",{minimumFractionDigits:2});
  const emp=document.getElementById("empName")?.value||"-",area=document.getElementById("area")?.value||"-";
  const st=fd(document.getElementById("startDate")?.value),en=fd(document.getElementById("endDate")?.value);
  const pd=new Date().toLocaleDateString("th-TH",{year:"numeric",month:"long",day:"numeric"});
  return`
<style>
.dw{font-family:'Kanit',sans-serif;font-size:11px;color:#1a1a1a;line-height:1.35}
.dc{text-align:center;margin-bottom:2px}
.dc .cn{font-size:14px;font-weight:700}.dc .tt{font-size:12px;font-weight:600;margin-top:1px}
hr.dv{border:none;border-top:1.5px solid #1a1a1a;margin:4px 0 8px}
.dm{display:grid;grid-template-columns:1fr 1fr;border:1px solid #999;border-radius:3px;margin-bottom:8px;overflow:hidden}
.dmc{padding:4px 10px;font-size:10.5px;line-height:1.6}.dmc:first-child{border-right:1px solid #999}
.ml{font-weight:700;color:#444;margin-right:3px}
.dt{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:9.5px;table-layout:fixed}
.dt th{background:#e8f5f4;color:#1a5550;padding:4px 2px;text-align:center;font-weight:700;font-size:9.5px;border:1px solid #b2d8d5}
.dt td{padding:2px 2px;text-align:center;border:1px solid #ccc;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.st{font-size:11px;font-weight:700;margin-bottom:3px;padding-bottom:2px;border-bottom:1.5px solid #b2d8d5;display:flex;align-items:center;gap:4px}
.st::before{content:'';display:inline-block;width:3px;height:12px;background:#7ec8c3;border-radius:2px}
.ct{width:50%;margin-left:auto;margin-bottom:10px;border-collapse:collapse;font-size:10px}
.ct td,.ct th{border:1px solid #ccc;padding:2px 6px}
.ct td:first-child{font-weight:600;color:#333}.ct td:nth-child(2){text-align:center;color:#555}.ct td:last-child{text-align:right}
.ct .tr th{background:#e8f5f4;color:#1a5550;text-align:right;padding:3px 6px;font-size:11px;border:1px solid #b2d8d5;font-weight:700}
.sg{margin-top:16px;display:grid;grid-template-columns:repeat(4,1fr);gap:12px;text-align:center}
.sb{font-size:9.5px;line-height:1.5}.sl{border-top:1px solid #555;padding-top:6px;margin-top:30px}
.sn{font-weight:600}.sr{color:#555}
.dpd{text-align:right;font-size:9px;color:#777;margin-bottom:3px}
</style>
<div class="dw">
  <div class="dpd">วันที่พิมพ์: ${pd}</div>
  <div class="dc"><div class="cn">บริษัท เอิร์นนี่ แอดวานซ์ จำกัด</div><div class="tt">แผนการเดินทางและเบิกทดลองจ่าย ๑</div></div>
  <hr class="dv">
  <div class="dm"><div class="dmc"><div><span class="ml">พนักงานขาย :</span>${emp}</div><div><span class="ml">เขตการขาย :</span>${area}</div></div><div class="dmc"><div><span class="ml">ระหว่างวันที่ :</span>${st}</div><div><span class="ml">ถึงวันที่ :</span>${en}</div></div></div>
  <table class="dt"><thead><tr><th style="width:11%">ว/ด/ป</th><th style="width:14%">จากจังหวัด</th><th style="width:14%">ไปจังหวัด</th><th style="width:18%">ร้านค้า 1</th><th style="width:18%">ร้านค้า 2</th><th style="width:15%">ร้านค้า 3</th><th style="width:10%">หมายเหตุ</th></tr></thead><tbody>${tRows}</tbody></table>
  <div class="st">สรุปค่าใช้จ่าย</div>
  <table class="ct">
    <tr><td>เบี้ยเลี้ยง</td><td>${fm(ar)} × ${ad} วัน</td><td>${fm(ta)} บาท</td></tr>
    <tr><td>ค่าที่พัก</td><td>${fm(hr)} × ${hn} คืน</td><td>${fm(th)} บาท</td></tr>
    <tr><td>อื่นๆ</td><td style="text-align:center">–</td><td>${fm(oc)} บาท</td></tr>
    <tr class="tr"><th colspan="2">รวมเบิกทั้งหมด</th><th style="font-size:11px">${fm(gt)} บาท</th></tr>
  </table>
  <div class="sg">
    <div class="sb"><div class="sl"><div class="sn">(${emp})</div><div class="sr">พนักงานขาย</div></div></div>
    <div class="sb"><div class="sl"><div class="sn">(............................)</div><div class="sr">ผจก.ฝ่ายขาย</div></div></div>
    <div class="sb"><div class="sl"><div class="sn">(............................)</div><div class="sr">ฝ่ายบัญชี</div></div></div>
    <div class="sb"><div class="sl"><div class="sn">(............................)</div><div class="sr">ผู้อนุมัติ</div></div></div>
  </div>
</div>`;
}

function openPreview(){document.getElementById("previewContent").innerHTML=buildPreviewHTML();document.getElementById("previewModal").style.display="flex";}
function closePreview(){document.getElementById("previewModal").style.display="none";}

// =====================================================
// 🖨️ PRINT — ✅ TABLET + FIT A4 + จัดกลาง ไม่ล้นขอบ
// =====================================================
function buildFullPageHTML(body){
  return`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>แผนการเดินทาง</title>
<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;background:#fff;font-family:'Kanit',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
#print-wrap{width:190mm;max-width:190mm;margin:0 auto;padding:12mm 0}
.no-print{margin:12px auto;text-align:center;padding:10px}
.no-print button{font-family:'Kanit',sans-serif;font-size:16px;font-weight:600;padding:14px 32px;margin:6px;border-radius:12px;cursor:pointer;border:none;color:#fff;min-width:160px;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.btn-print{background:#1D9E75}.btn-close{background:#64748b}
@media print{
  @page{size:A4 portrait;margin:12mm 10mm}
  html,body{width:210mm;height:297mm}
  #print-wrap{width:100%;max-width:190mm;margin:0 auto;padding:0}
  .no-print{display:none!important}
}
.dt{table-layout:fixed;width:100%}
.dt td{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dt th{background:#e8f5f4!important;color:#1a5550!important;border:1px solid #b2d8d5!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.ct .tr th{background:#e8f5f4!important;color:#1a5550!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
</style></head><body>
<div class="no-print">
  <button class="btn-print" onclick="window.print()">🖨 พิมพ์ / Save PDF</button>
  <button class="btn-close" onclick="window.close()">✖ ปิดหน้านี้</button>
</div>
<div id="print-wrap">${body}</div>
</body></html>`;
}

function printPreview(){
  let content=document.getElementById("previewContent")?.innerHTML;
  if(!content||content.trim()===""){document.getElementById("previewContent").innerHTML=buildPreviewHTML();content=document.getElementById("previewContent").innerHTML;}
  const full=buildFullPageHTML(content);
  const w=window.open("","_blank");
  if(w){w.document.open();w.document.write(full);w.document.close();}
  else{const blob=new Blob([full],{type:"text/html;charset=utf-8"});const url=URL.createObjectURL(blob);window.open(url,"_blank");setTimeout(()=>URL.revokeObjectURL(url),10000);}
}
function exportPDF(){printPreview();}

// =====================================================
// 📤 CSV
// =====================================================
function exportTrips(){
  collectTableData();if(!trips||trips.length===0){alert("❌ ไม่มีข้อมูล");return;}
  try{const emp=document.getElementById("empName")?.value||"User",area=document.getElementById("area")?.value||"",start=document.getElementById("startDate")?.value||"";
  const hd=["ลำดับ","วันที่","จาก","ไป","ร้านค้า1","ร้านค้า2","ร้านค้า3","หมายเหตุ"];
  const rows=trips.map((t,i)=>[i+1,t.date||"",esc(t.from),esc(t.to),esc(t.shop1),esc(t.shop2),esc(t.shop3),esc(t.note)]);
  const csv=[hd.map(h=>esc(h)).join(","),...rows.map(r=>r.join(","))].join("\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`Plan_${emp}_${start||"nodate"}.csv`;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
  showNotification("✅ Export สำเร็จ","success");
  }catch(e){alert("❌ Export ไม่สำเร็จ: "+e.message);}
}

// =====================================================
// 🔄 CLEAR
// =====================================================
function clearForm(){
  if(!confirm("ล้างข้อมูลทั้งหมด?"))return;
  currentDraftKey=null;currentPlanId=null;trips=[];document.getElementById("tripTableBody").innerHTML="";
  ["allowanceRate","allowanceDays","hotelRate","hotelNights","otherCost"].forEach(id=>{const el=document.getElementById(id);if(el)el.value="";});
  document.getElementById("grandTotal").value="";setDefaultDates();
  document.querySelectorAll('[id^="ldraft-"],[id^="cdraft-"]').forEach(el=>{el.style.borderColor="#e2e8f0";el.style.background="#fff";el.style.borderWidth="1px";el.classList.remove("selected");});
  window.scrollTo({top:0,behavior:"smooth"});
}

// =====================================================
// 🔔 NOTIFICATION
// =====================================================
function showNotification(msg,type="info"){
  const old=document.getElementById("topNotification");if(old)old.remove();
  const c={success:{bg:"#E1F5EE",bd:"#1D9E75",tx:"#085041"},error:{bg:"#FEE2E2",bd:"#EF4444",tx:"#991B1B"},info:{bg:"#EFF6FF",bd:"#3B82F6",tx:"#1E40AF"}}[type]||{bg:"#EFF6FF",bd:"#3B82F6",tx:"#1E40AF"};
  const div=document.createElement("div");div.id="topNotification";
  div.style.cssText=`position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:99999;padding:12px 28px;border-radius:12px;background:${c.bg};border:1.5px solid ${c.bd};color:${c.tx};font-size:14px;font-weight:600;font-family:'Kanit',sans-serif;box-shadow:0 4px 20px rgba(0,0,0,.12);animation:ns .3s ease;max-width:90vw;text-align:center`;
  div.textContent=msg;
  if(!document.getElementById("nsS")){const s=document.createElement("style");s.id="nsS";s.textContent="@keyframes ns{from{opacity:0;transform:translateX(-50%) translateY(-20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}";document.head.appendChild(s);}
  document.body.appendChild(div);setTimeout(()=>{div.style.transition="opacity .3s";div.style.opacity="0";setTimeout(()=>div.remove(),300);},2500);
}

// =====================================================
// 🛠️ UTILITY
// =====================================================
async function getCurrentUserId(){if(typeof getUserData==="function")return getUserData("id");const{data:{user}}=await supabaseClient.auth.getUser();return user?.id||null;}
async function getCurrentUserInfo(){if(typeof getUserData==="function")return{userId:getUserData("id"),userName:getUserData("display_name"),userZone:getUserData("area")};const{data:{user}}=await supabaseClient.auth.getUser();const{data:p}=await supabaseClient.from("profiles").select("display_name,area").eq("id",user.id).maybeSingle();return{userId:user.id,userName:p?.display_name||user.email,userZone:p?.area||null};}
function esc(t){if(t==null)return"";const s=String(t);return(s.includes(",")||s.includes('"')||s.includes("\n"))?'"'+s.replace(/"/g,'""')+'"':s;}
const escapeCsv=esc;
function formatDateTH(ds){if(!ds)return"-";const[y,m,d]=ds.split("-");return`${d}/${m}/${y}`;}
function formatDateTimeTH(iso){if(!iso)return"-";return new Date(iso).toLocaleString("th-TH",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});}
async function logout(){try{await supabaseClient.auth.signOut();setTimeout(()=>{window.location.href="/pages/auth/login.html"},500);}catch(e){alert("ออกจากระบบไม่สำเร็จ: "+e.message);}}

console.log("✅ formPlan.js v3.3 loaded");