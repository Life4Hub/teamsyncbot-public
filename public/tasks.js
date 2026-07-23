const MAX_TASK_DESCRIPTION_LENGTH = 5000;
const ARCHIVE_DEPARTMENT = "__archive";
const MINE_FILTER = "__mine";
const ALL_FILTER = "__all";
const OVERDUE_FILTER = "__overdue";
const TASK_STATUSES = ["Offen", "In Arbeit", "Erledigt", "Archiviert"];
const PRIORITIES = ["Sehr niedrig", "Niedrig", "Mittel", "Hoch", "Sehr hoch"];
const TASK_OVERDUE_FILTER_ROLES = new Set([
    "inhaber",
    "inhaber | 4life",
    "stv. inhaber",
    "stv. inhaber | 4life",
    "projektleitung",
    "projektleitung | 4life",
    "stv. projektleitung",
    "stv. projektleitung | 4life",
    "teamleitung",
    "teamleitung | 4life",
    "stv. teamleitung",
    "stv. teamleitung | 4life",
    "ccm",
    "ccm | 4life",
    "stv. ccm",
    "stv. ccm | 4life",
    "management | 4life",
    "management leitung | 4life"
]);

let currentTasks = [];
let currentUsers = [];
let currentUser = null;
let currentRoles = [];
let departments = ["Allgemein"];
let activeFilter = ALL_FILTER;

async function loadCurrentUser() {
    try {
        const response = await fetch("me?t=" + Date.now());
        if (!response.ok) return;

        const data = await response.json();
        currentUser = data.user || null;
        currentRoles = Array.isArray(data.roles) ? data.roles : [];

        const badge = document.getElementById("userBadge");

        if (badge && data.user) {
            badge.textContent = data.user.globalName || data.user.username || "Angemeldet";
        }
    } catch (error) {
        console.error("Nutzer konnte nicht geladen werden:", error);
    }
}

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

function displayUser(user) {
    return user.globalName || user.username || user.name || user.id;
}

function renderAssigneePicker(selectedIds = []) {
    const selected = new Set(Array.isArray(selectedIds) ? selectedIds.map(String) : []);
    const selectedUsers = currentUsers.filter(user => selected.has(String(user.id)));

    const selectedHtml = selectedUsers.length
        ? selectedUsers.map(user => `
            <span class="selected-assignee-chip" data-user-id="${escapeHtml(user.id)}">
                ${escapeHtml(displayUser(user))}
                <button type="button" class="selected-assignee-remove" data-user-id="${escapeHtml(user.id)}" aria-label="${escapeHtml(displayUser(user))} entfernen">×</button>
            </span>
        `).join("")
        : `<span class="assignee-picker-placeholder">Noch niemand ausgewählt</span>`;

    const choicesHtml = currentUsers.length
        ? currentUsers.map(user => {
            const isSelected = selected.has(String(user.id));

            return `
                <button type="button" class="assignee-choice ${isSelected ? "selected" : ""}" data-user-id="${escapeHtml(user.id)}">
                    <span class="assignee-choice-name">${escapeHtml(displayUser(user))}</span>
                    <span class="assignee-choice-state">${isSelected ? "✓ ausgewählt" : "auswählen"}</span>
                </button>
            `;
        }).join("")
        : `<div class="assignee-picker-empty">Noch keine eingeloggten Nutzer vorhanden.</div>`;

    return `
        <button type="button" class="assignee-picker-toggle">
            <span>Zuständige auswählen</span>
            <span class="assignee-picker-count">${selectedUsers.length}</span>
        </button>

        <div class="assignee-picker-menu">
            ${choicesHtml}
        </div>

        <div class="assignee-selected-list">
            ${selectedHtml}
        </div>
    `;
}

function updateAssigneePicker(picker) {
    if (!picker) return;

    const selectedChoices = Array.from(picker.querySelectorAll(".assignee-choice.selected"));
    const selectedIds = selectedChoices.map(choice => String(choice.dataset.userId || "")).filter(Boolean);
    const selectedUsers = currentUsers.filter(user => selectedIds.includes(String(user.id)));

    const count = picker.querySelector(".assignee-picker-count");
    if (count) count.textContent = String(selectedUsers.length);

    const selectedList = picker.querySelector(".assignee-selected-list");

    if (selectedList) {
        selectedList.innerHTML = selectedUsers.length
            ? selectedUsers.map(user => `
                <span class="selected-assignee-chip" data-user-id="${escapeHtml(user.id)}">
                    ${escapeHtml(displayUser(user))}
                    <button type="button" class="selected-assignee-remove" data-user-id="${escapeHtml(user.id)}" aria-label="${escapeHtml(displayUser(user))} entfernen">×</button>
                </span>
            `).join("")
            : `<span class="assignee-picker-placeholder">Noch niemand ausgewählt</span>`;
    }

    selectedChoices.forEach(choice => {
        const state = choice.querySelector(".assignee-choice-state");
        if (state) state.textContent = "✓ ausgewählt";
    });

    picker.querySelectorAll(".assignee-choice:not(.selected) .assignee-choice-state")
        .forEach(state => state.textContent = "auswählen");
}

function getSelectedAssigneeIds(wrapper) {
    if (!wrapper) return [];

    return Array.from(wrapper.querySelectorAll(".assignee-choice.selected"))
        .map(choice => String(choice.dataset.userId || ""))
        .filter(Boolean);
}

function closeAssigneePickers(except = null) {
    document.querySelectorAll(".assignee-picker.open").forEach(picker => {
        if (except && picker === except) return;
        picker.classList.remove("open");
    });
}

function renderDepartmentOptions(selectedDepartment = "Allgemein") {
    return departments.map(department => `
        <option value="${escapeHtml(department)}" ${department === selectedDepartment ? "selected" : ""}>
            ${escapeHtml(department)}
        </option>
    `).join("");
}

function normalizePriority(priority) {
    return PRIORITIES.includes(priority) ? priority : "Mittel";
}

function renderPriorityOptions(selectedPriority = "Mittel") {
    const normalized = normalizePriority(selectedPriority);

    return PRIORITIES.map(priority => `
        <option value="${escapeHtml(priority)}" ${priority === normalized ? "selected" : ""}>
            ${escapeHtml(priority)}
        </option>
    `).join("");
}

function getPriorityClass(priority) {
    return String(normalizePriority(priority))
        .toLowerCase()
        .replace(/ä/g, "ae")
        .replace(/ö/g, "oe")
        .replace(/ü/g, "ue")
        .replace(/ß/g, "ss")
        .replace(/\s+/g, "-");
}

function normalizeStatus(status) {
    return TASK_STATUSES.includes(status) ? status : "Offen";
}

function renderStatusOptions(selectedStatus = "Offen") {
    const normalized = normalizeStatus(selectedStatus);

    return TASK_STATUSES.map(status => `
        <option value="${escapeHtml(status)}" ${status === normalized ? "selected" : ""}>
            ${escapeHtml(status)}
        </option>
    `).join("");
}

function getAssigneesFromWrapper(wrapper) {
    const input = wrapper?.querySelector(".custom-assignee-input");

    return {
        assigneeIds: getSelectedAssigneeIds(wrapper),
        manualAssignees: input ? input.value.trim() : ""
    };
}

function getAssigneeIds(task) {
    if (Array.isArray(task.assignees)) {
        return task.assignees.map(user => user.id).filter(Boolean);
    }

    return task.assigneeId ? [task.assigneeId] : [];
}

function getManualAssigneesText(task) {
    if (Array.isArray(task.manualAssignees)) {
        return task.manualAssignees.join(", ");
    }

    return task.assigneeId ? "" : (task.assignee || "");
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

function renderAssigneeBadges(task) {
    const names = getAssigneeNames(task);

    if (!names.length) {
        return `<span class="assignee-empty">Keine Zuständigkeit</span>`;
    }

    return names.map(name => `<span class="assignee-pill">${escapeHtml(name)}</span>`).join("");
}

function getDepartmentClass(department) {
    const value = String(department || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

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

function isArchived(task) {
    return normalizeStatus(task.status) === "Archiviert";
}

function isMyTask(task) {
    const userId = String(currentUser?.id || "");

    if (!userId) return false;

    return String(task.createdById || "") === userId ||
        (Array.isArray(task.assignees) ? task.assignees : [])
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

function canViewOverdueFilter() {
    return Array.isArray(currentRoles) && currentRoles.some(roleName =>
        TASK_OVERDUE_FILTER_ROLES.has(String(roleName || "").trim().toLowerCase())
    );
}

function canManageTask(task) {
    return hasTaskOwnerPermission() || isMyTask(task);
}

function formatDateTimeLocal(value) {
    if (!value) return "";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return offsetDate.toISOString().slice(0, 16);
}

function formatDueDate(value) {
    if (!value) return "Keine Frist";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Keine Frist";

    return date.toLocaleString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function getDueClass(task) {
    if (!task.dueDate || isArchived(task) || normalizeStatus(task.status) === "Erledigt") return "";

    const due = new Date(task.dueDate).getTime();
    if (Number.isNaN(due)) return "";

    const diff = due - Date.now();

    if (diff < 0) return "overdue";
    if (diff <= 24 * 60 * 60 * 1000) return "due-soon";

    return "";
}

function isTaskOverdue(task) {
    return getDueClass(task) === "overdue";
}

function renderQuickFilterButton(value, label, extraClass = "") {
    return `
        <button class="department-tab ${extraClass} ${activeFilter === value ? "active" : ""}" data-filter="${escapeHtml(value)}">
            ${escapeHtml(label)}
        </button>
    `;
}

function renderDepartmentTabs() {
    const quick = document.getElementById("taskQuickFilters");
    const dropdown = document.getElementById("departmentDropdown");

    if (quick) {
        const quickButtons = [
            renderQuickFilterButton(MINE_FILTER, "Meine Aufgaben"),
            renderQuickFilterButton(ALL_FILTER, "Alle Aufgaben")
        ];

        if (canViewOverdueFilter()) {
            quickButtons.push(renderQuickFilterButton(OVERDUE_FILTER, "Überfällig", "overdue-filter"));
        }
        else if (activeFilter === OVERDUE_FILTER) {
            activeFilter = ALL_FILTER;
        }

        quickButtons.push(renderQuickFilterButton("Allgemein", "Allgemein", "department default"));
        quick.innerHTML = quickButtons.join("");
    }

    if (dropdown) {
        const dropdownDepartments = departments.filter(department => department !== "Allgemein");

        dropdown.innerHTML = [
            `<option value="">Weitere Abteilungen</option>`,
            ...dropdownDepartments.map(department => `
                <option value="${escapeHtml(department)}" ${activeFilter === department ? "selected" : ""}>
                    ${escapeHtml(department)}
                </option>
            `),
            `<option value="${ARCHIVE_DEPARTMENT}" ${activeFilter === ARCHIVE_DEPARTMENT ? "selected" : ""}>Archiviert</option>`
        ].join("");

        if ([MINE_FILTER, ALL_FILTER, OVERDUE_FILTER, "Allgemein"].includes(activeFilter)) {
            dropdown.value = "";
        }
    }
}

function setCreateFormDepartment() {
    const select = document.getElementById("taskDepartment");
    if (!select) return;

    const selectedDepartment = activeFilter !== ALL_FILTER &&
        activeFilter !== MINE_FILTER &&
        activeFilter !== OVERDUE_FILTER &&
        activeFilter !== ARCHIVE_DEPARTMENT
            ? activeFilter
            : "Allgemein";

    select.innerHTML = renderDepartmentOptions(selectedDepartment);
}

function setCreateFormUsers() {
    const picker = document.getElementById("taskAssigneePicker");
    if (!picker) return;

    picker.innerHTML = renderAssigneePicker([]);
}

function tasksForActiveFilter() {
    if (activeFilter === ARCHIVE_DEPARTMENT) {
        return currentTasks.filter(task => isArchived(task));
    }

    const visibleTasks = currentTasks.filter(task => !isArchived(task));

    if (activeFilter === MINE_FILTER) {
        return visibleTasks.filter(task => isMyTask(task));
    }

    if (activeFilter === ALL_FILTER) {
        return visibleTasks;
    }

    if (activeFilter === OVERDUE_FILTER) {
        return canViewOverdueFilter()
            ? visibleTasks.filter(isTaskOverdue)
            : visibleTasks.filter(isMyTask);
    }

    return visibleTasks.filter(task => (task.department || "Allgemein") === activeFilter);
}

function filteredTasks() {
    return tasksForActiveFilter();
}

function updateTaskCounters() {
    const scopedTasks = tasksForActiveFilter().filter(task => !isArchived(task));

    const open = scopedTasks.filter(task => normalizeStatus(task.status) === "Offen").length;
    const progress = scopedTasks.filter(task => normalizeStatus(task.status) === "In Arbeit").length;
    const done = scopedTasks.filter(task => normalizeStatus(task.status) === "Erledigt").length;

    const openEl = document.getElementById("counterOpen");
    const progressEl = document.getElementById("counterProgress");
    const doneEl = document.getElementById("counterDone");

    if (openEl) openEl.textContent = String(open);
    if (progressEl) progressEl.textContent = String(progress);
    if (doneEl) doneEl.textContent = String(done);
}

async function loadDepartmentsAndUsers() {
    const [departmentData, userData] = await Promise.all([
        apiRequest("api/departments?t=" + Date.now()),
        apiRequest("api/users?t=" + Date.now())
    ]);

    departments = Array.isArray(departmentData) && departmentData.length ? departmentData : ["Allgemein"];
    currentUsers = Array.isArray(userData) ? userData : [];

    renderDepartmentTabs();
    setCreateFormDepartment();
    setCreateFormUsers();
}

function renderAssigneeEditor(task) {
    if (!canManageTask(task)) {
        return `<div class="assignee-editor-note">Nur Ersteller, Zuständige oder Inhaber dürfen Verantwortliche ändern.</div>`;
    }

    return `
        <button type="button" class="assignee-edit-toggle">
            Zuständige bearbeiten
        </button>

        <div class="assignee-editor collapsed">
            <div class="edit-assignee-picker assignee-picker">
                ${renderAssigneePicker(getAssigneeIds(task))}
            </div>
            <input class="edit-assignee-custom custom-assignee-input" value="${escapeHtml(getManualAssigneesText(task))}" placeholder="Weitere manuell, mit Komma trennen">
        </div>
    `;
}

function renderTaskActions(task) {
    const deleteButton = canManageTask(task)
        ? `<button class="delete-task danger">Löschen</button>`
        : "";

    return `
        <div class="task-actions">
            <a class="button-link" href="tasks/${encodeURIComponent(task.id)}">Öffnen</a>
            <button class="save-task">Speichern</button>
            ${deleteButton}
        </div>
    `;
}

async function loadTasks() {
    const tbody = document.getElementById("tasksBody");

    try {
        currentTasks = await apiRequest("api/tasks?t=" + Date.now());
        updateTaskCounters();
        const tasks = filteredTasks();

        if (!tasks.length) {
            const emptyText = activeFilter === OVERDUE_FILTER
                ? "Keine überfälligen Aufgaben vorhanden."
                : "Noch keine Aufgaben in dieser Ansicht vorhanden.";
            tbody.innerHTML = `<tr><td colspan="6">${escapeHtml(emptyText)}</td></tr>`;
            return;
        }

        tbody.innerHTML = tasks.map(task => {
            const dueClass = getDueClass(task);

            return `
                <tr data-id="${escapeHtml(task.id)}" class="${escapeHtml(dueClass)}">
                    <td>
                        <input class="edit-title" value="${escapeHtml(task.title)}">
                        <small>Erstellt von ${escapeHtml(task.createdBy || "Unbekannt")}</small>
                    </td>
                    <td>
                        <select class="edit-department">
                            ${renderDepartmentOptions(task.department || "Allgemein")}
                        </select>
                    </td>
                    <td class="assignee-cell">
                        <div class="assignee-summary">${renderAssigneeBadges(task)}</div>
                        ${renderAssigneeEditor(task)}
                    </td>
                    <td>
                        <select class="edit-status">
                            ${renderStatusOptions(task.status || "Offen")}
                        </select>
                    </td>
                    <td>
                        <select class="edit-priority priority-${getPriorityClass(task.priority)}">
                            ${renderPriorityOptions(task.priority || "Mittel")}
                        </select>
                    </td>
                    <td>
                        ${renderTaskActions(task)}
                    </td>
                </tr>
            `;
        }).join("");
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="6">Fehler beim Laden: ${escapeHtml(error.message)}</td></tr>`;
    }
}

async function createTask() {
    const title = document.getElementById("taskTitle").value.trim();
    const department = document.getElementById("taskDepartment").value;
    const status = document.getElementById("taskStatus").value;
    const priority = document.getElementById("taskPriority").value;
    const dueDate = document.getElementById("taskDueDate").value;
    const description = document.getElementById("taskDescription").value.trim();
    const assigneeData = getAssigneesFromWrapper(document.querySelector(".task-form"));

    if (!title) {
        alert("Titel fehlt.");
        return;
    }

    if (description.length > MAX_TASK_DESCRIPTION_LENGTH) {
        alert(`Beschreibung darf maximal ${MAX_TASK_DESCRIPTION_LENGTH} Zeichen haben.`);
        return;
    }

    await apiRequest("api/tasks", {
        method: "POST",
        body: JSON.stringify({
            title,
            department,
            assigneeIds: assigneeData.assigneeIds,
            manualAssignees: assigneeData.manualAssignees,
            status,
            priority,
            dueDate,
            description
        })
    });

    document.getElementById("taskTitle").value = "";
    document.getElementById("taskStatus").value = "Offen";
    document.getElementById("taskPriority").value = "Mittel";
    document.getElementById("taskDueDate").value = "";
    document.getElementById("taskDescription").value = "";
    document.getElementById("taskAssigneeCustom").value = "";
    setCreateFormUsers();

    await loadTasks();
}

async function saveTask(row) {
    const id = row.dataset.id;
    const task = currentTasks.find(item => String(item.id) === String(id));
    const payload = {
        title: row.querySelector(".edit-title").value,
        department: row.querySelector(".edit-department").value,
        status: row.querySelector(".edit-status").value,
        priority: row.querySelector(".edit-priority").value
    };

    if (task && canManageTask(task)) {
        const assigneeData = getAssigneesFromWrapper(row);
        payload.assigneeIds = assigneeData.assigneeIds;
        payload.manualAssignees = assigneeData.manualAssignees;
    }

    await apiRequest("api/tasks/" + encodeURIComponent(id), {
        method: "PUT",
        body: JSON.stringify(payload)
    });

    await loadTasks();
}

async function deleteTask(row) {
    const id = row.dataset.id;

    if (!confirm("Aufgabe wirklich löschen?")) return;

    await apiRequest("api/tasks/" + encodeURIComponent(id), {
        method: "DELETE"
    });

    await loadTasks();
}

document.addEventListener("click", event => {
    const toggle = event.target.closest(".assignee-picker-toggle");
    const choice = event.target.closest(".assignee-choice");
    const remove = event.target.closest(".selected-assignee-remove");
    const picker = event.target.closest(".assignee-picker");

    if (toggle) {
        event.preventDefault();

        const currentPicker = toggle.closest(".assignee-picker");
        const shouldOpen = !currentPicker.classList.contains("open");

        closeAssigneePickers(currentPicker);
        currentPicker.classList.toggle("open", shouldOpen);
        return;
    }

    if (choice) {
        event.preventDefault();

        const currentPicker = choice.closest(".assignee-picker");
        choice.classList.toggle("selected");
        updateAssigneePicker(currentPicker);
        return;
    }

    if (remove) {
        event.preventDefault();

        const currentPicker = remove.closest(".assignee-picker");
        const userId = String(remove.dataset.userId || "");
        const matchingChoice = currentPicker.querySelector(`.assignee-choice[data-user-id="${CSS.escape(userId)}"]`);

        if (matchingChoice) {
            matchingChoice.classList.remove("selected");
        }

        updateAssigneePicker(currentPicker);
        return;
    }

    if (!picker) {
        closeAssigneePickers();
    }
});

document.getElementById("addTaskBtn")?.addEventListener("click", () => {
    createTask().catch(error => alert(error.message));
});

document.getElementById("taskQuickFilters")?.addEventListener("click", event => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;

    const requestedFilter = button.dataset.filter || ALL_FILTER;

    if (requestedFilter === OVERDUE_FILTER && !canViewOverdueFilter()) {
        alert("Du hast keine Berechtigung für den Überfällig-Filter.");
        return;
    }

    activeFilter = requestedFilter;
    renderDepartmentTabs();
    setCreateFormDepartment();
    loadTasks().catch(error => alert(error.message));
});

document.getElementById("departmentDropdown")?.addEventListener("change", event => {
    const value = event.target.value;

    if (!value) return;

    activeFilter = value;
    renderDepartmentTabs();
    setCreateFormDepartment();
    loadTasks().catch(error => alert(error.message));
});

document.getElementById("tasksBody")?.addEventListener("click", event => {
    const row = event.target.closest("tr[data-id]");
    if (!row) return;

    if (event.target.classList.contains("assignee-edit-toggle")) {
        const editor = row.querySelector(".assignee-editor");
        const button = event.target;

        if (editor) {
            const isCollapsed = editor.classList.toggle("collapsed");
            button.textContent = isCollapsed ? "Zuständige bearbeiten" : "Zuständige ausblenden";
        }

        return;
    }

    if (event.target.classList.contains("save-task")) {
        saveTask(row).catch(error => alert(error.message));
    }

    if (event.target.classList.contains("delete-task")) {
        deleteTask(row).catch(error => alert(error.message));
    }
});

async function init() {
    await loadCurrentUser();
    await loadDepartmentsAndUsers();
    await loadTasks();
}

init().catch(error => alert(error.message));
