import { CoreError } from './errors.js';

// Pure, in-memory graph helpers. A version is { versionHash, parents: [hash, ...] }.
// Edges point from child to parent (RWP 5.5.1).

function byHash(versions) {
  return new Map(versions.map((v) => [v.versionHash, v]));
}

// All ancestors of the given starting hashes, including the starting hashes themselves.
function ancestorsOrSelf(index, starts) {
  const seen = new Set();
  const stack = starts.filter((h) => index.has(h));
  while (stack.length > 0) {
    const h = stack.pop();
    if (seen.has(h)) continue;
    seen.add(h);
    for (const p of index.get(h).parents) if (index.has(p)) stack.push(p);
  }
  return seen;
}

// Versions without successor (RWP 5.5.4: there may be several).
export function heads(versions) {
  const parents = new Set(versions.flatMap((v) => v.parents));
  return versions.filter((v) => !parents.has(v.versionHash)).map((v) => v.versionHash);
}

// True if adding `candidate` would make it its own ancestor (RWP 5.5.1).
export function wouldCreateCycle(versions, candidate) {
  if (candidate.parents.includes(candidate.versionHash)) return true;
  const index = byHash(versions);
  return ancestorsOrSelf(index, candidate.parents).has(candidate.versionHash);
}

// Binding 6.3: all versions not reachable from the given heads, parents before children.
// Unknown hashes in haveHeads are ignored.
export function unreachableFrom(versions, haveHeads) {
  const index = byHash(versions);
  const reachable = ancestorsOrSelf(index, haveHeads);
  const remaining = versions.filter((v) => !reachable.has(v.versionHash));
  const pending = new Set(remaining.map((v) => v.versionHash));
  const ordered = [];
  const emitted = new Set();
  while (ordered.length < remaining.length) {
    let progressed = false;
    for (const v of remaining) {
      if (emitted.has(v.versionHash)) continue;
      if (v.parents.every((p) => !pending.has(p) || emitted.has(p))) {
        ordered.push(v);
        emitted.add(v.versionHash);
        progressed = true;
      }
    }
    if (!progressed) throw new CoreError('cycle', 'graph contains a cycle');
  }
  return ordered;
}