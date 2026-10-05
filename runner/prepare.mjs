// No credentials enter this container. This phase downloads data; scripts are disabled.
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { x } from 'tar';
import semver from 'semver';
import { verify as verifyBundle } from 'sigstore';
import { read, write, requireThat, digest } from '../lib/model.mjs';
import { metadata, registryURL, verifyArtifact, verifiedProvenance } from '../lib/registry.mjs';

const input = read('/input/input.json');
const { submission: s, source, policy } = input;
const doc = await metadata(s.package, s.version, policy.registry);
requireThat(doc.dist?.attestations?.url, 'npm provenance required; this version has no attestation');
const tarResponse = await fetch(registryURL(doc.dist.tarball, policy.registry), { redirect: 'error' });
requireThat(tarResponse.ok, `tarball: HTTP ${tarResponse.status}`);
const bytes = Buffer.from(await tarResponse.arrayBuffer());
verifyArtifact(bytes, s, doc);
writeFileSync('/work/artifact.tgz', bytes);
mkdirSync('/work/unpacked', { recursive: true });
await x({ file: '/work/artifact.tgz', cwd: '/work/unpacked', strict: true, filter: (path, entry) => {
  requireThat(path.startsWith('package/') && !path.split('/').includes('..') && !path.includes('\\') && ['File', 'Directory'].includes(entry.type), `unsafe archive entry: ${path}`);
  requireThat(!path.split('/').includes('node_modules') && !path.endsWith('/.npmrc'), 'artifact carries installation configuration or dependencies');
  return true;
} });
const pack = read('/work/unpacked/package/package.json');
requireThat(pack.name === s.package && pack.version === s.version, 'artifact manifest identity mismatch');
requireThat(typeof pack.license === 'string' && pack.license.trim() && pack.license !== 'UNLICENSED', 'artifact needs a redistributable license declaration for moderator review');
const repository = typeof pack.repository === 'string' ? pack.repository : pack.repository?.url;
requireThat(repository?.replace(/^git\+/, '').replace(/\.git$/, '') === `https://github.com/${source.repository}`, 'artifact repository differs from registered source');
const facts = read('/work/unpacked/package/generated/pack-facts.json');
requireThat(Object.keys(facts.packs ?? {}).length === 1 && facts.packs[s.vendor]?.protocol?.declared === '3', 'artifact facts must identify the submitted vendor and Protocol 3');
for (const group of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
  for (const [name, range] of Object.entries(pack[group] ?? {})) requireThat(typeof range === 'string' && semver.validRange(range), `${name}: registry semver dependencies only; git, file, URL and alias dependencies are not admitted`);
}
// npm verifies the registry artifact itself, not a local-directory replacement.
// The standard's client cases and the pack's declared SDK examples need their pinned development clients too.
// This installs data only; candidate scripts never execute in the networked preparation phase.
const standardManifest = read('/opt/catalog/node_modules/@volter/twin-standard/package.json');
const dependencies = { ...standardManifest.devDependencies, ...pack.devDependencies, ...policy.tools, [s.package]: s.version };
requireThat(!Object.hasOwn(policy.tools, s.package), 'submission collides with evaluator tooling');
write('/work/package.json', { name: 'catalog-assessment', private: true, dependencies });
const npm = (args) => {
  const r = spawnSync('npm', [...args, '--registry', policy.registry], { cwd: '/work', encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  requireThat(r.status === 0, `npm ${args[0]} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
};
npm(['install', '--ignore-scripts', '--no-audit', '--no-fund']);
const lock = read('/work/package-lock.json');
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (!path) continue;
  requireThat(!entry.link && entry.resolved && entry.integrity, `${path}: dependency is not a locked registry artifact`);
  registryURL(entry.resolved, policy.registry);
}
for (const [name, version] of Object.entries(policy.tools)) requireThat(lock.packages?.[`node_modules/${name}`]?.version === version, `${name}: evaluator version differs from policy`);
requireThat(lock.packages?.[`node_modules/${s.package}`]?.integrity === s.integrity, 'installed artifact differs from submission');
const candidateRequire = createRequire(join('/work/node_modules', s.package, 'package.json'));
const evaluatorRequire = createRequire('/work/package.json');
requireThat(candidateRequire.resolve('@volter/world-core/runtime') === evaluatorRequire.resolve('@volter/world-core/runtime'), 'candidate resolves a different kernel from the policy-pinned assessment; adjust its SDK range');
const clientSdkLocks = [];
for (const directory of standardManifest.assessmentClientSdks ?? []) {
  requireThat(typeof directory === 'string' && /^[a-z][a-z0-9-]*$/.test(directory), 'standard client SDK directory must be a package-local name');
  const sdkRoot = join('/work/node_modules/@volter/twin-standard', directory);
  const sdkLock = readFileSync(join(sdkRoot, 'bun.lock'), 'utf8');
  const installed = spawnSync('bun', ['install', '--frozen-lockfile', '--ignore-scripts', '--registry', policy.registry], { cwd: sdkRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  requireThat(installed.status === 0, `standard client SDK preparation failed: ${installed.stderr}`);
  requireThat(readFileSync(join(sdkRoot, 'bun.lock'), 'utf8') === sdkLock, 'standard client SDK lock changed during frozen installation');
  clientSdkLocks.push({ directory, manifest: read(join(sdkRoot, 'package.json')), lock: sdkLock, sha256: digest(sdkLock) });
}
const audit = npm(['audit', 'signatures', '--json']);
writeFileSync('/work/signatures.json', audit);
const response = await fetch(registryURL(doc.dist.attestations.url, policy.registry), { redirect: 'error' });
requireThat(response.ok, `attestation: HTTP ${response.status}`);
const provenance = await verifiedProvenance(await response.json(), source, bytes, verifyBundle);
// Keep a vendor-named package directory for the standard's public directory API; preserve the installed artifact.
mkdirSync('/work/packs', { recursive: true });
cpSync(join('/work/node_modules', s.package), join('/work/packs', s.vendor), { recursive: true });
write('/work/prepared.json', { schemaVersion: 1, submission: s, integrity: s.integrity, provenance, dependencyLockSha256: digest(readFileSync('/work/package-lock.json', 'utf8')), clientSdkLocks, tools: policy.tools });
write('/work/world.json', { id: 'catalog-assessment', network: { egress: [] }, services: [] });
