// ============================================================
// executive-rules.js — กฎงานอนุมัติของผู้บริหาร (ใช้ร่วม: หน้าหลัก / ภาพรวม)
// ต้องตรงกับ executive-Approval.js (isVisibleToExecutive / getApprovalStatus)
//   - ราคาพิเศษ / เปิดร้านค้าใหม่: ต้องผ่าน Manager (payload.manager.decision = approved) ก่อน
//   - วงเงินชั่วคราว: บัญชี → Manager → ผู้บริหาร (status = executive_review)
//   - เคลมระบบเดิม: claims.qc_status = waiting_ceo
// ============================================================

const EXEC_TYPE = {
  temp_credit_limit: { label: "วงเงินชั่วคราว", icon: "account_balance_wallet", cls: "t-credit" },
  special_price: { label: "ราคาพิเศษ", icon: "sell", cls: "t-price" },
  claim: { label: "เคลมสินค้า", icon: "inventory_2", cls: "t-claim" },
  promotion: { label: "โปรโมชั่น", icon: "campaign", cls: "t-promo" },
  new_area_shop: { label: "เปิดร้านค้าใหม่", icon: "add_business", cls: "t-shop" },
};
const EXEC_PENDING = ["pending", "waiting_ceo", "executive_review"];

// ============================================================
// ⚡ โหลดรายการแบบ "เบา" — ไม่ดึงลายเซ็น (รูป base64 ใหญ่ ทั้งของเซลล์ / Manager / ผู้บริหาร)
//    ลายเซ็นดึงเฉพาะตอนเปิดดูรายการนั้น (execEnsureFullRow) · เดิม select * ดึงลายเซ็นของทุกคำขอทุกครั้ง
// ============================================================
const EXEC_HEAVY_COLS = new Set(["approval_signature", "exec_signature", "signature", "sale_signature", "manager_signature", "signature_data", "payload", "document_html", "pdf_base64", "financial_analysis"]);
const EXEC_PAYLOAD_LIGHT = "pl_items:payload->items,pl_reason_type:payload->>reason_type,pl_reason_text:payload->>reason_text,pl_form:payload->>form_version,pl_m_decision:payload->manager->>decision,pl_m_at:payload->manager->>at,pl_m_name:payload->manager->>name,pl_m_comment:payload->manager->>comment,pl_m_by:payload->manager->>by";
const EXEC_SEL_KEY = "ea-appr-light-cols-v2";
let _execSel = null;

// รายชื่อคอลัมน์ของ approval_requests (ยกเว้นคอลัมน์หนัก) — ถามครั้งเดียว แล้วจำไว้ในเครื่อง (ถ้าคอลัมน์เปลี่ยนแล้วดึงพลาด จะถามใหม่เอง)
async function execApprovalSelect() {
  if (_execSel) return _execSel;
  try { const c = localStorage.getItem(EXEC_SEL_KEY); if (c) return (_execSel = c); } catch (e) { /* ignore */ }
  const { data, error } = await supabaseClient.from("approval_requests").select("*").limit(1);
  if (error || !data || !data.length) return "*";
  const row = data[0];
  const keys = Object.keys(row).filter((k) => !EXEC_HEAVY_COLS.has(k));
  _execSel = keys.join(",") + ("payload" in row ? "," + EXEC_PAYLOAD_LIGHT : "");
  try { localStorage.setItem(EXEC_SEL_KEY, _execSel); } catch (e) { /* ignore */ }
  return _execSel;
}

// ประกอบ payload (เฉพาะส่วนที่ใช้ในรายการ) กลับให้โค้ดเดิมใช้ได้เหมือนเดิม
function execRebuildLight(rows) {
  (rows || []).forEach((r) => {
    if (!("pl_items" in r) && !("pl_m_decision" in r)) return;
    r.payload = {
      items: r.pl_items || [], reason_type: r.pl_reason_type || "", reason_text: r.pl_reason_text || "", form_version: r.pl_form || null,
      manager: r.pl_m_decision ? { decision: r.pl_m_decision, at: r.pl_m_at, name: r.pl_m_name, comment: r.pl_m_comment, by: r.pl_m_by } : null,
    };
    Object.keys(r).filter((k) => k.startsWith("pl_")).forEach((k) => delete r[k]);
    r._light = true;
  });
  return rows;
}

/**
 * ดึง approval_requests แบบเบา (ถ้าใช้ไม่ได้ → กลับไป select * อัตโนมัติ)
 * @param {(sel:string)=>any} build — รับ select string แล้วคืน query (ใส่ filter/order เอง)
 */
async function execFetchApprovals(build) {
  let sel = "*";
  try { sel = await execApprovalSelect(); } catch (e) { sel = "*"; }
  if (sel !== "*") {
    const res = await build(sel);
    if (!res.error) return { data: execRebuildLight(res.data || []), error: null };
    console.warn("approval light select failed → *", res.error.message);
    _execSel = null;
    try { localStorage.removeItem(EXEC_SEL_KEY); } catch (e) { /* ignore */ }
  }
  return build("*");
}

// เปิดดูรายการ → ดึงแถวเต็ม (รวมลายเซ็น) มาเติมให้ (แก้ในอ็อบเจกต์เดิม)
async function execEnsureFullRow(row) {
  if (!row || !row._light || !row.id) return row;
  const { data, error } = await supabaseClient.from("approval_requests").select("*").eq("id", row.id).single();
  if (!error && data) { Object.assign(row, data); delete row._light; }
  return row;
}

function execNormType(t) {
  const raw = String(t || "other").trim();
  if (["temporary_credit_limit", "credit_limit", "credit_limit_temp"].includes(raw)) return "temp_credit_limit";
  return raw || "other";
}

// งานนี้ถึงขั้นผู้บริหารแล้วหรือยัง
function execAtStage(row) {
  const type = execNormType(row?.request_type);
  const rs = row?.request_status;
  if (type === "special_price" || type === "new_area_shop") { // มีขั้น Manager ก่อน
    if (rs === "waiting_manager") return false;
    const m = row?.payload?.manager;
    if (m && m.decision !== "approved") return false; // Manager ไม่อนุมัติ / ขอข้อมูลเพิ่ม → จบที่ Manager
    return true;
  }
  if (type === "temp_credit_limit") {
    if (["approved", "rejected"].includes(rs)) return true;
    const st = row?.status;
    return !st || ["executive_review", "waiting_ceo"].includes(st);
  }
  return true;
}

function execIsPending(row) {
  const rs = row?.request_status;
  if (EXEC_PENDING.includes(rs)) return true;
  return execNormType(row?.request_type) === "temp_credit_limit" && !["approved", "rejected", "request_more_info"].includes(rs);
}

// ถึงผู้บริหารเมื่อไหร่ (ราคาพิเศษ = เวลาที่ Manager อนุมัติ)
function execArrivedAt(row) {
  return new Date(row?.payload?.manager?.at || row?.forwarded_at || row?.created_at || Date.now());
}

/**
 * โหลดงานของผู้บริหาร
 * @param {Date} [decidedSince] — นับงานที่ตัดสินแล้วตั้งแต่วันนี้ (ไม่ใส่ = ไม่โหลด)
 * @returns {Promise<{pending: object[], decided: object[]}>} pending เรียงจากรอนานสุด
 */
async function loadExecApprovals(decidedSince) {
  const statuses = `request_status.in.(${EXEC_PENDING.join(",")},accounting_review,manager_review)`;
  const { data, error } = await execFetchApprovals((sel) => {
    const q = supabaseClient.from("approval_requests").select(sel);
    return (decidedSince ? q.or(`${statuses},approved_at.gte.${decidedSince.toISOString()}`) : q.or(statuses)).order("created_at", { ascending: true });
  });
  if (error) throw error;

  const rows = (data || []).filter(execAtStage);
  const pending = rows.filter(execIsPending);
  const decided = decidedSince
    ? rows.filter((r) => ["approved", "rejected"].includes(r.request_status) && r.approved_at && new Date(r.approved_at) >= decidedSince)
    : [];

  // เคลมระบบเดิม (ยังไม่ย้ายเข้า approval_requests) ที่รอผู้บริหาร
  try {
    const linked = new Set((data || []).filter((r) => r.source_table === "claims" && r.source_id).map((r) => String(r.source_id)));
    const { data: claims, error: e2 } = await supabaseClient.from("claims").select("*").eq("qc_status", "waiting_ceo");
    if (e2) throw e2;
    (claims || []).filter((c) => c.qc_status === "waiting_ceo" && !linked.has(String(c.id))).forEach((c) => pending.push({
      id: c.id, request_type: "claim", request_status: "pending", _legacy: true,
      request_title: `เคลมสินค้า ${c.product || c.product_name || ""}`.trim(),
      shop_name: c.customer || c.shop_name || "", sale_name: c.emp_name || c.created_by_name || "",
      created_at: c.updated_at || c.created_at,
    }));
  } catch (e) { console.warn("legacy claims:", e.message || e); }

  pending.sort((a, b) => execArrivedAt(a) - execArrivedAt(b));
  return { pending, decided };
}

// ป้ายตัวเลขบนเมนู "อนุมัติงาน" ของ sidebar (ทุกหน้าผู้บริหารที่มี #navPendingBadge)
function setExecNavBadge(n) {
  const nb = document.getElementById("navPendingBadge");
  if (!nb) return;
  nb.hidden = !n;
  nb.textContent = n > 99 ? "99+" : n;
}
