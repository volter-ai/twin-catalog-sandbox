import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { admit, defaults, digest, loadIndex, read, requireThat, stable, submissionId, validateIndex, write } from './model.mjs';

export function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  requireThat(r.status === 0, `git ${args[0]}: ${r.stderr}`);
  return r.stdout.trim();
}
export function submissions(root) {
  return ['submissions', 'reassessments'].flatMap((kind) => {
    const dir = join(root, kind);
    return existsSync(dir) ? readdirSync(dir).filter((f) => /^[a-f0-9]{64}\.json$/.test(f)).sort().map((f) => {
      const submission = read(join(dir, f));
      requireThat(f === `${submissionId(submission)}.json`, 'submission name/identity mismatch');
      const path = `${kind}/${f}`;
      const commit = git(root, ['log', '--diff-filter=A', '--format=%H', '--', path]).split('\n')[0];
      requireThat(/^[a-f0-9]{40}$/.test(commit), `${path} is not in the committed admission ledger`);
      return { submission, path, reassessment: kind === 'reassessments', commit, at: git(root, ['show', '-s', '--format=%cI', commit]) };
    }) : [];
  });
}
export function builtIndex(root) {
  const index = loadIndex(root);
  // Recommendations may refer to admitted submissions not yet present in legacy vendors/.
  const recommendations = index.recommendations, revocations = index.revocations;
  index.recommendations = {}; index.revocations = [];
  for (const item of submissions(root)) admit(index, item.submission, item.commit, item.at, item.reassessment);
  index.recommendations = recommendations; index.revocations = revocations;
  validateIndex(index);
  return index;
}
export function build(root, out, evidence = {}) {
  requireThat(!existsSync(out), 'build output must be a new directory');
  const index = builtIndex(root);
  const commit = git(root, ['rev-parse', 'HEAD']);
  const version = `0.2.${git(root, ['rev-list', '--first-parent', '--count', 'HEAD'])}`;
  const references = Object.fromEntries(Object.entries(evidence).map(([id, { envelope, ...receipt }]) => [id, receipt]));
  const identity = digest({ evidence: references, sources: index.sources, vendors: index.vendors, recommendations: index.recommendations, revocations: index.revocations });
  mkdirSync(out, { recursive: true });
  write(join(out, 'sources.json'), index.sources);
  write(join(out, 'recommendations.json'), index.recommendations);
  write(join(out, 'revocations.json'), index.revocations);
  for (const e of index.vendors) write(join(out, 'vendors', `${e.vendor}.json`), e);
  const catalog = { schemaVersion: 1, sourceCommit: commit, digest: identity, versions: index.vendors.flatMap((e) => e.packages.flatMap((p) => p.versions.map((v) => ({ vendor: e.vendor, package: p.name, source: p.source, ...v, evidence: (v.submission ?? v.assessment) ? { submission: v.submission ?? v.assessment, admissionCommit: v.assessmentCommit ?? v.commit, ...(references[v.submission ?? v.assessment] ?? {}) } : null, assessed: Boolean(v.submission ?? v.assessment) })))) };
  write(join(out, 'catalog.json'), catalog);
  for (const [id, receipt] of Object.entries(evidence)) write(join(out, 'evidence', `${id}.json`), receipt.envelope);
  const pkg = { ...read(join(root, 'package.json')), version, catalog: { sourceCommit: commit, digest: identity } };
  delete pkg.devDependencies;
  write(join(out, 'package.json'), pkg);
  for (const path of ['bin', 'lib', 'runner', 'docs', 'README.md', 'policy.json', 'LICENSE']) if (existsSync(join(root, path))) cpSync(join(root, path), join(out, path), { recursive: true });
  return { version, sourceCommit: commit, digest: identity, directory: out };
}

export function internalAdmission(pr, source, policy, mergerPermission) {
  const bot = pr.user.type === 'Bot' && (pr.user.login === 'github-actions[bot]' ||
    (Array.isArray(policy.internalBotAuthors) && policy.internalBotAuthors.some((author) =>
      Number.isSafeInteger(author?.id) && author.id > 0 && author.id === pr.user.id && author.login === pr.user.login)));
  return Boolean(source && Array.isArray(policy.internalRepositories) && policy.internalRepositories.includes(source.repository) &&
    Array.isArray(policy.reviewBypassUsers) && policy.reviewBypassUsers.includes(pr.merged_by?.login) && ['admin', 'maintain'].includes(mergerPermission) &&
    pr.head.repo?.full_name === pr.base.repo?.full_name && pr.base.repo?.full_name &&
    (bot || (pr.user.type !== 'Bot' && ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(pr.author_association))));
}
export function reviewSatisfied(pr, reviews, checks, internal = false) {
  const latest = new Map();
  for (const r of reviews) {
    if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(r.state)) latest.set(r.user.login, r);
  }
  const decisions = [...latest.values()].filter((r) => r.commit_id === pr.head.sha);
  return Boolean(pr.merged_at) && (internal || decisions.some((r) => r.state === 'APPROVED' && r.user.login !== pr.user.login && r.user.type !== 'Bot' && !r.user.login.endsWith('[bot]') && ['MEMBER', 'OWNER', 'COLLABORATOR'].includes(r.author_association))) && !decisions.some((r) => r.state === 'CHANGES_REQUESTED') && checks.some((c) => c.name === 'catalog/readiness' && c.head_sha === pr.head.sha && c.conclusion === 'success' && c.app?.slug === 'github-actions');
}
export async function verifyAdmission(root, github, policyClient = github) {
  requireThat(git(root, ['status', '--porcelain']) === '', 'publication requires a clean committed catalog checkout');
  const main = await github.call('git/ref/heads/main');
  requireThat(main.object?.sha === git(root, ['rev-parse', 'HEAD']), 'publication must use current main; retry the latest source commit');
  requireThat(/^\*\s+@/m.test(await github.content('.github/CODEOWNERS', main.object.sha)), 'catalog needs moderator CODEOWNERS over every path');
  const owners = await github.call('codeowners/errors?ref=main');
  requireThat(Array.isArray(owners.errors) && owners.errors.length === 0, 'catalog CODEOWNERS has invalid moderators');
  const protection = await policyClient.call('branches/main/protection');
  requireThat(protection.enforce_admins?.enabled && protection.required_status_checks?.strict && protection.required_status_checks.contexts.includes('catalog/readiness') && protection.required_pull_request_reviews?.dismiss_stale_reviews && protection.required_pull_request_reviews?.require_code_owner_reviews && protection.required_pull_request_reviews?.require_last_push_approval, 'publication requires active current-head readiness and CODEOWNERS branch protection');
  const proofs = [];
  const policy = read(join(root, 'policy.json'));
  const sources = loadIndex(root).sources;
  for (const item of submissions(root)) {
    const pulls = await github.pages(`commits/${item.commit}/pulls`);
    let accepted = false;
    for (const p of pulls.filter((p) => p.merged_at && p.base.ref === 'main')) {
      const pr = await github.call(`pulls/${p.number}`);
      const files = await github.pages(`pulls/${p.number}/files`);
      if (files.length !== 1 || files[0].status !== 'added' || files[0].filename !== item.path) continue;
      const contents = JSON.parse(await github.content(files[0].filename, pr.head.sha));
      if (stable(contents) !== stable(item.submission)) continue;
      const reviews = await github.pages(`pulls/${p.number}/reviews`);
      const checks = await github.call(`commits/${pr.head.sha}/check-runs?check_name=catalog%2Freadiness&filter=latest&per_page=100`);
      const source = sources.find((s) => s.name === item.submission.source);
      let permission;
      if (Array.isArray(policy.internalRepositories) && policy.internalRepositories.includes(source?.repository) && Array.isArray(policy.reviewBypassUsers) && policy.reviewBypassUsers.includes(pr.merged_by?.login)) {
        permission = (await policyClient.call(`collaborators/${encodeURIComponent(pr.merged_by.login)}/permission`)).permission;
      }
      const internal = internalAdmission(pr, source, policy, permission);
      if (reviewSatisfied(pr, reviews, checks.check_runs, internal)) {
        const check = checks.check_runs.find((c) => c.name === 'catalog/readiness' && c.head_sha === pr.head.sha && c.conclusion === 'success' && c.app?.slug === 'github-actions');
        const parts = (check.external_id ?? '').split(':');
        requireThat(parts.length === 4 && parts[0] === String(pr.number) && parts[1] === pr.head.sha && /^[a-f0-9]{40}$/.test(parts[2]) && /^[a-f0-9]{64}$/.test(parts[3]), 'readiness check has no bound evidence receipt');
        proofs.push({ ...item, pullRequest: pr.number, head: pr.head.sha, base: parts[2], reportSha256: parts[3], check, moderation: { mode: internal ? 'internal-maintainer-merge' : 'human-review', mergedBy: pr.merged_by.login } });
        accepted = true; break;
      }
    }
    requireThat(accepted, `${submissionId(item.submission)}: no reviewed current-head admission with successful readiness`);
  }
  return proofs;
}

// Ten minutes rounds up three times the observed delay; see docs/measurements/registry-confirmation.json.
const confirmationWindowMs = 10 * 60_000;
export async function publish(directory, registry, fetcher = fetch, execute = spawnSync, confirmation = {}) {
  const pkg = read(join(directory, 'package.json'));
  const url = `${registry.replace(/\/$/, '')}/${encodeURIComponent(pkg.name)}/${pkg.version}`;
  const before = await fetcher(url, { redirect: 'error' });
  if (before.ok) {
    const existing = await before.json();
    requireThat(stable(existing.catalog) === stable(pkg.catalog), 'published version conflicts with this source identity');
    requireThat(existing.dist?.integrity, 'published version has no artifact integrity');
    return { published: false, existing: true, package: pkg.name, version: pkg.version, integrity: existing.dist.integrity, ...pkg.catalog };
  }
  requireThat(before.status === 404, `registry lookup failed: HTTP ${before.status}`);
  const { now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), windowMs = confirmationWindowMs, intervalMs = 15_000 } = confirmation;
  requireThat(Number.isFinite(windowMs) && windowMs > 0 && Number.isFinite(intervalMs) && intervalMs > 0, 'invalid registry confirmation timing');
  const result = execute('npm', ['publish', '--ignore-scripts', '--access', 'public', '--provenance', '--registry', registry], { cwd: directory, encoding: 'utf8' });
  requireThat(result.status === 0, `index publication failed: ${result.stderr}`);
  const deadline = now() + windowMs;
  let response;
  for (;;) {
    response = await fetcher(url, { redirect: 'error' });
    if (response.ok) break;
    requireThat(response.status === 404, `registry confirmation failed: HTTP ${response.status}`);
    const remaining = deadline - now();
    requireThat(remaining > 0, 'npm accepted the upload but registry confirmation is still unavailable; upload is unverified, retry to verify');
    await sleep(Math.min(intervalMs, remaining));
  }
  const published = await response.json();
  requireThat(stable(published.catalog) === stable(pkg.catalog) && published.dist?.integrity, 'published registry identity differs');
  return { published: true, package: pkg.name, version: pkg.version, integrity: published.dist.integrity, ...pkg.catalog };
}
