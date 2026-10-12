/* ==========================================================
   adminDashboard.js v2.0 — Administration Console (หน้าหลัก Admin)
   ใช้บนโน้ตบุ๊กเป็นหลัก

   ข้อมูลจริงจาก Supabase
   - profiles          : id, username, display_name, role, status, area, created_at
   - shops             : id, sale_id, status        (ดึงครบทุกแถว แบ่งหน้า 1,000 แถว)
   - approval_requests : request_status, request_type (ถ้าไม่มีสิทธิ์อ่าน จะแสดง "—")

   v2.0 แก้จากเดิม
   - เดิมดึงร้านแค่ 1,000 แถวแรก (ค่าจำกัดของ Supabase) → ยอดร้านผิดเมื่อมีร้านเกิน 1,000
   - "ร้านค้าทั้งหมด" เดิมนับเฉพาะร้านที่มีเซลล์ → นับทุกร้าน + แยกร้านที่ไม่มีเซลล์ดูแล
   - Role marketing / accounting ไม่ถูกนับ, role "sale" ไม่ถูกนับเป็น Sales
   - ช่องค้นหาเมนูไม่ทำงาน (ไม่มี #menuSearch), ลิงก์ "ดูทั้งหมด" / เมนูข้าง 4 อันเป็น "#"
   - เมนูลัดซ้ำกัน 2 ชุด, ตาราง Sales แสดงซ้ำ 2 ที่, "กำหนดสิทธิ์ Role" ซ้ำกับ "จัดการผู้ใช้งาน"
   - ปุ่มออกจากระบบผูก 2 ครั้ง (ไปคนละหน้า), breadcrumb "หน้าหลัก" ไปหน้า Executive
   - ชื่อผู้ใช้บนหัวเว็บเดิมอ่านจาก user_metadata (ขึ้น "Executive"/อีเมล) → อ่านจาก profiles
   - โหลดข้อมูลก่อนตรวจสิทธิ์ Admin เสร็จ → ตอนนี้ตรวจสิทธิ์ก่อน
   - ชื่อ/พื้นที่ที่มีอักขระพิเศษ escape ก่อนแสดง
   ========================================================== */
"use strict";

/* ----------------------------------------------------------
   1) เมนู — เพิ่ม/แก้ที่นี่ที่เดียว (soon: true = ยังไม่เปิดใช้)
   ---------------------------------------------------------- */
const adminMenus = [
  {
    group: "ผู้ใช้งานและสิทธิ์", icon: "group",
    items: [
      { title: "จัดการผู้ใช้งาน", desc: "เพิ่ม / แก้ไข / ระงับบัญชี และกำหนด Role", icon: "manage_accounts", url: "/pages/admin/admintor.html" },
      { title: "จัดการทีม Sales", desc: "รหัสเซลล์ พื้นที่ และหัวหน้าทีม", icon: "badge", url: "/pages/admin/adminSales.html" },
      { title: "ข้อความแจ้งเตือน", desc: "ส่ง / จัดการข้อความถึงผู้ใช้", icon: "notifications", url: "/pages/admin/messages-New-Admin.html" },
    ],
  },
  {
    group: "ข้อมูลหลัก", icon: "database",
    items: [
      { title: "ร้านค้าและสิทธิ์ร้าน", desc: "ร้านค้า เขตพื้นที่ และเซลล์ผู้ดูแล", icon: "storefront", url: "/pages/admin/adminShops.html" },
      { title: "สินค้า", desc: "หมวดหมู่ / รายการสินค้า / Attribute", icon: "inventory_2", url: "/pages/admin/AddProductSpec.html" },
      { title: "รวมรหัสลูกค้า", desc: "รวมลูกค้าที่มีหลายรหัสให้เป็นรายเดียว", icon: "merge", url: "/pages/admin/merge-customers.html" },
    ],
  },
  {
    // รายงานเข้าร้าน / Marketing Home / นำเข้าข้อมูล เป็นงานของ Manager — ไม่อยู่ในเมนู Admin
    group: "สื่อสาร", icon: "campaign",
    items: [
      { title: "ประชาสัมพันธ์", desc: "ประกาศ / ข่าวสาร แสดงในหน้าแรกของเซลล์", icon: "campaign", url: "/pages/admin/Adminannouncements.html" },
    ],
  },
  {
    group: "เร็ว ๆ นี้", icon: "schedule", soonGroup: true,
    items: [
      { title: "ประวัติการเข้าใช้งาน", icon: "history", soon: true },
      { title: "พื้นที่ขาย / โซน", icon: "location_on", soon: true },
      { title: "ตั้งค่าการอนุมัติ", icon: "account_tree", soon: true },
      { title: "ตั้งค่าเอกสาร", icon: "description", soon: true },
      { title: "ตั้งค่าการแจ้งเตือน", icon: "notifications_active", soon: true },
      { title: "Audit Log", icon: "fact_check", soon: true },
      { title: "System Config", icon: "settings", soon: true },
    ],
  },
];

/* ----------------------------------------------------------
   2) ตัวช่วย
   ---------------------------------------------------------- */
function esc(t) { return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
const fmtN = (n) => (Number(n) || 0).toLocaleString("th-TH");
function fmtDate(iso) { if (!iso) return "-"; const d = new Date(iso); return isNaN(d) ? "-" : d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" }); }
function isActive(s) { return String(s || "").trim().toLowerCase() === "active"; }

// role ในฐานข้อมูลอาจสะกดต่างกัน (sale/sales, adminQc/adminqc)
const ROLE_META = {
  admin:     { label: "Admin", icon: "shield" },
  adminqc:   { label: "Admin QC", icon: "verified_user" },
  executive: { label: "Executive", icon: "workspace_premium" },
  manager:   { label: "Manager", icon: "supervisor_account" },
  marketing: { label: "Marketing", icon: "campaign" },
  accounting:{ label: "Accounting", icon: "account_balance" },
  sales:     { label: "Sales", icon: "badge" },
  user:      { label: "User", icon: "person" },
};
function roleKey(role) {
  const r = String(role || "").trim().toLowerCase().replace(/\s/g, "");
  if (r === "sale") return "sales";
  return r || "";
}
function roleLabel(role) { const k = roleKey(role); return ROLE_META[k]?.label || (k ? role : "ไม่มี Role"); }

/* ----------------------------------------------------------
   3) เมนู
   ---------------------------------------------------------- */
function renderAdminMenus(keyword = "") {
  const box = document.getElementById("adminMenuContainer");
  if (!box) return;
  const q = keyword.trim().toLowerCase();
  let shown = 0;
  const html = adminMenus.map((g) => {
    const items = g.items.filter((i) => !q || `${i.title} ${i.desc || ""} ${g.group}`.toLowerCase().includes(q));
    if (!items.length) return "";
    shown += items.length;
    if (g.soonGroup) {
      return `<div class="ad-soon"><span class="ad-soon-label"><span class="material-symbols-outlined">${esc(g.icon)}</span>${esc(g.group)}</span>
        ${items.map((i) => `<span class="ad-soon-chip" title="ยังไม่เปิดใช้"><span class="material-symbols-outlined">${esc(i.icon)}</span>${esc(i.title)}</span>`).join("")}</div>`;
    }
    return `<div class="ad-menu-group">
      <h3><span class="material-symbols-outlined">${esc(g.icon)}</span>${esc(g.group)}</h3>
      <div class="ad-tiles">
        ${items.map((i) => `
          <a class="ad-tile" href="${esc(i.url)}">
            <span class="ad-tile-icon"><span class="material-symbols-outlined">${esc(i.icon)}</span></span>
            <span class="ad-tile-text"><b>${esc(i.title)}</b><small>${esc(i.desc || "")}</small></span>
          </a>`).join("")}
      </div></div>`;
  }).join("");
  box.innerHTML = shown ? html : `<div class="ad-empty"><span class="material-symbols-outlined">search_off</span>ไม่พบเมนู “${esc(keyword)}”</div>`;
}
function setupSearch() {
  const input = document.getElementById("menuSearch");
  if (!input) return;
  input.addEventListener("input", () => renderAdminMenus(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { const a = document.querySelector("#adminMenuContainer .ad-tile"); if (a) a.click(); }
    if (e.key === "Escape") { input.value = ""; renderAdminMenus(); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== input && !/input|textarea|select/i.test(document.activeElement?.tagName || "")) { e.preventDefault(); input.focus(); }
  });
}

/* ----------------------------------------------------------
   4) ข้อมูล
   ---------------------------------------------------------- */
// ดึงครบทุกแถว (Supabase ส่งได้ครั้งละ 1,000 แถว)
async function fetchAll(table, cols, pageSize = 1000) {
  const out = [];
  for (let from = 0; from < 200000; from += pageSize) {
    const { data, error } = await supabaseClient.from(table).select(cols).range(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

let _loading = false;
async function loadDashboardData() {
  if (_loading) return;
  _loading = true;
  setText("updatedText", "กำลังโหลดข้อมูล...");
  try {
    const [profilesRes, shops, approvals] = await Promise.all([
      supabaseClient.from("profiles").select("id, username, display_name, role, status, area, created_at").order("created_at", { ascending: false }),
      fetchAll("shops", "id, sale_id, status"),
      supabaseClient.from("approval_requests").select("request_status, request_type").then((r) => (r.error ? null : r.data || []), () => null),
    ]);
    if (profilesRes.error) throw profilesRes.error;
    const profiles = profilesRes.data || [];
    render(profiles, shops, approvals);
    setText("updatedText", `อัปเดตล่าสุด ${new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} น.`);
  } catch (err) {
    console.error("[AdminDashboard]", err);
    setText("updatedText", "โหลดข้อมูลไม่สำเร็จ: " + (err.message || err));
    ["healthList", "roleList", "recentUsersBody"].forEach((id) => { const el = document.getElementById(id); if (el) el.innerHTML = `<li class="ad-muted is-error">โหลดข้อมูลไม่สำเร็จ</li>`; });
    const sb = document.getElementById("salesBody"); if (sb) sb.innerHTML = `<tr><td colspan="6" class="ad-muted is-error">โหลดข้อมูลไม่สำเร็จ</td></tr>`;
  } finally {
    _loading = false;
  }
}

function render(profiles, shops, approvals) {
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const total = profiles.length;
  const active = profiles.filter((p) => isActive(p.status)).length;
  const blocked = total - active;
  const statusCount = {};
  profiles.filter((p) => !isActive(p.status)).forEach((p) => { const k = String(p.status || "ไม่ระบุ").trim() || "ไม่ระบุ"; statusCount[k] = (statusCount[k] || 0) + 1; });

  const sales = profiles.filter((p) => roleKey(p.role) === "sales");
  const salesActive = sales.filter((p) => isActive(p.status));

  // ร้าน
  const shopActive = (s) => isActive(s.status);
  const perSale = {};
  let orphan = 0, orphanActive = 0, toBlockedSale = 0, toNonSale = 0;
  shops.forEach((s) => {
    if (!s.sale_id) { orphan++; if (shopActive(s)) orphanActive++; return; }
    const owner = byId.get(s.sale_id);
    if (!owner) { orphan++; if (shopActive(s)) orphanActive++; return; } // ผู้ดูแลถูกลบไปแล้ว
    const k = (perSale[s.sale_id] ||= { all: 0, active: 0 });
    k.all++; if (shopActive(s)) k.active++;
    if (!isActive(owner.status) && shopActive(s)) toBlockedSale++;
    if (roleKey(owner.role) !== "sales") toNonSale++;
  });
  const shopsActive = shops.filter(shopActive).length;

  // KPI
  setText("kUsers", fmtN(total));
  setText("kUsersSub", `ใช้งานได้ ${fmtN(active)} คน`);
  setText("kBlocked", fmtN(blocked));
  setText("kBlockedSub", blocked ? Object.entries(statusCount).map(([k, n]) => `${k} ${n}`).join(" · ") : "ทุกบัญชีใช้งานได้");
  setText("kSales", fmtN(sales.length));
  setText("kSalesSub", `ใช้งานได้ ${fmtN(salesActive.length)} คน`);
  setText("kShops", fmtN(shops.length));
  setText("kShopsSub", `Active ${fmtN(shopsActive)} ร้าน`);
  setText("kOrphan", fmtN(orphan));
  setText("kOrphanSub", orphan ? `ในนี้ Active ${fmtN(orphanActive)} ร้าน` : "ทุกร้านมีเซลล์ดูแล");
  document.getElementById("kOrphan")?.classList.toggle("is-warn", orphan > 0);
  document.getElementById("kBlocked")?.classList.toggle("is-warn", blocked > 0);

  if (approvals === null) { setText("kApprovals", "—"); setText("kApprovalsSub", "ไม่มีสิทธิ์อ่านข้อมูลนี้"); }
  else {
    // ค้าง = ยังรอผู้อนุมัติ (ไม่นับที่ปิดแล้ว และที่ส่งกลับให้ผู้ขอเพิ่มข้อมูล)
    const closed = ["approved", "rejected", "exec_approved", "exec_rejected", "cancelled", "request_more_info"];
    const open = approvals.filter((a) => !closed.includes(String(a.request_status || "").toLowerCase()));
    const waitMgr = open.filter((a) => a.request_status === "waiting_manager").length;
    setText("kApprovals", fmtN(open.length));
    setText("kApprovalsSub", open.length ? `รอ Manager ${fmtN(waitMgr)} · ขั้นอื่น ${fmtN(open.length - waitMgr)}` : "ไม่มีคำขอค้าง");
  }

  // ข้อมูลที่ควรตรวจ
  const salesNoArea = sales.filter((p) => isActive(p.status) && !String(p.area || "").trim()).length;
  const noRole = profiles.filter((p) => !ROLE_META[roleKey(p.role)]).length;
  const salesNoShop = salesActive.filter((p) => !(perSale[p.id]?.all)).length;
  const checks = [
    { n: orphan, label: "ร้านที่ไม่มีเซลล์ดูแล", hint: "กำหนดเซลล์ผู้ดูแลให้ร้าน", url: "/pages/admin/adminShops.html" },
    { n: toBlockedSale, label: "ร้าน Active ที่เซลล์ผู้ดูแลถูกระงับ", hint: "ย้ายร้านให้เซลล์ที่ใช้งานอยู่", url: "/pages/admin/adminShops.html" },
    { n: toNonSale, label: "ร้านที่ผู้ดูแลไม่ใช่ role Sales", hint: "ตรวจผู้ดูแลร้าน", url: "/pages/admin/adminShops.html" },
    { n: salesNoArea, label: "เซลล์ที่ยังไม่ระบุพื้นที่ขาย", hint: "ระบุพื้นที่ในข้อมูลเซลล์", url: "/pages/admin/adminSales.html" },
    { n: salesNoShop, label: "เซลล์ที่ยังไม่มีร้านในความดูแล", hint: "ตรวจการแบ่งร้าน", url: "/pages/admin/adminShops.html" },
    { n: noRole, label: "ผู้ใช้ที่ไม่มี Role หรือ Role ไม่รู้จัก", hint: "เข้าใช้งานหน้าใดไม่ได้", url: "/pages/admin/admintor.html" },
  ];
  const hl = document.getElementById("healthList");
  const issues = checks.filter((c) => c.n > 0);
  hl.innerHTML = (issues.length ? issues : []).map((c) => `
      <li><a href="${esc(c.url)}" class="ad-health-item is-warn">
        <b>${fmtN(c.n)}</b><span>${esc(c.label)}<small>${esc(c.hint)}</small></span><span class="material-symbols-outlined">chevron_right</span></a></li>`).join("")
    + checks.filter((c) => c.n === 0).map((c) => `<li class="ad-health-ok"><span class="material-symbols-outlined">check_circle</span>${esc(c.label)} — ไม่มี</li>`).join("");

  // Role
  const counts = {};
  profiles.forEach((p) => { const k = ROLE_META[roleKey(p.role)] ? roleKey(p.role) : "_other"; counts[k] = (counts[k] || 0) + 1; });
  const rows = Object.keys(ROLE_META).filter((k) => counts[k]).map((k) => ({ k, label: ROLE_META[k].label, icon: ROLE_META[k].icon, n: counts[k] }));
  if (counts._other) rows.push({ k: "_other", label: "ไม่มี / ไม่รู้จัก", icon: "help", n: counts._other });
  const max = Math.max(1, ...rows.map((r) => r.n));
  document.getElementById("roleList").innerHTML = rows.length ? rows.map((r) => `
    <li><span class="material-symbols-outlined">${esc(r.icon)}</span><span class="ad-role-name">${esc(r.label)}</span>
      <span class="ad-bar"><i style="width:${Math.round((r.n / max) * 100)}%"></i></span><b>${fmtN(r.n)}</b></li>`).join("")
    : `<li class="ad-muted">ยังไม่มีผู้ใช้</li>`;

  // ทีม Sales (ร้านมากสุดก่อน · ถูกระงับไว้ท้าย)
  const sb = document.getElementById("salesBody");
  const salesSorted = sales.slice().sort((a, b) => (isActive(b.status) - isActive(a.status)) || ((perSale[b.id]?.active || 0) - (perSale[a.id]?.active || 0)) || String(a.display_name || "").localeCompare(String(b.display_name || ""), "th"));
  sb.innerHTML = salesSorted.length ? salesSorted.map((p) => {
    const c = perSale[p.id] || { all: 0, active: 0 };
    return `<tr class="${isActive(p.status) ? "" : "is-off"}">
      <td><b>${esc(p.display_name || "-")}</b></td>
      <td><span class="ad-code">${esc(p.username || "-")}</span></td>
      <td>${p.area ? esc(p.area) : `<span class="ad-flag">ไม่ระบุ</span>`}</td>
      <td>${isActive(p.status) ? `<span class="ad-pill is-ok">ใช้งาน</span>` : `<span class="ad-pill is-off">${esc(p.status || "ระงับ")}</span>`}</td>
      <td class="num"><b>${fmtN(c.active)}</b></td>
      <td class="num">${fmtN(c.all)}</td></tr>`;
  }).join("") : `<tr><td colspan="6" class="ad-muted">ยังไม่มีผู้ใช้ role Sales</td></tr>`;

  // ผู้ใช้ล่าสุด
  document.getElementById("recentUsersBody").innerHTML = profiles.slice(0, 8).map((p) => `
    <li>
      <span class="ad-avatar">${esc((p.display_name || p.username || "?").trim().charAt(0).toUpperCase())}</span>
      <span class="ad-person"><b>${esc(p.display_name || p.username || "-")}</b><small>${esc(roleLabel(p.role))}${p.area ? " · " + esc(p.area) : ""}</small></span>
      <span class="ad-pill ${isActive(p.status) ? "is-ok" : "is-off"}">${isActive(p.status) ? "ใช้งาน" : esc(p.status || "ระงับ")}</span>
      <span class="ad-date">${fmtDate(p.created_at)}</span>
    </li>`).join("") || `<li class="ad-muted">ยังไม่มีผู้ใช้</li>`;
}

/* ----------------------------------------------------------
   5) หัวเว็บ / เมนูข้าง
   ---------------------------------------------------------- */
function toggleSidebar() {
  const sidebar = document.getElementById("appSidebar"), main = document.querySelector(".app-main");
  if (!sidebar) return;
  const expand = sidebar.classList.contains("collapsed");
  sidebar.classList.toggle("collapsed", !expand);
  sidebar.classList.toggle("expanded", expand);
  if (main) main.style.marginLeft = expand ? "220px" : "";
}
function setActiveNavItem() {
  const path = window.location.pathname;
  document.querySelectorAll(".sidebar-nav-item").forEach((a) => a.classList.toggle("active", (a.getAttribute("href") || "") === path));
}
function updateHeaderDate() {
  setText("headerDateText", new Date().toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
}
function renderHeaderUser() {
  const cu = window.currentUser || {};
  const name = cu.display_name || cu.full_name || cu.email || "Admin";
  setText("userName", name);
  const av = document.getElementById("userAvatar");
  if (av) { av.innerHTML = ""; av.textContent = name.trim().charAt(0).toUpperCase(); }
}
async function logout() {
  try { await supabaseClient.auth.signOut(); } catch (e) { /* ignore */ }
  window.location.href = "/pages/auth/login.html";
}
function showToast(message, type = "success", duration = 3000) {
  const t = document.getElementById("toast"); if (!t) return;
  t.textContent = message;
  t.style.background = { success: "#10b981", danger: "#ef4444", info: "#3b82f6", warning: "#f59e0b" }[type] || "#10b981";
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), duration);
}

/* ----------------------------------------------------------
   6) เริ่มทำงาน — ตรวจสิทธิ์ Admin ก่อนโหลดข้อมูล
   ---------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", async () => {
  updateHeaderDate();
  setActiveNavItem();
  renderAdminMenus();
  setupSearch();
  document.querySelector(".sidebar-collapse-btn")?.addEventListener("click", toggleSidebar);
  document.getElementById("logoutBtn")?.addEventListener("click", logout);
  if (typeof supabaseClient === "undefined") { setText("updatedText", "ระบบยังไม่พร้อม กรุณารีเฟรชหน้า"); return; }
  if (typeof protectPage === "function") await protectPage(["admin"]); // จะพาออกถ้าไม่ใช่ admin
  if (!window.currentUser?.id && typeof loadCurrentUser === "function") await loadCurrentUser();
  if (window.currentUser?.role && roleKey(window.currentUser.role) !== "admin") return; // กำลังถูกพาออกจากหน้า
  renderHeaderUser();
  await loadDashboardData();
});
