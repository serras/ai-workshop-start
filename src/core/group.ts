// The skill map: the skills grouped by affinity, by a model such as Claude, each group named after
// the kind of skills in it. When the model cannot, the skills are grouped by repository.
import { sortSkills, type Skill } from './model.ts';

/** Asks a model: the prompt in, its answer out; it throws when it cannot answer. */
export type Model = (prompt: string) => Promise<string>;

/** A group of skills: its name, and its skills' ids, sorted by name. */
export type Group = { name: string; skills: string[] };

export type Grouping = { groups: Group[]; warnings: string[] };

/** The groups of each prompt, kept once the answer is a grouping: a failure is asked again. */
export type Groupings = Map<string, Promise<Group[]>>;

/** The group of the skills the model's answer leaves out. */
export const OTHER = 'Other';

/** What the model is asked: each skill numbered, with its name and its description, on one line. */
export function groupPrompt(skills: Skill[]): string {
  return `Group these agent skills by affinity: skills about the same kind of task go together.
Give each group a short name, a few words, that says what kind of skills it holds, so that the
names alone give a good idea of the skills to be found here. Make as few groups as make sense:
one for a handful of skills, rarely more than ten. Put every skill in exactly one group.
Answer with JSON only, in this shape: {"groups": [{"name": "…", "skills": [1, 2]}]}

Skills:
${sortSkills(skills)
  .map((skill, index) => `${index + 1}. ${skill.name}${skill.description ? `: ${skill.description.replace(/\s+/g, ' ')}` : ''}`)
  .join('\n')}
`;
}

/**
 * The skills by affinity, as the model groups them: groups sorted by name ignoring case, a skill
 * the answer leaves out in `Other`, last. No skill, no question. The model fails, or its answer is
 * not a grouping → by repository, and a warning. With `known`, the same skills are asked about once.
 */
export async function groupSkills(skills: Skill[], model: Model, known: Groupings = new Map()): Promise<Grouping> {
  if (skills.length === 0) return { groups: [], warnings: [] };
  const sorted = sortSkills(skills);
  const prompt = groupPrompt(sorted);
  let groups = known.get(prompt);
  if (!groups) {
    groups = model(prompt).then((answer) => parseGroups(answer, sorted));
    known.set(prompt, groups);
    groups.catch(() => known.delete(prompt));
  }
  try {
    return { groups: await groups, warnings: [] };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { groups: byRepository(sorted), warnings: [`Skills grouped by repository, not by affinity: ${reason}`] };
  }
}

/** The groups in the answer, numbers turned into ids; a skill listed twice stays in its first group. */
function parseGroups(answer: string, skills: Skill[]): Group[] {
  // The JSON, even when the model wraps it in a code block or a sentence.
  const json = answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('its answer is not JSON');
  }
  const groups = (parsed as { groups?: unknown })?.groups;
  if (!Array.isArray(groups)) throw new Error('its answer has no groups');
  const placed = new Set<number>();
  const named = new Map<string, Skill[]>();
  for (const entry of groups as { name?: unknown; skills?: unknown }[]) {
    const trimmed = typeof entry?.name === 'string' ? entry.name.trim() : '';
    const name = trimmed.toLowerCase() === OTHER.toLowerCase() ? OTHER : trimmed;
    if (!name || !Array.isArray(entry.skills)) continue;
    const members = (entry.skills as unknown[]).filter(
      (n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= skills.length && !placed.has(n),
    );
    for (const n of members) placed.add(n);
    named.set(name, [...(named.get(name) ?? []), ...members.map((n) => skills[n - 1])]);
  }
  if (placed.size === 0) throw new Error('its answer groups no skill');
  const other = skills.filter((_, index) => !placed.has(index + 1));
  const result = sortGroups(
    [...named].filter(([name, members]) => members.length > 0 && name !== OTHER).map(([name, members]) => group(name, members)),
  );
  const rest = [...(named.get(OTHER) ?? []), ...other];
  return rest.length ? [...result, group(OTHER, rest)] : result;
}

/** Each repository a group of its own, named after it, sorted as for `scan`. */
export function byRepository(skills: Skill[]): Group[] {
  const repositories = Map.groupBy(skills, (skill) => skill.repository);
  return sortGroups([...repositories].map(([id, members]) => group(id, members)));
}

function group(name: string, skills: Skill[]): Group {
  return { name, skills: sortSkills(skills).map((skill) => skill.id) };
}

/** By name ignoring case, then as is, whatever the locale. */
function sortGroups(groups: Group[]): Group[] {
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return groups.sort((a, b) => compare(a.name.toLowerCase(), b.name.toLowerCase()) || compare(a.name, b.name));
}
