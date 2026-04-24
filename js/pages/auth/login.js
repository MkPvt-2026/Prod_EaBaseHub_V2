// ===============================
// login.js
//
// ✨ การแก้ไข:
//   - ถ้า user Inactive พยายาม login
//     → เก็บข้อมูลลง sessionStorage + redirect ไป pending-approval
// ===============================


// ===============================
// Helper: แสดง overlay ก่อน redirect
// ===============================
function showLoginOverlay(redirectUrl) {
  const overlay = document.getElementById("loadingSplash");
  if (overlay) {
    overlay.classList.add("show");
  }
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

    // Redirect ตาม Role
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

  const loginForm     = document.getElementById("loginForm");
  const emailInput    = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const loginBtn      = document.getElementById("loginBtn");

  if (!loginForm) return;


  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const identifier = emailInput.value.trim();
    const password   = passwordInput.value.trim();

    if (!identifier || !password) {
      alert("กรุณากรอก Username/Email และรหัสผ่าน");
      return;
    }

    loginBtn.disabled = true;
    loginBtn.classList.add("loading");

    try {
      let emailToUse = identifier;

      // ถ้าไม่มี @ → ถือว่าเป็น username
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

      // ── Login กับ Supabase Auth ──
      const { data: authData, error: loginError } =
        await supabaseClient.auth.signInWithPassword({
          email: emailToUse,
          password: password,
        });

      if (loginError) throw loginError;

      // ── เช็ค role + status จาก profiles ──
      const { data: profile, error: roleError } = await supabaseClient
        .from("profiles")
        .select("role, status, username, display_name, email")
        .eq("id", authData.user.id)
        .single();

      if (roleError || !profile) {
        throw new Error("ไม่สามารถตรวจสอบสิทธิ์ได้");
      }

      // ══════════════════════════════════════════════
      // ✨ ถ้า Inactive → redirect ไปหน้า pending-approval
      // ══════════════════════════════════════════════
      if (profile.status !== "Active") {

        await supabaseClient.auth.signOut();

        if (profile.status === "Inactive") {
          // ── เก็บข้อมูลลง sessionStorage ──
          try {
            sessionStorage.setItem("pending_user_info", JSON.stringify({
              email:        profile.email || emailToUse,
              username:     profile.username,
              display_name: profile.display_name,
              password:     password,  // เก็บชั่วคราวสำหรับ auto-login
            }));
          } catch (e) {
            console.warn("Cannot use sessionStorage:", e);
          }

          // ── redirect ไปหน้ารออนุมัติ ──
          window.location.href = "/pages/auth/pending-approval.html";
          return;

        } else {
          throw new Error("บัญชีของคุณถูกระงับการใช้งาน");
        }
      }

      // ══════════════════════════════════════════════
      // ✨ ถ้า Active แต่ role = "user" (admin ยังไม่กำหนด role)
      //     → ไปหน้า pending-approval เช่นกัน
      // ══════════════════════════════════════════════
      if (profile.role === "user") {

        await supabaseClient.auth.signOut();

        try {
          sessionStorage.setItem("pending_user_info", JSON.stringify({
            email:        profile.email || emailToUse,
            username:     profile.username,
            display_name: profile.display_name,
            password:     password,
          }));
        } catch (e) {
          console.warn("Cannot use sessionStorage:", e);
        }

        window.location.href = "/pages/auth/pending-approval.html";
        return;
      }

      // ══════════════════════════════════════════════
      // Active + มี role → redirect ตาม role
      // ══════════════════════════════════════════════
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
        await supabaseClient.auth.signOut();
        throw new Error("คุณไม่มีสิทธิ์เข้าใช้งานระบบนี้");
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
  });
});