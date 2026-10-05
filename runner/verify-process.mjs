// Process fixtures use only released runtime tooling and a disposable World. No platform checkout.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { read, write, requireThat } from '../lib/model.mjs';
const root = resolve('.'), policy = read(join(root, 'policy.json'));
const temp = mkdtempSync(join(tmpdir(), 'catalog-process-tools-'));
write(join(temp, 'package.json'), { private: true, dependencies: { '@volter/world-runtime': policy.tools['@volter/world-runtime'], '@volter/world-core': policy.tools['@volter/world-core'] } });
let result = spawnSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--registry', policy.registry], { cwd: temp, stdio: 'inherit' });
requireThat(result.status === 0, 'released process-tool installation failed');
const config = join(temp, 'assessment.world.config.json');
write(config, { id: 'catalog-process-verification', services: [], network: { egress: [] } });
result = spawnSync('bun', [join(temp, 'node_modules/@volter/world-runtime/src/cli.ts'), 'run', config, '--root', temp, '--env-out', join(temp, 'assessment.env'), '--owner', 'catalog-process-verification', '--', 'node', '--test', join(root, 'test/process.test.mjs'), join(root, 'test/artifact.test.mjs')], { cwd: root, stdio: 'inherit' });
write(join(root, 'assessment/process.json'), { exit: result.status, tools: policy.tools });
process.exit(result.status ?? 1);
