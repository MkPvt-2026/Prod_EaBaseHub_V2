let allClaims = [];
let current = null;
let currentTab = "pending";

// INIT
document.addEventListener("DOMContentLoaded", async () => {
  await protectPage(["admin","adminQc","manager","executive"]);

  loadData();
  setupTabs();
});

// LOAD DATA
async function loadData() {
  const { data, error } = await supabaseClient
    .from("claims")
    .select("*")
    .eq("qc_status", "approved");

  if (error) {
    alert(error.message);
    return;
  }

  allClaims = data;
  render();
}

// RENDER TABLE
function render() {
  const tbody = document.getElementById("tableBody");

  const filtered = allClaims.filter(c => {
    if (currentTab === "pending") return c.exec_status === "pending";
    if (currentTab === "approved") return c.exec_status === "approved";
    if (currentTab === "rejected") return c.exec_status === "rejected";
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6">ไม่มีข้อมูล</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(c => `
    <tr onclick="openModal('${c.id}')">
      <td>${formatDate(c.claim_date)}</td>
      <td>${c.product}</td>
      <td>${c.customer}</td>
      <td>${c.qc_comment || '-'}</td>
      <td>${c.exec_status || 'pending'}</td>
      <td><button onclick="event.stopPropagation(); openModal('${c.id}')">ดู</button></td>
    </tr>
  `).join("");
}

// MODAL
function openModal(id) {
  current = allClaims.find(c => c.id === id);

  document.getElementById("modal").classList.add("open");

  document.getElementById("modalBody").innerHTML = `
    <p><b>สินค้า:</b> ${current.product}</p>
    <p><b>ร้าน:</b> ${current.customer}</p>
    <p><b>QC:</b> ${current.qc_comment || '-'}</p>
    <p><b>รายละเอียด:</b> ${current.detail || '-'}</p>
  `;
}

function closeModal() {
  document.getElementById("modal").classList.remove("open");
}

// UPDATE EXEC
async function updateExec(status) {
  if (!current) return;

  const { error } = await supabaseClient
    .from("claims")
    .update({
      exec_status: status,
      updated_at: new Date().toISOString()
    })
    .eq("id", current.id);

  if (error) {
    alert(error.message);
    return;
  }

  closeModal();
  loadData();
}

// TABS
function setupTabs() {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");

      currentTab = tab.dataset.tab;
      render();
    };
  });
}

// UTIL
function formatDate(d) {
  if (!d) return "-";
  const date = new Date(d);
  return date.toLocaleDateString("th-TH");
}