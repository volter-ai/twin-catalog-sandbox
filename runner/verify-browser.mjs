// Exercise the released browser transport in the same offline container as admission. This admits no package.
import { join, resolve } from 'node:path';
import { read, write, requireThat } from '../lib/model.mjs';
import { withContainer } from '../lib/runner.mjs';
const root = resolve('.'), policy = read(join(root, 'policy.json'));
const output = join(root, 'assessment/browser.json');
try {
  const result = withContainer(root, { policy, purpose: 'browser-transport-fixture' }, output, ({ image, common, run, owner }) => {
    run([...common, '--network', 'none', image, '-e', 'const fs=require("fs");fs.writeFileSync("/work/world.json",JSON.stringify({id:"catalog-browser-fixture",services:[],network:{egress:[]}}));fs.symlinkSync("/opt/catalog/node_modules","/work/node_modules");']);
    const walked = run([...common, '--network', 'none', '--entrypoint', 'bun', image, '/opt/catalog/node_modules/@volter/world-runtime/src/cli.ts', 'run', '/work/world.json', '--root', '/work', '--env-out', '/work/world.env', '--owner', owner, '--', 'bun', '/opt/catalog/runner/browser-fixture.ts'], true);
    const report = run([...common, '--network', 'none', image, '-e', 'process.stdout.write(require("fs").readFileSync("/work/browser-report.json","utf8"))'], true);
    requireThat(walked.status === 0 && report.status === 0, 'released browser transport fixture failed; inspect browser diagnostics');
    return { schemaVersion: 1, image, policy, ...JSON.parse(report.stdout) };
  });
  write(output, result);
} catch (error) {
  write(output, { schemaVersion: 1, ready: false, purpose: 'browser-transport-fixture', error: String(error.message ?? error) });
  throw error;
}
