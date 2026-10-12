// =====================================================
// AddProductSpec.js v2.0 — สินค้าและหมวดหมู่ (Admin · ใช้บนโน้ตบุ๊กเป็นหลัก)
//
// ตาราง: categories(id,name) → products(id,name,category_id,sku,description)
//        → attributes(id,name,product_id,category_id,input_type,order_no[,is_required]) → attribute_options(id,attribute_id,value)
//        → product_variants(id,product_id,sku,color,brand,length,width,thickness,feature,status)
// ผู้ใช้ข้อมูลนี้: หน้ารายงานเยี่ยมร้าน (เลือกหมวด → สินค้า → กรอก Attribute) และ reports.product_id อ้างถึงสินค้า
//
// v2.0 แก้จากเดิม
//  - กรองหมวดในแท็บหนึ่งไปทับรายการที่ใช้ร่วม → แท็บอื่นแสดงชื่อเป็น "—" และลบหมวดแล้วลบสินค้าไม่ครบ
//    → โหลดข้อมูลทั้งหมดครั้งเดียว (แบ่งหน้า) แล้วกรองบนหน้าจอ
//  - ลบหมวด/สินค้าแบบลบต่อกันโดยไม่ตรวจ error ทีละขั้น และลบสินค้าที่ถูกใช้ในรายงานเยี่ยมร้านได้ (ประวัติเสีย)
//    → หมวดต้องว่างก่อนลบ · สินค้าที่มีในรายงานลบไม่ได้ · ลบต่อกันตรวจทุกขั้น
//  - ชื่อที่มี ' ทำให้ปุ่มลบพัง (onclick) · ไม่มีตรวจชื่อ/SKU/ตัวเลือกซ้ำ · รายการถูกตัดที่ 200/300 แถวโดยไม่บอก
//  - ตั้ง "บังคับกรอก" (is_required) ที่หน้ารายงานใช้อยู่ไม่ได้ · Attribute แบบเลือกที่ไม่มีตัวเลือกไม่มีคำเตือน
//  - SKU อัตโนมัติจากอักษรไทย 3 ตัวแรก + เวลา → อ่านไม่ออกและซ้ำได้
// =====================================================
"use strict";

let C = [], P = [], A = [], O = [], V = [];   // categories, products, attributes, options, variants
let _cat = "";            // หมวดที่เลือก ("" = ทั้งหมด, "_none" = ไม่มีหมวด)
let _drawerId = null;     // สินค้าที่เปิดรายละเอียด
let _form = null;         // { kind, id, extra }
let _chips = [];          // ตัวเลือกใน Attribute ที่กำลังแก้ { id, value, del }
let _hasRequired = false; // ตาราง attributes มีคอลัมน์ is_required ไหม
let _busy = false;

const TYPE_LABEL = { select: "เลือกจากรายการ", text: "พิมพ์ข้อความ", number: "ตัวเลข" };
const VAR_STATUS = { active: "ขายอยู่", inactive: "พักขาย", discontinued: "เลิกผลิต" };

// =====================================================
// ตัวช่วย
// =====================================================
function $(id) { return document.getElementById(id); }
function esc(t) { return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function norm(s) { return String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase(); }
function toast(msg, type = "ok") { const t = $("atToast"); t.textContent = msg; t.className = `at-toast is-${type} is-show`; clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("is-show"), 2800); }
const catName = (id) => C.find((c) => c.id === id)?.name || "ไม่มีหมวด";
const prodOf = (id) => P.find((p) => p.id === id) || null;
const attrsOf = (pid) => A.filter((a) => a.product_id === pid).sort((a, b) => (a.order_no ?? 999) - (b.order_no ?? 999) || String(a.name).localeCompare(String(b.name), "th"));
const optsOf = (aid) => O.filter((o) => o.attribute_id === aid).sort((a, b) => String(a.value).localeCompare(String(b.value), "th", { numeric: true }));
const varsOf = (pid) => V.filter((v) => v.product_id === pid);
function attrProblem(a) { return a.input_type === "select" && !optsOf(a.id).length; }

async function fetchAll(table, cols, order) {
  const out = [];
  for (let from = 0; from < 100000; from += 1000) {
    let q = supabaseClient.from(table).select(cols).range(from, from + 999);
    if (order) q = q.order(order);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
// ตรวจว่าเขียนสำเร็จจริง (ถูก RLS ปฏิเสธจะไม่มี error แต่ไม่มีแถว)
function mustRows(res, what) {
  if (res.error) throw res.error;
  if (Array.isArray(res.data) && !res.data.length) throw new Error(`ไม่มีสิทธิ์${what} (ตรวจ RLS)`);
  return res.data;
}

// =====================================================
// เริ่มต้น
// =====================================================
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof supabaseClient === "undefined") { alert("ระบบยังไม่พร้อม กรุณารีเฟรชหน้า"); return; }
  if (typeof protectPage === "function") await protectPage(["admin"]);
  if (!window.currentUser?.id && typeof loadCurrentUser === "function") await loadCurrentUser();
  const r = String(window.currentUser?.role || "").toLowerCase();
  if (r && r !== "admin") return;
  const name = window.currentUser?.display_name || window.currentUser?.email || "Admin";
  $("userName").textContent = name; $("userAvatar").textContent = name.trim().charAt(0).toUpperCase();
  $("logoutBtn").addEventListener("click", async () => { try { await supabaseClient.auth.signOut(); } catch (e) { /* ignore */ } location.href = "/pages/auth/login.html"; });
  loadNav();
  $("prodSearch").addEventListener("input", renderProducts);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { if (!$("formModal").hidden) closeForm(); else closeDrawer(); }
    if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement?.tagName || "")) { e.preventDefault(); $("prodSearch").focus(); }
  });
  $("formModal").addEventListener("click", (e) => { if (e.target.id === "formModal") closeForm(); });
  await loadAll();
});

async function loadNav() {
  try {
    const res = await fetch("/pages/components/nav-admin.html"); if (!res.ok) return;
    $("navContainer").innerHTML = await res.text();
    document.querySelectorAll("#navContainer .app-nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === location.pathname));
  } catch (e) { console.warn("nav:", e); }
}

async function loadAll() {
  try {
    const [c, p, a, o, v] = await Promise.all([
      fetchAll("categories", "id,name,created_at", "name"),
      fetchAll("products", "id,name,category_id,sku,description,created_at", "name"),
      fetchAll("attributes", "*", "name"),
      fetchAll("attribute_options", "id,attribute_id,value"),
      fetchAll("product_variants", "id,product_id,sku,color,brand,length,width,thickness,feature,status,created_at").catch((e) => { console.warn("variants:", e); return []; }),
    ]);
    C = c; P = p; A = a; O = o; V = v;
    _hasRequired = A.some((x) => Object.prototype.hasOwnProperty.call(x, "is_required"));
    await backfillAttrCategory();
    renderAll();
  } catch (e) {
    console.error("loadAll:", e);
    $("prodBody").innerHTML = `<tr><td colspan="6" class="at-state is-error">โหลดข้อมูลไม่สำเร็จ: ${esc(e.message)}</td></tr>`;
  }
}
// attributes.category_id ว่าง → เติมจากหมวดของสินค้า (ทำเมื่อพบเท่านั้น)
async function backfillAttrCategory() {
  const fix = A.filter((a) => !a.category_id && prodOf(a.product_id)?.category_id);
  for (const a of fix) {
    const cid = prodOf(a.product_id).category_id;
    const { error } = await supabaseClient.from("attributes").update({ category_id: cid }).eq("id", a.id);
    if (!error) a.category_id = cid;
  }
}
function renderAll() { renderStats(); renderCats(); renderProducts(); if (_drawerId) renderDrawer(); }

// =====================================================
// สรุป
// =====================================================
function renderStats() {
  const noOpt = A.filter(attrProblem).length;
  const noCat = P.filter((p) => !C.some((c) => c.id === p.category_id)).length;
  const items = [
    ["folder", "หมวดหมู่", C.length], ["inventory_2", "สินค้า", P.length], ["tune", "Attribute", A.length],
    ["list", "ตัวเลือก", O.length], ["layers", "Variant", V.length],
  ];
  $("statBar").innerHTML = items.map(([i, l, n]) => `<span class="ps-stat"><span class="material-symbols-outlined">${i}</span>${l}<b>${n.toLocaleString("th-TH")}</b></span>`).join("")
    + (noOpt ? `<span class="ps-stat is-warn" title="Attribute แบบเลือกจากรายการที่ยังไม่มีตัวเลือก — เซลล์จะเลือกอะไรไม่ได้"><span class="material-symbols-outlined">warning</span>ไม่มีตัวเลือก<b>${noOpt}</b></span>` : "")
    + (noCat ? `<span class="ps-stat is-warn"><span class="material-symbols-outlined">warning</span>สินค้าไม่มีหมวด<b>${noCat}</b></span>` : "");
}

// =====================================================
// หมวดหมู่
// =====================================================
function renderCats() {
  const count = (cid) => P.filter((p) => p.category_id === cid).length;
  const orphan = P.filter((p) => !C.some((c) => c.id === p.category_id)).length;
  const row = (id, name, n, editable) => `
    <li class="ps-cat${_cat === id ? " is-on" : ""}">
      <button type="button" class="ps-cat-main" onclick="selectCat('${esc(id)}')"><span class="ps-cat-name">${esc(name)}</span><b>${n}</b></button>
      ${editable ? `<span class="ps-cat-act">
        <button type="button" onclick="openCatModal('${esc(id)}')" title="แก้ไขชื่อ" aria-label="แก้ไข"><span class="material-symbols-outlined">edit</span></button>
        <button type="button" onclick="deleteCat('${esc(id)}')" title="ลบหมวด" aria-label="ลบ"><span class="material-symbols-outlined">delete</span></button></span>` : ""}
    </li>`;
  $("catList").innerHTML = row("", "ทั้งหมด", P.length, false)
    + C.map((c) => row(c.id, c.name, count(c.id), true)).join("")
    + (orphan ? row("_none", "ไม่มีหมวด", orphan, false) : "")
    + (C.length ? "" : `<li class="at-state">ยังไม่มีหมวดหมู่ — กด + เพื่อเพิ่ม</li>`);
}
function selectCat(id) { _cat = id; renderCats(); renderProducts(); }

function openCatModal(id) {
  const c = id ? C.find((x) => x.id === id) : null;
  openForm("cat", id, c ? "แก้ไขหมวดหมู่" : "เพิ่มหมวดหมู่",
    `<label class="at-field ps-full"><span>ชื่อหมวดหมู่ <i>*</i></span><input type="text" id="f-name" maxlength="100" value="${esc(c?.name || "")}" placeholder="เช่น ตาข่ายกรองแสง" /></label>`);
}
async function saveCat() {
  const name = $("f-name").value.trim().replace(/\s+/g, " ");
  if (!name) return formErr("กรุณาใส่ชื่อหมวดหมู่");
  if (C.some((c) => c.id !== _form.id && norm(c.name) === norm(name))) return formErr(`มีหมวด “${name}” อยู่แล้ว`);
  const res = _form.id
    ? await supabaseClient.from("categories").update({ name }).eq("id", _form.id).select("*")
    : await supabaseClient.from("categories").insert({ name }).select("*");
  const row = mustRows(res, "บันทึกหมวดหมู่")[0];
  if (_form.id) Object.assign(C.find((c) => c.id === _form.id), row); else { C.push(row); _cat = row.id; }
  C.sort((a, b) => String(a.name).localeCompare(String(b.name), "th"));
  return _form.id ? "แก้ไขหมวดหมู่แล้ว" : `เพิ่มหมวด “${name}” แล้ว`;
}
async function deleteCat(id) {
  const c = C.find((x) => x.id === id); if (!c) return;
  const n = P.filter((p) => p.category_id === id).length;
  if (n) { alert(`หมวด “${c.name}” ยังมีสินค้า ${n} รายการ\nย้ายสินค้าไปหมวดอื่นหรือลบสินค้าก่อน แล้วค่อยลบหมวด`); return; }
  if (!confirm(`ลบหมวด “${c.name}”?`)) return;
  try {
    mustRows(await supabaseClient.from("categories").delete().eq("id", id).select("id"), "ลบหมวดหมู่");
    C = C.filter((x) => x.id !== id); A.forEach((a) => { if (a.category_id === id) a.category_id = null; });
    if (_cat === id) _cat = "";
    renderAll(); toast("ลบหมวดหมู่แล้ว");
  } catch (e) { alert("ลบไม่สำเร็จ: " + e.message); }
}

// =====================================================
// สินค้า
// =====================================================
function visibleProducts() {
  const q = norm($("prodSearch").value);
  return P.filter((p) => (_cat === "" || (_cat === "_none" ? !C.some((c) => c.id === p.category_id) : p.category_id === _cat))
    && (!q || norm(`${p.name} ${p.sku} ${p.description}`).includes(q)));
}
function renderProducts() {
  const rows = visibleProducts();
  $("prodTitle").textContent = _cat === "" ? "สินค้าทั้งหมด" : _cat === "_none" ? "สินค้าที่ไม่มีหมวด" : catName(_cat);
  $("prodCount").textContent = `${rows.length.toLocaleString("th-TH")} รายการ`;
  const showCat = _cat === "" || _cat === "_none";
  $("thCat").hidden = !showCat;
  if (!rows.length) { $("prodBody").innerHTML = `<tr><td colspan="6" class="at-state">${P.length ? "ไม่พบสินค้า" : "ยังไม่มีสินค้า — กด “เพิ่มสินค้า”"}</td></tr>`; return; }
  $("prodBody").innerHTML = rows.map((p) => {
    const at = attrsOf(p.id), bad = at.filter(attrProblem).length, id = esc(p.id);
    return `<tr class="ps-prow${p.id === _drawerId ? " is-on" : ""}" onclick="openDrawer('${id}')">
      <td><b class="ps-pname">${esc(p.name)}</b>${p.description ? `<small class="ps-pdesc">${esc(p.description)}</small>` : ""}</td>
      <td>${p.sku ? `<span class="at-code">${esc(p.sku)}</span>` : `<span class="at-dim">-</span>`}</td>
      ${showCat ? `<td>${C.some((c) => c.id === p.category_id) ? esc(catName(p.category_id)) : `<span class="at-flag">ไม่มีหมวด</span>`}</td>` : ""}
      <td class="num">${at.length ? at.length : `<span class="at-dim">0</span>`}${bad ? ` <span class="at-flag" title="Attribute แบบเลือกที่ยังไม่มีตัวเลือก">⚠ ${bad}</span>` : ""}</td>
      <td class="num">${varsOf(p.id).length || `<span class="at-dim">0</span>`}</td>
      <td class="c-act"><div class="at-actions" onclick="event.stopPropagation()">
        <button type="button" class="at-act" onclick="openDrawer('${id}')"><span class="material-symbols-outlined">tune</span>รายละเอียด</button>
        <button type="button" class="at-act is-icon" onclick="openProdModal('${id}')" title="แก้ไข" aria-label="แก้ไข"><span class="material-symbols-outlined">edit</span></button>
        <button type="button" class="at-act is-icon" onclick="deleteProd('${id}')" title="ลบ" aria-label="ลบ"><span class="material-symbols-outlined">delete</span></button>
      </div></td></tr>`;
  }).join("");
}

function newSku(cid) {
  // รหัสอ่านง่ายและไม่ซ้ำ: P-ลำดับหมวด(2)-ลำดับสินค้า(3)
  const ci = Math.max(0, C.findIndex((c) => c.id === cid)) + 1;
  const prefix = `P${String(ci).padStart(2, "0")}-`;
  let n = P.filter((p) => String(p.sku || "").startsWith(prefix)).length + 1;
  while (P.some((p) => p.sku === prefix + String(n).padStart(3, "0"))) n++;
  return prefix + String(n).padStart(3, "0");
}
function openProdModal(id) {
  const p = id ? prodOf(id) : null;
  const cid = p ? p.category_id : (_cat && _cat !== "_none" ? _cat : "");
  openForm("prod", id, p ? "แก้ไขสินค้า" : "เพิ่มสินค้า", `
    <label class="at-field"><span>หมวดหมู่ <i>*</i></span><select id="f-cat"><option value="">— เลือก —</option>${C.map((c) => `<option value="${esc(c.id)}"${c.id === cid ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
    <label class="at-field"><span>SKU / รหัสสินค้า</span><input type="text" id="f-sku" maxlength="50" value="${esc(p?.sku || "")}" placeholder="เว้นว่าง = สร้างให้อัตโนมัติ" /></label>
    <label class="at-field ps-full"><span>ชื่อสินค้า <i>*</i></span><input type="text" id="f-name" maxlength="150" value="${esc(p?.name || "")}" placeholder="เช่น ตาข่ายกรองแสง 50%" /></label>
    <label class="at-field ps-full"><span>คำอธิบาย</span><textarea id="f-desc" rows="3" maxlength="1000" placeholder="รายละเอียดสั้น ๆ (ถ้ามี)">${esc(p?.description || "")}</textarea></label>`);
}
async function saveProd() {
  const name = $("f-name").value.trim().replace(/\s+/g, " "), cid = $("f-cat").value;
  let sku = $("f-sku").value.trim();
  if (!cid) return formErr("กรุณาเลือกหมวดหมู่");
  if (!name) return formErr("กรุณาใส่ชื่อสินค้า");
  if (P.some((p) => p.id !== _form.id && p.category_id === cid && norm(p.name) === norm(name))) return formErr(`มีสินค้า “${name}” ในหมวดนี้แล้ว`);
  if (sku && P.some((p) => p.id !== _form.id && norm(p.sku) === norm(sku))) return formErr(`SKU “${sku}” ถูกใช้กับสินค้าอื่นแล้ว`);
  if (!sku) sku = newSku(cid);
  const row = { name, category_id: cid, sku, description: $("f-desc").value.trim() || null };
  const res = _form.id ? await supabaseClient.from("products").update(row).eq("id", _form.id).select("*") : await supabaseClient.from("products").insert(row).select("*");
  const saved = mustRows(res, "บันทึกสินค้า")[0];
  if (_form.id) {
    const old = prodOf(_form.id);
    if (old.category_id !== cid) A.filter((a) => a.product_id === _form.id).forEach((a) => { a.category_id = cid; });
    Object.assign(old, saved);
    // Attribute ต้องอยู่หมวดเดียวกับสินค้า (หน้ารายงานกรองตามหมวด)
    if (A.some((a) => a.product_id === _form.id)) await supabaseClient.from("attributes").update({ category_id: cid }).eq("product_id", _form.id);
  } else P.push(saved);
  P.sort((a, b) => String(a.name).localeCompare(String(b.name), "th"));
  if (!_form.id) { _drawerId = saved.id; setTimeout(() => openDrawer(saved.id), 0); }
  return _form.id ? "แก้ไขสินค้าแล้ว" : `เพิ่ม “${name}” แล้ว — เพิ่ม Attribute ต่อได้เลย`;
}
async function deleteProd(id) {
  const p = prodOf(id); if (!p) return;
  let used = 0;
  try {
    const { count, error } = await supabaseClient.from("reports").select("id", { count: "exact", head: true }).eq("product_id", id);
    if (error) throw error; used = count || 0;
  } catch (e) { alert("ตรวจการใช้งานในรายงานไม่สำเร็จ — ลองใหม่อีกครั้ง\n" + e.message); return; }
  if (used) { alert(`ลบ “${p.name}” ไม่ได้\nสินค้านี้ถูกใช้ในรายงานเยี่ยมร้าน ${used.toLocaleString("th-TH")} รายการ — ถ้าลบ ประวัติรายงานจะไม่มีชื่อสินค้า\n\nถ้าเลิกขายแล้ว แนะนำเปลี่ยนชื่อ เช่น ต่อท้าย “(เลิกขาย)” แทน`); return; }
  const at = attrsOf(id), vs = varsOf(id);
  if (!confirm(`ลบสินค้า “${p.name}”?` + (at.length || vs.length ? `\nจะลบ Attribute ${at.length} รายการ (และตัวเลือก) กับ Variant ${vs.length} รายการด้วย` : ""))) return;
  try {
    const aids = at.map((a) => a.id);
    if (aids.length) {
      let r = await supabaseClient.from("attribute_options").delete().in("attribute_id", aids); if (r.error) throw r.error;
      r = await supabaseClient.from("attributes").delete().in("id", aids); if (r.error) throw r.error;
    }
    if (vs.length) { const r = await supabaseClient.from("product_variants").delete().eq("product_id", id); if (r.error) throw r.error; }
    mustRows(await supabaseClient.from("products").delete().eq("id", id).select("id"), "ลบสินค้า");
    O = O.filter((o) => !aids.includes(o.attribute_id)); A = A.filter((a) => a.product_id !== id); V = V.filter((v) => v.product_id !== id); P = P.filter((x) => x.id !== id);
    if (_drawerId === id) closeDrawer();
    renderAll(); toast("ลบสินค้าแล้ว");
  } catch (e) { alert("ลบไม่สำเร็จ: " + e.message); await loadAll(); }
}

// =====================================================
// รายละเอียดสินค้า (Attribute / Variant)
// =====================================================
function openDrawer(id) {
  _drawerId = id; renderDrawer();
  $("drawer").hidden = false; $("drawerBg").hidden = false;
  document.querySelectorAll(".ps-prow").forEach((tr) => tr.classList.toggle("is-on", tr.getAttribute("onclick")?.includes(id)));
}
function closeDrawer() {
  _drawerId = null; $("drawer").hidden = true; $("drawerBg").hidden = true;
  document.querySelectorAll(".ps-prow.is-on").forEach((tr) => tr.classList.remove("is-on"));
}
function renderDrawer() {
  const p = prodOf(_drawerId); if (!p) { closeDrawer(); return; }
  $("dCat").textContent = catName(p.category_id); $("dName").textContent = p.name; $("dSku").textContent = p.sku || "ไม่มี SKU";
  $("dDesc").textContent = p.description || ""; $("dDesc").hidden = !p.description;
  const at = attrsOf(p.id);
  $("dAttrs").innerHTML = at.length ? at.map((a, i) => {
    const os = optsOf(a.id), aid = esc(a.id);
    return `<li class="ps-attr${attrProblem(a) ? " is-bad" : ""}">
      <div class="ps-attr-head">
        <span class="ps-order">${i + 1}</span>
        <b>${esc(a.name)}</b>${a.is_required ? `<span class="ps-req">บังคับ</span>` : ""}
        <span class="ps-type">${esc(TYPE_LABEL[a.input_type] || a.input_type || "-")}</span>
        <span class="ps-attr-act">
          <button type="button" onclick="moveAttr('${aid}',-1)" ${i ? "" : "disabled"} title="เลื่อนขึ้น" aria-label="เลื่อนขึ้น"><span class="material-symbols-outlined">arrow_upward</span></button>
          <button type="button" onclick="moveAttr('${aid}',1)" ${i < at.length - 1 ? "" : "disabled"} title="เลื่อนลง" aria-label="เลื่อนลง"><span class="material-symbols-outlined">arrow_downward</span></button>
          <button type="button" onclick="openAttrModal('${aid}')" title="แก้ไข" aria-label="แก้ไข"><span class="material-symbols-outlined">edit</span></button>
          <button type="button" onclick="deleteAttr('${aid}')" title="ลบ" aria-label="ลบ"><span class="material-symbols-outlined">delete</span></button>
        </span>
      </div>
      ${a.input_type === "select" ? (os.length ? `<div class="ps-opts">${os.map((o) => `<span class="ps-opt">${esc(o.value)}</span>`).join("")}</div>` : `<p class="ps-warn"><span class="material-symbols-outlined">warning</span>ยังไม่มีตัวเลือก — เซลล์จะเลือกค่าไม่ได้ <button type="button" class="at-more" onclick="openAttrModal('${aid}')">เพิ่มตัวเลือก ›</button></p>`) : ""}
    </li>`;
  }).join("") : `<li class="ps-empty">ยังไม่มี Attribute — หน้ารายงานจะไม่ถามข้อมูลเพิ่มสำหรับสินค้านี้</li>`;
  const vs = varsOf(p.id);
  $("dVars").innerHTML = vs.length ? `<div class="at-table-wrap ps-var-wrap"><table class="at-table"><thead><tr><th>SKU</th><th>สี</th><th>ขนาด (ย×ก×ห)</th><th>ยี่ห้อ</th><th>สถานะ</th><th class="c-act"></th></tr></thead><tbody>
    ${vs.map((v) => `<tr><td>${v.sku ? `<span class="at-code">${esc(v.sku)}</span>` : "-"}</td><td>${esc(v.color || "-")}</td>
      <td>${[v.length, v.width, v.thickness].map((x) => esc(x || "-")).join(" × ")}</td><td>${esc(v.brand || "-")}</td>
      <td><span class="at-pill ${v.status === "active" ? "is-ok" : v.status === "inactive" ? "is-warn" : "is-off"}">${esc(VAR_STATUS[v.status] || v.status || "-")}</span></td>
      <td class="c-act"><div class="at-actions"><button type="button" class="at-act is-icon" onclick="openVarModal('${esc(v.id)}')" aria-label="แก้ไข"><span class="material-symbols-outlined">edit</span></button>
      <button type="button" class="at-act is-icon" onclick="deleteVar('${esc(v.id)}')" aria-label="ลบ"><span class="material-symbols-outlined">delete</span></button></div></td></tr>`).join("")}
    </tbody></table></div>` : `<p class="ps-empty">ยังไม่มี Variant</p>`;
}

function openAttrModal(id) {
  const a = id ? A.find((x) => x.id === id) : null;
  _chips = a ? optsOf(a.id).map((o) => ({ id: o.id, value: o.value, del: false })) : [];
  const nextOrder = Math.max(0, ...attrsOf(_drawerId).map((x) => x.order_no || 0)) + 1;
  openForm("attr", id, a ? "แก้ไข Attribute" : "เพิ่ม Attribute", `
    <label class="at-field"><span>ชื่อที่เซลล์เห็น <i>*</i></span><input type="text" id="f-name" maxlength="100" value="${esc(a?.name || "")}" placeholder="เช่น สี, ขนาด, % กรองแสง" /></label>
    <label class="at-field"><span>วิธีกรอก</span><select id="f-type">${Object.entries(TYPE_LABEL).map(([k, l]) => `<option value="${k}"${(a?.input_type || "select") === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>
    <label class="at-field"><span>ลำดับ</span><input type="number" id="f-order" min="1" value="${a?.order_no ?? nextOrder}" /></label>
    ${_hasRequired ? `<label class="ps-check"><input type="checkbox" id="f-req" ${a?.is_required ? "checked" : ""} /> บังคับกรอก</label>` : `<span></span>`}
    <div class="at-field ps-full" id="optBox">
      <span>ตัวเลือก <small>(พิมพ์แล้วกด Enter · วางหลายค่าคั่นด้วย , ได้)</small></span>
      <div class="ps-chips" id="chipList"></div>
      <div class="ps-chip-add"><input type="text" id="f-opt" placeholder="เช่น ดำ" /><button type="button" class="at-btn-ghost is-text" onclick="addChip()"><span class="material-symbols-outlined">add</span>เพิ่ม</button></div>
    </div>`);
  renderChips();
  $("f-type").addEventListener("change", () => { $("optBox").hidden = $("f-type").value !== "select"; });
  $("optBox").hidden = $("f-type").value !== "select";
  $("f-opt").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addChip(); } });
}
function addChip() {
  const raw = $("f-opt").value;
  const vals = raw.split(",").map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
  const dup = [];
  vals.forEach((v) => {
    const ex = _chips.find((c) => norm(c.value) === norm(v));
    if (ex && !ex.del) dup.push(v); else if (ex) ex.del = false; else _chips.push({ id: null, value: v, del: false });
  });
  $("f-opt").value = ""; $("f-opt").focus(); renderChips();
  if (dup.length) toast(`มีอยู่แล้ว: ${dup.join(", ")}`, "err");
}
function removeChip(i) { const c = _chips[i]; if (c.id) c.del = true; else _chips.splice(i, 1); renderChips(); }
function renderChips() {
  const live = _chips.filter((c) => !c.del);
  $("chipList").innerHTML = live.length ? _chips.map((c, i) => c.del ? "" : `<span class="ps-chip${c.id ? "" : " is-new"}">${esc(c.value)}<button type="button" onclick="removeChip(${i})" aria-label="ลบ ${esc(c.value)}">×</button></span>`).join("") : `<span class="at-dim">ยังไม่มีตัวเลือก</span>`;
}
async function saveAttr() {
  const name = $("f-name").value.trim().replace(/\s+/g, " "), type = $("f-type").value;
  if ($("f-opt") && $("f-opt").value.trim()) addChip(); // ค่าที่พิมพ์ค้างไว้
  if (!name) return formErr("กรุณาใส่ชื่อ Attribute");
  if (A.some((a) => a.id !== _form.id && a.product_id === _drawerId && norm(a.name) === norm(name))) return formErr(`สินค้านี้มี Attribute “${name}” แล้ว`);
  const live = _chips.filter((c) => !c.del);
  if (type === "select" && !live.length && !confirm("ยังไม่มีตัวเลือก — เซลล์จะเลือกค่าไม่ได้ บันทึกต่อไหม?")) return false;
  const ord = parseInt($("f-order").value, 10);
  const row = { name, input_type: type, order_no: isNaN(ord) ? null : ord, product_id: _drawerId, category_id: prodOf(_drawerId)?.category_id || null };
  if (_hasRequired) row.is_required = $("f-req").checked;
  const res = _form.id ? await supabaseClient.from("attributes").update(row).eq("id", _form.id).select("*") : await supabaseClient.from("attributes").insert(row).select("*");
  const saved = mustRows(res, "บันทึก Attribute")[0];
  if (_form.id) Object.assign(A.find((a) => a.id === _form.id), saved); else A.push(saved);
  // ตัวเลือก (เก็บไว้แม้เปลี่ยนเป็นพิมพ์ข้อความ เผื่อเปลี่ยนกลับ)
  const delIds = _chips.filter((c) => c.del && c.id).map((c) => c.id);
  if (delIds.length) { const r = await supabaseClient.from("attribute_options").delete().in("id", delIds); if (r.error) throw r.error; O = O.filter((o) => !delIds.includes(o.id)); }
  const add = _chips.filter((c) => !c.del && !c.id).map((c) => ({ attribute_id: saved.id, value: c.value }));
  if (add.length) { const r = await supabaseClient.from("attribute_options").insert(add).select("*"); O.push(...mustRows(r, "เพิ่มตัวเลือก")); }
  return _form.id ? "แก้ไข Attribute แล้ว" : "เพิ่ม Attribute แล้ว";
}
async function moveAttr(id, dir) {
  if (_busy) return;
  const list = attrsOf(_drawerId), i = list.findIndex((a) => a.id === id), j = i + dir;
  if (j < 0 || j >= list.length) return;
  // ให้ลำดับเป็น 1..n ไม่ซ้ำ แล้วสลับคู่ที่เลื่อน
  const next = list.map((a, k) => ({ a, n: k + 1 }));
  [next[i].n, next[j].n] = [next[j].n, next[i].n];
  _busy = true;
  try {
    for (const { a, n } of next) if (a.order_no !== n) {
      const r = await supabaseClient.from("attributes").update({ order_no: n }).eq("id", a.id).select("id");
      mustRows(r, "เปลี่ยนลำดับ"); a.order_no = n;
    }
    renderDrawer();
  } catch (e) { alert("เปลี่ยนลำดับไม่สำเร็จ: " + e.message); } finally { _busy = false; }
}
async function deleteAttr(id) {
  const a = A.find((x) => x.id === id); if (!a) return;
  const n = optsOf(id).length;
  if (!confirm(`ลบ Attribute “${a.name}”${n ? ` และตัวเลือก ${n} ค่า` : ""}?\nรายงานเก่าที่เคยกรอกช่องนี้จะไม่แสดงชื่อช่อง`)) return;
  try {
    let r = await supabaseClient.from("attribute_options").delete().eq("attribute_id", id); if (r.error) throw r.error;
    mustRows(await supabaseClient.from("attributes").delete().eq("id", id).select("id"), "ลบ Attribute");
    O = O.filter((o) => o.attribute_id !== id); A = A.filter((x) => x.id !== id);
    renderAll(); toast("ลบ Attribute แล้ว");
  } catch (e) { alert("ลบไม่สำเร็จ: " + e.message); await loadAll(); }
}

function openVarModal(id) {
  const v = id ? V.find((x) => x.id === id) : null;
  const f = (k, label, ph) => `<label class="at-field"><span>${label}</span><input type="text" id="f-${k}" maxlength="80" value="${esc(v?.[k] || "")}" placeholder="${ph}" /></label>`;
  openForm("var", id, v ? "แก้ไข Variant" : "เพิ่ม Variant", `
    ${f("sku", "SKU รุ่น", "เช่น NET-BLK-2x100")}
    <label class="at-field"><span>สถานะ</span><select id="f-status">${Object.entries(VAR_STATUS).map(([k, l]) => `<option value="${k}"${(v?.status || "active") === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>
    ${f("color", "สี", "ดำ, เขียว")}${f("brand", "ยี่ห้อ", "")}
    ${f("length", "ความยาว", "50m")}${f("width", "ความกว้าง", "2m")}
    ${f("thickness", "ความหนา", "0.10mm")}${f("feature", "คุณสมบัติพิเศษ", "")}`);
}
async function saveVar() {
  const g = (k) => $("f-" + k).value.trim() || null;
  const row = { product_id: _drawerId, sku: g("sku"), color: g("color"), brand: g("brand"), length: g("length"), width: g("width"), thickness: g("thickness"), feature: g("feature"), status: $("f-status").value };
  if (!row.sku && !row.color && !row.length && !row.width && !row.thickness && !row.brand) return formErr("กรอกอย่างน้อย SKU หรือ สี/ขนาด/ยี่ห้อ");
  if (row.sku && V.some((v) => v.id !== _form.id && norm(v.sku) === norm(row.sku))) return formErr(`SKU “${row.sku}” ถูกใช้แล้ว`);
  const res = _form.id ? await supabaseClient.from("product_variants").update(row).eq("id", _form.id).select("*") : await supabaseClient.from("product_variants").insert(row).select("*");
  const saved = mustRows(res, "บันทึก Variant")[0];
  if (_form.id) Object.assign(V.find((v) => v.id === _form.id), saved); else V.push(saved);
  return "บันทึก Variant แล้ว";
}
async function deleteVar(id) {
  if (!confirm("ลบ Variant นี้?")) return;
  try {
    mustRows(await supabaseClient.from("product_variants").delete().eq("id", id).select("id"), "ลบ Variant");
    V = V.filter((v) => v.id !== id); renderAll(); toast("ลบ Variant แล้ว");
  } catch (e) { alert("ลบไม่สำเร็จ: " + e.message); }
}

// =====================================================
// ฟอร์มกลาง
// =====================================================
function openForm(kind, id, title, html) {
  _form = { kind, id: id || null };
  $("formTitle").textContent = title; $("formBody").innerHTML = html; $("formErr").hidden = true;
  $("formModal").hidden = false;
  setTimeout(() => $("formBody").querySelector("input:not([type=checkbox]), select")?.focus(), 50);
}
function closeForm() { $("formModal").hidden = true; _form = null; _chips = []; }
function formErr(m) { $("formErr").textContent = m; $("formErr").hidden = false; return false; }
async function saveForm() {
  if (_busy || !_form) return;
  _busy = true; $("formSave").disabled = true; $("formErr").hidden = true;
  try {
    const fn = { cat: saveCat, prod: saveProd, attr: saveAttr, var: saveVar }[_form.kind];
    const msg = await fn();
    if (msg) { closeForm(); renderAll(); toast(msg); }
  } catch (e) {
    console.error("save:", e);
    formErr("บันทึกไม่สำเร็จ: " + (e.code === "23505" ? "ข้อมูลซ้ำกับที่มีอยู่" : e.message));
  } finally { _busy = false; $("formSave").disabled = false; }
}
