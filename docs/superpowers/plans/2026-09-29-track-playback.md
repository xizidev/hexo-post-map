# Recorded Track and Trip Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `hexo-post-map` v0.5.0 with secure local GPX/GeoJSON ingestion, privacy-first track assets, trip statistics, and accessible AMap detail-map playback while preserving every v0.4 point, overview, and PJAX contract.

**Architecture:** A server-only track compiler resolves and parses local WGS84 source files, trims privacy distances, computes statistics, simplifies to a bounded canonical asset, and gives Hexo a content-addressed route plus a browser-safe descriptor. The existing lazy detail controller fetches that asset and coordinates a provider-independent playback controller; the AMap adapter alone batches WGS84-to-GCJ-02 conversion and owns track overlays. Point-only and overview paths remain unaware of source files and recorded-track payloads.

**Tech Stack:** TypeScript 6, Zod 4, Node.js 20 filesystem/crypto APIs, `saxes` XML parser bundled by esbuild, Hexo 7/8, Vitest 3 with Happy DOM, Playwright Chromium, AMap JS API 2.0.

**Spec:** `docs/superpowers/specs/2026-09-29-track-playback-design.md`

## Global Constraints

- Existing authored `points` stay required, GCJ-02, and byte-for-byte unconverted by the domain layer.
- GPX and GeoJSON track coordinates are WGS84; only the AMap adapter converts them.
- Track sources are local relative files under canonical Hexo `source_dir`; remote URLs, traversal, symlink escape, non-files, and unsupported extensions fail the build.
- Maximum source size is 8 MiB; maximum raw point count is 200,000; maximum published point count is 2,000.
- Privacy trimming happens before statistics, simplification, hashing, HTML, and asset publication.
- Generated HTML/assets never contain a local source path, source filename, absolute timestamp, arbitrary GeoJSON property, or GPX metadata.
- Hashed assets use `hexo-post-map/tracks/<64-lowercase-hex>.json`; identical processed bytes deduplicate.
- Track loading stays detail-only, intersection-lazy, abortable, same-origin, PJAX-safe, and absent from `runtime.js`, `overview-map.js`, and overview `posts.json`.
- Playback never autostarts; continuous motion is disabled under reduced motion while native manual seeking remains available.
- Track fetch/conversion failure degrades to the existing point map and schematic route; provider failure retains the existing full fallback.
- Node.js remains `>=20`, Hexo remains `>=7 <9`, and `runtime.js` remains provider-free and at most 8,192 bytes.

## Review Focus

- A lexically safe path whose symlink target escapes `source_dir` must fail before any bytes are parsed; Task 2 pins this with a real symlink test.
- Partial or non-monotonic timestamp/elevation data must omit the affected statistic instead of publishing a plausible but incomplete value; Task 3 pins all partial-data combinations.
- Thousands of tiny segments must not evade the 2,000-point cap or lose segment endpoints; Task 3 pins both adaptive success and structurally impossible failure.
- A late fetch, conversion callback, animation frame, or provider resolution after PJAX destruction must not mutate the old or replacement root; Tasks 5–7 pin every asynchronous boundary.
- Partial AMap conversion or corrupt generated JSON must preserve pins and the schematic route without mixing WGS84 and GCJ-02; Tasks 5–7 pin browser validation and provider fallback separately.

---

### Task 1: Strict Front Matter and Server-Only Track Contract

**Files:**

- Modify: `src/domain/schema.ts`
- Modify: `src/domain/normalize.ts`
- Modify: `src/domain/types.ts`
- Create: `src/tracks/types.ts`
- Modify: `test/domain/validation.test.ts`
- Modify: `test/domain/normalize.test.ts`

**Interfaces:**

- Consumes: existing `postMapSchema`, `NormalizedPostMap`, `PostMapValidationError`.
- Produces: `NormalizedTrackReference`, `NormalizedPostMapDocument`, and `normalizePostMapDocument(raw, sourcePath): NormalizedPostMapDocument | null`; existing `normalizePostMap(raw, sourcePath): NormalizedPostMap | null` remains browser-safe and compatible.

- [ ] **Step 1: Add failing schema and normalization tests**

  Cover the exact defaults `{ trimStartMeters: 0, trimEndMeters: 0, simplifyToleranceMeters: 5, playback: true }`, explicit values, case-insensitive supported suffixes, empty/absolute/URL/NUL source rejection, finite non-negative trims, tolerance range `[0, 10000]`, unknown nested keys, and equality of point-only `normalizePostMap` output before and after the schema extension. Assert `normalizePostMap` never exposes `track`.

- [ ] **Step 2: Run the focused tests and verify red**

  Run: `env npm_config_cache=/tmp/hexo-post-map-v05-npm-cache npm run test:run -- test/domain/validation.test.ts test/domain/normalize.test.ts`

  Expected: FAIL because `track` is currently an unrecognized key and the document normalizer does not exist.

- [ ] **Step 3: Implement the strict schema and normalized types**

  Add the optional strict `track`, `privacy`, `simplify_tolerance_meters`, and `playback` schemas. Define:

  ```ts
  export interface NormalizedTrackReference {
    readonly source: string;
    readonly privacy: {
      readonly trimStartMeters: number;
      readonly trimEndMeters: number;
    };
    readonly simplifyToleranceMeters: number;
    readonly playback: boolean;
  }

  export interface NormalizedPostMapDocument {
    readonly map: NormalizedPostMap;
    readonly track?: NormalizedTrackReference;
  }
  ```

  Refactor the current geometry normalization into `normalizePostMapDocument`; make `normalizePostMap` return only `.map`, and deep-freeze both results. Keep all existing field paths and safe validation errors.

- [ ] **Step 4: Run focused tests and domain regression tests**

  Run: `env npm_config_cache=/tmp/hexo-post-map-v05-npm-cache npm run test:run -- test/domain`

  Expected: all domain tests pass.

- [ ] **Step 5: Commit the normalized authoring contract**

  ```bash
  git add src/domain/schema.ts src/domain/normalize.ts src/domain/types.ts src/tracks/types.ts test/domain/validation.test.ts test/domain/normalize.test.ts
  git commit -m "feat: validate recorded track front matter"
  ```

### Task 2: Secure Source Resolution and Format Parsers

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/tracks/types.ts`
- Create: `src/tracks/errors.ts`
- Create: `src/tracks/source.ts`
- Create: `src/tracks/gpx.ts`
- Create: `src/tracks/geojson.ts`
- Create: `src/tracks/parse.ts`
- Create: `test/tracks/source.test.ts`
- Create: `test/tracks/gpx.test.ts`
- Create: `test/tracks/geojson.test.ts`

**Interfaces:**

- Consumes: `NormalizedTrackReference` from Task 1.
- Produces: `RawTrackPoint`, `RawTrack`, `TrackSourceFile`, `TrackBuildError`, `readTrackSource(sourceDir, postSource, source): TrackSourceFile`, `parseGpx(bytes): RawTrack`, `parseGeoJson(bytes): RawTrack`, and `parseTrackSource(file): RawTrack`.

- [ ] **Step 1: Add the XML parser dependency**

  Run: `npm install --save-dev saxes --cache /tmp/hexo-post-map-v05-npm-cache`

  Expected: `saxes` and its lockfile entry are added as a development dependency that esbuild can bundle into `dist/index.cjs`; no runtime package dependency is introduced.

- [ ] **Step 2: Write failing filesystem-boundary tests**

  In a temporary source tree, assert relative resolution beside `_posts/trip.md`, regular `.gpx`/`.geojson`/`.json` acceptance, and rejection of HTTP(S), protocol-relative, absolute, NUL, lexical traversal, extension mismatch, missing paths, directories, FIFO/non-regular files where supported, a real symlink escaping the canonical source root, and a sparse file over exactly 8 MiB. Error messages must name the article/field without including file bytes.

- [ ] **Step 3: Implement `readTrackSource` and verify its tests**

  Canonicalize the source root, validate the lexical path before `realpath`, enforce path-segment containment after `realpath`, use `lstat`/`stat` to require a regular file, check size before `readFile`, and return `{ format: 'gpx' | 'geojson', bytes, canonicalPath, fingerprint }` only to the server compiler.

  Run: `env npm_config_cache=/tmp/hexo-post-map-v05-npm-cache npm run test:run -- test/tracks/source.test.ts`

  Expected: all resolver tests pass, including the symlink escape review-focus case.

- [ ] **Step 4: Write failing GPX parser tests**

  Cover the GPX 1.1 namespace, a prefixed namespace, multiple `trk`/`trkseg`, optional complete elevation/time, ignored metadata/extensions/waypoints/routes, UTF-8 input, DTD/entity rejection, malformed XML, missing/malformed/out-of-range coordinates, malformed present `ele`/`time`, fewer than two distinct usable points, and the 200,001st point failing during parse.

- [ ] **Step 5: Implement `parseGpx` with `saxes` and verify it**

  Keep a small element-state machine keyed by namespace-local names, reject `doctype`, never resolve resources, count points as they close, parse RFC 3339 time into milliseconds, discard empty segments, and pass the shared raw-track validator.

  Run: `env npm_config_cache=/tmp/hexo-post-map-v05-npm-cache npm run test:run -- test/tracks/gpx.test.ts`

  Expected: all GPX tests pass.

- [ ] **Step 6: Write failing GeoJSON parser tests**

  Cover direct `LineString`/`MultiLineString`, feature, feature collection, nested geometry collection, order and segment boundaries, optional elevation, ignored extra dimensions/properties/non-line/null geometries, invalid JSON/root/type/coordinate values, no usable line, fewer than two distinct usable points, and the 200,001st point.

- [ ] **Step 7: Implement `parseGeoJson` and the format dispatcher**

  Walk only standard GeoJSON container members, copy only finite coordinate/elevation values, enforce limits while walking, validate the resulting raw track, and dispatch by the already validated file format.

  Run: `env npm_config_cache=/tmp/hexo-post-map-v05-npm-cache npm run test:run -- test/tracks`

  Expected: all source and parser tests pass.

- [ ] **Step 8: Commit secure ingestion**

  ```bash
  git add package.json package-lock.json src/tracks test/tracks
  git commit -m "feat: securely parse local track files"
  ```

### Task 3: Privacy Processing, Statistics, Simplification, and Hashing

**Files:**

- Create: `src/tracks/geo.ts`
- Modify: `src/tracks/types.ts`
- Create: `src/tracks/privacy.ts`
- Create: `src/tracks/statistics.ts`
- Create: `src/tracks/simplify.ts`
- Create: `src/tracks/asset.ts`
- Create: `src/tracks/compiler.ts`
- Create: `test/tracks/privacy.test.ts`
- Create: `test/tracks/statistics.test.ts`
- Create: `test/tracks/simplify.test.ts`
- Create: `test/tracks/compiler.test.ts`

**Interfaces:**

- Consumes: secure source/parsers from Task 2 and `NormalizedTrackReference` from Task 1.
- Produces: `TrackStats`, `PublishedTrackAsset`, `CompiledTrack`, `trimTrack(track, startMeters, endMeters): RawTrack`, `calculateTrackStats(track): TrackStats`, `simplifyTrack(track, minimumToleranceMeters, maximumPoints): PublishedTrackSegments`, and `createTrackCompiler(sourceDir): { compile(postSource, reference): CompiledTrack }`.

- [ ] **Step 1: Write failing Haversine and privacy-trim tests**

  Assert known short distances, no distance across segment gaps, zero-trim structural copy/freeze, exact start/end cuts inside edges, cuts across whole segments, interpolation of coordinate/elevation/time only when both endpoints provide optional data, preservation of segment order, and field-specific failure when trims consume the full track.

- [ ] **Step 2: Implement metre geometry and privacy trimming**

  Add finite clamping helpers, Haversine edge distance, interpolation, forward/backward segment walking, and immutable output. Never mutate parser output.

  Run: `env npm_config_cache=/tmp/hexo-post-map-v05-npm-cache npm run test:run -- test/tracks/privacy.test.ts`

  Expected: all privacy tests pass.

- [ ] **Step 3: Write failing statistics tests**

  Assert trimmed unsimplified distance, no segment-gap distance/time, complete elevation gain, complete monotonic duration, interpolation-created boundary duration, and omission for every partial elevation, missing time, decreasing time, non-finite, and mixed-segment case in the review focus.

- [ ] **Step 4: Implement deterministic statistics**

  Sum within segments only, require complete optional series before exposing it, sum segment durations, and round canonical public numbers without deriving them from simplified output.

  Run: `env npm_config_cache=/tmp/hexo-post-map-v05-npm-cache npm run test:run -- test/tracks/statistics.test.ts`

  Expected: all statistics tests pass.

- [ ] **Step 5: Write failing simplification tests**

  Assert RDP keeps each segment's first/last point, retains visible bends above tolerance, drops collinear noise, preserves optional values on retained source points, uses the requested minimum tolerance, deterministically raises tolerance to fit 2,000 points, and rejects 1,001 two-point segments because endpoints alone exceed the cap.

- [ ] **Step 6: Implement per-segment RDP and adaptive cap**

  Use a metre projection local to each segment, deterministic tie-breaking, one shared adaptive tolerance, and immutable segments. Do not merge segments or synthesize post-simplification statistics.

  Run: `env npm_config_cache=/tmp/hexo-post-map-v05-npm-cache npm run test:run -- test/tracks/simplify.test.ts`

  Expected: all simplification tests pass, including both review-focus cap cases.

- [ ] **Step 7: Write failing compiler/hash/cache tests**

  Assert processing order by proving trimmed coordinates never occur in the asset/statistics, the exact version-1 key order, finite stable precision, 64-character SHA-256 route, identical-output deduplication, option changes that alter public bytes changing the digest, no source path/name/timestamp/property in serialized bytes, and cache invalidation when file size/mtime/fingerprint changes.

- [ ] **Step 8: Implement the compiler**

  Define:

  ```ts
  export interface CompiledTrack {
    readonly routePath: `hexo-post-map/tracks/${string}.json`;
    readonly serialized: string;
    readonly asset: PublishedTrackAsset;
    readonly stats: TrackStats;
    readonly playback: boolean;
  }
  ```

  Compile in the spec order, construct fixed-order JSON before hashing, and use an internal source-fingerprint/options cache that never appears in browser output.

  Run: `env npm_config_cache=/tmp/hexo-post-map-v05-npm-cache npm run test:run -- test/tracks`

  Expected: all track compiler tests pass.

- [ ] **Step 9: Commit the privacy-first compiler**

  ```bash
  git add src/tracks test/tracks
  git commit -m "feat: compile privacy-safe track assets"
  ```

### Task 4: Hexo Routes, Safe Detail Descriptor, and Server-Rendered Statistics

**Files:**

- Modify: `src/hexo/register.ts`
- Modify: `src/hexo/post-filter.ts`
- Modify: `src/hexo/generator.ts`
- Modify: `src/templates/detail.ts`
- Create: `src/presentation/track.ts`
- Modify: `test/hexo/post-filter.test.ts`
- Modify: `test/hexo/generator.test.ts`
- Modify: `test/browser/detail.test.ts`
- Create: `test/presentation/track.test.ts`
- Modify: `test/package-smoke.test.ts`

**Interfaces:**

- Consumes: `normalizePostMapDocument` and `createTrackCompiler` from Tasks 1–3.
- Produces: browser-safe `DetailTrackDescriptor { url, stats, playback }`, `formatTrackStats(stats)`, hashed Hexo routes, and detail HTML with visible statistics plus initially hidden playback controls.

- [ ] **Step 1: Write failing formatter and detail-template tests**

  Assert metre/kilometre, minute/hour, optional elevation/duration formatting; semantic `<dl>` output; root-aware descriptor URL; hidden play/pause, restart, and labelled range controls; no source path/filename/timestamp; escaped JSON safety; point-only markup retaining its existing map/fallback behavior; and statistics remaining visible without JavaScript.

- [ ] **Step 2: Implement statistic formatting and safe tracked detail markup**

  Extend `DetailTemplateModel` with an optional compiled browser descriptor, serialize only URL/statistics/playback, use `hidden` for controls, and keep the existing place fallback and status region.

  Run: `env npm_config_cache=/tmp/hexo-post-map-v05-npm-cache npm run test:run -- test/presentation/track.test.ts test/browser/detail.test.ts`

  Expected: formatter/template tests pass; controller tests may remain red only where they now expect track behavior.

- [ ] **Step 3: Write failing filter/generator tests**

  Assert the shared compiler receives `hexo.source_dir` and article-relative source, tracked detail HTML gets the digest URL under `/` and `/blog/`, overview `posts.json` stays exactly version 1 without track data, track routes exist when overview is enabled or disabled, identical bytes deduplicate, point-only sites add no track routes, and the source file is neither routed nor packed.

- [ ] **Step 4: Wire the shared compiler through registration, filter, and generator**

  Create one fingerprint-aware compiler per plugin registration. Use `normalizePostMapDocument` in server callers. Compile tracked detail models only when detail maps are enabled; scan every post present in generator locals for necessary track assets independently of overview publication filtering; return deduplicated string routes after the stable browser assets/data routes.

  Run: `env npm_config_cache=/tmp/hexo-post-map-v05-npm-cache npm run test:run -- test/hexo/post-filter.test.ts test/hexo/generator.test.ts test/package-smoke.test.ts`

  Expected: all focused Hexo/package tests pass.

- [ ] **Step 5: Commit static track publication**

  ```bash
  git add src/hexo src/templates/detail.ts src/presentation/track.ts test/hexo test/browser/detail.test.ts test/presentation/track.test.ts test/package-smoke.test.ts
  git commit -m "feat: publish hashed article track assets"
  ```

### Task 5: Strict Lazy Track Loading and Accessible Playback Controller

**Files:**

- Modify: `src/browser/shared/config.ts`
- Modify: `src/browser/providers/types.ts`
- Create: `src/browser/detail/track-data.ts`
- Create: `src/browser/detail/playback.ts`
- Modify: `src/browser/detail/index.ts`
- Create: `test/browser/track-data.test.ts`
- Create: `test/browser/playback.test.ts`
- Modify: `test/browser/detail.test.ts`

**Interfaces:**

- Consumes: `DetailTrackDescriptor` from Task 4 and existing lazy detail hydration.
- Produces: `loadTrackAsset(url, signal, fetcher?): Promise<PublishedTrackAsset>`, `DetailMapHandle extends MapHandle`, and `createPlaybackController(root, handle, options): PlaybackController`.

- [ ] **Step 1: Write failing generated-asset validation tests**

  Accept only version `1`, `coordinateSystem: 'wgs84'`, fixed statistics, finite coordinate/elevation ranges, at least one usable segment, and at most 2,000 aggregate points. Reject redirects to another origin, non-success responses, wrong content, corrupt JSON, excessive points, non-finite/invalid statistics, and late results after abort without including URL/body in errors.

- [ ] **Step 2: Implement cancellable same-origin loading**

  Resolve the descriptor against `document.baseURI`, require its origin to match, fetch with `credentials: 'same-origin'` and the detail abort signal, parse once, and validate into a fresh immutable value.

  Run: `env npm_config_cache=/tmp/hexo-post-map-v05-npm-cache npm run test:run -- test/browser/track-data.test.ts`

  Expected: all loader/validation tests pass.

- [ ] **Step 3: Write failing playback-controller tests**

  With fake time/animation frames, assert no autoplay, play/pause, restart-from-zero, 30-second completion, slider input pausing and seeking, clamped provider progress, percentage `aria-valuetext`, no per-frame live-region writes, visibility pause, runtime reduced-motion changes hiding continuous controls but retaining the range, and destroy cancelling all listeners/frames so a late frame cannot mutate a replacement root.

- [ ] **Step 4: Implement the provider-independent playback controller**

  Add a small state machine around captured controls and `DetailMapHandle.setTrackProgress`; use one RAF at a time, use native range semantics, listen to `visibilitychange` and the reduced-motion media query, and expose idempotent `destroy()`.

  Run: `env npm_config_cache=/tmp/hexo-post-map-v05-npm-cache npm run test:run -- test/browser/playback.test.ts`

  Expected: all playback tests pass.

- [ ] **Step 5: Write failing detail-hydration integration tests**

  Assert no fetch before the existing intersection, provider and track load share one abort boundary, successful track reaches `mountDetail`, `playback: false` exposes no controls and requests display-only track rendering, fetch/validation failure mounts without track and keeps the schematic fallback model, provider failure still shows the place-list fallback, duplicate hydration makes one fetch, `isCurrent` notices replaced track controls, and destroy blocks late fetch/provider resolution.

- [ ] **Step 6: Integrate loading and playback into `hydrateDetail`**

  Extend the config reader with a strict optional descriptor; load track and provider concurrently at `start`; pass a successful asset to the provider; on track-only failure set a generic status but continue; reveal controls only when the handle reports a usable track; destroy playback before the provider handle.

  Run: `env npm_config_cache=/tmp/hexo-post-map-v05-npm-cache npm run test:run -- test/browser/detail.test.ts test/browser/track-data.test.ts test/browser/playback.test.ts`

  Expected: all focused detail tests pass.

- [ ] **Step 7: Commit lazy playback orchestration**

  ```bash
  git add src/browser/shared/config.ts src/browser/providers/types.ts src/browser/detail test/browser/detail.test.ts test/browser/track-data.test.ts test/browser/playback.test.ts
  git commit -m "feat: load and control article track playback"
  ```

### Task 6: AMap Conversion, Track Overlays, and Progress Geometry

**Files:**

- Create: `src/browser/providers/amap-track.ts`
- Modify: `src/browser/providers/amap.ts`
- Create: `test/browser/amap-track.test.ts`
- Modify: `test/browser/amap.test.ts`
- Modify: `test/browser/amap-ownership.test.ts`
- Modify: `e2e/fake-sdk.ts`

**Interfaces:**

- Consumes: `PublishedTrackAsset`, `DetailMapModel.track`, `DetailMapHandle`, and existing AMap ownership/timeout rules.
- Produces: `convertTrackFromGps(api, track, signal): Promise<ConvertedTrack>`, `createTrackProgressGeometry(track)`, and an AMap detail handle with `hasTrack` plus `setTrackProgress(progress)`.

- [ ] **Step 1: Write failing conversion tests**

  Assert exact batches of 40/40/remainder, one-point remainder support, order/segment reconstruction, both array-like and `LngLat#getLng/getLat` result normalization, abort before/during conversion, 20-second timeout, thrown callback setup, status failure, missing/partial/wrong-length locations, and no late callback settlement after cancellation.

- [ ] **Step 2: Implement isolated official conversion**

  Flatten with segment offsets, call `AMap.convertFrom(batch, 'gps', callback)` sequentially or with bounded deterministic ordering, validate every converted GCJ-02 coordinate, rebuild segments only after all batches succeed, and remove abort/timeout state on every terminal path.

  Run: `env npm_config_cache=/tmp/hexo-post-map-v05-npm-cache npm run test:run -- test/browser/amap-track.test.ts`

  Expected: all conversion tests pass.

- [ ] **Step 3: Write failing progress-geometry tests**

  Assert progress `0`, exact vertex fractions, interpolation inside an edge, multiple segments without drawing their gaps, progress `1`, non-finite/clamped input, zero-length duplicate points, and correct moving-marker coordinate.

- [ ] **Step 4: Implement cumulative-distance progress geometry**

  Precompute per-edge and total distances once over converted coordinates; return per-segment traveled paths plus current coordinate without joining segments.

  Run: `env npm_config_cache=/tmp/hexo-post-map-v05-npm-cache npm run test:run -- test/browser/amap-track.test.ts`

  Expected: conversion and geometry tests pass.

- [ ] **Step 5: Write failing AMap adapter tests**

  Assert successful conversion omits the schematic route, creates muted full polylines per segment, adds accent progress polylines and a moving marker only when playback is enabled, keeps numbered point pins, includes track overlays in fit view, updates existing polylines/marker without map recreation, starts at zero for playback, leaves only the full muted line for display-only mode, and destroys cleanly. Assert any conversion failure invokes `onTrackError` once and mounts the original schematic route with no WGS84 overlay.

- [ ] **Step 6: Integrate track rendering with the existing detail adapter**

  Convert before adding track overlays, extend local AMap structural types only with used APIs, read route/progress colors from detail CSS variables, use a non-interactive marker, expose the typed handle, and preserve all SDK ownership and point-tooltip cleanup behavior.

  Run: `env npm_config_cache=/tmp/hexo-post-map-v05-npm-cache npm run test:run -- test/browser/amap-track.test.ts test/browser/amap.test.ts test/browser/amap-ownership.test.ts`

  Expected: all provider tests pass.

- [ ] **Step 7: Extend the fake SDK and commit the adapter**

  Teach the E2E fake SDK to record conversion batches, polyline updates, marker positions, and destroyed track state without changing production adapter behavior.

  ```bash
  git add src/browser/providers test/browser/amap-track.test.ts test/browser/amap.test.ts test/browser/amap-ownership.test.ts e2e/fake-sdk.ts
  git commit -m "feat: render recorded tracks with amap"
  ```

### Task 7: Responsive Styling, End-to-End Playback, and PJAX Safety

**Files:**

- Modify: `src/browser/styles/index.css`
- Modify: `e2e/fixtures.ts`
- Create: `e2e/track-playback.spec.ts`
- Modify: `e2e/pjax-runtime.spec.ts`
- Modify: `e2e/accessibility.spec.ts`
- Modify: `e2e/amap-smoke.spec.ts`

**Interfaces:**

- Consumes: tracked detail markup, playback controller, and fake/real AMap adapters from Tasks 4–6.
- Produces: responsive statistics/controls, dark/light theme variables, and browser-level evidence for lazy loading, accessibility, fallback, reduced motion, and navigation cleanup.

- [ ] **Step 1: Add tracked E2E fixtures and failing behavior tests**

  Add a deterministic hashed JSON route fixture with multiple WGS84 segments and statistics. Assert zero track requests on ordinary/overview/offscreen pages, one request near the detail viewport, conversion batches, pins plus real track and no schematic line, no autoplay, play/pause/restart/seek, complete progress, `playback: false`, generic corrupt/fetch/conversion fallback, and no source metadata in page/asset text.

- [ ] **Step 2: Add failing motion, keyboard, and responsive tests**

  Assert native slider Arrow/Home/End seeking, labelled buttons/value text, tab order, visible focus, no live-region frame spam, reduced-motion manual seek without RAF playback, controls fitting at 320 px, usable light/dark contrast, and statistics remaining visible when scripts are blocked.

- [ ] **Step 3: Implement scoped track styles**

  Add `.hpm-track-stats`, `.hpm-track-controls`, icon/button/range/focus styles and `--hpm-track-color`/`--hpm-track-progress-color` variables under `.hpm-detail`; use flexible wrapping and theme-safe colors; avoid global element selectors and layout changes to point-only maps.

- [ ] **Step 4: Add PJAX/BFCache destruction tests**

  Replace/remove a tracked root during pending fetch, conversion, playback, and after mount. Assert abort/destruction exactly once, no late mutation/request duplication, a replacement root mounts independently, and persisted page lifecycle preserves valid playback state without autoplay.

- [ ] **Step 5: Run the Chromium detail/runtime suite**

  Run: `env npm_config_cache=/tmp/hexo-post-map-v05-npm-cache npm run build`

  Run: `env npm_config_cache=/tmp/hexo-post-map-v05-npm-cache npx playwright test --project=chromium e2e/track-playback.spec.ts e2e/pjax-runtime.spec.ts e2e/accessibility.spec.ts e2e/detail-map.spec.ts`

  Expected: all selected Chromium tests pass; runtime remains at most 8,192 bytes.

- [ ] **Step 6: Keep the optional live smoke additive**

  Extend only credential-gated AMap smoke assertions needed to prove a converted track can mount. Missing credentials must keep the suite skipped rather than failed; offline correctness remains covered by the fake SDK.

- [ ] **Step 7: Commit the complete browser experience**

  ```bash
  git add src/browser/styles/index.css e2e
  git commit -m "feat: finish accessible track playback experience"
  ```

### Task 8: Documentation, Packed Compatibility, and Release-Ready Verification

**Files:**

- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/front-matter.md`
- Modify: `docs/configuration.md`
- Modify: `docs/security.md`
- Modify: `docs/compatibility.md`
- Modify: `docs/releases.md`
- Modify: `test/docs/examples.test.ts`
- Modify: `test/integration/generated-output.test.ts`
- Modify: `test/integration/pack-and-build.mjs`
- Modify: `test/integration/real-blog-smoke.mjs`
- Add fixtures only under: `test/integration/fixtures/track/**`

**Interfaces:**

- Consumes: the complete v0.5 feature and public contracts from Tasks 1–7.
- Produces: copy-paste-verified bilingual documentation, packed Node/Hexo evidence, and temporary-copy real-blog smoke without modifying the user's blog.

- [ ] **Step 1: Write failing documentation example tests**

  Extract and validate point-only, GPX, GeoJSON, privacy, playback-disabled, root/subpath, and AMap key/security examples from both READMEs and focused docs. Assert both languages state WGS84 tracks versus GCJ-02 points, local-only path resolution, exact limits/defaults, trim-before-statistics order, non-anonymization warning, reduced-motion behavior, and unchanged `_config.yml` AMap deployment.

- [ ] **Step 2: Update bilingual user and security documentation**

  Document supported schemas, examples, statistics availability, hashed assets, CDN/cache behavior, fallback, overview isolation, source containment, parser limits, privacy limitations, compatibility, and the v0.5 release boundary. Keep English and Chinese examples structurally equivalent.

  Run: `env npm_config_cache=/tmp/hexo-post-map-v05-npm-cache npm run test:run -- test/docs/examples.test.ts`

  Expected: documentation tests pass.

- [ ] **Step 3: Add generated-output and packed-matrix track fixtures**

  Build a temporary Hexo site containing GPX and GeoJSON posts. Assert safe detail descriptors, readable hashed assets, no raw source/timestamps/properties, no track data in `posts.json`, point-only compatibility, root/subpath URLs, and successful plugin installation/build across every supported Node/Hexo pair.

- [ ] **Step 4: Extend real-blog smoke only through temporary copies**

  Add a generated temporary track/article inside the smoke workspace, never the source blog. Verify `/` and `/blog/` builds, published track readability, no secret/path leakage, `127.0.0.1` preview compatibility, and cleanup on success/failure/SIGTERM.

- [ ] **Step 5: Run formatting and the complete unit/build gate**

  Run: `npx prettier --write README.md README.zh-CN.md docs src test e2e`

  Run: `env npm_config_cache=/tmp/hexo-post-map-v05-npm-cache npm run check`

  Expected: formatting, lint, typecheck, all non-gated tests, and all bundle guards pass.

- [ ] **Step 6: Run complete Chromium and packed integration gates**

  Run: `env npm_config_cache=/tmp/hexo-post-map-v05-npm-cache npm run test:e2e`

  Run: `env npm_config_cache=/tmp/hexo-post-map-v05-npm-cache npm run test:integration`

  Expected: all Chromium and supported Node/Hexo matrix cases pass; only explicitly credential-gated live smoke may skip.

- [ ] **Step 7: Inspect the publish artifact and repository scope**

  Run: `env npm_config_cache=/tmp/hexo-post-map-v05-npm-cache npm pack --json --dry-run --ignore-scripts`

  Run: `git diff --check && git status --short && git diff --stat origin/main...HEAD`

  Expected: tarball contains only compiled assets, readmes, license, and package metadata; no source track, local path, report, cache, or real-blog modification appears.

- [ ] **Step 8: Commit documentation and release evidence**

  ```bash
  git add README.md README.zh-CN.md docs test/integration test/docs/examples.test.ts
  git commit -m "docs: document recorded track playback"
  ```

- [ ] **Step 9: Request an independent whole-branch review and apply verified fixes**

  Use `superpowers:requesting-code-review` against `origin/main...HEAD`. Reproduce every actionable finding with a failing test before changing code, rerun the owning focused suite after each fix, and finish by rerunning Steps 5–7. Do not publish npm or create/merge a PR without a later explicit user request.
