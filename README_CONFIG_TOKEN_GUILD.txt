TOKEN UND FESTE GUILD-ID SETZEN
================================

0. Zuerst config.example.json nach config.json kopieren:

   cp config.example.json config.json

   config.json ist bewusst in .gitignore, damit deine echten Zugangsdaten
   nie versehentlich committet werden.

1. Öffne auf dem Server:

   nano config.json

2. Trage dort dein Bot-Token und deine Discord-Server-ID ein:

   {
     "token": "DEIN_ECHTER_BOT_TOKEN",
     "guildId": "DEINE_DISCORD_SERVER_ID"
   }

3. Discord-Server-ID bekommen:
   Discord → Einstellungen → Erweitert → Entwicklermodus aktivieren
   Dann Rechtsklick auf deinen Discord-Server → Server-ID kopieren

4. Bot neu starten:

   cd /home/fxserver/TeamSyncBot_teamboard
   DASHBOARD_HOST=0.0.0.0 DASHBOARD_PORT=3010 npm start

Alternative ohne config.json:

   DISCORD_TOKEN="DEIN_TOKEN" DISCORD_GUILD_ID="DEINE_GUILD_ID" DASHBOARD_HOST=0.0.0.0 DASHBOARD_PORT=3010 npm start

Wichtig:
- token = welcher Bot verwendet wird
- guildId = welcher Discord-Server verwendet wird
- Der Bot muss auf genau diesem Discord-Server eingeladen sein
- Im Discord Developer Portal müssen je nach Nutzung diese Intents aktiv sein:
  Presence Intent
  Server Members Intent
  Message Content Intent
