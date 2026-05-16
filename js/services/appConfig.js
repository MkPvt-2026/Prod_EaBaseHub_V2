// /js/config/appConfig.js

const HOSTNAME = window.location.hostname;

// ⚠️ เปลี่ยนเป็นโดเมนเว็บจริงของคุณ
const PROD_HOSTNAME = "prod-eabasehub-v2.pages.dev";

const IS_PROD = HOSTNAME === PROD_HOSTNAME;

export const CURRENT_SUPABASE = IS_PROD
  ? {
      url: "https://kdgmilagtpizwnhwapgl.supabase.co",
      anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkZ21pbGFndHBpenduaHdhcGdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NTYzMjgsImV4cCI6MjA5MDQzMjMyOH0.v-TtDtF7RfwxA-qxpvIBquTI8lBaTkiHQ-M7Maf5jeU",
      env: "PROD",
    }
  : {
      url: "https://vhazgytcfvjhhikiqpwm.supabase.co",
      anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZoYXpneXRjZnZqaGhpa2lxcHdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2NjA1MjgsImV4cCI6MjA4NjIzNjUyOH0.wHHUPop0xMrUgX6X8Jkk-fahVfIMW-iYx4NT0zg5lxM",
      env: "DEV",
    };

console.log("🌱 ENV =", CURRENT_SUPABASE.env);
console.log("🔗 SUPABASE =", CURRENT_SUPABASE.url);