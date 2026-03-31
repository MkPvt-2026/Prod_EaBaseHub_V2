document.addEventListener("DOMContentLoaded", async () => {

  await protectPage(["admin","sales","manager","user"]);

  await loadUserHeader();

  setupLogout();

});

// =====================================================
// 👤 LOAD USER HEADER
// =====================================================
async function loadUserHeader() {

  try {

    // ดึง session
    const { data, error } = await supabaseClient.auth.getSession();

    if (error) {
      console.error("Session error:", error);
      return;
    }

    const session = data.session;

    if (!session) {
      console.warn("No session found");
      return;
    }

    const userId = session.user.id;

    // ดึง profile
    const { data: profile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("display_name, role")
      .eq("id", userId)
      .single();

    if (profileError) {
      console.error("Profile error:", profileError);
    }

    const name = profile?.display_name || session.user.email;
    const role = profile?.role || "user";

    // ===== แสดงบนหน้าเว็บ =====
    const userName = document.getElementById("userName");
    const userRole = document.getElementById("userRole");
    const userAvatar = document.getElementById("userAvatar");

    if (userName) userName.textContent = name;
    if (userRole) userRole.textContent = role;

    // Avatar ตัวอักษรแรก
    if (userAvatar) {
      userAvatar.textContent = name.charAt(0).toUpperCase();
    }

  } catch (err) {
    console.error("loadUserHeader error:", err);
  }

}


// =====================================================
// 🚪 LOGOUT
// =====================================================
function setupLogout() {

  const logoutBtn = document.getElementById("logoutBtn");

  if (!logoutBtn) return;

  logoutBtn.addEventListener("click", async () => {

    await supabaseClient.auth.signOut();

    window.location.href = "/pages/auth/login.html";

  });

}