// ASCII view of the version graph: oldest version on top. A chain is a plain list;
// indentation appears only where the graph forks. A merge version is drawn below its first parent.
export function renderGraph({ versions, heads = [], localHead, full = false }) {
  if (versions.length === 0) return '(no versions)';
  const byHash = new Map(versions.map((v) => [v.versionHash, v]));
  const headSet = new Set(heads.map((h) => h.versionHash));
  const short = (h) => (full ? h : h.slice(0, 8));
  const known = (v) => v.parents.filter((p) => byHash.has(p));

  const children = new Map();
  const roots = [];
  for (const v of versions) {
    const [parent] = known(v);
    if (parent === undefined) {
      roots.push(v.versionHash);
    } else {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(v.versionHash);
    }
  }
  const order = (a, b) => Date.parse(byHash.get(a).createdAt) - Date.parse(byHash.get(b).createdAt) || (a < b ? -1 : 1);

  const label = (hash) => {
    const v = byHash.get(hash);
    const flags = [];
    if (known(v).length === 0) flags.push('root');
    if (v.parents.length > 1) flags.push(`merge of ${v.parents.map(short).join(', ')}`);
    if (headSet.has(hash)) flags.push('head');
    if (hash === localHead) flags.push('local');
    return `${short(hash)}  ${v.createdAt}  ${v.state}${flags.length > 0 ? `  (${flags.join(', ')})` : ''}`;
  };

  const visited = new Set();
  function walk(start) {
    const out = [];
    let current = start;
    for (;;) {
      if (visited.has(current)) return out;
      visited.add(current);
      out.push(`* ${label(current)}`);
      const kids = (children.get(current) ?? []).sort(order);
      if (kids.length === 0) return out;
      out.push('|');
      if (kids.length === 1) {
        [current] = kids;
        continue;
      }
      kids.forEach((kid, i) => {
        const last = i === kids.length - 1;
        const [first, ...rest] = walk(kid);
        if (first === undefined) return;
        out.push(`${last ? '`- ' : '+- '}${first}`);
        for (const line of rest) out.push(`${last ? '   ' : '|  '}${line}`);
        if (!last) out.push('|');
      });
      return out;
    }
  }

  return roots.sort(order).map((r) => walk(r).join('\n')).join('\n\n');
}