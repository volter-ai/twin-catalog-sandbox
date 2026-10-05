import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { build, builtIndex } from '../lib/publication.mjs';
import { defaults, read } from '../lib/model.mjs';

test('built index installs and its consumer CLI works without platform or pack checkouts', () => {
  assert.ok(process.env.VOLTER_WORLD, 'artifact verification must run through a World');
  const source = resolve(new URL('..', import.meta.url).pathname);
  const temp = mkdtempSync(join(tmpdir(), 'catalog-artifact-consumer-'));
  const artifact = join(temp, 'artifact'), consumer = join(temp, 'consumer');
  mkdirSync(consumer);
  const identity = build(source, artifact);
  const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json'], { cwd: artifact, encoding: 'utf8' }));
  execFileSync('npm', ['install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--package-lock=false', join(artifact, packed[0].filename)], { cwd: consumer, encoding: 'utf8' });
  const installed = join(consumer, 'node_modules', read(join(source, 'package.json')).name);
  const command = (verb) => JSON.parse(execFileSync('node', [join(installed, 'bin/twin-catalog.mjs'), verb], { cwd: consumer, encoding: 'utf8' }));
  assert.deepEqual(command('check'), { valid: true });
  assert.deepEqual(command('defaults'), defaults(builtIndex(source)));
  const data = read(join(installed, 'catalog.json'));
  assert.equal(data.sourceCommit, identity.sourceCommit);
  assert.equal(read(join(installed, 'package.json')).catalog.digest, identity.digest);
  assert.ok(data.versions.every((version) => typeof version.assessed === 'boolean'));
});
