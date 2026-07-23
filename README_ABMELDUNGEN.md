# TeamSync Abmeldungen

Neu:
- Neuer Tab `/Teamboard/absences`
- Bot liest neue Nachrichten aus dem konfigurierten Abmeldungs-Channel
- Abmeldungen werden in `teamsync.db` über den Store `absences` gespeichert
- Abgelaufene Abmeldungen werden automatisch entfernt
- Unklare Angaben werden als `Prüfen` angezeigt

Config:
```json
{
  "absenceChannelId": "DEINE_ABMELDUNGS_CHANNEL_ID"
}
```

Alternativ per ENV:
```bash
ABSENCE_CHANNEL_ID=123456789012345678 npm start
```

Erkannt werden u. a.:
- bis 22:30
- bis 09.07
- bis 09.07.2026
- 3 Tage
- 4 Tage
- heute
- morgen
- bis Sonntag
- bis Sonntag Abend
- 22.07-10.08 (Zeitraum: Start- und Enddatum, auch mit Jahr, z. B. 22.07.2026-10.08.2026)

Empfohlenes Format:
```text
Name: @User
Dauer: bis 09.07.2026 22:30
Grund: Arbeit
```
