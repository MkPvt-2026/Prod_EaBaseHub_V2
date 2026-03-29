// =====================================================
// shopDetailService.js
// จัดการ CRUD ของ shop_details + upload รูปภาพ
// =====================================================

const BUCKET = "shop-images";
// SHIPPING_OPTIONS อยู่ใน shopUser.js เพื่อไม่ให้ชนกับ const ใน global scope

// =====================================================
// 📥 โหลด shop_details ของร้านที่เลือก
// =====================================================
async function loadShopDetail(shopId) {
  const { data, error } = await supabaseClient
    .from("shop_details")
    .select("*")
    .eq("shop_id", shopId)
    .maybeSingle(); // null ถ้าไม่มีข้อมูล — ไม่ throw error

  if (error) {
    console.error("loadShopDetail error:", error);
    return null;
  }

  return data; // null = ยังไม่เคยกรอก
}

// =====================================================
// 💾 บันทึก shop_details (upsert)
// =====================================================
async function saveShopDetail(shopId, userId, formData) {
  const payload = {
    shop_id:      shopId,
    address:      formData.address      || null,
    maps_url:     formData.maps_url     || null,
    phone:        formData.phone        || null,
    contact_name: formData.contact_name || null,
    line_id:      formData.line_id      || null,
    shipping:     formData.shipping     || [],
    note:         formData.note         || null,
    updated_by:   userId,
  };

  const { data, error } = await supabaseClient
    .from("shop_details")
    .upsert(payload, { onConflict: "shop_id" })
    .select()
    .single();

  if (error) {
    console.error("saveShopDetail error:", error);
    throw error;
  }

  return data;
}

// =====================================================
// 📸 Upload รูปภาพ → Supabase Storage
// =====================================================
async function uploadShopImage(shopId, file) {
  const ext  = file.name.split(".").pop();
  const path = `${shopId}/${Date.now()}.${ext}`;

  const { error: uploadError } = await supabaseClient.storage
    .from(BUCKET)
    .upload(path, file, { upsert: false });

  if (uploadError) {
    console.error("uploadShopImage error:", uploadError);
    throw uploadError;
  }

  return path; // เก็บ path ไว้ใน images[]
}

// =====================================================
// 🔗 ดึง signed URL สำหรับแสดงรูป
// =====================================================
async function getImageUrl(path) {
  const { data, error } = await supabaseClient.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60); // หมดอายุ 1 ชั่วโมง

  if (error) return null;
  return data.signedUrl;
}

// =====================================================
// 🗑️ ลบรูปภาพ
// =====================================================
async function deleteShopImage(shopId, path, currentImages) {
  // ลบจาก Storage
  const { error: storageError } = await supabaseClient.storage
    .from(BUCKET)
    .remove([path]);

  if (storageError) {
    console.error("deleteShopImage storage error:", storageError);
    throw storageError;
  }

  // อัปเดต images[] ใน shop_details
  const newImages = currentImages.filter((p) => p !== path);

  const { error: dbError } = await supabaseClient
    .from("shop_details")
    .update({ images: newImages })
    .eq("shop_id", shopId);

  if (dbError) {
    console.error("deleteShopImage db error:", dbError);
    throw dbError;
  }

  return newImages;
}

// =====================================================
// ➕ เพิ่ม path รูปเข้า images[] ใน shop_details
// =====================================================
async function appendShopImage(shopId, newPath, currentImages) {
  const updated = [...(currentImages || []), newPath];

  const { error } = await supabaseClient
    .from("shop_details")
    .upsert({ shop_id: shopId, images: updated }, { onConflict: "shop_id" });

  if (error) {
    console.error("appendShopImage error:", error);
    throw error;
  }

  return updated;
}