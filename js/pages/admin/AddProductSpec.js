// =====================================================
// AddProductSpec.js  —  CRUD ครบ 5 ตาราง
// categories / products / product_variants
// attributes / attribute_options
// =====================================================

// ── Cache ──
let _cats  = [];   // { id, name }
let _prods = [];   // { id, name, category_id, sku, description }
let _attrs = [];   // { id, name, product_id, category_id, input_type, order_no }
let _vars  = [];   // product_variants
let _opts  = [];   // attribute_options

// ===============================
// AUTO SKU
// ===============================
function generateSKU(categoryName) {
  if (!categoryName) return 'SKU-' + Date.now();
  const code = categoryName.substring(0, 3).toUpperCase();
  const time = Date.now().toString().slice(-5);
  return `${code}-${time}`;
}

// ── Modal state ──
let modalMode   = null;   // 'add' | 'edit'
let modalTable  = null;   // 'cat'|'prod'|'var'|'attr'|'opt'
let modalEditId = null;
let pendingOpts = [];     // { id, value, existing, deleted }

// =====================================================
// INIT
// =====================================================
document.addEventListener("DOMContentLoaded", async () => {
  await waitForSupabase();

  try {
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError || !session) {
      location.href = "/pages/auth/login.html";
      return;
    }

    const { data: profile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("role, display_name")
      .eq("id", session.user.id)
      .single();

    if (profileError) {
      showToast("ไม่สามารถตรวจสอบสิทธิ์", "err");
      setTimeout(() => location.href = "/pages/auth/login.html", 1500);
      return;
    }

    if (!profile || !["admin", "manager"].includes(profile.role)) {
      showToast("คุณไม่มีสิทธิ์เข้าถึงหน้านี้", "err");
      setTimeout(() => location.href = "/index.html", 1500);
      return;
    }

    const displayName = profile.display_name || session.user.email;
    const userNameEl   = document.getElementById("userName");
    const userAvatarEl = document.getElementById("userAvatar");
    if (userNameEl)   userNameEl.textContent   = displayName;
    if (userAvatarEl) userAvatarEl.textContent = displayName.charAt(0).toUpperCase();

  } catch (e) {
    console.error("Auth error:", e);
    location.href = "/pages/auth/login.html";
    return;
  }

  // Tabs
  document.querySelectorAll(".am-tab").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // Logout
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await supabaseClient.auth.signOut();
      location.href = "/pages/auth/login.html";
    });
  }

  // Chip Enter key
  document.addEventListener("keydown", e => {
    if (e.key === "Enter" && document.getElementById("mf-optval") === document.activeElement) {
      e.preventDefault();
      addChip();
    }
  });

  // Auto SKU เมื่อเปลี่ยน category ใน form prod
  document.addEventListener("change", e => {
    if (e.target.id === "mf-cat" && modalTable === "prod" && !_skuManual) {
      const catName = e.target.options[e.target.selectedIndex].text;
      const skuInput = document.getElementById("mf-sku");
      if (skuInput) skuInput.value = generateSKU(catName);
    }
  });
  document.addEventListener("input", e => {
    if (e.target.id === "mf-sku") _skuManual = true;
  });

  await refreshCache();
  await backfillCategoryId();
  await Promise.all([
    loadCategories(),
    loadProducts(),
    loadVariants(),
    loadAttributes(),
    loadOptions(),
  ]);
  populateAllFilters();
});

let _skuManual = false;

async function waitForSupabase() {
  let attempts = 0;
  while (!window.supabaseClient && attempts < 50) {
    await new Promise(r => setTimeout(r, 100));
    attempts++;
  }
  if (!window.supabaseClient) throw new Error("Supabase client ไม่พร้อม");
}

// =====================================================
// BACKFILL category_id ใน attributes ที่เป็น NULL
// =====================================================
async function backfillCategoryId() {
  try {
    const { data: nullAttrs, error } = await supabaseClient
      .from("attributes")
      .select("id,product_id")
      .is("category_id", null);

    if (error || !nullAttrs?.length) return;

    const updates = nullAttrs
      .map(a => ({ id: a.id, category_id: getCatIdByProd(a.product_id) }))
      .filter(a => a.category_id);

    if (!updates.length) return;

    await Promise.all(updates.map(u =>
      supabaseClient.from("attributes").update({ category_id: u.category_id }).eq("id", u.id)
    ));

    console.log(`✅ backfill category_id สำเร็จ ${updates.length} records`);
    await refreshCache();
  } catch (e) {
    console.warn("backfillCategoryId:", e);
  }
}


function switchTab(tab) {
  document.querySelectorAll(".am-tab").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".am-panel").forEach(p =>
    p.classList.toggle("active", p.id === `tab-${tab}`));
}

// =====================================================
// CACHE
// =====================================================
async function refreshCache() {
  try {
    const [c, p, a] = await Promise.all([
      supabaseClient.from("categories").select("id,name").order("name"),
      supabaseClient.from("products").select("id,name,category_id").order("name"),
      supabaseClient.from("attributes").select("id,name,product_id,category_id,input_type,order_no").order("name"),
    ]);
    _cats  = c.data || [];
    _prods = p.data || [];
    _attrs = a.data || [];
  } catch (e) {
    console.error("refreshCache:", e);
  }
}

function getCatName(id)  { return _cats.find(c => c.id === id)?.name  || "—"; }
function getProdName(id) { return _prods.find(p => p.id === id)?.name || "—"; }
function getAttrName(id) { return _attrs.find(a => a.id === id)?.name || "—"; }

function getCatIdByProd(prodId) {
  return _prods.find(p => p.id === prodId)?.category_id || null;
}

// =====================================================
// POPULATE ALL FILTER SELECTS
// =====================================================
function populateAllFilters() {
  ["prod-filter-cat","var-filter-cat","attr-filter-cat","opt-filter-cat"].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    const label = (id.includes("var") || id.includes("opt")) ? "ทุกหมวด" : "ทุกหมวดหมู่";
    sel.innerHTML = `<option value="">${label}</option>`;
    _cats.forEach(c => {
      const o = document.createElement("option");
      o.value = c.id; o.textContent = c.name;
      sel.appendChild(o);
    });
    if (cur) sel.value = cur;
  });
}

async function onVarFilterCat() {
  const catId = document.getElementById("var-filter-cat").value;
  const sel   = document.getElementById("var-filter-prod");
  sel.innerHTML = `<option value="">ทุกสินค้า</option>`;
  const prods = catId ? _prods.filter(p => p.category_id === catId) : _prods;
  prods.forEach(p => {
    const o = document.createElement("option");
    o.value = p.id; o.textContent = p.name;
    sel.appendChild(o);
  });
  await loadVariants();
}

async function onOptFilterCat() {
  const catId = document.getElementById("opt-filter-cat").value;
  const sel   = document.getElementById("opt-filter-attr");
  sel.innerHTML = `<option value="">ทุก Attribute</option>`;

  const attrs = catId
    ? _attrs.filter(a => {
        const prod = _prods.find(p => p.id === a.product_id);
        return prod?.category_id === catId;
      })
    : _attrs;

  attrs.forEach(a => {
    const o = document.createElement("option");
    o.value = a.id;
    o.textContent = `${a.name} (${getProdName(a.product_id)})`;
    sel.appendChild(o);
  });
  await loadOptions();
}

// =====================================================
// ── CATEGORIES ──
// =====================================================
async function loadCategories() {
  const tbody = document.getElementById("cat-body");
  try {
    const { data, error } = await supabaseClient
      .from("categories").select("id,name,created_at").order("name");
    if (error) throw error;
    _cats = data || [];
    populateAllFilters();
    document.getElementById("cat-count").textContent = `${_cats.length} รายการ`;
    if (!_cats.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="am-empty">ยังไม่มีหมวดหมู่</td></tr>`;
      return;
    }
    tbody.innerHTML = _cats.map(c => `
      <tr>
        <td data-label="ชื่อ"><strong>${esc(c.name)}</strong></td>
        <td data-label="วันที่">${fmtDate(c.created_at)}</td>
        <td data-label="จัดการ">
          <button class="act-btn act-edit" onclick="openEdit('cat','${c.id}')">✏️ แก้ไข</button>
          <button class="act-btn act-del"  onclick="delRow('cat','${c.id}','${esc(c.name)}')">🗑️</button>
        </td>
      </tr>`).join("");
  } catch (e) {
    console.error("loadCategories:", e);
    tbody.innerHTML = `<tr><td colspan="3" class="am-empty">โหลดไม่สำเร็จ</td></tr>`;
  }
}

// =====================================================
// ── PRODUCTS ──
// =====================================================
async function loadProducts() {
  const tbody = document.getElementById("prod-body");
  const catId = document.getElementById("prod-filter-cat")?.value || "";
  try {
    let q = supabaseClient.from("products")
      .select("id,name,category_id,sku,description,created_at").order("name");
    if (catId) q = q.eq("category_id", catId);
    const { data, error } = await q;
    if (error) throw error;
    _prods = data || [];
    document.getElementById("prod-count").textContent = `${_prods.length} รายการ`;
    if (!_prods.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="am-empty">ยังไม่มีสินค้า</td></tr>`;
      return;
    }
    tbody.innerHTML = _prods.map(p => `
      <tr>
        <td data-label="ชื่อสินค้า"><strong>${esc(p.name)}</strong></td>
        <td data-label="หมวด"><span class="badge badge-teal">${esc(getCatName(p.category_id))}</span></td>
        <td data-label="SKU"><code>${esc(p.sku||"—")}</code></td>
        <td data-label="คำอธิบาย" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.description||"—")}</td>
        <td data-label="จัดการ">
          <button class="act-btn act-edit" onclick="openEdit('prod','${p.id}')">✏️ แก้ไข</button>
          <button class="act-btn act-del"  onclick="delRow('prod','${p.id}','${esc(p.name)}')">🗑️</button>
        </td>
      </tr>`).join("");
  } catch (e) {
    console.error("loadProducts:", e);
    tbody.innerHTML = `<tr><td colspan="5" class="am-empty">โหลดไม่สำเร็จ</td></tr>`;
  }
}

// =====================================================
// ── VARIANTS ──
// =====================================================
async function loadVariants() {
  const tbody  = document.getElementById("var-body");
  const prodId = document.getElementById("var-filter-prod")?.value || "";
  const catId  = document.getElementById("var-filter-cat")?.value  || "";
  try {
    let q = supabaseClient.from("product_variants")
      .select("id,product_id,sku,color,brand,length,width,thickness,feature,status,created_at")
      .order("created_at", { ascending: false });

    if (prodId) {
      q = q.eq("product_id", prodId);
    } else if (catId) {
      const pids = _prods.filter(p => p.category_id === catId).map(p => p.id);
      if (!pids.length) {
        tbody.innerHTML = `<tr><td colspan="10" class="am-empty">ไม่มีสินค้าในหมวดนี้</td></tr>`;
        document.getElementById("var-count").textContent = "0 รายการ";
        return;
      }
      q = q.in("product_id", pids);
    }

    const { data, error } = await q.limit(200);
    if (error) throw error;
    _vars = data || [];
    document.getElementById("var-count").textContent = `${_vars.length} รายการ`;
    if (!_vars.length) {
      tbody.innerHTML = `<tr><td colspan="10" class="am-empty">ยังไม่มี Variant</td></tr>`;
      return;
    }
    tbody.innerHTML = _vars.map(v => `
      <tr>
        <td data-label="สินค้า"><span class="badge badge-teal">${esc(getProdName(v.product_id))}</span></td>
        <td data-label="SKU"><code>${esc(v.sku||"—")}</code></td>
        <td data-label="สี">${badge(v.color,"badge-blue")}</td>
        <td data-label="ยาว">${esc(v.length||"—")}</td>
        <td data-label="กว้าง">${esc(v.width||"—")}</td>
        <td data-label="หนา">${esc(v.thickness||"—")}</td>
        <td data-label="ยี่ห้อ">${esc(v.brand||"—")}</td>
        <td data-label="Feature">${esc(v.feature||"—")}</td>
        <td data-label="Status">${badge(v.status, v.status==="active"?"badge-teal":v.status==="inactive"?"badge-amber":"badge-red")}</td>
        <td data-label="จัดการ">
          <button class="act-btn act-edit" onclick="openEdit('var','${v.id}')">✏️</button>
          <button class="act-btn act-del"  onclick="delRow('var','${v.id}','Variant')">🗑️</button>
        </td>
      </tr>`).join("");
  } catch (e) {
    console.error("loadVariants:", e);
    tbody.innerHTML = `<tr><td colspan="10" class="am-empty">โหลดไม่สำเร็จ</td></tr>`;
  }
}

// =====================================================
// ── ATTRIBUTES ──
// =====================================================
async function loadAttributes() {
  const tbody = document.getElementById("attr-body");
  const catId = document.getElementById("attr-filter-cat")?.value || "";
  try {
    let q = supabaseClient
      .from("attributes")
      .select("id,name,product_id,input_type,order_no")
      .order("order_no", { ascending: true, nullsFirst: false });

    if (catId) {
      const prodIds = _prods.filter(p => p.category_id === catId).map(p => p.id);
      if (!prodIds.length) {
        _attrs = [];
        document.getElementById("attr-count").textContent = "0 รายการ";
        tbody.innerHTML = `<tr><td colspan="5" class="am-empty">ไม่มีสินค้าในหมวดนี้</td></tr>`;
        return;
      }
      q = q.in("product_id", prodIds);
    }

    const { data, error } = await q;
    if (error) throw error;
    _attrs = data || [];
    document.getElementById("attr-count").textContent = `${_attrs.length} รายการ`;

    if (!_attrs.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="am-empty">ยังไม่มี Attribute</td></tr>`;
      return;
    }

    tbody.innerHTML = _attrs.map(a => `
      <tr>
        <td data-label="ชื่อ Attribute"><strong>${esc(a.name)}</strong></td>
        <td data-label="สินค้า">
          <span class="badge badge-teal">${esc(getProdName(a.product_id))}</span>
          <span class="badge badge-gray" style="margin-left:4px">${esc(getCatName(getCatIdByProd(a.product_id)))}</span>
        </td>
        <td data-label="ประเภท Input"><code>${esc(a.input_type || "—")}</code></td>
        <td data-label="ลำดับ">${a.order_no ?? "—"}</td>
        <td data-label="จัดการ">
          <button class="act-btn act-edit" onclick="openEdit('attr','${a.id}')">✏️ แก้ไข</button>
          <button class="act-btn act-del"  onclick="delRow('attr','${a.id}','${esc(a.name)}')">🗑️</button>
        </td>
      </tr>`).join("");
  } catch (e) {
    console.error("loadAttributes:", e);
    tbody.innerHTML = `<tr><td colspan="5" class="am-empty">โหลดไม่สำเร็จ</td></tr>`;
  }
}

// =====================================================
// ── OPTIONS ──
// =====================================================
async function loadOptions() {
  const tbody  = document.getElementById("opt-body");
  const attrId = document.getElementById("opt-filter-attr")?.value || "";
  const catId  = document.getElementById("opt-filter-cat")?.value  || "";
  try {
    let q = supabaseClient.from("attribute_options")
      .select("id,attribute_id,value,created_at").order("value");

    if (attrId) {
      q = q.eq("attribute_id", attrId);
    } else if (catId) {
      const prodIds = _prods.filter(p => p.category_id === catId).map(p => p.id);
      const aids    = _attrs.filter(a => prodIds.includes(a.product_id)).map(a => a.id);
      if (!aids.length) {
        tbody.innerHTML = `<tr><td colspan="4" class="am-empty">ไม่มี Attribute ในหมวดนี้</td></tr>`;
        document.getElementById("opt-count").textContent = "0 รายการ";
        return;
      }
      q = q.in("attribute_id", aids);
    }

    const { data, error } = await q.limit(300);
    if (error) throw error;
    _opts = data || [];
    document.getElementById("opt-count").textContent = `${_opts.length} รายการ`;

    if (!_opts.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="am-empty">ยังไม่มี Option</td></tr>`;
      return;
    }

    tbody.innerHTML = _opts.map(o => {
      const attr    = _attrs.find(a => a.id === o.attribute_id);
      const catName = attr ? getCatName(getCatIdByProd(attr.product_id)) : "—";
      return `
        <tr>
          <td data-label="ค่า"><strong>${esc(o.value)}</strong></td>
          <td data-label="Attribute"><span class="badge badge-purple">${esc(getAttrName(o.attribute_id))}</span></td>
          <td data-label="หมวด"><span class="badge badge-teal">${esc(catName)}</span></td>
          <td data-label="จัดการ">
            <button class="act-btn act-del" onclick="delRow('opt','${o.id}','${esc(o.value)}')">🗑️ ลบ</button>
          </td>
        </tr>`;
    }).join("");
  } catch (e) {
    console.error("loadOptions:", e);
    tbody.innerHTML = `<tr><td colspan="4" class="am-empty">โหลดไม่สำเร็จ</td></tr>`;
  }
}

// =====================================================
// MODAL — OPEN ADD
// =====================================================
function openAdd(table) {
  modalMode   = "add";
  modalTable  = table;
  modalEditId = null;
  pendingOpts = [];
  _skuManual  = false;

  document.getElementById("modalTitle").textContent = addTitle(table);
  document.getElementById("modalBody").innerHTML    = buildForm(table, null);
  openModal();
}

// =====================================================
// MODAL — OPEN EDIT
// =====================================================
async function openEdit(table, id) {
  modalMode   = "edit";
  modalTable  = table;
  modalEditId = id;
  pendingOpts = [];
  _skuManual  = true;

  let row = null;
  try {
    const { data } = await supabaseClient.from(tableOf(table)).select("*").eq("id", id).single();
    row = data;
  } catch (e) {
    showToast("โหลดข้อมูลไม่สำเร็จ", "err");
    return;
  }

  document.getElementById("modalTitle").textContent = editTitle(table);
  document.getElementById("modalBody").innerHTML    = buildForm(table, row);

  if (table === "attr" && row) {
    const typeEl  = document.getElementById("mf-type");
    const orderEl = document.getElementById("mf-order");
    const prodEl  = document.getElementById("mf-prod");
    if (typeEl  && row.input_type) typeEl.value  = row.input_type;
    if (orderEl && row.order_no  ) orderEl.value = row.order_no;
    if (prodEl  && row.product_id) prodEl.value  = row.product_id;
    await loadExistingOpts(id);
  }

  openModal();
}

// =====================================================
// BUILD FORM HTML
// =====================================================
function buildForm(table, row) {
  const v = row || {};

  const catOpts  = _cats.map(c =>
    `<option value="${c.id}" ${v.category_id===c.id?"selected":""}>${esc(c.name)}</option>`).join("");
  const prodOpts = _prods.map(p =>
    `<option value="${p.id}" ${v.product_id===p.id?"selected":""}>${esc(p.name)} (${esc(getCatName(p.category_id))})</option>`).join("");
  const attrOpts = _attrs.map(a =>
    `<option value="${a.id}" ${v.attribute_id===a.id?"selected":""}>${esc(a.name)} — ${esc(getProdName(a.product_id))}</option>`).join("");

  if (table === "cat") return `
    <div class="mf">
      <label>ชื่อหมวดหมู่ <span class="req">*</span></label>
      <input type="text" id="mf-name" value="${esc(v.name||"")}" placeholder="เช่น ตาข่ายกรองแสง, ถุงเพาะชำ"/>
    </div>`;

  if (table === "prod") return `
    <div class="mf">
      <label>หมวดหมู่ <span class="req">*</span></label>
      <select id="mf-cat"><option value="">-- เลือก --</option>${catOpts}</select>
    </div>
    <div class="mf">
      <label>ชื่อสินค้า <span class="req">*</span></label>
      <input type="text" id="mf-name" value="${esc(v.name||"")}" placeholder="เช่น ตาข่าย 50%"/>
    </div>
    <div class="mf">
      <label>SKU</label>
      <input type="text" id="mf-sku" value="${esc(v.sku||"")}" placeholder="รหัสสินค้า (auto-generate ถ้าไม่กรอก)"/>
    </div>
    <div class="mf">
      <label>คำอธิบาย</label>
      <textarea id="mf-desc">${esc(v.description||"")}</textarea>
    </div>`;

  if (table === "var") return `
    <div class="mf">
      <label>สินค้า <span class="req">*</span></label>
      <select id="mf-prod"><option value="">-- เลือก --</option>${prodOpts}</select>
    </div>
    <div class="mf">
      <label>SKU Variant</label>
      <input type="text" id="mf-sku" value="${esc(v.sku||"")}" placeholder="เช่น NET-BLK-2x100m"/>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="mf" style="margin:0">
        <label>สี (color)</label>
        <input type="text" id="mf-color" value="${esc(v.color||"")}" placeholder="ดำ, เขียว, ขาว"/>
      </div>
      <div class="mf" style="margin:0">
        <label>ยี่ห้อ (brand)</label>
        <input type="text" id="mf-brand" value="${esc(v.brand||"")}" placeholder="ยี่ห้อ"/>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:12px">
      <div class="mf" style="margin:0">
        <label>ความยาว</label>
        <input type="text" id="mf-length" value="${esc(v.length||"")}" placeholder="50m, 100y"/>
      </div>
      <div class="mf" style="margin:0">
        <label>ความกว้าง</label>
        <input type="text" id="mf-width" value="${esc(v.width||"")}" placeholder="2m, 4m"/>
      </div>
      <div class="mf" style="margin:0">
        <label>ความหนา</label>
        <input type="text" id="mf-thick" value="${esc(v.thickness||"")}" placeholder="0.10mm"/>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
      <div class="mf" style="margin:0">
        <label>Feature</label>
        <input type="text" id="mf-feat" value="${esc(v.feature||"")}" placeholder="คุณสมบัติพิเศษ"/>
      </div>
      <div class="mf" style="margin:0">
        <label>Status</label>
        <select id="mf-status">
          <option value="active"       ${(v.status||"active")==="active"       ?"selected":""}>active</option>
          <option value="inactive"     ${v.status==="inactive"     ?"selected":""}>inactive</option>
          <option value="discontinued" ${v.status==="discontinued" ?"selected":""}>discontinued</option>
        </select>
      </div>
    </div>`;

  if (table === "attr") return `
    <div class="mf">
      <label>สินค้า <span class="req">*</span></label>
      <select id="mf-prod">
        <option value="">-- เลือก --</option>
        ${prodOpts}
      </select>
    </div>
    <div class="mf">
      <label>ชื่อ Attribute <span class="req">*</span></label>
      <input type="text" id="mf-name" value="${esc(v.name||"")}" placeholder="เช่น สี, ขนาด"/>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="mf" style="margin:0">
        <label>ประเภท Input</label>
        <select id="mf-type">
          <option value="select">select</option>
          <option value="text">text</option>
          <option value="number">number</option>
        </select>
      </div>
      <div class="mf" style="margin:0">
        <label>ลำดับ</label>
        <input type="number" id="mf-order" value="${v.order_no ?? ""}" placeholder="1, 2, 3…"/>
      </div>
    </div>
    <div class="mf" style="margin-top:12px">
      <label>ตัวเลือก (Options)</label>
      <div class="chip-row" id="optChips"></div>
      <div class="chip-add-row">
        <input type="text" id="mf-optval" placeholder="พิมพ์แล้ว Enter หรือกด + เพิ่ม"/>
        <button class="chip-add-btn" onclick="addChip()">+ เพิ่ม</button>
      </div>
    </div>`;

  if (table === "opt") return `
    <div class="mf">
      <label>Attribute <span class="req">*</span></label>
      <select id="mf-attr"><option value="">-- เลือก --</option>${attrOpts}</select>
    </div>
    <div class="mf">
      <label>ค่า (Value) <span class="req">*</span></label>
      <input type="text" id="mf-value" value="${esc(v.value||"")}" placeholder="เช่น ดำ, 50%, 2m x 100m"/>
    </div>`;

  return "";
}

// =====================================================
// OPTION CHIPS
// =====================================================
async function loadExistingOpts(attrId) {
  try {
    const { data } = await supabaseClient.from("attribute_options")
      .select("id,value").eq("attribute_id", attrId).order("value");
    pendingOpts = (data||[]).map(o => ({ id: o.id, value: o.value, existing: true, deleted: false }));
    renderChips();
  } catch (e) {
    console.error("loadExistingOpts:", e);
  }
}

function addChip() {
  const inp = document.getElementById("mf-optval");
  const val = inp?.value?.trim();
  if (!val) return;
  if (pendingOpts.some(o => o.value === val && !o.deleted)) {
    showToast("มีตัวเลือกนี้อยู่แล้ว", "err");
    return;
  }
  pendingOpts.push({ id: null, value: val, existing: false, deleted: false });
  inp.value = "";
  inp.focus();
  renderChips();
}

function removeChip(idx) {
  const opt = pendingOpts[idx];
  if (opt.existing) {
    pendingOpts[idx].deleted = true;
  } else {
    pendingOpts.splice(idx, 1);
  }
  renderChips();
}

function renderChips() {
  const el = document.getElementById("optChips");
  if (!el) return;
  const visible = pendingOpts.filter(o => !o.deleted);
  if (!visible.length) {
    el.innerHTML = `<span style="font-size:12px;color:#94a3b8">ยังไม่มีตัวเลือก</span>`;
    return;
  }
  el.innerHTML = pendingOpts.map((o, i) => {
    if (o.deleted) return "";
    return `<span class="chip">${esc(o.value)}<button class="chip-del" onclick="removeChip(${i})">×</button></span>`;
  }).join("");
}

// =====================================================
// MODAL — SAVE
// =====================================================
async function modalSave() {
  const btn = document.getElementById("modalSaveBtn");
  btn.disabled = true;
  btn.textContent = "⏳ กำลังบันทึก...";
  try {
    if (modalTable === "cat")  await saveCat();
    if (modalTable === "prod") await saveProd();
    if (modalTable === "var")  await saveVar();
    if (modalTable === "attr") await saveAttr();
    if (modalTable === "opt")  await saveOpt();
  } catch (e) {
    console.error("modalSave:", e);
    showToast("บันทึกไม่สำเร็จ: " + (e.message || "unknown"), "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "💾 บันทึก";
  }
}

function gv(id) { return document.getElementById(id)?.value?.trim() || null; }

async function saveCat() {
  const name = gv("mf-name");
  if (!name) { showToast("กรุณากรอกชื่อ", "err"); return; }
  await upsert("categories", { name }, modalEditId);
  showToast(`✅ ${modalMode==="add"?"เพิ่ม":"แก้ไข"}หมวดหมู่สำเร็จ`, "ok");
  closeModal();
  await refreshCache();
  await loadCategories();
}

async function saveProd() {
  const name  = gv("mf-name");
  const catId = gv("mf-cat");
  if (!name || !catId) { showToast("กรุณากรอกข้อมูลให้ครบ", "err"); return; }

  let sku = gv("mf-sku");
  if (!sku) sku = generateSKU(getCatName(catId));

  await upsert("products", { name, category_id: catId, sku, description: gv("mf-desc") || null }, modalEditId);
  showToast(`✅ ${modalMode==="add"?"เพิ่ม":"แก้ไข"}สินค้าสำเร็จ`, "ok");
  closeModal();
  await refreshCache();
  await loadProducts();
}

async function saveVar() {
  const prodId = gv("mf-prod");
  if (!prodId) { showToast("กรุณาเลือกสินค้า", "err"); return; }
  await upsert("product_variants", {
    product_id: prodId,
    sku:        gv("mf-sku"),
    color:      gv("mf-color"),
    brand:      gv("mf-brand"),
    length:     gv("mf-length"),
    width:      gv("mf-width"),
    thickness:  gv("mf-thick"),
    feature:    gv("mf-feat"),
    status:     gv("mf-status") || "active",
  }, modalEditId);
  showToast(`✅ ${modalMode==="add"?"เพิ่ม":"แก้ไข"} Variant สำเร็จ`, "ok");
  closeModal();
  await loadVariants();
}

async function saveAttr() {
  const name   = gv("mf-name");
  const prodId = gv("mf-prod");
  if (!name || !prodId) { showToast("กรุณากรอกข้อมูลให้ครบ", "err"); return; }

  const catId = getCatIdByProd(prodId);
  if (!catId) { showToast("ไม่พบ category ของสินค้านี้", "err"); return; }

  const orderVal = document.getElementById("mf-order")?.value;
  const orderNo  = orderVal ? parseInt(orderVal) : null;

  const attrId = await upsert("attributes", {
    name,
    product_id:  prodId,
    category_id: catId,
    input_type:  gv("mf-type") || "select",
    order_no:    isNaN(orderNo) ? null : orderNo,
  }, modalEditId);

  const targetId = modalEditId || attrId;
  if (!targetId) { showToast("บันทึก Attribute ไม่สำเร็จ (ไม่ได้รับ ID)", "err"); return; }

  const toDelete = pendingOpts.filter(o => o.existing && o.deleted && o.id);
  if (toDelete.length) {
    const delIds = toDelete.map(o => o.id);
    const { error: delErr } = await supabaseClient.from("attribute_options").delete().in("id", delIds);
    if (delErr) throw delErr;
  }

  const toInsert = pendingOpts.filter(o => !o.existing && !o.deleted);
  if (toInsert.length) {
    const rows = toInsert.map(o => ({ attribute_id: targetId, value: o.value }));
    const { error: insErr } = await supabaseClient.from("attribute_options").insert(rows);
    if (insErr) throw insErr;
  }

  showToast("✅ บันทึก Attribute สำเร็จ", "ok");
  closeModal();
  await refreshCache();
  await loadAttributes();
  await loadOptions();
}

async function saveOpt() {
  const attrId = gv("mf-attr");
  const value  = gv("mf-value");
  if (!attrId || !value) { showToast("กรุณากรอกข้อมูลให้ครบ", "err"); return; }
  const { error } = await supabaseClient.from("attribute_options").insert({ attribute_id: attrId, value });
  if (error) throw error;
  showToast("✅ เพิ่ม Option สำเร็จ", "ok");
  closeModal();
  await loadOptions();
}

// generic upsert — return id เสมอ
async function upsert(tbl, payload, editId) {
  let data, error;
  if (editId) {
    ({ data, error } = await supabaseClient.from(tbl).update(payload).eq("id", editId).select("id").single());
  } else {
    ({ data, error } = await supabaseClient.from(tbl).insert(payload).select("id").single());
  }
  if (error) throw error;
  return data?.id ?? null;
}

// =====================================================
// DELETE
// =====================================================
async function delRow(table, id, label) {
  const warnings = {
    cat:  "(products, variants, attributes และ options ทั้งหมดในหมวดนี้จะถูกลบด้วย)",
    prod: "(variants, attributes และ options ของสินค้านี้จะถูกลบด้วย)",
    attr: "(attribute_options ทั้งหมดจะถูกลบด้วย)",
    var:  "",
    opt:  "",
  };
  if (!confirm(`ลบ "${label}"?\n${warnings[table] || ""}`)) return;

  try {
    // ── Cascade: categories ──
    if (table === "cat") {
      const prodIds = _prods.filter(p => p.category_id === id).map(p => p.id);
      if (prodIds.length) {
        const attrIds = _attrs.filter(a => prodIds.includes(a.product_id)).map(a => a.id);
        if (attrIds.length) {
          await supabaseClient.from("attribute_options").delete().in("attribute_id", attrIds);
          await supabaseClient.from("attributes").delete().in("id", attrIds);
        }
        await supabaseClient.from("product_variants").delete().in("product_id", prodIds);
        await supabaseClient.from("products").delete().in("id", prodIds);
      }
      // ลบ category หลัก
      const { error: catErr } = await supabaseClient.from("categories").delete().eq("id", id);
      if (catErr) throw catErr;
    }

    // ── Cascade: products ──
    else if (table === "prod") {
      const attrIds = _attrs.filter(a => a.product_id === id).map(a => a.id);
      if (attrIds.length) {
        await supabaseClient.from("attribute_options").delete().in("attribute_id", attrIds);
        await supabaseClient.from("attributes").delete().in("id", attrIds);
      }
      await supabaseClient.from("product_variants").delete().eq("product_id", id);
      // ลบ product หลัก
      const { error: prodErr } = await supabaseClient.from("products").delete().eq("id", id);
      if (prodErr) throw prodErr;
    }

    // ── Cascade: attributes ──
    else if (table === "attr") {
      await supabaseClient.from("attribute_options").delete().eq("attribute_id", id);
      const { error } = await supabaseClient.from("attributes").delete().eq("id", id);
      if (error) throw error;
    }

    // ── var / opt — ลบตรงๆ ──
    else {
      const { error } = await supabaseClient.from(tableOf(table)).delete().eq("id", id);
      if (error) throw error;
    }

    showToast("ลบสำเร็จ", "info");
    await refreshCache();

    if (table === "cat") {
  await loadCategories();   // loadCategories จะ set _cats ใหม่และเรียก populateAllFilters() เองอยู่แล้ว
  await loadProducts();
  await loadAttributes();
  await loadOptions();
}
    if (table === "prod") { await loadProducts(); await loadVariants(); await loadAttributes(); await loadOptions(); }
    if (table === "var")  await loadVariants();
    if (table === "attr") { await loadAttributes(); await loadOptions(); }
    if (table === "opt")  await loadOptions();

  } catch (e) {
    console.error("delRow:", e);
    showToast("ลบไม่สำเร็จ: " + e.message, "err");
  }
}

// =====================================================
// MODAL HELPERS
// =====================================================
function openModal() {
  document.getElementById("amModal").classList.add("open");
  document.getElementById("modalOverlay").classList.add("open");
  document.getElementById("modalSaveBtn").disabled    = false;
  document.getElementById("modalSaveBtn").textContent = "💾 บันทึก";
}

function closeModal() {
  document.getElementById("amModal").classList.remove("open");
  document.getElementById("modalOverlay").classList.remove("open");
  pendingOpts = [];
  _skuManual  = false;
}

// =====================================================
// UTILS
// =====================================================
function tableOf(t) {
  return { cat:"categories", prod:"products", var:"product_variants", attr:"attributes", opt:"attribute_options" }[t];
}
function addTitle(t) {
  return { cat:"➕ เพิ่มหมวดหมู่", prod:"➕ เพิ่มสินค้า", var:"➕ เพิ่ม Variant", attr:"➕ เพิ่ม Attribute", opt:"➕ เพิ่ม Option" }[t] || "เพิ่ม";
}
function editTitle(t) {
  return { cat:"✏️ แก้ไขหมวดหมู่", prod:"✏️ แก้ไขสินค้า", var:"✏️ แก้ไข Variant", attr:"✏️ แก้ไข Attribute", opt:"✏️ แก้ไข Option" }[t] || "แก้ไข";
}
function badge(v, cls) {
  return v ? `<span class="badge ${cls}">${esc(v)}</span>` : "—";
}
function esc(s) {
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function fmtDate(s) {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("th-TH",{year:"numeric",month:"short",day:"numeric"}); }
  catch { return "—"; }
}

let _toastTimer;
function showToast(msg, type="ok") {
  const t = document.getElementById("amToast");
  if (!t) return;
  t.textContent = msg;
  t.className   = `am-toast show ${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.className = `am-toast ${type}`; }, 3000);
}

console.log("✅ AddProductSpec.js loaded");