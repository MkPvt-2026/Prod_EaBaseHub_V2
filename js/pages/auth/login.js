// ===============================
// Helper: แสดง overlay ก่อน redirect
// ===============================
function showLoginOverlay(redirectUrl) {
  const overlay = document.getElementById("loadingSplash");
  if (overlay) {
    overlay.classList.add("show");
  }
  // หน่วงเล็กน้อยให้ animation เสร็จก่อน redirect
  setTimeout(() => {
    window.location.href = redirectUrl;
  }, 900);
}

// ===============================
// Redirect if already logged in
// ===============================
async function redirectIfLoggedIn() {
  try {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();
    if (!session) return;

    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("role, status")
      .eq("id", session.user.id)
      .single();

    if (!profile) return;

    if (profile.status !== "Active") {
      await supabaseClient.auth.signOut();
      return;
    }

    // Redirect ตาม Role (ไม่แสดง overlay เพราะ user ไม่ได้กด login)
    if (profile.role === "admin") {
      window.location.href = "/pages/dashboard/adminDashboard.html";
    } else if (profile.role === "adminQc") {
      window.location.href = "/pages/dashboard/QcDashboard.html";
    } else if (profile.role === "sales") {
      window.location.href = "/index.html";
    } else if (profile.role === "manager") {
      window.location.href = "/index.html";
    } else if (profile.role === "executive") {
      window.location.href = "/pages/executive/executiveHome.html";
    }
  } catch (error) {
    console.error("Error checking session:", error);
  }
}

redirectIfLoggedIn();

// ===============================
// DOM Ready
// ===============================
document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("loginForm");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const loginBtn = document.getElementById("loginBtn");

  if (!loginForm) return;

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const identifier = emailInput.value.trim();
    const password = passwordInput.value.trim();

    if (!identifier || !password) {
      alert("กรุณากรอก Username/Email และรหัสผ่าน");
      return;
    }

    loginBtn.disabled = true;
    loginBtn.classList.add("loading");

    try {
      let emailToUse = identifier;

      // ถ้าไม่มี @ ให้ถือว่าเป็น username → ไปหา email จาก profiles
      if (!identifier.includes("@")) {
        const { data: userData, error } = await supabaseClient
          .from("profiles")
          .select("email")
          .eq("username", identifier)
          .maybeSingle();

        if (error || !userData) {
          throw new Error("ไม่พบ Username นี้ในระบบ");
        }

        emailToUse = userData.email;
      }

      // Login กับ Supabase Auth
      const { data: authData, error: loginError } =
        await supabaseClient.auth.signInWithPassword({
          email: emailToUse,
          password: password,
        });

      if (loginError) throw loginError;

      // เช็ค role + status จาก profiles
      const { data: profile, error: roleError } = await supabaseClient
        .from("profiles")
        .select("role, status")
        .eq("id", authData.user.id)
        .single();

      if (roleError || !profile) {
        throw new Error("ไม่สามารถตรวจสอบสิทธิ์ได้");
      }

      // ══════════════════════════════════════════════
      // 🔥 แยก error message ตาม status
      // - Inactive  = ยังไม่ได้รับการอนุมัติ (สมัครใหม่)
      // - Suspended = ถูกระงับ
      // ══════════════════════════════════════════════
      if (profile.status !== "Active") {
        await supabaseClient.auth.signOut();

        if (profile.status === "Inactive") {
          throw new Error(
            "บัญชีของคุณยังไม่ได้รับการอนุมัติ\n" +
            "กรุณาแจ้งหัวหน้าของคุณเพื่อขออนุมัติการใช้งาน"
          );
        } else {
          throw new Error("บัญชีของคุณถูกระงับการใช้งาน");
        }
      }

      // 🔥 แสดง overlay ก่อน redirect ตาม Role
      if (profile.role === "admin") {
        showLoginOverlay("/pages/dashboard/adminDashboard.html");
      } else if (profile.role === "adminQc") {
        showLoginOverlay("/pages/dashboard/QcDashboard.html");
      } else if (profile.role === "sales") {
        showLoginOverlay("/index.html");
      } else if (profile.role === "manager") {
        showLoginOverlay("/index.html");
      } else if (profile.role === "executive") {
        showLoginOverlay("/pages/executive/executiveHome.html");
      } else {
        // role = "user" (default หลังสมัคร แต่ status ต้อง Active ก่อน)
        // ถ้าเข้ามาถึงจุดนี้แปลว่า admin เปิด Active แต่ยังไม่ได้ตั้ง role
        await supabaseClient.auth.signOut();
        throw new Error(
          "บัญชีของคุณยังไม่ได้กำหนดสิทธิ์การใช้งาน\n" +
          "กรุณาแจ้งหัวหน้าของคุณ"
        );
      }

    } catch (err) {
      let errorMessage = err.message;

      if (err.message.includes("Invalid login credentials")) {
        errorMessage = "Username/Email หรือรหัสผ่านไม่ถูกต้อง";
      }

      alert("เข้าสู่ระบบไม่สำเร็จ\n\n" + errorMessage);

      loginBtn.disabled = false;
      loginBtn.classList.remove("loading");
    }
    // ❌ ไม่มี finally — ถ้า login สำเร็จ ให้ overlay ค้างอยู่จนกว่าจะ redirect
  });
});