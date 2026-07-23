const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const dbPath = process.env.TEAMSYNC_DB_PATH || path.join(__dirname, "teamsync.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS json_store (
    store_key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
`);

const DATA_FILE_KEYS = new Map([
    ["tasks.json", "tasks"],
    ["users.json", "users"],
    ["team.json", "team"],
    ["task_notifications.json", "task_notifications"],
    ["absences.json", "absences"],
    ["absence_processed_message_ids.json", "absence_processed_message_ids"],
    ["person_records.json", "person_records"],
    ["forum_posts.json", "forum_posts"],
    ["archive_entries.json", "archive_entries"],
    ["clips_entries.json", "clips_entries"],
    ["live_chat_messages.json", "live_chat_messages"],
    ["bot_status.json", "bot_status"],
    ["voice_activity.json", "voice_activity"],
    ["audit_logs.json", "audit_logs"],
    ["discord_audit_logs.json", "discord_audit_logs"],
    ["discord_overview.json", "discord_overview"]
]);

const selectStore = db.prepare("SELECT value FROM json_store WHERE store_key = ?");
const upsertStore = db.prepare(`
INSERT INTO json_store (store_key, value, updated_at)
VALUES (?, ?, ?)
ON CONFLICT(store_key) DO UPDATE SET
    value = excluded.value,
    updated_at = excluded.updated_at
`);
const deleteStore = db.prepare("DELETE FROM json_store WHERE store_key = ?");

function getStoreKey(filePath) {
    return DATA_FILE_KEYS.get(path.basename(filePath));
}

function cloneFallback(fallback) {
    if (fallback === undefined) return undefined;
    return JSON.parse(JSON.stringify(fallback));
}

function readJsonFile(filePath, fallback) {
    const key = getStoreKey(filePath);

    if (!key) {
        try {
            if (!fs.existsSync(filePath)) return cloneFallback(fallback);
            return JSON.parse(fs.readFileSync(filePath, "utf8"));
        } catch (error) {
            console.error(`Datei konnte nicht gelesen werden: ${filePath}`, error);
            return cloneFallback(fallback);
        }
    }

    try {
        const row = selectStore.get(key);

        if (row) {
            return JSON.parse(row.value);
        }

        if (fs.existsSync(filePath)) {
            const migrated = JSON.parse(fs.readFileSync(filePath, "utf8"));
            writeJsonFile(filePath, migrated);
            console.log(`✅ ${path.basename(filePath)} wurde nach SQL migriert.`);
            return migrated;
        }

        return cloneFallback(fallback);
    } catch (error) {
        console.error(`SQL-Daten konnten nicht gelesen werden: ${key}`, error);
        return cloneFallback(fallback);
    }
}

function writeJsonFile(filePath, data) {
    const key = getStoreKey(filePath);

    if (!key) {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
        return;
    }

    upsertStore.run(key, JSON.stringify(data, null, 2), new Date().toISOString());
}

function deleteJsonFileStore(filePath) {
    const key = getStoreKey(filePath);
    if (!key) return;
    deleteStore.run(key);
}

function getDatabasePath() {
    return dbPath;
}

module.exports = {
    readJsonFile,
    writeJsonFile,
    deleteJsonFileStore,
    getDatabasePath
};
