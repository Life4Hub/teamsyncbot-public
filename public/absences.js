let currentAbsences = [];
let handoverSuggestions = [];
let canManageAbsences = false;
let canViewHandoverSuggestions = false;
let absenceTeamMembers = [];
let activeAbsenceEditId = "";
let absenceCalendarDate = new Date();
let selectedAbsenceCalendarDate = null;

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
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

async function loadAbsencePermissions() {
    try {
        const response = await fetch("api/absences/permissions?t=" + Date.now());

        if (!response.ok) {
            canManageAbsences = false;
            canViewHandoverSuggestions = false;
            return;
        }

        const data = await response.json();
        canManageAbsences = Boolean(data.canManageAbsences);
        canViewHandoverSuggestions = Boolean(data.canViewHandoverSuggestions);
    } catch (error) {
        console.error("Abmeldungsrechte konnten nicht geladen werden:", error);
        canManageAbsences = false;
        canViewHandoverSuggestions = false;
    }
}

async function loadAbsenceTeamMembers() {
    if (!canManageAbsences) {
        absenceTeamMembers = [];
        return;
    }

    try {
        const response = await fetch("api/absences/team-members?t=" + Date.now());

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        absenceTeamMembers = await response.json();
    } catch (error) {
        console.error("Teammitglieder für Abmeldungen konnten nicht geladen werden:", error);
        absenceTeamMembers = [];
    }
}

function formatDateTime(value) {
    if (!value) return "Unklar";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "Unklar";

    return date.toLocaleString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function formatDateTimeLocal(value) {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    const pad = number => String(number).padStart(2, "0");

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isSameLocalDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
}

function getAbsenceStatus(absence) {
    if (absence.status === "Abgelehnt" || absence.parseStatus === "rejected") return "Abgelehnt";
    if (absence.status === "Unklar" || absence.parseStatus === "needs_review") return "Prüfen";
    if (absence.status === "Beantragt" || absence.parseStatus === "pending_review") return "Beantragt";

    if (absence.status === "Aktiv" || absence.parseStatus === "accepted") {
        if (absence.endAt) {
            const end = new Date(absence.endAt);

            if (!Number.isNaN(end.getTime())) {
                if (end.getTime() <= Date.now()) return "Abgelaufen";
                if (isSameLocalDay(end, new Date())) return "Läuft heute ab";
            }
        }

        return "Aktiv";
    }

    return "Prüfen";
}

function getStatusClass(status) {
    if (status === "Aktiv") return "active";
    if (status === "Läuft heute ab") return "today";
    if (status === "Prüfen") return "unclear";
    if (status === "Beantragt") return "pending";
    if (status === "Abgelehnt") return "rejected";
    return "expired";
}

function getCalendarStatusClass(status) {
    if (status === "Aktiv" || status === "Läuft heute ab") return "active";
    if (status === "Beantragt") return "pending";
    if (status === "Prüfen") return "unclear";
    if (status === "Abgelaufen") return "expired";

    return "expired";
}

function toLocalDateKey(value) {
    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    const pad = number => String(number).padStart(2, "0");

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromLocalDateKey(key) {
    const parts = String(key || "").split("-").map(Number);

    if (parts.length !== 3 || parts.some(number => !Number.isFinite(number))) {
        return new Date();
    }

    return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
}

function addCalendarDays(date, amount) {
    const next = new Date(date);
    next.setDate(next.getDate() + amount);
    return next;
}

function startOfCalendarMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0, 0);
}

function getCalendarGridStart(monthDate) {
    const first = startOfCalendarMonth(monthDate);
    const day = first.getDay() || 7;

    return addCalendarDays(first, 1 - day);
}

function getCalendarGridDays(monthDate) {
    const start = getCalendarGridStart(monthDate);

    return Array.from({ length: 42 }, (_, index) => addCalendarDays(start, index));
}

function getAbsenceStartDate(absence) {
    const start = new Date(absence.startAt || absence.createdAt || Date.now());

    return Number.isNaN(start.getTime()) ? new Date() : start;
}

function getAbsenceEndDate(absence) {
    const end = new Date(absence.endAt || absence.startAt || absence.createdAt || Date.now());

    return Number.isNaN(end.getTime()) ? getAbsenceStartDate(absence) : end;
}

function getAbsencesForCalendarDay(dayKey) {
    const day = fromLocalDateKey(dayKey);
    day.setHours(0, 0, 0, 0);

    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);

    return currentAbsences.filter(absence => {
        const status = getAbsenceStatus(absence);

        if (status === "Abgelehnt") return false;

        const start = getAbsenceStartDate(absence);
        const end = getAbsenceEndDate(absence);

        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);

        return start <= dayEnd && end >= day;
    }).sort((a, b) => {
        const statusOrder = { "Aktiv": 1, "Läuft heute ab": 1, "Beantragt": 2, "Prüfen": 3, "Abgelaufen": 4 };
        return (statusOrder[getAbsenceStatus(a)] || 9) - (statusOrder[getAbsenceStatus(b)] || 9) ||
            String(a.userName || "").localeCompare(String(b.userName || ""), "de", { sensitivity: "base" });
    });
}

function renderAbsenceCalendarDetails(dayKey) {
    const target = document.getElementById("absenceCalendarDetails");
    if (!target) return;

    const date = fromLocalDateKey(dayKey);
    const absences = getAbsencesForCalendarDay(dayKey);
    const dateText = date.toLocaleDateString("de-DE", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric"
    });

    if (!absences.length) {
        target.innerHTML = `
            <div class="absence-calendar-detail-head">
                <h3>${escapeHtml(dateText)}</h3>
                <span>Keine Abmeldungen</span>
            </div>
        `;
        return;
    }

    target.innerHTML = `
        <div class="absence-calendar-detail-head">
            <h3>${escapeHtml(dateText)}</h3>
            <span>${absences.length} Abmeldung(en)</span>
        </div>

        <div class="absence-calendar-detail-list">
            ${absences.map(absence => {
                const status = getAbsenceStatus(absence);
                const statusClass = getCalendarStatusClass(status);

                return `
                    <article class="absence-calendar-detail-card ${escapeHtml(statusClass)}">
                        <div>
                            <strong>${escapeHtml(absence.userName || "Unbekannt")}</strong>
                            <small>${escapeHtml(absence.reason || "Kein Grund angegeben")}</small>
                            ${absence.account?.linked
                                ? `<small>Account: ${escapeHtml(absence.account.name)} · ${escapeHtml(absence.account.rank || "Ohne Rang")}</small>`
                                : ""}
                        </div>
                        <div>
                            <span class="absence-status ${escapeHtml(getStatusClass(status))}">${escapeHtml(status)}</span>
                            <small>Bis ${escapeHtml(formatDateTime(absence.endAt))}</small>
                        </div>
                    </article>
                `;
            }).join("")}
        </div>
    `;
}

function renderAbsenceCalendar() {
    const calendar = document.getElementById("absenceCalendar");
    const title = document.getElementById("absenceCalendarTitle");

    if (!calendar || !title) return;

    const monthDate = startOfCalendarMonth(absenceCalendarDate);
    const todayKey = toLocalDateKey(new Date());
    const monthKey = `${monthDate.getFullYear()}-${monthDate.getMonth()}`;
    const currentSelection = selectedAbsenceCalendarDate || todayKey;
    const selectedDate = fromLocalDateKey(currentSelection);
    const selectedIsInMonth = `${selectedDate.getFullYear()}-${selectedDate.getMonth()}` === monthKey;
    const selectedKey = selectedIsInMonth ? currentSelection : toLocalDateKey(monthDate);

    selectedAbsenceCalendarDate = selectedKey;

    title.textContent = monthDate.toLocaleDateString("de-DE", {
        month: "long",
        year: "numeric"
    });

    const days = getCalendarGridDays(monthDate);
    const weekDays = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

    calendar.innerHTML = `
        ${weekDays.map(day => `<div class="absence-calendar-weekday">${escapeHtml(day)}</div>`).join("")}
        ${days.map(day => {
            const dayKey = toLocalDateKey(day);
            const isCurrentMonth = day.getMonth() === monthDate.getMonth();
            const isToday = dayKey === todayKey;
            const isSelected = dayKey === selectedKey;
            const dayAbsences = getAbsencesForCalendarDay(dayKey);
            const visibleAbsences = dayAbsences.slice(0, 3);
            const classes = [
                "absence-calendar-day",
                isCurrentMonth ? "current-month" : "outside-month",
                isToday ? "today" : "",
                isSelected ? "selected" : "",
                dayAbsences.length ? "has-absences" : ""
            ].filter(Boolean).join(" ");

            return `
                <button class="${escapeHtml(classes)}" data-calendar-day="${escapeHtml(dayKey)}" type="button">
                    <span class="absence-calendar-day-number">${day.getDate()}</span>
                    <div class="absence-calendar-events">
                        ${visibleAbsences.map(absence => {
                            const status = getAbsenceStatus(absence);
                            return `<span class="absence-calendar-event ${escapeHtml(getCalendarStatusClass(status))}">${escapeHtml(absence.userName || "Unbekannt")}</span>`;
                        }).join("")}
                        ${dayAbsences.length > 3 ? `<span class="absence-calendar-more">+${dayAbsences.length - 3}</span>` : ""}
                    </div>
                </button>
            `;
        }).join("")}
    `;

    renderAbsenceCalendarDetails(selectedKey);
}

function updateCounters(absences) {
    const active = absences.filter(absence => getAbsenceStatus(absence) === "Aktiv").length;
    const today = absences.filter(absence => getAbsenceStatus(absence) === "Läuft heute ab").length;
    const unclear = absences.filter(absence => ["Prüfen", "Beantragt"].includes(getAbsenceStatus(absence))).length;

    document.getElementById("absenceActiveCount").textContent = String(active);
    document.getElementById("absenceTodayCount").textContent = String(today);
    document.getElementById("absenceUnclearCount").textContent = String(unclear);
}

function renderAbsenceActions(absence, status) {
    if (!canManageAbsences) return "—";

    return `
        <div class="absence-actions">
            <button class="absence-action edit" data-action="edit" data-id="${escapeHtml(absence.id)}">Bearbeiten</button>
            <button class="absence-action history" data-action="history" data-id="${escapeHtml(absence.id)}">Verlauf</button>
            ${["Prüfen", "Beantragt"].includes(status)
                ? `<button class="absence-action accept" data-action="accept" data-id="${escapeHtml(absence.id)}">Akzeptieren</button>`
                : ""}
            ${status !== "Abgelehnt"
                ? `<button class="absence-action reject" data-action="reject" data-id="${escapeHtml(absence.id)}">Ablehnen</button>`
                : ""}
            <button class="absence-action delete" data-action="delete" data-id="${escapeHtml(absence.id)}">Löschen</button>
        </div>
    `;
}

function formatHandoverDue(value) {
    if (!value) return "ohne Frist";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "ohne Frist";

    return date.toLocaleString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function renderHandoverSuggestions() {
    const panel = document.getElementById("handoverSuggestionsPanel");
    const list = document.getElementById("handoverSuggestionsList");
    const count = document.getElementById("handoverSuggestionCount");

    if (!panel || !list || !count) return;

    if (!canViewHandoverSuggestions) {
        panel.classList.add("hidden");
        list.innerHTML = "";
        return;
    }

    const suggestions = Array.isArray(handoverSuggestions) ? handoverSuggestions : [];

    count.textContent = `${suggestions.length} Vorschlag${suggestions.length === 1 ? "" : "e"}`;

    if (!suggestions.length) {
        panel.classList.remove("hidden");
        list.innerHTML = `<div class="handover-empty">Aktuell gibt es keine offenen Übergabevorschläge.</div>`;
        return;
    }

    panel.classList.remove("hidden");
    list.innerHTML = suggestions.map(suggestion => {
        const absence = suggestion.absence || {};
        const tasks = Array.isArray(suggestion.tasks) ? suggestion.tasks : [];

        return `
            <article class="handover-card" data-absence-id="${escapeHtml(absence.id)}">
                <div class="handover-card-top">
                    <div>
                        <strong>${escapeHtml(absence.userName || "Unbekannt")}</strong>
                        <small>Abgemeldet${absence.endAt ? ` bis ${escapeHtml(formatDateTime(absence.endAt))}` : ""}${absence.status ? ` · ${escapeHtml(absence.status)}` : ""}</small>
                    </div>
                    <button class="absence-action accept handover-notify" data-handover-notify="${escapeHtml(absence.id)}" title="Teamleitung/Management per DM über diese offenen Aufgaben informieren" type="button">Leitung informieren</button>
                </div>

                <div class="handover-task-list">
                    ${tasks.map(task => `
                        <a class="handover-task" href="tasks/${encodeURIComponent(task.id)}">
                            <span>${escapeHtml(task.title || "Unbenannte Aufgabe")}</span>
                            <small>${escapeHtml(task.department || "Allgemein")} · ${escapeHtml(task.status || "Offen")} · ${escapeHtml(task.priority || "Mittel")} · ${escapeHtml(formatHandoverDue(task.dueDate))}</small>
                        </a>
                    `).join("")}
                </div>
            </article>
        `;
    }).join("");
}

async function loadHandoverSuggestions() {
    if (!canViewHandoverSuggestions) {
        handoverSuggestions = [];
        renderHandoverSuggestions();
        return;
    }

    try {
        const response = await fetch("api/absences/handover-suggestions?t=" + Date.now());

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        handoverSuggestions = await response.json();
        renderHandoverSuggestions();
    } catch (error) {
        console.error("Übergabevorschläge konnten nicht geladen werden:", error);
    }
}

async function notifyHandoverTeamlead(absenceId) {
    if (!canViewHandoverSuggestions) {
        alert("Du hast keine Berechtigung für automatische Übergabevorschläge.");
        return;
    }

    if (!absenceId) return;

    if (!confirm("Teamleitung/Management zu diesen offenen Aufgaben per DM benachrichtigen?")) {
        return;
    }

    const response = await fetch(`api/absences/${encodeURIComponent(absenceId)}/handover-notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
    }

    alert(`Übergabe-Hinweis gesendet.\nGesendet: ${(data.sent || []).length}\nFehlgeschlagen: ${(data.failed || []).length}`);
}

function renderAbsences() {
    const tbody = document.getElementById("absencesBody");
    const search = document.getElementById("absenceSearch")?.value.toLowerCase() || "";

    const filtered = currentAbsences.filter(absence => {
        const haystack = [
            absence.userName,
            absence.durationText,
            absence.reason,
            absence.status,
            absence.originalContent,
            absence.account?.name,
            absence.account?.rank,
            absence.account?.department
        ].join(" ").toLowerCase();

        return haystack.includes(search);
    });

    updateCounters(currentAbsences);
    renderAbsenceCalendar();

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="7">Keine Abmeldungen gefunden.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(absence => {
        const status = getAbsenceStatus(absence);

        return `
            <tr>
                <td>
                    <strong>${escapeHtml(absence.userName || "Unbekannt")}</strong>
                    ${absence.account?.linked
                        ? `<small>Account: ${escapeHtml(absence.account.name)} · ${escapeHtml(absence.account.rank || "Ohne Rang")} · ${escapeHtml(absence.account.department || "Keine Abteilung")}</small>`
                        : `<small class="warning-text">Kein Teamboard-/Discord-Account zugeordnet</small>`}
                    ${absence.createdByName && absence.createdByName !== absence.userName
                        ? `<small>eingetragen von ${escapeHtml(absence.createdByName)}</small>`
                        : ""}
                </td>
                <td>${escapeHtml(formatDateTime(absence.endAt))}</td>
                <td>${escapeHtml(absence.durationText || "—")}</td>
                <td>${escapeHtml(absence.reason || "—")}</td>
                <td>
                    <span class="absence-status ${getStatusClass(status)}">${escapeHtml(status)}</span>
                </td>
                <td>
                    ${absence.messageUrl
                        ? `<a class="button-link compact" href="${escapeHtml(absence.messageUrl)}" target="_blank" rel="noopener">Discord</a>`
                        : "—"}
                </td>
                <td>${renderAbsenceActions(absence, status)}</td>
            </tr>
        `;
    }).join("");
}

async function apiAction(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

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

function ensureAbsenceModal() {
    if (document.getElementById("absenceEditModal")) return;

    const modal = document.createElement("div");
    modal.id = "absenceEditModal";
    modal.className = "absence-edit-modal hidden";
    modal.innerHTML = `
        <div class="absence-edit-backdrop" data-absence-modal-close="1"></div>
        <div class="absence-edit-dialog" role="dialog" aria-modal="true">
            <button class="absence-edit-close" data-absence-modal-close="1" type="button">×</button>
            <h2 id="absenceModalTitle">Abmeldung bearbeiten</h2>

            <div id="absenceEditForm" class="absence-edit-form">
                <label>
                    Person zuordnen
                    <select id="absenceEditUserId"></select>
                </label>
                <label>
                    Status
                    <select id="absenceEditStatus">
                        <option value="Beantragt">Beantragt</option>
                        <option value="Aktiv">Aktiv</option>
                        <option value="Unklar">Unklar</option>
                        <option value="Abgelehnt">Abgelehnt</option>
                    </select>
                </label>
                <label>
                    Enddatum/Zeit
                    <input id="absenceEditEndAt" type="datetime-local">
                </label>
                <label>
                    Dauertext
                    <input id="absenceEditDurationText" type="text" placeholder="z. B. Heute / 3 Tage / bis Sonntag">
                </label>
                <label class="wide">
                    Grund
                    <textarea id="absenceEditReason" rows="4" maxlength="2000"></textarea>
                </label>
            </div>

            <div class="absence-edit-actions">
                <button class="absence-action accept" id="absenceSaveEdit" type="button">Speichern</button>
                <button class="absence-action delete" data-absence-modal-close="1" type="button">Schließen</button>
            </div>

            <div class="absence-history">
                <h3>Verlauf</h3>
                <div id="absenceHistoryList"></div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

function renderTeamMemberOptions(selectedId) {
    const selected = String(selectedId || "");
    const hasSelected = absenceTeamMembers.some(member => String(member.id || "") === selected);
    const fallbackOption = selected && !hasSelected
        ? `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)} · nicht mehr im aktuellen Teamcache</option>`
        : "";

    const options = absenceTeamMembers.map(member => `
        <option value="${escapeHtml(member.id)}" ${String(member.id) === selected ? "selected" : ""}>
            ${escapeHtml(member.name || member.username || member.id)}${member.rank ? ` · ${escapeHtml(member.rank)}` : ""}
        </option>
    `).join("");

    if (!options && !fallbackOption) {
        return `<option value="">Keine Teammitglieder gefunden</option>`;
    }

    return fallbackOption + options;
}

function renderAbsenceHistory(absence) {
    const history = Array.isArray(absence.history) ? absence.history.slice().reverse() : [];

    if (!history.length) {
        return `<div class="absence-history-empty">Noch kein Verlauf vorhanden.</div>`;
    }

    return history.map(entry => `
        <div class="absence-history-item">
            <div class="absence-history-top">
                <strong>${escapeHtml(entry.action || "Änderung")}</strong>
                <span>${escapeHtml(formatDateTime(entry.createdAt))}</span>
            </div>
            <small>Von: ${escapeHtml(entry.byName || entry.byId || "Unbekannt")}</small>
            ${entry.details ? `<pre>${escapeHtml(JSON.stringify(entry.details, null, 2))}</pre>` : ""}
        </div>
    `).join("");
}

function openAbsenceModal(id, mode = "edit") {
    const absence = currentAbsences.find(item => String(item.id) === String(id));

    if (!absence) return;

    ensureAbsenceModal();
    activeAbsenceEditId = String(id);

    document.getElementById("absenceModalTitle").textContent = mode === "history" ? "Abmeldungs-Verlauf" : "Abmeldung bearbeiten";
    document.getElementById("absenceEditForm").classList.toggle("hidden", mode === "history");
    document.getElementById("absenceSaveEdit").classList.toggle("hidden", mode === "history");

    document.getElementById("absenceEditUserId").innerHTML = renderTeamMemberOptions(absence.userId);
    document.getElementById("absenceEditStatus").value = absence.status || "Beantragt";
    document.getElementById("absenceEditEndAt").value = formatDateTimeLocal(absence.endAt);
    document.getElementById("absenceEditDurationText").value = absence.durationText || "";
    document.getElementById("absenceEditReason").value = absence.reason || "";
    document.getElementById("absenceHistoryList").innerHTML = renderAbsenceHistory(absence);

    document.getElementById("absenceEditModal").classList.remove("hidden");
    document.body.classList.add("modal-open");
}

function closeAbsenceModal() {
    document.getElementById("absenceEditModal")?.classList.add("hidden");
    document.body.classList.remove("modal-open");
}

async function saveAbsenceEdit() {
    if (!activeAbsenceEditId) return;

    const userId = document.getElementById("absenceEditUserId").value;
    const selectedMember = absenceTeamMembers.find(member => String(member.id) === String(userId));
    const body = {
        userId,
        userName: selectedMember?.name || selectedMember?.username || userId,
        status: document.getElementById("absenceEditStatus").value,
        endAt: document.getElementById("absenceEditEndAt").value || "",
        durationText: document.getElementById("absenceEditDurationText").value || "",
        reason: document.getElementById("absenceEditReason").value || ""
    };

    await apiAction(`api/absences/${encodeURIComponent(activeAbsenceEditId)}`, {
        method: "PUT",
        body: JSON.stringify(body)
    });

    closeAbsenceModal();
    await loadAbsences();
}

async function handleAbsenceAction(button) {
    const id = button.dataset.id;
    const action = button.dataset.action;

    if (!id || !action) return;

    if (action === "edit" || action === "history") {
        openAbsenceModal(id, action);
        return;
    }

    const labels = {
        accept: "akzeptieren und per DM informieren",
        reject: "ablehnen und per DM informieren",
        delete: "endgültig löschen"
    };

    if (!confirm(`Abmeldung wirklich ${labels[action] || "bearbeiten"}?`)) return;

    if (action === "accept") {
        await apiAction(`api/absences/${encodeURIComponent(id)}/accept`, { method: "POST" });
    }
    else if (action === "reject") {
        await apiAction(`api/absences/${encodeURIComponent(id)}/reject`, { method: "POST" });
    }
    else if (action === "delete") {
        await apiAction(`api/absences/${encodeURIComponent(id)}`, { method: "DELETE" });
    }

    await loadAbsences();
}

async function loadAbsences() {
    try {
        const response = await fetch("api/absences?t=" + Date.now());

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        currentAbsences = await response.json();
        renderAbsences();
        await loadHandoverSuggestions();
    } catch (error) {
        console.error("Abmeldungen konnten nicht geladen werden:", error);
        document.getElementById("absencesBody").innerHTML =
            `<tr><td colspan="7">Fehler beim Laden: ${escapeHtml(error.message)}</td></tr>`;
    }
}

document.getElementById("absenceSearch")?.addEventListener("input", renderAbsences);

document.getElementById("absencesBody")?.addEventListener("click", event => {
    const button = event.target.closest(".absence-action");

    if (!button) return;

    handleAbsenceAction(button).catch(error => alert(error.message));
});

document.addEventListener("click", event => {
    if (event.target.closest("[data-absence-modal-close]")) {
        event.preventDefault();
        closeAbsenceModal();
        return;
    }

    const handoverButton = event.target.closest("[data-handover-notify]");

    if (handoverButton) {
        event.preventDefault();
        notifyHandoverTeamlead(handoverButton.dataset.handoverNotify).catch(error => alert(error.message));
        return;
    }

    if (event.target.closest("#absenceSaveEdit")) {
        event.preventDefault();
        saveAbsenceEdit().catch(error => alert(error.message));
    }
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        closeAbsenceModal();
    }
});

document.addEventListener("click", event => {
    const calendarDay = event.target.closest("[data-calendar-day]");

    if (calendarDay) {
        selectedAbsenceCalendarDate = calendarDay.dataset.calendarDay;
        renderAbsenceCalendar();
        return;
    }

    if (event.target.closest("#absenceCalendarPrev")) {
        absenceCalendarDate = new Date(absenceCalendarDate.getFullYear(), absenceCalendarDate.getMonth() - 1, 1, 12, 0, 0, 0);
        selectedAbsenceCalendarDate = null;
        renderAbsenceCalendar();
        return;
    }

    if (event.target.closest("#absenceCalendarNext")) {
        absenceCalendarDate = new Date(absenceCalendarDate.getFullYear(), absenceCalendarDate.getMonth() + 1, 1, 12, 0, 0, 0);
        selectedAbsenceCalendarDate = null;
        renderAbsenceCalendar();
        return;
    }

    if (event.target.closest("#absenceCalendarToday")) {
        absenceCalendarDate = new Date();
        selectedAbsenceCalendarDate = toLocalDateKey(new Date());
        renderAbsenceCalendar();
    }
});

async function init() {
    await loadCurrentUser();
    await loadAbsencePermissions();
    await loadAbsenceTeamMembers();
    await loadAbsences();

    setInterval(loadAbsences, 30 * 1000);
}

init().catch(error => {
    console.error(error);
    document.getElementById("absencesBody").innerHTML =
        `<tr><td colspan="7">Fehler beim Initialisieren: ${escapeHtml(error.message)}</td></tr>`;
});
