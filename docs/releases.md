# Maintainer release guide

The automated path is a Conventional Commit on `main` → Release Please version/changelog PR → reviewed merge → published GitHub Release → `.github/workflows/publish.yml`. The initial version is `0.1.0`; the empty manifest tells Release Please that this package has not been released yet. Do not edit the manifest to `0.1.0` before the first release: that would mark it as an already released version.

## One-time administrator setup

1. Protect `main`, require reviewed pull requests, and require the `Static checks and unit tests`, `Chromium browser tests`, and all nine `Node … / Hexo …` CI checks. The matrix covers Node 20/22/24 and Hexo 7.1.1/7.3.0/8.1.2; every cell builds Landscape, NexT, and the minimal Cactus fixture at both `/` and `/blog/`.
2. Install a GitHub App on **only this repository**, with Contents, Pull requests, and Issues read/write permissions. Store its App ID in the repository variable `RELEASE_APP_ID` and private key in the Actions secret `RELEASE_APP_PRIVATE_KEY`. Enable GitHub Actions pull-request creation if the repository policy requires it. The workflow obtains a short-lived installation token; it does not need a personal access token.
3. Create the GitHub environment `npm`, restrict deployments to release tags, and configure any desired required reviewers. The release workflow validates that the tag is exactly `v` followed by the checked-out package version.
4. Establish npm package ownership for `hexo-post-map` using the maintainer's interactive npm account and 2FA as needed for the first publication. Configure its npm Trusted Publisher with owner `xizidev`, repository `hexo-post-map`, workflow filename `publish.yml`, and environment `npm`. Enable direct `npm publish` as an allowed action when the npm settings offer that choice. First ownership/bootstrap publication is a maintainer operation; do not add an npm write token to this repository. If bootstrapping publishes `0.1.0` manually, do not rerun publication of that version; let the automated workflow publish the next release.

The App token matters: releases and PRs created with the default `GITHUB_TOKEN` do not trigger subsequent workflows. See the [Release Please action documentation](https://github.com/googleapis/release-please-action#other-actions-on-release-please-prs). Release Please only manages version PRs, tags, changelog entries, and GitHub Releases; it never publishes npm.

## What the publication gate verifies

`publish.yml` runs only for a published GitHub Release, checks out that tag, and uses a fresh GitHub-hosted Ubuntu runner with Node 24 and current npm. Permissions are `contents: read` and `id-token: write`; no dependency or build cache is restored. npm Trusted Publishing uses OIDC and provenance, as described in the [npm documentation](https://docs.npmjs.com/trusted-publishers/).

The job performs `npm ci`, formatting/lint/type/unit/build checks, and creates one tarball outside the checkout. It tests that exact tarball in the complete Hexo/theme/root matrix and in Chromium. `HPM_PACKED_TARBALL` instructs both the integration runner and browser fixture server to install the supplied file instead of creating another package. Each fixture verifies npm's recorded tarball integrity. The job checks the original SHA-256 again immediately before publishing that same file with lifecycle scripts disabled. Any failed step prevents publication. Failure traces contain only the credential-free deterministic provider tests.

Required CI exercises the three Node versions separately. The release rerun exercises the complete Hexo/theme/root and browser suite on Node 24. The optional real AMap smoke test is not a release gate and receives no credentials here.

## Local artifact rehearsal

Run `npm run check`, `npm run test:integration`, `npm run test:e2e`, and `npm pack --dry-run`. To test a previously packed file, provide an absolute path through `HPM_PACKED_TARBALL` when running either test command. A missing file fails immediately; it never falls back to packing local source. The runner deletes only its own temporary fixtures and retains the supplied tarball.

Workflow files do not configure repository branch protection, GitHub App permissions, environment protection, npm ownership, or the npm Trusted Publisher. Those external settings must be completed before enabling releases. A published GitHub Release is the publication authorization boundary; ordinary pushes and pull requests cannot publish npm.
