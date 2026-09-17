# hexo-post-map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish a production-quality Hexo plugin that renders post-level AMap cards, schematic multi-point routes, and an automatically clustered overview map.

**Architecture:** Parse and validate provider-independent Front Matter during the Hexo build, inject server-rendered accessible fallbacks, generate a versioned overview data route, and hydrate only marked pages with framework-independent browser bundles. Keep AMap behind an internal adapter so the public Front Matter and site configuration contracts do not depend on its APIs.

**Tech Stack:** TypeScript 6, Hexo 7/8 APIs, Zod 4, parse5 8, esbuild 0.28, Vitest 3.2, Playwright 1.63, ESLint 10, Prettier 3, GitHub Actions, Release Please, npm Trusted Publishing.

**Spec:** `docs/superpowers/specs/2026-09-17-hexo-post-map-design.md`

## Global Constraints

- Runtime support is Node.js `>=20` and Hexo `>=7 <9`.
- Version 1 supports AMap JavaScript API 2.0 only and GCJ-02 coordinates only.
- The public compatibility surface consists of the Front Matter schema and `post_map` site configuration schema.
- Installing the package without `post_map.enabled: true` must be a no-op.
- Enabled invalid configuration or invalid post metadata must fail the build with a source path and field path, without logging credentials.
- Detail maps appear before content by default and must retain server-rendered fallbacks when JavaScript or AMap fails.
- Overview grouping is pixel-distance clustering only; do not introduce `place_id` or coordinate jitter.
- Do not modify theme files from plugin code or add a runtime dependency on Vue, React, or jQuery.
- Browser assets must load only on HTML containing a plugin marker.
- Use TDD for every behavior task and commit only the files named by that task.

## Planned File Structure

```text
hexo-post-map/
├── .github/
│   ├── ISSUE_TEMPLATE/
│   ├── workflows/ci.yml
│   ├── workflows/release-please.yml
│   └── workflows/publish.yml
├── docs/
│   ├── configuration.md
│   ├── front-matter.md
│   ├── security.md
│   └── superpowers/
├── fixtures/
│   ├── sites/base/
│   └── themes/cactus-minimal/
├── scripts/build.mjs
├── src/
│   ├── index.ts
│   ├── config/{defaults,resolve,types}.ts
│   ├── domain/{errors,normalize,schema,types}.ts
│   ├── presentation/{image,safe-html,serialize}.ts
│   ├── hexo/{generator,injector,post-filter,register,tag}.ts
│   ├── templates/{detail,overview,standalone}.ts
│   └── browser/
│       ├── shared/{config,dom,provider-loader}.ts
│       ├── providers/{amap,types}.ts
│       ├── detail/index.ts
│       ├── overview/{cluster-decision,index,panel}.ts
│       └── styles/index.css
├── test/
│   ├── browser/
│   ├── config/
│   ├── domain/
│   ├── hexo/
│   ├── integration/
│   └── presentation/
├── e2e/
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
├── README.md
├── README.zh-CN.md
├── SECURITY.md
├── eslint.config.mjs
├── package.json
├── playwright.config.ts
├── tsconfig.json
└── vitest.config.ts
```

---

### Task 1: Bootstrap a Reproducible Publishable Package

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `eslint.config.mjs`
- Create: `.prettierrc.json`
- Create: `.gitignore`
- Create: `vitest.config.ts`
- Create: `scripts/build.mjs`
- Create: `src/index.ts`
- Create: `src/hexo/register.ts`
- Create: `test/package-smoke.test.ts`
- Create: `LICENSE`

**Interfaces:**
- Produces: CommonJS entry `dist/index.cjs` and browser asset directory `dist/assets/`.
- Produces: `registerPlugin(hexo: Hexo): void`, used by every later Hexo integration task.
- Consumes: no earlier task.

- [ ] **Step 1: Add the package manifest and tool configuration**

Use these exact compatibility declarations and scripts in `package.json`:

```json
{
  "name": "hexo-post-map",
  "version": "0.0.0",
  "description": "Geotagged post maps and a clustered map index for Hexo",
  "license": "MIT",
  "main": "dist/index.cjs",
  "files": ["dist", "README.md", "README.zh-CN.md", "LICENSE"],
  "engines": { "node": ">=20" },
  "peerDependencies": { "hexo": ">=7 <9" },
  "scripts": {
    "build": "node scripts/build.mjs",
    "format:check": "prettier --check .",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "test:run": "vitest run",
    "test:e2e": "playwright test",
    "check": "npm run format:check && npm run lint && npm run typecheck && npm run test:run && npm run build"
  },
  "publishConfig": {
    "access": "public",
    "provenance": true
  }
}
```

Add exact development dependencies compatible with Node 20: TypeScript `^6.0.3`, Vitest `^3.2.7`, Playwright `^1.63.0`, ESLint `^10.10.0`, `typescript-eslint` `^8.70.0`, Prettier `^3.9.7`, esbuild `^0.28.2`, Zod `^4.6.5`, parse5 `^8.0.1`, `@amap/amap-jsapi-loader` `^1.0.1`, `@types/node` `^22.20.3`, Happy DOM `^20.14.5`, YAML `^2.9.1`, and Hexo `^8.1.2` for types and local tests. Keep Hexo in `peerDependencies` as well.

- [ ] **Step 2: Install dependencies and create the lockfile**

Run: `npm install`

Expected: `package-lock.json` is created without peer dependency errors.

- [ ] **Step 3: Write the package smoke test**

```ts
// test/package-smoke.test.ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('package contract', () => {
  it('declares the supported runtime and publish files', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'));
    expect(pkg.name).toBe('hexo-post-map');
    expect(pkg.engines.node).toBe('>=20');
    expect(pkg.peerDependencies.hexo).toBe('>=7 <9');
    expect(pkg.main).toBe('dist/index.cjs');
    expect(pkg.files).toEqual(['dist', 'README.md', 'README.zh-CN.md', 'LICENSE']);
  });
});
```

- [ ] **Step 4: Run the smoke test and verify the manifest contract passes**

Run: `npm run test:run -- test/package-smoke.test.ts`

Expected: PASS.

- [ ] **Step 5: Add the entry point and deterministic build script**

```ts
// src/index.ts
import type Hexo from 'hexo';
import { registerPlugin } from './hexo/register';

declare const hexo: Hexo;
registerPlugin(hexo);
```

```ts
// src/hexo/register.ts
import type Hexo from 'hexo';

export function registerPlugin(instance: Hexo): void {
  instance.log.debug('[hexo-post-map] loaded');
}
```

Configure `scripts/build.mjs` to remove only `dist/`, bundle `src/index.ts` to `dist/index.cjs` with `platform: 'node'`, `format: 'cjs'`, `target: 'node20'`, and `external: ['hexo']`, then bundle the two browser entries added later as IIFEs. Preserve legal comments at EOF and fail if a declared browser entry is missing after its task has introduced it.

- [ ] **Step 6: Run the complete bootstrap checks**

Run: `npm run test:run -- test/package-smoke.test.ts && npm run typecheck && npm run build && npm pack --dry-run`

Expected: all commands pass and the bootstrap tarball listing contains `package.json`, `dist/index.cjs`, and `LICENSE`. The manifest already reserves `README.md` and `README.zh-CN.md`; Task 10 creates and validates those documentation files before release packaging.

- [ ] **Step 7: Commit the bootstrap**

```bash
git add package.json package-lock.json tsconfig.json eslint.config.mjs .prettierrc.json .gitignore vitest.config.ts scripts/build.mjs src/index.ts src/hexo/register.ts test/package-smoke.test.ts LICENSE
git commit -m "chore: bootstrap hexo-post-map package"
```

---

### Task 2: Define and Validate the Front Matter Domain Model

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/domain/schema.ts`
- Create: `src/domain/errors.ts`
- Create: `src/domain/normalize.ts`
- Create: `test/domain/normalize.test.ts`
- Create: `test/domain/validation.test.ts`

**Interfaces:**
- Produces: `normalizePostMap(raw: unknown, sourcePath: string): NormalizedPostMap | null`.
- Produces: `PostMapValidationError` with `sourcePath`, `fieldPath`, `value`, and `reason`.
- Produces: `NormalizedPostMap`, `NormalizedPoint`, and `Coordinate` types.
- Consumes: Zod bundled into the server entry.

- [ ] **Step 1: Write failing normalization tests for all supported shapes**

```ts
// test/domain/normalize.test.ts
import { describe, expect, it } from 'vitest';
import { normalizePostMap } from '../../src/domain/normalize';

describe('normalizePostMap', () => {
  it('returns null when map is omitted', () => {
    expect(normalizePostMap(undefined, 'source/_posts/plain.md')).toBeNull();
  });

  it('uses the only point as representative', () => {
    const map = normalizePostMap(
      { points: [{ id: 'shanghai', name: '上海', longitude: 121.4737, latitude: 31.2304 }] },
      'source/_posts/shanghai.md',
    );
    expect(map?.representative.id).toBe('shanghai');
    expect(map?.route).toEqual([]);
  });

  it('resolves a multi-point representative and route in order', () => {
    const map = normalizePostMap(
      {
        representative: 'summit',
        points: [
          { id: 'visitor-center', name: '游客中心', longitude: 114.15, latitude: 27.46 },
          { id: 'summit', name: '金顶', longitude: 114.17, latitude: 27.45 },
        ],
        route: ['visitor-center', 'summit'],
      },
      'source/_posts/wugongshan.md',
    );
    expect(map?.representative.id).toBe('summit');
    expect(map?.route.map((point) => point.id)).toEqual(['visitor-center', 'summit']);
  });
});
```

- [ ] **Step 2: Run the domain tests and verify missing-module failures**

Run: `npm run test:run -- test/domain`

Expected: FAIL because `src/domain/normalize.ts` does not exist.

- [ ] **Step 3: Add explicit normalized types**

```ts
// src/domain/types.ts
export type Coordinate = readonly [longitude: number, latitude: number];

export interface NormalizedPoint {
  readonly id: string;
  readonly name: string;
  readonly coordinate: Coordinate;
}

export interface NormalizedPostMap {
  readonly points: readonly NormalizedPoint[];
  readonly representative: NormalizedPoint;
  readonly route: readonly NormalizedPoint[];
  readonly zoom?: number;
}
```

Implement the Zod input schema with the exact identifier pattern `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, finite coordinates, longitude and latitude bounds, non-empty trimmed names, unique point identifiers, a required representative for multiple points, existing representative references, and route references containing at least two existing points.

- [ ] **Step 4: Write failing diagnostic tests**

Test duplicate IDs, reversed/out-of-range coordinates, missing multi-point representative, an unknown representative, an unknown route ID, and a one-element route. Assert the formatted message contains the source path and exact field such as `map.route[1]`.

- [ ] **Step 5: Implement normalization and structured errors**

```ts
// src/domain/errors.ts
export class PostMapValidationError extends Error {
  constructor(
    readonly sourcePath: string,
    readonly fieldPath: string,
    readonly value: unknown,
    readonly reason: string,
  ) {
    super(`[hexo-post-map] ${sourcePath}: ${fieldPath}: ${reason}`);
    this.name = 'PostMapValidationError';
  }
}
```

Map Zod issues into `PostMapValidationError`, build an ID-to-point map once, resolve the representative, and resolve `route` to ordered point objects. Freeze returned arrays and objects so downstream rendering cannot mutate source content.

- [ ] **Step 6: Run tests and commit**

Run: `npm run test:run -- test/domain && npm run typecheck`

Expected: PASS.

```bash
git add src/domain test/domain
git commit -m "feat: validate post map metadata"
```

---

### Task 3: Resolve Site Configuration and Credential Modes

**Files:**
- Create: `src/config/types.ts`
- Create: `src/config/defaults.ts`
- Create: `src/config/resolve.ts`
- Create: `test/config/resolve.test.ts`

**Interfaces:**
- Produces: `resolveConfig(raw: unknown, env: NodeJS.ProcessEnv): ResolvedPluginConfig | null`.
- Produces: `ConfigValidationError` whose messages never contain secret values.
- Consumes: no Hexo global; registration passes `hexo.config.post_map` explicitly.

- [ ] **Step 1: Write failing configuration tests**

```ts
// test/config/resolve.test.ts
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../../src/config/resolve';

describe('resolveConfig', () => {
  it('is a no-op without explicit enablement', () => {
    expect(resolveConfig(undefined, {})).toBeNull();
    expect(resolveConfig({ enabled: false }, {})).toBeNull();
  });

  it('applies public defaults and environment overrides', () => {
    const config = resolveConfig(
      { enabled: true, amap: { key: 'file-key', security: { security_js_code: 'file-code' } } },
      { HEXO_POST_MAP_AMAP_KEY: 'env-key', HEXO_POST_MAP_AMAP_SERVICE_HOST: 'https://maps.example.test/' },
    );
    expect(config?.post).toMatchObject({ position: 'before', height: '220px', defaultZoom: 11 });
    expect(config?.overview).toMatchObject({ path: 'map/', layout: 'page' });
    expect(config?.amap).toMatchObject({ key: 'env-key', serviceHost: 'https://maps.example.test/' });
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm run test:run -- test/config`

Expected: FAIL because the resolver is missing.

- [ ] **Step 3: Implement the resolved configuration type and defaults**

```ts
// src/config/types.ts
export interface ResolvedPluginConfig {
  readonly provider: 'amap';
  readonly post: { readonly enabled: boolean; readonly position: 'before' | 'after' | 'manual'; readonly height: string; readonly defaultZoom: number };
  readonly overview: { readonly enabled: boolean; readonly path: string; readonly title: string; readonly layout: 'page' | 'standalone' };
  readonly cluster: { readonly gridSize: number; readonly maxZoom: number };
  readonly amap: { readonly key: string; readonly serviceHost?: string; readonly securityJsCode?: string };
}
```

Validate CSS height syntax, overview path traversal, cluster bounds, zoom bounds, provider equality, HTTPS `service_host`, and exactly one security mode. Read environment values first, then file values, then defaults. Never interpolate environment syntax inside YAML strings.

- [ ] **Step 4: Add failure tests for missing key, zero/two security modes, unsafe path, and secret redaction**

Assert error text contains field names but does not contain configured key or security-code values.

- [ ] **Step 5: Run tests and commit**

Run: `npm run test:run -- test/config && npm run typecheck`

Expected: PASS.

```bash
git add src/config test/config
git commit -m "feat: resolve plugin configuration"
```

---

### Task 4: Build Safe Presentation Primitives

**Files:**
- Create: `src/presentation/safe-html.ts`
- Create: `src/presentation/serialize.ts`
- Create: `src/presentation/image.ts`
- Create: `test/presentation/safe-html.test.ts`
- Create: `test/presentation/serialize.test.ts`
- Create: `test/presentation/image.test.ts`

**Interfaces:**
- Produces: `escapeHtml(value: string): string`.
- Produces: `safeUrl(value: string, kind: 'post' | 'image'): string | null`.
- Produces: `serializeForHtmlScript(value: unknown): string`.
- Produces: `resolveRepresentativeImage(post: PostPresentationInput): string`.

- [ ] **Step 1: Write failing security tests**

```ts
import { expect, it } from 'vitest';
import { escapeHtml, safeUrl } from '../../src/presentation/safe-html';
import { serializeForHtmlScript } from '../../src/presentation/serialize';

it('escapes post-derived markup and rejects executable URLs', () => {
  expect(escapeHtml('<img onerror="alert(1)">')).toBe('&lt;img onerror=&quot;alert(1)&quot;&gt;');
  expect(safeUrl('javascript:alert(1)', 'image')).toBeNull();
  expect(safeUrl('/archives/safe/', 'post')).toBe('/archives/safe/');
});

it('cannot terminate an application/json script', () => {
  expect(serializeForHtmlScript({ name: '</script><script>alert(1)</script>' })).not.toContain('</script>');
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm run test:run -- test/presentation`

Expected: FAIL because presentation modules are absent.

- [ ] **Step 3: Implement escaping, URL allowlists, and JSON serialization**

Escape `&`, `<`, `>`, `"`, and `'`. Allow site-relative post/image URLs plus `http:` and `https:` URLs. Reject protocol-relative URLs and control characters. Serialize JSON and replace `<`, `>`, `&`, U+2028, and U+2029 with Unicode escape sequences.

- [ ] **Step 4: Implement representative image resolution with parse5**

`resolveRepresentativeImage` must use a safe Front Matter `thumbnail`, otherwise parse rendered HTML and return the first safe `<img src>`, otherwise return `/hexo-post-map/assets/placeholder.svg`. Do not use a regular expression to parse HTML.

- [ ] **Step 5: Run tests and commit**

Run: `npm run test:run -- test/presentation && npm run typecheck`

Expected: PASS.

```bash
git add src/presentation test/presentation
git commit -m "feat: add safe map presentation helpers"
```

---

### Task 5: Integrate Post Filters, Manual Tags, and Selective Assets

**Files:**
- Create: `src/templates/detail.ts`
- Create: `src/hexo/post-filter.ts`
- Create: `src/hexo/tag.ts`
- Create: `src/hexo/injector.ts`
- Modify: `src/hexo/register.ts`
- Create: `test/hexo/post-filter.test.ts`
- Create: `test/hexo/tag.test.ts`
- Create: `test/hexo/injector.test.ts`

**Interfaces:**
- Produces: `renderDetailMap(model: DetailTemplateModel): string` with `data-hpm-detail` and an accessible fallback.
- Produces: `createPostFilter(config): (post: HexoPostLike) => HexoPostLike`.
- Produces: `injectMarkedAssets(html: string, root: string): string`.
- Consumes: `normalizePostMap`, safe presentation helpers, and resolved configuration.

- [ ] **Step 1: Write failing post-filter tests**

Cover these exact cases: no plugin config leaves content byte-for-byte unchanged; a map post is prepended in `before` mode; appended in `after` mode; a `{% post_map %}` sentinel overrides automatic placement; `manual` without a sentinel leaves content unchanged but does not remove map metadata used by the overview.

```ts
it('prepends one detail component before rendered content', () => {
  const result = filter({ source: 'source/_posts/a.md', content: '<p>Body</p>', map: onePoint });
  expect(result.content).toMatch(/^<section class="hpm-detail" data-hpm-detail>/);
  expect(result.content.endsWith('<p>Body</p>')).toBe(true);
  expect(result.content.match(/data-hpm-detail/g)).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm run test:run -- test/hexo/post-filter.test.ts test/hexo/tag.test.ts test/hexo/injector.test.ts`

Expected: FAIL because the integration modules are absent.

- [ ] **Step 3: Render the detail component and fallback**

The template must contain:

```html
<section class="hpm-detail" data-hpm-detail aria-label="文章地点地图">
  <div class="hpm-detail__canvas" data-hpm-canvas></div>
  <script type="application/json" data-hpm-data>{safe JSON}</script>
  <ol class="hpm-place-list" data-hpm-fallback>{escaped place links}</ol>
  <div class="hpm-detail__status" data-hpm-status aria-live="polite"></div>
</section>
```

Keep a visible place list until the map reports successful initialization; do not make fallback content exist only inside `<noscript>`.

- [ ] **Step 4: Implement tag and filter registration**

Register `{% post_map %}` as a sentinel-producing tag. Register `after_post_render` to normalize map data, replace at most one sentinel, and otherwise apply the configured position. Throw a structured error for multiple sentinels.

- [ ] **Step 5: Implement marker-aware asset injection**

Use `after_render:html`, not Hexo's page-type Injector API: inject `style.css` plus `post-map.js` only when HTML contains `data-hpm-detail`, and inject `style.css` plus `overview-map.js` only when it contains `data-hpm-overview`. Preserve query/hash-free root-aware URLs and never inject duplicates.

- [ ] **Step 6: Run focused tests and commit**

Run: `npm run test:run -- test/hexo && npm run typecheck`

Expected: PASS.

```bash
git add src/templates/detail.ts src/hexo src/index.ts test/hexo
git commit -m "feat: integrate post map rendering"
```

---

### Task 6: Generate the Overview Page, Data Route, and Assets

**Files:**
- Create: `src/templates/overview.ts`
- Create: `src/templates/standalone.ts`
- Create: `src/hexo/generator.ts`
- Modify: `src/hexo/register.ts`
- Create: `src/browser/styles/placeholder.svg`
- Create: `test/hexo/generator.test.ts`

**Interfaces:**
- Produces: `createOverviewRoutes(locals, config, hexo): HexoRoute[]`.
- Produces: versioned `{ version: 1, posts: OverviewPost[] }` JSON.
- Produces routes below `hexo-post-map/assets/` for bundled JS, CSS, and the placeholder.
- Consumes: normalized map metadata and representative image resolution.

- [ ] **Step 1: Write failing generator tests**

Assert that the generator:

- excludes posts without `map`;
- uses only `representative` coordinates;
- sorts fallback rows by date descending;
- honors `config.root` and subdirectory permalinks;
- emits `map/index.html`, `map/posts.json`, and namespaced asset routes;
- emits an empty-state page for zero geotagged posts;
- chooses the theme `page` layout when available and standalone HTML when it is absent or explicitly configured.

- [ ] **Step 2: Run the generator test and verify it fails**

Run: `npm run test:run -- test/hexo/generator.test.ts`

Expected: FAIL because `createOverviewRoutes` is missing.

- [ ] **Step 3: Implement the versioned overview projection**

```ts
export interface OverviewPost {
  readonly title: string;
  readonly url: string;
  readonly date: string;
  readonly image: string;
  readonly location: {
    readonly name: string;
    readonly longitude: number;
    readonly latitude: number;
  };
}
```

Project only these fields, normalize dates to ISO 8601, pass internal post links through Hexo's URL helper, and never include post bodies or all detail points in `posts.json`.

- [ ] **Step 4: Implement themed and standalone overview routes**

The themed route supplies `layout: ['page']`, `type: 'post-map-overview'`, and rendered content containing `data-hpm-overview`. Detect `hexo.theme.getView('page')`; if absent, emit the complete standalone HTML document as route data without a layout.

- [ ] **Step 5: Add bundled asset routes and registration**

Return read streams or buffers from `dist/assets/` under `hexo-post-map/assets/`. Register the generator only when the resolved plugin configuration is enabled.

- [ ] **Step 6: Run tests and commit**

Run: `npm run test:run -- test/hexo/generator.test.ts && npm run typecheck`

Expected: PASS.

```bash
git add src/templates/overview.ts src/templates/standalone.ts src/hexo src/browser/styles/placeholder.svg test/hexo/generator.test.ts
git commit -m "feat: generate clustered map index routes"
```

---

### Task 7: Implement the Browser Provider Loader and Detail Map

**Files:**
- Create: `src/browser/providers/types.ts`
- Create: `src/browser/providers/amap.ts`
- Create: `src/browser/shared/config.ts`
- Create: `src/browser/shared/dom.ts`
- Create: `src/browser/shared/provider-loader.ts`
- Create: `src/browser/detail/index.ts`
- Create: `src/browser/styles/index.css`
- Modify: `scripts/build.mjs`
- Create: `test/browser/provider-loader.test.ts`
- Create: `test/browser/detail.test.ts`

**Interfaces:**
- Produces: `loadProvider(config: BrowserProviderConfig): Promise<MapProvider>` with one cached promise per page.
- Produces: `MapProvider.mountDetail(container, model): Promise<MapHandle>`.
- Consumes: normalized JSON emitted by `renderDetailMap`.

- [ ] **Step 1: Write failing provider-loader tests**

```ts
it('deduplicates concurrent provider loads', async () => {
  const factory = vi.fn(async () => fakeProvider);
  const load = createProviderLoader(factory);
  const [a, b] = await Promise.all([load(browserConfig), load(browserConfig)]);
  expect(a).toBe(fakeProvider);
  expect(b).toBe(fakeProvider);
  expect(factory).toHaveBeenCalledTimes(1);
});
```

Add detail controller tests for IntersectionObserver-triggered loading, one-point zoom, multi-point fitting, route order, status messages, fallback retention on failure, and activation before wheel/touch interaction.

- [ ] **Step 2: Run browser unit tests and verify they fail**

Run: `npm run test:run -- test/browser/provider-loader.test.ts test/browser/detail.test.ts`

Expected: FAIL because browser modules are absent.

- [ ] **Step 3: Define the internal provider interface**

```ts
export interface MapHandle { destroy(): void }

export interface MapProvider {
  mountDetail(container: HTMLElement, model: DetailMapModel): Promise<MapHandle>;
  mountOverview(container: HTMLElement, options: OverviewMapOptions): Promise<MapHandle>;
}
```

Keep all `AMap.*` types inside `providers/amap.ts`; browser controllers depend only on this interface.

- [ ] **Step 4: Implement AMap loading and detail rendering**

Use `@amap/amap-jsapi-loader` with version `2.0`. Set `window._AMapSecurityConfig` to either `serviceHost` or `securityJsCode` before loading. Render markers, sequential labels, `AMap.Polyline`, automatic fit for multiple points, and configured/default zoom for one point. Destroy map instances during page teardown.

- [ ] **Step 5: Implement lazy hydration and responsive CSS**

Use IntersectionObserver with a 300px root margin. Keep fallback visible until successful `complete`; on error write a localized status while preserving links. Use prefixed classes, CSS custom properties, 220px desktop height, 180px mobile height, reduced-motion rules, and an explicit activation overlay.

- [ ] **Step 6: Build both browser bundles and run tests**

Configure esbuild entries to emit `dist/assets/post-map.js`, `dist/assets/overview-map.js`, and `dist/assets/style.css` as minified production assets with sourcemaps excluded from the published package.

Run: `npm run test:run -- test/browser && npm run build`

Expected: PASS and all three assets exist.

- [ ] **Step 7: Commit**

```bash
git add src/browser scripts/build.mjs test/browser
git commit -m "feat: render lazy post maps with AMap"
```

---

### Task 8: Implement Automatic Overview Clustering and Article Panels

**Files:**
- Create: `src/browser/overview/cluster-decision.ts`
- Create: `src/browser/overview/panel.ts`
- Create: `src/browser/overview/index.ts`
- Modify: `src/browser/providers/types.ts`
- Modify: `src/browser/providers/amap.ts`
- Modify: `src/browser/styles/index.css`
- Create: `test/browser/cluster-decision.test.ts`
- Create: `test/browser/overview.test.ts`

**Interfaces:**
- Produces: `decideClusterAction(input): { type: 'zoom'; bounds: Bounds } | { type: 'list'; posts: OverviewPost[] }`.
- Produces: `renderPostPanel(posts, viewport): PanelHandle`.
- Extends: `OverviewMapOptions` with callbacks for a single post and terminal overlapping group.

- [ ] **Step 1: Write failing pure cluster-decision tests**

```ts
it('opens a list at maximum zoom instead of zooming forever', () => {
  expect(decideClusterAction({ zoom: 18, maxZoom: 18, posts: [a, b], bounds })).toEqual({
    type: 'list',
    posts: [a, b],
  });
});

it('zooms a separable cluster below maximum zoom', () => {
  expect(decideClusterAction({ zoom: 6, maxZoom: 18, posts: [a, b], bounds }).type).toBe('zoom');
});
```

Also test identical coordinates below max zoom: if bounds have zero area, return `list` immediately because another zoom cannot separate them.

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm run test:run -- test/browser/cluster-decision.test.ts test/browser/overview.test.ts`

Expected: FAIL because overview modules are absent.

- [ ] **Step 3: Implement AMap MarkerCluster integration**

Pass `gridSize` and `maxZoom` from browser configuration. Render normal clusters as count badges and single leaves as fixed-size image buttons. On cluster selection, use the pure decision function; fit bounds for `zoom`, and call the terminal-group callback for `list`. Never mutate source coordinates.

- [ ] **Step 4: Implement preview cards and responsive multi-post panels**

Single markers open a card with escaped title, date, location, image, and post link. Multiple posts sort by date descending. Use a right-side panel at desktop breakpoints and a focus-managed bottom drawer on mobile. Restore focus to the originating marker when closing.

- [ ] **Step 5: Implement overview loading and fallback behavior**

Fetch the root-aware `posts.json`, validate `version === 1`, preserve the server-rendered chronological list until map initialization succeeds, and restore it on fetch/provider failure. Empty data renders the configured empty-state message without loading AMap.

- [ ] **Step 6: Run focused tests and commit**

Run: `npm run test:run -- test/browser && npm run build`

Expected: PASS.

```bash
git add src/browser test/browser
git commit -m "feat: add automatic post map clustering"
```

---

### Task 9: Verify Packed-Artifact, Hexo-Version, Theme, and Browser Compatibility

**Files:**
- Create: `fixtures/sites/base/_config.yml`
- Create: `fixtures/sites/base/source/_posts/{plain,single,multi,route,overlap}.md`
- Create: `fixtures/themes/cactus-minimal/layout/{layout,post,page}.ejs`
- Create: `fixtures/themes/cactus-minimal/LICENSE`
- Create: `test/integration/pack-and-build.mjs`
- Create: `test/integration/generated-output.test.ts`
- Create: `playwright.config.ts`
- Create: `e2e/detail-map.spec.ts`
- Create: `e2e/overview-map.spec.ts`
- Create: `e2e/amap-smoke.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run test:integration` and `npm run test:e2e` release gates.
- Consumes: the actual `npm pack` tarball and all generated routes/assets.

- [ ] **Step 1: Add fixture posts covering the full contract**

Use deterministic `example.test` images and GCJ-02 points. Include two posts with identical representative coordinates, a route with three points, a multi-point post without a route, an unmapped post, and a malicious-title fixture used only for escaping assertions.

- [ ] **Step 2: Write the failing packed-artifact integration runner**

The runner must:

1. execute `npm pack --json`;
2. create a temporary directory with `mkdtemp`;
3. copy the fixture site;
4. install the produced tarball plus a selected Hexo/theme version;
5. run `hexo generate` with dummy build-time AMap values;
6. assert exit status and return the public directory path;
7. delete only the validated temporary directory in a `finally` block.

- [ ] **Step 3: Add generated-output assertions**

Assert mapped posts contain one detail marker and root-aware assets, ordinary posts contain neither, overview JSON contains only projection fields, the fallback list is date-sorted, subdirectory roots are preserved, and unsafe strings/URLs do not appear unescaped.

- [ ] **Step 4: Add theme fixtures and the compatibility matrix**

Run Landscape `1.1.0`, NexT `8.29.0`, and the committed minimal Cactus fixture derived under its MIT license. Test Hexo `7.1.1`, `7.3.0`, and `8.1.2`. Keep version selection in the runner arguments so GitHub Actions can matrix it without editing files.

- [ ] **Step 5: Add Playwright tests with a deterministic fake provider**

Verify detail lazy loading, activation, route order, failure fallback, overview cluster zoom, identical-coordinate terminal list, image navigation, keyboard close/focus restoration, desktop side panel, and mobile bottom drawer. Block all requests to real AMap origins in required E2E tests.

Add a separate `amap-smoke.spec.ts` that runs only when `AMAP_SMOKE=1` and both AMap credential environment variables are present. It verifies one live map initialization but is excluded from required pull-request checks and reports failure without blocking normal CI.

- [ ] **Step 6: Run integration and browser suites**

Run: `npm run build && npm run test:integration`

Run: `npx playwright install chromium && npm run test:e2e`

Expected: PASS across fixture themes with no real AMap request.

- [ ] **Step 7: Commit**

```bash
git add fixtures test/integration e2e playwright.config.ts package.json package-lock.json
git commit -m "test: verify packaged plugin compatibility"
```

---

### Task 10: Document the Public Contract and Repository Policy

**Files:**
- Create: `README.md`
- Create: `README.zh-CN.md`
- Create: `docs/configuration.md`
- Create: `docs/front-matter.md`
- Create: `docs/security.md`
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `CHANGELOG.md`
- Create: `.github/ISSUE_TEMPLATE/bug.yml`
- Create: `.github/ISSUE_TEMPLATE/feature.yml`
- Create: `.github/pull_request_template.md`
- Modify: `package.json`
- Create: `test/docs/examples.test.ts`

**Interfaces:**
- Produces: tested installation, configuration, authoring, CSP, privacy, troubleshooting, and contribution documentation.
- Consumes: the final public config and Front Matter schemas from Tasks 2 and 3.

- [ ] **Step 1: Write a documentation example test before the docs**

Extract fenced YAML examples marked `yaml test=post-map` from both READMEs, parse them, and pass their `map` values to `normalizePostMap`. Extract the full `post_map` example and pass it to `resolveConfig` with documented environment variables.

- [ ] **Step 2: Run the docs test and verify it fails because the READMEs are absent**

Run: `npm run test:run -- test/docs/examples.test.ts`

Expected: FAIL with missing README files.

- [ ] **Step 3: Write English and Chinese usage documentation**

Document installation, opt-in activation, all four post shapes, `before`/`after`/`manual`, representative-image precedence, automatic clustering, maximum-zoom lists, theme navigation setup, subdirectory sites, client and proxy security modes, environment precedence, and exact error examples. State clearly that coordinates and client credentials are public in a static site.

- [ ] **Step 4: Add security, CSP, support, and contribution policies**

List required AMap origins from current official AMap documentation, describe responsible disclosure, define supported versions, include local commands, require tests for contract changes, and explain the release process. Do not put a real key or security code in any example.

- [ ] **Step 5: Complete npm metadata and validate documentation examples**

Set `repository`, `bugs`, `homepage`, `keywords`, `author`, and package export metadata to `xizidev/hexo-post-map`. Run `npm run test:run -- test/docs && npm pack --dry-run` and verify no fixtures, test files, environment files, or source maps are published.

- [ ] **Step 6: Commit**

```bash
git add README.md README.zh-CN.md docs/configuration.md docs/front-matter.md docs/security.md CONTRIBUTING.md SECURITY.md CHANGELOG.md .github package.json package-lock.json test/docs
git commit -m "docs: document public plugin contract"
```

---

### Task 11: Add CI, Release Automation, and npm Publication Gates

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release-please.yml`
- Create: `.github/workflows/publish.yml`
- Create: `.github/dependabot.yml`
- Create: `release-please-config.json`
- Create: `.release-please-manifest.json`
- Create: `test/package-contents.test.ts`
- Create: `test/workflows/workflows.test.ts`

**Interfaces:**
- Produces: required CI, version PRs, GitHub Releases, and OIDC npm publication.
- Consumes: `npm run check`, `npm run test:integration`, `npm run test:e2e`, and the packed-artifact tests.

- [ ] **Step 1: Write a failing package-content allowlist test**

Run `npm pack --json --dry-run`, flatten the returned file list, and assert every entry starts with `dist/` or equals one of `README.md`, `README.zh-CN.md`, `LICENSE`, or `package.json`.

- [ ] **Step 2: Add required CI jobs**

Create separate jobs for static checks/unit tests, the Node 20/22/24 and Hexo 7.1.1/7.3.0/8.1.2 integration matrix, and Playwright Chromium. Cache npm downloads in CI jobs, but do not cache dependencies or publish builds. Upload Playwright traces only on failure.

- [ ] **Step 3: Add Release Please automation**

Configure a Node release with initial version `0.1.0`, package name `hexo-post-map`, changelog generation, and conventional commit parsing. The workflow may write release PRs and tags but may not publish npm artifacts.

- [ ] **Step 4: Add the trusted-publish workflow**

Trigger only on a published GitHub Release. Use a GitHub-hosted Ubuntu runner, Node 24, current npm, `contents: read`, and `id-token: write`. Perform `npm ci`, all release checks, `npm pack --json`, install/test that exact tarball, then run `npm publish <exact-tarball-path>` so the verified bytes are the published bytes. Do not reference `NPM_TOKEN`.

- [ ] **Step 5: Add dependency updates and executable workflow contract tests**

Configure weekly grouped npm and GitHub Actions updates. Parse all workflow files with the YAML package and assert that CI contains the declared Node/Hexo matrix, the publish workflow triggers only from a published release, grants `id-token: write` and `contents: read`, uses a GitHub-hosted runner, contains no `NPM_TOKEN`, and runs the complete release checks before `npm publish`.

Run: `npm run test:run -- test/package-contents.test.ts test/workflows/workflows.test.ts`

Run: `npm run check && npm run test:integration && npm run test:e2e && npm pack --dry-run`

Expected: all commands pass.

- [ ] **Step 6: Commit**

```bash
git add .github release-please-config.json .release-please-manifest.json test/package-contents.test.ts test/workflows/workflows.test.ts
git commit -m "ci: add release and trusted publishing gates"
```

---

### Task 12: Dogfood the Packed Plugin in the Existing Cactus Blog

**Files:**
- Create: `test/integration/real-blog-smoke.mjs`

**Interfaces:**
- Produces: verified installation and rendering from a temporary copy of the user's actual Cactus site.
- Consumes: the packed tarball from the plugin repository; does not consume plugin source through a symlink.

- [ ] **Step 1: Capture both repositories' baselines**

Run in each repository: `pwd`, `git status --short`, `git branch --show-current`, and `git rev-parse HEAD`. Stop if unrelated changes overlap any listed path.

- [ ] **Step 2: Write the real-blog smoke runner around a temporary copy**

The runner must execute `npm pack --json`, create a validated temporary directory with `mkdtemp`, copy `/Users/hif/blog/blog_source` without `.git`, `public`, `node_modules`, or caches, and install the absolute tarball path with `npm install --no-save`. It must never edit the real blog checkout and must delete only its own validated temporary directory in a `finally` block.

- [ ] **Step 3: Patch opt-in configuration only inside the temporary copy**

Have the runner parse and update the copied `_config.yml` with `post_map.enabled: true`, AMap provider selection, detail defaults, overview path `map/`, and client security mode. Add `map: /map/` to the copied Cactus navigation. Do not serialize smoke credentials into YAML.

- [ ] **Step 4: Patch one representative article only inside the temporary copy**

Have the runner parse the copied `魔都.md` Front Matter and add the accepted Shanghai representative point:

```yaml
thumbnail: https://oss.qiuchang.cc/img_p/shanghai/DSCF9176.JPG
map:
  points:
    - id: shanghai
      name: 上海
      longitude: 121.4737
      latitude: 31.2304
```

- [ ] **Step 5: Build the temporary blog with non-secret smoke credentials and inspect output**

Run:

```bash
HEXO_POST_MAP_AMAP_KEY=build-smoke-key HEXO_POST_MAP_AMAP_SECURITY_JS_CODE=build-smoke-code npm run clean
HEXO_POST_MAP_AMAP_KEY=build-smoke-key HEXO_POST_MAP_AMAP_SECURITY_JS_CODE=build-smoke-code npm run build
```

Assert the Shanghai article contains `data-hpm-detail`, `/map/index.html` and `/map/posts.json` exist, ordinary articles do not load plugin browser assets, generated links use `https://lifeifan.com` paths correctly, and no smoke credential appears in either real repository.

- [ ] **Step 6: Run a local browser smoke test**

Serve the generated blog, intercept AMap with the deterministic fake provider, and verify the detail card, overview marker, image, and article navigation. Then run `git diff --check` in both repositories.

- [ ] **Step 7: Commit the reproducible smoke runner**

```bash
git add test/integration/real-blog-smoke.mjs
git commit -m "test: add real blog smoke coverage"
```

Do not modify, commit, or push the real blog repository in this task. Permanent installation follows only after a published plugin version exists and the user explicitly authorizes the cross-repository change.

---

### Task 13: Final Verification and Prerelease Readiness Review

**Files:**
- Modify only files required to correct failures found by this task.

**Interfaces:**
- Produces: evidence that the repository satisfies every acceptance criterion in the design specification.
- Consumes: all prior tasks.

- [ ] **Step 1: Run the complete clean verification**

Run:

```bash
npm ci
npm run check
npm run test:integration
npm run test:e2e
npm pack --dry-run
git diff --check
git status --short
```

Expected: all commands pass; status contains only intentional final-review changes, or is clean.

- [ ] **Step 2: Audit the packed artifact and public API**

Install the produced tarball into a fresh temporary Hexo 7.1.1 site and a fresh Hexo 8.1.2 site. Confirm installation without configuration is a no-op, enabled valid configuration generates all routes, and enabled invalid configuration fails with redacted diagnostics.

- [ ] **Step 3: Audit security and degradation boundaries**

Re-run malicious content cases, block AMap and overview JSON requests, disable JavaScript, emulate reduced motion, navigate only with the keyboard, and verify content, location lists, and article links remain usable.

- [ ] **Step 4: Compare implementation against every design acceptance criterion**

Create a temporary checklist from Section 18 of the design document, record the command or test that proves each criterion, and correct any uncovered gap before proceeding. Do not commit the temporary checklist.

- [ ] **Step 5: Commit final corrections if any**

Stage only correction paths, rerun the affected focused tests and the complete clean verification, then commit with a message describing the actual correction. If no correction is required, do not create an empty commit.

- [ ] **Step 6: Stop before external publication**

Report the verified commit IDs, packed tarball name, test results, npm name availability recheck, and the manual npm Trusted Publisher setup still required. Do not push, create a GitHub Release, or publish to npm without explicit user authorization.
