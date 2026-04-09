let allClaims = [];
let current = null;



// INIT
document.addEventListener("DOMContentLoaded", async () => {
  await protectPage(["admin","adminQc"]);

  loadData();

  document.getElementById("searchInput").addEventListener("input", render);
});

// LOAD DATA
async function loadData() {
  const { data, error } = await supabaseClient
    .from("claims")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    alert(error.message);
    return;
  }

  allClaims = data;
  render();
}

// RENDER TABLE
function render() {
  const keyword = document.getElementById("searchInput").value.toLowerCase();
  const statusFilter = document.getElementById("filterStatus").value;

  let filtered = allClaims.filter(c => {
    const matchText =
      c.product?.toLowerCase().includes(keyword) ||
      c.customer?.toLowerCase().includes(keyword);

    const matchStatus =
      !statusFilter ||
      (statusFilter === "checked" && c.qc_checked_at) ||
      (statusFilter === "pending" && !c.qc_checked_at);

    return matchText && matchStatus;
  });

  // 📊 SUMMARY
  document.getElementById("sumTotal").innerText = allClaims.length;
  document.getElementById("sumPending").innerText =
    allClaims.filter(c => !c.qc_checked_at).length;
  document.getElementById("sumChecked").innerText =
    allClaims.filter(c => c.qc_checked_at).length;

  const tbody = document.getElementById("qcTableBody");

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5">ไม่มีข้อมูล</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(c => `
    <tr onclick="openModal('${c.id}')">
      <td>${formatDate(c.claim_date)}</td>
      <td>${c.product}</td>
      <td>${c.customer}</td>
      <td>
        ${
          c.qc_checked_at
            ? `<span class="badge checked">ตรวจแล้ว</span>`
            : `<span class="badge pending">รอตรวจ</span>`
        }
      </td>
      <td>
        <button onclick="event.stopPropagation(); openModal('${c.id}')">
          ดู
        </button>
      </td>
    </tr>
  `).join("");
}

// OPEN MODAL
function openModal(id) {
  current = allClaims.find(c => c.id === id);

  document.getElementById("qcModal").classList.add("open");

  document.getElementById("modalTitle").innerText =
    "เคลม #" + current.id.substring(0,8);

  // INFO GRID
  document.getElementById("modalInfoGrid").innerHTML = `
    <div class="info-item"><b>พนักงาน</b><br>${current.emp_name || "-"}</div>
    <div class="info-item"><b>เขต</b><br>${current.area || "-"}</div>
    <div class="info-item"><b>ร้าน</b><br>${current.customer || "-"}</div>
    <div class="info-item"><b>สินค้า</b><br>${current.product || "-"}</div>
    <div class="info-item"><b>จำนวน</b><br>${current.qty || "-"}</div>
    <div class="info-item"><b>วันที่</b><br>${formatDate(current.claim_date)}</div>
  `;

  // TYPES
  document.getElementById("modalTypes").innerHTML =
    (current.claim_types || []).map(t => `<span class="tag">${t}</span>`).join("");

  // DETAIL
  document.getElementById("modalDetail").innerText =
    current.detail || "-";

  // MEDIA
  document.getElementById("modalMedia").innerHTML =
    (current.media_urls || []).map(url => `
      <img src="${url}" onclick="window.open('${url}')">
    `).join("");

  // QC STATUS
  document.getElementById("qcStatus").innerHTML =
    current.qc_checked_at
      ? "✅ ตรวจแล้ว"
      : "🟡 ยังไม่ได้ตรวจ";

  // document.getElementById("qcComment").value =
  //   current.qc_comment || "";
}

let qc = {};
try {
  qc = JSON.parse(current.qc_comment || "{}");
} catch {}

document.getElementById("qcProductType").value = qc.productType || "";
document.getElementById("qcIssueType").value = qc.issueType || "";
document.getElementById("qcAction").value = qc.action || "";
document.getElementById("qcSummary").value = qc.summary || "";
document.getElementById("qcNote").value = qc.note || "";



// CLOSE MODAL
function closeModal() {
  document.getElementById("qcModal").classList.remove("open");
}

// SAVE QC
async function saveQc() {
  if (!current) return;

  const data = {
    productType: document.getElementById("qcProductType").value,
    issueType: document.getElementById("qcIssueType").value,
    action: document.getElementById("qcAction").value,
    summary: document.getElementById("qcSummary").value,
    note: document.getElementById("qcNote").value
  };

  const { error } = await supabaseClient
    .from("claims")
    .update({
      qc_comment: JSON.stringify(data),
      qc_checked_at: new Date().toISOString()
    })
    .eq("id", current.id);

  if (error) {
    alert("บันทึกไม่สำเร็จ");
    return;
  }

  alert("บันทึกผล QC แล้ว");
  closeModal();
  loadData();
}

// EXPORT
function exportExcel() {
  if (allClaims.length === 0) return;

  const rows = [["สินค้า","ร้าน","สถานะ"]];

  allClaims.forEach(c => {
    rows.push([
      c.product,
      c.customer,
      c.qc_checked_at ? "ตรวจแล้ว" : "รอตรวจ"
    ]);
  });

  const csv = rows.map(r => r.join(",")).join("\n");

  const blob = new Blob([csv]);
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "qc_export.csv";
  a.click();
}

// UTIL
function formatDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("th-TH");
}