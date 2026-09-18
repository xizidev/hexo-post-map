# hexo-post-map

[简体中文](README.zh-CN.md)

Add a compact location card to Hexo posts and a site-wide map of your writing. Describe one place, several places, or a schematic itinerary in Front Matter. Nearby posts cluster as readers zoom; repeated visits to the same place open an article list.

Requires Node.js **20 or newer** and Hexo **7 or 8**. The first release uses AMap JS API 2.0 and **GCJ-02** coordinates. Controls and fallback messages currently use Chinese. This repository is preparing its first release; the installation command below applies once the package is published.

## Install and enable

Run in your Hexo site:

```sh
npm install hexo-post-map
```

Installing alone changes nothing. Add this configuration to the site's `_config.yml` (not the theme's configuration):

```yaml test=config
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
  amap: {}
```

Create an AMap **Web/JS API** key. For production, configure your own HTTPS security proxy using [AMap's official proxy instructions](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode), then supply these environment variables to the process running Hexo. The strings below are placeholders:

```sh
export HEXO_POST_MAP_AMAP_KEY='replace-with-your-web-key'
export HEXO_POST_MAP_AMAP_SERVICE_HOST='https://maps.example.com/_AMapService'
npx hexo clean
npx hexo generate
```

For local development without a proxy, unset `HEXO_POST_MAP_AMAP_SERVICE_HOST` and set `HEXO_POST_MAP_AMAP_SECURITY_JS_CODE` instead. Exactly one security mode is required. **Coordinates, the Web key, and a client-side security code become public in a static site, even when supplied through environment variables.** A proxy keeps its server-side security code out of the generated pages; it does not hide the Web key or coordinates.

File-based credentials and the exact environment precedence are described in the [configuration reference](https://github.com/xizidev/hexo-post-map/blob/main/docs/configuration.md). Never commit real credentials.

## Write posts

These are four shapes of one schema, placed between the opening and closing `---` of a post's YAML Front Matter. Coordinates below are illustrative; use the intended location's GCJ-02 coordinates. The plugin does not geocode names or convert coordinates.

### No map

Omit `map` to exclude a post from both maps:

```yaml test=post-map
title: An ordinary post
```

### One point

```yaml test=post-map
title: Shanghai
thumbnail: https://example.com/shanghai.jpg
map:
  zoom: 11
  points:
    - id: shanghai
      name: 上海
      longitude: 121.4737
      latitude: 31.2304
```

The only point automatically represents the post on the overview.

### Several points, no line

```yaml test=post-map
title: A day in Quzhou
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

All points appear on the detail card. `representative` chooses the single overview location for the article.

### Several points with an itinerary

```yaml test=post-map
title: Wugong Mountain
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

`route` connects those point IDs in order with straight segments. It is a schematic itinerary, not a navigable road or hiking route. Points omitted from the route still appear on the card. IDs belong only to their post: no `place_id`, shared registry, or coordinate jitter is needed.

Unknown fields under `map` and each point are rejected. See the [Front Matter reference](https://github.com/xizidev/hexo-post-map/blob/main/docs/front-matter.md) for validation and diagnostic examples.

## Placement and appearance

The default card is 220px high (180px on small screens), before the article. Use `post.position: after` to place it after the article, or `manual` to insert it at a tag in the Markdown body:

```text
{% post_map %}
```

Use at most one tag per post. A tag also overrides automatic placement in `before` or `after` mode. Manual mode without a tag renders no detail card; the article still participates in the overview. Set `post.enabled: false` to hide detail cards across the site.

The card loads near the viewport and becomes interactive automatically. Routine loading and success messages stay hidden; when JavaScript, the provider, or map initialization fails, a concise error and the place links remain available. An SDK load timeout requires a **page reload** to retry.

Detail locations use silent pins and never open provider popups. Route points are numbered, and `route` always remains a straight, schematic sequence rather than a navigable path.

The overview chooses the first safe image in this order: `thumbnail`, an image in rendered article content, then the bundled placeholder. A chosen image that later fails to load is replaced with the placeholder. Only one representative image per article is used.

## Overview and repeated visits

Open `/map/` after building and add it to your theme's navigation using that theme's own menu settings. The plugin does not modify menus or theme files. With Hexo `root: /blog/`, the page is `/blog/map/` and its data is `/blog/map/posts.json`; keep `overview.path: map/` relative, without repeating the root.

The overview fits every article's representative point. Each thumbnail sits above a stem and visible coordinate dot, so the image does not hide its anchor. Pixel-distance clustering merges nearby posts and separates them as you zoom; its circle also grows across small, medium, and large count ranges. A cluster zooms toward its contents. If zoom cannot separate them, or the configured maximum zoom is reached, it opens the same bounded article panel used by thumbnail previews and the **All posts** control (a bottom drawer on mobile). The panel caps its maximum height and scrolls the article list inside that boundary. Its image or title links to the article. A chronological article list remains usable without the map.

`cluster.grid_size` is a finite positive pixel size; `cluster.max_zoom` must be between 2 and 20 inclusive. The default maximum is 18. Multiple articles may use exactly the same coordinates.

The default overview requests the theme's `page` layout, with a standalone fallback when unavailable. Set `overview.layout: standalone` to use the independent page explicitly. Conventional themes rendering `post.content` are the target; SPA/PJAX themes may need their own navigation integration and are not automatically rehydrated. The compatibility fixtures cover Landscape, NexT, and a minimal Cactus-style layout; they do not guarantee every theme customization.

### Theme customization

Themes customize the map only through the variables below, scoped on `.hpm-detail`, `.hpm-overview`, or both. Do not depend on the plugin's internal component selectors. Safe light, dark, forced-colors, and reduced-motion defaults are built in.

| Variable                | Purpose                                                 |
| ----------------------- | ------------------------------------------------------- |
| `--hpm-accent`          | Pins, anchors, links, and focus rings                   |
| `--hpm-accent-contrast` | Text and borders placed on the accent                   |
| `--hpm-cluster-surface` | Cluster circle surface                                  |
| `--hpm-cluster-border`  | Cluster and thumbnail border                            |
| `--hpm-panel-surface`   | Glass panel surface when backdrop filters are supported |
| `--hpm-panel-border`    | Article panel border                                    |
| `--hpm-card-surface`    | Article cards, controls, and the opaque panel fallback  |
| `--hpm-text`            | Primary text                                            |
| `--hpm-muted`           | Dates, locations, and subdued borders                   |
| `--hpm-route-color`     | Straight detail route segments                          |
| `--hpm-panel-radius`    | Desktop panel and mobile drawer radius                  |
| `--hpm-card-radius`     | Article card radius                                     |

## Troubleshooting and privacy

- No map: check `post_map.enabled: true`, valid `map.points`, the tag in manual mode, and whether the theme renders article content.
- Build fails: read the source path and field in the plugin error. Enabled invalid configuration is a build error; missing configuration is a no-op.
- Blank or failed map: check Web key type, allowed deployment domain, exactly one security mode, proxy availability, browser console/CSP reports, and network access. Reload after correcting configuration or an SDK timeout.
- Broken image: use a safe HTTP(S) or site-relative image URL and verify it is publicly accessible.
- Sensitive location: publish a city or an intentionally approximate point. All generated detail coordinates and overview locations are public. The plugin does not request the visitor's geolocation; loading AMap still contacts a third-party service as the map approaches the viewport.

Read [security, CSP, and privacy](https://github.com/xizidev/hexo-post-map/blob/main/docs/security.md) before deployment. There is no universal copy-paste CSP for the externally loaded SDK; documented origins and a Report-Only rollout are provided there.

## Development and support

See [CONTRIBUTING](https://github.com/xizidev/hexo-post-map/blob/main/CONTRIBUTING.md) for clean builds, packed-artifact theme tests, deterministic browser tests, and the optional live AMap smoke test. Report bugs via [GitHub Issues](https://github.com/xizidev/hexo-post-map/issues); disclose security issues using [SECURITY](https://github.com/xizidev/hexo-post-map/blob/main/SECURITY.md).

The Front Matter and site configuration are the public contracts. Internal modules and provider adapters are not an extension API. The project is MIT licensed; AMap's service has its own terms and requirements.
