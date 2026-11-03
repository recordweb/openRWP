# RWP findings

Deviations, gaps and ambiguities found while building the openRWP editor against RWP 0.0.12.
Chapters 1-8 of RWP 0.0.12 are treated as normative for this project. From chapter 9 on the text is
not yet cleaned up and serves as orientation only. Every deviation is logged here instead of being
worked around silently.

Status: `open` (to be decided in RWP), `decided` (project decision, see Decision), `info`.

| ID | RWP location | Finding | Status | Decision / note |
|---|---|---|---|---|
| F-1 | 2.1, Annex A.1 | Field order is not yet metadata before payload everywhere. | info | No effect on hashes, JCS sorts keys (7.6). The editor emits `did`, `metadata`, `payload`, `recordHash`. |
| F-2 | 3.1 | Field table of the DID document lists neither `verificationMethod` nor `controller`, but 5.2 and 7.7 presuppose them. | open | Editor publishes `verificationMethod` only in AgentRecord DID documents (7.7). |
| F-3 | 7.7 | Table names the proof fields `purpose` and `signature`; the root records use `proofPurpose` and `proofValue`. | open | Editor uses `proofPurpose` and `proofValue`. |
| F-4 | 7.7 | The signature input is not described. Observed on the root records: signature = Ed25519 over `sha256(JCS(proof without proofValue))` followed by `sha256(JCS(version including versionHash, without proof))`, proofValue is base58btc multibase (`z`). The proof configuration carries no `@context`. | open | Editor follows the observed recipe. Root records verify with it. |
| F-5 | 6.1 vs 6.7.1 | 6.1: every payload entry is immutable after creation. 6.7.1: a draft is not immutable. | decided | One open draft per Record; saving overwrites it and recalculates the hash. Finalisation fixes it. No branches in the editor. |
| F-6 | 12.1 | A SchemaRecord has no way to extend another schema, and no way to declare which extensions (5.3) a Record type allows. | decided | The editor schema copies the JSON Schema of the root agent schema and adds the field `derivedFrom`. Namespaces are carried as an extension entry whose `type` is the DID of the editor agent schema. |
| F-7 | Annex A.1 | Outdated: requires `version` instead of `versionHash`, `hash` instead of `contentHash`, and `maxItems 1` for representations. | info | Not used by the editor. |
| F-8 | 9.6 vs 9.8 | The two Merkle algorithms contradict each other (domain tags and duplication vs. sorted hex strings and carry-over). | info | Not relevant for the editor. |
| F-9 | DID document `a95437ee` in recordweb-org | Contains a `verificationMethod` although 7.7 excludes this for non-agent Records; uses `currentVersion` instead of `currentVersionHash`. | info | Old format, not used by the editor. |
| F-10 | recordFinder | Code comment refers to "RWP 23" for the namespace identifier; this chapter no longer exists. | info | |
| F-11 | 3.1 | `recordEndpoint` is a base URL which together with the `id` forms the full URL. The DID document in recordweb-org holds the full URL, and recordFinder calls it unchanged. | open | Editor follows 3.1 and returns 403 at the record endpoint. |
| F-12 | 12.1 | It is not defined how the `jsonSchema` of a schema applies to non-JSON representations such as `text/markdown`. | open | Editor schema uses `{"type": "string"}` for the markdown content. |
| F-13 | 15.2 | Access to the GNR (anonymous or authenticated) is not defined. The Fabric gateway requires a signed identity. | open | Editor isolates the lookup in `gnr.js`. A public read-only API would be a request for rw-cc-gnr or rw-rrn. |
| F-14 | 7.3 | `core` 0.0.8 had a planned mode `withoutContent` for the version hash. The root records and 7.3 use the full representation. | decided | Editor uses the full representation (mode `full`). |
