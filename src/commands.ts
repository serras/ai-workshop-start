// The skill-atlas commands. The same code serves the Node CLI and the browser
// terminal: everything that differs between them comes in through the context.
import { AtlasError } from './core/errors.ts';
import { skillLink, type Repository, type Skill } from './core/model.ts';
import { firstSentence } from './core/parse.ts';
import { scan, type Source } from './core/scan.ts';

export type Context = {
  /** Opens what the user asked to scan. */
  open(input: string): Promise<Source>;
  print(text: string): void;
  /** Errors and warnings. */
  error(text: string): void;
  /** Serves the web view on the port; its address. Only where a server can run. */
  serve?(port: number): Promise<string>;
};

export const DEFAULT_PORT = 3000;

const usage = `Usage: skill-atlas <command>

  scan <GitHub URL | directory>   find every SKILL.md in a repository and print it
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
    context.error(error.message);
    return 1;
  }
}

async function scanCommand(args: string[], context: Context) {
  if (args.length !== 1) throw new AtlasError('Usage: skill-atlas scan <GitHub URL | directory>');
  const result = await scan(await context.open(args[0]));
  printRepository(result.repository, result.skills, context);
  for (const warning of result.warnings) context.error(`warning: ${warning}`);
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

/** `<owner>/<repo> · N skills`, then each skill's name, first sentence and link. */
function printRepository(repository: Repository, skills: Skill[], { print }: Context) {
  print(`${repository.id} · ${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}`);
  for (const skill of skills) {
    print(skill.description ? `${skill.name} — ${firstSentence(skill.description)}` : skill.name);
    print(`  ${skillLink(repository, skill)}`);
    if (skill.copies.length > 0) print(`  also in ${skill.copies.join(', ')}`);
  }
}
