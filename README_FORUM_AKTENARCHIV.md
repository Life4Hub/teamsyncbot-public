# TeamSync Forum und Aktenarchiv

Neu enthalten:

- Tab `Forum`
- Tab `Aktenarchiv`
- Forumseinträge mit Text und Anhängen
- Akteneinträge mit Text, Anhängen und rollenbasierter Sichtbarkeit
- Erstellen/Bearbeiten/Löschen nur für Management-Berechtigte

Berechtigt zum Erstellen/Bearbeiten/Löschen sind dieselben Rollen wie bei der Abmeldungsverwaltung:

- Inhaber
- stv. Inhaber
- Projektleitung
- stv. Projektleitung
- Teamleitung
- stv. Teamleitung
- CCM
- stv. CCM
- Management | 4Life
- Management Leitung | 4Life

Forum:

- Jeder eingeloggte Team-Nutzer kann Forumeinträge ansehen.
- Nur Berechtigte können Einträge erstellen, bearbeiten und löschen.
- Anhänge werden unter `uploads/forum/<postId>/` gespeichert.

Aktenarchiv:

- Beim Erstellen einer Akte werden erlaubte Rollen ausgewählt.
- Keine Rollenauswahl bedeutet: alle Teammitglieder dürfen die Akte sehen.
- Akten-Dateien werden nicht öffentlich über `/uploads` ausgeliefert, sondern über eine geschützte API-Route.
- Anhänge werden unter `uploads/archive/<entryId>/` gespeichert.

SQL:

Die Daten werden über die vorhandene SQL-Bridge in `teamsync.db` gespeichert:

- `forum_posts`
- `archive_entries`

Alte JSON-Dateien werden nicht benötigt. Falls `forum_posts.json` oder `archive_entries.json` existieren, werden sie beim ersten Lesen migriert.


Änderung Aktenarchiv:
- Jeder eingeloggte Team-Nutzer kann eigene Akten erstellen.
- Sichtbarkeit wird beim Erstellen über Rollen festgelegt.
- Keine Rollenauswahl bedeutet: alle Teammitglieder können die Akte sehen.
- Ersteller können nur eigene Akten bearbeiten/löschen.
- Berechtigte Rollen können alle Akten sehen, bearbeiten und löschen.
