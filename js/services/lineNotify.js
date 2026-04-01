// /js/services/lineNotify.js

const SUPABASE_URL      = "https://kdgmilagtpizwnhwapgl.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkZ21pbGFndHBpenduaHdhcGdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NTYzMjgsImV4cCI6MjA5MDQzMjMyOH0.v-TtDtF7RfwxA-qxpvIBquTI8lBaTkiHQ-M7Maf5jeU";

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