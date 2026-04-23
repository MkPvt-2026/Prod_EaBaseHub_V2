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


let currentUserId = null;
let realtimeChannel = null;
let isLoading = false;

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTime(dateStr) {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "";
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "เมื่อสักครู่";
  if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ชั่วโมงที่แล้ว`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} วันที่แล้ว`;
  return date.toLocaleString("th-TH");
}

// icon ตามประเภทแจ้งเตือน
function getIcon(type) {
  const icons = {
    comment: "💬",
    reply: "↩️",
    like: "❤️",
    follow: "👤",
    mention: "@",
    general: "🔔"
  };
  return icons[type] || "🔔";
}

// สร้าง link จากข้อมูล notification
function buildLink(item) {
  if (item.link) return item.link;
  if (item.post_id) {
    const base = `/post.html?id=${encodeURIComponent(item.post_id)}`;
    return item.comment_id
      ? `${base}#comment-${encodeURIComponent(item.comment_id)}`
      : base;
  }
  return null;
}

async function loadNotifications() {
  if (isLoading) return;
  isLoading = true;

  const container = document.getElementById("notificationList");
  if (!container) {
    isLoading = false;
    return;
  }

  try {
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError) throw authError;
    if (!user) {
      container.innerHTML = `<div class="notif-error">กรุณาเข้าสู่ระบบก่อน</div>`;
      return;
    }
    currentUserId = user.id;

    const { data, error } = await supabaseClient
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    const list = data || [];
    renderNotifications(list);
    updateUnreadBadge(list);

    if (!realtimeChannel) setupRealtime(user.id);
  } catch (err) {
    console.error("โหลดแจ้งเตือนไม่สำเร็จ:", err);
    container.innerHTML = `<div class="notif-error">เกิดข้อผิดพลาด: ${escapeHtml(err.message)}</div>`;
  } finally {
    isLoading = false;
  }
}

function renderNotifications(list) {
  const container = document.getElementById("notificationList");
  if (!container) return;
  container.innerHTML = "";

  if (!list.length) {
    container.innerHTML = `<div class="notif-empty">ไม่มีแจ้งเตือน 🎉</div>`;
    return;
  }

  const frag = document.createDocumentFragment();

  list.forEach(item => {
    const div = document.createElement("div");
    div.className = `notif-item ${item.is_read ? "" : "unread"}`;
    div.dataset.id = item.id;

    const link = buildLink(item);
    const icon = getIcon(item.type);

    div.innerHTML = `
      <div class="notif-row">
        <div class="notif-icon">${icon}</div>
        <div class="notif-body">
          <div class="notif-title">${escapeHtml(item.title)}</div>
          <div class="notif-message">${escapeHtml(item.message)}</div>
          <div class="notif-time">${escapeHtml(formatTime(item.created_at))}</div>
        </div>
      </div>
    `;

    div.addEventListener("click", () => {
      // mark เป็นอ่านแบบ optimistic (ไม่ต้องรอ network)
      if (!item.is_read) {
        item.is_read = true;
        div.classList.remove("unread");
        markAsRead(item.id, false);
        // อัปเดต badge ทันที
        decrementUnreadBadge();
      }
      if (link) {
        window.location.href = link;
      }
    });

    frag.appendChild(div);
  });

  container.appendChild(frag);
}

function updateUnreadBadge(list) {
  const badge = document.getElementById("unreadBadge");
  if (!badge) return;
  const unread = list.filter(n => !n.is_read).length;
  if (unread > 0) {
    badge.textContent = unread > 99 ? "99+" : unread;
    badge.style.display = "inline-block";
  } else {
    badge.style.display = "none";
  }
}

function decrementUnreadBadge() {
  const badge = document.getElementById("unreadBadge");
  if (!badge || badge.style.display === "none") return;
  const current = parseInt(badge.textContent, 10);
  if (isNaN(current) || current <= 1) {
    badge.style.display = "none";
    badge.textContent = "0";
  } else {
    badge.textContent = current - 1;
  }
}

async function markAsRead(id, reload = true) {
  try {
    const { error } = await supabaseClient
      .from("notifications")
      .update({ is_read: true })
      .eq("id", id)
      .eq("user_id", currentUserId);
    if (error) throw error;
    if (reload) await loadNotifications();
  } catch (err) {
    console.error("อัปเดตสถานะไม่สำเร็จ:", err);
  }
}

async function markAllAsRead() {
  const btn = document.getElementById("markAllBtn");
  if (!btn || !currentUserId) return;

  btn.disabled = true;
  try {
    const { error } = await supabaseClient
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", currentUserId)
      .eq("is_read", false);
    if (error) throw error;
    await loadNotifications();
  } catch (err) {
    console.error("อัปเดตทั้งหมดไม่สำเร็จ:", err);
    const container = document.getElementById("notificationList");
    if (container) {
      const errDiv = document.createElement("div");
      errDiv.className = "notif-error";
      errDiv.textContent = "ไม่สามารถอัปเดตได้: " + err.message;
      container.prepend(errDiv);
      setTimeout(() => errDiv.remove(), 4000);
    }
  } finally {
    btn.disabled = false;
  }
}

function setupRealtime(userId) {
  // กัน channel ซ้อน
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  realtimeChannel = supabaseClient
    .channel("notifications-" + userId)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${userId}`
      },
      () => loadNotifications()
    )
    .subscribe();
}

window.addEventListener("beforeunload", () => {
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
});

document.addEventListener("DOMContentLoaded", () => {
  loadNotifications();

  const markAllBtn = document.getElementById("markAllBtn");
  const refreshBtn = document.getElementById("refreshBtn");
  const backBtn = document.getElementById("backBtn");

  if (markAllBtn) markAllBtn.addEventListener("click", markAllAsRead);
  if (refreshBtn) refreshBtn.addEventListener("click", loadNotifications);
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      if (document.referrer && document.referrer !== window.location.href) {
        history.back();
      } else {
        window.location.href = "/index.html";
      }
    });
  }
});