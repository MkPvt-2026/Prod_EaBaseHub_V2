// =====================================================
// shopUser.js — หน้ารายชื่อร้าน (ตารางเต็มหน้า)
// =====================================================

async function waitForAppReady(maxMs = 5000) {
  const start = Date.now();
  while (typeof supabaseClient === "undefined") {
    if (Date.now() - start > maxMs) throw new Error("Supabase ยังไม่โหลด");
    await new Promise((r) => setTimeout(r, 100));
  }
}

// =====================================================
// 👤 โหลด user + ชื่อจาก profiles
// =====================================================
async function getUser() {
  if (typeof getCurrentUser === "function") {
    const user = await getCurrentUser();
    if (user) return user;
  }
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) {
    window.location.href = "/login.html";
    return null;
  }
  return user;
}

async function loadUserName(userId) {
  const nameEl = document.getElementById("userName");
  if (!nameEl) return;

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .single();

  if (!error && data?.display_name) {
    nameEl.textContent = data.display_name;
  } else {
    // fallback → email
    const { data: { user } } = await supabaseClient.auth.getUser();
    nameEl.textContent = user?.email || "ไม่ทราบชื่อ";
  }
}

// =====================================================
// 🏪 โหลดรายชื่อร้าน
// =====================================================
async function loadShops(user) {
  const { data, error } = await supabaseClient
    .from("shops")
    .select("*")
    .eq("sale_id", user.id)
    .order("shop_name");

  if (error) { console.error(error); return; }

  const tbody  = document.getElementById("shopTableBody");
  const counter = document.getElementById("shopCount");
  if (!tbody) return;

  tbody.innerHTML = "";
  if (counter) counter.textContent = (data?.length ?? 0) + " ร้าน";

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="table-placeholder">ไม่พบร้านค้า</td></tr>`;
    return;
  }

  data.forEach((shop) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="code-badge">${shop.shop_code || "-"}</span></td>
      <td class="shop-name-cell">${shop.shop_name}</td>
      <td>${shop.province || "-"}</td>
      <td><span class="go-btn">ดูข้อมูล →</span></td>
    `;
    tr.addEventListener("click", () => {
      window.location.href = `/pages/forms/shopDetail.html?id=${shop.id}`;
    });
    tbody.appendChild(tr);
  });
}

// =====================================================
// 🔍 Search
// =====================================================
function initSearch() {
  const el = document.getElementById("searchInput");
  if (!el) return;
  el.addEventListener("input", (e) => {
    const kw = e.target.value.toLowerCase();
    document.querySelectorAll("#shopTableBody tr").forEach((tr) => {
      tr.style.display = tr.innerText.toLowerCase().includes(kw) ? "" : "none";
    });
  });
}

// =====================================================
// 🎯 INIT
// =====================================================
async function init() {
  try {
    await waitForAppReady();
    const user = await getUser();
    if (!user) return;

    // โหลดชื่อและร้านพร้อมกัน
    await Promise.all([
      loadUserName(user.id),
      loadShops(user),
    ]);

    initSearch();
  } catch (err) {
    console.error(err);
    alert("โหลดไม่สำเร็จ: " + err.message);
  }
}

init();