const MAX_TASK_DESCRIPTION_LENGTH = 5000;
const MAX_COMMENT_ATTACHMENTS = 5;
const MAX_COMMENT_ATTACHMENT_SIZE = 5 * 1024 * 1024 * 1024;

let currentTask = null;
let currentUser = null;
let currentRoles = [];
let departments = ["Allgemein"];
let realtimeSocket = null;
let realtimeReloadPending = false;
let mentionableUsers = [];
let commentMentionPicker = null;

// Ein Live-Update (siehe scheduleRealtimeReload/setupRealtimeChat) hat bisher bei JEDEM
// task:updated-Socket-Event (z.B. wenn irgendwer einen Kommentar schreibt) alle
// Bearbeitungsfelder ungefragt mit dem zuletzt gespeicherten Serverstand überschrieben -
// auch mitten in einer eigenen, noch nicht gespeicherten Bearbeitung. Diese Liste merkt
// sich, welche Felder der Nutzer seit dem letzten Laden/Speichern angefasst hat; genau
// diese Felder lässt ein Live-Update dann in Ruhe.
const dirtyDetailFieldIds = new Set();
const DETAIL_FORM_FIELD_IDS = ["detailTitleInput", "detailStatus", "detailPriority", "detailDepartment", "detailDescription", "detailDueDate"];

const taskId = decodeURIComponent(window.location.pathname.split("/").filter(Boolean).pop() || "");

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function clampUploadProgress(value) {
    return Math.max(0, Math.min(100, Number(value || 0)));
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



function formatFileSize(bytes) {
    const size = Number(bytes || 0);

    if (size >= 1024 * 1024 * 1024) return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
    if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;

    return `${size} B`;
}

async function apiRequest(url, options = {}) {
    const isFormData = options.body instanceof FormData;

    const response = await fetch(url, {
        headers: isFormData
            ? { ...(options.headers || {}) }
            : {
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

function formatDate(value) {
    if (!value) return "";
    return new Date(value).toLocaleString("de-DE");
}

function formatDateTimeLocal(value) {
    if (!value) return "";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return offsetDate.toISOString().slice(0, 16);
}

function isMyTask(task) {
    const userId = String(currentUser?.id || "");

    if (!userId) return false;

    return String(task?.createdById || "") === userId ||
        (Array.isArray(task?.assignees) ? task.assignees : [])
            .some(assignee => String(assignee.id || "") === userId);
}

function hasTaskOwnerPermission() {
    return Array.isArray(currentRoles) && currentRoles.some(roleName => {
        const cleanRole = String(roleName || "").trim().toLowerCase();

        // Nur echter Inhaber bekommt globale Vollberechtigung im Aufgabenmodul.
        // "stv. Inhaber" zählt hier bewusst nicht.
        return cleanRole === "inhaber" || cleanRole === "inhaber | 4life";
    });
}

function canManageTask(task) {
    return hasTaskOwnerPermission() || isMyTask(task);
}

function getAssigneeNames(task) {
    const known = Array.isArray(task.assignees)
        ? task.assignees.map(user => user.name || user.username || user.id)
        : [];

    const manual = Array.isArray(task.manualAssignees) ? task.manualAssignees : [];

    if (!known.length && !manual.length && task.assignee) {
        return [task.assignee];
    }

    return [...known, ...manual].filter(Boolean);
}

function renderDepartmentOptions(selectedDepartment = "Allgemein") {
    return departments.map(department => `
        <option value="${escapeHtml(department)}" ${department === selectedDepartment ? "selected" : ""}>
            ${escapeHtml(department)}
        </option>
    `).join("");
}

async function loadCurrentUser() {
    const response = await fetch("../me?t=" + Date.now());
    if (!response.ok) return;

    const data = await response.json();
    currentUser = data.user || null;
    currentRoles = Array.isArray(data.roles) ? data.roles : [];

    const badge = document.getElementById("userBadge");

    if (badge && data.user) {
        badge.textContent = data.user.globalName || data.user.username || "Angemeldet";
    }
}

async function loadMentionableUsers() {
    try {
        const users = await apiRequest("../api/users?t=" + Date.now());
        mentionableUsers = (Array.isArray(users) ? users : []).filter(user => user.isTeamMember !== false);
    } catch (error) {
        console.error("Nutzerliste für @-Erwähnungen konnte nicht geladen werden:", error);
    }
}

function setupCommentMentionPicker() {
    commentMentionPicker = createMentionPicker({
        textarea: document.getElementById("commentMessage"),
        dropdown: document.getElementById("commentMentionDropdown"),
        getUsers: () => mentionableUsers
    });
}

async function loadDepartments() {
    departments = await apiRequest("../api/departments?t=" + Date.now());
}

async function loadTask(options = {}) {
    const preserveDirtyFields = options.preserveDirtyFields === true;
    const isDirty = fieldId => preserveDirtyFields && dirtyDetailFieldIds.has(fieldId);

    currentTask = await apiRequest("../api/tasks/" + encodeURIComponent(taskId) + "?t=" + Date.now());

    document.getElementById("detailTitle").textContent = currentTask.title || "Aufgabe";

    if (!isDirty("detailTitleInput")) {
        document.getElementById("detailTitleInput").value = currentTask.title || "";
    }

    if (!isDirty("detailStatus")) {
        document.getElementById("detailStatus").value = currentTask.status || "Offen";
    }

    if (!isDirty("detailPriority")) {
        document.getElementById("detailPriority").value = currentTask.priority || "Mittel";
    }

    if (!isDirty("detailDepartment")) {
        document.getElementById("detailDepartment").innerHTML = renderDepartmentOptions(currentTask.department || "Allgemein");
    }

    if (!isDirty("detailDescription")) {
        document.getElementById("detailDescription").value = currentTask.description || "";
    }

    const dueInput = document.getElementById("detailDueDate");
    if (dueInput && !isDirty("detailDueDate")) {
        dueInput.value = formatDateTimeLocal(currentTask.dueDate);
    }

    const dueText = currentTask.dueDate
        ? ` · Fällig: ${formatDate(currentTask.dueDate)}`
        : "";

    document.getElementById("detailMeta").textContent = `Erstellt von ${currentTask.createdBy || "Unbekannt"} am ${formatDate(currentTask.createdAt)}${dueText}`;

    const names = getAssigneeNames(currentTask);
    document.getElementById("detailAssignees").innerHTML = names.length
        ? names.map(name => `<span class="badge department default">${escapeHtml(name)}</span>`).join("")
        : `<span class="badge department default">Keine Zuständigkeit</span>`;

    const archiveBtn = document.getElementById("archiveTaskBtn");
    if (archiveBtn) {
        archiveBtn.style.display = canManageTask(currentTask) ? "" : "none";
    }

    renderComments();
}

function downloadUrl(url) {
    if (!url || url === "#") return "#";
    return String(url).includes("?") ? `${url}&download=1` : `${url}?download=1`;
}

function renderAttachment(attachment, options = {}) {
    const name = escapeHtml(attachment.originalName || attachment.fileName || "Datei");
    const rawName = attachment.originalName || attachment.fileName || "Datei";
    const url = escapeHtml(attachment.url || "#");
    const rawUrl = attachment.url || "#";
    const mimeType = String(attachment.mimeType || "").toLowerCase();
    const size = escapeHtml(formatFileSize(attachment.size));
    const canDelete = Boolean(options.canDelete);
    const actions = canDelete
        ? `<button class="attachment-delete delete-comment-attachment" type="button" data-comment-id="${escapeHtml(options.commentId)}" data-attachment-id="${escapeHtml(attachment.id)}">Datei löschen</button>`
        : "";

    if (mimeType.startsWith("image/")) {
        return `
            <div class="attachment-item">
                <a class="comment-attachment image-attachment" href="${url}" target="_blank" rel="noopener">
                    <img src="${url}" alt="${name}">
                    <span>${name} · ${size}</span>
                </a>
                <a class="attachment-download" href="${escapeHtml(downloadUrl(rawUrl))}" download="${escapeHtml(rawName)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px;"><path d="M12 4v12m0 0 5-5m-5 5-5-5M5 20h14"/></svg>Download</a>
                ${actions}
            </div>
        `;
    }

    if (mimeType.startsWith("video/")) {
        return `
            <div class="attachment-item">
                <div class="comment-attachment video-attachment">
                    <video src="${url}" controls preload="metadata"></video>
                    <a href="${escapeHtml(downloadUrl(rawUrl))}" download="${escapeHtml(rawName)}" target="_blank" rel="noopener">${name} · ${size}</a>
                </div>
                ${actions}
            </div>
        `;
    }

    return `
        <div class="attachment-item">
            <a class="comment-attachment file-attachment" href="${escapeHtml(downloadUrl(rawUrl))}" download="${escapeHtml(rawName)}" target="_blank" rel="noopener">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px;"><path d="M21 12.5 12.5 21a5 5 0 0 1-7-7L14 5.5a3.5 3.5 0 0 1 5 5L10.5 19a2 2 0 0 1-3-3L15 8.5"/></svg>${name} · ${size}
            </a>
            ${actions}
        </div>
    `;
}

function renderAttachments(attachments, options = {}) {
    if (!Array.isArray(attachments) || attachments.length === 0) return "";

    return `
        <div class="comment-attachments">
            ${attachments.map(attachment => renderAttachment(attachment, options)).join("")}
        </div>
    `;
}

function isImportantRole(roleName) {
    const cleanRole = String(roleName || "").trim().toLowerCase();

    if (!cleanRole) return false;

    return cleanRole.includes("inhaber") ||
        cleanRole.includes("projektleitung") ||
        cleanRole.includes("teamleitung") ||
        cleanRole.includes("management") ||
        cleanRole === "ccm" ||
        cleanRole === "stv. ccm";
}

function canEditComment(comment) {
    return String(comment?.userId || "") === String(currentUser?.id || "");
}

function canDeleteComment(comment) {
    return canEditComment(comment) ||
        (Array.isArray(currentRoles) && currentRoles.some(isImportantRole));
}

function renderCommentActions(comment) {
    const showEdit = canEditComment(comment);
    const showDelete = canDeleteComment(comment);

    if (!showEdit && !showDelete) return "";

    return `
        <div class="comment-actions">
            ${showEdit ? `<button type="button" class="comment-action-btn edit-comment" data-comment-id="${escapeHtml(comment.id)}">
                Bearbeiten
            </button>` : ""}
            ${showDelete ? `<button type="button" class="comment-action-btn delete-comment" data-comment-id="${escapeHtml(comment.id)}">
                Löschen
            </button>` : ""}
        </div>
    `;
}

function renderComments() {
    const comments = Array.isArray(currentTask?.comments) ? currentTask.comments : [];
    const container = document.getElementById("commentsList");

    if (!comments.length) {
        container.innerHTML = `<div class="empty-chat">Noch keine Nachrichten vorhanden.</div>`;
        return;
    }

    container.innerHTML = comments.map(comment => `
        <div class="comment-item" data-comment-id="${escapeHtml(comment.id)}">
            <div class="comment-head">
                <strong>${escapeHtml(comment.userName || "Unbekannt")}</strong>
                <span>
                    ${escapeHtml(formatDate(comment.createdAt))}
                    ${comment.editedAt ? " · bearbeitet" : ""}
                </span>
            </div>
            ${comment.message ? `<div class="comment-body">${renderTextWithMentions(escapeHtml(comment.message), comment.mentions)}</div>` : ""}
            ${renderAttachments(comment.attachments, { commentId: comment.id, canDelete: canDeleteComment(comment) })}
            ${renderCommentActions(comment)}
        </div>
    `).join("");
}

async function saveTaskDetails(options = {}) {
    const description = document.getElementById("detailDescription").value;
    const showAlert = options.showAlert !== false;

    if (description.length > MAX_TASK_DESCRIPTION_LENGTH) {
        alert(`Beschreibung darf maximal ${MAX_TASK_DESCRIPTION_LENGTH} Zeichen haben.`);
        return null;
    }

    const savedTask = await apiRequest("../api/tasks/" + encodeURIComponent(taskId), {
        method: "PUT",
        body: JSON.stringify({
            title: document.getElementById("detailTitleInput").value,
            department: document.getElementById("detailDepartment").value,
            status: document.getElementById("detailStatus").value,
            priority: document.getElementById("detailPriority").value,
            dueDate: document.getElementById("detailDueDate")?.value || "",
            description,
            assigneeIds: (currentTask.assignees || []).map(user => user.id),
            manualAssignees: currentTask.manualAssignees || []
        })
    });

    // Der gerade gespeicherte Stand ist jetzt der Serverstand - nichts mehr "dirty".
    dirtyDetailFieldIds.clear();
    await loadTask();

    if (showAlert) {
        alert("Gespeichert.");
    }

    return savedTask;
}

async function archiveTask() {
    if (!confirm("Aufgabe wirklich archivieren? Sie erscheint danach nur noch im Archiv.")) return;

    document.getElementById("detailStatus").value = "Archiviert";

    await saveTaskDetails({ showAlert: false });

    alert("Aufgabe wurde archiviert.");
    window.location.href = "../tasks";
}

function updateSelectedFilesLabel() {
    renderUploadFileList("commentAttachments", "selectedFiles");
}

function validateFiles(files) {
    if (files.length > MAX_COMMENT_ATTACHMENTS) {
        throw new Error(`Maximal ${MAX_COMMENT_ATTACHMENTS} Dateien pro Nachricht erlaubt.`);
    }

    const tooLarge = files.find(file => file.size > MAX_COMMENT_ATTACHMENT_SIZE);
    if (tooLarge) {
        throw new Error(`Die Datei "${tooLarge.name}" ist zu groß. Maximal erlaubt sind 5 GB pro Datei.`);
    }
}

async function editComment(commentId) {
    const comment = (Array.isArray(currentTask?.comments) ? currentTask.comments : [])
        .find(item => item.id === commentId);

    if (!comment) {
        alert("Nachricht nicht gefunden.");
        return;
    }

    const nextMessage = prompt("Nachricht bearbeiten:", comment.message || "");

    if (nextMessage === null) return;

    await apiRequest("../api/tasks/" + encodeURIComponent(taskId) + "/comments/" + encodeURIComponent(commentId), {
        method: "PUT",
        body: JSON.stringify({
            message: nextMessage
        })
    });

    await loadTask();
}

async function deleteCommentAttachment(commentId, attachmentId) {
    if (!confirm("Diese Datei wirklich löschen? Die Nachricht bleibt erhalten.")) return;

    await apiRequest("../api/tasks/" + encodeURIComponent(taskId) + "/comments/" + encodeURIComponent(commentId) + "/attachments/" + encodeURIComponent(attachmentId), {
        method: "DELETE"
    });

    await loadTask();
}

async function deleteComment(commentId) {
    if (!confirm("Nachricht wirklich löschen? Anhänge dieser Nachricht werden ebenfalls gelöscht.")) return;

    await apiRequest("../api/tasks/" + encodeURIComponent(taskId) + "/comments/" + encodeURIComponent(commentId), {
        method: "DELETE"
    });

    await loadTask();
}

async function sendComment() {
    const textarea = document.getElementById("commentMessage");
    const fileInput = document.getElementById("commentAttachments");
    const message = textarea.value.trim();
    const files = Array.from(fileInput?.files || []);

    if (!message && !files.length) {
        alert("Nachricht oder Anhang fehlt.");
        return;
    }

    validateFiles(files);

    const mentions = commentMentionPicker ? commentMentionPicker.getMentionsForSend() : [];

    const formData = new FormData();
    formData.append("message", message);
    formData.append("mentions", JSON.stringify(mentions));

    for (const file of files) {
        formData.append("attachments", file);
    }

    setButtonLoading("sendCommentBtn", true, "Sendet...");

    try {
        await uploadFormDataWithProgress("../api/tasks/" + encodeURIComponent(taskId) + "/comments", "POST", formData, files, "selectedFiles");

        textarea.value = "";
        if (fileInput) fileInput.value = "";
        commentMentionPicker?.reset();
        updateSelectedFilesLabel();
        // preserveDirtyFields: Kommentar abschicken darf keine unabhängig davon laufende,
        // noch nicht gespeicherte Bearbeitung der Aufgabenfelder verwerfen.
        await loadTask({ preserveDirtyFields: true });
    } finally {
        setButtonLoading("sendCommentBtn", false);
    }
}

function getSocketPath() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    const basePath = parts.length ? `/${parts[0]}` : "";
    return `${basePath}/socket.io`;
}

function scheduleRealtimeReload() {
    if (realtimeReloadPending) return;

    realtimeReloadPending = true;

    setTimeout(async () => {
        try {
            await loadTask({ preserveDirtyFields: true });
        } catch (error) {
            console.error("Live-Chat konnte nicht aktualisiert werden:", error);
        } finally {
            realtimeReloadPending = false;
        }
    }, 150);
}

function setupRealtimeChat() {
    if (!window.io || realtimeSocket || !taskId) return;

    realtimeSocket = io({
        path: getSocketPath(),
        transports: ["websocket", "polling"]
    });

    realtimeSocket.on("connect", () => {
        realtimeSocket.emit("task:join", taskId);
    });

    realtimeSocket.on("task:updated", payload => {
        if (String(payload?.taskId || "") !== String(taskId)) return;
        scheduleRealtimeReload();
    });

    realtimeSocket.on("connect_error", error => {
        console.warn("Live-Chat-Verbindung fehlgeschlagen:", error.message);
    });
}

function setupDirtyFieldTracking() {
    DETAIL_FORM_FIELD_IDS.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        field?.addEventListener("input", () => dirtyDetailFieldIds.add(fieldId));
        field?.addEventListener("change", () => dirtyDetailFieldIds.add(fieldId));
    });
}

async function init() {
    await loadCurrentUser();
    await loadDepartments();
    await loadMentionableUsers();
    await loadTask();
    updateSelectedFilesLabel();
    setupDirtyFieldTracking();
    setupCommentMentionPicker();
    setupRealtimeChat();
}

document.getElementById("saveDetailBtn")?.addEventListener("click", () => {
    saveTaskDetails().catch(error => alert(error.message));
});

document.getElementById("archiveTaskBtn")?.addEventListener("click", () => {
    archiveTask().catch(error => alert(error.message));
});

document.getElementById("sendCommentBtn")?.addEventListener("click", () => {
    sendComment().catch(error => alert(error.message));
});

document.getElementById("commentAttachments")?.addEventListener("change", updateSelectedFilesLabel);

document.getElementById("commentsList")?.addEventListener("click", event => {
    const attachmentButton = event.target.closest(".delete-comment-attachment");

    if (attachmentButton) {
        event.preventDefault();
        event.stopPropagation();
        deleteCommentAttachment(attachmentButton.dataset.commentId, attachmentButton.dataset.attachmentId).catch(error => alert(error.message));
        return;
    }

    const editButton = event.target.closest(".edit-comment");
    const deleteButton = event.target.closest(".delete-comment");

    if (editButton) {
        editComment(editButton.dataset.commentId).catch(error => alert(error.message));
        return;
    }

    if (deleteButton) {
        deleteComment(deleteButton.dataset.commentId).catch(error => alert(error.message));
    }
});

init().catch(error => alert(error.message));
