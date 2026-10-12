#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { ApiError } from '../lib/api.js';
import { openContext } from '../lib/context.js';
import { resolveDocName } from '../lib/documents.js';
import { ClientError } from '../lib/errors.js';
import { renderGraph } from '../lib/graph-ascii.js';
import { loadHistory } from '../lib/history.js';
import { formatInitReport, runInit } from '../lib/init.js';
import { formatList, listDocuments } from '../lib/list.js';
import { pathsIn } from '../lib/paths.js';
import { formatPush, pushFile } from '../lib/push.js';
import { createLink, formatCreated, formatLinks, listLinks, revokeLinks } from '../lib/settings.js';

const USAGE = `Usage: openrwp <command> [options]

Commands:
  init              Create keys and configuration, check access to the custodian
                      --namespace <uuid>   use an already registered namespace
                      --label <name>       device label (default: host name)
                      --base-url <url>     custodian base URL
                      --docs-dir <path>    document folder (absolute path)
  push <file>       Save the current content of a document as a new version
  list              Show the documents and their status
  graph <file>      Show the version graph of a document (--full: complete hashes)
  settings <file>   List the capability links of a document
                      --create [--days N]  create a read link (1-30 days, default 7)
                      --revoke <id>        revoke one link (at least 4 characters of the id)
                      --revoke-all         revoke all links
`;

const usage = (detail) => new ClientError('usage', detail);

function oneFile(positionals, command) {
  if (positionals.length !== 1) throw usage(`${command} needs exactly one file`);
  return positionals[0];
}

const COMMANDS = {
  async init(args) {
    const { values } = parseArgs({
      args,
      options: {
        namespace: { type: 'string' },
        label: { type: 'string' },
        'base-url': { type: 'string' },
        'docs-dir': { type: 'string' },
      },
      allowPositionals: false,
    });
    const result = await runInit({
      paths: pathsIn(),
      namespace: values.namespace,
      deviceLabel: values.label,
      baseUrl: values['base-url'],
      docsDir: values['docs-dir'],
    });
    console.log(formatInitReport(result));
    return ['ok', 'not-registered'].includes(result.access.status) ? 0 : 1;
  },

  async push(args) {
    const { positionals } = parseArgs({ args, allowPositionals: true });
    const context = openContext();
    const fileName = resolveDocName(context.config.docsDir, oneFile(positionals, 'push'));
    console.log(formatPush(await pushFile({ ...context, fileName })));
    return 0;
  },

  async list(args) {
    parseArgs({ args, allowPositionals: false });
    console.log(formatList(listDocuments(openContext())));
    return 0;
  },

  async graph(args) {
    const { values, positionals } = parseArgs({ args, options: { full: { type: 'boolean' } }, allowPositionals: true });
    const context = openContext();
    const fileName = resolveDocName(context.config.docsDir, oneFile(positionals, 'graph'));
    const { entry, versions, heads } = await loadHistory({ ...context, fileName });
    console.log(renderGraph({ versions, heads, localHead: entry.head ?? undefined, full: values.full === true }));
    return 0;
  },

  async settings(args) {
    const { values, positionals } = parseArgs({
      args,
      options: {
        create: { type: 'boolean' },
        days: { type: 'string' },
        revoke: { type: 'string' },
        'revoke-all': { type: 'boolean' },
      },
      allowPositionals: true,
    });
    const actions = [values.create === true, values.revoke !== undefined, values['revoke-all'] === true];
    if (actions.filter(Boolean).length > 1) throw usage('use only one of --create, --revoke, --revoke-all');
    if (values.days !== undefined && !values.create) throw usage('--days belongs to --create');

    const context = openContext();
    const fileName = resolveDocName(context.config.docsDir, oneFile(positionals, 'settings'));
    const run = { ...context, fileName };

    if (values.create) {
      let days;
      if (values.days !== undefined) days = /^\d+$/.test(values.days) ? Number(values.days) : Number.NaN;
      console.log(formatCreated(await createLink({ ...run, days }), fileName));
    } else if (values.revoke !== undefined) {
      const { revoked } = await revokeLinks({ ...run, idPrefix: values.revoke });
      console.log(`Revoked link ${revoked[0].slice(0, 8)}.`);
    } else if (values['revoke-all']) {
      const { revoked } = await revokeLinks({ ...run, all: true });
      console.log(`Revoked ${revoked.length} link(s).`);
    } else {
      console.log(formatLinks((await listLinks(run)).links));
    }
    return 0;
  },
};

const [command, ...rest] = process.argv.slice(2);
try {
  if (!Object.hasOwn(COMMANDS, command ?? '')) {
    console.error(USAGE);
    process.exitCode = 2;
  } else {
    process.exitCode = await COMMANDS[command](rest);
  }
} catch (err) {
  if (err instanceof ApiError) {
    console.error(`error: ${err.message} (HTTP ${err.status})`);
    process.exitCode = 1;
  } else if (err instanceof ClientError && err.code === 'usage') {
    console.error(`error: ${err.message}\n\n${USAGE}`);
    process.exitCode = 2;
  } else if (err instanceof ClientError) {
    console.error(`error: ${err.message}`);
    process.exitCode = 1;
  } else if (typeof err.code === 'string' && err.code.startsWith('ERR_PARSE_ARGS')) {
    console.error(`error: ${err.message}\n\n${USAGE}`);
    process.exitCode = 2;
  } else {
    throw err;
  }
}