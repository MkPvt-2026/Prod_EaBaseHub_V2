// =====================================================
// shopService.js
// =====================================================

window.shopsMap = {};

async function loadShops(selectId = "shopSelect") {

  const shopSelect = document.getElementById(selectId);
  if (!shopSelect) return;

  try {

    const { data, error } = await supabaseClient
      .from("shops")
      .select("id, shop_name")
      .eq("status", "Active")
      .order("shop_name");

    if (error) throw error;

    shopsMap = Object.fromEntries((data || []).map(s => [s.id, s.shop_name]));

    shopSelect.innerHTML = `<option value="">-- เลือกร้านค้า --</option>`;

    data?.forEach(shop => {

      const option = document.createElement("option");

      option.value = shop.id;
      option.textContent = shop.shop_name;

      shopSelect.appendChild(option);

    });

    console.log("✅ Shops loaded");

  } catch (err) {

    console.error("❌ loadShops error:", err);

  }

}

function getShopName(id) {

  return shopsMap[id] || "-";

}