let forumPosts = [];
let canManageContent = false;
let activeForumPostId = null;

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
    document.getElementById("newForumPostBtn")?.classList.toggle("hidden", !canManageContent);
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
        ? `<button class="attachment-delete delete-forum-attachment" type="button" data-post-id="${escapeHtml(options.postId)}" data-attachment-id="${escapeHtml(attachment.id)}">Datei löschen</button>`
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
    if (!Array.isArray(attachments) || !attachments.length) return "";
    return `<div class="content-attachments">${attachments.map(attachment => renderAttachment(attachment, options)).join("")}</div>`;
}

function stripText(value, length = 160) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > length ? text.slice(0, length - 1) + "…" : text;
}

function renderForumGrid() {
    const grid = document.getElementById("forumGrid");
    const search = document.getElementById("forumSearch")?.value.toLowerCase() || "";

    const filtered = forumPosts.filter(post => [post.title, post.content, post.createdByName].join(" ").toLowerCase().includes(search));

    if (!filtered.length) {
        grid.innerHTML = `<div class="empty-state">Noch keine Forumeinträge vorhanden.</div>`;
        return;
    }

    grid.innerHTML = filtered.map(post => `
        <article class="content-card" data-post-id="${escapeHtml(post.id)}">
            <div class="content-card-head">
                <h3>${escapeHtml(post.title)}</h3>
                <span>${escapeHtml(formatDate(post.createdAt))}</span>
            </div>
            <p>${escapeHtml(stripText(post.content || "Kein Text"))}</p>
            <div class="content-card-meta">
                <span>von ${escapeHtml(post.createdByName || "Unbekannt")}</span>
                <span>${Array.isArray(post.attachments) ? post.attachments.length : 0} Anhang/Anhänge</span>
            </div>
        </article>
    `).join("");
}

async function loadForumPosts() {
    forumPosts = await apiRequest("api/forum/posts?t=" + Date.now());
    renderForumGrid();
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

async function openForumPost(postId) {
    const post = await apiRequest(`api/forum/posts/${encodeURIComponent(postId)}?t=${Date.now()}`);
    const view = document.getElementById("forumView");

    view.innerHTML = `
        <div class="content-detail-head">
            <div>
                <h2>${escapeHtml(post.title)}</h2>
                <p>von ${escapeHtml(post.createdByName || "Unbekannt")} · ${escapeHtml(formatDate(post.createdAt))}</p>
            </div>
            ${canManageContent ? `<div class="content-detail-actions"><button class="secondary-action" id="editForumPostBtn">Bearbeiten</button><button class="danger-action" id="deleteForumPostBtn">Löschen</button></div>` : ""}
        </div>
        <div class="content-detail-text">${escapeHtml(post.content || "").replaceAll("\n", "<br>")}</div>
        ${renderAttachments(post.attachments, { postId: post.id, canDelete: canManageContent })}
    `;

    document.getElementById("editForumPostBtn")?.addEventListener("click", () => openForumEditor(post));
    document.getElementById("deleteForumPostBtn")?.addEventListener("click", () => deleteForumPost(post.id));

    openModal("forumModal");
}

function updateSelectedFiles(inputId, labelId) {
    renderUploadFileList(inputId, labelId);
}

function openForumEditor(post = null) {
    activeForumPostId = post?.id || null;
    document.getElementById("forumEditorTitle").textContent = post ? "Forumeintrag bearbeiten" : "Forumeintrag erstellen";
    document.getElementById("forumTitle").value = post?.title || "";
    document.getElementById("forumContent").value = post?.content || "";
    document.getElementById("forumAttachments").value = "";
    document.getElementById("forumSelectedFiles").textContent = post ? "Bestehende Anhänge bleiben erhalten. Neue Dateien werden hinzugefügt." : "Keine Dateien ausgewählt";
    openModal("forumEditorModal");
}

async function saveForumPost() {
    const title = document.getElementById("forumTitle").value.trim();
    const content = document.getElementById("forumContent").value.trim();
    const input = document.getElementById("forumAttachments");
    const files = Array.from(input?.files || []);

    if (!title) {
        alert("Titel fehlt.");
        return;
    }

    const formData = new FormData();
    formData.append("title", title);
    formData.append("content", content);
    for (const file of files) {
        formData.append("attachments", file);
    }

    setButtonLoading("saveForumPostBtn", true);

    try {
        if (activeForumPostId) {
            await uploadFormDataWithProgress(`api/forum/posts/${encodeURIComponent(activeForumPostId)}`, "PUT", formData, files, "forumSelectedFiles");
        } else {
            await uploadFormDataWithProgress("api/forum/posts", "POST", formData, files, "forumSelectedFiles");
        }

        closeModal("forumEditorModal");
        closeModal("forumModal");
        await loadForumPosts();
    } finally {
        setButtonLoading("saveForumPostBtn", false);
    }
}

async function deleteForumAttachment(postId, attachmentId) {
    if (!confirm("Diese Datei wirklich löschen? Der Forumeintrag bleibt erhalten.")) return;

    await apiRequest(`api/forum/posts/${encodeURIComponent(postId)}/attachments/${encodeURIComponent(attachmentId)}`, {
        method: "DELETE"
    });

    await loadForumPosts();
    await openForumPost(postId);
}

async function deleteForumPost(postId) {
    if (!confirm("Forumeintrag wirklich löschen? Anhänge werden ebenfalls entfernt.")) return;
    await apiRequest(`api/forum/posts/${encodeURIComponent(postId)}`, { method: "DELETE" });
    closeModal("forumModal");
    await loadForumPosts();
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
    setupBackdropModalClose(["forumModal", "forumEditorModal"]);
    document.getElementById("newForumPostBtn")?.addEventListener("click", () => openForumEditor());
    document.getElementById("saveForumPostBtn")?.addEventListener("click", () => saveForumPost().catch(error => alert(error.message)));
    document.getElementById("forumSearch")?.addEventListener("input", renderForumGrid);
    document.getElementById("forumAttachments")?.addEventListener("change", () => updateSelectedFiles("forumAttachments", "forumSelectedFiles"));

    document.getElementById("forumGrid")?.addEventListener("click", event => {
        const card = event.target.closest(".content-card");
        if (!card) return;
        openForumPost(card.dataset.postId).catch(error => alert(error.message));
    });

    document.getElementById("forumModal")?.addEventListener("click", event => {
        const deleteButton = event.target.closest(".delete-forum-attachment");

        if (!deleteButton) return;

        event.preventDefault();
        event.stopPropagation();
        deleteForumAttachment(deleteButton.dataset.postId, deleteButton.dataset.attachmentId).catch(error => alert(error.message));
    });

    document.getElementById("forumModalClose")?.addEventListener("click", () => closeModal("forumModal"));
    document.getElementById("forumEditorClose")?.addEventListener("click", () => closeModal("forumEditorModal"));
}

async function init() {
    setupEvents();
    await loadCurrentUser();
    await loadPermissions();
    await loadForumPosts();
}

init().catch(error => {
    console.error(error);
    document.getElementById("forumGrid").innerHTML = `<div class="empty-state">Fehler: ${escapeHtml(error.message)}</div>`;
});
