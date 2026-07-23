let archiveEntries = [];
let roleOptions = [];
let canManageContent = false;
let canCreateArchive = true;
let activeArchiveEntryId = null;

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unbekannt";
    return date.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function apiRequest(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
            const data = await response.json();
            message = data.error || message;
        } catch (_) {}
        throw new Error(message);
    }
    if (response.status === 204) return null;
    return response.json();
}

async function loadCurrentUser() {
    try {
        const data = await apiRequest("me?t=" + Date.now());
        const badge = document.getElementById("userBadge");
        if (badge && data.user) badge.textContent = data.user.globalName || data.user.username || "Angemeldet";
    } catch (error) {
        console.error(error);
    }
}

async function loadPermissions() {
    const data = await apiRequest("api/content-permissions?t=" + Date.now());
    canManageContent = Boolean(data.canManageContent);
    canCreateArchive = data.canCreateArchive !== false;
    roleOptions = Array.isArray(data.roleOptions) ? data.roleOptions : [];

    // Im Aktenarchiv darf jeder Team-Nutzer eigene Akten erstellen.
    document.getElementById("newArchiveEntryBtn")?.classList.toggle("hidden", !canCreateArchive);

    renderRoleOptions([]);
}

function stripText(value, length = 150) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > length ? text.slice(0, length - 1) + "…" : text;
}

function renderArchiveGrid() {
    const grid = document.getElementById("archiveGrid");
    const search = document.getElementById("archiveSearch")?.value.toLowerCase() || "";
    const filtered = archiveEntries.filter(entry => [entry.title, entry.description, entry.createdByName, entry.accessLabel].join(" ").toLowerCase().includes(search));

    if (!filtered.length) {
        grid.innerHTML = `<div class="empty-state">Keine sichtbaren Akten vorhanden.</div>`;
        return;
    }

    grid.innerHTML = filtered.map(entry => `
        <article class="content-card archive-card" data-entry-id="${escapeHtml(entry.id)}">
            <div class="content-card-head">
                <h3>${escapeHtml(entry.title)}</h3>
                <span>${escapeHtml(formatDate(entry.createdAt))}</span>
            </div>
            <p>${escapeHtml(stripText(entry.description || "Keine Beschreibung"))}</p>
            <div class="content-card-meta">
                <span>Zugriff: ${escapeHtml(entry.accessLabel || "Alle Teammitglieder")}</span>
                <span>${Array.isArray(entry.attachments) ? entry.attachments.length : 0} Datei(en)</span>
            </div>
        </article>
    `).join("");
}

async function loadArchiveEntries() {
    archiveEntries = await apiRequest("api/archive/entries?t=" + Date.now());
    renderArchiveGrid();
}

function downloadUrl(url) {
    if (!url || url === "#") return "#";
    return String(url).includes("?") ? `${url}&download=1` : `${url}?download=1`;
}


function clampUploadProgress(value) {
    return Math.max(0, Math.min(100, Number(value || 0)));
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

function renderAttachment(attachment, options = {}) {
    const url = attachment.url || "#";
    const name = attachment.originalName || attachment.fileName || "Datei";
    const mime = String(attachment.mimeType || "").toLowerCase();
    const canDelete = Boolean(options.canDelete);
    const actions = canDelete
        ? `<button class="attachment-delete delete-archive-attachment" type="button" data-entry-id="${escapeHtml(options.entryId)}" data-attachment-id="${escapeHtml(attachment.id)}">Datei löschen</button>`
        : "";

    if (mime.startsWith("image/")) {
        return `<div class="attachment-item"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="attachment-preview image"><img src="${escapeHtml(url)}" alt="${escapeHtml(name)}"><span>${escapeHtml(name)}</span></a><a class="attachment-download" href="${escapeHtml(downloadUrl(url))}" download="${escapeHtml(name)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px;"><path d="M12 4v12m0 0 5-5m-5 5-5-5M5 20h14"/></svg>Download</a>${actions}</div>`;
    }

    if (mime.startsWith("video/")) {
        return `<div class="attachment-item"><div class="attachment-preview video"><video src="${escapeHtml(url)}" controls></video><a href="${escapeHtml(downloadUrl(url))}" download="${escapeHtml(name)}" target="_blank" rel="noopener">${escapeHtml(name)}</a></div>${actions}</div>`;
    }

    return `<div class="attachment-item"><a class="attachment-file" href="${escapeHtml(downloadUrl(url))}" download="${escapeHtml(name)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px;"><path d="M21 12.5 12.5 21a5 5 0 0 1-7-7L14 5.5a3.5 3.5 0 0 1 5 5L10.5 19a2 2 0 0 1-3-3L15 8.5"/></svg>${escapeHtml(name)}</a>${actions}</div>`;
}

function renderAttachments(attachments, options = {}) {
    if (!Array.isArray(attachments) || !attachments.length) return `<div class="empty-state small">Keine Dateien hinterlegt.</div>`;
    return `<div class="content-attachments">${attachments.map(attachment => renderAttachment(attachment, options)).join("")}</div>`;
}

function openModal(id) {
    const el = document.getElementById(id);
    el?.classList.remove("hidden");
    el?.setAttribute("aria-hidden", "false");
}

function closeModal(id) {
    const el = document.getElementById(id);
    el?.classList.add("hidden");
    el?.setAttribute("aria-hidden", "true");
}

async function openArchiveEntry(entryId) {
    const entry = await apiRequest(`api/archive/entries/${encodeURIComponent(entryId)}?t=${Date.now()}`);
    const view = document.getElementById("archiveView");

    view.innerHTML = `
        <div class="content-detail-head">
            <div>
                <h2>${escapeHtml(entry.title)}</h2>
                <p>von ${escapeHtml(entry.createdByName || "Unbekannt")} · ${escapeHtml(formatDate(entry.createdAt))}</p>
                <p class="access-label">Zugriff: ${escapeHtml(entry.accessLabel || "Alle Teammitglieder")}</p>
            </div>
            ${entry.canManage ? `<div class="content-detail-actions"><button class="secondary-action" id="editArchiveEntryBtn">Bearbeiten</button><button class="danger-action" id="deleteArchiveEntryBtn">Löschen</button></div>` : ""}
        </div>
        <div class="content-detail-text">${escapeHtml(entry.description || "").replaceAll("\n", "<br>")}</div>
        ${renderAttachments(entry.attachments, { entryId: entry.id, canDelete: entry.canManage })}
    `;

    document.getElementById("editArchiveEntryBtn")?.addEventListener("click", () => openArchiveEditor(entry));
    document.getElementById("deleteArchiveEntryBtn")?.addEventListener("click", () => deleteArchiveEntry(entry.id));

    openModal("archiveModal");
}

function selectedRoles() {
    return Array.from(document.querySelectorAll(".role-option input:checked")).map(input => input.value);
}

function renderRoleOptions(selected = []) {
    const grid = document.getElementById("archiveRoleOptions");
    if (!grid) return;

    const filter = document.getElementById("archiveRoleSearch")?.value.toLowerCase() || "";
    const selectedSet = new Set(selected || []);
    const visibleRoles = roleOptions.filter(role => role.toLowerCase().includes(filter));

    grid.innerHTML = visibleRoles.map(role => `
        <label class="role-option ${selectedSet.has(role) ? "selected" : ""}">
            <input type="checkbox" value="${escapeHtml(role)}" ${selectedSet.has(role) ? "checked" : ""}>
            <span>${escapeHtml(role)}</span>
        </label>
    `).join("") || `<div class="empty-state small">Keine Rolle gefunden.</div>`;
}

function updateSelectedFiles(inputId, labelId) {
    renderUploadFileList(inputId, labelId);
}

function openArchiveEditor(entry = null) {
    activeArchiveEntryId = entry?.id || null;
    document.getElementById("archiveEditorTitle").textContent = entry ? "Akte bearbeiten" : "Akte erstellen";
    document.getElementById("archiveTitle").value = entry?.title || "";
    document.getElementById("archiveDescription").value = entry?.description || "";
    document.getElementById("archiveAttachments").value = "";
    document.getElementById("archiveSelectedFiles").textContent = entry ? "Bestehende Dateien bleiben erhalten. Neue Dateien werden hinzugefügt." : "Keine Dateien ausgewählt";
    renderRoleOptions(entry?.allowedRoles || []);
    openModal("archiveEditorModal");
}

async function saveArchiveEntry() {
    const title = document.getElementById("archiveTitle").value.trim();
    const description = document.getElementById("archiveDescription").value.trim();
    const roles = selectedRoles();
    const input = document.getElementById("archiveAttachments");
    const files = Array.from(input?.files || []);

    if (!title) {
        alert("Titel fehlt.");
        return;
    }

    const formData = new FormData();
    formData.append("title", title);
    formData.append("description", description);
    for (const role of roles) formData.append("allowedRoles", role);
    for (const file of files) {
        formData.append("attachments", file);
    }

    setButtonLoading("saveArchiveEntryBtn", true);

    try {
        if (activeArchiveEntryId) {
            await uploadFormDataWithProgress(`api/archive/entries/${encodeURIComponent(activeArchiveEntryId)}`, "PUT", formData, files, "archiveSelectedFiles");
        } else {
            await uploadFormDataWithProgress("api/archive/entries", "POST", formData, files, "archiveSelectedFiles");
        }

        closeModal("archiveEditorModal");
        closeModal("archiveModal");
        await loadArchiveEntries();
    } finally {
        setButtonLoading("saveArchiveEntryBtn", false);
    }
}

async function deleteArchiveAttachment(entryId, attachmentId) {
    if (!confirm("Diese Datei wirklich löschen? Die Akte bleibt erhalten.")) return;

    await apiRequest(`api/archive/entries/${encodeURIComponent(entryId)}/attachments/${encodeURIComponent(attachmentId)}`, {
        method: "DELETE"
    });

    await loadArchiveEntries();
    await openArchiveEntry(entryId);
}

async function deleteArchiveEntry(entryId) {
    if (!confirm("Akte wirklich löschen? Dateien werden ebenfalls entfernt.")) return;
    await apiRequest(`api/archive/entries/${encodeURIComponent(entryId)}`, { method: "DELETE" });
    closeModal("archiveModal");
    await loadArchiveEntries();
}

function setupBackdropModalClose(modalIds = []) {
    for (const id of modalIds) {
        const modal = document.getElementById(id);

        if (!modal) continue;

        modal.addEventListener("click", event => {
            // Nur schließen, wenn wirklich auf den dunklen Hintergrund geklickt wurde.
            // Klicks im eigentlichen Fenster bleiben normal erhalten.
            if (event.target === modal) {
                closeModal(id);
            }
        });
    }

    document.addEventListener("keydown", event => {
        if (event.key !== "Escape") return;

        for (const id of modalIds) {
            const modal = document.getElementById(id);

            if (modal && !modal.classList.contains("hidden")) {
                closeModal(id);
                break;
            }
        }
    });
}

function setupEvents() {
    setupBackdropModalClose(["archiveModal", "archiveEditorModal"]);
    document.getElementById("newArchiveEntryBtn")?.addEventListener("click", () => openArchiveEditor());
    document.getElementById("saveArchiveEntryBtn")?.addEventListener("click", () => saveArchiveEntry().catch(error => alert(error.message)));
    document.getElementById("archiveSearch")?.addEventListener("input", renderArchiveGrid);
    document.getElementById("archiveRoleSearch")?.addEventListener("input", () => renderRoleOptions(selectedRoles()));
    document.getElementById("archiveAttachments")?.addEventListener("change", () => updateSelectedFiles("archiveAttachments", "archiveSelectedFiles"));
    document.getElementById("archiveRoleOptions")?.addEventListener("change", () => renderRoleOptions(selectedRoles()));

    document.getElementById("archiveGrid")?.addEventListener("click", event => {
        const card = event.target.closest(".content-card");
        if (!card) return;
        openArchiveEntry(card.dataset.entryId).catch(error => alert(error.message));
    });

    document.getElementById("archiveModal")?.addEventListener("click", event => {
        const deleteButton = event.target.closest(".delete-archive-attachment");

        if (!deleteButton) return;

        event.preventDefault();
        event.stopPropagation();
        deleteArchiveAttachment(deleteButton.dataset.entryId, deleteButton.dataset.attachmentId).catch(error => alert(error.message));
    });

    document.getElementById("archiveModalClose")?.addEventListener("click", () => closeModal("archiveModal"));
    document.getElementById("archiveEditorClose")?.addEventListener("click", () => closeModal("archiveEditorModal"));
}

async function init() {
    setupEvents();
    await loadCurrentUser();
    await loadPermissions();
    await loadArchiveEntries();
}

init().catch(error => {
    console.error(error);
    document.getElementById("archiveGrid").innerHTML = `<div class="empty-state">Fehler: ${escapeHtml(error.message)}</div>`;
});
