// Mechanism regression, not a pack or an admission verdict. Invoked only by the offline Actions container.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPack, verifyBrowserTransport } from '@volter/twin-standard';
import { write } from '../lib/model.mjs';
assert.ok(process.env.VOLTER_WORLD, 'browser fixture must run through a World');
const authored = '/work/packs/authoring-fixture';
await createPack([authored, '--init', 'authoring-fixture', '--package', '@independent/payments']);
mkdirSync(join(authored, 'src/generated'), { recursive: true });
write(join(authored, 'src/generated/surface.gen.json'), { version: '1', operations: [], resources: [] });
write(join(authored, 'journeys/decisions.json'), { decisions: [] });
await createPack([authored, '--index']);
assert.equal(JSON.parse(readFileSync(join(authored, 'package.json'), 'utf8')).name, '@independent/payments');
assert.ok(readFileSync(join(authored, 'src/index.ts'), 'utf8').includes('createAuthoringFixtureTwinServer'));
const report = await verifyBrowserTransport('/work/packs/browser-fixture');
write('/work/browser-report.json', { ...report, authoringWithoutPlatformCheckout: true, independentPackageIdentity: '@independent/payments' });
