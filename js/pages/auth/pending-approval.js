// ============================================================
// pending-approval.js
// หน้ารอการอนุมัติจาก admin
//
// รองรับ 2 flow:
//   1. หลังสมัครเสร็จ → ส่ง user info ผ่าน sessionStorage
//   2. user Inactive พยายาม login → ส่งผ่าน sessionStorage เช่นกัน
//
// ฟังก์ชันหลัก:
//   - โหลดข้อมูล user มาแสดง
//   - ปุ่ม "ตรวจสอบสถานะ" → query profile ใน DB
//     ถ้า Active แล้ว → auto-login เข้าระบบตาม role
//     ถ้ายัง Inactive → แจ้ง toast
// ============================================================


// ============================================================
// INIT
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  loadUserInfo();
});


// ============================================================
// loadUserInfo()
// โหลดข้อมูล user จาก sessionStorage มาแสดงในหน้านี้
// ============================================================
function loadUserInfo() {

  try {
    const infoStr = sessionStorage.getItem("pending_user_info");

    if (!infoStr) {
      // ไม่มีข้อมูลใน sessionStorage → user อาจเข้าหน้านี้โดยตรง
      document.getElementById("infoEmail").textContent    = "ไม่พบข้อมูล";
      document.getElementById("infoUsername").textContent = "กรุณาเข้าสู่ระบบใหม่";
      document.getElementById("infoName").textContent     = "-";
      return;
    }

    const info = JSON.parse(infoStr);

    document.getElementById("infoEmail").textContent    = info.email        || "-";
    document.getElementById("infoUsername").textContent = info.username     || "-";
    document.getElementById("infoName").textContent     = info.display_name || "-";

  } catch (err) {
    console.error("Error loading user info:", err);
  }
}


// ============================================================
// checkStatus()
// ปุ่ม "ตรวจสอบสถานะอีกครั้ง"
//
// Logic:
//   1. ดึงข้อมูล user จาก sessionStorage
//   2. Query profile ล่าสุดจาก DB (ใช้ email/username)
//   3. ถ้า status === "Active" + role !== "user"
//      → พยายาม sign in ด้วย password ที่เก็บไว้
//      → redirect ตาม role
//   4. ถ้ายัง Inactive → แสดง toast
// ============================================================
async function checkStatus() {

  const btn = document.getElementById("checkBtn");
  const btnText = btn.querySelector("span");
  const btnIcon = btn.querySelector("i");

  // ── disable ปุ่ม + แสดง loading ──
  btn.disabled = true;
  btn.classList.add("loading");
  btnText.textContent = "กำลังตรวจสอบ...";

  try {
    // ── ดึงข้อมูล user ──
    const infoStr = sessionStorage.getItem("pending_user_info");

    if (!infoStr) {
      showToast("ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่", "error");
      setTimeout(() => backToLogin(), 2000);
      return;
    }

    const info = JSON.parse(infoStr);

    // ── Query profile ล่าสุดจาก DB ──
    const { data: profile, error } = await supabaseClient
      .from("profiles")
      .select("id, email, username, role, status, display_name")
      .eq("email", info.email)
      .maybeSingle();

    if (error) {
      console.error("Check status error:", error);
      showToast("ไม่สามารถตรวจสอบสถานะได้ กรุณาลองใหม่", "error");
      return;
    }

    if (!profile) {
      showToast("ไม่พบข้อมูลผู้ใช้ในระบบ", "error");
      setTimeout(() => backToLogin(), 2000);
      return;
    }

    // ══════════════════════════════════════════════
    // ตรวจสอบ status
    // ══════════════════════════════════════════════

    // Case 1: ยัง Inactive → ยังไม่ได้รับอนุมัติ
    if (profile.status !== "Active") {
      showToast(
        "ยังไม่ได้รับการอนุมัติ กรุณาแจ้งหัวหน้าของคุณ",
        "warning"
      );
      return;
    }

    // Case 2: Active แล้ว แต่ role ยังเป็น "user" (admin ยังไม่เปลี่ยน role)
    if (profile.role === "user") {
      showToast(
        "กำลังรอ admin กำหนดสิทธิ์การใช้งาน",
        "warning"
      );
      return;
    }

    // ══════════════════════════════════════════════
    // Case 3: Active + มี role แล้ว → auto login
    // ══════════════════════════════════════════════
    showToast("ได้รับการอนุมัติแล้ว! กำลังเข้าสู่ระบบ...", "success");

    // ── พยายาม sign in ด้วย password ที่เก็บไว้ ──
    if (info.password) {
      const { error: loginError } = await supabaseClient.auth.signInWithPassword({
        email: info.email,
        password: info.password,
      });

      if (loginError) {
        console.error("Auto-login error:", loginError);
        // ถ้า auto-login fail → ส่งไปหน้า login ให้ user กรอกเอง
        clearPendingData();
        setTimeout(() => {
          window.location.href = "/pages/auth/login.html";
        }, 1500);
        return;
      }

      // ── Login สำเร็จ → redirect ตาม role ──
      clearPendingData();
      setTimeout(() => redirectByRole(profile.role), 1200);

    } else {
      // ── ไม่มี password (user เข้าหน้านี้โดยตรง) → ส่งไป login ──
      clearPendingData();
      setTimeout(() => {
        window.location.href = "/pages/auth/login.html";
      }, 1500);
    }

  } catch (err) {
    console.error("Check status exception:", err);
    showToast("เกิดข้อผิดพลาด กรุณาลองใหม่", "error");

  } finally {
    // ── reset ปุ่มหลัง 2 วินาที ──
    setTimeout(() => {
      btn.disabled = false;
      btn.classList.remove("loading");
      btnText.textContent = "ตรวจสอบสถานะอีกครั้ง";
    }, 1500);
  }
}


// ============================================================
// redirectByRole()
// Redirect ตาม role ของ user
// ============================================================
function redirectByRole(role) {

  const routes = {
    admin:     "/pages/dashboard/adminDashboard.html",
    adminQc:   "/pages/dashboard/QcDashboard.html",
    sales:     "/index.html",
    manager:   "/index.html",
    executive: "/pages/executive/executiveHome.html",
  };

  const url = routes[role];

  if (url) {
    window.location.href = url;
  } else {
    // role ที่ไม่รู้จัก → กลับ login
    window.location.href = "/pages/auth/login.html";
  }
}


// ============================================================
// backToLogin()
// กลับไปหน้า login
// ============================================================
function backToLogin() {
  clearPendingData();
  window.location.href = "/pages/auth/login.html";
}


// ============================================================
// clearPendingData()
// เคลียร์ข้อมูลใน sessionStorage
// ============================================================
function clearPendingData() {
  try {
    sessionStorage.removeItem("pending_user_info");
  } catch (e) {
    // ignore
  }
}


// ============================================================
// showToast()
// แสดง toast notification
// ============================================================
function showToast(message, type = "info") {

  const toast = document.getElementById("toast");
  const toastMsg = document.getElementById("toastMessage");
  const toastIcon = toast.querySelector("i");

  // reset classes
  toast.classList.remove("toast-warning", "toast-success", "toast-error");

  // เพิ่ม class ตาม type
  if (type === "warning") {
    toast.classList.add("toast-warning");
    toastIcon.className = "fa-solid fa-triangle-exclamation";
  } else if (type === "success") {
    toast.classList.add("toast-success");
    toastIcon.className = "fa-solid fa-circle-check";
  } else if (type === "error") {
    toast.classList.add("toast-error");
    toastIcon.className = "fa-solid fa-circle-xmark";
  } else {
    toastIcon.className = "fa-solid fa-circle-info";
  }

  toastMsg.textContent = message;
  toast.classList.add("show");

  // auto-hide after 3s
  setTimeout(() => {
    toast.classList.remove("show");
  }, 3500);
}