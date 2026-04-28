/* =============================================
   EABaseHub: ประชาสัมพันธ์ - Homepage Module
   File: announcements.js
   
   Dependencies: supabaseClient.js, userService.js
   ============================================= */

const AnnouncementsModule = (() => {
    // ---- State ----
    let announcements = [];
    let unreadIds = new Set();
    let currentUser = null;

    // ---- Selectors ----
    const SELECTORS = {
        section: '#announceSection',
        list: '#announceList',
        badge: '#announceBadge',
        btnAdd: '#announceBtnAdd',
        modal: '#announceDetailModal',
    };

    // ---- Helpers ----
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                        'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
        return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
    }

    function timeAgo(dateStr) {
        if (!dateStr) return '';
        const now = new Date();
        const d = new Date(dateStr);
        const diff = Math.floor((now - d) / 1000);

        if (diff < 60) return 'เมื่อสักครู่';
        if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`;
        if (diff < 86400) return `${Math.floor(diff / 3600)} ชั่วโมงที่แล้ว`;
        if (diff < 604800) return `${Math.floor(diff / 86400)} วันที่แล้ว`;
        return formatDate(dateStr);
    }

    function getCategoryLabel(cat) {
        const map = {
            general: 'ทั่วไป',
            important: 'สำคัญ',
            update: 'อัปเดต',
            event: 'กิจกรรม'
        };
        return map[cat] || 'ทั่วไป';
    }

    function getCategoryIcon(cat) {
        const map = {
            general: 'campaign',
            important: 'priority_high',
            update: 'update',
            event: 'event'
        };
        return map[cat] || 'campaign';
    }

    // ---- Render ----
    function renderSkeleton() {
        const list = document.querySelector(SELECTORS.list);
        if (!list) return;
        list.innerHTML = Array(3).fill('').map(() => `
            <div class="announce-skeleton">
                <div class="skel-thumb"></div>
                <div style="flex:1">
                    <div class="skel-line w60"></div>
                    <div class="skel-line w80"></div>
                    <div class="skel-line w40"></div>
                </div>
            </div>
        `).join('');
    }

    function renderList() {
        const list = document.querySelector(SELECTORS.list);
        if (!list) return;

        if (announcements.length === 0) {
            list.innerHTML = `
                <div class="announce-empty">
                    <span class="material-symbols-outlined">notifications_off</span>
                    <p>ยังไม่มีประกาศในขณะนี้</p>
                </div>
            `;
            return;
        }

        // Sort: pinned first, then by published_at desc
        const sorted = [...announcements].sort((a, b) => {
            if (a.is_pinned && !b.is_pinned) return -1;
            if (!a.is_pinned && b.is_pinned) return 1;
            return new Date(b.published_at) - new Date(a.published_at);
        });

        list.innerHTML = sorted.map(item => {
            const isUnread = unreadIds.has(item.id);
            const pinClass = item.is_pinned ? 'is-pinned' : '';
            const unreadClass = isUnread ? 'is-unread' : '';
            const hasAttachment = item.attachment_url || item.external_link;

            return `
                <div class="announce-card ${pinClass} ${unreadClass}" 
                     data-id="${item.id}" 
                     onclick="AnnouncementsModule.openDetail('${item.id}')">
                    <div class="announce-card-thumb">
                        ${item.cover_image_url
                            ? `<img src="${escapeHtml(item.cover_image_url)}" alt="" loading="lazy">`
                            : `<span class="material-symbols-outlined">${getCategoryIcon(item.category)}</span>`
                        }
                    </div>
                    <div class="announce-card-body">
                        <div class="announce-card-meta">
                            <span class="announce-category ${escapeHtml(item.category)}">${getCategoryLabel(item.category)}</span>
                            ${item.is_pinned ? '<span class="material-symbols-outlined announce-pin-icon">push_pin</span>' : ''}
                        </div>
                        <h4 class="announce-card-title">${escapeHtml(item.title)}</h4>
                        <p class="announce-card-excerpt">${escapeHtml(item.content)}</p>
                        <div class="announce-card-footer">
                            <span class="announce-card-date">
                                <span class="material-symbols-outlined">schedule</span>
                                ${timeAgo(item.published_at)}
                            </span>
                            ${hasAttachment ? `
                                <span class="announce-card-attachment">
                                    <span class="material-symbols-outlined">attach_file</span>
                                    แนบไฟล์
                                </span>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function updateBadge() {
        const badge = document.querySelector(SELECTORS.badge);
        if (!badge) return;

        const count = unreadIds.size;
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : count;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }

    function renderAdminButton() {
        const btn = document.querySelector(SELECTORS.btnAdd);
        if (!btn) return;

        // Show add button only for admin/manager
        const role = currentUser?.role?.toLowerCase() || '';
        if (['admin', 'adminqc', 'manager'].includes(role)) {
            btn.style.display = 'inline-flex';
        } else {
            btn.style.display = 'none';
        }
    }

    // ---- Detail Modal ----
    function openDetail(id) {
        const item = announcements.find(a => a.id === id);
        if (!item) return;

        // Mark as read
        markAsRead(id);

        const modal = document.querySelector(SELECTORS.modal);
        if (!modal) {
            createDetailModal();
        }

        const overlay = document.querySelector(SELECTORS.modal);
        overlay.innerHTML = `
            <div class="announce-modal" onclick="event.stopPropagation()">
                <button class="announce-modal-close" onclick="AnnouncementsModule.closeDetail()">
                    <span class="material-symbols-outlined">close</span>
                </button>
                ${item.cover_image_url
                    ? `<img class="announce-modal-cover" src="${escapeHtml(item.cover_image_url)}" alt="">`
                    : ''
                }
                <div class="announce-modal-content">
                    <span class="announce-category ${escapeHtml(item.category)}">${getCategoryLabel(item.category)}</span>
                    ${item.is_pinned ? ' <span class="material-symbols-outlined" style="color:#f59e0b;font-size:18px;vertical-align:middle">push_pin</span>' : ''}
                    <h2>${escapeHtml(item.title)}</h2>
                    <div class="announce-modal-info">
                        <span>
                            <span class="material-symbols-outlined">person</span>
                            ${escapeHtml(item.created_by_name || 'ผู้ดูแลระบบ')}
                        </span>
                        <span>
                            <span class="material-symbols-outlined">calendar_today</span>
                            ${formatDate(item.published_at)}
                        </span>
                    </div>
                    <div class="announce-modal-body">${escapeHtml(item.content)}</div>
                    ${(item.attachment_url || item.external_link) ? `
                        <div class="announce-modal-attachments">
                            <h4>ไฟล์แนบ / ลิงก์</h4>
                            ${item.attachment_url ? `
                                <a href="${escapeHtml(item.attachment_url)}" target="_blank" class="announce-attach-link">
                                    <span class="material-symbols-outlined">description</span>
                                    ${escapeHtml(item.attachment_name || 'ดาวน์โหลดไฟล์')}
                                </a>
                            ` : ''}
                            ${item.external_link ? `
                                <a href="${escapeHtml(item.external_link)}" target="_blank" class="announce-attach-link">
                                    <span class="material-symbols-outlined">open_in_new</span>
                                    เปิดลิงก์
                                </a>
                            ` : ''}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;

        overlay.classList.add('active');
        overlay.onclick = () => closeDetail();
        document.body.style.overflow = 'hidden';
    }

    function closeDetail() {
        const overlay = document.querySelector(SELECTORS.modal);
        if (overlay) {
            overlay.classList.remove('active');
            document.body.style.overflow = '';
        }
    }

    function createDetailModal() {
        const div = document.createElement('div');
        div.id = 'announceDetailModal';
        div.className = 'announce-modal-overlay';
        document.body.appendChild(div);
    }

    // ---- Supabase Operations ----
    async function getSupabase() {
        if (window.supabaseClient) return window.supabaseClient;
        // Fallback: wait
        return new Promise((resolve) => {
            const interval = setInterval(() => {
                if (window.supabaseClient) {
                    clearInterval(interval);
                    resolve(window.supabaseClient);
                }
            }, 100);
        });
    }

    async function fetchAnnouncements() {
        try {
            const sb = await getSupabase();
            const { data, error } = await sb
                .from('announcements')
                .select('*')
                .eq('status', 'published')
                .order('is_pinned', { ascending: false })
                .order('published_at', { ascending: false })
                .limit(20);

            if (error) throw error;
            announcements = data || [];
        } catch (err) {
            console.error('[Announcements] Fetch error:', err);
            announcements = [];
        }
    }

    async function fetchUnreadIds() {
        try {
            if (!currentUser?.id) return;

            const sb = await getSupabase();
            const { data: reads, error } = await sb
                .from('announcement_reads')
                .select('announcement_id')
                .eq('user_id', currentUser.id);

            if (error) throw error;

            const readSet = new Set((reads || []).map(r => r.announcement_id));
            unreadIds = new Set();

            announcements.forEach(a => {
                if (!readSet.has(a.id)) {
                    unreadIds.add(a.id);
                }
            });
        } catch (err) {
            console.error('[Announcements] Unread fetch error:', err);
        }
    }

    markAsRead
    // ---- Realtime Subscription ----
    async function subscribeRealtime() {
        try {
            const sb = await getSupabase();
            sb.channel('announcements-changes')
                .on('postgres_changes',
                    { event: '*', schema: 'public', table: 'announcements' },
                    async (payload) => {
                        console.log('[Announcements] Realtime:', payload.eventType);
                        await fetchAnnouncements();
                        await fetchUnreadIds();
                        renderList();
                        updateBadge();
                    }
                )
                .subscribe();
        } catch (err) {
            console.error('[Announcements] Realtime subscribe error:', err);
        }
    }

    // ---- Init ----
    async function init(user) {
        currentUser = user || window.currentUser;

        renderSkeleton();
        renderAdminButton();

        await fetchAnnouncements();
        await fetchUnreadIds();

        renderList();
        updateBadge();

        // Create modal container
        if (!document.querySelector(SELECTORS.modal)) {
            createDetailModal();
        }

        // Subscribe to realtime updates
        subscribeRealtime();

        // Keyboard: ESC to close modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeDetail();
        });
    }

    // ---- Public API ----
    return {
        init,
        openDetail,
        closeDetail,
        refresh: async () => {
            await fetchAnnouncements();
            await fetchUnreadIds();
            renderList();
            updateBadge();
        }
    };
})();