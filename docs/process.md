# Catalog process

This repository operates admission and distribution of twin packages from independent publishers. The platform owns
the runtime, Protocol 3 and the versioned standard. Publishers own their source and npm releases. This repository
owns source registration, submissions, evaluation policy, moderator decisions and the approved index. It requires
released tools, not a platform checkout. Its executable contract is the modules in `lib/` and the workflows in
`.github/workflows/`; `bin/twin-catalog.mjs` exposes the same operations to contributors and automation.

## Identity and authority

A vendor is a service being simulated. An implementation is an npm package. A release is an exact package version
with a SHA-512 integrity value. A source is a registered GitHub repository, npm scope and release-workflow identity.
One repository may publish several packages. Several repositories may implement the same vendor. Package names are
not vendor identities. Version ordering applies only within one package, never between competing implementations.

`sources.json` registers sources. Registration is its own moderator-reviewed PR; a submission cannot grant its source
trust, change evaluation tools, or change catalog policy. `official` identifies Volter maintenance, not a verification
exemption or vendor endorsement. Every new release follows the same readiness requirements. Outside contributions
require current-head human moderator approval. Maintainers may merge their own changes without a separate review.
Internal admissions require the registered repository to be explicitly listed in `policy.internalRepositories`,
a PR branch in this catalog repository, and a merge by a maintainer named in `policy.reviewBypassUsers` whose current
GitHub permission is `admin` or `maintain`. The author must be a repository member/collaborator or its GitHub Actions
bot. A bot author or `official` badge alone does not make an outside publisher internal.
Public-source npm provenance is required for new admissions. Existing index records without an assessment remain
historical records, explicitly unassessed; migration does not manufacture evidence or reapprove them. A separate
`reassessments/<id>.json` PR uses the same immutable submission schema, checks and moderator review to assess an
unassessed historical release without rewriting its admission commit. Missing original provenance still fails;
publishing and admitting a new version is the repair.

`recommendations.json` explicitly selects the default package when a vendor has multiple live implementations.
One live implementation is unambiguous. With several and no recommendation, resolution refuses to guess. A
recommendation is moderated separately from a submission and selects a package, whose newest stable approved
version is offered. Prereleases require an explicit version. A World pins package and version; a catalog update
does not change that pin. Removing a recommendation is not uninstalling a running World.

## Submission

A release PR adds exactly one `submissions/<id>.json`, with no executable files or index edits:

```json
{
  "schemaVersion": 1,
  "source": "example-team",
  "vendor": "stripe",
  "package": "@example/stripe-simulator",
  "version": "1.2.3",
  "integrity": "sha512-BASE64_OF_THE_ARTIFACT_DIGEST"
}
```

The id is the SHA-256 of the canonical submission fields. The CLI reads registry metadata and creates the file;
it does not run package code, publish a package, open a PR, or send a message. The author opens the PR normally.
The registry is catalog policy, not contributor input. Tags, ranges, URLs, git dependencies and mutable versions
are not release identities. Artifact package.json must match the submitted package and version, declare a license,
and name the registered repository. Generated pack facts must identify exactly the submitted vendor and Protocol 3.
An already admitted package/version cannot acquire different bytes or a different vendor/source.

The catalog evaluates only the tarball fetched at the declared integrity. Package source in the contributor's
repository and evidence supplied in the PR are context, never substitutes for running that artifact. A submission
cannot select its own evaluator, thresholds, registry, commands or privileges.

## State and invalidation

| State | Evidence | Next action |
|---|---|---|
| Submitted | A release PR with valid data | Automation resolves the artifact |
| Checking | Current-head readiness check in progress | Automation evaluates |
| Changes needed | Validation, evaluation or replay failed | Contributor updates and resubmits |
| Ready for review | Required checks passed for this head and policy | Moderator inspects evidence |
| Approved | Authorized current-head review; required checks still current | Moderator merges |
| Admitted | Approved merge on protected main | Publication builds the index |
| Rejected | Moderator closes the PR with a reason | New submission if corrected |

Readiness is not approval. Catalog assessment never approves or merges. Review dismissal on new commits, required current-head checks,
CODEOWNERS review and a branch rule requiring the branch to be current enforce the decision. A moderator's identity
comes from GitHub review and merge events, never a contributor's `by` string. Self-approval is not accepted as review.
Named maintainers have a review bypass for internal changes; outside admissions still need human review, and both
paths need current-head readiness. Publication records which admission path and merger established authority.
The repository's installation command checks/configures these rules explicitly; merely committing a workflow is not
evidence that they are enabled. No credentials or repository settings are changed by an ordinary build.

An assessment binds the PR number and head SHA, base SHA, source registration, submission, policy, evaluator package
versions, container image identity, artifact integrity and resolved dependency lock. Evidence from an earlier head
does not satisfy a new one. A base update requires updating the branch and a new readiness run. Jobs cancel superseded
runs; their historical reports remain evidence only. A merged policy change affects subsequent admission runs; it
does not retroactively certify old releases under the new policy. Publication checks the admitted submission identity. Identical reruns retain their inputs and produce comparable
results. A failed or interrupted run has no successful readiness receipt.

## Execution boundary

PR data is read using the GitHub API from the exact head. Trusted automation is checked out from the base commit,
never the contributor's head. Source-registration and maintenance PRs do not execute candidate scripts. All package
extraction, dependency installation and evaluation occur in disposable containers with no repository, npm, cloud,
moderation or publication credentials, no Docker socket and no host project mounts. Install scripts are disabled.
Dependencies are resolved once into a recorded lock; evaluation reuses that installation with network disabled.
Input data is readable by the container's unprivileged user. Setup and preparation failures produce a failed JSON
envelope as well as diagnostics; neither can establish readiness. Owner-dispatched verification walks a synthetic
browser transport fixture through the same offline boundary before assessing an actual artifact. The fixture checks
fresh cookie jars, complete request headers, binary bodies, empty responses, CORS and replay equality; it grants no admission.
The versioned standard owns this fixture. Missing CORS permission remains a denial even when Playwright would add
mock-response permission. Context teardown is awaited before the next replay.
A separate public-tooling fixture verifies a real npm SLSA bundle and rejects substituted bytes and repositories.
Process verification also builds and installs the index tarball and runs its consumer CLI in a directory without
platform packages or pack checkouts. This checks distribution packaging without claiming a registry publication.
Registry publish receipts are distinct from repository provenance; SHA-512 subjects emitted by npm and SHA-256
subjects are checked against the downloaded artifact, with conflicting declared digests refused.
The released standard declares its separate SDK fixture directories. Preparation installs those trusted, frozen
locks with scripts disabled and retains them in the receipt, so their client cases need no installation offline.
Owner verification may expect the specific missing-provenance refusal for a historical fixture. That verifies the
negative path while retaining its changes-needed envelope; it cannot create the admission workflow's readiness check.
Preparation's registry reads and evaluation's offline phase are reported separately. A World alone is cooperative
routing, not the isolation boundary: the container enforces the evaluation network boundary.

The trusted controller owns success/failure, hashes and run identity. Candidate output is untrusted data; bounded
report parsing never executes it or interpolates it into a shell. It can explain results but cannot confer merge or
publication authority. The trusted summary renderer escapes contributor strings and neutralizes mentions. Raw logs
and JSON evidence are downloadable artifacts. There is no execution of arbitrary contributor-supplied test commands.
Conformance and journey checks are the versioned standard's own entrypoints. Like any in-process plugin check, they
measure cooperative pack behavior, not a proof that malicious executable code cannot deceive a test; moderator
source review remains part of admission.

Provenance verification checks the registry signature/attestation using npm's verifier, cryptographically verifies the exact downloaded Sigstore bundle, and checks the attested
repository/workflow against the registered source. A certificate-shaped string alone is not verification. The
artifact digest is independently recomputed. Private-source publication without provenance cannot claim readiness.

## Evaluation and reports

The versioned `@volter/twin-standard` owns the checks and machine-readable assessment API. The catalog invokes it;
it does not implement another Protocol 3 grader or journey engine. Evaluation occurs inside a task-owned World.

Quick assessment walks the packaged customer journey twice from fresh state with the same clock and World draws.
It reports failures, answered steps, response replay equality, and served/gap counts over the entire declared surface. Actual operation coverage comes from kernel dispatch, with
every declared gap retained in the denominator; declared support and exercised coverage are separate fields.
An empty journey or missing response trace cannot establish replay. Unsupported instrumentation is `null`/not measured,
never zero or 100%. Quick assessment does not claim browser DOM coverage, real-vendor parity, line coverage, or complete
state-transition coverage. Those require their own instruments. HTTP-only journeys also replay twice through Chromium's fetch, cookie jar and HTTP response behavior, using the same
walker and operation observer. Mixed or non-HTTP wires report browser measurement as unavailable. This target measures
no DOM interactions or real-vendor parity. World and JavaScript clocks are frozen; Chromium's process wall time follows
World time through libfaketime, at one-second native precision. Monotonic timers retain elapsed machine time. Verification
checks both native `Expires` and `Max-Age` across a World clock advance; no expiry headers are rewritten. The exact
Chromium version, clock precision and browser replay results are reported.

Admission adds form checks for every unit and full deterministic conformance. A failure in any required check blocks
readiness; a grade percentage is informational, not a threshold. Missing optional coverage is shown explicitly.
Comparison to the previous approved version names added/removed served operations, failure counts and changed denominators;
it never compares two different publishers' percentages as though they share a surface. A missing baseline is
reported, not treated as no regression. Evaluation reports and catalog output are JSON for later page integration.

Reports identify measurement scope, inputs, tool versions and execution target. Publisher evidence and independent
catalog measurements remain distinguishable. A moderator may reject an otherwise passing submission for implausible
journeys, misleading scope, provenance problems, maintenance concerns or source defects, with a concrete reason.

## Discovery and consumer integration

The npm artifact is the distribution interface. `catalog.json` schema 1 lists every recorded vendor/package/version,
its source, status, integrity when known, and evidence reference. `assessed: false` and `evidence: null` explicitly mark
historical records. Consumers read `recommendations.json` and `revocations.json` beside it. Displaying a recorded
release is different from offering it as an install default: pending, rejected, revoked and prerelease versions are
never automatic selections. A missing or failing assessment is never inferred from a publisher badge.

A future catalog page groups implementations under a vendor, attributes the repository and publisher, and links to
the immutable version and admission PR/evidence. It can display readiness, support counts, journey failures and replay
results separately. A contributor sees the PR check, one updated feedback comment, and downloadable workflow artifacts.
Readiness checks commit the report digest in their external receipt. After approved merge, the publisher validates
the workflow either from its run URL or GitHub's check-suite/run association when GitHub returns a check URL.
It requires the trusted readiness workflow, matching suite and head, and the report's bound input identity;
an unrelated workflow or substituted artifact cannot supply evidence. The publisher then validates
the report against that receipt and stores it in a GitHub evidence release and in the index package's `evidence/`.
Reports include the resolved dependency lock. Workflow logs remain supplementary artifacts with configured retention.
If evidence expires before its first durable copy, publication refuses; it never reconstructs a passing report.
This process supplies data for a browse page and does not deploy one.

`volter world init` uses the installed catalog's selected exact package version when installing a missing vendor.
Already installed pack identities come from their generated facts. Multiple installed implementations require a
recommendation or an explicit World package choice; unrelated version numbers cannot resolve that choice. Existing
World pins remain subject to the runtime's normal version checks. Revocation changes future catalog selection, not
an existing World's declared dependency; the catalog cannot remotely uninstall code from an application.

## Merge and publication

The publication workflow runs only when the repository variable `CATALOG_PUBLISH_ENABLED` is `true`; activation
follows successful Actions verification and moderator configuration. Protected main is the admission ledger. Submission files are immutable after admission. The publisher rebuilds from
the existing index and merged submissions, adding versions without altering historical identity. It writes
`sources.json`, `vendors/`, `recommendations.json` and machine-readable catalog metadata into the package artifact.
Each admitted version links to its submission and merge commit; the GitHub PR retains reviews and readiness artifacts.
Index generation does not import a pack, execute tests or rebuild the platform. The website and hosted runtime are
independent consumers of the published index; their absence or build failures do not block index publication.

The publisher verifies branch protection and merger permissions with read-only GitHub App access, separate from
its index/evidence write token. Install the App only on the catalog repositories with administration, contents,
checks and pull requests set to read. Store its client ID in `CATALOG_READ_APP_CLIENT_ID` and private key in
`CATALOG_READ_APP_PRIVATE_KEY`. The pinned token action requests those permissions only for the current catalog
repository and revokes its installation token after the job. The key is available only to the trusted publication
job; candidate preparation and evaluation remain credential-free. A preconfigured equivalent `CATALOG_READ_TOKEN`
is supported for existing operators. Missing read access fails admission verification and cannot bypass it.

Publication is serialized and starts from a clean checkout of current protected main. An obsolete queued job refuses
to publish, so it cannot move the registry default backwards; retry on current main includes its admitted releases.
A release identifies its source commit and npm artifact; retrying the same commit reuses
the same version, verifies identity if it already exists, and does not publish a duplicate. A registry conflict with
different identity fails. A publish failure leaves the admitted ledger intact and is retryable; it does not mark
anything deployed. Credentialed publication never evaluates candidate code. Rejection records remain in closed PRs;
they are not added to the resolvable index. Revocation of an admitted version is an explicit moderator-maintained
record with a reason; it removes the version from future selection without rewriting its artifact or existing pins.

## Contribution and operation

Contributors can create and index fixed pack files, derive their vendored spec, compile package facts and assess
with released `twin-standard` commands. Contributors need a public source repository, their own scoped npm package and the released SDK/standard. No Volter
checkout, private company record or particular pack-repository layout is required by the catalog. Source registration,
submission, checking, generation and publishing commands are documented in README. Published CLI tooling includes
the schema/validation code, so contributors see the same refusals before opening a PR.

Automation maintains one PR feedback comment, includes the report in the check summary, and updates it on reruns.
GitHub reads retry one transport failure; HTTP refusals and writes are not retried. A transport failure identifies
the method, repository path and underlying error code. A passing evaluation remains retained evidence until GitHub
successfully records its current-head readiness check; it does not grant admission on its own.
Manual workflow dispatch can reassess a PR after an external failure. Moderators configure membership through the
repository's CODEOWNERS users or teams; platform write access is not required. Repository setup and npm publication are explicit
operator actions. Deploy tokens, website changes, making repositories public, and operating GitHub settings are not
performed as part of implementing this process.

## Acceptance cases

The acceptance contract below spans process fixtures and the isolated evaluator. Local fixture results cover only
the cases they exercise; container/provenance execution and browser execution must be reported separately. Verification
uses synthetic inputs where possible and never real publication:

1. An independently scoped, arbitrarily named package maps to its declared vendor and remains pinned when used.
2. Two packages for one vendor are retained; no cross-package semver comparison chooses the winner. Recommendation
   selects the default; absent or revoked choices fail visibly.
3. A submission cannot alter source trust, policy, workflows, commands, index records or an admitted submission.
4. Changed bytes, package identity, vendor facts, provenance, head, base or evaluator invalidate the corresponding
   assessment. Failed, cancelled or missing checks never become ready or admitted.
5. Empty/mismatching replay fails; passing checks and partial surface remain separate measurements.
6. Moderator review is required after readiness; approval of an old head and contributor-supplied reviewer names
   cannot admit a release. Automation has no merge path.
7. Merging adds one immutable release, preserves other publishers and pins, and produces an index without a platform
   checkout, hosted build or website.
8. Publication retry is idempotent; a conflicting published identity fails, and a revoked release is not recommended.

Results state exactly what ran. Static workflow inspection and local fixture checks are not a real GitHub/npm
activation, and a local quick assessment is not a browser fidelity result.
