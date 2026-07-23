(() => {
    const DETAIL_PAGE = /\/tasks\/[^/]+\/?$/.test(window.location.pathname);
    const PREFIX = DETAIL_PAGE ? "../" : "";

    let cachedSettingsPayload = null;

    function escapeHtml(value) {
        return String(value || "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    async function fetchJson(url, options = {}) {
        const response = await fetch(url, {
            cache: "no-store",
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

    function applyAppearance(settings) {
        const whiteMode = Boolean(settings?.appearance?.whiteMode);
        document.body.classList.toggle("white-mode", whiteMode);
        document.documentElement.classList.toggle("white-mode", whiteMode);
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

    function setPersonalQuietHoursError(message = "") {
        const errorBox = document.getElementById("personalQuietHoursError");

        if (!errorBox) return;

        errorBox.textContent = message;
        errorBox.classList.toggle("hidden", !message);
    }

    function getPersonalQuietHoursValidationError(payload) {
        const quiet = payload?.quietHours || {};
        const quietMinutes = getQuietHoursDurationMinutes(quiet.start, quiet.end, quiet.enabled);
        const reachableMinutes = (24 * 60) - quietMinutes;

        return quiet.enabled && reachableMinutes < 8 * 60
            ? "Ruhezeit zu lang. Du musst mindestens 8 Stunden pro Tag erreichbar bleiben. Maximal erlaubt sind 16 Stunden Ruhezeit."
            : "";
    }

    function validatePersonalQuietHours(payload) {
        const message = getPersonalQuietHoursValidationError(payload);

        setPersonalQuietHoursError(message);

        if (message) {
            throw new Error(message);
        }
    }

    function updatePersonalQuietHoursError() {
        setPersonalQuietHoursError(getPersonalQuietHoursValidationError(collectPersonalSettingsModal()));
    }

    function getSafeStartPages(data) {
        const canUseAdmin = Boolean(data?.canUseAdminStartPage);
        const pages = Array.isArray(data?.allowedStartPages) ? data.allowedStartPages : [];

        return pages.filter(page => page?.value !== "/admin" || canUseAdmin);
    }

    function renderPersonalStartPages(data, selected = "/") {
        const select = document.getElementById("personalStartPage");
        if (!select) return;

        const pages = getSafeStartPages(data);
        const allowedValues = new Set(pages.map(page => page.value));
        const safeSelected = allowedValues.has(selected) ? selected : "/";

        select.innerHTML = pages.map(page =>
            `<option value="${escapeHtml(page.value)}" ${page.value === safeSelected ? "selected" : ""}>${escapeHtml(page.label)}</option>`
        ).join("");
    }

    function fillPersonalSettingsModal(data) {
        const settings = data?.settings || {};

        renderPersonalStartPages(data, settings.startPage || "/");

        setChecked("personalQuietHoursEnabled", settings.quietHours?.enabled);
        setValue("personalQuietHoursStart", settings.quietHours?.start || "22:00");
        setValue("personalQuietHoursEnd", settings.quietHours?.end || "09:00");

        setChecked("personalLoginRecapEnabled", settings.loginRecap?.enabled !== false);
        setChecked("personalLoginRecapTasks", settings.loginRecap?.includeTasks !== false);
        setChecked("personalLoginRecapOverdue", settings.loginRecap?.includeOverdue !== false);
        setChecked("personalLoginRecapForum", settings.loginRecap?.includeForum !== false);
        setChecked("personalLoginRecapAbsences", settings.loginRecap?.includeAbsences !== false);

        setChecked("personalWhiteModeEnabled", settings.appearance?.whiteMode);
        applyAppearance(settings);
        updatePersonalQuietHoursError();
    }

    function collectPersonalSettingsModal() {
        return {
            startPage: document.querySelector('#personalStartPage option[value="/admin"]')
                ? getValue("personalStartPage")
                : (getValue("personalStartPage") === "/admin" ? "/" : getValue("personalStartPage")),
            quietHours: {
                enabled: getChecked("personalQuietHoursEnabled"),
                start: getValue("personalQuietHoursStart") || "22:00",
                end: getValue("personalQuietHoursEnd") || "09:00"
            },
            loginRecap: {
                enabled: getChecked("personalLoginRecapEnabled"),
                includeTasks: getChecked("personalLoginRecapTasks"),
                includeOverdue: getChecked("personalLoginRecapOverdue"),
                includeForum: getChecked("personalLoginRecapForum"),
                includeAbsences: getChecked("personalLoginRecapAbsences")
            },
            appearance: {
                whiteMode: getChecked("personalWhiteModeEnabled")
            }
        };
    }

    function ensurePersonalSettingsModal() {
        if (document.getElementById("personalSettingsModal")) return;

        const modal = document.createElement("div");
        modal.id = "personalSettingsModal";
        modal.className = "personal-settings-backdrop hidden";
        modal.setAttribute("aria-hidden", "true");
        modal.innerHTML = `
            <section class="personal-settings-modal" role="dialog" aria-modal="true" aria-labelledby="personalSettingsTitle">
                <button id="personalSettingsClose" class="personal-settings-close" type="button" aria-label="Schließen">×</button>

                <div class="personal-settings-modal-head">
                    <span class="eyebrow">Persönlich</span>
                    <h2 id="personalSettingsTitle">Meine Einstellungen</h2>
                    <p>Diese Einstellungen werden nur für deinen Discord-Account gespeichert.</p>
                </div>

                <div class="settings-grid personal-settings-grid">
                    <section class="settings-card">
                        <div>
                            <h3>Startseite nach Login</h3>
                            <p>Wähle, wo du nach dem Discord-Login automatisch landest.</p>
                        </div>
                        <label>
                            Startseite
                            <select id="personalStartPage"></select>
                        </label>
                    </section>

                    <section class="settings-card">
                        <div>
                            <h3>Persönliche Ruhezeiten</h3>
                            <p>Automatische DMs werden während deiner Ruhezeit zwischengespeichert und danach gesendet.</p>
                        </div>
                        <label class="settings-toggle">
                            <input id="personalQuietHoursEnabled" type="checkbox">
                            <span>Ruhezeiten aktivieren</span>
                        </label>
                        <div class="settings-two-col">
                            <label>
                                Von
                                <input id="personalQuietHoursStart" type="time" value="22:00">
                            </label>
                            <label>
                                Bis
                                <input id="personalQuietHoursEnd" type="time" value="09:00">
                            </label>
                        </div>
                        <small class="settings-note">Gilt für automatische Discord-DMs aus dem Teamboard. Maximal 16 Stunden Ruhezeit pro Tag, damit du mindestens 8 Stunden erreichbar bleibst.</small>
                            <div id="personalQuietHoursError" class="settings-error hidden"></div>
                    </section>

                    <section class="settings-card">
                        <div>
                            <h3>„Seit deinem letzten Login“-Popup</h3>
                            <p>Lege fest, ob und welche Änderungen dir beim Login angezeigt werden.</p>
                        </div>
                        <label class="settings-toggle">
                            <input id="personalLoginRecapEnabled" type="checkbox">
                            <span>Popup anzeigen, wenn es neue Änderungen gibt</span>
                        </label>
                        <div class="settings-check-list">
                            <label><input id="personalLoginRecapTasks" type="checkbox"> Neue Aufgaben</label>
                            <label><input id="personalLoginRecapOverdue" type="checkbox"> Überfällig gewordene Aufgaben</label>
                            <label><input id="personalLoginRecapForum" type="checkbox"> Neue Forumseinträge</label>
                            <label><input id="personalLoginRecapAbsences" type="checkbox"> Neue Abmeldungen</label>
                        </div>
                    </section>

                    <section class="settings-card">
                        <div>
                            <h3>Anzeige</h3>
                            <p>Standard bleibt Darkmode. Whitemode kannst du optional aktivieren.</p>
                        </div>
                        <label class="settings-toggle">
                            <input id="personalWhiteModeEnabled" type="checkbox">
                            <span>Whitemode aktivieren</span>
                        </label>
                    </section>
                </div>

                <div class="personal-settings-actions">
                    <span id="personalSettingsSaveStatus"></span>
                    <button id="personalSettingsCancel" type="button">Abbrechen</button>
                    <button id="personalSettingsSave" class="primary" type="button">Speichern</button>
                </div>
            </section>
        `;

        document.body.appendChild(modal);

        document.getElementById("personalSettingsClose")?.addEventListener("click", closePersonalSettingsModal);
        document.getElementById("personalSettingsCancel")?.addEventListener("click", closePersonalSettingsModal);
        document.getElementById("personalSettingsSave")?.addEventListener("click", () => {
            savePersonalSettings().catch(error => alert(error.message));
        });
        document.getElementById("personalWhiteModeEnabled")?.addEventListener("change", event => {
            applyAppearance({ appearance: { whiteMode: event.target.checked } });
        });

        ["personalQuietHoursEnabled", "personalQuietHoursStart", "personalQuietHoursEnd"].forEach(id => {
            const input = document.getElementById(id);

            input?.addEventListener("change", updatePersonalQuietHoursError);
            input?.addEventListener("input", updatePersonalQuietHoursError);
        });

        modal.addEventListener("click", event => {
            if (event.target === modal) {
                closePersonalSettingsModal();
            }
        });

        document.addEventListener("keydown", event => {
            if (event.key === "Escape") {
                closePersonalSettingsModal();
            }
        });
    }

    function openPersonalSettingsModal() {
        ensurePersonalSettingsModal();

        const modal = document.getElementById("personalSettingsModal");
        const status = document.getElementById("personalSettingsSaveStatus");

        if (status) status.textContent = "";

        if (cachedSettingsPayload) {
            fillPersonalSettingsModal(cachedSettingsPayload);
        }

        modal.classList.remove("hidden");
        modal.setAttribute("aria-hidden", "false");

        fetchJson(`${PREFIX}api/me/settings?t=${Date.now()}`)
            .then(data => {
                cachedSettingsPayload = data;
                fillPersonalSettingsModal(data);
            })
            .catch(error => {
                if (status) status.textContent = `Fehler: ${error.message}`;
            });
    }

    function closePersonalSettingsModal() {
        const modal = document.getElementById("personalSettingsModal");

        if (!modal) return;

        modal.classList.add("hidden");
        modal.setAttribute("aria-hidden", "true");
    }

    async function savePersonalSettings() {
        const button = document.getElementById("personalSettingsSave");
        const status = document.getElementById("personalSettingsSaveStatus");
        const payload = collectPersonalSettingsModal();
        validatePersonalQuietHours(payload);

        if (button) {
            button.disabled = true;
            button.textContent = "Speichert...";
        }

        try {
            const data = await fetchJson(`${PREFIX}api/me/settings`, {
                method: "PUT",
                body: JSON.stringify(payload)
            });

            cachedSettingsPayload = {
                settings: data.settings,
                allowedStartPages: cachedSettingsPayload?.allowedStartPages || []
            };

            fillPersonalSettingsModal(cachedSettingsPayload);

            if (status) {
                status.textContent = "Gespeichert.";
                status.classList.add("success");
            }

            setTimeout(closePersonalSettingsModal, 650);
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = "Speichern";
            }
        }
    }

    function buildUserMenu(user) {
        const badge = document.getElementById("userBadge");

        if (!badge || badge.dataset.userMenuReady === "1") return;

        const wrapper = document.createElement("div");
        wrapper.className = "user-menu-wrapper";

        badge.parentNode.insertBefore(wrapper, badge);
        wrapper.appendChild(badge);

        badge.dataset.userMenuReady = "1";
        badge.classList.add("user-menu-toggle");
        badge.setAttribute("role", "button");
        badge.setAttribute("tabindex", "0");
        badge.setAttribute("aria-haspopup", "true");
        badge.setAttribute("aria-expanded", "false");

        const menu = document.createElement("div");
        menu.className = "user-menu-dropdown hidden";
        menu.innerHTML = `
            <button class="user-menu-item user-menu-settings" data-open-personal-settings type="button">Einstellungen</button>
        `;

        wrapper.appendChild(menu);

        const closeMenu = () => {
            menu.classList.add("hidden");
            badge.setAttribute("aria-expanded", "false");
        };

        const toggleMenu = () => {
            const open = menu.classList.toggle("hidden") === false;
            badge.setAttribute("aria-expanded", String(open));
        };

        badge.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            toggleMenu();
        });

        badge.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleMenu();
            }
        });

        menu.addEventListener("click", event => {
            const settingsButton = event.target.closest("[data-open-personal-settings]");

            if (settingsButton) {
                event.preventDefault();
                closeMenu();
                openPersonalSettingsModal();
            }
        });

        document.addEventListener("click", event => {
            if (!wrapper.contains(event.target)) {
                closeMenu();
            }
        });

        if (user) {
            badge.textContent = user.globalName || user.username || "Angemeldet";
        }
    }

    async function initUserMenu() {
        try {
            const [me, settingsResponse] = await Promise.all([
                fetchJson(`${PREFIX}me?t=${Date.now()}`),
                fetchJson(`${PREFIX}api/me/settings?t=${Date.now()}`)
            ]);

            cachedSettingsPayload = settingsResponse;
            applyAppearance(settingsResponse.settings);
            buildUserMenu(me.user);
        } catch (error) {
            console.warn("User-Menü konnte nicht geladen werden:", error);
            buildUserMenu(null);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initUserMenu);
    } else {
        initUserMenu();
    }
})();
