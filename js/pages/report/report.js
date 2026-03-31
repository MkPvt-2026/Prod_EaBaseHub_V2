// =====================================================
// report.js  v6.0  — Product Picker + List Pattern
// Draft  → localStorage  (ไม่ขึ้น Supabase)
// Submit → Supabase (status = 'submitted')
// =====================================================

const DRAFT_KEY = "ea_report_drafts";

let submittedReports = [];
let shopsMap         = {};
let productsMap      = {};
let categoriesCache  = [];
let currentViewReportId = null;

// รายการสินค้าที่เลือกแล้ว (in-memory)
let selectedProducts = [];

// =====================================================
// 🚀 INIT
// =====================================================
document.addEventListener("DOMContentLoaded", async () => {
  try { await protectPage(["admin","sales","manager","user"]); }
  catch(e) { return; }

  await loadUserHeader();
  await Promise.all([loadProvinces(), loadPickerCategories(), loadSubmittedReports()]);
  setDefaultDate();
  setupEventListeners();
  setupLogout();
  await renderDraftList();
  renderSelectedProducts();
});

// =====================================================
// 👤 HEADER
// =====================================================
async function loadUserHeader() {
  try {
    const { data:{ session } } = await supabaseClient.auth.getSession();
    if (!session) return;
    const { data:p } = await supabaseClient.from("profiles")
      .select("display_name,role").eq("id", session.user.id).single();
    const name = p?.display_name || session.user.email;
    const $ = id => document.getElementById(id);
    if ($("userName"))   $("userName").textContent   = name;
    if ($("userRole"))   $("userRole").textContent   = p?.role || "";
    if ($("userAvatar")) $("userAvatar").textContent = name.charAt(0).toUpperCase();
  } catch(e) { console.error("loadUserHeader", e); }
}

// =====================================================
// 🗄️ LOCALSTORAGE DRAFT HELPERS
// =====================================================
function getDrafts() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "[]"); }
  catch(e) { return []; }
}
function saveDraftsToStorage(drafts) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
}
function genDraftId() {
  return "draft_" + Date.now() + "_" + Math.random().toString(36).slice(2,7);
}

// =====================================================
// 🏪 RESOLVE SHOP NAMES
// =====================================================
async function resolveShopNames(ids) {
  const missing = [...new Set(ids.filter(id => id && !shopsMap[id]))];
  if (!missing.length) return;
  try {
    const { data } = await supabaseClient.from("shops")
      .select("id,shop_name").in("id", missing);
    data?.forEach(s => { shopsMap[s.id] = s.shop_name; });
  } catch(e) { console.error("resolveShopNames", e); }
}

// =====================================================
// 🏷️ RESOLVE ATTRIBUTE NAMES
// =====================================================
async function resolveAttrNames(attrIds) {
  const missing = [...new Set(attrIds.filter(id => id))];
  if (!missing.length) return {};
  try {
    const { data } = await supabaseClient.from("attributes")
      .select("id,name").in("id", missing);
    return Object.fromEntries((data||[]).map(a => [a.id, a.name]));
  } catch(e) { return {}; }
}

// =====================================================
// 🏷️ FORMAT ATTRIBUTES → "ชื่อ: ค่า, ..."
// =====================================================
async function formatAttrInline(attributes) {
  if (!attributes || !Object.keys(attributes).length) return "";
  const attrMap = await resolveAttrNames(Object.keys(attributes));
  return Object.entries(attributes)
    .map(([k, v]) => `${attrMap[k] || k}: ${v}`)
    .join(", ");
}

// =====================================================
// 📦 PRODUCT PICKER — โหลด Categories / Products / Attributes
// =====================================================
async function loadPickerCategories() {
  try {
    const { data } = await supabaseClient.from("categories").select("id,name").order("name");
    categoriesCache = data || [];
    const sel = document.getElementById("pickerCategory");
    if (!sel) return;
    sel.innerHTML = `<option value="">-- เลือกหมวดสินค้า --</option>`;
    categoriesCache.forEach(c => {
      const o = document.createElement("option");
      o.value = c.id; o.textContent = c.name; sel.appendChild(o);
    });
  } catch(e) { console.error("loadPickerCategories", e); }
}

async function onPickerCategoryChange(categoryId) {
  const sel = document.getElementById("pickerProduct");
  const attrBox = document.getElementById("pickerAttributes");
  if (sel) sel.innerHTML = `<option value="">-- เลือกสินค้า --</option>`;
  if (attrBox) attrBox.innerHTML = "";
  if (!categoryId) return;

  try {
    const { data } = await supabaseClient.from("products")
      .select("id,name").eq("category_id", categoryId).order("name");
    data?.forEach(p => {
      productsMap[p.id] = p.name;
      const o = document.createElement("option");
      o.value = p.id; o.textContent = p.name; sel.appendChild(o);
    });
  } catch(e) { console.error("onPickerCategoryChange", e); }
}

async function onPickerProductChange(productId) {
  const attrBox = document.getElementById("pickerAttributes");
  if (attrBox) attrBox.innerHTML = "";
  if (!productId) return;

  try {
    const { data: attrs } = await supabaseClient
      .from("attributes")
      .select("*")
      .eq("product_id", productId)
      .order("order_no", { ascending: true });

    if (!attrs?.length) return;

    for (const attr of attrs) {
      const wrap = document.createElement("div");
      wrap.classList.add("form-group");

      const lbl = document.createElement("label");
      lbl.innerText = attr.name;
      if (attr.is_required) lbl.innerHTML += ' <span style="color:red">*</span>';
      wrap.appendChild(lbl);

      if (attr.input_type === "select") {
        const s = document.createElement("select");
        s.dataset.attributeId = attr.id;
        s.classList.add("picker-attr-field");

        const { data: opts } = await supabaseClient
          .from("attribute_options")
          .select("value")
          .eq("attribute_id", attr.id)
          .order("value");

        s.innerHTML = `<option value="">-- เลือก --</option>`;
        opts?.forEach(o => {
          const op = document.createElement("option");
          op.value = o.value; op.textContent = o.value; s.appendChild(op);
        });
        wrap.appendChild(s);
      } else {
        const inp = document.createElement("input");
        inp.type = attr.input_type === "number" ? "number" : "text";
        inp.dataset.attributeId = attr.id;
        inp.classList.add("picker-attr-field");
        wrap.appendChild(inp);
      }

      attrBox.appendChild(wrap);
    }
  } catch(e) { console.error("onPickerProductChange", e); }
}

// =====================================================
// ➕ ADD PRODUCT — เก็บลง selectedProducts[] แล้ว render
// =====================================================
function addSelectedProduct() {
  const productId = document.getElementById("pickerProduct")?.value;
  if (!productId) {
    showToast("⚠️ กรุณาเลือกสินค้าก่อน");
    return;
  }

  // เก็บ attributes
  const attrs = {};
  document.querySelectorAll(".picker-attr-field").forEach(f => {
    if (f.value) attrs[f.dataset.attributeId] = f.value;
  });

  const productName = productsMap[productId] || productId;

  // เพิ่มลง list (อนุญาตสินค้าซ้ำได้ เพราะอาจเลือก attribute ต่างกัน)
  selectedProducts.push({
    _uid: Date.now() + "_" + Math.random().toString(36).slice(2,5),
    product_id: productId,
    product_name: productName,
    attributes: attrs
  });

  renderSelectedProducts();
  resetPicker();
  showToast(`✅ เพิ่ม "${truncate(productName, 20)}" แล้ว`);
}

function removeSelectedProduct(uid) {
  selectedProducts = selectedProducts.filter(p => p._uid !== uid);
  renderSelectedProducts();
}

function resetPicker() {
  const catSel  = document.getElementById("pickerCategory");
  const prodSel = document.getElementById("pickerProduct");
  const attrBox = document.getElementById("pickerAttributes");
  // รีเซ็ตเฉพาะ product + attributes — ไม่ reset category เผื่อเลือกหลายตัวในหมวดเดียว
  if (prodSel) {
    prodSel.value = "";
    // ไม่ clear options — ยังอยู่ในหมวดเดิม
  }
  if (attrBox) attrBox.innerHTML = "";
}

// =====================================================
// 🎨 RENDER SELECTED PRODUCTS LIST
// =====================================================
async function renderSelectedProducts() {
  const container = document.getElementById("selectedProductList");
  const countEl   = document.getElementById("selectedProductCount");
  if (!container) return;

  if (countEl) countEl.textContent = selectedProducts.length;

  if (!selectedProducts.length) {
    container.innerHTML = `<div class="empty-product-list">ยังไม่มีสินค้าที่เลือก — เลือกจาก dropdown ด้านบนแล้วกด "เพิ่มสินค้า"</div>`;
    return;
  }

  let html = "";
  for (const item of selectedProducts) {
    const attrText = await formatAttrInline(item.attributes);
    html += `
      <div class="selected-product-item" data-uid="${item._uid}">
        <div class="product-item-info">
          <span class="product-item-name">${escapeHtml(item.product_name)}</span>
          ${attrText ? `<span class="product-item-attr">${escapeHtml(attrText)}</span>` : ""}
        </div>
        <button class="btn-remove-product" onclick="removeSelectedProduct('${item._uid}')" title="ลบ">✕</button>
      </div>`;
  }
  container.innerHTML = html;
}

// =====================================================
// 💾 SAVE DRAFT → localStorage
// =====================================================
function saveDraft() {
  const data = collectFormData();
  if (!data.report_date) { alert("❌ กรุณาเลือกวันที่ก่อน"); return; }

  const drafts = getDrafts();
  drafts.push({ ...data, id: genDraftId(), saved_at: new Date().toISOString(), is_draft: true });
  saveDraftsToStorage(drafts);

  showToast("💾 บันทึก Draft ลงเครื่องแล้ว");
  clearForm();
  renderDraftList();
}

// =====================================================
// ✏️ EDIT DRAFT
// =====================================================
async function editDraftToForm(draftId) {
  const drafts = getDrafts();
  const d = drafts.find(x => x.id === draftId);
  if (!d) return;

  saveDraftsToStorage(drafts.filter(x => x.id !== draftId));

  if (d.report_date) document.getElementById("reportDate").value = d.report_date;
  if (d.status_visit) document.getElementById("status").value = d.status_visit;
  if (d.note) document.getElementById("note").value = d.note;

  if (d.province) {
    const provSel = document.getElementById("provinceSelect");
    if (provSel) provSel.value = d.province;
    await loadShopsByProvince(d.province);
    if (d.shop_id) document.getElementById("shopSelect").value = d.shop_id;
  }

  // โหลด products list กลับมา
  if (d.products && d.products.length) {
    // resolve ชื่อสินค้าที่ยังไม่มี
    const missingIds = d.products.map(p => p.product_id).filter(id => !productsMap[id]);
    if (missingIds.length) {
      const { data: prods } = await supabaseClient
        .from("products").select("id,name").in("id", missingIds);
      prods?.forEach(p => { productsMap[p.id] = p.name; });
    }
    selectedProducts = d.products.map(p => ({
      _uid: Date.now() + "_" + Math.random().toString(36).slice(2,5),
      product_id: p.product_id,
      product_name: productsMap[p.product_id] || p.product_id,
      attributes: p.attributes || {}
    }));
  } else {
    selectedProducts = [];
  }

  renderSelectedProducts();
  renderDraftList();
  window.scrollTo({ top: 0, behavior: "smooth" });
  showToast("✏️ โหลด Draft ขึ้น form แล้ว");
}

// =====================================================
// 🗑️ DELETE DRAFT
// =====================================================
function deleteDraft(draftId) {
  if (!confirm("ลบ Draft นี้?")) return;
  saveDraftsToStorage(getDrafts().filter(x => x.id !== draftId));
  showToast("🗑️ ลบ Draft แล้ว");
  renderDraftList();
}

// =====================================================
// 🎨 RENDER DRAFT LIST
// =====================================================
async function renderDraftList() {
  const drafts       = getDrafts();
  const counter      = document.getElementById("draftCount");
  const counter2     = document.getElementById("draftCount2");
  const tbody        = document.getElementById("draftBody");
  const section      = document.getElementById("draftSection");
  const submitAllBtn = document.getElementById("submitAllBtn");

  if (counter)      counter.textContent  = drafts.length;
  if (counter2)     counter2.textContent = drafts.length;
  if (submitAllBtn) submitAllBtn.disabled = drafts.length === 0;
  if (!tbody || !section) return;

  section.style.display = drafts.length > 0 ? "block" : "none";

  await resolveShopNames(drafts.map(d => d.shop_id));

  tbody.innerHTML = "";

  for (const d of drafts) {
    const shopName = shopsMap[d.shop_id] || "—";
    // สรุปสินค้า
    const prodSummary = (d.products || []).map(p => productsMap[p.product_id] || "—").join(", ") || "—";
    const savedAt = new Date(d.saved_at).toLocaleString("th-TH", {
      day:"numeric", month:"short", hour:"2-digit", minute:"2-digit"
    });

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td data-label="วันที่">${d.report_date || "—"}</td>
      <td data-label="ร้านค้า" title="${escapeHtml(shopName)}">${escapeHtml(truncate(shopName, 10))}</td>
      <td data-label="สินค้า" title="${escapeHtml(prodSummary)}">
        <div style="font-weight:500;">${escapeHtml(truncate(prodSummary, 24))}</div>
        <div class="attr-sub">${(d.products||[]).length} รายการ</div>
      </td>
      <td data-label="รายละเอียด" title="${escapeHtml(d.note||"")}">${escapeHtml(truncate(d.note||"—", 28))}</td>
      <td data-label="บันทึกเมื่อ" style="color:#888;font-size:11px;">${savedAt}</td>
      <td>
        <div class="action-buttons">
          <button onclick="editDraftToForm('${d.id}')" title="แก้ไข" class="btn-action-edit">✏️</button>
          <button onclick="submitOneDraft('${d.id}')" title="ส่งรายการนี้" class="btn-action-submit">📤</button>
          <button onclick="deleteDraft('${d.id}')" title="ลบ" class="btn-action-del">🗑️</button>
        </div>
      </td>`;
    tbody.appendChild(tr);
  }
}

// =====================================================
// 📤 SUBMIT ONE DRAFT
// =====================================================
async function submitOneDraft(draftId) {
  const drafts = getDrafts();
  const d = drafts.find(x => x.id === draftId);
  if (!d) return;

  if (!d.shop_id || !d.products?.length) {
    alert("❌ ข้อมูลไม่ครบ — ต้องมีร้านค้าและสินค้าอย่างน้อย 1 รายการ");
    return;
  }
  try {
    const { data:{ session } } = await supabaseClient.auth.getSession();
    if (!session) { alert("❌ Session หมดอายุ กรุณาล็อกอินใหม่"); return; }

    const now = new Date().toISOString();
    // insert 1 row ต่อ 1 product
    const rows = d.products.map(p => ({
      report_date:  d.report_date,
      shop_id:      d.shop_id,
      product_id:   p.product_id,
      source:       d.source || null,
      status:       "submitted",
      status_visit: d.status_visit || null,
      note:         d.note,
      attributes:   p.attributes || {},
      sale_id:      session.user.id,
      submitted_at: now,
      created_at:   d.saved_at || now
    }));

    const { error } = await supabaseClient.from("reports").insert(rows);
    if (error) throw error;

    saveDraftsToStorage(drafts.filter(x => x.id !== draftId));
    showToast("✅ ส่งรายงานสำเร็จ");
    await renderDraftList();
    await loadSubmittedReports();
  } catch(e) {
    console.error("submitOneDraft", e);
    alert("❌ ส่งไม่สำเร็จ: " + e.message);
  }
}

// =====================================================
// 📤 SUBMIT ALL DRAFTS
// =====================================================
async function submitAllDrafts() {
  const drafts = getDrafts();
  if (!drafts.length) { alert("ℹ️ ไม่มี Draft ที่รอส่ง"); return; }

  const incomplete = drafts.filter(d => !d.shop_id || !d.products?.length);
  if (incomplete.length) {
    alert(`❌ มี ${incomplete.length} รายการที่ข้อมูลยังไม่ครบ\nกรุณาแก้ไขก่อน`);
    return;
  }
  if (!confirm(`ยืนยันส่งรายงาน ${drafts.length} รายการ?\nรายงานที่ส่งแล้วจะไม่สามารถแก้ไขได้`)) return;

  try {
    const { data:{ session } } = await supabaseClient.auth.getSession();
    if (!session) { alert("❌ Session หมดอายุ"); return; }

    const now = new Date().toISOString();
    const rows = [];
    for (const d of drafts) {
      for (const p of (d.products || [])) {
        rows.push({
          report_date:  d.report_date,
          shop_id:      d.shop_id,
          product_id:   p.product_id,
          source:       d.source || null,
          status:       "submitted",
          status_visit: d.status_visit || null,
          note:         d.note,
          attributes:   p.attributes || {},
          sale_id:      session.user.id,
          submitted_at: now,
          created_at:   d.saved_at || now
        });
      }
    }

    const { error } = await supabaseClient.from("reports").insert(rows);
    if (error) throw error;

    saveDraftsToStorage([]);
    showToast(`📤 ส่งรายงาน ${rows.length} รายการสำเร็จ!`);
    await renderDraftList();
    await loadSubmittedReports();
  } catch(e) {
    console.error("submitAllDrafts", e);
    alert("❌ เกิดข้อผิดพลาด: " + e.message);
  }
}

// =====================================================
// 📋 LOAD SUBMITTED
// =====================================================
async function loadSubmittedReports() {
  const tbody = document.getElementById("reportBody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center">กำลังโหลด...</td></tr>`;
  try {
    const { data:{ session } } = await supabaseClient.auth.getSession();
    if (!session) return;

    const { data, error } = await supabaseClient
      .from("reports")
      .select("*")
      .eq("sale_id", session.user.id)
      .eq("status", "submitted")
      .order("submitted_at", { ascending: false });
    if (error) throw error;

    submittedReports = data || [];

    const missingProds = [...new Set(
      submittedReports.map(r => r.product_id).filter(id => id && !productsMap[id])
    )];
    if (missingProds.length) {
      const { data: prods } = await supabaseClient
        .from("products").select("id,name").in("id", missingProds);
      prods?.forEach(p => { productsMap[p.id] = p.name; });
    }

    await resolveShopNames(submittedReports.map(r => r.shop_id));
    await renderSubmittedTable();
  } catch(e) {
    console.error("loadSubmittedReports", e);
    tbody.innerHTML = `<tr><td colspan="6">เกิดข้อผิดพลาด</td></tr>`;
  }
}

// =====================================================
// 🎨 RENDER SUBMITTED TABLE
// =====================================================
function truncate(str, maxLen) {
  if (!str || str === "—") return str || "—";
  return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
}

function formatDateShort(s) {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("th-TH", { day: "numeric", month: "short" }); }
  catch(e) { return "—"; }
}

async function renderSubmittedTable() {
  const tbody = document.getElementById("reportBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!submittedReports.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#888;padding:24px;">ยังไม่มีรายงานที่ส่ง</td></tr>`;
    return;
  }

  for (const r of submittedReports) {
    const shopName = shopsMap[r.shop_id] || "—";
    const prodName = productsMap[r.product_id] || "—";
    const attrText = await formatAttrInline(r.attributes);
    const attrShort = truncate(attrText, 36);

    const ackBadge = r.manager_acknowledged
      ? `<span class="badge-ack">👁️ อ่านแล้ว</span>` : "";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td data-label="วันที่ส่ง">${formatDateShort(r.submitted_at || r.report_date)}</td>
      <td data-label="ร้านค้า" title="${escapeHtml(shopName)}">${escapeHtml(truncate(shopName, 10))}</td>
      <td data-label="สถานะ"><span class="badge-submitted">✅ ส่งแล้ว</span>${ackBadge}</td>
      <td data-label="รายละเอียด" title="${escapeHtml(r.note||"")}">${escapeHtml(truncate(r.note||"—", 22))}</td>
      <td data-label="สินค้า" title="${escapeHtml(prodName + (attrText ? ' · ' + attrText : ''))}">
        <div style="font-weight:500;">${escapeHtml(truncate(prodName, 16))}</div>
        ${attrShort && attrShort !== "—" ? `<div class="attr-sub">${escapeHtml(attrShort)}</div>` : ""}
      </td>
      <td>
        <div class="action-buttons">
          <button onclick="handleView('${r.id}')" title="ดูรายละเอียด" class="btn-action-view">👁️</button>
        </div>
      </td>`;
    tbody.appendChild(tr);
  }
}

// =====================================================
// 👁️ VIEW SUBMITTED
// =====================================================
async function handleView(id) {
  const r = submittedReports.find(x => x.id === id);
  if (!r) return;

  document.getElementById("modalTitle").innerText = "รายละเอียดรายงาน";
  const set = (eid, v) => { const el=document.getElementById(eid); if(el) el.innerText=v||"—"; };
  set("m-date",    formatDate(r.submitted_at||r.report_date));
  set("m-store",   shopsMap[r.shop_id]||"—");
  set("m-product", productsMap[r.product_id] || "—");
  set("m-source",  r.source||"—");
  set("m-status",  "✅ ส่งแล้ว" + (r.manager_acknowledged ? " • 👁️ ผู้บริหารอ่านแล้ว" : ""));

  const attrEl = document.getElementById("m-attributes");
  if (attrEl) attrEl.innerHTML = await formatAttributesBlock(r.attributes);

  const noteEl = document.getElementById("m-note");
  if (noteEl) { noteEl.value = r.note||""; noteEl.disabled = true; }

  const saveBtn = document.getElementById("saveEditBtn");
  if (saveBtn) saveBtn.style.display = "none";

  await loadManagerComments(id);
  openModal();
}

async function loadManagerComments(reportId) {
  const container = document.getElementById("m-manager-comments");
  if (!container) return;
  try {
    const { data } = await supabaseClient
      .from("report_comments")
      .select("comment, created_at, profiles(display_name)")
      .eq("report_id", reportId).order("created_at", { ascending: true });

    if (!data?.length) {
      container.innerHTML = `<div style="color:#aaa;font-size:12px;padding:4px 0;">ยังไม่มี comment จากผู้บริหาร</div>`;
      return;
    }
    container.innerHTML = data.map(c => `
      <div style="background:#f0fdf4;border-left:3px solid #10b981;border-radius:6px;padding:8px 10px;margin-bottom:6px;">
        <div style="font-size:11px;color:#888;margin-bottom:3px;">
          <strong>${escapeHtml(c.profiles?.display_name||"ผู้บริหาร")}</strong> · ${formatDate(c.created_at)}
        </div>
        <div style="font-size:13px;">${escapeHtml(c.comment)}</div>
      </div>`).join("");
  } catch(e) { container.innerHTML = ""; }
}

function openModal()  { const m=document.getElementById("reportModal"); if(m){ m.style.display="flex"; document.body.style.overflow="hidden"; } }
function closeModal() { const m=document.getElementById("reportModal"); if(m){ m.style.display="none";  document.body.style.overflow=""; } }

// =====================================================
// FORM HELPERS
// =====================================================
function collectFormData() {
  return {
    report_date:  document.getElementById("reportDate")?.value      || null,
    province:     document.getElementById("provinceSelect")?.value  || null,
    shop_id:      document.getElementById("shopSelect")?.value      || null,
    status_visit: document.getElementById("status")?.value          || null,
    note:         document.getElementById("note")?.value            || null,
    products:     selectedProducts.map(p => ({
      product_id: p.product_id,
      attributes: p.attributes || {}
    }))
  };
}

function clearForm() {
  document.getElementById("reportDate").valueAsDate = new Date();

  const provSel = document.getElementById("provinceSelect");
  if (provSel) provSel.value = "";

  const shopSel = document.getElementById("shopSelect");
  if (shopSel) {
    shopSel.innerHTML = `<option value="">-- เลือกจังหวัดก่อน --</option>`;
    shopSel.disabled = true;
  }

  ["status"].forEach(id => {
    const el = document.getElementById(id); if(el) el.selectedIndex = 0;
  });
  document.getElementById("note").value = "";

  // reset picker
  const catSel  = document.getElementById("pickerCategory");
  const prodSel = document.getElementById("pickerProduct");
  const attrBox = document.getElementById("pickerAttributes");
  if (catSel)  catSel.value = "";
  if (prodSel) prodSel.innerHTML = `<option value="">-- เลือกสินค้า --</option>`;
  if (attrBox) attrBox.innerHTML = "";

  // clear selected list
  selectedProducts = [];
  renderSelectedProducts();
}

function setDefaultDate() {
  const d = document.getElementById("reportDate");
  if (d) d.valueAsDate = new Date();
}

// =====================================================
// PROVINCES / SHOPS
// =====================================================
async function loadProvinces() {
  try {
    const { data } = await supabaseClient
      .from("shops").select("province")
      .eq("status","Active").not("province","is",null);
    const sel = document.getElementById("provinceSelect");
    if (!sel) return;
    const provinces = [...new Set((data||[]).map(s=>s.province).filter(Boolean))].sort();
    sel.innerHTML = `<option value="">-- เลือกจังหวัด --</option>`;
    provinces.forEach(p => {
      const o = document.createElement("option");
      o.value = p; o.textContent = p; sel.appendChild(o);
    });
  } catch(e) { console.error("loadProvinces", e); }
}

async function loadShopsByProvince(province) {
  const sel = document.getElementById("shopSelect");
  if (!sel) return;
  sel.innerHTML = `<option value="">-- เลือกร้านค้า --</option>`;
  sel.disabled = true;
  if (!province) return;
  try {
    const { data } = await supabaseClient
      .from("shops").select("id,shop_name")
      .eq("status","Active").eq("province", province).order("shop_name");
    data?.forEach(s => {
      shopsMap[s.id] = s.shop_name;
      const o = document.createElement("option");
      o.value = s.id; o.textContent = s.shop_name; sel.appendChild(o);
    });
    sel.disabled = false;
  } catch(e) { console.error("loadShopsByProvince", e); }
}

// =====================================================
// EVENT LISTENERS
// =====================================================
function setupEventListeners() {
  const prov = document.getElementById("provinceSelect");
  if (prov) prov.addEventListener("change", e => loadShopsByProvince(e.target.value));

  // Picker events
  const pickerCat = document.getElementById("pickerCategory");
  if (pickerCat) pickerCat.addEventListener("change", e => onPickerCategoryChange(e.target.value));

  const pickerProd = document.getElementById("pickerProduct");
  if (pickerProd) pickerProd.addEventListener("change", e => onPickerProductChange(e.target.value));

  const addBtn = document.getElementById("addProductBtn");
  if (addBtn) addBtn.addEventListener("click", addSelectedProduct);

  const closeBtn = document.getElementById("closeModalBtn");
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  const modal = document.getElementById("reportModal");
  if (modal) modal.addEventListener("click", e => { if(e.target===modal) closeModal(); });
}

// =====================================================
// EXPORT CSV
// =====================================================
function exportData(type) {
  if (type !== "csv") { alert("🚧 ฟีเจอร์นี้กำลังพัฒนา"); return; }
  if (!submittedReports.length) { alert("ไม่มีข้อมูล"); return; }
  const headers = ["วันที่ส่ง","ร้านค้า","สินค้า","รายละเอียด","ผู้บริหารอ่านแล้ว"];
  const rows = submittedReports.map(r => [
    formatDate(r.submitted_at||r.report_date),
    shopsMap[r.shop_id]||"—",
    productsMap[r.product_id] || "—",
    (r.note||"—").replace(/,/g," "),
    r.manager_acknowledged?"ใช่":"ยังไม่"
  ]);
  const csv = [headers,...rows].map(r=>r.map(c=>`"${c}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `my_reports_${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
}

// =====================================================
// HELPERS
// =====================================================
function formatDate(s) {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("th-TH",{year:"numeric",month:"long",day:"numeric"}); }
  catch(e) { return "—"; }
}

async function formatAttributesBlock(attrs) {
  if (!attrs || !Object.keys(attrs).length) return "";
  try {
    const { data:ad } = await supabaseClient.from("attributes")
      .select("id,name").in("id",Object.keys(attrs));
    const am = Object.fromEntries((ad||[]).map(a=>[a.id,a.name]));
    return `<div style="background:#f8fafc;border-radius:6px;padding:8px;font-size:13px;">` +
      Object.entries(attrs).map(([k,v])=>`<strong>${escapeHtml(am[k]||k)}:</strong> ${escapeHtml(v)}`).join("<br>") +
      `</div>`;
  } catch(e) { return ""; }
}

function escapeHtml(t) {
  if (!t) return "";
  const d = document.createElement("div"); d.textContent = t; return d.innerHTML;
}

function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) { console.log(msg); return; }
  t.textContent = msg; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3000);
}

function setupLogout() {
  const btn = document.getElementById("logoutBtn"); if(!btn) return;
  btn.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    window.location.href = "/pages/auth/login.html";
  });
}