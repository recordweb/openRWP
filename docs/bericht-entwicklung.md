# OpenRWP: Bericht zur Entwicklung des Custodian-Servers

Stand: 12. Oktober 2026. Dieser Bericht fasst zusammen, was in der Arbeitssession zum Projekt OpenRWP
(Demo-Implementierung des RWP Client-Custodian Binding) entstanden ist.

## 1. Ausgangslage und Ziel

Grundlage waren RWP 0.0.8, RWC 0.0.8 und der Entwurf "RWP Client-Custodian Binding" (Draft 0.0.1). Ziel ist eine einfache
Demo mit drei Komponenten in dieser Reihenfolge: Server (Custodian mit DID-Resolver), Linux-Client (CLI) und Android-Client
(PWA, nur Betrachten). Erfolgskriterium: Eine `.odt` wird auf dem Pop!_OS-Laptop als Record gespeichert, die Versionen
sind im Graphen sichtbar, und das Dokument wird auf dem Handy über eine Capability-URL abgerufen.

Stand heute: Der Server ist vollständig umgesetzt, getestet und auf dem VPS deployt. Der Linux-Client ist umgesetzt (Abschnitt 11), die Android-Ansicht ist offen.

## 2. Rahmenentscheide

- Repository `recordweb/openRWP`, Server unter `https://vps.recordweb.dev/openrwp` (Resolver `/did`, Swagger `/api-docs`).
- Der Server ist Custodian und Resolver und erzeugt die DID-Dokumente selbst. Mehrere Namespaces (wie Mailadressen bei einem
  Provider), von Hand registriert.
- Dateien im Dateisystem (Docker-Volume), Metadaten, Graph, Geräte und Einstellungen in PostgreSQL (Schema `openrwp`).
- Authentifizierung: eigener OAuth-2.0-Token-Teil mit DPoP (RFC 9449), ohne Fremdprodukte.
- Dritte erhalten nur Capability-URLs.
- Vorgehen in kleinen Schritten. Jede Vereinfachung gegenüber Binding oder RWP wurde vorher abgesprochen.

## 3. Wichtige fachliche Entscheide

| Thema | Entscheid |
|---|---|
| Hash-Format | Überall ohne Präfix (bare Hex), weil Doppelpunkte die DID-Segmente stören |
| Inhalt einer Version | `content` inline (Base64) mit `contentHash`; der Server speichert die Datei im Dateisystem und liefert sie beim Abruf als `content` aus |
| `ref`-Repräsentationen | Nicht unterstützt (für externe Referenzen vorgesehen), Antwort 422 |
| Signatur | In Version 1 offen: optional, nicht geprüft; separate konzeptionelle Diskussion |
| Version-Hash (7.3) | Wörtliche Lesart (inkl. `content`); gewünscht ist künftig eine Änderung, bei der nur der `contentHash` den Inhalt schützt. Umschaltung im Code vorbereitet |
| `currentVersion` im DID-Dokument | Head mit dem neuesten `createdAt` (nur Hinweis); der Sync liefert immer alle Heads |
| `controller` im DID-Dokument | Vorläufig die Record-DID selbst; Pendenz |
| Anmeldung | Gerät wird per Admin-Skript angemeldet; Token per `client_credentials`, Gerät erkennt sich am Beweis |
| Links | `PUT .../settings` ersetzt die Linkliste; die URL wird nur einmal herausgegeben; nur Modus `read`, Scope `record`; Standard 7 Tage, höchstens 30 |

## 4. Umsetzung in Schritten

| Schritt | Inhalt | Ergebnis |
|---|---|---|
| 1-2 | Repo, Docker, Compose, GitHub Action, Health-Endpoint | Deployment per Commit, Smoke-Test im Workflow |
| 3 | PostgreSQL-Anbindung, Migrationen (`001`, `002`) | Schema `openrwp` mit zehn Tabellen |
| 4 | Kernbibliothek `core` | Kanonisierung (RFC 8785 mit NFC), Hashes, Version- und Graph-Logik, Schlüssel |
| 5 | Namespace-Registrierung, Schlüsselwerkzeuge | Namespace `4d3c45e8-...` registriert |
| 6a/6b | Versionen anlegen, lesen, Inhalt, Resolver, Sync | Funktioniert gegen den VPS |
| 7a-7c | DPoP, Token-Endpunkt, Geräteverwaltung, geschützte Routen | Replay-Schutz, Sperren einzelner Geräte getestet |
| 8 | Settings, Capability-URLs | `.odt` über Link abrufbar |
| 9 | Swagger, README, Berichte | dieser Stand |

Die Datenbank hat vier Migrationen (`001_meta`, `002_core`, `003_auth`, `004_links`). Tests: `core` 31, `backend` 38
(Build bricht bei einem roten Test ab).

## 5. Ergebnisse der Praxistests

- Version anlegen: 201, identisch wiederholt: 200, zweite Root-Version: 409 `root-exists`.
- Sync liefert die Historie (Eltern vor Kindern) und alle Heads; ab einem bekannten Head nur die fehlenden Versionen.
- Zugriff ohne DPoP: 401. Gleicher Beweis zweimal: 401. Gesperrtes Gerät: `invalid_token`, neues Token `invalid_client`.
- Capability-URL: Übersicht, Version und Datei abrufbar (`application/vnd.oasis.opendocument.text`, 8519 Bytes).
  Falsche oder widerrufene Links liefern einheitlich 404.

## 6. Erkenntnisse zu den Spezifikationen

Die Umsetzung hat mehrere Lücken und Widersprüche in RWP und im Binding sichtbar gemacht. Sie sind vollständig in
`docs/aenderungsliste.md` aufgeführt. Die wichtigsten:

- RWP 19.1 nennt `hash`, 5.6 und 7.4 nennen `contentHash`.
- Das Binding verlangte einen getrennten Blob-Upload, RWP 7.4 berechnet den `contentHash` aber über das ganze Objekt.
- Die Kodierung von `content` als Blob in JSON ist nicht definiert.
- 7.3 sagt nicht, ob `content` im Version-Hash enthalten ist. Die Beispiel-Hashes in 5.1 sind Platzhalter, es fehlen Testvektoren.
- Das DID-Format ist bei nur einem Hash-Segment mehrdeutig.

## 7. Stolpersteine (nützlich fürs nächste Mal)

- Ein Docker-Netz, das in Compose ohne `external: true` und `name` deklariert wird, wird neu und leer angelegt.
- Eine geänderte `.env` wirkt erst nach `docker compose up -d --force-recreate`.
- Der Nginx-Block erst eintragen, wenn der Container läuft. Für Versionen mit Inhalt braucht er `client_max_body_size`.
- Tests im Dockerfile gehören hinter `COPY backend/ ./`. Jede Änderung an Imports in `app.js` sorgfältig prüfen.
- Capability-Links sind Passwörter und gehören nicht in Chats oder Logs.

## 8. Betrieb

- VPS-Verzeichnis `/opt/openrwp`, Container `openrwp`, Netze `tws-proxy` und `poc-fragestunde_poc_network`.
- `.env` von Hand aus `.env.example`; kein `DEV_TOKEN` mehr.
- Schlüssel auf dem Laptop: `~/.openrwp/author.pem` (Autor-Schlüssel, noch ohne Signatur im Einsatz), `device.pem`
  (Hauptgerät), `device2.pem` (gesperrtes Testgerät).
- Registriert: Namespace "Nik demo", Hauptgerät "Nik - PopOS". Test-Record `28b91a20-f7cd-456b-a290-5d7088fdba74` mit drei Versionen.

## 9. Offene Punkte und nächste Schritte

1. Optional: `watch <ordner>` (bei jedem Speichern eine neue Version), `verify`, FUSE-Sicht.
2. Android-Client: Zweck und Zeitpunkt offen. Capability-Links funktionieren in jedem Browser.
3. Finalisierung und PDF/A, Signaturkonzept, Schlüsselbund, FUSE-Sicht, GNR-Abgleich beim Start.
4. Änderungen an RWP, RWC und Binding gemäss `docs/aenderungsliste.md`.
5. Aufräumen: Test-Links widerrufen, nicht mehr benötigte Testgeräte sperren, Zugangsdaten rotieren.

## 10. Nachtrag (12. Oktober 2026)

- **Record-Endpunkt:** `GET {recordEndpoint}` liefert den vollständigen Record (`did`, `payload`, `metadata`,
  `recordHash`), nur mit Anmeldung (anonym 401). Reihenfolge von `payload`: Eltern vor Kindern, dann `createdAt`, dann
  `versionHash` (Annahme, siehe A27).
- **Metadaten:** `GET/PUT {recordEndpoint}/metadata`; ein neuer Record erhält Standardmetadaten (Platzhalter-`recordType`,
  `owner` = AgentRecord). `schemaVersion` entfällt (in `recordType` enthalten).
- **DID-Dokument:** `currentVersion` leer (nur Entwürfe), `updated` gleich `created`, `controller` = AgentRecord-DID
  (Ersatz: Record-DID).
- **AgentRecord:** Wird in der Admin-Seite im Namespace der Person angelegt (JSON mit Name und Mailadresse,
  Entwurf, ohne Signatur). Keine Verbindung zum Hoster.
- **Admin-Seite** unter `/openrwp/admin/` (Basic-Login, Passwort-Hash in `.env`): Namespaces, AgentRecord, Geräte,
  DID-Liste. Die drei Skripte unter `backend/admin/` sind entfernt.
- **Swagger** unter `/openrwp/api-docs`.
- **Tests:** `core` 37, `backend` 64. Der Docker-Build bricht bei einem roten Test ab.
- **Offen:** Linux-CLI, Android-PWA, Enrollment-Code für Geräte (C27), Finalisierung, Signaturkonzept.

## 11. Nachtrag: Linux-Client (12. Oktober 2026)

Der Linux-Client (`client-linux/`, Node.js, ohne Zusatzpakete) ist umgesetzt, getestet und gegen den VPS erprobt.
Die Kernlogik liegt in `lib/` und ist von der Kommandozeile getrennt (spätere FUSE-Sicht).

### 11.1 Umsetzung in Schritten

| Schritt | Inhalt | Ergebnis |
|---|---|---|
| 1 | Gerüst, `config.json`, `state.json`, Dateinamen | 12 Tests |
| 2 | HTTP- und DPoP-Schicht, Token-Cache, Retry bei 401 | Fake-Server mit echter DPoP-Prüfung |
| 3 | `init` | Schlüssel und Konfiguration übernommen, Server-Check `OK` |
| 4 | `push`, `list`, `graph` | Testvektoren (A13) Ende zu Ende bestätigt |
| 5 | `settings` (Capability-Links) | Link auf dem Handy geprüft, Widerruf wirkt |
| 6 | `pull`, Wiederherstellen älterer Versionen | Version 1 in der Textverarbeitung wieder sichtbar |

Tests: `core` 37, `backend` 64, `client-linux` 74.

### 11.2 Entscheide

| Thema | Entscheid |
|---|---|
| Dokumentenordner | Fest und flach: `<Dokumente>/openRWP` (XDG), keine Unterordner, versteckte Dateien ignoriert |
| Zuordnung Datei und Record | Zentrale `~/.openrwp/state.json`, Schlüssel ist der Dateiname (Cache, der Server ist massgebend) |
| Schlüssel bei `init` | Vorhandene Dateien werden verwendet und nie überschrieben, danach Test-Abfrage |
| Zeitstempel | `createdAt` und `modifiedAt` sind gleich (Push-Zeitpunkt), Handhabe später (A32) |
| Heads | Nur ein Head. `push` prüft vorher per Sync und bricht bei mehreren Heads oder einem neueren Server-Stand ab |
| Unveränderte Datei | Keine neue Version |
| Ältere Version | `pull --version` schreibt sie in die Datei, `push` legt danach eine neue Version auf dem Head an. Der Graph wird nur vorwärts geschrieben (A35) |
| Lokale Änderungen | `pull` überschreibt nur mit `--force` |
| Grössenlimit | 25 MB pro Anfrage, vor dem Senden geprüft (C29) |
| Capability-Links | Nur über den Client, Standard 7, höchstens 30 Tage. Die URL wird nur einmal ausgegeben und nirgends gespeichert |
| Nicht umgesetzt | `sync` und `verify` (`list` und `graph` zeigen das Nötige), SchemaRecord und `service`-Einträge (RWP CfC8, noch nicht stabil), eigene Android-Anwendung |

### 11.3 Ergebnisse der Praxistests

- `init` übernahm die vorhandenen Schlüssel und meldete: Gerät registriert und Namespace stimmt. Die Annahme, dass der
  Server bei einem unbekannten Record 404 liefert und bei fremdem Namespace 403, hat sich bestätigt.
- `push` legte den Record an, die zweite Speicherung erzeugte eine Version mit dem Vorgänger als Eltern. `list` zeigte
  `untracked`, `in-sync` und `modified` richtig an. `graph` zeigte Root, Head und lokale Version.
- Capability-Link: Auf dem Smartphone liessen sich Übersicht und Datei abrufen. Nach dem Widerruf lieferte der Link 404.
- `pull --version` stellte die erste Version wieder her. Das nächste `push` legte eine dritte Version auf dem Head an.

### 11.4 Stolpersteine

- `node --test test/` startet jede Datei im Ordner. Hilfsdateien gehören nach `testlib/`.
- `PUT .../settings` ersetzt die ganze Liste. Der Client muss die bestehenden Links mit ihrer `id` mitsenden und nur die
  Felder, die das Schema erlaubt.
- Jede Anfrage braucht einen frischen DPoP-Beweis, auch bei einer Wiederholung nach 401.
- Die Textverarbeitung legt Sperrdateien (`.~lock.name#`) im Ordner an. Der Client ignoriert Namen mit Punkt am Anfang.
- `pull` ersetzt die Datei unter einem geöffneten Programm. Das Dokument muss neu geladen werden.
- Der Name des Dokumentenordners ist je nach Sprache verschieden (`Dokumente`). Der Client liest ihn aus
  `~/.config/user-dirs.dirs`.

### 11.5 Offene Punkte

1. Android-Client: Zweck und Zeitpunkt offen.
2. Die Tests des Clients laufen nicht im Docker-Build (der Client wird nicht deployt). Ob sie in die GitHub Action
   gehören, ist offen.
3. Optional: `watch`, `verify`, FUSE-Sicht, Enrollment-Code (C27), Finalisierung, Signaturkonzept.
4. Neue Befunde: A32 bis A35 und C29, C30 in `docs/aenderungsliste.md`.