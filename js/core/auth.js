// ======================================================
// auth.js
// ไฟล์นี้ใช้สำหรับจัดการระบบ Authentication ของระบบ
// เช่น Login / Register / Protect Page / Logout
// โดยใช้ Supabase Authentication
// ต้องโหลด supabaseClient.js และ roleConfig.js ก่อนไฟล์นี้
// ======================================================

if (typeof supabaseClient === 'undefined') {
  console.error('❌ supabaseClient ไม่พร้อมใช้งาน! ตรวจสอบว่าโหลด supabaseClient.js ก่อนหรือยัง');
}

if (typeof ROLE_CONFIG === 'undefined') {
  console.error('❌ ROLE_CONFIG ไม่พร้อมใช้งาน! ตรวจสอบว่าโหลด roleConfig.js ก่อนหรือยัง');
}

// ======================================================
// LOGIN SECTION
// ======================================================

const loginForm = document.getElementById("loginForm");

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email    = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    const msg      = document.getElementById("message");

    try {
      msg.innerText    = "กำลังเข้าสู่ระบบ...";
      msg.style.color  = "#666";

      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

      if (error) {
        msg.innerText   = "เข้าสู่ระบบไม่สำเร็จ: " + error.message;
        msg.style.color = "red";
        console.error("❌ Login error:", error);
        return;
      }

      // ✅ ดึง role จาก profiles เพื่อ redirect ไปหน้า default ของ role
      const { data: profile } = await supabaseClient
        .from("profiles")
        .select("role, status")
        .eq("id", data.user.id)
        .single();

      // เช็ค status ก่อน redirect
      if (profile?.status?.toLowerCase() !== "active") {
        await supabaseClient.auth.signOut();
        msg.innerText   = "บัญชีของคุณถูกระงับการใช้งาน";
        msg.style.color = "red";
        return;
      }

      const destination = getDefaultPage(profile?.role);

      console.log("✅ Login successful — role:", profile?.role, "→", destination);
      msg.innerText   = "เข้าสู่ระบบสำเร็จ!";
      msg.style.color = "green";

      setTimeout(() => {
        window.location.href = destination;
      }, 500);

    } catch (error) {
      console.error("❌ Unexpected login error:", error);
      msg.innerText   = "เกิดข้อผิดพลาดในการเข้าสู่ระบบ";
      msg.style.color = "red";
    }
  });
}

// ======================================================
// REGISTER SECTION
// ======================================================

const registerForm = document.getElementById("registerForm");

if (registerForm) {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email    = document.getElementById("regEmail").value;
    const password = document.getElementById("regPassword").value;
    const username = document.getElementById("username").value;
    const msg      = document.getElementById("regMessage");

    try {
      msg.innerText   = "กำลังสมัครสมาชิก...";
      msg.style.color = "#666";

      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { data: { username } }
      });

      if (error) {
        msg.innerText   = "สมัครสมาชิกไม่สำเร็จ: " + error.message;
        msg.style.color = "red";
        console.error("❌ Registration error:", error);
        return;
      }

      console.log("✅ Registration successful");
      msg.innerText   = "สมัครสมาชิกสำเร็จ! กรุณารอ Admin อนุมัติบัญชีก่อนเข้าใช้งาน";
      msg.style.color = "green";

    } catch (error) {
      console.error("❌ Unexpected registration error:", error);
      msg.innerText   = "เกิดข้อผิดพลาดในการสมัครสมาชิก";
      msg.style.color = "red";
    }
  });
}

// ======================================================
// PROTECT PAGE BY ROLE
// ======================================================
// ใช้ ROLE_CONFIG จาก roleConfig.js
// - ดึง role จาก DB ทุกครั้ง (ไม่ใช้ session cache)
// - เปลี่ยน role แล้วเห็นผลทันทีโดยไม่ต้อง logout
// - ถ้าไม่มีสิทธิ์ → redirect ไปหน้า default ของ role ตัวเอง
// ======================================================

async function protectPage(allowedRoles = []) {
  try {
    console.log("🔒 Checking page protection...");

    // 1️⃣ ดึง session
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();

    if (sessionError || !session) {
      console.warn("⚠️ No active session");
      window.location.href = "/pages/auth/login.html";
      return;
    }

    console.log("✅ Session found:", session.user.email);

    // 2️⃣ ดึง role และ status จาก DB ตรงๆ ทุกครั้ง
    const { data: profile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("role, status")
      .eq("id", session.user.id)
      .single();

    if (profileError || !profile) {
      console.error("❌ Profile not found");
      window.location.href = "/pages/auth/login.html";
      return;
    }

    console.log("✅ Profile found — role:", profile.role, "status:", profile.status);

    // 3️⃣ เช็ค status
    if (profile.status?.toLowerCase() !== "active") {
      console.warn("⚠️ User not active:", profile.status);
      await supabaseClient.auth.signOut();
      alert("บัญชีของคุณถูกระงับการใช้งาน กรุณาติดต่อ Admin");
      window.location.href = "/pages/auth/login.html";
      return;
    }

    // 4️⃣ เช็ค role ว่าเข้าหน้านี้ได้ไหม
    if (allowedRoles.length > 0) {
      const hasRole = allowedRoles.includes(profile.role);

      if (!hasRole) {
        console.warn("⚠️ Role not allowed:", profile.role, "— allowed:", allowedRoles);

        // ✅ redirect ไปหน้า default ของ role ตัวเอง (ไม่ kick ไป login)
        const destination = getDefaultPage(profile.role);
        console.log("↩️ Redirecting to:", destination);
        window.location.href = destination;
        return;
      }
    }

    console.log("✅ Page protection passed");

    // 5️⃣ init userService
    if (typeof initUserService === 'function') {
      await initUserService();
    }

  } catch (error) {
    console.error("❌ protectPage error:", error);
    window.location.href = "/pages/auth/login.html";
  }
}

// ======================================================
// LOGOUT
// ======================================================

async function logout() {
  try {
    console.log("🚪 Logging out...");

    const { error } = await supabaseClient.auth.signOut();
    if (error) console.error("❌ Logout error:", error);

    // ล้าง currentUser
    if (typeof window.currentUser !== 'undefined') {
      window.currentUser = {
        id: null, email: null, full_name: null,
        display_name: null, area: null, position: null,
        department: null, phone: null, role: null,
        created_at: null, updated_at: null
      };
    }

    console.log("✅ Logged out");
    window.location.href = "/pages/auth/login.html";

  } catch (error) {
    console.error("❌ Unexpected logout error:", error);
    window.location.href = "/pages/auth/login.html";
  }
}

// ======================================================
// CHECK AUTH STATUS
// ======================================================

async function checkAuthStatus() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
      console.log("✅ Authenticated:", session.user.email);
      return true;
    }
    console.log("ℹ️ Not authenticated");
    return false;
  } catch (error) {
    console.error("❌ checkAuthStatus error:", error);
    return false;
  }
}

// ======================================================
// EXPORT
// ======================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { protectPage, logout, checkAuthStatus };
}

console.log("✅ auth.js loaded");