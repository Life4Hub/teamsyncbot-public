const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");
const path = require("path");
const { readJsonFile, writeJsonFile, getDatabasePath } = require("./dataStore");

function loadConfig() {
  const configPath = path.join(__dirname, "config.json");

  let fileConfig = {};

  if (fs.existsSync(configPath)) {
    fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  }

  return {
    token: process.env.DISCORD_TOKEN || fileConfig.token,
    guildId: process.env.DISCORD_GUILD_ID || fileConfig.guildId,
    taskNotifyChannelId: process.env.TASK_NOTIFY_CHANNEL_ID || fileConfig.taskNotifyChannelId || "1248332849862410391",
    absenceChannelId: process.env.ABSENCE_CHANNEL_ID || fileConfig.absenceChannelId || ""
  };
}

const CONFIG = loadConfig();

let guildMemberFetchPromise = null;
let lastGuildMemberFetchAt = 0;
let nextGuildMemberFetchAllowedAt = 0;
const GUILD_MEMBER_FETCH_MIN_INTERVAL_MS = 15 * 60 * 1000;
const IGNORED_VOICE_CHANNEL_IDS = new Set(["1248546190832832523"]);

function isIgnoredVoiceChannel(channelOrId) {
  const channelId = typeof channelOrId === "string"
    ? channelOrId
    : String(channelOrId?.id || "");

  return IGNORED_VOICE_CHANNEL_IDS.has(channelId);
}

function normalizeVoiceSessionHistory(value) {
  return Array.isArray(value)
    ? value.filter(entry => entry && typeof entry === "object").slice(-500)
    : [];
}

if (!CONFIG.token || CONFIG.token.includes("DEIN_BOT_TOKEN")) {
  console.error("❌ Kein Bot-Token gesetzt. Trage ihn in config.json bei token ein.");
  process.exit(1);
}

if (!CONFIG.guildId || CONFIG.guildId.includes("DEINE_DISCORD_SERVER_ID")) {
  console.error("❌ Keine feste Discord-Server-ID gesetzt. Trage sie in config.json bei guildId ein.");
  process.exit(1);
}

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

const WARN_ROLES = [
  "TEAMWARN Ⅰ",
  "TEAMWARN ⅠⅠ"
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

const RECOGNIZED_ROLE_ORDER = [
  ...TEAM_ROLES,
  ...DEPARTMENTS,
  ...WARN_ROLES
];

const notificationsFile = path.join(__dirname, "task_notifications.json");
const absencesFile = path.join(__dirname, "absences.json");
const voiceActivityFile = path.join(__dirname, "voice_activity.json");
const botStatusFile = path.join(__dirname, "bot_status.json");
const discordOverviewFile = path.join(__dirname, "discord_overview.json");
const discordAuditLogsFile = path.join(__dirname, "discord_audit_logs.json");
const notificationLockFile = path.join(__dirname, "task_notifications.lock");

function taskUrl(notification) {
  return notification.taskUrl || "/Teamboard/tasks";
}

function truncateText(value, maxLength = 1200) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}


function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 0, 0);
}

function setLocalTime(date, hours, minutes = 0) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, 0, 0);
}

function normalizeGermanText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/\s+/g, " ")
    .trim();
}

function getNextWeekday(now, targetDayIndex) {
  const current = now.getDay();
  let diff = (targetDayIndex - current + 7) % 7;

  const date = new Date(now);
  date.setDate(now.getDate() + diff);
  return date;
}

function parseAbsenceEndDate(durationText, referenceDate = new Date()) {
  const raw = String(durationText || "").trim();
  const normalized = normalizeGermanText(raw);

  if (!normalized) {
    return {
      endAt: null,
      parseStatus: "needs_review"
    };
  }

  // Zeitraum mit Trennzeichen ("22.07-10.08", "22.07.2026 - 10.08.2026", "22.07 bis
  // 10.08"): zwei Datumsangaben hintereinander, erste ist der Start, zweite das Ende.
  // Ohne diese Erkennung fand der einzelne Datums-Regex weiter unten nur die ERSTE
  // Datumsangabe und ignorierte den Rest - das eigentliche Enddatum - komplett.
  const rangeMatch = normalized.match(
    /\b(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\s*(?:-|–|bis)\s*(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\b/
  );

  if (rangeMatch) {
    const startDay = Number(rangeMatch[1]);
    const startMonth = Number(rangeMatch[2]);
    const endDay = Number(rangeMatch[4]);
    const endMonth = Number(rangeMatch[5]);

    let startYear = rangeMatch[3] ? Number(rangeMatch[3]) : null;
    let endYear = rangeMatch[6] ? Number(rangeMatch[6]) : null;

    if (startYear !== null && startYear < 100) startYear += 2000;
    if (endYear !== null && endYear < 100) endYear += 2000;

    // Fehlt ein Jahr, erst das jeweils andere Jahr aus dem Bereich übernehmen,
    // sonst das aktuelle Jahr.
    const yearsGiven = Boolean(rangeMatch[3] || rangeMatch[6]);

    if (startYear === null) startYear = endYear ?? referenceDate.getFullYear();
    if (endYear === null) endYear = startYear;

    let start = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
    let end = new Date(endYear, endMonth - 1, endDay, 23, 59, 0, 0);

    // Bereich geht über den Jahreswechsel (z. B. "28.12-05.01") und kein Jahr wurde
    // explizit genannt: Enddatum läge sonst vor dem Startdatum -> ein Jahr weiter.
    if (!yearsGiven && end.getTime() < start.getTime()) {
      end = new Date(endYear + 1, endMonth - 1, endDay, 23, 59, 0, 0);
    }

    // Der ganze Zeitraum liegt (ohne explizite Jahresangabe) bereits in der
    // Vergangenheit - z. B. eine Nachricht im November über "05.01-20.01" meint
    // eindeutig den kommenden Januar, nicht den vergangenen. Ohne diese Prüfung
    // (analog zur Einzeldatum-Logik weiter unten) wäre die Abmeldung sofort als
    // "Abgelaufen" markiert worden, obwohl sie erst noch bevorsteht.
    if (!yearsGiven && end.getTime() < referenceDate.getTime() - 24 * 60 * 60 * 1000) {
      start = new Date(startYear + 1, startMonth - 1, startDay, 0, 0, 0, 0);
      end = new Date(endYear + 1, endMonth - 1, endDay, 23, 59, 0, 0);
    }

    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      return {
        endAt: end.toISOString(),
        startAt: start.toISOString(),
        parseStatus: "parsed"
      };
    }
  }

  const dateMatch = normalized.match(/\b(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\b/);

  if (dateMatch) {
    const day = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    let year = dateMatch[3] ? Number(dateMatch[3]) : referenceDate.getFullYear();

    if (year < 100) {
      year += 2000;
    }

    // Falls zusätzlich zum Datum eine Uhrzeit angegeben ist (z. B. "09.07.2026 18:00",
    // das empfohlene Format aus buildAbsenceFormatHelp), soll diese übernommen werden,
    // statt sie zu ignorieren und immer 23:59 anzusetzen.
    let hours = 23;
    let minutes = 59;
    const clockMatch = normalized.match(/\b(\d{1,2}):(\d{2})\b/) || normalized.match(/\b(\d{1,2})\s*uhr\b/);

    if (clockMatch) {
      const matchedHours = Number(clockMatch[1]);
      const matchedMinutes = clockMatch[2] ? Number(clockMatch[2]) : 0;

      if (matchedHours >= 0 && matchedHours <= 23 && matchedMinutes >= 0 && matchedMinutes <= 59) {
        hours = matchedHours;
        minutes = matchedMinutes;
      }
    }

    let end = new Date(year, month - 1, day, hours, minutes, 0, 0);

    if (!dateMatch[3] && end.getTime() < referenceDate.getTime() - 24 * 60 * 60 * 1000) {
      end = new Date(year + 1, month - 1, day, hours, minutes, 0, 0);
    }

    if (!Number.isNaN(end.getTime())) {
      return {
        endAt: end.toISOString(),
        parseStatus: "parsed"
      };
    }
  }

  const timeMatch = normalized.match(/\b(?:bis\s*)?(\d{1,2})(?:[:.](\d{2})|\s*uhr)?\b/);

  if (
    timeMatch &&
    /(^| )(bis|heute|morgen|abend|abends|uhr)( |$)/.test(normalized) &&
    Number(timeMatch[1]) >= 0 &&
    Number(timeMatch[1]) <= 23
  ) {
    const hours = Number(timeMatch[1]);
    const minutes = timeMatch[2] ? Number(timeMatch[2]) : 0;
    let end = setLocalTime(referenceDate, hours, minutes);

    if (end.getTime() <= referenceDate.getTime()) {
      end.setDate(end.getDate() + 1);
    }

    return {
      endAt: end.toISOString(),
      parseStatus: "parsed"
    };
  }

  const daysMatch = normalized.match(/(?:\b\d{1,3}\s*[-–]\s*)?(\d{1,3})\s*(?:tage|tag|d)\b/);

  if (daysMatch) {
    const days = Number(daysMatch[1]);
    const end = new Date(referenceDate);
    end.setDate(end.getDate() + days);

    return {
      endAt: end.toISOString(),
      parseStatus: "parsed"
    };
  }

  if (/\bmorgen\b/.test(normalized)) {
    const end = new Date(referenceDate);
    end.setDate(referenceDate.getDate() + 1);

    return {
      endAt: normalized.includes("abend")
        ? setLocalTime(end, 20, 0).toISOString()
        : endOfLocalDay(end).toISOString(),
      parseStatus: "parsed"
    };
  }

  if (/\bheute\b/.test(normalized) || /\babend\b/.test(normalized) || /\babends\b/.test(normalized)) {
    const end = normalized.includes("abend") || normalized.includes("abends")
      ? setLocalTime(referenceDate, 20, 0)
      : endOfLocalDay(referenceDate);

    if (end.getTime() <= referenceDate.getTime()) {
      end.setDate(end.getDate() + 1);
    }

    return {
      endAt: end.toISOString(),
      parseStatus: "parsed"
    };
  }

  const weekdayMap = new Map([
    ["sonntag", 0],
    ["montag", 1],
    ["dienstag", 2],
    ["mittwoch", 3],
    ["donnerstag", 4],
    ["freitag", 5],
    ["samstag", 6]
  ]);

  for (const [name, dayIndex] of weekdayMap.entries()) {
    if (normalized.includes(name)) {
      const target = getNextWeekday(referenceDate, dayIndex);
      const end = normalized.includes("abend") || normalized.includes("abends")
        ? setLocalTime(target, 20, 0)
        : endOfLocalDay(target);

      if (end.getTime() <= referenceDate.getTime()) {
        end.setDate(end.getDate() + 7);
      }

      return {
        endAt: end.toISOString(),
        parseStatus: "parsed"
      };
    }
  }

  return {
    endAt: null,
    parseStatus: "needs_review"
  };
}

function extractField(content, fieldName) {
  const lines = String(content || "").split(/\r?\n/);
  const pattern = new RegExp(`^\\s*${fieldName}\\s*:?\\s*(.+)$`, "i");

  for (const line of lines) {
    const match = line.match(pattern);

    if (match) {
      return match[1].trim();
    }
  }

  return "";
}

function buildDiscordMessageUrl(message) {
  return `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
}

function readAbsencesRaw() {
  return readJsonFile(absencesFile, []);
}

function writeAbsences(absences) {
  writeJsonFile(absencesFile, Array.isArray(absences) ? absences : []);
}

// Getrennte "Erledigt"-Merkliste fuer den Abmeldungs-Backfill (siehe
// backfillAbsenceChannel weiter unten): Der Backfill darf eine Nachricht NIE
// wieder aufgreifen, nur weil ihr zugehoeriger Eintrag in absences.json
// zwischenzeitlich geloescht wurde (manuell im Dashboard oder durch die
// automatische 7-Tage-Bereinigung) - sonst wuerde jede geloeschte, aber noch
// junge Abmeldung beim naechsten Bot-Neustart einfach wieder auftauchen.
// Diese Liste wird beim Loeschen NICHT angefasst, nur beim Verarbeiten
// ergaenzt, und regelmaessig um Eintraege bereinigt, die laenger als der
// Backfill jemals zurueckblicken kann.
const absenceProcessedIdsFile = path.join(__dirname, "absence_processed_message_ids.json");
const PROCESSED_ABSENCE_ID_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function readProcessedAbsenceMessageIds() {
  const data = readJsonFile(absenceProcessedIdsFile, {});
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

function markAbsenceMessageProcessed(messageId) {
  const id = String(messageId || "");
  if (!id) return;

  const processed = readProcessedAbsenceMessageIds();
  processed[id] = Date.now();
  writeJsonFile(absenceProcessedIdsFile, processed);
}

function pruneProcessedAbsenceMessageIds() {
  const processed = readProcessedAbsenceMessageIds();
  const cutoff = Date.now() - PROCESSED_ABSENCE_ID_RETENTION_MS;
  let changed = false;
  const pruned = {};

  for (const [id, processedAt] of Object.entries(processed)) {
    if (Number(processedAt) > cutoff) {
      pruned[id] = processedAt;
    } else {
      changed = true;
    }
  }

  if (changed) {
    writeJsonFile(absenceProcessedIdsFile, pruned);
  }
}

function isKnownTeamMemberForAbsence(userId) {
  const id = String(userId || "");
  if (!id) return false;

  const teamRows = readJsonFile(path.join(__dirname, "team.json"), []);
  return Array.isArray(teamRows) && teamRows.some(member => String(member.id || "") === id);
}

function getAbsenceValidationProblem(row) {
  if (!row.userId) {
    return "Benutzer konnte nicht erkannt werden.";
  }

  if (!isKnownTeamMemberForAbsence(row.userId)) {
    return "Benutzer ist aktuell nicht als Teammitglied im Teamboard bekannt.";
  }

  if (!row.endAt) {
    return "Zeit/Dauer konnte nicht erkannt werden.";
  }

  return "";
}

function buildAbsenceFormatHelp(problem = "") {
  return [
    problem ? `⚠️ Deine Abmeldung konnte nicht automatisch geprüft werden: **${problem}**` : "⚠️ Deine Abmeldung konnte nicht automatisch geprüft werden.",
    "",
    "Bitte nutze dieses Format:",
    "```",
    "Abmeldung",
    "Bis: 09.07.2026 18:00",
    "Grund: kurzer Grund",
    "```",
    "Meldest du dich für einen längeren Zeitraum ab, gib Start- UND Enddatum durch einen Bindestrich getrennt an:",
    "```",
    "Abmeldung",
    "Dauer: 22.07-10.08",
    "Grund: kurzer Grund",
    "```",
    "Das erkennt auch Jahreszahlen (`22.07.2026-10.08.2026`) und das Wort „bis“ statt Bindestrich (`22.07 bis 10.08`).",
    "Alternativ geht z. B. auch: `Bis: morgen`, `Bis: Sonntag Abend`, `Dauer: 3 Tage`.",
    "Wenn du jemand anderen abmeldest, markiere die Person zusätzlich mit @Name."
  ].join("\n");
}

async function sendAbsenceFormatHelp(message, problem = "") {
  try {
    await message.channel.send({
      content: buildAbsenceFormatHelp(problem),
      allowedMentions: { parse: [] }
    });
  } catch (error) {
    console.error("Abmeldungs-Hinweis konnte nicht gesendet werden:", error);
  }
}


// Gleiche Karenzzeit wie server.js (ABSENCE_CLEANUP_GRACE_MS): Dieser Bot und
// das Dashboard räumen unabhängig voneinander alle 10 Minuten dieselbe
// absences.json auf. Vorher wurde sofort bei Ablauf gelöscht, wodurch der
// "Abgelaufen"-Status und die Kalender-Historie im Dashboard (public/
// absences.js) praktisch nie sichtbar wurden, bevor die Abmeldung schon
// wieder verschwunden war. 7 Tage auf Wunsch, damit abgelaufene Abmeldungen
// eine Weile sichtbar bleiben, aber nicht dauerhaft anwachsen.
const ABSENCE_CLEANUP_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

function cleanupExpiredAbsences() {
  // Laeuft ohnehin alle 10 Minuten - guter, regelmaessiger Zeitpunkt, um die
  // Backfill-Merkliste (siehe markAbsenceMessageProcessed) von laengst irrelevanten
  // Eintraegen zu befreien, statt das nur beim (seltenen) Bot-Neustart zu tun.
  pruneProcessedAbsenceMessageIds();

  const absences = readAbsencesRaw();
  const now = Date.now();
  const removedIds = [];

  const active = absences.filter(absence => {
    if (absence.status !== "Aktiv" || !absence.endAt) return true;

    const endTime = new Date(absence.endAt).getTime();
    const expired = !Number.isNaN(endTime) && endTime <= now - ABSENCE_CLEANUP_GRACE_MS;

    if (expired) removedIds.push(String(absence.id || ""));

    return !expired;
  });

  if (active.length !== absences.length) {
    // Server.js (Dashboard) räumt dieselbe absences.json unabhängig davon ebenfalls auf
    // und kann zwischen dem Lesen oben und hier eine Aktion (Annehmen/Ablehnen/Bearbeiten)
    // gespeichert haben. Deshalb kurz vor dem Schreiben frisch neu laden und nur die hier
    // ermittelten, längst abgelaufenen IDs entfernen statt die ganze Liste zu ersetzen.
    const removedIdSet = new Set(removedIds);
    const fresh = readAbsencesRaw();
    const freshFiltered = fresh.filter(absence => !removedIdSet.has(String(absence.id || "")));

    writeAbsences(freshFiltered);
  }
}

// Der Bot verarbeitete bisher AUSSCHLIESSLICH live eingehende messageCreate-Events.
// Jede Abmeldung, die gepostet wurde, während der Bot offline/am Neustarten war (siehe
// start.js: der Bot kann unabhängig vom Dashboard abstürzen und neu starten), wurde nie
// erfasst - sie tauchte im Dashboard nie auf, ohne dass irgendjemand einen Fehler sah.
// Fix: beim Start die letzten Nachrichten im Abmeldungs-Channel nachträglich einlesen und
// alle, die noch nicht in absences.json stehen, wie eine frisch eingegangene Nachricht
// verarbeiten (inkl. Format-Hinweis/Reaktion, falls nötig).
//
// WICHTIG: Nur Nachrichten nachtragen, die maximal ABSENCE_BACKFILL_MAX_AGE_MS alt sind.
// Ohne dieses Zeitlimit hat "die letzten 100 Nachrichten des Kanals" beim ersten echten
// Einsatz die komplette, teils Jahre alte Kanalgeschichte nachverarbeitet (der Kanal hatte
// schlicht nie annähernd 100 Nachrichten in kurzer Zeit) und dabei den Chat mit Reaktionen/
// Format-Hinweisen auf uralte Nachrichten zugespammt. Jetzt: nur Nachrichten aus dem
// gewünschten Zeitfenster (Standard 2 Tage) werden überhaupt angefasst, alles Ältere wird
// ignoriert, ohne Reaktion, ohne Format-Hinweis, ohne Eintrag.
const ABSENCE_BACKFILL_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;
const ABSENCE_BACKFILL_MAX_PAGES = 10; // Sicherheitsgrenze: max. 1000 Nachrichten pruefen

async function backfillAbsenceChannel(guild) {
  if (!CONFIG.absenceChannelId) return;

  try {
    const channel = await guild.channels.fetch(CONFIG.absenceChannelId).catch(() => null);

    if (!channel || !channel.isTextBased()) {
      console.error(`Abmeldungs-Channel ${CONFIG.absenceChannelId} nicht gefunden oder kein Textkanal - Backfill übersprungen.`);
      return;
    }

    // Wichtig: Nicht nur aktuell in absences.json vorhandene IDs zählen, sondern auch die
    // dauerhafte Merkliste - sonst würde eine manuell gelöschte oder automatisch (siehe
    // ABSENCE_CLEANUP_GRACE_MS) bereinigte, aber noch junge Abmeldung beim nächsten
    // Neustart aus dem Kanalverlauf einfach wieder aufgegriffen.
    const existingIds = new Set(
      readAbsencesRaw().map(absence => String(absence.messageId || absence.id || ""))
    );
    const processedIds = readProcessedAbsenceMessageIds();

    for (const id of Object.keys(processedIds)) {
      existingIds.add(id);
    }

    pruneProcessedAbsenceMessageIds();

    const cutoff = Date.now() - ABSENCE_BACKFILL_MAX_AGE_MS;
    const withinWindow = [];
    let before;
    let reachedCutoff = false;

    // Seitenweise (je 100) von den neuesten Nachrichten rückwärts blättern, bis entweder
    // eine Seite komplett vor dem Zeitfenster liegt, der Kanal keine Nachrichten mehr hat,
    // oder die Sicherheitsgrenze erreicht ist. So werden auch >100 Nachrichten innerhalb
    // des Zeitfensters erfasst, ohne jemals in die alte Kanalgeschichte vorzudringen.
    for (let page = 0; page < ABSENCE_BACKFILL_MAX_PAGES && !reachedCutoff; page++) {
      const fetched = await channel.messages.fetch({ limit: 100, before }).catch(error => {
        console.error("Abmeldungs-Channel-Backfill: Seite konnte nicht geladen werden:", error);
        return null;
      });

      if (!fetched || fetched.size === 0) break;

      for (const message of fetched.values()) {
        if (message.createdTimestamp < cutoff) {
          reachedCutoff = true;
          continue;
        }

        withinWindow.push(message);
      }

      before = [...fetched.values()].pop()?.id;
      if (!before) break;
    }

    const missing = withinWindow
      .filter(message => !message.author?.bot && !existingIds.has(String(message.id)))
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    if (!missing.length) return;

    console.log(`🗓️  Trage ${missing.length} während der Bot-Downtime verpasste Abmeldungs-Nachricht(en) der letzten ${Math.round(ABSENCE_BACKFILL_MAX_AGE_MS / 86400000)} Tage nach.`);

    for (const message of missing) {
      try {
        await handleAbsenceMessage(message);
      } catch (error) {
        // Fallback pro Nachricht: Eine einzelne fehlerhafte/unerwartete Nachricht (z.B.
        // fehlender Autor, gelöschter Channel-Kontext) darf den restlichen Backfill nicht
        // abbrechen.
        console.error(`Abmeldungs-Backfill: Nachricht ${message.id} konnte nicht verarbeitet werden:`, error);
      }
    }
  } catch (error) {
    console.error("Abmeldungs-Channel-Backfill fehlgeschlagen:", error);
  }
}

// Die Live-messageCreate-Listener sind schon aktiv, bevor backfillAbsenceChannel() beim
// Start fertig ist - eine Nachricht, die genau während des Backfills neu eingeht, kann
// dadurch gleichzeitig vom Live-Handler UND vom Backfill aufgegriffen werden. Beide
// Aufrufe würden dieselbe Discord-Nachricht parallel verarbeiten (doppelte Reaktion,
// doppelter Format-Hinweis, zwei sich überschreibende Schreibvorgänge) - genau das vom
// Nutzer beobachtete "manchmal doppelt erkannt" bei Nachrichten rund um einen Neustart.
// Dieses Set sorgt dafür, dass eine Nachricht immer nur von EINEM der beiden Aufrufer
// gleichzeitig bearbeitet wird.
const absenceMessagesBeingProcessed = new Set();

async function handleAbsenceMessage(message) {
  const messageId = String(message?.id || "");

  if (messageId && absenceMessagesBeingProcessed.has(messageId)) {
    return;
  }

  if (messageId) absenceMessagesBeingProcessed.add(messageId);

  try {
    await handleAbsenceMessageOnce(message);
  } finally {
    if (messageId) absenceMessagesBeingProcessed.delete(messageId);
  }
}

async function handleAbsenceMessageOnce(message) {
  const content = String(message.content || "").trim();

  if (!content) return;

  const targetMember = message.mentions.members.first() || message.member;
  const targetUser = targetMember?.user || message.mentions.users.first() || message.author;

  // extractField() entfernt das Feld-Präfix ("Bis:"). Für reine Uhrzeit-Angaben wie
  // "Bis: 22:30" bzw. "bis 22:30" wird das Wort "bis" dabei mitentfernt, obwohl
  // parseAbsenceEndDate() genau dieses Schlüsselwort braucht, um eine bloße Uhrzeit
  // (ohne "Uhr"/Datum) als gültige Zeitangabe zu erkennen. Daher hier wieder voranstellen.
  const bisField = extractField(content, "Bis");
  const durationText =
    extractField(content, "Dauer") ||
    (bisField ? `bis ${bisField}` : "") ||
    content;

  const reason =
    extractField(content, "Grund") ||
    extractField(content, "Reason") ||
    "";

  const parsed = parseAbsenceEndDate(durationText, message.createdAt || new Date());

  const row = {
    id: message.id,
    userId: String(targetUser.id),
    userName: targetMember?.displayName || targetUser.globalName || targetUser.username || targetUser.id,
    durationText,
    reason,
    // Bei einem erkannten Zeitraum ("22.07-10.08") liefert parseAbsenceEndDate ein
    // explizites startAt (den Beginn des Zeitraums) - sonst wie bisher der Zeitpunkt,
    // zu dem die Nachricht gepostet wurde.
    startAt: parsed.startAt || (message.createdAt || new Date()).toISOString(),
    endAt: parsed.endAt,
    // Neue Abmeldungen sind immer erst beantragt. Aktiv wird es erst nach Admin-Freigabe.
    status: parsed.endAt ? "Beantragt" : "Unklar",
    parseStatus: parsed.endAt ? "pending_review" : parsed.parseStatus,
    messageId: String(message.id),
    channelId: String(message.channelId),
    guildId: String(message.guildId),
    messageUrl: buildDiscordMessageUrl(message),
    originalContent: content,
    createdById: String(message.author.id),
    createdByName: message.member?.displayName || message.author.globalName || message.author.username || message.author.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const problem = getAbsenceValidationProblem(row);

  if (problem) {
    row.status = "Unklar";
    row.parseStatus = "needs_review";
    await sendAbsenceFormatHelp(message, problem);
  }

  const absences = readAbsencesRaw()
    .filter(absence => String(absence.messageId || absence.id) !== String(message.id));

  absences.push(row);
  writeAbsences(absences);

  // Diese Nachricht gilt ab jetzt dauerhaft als bearbeitet - auch wenn der Eintrag
  // später manuell oder durch die automatische Bereinigung wieder gelöscht wird. Sonst
  // würde backfillAbsenceChannel() eine gelöschte, aber noch junge Abmeldung beim
  // nächsten Bot-Neustart einfach wieder aus dem Kanal nachtragen.
  markAbsenceMessageProcessed(message.id);

  try {
    await message.react(problem ? "⚠️" : "⏳");
  } catch (error) {
    console.error("Abmeldungs-Reaktion konnte nicht gesetzt werden:", error);
  }

  console.log(`🗓️ Abmeldung gespeichert: ${row.userName} -> ${row.endAt || "unklar"} (${row.status})`);
}

function formatTaskNotification(notification) {
  const isAssignedLater = notification.type === "task-assigned";
  const isTaskComment = notification.type === "task-comment";
  const isDueSoon = notification.type === "task-due-soon";
  const isMention = notification.type === "mention";

  if (isMention) {
    const lines = [
      `🔔 **${notification.commentBy || "Jemand"}** hat dich${notification.mentionContext ? ` in ${notification.mentionContext}` : ""} erwähnt`
    ];

    if (notification.commentMessage) {
      lines.push(`💬 Nachricht: ${truncateText(notification.commentMessage)}`);
    }

    if (notification.mentionUrl) {
      lines.push(`🔗 Öffnen: ${notification.mentionUrl}`);
    }

    return lines.join("\n");
  }

  if (isTaskComment) {
    const lines = [
      `💬 Neue Nachricht in Aufgabe: **${notification.title}**`,
      `⚠️ Priorität: ${notification.priority || "Mittel"}`,
      `🧩 Abteilung: ${notification.department || "Allgemein"}`,
      `👤 Von: ${notification.commentBy || "Unbekannt"}`
    ];

    if (notification.commentMessage) {
      lines.push(`💬 Nachricht: ${truncateText(notification.commentMessage)}`);
    }

    if (Number(notification.attachmentCount || 0) > 0) {
      const attachmentNames = Array.isArray(notification.attachmentNames)
        ? notification.attachmentNames.filter(Boolean).slice(0, 5).join(", ")
        : "";

      lines.push(`📎 Anhänge: ${notification.attachmentCount}${attachmentNames ? ` (${attachmentNames})` : ""}`);
    }

    lines.push(`🔗 Aufgabe öffnen: ${taskUrl(notification)}`);
    return lines.join("\n");
  }

  if (isDueSoon) {
    const dueText = notification.dueDate
      ? new Date(notification.dueDate).toLocaleString("de-DE")
      : "bald";

    const lines = [
      `⏰ Aufgabe bald fällig: **${notification.title}**`,
      `📅 Fällig: ${dueText}`,
      `⚠️ Priorität: ${notification.priority || "Mittel"}`,
      `🧩 Abteilung: ${notification.department || "Allgemein"}`
    ];

    lines.push(`🔗 Aufgabe öffnen: ${taskUrl(notification)}`);

    return lines.join("\n");
  }

  const lines = [
    isAssignedLater
      ? `📌 Du wurdest einer Aufgabe zugewiesen: **${notification.title}**`
      : `📌 Neue Aufgabe für dich: **${notification.title}**`,
    `⚠️ Priorität: ${notification.priority || "Mittel"}`,
    `🧩 Abteilung: ${notification.department || "Allgemein"}`,
    isAssignedLater
      ? `👤 Zugewiesen von: ${notification.assignedBy || notification.createdBy || "Unbekannt"}`
      : `👤 Erstellt von: ${notification.createdBy || "Unbekannt"}`
  ];

  if (notification.description) {
    lines.push(`📝 Beschreibung: ${notification.description}`);
  }

  if (notification.dueDate) {
    lines.push(`📅 Fällig: ${new Date(notification.dueDate).toLocaleString("de-DE")}`);
  }

  lines.push(`🔗 Aufgaben öffnen: ${taskUrl(notification)}`);

  return lines.join("\n");
}

function formatTaskChannelBatchNotification(notifications) {
  const first = notifications[0] || {};
  const isAssignedLater = first.type === "task-assigned";
  const isTaskComment = first.type === "task-comment";
  const mentions = [...new Set(notifications.map(item => String(item.assigneeId || "")).filter(Boolean))]
    .map(id => `<@${id}>`)
    .join(", ");

  const dueLine = first.dueDate
    ? `\n📅 Fällig: ${new Date(first.dueDate).toLocaleString("de-DE")}`
    : "";

  if (isTaskComment) {
    return `💬 Neue Nachricht in Aufgabe für ${mentions}: **${first.title}**
⚠️ Priorität: ${first.priority || "Mittel"}
🧩 Abteilung: ${first.department || "Allgemein"}
👤 Von: ${first.commentBy || "Unbekannt"}
💬 Nachricht: ${truncateText(first.commentMessage || "")}
🔗 ${taskUrl(first)}`;
  }

  if (first.type === "task-due-soon") {
    return `⏰ Aufgabe bald fällig für ${mentions}: **${first.title}**
⚠️ Priorität: ${first.priority || "Mittel"}
🧩 Abteilung: ${first.department || "Allgemein"}${dueLine}
🔗 ${taskUrl(first)}`;
  }

  if (isAssignedLater) {
    return `📌 ${mentions} wurde(n) einer Aufgabe zugewiesen: **${first.title}**
⚠️ Priorität: ${first.priority || "Mittel"}
🧩 Abteilung: ${first.department || "Allgemein"}${dueLine}
👤 Zugewiesen von: ${first.assignedBy || first.createdBy || "Unbekannt"}
🔗 ${taskUrl(first)}`;
  }

  return `📌 Neue Aufgabe für ${mentions}: **${first.title}**
⚠️ Priorität: ${first.priority || "Mittel"}
🧩 Abteilung: ${first.department || "Allgemein"}${dueLine}
👤 Erstellt von: ${first.createdBy || "Unbekannt"}
🔗 ${taskUrl(first)}`;
}

function acquireNotificationLock() {
  try {
    if (fs.existsSync(notificationLockFile)) {
      const stats = fs.statSync(notificationLockFile);
      const ageMs = Date.now() - stats.mtimeMs;

      if (ageMs > 60 * 1000) {
        fs.unlinkSync(notificationLockFile);
      }
    }

    const fd = fs.openSync(notificationLockFile, "wx");
    fs.writeFileSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

function releaseNotificationLock() {
  try {
    if (fs.existsSync(notificationLockFile)) {
      fs.unlinkSync(notificationLockFile);
    }
  } catch {}
}

async function processTaskNotifications(client) {
  if (!acquireNotificationLock()) return;

  try {
    const notifications = readJsonFile(notificationsFile, []);
    let changed = false;

    const seenPendingKeys = new Set();

    for (const notification of notifications) {
      if (notification.status !== "pending") continue;

      const key = [
        notification.type || "task-created",
        notification.taskId,
        notification.assigneeId,
        notification.dedupeId || ""
      ].join(":");

      if (seenPendingKeys.has(key)) {
        notification.status = "skipped";
        notification.error = "Doppelte Benachrichtigung übersprungen.";
        notification.skippedAt = new Date().toISOString();
        changed = true;
        continue;
      }

      seenPendingKeys.add(key);
    }

    const pending = notifications.filter(notification => notification.status === "pending");
    const channelGroups = new Map();

    for (const notification of pending) {
      notification.attempts = Number(notification.attempts || 0) + 1;
      notification.lastAttemptAt = new Date().toISOString();

      try {
        const assigneeId = String(notification.assigneeId || "");
        if (!assigneeId) {
          notification.status = "skipped";
          notification.error = "Keine Discord-ID für Zuständigkeit vorhanden.";
          changed = true;
          continue;
        }

        if (!notification.dmSentAt) {
          const user = await client.users.fetch(assigneeId).catch(() => null);
          if (user) {
            await user.send(formatTaskNotification(notification)).catch(error => {
              console.error(`DM an ${assigneeId} konnte nicht gesendet werden:`, error.message);
            });
          }

          notification.dmSentAt = new Date().toISOString();
        }

        const configuredChannelId = notification.channelId === undefined
          ? CONFIG.taskNotifyChannelId
          : notification.channelId;

        // Chatnachrichten und @-Erwähnungen sollen NUR per DM rausgehen, nicht in den Discord-Channel.
        // Auch wenn channelId leer ist, wird bewusst kein Fallback auf den Standard-Channel genutzt.
        if (notification.type === "task-comment" || notification.type === "mention" || !String(configuredChannelId || "")) {
          notification.status = "sent";
          notification.sentAt = new Date().toISOString();
          changed = true;
          continue;
        }

        notification._channelId = String(configuredChannelId);

        const groupKey = notification.batchId || [
          notification.type || "task-created",
          notification.taskId,
          notification.createdAt || "legacy"
        ].join(":");

        if (!channelGroups.has(groupKey)) {
          channelGroups.set(groupKey, []);
        }

        channelGroups.get(groupKey).push(notification);
        changed = true;
      } catch (error) {
        notification.error = error.message;
        console.error("Task-Benachrichtigung fehlgeschlagen:", error);

        if (notification.attempts >= 5) {
          notification.status = "failed";
        }

        changed = true;
      }
    }

    for (const group of channelGroups.values()) {
      const channelId = String(group[0]?._channelId || group[0]?.channelId || "");

      try {
        if (channelId && !group.every(notification => notification.channelSentAt)) {
          const channel = await client.channels.fetch(channelId).catch(() => null);

          if (channel && typeof channel.isTextBased === "function" && channel.isTextBased()) {
            await channel.send({
              content: formatTaskChannelBatchNotification(group)
            });

            const channelSentAt = new Date().toISOString();
            for (const notification of group) {
              notification.channelSentAt = channelSentAt;
            }
          } else {
            // Nicht nur loggen: Wenn wir hier durchfallen, würde der Code unten die
            // Benachrichtigung fälschlich als "sent" markieren, obwohl nie etwas im
            // Channel gepostet wurde. Stattdessen wie ein Fehler behandeln (Retry/failed
            // nach 5 Versuchen), siehe catch-Block unten.
            throw new Error(`Task-Notify-Channel ${channelId} wurde nicht gefunden oder ist kein Textkanal.`);
          }
        }

        const sentAt = new Date().toISOString();
        for (const notification of group) {
          notification.status = "sent";
          notification.sentAt = sentAt;
        }

        changed = true;
      } catch (error) {
        for (const notification of group) {
          notification.error = error.message;

          if (notification.attempts >= 5) {
            notification.status = "failed";
          }
        }

        console.error("Task-Channel-Benachrichtigung fehlgeschlagen:", error);
        changed = true;
      }
    }

    if (changed) {
      // Nicht blind überschreiben: Zwischen dem Einlesen oben und hier können (über mehrere
      // Discord-API-Aufrufe hinweg vergehen durchaus ein paar Sekunden) vom Dashboard
      // (server.js) neue Benachrichtigungen hinzugekommen oder entfernt worden sein, z. B. weil
      // eine neue Aufgabe zugewiesen oder eine Kommentar-Benachrichtigung storniert wurde. Daher
      // aktuellen Stand erneut laden und nur die hier tatsächlich bearbeiteten Einträge (per id)
      // aktualisieren, statt das gesamte Array zu überschreiben und solche Änderungen zu verlieren.
      const currentNotifications = readJsonFile(notificationsFile, []);
      const processedById = new Map(
        notifications
          .filter(notification => notification.id)
          .map(notification => [String(notification.id), notification])
      );

      const merged = currentNotifications.map(notification => {
        const processed = notification.id ? processedById.get(String(notification.id)) : null;
        return processed || notification;
      });

      writeJsonFile(notificationsFile, merged);
    }
  } finally {
    releaseNotificationLock();
  }
}


function normalizeRoleNameForMatch(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[Ⅰ]/g, "I")
    .replace(/[Ⅱ]/g, "II")
    .replace(/[|]/g, "|")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

const ROLE_MATCH_ALIASES = new Map([
  [normalizeRoleNameForMatch("Trail Support | 4Life"), [
    normalizeRoleNameForMatch("Trial Support | 4Life"),
    normalizeRoleNameForMatch("Trial Support|4Life"),
    normalizeRoleNameForMatch("Trail Support|4Life")
  ]],
  [normalizeRoleNameForMatch("Frakverwaltung Leitung| 4Life"), [
    normalizeRoleNameForMatch("Frakverwaltung Leitung | 4Life"),
    normalizeRoleNameForMatch("Frakverwaltung Leitung |4Life"),
    normalizeRoleNameForMatch("Frakverwaltung Leitung|4Life")
  ]],
  [normalizeRoleNameForMatch("TEAMWARN Ⅰ"), [
    normalizeRoleNameForMatch("TEAMWARN I"),
    normalizeRoleNameForMatch("TEAMWARN 1")
  ]],
  [normalizeRoleNameForMatch("TEAMWARN ⅠⅠ"), [
    normalizeRoleNameForMatch("TEAMWARN II"),
    normalizeRoleNameForMatch("TEAMWARN 2")
  ]]
]);

function getRoleMatchKeys(roleName) {
  const primary = normalizeRoleNameForMatch(roleName);
  const aliases = ROLE_MATCH_ALIASES.get(primary) || [];

  return new Set([primary, ...aliases]);
}

const RECOGNIZED_ROLE_MATCH_KEYS = new Set(
  RECOGNIZED_ROLE_ORDER.flatMap(roleName => [...getRoleMatchKeys(roleName)])
);

// Nutzt denselben alias-/normalisierungs-basierten Abgleich wie buildTeamRow/getOrderedRoleNames.
// Ein reiner String-Vergleich (role.name === RECOGNIZED_ROLE_ORDER-Eintrag) würde Rollen mit
// bekannten Schreibvarianten (siehe ROLE_MATCH_ALIASES, z. B. "Trial" statt "Trail") verpassen,
// obwohl genau dafür die Aliase existieren.
function memberHasRecognizedRole(member) {
  return member.roles.cache.some(role => RECOGNIZED_ROLE_MATCH_KEYS.has(normalizeRoleNameForMatch(role.name)));
}


function getOrderedRoleNames(member, allowedRoles) {
  const memberRoles = member.roles.cache.map(role => ({
    name: role.name,
    key: normalizeRoleNameForMatch(role.name)
  }));

  return allowedRoles.flatMap(roleName => {
    const allowedKeys = getRoleMatchKeys(roleName);
    const foundRole = memberRoles.find(role => allowedKeys.has(role.key));

    return foundRole ? [foundRole.name] : [];
  });
}

function buildTeamRow(member) {
  const rankRoles = getOrderedRoleNames(member, TEAM_ROLES);
  const departmentRoles = getOrderedRoleNames(member, DEPARTMENTS);
  const warnRoles = getOrderedRoleNames(member, WARN_ROLES);
  const recognizedRoles = getOrderedRoleNames(member, RECOGNIZED_ROLE_ORDER);
  const allRoles = member.roles.cache
    .filter(role => role.name !== "@everyone")
    .map(role => role.name)
    .sort((a, b) => a.localeCompare(b, "de", { sensitivity: "base" }));

  return {
    name: member.displayName,
    username: member.user.username,
    id: member.user.id,
    avatar: member.user.displayAvatarURL({
      extension: "png",
      size: 128
    }),
    rank: rankRoles[0] || "Kein Rang",
    department: departmentRoles[0] || "Keine Abteilung",
    status: member.presence?.status || "offline",
    warn: warnRoles[0] || "Keine",
    ranks: rankRoles,
    departments: departmentRoles,
    warns: warnRoles,
    allRoles,
    recognizedRoles: recognizedRoles
  };
}

async function saveTeam(rows) {
  writeJsonFile(path.join(__dirname, "team.json"), rows);

  console.log("✅ Teamdaten in SQL gespeichert");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ]
});


function writeBotStatus(status = {}) {
  try {
    writeJsonFile(botStatusFile, {
      online: Boolean(client?.isReady?.()),
      userTag: client?.user?.tag || "",
      userId: client?.user?.id || "",
      guildId: CONFIG.guildId,
      processPid: process.pid,
      uptimeSeconds: Math.floor(process.uptime()),
      ...status,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Bot-Status konnte nicht geschrieben werden:", error);
  }
}

function readVoiceActivity() {
  const data = readJsonFile(voiceActivityFile, { users: {}, updatedAt: null });
  return data && typeof data === "object" ? data : { users: {}, updatedAt: null };
}

function writeVoiceActivity(data) {
  writeJsonFile(voiceActivityFile, {
    users: data.users || {},
    updatedAt: new Date().toISOString()
  });
}

function ensureVoiceUser(store, member) {
  const userId = String(member?.id || member?.user?.id || "");
  if (!userId) return null;

  if (!store.users) store.users = {};

  const existing = store.users[userId] || {};
  store.users[userId] = {
    userId,
    userName: member?.displayName || member?.user?.globalName || member?.user?.username || existing.userName || userId,
    totalMs: Number(existing.totalMs || 0),
    sessions: Number(existing.sessions || 0),
    active: existing.active || null,
    lastJoinedAt: existing.lastJoinedAt || null,
    lastLeftAt: existing.lastLeftAt || null,
    sessionHistory: normalizeVoiceSessionHistory(existing.sessionHistory),
    manualAdjustments: Array.isArray(existing.manualAdjustments) ? existing.manualAdjustments : []
  };

  return store.users[userId];
}

function closeVoiceSession(store, member, leftAt = new Date()) {
  const user = ensureVoiceUser(store, member);
  if (!user || !user.active?.joinedAt) return false;

  const joined = new Date(user.active.joinedAt).getTime();
  const left = leftAt.getTime();

  // Ignorierte Channels werden nicht gezählt. Falls aus alten Daten noch eine aktive
  // Session in so einem Channel existiert, wird sie sauber geschlossen, aber ohne Zeitgutschrift.
  if (!isIgnoredVoiceChannel(user.active.channelId) && !Number.isNaN(joined) && !Number.isNaN(left) && left >= joined) {
    const durationMs = left - joined;
    user.totalMs = Number(user.totalMs || 0) + durationMs;
    user.sessionHistory = normalizeVoiceSessionHistory([
      ...(Array.isArray(user.sessionHistory) ? user.sessionHistory : []),
      {
        channelId: String(user.active.channelId || ""),
        channelName: String(user.active.channelName || "Voice"),
        joinedAt: user.active.joinedAt,
        leftAt: leftAt.toISOString(),
        durationMs
      }
    ]);
  }

  user.lastLeftAt = leftAt.toISOString();
  user.active = null;

  return true;
}

function openVoiceSession(store, member, channel, joinedAt = new Date()) {
  const user = ensureVoiceUser(store, member);
  if (!user || !channel) return false;

  if (isIgnoredVoiceChannel(channel)) {
    user.active = null;
    return false;
  }

  user.sessions = Number(user.sessions || 0) + 1;
  user.lastJoinedAt = joinedAt.toISOString();
  user.active = {
    channelId: String(channel.id || ""),
    channelName: String(channel.name || "Voice"),
    joinedAt: joinedAt.toISOString()
  };

  return true;
}


function getRetryAfterMs(error) {
  const retryAfter = Number(
    error?.retry_after ??
    error?.data?.retry_after ??
    error?.rawError?.retry_after ??
    error?.requestBody?.retry_after ??
    0
  );

  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.ceil(retryAfter * 1000);
  }

  const message = String(error?.message || "");
  const match = message.match(/Retry after\s+([\d.]+)\s+seconds/i);

  if (match) {
    return Math.ceil(Number(match[1]) * 1000);
  }

  return 60 * 1000;
}

function isDiscordRateLimitError(error) {
  return Number(error?.code || error?.status || 0) === 429 ||
    Number(error?.data?.opcode || 0) === 8 ||
    String(error?.message || "").toLowerCase().includes("rate limited");
}

async function safeFetchGuildMembers(guild, reason = "member-cache") {
  const now = Date.now();

  if (guildMemberFetchPromise) {
    return guildMemberFetchPromise;
  }

  if (now < nextGuildMemberFetchAllowedAt) {
    const seconds = Math.ceil((nextGuildMemberFetchAllowedAt - now) / 1000);
    console.log(`⏳ Discord Member-Fetch übersprungen (${reason}). Rate-Limit-Cooldown noch ${seconds}s.`);
    return false;
  }

  if (lastGuildMemberFetchAt && now - lastGuildMemberFetchAt < GUILD_MEMBER_FETCH_MIN_INTERVAL_MS) {
    return false;
  }

  guildMemberFetchPromise = guild.members.fetch()
    .then(() => {
      lastGuildMemberFetchAt = Date.now();
      nextGuildMemberFetchAllowedAt = 0;
      return true;
    })
    .catch(error => {
      if (isDiscordRateLimitError(error)) {
        const retryAfterMs = getRetryAfterMs(error);
        nextGuildMemberFetchAllowedAt = Date.now() + retryAfterMs + 5000;
        console.warn(`⚠️ Discord Member-Fetch rate limited (${reason}). Nächster Versuch in ${Math.ceil(retryAfterMs / 1000)}s.`);
        writeBotStatus({
          warning: `Member-Fetch rate limited. Nächster Versuch in ${Math.ceil(retryAfterMs / 1000)}s.`,
          error: ""
        });
        return false;
      }

      console.error("Discord Member-Fetch fehlgeschlagen:", error);
      writeBotStatus({ error: error.message || String(error) });
      return false;
    })
    .finally(() => {
      guildMemberFetchPromise = null;
    });

  return guildMemberFetchPromise;
}


async function initializeVoiceTracking(guild) {
  try {
    const store = readVoiceActivity();
    const now = new Date();

    // Kein guild.members.fetch() hier: das kann auf großen Servern schnell Gateway OP 8 rate-limits auslösen.
    // Wir nutzen den vorhandenen Cache und die kommenden voiceStateUpdate-Events für Echtzeitdaten.
    guild.members.cache.forEach(member => {
      if (member.voice?.channel && !isIgnoredVoiceChannel(member.voice.channel)) {
        const user = ensureVoiceUser(store, member);

        if (!user.active) {
          openVoiceSession(store, member, member.voice.channel, now);
        }
      }
    });

    writeVoiceActivity(store);
  } catch (error) {
    console.error("Voice-Tracking konnte nicht initialisiert werden:", error);
  }
}

client.on("voiceStateUpdate", (oldState, newState) => {
  try {
    const oldChannelId = oldState.channelId || "";
    const newChannelId = newState.channelId || "";

    if (oldChannelId === newChannelId) return;

    const member = newState.member || oldState.member;
    if (!member) return;

    const store = readVoiceActivity();
    const now = new Date();

    if (oldState.channel) {
      closeVoiceSession(store, member, now);
    }

    if (newState.channel) {
      openVoiceSession(store, member, newState.channel, now);
    }

    writeVoiceActivity(store);
  } catch (error) {
    console.error("Voice-Tracking Fehler:", error);
    writeBotStatus({ error: error.message || String(error) });
  }
});


client.once("clientReady", async () => {
  console.log(`✅ Eingeloggt als ${client.user.tag}`);
  console.log(`🗄️  SQL-Datenbank: ${getDatabasePath()}`);

  const guild = await client.guilds.fetch(CONFIG.guildId).catch(() => null);

  if (!guild) {
    console.error(`❌ Discord-Server mit Guild-ID ${CONFIG.guildId} nicht gefunden. Ist der Bot auf diesem Server eingeladen?`);
    return;
  }

  console.log(`✅ Verbunden mit Discord-Server: ${guild.name} (${guild.id})`);

  writeBotStatus({
    guildName: guild.name,
    guildId: guild.id,
    memberCount: guild.memberCount,
    userTag: client.user?.tag || "",
    userId: client.user?.id || "",
    readyAt: new Date().toISOString(),
    error: ""
  });

  await safeFetchGuildMembers(guild, "startup");

  try {
    await initializeVoiceTracking(guild);
    await refreshTeam(guild, { skipFetch: true });
    await refreshDiscordOverview(guild, "startup");
    await refreshDiscordAuditLogs(guild, "startup");
  } catch (error) {
    console.error("Start-Aktualisierung fehlgeschlagen:", error);
    writeBotStatus({ error: error.message || String(error) });
  }

  cleanupExpiredAbsences();

  try {
    await processTaskNotifications(client);
  } catch (error) {
    console.error("Task-Benachrichtigungen konnten beim Start nicht verarbeitet werden:", error);
    writeBotStatus({ error: error.message || String(error) });
  }

  if (CONFIG.absenceChannelId) {
    console.log(`🗓️  Abmeldungs-Channel aktiv: ${CONFIG.absenceChannelId}`);

    try {
      await backfillAbsenceChannel(guild);
    } catch (error) {
      console.error("Abmeldungs-Channel-Backfill beim Start fehlgeschlagen:", error);
    }
  } else {
    console.log("ℹ️ Kein Abmeldungs-Channel gesetzt. Setze absenceChannelId in config.json, wenn du Abmeldungen erfassen willst.");
  }

  setInterval(async () => {
    try {
      await refreshTeam(guild);
      await refreshDiscordOverview(guild, "interval");
      await refreshDiscordAuditLogs(guild, "interval");
    } catch (error) {
      console.error("Team-Aktualisierung fehlgeschlagen:", error);
      writeBotStatus({ error: error.message || String(error) });
    }
  }, 15 * 60 * 1000);

  setInterval(async () => {
    try {
      await processTaskNotifications(client);
    } catch (error) {
      console.error("Task-Benachrichtigungen konnten nicht verarbeitet werden:", error);
      writeBotStatus({ error: error.message || String(error) });
    }
  }, 5 * 1000);

  setInterval(cleanupExpiredAbsences, 10 * 60 * 1000);

  setInterval(() => {
    writeBotStatus({
      guildName: guild.name,
      guildId: guild.id,
      memberCount: guild.memberCount,
      userTag: client.user?.tag || "",
      userId: client.user?.id || "",
      error: ""
    });
  }, 60 * 1000);
});


function channelTypeName(type) {
  const map = {
    0: "Text",
    2: "Voice",
    4: "Kategorie",
    5: "Announcement",
    10: "News Thread",
    11: "Public Thread",
    12: "Private Thread",
    13: "Stage",
    15: "Forum",
    16: "Media"
  };

  return map[type] || String(type);
}

function serializePermissions(permissions) {
  try {
    return permissions?.toArray?.() || [];
  } catch (_) {
    return [];
  }
}

function getPresenceStatusCounts(guild) {
  const counts = {
    online: 0,
    idle: 0,
    dnd: 0,
    invisibleOrOffline: 0,
    totalWithPresence: 0
  };

  guild.presences.cache.forEach(presence => {
    const status = String(presence.status || "offline");
    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] += 1;
    }
    counts.totalWithPresence += 1;
  });

  counts.invisibleOrOffline = Math.max(0, guild.memberCount - counts.totalWithPresence);

  return counts;
}

function buildDiscordOverview(guild) {
  const roles = guild.roles.cache
    .filter(role => role.name !== "@everyone")
    .map(role => ({
      id: role.id,
      name: role.name,
      color: role.hexColor,
      position: role.position,
      managed: role.managed,
      mentionable: role.mentionable,
      hoist: role.hoist,
      memberCount: role.members?.size || 0,
      permissions: serializePermissions(role.permissions)
    }))
    .sort((a, b) => b.position - a.position);

  const channels = guild.channels.cache
    .map(channel => ({
      id: channel.id,
      name: channel.name,
      type: channelTypeName(channel.type),
      rawType: channel.type,
      parentId: channel.parentId || "",
      parentName: channel.parent?.name || "",
      position: channel.position || 0
    }))
    .sort((a, b) => String(a.type).localeCompare(String(b.type)) || a.position - b.position);

  const members = guild.members.cache.map(member => ({
    id: member.id,
    name: member.displayName || member.user?.globalName || member.user?.username || member.id,
    username: member.user?.username || "",
    bot: Boolean(member.user?.bot),
    joinedAt: member.joinedAt?.toISOString?.() || null,
    roleCount: member.roles.cache.filter(role => role.name !== "@everyone").size,
    roles: member.roles.cache
      .filter(role => role.name !== "@everyone")
      .map(role => role.name)
      .sort()
  }));

  const bots = members.filter(member => member.bot);
  const humans = members.filter(member => !member.bot);

  const topRoleUsers = members
    .filter(member => !member.bot)
    .sort((a, b) => b.roleCount - a.roleCount || a.name.localeCompare(b.name))
    .slice(0, 50);

  const noRoleUsers = members
    .filter(member => !member.bot && member.roleCount === 0)
    .slice(0, 50);

  const newestMembers = members
    .filter(member => member.joinedAt)
    .sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime())
    .slice(0, 50);

  const channelTypeCounts = channels.reduce((acc, channel) => {
    acc[channel.type] = (acc[channel.type] || 0) + 1;
    return acc;
  }, {});

  return {
    guildId: guild.id,
    guildName: guild.name,
    ownerId: guild.ownerId || "",
    memberCount: guild.memberCount,
    cachedMemberCount: guild.members.cache.size,
    rolesTotal: roles.length,
    channelsTotal: channels.length,
    emojiCount: guild.emojis?.cache?.size || 0,
    stickerCount: guild.stickers?.cache?.size || 0,
    boostCount: guild.premiumSubscriptionCount || 0,
    boostTier: guild.premiumTier || 0,
    roles,
    channels,
    channelTypeCounts,
    memberStats: {
      total: guild.memberCount,
      cached: guild.members.cache.size,
      humans: humans.length,
      bots: bots.length,
      presences: getPresenceStatusCounts(guild),
      noRoleUsers,
      topRoleUsers,
      newestMembers
    },
    updatedAt: new Date().toISOString()
  };
}

async function refreshDiscordOverview(guild, reason = "scheduled") {
  try {
    const overview = buildDiscordOverview(guild);
    writeJsonFile(discordOverviewFile, overview);
    writeBotStatus({
      guildName: guild.name,
      guildId: guild.id,
      memberCount: guild.memberCount,
      rolesTotal: overview.rolesTotal,
      channelsTotal: overview.channelsTotal,
      discordOverviewUpdatedAt: overview.updatedAt,
      error: ""
    });

    console.log(`📊 Discord-Übersicht aktualisiert (${reason}): ${overview.rolesTotal} Rollen, ${overview.channelsTotal} Channels`);
    return overview;
  } catch (error) {
    console.error("Discord-Übersicht konnte nicht aktualisiert werden:", error);
    writeBotStatus({ error: error.message || String(error) });
    return null;
  }
}

function readDiscordAuditLogs() {
  const data = readJsonFile(discordAuditLogsFile, { entries: [], updatedAt: null, error: "" });
  return data && typeof data === "object" ? data : { entries: [], updatedAt: null, error: "" };
}

function auditTargetLabel(target) {
  if (!target) return "";
  return target.tag || target.username || target.name || target.id || String(target);
}

async function refreshDiscordAuditLogs(guild, reason = "scheduled") {
  try {
    const audit = await guild.fetchAuditLogs({ limit: 50 });
    const entries = [...audit.entries.values()].map(entry => ({
      id: entry.id,
      action: String(entry.action),
      actionType: entry.actionType ? String(entry.actionType) : "",
      executorId: entry.executorId || "",
      executorName: entry.executor?.tag || entry.executor?.username || entry.executorId || "",
      targetId: entry.targetId || "",
      targetName: auditTargetLabel(entry.target),
      reason: entry.reason || "",
      changes: Array.isArray(entry.changes) ? entry.changes.slice(0, 10).map(change => ({
        key: change.key,
        old: typeof change.old === "object" ? JSON.stringify(change.old).slice(0, 300) : String(change.old ?? ""),
        new: typeof change.new === "object" ? JSON.stringify(change.new).slice(0, 300) : String(change.new ?? "")
      })) : [],
      createdAt: entry.createdAt?.toISOString?.() || new Date(Number(entry.createdTimestamp || Date.now())).toISOString()
    }));

    writeJsonFile(discordAuditLogsFile, {
      entries,
      updatedAt: new Date().toISOString(),
      error: ""
    });

    console.log(`🛡️ Discord-Audit-Log aktualisiert (${reason}): ${entries.length} Einträge`);
    return entries;
  } catch (error) {
    const message = error?.code === 50013
      ? "Bot hat keine Berechtigung für Discord Audit Log (View Audit Log fehlt)."
      : (error.message || String(error));

    writeJsonFile(discordAuditLogsFile, {
      ...readDiscordAuditLogs(),
      updatedAt: new Date().toISOString(),
      error: message
    });

    console.warn("Discord-Audit-Log konnte nicht gelesen werden:", message);
    writeBotStatus({ warning: message, error: "" });
    return [];
  }
}


async function refreshTeam(guild, options = {}) {
  if (!options.skipFetch) {
    await safeFetchGuildMembers(guild, "team-refresh");
  }

  const team = guild.members.cache.filter(member => memberHasRecognizedRole(member));

  const rows = team.map(member => buildTeamRow(member));

  console.log(`Gefundenes Team: ${rows.length} Teammitglieder`);

  await saveTeam(rows);

  console.log("🔄 Team automatisch aktualisiert");
}

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  if (CONFIG.absenceChannelId && String(message.channelId) === String(CONFIG.absenceChannelId)) {
    await handleAbsenceMessage(message);
    return;
  }

  if (message.content === "!team" || message.content === "!refresh") {
    if (message.content === "!refresh") {
      await safeFetchGuildMembers(message.guild, "manual-refresh");
    }

    const team = message.guild.members.cache.filter(member => memberHasRecognizedRole(member));

    let text = "📊 **TEAM ÜBERSICHT**\n\n";

    const rows = team.map(member => {
      const row = buildTeamRow(member);
      text += `👤 ${row.name} | ${row.recognizedRoles.join(" | ") || "Keine erkannte Rolle"}\n`;
      return row;
    });

    if (message.content === "!team") {
      await message.channel.send(text);
    } else {
      await message.reply("✅ Teamdaten aktualisiert.");
    }

    await saveTeam(rows);

    if (message.content === "!refresh") {
      await refreshDiscordOverview(message.guild, "manual-refresh");
      await refreshDiscordAuditLogs(message.guild, "manual-refresh");
    }
  }
});

process.on("unhandledRejection", error => {
  console.error("Unbehandelte Promise-Ablehnung:", error);
  writeBotStatus({ error: error?.message || String(error) });
});

process.on("uncaughtException", error => {
  console.error("Unbehandelter Fehler:", error);
  writeBotStatus({ error: error?.message || String(error) });
});

client.login(CONFIG.token);


client.on("error", error => {
  console.error("Discord Client Fehler:", error);
  writeBotStatus({ error: error.message || String(error) });
});
