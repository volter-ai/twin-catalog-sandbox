#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadIndex, defaults, read, write, requireThat, stable, submissionId, validateSubmission } from '../lib/model.mjs';
import { metadata } from '../lib/registry.mjs';
import { GitHub } from '../lib/github.mjs';
import { assessPullRequest, configure } from '../lib/automation.mjs';
import { build, builtIndex, publish, verifyAdmission } from '../lib/publication.mjs';
import { persistEvidence } from '../lib/evidence.mjs';
import { propose } from '../lib/propose.mjs';

const [command, ...args] = process.argv.slice(2);
const arg = (name, fallback) => { const at = args.indexOf(`--${name}`); if (at < 0) return fallback; requireThat(args[at + 1] && !args[at + 1].startsWith('--'), `--${name} needs a value`); return args[at + 1]; };
const root = resolve(arg('root', process.cwd()));
const installed = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const policy = () => read(join(existsSync(join(root, 'policy.json')) ? root : installed, 'policy.json'));
const github = () => new GitHub(arg('repository', process.env.GITHUB_REPOSITORY ?? 'volter-ai/twin-catalog-sandbox'), process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN);
try {
  let result;
  switch (command) {
    case 'submit': {
      const indexRoot = existsSync(join(root, 'sources.json')) ? root : installed;
      const p = policy();
      const doc = await metadata(arg('package'), arg('version'), p.registry);
      const submission = { schemaVersion: 1, source: arg('source'), vendor: arg('vendor'), package: doc.name, version: doc.version, integrity: doc.dist?.integrity };
      validateSubmission(submission, loadIndex(indexRoot).sources);
      const file = resolve(arg('out', join(resolve(arg('out-dir', join(root, args.includes('--reassess') ? 'reassessments' : 'submissions'))), `${submissionId(submission)}.json`)));
      requireThat(file.endsWith(`/${submissionId(submission)}.json`), 'output must be named for the submission identity');
      if (existsSync(file)) requireThat(stable(read(file)) === stable(submission), 'submission output already exists with different content');
      write(file, submission);
      result = { file, submission, next: 'Open a pull request adding only this submission file to the catalog. No publication or PR was performed.' };
      break;
    }
    case 'defaults': result = defaults(builtIndex(existsSync(join(root, 'sources.json')) ? root : installed)); break;
    case 'check': result = { valid: Boolean(builtIndex(existsSync(join(root, 'sources.json')) ? root : installed)) }; break;
    case 'assess-pr': {
      const event = process.env.GITHUB_EVENT_PATH ? read(process.env.GITHUB_EVENT_PATH) : {};
      result = await assessPullRequest(root, github(), Number(arg('pr', process.env.CATALOG_PR ?? event.pull_request?.number)), resolve(arg('out', 'assessment/report.json')));
      if (result.status !== 'ready') process.exitCode = 1;
      break;
    }
    case 'configure': result = await configure(github(), args.includes('--apply'), policy().reviewBypassUsers ?? []); break;
    case 'propose': {
      requireThat(args.includes('--send'), 'propose opens GitHub PRs; pass --send for this explicit publisher action');
      result = await propose(github(), resolve(arg('from', args.includes('--reassess') ? 'reassessments' : 'submissions')), args.includes('--reassess'));
      break;
    }
    case 'build': result = build(root, resolve(arg('out', 'dist'))); break;
    case 'publish': {
      const client = github();
      const policyClient = process.env.CATALOG_READ_TOKEN ? new GitHub(client.repository, process.env.CATALOG_READ_TOKEN) : client;
      const proofs = await verifyAdmission(root, client, policyClient);
      const evidence = await persistEvidence(proofs, client);
      const output = resolve(arg('out', 'dist'));
      build(root, output, evidence);
      result = await publish(output, policy().registry);
      break;
    }
    default: throw new Error('usage: twin-catalog submit --source <id> --vendor <vendor> --package <@scope/name> --version <exact> | assess-pr --pr <number> | check | defaults | build --out <new-directory> | publish | configure [--apply]');
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(`twin-catalog: ${error.message ?? error}`); process.exitCode = 1; }
