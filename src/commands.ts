// The skill-atlas commands. The same code serves the Node CLI and the browser
// terminal: everything that differs between them comes in through the context.
import { AtlasError } from './core/errors.ts';
import { skillLink, type Repository, type Skill } from './core/model.ts';
import { firstSentence } from './core/parse.ts';
import { isOrganization, scan, scanOrganization, type OrganizationResult, type OrganizationSource, type Source } from './core/scan.ts';

export type Context = {
  /** Opens what the user asked to scan: a repository, or every repository of an organization. */
  open(input: string): Promise<Source | OrganizationSource>;
  print(text: string): void;
  /** Errors and warnings. */
  error(text: string): void;
  /** Serves the web view on the port; its address. Only where a server can run. */
  serve?(port: number): Promise<string>;
  /** The text in a style, for `print` (`out`) or `error` (`err`); as it is without colors. */
  paint?(style: Style, text: string, stream: 'out' | 'err'): string;
};

/** What the output's colors mean: the CLI picks the colors, and whether to show them. */
export type Style = 'heading' | 'name' | 'faint' | 'warning' | 'error';

export const DEFAULT_PORT = 3000;

const usage = `Usage: skill-atlas <command>

  scan <GitHub URL | directory>   find every SKILL.md in a repository, or in all of an
                                  organization's (github.com/<owner>), and print it
  serve [--port <port>]           the same, as a web view on localhost (port ${DEFAULT_PORT})
  help                            show this help`;

/** Runs one command; returns its exit code. */
export async function run(args: string[], context: Context): Promise<number> {
  const [command = 'help', ...rest] = args;
  try {
    if (command === 'scan') await scanCommand(rest, context);
    else if (command === 'serve') await serveCommand(rest, context);
    else if (command === 'help') context.print(usage);
    else throw new AtlasError(`Unknown command: ${command}\n\n${usage}`);
    return 0;
  } catch (error) {
    if (!(error instanceof AtlasError)) throw error;
    context.error(paint(context, 'error', error.message, 'err'));
    return 1;
  }
}

async function scanCommand(args: string[], context: Context) {
  if (args.length !== 1) throw new AtlasError('Usage: skill-atlas scan <GitHub URL | directory>');
  const source = await context.open(args[0]);
  const result = isOrganization(source) ? await scanOrganization(source) : await scan(source);
  if ('organization' in result) printOrganization(result, context);
  else printRepository(result.repository, result.skills, context);
  for (const warning of result.warnings) context.error(paint(context, 'warning', `warning: ${warning}`, 'err'));
}

async function serveCommand(args: string[], context: Context) {
  const port = parsePort(args);
  if (!context.serve) throw new AtlasError('skill-atlas serve runs only from the command line');
  context.print(`Skill Atlas at ${await context.serve(port)}`);
}

/** `--port <port>` or `--port=<port>`; the default port without it. */
function parsePort(args: string[]): number {
  const usage = 'Usage: skill-atlas serve [--port <port>]';
  if (args.length === 0) return DEFAULT_PORT;
  const value = args.length === 1 ? /^--port=(.*)$/.exec(args[0])?.[1] : args[0] === '--port' && args.length === 2 ? args[1] : undefined;
  if (value === undefined) throw new AtlasError(usage);
  const port = Number(value);
  if (!/^\d+$/.test(value) || port > 65535) throw new AtlasError(`Not a port: ${value}\n${usage}`);
  return port;
}

/**
 * `<owner> · N skills in M repositories`, then each repository with skills as on its own, after a
 * blank line; `No skills found` when there are none.
 */
function printOrganization({ organization, repositories }: OrganizationResult, context: Context) {
  const found = repositories.filter((result) => result.skills.length > 0);
  const total = found.reduce((sum, result) => sum + result.skills.length, 0);
  if (total === 0) {
    context.print(paint(context, 'heading', `${organization.id} · 0 skills`));
    return context.print(paint(context, 'faint', 'No skills found'));
  }
  context.print(
    paint(context, 'heading', `${organization.id} · ${count(total, 'skill', 'skills')} in ${count(found.length, 'repository', 'repositories')}`),
  );
  for (const result of found) {
    context.print('');
    printRepository(result.repository, result.skills, context);
  }
}

/** `<owner>/<repo> · N skills`, then each skill's name, first sentence and link. */
function printRepository(repository: Repository, skills: Skill[], context: Context) {
  const { print } = context;
  print(paint(context, 'heading', `${repository.id} · ${count(skills.length, 'skill', 'skills')}`));
  for (const skill of skills) {
    const name = paint(context, 'name', skill.name);
    print(skill.description ? `${name} — ${firstSentence(skill.description)}` : name);
    print(paint(context, 'faint', `  ${skillLink(repository, skill)}`));
    if (skill.copies.length > 0) print(paint(context, 'faint', `  also in ${skill.copies.join(', ')}`));
  }
}

function paint(context: Context, style: Style, text: string, stream: 'out' | 'err' = 'out'): string {
  return context.paint ? context.paint(style, text, stream) : text;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
