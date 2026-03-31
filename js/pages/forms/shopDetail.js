// =====================================================
// shopDetail.js — หน้าข้อมูลร้านค้า
// รับ shop id จาก URL: ?id=xxx
// =====================================================

var SHIPPING_OPTIONS = ["Flash", "Kerry", "J&T", "Thailand Post", "Ninja Van", "DHL", "อื่นๆ"];

// =====================================================
// 🔄 รอ Supabase
// =====================================================
async function waitForAppReady(maxMs = 5000) {
  const start = Date.now();
  while (typeof supabaseClient === "undefined") {
    if (Date.now() - start > maxMs) throw new Error("Supabase ยังไม่โหลด");
    await new Promise((r) => setTimeout(r, 100));
  }
}

// =====================================================
// 👤 โหลด user + ชื่อ
// =====================================================
async function getUser() {
  if (typeof getCurrentUser === "function") {
    const user = await getCurrentUser();
    if (user) return user;
  }
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) { window.location.href = "/login.html"; return null; }
  return user;
}

async function loadUserName(userId) {
  const nameEl = document.getElementById("userName");
  if (!nameEl) return;
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .single();
  if (!error && data?.display_name) {
    nameEl.textContent = data.display_name;
  } else {
    const { data: { user } } = await supabaseClient.auth.getUser();
    nameEl.textContent = user?.email || "ไม่ทราบชื่อ";
  }
}

// =====================================================
// 🏪 โหลดข้อมูลร้าน
// =====================================================
async function loadShop(shopId) {
  const { data, error } = await supabaseClient
    .from("shops")
    .select("*")
    .eq("id", shopId)
    .single();

  if (error || !data) {
    alert("ไม่พบข้อมูลร้านค้า");
    window.location.href = "/pages/forms/shopUser.html";
    return null;
  }
  return data;
}

// =====================================================
// 📋 แสดงข้อมูลหัวหน้า
// =====================================================
function renderShopHeader(shop) {
  const nameEl     = document.getElementById("detailShopName");
  const codeEl     = document.getElementById("detailShopCode");
  const provinceEl = document.getElementById("detailProvince");
  if (nameEl)     nameEl.textContent     = shop.shop_name || "-";
  if (codeEl)     codeEl.textContent     = shop.shop_code || "";
  if (provinceEl) provinceEl.textContent = shop.province  || "";
  document.title = shop.shop_name + " — EABaseHub";
}

// =====================================================
// 📦 ชื่อรอง
// =====================================================
async function loadAlias() {
  const { data, error } = await supabaseClient
    .from("shop_aliases")
    .select("*")
    .eq("shop_id", window.shopId)
    .order("created_at", { ascending: false });

  if (error) { console.error(error); return; }

  const list = document.getElementById("aliasList");
  if (!list) return;
  list.innerHTML = "";

  if (!data || data.length === 0) {
    list.innerHTML = `<span class="no-data">ยังไม่มีชื่อรอง</span>`;
    return;
  }
  data.forEach((a) => {
    const chip = document.createElement("span");
    chip.className = "alias-chip";
    chip.textContent = a.alias_name;
    list.appendChild(chip);
  });
}

async function addAlias() {
  const input = document.getElementById("aliasInput");
  if (!input) return;
  const value = input.value.trim();
  if (!value) { alert("กรอกชื่อรองก่อน"); return; }

  const { error } = await supabaseClient
    .from("shop_aliases")
    .insert({ shop_id: window.shopId, alias_name: value });

  if (error) { console.error(error); alert("เพิ่มไม่สำเร็จ"); return; }
  input.value = "";
  loadAlias();
}

// =====================================================
// 📋 รายละเอียด
// =====================================================
async function loadDetail() {
  // render chips ทันที ไม่รอ DB
  renderShippingChips([]);

  const detail = await loadShopDetail(window.shopId);
  if (!detail) return;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ""; };
  set("detailAddress",     detail.address);
  set("detailMapsUrl",     detail.maps_url);
  set("detailPhone",       detail.phone);
  set("detailContactName", detail.contact_name);
  set("detailLineId",      detail.line_id);
  set("detailNote",        detail.note);

  const mapsLink = document.getElementById("mapsLink");
  if (mapsLink) {
    mapsLink.href = detail.maps_url || "#";
    mapsLink.style.display = detail.maps_url ? "" : "none";
  }

  renderShippingChips(detail.shipping || []);
}

function renderShippingChips(selected) {
  const container = document.getElementById("shippingChips");
  if (!container) return;
  container.innerHTML = "";
  SHIPPING_OPTIONS.forEach((name) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "shipping-chip" + (selected.includes(name) ? " active" : "");
    chip.textContent = name;
    chip.addEventListener("click", () => chip.classList.toggle("active"));
    container.appendChild(chip);
  });
}

function getSelectedShipping() {
  return [...document.querySelectorAll(".shipping-chip.active")].map((c) => c.textContent);
}

async function saveDetail() {
  if (!window.shopId || !window.currentUser) return;
  const btn    = document.getElementById("saveDetailBtn");
  const status = document.getElementById("detailSaveStatus");
  btn.disabled = true;
  if (status) { status.textContent = "กำลังบันทึก..."; status.className = "save-status saving"; }

  try {
    await saveShopDetail(window.shopId, window.currentUser.id, {
      address:      document.getElementById("detailAddress")?.value,
      maps_url:     document.getElementById("detailMapsUrl")?.value,
      phone:        document.getElementById("detailPhone")?.value,
      contact_name: document.getElementById("detailContactName")?.value,
      line_id:      document.getElementById("detailLineId")?.value,
      note:         document.getElementById("detailNote")?.value,
      shipping:     getSelectedShipping(),
    });
    if (status) { status.textContent = "✓ บันทึกแล้ว"; status.className = "save-status saved"; }
    setTimeout(() => { if (status) status.textContent = ""; }, 3000);
  } catch (err) {
    console.error(err);
    if (status) { status.textContent = "เกิดข้อผิดพลาด"; status.className = "save-status error"; }
  } finally {
    btn.disabled = false;
  }
}

document.getElementById("cancelBtn")?.addEventListener("click", () => {
  loadDetail();  // โหลดค่าเดิมจาก DB ใหม่
  loadAlias();
});

// =====================================================
// 📸 รูปภาพ
// =====================================================
window._currentImages = [];

async function loadImages() {
  const detail = await loadShopDetail(window.shopId);
  window._currentImages = detail?.images || [];
  await renderImageGrid(window._currentImages);
}

async function renderImageGrid(paths) {
  const grid = document.getElementById("imageGrid");
  if (!grid) return;
  grid.innerHTML = "";

  if (!paths || paths.length === 0) {
    grid.innerHTML = `<p class="no-data">ยังไม่มีรูปภาพ</p>`;
    return;
  }
  for (const path of paths) {
    const url = await getImageUrl(path);
    if (!url) continue;
    const card = document.createElement("div");
    card.className = "image-card";
    card.innerHTML = `
      <img src="${url}" alt="shop image" loading="lazy" />
      <button class="image-delete-btn" title="ลบรูป">✕</button>
    `;
    card.querySelector(".image-delete-btn").addEventListener("click", async () => {
      if (!confirm("ลบรูปนี้?")) return;
      try {
        window._currentImages = await deleteShopImage(window.shopId, path, window._currentImages);
        await renderImageGrid(window._currentImages);
      } catch { alert("ลบไม่สำเร็จ"); }
    });
    grid.appendChild(card);
  }
}

function initImageUpload() {
  const area  = document.getElementById("uploadArea");
  const input = document.getElementById("imageInput");
  if (!area || !input) return;

  area.addEventListener("click", () => input.click());
  area.addEventListener("dragover", (e) => { e.preventDefault(); area.classList.add("drag-over"); });
  area.addEventListener("dragleave", () => area.classList.remove("drag-over"));
  area.addEventListener("drop", async (e) => {
    e.preventDefault();
    area.classList.remove("drag-over");
    await handleFiles([...e.dataTransfer.files]);
  });
  input.addEventListener("change", async () => {
    await handleFiles([...input.files]);
    input.value = "";
  });
}

async function handleFiles(files) {
  const MAX = 5 * 1024 * 1024;
  const valid = files.filter((f) => {
    if (!f.type.startsWith("image/")) { alert(`${f.name}: ไม่ใช่ไฟล์รูปภาพ`); return false; }
    if (f.size > MAX) { alert(`${f.name}: ขนาดเกิน 5MB`); return false; }
    return true;
  });
  for (const file of valid) {
    try {
      const path = await uploadShopImage(window.shopId, file);
      window._currentImages = await appendShopImage(window.shopId, path, window._currentImages);
    } catch (err) {
      console.error(err);
      alert(`อัปโหลด ${file.name} ไม่สำเร็จ`);
    }
  }
  await renderImageGrid(window._currentImages);
}

// =====================================================
// 🎯 INIT
// =====================================================
async function init() {
  try {
    await waitForAppReady();

    // ดึง shop id จาก URL
    const params = new URLSearchParams(window.location.search);
    const shopId = params.get("id");
    if (!shopId) {
      alert("ไม่พบรหัสร้านค้า");
      window.location.href = "/pages/forms/shopUser.html";
      return;
    }
    window.shopId = shopId;

    const user = await getUser();
    if (!user) return;
    window.currentUser = user;

    // โหลดทุกอย่างพร้อมกัน
    const [shop] = await Promise.all([
      loadShop(shopId),
      loadUserName(user.id),
    ]);
    if (!shop) return;

    renderShopHeader(shop);

    // โหลด content ทั้งหมดพร้อมกัน
    await Promise.all([loadAlias(), loadDetail(), loadImages()]);

    // init
    initImageUpload();

    document.getElementById("addAliasBtn")?.addEventListener("click", addAlias);
    document.getElementById("saveDetailBtn")?.addEventListener("click", saveDetail);
    document.getElementById("detailMapsUrl")?.addEventListener("input", (e) => {
      const link = document.getElementById("mapsLink");
      if (!link) return;
      const v = e.target.value.trim();
      link.href = v || "#";
      link.style.display = v ? "" : "none";
    });

  } catch (err) {
    console.error(err);
    alert("โหลดไม่สำเร็จ: " + err.message);
  }
}

init();