# Packed compatibility gates

Run `npm run build && npm run test:integration` for all 18 cells:
Hexo 7.1.1 / 7.3.0 (latest 7 verified 2026-09-17) / 8.1.2,
Landscape 1.1.0 / NexT 8.29.0 / committed Cactus-minimal, and `/` / `/blog/`.

Select cells without editing files:

```sh
npm run test:integration -- --hexo=7.1.1 --theme=next --root=/blog/
```

Each invocation packs once, creates a fresh temporary directory, installs the tarball
with npm lifecycle scripts disabled, and removes only that directory in `finally`.
The site has a deliberately failing postinstall sentinel. The lockfile must show a
tarball dependency, never a source link. Every cell checks no-op, invalid post and
configuration failures, safe diagnostics, and enabled generated output. Fixture
coordinates are GCJ-02. The untrusted overlap title is only for escaping checks.
No theme source is edited. Run these same commands under Node 20, 22 and 24 in CI.

`npx playwright install chromium --no-shell && npm run test:e2e` builds and serves a separate
packed Hexo 8.1.2 / Cactus-minimal / `/blog/` fixture. Required browser tests deny
all external requests; the AMap SDK script is fulfilled locally with a deterministic
double. Published browser bundles and the real AMap adapter remain unchanged.
The `chromium` channel uses the same bundled browser in headed and new headless modes;
the separate legacy headless shell is unnecessary. The fake SDK supplies vendor geometry/events; assertions cover the plugin's DOM,
route coordinates, activation, fallback, cluster decisions, navigation and focus.

`npm run test:amap-smoke` is a separate optional project, skipped unless `AMAP_SMOKE=1`,
`HEXO_POST_MAP_AMAP_KEY` and `HEXO_POST_MAP_AMAP_SECURITY_JS_CODE` are all set.
Provider initialization failure is a non-blocking generic warning; no traces or
credential-bearing network diagnostics are saved. Do not add this project to required CI.
