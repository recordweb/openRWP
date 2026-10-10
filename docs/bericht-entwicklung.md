# OpenRWP: Bericht zur Entwicklung des Custodian-Servers

Stand: 10. Oktober 2026. Dieser Bericht fasst zusammen, was in der Arbeitssession zum Projekt OpenRWP
(Demo-Implementierung des RWP Client-Custodian Binding) entstanden ist.

## 1. Ausgangslage und Ziel

Grundlage waren RWP 0.0.8, RWC 0.0.8 und der Entwurf "RWP Client-Custodian Binding" (Draft 0.0.1). Ziel ist eine einfache
Demo mit drei Komponenten in dieser Reihenfolge: Server (Custodian mit DID-Resolver), Linux-Client (CLI) und Android-Client
(PWA, nur Betrachten). Erfolgskriterium: Eine `.odt` wird auf dem Pop!_OS-Laptop als Record gespeichert, die Versionen
sind im Graphen sichtbar, und das Dokument wird auf dem Handy über eine Capability-URL abgerufen.

Stand heute: Der Server ist vollständig umgesetzt, getestet und auf dem VPS deployt. Der Linux-Client und die PWA
stehen noch aus.

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

1. Linux-Client (`init`, `push`, `sync`, `pull`, `list/graph`, `settings`), später optional `watch`.
2. Android-PWA zum Betrachten.
3. Finalisierung und PDF/A, Signaturkonzept, Schlüsselbund, FUSE-Sicht, GNR-Abgleich beim Start.
4. Änderungen an RWP, RWC und Binding gemäss `docs/aenderungsliste.md`.
5. Aufräumen: Test-Links widerrufen, nicht mehr benötigte Testgeräte sperren, Zugangsdaten rotieren.