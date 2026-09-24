# PJAX-Compatible Browser Runtime Design

Date: 2026-09-24

Status: approved in conversation; pending written-spec review

Target release: `hexo-post-map` v0.4.0

Baseline: v0.3.0 (`e8d46c5ea3fe936cb4104c0a5563d456af4b975a`)

## 1. Summary

Version 0.4.0 makes the existing detail and overview maps survive conventional client-side navigation without requiring theme-specific plugin code. It introduces a shared browser runtime that discovers map roots, mounts each root exactly once, destroys controllers when their roots leave the document, and exposes a small manual lifecycle API for themes whose navigation cannot be detected generically.

This is a compatibility-only release. It does not add filters, search, taxonomy metadata, URL query state, new map controls, or a new provider. The rendered appearance, Front Matter contract, `posts.json` version, and AMap behavior remain unchanged.

## 2. Context

The v0.3.0 browser bundles initialize themselves once at script evaluation or `DOMContentLoaded`. Detail and overview controllers are individually idempotent and already handle asynchronous cancellation, AMap ownership, ordinary `pagehide`, and BFCache preservation. These protections are sufficient for full document navigation but do not discover map markup inserted later by PJAX, partial rendering, or a client-side theme router.

The new runtime must reuse those protections rather than duplicate provider or map behavior. It owns page-level discovery and lifecycle coordination; detail controllers, overview controllers, panels, markers, and the AMap provider continue to own their existing local behavior.

## 3. Goals

- Automatically mount detail and overview maps inserted after initial page load.
- Destroy controllers whose map roots have actually left the current document.
- Preserve controllers when a theme merely moves an existing root within the document.
- Recover when a theme replaces required markup inside an existing map root.
- Keep initial-load, ordinary navigation, and BFCache behavior correct.
- Provide a minimal, versioned manual API for unusual theme navigation.
- Share one runtime across the detail and overview IIFE bundles.
- Keep lifecycle work idempotent under repeated scans and rapid DOM replacement.
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

## 5. Architecture

The page-level flow becomes:

```text
generated map markup
        |
        v
BrowserRuntime singleton
        |
        +-- detail hydrator ------> detail controller ------> AMap provider
        |
        +-- overview hydrator ----> overview controller ----> AMap provider
```

### 5.1 Runtime ownership

The runtime is stored under `Symbol.for('hexo-post-map.browser-runtime.v1')` on `window`. Both browser bundles import the same runtime module and receive the same page-level instance, even when both bundles are present.

The runtime owns:

- registered hydrator definitions;
- an iterable registry of active roots and their controllers;
- the mutation observer and its queued reconciliation job;
- the global `pagehide` and `pageshow` listeners;
- the public lifecycle API object.

It does not own AMap loading, post data, markers, panels, or map interactions.

### 5.2 Hydrator contract

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

### 5.3 Bundle integration

The detail bundle registers the detail hydrator. The overview bundle registers the overview hydrator. Registering a hydrator starts the runtime when necessary and immediately schedules a scan of the current document.

The existing direct `DOMContentLoaded` initialization blocks are replaced by runtime registration. If the document body is not yet available, the runtime waits for `DOMContentLoaded` before observing and scanning.

Loading both bundles must not create two observers, two public API objects, or duplicate global navigation listeners.

## 6. Reconciliation Algorithm

### 6.1 Initial scan

The runtime scans the document once after a hydrator is registered and the DOM is ready. A candidate root mounts only when it is connected, matches a registered selector, and has no active current controller.

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
4. Mount newly connected roots once.

Because cleanup observes the final state, a root removed and reinserted during the same DOM update remains mounted. Replacing a root with a new element destroys the old controller and mounts the new root. Replacing the required canvas or configuration element inside the same root causes one controlled remount.

### 6.3 Failure isolation

Failure in one hydrator, controller currentness check, or controller destruction must not stop reconciliation for other roots. Runtime-level diagnostics must be generic and must not include serialized configuration, credentials, provider errors, or article data.

Feature controllers remain responsible for showing the existing user-facing fallback and status text when their own configuration, data fetch, provider load, or mount fails.

## 7. Public Lifecycle API

When either browser bundle loads, the plugin exposes one frozen object:

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
- Starts asynchronous feature hydration but does not wait for the AMap SDK; it returns `void`.

### 7.2 `destroy(scope?)`

- Defaults to `document` and destroys all active map controllers.
- With a scope, destroys controllers whose roots are the scope or descendants of it.
- Is safe to call repeatedly.
- Does not delete generated HTML, reset an AMap SDK owned by another component, or alter plugin configuration.
- A still-connected destroyed root becomes eligible for a later explicit or automatic refresh.

### 7.3 Namespace safety

The internal symbol remains the source of truth. The first plugin bundle defines a non-enumerable, non-writable, non-configurable `window.HexoPostMap` property containing the frozen API object; the second reuses the exact same object. If an unrelated script already owns that global name, the plugin does not overwrite it. Automatic lifecycle support continues through the internal runtime and the plugin emits one generic `console.warn` stating that the manual API could not be exposed. The warning does not include sensitive data.

Invalid explicit API arguments throw a synchronous `TypeError` so theme authors receive a clear integration failure. Automatic runtime work catches its own errors and does not throw into theme code.

## 8. Navigation and BFCache

PJAX and partial navigation are handled through final DOM state, not through assumptions about a particular router.

- A conventional replacement of the article or main-content container is detected automatically.
- A theme with unusual rendering timing calls `window.HexoPostMap.refresh(container)` after it commits new content.
- A theme may call `destroy(container)` before removing old content, but automatic disconnected-root cleanup remains the default path.
- Ordinary `pagehide` destroys all controllers and cancels pending feature work.
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
- generated route and asset filenames;
- detail and overview appearance and interaction;
- server-rendered fallbacks;
- Node.js and Hexo support ranges;
- GCJ-02 coordinates and AMap-only provider support.

No theme integration is required when navigation replaces ordinary DOM subtrees. Themes that reuse unusual shadow roots, render map markup outside the observed document, or mutate structures in a way the generic observer cannot recognize must call the documented API or remain outside the compatibility guarantee.

## 11. Testing Strategy

### 11.1 Unit tests

Add focused runtime tests for:

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
- a pre-existing incompatible `window.HexoPostMap` namespace.

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

- each inserted map mounts once;
- removed controllers and listeners are destroyed;
- the AMap SDK/provider is not loaded twice;
- a late SDK or fetch completion cannot revive an old page;
- detail marker tooltips, overview panels, keyboard behavior, and fallbacks still work;
- browser back/forward and existing BFCache coverage do not regress;
- a theme-triggered manual refresh works when automatic observation is disabled.

### 11.3 Integration matrix

The packed-artifact integration matrix remains required. Add or extend fixtures for a conventional theme, a synthetic PJAX theme, theme page-layout fallback, and a non-root Hexo deployment. The real blog is validated locally at `127.0.0.1`, never `localhost`.

## 12. Documentation and Release

Update both READMEs and the configuration or compatibility documentation to cover:

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
- Removing that root destroys its controller and owned resources exactly once.
- Moving the same root within the document does not recreate its map.
- Replacing required inner markup recreates the affected map exactly once.
- Repeated automatic and manual refreshes never duplicate maps, controls, panels, observers, or listeners.
- Detail and overview bundles share a single runtime and public API.
- Public scoped refresh and destruction work as documented.
- Ordinary navigation, BFCache restoration, failures, and no-JavaScript fallbacks retain v0.3.0 behavior.
- No new configuration, metadata, filtering UI, or `posts.json` fields ship in v0.4.0.
- Documentation makes the compatibility boundary explicit.
