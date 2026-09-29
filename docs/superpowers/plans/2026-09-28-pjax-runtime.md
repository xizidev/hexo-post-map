# PJAX-Compatible Browser Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `hexo-post-map` v0.4 browser compatibility so conventional PJAX navigation can move from an ordinary page to detail and overview maps without a full reload or eager map dependencies.

**Architecture:** Every enabled HTML document receives a provider-free `runtime.js`; documents that already contain a map also retain a static `style.css` link for the no-JavaScript fallback. The singleton runtime observes light-DOM replacements, loads the relevant feature IIFE once, owns controller reconciliation and page lifecycle, and exposes the versioned `window.HexoPostMap` API. Existing detail/overview controllers keep provider and UI ownership but implement structural currentness and register through a small bridge.

**Tech Stack:** TypeScript 6, esbuild IIFEs, Vitest 3 with Happy DOM, Playwright Chromium, Hexo 7/8 packed-artifact fixtures, AMap JS API 2.0 adapter.

**Spec:** `docs/superpowers/specs/2026-09-24-pjax-runtime-design.md`

## Global Constraints

- Work only in `/Users/hif/blog/blog_source/.codex-worktrees/hexo-post-map-v04` on `codex/pjax-runtime`, based on v0.3.0 commit `e8d46c5ea3fe936cb4104c0a5563d456af4b975a`.
- Preserve Node.js `>=20` and Hexo `>=7 <9`; add no runtime dependency and no new site configuration.
- Preserve the Front Matter schema, version-1 `posts.json`, GCJ-02 coordinates, AMap-only provider support, existing UI, existing routes, and existing asset filenames.
- Add only `hexo-post-map/assets/runtime.js`; its minified size must be at most 8,192 bytes and its esbuild input graph must contain no provider, detail, overview, marker, panel, or post-data module.
- When the plugin is enabled, every rendered HTML document receives one deferred `runtime.js`. Ordinary pages receive no map stylesheet, feature bundle, overview JSON request, or AMap request.
- Initially mapped documents receive one static `style.css` link and no static feature script. PJAX-inserted roots cause the runtime to load the same stylesheet when it is absent.
- Keep the server-rendered detail links and overview list readable and styled without JavaScript, and keep all current accessibility, cancellation, credential-redaction, and provider-ownership guarantees.
- Do not add filters, taxonomy/search controls, URL state, GeoJSON/GPX, route playback, a second provider, history monkey-patches, or theme-specific router hooks.
- Local preview and browser verification must bind to `127.0.0.1`, never `localhost`.
- Leave `package.json` at the feature-branch version; Release Please owns the release version change.

## Review Focus

- **Task 1:** A static stylesheet or script already exists and may have finished before runtime startup; adopt it without adding a duplicate or waiting forever.
- **Task 1:** A shared stylesheet fails while one feature script succeeds; an explicit scoped refresh retries one stylesheet request and reuses the successful script without disturbing the other feature.
- **Task 2:** A PJAX mutation removes and reinserts the same root in one burst; final connected state must preserve the controller, while replacing its canvas or data node remounts exactly once.
- **Task 2:** Another script owns a non-configurable `window.HexoPostMap`; automatic maps must still work, the property must remain untouched, and only one redacted warning may be emitted.
- **Task 5:** An overview JSON response resolves after PJAX has removed its root; no late controller, panel, marker, or map may appear in the replacement page.

---

## File Map

| File                                                            | Responsibility                                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/browser/runtime/types.ts`                                  | Stable feature, controller, hydrator, public API, runtime, and resource-loader contracts.                                            |
| `src/browser/runtime/resources.ts`                              | Canonical local asset URLs, shared stylesheet state, per-feature IIFE state, deduplication, failure suppression, and explicit retry. |
| `src/browser/runtime/bridge.ts`                                 | Symbol-based lookup used by independently bundled feature IIFEs to register hydrators without importing runtime implementation.      |
| `src/browser/runtime/runtime.ts`                                | Singleton installation, public API, observer reconciliation, controller registry, failure isolation, and page lifecycle.             |
| `src/browser/runtime/index.ts`                                  | Tiny side-effect entry that bootstraps from `document.currentScript`.                                                                |
| `src/browser/detail/index.ts` / `src/browser/overview/index.ts` | Existing controllers plus `isCurrent()` and runtime hydrator registration.                                                           |
| `src/hexo/injector.ts` / `src/hexo/generator.ts`                | Site-wide runtime injection, map-only static CSS injection, and the fifth published asset route.                                     |
| `e2e/pjax-runtime.spec.ts`                                      | Ordinary-to-map PJAX sequence, request deduplication, teardown, late-result safety, and manual refresh.                              |
| `docs/compatibility.md`                                         | Public automatic/manual lifecycle contract and limitations.                                                                          |

### Task 1: Lazy local resource loader

**Files:**

- Create: `src/browser/runtime/types.ts`
- Create: `src/browser/runtime/resources.ts`
- Create: `test/browser/runtime-resources.test.ts`

**Interfaces:**

- Consumes: DOM `Document`, a canonical asset-base `URL`, and `hasHydrator(feature: FeatureId): boolean`.
- Produces:
  - `type FeatureId = 'detail' | 'overview'`
  - `interface RuntimeController { destroy(): void; isCurrent(): boolean }`
  - `interface RuntimeHydrator { readonly id: FeatureId; readonly selector: '[data-hpm-detail]' | '[data-hpm-overview]'; mount(root: HTMLElement): RuntimeController }`
  - `interface HexoPostMapBrowserApi { readonly apiVersion: 1; refresh(scope?: Document | DocumentFragment | Element): void; destroy(scope?: Document | DocumentFragment | Element): void }`
  - `interface FeatureResourceLoader { ensure(feature: FeatureId, retryFailed?: boolean): Promise<boolean>; isReady(feature: FeatureId): boolean; stop(): void }`
  - `createFeatureResourceLoader(options: { document: Document; assetBase: URL; hasHydrator(feature: FeatureId): boolean }): FeatureResourceLoader`
  - `FEATURES`, a frozen record with the exact selectors, `post-map.js` / `overview-map.js`, and the existing detail/overview failure messages.

- [ ] **Step 1: Install the locked development dependencies and establish a clean baseline**

Run: `npm ci`

Run: `npm run test:run -- test/browser/provider-loader.test.ts test/browser/detail.test.ts test/browser/overview.test.ts`

Expected: dependency installation succeeds and the three existing suites pass before runtime work begins.

- [ ] **Step 2: Write failing resource-loader tests**

Add a local `resourceHarness(options?)` helper returning a fresh Happy DOM `Window`, its `document`, a mutable hydrator set, the loader, and typed helpers `links()`, `scripts()`, and `dispatch(element, 'load' | 'error')`. Pin these behaviors:

```ts
it('shares one stylesheet and one detail script across concurrent roots', async () => {
  const h = resourceHarness();
  const first = h.loader.ensure('detail');
  const second = h.loader.ensure('detail');
  expect(h.links().map((node) => node.href)).toEqual([
    'https://example.test/blog/hexo-post-map/assets/style.css',
  ]);
  expect(h.scripts().map((node) => node.src)).toEqual([
    'https://example.test/blog/hexo-post-map/assets/post-map.js',
  ]);
  h.hydrators.add('detail');
  h.dispatch(h.links()[0]!, 'load');
  h.dispatch(h.scripts()[0]!, 'load');
  await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
});

it('adopts an already loaded stylesheet and registered feature script', async () => {
  const h = resourceHarness({ existingStyle: 'loaded', existingDetailScript: true });
  await expect(h.loader.ensure('detail')).resolves.toBe(true);
  expect(h.links()).toHaveLength(1);
  expect(h.scripts()).toHaveLength(1);
});

it('suppresses automatic retries and retries only the failed shared resource explicitly', async () => {
  const h = resourceHarness();
  const detail = h.loader.ensure('detail');
  h.hydrators.add('detail');
  h.dispatch(h.scripts()[0]!, 'load');
  h.dispatch(h.links()[0]!, 'error');
  await expect(detail).resolves.toBe(false);
  await expect(h.loader.ensure('detail')).resolves.toBe(false);
  expect(h.links()).toHaveLength(1);
  const retry = h.loader.ensure('detail', true);
  expect(h.links()).toHaveLength(2);
  expect(h.scripts()).toHaveLength(1);
  h.dispatch(h.links()[1]!, 'load');
  await expect(retry).resolves.toBe(true);
});

it('stops late load events from making a departing page ready', async () => {
  const h = resourceHarness();
  const pending = h.loader.ensure('overview');
  h.loader.stop();
  h.hydrators.add('overview');
  h.dispatch(h.links()[0]!, 'load');
  h.dispatch(h.scripts()[0]!, 'load');
  await expect(pending).resolves.toBe(false);
  expect(h.loader.isReady('overview')).toBe(false);
});
```

Also test independent detail/overview script failure, query/hash-free URLs derived from `/blog/hexo-post-map/assets/`, and one explicit overview retry after a shared-style failure making the already successful detail script reusable.

- [ ] **Step 3: Run the resource-loader suite to verify red**

Run: `npm run test:run -- test/browser/runtime-resources.test.ts`

Expected: FAIL because `runtime/types.ts` and `runtime/resources.ts` do not exist.

- [ ] **Step 4: Implement the resource contracts and loader**

Implement the interfaces above. Use one stylesheet state plus one script state per feature; canonicalize through `new URL(name, assetBase).href`; treat `HTMLLinkElement.sheet !== null` as a completed existing stylesheet and an already registered hydrator as a completed existing script. Failed states return `false` without reinsertion until `retryFailed === true`; retry removes only the connected canonical link or script element recorded for that failed attempt, never an unrelated node. `stop()` settles pending calls as `false` and prevents late events from changing state.

- [ ] **Step 5: Run focused tests**

Run: `npm run test:run -- test/browser/runtime-resources.test.ts`

Expected: PASS with no unhandled promise rejection and no duplicate resource element.

- [ ] **Step 6: Commit the resource boundary**

```bash
git add src/browser/runtime/types.ts src/browser/runtime/resources.ts test/browser/runtime-resources.test.ts
git commit -m "feat: add lazy browser feature loader"
```

### Task 2: Singleton runtime, reconciliation, and public API

**Files:**

- Create: `src/browser/runtime/bridge.ts`
- Create: `src/browser/runtime/runtime.ts`
- Create: `test/browser/runtime.test.ts`

**Interfaces:**

- Consumes: all Task 1 contracts and `createFeatureResourceLoader(options: { document: Document; assetBase: URL; hasHydrator(feature: FeatureId): boolean }): FeatureResourceLoader`.
- Produces:
  - `const BROWSER_RUNTIME_KEY = Symbol.for('hexo-post-map.browser-runtime.v1')`
  - `const PENDING_HYDRATORS_KEY = Symbol.for('hexo-post-map.pending-hydrators.v1')`
  - `registerRuntimeHydrator(hydrator: RuntimeHydrator, page?: Window): void`
  - `interface BrowserRuntime { readonly api: HexoPostMapBrowserApi; register(hydrator: RuntimeHydrator): void; start(): void }`
  - `interface BrowserRuntimeOptions { readonly page: Window; readonly document: Document; readonly assetBase: URL; readonly mutationObserver: typeof MutationObserver | null; readonly resources?: FeatureResourceLoader }`
  - `createBrowserRuntime(options: BrowserRuntimeOptions): BrowserRuntime`
  - `installBrowserRuntime(script: HTMLScriptElement): BrowserRuntime`

- [ ] **Step 1: Write failing lifecycle and API tests**

Add `runtimeHarness(options?)`, which creates a fresh Happy DOM window, a deterministic resource-loader double, and controller spies. Cover the following exact outcomes:

```ts
it('exposes one frozen versioned API and rejects invalid or foreign scopes', () => {
  const h = runtimeHarness();
  const descriptor = Object.getOwnPropertyDescriptor(h.window, 'HexoPostMap')!;
  expect(h.api.apiVersion).toBe(1);
  expect(Object.isFrozen(h.api)).toBe(true);
  expect(descriptor).toMatchObject({ enumerable: false, writable: false, configurable: false });
  expect(() => h.api.refresh({} as Element)).toThrow(TypeError);
  expect(() => h.api.destroy(new Window().document.body)).toThrow(TypeError);
});

it('mounts once, preserves a moved root, and remounts replaced required markup', async () => {
  const h = runtimeHarness();
  const root = h.detailRoot();
  h.document.body.append(root);
  await h.flush();
  expect(h.mount).toHaveBeenCalledTimes(1);
  const holder = h.document.createElement('div');
  h.document.body.append(holder);
  holder.append(root);
  await h.flush();
  expect(h.mount).toHaveBeenCalledTimes(1);
  expect(h.controllers[0]!.destroy).not.toHaveBeenCalled();
  root.querySelector('[data-hpm-canvas]')!.replaceWith(h.document.createElement('div'));
  await h.flush();
  expect(h.controllers[0]!.destroy).toHaveBeenCalledTimes(1);
  expect(h.mount).toHaveBeenCalledTimes(2);
});

it('supports scoped refresh and destroy without duplicate mounts', async () => {
  const h = runtimeHarness({ mutationObserver: null });
  const inside = h.detailRoot();
  const outside = h.detailRoot();
  const scope = h.document.createDocumentFragment();
  scope.append(inside);
  h.document.body.append(scope, outside);
  h.api.refresh(inside);
  h.api.refresh(inside);
  expect(h.mount).toHaveBeenCalledTimes(1);
  h.api.destroy(inside);
  expect(h.controllers[0]!.destroy).toHaveBeenCalledTimes(1);
  expect(h.mount).toHaveBeenCalledTimes(1);
  h.api.refresh(inside);
  expect(h.mount).toHaveBeenCalledTimes(2);
});

it('preserves BFCache state and stops permanently on ordinary pagehide', async () => {
  const h = runtimeHarness();
  h.document.body.append(h.detailRoot());
  await h.flush();
  h.pageTransition('pagehide', true);
  h.pageTransition('pageshow', true);
  expect(h.controllers[0]!.destroy).not.toHaveBeenCalled();
  h.pageTransition('pagehide', false);
  expect(h.controllers[0]!.destroy).toHaveBeenCalledTimes(1);
  h.document.body.append(h.detailRoot());
  await h.flush();
  expect(h.mount).toHaveBeenCalledTimes(1);
});
```

Add separate tests for: feature registration before bootstrap draining exactly once; registration after DOM readiness; repeated registration by identifier; duplicate installation returning the same runtime and API; root removal; root replacement; data-node replacement; one queued reconciliation per mutation burst; absent `MutationObserver`; resource-load failure messages and explicit retry; mount/currentness/destroy exception isolation; late resource resolution after ordinary `pagehide`; and a pre-existing non-configurable `window.HexoPostMap` that remains unchanged while auto-mounting continues and one generic warning is emitted. Assert every runtime warning equals a fixed generic message and contains neither the asset URL/query, `amap` key, nor embedded post text.

- [ ] **Step 2: Run the runtime suite to verify red**

Run: `npm run test:run -- test/browser/runtime.test.ts`

Expected: FAIL because `bridge.ts` and `runtime.ts` do not exist.

- [ ] **Step 3: Implement bridge and runtime interfaces**

Use the runtime symbol as the only active cross-IIFE authority. If a feature IIFE executes before the bootstrap, `registerRuntimeHydrator` stores one hydrator per feature ID in the pending-hydrator symbol map; `installBrowserRuntime` stores the runtime, drains that map, then calls `start()`. `createBrowserRuntime` itself returns an inert instance so tests and installation can establish ownership before observation begins.

The runtime owns `Map<HTMLElement, { hydrator: RuntimeHydrator; controller: RuntimeController }>` and idempotent hydrator registration. Reconcile final DOM state in this order: sweep disconnected/stale active records, collect matching roots from each relevant subtree including the subtree itself, call `resources.ensure`, then mount connected ready roots. Queue one microtask per mutation burst and observe only `childList/subtree`. Automatic scans call `ensure(feature, false)`; explicit `api.refresh(scope)` calls `ensure(feature, true)` only for matching features in that scope. `api.destroy(scope)` performs no resource retry.

Validate scopes against the runtime document's realm. The first valid runtime defines the frozen API property; a global-name conflict warns once without exposing sensitive values. Ordinary `pagehide` disconnects observation, stops resources, destroys every record, and prevents later work; persisted `pagehide` preserves state; persisted `pageshow` reconciles. Wrap each resource, mount, `isCurrent`, and destroy operation so one failure cannot stop other records.

- [ ] **Step 4: Run runtime and loader tests**

Run: `npm run test:run -- test/browser/runtime-resources.test.ts test/browser/runtime.test.ts`

Expected: PASS; warnings appear only in the explicit namespace-conflict and failure-isolation tests.

- [ ] **Step 5: Commit the runtime lifecycle**

```bash
git add src/browser/runtime/bridge.ts src/browser/runtime/runtime.ts test/browser/runtime.test.ts
git commit -m "feat: add PJAX map lifecycle runtime"
```

### Task 3: Build and inject the lightweight bootstrap

**Files:**

- Create: `src/browser/runtime/index.ts`
- Modify: `scripts/build.mjs`
- Modify: `src/hexo/injector.ts`
- Modify: `src/hexo/register.ts`
- Modify: `src/hexo/generator.ts`
- Modify: `test/hexo/injector.test.ts`
- Modify: `test/hexo/generator.test.ts`
- Modify: `test/package-smoke.test.ts`

**Interfaces:**

- Consumes: `installBrowserRuntime(script: HTMLScriptElement)` from Task 2.
- Produces: `injectBrowserRuntime(html: string, root: string): string`, `dist/assets/runtime.js`, and the generated route `hexo-post-map/assets/runtime.js`.

- [ ] **Step 1: Rewrite injector and package tests first**

Replace marker-selective script assertions with these contracts:

```ts
it('injects only the runtime into ordinary enabled HTML', () => {
  const html = injectBrowserRuntime(
    '<html><head></head><body><p>Plain</p></body></html>',
    '/blog/',
  );
  expect(html).toContain('<script defer src="/blog/hexo-post-map/assets/runtime.js"></script>');
  expect(html).not.toContain('style.css');
  expect(html).not.toContain('post-map.js');
  expect(html).not.toContain('overview-map.js');
  expect(injectBrowserRuntime(html, '/blog/')).toBe(html);
});

it.each(['data-hpm-detail', 'data-hpm-overview'])(
  'keeps one static fallback stylesheet for %s',
  (marker) => {
    const html = injectBrowserRuntime(`<section ${marker}></section>`, '/');
    expect(html.match(/runtime\.js/gu)).toHaveLength(1);
    expect(html.match(/style\.css/gu)).toHaveLength(1);
    expect(html).not.toMatch(/(?:post-map|overview-map)\.js/u);
  },
);
```

Retain the malformed-tail, executable-script recognition, root-safety, namespace, duplicate-link, uppercase, omitted-tag, and byte-preservation cases, updated to `runtime.js`. Update generator/package assertions to expect five readable routes and this exact asset list:

```ts
expect(files.sort()).toEqual([
  'overview-map.js',
  'placeholder.svg',
  'post-map.js',
  'runtime.js',
  'style.css',
]);
expect((await stat('dist/assets/runtime.js')).size).toBeLessThanOrEqual(8192);
```

- [ ] **Step 2: Run focused server/build tests to verify red**

Run: `npm run test:run -- test/hexo/injector.test.ts test/hexo/generator.test.ts test/package-smoke.test.ts`

Expected: FAIL because the injector still omits ordinary pages and `runtime.js` is not built or routed.

- [ ] **Step 3: Add the runtime entry and build guard**

In `src/browser/runtime/index.ts`, require `document.currentScript` to be an `HTMLScriptElement`, call `installBrowserRuntime(script)`, and otherwise emit one generic warning without a URL or configuration value.

Add `{ source: 'src/browser/runtime/index.ts', output: 'assets/runtime.js', lightweight: true }` to `browserEntries`. For the lightweight entry, request an esbuild metafile; reject any input path under `src/browser/providers/`, `src/browser/detail/`, `src/browser/overview/`, `src/templates/`, `src/domain/`, or `src/presentation/`; and fail the build when the emitted file exceeds 8,192 bytes. Keep IIFE/ES2020/minified/no-sourcemap output.

- [ ] **Step 4: Replace marker-selective feature injection with universal bootstrap injection**

Rename the exported function to `injectBrowserRuntime`. Always inject one root-aware deferred `runtime.js`; inject one root-aware `style.css` only when parse5 finds a genuine detail or overview element. Never inject a feature script. Preserve the existing safe offsets, raw-text/foreign-content protection, executable-script detection, safe URL validation, exact original bytes, and idempotency. Update `registerPlugin`, standalone generation, and `assetRoutes()` to use the new function and fifth asset.

- [ ] **Step 5: Run focused tests and build**

Run: `npm run test:run -- test/hexo/injector.test.ts test/hexo/generator.test.ts test/package-smoke.test.ts`

Run: `npm run build`

Expected: all focused tests pass; `dist/assets/runtime.js` exists, is at most 8,192 bytes, and the build's provider-free guard passes.

- [ ] **Step 6: Commit bootstrap publication**

```bash
git add src/browser/runtime/index.ts scripts/build.mjs src/hexo/injector.ts src/hexo/register.ts src/hexo/generator.ts test/hexo/injector.test.ts test/hexo/generator.test.ts test/package-smoke.test.ts
git commit -m "feat: publish lightweight map runtime"
```

### Task 4: Register structurally current detail and overview controllers

**Files:**

- Modify: `src/browser/detail/index.ts`
- Modify: `src/browser/overview/index.ts`
- Modify: `test/browser/detail.test.ts`
- Modify: `test/browser/overview.test.ts`
- Create: `test/browser/runtime-registration.test.ts`

**Interfaces:**

- Consumes: `RuntimeController`, `RuntimeHydrator`, and `registerRuntimeHydrator(hydrator: RuntimeHydrator, page?: Window): void` from Tasks 1–2.
- Produces: `hydrateDetail(root: HTMLElement, load?: ProviderLoader): RuntimeController` and `hydrateOverview(root: HTMLElement, load?: ProviderLoader, fetcher?: typeof fetch): RuntimeController`; detail and overview feature IIFEs registering the exact selectors from `FEATURES`.

- [ ] **Step 1: Add failing structural-currentness and registration tests**

Replace controller-owned `pagehide/pageshow` expectations with explicit destroy and runtime-owned lifecycle coverage. Add these assertions to the existing detail/overview suites:

```ts
it('reports current only while the captured root, canvas, and data nodes are intact', () => {
  const root = fixture();
  const controller = hydrateDetail(root, load);
  expect(controller.isCurrent()).toBe(true);
  const canvas = root.querySelector('[data-hpm-canvas]')!;
  canvas.replaceWith(document.createElement('div'));
  expect(controller.isCurrent()).toBe(false);
  controller.destroy();
  expect(controller.isCurrent()).toBe(false);
});

it('detects overview data replacement without treating a connected root move as stale', () => {
  const root = fixture();
  const controller = hydrateOverview(root, load, fetcher);
  document.body.append(document.createElement('aside')).append(root);
  expect(controller.isCurrent()).toBe(true);
  root.querySelector('[data-hpm-data]')!.replaceWith(document.createElement('script'));
  expect(controller.isCurrent()).toBe(false);
});
```

In `runtime-registration.test.ts`, mock only `registerRuntimeHydrator`, dynamically import each feature entry after `vi.resetModules()`, and assert one registration with `id: 'detail'`, selector `[data-hpm-detail]`, and `mount(root)` returning `hydrateDetail(root)`, then the equivalent overview registration. Assert neither module adds a `DOMContentLoaded`, `pagehide`, or `pageshow` listener.

- [ ] **Step 2: Run controller suites to verify red**

Run: `npm run test:run -- test/browser/detail.test.ts test/browser/overview.test.ts test/browser/runtime-registration.test.ts`

Expected: FAIL because controllers do not expose `isCurrent()` and feature entries still self-initialize and own `pagehide`.

- [ ] **Step 3: Make controllers runtime-managed**

Capture the exact canvas and `[data-hpm-data]` element before parsing. Add `isCurrent(): boolean` returning true only when the controller is not disposed, the root is connected, and both queries still return those exact captured nodes. Keep each feature's symbol-keyed `WeakMap`, `initializeDetailMaps`, and `initializeOverviewMaps` as defensive/direct-call helpers.

Remove per-controller `pagehide` listeners and both top-level `DOMContentLoaded` initializers. Keep abort, intersection, panel, map-handle, late-handle destruction, fallback, and WeakMap cleanup inside `destroy()`. At each feature entry's bottom, call `registerRuntimeHydrator` with the exact stable ID, selector, and mount function.

- [ ] **Step 4: Run all browser unit tests**

Run: `npm run test:run -- test/browser`

Expected: every browser suite passes; existing provider ownership/cancellation behavior remains unchanged and lifecycle tests now live at runtime level.

- [ ] **Step 5: Commit feature registration**

```bash
git add src/browser/detail/index.ts src/browser/overview/index.ts test/browser/detail.test.ts test/browser/overview.test.ts test/browser/runtime-registration.test.ts
git commit -m "feat: register maps with browser runtime"
```

### Task 5: Packed output and deterministic PJAX browser acceptance

**Files:**

- Modify: `test/integration/generated-output.test.ts`
- Modify: `test/integration/real-blog-smoke.mjs`
- Modify: `e2e/fixtures.ts`
- Modify: `e2e/fake-sdk.ts`
- Create: `e2e/pjax-runtime.spec.ts`

**Interfaces:**

- Consumes: generated `runtime.js`, `window.HexoPostMap`, existing packed fixture routes, and existing fake AMap SDK.
- Produces: request counters for local runtime/style/detail/overview/data assets and deterministic PJAX replacement helpers used only by the browser suite.

- [ ] **Step 1: Update packed-output assertions before changing browser behavior**

For `/` and `/blog/`, assert every enabled HTML page contains exactly one root-aware `runtime.js`. Assert ordinary posts contain no `style.css` or feature script; mapped detail and overview pages contain one `style.css`, no feature script, and their unchanged SSR fallback. Assert all five asset files are non-empty and `posts.json` remains version 1 with the same public fields.

Update `real-blog-smoke.mjs` to make the same generated-output assertions. Have `verifyGenerated` return one generated ordinary archive route as well as its count. Start the browser smoke on that ordinary route, fetch the copied Shanghai and overview HTML, and use `DOMParser` to replace one stable host with only their map roots; verify both activate without executing destination scripts. Then perform full-page detail/overview checks: click the current detail marker named `显示地点：上海`, assert the tooltip text `上海`, open the current `1 篇文章` overview dialog, and follow the image card. Remove all obsolete activation-button and provider-popup expectations. Ordinary real-blog pages must contain `runtime.js` but no map marker, stylesheet, or feature script.

- [ ] **Step 2: Add a failing PJAX browser test and observable fake-SDK teardown**

Extend the network fixture with exact local request counts keyed by pathname. In the fake SDK, increment `window.__hpmSdk.destroyedMaps` inside `Map.destroy()` while preserving existing behavior. Add a helper that fetches a target HTML document, imports only its map root into a stable test host, and never executes destination script tags.

Create these browser cases:

```ts
test('ordinary -> detail -> detail -> overview -> ordinary uses one lazy runtime', async ({
  page,
  network,
}) => {
  await page.goto('/blog/posts/plain/');
  expect(network.local['/blog/hexo-post-map/assets/runtime.js']).toBe(1);
  expect(network.local['/blog/hexo-post-map/assets/style.css'] ?? 0).toBe(0);
  await replaceHostFrom(page, '/blog/posts/single/');
  await expect(page.locator('[data-hpm-detail]')).toHaveAttribute('data-hpm-active', 'true');
  await replaceHostFrom(page, '/blog/posts/route/');
  await expect(page.locator('.hpm-detail-marker')).toHaveCount(3);
  await replaceHostFrom(page, '/blog/map/');
  await expect(page.locator('[data-hpm-overview]')).toHaveAttribute('data-hpm-active', 'true');
  await clearHost(page);
  expect(network.local['/blog/hexo-post-map/assets/style.css']).toBe(1);
  expect(network.local['/blog/hexo-post-map/assets/post-map.js']).toBe(1);
  expect(network.local['/blog/hexo-post-map/assets/overview-map.js']).toBe(1);
  expect(network.sdkRequests).toBe(1);
  expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').destroyedMaps)).toBe(3);
});

test('manual refresh initializes an inserted root without MutationObserver', async ({ page }) => {
  await page.addInitScript(() => Reflect.set(window, 'MutationObserver', undefined));
  await page.goto('/blog/posts/plain/');
  await replaceHostFrom(page, '/blog/posts/single/');
  await expect(page.locator('[data-hpm-detail]')).not.toHaveAttribute('data-hpm-active', 'true');
  await page
    .locator('[data-hpm-detail]')
    .evaluate((root) => Reflect.get(window, 'HexoPostMap').refresh(root));
  await expect(page.locator('[data-hpm-detail]')).toHaveAttribute('data-hpm-active', 'true');
});
```

Add a third test that pauses `/blog/map/posts.json`, removes the overview root, then fulfills the response and asserts the map count, panels, markers, and active roots do not increase. Exercise the versioned API descriptor and invalid argument `TypeError` in the real browser. Keep existing detail tooltip, overview panel, keyboard, fallback, and BFCache suites unchanged and green.

Add a fourth test using a fresh Chromium context with `javaScriptEnabled: false`: load `/blog/posts/single/`, assert one `style.css` link, a visible place-list fallback, a 220px detail canvas, and no executed feature script. Close that context in `finally`.

- [ ] **Step 3: Run focused integration/browser tests to verify red**

Run: `npm run test:integration -- --hexo=8.1.2 --theme=cactus-minimal --root=/blog/`

Run: `npm run build && npx playwright test e2e/pjax-runtime.spec.ts --project=chromium`

Expected: at least one new assertion fails until generated-output expectations, request counters, teardown instrumentation, and PJAX lifecycle behavior are complete.

- [ ] **Step 4: Complete the packed and browser fixtures**

Implement the exact assertions and helpers from Steps 1–2. Do not add a theme router dependency or execute scripts parsed from destination HTML. Ensure request counters ignore ordinary HTML fetches when asserting map-resource cardinality, and ensure delayed routes are fulfilled or aborted in `finally` so Playwright cannot hang.

- [ ] **Step 5: Run focused acceptance again**

Run: `npm run test:integration -- --hexo=8.1.2 --theme=cactus-minimal --root=/blog/`

Run: `npm run build && npx playwright test e2e/pjax-runtime.spec.ts e2e/bfcache.spec.ts e2e/detail-map.spec.ts e2e/overview-map.spec.ts --project=chromium`

Expected: selected packed cell and all selected Chromium suites pass; local feature/style requests are deduplicated and no late work revives a removed root.

- [ ] **Step 6: Commit acceptance coverage**

```bash
git add test/integration/generated-output.test.ts test/integration/real-blog-smoke.mjs e2e/fixtures.ts e2e/fake-sdk.ts e2e/pjax-runtime.spec.ts
git commit -m "test: cover PJAX map navigation"
```

### Task 6: Public compatibility documentation and release-grade verification

**Files:**

- Create: `docs/compatibility.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/configuration.md`
- Modify: `docs/security.md`
- Modify: `test/integration/README.md`

**Interfaces:**

- Consumes: the final `window.HexoPostMap` API and asset behavior implemented in Tasks 1–5.
- Produces: the public compatibility contract and verified feature branch; no npm publication or permanent blog dependency update occurs in this task.

- [ ] **Step 1: Write the public compatibility documentation**

Document these exact facts in both READMEs and `docs/compatibility.md`:

- Enabled sites load a provider-free runtime on every HTML page; ordinary pages do not load map UI/provider resources.
- Initial map pages keep static CSS for no-JavaScript fallback; feature IIFEs and AMap remain lazy.
- Conventional light-DOM PJAX replacement is automatic.
- Manual integration uses:

```js
if (window.HexoPostMap?.apiVersion === 1) {
  window.HexoPostMap.refresh(container);
}
```

- `destroy(container)` is optional before removal, both methods default to `document`, invalid scopes throw `TypeError`, and methods return before AMap finishes.
- Closed/unobserved shadow roots, another document, a suppressed runtime script, and nonstandard transitions are outside the automatic guarantee.
- Local bundle/style load failure can be retried by `refresh`; an AMap SDK timeout still requires a full page reload.

Update `docs/configuration.md` from marker-only injection to universal runtime plus map-only stylesheet. Update `docs/security.md` to recognize dynamic same-origin feature scripts/styles and the public lifecycle API while preserving CSP and SDK-coexistence cautions. Update the integration README with the PJAX fixture and five-asset expectations.

- [ ] **Step 2: Run documentation and static checks**

Run: `npm run format:check`

Run: `npm run lint`

Run: `npm run typecheck`

Run: `npm run test:run -- test/docs/examples.test.ts test/package-contents.test.ts test/npm-pack-json.test.ts`

Expected: all commands pass; README examples remain parseable and the package allowlist remains unchanged.

- [ ] **Step 3: Commit the public contract**

```bash
git add README.md README.zh-CN.md docs/compatibility.md docs/configuration.md docs/security.md test/integration/README.md
git commit -m "docs: document PJAX compatibility"
```

- [ ] **Step 4: Run the complete repository gate**

Run: `npm run check`

Run: `npm run test:integration`

Run: `npm run test:e2e`

Expected: formatting, lint, both TypeScript checks, all Vitest tests, build, all 18 packed Hexo/theme/root cells, and required Chromium tests pass. `test:amap-smoke` remains optional and is not run without explicit real credentials.

- [ ] **Step 5: Run the audited real-blog packed smoke**

Run: `node test/integration/real-blog-smoke.mjs`

Expected: the runner copies `/Users/hif/blog/blog_source` into a temporary workspace, installs the packed tarball (not a symlink), builds and browser-tests both `/` and `/blog/` on `127.0.0.1`, reports detail/overview/PJAX-safe asset behavior, and proves both real repositories are byte-for-byte unchanged afterward.

- [ ] **Step 6: Audit the final branch without changing it**

Run: `git status --short --branch`

Run: `git diff --check origin/main...HEAD`

Run: `git log --oneline --decorate origin/main..HEAD`

Expected: the worktree is clean; diff check emits no output; history contains the design/plan commits plus one focused implementation commit per task. Record the exact successful commands and runtime byte size in the handoff. Do not publish npm, merge, tag, or update the real blog dependency until the user accepts the verified branch.
