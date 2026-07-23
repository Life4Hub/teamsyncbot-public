const RANK_ORDER = [
    "Inhaber",
    "stv. Inhaber",
    "Projektleitung",
    "stv. Projektleitung",
    "Teamleitung",
    "stv. Teamleitung",
    "CCM",
    "stv. CCM",
    "Head Admin | 4Life",
    "Lead Admin | 4Life",
    "Senior Admin | 4Life",
    "Admin | 4Life",
    "Junior Admin | 4Life",
    "Head Moderator | 4Life",
    "Lead Moderator | 4Life",
    "Senior Moderator | 4Life",
    "Moderator | 4Life",
    "Head Support | 4Life",
    "Lead Support | 4Life",
    "Senior Support | 4Life",
    "Support | 4Life",
    "Trail Support | 4Life",
    "Team | 4Life"
];

let currentTeam = [];

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

    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${response.status}`);
    }

    return response.json();
}

async function loadCurrentUser() {
    try {
        const response = await fetch("me?t=" + Date.now());
        if (!response.ok) return;

        const data = await response.json();
        const badge = document.getElementById("userBadge");

        if (badge && data.user) {
            badge.textContent = data.user.globalName || data.user.username || "Angemeldet";
        }
    } catch (error) {
        console.error("Nutzer konnte nicht geladen werden:", error);
    }
}


function getRankIndex(rank) {
    if (!rank) return 999;

    const cleanRank = String(rank)
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

    const index = RANK_ORDER.findIndex(r =>
        r.replace(/\s+/g, " ").trim().toLowerCase() === cleanRank
    );

    return index === -1 ? 999 : index;
}

function getRankClass(rank) {
    const value = String(rank || "").toLowerCase();

    if (value.includes("inhaber")) return "inhaber";
    if (value.includes("projektleitung")) return "projektleitung";
    if (value.includes("teamleitung")) return "teamleitung";
    if (value.includes("ccm")) return "ccm";
    if (value.includes("admin")) return "admin";
    if (value.includes("moderator")) return "moderator";
    if (value.includes("support")) return "support";
    if (value.includes("team")) return "team";

    return "default";
}

function getDepartmentClass(department) {
    const value = String(department || "").toLowerCase();

    if (value.includes("admin leitung")) return "admin-leitung";
    if (value.includes("moderatoren leitung")) return "moderatoren-leitung";
    if (value.includes("support leitung")) return "support-leitung";
    if (value.includes("management leitung")) return "management-leitung";
    if (value.includes("entwickler leitung")) return "entwickler-leitung";
    if (value.includes("cardev leitung")) return "cardev-leitung";
    if (value.includes("event leitung")) return "event-leitung";
    if (value.includes("frakverwaltung leitung")) return "frakverwaltung-leitung";
    if (value.includes("leitung")) return "leitung";

    if (value.includes("management")) return "management";
    if (value.includes("entwickler")) return "entwickler";
    if (value.includes("cardev")) return "cardev";
    if (value.includes("event")) return "event";
    if (value.includes("frakverwaltung")) return "frakverwaltung";

    return "default";
}

function getRoleBadgeClass(role) {
    const value = String(role || "");
    const normalized = value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

    if (normalized.includes("teamwarn")) return "warns";

    if (
        value.includes("Leitung") ||
        value.includes("Management") ||
        value.includes("Entwickler") ||
        value.includes("Cardev") ||
        value.includes("Event") ||
        value.includes("Frakverwaltung")
    ) {
        return `department ${getDepartmentClass(value)}`;
    }

    return `rank ${getRankClass(value)}`;
}

function buildRecognizedRolesHtml(member) {
    const roles = Array.isArray(member.recognizedRoles) && member.recognizedRoles.length > 0
        ? member.recognizedRoles
        : Array.isArray(member.allRoles) && member.allRoles.length > 0
            ? member.allRoles
            : [member.rank, member.department, member.warn].filter(role => role && role !== "Kein Rang" && role !== "Keine Abteilung" && role !== "Keine");

    if (roles.length === 0) {
        return `<span class="badge rank default">Keine erkannte Rolle</span>`;
    }

    return roles.map(role => `
        <span class="badge recognized-role ${getRoleBadgeClass(role)}">
            ${role}
        </span>
    `).join("");
}

let lastTeamSignature = null;

async function loadTeam() {
    try {
        const response = await fetch("team?t=" + Date.now());

        if (!response.ok) {
            console.error("Fehler beim Laden der Teamdaten:", response.status);
            return;
        }

        const data = await response.json();

        if (!data || data.length === 0) {
            console.log("Keine Teamdaten vorhanden, behalte alte Anzeige");
            return;
        }

        // Ohne diesen Vergleich baut das 10-Sekunden-Intervall #teamCards bei jedem
        // Tick komplett neu auf, auch wenn sich nichts geändert hat. Das lässt Avatare
        // neu laden und die Einblend-Animation erneut abspielen -> sichtbares Flackern.
        const signature = JSON.stringify(data);

        if (signature === lastTeamSignature) {
            return;
        }

        lastTeamSignature = signature;
        currentTeam = data;

        const team = [...currentTeam];

        team.sort((a, b) => {
            const rankDiff = getRankIndex(a.rank) - getRankIndex(b.rank);

            if (rankDiff !== 0) return rankDiff;

            return (a.name || a.username || "").localeCompare(
                b.name || b.username || "",
                "de",
                { sensitivity: "base" }
            );
        });

        const container = document.querySelector("#teamCards");
        const isFirstPaint = !container.dataset.rendered;
        container.classList.toggle("first-paint", isFirstPaint);
        container.dataset.rendered = "1";
        container.innerHTML = "";

        let admins = 0;
        let mods = 0;
        let supports = 0;
        let online = 0;

        team.forEach(member => {
            if (member.rank?.includes("Admin")) admins++;
            if (member.rank?.includes("Moderator")) mods++;
            if (member.rank?.includes("Support")) supports++;
            if (member.status === "online") online++;

            container.innerHTML += `
                <div class="staff-card" data-user-id="${member.id || ""}" data-user-name="${escapeHtml(member.name || member.username || "Unbekannt")}">
                    <img src="${member.avatar || "https://cdn.discordapp.com/embed/avatars/0.png"}" class="avatar">

                    <div class="staff-info">
                        <h3>${member.name || member.username || "Unbekannt"}</h3>

                        <small>@${member.username || ""}</small>

                        <p class="status ${member.status || "offline"}">
                            ● ${
                                member.status === "online"
                                    ? "Online"
                                    : member.status === "idle"
                                    ? "Abwesend"
                                    : member.status === "dnd"
                                    ? "Nicht stören"
                                    : "Offline"
                            }
                        </p>

                        <div class="recognized-roles">
                            ${buildRecognizedRolesHtml(member)}
                        </div>
                    </div>
                </div>
            `;
        });

        document.getElementById("teamCount").textContent = team.length;
        document.getElementById("adminCount").textContent = admins;
        document.getElementById("modCount").textContent = mods;
        document.getElementById("supportCount").textContent = supports;

        const onlineCountEl = document.getElementById("onlineCount");
        if (onlineCountEl) onlineCountEl.textContent = online;

        applyFilters();

    } catch (error) {
        console.error("Teamdaten konnten nicht geladen werden:", error);
    }
}


let activePersonRecordUserId = null;

function formatPersonRecordDate(value) {
    if (!value) return "Unbekannt";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "Unbekannt";

    return date.toLocaleString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function getPersonRecordTypeClass(type) {
    const value = String(type || "Neutral").toLowerCase();

    if (value.includes("gut")) return "good";
    if (value.includes("schlecht")) return "bad";

    return "neutral";
}


function clampUploadProgress(value) {
    return Math.max(0, Math.min(100, Number(value || 0)));
}

function downloadUrl(url) {
    if (!url || url === "#") return "#";
    return String(url).includes("?") ? `${url}&download=1` : `${url}?download=1`;
}

function renderUploadFileList(inputId, labelId) {
    const input = document.getElementById(inputId);
    const label = document.getElementById(labelId);
    const files = Array.from(input?.files || []);

    if (!label) return;

    if (!files.length) {
        label.innerHTML = "Keine Dateien ausgewählt";
        return;
    }

    label.innerHTML = `
        <div class="upload-file-list">
            ${files.map((file, index) => `
                <div class="upload-file-row" data-upload-file-index="${index}">
                    <span class="upload-file-name">${escapeHtml(file.name)}${file.size ? ` (${escapeHtml(formatUploadSize(file.size))})` : ""}</span>
                    <div class="upload-mini-progress"><span style="width:0%"></span></div>
                    <small class="upload-file-percent">Bereit</small>
                </div>
            `).join("")}
        </div>
    `;
}

function formatUploadSize(bytes) {
    const size = Number(bytes || 0);

    if (typeof formatFileSize === "function") {
        return formatFileSize(size);
    }

    if (size >= 1024 * 1024 * 1024) return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
    if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;

    return `${size} B`;
}

function setUploadProgress(labelId, files, loaded, total) {
    const label = document.getElementById(labelId);
    if (!label || !Array.isArray(files) || !files.length) return;

    const safeTotal = total || files.reduce((sum, file) => sum + Number(file.size || 0), 0) || 1;
    let offset = 0;

    files.forEach((file, index) => {
        const size = Number(file.size || 0) || safeTotal / files.length;
        const raw = ((loaded - offset) / size) * 100;
        const progress = clampUploadProgress(raw);
        offset += size;

        const row = label.querySelector(`[data-upload-file-index="${index}"]`);
        const bar = row?.querySelector(".upload-mini-progress span");
        const percent = row?.querySelector(".upload-file-percent");

        if (bar) bar.style.width = `${progress}%`;
        if (percent) percent.textContent = progress >= 100 ? "Hochgeladen" : `${Math.round(progress)}%`;
    });
}

function setUploadComplete(labelId) {
    const label = document.getElementById(labelId);
    if (!label) return;

    label.querySelectorAll(".upload-mini-progress span").forEach(bar => {
        bar.style.width = "100%";
    });

    label.querySelectorAll(".upload-file-percent").forEach(percent => {
        percent.textContent = "Hochgeladen";
    });
}

function uploadFormDataWithProgress(url, method, formData, files, labelId) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.open(method, url);

        xhr.upload.addEventListener("progress", event => {
            if (!event.lengthComputable) return;
            setUploadProgress(labelId, files, event.loaded, event.total);
        });

        xhr.addEventListener("load", () => {
            let data = null;

            try {
                data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
            } catch (_) {
                data = xhr.responseText;
            }

            if (xhr.status >= 200 && xhr.status < 300) {
                setUploadComplete(labelId);
                resolve(data);
                return;
            }

            reject(new Error(data?.error || `HTTP ${xhr.status}`));
        });

        xhr.addEventListener("error", () => reject(new Error("Upload fehlgeschlagen.")));
        xhr.addEventListener("abort", () => reject(new Error("Upload abgebrochen.")));

        xhr.send(formData);
    });
}

function setButtonLoading(buttonId, loading, loadingText = "Wird hochgeladen...") {
    const button = document.getElementById(buttonId);
    if (!button) return;

    if (loading) {
        button.dataset.originalText = button.textContent;
        button.textContent = loadingText;
        button.disabled = true;
        button.classList.add("is-uploading");
    } else {
        button.textContent = button.dataset.originalText || button.textContent;
        button.disabled = false;
        button.classList.remove("is-uploading");
    }
}

function renderPersonRecordAttachment(attachment, options = {}) {
    const url = attachment.url || "#";
    const name = attachment.originalName || attachment.fileName || "Datei";
    const mime = String(attachment.mimeType || "").toLowerCase();
    const canDelete = Boolean(options.canDelete);
    const actions = canDelete
        ? `<button class="attachment-delete delete-person-record-attachment" type="button" data-entry-id="${escapeHtml(options.entryId)}" data-attachment-id="${escapeHtml(attachment.id)}">Datei löschen</button>`
        : "";

    if (mime.startsWith("image/")) {
        return `<div class="attachment-item"><a class="attachment-preview image" href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt="${escapeHtml(name)}"><span>${escapeHtml(name)}</span></a><a class="attachment-download" href="${escapeHtml(downloadUrl(url))}" download="${escapeHtml(name)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px;"><path d="M12 4v12m0 0 5-5m-5 5-5-5M5 20h14"/></svg>Download</a>${actions}</div>`;
    }

    if (mime.startsWith("video/")) {
        return `<div class="attachment-item"><div class="attachment-preview video"><video src="${escapeHtml(url)}" controls></video><a href="${escapeHtml(downloadUrl(url))}" download="${escapeHtml(name)}" target="_blank" rel="noopener">${escapeHtml(name)}</a></div>${actions}</div>`;
    }

    return `<div class="attachment-item"><a class="attachment-file" href="${escapeHtml(downloadUrl(url))}" download="${escapeHtml(name)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px;"><path d="M21 12.5 12.5 21a5 5 0 0 1-7-7L14 5.5a3.5 3.5 0 0 1 5 5L10.5 19a2 2 0 0 1-3-3L15 8.5"/></svg>${escapeHtml(name)}</a>${actions}</div>`;
}

function renderPersonRecordAttachments(attachments, options = {}) {
    if (!Array.isArray(attachments) || !attachments.length) return "";

    return `<div class="content-attachments person-record-attachments">${attachments.map(attachment => renderPersonRecordAttachment(attachment, options)).join("")}</div>`;
}

function updatePersonRecordSelectedFiles() {
    renderUploadFileList("personRecordAttachments", "personRecordSelectedFiles");
}

function openPersonRecordModal() {
    const modal = document.getElementById("personRecordModal");

    if (!modal) return;

    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
}

function closePersonRecordModal() {
    const modal = document.getElementById("personRecordModal");

    if (!modal) return;

    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    activePersonRecordUserId = null;
}

function renderPersonRecordEntries(entries = []) {
    const container = document.getElementById("personRecordEntries");

    if (!container) return;

    if (!entries.length) {
        container.innerHTML = `<div class="person-record-empty">Noch keine Einträge vorhanden.</div>`;
        return;
    }

    container.innerHTML = entries.map(entry => `
        <div class="person-record-entry ${getPersonRecordTypeClass(entry.type)}">
            <div class="person-record-entry-head">
                <span>${escapeHtml(entry.type || "Neutral")}</span>
                <small>${escapeHtml(formatPersonRecordDate(entry.createdAt))} · ${escapeHtml(entry.createdByName || "Unbekannt")}</small>
            </div>
            ${entry.note ? `<p>${escapeHtml(entry.note || "")}</p>` : ""}
            ${renderPersonRecordAttachments(entry.attachments, { entryId: entry.id, canDelete: true })}
            <button class="person-record-delete" type="button" data-entry-id="${escapeHtml(entry.id)}">Löschen</button>
        </div>
    `).join("");
}

async function loadPersonRecord(userId) {
    const modal = document.getElementById("personRecordModal");
    const denied = document.getElementById("personRecordAccessDenied");
    const content = document.getElementById("personRecordContent");
    const title = document.getElementById("personRecordTitle");
    const subtitle = document.getElementById("personRecordSubtitle");
    const avatar = document.getElementById("personRecordAvatar");

    if (!modal || !userId) return;

    activePersonRecordUserId = userId;
    openPersonRecordModal();

    denied?.classList.add("hidden");
    content?.classList.add("hidden");

    if (title) title.textContent = "Team-Akte";
    if (subtitle) subtitle.textContent = "Lade Daten...";

    const response = await fetch(`api/person-records/${encodeURIComponent(userId)}?t=${Date.now()}`);

    if (!response.ok) {
        if (title) title.textContent = "Team-Akte";
        if (subtitle) subtitle.textContent = "Fehler beim Laden";
        if (denied) {
            denied.textContent = "Akte konnte nicht geladen werden.";
            denied.classList.remove("hidden");
        }
        return;
    }

    const data = await response.json();
    const person = data.person || {};

    if (title) title.textContent = person.name || "Team-Akte";
    if (subtitle) {
        subtitle.textContent = [
            person.username ? "@" + person.username : "",
            person.rank || "",
            person.department || ""
        ].filter(Boolean).join(" · ") || "Teammitglied";
    }
    if (avatar) avatar.src = person.avatar || "https://cdn.discordapp.com/embed/avatars/0.png";

    if (!data.canManage) {
        if (denied) {
            denied.textContent = "Du hast keinen Zugriff auf diese Akte.";
            denied.classList.remove("hidden");
        }
        return;
    }

    content?.classList.remove("hidden");
    renderPersonRecordEntries(data.entries || []);
}

async function savePersonRecordEntry() {
    if (!activePersonRecordUserId) return;

    const type = document.getElementById("personRecordType")?.value || "Neutral";
    const noteInput = document.getElementById("personRecordNote");
    const fileInput = document.getElementById("personRecordAttachments");
    const note = noteInput?.value.trim() || "";
    const files = Array.from(fileInput?.files || []);

    if (!note && files.length === 0) {
        alert("Notiz oder Anhang fehlt.");
        return;
    }

    const formData = new FormData();
    formData.append("type", type);
    formData.append("note", note);

    files.forEach(file => formData.append("attachments", file));

    setButtonLoading("personRecordSave", true);

    try {
        const data = await uploadFormDataWithProgress(`api/person-records/${encodeURIComponent(activePersonRecordUserId)}/entries`, "POST", formData, files, "personRecordSelectedFiles");

        if (noteInput) noteInput.value = "";
        if (fileInput) fileInput.value = "";
        updatePersonRecordSelectedFiles();
        renderPersonRecordEntries(data.entries || []);
    } finally {
        setButtonLoading("personRecordSave", false);
    }
}

async function deletePersonRecordAttachment(entryId, attachmentId) {
    if (!activePersonRecordUserId || !entryId || !attachmentId) return;
    if (!confirm("Diese Datei wirklich löschen? Der Akteneintrag bleibt erhalten.")) return;

    const response = await fetch(`api/person-records/${encodeURIComponent(activePersonRecordUserId)}/entries/${encodeURIComponent(entryId)}/attachments/${encodeURIComponent(attachmentId)}`, {
        method: "DELETE"
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        alert(data.error || "Datei konnte nicht gelöscht werden.");
        return;
    }

    renderPersonRecordEntries(data.entries || []);
}

async function deletePersonRecordEntry(entryId) {
    if (!activePersonRecordUserId || !entryId) return;
    if (!confirm("Eintrag wirklich löschen?")) return;

    const response = await fetch(`api/person-records/${encodeURIComponent(activePersonRecordUserId)}/entries/${encodeURIComponent(entryId)}`, {
        method: "DELETE"
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        alert(data.error || "Eintrag konnte nicht gelöscht werden.");
        return;
    }

    renderPersonRecordEntries(data.entries || []);
}

function setupPersonRecordModal() {
    document.getElementById("personRecordClose")?.addEventListener("click", closePersonRecordModal);

    document.getElementById("personRecordModal")?.addEventListener("click", event => {
        if (event.target?.id === "personRecordModal") {
            closePersonRecordModal();
        }
    });

    document.getElementById("personRecordSave")?.addEventListener("click", () => {
        savePersonRecordEntry().catch(error => alert(error.message));
    });

    document.getElementById("personRecordAttachments")?.addEventListener("change", updatePersonRecordSelectedFiles);

    document.getElementById("personRecordEntries")?.addEventListener("click", event => {
        const attachmentButton = event.target.closest(".delete-person-record-attachment");

        if (attachmentButton) {
            event.preventDefault();
            event.stopPropagation();
            deletePersonRecordAttachment(attachmentButton.dataset.entryId, attachmentButton.dataset.attachmentId).catch(error => alert(error.message));
            return;
        }

        const button = event.target.closest(".person-record-delete");

        if (!button) return;

        deletePersonRecordEntry(button.dataset.entryId).catch(error => alert(error.message));
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            closePersonRecordModal();
        }
    });
}


function formatRecapSince(value, fallbackDays = 0) {
    if (!value) {
        return fallbackDays
            ? `Vergleich: die letzten ${fallbackDays} Tage`
            : "Noch kein vorheriger Login vorhanden.";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "Seit deinem letzten Login";

    return `Seit ${date.toLocaleString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    })}`;
}

function recapCard(label, value, hint, href = "") {
    const inner = `
        <strong>${escapeHtml(value)}</strong>
        <span>${escapeHtml(label)}</span>
        <small>${escapeHtml(hint)}</small>
    `;

    return href
        ? `<a class="login-recap-card" href="${escapeHtml(href)}">${inner}</a>`
        : `<div class="login-recap-card">${inner}</div>`;
}

let loginRecapSeenMarked = false;

async function markLoginRecapSeen(data) {
    if (loginRecapSeenMarked) return;

    loginRecapSeenMarked = true;

    try {
        await apiRequest("api/me/changes/seen", {
            method: "POST",
            body: JSON.stringify({
                since: data?.since || null,
                total: Number(data?.total || 0)
            })
        });
    } catch (error) {
        loginRecapSeenMarked = false;
        console.warn("Login-Rückblick konnte nicht als gesehen markiert werden:", error);
    }
}

function closeLoginRecapPopup() {
    const popup = document.getElementById("loginRecapPopup");

    if (!popup) return;

    popup.classList.add("hidden");
    popup.setAttribute("aria-hidden", "true");
}

function renderLoginRecap(data) {
    const popup = document.getElementById("loginRecapPopup");
    const grid = document.getElementById("loginRecapGrid");
    const since = document.getElementById("loginRecapSince");

    if (!popup || !grid || !since) return;

    const total = Number(data?.total || 0);

    if (total <= 0) {
        closeLoginRecapPopup();
        return;
    }

    since.textContent = formatRecapSince(data.since, data.fallbackDays || 0);

    grid.innerHTML = [
        recapCard("neue Aufgaben", data.tasks?.new || 0, "neu im Aufgabenmodul", "tasks"),
        recapCard("überfällig geworden", data.tasks?.overdue || 0, "seit deinem letzten Login", "tasks"),
        recapCard("neue Forumseinträge", data.forum?.new || 0, "im Forum", "forum"),
        recapCard("neue Abmeldungen", data.absences?.new || 0, "seit dem letzten Login", "absences")
    ].join("");

    popup.classList.remove("hidden");
    popup.setAttribute("aria-hidden", "false");

    // Direkt als gesehen markieren, damit das Popup bei F5 oder erneutem Öffnen
    // nicht immer wieder mit denselben Änderungen auftaucht.
    markLoginRecapSeen(data);
}

async function loadLoginRecap() {
    try {
        const data = await apiRequest("api/me/changes?t=" + Date.now());
        renderLoginRecap(data);
    } catch (error) {
        console.warn("Login-Übersicht konnte nicht geladen werden:", error);
    }
}

const ONBOARDING_STEPS = [
    {
        type: "start-page-settings",
        title: "Startseite nach Login",
        text: "Wähle, wo du nach dem Discord-Login automatisch landen möchtest.",
        action: "Diese Auswahl kannst du später jederzeit über Einstellungen ändern."
    },
    {
        type: "quiet-hours-settings",
        title: "Persönliche Ruhezeiten",
        text: "Du kannst optional Ruhezeiten festlegen. Automatische DMs werden während dieser Zeit zwischengespeichert und danach gesendet.",
        action: "Dieser Schritt ist optional. Wenn du keine Ruhezeiten willst, lasse den Haken einfach aus."
    },
    {
        type: "appearance-settings",
        title: "Anzeige",
        text: "Wähle, ob du TeamSync im normalen Darkmode oder im Whitemode nutzen möchtest.",
        action: "Standard ist Darkmode. Whitemode kannst du später jederzeit über Einstellungen ändern."
    },
    {
        title: "Willkommen im Teamboard",
        text: "Das Teamboard bündelt Teamübersicht, Aufgaben, Abmeldungen, Akten, Forum, Clips, Livechat und interne Auswertungen. Nutze die Navigation oben, um zwischen den Bereichen zu wechseln.",
        action: "Verschaffe dir zuerst einen Überblick über die Teammitglieder und Rollen auf dieser Startseite."
    },
    {
        title: "Aufgaben richtig nutzen",
        text: "Im Aufgabenbereich kannst du Aufgaben anlegen, Zuständige auswählen, Prioritäten setzen, Fristen vergeben und im Detailbereich mit Dateien oder Kommentaren arbeiten.",
        action: "Erstelle später deine erste echte Aufgabe nur mit klarer Zuständigkeit und verständlicher Beschreibung."
    },
    {
        title: "Abmeldungen und Kalender",
        text: "Abmeldungen werden gesammelt, geprüft und im Kalender sichtbar gemacht. Unklare Abmeldungen müssen kontrolliert werden, akzeptierte Abmeldungen wirken sich auf Auswertungen aus.",
        action: "Kontrolliere bei Abmeldungen immer Status, Zeitraum und Zuordnung zum richtigen Account."
    },
    {
        title: "Kommunikation und Nachweise",
        text: "Forum, Aktenarchiv, Clips/Beweise und Livechat sind für interne Abstimmungen, Nachweise und strukturierte Teamarbeit gedacht. Lade nur relevante Dateien hoch.",
        action: "Nutze Akten und Beweise sachlich. Keine privaten oder unnötigen Inhalte ablegen."
    },
    {
        title: "Voice-Zeiten und Aktivität",
        text: "Voice-Zeiten helfen der Leitung, Aktivität zu bewerten. Abmeldungen werden berücksichtigt. Fehlzeiten sollten nachvollziehbar sein.",
        action: "Wenn du verhindert bist, nutze das Abmeldungssystem statt einfach inaktiv zu sein."
    },
    {
        title: "Fertig",
        text: "Du kennst jetzt die Grundbereiche. Dieses Onboarding erscheint nur einmal pro Onboarding-Version.",
        action: "Markiere die Einführung als erledigt und nutze das Teamboard normal weiter."
    }
];

let onboardingStepIndex = 0;
let onboardingSettingsPayload = null;

function ensureOnboardingModal() {
    if (document.getElementById("teamSyncOnboarding")) return;

    const modal = document.createElement("div");
    modal.id = "teamSyncOnboarding";
    modal.className = "onboarding-backdrop hidden";
    modal.innerHTML = `
        <section class="onboarding-card" role="dialog" aria-modal="true" aria-labelledby="onboardingTitle">
            <div class="onboarding-top">
                <span class="eyebrow">TeamSync Einführung</span>
                <strong id="onboardingProgressLabel">Schritt 1/${ONBOARDING_STEPS.length}</strong>
            </div>

            <div class="onboarding-progress">
                <span id="onboardingProgressBar"></span>
            </div>

            <h2 id="onboardingTitle"></h2>
            <p id="onboardingText"></p>

            <div class="onboarding-action-box">
                <strong>Was wichtig ist:</strong>
                <span id="onboardingAction"></span>
            </div>

            <div id="onboardingSettingsPanel" class="onboarding-settings-panel hidden">
                <div id="onboardingStartPagePanel" class="onboarding-settings-step hidden" data-onboarding-settings-step="start-page-settings">
                    <label>
                        Startseite nach Login
                        <select id="onboardingStartPage"></select>
                    </label>
                    <small>Admin wird nur angeboten, wenn du die Rechte dafür hast.</small>
                </div>

                <div id="onboardingQuietHoursPanel" class="onboarding-settings-step hidden" data-onboarding-settings-step="quiet-hours-settings">
                    <div class="onboarding-settings-card">
                        <label class="onboarding-toggle">
                            <input id="onboardingQuietHoursEnabled" type="checkbox">
                            <span>Persönliche Ruhezeiten aktivieren</span>
                        </label>
                        <div class="onboarding-settings-two-col">
                            <label>
                                Von
                                <input id="onboardingQuietHoursStart" type="time" value="22:00">
                            </label>
                            <label>
                                Bis
                                <input id="onboardingQuietHoursEnd" type="time" value="09:00">
                            </label>
                        </div>
                        <small>Optional. Maximal 16 Stunden Ruhezeit pro Tag, damit du mindestens 8 Stunden erreichbar bleibst.</small>
                        <div id="onboardingQuietHoursError" class="settings-error hidden"></div>
                    </div>
                </div>

                <div id="onboardingAppearancePanel" class="onboarding-settings-step hidden" data-onboarding-settings-step="appearance-settings">
                    <div class="onboarding-settings-card">
                        <label class="onboarding-toggle">
                            <input id="onboardingWhiteModeEnabled" type="checkbox">
                            <span>Whitemode aktivieren</span>
                        </label>
                        <small>Standard ist Darkmode. Du kannst das später jederzeit in „Einstellungen“ ändern.</small>
                    </div>
                </div>
            </div>

            <div class="onboarding-nav">
                <button id="onboardingBack" type="button">Zurück</button>
                <button id="onboardingNext" type="button">Weiter</button>
                <button id="onboardingComplete" class="primary hidden" type="button">Einführung abschließen</button>
            </div>
        </section>
    `;

    document.body.appendChild(modal);

    document.getElementById("onboardingBack")?.addEventListener("click", () => {
        onboardingStepIndex = Math.max(0, onboardingStepIndex - 1);
        renderOnboardingStep();
    });

    document.getElementById("onboardingNext")?.addEventListener("click", () => {
        const step = ONBOARDING_STEPS[onboardingStepIndex];

        if (step?.type === "quiet-hours-settings") {
            try {
                validateOnboardingQuietHours(collectOnboardingSettings());
            } catch (error) {
                alert(error.message);
                return;
            }
        }

        onboardingStepIndex = Math.min(ONBOARDING_STEPS.length - 1, onboardingStepIndex + 1);
        renderOnboardingStep();
    });

    document.getElementById("onboardingWhiteModeEnabled")?.addEventListener("change", event => {
        document.body.classList.toggle("white-mode", event.target.checked);
        document.documentElement.classList.toggle("white-mode", event.target.checked);
    });

    ["onboardingQuietHoursEnabled", "onboardingQuietHoursStart", "onboardingQuietHoursEnd"].forEach(id => {
        const input = document.getElementById(id);

        input?.addEventListener("change", updateOnboardingQuietHoursError);
        input?.addEventListener("input", updateOnboardingQuietHoursError);
    });

    document.getElementById("onboardingComplete")?.addEventListener("click", async () => {
        try {
            const settings = collectOnboardingSettings();
            validateOnboardingQuietHours(settings);

            await apiRequest("api/onboarding/complete", {
                method: "POST",
                body: JSON.stringify({
                    settings
                })
            });

            modal.classList.add("hidden");
        } catch (error) {
            alert(error.message);
        }
    });
}


async function loadOnboardingSettingsPayload() {
    if (onboardingSettingsPayload) return onboardingSettingsPayload;

    onboardingSettingsPayload = await apiRequest("api/me/settings?t=" + Date.now());
    return onboardingSettingsPayload;
}

function getOnboardingAllowedStartPages(data) {
    const canUseAdmin = Boolean(data?.canUseAdminStartPage);
    const pages = Array.isArray(data?.allowedStartPages) ? data.allowedStartPages : [];

    return pages.filter(page => page?.value !== "/admin" || canUseAdmin);
}

function setOnboardingChecked(id, value) {
    const input = document.getElementById(id);
    if (input) input.checked = Boolean(value);
}

function setOnboardingValue(id, value) {
    const input = document.getElementById(id);
    if (input) input.value = value ?? "";
}

function getOnboardingChecked(id) {
    return Boolean(document.getElementById(id)?.checked);
}

function getOnboardingValue(id) {
    return document.getElementById(id)?.value || "";
}

function getOnboardingQuietHoursDurationMinutes(startValue, endValue, enabled) {
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

function setOnboardingQuietHoursError(message = "") {
    const errorBox = document.getElementById("onboardingQuietHoursError");

    if (!errorBox) return;

    errorBox.textContent = message;
    errorBox.classList.toggle("hidden", !message);
}

function getOnboardingQuietHoursValidationError(settings) {
    const quiet = settings?.quietHours || {};
    const quietMinutes = getOnboardingQuietHoursDurationMinutes(quiet.start, quiet.end, quiet.enabled);
    const reachableMinutes = (24 * 60) - quietMinutes;

    return quiet.enabled && reachableMinutes < 8 * 60
        ? "Ruhezeit zu lang. Du musst mindestens 8 Stunden pro Tag erreichbar bleiben. Maximal erlaubt sind 16 Stunden Ruhezeit."
        : "";
}

function validateOnboardingQuietHours(settings) {
    const message = getOnboardingQuietHoursValidationError(settings);

    setOnboardingQuietHoursError(message);

    if (message) {
        throw new Error(message);
    }
}

function updateOnboardingQuietHoursError() {
    setOnboardingQuietHoursError(getOnboardingQuietHoursValidationError(collectOnboardingSettings()));
}

function renderOnboardingSettings(data) {
    const settings = data?.settings || {};
    const select = document.getElementById("onboardingStartPage");
    const pages = getOnboardingAllowedStartPages(data);
    const allowed = new Set(pages.map(page => page.value));
    const selected = allowed.has(settings.startPage) ? settings.startPage : "/";

    if (select) {
        select.innerHTML = pages.map(page =>
            `<option value="${escapeHtml(page.value)}" ${page.value === selected ? "selected" : ""}>${escapeHtml(page.label)}</option>`
        ).join("");
    }

    setOnboardingChecked("onboardingQuietHoursEnabled", settings.quietHours?.enabled);
    setOnboardingValue("onboardingQuietHoursStart", settings.quietHours?.start || "22:00");
    setOnboardingValue("onboardingQuietHoursEnd", settings.quietHours?.end || "09:00");
    setOnboardingChecked("onboardingWhiteModeEnabled", settings.appearance?.whiteMode);

    document.body.classList.toggle("white-mode", Boolean(settings.appearance?.whiteMode));
    document.documentElement.classList.toggle("white-mode", Boolean(settings.appearance?.whiteMode));
}

function collectOnboardingSettings() {
    const startPage = document.querySelector('#onboardingStartPage option[value="/admin"]')
        ? getOnboardingValue("onboardingStartPage")
        : (getOnboardingValue("onboardingStartPage") === "/admin" ? "/" : getOnboardingValue("onboardingStartPage"));

    return {
        startPage: startPage || "/",
        quietHours: {
            enabled: getOnboardingChecked("onboardingQuietHoursEnabled"),
            start: getOnboardingValue("onboardingQuietHoursStart") || "22:00",
            end: getOnboardingValue("onboardingQuietHoursEnd") || "09:00"
        },
        appearance: {
            whiteMode: getOnboardingChecked("onboardingWhiteModeEnabled")
        }
    };
}


function renderOnboardingStep() {
    ensureOnboardingModal();

    const step = ONBOARDING_STEPS[onboardingStepIndex];
    const percent = ((onboardingStepIndex + 1) / ONBOARDING_STEPS.length) * 100;

    document.getElementById("onboardingProgressLabel").textContent = `Schritt ${onboardingStepIndex + 1}/${ONBOARDING_STEPS.length}`;
    document.getElementById("onboardingProgressBar").style.width = `${percent}%`;
    document.getElementById("onboardingTitle").textContent = step.title;
    document.getElementById("onboardingText").textContent = step.text;
    document.getElementById("onboardingAction").textContent = step.action;

    const settingsPanel = document.getElementById("onboardingSettingsPanel");
    const settingsStepTypes = new Set(["start-page-settings", "quiet-hours-settings", "appearance-settings"]);
    const showSettings = settingsStepTypes.has(step.type);

    settingsPanel?.classList.toggle("hidden", !showSettings);

    document.querySelectorAll("[data-onboarding-settings-step]").forEach(panel => {
        panel.classList.toggle("hidden", panel.dataset.onboardingSettingsStep !== step.type);
    });

    if (showSettings) {
        loadOnboardingSettingsPayload()
            .then(renderOnboardingSettings)
            .catch(error => {
                console.warn("Onboarding-Einstellungen konnten nicht geladen werden:", error);
            });
    }

    document.getElementById("onboardingBack").disabled = onboardingStepIndex === 0;
    document.getElementById("onboardingNext").classList.toggle("hidden", onboardingStepIndex === ONBOARDING_STEPS.length - 1);
    document.getElementById("onboardingComplete").classList.toggle("hidden", onboardingStepIndex !== ONBOARDING_STEPS.length - 1);
}

async function loadOnboardingStatus() {
    try {
        const data = await apiRequest("api/onboarding/status?t=" + Date.now());

        if (data.seen) return;

        ensureOnboardingModal();
        onboardingStepIndex = 0;
        renderOnboardingStep();
        document.getElementById("teamSyncOnboarding")?.classList.remove("hidden");
    } catch (error) {
        console.warn("Onboarding konnte nicht geladen werden:", error);
    }
}

function setupLoginRecapPopupControls() {
    document.getElementById("loginRecapClose")?.addEventListener("click", closeLoginRecapPopup);
    document.getElementById("loginRecapOk")?.addEventListener("click", closeLoginRecapPopup);

    document.getElementById("loginRecapPopup")?.addEventListener("click", event => {
        if (event.target?.id === "loginRecapPopup") {
            closeLoginRecapPopup();
        }
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            closeLoginRecapPopup();
        }
    });
}

function setupDepartmentFilter() {
    const departmentSelect = document.getElementById("departmentFilter");

    if (!departmentSelect) return;

    const existingValues = Array.from(departmentSelect.options).map(option => option.value);

    const warnOptions = [
        { value: "teamwarn", text: "Nur Teamwarns" },
        { value: "no-teamwarn", text: "Keine Teamwarns" },
        { value: "teamwarn-1", text: "TEAMWARN Ⅰ" },
        { value: "teamwarn-2", text: "TEAMWARN ⅠⅠ" }
    ];

    warnOptions.forEach(optionData => {
        if (existingValues.includes(optionData.value)) return;

        const option = document.createElement("option");
        option.value = optionData.value;
        option.textContent = optionData.text;

        departmentSelect.appendChild(option);
    });
}

function normalizeWarnText(value) {
    return String(value || "")
        .toLowerCase()
        .replaceAll("Ⅰ", "i")
        .replaceAll("Ⅱ", "ii")
        .replaceAll("ⅰ", "i")
        .replaceAll("ⅱ", "ii")
        .replace(/\s+/g, " ")
        .trim();
}

function applyFilters() {
    const searchInput = document.getElementById("search");
    const departmentSelect = document.getElementById("departmentFilter");

    const searchFilter = normalizeWarnText(searchInput ? searchInput.value : "");
    const selectedFilter = departmentSelect ? departmentSelect.value.toLowerCase() : "all";

    document.querySelectorAll(".staff-card").forEach(card => {
        const text = normalizeWarnText(card.innerText);

        const matchesSearch = text.includes(searchFilter);

        let matchesFilter = true;

        if (selectedFilter === "teamwarn") {
            matchesFilter = text.includes("teamwarn");
        }
        else if (selectedFilter === "no-teamwarn") {
            matchesFilter = !text.includes("teamwarn");
        }
        else if (selectedFilter === "teamwarn-1") {
            matchesFilter =
                text.includes("teamwarn i") &&
                !text.includes("teamwarn ii");
        }
        else if (selectedFilter === "teamwarn-2") {
            matchesFilter = text.includes("teamwarn ii");
        }
        else {
            matchesFilter =
                selectedFilter === "all" ||
                text.includes(selectedFilter);
        }

        card.style.display = matchesSearch && matchesFilter ? "" : "none";
    });
}

setupDepartmentFilter();
setupPersonRecordModal();
setupLoginRecapPopupControls();
loadCurrentUser();
loadLoginRecap();
loadOnboardingStatus();

document.getElementById("teamCards")?.addEventListener("click", event => {
    const card = event.target.closest(".staff-card");

    if (!card) return;

    const userId = card.dataset.userId;

    if (!userId) return;

    loadPersonRecord(userId).catch(error => alert(error.message));
});

document.getElementById("search")?.addEventListener("input", applyFilters);
document.getElementById("departmentFilter")?.addEventListener("change", applyFilters);

loadTeam();

setInterval(loadTeam, 10000);
