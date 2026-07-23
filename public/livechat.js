const MAX_LIVECHAT_ATTACHMENTS = 8;
const MAX_LIVECHAT_ATTACHMENT_SIZE = 5 * 1024 * 1024 * 1024;

let currentUser = null;
let canManageLivechat = false;
let liveSocket = null;
let liveMessages = [];

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

function getSocketPath() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    const basePath = parts.length ? `/${parts[0]}` : "";
    return `${basePath}/socket.io`;
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
        ? `<button class="attachment-delete delete-livechat-attachment" type="button" data-message-id="${escapeHtml(options.messageId)}" data-attachment-id="${escapeHtml(attachment.id)}">Datei löschen</button>`
        : "";

    if (mime.startsWith("image/")) {
        return `<div class="attachment-item"><a class="comment-attachment image-attachment" href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${name}"><span>${name} · ${size}</span></a><a class="attachment-download" href="${escapeHtml(downloadUrl(rawUrl))}" download="${escapeHtml(rawName)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px;"><path d="M12 4v12m0 0 5-5m-5 5-5-5M5 20h14"/></svg>Download</a>${actions}</div>`;
    }

    if (mime.startsWith("video/")) {
        return `<div class="attachment-item"><div class="comment-attachment video-attachment"><video src="${url}" controls preload="metadata"></video><a href="${escapeHtml(downloadUrl(rawUrl))}" download="${escapeHtml(rawName)}" target="_blank" rel="noopener">${name} · ${size}</a></div>${actions}</div>`;
    }

    return `<div class="attachment-item"><a class="comment-attachment file-attachment" href="${escapeHtml(downloadUrl(rawUrl))}" download="${escapeHtml(rawName)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px;"><path d="M21 12.5 12.5 21a5 5 0 0 1-7-7L14 5.5a3.5 3.5 0 0 1 5 5L10.5 19a2 2 0 0 1-3-3L15 8.5"/></svg>${name} · ${size}</a>${actions}</div>`;
}

function renderAttachments(attachments, options = {}) {
    if (!Array.isArray(attachments) || !attachments.length) return "";
    return `<div class="comment-attachments">${attachments.map(attachment => renderAttachment(attachment, options)).join("")}</div>`;
}

function canEditMessage(message) {
    return String(message?.userId || "") === String(currentUser?.id || "");
}

function canDeleteMessage(message) {
    return canEditMessage(message) || canManageLivechat;
}

function renderMessageActions(message) {
    const showEdit = canEditMessage(message);
    const showDelete = canDeleteMessage(message);

    if (!showEdit && !showDelete) return "";

    return `
        <div class="livechat-actions">
            ${showEdit ? `<button type="button" class="livechat-action-btn edit-livechat-message" data-message-id="${escapeHtml(message.id)}">Bearbeiten</button>` : ""}
            ${showDelete ? `<button type="button" class="livechat-action-btn delete-livechat-message" data-message-id="${escapeHtml(message.id)}">Löschen</button>` : ""}
        </div>
    `;
}

function renderMessage(message) {
    const mine = canEditMessage(message);
    const editedText = message.editedAt ? " · bearbeitet" : "";

    return `
        <div class="livechat-message ${mine ? "mine" : ""}" data-message-id="${escapeHtml(message.id)}">
            <img class="livechat-avatar" src="${escapeHtml(message.avatar || "https://cdn.discordapp.com/embed/avatars/0.png")}" alt="">
            <div class="livechat-bubble">
                <div class="livechat-head">
                    <strong>${escapeHtml(message.userName || "Unbekannt")}</strong>
                    <span>${escapeHtml(formatDate(message.createdAt))}${editedText}</span>
                </div>
                ${message.message ? `<div class="livechat-text">${escapeHtml(message.message).replaceAll("\n", "<br>")}</div>` : ""}
                ${renderAttachments(message.attachments, { messageId: message.id, canDelete: canDeleteMessage(message) })}
                ${renderMessageActions(message)}
            </div>
        </div>
    `;
}

function renderMessages(scroll = false) {
    const container = document.getElementById("liveChatMessages");
    if (!container) return;

    if (!liveMessages.length) {
        container.innerHTML = `<div class="empty-chat">Noch keine Nachrichten vorhanden.</div>`;
        return;
    }

    container.innerHTML = liveMessages.map(renderMessage).join("");

    if (scroll) {
        container.scrollTop = container.scrollHeight;
    }
}

async function loadLiveChatPermissions() {
    try {
        const response = await fetch("api/livechat/permissions?t=" + Date.now());

        if (!response.ok) {
            canManageLivechat = false;
            return;
        }

        const data = await response.json();
        canManageLivechat = Boolean(data.canManageLivechat);
    } catch (error) {
        console.error("Livechat-Rechte konnten nicht geladen werden:", error);
        canManageLivechat = false;
    }
}

async function loadMessages() {
    liveMessages = await apiRequest("api/livechat/messages?t=" + Date.now());
    renderMessages(true);
}

function setupRealtime() {
    if (!window.io || liveSocket) return;

    liveSocket = io({
        path: getSocketPath(),
        transports: ["websocket", "polling"]
    });

    liveSocket.on("connect", () => {
        liveSocket.emit("livechat:join");
    });

    liveSocket.on("livechat:message", message => {
        if (!message?.id) return;
        if (liveMessages.some(item => String(item.id) === String(message.id))) return;
        liveMessages.push(message);
        liveMessages = liveMessages.slice(-250);
        renderMessages(true);
    });

    liveSocket.on("livechat:message-updated", message => {
        if (!message?.id) return;

        const index = liveMessages.findIndex(item => String(item.id) === String(message.id));

        if (index === -1) {
            liveMessages.push(message);
            liveMessages = liveMessages.slice(-250);
        } else {
            liveMessages[index] = message;
        }

        renderMessages(false);
    });

    liveSocket.on("livechat:message-deleted", payload => {
        const id = String(payload?.id || "");

        if (!id) return;

        liveMessages = liveMessages.filter(item => String(item.id) !== id);
        renderMessages(false);
    });

    liveSocket.on("connect_error", error => {
        console.warn("Livechat-Verbindung fehlgeschlagen:", error.message);
    });
}

function updateSelectedFiles() {
    renderUploadFileList("liveChatAttachments", "liveChatSelectedFiles");
}

function validateFiles(files) {
    if (files.length > MAX_LIVECHAT_ATTACHMENTS) {
        throw new Error(`Maximal ${MAX_LIVECHAT_ATTACHMENTS} Dateien pro Nachricht erlaubt.`);
    }

    const tooLarge = files.find(file => file.size > MAX_LIVECHAT_ATTACHMENT_SIZE);
    if (tooLarge) throw new Error(`Die Datei "${tooLarge.name}" ist zu groß. Maximal 5 GB pro Datei.`);
}


async function editLiveChatMessage(messageId) {
    const message = liveMessages.find(item => String(item.id) === String(messageId));

    if (!message) {
        alert("Nachricht nicht gefunden.");
        return;
    }

    const nextMessage = prompt("Nachricht bearbeiten:", message.message || "");

    if (nextMessage === null) return;

    const updated = await apiRequest("api/livechat/messages/" + encodeURIComponent(messageId), {
        method: "PUT",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            message: nextMessage
        })
    });

    const index = liveMessages.findIndex(item => String(item.id) === String(messageId));

    if (index !== -1) {
        liveMessages[index] = updated;
    }

    renderMessages(false);
}

async function deleteLiveChatAttachment(messageId, attachmentId) {
    if (!confirm("Diese Datei wirklich löschen? Die Nachricht bleibt erhalten.")) return;

    const updated = await apiRequest("api/livechat/messages/" + encodeURIComponent(messageId) + "/attachments/" + encodeURIComponent(attachmentId), {
        method: "DELETE"
    });

    const index = liveMessages.findIndex(item => String(item.id) === String(messageId));

    if (index !== -1) {
        liveMessages[index] = updated;
    }

    renderMessages(false);
}

async function deleteLiveChatMessage(messageId) {
    if (!confirm("Nachricht wirklich löschen? Anhänge dieser Nachricht werden ebenfalls gelöscht.")) return;

    await apiRequest("api/livechat/messages/" + encodeURIComponent(messageId), {
        method: "DELETE"
    });

    liveMessages = liveMessages.filter(item => String(item.id) !== String(messageId));
    renderMessages(false);
}


async function sendMessage() {
    const textarea = document.getElementById("liveChatMessage");
    const fileInput = document.getElementById("liveChatAttachments");
    const message = textarea.value.trim();
    const files = Array.from(fileInput?.files || []);

    if (!message && !files.length) {
        alert("Nachricht oder Anhang fehlt.");
        return;
    }

    validateFiles(files);

    const formData = new FormData();
    formData.append("message", message);
    for (const file of files) formData.append("attachments", file);

    setButtonLoading("sendLiveChatBtn", true, "Sendet...");

    try {
        await uploadFormDataWithProgress("api/livechat/messages", "POST", formData, files, "liveChatSelectedFiles");

        textarea.value = "";
        if (fileInput) fileInput.value = "";
        updateSelectedFiles();
    } finally {
        setButtonLoading("sendLiveChatBtn", false);
    }
}

function setupEvents() {
    document.getElementById("sendLiveChatBtn")?.addEventListener("click", () => sendMessage().catch(error => alert(error.message)));
    document.getElementById("liveChatAttachments")?.addEventListener("change", updateSelectedFiles);
    document.getElementById("liveChatMessage")?.addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            sendMessage().catch(error => alert(error.message));
        }
    });

    document.getElementById("liveChatMessages")?.addEventListener("click", event => {
        const attachmentButton = event.target.closest(".delete-livechat-attachment");

        if (attachmentButton) {
            event.preventDefault();
            event.stopPropagation();
            deleteLiveChatAttachment(attachmentButton.dataset.messageId, attachmentButton.dataset.attachmentId).catch(error => alert(error.message));
            return;
        }

        const editButton = event.target.closest(".edit-livechat-message");
        const deleteButton = event.target.closest(".delete-livechat-message");

        if (editButton) {
            editLiveChatMessage(editButton.dataset.messageId).catch(error => alert(error.message));
            return;
        }

        if (deleteButton) {
            deleteLiveChatMessage(deleteButton.dataset.messageId).catch(error => alert(error.message));
        }
    });
}

async function init() {
    setupEvents();
    await loadCurrentUser();
    await loadLiveChatPermissions();
    updateSelectedFiles();
    await loadMessages();
    setupRealtime();
}

init().catch(error => {
    console.error(error);
    document.getElementById("liveChatMessages").innerHTML = `<div class="empty-state">Fehler: ${escapeHtml(error.message)}</div>`;
});
