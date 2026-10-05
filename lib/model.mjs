import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const canonical = (v) => v && typeof v === 'object' ? Array.isArray(v) ? v.map(canonical) : Object.fromEntries(Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => [k, canonical(v[k])])) : v;
export const stable = (v) => JSON.stringify(canonical(v));
export const digest = (v) => createHash('sha256').update(typeof v === 'string' ? v : stable(v)).digest('hex');
export const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
export const write = (file, value) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); };
export const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
export const idPattern = /^[a-z][a-z0-9-]*$/;
export const packagePattern = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
export const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
export function exactKeys(value, keys, label) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), `${label}: expected an object`);
  requireThat(Object.keys(value).every((k) => keys.includes(k)), `${label}: unknown field`);
}
export function validateSources(sources) {
  requireThat(Array.isArray(sources), 'sources must be an array');
  const names = new Set();
  for (const s of sources) {
    exactKeys(s, ['name', 'repository', 'scope', 'official', 'protocol', 'workflow'], 'source');
    requireThat(idPattern.test(s.name) && !names.has(s.name), 'source name must be unique');
    requireThat(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s.repository), 'source repository must be owner/repo');
    requireThat(/^@[a-z0-9][a-z0-9._-]*$/.test(s.scope), 'source scope must be an npm scope');
    requireThat(s.protocol === '3' && typeof s.official === 'boolean', 'source must declare Protocol 3 and maintenance identity');
    requireThat(/^[A-Za-z0-9_-]+\.ya?ml$/.test(s.workflow ?? 'release.yml'), 'source workflow must be a filename');
    names.add(s.name);
  }
  return sources;
}
export function validateSubmission(s, sources) {
  exactKeys(s, ['schemaVersion', 'source', 'vendor', 'package', 'version', 'integrity'], 'submission');
  requireThat(s.schemaVersion === 1, 'unsupported submission schema');
  requireThat(typeof s.vendor === 'string' && idPattern.test(s.vendor), 'invalid vendor');
  requireThat(packagePattern.test(s.package), 'package must have a publisher scope');
  requireThat(versionPattern.test(s.version), 'version must be exact semver without build metadata');
  if (s.version.includes('-')) requireThat(s.version.split('-').slice(1).join('-').split('.').every((x) => !/^0\d+$/.test(x)), 'numeric prerelease identifiers cannot have leading zeros');
  requireThat(/^sha512-[A-Za-z0-9+/]{86}==$/.test(s.integrity), 'integrity must be a single SHA-512 SRI');
  const source = sources.find((x) => x.name === s.source);
  requireThat(source && s.package.startsWith(`${source.scope}/`), 'package is outside its registered source scope');
  return source;
}
export const submissionId = (s) => digest(s);
export function loadIndex(root) {
  const sources = validateSources(read(join(root, 'sources.json')));
  const vendors = existsSync(join(root, 'vendors')) ? readdirSync(join(root, 'vendors')).filter((f) => f.endsWith('.json')).sort().map((f) => read(join(root, 'vendors', f))) : [];
  const recommendations = existsSync(join(root, 'recommendations.json')) ? read(join(root, 'recommendations.json')) : {};
  const revocations = existsSync(join(root, 'revocations.json')) ? read(join(root, 'revocations.json')) : [];
  return { sources, vendors, recommendations, revocations };
}
export function validateIndex(index) {
  validateSources(index.sources);
  const identities = new Map();
  const packageOwners = new Map();
  const vendors = new Set();
  for (const e of index.vendors) {
    requireThat(idPattern.test(e.vendor) && !vendors.has(e.vendor) && Array.isArray(e.packages), 'invalid or repeated vendor');
    vendors.add(e.vendor);
    const packages = new Set();
    for (const p of e.packages) {
      const source = index.sources.find((s) => s.name === p.source);
      requireThat(packagePattern.test(p.name) && source && p.name.startsWith(`${source.scope}/`) && !packages.has(p.name), 'invalid or repeated package/source');
      packages.add(p.name);
      const owner = packageOwners.get(p.name);
      requireThat(!owner || (owner.vendor === e.vendor && owner.source === p.source), 'package vendor and source are immutable across versions');
      packageOwners.set(p.name, { vendor: e.vendor, source: p.source });
      const versions = new Set();
      for (const v of p.versions) {
        requireThat(versionPattern.test(v.version) && !versions.has(v.version), 'invalid or repeated version');
        versions.add(v.version);
        requireThat(['live', 'pending', 'rejected'].includes(v.status), 'invalid version status');
        const key = `${p.name}@${v.version}`;
        requireThat(!identities.has(key), `${key}: repeated package identity across vendors`);
        identities.set(key, { vendor: e.vendor, source: p.source, ...v });
      }
    }
  }
  requireThat(index.recommendations && typeof index.recommendations === 'object' && !Array.isArray(index.recommendations), 'recommendations must be an object');
  for (const [vendor, name] of Object.entries(index.recommendations)) requireThat(index.vendors.some((e) => e.vendor === vendor && e.packages.some((p) => p.name === name && p.versions.some((v) => v.status === 'live'))), `${vendor}: recommendation has no live package`);
  requireThat(Array.isArray(index.revocations), 'revocations must be an array');
  const revoked = new Set();
  for (const r of index.revocations) {
    exactKeys(r, ['package', 'version', 'reason'], 'revocation');
    const key = `${r.package}@${r.version}`;
    requireThat(identities.has(key) && !revoked.has(key) && typeof r.reason === 'string' && r.reason.trim(), 'revocation needs an existing unique release and reason');
    revoked.add(key);
  }
  return index;
}
export const revoked = (index, name, version) => index.revocations.some((r) => r.package === name && r.version === version);
export const compareVersions = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
export function defaults(index) {
  validateIndex(index);
  const out = {};
  for (const e of index.vendors) {
    const candidates = e.packages.map((p) => ({ p, v: p.versions.filter((v) => v.status === 'live' && !v.version.includes('-') && !revoked(index, p.name, v.version)).sort((a, b) => compareVersions(b.version, a.version))[0] })).filter((c) => c.v);
    const recommended = index.recommendations[e.vendor];
    const choice = recommended ? candidates.find((c) => c.p.name === recommended) : candidates.length === 1 ? candidates[0] : undefined;
    if (!choice && candidates.length) throw new Error(`${e.vendor}: select a live recommended package; competing publishers are not ordered by version`);
    if (recommended && !choice) throw new Error(`${e.vendor}: recommended package has no selectable release`);
    if (choice) out[e.vendor] = { name: choice.p.name, version: choice.v.version, source: choice.p.source, ...(choice.v.integrity ? { integrity: choice.v.integrity } : {}) };
  }
  return out;
}

/** A PR contributes one data change. Nothing from its tree is executed. */
export function classify(files, base, contents) {
  requireThat(files.length > 0, 'empty change');
  if (files.length === 1 && /^(submissions|reassessments)\/[a-f0-9]{64}\.json$/.test(files[0].filename)) {
    const f = files[0];
    requireThat(f.status === 'added', 'admitted submissions are immutable');
    const submission = JSON.parse(contents[f.filename]);
    const source = validateSubmission(submission, base.sources);
    const reassessment = f.filename.startsWith('reassessments/');
    requireThat(f.filename === `${reassessment ? 'reassessments' : 'submissions'}/${submissionId(submission)}.json`, 'submission filename does not match its identity');
    const previous = base.vendors.find((e) => e.vendor === submission.vendor)?.packages.find((p) => p.name === submission.package && p.source === submission.source)?.versions.find((v) => v.version === submission.version);
    if (reassessment) requireThat(previous?.status === 'live' && !previous.submission && !previous.assessment && (!previous.integrity || previous.integrity === submission.integrity), 'reassessment needs an unassessed historical release with identical identity');
    else requireThat(!base.vendors.some((e) => e.packages.some((p) => p.name === submission.package && p.versions.some((v) => v.version === submission.version))), 'release already in catalog');
    return { kind: reassessment ? 'reassessment' : 'submission', submission, source };
  }
  requireThat(!files.some((f) => f.filename.startsWith('submissions/') || f.filename.startsWith('reassessments/') || f.filename.startsWith('vendors/')), 'submissions cannot be mixed with policy, executable, or index edits');
  if (files.length === 1 && files[0].filename === 'sources.json') {
    const sources = validateSources(JSON.parse(contents['sources.json']));
    requireThat(sources.length === base.sources.length + 1 && base.sources.every((s) => sources.some((x) => stable(x) === stable(s))), 'source registration adds one source; existing registrations are immutable');
    return { kind: 'registration', source: sources.find((s) => !base.sources.some((x) => x.name === s.name)) };
  }
  requireThat(!files.some((f) => f.filename === 'sources.json'), 'source registration must be a separate data-only PR');
  if (files.every((f) => ['recommendations.json', 'revocations.json'].includes(f.filename))) {
    const next = { ...base };
    for (const f of files) { requireThat(f.status !== 'removed', 'policy data cannot be removed'); next[f.filename.split('.')[0]] = JSON.parse(contents[f.filename]); }
    validateIndex(next);
    requireThat(base.revocations.every((r) => next.revocations.some((x) => stable(x) === stable(r))), 'revocations are append-only');
    defaults(next);
    return { kind: 'selection' };
  }
  requireThat(!files.some((f) => ['recommendations.json', 'revocations.json'].includes(f.filename)), 'selection changes must be a separate data-only PR');
  return { kind: 'maintenance' };
}

export function admit(index, submission, commit, at, reassessment = false) {
  validateSubmission(submission, index.sources);
  requireThat(/^[a-f0-9]{40}$/.test(commit) && Number.isFinite(Date.parse(at)), 'admission needs a merge commit and timestamp');
  const existing = index.vendors.flatMap((e) => e.packages.flatMap((p) => p.name === submission.package ? p.versions.map((v) => ({ e, p, v })) : [])).find(({ v }) => v.version === submission.version);
  if (existing) {
    if (reassessment) {
      requireThat(existing.e.vendor === submission.vendor && existing.p.source === submission.source && existing.v.status === 'live' && (!existing.v.integrity || existing.v.integrity === submission.integrity) && !existing.v.submission && (!existing.v.assessment || existing.v.assessment === submissionId(submission)), 'historical reassessment identity conflict');
      Object.assign(existing.v, { integrity: submission.integrity, assessment: submissionId(submission), assessmentCommit: commit, assessedAt: at });
      return validateIndex(index);
    }
    requireThat(existing.e.vendor === submission.vendor && existing.p.source === submission.source && existing.v.integrity === submission.integrity && existing.v.submission === submissionId(submission), 'immutable release identity conflict');
    return index;
  }
  let e = index.vendors.find((v) => v.vendor === submission.vendor);
  if (!e) { e = { vendor: submission.vendor, packages: [] }; index.vendors.push(e); }
  let p = e.packages.find((p) => p.name === submission.package);
  if (!p) { p = { name: submission.package, source: submission.source, versions: [] }; e.packages.push(p); }
  requireThat(p.source === submission.source, 'package source is immutable');
  p.versions.push({ version: submission.version, status: 'live', integrity: submission.integrity, submission: submissionId(submission), commit, at, by: 'moderated-merge' });
  return validateIndex(index);
}

export function compareReports(current, previous) {
  if (!previous) return { baseline: null, note: 'No independently measured baseline; regressions are not assessed.' };
  requireThat(current.package === previous.package, 'cannot compare different publishers');
  const old = new Set(previous.quick?.servedOperations ?? []), now = new Set(current.quick?.servedOperations ?? []);
  return { baseline: previous.version, added: [...now].filter((x) => !old.has(x)), removed: [...old].filter((x) => !now.has(x)), previousDenominator: previous.quick?.surface?.total ?? null, denominator: current.quick?.surface?.total ?? null, previousFailures: previous.quick?.failures?.length ?? null, failures: current.quick?.failures?.length ?? null };
}
