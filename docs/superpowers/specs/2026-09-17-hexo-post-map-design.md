# hexo-post-map Design

Date: 2026-09-17

## 1. Summary

`hexo-post-map` is a public npm plugin for Hexo that adds geographic metadata to posts, renders a compact map on post pages, and generates a site-wide map of every geotagged post.

Version 1 supports AMap JavaScript API 2.0 only. The implementation must keep the provider boundary isolated so another provider can be added later without changing the post metadata contract. The provider interface remains internal in the first release and is not a public extension API.

The plugin is developed in the standalone public repository:

- GitHub: `https://github.com/xizidev/hexo-post-map`
- npm package: `hexo-post-map`
- Local checkout: `/Users/hif/blog/hexo-post-map`

The existing blog at `/Users/hif/blog/blog_source` is the first real consumer and integration fixture, not the location of the plugin source.

## 2. Goals

- Let authors describe one or more geographic points in YAML Front Matter.
- Let an author optionally connect points with an ordered itinerary line.
- Render a short, responsive map card before post content by default.
- Generate a standalone overview page containing every geotagged post.
- Automatically cluster nearby posts according to zoom level and screen distance.
- Show representative post images and provide direct links to posts.
- Work with most conventional Hexo themes without modifying theme files.
- Fail builds with precise diagnostics when an enabled configuration is invalid.
- Remain harmless when installed but not configured.
- Meet the quality bar for a maintained public npm package.

## 3. Non-goals for the First Release

- Providers other than AMap.
- Online geocoding or reverse geocoding during a build.
- Runtime driving, walking, cycling, or transit route planning.
- Semantic grouping through manually maintained place identifiers.
- GPX ingestion, recorded GPS tracks, route animation, or elevation charts.
- Province/city filters, time sliders, full-text search, or analytics.
- Automatic modification of theme navigation menus.
- Support for Hexo 6 or earlier, Node.js 18 or earlier, or non-Hexo site generators.

## 4. Supported Runtime

- Node.js: `>=20`
- Hexo: `>=7 <9`
- Server-side plugin entry: CommonJS-compatible build output
- Browser code: framework-independent JavaScript
- Coordinate system: GCJ-02

The continuous integration matrix covers Node.js 20, 22, and 24 together with Hexo 7.1.1, the latest Hexo 7 release, and Hexo 8.

## 5. Post Metadata Contract

Geographic data lives in the YAML Front Matter at the top of each Markdown post. There is one schema with four supported shapes.

### 5.1 No map

When `map` is omitted, the post has no detail map and is excluded from the overview map.

```yaml
---
title: 2025年度总结
date: 2025-12-31 20:00:00
---
```

### 5.2 One point

```yaml
---
title: 魔都
date: 2023-03-29 19:11:39
thumbnail: https://example.com/shanghai.jpg

map:
  zoom: 11
  points:
    - id: shanghai
      name: 上海
      longitude: 121.4737
      latitude: 31.2304
---
```

For one point, `representative` is optional and defaults to the only point.

### 5.3 Multiple points without an itinerary

```yaml
map:
  representative: old-city
  points:
    - id: old-city
      name: 衢州古城
      longitude: 118.8739
      latitude: 28.9570
    - id: museum
      name: 衢州市博物馆
      longitude: 118.8762
      latitude: 28.9551
```

All points appear on the detail map, but no line is drawn. The overview map uses only the point named by `representative`.

### 5.4 Multiple points with an itinerary

```yaml
map:
  representative: summit
  points:
    - id: visitor-center
      name: 武功山游客中心
      longitude: 114.1501
      latitude: 27.4682
    - id: cableway
      name: 一级索道
      longitude: 114.1623
      latitude: 27.4741
    - id: summit
      name: 武功山金顶
      longitude: 114.1735
      latitude: 27.4568
  route:
    - visitor-center
    - cableway
    - summit
```

`route` is an ordered list of point identifiers. The detail map draws a schematic polyline directly between the referenced points. Points omitted from `route` remain visible but are not part of the line.

### 5.5 Validation rules

- `map.points` must contain at least one point.
- Point identifiers must be unique within the post.
- Point identifiers use lowercase ASCII letters, digits, and hyphens.
- Every point must have a non-empty name and finite numeric longitude and latitude.
- Longitude must be between -180 and 180; latitude must be between -90 and 90.
- A multi-point post must specify an existing `representative` point.
- A one-point post may omit `representative`.
- Every entry in `route` must reference an existing point.
- `route`, when present, must contain at least two point identifiers.
- `zoom` is optional and applies to a single-point detail map; multi-point maps fit all points automatically.
- Invalid geographic data fails the build and reports the source path and exact field.

## 6. Site Configuration Contract

The plugin activates only when the site explicitly declares `post_map.enabled: true`.

```yaml
post_map:
  enabled: true
  provider: amap

  post:
    enabled: true
    position: before
    height: 220px
    default_zoom: 11

  overview:
    enabled: true
    path: map/
    title: 足迹地图
    layout: page

  cluster:
    grid_size: 60
    max_zoom: 18

  amap:
    key: your-amap-key
    security:
      service_host:
      security_js_code:
```

Defaults:

- `provider: amap`
- `post.enabled: true`
- `post.position: before`
- `post.height: 220px`, with a responsive mobile height of 180px
- `post.default_zoom: 11`
- `overview.enabled: true`
- `overview.path: map/`
- `overview.layout: page`
- `cluster.grid_size: 60`
- `cluster.max_zoom: 18`

`post.position` accepts:

- `before`: prepend the map to rendered post content.
- `after`: append the map to rendered post content.
- `manual`: render only where the post contains `{% post_map %}`.

The following environment variables override file configuration:

- `HEXO_POST_MAP_AMAP_KEY`
- `HEXO_POST_MAP_AMAP_SERVICE_HOST`
- `HEXO_POST_MAP_AMAP_SECURITY_JS_CODE`

When the plugin is enabled, an AMap key and exactly one security mode are required. The recommended production mode is `service_host`; `security_js_code` is the client-side fallback. Setting neither or both is a build error.

Installing the package without a `post_map` configuration is a no-op: it injects no assets, generates no routes, and never breaks an existing build.

## 7. Architecture

The plugin processes content at build time and leaves the browser responsible only for presentation and interaction.

```text
Front Matter
    -> normalize
    -> validate
    -> detail-map placeholder injection
    -> overview page and posts.json generation
    -> browser rendering through AMap
```

Proposed source boundaries:

```text
src/
├── index.ts
├── config/
│   ├── defaults.ts
│   └── validate.ts
├── domain/
│   ├── schema.ts
│   ├── normalize.ts
│   └── validate.ts
├── hexo/
│   ├── filter.ts
│   ├── generator.ts
│   ├── injector.ts
│   └── tag.ts
├── providers/
│   ├── provider.ts
│   └── amap.ts
├── browser/
│   ├── post-map.ts
│   └── overview-map.ts
└── templates/
    └── overview.ejs
```

Responsibilities:

- `domain` owns the provider-independent post schema and validation.
- `config` owns defaults, environment overrides, and site-level validation.
- `hexo/filter` inserts detail-map placeholders through `after_post_render`.
- `hexo/generator` emits the overview page, `posts.json`, browser assets, and fallbacks.
- `hexo/injector` uses the `after_render:html` filter to inject CSS and JavaScript only when the rendered HTML contains a plugin detail or overview marker. Hexo's page-type Injector API is not sufficiently granular because it cannot distinguish mapped posts from ordinary posts.
- `hexo/tag` implements manual placement.
- `providers` isolates AMap loading and rendering behind an internal boundary.
- `browser` implements maps, clustering, cards, drawers, and error recovery without a UI framework.

The first public compatibility contracts are the Front Matter schema and `_config.yml` schema. The provider interface is intentionally internal until a second provider proves the abstraction.

## 8. Theme Compatibility

The default path uses Hexo's standard APIs and does not edit theme files:

- A post-render filter inserts the detail placeholder into `post.content`.
- A marker-aware `after_render:html` filter adds scoped assets only to HTML that contains a plugin detail or overview component.
- A generator creates the overview route.
- A tag plugin supports exact manual placement.

The plugin uses prefixed class names and CSS custom properties to minimize conflicts. It does not depend on Vue, React, jQuery, or a theme build pipeline.

The overview page first requests the theme's `page` layout so it inherits normal navigation and footer. If an appropriate layout is unavailable, the generator falls back to a self-contained page. Users must add `/map/` to their theme navigation themselves because menu configuration is not standardized across themes.

The compatibility target is conventional themes that render `post.content`. Deeply customized SPA themes may require manual tag mode or explicit integration.

## 9. Detail Map Behavior

- The map appears before post content by default.
- The map is lazy-loaded when it approaches the viewport.
- A fixed-size loading skeleton prevents layout shift.
- A single page loads the AMap API at most once.
- Wheel zoom is disabled initially so the map does not hijack reading scroll.
- Full interaction begins after intentional pointer or keyboard activation.
- A single point uses its configured zoom or the plugin default.
- Multiple points use a fitted viewport.
- Route points display in sequence and are connected by a schematic polyline.
- Non-route points remain visible as independent markers.
- Selecting a point reveals its name and a link to view it in AMap.

The server-rendered fallback always contains readable place names and links. AMap loading failure must not remove the fallback or affect article content.

## 10. Overview Map Behavior

The generator emits `/map/index.html` and `/map/posts.json`. The exact path follows `overview.path` and the site's configured root.

`posts.json` has a versioned envelope and contains only public presentation fields:

```json
{
  "version": 1,
  "posts": [
    {
      "title": "武功山真的很美",
      "url": "/archives/wugongshan_251115/",
      "date": "2025-11-15T05:14:52.000Z",
      "image": "https://example.com/wugongshan.jpeg",
      "location": {
        "name": "武功山金顶",
        "longitude": 114.1735,
        "latitude": 27.4568
      }
    }
  ]
}
```

Interaction rules:

1. Initial bounds include every representative point.
2. Nearby posts cluster automatically according to current zoom and pixel distance.
3. Selecting a normal cluster zooms to its contents.
4. Posts that separate become individual image markers.
5. Selecting an image marker opens a preview card.
6. Selecting the card image or title opens the post.
7. At maximum zoom, posts that still overlap open a multi-post list instead of triggering another ineffective zoom.
8. Desktop uses a side panel for multi-post results; mobile uses a bottom drawer.
9. The plugin never requires `place_id` and never alters coordinates with random offsets.

If AMap or `posts.json` fails to load, the overview retains a chronological server-rendered list of every geotagged post.

## 11. Representative Image Resolution

The plugin resolves one image per post in this order:

1. `thumbnail` from Front Matter.
2. The first image in rendered post content.
3. The bundled placeholder image.

Map images are lazy-loaded, have fixed dimensions, include alternative text, and replace themselves with the placeholder on error. The overview never loads the rest of a post's images.

## 12. Security and Privacy

- All post-derived text is HTML-escaped before entering generated markup.
- Embedded JSON is serialized so it cannot terminate its containing script element.
- Post URLs accept only safe site-relative URLs or explicitly allowed HTTP(S) URLs.
- Image URLs accept HTTP(S) and safe site-relative URLs; executable schemes are rejected.
- Configuration diagnostics must not print security credentials.
- Browser assets receive only values required to load AMap.
- The documentation prominently explains that exact coordinates and client-side credentials become public in a static site.
- Sensitive locations should be represented by a city, district, or intentionally approximate point.
- Production documentation recommends an AMap security proxy through `service_host`.
- Content Security Policy documentation lists the AMap origins users must allow.

## 13. Accessibility and Responsive Behavior

- Maps have accessible names and keyboard-operable activation controls.
- Location names and post links exist outside the canvas rendering.
- Markers and cluster controls expose button semantics where the AMap API permits custom DOM.
- Images have useful alternative text.
- The plugin respects `prefers-reduced-motion`.
- A map is never the only path to a post.
- Touch interactions do not trap vertical page scrolling before activation.
- Desktop and mobile layouts are verified independently.

## 14. Failure Behavior

- Installed without configuration: no-op.
- Enabled without a key: build failure with configuration guidance.
- Missing or conflicting security mode: build failure.
- Invalid post metadata: build failure naming the source file and exact field.
- No geotagged posts: successful build with an empty overview state.
- Missing image: first-content-image fallback, then bundled placeholder.
- AMap failure: readable location and article fallback remains visible.
- Overview data failure: server-rendered chronological list remains usable.
- Browser script failure: post content and navigation remain unaffected.

Example diagnostic:

```text
[hexo-post-map] Invalid map configuration

Post: source/_posts/武功山真的很美.md
Field: map.route[2]
Value: summit-top
Reason: point "summit-top" does not exist in map.points
```

## 15. Testing Strategy

### Unit tests

- Configuration defaults and environment precedence.
- All four Front Matter shapes.
- Numeric bounds, duplicate identifiers, representative resolution, and route references.
- URL validation, HTML escaping, and embedded JSON safety.
- Representative image selection.
- Root-path and permalink handling.
- Cluster terminal behavior at maximum zoom.

### Integration tests

- Install the actual packed tarball into fixture sites.
- Build against Hexo 7.1.1, latest Hexo 7, and Hexo 8.
- Exercise Node.js 20, 22, and 24.
- Build with Cactus, Landscape, and at least one additional mainstream theme.
- Test root deployment and subdirectory deployment.
- Assert generated routes, injected assets, fallback markup, and `posts.json` output.

### Browser tests

- Use a deterministic fake provider for required CI.
- Verify lazy loading, activation, one-time provider loading, marker selection, cluster zooming, maximum-zoom lists, drawers, and post navigation.
- Verify desktop and mobile viewport behavior.
- Verify provider and image failures.
- Keep an optional non-blocking AMap smoke test that uses repository secrets and never gates normal pull requests.

### Package tests

- Run formatting, linting, type checking, unit tests, builds, and browser tests.
- Run `npm pack --dry-run` and inspect the file allowlist.
- Install the produced tarball in fixtures to catch missing build output and accidental local-source coupling.
- Ensure fixtures, secrets, raw source maps not intended for users, and blog content are not published.

## 16. CI and Release

Pull requests and pushes run the full required test suite. Protected-branch rules require CI before merge.

Release automation uses `release-please`:

1. Conventional changes land on `main` after CI.
2. Release Please opens a version and changelog pull request.
3. Merging that pull request creates a GitHub Release and version tag.
4. The publish workflow checks out the tagged source, performs a clean install, reruns required verification, and publishes the exact packed artifact.

npm publication uses Trusted Publishing from a GitHub-hosted runner with OIDC and no long-lived write token. The publish job uses Node.js 24 and a current npm version that supports Trusted Publishing. The public repository and package retain npm provenance.

The first release establishes package ownership on npm and then connects the npm Trusted Publisher to the repository's `publish.yml` workflow. Subsequent releases occur only through that workflow.

Repository policy and documentation include:

- MIT License
- English and Chinese README content
- `CHANGELOG.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- Issue and pull request templates
- Dependabot or Renovate updates
- Branch protection and required checks
- An npm publication allowlist

## 17. Versioning

- `0.1.0` delivers the normalized data model, post maps, overview map, clustering, AMap provider, fallbacks, and public documentation.
- `0.x` validates the contract against the real blog and fixture themes.
- `1.0.0` declares the Front Matter and site configuration contracts stable.
- `1.x` remains backward-compatible for those public contracts.
- Breaking changes to either contract require a new major version.

## 18. Acceptance Criteria

The initial implementation is ready for a prerelease when all of the following are true:

- A clean installation does nothing until explicitly enabled.
- The four documented post shapes build and render correctly.
- Invalid data produces precise and safe diagnostics.
- Detail maps support single points, multiple points, and schematic routes.
- The overview map clusters automatically without semantic IDs or coordinate jitter.
- Maximum-zoom overlap produces an accessible article list.
- The site remains usable without JavaScript or when AMap fails.
- Assets load only on relevant pages.
- The packed npm artifact installs and builds in every supported fixture.
- Required CI passes for the declared Node.js and Hexo matrix.
- The real Cactus blog builds and passes browser smoke tests with the packed plugin.
- Documentation covers installation, authoring, security, privacy, theming, and troubleshooting.
