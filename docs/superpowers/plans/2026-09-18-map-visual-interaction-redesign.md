# Map Visual and Interaction Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace oversized and imprecise map UI with anchored thumbnail markers, compact teal clusters, a reusable glass article panel, bounded all-posts browsing, and icon-only detail points with schematic routes.

**Architecture:** Keep AMap isolated in the provider adapter and move marker DOM construction into a provider-independent factory. Reuse one non-modal article panel for leaf markers, terminal clusters, and the all-posts control; keep detail points non-interactive and preserve automatic loading plus readable fallbacks.

**Tech Stack:** TypeScript, DOM APIs, AMap JavaScript API 2.0, CSS custom properties, Vitest with happy-dom, Playwright Chromium, Hexo 7/8.

**Spec:** `docs/superpowers/specs/2026-09-18-map-visual-interaction-redesign.md`

## Global Constraints

- Preserve the current public Front Matter and `_config.yml` contracts; this redesign requires no migration.
- Preserve automatic near-viewport detail loading and immediate map interaction; do not restore an activation overlay.
- Keep successful loading silent. Only failures expose a concise status and the readable fallback.
- Keep provider UI out of AMap `InfoWindow` and undocumented vendor DOM.
- Do not add runtime dependencies or a public JavaScript extension API.
- Keep clusters driven by screen distance and zoom; do not add `place_id` or coordinate jitter.
- Interactive controls retain at least a 44x44px hit area, visible focus, keyboard use, and reduced-motion behavior.
- Keep the package compatible with Node.js `>=20` and Hexo `>=7 <9`.
- Never place real AMap credentials in source, tests, logs, screenshots, or commits.

---

### Task 1: Land the automatic-loading baseline

The worktree already contains the reviewed automatic-loading change. Land it separately before the visual redesign so later reviews can distinguish behavior removal from new UI construction.

**Files:**

- Modify: `README.md`
- Modify: `src/browser/detail/index.ts`
- Modify: `src/browser/overview/index.ts`
- Modify: `src/browser/styles/index.css`
- Modify: `test/browser/detail.test.ts`
- Modify: `test/browser/overview.test.ts`
- Modify: `e2e/accessibility.spec.ts`
- Modify: `e2e/amap-smoke.spec.ts`
- Modify: `e2e/bfcache.spec.ts`
- Modify: `e2e/detail-map.spec.ts`
- Modify: `e2e/overview-map.spec.ts`

**Interfaces:**

- Consumes: existing `MapHandle.setInteractive(active: boolean)`.
- Produces: detail and overview roots set `data-hpm-active="true"` automatically; no `[data-hpm-activate]` element exists.

- [ ] **Step 1: Verify the focused automatic-loading contract**

Run:

```bash
npm run test:run -- test/browser/detail.test.ts test/browser/overview.test.ts
```

Expected: all focused tests pass, including empty success statuses, automatic `setInteractive(true)`, and failure fallback assertions.

- [ ] **Step 2: Verify the existing browser contract**

Run:

```bash
npm run test:e2e
```

Expected: 19 Chromium tests pass, including offscreen lazy loading, desktop/mobile automatic interaction, BFCache, and failure recovery.

- [ ] **Step 3: Commit only the baseline files**

```bash
git add README.md src/browser/detail/index.ts src/browser/overview/index.ts src/browser/styles/index.css test/browser/detail.test.ts test/browser/overview.test.ts e2e/accessibility.spec.ts e2e/amap-smoke.spec.ts e2e/bfcache.spec.ts e2e/detail-map.spec.ts e2e/overview-map.spec.ts
git diff --cached --check
git commit -m "feat: activate maps automatically"
```

---

### Task 2: Build provider-independent overview marker elements

**Files:**

- Create: `src/browser/overview/markers.ts`
- Create: `test/browser/markers.test.ts`
- Modify: `src/browser/overview/panel.ts`
- Modify: `src/browser/overview/index.ts`

**Interfaces:**

- Consumes: `OverviewPost` and `safeUrl`.
- Produces:

```ts
export interface MarkerElement {
  readonly element: HTMLButtonElement;
  readonly offset: readonly [x: number, y: number];
}

export function createPostImage(post: OverviewPost, placeholderUrl: string): HTMLImageElement;

export function installImageFallback(image: HTMLImageElement, placeholderUrl: string): () => void;

export function createClusterMarker(count: number): MarkerElement;

export function createImageMarker(
  post: OverviewPost,
  placeholderUrl: string,
  compact: boolean,
): MarkerElement;
```

- [ ] **Step 1: Write failing marker factory tests**

Create `test/browser/markers.test.ts` with happy-dom tests that assert the exact contract:

```ts
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createClusterMarker, createImageMarker } from '../../src/browser/overview/markers';

describe('overview marker elements', () => {
  it.each([
    [2, 'hpm-cluster__surface--small'],
    [10, 'hpm-cluster__surface--medium'],
    [100, 'hpm-cluster__surface--large'],
  ] as const)('sizes a %s-post cluster', (count, className) => {
    const marker = createClusterMarker(count);
    expect(marker.element.firstElementChild?.classList).toContain(className);
    expect(marker.element.textContent).toBe(String(count));
    expect(marker.element.getAttribute('aria-label')).toBe(`查看此处的 ${count} 篇文章`);
    expect(marker.offset).toEqual([-22, -22]);
  });

  it('anchors a thumbnail above a stem and coordinate dot', () => {
    const marker = createImageMarker(post, '/placeholder.svg', false);
    expect(marker.element.querySelector('.hpm-image-marker__card img')).not.toBeNull();
    expect(marker.element.querySelector('.hpm-image-marker__stem')).not.toBeNull();
    expect(marker.element.querySelector('.hpm-image-marker__dot')).not.toBeNull();
    expect(marker.element.getAttribute('aria-label')).toBe(`预览文章：${post.title}`);
    expect(marker.offset).toEqual([-36, -72]);
  });
});
```

Use a local safe `OverviewPost` fixture. Add a compact assertion expecting `[-32, -66]`, and retain the current image-error replacement and unsafe-image URL tests.

- [ ] **Step 2: Run the new test and observe the missing-module failure**

Run:

```bash
npm run test:run -- test/browser/markers.test.ts
```

Expected: FAIL because `src/browser/overview/markers.ts` does not exist.

- [ ] **Step 3: Implement the marker factories and move image helpers**

Create `markers.ts` with count validation and semantic DOM. The implementation must use `textContent`, never `innerHTML`:

```ts
export function createClusterMarker(count: number): MarkerElement {
  if (!Number.isSafeInteger(count) || count < 2) throw new Error('Invalid cluster count');
  const modifier = count >= 100 ? 'large' : count >= 10 ? 'medium' : 'small';
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'hpm-cluster';
  element.setAttribute('aria-label', `查看此处的 ${count} 篇文章`);
  const surface = document.createElement('span');
  surface.className = `hpm-cluster__surface hpm-cluster__surface--${modifier}`;
  surface.textContent = String(count);
  surface.setAttribute('aria-hidden', 'true');
  element.append(surface);
  return { element, offset: [-22, -22] };
}

export function createImageMarker(
  post: OverviewPost,
  placeholderUrl: string,
  compact: boolean,
): MarkerElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'hpm-image-marker';
  element.setAttribute('aria-label', `预览文章：${post.title}`);
  const card = document.createElement('span');
  card.className = 'hpm-image-marker__card';
  card.append(createPostImage(post, placeholderUrl));
  const stem = document.createElement('span');
  stem.className = 'hpm-image-marker__stem';
  stem.setAttribute('aria-hidden', 'true');
  const dot = document.createElement('span');
  dot.className = 'hpm-image-marker__dot';
  dot.setAttribute('aria-hidden', 'true');
  element.append(card, stem, dot);
  return { element, offset: compact ? [-32, -66] : [-36, -72] };
}
```

Move `createPostImage` and `installImageFallback` from `panel.ts` into `markers.ts`. Update `panel.ts` and `overview/index.ts` imports without changing their behavior yet.

- [ ] **Step 4: Run marker and existing panel tests**

Run:

```bash
npm run test:run -- test/browser/markers.test.ts test/browser/overview.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the marker component boundary**

```bash
git add src/browser/overview/markers.ts src/browser/overview/panel.ts src/browser/overview/index.ts test/browser/markers.test.ts
git diff --cached --check
git commit -m "refactor: isolate overview marker elements"
```

---

### Task 3: Wire compact clusters and anchored thumbnails into AMap

**Files:**

- Modify: `src/browser/providers/amap.ts`
- Modify: `src/browser/styles/index.css`
- Modify: `test/browser/overview.test.ts`
- Modify: `test/browser/amap-redraw.test.ts`
- Modify: `e2e/fake-sdk.ts`
- Modify: `e2e/overview-map.spec.ts`

**Interfaces:**

- Consumes: `createClusterMarker(count)` and `createImageMarker(post, placeholderUrl, compact)` from Task 2.
- Produces: AMap cluster renderers whose DOM and offsets come only from `MarkerElement`.

- [ ] **Step 1: Change provider tests to require factory structure and offsets**

Replace former class/text-only expectations with assertions such as:

```ts
clusterInstance.options.renderClusterMarker({ marker, clusterData: clusterInstance.data });
expect(marker.content?.querySelector('.hpm-cluster__surface--small')).not.toBeNull();
expect(marker.offset).toEqual({ x: -22, y: -22 });

clusterInstance.options.renderMarker({ marker, data: [clusterInstance.data[0]!] });
expect(marker.content?.querySelector('.hpm-image-marker__dot')).not.toBeNull();
expect(marker.offset).toEqual({ x: -36, y: -72 });
```

Make fake `ClusterMarker.setOffset(pixel)` store the pixel. Add redraw assertions proving old buttons still lose listeners and focus restoration still resolves the replacement marker.

- [ ] **Step 2: Run focused tests and verify the old offsets fail**

Run:

```bash
npm run test:run -- test/browser/overview.test.ts test/browser/amap-redraw.test.ts
```

Expected: FAIL because the adapter still constructs 48px blue clusters and 96x72 centered images.

- [ ] **Step 3: Replace inline marker construction in the adapter**

In `mountOverview.render`, create the view first and preserve the existing ownership maps:

```ts
const compact = window.matchMedia?.('(max-width: 600px)').matches ?? false;
const view = grouped
  ? createClusterMarker(posts.length)
  : createImageMarker(posts[0]!, options.placeholderUrl, compact);
const button = view.element;
button.disabled = !active;
button.tabIndex = active ? 0 : -1;
// Existing click, stable membership, and redraw cleanup logic remains here.
context.marker.setContent(button);
context.marker.setOffset(new api.Pixel(...view.offset));
```

Do not move cluster decisions or event ownership into `markers.ts`.

- [ ] **Step 4: Add the marker visual rules**

Replace the former fixed `.hpm-cluster` and `.hpm-image-marker` blocks with CSS custom properties and exact dimensions:

```css
.hpm-overview {
  --hpm-accent: #0f766e;
  --hpm-accent-contrast: #ffffff;
  --hpm-cluster-surface: rgb(15 118 110 / 88%);
  --hpm-cluster-border: rgb(255 255 255 / 78%);
}

.hpm-cluster {
  display: grid;
  position: relative;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--hpm-accent-contrast);
}

.hpm-cluster__surface {
  display: grid;
  place-items: center;
  border: 1px solid var(--hpm-cluster-border);
  border-radius: 999px;
  background: var(--hpm-cluster-surface);
  box-shadow: 0 4px 14px rgb(15 23 42 / 24%);
}

.hpm-cluster__surface--small {
  width: 34px;
  height: 34px;
}
.hpm-cluster__surface--medium {
  width: 38px;
  height: 38px;
}
.hpm-cluster__surface--large {
  width: 42px;
  height: 42px;
}

.hpm-image-marker {
  display: grid;
  width: 72px;
  min-width: 72px;
  min-height: 72px;
  grid-template-rows: 54px 10px 8px;
  justify-items: center;
  padding: 0;
  border: 0;
  background: transparent;
}

.hpm-image-marker__card {
  width: 72px;
  height: 54px;
  overflow: hidden;
  border: 2px solid rgb(255 255 255 / 92%);
  border-radius: 10px;
  background: var(--hpm-card-surface);
  box-shadow: 0 5px 16px rgb(15 23 42 / 26%);
}

.hpm-image-marker__stem {
  width: 1px;
  height: 10px;
  background: var(--hpm-accent);
}
.hpm-image-marker__dot {
  width: 8px;
  height: 8px;
  border: 2px solid white;
  border-radius: 50%;
  background: var(--hpm-accent);
}
```

Use a pseudo-element or wrapper to retain a 44px hit target without changing the visual dot. Add 64x48 compact dimensions in the existing mobile media query and remove the old 96x72 marker rules.

- [ ] **Step 5: Update fake SDK and browser assertions**

Store marker offsets in `e2e/fake-sdk.ts`. In `overview-map.spec.ts`, assert that the leaf button contains card/stem/dot, that the cluster has the small-size class, and that no leaf image covers the coordinate anchor element.

- [ ] **Step 6: Run the focused suite**

Run:

```bash
npm run test:run -- test/browser/markers.test.ts test/browser/overview.test.ts test/browser/amap-redraw.test.ts
```

Run:

```bash
npm run test:e2e -- e2e/overview-map.spec.ts
```

Expected: all focused unit and overview browser tests pass.

- [ ] **Step 7: Commit overview markers**

```bash
git add src/browser/providers/amap.ts src/browser/styles/index.css test/browser/overview.test.ts test/browser/amap-redraw.test.ts e2e/fake-sdk.ts e2e/overview-map.spec.ts
git diff --cached --check
git commit -m "feat: anchor compact overview markers"
```

---

### Task 4: Replace article lists with one bounded glass panel

**Files:**

- Modify: `src/browser/overview/panel.ts`
- Modify: `src/browser/overview/index.ts`
- Modify: `src/browser/styles/index.css`
- Modify: `test/browser/overview.test.ts`
- Modify: `e2e/accessibility.spec.ts`
- Modify: `e2e/bfcache.spec.ts`
- Modify: `e2e/overview-map.spec.ts`

**Interfaces:**

- Consumes: `createPostImage`, `sortPosts`, and existing focus-origin resolvers.
- Produces: unchanged `renderPostPanel(posts, viewport, options): PanelHandle`, extended options with `onClose?: () => void`, and an in-map `[data-hpm-show-list]` control labeled `全部文章 N`.

- [ ] **Step 1: Write failing panel structure and all-posts tests**

Update article-panel tests to require one link per safe post and the new header/scroller structure:

```ts
expect(panel.element.querySelector('.hpm-panel__header')).not.toBeNull();
expect(panel.element.querySelector('.hpm-panel__scroller')).not.toBeNull();
expect(panel.element.querySelector('.hpm-panel__close')?.textContent).toBe('×');
expect(panel.element.querySelector('.hpm-panel__close')?.getAttribute('aria-label')).toBe(
  '关闭文章面板',
);
expect(panel.element.querySelectorAll('.hpm-post__link')).toHaveLength(2);
expect(panel.element.querySelectorAll('.hpm-post__link img')).toHaveLength(2);
```

Update overview hydration tests to require `全部文章 2`, `aria-expanded="false"`, panel reuse, newest-first order, close toggling, and fallback remaining hidden during successful all-post browsing.

- [ ] **Step 2: Run the panel tests and verify the old markup fails**

Run:

```bash
npm run test:run -- test/browser/overview.test.ts
```

Expected: FAIL because the old panel has a text close button, duplicate links, and no header/scroller.

- [ ] **Step 3: Rebuild panel markup without unsafe HTML**

Keep the existing signature and render this hierarchy:

```text
section.hpm-panel[role=dialog]
  header.hpm-panel__header
    h2.hpm-panel__title
    button.hpm-panel__close[aria-label="关闭文章面板"]  ×
  div.hpm-panel__scroller
    ol.hpm-post-list
      li.hpm-post
        a.hpm-post__link
          img.hpm-post__image
          div.hpm-post__body
            span.hpm-post__title
            time.hpm-post__date
            span.hpm-post__location
```

For an unsafe/missing post URL, render the same card as a non-link `div.hpm-post__link` with no click behavior. Set the dialog label to `1 篇文章` or `${posts.length} 篇文章`. Call `options.onClose?.()` exactly once from `destroy()`.

Assign each panel a stable page-local ID so `aria-controls` never points at an empty value:

```ts
let panelSequence = 0;
// Inside renderPostPanel:
element.id = `hpm-panel-${++panelSequence}`;
```

- [ ] **Step 4: Make the all-posts control open the shared panel**

In `overview/index.ts`, retain the fetched `posts` and change the control flow:

```ts
showList.textContent = `全部文章 ${posts.length}`;
showList.hidden = false;
showList.setAttribute('aria-expanded', 'false');

function openPanel(posts, origin, resolveOrigin) {
  panel?.destroy();
  panel = renderPostPanel(posts, viewport(), {
    container: root,
    placeholderUrl: config.placeholderUrl,
    origin,
    resolveOrigin,
    fallback: canvas,
    onClose: () => {
      if (origin === showList) showList.setAttribute('aria-expanded', 'false');
      panel = undefined;
    },
  });
  if (origin === showList) {
    showList.setAttribute('aria-expanded', 'true');
    showList.setAttribute('aria-controls', panel.element.id);
  }
}
```

Clicking the expanded all-posts control closes its panel. Do not reveal the SSR fallback on a successful map.

- [ ] **Step 5: Implement glass, bounded scrolling, cards, and responsive drawer CSS**

Use a sticky header and a scroll-only body:

```css
.hpm-panel {
  position: absolute;
  z-index: 20;
  top: 16px;
  right: 16px;
  display: grid;
  width: min(320px, calc(100% - 32px));
  max-height: 70%;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--hpm-panel-border);
  border-radius: var(--hpm-panel-radius, 18px);
  background: var(--hpm-panel-surface);
  box-shadow: var(--hpm-panel-shadow);
  backdrop-filter: blur(18px) saturate(135%);
}

.hpm-panel__scroller {
  overflow: auto;
  overscroll-behavior: contain;
}
.hpm-panel__close {
  width: 44px;
  height: 44px;
  border-radius: 50%;
}
.hpm-post__link {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 12px;
  border-radius: var(--hpm-card-radius, 14px);
  background: var(--hpm-card-surface);
  text-decoration: none;
}
```

At 600px and below use `position: fixed`, `inset: auto 0 0`, `width: 100%`, and `max-height: 65dvh`, including the safe-area bottom inset. Provide an opaque `background` before the translucent value so browsers without `backdrop-filter` remain readable.

- [ ] **Step 6: Update browser tests for scrolling and focus**

Create at least 30 posts in the E2E fixture for the all-posts path. Assert the panel bounding box does not exceed the map/65dvh limit, `.hpm-panel__scroller` has scrollable overflow, the page height does not grow when opened, `Escape` restores focus, and the full card link navigates.

- [ ] **Step 7: Run focused unit and browser tests**

Run:

```bash
npm run test:run -- test/browser/overview.test.ts
```

Run:

```bash
npm run test:e2e -- e2e/overview-map.spec.ts e2e/accessibility.spec.ts e2e/bfcache.spec.ts
```

Expected: all panel, responsive, navigation, accessibility, and lifecycle tests pass.

- [ ] **Step 8: Commit the shared article panel**

```bash
git add src/browser/overview/panel.ts src/browser/overview/index.ts src/browser/styles/index.css test/browser/overview.test.ts e2e/accessibility.spec.ts e2e/bfcache.spec.ts e2e/overview-map.spec.ts
git diff --cached --check
git commit -m "feat: add bounded glass article panel"
```

---

### Task 5: Replace detail buttons and place popups with route pins

**Files:**

- Modify: `src/browser/detail/index.ts`
- Modify: `src/browser/providers/amap.ts`
- Modify: `src/browser/styles/index.css`
- Modify: `test/browser/amap.test.ts`
- Modify: `test/browser/amap-ownership.test.ts`
- Modify: `test/browser/amap-transport.test.ts`
- Modify: `e2e/fake-sdk.ts`
- Modify: `e2e/detail-map.spec.ts`
- Modify: `e2e/accessibility.spec.ts`
- Modify: `e2e/bfcache.spec.ts`

**Interfaces:**

- Consumes: `DetailMapModel.map.points`, `DetailMapModel.map.route`, and `MapHandle`.
- Produces: non-interactive `.hpm-detail-marker` elements and no `AMap.InfoWindow` dependency.

- [ ] **Step 1: Replace popup tests with pin-only assertions**

Change the provider tests to require:

```ts
expect(markers.map((marker) => marker.options.content.tagName)).toEqual(['SPAN', 'SPAN', 'SPAN']);
expect(markers.map((marker) => marker.options.content.textContent)).toEqual(['2', '1', '']);
expect(
  markers.every((marker) => marker.options.content.getAttribute('aria-hidden') === 'true'),
).toBe(true);
expect(markers.every((marker) => marker.options.content.querySelector('a') === null)).toBe(true);
```

Delete the test that clicks a marker and expects `uri.amap.com`. Remove `InfoWindow` from the fake API object so the provider test proves it no longer requires or constructs one. Add an assertion that calling `setInteractive(true)` changes only map status and never enables detail marker controls.

- [ ] **Step 2: Run detail provider tests and verify the old buttons fail**

Run:

```bash
npm run test:run -- test/browser/amap.test.ts test/browser/amap-ownership.test.ts test/browser/amap-transport.test.ts
```

Expected: FAIL because detail markers are still buttons and still construct `InfoWindow`.

- [ ] **Step 3: Remove the InfoWindow contract and render pins**

Remove `AMapInfoWindow`, `AMapApi.InfoWindow`, the detail `info` state, marker click listeners, and the `buttons` collection. `existingApi` should require `Map`, `Marker`, and `Polyline`, not `InfoWindow`.

Create each pin with safe DOM:

```ts
const marker = document.createElement('span');
marker.className = 'hpm-detail-marker';
marker.setAttribute('aria-hidden', 'true');
const sequence = model.map.route.findIndex((item) => item.id === point.id);
if (sequence >= 0) {
  marker.classList.add('hpm-detail-marker--numbered');
  const label = document.createElement('span');
  label.className = 'hpm-detail-marker__label';
  label.textContent = String(sequence + 1);
  marker.append(label);
}
markers.push(
  new api.Marker({
    position: point.coordinate,
    content: marker,
    anchor: 'bottom-center',
  }),
);
```

Keep `setFitView` and route path ordering unchanged. Read `--hpm-route-color` from the container with a `#0f766e` fallback and use a 3px route stroke.

- [ ] **Step 4: Preserve hidden point names at the map boundary**

In `detail/index.ts`, set a descriptive canvas label from the validated model:

```ts
const names = config.map.points.map((point) => point.name).join('、');
canvas.setAttribute('aria-label', `文章地点地图：${names}`);
```

The no-JavaScript/failure place list remains readable. A successful map hides the visible fallback exactly as before.

- [ ] **Step 5: Add detail pin and route styles**

```css
.hpm-detail-marker {
  box-sizing: border-box;
  display: grid;
  width: 18px;
  height: 24px;
  place-items: center;
  border: 2px solid white;
  border-radius: 12px 12px 12px 2px;
  background: var(--hpm-accent);
  box-shadow: 0 3px 9px rgb(15 23 42 / 30%);
  color: var(--hpm-accent-contrast);
  font:
    700 11px/1 system-ui,
    sans-serif;
  transform: rotate(-45deg);
}

.hpm-detail-marker--numbered {
  width: 24px;
  height: 30px;
}
.hpm-detail-marker__label {
  transform: rotate(45deg);
}
```

- [ ] **Step 6: Update fake SDK and E2E detail assertions**

Remove InfoWindow behavior from the fake SDK. Assert single-point pages contain an unnumbered pin and no button/popup/link; route pages contain ordered `1`, `2`, … pins and the existing route path. Update keyboard tests so detail map interaction is exercised through the canvas/map, not point buttons.

- [ ] **Step 7: Run focused detail tests**

Run:

```bash
npm run test:run -- test/browser/amap.test.ts test/browser/detail.test.ts test/browser/amap-ownership.test.ts test/browser/amap-transport.test.ts
```

Run:

```bash
npm run test:e2e -- e2e/detail-map.spec.ts e2e/accessibility.spec.ts e2e/bfcache.spec.ts
```

Expected: all detail, accessibility, ownership, abort, route, and lifecycle tests pass.

- [ ] **Step 8: Commit detail pins**

```bash
git add src/browser/detail/index.ts src/browser/providers/amap.ts src/browser/styles/index.css test/browser/amap.test.ts test/browser/amap-ownership.test.ts test/browser/amap-transport.test.ts e2e/fake-sdk.ts e2e/detail-map.spec.ts e2e/accessibility.spec.ts e2e/bfcache.spec.ts
git diff --cached --check
git commit -m "feat: simplify detail maps to route pins"
```

---

### Task 6: Complete theme tokens, documentation, and regression coverage

**Files:**

- Modify: `src/browser/styles/index.css`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `test/docs/examples.test.ts`
- Modify: `e2e/accessibility.spec.ts`
- Modify: `e2e/overview-map.spec.ts`
- Modify: `e2e/detail-map.spec.ts`

**Interfaces:**

- Consumes: all components from Tasks 2-5.
- Produces: documented CSS variables and complete cross-component acceptance coverage.

- [ ] **Step 1: Add failing documentation and theme-contract tests**

Extend `test/docs/examples.test.ts` to require both readmes to document these variables:

```text
--hpm-accent
--hpm-accent-contrast
--hpm-cluster-surface
--hpm-cluster-border
--hpm-panel-surface
--hpm-panel-border
--hpm-card-surface
--hpm-text
--hpm-muted
--hpm-route-color
--hpm-panel-radius
--hpm-card-radius
```

Add E2E checks for forced colors, visible focus, reduced motion, 44px interactive hit targets, and an opaque readable panel fallback when `backdrop-filter` is unsupported.

- [ ] **Step 2: Run tests and verify missing documentation/variables fail**

Run:

```bash
npm run test:run -- test/docs/examples.test.ts
```

Expected: FAIL because the new visual variables are not documented.

- [ ] **Step 3: Finish theme-aware token definitions**

Define safe light defaults, dark defaults under `prefers-color-scheme: dark`, and forced-colors overrides. Keep theme overrides scoped to `.hpm-detail` and `.hpm-overview`. Do not require Cactus selectors.

- [ ] **Step 4: Document the new interactions and customization contract**

Update both readmes to state:

- thumbnails anchor to coordinate dots;
- clusters change visual size by count and still expand by zoom;
- all article selection paths use one bounded panel;
- detail pins do not open provider popups;
- routes remain straight schematic segments;
- themes customize only through the documented variables.

- [ ] **Step 5: Run full package verification**

Run:

```bash
npm run check
```

Expected: formatting, lint, typecheck, 271+ unit/integration tests, and build pass; only the two credential-dependent generated-output tests remain skipped.

Run:

```bash
npm run test:e2e
```

Expected: every Chromium test passes on desktop and mobile.

- [ ] **Step 6: Commit documentation and acceptance coverage**

```bash
git add src/browser/styles/index.css README.md README.zh-CN.md test/docs/examples.test.ts e2e/accessibility.spec.ts e2e/overview-map.spec.ts e2e/detail-map.spec.ts
git diff --cached --check
git commit -m "docs: document map visual customization"
```

---

### Task 7: Validate the packaged plugin in the real blog

**Files:**

- Modify only if required: `/Users/hif/blog/blog_source/themes/cactus/source/css/_partial/post-map.styl`
- Verify: `/Users/hif/blog/blog_source/package.json`
- Verify: `/Users/hif/blog/blog_source/_config.yml`
- Verify: `/Users/hif/blog/blog_source/source/_posts/*.md`

**Interfaces:**

- Consumes: built `dist/` from the plugin and the blog's existing local AMap environment variables.
- Produces: local screenshots and browser assertions; no deployment, bucket upload, npm publication, or committed credentials.

- [ ] **Step 1: Pack and inspect the plugin artifact**

Run:

```bash
npm run build
npm pack --dry-run
```

Expected: only compiled assets, readmes, license, and package metadata are included; no source map or credential-bearing file appears.

- [ ] **Step 2: Install the local artifact without changing the declared dependency**

Create the package tarball, then install it into the real blog with `npm install --no-save <absolute-tarball-path>`. Confirm `package.json` still declares the published semver range and inspect `git diff` before continuing.

- [ ] **Step 3: Build the real blog with existing local credentials**

Run the blog's `npm run build` with `HEXO_POST_MAP_AMAP_KEY` and exactly one existing security-mode variable supplied by the local environment. Do not print either value.

Expected: Hexo performs a clean generation and emits the detail map, `/map/`, versioned assets, and `map/posts.json`.

- [ ] **Step 4: Start the local server and run browser acceptance**

Use `127.0.0.1`, not `localhost`, unless the AMap development key explicitly permits `localhost`. Verify:

```text
/archives/shaoxing_230730/
/map/
```

Capture desktop and 390px-mobile screenshots. Assert:

- no activation or success text;
- detail single point uses an icon without a popup;
- a route fixture uses numbered pins and a line;
- overview thumbnails terminate at visible coordinate dots;
- clusters are compact teal circles;
- `全部文章 N` opens the bounded scrolling panel;
- cards, close icon, Escape, focus restoration, and article navigation work;
- no browser console error occurs on the allowed test host.

- [ ] **Step 5: Keep theme overrides minimal**

Only if the plugin defaults conflict with Cactus, change `post-map.styl` to override documented custom properties. Do not duplicate plugin internal selectors or component layout.

- [ ] **Step 6: Run final repository checks**

In the plugin repository:

```bash
git diff --check
npm run check
npm run test:e2e
```

In the blog repository:

```bash
git diff --check
npm run build
```

Expected: all commands exit 0, the live browser assertions pass, and no credential appears in either tracked diff.

- [ ] **Step 7: Commit only intentional real-blog integration changes**

If Task 5 required no theme changes, do not create a blog commit. If documented-variable overrides were required, stage only `themes/cactus/source/css/_partial/post-map.styl` with the already-approved integration files and commit them separately from the plugin.

Do not publish npm or push either repository as part of this plan; release and remote synchronization require their own explicit authorization and version decision.
