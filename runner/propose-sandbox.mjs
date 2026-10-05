// Operator-only sandbox helper: npm accepted this release but returned 404
// during processing (pack release run 37312975443). Wait in Actions, not chat.
import { setTimeout as delay } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';

const repository = 'volter-ai/twin-catalog-sandbox';
if (process.env.GITHUB_REPOSITORY !== repository) throw new Error('sandbox repository required');
const version = process.env.SUBMISSION_VERSION;
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('exact sandbox version required');
const pkg = '@volter/twin-sandbox-tavily';
const url = `https://registry.npmjs.org/${encodeURIComponent(pkg)}/${version}`;
for (;;) {
  const response = await fetch(url, { redirect: 'error' });
  if (response.ok) break;
  if (response.status !== 404) throw new Error(`registry HTTP ${response.status}`);
  console.log(`Waiting for npm to expose ${pkg}@${version}`);
  await delay(30_000);
}
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || `${command} failed`);
  return result.stdout;
}
console.log(run('node', ['bin/twin-catalog.mjs', 'submit', '--source', 'sandbox-publisher', '--vendor', 'tavily', '--package', pkg, '--version', version, '--out-dir', '/tmp/sandbox-submissions']));
const proposals = JSON.parse(run('node', ['bin/twin-catalog.mjs', 'propose', '--from', '/tmp/sandbox-submissions', '--send']));
console.log(JSON.stringify(proposals, null, 2));
for (const proposal of proposals.filter((p) => p.state === 'open')) {
  const number = new URL(proposal.url).pathname.split('/').at(-1);
  if (!/^\d+$/.test(number)) throw new Error('invalid proposal URL');
  // GITHUB_TOKEN-created PRs do not trigger pull_request_target automatically.
  console.log(run('gh', ['workflow', 'run', 'check.yml', '--repo', repository, '--ref', 'main', '-f', `pr=${number}`]));
}
