// ============================================================
// forgot-password.js
// ส่งลิงก์ reset password ไปที่อีเมลของ user
//
// Flow:
//  1. User กรอกอีเมล
//  2. ระบบเรียก resetPasswordForEmail()
//  3. Supabase ส่งอีเมลพร้อมลิงก์ไปให้
//  4. User คลิกลิงก์ → ไปหน้า reset-password.html
// ============================================================


document.addEventListener("DOMContentLoaded", () => {

  const forgotForm = document.getElementById("forgotForm");
  const emailInput = document.getElementById("email");
  const forgotBtn  = document.getElementById("forgotBtn");

  if (!forgotForm) return;


  forgotForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim().toLowerCase();

    if (!email) {
      alert("กรุณากรอกอีเมล");
      return;
    }

    // disable ปุ่ม
    forgotBtn.disabled = true;
    forgotBtn.classList.add("loading");

    try {

      // ══════════════════════════════════════════════
      // ตรวจสอบก่อนว่ามีอีเมลนี้ในระบบหรือไม่
      // (เพื่อแสดง error message ชัดเจน)
      // ══════════════════════════════════════════════
      const { data: profile } = await supabaseClient
        .from("profiles")
        .select("id, status")
        .eq("email", email)
        .maybeSingle();

      if (!profile) {
        throw new Error("ไม่พบอีเมลนี้ในระบบ");
      }

      if (profile.status === "Inactive") {
        throw new Error(
          "บัญชีของคุณยังไม่ได้รับการอนุมัติ\n" +
          "กรุณาแจ้งหัวหน้าของคุณเพื่อขออนุมัติก่อน"
        );
      }

      // ══════════════════════════════════════════════
      // ส่งลิงก์ reset password
      // redirectTo = หน้าที่ user จะไปหลังคลิกลิงก์
      // ══════════════════════════════════════════════
      const { error } = await supabaseClient.auth.resetPasswordForEmail(
        email,
        {
          redirectTo: `${window.location.origin}/pages/auth/reset-password.html`,
        }
      );

      if (error) throw error;

      // ══════════════════════════════════════════════
      // แสดง overlay สำเร็จ
      // ══════════════════════════════════════════════
      const overlay = document.getElementById("forgot-overlay");
      if (overlay) overlay.classList.add("show");

      // redirect กลับหน้า login หลัง 5 วินาที
      setTimeout(() => {
        window.location.href = "/pages/auth/login.html";
      }, 5000);

    } catch (err) {
      console.error("Forgot password error:", err);

      let msg = err.message || "เกิดข้อผิดพลาด";

      if (msg.includes("rate limit") || msg.includes("too many")) {
        msg = "คุณขอลิงก์บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่";
      }

      alert("ส่งลิงก์ไม่สำเร็จ\n\n" + msg);

      forgotBtn.disabled = false;
      forgotBtn.classList.remove("loading");
    }
  });

});