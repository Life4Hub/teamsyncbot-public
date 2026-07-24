const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { Server } = require("socket.io");
const { readJsonFile, writeJsonFile, getDatabasePath } = require("./dataStore");

const app = express();
const httpServer = http.createServer(app);
let io = null;

app.enable("strict routing");

const PORT = Number(process.env.DASHBOARD_PORT || 3010);
const HOST = process.env.DASHBOARD_HOST || "127.0.0.1";
let BASE_PATH = process.env.DASHBOARD_BASE_PATH || "/Teamboard";

BASE_PATH = "/" + BASE_PATH.replace(/^\/+|\/+$/g, "");

const publicDir = path.join(__dirname, "public");
const viewsDir = path.join(__dirname, "views");
const uploadsDir = path.join(__dirname, "uploads");
const teamFile = path.join(__dirname, "team.json");
const tasksFile = path.join(__dirname, "tasks.json");
const usersFile = path.join(__dirname, "users.json");
const notificationsFile = path.join(__dirname, "task_notifications.json");
const absencesFile = path.join(__dirname, "absences.json");
const personRecordsFile = path.join(__dirname, "person_records.json");
const forumPostsFile = path.join(__dirname, "forum_posts.json");
const archiveEntriesFile = path.join(__dirname, "archive_entries.json");
const clipsEntriesFile = path.join(__dirname, "clips_entries.json");
const liveChatMessagesFile = path.join(__dirname, "live_chat_messages.json");
const auditLogsFile = path.join(__dirname, "audit_logs.json");
const voiceActivityFile = path.join(__dirname, "voice_activity.json");
const botStatusFile = path.join(__dirname, "bot_status.json");
const discordOverviewFile = path.join(__dirname, "discord_overview.json");
const discordAuditLogsFile = path.join(__dirname, "discord_audit_logs.json");
const diagnosticLogsFile = path.join(__dirname, "diagnostic_logs.json");
const queuedDmsFile = path.join(__dirname, "queued_dms.json");
const configFile = path.join(__dirname, "config.json");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function loadConfig() {
    const fileConfig = readJsonFile(configFile, {});

    return {
        token: process.env.DISCORD_TOKEN || fileConfig.token,
        guildId: process.env.DISCORD_GUILD_ID || fileConfig.guildId,
        clientId: process.env.DISCORD_CLIENT_ID || fileConfig.clientId,
        clientSecret: process.env.DISCORD_CLIENT_SECRET || fileConfig.clientSecret,
        redirectUri: process.env.DISCORD_REDIRECT_URI || fileConfig.redirectUri,
        sessionSecret: process.env.SESSION_SECRET || fileConfig.sessionSecret || crypto.randomBytes(32).toString("hex"),
        taskNotifyChannelId: process.env.TASK_NOTIFY_CHANNEL_ID || fileConfig.taskNotifyChannelId || "1248332849862410391",
        absenceChannelId: process.env.ABSENCE_CHANNEL_ID || fileConfig.absenceChannelId || "",
        dashboardUrl: process.env.DASHBOARD_URL || fileConfig.dashboardUrl || ""
    };
}

const CONFIG = loadConfig();

const TEAM_ROLES = [
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

const DEPARTMENTS = [
    "Leitung | 4Life",
    "Admin Leitung | 4Life",
    "Moderatoren Leitung | 4Life",
    "Support Leitung | 4Life",
    "Management Leitung | 4Life",
    "Entwickler Leitung | 4Life",
    "Cardev Leitung | 4Life",
    "Event Leitung | 4Life",
    "Frakverwaltung Leitung| 4Life",
    "Management | 4Life",
    "Entwickler | 4Life",
    "Event | 4Life",
    "Cardev  | 4Life",
    "Frakverwaltung | 4Life"
];

const TASK_DEPARTMENTS = ["Allgemein", ...DEPARTMENTS];
const TASK_PRIORITIES = ["Sehr niedrig", "Niedrig", "Mittel", "Hoch", "Sehr hoch"];
const TASK_STATUSES = ["Offen", "In Arbeit", "Erledigt", "Archiviert"];
const PERSON_RECORD_ENTRY_TYPES = ["Gut", "Neutral", "Schlecht"];
const MAX_PERSON_RECORD_NOTE_LENGTH = 2000;
const MAX_FORUM_CONTENT_LENGTH = 20000;
const MAX_ARCHIVE_DESCRIPTION_LENGTH = 20000;
const MAX_CLIP_DESCRIPTION_LENGTH = 5000;
const MAX_LIVE_CHAT_MESSAGE_LENGTH = 4000;
const MAX_LIVE_CHAT_MESSAGES_RETURNED = 250;
const MAX_CONTENT_ATTACHMENTS = 8;
const MAX_TASK_DESCRIPTION_LENGTH = 5000;
const DUE_REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;
const DUE_REMINDER_CHECK_MS = 30 * 60 * 1000;
const VOICE_MINIMUM_WEEKLY_MS = 2 * 60 * 60 * 1000;

const MAX_TASK_ATTACHMENT_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB pro Datei
const MAX_TASK_ATTACHMENTS = 5;
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "application/pdf",
    "text/plain",
    "application/zip",
    "application/x-zip-compressed",
    "application/x-rar-compressed",
    "application/vnd.rar",
    "application/x-7z-compressed",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);
const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
    ".png", ".jpg", ".jpeg", ".webp", ".gif",
    ".mp4", ".webm", ".mov",
    ".pdf", ".txt", ".zip", ".rar", ".7z",
    ".doc", ".docx", ".xls", ".xlsx"
]);
const ALLOWED_MEDIA_MIME_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "video/mp4",
    "video/webm",
    "video/quicktime"
]);
const ALLOWED_MEDIA_EXTENSIONS = new Set([
    ".png", ".jpg", ".jpeg", ".webp", ".gif",
    ".mp4", ".webm", ".mov"
]);

const ALLOWED_ACCESS_ROLES = new Set([...TEAM_ROLES, ...DEPARTMENTS]);

const ABSENCE_MANAGEMENT_ROLE_NAMES = new Set([
    "Inhaber",
    "stv. Inhaber",
    "Projektleitung",
    "stv. Projektleitung",
    "Teamleitung",
    "stv. Teamleitung",
    "CCM",
    "stv. CCM",
    "Management | 4Life",
    "Management Leitung | 4Life"
]);

const HANDOVER_SUGGESTION_ROLE_NAMES = new Set([
    "Inhaber",
    "Inhaber | 4Life",
    "stv. Inhaber",
    "stv. Inhaber | 4Life",
    "Projektleitung",
    "Projektleitung | 4Life",
    "stv. Projektleitung",
    "stv. Projektleitung | 4Life",
    "Teamleitung",
    "Teamleitung | 4Life",
    "stv. Teamleitung",
    "stv. Teamleitung | 4Life",
    "CCM",
    "CCM | 4Life",
    "stv. CCM",
    "stv. CCM | 4Life",
    "Management | 4Life",
    "Management Leitung | 4Life"
]);

function normalizePermissionRoleName(roleName) {
    return String(roleName || "")
        .normalize("NFKC")
        .replace(/\s+/g, "")
        .trim()
        .toLowerCase();
}

const HANDOVER_SUGGESTION_ROLE_KEYS = new Set(
    [...HANDOVER_SUGGESTION_ROLE_NAMES].map(normalizePermissionRoleName)
);

function canViewHandoverSuggestionsByRoles(roles = []) {
    return Array.isArray(roles) && roles.some(roleName =>
        HANDOVER_SUGGESTION_ROLE_KEYS.has(normalizePermissionRoleName(roleName))
    );
}


function canManageAbsencesByRoles(roles = []) {
    return Array.isArray(roles) && roles.some(roleName => {
        const cleanRole = String(roleName || "").trim().toLowerCase();

        if (!cleanRole) return false;

        return ABSENCE_MANAGEMENT_ROLE_NAMES.has(roleName) ||
            cleanRole.includes("inhaber") ||
            cleanRole.includes("projektleitung") ||
            cleanRole === "ccm" ||
            cleanRole === "stv. ccm" ||
            cleanRole.includes("teamleitung") ||
            cleanRole.includes("management");
    });
}

async function refreshSessionRoles(req) {
    if (!req.session?.user?.id) {
        return req.session?.roles || [];
    }

    try {
        const access = await checkTeamAccess(req.session.user.id);

        req.session.roles = access.roleNames;
        req.session.hasAccess = access.hasAccess;

        if (access.hasAccess) {
            saveKnownUser(req.session.user, access.roleNames, { touch: true });
        }

        return access.roleNames;
    } catch (error) {
        console.error("Discord-Rollen konnten nicht neu geladen werden:", error);
        return req.session.roles || [];
    }
}

async function requireAbsenceManager(req, res, next) {
    const roles = await refreshSessionRoles(req);

    if (canManageAbsencesByRoles(roles)) {
        return next();
    }

    return res.status(403).json({ error: "Keine Berechtigung für Abmeldungsverwaltung." });
}

async function requireHandoverManager(req, res, next) {
    const roles = await refreshSessionRoles(req);

    if (canViewHandoverSuggestionsByRoles(roles)) {
        return next();
    }

    return res.status(403).json({ error: "Keine Berechtigung für automatische Übergabevorschläge." });
}

const sessions = new Map();
const oauthStates = new Map();

let cachedGuildRoleMap = null;
let cachedGuildRoleMapUntil = 0;

function getCookieFromHeader(cookieHeader, name) {
    const cookie = cookieHeader || "";
    const parts = cookie.split(";").map(part => part.trim());

    for (const part of parts) {
        const [key, ...valueParts] = part.split("=");
        if (key === name) return decodeURIComponent(valueParts.join("="));
    }

    return null;
}

function getCookie(req, name) {
    return getCookieFromHeader(req.headers.cookie || "", name);
}

function setSessionCookie(res, token) {
    res.setHeader("Set-Cookie", [
        `teamsync_session=${encodeURIComponent(token)}; HttpOnly; Path=${BASE_PATH}; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`
    ]);
}

function clearSessionCookie(res) {
    res.setHeader("Set-Cookie", [
        `teamsync_session=; HttpOnly; Path=${BASE_PATH}; SameSite=Lax; Max-Age=0`
    ]);
}

function getSession(req) {
    const token = getCookie(req, "teamsync_session");
    if (!token) return null;

    const session = sessions.get(token);
    if (!session) return null;

    if (session.expiresAt < Date.now()) {
        sessions.delete(token);
        return null;
    }

    return session;
}

function getBaseUrl(req) {
    const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    return `${proto}://${host}`;
}

function getRedirectUri(req) {
    return CONFIG.redirectUri || `${getBaseUrl(req)}${BASE_PATH}/auth/discord/callback`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function getDiscordRetryAfterMs(response, bodyText = "") {
    const headerRetryAfter = Number(response?.headers?.get?.("retry-after") || 0);

    if (Number.isFinite(headerRetryAfter) && headerRetryAfter > 0) {
        return Math.ceil(headerRetryAfter * 1000);
    }

    try {
        const data = JSON.parse(bodyText || "{}");
        const bodyRetryAfter = Number(data.retry_after || 0);

        if (Number.isFinite(bodyRetryAfter) && bodyRetryAfter > 0) {
            return Math.ceil(bodyRetryAfter * 1000);
        }
    } catch (_) {}

    return 1000;
}

async function discordApi(url, options = {}, attempt = 1) {
    const maxAttempts = Number(options.maxAttempts || 4);
    const cleanOptions = { ...options };
    delete cleanOptions.maxAttempts;

    const response = await fetch(url, cleanOptions);

    if (!response.ok) {
        const body = await response.text().catch(() => "");

        if (response.status === 429 && attempt < maxAttempts) {
            const retryAfterMs = getDiscordRetryAfterMs(response, body) + 250;

            appendDiagnosticLog({
                type: "discord_api_rate_limit",
                level: "warning",
                message: `Discord Rate-Limit ${response.status}; Retry in ${retryAfterMs}ms`,
                route: url,
                method: cleanOptions.method || "GET",
                statusCode: response.status,
                details: {
                    attempt,
                    maxAttempts,
                    retryAfterMs,
                    body: body.slice(0, 1500)
                }
            });

            await sleep(retryAfterMs);
            return discordApi(url, options, attempt + 1);
        }

        const message = `Discord API Fehler ${response.status}: ${body}`;

        appendDiagnosticLog({
            type: response.status === 429 ? "discord_api_rate_limit_failed" : "discord_api_error",
            level: response.status >= 500 || response.status === 429 ? "error" : "warning",
            message,
            route: url,
            method: cleanOptions.method || "GET",
            statusCode: response.status,
            details: {
                attempt,
                maxAttempts,
                body: body.slice(0, 1500)
            }
        });

        throw new Error(message);
    }

    if (response.status === 204) {
        return null;
    }

    const text = await response.text().catch(() => "");

    if (!text) {
        return null;
    }

    return JSON.parse(text);
}


async function deliverDiscordDmNow(userId, content) {
    const id = String(userId || "").trim();

    if (!id || !CONFIG.token) return false;

    const channel = await discordApi("https://discord.com/api/v10/users/@me/channels", {
        method: "POST",
        headers: {
            Authorization: `Bot ${CONFIG.token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ recipient_id: id })
    });

    if (!channel?.id) return false;

    await discordApi(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
        method: "POST",
        headers: {
            Authorization: `Bot ${CONFIG.token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            content: String(content || "").slice(0, 1900),
            allowed_mentions: { parse: [] }
        })
    });

    return true;
}

async function sendDiscordDm(userId, content, options = {}) {
    const id = String(userId || "").trim();

    if (!id || !CONFIG.token) return false;

    if (!options.force) {
        const queueUntil = getQuietHoursQueueUntil(id);

        if (queueUntil) {
            queueDiscordDm(id, content, queueUntil, "quiet-hours");
            return true;
        }
    }

    return deliverDiscordDmNow(id, content);
}

async function processQueuedDms() {
    const rows = readQueuedDms();
    const now = Date.now();
    const remaining = [];

    for (const row of rows) {
        if (row.status !== "pending") {
            remaining.push(row);
            continue;
        }

        const sendAt = new Date(row.sendAt || 0).getTime();

        if (!Number.isFinite(sendAt) || sendAt > now) {
            remaining.push(row);
            continue;
        }

        try {
            await deliverDiscordDmNow(row.userId, row.content);
            await sleep(650);
        } catch (error) {
            const attempts = Number(row.attempts || 0) + 1;
            const retryAt = new Date(Date.now() + Math.min(60 * attempts, 3600) * 1000);

            appendDiagnosticLog({
                type: "queued_dm_error",
                level: attempts >= 5 ? "error" : "warning",
                message: "Zwischengespeicherte DM konnte nicht gesendet werden.",
                route: "queued-dms",
                method: "POST",
                statusCode: 0,
                userId: row.userId,
                details: {
                    attempts,
                    error: String(error?.message || error).slice(0, 1500)
                }
            });

            if (attempts < 5) {
                remaining.push({
                    ...row,
                    attempts,
                    sendAt: retryAt.toISOString(),
                    updatedAt: new Date().toISOString(),
                    lastError: String(error?.message || error).slice(0, 1500)
                });
            }
        }
    }

    if (remaining.length !== rows.length || JSON.stringify(remaining) !== JSON.stringify(rows)) {
        writeQueuedDms(remaining);
    }
}

async function reactToDiscordMessage(absence, emoji) {
    if (!CONFIG.token || !absence?.channelId || !absence?.messageId || !emoji) return false;

    const url = `https://discord.com/api/v10/channels/${encodeURIComponent(absence.channelId)}/messages/${encodeURIComponent(absence.messageId)}/reactions/${encodeURIComponent(emoji)}/@me`;

    await discordApi(url, {
        method: "PUT",
        headers: {
            Authorization: `Bot ${CONFIG.token}`
        }
    });

    return true;
}

async function removeOwnDiscordReaction(absence, emoji) {
    if (!CONFIG.token || !absence?.channelId || !absence?.messageId || !emoji) return false;

    const url = `https://discord.com/api/v10/channels/${encodeURIComponent(absence.channelId)}/messages/${encodeURIComponent(absence.messageId)}/reactions/${encodeURIComponent(emoji)}/@me`;

    await discordApi(url, {
        method: "DELETE",
        headers: {
            Authorization: `Bot ${CONFIG.token}`
        }
    });

    return true;
}

async function setAbsenceDiscordReaction(absence, targetEmoji) {
    const absenceEmojis = ["⏳", "⚠️", "✅", "❌"];

    // Erst die gewünschte Reaktion setzen, damit der Status sofort sichtbar ist.
    const result = await reactToDiscordMessage(absence, targetEmoji);

    // Danach alte Bot-Reaktionen langsam entfernen. Sonst ballert Discord bei mehrfachen
    // Abmeldungs-Updates schnell mit 429 Rate-Limits zurück.
    for (const emoji of absenceEmojis) {
        if (emoji === targetEmoji) continue;

        await sleep(450);

        try {
            await removeOwnDiscordReaction(absence, emoji);
        } catch (error) {
            // 404/403/429 nach allen Retries ist hier nicht kritisch.
            appendDiagnosticLog({
                type: "discord_reaction_cleanup_warning",
                level: "warning",
                message: `Alte Abmelde-Reaktion konnte nicht entfernt werden: ${emoji}`,
                route: `absence:${absence?.id || absence?.messageId || ""}`,
                method: "DELETE",
                statusCode: 0,
                details: {
                    emoji,
                    error: String(error?.message || error).slice(0, 1500)
                }
            });
        }
    }

    return result;
}

function formatAbsenceDm(absence, accepted = true) {
    const endText = absence.endAt
        ? new Date(absence.endAt).toLocaleString("de-DE")
        : "unbekannt";

    if (accepted) {
        return [
            "✅ Deine Abmeldung wurde akzeptiert.",
            `Bis: ${endText}`,
            absence.reason ? `Grund: ${absence.reason}` : "",
            absence.reviewedByName ? `Akzeptiert von: ${absence.reviewedByName}` : ""
        ].filter(Boolean).join("\n");
    }

    return [
        "❌ Deine Abmeldung wurde abgelehnt.",
        absence.reviewedByName ? `Abgelehnt von: ${absence.reviewedByName}` : "",
        "Bitte melde dich bei der Teamleitung, falls du Fragen dazu hast."
    ].filter(Boolean).join("\n");
}

async function getGuildRoleMap() {
    if (cachedGuildRoleMap && cachedGuildRoleMapUntil > Date.now()) {
        return cachedGuildRoleMap;
    }

    if (!CONFIG.token || !CONFIG.guildId) {
        throw new Error("Discord Bot-Token oder Guild-ID fehlt in config.json.");
    }

    const roles = await discordApi(
        `https://discord.com/api/v10/guilds/${CONFIG.guildId}/roles`,
        {
            headers: {
                Authorization: `Bot ${CONFIG.token}`
            }
        }
    );

    const map = new Map();

    for (const role of roles) {
        map.set(role.id, role.name);
    }

    cachedGuildRoleMap = map;
    cachedGuildRoleMapUntil = Date.now() + 5 * 60 * 1000;

    return map;
}

async function getDiscordUser(accessToken) {
    return discordApi("https://discord.com/api/v10/users/@me", {
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });
}

async function getGuildMember(userId) {
    return discordApi(
        `https://discord.com/api/v10/guilds/${CONFIG.guildId}/members/${userId}`,
        {
            headers: {
                Authorization: `Bot ${CONFIG.token}`
            }
        }
    );
}

async function checkTeamAccess(userId) {
    const [member, roleMap] = await Promise.all([
        getGuildMember(userId),
        getGuildRoleMap()
    ]);

    const roleNames = (member.roles || [])
        .map(roleId => roleMap.get(roleId))
        .filter(Boolean);

    const hasAccess = roleNames.some(roleName => ALLOWED_ACCESS_ROLES.has(roleName));

    return {
        hasAccess,
        roleNames
    };
}


const USER_START_PAGES = new Set([
    "/",
    "/tasks",
    "/absences",
    "/forum",
    "/archive",
    "/clips",
    "/livechat",
    "/admin"
]);

function getDefaultUserSettings() {
    return {
        startPage: "/",
        quietHours: {
            enabled: false,
            start: "22:00",
            end: "09:00"
        },
        loginRecap: {
            enabled: true,
            includeTasks: true,
            includeOverdue: true,
            includeForum: true,
            includeAbsences: true
        },
        appearance: {
            whiteMode: false
        }
    };
}

function normalizeTimeString(value, fallback) {
    const raw = String(value || "").trim();
    const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)$/);

    return match ? raw : fallback;
}

function normalizeUserSettings(input = {}) {
    const defaults = getDefaultUserSettings();
    const source = input && typeof input === "object" ? input : {};
    const quiet = source.quietHours && typeof source.quietHours === "object" ? source.quietHours : {};
    const recap = source.loginRecap && typeof source.loginRecap === "object" ? source.loginRecap : {};
    const appearance = source.appearance && typeof source.appearance === "object" ? source.appearance : {};
    const requestedStartPage = String(source.startPage || defaults.startPage);

    return {
        startPage: USER_START_PAGES.has(requestedStartPage) ? requestedStartPage : defaults.startPage,
        quietHours: {
            enabled: Boolean(quiet.enabled),
            start: normalizeTimeString(quiet.start, defaults.quietHours.start),
            end: normalizeTimeString(quiet.end, defaults.quietHours.end)
        },
        loginRecap: {
            enabled: recap.enabled !== false,
            includeTasks: recap.includeTasks !== false,
            includeOverdue: recap.includeOverdue !== false,
            includeForum: recap.includeForum !== false,
            includeAbsences: recap.includeAbsences !== false
        },
        appearance: {
            whiteMode: Boolean(appearance.whiteMode)
        }
    };
}

function getUserRowById(userId) {
    const id = String(userId || "");
    const users = readJsonFile(usersFile, []);

    return Array.isArray(users)
        ? users.find(user => String(user.id || "") === id) || null
        : null;
}

function getUserSettingsById(userId) {
    return normalizeUserSettings(getUserRowById(userId)?.settings || {});
}

function setUserSettingsById(userId, settingsPatch = {}) {
    const users = readJsonFile(usersFile, []);
    const id = String(userId || "");
    const now = new Date().toISOString();
    const index = users.findIndex(user => String(user.id || "") === id);
    const existing = index === -1 ? {} : users[index];
    const current = normalizeUserSettings(existing.settings || {});
    const settings = normalizeUserSettings({
        ...current,
        ...(settingsPatch || {}),
        quietHours: {
            ...current.quietHours,
            ...(settingsPatch?.quietHours || {})
        },
        loginRecap: {
            ...current.loginRecap,
            ...(settingsPatch?.loginRecap || {})
        },
        appearance: {
            ...current.appearance,
            ...(settingsPatch?.appearance || {})
        }
    });

    const row = {
        ...existing,
        id,
        username: existing.username || "",
        globalName: existing.globalName || existing.username || id,
        avatar: existing.avatar || "",
        roles: Array.isArray(existing.roles) ? existing.roles : [],
        settings,
        updatedAt: now,
        lastSeenAt: now
    };

    if (index === -1) {
        users.push({
            ...row,
            firstLoginAt: now,
            lastLoginAt: now
        });
    } else {
        users[index] = row;
    }

    users.sort((a, b) => String(a.globalName || a.username || "").localeCompare(String(b.globalName || b.username || ""), "de", { sensitivity: "base" }));
    writeJsonFile(usersFile, users);

    return settings;
}

function getUserStartPath(userId, roles = []) {
    const settings = getUserSettingsById(userId);
    const startPage = settings.startPage || "/";

    if (startPage === "/admin" && !hasInhaberPermission(roles)) {
        return "/";
    }

    return USER_START_PAGES.has(startPage) ? startPage : "/";
}

function minutesFromTimeString(value) {
    const [hours, minutes] = normalizeTimeString(value, "00:00").split(":").map(Number);

    return (hours * 60) + minutes;
}

function getQuietHoursDurationMinutes(quietHours = {}) {
    if (!quietHours?.enabled) return 0;

    const start = minutesFromTimeString(quietHours.start);
    const end = minutesFromTimeString(quietHours.end);

    if (start === end) return 0;

    return start < end
        ? end - start
        : (24 * 60) - start + end;
}

function getReachableMinutesForQuietHours(quietHours = {}) {
    return (24 * 60) - getQuietHoursDurationMinutes(quietHours);
}

function validateQuietHoursSettings(quietHours = {}) {
    const normalized = normalizeUserSettings({ quietHours }).quietHours;

    if (!normalized.enabled) {
        return { ok: true, quietHours: normalized };
    }

    const quietMinutes = getQuietHoursDurationMinutes(normalized);
    const reachableMinutes = getReachableMinutesForQuietHours(normalized);

    if (reachableMinutes < 8 * 60) {
        return {
            ok: false,
            error: "Ruhezeit zu lang. Du musst mindestens 8 Stunden pro Tag erreichbar bleiben. Maximal erlaubt sind 16 Stunden Ruhezeit pro Tag.",
            quietMinutes,
            reachableMinutes,
            quietHours: normalized
        };
    }

    return {
        ok: true,
        quietMinutes,
        reachableMinutes,
        quietHours: normalized
    };
}

function sanitizeSettingsPatchForRoles(settingsPatch = {}, roles = []) {
    const body = settingsPatch && typeof settingsPatch === "object" ? { ...settingsPatch } : {};

    if (body.startPage === "/admin" && !hasInhaberPermission(roles)) {
        body.startPage = "/";
    }

    return body;
}

function dateAtMinutes(baseDate, minutesOfDay) {
    const date = new Date(baseDate);
    date.setHours(Math.floor(minutesOfDay / 60), minutesOfDay % 60, 0, 0);
    return date;
}

function getQuietHoursQueueUntil(userId, now = new Date()) {
    const settings = getUserSettingsById(userId);
    const quiet = settings.quietHours || {};

    if (!quiet.enabled) return null;

    const start = minutesFromTimeString(quiet.start);
    const end = minutesFromTimeString(quiet.end);

    if (start === end) return null;

    const current = now.getHours() * 60 + now.getMinutes();

    if (start < end) {
        if (current >= start && current < end) {
            return dateAtMinutes(now, end);
        }

        return null;
    }

    if (current >= start) {
        const sendAt = dateAtMinutes(now, end);
        sendAt.setDate(sendAt.getDate() + 1);
        return sendAt;
    }

    if (current < end) {
        return dateAtMinutes(now, end);
    }

    return null;
}

function readQueuedDms() {
    const rows = readJsonFile(queuedDmsFile, []);
    return Array.isArray(rows) ? rows : [];
}

function writeQueuedDms(rows) {
    writeJsonFile(queuedDmsFile, Array.isArray(rows) ? rows.slice(-1000) : []);
}

function queueDiscordDm(userId, content, sendAt, reason = "quiet-hours") {
    const rows = readQueuedDms();
    const now = new Date().toISOString();

    rows.push({
        id: crypto.randomUUID(),
        userId: String(userId || ""),
        content: String(content || "").slice(0, 1900),
        reason,
        status: "pending",
        attempts: 0,
        sendAt: sendAt.toISOString(),
        createdAt: now,
        updatedAt: now
    });

    writeQueuedDms(rows);
}


const ONBOARDING_VERSION = "tools-guide-v1";

function saveKnownUser(user, roles, options = {}) {
    const users = readJsonFile(usersFile, []);
    const now = new Date().toISOString();
    const id = String(user?.id || "");
    const existingIndex = users.findIndex(item => String(item.id || "") === id);
    const existing = existingIndex === -1 ? {} : users[existingIndex];
    const isLogin = Boolean(options.isLogin);

    const row = {
        ...existing,
        id,
        username: user.username,
        globalName: user.globalName || user.username,
        avatar: user.avatar,
        roles: Array.isArray(roles) ? roles : [],
        firstLoginAt: existing.firstLoginAt || now,
        previousLoginAt: isLogin
            ? (existing.lastLoginAt || existing.lastSeenAt || existing.createdAt || null)
            : (existing.previousLoginAt || null),
        lastLoginAt: isLogin
            ? now
            : (existing.lastLoginAt || now),
        lastSeenAt: now,
        onboardingSeenAt: existing.onboardingSeenAt || null,
        onboardingVersion: existing.onboardingVersion || "",
        settings: normalizeUserSettings(existing.settings || {})
    };

    if (existingIndex === -1) {
        users.push(row);
    } else {
        users[existingIndex] = row;
    }

    users.sort((a, b) => String(a.globalName || a.username || "").localeCompare(String(b.globalName || b.username || ""), "de", { sensitivity: "base" }));
    writeJsonFile(usersFile, users);

    return row;
}

function getDashboardTaskUrl() {
    if (CONFIG.dashboardUrl) {
        return CONFIG.dashboardUrl.replace(/\/+$/g, "") + "/tasks";
    }

    if (CONFIG.redirectUri) {
        return CONFIG.redirectUri.replace(`${BASE_PATH}/auth/discord/callback`, `${BASE_PATH}/tasks`);
    }

    return `${BASE_PATH}/tasks`;
}

function getDashboardTaskDetailUrl(taskId) {
    return `${getDashboardTaskUrl().replace(/\/+$/g, "")}/${encodeURIComponent(taskId)}`;
}

function normalizeTaskDepartment(value) {
    const department = String(value || "Allgemein").trim();
    return TASK_DEPARTMENTS.includes(department) ? department : "Allgemein";
}

function normalizeTaskPriority(value) {
    const priority = String(value || "Mittel").trim();
    return TASK_PRIORITIES.includes(priority) ? priority : "Mittel";
}

function normalizeTaskStatus(value) {
    const status = String(value || "Offen").trim();
    return TASK_STATUSES.includes(status) ? status : "Offen";
}

function normalizeTaskDueDate(value) {
    const raw = String(value || "").trim();

    if (!raw) return null;

    const date = new Date(raw);

    if (Number.isNaN(date.getTime())) return null;

    return date.toISOString();
}

function sameStringArray(a, b) {
    const left = Array.isArray(a) ? a.map(String).sort() : [];
    const right = Array.isArray(b) ? b.map(String).sort() : [];

    if (left.length !== right.length) return false;

    return left.every((value, index) => value === right[index]);
}

function hasAssigneePayload(body) {
    return Object.prototype.hasOwnProperty.call(body, "assigneeIds") ||
        Object.prototype.hasOwnProperty.call(body, "assigneeId") ||
        Object.prototype.hasOwnProperty.call(body, "manualAssignees") ||
        Object.prototype.hasOwnProperty.call(body, "assignee");
}

function isTaskCreator(task, userId) {
    return String(task?.createdById || "") === String(userId || "");
}

function isTaskKnownAssignee(task, userId) {
    return (Array.isArray(task?.assignees) ? task.assignees : [])
        .some(assignee => String(assignee.id || "") === String(userId || ""));
}

function hasTaskOwnerPermission(roleNames = []) {
    return Array.isArray(roleNames) && roleNames.some(roleName => {
        const cleanRole = String(roleName || "").trim().toLowerCase();

        // Nur echter Inhaber bekommt globale Vollberechtigung im Aufgabenmodul.
        // "stv. Inhaber" zählt hier bewusst nicht.
        return cleanRole === "inhaber" || cleanRole === "inhaber | 4life";
    });
}

function canManageTask(task, userId, roleNames = []) {
    return hasTaskOwnerPermission(roleNames) || isTaskCreator(task, userId) || isTaskKnownAssignee(task, userId);
}

function splitManualAssignees(value) {
    if (Array.isArray(value)) {
        return value
            .map(item => String(item || "").trim())
            .filter(Boolean);
    }

    return String(value || "")
        .split(/[\n,;]+/g)
        .map(item => item.trim())
        .filter(Boolean);
}

function normalizeAssignees(body) {
    const users = readJsonFile(usersFile, []);
    const knownIds = new Set(users.map(user => String(user.id)));

    const requestedIds = Array.isArray(body.assigneeIds)
        ? body.assigneeIds
        : [body.assigneeIds, body.assigneeId].filter(Boolean);

    const assigneeIds = [...new Set(
        requestedIds
            .map(id => String(id || "").trim())
            .filter(id => id && knownIds.has(id))
    )];

    const assignees = assigneeIds.map(id => {
        const user = users.find(item => String(item.id) === id);
        return {
            id: user.id,
            username: user.username || "",
            name: user.globalName || user.username || user.id
        };
    });

    const manualAssignees = splitManualAssignees(body.manualAssignees || body.assignee)
        .filter(name => !assignees.some(user => user.name.toLowerCase() === name.toLowerCase()));

    return {
        assignees,
        manualAssignees,
        assigneeIds,
        assigneeId: assignees[0]?.id || "",
        assignee: [
            ...assignees.map(user => user.name),
            ...manualAssignees
        ].join(", ")
    };
}

function migrateTask(task) {
    const migrated = {
        ...task,
        comments: Array.isArray(task.comments)
            ? task.comments.map(comment => ({
                ...comment,
                id: String(comment.id || crypto.randomUUID()),
                userId: String(comment.userId || ""),
                userName: String(comment.userName || "Unbekannt"),
                message: String(comment.message || ""),
                attachments: normalizeAttachmentList(comment.attachments, {
                    uploadedById: comment.userId,
                    uploadedByName: comment.userName
                }),
                createdAt: comment.createdAt || new Date().toISOString(),
                editedAt: comment.editedAt || null
            }))
            : []
    };

    if (!Array.isArray(migrated.assignees)) {
        migrated.assignees = [];

        if (task.assigneeId) {
            migrated.assignees.push({
                id: String(task.assigneeId),
                username: "",
                name: task.assignee || String(task.assigneeId)
            });
        }
    }

    if (!Array.isArray(migrated.manualAssignees)) {
        migrated.manualAssignees = [];

        if (task.assignee && !task.assigneeId) {
            migrated.manualAssignees = splitManualAssignees(task.assignee);
        }
    }

    migrated.assigneeIds = migrated.assignees.map(user => user.id).filter(Boolean);
    migrated.assigneeId = migrated.assignees[0]?.id || "";
    migrated.assignee = [
        ...migrated.assignees.map(user => user.name || user.username || user.id),
        ...migrated.manualAssignees
    ].filter(Boolean).join(", ");

    migrated.priority = normalizeTaskPriority(migrated.priority);
    migrated.status = normalizeTaskStatus(migrated.status);
    migrated.dueDate = normalizeTaskDueDate(migrated.dueDate);
    migrated.dueReminderSentAssigneeIds = Array.isArray(migrated.dueReminderSentAssigneeIds)
        ? migrated.dueReminderSentAssigneeIds.map(String)
        : [];

    return migrated;
}

function readTasks() {
    return readJsonFile(tasksFile, []).map(task => migrateTask(task));
}

function writeTasks(tasks) {
    writeJsonFile(tasksFile, tasks.map(task => migrateTask(task)));
}

function migrateAbsence(absence) {
    return {
        id: String(absence.id || crypto.randomUUID()),
        userId: String(absence.userId || ""),
        userName: String(absence.userName || absence.username || "Unbekannt"),
        durationText: String(absence.durationText || ""),
        reason: String(absence.reason || ""),
        startAt: absence.startAt || absence.createdAt || new Date().toISOString(),
        endAt: absence.endAt || null,
        status: ["Beantragt", "Aktiv", "Unklar", "Abgelehnt"].includes(String(absence.status || ""))
            ? String(absence.status)
            : (absence.endAt ? "Beantragt" : "Unklar"),
        parseStatus: absence.parseStatus || (absence.endAt ? "parsed" : "needs_review"),
        messageId: String(absence.messageId || ""),
        channelId: String(absence.channelId || ""),
        guildId: String(absence.guildId || ""),
        messageUrl: String(absence.messageUrl || ""),
        originalContent: String(absence.originalContent || ""),
        createdById: String(absence.createdById || ""),
        createdByName: String(absence.createdByName || ""),
        reviewedById: String(absence.reviewedById || ""),
        reviewedByName: String(absence.reviewedByName || ""),
        reviewedAt: absence.reviewedAt || null,
        acceptedAt: absence.acceptedAt || null,
        rejectedAt: absence.rejectedAt || null,
        history: Array.isArray(absence.history) ? absence.history.slice(-100) : [],
        createdAt: absence.createdAt || new Date().toISOString(),
        updatedAt: absence.updatedAt || absence.createdAt || new Date().toISOString()
    };
}

function appendAbsenceHistory(absence, action, req = null, details = {}) {
    const migrated = migrateAbsence(absence);
    const history = Array.isArray(migrated.history) ? migrated.history : [];

    return migrateAbsence({
        ...migrated,
        history: [
            ...history,
            {
                id: crypto.randomUUID(),
                action: String(action || "updated"),
                byId: String(req?.session?.user?.id || ""),
                byName: getRequestUserName(req),
                details,
                createdAt: new Date().toISOString()
            }
        ].slice(-100)
    });
}

function formatDatetimeLocalForStorage(value) {
    const raw = String(value || "").trim();

    if (!raw) return null;

    const normalized = raw.length === 16 ? `${raw}:00` : raw;
    const date = new Date(normalized);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date.toISOString();
}

function getTeamMemberById(userId) {
    const id = String(userId || "");
    const team = readJsonFile(teamFile, []);

    return Array.isArray(team)
        ? team.find(member => String(member.id || "") === id)
        : null;
}

// Abgelaufene Abmeldungen werden absichtlich irgendwann entfernt (siehe
// README_ABMELDUNGEN.md), aber NICHT sofort: readAbsences() lief bisher bei
// jedem Seitenaufruf (und zusätzlich alle 10 Minuten im Hintergrund, siehe
// setInterval(readAbsences, ...) weiter unten) und löschte jede "Aktiv"-
// Abmeldung, deren endAt in der Vergangenheit lag, augenblicklich inkl.
// ihrer history. Der Frontend-Code (public/absences.js: getAbsenceStatus,
// die "Abgelaufen"-Statusfarbe, der Abmeldungs-Kalender mit Vergangenheits-
// ansicht) geht aber davon aus, dass abgelaufene Abmeldungen noch eine Weile
// sichtbar bleiben. In der Praxis wurden sie fast immer gelöscht, bevor
// irgendjemand sie als "Abgelaufen" zu sehen bekam - das war vermutlich der
// Grund, warum manche Abmeldungen "einfach verschwanden". Fix: erst nach
// einer Karenzzeit löschen, in der Zwischenzeit bleiben sie normal sichtbar.
// 7 Tage auf Wunsch, damit abgelaufene Abmeldungen eine Weile sichtbar
// bleiben, aber nicht dauerhaft anwachsen.
const ABSENCE_CLEANUP_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

function isAbsenceExpiredPastGrace(absence, now) {
    const migrated = migrateAbsence(absence);

    if (migrated.status !== "Aktiv" || !migrated.endAt) return false;

    const endTime = new Date(migrated.endAt).getTime();

    return !Number.isNaN(endTime) && endTime <= now - ABSENCE_CLEANUP_GRACE_MS;
}

function cleanupExpiredAbsences(absences) {
    const now = Date.now();
    const active = [];
    let changed = false;
    const removedIds = [];

    for (const absence of Array.isArray(absences) ? absences : []) {
        const migrated = migrateAbsence(absence);

        if (isAbsenceExpiredPastGrace(migrated, now)) {
            changed = true;
            removedIds.push(migrated.id);
            continue;
        }

        active.push(migrated);
    }

    return {
        active,
        changed,
        removedIds
    };
}

function readAbsences() {
    const raw = readJsonFile(absencesFile, []);
    const cleaned = cleanupExpiredAbsences(raw);

    if (cleaned.changed) {
        // Nicht die hier gelesene (evtl. schon leicht veraltete) Liste zurückschreiben:
        // Dieser Server und der Discord-Bot (index.js) räumen absences.json unabhängig
        // voneinander auf und der Bot kann jederzeit zwischen diesem Lesen und Schreiben
        // eine neue Abmeldung angelegt haben. Stattdessen kurz vor dem Schreiben frisch
        // neu laden und nur die hier ermittelten, längst abgelaufenen IDs entfernen -
        // alles andere (auch zwischenzeitlich vom Bot Hinzugefügtes) bleibt erhalten.
        const removedIdSet = new Set(cleaned.removedIds);
        const fresh = readJsonFile(absencesFile, []);
        const freshFiltered = fresh.filter(absence => !removedIdSet.has(String(absence?.id || "")));

        writeJsonFile(absencesFile, freshFiltered);
    }

    return cleaned.active
        .map(enrichAbsenceWithAccount)
        .sort((a, b) => {
            if (!a.endAt && b.endAt) return 1;
            if (a.endAt && !b.endAt) return -1;
            if (!a.endAt && !b.endAt) return String(a.userName).localeCompare(String(b.userName), "de", { sensitivity: "base" });
            return new Date(a.endAt).getTime() - new Date(b.endAt).getTime();
        });
}

function readAbsencesRawForManagement() {
    return readJsonFile(absencesFile, []).map(absence => enrichAbsenceWithAccount(absence));
}

function writeAbsences(absences) {
    writeJsonFile(absencesFile, Array.isArray(absences) ? absences.map(absence => migrateAbsence(absence)) : []);
}

function getAbsenceReviewer(req) {
    return {
        reviewedById: String(req.session?.user?.id || ""),
        reviewedByName: String(req.session?.user?.globalName || req.session?.user?.username || req.session?.user?.id || "Unbekannt"),
        reviewedAt: new Date().toISOString()
    };
}

function normalizePersonRecordType(value) {
    const type = String(value || "Neutral").trim();
    return PERSON_RECORD_ENTRY_TYPES.includes(type) ? type : "Neutral";
}

function getKnownPersonSummary(userId) {
    const id = String(userId || "");
    const knownUsers = readJsonFile(usersFile, []);
    const teamRows = readJsonFile(teamFile, []);

    const knownUser = knownUsers.find(user => String(user.id || "") === id);
    const teamMember = teamRows.find(member => String(member.id || "") === id);

    const source = teamMember || knownUser || {};

    return {
        id,
        name: String(source.name || source.globalName || source.username || "Unbekannt"),
        username: String(source.username || ""),
        avatar: String(source.avatar || "https://cdn.discordapp.com/embed/avatars/0.png"),
        rank: String(source.rank || ""),
        department: String(source.department || "")
    };
}


function isArchivedTask(task) {
    return normalizeTaskStatus(task?.status) === "Archiviert";
}

function isOpenTaskForAutomation(task) {
    const status = normalizeTaskStatus(task?.status);

    return status !== "Erledigt" && status !== "Archiviert";
}

function taskHasKnownAssignee(task, userId) {
    const id = String(userId || "");

    return Boolean(id) && (Array.isArray(task?.assignees) ? task.assignees : [])
        .some(assignee => String(assignee.id || "") === id);
}

function isRelevantAbsenceForHandover(absence) {
    const migrated = migrateAbsence(absence);

    if (!migrated.userId) return false;
    if (!["Aktiv", "Beantragt"].includes(migrated.status)) return false;

    if (migrated.endAt) {
        const end = new Date(migrated.endAt).getTime();

        if (Number.isFinite(end) && end < Date.now()) return false;
    }

    return true;
}

function isMoreRelevantAbsenceForHandover(candidate, current) {
    const statusRank = status => (status === "Aktiv" ? 0 : 1);
    const candidateRank = statusRank(candidate.status);
    const currentRank = statusRank(current.status);

    if (candidateRank !== currentRank) return candidateRank < currentRank;

    const candidateEnd = candidate.endAt ? new Date(candidate.endAt).getTime() : Infinity;
    const currentEnd = current.endAt ? new Date(current.endAt).getTime() : Infinity;

    return candidateEnd < currentEnd;
}

function buildAbsenceHandoverSuggestions() {
    const tasks = readTasks().filter(isOpenTaskForAutomation);
    const relevantAbsences = readAbsencesRawForManagement().filter(isRelevantAbsenceForHandover);

    // Eine Person kann mehrere gleichzeitig "relevante" Abmeldungen haben (z. B. eine
    // zweite, ergänzende oder korrigierende Nachricht für denselben/überschneidenden
    // Zeitraum). Ohne Deduplizierung nach Nutzer erschien dieselbe Person mit exakt
    // derselben Aufgabenliste mehrfach im Übergabevorschläge-Panel - das sah wie ein
    // Anzeigefehler ("doppelt") aus, war aber eine doppelte Datengrundlage. Pro Person
    // wird jetzt nur die relevanteste Abmeldung behalten (Aktiv vor Beantragt, danach
    // die am nächsten endende).
    const dedupedByUser = new Map();

    for (const absence of relevantAbsences) {
        const userId = String(absence.userId || "");
        if (!userId) continue;

        const existing = dedupedByUser.get(userId);

        if (!existing || isMoreRelevantAbsenceForHandover(absence, existing)) {
            dedupedByUser.set(userId, absence);
        }
    }

    const absences = [...dedupedByUser.values()];

    return absences
        .map(absence => {
            const affectedTasks = tasks
                .filter(task => taskHasKnownAssignee(task, absence.userId))
                .map(task => ({
                    id: task.id,
                    title: task.title || "Unbenannte Aufgabe",
                    status: task.status || "Offen",
                    priority: task.priority || "Mittel",
                    department: task.department || "Allgemein",
                    dueDate: task.dueDate || null,
                    createdBy: task.createdBy || "Unbekannt",
                    url: getDashboardTaskDetailUrl(task.id)
                }));

            return {
                absence: {
                    id: absence.id,
                    userId: absence.userId,
                    userName: absence.userName,
                    status: absence.status,
                    endAt: absence.endAt,
                    durationText: absence.durationText,
                    reason: absence.reason,
                    account: absence.account
                },
                tasks: affectedTasks,
                taskCount: affectedTasks.length
            };
        })
        .filter(item => item.taskCount > 0)
        .sort((a, b) => b.taskCount - a.taskCount || String(a.absence.userName || "").localeCompare(String(b.absence.userName || ""), "de", { sensitivity: "base" }));
}

function findAbsenceHandoverSuggestion(absenceId) {
    return buildAbsenceHandoverSuggestions()
        .find(item => String(item.absence.id || "") === String(absenceId || ""));
}

function getTeamLeadershipRecipients(excludeUserId = "") {
    const users = readJsonFile(usersFile, []);
    const excluded = String(excludeUserId || "");
    const seen = new Set();

    return users.filter(user => {
        const id = String(user.id || "");

        if (!id || id === excluded || seen.has(id)) return false;

        const roles = Array.isArray(user.roles) ? user.roles : [];
        const allowed = canManageAbsencesByRoles(roles) || roles.some(role => {
            const clean = String(role || "").trim().toLowerCase();

            return clean.includes("teamleitung") ||
                clean.includes("projektleitung") ||
                clean.includes("management") ||
                clean.includes("inhaber") ||
                clean === "ccm" ||
                clean === "stv. ccm";
        });

        if (!allowed) return false;

        seen.add(id);
        return true;
    });
}

function buildHandoverDmMessage(suggestion) {
    const absence = suggestion.absence || {};
    const taskLines = (suggestion.tasks || []).slice(0, 8).map(task =>
        `- ${task.title} (${task.status}, ${task.priority})${task.dueDate ? ` · fällig: ${new Date(task.dueDate).toLocaleString("de-DE")}` : ""}\n  ${task.url}`
    );

    return [
        "🔁 Übergabevorschlag wegen Abmeldung",
        "",
        `${absence.userName || "Ein Teammitglied"} ist abgemeldet${absence.endAt ? ` bis ${new Date(absence.endAt).toLocaleString("de-DE")}` : ""}.`,
        "",
        "Offene zugewiesene Aufgaben:",
        ...taskLines,
        suggestion.tasks.length > 8 ? `+ ${suggestion.tasks.length - 8} weitere Aufgabe(n)` : "",
        "",
        "Bitte prüft, ob die Aufgaben temporär an Teamleitung/Management übergeben oder neu verteilt werden sollen.",
        "",
        "Diese Nachricht wurde automatisch über das Teamboard verschickt."
    ].filter(Boolean).join("\n");
}

function buildEmptyChangesSince(previousLoginAt = null) {
    return {
        since: previousLoginAt || null,
        fallbackDays: 0,
        tasks: {
            new: 0,
            overdue: 0,
            items: []
        },
        forum: {
            new: 0
        },
        absences: {
            new: 0
        },
        total: 0
    };
}

function buildChangesSince(userId, sinceValue, loginRecapSettings = {}) {
    const recap = {
        ...getDefaultUserSettings().loginRecap,
        ...(loginRecapSettings || {})
    };

    if (recap.enabled === false) {
        return buildEmptyChangesSince(null);
    }

    const sinceMs = new Date(sinceValue || 0).getTime();

    // Kein vorheriger Login = keine Rückblick-Anzeige. Sonst würden alte Daten
    // fälschlich so wirken, als wären sie während der Abwesenheit passiert.
    if (!Number.isFinite(sinceMs) || sinceMs <= 0) {
        return buildEmptyChangesSince(null);
    }

    const tasks = readTasks().filter(task => !isArchivedTask(task));
    const forumPosts = readJsonFile(forumPostsFile, []);
    const absences = readAbsencesRawForManagement();
    const now = Date.now();

    const newTasks = recap.includeTasks
        ? tasks.filter(task => new Date(task.createdAt || 0).getTime() > sinceMs)
        : [];
    const overdueTasks = recap.includeOverdue
        ? tasks.filter(task => {
            if (!task.dueDate || normalizeTaskStatus(task.status) === "Erledigt") return false;

            const due = new Date(task.dueDate).getTime();

            return Number.isFinite(due) && due < now && due > sinceMs;
        })
        : [];
    const newForumPosts = recap.includeForum
        ? forumPosts.filter(post => new Date(post.createdAt || 0).getTime() > sinceMs)
        : [];
    const newAbsences = recap.includeAbsences
        ? absences.filter(absence => new Date(absence.createdAt || 0).getTime() > sinceMs && absence.status !== "Abgelehnt")
        : [];

    return {
        since: new Date(sinceMs).toISOString(),
        fallbackDays: 0,
        tasks: {
            new: newTasks.length,
            overdue: overdueTasks.length,
            items: newTasks.slice(0, 5).map(task => ({
                id: task.id,
                title: task.title,
                status: task.status,
                url: getDashboardTaskDetailUrl(task.id)
            }))
        },
        forum: {
            new: newForumPosts.length
        },
        absences: {
            new: newAbsences.length
        },
        total: newTasks.length + overdueTasks.length + newForumPosts.length + newAbsences.length
    };
}

function enrichAbsenceWithAccount(absence) {
    const migrated = migrateAbsence(absence);
    const person = getKnownPersonSummary(migrated.userId);

    return {
        ...migrated,
        account: {
            id: person.id,
            name: person.name,
            username: person.username,
            rank: person.rank,
            department: person.department,
            linked: Boolean(person.id && person.name && person.name !== "Unbekannt")
        }
    };
}

function readPersonRecords() {
    const records = readJsonFile(personRecordsFile, []);

    return Array.isArray(records)
        ? records.map(record => ({
            userId: String(record.userId || ""),
            person: record.person || getKnownPersonSummary(record.userId),
            entries: Array.isArray(record.entries) ? record.entries.map(entry => ({
                id: String(entry.id || crypto.randomUUID()),
                type: normalizePersonRecordType(entry.type),
                note: String(entry.note || ""),
                attachments: normalizeAttachmentList(entry.attachments, {
                    uploadedById: entry.createdById,
                    uploadedByName: entry.createdByName
                }),
                createdById: String(entry.createdById || ""),
                createdByName: String(entry.createdByName || "Unbekannt"),
                createdAt: entry.createdAt || new Date().toISOString(),
                updatedAt: entry.updatedAt || entry.createdAt || new Date().toISOString()
            })) : [],
            createdAt: record.createdAt || new Date().toISOString(),
            updatedAt: record.updatedAt || record.createdAt || new Date().toISOString()
        })).filter(record => record.userId)
        : [];
}

function writePersonRecords(records) {
    writeJsonFile(personRecordsFile, Array.isArray(records) ? records : []);
}

function getPersonRecord(userId) {
    const id = String(userId || "");
    const records = readPersonRecords();
    const existing = records.find(record => String(record.userId || "") === id);

    if (existing) {
        return {
            ...existing,
            person: getKnownPersonSummary(id),
            entries: [...existing.entries].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        };
    }

    return {
        userId: id,
        person: getKnownPersonSummary(id),
        entries: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

function upsertPersonRecord(record) {
    const records = readPersonRecords();
    const index = records.findIndex(item => String(item.userId || "") === String(record.userId || ""));
    const normalized = {
        ...record,
        person: getKnownPersonSummary(record.userId),
        updatedAt: new Date().toISOString()
    };

    if (index === -1) {
        records.push({
            ...normalized,
            createdAt: normalized.createdAt || new Date().toISOString()
        });
    } else {
        records[index] = {
            ...records[index],
            ...normalized
        };
    }

    writePersonRecords(records);
    return getPersonRecord(record.userId);
}

function getRequestUserName(req) {
    return String(req.session?.user?.globalName || req.session?.user?.username || req.session?.user?.id || "Unbekannt");
}

function isInhaberRole(roleName) {
    const cleanRole = String(roleName || "").trim().toLowerCase();
    return cleanRole === "inhaber" || cleanRole === "inhaber | 4life";
}

function hasInhaberPermission(roleNames = []) {
    return Array.isArray(roleNames) && roleNames.some(isInhaberRole);
}

async function requireInhaber(req, res, next) {
    const roles = await refreshSessionRoles(req);

    if (hasInhaberPermission(roles)) {
        req.session.roles = roles;
        return next();
    }

    if (req.path.startsWith("/api/")) {
        return res.status(403).json({ error: "Nur Inhaber dürfen diese Admin-Übersicht öffnen." });
    }

    return res.status(403).sendFile(path.join(viewsDir, "no-access.html"));
}

function readAuditLogs() {
    const logs = readJsonFile(auditLogsFile, []);
    return Array.isArray(logs) ? logs : [];
}

function writeAuditLogs(logs) {
    const safeLogs = Array.isArray(logs) ? logs.slice(-1000) : [];
    writeJsonFile(auditLogsFile, safeLogs);
}

function logAuditAction(req, action, moduleName, targetId = "", details = {}) {
    try {
        const logs = readAuditLogs();
        logs.push({
            id: crypto.randomUUID(),
            userId: String(req?.session?.user?.id || ""),
            userName: getRequestUserName(req),
            roles: Array.isArray(req?.session?.roles) ? req.session.roles : [],
            action: String(action || ""),
            module: String(moduleName || ""),
            targetId: String(targetId || ""),
            method: String(req?.method || ""),
            path: String(req?.originalUrl || req?.url || ""),
            statusCode: Number(req?.res?.statusCode || 0),
            details,
            createdAt: new Date().toISOString()
        });
        writeAuditLogs(logs);
    } catch (error) {
        console.error("Audit-Log konnte nicht geschrieben werden:", error);
    }
}

function auditWriteMiddleware(req, res, next) {
    if (!["POST", "PUT", "DELETE"].includes(String(req.method || "").toUpperCase())) {
        return next();
    }

    if (String(req.path || "").startsWith("/auth/")) {
        return next();
    }

    res.on("finish", () => {
        if (!req.session?.user) return;

        logAuditAction(
            req,
            `${req.method} ${req.path}`,
            String(req.path || "").split("/").filter(Boolean)[1] || "dashboard",
            req.params?.id || req.params?.commentId || req.params?.entryId || req.params?.postId || "",
            {
                statusCode: res.statusCode,
                ok: res.statusCode >= 200 && res.statusCode < 400
            }
        );
    });

    next();
}

function readDiagnosticLogs() {
    const logs = readJsonFile(diagnosticLogsFile, []);
    return Array.isArray(logs) ? logs : [];
}

function writeDiagnosticLogs(logs) {
    writeJsonFile(diagnosticLogsFile, Array.isArray(logs) ? logs.slice(-500) : []);
}

function getErrorStack(error) {
    return String(error?.stack || error?.message || error || "").slice(0, 8000);
}

function appendDiagnosticLog(entry = {}) {
    try {
        const logs = readDiagnosticLogs();
        logs.push({
            id: crypto.randomUUID(),
            type: String(entry.type || "server_error"),
            level: String(entry.level || "error"),
            message: String(entry.message || "").slice(0, 1200),
            route: String(entry.route || ""),
            method: String(entry.method || ""),
            statusCode: Number(entry.statusCode || 0),
            userId: String(entry.userId || ""),
            userName: String(entry.userName || ""),
            details: entry.details && typeof entry.details === "object" ? entry.details : {},
            stack: String(entry.stack || "").slice(0, 8000),
            createdAt: new Date().toISOString()
        });
        writeDiagnosticLogs(logs);
    } catch (error) {
        console.error("Diagnose-Log konnte nicht geschrieben werden:", error);
    }
}

function logRequestDiagnostic(req, res, message = "") {
    appendDiagnosticLog({
        type: "http_500",
        level: "error",
        message: message || `HTTP ${res.statusCode} bei ${req.method} ${req.originalUrl || req.url}`,
        route: req.originalUrl || req.url || "",
        method: req.method || "",
        statusCode: res.statusCode,
        userId: req.session?.user?.id || "",
        userName: getRequestUserName(req),
        details: {
            params: req.params || {},
            query: req.query || {}
        }
    });
}

function safeNumber(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number : 0;
}

function getFileSizeSafe(filePath) {
    try {
        return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    } catch (_) {
        return 0;
    }
}

function getDirectoryStats(dirPath) {
    const stats = {
        bytes: 0,
        files: 0,
        directories: 0,
        largestFiles: []
    };

    function walk(currentPath) {
        if (!fs.existsSync(currentPath)) return;

        const entries = fs.readdirSync(currentPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(currentPath, entry.name);

            if (entry.isDirectory()) {
                stats.directories += 1;
                walk(fullPath);
                continue;
            }

            if (!entry.isFile()) continue;

            const stat = fs.statSync(fullPath);
            stats.files += 1;
            stats.bytes += stat.size;
            stats.largestFiles.push({
                name: entry.name,
                path: path.relative(uploadsDir, fullPath).replace(/\\/g, "/"),
                bytes: stat.size,
                modifiedAt: stat.mtime.toISOString()
            });
        }
    }

    try {
        walk(dirPath);
    } catch (error) {
        console.error("Ordnerstatistik konnte nicht gelesen werden:", error);
    }

    stats.largestFiles = stats.largestFiles
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 20);

    return stats;
}


function normalizeTeamRoleValue(value) {
    return String(value || "")
        .normalize("NFKC")
        .replace(/[Ⅰ]/g, "I")
        .replace(/[Ⅱ]/g, "II")
        .replace(/\s+/g, "")
        .trim()
        .toLowerCase();
}

function hasNoTeamDepartment(member) {
    const department = normalizeTeamRoleValue(member?.department);
    const departments = Array.isArray(member?.departments) ? member.departments.filter(Boolean) : [];

    return departments.length === 0 ||
        !department ||
        department === "keineabteilung" ||
        department === "ohneabteilung" ||
        department === "keindepartment";
}

function getTeamWarningRoles(member) {
    return [
        ...(Array.isArray(member?.warns) ? member.warns : []),
        ...(Array.isArray(member?.warningRoles) ? member.warningRoles : []),
        ...(Array.isArray(member?.recognizedRoles) ? member.recognizedRoles : []),
        ...(Array.isArray(member?.roles) ? member.roles : []),
        ...(Array.isArray(member?.allRoles) ? member.allRoles : [])
    ].filter((role, index, list) => {
        const normalized = normalizeTeamRoleValue(role);
        return normalized.includes("teamwarn") && list.findIndex(item => normalizeTeamRoleValue(item) === normalized) === index;
    });
}

function getAllTeamRoles(member) {
    return [
        ...(Array.isArray(member?.allRoles) ? member.allRoles : []),
        ...(Array.isArray(member?.recognizedRoles) ? member.recognizedRoles : []),
        ...(Array.isArray(member?.ranks) ? member.ranks : []),
        ...(Array.isArray(member?.departments) ? member.departments : []),
        ...(Array.isArray(member?.warns) ? member.warns : [])
    ].filter((role, index, list) => {
        const normalized = normalizeTeamRoleValue(role);
        return normalized && list.findIndex(item => normalizeTeamRoleValue(item) === normalized) === index;
    });
}


function countBy(list, getter) {
    const counts = {};

    for (const item of Array.isArray(list) ? list : []) {
        const key = String(getter(item) || "Unbekannt");
        counts[key] = (counts[key] || 0) + 1;
    }

    return Object.entries(counts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function flattenAttachmentsFromValue(value, context = {}) {
    const result = [];

    function collect(item, parent = {}) {
        if (!item || typeof item !== "object") return;

        if (Array.isArray(item.attachments)) {
            for (const attachment of item.attachments) {
                result.push({
                    ...attachment,
                    context: {
                        ...context,
                        ...parent
                    }
                });
            }
        }
    }

    collect(value);
    return result;
}


function listUploadFilesDetailed() {
    const files = [];

    function walk(currentPath) {
        if (!fs.existsSync(currentPath)) return;

        for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
            const fullPath = path.join(currentPath, entry.name);

            if (entry.isDirectory()) {
                walk(fullPath);
                continue;
            }

            if (!entry.isFile()) continue;

            const stat = fs.statSync(fullPath);
            const relativePath = path.relative(uploadsDir, fullPath).replace(/\\/g, "/");

            files.push({
                name: entry.name,
                path: relativePath,
                fullPath,
                bytes: stat.size,
                modifiedAt: stat.mtime.toISOString()
            });
        }
    }

    try {
        walk(uploadsDir);
    } catch (error) {
        console.error("Upload-Dateien konnten nicht aufgelistet werden:", error);
    }

    return files;
}

function getKnownUploadFilePathsFromAttachments() {
    const known = new Set();

    function addFromAttachment(attachment) {
        const url = String(attachment?.url || "");
        const fileName = String(attachment?.fileName || "");

        if (url.includes("/uploads/")) {
            const afterUploads = url.split("/uploads/").pop();
            if (afterUploads) known.add(decodeURIComponent(afterUploads).replace(/^\/+/, ""));
        }

        if (url.includes("/api/archive/entries/") && fileName) {
            const entryMatch = url.match(/\/api\/archive\/entries\/([^/]+)\/files\//);
            if (entryMatch?.[1]) known.add(`archive/${decodeURIComponent(entryMatch[1])}/${fileName}`);
        }

        if (url.includes("/api/person-records/") && fileName) {
            const match = url.match(/\/api\/person-records\/([^/]+)\/entries\/([^/]+)\/files\//);
            if (match?.[1] && match?.[2]) {
                const ownerId = getPersonRecordUploadOwnerId(decodeURIComponent(match[1]), decodeURIComponent(match[2]));
                known.add(`person-records/${ownerId}/${fileName}`);
            }
        }
    }

    const tasks = readTasks();
    const personRecords = readPersonRecords();
    const forumPosts = readForumPosts();
    const archiveEntries = readArchiveEntriesRaw();
    const clips = readClipEntries();
    const liveMessages = readLiveChatMessages();

    for (const task of tasks) {
        for (const comment of Array.isArray(task.comments) ? task.comments : []) {
            for (const attachment of Array.isArray(comment.attachments) ? comment.attachments : []) addFromAttachment(attachment);
        }
    }

    for (const record of personRecords) {
        for (const entry of Array.isArray(record.entries) ? record.entries : []) {
            for (const attachment of Array.isArray(entry.attachments) ? entry.attachments : []) addFromAttachment(attachment);
        }
    }

    for (const collection of [forumPosts, archiveEntries, clips, liveMessages]) {
        for (const item of collection) {
            for (const attachment of Array.isArray(item.attachments) ? item.attachments : []) addFromAttachment(attachment);
        }
    }

    return known;
}

function findOrphanUploads(limit = 100) {
    const knownPaths = getKnownUploadFilePathsFromAttachments();
    const allFiles = listUploadFilesDetailed();

    return allFiles
        .filter(file => !knownPaths.has(file.path))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, limit)
        .map(file => ({
            path: file.path,
            bytes: file.bytes,
            modifiedAt: file.modifiedAt
        }));
}

function cleanupOrphanUploads(limit = 100) {
    const orphans = findOrphanUploads(limit);
    let deletedBytes = 0;
    let deletedFiles = 0;

    for (const orphan of orphans) {
        const fullPath = path.join(uploadsDir, orphan.path);

        if (!fullPath.startsWith(uploadsDir)) continue;

        try {
            const bytes = getFileSizeSafe(fullPath);
            fs.unlinkSync(fullPath);
            deletedFiles += 1;
            deletedBytes += bytes;
        } catch (error) {
            console.error("Verwaiste Datei konnte nicht gelöscht werden:", orphan.path, error);
        }
    }

    return {
        deletedFiles,
        deletedBytes,
        candidates: orphans.length
    };
}



function buildQuietHoursAdminOverview(team = [], users = []) {
    const userMap = new Map((Array.isArray(users) ? users : []).map(user => [String(user.id || ""), user]));
    const teamIds = new Set((Array.isArray(team) ? team : []).map(member => String(member.id || "")));
    const members = [];

    const addMember = (id, data = {}, user = null, source = "team") => {
        if (!id) return;

        const settings = normalizeUserSettings(user?.settings || {});
        const quietHours = settings.quietHours || getDefaultUserSettings().quietHours;
        const quietMinutes = getQuietHoursDurationMinutes(quietHours);
        const reachableMinutes = getReachableMinutesForQuietHours(quietHours);

        members.push({
            id,
            name: data.name || data.username || user?.globalName || user?.username || id,
            username: user?.username || data.username || "",
            rank: data.rank || (source === "team" ? "Ohne Rang" : "Kein aktuelles Teammitglied"),
            department: data.department || (source === "team" ? "Keine Abteilung" : "Nicht im Teamcache"),
            known: Boolean(user),
            source,
            quietHours,
            quietMinutes,
            reachableMinutes,
            lastLoginAt: user?.lastLoginAt || null
        });
    };

    for (const member of Array.isArray(team) ? team : []) {
        const id = String(member.id || "");

        addMember(id, member, userMap.get(id) || null, "team");
    }

    for (const user of Array.isArray(users) ? users : []) {
        const id = String(user.id || "");

        if (!id || teamIds.has(id)) continue;

        addMember(id, {
            name: user.globalName || user.username || id,
            username: user.username || ""
        }, user, "known-user");
    }

    members.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "de", { sensitivity: "base" }));

    return {
        members: members.slice(0, 500),
        enabled: members.filter(member => member.quietHours?.enabled).length,
        disabled: members.filter(member => !member.quietHours?.enabled).length
    };
}

function setAdminQuietHoursForUser(userId, quietHours, meta = {}) {
    const id = String(userId || "").trim();

    if (!id) {
        return {
            ok: false,
            status: 400,
            error: "Kein Nutzer ausgewählt."
        };
    }

    const validation = validateQuietHoursSettings(quietHours || {});

    if (!validation.ok) {
        return {
            ok: false,
            status: 400,
            error: validation.error,
            quietMinutes: validation.quietMinutes,
            reachableMinutes: validation.reachableMinutes
        };
    }

    const users = readJsonFile(usersFile, []);
    const index = users.findIndex(user => String(user.id || "") === id);
    const now = new Date().toISOString();
    const existing = index === -1 ? {} : users[index];
    const currentSettings = normalizeUserSettings(existing.settings || {});
    const settings = normalizeUserSettings({
        ...currentSettings,
        quietHours: validation.quietHours,
        loginRecap: currentSettings.loginRecap,
        appearance: currentSettings.appearance
    });
    const row = {
        ...existing,
        id,
        username: existing.username || meta.username || meta.name || "",
        globalName: existing.globalName || meta.name || meta.username || id,
        avatar: existing.avatar || "",
        roles: Array.isArray(existing.roles) ? existing.roles : [],
        settings,
        updatedAt: now,
        quietHoursUpdatedAt: now,
        quietHoursUpdatedBy: meta.updatedBy || null
    };

    if (index === -1) {
        users.push({
            ...row,
            firstLoginAt: null,
            lastLoginAt: null,
            lastSeenAt: null
        });
    } else {
        users[index] = row;
    }

    users.sort((a, b) => String(a.globalName || a.username || "").localeCompare(String(b.globalName || b.username || ""), "de", { sensitivity: "base" }));
    writeJsonFile(usersFile, users);

    return {
        ok: true,
        user: {
            id,
            name: row.globalName || row.username || id
        },
        settings,
        quietMinutes: getQuietHoursDurationMinutes(settings.quietHours),
        reachableMinutes: getReachableMinutesForQuietHours(settings.quietHours)
    };
}


function buildOnboardingAdminOverview(team = [], users = []) {
    const userMap = new Map((Array.isArray(users) ? users : []).map(user => [String(user.id || ""), user]));
    const teamIds = new Set((Array.isArray(team) ? team : []).map(member => String(member.id || "")));
    const members = [];

    for (const member of Array.isArray(team) ? team : []) {
        const id = String(member.id || "");
        const user = userMap.get(id) || null;

        members.push({
            id,
            name: member.name || member.username || user?.globalName || user?.username || id,
            username: user?.username || member.username || "",
            rank: member.rank || "Ohne Rang",
            department: member.department || "Keine Abteilung",
            known: Boolean(user),
            onboardingSeenAt: user?.onboardingSeenAt || null,
            onboardingVersion: user?.onboardingVersion || "",
            needsOnboarding: !user || !user.onboardingSeenAt,
            lastLoginAt: user?.lastLoginAt || null
        });
    }

    for (const user of Array.isArray(users) ? users : []) {
        const id = String(user.id || "");

        if (!id || teamIds.has(id)) continue;

        members.push({
            id,
            name: user.globalName || user.username || id,
            username: user.username || "",
            rank: "Kein aktuelles Teammitglied",
            department: "Nicht im Teamcache",
            known: true,
            onboardingSeenAt: user.onboardingSeenAt || null,
            onboardingVersion: user.onboardingVersion || "",
            needsOnboarding: !user.onboardingSeenAt,
            lastLoginAt: user.lastLoginAt || null
        });
    }

    members.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "de", { sensitivity: "base" }));

    const resettable = members.filter(member => member.known);

    return {
        totalKnown: resettable.length,
        seen: resettable.filter(member => member.onboardingSeenAt).length,
        needsOnboarding: resettable.filter(member => !member.onboardingSeenAt).length,
        members: members.slice(0, 500)
    };
}

function resetOnboardingForUserIds(userIds = []) {
    const ids = new Set((Array.isArray(userIds) ? userIds : []).map(id => String(id || "")).filter(Boolean));
    const users = readJsonFile(usersFile, []);
    const now = new Date().toISOString();
    const changed = [];
    const skipped = [];

    for (const user of users) {
        const id = String(user.id || "");

        if (!ids.has(id)) continue;

        user.onboardingSeenAt = null;
        user.onboardingVersion = "";
        user.onboardingResetAt = now;
        changed.push({
            id,
            name: user.globalName || user.username || id
        });
    }

    for (const id of ids) {
        if (!changed.some(user => String(user.id) === id)) {
            skipped.push(id);
        }
    }

    writeJsonFile(usersFile, users);

    return {
        changed,
        skipped,
        total: changed.length
    };
}

function resetOnboardingForAllKnownUsers() {
    const users = readJsonFile(usersFile, []);
    const now = new Date().toISOString();
    const changed = [];

    for (const user of users) {
        if (!user?.id) continue;

        user.onboardingSeenAt = null;
        user.onboardingVersion = "";
        user.onboardingResetAt = now;
        changed.push({
            id: user.id,
            name: user.globalName || user.username || user.id
        });
    }

    writeJsonFile(usersFile, users);

    return {
        changed,
        total: changed.length
    };
}


function buildAdminActionList() {
    return [
        {
            id: "refresh",
            label: "Dashboard aktualisieren",
            description: "Lädt alle Admin-Daten neu.",
            danger: false,
            clientOnly: true
        },
        {
            id: "backup-db",
            label: "Datenbank-Backup",
            description: "Erstellt eine Kopie der SQLite-Datenbank im backups-Ordner.",
            danger: false
        },
        {
            id: "recalculate-storage",
            label: "Speicher neu berechnen",
            description: "Scant Upload-Ordner und Dateigrößen neu.",
            danger: false
        },
        {
            id: "scan-orphans",
            label: "Verwaiste Dateien suchen",
            description: "Findet Upload-Dateien ohne Datenbankbezug.",
            danger: false
        },
        {
            id: "cleanup-orphans",
            label: "Verwaiste Dateien löschen",
            description: "Löscht maximal 100 verwaiste Upload-Dateien.",
            danger: true
        },
        {
            id: "clear-audit",
            label: "Audit-Log leeren",
            description: "Leert das Audit-Log und schreibt danach einen neuen Eintrag.",
            danger: true
        },
        {
            id: "reset-voice",
            label: "Voice-Zeiten zurücksetzen",
            description: "Setzt alle bisher getrackten Voice-Zeiten zurück.",
            danger: true
        },
        {
            id: "system-check",
            label: "System prüfen",
            description: "Prüft Config, Bot, Guild, DB, Uploads, Channel und Discord-Audit-Recht.",
            danger: false
        },
        {
            id: "export-report",
            label: "Admin-Report exportieren",
            description: "Exportiert den aktuellen Admin-Snapshot als JSON.",
            danger: false,
            downloadUrl: `${BASE_PATH}/api/admin/report`
        }
    ];
}

function getDashboardHealth(summary) {
    const issues = [];

    if (summary.tasks.overdue > 0) issues.push({ level: "warning", text: `${summary.tasks.overdue} überfällige Aufgabe(n)` });
    if (summary.tasks.noAssignees > 0) issues.push({ level: "warning", text: `${summary.tasks.noAssignees} Aufgabe(n) ohne Zuständige` });
    if (summary.absences.unclear > 0) issues.push({ level: "warning", text: `${summary.absences.unclear} unklare Abmeldung(en)` });
    if (!summary.voice.updatedAt) issues.push({ level: "info", text: "Voice-Tracking hat noch keine historischen Daten" });
    if (summary.system.uploads.bytes > 50 * 1024 * 1024 * 1024) issues.push({ level: "warning", text: "Upload-Speicher über 50 GB" });
    if (summary.system.botStatus?.error) issues.push({ level: "danger", text: summary.system.botStatus.error });

    return {
        ok: issues.filter(issue => issue.level === "danger").length === 0,
        issues
    };
}

function readVoiceActivity() {
    const data = readJsonFile(voiceActivityFile, { users: {}, updatedAt: null });
    return data && typeof data === "object" ? data : { users: {}, updatedAt: null };
}

function writeVoiceActivity(data) {
    writeJsonFile(voiceActivityFile, {
        users: data?.users || {},
        updatedAt: new Date().toISOString()
    });
}

function parseVoiceDeltaMs(body = {}) {
    const rawMs = Number(body.ms || 0);
    const hours = Number(body.hours || 0);
    const minutes = Number(body.minutes || 0);
    const seconds = Number(body.seconds || 0);

    const total = rawMs + (hours * 60 * 60 * 1000) + (minutes * 60 * 1000) + (seconds * 1000);

    return Number.isFinite(total) ? Math.round(total) : 0;
}

function normalizeVoiceUserRecord(userId, current = {}, fallback = {}) {
    return {
        userId: String(userId || current.userId || ""),
        userName: String(current.userName || fallback.userName || fallback.name || userId || "Unbekannt"),
        totalMs: Math.max(0, Number(current.totalMs || 0)),
        sessions: Math.max(0, Number(current.sessions || 0)),
        active: current.active || null,
        lastJoinedAt: current.lastJoinedAt || null,
        lastLeftAt: current.lastLeftAt || null,
        sessionHistory: Array.isArray(current.sessionHistory) ? current.sessionHistory.slice(-500) : [],
        manualAdjustments: Array.isArray(current.manualAdjustments) ? current.manualAdjustments : []
    };
}


function readDiscordOverview() {
    const data = readJsonFile(discordOverviewFile, {
        guildId: CONFIG.guildId,
        guildName: "",
        roles: [],
        channels: [],
        channelTypeCounts: {},
        memberStats: {},
        updatedAt: null,
        error: ""
    });

    return data && typeof data === "object" ? data : {
        guildId: CONFIG.guildId,
        guildName: "",
        roles: [],
        channels: [],
        channelTypeCounts: {},
        memberStats: {},
        updatedAt: null,
        error: ""
    };
}

function readDiscordAuditLogs() {
    const data = readJsonFile(discordAuditLogsFile, {
        entries: [],
        updatedAt: null,
        error: ""
    });

    return data && typeof data === "object" ? data : {
        entries: [],
        updatedAt: null,
        error: ""
    };
}


function readBotStatus() {
    const data = readJsonFile(botStatusFile, {});
    return data && typeof data === "object" ? data : {};
}

function decorateBotStatus(botStatus = {}) {
    const status = botStatus && typeof botStatus === "object" ? { ...botStatus } : {};
    const updatedTime = status.updatedAt ? new Date(status.updatedAt).getTime() : 0;
    const ageMs = updatedTime ? Date.now() - updatedTime : null;

    status.ageMs = ageMs;
    status.stale = ageMs === null || ageMs > 2 * 60 * 1000;

    if (status.stale && status.online) {
        status.online = false;
        status.error = status.error || "Bot-Status ist veraltet. Prüfe, ob der Discord-Bot-Prozess läuft.";
    }

    return status;
}



function getVoiceRangeBounds(range = "all", nowDate = new Date()) {
    const cleanRange = String(range || "all").toLowerCase();
    const now = nowDate instanceof Date ? nowDate : new Date();

    if (cleanRange === "week") {
        const start = new Date(now);
        const day = start.getDay() || 7;
        start.setDate(start.getDate() - day + 1);
        start.setHours(0, 0, 0, 0);

        return {
            key: "week",
            label: "Diese Woche",
            startMs: start.getTime(),
            endMs: now.getTime()
        };
    }

    if (cleanRange === "month") {
        const start = new Date(now);
        start.setDate(start.getDate() - 30);
        start.setHours(0, 0, 0, 0);

        return {
            key: "month",
            label: "Letzter Monat",
            startMs: start.getTime(),
            endMs: now.getTime()
        };
    }

    return {
        key: "all",
        label: "Gesamt",
        startMs: null,
        endMs: now.getTime()
    };
}

function getOverlapMs(startValue, endValue, rangeStartMs, rangeEndMs) {
    const start = new Date(startValue || 0).getTime();
    const end = new Date(endValue || 0).getTime();

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;

    const clippedStart = Number.isFinite(rangeStartMs) ? Math.max(start, rangeStartMs) : start;
    const clippedEnd = Number.isFinite(rangeEndMs) ? Math.min(end, rangeEndMs) : end;

    return Math.max(0, clippedEnd - clippedStart);
}

function getManualAdjustmentDelta(entry = {}) {
    const mode = String(entry.mode || "").toLowerCase();
    const deltaMs = safeNumber(entry.deltaMs);

    if (mode === "subtract") return -deltaMs;
    if (mode === "set") return safeNumber(entry.afterMs) - safeNumber(entry.beforeMs);

    return deltaMs;
}

function getVoiceMsForRange(user = {}, rangeInfo = getVoiceRangeBounds("all")) {
    if (rangeInfo.key === "all") {
        const activeStartedAt = user.active?.joinedAt ? new Date(user.active.joinedAt).getTime() : 0;
        const activeMs = activeStartedAt ? Math.max(0, Date.now() - activeStartedAt) : 0;

        return Math.max(0, safeNumber(user.totalMs) + activeMs);
    }

    const sessionMs = (Array.isArray(user.sessionHistory) ? user.sessionHistory : [])
        .reduce((sum, session) => sum + getOverlapMs(session.joinedAt, session.leftAt, rangeInfo.startMs, rangeInfo.endMs), 0);

    const activeMs = user.active?.joinedAt
        ? getOverlapMs(user.active.joinedAt, new Date().toISOString(), rangeInfo.startMs, rangeInfo.endMs)
        : 0;

    const manualMs = (Array.isArray(user.manualAdjustments) ? user.manualAdjustments : [])
        .filter(entry => {
            const created = new Date(entry.createdAt || 0).getTime();

            if (!Number.isFinite(created)) return false;
            if (Number.isFinite(rangeInfo.startMs) && created < rangeInfo.startMs) return false;
            if (Number.isFinite(rangeInfo.endMs) && created > rangeInfo.endMs) return false;

            return true;
        })
        .reduce((sum, entry) => sum + getManualAdjustmentDelta(entry), 0);

    return Math.max(0, sessionMs + activeMs + manualMs);
}

function absenceOverlapsRange(absence = {}, rangeInfo = getVoiceRangeBounds("week")) {
    if (String(absence.status || "") !== "Aktiv") return false;

    const start = new Date(absence.startAt || absence.createdAt || 0).getTime();
    const end = absence.endAt ? new Date(absence.endAt).getTime() : rangeInfo.endMs;

    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;

    return getOverlapMs(start, end, rangeInfo.startMs, rangeInfo.endMs) > 0;
}

function buildVoiceAdminRows() {
    const voice = readVoiceActivity();
    const team = readJsonFile(teamFile, []);
    const absences = readAbsencesRawForManagement();
    const ranges = {
        week: getVoiceRangeBounds("week"),
        month: getVoiceRangeBounds("month"),
        all: getVoiceRangeBounds("all")
    };

    const voiceUsers = Object.values(voice.users || {}).map(user => {
        const rawAdjustments = Array.isArray(user.manualAdjustments) ? user.manualAdjustments : [];
        const weekMs = getVoiceMsForRange(user, ranges.week);
        const monthMs = getVoiceMsForRange(user, ranges.month);
        const allMs = getVoiceMsForRange(user, ranges.all);
        const approvedAbsenceThisWeek = absences.some(absence =>
            String(absence.userId || "") === String(user.userId || "") &&
            absenceOverlapsRange(absence, ranges.week)
        );

        return {
            userId: String(user.userId || ""),
            userName: String(user.userName || user.username || user.userId || "Unbekannt"),
            totalMs: allMs,
            allMs,
            weekMs,
            monthMs,
            requiredWeeklyMs: VOICE_MINIMUM_WEEKLY_MS,
            approvedAbsenceThisWeek,
            underWeeklyMinimum: !approvedAbsenceThisWeek && weekMs < VOICE_MINIMUM_WEEKLY_MS,
            sessions: safeNumber(user.sessions),
            active: Boolean(user.active),
            activeChannelName: user.active?.channelName || "",
            lastJoinedAt: user.lastJoinedAt || null,
            lastLeftAt: user.lastLeftAt || null,
            sessionHistory: Array.isArray(user.sessionHistory) ? user.sessionHistory.slice(-100).reverse() : [],
            manualAdjustments: rawAdjustments.slice(-50).reverse()
        };
    }).sort((a, b) => b.allMs - a.allMs);

    const teamIds = new Set(team.map(member => String(member.id || "")));
    const voiceById = new Map(voiceUsers.map(user => [String(user.userId), user]));
    const voiceTeamUsers = voiceUsers.filter(user => teamIds.has(String(user.userId)));
    const teamWithoutVoice = team
        .filter(member => !voiceById.has(String(member.id || "")))
        .map(member => {
            const approvedAbsenceThisWeek = absences.some(absence =>
                String(absence.userId || "") === String(member.id || "") &&
                absenceOverlapsRange(absence, ranges.week)
            );

            return {
                id: member.id,
                userId: member.id,
                name: member.name || member.username || member.id,
                userName: member.name || member.username || member.id,
                rank: member.rank || "",
                department: member.department || "",
                totalMs: 0,
                allMs: 0,
                weekMs: 0,
                monthMs: 0,
                requiredWeeklyMs: VOICE_MINIMUM_WEEKLY_MS,
                approvedAbsenceThisWeek,
                underWeeklyMinimum: !approvedAbsenceThisWeek,
                manualAdjustments: []
            };
        });

    return {
        updatedAt: voice.updatedAt || null,
        ranges,
        weeklyMinimumMs: VOICE_MINIMUM_WEEKLY_MS,
        allUsers: voiceUsers,
        teamUsers: voiceTeamUsers,
        teamWithoutVoice,
        activeNow: voiceUsers.filter(user => user.active),
        underMinimum: [...voiceTeamUsers, ...teamWithoutVoice].filter(user => user.underWeeklyMinimum)
    };
}

function buildPermissionSummary() {
    return {
        admin: {
            label: "Admin sehen",
            roles: ["Inhaber", "Inhaber | 4Life"],
            note: "Nur echter Inhaber. stv. Inhaber zählt hier bewusst nicht."
        },
        absences: {
            label: "Abmeldungen verwalten",
            roles: [...ABSENCE_MANAGEMENT_ROLE_NAMES],
            note: "Zusätzlich greifen die bestehenden Management-Rollenchecks."
        },
        records: {
            label: "Team-Akten sehen/bearbeiten",
            roles: [...ABSENCE_MANAGEMENT_ROLE_NAMES],
            note: "Normale Nutzer sehen keine fremden Team-Akten."
        },
        tasksGlobal: {
            label: "Aufgaben global bearbeiten",
            roles: ["Inhaber", "Inhaber | 4Life"],
            note: "Ersteller und Zuständige behalten ihre eigenen Aufgabenrechte."
        },
        forum: {
            label: "Forum bearbeiten",
            roles: [...ABSENCE_MANAGEMENT_ROLE_NAMES],
            note: "Lesen dürfen Teamboard-Nutzer, bearbeiten nur berechtigte Rollen."
        }
    };
}

function buildAdminNotifications(summaryParts = {}) {
    const notifications = [];
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    const absences = Array.isArray(summaryParts.absences) ? summaryParts.absences : [];
    const tasks = Array.isArray(summaryParts.tasks) ? summaryParts.tasks : [];
    const personRecords = Array.isArray(summaryParts.personRecords) ? summaryParts.personRecords : [];
    const botStatus = summaryParts.botStatus || {};
    const voiceAdmin = summaryParts.voiceAdmin || { underMinimum: [] };
    const auditLogs = Array.isArray(summaryParts.auditLogs) ? summaryParts.auditLogs : [];

    const pendingAbsences = absences.filter(absence =>
        absence.status === "Beantragt" || absence.parseStatus === "pending_review" ||
        absence.status === "Unklar" || absence.parseStatus === "needs_review"
    );
    if (pendingAbsences.length) {
        notifications.push({
            type: "absence_pending",
            level: "warning",
            title: "Neue Abmeldung wartet",
            text: `${pendingAbsences.length} Abmeldung(en) müssen geprüft werden.`,
            count: pendingAbsences.length,
            targetTab: "absences"
        });
    }

    const underMinimum = Array.isArray(voiceAdmin.underMinimum) ? voiceAdmin.underMinimum : [];
    if (underMinimum.length) {
        notifications.push({
            type: "voice_minimum",
            level: "warning",
            title: "Teamler unter Mindestzeit",
            text: `${underMinimum.length} Teammitglied(er) liegen diese Woche unter 2 Stunden und sind nicht abgemeldet.`,
            count: underMinimum.length,
            targetTab: "voice"
        });
    }

    if (botStatus.error || botStatus.stale || botStatus.online === false) {
        notifications.push({
            type: "bot_error",
            level: "danger",
            title: "Botfehler",
            text: botStatus.error || "Bot ist offline oder Status ist veraltet.",
            count: 1,
            targetTab: "diagnostics"
        });
    }

    const overdueTasks = tasks.filter(task => {
        if (!task.dueDate || ["Erledigt", "Archiviert"].includes(task.status)) return false;
        const time = new Date(task.dueDate).getTime();
        return Number.isFinite(time) && time < now;
    });
    if (overdueTasks.length) {
        notifications.push({
            type: "task_overdue",
            level: "danger",
            title: "Aufgabe überfällig",
            text: `${overdueTasks.length} Aufgabe(n) sind überfällig.`,
            count: overdueTasks.length,
            targetTab: "tasks"
        });
    }

    const latestRecordEntries = personRecords.flatMap(record =>
        (Array.isArray(record.entries) ? record.entries : []).map(entry => ({
            ...entry,
            personName: record.person?.name || record.userId
        }))
    ).filter(entry => {
        const created = new Date(entry.createdAt || 0).getTime();
        return Number.isFinite(created) && now - created <= oneDayMs;
    });
    if (latestRecordEntries.length) {
        notifications.push({
            type: "record_new",
            level: "info",
            title: "Neuer Akteneintrag",
            text: `${latestRecordEntries.length} neue(r) Akteneintrag/Einträge in den letzten 24 Stunden.`,
            count: latestRecordEntries.length,
            targetTab: "records"
        });
    }

    const auditWarnings = auditLogs.filter(log => Number(log.statusCode || log.details?.statusCode || 0) >= 400);
    if (auditWarnings.length) {
        notifications.push({
            type: "audit_warning",
            level: "warning",
            title: "Audit-Warnung",
            text: `${auditWarnings.length} Audit-Eintrag/Einträge mit Status 400 oder höher.`,
            count: auditWarnings.length,
            targetTab: "audit"
        });
    }

    return notifications;
}

function isDateRecent(value, maxAgeMs) {
    const time = value ? new Date(value).getTime() : 0;
    return Number.isFinite(time) && Date.now() - time <= maxAgeMs;
}

function runSystemCheck() {
    const botStatus = decorateBotStatus(readBotStatus());
    const discordOverview = readDiscordOverview();
    const discordAuditLogs = readDiscordAuditLogs();
    const team = readJsonFile(teamFile, []);
    const checks = [];

    function add(id, label, ok, details = "", level = null) {
        checks.push({
            id,
            label,
            ok: Boolean(ok),
            level: level || (ok ? "success" : "danger"),
            details: String(details || "")
        });
    }

    add("config", "config vorhanden", fs.existsSync(configFile), fs.existsSync(configFile) ? "config.json gefunden." : "config.json fehlt oder ENV wird benötigt.");
    add("bot_online", "Bot online", Boolean(botStatus.online && !botStatus.stale), botStatus.error || (botStatus.online ? "Bot meldet online." : "Bot ist offline/veraltet."));
    add("guild", "Guild erreichbar", Boolean(discordOverview.guildId || discordOverview.guildName), discordOverview.guildName || discordOverview.error || "Keine Guild-Daten vorhanden.");
    const teamCacheOk = Array.isArray(team) && team.length > 0;
    add(
        "team_recent",
        "Teamdaten aktuell",
        teamCacheOk,
        teamCacheOk
            ? `${team.length} Teammitglied(er) im Teamcache.`
            : "Keine Teammitglieder im Teamcache. Bitte Discord-Teamdaten neu scannen/refreshen."
    );

    try {
        const dbDir = path.dirname(getDatabasePath());
        ensureDirectory(dbDir);
        const tmp = path.join(dbDir, `.teamsync-write-test-${process.pid}.tmp`);
        fs.writeFileSync(tmp, "ok");
        fs.unlinkSync(tmp);
        add("db_write", "DB beschreibbar", true, "Datenbankordner ist beschreibbar.");
    } catch (error) {
        add("db_write", "DB beschreibbar", false, error.message);
    }

    try {
        ensureDirectory(uploadsDir);
        const tmp = path.join(uploadsDir, `.teamsync-upload-test-${process.pid}.tmp`);
        fs.writeFileSync(tmp, "ok");
        fs.unlinkSync(tmp);
        add("uploads_write", "Uploads beschreibbar", true, "Upload-Ordner ist beschreibbar.");
    } catch (error) {
        add("uploads_write", "Uploads beschreibbar", false, error.message);
    }

    add("discord_audit", "Discord Audit-Recht vorhanden", !discordAuditLogs.error, discordAuditLogs.error || "Kein Discord-Audit-Fehler gespeichert.");

    const channels = Array.isArray(discordOverview.channels) ? discordOverview.channels : [];
    const channelIds = new Set(channels.map(channel => String(channel.id || "")));
    add("absence_channel", "Abmeldungs-Channel erreichbar", Boolean(CONFIG.absenceChannelId && channelIds.has(String(CONFIG.absenceChannelId))), CONFIG.absenceChannelId ? `Channel-ID: ${CONFIG.absenceChannelId}` : "absenceChannelId fehlt.");
    add("task_channel", "Task-Channel erreichbar", Boolean(CONFIG.taskNotifyChannelId && channelIds.has(String(CONFIG.taskNotifyChannelId))), CONFIG.taskNotifyChannelId ? `Channel-ID: ${CONFIG.taskNotifyChannelId}` : "taskNotifyChannelId fehlt.");

    return {
        ok: checks.every(check => check.ok),
        generatedAt: new Date().toISOString(),
        checks
    };
}

function buildAdminSummary(req) {
    const team = readJsonFile(teamFile, []);
    const tasks = readTasks();
    const absences = readAbsencesRawForManagement();
    const personRecords = readPersonRecords();
    const forumPosts = readForumPosts();
    const archiveEntries = readArchiveEntriesRaw();
    const clips = readClipEntries();
    const liveMessages = readLiveChatMessages();
    const auditLogs = readAuditLogs().slice(-150).reverse();
    const users = readJsonFile(usersFile, []);
    const voice = readVoiceActivity();
    const voiceAdmin = buildVoiceAdminRows();
    const voiceUsers = voiceAdmin.allUsers;
    const voiceTeamUsers = voiceAdmin.teamUsers;
    const teamWithoutVoice = voiceAdmin.teamWithoutVoice;
    const botStatus = decorateBotStatus(readBotStatus());
    const discordOverview = readDiscordOverview();
    const discordAuditLogs = readDiscordAuditLogs();
    const diagnosticLogs = readDiagnosticLogs().slice(-150).reverse();

    const uploadStats = getDirectoryStats(uploadsDir);
    const orphanUploads = findOrphanUploads(50);
    const dbPath = getDatabasePath();
    const memory = process.memoryUsage();

    const now = Date.now();
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const endOfToday = startOfToday + 24 * 60 * 60 * 1000;
    const endOfWeek = now + 7 * 24 * 60 * 60 * 1000;

    const taskStatusCounts = countBy(tasks, task => task.status || "Offen");
    const taskDepartmentCounts = countBy(tasks, task => task.department || "Allgemein");
    const overdueTasks = tasks.filter(task => {
        if (!task.dueDate || ["Erledigt", "Archiviert"].includes(task.status)) return false;
        const time = new Date(task.dueDate).getTime();
        return Number.isFinite(time) && time < now;
    });
    const dueTodayTasks = tasks.filter(task => {
        if (!task.dueDate || ["Erledigt", "Archiviert"].includes(task.status)) return false;
        const time = new Date(task.dueDate).getTime();
        return Number.isFinite(time) && time >= startOfToday && time < endOfToday;
    });
    const tasksWithoutAssignees = tasks.filter(task =>
        !(Array.isArray(task.assignees) && task.assignees.length) &&
        !(Array.isArray(task.manualAssignees) && task.manualAssignees.length)
    );

    const allPersonEntries = personRecords.flatMap(record =>
        (Array.isArray(record.entries) ? record.entries : []).map(entry => ({
            ...entry,
            personName: record.person?.name || record.userId,
            userId: record.userId
        }))
    );

    const goodEntries = allPersonEntries.filter(entry => String(entry.type || "").toLowerCase().includes("gut"));
    const badEntries = allPersonEntries.filter(entry => String(entry.type || "").toLowerCase().includes("schlecht"));

    const contentAttachments = [
        ...forumPosts.flatMap(post => flattenAttachmentsFromValue(post, { module: "Forum", title: post.title, owner: post.createdByName })),
        ...archiveEntries.flatMap(entry => flattenAttachmentsFromValue(entry, { module: "Aktenarchiv", title: entry.title, owner: entry.createdByName })),
        ...clips.flatMap(clip => flattenAttachmentsFromValue(clip, { module: "Clips/Beweise", title: clip.description || "Clip/Beweis", owner: clip.createdByName })),
        ...liveMessages.flatMap(message => flattenAttachmentsFromValue(message, { module: "Livechat", title: message.message || "Nachricht", owner: message.userName })),
        ...tasks.flatMap(task => (Array.isArray(task.comments) ? task.comments : []).flatMap(comment => flattenAttachmentsFromValue(comment, { module: "Aufgabenchat", title: task.title, owner: comment.userName }))),
        ...personRecords.flatMap(record => (Array.isArray(record.entries) ? record.entries : []).flatMap(entry => flattenAttachmentsFromValue(entry, { module: "Team-Akte", title: record.person?.name || record.userId, owner: entry.createdByName })))
    ];
    const contentAttachmentBytes = contentAttachments.reduce((sum, attachment) => sum + safeNumber(attachment.size), 0);

    const teamById = new Map(team.map(member => [String(member.id || ""), member]));
    const loggedInMembers = (Array.isArray(users) ? users : [])
        .filter(user => teamById.has(String(user.id || "")))
        .map(user => {
            const member = teamById.get(String(user.id || ""));

            return {
                id: user.id,
                name: member?.name || user.globalName || user.username || user.id,
                username: user.username || "",
                rank: member?.rank || "Ohne Rang",
                department: member?.department || "Keine Abteilung",
                lastLoginAt: user.lastLoginAt || null
            };
        })
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "de", { sensitivity: "base" }));

    const loggedInIds = new Set(loggedInMembers.map(member => String(member.id || "")));
    const notLoggedInMembers = team
        .filter(member => !loggedInIds.has(String(member.id || "")))
        .map(member => ({
            id: member.id,
            name: member.name || member.username || member.id,
            username: member.username || "",
            rank: member.rank || "Ohne Rang",
            department: member.department || "Keine Abteilung"
        }))
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "de", { sensitivity: "base" }));

    const discordRoles = Array.isArray(discordOverview.roles) ? discordOverview.roles : [];
    const highPermissionRoles = discordRoles.filter(role =>
        (Array.isArray(role.permissions) ? role.permissions : []).some(permission =>
            ["Administrator", "ManageGuild", "ManageRoles", "ManageChannels", "BanMembers", "KickMembers", "ViewAuditLog"].includes(permission)
        )
    );

    const unusedRoles = discordRoles.filter(role => Number(role.memberCount || 0) === 0);
    const managedRoles = discordRoles.filter(role => role.managed);

    const notifications = buildAdminNotifications({
        absences,
        tasks,
        personRecords,
        botStatus,
        voiceAdmin,
        auditLogs
    });

    const warnings = [];
    if (uploadStats.bytes > 50 * 1024 * 1024 * 1024) warnings.push("Upload-Speicher liegt über 50 GB.");
    if (overdueTasks.length) warnings.push(`${overdueTasks.length} Aufgabe(n) sind überfällig.`);
    if (tasksWithoutAssignees.length) warnings.push(`${tasksWithoutAssignees.length} Aufgabe(n) haben keine Zuständigen.`);
    if (absences.some(absence => absence.status === "Unklar" || absence.parseStatus === "needs_review")) warnings.push("Es gibt unklare Abmeldungen zur Prüfung.");
    if (!voice.updatedAt) warnings.push("Voice-Zeiten werden erst ab der neuen Version getrackt. Alte Zeiten sind nicht rückwirkend verfügbar.");
    if (botStatus.error) warnings.push(`Discord-Bot meldet Fehler: ${botStatus.error}`);
    if (discordAuditLogs.error) warnings.push(`Discord-Audit-Log: ${discordAuditLogs.error}`);

    return {
        generatedAt: new Date().toISOString(),
        system: {
            dashboardUptimeSeconds: Math.floor(process.uptime()),
            nodeVersion: process.version,
            platform: process.platform,
            pid: process.pid,
            memory,
            database: {
                path: dbPath,
                bytes: getFileSizeSafe(dbPath)
            },
            uploads: uploadStats,
            botStatus
        },
        team: {
            total: team.length,
            byRank: countBy(team, member => member.rank || "Ohne Rang"),
            byDepartment: countBy(team, member => hasNoTeamDepartment(member) ? "Keine Abteilung" : member.department),
            allRoles: countBy(team.flatMap(member => getAllTeamRoles(member).map(role => ({ role }))), item => item.role),
            recognitionIssues: team
                .filter(member => String(member.rank || "") === "Kein Rang" || hasNoTeamDepartment(member))
                .map(member => ({
                    id: member.id,
                    name: member.name || member.username || member.id,
                    rank: member.rank || "Kein Rang",
                    department: member.department || "Keine Abteilung",
                    allRoles: getAllTeamRoles(member)
                })),
            warningRoles: team
                .filter(member => getTeamWarningRoles(member).length)
                .map(member => ({
                    id: member.id,
                    name: member.name || member.username || member.id,
                    roles: getTeamWarningRoles(member)
                })),
            noDepartment: team
                .filter(hasNoTeamDepartment)
                .map(member => ({
                    id: member.id,
                    name: member.name || member.username || member.id,
                    rank: member.rank || "Ohne Rang",
                    allRoles: getAllTeamRoles(member)
                })),
            loggedInMembers,
            notLoggedInMembers,
            loggedInTeamCount: loggedInMembers.length,
            notLoggedInTeamCount: notLoggedInMembers.length,
            knownUsers: users.length
        },
        onboarding: buildOnboardingAdminOverview(team, users),
        quietHours: buildQuietHoursAdminOverview(team, users),
        voice: {
            updatedAt: voiceAdmin.updatedAt,
            weeklyMinimumMs: voiceAdmin.weeklyMinimumMs,
            ranges: voiceAdmin.ranges,
            trackedUsers: voiceUsers.length,
            teamUsers: voiceTeamUsers.slice(0, 200),
            teamWithoutVoice: teamWithoutVoice.slice(0, 200),
            activeNow: voiceAdmin.activeNow,
            underMinimum: voiceAdmin.underMinimum.slice(0, 200)
        },
        tasks: {
            total: tasks.length,
            byStatus: taskStatusCounts,
            byDepartment: taskDepartmentCounts,
            overdue: overdueTasks.length,
            dueToday: dueTodayTasks.length,
            noAssignees: tasksWithoutAssignees.length,
            byCreator: countBy(tasks, task => task.createdBy || "Unbekannt").slice(0, 20),
            byAssignee: countBy(tasks.flatMap(task => [
                ...(Array.isArray(task.assignees) ? task.assignees.map(user => ({ name: user.name || user.username || user.id })) : []),
                ...(Array.isArray(task.manualAssignees) ? task.manualAssignees.map(name => ({ name })) : [])
            ]), item => item.name).slice(0, 20)
        },
        absences: {
            total: absences.length,
            active: absences.filter(absence => absence.status === "Aktiv").length,
            pending: absences.filter(absence => absence.status === "Beantragt" || absence.parseStatus === "pending_review").length,
            unclear: absences.filter(absence => absence.status === "Unklar" || absence.parseStatus === "needs_review").length,
            rejected: absences.filter(absence => absence.status === "Abgelehnt").length,
            endingToday: absences.filter(absence => {
                const time = absence.endAt ? new Date(absence.endAt).getTime() : 0;
                return Number.isFinite(time) && time >= startOfToday && time < endOfToday;
            }).length,
            endingThisWeek: absences.filter(absence => {
                const time = absence.endAt ? new Date(absence.endAt).getTime() : 0;
                return Number.isFinite(time) && time >= now && time <= endOfWeek;
            }).length,
            byUser: countBy(absences, absence => absence.userName || "Unbekannt").slice(0, 20)
        },
        records: {
            peopleWithRecords: personRecords.filter(record => (record.entries || []).length).length,
            entriesTotal: allPersonEntries.length,
            good: goodEntries.length,
            neutral: allPersonEntries.filter(entry => String(entry.type || "Neutral") === "Neutral").length,
            bad: badEntries.length,
            latest: allPersonEntries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 15),
            topBad: countBy(badEntries, entry => entry.personName).slice(0, 10),
            topGood: countBy(goodEntries, entry => entry.personName).slice(0, 10)
        },
        content: {
            forumPosts: forumPosts.length,
            archiveEntries: archiveEntries.length,
            clips: clips.length,
            liveChatMessages: liveMessages.length,
            attachments: contentAttachments.length,
            attachmentBytes: contentAttachmentBytes,
            largestUploads: uploadStats.largestFiles,
            orphanUploads,
            orphanUploadBytes: orphanUploads.reduce((sum, file) => sum + safeNumber(file.bytes), 0)
        },
        discord: {
            guildId: CONFIG.guildId,
            botStatus,
            overview: discordOverview,
            auditLogs: {
                entries: Array.isArray(discordAuditLogs.entries) ? discordAuditLogs.entries.slice(0, 100) : [],
                updatedAt: discordAuditLogs.updatedAt || null,
                error: discordAuditLogs.error || ""
            },
            roles: discordRoles,
            rolesTotal: discordRoles.length,
            highPermissionRoles,
            unusedRoles,
            managedRoles,
            channels: Array.isArray(discordOverview.channels) ? discordOverview.channels : [],
            channelTypeCounts: discordOverview.channelTypeCounts || {},
            memberStats: discordOverview.memberStats || {},
            teamRoles: countBy(team.flatMap(member => Array.isArray(member.roles) ? member.roles.map(role => ({ role })) : []), item => item.role).slice(0, 40),
            dashboardKnownUsers: users.length
        },
        audit: {
            total: readAuditLogs().length,
            recent: auditLogs,
            byModule: countBy(readAuditLogs(), log => log.module || "Unbekannt"),
            byUser: countBy(readAuditLogs(), log => log.userName || "Unbekannt").slice(0, 20)
        },
        diagnostics: {
            total: readDiagnosticLogs().length,
            recent: diagnosticLogs,
            serverErrors: diagnosticLogs.filter(log => ["server_error", "http_500", "process_error"].includes(log.type)).slice(0, 50),
            discordErrors: diagnosticLogs.filter(log => log.type === "discord_api_error").slice(0, 50),
            http500: diagnosticLogs.filter(log => Number(log.statusCode || 0) >= 500 || log.type === "http_500").slice(0, 50)
        },
        permissions: buildPermissionSummary(),
        notifications,
        warnings,
        health: getDashboardHealth({
            tasks: {
                overdue: overdueTasks.length,
                noAssignees: tasksWithoutAssignees.length
            },
            absences: {
                unclear: absences.filter(absence => absence.status === "Unklar" || absence.parseStatus === "needs_review").length
            },
            voice: {
                updatedAt: voice.updatedAt || null
            },
            system: {
                uploads: uploadStats,
                botStatus
            }
        }),
        actions: buildAdminActionList()
    };
}


function getPersonRecordUploadOwnerId(userId, entryId) {
    return `${String(userId || "").replace(/[^a-zA-Z0-9_-]/g, "_")}_${String(entryId || "").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function buildPersonRecordAttachments(userId, entryId, files, req = null) {
    return (Array.isArray(files) ? files : []).map(file => ({
        id: crypto.randomUUID(),
        originalName: sanitizeOriginalName(file.originalname),
        fileName: file.filename,
        mimeType: file.mimetype || "application/octet-stream",
        size: file.size || 0,
        uploadedById: String(req?.session?.user?.id || ""),
        uploadedByName: getRequestUserName(req),
        uploadedAt: new Date().toISOString(),
        url: `${BASE_PATH}/api/person-records/${encodeURIComponent(String(userId))}/entries/${encodeURIComponent(String(entryId))}/files/${encodeURIComponent(file.filename)}`
    }));
}

function deletePersonRecordEntryUploadDirectory(userId, entryId) {
    deleteContentUploadDirectory("person-records", getPersonRecordUploadOwnerId(userId, entryId));
}

function queueTaskNotifications(task, onlyAssigneeIds = null, notificationType = "task-created", context = {}) {
    const knownAssignees = Array.isArray(task.assignees) ? task.assignees : [];
    const allowedIds = Array.isArray(onlyAssigneeIds)
        ? new Set(onlyAssigneeIds.map(id => String(id)))
        : null;

    const seenIds = new Set();
    const assigneesToNotify = knownAssignees.filter(assignee => {
        const id = String(assignee.id || "");

        if (!id) return false;
        if (seenIds.has(id)) return false;
        if (allowedIds && !allowedIds.has(id)) return false;

        seenIds.add(id);
        return true;
    });

    if (!assigneesToNotify.length) return;

    const notifications = readJsonFile(notificationsFile, []);
    const now = new Date().toISOString();
    const batchId = crypto.randomUUID();

    const dedupeId = context.dedupeId || "";

    const existingKeys = new Set(
        notifications
            .filter(notification => notification.status !== "failed" && notification.status !== "skipped")
            .map(notification => [
                notification.type || "task-created",
                notification.taskId,
                notification.assigneeId,
                notification.dedupeId || ""
            ].join(":"))
    );

    for (const assignee of assigneesToNotify) {
        const key = [notificationType, task.id, assignee.id, dedupeId].join(":");

        if (existingKeys.has(key)) continue;
        existingKeys.add(key);

        notifications.push({
            id: crypto.randomUUID(),
            batchId,
            dedupeId,
            type: notificationType,
            status: "pending",
            taskId: task.id,
            title: task.title,
            description: task.description,
            department: task.department,
            priority: task.priority || "Mittel",
            dueDate: task.dueDate || "",
            assigneeId: assignee.id,
            assignee: assignee.name || assignee.username || assignee.id,
            createdBy: task.createdBy,
            createdById: task.createdById,
            assignedBy: context.assignedBy || task.updatedBy || task.createdBy,
            assignedById: context.assignedById || task.updatedById || task.createdById,
            commentBy: context.commentBy || "",
            commentById: context.commentById || "",
            commentMessage: context.commentMessage || "",
            attachmentCount: context.attachmentCount || 0,
            attachmentNames: Array.isArray(context.attachmentNames) ? context.attachmentNames : [],
            channelId: context.channelId === undefined ? CONFIG.taskNotifyChannelId : context.channelId,
            taskUrl: getDashboardTaskDetailUrl(task.id),
            createdAt: now,
            attempts: 0
        });
    }

    writeJsonFile(notificationsFile, notifications);
}


function sendStoredFile(req, res, filePath, downloadName = "") {
    if (String(req.query.download || "") === "1") {
        return res.download(filePath, sanitizeOriginalName(downloadName || path.basename(filePath)));
    }

    return res.sendFile(filePath);
}

function ensureDirectory(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeOriginalName(name) {
    return String(name || "datei")
        .replace(/[\\/<>:"|?*\x00-\x1F]/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180) || "datei";
}

function normalizeAttachmentList(attachments, fallback = {}) {
    const list = Array.isArray(attachments) ? attachments : [];

    return list.map((attachment, index) => {
        const fileName = String(attachment?.fileName || "");
        const originalName = sanitizeOriginalName(attachment?.originalName || fileName || `Datei ${index + 1}`);
        const stableSource = fileName || originalName || `attachment-${index}`;
        const legacyId = `legacy_${String(stableSource).replace(/[^a-zA-Z0-9_-]/g, "_")}_${index}`;

        return {
            ...attachment,
            id: String(attachment?.id || legacyId),
            originalName,
            fileName,
            mimeType: String(attachment?.mimeType || "application/octet-stream"),
            size: Number(attachment?.size || 0),
            uploadedById: String(attachment?.uploadedById || fallback.uploadedById || ""),
            uploadedByName: String(attachment?.uploadedByName || fallback.uploadedByName || ""),
            uploadedAt: attachment?.uploadedAt || fallback.uploadedAt || null,
            url: String(attachment?.url || "")
        };
    });
}



function getSafeExtension(file) {
    const ext = path.extname(file.originalname || "").toLowerCase();

    // Beliebige PC-Dateien erlauben, aber die Dateiendung im gespeicherten Namen sauber halten.
    // Der eigentliche Originalname wird separat sanitisiert gespeichert.
    if (/^\.[a-z0-9_-]{1,20}$/i.test(ext)) {
        return ext;
    }

    return "";
}

function isAllowedAttachment(file) {
    // TeamSync speichert Uploads mit zufälligem Dateinamen und führt sie nicht aus.
    // Deshalb dürfen hier bewusst alle Dateitypen hochgeladen werden.
    return Boolean(file);
}

const taskAttachmentStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const taskId = String(req.params.id || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
        const dir = path.join(uploadsDir, "tasks", taskId);
        ensureDirectory(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = getSafeExtension(file);
        cb(null, `${crypto.randomUUID()}${ext}`);
    }
});

const taskAttachmentUpload = multer({
    storage: taskAttachmentStorage,
    limits: {
        fileSize: MAX_TASK_ATTACHMENT_SIZE,
        files: MAX_TASK_ATTACHMENTS
    },
    fileFilter: (req, file, cb) => {
        if (!isAllowedAttachment(file)) {
            return cb(new Error("Datei konnte nicht angenommen werden."));
        }

        cb(null, true);
    }
}).array("attachments", MAX_TASK_ATTACHMENTS);

function runTaskAttachmentUpload(req, res) {
    return new Promise((resolve, reject) => {
        taskAttachmentUpload(req, res, error => {
            if (!error) return resolve();

            if (error instanceof multer.MulterError) {
                if (error.code === "LIMIT_FILE_SIZE") {
                    return reject(new Error("Eine Datei ist zu groß. Maximal erlaubt sind 5 GB pro Datei."));
                }

                if (error.code === "LIMIT_FILE_COUNT") {
                    return reject(new Error(`Maximal ${MAX_TASK_ATTACHMENTS} Dateien pro Nachricht erlaubt.`));
                }
            }

            reject(error);
        });
    });
}

function cleanupUploadedFiles(files) {
    for (const file of Array.isArray(files) ? files : []) {
        try {
            if (file.path && fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }
        } catch (error) {
            console.error("Upload-Datei konnte nicht bereinigt werden:", error);
        }
    }
}

function deleteTaskUploadDirectory(taskId) {
    const safeTaskId = String(taskId || "").replace(/[^a-zA-Z0-9_-]/g, "_");

    if (!safeTaskId) return;

    const taskUploadDir = path.join(uploadsDir, "tasks", safeTaskId);

    try {
        fs.rmSync(taskUploadDir, {
            recursive: true,
            force: true
        });
    } catch (error) {
        console.error("Upload-Ordner der Aufgabe konnte nicht gelöscht werden:", error);
    }
}

function deleteCommentAttachmentFiles(taskId, attachments) {
    const safeTaskId = String(taskId || "").replace(/[^a-zA-Z0-9_-]/g, "_");

    if (!safeTaskId) return;

    for (const attachment of Array.isArray(attachments) ? attachments : []) {
        const fileName = path.basename(String(attachment.fileName || ""));

        if (!fileName) continue;

        const filePath = path.join(uploadsDir, "tasks", safeTaskId, fileName);

        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (error) {
            console.error("Kommentar-Anhang konnte nicht gelöscht werden:", error);
        }
    }
}

function removePendingNotificationsForTaskComment(taskId, commentId) {
    const notifications = readJsonFile(notificationsFile, []);

    if (!Array.isArray(notifications) || notifications.length === 0) return;

    const filtered = notifications.filter(notification => !(
        String(notification.taskId || "") === String(taskId) &&
        String(notification.dedupeId || "") === String(commentId) &&
        String(notification.type || "") === "task-comment" &&
        String(notification.status || "") === "pending"
    ));

    if (filtered.length !== notifications.length) {
        writeJsonFile(notificationsFile, filtered);
    }
}

function removePendingNotificationsForTask(taskId) {
    const notifications = readJsonFile(notificationsFile, []);

    if (!Array.isArray(notifications) || notifications.length === 0) return;

    const filtered = notifications.filter(notification =>
        String(notification.taskId || "") !== String(taskId)
    );

    if (filtered.length !== notifications.length) {
        writeJsonFile(notificationsFile, filtered);
    }
}

function buildCommentAttachments(taskId, files, req = null) {
    return (Array.isArray(files) ? files : []).map(file => ({
        id: crypto.randomUUID(),
        originalName: sanitizeOriginalName(file.originalname),
        fileName: file.filename,
        mimeType: file.mimetype || "application/octet-stream",
        size: file.size || 0,
        uploadedById: String(req?.session?.user?.id || ""),
        uploadedByName: getRequestUserName(req),
        uploadedAt: new Date().toISOString(),
        url: `${BASE_PATH}/uploads/tasks/${encodeURIComponent(String(taskId))}/${encodeURIComponent(file.filename)}`
    }));
}

function getSafeContentOwnerId(value) {
    return String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_") || "unknown";
}

const contentAttachmentStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const kind = String(req.uploadKind || "misc").replace(/[^a-zA-Z0-9_-]/g, "_");
        const ownerId = getSafeContentOwnerId(req.uploadOwnerId);
        const dir = path.join(uploadsDir, kind, ownerId);
        ensureDirectory(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = getSafeExtension(file);
        cb(null, `${crypto.randomUUID()}${ext}`);
    }
});

const contentAttachmentUpload = multer({
    storage: contentAttachmentStorage,
    limits: {
        fileSize: MAX_TASK_ATTACHMENT_SIZE,
        files: MAX_CONTENT_ATTACHMENTS
    },
    fileFilter: (req, file, cb) => {
        if (!isAllowedAttachment(file)) {
            return cb(new Error("Datei konnte nicht angenommen werden."));
        }

        cb(null, true);
    }
}).array("attachments", MAX_CONTENT_ATTACHMENTS);

function runContentAttachmentUpload(req, res, kind, ownerId) {
    req.uploadKind = kind;
    req.uploadOwnerId = ownerId;

    return new Promise((resolve, reject) => {
        contentAttachmentUpload(req, res, error => {
            if (!error) return resolve();

            if (error instanceof multer.MulterError) {
                if (error.code === "LIMIT_FILE_SIZE") {
                    return reject(new Error("Eine Datei ist zu groß. Maximal erlaubt sind 5 GB pro Datei."));
                }

                if (error.code === "LIMIT_FILE_COUNT") {
                    return reject(new Error(`Maximal ${MAX_CONTENT_ATTACHMENTS} Dateien pro Eintrag erlaubt.`));
                }
            }

            reject(error);
        });
    });
}


const mediaAttachmentUpload = multer({
    storage: contentAttachmentStorage,
    limits: {
        fileSize: MAX_TASK_ATTACHMENT_SIZE,
        files: MAX_CONTENT_ATTACHMENTS
    },
    fileFilter: (req, file, cb) => {
        if (!isAllowedMediaAttachment(file)) {
            return cb(new Error("Datei konnte nicht angenommen werden."));
        }

        cb(null, true);
    }
}).array("attachments", MAX_CONTENT_ATTACHMENTS);

function runMediaAttachmentUpload(req, res, kind, ownerId) {
    req.uploadKind = kind;
    req.uploadOwnerId = ownerId;

    return new Promise((resolve, reject) => {
        mediaAttachmentUpload(req, res, error => {
            if (!error) return resolve();

            if (error instanceof multer.MulterError) {
                if (error.code === "LIMIT_FILE_SIZE") {
                    return reject(new Error("Eine Datei ist zu groß. Maximal erlaubt sind 5 GB pro Datei."));
                }

                if (error.code === "LIMIT_FILE_COUNT") {
                    return reject(new Error(`Maximal ${MAX_CONTENT_ATTACHMENTS} Dateien pro Eintrag erlaubt.`));
                }
            }

            reject(error);
        });
    });
}

function buildContentAttachments(kind, ownerId, files, req = null) {
    return (Array.isArray(files) ? files : []).map(file => {
        const safeOwnerId = getSafeContentOwnerId(ownerId);
        const safeKind = String(kind || "misc").replace(/[^a-zA-Z0-9_-]/g, "_");

        return {
            id: crypto.randomUUID(),
            originalName: sanitizeOriginalName(file.originalname),
            fileName: file.filename,
            mimeType: file.mimetype || "application/octet-stream",
            size: file.size || 0,
            uploadedById: String(req?.session?.user?.id || ""),
            uploadedByName: getRequestUserName(req),
            uploadedAt: new Date().toISOString(),
            url: safeKind === "archive"
                ? `${BASE_PATH}/api/archive/entries/${encodeURIComponent(String(ownerId))}/files/${encodeURIComponent(file.filename)}`
                : `${BASE_PATH}/uploads/${safeKind}/${encodeURIComponent(safeOwnerId)}/${encodeURIComponent(file.filename)}`
        };
    });
}

function deleteContentUploadDirectory(kind, ownerId) {
    const safeKind = String(kind || "misc").replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeOwnerId = getSafeContentOwnerId(ownerId);
    const dir = path.join(uploadsDir, safeKind, safeOwnerId);

    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch (error) {
        console.error("Upload-Ordner konnte nicht gelöscht werden:", error);
    }
}

function canDeleteSingleAttachment(roles = [], userId = "", parentOwnerId = "", attachment = {}) {
    if (canManageAbsencesByRoles(roles)) return true;

    const requestUserId = String(userId || "");
    const uploaderId = String(attachment.uploadedById || "");

    if (uploaderId && uploaderId === requestUserId) return true;

    return Boolean(parentOwnerId) && String(parentOwnerId || "") === requestUserId;
}

function deleteStoredAttachmentFile(filePath) {
    try {
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (error) {
        console.error("Einzelner Anhang konnte nicht gelöscht werden:", error);
    }
}

function deleteTaskAttachmentFile(taskId, attachment) {
    const safeTaskId = String(taskId || "").replace(/[^a-zA-Z0-9_-]/g, "_");
    const fileName = path.basename(String(attachment?.fileName || ""));

    if (!safeTaskId || !fileName) return;

    deleteStoredAttachmentFile(path.join(uploadsDir, "tasks", safeTaskId, fileName));
}

function deleteContentAttachmentFile(kind, ownerId, attachment) {
    const safeKind = String(kind || "misc").replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeOwnerId = getSafeContentOwnerId(ownerId);
    const fileName = path.basename(String(attachment?.fileName || ""));

    if (!safeKind || !safeOwnerId || !fileName) return;

    deleteStoredAttachmentFile(path.join(uploadsDir, safeKind, safeOwnerId, fileName));
}

function removeAttachmentById(attachments, attachmentId) {
    const list = Array.isArray(attachments) ? attachments : [];
    const index = list.findIndex(attachment => String(attachment.id || "") === String(attachmentId || ""));

    if (index === -1) {
        return { index: -1, attachment: null, attachments: list };
    }

    const [attachment] = list.splice(index, 1);

    return { index, attachment, attachments: list };
}

function allAccessRoleOptions() {
    return [...new Set([...TEAM_ROLES, ...DEPARTMENTS])];
}

function normalizeRoleSelection(value) {
    const allowed = new Set(allAccessRoleOptions());
    const raw = Array.isArray(value) ? value : [value].filter(item => item !== undefined && item !== null);

    return [...new Set(
        raw
            .flatMap(item => String(item || "").split(/[,;\n]+/g))
            .map(item => item.trim())
            .filter(item => item && allowed.has(item))
    )];
}

function canManageContentBySession(req) {
    return canManageAbsencesByRoles(req.session?.roles || []);
}

async function requireContentManager(req, res, next) {
    const roles = await refreshSessionRoles(req);

    if (canManageAbsencesByRoles(roles)) {
        return next();
    }

    return res.status(403).json({ error: "Keine Berechtigung für diese Aktion." });
}

function migrateForumPost(post) {
    return {
        id: String(post.id || crypto.randomUUID()),
        title: String(post.title || "Unbenannter Eintrag"),
        content: String(post.content || ""),
        attachments: normalizeAttachmentList(post.attachments, {
            uploadedById: post.createdById,
            uploadedByName: post.createdByName
        }),
        createdById: String(post.createdById || ""),
        createdByName: String(post.createdByName || "Unbekannt"),
        updatedById: String(post.updatedById || ""),
        updatedByName: String(post.updatedByName || ""),
        createdAt: post.createdAt || new Date().toISOString(),
        updatedAt: post.updatedAt || post.createdAt || new Date().toISOString()
    };
}

function readForumPosts() {
    return readJsonFile(forumPostsFile, [])
        .map(post => migrateForumPost(post))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function writeForumPosts(posts) {
    writeJsonFile(forumPostsFile, Array.isArray(posts) ? posts.map(post => migrateForumPost(post)) : []);
}

function migrateArchiveEntry(entry) {
    return {
        id: String(entry.id || crypto.randomUUID()),
        title: String(entry.title || "Unbenannte Akte"),
        description: String(entry.description || ""),
        allowedRoles: normalizeRoleSelection(entry.allowedRoles),
        attachments: normalizeAttachmentList(entry.attachments, {
            uploadedById: entry.createdById,
            uploadedByName: entry.createdByName
        }),
        createdById: String(entry.createdById || ""),
        createdByName: String(entry.createdByName || "Unbekannt"),
        updatedById: String(entry.updatedById || ""),
        updatedByName: String(entry.updatedByName || ""),
        createdAt: entry.createdAt || new Date().toISOString(),
        updatedAt: entry.updatedAt || entry.createdAt || new Date().toISOString()
    };
}

function readArchiveEntriesRaw() {
    return readJsonFile(archiveEntriesFile, [])
        .map(entry => migrateArchiveEntry(entry))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function writeArchiveEntries(entries) {
    writeJsonFile(archiveEntriesFile, Array.isArray(entries) ? entries.map(entry => migrateArchiveEntry(entry)) : []);
}

function canManageArchiveEntry(entry, userId, roleNames = []) {
    const migrated = migrateArchiveEntry(entry);

    if (canManageAbsencesByRoles(roleNames)) return true;

    return String(migrated.createdById || "") === String(userId || "");
}

function canViewArchiveEntry(entry, userId, roleNames = []) {
    const migrated = migrateArchiveEntry(entry);

    // Projektleitung/Inhaber/Teamleitung/CCM/Management dürfen alle Akten sehen.
    if (canManageAbsencesByRoles(roleNames)) return true;

    // Ersteller sehen ihre eigene Akte immer.
    if (String(migrated.createdById || "") === String(userId || "")) return true;

    // Keine Rollenauswahl bedeutet: alle Teammitglieder dürfen diese Akte sehen.
    if (!migrated.allowedRoles.length) return true;

    const userRoles = new Set((Array.isArray(roleNames) ? roleNames : []).map(role => String(role || "")));

    return migrated.allowedRoles.some(role => userRoles.has(role));
}

function publicArchiveEntry(entry, userId = "", roleNames = []) {
    const migrated = migrateArchiveEntry(entry);
    const canManage = canManageArchiveEntry(migrated, userId, roleNames);

    return {
        ...migrated,
        accessLabel: migrated.allowedRoles.length ? migrated.allowedRoles.join(", ") : "Alle Teammitglieder",
        canManage,
        canEdit: canManage,
        canDelete: canManage
    };
}


function migrateClipEntry(entry) {
    return {
        id: String(entry.id || crypto.randomUUID()),
        description: String(entry.description || ""),
        attachments: normalizeAttachmentList(entry.attachments, {
            uploadedById: entry.createdById,
            uploadedByName: entry.createdByName
        }),
        createdById: String(entry.createdById || ""),
        createdByName: String(entry.createdByName || "Unbekannt"),
        createdAt: entry.createdAt || new Date().toISOString(),
        updatedAt: entry.updatedAt || entry.createdAt || new Date().toISOString()
    };
}

function readClipEntries() {
    return readJsonFile(clipsEntriesFile, [])
        .map(entry => migrateClipEntry(entry))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function writeClipEntries(entries) {
    writeJsonFile(clipsEntriesFile, Array.isArray(entries) ? entries.map(entry => migrateClipEntry(entry)) : []);
}

function canManageClipEntry(entry, userId, roleNames = []) {
    const migrated = migrateClipEntry(entry);
    if (canManageAbsencesByRoles(roleNames)) return true;
    return String(migrated.createdById || "") === String(userId || "");
}

function publicClipEntry(entry, userId = "", roleNames = []) {
    const migrated = migrateClipEntry(entry);
    const canManage = canManageClipEntry(migrated, userId, roleNames);

    return {
        ...migrated,
        canManage,
        canDelete: canManage
    };
}

function migrateLiveChatMessage(message) {
    const createdAt = message.createdAt || new Date().toISOString();

    return {
        id: String(message.id || crypto.randomUUID()),
        userId: String(message.userId || ""),
        userName: String(message.userName || "Unbekannt"),
        avatar: String(message.avatar || "https://cdn.discordapp.com/embed/avatars/0.png"),
        message: String(message.message || ""),
        attachments: normalizeAttachmentList(message.attachments, {
            uploadedById: message.userId,
            uploadedByName: message.userName
        }),
        createdAt,
        updatedAt: message.updatedAt || createdAt,
        editedAt: message.editedAt || null
    };
}

function readLiveChatMessages() {
    return readJsonFile(liveChatMessagesFile, [])
        .map(message => migrateLiveChatMessage(message))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .slice(-MAX_LIVE_CHAT_MESSAGES_RETURNED);
}

function writeLiveChatMessages(messages) {
    writeJsonFile(liveChatMessagesFile, Array.isArray(messages) ? messages.map(message => migrateLiveChatMessage(message)) : []);
}

function isAllowedMediaAttachment(file) {
    // Clips/Beweise darf jetzt ebenfalls alle Dateitypen annehmen.
    return isAllowedAttachment(file);
}

function queueTaskCommentNotifications(task, comment) {
    const assigneeIds = (Array.isArray(task.assignees) ? task.assignees : [])
        .map(assignee => String(assignee.id || ""))
        .filter(id => id && id !== String(comment.userId));

    if (!assigneeIds.length) return;

    const attachments = Array.isArray(comment.attachments) ? comment.attachments : [];

    queueTaskNotifications(task, assigneeIds, "task-comment", {
        dedupeId: comment.id,
        commentBy: comment.userName,
        commentById: comment.userId,
        commentMessage: comment.message,
        attachmentCount: attachments.length,
        attachmentNames: attachments.map(file => file.originalName).filter(Boolean).slice(0, 5),
        channelId: ""
    });
}

function queueDueDateReminders() {
    const tasks = readTasks();
    const now = Date.now();
    let changed = false;

    for (const task of tasks) {
        const status = normalizeTaskStatus(task.status);

        if (status === "Erledigt" || status === "Archiviert") continue;
        if (!task.dueDate) continue;

        const dueTime = new Date(task.dueDate).getTime();

        if (Number.isNaN(dueTime)) continue;

        const diff = dueTime - now;

        if (diff <= 0 || diff > DUE_REMINDER_WINDOW_MS) continue;

        const sent = new Set(Array.isArray(task.dueReminderSentAssigneeIds)
            ? task.dueReminderSentAssigneeIds.map(String)
            : []);

        const assigneeIds = (Array.isArray(task.assignees) ? task.assignees : [])
            .map(assignee => String(assignee.id || ""))
            .filter(id => id && !sent.has(id));

        if (!assigneeIds.length) continue;

        queueTaskNotifications(task, assigneeIds, "task-due-soon", {
            dedupeId: `due:${task.dueDate}`,
            channelId: ""
        });

        for (const id of assigneeIds) {
            sent.add(id);
        }

        task.dueReminderSentAssigneeIds = [...sent];
        changed = true;
    }

    if (changed) {
        writeTasks(tasks);
    }
}

function requireAuth(req, res, next) {
    const session = getSession(req);

    if (!session) {
        if (req.path.startsWith("/api/") || req.path === "/team" || req.path === "/me") {
            return res.status(401).json({ error: "Nicht angemeldet" });
        }

        return res.redirect(302, `${BASE_PATH}/login`);
    }

    if (!session.hasAccess) {
        if (req.path.startsWith("/api/") || req.path === "/team" || req.path === "/me") {
            return res.status(403).json({ error: "Kein Zugriff" });
        }

        return res.status(403).sendFile(path.join(viewsDir, "no-access.html"));
    }

    req.session = session;
    next();
}

function requireOAuthConfig(req, res, next) {
    if (!CONFIG.clientId || !CONFIG.clientSecret || !CONFIG.token || !CONFIG.guildId) {
        return res.status(500).send(`
            <html lang="de">
                <head><meta charset="UTF-8"><title>TeamSync Konfiguration fehlt</title></head>
                <body style="font-family:Arial;background:#18191c;color:white;padding:40px;">
                    <h1>Discord Login ist nicht fertig konfiguriert</h1>
                    <p>Trage in <code>config.json</code> mindestens <code>clientId</code>, <code>clientSecret</code>, <code>token</code> und <code>guildId</code> ein.</p>
                    <p>Redirect URI im Discord Developer Portal:</p>
                    <pre>${getRedirectUri(req)}</pre>
                </body>
            </html>
        `);
    }

    next();
}

function getSocketSession(socket) {
    const token = getCookieFromHeader(socket.handshake.headers.cookie || "", "teamsync_session");
    if (!token) return null;

    const session = sessions.get(token);
    if (!session) return null;

    if (session.expiresAt < Date.now()) {
        sessions.delete(token);
        return null;
    }

    return session;
}

function taskRoom(taskId) {
    return `task:${String(taskId || "")}`;
}

function emitTaskUpdated(taskId, reason = "updated") {
    if (!io || !taskId) return;

    io.to(taskRoom(taskId)).emit("task:updated", {
        taskId: String(taskId),
        reason,
        at: new Date().toISOString()
    });
}

function setupRealtime() {
    io = new Server(httpServer, {
        path: `${BASE_PATH}/socket.io`,
        serveClient: true
    });

    io.use((socket, next) => {
        const session = getSocketSession(socket);

        if (!session || !session.hasAccess) {
            return next(new Error("Nicht angemeldet"));
        }

        socket.data.session = session;
        next();
    });

    io.on("connection", socket => {
        socket.on("task:join", taskId => {
            const task = readTasks().find(item => String(item.id) === String(taskId));
            if (!task) return;
            socket.join(taskRoom(taskId));
        });

        socket.on("task:leave", taskId => {
            socket.leave(taskRoom(taskId));
        });

        socket.on("livechat:join", () => {
            socket.join("livechat");
        });

        socket.on("livechat:leave", () => {
            socket.leave("livechat");
        });
    });
}

// Root opens dashboard.
app.get("/", (req, res) => {
    res.redirect(301, BASE_PATH + "/");
});

// Static assets stay public, otherwise the login page would have no CSS.
app.use(
    `${BASE_PATH}/assets`,
    express.static(publicDir, {
        redirect: false,
        index: false,
        maxAge: "1h"
    })
);

app.get(BASE_PATH, (req, res) => {
    res.redirect(301, BASE_PATH + "/");
});

const router = express.Router();

router.use((req, res, next) => {
    res.on("finish", () => {
        if (res.statusCode >= 500) {
            logRequestDiagnostic(req, res);
        }
    });

    next();
});


router.use(
    "/uploads",
    requireAuth,
    (req, res, next) => {
        // Case-insensitiv prüfen: Auf Dateisystemen ohne Groß-/Kleinschreibung (z.B. Windows)
        // könnte sonst "/Archive/..." den Block umgehen und archive/person-records-Dateien
        // ohne die eigentliche Berechtigungsprüfung ausliefern.
        const uploadPath = String(req.path || "").toLowerCase();

        if (uploadPath.startsWith("/archive/") || uploadPath.startsWith("/person-records/")) {
            return res.status(404).send("Nicht gefunden");
        }

        next();
    },
    express.static(uploadsDir, {
        redirect: false,
        index: false,
        setHeaders: res => {
            res.setHeader("X-Content-Type-Options", "nosniff");
        }
    })
);


router.use(auditWriteMiddleware);

router.get("/login", (req, res) => {
    const session = getSession(req);

    if (session?.hasAccess) {
        return res.redirect(302, `${BASE_PATH}/`);
    }

    res.sendFile(path.join(viewsDir, "login.html"));
});

router.get("/auth/discord", requireOAuthConfig, (req, res) => {
    const state = crypto.randomBytes(24).toString("hex");

    oauthStates.set(state, {
        createdAt: Date.now()
    });

    setTimeout(() => oauthStates.delete(state), 10 * 60 * 1000);

    const params = new URLSearchParams({
        client_id: CONFIG.clientId,
        redirect_uri: getRedirectUri(req),
        response_type: "code",
        scope: "identify",
        state
    });

    res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

router.get("/auth/discord/callback", requireOAuthConfig, async (req, res) => {
    const { code, state } = req.query;

    if (!code || !state || !oauthStates.has(state)) {
        return res.status(400).send("Ungültiger Discord Login. Bitte erneut versuchen.");
    }

    oauthStates.delete(state);

    try {
        const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                client_id: CONFIG.clientId,
                client_secret: CONFIG.clientSecret,
                grant_type: "authorization_code",
                code: String(code),
                redirect_uri: getRedirectUri(req)
            })
        });

        if (!tokenResponse.ok) {
            const body = await tokenResponse.text();
            throw new Error(`OAuth Token Fehler ${tokenResponse.status}: ${body}`);
        }

        const tokenData = await tokenResponse.json();
        const user = await getDiscordUser(tokenData.access_token);
        const access = await checkTeamAccess(user.id);

        const sessionToken = crypto.randomBytes(32).toString("hex");
        const sessionUser = {
            id: user.id,
            username: user.username,
            globalName: user.global_name || user.username,
            avatar: user.avatar
                ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
                : "https://cdn.discordapp.com/embed/avatars/0.png"
        };

        sessions.set(sessionToken, {
            user: sessionUser,
            hasAccess: access.hasAccess,
            roles: access.roleNames,
            expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 7
        });

        let savedUser = null;

        if (access.hasAccess) {
            savedUser = saveKnownUser(sessionUser, access.roleNames, { isLogin: true });
        }

        setSessionCookie(res, sessionToken);

        if (!access.hasAccess) {
            return res.redirect(302, `${BASE_PATH}/no-access`);
        }

        const startPath = getUserStartPath(sessionUser.id, access.roleNames);
        res.redirect(302, `${BASE_PATH}${startPath === "/" ? "/" : startPath}`);
    } catch (error) {
        console.error("Discord Login fehlgeschlagen:", error);
        res.status(500).send("Discord Login fehlgeschlagen. Prüfe Bot-Token, Client-ID, Client-Secret, Redirect-URI und Guild-ID.");
    }
});

router.get("/logout", (req, res) => {
    const token = getCookie(req, "teamsync_session");

    if (token) {
        sessions.delete(token);
    }

    clearSessionCookie(res);
    res.redirect(302, `${BASE_PATH}/login`);
});

router.get("/no-access", (req, res) => {
    res.status(403).sendFile(path.join(viewsDir, "no-access.html"));
});

router.get("/me", requireAuth, (req, res) => {
    res.json({
        user: req.session.user,
        roles: req.session.roles
    });
});

router.get("/api/onboarding/status", requireAuth, (req, res) => {
    const users = readJsonFile(usersFile, []);
    const user = users.find(item => String(item.id || "") === String(req.session.user.id)) || {};
    const seen = Boolean(user.onboardingSeenAt);

    res.json({
        seen,
        version: ONBOARDING_VERSION,
        seenAt: user.onboardingSeenAt || null
    });
});

router.post("/api/onboarding/complete", requireAuth, async (req, res) => {
    const roles = await refreshSessionRoles(req);
    const users = readJsonFile(usersFile, []);
    const id = String(req.session.user.id || "");
    const index = users.findIndex(item => String(item.id || "") === id);
    const existing = index === -1 ? {} : users[index];
    const now = new Date().toISOString();
    const incomingSettings = sanitizeSettingsPatchForRoles(
        req.body?.settings && typeof req.body.settings === "object" ? req.body.settings : {},
        roles
    );
    const currentSettings = normalizeUserSettings(existing.settings || {});
    const settingsPatch = {
        startPage: incomingSettings.startPage || currentSettings.startPage,
        quietHours: incomingSettings.quietHours || currentSettings.quietHours,
        appearance: incomingSettings.appearance || currentSettings.appearance,
        // Das Login-Rückblick-Popup wird im Onboarding bewusst nicht gesetzt.
        loginRecap: currentSettings.loginRecap
    };
    const quietValidation = validateQuietHoursSettings(settingsPatch.quietHours || {});

    if (!quietValidation.ok) {
        return res.status(400).json({
            error: quietValidation.error,
            quietMinutes: quietValidation.quietMinutes,
            reachableMinutes: quietValidation.reachableMinutes
        });
    }

    const settings = normalizeUserSettings({
        ...currentSettings,
        ...settingsPatch,
        quietHours: {
            ...currentSettings.quietHours,
            ...(settingsPatch.quietHours || {})
        },
        appearance: {
            ...currentSettings.appearance,
            ...(settingsPatch.appearance || {})
        },
        loginRecap: currentSettings.loginRecap
    });

    if (index === -1) {
        users.push({
            id,
            username: req.session.user.username,
            globalName: req.session.user.globalName || req.session.user.username,
            avatar: req.session.user.avatar,
            roles,
            firstLoginAt: now,
            previousLoginAt: null,
            lastLoginAt: now,
            lastSeenAt: now,
            onboardingSeenAt: now,
            onboardingVersion: ONBOARDING_VERSION,
            settings
        });
    } else {
        users[index] = {
            ...users[index],
            roles,
            settings,
            onboardingSeenAt: now,
            onboardingVersion: ONBOARDING_VERSION,
            lastSeenAt: now
        };
    }

    writeJsonFile(usersFile, users);
    res.json({ ok: true, seenAt: now, version: ONBOARDING_VERSION, settings });
});

function getLatestIsoDate(...values) {
    let latest = 0;

    for (const value of values) {
        const time = new Date(value || 0).getTime();

        if (Number.isFinite(time) && time > latest) {
            latest = time;
        }
    }

    return latest > 0 ? new Date(latest).toISOString() : null;
}

router.get("/api/me/changes", requireAuth, (req, res) => {
    const users = readJsonFile(usersFile, []);
    const user = users.find(item => String(item.id || "") === String(req.session.user.id)) || {};
    const settings = normalizeUserSettings(user.settings || {});
    const since = getLatestIsoDate(user.previousLoginAt, user.loginRecapSeenAt);

    res.json(buildChangesSince(req.session.user.id, since, settings.loginRecap));
});

router.post("/api/me/changes/seen", requireAuth, (req, res) => {
    const users = readJsonFile(usersFile, []);
    const id = String(req.session.user.id || "");
    const index = users.findIndex(item => String(item.id || "") === id);
    const now = new Date().toISOString();

    if (index === -1) {
        users.push({
            id,
            username: req.session.user.username,
            globalName: req.session.user.globalName || req.session.user.username,
            avatar: req.session.user.avatar,
            roles: req.session.roles || [],
            firstLoginAt: now,
            previousLoginAt: null,
            lastLoginAt: now,
            lastSeenAt: now,
            loginRecapSeenAt: now
        });
    } else {
        users[index] = {
            ...users[index],
            loginRecapSeenAt: now,
            loginRecapSeenSince: req.body?.since || users[index].loginRecapSeenSince || null,
            loginRecapSeenTotal: Number(req.body?.total || 0),
            lastSeenAt: now
        };
    }

    writeJsonFile(usersFile, users);
    res.json({ ok: true, seenAt: now });
});

router.get("/", requireAuth, (req, res) => {
    res.sendFile(path.join(viewsDir, "index.html"));
});

router.get("/tasks", requireAuth, (req, res) => {
    res.sendFile(path.join(viewsDir, "tasks.html"));
});

router.get("/absences", requireAuth, (req, res) => {
    res.sendFile(path.join(viewsDir, "absences.html"));
});

router.get("/forum", requireAuth, (req, res) => {
    res.sendFile(path.join(viewsDir, "forum.html"));
});

router.get("/archive", requireAuth, (req, res) => {
    res.sendFile(path.join(viewsDir, "archive.html"));
});

router.get("/clips", requireAuth, (req, res) => {
    res.sendFile(path.join(viewsDir, "clips.html"));
});

router.get("/livechat", requireAuth, (req, res) => {
    res.sendFile(path.join(viewsDir, "livechat.html"));
});

router.get("/settings", requireAuth, (req, res) => {
    res.sendFile(path.join(viewsDir, "settings.html"));
});

router.get("/api/me/settings", requireAuth, async (req, res) => {
    const roles = await refreshSessionRoles(req);
    const canUseAdminStartPage = hasInhaberPermission(roles);
    const settings = getUserSettingsById(req.session.user.id);

    if (!canUseAdminStartPage && settings.startPage === "/admin") {
        settings.startPage = "/";
    }

    res.json({
        settings,
        allowedStartPages: [
            { value: "/", label: "Teamboard" },
            { value: "/tasks", label: "Aufgaben" },
            { value: "/absences", label: "Abmeldungen" },
            { value: "/forum", label: "Forum" },
            { value: "/archive", label: "Aktenarchiv" },
            { value: "/clips", label: "Clips/Beweise" },
            { value: "/livechat", label: "Livechat" },
            ...(canUseAdminStartPage ? [{ value: "/admin", label: "Admin" }] : [])
        ],
        canUseAdminStartPage
    });
});

router.put("/api/me/settings", requireAuth, async (req, res) => {
    const roles = await refreshSessionRoles(req);
    const body = sanitizeSettingsPatchForRoles(req.body || {}, roles);
    const quietValidation = validateQuietHoursSettings(body.quietHours || {});

    if (!quietValidation.ok) {
        return res.status(400).json({
            error: quietValidation.error,
            quietMinutes: quietValidation.quietMinutes,
            reachableMinutes: quietValidation.reachableMinutes
        });
    }

    const settings = setUserSettingsById(req.session.user.id, body);

    logAuditAction(req, "personal-settings-updated", "settings", req.session.user.id, {
        startPage: settings.startPage,
        quietHoursEnabled: settings.quietHours.enabled,
        quietMinutes: getQuietHoursDurationMinutes(settings.quietHours),
        reachableMinutes: getReachableMinutesForQuietHours(settings.quietHours),
        loginRecapEnabled: settings.loginRecap.enabled,
        whiteMode: settings.appearance.whiteMode
    });

    res.json({ ok: true, settings });
});

router.get("/admin", requireAuth, requireInhaber, (req, res) => {
    res.sendFile(path.join(viewsDir, "admin.html"));
});

router.get("/tasks/:id", requireAuth, (req, res) => {
    res.sendFile(path.join(viewsDir, "task-detail.html"));
});

router.get("/team", requireAuth, (req, res) => {
    const data = readJsonFile(teamFile, []);
    res.json(data);
});

router.get("/api/departments", requireAuth, (req, res) => {
    res.json(TASK_DEPARTMENTS);
});

router.get("/api/users", requireAuth, (req, res) => {
    // users.json ist ein reiner Login-Cache (jeder, der sich je eingeloggt hat, bleibt für
    // immer drin - es gibt keinen Ablauf) und war bisher direkt die Quelle für die
    // Zuständigen-Auswahl bei Aufgaben. Dadurch blieben ehemalige Teammitglieder (die
    // Discord/den Server längst verlassen haben) dauerhaft als Verantwortliche auswählbar.
    // Fix: hier zusätzlich mit dem aktuellen Team (team.json, vom Bot laufend synchron
    // gehalten) abgleichen und pro Nutzer markieren, ob er aktuell noch Teammitglied ist.
    // Die Liste selbst bleibt vollständig (damit bereits zugewiesene, aber ausgeschiedene
    // Personen in bestehenden Aufgaben weiterhin korrekt mit Namen angezeigt werden) -
    // das Frontend blendet anhand von isTeamMember nur die NEUE Auswahl aus.
    const users = readJsonFile(usersFile, []);
    const currentTeamIds = new Set(
        (readJsonFile(teamFile, []) || []).map(member => String(member.id || ""))
    );

    res.json(users.map(user => ({
        ...user,
        isTeamMember: currentTeamIds.has(String(user.id || ""))
    })));
});

router.get("/api/admin/permissions", requireAuth, async (req, res) => {
    const roles = await refreshSessionRoles(req);

    res.json({
        canViewAdmin: hasInhaberPermission(roles),
        roles
    });
});

router.post("/api/admin/onboarding/reset", requireAuth, requireInhaber, (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const resetAll = Boolean(body.all);
    const result = resetAll
        ? resetOnboardingForAllKnownUsers()
        : resetOnboardingForUserIds(body.userIds || []);

    logAuditAction(req, resetAll ? "onboarding-reset-all" : "onboarding-reset-users", "onboarding", resetAll ? "all" : (body.userIds || []).join(","), {
        resetAll,
        changed: result.changed.length,
        skipped: result.skipped || []
    });

    res.json({
        ok: true,
        resetAll,
        ...result
    });
});

router.post("/api/admin/quiet-hours", requireAuth, requireInhaber, (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const result = setAdminQuietHoursForUser(body.userId, body.quietHours || {}, {
        name: body.userName,
        username: body.username,
        updatedBy: req.session.user?.id || null
    });

    if (!result.ok) {
        return res.status(result.status || 400).json(result);
    }

    logAuditAction(req, "admin-quiet-hours-updated", "settings", result.user.id, {
        targetName: result.user.name,
        quietHours: result.settings.quietHours,
        quietMinutes: result.quietMinutes,
        reachableMinutes: result.reachableMinutes
    });

    res.json(result);
});

router.get("/api/admin/summary", requireAuth, requireInhaber, (req, res) => {
    res.json(buildAdminSummary(req));
});

router.get("/api/admin/report", requireAuth, requireInhaber, (req, res) => {
    const summary = buildAdminSummary(req);
    const fileName = `teamsync-admin-report-${new Date().toISOString().slice(0, 10)}.json`;

    logAuditAction(req, "admin-report-export", "admin", "", { fileName });

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(JSON.stringify(summary, null, 2));
});

router.get("/api/admin/diagnostics", requireAuth, requireInhaber, (req, res) => {
    res.json({
        total: readDiagnosticLogs().length,
        recent: readDiagnosticLogs().slice(-200).reverse()
    });
});

router.post("/api/admin/actions/system-check", requireAuth, requireInhaber, (req, res) => {
    const result = runSystemCheck();

    logAuditAction(req, "system-check", "admin", "", {
        ok: result.ok,
        failed: result.checks.filter(check => !check.ok).map(check => check.id)
    });

    res.json(result);
});

router.post("/api/admin/actions/recalculate-storage", requireAuth, requireInhaber, (req, res) => {
    const stats = getDirectoryStats(uploadsDir);

    logAuditAction(req, "storage-recalculated", "admin", "", {
        bytes: stats.bytes,
        files: stats.files
    });

    res.json({ ok: true, stats });
});

router.post("/api/admin/actions/backup-db", requireAuth, requireInhaber, (req, res) => {
    const dbPath = getDatabasePath();

    if (!fs.existsSync(dbPath)) {
        return res.status(404).json({ error: "Datenbankdatei wurde nicht gefunden." });
    }

    const backupsDir = path.join(__dirname, "backups");
    ensureDirectory(backupsDir);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const baseName = `teamsync-${timestamp}`;
    const copiedFiles = [];

    for (const sourcePath of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
        if (!fs.existsSync(sourcePath)) continue;

        const suffix = sourcePath === dbPath ? ".db" : sourcePath.endsWith("-wal") ? ".db-wal" : ".db-shm";
        const fileName = `${baseName}${suffix}`;
        const targetPath = path.join(backupsDir, fileName);

        fs.copyFileSync(sourcePath, targetPath);

        copiedFiles.push({
            fileName,
            path: targetPath,
            bytes: getFileSizeSafe(targetPath)
        });
    }

    const totalBytes = copiedFiles.reduce((sum, file) => sum + safeNumber(file.bytes), 0);

    logAuditAction(req, "database-backup-created", "admin", baseName, {
        files: copiedFiles.map(file => file.fileName),
        bytes: totalBytes,
        includesWal: copiedFiles.some(file => file.fileName.endsWith(".db-wal")),
        includesShm: copiedFiles.some(file => file.fileName.endsWith(".db-shm"))
    });

    res.json({
        ok: true,
        fileName: `${baseName}.db`,
        files: copiedFiles,
        bytes: totalBytes
    });
});

router.post("/api/admin/actions/scan-orphans", requireAuth, requireInhaber, (req, res) => {
    const orphans = findOrphanUploads(100);

    logAuditAction(req, "orphan-uploads-scanned", "admin", "", {
        count: orphans.length,
        bytes: orphans.reduce((sum, file) => sum + safeNumber(file.bytes), 0)
    });

    res.json({
        ok: true,
        orphans
    });
});

router.post("/api/admin/actions/cleanup-orphans", requireAuth, requireInhaber, (req, res) => {
    const result = cleanupOrphanUploads(100);

    logAuditAction(req, "orphan-uploads-cleaned", "admin", "", result);

    res.json({
        ok: true,
        ...result
    });
});

router.post("/api/admin/actions/clear-audit", requireAuth, requireInhaber, (req, res) => {
    writeAuditLogs([]);

    logAuditAction(req, "audit-cleared", "admin", "", {
        by: getRequestUserName(req)
    });

    res.json({
        ok: true
    });
});

function buildVoiceExportRows(range = "all") {
    const voiceData = buildVoiceAdminRows();
    const cleanRange = ["week", "month", "all"].includes(String(range || "").toLowerCase())
        ? String(range || "").toLowerCase()
        : "all";

    const rows = [
        ...voiceData.teamUsers,
        ...voiceData.teamWithoutVoice.map(user => ({
            ...user,
            sessions: 0,
            active: false,
            activeChannelName: "",
            lastJoinedAt: null,
            lastLeftAt: null
        }))
    ];

    return {
        range: cleanRange,
        label: voiceData.ranges?.[cleanRange]?.label || "Gesamt",
        rows: rows.map(user => ({
            userId: user.userId || user.id,
            userName: user.userName || user.name || user.id || "Unbekannt",
            ms: cleanRange === "week"
                ? Number(user.weekMs || 0)
                : cleanRange === "month"
                    ? Number(user.monthMs || 0)
                    : Number(user.allMs ?? user.totalMs ?? 0),
            sessions: Number(user.sessions || 0),
            active: user.active ? "Ja" : "Nein",
            approvedAbsenceThisWeek: user.approvedAbsenceThisWeek ? "Ja" : "Nein",
            underWeeklyMinimum: user.underWeeklyMinimum ? "Ja" : "Nein"
        })).sort((a, b) => b.ms - a.ms || String(a.userName).localeCompare(String(b.userName), "de", { sensitivity: "base" }))
    };
}

function escapeCsvCell(value) {
    const text = String(value ?? "");
    return `"${text.replace(/"/g, '""')}"`;
}

function buildSimplePdf(title, lines) {
    const safeLines = Array.isArray(lines) ? lines : [];
    const objects = [];
    const pages = [];
    const pageHeight = 842;
    const marginTop = 790;
    const lineHeight = 14;
    const maxLines = 50;

    function pdfEscape(value) {
        return String(value || "")
            .replace(/Ä/g, "Ae")
            .replace(/Ö/g, "Oe")
            .replace(/Ü/g, "Ue")
            .replace(/ä/g, "ae")
            .replace(/ö/g, "oe")
            .replace(/ü/g, "ue")
            .replace(/ß/g, "ss")
            .replace(/[^\x20-\x7E]/g, "?")
            .replace(/\\/g, "\\\\")
            .replace(/\(/g, "\\(")
            .replace(/\)/g, "\\)");
    }

    for (let i = 0; i < safeLines.length; i += maxLines) {
        pages.push(safeLines.slice(i, i + maxLines));
    }

    if (!pages.length) pages.push(["Keine Daten"]);

    objects.push("<< /Type /Catalog /Pages 2 0 R >>");
    objects.push(""); // pages placeholder
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

    const pageObjectIds = [];

    for (const pageLines of pages) {
        const content = [
            "BT",
            "/F1 12 Tf",
            `50 ${marginTop} Td`,
            `(${pdfEscape(title)}) Tj`,
            `0 -${lineHeight * 2} Td`,
            ...pageLines.map(line => `(${pdfEscape(line).slice(0, 120)}) Tj 0 -${lineHeight} Td`),
            "ET"
        ].join("\n");

        const contentId = objects.length + 1;
        objects.push(`<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`);
        const pageId = objects.length + 1;
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
        pageObjectIds.push(pageId);
    }

    objects[1] = `<< /Type /Pages /Kids [${pageObjectIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`;

    let pdf = "%PDF-1.4\n";
    const offsets = [0];

    objects.forEach((object, index) => {
        offsets.push(Buffer.byteLength(pdf, "utf8"));
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });

    const xrefOffset = Buffer.byteLength(pdf, "utf8");
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach(offset => {
        pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return Buffer.from(pdf, "utf8");
}

function buildVoiceMinimumDmMessage(user) {
    const current = formatDurationForExport(user.weekMs || 0);
    const required = formatDurationForExport(user.requiredWeeklyMs || VOICE_MINIMUM_WEEKLY_MS);
    const missing = formatDurationForExport(Math.max(0, (user.requiredWeeklyMs || VOICE_MINIMUM_WEEKLY_MS) - (user.weekMs || 0)));

    return [
        "⚠️ Hinweis zur Team-Voice-Mindestzeit",
        "",
        `Du hast diese Woche aktuell ${current} Voice-Zeit.`,
        `Die Mindestzeit beträgt ${required} pro Woche.`,
        `Dir fehlen aktuell noch ca. ${missing}.`,
        "",
        "Bitte hole die fehlende Zeit nach oder melde dich korrekt ab, falls du verhindert bist.",
        "",
        "Diese Nachricht wurde automatisch über das Teamboard verschickt."
    ].join("\n");
}

router.post("/api/admin/voice/notify-under-minimum", requireAuth, requireInhaber, async (req, res) => {
    const voiceData = buildVoiceAdminRows();
    const seen = new Set();
    const recipients = (Array.isArray(voiceData.underMinimum) ? voiceData.underMinimum : [])
        .filter(user => {
            const userId = String(user.userId || user.id || "").trim();

            if (!userId || seen.has(userId)) return false;
            if (user.approvedAbsenceThisWeek) return false;
            if (!user.underWeeklyMinimum) return false;

            seen.add(userId);
            return true;
        });

    const sent = [];
    const failed = [];

    for (const user of recipients) {
        try {
            await sendDiscordDm(user.userId || user.id, buildVoiceMinimumDmMessage(user));
            sent.push({
                userId: user.userId || user.id,
                userName: user.userName || user.name || user.userId || user.id,
                weekMs: user.weekMs || 0
            });
        } catch (error) {
            failed.push({
                userId: user.userId || user.id,
                userName: user.userName || user.name || user.userId || user.id,
                error: String(error?.message || error).slice(0, 1500)
            });

            appendDiagnosticLog({
                type: "discord_dm_error",
                level: "warning",
                message: "Voice-Mindestzeit-DM konnte nicht gesendet werden.",
                route: "/api/admin/voice/notify-under-minimum",
                method: "POST",
                statusCode: 0,
                userId: user.userId || user.id,
                userName: user.userName || user.name || "",
                details: {
                    error: String(error?.message || error).slice(0, 1500)
                }
            });
        }

        await sleep(650);
    }

    logAuditAction(req, "voice-minimum-notification", "voice", "", {
        recipients: recipients.length,
        sent: sent.length,
        failed: failed.length
    });

    res.json({
        recipients: recipients.length,
        sent,
        failed
    });
});

router.get("/api/admin/voice/export.csv", requireAuth, requireInhaber, (req, res) => {
    const exportData = buildVoiceExportRows(req.query.range || "all");
    const rows = [
        ["Name", "Discord-ID", "Bereich", "Zeit (ms)", "Zeit", "Sessions", "Aktiv", "Abgemeldet diese Woche", "Unter Mindestzeit"],
        ...exportData.rows.map(row => [
            row.userName,
            row.userId,
            exportData.label,
            row.ms,
            formatDurationForExport(row.ms),
            row.sessions,
            row.active,
            row.approvedAbsenceThisWeek,
            row.underWeeklyMinimum
        ])
    ];

    const csv = rows.map(row => row.map(escapeCsvCell).join(";")).join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="voice-zeiten-${exportData.range}.csv"`);
    res.send("﻿" + csv);
});

router.get("/api/admin/voice/export.pdf", requireAuth, requireInhaber, (req, res) => {
    const exportData = buildVoiceExportRows(req.query.range || "all");
    const lines = exportData.rows.map(row =>
        `${row.userName} | ${formatDurationForExport(row.ms)} | Sessions: ${row.sessions} | Aktiv: ${row.active} | Unter Mindestzeit: ${row.underWeeklyMinimum}`
    );

    const pdf = buildSimplePdf(`TeamSync Voice-Zeiten - ${exportData.label}`, lines);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="voice-zeiten-${exportData.range}.pdf"`);
    res.send(pdf);
});

function formatDurationForExport(ms) {
    const totalMinutes = Math.floor(safeNumber(ms) / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return `${hours}h ${minutes}min`;
}

router.post("/api/admin/voice/:userId/adjust", requireAuth, requireInhaber, (req, res) => {
    const userId = String(req.params.userId || "").trim();
    const mode = String(req.body?.mode || "add").trim().toLowerCase();
    const deltaMs = parseVoiceDeltaMs(req.body || {});

    if (!userId) {
        return res.status(400).json({ error: "Keine User-ID angegeben." });
    }

    if (!["add", "subtract", "set"].includes(mode)) {
        return res.status(400).json({ error: "Ungültiger Modus. Erlaubt: add, subtract, set." });
    }

    if (deltaMs < 0) {
        return res.status(400).json({ error: "Zeitwert darf nicht negativ sein." });
    }

    const voice = readVoiceActivity();
    voice.users = voice.users || {};

    const team = readJsonFile(teamFile, []);
    const teamMember = team.find(member => String(member.id || "") === userId);
    const current = voice.users[userId] || {};
    const user = normalizeVoiceUserRecord(userId, current, {
        userName: req.body?.userName || teamMember?.name || teamMember?.username || userId
    });

    const beforeMs = Number(user.totalMs || 0);

    if (mode === "set") {
        user.totalMs = Math.max(0, deltaMs);
    } else if (mode === "subtract") {
        user.totalMs = Math.max(0, beforeMs - deltaMs);
    } else {
        user.totalMs = Math.max(0, beforeMs + deltaMs);
    }

    user.manualAdjustments.push({
        id: crypto.randomUUID(),
        mode,
        deltaMs,
        beforeMs,
        afterMs: user.totalMs,
        note: String(req.body?.note || "").slice(0, 300),
        editedById: String(req.session?.user?.id || ""),
        editedByName: getRequestUserName(req),
        createdAt: new Date().toISOString()
    });

    voice.users[userId] = user;
    writeVoiceActivity(voice);

    logAuditAction(req, "voice-time-adjusted", "admin", userId, {
        mode,
        deltaMs,
        beforeMs,
        afterMs: user.totalMs,
        userName: user.userName
    });

    res.json({
        ok: true,
        user
    });
});

router.delete("/api/admin/voice/:userId", requireAuth, requireInhaber, (req, res) => {
    const userId = String(req.params.userId || "").trim();

    if (!userId) {
        return res.status(400).json({ error: "Keine User-ID angegeben." });
    }

    const voice = readVoiceActivity();
    voice.users = voice.users || {};

    const removed = voice.users[userId] || null;
    delete voice.users[userId];

    writeVoiceActivity(voice);

    logAuditAction(req, "voice-user-deleted", "admin", userId, {
        removedUserName: removed?.userName || userId,
        removedTotalMs: removed?.totalMs || 0
    });

    res.json({
        ok: true,
        removed
    });
});

router.post("/api/admin/actions/reset-voice", requireAuth, requireInhaber, (req, res) => {
    writeJsonFile(voiceActivityFile, {
        users: {},
        updatedAt: new Date().toISOString()
    });

    logAuditAction(req, "voice-activity-reset", "admin", "", {
        by: getRequestUserName(req)
    });

    res.json({
        ok: true
    });
});


router.get("/api/content-permissions", requireAuth, async (req, res) => {
    const roles = await refreshSessionRoles(req);

    const canManageContent = canManageAbsencesByRoles(roles);

    res.json({
        canManageContent,
        canManageForum: canManageContent,
        canManageArchiveAll: canManageContent,
        canCreateArchive: true,
        roles,
        roleOptions: allAccessRoleOptions()
    });
});

router.get("/api/forum/posts", requireAuth, (req, res) => {
    res.json(readForumPosts());
});

router.get("/api/forum/posts/:id", requireAuth, (req, res) => {
    const post = readForumPosts().find(item => String(item.id) === String(req.params.id));

    if (!post) {
        return res.status(404).json({ error: "Forumseintrag nicht gefunden." });
    }

    res.json(post);
});

router.post("/api/forum/posts", requireAuth, requireContentManager, async (req, res) => {
    const postId = crypto.randomUUID();

    try {
        await runContentAttachmentUpload(req, res, "forum", postId);
    } catch (error) {
        cleanupUploadedFiles(req.files);
        return res.status(400).json({ error: error.message || "Upload fehlgeschlagen" });
    }

    const title = String(req.body.title || "").trim();
    const content = String(req.body.content || "").trim();

    if (!title) {
        cleanupUploadedFiles(req.files);
        deleteContentUploadDirectory("forum", postId);
        return res.status(400).json({ error: "Titel fehlt." });
    }

    if (!content && (!Array.isArray(req.files) || req.files.length === 0)) {
        cleanupUploadedFiles(req.files);
        deleteContentUploadDirectory("forum", postId);
        return res.status(400).json({ error: "Text oder Anhang fehlt." });
    }

    if (content.length > MAX_FORUM_CONTENT_LENGTH) {
        cleanupUploadedFiles(req.files);
        deleteContentUploadDirectory("forum", postId);
        return res.status(400).json({ error: `Text darf maximal ${MAX_FORUM_CONTENT_LENGTH} Zeichen haben.` });
    }

    const now = new Date().toISOString();
    const post = migrateForumPost({
        id: postId,
        title,
        content,
        attachments: buildContentAttachments("forum", postId, req.files, req),
        createdById: req.session.user.id,
        createdByName: getRequestUserName(req),
        createdAt: now,
        updatedAt: now
    });

    const posts = readForumPosts();
    posts.unshift(post);
    writeForumPosts(posts);

    res.status(201).json(post);
});

router.put("/api/forum/posts/:id", requireAuth, requireContentManager, async (req, res) => {
    const initialPosts = readForumPosts();
    const initialIndex = initialPosts.findIndex(item => String(item.id) === String(req.params.id));

    if (initialIndex === -1) {
        return res.status(404).json({ error: "Forumseintrag nicht gefunden." });
    }

    if (req.is("multipart/form-data")) {
        try {
            await runContentAttachmentUpload(req, res, "forum", req.params.id);
        } catch (error) {
            cleanupUploadedFiles(req.files);
            return res.status(400).json({ error: error.message || "Upload fehlgeschlagen" });
        }
    }

    const title = String(req.body.title || "").trim();
    const content = String(req.body.content || "").trim();

    if (!title) {
        cleanupUploadedFiles(req.files);
        return res.status(400).json({ error: "Titel fehlt." });
    }

    if (content.length > MAX_FORUM_CONTENT_LENGTH) {
        cleanupUploadedFiles(req.files);
        return res.status(400).json({ error: `Text darf maximal ${MAX_FORUM_CONTENT_LENGTH} Zeichen haben.` });
    }

    // Nach einem eventuellen (potenziell langsamen) Datei-Upload erneut frisch laden,
    // damit zwischenzeitliche Änderungen durch andere Anfragen nicht überschrieben werden.
    const posts = readForumPosts();
    const index = posts.findIndex(item => String(item.id) === String(req.params.id));

    if (index === -1) {
        cleanupUploadedFiles(req.files);
        return res.status(404).json({ error: "Forumseintrag nicht gefunden." });
    }

    posts[index] = migrateForumPost({
        ...posts[index],
        title,
        content,
        attachments: [
            ...(Array.isArray(posts[index].attachments) ? posts[index].attachments : []),
            ...buildContentAttachments("forum", req.params.id, req.files, req)
        ],
        updatedAt: new Date().toISOString()
    });

    writeForumPosts(posts);

    res.json(posts[index]);
});

router.delete("/api/forum/posts/:id", requireAuth, requireContentManager, (req, res) => {
    const posts = readForumPosts();
    const post = posts.find(item => String(item.id) === String(req.params.id));

    if (!post) {
        return res.status(404).json({ error: "Forumseintrag nicht gefunden." });
    }

    writeForumPosts(posts.filter(item => String(item.id) !== String(req.params.id)));
    deleteContentUploadDirectory("forum", req.params.id);

    res.json({ ok: true });
});

router.get("/api/archive/entries", requireAuth, async (req, res) => {
    const roles = await refreshSessionRoles(req);
    const entries = readArchiveEntriesRaw()
        .filter(entry => canViewArchiveEntry(entry, req.session.user.id, roles))
        .map(entry => publicArchiveEntry(entry, req.session.user.id, roles));

    res.json(entries);
});

router.get("/api/archive/entries/:id", requireAuth, async (req, res) => {
    const roles = await refreshSessionRoles(req);
    const entry = readArchiveEntriesRaw().find(item => String(item.id) === String(req.params.id));

    if (!entry) {
        return res.status(404).json({ error: "Akte nicht gefunden." });
    }

    if (!canViewArchiveEntry(entry, req.session.user.id, roles)) {
        return res.status(403).json({ error: "Kein Zugriff auf diese Akte." });
    }

    res.json(publicArchiveEntry(entry, req.session.user.id, roles));
});

router.get("/api/archive/entries/:id/files/:fileName", requireAuth, async (req, res) => {
    const roles = await refreshSessionRoles(req);
    const entry = readArchiveEntriesRaw().find(item => String(item.id) === String(req.params.id));

    if (!entry) {
        return res.status(404).send("Akte nicht gefunden.");
    }

    if (!canViewArchiveEntry(entry, req.session.user.id, roles)) {
        return res.status(403).send("Kein Zugriff auf diese Datei.");
    }

    const fileName = path.basename(String(req.params.fileName || ""));
    const filePath = path.join(uploadsDir, "archive", getSafeContentOwnerId(req.params.id), fileName);

    if (!fileName || !fs.existsSync(filePath)) {
        return res.status(404).send("Datei nicht gefunden.");
    }

    const attachment = (Array.isArray(entry.attachments) ? entry.attachments : [])
        .find(item => String(item.fileName || "") === fileName);

    sendStoredFile(req, res, filePath, attachment?.originalName || fileName);
});

router.post("/api/archive/entries", requireAuth, async (req, res) => {
    const entryId = crypto.randomUUID();

    try {
        await runContentAttachmentUpload(req, res, "archive", entryId);
    } catch (error) {
        cleanupUploadedFiles(req.files);
        return res.status(400).json({ error: error.message || "Upload fehlgeschlagen" });
    }

    const title = String(req.body.title || "").trim();
    const description = String(req.body.description || "").trim();
    const allowedRoles = normalizeRoleSelection(req.body.allowedRoles);

    if (!title) {
        cleanupUploadedFiles(req.files);
        deleteContentUploadDirectory("archive", entryId);
        return res.status(400).json({ error: "Titel fehlt." });
    }

    if (description.length > MAX_ARCHIVE_DESCRIPTION_LENGTH) {
        cleanupUploadedFiles(req.files);
        deleteContentUploadDirectory("archive", entryId);
        return res.status(400).json({ error: `Beschreibung darf maximal ${MAX_ARCHIVE_DESCRIPTION_LENGTH} Zeichen haben.` });
    }

    const now = new Date().toISOString();
    const entry = migrateArchiveEntry({
        id: entryId,
        title,
        description,
        allowedRoles,
        attachments: buildContentAttachments("archive", entryId, req.files, req),
        createdById: req.session.user.id,
        createdByName: getRequestUserName(req),
        createdAt: now,
        updatedAt: now
    });

    const entries = readArchiveEntriesRaw();
    entries.unshift(entry);
    writeArchiveEntries(entries);

    res.status(201).json(publicArchiveEntry(entry, req.session.user.id, await refreshSessionRoles(req)));
});

router.put("/api/archive/entries/:id", requireAuth, async (req, res) => {
    const roles = await refreshSessionRoles(req);
    const initialEntries = readArchiveEntriesRaw();
    const initialIndex = initialEntries.findIndex(item => String(item.id) === String(req.params.id));

    if (initialIndex === -1) {
        return res.status(404).json({ error: "Akte nicht gefunden." });
    }

    if (!canManageArchiveEntry(initialEntries[initialIndex], req.session.user.id, roles)) {
        return res.status(403).json({ error: "Nur der Ersteller oder berechtigte Rollen können diese Akte bearbeiten." });
    }

    if (req.is("multipart/form-data")) {
        try {
            await runContentAttachmentUpload(req, res, "archive", req.params.id);
        } catch (error) {
            cleanupUploadedFiles(req.files);
            return res.status(400).json({ error: error.message || "Upload fehlgeschlagen" });
        }
    }

    const title = String(req.body.title || "").trim();
    const description = String(req.body.description || "").trim();
    const allowedRoles = normalizeRoleSelection(req.body.allowedRoles);

    if (!title) {
        cleanupUploadedFiles(req.files);
        return res.status(400).json({ error: "Titel fehlt." });
    }

    if (description.length > MAX_ARCHIVE_DESCRIPTION_LENGTH) {
        cleanupUploadedFiles(req.files);
        return res.status(400).json({ error: `Beschreibung darf maximal ${MAX_ARCHIVE_DESCRIPTION_LENGTH} Zeichen haben.` });
    }

    // Nach einem eventuellen (potenziell langsamen) Datei-Upload erneut frisch laden,
    // damit zwischenzeitliche Änderungen durch andere Anfragen nicht überschrieben werden.
    const entries = readArchiveEntriesRaw();
    const index = entries.findIndex(item => String(item.id) === String(req.params.id));

    if (index === -1) {
        cleanupUploadedFiles(req.files);
        return res.status(404).json({ error: "Akte nicht gefunden." });
    }

    entries[index] = migrateArchiveEntry({
        ...entries[index],
        title,
        description,
        allowedRoles,
        attachments: [
            ...(Array.isArray(entries[index].attachments) ? entries[index].attachments : []),
            ...buildContentAttachments("archive", req.params.id, req.files, req)
        ],
        updatedAt: new Date().toISOString()
    });

    writeArchiveEntries(entries);

    res.json(publicArchiveEntry(entries[index], req.session.user.id, roles));
});

router.delete("/api/archive/entries/:id", requireAuth, async (req, res) => {
    const roles = await refreshSessionRoles(req);
    const entries = readArchiveEntriesRaw();
    const entry = entries.find(item => String(item.id) === String(req.params.id));

    if (!entry) {
        return res.status(404).json({ error: "Akte nicht gefunden." });
    }

    if (!canManageArchiveEntry(entry, req.session.user.id, roles)) {
        return res.status(403).json({ error: "Nur der Ersteller oder berechtigte Rollen können diese Akte löschen." });
    }

    writeArchiveEntries(entries.filter(item => String(item.id) !== String(req.params.id)));
    deleteContentUploadDirectory("archive", req.params.id);

    res.json({ ok: true });
});



router.get("/api/clips", requireAuth, async (req, res) => {
    const roles = await refreshSessionRoles(req);
    const entries = readClipEntries().map(entry => publicClipEntry(entry, req.session.user.id, roles));
    res.json(entries);
});

router.post("/api/clips", requireAuth, async (req, res) => {
    const clipId = crypto.randomUUID();

    try {
        await runMediaAttachmentUpload(req, res, "clips", clipId);
    } catch (error) {
        cleanupUploadedFiles(req.files);
        return res.status(400).json({ error: error.message || "Upload fehlgeschlagen" });
    }

    const description = String(req.body.description || "").trim();
    const files = Array.isArray(req.files) ? req.files : [];

    if (!files.length) {
        cleanupUploadedFiles(req.files);
        deleteContentUploadDirectory("clips", clipId);
        return res.status(400).json({ error: "Mindestens eine Datei fehlt." });
    }

    if (description.length > MAX_CLIP_DESCRIPTION_LENGTH) {
        cleanupUploadedFiles(req.files);
        deleteContentUploadDirectory("clips", clipId);
        return res.status(400).json({ error: `Beschreibung darf maximal ${MAX_CLIP_DESCRIPTION_LENGTH} Zeichen haben.` });
    }

    const now = new Date().toISOString();
    const entry = migrateClipEntry({
        id: clipId,
        description,
        attachments: buildContentAttachments("clips", clipId, files, req),
        createdById: req.session.user.id,
        createdByName: getRequestUserName(req),
        createdAt: now,
        updatedAt: now
    });

    const entries = readClipEntries();
    entries.unshift(entry);
    writeClipEntries(entries);

    res.status(201).json(publicClipEntry(entry, req.session.user.id, await refreshSessionRoles(req)));
});

router.delete("/api/clips/:id", requireAuth, async (req, res) => {
    const roles = await refreshSessionRoles(req);
    const entries = readClipEntries();
    const entry = entries.find(item => String(item.id) === String(req.params.id));

    if (!entry) {
        return res.status(404).json({ error: "Clip/Beweis nicht gefunden." });
    }

    if (!canManageClipEntry(entry, req.session.user.id, roles)) {
        return res.status(403).json({ error: "Nur der Ersteller oder berechtigte Rollen können diesen Eintrag löschen." });
    }

    writeClipEntries(entries.filter(item => String(item.id) !== String(req.params.id)));
    deleteContentUploadDirectory("clips", req.params.id);

    res.json({ ok: true });
});

router.get("/api/livechat/permissions", requireAuth, async (req, res) => {
    const roles = await refreshSessionRoles(req);

    res.json({
        canManageLivechat: canManageAbsencesByRoles(roles),
        roles
    });
});

router.get("/api/livechat/messages", requireAuth, (req, res) => {
    res.json(readLiveChatMessages());
});

router.post("/api/livechat/messages", requireAuth, async (req, res) => {
    const messageId = crypto.randomUUID();

    try {
        await runContentAttachmentUpload(req, res, "livechat", messageId);
    } catch (error) {
        cleanupUploadedFiles(req.files);
        return res.status(400).json({ error: error.message || "Upload fehlgeschlagen" });
    }

    const text = String(req.body.message || "").trim();
    const attachments = buildContentAttachments("livechat", messageId, req.files, req);

    if (!text && !attachments.length) {
        cleanupUploadedFiles(req.files);
        deleteContentUploadDirectory("livechat", messageId);
        return res.status(400).json({ error: "Nachricht oder Anhang fehlt." });
    }

    if (text.length > MAX_LIVE_CHAT_MESSAGE_LENGTH) {
        cleanupUploadedFiles(req.files);
        deleteContentUploadDirectory("livechat", messageId);
        return res.status(400).json({ error: `Nachricht darf maximal ${MAX_LIVE_CHAT_MESSAGE_LENGTH} Zeichen haben.` });
    }

    const chatMessage = migrateLiveChatMessage({
        id: messageId,
        userId: req.session.user.id,
        userName: getRequestUserName(req),
        avatar: req.session.user.avatar || "https://cdn.discordapp.com/embed/avatars/0.png",
        message: text,
        attachments,
        createdAt: new Date().toISOString()
    });

    const messages = readLiveChatMessages();
    messages.push(chatMessage);
    writeLiveChatMessages(messages);

    if (io) {
        io.to("livechat").emit("livechat:message", chatMessage);
    }

    res.status(201).json(chatMessage);
});


router.put("/api/livechat/messages/:id", requireAuth, (req, res) => {
    const messages = readLiveChatMessages();
    const index = messages.findIndex(message => String(message.id) === String(req.params.id));

    if (index === -1) {
        return res.status(404).json({ error: "Nachricht nicht gefunden." });
    }

    const current = messages[index];

    if (String(current.userId || "") !== String(req.session.user.id || "")) {
        return res.status(403).json({ error: "Du kannst nur eigene Nachrichten bearbeiten." });
    }

    const nextMessage = String(req.body.message || "").trim();
    const attachments = Array.isArray(current.attachments) ? current.attachments : [];

    if (!nextMessage && attachments.length === 0) {
        return res.status(400).json({ error: "Nachricht darf nicht leer sein, wenn keine Anhänge vorhanden sind." });
    }

    const updated = migrateLiveChatMessage({
        ...current,
        message: nextMessage,
        updatedAt: new Date().toISOString(),
        editedAt: new Date().toISOString()
    });

    messages[index] = updated;
    writeLiveChatMessages(messages);

    if (io) {
        io.to("livechat").emit("livechat:message-updated", updated);
    }

    res.json(updated);
});

router.delete("/api/livechat/messages/:id", requireAuth, async (req, res) => {
    // Rollen vor dem Lesen laden, damit zwischen Lesen und Schreiben kein await mehr
    // liegt (sonst könnten parallele Nachrichten/Änderungen überschrieben werden).
    const roles = await refreshSessionRoles(req);
    const messages = readLiveChatMessages();
    const index = messages.findIndex(message => String(message.id) === String(req.params.id));

    if (index === -1) {
        return res.status(404).json({ error: "Nachricht nicht gefunden." });
    }

    const current = messages[index];
    const isOwner = String(current.userId || "") === String(req.session.user.id || "");
    const canManageLivechat = canManageAbsencesByRoles(roles);

    if (!isOwner && !canManageLivechat) {
        return res.status(403).json({ error: "Du kannst nur eigene Nachrichten löschen." });
    }

    messages.splice(index, 1);
    writeLiveChatMessages(messages);
    deleteContentUploadDirectory("livechat", req.params.id);

    if (io) {
        io.to("livechat").emit("livechat:message-deleted", { id: String(req.params.id) });
    }

    res.json({ ok: true, id: String(req.params.id) });
});


router.get("/api/person-records/:userId", requireAuth, async (req, res) => {
    const roles = await refreshSessionRoles(req);
    const canManage = canManageAbsencesByRoles(roles);
    const person = getKnownPersonSummary(req.params.userId);

    if (!canManage) {
        return res.json({
            canManage: false,
            person,
            entries: []
        });
    }

    const record = getPersonRecord(req.params.userId);

    res.json({
        canManage: true,
        person: record.person,
        entries: record.entries
    });
});

router.get("/api/person-records/:userId/entries/:entryId/files/:fileName", requireAuth, requireAbsenceManager, (req, res) => {
    const record = getPersonRecord(req.params.userId);
    const entry = record.entries.find(item => String(item.id || "") === String(req.params.entryId));

    if (!entry) {
        return res.status(404).send("Eintrag nicht gefunden.");
    }

    const fileName = path.basename(String(req.params.fileName || ""));
    const filePath = path.join(
        uploadsDir,
        "person-records",
        getSafeContentOwnerId(getPersonRecordUploadOwnerId(req.params.userId, req.params.entryId)),
        fileName
    );

    if (!fileName || !fs.existsSync(filePath)) {
        return res.status(404).send("Datei nicht gefunden.");
    }

    const attachment = (Array.isArray(entry.attachments) ? entry.attachments : [])
        .find(item => String(item.fileName || "") === fileName);

    sendStoredFile(req, res, filePath, attachment?.originalName || fileName);
});

router.post("/api/person-records/:userId/entries", requireAuth, requireAbsenceManager, async (req, res) => {
    const entryId = crypto.randomUUID();
    const uploadOwnerId = getPersonRecordUploadOwnerId(req.params.userId, entryId);

    try {
        await runContentAttachmentUpload(req, res, "person-records", uploadOwnerId);
    } catch (error) {
        cleanupUploadedFiles(req.files);
        return res.status(400).json({ error: error.message || "Upload fehlgeschlagen" });
    }

    const note = String(req.body.note || "").trim();
    const type = normalizePersonRecordType(req.body.type);
    const attachments = buildPersonRecordAttachments(req.params.userId, entryId, req.files, req);

    if (!note && attachments.length === 0) {
        cleanupUploadedFiles(req.files);
        deletePersonRecordEntryUploadDirectory(req.params.userId, entryId);
        return res.status(400).json({ error: "Notiz oder Anhang fehlt." });
    }

    if (note.length > MAX_PERSON_RECORD_NOTE_LENGTH) {
        cleanupUploadedFiles(req.files);
        deletePersonRecordEntryUploadDirectory(req.params.userId, entryId);
        return res.status(400).json({ error: `Notiz darf maximal ${MAX_PERSON_RECORD_NOTE_LENGTH} Zeichen haben.` });
    }

    const record = getPersonRecord(req.params.userId);

    record.entries.push({
        id: entryId,
        type,
        note,
        attachments,
        createdById: String(req.session.user.id || ""),
        createdByName: getRequestUserName(req),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });

    const savedRecord = upsertPersonRecord(record);

    res.status(201).json({
        canManage: true,
        person: savedRecord.person,
        entries: savedRecord.entries
    });
});

router.delete("/api/person-records/:userId/entries/:entryId", requireAuth, requireAbsenceManager, (req, res) => {
    const record = getPersonRecord(req.params.userId);
    const before = record.entries.length;

    record.entries = record.entries.filter(entry => String(entry.id || "") !== String(req.params.entryId));

    if (record.entries.length === before) {
        return res.status(404).json({ error: "Eintrag nicht gefunden." });
    }

    deletePersonRecordEntryUploadDirectory(req.params.userId, req.params.entryId);

    const savedRecord = upsertPersonRecord(record);

    res.json({
        canManage: true,
        person: savedRecord.person,
        entries: savedRecord.entries
    });
});

router.get("/api/absences/handover-suggestions", requireAuth, requireHandoverManager, (req, res) => {
    res.json(buildAbsenceHandoverSuggestions());
});

router.post("/api/absences/:id/handover-notify", requireAuth, requireHandoverManager, async (req, res) => {
    const suggestion = findAbsenceHandoverSuggestion(req.params.id);

    if (!suggestion) {
        return res.status(404).json({ error: "Keine offenen Übergabevorschläge für diese Abmeldung gefunden." });
    }

    const recipients = getTeamLeadershipRecipients(suggestion.absence.userId);
    const sent = [];
    const failed = [];
    const message = buildHandoverDmMessage(suggestion);

    for (const user of recipients) {
        try {
            await sendDiscordDm(user.id, message);
            sent.push({
                userId: user.id,
                userName: user.globalName || user.username || user.id
            });
        } catch (error) {
            failed.push({
                userId: user.id,
                userName: user.globalName || user.username || user.id,
                error: String(error?.message || error).slice(0, 1500)
            });

            appendDiagnosticLog({
                type: "discord_dm_error",
                level: "warning",
                message: "Übergabevorschlag-DM konnte nicht gesendet werden.",
                route: "/api/absences/:id/handover-notify",
                method: "POST",
                statusCode: 0,
                userId: user.id,
                userName: user.globalName || user.username || "",
                details: {
                    absenceId: suggestion.absence.id,
                    error: String(error?.message || error).slice(0, 1500)
                }
            });
        }

        await sleep(650);
    }

    logAuditAction(req, "absence-handover-notified", "absences", suggestion.absence.id, {
        absenceUserId: suggestion.absence.userId,
        absenceUserName: suggestion.absence.userName,
        tasks: suggestion.taskCount,
        recipients: recipients.length,
        sent: sent.length,
        failed: failed.length
    });

    res.json({
        absence: suggestion.absence,
        taskCount: suggestion.taskCount,
        recipients: recipients.length,
        sent,
        failed
    });
});

router.get("/api/absences", requireAuth, (req, res) => {
    res.json(readAbsences());
});

router.get("/api/absences/permissions", requireAuth, async (req, res) => {
    const roles = await refreshSessionRoles(req);

    res.json({
        canManageAbsences: canManageAbsencesByRoles(roles),
        canViewHandoverSuggestions: canViewHandoverSuggestionsByRoles(roles),
        roles
    });
});

router.get("/api/absences/team-members", requireAuth, requireAbsenceManager, (req, res) => {
    const team = readJsonFile(teamFile, []);

    res.json((Array.isArray(team) ? team : []).map(member => ({
        id: member.id,
        name: member.name || member.username || member.id,
        username: member.username || "",
        rank: member.rank || "",
        department: member.department || "",
        allRoles: Array.isArray(member.allRoles) ? member.allRoles : []
    })));
});

router.put("/api/absences/:id", requireAuth, requireAbsenceManager, async (req, res) => {
    const absences = readAbsencesRawForManagement();
    const index = absences.findIndex(absence => String(absence.id) === String(req.params.id));

    if (index === -1) {
        return res.status(404).json({ error: "Abmeldung nicht gefunden" });
    }

    const previous = migrateAbsence(absences[index]);
    const allowedStatuses = new Set(["Beantragt", "Aktiv", "Unklar", "Abgelehnt"]);
    const nextStatus = allowedStatuses.has(String(req.body?.status || ""))
        ? String(req.body.status)
        : previous.status;
    const nextUserId = String(req.body?.userId || previous.userId || "");
    const teamMember = getTeamMemberById(nextUserId);
    const nextEndAt = Object.prototype.hasOwnProperty.call(req.body || {}, "endAt")
        ? formatDatetimeLocalForStorage(req.body.endAt)
        : previous.endAt;
    // Das Bearbeiten-Formular erlaubte bisher nur das Ändern des Enddatums - das
    // Startdatum (startAt) war im Formular gar nicht editierbar. Analog zu endAt jetzt
    // ebenfalls übernehmen, wenn mitgeschickt.
    const nextStartAt = Object.prototype.hasOwnProperty.call(req.body || {}, "startAt")
        ? formatDatetimeLocalForStorage(req.body.startAt)
        : previous.startAt;

    const updated = appendAbsenceHistory({
        ...previous,
        userId: nextUserId,
        userName: String(req.body?.userName || teamMember?.name || teamMember?.username || previous.userName || nextUserId || "Unbekannt"),
        durationText: String(req.body?.durationText || previous.durationText || ""),
        reason: String(req.body?.reason || ""),
        startAt: nextStartAt || previous.startAt,
        endAt: nextEndAt,
        status: nextStatus,
        parseStatus: nextStatus === "Aktiv"
            ? "accepted"
            : nextStatus === "Abgelehnt"
                ? "rejected"
                : nextStatus === "Beantragt"
                    ? "pending_review"
                    : "needs_review",
        updatedAt: new Date().toISOString()
    }, "edited", req, {
        previous: {
            userId: previous.userId,
            userName: previous.userName,
            startAt: previous.startAt,
            endAt: previous.endAt,
            reason: previous.reason,
            status: previous.status
        },
        next: {
            userId: nextUserId,
            userName: teamMember?.name || req.body?.userName || previous.userName,
            startAt: nextStartAt || previous.startAt,
            endAt: nextEndAt,
            reason: String(req.body?.reason || ""),
            status: nextStatus
        }
    });

    absences[index] = updated;
    writeAbsences(absences);

    try {
        if (updated.status === "Aktiv") await setAbsenceDiscordReaction(updated, "✅");
        else if (updated.status === "Abgelehnt") await setAbsenceDiscordReaction(updated, "❌");
        else if (updated.status === "Beantragt") await setAbsenceDiscordReaction(updated, "⏳");
        else if (updated.status === "Unklar") await setAbsenceDiscordReaction(updated, "⚠️");
    } catch (error) {
        console.error("Abmelde-Bearbeiten-Reaktion konnte nicht gesetzt werden:", error);
    }

    logAuditAction(req, "absence-edited", "absences", updated.id, {
        userId: updated.userId,
        userName: updated.userName,
        status: updated.status
    });

    res.json(enrichAbsenceWithAccount(updated));
});

router.post("/api/absences/:id/accept", requireAuth, requireAbsenceManager, async (req, res) => {
    const absences = readAbsencesRawForManagement();
    const index = absences.findIndex(absence => String(absence.id) === String(req.params.id));

    if (index === -1) {
        return res.status(404).json({ error: "Abmeldung nicht gefunden" });
    }

    const reviewer = getAbsenceReviewer(req);
    const previous = migrateAbsence(absences[index]);

    absences[index] = appendAbsenceHistory({
        ...previous,
        status: "Aktiv",
        parseStatus: "accepted",
        reason: previous.reason || previous.originalContent || "",
        ...reviewer,
        acceptedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    }, "accepted", req, {
        previousStatus: previous.status,
        nextStatus: "Aktiv"
    });

    writeAbsences(absences);

    let dmSent = false;
    let reactionSet = false;

    try {
        dmSent = await sendDiscordDm(absences[index].userId, formatAbsenceDm(absences[index], true));
    } catch (error) {
        console.error("Abmelde-Akzeptieren-DM konnte nicht gesendet werden:", error);
    }

    try {
        reactionSet = await setAbsenceDiscordReaction(absences[index], "✅");
    } catch (error) {
        console.error("Abmelde-Reaktion konnte nicht gesetzt werden:", error);
    }

    logAuditAction(req, "absence-accepted", "absences", absences[index].id, {
        userId: absences[index].userId,
        userName: absences[index].userName,
        dmSent,
        reactionSet
    });

    res.json({
        ...enrichAbsenceWithAccount(absences[index]),
        dmSent,
        reactionSet
    });
});

router.post("/api/absences/:id/reject", requireAuth, requireAbsenceManager, async (req, res) => {
    const absences = readAbsencesRawForManagement();
    const index = absences.findIndex(absence => String(absence.id) === String(req.params.id));

    if (index === -1) {
        return res.status(404).json({ error: "Abmeldung nicht gefunden" });
    }

    const reviewer = getAbsenceReviewer(req);
    const previous = migrateAbsence(absences[index]);

    absences[index] = appendAbsenceHistory({
        ...previous,
        status: "Abgelehnt",
        parseStatus: "rejected",
        ...reviewer,
        rejectedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    }, "rejected", req, {
        previousStatus: previous.status,
        nextStatus: "Abgelehnt"
    });

    writeAbsences(absences);

    let dmSent = false;
    let reactionSet = false;

    try {
        dmSent = await sendDiscordDm(absences[index].userId, formatAbsenceDm(absences[index], false));
    } catch (error) {
        console.error("Abmelde-Ablehnen-DM konnte nicht gesendet werden:", error);
    }

    try {
        reactionSet = await setAbsenceDiscordReaction(absences[index], "❌");
    } catch (error) {
        console.error("Abmelde-Ablehnen-Reaktion konnte nicht gesetzt werden:", error);
    }

    logAuditAction(req, "absence-rejected", "absences", absences[index].id, {
        userId: absences[index].userId,
        userName: absences[index].userName,
        dmSent,
        reactionSet
    });

    res.json({
        ...enrichAbsenceWithAccount(absences[index]),
        dmSent,
        reactionSet
    });
});

router.delete("/api/absences/:id", requireAuth, requireAbsenceManager, (req, res) => {
    const absences = readAbsencesRawForManagement();
    const filtered = absences.filter(absence => String(absence.id) !== String(req.params.id));

    if (filtered.length === absences.length) {
        return res.status(404).json({ error: "Abmeldung nicht gefunden" });
    }

    writeAbsences(filtered);

    res.json({ ok: true });
});

router.get("/api/tasks", requireAuth, (req, res) => {
    res.json(readTasks());
});

router.get("/api/tasks/:id", requireAuth, (req, res) => {
    const task = readTasks().find(item => item.id === req.params.id);

    if (!task) {
        return res.status(404).json({ error: "Aufgabe nicht gefunden" });
    }

    res.json(task);
});

router.post("/api/tasks", requireAuth, (req, res) => {
    const tasks = readTasks();
    const now = new Date().toISOString();
    const assigneeData = normalizeAssignees(req.body);
    const description = String(req.body.description || "").trim();
    const dueDate = normalizeTaskDueDate(req.body.dueDate);

    if (description.length > MAX_TASK_DESCRIPTION_LENGTH) {
        return res.status(400).json({ error: `Beschreibung darf maximal ${MAX_TASK_DESCRIPTION_LENGTH} Zeichen haben.` });
    }

    const task = {
        id: crypto.randomUUID(),
        title: String(req.body.title || "").trim(),
        description,
        department: normalizeTaskDepartment(req.body.department),
        priority: normalizeTaskPriority(req.body.priority),
        status: normalizeTaskStatus(req.body.status),
        dueDate,
        dueReminderSentAssigneeIds: [],
        assignees: assigneeData.assignees,
        manualAssignees: assigneeData.manualAssignees,
        assignee: assigneeData.assignee,
        assigneeId: assigneeData.assigneeId,
        createdBy: req.session.user.globalName,
        createdById: req.session.user.id,
        createdAt: now,
        updatedAt: now,
        comments: []
    };

    if (!task.title) {
        return res.status(400).json({ error: "Titel fehlt" });
    }

    tasks.unshift(task);
    writeTasks(tasks);
    queueTaskNotifications(task);
    queueDueDateReminders();

    res.status(201).json(task);
});

router.put("/api/tasks/:id", requireAuth, async (req, res) => {
    // Rollen VOR dem Lesen/Schreiben der Aufgaben neu laden, damit zwischen dem Lesen
    // und dem späteren writeTasks() kein await mehr liegt. Sonst könnten parallele
    // Anfragen (z.B. ein neuer Kommentar) in der Zwischenzeit überschrieben werden.
    const roles = await refreshSessionRoles(req);
    const tasks = readTasks();
    const index = tasks.findIndex(task => task.id === req.params.id);

    if (index === -1) {
        return res.status(404).json({ error: "Aufgabe nicht gefunden" });
    }

    const previousTask = migrateTask(tasks[index]);
    const managerAllowed = canManageTask(previousTask, req.session.user.id, roles);
    const assigneePayloadPresent = hasAssigneePayload(req.body);
    const assigneeData = assigneePayloadPresent
        ? normalizeAssignees(req.body)
        : {
            assignees: previousTask.assignees,
            manualAssignees: previousTask.manualAssignees,
            assignee: previousTask.assignee,
            assigneeId: previousTask.assigneeId
        };

    const previousAssigneeIds = new Set((previousTask.assignees || []).map(user => String(user.id)));
    const nextAssigneeIds = assigneeData.assignees.map(user => String(user.id));
    const newlyAssignedIds = assigneePayloadPresent
        ? nextAssigneeIds.filter(id => !previousAssigneeIds.has(id))
        : [];

    const previousManualAssignees = Array.isArray(previousTask.manualAssignees) ? previousTask.manualAssignees : [];
    const nextManualAssignees = Array.isArray(assigneeData.manualAssignees) ? assigneeData.manualAssignees : [];
    const assigneesChanged = assigneePayloadPresent && (
        !sameStringArray([...previousAssigneeIds], nextAssigneeIds) ||
        !sameStringArray(previousManualAssignees, nextManualAssignees)
    );

    if (assigneesChanged && !managerAllowed) {
        return res.status(403).json({ error: "Nur Ersteller oder Zuständige dürfen Verantwortliche ändern." });
    }

    const nextStatus = normalizeTaskStatus(req.body.status || previousTask.status);

    if (nextStatus === "Archiviert" && previousTask.status !== "Archiviert" && !managerAllowed) {
        return res.status(403).json({ error: "Nur Ersteller oder Zuständige dürfen Aufgaben archivieren." });
    }

    const updatedBy = req.session.user.globalName || req.session.user.username || req.session.user.id;
    const updatedById = req.session.user.id;
    const description = req.body.description === undefined
        ? String(previousTask.description || "")
        : String(req.body.description || "").trim();
    const dueDate = Object.prototype.hasOwnProperty.call(req.body, "dueDate")
        ? normalizeTaskDueDate(req.body.dueDate)
        : previousTask.dueDate;

    if (description.length > MAX_TASK_DESCRIPTION_LENGTH) {
        return res.status(400).json({ error: `Beschreibung darf maximal ${MAX_TASK_DESCRIPTION_LENGTH} Zeichen haben.` });
    }

    const dueDateChanged = String(previousTask.dueDate || "") !== String(dueDate || "");

    tasks[index] = migrateTask({
        ...previousTask,
        title: String(req.body.title || previousTask.title || "").trim(),
        description,
        department: normalizeTaskDepartment(req.body.department || previousTask.department),
        priority: normalizeTaskPriority(req.body.priority || previousTask.priority),
        status: nextStatus,
        dueDate,
        dueReminderSentAssigneeIds: dueDateChanged ? [] : previousTask.dueReminderSentAssigneeIds,
        assignees: assigneeData.assignees,
        manualAssignees: assigneeData.manualAssignees,
        assignee: assigneeData.assignee,
        assigneeId: assigneeData.assigneeId,
        updatedBy,
        updatedById,
        updatedAt: new Date().toISOString()
    });

    if (!tasks[index].title) {
        return res.status(400).json({ error: "Titel fehlt" });
    }

    writeTasks(tasks);

    if (newlyAssignedIds.length) {
        queueTaskNotifications(tasks[index], newlyAssignedIds, "task-assigned", {
            assignedBy: updatedBy,
            assignedById: updatedById
        });
    }

    queueDueDateReminders();
    emitTaskUpdated(req.params.id, "task-updated");

    res.json(tasks[index]);
});

router.post("/api/tasks/:id/comments", requireAuth, async (req, res) => {
    const existingTasks = readTasks();
    const existingIndex = existingTasks.findIndex(task => task.id === req.params.id);

    if (existingIndex === -1) {
        return res.status(404).json({ error: "Aufgabe nicht gefunden" });
    }

    try {
        await runTaskAttachmentUpload(req, res);
    } catch (error) {
        cleanupUploadedFiles(req.files);
        return res.status(400).json({ error: error.message || "Upload fehlgeschlagen" });
    }

    const message = String(req.body.message || "").trim();
    const attachments = buildCommentAttachments(req.params.id, req.files, req);

    if (!message && attachments.length === 0) {
        cleanupUploadedFiles(req.files);
        return res.status(400).json({ error: "Nachricht oder Anhang fehlt" });
    }

    // Aufgaben erst nach dem (potenziell langsamen) Datei-Upload frisch neu laden,
    // damit zwischenzeitliche Änderungen durch andere Anfragen nicht überschrieben werden.
    const tasks = readTasks();
    const index = tasks.findIndex(task => task.id === req.params.id);

    if (index === -1) {
        cleanupUploadedFiles(req.files);
        return res.status(404).json({ error: "Aufgabe nicht gefunden" });
    }

    const comment = {
        id: crypto.randomUUID(),
        userId: req.session.user.id,
        userName: req.session.user.globalName || req.session.user.username || req.session.user.id,
        message,
        attachments,
        createdAt: new Date().toISOString()
    };

    tasks[index].comments = Array.isArray(tasks[index].comments) ? tasks[index].comments : [];
    tasks[index].comments.push(comment);
    tasks[index].updatedAt = new Date().toISOString();

    writeTasks(tasks);
    queueTaskCommentNotifications(tasks[index], comment);
    emitTaskUpdated(req.params.id, "comment-created");

    res.status(201).json(comment);
});

router.put("/api/tasks/:id/comments/:commentId", requireAuth, (req, res) => {
    const tasks = readTasks();
    const taskIndex = tasks.findIndex(task => task.id === req.params.id);

    if (taskIndex === -1) {
        return res.status(404).json({ error: "Aufgabe nicht gefunden" });
    }

    const task = tasks[taskIndex];
    task.comments = Array.isArray(task.comments) ? task.comments : [];

    const commentIndex = task.comments.findIndex(comment => comment.id === req.params.commentId);

    if (commentIndex === -1) {
        return res.status(404).json({ error: "Nachricht nicht gefunden" });
    }

    const comment = task.comments[commentIndex];

    if (String(comment.userId || "") !== String(req.session.user.id || "")) {
        return res.status(403).json({ error: "Du kannst nur eigene Nachrichten bearbeiten." });
    }

    const message = String(req.body.message || "").trim();
    const attachments = Array.isArray(comment.attachments) ? comment.attachments : [];

    if (!message && attachments.length === 0) {
        return res.status(400).json({ error: "Nachricht darf nicht leer sein, wenn keine Anhänge vorhanden sind." });
    }

    task.comments[commentIndex] = {
        ...comment,
        message,
        editedAt: new Date().toISOString()
    };

    task.updatedAt = new Date().toISOString();
    tasks[taskIndex] = task;

    writeTasks(tasks);
    emitTaskUpdated(req.params.id, "comment-edited");

    res.json(task.comments[commentIndex]);
});


router.delete("/api/tasks/:id/comments/:commentId/attachments/:attachmentId", requireAuth, async (req, res) => {
    // Rollen vor dem Lesen der Aufgaben laden, damit zwischen Lesen und Schreiben
    // kein await mehr liegt (sonst könnten parallele Änderungen überschrieben werden).
    const roles = await refreshSessionRoles(req);
    const tasks = readTasks();
    const taskIndex = tasks.findIndex(task => String(task.id) === String(req.params.id));

    if (taskIndex === -1) {
        return res.status(404).json({ error: "Aufgabe nicht gefunden" });
    }

    const task = tasks[taskIndex];
    task.comments = Array.isArray(task.comments) ? task.comments : [];

    const commentIndex = task.comments.findIndex(comment => String(comment.id) === String(req.params.commentId));

    if (commentIndex === -1) {
        return res.status(404).json({ error: "Nachricht nicht gefunden" });
    }

    const comment = task.comments[commentIndex];
    const result = removeAttachmentById(comment.attachments, req.params.attachmentId);

    if (result.index === -1) {
        return res.status(404).json({ error: "Anhang nicht gefunden" });
    }

    if (!canDeleteSingleAttachment(roles, req.session.user.id, comment.userId, result.attachment)) {
        return res.status(403).json({ error: "Keine Berechtigung, diesen Anhang zu löschen." });
    }

    deleteTaskAttachmentFile(req.params.id, result.attachment);

    task.comments[commentIndex] = {
        ...comment,
        attachments: result.attachments,
        editedAt: new Date().toISOString()
    };

    task.updatedAt = new Date().toISOString();
    tasks[taskIndex] = task;

    writeTasks(tasks);
    emitTaskUpdated(req.params.id, "comment-attachment-deleted");

    res.json(task.comments[commentIndex]);
});

router.delete("/api/forum/posts/:id/attachments/:attachmentId", requireAuth, async (req, res) => {
    const roles = await refreshSessionRoles(req);
    const posts = readForumPosts();
    const index = posts.findIndex(item => String(item.id) === String(req.params.id));

    if (index === -1) {
        return res.status(404).json({ error: "Forumseintrag nicht gefunden." });
    }

    const result = removeAttachmentById(posts[index].attachments, req.params.attachmentId);

    if (result.index === -1) {
        return res.status(404).json({ error: "Anhang nicht gefunden." });
    }

    if (!canDeleteSingleAttachment(roles, req.session.user.id, posts[index].createdById, result.attachment)) {
        return res.status(403).json({ error: "Keine Berechtigung, diesen Anhang zu löschen." });
    }

    deleteContentAttachmentFile("forum", req.params.id, result.attachment);

    posts[index] = migrateForumPost({
        ...posts[index],
        attachments: result.attachments,
        updatedAt: new Date().toISOString()
    });

    writeForumPosts(posts);

    res.json(posts[index]);
});

router.delete("/api/archive/entries/:id/attachments/:attachmentId", requireAuth, async (req, res) => {
    const roles = await refreshSessionRoles(req);
    const entries = readArchiveEntriesRaw();
    const index = entries.findIndex(item => String(item.id) === String(req.params.id));

    if (index === -1) {
        return res.status(404).json({ error: "Akte nicht gefunden." });
    }

    if (!canViewArchiveEntry(entries[index], req.session.user.id, roles)) {
        return res.status(403).json({ error: "Kein Zugriff auf diese Akte." });
    }

    const result = removeAttachmentById(entries[index].attachments, req.params.attachmentId);

    if (result.index === -1) {
        return res.status(404).json({ error: "Anhang nicht gefunden." });
    }

    if (!canDeleteSingleAttachment(roles, req.session.user.id, entries[index].createdById, result.attachment)) {
        return res.status(403).json({ error: "Keine Berechtigung, diesen Anhang zu löschen." });
    }

    deleteContentAttachmentFile("archive", req.params.id, result.attachment);

    entries[index] = migrateArchiveEntry({
        ...entries[index],
        attachments: result.attachments,
        updatedAt: new Date().toISOString()
    });

    writeArchiveEntries(entries);

    res.json(publicArchiveEntry(entries[index], req.session.user.id, roles));
});

router.delete("/api/clips/:id/attachments/:attachmentId", requireAuth, async (req, res) => {
    const roles = await refreshSessionRoles(req);
    const entries = readClipEntries();
    const index = entries.findIndex(item => String(item.id) === String(req.params.id));

    if (index === -1) {
        return res.status(404).json({ error: "Clip/Beweis nicht gefunden." });
    }

    const result = removeAttachmentById(entries[index].attachments, req.params.attachmentId);

    if (result.index === -1) {
        return res.status(404).json({ error: "Anhang nicht gefunden." });
    }

    if (!canDeleteSingleAttachment(roles, req.session.user.id, entries[index].createdById, result.attachment)) {
        return res.status(403).json({ error: "Keine Berechtigung, diesen Anhang zu löschen." });
    }

    deleteContentAttachmentFile("clips", req.params.id, result.attachment);

    entries[index] = migrateClipEntry({
        ...entries[index],
        attachments: result.attachments,
        updatedAt: new Date().toISOString()
    });

    writeClipEntries(entries);

    res.json(publicClipEntry(entries[index], req.session.user.id, roles));
});

router.delete("/api/livechat/messages/:id/attachments/:attachmentId", requireAuth, async (req, res) => {
    const roles = await refreshSessionRoles(req);
    const messages = readLiveChatMessages();
    const index = messages.findIndex(message => String(message.id) === String(req.params.id));

    if (index === -1) {
        return res.status(404).json({ error: "Nachricht nicht gefunden." });
    }

    const result = removeAttachmentById(messages[index].attachments, req.params.attachmentId);

    if (result.index === -1) {
        return res.status(404).json({ error: "Anhang nicht gefunden." });
    }

    if (!canDeleteSingleAttachment(roles, req.session.user.id, messages[index].userId, result.attachment)) {
        return res.status(403).json({ error: "Keine Berechtigung, diesen Anhang zu löschen." });
    }

    deleteContentAttachmentFile("livechat", req.params.id, result.attachment);

    messages[index] = migrateLiveChatMessage({
        ...messages[index],
        attachments: result.attachments,
        updatedAt: new Date().toISOString(),
        editedAt: new Date().toISOString()
    });

    writeLiveChatMessages(messages);

    if (io) {
        io.to("livechat").emit("livechat:message-updated", messages[index]);
    }

    res.json(messages[index]);
});

router.delete("/api/person-records/:userId/entries/:entryId/attachments/:attachmentId", requireAuth, requireAbsenceManager, (req, res) => {
    const record = getPersonRecord(req.params.userId);
    const entryIndex = record.entries.findIndex(entry => String(entry.id || "") === String(req.params.entryId));

    if (entryIndex === -1) {
        return res.status(404).json({ error: "Eintrag nicht gefunden." });
    }

    const entry = record.entries[entryIndex];
    const result = removeAttachmentById(entry.attachments, req.params.attachmentId);

    if (result.index === -1) {
        return res.status(404).json({ error: "Anhang nicht gefunden." });
    }

    deleteContentAttachmentFile("person-records", getPersonRecordUploadOwnerId(req.params.userId, req.params.entryId), result.attachment);

    record.entries[entryIndex] = {
        ...entry,
        attachments: result.attachments,
        updatedAt: new Date().toISOString()
    };

    const savedRecord = upsertPersonRecord(record);

    res.json({
        canManage: true,
        person: savedRecord.person,
        entries: savedRecord.entries
    });
});


router.delete("/api/tasks/:id/comments/:commentId", requireAuth, async (req, res) => {
    // Rollen vor dem Lesen laden, damit zwischen Lesen und Schreiben kein await mehr
    // liegt (sonst könnten parallele Änderungen an der Aufgabe überschrieben werden).
    const roles = await refreshSessionRoles(req);
    const tasks = readTasks();
    const taskIndex = tasks.findIndex(task => task.id === req.params.id);

    if (taskIndex === -1) {
        return res.status(404).json({ error: "Aufgabe nicht gefunden" });
    }

    const task = tasks[taskIndex];
    task.comments = Array.isArray(task.comments) ? task.comments : [];

    const commentIndex = task.comments.findIndex(comment => comment.id === req.params.commentId);

    if (commentIndex === -1) {
        return res.status(404).json({ error: "Nachricht nicht gefunden" });
    }

    const comment = task.comments[commentIndex];
    const isOwner = String(comment.userId || "") === String(req.session.user.id || "");
    const canManageTaskChat = canManageAbsencesByRoles(roles);

    if (!isOwner && !canManageTaskChat) {
        return res.status(403).json({ error: "Du kannst nur eigene Nachrichten löschen." });
    }

    deleteCommentAttachmentFiles(req.params.id, comment.attachments);
    removePendingNotificationsForTaskComment(req.params.id, req.params.commentId);

    task.comments.splice(commentIndex, 1);
    task.updatedAt = new Date().toISOString();
    tasks[taskIndex] = task;

    writeTasks(tasks);
    emitTaskUpdated(req.params.id, "comment-deleted");

    res.json({ ok: true });
});

router.delete("/api/tasks/:id", requireAuth, async (req, res) => {
    // Rollen vor dem Lesen laden, damit zwischen Lesen und Schreiben kein await mehr
    // liegt (sonst könnten parallele Änderungen an der Aufgabe überschrieben werden).
    const roles = await refreshSessionRoles(req);
    const tasks = readTasks();
    const taskToDelete = tasks.find(task => task.id === req.params.id);

    if (!taskToDelete) {
        return res.status(404).json({ error: "Aufgabe nicht gefunden" });
    }

    if (!canManageTask(taskToDelete, req.session.user.id, roles)) {
        return res.status(403).json({ error: "Nur Ersteller, Zuständige oder Inhaber dürfen Aufgaben löschen." });
    }

    const filtered = tasks.filter(task => task.id !== req.params.id);

    writeTasks(filtered);

    deleteTaskUploadDirectory(req.params.id);
    removePendingNotificationsForTask(req.params.id);

    res.json({ ok: true });
});

app.use(BASE_PATH, router);

app.use((error, req, res, next) => {
    appendDiagnosticLog({
        type: "server_error",
        level: "error",
        message: error?.message || "Unbekannter Serverfehler",
        route: req?.originalUrl || req?.url || "",
        method: req?.method || "",
        statusCode: 500,
        userId: req?.session?.user?.id || "",
        userName: getRequestUserName(req),
        stack: getErrorStack(error)
    });

    console.error("Serverfehler:", error);

    if (res.headersSent) {
        return next(error);
    }

    res.status(500).json({ error: "Interner Serverfehler" });
});

setupRealtime();

let teamsyncServerDiagnosticHandlersInstalled = false;

if (!teamsyncServerDiagnosticHandlersInstalled) {
    teamsyncServerDiagnosticHandlersInstalled = true;

    process.on("unhandledRejection", error => {
        appendDiagnosticLog({
            type: "process_error",
            level: "error",
            message: "Unhandled Promise Rejection",
            stack: getErrorStack(error)
        });
        console.error("Unhandled Promise Rejection:", error);
    });

    process.on("uncaughtException", error => {
        appendDiagnosticLog({
            type: "process_error",
            level: "error",
            message: "Uncaught Exception",
            stack: getErrorStack(error)
        });
        console.error("Uncaught Exception:", error);
    });
}

httpServer.listen(PORT, HOST, () => {
    console.log(`🌐 Teamboard läuft auf http://${HOST}:${PORT}${BASE_PATH}/`);
    console.log(`🔐 Discord Login: http://${HOST}:${PORT}${BASE_PATH}/login`);
    console.log(`📌 Tasks: http://${HOST}:${PORT}${BASE_PATH}/tasks`);
    console.log(`🗨️ Forum: http://${HOST}:${PORT}${BASE_PATH}/forum`);
    console.log(`🗃️ Aktenarchiv: http://${HOST}:${PORT}${BASE_PATH}/archive`);
    console.log(`🎬 Clips/Beweise: http://${HOST}:${PORT}${BASE_PATH}/clips`);
    console.log(`💬 Livechat: http://${HOST}:${PORT}${BASE_PATH}/livechat`);
    console.log(`👑 Admin-Übersicht: http://${HOST}:${PORT}${BASE_PATH}/admin`);
    console.log(`💬 Live-Chat aktiv über Socket.IO: ${BASE_PATH}/socket.io`);
    console.log(`🗄️  SQL-Datenbank: ${getDatabasePath()}`);
    console.log(`➡️  OAuth Redirect URI: ${CONFIG.redirectUri || `http://SERVER-IP:${PORT}${BASE_PATH}/auth/discord/callback`}`);

    queueDueDateReminders();
    setInterval(queueDueDateReminders, DUE_REMINDER_CHECK_MS);
    processQueuedDms().catch(error => console.error("Queued-DM-Verarbeitung fehlgeschlagen:", error));
    setInterval(() => processQueuedDms().catch(error => console.error("Queued-DM-Verarbeitung fehlgeschlagen:", error)), 60 * 1000);
    readAbsences();
    setInterval(readAbsences, 10 * 60 * 1000);
});
