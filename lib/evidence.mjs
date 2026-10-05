// Trusted controller receipts outlive workflow-artifact retention. No candidate code is imported here.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { digest, requireThat, stable, submissionId } from './model.mjs';

export function validateEvidence(envelope, proof, repository) {
  requireThat(digest(envelope) === proof.reportSha256, 'evidence digest differs from successful readiness receipt');
  requireThat(envelope.status === 'ready' && envelope.report?.ready === true, 'evidence is not successful package readiness');
  requireThat(envelope.input?.repository === repository && envelope.input?.pullRequest === proof.pullRequest && envelope.input?.head === proof.head && envelope.input?.base === proof.base, 'evidence PR identity differs');
  requireThat(stable(envelope.input.submission) === stable(proof.submission), 'evidence artifact identity differs');
  requireThat(envelope.inputSha256 === digest(envelope.input) && envelope.dependencyLock?.packages && envelope.workflow?.repository === repository && envelope.workflow.file === 'check.yml', 'evidence input or workflow identity differs');
  return envelope;
}
export async function readinessRun(proof, github) {
  const url = new URL(proof.check.details_url);
  requireThat(url.origin === 'https://github.com', 'readiness evidence is not a GitHub run');
  const prefix = `/${github.repository}/actions/runs/`;
  const runId = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : '';
  let run;
  if (/^[0-9]+$/.test(runId)) run = await github.call(`actions/runs/${runId}`);
  else {
    requireThat(url.pathname === `/${github.repository}/runs/${proof.check.id}` && Number.isSafeInteger(proof.check.check_suite?.id), 'readiness evidence run belongs to a different repository');
    const suite = proof.check.check_suite.id;
    const result = await github.call(`actions/runs?check_suite_id=${suite}&per_page=100`);
    const matches = result.workflow_runs.filter((r) => r.check_suite_id === suite && r.head_sha === proof.head && r.path === '.github/workflows/check.yml');
    requireThat(matches.length === 1, 'readiness check has no unique matching workflow run');
    run = matches[0];
  }
  requireThat(run.path === '.github/workflows/check.yml' && ['pull_request_target', 'workflow_dispatch'].includes(run.event), 'evidence did not come from the trusted readiness workflow');
  return run;
}
export async function persistEvidence(proofs, github) {
  const receipts = {};
  for (const proof of proofs) {
    const id = submissionId(proof.submission), tag = `evidence-${id}-${proof.reportSha256}`;
    let release = await github.optional(`releases/tags/${tag}`);
    let asset = release?.assets.find((a) => a.name === 'report.json');
    let envelope;
    if (asset) envelope = JSON.parse((await github.download(`releases/assets/${asset.id}`)).toString('utf8'));
    else {
      const run = await readinessRun(proof, github);
      const artifacts = await github.call(`actions/runs/${run.id}/artifacts?per_page=100`);
      const artifact = artifacts.artifacts.find((a) => a.name === `catalog-assessment-${run.id}-${run.run_attempt}` && !a.expired);
      requireThat(artifact, 'readiness report expired or missing; reassess the current PR before admission');
      const temp = mkdtempSync(join(tmpdir(), 'catalog-evidence-')), file = join(temp, 'evidence.zip');
      writeFileSync(file, await github.download(`actions/artifacts/${artifact.id}/zip`));
      // Read one member to stdout; never extract paths supplied in an archive.
      const data = spawnSync('unzip', ['-p', file, 'report.json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
      requireThat(data.status === 0, 'readiness artifact contains no readable report');
      envelope = JSON.parse(data.stdout);
      requireThat(envelope.workflow?.run === run.id && envelope.workflow?.attempt === run.run_attempt, 'evidence workflow differs from artifact source');
      validateEvidence(envelope, proof, github.repository);
      if (!release) release = await github.call('releases', 'POST', { tag_name: tag, target_commitish: proof.commit, name: `Assessment ${proof.submission.package}@${proof.submission.version}`, body: `Readiness report SHA-256: ${proof.reportSha256}\nAdmission PR: #${proof.pullRequest}`, draft: false, prerelease: true });
      asset = await github.upload(release.upload_url, 'report.json', Buffer.from(`${JSON.stringify(envelope, null, 2)}\n`));
    }
    validateEvidence(envelope, proof, github.repository);
    // The resolved dependency lock is retained in the report identity; workflow diagnostics are supplementary.
    receipts[id] = { pullRequest: proof.pullRequest, url: release.html_url, reportSha256: proof.reportSha256, reportPath: `evidence/${id}.json`, ...(proof.moderation ? { moderation: proof.moderation } : {}), envelope };
  }
  return receipts;
}
