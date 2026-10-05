import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { admit, classify, compareReports, defaults, digest, read, stable, submissionId, validateIndex, validateSubmission, write } from '../lib/model.mjs';
import { integrityOf, verifyArtifact, metadata, registryURL } from '../lib/registry.mjs';
import { build, builtIndex, publish, reviewSatisfied } from '../lib/publication.mjs';
import { assessPullRequest, configure } from '../lib/automation.mjs';
import { GitHub, summary } from '../lib/github.mjs';
import { propose } from '../lib/propose.mjs';
import { evaluate } from '../lib/runner.mjs';

const source = { name: 'outside', repository: 'outside/simulators', scope: '@outside', official: false, protocol: '3', workflow: 'release.yml' };
const official = { ...source, name: 'volter', repository: 'volter-ai/twin-packs-p3', scope: '@volter', official: true };
const bytes = Buffer.from('synthetic immutable artifact');
const submitted = (changes = {}) => ({ schemaVersion: 1, source: 'outside', vendor: 'stripe', package: '@outside/payments', version: '1.2.3', integrity: integrityOf(bytes), ...changes });
const index = () => ({ sources: [source, official], vendors: [], recommendations: {}, revocations: [] });
const sha = 'a'.repeat(40), at = '2026-10-04T00:00:00Z';

test('GitHub reads recover one transport failure without retrying refusals or writes', async () => {
  const failure = new TypeError('fetch failed', { cause: { code: 'UND_ERR_SOCKET' } });
  let calls = 0;
  const github = new GitHub('outside/catalog', 'synthetic-token', async () => {
    if (++calls === 1) throw failure;
    return { ok: true, status: 200, json: async () => ({ head: sha }) };
  });
  assert.deepEqual(await github.call('pulls/1'), { head: sha });
  assert.equal(calls, 2);
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    calls = 0;
    github.fetcher = async () => { calls++; throw failure; };
    await assert.rejects(github.call('pulls/1', method), /GitHub .* transport failed \(UND_ERR_SOCKET\)/);
    assert.equal(calls, 1);
  }
  calls = 0;
  github.fetcher = async () => { calls++; throw failure; };
  await assert.rejects(github.call('pulls/1'), /transport failed \(UND_ERR_SOCKET\)/);
  assert.equal(calls, 2);
  for (const status of [403, 404, 429, 500]) {
    calls = 0;
    github.fetcher = async () => { calls++; return { ok: false, status }; };
    await assert.rejects(github.call('pulls/1'), new RegExp(`HTTP ${status}`));
    assert.equal(calls, 1);
  }
});

test('preparation refusal retains a failed envelope, diagnostics and owned cleanup', () => {
  const root = mkdtempSync(join(tmpdir(), 'catalog-preparation-refusal-'));
  const input = { policy: { requireProvenance: true, tools: {} }, submission: submitted() };
  const calls = [];
  const report = evaluate(root, input, join(root, 'report.json'), { spawn: (command, args) => {
    assert.equal(command, 'docker'); calls.push(args);
    if (args[0] === 'build') writeFileSync(args[args.indexOf('--iidfile') + 1], `sha256:${'a'.repeat(64)}`);
    if (args.at(-1) === '/opt/catalog/runner/prepare.mjs') {
      const mount = args.find((value) => value.endsWith(':/input:ro')).slice(0, -':/input:ro'.length);
      assert.equal(statSync(mount).mode & 0o777, 0o755);
      assert.deepEqual(read(join(mount, 'input.json')), input);
      return { status: 1, stdout: '', stderr: 'original release has no provenance' };
    }
    return { status: 0, stdout: '', stderr: '' };
  } });
  assert.equal(report.status, 'changes-needed'); assert.equal(report.phase, 'artifact-preparation');
  assert.equal(report.report, null); assert.equal(report.inputSha256, digest(input));
  assert.equal(report.image, `sha256:${'a'.repeat(64)}`);
  assert.match(report.error, /no provenance/);
  assert.deepEqual(read(join(root, 'report.json')), report);
  assert.ok(read(join(root, 'report.json.logs.json')).some((log) => log.status === 1));
  assert.equal(calls.at(-1)[0], 'volume'); assert.equal(calls.at(-1)[1], 'rm');
});

test('uncertain teardown overwrites a successful candidate report with changes-needed', () => {
  const root = mkdtempSync(join(tmpdir(), 'catalog-teardown-refusal-'));
  const input = { policy: { requireProvenance: true, tools: {} }, submission: submitted() };
  const lock = JSON.stringify({ packages: {} });
  const report = evaluate(root, input, join(root, 'report.json'), { spawn: (_command, args) => {
    if (args[0] === 'build') writeFileSync(args[args.indexOf('--iidfile') + 1], `sha256:${'b'.repeat(64)}`);
    if (args[0] === 'volume' && args[1] === 'rm') return { status: 1, stdout: '', stderr: 'volume still referenced' };
    const script = args.at(-1);
    const stdout = script.includes('prepared.json') ? JSON.stringify({ integrity: input.submission.integrity, dependencyLockSha256: digest(lock) }) : script.includes('package-lock.json') ? lock : script.includes('report.json') ? JSON.stringify({ schemaVersion: 1, package: input.submission.package, version: input.submission.version, integrity: input.submission.integrity, ready: true }) : '';
    return { status: 0, stdout, stderr: '' };
  } });
  assert.equal(report.status, 'changes-needed'); assert.equal(report.report, null);
  assert.match(report.error, /teardown could not be verified/);
  assert.equal(read(join(root, 'report.json')).status, 'changes-needed');
  assert.equal(read(join(root, 'report.json.logs.json')).at(-1).status, 1);
});

test('arbitrary package names and multiple independent publishers retain distinct identities', () => {
  const i = admit(index(), submitted(), sha, at);
  admit(i, submitted({ source: 'volter', package: '@volter/twin-stripe', version: '99.0.0' }), sha, at);
  assert.throws(() => defaults(i), /competing publishers/);
  i.recommendations.stripe = '@outside/payments';
  assert.deepEqual(defaults(i).stripe, { name: '@outside/payments', version: '1.2.3', source: 'outside', integrity: integrityOf(bytes) });
});
test('a release cannot change its bytes, vendor, source or submission identity after admission', () => {
  const i = admit(index(), submitted(), sha, at);
  assert.equal(admit(i, submitted(), sha, at).vendors[0].packages[0].versions.length, 1);
  for (const change of [{ vendor: 'github' }, { integrity: integrityOf(Buffer.from('different')) }]) assert.throws(() => admit(i, submitted(change), sha, at), /identity conflict/);
});
test('pending, rejected, revoked and prerelease versions are not automatic defaults', () => {
  const i = admit(index(), submitted(), sha, at);
  admit(i, submitted({ version: '2.0.0-rc.1' }), sha, at);
  i.vendors[0].packages[0].versions.push({ version: '3.0.0', status: 'pending' }, { version: '4.0.0', status: 'rejected', reason: 'refused' });
  assert.equal(defaults(i).stripe.version, '1.2.3');
  i.revocations.push({ package: '@outside/payments', version: '1.2.3', reason: 'withdrawn' });
  assert.equal(defaults(i).stripe, undefined);
  i.recommendations.stripe = '@outside/payments';
  assert.throws(() => defaults(i), /no selectable release/);
});
test('canonical submission identity ignores JSON field ordering', () => {
  const s = submitted();
  assert.equal(submissionId(s), submissionId(Object.fromEntries(Object.entries(s).reverse())));
});
test('submission validation rejects mutable specs and contributor-controlled authority', () => {
  for (const change of [{ version: 'latest' }, { version: '^1.2.3' }, { version: '1.2.3-01' }, { version: '1.2.3+build' }, { package: '@attacker/payments' }, { integrity: 'sha1-abc' }, { approved: true }, { command: 'echo pass' }, { registry: 'https://attacker.test' }]) assert.throws(() => validateSubmission(submitted(change), [source]));
});
test('release PRs are data only and cannot alter an admitted submission or their policy', () => {
  const s = submitted(), filename = `submissions/${submissionId(s)}.json`, content = { [filename]: JSON.stringify(s) };
  assert.equal(classify([{ filename, status: 'added' }], index(), content).kind, 'submission');
  assert.throws(() => classify([{ filename, status: 'modified' }], index(), content), /immutable/);
  assert.throws(() => classify([{ filename, status: 'added' }, { filename: 'policy.json', status: 'modified' }], index(), content), /cannot be mixed/);
  assert.throws(() => classify([{ filename: 'sources.json', status: 'modified' }, { filename: 'runner/evaluate.mjs', status: 'modified' }], index(), {}), /separate/);
});
test('source registration cannot rewrite a trusted source', () => {
  const base = index(), contents = { 'sources.json': JSON.stringify([{ ...source, repository: 'attacker/repo' }, official, { ...source, name: 'another' }]) };
  assert.throws(() => classify([{ filename: 'sources.json', status: 'modified' }], base, contents), /immutable/);
});
test('publication review binds approval and successful checks to current head; never self approval', () => {
  const pr = { merged_at: at, head: { sha }, user: { login: 'author' } };
  const review = { state: 'APPROVED', commit_id: sha, user: { login: 'moderator' }, author_association: 'MEMBER' };
  const check = { name: 'catalog/readiness', head_sha: sha, conclusion: 'success', app: { slug: 'github-actions' } };
  assert.equal(reviewSatisfied(pr, [review], [check]), true);
  assert.equal(reviewSatisfied(pr, [{ ...review, user: { login: 'reviewer[bot]', type: 'Bot' } }], [check]), false);
  assert.equal(reviewSatisfied(pr, [{ ...review, commit_id: 'b'.repeat(40) }], [check]), false);
  assert.equal(reviewSatisfied(pr, [{ ...review, user: { login: 'author' } }], [check]), false);
  assert.equal(reviewSatisfied(pr, [review], [{ ...check, conclusion: 'cancelled' }]), false);
  assert.equal(reviewSatisfied(pr, [review], [{ ...check, app: { slug: 'untrusted' } }]), false);
  assert.equal(reviewSatisfied(pr, [review, { ...review, state: 'DISMISSED' }], [check]), false);
});
test('digest mismatches and off-registry artifact URLs fail before evaluation', async () => {
  const s = submitted();
  verifyArtifact(bytes, s, { dist: { integrity: s.integrity } });
  assert.throws(() => verifyArtifact(Buffer.from('wrong'), s, { dist: { integrity: s.integrity } }), /integrity/);
  assert.throws(() => registryURL('https://attacker.test/a.tgz', 'https://registry.npmjs.org'), /policy registry/);
  await assert.rejects(metadata(s.package, s.version, 'https://registry.npmjs.org', async () => ({ ok: true, json: async () => ({ name: s.package, version: '9.0.0' }) })), /different package/);
});
test('comparison preserves the full denominator and missing baseline is unknown', () => {
  const current = { package: '@outside/payments', version: '2.0.0', quick: { surface: { total: 100 }, servedOperations: ['create', 'list'] } };
  assert.equal(compareReports(current, null).baseline, null);
  const result = compareReports(current, { ...current, version: '1.0.0', quick: { surface: { total: 99 }, servedOperations: ['create', 'delete'] } });
  assert.deepEqual(result.removed, ['delete']); assert.equal(result.denominator, 100); assert.equal(result.previousDenominator, 99);
  assert.throws(() => compareReports(current, { ...current, package: '@other/payments' }), /publishers/);
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'catalog-process-'));
  write(join(root, 'sources.json'), [source]); write(join(root, 'recommendations.json'), {}); write(join(root, 'revocations.json'), []);
  write(join(root, 'policy.json'), { tools: {}, requireProvenance: true });
  write(join(root, 'package.json'), { name: '@volter/twin-catalog', version: '0.1.0' });
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).trim();
  git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
  git('add', '.'); git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'Fixture');
  return { root, git };
}
test('index generation admits committed data without platform source, a hosted build, or imports', () => {
  const { root, git } = fixture(), s = submitted();
  write(join(root, 'submissions', `${submissionId(s)}.json`), s); git('add', '.'); git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'Reviewed fixture admission');
  const a = build(root, join(root, 'output-a')), b = build(root, join(root, 'output-b'));
  assert.equal(a.version, b.version); assert.equal(a.digest, b.digest);
  const output = read(join(root, 'output-a/vendors/stripe.json'));
  assert.equal(output.packages[0].name, '@outside/payments'); assert.equal(output.packages[0].versions[0].submission, submissionId(s));
});
test('publishing retries matching source identity and refuses a conflicting version', async () => {
  const { root } = fixture(), out = join(root, 'output'); build(root, out);
  const pkg = read(join(out, 'package.json'));
  const noExecution = () => { throw new Error('must not publish again'); };
  const same = await publish(out, 'https://registry.npmjs.org', async () => ({ ok: true, json: async () => ({ ...pkg, dist: { integrity: integrityOf(bytes) } }) }), noExecution);
  assert.equal(same.existing, true);
  await assert.rejects(publish(out, 'https://registry.npmjs.org', async () => ({ ok: true, json: async () => ({ ...pkg, catalog: {} }) }), noExecution), /conflicts/);
});
test('readiness on a stale head is cancelled and cannot leave successful feedback', async () => {
  const { root, git } = fixture(), head = 'c'.repeat(40), base = git('rev-parse', 'HEAD'), s = submitted();
  const filename = `submissions/${submissionId(s)}.json`, calls = [];
  let lookups = 0;
  const github = { repository: 'catalog/index', call: async (path, method, body) => {
    calls.push({ path, method, body });
    if (path === 'pulls/1') return { state: 'open', changed_files: 1, head: { sha: ++lookups === 1 ? head : 'd'.repeat(40) }, base: { sha: base } };
    if (path === 'check-runs' && method === 'POST') return { id: 7 };
    return {};
  }, pages: async () => [{ filename, status: 'added' }], content: async () => JSON.stringify(s) };
  const result = await assessPullRequest(root, github, 1, join(root, 'report.json'), async (_root, input) => ({ input, inputSha256: digest(input), status: 'ready' }));
  assert.equal(result.status, 'superseded');
  assert.equal(calls.find((c) => c.path === 'check-runs/7').body.conclusion, 'cancelled');
  assert.ok(!calls.some((c) => c.path.startsWith('issues/')));
});
test('evaluation failure produces changes-needed, not successful readiness', async () => {
  const { root, git } = fixture(), base = git('rev-parse', 'HEAD'), s = submitted(), calls = [];
  const filename = `submissions/${submissionId(s)}.json`;
  const github = { repository: 'catalog/index', call: async (path, method, body) => {
    calls.push({ path, method, body });
    if (path === 'pulls/1') return { state: 'open', changed_files: 1, head: { sha }, base: { sha: base } };
    if (path === 'check-runs') return { id: 1 };
    return {};
  }, pages: async (path) => path.includes('/files') ? [{ filename, status: 'added' }] : [], content: async () => JSON.stringify(s) };
  const result = await assessPullRequest(root, github, 1, join(root, 'report.json'), async () => { throw new Error('replay diverged'); });
  assert.equal(result.status, 'changes-needed');
  assert.equal(calls.find((c) => c.path === 'check-runs/1').body.conclusion, 'failure');
});
test('operator configuration is read-only unless apply is explicit', async () => {
  let calls = 0; const g = { call: async () => { calls++; return { errors: [] }; } };
  assert.equal((await configure(g)).applied, false); assert.equal(calls, 0);
  await configure(g, true); assert.equal(calls, 3);
});
test('summary preserves missing measurements and escapes contributor markup and mentions', () => {
  const body = summary({ status: 'changes-needed', error: '<script>@moderators</script>', input: { head: sha }, report: { quick: { surface: null, answered: 1, failures: [], replay: { equal: false } }, gates: [], conformance: [] } });
  assert.ok(!body.includes('<script>')); assert.ok(!body.includes('@moderators')); assert.match(body, /not measured/); assert.match(body, /not approval/);
});

test('a package cannot migrate vendors by changing its version', () => {
  const i = admit(index(), submitted(), sha, at);
  assert.throws(() => admit(i, submitted({ version: '2.0.0', vendor: 'github' }), sha, at), /vendor and source/);
});
test('recommendations and revocations cannot be smuggled into executable maintenance', () => {
  assert.throws(() => classify([{ filename: 'revocations.json', status: 'modified' }, { filename: 'runner/evaluate.mjs', status: 'modified' }], index(), {}), /separate data-only/);
});
test('publisher retries retain closed submissions and never reopen, approve or merge them', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'catalog-proposal-')), s = submitted();
  write(join(directory, `${submissionId(s)}.json`), s);
  const calls = [];
  const github = { repository: 'catalog/index', content: async () => JSON.stringify([source]), call: async (path, method = 'GET') => {
    calls.push({ path, method });
    if (path === 'git/ref/heads/main') return { object: { sha } };
    if (path.startsWith('pulls?')) return [{ html_url: 'https://github.com/catalog/index/pull/7', state: 'closed' }];
    throw new Error('unexpected write');
  } };
  const result = await propose(github, directory);
  assert.equal(result[0].state, 'closed');
  assert.ok(calls.every((c) => c.method === 'GET'));
});

test('historical reassessment records measured identity separately and never rewrites admission history', () => {
  const i = index(), s = submitted();
  i.vendors.push({ vendor: 'stripe', packages: [{ name: s.package, source: s.source, versions: [{ version: s.version, status: 'live', commit: sha, at }] }] });
  const filename = `reassessments/${submissionId(s)}.json`;
  assert.equal(classify([{ filename, status: 'added' }], i, { [filename]: JSON.stringify(s) }).kind, 'reassessment');
  admit(i, s, 'b'.repeat(40), at, true);
  const v = i.vendors[0].packages[0].versions[0];
  assert.equal(v.commit, sha); assert.equal(v.assessmentCommit, 'b'.repeat(40)); assert.equal(v.submission, undefined);
  assert.equal(v.integrity, s.integrity);
  assert.throws(() => classify([{ filename, status: 'added' }], i, { [filename]: JSON.stringify(s) }), /unassessed/);
  assert.throws(() => admit(i, submitted({ integrity: integrityOf(Buffer.from('changed')) }), sha, at, true), /identity conflict/);
});
test('durable evidence refuses substituted input, artifact and current-head identities', async () => {
  const { validateEvidence } = await import('../lib/evidence.mjs');
  const submission = submitted(), repository = 'catalog/index', head = sha, base = 'b'.repeat(40);
  const input = { repository, pullRequest: 1, head, base, submission };
  const envelope = { input, inputSha256: digest(input), status: 'ready', report: { ready: true }, dependencyLock: { packages: {} }, workflow: { repository, file: 'check.yml', run: 1 } };
  const proof = { submission, pullRequest: 1, head, base, reportSha256: digest(envelope) };
  assert.equal(validateEvidence(envelope, proof, repository), envelope);
  assert.throws(() => validateEvidence({ ...envelope, status: 'changes-needed' }, proof, repository), /digest/);
  assert.throws(() => validateEvidence(envelope, { ...proof, head: base }, repository), /PR identity/);
  assert.throws(() => validateEvidence(envelope, { ...proof, submission: submitted({ vendor: 'github' }) }, repository), /artifact identity/);
});

test('invalid moderator configuration refuses protection changes before making any mutation', async () => {
  const calls = [];
  await assert.rejects(configure({ call: async (path, method = 'GET') => { calls.push({ path, method }); return { errors: [{ kind: 'Unknown owner' }] }; } }, true), /CODEOWNERS is invalid/);
  assert.ok(calls.every((c) => c.method === 'GET'));
});
