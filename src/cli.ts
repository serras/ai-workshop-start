#!/usr/bin/env node
// The Node client: a GitHub repository through the GitHub API, or a local directory; stdout and
// stderr, in colors on a terminal, or a web view on localhost, its skills grouped by Claude. Nothing
// is stored.
import { styleText } from 'node:util';
import { claude } from './claude.ts';
import { run, type Style } from './commands.ts';
import { isGitHubAddress, openGitHub, openGitHubOrganization, parseGitHubOrganization } from './core/github.ts';
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
  parseGitHubOrganization(input)
    ? openGitHubOrganization(input, { fetch, token })
    : // Any other GitHub address is a repository's, or openGitHub says what is wrong with it.
      isGitHubAddress(input)
      ? openGitHub(input, { fetch, token })
      : openDirectory(input);

process.exitCode = await run(process.argv.slice(2), {
  open,
  print: (text) => console.log(text),
  error: (text) => console.error(text),
  // The skills grouped by Claude on this machine; SKILL_ATLAS_CLAUDE, another executable than `claude`.
  serve: async (port) => (await startWeb({ open, model: claude({ command: process.env.SKILL_ATLAS_CLAUDE || undefined }), port })).url,
  // Only on a terminal: NO_COLOR turns the colors off, FORCE_COLOR on, as Node decides.
  paint: (style, text, stream) => styleText(COLORS[style], text, { stream: stream === 'out' ? process.stdout : process.stderr }),
});
