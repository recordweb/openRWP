# Änderungsliste für RWP, RWC und das Binding

Stand: 10. Oktober 2026. Grundlage: Erfahrungen aus der Demo-Implementierung OpenRWP.
Status: **E** = entschieden, **O** = offen (Diskussion nötig), **I** = im Demo so umgesetzt.

## A. RWP 0.0.8

| Nr. | Kapitel | Befund | Vorschlag | Status |
|---|---|---|---|---|
| A1 | 19.1 | Nennt `representations[].hash`, 5.6 und 7.4 nennen `contentHash` | In 19.1 `contentHash` verwenden | E |
| A2 | überall | Hashes mit Präfix `sha256:` (Beispiele, `versionHash`, `parents`, `contentHash`); in DIDs sind sie bereits ohne Präfix | Überall bare lowercase Hex (64 Zeichen), weil der Doppelpunkt die DID-Segmente stört | E, I |
| A3 | 4.3 | Beispiele zeigen die alte DID-Form (`did:rwp:bern.ch:...`) | Beispiele auf `uuid:uuid[:hash]` anpassen | E |
| A4 | 4.2 | `[:versionHash][:contentHash]`: Bei nur einem Hash-Segment ist nicht erkennbar, ob es der Version- oder Content-Hash ist | Festlegen: Ein einzelnes Segment ist der `versionHash`; ein `contentHash` setzt einen `versionHash` voraus | O (im Demo so angenommen) |
| A5 | 4.3 | `controller` ist nicht erklärt | Definieren, wer Controller eines Record-DID-Dokuments ist | O (Demo: Record-DID selbst) |
| A6 | 4.3 | `@context` nennt nur den DID-Kontext; für `Ed25519VerificationKey2020` ist `https://w3id.org/security/suites/ed25519-2020/v1` nötig | Kontext im Beispiel ergänzen | I |
| A7 | 4.3 | `currentVersion` ist ein einzelner Wert, ein Record kann mehrere Heads haben | Bedeutung festlegen (Demo: Head mit neuestem `createdAt`, nur Hinweis) | O, I |
| A8 | 4.4 | Resolver-Antworten 200/403/404/410; für formal falsche DIDs fehlt ein Code | 400 ergänzen | I |
| A9 | 4.4 / 4.2.3 | Offen, ob `versionHash`/`contentHash` in der DID etwas auswählen | Festlegen (Demo: Resolver liefert immer das DID-Dokument des Records) | O |
| A10 | 5.6 / 7.4 | `content` hat den Typ "blob", die JSON-Kodierung fehlt; das Beispiel zeigt für Text Klartext | Kodierung festlegen. Demo: immer Base64 (RFC 4648 §4, mit Padding), damit die Bytes exakt erhalten bleiben (NFC-Normalisierung würde Textdateien verändern) | E, I |
| A11 | 7.4 | `primary` und `role` sind Teil des `contentHash`. Dieselbe Datei mit anderem `primary` hat einen anderen `contentHash`; fehlendes `role` wird weggelassen | Ausdrücklich dokumentieren | O |
| A12 | 7.3 | Unklar, ob `representations` den Inhalt (`content`) enthalten | Gewünscht: `contentHash` schützt den Inhalt, der `versionHash` deckt die Repräsentationen ohne `content` ab (Performance). Im Demo wörtlich (mit `content`), Umschaltung in `computeVersionHash(..., { mode: 'withoutContent' })` vorbereitet | E (Änderung nötig) |
| A13 | 5.1 | Beispiel-Hashes sind Platzhalter und lassen sich nicht reproduzieren; es fehlen Testvektoren | Verbindliche Testvektoren ergänzen (siehe Anhang) | E |
| A14 | 19.4 | Signatur nur bei Finalisierung (und `signaturePolicy`); das Binding verlangt sie für jede Version | Konzeptionelle Diskussion; Demo ohne Signatur | O |
| A15 | 19.4 | Signiert wird der `versionHash` als Hex-String | Bestätigen: bare Hex, ohne Präfix; multibase-kodiert | O |
| A16 | 19.2 | RFC 8785 verlangt keine NFC-Normalisierung, RWP schon | Beibehalten und klarstellen: alle Strings (Schlüssel und Werte) werden vor der Kanonisierung NFC-normalisiert | I |
| A17 | 5.5.3 | "Version ohne Eltern = Root, erste Version" | Klarstellen, ob mehrere Root-Versionen je Record erlaubt sind (Demo: zweite Root-Version wird mit 409 abgelehnt) | O, I |
| A18 | 1.2 | Interne Speicherarchitektur ist ausgeklammert | Klarstellen: Massgebend ist die Struktur beim Abruf; getrennte Ablage (Datei plus Metadaten) ist zulässig | E |
| A19 | 19.4 | Erlaubt Ed25519 oder P-256 | Für Device-Keys im Binding festlegen, welche Algorithmen gelten (Demo: nur Ed25519/EdDSA) | O |
| A20 | 4.3 | `recordEndpoint` ist nicht definiert: Basis-URL für Operationen oder Adresse der Record-Ressource? Das Beispiel legt Letzteres nahe; ein allgemeiner Consumer (RecordFinder) ruft die Adresse direkt auf | Bedeutung festlegen und beschreiben, was `GET {recordEndpoint}` liefert (Record mit did, payload, metadata) | O |

| A22 | 3.1 | Beispiel zeigt `recordHash` mit Präfix `sha256:` | Bare Hex, wie bei allen Hashes | E |
| A23 | 6.1 | `schemaVersion` entfällt, die Version ist Teil der DID in `recordType` | Feld aus Beispiel und Tabelle streichen | E, I |
| A24 | 4.3 / 13.1 | `controller` muss nach DID Core eine DID sein; Kapitel 13 erlaubt andere Kennungen, wo kein typisierter Eintrag verlangt ist | Vereinheitlichen (Demo: AgentRecord-DID als Controller) | O |
| A25 | 6.2 | `owner` hat den Typ DID, Kapitel 13 erlaubt auch andere Schemata (z. B. Mailadresse) | Vereinheitlichen | O |
| A26 | 13.1 | RWP definiert keinen AgentRecord-Typ; für den Betrieb braucht es einen | Typ und Schema festlegen (Demo: Platzhalter-DID) | O |
| A27 | 5.1 / 7.2 | Die Reihenfolge von `payload` ist nicht definiert, der `recordHash` hängt aber davon ab | Regel festlegen. Demo: Eltern vor Kindern, dann `createdAt`, dann `versionHash` | O, I |
| A28 | 9.2 | Der Text nennt Core-Typen "with DID Suffix", ohne die Suffixe aufzuführen | Suffixe ergänzen | O |
| A29 | 4.3 | `currentVersion` heisst "Content hash der aktuellen finalisierten Version"; leer bei Entwurf. Unklar, ob `contentHash` oder `versionHash` gemeint ist. `updated` nur bei Änderung des Speicherorts | Präzisieren (Demo: leer, `updated` = `created`) | O, I |

## B. RWC 0.0.8

| Nr. | Befund | Vorschlag | Status |
|---|---|---|---|
| B1 | Konzept "Record bei Abruf in der RWP-Struktur, Speicherform frei" ist im RWC nicht ausdrücklich beschrieben | Als Grundsatz im Konzept festhalten (Demo zeigt Machbarkeit) | O |
| B2 | Rolle eines Custodian, der mehrere Namespaces für verschiedene Personen führt (Mail-Provider-Bild) | Im Konzept beschreiben, inklusive Abgrenzung zur Namespace-Hoheit der Person | O |

Weitere Punkte zum RWC sind bisher nicht aufgefallen, weil der Schwerpunkt bei RWP und Binding lag.

## C. Binding (Draft 0.0.1)

| Nr. | Abschnitt | Änderung | Status |
|---|---|---|---|
| C1 | 6.2, 3 | Blob-Upload (`PUT /blobs/{hash}`) streichen. Die Version trägt den Inhalt inline (`content`, Base64). Die Client-Pflicht "Blobs vor Referenz hochladen" entfällt | E, I |
| C2 | 6.4 | `GET .../versions/{hash}` liefert die volle Version mit `content`; `GET .../versions/{hash}/content` liefert die Rohdatei der primären Repräsentation | E, I |
| C3 | 6.2 | Feld `modifiedAt` ergänzen (Teil des Version-Hash) | E, I |
| C4 | 6.1 | Hashes überall bare Hex; Open Issue 6 erledigt | E, I |
| C5 | 6.2 | Fehler "409 Record-ID gehört zu anderem Namespace" streichen (die DID enthält den Namespace) | E, I |
| C6 | 5.3 | Signatur pro Version ist strenger als RWP 19.4. Offen; im Demo ist `signature` optional und wird nicht geprüft | O, I |
| C7 | 6.2 | Antwort auf `POST /versions`: `{ did, versionHash, recordEndpoint }` mit `Location`; 201 neu, 200 identisch (idempotent) | I |
| C8 | 4, 6.1 | `recordEndpoint` hat die Form `{base}/records/{namespace}/{recordId}` | I |
| C9 | 6.2 | Fehlercodes festlegen: 409 `unknown-parent` (mit `versionHash`), 409 `root-exists`, 422 für Hash-Abweichung, Zyklus, nicht unterstützten Zustand oder `ref`, 413 bei zu grosser Anfrage | I |
| C10 | 6.3 | Sync-Antwort enthält die Repräsentationen ohne `content` (nur `contentHash`); Heads als `{ versionHash, state }`. Ein Client prüft den `versionHash` erst nach dem Abruf der vollen Version (bei A12 schon aus den Sync-Daten) | I |
| C11 | 5.1 | Token-Ausgabe konkretisieren: `grant_type=client_credentials`, das Gerät erkennt sich am DPoP-Beweis mit dem registrierten Device-Key; opake Tokens, 10 Minuten | I |
| C12 | 5.1 | DPoP-Regeln: nur EdDSA, `ath` Pflicht bei geschützten Routen, Zeitfenster 60 s, Replay-Schutz über `jti` je Schlüssel, 401 mit `WWW-Authenticate: DPoP` | I |
| C13 | 5.1 | Autorisierung: Ein Gerät darf nur den eigenen Namespace nutzen (403 sonst); Sperren einzelner Geräte wirkt sofort | I |
| C14 | 5.2, 10 | Registrierung von Namespace und Gerät im Demo durch Administrator (Skripte); Open Issues 1 und 2 bleiben für die Praxis offen | O |
| C15 | 6.6 | `PUT /settings` ersetzt die Liste der Zugriffe; Einträge ohne `id` erzeugen einen Link, die `url` wird nur in dieser Antwort herausgegeben (Binding sagte nicht, wie die URL zum Besitzer kommt); bekannte `id` bleibt bestehen; fehlende Links werden widerrufen | E, I |
| C16 | 6.6 | Capability-URL `{base}/c/{token}` (256 Bit, nur der Hash wird gespeichert); Standardablauf 7 Tage, höchstens 30; ungültig, abgelaufen oder widerrufen antwortet einheitlich 404; nur `GET` | I |
| C17 | 6.6 | Capability-Routen: `/c/{token}`, `/c/{token}/versions/{hash}`, `.../content`. Es gibt keinen Abruf "aktueller Inhalt", weil der Custodian keinen Head auswählen darf | I |
| C18 | 6.6 | `Link: <.../settings>; rel="settings"` auf Antworten der Record-Routen des Besitzers; Links werden nur erzeugt, wenn die öffentliche URL `https` verwendet | I |
| C19 | 6.6 | Umfang Version 1: Scope `record`, Modus `read`, Agent `link`. Sichten (`views`) und weitere Modi werden mit 422 abgelehnt | I, O |
| C20 | 6.5 | Finalisierung (`/finalize`), `ref`-Repräsentationen, Offline-Queue und Head-Limit sind nicht implementiert | I |
| C21 | 8 | Fehlertabelle um 405, 413 und die DPoP-Challenge bei 401 erweitern | O |
| C22 | 4, 6 | Keine Operation auf der Basis-URL `{recordEndpoint}`. `GET {recordEndpoint}` fehlt (Record-Ressource), inklusive Zugriffsregel für Consumer ohne Token. Im Demo antwortet der Server mit 404 | Operation ergänzen oder die Rolle von `recordEndpoint` klarstellen; bis dahin 401 statt 404 bei Aufruf ohne Anmeldung | O |
| C23 | 4, 6 | `GET {recordEndpoint}` liefert den Record (`did`, `payload`, `metadata`, `recordHash`); nur mit Anmeldung, anonym 401 (ersetzt C22 im Demo) | I |
| C24 | neu | `GET/PUT {recordEndpoint}/metadata` für den Besitzer; ein neuer Record bekommt Standardmetadaten (`recordType`, `owner` = AgentRecord-DID) | E, I |
| C25 | 4 | DID-Dokument: `currentVersion` leer, `updated` = `created`, `controller` = AgentRecord-DID (Ersatz: Record-DID selbst) | I |

## Anhang: Testvektoren (aus der Kernbibliothek, mit unabhängiger Python-Implementierung gegengeprüft)

Representation: `{"format":"text/markdown","content":"c2FtcGxlIHRleHQ=","primary":true,"role":"source"}`
(`content` ist die Base64-Kodierung von `sample text`).

- `contentHash` = `f222dc6bc4ee1924aef96421bde393ae1c83598c5118db9c9c68f59489154bca`

Version: `state` `draft`, `parents` `[]`, `createdAt` und `modifiedAt` `2026-10-10T13:00:00Z`, eine Repräsentation wie oben
mit diesem `contentHash`.

- `versionHash` (wörtliche Lesart, mit `content`) = `faf54a141b4e54ff72cbbf0baecfa58b72ddaf76b677bb83e2bfd18f2ee7cbe5`
- `versionHash` (ohne `content`, mit `contentHash`) = `40aeba4804997463d8d5321a2abe7224360153331db7ab39c4367770cf40242c`

Weitere Prüfwerte aus Standards: JWK-Thumbprint und Signatur für Ed25519 nach RFC 8037, `ath` nach RFC 9449 (siehe
`core/test/dpop.test.js`).