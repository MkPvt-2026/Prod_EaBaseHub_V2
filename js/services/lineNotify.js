// /js/services/lineNotify.js

const SUPABASE_URL      = "https://vhazgytcfvjhhikiqpwm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZoYXpneXRjZnZqaGhpa2lxcHdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2NjA1MjgsImV4cCI6MjA4NjIzNjUyOH0.wHHUPop0xMrUgX6X8Jkk-fahVfIMW-iYx4NT0zg5lxM";

export async function sendLineNotify(data) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/send-line-notify`,
      {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify(data),
      }
    );

    const result = await res.json();
    console.log("✅ LINE Notify response:", result);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${JSON.stringify(result)}`);
    }

    return result;
  } catch (err) {
    console.error("❌ sendLineNotify failed:", err.message);
    throw err;
  }
}