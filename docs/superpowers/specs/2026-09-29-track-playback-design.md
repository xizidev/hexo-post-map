# Recorded Track and Trip Playback Design

Date: 2026-09-29

Status: approved 2026-09-29

Target release: `hexo-post-map` v0.5.0

Baseline: v0.4.0 (`a72582c28e6ce146331e8531e17cd250a03300a0`)

## 1. Summary

Version 0.5.0 adds optional recorded tracks to an article map. Authors keep the existing required GCJ-02 place points and may additionally reference a local GPX or GeoJSON file. During Hexo generation, the plugin validates that file, removes configured distances from its beginning and end, computes trip statistics, simplifies the geometry to a bounded browser payload, and publishes a content-addressed JSON asset. The detail map lazily loads that asset, converts its WGS84 coordinates through AMap's official conversion API, and renders an accessible, non-autoplaying trip playback.

This is an additive detail-map feature. Existing point-only articles, schematic routes, overview maps, PJAX lifecycle behavior, generated `posts.json`, configuration, and provider ownership remain compatible. The national overview continues to use only the representative GCJ-02 point and never loads recorded tracks.

## 2. Goals

- Accept local `.gpx`, `.geojson`, and GeoJSON `.json` track files from article Front Matter.
- Keep the current `points` contract required and backward compatible.
- Preserve the existing meaning of authored point coordinates as GCJ-02.
- Interpret GPX and GeoJSON track coordinates as WGS84.
- Prevent track paths, symlinks, remote URLs, or oversized input from escaping the Hexo source tree or exhausting a build.
- Remove privacy-sensitive start and end distances before deriving any published geometry or statistic.
- Publish no more than 2,000 track points in a deterministic, hashed, cacheable JSON asset.
- Show distance, cumulative elevation gain, and recorded duration when the source has enough valid data.
- Replace the schematic straight route line with the recorded track after that track loads successfully, while preserving article place pins and visit order.
- Provide play, pause, restart, and native keyboard seeking without autoplay.
- Respect `prefers-reduced-motion` by disabling continuous playback while retaining manual seeking.
- Degrade a missing, malformed, unconvertible, or unfetchable browser track to the existing point map and schematic route rather than losing the whole detail map.
- Keep track resources lazy, cancellable, PJAX-safe, and absent from overview-map traffic.
- Document the feature in English and Chinese with its security and privacy boundaries.

## 3. Non-goals

- Navigation, turn-by-turn directions, route planning, or road snapping.
- Remote GPX/GeoJSON URLs or runtime parsing of source formats in the browser.
- Heatmaps, altitude charts, speed charts, workout analysis, or live GPS recording.
- Track filtering on the national overview.
- A track editor, file uploader, or Hexo administration UI.
- MapLibre or another provider; that remains a later release concern.
- Exact anonymization guarantees. Distance trimming reduces disclosure but cannot make a public route anonymous by itself.
- Preserving or publishing source filenames, filesystem paths, absolute timestamps, GPX metadata, extensions, waypoints, or non-line GeoJSON properties.

## 4. Authoring Contract

### 4.1 Front Matter

The existing strict `map` object accepts one new optional `track` property:

```yaml
map:
  representative: station
  points:
    - id: station
      name: 南京站
      longitude: 118.7977
      latitude: 32.0872
  track:
    source: ./tracks/nanjing.gpx
    privacy:
      trim_start_meters: 300
      trim_end_meters: 300
    simplify_tolerance_meters: 5
    playback: true
```

Its normalized contract is:

```ts
interface NormalizedTrackReference {
  readonly source: string;
  readonly privacy: {
    readonly trimStartMeters: number;
    readonly trimEndMeters: number;
  };
  /** Minimum simplification tolerance. */
  readonly simplifyToleranceMeters: number;
  readonly playback: boolean;
}
```

Rules and defaults:

- `source` is required, non-empty, and must be a relative local path ending in `.gpx`, `.geojson`, or `.json`, case-insensitively.
- `privacy` is optional. Both trim distances default to `0` and must be finite non-negative numbers.
- `simplify_tolerance_meters` is optional, defaults to `5`, and must be finite and between `0` and `10,000` inclusive.
- `playback` is optional and defaults to `true`.
- Unknown keys remain errors at every level, consistent with the existing strict Front Matter schema.
- Existing `points`, `representative`, `route`, and `zoom` behavior does not change.

`normalizePostMap` remains available for browser-safe point geometry. A new server-only normalization result carries that geometry and the optional track reference separately so a local source path cannot be accidentally serialized into HTML.

### 4.2 Path resolution

The source path is resolved relative to the directory of the article source file. For `_posts/nanjing.md`, `./tracks/nanjing.gpx` resolves beneath `source/_posts/tracks/`.

The resolver must:

1. canonicalize Hexo's absolute `source_dir`;
2. reject URL-like, absolute, NUL-containing, and lexically escaping paths;
3. resolve the target with `realpath`;
4. verify the canonical target is still a descendant of the canonical source directory using path-segment boundaries;
5. reject directories, devices, and all other non-regular files;
6. accept only the three declared extensions; and
7. reject files larger than 8 MiB before reading.

A symlink whose final target leaves `source_dir` is rejected. No parser or resolver performs network access. Build errors identify the article and Front Matter field but never echo source file contents or raw timestamp values.

## 5. Source Formats

### 5.1 Internal representation

Both parsers produce ordered segments of raw points:

```ts
interface RawTrackPoint {
  readonly coordinate: readonly [longitude: number, latitude: number];
  readonly elevationMeters?: number;
  readonly timeMilliseconds?: number;
}

type RawTrack = readonly (readonly RawTrackPoint[])[];
```

Coordinates must be finite, longitude must be within `[-180, 180]`, and latitude within `[-90, 90]`. Empty segments are discarded. At least one segment containing two distinct usable points is required. The aggregate raw-point limit is 200,000; the parser stops and fails as soon as the limit is exceeded.

### 5.2 GPX 1.1

- Parse XML with a maintained SAX parser bundled into the Node artifact.
- Reject DTDs and entity declarations and never resolve external resources.
- Read `trk/trkseg/trkpt` elements by namespace-local name, preserving segment boundaries and document order across multiple tracks.
- Read required `lat` and `lon` attributes plus optional `ele` and RFC 3339 `time` child text.
- Reject a present but malformed coordinate, elevation, or time value instead of silently changing statistics.
- Ignore GPX metadata, routes, waypoints, extensions, links, names, and descriptions.

### 5.3 GeoJSON

- Parse UTF-8 JSON and require a valid GeoJSON object.
- Extract `LineString` and `MultiLineString` coordinates from a geometry, feature, feature collection, or nested geometry collection.
- Preserve each line as a separate segment and preserve input order.
- Ignore non-line and `null` geometries; fail if no usable line remains.
- Accept an optional third finite coordinate as elevation in meters; ignore dimensions after the third.
- Do not interpret foreign properties such as `coordTimes`; GeoJSON therefore has no recorded-duration statistic in v0.5.0.
- Do not copy IDs, bounding boxes, feature properties, or foreign members into the output.

GPX and GeoJSON coordinates are WGS84 as required by their format contracts. They are never mixed with the authored GCJ-02 place points during build processing.

## 6. Build Pipeline

The deterministic processing order is:

```text
secure resolve/read
        -> format parse and raw limits
        -> privacy trim
        -> statistics
        -> simplification and publication cap
        -> canonical JSON
        -> SHA-256 content address
```

### 6.1 Privacy trimming

Start and end distances apply across all segments in their recorded order but never count a gap between segments. Trimming walks segment edges using Haversine distance. When a cut falls inside an edge, it inserts a linearly interpolated boundary coordinate and, when both neighboring values exist, interpolated elevation and timestamp values. Fully consumed segments are removed.

Trimming happens before statistics, simplification, hashing, and publication. If the two requested trim distances consume the complete usable route, generation fails with a field-specific error. No pre-trim coordinate or statistic reaches generated HTML or assets.

### 6.2 Statistics

Statistics are calculated from the trimmed, unsimplified track:

- `distanceMeters`: sum of Haversine edge distances within segments; never includes segment gaps.
- `elevationGainMeters`: sum of positive adjacent elevation changes within segments, present only when every retained point has a finite elevation.
- `durationSeconds`: sum of each segment's last-minus-first time, present only when every retained point has a valid timestamp and timestamps are non-decreasing within every segment. Gaps between segments are not counted.

Published numbers are finite, non-negative, and rounded to a stable precision during canonical serialization. The HTML formatter chooses readable metres/kilometres and minutes/hours without changing the underlying values.

### 6.3 Simplification and limits

Ramer-Douglas-Peucker simplification runs independently per segment using metre-based projected distance and preserves every segment endpoint. `simplify_tolerance_meters` is the minimum tolerance.

If that tolerance leaves more than 2,000 points, the compiler deterministically increases a shared tolerance until the total fits the cap. If preserving the segment structure itself would require more than 2,000 points, generation fails. Statistics are never recomputed from simplified points.

### 6.4 Published asset

The canonical asset schema is:

```json
{
  "version": 1,
  "coordinateSystem": "wgs84",
  "segments": [
    [
      [118.7, 32.0, 15.4],
      [118.8, 32.1, 18.2]
    ]
  ],
  "stats": {
    "distanceMeters": 14320.4,
    "elevationGainMeters": 126.8,
    "durationSeconds": 4860
  }
}
```

Each coordinate is `[longitude, latitude]` or `[longitude, latitude, elevationMeters]`. There are no source paths, names, timestamps, or arbitrary source properties.

The UTF-8 bytes are hashed with SHA-256 and published at:

```text
hexo-post-map/tracks/<64-lowercase-hex-digest>.json
```

Identical processed assets deduplicate to one route. The detail document embeds only the root-aware public URL, the sanitized statistics needed for server-rendered content, and the `playback` flag. A changed input or processing option that changes public output receives a new URL. Track routes are emitted even when the overview page is disabled, while the overview's existing `posts.json` stays at version 1 and contains no track field.

## 7. Detail Rendering and Browser Loading

### 7.1 Server-rendered HTML

Point-only detail markup is unchanged except for compatible class additions. A tracked article adds:

- a visible `<dl>` of available trip statistics;
- controls marked `hidden` until browser track validation and map mounting succeed;
- a play/pause button, restart button, and native range input with programmatic label and value text; and
- a track descriptor in the existing escaped `application/json` configuration.

The place-link fallback remains present. Without JavaScript, readers still see the place links and trip statistics but not non-functional playback controls.

### 7.2 Lazy fetch and validation

The existing 300 px detail-map intersection boundary remains the only start trigger. When crossed, the controller loads the provider and fetches the same-origin hashed track asset with the controller's abort signal. The response must be successful and must pass strict runtime validation for schema version, coordinate system, finite coordinate ranges, non-empty segments, statistics, and the 2,000-point cap.

No track request is made for point-only articles, ordinary pages, overview maps, or detail maps that never approach the viewport. Root destruction aborts the fetch. Repeated PJAX hydration of the same live root does not duplicate it.

A fetch or validation failure mounts the normal point map with its schematic `route` and leaves playback controls hidden. The status region reports a generic track fallback without exposing the URL or response. A provider failure still uses the existing complete detail fallback.

## 8. AMap Track Adapter

AMap uses GCJ-02, so WGS84 track coordinates are converted only in the AMap adapter with the official `AMap.convertFrom(..., 'gps', callback)` API. Requests are split into batches of at most 40 coordinates, retain segment order, honor cancellation, and share the existing 20-second provider timeout boundary. A malformed, partial, timed-out, or failed conversion triggers track-only degradation and never feeds mixed coordinate systems to a polyline.

With a successful track:

- place pins and their visit-order labels remain unchanged;
- the existing schematic straight `route` polyline is omitted;
- each recorded segment receives a muted full-route polyline;
- each segment receives an accent progress polyline;
- a non-interactive moving marker represents playback position; and
- map fitting includes place pins and the full recorded track.

The detail handle adds an optional `setTrackProgress(progress)` capability accepting a clamped finite value in `[0, 1]`. The adapter computes cumulative distance over converted segments, updates all progress paths, and places the moving marker at an interpolated position without recreating the map. `destroy()` removes the map and all track state through the existing ownership boundary.

## 9. Playback and Accessibility

Playback never starts automatically. For `playback: true`, the controller begins at progress `0`; for `playback: false`, no controls are exposed and the full muted track remains visible.

The browser playback controller:

- uses `requestAnimationFrame` for a 30-second end-to-end presentation timeline;
- toggles one button between play and pause;
- restarts from `0` and begins playing when restart is activated;
- pauses when the user seeks with the range input;
- updates the slider, percentage text, and provider handle at most once per frame;
- pauses when the document becomes hidden;
- cancels every frame and listener on detail-controller destruction; and
- preserves progress while ordinary map interaction is enabled.

The range input uses native keyboard behavior and `aria-valuetext` such as `行程进度 42%`. Buttons have explicit Chinese/English-neutral accessible labels supplied by the markup rather than relying on icon shape. Status changes use the existing polite live region and do not announce every animation frame.

When `prefers-reduced-motion: reduce` matches, continuous play and restart are unavailable and hidden, no animation frame loop starts, and the slider remains enabled for manual seeking. A change to that media query while the page is open immediately pauses playback and updates control availability.

## 10. Lifecycle, Failure, and Compatibility

- The shared v0.4 runtime remains provider-free and within its 8 KiB limit.
- Track code lives in the detail bundle and Node bundle, never in `runtime.js` or `overview-map.js`.
- Detail `isCurrent()` includes required track controls when a descriptor is present, so PJAX replacement remounts cleanly.
- `destroy()` aborts pending track fetch and provider conversion and tears down playback before destroying the map.
- Late fetch, conversion, provider, and animation callbacks must not mutate a destroyed or replacement root.
- The browser never receives the local source path or raw timestamp data.
- Existing point-only HTML configuration remains readable and behaves exactly as v0.4.0.
- Existing public browser asset routes and the overview data route remain unchanged; track assets are additive.
- Node.js `>=20`, Hexo `>=7 <9`, root/subpath deployment, Landscape, NexT, Cactus, ordinary navigation, PJAX navigation, and BFCache guarantees remain in scope.

## 11. Testing Strategy

### 11.1 Domain and security tests

- strict Front Matter validation, defaults, and point-only compatibility;
- source-relative path resolution under root and subpath posts;
- rejection of URLs, absolute paths, traversal, NULs, extension mismatches, non-files, symlink escapes, and files over 8 MiB;
- GPX namespaces, multiple tracks/segments, optional elevation/time, DTD rejection, malformed values, and raw point limit;
- GeoJSON geometry, feature, feature collection, nested geometry collection, mixed non-line content, malformed coordinates, and raw point limit;
- start/end trimming across and inside segments, interpolation, complete consumption, and ordering;
- Haversine distance, elevation availability, duration availability/monotonicity, and segment gaps;
- RDP endpoint preservation, adaptive 2,000-point cap, impossible segment count, canonical serialization, hashing, and deduplication.

### 11.2 Hexo and packaging tests

- tracked detail SSR contains safe statistics and a descriptor but no source path or timestamp;
- point-only output remains byte-contract compatible where intended;
- root and `/blog/` asset URLs;
- tracked routes are present with overview enabled or disabled and identical assets deduplicate;
- unpublished/unsupported documents do not leak into overview data;
- generated-output and packed-artifact fixtures can read the hashed track asset;
- runtime/provider-free size guards continue to pass;
- no source track is included in the npm tarball.

### 11.3 Browser and provider tests

- no eager or overview track fetch;
- one cancellable detail fetch near the viewport;
- strict response validation and local degradation;
- 40-coordinate conversion batching, order preservation, cancellation, timeout, and partial failure;
- recorded track replacing only the schematic line;
- progress interpolation across multiple segments and cleanup;
- play, pause, restart, seek, visibility pause, reduced-motion behavior, and destruction;
- accessible names, slider value text, hidden no-JavaScript controls, and no per-frame live announcements;
- ordinary lifecycle, BFCache, and PJAX root replacement.

### 11.4 Release-level verification

- complete formatting, lint, typecheck, unit, build, and package checks;
- Chromium E2E with the fake SDK, including track conversion and playback;
- packed compatibility matrix for every supported Node/Hexo pair;
- temporary-copy real-blog smoke at `/` and `/blog/` without modifying the user's source blog;
- optional live AMap smoke remains gated by credentials and is not required for offline correctness.

## 12. Documentation

Update `README.md`, `README.zh-CN.md`, `docs/front-matter.md`, `docs/configuration.md`, `docs/security.md`, `docs/compatibility.md`, and `docs/releases.md` to cover:

- complete GPX and GeoJSON examples;
- path resolution and supported schemas;
- WGS84 tracks versus GCJ-02 authored points;
- privacy trim order and its non-anonymization warning;
- build and publication limits;
- statistics and playback behavior;
- lazy loading, reduced motion, failure fallback, and overview isolation; and
- the unchanged AMap key and security-key deployment configuration.

Author-facing examples must be exercised by documentation tests so copied Front Matter continues to parse.
