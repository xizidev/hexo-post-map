# Contributing

Bug reports and focused pull requests are welcome in English or Chinese. Discuss changes to Front Matter or `_config.yml` before expanding either public contract. Provider adapters and internal modules are private implementation details.

## Local verification

Use a current patch release of Node.js 20, 22, or 24 and npm. The consumer runtime contract is Node.js `>=20` and Hexo `>=7 <9`.

```sh
npm ci
npm run check
npm run test:integration
npx playwright install chromium
npm run test:e2e
npm pack --dry-run
```

`check` runs formatting, linting, TypeScript checks, unit/documentation tests, and the build. `test:integration` installs the actual npm tarball into disposable sites: Hexo 7.1.1, 7.3.0, and 8.1.2; Landscape 1.1.0, NexT 8.29.0, and the committed minimal Cactus-style fixture; root and `/blog/` deployments. It needs registry access and deletes its temporary sites when finished or cancelled. Run `npm run build` before calling it independently. Keep pinned versions current through reviewed updates; the listed versions are the checked-in matrix, not a claim about the latest upstream release.

Required browser tests use a deterministic SDK double with external network access denied, exercising the real packed plugin. Desktop, mobile, keyboard, provider failure, and repeated-location behavior do not require credentials. Browser fixture setup still needs npm registry access. Do not add real keys to required PR jobs. Documentation example tests parse both READMEs' marked YAML blocks through the real public-contract validators; update those examples when changing the schema.

The optional real-provider smoke test requires `AMAP_SMOKE=1`, `HEXO_POST_MAP_AMAP_KEY`, and `HEXO_POST_MAP_AMAP_SECURITY_JS_CODE` in the environment:

```sh
AMAP_SMOKE=1 npm run test:amap-smoke
```

It skips without opt-in/credentials and records a warning rather than failing for SDK/network initialization failure. It verifies one map's initialization, not the whole provider contract, and is not a normal PR gate. Keep traces, screenshots, response dumps, and credential-bearing URLs out of this job's artifacts. Use a test key authorized for the local test origin and provision values securely outside the repository.

## Pull requests

- Include a minimal reproduction and explain user-visible behavior.
- Add meaningful tests for public-contract changes and regressions; include degradation and safe-diagnostic cases when relevant.
- Update both READMEs and the affected reference document.
- Test the packed artifact when changing build outputs or package metadata.
- Preserve theme-independent behavior and public fallbacks. Do not add an SDK-dependent required test.
- Run `git diff --check` and the checks relevant to the change before submission.
- Use Conventional Commit subjects, for example `fix: retain fallback when map loading fails`.

The npm allowlist contains only `dist`, the two READMEs, and `LICENSE` (npm also includes package metadata). Do not publish tests, fixture blogs, credentials, `.env` files, raw source maps, or local reports. Build before packing: the package does not rely on a consumer install script to create assets. README reference links point to the repository because reference documents are not shipped in the tarball.

## Release policy

Changes are reviewed and verified before landing on `main`. The intended automated release path is Release Please's version/changelog PR, then a GitHub Release and tag, followed by a tagged-source clean build, verification, and publication of the exact tested tarball. npm Trusted Publishing uses GitHub Actions OIDC and provenance rather than a persistent npm write token. Repository administrators must configure the npm trusted publisher, GitHub environment, and branch protections; committing workflow files alone does not enable those external settings.

First publication requires the maintainer to establish npm package ownership and complete the trusted-publisher setup. Do not run `npm publish` or create a release as part of an ordinary contribution. See the [maintainer release guide](docs/releases.md) and repository workflows for the operational steps, including the GitHub App token required for Release Please events to trigger CI and publication.

The initial release target is `0.1.0`; `0.x` validates the contracts against real sites. `1.0.0` declares Front Matter and site configuration stable, with subsequent breaking contract changes requiring a new major version. Until the first release is made, the changelog remains unreleased.
