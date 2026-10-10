import { CoreError } from './errors.js';

// RWP 19.2: RFC 8785 (JCS) with all strings (keys and values) normalised to NFC.
// Supports the JSON types RWP uses: null, boolean, number, string, array, object.
// JS default sort() compares UTF-16 code units, which is the order JCS requires.
// JSON.stringify produces the ECMAScript string/number forms required by JCS.

function normalize(value) {
  if (typeof value === 'string') return value.normalize('NFC');
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      const key = k.normalize('NFC');
      if (key in out) throw new CoreError('duplicate-key', key);
      out[key] = normalize(v);
    }
    return out;
  }
  return value;
}

function serialize(value) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new CoreError('invalid-number');
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
      const keys = Object.keys(value).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${serialize(value[k])}`).join(',')}}`;
    }
    default:
      throw new CoreError('unsupported-type', typeof value);
  }
}

export function canonicalize(value) {
  return serialize(normalize(value));
}