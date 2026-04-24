/*************************************************
 * HOME.JS (Production Ready - Fixed)
 * ------------------------------------------------
 * - Protect page (Supabase session)
 * - Load data from Supabase
 * - Render Dashboard summary
 * - Render My Reports list
 * - Weekly report progress
 * - Dynamic calendar
 * - UI controls (menu / sidebar)
 *************************************************/

/* =================================================
   1️⃣ Utilities
================================================= */

function getStorageArray(key) {
  try {
    const data = JSON.parse(localStorage.getItem(key));
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn("Storage error:", key);
    return [];
  }
}

function formatDate(date) {
  return date.toISOString().split("T")[0];
}

/* =================================================
   2️⃣ Global State
================================================= */

let reports = [];
let areas = [];
let claims = [];

let currentDate = new Date();

/* =================================================
   3️⃣ Notifications Helpers
================================================= */

/**
 * สร้าง notification ลงตาราง notifications
 * มีการตรวจ duplicate ก่อนสร้าง
 */
async function createNotification(userId, type, title, message) {
  try {
    const isDup = await isDuplicate(type, userId);
    if (isDup) return; // ไม่สร้างซ้ำ

    await supabaseClient.from("notifications").insert([
      { user_id: userId, type, title, message },
    ]);
  } catch (err) {
    console.error("createNotification error:", err);
  }
}

/**
 * ตรวจว่ามี notification ประเภทนี้ที่ยังไม่อ่านอยู่แล้วหรือไม่
 */
async function isDuplicate(type, userId) {
  try {
    const { data, error } = await supabaseClient
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("type", type)
      .eq("is_read", false);

    if (error) throw error;
    return data && data.length > 0;
  } catch (err) {
    console.error("isDuplicate error:", err);
    return false;
  }
}

/* =================================================
   4️⃣ Load Data
================================================= */

async function loadData() {
  const {
    data: { user },
  } = await supabaseClient.auth.getUser();
  if (!user) return;

  const { data: reportData, error: reportError } = await supabaseClient
    .from("reports")
    .select("*")
    .eq("sale_id", user.id)
    .order("created_at", { ascending: false });

  if (reportError) {
    console.error("โหลด reports ไม่ได้:", reportError.message);
  }

  const { data: claimData, error: claimError } = await supabaseClient
    .from("claims")
    .select("*");

  if (claimError) {
    console.error("โหลด claims ไม่ได้:", claimError.message);
  }

  reports = reportData || [];
  claims = claimData || [];

  if (reports.length > 0) {
    console.log("📋 Report columns:", Object.keys(reports[0]));
  }
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

  const items = reports.map((r) => ({
    type: "report",
    title: r.title || "รายงาน (ยังไม่ตั้งชื่อ)",
    date: r.report_date,
    link: `report.html?id=${r.id}`,
    id: r.id,
  }));

  if (!items.length) {
    listEl.innerHTML = `<p style="color:#999">ยังไม่มีข้อมูล</p>`;
    return;
  }

  items
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .forEach((item) => {
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
    type === "report" ? "reports" : type === "trip" ? "trips" : "claims";

  const { error } = await supabaseClient.from(table).delete().eq("id", id);

  if (error) {
    console.error("ลบไม่สำเร็จ:", error);
  } else {
    await init();
  }
}

/* =================================================
   7️⃣ Weekly Report Progress
   แก้ไข: ใช้ report_date แทน date
================================================= */

function renderWeeklyProgress() {
  const reportDaysEl = document.getElementById("reportDays");
  const progressFill = document.getElementById("progressFill");

  if (!reports.length) {
    if (reportDaysEl) reportDaysEl.textContent = "0";
    if (progressFill) progressFill.style.width = "0%";
    return;
  }

  // ✅ แก้: ใช้ report_date แทน date
  const latestReport = [...reports].sort(
    (a, b) => new Date(b.report_date || b.created_at) - new Date(a.report_date || a.created_at)
  )[0];

  const lastDate = new Date(latestReport.report_date || latestReport.created_at);
  const now = new Date();

  const diffDays = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));

  if (reportDaysEl) reportDaysEl.textContent = diffDays;

  const percent = Math.min((diffDays / 7) * 100, 100);
  if (progressFill) progressFill.style.width = percent + "%";
}

/* =================================================
   8️⃣ Calendar
================================================= */

function getReportDates() {
  return reports
    .map((r) => r.report_date)
    .filter(Boolean)
    .map((d) => d.split("T")[0]);
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
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน",
    "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม",
    "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
  ];

  title.textContent = `${monthNames[month]} ${year}`;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const reportDates = getReportDates();

  const dayHeaders = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
  dayHeaders.forEach((d) => {
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

    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    if (reportDates.includes(dateStr)) dateEl.classList.add("has-report");

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
  document.getElementById("sidebar")?.classList.toggle("collapsed");
}

async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = "/pages/auth/login.html";
}

/* =================================================
   🔟 INIT
================================================= */

// ✅ แบบใหม่ - รันพร้อมกัน (~200-300ms)
async function init() {
  const {
    data: { session },
  } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = "/pages/auth/login.html";
    return;
  }

  const [profileResult, reportsResult, claimsResult, storeResult] =
    await Promise.all([
      supabaseClient
        .from("profiles")
        .select("display_name, username, role, area")
        .eq("id", session.user.id)
        .single(),

      supabaseClient
        .from("reports")
        .select("*")
        .eq("sale_id", session.user.id)
        .order("created_at", { ascending: false }),

      supabaseClient.from("claims").select("id"),

      supabaseClient
        .from("shops")
        .select("*", { count: "exact", head: true })
        .eq("sale_id", session.user.id),
    ]);

  const profile = profileResult.data;
  reports = reportsResult.data || [];
  claims = claimsResult.data || [];
  const storeCount = storeResult.count ?? 0;

  const fullName =
    profile?.display_name || profile?.username || session.user.email;

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

  if (profile?.role === "admin") document.body.classList.add("is-admin");

  if (profile?.role === "manager" || profile?.role === "admin") {
    const managerBtn = document.getElementById("managerDashboardBtn");
    if (managerBtn) managerBtn.style.display = "flex";
  }

  if (profile?.role === "admin") {
    const adminBtn = document.getElementById("adminDashboardBtn");
    if (adminBtn) adminBtn.style.display = "flex";
  }

  const currentUser = {
    id: session.user.id,
    email: session.user.email,
    role: profile?.role || "user",
    display_name: fullName,
  };

  window.currentUser = currentUser;

  initAvatarUpload();
  renderSummary();
  renderReportList();
  renderWeeklyProgress();
  renderCalendar();

  await checkNotifications(currentUser, profile);

  setupNotificationRealtime(currentUser.id);

  console.log("🔍 Checking AnnouncementsModule:", typeof AnnouncementsModule);
  if (typeof AnnouncementsModule !== "undefined") {
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

async function initAvatarUpload() {
  const uploadInput = document.getElementById("uploadAvatar");
  const profileImage = document.getElementById("profileImage");
  const avatarWrapper = document.querySelector(".avatar-wrapper");

  if (!uploadInput || !profileImage || !avatarWrapper) return;

  await loadCurrentAvatar(profileImage);

  avatarWrapper.addEventListener("click", () => {
    uploadInput.click();
  });

  uploadInput.addEventListener("change", async function () {
    const file = this.files[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("กรุณาเลือกไฟล์รูปภาพเท่านั้น");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      alert("ไฟล์ใหญ่เกินไป (ไม่เกิน 2MB)");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      profileImage.src = e.target.result;
    };
    reader.readAsDataURL(file);

    await uploadAvatar(file, profileImage, avatarWrapper);
  });
}

async function loadCurrentAvatar(imgElement) {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("avatar_url")
      .eq("id", user.id)
      .single();

    if (profile?.avatar_url) {
      imgElement.src = profile.avatar_url;
    }
  } catch (err) {
    console.error("โหลดรูปโปรไฟล์ไม่สำเร็จ:", err);
  }
}

async function uploadAvatar(file, imgElement, wrapperElement) {
  try {
    wrapperElement.classList.add("uploading");

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("ไม่พบ user");

    const fileExt = file.name.split(".").pop().toLowerCase();
    const fileName = `${user.id}-${Date.now()}.${fileExt}`;

    try {
      const { data: oldProfile } = await supabaseClient
        .from("profiles")
        .select("avatar_url")
        .eq("id", user.id)
        .single();

      if (oldProfile?.avatar_url) {
        const oldFileName = oldProfile.avatar_url.split("/").pop();
        if (oldFileName && !oldFileName.includes("default")) {
          await supabaseClient.storage.from("avatars").remove([oldFileName]);
        }
      }
    } catch (e) {
      console.log("ไม่มีรูปเก่าหรือลบไม่ได้:", e);
    }

    const { error: uploadError } = await supabaseClient.storage
      .from("avatars")
      .upload(fileName, file, { cacheControl: "3600", upsert: true });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabaseClient.storage
      .from("avatars")
      .getPublicUrl(fileName);

    const publicUrl = urlData.publicUrl;

    const { error: updateError } = await supabaseClient
      .from("profiles")
      .update({ avatar_url: publicUrl })
      .eq("id", user.id);

    if (updateError) throw updateError;

    imgElement.src = publicUrl + "?t=" + Date.now();
    console.log("✅ อัปโหลดรูปโปรไฟล์สำเร็จ");
  } catch (err) {
    console.error("❌ อัปโหลดรูปไม่สำเร็จ:", err);
    alert("อัปโหลดรูปไม่สำเร็จ: " + err.message);
  } finally {
    wrapperElement.classList.remove("uploading");
  }
}

/* =================================================
   🏪 Load Store Count
================================================= */

async function loadStoreCount() {
  try {
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError) throw userError;
    if (!user) return;

    const { count, error } = await supabaseClient
      .from("shops")
      .select("*", { count: "exact", head: true })
      .eq("sale_id", user.id);

    if (error) throw error;

    // แสดงผลใน card
    const el = document.getElementById("storeCount");
    if (el) el.textContent = count ?? 0;
  } catch (err) {
    console.error("โหลดจำนวนร้านไม่สำเร็จ:", err.message);
    const el = document.getElementById("storeCount");
    if (el) el.textContent = 0;
  }
}

/* =================================================
   Spinner + Loading State
================================================= */

function handleManagerClick(btn) {
  btn.classList.add("loading");
  setTimeout(() => goToManagerDashboard(), 500);
}

function handleAdminClick(btn) {
  btn.classList.add("loading");
  setTimeout(() => goToAdmin(), 500);
}

/* =================================================
   🔔 Check Notifications
================================================= */

async function checkNotifications(currentUser, profile) {
  if (!currentUser || !profile) {
    console.warn("checkNotifications: currentUser หรือ profile เป็น null");
    return;
  }

  let notificationCount = 0;
  const today = new Date();
  const isSaturday = today.getDay() === 6;

  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay() + 1); // วันจันทร์

  const end = new Date(start);
  end.setDate(start.getDate() + 6); // วันอาทิตย์

  const startStr = start.toISOString();
  const endStr = end.toISOString();

  const { data: weeklyReports } = await supabaseClient
    .from("reports")
    .select("*")
    .gte("created_at", startStr)
    .lte("created_at", endStr);

  const reportsData = weeklyReports || [];

  // =========================
  // 🟢 SALES
  // =========================
  if (currentUser.role === "sales") {
    const myReports = reportsData.filter((r) => r.sale_id === currentUser.id);
    const REQUIRED = 5;

    if (isSaturday && myReports.length < REQUIRED) {
      notificationCount++;
      showToast("⚠️ คุณยังส่งรายงานประจำสัปดาห์ไม่ครบ");

      await createNotification(
        currentUser.id,
        "missing_report",
        "ยังส่งรายงานไม่ครบ",
        "คุณยังส่งรายงานประจำสัปดาห์ไม่ครบ"
      );
    }
  }

  // =========================
  // 🔵 MANAGER
  // =========================
  if (currentUser.role === "manager") {
    const { data: team } = await supabaseClient
      .from("profiles")
      .select("id")
      .eq("manager_id", currentUser.id);

    const teamIds = (team || []).map((u) => u.id);

    const teamReports = reportsData.filter((r) => teamIds.includes(r.sale_id));
    const submittedIds = [...new Set(teamReports.map((r) => r.sale_id))];
    const missingUsers = teamIds.filter((id) => !submittedIds.includes(id));

    if (missingUsers.length > 0) {
      notificationCount += missingUsers.length;
      showToast(`⚠️ มี ${missingUsers.length} คน ยังไม่ส่งรายงาน`);

      await createNotification(
        currentUser.id,
        "team_missing",
        "ลูกทีมยังไม่ส่งรายงาน",
        `มี ${missingUsers.length} คน ยังไม่ส่งรายงาน`
      );
    }

    const unread = teamReports.filter((r) => !r.is_read);

    if (unread.length > 0) {
      notificationCount += unread.length;
      showToast(`📄 มีรายงานใหม่ ${unread.length} รายการ`);

      await createNotification(
        currentUser.id,
        "unread_report",
        "มีรายงานใหม่",
        `มีรายงานใหม่ ${unread.length} รายการ`
      );
    }
  }

  // ดึงจำนวน unread ทั้งหมดจาก database (รวม report_comment ด้วย)
  const dbUnreadCount = await loadUnreadNotificationCount();
  
  // ใช้จำนวนจาก DB เป็นหลัก (แม่นยำกว่า)
  updateNotificationUI(dbUnreadCount);
}

/* =================================================
   Toast
================================================= */

function showToast(message) {
  const div = document.createElement("div");
  div.className = "toast-notification";
  div.innerText = message;

  Object.assign(div.style, {
    position: "fixed",
    top: "20px",
    right: "20px",
    background: "#333",
    color: "#fff",
    padding: "10px 16px",
    borderRadius: "8px",
    zIndex: "9999",
    fontSize: "13px",
    animation: "slideIn 0.3s ease",
  });

  document.body.appendChild(div);

  setTimeout(() => {
    div.style.animation = "slideOut 0.3s ease";
    setTimeout(() => div.remove(), 300);
  }, 4000);
}

/* =================================================
   Update Notification Badge
================================================= */

function updateNotificationUI(count) {
  const badge = document.getElementById("notifyBadge");
  const number = document.getElementById("notificationCount");
  const card = document.querySelector(".mini-card.claim"); // ✅ เพิ่ม

  if (number) number.textContent = count;

  if (badge) {
    if (count > 0) {
      badge.style.display = "inline-flex";
      badge.textContent = count > 99 ? "99+" : count;
    } else {
      badge.style.display = "none";
    }
  }

  // ✅ เพิ่ม: toggle class has-unread ที่การ์ด
  if (card) {
    if (count > 0) {
      card.classList.add("has-unread");
    } else {
      card.classList.remove("has-unread");
    }
  }

  // ✅ เพิ่ม: เปลี่ยน favicon และ title เมื่อมีแจ้งเตือน
  updateDocumentTitle(count);
}

/* =================================================
   🔔 Update Document Title + Favicon
================================================= */
function updateDocumentTitle(count) {
  const baseTitle = "Home - EABaseHub";
  if (count > 0) {
    document.title = `(${count}) 🔔 ${baseTitle}`;
  } else {
    document.title = baseTitle;
  }
}

/* =================================================
   Navigation
================================================= */

function goToNotifications() {
  window.location.href = "/pages/components/notifications.html";
}

/* =================================================
   DOMContentLoaded
================================================= */

document.addEventListener("DOMContentLoaded", init);

console.log("Home loaded (Production Ready) 🚀");


/* =================================================
   🔔 Load Unread Notifications Count (จาก DB)
================================================= */
async function loadUnreadNotificationCount() {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return 0;

    const { count, error } = await supabaseClient
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_read", false);

    if (error) throw error;
    return count || 0;
  } catch (err) {
    console.error("โหลดจำนวนแจ้งเตือนไม่สำเร็จ:", err);
    return 0;
  }
}

/* =================================================
   🔔 Realtime Notification Badge
================================================= */
function setupNotificationRealtime(userId) {
  let isFirstLoad = true;

  supabaseClient
    .channel("home-notifications-" + userId)
    .on(
      "postgres_changes",
      {
        event: "INSERT",  // เฉพาะตอน insert ใหม่
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${userId}`
      },
      async (payload) => {
        const count = await loadUnreadNotificationCount();
        updateNotificationUI(count);

        // เล่นเสียง + toast เมื่อมีแจ้งเตือนใหม่ (ไม่ใช่ครั้งแรกโหลด)
        if (!isFirstLoad) {
          playNotificationSound();
          showToast("🔔 " + (payload.new.title || "มีแจ้งเตือนใหม่"));
        }
      }
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${userId}`
      },
      async () => {
        const count = await loadUnreadNotificationCount();
        updateNotificationUI(count);
      }
    )
    .subscribe(() => {
      setTimeout(() => { isFirstLoad = false; }, 2000);
    });
}

/* =================================================
   🔊 Notification Sound (ใช้ Web Audio API ไม่ต้องมีไฟล์)
================================================= */
function playNotificationSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    // เสียง 2 tone แบบ "ติ๊ง-ติ๊ง"
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    osc.stop(ctx.currentTime + 0.25);
  } catch (err) {
    console.log("ไม่สามารถเล่นเสียงได้:", err);
  }
}
