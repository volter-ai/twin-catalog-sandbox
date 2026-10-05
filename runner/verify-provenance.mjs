import { join, resolve } from 'node:path';
import { read, write } from '../lib/model.mjs';
import { withContainer } from '../lib/runner.mjs';
const root = resolve('.'), policy = read(join(root, 'policy.json'));
const output = join(root, 'assessment/provenance.json');
try {
  const report = withContainer(root, { policy, purpose: 'provenance-mechanism-fixture' }, output, ({ image, common, run, owner }) => {
    // Verification needs the registry and Sigstore trust services; candidate execution remains offline.
    const destinations = ['https://registry.npmjs.org', 'https://tuf-repo-cdn.sigstore.dev', 'https://tuf-repo.sigstore.dev'];
    const config = { id: 'catalog-provenance-fixture', services: [], network: { phase: 'build', egress: destinations, passthrough: destinations } };
    run([...common, '--network', 'none', image, '-e', 'require("fs").writeFileSync("/work/world.json",process.argv[1])', JSON.stringify(config)]);
    run([...common, '--entrypoint', 'bun', image, '/opt/catalog/node_modules/@volter/world-runtime/src/cli.ts', 'run', '/work/world.json', '--root', '/work', '--env-out', '/work/world.env', '--owner', owner, '--', 'node', '/opt/catalog/runner/provenance-fixture.mjs']);
    const result = run([...common, '--network', 'none', image, '-e', 'process.stdout.write(require("fs").readFileSync("/work/provenance-report.json","utf8"))']);
    return { schemaVersion: 1, image, policy, ...JSON.parse(result.stdout) };
  });
  write(output, report);
} catch (error) {
  write(output, { schemaVersion: 1, purpose: 'provenance-mechanism-fixture', passed: false, error: String(error.message ?? error) });
  throw error;
}
