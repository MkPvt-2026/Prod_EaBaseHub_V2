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
  console.warn('⚠️ ROLE_CONFIG ไม่พร้อมใช้งาน — ใช้ fallback defaultPage');
}

function getSafeDefaultPage(role) {
  if (typeof getDefaultPage === 'function') {
    return getDefaultPage(role);
  }
  if (typeof ROLE_CONFIG !== 'undefined' && ROLE_CONFIG[role]?.defaultPage) {
    return ROLE_CONFIG[role].defaultPage;
  }
  return '/pages/auth/login.html';
}

// ======================================================
// LOGIN SECTION
// ======================================================

const loginForm = document.getElementById("loginForm");

// หน้า login.html มี login.js จัดการเองแล้ว (และไม่มี #message)
// ทำงานเฉพาะหน้าที่มี #message เพื่อไม่ให้ submit ซ้อนกัน 2 ตัว
if (loginForm && document.getElementById("message")) {
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

      const destination = getSafeDefaultPage(profile?.role);

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

// หน้า register.html มี register.js จัดการเองแล้ว
if (registerForm && document.getElementById("regMessage")) {
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
    const shared = typeof eaGetMyProfile === "function" ? await eaGetMyProfile() : null;
    const { data: { session }, error: sessionError } = shared ? { data: { session: shared.session }, error: null } : await supabaseClient.auth.getSession();

    if (sessionError || !session) {
      console.warn("⚠️ No active session");
      window.location.href = "/pages/auth/login.html";
      return;
    }

    console.log("✅ Session found:", session.user.email);

    // 2️⃣ ดึง role และ status จาก DB ตรงๆ ทุกครั้ง
    const { data: profile, error: profileError } = shared
      ? { data: shared.profile, error: shared.error }
      : await supabaseClient.from("profiles").select("role, status").eq("id", session.user.id).single();

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
    // ใช้รายการสิทธิ์กลาง (roleConfig.js · PAGE_ACCESS) เป็นหลัก — รายการ role ที่หน้าส่งมาใช้เมื่อไม่มีรายการกลาง
    if (typeof canAccessPage === "function" || allowedRoles.length > 0) {
      const hasRole = typeof canAccessPage === "function"
        ? canAccessPage(profile.role, window.location.pathname)
        : allowedRoles.includes(profile.role);

      if (!hasRole) {
        console.warn("⚠️ Role not allowed:", profile.role, "— allowed:", allowedRoles);

        // ✅ redirect ไปหน้า default ของ role ตัวเอง (ไม่ kick ไป login)
        const destination = getSafeDefaultPage(profile.role);
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

// ======================================================
// 🛡️ ACCESS GUARD — ตรวจสิทธิ์ทุกหน้าอัตโนมัติ (จากรายการเดียวใน roleConfig.js)
//   ชั้นที่ 1: ซ่อนเมนู/การ์ด/ลิงก์ที่ role ไม่มีสิทธิ์ (รวมเมนูที่โหลดทีหลัง)
//   ชั้นที่ 2: เปิดหน้าตรงจาก URL โดยไม่มีสิทธิ์ → พากลับหน้าแรกของ role
//   ระหว่างตรวจจะซ่อนเนื้อหาหน้าไว้ ไม่ให้เห็นแวบ
// ======================================================
(function eaAccessGuard() {
  if (window.__eaGuard) return;
  window.__eaGuard = true;
  if (typeof canAccessPage !== "function" || typeof isPublicPage !== "function") {
    console.warn("⚠️ ไม่พบ roleConfig.js v2 — ข้ามการตรวจสิทธิ์กลาง");
    return;
  }
  const path = window.location.pathname;
  if (isPublicPage(path)) return;

  const st = document.createElement("style");
  st.id = "eaGuardStyle";
  st.textContent = "html.ea-guarding{background:#f1f5f9!important}html.ea-guarding[data-dark]{background:#0f1923!important}html.ea-guarding body{visibility:hidden!important;opacity:0!important}"; // opacity: กันเมนูที่ CSS บังคับ visibility:visible โผล่ก่อน
  (document.head || document.documentElement).appendChild(st);
  document.documentElement.classList.add("ea-guarding");
  const reveal = () => document.documentElement.classList.remove("ea-guarding");
  const go = (url) => { if (normalizePath(url) !== normalizePath(path)) window.location.replace(url); else reveal(); };

  const MENU_SCOPE = "nav, aside, header, .app-nav, .sidebar, .sidebar-nav, .app-sidebar, .ea-sidebar, .menu, .menu-grid, .forms-grid, .mk-cards, .mk-groups, .mk-recent, .ad-tiles, .at-tabs, .quick-actions, .action-cards, .home-actions, .page-tabs, .tab-bar, .flow-steps, [data-menu]";
  const ITEM = "li, .form-card, .mk-card, .mk-tile, .ad-tile, .menu-card, .menu-item, .nav-item, .sidebar-nav-item, .quick-btn, .action-card, .tab-item, .tab-btn, .flow-step";

  function targetPath(el) {
    let href = el.getAttribute("href");
    if (!href) {
      const m = (el.getAttribute("onclick") || "").match(/location\.href\s*=\s*['"]([^'"]+)['"]/);
      if (!m) return null;
      href = m[1];
    }
    if (/^(#|javascript:|mailto:|tel:)/i.test(href)) return null;
    try {
      const u = new URL(href, window.location.href);
      if (u.origin !== window.location.origin) return null;
      return u.pathname;
    } catch (e) { return null; }
  }
  function filterMenus(role, root) {
    const scope = root && root.querySelectorAll ? root : document;
    const els = [];
    if (scope.matches && scope.matches("a[href], [onclick*='location.href']")) els.push(scope);
    scope.querySelectorAll("a[href], [onclick*='location.href']").forEach((el) => els.push(el));
    els.forEach((el) => {
      const tp = targetPath(el);
      if (!tp || canAccessPage(role, tp)) return;
      // โลโก้ที่ลิงก์ไปหน้าที่ role ไม่มีสิทธิ์ → พาไปหน้าแรกของ role ตัวเองแทน (ไม่ซ่อนโลโก้)
      if (el.matches(".sidebar-logo, .logo a, a.logo, a.brand")) { el.setAttribute("href", getDefaultPage(role)); el.title = "หน้าแรก"; return; }
      const inMenu = el.closest(MENU_SCOPE) || el.matches(ITEM) || el.closest(ITEM);
      if (!inMenu || el.closest("p")) return; // ลิงก์ในข้อความปกติไม่ซ่อน
      const item = el.matches(ITEM) ? el : (el.closest(ITEM) || el);
      item.setAttribute("data-ea-hidden", "");
      item.hidden = true;
      item.style.setProperty("display", "none", "important");
    });
  }

  async function run() {
    try {
      for (let i = 0; i < 50 && typeof supabaseClient === "undefined"; i++) await new Promise((r) => setTimeout(r, 100));
      if (typeof supabaseClient === "undefined") throw new Error("ระบบยังไม่พร้อม");
      // ดึงโปรไฟล์ครั้งเดียว ใช้ร่วมกับ userService / sidebar / ธีม (supabaseClient.js · eaGetMyProfile)
      const { session, profile, error } = typeof eaGetMyProfile === "function"
        ? await eaGetMyProfile()
        : await (async () => { const { data: { session } } = await supabaseClient.auth.getSession(); if (!session) return { session }; const r = await supabaseClient.from("profiles").select("role, status").eq("id", session.user.id).single(); return { session, profile: r.data, error: r.error }; })();
      if (!session) { go("/pages/auth/login.html"); return; }
      if (error && error.code === "PGRST116") { go("/pages/auth/login.html"); return; } // ไม่มีโปรไฟล์
      if (error) throw error;
      if (!profile) { go("/pages/auth/login.html"); return; }
      if (String(profile.status || "").toLowerCase() !== "active") {
        try { await supabaseClient.auth.signOut(); } catch (e) { /* ignore */ }
        go("/pages/auth/login.html"); return;
      }
      const role = normalizeRole(profile.role);
      window.EA_ROLE = role;
      if (!canAccessPage(role, path)) {
        console.warn("🚫 ไม่มีสิทธิ์เข้าหน้านี้:", role, path);
        go(getDefaultPage(role));
        return;
      }
      filterMenus(role, document);
      new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) filterMenus(role, n); })))
        .observe(document.documentElement, { childList: true, subtree: true });
      reveal();
    } catch (e) {
      console.error("Access guard:", e);
      reveal();
      document.body.innerHTML = `<div style="font-family:Kanit,sans-serif;max-width:420px;margin:15vh auto;padding:24px;text-align:center;border:1px solid #e2e8f0;border-radius:16px;background:#fff;color:#334155">
        <h2 style="margin:0 0 8px;font-size:20px">ตรวจสอบสิทธิ์ไม่สำเร็จ</h2>
        <p style="margin:0 0 16px;font-size:14px;color:#64748b">ตรวจการเชื่อมต่ออินเทอร์เน็ต แล้วลองใหม่อีกครั้ง</p>
        <button onclick="location.reload()" style="font:inherit;padding:10px 20px;border:0;border-radius:10px;background:#2563eb;color:#fff;cursor:pointer">ลองใหม่</button></div>`;
    }
  }
  run();
})();
