// ===============================
// อ่าน id จาก URL
// ===============================
const params = new URLSearchParams(window.location.search);
const userId = params.get("id");

if (!userId) {
  alert("ไม่พบผู้ใช้");
  window.location.href = "admintor.html";
}

// ===============================
// Load User Data
// ===============================
async function loadUser() {

  const { data, error } =
    await supabaseClient
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

  if (error || !data) {
    console.error("Load error:", error);
    alert("โหลดข้อมูลไม่สำเร็จ");
    return;
  }

  document.getElementById("email").value = data.email || "";
  document.getElementById("username").value = data.username || "";
  document.getElementById("displayName").value = data.display_name || "";
  document.getElementById("area").value = data.area || "";
  document.getElementById("role").value = data.role || "user";
  document.getElementById("status").value = data.status || "Active";
}


// ===============================
// Save
// ===============================
async function saveUser() {

  const { error } =
    await supabaseClient
      .from("profiles")
      .update({
        display_name: document.getElementById("displayName").value,
        area: document.getElementById("area").value,
        role: document.getElementById("role").value,
        status: document.getElementById("status").value
      })
      .eq("id", userId);

  if (error) {
    console.error("Update error:", error);
    alert("บันทึกไม่สำเร็จ: " + error.message);
    return;
  }

  alert("บันทึกสำเร็จ");
  window.location.href = "admintor.html";
}


window.addEventListener("load", async () => {
  await protectAdmin();
  await loadUser();
});

