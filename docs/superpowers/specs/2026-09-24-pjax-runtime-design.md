# PJAX-Compatible Browser Runtime Design

Date: 2026-09-24

Status: revised after asset-loading review; pending written-spec review

Target release: `hexo-post-map` v0.4.0

Baseline: v0.3.0 (`e8d46c5ea3fe936cb4104c0a5563d456af4b975a`)

## 1. Summary

Version 0.4.0 makes the existing detail and overview maps survive conventional client-side navigation without requiring theme-specific plugin code. It introduces a small browser runtime on every HTML page generated while the plugin is enabled. That runtime discovers map roots, loads only the feature resources they need, mounts each root exactly once, destroys controllers when their roots leave the document, and exposes a small manual lifecycle API for themes whose navigation cannot be detected generically.

This is a compatibility-only release. It does not add filters, search, taxonomy metadata, URL query state, new map controls, or a new provider. The rendered appearance, Front Matter contract, `posts.json` version, and AMap behavior remain unchanged.

## 2. Context

The v0.3.0 browser bundles initialize themselves once at script evaluation or `DOMContentLoaded`. Detail and overview controllers are individually idempotent and already handle asynchronous cancellation, AMap ownership, ordinary `pagehide`, and BFCache preservation. These protections are sufficient for full document navigation but do not discover map markup inserted later by PJAX, partial rendering, or a client-side theme router.

V0.3.0 also injects browser assets only when the generated HTML already contains map markup. That means a visitor who first loads an ordinary article has no observer or public API available when a PJAX theme later inserts a mapped article. A runtime shared only by the map feature bundles cannot close that gap. The compatibility layer therefore has to be present before the first client-side navigation, while the heavier feature bundles and AMap SDK must remain lazy.

The new runtime must reuse those protections rather than duplicate provider or map behavior. It owns page-level discovery and lifecycle coordination; detail controllers, overview controllers, panels, markers, and the AMap provider continue to own their existing local behavior.

## 3. Goals

- Automatically mount detail and overview maps inserted after initial page load.
- Destroy controllers whose map roots have actually left the current document.
- Preserve controllers when a theme merely moves an existing root within the document.
- Recover when a theme replaces required markup inside an existing map root.
- Keep initial-load, ordinary navigation, and BFCache behavior correct.
- Provide a minimal, versioned manual API for unusual theme navigation.
- Make the lifecycle API available even when the initial page has no map.
- Load detail, overview, shared styles, and the AMap SDK only when a matching root appears.
- Share one runtime across the lightweight bootstrap and both feature IIFE bundles.
- Keep lifecycle work idempotent under repeated scans and rapid DOM replacement.
- Keep the minified `runtime.js` artifact at or below 8 KiB and free of provider code.
- Preserve the current fallback, accessibility, security, and provider ownership guarantees.
- Document and test the compatibility boundary without claiming universal theme support.

## 4. Non-goals

- Article filters, taxonomy controls, search, time sliders, or URL filter state.
- Changes to `posts.json`, post metadata, or site configuration.
- GeoJSON, GPX, recorded tracks, route playback, or statistics. Those belong to a separately designed v0.5 release.
- A second map provider or a public provider-extension API.
- Patching or wrapping `history.pushState`, `history.replaceState`, theme routers, or vendor-specific PJAX functions.
- Automatic theme navigation-menu changes.
- A claim that every SPA or every modified Hexo theme works without integration.
- Removing or replacing the existing server-rendered fallbacks.
- Preloading map feature bundles on pages without map markup.

## 5. Architecture

The page-level flow becomes:

```text
every enabled HTML page
        |
        v
runtime.js bootstrap (no provider code)
        |
        +-- observes detail root ----> loads style.css + post-map.js once
        |                                      |
        |                                      v
        |                              detail hydrator/controller ----> AMap
        |
        +-- observes overview root --> loads style.css + overview-map.js once
                                               |
                                               v
                                       overview hydrator/controller --> AMap
```

### 5.1 Server-side publication and injection

The generated asset routes add `hexo-post-map/assets/runtime.js`. The existing `post-map.js`, `overview-map.js`, `style.css`, and `placeholder.svg` routes and filenames remain available.

When the plugin is enabled, the `after_render:html` hook injects exactly one deferred `runtime.js` script into every rendered HTML document, including documents with no map markup. It no longer injects feature scripts or the stylesheet directly. The standalone overview route, which bypasses Hexo's HTML-render hook, passes through the same injector and therefore receives the same bootstrap.

The runtime derives its asset base from the fully resolved `src` of its own script element. This supports root deployments, non-root Hexo deployments such as `/blog/`, and an explicitly relocated runtime asset without adding configuration. It never derives executable resource URLs from Front Matter, article data, or the public API.

An ordinary page therefore downloads only the local minified runtime. It must not request `style.css`, either feature bundle, the overview JSON, or the AMap SDK until a matching map root exists. The built `runtime.js` must remain at or below 8 KiB before compression and must not import provider, marker, panel, or post-data modules.

### 5.2 Runtime ownership

The runtime is stored under `Symbol.for('hexo-post-map.browser-runtime.v1')` on `window`. The bootstrap and both feature bundles import the same runtime accessor and receive the same page-level instance, even though esbuild emits independent IIFEs.

The runtime owns:

- registered hydrator definitions;
- the fixed detail/overview resource catalog and per-resource load state;
- an iterable registry of active roots and their controllers;
- the mutation observer and its queued reconciliation job;
- the global `pagehide` and `pageshow` listeners;
- the public lifecycle API object.

It owns loading the local stylesheet and feature IIFEs. It does not import or directly own AMap loading, post data, markers, panels, or map interactions.

### 5.3 Feature resource loading

The runtime contains a fixed internal catalog:

| Feature  | Root selector         | Browser bundle    |
| -------- | --------------------- | ----------------- |
| Detail   | `[data-hpm-detail]`   | `post-map.js`     |
| Overview | `[data-hpm-overview]` | `overview-map.js` |

On the first connected root for a feature, the runtime starts one shared `style.css` load and one load for that feature's IIFE. Concurrent roots and repeated scans reuse the same promises. Detail and overview roots share the stylesheet but load their feature bundles independently. The feature is mountable only after the stylesheet has loaded and its IIFE has registered the expected hydrator.

The runtime recognizes its own canonical resource URLs and never inserts a duplicate matching link or script. If a resource element already exists, it adopts that element's pending or completed load rather than adding another. A successful feature load remains reusable for the page lifetime.

A failed stylesheet or feature-script load leaves the server-rendered fallback visible, marks affected roots inactive, and writes the existing generic detail or overview failure message. Automatic observation records the failed attempt and does not retry in a mutation loop. A later explicit `refresh(scope?)` clears the failed load state for features represented in that scope and makes one new attempt; unrelated features are not reloaded. Diagnostics contain the feature identifier and resource kind only, never the URL query, key, page data, or post content.

### 5.4 Hydrator contract

Each browser feature registers one hydrator with a stable identifier, root selector, mount function, and structural-currentness check. Registration is idempotent by identifier.

Conceptually:

```ts
interface RuntimeController {
  destroy(): void;
  isCurrent(): boolean;
}

interface RuntimeHydrator {
  id: 'detail' | 'overview';
  selector: '[data-hpm-detail]' | '[data-hpm-overview]';
  mount(root: HTMLElement): RuntimeController;
}
```

The runtime record keeps the root alongside its controller. `isCurrent()` verifies that the root still owns the exact required DOM nodes captured during hydration, such as its canvas and embedded configuration element. It must not perform network access or mutate the document.

Existing per-feature `WeakMap` idempotency remains as a defensive layer for direct hydration calls, while the shared runtime is the authoritative iterable lifecycle registry.

### 5.5 Bundle integration

The `runtime.js` entry configures the asset base, exposes the public API, starts observation, and scans for the two known selectors. The detail bundle registers the detail hydrator. The overview bundle registers the overview hydrator. A successful registration completes the corresponding feature load and schedules a scan of roots waiting for that hydrator.

The existing direct `DOMContentLoaded` initialization blocks are replaced by runtime registration. If the document body is not yet available, the bootstrap waits for `DOMContentLoaded` before observing and scanning. Feature bundles do not create their own DOM-ready hooks.

Loading either feature bundle more than once, or loading both bundles, must not create two observers, two public API objects, duplicate resource requests, or duplicate global navigation listeners.

## 6. Reconciliation Algorithm

### 6.1 Initial scan

The runtime scans the document once after the bootstrap starts and again after a hydrator registers. A connected root that matches the fixed feature catalog starts the corresponding local-resource load. It mounts only after the expected hydrator is registered and it has no active current controller.

### 6.2 Mutation observation

The runtime observes `childList` changes for the document subtree. It does not observe arbitrary attributes, character data, history APIs, or application state.

For each mutation burst it records:

- added element subtrees that may contain new roots;
- removed subtrees that may contain active roots;
- active roots whose required internal structure may have changed.

All records in the same burst are coalesced into one reconciliation job. The implementation must not rescan the entire document for every individual node mutation.

During reconciliation, cleanup happens against the final DOM state:

1. Destroy active records whose roots are no longer connected.
2. Destroy active records whose `isCurrent()` check fails.
3. Scan each relevant added subtree, including the subtree root itself.
4. Start any missing feature-resource loads once.
5. Mount newly connected roots whose feature resources are ready.

Because cleanup observes the final state, a root removed and reinserted during the same DOM update remains mounted. Replacing a root with a new element destroys the old controller and mounts the new root. Replacing the required canvas or configuration element inside the same root causes one controlled remount.

### 6.3 Failure isolation

Failure in one resource load, hydrator, controller currentness check, or controller destruction must not stop reconciliation for other features or roots. Runtime-level diagnostics must be generic and must not include serialized configuration, credentials, full resource URLs, provider errors, or article data.

Feature controllers remain responsible for showing the existing user-facing fallback and status text when their own configuration, data fetch, provider load, or mount fails.

## 7. Public Lifecycle API

When `runtime.js` loads, the plugin exposes one frozen object, including on pages that initially contain no map:

```ts
interface HexoPostMapBrowserApi {
  readonly apiVersion: 1;
  refresh(scope?: Document | DocumentFragment | Element): void;
  destroy(scope?: Document | DocumentFragment | Element): void;
}

window.HexoPostMap: HexoPostMapBrowserApi;
```

### 7.1 `refresh(scope?)`

- Defaults to `document`.
- First reconciles existing active records, then scans the supplied scope.
- Includes the scope itself when it is an element matching a registered selector.
- Skips disconnected candidate roots.
- Is safe to call repeatedly.
- Retries a previously failed local stylesheet or feature-bundle load once for features represented by the supplied scope.
- Starts asynchronous feature hydration but does not wait for the AMap SDK; it returns `void`.

### 7.2 `destroy(scope?)`

- Defaults to `document` and destroys all active map controllers.
- With a scope, destroys controllers whose roots are the scope or descendants of it.
- Is safe to call repeatedly.
- Does not delete generated HTML, reset an AMap SDK owned by another component, or alter plugin configuration.
- A still-connected destroyed root becomes eligible for a later explicit or automatic refresh.

### 7.3 Namespace safety

The internal symbol remains the source of truth. The runtime bootstrap defines a non-enumerable, non-writable, non-configurable `window.HexoPostMap` property containing the frozen API object; duplicate bootstrap or feature-bundle execution reuses the exact same object. If an unrelated script already owns that global name, the plugin does not overwrite it. Automatic lifecycle support continues through the internal runtime and the plugin emits one generic `console.warn` stating that the manual API could not be exposed. The warning does not include sensitive data.

Invalid explicit API arguments throw a synchronous `TypeError` so theme authors receive a clear integration failure. Automatic runtime work catches its own errors and does not throw into theme code.

## 8. Navigation and BFCache

PJAX and partial navigation are handled through final DOM state, not through assumptions about a particular router. Because the lightweight runtime is present on the initial ordinary page, map roots inserted by a later navigation can load their feature bundle without relying on the theme to execute script tags from the destination document.

- A conventional replacement of the article or main-content container is detected automatically.
- A theme with unusual rendering timing calls `window.HexoPostMap.refresh(container)` after it commits new content.
- A theme may call `destroy(container)` before removing old content, but automatic disconnected-root cleanup remains the default path.
- Ordinary `pagehide` disconnects the mutation observer, stops future reconciliation, destroys all controllers, and prevents pending feature work from mounting into the departing document.
- A persisted `pagehide` does not destroy controllers because the page is entering BFCache.
- A persisted `pageshow` reconciles the restored document and preserves valid controllers.

Global page lifecycle listeners move from each individual detail or overview controller into the shared runtime. Per-controller abort and destroy behavior remains unchanged.

## 9. Provider and Asynchronous Guarantees

- The existing shared provider loader remains independent of the runtime.
- PJAX navigation within one site reuses the already loaded compatible AMap provider.
- Destroying a map destroys its map instance and local listeners, not unrelated SDK state.
- Removing a root aborts pending fetch, intersection observation, and map mounting owned by that controller.
- A promise resolving after destruction must immediately destroy its late handle and must not modify the replacement page.
- Conflicting provider configuration continues to fail through the existing provider-loader boundary and falls back locally.

## 10. Compatibility Contract

Version 0.4.0 intentionally preserves:

- the current site configuration schema;
- the Front Matter schema;
- the version-1 overview `posts.json` envelope;
- all existing generated route and asset filenames, while adding `hexo-post-map/assets/runtime.js`;
- detail and overview appearance and interaction;
- server-rendered fallbacks;
- Node.js and Hexo support ranges;
- GCJ-02 coordinates and AMap-only provider support.

No theme integration is required when navigation replaces ordinary light-DOM subtrees in the same document. Themes that use closed or unobserved shadow roots, render map markup in another document, suppress the globally injected runtime, or mutate structures in a way the generic observer cannot recognize must load the runtime and call the documented API or remain outside the compatibility guarantee.

## 11. Testing Strategy

### 11.1 Unit tests

Add focused runtime tests for:

- deriving the resource base from the runtime script under `/` and `/blog/`;
- ordinary pages exposing the API without loading style, feature, provider, or post data;
- one shared stylesheet load and one feature-script load under concurrent roots;
- independent detail and overview loading and failure isolation;
- adopting existing matching resource elements without duplicates;
- failed-load suppression and explicit-refresh retry;
- initial scanning and registration after DOM readiness;
- repeated registration and repeated refresh without duplicate mounts;
- detail and overview hydrators sharing one runtime;
- adding, removing, replacing, and moving roots;
- replacing required markup inside a connected root;
- one reconciliation job for a mutation burst;
- scoped refresh and scoped destruction;
- ordinary pagehide, persisted pagehide, and persisted pageshow;
- environments without `MutationObserver`;
- invalid public API arguments;
- hydrator, currentness, and destroy failures remaining isolated;
- a pre-existing incompatible `window.HexoPostMap` namespace;
- the minified `runtime.js` size limit and absence of provider code.

Existing detail, overview, AMap ownership, cancellation, and provider-loader suites must remain green.

### 11.2 Browser tests

Create a deterministic PJAX fixture that changes main content without full document navigation:

```text
ordinary page
  -> mapped detail page
  -> second mapped detail page
  -> overview page
  -> ordinary page
```

The fixture must verify:

- the initial ordinary page contains `runtime.js` but requests no map feature or AMap resource;
- each inserted map mounts once;
- removed controllers and listeners are destroyed;
- each local feature resource and the AMap SDK/provider are not loaded twice;
- a late SDK or fetch completion cannot revive an old page;
- detail marker tooltips, overview panels, keyboard behavior, and fallbacks still work;
- browser back/forward and existing BFCache coverage do not regress;
- a theme-triggered manual refresh works when automatic observation is disabled.

### 11.3 Integration matrix

The packed-artifact integration matrix remains required. It verifies that every enabled HTML page contains one runtime script, ordinary pages contain no eager map feature resources, mapped pages still render their fallback markup, all five asset routes are packaged, and root plus `/blog/` URLs resolve correctly. Add or extend fixtures for a conventional theme, a synthetic PJAX theme, theme page-layout fallback, and a non-root Hexo deployment. The real blog is validated locally at `127.0.0.1`, never `localhost`.

## 12. Documentation and Release

Update both READMEs and the configuration or compatibility documentation to cover:

- the small site-wide runtime and lazy local-resource loading model;
- automatic behavior for conventional PJAX content replacement;
- the `apiVersion`, `refresh`, and `destroy` contract;
- a minimal manual integration snippet;
- lifecycle limitations and unsupported theme patterns;
- troubleshooting duplicate SDKs and malformed theme transitions.

Release only after:

1. formatting, linting, type checking, unit tests, and build pass;
2. the packed-artifact integration matrix passes;
3. deterministic Chromium tests pass;
4. the packed development artifact is installed into the real blog;
5. initial load, PJAX simulation, detail maps, overview maps, and fallbacks are verified locally;
6. the public README matches shipped behavior.

The real blog consumes the packed development artifact before npm publication. After acceptance, the normal pull request, CI, Release Please, GitHub Release, npm trusted publishing, registry verification, and blog dependency update flow applies.

## 13. Acceptance Criteria

- A detail or overview root inserted after initial page load becomes functional without reloading the document.
- Starting from an ordinary page works because that page already has the lightweight runtime and no eager map dependencies.
- Ordinary pages do not load the stylesheet, detail bundle, overview bundle, overview JSON, or AMap SDK.
- Each local feature resource is requested at most once after success; explicit refresh is the only automatic-contract path that retries a failed resource load.
- Removing that root destroys its controller and owned resources exactly once.
- Moving the same root within the document does not recreate its map.
- Replacing required inner markup recreates the affected map exactly once.
- Repeated automatic and manual refreshes never duplicate maps, controls, panels, observers, or listeners.
- The bootstrap, detail bundle, and overview bundle share a single runtime and public API.
- Public scoped refresh and destruction work as documented.
- Ordinary navigation, BFCache restoration, failures, and no-JavaScript fallbacks retain v0.3.0 behavior.
- Existing asset filenames stay stable, the new `runtime.js` is at most 8 KiB minified, and it contains no provider code.
- No new configuration, metadata, filtering UI, or `posts.json` fields ship in v0.4.0.
- Documentation makes the compatibility boundary explicit.
