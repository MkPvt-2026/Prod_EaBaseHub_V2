 

    async function loadNav(role) {
      const navFiles = {
        admin: "/pages/components/nav-admin.html",
        adminQc: "/pages/components/nav-Qc.html",
        executive: "/pages/components/nav-executive.html",
        manager: "/pages/components/nav-manager.html"
      };

      const file = navFiles[role];
      if (!file) return;

      try {
        const res = await fetch(file);
        if (!res.ok) return;
        const html = await res.text();
        document.getElementById("navContainer").innerHTML = html;
        setActiveMenu();
      } catch (err) {
        console.error("Error loading nav:", err);
      }
    }

    function setActiveMenu() {
      const links = document.querySelectorAll(".app-nav a");
      const current = window.location.pathname;
      links.forEach(link => {
        if (link.getAttribute("href") === current) {
          link.classList.add("active");
        }
      });
    }

    async function getUserRole(userId) {
      const { data, error } = await supabaseClient
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single();
      return data?.role || null;
    }

    function waitForSupabaseAndLoadNav(maxAttempts = 50) {
      let attempts = 0;

      const check = async () => {
        attempts++;

        if (typeof supabaseClient !== "undefined" && supabaseClient?.auth) {
          try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (session?.user) {
              const role = await getUserRole(session.user.id);
              if (role) loadNav(role);
            }
          } catch (err) {
            console.error("Error loading nav:", err);
          }
        } else if (attempts < maxAttempts) {
          setTimeout(check, 100);
        }
      };

      check();
    }

    document.addEventListener("DOMContentLoaded", () => {
      waitForSupabaseAndLoadNav();
    });
