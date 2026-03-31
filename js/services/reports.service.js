// =====================================================
// reports.service.js
// ติดต่อ Supabase เท่านั้น (Data Layer)
// =====================================================


// ==============================
// ดึงรายงานทั้งหมด
// ==============================
async function fetchReports() {
  const { data, error } = await supabaseClient
    .from("reports")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}


// ==============================
// ดึงร้านค้าตาม id list
// ==============================
async function fetchShopsByIds(ids) {
  if (!ids.length) return [];

  const { data, error } = await supabaseClient
    .from("shops")
    .select("id, shop_name")
    .in("id", ids);

  if (error) throw error;
  return data || [];
}


// ==============================
// ดึงสินค้า
// ==============================
async function fetchProductsByIds(ids) {
  if (!ids.length) return [];

  const { data, error } = await supabaseClient
    .from("products")
    .select("id, name")
    .in("id", ids);

  if (error) throw error;
  return data || [];
}


// ==============================
// ดึง attribute name ตาม id
// ==============================
async function fetchAttributesByIds(ids) {
  if (!ids.length) return [];

  const { data, error } = await supabaseClient
    .from("attributes")
    .select("id, name")
    .in("id", ids);

  if (error) throw error;
  return data || [];
}


// ==============================
// บันทึกรายงาน
// ==============================
async function insertReport(reportData) {
  const { error } = await supabaseClient
    .from("reports")
    .insert([reportData]);

  if (error) throw error;
}


// ==============================
// ลบรายงาน
// ==============================
async function removeReport(id) {
  const { error } = await supabaseClient
    .from("reports")
    .delete()
    .eq("id", id);

  if (error) throw error;
}


// ==============================
// ดึงรายงานตาม id
// ==============================
async function getReportById(id) {
  const { data, error } = await supabaseClient
    .from("reports")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

// ==============================
// แก้ไขรายงาน
// ==============================
async function updateReport(id, payload) {
  const { error } = await supabaseClient
    .from("reports")
    .update(payload)
    .eq("id", id);

  if (error) throw error;
}