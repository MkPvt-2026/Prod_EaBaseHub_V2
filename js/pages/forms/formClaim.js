// =====================================================
// formClaim.js (Updated - Better Icons + Custom "อื่นๆ")
// =====================================================
import { sendLineNotify } from "/js/services/lineNotify.js";

async function waitForSupabase(maxMs = 5000) {
  const start = Date.now();
  while (typeof supabaseClient === "undefined") {
    if (Date.now() - start > maxMs) return false;
    await delay(100);
  }
  return true;
}

async function waitForUserService(maxMs = 5000) {
  const start = Date.now();
  while (!window.currentUser?.id) {
    if (Date.now() - start > maxMs) return false;
    await delay(100);
  }
  return true;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function showToast(msg, type = "success") {
  const existing = document.querySelector(".toast-msg");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "toast-msg";
  const colors = {
    success: { bg: "#0d9488", icon: "✅" },
    error:   { bg: "#ef4444", icon: "❌" },
    warning: { bg: "#f59e0b", icon: "⚠️" },
    info:    { bg: "#3b82f6", icon: "ℹ️" },
  };
  const c = colors[type] || colors.success;

  Object.assign(toast.style, {
    position:     "fixed",
    bottom:       "30px",
    left:         "50%",
    transform:    "translateX(-50%) translateY(80px)",
    background:   c.bg,
    color:        "#fff",
    padding:      "14px 24px",
    borderRadius: "12px",
    fontFamily:   "Sarabun, sans-serif",
    fontSize:     "15px",
    fontWeight:   "600",
    boxShadow:    "0 8px 32px rgba(0,0,0,0.25)",
    zIndex:       "99999",
    transition:   "transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s",
    opacity:      "0",
    maxWidth:     "90vw",
    textAlign:    "center",
    whiteSpace:   "pre-line",
  });
  toast.textContent = `${c.icon}  ${msg}`;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.transform = "translateX(-50%) translateY(0)";
    toast.style.opacity = "1";
  });

  setTimeout(() => {
    toast.style.transform = "translateX(-50%) translateY(80px)";
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

function setButtonLoading(btn, loading, originalText) {
  if (!btn) return;
  if (loading) {
    btn.disabled = true;
    btn.dataset.originalText = btn.innerHTML;
    btn.innerHTML = `<span class="loading-spinner"></span> กำลังดำเนินการ...`;
  } else {
    btn.disabled = false;
    btn.innerHTML = originalText || btn.dataset.originalText || btn.innerHTML;
  }
}

function loadUserData() {
  const user = window.currentUser;
  if (!user) { console.warn("⚠️ ไม่พบข้อมูล user"); return; }

  const userNameEl   = document.getElementById("userName");
  const userAvatarEl = document.getElementById("userAvatar");
  if (userNameEl)   userNameEl.textContent   = user.display_name || user.full_name || "ผู้ใช้";
  if (userAvatarEl) userAvatarEl.textContent = (user.display_name || user.full_name || "?").charAt(0).toUpperCase();

  document.querySelectorAll("[data-user]").forEach((input) => {
    const field = input.getAttribute("data-user");
    const value = user[field];
    if (value !== undefined && value !== null) input.value = value;
  });

  console.log("✅ โหลดข้อมูล user สำเร็จ:", user.display_name || user.full_name);
}

document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 เริ่มต้นหน้า formClaim...");
  showSkeletonLoading();

  try {
    const supabaseReady = await waitForSupabase(5000);
    if (!supabaseReady) { showFatalError("ไม่สามารถเชื่อมต่อระบบได้ กรุณารีเฟรชหน้าใหม่"); return; }

    await protectPage();

    let userReady = await waitForUserService(5000);
    if (!userReady && typeof initUserService === "function") {
      await initUserService();
      userReady = await waitForUserService(3000);
    }

    loadUserData();
    setTodayDate();
    setupEventListeners();
    setupMediaUpload();
    setupClaimTypes();
    setupModalOverlay();
    hideSkeletonLoading();

    await Promise.allSettled([loadCustomerList(), loadDrafts(), loadProductGrid()]);
    console.log("✅ หน้า formClaim พร้อมใช้งาน!");
  } catch (error) {
    console.error("❌ Error initializing page:", error);
    hideSkeletonLoading();
    showToast("เกิดข้อผิดพลาดในการโหลดหน้า กรุณารีเฟรช", "error");
  }
});

function showSkeletonLoading() {
  document.querySelectorAll(".card, .section-card, .card-cause").forEach((card) => {
    card.style.opacity = "0.5"; card.style.pointerEvents = "none";
  });
}
function hideSkeletonLoading() {
  document.querySelectorAll(".card, .section-card, .card-cause").forEach((card) => {
    card.style.opacity = ""; card.style.pointerEvents = "";
  });
}
function showFatalError(msg) {
  hideSkeletonLoading();
  document.querySelector("main")?.insertAdjacentHTML("afterbegin",
    `<div style="background:#fef2f2;border:2px solid #fca5a5;border-radius:12px;padding:20px;margin-bottom:20px;color:#dc2626;font-size:15px;font-weight:600;text-align:center;">
      ❌ ${msg}<br>
      <button onclick="location.reload()" style="margin-top:12px;padding:8px 20px;background:#dc2626;color:white;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-size:14px;">รีเฟรชหน้า</button>
    </div>`);
}

// =====================================================
// 🛍️ ICON MAP - อัปเดตให้ตรงกับชื่อหมวดจริง + Icon สวยขึ้น
// =====================================================
const CATEGORY_ICON_MAP = {
  // === ถุง ===
  "ถุงอเนกประสงค์":    { icon: "shopping_bag",    color: "#f59e0b" },
  "ถุง":               { icon: "shopping_bag",    color: "#f59e0b" },
  "ถุงขยะ":            { icon: "delete",          color: "#6b7280" },
  "ถุงเพาะชำ":         { icon: "potted_plant",    color: "#22c55e" },
  
  // === ท่อ ===
  "ท่อ PE":            { icon: "plumbing",        color: "#3b82f6" },
  "ท่อพีอี":           { icon: "plumbing",        color: "#3b82f6" },
  
  // === ตาข่าย ===
  "ตาข่ายกรองแสง":     { icon: "grid_on",         color: "#8b5cf6" },
  
  // === พลาสติก ===
  "พลาสติก PE":        { icon: "layers",          color: "#0d9488" },
  "พลาสติกโรงเรือน":   { icon: "home",            color: "#0d9488" },
  "พลาสติกปูบ่อ":      { icon: "water",           color: "#06b6d4" },
  "พลาสติกคลุมดิน":    { icon: "grass",           color: "#84cc16" },
  
  // === เทป ===
  "เทปน้ำพุ่ง":        { icon: "water_drop",      color: "#0ea5e9" },
  
  // === อื่นๆ ===
  "สินค้า ซื้อมา-ขายไป": { icon: "inventory_2",   color: "#ec4899" },
  "อื่นๆ":             { icon: "edit_note",       color: "#9ca3af", isCustom: true },
};

// Default icon สำหรับหมวดที่ไม่มีใน map
const DEFAULT_ICON = { icon: "category", color: "#6b7280" };

// =====================================================
// 🛍️ OPEN PRODUCT MODAL
// =====================================================
window.openProductModal = async function (categoryId, categoryName) {
  // ถ้าเป็นหมวด "อื่นๆ" ให้เปิด input พิมพ์เอง
  const iconInfo = CATEGORY_ICON_MAP[categoryName];
  if (iconInfo?.isCustom) {
    openCustomProductInput();
    return;
  }

  const modal = document.getElementById("productModal");
  if (!modal) return;
  modal.style.display = "flex";
  modal._currentCategoryId = categoryId;
  modal._currentCategoryName = categoryName;
  modal._readyToClose = false;
  setTimeout(() => { modal._readyToClose = true; }, 150);
  await showProductList(categoryId);
};

// =====================================================
// ✏️ CUSTOM PRODUCT INPUT (สำหรับหมวด "อื่นๆ")
// =====================================================
function openCustomProductInput() {
  const modal = document.getElementById("productModal");
  if (!modal) return;
  
  modal.style.display = "flex";
  modal._readyToClose = false;
  setTimeout(() => { modal._readyToClose = true; }, 150);

  const modalBody = document.getElementById("modalBody");
  modalBody.innerHTML = `
    <div class="custom-product-container">
      <p class="modal-step-label">✏️ กรอกชื่อสินค้าเอง</p>
      <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 16px;">
        สำหรับสินค้าที่ไม่อยู่ในหมวดหมู่อื่น
      </p>
      
      <div class="form-group" style="margin-bottom: 20px;">
        <label for="customProductName">ชื่อสินค้า <span style="color:#ef4444">*</span></label>
        <input 
          type="text" 
          id="customProductName" 
          placeholder="พิมพ์ชื่อสินค้าที่ต้องการเคลม..."
          style="font-size: 16px;"
          autofocus
        >
      </div>
      
      <div class="form-group" style="margin-bottom: 20px;">
        <label for="customProductSpec">รายละเอียด/สเปค (ถ้ามี)</label>
        <input 
          type="text" 
          id="customProductSpec" 
          placeholder="เช่น ขนาด, สี, รุ่น..."
        >
      </div>
      
      <button class="modal-confirm-btn" onclick="confirmCustomProduct()">
        ✅ ยืนยันเลือกสินค้านี้
      </button>
    </div>
  `;

  // Focus input
  setTimeout(() => {
    document.getElementById("customProductName")?.focus();
  }, 100);

  // Enter key to confirm
  const nameInput = document.getElementById("customProductName");
  nameInput?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      confirmCustomProduct();
    }
  });
}

window.confirmCustomProduct = function() {
  const nameInput = document.getElementById("customProductName");
  const specInput = document.getElementById("customProductSpec");
  
  const productName = nameInput?.value?.trim();
  const productSpec = specInput?.value?.trim();
  
  if (!productName) {
    showToast("กรุณากรอกชื่อสินค้า", "warning");
    nameInput?.focus();
    return;
  }
  
  // รวมชื่อ + สเปค
  const fullProductName = productSpec 
    ? `${productName} (${productSpec})`
    : productName;
  
  document.getElementById("product").value = fullProductName;
  closeProductModal();
  showToast(`เลือกสินค้า: ${fullProductName}`);
};

// =====================================================
// 📋 STEP 1: แสดงรายการสินค้าในหมวด
// =====================================================
async function showProductList(categoryId) {
  const modalBody = document.getElementById("modalBody");
  modalBody.innerHTML = '<p class="modal-loading">⏳ กำลังโหลดสินค้า...</p>';

  try {
    const { data, error } = await supabaseClient
      .from("products").select("id, name")
      .eq("category_id", categoryId).order("name");
    if (error) throw error;

    if (!data || data.length === 0) {
      modalBody.innerHTML = '<p class="modal-empty">📭 ไม่มีสินค้าในหมวดนี้</p>';
      return;
    }

    modalBody.innerHTML = `
      <p class="modal-step-label">📦 เลือกสินค้าที่ต้องการเคลม</p>
      <div class="modal-list" id="productListContainer"></div>`;

    const container = document.getElementById("productListContainer");
    data.forEach((product) => {
      const item = document.createElement("div");
      item.className = "modal-list-item";
      item.innerHTML = `<span>${product.name}</span><span class="modal-arrow">›</span>`;
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        showAttributeSelectors(product.id, product.name);
      });
      container.appendChild(item);
    });
  } catch (err) {
    console.error("❌ Error loading products:", err);
    modalBody.innerHTML = `
      <p class="modal-error">❌ โหลดสินค้าไม่สำเร็จ: ${err.message}</p>
      <button onclick="showProductList('${categoryId}')" style="margin:20px auto;display:block;padding:10px 20px;background:#0d9488;color:white;border:none;border-radius:8px;cursor:pointer;font-family:inherit;">ลองใหม่</button>`;
  }
}

// =====================================================
// 📦 STEP 2: แสดง Attributes
// =====================================================
async function showAttributeSelectors(productId, productName) {
  const modalBody = document.getElementById("modalBody");
  const modal     = document.getElementById("productModal");

  modalBody.innerHTML = '<p class="modal-loading">⏳ กำลังโหลดข้อมูลสินค้า...</p>';
  modal._currentProductId   = productId;
  modal._currentProductName = productName;
  modal._selectedAttrs      = {};

  try {
    const { data: attrs, error: attrErr } = await supabaseClient
      .from("attributes")
      .select("id, name, input_type, order_no")
      .eq("product_id", productId)
      .order("order_no");

    if (attrErr) throw attrErr;

    // ไม่มี attribute → ใช้ชื่อสินค้าตรง
    if (!attrs || attrs.length === 0) {
      document.getElementById("product").value = productName;
      closeProductModal();
      showToast(`เลือกสินค้า: ${productName}`);
      return;
    }

    // โหลด options ทุก attribute พร้อมกัน
    const optionResults = await Promise.all(
      attrs.map((attr) =>
        supabaseClient.from("attribute_options")
          .select("id, value")
          .eq("attribute_id", attr.id)
          .order("value")
      )
    );

    // Build UI
    modalBody.innerHTML = "";

    const backBtn = document.createElement("button");
    backBtn.className = "modal-back-btn";
    backBtn.innerHTML = "‹ ย้อนกลับ";
    backBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      showProductList(modal._currentCategoryId);
    });
    modalBody.appendChild(backBtn);

    const label = document.createElement("p");
    label.className = "modal-step-label";
    label.innerHTML = `🔧 เลือกสเปคของ: <strong>${productName}</strong>`;
    modalBody.appendChild(label);

    const attrContainer = document.createElement("div");
    attrContainer.className = "modal-attr-selectors";
    modalBody.appendChild(attrContainer);

    function updateProductInput() {
      const parts = Object.values(modal._selectedAttrs).filter(Boolean);
      document.getElementById("product").value =
        parts.length > 0 ? `${productName} ${parts.join(" ")}` : productName;
    }

    attrs.forEach((attr, idx) => {
      const options = optionResults[idx].data || [];

      const group = document.createElement("div");
      group.className = "modal-attr-group";

      const attrLabel = document.createElement("p");
      attrLabel.className = "modal-attr-label";
      attrLabel.textContent = `🔹 ${attr.name}`;
      group.appendChild(attrLabel);

      if (options.length === 0) {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "modal-attr-input";
        input.placeholder = `ระบุ${attr.name}`;
        input.addEventListener("input", (e) => {
          e.stopPropagation();
          modal._selectedAttrs[attr.name] = e.target.value;
          updateProductInput();
        });
        group.appendChild(input);
      } else {
        const chipWrap = document.createElement("div");
        chipWrap.className = "modal-chip-wrap";
        options.forEach((opt) => {
          const chip = document.createElement("div");
          chip.className = "modal-chip";
          chip.textContent = opt.value;
          chip.addEventListener("click", (e) => {
            e.stopPropagation();
            chipWrap.querySelectorAll(".modal-chip").forEach((c) => c.classList.remove("selected"));
            chip.classList.add("selected");
            modal._selectedAttrs[attr.name] = opt.value;
            updateProductInput();
          });
          chipWrap.appendChild(chip);
        });
        group.appendChild(chipWrap);
      }

      attrContainer.appendChild(group);
    });

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "modal-confirm-btn";
    confirmBtn.innerHTML = "✅ ยืนยันเลือกสินค้านี้";
    confirmBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const productVal = document.getElementById("product").value;
      showToast(`เลือกสินค้า: ${productVal}`);
      closeProductModal();
    });
    modalBody.appendChild(confirmBtn);

    document.getElementById("product").value = productName;
  } catch (err) {
    console.error("❌ Error loading attributes:", err);
    modalBody.innerHTML = `
      <p class="modal-error">❌ โหลดข้อมูลไม่สำเร็จ: ${err.message}</p>
      <button onclick="closeProductModal()" style="margin:20px auto;display:block;padding:10px 20px;background:#6b7280;color:white;border:none;border-radius:8px;cursor:pointer;font-family:inherit;">ปิด</button>`;
  }
}

// =====================================================
// ❌ CLOSE MODAL
// =====================================================
window.closeProductModal = function () {
  const modal = document.getElementById("productModal");
  if (modal) { modal.style.display = "none"; modal._readyToClose = false; }
};

function setupModalOverlay() {
  const modal = document.getElementById("productModal");
  if (!modal) return;
  modal.addEventListener("click", (e) => {
    if (e.target === modal && modal._readyToClose) closeProductModal();
  });
}

function setTodayDate() {
  const today = new Date().toISOString().split("T")[0];
  const claimDateInput = document.getElementById("claimDate");
  if (claimDateInput) claimDateInput.value = today;
}

function setupEventListeners() {
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", logout);
}

function setupMediaUpload() {
  document.getElementById("imageInput")?.addEventListener("change", handleImageUpload);
  document.getElementById("videoInput")?.addEventListener("change", handleVideoUpload);
}

function setupClaimTypes() {
  document.querySelectorAll(".claim-item").forEach((item) => {
    item.addEventListener("click", function () { this.classList.toggle("selected"); });
  });
}

async function loadCustomerList(retryCount = 0) {
  const selectEl = document.getElementById("customer");
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">⏳ กำลังโหลดร้านค้า...</option>';
  selectEl.disabled = true;
  try {
    const { data, error } = await supabaseClient.from("shops").select("id, shop_name").order("shop_name");
    if (error) throw error;
    selectEl.innerHTML = '<option value="">-- เลือกร้านค้า / ลูกค้า --</option>';
    selectEl.disabled = false;
    if (!data || data.length === 0) {
      selectEl.innerHTML += '<option value="" disabled>ไม่มีข้อมูลร้านค้า</option>';
      return;
    }
    const fragment = document.createDocumentFragment();
    data.forEach((shop) => {
      const option = document.createElement("option");
      option.value = shop.shop_name; option.textContent = shop.shop_name;
      fragment.appendChild(option);
    });
    selectEl.appendChild(fragment);
    console.log(`✅ โหลดร้านค้า: ${data.length} ร้าน`);
  } catch (err) {
    console.error("❌ Error loading shops:", err);
    selectEl.disabled = false;
    if (retryCount < 2) {
      console.log(`🔄 Retry ${retryCount + 1}/2...`);
      await delay(1500);
      return loadCustomerList(retryCount + 1);
    }
    selectEl.innerHTML = `<option value="">❌ โหลดไม่สำเร็จ - แตะเพื่อลองใหม่</option>`;
    selectEl.addEventListener("focus", () => loadCustomerList(), { once: true });
  }
}

function handleImageUpload(e) {
  const files = Array.from(e.target.files);
  const imageGrid = document.getElementById("imageGrid");
  files.forEach((file) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const previewBox = document.createElement("div");
      previewBox.className = "upload-box preview";
      previewBox._file = file;
      const img = document.createElement("img");
      img.src = event.target.result; img.alt = file.name;
      const removeBtn = createRemoveBtn(() => { previewBox.remove(); showToast("ลบรูปแล้ว", "info"); });
      previewBox.appendChild(img); previewBox.appendChild(removeBtn);
      const uploadLabel = imageGrid.querySelector("label.upload-box");
      imageGrid.insertBefore(previewBox, uploadLabel);
    };
    reader.readAsDataURL(file);
  });
  e.target.value = "";
}

function handleVideoUpload(e) {
  const files = Array.from(e.target.files);
  const videoGrid = document.getElementById("videoGrid");
  files.forEach((file) => {
    if (!file.type.startsWith("video/")) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const previewBox = document.createElement("div");
      previewBox.className = "upload-box preview";
      previewBox._file = file;
      const video = document.createElement("video");
      video.src = event.target.result; video.controls = true; video.muted = true; video.playsInline = true;
      const removeBtn = createRemoveBtn(() => { previewBox.remove(); showToast("ลบวิดีโอแล้ว", "info"); });
      previewBox.appendChild(video); previewBox.appendChild(removeBtn);
      const uploadLabel = videoGrid.querySelector("label.upload-box");
      videoGrid.insertBefore(previewBox, uploadLabel);
    };
    reader.readAsDataURL(file);
  });
  e.target.value = "";
}

function createRemoveBtn(onClick) {
  const btn = document.createElement("button");
  btn.className = "remove-btn"; btn.innerHTML = "✕"; btn.title = "ลบไฟล์นี้";
  btn.style.minHeight = "unset"; btn.style.flex = "none"; btn.style.width = "30px"; btn.style.padding = "0";
  btn.onclick = (e) => { e.stopPropagation(); onClick(); };
  return btn;
}

function getSelectedClaimTypes() {
  return Array.from(document.querySelectorAll(".claim-item.selected")).map((item) => item.textContent.trim());
}

function validateForm(requireMedia = false) {
  const fields = [
    { id: "claimDate", label: "วันที่แจ้งเคลม" },
    { id: "customer",  label: "ลูกค้า / ร้านค้า" },
    { id: "product",   label: "ชื่อสินค้า" },
    { id: "qty",       label: "จำนวน" },
  ];
  for (const { id, label } of fields) {
    const el = document.getElementById(id);
    if (!el?.value?.trim()) { showToast(`กรุณากรอก: ${label}`, "warning"); el?.focus(); return false; }
  }
  if (requireMedia) {
    const hasMedia = document.querySelectorAll("#imageGrid .preview, #videoGrid .preview").length > 0;
    if (!hasMedia) { showToast("กรุณาแนบรูปภาพหรือวิดีโออย่างน้อย 1 ไฟล์", "warning"); return false; }
    if (getSelectedClaimTypes().length === 0) { showToast("กรุณาเลือกประเภทปัญหาอย่างน้อย 1 รายการ", "warning"); return false; }
  }
  if (!window.currentUser?.id) { showToast("ไม่พบข้อมูลผู้ใช้ กรุณาล็อกอินใหม่", "error"); return false; }
  return true;
}

async function uploadMediaFiles(claimId) {
  const urls = [];
  const imagePreviews = document.querySelectorAll("#imageGrid .preview");
  const videoPreviews = document.querySelectorAll("#videoGrid .preview");
  const uploadFile = async (file, folder, index) => {
    if (!file) return null;
    const ext = file.name.split(".").pop();
    const filePath = `${folder}/${claimId}_${index}_${Date.now()}.${ext}`;
    const { error } = await supabaseClient.storage.from("claim-media").upload(filePath, file, { upsert: true, contentType: file.type || "image/jpeg" });
    if (error) { console.error(`❌ Upload ${folder} error:`, error); return null; }
    const { data: urlData } = supabaseClient.storage.from("claim-media").getPublicUrl(filePath);
    return urlData.publicUrl;
  };
  const imageUploads = Array.from(imagePreviews).map((p, i) => uploadFile(p._file, "images", i));
  const videoUploads = Array.from(videoPreviews).map((p, i) => uploadFile(p._file, "videos", i));
  const results = await Promise.allSettled([...imageUploads, ...videoUploads]);
  results.forEach((r) => { if (r.status === "fulfilled" && r.value) urls.push(r.value); });
  console.log(`✅ อัปโหลด ${urls.length} ไฟล์`);
  return urls;
}

window.saveDraft = async function () {
  if (!validateForm(false)) return;
  const btn = document.querySelector(".btn-draft");
  setButtonLoading(btn, true);
  try {
    let claimId;
    if (window.currentDraftId) {
      const updateData = { ...buildClaimData("draft"), updated_at: new Date().toISOString() };
      delete updateData.created_at;
      const { error } = await supabaseClient.from("claims").update(updateData).eq("id", window.currentDraftId);
      if (error) throw error;
      claimId = window.currentDraftId;
      showToast("อัปเดท Draft สำเร็จ!");
    } else {
      const { data, error } = await supabaseClient.from("claims").insert([buildClaimData("draft")]).select().single();
      if (error) throw error;
      claimId = data.id;
      showToast("บันทึก Draft สำเร็จ!");
    }
    const mediaUrls = await uploadMediaFiles(claimId);
    if (mediaUrls.length > 0) {
      const { data: existing } = await supabaseClient.from("claims").select("media_urls").eq("id", claimId).single();
      const merged = [...(existing?.media_urls || []), ...mediaUrls];
      await supabaseClient.from("claims").update({ media_urls: merged }).eq("id", claimId);
    }
    window.currentDraftId = null;
    await loadDrafts();
    clearForm();
  } catch (err) {
    console.error("❌ Error saving draft:", err);
    showToast("บันทึกไม่สำเร็จ: " + err.message, "error");
  } finally {
    setButtonLoading(btn, false);
  }
};

async function loadDrafts() {
  const draftBody = document.getElementById("draftBody");
  if (!draftBody) return;
  if (!window.currentUser?.id) {
    draftBody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#9ca3af;padding:30px;">กรุณาล็อกอินเพื่อดู Draft</td></tr>';
    return;
  }
  draftBody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#9ca3af;padding:30px;">⏳ กำลังโหลด...</td></tr>';
  try {
    const { data, error } = await supabaseClient.from("claims").select("*")
      .eq("user_id", window.currentUser.id).eq("status", "draft")
      .order("created_at", { ascending: false });
    if (error) throw error;
    if (!data || data.length === 0) {
      draftBody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#9ca3af;padding:40px;font-size:15px;">📭 ยังไม่มี Draft</td></tr>';
      return;
    }
    draftBody.innerHTML = "";
    data.forEach((draft) => {
      const row = document.createElement("tr");
      const thumbHtml = draft.media_urls?.length > 0
        ? `<div class="draft-thumbs">${draft.media_urls.slice(0,3).map((url) => /\.(mp4|mov|avi|webm)$/i.test(url) ? `<div class="draft-thumb video-thumb">🎥</div>` : `<img class="draft-thumb" src="${url}" loading="lazy" onerror="this.style.display='none'">`).join("")}${draft.media_urls.length > 3 ? `<div class="draft-thumb more-thumb">+${draft.media_urls.length - 3}</div>` : ""}</div>`
        : `<span class="draft-no-media">ไม่มีไฟล์</span>`;
      const typesHtml = draft.claim_types?.length > 0
        ? draft.claim_types.map((t) => `<span class="draft-type-tag">${t}</span>`).join("")
        : '<span style="color:#9ca3af;font-size:0.8rem">ไม่ระบุ</span>';
      row.innerHTML = `
        <td><div class="draft-date">📅 ${formatDate(draft.claim_date)}</div><div class="draft-customer">🏪 ${draft.customer || "-"}</div></td>
        <td><div class="draft-product">📦 ${draft.product}</div><div class="draft-qty">🔢 ${draft.qty || ""}</div><div class="draft-types">${typesHtml}</div></td>
        <td>${thumbHtml}</td>
        <td><div class="draft-actions">
          <button class="btn-draft-submit" onclick="submitClaim('${draft.id}')">✅ ส่งเคลม</button>
          <button class="btn-draft-edit"   onclick="editDraft('${draft.id}')">✏️ แก้ไข</button>
          <button class="btn-draft-del"    onclick="deleteDraft('${draft.id}')">🗑️</button>
        </div></td>`;
      draftBody.appendChild(row);
    });
    console.log(`✅ โหลด ${data.length} draft(s)`);
  } catch (err) {
    console.error("❌ Error loading drafts:", err);
    draftBody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:30px;"><div style="color:#ef4444;font-size:14px;margin-bottom:12px;">❌ โหลด Draft ไม่สำเร็จ</div><button onclick="loadDrafts()" style="padding:8px 18px;background:#0d9488;color:white;border:none;border-radius:8px;cursor:pointer;font-family:inherit;">ลองใหม่</button></td></tr>`;
  }
}

window.editDraft = async function (draftId) {
  try {
    const { data, error } = await supabaseClient.from("claims").select("*").eq("id", draftId).single();
    if (error) throw error;
    document.getElementById("claimDate").value = data.claim_date || "";
    document.getElementById("customer").value  = data.customer   || "";
    document.getElementById("buyDate").value   = data.buy_date   || "";
    document.getElementById("mfgDate").value   = data.mfg_date   || "";
    document.getElementById("product").value   = data.product    || "";
    document.getElementById("qty").value       = data.qty        || "";
    document.getElementById("detail").value    = data.detail     || "";
    if (Array.isArray(data.claim_types)) {
      document.querySelectorAll(".claim-item").forEach((item) => {
        item.classList.toggle("selected", data.claim_types.includes(item.textContent.trim()));
      });
    }
    window.currentDraftId = draftId;
    showDraftEditBanner(draftId, data.product);
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast("โหลด Draft แล้ว — กดบันทึก/ส่งเคลมได้เลย", "info");
  } catch (err) {
    console.error("❌ Error editing draft:", err);
    showToast("โหลด Draft ไม่สำเร็จ: " + err.message, "error");
  }
};

window.deleteDraft = async function (draftId) {
  if (!confirm("⚠️ ต้องการลบ Draft นี้หรือไม่?\n\nการลบจะไม่สามารถกู้คืนได้")) return;
  try {
    const { error } = await supabaseClient.from("claims").delete().eq("id", draftId);
    if (error) throw error;
    showToast("ลบ Draft สำเร็จ");
    await loadDrafts();
  } catch (err) {
    console.error("❌ Error deleting draft:", err);
    showToast("ลบไม่สำเร็จ: " + err.message, "error");
  }
};

window.submitEdit = async function () {
  if (!window.currentDraftId) { showToast("กรุณาเลือก Draft ที่ต้องการแก้ไขก่อน (กดปุ่ม ✏️ แก้ไข)", "warning"); return; }
  await window.saveDraft();
};

window.submitClaim = async function (draftId = null) {
  if (draftId) {
    if (!confirm("✅ ยืนยันการส่งเคลมรายการนี้?\n\nข้อมูลจะถูกส่งและไม่สามารถแก้ไขได้")) return;
    const rowBtn = document.querySelector(`button[onclick="submitClaim('${draftId}')"]`);
    if (rowBtn) { rowBtn.disabled = true; rowBtn.textContent = "⏳ กำลังส่ง..."; }
    try {
      const { data: draft, error: fetchErr } = await supabaseClient.from("claims").select("*").eq("id", draftId).single();
      if (fetchErr) throw fetchErr;
      const newMediaUrls = await uploadMediaFiles(draftId);
      const allMediaUrls = [...(draft.media_urls ?? []), ...newMediaUrls];
      const { error } = await supabaseClient.from("claims").update({ status: "submitted", media_urls: allMediaUrls, updated_at: new Date().toISOString() }).eq("id", draftId);
      if (error) throw error;
      showToast(`ส่งเคลมสำเร็จ! 🎉\n${draft.product}`);
      await loadDrafts();
      sendLineNotify({ claimId: draftId, shop: draft.customer, product: draft.product, qty: draft.qty, claimTypes: draft.claim_types ?? [], detail: draft.detail ?? "", mediaUrls: allMediaUrls, sales: window.currentUser.display_name || window.currentUser.full_name }).catch((e) => console.warn("⚠️ Line Notify:", e));
    } catch (err) {
      console.error("❌ Error submitting draft claim:", err);
      showToast("ส่งเคลมไม่สำเร็จ: " + err.message, "error");
      if (rowBtn) { rowBtn.disabled = false; rowBtn.textContent = "✅ ส่งเคลม"; }
    }
    return;
  }
  if (!validateForm(true)) return;
  if (!confirm("✅ ยืนยันการส่งเคลม?\n\nข้อมูลจะถูกส่งและไม่สามารถแก้ไขได้")) return;
  const btn = document.querySelector(".btn-submit");
  setButtonLoading(btn, true);
  const notifyPayload = { shop: document.getElementById("customer").value, product: document.getElementById("product").value, qty: document.getElementById("qty").value, sales: window.currentUser.display_name || window.currentUser.full_name };
  try {
    let claimId;
    if (window.currentDraftId) {
      const updateData = { ...buildClaimData("submitted"), updated_at: new Date().toISOString() };
      delete updateData.created_at;
      const { error } = await supabaseClient.from("claims").update(updateData).eq("id", window.currentDraftId);
      if (error) throw error;
      claimId = window.currentDraftId;
    } else {
      const { data, error } = await supabaseClient.from("claims").insert([buildClaimData("submitted")]).select().single();
      if (error) throw error;
      claimId = data.id;
    }
    const mediaUrls = await uploadMediaFiles(claimId);
    if (mediaUrls.length > 0) {
      const { data: existing } = await supabaseClient.from("claims").select("media_urls").eq("id", claimId).single();
      const merged = [...(existing?.media_urls || []), ...mediaUrls];
      await supabaseClient.from("claims").update({ media_urls: merged }).eq("id", claimId);
    }
    notifyPayload.claimId = claimId; notifyPayload.mediaUrls = mediaUrls;
    notifyPayload.claimTypes = getSelectedClaimTypes();
    notifyPayload.detail = document.getElementById("detail").value ?? "";
    sendLineNotify(notifyPayload).catch((e) => console.warn("⚠️ Line Notify:", e));
    window.currentDraftId = null;
    showToast("ส่งเคลมสำเร็จ! 🎉");
    clearForm();
    await loadDrafts();
  } catch (err) {
    console.error("❌ Error submitting claim:", err);
    showToast("ส่งเคลมไม่สำเร็จ: " + err.message, "error");
  } finally {
    setButtonLoading(btn, false);
  }
};

function buildClaimData(status) {
  const user = window.currentUser;
  return { user_id: user.id, emp_name: user.display_name || user.full_name, area: user.area || user.zone, claim_date: document.getElementById("claimDate").value, customer: document.getElementById("customer").value, buy_date: document.getElementById("buyDate").value || null, mfg_date: document.getElementById("mfgDate").value || null, product: document.getElementById("product").value, qty: document.getElementById("qty").value, claim_types: getSelectedClaimTypes(), detail: document.getElementById("detail").value || "", status, created_at: new Date().toISOString() };
}

function clearForm() {
  document.getElementById("claimDate").value = new Date().toISOString().split("T")[0];
  ["customer", "buyDate", "mfgDate", "product", "qty", "detail"].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; });
  document.querySelectorAll(".claim-item.selected").forEach((el) => el.classList.remove("selected"));
  document.querySelectorAll("#imageGrid .preview, #videoGrid .preview").forEach((el) => el.remove());
  window.currentDraftId = null;
  hideDraftEditBanner();
}

function formatDate(dateString) {
  if (!dateString) return "-";
  const [y, m, d] = dateString.split("-");
  return `${d}/${m}/${y}`;
}

function showDraftEditBanner(draftId, productName) {
  hideDraftEditBanner();
  const banner = document.createElement("div");
  banner.id = "draftEditBanner";
  Object.assign(banner.style, { position: "sticky", top: "126px", zIndex: "900", background: "linear-gradient(135deg, #0d9488, #0f766e)", color: "#fff", padding: "12px 24px", fontSize: "14px", fontWeight: "600", fontFamily: "Sarabun, sans-serif", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", boxShadow: "0 4px 12px rgba(13,148,136,0.35)", borderBottom: "2px solid #14b8a6" });
  banner.innerHTML = `<span>✏️ กำลังแก้ไข Draft: <strong>${productName || draftId.slice(0,8)+"..."}</strong></span><button onclick="cancelDraftEdit()" style="background:rgba(255,255,255,0.2);border:1.5px solid rgba(255,255,255,0.4);color:#fff;padding:5px 14px;border-radius:6px;cursor:pointer;font-family:Sarabun,sans-serif;font-size:13px;font-weight:600;min-height:unset;flex:none;">✕ ยกเลิก</button>`;
  const container = document.querySelector(".container");
  if (container) container.insertAdjacentElement("beforebegin", banner);
}

function hideDraftEditBanner() { document.getElementById("draftEditBanner")?.remove(); }

window.cancelDraftEdit = function () {
  window.currentDraftId = null;
  hideDraftEditBanner();
  clearForm();
  showToast("ยกเลิกการแก้ไข Draft แล้ว", "info");
};

async function logout() {
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    showToast("ออกจากระบบแล้ว", "info");
    setTimeout(() => { window.location.href = "/pages/auth/login.html"; }, 500);
  } catch (err) {
    console.error("❌ Logout error:", err);
    showToast("ออกจากระบบไม่สำเร็จ", "error");
  }
}


// =====================================================
// 🛍️ LOAD PRODUCT GRID (หมวดสินค้าหน้าหลัก)
// พร้อม Icon สีสันและรองรับ "อื่นๆ" พิมพ์เอง
// =====================================================
async function loadProductGrid() {
  const grid = document.querySelector(".product-grid");
  if (!grid) return;

  try {
    const { data, error } = await supabaseClient
      .from("categories")
      .select("id, name")
      .order("name");

    if (error) throw error;

    grid.innerHTML = "";
    
    data.forEach((cat) => {
      // ดึง icon และ color จาก map
      const iconInfo = CATEGORY_ICON_MAP[cat.name] || DEFAULT_ICON;
      const { icon, color, isCustom } = iconInfo;

      const item = document.createElement("div");
      item.className = "product-item";
      item.dataset.categoryId = cat.id;
      item.dataset.categoryName = cat.name;
      
      // ถ้าเป็น "อื่นๆ" ให้มี style พิเศษ
      if (isCustom) {
        item.classList.add("product-item-custom");
      }

      item.innerHTML = `
        <div class="product-icon" style="color: ${color}">
          <span class="material-symbols-outlined" style="color: ${color}">${icon}</span>
        </div>
        <span class="product-name">${cat.name}</span>
      `;
      
      item.addEventListener("click", () => openProductModal(cat.id, cat.name));
      grid.appendChild(item);
    });

    console.log(`✅ โหลด ${data.length} หมวดสินค้า`);
  } catch (err) {
    console.error("❌ loadProductGrid error:", err);
    showToast("โหลดหมวดสินค้าไม่สำเร็จ", "error");
  }
}

console.log("✅ formClaim.js (Updated with better icons + custom product) loaded");