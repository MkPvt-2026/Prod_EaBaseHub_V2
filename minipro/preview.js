// ============================================================
// approval-document.js  (v2 — Compact, Synced with executive-approval.js)
//
// ใช้กับหน้า external-claims และ internal-claims เพื่อ "ดูเอกสารอนุมัติ"
// เอกสารใช้รูปแบบเดียวกันกับ executive-approval.js (consistent)
//
// แก้ปัญหา:
//  1) Decision banner เล็กลง อยู่มุมขวาบนเป็น badge
//  2) ตาราง Grade เพิ่ม checkbox + จัดให้พอดี
//  3) Render ลายเซ็นเป็น <img> (ไม่ใช่ raw base64 text)
//  4) ดึงชื่อ CEO จาก profiles.display_name (ผ่าน claim.exec_by)
// ============================================================
(function () {
  "use strict";

  // ---------- Utilities ----------
  function escapeHtml(value) {
    if (value == null) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDate(d) {
    if (!d || d === "—") return "—";
    try {
      const date = new Date(d);
      if (Number.isNaN(date.getTime())) return "—";
      return date.toLocaleDateString("th-TH", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch (_) {
      return "—";
    }
  }

  function formatDateTime(d) {
    if (!d || d === "—") return "—";
    try {
      const date = new Date(d);
      if (Number.isNaN(date.getTime())) return "—";
      return date.toLocaleString("th-TH", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (_) {
      return "—";
    }
  }

  function val(...items) {
    return (
      items.find((v) => v !== undefined && v !== null && v !== "") || "—"
    );
  }

  function getClaimNo(c) {
    const raw = c?.claim_no || c?.claim_code || c?.claim_id || c?.id || "";
    return String(raw).substring(0, 8).toUpperCase() || "—";
  }

  function getApprovalDocNo(claim) {
    const year = new Date(claim?.exec_at || Date.now()).getFullYear();
    return `APP-${year}-${getClaimNo(claim)}`;
  }

  function getQcResult(claim) {
    const raw = claim?.qc_result;
    if (!raw) return {};
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw) || {};
      } catch (_) {
        return {};
      }
    }
    return raw;
  }

  // รองรับทั้งโครงเก่า (repair_qty/spare_qty/scrap_qty) และใหม่ (grade_r_qty/grade_c_qty)
  function getGradeRows(qc) {
    return [
      ["A", "คืนสต็อก / พร้อมขาย", qc.grade_a_qty],
      ["B", "ขายเกรดรอง / Outlet", qc.grade_b_qty],
      ["R", "ส่งกลับบด / หลอมใหม่", qc.grade_r_qty ?? qc.repair_qty],
      ["C", "ทิ้ง / ตัดจ่าย / คืน Supplier", qc.grade_c_qty ?? qc.scrap_qty],
    ];
  }

  const PRODUCT_SOURCE_LABELS = {
    in_house: "สินค้าโรงงานผลิตเอง (รีไซเคิลได้)",
    trading: "สินค้าซื้อมาขายไป (รีไซเคิลไม่ได้)",
  };

  const ROOT_CAUSE_LABELS = {
    logistics: "ความเสียหายจากการขนส่ง",
    production: "คุณภาพสินค้า (ผลิต/โรงงาน)",
    wrong_delivery: "ส่งสินค้าผิดสเปก/ผิดรุ่น",
  };

  function toast(msg, type = "info") {
    if (typeof window.showToast === "function") {
      window.showToast(msg, type);
    } else {
      console.log(`[${type}]`, msg);
    }
  }

  // ============================================================
  // ดึงข้อมูล Approver (CEO) + QC จาก profiles
  // ============================================================
  const _profileCache = new Map();

  async function getProfileById(userId) {
    if (!userId) return null;
    if (_profileCache.has(userId)) return _profileCache.get(userId);

    if (typeof supabaseClient === "undefined") return null;

    try {
      const { data, error } = await supabaseClient
        .from("profiles")
        .select("id, display_name, username, role")
        .eq("id", userId)
        .maybeSingle();

      if (error) throw error;

      _profileCache.set(userId, data || null);
      return data || null;
    } catch (e) {
      console.warn("[ApprovalDoc] fetch profile failed:", e);
      return null;
    }
  }

  async function loadSignatories(claim) {
    const ids = [claim?.exec_by, claim?.qc_by].filter(Boolean);
    if (!ids.length) {
      return { exec: null, qc: null };
    }

    const profiles = await Promise.all(ids.map((id) => getProfileById(id)));

    return {
      exec: profiles.find((p) => p?.id === claim?.exec_by) || null,
      qc: profiles.find((p) => p?.id === claim?.qc_by) || null,
    };
  }

  function getProfileName(profile, fallback = "—") {
    return profile?.display_name || profile?.username || fallback;
  }

  function getRoleLabel(role) {
    const map = {
      ceo: "ประธานเจ้าหน้าที่บริหาร",
      executive: "ผู้บริหาร",
      admin: "ผู้ดูแลระบบ",
      adminQc: "หัวหน้า QC",
      adminqc: "หัวหน้า QC",
      qc: "เจ้าหน้าที่ QC",
      qcLeader: "หัวหน้า QC",
    };
    return map[role] || role || "";
  }

  // ============================================================
  // Render ลายเซ็นเป็น <img> (รองรับ data URI + raw base64 + URL)
  // ============================================================
  function renderSignatureImg(sigData, alt = "ลายเซ็น") {
    if (!sigData) {
      return `<span class="no-sig">— ยังไม่ได้ลงนาม —</span>`;
    }

    const trimmed = String(sigData).trim();

    let src;
    if (trimmed.startsWith("data:image")) {
      src = trimmed;
    } else if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      src = trimmed;
    } else if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed.substring(0, 60))) {
      src = `data:image/png;base64,${trimmed.replace(/\s+/g, "")}`;
    } else {
      return `<span class="sig-text">${escapeHtml(trimmed)}</span>`;
    }

    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
  }

  // ============================================================
  // Build HTML Document (compact + 3 fixes)
  // ============================================================
  function buildDocumentHtml(claim, signatories) {
    const qc = getQcResult(claim);
    const docNo = getApprovalDocNo(claim);
    const isApproved = claim?.exec_status === "approved";
    const isRejected = claim?.exec_status === "rejected";
    const statusText = isApproved
      ? "อนุมัติ"
      : isRejected
      ? "ปฏิเสธ"
      : "รอพิจารณา";
    const statusClass = isApproved
      ? "approved"
      : isRejected
      ? "rejected"
      : "pending";

    // ============ Grade Rows (with checkbox + auto-tick if qty > 0) ============
    const gradeRows = getGradeRows(qc)
      .map(([grade, label, qty]) => {
        const n = Number(qty || 0);
        const checked = n > 0 ? "checked" : "";
        const gradeColor =
          { A: "#5fb377", B: "#8acde0", R: "#4ba4c4", C: "#f68491" }[grade] ||
          "#19191a";

        return `
          <tr>
            <td class="grade-check-cell">
              <input type="checkbox" class="grade-check" ${checked} disabled>
            </td>
            <td class="grade-badge-cell">
              <span class="grade-badge" style="background:${gradeColor};">${grade}</span>
            </td>
            <td class="grade-label-cell">${escapeHtml(label)}</td>
            <td class="grade-qty-cell">${n.toLocaleString()}</td>
          </tr>`;
      })
      .join("");

    const totalQty = getGradeRows(qc).reduce(
      (sum, [, , q]) => sum + Number(q || 0),
      0,
    );

    // ============ Product Source / Root Cause (เคลมภายนอกเท่านั้น) ============
    const productSource = qc.product_source
      ? PRODUCT_SOURCE_LABELS[qc.product_source] || qc.product_source
      : "—";
    const rootCause = qc.claim_root_cause
      ? ROOT_CAUSE_LABELS[qc.claim_root_cause] || qc.claim_root_cause
      : "—";

    // ============ Signatories ============
    const execProfile = signatories?.exec;
    const qcProfile = signatories?.qc;
    const execName = getProfileName(execProfile, "CEO / Executive");
    const execRoleLabel = getRoleLabel(execProfile?.role) || "ผู้บริหาร";
    const qcName = getProfileName(qcProfile, "เจ้าหน้าที่ QC");
    const qcRoleLabel = getRoleLabel(qcProfile?.role) || "เจ้าหน้าที่ QC";

    return `<!doctype html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(docNo)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 8mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Kanit", "Sarabun", Tahoma, sans-serif;
    color: #0f172a;
    background: #e2e8f0;
    font-size: 10.5px;
    line-height: 1.35;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    min-height: 100vh;
    padding: 20px 0 40px;
  }
  .doc {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    background: #fff;
    padding: 8mm 9mm;
    box-shadow: 0 1px 3px rgba(15,23,42,.1), 0 10px 40px rgba(15,23,42,.15);
    border-radius: 2px;
    position: relative;
  }

  /* ========= TOP HEADER (Banner เล็กในนี้) ========= */
 .top {
  display: flex;
  justify-content: space-between;
  align-items: center;         
  border-bottom: 2px solid #7c3aed;
  padding-bottom: 12px;
  margin-bottom: 14px;
  flex-wrap: nowrap;
}

.brand-wrap {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: 1;
  min-width: 0;
}

.company-logo {
  width: 100px;
  height: 100px;
  object-fit: contain;
  flex-shrink: 0;
}

.brand {
  min-width: 0;
}

.brand h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.25;
}

.brand p {
  margin: 3px 0 0;
  color: #475569;
  font-size: 12px;
  line-height: 1.25;
}

.doc-no {
  text-align: right;
  min-width: 180px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;       
  gap: 2px;
  min-height: 100px;            
}

.doc-no > div {
  color: #475569;
  font-size: 10px;
  line-height: 1.2;
}

.doc-no strong {
  font-size: 13px;
  color: #5b21b6;
  font-weight: 700;
  line-height: 1.2;
}

.doc-no .status-badge {
  margin-top: 2px;
}

  .brand-wrap{
  display:flex;
  align-items:center;
  gap:14px;

  flex:1;
  min-width:0;
}

.company-name{
  margin:2px 0;
  font-size:13px;
  font-weight:600;
  color:#334155;
}


  /* ========= Decision Badge (เล็ก มุมขวาบน) ========= */
  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    border-radius: 999px;
    font-weight: 700;
    font-size: 10.5px;
    line-height: 1.2;
  }
  .status-badge.approved {
    background: #dcfce7;
    color: #14532d;
    border: 1px solid #86efac;
  }
  .status-badge.rejected {
    background: #fee2e2;
    color: #7f1d1d;
    border: 1px solid #fca5a5;
  }
  .status-badge.pending {
    background: #fef3c7;
    color: #78350f;
    border: 1px solid #fcd34d;
    text-align: center;
  }
  .status-badge .icon {
    font-size: 12px;
    line-height: 1;
  }

  /* ========= Doc Title (อยู่กลาง) ========= */
  .doc-title {
    text-align: center;
    margin: 4px 0 8px;
  }
  .doc-title h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: #0f172a;
    letter-spacing: 0.2px;
  }
  .doc-title .sub {
    font-size: 10px;
    color: #64748b;
    margin-top: 1px;
  }

  /* ========= Info Grid ========= */
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }
  .box {
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 4px 8px;
    background: #f8fafc;
  }
  .box.full {
    grid-column: 1 / -1;
  }
  .label {
    color: #475569;
    font-size: 9.5px;
    margin-bottom: 1px;
    font-weight: 500;
  }
  .value {
    font-weight: 600;
    color: #0f172a;
    font-size: 10.5px;
    word-break: break-word;
  }

  /* ========= Section Heading ========= */
  h2.section {
    font-size: 14px;
    margin: 8px 0 4px;
    color: #4c1d95;
    border-left: 3px solid #7c3aed;
    padding-left: 6px;
    font-weight: 700;
  }

  /* ========= QC Result + Grade Table (FIX: pad + checkbox) ========= */
  .qc-result-section {
    display: grid;
    gap: 5px;
    
  }

  .qc-meta-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }

  .qc-meta-card {
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 4px 8px;
    background: #faf5ff;
  }
  .qc-meta-card .label {
    color: #6b21a8;
    font-weight: 600;
    
  }

  table.grade-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    margin-top: 2px;
    
  }
  
  table.grade-table td {
    border: 1px solid #cbd5e1;
    padding: 4px 7px;
    font-size: 10.5px;
    vertical-align: middle;
    
  }
  table.grade-table th {
    background: #ede9fe;
    color: #4c1d95;
    text-align: center;
    font-weight: 700;
    padding: 5px 7px;
  }

  /* คอลัมน์ width — รวม 100% */
  .grade-check-cell {
    text-align: center;
    width: 7%;
  }
  .grade-badge-cell {
    text-align: center;
    width: 11%;
  }
  .grade-label-cell {
    color: #1e293b;
    width: 64%;   
    
  }
  .grade-qty-cell {
    text-align: center;
    font-weight: 700;
    color: #0f172a;
    width: 18%;
  }

  .grade-check {
    text-align: center;
    width: 13px;
    height: 13px;
    margin: 0;
    vertical-align: middle;
    accent-color: #7c3aed;
    cursor: not-allowed;
  }

  .grade-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    color: #fff;
    font-weight: 800;
    font-size: 10.5px;
  }

  table.grade-table tfoot td {
    align-items: center;
    background: #fff7ed;
    color: #7c2d12;
    font-weight: 800;
    padding: 5px 7px;
  }

  td.total-label {
    text-align: center;
  }


  /* ========= Approval Section (CEO Signature) ========= */
  .approval {
    margin-top: 5px;
    border: 1.5px solid #7c3aed;
    border-radius: 8px;
    padding: 8px 10px;
    background: #faf5ff;
  }

  /* ========= Comment Box (ความเห็น QC + CEO เด่น) ========= */
  .comment-box {
    border: 1.2px solid;
    border-radius: 7px;
    padding: 6px 10px;
    margin-top: 5px;
  }
  .comment-box.qc-comment {
    background: #eff6ff;
    border-color: #93c5fd;
  }
  .comment-box.ceo-comment {
    background: #fefce8;
    border-color: #facc15;
    margin-top: 0;
  }
  .comment-box .comment-label {
    font-size: 10.5px;
    font-weight: 700;
    margin-bottom: 3px;
    padding-bottom: 3px;
    border-bottom: 1px dashed currentColor;
    opacity: 0.85;
  }
  .comment-box.qc-comment .comment-label {
    color: #1e40af;
  }
  .comment-box.ceo-comment .comment-label {
    color: #854d0e;
  }
  .comment-box .comment-value {
    font-size: 10.5px;
    line-height: 1.5;
    color: #0f172a;
    white-space: pre-wrap;
    word-break: break-word;
    min-height: 22px;
  }

  .approval-row {
    font-size: 10.5px;
    color: #0f172a;
    margin-bottom: 3px;
  }
  .approval-row strong {
    color: #4c1d95;
    font-weight: 700;
  }

  .signature-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-top: 8px;
    align-items: stretch;
  }
  .signature-wrap {
    display: flex;
    flex-direction: column;
  }
  .signature-box {
    border: 1px solid #94a3b8;
    border-radius: 6px;
    height: 75px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #fff;
    padding: 3px;
    overflow: hidden;
    margin-top: 2px;
  }
  .signature-box img {
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    object-fit: contain;
    /* FIX: ลายเซ็นชัด ไม่จาง */
    filter: contrast(1.6) brightness(0.75) saturate(0);
    mix-blend-mode: multiply;
  }
  .signature-box .no-sig {
    color: #94a3b8;
    font-size: 10px;
    font-style: italic;
  }
  .signature-box .sig-text {
    font-family: "Brush Script MT", cursive;
    font-size: 20px;
    color: #1e3a8a;
  }

  .signer-info {
    margin-top: 4px;
    padding-top: 3px;
    border-top: 1px dashed #cbd5e1;
    font-size: 10px;
  }
  .signer-info .signer-name {
    font-weight: 700;
    color: #0f172a;
    font-size: 10.5px;
  }
  .signer-info .signer-role {
    color: #6b7280;
    font-size: 9.5px;
    margin-top: 1px;
  }
  .signer-info .signer-date {
    color: #94a3b8;
    font-size: 9.5px;
    margin-top: 1px;
  }

  /* ========= Footer ========= */
  .footer {
    margin-top: 8px;
    padding-top: 5px;
    border-top: 1px solid #cbd5e1;
    color: #64748b;
    font-size: 9.5px;
    display: flex;
    justify-content: space-between;
  }

  /* ========= Print Actions ========= */
  .actions {
    position: fixed;
    right: 14px;
    top: 14px;
    display: flex;
    gap: 8px;
    z-index: 10;
  }
  .actions button {
    border: 0;
    border-radius: 8px;
    padding: 8px 14px;
    background: #7c3aed;
    color: #fff;
    cursor: pointer;
    font-weight: 700;
    font-family: inherit;
    font-size: 13px;
    box-shadow: 0 4px 12px rgba(124,58,237,0.3);
  }
  .actions button:hover {
    background: #6d28d9;
  }

  @media print {
    @page { size: A4; margin: 7mm; }
    html, body {
      background: #fff !important;
      padding: 0 !important;
      min-height: 0 !important;
    }
    .actions { display: none !important; }
    .doc {
      width: 100% !important;
      min-height: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      box-shadow: none !important;
      border-radius: 0 !important;
      background: #fff !important;
    }
    body { font-size: 10px; }
    /* บังคับให้ไม่แบ่งหน้าระหว่าง section */
    .approval, .qc-result-section, .grid {
      page-break-inside: avoid;
    }
  }
</style>
</head>
<body>
  <div class="actions">
    <button onclick="window.print()">🖨️ พิมพ์ / Save PDF</button>
  </div>

  <div class="doc">
    <!-- ====== Top Header + Decision Badge (เล็กในมุมขวาบน) ====== -->

    <!-- ====== Top Header + Decision Badge ====== -->
<div class="top">
  <div class="brand-wrap">
    <img
      src="/assets/icons/logo-pvt.png"
      alt="Company Logo"
      class="company-logo"
    >
    <div class="brand">
      <h1>ใบอนุมัติการเคลมสินค้า</h1>
      <p>Claim Approval Document · EABaseHub</p>
    </div>
  </div>

  <div class="doc-no">
    <div>เลขที่เอกสาร</div>
    <strong>${escapeHtml(docNo)}</strong>
    <span class="status-badge ${statusClass}">
      <span class="icon">${
        isApproved ? "✅" : isRejected ? "❌" : "⏳"
      }</span>
      CEO ${statusText}
    </span>
  </div>
</div>

    <!-- ====== ข้อมูลเคลม ====== -->
    <h2 class="section">ข้อมูลเคลม</h2>
    <div class="grid">
      <div class="box">
        <div class="label">เลขเคลม</div>
        <div class="value">${escapeHtml(getClaimNo(claim))}</div>
      </div>
      <div class="box">
        <div class="label">วันที่อนุมัติ</div>
        <div class="value">${escapeHtml(formatDateTime(claim.exec_at))}</div>
      </div>
      <div class="box">
        <div class="label">ประเภทเคลม</div>
        <div class="value">${
          claim.claim_scope === "internal" ? "เคลมภายใน" : "เคลมภายนอก"
        }</div>
      </div>
      <div class="box">
        <div class="label">ผู้แจ้ง / พื้นที่</div>
        <div class="value">${escapeHtml(
          val(claim.emp_name, claim.created_by_name),
        )} · ${escapeHtml(val(claim.area, claim.department))}</div>
      </div>
      <div class="box">
        <div class="label">ลูกค้า</div>
        <div class="value">${escapeHtml(
          val(claim.customer, claim.customer_name),
        )}</div>
      </div>
      <div class="box">
        <div class="label">สินค้า · จำนวน</div>
        <div class="value">${escapeHtml(
          val(claim.product, claim.product_name),
        )} · ${escapeHtml(val(claim.qty, claim.quantity))}</div>
      </div>
      <div class="box full">
        <div class="label">รายละเอียดปัญหา</div>
        <div class="value">${escapeHtml(
          val(
            claim.detail,
            claim.claim_detail,
            claim.problem_detail,
            claim.description,
          ),
        )}</div>
      </div>
    </div>

    <!-- ====== ผลการตรวจสอบ QC ====== -->
    <h2 class="section">ผลการตรวจสอบและคัดแยก QC</h2>

    <div class="qc-result-section">
      ${
        qc.product_source || qc.claim_root_cause
          ? `
        <div class="qc-meta-grid">
          <div class="qc-meta-card">
            <div class="label">ประเภทสินค้า</div>
            <div class="value">${escapeHtml(productSource)}</div>
          </div>
          <div class="qc-meta-card">
            <div class="label">ต้นเหตุความเสียหาย</div>
            <div class="value">${escapeHtml(rootCause)}</div>
          </div>
        </div>`
          : ""
      }

      <table class="grade-table">
        <thead>
          <tr>
            <th style="width:7%;">เลือก</th>
            <th style="width:11%;">เกรด</th>
            <th style="width:64%;">การจัดการ</th>
            <th style="width:18%; text-align:right;">จำนวน</th>
          </tr>
        </thead>
        <tbody>${gradeRows}</tbody>
        <tfoot>
          <tr>
            <td colspan="3" style="text-align:right;">รวมทั้งหมด</td>
            <td style="text-align:right;">${totalQty.toLocaleString()}</td>
          </tr>
        </tfoot>
      </table>

      <!-- ====== สาเหตุหลัก + ผู้รับผิดชอบ (จาก qc_result) ====== -->
      <div class="qc-meta-grid">
        <div class="qc-meta-card">
          <div class="label">สาเหตุหลัก</div>
          <div class="value">${escapeHtml(qc.defect_reason || "-")}</div>
        </div>
        <div class="qc-meta-card">
          <div class="label">ผู้รับผิดชอบ</div>
          <div class="value">${escapeHtml(qc.responsibility || "-")}</div>
        </div>
      </div>

      <!-- ====== ความเห็น QC ====== -->
      <div class="comment-box qc-comment">
        <div class="comment-label">
          ความเห็น / รายละเอียดจาก QC
        </div>
        <div class="comment-value">${escapeHtml(
          val(claim.qc_comment, qc.comment, "-"),
        )}</div>
      </div>
    </div>

    <!-- ====== ผลการพิจารณาผู้บริหาร (FIX 3: ลายเซ็น + ชื่อ + role + ความเห็นเด่น) ====== -->
    <h2 class="section">ผลการพิจารณาผู้บริหาร</h2>
    <div class="approval">
      <!-- ความเห็นผู้บริหาร (กล่องเด่น - เป็นหลักฐานสำคัญของเอกสารยืนยัน) -->
      <div class="comment-box ceo-comment">
        <div class="comment-label">
          ความเห็น / หมายเหตุ / เงื่อนไขจากผู้บริหาร
        </div>
        <div class="comment-value">${escapeHtml(
          claim.exec_comment || "— ไม่มีความเห็นเพิ่มเติม —",
        )}</div>
      </div>

      <div class="signature-row">
        <!-- QC Officer -->
        <div class="signature-wrap">
          <div class="label">ลายเซ็น QC</div>
          <div class="signature-box">
            ${
              claim.qc_signature
                ? renderSignatureImg(claim.qc_signature, "QC Signature")
                : '<span class="no-sig">— ไม่มีลายเซ็น —</span>'
            }
          </div>
          <div class="signer-info">
            <div class="signer-name">${escapeHtml(qcName)}</div>
            <div class="signer-role">${escapeHtml(qcRoleLabel)}</div>
            <div class="signer-date">${escapeHtml(
              formatDateTime(claim.updated_at),
            )}</div>
          </div>
        </div>

        <!-- CEO -->
        <div class="signature-wrap">
          <div class="label">ลายเซ็นผู้บริหาร</div>
          <div class="signature-box">
            ${renderSignatureImg(claim.exec_signature, "CEO Signature")}
          </div>
          <div class="signer-info">
            <div class="signer-name">${escapeHtml(execName)}</div>
            <div class="signer-role">${escapeHtml(execRoleLabel)}</div>
            <div class="signer-date">${escapeHtml(
              formatDateTime(claim.exec_at),
            )}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="footer">
      <span>Generated by EABaseHub</span>
      <span>${escapeHtml(docNo)}</span>
    </div>
  </div>
</body>
</html>`;
  }

  // ============================================================
  // Open / Download / Share
  // ============================================================
  async function open(claim) {
    if (!claim) {
      toast("ไม่พบข้อมูลเคลม", "danger");
      return;
    }

    const win = window.open("", "_blank");
    if (!win) {
      toast("เบราว์เซอร์บล็อก popup กรุณาอนุญาต popup", "warning");
      return;
    }

    win.document.open();
    win.document.write(`<!doctype html><html><head><meta charset="UTF-8">
      <title>กำลังโหลด...</title>
      <style>body{font-family:"Kanit",sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#475569;background:#f8fafc;font-size:14px;}</style>
    </head><body>⏳ กำลังจัดเตรียมเอกสาร...</body></html>`);
    win.document.close();

    try {
      const signatories = await loadSignatories(claim);
      const html = buildDocumentHtml(claim, signatories);
      win.document.open();
      win.document.write(html);
      win.document.close();
    } catch (e) {
      console.error("[ApprovalDoc] open error:", e);
      const html = buildDocumentHtml(claim, { exec: null, qc: null });
      win.document.open();
      win.document.write(html);
      win.document.close();
    }
  }

  async function download(claim) {
    if (!claim) {
      toast("ไม่พบข้อมูลเคลม", "danger");
      return;
    }

    const win = window.open("", "_blank");
    if (!win) {
      toast("เบราว์เซอร์บล็อก popup กรุณาอนุญาต popup", "warning");
      return;
    }

    win.document.open();
    win.document.write(`<!doctype html><html><head><meta charset="utf-8">
      <title>Preparing...</title>
      </head><body style="font-family:Kanit,sans-serif;padding:20px;">⏳ กำลังเตรียมเอกสาร...</body></html>`);
    win.document.close();

    try {
      const signatories = await loadSignatories(claim);
      const html = buildDocumentHtml(claim, signatories);
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => {
        try {
          win.print();
        } catch (e) {
          console.warn("[ApprovalDoc] print failed:", e);
        }
      }, 700);
    } catch (e) {
      console.error("[ApprovalDoc] download error:", e);
      toast("ดาวน์โหลดไม่สำเร็จ: " + (e.message || e), "danger");
    }
  }

  async function share(claim) {
    if (!claim) {
      toast("ไม่พบข้อมูลเคลม", "danger");
      return;
    }

    try {
      const signatories = await loadSignatories(claim).catch(() => ({
        exec: null,
        qc: null,
      }));
      const html = buildDocumentHtml(claim, signatories);
      const blob = new Blob([html], { type: "text/html" });
      const fileName = `${getApprovalDocNo(claim)}.html`;
      const file = new File([blob], fileName, { type: "text/html" });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `เอกสารอนุมัติ ${getApprovalDocNo(claim)}`,
          text: `ใบอนุมัติเคลม ${getApprovalDocNo(claim)}`,
        });
        toast("แชร์เอกสารเรียบร้อย", "success");
        return;
      }

      try {
        await navigator.clipboard.writeText(
          `${getApprovalDocNo(claim)} — ดูเอกสารในระบบ`,
        );
        toast("คัดลอกข้อมูลเอกสารไปยังคลิปบอร์ดแล้ว", "info");
      } catch (_) {}

      open(claim);
    } catch (e) {
      if (e?.name === "AbortError") return;
      console.error("[ApprovalDoc] share error:", e);
      toast("แชร์เอกสารไม่สำเร็จ (อาจไม่รองรับในเบราว์เซอร์นี้)", "warning");
    }
  }

  // ============================================================
  // Expose API
  // ============================================================
  window.ApprovalDocument = window.ApprovalDocument || {};

  window.ApprovalDocument.open = open;
  window.ApprovalDocument.download = download;
  window.ApprovalDocument.share = share;
  window.ApprovalDocument.buildHtml = buildDocumentHtml;
  window.ApprovalDocument.loadSignatories = loadSignatories;

  console.log("✅ approval-document.js (v2) loaded");
})();