// =====================================================
// newShopRequests.js — Admin: สร้างร้านจากคำขอเปิดร้านค้าใหม่ที่ผู้บริหารอนุมัติแล้ว
// ต้องโหลด special-price-common.js + new-shop-common.js (+ approval-notify.js) ก่อน
//
// สร้างร้าน = insert shops (shop_name, shop_code, province, sale_id, status "active")
//           + upsert shop_details (ที่อยู่ ผู้ติดต่อ โทร LINE แผนที่ รูปร้าน)
//           + บันทึกในคำขอ payload.shop_created = { shop_id, shop_code, at, by, by_name } (กันสร้างซ้ำ)
//           + แจ้งเตือนเซลล์
// =====================================================
"use strict";

const NSR = (() => {
  const $ = (id) => document.getElementById(id);
  const COLS = "id, request_status, status, shop_name, province, sale_name, request_by, approved_at, created_at, pl_shop:payload->shop_new, pl_created:payload->shop_created, pl_m:payload->manager->>decision";
  let rows = [], tab = "todo", cur = null, sales = [], busy = false;

  const created = (r) => r.payload?.shop_created || null;
  function bucket(r) {
    const st = nsStatus(r);
    if (st.key === "approved") return created(r) ? "done" : "todo";
    if (st.done) return "closed";
    return "pending";
  }
  function lift(r) {
    if (!("pl_shop" in r)) return r;
    r.payload = { shop_new: r.pl_shop || {}, shop_created: r.pl_created || null, manager: r.pl_m ? { decision: r.pl_m } : null };
    delete r.pl_shop; delete r.pl_created; delete r.pl_m;
    return r;
  }

  async function load() {
    $("stateBox").hidden = false; $("stateBox").textContent = "กำลังโหลด..."; $("tableWrap").hidden = true;
    try {
      const q = (sel) => supabaseClient.from("approval_requests").select(sel).eq("request_type", NS_TYPE).order("created_at", { ascending: false }).limit(300);
      let { data, error } = await q(COLS);
      if (error) { console.warn("load (light):", error.message); ({ data, error } = await q("*")); if (error) throw error; }
      rows = (data || []).map(lift);
      render();
    } catch (e) { $("stateBox").textContent = "โหลดไม่สำเร็จ: " + (e.message || e); }
  }

  function render() {
    const c = { todo: 0, done: 0, pending: 0, closed: 0 };
    rows.forEach((r) => c[bucket(r)]++);
    $("cTodo").textContent = c.todo; $("cDone").textContent = c.done; $("cPending").textContent = c.pending; $("cClosed").textContent = c.closed;
    const kw = $("q").value.trim().toLowerCase();
    const list = rows.filter((r) => bucket(r) === tab).filter((r) => !kw || [r.shop_name, r.province, r.sale_name, nsShop(r).district].join(" ").toLowerCase().includes(kw));
    if (tab === "todo") list.sort((a, b) => new Date(a.approved_at || a.created_at) - new Date(b.approved_at || b.created_at));
    if (!list.length) { $("stateBox").hidden = false; $("stateBox").textContent = tab === "todo" ? "ไม่มีคำขอที่รอสร้างร้าน 🎉" : "ไม่มีรายการ"; $("tableWrap").hidden = true; return; }
    $("stateBox").hidden = true; $("tableWrap").hidden = false;
    $("tbody").innerHTML = list.map((r) => {
      const s = nsShop(r), st = nsStatus(r), cr = created(r), id = escHtml(r.id);
      const pill = cr ? `<span class="at-pill is-ok">สร้างแล้ว${cr.shop_code ? " · " + escHtml(cr.shop_code) : ""}</span>`
        : st.key === "approved" ? `<span class="at-pill is-warn">รอสร้างร้าน</span>`
        : `<span class="at-pill${st.done ? " is-off" : ""}">${escHtml(st.label)}</span>`;
      return `<tr>
        <td><b>${escHtml(r.shop_name || "-")}</b><br><small class="at-dim">${escHtml(nsDocNo(r))}${r.approved_at && st.key === "approved" ? " · อนุมัติ " + escHtml(formatDateTimeTH(r.approved_at)) : ""}</small></td>
        <td>${escHtml([s.district, r.province || s.province].filter(Boolean).join(" · ") || "-")}</td>
        <td>${escHtml(r.sale_name || "-")}</td>
        <td>${escHtml(s.shop_type || "-")}<br><small class="at-dim">${escHtml(nsPayText(s))}</small></td>
        <td>${pill}</td>
        <td class="c-act"><div class="at-actions">
          <button type="button" class="at-btn-ghost" onclick="NSR.view('${id}')"><span class="material-symbols-outlined">description</span>เอกสาร</button>
          ${st.key === "approved" && !cr ? `<button type="button" class="at-btn-primary" onclick="NSR.openCreate('${id}')"><span class="material-symbols-outlined">add_business</span>สร้างร้าน</button>` : ""}
        </div></td></tr>`;
    }).join("");
  }

  async function fullRow(id) {
    const { data, error } = await supabaseClient.from("approval_requests").select("*").eq("id", id).maybeSingle();
    if (error || !data) throw error || new Error("ไม่พบคำขอ");
    await nsResolvePhotos(data);
    return data;
  }

  async function view(id) {
    $("docTitle").textContent = "กำลังโหลด..."; $("docBody").innerHTML = ""; $("docModal").hidden = false;
    try {
      const r = await fullRow(id);
      const html = nsBuildDocHTML({ ...nsDocFromRow(r), approver_signature: r.approval_signature || r.exec_signature || null });
      $("docTitle").textContent = `${nsDocNo(r)} · ${r.shop_name || ""}`;
      $("docBody").innerHTML = html;
      $("docPrint").onclick = () => spOpenPrint(nsPrintPage(html));
    } catch (e) { $("docBody").innerHTML = `<p>เปิดเอกสารไม่สำเร็จ: ${escHtml(e.message || "")}</p>`; }
  }

  async function loadSales() {
    if (sales.length) return;
    try {
      const { data } = await supabaseClient.from("profiles").select("id, display_name, full_name, role, status").in("role", ["sales", "sale", "manager"]).order("display_name");
      sales = (data || []).filter((p) => String(p.status || "active").toLowerCase() === "active");
    } catch (e) { sales = []; }
  }

  async function openCreate(id) {
    err("");
    try {
      cur = await fullRow(id);
      if (created(cur)) { toast("คำขอนี้สร้างร้านไปแล้ว", true); await load(); return; }
      await loadSales();
      const s = nsShop(cur), photos = nsPhotos(cur), storagePhotos = photos.filter((p) => p.path);
      $("fName").value = s.shop_name || cur.shop_name || "";
      $("fCode").value = "";
      $("fProvince").value = s.province || cur.province || "";
      $("fAddress").value = nsAddress(s);
      $("fContact").value = s.contact_name || "";
      $("fPhone").value = s.phone || "";
      $("fLine").value = s.line_id || "";
      $("fMap").value = nsMapUrl(s);
      const opts = sales.map((p) => `<option value="${escHtml(p.id)}"${p.id === cur.request_by ? " selected" : ""}>${escHtml(p.display_name || p.full_name || p.id)}${p.role === "manager" ? " (Manager)" : ""}</option>`);
      if (!sales.some((p) => p.id === cur.request_by)) opts.unshift(`<option value="${escHtml(cur.request_by || "")}" selected>${escHtml(cur.sale_name || "ผู้ขอ")}</option>`);
      $("fSale").innerHTML = opts.join("");
      $("fPhotosWrap").hidden = !storagePhotos.length;
      $("fPhotos").checked = true;
      $("fPhotosText").textContent = `ใช้รูปร้านจากคำขอ (${storagePhotos.length} รูป) เป็นรูปร้าน`;
      const dups = await nsFindSimilarShops($("fName").value);
      $("cNote").className = `at-note${dups.length ? " is-warn" : ""}`;
      $("cNote").innerHTML = dups.length
        ? `<b>มีร้านชื่อคล้ายกันในระบบแล้ว</b> — ตรวจว่าไม่ใช่ร้านเดิม: ${dups.slice(0, 4).map(escHtml).join(", ")}`
        : `คำขอ ${escHtml(nsDocNo(cur))} · เซลล์ ${escHtml(cur.sale_name || "-")} · ผู้บริหารอนุมัติ ${escHtml(formatDateTimeTH(cur.approved_at))}`;
      $("createModal").hidden = false;
      setTimeout(() => $("fCode").focus(), 50);
    } catch (e) { toast("เปิดคำขอไม่สำเร็จ: " + (e.message || e), true); }
  }

  function err(m) { $("cErr").textContent = m; $("cErr").hidden = !m; }

  async function save() {
    if (busy || !cur) return;
    const name = $("fName").value.trim(), code = $("fCode").value.trim(), province = $("fProvince").value.trim(), saleId = $("fSale").value;
    if (!name) { $("fName").focus(); return err("กรุณาใส่ชื่อร้าน"); }
    if (!saleId) return err("กรุณาเลือกเซลล์ที่ดูแล");
    busy = true; $("cSave").disabled = true; err("");
    try {
      if (code) {
        const { data: ex } = await supabaseClient.from("shops").select("id, shop_name").eq("shop_code", code).limit(1);
        if (ex && ex.length) throw new Error(`รหัสลูกค้า ${code} มีอยู่แล้ว (${ex[0].shop_name})`);
      }
      // 1) ร้าน
      const { data: shop, error: e1 } = await supabaseClient.from("shops")
        .insert({ shop_name: name, shop_code: code || null, province: province || null, sale_id: saleId, status: "active" }).select("id").single();
      if (e1) throw e1;
      const me = window.currentUser || {};
      // 2) รายละเอียดร้าน (ไม่สำเร็จ = เตือน แต่ร้านถูกสร้างแล้ว)
      let detailWarn = "";
      try {
        const images = $("fPhotos").checked ? nsPhotos(cur).filter((p) => p.path).map((p) => p.path) : [];
        const { error: e2 } = await supabaseClient.from("shop_details").upsert({
          shop_id: shop.id, address: $("fAddress").value.trim() || null, maps_url: $("fMap").value.trim() || null,
          phone: $("fPhone").value.trim() || null, contact_name: $("fContact").value.trim() || null, line_id: $("fLine").value.trim() || null,
          note: `เปิดจากคำขอ ${nsDocNo(cur)}`, ...(images.length ? { images } : {}), updated_by: me.id || null,
        }, { onConflict: "shop_id" });
        if (e2) throw e2;
      } catch (e) { console.warn("shop_details:", e); detailWarn = " (บันทึกรายละเอียดร้านไม่สำเร็จ — แก้ได้ที่หน้าร้านของเซลล์)"; }
      // 3) ผูกกับคำขอ (กันสร้างซ้ำ)
      const shop_created = { shop_id: shop.id, shop_code: code || null, at: new Date().toISOString(), by: me.id || null, by_name: me.display_name || me.full_name || "Admin" };
      const { error: e3 } = await supabaseClient.from("approval_requests").update({ payload: { ...(cur.payload || {}), shop_created }, updated_at: new Date().toISOString() }).eq("id", cur.id).select("id");
      if (e3) console.warn("mark request:", e3);
      // 4) แจ้งเซลล์
      window.eaApprovalNotify?.notifyDecision({ type: NS_TYPE, requesterId: cur.request_by, shopName: name, decision: "shop_created", by: "Admin", extra: code ? `รหัสลูกค้า ${code}` : "" });
      close("createModal");
      toast(`สร้างร้าน “${name}” แล้ว${detailWarn}`, !!detailWarn);
      await load();
    } catch (e) {
      err("สร้างร้านไม่สำเร็จ: " + (e.message || e));
    } finally { busy = false; $("cSave").disabled = false; }
  }

  function close(id) { $(id).hidden = true; }
  let _t = null;
  function toast(msg, bad) {
    const el = $("toast"); el.textContent = msg; el.classList.toggle("is-err", !!bad); el.classList.add("is-show");
    clearTimeout(_t); _t = setTimeout(() => el.classList.remove("is-show"), 3500);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    for (let i = 0; i < 50 && typeof supabaseClient === "undefined"; i++) await new Promise((r) => setTimeout(r, 100));
    if (typeof supabaseClient === "undefined") return;
    document.querySelectorAll(".an-filters .at-chip").forEach((b) => b.addEventListener("click", () => {
      tab = b.dataset.f;
      document.querySelectorAll(".an-filters .at-chip").forEach((x) => x.classList.toggle("is-on", x === b));
      render();
    }));
    $("q").addEventListener("input", render);
    $("cSave").addEventListener("click", save);
    ["docModal", "createModal"].forEach((id) => $(id).addEventListener("click", (e) => { if (e.target.id === id) close(id); }));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { close("docModal"); close("createModal"); } });
    load();
  });

  return { load, view, openCreate, close };
})();
window.NSR = NSR;
