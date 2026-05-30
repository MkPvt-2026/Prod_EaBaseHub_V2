// ============================================================
// admintor.js
// หน้า Admin สำหรับจัดการผู้ใช้งาน
//
// ✨ เพิ่มใหม่จากเวอร์ชันเดิม:
//  - แสดง badge "รออนุมัติ" ที่ stat-chip Inactive
//  - ปุ่ม quick approve สำหรับ Inactive users
//  - Notification banner ด้านบนถ้ามี user ใหม่
// ============================================================



// ============================================================
// GLOBAL VARIABLES
// ============================================================

let allUsersData = [];
let deleteTargetId = null;



// ============================================================
// protectAdmin()
// ============================================================

async function protectAdmin() {

  await protectPage(["admin"]);

  if (typeof initUserService === "function")
    await initUserService();

  const logoutBtn = document.getElementById("logoutBtn");

  if (logoutBtn)
    logoutBtn.addEventListener("click", logout);

  if (window.currentUser) {

    const nameEl = document.getElementById("userName");

    if (nameEl)
      nameEl.textContent =
        window.currentUser.display_name ||
        window.currentUser.username     ||
        window.currentUser.email        ||
        "Admin";
  }
}



// ============================================================
// goHome()
// ============================================================

function goHome() {
  window.location.href = "/pages/admin/adminDashboard.html";
}



// ============================================================
// loadUsers()
// ============================================================

async function loadUsers() {

  const tbody = document.getElementById("userTable");

  tbody.innerHTML =
  `<tr>
     <td colspan="6" class="state-cell">
       ⏳ กำลังโหลด...
     </td>
   </tr>`;


  const { data, error } = await supabaseClient
    .from("profiles")
    .select(
      "id, email, username, display_name, role, status, area, created_at"
    )
    .order("created_at", { ascending: false });


  if (error) {

    console.error("loadUsers error:", error);

    tbody.innerHTML =
    `<tr>
       <td colspan="6" class="state-cell" style="color:#ef4444">
         ❌ โหลดข้อมูลไม่สำเร็จ
       </td>
     </tr>`;

    return;
  }


  allUsersData = data || [];

  updateStats(allUsersData);

  // ✨ แสดง notification banner ถ้ามี user ใหม่รออนุมัติ
  showPendingNotification(allUsersData);

  renderUsers(allUsersData);
}



// ============================================================
// ✨ showPendingNotification()
// แสดง banner ด้านบนตารางถ้ามี user ใหม่รออนุมัติ
// ============================================================

function showPendingNotification(data) {

  const pendingUsers = data.filter(u =>
    u.status === "Inactive" && u.role === "user"
  );

  const oldBanner = document.getElementById("pendingBanner");
  if (oldBanner) oldBanner.remove();

  if (pendingUsers.length === 0) return;

  const banner = document.createElement("div");
  banner.id = "pendingBanner";
  banner.className = "pending-banner";

  banner.innerHTML = `
    <div class="pending-banner-main">
      <span class="material-symbols-outlined">notifications_active</span>
      <div>
        <strong>มีผู้ใช้สมัครใหม่ ${pendingUsers.length} คน</strong>
        <p>รอการอนุมัติและกำหนดสิทธิ์ก่อนเริ่มใช้งานระบบ</p>
      </div>
    </div>

    <button type="button" onclick="filterPendingOnly()">
      ดูรายการรออนุมัติ
      <span class="material-symbols-outlined">arrow_forward</span>
    </button>
  `;

  const panel = document.querySelector(".admin-panel");
  if (panel) panel.insertBefore(banner, panel.firstChild);
}

// ============================================================
// ✨ filterPendingOnly()
// กรองแสดงเฉพาะ user ที่รออนุมัติ (เรียกจากปุ่ม banner)
// ============================================================

function filterPendingOnly() {

  document.getElementById("searchUser").value = "";
  document.getElementById("filterRole").value = "user";
  document.getElementById("filterStatus").value = "Inactive";

  filterUsers();

  // scroll ไปที่ตาราง
  document.querySelector(".table-wrap")?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}



// ============================================================
// updateStats()
// ============================================================

function updateStats(data) {

  document.getElementById("countAll").textContent = data.length;

  document.getElementById("countAdmin").textContent
    = data.filter(u => u.role === "admin").length;

  document.getElementById("countAdminQC").textContent
    = data.filter(u => u.role === "adminQc").length;

  document.getElementById("countManager").textContent
    = data.filter(u => u.role === "manager").length;

  document.getElementById("countExecutive").textContent
    = data.filter(u => u.role === "executive").length;

  document.getElementById("countSales").textContent
    = data.filter(u => u.role === "sales").length;

  document.getElementById("countUser").textContent
    = data.filter(u => u.role === "user").length;

  document.getElementById("countInactive").textContent
    = data.filter(
        u => (u.status || "").toLowerCase() !== "active"
      ).length;
}



// ============================================================
// roleBadge()
// ============================================================

function roleBadge(role) {

  const map = {
    admin:     { cls: "role-admin",     icon: "shield",             label: "Admin" },
    adminQc:   { cls: "role-adminqc",   icon: "verified_user",      label: "AdminQC" },
    manager:   { cls: "role-manager",   icon: "supervisor_account", label: "Manager" },
    executive: { cls: "role-executive", icon: "star",               label: "Executive" },
    sales:     { cls: "role-sales",     icon: "badge",              label: "Sales" },
    user:      { cls: "role-user",      icon: "person",             label: "User" },
  };

  const r = map[role] || { cls: "role-user", icon: "person", label: role || "?" };

  return `
    <span class="role-badge ${r.cls}">
      <span class="material-symbols-outlined">${r.icon}</span>
      ${r.label}
    </span>
  `;
}



// ============================================================
// filterUsers()
// ============================================================

function filterUsers() {

  const keyword = document.getElementById("searchUser").value.trim().toLowerCase();
  const roleFilter = document.getElementById("filterRole").value;
  const stFilter = document.getElementById("filterStatus").value;

  const filtered = allUsersData.filter(u => {

    const matchText =
      !keyword ||
      (u.email        || "").toLowerCase().includes(keyword) ||
      (u.username     || "").toLowerCase().includes(keyword) ||
      (u.display_name || "").toLowerCase().includes(keyword);

    const matchRole = !roleFilter || u.role === roleFilter;
    const matchStatus = !stFilter || (u.status || "") === stFilter;

    return matchText && matchRole && matchStatus;
  });

  renderUsers(filtered);
}



// ============================================================
// toggleStatus()
// ============================================================

async function toggleStatus(userId, newStatus) {

  const { error } = await supabaseClient
    .from("profiles")
    .update({ status: newStatus })
    .eq("id", userId);

  if (error) {
    alert("เปลี่ยนสถานะไม่สำเร็จ");
    console.error(error);
    return;
  }

  const user = allUsersData.find(u => u.id === userId);
  if (user) user.status = newStatus;

  updateStats(allUsersData);
  showPendingNotification(allUsersData);
  filterUsers();
}



// ============================================================
// ── EDIT MODAL ──────────────────────────────────────────────
// ============================================================

function openEditModal(userId) {

  const user = allUsersData.find(u => u.id === userId);
  if (!user) return;

  document.getElementById("editUserId").value = userId;

  document.getElementById("modalUserInfo").innerHTML = `
    <span class="material-symbols-outlined">person</span>
    ${escapeHtml(user.email || "-")}
  `;

  document.getElementById("editUsername").value    = user.username     || "";
  document.getElementById("editDisplayName").value = user.display_name || "";
  document.getElementById("editRole").value        = user.role         || "user";
  document.getElementById("editStatus").value      = user.status       || "Active";
  document.getElementById("editArea").value        = user.area         || "";

  document.getElementById("editModal").style.display = "flex";
}


function closeEditModal() {

  document.getElementById("editModal").style.display = "none";

  const btn = document.getElementById("saveBtn");
  btn.disabled = false;
  btn.innerHTML = `
    <span class="material-symbols-outlined">save</span>
    บันทึก
  `;
}


async function saveUser() {

  const userId      = document.getElementById("editUserId").value;
  const username    = document.getElementById("editUsername").value.trim();
  const displayName = document.getElementById("editDisplayName").value.trim();
  const role        = document.getElementById("editRole").value;
  const status      = document.getElementById("editStatus").value;
  const area        = document.getElementById("editArea").value.trim();

  if (!role || !status) {
    alert("กรุณาเลือก Role และ สถานะ");
    return;
  }

  const btn = document.getElementById("saveBtn");
  btn.disabled = true;
  btn.innerHTML = `
    <span class="material-symbols-outlined">hourglass_top</span>
    กำลังบันทึก...
  `;

  const { error } = await supabaseClient
    .from("profiles")
    .update({
      username:     username     || null,
      display_name: displayName  || null,
      role,
      status,
      area:         area         || null,
    })
    .eq("id", userId);

  if (error) {
    alert("บันทึกไม่สำเร็จ: " + error.message);
    console.error("saveUser error:", error);

    btn.disabled = false;
    btn.innerHTML = `
      <span class="material-symbols-outlined">save</span>
      บันทึก
    `;
    return;
  }

  const user = allUsersData.find(u => u.id === userId);

  if (user) {
    user.username     = username     || null;
    user.display_name = displayName  || null;
    user.role         = role;
    user.status       = status;
    user.area         = area         || null;
  }

  updateStats(allUsersData);
  showPendingNotification(allUsersData);
  filterUsers();
  closeEditModal();
}



// ============================================================
// ── DELETE MODAL ─────────────────────────────────────────────
// ============================================================

function openDeleteModal(userId, label) {
  deleteTargetId = userId;
  document.getElementById("deleteUserLabel").textContent = label || userId;
  document.getElementById("deleteModal").style.display = "flex";
}


function closeDeleteModal() {
  deleteTargetId = null;
  document.getElementById("deleteModal").style.display = "none";
}


async function confirmDelete() {

  if (!deleteTargetId) return;

  const { error } = await supabaseClient
    .from("profiles")
    .delete()
    .eq("id", deleteTargetId);

  if (error) {
    alert("ลบไม่สำเร็จ: " + error.message);
    console.error("confirmDelete error:", error);
    return;
  }

  allUsersData = allUsersData.filter(u => u.id !== deleteTargetId);

  updateStats(allUsersData);
  showPendingNotification(allUsersData);
  filterUsers();
  closeDeleteModal();
}





// ============================================================
// clearUserFilters()
// ล้างการค้นหาและตัวกรองทั้งหมด
// ============================================================

function clearUserFilters() {
  const search = document.getElementById("searchUser");
  const role   = document.getElementById("filterRole");
  const status = document.getElementById("filterStatus");

  if (search) search.value = "";
  if (role) role.value = "";
  if (status) status.value = "";

  filterUsers();
}


// ============================================================
// bindAdminStatFilters()
// คลิกการ์ดสถิติเพื่อกรองข้อมูลทันที
// ============================================================

function bindAdminStatFilters() {
  const map = [
    ["statAll",       "",          ""],
    ["statAdmin",     "admin",     ""],
    ["statAdminQC",   "adminQc",   ""],
    ["statManager",   "manager",   ""],
    ["statExecutive", "executive", ""],
    ["statSales",     "sales",     ""],
    ["statUser",      "user",      ""],
    ["statInactive",  "",          "Inactive"],
  ];

  map.forEach(([id, role, status]) => {
    const el = document.getElementById(id);
    if (!el) return;

    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");

    const apply = () => {
      document.getElementById("filterRole").value = role;
      document.getElementById("filterStatus").value = status;
      document.getElementById("searchUser").value = "";
      filterUsers();
    };

    el.addEventListener("click", apply);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") apply();
    });
  });
}


// ============================================================
// INIT PAGE
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  await protectAdmin();
  await loadUsers();
  bindAdminStatFilters();
});



// ============================================================
// ── UTILITIES ───────────────────────────────────────────────
// ============================================================

function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#039;");
}


function escapeAttr(text) {
  if (!text) return "";
  return text
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}