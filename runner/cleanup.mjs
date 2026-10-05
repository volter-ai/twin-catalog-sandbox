// A cancellation may lose the controller; remove only resources explicitly owned by this workflow run.
import { spawnSync } from 'node:child_process';
const run = (...args) => spawnSync('docker', args, { encoding: 'utf8' });
if (!/^[0-9]+-[0-9]+$/.test(process.env.CATALOG_RUN ?? '')) throw new Error('workflow run identity required');
const containers = run('ps', '-aq', '--filter', `label=twin-catalog.run=${process.env.CATALOG_RUN}`);
if (containers.status !== 0) throw new Error('cannot inspect owned containers');
const ids = containers.stdout.trim().split(/\s+/).filter(Boolean);
if (ids.length && run('rm', '-f', ...ids).status !== 0) throw new Error('owned container teardown failed');
// Volume ownership is also tagged by the host controller, and no unlabelled resource is eligible.
const volumes = run('volume', 'ls', '-q', '--filter', `label=twin-catalog.run=${process.env.CATALOG_RUN}`);
if (volumes.status !== 0) throw new Error('cannot inspect owned volumes');
for (const id of volumes.stdout.trim().split(/\s+/).filter(Boolean)) if (run('volume', 'rm', id).status !== 0) throw new Error(`owned volume teardown failed: ${id}`);
