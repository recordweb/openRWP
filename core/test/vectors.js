import { readFileSync } from 'node:fs';

// The two RecordWeb root records from recordweb-org (namespace d2d14675-50c9-463d-b564-1ea50644c836).
// Their hashes and signatures were created independently of this code base.
const load = (name) => JSON.parse(readFileSync(new URL(`./vectors/${name}`, import.meta.url), 'utf8'));

export const rootSchema = load('root-schema.json');
export const rootAgent = load('root-agent.json');
export const ROOT_SIGNER_KEY = 'z6MkpgYzzH9AJJTnsYYMEaaVPZN2t2iCsz76ShftvkBt5jpP';
