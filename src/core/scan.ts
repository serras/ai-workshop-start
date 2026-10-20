import { findSkills, type SkillFile } from './find.ts';
import { sortRepositories, sortSkills, type Organization, type Repository, type Skill } from './model.ts';
import { parseSkill } from './parse.ts';

/** A repository to scan: its files, and how to read them. */
export type Source = {
  repository: Repository;
  /** Every file path, relative to the repository root. */
  paths: string[];
  /** What listing the files had to leave out. */
  warnings: string[];
  /** The file's bytes, or undefined if it is not there. */
  read(path: string): Promise<Uint8Array | undefined>;
};

export type ScanResult = { repository: Repository; skills: Skill[]; warnings: string[] };

/** An organization to scan: each of its repositories, listed already. */
export type OrganizationSource = {
  organization: Organization;
  repositories: Source[];
  /** What listing the repositories had to leave out. */
  warnings: string[];
};

export type OrganizationResult = {
  organization: Organization;
  /** Every repository, sorted by id; the ones without skills too. */
  repositories: ScanResult[];
  /** The organization's, then each repository's, after its id. */
  warnings: string[];
};

/** How many repositories are read at the same time: on GitHub, each file is a request. */
const REPOSITORIES_AT_ONCE = 8;

/** fetch → find → parse. Nothing is stored: the result is all there is. */
export async function scan(source: Source): Promise<ScanResult> {
  const files = findSkills(source.paths);
  // The files are read at the same time: on GitHub, each one is a request.
  const results = await Promise.all(files.map((file) => readSkill(source, file)));
  return {
    repository: source.repository,
    skills: sortSkills(results.flatMap((result) => (result.skill ? [result.skill] : []))),
    warnings: [...source.warnings, ...results.flatMap((result) => (result.warning ? [result.warning] : []))],
  };
}

/** Every repository of the organization, scanned as one would be on its own. */
export async function scanOrganization(source: OrganizationSource): Promise<OrganizationResult> {
  const results = sortRepositories(await eachLimited(source.repositories, REPOSITORIES_AT_ONCE, scan));
  return {
    organization: source.organization,
    repositories: results,
    warnings: [
      ...source.warnings,
      ...results.flatMap((result) => result.warnings.map((warning) => `${result.repository.id}: ${warning}`)),
    ],
  };
}

/** Whether what was opened is an organization rather than a single repository. */
export function isOrganization(source: Source | OrganizationSource): source is OrganizationSource {
  return 'organization' in source;
}

/** `fn` on every item, at most `limit` at a time; the results in the items' order. */
export async function eachLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function readSkill(source: Source, file: SkillFile): Promise<{ skill?: Skill; warning?: string }> {
  const bytes = await source.read(file.path);
  if (!bytes) return { warning: `${file.path}: listed, but not found at the scanned commit; skipped` };
  const text = new TextDecoder().decode(bytes);
  const parsed = parseSkill(text);
  const skill: Skill = {
    id: `${source.repository.id}:${file.path}`,
    repository: source.repository.id,
    path: file.path,
    name: parsed.name ?? file.name,
    description: parsed.description,
    commit: source.repository.commit,
    copies: file.copies,
    text,
  };
  return { skill, warning: parsed.warning && `${file.path}: ${parsed.warning}` };
}
