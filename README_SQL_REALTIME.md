# TeamSync SQL + Live-Chat

## SQL-Migration

Der Bot speichert `tasks`, `users`, `team` und `task_notifications` ab jetzt in einer SQLite-SQL-Datenbank (`teamsync.db`).

Beim ersten Start werden vorhandene alte JSON-Dateien automatisch importiert:

- `tasks.json`
- `users.json`
- `team.json`
- `task_notifications.json`

Die alten JSON-Dateien werden nicht gelöscht, sondern bleiben als Backup liegen. Danach werden sie für diese Daten nicht mehr benutzt.

Optional kannst du den Speicherort setzen:

```bash
TEAMSYNC_DB_PATH=/home/fxserver/TeamSyncBot_teamboard2/teamsync.db npm start
```

## Wichtig nach dem Update

Einmal ausführen:

```bash
npm install
```

Neu dazugekommen:

- `better-sqlite3`
- `socket.io`

## Live-Chat

Wenn jemand in einer Aufgabe eine Chatnachricht schreibt, bearbeitet oder löscht, aktualisiert sich die Aufgabe bei allen geöffneten Nutzern automatisch. Kein Reload mehr nötig. Natürlich nur für Nutzer, die die Detailseite dieser Aufgabe gerade offen haben.
