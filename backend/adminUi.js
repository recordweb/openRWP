// Static files of the admin page (served by admin.js behind the same login as the admin API).

export const adminHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenRWP admin</title>
  <link rel="stylesheet" href="app.css">
</head>
<body>
  <header><h1>OpenRWP admin</h1></header>
  <main id="app">Loading ...</main>
  <script src="app.js"></script>
</body>
</html>
`;

export const adminCss = `
body { font-family: system-ui, sans-serif; margin: 0; color: #1b1f24; background: #f6f8fa; }
header { background: #0b3d6e; color: #fff; padding: 0.6rem 1rem; }
header h1 { margin: 0; font-size: 1.2rem; }
main { max-width: 60rem; margin: 1rem auto; padding: 0 1rem; }
table { border-collapse: collapse; width: 100%; background: #fff; }
th, td { border: 1px solid #d0d7de; padding: 0.35rem 0.5rem; text-align: left; vertical-align: top; }
th { background: #eaeef2; }
label { display: block; margin: 0.5rem 0; }
input { display: block; width: 100%; max-width: 32rem; padding: 0.3rem; box-sizing: border-box; }
button { margin: 0.4rem 0.4rem 0.4rem 0; padding: 0.35rem 0.8rem; cursor: pointer; }
code { font-size: 0.85rem; word-break: break-all; }
.notice { min-height: 1.4rem; padding: 0.3rem 0.5rem; background: #ddf4ff; border: 1px solid #54aeff; }
.notice:empty { visibility: hidden; }
.notice.error { background: #ffebe9; border-color: #ff8182; }
section { background: #fff; border: 1px solid #d0d7de; padding: 0.5rem 1rem; margin: 1rem 0; }
.muted { color: #57606a; }
`;

export const adminJs = `(() => {
  'use strict';
  const app = document.getElementById('app');

  async function api(path, { method = 'GET', body } = {}) {
    const headers = { 'X-Requested-With': 'fetch' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch('api/' + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail ? data.error + ': ' + data.detail : (data.error || 'HTTP ' + res.status));
    return data;
  }

  // Builds DOM nodes; text is always added as text nodes (never as HTML).
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (key === 'class') node.className = value;
      else if (key === 'value') node.value = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(typeof child === 'object' ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  const notice = el('p', { class: 'notice' });
  function say(message, isError) {
    notice.textContent = message;
    notice.className = isError ? 'notice error' : 'notice';
  }
  async function guarded(task) {
    try { await task(); } catch (err) { say(err.message, true); }
  }
  const field = (label, input) => el('label', {}, label, input);
  const input = (props) => el('input', Object.assign({ type: 'text' }, props));
  const shortKey = (jkt) => (jkt ? String(jkt).slice(0, 12) + '...' : '');

  async function showList() {
    const { namespaces } = await api('namespaces');
    const label = input({ placeholder: 'Label' });
    const key = input({ placeholder: 'z6Mk...' });
    const id = input({ placeholder: 'optional, generated if empty' });
    const create = el('button', {
      type: 'button',
      onclick: () => guarded(async () => {
        const body = { label: label.value, authorPublicKey: key.value };
        if (id.value.trim()) body.namespace = id.value.trim();
        const created = await api('namespaces', { method: 'POST', body });
        location.hash = '#/ns/' + created.namespace;
      }),
    }, 'Create namespace');
    app.replaceChildren(
      el('h2', {}, 'Namespaces'),
      notice,
      el('table', {},
        el('thead', {}, el('tr', {}, ['Label', 'Namespace', 'Status', 'Agent', 'Devices', 'Records'].map((t) => el('th', {}, t)))),
        el('tbody', {}, namespaces.map((n) => el('tr', {},
          el('td', {}, el('a', { href: '#/ns/' + n.namespace }, n.label)),
          el('td', {}, el('code', {}, n.namespace)),
          el('td', {}, n.status),
          el('td', {}, n.agentRecordId ? 'yes' : '-'),
          el('td', {}, n.devices),
          el('td', {}, n.records),
        )))),
      el('section', {},
        el('h3', {}, 'New namespace'),
        field('Label', label),
        field('Author public key (multibase)', key),
        field('Namespace UUID', id),
        create),
    );
  }

  async function showNamespace(ns) {
    const d = await api('namespaces/' + ns);
    const reload = async (message) => { await showNamespace(ns); say(message, false); };

    const label = input({ value: d.label });
    const saveLabel = el('button', {
      type: 'button',
      onclick: () => guarded(async () => {
        await api('namespaces/' + ns, { method: 'PATCH', body: { label: label.value } });
        await reload('Label saved');
      }),
    }, 'Save label');
    const toggle = el('button', {
      type: 'button',
      onclick: () => guarded(async () => {
        const next = d.status === 'active' ? 'suspended' : 'active';
        if (next === 'suspended' && !window.confirm('Suspend this namespace? Its devices and links stop working.')) return;
        await api('namespaces/' + ns, { method: 'PATCH', body: { status: next } });
        await reload('Status is now ' + next);
      }),
    }, d.status === 'active' ? 'Suspend' : 'Activate');

    const name = input({ value: d.agent ? d.agent.name : '' });
    const email = input({ value: d.agent ? d.agent.email : '' });
    const saveAgent = el('button', {
      type: 'button',
      onclick: () => guarded(async () => {
        await api('namespaces/' + ns + '/agent', { method: 'PUT', body: { name: name.value, email: email.value } });
        await reload('Agent saved');
      }),
    }, 'Save agent');

    const deviceLabel = input({ placeholder: 'e.g. Laptop' });
    const deviceKey = input({ placeholder: 'public key x (base64url)' });
    const addDevice = el('button', {
      type: 'button',
      onclick: () => guarded(async () => {
        await api('namespaces/' + ns + '/devices', { method: 'POST', body: { label: deviceLabel.value, publicKey: deviceKey.value } });
        await reload('Device registered');
      }),
    }, 'Register device');

    const deviceRows = d.devices.map((dev) => el('tr', {},
      el('td', {}, dev.id),
      el('td', {}, dev.label),
      el('td', {}, el('code', {}, shortKey(dev.jkt))),
      el('td', {}, dev.revokedAt ? 'revoked ' + dev.revokedAt : 'active'),
      el('td', {}, dev.revokedAt ? null : el('button', {
        type: 'button',
        onclick: () => guarded(async () => {
          if (!window.confirm('Revoke device ' + dev.label + '?')) return;
          await api('devices/' + dev.id + '/revoke', { method: 'POST' });
          await reload('Device revoked');
        }),
      }, 'Revoke')),
    ));

    app.replaceChildren(
      el('p', {}, el('a', { href: '#/' }, 'All namespaces')),
      el('h2', {}, d.label),
      notice,
      el('section', {},
        el('h3', {}, 'Namespace'),
        el('p', {}, el('code', {}, d.namespace)),
        el('p', { class: 'muted' }, 'Status: ' + d.status + ' | created ' + d.createdAt),
        el('p', { class: 'muted' }, 'Author key (cannot be changed, RWP 4.3): '),
        el('p', {}, el('code', {}, d.authorPublicKey)),
        field('Label', label), saveLabel, toggle),
      el('section', {},
        el('h3', {}, 'Agent'),
        el('p', { class: 'muted' }, d.agent ? 'AgentRecord: ' + d.agent.did : 'No AgentRecord yet. Saving creates it.'),
        field('Name', name), field('Email', email), saveAgent),
      el('section', {},
        el('h3', {}, 'Devices'),
        el('table', {},
          el('thead', {}, el('tr', {}, ['ID', 'Label', 'Key', 'Status', ''].map((t) => el('th', {}, t)))),
          el('tbody', {}, deviceRows)),
        field('Label', deviceLabel), field('Public key x', deviceKey), addDevice),
      el('section', {},
        el('h3', {}, 'Records (' + d.records.length + ')'),
        d.records.length === 0 ? el('p', { class: 'muted' }, 'No records yet.') : null,
        el('ul', {}, d.records.map((did) => el('li', {}, el('code', {}, did))))),
    );
  }

  function route() {
    const match = /^#\\/ns\\/([0-9a-f-]{36})$/.exec(location.hash);
    guarded(() => (match ? showNamespace(match[1]) : showList()));
  }
  window.addEventListener('hashchange', route);
  route();
})();
`;