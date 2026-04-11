async function loadNotifications() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  // ดึง notification ของ user
  const { data, error } = await supabaseClient
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  renderNotifications(data || []);
}

function renderNotifications(list) {
  const container = document.getElementById("notificationList");
  container.innerHTML = "";

  if (!list.length) {
    container.innerHTML = "<p>ไม่มีแจ้งเตือน 🎉</p>";
    return;
  }

  list.forEach(item => {
    const div = document.createElement("div");

    div.style.padding = "12px";
    div.style.marginBottom = "10px";
    div.style.borderRadius = "10px";
    div.style.background = item.is_read ? "#f5f5f5" : "#fff3cd";

    div.innerHTML = `
      <div style="font-weight:600">${item.title}</div>
      <div style="font-size:13px">${item.message}</div>
      <div style="font-size:11px;color:#999">${new Date(item.created_at).toLocaleString()}</div>
    `;

    div.onclick = () => markAsRead(item.id);

    container.appendChild(div);
  });
}

// mark read
async function markAsRead(id) {
  await supabaseClient
    .from("notifications")
    .update({ is_read: true })
    .eq("id", id);

  loadNotifications();
}

document.addEventListener("DOMContentLoaded", loadNotifications);