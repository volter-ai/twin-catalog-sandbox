import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { classify, loadIndex, read, write, digest, requireThat, validateIndex, compareReports, compareVersions } from './model.mjs';
import { builtIndex } from './publication.mjs';
import { evaluate } from './runner.mjs';
import { summary, feedback } from './github.mjs';

export async function assessPullRequest(root, github, number, output, evaluator = evaluate) {
  requireThat(Number.isSafeInteger(number) && number > 0, 'PR number must be a positive integer');
  const pr = await github.call(`pulls/${number}`);
  requireThat(pr.state === 'open', 'PR is not open');
  const local = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  requireThat(local.status === 0 && local.stdout.trim() === pr.base.sha, 'trusted checkout must match the current PR base; update/retry the workflow');
  const head = pr.head.sha;
  const check = await github.call('check-runs', 'POST', { name: 'catalog/readiness', head_sha: head, status: 'in_progress', external_id: `${number}:${head}:${pr.base.sha}` });
  const input = { schemaVersion: 1, repository: github.repository, pullRequest: number, head, base: pr.base.sha, policy: read(join(root, 'policy.json')) };
  let envelope;
  try {
    const files = await github.pages(`pulls/${number}/files`);
    requireThat(files.length === pr.changed_files, 'GitHub did not return the complete change; refuse truncated PR data');
    const contents = {};
    for (const file of files) if (/^(submissions|reassessments)\/|^(sources|recommendations|revocations)\.json$/.test(file.filename) && file.status !== 'removed') contents[file.filename] = await github.content(file.filename, head);
    const index = builtIndex(root);
    const kind = classify(files, index, contents);
    input.kind = kind.kind;
    if (['submission', 'reassessment'].includes(kind.kind)) {
      input.submission = kind.submission; input.source = kind.source;
      envelope = await evaluator(root, input, output);
      const previous = index.vendors.find((v) => v.vendor === kind.submission.vendor)?.packages.find((p) => p.name === kind.submission.package)?.versions.filter((v) => v.status === 'live' && v.integrity && !v.version.includes('-')).sort((a, b) => compareVersions(b.version, a.version))[0];
      if (previous && envelope.report) {
        try {
          const baselineInput = { ...input, submission: { ...kind.submission, version: previous.version, integrity: previous.integrity }, purpose: 'baseline' };
          const baseline = await evaluator(root, baselineInput, `${output}.baseline.json`);
          envelope.report.comparison = compareReports(envelope.report, baseline.report);
        } catch (error) { envelope.report.comparison = { baseline: previous.version, measured: false, note: `Baseline could not be measured: ${error.message}` }; }
      }
    } else {
      // Maintenance is human-reviewed and never executes the PR's candidate workflows.
      envelope = { schemaVersion: 1, input, inputSha256: digest(input), status: 'ready', report: null, note: `${kind.kind}: data validation only; no package assessment` };
    }
  } catch (error) {
    envelope = { schemaVersion: 1, input, inputSha256: digest(input), status: 'changes-needed', error: String(error.message ?? error) };
  }
  const current = await github.call(`pulls/${number}`);
  if (current.head.sha !== head || current.base.sha !== input.base || current.state !== 'open') { envelope.status = 'superseded'; envelope.error = 'PR head, base or state changed during assessment; current input needs a new run.'; }
  envelope.workflow = process.env.GITHUB_RUN_ID ? { repository: github.repository, run: Number(process.env.GITHUB_RUN_ID), attempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? 1), file: 'check.yml' } : null;
  write(output, envelope);
  const body = summary(envelope);
  await github.call(`check-runs/${check.id}`, 'PATCH', { external_id: `${number}:${head}:${input.base}:${digest(envelope)}`, ...(envelope.workflow ? { details_url: `https://github.com/${github.repository}/actions/runs/${envelope.workflow.run}` } : {}), status: 'completed', conclusion: envelope.status === 'ready' ? 'success' : envelope.status === 'superseded' ? 'cancelled' : 'failure', output: { title: `Catalog ${envelope.status}`, summary: body } });
  if (envelope.status !== 'superseded') await feedback(github, number, body);
  return envelope;
}

/** Explicit operator command; never called by an assessment or publication job. */
export async function configure(github, apply = false, reviewBypassUsers = []) {
  requireThat(Array.isArray(reviewBypassUsers) && reviewBypassUsers.every((u) => typeof u === 'string' && /^[A-Za-z0-9-]+$/.test(u)), 'invalid internal maintainer usernames');
  const desired = {
    required_status_checks: { strict: true, contexts: ['catalog/readiness'] },
    enforce_admins: true,
    required_pull_request_reviews: { dismiss_stale_reviews: true, require_code_owner_reviews: true, required_approving_review_count: 1, require_last_push_approval: true, bypass_pull_request_allowances: { users: reviewBypassUsers, teams: [], apps: [] } },
    restrictions: null, required_conversation_resolution: true,
    allow_force_pushes: false, allow_deletions: false,
  };
  if (apply) {
    const owners = await github.call('codeowners/errors?ref=main');
    requireThat(Array.isArray(owners.errors) && owners.errors.length === 0, 'CODEOWNERS is invalid; configure real moderators with repository write access before protecting admission');
    await github.call('branches/main/protection', 'PUT', desired);
    await github.call('actions/permissions', 'PUT', { enabled: true, allowed_actions: 'all' });
  }
  return { applied: apply, branch: 'main', protection: desired, actionsEnabled: apply };
}
