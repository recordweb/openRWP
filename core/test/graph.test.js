import test from 'node:test';
import assert from 'node:assert/strict';
import { heads, wouldCreateCycle, unreachableFrom } from '../index.js';

const v = (versionHash, ...parents) => ({ versionHash, parents });
// a <- b <- c, and a branch a <- d; e merges c and d
const graph = [v('a'), v('b', 'a'), v('c', 'b'), v('d', 'a'), v('e', 'c', 'd')];

test('heads: all versions without successor', () => {
  assert.deepEqual(heads(graph), ['e']);
  assert.deepEqual(heads(graph.slice(0, 4)), ['c', 'd']);
});

test('wouldCreateCycle detects self and ancestor loops', () => {
  assert.equal(wouldCreateCycle(graph, v('f', 'e')), false);
  assert.equal(wouldCreateCycle(graph, v('f', 'f')), true);
  const loop = [v('a', 'b'), v('b', 'a')];
  assert.equal(wouldCreateCycle(loop, v('a', 'b')), true);
});

test('unreachableFrom: empty have returns the whole graph, parents first', () => {
  const shuffled = [graph[4], graph[2], graph[0], graph[3], graph[1]];
  const order = unreachableFrom(shuffled, []).map((x) => x.versionHash);
  for (const x of graph) for (const p of x.parents) {
    assert.ok(order.indexOf(p) < order.indexOf(x.versionHash), `${p} before ${x.versionHash}`);
  }
  assert.equal(order.length, 5);
});

test('unreachableFrom: known heads are excluded with their ancestors, unknown ignored', () => {
  assert.deepEqual(unreachableFrom(graph, ['c', 'zzz']).map((x) => x.versionHash), ['d', 'e']);
  assert.deepEqual(unreachableFrom(graph, ['e']), []);
});