let currentUserId = null;
let realtimeChannel = null;

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
  // ถ้ามี link ตรงๆ ใช้เลย
  if (item.link) return item.link;

  // ถ้าไม่มี สร้างเองจาก type + post_id + comment_id
  if (item.post_id) {
    const base = `/post.html?id=${item.post_id}`;
    return item.comment_id ? `${base}#comment-${item.comment_id}` : base;
  }

  return null;
}

async function loadNotifications() {
  const container = document.getElementById("notificationList");

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

    renderNotifications(data || []);
    updateUnreadBadge(data || []);

    if (!realtimeChannel) setupRealtime(user.id);
  } catch (err) {
    console.error("โหลดแจ้งเตือนไม่สำเร็จ:", err);
    container.innerHTML = `<div class="notif-error">เกิดข้อผิดพลาด: ${escapeHtml(err.message)}</div>`;
  }
}

function renderNotifications(list) {
  const container = document.getElementById("notificationList");
  container.innerHTML = "";

  if (!list.length) {
    container.innerHTML = `<div class="notif-empty">ไม่มีแจ้งเตือน 🎉</div>`;
    return;
  }

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
          <div class="notif-time">${formatTime(item.created_at)}</div>
        </div>
      </div>
    `;

    div.addEventListener("click", async () => {
      // mark เป็นอ่านก่อน (ไม่ต้องรอ เพื่อให้เด้งเร็ว)
      if (!item.is_read) {
        markAsRead(item.id, false); // ไม่ต้อง reload
      }
      // เด้งไปหน้าเป้าหมาย
      if (link) {
        window.location.href = link;
      }
    });

    container.appendChild(div);
  });
}

function updateUnreadBadge(list) {
  const badge = document.getElementById("unreadBadge");
  const unread = list.filter(n => !n.is_read).length;
  if (unread > 0) {
    badge.textContent = unread;
    badge.style.display = "inline-block";
  } else {
    badge.style.display = "none";
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
    alert("ไม่สามารถอัปเดตได้");
  } finally {
    btn.disabled = false;
  }
}

function setupRealtime(userId) {
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
  if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
});

document.addEventListener("DOMContentLoaded", () => {
  loadNotifications();
  document.getElementById("markAllBtn").addEventListener("click", markAllAsRead);
  document.getElementById("refreshBtn").addEventListener("click", loadNotifications);
});