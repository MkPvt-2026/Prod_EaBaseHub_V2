// ============================================================
// admintor.js v2.0 — ผู้ใช้งานและสิทธิ์ (Admin · ใช้บนโน้ตบุ๊กเป็นหลัก)
//
// ตาราง profiles: id, email, username, display_name, role, status, area, manager_id, created_at
// ผู้สมัครใหม่ (register.js) = role "user" + status "Inactive" → Admin กำหนด Role แล้วเปิดใช้งาน
//
// v2.0 แก้จากเดิม
//  - ชื่อที่มี & < > แสดงเพี้ยน (escape ซ้ำ 2 ครั้ง)
//  - Admin ระงับ / ลบ / ลด Role ของตัวเองได้ → ล็อกตัวเองออกจากระบบ · กันลดจำนวน Admin ที่ใช้งานได้จนเหลือ 0
//  - role "sale" / "Admin" / "adminqc" (สะกดต่างกัน) ไม่ถูกนับ/กรอง และเปิดแก้ไขแล้วช่อง Role ว่าง
//    → แสดงตาม role ที่ถูกต้อง และบันทึกเป็นค่ามาตรฐาน (เช่น sale → sales ซึ่งหน้า sales ใช้)
//  - สถานะตัวพิมพ์เล็ก/ว่าง ทำให้บันทึกไม่ได้ · ตัวกรองสถานะต้องตรงตัวพิมพ์
//  - บันทึก/เปลี่ยนสถานะ "ไม่มี error" แต่ไม่มีแถวถูกแก้ (สิทธิ์ RLS) → หน้าบอกว่าสำเร็จ · ตอนนี้ตรวจผลจริง
//  - ระงับใช้งานไม่มีถามยืนยัน · กดซ้ำได้ระหว่างบันทึก
//  - ลบผู้ใช้ที่ยังมีร้านในความดูแล → ร้านกลายเป็นไม่มีผู้ดูแล · ตอนนี้ตรวจก่อนและไม่ให้ลบ
//  - อนุมัติผู้สมัครเป็น role "user" ซึ่งไม่มีหน้าให้ใช้ → บังคับเลือก Role งาน
//  - เพิ่ม "หัวหน้าทีม (Manager)" (profiles.manager_id) ใช้กับการอนุมัติราคาพิเศษขั้น Manager
//  - ชื่อบนหัวเว็บเดิมถูกทับด้วยอีเมลจากสคริปต์ในหน้า
// ============================================================
"use strict";

const ROLES = [
  { v: "sales", label: "Sales", icon: "badge", help: "พนักงานขาย — รายงานเยี่ยมร้าน แบบฟอร์ม เคลม" },
  { v: "manager", label: "Manager", icon: "supervisor_account", help: "หัวหน้าทีม — ดูรายงานทีม อนุมัติราคาพิเศษขั้นที่ 1" },
  { v: "marketing", label: "Marketing", icon: "campaign", help: "การตลาด — RFM ประชาสัมพันธ์ ขอราคาพิเศษ" },
  { v: "executive", label: "Executive", icon: "workspace_premium", help: "ผู้บริหาร — ภาพรวม และอนุมัติขั้นสุดท้าย" },
  { v: "accounting", label: "Accounting", icon: "account_balance", help: "บัญชี — วงเงินลูกค้า" },
  { v: "adminQc", label: "Admin QC", icon: "verified_user", help: "QC — งานเคลมและตรวจคุณภาพ" },
  { v: "admin", label: "Admin", icon: "shield", help: "ผู้ดูแลระบบ — เข้าได้ทุกหน้า จัดการผู้ใช้" },
  { v: "user", label: "User (ยังไม่กำหนด)", icon: "person", help: "ยังไม่มีหน้าที่ใช้งานได้ — ใช้กับผู้สมัครที่ยังไม่อนุมัติ" },
];
const ROLE_BY = Object.fromEntries(ROLES.map((r) => [r.v.toLowerCase(), r]));

let allUsers = [];
let _chip = "";        // ตัวกรองด่วน: "" | "pending" | "inactive" | role
let _editId = null;
let _deleteId = null;
let _busy = false;

// ============================================================
// ตัวช่วย
// ============================================================
function esc(t) { return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function $(id) { return document.getElementById(id); }
function roleKey(role) { const r = String(role || "").trim().toLowerCase().replace(/\s/g, ""); return r === "sale" ? "sales" : r; }
function roleMeta(role) { return ROLE_BY[roleKey(role)] || null; }
function canonRole(role) { return roleMeta(role)?.v || "user"; }
function isActive(u) { return String(u.status || "").trim().toLowerCase() === "active"; }
function isPending(u) { return !isActive(u) && roleKey(u.role) === "user"; } // ผู้สมัครใหม่
function nameOf(u) { return u?.display_name || u?.username || u?.email || "-"; }
function fmtDate(iso) { if (!iso) return "-"; const d = new Date(iso); return isNaN(d) ? "-" : d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" }); }
function meId() { return window.currentUser?.id || null; }
function activeAdmins() { return allUsers.filter((u) => roleKey(u.role) === "admin" && isActive(u)); }
function toast(msg, type = "ok") {
  const t = $("atToast"); if (!t) return;
  t.textContent = msg; t.className = `at-toast is-${type} is-show`;
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("is-show"), 2800);
}
function roleBadge(role) {
  const m = roleMeta(role);
  if (!m) return `<span class="at-role is-unknown"><span class="material-symbols-outlined">help</span>${esc(role || "ไม่มี Role")}</span>`;
  return `<span class="at-role r-${esc(m.v.toLowerCase())}"><span class="material-symbols-outlined">${m.icon}</span>${esc(m.label.replace(" (ยังไม่กำหนด)", ""))}</span>`;
}
function statusBadge(u) {
  if (isActive(u)) return `<span class="at-pill is-ok">ใช้งานได้</span>`;
  if (isPending(u)) return `<span class="at-pill is-warn">รออนุมัติ</span>`;
  return `<span class="at-pill is-off">${esc(u.status || "ระงับ")}</span>`;
}

// ============================================================
// เริ่มต้น
// ============================================================
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof supabaseClient === "undefined") { alert("ระบบยังไม่พร้อม กรุณารีเฟรชหน้า"); return; }
  if (typeof protectPage === "function") await protectPage(["admin"]);
  if (!window.currentUser?.id && typeof loadCurrentUser === "function") await loadCurrentUser();
  if (roleKey(window.currentUser?.role) && roleKey(window.currentUser.role) !== "admin") return; // กำลังถูกพาออก
  const name = nameOf(window.currentUser);
  $("userName").textContent = name;
  $("userAvatar").textContent = name.trim().charAt(0).toUpperCase();
  $("logoutBtn").addEventListener("click", async () => { try { await supabaseClient.auth.signOut(); } catch (e) { /* ignore */ } location.href = "/pages/auth/login.html"; });
  loadNav();
  setupFilters();
  await loadUsers();
});

async function loadNav() {
  try {
    const res = await fetch("/pages/components/nav-admin.html");
    if (!res.ok) return;
    $("navContainer").innerHTML = await res.text();
    document.querySelectorAll("#navContainer .app-nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === location.pathname));
  } catch (e) { console.warn("nav:", e); }
}

function setupFilters() {
  $("filterRole").innerHTML = `<option value="">ทุก Role</option>` + ROLES.map((r) => `<option value="${r.v}">${esc(r.label.replace(" (ยังไม่กำหนด)", ""))}</option>`).join("") + `<option value="_unknown">ไม่มี / ไม่รู้จัก</option>`;
  $("editRole").innerHTML = ROLES.map((r) => `<option value="${r.v}">${esc(r.label)}</option>`).join("");
  ["filterRole", "filterStatus", "sortBy"].forEach((id) => $(id).addEventListener("change", () => { _chip = ""; renderAll(); }));
  $("searchUser").addEventListener("input", renderTable);
  $("editRole").addEventListener("change", onEditRoleChange);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeEditModal(); closeDeleteModal(); }
    if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement?.tagName || "")) { e.preventDefault(); $("searchUser").focus(); }
  });
  [$("editModal"), $("deleteModal")].forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) { closeEditModal(); closeDeleteModal(); } }));
}

// ============================================================
// โหลดข้อมูล
// ============================================================
async function loadUsers() {
  $("userTable").innerHTML = `<tr><td colspan="8" class="at-state">กำลังโหลด...</td></tr>`;
  let res = await supabaseClient.from("profiles").select("id, email, username, display_name, role, status, area, manager_id, created_at").order("created_at", { ascending: false });
  if (res.error && /manager_id/.test(res.error.message || "")) {
    // ฐานข้อมูลยังไม่มีคอลัมน์ manager_id → ทำงานต่อได้ แต่ซ่อนช่องหัวหน้าทีม
    window._noManagerCol = true;
    res = await supabaseClient.from("profiles").select("id, email, username, display_name, role, status, area, created_at").order("created_at", { ascending: false });
  }
  if (res.error) {
    console.error("loadUsers:", res.error);
    $("userTable").innerHTML = `<tr><td colspan="8" class="at-state is-error">โหลดข้อมูลไม่สำเร็จ: ${esc(res.error.message)}</td></tr>`;
    return;
  }
  allUsers = res.data || [];
  $("areaList").innerHTML = [...new Set(allUsers.map((u) => (u.area || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th")).map((a) => `<option value="${esc(a)}"></option>`).join("");
  renderAll();
}
function renderAll() {
  // อนุมัติ/ลบผู้สมัครครบแล้วขณะกรอง "รออนุมัติ" → กลับไปแสดงทั้งหมด
  if ($("filterStatus").value === "pending" && !allUsers.some(isPending)) { _chip = ""; $("filterStatus").value = ""; }
  renderPending(); renderChips(); renderTable();
}

// ============================================================
// ผู้สมัครใหม่
// ============================================================
function renderPending() {
  const list = allUsers.filter(isPending);
  $("pendingBox").hidden = !list.length;
  $("pendingCount").textContent = list.length;
  $("pendingList").innerHTML = list.slice(0, 12).map((u) => `
    <div class="at-pend">
      <span class="at-avatar">${esc(nameOf(u).trim().charAt(0).toUpperCase())}</span>
      <span class="at-pend-who"><b>${esc(nameOf(u))}</b><small>${esc(u.email || "-")} · สมัคร ${fmtDate(u.created_at)}</small></span>
      <button type="button" class="at-btn-primary is-sm" onclick="openEditModal('${esc(u.id)}', true)"><span class="material-symbols-outlined">how_to_reg</span>อนุมัติ</button>
      <button type="button" class="at-btn-ghost is-sm" onclick="openDeleteModal('${esc(u.id)}')" title="ไม่อนุมัติ / ลบ"><span class="material-symbols-outlined">person_remove</span></button>
    </div>`).join("") + (list.length > 12 ? `<button type="button" class="at-more" onclick="setChip('pending')">ดูทั้งหมด ${list.length} คน ›</button>` : "");
}

// ============================================================
// ตัวกรองด่วน
// ============================================================
function renderChips() {
  const count = (fn) => allUsers.filter(fn).length;
  const chips = [
    { k: "", label: "ทั้งหมด", icon: "group", n: allUsers.length },
    { k: "pending", label: "รออนุมัติ", icon: "how_to_reg", n: count(isPending), tone: "warn" },
    { k: "inactive", label: "ระงับ", icon: "block", n: count((u) => !isActive(u) && !isPending(u)), tone: "off" },
    ...ROLES.filter((r) => r.v !== "user").map((r) => ({ k: r.v, label: r.label, icon: r.icon, n: count((u) => roleKey(u.role) === r.v.toLowerCase()) })),
  ];
  const unknown = count((u) => !roleMeta(u.role));
  if (unknown) chips.push({ k: "_unknown", label: "ไม่มี Role", icon: "help", n: unknown, tone: "warn" });
  $("chipBar").innerHTML = chips.map((c) => `
    <button type="button" class="at-chip${_chip === c.k ? " is-on" : ""}${c.tone && c.n ? " is-" + c.tone : ""}" onclick="setChip('${c.k}')" ${c.n || !c.k ? "" : "disabled"}>
      <span class="material-symbols-outlined">${c.icon}</span>${esc(c.label)}<b>${c.n}</b></button>`).join("");
}
function setChip(k) {
  _chip = k;
  $("filterRole").value = ""; $("filterStatus").value = "";
  if (k === "pending" || k === "inactive") $("filterStatus").value = k;
  else if (k) $("filterRole").value = k;
  renderChips(); renderTable();
  document.querySelector(".at-table-wrap")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ============================================================
// ตาราง
// ============================================================
function filtered() {
  const q = $("searchUser").value.trim().toLowerCase();
  const rf = $("filterRole").value, sf = $("filterStatus").value, sort = $("sortBy").value;
  const managers = new Map(allUsers.map((u) => [u.id, u]));
  let rows = allUsers.filter((u) => {
    if (rf === "_unknown" ? !!roleMeta(u.role) : rf && roleKey(u.role) !== rf.toLowerCase()) return false;
    if (sf === "active" && !isActive(u)) return false;
    if (sf === "pending" && !isPending(u)) return false;
    if (sf === "inactive" && (isActive(u) || isPending(u))) return false;
    if (q) {
      const mg = managers.get(u.manager_id);
      const hay = [u.display_name, u.username, u.email, u.area, roleMeta(u.role)?.label, mg ? nameOf(mg) : ""].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (sort === "name") rows.sort((a, b) => nameOf(a).localeCompare(nameOf(b), "th"));
  else if (sort === "role") rows.sort((a, b) => (ROLES.findIndex((r) => r.v === canonRole(a.role)) - ROLES.findIndex((r) => r.v === canonRole(b.role))) || nameOf(a).localeCompare(nameOf(b), "th"));
  return rows;
}
function renderTable() {
  const rows = filtered();
  const byId = new Map(allUsers.map((u) => [u.id, u]));
  $("resultText").textContent = `แสดง ${rows.length} จาก ${allUsers.length} คน`;
  if (!rows.length) { $("userTable").innerHTML = `<tr><td colspan="8" class="at-state">ไม่พบผู้ใช้ตามเงื่อนไข</td></tr>`; return; }
  $("userTable").innerHTML = rows.map((u) => {
    const id = esc(u.id), me = u.id === meId(), mg = byId.get(u.manager_id);
    const needsMgr = roleKey(u.role) === "sales" && !u.manager_id && !window._noManagerCol;
    return `<tr class="${isActive(u) ? "" : "is-off"}${me ? " is-me" : ""}">
      <td><div class="at-user"><span class="at-avatar">${esc(nameOf(u).trim().charAt(0).toUpperCase())}</span>
        <span class="at-user-txt"><b>${esc(u.display_name || "-")}${me ? ` <em>คุณ</em>` : ""}</b><small>${esc(u.email || "-")}</small></span></div></td>
      <td>${u.username ? `<span class="at-code">${esc(u.username)}</span>` : `<span class="at-dim">-</span>`}</td>
      <td>${roleBadge(u.role)}</td>
      <td>${u.area ? esc(u.area) : (roleKey(u.role) === "sales" ? `<span class="at-flag">ไม่ระบุ</span>` : `<span class="at-dim">-</span>`)}</td>
      <td>${window._noManagerCol ? `<span class="at-dim">-</span>` : mg ? esc(nameOf(mg)) : needsMgr ? `<span class="at-flag">ยังไม่กำหนด</span>` : `<span class="at-dim">-</span>`}</td>
      <td>${statusBadge(u)}</td>
      <td class="at-dim">${fmtDate(u.created_at)}</td>
      <td class="c-act"><div class="at-actions">
        ${isPending(u)
          ? `<button type="button" class="at-act is-primary" onclick="openEditModal('${id}', true)"><span class="material-symbols-outlined">how_to_reg</span>อนุมัติ</button>`
          : `<button type="button" class="at-act" onclick="openEditModal('${id}')"><span class="material-symbols-outlined">edit</span>แก้ไข</button>
             <button type="button" class="at-act ${isActive(u) ? "is-warn" : "is-ok"}" onclick="toggleStatus('${id}')" ${me ? 'disabled title="ระงับบัญชีตัวเองไม่ได้"' : ""}>
               <span class="material-symbols-outlined">${isActive(u) ? "block" : "check_circle"}</span>${isActive(u) ? "ระงับ" : "เปิดใช้"}</button>`}
        <button type="button" class="at-act is-icon" onclick="openDeleteModal('${id}')" ${me ? 'disabled title="ลบบัญชีตัวเองไม่ได้"' : 'title="ลบ"'} aria-label="ลบ"><span class="material-symbols-outlined">delete</span></button>
      </div></td></tr>`;
  }).join("");
}

// ============================================================
// เปลี่ยนสถานะ
// ============================================================
async function toggleStatus(id) {
  if (_busy) return;
  const u = allUsers.find((x) => x.id === id); if (!u) return;
  const toActive = !isActive(u);
  if (!toActive) {
    if (u.id === meId()) { alert("ระงับบัญชีตัวเองไม่ได้"); return; }
    if (roleKey(u.role) === "admin" && activeAdmins().length <= 1) { alert("ต้องมี Admin ที่ใช้งานได้อย่างน้อย 1 คน"); return; }
    if (!confirm(`ระงับการใช้งานของ ${nameOf(u)}?\nผู้ใช้จะเข้าระบบไม่ได้จนกว่าจะเปิดใช้อีกครั้ง`)) return;
  } else if (!roleMeta(u.role) || roleKey(u.role) === "user") {
    openEditModal(id, true); return; // ต้องเลือก Role ก่อนเปิดใช้งาน
  }
  await updateProfile(id, { status: toActive ? "Active" : "Inactive" }, toActive ? `เปิดใช้งาน ${nameOf(u)} แล้ว` : `ระงับ ${nameOf(u)} แล้ว`);
}

// อัปเดตและตรวจว่ามีแถวถูกแก้จริง (กรณีสิทธิ์ RLS ไม่ให้แก้ จะไม่มี error แต่ไม่มีแถว)
async function updateProfile(id, patch, okMsg) {
  _busy = true;
  try {
    const { data, error } = await supabaseClient.from("profiles").update(patch).eq("id", id).select("id");
    if (error) throw error;
    if (Array.isArray(data) && !data.length) throw new Error("ไม่มีสิทธิ์แก้ไขผู้ใช้นี้ (ตรวจ RLS ของตาราง profiles)");
    const u = allUsers.find((x) => x.id === id); if (u) Object.assign(u, patch);
    renderAll();
    toast(okMsg, "ok");
    return true;
  } catch (e) {
    console.error("updateProfile:", e);
    alert("บันทึกไม่สำเร็จ: " + (e.code === "23505" ? "Username นี้ถูกใช้แล้ว" : e.message));
    return false;
  } finally { _busy = false; }
}

// ============================================================
// แก้ไข / อนุมัติ
// ============================================================
function openEditModal(id, approving) {
  const u = allUsers.find((x) => x.id === id); if (!u) return;
  _editId = id;
  const me = u.id === meId();
  $("editTitle").textContent = approving ? "อนุมัติผู้สมัคร" : "แก้ไขผู้ใช้";
  $("editWho").innerHTML = `<span class="at-avatar">${esc(nameOf(u).trim().charAt(0).toUpperCase())}</span><span class="at-user-txt"><b>${esc(nameOf(u))}</b><small>${esc(u.email || "-")} · สร้าง ${fmtDate(u.created_at)}</small></span>`;
  $("editDisplayName").value = u.display_name || "";
  $("editUsername").value = u.username || "";
  const r = canonRole(u.role);
  $("editRole").value = approving && r === "user" ? "sales" : r;
  $("editStatus").value = approving ? "Active" : (isActive(u) ? "Active" : "Inactive");
  $("editArea").value = u.area || "";
  // หัวหน้าทีม: Manager ที่ใช้งานได้ (ยกเว้นตัวเอง)
  const mgrs = allUsers.filter((m) => roleKey(m.role) === "manager" && m.id !== u.id).sort((a, b) => nameOf(a).localeCompare(nameOf(b), "th"));
  $("editManager").innerHTML = `<option value="">— ไม่มี —</option>` + mgrs.map((m) => `<option value="${esc(m.id)}">${esc(nameOf(m))}${m.area ? " · " + esc(m.area) : ""}${isActive(m) ? "" : " (ระงับ)"}</option>`).join("")
    + (u.manager_id && !mgrs.some((m) => m.id === u.manager_id) ? `<option value="${esc(u.manager_id)}">(หัวหน้าเดิม — ไม่ใช่ Manager แล้ว)</option>` : "");
  $("editManager").value = u.manager_id || "";
  $("managerField").hidden = !!window._noManagerCol;
  // ป้องกันล็อกตัวเอง
  $("editRole").disabled = me; $("editStatus").disabled = me;
  const notes = [];
  if (me) notes.push("นี่คือบัญชีของคุณ — เปลี่ยน Role หรือระงับตัวเองไม่ได้ (กันล็อกตัวเองออกจากระบบ)");
  if (roleMeta(u.role) && u.role !== canonRole(u.role)) notes.push(`Role ในระบบสะกดเป็น “${u.role}” — บันทึกแล้วจะปรับเป็น “${canonRole(u.role)}” ให้หน้าใช้งานถูกต้อง`);
  if (!roleMeta(u.role) && u.role) notes.push(`Role “${u.role}” ไม่มีในระบบ — กรุณาเลือก Role ใหม่`);
  $("editNote").hidden = !notes.length; $("editNote").innerHTML = notes.map(esc).join("<br>");
  $("editErr").hidden = true;
  onEditRoleChange();
  $("editModal").hidden = false;
  setTimeout(() => (approving ? $("editRole") : $("editDisplayName")).focus(), 50);
}
function onEditRoleChange() {
  const r = ROLE_BY[$("editRole").value.toLowerCase()];
  $("roleHelp").textContent = r ? r.help : "";
  $("managerField").classList.toggle("is-dim", !["sales", "marketing"].includes($("editRole").value) && !window._noManagerCol);
}
function closeEditModal() { $("editModal").hidden = true; _editId = null; }

async function saveUser() {
  if (_busy || !_editId) return;
  const u = allUsers.find((x) => x.id === _editId); if (!u) return;
  const me = u.id === meId();
  const role = me ? canonRole(u.role) : $("editRole").value;
  const status = me ? "Active" : $("editStatus").value;
  const err = (m) => { $("editErr").textContent = m; $("editErr").hidden = false; };
  if (!$("editDisplayName").value.trim()) return err("กรุณาใส่ชื่อที่แสดง");
  if (status === "Active" && role === "user") return err("ผู้ใช้ role “User” ยังไม่มีหน้าให้ใช้งาน — กรุณาเลือก Role งานก่อนเปิดใช้งาน");
  const wasActiveAdmin = roleKey(u.role) === "admin" && isActive(u);
  if (wasActiveAdmin && (role !== "admin" || status !== "Active") && activeAdmins().length <= 1) return err("ต้องมี Admin ที่ใช้งานได้อย่างน้อย 1 คน");
  const uname = $("editUsername").value.trim();
  if (uname && allUsers.some((x) => x.id !== u.id && (x.username || "").trim().toLowerCase() === uname.toLowerCase())) return err(`Username “${uname}” ถูกใช้แล้ว`);
  if (role === "sales" && !$("editArea").value.trim() && status === "Active" && !confirm("ยังไม่ได้ระบุพื้นที่ของเซลล์ — บันทึกต่อเลยไหม?")) return;

  const patch = {
    display_name: $("editDisplayName").value.trim() || null,
    username: uname || null,
    role, status,
    area: $("editArea").value.trim() || null,
  };
  if (!window._noManagerCol) patch.manager_id = $("editManager").value || null;
  if (role !== "admin" && wasActiveAdmin && !confirm(`ลด Role ของ ${nameOf(u)} จาก Admin เป็น ${ROLE_BY[role.toLowerCase()]?.label}?`)) return;

  const btn = $("saveBtn"); btn.disabled = true;
  const ok = await updateProfile(u.id, patch, isPending(u) && status === "Active" ? `อนุมัติ ${patch.display_name} เป็น ${ROLE_BY[role.toLowerCase()].label} แล้ว` : "บันทึกแล้ว");
  btn.disabled = false;
  if (ok) closeEditModal();
}

// ============================================================
// ลบ
// ============================================================
async function openDeleteModal(id) {
  const u = allUsers.find((x) => x.id === id); if (!u) return;
  if (u.id === meId()) { alert("ลบบัญชีตัวเองไม่ได้"); return; }
  _deleteId = id;
  $("delWho").innerHTML = `<span class="at-avatar">${esc(nameOf(u).trim().charAt(0).toUpperCase())}</span><span class="at-user-txt"><b>${esc(nameOf(u))}</b><small>${esc(u.email || "-")} · ${esc(roleMeta(u.role)?.label || u.role || "ไม่มี Role")}</small></span>`;
  $("delBtn").disabled = true;
  $("delSuspendBtn").hidden = !isActive(u);
  $("delInfo").className = "at-note"; $("delInfo").textContent = "กำลังตรวจข้อมูลที่เกี่ยวข้อง...";
  $("deleteModal").hidden = false;
  const block = [];
  if (roleKey(u.role) === "admin" && isActive(u) && activeAdmins().length <= 1) block.push("เป็น Admin คนสุดท้ายที่ใช้งานได้");
  try {
    const { count, error } = await supabaseClient.from("shops").select("id", { count: "exact", head: true }).eq("sale_id", id);
    if (error) throw error;
    if (count) block.push(`ยังมีร้านค้าในความดูแล ${count.toLocaleString("th-TH")} ร้าน — ย้ายร้านให้เซลล์คนอื่นก่อน (หน้าสิทธิ์ร้านค้า)`);
  } catch (e) { console.warn("shop check:", e); block.push("ตรวจร้านในความดูแลไม่สำเร็จ — ลองใหม่อีกครั้ง"); }
  const team = allUsers.filter((x) => x.manager_id === id).length;
  if (_deleteId !== id) return;
  if (block.length) { $("delInfo").className = "at-note is-bad"; $("delInfo").innerHTML = "ลบไม่ได้:<br>• " + block.map(esc).join("<br>• "); return; }
  $("delInfo").className = "at-note is-warn";
  $("delInfo").innerHTML = (team ? `เป็นหัวหน้าทีมของ ${team} คน — ลบแล้วคนในทีมจะไม่มีหัวหน้า<br>` : "") + "ข้อมูลที่ผู้ใช้นี้เคยบันทึก (รายงาน คำขอ ฯลฯ) จะยังอยู่ แต่จะไม่แสดงชื่อผู้ใช้";
  $("delBtn").disabled = false;
}
function closeDeleteModal() { $("deleteModal").hidden = true; _deleteId = null; }
async function suspendInsteadOfDelete() {
  const id = _deleteId; closeDeleteModal();
  if (id) await toggleStatus(id);
}
async function confirmDelete() {
  if (_busy || !_deleteId) return;
  const u = allUsers.find((x) => x.id === _deleteId); if (!u) return;
  if (!confirm(`ยืนยันลบ ${nameOf(u)} ออกจากระบบ? (กู้คืนไม่ได้)`)) return;
  _busy = true; $("delBtn").disabled = true;
  try {
    const { data, error } = await supabaseClient.from("profiles").delete().eq("id", u.id).select("id");
    if (error) throw error;
    if (Array.isArray(data) && !data.length) throw new Error("ไม่มีสิทธิ์ลบผู้ใช้นี้ (ตรวจ RLS ของตาราง profiles)");
    allUsers = allUsers.filter((x) => x.id !== u.id);
    closeDeleteModal(); renderAll();
    toast(`ลบ ${nameOf(u)} แล้ว`, "ok");
  } catch (e) {
    alert("ลบไม่สำเร็จ: " + e.message);
    $("delBtn").disabled = false;
  } finally { _busy = false; }
}
