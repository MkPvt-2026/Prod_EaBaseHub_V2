// =====================================================
// legacy-redirect.js — หน้าเก่า (หน้าตัวอย่างข้อมูลตายตัว) → พาไปหน้าจริงตาม role
// ใช้: <meta name="ea-redirect" content='{"sales":"/x.html","accounting":"/y.html","default":"/z.html"}'>
//   - ส่ง ?id= ต่อไปให้ด้วย (ถ้ามี)
//   - role ที่ไม่มีสิทธิ์เปิดหน้านี้ auth.js พากลับหน้าแรกของ role ให้เองอยู่แล้ว
// เก็บหน้าเก่าไว้เป็นทางผ่าน เพื่อไม่ให้ลิงก์ / bookmark เดิมเสีย
// =====================================================
(async function () {
  "use strict";
  let map = {};
  try { map = JSON.parse(document.querySelector('meta[name="ea-redirect"]')?.content || "{}"); } catch (e) { map = {}; }
  const go = (url) => {
    if (!url) return;
    const u = new URL(url, location.origin);
    const id = new URLSearchParams(location.search).get("id");
    if (id && !u.searchParams.has("id")) u.searchParams.set("id", id);
    location.replace(u.pathname + u.search);
  };
  let role = null;
  for (let i = 0; i < 80 && !role; i++) {
    if (window.EA_ROLE) { role = window.EA_ROLE; break; }
    if (typeof eaGetMyProfile === "function" && typeof supabaseClient !== "undefined") {
      try { role = (await eaGetMyProfile()).profile?.role || null; } catch (e) { /* ignore */ }
      if (role) break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (role && typeof normalizeRole === "function") role = normalizeRole(role);
  go(map[role] || map.default || (typeof getDefaultPage === "function" && role ? getDefaultPage(role) : "/index.html"));
})();
