// ============================================================
// admin-sales.js
// จัดการหน้า Sales สำหรับ Admin
// ============================================================

// -------------------------------------------------------
// ตัวแปร global เก็บข้อมูล sales ทั้งหมดไว้ filter ได้
// -------------------------------------------------------
let allSalesData = [];

// -------------------------------------------------------
// protectAdmin()
// ป้องกันหน้า admin — wrap protectPage() ที่มีใน auth.js
// แล้ว init userService เพื่อให้ชื่อ user ขึ้น header
// -------------------------------------------------------
async function protectAdmin() {
  // protectPage อยู่ใน auth.js — กำหนด role ที่เข้าได้
  await protectPage(["admin"]);

  // โหลดชื่อ user ขึ้น header (แก้ปัญหา "กำลังโหลด...")
  if (typeof initUserService === "function") {
    await initUserService();
  }

  // ผูกปุ่ม logout
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", logout);
  }
}

// -------------------------------------------------------
// loadSales()
// โหลดรายชื่อ sales พร้อมจำนวนร้านค้าใน 2 queries (แก้ N+1)
// -------------------------------------------------------
async function loadSales() {
  const table = document.getElementById("salesTable");
  table.innerHTML = `<tr><td colspan="5" class="loading-cell">⏳ กำลังโหลด...</td></tr>`;

  // ── 1. ดึงข้อมูล sales ทั้งหมด ──────────────────────
  const { data: salesData, error: salesError } = await supabaseClient
    .from("profiles")
    .select("id, display_name, username, area")
    .eq("role", "sales")
    .order("created_at", { ascending: false });

  if (salesError) {
    console.error("โหลด sales ไม่สำเร็จ:", salesError);
    table.innerHTML = `<tr><td colspan="5" class="error-cell">❌ โหลดข้อมูลไม่สำเร็จ</td></tr>`;
    return;
  }

  if (!salesData || salesData.length === 0) {
    table.innerHTML = `<tr><td colspan="5" class="empty-cell">ไม่พบข้อมูล Sales</td></tr>`;
    return;
  }

  // ── 2. ดึงจำนวนร้านค้าทีเดียว (1 query แทน N queries) ──
  const saleIds = salesData.map(s => s.id);
  let shopCountMap = {};

  const { data: shopsData } = await supabaseClient
    .from("shops")
    .select("sale_id")
    .in("sale_id", saleIds);

  if (shopsData) {
    shopsData.forEach(shop => {
      shopCountMap[shop.sale_id] = (shopCountMap[shop.sale_id] || 0) + 1;
    });
  }

  // ── 3. รวมข้อมูลเก็บ global ──────────────────────────
  allSalesData = salesData.map(sale => ({
    ...sale,
    shopCount: shopCountMap[sale.id] || 0,
  }));

  renderTable(allSalesData);
}

// -------------------------------------------------------
// renderTable(data)
// วาดแถวตารางจาก array ที่รับมา
// -------------------------------------------------------
function renderTable(data) {
  const table = document.getElementById("salesTable");
  table.innerHTML = "";

  if (data.length === 0) {
    table.innerHTML = `<tr><td colspan="5" class="empty-cell">ไม่พบข้อมูลที่ค้นหา</td></tr>`;
    return;
  }

  data.forEach((sale, index) => {
    const tr = document.createElement("tr");
    tr.dataset.id = sale.id;
    tr.style.animationDelay = `${index * 0.05}s`;
    tr.className = "fade-in-row";

    tr.innerHTML = `
      <td>
        <span class="username-chip">${escapeHtml(sale.username)}</span>
      </td>

      <td>
        <span class="editable-cell editable-name"
              title="คลิกเพื่อแก้ไขชื่อ"
              onclick="editField(this, '${sale.id}', 'display_name')">
          ${escapeHtml(sale.display_name || "-")}
        </span>
      </td>

      <td>
        <span class="editable-cell badge-area"
              title="คลิกเพื่อแก้ไขพื้นที่"
              onclick="editField(this, '${sale.id}', 'area')">
          ${escapeHtml(sale.area || "ยังไม่ระบุ")}
        </span>
      </td>

      <td>
        <span class="badge-count">
          🏪 ${sale.shopCount} ร้าน
        </span>
      </td>

      <td>
        <button class="btn-action btn-edit"
                onclick="goManage('${sale.id}')">
          <span class="material-symbols-outlined" style="font-size:16px;vertical-align:middle">store</span>
          จัดการ
        </button>
      </td>
    `;

    table.appendChild(tr);
  });
}

// -------------------------------------------------------
// filterSales()
// กรองตารางตาม keyword จาก search box
// -------------------------------------------------------
function filterSales() {
  const keyword = document.getElementById("searchSales").value.trim().toLowerCase();

  if (!keyword) {
    renderTable(allSalesData);
    return;
  }

  const filtered = allSalesData.filter(sale =>
    (sale.username || "").toLowerCase().includes(keyword) ||
    (sale.display_name || "").toLowerCase().includes(keyword) ||
    (sale.area || "").toLowerCase().includes(keyword)
  );

  renderTable(filtered);
}

// -------------------------------------------------------
// editField(element, saleId, field)
// คลิก cell เพื่อแก้ไขได้ทันที (ใช้ร่วมกันทุก field)
// -------------------------------------------------------
function editField(element, saleId, field) {
  const originalText = element.innerText.trim();
  const placeholder = field === "display_name" ? "ชื่อ Sales..." : "ระบุพื้นที่...";

  // สร้าง input แทน span
  const input = document.createElement("input");
  input.type = "text";
  input.className = "inline-input";
  input.value = originalText === "-" || originalText === "ยังไม่ระบุ" ? "" : originalText;
  input.placeholder = placeholder;

  element.replaceWith(input);
  input.focus();
  input.select();

  // กด Escape ยกเลิก
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { input.blur(); }
    if (e.key === "Escape") {
      input.removeEventListener("blur", saveHandler);
      restoreCell(input, saleId, field, originalText === "-" || originalText === "ยังไม่ระบุ" ? "" : originalText);
    }
  });

  // บันทึกเมื่อ blur
  const saveHandler = () => saveField(input, saleId, field, originalText);
  input.addEventListener("blur", saveHandler, { once: true });
}

// -------------------------------------------------------
// saveField(input, saleId, field, originalText)
// บันทึกค่าลง Supabase แล้ว restore element
// -------------------------------------------------------
async function saveField(input, saleId, field, originalText) {
  const newValue = input.value.trim();
  const displayOld = originalText === "-" || originalText === "ยังไม่ระบุ" ? "" : originalText;

  // ถ้าค่าเหมือนเดิม ไม่ต้อง query
  if (newValue === displayOld) {
    restoreCell(input, saleId, field, newValue);
    return;
  }

  // แสดง loading state
  input.disabled = true;
  input.style.opacity = "0.5";

  const { error } = await supabaseClient
    .from("profiles")
    .update({ [field]: newValue || null })
    .eq("id", saleId);

  if (error) {
    console.error("saveField error:", error);
    input.disabled = false;
    input.style.opacity = "1";
    input.style.borderColor = "#ef4444";
    input.title = "❌ บันทึกไม่สำเร็จ ลองอีกครั้ง";
    return;
  }

  // อัปเดต local data
  const sale = allSalesData.find(s => s.id === saleId);
  if (sale) sale[field] = newValue || null;

  restoreCell(input, saleId, field, newValue);
}

// -------------------------------------------------------
// restoreCell(input, saleId, field, value)
// คืน span กลับมาหลังแก้ไขเสร็จ
// -------------------------------------------------------
function restoreCell(input, saleId, field, value) {
  const span = document.createElement("span");

  if (field === "display_name") {
    span.className = "editable-cell editable-name";
    span.title = "คลิกเพื่อแก้ไขชื่อ";
    span.textContent = value || "-";
    span.onclick = () => editField(span, saleId, "display_name");
  } else {
    span.className = "editable-cell badge-area";
    span.title = "คลิกเพื่อแก้ไขพื้นที่";
    span.textContent = value || "ยังไม่ระบุ";
    span.onclick = () => editField(span, saleId, "area");
  }

  input.replaceWith(span);
}

// -------------------------------------------------------
// goManage / goHome
// -------------------------------------------------------
function goManage(id) {
  window.location.href = `adminShops.html?sale=${id}`;
}

function goHome() {
  window.location.href = "/pages/admin/adminDashboard.html";
}

// -------------------------------------------------------
// escapeHtml — ป้องกัน XSS
// -------------------------------------------------------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// -------------------------------------------------------
// เริ่มต้น: protectAdmin → user ขึ้น header → โหลดตาราง
// -------------------------------------------------------
window.addEventListener("load", async () => {
  await protectAdmin();  // ตรวจ session + โหลดชื่อ user ขึ้น header
  await loadSales();     // โหลดตาราง sales ทันที ไม่ต้องกดรีเฟรช
});