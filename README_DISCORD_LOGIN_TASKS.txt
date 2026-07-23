TeamSync - Discord Login + Aufgaben

1. Discord Developer Portal öffnen
   - Deine Application auswählen
   - OAuth2 -> General
   - Redirect URI hinzufügen:

     http://DEINE-SERVER-IP:3010/Teamboard/auth/discord/callback

   Wenn du Reverse Proxy ohne Port nutzt, entsprechend:

     http://DEINE-SERVER-IP/Teamboard/auth/discord/callback

2. In config.json eintragen:

{
  "token": "DEIN_BOT_TOKEN",
  "guildId": "DEINE_DISCORD_SERVER_ID",
  "clientId": "DEINE_DISCORD_CLIENT_ID",
  "clientSecret": "DEIN_DISCORD_CLIENT_SECRET",
  "redirectUri": "http://DEINE-SERVER-IP:3010/Teamboard/auth/discord/callback",
  "sessionSecret": "irgendein-langer-zufaelliger-text"
}

Wichtig:
- token = Bot Token
- guildId = Discord Server-ID
- clientId = Application ID aus dem Developer Portal
- clientSecret = OAuth2 Client Secret
- redirectUri muss exakt mit der Redirect URI im Developer Portal übereinstimmen

3. Starten:

npm install
DASHBOARD_HOST=0.0.0.0 DASHBOARD_PORT=3010 npm start

Windows PowerShell:

$env:DASHBOARD_HOST="127.0.0.1"
$env:DASHBOARD_PORT="3010"
npm start

4. Öffnen:

http://SERVER-IP:3010/Teamboard/

5. Zugriff:
Nutzer müssen sich mit Discord anmelden.
Zugriff erhalten nur Nutzer, die mindestens eine erkannte Teamrolle oder Abteilungsrolle besitzen.
Alle anderen sehen "Kein Zugriff".

6. Aufgaben:
Oben gibt es den Tab "Aufgaben".
Dort können berechtigte Teammitglieder Aufgaben erstellen, bearbeiten, speichern und löschen.
Die Aufgaben werden in tasks.json gespeichert.
