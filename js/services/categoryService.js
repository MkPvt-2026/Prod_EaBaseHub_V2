// =====================================================
// categoryService.js
// =====================================================

async function loadCategories(selectId = "categorySelect") {

  const categorySelect = document.getElementById(selectId);

  if (!categorySelect) return;

  try {

    const { data, error } = await supabaseClient
      .from("categories")
      .select("id, name")
      .order("name");

    if (error) throw error;

    categorySelect.innerHTML = `<option value="">-- เลือกหมวดสินค้า --</option>`;

    data?.forEach(cat => {

      const option = document.createElement("option");

      option.value = cat.id;
      option.textContent = cat.name;

      categorySelect.appendChild(option);

    });

    console.log("✅ Categories loaded");

  } catch (err) {

    console.error("❌ loadCategories error:", err);

  }

}