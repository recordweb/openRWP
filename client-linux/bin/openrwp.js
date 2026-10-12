#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { ClientError } from '../lib/errors.js';
import { formatInitReport, runInit } from '../lib/init.js';
import { pathsIn } from '../lib/paths.js';

const USAGE = `Usage: openrwp <command> [options]

Commands:
  init    Create keys and configuration, check access to the custodian
            --namespace <uuid>   use an already registered namespace
            --label <name>       device label (default: host name)
            --base-url <url>     custodian base URL
            --docs-dir <path>    document folder (absolute path)
`;

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'init') {
    const { values } = parseArgs({
      args: rest,
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
  }
  console.error(USAGE);
  return 2;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  if (err instanceof ClientError) {
    console.error(`error: ${err.message}`);
    process.exitCode = 1;
  } else if (typeof err.code === 'string' && err.code.startsWith('ERR_PARSE_ARGS')) {
    console.error(`error: ${err.message}\n\n${USAGE}`);
    process.exitCode = 2;
  } else {
    throw err;
  }
}