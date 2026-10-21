// Claude on this machine as the model that groups the skills: `claude -p`, the prompt on its stdin,
// its answer on its stdout, with no tools: the prompt holds descriptions anyone may have written.
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Model } from './core/group.ts';

export type ClaudeOptions = {
  /** The executable: `claude` on the PATH by default; a path, from the directory it was started in. */
  command?: string;
  /** How long it may think, in milliseconds. */
  timeout?: number;
};

/** Three minutes: an organization has hundreds of skills. */
const TIMEOUT = 180_000;

export function claude({ command = 'claude', timeout = TIMEOUT }: ClaudeOptions = {}): Model {
  const executable = command.includes('/') ? resolve(command) : command;
  return (prompt) => ask(executable, prompt, timeout);
}

function ask(command: string, prompt: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // Away from the directory it was started in: nothing there is the question's.
    // Grouping needs no tool, and no MCP server.
    const child = spawn(command, ['-p', '--tools', '', '--strict-mcp-config'], { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let late = false;
    const timer = setTimeout(() => ((late = true), child.kill()), timeout);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.stdin.on('error', () => {});
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new Error(error.code === 'ENOENT' ? `${command} is not installed` : `${command} -p: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (late) return reject(new Error(`${command} -p took longer than ${timeout / 1000} s`));
      if (code === 0) return resolve(Buffer.concat(out).toString('utf8'));
      const reason = Buffer.concat(err).toString('utf8').trim() || Buffer.concat(out).toString('utf8').trim();
      reject(new Error(`${command} -p failed${reason ? `: ${reason.split('\n')[0]}` : ` with exit code ${code}`}`));
    });
    child.stdin.end(prompt);
  });
}
