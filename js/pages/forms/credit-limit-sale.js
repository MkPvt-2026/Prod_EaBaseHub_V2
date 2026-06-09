/* =========================================================
   CREDIT LIMIT SALE PAGE
   ใช้กับตาราง shops ปัจจุบัน:
   shops: id, shop_code, shop_name, province, sale_id, status, created_at
========================================================= */

"use strict";

/* =========================================================
   PAGE NAVIGATION
========================================================= */
const pageLinks = {
  sale: "credit-limit-sale.html",
  a4: "credit-limit-a4-document.html",
  sign: "credit-limit-signature.html",
  detail: "credit-limit-detail.html",
  finance: "credit-limit-finance.html",
  approval: "credit-limit-approval.html",
  tracking: "credit-limit-tracking.html"
};

function goPage(id) {
  const target = pageLinks[id];
  if (target) window.location.href = target;
}

function showPage(id) {
  goPage(id);
}

/* =========================================================
   STATE
========================================================= */
let currentUser = null;
let currentProfile = null;
let currentShops = [];
let selectedShop = null;
let sigData = null;

/* =========================================================
   INIT
========================================================= */
document.addEventListener("DOMContentLoaded", async () => {
  try {
    setToday();
    updateCount();
    setupCanvas("sigCanvas", "sigHint");

    await initAuthAndProfile();
    await loadSaleShops();

    restoreDraft();
  } catch (err) {
    console.error("Init error:", err);
    alert("โหลดหน้าไม่สำเร็จ: " + (err.message || err));
  }
});

/* =========================================================
   AUTH + ROLE CHECK
========================================================= */
async function initAuthAndProfile() {
  const db = window.supabaseClient;

  if (!db?.auth) {
    throw new Error("supabaseClient ยังไม่พร้อมใช้งาน");
  }

  const {
    data: { session },
    error: sessionError
  } = await db.auth.getSession();

  if (sessionError) throw sessionError;

  if (!session?.user) {
    window.location.href = "/pages/auth/login.html";
    return;
  }

  currentUser = session.user;

  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("id, username, display_name, email, role, area, status, avatar_url")
    .eq("id", currentUser.id)
    .single();

  if (profileError) throw profileError;
  if (!profile) throw new Error("ไม่พบข้อมูลผู้ใช้งานใน profiles");

  currentProfile = profile;

  const role = String(profile.role || "").toLowerCase();
  const status = String(profile.status || "").toLowerCase();

  if (!["sale", "sales"].includes(role)) {
    alert("ไม่มีสิทธิ์เข้าใช้งานหน้านี้ เฉพาะ Sale เท่านั้น");
    window.location.href = "/index.html";
    return;
  }

  if (status && status !== "active") {
    alert("บัญชีผู้ใช้งานนี้ไม่ได้อยู่ในสถานะ Active");
    await db.auth.signOut();
    window.location.href = "/pages/auth/login.html";
    return;
  }

  renderCurrentUser();
}

function renderCurrentUser() {
  const username = currentProfile.username || currentProfile.email || "Sale";
  const displayName = currentProfile.display_name || username;
  const avatarText = getAvatarText(displayName || username);

  setText("sidebarAvatar", avatarText);
  setText("sidebarDisplayName", displayName);
  setText("sidebarUsername", username);
  setText("topbarAvatar", avatarText);
  setText("topbarUsername", username);

  setValue("saleOwner", `${username} - ${displayName}`);

  setText("sigModalTitle", `✍️ เซ็นชื่อผู้ขออนุมัติ (${username})`);
  setText("sigNameText", `${displayName} (${username})`);
}

function getAvatarText(value) {
  const text = String(value || "S").trim();
  if (!text) return "S";
  return text.slice(0, 2).toUpperCase();
}

/* =========================================================
   LOAD SHOPS
   ดึงอัตโนมัติจาก shops เฉพาะ:
   shop_name / shop_code / province
========================================================= */
async function loadSaleShops() {
  const db = window.supabaseClient;

  const select = document.getElementById("shopSelect");
  if (select) {
    select.innerHTML = `<option value="">กำลังโหลดรายชื่อลูกค้า...</option>`;
  }

  const { data, error } = await db
    .from("shops")
    .select("id, shop_code, shop_name, province, sale_id, status")
    .eq("sale_id", currentProfile.id)
    .ilike("status", "active")
    .order("shop_name", { ascending: true });

  if (error) throw error;

  currentShops = data || [];
  renderShopOptions(currentShops);
}

function renderShopOptions(shops) {
  const select = document.getElementById("shopSelect");
  if (!select) return;

  select.innerHTML = `<option value="">-- เลือกลูกค้า --</option>`;

  if (!shops.length) {
    select.innerHTML = `<option value="">ไม่พบลูกค้าที่ผูกกับ Sale คนนี้</option>`;
    return;
  }

  shops.forEach((shop) => {
    const option = document.createElement("option");
    option.value = shop.id;

    const code = shop.shop_code ? `${shop.shop_code} - ` : "";
    const province = shop.province ? ` (${shop.province})` : "";

    option.textContent = `${code}${shop.shop_name || "-"}${province}`;
    select.appendChild(option);
  });
}

function onShopChange() {
  const shopId = document.getElementById("shopSelect")?.value || "";
  selectedShop = currentShops.find((shop) => shop.id === shopId) || null;

  // ดึงจากตาราง shops อัตโนมัติ
  setValue("shopCode", selectedShop?.shop_code || "");
  setValue("shopProvince", selectedShop?.province || "");

  // ดึงข้อมูล Sale ผู้รับผิดชอบอัตโนมัติจาก profiles
  const saleDisplay =
    currentProfile?.display_name ||
    currentProfile?.username ||
    currentProfile?.email ||
    "";

  setValue("saleOwner", saleDisplay);

  // ช่องนี้ให้ Sale กรอกเอง
  setValue("currentCreditLimit", "");
  setValue("creditTerm", "");
}
// ช่องอื่นให้ผู้ใช้กรอกเอง ไม่ดึงจาก shops


/* =========================================================
   CHAR COUNT
========================================================= */
function updateCount() {
  const t = document.getElementById("reasonText");
  const c = document.getElementById("charCount");
  if (t && c) c.textContent = String(t.value.length);
}

/* =========================================================
   SIGNATURE CANVAS
========================================================= */
function setupCanvas(canvasId, hintId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = "#1a1a2e";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  let drawing = false;

  function getPos(e) {
    const r = canvas.getBoundingClientRect();
    const scaleX = canvas.width / r.width;
    const scaleY = canvas.height / r.height;

    if (e.touches?.[0]) {
      return [
        (e.touches[0].clientX - r.left) * scaleX,
        (e.touches[0].clientY - r.top) * scaleY
      ];
    }

    return [
      (e.clientX - r.left) * scaleX,
      (e.clientY - r.top) * scaleY
    ];
  }

  function hideHint() {
    if (!hintId) return;
    document.getElementById(hintId)?.classList.add("hidden");
  }

  canvas.addEventListener("mousedown", (e) => {
    drawing = true;
    const [x, y] = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    hideHint();
  });

  canvas.addEventListener("mousemove", (e) => {
    if (!drawing) return;
    const [x, y] = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  });

  canvas.addEventListener("mouseup", () => {
    drawing = false;
  });

  canvas.addEventListener("mouseleave", () => {
    drawing = false;
  });

  canvas.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      drawing = true;
      const [x, y] = getPos(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
      hideHint();
    },
    { passive: false }
  );

  canvas.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      if (!drawing) return;
      const [x, y] = getPos(e);
      ctx.lineTo(x, y);
      ctx.stroke();
    },
    { passive: false }
  );

  canvas.addEventListener("touchend", () => {
    drawing = false;
  });

  return { ctx, canvas };
}

function openSigModal() {
  document.getElementById("sigModal")?.classList.add("open");
}

function closeSigModal() {
  document.getElementById("sigModal")?.classList.remove("open");
}

function clearSig() {
  const c = document.getElementById("sigCanvas");
  if (!c) return;

  c.getContext("2d").clearRect(0, 0, c.width, c.height);
  document.getElementById("sigHint")?.classList.remove("hidden");
}

function saveSig() {
  const c = document.getElementById("sigCanvas");
  if (!c) return;

  sigData = c.toDataURL("image/png");

  const disp = document.getElementById("sigDisplay");
  if (disp) {
    const dCtx = disp.getContext("2d");
    const img = new Image();

    img.onload = () => {
      dCtx.clearRect(0, 0, disp.width, disp.height);
      dCtx.drawImage(img, 0, 0, disp.width, disp.height);
    };

    img.src = sigData;
  }

  setDisplay("sigPlaceholder", "none");
  setDisplay("sigDisplayWrap", "block");
  setText("sigDateText", formatThaiDateTime(new Date()));

  closeSigModal();
}

function clearDisplaySig() {
  const disp = document.getElementById("sigDisplay");
  if (disp) {
    disp.getContext("2d").clearRect(0, 0, disp.width, disp.height);
  }

  setDisplay("sigPlaceholder", "block");
  setDisplay("sigDisplayWrap", "none");
  setText("sigDateText", "-");

  sigData = null;
  clearSig();
}

/* =========================================================
   FORM DATA COLLECTION
========================================================= */
function collectFormData(status = "pending") {
  const shopId = getValue("shopSelect");
  const shop = currentShops.find((item) => item.id === shopId) || null;

  const paymentMethods = Array.from(
    document.querySelectorAll('input[name="payment_method"]:checked')
  ).map((input) => input.value);

  return {
  request_type: "credit_limit_temp",
  request_title: "ขออนุมัติวงเงินเกิน",
  request_detail: getValue("reasonText"),
  request_status: status,

  status,


    sale_id: currentUser.id,
    created_by: currentUser.id,
    request_by: currentUser.id,

    shop_id: shop?.id || null,
    shop_code: shop?.shop_code || null,
    shop_name: shop?.shop_name || null,
    province: shop?.province || null,

    sale_name:
      currentProfile.display_name ||
      currentProfile.username ||
      currentProfile.email,

    current_credit_limit: toNumber(getValue("currentCreditLimit")),
    credit_term: getValue("creditTerm") || null,
    payment_methods: paymentMethods,

    sale_order_no: getValue("saleOrderNo") || null,
    request_date: getValue("requestDate") || null,
    request_amount: toNumber(getValue("requestAmount")),

    reason: getValue("reasonText"),
    signature: sigData,

    payload: {
      profile: {
        id: currentProfile.id,
        username: currentProfile.username,
        display_name: currentProfile.display_name,
        email: currentProfile.email,
        role: currentProfile.role,
        area: currentProfile.area
      },
      shop,
      form_version: "credit-limit-sale-v1"
    }
  };
}

function validateForm(data, requireSignature = true) {
  if (!data.shop_id) {
    alert("กรุณาเลือกลูกค้า");
    return false;
  }

  if (!data.current_credit_limit || data.current_credit_limit <= 0) {
    alert("กรุณากรอกวงเงินปัจจุบัน");
    return false;
  }

  if (!data.credit_term) {
    alert("กรุณากรอกเครดิต");
    return false;
  }

  if (!data.request_amount || data.request_amount <= 0) {
    alert("กรุณากรอกยอดที่ต้องการเปิดบิล / ขออนุมัติวงเงิน");
    return false;
  }

  if (!data.payment_methods?.length) {
    alert("กรุณาเลือกวิธีการชำระเงินอย่างน้อย 1 รายการ");
    return false;
  }

  if (!data.reason || data.reason.trim().length < 5) {
    alert("กรุณากรอกเหตุผลอย่างน้อย 5 ตัวอักษร");
    return false;
  }

  if (requireSignature && !data.signature) {
    alert("กรุณาเซ็นลายเซ็นก่อนส่งคำขอ");
    return false;
  }

  return true;
}

/* =========================================================
   SAVE DRAFT
========================================================= */
async function saveDraft() {
  try {
    const data = collectFormData("draft");

    if (!data.shop_id) {
      alert("กรุณาเลือกลูกค้าก่อนบันทึกร่าง");
      return;
    }

    localStorage.setItem(getDraftKey(), JSON.stringify(data));
    alert("บันทึกร่างในเครื่องเรียบร้อยแล้ว");
  } catch (err) {
    console.error("Save draft error:", err);
    alert("บันทึกร่างไม่สำเร็จ: " + (err.message || err));
  }
}

/* =========================================================
   SUBMIT REQUEST
========================================================= */
async function submitRequest(evt) {
  const submitBtn = evt?.currentTarget || evt?.target || null;

  try {
    const data = collectFormData("pending");
    if (!validateForm(data, true)) return;

    setButtonLoading(submitBtn, true, "กำลังส่ง...");

    const { data: inserted, error } = await window.supabaseClient
      .from("approval_requests")
      .insert(data)
      .select("id")
      .single();

    if (error) throw error;

    localStorage.removeItem(getDraftKey());

    alert("ส่งคำขออนุมัติเรียบร้อยแล้ว");

    showRequestPreview(inserted?.id, data);

  } catch (err) {
    console.error("Submit error:", err);
    alert("ส่งคำขอไม่สำเร็จ: " + (err.message || err));
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

/* ========================================================= */
/*   DRAFT RESTORE
/* ========================================================= */
function restoreDraft() {
  const raw = localStorage.getItem(getDraftKey());
  if (!raw) return;

  try {
    const draft = JSON.parse(raw);
    if (!draft) return;

    if (!confirm("พบข้อมูลร่างที่เคยบันทึกไว้ ต้องการโหลดกลับมาหรือไม่?")) {
      return;
    }

    setValue("shopSelect", draft.shop_id || "");
    onShopChange();

    setValue("currentCreditLimit", draft.current_credit_limit || "");
    setValue("creditTerm", draft.credit_term || "");
    setValue("saleOrderNo", draft.sale_order_no || "");
    setValue("requestDate", draft.request_date || "");
    setValue("requestAmount", draft.request_amount || "");
    setValue("reasonText", draft.reason || "");

    updateCount();

    document.querySelectorAll('input[name="payment_method"]').forEach((input) => {
      input.checked = Array.isArray(draft.payment_methods)
        ? draft.payment_methods.includes(input.value)
        : false;
    });
  } catch (err) {
    console.warn("Restore draft failed:", err);
  }
}

function getDraftKey() {
  return `creditLimitDraft:${currentUser?.id || "unknown"}`;
}








function showRequestPreview(insertedId, formData) {
  const card = document.getElementById("requestPreviewCard");
  if (!card) return;

  card.classList.remove("hidden");

  const now = new Date();

  const docNo = insertedId
    ? `CRD-${String(insertedId)
        .replace(/-/g, "")
        .substring(0, 8)
        .toUpperCase()}`
    : "CRD-NEW";

  const amount =
    formData.request_amount
      ? Number(formData.request_amount)
          .toLocaleString("th-TH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          }) + " บาท"
      : "-";

  const creator =
    formData.sale_name ||
    currentProfile?.display_name ||
    currentProfile?.username ||
    "-";

  const createdAt =
    formatThaiDateTime(now);

  setText("previewDocNo", docNo);
  setText("previewShopName", formData.shop_name || "-");
  setText("previewShopCode", formData.shop_code || "-");
  setText("previewSaleOrderNo", formData.sale_order_no || "-");
  setText("previewRequestAmount", amount);

  setText(
    "previewCreator",
    `ผู้ขอ: ${creator}`
  );

  setText(
    "previewCreatedAt",
    createdAt
  );

  setText(
    "previewCreatedAtFooter",
    `วันที่: ${createdAt}`
  );

  setText(
    "previewAvatar",
    creator.substring(0, 1).toUpperCase()
  );

  card.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

/* =========================================================
   HELPERS
========================================================= */
function setToday() {
  const input = document.getElementById("requestDate");
  if (!input || input.value) return;

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");

  input.value = `${yyyy}-${mm}-${dd}`;
}

function getValue(id) {
  return document.getElementById(id)?.value?.trim() || "";
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? "";
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "";
}

function setDisplay(id, value) {
  const el = document.getElementById(id);
  if (el) el.style.display = value;
}

function toNumber(value) {
  if (value === null || value === undefined) return null;

  const cleaned = String(value)
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();

  if (!cleaned) return null;

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatThaiDateTime(date) {
  return new Intl.DateTimeFormat("th-TH", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function setButtonLoading(button, loading, text) {
  if (!button) return;

  if (loading) {
    button.dataset.oldText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = text || "กำลังโหลด...";
  } else {
    button.disabled = false;
    if (button.dataset.oldText) {
      button.innerHTML = button.dataset.oldText;
    }
  }
}