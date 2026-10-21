#!/usr/bin/env node
// The Node client: a GitHub repository through the GitHub API, or a local directory; stdout and
// stderr, in colors on a terminal, or a web view on localhost. Nothing is stored.
import { styleText } from 'node:util';
import { run, type Style } from './commands.ts';
import { openGitHub, openGitHubOrganization, parseGitHubOrganization, parseGitHubUrl } from './core/github.ts';
import type { OrganizationSource, Source } from './core/scan.ts';
import { openDirectory } from './local.ts';
import { startWeb } from './web.ts';

const token = process.env.GITHUB_TOKEN || undefined;

const COLORS: Record<Style, Parameters<typeof styleText>[0]> = {
  heading: 'bold',
  name: ['bold', 'cyan'],
  faint: 'dim',
  warning: 'yellow',
  error: 'red',
};

const open = (input: string): Promise<Source | OrganizationSource> =>
  parseGitHubUrl(input)
    ? openGitHub(input, { fetch, token })
    : parseGitHubOrganization(input)
      ? openGitHubOrganization(input, { fetch, token })
      : openDirectory(input);

process.exitCode = await run(process.argv.slice(2), {
  open,
  print: (text) => console.log(text),
  error: (text) => console.error(text),
  serve: async (port) => (await startWeb({ open, port })).url,
  // Only on a terminal: NO_COLOR turns the colors off, FORCE_COLOR on, as Node decides.
  paint: (style, text, stream) => styleText(COLORS[style], text, { stream: stream === 'out' ? process.stdout : process.stderr }),
});
