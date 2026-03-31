// ============================================================
// admintor.js
// หน้า Admin สำหรับจัดการผู้ใช้งาน
//
// หน้าที่หลักของไฟล์นี้
// - โหลดข้อมูลผู้ใช้จาก Supabase
// - แสดงตารางผู้ใช้ (ผ่าน renderUsers.js + template)
// - filter / search
// - แก้ไขผู้ใช้
// - เปลี่ยนสถานะ Active / Inactive
// - ลบผู้ใช้
// ============================================================



// ============================================================
// GLOBAL VARIABLES
// ตัวแปรที่ใช้ทั้งไฟล์
// ============================================================

// เก็บข้อมูล user ทั้งหมดที่โหลดจาก database
let allUsersData = [];

// เก็บ id ของ user ที่กำลังจะลบ
let deleteTargetId = null;



// ============================================================
// protectAdmin()
// ตรวจสอบสิทธิ์ว่า user ที่เข้าหน้านี้เป็น admin หรือไม่
// ============================================================

async function protectAdmin() {

  // เรียก function จาก auth.js
  // ตรวจสอบ role ของ user
  await protectPage(["admin"]);

  // init service สำหรับ user
  if (typeof initUserService === "function")
    await initUserService();

  // ปุ่ม logout
  const logoutBtn = document.getElementById("logoutBtn");

  if (logoutBtn)
    logoutBtn.addEventListener("click", logout);

  // แสดงชื่อ user ใน header
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
// ปุ่มกลับหน้าหลัก
// ✅ แก้ไข: เปลี่ยนจาก admintor.html → index.html
// ============================================================

function goHome() {

  window.location.href = "/pages/admin/adminDashboard.html";

}



// ============================================================
// loadUsers()
// โหลดข้อมูลผู้ใช้จาก Supabase
// ============================================================

async function loadUsers() {

  const tbody = document.getElementById("userTable");

  // แสดง loading state
  tbody.innerHTML =
  `<tr>
     <td colspan="6" class="state-cell">
       ⏳ กำลังโหลด...
     </td>
   </tr>`;


  // query ตาราง profiles
  const { data, error } = await supabaseClient
    .from("profiles")
    .select(
      "id, email, username, display_name, role, status, area, created_at"
    )
    .order("created_at", { ascending: false });


  // ถ้าเกิด error
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


  // เก็บข้อมูลไว้ใน global
  allUsersData = data || [];

  // อัปเดต stat chips
  updateStats(allUsersData);

  // render ตาราง (ใช้ renderUsers.js + template)
  renderUsers(allUsersData);

}



// ============================================================
// updateStats()
// อัปเดตตัวเลขใน stats bar
// ============================================================

function updateStats(data) {

  document.getElementById("countAll").textContent
    = data.length;

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
// สร้าง badge สำหรับ role
// ใช้ใน renderUsers.js ด้วย (global function)
// ============================================================

function roleBadge(role) {

  const map = {

    admin: {
      cls:   "role-admin",
      icon:  "shield",
      label: "Admin"
    },
    
    adminQc: {
      cls:   "role-adminqc",
      icon:  "verified_user",
      label: "AdminQC"
    },
    
    manager: {
      cls:   "role-manager",
      icon:  "supervisor_account",
      label: "Manager"
    },

    executive: {
      cls:   "role-executive",
      icon:  "star",
      label: "Executive"
    },

    sales: {
      cls:   "role-sales",
      icon:  "badge",
      label: "Sales"
    },

    user: {
      cls:   "role-user",
      icon:  "person",
      label: "User"
    }, 
  };

  const r =
    map[role] ||
    { cls: "role-user", icon: "person", label: role || "?" };


  return `
    <span class="role-badge ${r.cls}">
      <span class="material-symbols-outlined">
        ${r.icon}
      </span>
      ${r.label}
    </span>
  `;
}



// ============================================================
// filterUsers()
// ค้นหา + filter role + filter status
// ============================================================

function filterUsers() {

  const keyword =
    document.getElementById("searchUser")
      .value.trim().toLowerCase();

  const roleFilter =
    document.getElementById("filterRole").value;

  const stFilter =
    document.getElementById("filterStatus").value;


  const filtered = allUsersData.filter(u => {

    // search
    const matchText =
      !keyword ||
      (u.email        || "").toLowerCase().includes(keyword) ||
      (u.username     || "").toLowerCase().includes(keyword) ||
      (u.display_name || "").toLowerCase().includes(keyword);

    // role
    const matchRole =
      !roleFilter || u.role === roleFilter;

    // status
    const matchStatus =
      !stFilter || (u.status || "") === stFilter;

    return matchText && matchRole && matchStatus;

  });

  renderUsers(filtered);

}



// ============================================================
// toggleStatus()
// เปลี่ยนสถานะ Active / Inactive
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


  // อัปเดต local data
  const user = allUsersData.find(u => u.id === userId);

  if (user)
    user.status = newStatus;

  updateStats(allUsersData);

  filterUsers();

}



// ============================================================
// ── EDIT MODAL ──────────────────────────────────────────────
// ============================================================

// ============================================================
// openEditModal()
// เปิด modal แก้ไข user และโหลดข้อมูลเข้า form
// ============================================================

function openEditModal(userId) {

  const user = allUsersData.find(u => u.id === userId);

  if (!user) return;

  // เก็บ id ใน hidden input
  document.getElementById("editUserId").value = userId;

  // แสดงอีเมลใน header modal
  document.getElementById("modalUserInfo").innerHTML = `
    <span class="material-symbols-outlined">person</span>
    ${escapeHtml(user.email || "-")}
  `;

  // กรอกข้อมูลเดิมเข้า form
  document.getElementById("editUsername").value    = user.username     || "";
  document.getElementById("editDisplayName").value = user.display_name || "";
  document.getElementById("editRole").value        = user.role         || "user";
  document.getElementById("editStatus").value      = user.status       || "Active";
  document.getElementById("editArea").value        = user.area         || "";

  // เปิด modal
  document.getElementById("editModal").style.display = "flex";

}



// ============================================================
// closeEditModal()
// ปิด modal แก้ไข
// ============================================================

function closeEditModal() {

  document.getElementById("editModal").style.display = "none";

  // reset ปุ่ม save กลับเป็นปกติ
  const btn = document.getElementById("saveBtn");

  btn.disabled = false;

  btn.innerHTML = `
    <span class="material-symbols-outlined">save</span>
    บันทึก
  `;

}



// ============================================================
// saveUser()
// บันทึกการแก้ไข user ลง Supabase
// ============================================================

async function saveUser() {

  const userId      = document.getElementById("editUserId").value;
  const username    = document.getElementById("editUsername").value.trim();
  const displayName = document.getElementById("editDisplayName").value.trim();
  const role        = document.getElementById("editRole").value;
  const status      = document.getElementById("editStatus").value;
  const area        = document.getElementById("editArea").value.trim();

  // validation เบื้องต้น
  if (!role || !status) {
    alert("กรุณาเลือก Role และ สถานะ");
    return;
  }

  // disable ปุ่มกันกด 2 ครั้ง
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

  // อัปเดต local cache
  const user = allUsersData.find(u => u.id === userId);

  if (user) {
    user.username     = username     || null;
    user.display_name = displayName  || null;
    user.role         = role;
    user.status       = status;
    user.area         = area         || null;
  }

  updateStats(allUsersData);

  filterUsers();

  closeEditModal();

}



// ============================================================
// ── DELETE MODAL ─────────────────────────────────────────────
// ============================================================

// ============================================================
// openDeleteModal()
// เปิด modal ยืนยันการลบ user
// ============================================================

function openDeleteModal(userId, label) {

  deleteTargetId = userId;

  document.getElementById("deleteUserLabel").textContent =
    label || userId;

  document.getElementById("deleteModal").style.display = "flex";

}



// ============================================================
// closeDeleteModal()
// ปิด modal ยืนยันลบ และ reset state
// ============================================================

function closeDeleteModal() {

  deleteTargetId = null;

  document.getElementById("deleteModal").style.display = "none";

}



// ============================================================
// confirmDelete()
// ลบ profile user ออกจาก Supabase
// หมายเหตุ: ลบเฉพาะ profile ไม่ได้ลบ Auth account
// ============================================================

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

  // ลบออกจาก local cache
  allUsersData =
    allUsersData.filter(u => u.id !== deleteTargetId);

  updateStats(allUsersData);

  filterUsers();

  closeDeleteModal();

}



// ============================================================
// INIT PAGE
// เริ่มทำงานเมื่อหน้าเว็บโหลดเสร็จ
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {

  await protectAdmin();

  await loadUsers();

});



// ============================================================
// ── UTILITIES ───────────────────────────────────────────────
// ============================================================

// ============================================================
// escapeHtml()
// ป้องกัน XSS ก่อนแสดงผลใน HTML
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



// ============================================================
// escapeAttr()
// ป้องกันปัญหาใน HTML attribute
// ============================================================

function escapeAttr(text) {

  if (!text) return "";

  return text
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}