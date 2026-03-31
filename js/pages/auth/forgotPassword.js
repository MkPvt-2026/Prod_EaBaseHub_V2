// ===============================
// forgot-password.js
// ===============================

// ---- Detect if this is a password-reset redirect ----
(async () => {
  // Supabase ส่ง #access_token หรือ ?type=recovery มาใน URL
  const hash = window.location.hash;
  const params = new URLSearchParams(window.location.search);

  const isRecovery =
    hash.includes("type=recovery") ||
    params.get("type") === "recovery";

  if (isRecovery) {
    switchView("view-reset");
  }
})();

// ---- Switch view helper ----
function switchView(viewId) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  const target = document.getElementById(viewId);
  if (target) target.classList.add("active");
}

// ---- STEP 1: Send reset email ----
async function handleSendReset() {
  const email = document.getElementById("forgot-email").value.trim();

  if (!email) {
    showError("กรุณากรอกอีเมลของคุณ");
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showError("รูปแบบอีเมลไม่ถูกต้อง");
    return;
  }

  const btn = document.getElementById("sendBtn");
  btn.disabled = true;
  btn.classList.add("loading");

  try {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/pages/auth/forgot-password.html`,
    });

    if (error) throw error;

    // Show sent view
    document.getElementById("sent-email-display").textContent = email;
    switchView("view-sent");

    // Start resend cooldown
    startResendCooldown();

  } catch (err) {
    showError("ไม่สามารถส่งอีเมลได้: " + err.message);
    btn.disabled = false;
    btn.classList.remove("loading");
  }
}

// ---- Resend with cooldown ----
let cooldownTimer = null;

function startResendCooldown(seconds = 60) {
  const resendBtn = document.getElementById("resendBtn");
  const countdown = document.getElementById("resend-countdown");
  let remaining = seconds;

  resendBtn.disabled = true;
  resendBtn.style.display = "none";
  countdown.style.display = "inline";
  countdown.textContent = `(ส่งใหม่ได้ใน ${remaining}s)`;

  cooldownTimer = setInterval(() => {
    remaining--;
    countdown.textContent = `(ส่งใหม่ได้ใน ${remaining}s)`;
    if (remaining <= 0) {
      clearInterval(cooldownTimer);
      resendBtn.disabled = false;
      resendBtn.style.display = "inline";
      countdown.style.display = "none";
    }
  }, 1000);
}

async function handleResend() {
  const email = document.getElementById("sent-email-display").textContent;
  if (!email) return;

  const btn = document.getElementById("resendBtn");
  btn.disabled = true;

  try {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/pages/auth/forgot-password.html`,
    });
    if (error) throw error;
    startResendCooldown();
  } catch (err) {
    showError("ส่งอีเมลซ้ำไม่สำเร็จ: " + err.message);
    btn.disabled = false;
  }
}

// ---- STEP 3: Reset password form ----
async function handleResetPassword() {
  const newPass     = document.getElementById("new-password").value;
  const confirmPass = document.getElementById("confirm-password").value;

  if (!newPass || newPass.length < 8) {
    showError("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร");
    return;
  }

  if (newPass !== confirmPass) {
    showError("รหัสผ่านไม่ตรงกัน");
    return;
  }

  const btn = document.getElementById("resetBtn");
  btn.disabled = true;
  btn.classList.add("loading");

  try {
    const { error } = await supabaseClient.auth.updateUser({ password: newPass });
    if (error) throw error;

    switchView("view-success");

  } catch (err) {
    showError("เปลี่ยนรหัสผ่านไม่สำเร็จ: " + err.message);
    btn.disabled = false;
    btn.classList.remove("loading");
  }
}

// ---- Toast error ----
function showError(msg) {
  document.querySelectorAll(".toast-error").forEach(e => e.remove());
  const toast = document.createElement("div");
  toast.className = "toast-error";
  toast.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${msg}`;
  document.querySelector(".forgot-card").prepend(toast);
  setTimeout(() => toast.remove(), 3500);
}