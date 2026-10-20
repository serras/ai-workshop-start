import { AtlasError } from './errors.ts';
import { SKILL_ROOTS } from './find.ts';
import { eachLimited, type OrganizationSource, type Source } from './scan.ts';

/** The part of `fetch` the core uses, so tests and the browser can pass their own. */
export type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

export type GitHubOptions = {
  fetch: Fetch;
  /** With a token, skills are found through code search; without it, through the tree. */
  token?: string;
};

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

/**
 * `https://github.com/owner/repo`, with or without the scheme, a trailing slash or `.git`;
 * `…/tree/<ref>` pins a branch, a tag or a commit.
 */
export function parseGitHubUrl(input: string): { owner: string; repo: string; ref?: string } | undefined {
  const match = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^\s?#]+?))?\/?$/i.exec(
    input.trim(),
  );
  if (!match) return undefined;
  return match[3] ? { owner: match[1], repo: match[2], ref: match[3] } : { owner: match[1], repo: match[2] };
}

/**
 * `https://github.com/<owner>`, with or without the scheme or a trailing slash: an organization, or a
 * user's account; its login.
 */
export function parseGitHubOrganization(input: string): string | undefined {
  return /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/?$/i.exec(input.trim())?.[1];
}

/** What GitHub says about a repository, the part the scan uses. */
type Info = { full_name: string; default_branch: string };

/** Resolves the ref, or else the default branch, to a commit and lists the files that may be skills. */
export async function openGitHub(input: string, options: GitHubOptions): Promise<Source> {
  const name = parseGitHubUrl(input);
  if (!name) throw new AtlasError(`Not a GitHub repository URL: ${input}`);
  const github = client(options);
  const info = await github.json<Info>(
    `${API}/repos/${name.owner}/${name.repo}`,
    `Repository not found: https://github.com/${name.owner}/${name.repo}`,
  );
  // Code search only looks at the default branch: a pinned ref is listed through its tree.
  return openRepository(github, info, name.ref, (id, sha, warnings) =>
    options.token && !name.ref
      ? searchPaths(github, id, warnings)
      : treePaths(github, id, sha, warnings, name.ref ? '' : ' (GITHUB_TOKEN searches everywhere)'),
  );
}

/** How many repositories of an organization are opened at the same time. */
const REPOSITORIES_AT_ONCE = 8;

/**
 * Every repository of the organization, or of the user, at its default branch. With a token, one
 * code search finds the skills of all of them, and only the repositories it finds are opened;
 * without one, each repository's tree is listed. Empty repositories have nothing to scan.
 */
export async function openGitHubOrganization(input: string, options: GitHubOptions): Promise<OrganizationSource> {
  const owner = parseGitHubOrganization(input);
  if (!owner) throw new AtlasError(`Not a GitHub organization URL: ${input}`);
  const github = client(options);
  const account = await github.json<{ login: string; type: string }>(
    `${API}/users/${owner}`,
    `Organization not found: https://github.com/${owner}`,
  );
  const login = account.login;
  const user = account.type !== 'Organization';
  const listed = (await listRepositories(github, user ? `${API}/users/${login}/repos?type=owner` : `${API}/orgs/${login}/repos?type=all`))
    // A disabled repository cannot be read.
    .filter((repo) => !repo.disabled);
  const warnings: string[] = [];
  let repositories: Info[] = listed;
  let list: (id: string, sha: string, warnings: string[]) => Promise<string[]>;
  if (options.token) {
    const found = await searchOwner(github, `${user ? 'user' : 'org'}:${login}`, warnings);
    repositories = listed.filter((repo) => found.has(repo.full_name));
    list = async (id) => found.get(id)!;
  } else {
    list = (id, sha, repositoryWarnings) => treePaths(github, id, sha, repositoryWarnings, ' (GITHUB_TOKEN searches everywhere)');
  }
  const sources = await eachLimited(repositories, REPOSITORIES_AT_ONCE, (repo) =>
    openRepository(github, repo, undefined, list).catch((error) => {
      if (error instanceof EmptyRepository) return undefined;
      throw error;
    }),
  );
  return {
    organization: { id: login, url: `https://github.com/${login}` },
    repositories: sources.filter((source) => source !== undefined),
    warnings,
  };
}

/** The repository at the ref, or its default branch, with the files `list` finds at that commit. */
async function openRepository(
  github: Client,
  info: Info,
  ref: string | undefined,
  list: (id: string, sha: string, warnings: string[]) => Promise<string[]>,
): Promise<Source> {
  const id = info.full_name;
  const at = ref ?? info.default_branch;
  const { sha } = await github
    .json<{ sha: string }>(`${API}/repos/${id}/commits/${encodePath(at)}`, `Not found in https://github.com/${id}: ${at}`)
    .catch((error) => {
      throw error instanceof EmptyRepository ? new EmptyRepository(`The repository is empty: https://github.com/${id}`) : error;
    });
  const warnings: string[] = [];
  const paths = await list(id, sha, warnings);
  const [organization, repo] = id.split('/');
  return {
    repository: { id, organization, name: repo, url: `https://github.com/${id}`, commit: sha },
    paths,
    warnings,
    read: (path) => github.raw(`${RAW}/${id}/${sha}/${encodePath(path)}`),
  };
}

/** Every repository the owner has, 100 a page. */
async function listRepositories(github: Client, url: string): Promise<(Info & { disabled?: boolean })[]> {
  const repositories: (Info & { disabled?: boolean })[] = [];
  for (let page = 1; ; page++) {
    const answer = await github.json<(Info & { disabled?: boolean })[]>(`${url}&per_page=100&page=${page}`);
    repositories.push(...answer);
    if (answer.length < 100) return repositories;
  }
}

type Found = { path: string; repository: { full_name: string } };

/** Code search looks at the whole default branch, 100 results a page. */
async function searchPaths(github: Client, id: string, warnings: string[]): Promise<string[]> {
  return [...new Set((await search(github, `repo:${id}`, warnings)).map((item) => item.path))];
}

/** Every repository's SKILL.md files, forks included, by repository; one search for the whole owner. */
async function searchOwner(github: Client, qualifier: string, warnings: string[]): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  for (const { path, repository } of await search(github, `${qualifier}+fork:true`, warnings)) {
    const paths = found.get(repository.full_name) ?? [];
    if (!paths.includes(path)) paths.push(path);
    found.set(repository.full_name, paths);
  }
  return found;
}

/** Every SKILL.md code search finds for the qualifiers; pages can repeat a result. */
async function search(github: Client, qualifiers: string, warnings: string[]): Promise<Found[]> {
  const items: Found[] = [];
  let total = 0;
  // GitHub returns at most 1000 results: ten pages.
  for (let page = 1; page <= 10; page++) {
    const result = await github.json<{ total_count: number; items: Found[] }>(
      `${API}/search/code?q=filename:SKILL.md+${qualifiers}&per_page=100&page=${page}`,
    );
    total = result.total_count;
    items.push(...result.items);
    if (result.items.length < 100 || page * 100 >= total) break;
  }
  if (total > 1000) warnings.push(`code search found ${total} SKILL.md files but answers only 1000; some skills may be missing`);
  return items;
}

type Tree = { truncated: boolean; tree: { path: string; mode: string; type: string; sha: string }[] };

/** The whole tree at once, or only the skill roots when it is too large for one answer. */
async function treePaths(github: Client, id: string, sha: string, warnings: string[], hint: string): Promise<string[]> {
  const tree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${sha}?recursive=1`);
  if (!tree.truncated) return files(tree);
  warnings.push(`the tree is too large to list at once; looked only in ${SKILL_ROOTS.join(', ')}${hint}`);
  const paths: string[] = [];
  for (const root of SKILL_ROOTS) {
    const rootSha = await directory(github, id, sha, root);
    if (!rootSha) continue;
    const subtree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${rootSha}?recursive=1`);
    paths.push(...files(subtree).map((path) => `${root}/${path}`));
  }
  return paths;
}

/** Walks down one level at a time; the directory's tree, or undefined if it does not exist. */
async function directory(github: Client, id: string, sha: string, path: string): Promise<string | undefined> {
  let current = sha;
  for (const segment of path.split('/')) {
    const tree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${current}`);
    const entry = tree.tree.find((item) => item.path === segment && item.type === 'tree');
    if (!entry) return undefined;
    current = entry.sha;
  }
  return current;
}

/** Regular files only: a symbolic link's content is its target, not a SKILL.md. */
function files(tree: Tree): string[] {
  return tree.tree.filter((item) => item.type === 'blob' && item.mode !== '120000').map((item) => item.path);
}

/** A repository without a commit: an organization's is skipped, a single one is an error. */
class EmptyRepository extends AtlasError {}

type Client = ReturnType<typeof client>;

function client({ fetch, token }: GitHubOptions) {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const answers = new Map<string, Promise<unknown>>(); // the root tree is asked for once per skill root

  async function get(url: string, init?: { headers: Record<string, string> }): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (error) {
      throw new AtlasError(`Cannot reach GitHub: ${describe(error)}`);
    }
  }

  async function request(url: string, notFound: string): Promise<unknown> {
    const response = await get(url, { headers });
    if (response.ok) return response.json();
    const body: unknown = await response.json().catch(() => undefined);
    const message = (body as { message?: unknown } | undefined)?.message;
    const text = typeof message === 'string' ? message : '';
    if (response.status === 404) throw new AtlasError(notFound);
    if ((response.status === 403 || response.status === 429) && /rate limit/i.test(text)) {
      throw new AtlasError(`GitHub rate limit reached; ${token ? 'try again in a minute' : 'set GITHUB_TOKEN'}`);
    }
    // GitHub's answer for the commits of a repository without any.
    if (response.status === 409 && /empty/i.test(text)) throw new EmptyRepository(text);
    if (response.status === 401) throw new AtlasError('GitHub rejected the token in GITHUB_TOKEN');
    throw new AtlasError(`GitHub answered ${response.status} for ${url}${text && `: ${text}`}`);
  }

  return {
    /** A GitHub API answer; `notFound` explains a 404. */
    json<T>(url: string, notFound = `Not found on GitHub: ${url}`): Promise<T> {
      if (!answers.has(url)) answers.set(url, request(url, notFound));
      return answers.get(url) as Promise<T>;
    },
    /** A file's bytes at the scanned commit, or undefined if it is not there. */
    async raw(url: string): Promise<Uint8Array | undefined> {
      const response = await get(url);
      if (response.status === 404) return undefined;
      if (!response.ok) throw new AtlasError(`GitHub answered ${response.status} for ${url}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message;
}
