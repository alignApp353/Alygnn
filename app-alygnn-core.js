// ==============================
// Alygnn Core
// ==============================

const SUPABASE_URL = "https://auth.alygnn.com";
const SUPABASE_KEY = "sb_publishable_3l8krRh6WCyvKfNumWDBDw_C6CKr7rG";

const sb = supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);

// ------------------------------
// Theme
// ------------------------------

function initTheme() {
    const theme = localStorage.getItem("alygnn-theme") || "system";
    applyTheme(theme);
}

function applyTheme(theme) {

    document.body.classList.remove("light");

    if (theme === "light") {
        document.body.classList.add("light");
    }

    if (
        theme === "system" &&
        window.matchMedia("(prefers-color-scheme: light)").matches
    ) {
        document.body.classList.add("light");
    }
}

function setTheme(theme) {

    localStorage.setItem(
        "alygnn-theme",
        theme
    );

    applyTheme(theme);
}

// ------------------------------
// Navigation
// ------------------------------

function goTo(page) {
    window.location.href = page;
}

// ------------------------------
// Helpers
// ------------------------------

function titleFromEmail(email) {

    if (!email) return "Alygnn Member";

    const first = email.split("@")[0];

    return first
        .replace(/[._-]/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());
}

function getInitials(name) {

    if (!name) return "A";

    return name
        .split(" ")
        .map(x => x[0])
        .join("")
        .substring(0, 2)
        .toUpperCase();
}

// ------------------------------
// Session
// ------------------------------

async function requireSession() {

    const { data } =
        await sb.auth.getSession();

    if (!data.session) {

        window.location.replace(
            "app-login.html"
        );

        return null;
    }

    return data.session;
}

// ------------------------------
// Logout
// ------------------------------

async function logoutUser() {

    try {

        await sb.auth.signOut({
            scope: "global"
        });

    } catch (e) {
        console.log(e);
    }

    localStorage.clear();
    sessionStorage.clear();

    window.location.replace(
        "app-login.html"
    );
}
