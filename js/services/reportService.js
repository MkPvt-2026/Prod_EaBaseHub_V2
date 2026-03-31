// =====================================================
// reportService.js
// =====================================================

async function fetchReports() {

  const { data, error } = await supabaseClient
    .from("reports")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return data || [];

}


async function createReport(reportData) {

  const { error } = await supabaseClient
    .from("reports")
    .insert([reportData]);

  if (error) throw error;

}


async function updateReport(id, updates) {

  const { error } = await supabaseClient
    .from("reports")
    .update(updates)
    .eq("id", id);

  if (error) throw error;

}


async function deleteReport(id) {

  const { error } = await supabaseClient
    .from("reports")
    .delete()
    .eq("id", id);

  if (error) throw error;

}