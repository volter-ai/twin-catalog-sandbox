// Runs only inside the offline container and a task-owned World. The released standard owns all pack checks.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { read, requireThat, write, compareReports } from '../lib/model.mjs';
requireThat(Boolean(process.env.VOLTER_WORLD), 'evaluation must run inside a World');
const { submission: s } = read('/input/input.json');
const requireFromPack = createRequire('/work/package.json');
const { assessPack } = await import(requireFromPack.resolve('@volter/twin-standard'));
const assessment = await assessPack(join('/work/packs', s.vendor), { browser: true });
requireThat(assessment.package === s.package && assessment.version === s.version && assessment.vendor === s.vendor, 'assessment returned a different artifact identity');
const report = { ...assessment, integrity: s.integrity, prepared: read('/work/prepared.json') };
report.comparison = compareReports(report, existsSync('/input/baseline.json') ? read('/input/baseline.json') : null);
write('/work/report.json', report);
process.exit(report.ready ? 0 : 1);
