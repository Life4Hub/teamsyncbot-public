TeamSyncBot Teamboard Setup
===========================

Ziel:
http://SERVER-IP/Teamboard

Der Bot selbst läuft NICHT direkt auf Port 80 und beißt sich dadurch nicht mit txAdmin, phpMyAdmin oder anderen Diensten.
Er läuft intern auf 127.0.0.1:3010/Teamboard/.
Apache oder Nginx leitet /Teamboard/ dorthin weiter.

Start:
------
cd TeamSyncBot_teamboard
npm install
DASHBOARD_PORT=3010 DASHBOARD_HOST=127.0.0.1 DASHBOARD_BASE_PATH=/Teamboard npm start

Falls du Windows nutzt:
set DASHBOARD_PORT=3010
set DASHBOARD_HOST=127.0.0.1
set DASHBOARD_BASE_PATH=/Teamboard
npm start

Nginx Beispiel:
---------------
location /Teamboard/ {
    proxy_pass http://127.0.0.1:3010/Teamboard/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /Teamboard {
    return 301 /Teamboard/;
}

Apache Beispiel:
----------------
ProxyPreserveHost On
ProxyPass /Teamboard/ http://127.0.0.1:3010/Teamboard/
ProxyPassReverse /Teamboard/ http://127.0.0.1:3010/Teamboard/
RedirectMatch 301 ^/Teamboard$ /Teamboard/

Apache Module aktivieren:
-------------------------
a2enmod proxy
a2enmod proxy_http
a2enmod rewrite
systemctl restart apache2

Wichtig:
--------
Port 3010 muss nicht öffentlich freigegeben werden, wenn der Reverse Proxy auf demselben Server läuft.
Öffentlich reicht Port 80/443.
