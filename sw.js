// ==============================
// Service Worker (PWA)
// ==============================

self.addEventListener("install", event => {
  console.log("Service Worker installed");
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  console.log("Service Worker activated");
});

self.addEventListener("fetch", event => {
  // ตอนนี้ยังไม่ cache อะไร แค่ให้ browser รู้ว่า SW ทำงาน
});
