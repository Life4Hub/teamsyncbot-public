let clips = [];
let currentUser = null;

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
    return date.toLocaleString("de-DE", { day:"2-digit", month:"2-digit", year:"2-digit", hour:"2-digit", minute:"2-digit" });
}

function formatFileSize(bytes) {
    const size = Number(bytes || 0);
    if (size >= 1024 * 1024 * 1024) return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
    if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${size} B`;
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
        currentUser = data.user || null;
        const badge = document.getElementById("userBadge");
        if (badge && data.user) badge.textContent = data.user.globalName || data.user.username || "Angemeldet";
    } catch (error) {
        console.error(error);
    }
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
    const url = escapeHtml(attachment.url || "#");
    const rawUrl = attachment.url || "#";
    const name = escapeHtml(attachment.originalName || attachment.fileName || "Datei");
    const rawName = attachment.originalName || attachment.fileName || "Datei";
    const mime = String(attachment.mimeType || "").toLowerCase();
    const size = escapeHtml(formatFileSize(attachment.size));
    const canDelete = Boolean(options.canDelete);
    const actions = canDelete
        ? `<button class="attachment-delete delete-clip-attachment" type="button" data-clip-id="${escapeHtml(options.clipId)}" data-attachment-id="${escapeHtml(attachment.id)}">Datei löschen</button>`
        : "";

    if (mime.startsWith("image/")) {
        return `<div class="attachment-item"><a href="${url}" target="_blank" rel="noopener" class="attachment-preview image"><img src="${url}" alt="${name}"><span>${name} · ${size}</span></a><a class="attachment-download" href="${escapeHtml(downloadUrl(rawUrl))}" download="${escapeHtml(rawName)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px;"><path d="M12 4v12m0 0 5-5m-5 5-5-5M5 20h14"/></svg>Download</a>${actions}</div>`;
    }

    if (mime.startsWith("video/")) {
        return `<div class="attachment-item"><div class="attachment-preview video"><video src="${url}" controls preload="metadata"></video><a href="${escapeHtml(downloadUrl(rawUrl))}" download="${escapeHtml(rawName)}" target="_blank" rel="noopener">${name} · ${size}</a></div>${actions}</div>`;
    }

    return `<div class="attachment-item"><a class="attachment-file" href="${escapeHtml(downloadUrl(rawUrl))}" download="${escapeHtml(rawName)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px;"><path d="M21 12.5 12.5 21a5 5 0 0 1-7-7L14 5.5a3.5 3.5 0 0 1 5 5L10.5 19a2 2 0 0 1-3-3L15 8.5"/></svg>${name} · ${size}</a>${actions}</div>`;
}

function renderClips() {
    const grid = document.getElementById("clipsGrid");
    const search = document.getElementById("clipSearch")?.value.toLowerCase() || "";
    const filtered = clips.filter(clip => [clip.description, clip.createdByName].join(" ").toLowerCase().includes(search));

    if (!filtered.length) {
        grid.innerHTML = `<div class="empty-state">Noch keine Clips oder Beweise vorhanden.</div>`;
        return;
    }

    grid.innerHTML = filtered.map(clip => `
        <article class="content-card clip-card">
            <div class="clip-preview">
                ${(Array.isArray(clip.attachments) ? clip.attachments : []).slice(0, 1).map(attachment => renderAttachment(attachment, { clipId: clip.id, canDelete: clip.canDelete })).join("")}
            </div>
            <p>${escapeHtml(clip.description || "Keine Beschreibung")}</p>
            <div class="content-card-meta">
                <span>von ${escapeHtml(clip.createdByName || "Unbekannt")}</span>
                <span>${escapeHtml(formatDate(clip.createdAt))}</span>
            </div>
            ${(Array.isArray(clip.attachments) && clip.attachments.length > 1) ? `<div class="content-attachments compact">${clip.attachments.slice(1).map(attachment => renderAttachment(attachment, { clipId: clip.id, canDelete: clip.canDelete })).join("")}</div>` : ""}
            ${clip.canDelete ? `<button class="danger-action delete-clip" data-id="${escapeHtml(clip.id)}" type="button">Löschen</button>` : ""}
        </article>
    `).join("");
}

async function loadClips() {
    clips = await apiRequest("api/clips?t=" + Date.now());
    renderClips();
}

function updateSelectedFiles() {
    renderUploadFileList("clipAttachments", "clipSelectedFiles");
}

async function uploadClip() {
    const description = document.getElementById("clipDescription").value.trim();
    const input = document.getElementById("clipAttachments");
    const files = Array.from(input?.files || []);

    if (!files.length) {
        alert("Bitte mindestens eine Datei auswählen.");
        return;
    }

    const formData = new FormData();
    formData.append("description", description);
    for (const file of files) formData.append("attachments", file);

    setButtonLoading("uploadClipBtn", true);

    try {
        await uploadFormDataWithProgress("api/clips", "POST", formData, files, "clipSelectedFiles");

        document.getElementById("clipDescription").value = "";
        if (input) input.value = "";
        updateSelectedFiles();
        await loadClips();
    } finally {
        setButtonLoading("uploadClipBtn", false);
    }
}

async function deleteClipAttachment(clipId, attachmentId) {
    if (!confirm("Diese Datei wirklich löschen? Der Clip-/Beweis-Eintrag bleibt erhalten.")) return;

    await apiRequest(`api/clips/${encodeURIComponent(clipId)}/attachments/${encodeURIComponent(attachmentId)}`, {
        method: "DELETE"
    });

    await loadClips();
}

async function deleteClip(id) {
    if (!confirm("Clip/Beweis wirklich löschen? Dateien werden ebenfalls entfernt.")) return;
    await apiRequest(`api/clips/${encodeURIComponent(id)}`, { method:"DELETE" });
    await loadClips();
}

function setupEvents() {
    document.getElementById("uploadClipBtn")?.addEventListener("click", () => uploadClip().catch(error => alert(error.message)));
    document.getElementById("clipAttachments")?.addEventListener("change", updateSelectedFiles);
    document.getElementById("clipSearch")?.addEventListener("input", renderClips);
    document.getElementById("clipsGrid")?.addEventListener("click", event => {
        const attachmentButton = event.target.closest(".delete-clip-attachment");

        if (attachmentButton) {
            event.preventDefault();
            event.stopPropagation();
            deleteClipAttachment(attachmentButton.dataset.clipId, attachmentButton.dataset.attachmentId).catch(error => alert(error.message));
            return;
        }

        const button = event.target.closest(".delete-clip");
        if (!button) return;
        deleteClip(button.dataset.id).catch(error => alert(error.message));
    });
}

async function init() {
    setupEvents();
    await loadCurrentUser();
    updateSelectedFiles();
    await loadClips();
}

init().catch(error => {
    console.error(error);
    document.getElementById("clipsGrid").innerHTML = `<div class="empty-state">Fehler: ${escapeHtml(error.message)}</div>`;
});
