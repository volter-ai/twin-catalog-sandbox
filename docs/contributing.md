# Publish from your own repository

The catalog accepts independently named packages from independently owned repositories. Use the released standard,
not scripts from a platform checkout. Read the [process](process.md) for identity, assessment and moderator authority.

## Build a pack

Install Bun at the catalog policy's version and the public `@volter/world-core`, `@volter/world-runtime` and
`@volter/twin-standard` versions in `policy.json`. Install TypeScript and its Node/Bun types as development dependencies.
Keep the package directory named for the vendor; its npm package name is independent.

```sh
bunx --bun twin-standard create stripe --init stripe --package @example/payments
```

The generated files contain explicit fill markers. Author the vendored spec and its provenance, demand, manifest,
stored resource states, decision table, handlers and customer journey in the standard's required order. The package
README describes its vendor surface, refusals and limits. Declare your own public GitHub repository and license in
package.json. Complete source requirements before derivation:

```sh
bunx --bun twin-standard check-sources stripe
bunx --bun twin-standard derive stripe
bunx --bun twin-standard create stripe --index
bunx --bun twin-standard facts stripe
```

The command has the same handler-map and kernel contract as Volter's own wrapper. The generated facts belong in the
package artifact; keep source, spec, journeys and required fixtures there too. Publish compiled JavaScript for Node
consumers while retaining the TypeScript source the pinned standard reads. Use TypeScript's
`rewriteRelativeImportExtensions`, copy generated JSON alongside emitted modules, and point the package export and
bin at their compiled entrypoints. A `files` list includes `src`, `dist`, `generated`, `spec`, `journeys`, README and
LICENSE. A build and `npm pack --dry-run` must show those paths; no platform-specific prepack script is required.

## Assess before submitting

Walk the life's journeys while implementing. For the final assessment, run the released standard through a World:

Create `assessment.world.config.json`:

```json
{ "id": "pack-assessment", "services": [], "network": { "egress": [] } }
```

```sh
volter-world run assessment.world.config.json --root . --env-out /tmp/new-assessment.env --owner pack-assessment -- bunx --bun twin-standard assess stripe --browser --out assessment.json
```

The assessment config has no vendor services; the standard creates fresh in-memory World state for each journey.
For an HTTP browser target, use Linux, install Playwright at the catalog policy version and its Chromium binary,
and install `libfaketime` (Debian/Ubuntu: `sudo apt-get install libfaketime`). The browser process uses the World
clock for native cookie expiry, at one-second precision; JavaScript time retains millisecond precision. Authors on
other platforms can omit `--browser` for in-process assessment; catalog Actions supplies the browser target. The report
separates declared served/gap counts, operations actually exercised, deterministic replay, conformance and Chromium
results. It does not measure DOM interactions, line coverage, real-vendor parity or every possible state transition.

Local assessment helps authors; it does not replace the independent catalog assessment of the published tarball.
Linux catalog preparation disables installation scripts. A dependency that requires a build cannot depend on its
postinstall having run there: distribute the needed portable build or choose supported dependencies.

## Register and publish

Register your public repository, npm scope and release workflow in a separate moderator-reviewed `sources.json` PR.
Pin your own dependencies and commit the lock. Your workflow runs on GitHub-hosted Linux with `id-token: write`,
builds your artifact, and uses npm trusted publishing or your own scoped npm credential:

```sh
npm publish --ignore-scripts --access public --provenance
```

The artifact's repository URL matches the registered repository; the signing workflow filename matches registration.
Publishing does not admit a release. After source registration has merged, use the catalog CLI from a catalog fork:

```sh
twin-catalog submit --source example-team --vendor stripe --package @example/payments --version 1.2.3
```

Open a PR adding only its generated submission. The Actions job checks the registry artifact at the exact integrity,
using catalog policy and released tools, then posts evidence for moderator review. Fixes need a new immutable release;
infrastructure failures can be retried. Moderators review and merge; the publisher and catalog bots do neither.
