// =====================================================
// new-shop-sale.js — ขอเปิดร้านค้าใหม่ (ฝั่งเซลล์)
// ต้องโหลด special-price-common.js + new-shop-common.js ก่อน
//
// ส่งคำขอ → approval_requests: request_type "new_area_shop", request_status "waiting_manager" (status "manager_review")
//   → Manager (new-shop-manager-doc) อนุมัติ → ผู้บริหาร (executive-ApprovalDoc) อนุมัติขั้นสุดท้าย
// Manager/ผู้บริหาร "ขอข้อมูลเพิ่ม" → เซลล์กด "แก้ไขแล้วส่งใหม่" = อัปเดตคำขอเดิม กลับไปขั้น Manager
// ร่างเก็บในเครื่อง 1 ร่างต่อผู้ใช้ · ยกเลิกได้เฉพาะตอน Manager ยังไม่พิจารณา
// =====================================================
"use strict";

const ALLOWED_ROLES = ["admin", "sales", "sale", "manager"];
const DRAFT_KEY = () => `newShopDraft:v1:${me.id || "x"}`;
const PROVINCES = ["กรุงเทพมหานคร","กระบี่","กาญจนบุรี","กาฬสินธุ์","กำแพงเพชร","ขอนแก่น","จันทบุรี","ฉะเชิงเทรา","ชลบุรี","ชัยนาท","ชัยภูมิ","ชุมพร","เชียงราย","เชียงใหม่","ตรัง","ตราด","ตาก","นครนายก","นครปฐม","นครพนม","นครราชสีมา","นครศรีธรรมราช","นครสวรรค์","นนทบุรี","นราธิวาส","น่าน","บึงกาฬ","บุรีรัมย์","ปทุมธานี","ประจวบคีรีขันธ์","ปราจีนบุรี","ปัตตานี","พระนครศรีอยุธยา","พะเยา","พังงา","พัทลุง","พิจิตร","พิษณุโลก","เพชรบุรี","เพชรบูรณ์","แพร่","ภูเก็ต","มหาสารคาม","มุกดาหาร","แม่ฮ่องสอน","ยโสธร","ยะลา","ร้อยเอ็ด","ระนอง","ระยอง","ราชบุรี","ลพบุรี","ลำปาง","ลำพูน","เลย","ศรีสะเกษ","สกลนคร","สงขลา","สตูล","สมุทรปราการ","สมุทรสงคราม","สมุทรสาคร","สระแก้ว","สระบุรี","สิงห์บุรี","สุโขทัย","สุพรรณบุรี","สุราษฎร์ธานี","สุรินทร์","หนองคาย","หนองบัวลำภู","อ่างทอง","อำนาจเจริญ","อุดรธานี","อุตรดิตถ์","อุทัยธานี","อุบลราชธานี"];

let me = { id: null, name: "", role: "" };
let sig = null;
let photos = [];          // [{ data, name }] (ย่อแล้ว)
let editingId = null;     // แก้ไขคำขอที่ถูกขอข้อมูลเพิ่ม
let editingRow = null;
let dupNames = [];
let _dirty = false;
let _saving = false;
let _requests = [];
let _reqFilter = "all";
let _dupTimer = null;

const $ = (id) => document.getElementById(id);
const val = (id) => ($(id)?.value || "").trim();

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
  const nav = $("salesNav"); if (nav) nav.hidden = !(me.role === "sales" || me.role === "sale");
  $("typeChips").innerHTML = NS_SHOP_TYPES.map((t) => `<label><input type="radio" name="shopType" value="${escHtml(t)}" /><span>${escHtml(t)}</span></label>`).join("");
  $("provinceList").innerHTML = PROVINCES.map((p) => `<option value="${p}">`).join("");
  setupEvents();
  sig = createSignaturePad("sigCanvas", "sigWrap", "sigHint", markDirty);
  renderPhotos(); updateReasonCount(); toggleCredit();
  restoreDraft();
  updateStatus();
  await loadMyRequests();
  const q = new URLSearchParams(location.search).get("revise");
  if (q) startRevise(q);
});

function setupEvents() {
  const f = $("nsForm");
  f.addEventListener("input", (e) => { if (e.target.closest(".fp-field")) markDirty(); });
  f.addEventListener("change", (e) => {
    if (e.target.name === "payTerm") toggleCredit();
    if (e.target.name === "shopType" || e.target.name === "payTerm") markDirty();
  });
  $("shopName").addEventListener("input", () => { clearTimeout(_dupTimer); _dupTimer = setTimeout(checkDuplicate, 400); });
  $("reasonText").addEventListener("input", updateReasonCount);
  $("gps").addEventListener("input", renderMapLink);
  ["estMonthly", "creditLimit"].forEach((id) => {
    const el = $(id);
    el.addEventListener("blur", () => { el.value = el.value.trim() ? numOf(el.value).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""; });
    el.addEventListener("focus", () => { if (el.value) el.value = String(numOf(el.value) || ""); });
  });
  $("photoInput").addEventListener("change", onPhotos);
  document.querySelectorAll("#reqFilter button").forEach((b) => b.addEventListener("click", () => {
    _reqFilter = b.dataset.f;
    document.querySelectorAll("#reqFilter button").forEach((x) => x.classList.toggle("is-on", x === b));
    renderRequests();
  }));
  $("previewModal")?.addEventListener("click", (ev) => { if (ev.target.id === "previewModal") closePreview(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { closePreview(); closeViewPopup(); } });
}

const payTerm = () => document.querySelector('input[name="payTerm"]:checked')?.value || "";
const shopType = () => document.querySelector('input[name="shopType"]:checked')?.value || "";
function setRadio(name, v) { document.querySelectorAll(`input[name="${name}"]`).forEach((c) => { c.checked = c.value === v; }); }
function toggleCredit() { const on = payTerm() === "credit"; document.querySelectorAll("[data-credit]").forEach((el) => { el.hidden = !on; }); }
function updateReasonCount() { setText("reasonCount", `${$("reasonText").value.length}/500`); }
function clearSignature() { sig.clear(); markDirty(); }

// ---------- พิกัด ----------
function parseGps(s) {
  const m = String(s || "").match(/(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const lat = +m[1], lng = +m[2];
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat: lat.toFixed(6), lng: lng.toFixed(6) } : null;
}
function renderMapLink() {
  const g = parseGps(val("gps")), a = $("mapLink");
  a.hidden = !g;
  if (g) a.href = nsMapUrl(g);
}
function useMyLocation() {
  if (!navigator.geolocation) { alert("อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง"); return; }
  const b = $("gpsBtn"); b.disabled = true;
  navigator.geolocation.getCurrentPosition((p) => {
    b.disabled = false;
    $("gps").value = `${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`;
    renderMapLink(); markDirty();
    showNotification(`ได้ตำแหน่งแล้ว (คลาดเคลื่อน ~${Math.round(p.coords.accuracy)} ม.)`, "success");
  }, (e) => {
    b.disabled = false;
    alert(e.code === 1 ? "ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง — เปิดสิทธิ์ตำแหน่งในเบราว์เซอร์ หรือพิมพ์พิกัดเอง" : "หาตำแหน่งไม่สำเร็จ ลองใหม่อีกครั้ง หรือพิมพ์พิกัดเอง");
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
}

// ---------- ร้านซ้ำ ----------
async function checkDuplicate() {
  const name = val("shopName");
  dupNames = name.length >= 3 ? await nsFindSimilarShops(name) : [];
  if (name !== val("shopName")) return;
  const box = $("dupBox");
  box.hidden = !dupNames.length;
  box.innerHTML = dupNames.length ? `<span class="material-symbols-outlined">warning</span><div><b>มีร้านชื่อคล้ายกันในระบบแล้ว</b> — ตรวจว่าไม่ใช่ร้านเดิม<ul>${dupNames.map((n) => `<li>${escHtml(n)}</li>`).join("")}</ul></div>` : "";
}

// ---------- รูป ----------
function renderPhotos() {
  const g = $("photoGrid");
  g.innerHTML = photos.map((p, i) => `<figure class="ns-photo"><img src="${escHtml(nsPhotoSrc(p))}" alt="รูปร้าน ${i + 1}"><figcaption>${i === 0 ? "หน้าร้าน" : "รูปที่ " + (i + 1)}</figcaption>
      <button type="button" onclick="removePhoto(${i})" aria-label="ลบรูป ${i + 1}"><span class="material-symbols-outlined">close</span></button></figure>`).join("")
    + (photos.length < NS_MAX_PHOTOS ? `<button type="button" class="ns-photo-add" onclick="document.getElementById('photoInput').click()"><span class="material-symbols-outlined">add_a_photo</span>${photos.length ? "เพิ่มรูป" : "ถ่าย / เลือกรูป"}</button>` : "");
}
async function onPhotos(e) {
  const files = [...(e.target.files || [])].slice(0, NS_MAX_PHOTOS - photos.length);
  e.target.value = "";
  for (const f of files) {
    try { photos.push({ data: await nsCompressImage(f), name: f.name }); }
    catch (err) { alert(`${f.name}: ${err.message}`); }
  }
  renderPhotos(); markDirty();
}
function removePhoto(i) { photos.splice(i, 1); renderPhotos(); markDirty(); }

// =====================================================
// 🧾 ข้อมูลฟอร์ม
// =====================================================
function shopFromForm() {
  const g = parseGps(val("gps"));
  const credit = payTerm() === "credit";
  return {
    shop_name: val("shopName"), shop_type: shopType(), tax_id: val("taxId").replace(/[\s-]/g, ""), products: val("products"),
    address: val("address"), district: val("district"), province: val("province"), postcode: val("postcode"),
    lat: g?.lat || "", lng: g?.lng || "",
    contact_name: val("contactName"), phone: val("phone"), line_id: val("lineId"),
    est_monthly: numOf(val("estMonthly")), pay_term: payTerm(),
    credit_days: credit ? val("creditDays") : "", credit_limit: credit ? numOf(val("creditLimit")) : 0,
    reason: $("reasonText").value.trim(),
  };
}
function applyShop(s, photoList, signature) {
  s = s || {};
  const m = (n) => (Number(n) ? Number(n).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
  $("shopName").value = s.shop_name || ""; setRadio("shopType", s.shop_type || "");
  $("taxId").value = s.tax_id || ""; $("products").value = s.products || "";
  $("address").value = s.address || ""; $("district").value = s.district || ""; $("province").value = s.province || ""; $("postcode").value = s.postcode || "";
  $("gps").value = s.lat && s.lng ? `${s.lat}, ${s.lng}` : "";
  $("contactName").value = s.contact_name || ""; $("phone").value = s.phone || ""; $("lineId").value = s.line_id || "";
  $("estMonthly").value = m(s.est_monthly); setRadio("payTerm", s.pay_term || "");
  $("creditDays").value = s.credit_days || ""; $("creditLimit").value = m(s.credit_limit);
  $("reasonText").value = s.reason || "";
  photos = (photoList || []).map((p) => ({ ...p }));
  toggleCredit(); renderMapLink(); renderPhotos(); updateReasonCount();
  sig.set(signature || null);
  dupNames = []; $("dupBox").hidden = true;
  if (s.shop_name) checkDuplicate();
}

function validate() {
  const errors = [], warnings = [], s = shopFromForm();
  if (s.shop_name.length < 2) errors.push("ยังไม่ใส่ชื่อร้าน");
  if (!s.shop_type) errors.push("ยังไม่เลือกประเภทร้าน");
  if (s.tax_id && !/^\d{13}$/.test(s.tax_id)) errors.push("เลขผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก");
  if (!s.address) errors.push("ยังไม่ใส่ที่อยู่");
  if (!s.district) errors.push("ยังไม่ใส่อำเภอ / เขต");
  if (!s.province) errors.push("ยังไม่ใส่จังหวัด");
  else if (!PROVINCES.includes(s.province)) warnings.push(`จังหวัด “${s.province}” ไม่ตรงกับรายชื่อจังหวัด`);
  if (s.postcode && !/^\d{5}$/.test(s.postcode)) warnings.push("รหัสไปรษณีย์ควรเป็นตัวเลข 5 หลัก");
  if (val("gps") && !parseGps(val("gps"))) errors.push("พิกัด GPS ไม่ถูกต้อง (รูปแบบ: ละติจูด, ลองจิจูด)");
  else if (!s.lat) warnings.push("ไม่มีพิกัด GPS — ผู้อนุมัติจะดูตำแหน่งร้านไม่ได้");
  if (!s.contact_name) errors.push("ยังไม่ใส่ชื่อผู้ติดต่อ");
  const digits = s.phone.replace(/\D/g, "");
  if (!digits) errors.push("ยังไม่ใส่เบอร์โทร");
  else if (digits.length < 9 || digits.length > 10) warnings.push(`เบอร์โทร “${s.phone}” ควรมี 9–10 หลัก`);
  if (!(s.est_monthly > 0)) errors.push("ยังไม่ใส่ยอดซื้อคาดการณ์ต่อเดือน");
  if (!s.pay_term) errors.push("ยังไม่เลือกเงื่อนไขชำระเงิน");
  if (s.pay_term === "credit") {
    if (!/^\d+$/.test(s.credit_days)) errors.push("ยังไม่ใส่เครดิต (จำนวนวัน)");
    if (!(s.credit_limit > 0)) errors.push("ยังไม่ใส่วงเงินเครดิตที่ขอ");
  }
  if (!photos.length) errors.push("ยังไม่มีรูปร้าน (อย่างน้อย 1 รูป)");
  if (s.reason.length < 10) errors.push("กรุณาเขียนเหตุผลอย่างน้อย 10 ตัวอักษร");
  if (!sig.get()) errors.push("ยังไม่ได้เซ็นชื่อผู้ขอ");
  if (dupNames.length) warnings.push(`มีร้านชื่อคล้ายกันในระบบ: ${dupNames.slice(0, 2).join(", ")}`);
  const norm = (x) => String(x || "").replace(/\s+/g, "").toLowerCase();
  const dup = _requests.find((r) => !nsStatus(r).done && String(r.id) !== String(editingId) && norm(r.shop_name) === norm(s.shop_name));
  if (dup) warnings.push(`คุณมีคำขอเปิดร้านชื่อนี้ที่ยังไม่ทราบผลอยู่แล้ว (${nsDocNo(dup)})`);
  return { errors, warnings };
}
function showWarnBox(res) {
  renderIssues("fpWarn", res, "ตรวจพบ");
  const box = $("fpWarn");
  if (box && !box.hidden) box.querySelector("b").textContent = "ตรวจพบ";
}

// =====================================================
// 🏷 สถานะฟอร์ม + ร่าง
// =====================================================
function markDirty() {
  _dirty = true; updateStatus();
  const box = $("fpWarn");
  if (box && !box.hidden) showWarnBox(validate());
}
function updateStatus() {
  let label = _dirty ? "คำขอใหม่ (ยังไม่บันทึก)" : "คำขอใหม่", banner = "";
  if (editingId) {
    label = "กำลังแก้ไขคำขอที่ถูกขอข้อมูลเพิ่ม";
    banner = `แก้ไขคำขอ ${editingRow ? nsDocNo(editingRow) : ""} — ส่งแล้วจะกลับไปที่ Manager อีกครั้ง`;
  } else if (hasDraft()) label = _dirty ? "ร่าง (มีการแก้ไขที่ยังไม่บันทึก)" : "ร่าง (บันทึกในเครื่องแล้ว)";
  setText("fpStatus", label);
  $("fpEditBanner").hidden = !banner;
  setText("fpEditText", banner);
  $("nsForm").classList.toggle("is-editing", !!banner);
  setText("submitText", editingId ? "ตรวจ & ส่งใหม่" : "ตรวจ & ส่งคำขอ");
  setText("sendText", editingId ? "ส่งใหม่ให้ Manager" : "ส่งให้ Manager");
  $("draftBtn").hidden = !!editingId;
}
function hasDraft() { try { return !!localStorage.getItem(DRAFT_KEY()); } catch (e) { return false; } }
function saveDraft() {
  const s = shopFromForm();
  if (!s.shop_name && !s.address && !photos.length) { alert("ยังไม่มีข้อมูลให้บันทึก"); return; }
  const base = { shop: s, signature: sig.get(), updated_at: new Date().toISOString() };
  let noPhotos = false;
  try { localStorage.setItem(DRAFT_KEY(), JSON.stringify({ ...base, photos })); }
  catch (e) {
    // พื้นที่ในเครื่องไม่พอสำหรับรูป → เก็บเฉพาะข้อมูล
    try { localStorage.setItem(DRAFT_KEY(), JSON.stringify({ ...base, photos: [] })); noPhotos = true; }
    catch (e2) { alert("บันทึกร่างไม่สำเร็จ (พื้นที่ในเครื่องเต็มหรือถูกปิดไว้)"); return; }
  }
  _dirty = false; updateStatus();
  showNotification(noPhotos ? "บันทึกร่างแล้ว (ไม่รวมรูป — พื้นที่ในเครื่องไม่พอ)" : "บันทึกร่างในเครื่องแล้ว", noPhotos ? "info" : "success");
}
function restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY());
    if (!raw) return;
    const d = JSON.parse(raw);
    applyShop(d.shop, d.photos, d.signature);
    _dirty = false;
    showNotification("เปิดร่างที่บันทึกไว้ในเครื่องแล้ว", "info");
  } catch (e) { console.warn("restoreDraft:", e); }
}

// =====================================================
// 📤 ส่งคำขอ / ส่งใหม่หลังถูกขอข้อมูลเพิ่ม
// =====================================================
function rowFromForm() {
  const s = shopFromForm();
  return {
    request_type: NS_TYPE,
    request_title: `ขอเปิดร้านค้าใหม่ ${s.shop_name}${s.province ? " · จ." + s.province : ""}`,
    request_detail: s.reason,
    sale_name: me.name, shop_name: s.shop_name, province: s.province || null,
    request_date: todayISO(), signature: sig.get(),
    request_status: "waiting_manager", status: "manager_review",
  };
}
async function submitRequest() {
  if (_saving) return;
  const res = validate();
  showWarnBox(res); renderIssues("previewIssues", res);
  if (res.errors.length) { alert("ยังส่งไม่ได้:\n• " + res.errors.join("\n• ")); return; }
  const s = shopFromForm();
  if (!confirm((res.warnings.length ? "มีข้อควรตรวจ:\n• " + res.warnings.join("\n• ") + "\n\n" : "") +
    `${editingId ? "ส่งคำขอที่แก้ไขใหม่" : "ส่งคำขอ"}เปิดร้าน “${s.shop_name}” ให้ Manager พิจารณา?`)) return;

  _saving = true;
  const btn = $("sendBtn");
  btn.disabled = true;
  try {
    const now = new Date().toISOString();
    const requester = { id: me.id, name: me.name, role: me.role, area: me.area, position: me.position };
    // รูปร้าน → Storage (อัปโหลดไม่ได้จะเก็บในคำขอแทน ไม่ทำให้ส่งไม่ผ่าน)
    const up = await nsUploadPhotos(photos, me.id);
    const pPhotos = up.photos;
    if (up.failed) console.warn(`อัปโหลดรูป ${up.failed} รูปไม่สำเร็จ — เก็บในคำขอแทน`);
    if (editingId) {
      // อัปเดตคำขอเดิม (เฉพาะที่ถูกขอข้อมูลเพิ่ม) · เก็บผลรอบก่อนไว้ใน history แล้วกลับไปขั้น Manager
      const old = editingRow?.payload || {};
      const prev = { at: now, manager: old.manager || null };
      if (editingRow?.approved_at) prev.executive = { decision: editingRow.request_status, comment: editingRow.approval_comment || null, at: editingRow.approved_at };
      const payload = { ...old, form_version: "new-shop-v1", requester, shop_new: s, photos: pPhotos, manager: null, history: [...(old.history || []), prev], resubmitted_at: now };
      const { data, error } = await supabaseClient.from("approval_requests")
        .update({ ...rowFromForm(), payload, approval_comment: null, approval_signature: null, approved_by: null, approved_at: null, updated_at: now })
        .eq("id", editingId).eq("request_status", "request_more_info").select("id");
      if (error) throw error;
      if (!data || !data.length) throw new Error("คำขอนี้ไม่ได้อยู่ในสถานะ “ขอข้อมูลเพิ่ม” แล้ว หรือไม่มีสิทธิ์แก้ไข");
      window.eaApprovalNotify?.notifyNewRequest({ type: NS_TYPE, id: editingId, requesterId: me.id, requesterName: me.name, shopName: s.shop_name, resubmit: true });
    } else {
      const payload = { form_version: "new-shop-v1", requester, shop_new: s, photos: pPhotos, manager: null };
      const { data: ins, error } = await supabaseClient.from("approval_requests").insert({
        ...rowFromForm(), payload, sale_id: me.id, created_by: me.id, request_by: me.id, created_at: now, updated_at: now,
      }).select("id");
      if (error) throw error;
      window.eaApprovalNotify?.notifyNewRequest({ type: NS_TYPE, id: ins?.[0]?.id, requesterId: me.id, requesterName: me.name, shopName: s.shop_name }); // แจ้ง Manager
      try { localStorage.removeItem(DRAFT_KEY()); } catch (e) { /* ignore */ }
    }
    const wasEdit = !!editingId;
    resetForm(); closePreview();
    await loadMyRequests();
    showNotification(wasEdit ? "ส่งคำขอที่แก้ไขให้ Manager แล้ว" : "ส่งคำขอถึง Manager แล้ว — ติดตามผลได้ที่ “คำขอของฉัน”", "success");
  } catch (e) {
    alert("ส่งคำขอไม่สำเร็จ: " + e.message);
  } finally {
    _saving = false; btn.disabled = false;
  }
}

// ถูกขอข้อมูลเพิ่ม → เปิดคำขอเดิมขึ้นฟอร์ม (ต้องเซ็นใหม่)
async function startRevise(id) {
  const r0 = findRequest(id);
  if (!r0 || !nsStatus(r0).action) return;
  if (_dirty && !confirm("ข้อมูลในฟอร์มตอนนี้ยังไม่ได้บันทึก — แทนที่ด้วยคำขอที่ต้องแก้ไข?")) return;
  let r;
  try { r = await fullRow(id); } catch (e) { alert("เปิดคำขอไม่สำเร็จ: " + e.message); return; }
  editingId = r.id; editingRow = r;
  applyShop(nsShop(r).shop_name ? nsShop(r) : { shop_name: r.shop_name, province: r.province, reason: r.request_detail }, nsPhotos(r), null);
  const m = spManager(r);
  const who = m?.decision === "request_more_info" ? `Manager (${m.name || "-"})` : "ผู้บริหาร";
  const note = m?.decision === "request_more_info" ? m.comment : (r.approval_comment || r.exec_comment);
  const box = $("reviseBox");
  box.hidden = false;
  box.innerHTML = `<span class="material-symbols-outlined">assignment_return</span><div><b>${escHtml(who)} ขอข้อมูลเพิ่ม</b><p>${escHtml(note || "ไม่ได้ระบุรายละเอียด")}</p><small>แก้ไขข้อมูล เซ็นชื่อใหม่ แล้วกด “ตรวจ & ส่งใหม่”</small></div>`;
  _dirty = true; updateStatus();
  $("nsForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

// =====================================================
// 📋 คำขอของฉัน (ดึงแบบเบา — ไม่ดึงรูป/ลายเซ็น)
// =====================================================
const LIST_COLS = "id, request_type, request_status, status, shop_name, province, sale_name, request_detail, approval_comment, approved_at, created_at, updated_at, pl_type:payload->shop_new->>shop_type, pl_district:payload->shop_new->>district, pl_m_decision:payload->manager->>decision, pl_m_name:payload->manager->>name, pl_m_comment:payload->manager->>comment, pl_m_at:payload->manager->>at, pl_sc_code:payload->shop_created->>shop_code, pl_sc_at:payload->shop_created->>at";
function liftLight(r) {
  if (!("pl_m_decision" in r)) return r;
  r.payload = { shop_new: { shop_type: r.pl_type, district: r.pl_district }, manager: r.pl_m_decision ? { decision: r.pl_m_decision, name: r.pl_m_name, comment: r.pl_m_comment, at: r.pl_m_at } : null, shop_created: r.pl_sc_at ? { shop_code: r.pl_sc_code, at: r.pl_sc_at } : null };
  Object.keys(r).filter((k) => k.startsWith("pl_")).forEach((k) => delete r[k]);
  return r;
}
async function loadMyRequests() {
  const c = $("requestList");
  c.innerHTML = `<div class="fp-empty">กำลังโหลด...</div>`;
  try {
    const q = (sel) => supabaseClient.from("approval_requests").select(sel).eq("request_type", NS_TYPE).eq("request_by", me.id).order("created_at", { ascending: false }).limit(100);
    let { data, error } = await q(LIST_COLS);
    if (error) { console.warn("loadMyRequests (light):", error.message); ({ data, error } = await q("*")); if (error) throw error; }
    _requests = (data || []).map(liftLight);
    renderRequests();
  } catch (e) {
    c.innerHTML = `<div class="fp-empty is-error">โหลดไม่สำเร็จ: ${escHtml(e.message)}<br><button type="button" class="fp-link-btn" onclick="loadMyRequests()">ลองใหม่</button></div>`;
  }
}
function findRequest(id) { return _requests.find((r) => String(r.id) === String(id)) || null; }
function renderRequests() {
  const c = $("requestList");
  setText("requestCountBadge", _requests.length);
  const nAct = _requests.filter((r) => nsStatus(r).action).length;
  setText("cntAction", nAct ? nAct : "");
  const pick = (r) => { const s = nsStatus(r); return _reqFilter === "all" || (_reqFilter === "action" ? s.action : _reqFilter === "done" ? s.done && !s.action : !s.done); };
  const rows = _requests.filter(pick);
  if (!rows.length) { c.innerHTML = `<div class="fp-empty">${_requests.length ? "ไม่มีรายการในกลุ่มนี้" : "ยังไม่มีคำขอเปิดร้านค้าใหม่"}</div>`; return; }
  c.innerHTML = rows.map((r) => {
    const st = nsStatus(r), id = escHtml(r.id), m = spManager(r);
    const notes = [];
    if (m?.comment && m.decision !== "approved") notes.push(`<span class="sp-comment is-warn"><span class="material-symbols-outlined">forum</span><b>Manager:</b> ${escHtml(m.comment)}</span>`);
    if (st.key === "approved") notes.push(r.payload?.shop_created
      ? `<span class="sp-comment"><span class="material-symbols-outlined">storefront</span><b>เปิดร้านในระบบแล้ว</b>${r.payload.shop_created.shop_code ? " · รหัส " + escHtml(r.payload.shop_created.shop_code) : ""} — ดูได้ที่ “ร้านของฉัน”</span>`
      : `<span class="sp-comment"><span class="material-symbols-outlined">hourglass_top</span>รอ Admin เปิดร้านในระบบ</span>`);
    if (st.done && r.approval_comment && spReachedExec(r)) notes.push(`<span class="sp-comment"><span class="material-symbols-outlined">forum</span><b>ผู้บริหาร:</b> ${escHtml(r.approval_comment)}</span>`);
    return `
      <div class="fp-item${st.action ? " is-attn" : ""}">
        <button type="button" class="fp-item-main" onclick="openViewPopup('${id}')">
          <span class="fp-item-title">${escHtml(r.shop_name || "-")} <span class="fp-badge ${st.cls}">${escHtml(st.label)}</span></span>
          <span class="fp-item-sub"><span>${escHtml([nsShop(r).district, r.province].filter(Boolean).join(" · ") || "-")}</span><span>${nsDocNo(r)}</span><span>${formatDateTimeTH(r.created_at)}</span></span>
          ${miniSteps(r)}
          ${notes.join("")}
        </button>
        <div class="fp-item-actions">
          ${st.action ? `<button type="button" class="is-primary" onclick="startRevise('${id}')"><span class="material-symbols-outlined">edit</span>แก้ไขแล้วส่งใหม่</button>` : ""}
          <button type="button" onclick="openViewPopup('${id}')"><span class="material-symbols-outlined">visibility</span>ดู</button>
          <button type="button" onclick="printRequestById('${id}')"><span class="material-symbols-outlined">print</span>พิมพ์</button>
          ${st.key === "waiting_manager" ? `<button type="button" class="is-danger" onclick="cancelRequest('${id}')"><span class="material-symbols-outlined">block</span>ยกเลิก</button>` : ""}
        </div>
      </div>`;
  }).join("");
}
function miniSteps(r) {
  const s = nsStatus(r), m = spManager(r);
  const mg = m ? (m.decision === "approved" ? "is-ok" : m.decision === "rejected" ? "is-bad" : "is-warn") : s.key === "waiting_manager" ? "is-now" : "";
  let ex = "";
  if (spReachedExec(r)) ex = ({ pending: "is-now", approved: "is-ok", rejected: "is-bad", request_more_info: "is-warn" })[s.key] || "";
  return `<span class="sp-mini"><i class="is-ok">ส่ง</i><i class="${mg}">Manager</i><i class="${ex}">ผู้บริหาร</i></span>`;
}
async function cancelRequest(id) {
  const r = findRequest(id);
  if (!confirm(`ยกเลิกคำขอเปิดร้าน “${r?.shop_name || ""}”?\n(ลบออกจากระบบ Manager จะไม่เห็นรายการนี้อีก)`)) return;
  try {
    const { data, error } = await supabaseClient.from("approval_requests").delete()
      .eq("id", id).eq("request_status", "waiting_manager").select("id");
    if (error) throw error;
    if (!data || !data.length) throw new Error("Manager พิจารณาไปแล้ว หรือไม่มีสิทธิ์ยกเลิก");
    showNotification("ยกเลิกคำขอแล้ว", "success");
    await loadMyRequests();
  } catch (e) { alert("ยกเลิกไม่สำเร็จ: " + e.message); }
}

// =====================================================
// 🧾 เอกสาร: ตัวอย่างก่อนส่ง / ดู / พิมพ์
// =====================================================
function docFromForm() {
  const s = shopFromForm();
  return { shop: s, requester: me.name, reason: s.reason, photos, signature: sig.get(), doc_date: todayISO() };
}
function openPreview() {
  const res = validate();
  showWarnBox(res); renderIssues("previewIssues", res);
  $("sendBtn").disabled = res.errors.length > 0;
  setText("previewTitle", editingId ? "ตรวจคำขอที่แก้ไขก่อนส่งใหม่" : "ตรวจคำขอก่อนส่ง");
  $("previewContent").innerHTML = nsBuildDocHTML(docFromForm());
  $("previewModal").style.display = "flex";
}
function closePreview() { const m = $("previewModal"); if (m) m.style.display = "none"; }
function printPreview() { spOpenPrint(nsPrintPage(nsBuildDocHTML(docFromForm()))); }

async function fullRow(id) {
  const { data, error } = await supabaseClient.from("approval_requests").select("*").eq("id", id).maybeSingle();
  if (error || !data) throw error || new Error("ไม่พบคำขอ");
  await nsResolvePhotos(data); // ลิงก์ชั่วคราวของรูปร้านใน Storage
  return data;
}
async function printRequestById(id) {
  try { spOpenPrint(nsPrintPage(nsBuildDocHTML(nsDocFromRow(await fullRow(id))))); } catch (e) { alert("เปิดเอกสารไม่สำเร็จ: " + e.message); }
}
async function openViewPopup(id) {
  let m = $("viewPopupModal");
  if (!m) {
    m = document.createElement("div"); m.id = "viewPopupModal"; m.className = "preview-modal";
    m.innerHTML = `<div class="preview-wrapper"><div class="preview-actions" id="viewPopupActions"></div><div id="viewPopupTl" class="sp-tl-wrap"></div><div id="viewPopupContent" class="a4-page"></div></div>`;
    m.addEventListener("click", (e) => { if (e.target === m) closeViewPopup(); });
    document.body.appendChild(m);
  }
  $("viewPopupContent").innerHTML = `<div class="fp-empty">กำลังโหลด...</div>`;
  $("viewPopupActions").innerHTML = `<span class="preview-title">กำลังโหลด...</span><button type="button" class="pa-close" onclick="closeViewPopup()" aria-label="ปิด"><span class="material-symbols-outlined">close</span></button>`;
  $("viewPopupTl").innerHTML = "";
  m.style.display = "flex";
  try {
    const r = await fullRow(id);
    const st = nsStatus(r), sid = escHtml(r.id);
    $("viewPopupTl").innerHTML = nsTimelineHTML(r);
    $("viewPopupContent").innerHTML = nsBuildDocHTML(nsDocFromRow(r));
    $("viewPopupActions").innerHTML = `
      <span class="preview-title">${escHtml(r.shop_name || "คำขอเปิดร้าน")} · ${escHtml(st.label)}</span>
      ${st.action ? `<button type="button" class="pa-primary" onclick="closeViewPopup();startRevise('${sid}')"><span class="material-symbols-outlined">edit</span>แก้ไขแล้วส่งใหม่</button>` : ""}
      <button type="button" onclick="printRequestById('${sid}')"><span class="material-symbols-outlined">print</span>พิมพ์ / PDF</button>
      <button type="button" class="pa-close" onclick="closeViewPopup()" aria-label="ปิด"><span class="material-symbols-outlined">close</span></button>`;
  } catch (e) {
    $("viewPopupContent").innerHTML = `<div class="fp-empty is-error">เปิดเอกสารไม่สำเร็จ: ${escHtml(e.message || "")}</div>`;
  }
}
function closeViewPopup() { const m = $("viewPopupModal"); if (m) m.style.display = "none"; }

// =====================================================
// 🔄 CLEAR
// =====================================================
function resetForm() {
  editingId = null; editingRow = null;
  $("reviseBox").hidden = true;
  applyShop({}, [], null);
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
