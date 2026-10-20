// The web view: the page in src/web, and the scan as JSON for it. It only listens on this
// machine, and only answers to its own address, since it reads local directories.
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AtlasError } from './core/errors.ts';
import { filesLink, skillLink } from './core/model.ts';
import { isOrganization, scan, scanOrganization, type OrganizationSource, type ScanResult, type Source } from './core/scan.ts';
import { renderSkill, renderSummary } from './render.ts';

export type WebOptions = {
  /** Opens what the user asked to scan, as the CLI does. */
  open(input: string): Promise<Source | OrganizationSource>;
  /** 0 for any free port. */
  port: number;
};

export type WebServer = { url: string; close(): Promise<void> };

const PAGES: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/filter.js': { file: 'filter.js', type: 'text/javascript; charset=utf-8' },
  '/style.css': { file: 'style.css', type: 'text/css; charset=utf-8' },
};

/** The SKILL.md files render as HTML in the page: whatever they hold, no script of theirs runs. */
const HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src https: data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

const HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Listens on localhost; the address it serves at once it does. */
export async function startWeb(options: WebOptions): Promise<WebServer> {
  const server = createServer((request, response) => {
    handle(request, response, options).catch((error) => {
      if (!response.headersSent) send(response, 500, { error: `Unexpected error: ${message(error)}` });
      else response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) =>
      reject(
        error.code === 'EADDRINUSE'
          ? new AtlasError(`Port ${options.port} is in use; pick another with --port`)
          : new AtlasError(`Cannot serve on port ${options.port}: ${error.message}`),
      ),
    );
    server.listen(options.port, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://localhost:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function handle(request: IncomingMessage, response: ServerResponse, options: WebOptions) {
  // Another site that resolves its name to this machine must not read through it.
  const host = (request.headers.host ?? '').replace(/:\d+$/, '');
  if (!HOSTS.has(host)) return send(response, 403, { error: `Not served for ${host || 'no host'}` });
  if (request.method !== 'GET') return send(response, 405, { error: 'Only GET' });
  const url = new URL(request.url ?? '/', 'http://localhost');

  if (url.pathname === '/api/scan') {
    const repo = url.searchParams.get('repo')?.trim();
    if (!repo) return send(response, 400, { error: 'Type a GitHub URL or a directory' });
    try {
      return send(response, 200, await scanJson(repo, options));
    } catch (error) {
      if (!(error instanceof AtlasError)) throw error;
      return send(response, 400, { error: error.message });
    }
  }

  const page = PAGES[url.pathname];
  if (!page) return send(response, 404, { error: `Not found: ${url.pathname}` });
  const body = await readFile(new URL(`./web/${page.file}`, import.meta.url));
  response.writeHead(200, { ...HEADERS, 'Content-Type': page.type, 'Cache-Control': 'no-cache' });
  response.end(body);
}

/** What `/api/scan` answers; `{ error }` when the scan fails. */
export type ScanAnswer = Awaited<ReturnType<typeof scanJson>>;

/**
 * What the page shows: what was scanned, a repository or an organization; each repository with
 * skills, the skills with their HTML and their summaries; and the warnings. A repository on its own
 * is there even without skills.
 */
async function scanJson(repo: string, options: WebOptions) {
  const source = await options.open(repo);
  if (!isOrganization(source)) {
    const result = await scan(source);
    return { id: result.repository.id, organization: undefined, repositories: [repositoryJson(result)], warnings: result.warnings };
  }
  const { organization, repositories, warnings } = await scanOrganization(source);
  return {
    id: organization.id,
    organization,
    repositories: repositories.filter((result) => result.skills.length > 0).map(repositoryJson),
    warnings,
  };
}

function repositoryJson({ repository, skills }: ScanResult) {
  const root = filesLink(repository);
  return {
    repository,
    skills: skills.map((skill) => {
      const link = skillLink(repository, skill);
      return {
        id: skill.id,
        repository: skill.repository,
        name: skill.name,
        description: skill.description,
        summary: renderSummary(skill.description, { link, root }),
        path: skill.path,
        copies: skill.copies,
        link,
        html: renderSkill(skill.text, { link, root }),
      };
    }),
  };
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
