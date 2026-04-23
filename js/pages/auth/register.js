// ============================================================
// register.js
// หน้าสมัครสมาชิก (user สมัครเอง)
//
// การแก้ไขหลักจากเวอร์ชันเดิม:
//  1. ตรวจสอบอีเมลซ้ำให้ถูกต้อง (Supabase v2+ ไม่ return error)
//     → เช็คจาก user.identities.length === 0
//     → เช็ค profiles table ก่อน signUp ด้วย (เร็วกว่า)
//  2. ตรวจสอบ username ซ้ำก่อน signUp
//  3. default role = "user", status = "Inactive"
//     → admin ต้องเข้ามาเปิดใช้งาน + เปลี่ยน role ทีหลัง
// ============================================================


// ============================================================
// handleRegister()
// ฟังก์ชันหลัก - สมัครสมาชิก
// ============================================================
async function handleRegister() {

  // ── เก็บค่าจาก form ──────────────────────────────
  const email    = document.getElementById("reg-email").value.trim().toLowerCase();
  const username = document.getElementById("reg-username").value.trim();
  const password = document.getElementById("reg-password").value;
  const fullname = document.getElementById("reg-fullname").value.trim();

  if (!fullname) {
    showError("กรุณากรอกชื่อ-นามสกุล");
    return;
  }

  // ── disable ปุ่ม ────────────────────────────────
  const btn = document.getElementById("registerBtn");
  btn.disabled = true;
  btn.classList.add("loading");

  try {

    // ══════════════════════════════════════════════
    // STEP 1: ตรวจสอบ username ซ้ำในตาราง profiles
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
    // STEP 2: ตรวจสอบอีเมลซ้ำในตาราง profiles ก่อน
    // (เร็วกว่า + ชัดเจนกว่าการรอผลจาก signUp)
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
    // STEP 3: Sign up กับ Supabase Auth
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

    if (signUpError) throw signUpError;

    // ══════════════════════════════════════════════
    // STEP 4: ตรวจสอบ email ซ้ำแบบ "เงียบ"
    //
    // 🔑 สำคัญมาก: Supabase v2+ ไม่ return error ถ้า email ซ้ำ
    //    แต่จะ return user.identities = [] (array ว่าง)
    //    เพื่อป้องกัน email enumeration attack
    //
    // ถ้า identities ว่าง = อีเมลนี้ถูกใช้สมัครไปแล้ว
    // ══════════════════════════════════════════════
    const user = authData?.user;
    const identitiesLength = user?.identities?.length ?? 0;

    if (user && identitiesLength === 0) {
      throw new Error(
        "อีเมลนี้มีบัญชีอยู่แล้วในระบบ\n" +
        "กรุณาเข้าสู่ระบบ หรือกด 'ลืมรหัสผ่าน' หากจำรหัสผ่านไม่ได้"
      );
    }

    // ══════════════════════════════════════════════
    // STEP 5: ถ้า Supabase เปิด email confirmation
    // authData.user จะมี id แต่ session จะเป็น null
    // ══════════════════════════════════════════════
    const userId = user?.id;

    if (!userId) {
      throw new Error("ไม่สามารถสร้างบัญชีได้ กรุณาลองอีกครั้ง");
    }

    // ══════════════════════════════════════════════
    // STEP 6: Insert profile
    // - role: "user" (default, ไม่มีสิทธิ์อะไร)
    // - status: "Inactive" (รอ admin อนุมัติ)
    // ══════════════════════════════════════════════
    const { error: profileError } = await supabaseClient
      .from("profiles")
      .upsert({
        id:           userId,
        email:        email,
        username:     username,
        display_name: fullname,
        role:         "user",      // ⚠️ default role = user
        status:       "Inactive",  // ⚠️ รอ admin เปลี่ยนเป็น Active
      });

    if (profileError) {
      console.error("Profile error:", profileError);
      throw new Error("บันทึกข้อมูลไม่สำเร็จ: " + profileError.message);
    }

    // ══════════════════════════════════════════════
    // STEP 7: Sign out ทันที
    // (เผื่อ Supabase auto-login — เราไม่ต้องการ
    //  เพราะ user ยังไม่ถูกอนุมัติ)
    // ══════════════════════════════════════════════
    await supabaseClient.auth.signOut();

    // ══════════════════════════════════════════════
    // STEP 8: แสดง overlay สำเร็จ + redirect
    // ══════════════════════════════════════════════
    showSuccessOverlay();

    setTimeout(() => {
      window.location.href = "/pages/auth/login.html";
    }, 3500);

  } catch (err) {
    console.error("Register error:", err);

    let msg = err.message || "เกิดข้อผิดพลาด";

    // แปล error message จาก Supabase เป็นไทย
    if (msg.includes("already registered") ||
        msg.includes("User already registered") ||
        msg.includes("email address is already")) {
      msg = "อีเมลนี้มีบัญชีอยู่แล้วในระบบ\n" +
            "กรุณาเข้าสู่ระบบ หรือกด 'ลืมรหัสผ่าน'";
    } else if (msg.includes("Password should be")) {
      msg = "รหัสผ่านไม่ปลอดภัยเพียงพอ";
    } else if (msg.includes("Invalid email")) {
      msg = "รูปแบบอีเมลไม่ถูกต้อง";
    }

    showError(msg);

    btn.disabled = false;
    btn.classList.remove("loading");
  }
}


// ============================================================
// showSuccessOverlay()
// แสดง overlay หลังสมัครสำเร็จ + ข้อความรออนุมัติ
// ============================================================
function showSuccessOverlay() {

  const overlay = document.getElementById("register-overlay");
  if (!overlay) return;

  // เปลี่ยนข้อความใน overlay ให้บอกว่ารออนุมัติ
  const title = overlay.querySelector("h3");
  const desc  = overlay.querySelector("p");

  if (title) title.textContent = "สมัครสมาชิกสำเร็จ!";
  if (desc)  desc.textContent  = "กรุณาแจ้งหัวหน้าของคุณเพื่อขออนุมัติการใช้งาน";

  overlay.classList.add("show");
}


// ============================================================
// showError()
// แสดง toast error
// ============================================================
function showError(msg) {

  // ลบ toast เก่า
  document.querySelectorAll(".toast-error").forEach(e => e.remove());

  const toast = document.createElement("div");
  toast.className = "toast-error";

  // รองรับ multi-line (split ด้วย \n)
  const lines = msg.split("\n").map(l => `<div>${l}</div>`).join("");
  toast.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i><div>${lines}</div>`;

  document.querySelector(".register-card").prepend(toast);

  setTimeout(() => toast.remove(), 5000);
}