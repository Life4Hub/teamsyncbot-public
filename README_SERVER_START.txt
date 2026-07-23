TeamSyncBot auf Linux starten
=============================

1. In den Bot-Ordner wechseln:

   cd /home/fxserver/TeamSyncBot_teamboard

2. Abhängigkeiten installieren:

   npm install

3. Testweise direkt öffentlich starten:

   DASHBOARD_HOST=0.0.0.0 DASHBOARD_PORT=3010 npm start

4. Aufrufen:

   http://SERVER-IP:3010/Teamboard/

5. Im screen starten:

   screen -S teamboard
   cd /home/fxserver/TeamSyncBot_teamboard
   DASHBOARD_HOST=0.0.0.0 DASHBOARD_PORT=3010 npm start

   Screen verlassen ohne Bot zu stoppen:
   STRG + A, dann D

   Screen wieder öffnen:
   screen -r teamboard

Prüfen
======

Lauscht der Server korrekt?

   sudo ss -tulpn | grep 3010

Für direkten Zugriff muss dort stehen:

   0.0.0.0:3010

Lokal testen:

   curl -I http://127.0.0.1:3010/Teamboard/

Erwartet:

   HTTP/1.1 200 OK

Wichtig
=======

Wenn Discord "Used disallowed intents" meldet:
Discord Developer Portal -> App -> Bot -> Privileged Gateway Intents aktivieren:

- Server Members Intent
- Message Content Intent
- Presence Intent nur nötig, wenn Online-Status sauber angezeigt werden soll.

Der Token liegt aktuell noch im Code. Nach dem Teilen/Upload solltest du den Token im Discord Developer Portal neu generieren.
