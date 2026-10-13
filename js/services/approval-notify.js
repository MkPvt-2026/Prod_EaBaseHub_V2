// =====================================================
// approval-notify.js — แจ้งเตือนงานอนุมัติ (ตาราง notifications · หน้า /pages/components/notifications.html)
//
// ใช้กับ: ราคาพิเศษ · วงเงินชั่วคราว · เปิดร้านค้าใหม่
//   เซลล์ส่งคำขอ            → Manager ของเซลล์ (profiles.manager_id) ได้แจ้งเตือน
//   ผลพิจารณา / ส่งกลับแก้ไข → เซลล์ผู้ขอได้แจ้งเตือน (กดแล้วไปหน้าคำขอของตัวเอง)
// แจ้งเตือนเป็น "งานเสริม": ส่งไม่สำเร็จ (เช่น RLS ไม่อนุญาต) จะไม่ทำให้การบันทึกหลักล้ม — แค่ log ไว้
// ⚠️ ต้องเปิด RLS ให้ผู้ใช้ที่ล็อกอิน insert แถวให้ผู้อื่นได้ (ดู CHANGELOG รอบ 49)
// =====================================================
(function () {
  "use strict";

  const PAGE_OF = {
    special_price: { sale: "/pages/forms/special-price-sale.html", manager: "/pages/forms/special-price-manager-doc.html?id=", label: "ราคาพิเศษ" },
    credit_limit_temp: { sale: "/pages/forms/credit-limit-sale.html", manager: null, label: "วงเงินชั่วคราว" }, // หน้า Manager ของวงเงินยังเป็นหน้าตัวอย่าง → ยังไม่ใส่ลิงก์
    new_area_shop: { sale: "/pages/forms/new-shop-sale.html", manager: "/pages/forms/new-shop-manager-doc.html?id=", label: "เปิดร้านค้าใหม่" },
  };
  const normType = (t) => (["temporary_credit_limit", "credit_limit", "credit_limit_temp", "temp_credit_limit"].includes(t) ? "credit_limit_temp" : t);

  async function myId() {
    try {
      if (window.currentUser?.id) return window.currentUser.id;
      if (typeof eaGetMyProfile === "function") return (await eaGetMyProfile()).session?.user?.id || null;
      const { data } = await supabaseClient.auth.getSession();
      return data?.session?.user?.id || null;
    } catch (e) { return null; }
  }

  /**
   * ส่งแจ้งเตือน (ไม่ throw)
   * @param {string|string[]} userIds
   * @param {{type:string,title:string,message:string,link?:string}} n
   */
  async function eaNotify(userIds, n) {
    try {
      if (typeof supabaseClient === "undefined") return;
      const me = await myId();
      const ids = [...new Set([].concat(userIds || []).filter((x) => x && x !== me))];
      if (!ids.length) return;
      const rows = ids.map((uid) => ({ user_id: uid, type: n.type || "approval", title: n.title, message: n.message || "", link: n.link || null, is_read: false }));
      let { error } = await supabaseClient.from("notifications").insert(rows);
      if (error && /link/i.test(error.message || "")) { // ตารางยังไม่มีคอลัมน์ link → ส่งแบบไม่มีลิงก์
        ({ error } = await supabaseClient.from("notifications").insert(rows.map(({ link, ...r }) => r)));
      }
      if (error) console.warn("eaNotify:", error.message);
    } catch (e) { console.warn("eaNotify:", e.message || e); }
  }

  // Manager ของพนักงาน (profiles.manager_id)
  async function managerOf(userId) {
    if (!userId) return null;
    try {
      const { data } = await supabaseClient.from("profiles").select("manager_id").eq("id", userId).maybeSingle();
      return data?.manager_id || null;
    } catch (e) { return null; }
  }

  /** เซลล์ส่งคำขอ (หรือส่งใหม่หลังแก้ไข) → แจ้ง Manager ของเซลล์ */
  async function notifyNewRequest({ type, id, requesterId, requesterName, shopName, resubmit, toManager }) {
    const t = PAGE_OF[normType(type)];
    if (!t) return;
    const mgr = toManager || (await managerOf(requesterId));
    if (!mgr) return;
    await eaNotify(mgr, {
      type: "approval_new",
      title: `${resubmit ? "แก้ไขแล้วส่งใหม่" : "คำขอใหม่"} · ${t.label}`,
      message: `${requesterName || "เซลล์"} · ${shopName || "-"} — รอคุณพิจารณา`,
      link: id && t.manager ? t.manager + encodeURIComponent(id) : null,
    });
  }

  /** ผลพิจารณา → แจ้งเซลล์ผู้ขอ · decision: approved | rejected | request_more_info | forwarded | revision | shop_created */
  async function notifyDecision({ type, requesterId, shopName, decision, by, comment, extra }) {
    const t = PAGE_OF[normType(type)];
    if (!t || !requesterId) return;
    const word = {
      approved: "อนุมัติแล้ว ✅", rejected: "ไม่อนุมัติ", request_more_info: "ขอข้อมูลเพิ่ม — กรุณาแก้ไขแล้วส่งใหม่",
      forwarded: "ผ่านแล้ว ส่งต่อขั้นถัดไป", revision: "ส่งกลับให้แก้ไข", shop_created: "เปิดร้านในระบบแล้ว",
    }[decision] || decision;
    const kind = { approved: "approval_ok", shop_created: "approval_ok", rejected: "approval_bad", request_more_info: "approval_info", revision: "approval_info" }[decision] || "approval";
    await eaNotify(requesterId, {
      type: kind,
      title: `${t.label} · ${shopName || "-"}: ${word}`,
      message: [by ? `โดย ${by}` : "", comment ? `“${comment}”` : "", extra || ""].filter(Boolean).join(" · "),
      link: t.sale,
    });
  }

  window.eaNotify = eaNotify;
  window.eaApprovalNotify = { notifyNewRequest, notifyDecision, managerOf };
})();
