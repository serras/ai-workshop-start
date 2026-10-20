// The real CLI on real repositories, each pinned to a commit: what it prints must be what
// tests/e2e/<repo>.txt holds. To refresh one, pick a new commit and run
//   ./skill-atlas scan github.com/JetBrains/<repo>/tree/<commit> > tests/e2e/<repo>.txt
// These reach GitHub, more often than its limit without a token allows: without GITHUB_TOKEN
// they are skipped. CI sets it.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { CLI } from './helpers.ts';

const REPOSITORIES = {
  MPS: 'd7e4f5c1394535b05e90dde6e3e7e8a3f3e174a2',
  android: '0a40d23123eb4d6d7842dee26cdf5b0d8a96ea78',
  kotlin: '691451952b49c77db35c038e3f8a8da88186f0d2',
  koog: '22e342e033c716f835312dd6cbe83193e1cbcf76',
};

const skip = process.env.GITHUB_TOKEN ? false : 'set GITHUB_TOKEN to scan real repositories';

for (const [repo, commit] of Object.entries(REPOSITORIES)) {
  test(`JetBrains/${repo} at ${commit.slice(0, 7)} prints tests/e2e/${repo}.txt`, { skip }, async () => {
    const expected = readFileSync(new URL(`./e2e/${repo}.txt`, import.meta.url), 'utf8');
    const { stdout } = await promisify(execFile)(process.execPath, [CLI, 'scan', `github.com/JetBrains/${repo}/tree/${commit}`]);
    assert.equal(stdout, expected);
  });
}
