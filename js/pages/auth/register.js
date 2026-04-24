// ============================================================
// register.js
// หน้าสมัครสมาชิก
//
// ✨ การแก้ไข:
//   - หลังสมัครเสร็จ → เก็บข้อมูล + password ใน sessionStorage
//   - Redirect ไปหน้า /pages/auth/pending-approval.html
// ============================================================


// ============================================================
// handleRegister()
// ============================================================
async function handleRegister() {

  const email    = document.getElementById("reg-email").value.trim().toLowerCase();
  const username = document.getElementById("reg-username").value.trim();
  const password = document.getElementById("reg-password").value;
  const fullname = document.getElementById("reg-fullname").value.trim();

  if (!fullname) {
    showError("กรุณากรอกชื่อ-นามสกุล");
    return;
  }

  const btn = document.getElementById("registerBtn");
  btn.disabled = true;
  btn.classList.add("loading");

  try {

    // ══════════════════════════════════════════════
    // STEP 1: เช็ค username ซ้ำ
    // ══════════════════════════════════════════════
    const { data: existingUsername } = await supabaseClient
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();

    if (existingUsername) {
      throw new Error("Username นี้ถูกใช้งานแล้ว กรุณาเลือก Username อื่น");
    }

    // ══════════════════════════════════════════════
    // STEP 2: เช็คอีเมลซ้ำใน profiles
    // ══════════════════════════════════════════════
    const { data: existingEmail } = await supabaseClient
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existingEmail) {
      throw new Error(
        "อีเมลนี้มีบัญชีอยู่แล้วในระบบ\n" +
        "กรุณาเข้าสู่ระบบ หรือกด 'ลืมรหัสผ่าน' หากจำรหัสผ่านไม่ได้"
      );
    }

    // ══════════════════════════════════════════════
    // STEP 3: Sign up
    // ══════════════════════════════════════════════
    const { data: authData, error: signUpError } =
      await supabaseClient.auth.signUp({
        email,
        password,
        options: {
          data: {
            username: username,
            display_name: fullname,
          },
        },
      });

    if (signUpError) {
      if (
        signUpError.message.includes("already registered") ||
        signUpError.message.includes("already been registered") ||
        signUpError.message.includes("User already registered")
      ) {
        throw new Error(
          "อีเมลนี้มีบัญชีอยู่แล้วในระบบ\n" +
          "กรุณาเข้าสู่ระบบ หรือกด 'ลืมรหัสผ่าน'"
        );
      }
      throw signUpError;
    }

    const user   = authData?.user;
    const userId = user?.id;

    if (!userId) {
      throw new Error("ไม่สามารถสร้างบัญชีได้ กรุณาลองอีกครั้ง");
    }

    // ── ตรวจ email ซ้ำแบบเงียบ (เมื่อมี session) ──
    const hasSession       = authData?.session != null;
    const identitiesLength = user?.identities?.length ?? 0;

    if (hasSession && identitiesLength === 0) {
      await supabaseClient.auth.signOut();
      throw new Error(
        "อีเมลนี้มีบัญชีอยู่แล้วในระบบ\n" +
        "กรุณาเข้าสู่ระบบ หรือกด 'ลืมรหัสผ่าน'"
      );
    }

    // ══════════════════════════════════════════════
    // STEP 4: Insert profile
    // ══════════════════════════════════════════════
    const { error: profileError } = await supabaseClient
      .from("profiles")
      .upsert({
        id:           userId,
        email:        email,
        username:     username,
        display_name: fullname,
        role:         "user",
        status:       "Inactive",
      });

    if (profileError) {
      console.error("Profile error:", profileError);
      await supabaseClient.auth.signOut().catch(() => {});

      let friendlyMsg = profileError.message;
      if (profileError.code === "23505") {
        friendlyMsg = "Username หรืออีเมลนี้ถูกใช้แล้ว";
      } else if (profileError.code === "42501") {
        friendlyMsg = "ไม่มีสิทธิ์บันทึกข้อมูล (ตรวจสอบ RLS policy)";
      }
      throw new Error("บันทึกข้อมูลไม่สำเร็จ: " + friendlyMsg);
    }

    // ══════════════════════════════════════════════
    // STEP 5: Sign out (ยังไม่ให้ login จนกว่า admin อนุมัติ)
    // ══════════════════════════════════════════════
    await supabaseClient.auth.signOut().catch(() => {});

    // ══════════════════════════════════════════════
    // ✨ STEP 6: เก็บข้อมูล user + password ลง sessionStorage
    // เพื่อให้หน้า pending-approval ตรวจสอบสถานะและ auto-login ได้
    //
    // ⚠️ หมายเหตุ: เก็บ password ใน sessionStorage
    //    - sessionStorage จะถูกลบเมื่อปิดแท็บ
    //    - ใช้เฉพาะระหว่างหน้า register → pending-approval
    //    - จะถูกลบทันทีหลัง auto-login หรือกลับหน้า login
    // ══════════════════════════════════════════════
    try {
      sessionStorage.setItem("pending_user_info", JSON.stringify({
        email:        email,
        username:     username,
        display_name: fullname,
        password:     password,  // เก็บชั่วคราวสำหรับ auto-login
      }));
    } catch (e) {
      console.warn("Cannot use sessionStorage:", e);
    }

    // ══════════════════════════════════════════════
    // STEP 7: Redirect ไปหน้า pending-approval
    // ══════════════════════════════════════════════
    window.location.href = "/pages/auth/pending-approval.html";

  } catch (err) {
    console.error("Register error:", err);

    let msg = err.message || "เกิดข้อผิดพลาด";

    if (
      msg.includes("already registered") ||
      msg.includes("User already registered") ||
      msg.includes("email address is already")
    ) {
      msg = "อีเมลนี้มีบัญชีอยู่แล้วในระบบ\n" +
            "กรุณาเข้าสู่ระบบ หรือกด 'ลืมรหัสผ่าน'";
    } else if (msg.includes("Password should be")) {
      msg = "รหัสผ่านไม่ปลอดภัยเพียงพอ (ต้องมีอย่างน้อย 8 ตัว)";
    } else if (msg.includes("Invalid email")) {
      msg = "รูปแบบอีเมลไม่ถูกต้อง";
    } else if (msg.includes("rate limit")) {
      msg = "คุณสมัครบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่";
    }

    showError(msg);

    btn.disabled = false;
    btn.classList.remove("loading");
  }
}


// ============================================================
// showError()
// ============================================================
function showError(msg) {

  document.querySelectorAll(".toast-error").forEach(e => e.remove());

  const toast = document.createElement("div");
  toast.className = "toast-error";

  const lines = msg.split("\n").map(l => `<div>${l}</div>`).join("");
  toast.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i><div>${lines}</div>`;

  document.querySelector(".register-card").prepend(toast);

  setTimeout(() => toast.remove(), 5000);
}