/* =========================================================
   ROLE THEME - สลับสี theme ตาม role ของ user ที่ login
   =========================================================
   วิธีใช้ในหน้า HTML:

   <script src="/js/core/supabaseClient.js"></script>
   <script src="/js/core/roleTheme.js"></script>
   <script>
     document.addEventListener('DOMContentLoaded', () => {
       RoleTheme.init();   // ← เรียกครั้งเดียว
     });
   </script>
   ========================================================= */

const RoleTheme = (() => {

  // role ทั้งหมดที่รองรับ — ต้องตรงกับ class ใน role-colors.css
  const VALID_ROLES = ['admin', 'manager', 'executive', 'adminQc', 'sale', 'user'];

  // Map role ที่อาจสะกดต่างกันใน DB → class ที่ถูกต้อง
  // (เผื่อ DB เก็บเป็น 'admin_qc' หรือ 'ADMIN' ฯลฯ)
  const ROLE_ALIAS = {
    'admin_qc':  'adminQc',
    'adminqc':   'adminQc',
    'admin-qc':  'adminQc',
    'sales':     'sale',
    'users':     'user',
  };

  /**
   * แปลง role string จาก DB ให้เป็น class name ที่ถูกต้อง
   */
  function normalizeRole(role) {
    if (!role) return 'user';                       // default
    const lower = String(role).trim().toLowerCase();
    const aliased = ROLE_ALIAS[lower] || lower;
    return VALID_ROLES.includes(aliased) ? aliased : 'user';
  }

  /**
   * ลบ role class เก่าทั้งหมดออกจาก body
   */
  function clearRoleClasses() {
    VALID_ROLES.forEach(r => {
      document.body.classList.remove(`role-${r}`);
    });
  }

  /**
   * ใส่ role class ใหม่ลงใน body
   * @param {string} role - role string เช่น 'manager', 'admin'
   */
  function applyRole(role) {
    const normalized = normalizeRole(role);
    clearRoleClasses();
    document.body.classList.add(`role-${normalized}`);

    // เก็บไว้ใน localStorage เพื่อโหลดเร็วขึ้นในครั้งต่อไป
    try {
      localStorage.setItem('userRole', normalized);
    } catch (e) {
      console.warn('[RoleTheme] localStorage not available');
    }

    console.log(`[RoleTheme] Applied: role-${normalized}`);
    return normalized;
  }

  /**
   * โหลด role จาก localStorage (เร็วที่สุด — ใช้ก่อน Supabase ตอบ)
   * เพื่อกัน UI กระพริบ (FOUC)
   */
  function applyFromCache() {
    try {
      const cached = localStorage.getItem('userRole');
      if (cached) {
        applyRole(cached);
        return cached;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  /**
   * ดึง role จาก Supabase แล้ว apply
   */
  async function applyFromSupabase() {
    if (typeof supabaseClient === 'undefined' || !supabaseClient?.auth) {
      console.warn('[RoleTheme] supabaseClient not ready');
      return null;
    }

    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session?.user) {
        console.log('[RoleTheme] No session — using default role');
        return null;
      }

      const { data, error } = await supabaseClient
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single();

      if (error) {
        console.error('[RoleTheme] Error fetching role:', error);
        return null;
      }

      if (data?.role) {
        return applyRole(data.role);
      }
    } catch (err) {
      console.error('[RoleTheme] Exception:', err);
    }
    return null;
  }

  /**
   * รอให้ supabaseClient พร้อมก่อน (สูงสุด 5 วินาที)
   */
  function waitForSupabase(maxAttempts = 50) {
    return new Promise((resolve) => {
      let attempts = 0;
      const check = () => {
        attempts++;
        if (typeof supabaseClient !== 'undefined' && supabaseClient?.auth) {
          resolve(true);
        } else if (attempts >= maxAttempts) {
          resolve(false);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  /**
   * ★ Main entry point
   * 1) โหลดจาก cache ทันที (ป้องกันสีกระพริบ)
   * 2) ดึง role จริงจาก Supabase แล้ว apply ทับ
   * 3) ฟัง auth state change — เปลี่ยนสีอัตโนมัติเมื่อ login/logout
   */
  async function init() {
    // STEP 1: โหลดจาก cache ก่อน (sync, เร็วมาก)
    applyFromCache();

    // STEP 2: รอ Supabase แล้วดึง role จริง
    const ready = await waitForSupabase();
    if (!ready) {
      console.warn('[RoleTheme] Supabase timeout — keeping cached role');
      return;
    }

    await applyFromSupabase();

    // STEP 3: ฟัง event auth state change
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        await applyFromSupabase();
      } else if (event === 'SIGNED_OUT') {
        clearRoleClasses();
        try { localStorage.removeItem('userRole'); } catch (e) {}
      }
    });
  }

  /**
   * เปลี่ยน role แบบ manual (ใช้ทดสอบ หรือสำหรับ admin switch view)
   * เรียกใน console: RoleTheme.set('admin')
   */
  function set(role) {
    return applyRole(role);
  }

  /**
   * อ่าน role ปัจจุบันที่ active อยู่
   */
  function current() {
    for (const r of VALID_ROLES) {
      if (document.body.classList.contains(`role-${r}`)) return r;
    }
    return null;
  }

  // ===== Public API =====
  return {
    init,
    set,
    current,
    applyFromCache,
    applyFromSupabase,
  };
})();