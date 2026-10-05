// Owner-dispatched smoke assessment uses the same controller as admission; it grants no approval.
import { join, resolve } from 'node:path';
import { metadata } from '../lib/registry.mjs';
import { read, validateSubmission, requireThat } from '../lib/model.mjs';
import { evaluate } from '../lib/runner.mjs';
const root = resolve('.'), policy = read(join(root, 'policy.json'));
const doc = await metadata(process.env.CATALOG_PACKAGE, process.env.CATALOG_VERSION, policy.registry);
const submission = { schemaVersion: 1, source: process.env.CATALOG_SOURCE, vendor: process.env.CATALOG_VENDOR, package: doc.name, version: doc.version, integrity: doc.dist.integrity };
const source = validateSubmission(submission, read(join(root, 'sources.json')));
const report = evaluate(root, { schemaVersion: 1, policy, source, submission, purpose: 'owner-dispatched-verification' }, join(root, 'assessment/evaluator.json'));
const expected = process.env.CATALOG_EXPECTED_READINESS ?? 'ready';
requireThat(['ready', 'reject-missing-provenance'].includes(expected), 'unknown verification expectation');
if (expected === 'reject-missing-provenance') {
  requireThat(report.status === 'changes-needed' && report.phase === 'artifact-preparation' && report.error?.includes('npm provenance required; this version has no attestation'), 'evaluator did not produce the specific expected missing-provenance refusal; inspect retained diagnostics');
  console.log('Verified missing-provenance refusal. The artifact remains changes-needed and is not admitted.');
} else requireThat(report.status === 'ready', 'isolated evaluator did not establish readiness; inspect the retained report and logs');
