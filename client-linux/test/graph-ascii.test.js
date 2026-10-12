import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderGraph } from '../lib/graph-ascii.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const D = 'd'.repeat(64);
const mk = (versionHash, parents, createdAt) => ({ versionHash, parents, createdAt, modifiedAt: createdAt, state: 'draft' });
const t = (m) => `2026-10-10T13:${m}:00Z`;

test('a linear history is a plain list', () => {
  const versions = [mk(A, [], t('00')), mk(B, [A], t('05')), mk(C, [B], t('10'))];
  assert.equal(renderGraph({ versions, heads: [{ versionHash: C }], localHead: C }), [
    '* aaaaaaaa  2026-10-10T13:00:00Z  draft  (root)',
    '|',
    '* bbbbbbbb  2026-10-10T13:05:00Z  draft',
    '|',
    '* cccccccc  2026-10-10T13:10:00Z  draft  (head, local)',
  ].join('\n'));
});

test('a fork is drawn with indentation', () => {
  const versions = [mk(A, [], t('00')), mk(B, [A], t('05')), mk(C, [A], t('06')), mk(D, [B], t('10'))];
  assert.equal(renderGraph({ versions, heads: [{ versionHash: D }, { versionHash: C }] }), [
    '* aaaaaaaa  2026-10-10T13:00:00Z  draft  (root)',
    '|',
    '+- * bbbbbbbb  2026-10-10T13:05:00Z  draft',
    '|  |',
    '|  * dddddddd  2026-10-10T13:10:00Z  draft  (head)',
    '|',
    '`- * cccccccc  2026-10-10T13:06:00Z  draft  (head)',
  ].join('\n'));
});

test('a merge version appears once and names its parents; --full shows whole hashes', () => {
  const versions = [mk(A, [], t('00')), mk(B, [A], t('05')), mk(C, [A], t('06')), mk(D, [B, C], t('10'))];
  const text = renderGraph({ versions, heads: [{ versionHash: D }] });
  assert.equal(text.match(/\* [a-f]{8}/g).length, 4);
  assert.match(text, /merge of bbbbbbbb, cccccccc/);
  assert.ok(renderGraph({ versions, full: true }).startsWith(`* ${A}  `));
});

test('an empty graph gives a hint', () => {
  assert.equal(renderGraph({ versions: [] }), '(no versions)');
});