# Clips/Beweise und Livechat

## Clips/Beweise

- Neuer Tab: `/Teamboard/clips`
- Alle eingeloggten Teammitglieder können Bilder und Videos hochladen.
- Beschreibung ist optional, aber auf 5000 Zeichen begrenzt.
- Ersteller und berechtigte Rollen können Clips/Beweise löschen.
- Dateien liegen unter `uploads/clips/<clipId>/`.

## Livechat

- Neuer Tab: `/Teamboard/livechat`
- Alle eingeloggten Teammitglieder können schreiben.
- Dateien/Fotos/Videos können wie im Aufgabenchat hochgeladen werden.
- Neue Nachrichten erscheinen live über Socket.IO ohne Neuladen.
- Dateien liegen unter `uploads/livechat/<messageId>/`.

## SQL-Stores

Neu hinzugefügt:

- `clips_entries`
- `live_chat_messages`

Die Daten werden wie die anderen Module über `teamsync.db` gespeichert.
