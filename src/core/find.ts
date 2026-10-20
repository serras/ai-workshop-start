/** A skill found in a repository: its SKILL.md, its name and its copies. */
export type SkillFile = { path: string; name: string; copies: string[] };

/**
 * Where agents keep a repository's own skills. The order picks which copy of a
 * duplicated skill is the skill: the shared `.agents` folder first.
 */
export const SKILL_ROOTS = [
  '.agents/skills',
  'agents/skills',
  '.agent/skills',
  'agent/skills',
  '.claude/skills',
  '.github/skills',
  '.cursor/skills',
  '.codex/skills',
  '.gemini/skills',
  '.junie/skills',
  '.opencode/skills',
  '.windsurf/skills',
];

/**
 * Directories whose skills are resources, shipped with the product or used by tests,
 * not the project's own; compared lowercase, without `-` and `_`.
 */
export const RESOURCE_DIRECTORIES = new Set([
  'src',
  'resources',
  'testresources',
  'test',
  'tests',
  'testsrc',
  'testdata',
  'testfixtures',
  'fixture',
  'fixtures',
]);

/**
 * Every file named exactly SKILL.md inside a skill root, at any depth (a module of
 * a monorepo has its own), named after its directory. A SKILL.md anywhere else is
 * not a project skill, nor is one under a resource directory. The same skill in
 * several agents' roots is one skill, and the others are its copies.
 */
export function findSkills(paths: string[]): SkillFile[] {
  const skills = new Map<string, { path: string; rank: number }[]>();
  for (const path of paths) {
    const place = locate(path);
    if (!place) continue;
    const key = `${place.prefix}\0${place.rest}`;
    skills.set(key, [...(skills.get(key) ?? []), { path, rank: place.rank }]);
  }
  return [...skills.values()]
    .map((copies) => copies.sort((a, b) => a.rank - b.rank || (a.path < b.path ? -1 : 1)).map((copy) => copy.path))
    .map(([path, ...copies]) => ({ path, name: path.split('/').at(-2)!, copies }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
}

/**
 * `<prefix><root>/<rest>`, for the first skill root along the path; undefined if the
 * file is not a SKILL.md in a skill's own directory under one.
 */
function locate(path: string): { prefix: string; rank: number; rest: string } | undefined {
  const segments = path.split('/');
  if (segments.at(-1) !== 'SKILL.md') return undefined;
  for (let start = 0; start < segments.length; start++) {
    const rank = SKILL_ROOTS.findIndex((root) => {
      const parts = root.split('/');
      return parts.every((part, index) => segments[start + index] === part);
    });
    if (rank < 0) continue;
    if (segments.slice(0, start).some(isResource)) return undefined;
    const rest = segments.slice(start + SKILL_ROOTS[rank].split('/').length);
    // `<root>/SKILL.md` has no skill directory of its own.
    if (rest.length < 2) return undefined;
    return { prefix: segments.slice(0, start).join('/'), rank, rest: rest.join('/') };
  }
  return undefined;
}

function isResource(segment: string): boolean {
  return RESOURCE_DIRECTORIES.has(segment.toLowerCase().replace(/[-_]/g, ''));
}
