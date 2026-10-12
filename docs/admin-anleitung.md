# Admin-Anleitung OpenRWP

Diese Anleitung beschreibt, wie ein Administrator den Custodian-Server benutzt. Technische Hintergründe stehen
im README und im Bericht (`docs/bericht-entwicklung.md`).

## 1. Zugang

- Adresse: `https://vps.recordweb.dev/openrwp/admin/`
- Anmeldung: Benutzer und Passwort (HTTP-Anmeldung des Browsers). Benutzername und Passwort-Hash stehen in
  `/opt/openrwp/.env` (`ADMIN_USER`, `ADMIN_PASSWORD_HASH`). Fehlen sie, gibt es die Seite nicht.
- Nach 20 falschen Anmeldungen innerhalb von 10 Minuten sperrt sich der Bereich für 10 Minuten. Zum sofortigen
  Aufheben: `docker restart openrwp` auf dem VPS.

## 2. Neuen Kunden aufnehmen

Der Kunde schickt drei Angaben (per Mail, nichts davon ist geheim):

1. Namespace-UUID (generiert im GNR: https://vps.recordweb.dev/rw-gnr-admin/),
2. öffentlicher Autor-Schlüssel (beginnt mit `z6Mk`),
3. öffentlicher Geräteschlüssel `x` und ein Gerätename.

Ohne den späteren Client-CLI erzeugt der Kunde sie von Hand (Repo geklont, Node.js 20 oder neuer):

```bash
node -e "console.log(crypto.randomUUID())" # Namespace-UUID
node core/bin/keygen.js ~/.openrwp/author.pem # gibt publicKeyMultibase aus (Autor-Schlüssel)
node core/bin/dpop.js keygen ~/.openrwp/device.pem # gibt "public key (x)" aus (Gerät)
```

Der Admin geht so vor:

1. Admin-Seite, Abschnitt "New namespace": Label, Autor-Schlüssel und Namespace-UUID eintragen, "Create namespace".
2. Den neuen Namespace öffnen. Unter "Agent" Name und Mailadresse des Kunden eintragen, "Save agent". Das legt den
   AgentRecord an; er ist ab jetzt der `controller` der DID-Dokumente und der `owner` neuer Records.
3. Unter "Devices" Label und `x` eintragen, "Register device".
4. Den Namespace im GNR eintragen (separat). Resolver-Adresse: `https://vps.recordweb.dev/openrwp/did/`.
5. Dem Kunden mitteilen, dass er arbeiten kann.

Hinweis: Der Autor-Schlüssel eines Namespace kann nicht geändert werden (RWP 4.3). Ein falscher Eintrag erfordert
einen neuen Namespace.

## 3. Weiteres Gerät anmelden oder sperren

- Anmelden: Namespace öffnen, "Register device" mit Label und `x` des neuen Geräts.
- Sperren (z. B. Gerät verloren): in der Zeile des Geräts "Revoke". Die Sperre wirkt sofort. Der Namespace und
  der Autor-Schlüssel bleiben unberührt.

## 4. Namespace sperren oder aktivieren

"Suspend" im Namespace: Geräte erhalten kein Token mehr, bestehende Links liefern 404, Records bleiben erhalten.
"Activate" hebt die Sperre auf.

## 5. Records ansehen

Der Namespace zeigt nur die DIDs seiner Records (keine Inhalte). Die Details sieht, wer sich als Gerät anmeldet.

## 6. Passwort ändern

Auf einem Rechner mit Node.js (Repo geklont):

```bash
read -rs PASSWORD; export PASSWORD # mindestens 12 Zeichen
node backend/tools/hash-password.js # gibt die Zeile ADMIN_PASSWORD_HASH=... aus
unset PASSWORD
```

Die Zeile in `/opt/openrwp/.env` ersetzen und `cd /opt/openrwp && docker compose up -d --force-recreate`.

## 7. Prüfen und Fehlersuche

- Läuft der Server: `curl -s https://vps.recordweb.dev/openrwp/health` (erwartet `"status":"ok"`).
- Logs: `docker logs openrwp --tail 50`.
- Resolver: `curl -s https://vps.recordweb.dev/openrwp/did/<did>`.
- Deployment: Ein Commit auf `main` startet die GitHub Action. Ein roter Test im Docker-Build stoppt den Deploy,
  der alte Container läuft weiter. Das Protokoll steht in GitHub unter "Actions".
- Eine geänderte `.env` wirkt erst nach `docker compose up -d --force-recreate`.

## 8. Sicherung

- Datenbank (Schema `openrwp`): `docker exec poc-db pg_dump -U poc_user -d poc_db -n openrwp > openrwp.sql`
- Dateien (Docker-Volume): Den Volume-Namen mit `docker volume ls | grep openrwp` prüfen (erwartet
  `openrwp_openrwp-blobs`), dann
  `docker run --rm -v openrwp_openrwp-blobs:/data -v "$PWD":/backup alpine tar czf /backup/blobs.tgz -C /data .`
- Beide Sicherungen gehören zusammen: Die Datenbank verweist auf die Dateien.

## 9. Was die Seite nicht kann

Namespaces löschen, Autor-Schlüssel wechseln, Records anzeigen oder ändern, Links verwalten (das macht der Besitzer
über seinen Client). Für Schlüsselwechsel und Löschen gibt es noch kein Konzept (siehe Änderungsliste A30).