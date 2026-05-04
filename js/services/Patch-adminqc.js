// ============================================================
// PATCH: รับเรื่องเคลม + LINE Notify
// ────────────────────────────────────────────────────────────
// ใช้คู่กับ /js/services/lineNotify.js (Edge Function)
//
// 📦 สิ่งที่ต้องทำในไฟล์ adminQc.js (3 จุด):
//   1) แทนที่ buildStatusBadge เดิม → รองรับ in_progress
//   2) เพิ่มฟังก์ชัน pickClaim() + helper notifyLine() ด้านล่างนี้
//   3) ใน renderTable() แก้ปุ่ม action (ดูในส่วน B)
//   4) ใน updateClaimStatus() เพิ่มการส่ง LINE หลัง update สำเร็จ
//      (ดูส่วน C)
// ============================================================


/* ============================================================
   ส่วน A: แทนที่ buildStatusBadge เดิม
   ── เพิ่ม "in_progress" สำหรับสถานะ "QC รับเรื่องแล้ว"
============================================================ */
function buildStatusBadge(status) {
  const map = {
    submitted:   { label: '⏳ รออนุมัติ',     cls: 'submitted'   },
    in_progress: { label: '🔍 กำลังตรวจสอบ', cls: 'in-progress' },
    approved:    { label: '✅ อนุมัติแล้ว',   cls: 'approved'    },
    rejected:    { label: '❌ ปฏิเสธ',         cls: 'rejected'    },
    draft:       { label: '📝 Draft',          cls: 'draft'       },
  };
  const s = map[status] || { label: escapeHtml(status), cls: '' };
  return `<span class="status-badge ${s.cls}">${s.label}</span>`;
}


/* ============================================================
   ส่วน B: PATCH สำหรับ renderTable()
   ── หาบรรทัดที่สร้างปุ่ม "ดูรายละเอียด" ในตาราง
   ── แทนที่ทั้ง <td> สุดท้ายด้วยอันนี้:
============================================================

ของเดิม:
  <td>
    <button class="btn-view" onclick="event.stopPropagation(); openModal(window._claims['${claim.id}'])">
      ดูรายละเอียด
    </button>
  </td>

แก้เป็น:
  <td>
    <div class="cell-action-group">
      <button class="btn-view" onclick="event.stopPropagation(); openModal(window._claims['${claim.id}'])">
        <span class="material-symbols-outlined" style="font-size:1rem;">open_in_new</span>
        ดู
      </button>
      ${claim.status === 'submitted' ? `
        <button class="btn-pick" onclick="event.stopPropagation(); pickClaim('${claim.id}')">
          <span class="material-symbols-outlined" style="font-size:1rem;">how_to_reg</span>
          รับเรื่อง
        </button>
      ` : ''}
    </div>
  </td>
============================================================ */


/* ============================================================
   ส่วน C: ฟังก์ชัน "รับเรื่องเคลม"
============================================================ */
async function pickClaim(claimId) {
  const claim = (window._claims || {})[claimId] || allClaims.find(c => c.id === claimId);
  if (!claim) {
    showToast('ไม่พบข้อมูลเคลม', 'danger');
    return;
  }

  // ป้องกันการรับซ้ำ
  if (claim.status !== 'submitted') {
    showToast('เคลมนี้ถูกรับเรื่องไปแล้ว', 'warning');
    return;
  }

  // ยืนยัน
  let ok = true;
  if (typeof ConfirmDialog !== 'undefined') {
    ok = await ConfirmDialog.show({
      title:   'ยืนยันการรับเรื่อง',
      message: `รับเรื่องเคลม #${claim.id.substring(0, 8).toUpperCase()} ?\n(${claim.product || '—'})`,
      okText:  'รับเรื่อง',
      type:    'info',
    });
  } else {
    ok = confirm(`รับเรื่องเคลม #${claim.id.substring(0, 8).toUpperCase()} ?`);
  }
  if (!ok) return;

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();

    // ── 1) อัปเดต DB ──
    const updateData = {
      status:      'in_progress',
      picked_by:   user?.id || null,
      picked_at:   new Date().toISOString(),
      updated_at:  new Date().toISOString(),
    };

    const { error } = await supabaseClient
      .from('claims')
      .update(updateData)
      .eq('id', claim.id)
      .eq('status', 'submitted');   // ← guard: ป้องกัน race condition

    if (error) throw error;

    // ── 2) อัปเดต state ใน memory ──
    const idx = allClaims.findIndex(c => c.id === claim.id);
    if (idx !== -1) {
      Object.assign(allClaims[idx], updateData);
    }

    updateSummaryCards();
    applyFilters();

    // ── 3) ส่ง LINE แจ้งเตือน (ไม่ block UI ถ้าพลาด) ──
    notifyLine('claim_picked', {
      claim:      allClaims[idx] || claim,
      qc_name:    await getCurrentQcName(),
    }).catch(err => {
      console.warn('LINE notify failed (non-critical):', err);
      showToast('รับเรื่องสำเร็จ (แต่แจ้ง LINE ไม่สำเร็จ)', 'warning');
    });

    showToast('รับเรื่องเคลมสำเร็จ — แจ้งเตือนผู้เกี่ยวข้องแล้ว', 'success');

  } catch (err) {
    console.error('❌ pickClaim error:', err);
    showToast('รับเรื่องไม่สำเร็จ: ' + err.message, 'danger');
  }
}


/* ============================================================
   ส่วน D: PATCH updateClaimStatus()
   ── เพิ่มการส่ง LINE หลัง update สำเร็จ
   ── ค้นหาบรรทัดในฟังก์ชัน updateClaimStatus() ที่มี:
         showToast(`${label}เคลมสำเร็จ`, type);
   ── แทนที่บรรทัดนั้นด้วย:
============================================================

  // ── ส่ง LINE แจ้งผล (ไม่ block UI ถ้าพลาด) ──
  notifyLine(newStatus === 'approved' ? 'claim_approved' : 'claim_rejected', {
    claim:    allClaims[idx] || currentClaim,
    qc_name:  await getCurrentQcName(),
    qc_comment: comment,
  }).catch(err => {
    console.warn('LINE notify failed (non-critical):', err);
    showToast(`${label}เคลมสำเร็จ (แต่แจ้ง LINE ไม่สำเร็จ)`, 'warning');
    return;
  });

  showToast(`${label}เคลมสำเร็จ — แจ้งเตือนผู้เกี่ยวข้องแล้ว`, type);

============================================================ */


/* ============================================================
   ส่วน E: LINE NOTIFY HELPER
   ── เรียก Edge Function send-line-notify ของ Supabase
   ── ★ ปรับ payload format ตาม Edge Function จริง ★
============================================================ */

// import แบบ classic (ไม่ใช้ ES module)
// ⚠️ ต้องแก้ /js/services/lineNotify.js ให้เป็น window.sendLineNotify
//    หรือใช้ wrapper นี้แทนเลย (พึ่ง fetch ตรงๆ)

const LINE_CONFIG = {
  SUPABASE_URL:      "https://kdgmilagtpizwnhwapgl.supabase.co",
  // ⚠️ ใช้ session token ของ user แทน anon key (ปลอดภัยกว่า)
  // ถ้า Edge Function ตรวจ auth.getUser() จะ work อัตโนมัติ
  ENDPOINT:          "/functions/v1/send-line-notify",
};

async function callLineNotifyEndpoint(payload) {
  // ดึง access token ของ user ปัจจุบัน
  const { data: { session } } = await supabaseClient.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('ไม่ได้ login');

  const res = await fetch(LINE_CONFIG.SUPABASE_URL + LINE_CONFIG.ENDPOINT, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(result)}`);
  return result;
}


/* ============================================================
   ส่วน F: NOTIFY LINE — ตัว dispatch ตาม event type
   ── สร้างข้อความตาม template แล้วยิงเข้า Edge Function
   ── ★★★ ปรับ payload structure ให้ตรงกับ Edge Function ของคุณ ★★★
============================================================ */

async function notifyLine(eventType, ctx) {
  const c = ctx.claim;
  const claimNo  = (c.id || '').substring(0, 8).toUpperCase();
  const product  = c.product || '—';
  const customer = c.customer || '—';
  const empName  = c.emp_name || '—';
  const area     = c.area || '—';
  const qcName   = ctx.qc_name || 'QC';
  const comment  = ctx.qc_comment || '';

  // ── สร้างข้อความตาม event ──
  let message = '';
  let title   = '';

  switch (eventType) {
    case 'claim_picked':
      title = '🔍 QC รับเรื่องเคลมแล้ว';
      message =
        `🔍 QC รับเรื่องเคลมแล้ว\n` +
        `━━━━━━━━━━━━━━━━━\n` +
        `🆔 เลขที่: #${claimNo}\n` +
        `📦 สินค้า: ${product}\n` +
        `🏪 ลูกค้า: ${customer}\n` +
        `👤 พนักงาน: ${empName} (${area})\n` +
        `━━━━━━━━━━━━━━━━━\n` +
        `✅ รับเรื่องโดย: ${qcName}\n` +
        `⏰ ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}\n` +
        `📍 สถานะ: กำลังตรวจสอบ`;
      break;

    case 'claim_approved':
      title = '✅ เคลมได้รับการอนุมัติ';
      message =
        `✅ เคลมได้รับการอนุมัติ\n` +
        `━━━━━━━━━━━━━━━━━\n` +
        `🆔 เลขที่: #${claimNo}\n` +
        `📦 สินค้า: ${product}\n` +
        `🏪 ลูกค้า: ${customer}\n` +
        `👤 พนักงาน: ${empName} (${area})\n` +
        `━━━━━━━━━━━━━━━━━\n` +
        `✅ พิจารณาโดย: ${qcName}\n` +
        (comment ? `💬 หมายเหตุ: ${comment}\n` : '') +
        `⏰ ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`;
      break;

    case 'claim_rejected':
      title = '❌ เคลมถูกปฏิเสธ';
      message =
        `❌ เคลมถูกปฏิเสธ\n` +
        `━━━━━━━━━━━━━━━━━\n` +
        `🆔 เลขที่: #${claimNo}\n` +
        `📦 สินค้า: ${product}\n` +
        `🏪 ลูกค้า: ${customer}\n` +
        `👤 พนักงาน: ${empName} (${area})\n` +
        `━━━━━━━━━━━━━━━━━\n` +
        `❌ พิจารณาโดย: ${qcName}\n` +
        (comment ? `💬 เหตุผล: ${comment}\n` : '') +
        `⏰ ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`;
      break;

    default:
      throw new Error('Unknown event type: ' + eventType);
  }

  // ── 🎯 PAYLOAD STRUCTURE — เลือก 1 ใน 3 รูปแบบให้ตรงกับ Edge Function ──
  // ★ ถ้า Edge Function รับแบบ A (default — ส่ง message เป็น text):
  const payload = {
    type:      eventType,    // ให้ Edge Function เช็คว่าจะส่งไป group ไหน
    message:   message,
    title:     title,        // ใช้กับ Notification card
    claim_id:  c.id,
    metadata: {
      product,
      customer,
      emp_name:   empName,
      area,
      qc_name:    qcName,
      qc_comment: comment,
    },
  };

  // ★ ถ้าเป็นแบบ B (Flex Message format):
  // const payload = {
  //   to: 'Cxxxxx',  // group ID
  //   messages: [{ type: 'text', text: message }]
  // };

  // ★ ถ้าเป็นแบบ C (template-based):
  // const payload = { template: eventType, data: ctx };

  return callLineNotifyEndpoint(payload);
}


/* ============================================================
   ส่วน G: helper — ดึงชื่อ QC ปัจจุบัน
============================================================ */
async function getCurrentQcName() {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return 'QC';

    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('display_name, username')
      .eq('id', user.id)
      .single();

    return profile?.display_name || profile?.username || user.email || 'QC';
  } catch (err) {
    console.warn('getCurrentQcName failed:', err);
    return 'QC';
  }
}