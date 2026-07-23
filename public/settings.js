function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        },
        ...options
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
    }

    return data;
}

function setChecked(id, value) {
    const input = document.getElementById(id);
    if (input) input.checked = Boolean(value);
}

function getChecked(id) {
    return Boolean(document.getElementById(id)?.checked);
}

function setValue(id, value) {
    const input = document.getElementById(id);
    if (input) input.value = value ?? "";
}

function getValue(id) {
    return document.getElementById(id)?.value || "";
}

function getQuietHoursDurationMinutes(startValue, endValue, enabled) {
    if (!enabled) return 0;

    const [startHours, startMinutes] = String(startValue || "22:00").split(":").map(Number);
    const [endHours, endMinutes] = String(endValue || "09:00").split(":").map(Number);
    const start = (startHours * 60) + startMinutes;
    const end = (endHours * 60) + endMinutes;

    if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return 0;

    return start < end
        ? end - start
        : (24 * 60) - start + end;
}

function getQuietHoursValidationError(payload) {
    const quiet = payload?.quietHours || {};
    const quietMinutes = getQuietHoursDurationMinutes(quiet.start, quiet.end, quiet.enabled);
    const reachableMinutes = (24 * 60) - quietMinutes;

    return quiet.enabled && reachableMinutes < 8 * 60
        ? "Ruhezeit zu lang. Du musst mindestens 8 Stunden pro Tag erreichbar bleiben. Maximal erlaubt sind 16 Stunden Ruhezeit."
        : "";
}

function setQuietHoursError(message = "") {
    const status = document.getElementById("settingsSaveStatus");

    if (!status) return;

    status.textContent = message;
    status.classList.toggle("settings-error-text", Boolean(message));
}

function validateQuietHours(payload) {
    const message = getQuietHoursValidationError(payload);

    setQuietHoursError(message);

    if (message) {
        throw new Error(message);
    }
}

function updateQuietHoursError() {
    setQuietHoursError(getQuietHoursValidationError(collectSettings()));
}

function applyWhiteMode(enabled) {
    document.documentElement.classList.toggle("white-mode", Boolean(enabled));
    document.body.classList.toggle("white-mode", Boolean(enabled));
}

function getSafeStartPages(data) {
    const canUseAdmin = Boolean(data?.canUseAdminStartPage);
    const pages = Array.isArray(data?.allowedStartPages) ? data.allowedStartPages : [];

    return pages.filter(page => page?.value !== "/admin" || canUseAdmin);
}

function renderStartPages(data, selected) {
    const select = document.getElementById("startPage");
    if (!select) return;

    const pages = getSafeStartPages(data);
    const allowedValues = new Set(pages.map(page => page.value));
    const safeSelected = allowedValues.has(selected) ? selected : "/";

    select.innerHTML = pages.map(page =>
        `<option value="${escapeHtml(page.value)}" ${page.value === safeSelected ? "selected" : ""}>${escapeHtml(page.label)}</option>`
    ).join("");
}

function fillSettings(data) {
    const settings = data.settings || {};

    renderStartPages(data, settings.startPage || "/");

    setChecked("quietHoursEnabled", settings.quietHours?.enabled);
    setValue("quietHoursStart", settings.quietHours?.start || "22:00");
    setValue("quietHoursEnd", settings.quietHours?.end || "09:00");

    setChecked("loginRecapEnabled", settings.loginRecap?.enabled !== false);
    setChecked("loginRecapTasks", settings.loginRecap?.includeTasks !== false);
    setChecked("loginRecapOverdue", settings.loginRecap?.includeOverdue !== false);
    setChecked("loginRecapForum", settings.loginRecap?.includeForum !== false);
    setChecked("loginRecapAbsences", settings.loginRecap?.includeAbsences !== false);

    setChecked("whiteModeEnabled", settings.appearance?.whiteMode);
    applyWhiteMode(settings.appearance?.whiteMode);
    updateQuietHoursError();
}

function collectSettings() {
    return {
        startPage: document.querySelector('#startPage option[value="/admin"]')
            ? getValue("startPage")
            : (getValue("startPage") === "/admin" ? "/" : getValue("startPage")),
        quietHours: {
            enabled: getChecked("quietHoursEnabled"),
            start: getValue("quietHoursStart") || "22:00",
            end: getValue("quietHoursEnd") || "09:00"
        },
        loginRecap: {
            enabled: getChecked("loginRecapEnabled"),
            includeTasks: getChecked("loginRecapTasks"),
            includeOverdue: getChecked("loginRecapOverdue"),
            includeForum: getChecked("loginRecapForum"),
            includeAbsences: getChecked("loginRecapAbsences")
        },
        appearance: {
            whiteMode: getChecked("whiteModeEnabled")
        }
    };
}

async function loadCurrentUser() {
    try {
        const data = await apiRequest("me?t=" + Date.now());
        const badge = document.getElementById("userBadge");

        if (badge && data.user) {
            badge.textContent = data.user.globalName || data.user.username || "Angemeldet";
        }
    } catch (_) {}
}

async function loadSettings() {
    const data = await apiRequest("api/me/settings?t=" + Date.now());
    fillSettings(data);
}

async function saveSettings() {
    const button = document.getElementById("saveSettingsBtn");
    const status = document.getElementById("settingsSaveStatus");
    const payload = collectSettings();
    validateQuietHours(payload);

    if (button) {
        button.disabled = true;
        button.textContent = "Speichert...";
    }

    try {
        const data = await apiRequest("api/me/settings", {
            method: "PUT",
            body: JSON.stringify(payload)
        });

        fillSettings({
            settings: data.settings,
            allowedStartPages: Array.from(document.getElementById("startPage")?.options || []).map(option => ({
                value: option.value,
                label: option.textContent
            }))
        });

        if (status) {
            status.textContent = "Gespeichert.";
            status.classList.add("success");
        }

        setTimeout(() => {
            if (status) {
                status.textContent = "";
                status.classList.remove("success");
            }
        }, 2500);
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = "Einstellungen speichern";
        }
    }
}

function setupSettingsEvents() {
    document.getElementById("saveSettingsBtn")?.addEventListener("click", () => {
        saveSettings().catch(error => alert(error.message));
    });

    document.getElementById("whiteModeEnabled")?.addEventListener("change", event => {
        applyWhiteMode(event.target.checked);
    });

    ["quietHoursEnabled", "quietHoursStart", "quietHoursEnd"].forEach(id => {
        const input = document.getElementById(id);

        input?.addEventListener("change", updateQuietHoursError);
        input?.addEventListener("input", updateQuietHoursError);
    });
}

async function init() {
    setupSettingsEvents();
    await loadCurrentUser();
    await loadSettings();
}

init().catch(error => {
    const status = document.getElementById("settingsSaveStatus");
    if (status) status.textContent = `Fehler: ${error.message}`;
});
