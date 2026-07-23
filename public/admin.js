let adminData = null;
let autoRefreshTimer = null;

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function formatBytes(bytes) {
    const size = Number(bytes || 0);
    if (size >= 1024 ** 4) return `${(size / 1024 ** 4).toFixed(2)} TB`;
    if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(2)} GB`;
    if (size >= 1024 ** 2) return `${(size / 1024 ** 2).toFixed(2)} MB`;
    if (size >= 1024) return `${(size / 1024).toFixed(2)} KB`;
    return `${size} B`;
}

function formatDuration(ms) {
    const totalSeconds = Math.floor(Number(ms || 0) / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const parts = [];
    if (days) parts.push(`${days}T`);
    if (hours || days) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);
    return parts.join(" ");
}

function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("de-DE");
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

function metricCard(label, value, hint = "", action = "") {
    return `
        <div class="admin-metric-card ${action ? "clickable" : ""}" ${action ? `data-switch-tab="${escapeHtml(action)}"` : ""}>
            <strong>${escapeHtml(value)}</strong>
            <span>${escapeHtml(label)}</span>
            ${hint ? `<small>${escapeHtml(hint)}</small>` : ""}
        </div>
    `;
}

function infoRow(label, value, action = "") {
    return `
        <div class="admin-info-row">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
            ${action ? `<button class="mini-action" data-admin-action="${escapeHtml(action)}" type="button">Ausführen</button>` : ""}
        </div>
    `;
}

function adminQuietHoursDurationMinutes(startValue, endValue, enabled) {
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

function adminQuietHoursValidationMessage(enabled, start, end) {
    const quietMinutes = adminQuietHoursDurationMinutes(start, end, enabled);
    const reachableMinutes = (24 * 60) - quietMinutes;

    return enabled && reachableMinutes < 8 * 60
        ? "Ruhezeit zu lang. Es müssen mindestens 8 Stunden Erreichbarkeit pro Tag bleiben. Maximal erlaubt sind 16 Stunden Ruhezeit."
        : "";
}

function formatAdminQuietHours(quietHours = {}) {
    if (!quietHours.enabled) return "Deaktiviert";

    return `${quietHours.start || "22:00"} bis ${quietHours.end || "09:00"}`;
}

function getQuietHoursMemberById(userId) {
    const members = Array.isArray(adminData?.quietHours?.members) ? adminData.quietHours.members : [];
    return members.find(member => String(member.id || "") === String(userId || "")) || null;
}

function renderCountList(items = [], empty = "Keine Daten", max = 15) {
    const list = Array.isArray(items) ? items.slice(0, max) : [];
    if (!list.length) return `<div class="admin-empty">${escapeHtml(empty)}</div>`;

    return `
        <div class="admin-count-list">
            ${list.map(item => `
                <div>
                    <span>${escapeHtml(item.name)}</span>
                    <strong>${escapeHtml(item.count)}</strong>
                </div>
            `).join("")}
        </div>
    `;
}

function switchTab(tab) {
    document.querySelectorAll(".admin-tab").forEach(button => {
        button.classList.toggle("active", button.dataset.tab === tab);
    });
    document.querySelectorAll(".admin-tab-panel").forEach(panel => {
        panel.classList.toggle("active", panel.dataset.panel === tab);
    });
}

function renderOverviewCards(data) {
    const cards = [
        metricCard("Teammitglieder", data.team.total, `${data.team.knownUsers} bekannte Logins`, "team"),
        metricCard("Eingeloggt", data.team.loggedInTeamCount || 0, `${data.team.notLoggedInTeamCount || 0} noch nie`, "loggedTeam"),
        metricCard("Aufgaben", data.tasks.total, `${data.tasks.overdue} überfällig`, "tasks"),
        metricCard("Abmeldungen", data.absences.total, `${data.absences.unclear} unklar`, "absences"),
        metricCard("Akteneinträge", data.records.entriesTotal, `${data.records.bad} schlecht`, "records"),
        metricCard("Uploads", data.content.attachments, formatBytes(data.content.attachmentBytes), "uploads"),
        metricCard("Upload-Speicher", formatBytes(data.system.uploads.bytes), `${data.system.uploads.files} Dateien`, "uploads"),
        metricCard("Voice aktiv", data.voice.activeNow.length, `${data.voice.trackedUsers} Nutzer getrackt`, "voice"),
        metricCard("Discord Rollen", data.discord.rolesTotal || 0, `${(data.discord.highPermissionRoles || []).length} kritische Rollen`, "roles"),
        metricCard("Discord Audit", (data.discord.auditLogs?.entries || []).length, data.discord.auditLogs?.error ? "Berechtigung fehlt?" : "letzte Einträge", "discordAudit"),
        metricCard("Tool-Audit", data.audit.total, "Sicherheitsprotokoll", "audit")
    ];
    document.getElementById("adminOverviewCards").innerHTML = cards.join("");
}

function renderWarnings(data) {
    const box = document.getElementById("adminWarnings");
    const warnings = Array.isArray(data.warnings) ? data.warnings : [];

    if (!warnings.length) {
        box.classList.add("hidden");
        box.innerHTML = "";
        return;
    }

    box.classList.remove("hidden");
    box.innerHTML = `
        <h2>Warnungen</h2>
        ${warnings.map(warning => `<div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;color:#ffb454;"><path d="M12 9v4M12 17h.01M10.3 3.9 2.6 18a1.8 1.8 0 0 0 1.5 2.7h15.8a1.8 1.8 0 0 0 1.5-2.7L13.7 3.9a1.8 1.8 0 0 0-3.4 0Z"/></svg> ${escapeHtml(warning)}</div>`).join("")}
    `;
}

function renderAdminNotifications(data) {
    const target = document.getElementById("adminNotifications");
    if (!target) return;

    const notifications = Array.isArray(data.notifications) ? data.notifications : [];

    if (!notifications.length) {
        target.innerHTML = `<div class="admin-success">Keine neuen Admin-Benachrichtigungen.</div>`;
        return;
    }

    target.innerHTML = `
        <div class="admin-notification-list">
            ${notifications.map(item => `
                <button class="admin-notification-card ${escapeHtml(item.level || "info")}" data-switch-tab="${escapeHtml(item.targetTab || "overview")}" type="button">
                    <strong>${escapeHtml(item.title || "Hinweis")}</strong>
                    <span>${escapeHtml(item.text || "")}</span>
                    ${item.count ? `<em>${escapeHtml(item.count)}</em>` : ""}
                </button>
            `).join("")}
        </div>
    `;
}

function renderDiagnostics(data) {
    const target = document.getElementById("diagnosticsOverview");
    if (!target) return;

    const diagnostics = data.diagnostics || {};
    const recent = Array.isArray(diagnostics.recent) ? diagnostics.recent : [];

    if (!recent.length) {
        target.innerHTML = `<div class="admin-success">Keine Diagnosefehler gespeichert.</div>`;
        return;
    }

    const renderLog = log => `
        <article class="diagnostic-card ${escapeHtml(log.level || "error")}">
            <div class="diagnostic-card-head">
                <strong>${escapeHtml(log.message || log.type || "Fehler")}</strong>
                <span>${escapeHtml(formatDate(log.createdAt))}</span>
            </div>
            <div class="diagnostic-meta">
                <span>Typ: ${escapeHtml(log.type || "—")}</span>
                <span>Route: ${escapeHtml(log.method || "")} ${escapeHtml(log.route || "—")}</span>
                <span>Status: ${escapeHtml(log.statusCode || "—")}</span>
                <span>Nutzer: ${escapeHtml(log.userName || log.userId || "—")}</span>
            </div>
            ${log.stack ? `<details><summary>Stacktrace</summary><pre class="audit-detail">${escapeHtml(log.stack)}</pre></details>` : ""}
            ${log.details ? `<details><summary>Details</summary><pre class="audit-detail">${escapeHtml(JSON.stringify(log.details, null, 2))}</pre></details>` : ""}
        </article>
    `;

    target.innerHTML = `
        <div class="admin-metric-grid">
            ${metricCard("Serverfehler", (diagnostics.serverErrors || []).length, "letzte Einträge")}
            ${metricCard("Discord-API-Fehler", (diagnostics.discordErrors || []).length, "letzte Einträge")}
            ${metricCard("HTTP 500", (diagnostics.http500 || []).length, "letzte Einträge")}
        </div>
        <div class="diagnostic-list">
            ${recent.map(renderLog).join("")}
        </div>
    `;
}

function renderSystemCheckResult(result) {
    const target = document.getElementById("systemCheckResult");
    if (!target) return;

    const checks = Array.isArray(result?.checks) ? result.checks : [];

    target.classList.remove("hidden");
    target.innerHTML = `
        <h3>Systemprüfung ${result?.ok ? "<svg viewBox='0 0 24 24' fill='none' stroke='#3ddc84' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' style='width:16px;height:16px;vertical-align:-3px;'><circle cx='12' cy='12' r='9'/><path d='m8 12.5 2.5 2.5L16 9.5'/></svg>" : "<svg viewBox='0 0 24 24' fill='none' stroke='#ffb454' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' style='width:16px;height:16px;vertical-align:-3px;'><path d='M12 9v4M12 17h.01M10.3 3.9 2.6 18a1.8 1.8 0 0 0 1.5 2.7h15.8a1.8 1.8 0 0 0 1.5-2.7L13.7 3.9a1.8 1.8 0 0 0-3.4 0Z'/></svg>"}</h3>
        <div class="system-check-list">
            ${checks.map(check => `
                <div class="system-check-item ${escapeHtml(check.level || (check.ok ? "success" : "danger"))}">
                    <strong>${check.ok ? "<svg viewBox='0 0 24 24' fill='none' stroke='#3ddc84' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' style='width:14px;height:14px;vertical-align:-2px;margin-right:4px;'><circle cx='12' cy='12' r='9'/><path d='m8 12.5 2.5 2.5L16 9.5'/></svg>" : "<svg viewBox='0 0 24 24' fill='none' stroke='#ff5c72' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' style='width:14px;height:14px;vertical-align:-2px;margin-right:4px;'><circle cx='12' cy='12' r='9'/><path d='m9.5 9.5 5 5m0-5-5 5'/></svg>"} ${escapeHtml(check.label)}</strong>
                    <span>${escapeHtml(check.details || "")}</span>
                </div>
            `).join("")}
        </div>
    `;
}

function renderHealth(data) {
    const health = data.health || { issues: [] };
    const issues = Array.isArray(health.issues) ? health.issues : [];

    document.getElementById("healthOverview").innerHTML = issues.length
        ? `<div class="admin-health-list">${issues.map(issue => `<div class="${escapeHtml(issue.level)}">${escapeHtml(issue.text)}</div>`).join("")}</div>`
        : `<div class="admin-success">Keine akuten Probleme gefunden.</div>`;
}

function renderSystem(data) {
    const system = data.system || {};
    const memory = system.memory || {};
    const bot = system.botStatus || {};
    document.getElementById("adminGeneratedAt").textContent = `Stand: ${formatDate(data.generatedAt)}`;

    document.getElementById("systemStatus").innerHTML = [
        infoRow("Dashboard-Uptime", formatDuration((system.dashboardUptimeSeconds || 0) * 1000)),
        infoRow("Node-Version", system.nodeVersion || "—"),
        infoRow("Plattform", system.platform || "—"),
        infoRow("RAM RSS", formatBytes(memory.rss)),
        infoRow("Heap benutzt", formatBytes(memory.heapUsed)),
        infoRow("Datenbank", formatBytes(system.database?.bytes || 0), "backup-db"),
        infoRow("Discord-Bot", bot.online ? "Online" : (bot.stale ? "Offline / Status veraltet" : "Unbekannt/Offline")),
        infoRow("Bot-User", bot.userTag || "—"),
        infoRow("Bot-Status aktualisiert", formatDate(bot.updatedAt)),
        infoRow("Server", bot.guildName || system.botStatus?.guildId || "—")
    ].join("");
}

function renderDiscord(data) {
    const discord = data.discord || {};
    const overview = discord.overview || {};
    const bot = discord.botStatus || {};
    const memberStats = discord.memberStats || overview.memberStats || {};
    const presences = memberStats.presences || {};
    const channelCounts = discord.channelTypeCounts || overview.channelTypeCounts || {};

    const channelCountItems = Object.entries(channelCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

    document.getElementById("discordOverview").innerHTML = `
        <div>
            <h3>Server</h3>
            ${infoRow("Guild-ID", discord.guildId || overview.guildId || "—")}
            ${infoRow("Servername", overview.guildName || bot.guildName || "—")}
            ${infoRow("Owner-ID", overview.ownerId || "—")}
            ${infoRow("Member laut Bot", overview.memberCount || bot.memberCount || "—")}
            ${infoRow("Member im Cache", overview.cachedMemberCount || memberStats.cached || "—")}
            ${infoRow("Humans im Cache", memberStats.humans || 0)}
            ${infoRow("Bots im Cache", memberStats.bots || 0)}
            ${infoRow("Boosts", overview.boostCount || 0)}
            ${infoRow("Boost-Level", overview.boostTier || 0)}
            ${infoRow("Zuletzt aktualisiert", formatDate(overview.updatedAt))}
        </div>
        <div>
            <h3>Status / Presences</h3>
            ${infoRow("Online", presences.online || 0)}
            ${infoRow("Idle", presences.idle || 0)}
            ${infoRow("DND", presences.dnd || 0)}
            ${infoRow("Offline/Invisible", presences.invisibleOrOffline || 0)}
            ${infoRow("Bot online", bot.online ? "Ja" : (bot.stale ? "Nein / Status veraltet" : "Unbekannt"))}
            ${infoRow("Bot-User", bot.userTag || "—")}
        </div>
        <div>
            <h3>Channels</h3>
            ${infoRow("Channels gesamt", overview.channelsTotal || (discord.channels || []).length || 0)}
            ${infoRow("Emojis", overview.emojiCount || 0)}
            ${infoRow("Sticker", overview.stickerCount || 0)}
            ${renderCountList(channelCountItems, "Keine Channel-Daten")}
        </div>
        <div>
            <h3>Rollen-Insights</h3>
            ${infoRow("Rollen gesamt", discord.rolesTotal || 0)}
            ${infoRow("Kritische Rollen", (discord.highPermissionRoles || []).length)}
            ${infoRow("Unbenutzte Rollen", (discord.unusedRoles || []).length)}
            ${infoRow("Bot-/Managed Rollen", (discord.managedRoles || []).length)}
            <button class="small-action" data-switch-tab="roles" type="button">Alle Rollen ansehen</button>
            <button class="small-action" data-switch-tab="discordAudit" type="button">Discord Audit ansehen</button>
        </div>
    `;
}

function renderDiscordRoles(data) {
    const roles = data.discord?.roles || [];

    document.getElementById("discordRolesOverview").innerHTML = `
        <table class="admin-table admin-table-compact">
            <thead>
                <tr>
                    <th>Rolle</th>
                    <th>Member</th>
                    <th>Position</th>
                    <th>Typ</th>
                    <th>Kritische Berechtigungen</th>
                    <th>ID</th>
                </tr>
            </thead>
            <tbody>
                ${roles.length ? roles.map(role => {
                    const permissions = Array.isArray(role.permissions) ? role.permissions : [];
                    const critical = permissions.filter(permission =>
                        ["Administrator", "ManageGuild", "ManageRoles", "ManageChannels", "BanMembers", "KickMembers", "ViewAuditLog"].includes(permission)
                    );

                    return `
                        <tr>
                            <td><strong>${escapeHtml(role.name)}</strong></td>
                            <td>${escapeHtml(role.memberCount || 0)}</td>
                            <td>${escapeHtml(role.position || 0)}</td>
                            <td>${role.managed ? "Managed/Bot" : "Normal"}${role.hoist ? " · separat" : ""}${role.mentionable ? " · mentionable" : ""}</td>
                            <td>${critical.length ? critical.map(item => `<span class="admin-badge danger">${escapeHtml(item)}</span>`).join(" ") : "—"}</td>
                            <td><small>${escapeHtml(role.id)}</small></td>
                        </tr>
                    `;
                }).join("") : `<tr><td colspan="6">Noch keine Rollen-Daten vorhanden.</td></tr>`}
            </tbody>
        </table>
    `;
}

function renderDiscordAudit(data) {
    const audit = data.discord?.auditLogs || {};
    const entries = Array.isArray(audit.entries) ? audit.entries : [];

    document.getElementById("discordAuditOverview").innerHTML = `
        ${audit.error ? `<div class="admin-error">Discord-Audit-Log konnte nicht gelesen werden: ${escapeHtml(audit.error)}</div>` : ""}
        <div class="admin-muted">Letzte Aktualisierung: ${escapeHtml(formatDate(audit.updatedAt))}</div>
        <table class="admin-table admin-table-compact">
            <thead>
                <tr>
                    <th>Zeit</th>
                    <th>Aktion</th>
                    <th>Ausgeführt von</th>
                    <th>Ziel</th>
                    <th>Grund</th>
                    <th>Änderungen</th>
                </tr>
            </thead>
            <tbody>
                ${entries.length ? entries.map(entry => `
                    <tr>
                        <td>${escapeHtml(formatDate(entry.createdAt))}</td>
                        <td>${escapeHtml(entry.action)}</td>
                        <td>${escapeHtml(entry.executorName || entry.executorId || "—")}</td>
                        <td>${escapeHtml(entry.targetName || entry.targetId || "—")}</td>
                        <td>${escapeHtml(entry.reason || "—")}</td>
                        <td>${Array.isArray(entry.changes) && entry.changes.length
                            ? entry.changes.map(change => `<span class="admin-badge">${escapeHtml(change.key)}</span>`).join(" ")
                            : "—"}</td>
                    </tr>
                `).join("") : `<tr><td colspan="6">Keine Discord-Audit-Einträge vorhanden oder keine Berechtigung.</td></tr>`}
            </tbody>
        </table>
    `;
}


function renderTeam(data) {
    document.getElementById("teamOverview").innerHTML = `
        <div>
            <h3>Ränge</h3>
            ${renderCountList(data.team.byRank || [])}
        </div>
        <div>
            <h3>Abteilungen</h3>
            ${renderCountList(data.team.byDepartment || [])}
        </div>
        <div>
            <h3>Teamwarns</h3>
            ${(data.team.warningRoles || []).length
                ? `<ul class="admin-simple-list">${data.team.warningRoles.map(member => `<li>${escapeHtml(member.name)} <small>${escapeHtml((member.roles || []).join(", "))}</small></li>`).join("")}</ul>`
                : `<div class="admin-empty">Keine Teamwarn-Rollen gefunden.</div>`}
            <h3>Ohne Abteilung</h3>
            ${(data.team.noDepartment || []).length
                ? `<ul class="admin-simple-list">${data.team.noDepartment.map(member => {
                    const name = typeof member === "string" ? member : member.name;
                    const rank = typeof member === "string" ? "" : member.rank;
                    const allRoles = typeof member === "string" ? "" : (member.allRoles || []).join(", ");
                    return `<li>${escapeHtml(name)}${rank ? `<small>${escapeHtml(rank)}</small>` : ""}${allRoles ? `<small>Alle Rollen: ${escapeHtml(allRoles)}</small>` : ""}</li>`;
                }).join("")}</ul>`
                : `<div class="admin-empty">Alle haben eine Abteilung.</div>`}
            <h3>Erkennungsprobleme</h3>
            ${(data.team.recognitionIssues || []).length
                ? `<ul class="admin-simple-list">${data.team.recognitionIssues.map(member => `<li><strong>${escapeHtml(member.name)}</strong><small>Rang: ${escapeHtml(member.rank)} · Abteilung: ${escapeHtml(member.department)}</small><small>Alle Rollen: ${escapeHtml((member.allRoles || []).join(", ") || "Keine")}</small></li>`).join("")}</ul>`
                : `<div class="admin-empty">Keine Erkennungsprobleme gefunden.</div>`}
        </div>
        <div>
            <h3>Alle Team-Rollen</h3>
            ${renderCountList(data.team.allRoles || [], "Keine Rollen gefunden", 50)}
        </div>
    `;
}

function renderLoggedTeamMembers(data) {
    const loggedIn = data.team.loggedInMembers || [];
    const notLoggedIn = data.team.notLoggedInMembers || [];

    const renderMemberList = (members, emptyText, showLogin = false) => {
        if (!Array.isArray(members) || !members.length) {
            return `<div class="admin-empty">${escapeHtml(emptyText)}</div>`;
        }

        return `
            <ul class="admin-simple-list">
                ${members.map(member => `
                    <li>
                        <strong>${escapeHtml(member.name || member.username || member.id)}</strong>
                        <small>${escapeHtml(member.rank || "Ohne Rang")} · ${escapeHtml(member.department || "Keine Abteilung")}</small>
                        ${showLogin ? `<small>Letzter Login: ${escapeHtml(formatDate(member.lastLoginAt))}</small>` : ""}
                    </li>
                `).join("")}
            </ul>
        `;
    };

    document.getElementById("loggedTeamOverview").innerHTML = `
        <div>
            <h3>Eingeloggt (${loggedIn.length})</h3>
            ${renderMemberList(loggedIn, "Noch kein Teammitglied hat sich eingeloggt.", true)}
        </div>
        <div>
            <h3>Noch nie eingeloggt (${notLoggedIn.length})</h3>
            ${renderMemberList(notLoggedIn, "Alle aktuellen Teammitglieder waren schon einmal eingeloggt.")}
        </div>
    `;
}

function renderOnboardingReset(data) {
    const target = document.getElementById("onboardingResetOverview");
    if (!target) return;

    const onboarding = data.onboarding || {};
    const members = Array.isArray(onboarding.members) ? onboarding.members : [];
    const resettable = members.filter(member => member.known);

    target.innerHTML = `
        <div class="admin-metric-grid compact">
            ${metricCard("Bekannte Nutzer", onboarding.totalKnown || resettable.length, "können zurückgesetzt werden")}
            ${metricCard("Onboarding erledigt", onboarding.seen || 0, "sehen es aktuell nicht")}
            ${metricCard("Bekommt Onboarding", onboarding.needsOnboarding || 0, "bei nächstem Öffnen")}
        </div>

        <div class="admin-onboarding-control">
            <label>
                Einzelnen Nutzer auswählen
                <select id="onboardingResetUserSelect">
                    <option value="">Nutzer auswählen...</option>
                    ${resettable.map(member => `
                        <option value="${escapeHtml(member.id)}">
                            ${escapeHtml(member.name || member.username || member.id)} · ${member.onboardingSeenAt ? "erledigt" : "bekommt es bereits"} · ${escapeHtml(member.rank || "Ohne Rang")}
                        </option>
                    `).join("")}
                </select>
            </label>
            <button class="small-action warning" data-admin-action="onboarding-reset-user" type="button">Ausgewähltem Nutzer nochmal geben</button>
        </div>

        <div class="admin-onboarding-list">
            ${members.length ? members.map(member => `
                <div class="admin-onboarding-row ${member.onboardingSeenAt ? "seen" : "pending"} ${member.known ? "" : "unknown"}">
                    <div>
                        <strong>${escapeHtml(member.name || member.username || member.id)}</strong>
                        <small>${escapeHtml(member.rank || "Ohne Rang")} · ${escapeHtml(member.department || "Keine Abteilung")}</small>
                        <small>${member.known
                            ? `Letztes Onboarding: ${escapeHtml(formatDate(member.onboardingSeenAt))}`
                            : "Noch nie eingeloggt · bekommt Onboarding automatisch beim ersten Login"}</small>
                    </div>
                    <span>${member.known
                        ? (member.onboardingSeenAt ? "Erledigt" : "Wartet")
                        : "Noch kein Login"}</span>
                </div>
            `).join("") : `<div class="admin-empty">Keine Nutzer vorhanden.</div>`}
        </div>
    `;
}

function renderAdminQuietHours(data) {
    const target = document.getElementById("adminQuietHoursOverview");
    if (!target) return;

    const quiet = data.quietHours || {};
    const members = Array.isArray(quiet.members) ? quiet.members : [];

    target.innerHTML = `
        <div class="admin-metric-grid compact">
            ${metricCard("Ruhezeiten aktiv", quiet.enabled || 0, "Nutzer")}
            ${metricCard("Ruhezeiten aus", quiet.disabled || 0, "Nutzer")}
            ${metricCard("Maximal erlaubt", "16h", "Ruhezeit pro Tag")}
        </div>

        <div class="admin-quiet-hours-control">
            <label>
                Nutzer auswählen
                <select id="adminQuietHoursUserSelect">
                    <option value="">Nutzer auswählen...</option>
                    ${members.map(member => `
                        <option value="${escapeHtml(member.id)}">
                            ${escapeHtml(member.name || member.username || member.id)} · ${escapeHtml(member.rank || "Ohne Rang")} · ${escapeHtml(formatAdminQuietHours(member.quietHours))}
                        </option>
                    `).join("")}
                </select>
            </label>

            <label class="admin-quiet-toggle">
                <input id="adminQuietHoursEnabled" type="checkbox">
                <span>Ruhezeiten aktivieren</span>
            </label>

            <label>
                Von
                <input id="adminQuietHoursStart" type="time" value="22:00">
            </label>

            <label>
                Bis
                <input id="adminQuietHoursEnd" type="time" value="09:00">
            </label>

            <button class="small-action" data-admin-action="quiet-hours-save" type="button">Ruhezeiten speichern</button>
        </div>

        <div id="adminQuietHoursError" class="settings-error hidden"></div>

        <div class="admin-quiet-hours-list">
            ${members.length ? members.map(member => `
                <div class="admin-quiet-hours-row ${member.quietHours?.enabled ? "enabled" : "disabled"}">
                    <div>
                        <strong>${escapeHtml(member.name || member.username || member.id)}</strong>
                        <small>${escapeHtml(member.rank || "Ohne Rang")} · ${escapeHtml(member.department || "Keine Abteilung")}</small>
                    </div>
                    <span>${escapeHtml(formatAdminQuietHours(member.quietHours))}</span>
                </div>
            `).join("") : `<div class="admin-empty">Keine Nutzer vorhanden.</div>`}
        </div>
    `;
}

function fillAdminQuietHoursForm(userId) {
    const member = getQuietHoursMemberById(userId);
    const quiet = member?.quietHours || { enabled: false, start: "22:00", end: "09:00" };

    document.getElementById("adminQuietHoursEnabled").checked = Boolean(quiet.enabled);
    document.getElementById("adminQuietHoursStart").value = quiet.start || "22:00";
    document.getElementById("adminQuietHoursEnd").value = quiet.end || "09:00";
    updateAdminQuietHoursError();
}

function setAdminQuietHoursError(message = "") {
    const box = document.getElementById("adminQuietHoursError");

    if (!box) return;

    box.textContent = message;
    box.classList.toggle("hidden", !message);
}

function updateAdminQuietHoursError() {
    const enabled = Boolean(document.getElementById("adminQuietHoursEnabled")?.checked);
    const start = document.getElementById("adminQuietHoursStart")?.value || "22:00";
    const end = document.getElementById("adminQuietHoursEnd")?.value || "09:00";

    setAdminQuietHoursError(adminQuietHoursValidationMessage(enabled, start, end));
}

async function saveAdminQuietHours() {
    const select = document.getElementById("adminQuietHoursUserSelect");
    const userId = select?.value || "";
    const member = getQuietHoursMemberById(userId);

    if (!userId || !member) {
        alert("Bitte zuerst einen Nutzer auswählen.");
        return;
    }

    const quietHours = {
        enabled: Boolean(document.getElementById("adminQuietHoursEnabled")?.checked),
        start: document.getElementById("adminQuietHoursStart")?.value || "22:00",
        end: document.getElementById("adminQuietHoursEnd")?.value || "09:00"
    };
    const message = adminQuietHoursValidationMessage(quietHours.enabled, quietHours.start, quietHours.end);

    if (message) {
        setAdminQuietHoursError(message);
        alert(message);
        return;
    }

    await apiRequest("api/admin/quiet-hours", {
        method: "POST",
        body: JSON.stringify({
            userId,
            userName: member.name || member.username || userId,
            username: member.username || "",
            quietHours
        })
    });

    alert(`Ruhezeiten gespeichert für ${member.name || member.username || userId}.`);
    await loadAdmin(true);
}

let currentVoiceRows = [];
let currentVoiceRange = "all";

function getVoiceRangeValue(user, range = currentVoiceRange) {
    if (range === "week") return Number(user.weekMs || 0);
    if (range === "month") return Number(user.monthMs || 0);
    return Number(user.allMs ?? user.totalMs ?? 0);
}

function buildVoiceRows(data) {
    const tracked = Array.isArray(data.voice.teamUsers) ? data.voice.teamUsers : [];
    const without = Array.isArray(data.voice.teamWithoutVoice) ? data.voice.teamWithoutVoice : [];
    const rows = new Map();

    tracked.forEach(user => {
        rows.set(String(user.userId || user.id || ""), {
            userId: user.userId || user.id,
            userName: user.userName || user.name || user.id,
            totalMs: Number(user.totalMs || user.allMs || 0),
            allMs: Number(user.allMs ?? user.totalMs ?? 0),
            weekMs: Number(user.weekMs || 0),
            monthMs: Number(user.monthMs || 0),
            requiredWeeklyMs: Number(user.requiredWeeklyMs || data.voice.weeklyMinimumMs || 0),
            approvedAbsenceThisWeek: Boolean(user.approvedAbsenceThisWeek),
            underWeeklyMinimum: Boolean(user.underWeeklyMinimum),
            sessions: Number(user.sessions || 0),
            active: Boolean(user.active),
            activeChannelName: user.activeChannelName || "",
            lastJoinedAt: user.lastJoinedAt || null,
            lastLeftAt: user.lastLeftAt || null,
            sessionHistory: Array.isArray(user.sessionHistory) ? user.sessionHistory : [],
            manualAdjustments: Array.isArray(user.manualAdjustments) ? user.manualAdjustments : [],
            hasTrackedRecord: true
        });
    });

    without.forEach(user => {
        const id = String(user.id || user.userId || "");
        if (!id || rows.has(id)) return;

        rows.set(id, {
            userId: id,
            userName: user.name || user.userName || id,
            totalMs: Number(user.totalMs || user.allMs || 0),
            allMs: Number(user.allMs || 0),
            weekMs: Number(user.weekMs || 0),
            monthMs: Number(user.monthMs || 0),
            requiredWeeklyMs: Number(user.requiredWeeklyMs || data.voice.weeklyMinimumMs || 0),
            approvedAbsenceThisWeek: Boolean(user.approvedAbsenceThisWeek),
            underWeeklyMinimum: Boolean(user.underWeeklyMinimum),
            sessions: 0,
            active: false,
            activeChannelName: "",
            lastJoinedAt: null,
            lastLeftAt: null,
            sessionHistory: [],
            manualAdjustments: [],
            hasTrackedRecord: false
        });
    });

    return [...rows.values()].sort((a, b) => getVoiceRangeValue(b) - getVoiceRangeValue(a) || String(a.userName || "").localeCompare(String(b.userName || ""), "de", { sensitivity: "base" }));
}

function renderVoiceMinimumWarnings(users, data) {
    const box = document.getElementById("voiceMinimumWarnings");
    if (!box) return;

    const under = users.filter(user => user.underWeeklyMinimum);
    const minimumText = formatDuration(data.voice.weeklyMinimumMs || 0);

    if (!under.length || currentVoiceRange !== "week") {
        box.classList.add("hidden");
        box.innerHTML = "";
        return;
    }

    box.classList.remove("hidden");
    box.innerHTML = `
        <strong><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;color:#ffb454;"><path d="M12 9v4M12 17h.01M10.3 3.9 2.6 18a1.8 1.8 0 0 0 1.5 2.7h15.8a1.8 1.8 0 0 0 1.5-2.7L13.7 3.9a1.8 1.8 0 0 0-3.4 0Z"/></svg> Unter Mindestzeit (${escapeHtml(minimumText)} pro Woche)</strong>
        <div class="voice-warning-list">
            ${under.slice(0, 20).map(user => `<span>${escapeHtml(user.userName)} (${escapeHtml(formatDuration(user.weekMs || 0))})</span>`).join("")}
        </div>
        ${under.length > 20 ? `<small>+ ${under.length - 20} weitere</small>` : ""}
    `;
}

function renderVoice(data) {
    const select = document.getElementById("voiceRangeFilter");
    if (select) {
        currentVoiceRange = select.value || currentVoiceRange || "all";
    }

    const users = buildVoiceRows(data);
    currentVoiceRows = users;

    const label = currentVoiceRange === "week"
        ? "diese Woche"
        : currentVoiceRange === "month"
            ? "letzter Monat"
            : "gesamt";

    const csv = document.getElementById("voiceExportCsv");
    const pdf = document.getElementById("voiceExportPdf");
    if (csv) csv.href = `api/admin/voice/export.csv?range=${encodeURIComponent(currentVoiceRange)}`;
    if (pdf) pdf.href = `api/admin/voice/export.pdf?range=${encodeURIComponent(currentVoiceRange)}`;

    renderVoiceMinimumWarnings(users, data);

    document.getElementById("voiceOverview").innerHTML = `
        <table class="admin-table voice-admin-table compact-voice-table">
            <thead>
                <tr>
                    <th>Teamler</th>
                    <th>Zeit (${escapeHtml(label)})</th>
                    <th>Woche</th>
                    <th>Status</th>
                    <th>Sessions</th>
                    <th>Aktion</th>
                </tr>
            </thead>
            <tbody>
                ${users.length ? users.map(user => {
                    const rangeMs = getVoiceRangeValue(user);
                    const minimumBadge = user.approvedAbsenceThisWeek
                        ? `<span class="admin-badge">Abgemeldet</span>`
                        : user.underWeeklyMinimum
                            ? `<span class="admin-badge danger">Unter 2h</span>`
                            : `<span class="admin-badge success">OK</span>`;

                    return `
                        <tr class="${user.active ? "admin-row-active" : ""}">
                            <td>
                                <strong>${escapeHtml(user.userName)}</strong>
                                <small class="voice-user-id">${escapeHtml(user.userId)}</small>
                            </td>
                            <td><strong>${escapeHtml(formatDuration(rangeMs))}</strong></td>
                            <td>
                                ${escapeHtml(formatDuration(user.weekMs || 0))}
                                <small>Minimum: ${escapeHtml(formatDuration(user.requiredWeeklyMs || 0))}</small>
                            </td>
                            <td>${minimumBadge}${user.active ? `<small><svg viewBox="0 0 24 24" fill="#3ddc84" style="width:9px;height:9px;vertical-align:1px;margin-right:4px;"><circle cx="12" cy="12" r="9"/></svg>${escapeHtml(user.activeChannelName || "Voice")}</small>` : ""}</td>
                            <td>${escapeHtml(user.sessions || 0)}</td>
                            <td>
                                <button class="small-action voice-edit-open" data-voice-action="open" data-user-id="${escapeHtml(user.userId)}" data-user-name="${escapeHtml(user.userName)}" type="button">Bearbeiten</button>
                            </td>
                        </tr>
                    `;
                }).join("") : `<tr><td colspan="6">Noch keine Teamdaten vorhanden.</td></tr>`}
            </tbody>
        </table>
    `;

    ensureVoiceEditModal();
}

function ensureVoiceEditModal() {
    if (document.getElementById("adminVoiceEditModal")) return;

    const modal = document.createElement("div");
    modal.id = "adminVoiceEditModal";
    modal.className = "voice-edit-modal hidden";
    modal.innerHTML = `
        <div class="voice-edit-backdrop" data-voice-modal-close="1"></div>
        <div class="voice-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="voiceEditTitle">
            <button class="voice-edit-close" data-voice-modal-close="1" type="button">×</button>
            <h2 id="voiceEditTitle">Voice-Zeit bearbeiten</h2>
            <p id="voiceEditSubtitle" class="admin-muted"></p>

            <div class="voice-edit-current">
                <div>
                    <span>Aktuelle Gesamtzeit</span>
                    <strong id="voiceEditCurrentTime">—</strong>
                </div>
                <div>
                    <span>Diese Woche</span>
                    <strong id="voiceEditWeekTime">—</strong>
                </div>
                <div>
                    <span>Letzter Monat</span>
                    <strong id="voiceEditMonthTime">—</strong>
                </div>
                <div>
                    <span>Sessions</span>
                    <strong id="voiceEditSessions">—</strong>
                </div>
            </div>

            <div class="voice-edit-form">
                <label>
                    Stunden
                    <input id="voiceEditHours" type="number" min="0" step="1" placeholder="0">
                </label>
                <label>
                    Minuten
                    <input id="voiceEditMinutes" type="number" min="0" step="1" placeholder="0">
                </label>
                <label class="wide">
                    Notiz optional
                    <input id="voiceEditNote" type="text" maxlength="300" placeholder="Warum wurde angepasst?">
                </label>
            </div>

            <div class="voice-edit-actions">
                <button class="small-action" data-voice-action="add" type="button">+ Zeit hinzufügen</button>
                <button class="small-action" data-voice-action="subtract" type="button">- Zeit abziehen</button>
                <button class="small-action" data-voice-action="set" type="button">Zeit setzen</button>
                <button class="small-action danger" data-voice-action="delete" type="button">Person rauslöschen</button>
            </div>

            <div class="voice-edit-history">
                <h3>Änderungsverlauf</h3>
                <div id="voiceEditHistory"></div>
            </div>

            <div class="voice-session-history">
                <h3>Voice-Verlauf</h3>
                <div id="voiceSessionHistory"></div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

function getVoiceAdjustmentLabel(mode) {
    const cleanMode = String(mode || "").toLowerCase();

    if (cleanMode === "add") return "+ Zeit";
    if (cleanMode === "subtract") return "- Zeit";
    if (cleanMode === "set") return "Gesetzt";

    return cleanMode || "Änderung";
}

function renderVoiceAdjustmentHistory(user) {
    const history = Array.isArray(user.manualAdjustments) ? user.manualAdjustments : [];

    if (!history.length) {
        return `<div class="admin-empty">Noch keine manuellen Änderungen vorhanden.</div>`;
    }

    return `
        <div class="voice-history-list">
            ${history.map(entry => `
                <div class="voice-history-item">
                    <div class="voice-history-top">
                        <strong>${escapeHtml(getVoiceAdjustmentLabel(entry.mode))}</strong>
                        <span>${escapeHtml(formatDate(entry.createdAt))}</span>
                    </div>
                    <div class="voice-history-meta">
                        <span>Bearbeiter: ${escapeHtml(entry.editedByName || entry.editedById || "Unbekannt")}</span>
                        <span>Wert: ${escapeHtml(formatDuration(entry.deltaMs || 0))}</span>
                    </div>
                    <div class="voice-history-meta">
                        <span>Vorher: ${escapeHtml(formatDuration(entry.beforeMs || 0))}</span>
                        <span>Nachher: ${escapeHtml(formatDuration(entry.afterMs || 0))}</span>
                    </div>
                    ${entry.note ? `<div class="voice-history-note">${escapeHtml(entry.note)}</div>` : `<div class="voice-history-note muted">Keine Notiz</div>`}
                </div>
            `).join("")}
        </div>
    `;
}

function renderVoiceSessionHistory(user) {
    const sessions = Array.isArray(user.sessionHistory) ? user.sessionHistory : [];

    if (!sessions.length) {
        return `<div class="admin-empty">Noch keine gespeicherten Voice-Sessions vorhanden.</div>`;
    }

    return `
        <div class="voice-history-list">
            ${sessions.slice(0, 50).map(session => `
                <div class="voice-history-item">
                    <div class="voice-history-top">
                        <strong>${escapeHtml(session.channelName || "Voice")}</strong>
                        <span>${escapeHtml(formatDuration(session.durationMs || 0))}</span>
                    </div>
                    <div class="voice-history-meta">
                        <span>Join: ${escapeHtml(formatDate(session.joinedAt))}</span>
                        <span>Leave: ${escapeHtml(formatDate(session.leftAt))}</span>
                    </div>
                    <div class="voice-history-note muted">Channel-ID: ${escapeHtml(session.channelId || "—")}</div>
                </div>
            `).join("")}
        </div>
    `;
}

function openVoiceEditModal(userId, userName = "") {
    ensureVoiceEditModal();

    const user = currentVoiceRows.find(row => String(row.userId) === String(userId)) || {
        userId,
        userName: userName || userId,
        totalMs: 0,
        allMs: 0,
        weekMs: 0,
        monthMs: 0,
        sessions: 0,
        sessionHistory: [],
        manualAdjustments: []
    };

    const modal = document.getElementById("adminVoiceEditModal");
    modal.dataset.userId = String(user.userId || userId);
    modal.dataset.userName = String(user.userName || userName || userId);

    document.getElementById("voiceEditTitle").textContent = `${user.userName || userName || userId}`;
    document.getElementById("voiceEditSubtitle").textContent = `Discord-ID: ${user.userId || userId}`;
    document.getElementById("voiceEditCurrentTime").textContent = formatDuration(user.allMs ?? user.totalMs ?? 0);
    document.getElementById("voiceEditWeekTime").textContent = formatDuration(user.weekMs || 0);
    document.getElementById("voiceEditMonthTime").textContent = formatDuration(user.monthMs || 0);
    document.getElementById("voiceEditSessions").textContent = String(user.sessions || 0);
    document.getElementById("voiceEditHours").value = "";
    document.getElementById("voiceEditMinutes").value = "";
    document.getElementById("voiceEditNote").value = "";
    document.getElementById("voiceEditHistory").innerHTML = renderVoiceAdjustmentHistory(user);
    document.getElementById("voiceSessionHistory").innerHTML = renderVoiceSessionHistory(user);

    modal.classList.remove("hidden");
    document.body.classList.add("modal-open");
}

function closeVoiceEditModal() {
    const modal = document.getElementById("adminVoiceEditModal");
    if (!modal) return;

    modal.classList.add("hidden");
    document.body.classList.remove("modal-open");
}

async function handleVoiceAction(action, userId, userName) {
    if (!action) return;

    if (action === "open") {
        openVoiceEditModal(userId, userName);
        return;
    }

    const modal = document.getElementById("adminVoiceEditModal");
    const activeUserId = userId || modal?.dataset.userId || "";
    const activeUserName = userName || modal?.dataset.userName || activeUserId;

    if (!activeUserId) return;

    if (action === "delete") {
        if (!confirm(`Voice-Zeit-Eintrag von ${activeUserName || activeUserId} wirklich löschen?`)) return;

        await apiRequest(`api/admin/voice/${encodeURIComponent(activeUserId)}`, {
            method: "DELETE"
        });

        closeVoiceEditModal();
        await loadAdmin(true);
        return;
    }

    const hours = Number(document.getElementById("voiceEditHours")?.value || 0);
    const minutes = Number(document.getElementById("voiceEditMinutes")?.value || 0);
    const note = document.getElementById("voiceEditNote")?.value || "";

    if ((!Number.isFinite(hours) || hours < 0) || (!Number.isFinite(minutes) || minutes < 0)) {
        alert("Bitte eine gültige Zeit eingeben.");
        return;
    }

    if (hours === 0 && minutes === 0) {
        alert("Bitte mindestens Stunden oder Minuten eintragen.");
        return;
    }

    if (action === "set" && !confirm(`Voice-Zeit von ${activeUserName || activeUserId} wirklich auf ${hours}h ${minutes}min setzen?`)) {
        return;
    }

    await apiRequest(`api/admin/voice/${encodeURIComponent(activeUserId)}/adjust`, {
        method: "POST",
        body: JSON.stringify({
            mode: action,
            hours,
            minutes,
            userName: activeUserName,
            note
        })
    });

    closeVoiceEditModal();
    await loadAdmin(true);
}


function renderTasks(data) {
    document.getElementById("taskOverview").innerHTML = `
        <div>
            ${infoRow("Gesamt", data.tasks.total)}
            ${infoRow("Überfällig", data.tasks.overdue)}
            ${infoRow("Heute fällig", data.tasks.dueToday)}
            ${infoRow("Ohne Zuständige", data.tasks.noAssignees)}
        </div>
        <div>
            <h3>Status</h3>
            ${renderCountList(data.tasks.byStatus || [])}
            <h3>Abteilungen</h3>
            ${renderCountList(data.tasks.byDepartment || [])}
        </div>
        <div>
            <h3>Top Ersteller</h3>
            ${renderCountList(data.tasks.byCreator || [])}
            <h3>Top Zuständige</h3>
            ${renderCountList(data.tasks.byAssignee || [])}
        </div>
    `;
}

function renderAbsences(data) {
    document.getElementById("absenceOverview").innerHTML = `
        <div>
            ${infoRow("Gesamt", data.absences.total)}
            ${infoRow("Aktiv", data.absences.active)}
            ${infoRow("Unklar", data.absences.unclear)}
            ${infoRow("Abgelehnt", data.absences.rejected)}
            ${infoRow("Laufen heute ab", data.absences.endingToday)}
            ${infoRow("Laufen diese Woche ab", data.absences.endingThisWeek)}
        </div>
        <div>
            <h3>Personen mit Abmeldungen</h3>
            ${renderCountList(data.absences.byUser || [], "Keine Abmeldungen")}
        </div>
    `;
}

function renderRecords(data) {
    document.getElementById("recordOverview").innerHTML = `
        <div>
            ${infoRow("Personen mit Akte", data.records.personsWithRecords)}
            ${infoRow("Einträge gesamt", data.records.entriesTotal)}
            ${infoRow("Gut", data.records.good)}
            ${infoRow("Neutral", data.records.neutral)}
            ${infoRow("Schlecht", data.records.bad)}
        </div>
        <div>
            <h3>Viele schlechte Einträge</h3>
            ${renderCountList(data.records.topBad || [], "Keine schlechten Einträge")}
            <h3>Viele gute Einträge</h3>
            ${renderCountList(data.records.topGood || [], "Keine guten Einträge")}
        </div>
        <div>
            <h3>Neueste Einträge</h3>
            ${(data.records.latest || []).length
                ? `<ul class="admin-simple-list">${data.records.latest.map(entry => `<li><strong>${escapeHtml(entry.personName)}</strong> · ${escapeHtml(entry.type)} <small>${escapeHtml(formatDate(entry.createdAt))}</small></li>`).join("")}</ul>`
                : `<div class="admin-empty">Keine Akteneinträge.</div>`}
        </div>
    `;
}

function renderUploads(data) {
    const largest = data.content.largestUploads || [];
    const orphans = data.content.orphanUploads || [];

    document.getElementById("uploadOverview").innerHTML = `
        <div>
            ${infoRow("Upload-Ordner", formatBytes(data.system.uploads.bytes), "recalculate-storage")}
            ${infoRow("Dateien im Upload-Ordner", data.system.uploads.files)}
            ${infoRow("Ordner", data.system.uploads.directories)}
            ${infoRow("Anhänge in Daten", data.content.attachments)}
            ${infoRow("Anhang-Größe laut Daten", formatBytes(data.content.attachmentBytes))}
            ${infoRow("Verwaiste Dateien", orphans.length, "scan-orphans")}
            ${infoRow("Verwaiste Größe", formatBytes(data.content.orphanUploadBytes || 0))}
        </div>
        <div>
            <h3>Größte Dateien</h3>
            ${largest.length
                ? `<ul class="admin-simple-list">${largest.map(file => `<li>${escapeHtml(file.path)} <small>${escapeHtml(formatBytes(file.bytes))}</small></li>`).join("")}</ul>`
                : `<div class="admin-empty">Keine Dateien gefunden.</div>`}
        </div>
        <div>
            <h3>Verwaiste Uploads</h3>
            ${orphans.length
                ? `<ul class="admin-simple-list">${orphans.slice(0, 20).map(file => `<li>${escapeHtml(file.path)} <small>${escapeHtml(formatBytes(file.bytes))}</small></li>`).join("")}</ul>`
                : `<div class="admin-empty">Keine verwaisten Uploads gefunden.</div>`}
        </div>
    `;
}

function renderPermissions(data) {
    const permissions = data.permissions || {};
    const entries = Object.values(permissions);

    document.getElementById("permissionsOverview").innerHTML = entries.length ? entries.map(entry => `
        <div>
            <h3>${escapeHtml(entry.label || "Berechtigung")}</h3>
            <div class="admin-role-list">
                ${(entry.roles || []).map(role => `<span class="admin-badge">${escapeHtml(role)}</span>`).join("")}
            </div>
            ${entry.note ? `<p class="admin-muted">${escapeHtml(entry.note)}</p>` : ""}
        </div>
    `).join("") : `<div class="admin-empty">Keine Berechtigungsdaten vorhanden.</div>`;
}

function getAuditStatusClass(status) {
    const code = Number(status || 0);

    if (code >= 500) return "danger";
    if (code >= 400) return "warning";
    if (code >= 200 && code < 300) return "success";

    return "";
}

function formatAuditDetails(log) {
    const details = log.details || {};
    const payload = Object.keys(details).length ? details : log;

    return JSON.stringify(payload, null, 2);
}

function renderAudit(data) {
    const logs = Array.isArray(data.audit.recent) ? data.audit.recent : [];
    const searchInput = document.getElementById("auditSearch");
    const moduleSelect = document.getElementById("auditModuleFilter");
    const actionSelect = document.getElementById("auditActionFilter");

    const currentModule = moduleSelect?.value || "";
    const currentAction = actionSelect?.value || "";
    const search = String(searchInput?.value || "").toLowerCase();

    const modules = [...new Set(logs.map(log => log.module || "—"))].sort();
    const actions = [...new Set(logs.map(log => log.action || log.method || "—"))].sort();

    if (moduleSelect) {
        moduleSelect.innerHTML = `<option value="">Alle Module</option>` + modules.map(module => `<option value="${escapeHtml(module)}">${escapeHtml(module)}</option>`).join("");
        moduleSelect.value = currentModule;
    }

    if (actionSelect) {
        actionSelect.innerHTML = `<option value="">Alle Aktionen</option>` + actions.map(action => `<option value="${escapeHtml(action)}">${escapeHtml(action)}</option>`).join("");
        actionSelect.value = currentAction;
    }

    const filtered = logs.filter(log => {
        const module = log.module || "—";
        const action = log.action || log.method || "—";
        const haystack = [
            log.userName,
            log.action,
            log.method,
            log.module,
            log.targetId,
            JSON.stringify(log.details || {})
        ].join(" ").toLowerCase();

        return (!currentModule || module === currentModule) &&
            (!currentAction || action === currentAction) &&
            (!search || haystack.includes(search));
    });

    document.getElementById("auditOverview").innerHTML = `
        <div class="audit-card-list">
            ${filtered.length ? filtered.map(log => {
                const status = log.statusCode || log.details?.statusCode || "—";
                const methodAction = log.action || log.method || "—";

                return `
                    <article class="audit-card">
                        <div class="audit-card-main">
                            <div class="audit-card-time">
                                <strong>${escapeHtml(formatDate(log.createdAt))}</strong>
                                <small>${escapeHtml(log.userName || "Unbekannt")}</small>
                            </div>

                            <div class="audit-card-action">
                                <span class="admin-badge">${escapeHtml(methodAction)}</span>
                                <small>Ziel: ${escapeHtml(log.targetId || "—")}</small>
                            </div>

                            <div class="audit-card-meta">
                                <span>Modul: <strong>${escapeHtml(log.module || "—")}</strong></span>
                                <span>Status: <strong class="${escapeHtml(getAuditStatusClass(status))}">${escapeHtml(status)}</strong></span>
                            </div>
                        </div>

                        <details class="audit-card-details">
                            <summary>Details ansehen</summary>
                            <pre class="audit-detail">${escapeHtml(formatAuditDetails(log))}</pre>
                        </details>
                    </article>
                `;
            }).join("") : `<div class="admin-empty">Keine passenden Audit-Logs vorhanden.</div>`}
        </div>
    `;
}


function renderActions(data) {
    const actions = Array.isArray(data.actions) ? data.actions : [];
    const html = actions.map(action => `
        <button class="admin-action-card ${action.danger ? "danger" : ""}" data-admin-action="${escapeHtml(action.id)}" type="button">
            <strong>${escapeHtml(action.label)}</strong>
            <span>${escapeHtml(action.description)}</span>
        </button>
    `).join("");

    document.getElementById("quickActions").innerHTML = html;
    document.getElementById("allActions").innerHTML = html;
}

function renderAdmin(data) {
    adminData = data;
    document.getElementById("adminLiveDot")?.classList.add("active");
    document.getElementById("adminLiveText").textContent = "Live-Aktualisierung aktiv";

    renderWarnings(data);
    renderOverviewCards(data);
    renderAdminNotifications(data);
    renderSystem(data);
    renderHealth(data);
    renderDiagnostics(data);
    renderDiscord(data);
    renderDiscordRoles(data);
    renderDiscordAudit(data);
    renderTeam(data);
    renderLoggedTeamMembers(data);
    renderOnboardingReset(data);
    renderAdminQuietHours(data);
    renderVoice(data);
    renderPermissions(data);
    renderTasks(data);
    renderAbsences(data);
    renderRecords(data);
    renderUploads(data);
    renderAudit(data);
    renderActions(data);
}

async function loadAdmin(silent = false) {
    if (!silent) {
        document.getElementById("adminOverviewCards").innerHTML = metricCard("Lade Daten", "…");
    }

    const data = await apiRequest("api/admin/summary?t=" + Date.now());
    renderAdmin(data);
}

async function loadCurrentUser() {
    const response = await fetch("me?t=" + Date.now());
    if (!response.ok) return;

    const data = await response.json();
    const badge = document.getElementById("userBadge");

    if (badge && data.user) {
        badge.textContent = data.user.globalName || data.user.username || "Angemeldet";
    }
}

async function runAdminAction(actionId) {
    if (actionId === "refresh") {
        await loadAdmin();
        return;
    }

    if (actionId === "export-report") {
        window.open("api/admin/report", "_blank", "noopener");
        return;
    }

    if (actionId === "voice-notify-under-minimum") {
        const count = (adminData?.voice?.underMinimum || []).length;

        if (!count) {
            alert("Aktuell ist kein Teammitglied unter der Mindestzeit.");
            return;
        }

        if (!confirm(`${count} Teammitglied(er) unter Mindestzeit per Direktnachricht benachrichtigen?`)) {
            return;
        }

        const result = await apiRequest("api/admin/voice/notify-under-minimum", {
            method: "POST",
            body: "{}"
        });

        alert(`Benachrichtigung abgeschlossen.\nGesendet: ${(result.sent || []).length}\nFehlgeschlagen: ${(result.failed || []).length}`);
        await loadAdmin(true);
        return;
    }

    if (actionId === "onboarding-reset-all") {
        const count = Number(adminData?.onboarding?.totalKnown || 0);

        if (!count) {
            alert("Es gibt aktuell keine bekannten Nutzer zum Zurücksetzen.");
            return;
        }

        if (!confirm(`Onboarding für alle ${count} bekannten Nutzer erneut anzeigen?`)) {
            return;
        }

        const result = await apiRequest("api/admin/onboarding/reset", {
            method: "POST",
            body: JSON.stringify({ all: true })
        });

        alert(`Onboarding zurückgesetzt.\nBetroffen: ${result.total || 0} Nutzer`);
        await loadAdmin(true);
        return;
    }

    if (actionId === "onboarding-reset-user") {
        const select = document.getElementById("onboardingResetUserSelect");
        const userId = select?.value || "";
        const label = select?.selectedOptions?.[0]?.textContent?.trim() || userId;

        if (!userId) {
            alert("Bitte zuerst einen Nutzer auswählen.");
            return;
        }

        if (!confirm(`Onboarding für diesen Nutzer erneut anzeigen?\n\n${label}`)) {
            return;
        }

        const result = await apiRequest("api/admin/onboarding/reset", {
            method: "POST",
            body: JSON.stringify({ userIds: [userId] })
        });

        alert(`Onboarding zurückgesetzt.\nBetroffen: ${result.total || 0} Nutzer`);
        await loadAdmin(true);
        return;
    }

    if (actionId === "quiet-hours-save") {
        await saveAdminQuietHours();
        return;
    }

    if (actionId === "system-check") {
        const result = await apiRequest("api/admin/actions/system-check", {
            method: "POST",
            body: "{}"
        });
        renderSystemCheckResult(result);
        switchTab("overview");
        return;
    }

    const dangerous = ["cleanup-orphans", "clear-audit", "reset-voice"];

    if (dangerous.includes(actionId) && !confirm("Diese Aktion ist dauerhaft. Wirklich ausführen?")) {
        return;
    }

    const map = {
        "backup-db": "backup-db",
        "recalculate-storage": "recalculate-storage",
        "scan-orphans": "scan-orphans",
        "cleanup-orphans": "cleanup-orphans",
        "clear-audit": "clear-audit",
        "reset-voice": "reset-voice"
    };

    const endpoint = map[actionId];

    if (!endpoint) {
        alert("Unbekannte Aktion.");
        return;
    }

    const data = await apiRequest(`api/admin/actions/${endpoint}`, {
        method: "POST",
        body: "{}"
    });

    if (actionId === "backup-db") {
        alert(`Backup erstellt: ${data.fileName}`);
    } else if (actionId === "recalculate-storage") {
        alert(`Speicher neu berechnet: ${formatBytes(data.stats.bytes)} / ${data.stats.files} Dateien`);
    } else if (actionId === "scan-orphans") {
        alert(`${(data.orphans || []).length} verwaiste Datei(en) gefunden.`);
    } else if (actionId === "cleanup-orphans") {
        alert(`${data.deletedFiles || 0} Datei(en) gelöscht (${formatBytes(data.deletedBytes || 0)}).`);
    } else {
        alert("Aktion ausgeführt.");
    }

    await loadAdmin(true);
}

document.addEventListener("click", event => {
    const tabButton = event.target.closest(".admin-tab");
    const tabCard = event.target.closest("[data-switch-tab]");
    const actionButton = event.target.closest("[data-admin-action]");
    const voiceButton = event.target.closest("[data-voice-action]");
    const voiceModalClose = event.target.closest("[data-voice-modal-close]");

    if (voiceModalClose) {
        event.preventDefault();
        closeVoiceEditModal();
        return;
    }

    if (voiceButton) {
        event.preventDefault();
        handleVoiceAction(
            voiceButton.dataset.voiceAction,
            voiceButton.dataset.userId,
            voiceButton.dataset.userName
        ).catch(error => alert(error.message));
        return;
    }

    if (tabButton) {
        switchTab(tabButton.dataset.tab);
        return;
    }

    if (tabCard) {
        switchTab(tabCard.dataset.switchTab);
        return;
    }

    if (actionButton) {
        event.preventDefault();
        runAdminAction(actionButton.dataset.adminAction).catch(error => alert(error.message));
    }
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        closeVoiceEditModal();
    }
});

document.addEventListener("change", event => {
    if (event.target?.id === "adminQuietHoursUserSelect") {
        fillAdminQuietHoursForm(event.target.value);
    }

    if (["adminQuietHoursEnabled", "adminQuietHoursStart", "adminQuietHoursEnd"].includes(event.target?.id)) {
        updateAdminQuietHoursError();
    }

    if (event.target?.id === "voiceRangeFilter") {
        currentVoiceRange = event.target.value || "all";
        if (adminData) renderVoice(adminData);
    }

    if (event.target?.id === "auditModuleFilter" || event.target?.id === "auditActionFilter") {
        if (adminData) renderAudit(adminData);
    }
});

document.addEventListener("input", event => {
    if (["adminQuietHoursStart", "adminQuietHoursEnd"].includes(event.target?.id)) {
        updateAdminQuietHoursError();
    }

    if (event.target?.id === "auditSearch") {
        if (adminData) renderAudit(adminData);
    }
});

loadCurrentUser().catch(console.error);
loadAdmin().catch(error => {
    document.getElementById("adminOverviewCards").innerHTML = `<div class="admin-error">Fehler beim Laden: ${escapeHtml(error.message)}</div>`;
});

autoRefreshTimer = setInterval(() => {
    loadAdmin(true).catch(error => {
        console.warn("Admin-Live-Aktualisierung fehlgeschlagen:", error);
        document.getElementById("adminLiveDot")?.classList.remove("active");
        document.getElementById("adminLiveText").textContent = "Live-Aktualisierung gestört";
    });
}, 10000);
