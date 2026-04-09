/*************************************************
 * HOME.JS (Production Ready)
 * ------------------------------------------------
 * - Protect page (Supabase session)
 * - Load data from localStorage safely
 * - Render Dashboard summary
 * - Render My Reports list
 * - Weekly report progress
 * - Dynamic calendar
 * - UI controls (menu / sidebar)
 * - Announcements module integration
 *************************************************/


/* =================================================
   1️⃣ Utilities
================================================= */

// Safe JSON parse
function getStorageArray(key) {
  try {
    const data = JSON.parse(localStorage.getItem(key));
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn("Storage error:", key);
    return [];
  }
}

// Format Date → YYYY-MM-DD
function formatDate(date) {
  return date.toISOString().split("T")[0];
}


/* =================================================
   2️⃣ Global State
================================================= */

let reports = [];
let areas   = [];
let claims  = [];

let currentDate = new Date();


/* =================================================
   3️⃣ Protect Page (Auth Required)
================================================= */

async function protectPage() {
  const { data: { session } } =
    await supabaseClient.auth.getSession();

  if (!session) {
    window.location.href = "/pages/auth/login.html";
  }
}


async function loadUserEmail() {

  const { data: { user }, error } =
    await supabaseClient.auth.getUser();

  if (error || !user) {
    console.log("ไม่พบ user");
    return;
  }

  const emailEl = document.getElementById("userEmail");
  if (emailEl) {
    emailEl.textContent = user.email;
  }
}


/* =================================================
   4️⃣ Load Data
================================================= */

async function loadData() {

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  const { data: reportData, error: reportError } =
    await supabaseClient
      .from("reports")
      .select("*")
      .eq("sale_id", user.id)
      .order("created_at", { ascending: false });

  if (reportError) {
    console.error("โหลด reports ไม่ได้:", reportError.message);
  }

  const { data: claimData, error: claimError } =
    await supabaseClient
      .from("claims")
      .select("*");

  if (claimError) {
    console.error("โหลด claims ไม่ได้:", claimError.message);
  }

  reports = reportData || [];
  claims  = claimData  || [];
  
  if (reports.length > 0) {
    console.log("📋 Report columns:", Object.keys(reports[0]));
  }
}




async function loadUserProfile() {

  const { data: { user } } =
    await supabaseClient.auth.getUser();

  if (!user) return;

  const { data: profile, error } =
    await supabaseClient
      .from("profiles")
      .select("display_name, username, role")
      .eq("id", user.id)
      .single();

  if (error) {
    console.error("โหลด profile ไม่ได้:", error);
    return;
  }

  const fullName =
    profile?.display_name ||
    profile?.username ||
    user.email;

  const userNameEl  = document.getElementById("userName");
  const displayEl   = document.getElementById("displayName");
  const emailEl     = document.getElementById("userEmail");
  const roleEl      = document.getElementById("userRole");

  if (userNameEl) userNameEl.textContent = fullName;
  if (displayEl)  displayEl.textContent  = fullName;
  if (emailEl)    emailEl.textContent    = user.email;
  if (roleEl)     roleEl.textContent     = profile?.role || "Sales Executive";
}



/* =================================================
   🌍 Load User Area
   - แสดง Area ที่ Sales รับผิดชอบ
================================================= */
async function loadUserArea() {

  try {

    const { data: { user }, error } =
      await supabaseClient.auth.getUser();

    if (error || !user) return;

    const { data: profile, error: profileError } =
      await supabaseClient
        .from("profiles")
        .select("area")
        .eq("id", user.id)
        .single();

    if (profileError) {
      console.error("โหลด area ไม่ได้:", profileError);
      return;
    }

    const areaEl = document.getElementById("areaCount");

    if (areaEl) {
      areaEl.textContent =
        profile?.area || "ยังไม่ได้กำหนด";
    }

  } catch (err) {
    console.error("Error loadUserArea:", err.message);
  }
}

/* =================================================
  Load User Data
================================================= */
async function loadUserInfo() {

  const { data: { user }, error } =
    await supabaseClient.auth.getUser();

  if (error || !user) {
    console.log("ไม่พบ user");
    return;
  }

  document.getElementById("userName").textContent =
    user.email;
}



/* =================================================
   5️⃣ Render Dashboard Summary
================================================= */

function renderSummary() {
  
  const claimCountEl = document.getElementById("claimCount");

  
  if (claimCountEl) claimCountEl.textContent = claims.length;
}


/* =================================================
   6️⃣ Render My Reports
================================================= */

function renderReportList() {
  const listEl = document.getElementById("myReportList");
  if (!listEl) return;

  listEl.innerHTML = "";

  const items = [
    ...reports.map(r => ({
      type: "report",
      title: r.title || "รายงาน (ยังไม่ตั้งชื่อ)",
      date: r.report_date,
      link: `report.html?id=${r.id}`,
      id: r.id
    })),
  ];

  if (!items.length) {
    listEl.innerHTML =
      `<p style="color:#999">ยังไม่มีข้อมูล</p>`;
    return;
  }

  items
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .forEach(item => {
      const div = document.createElement("div");
      div.className = "report-item";

      div.innerHTML = `
        <div class="report-left">
          📄 <a href="${item.link}">${item.title}</a>
        </div>
        <div class="report-actions">
          <button onclick="location.href='${item.link}'">✏️</button>
          <button onclick="deleteItem('${item.type}','${item.id}')">🗑️</button>
        </div>
      `;

      listEl.appendChild(div);
    });
}

async function deleteItem(type, id) {

  if (!confirm("ต้องการลบใช่หรือไม่?")) return;

  const table =
    type === "report" ? "reports" :
    type === "trip"   ? "trips" :
                        "claims";

  const { error } = await supabaseClient
    .from(table)
    .delete()
    .eq("id", id);

  if (error) {
    console.error("ลบไม่สำเร็จ:", error);
  } else {
    await init();
  }
}



/* =================================================
   7️⃣ Weekly Report Progress
================================================= */

function renderWeeklyProgress() {
  const reportDaysEl = document.getElementById("reportDays");
  const progressFill = document.getElementById("progressFill");

  if (!reports.length) {
    if (reportDaysEl) reportDaysEl.textContent = "0";
    if (progressFill) progressFill.style.width = "0%";
    return;
  }

  const latestReport =
    reports.sort((a, b) => new Date(b.date) - new Date(a.date))[0];

  const lastDate = new Date(latestReport.date);
  const now = new Date();

  const diffDays = Math.floor(
    (now - lastDate) / (1000 * 60 * 60 * 24)
  );

  if (reportDaysEl) reportDaysEl.textContent = diffDays;

  const percent = Math.min((diffDays / 7) * 100, 100);

  if (progressFill)
    progressFill.style.width = percent + "%";
}


/* =================================================
   8️⃣ Calendar
================================================= */

function getReportDates() {
  return reports
    .map(r => r.date)
    .filter(Boolean)
    .map(d => d.split("T")[0]);
}

function renderCalendar() {
  const grid = document.getElementById("calendarGrid");
  const title = document.getElementById("calendarTitle");
  if (!grid || !title) return;

  grid.innerHTML = "";

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const today = new Date();

  const monthNames = [
    "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
    "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"
  ];

  title.textContent = `${monthNames[month]} ${year}`;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth =
    new Date(year, month + 1, 0).getDate();

  const reportDates = getReportDates();

  const dayHeaders = ["อา","จ","อ","พ","พฤ","ศ","ส"];
  dayHeaders.forEach(d => {
    const el = document.createElement("div");
    el.className = "calendar-day-header";
    el.textContent = d;
    grid.appendChild(el);
  });

  for (let i = 0; i < firstDay; i++) {
    grid.appendChild(document.createElement("div"));
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateEl = document.createElement("div");
    dateEl.className = "calendar-day";
    dateEl.textContent = day;

    const dateStr =
      `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    if (reportDates.includes(dateStr))
      dateEl.classList.add("has-report");

    if (
      day === today.getDate() &&
      month === today.getMonth() &&
      year === today.getFullYear()
    ) {
      dateEl.classList.add("today");
    }

    grid.appendChild(dateEl);
  }
}

function prevMonth() {
  currentDate.setMonth(currentDate.getMonth() - 1);
  renderCalendar();
}

function nextMonth() {
  currentDate.setMonth(currentDate.getMonth() + 1);
  renderCalendar();
}


/* =================================================
   9️⃣ UI Controls
================================================= */

function toggleMenu() {
  document.querySelector(".menu")?.classList.toggle("show");
}

function toggleSidebar() {
  document.getElementById("sidebar")
    ?.classList.toggle("collapsed");
}

async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = "/pages/auth/login.html";
}


/* =================================================
   🔟 INIT
================================================= */

async function init() {

  // 1️⃣ ตรวจ session ก่อนเลย (บล็อกอย่างเดียว)
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = "/pages/auth/login.html";
    return;
  }

  // 2️⃣ ยิง query ทุกอันพร้อมกันเลย
  const [profileResult, reportsResult, claimsResult, storeResult] = await Promise.all([
    
    // โหลด profile (รวม role + area ในครั้งเดียว)
    supabaseClient
      .from("profiles")
      .select("display_name, username, role, area")
      .eq("id", session.user.id)
      .single(),

    // โหลด reports
    supabaseClient
      .from("reports")
      .select("*")
      .order("created_at", { ascending: false }),

    // โหลด claims
    supabaseClient
      .from("claims")
      .select("id"),

    // นับร้านค้า
    supabaseClient
      .from("shops")
      .select("*", { count: "exact", head: true })
      .eq("sale_id", session.user.id)
  ]);

  // 3️⃣ นำข้อมูลมาใส่ UI
  const profile = profileResult.data;
  reports = reportsResult.data || [];
  claims  = claimsResult.data  || [];
  const storeCount = storeResult.count ?? 0;

  const fullName = profile?.display_name || profile?.username || session.user.email;

  // อัพเดท UI ทีเดียว
  const userNameEl = document.getElementById("userName");
  const displayNameEl = document.getElementById("displayName");
  const userEmailEl = document.getElementById("userEmail");
  const userRoleEl = document.getElementById("userRole");
  const areaCountEl = document.getElementById("areaCount");
  const storeCountEl = document.getElementById("storeCount");
  const claimCountEl = document.getElementById("claimCount");

  if (userNameEl) userNameEl.textContent = fullName;
  if (displayNameEl) displayNameEl.textContent = fullName;
  if (userEmailEl) userEmailEl.textContent = session.user.email;
  if (userRoleEl) userRoleEl.textContent = profile?.role || "Sales Executive";
  if (areaCountEl) areaCountEl.textContent = profile?.area || "-";
  if (storeCountEl) storeCountEl.textContent = storeCount;
  if (claimCountEl) claimCountEl.textContent = claims.length;

  // Admin badge
  if (profile?.role === "admin") document.body.classList.add("is-admin");

  // 🆕 Manager Dashboard Button - แสดงเมื่อ role เป็น manager หรือ admin
  if (profile?.role === "manager" || profile?.role === "admin") {
    const managerBtn = document.getElementById("managerDashboardBtn");
    if (managerBtn) managerBtn.style.display = "block";
  }

  // 4️⃣ สร้าง currentUser object สำหรับ modules อื่นๆ
  const currentUser = {
    id: session.user.id,
    email: session.user.email,
    role: profile?.role || 'user',
    display_name: fullName
  };

  // เก็บไว้ใน window สำหรับ modules อื่นใช้
  window.currentUser = currentUser;

  // 5️⃣ Render UI
  initAvatarUpload();
  renderSummary();
  renderReportList();
  renderWeeklyProgress();
  renderCalendar();

  // 6️⃣ ⭐ เรียก AnnouncementsModule.init() ⭐
  // if (typeof AnnouncementsModule !== 'undefined') {

  console.log("🔍 Checking AnnouncementsModule:", typeof AnnouncementsModule);
if (typeof AnnouncementsModule !== 'undefined') {

  
    try {
      await AnnouncementsModule.init(currentUser);
      console.log("✅ AnnouncementsModule initialized");
    } catch (err) {
      console.error("❌ AnnouncementsModule init error:", err);
    }
  } else {
    console.warn("⚠️ AnnouncementsModule not loaded");
  }
}

/* =================================================
   📷 Avatar Upload
================================================= */

function initAvatarUpload() {

  const uploadInput = document.getElementById("uploadAvatar");
  const profileImage = document.getElementById("profileImage");
  const avatarWrapper = document.querySelector(".avatar-wrapper");

  if (!uploadInput || !profileImage || !avatarWrapper) return;

  avatarWrapper.addEventListener("click", () => {
    uploadInput.click();
  });

  uploadInput.addEventListener("change", function () {
    const file = this.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
      profileImage.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });

}


document.addEventListener("DOMContentLoaded", init);

console.log("Home loaded (Production Ready) 🚀");



/* =================================================
   🏪 Load Store Count (Dashboard Card)
   - นับจำนวนร้านค้าของ Sales ที่ login อยู่
================================================= */
async function loadStoreCount() {
  try {

    const { data: { user }, error: userError } =
      await supabaseClient.auth.getUser();

    if (userError) throw userError;
    if (!user) return;

    const { count, error } =
      await supabaseClient
        .from("shops")
        .select("*", { count: "exact", head: true })
        .eq("sale_id", user.id);

    if (error) throw error;

    const el = document.getElementById("storeCount");
    if (el) el.textContent = count ?? 0;

  } catch (err) {
    console.error("โหลดจำนวนร้านไม่สำเร็จ:", err.message);
    const el = document.getElementById("storeCount");
    if (el) el.textContent = 0;
  }
}