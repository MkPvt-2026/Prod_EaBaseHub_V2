// ============================================================
// reset-password.js
// หน้าสำหรับตั้งรหัสผ่านใหม่ หลังจาก user คลิกลิงก์จากอีเมล
//
// Flow:
//  1. User มาจากอีเมล → URL มี token แนบมา
//  2. Supabase auto-detect session จาก URL hash
//  3. User กรอกรหัสใหม่ → updateUser({ password })
//  4. Sign out → redirect กลับ login
// ============================================================


// ══════════════════════════════════════════════════════════
// INIT: ตรวจสอบ session ที่มาจากลิงก์ reset password
// ══════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", async () => {

  const loadingState = document.getElementById("loading-state");
  const errorState   = document.getElementById("error-state");
  const errorMessage = document.getElementById("error-message");
  const resetForm    = document.getElementById("resetForm");
  const userEmail    = document.getElementById("userEmail");

  try {

    // ══════════════════════════════════════════════
    // รอให้ Supabase ประมวลผล token จาก URL hash
    // (Supabase อ่าน token จาก URL อัตโนมัติ
    //  แล้วสร้าง session ชั่วคราวให้)
    // ══════════════════════════════════════════════
    await new Promise(resolve => setTimeout(resolve, 500));

    const { data: { session }, error } =
      await supabaseClient.auth.getSession();

    if (error) throw error;

    if (!session) {
      throw new Error(
        "ลิงก์นี้ไม่ถูกต้องหรือหมดอายุแล้ว (ลิงก์ใช้ได้ 1 ชั่วโมง)\n" +
        "กรุณาขอลิงก์ใหม่อีกครั้ง"
      );
    }

    // ── แสดงอีเมลของ user + form ───────────────
    userEmail.textContent = session.user.email;

    loadingState.style.display = "none";
    resetForm.style.display    = "block";

  } catch (err) {
    console.error("Session check error:", err);

    loadingState.style.display = "none";
    errorState.style.display   = "block";
    errorMessage.textContent   = err.message || "ไม่สามารถตรวจสอบลิงก์ได้";
  }


  // ══════════════════════════════════════════════════════════
  // SUBMIT FORM: บันทึกรหัสผ่านใหม่
  // ══════════════════════════════════════════════════════════
  resetForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const newPassword    = document.getElementById("newPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;
    const resetBtn       = document.getElementById("resetBtn");

    // ── validation ──────────────────────────────
    if (newPassword.length < 8) {
      alert("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร");
      return;
    }

    if (newPassword !== confirmPassword) {
      alert("รหัสผ่านไม่ตรงกัน");
      return;
    }

    // ── disable ปุ่ม ────────────────────────────
    resetBtn.disabled = true;
    resetBtn.classList.add("loading");

    try {

      // ══════════════════════════════════════════════
      // อัปเดตรหัสผ่าน
      // ══════════════════════════════════════════════
      const { error } = await supabaseClient.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      // ══════════════════════════════════════════════
      // Sign out เพื่อให้ user login ใหม่ด้วยรหัสใหม่
      // ══════════════════════════════════════════════
      await supabaseClient.auth.signOut();

      // ── แสดง overlay สำเร็จ ──────────────────
      const overlay = document.getElementById("reset-overlay");
      if (overlay) overlay.classList.add("show");

      // ── redirect ────────────────────────────
      setTimeout(() => {
        window.location.href = "/pages/auth/login.html";
      }, 2500);

    } catch (err) {
      console.error("Reset password error:", err);

      let msg = err.message || "เกิดข้อผิดพลาด";

      if (msg.includes("Password should be")) {
        msg = "รหัสผ่านไม่ปลอดภัยเพียงพอ";
      } else if (msg.includes("same as the old")) {
        msg = "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม";
      }

      alert("บันทึกรหัสผ่านไม่สำเร็จ\n\n" + msg);

      resetBtn.disabled = false;
      resetBtn.classList.remove("loading");
    }
  });

});