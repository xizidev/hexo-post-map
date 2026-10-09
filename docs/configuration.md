# Site configuration / 站点配置

Put `post_map` in the Hexo site's `_config.yml`. Only the boolean `enabled: true` activates the plugin. An absent section or any other `enabled` value is a no-op. Once enabled, unknown keys and invalid values fail `hexo generate`; credential values are not included in diagnostics.

## Complete file-based example

All credential strings are placeholders. Use one security field, not both, and omit unused fields rather than leaving empty YAML values (`null`).

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
    exploration:
      restore: true
      share: true
      random: false # Optional: true enables previews without automatic navigation
  cluster:
    grid_size: 60
    max_zoom: 18
  amap:
    key: replace-with-your-web-key
    map_style: dark
    security:
      service_host: https://maps.example.com/_AMapService
```

For client mode, replace `service_host` with `security_js_code: replace-with-your-client-code`. That code will be public in generated HTML. The plugin does not implement a proxy server; deploy one using [AMap's security guide](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode). Keep the `/_AMapService` suffix required by AMap, and use HTTPS (required by this plugin).

## Reference

| Field under `post_map`           | Default    | Contract                                                                                                        |
| -------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------- |
| `enabled`                        | inactive   | Only literal boolean `true` opts in                                                                             |
| `provider`                       | `amap`     | Only `amap` is supported                                                                                        |
| `post.enabled`                   | `true`     | Boolean; hides detail cards when false, without excluding overview posts                                        |
| `post.position`                  | `before`   | `before`, `after`, or `manual`                                                                                  |
| `post.height`                    | `220px`    | String containing a non-negative CSS length or percentage; no `calc()`, `var()`, or arbitrary CSS               |
| `post.default_zoom`              | `11`       | Finite number in `[2, 20]` for a single-point detail map                                                        |
| `overview.enabled`               | `true`     | Boolean; false suppresses the overview page and JSON                                                            |
| `overview.path`                  | `map/`     | Safe relative route path, with a trailing slash added if omitted; no leading `/`, traversal, query, or fragment |
| `overview.title`                 | `足迹地图` | Non-empty string, trimmed                                                                                       |
| `overview.layout`                | `page`     | `page` or `standalone`; unavailable theme page layout falls back to standalone                                  |
| `overview.exploration.restore`   | `true`     | Strict boolean; restore the latest valid view and panel in this tab; false clears this scope                    |
| `overview.exploration.share`     | `true`     | Strict boolean; enable map sharing independently of restoration                                                 |
| `overview.exploration.random`    | `false`    | Strict boolean; opt in to random post selection                                                                 |
| `cluster.grid_size`              | `60`       | Finite positive number, in screen pixels (`gridSizePx` inside the browser decision code)                        |
| `cluster.max_zoom`               | `18`       | Finite number in `[2, 20]`; overview zoom cap and overlap-list threshold                                        |
| `amap`                           | required   | Object; use `{}` when credentials come entirely from the environment                                            |
| `amap.key`                       | none       | Non-empty Web/JS API key unless supplied by the environment                                                     |
| `amap.map_style`                 | `normal`   | Official short name or a complete `amap://styles/...` URI; shared by detail and overview maps                   |
| `amap.security.service_host`     | none       | Absolute HTTPS proxy URL without embedded username/password                                                     |
| `amap.security.security_js_code` | none       | Non-empty client security code; mutually exclusive with `service_host`                                          |

The default small-screen detail height is `180px` at widths up to 600px. Theme CSS can override `.hpm-detail { --hpm-mobile-height: 200px; }`. A zero or percentage height is accepted but can make a card invisible when its containing block has no usable height; `px` or `rem` is usually easier to size.

## Environment precedence

Exploration flags reject strings, numbers, nulls, arrays, and unknown keys. Restoration saves the latest valid view and panel, with 200 ms coalesced checkpoints, for two hours in the current tab. Both memory and session storage are bounded to 16 map scopes and 16 KiB per snapshot. It does not replay individual browser history entries, change the address bar, take focus, or scroll the page. Setting `restore: false` clears only the current scope. Blocked storage preserves document-local memory; another full document may retry session storage. Old generated HTML without exploration settings or the overview URL keeps its map usable without reading restoration storage.

Sharing is independent of restoration and is available on both the generated overview and tag-embedded overview after successful initialization with full view capabilities. The **分享地图** control reads the live view and panel on click. Clipboard failure or unavailability provides a root-local labeled read-only field; Escape or Close returns focus without scrolling. `share: false` disables both the control and incoming query parsing. Embedded maps do not consume their host page's query. Sharing always targets the configured overview route at the current origin, for root `/` and subdirectory `/blog/` installations.

Random exploration is optional and defaults to `random: false`. Enable it with `random: true` to show **随机一站** after a capable overview loads with unique, safe article candidates. Selection uses the existing dataset without background article requests; it only centers the map and opens a preview, leaving article navigation to the reader and never starting track playback. Candidates retain their order and receive equal probability; with alternatives, the current unique single preview is excluded before the previous random choice. One candidate may repeat, and zero candidates hide the button. Coordinates stay exact; zoom follows `min(max_zoom, max(current_zoom, 11))`. Reduced motion applies the view immediately. Sharing and restoration remain independent.

The public v1 query whitelist is `hpm_v=1`, `hpm_center=longitude,latitude` (six decimal places maximum in generated links), `hpm_zoom` (two decimal places maximum), and optional `hpm_post`. The latter is an exact, unique, safe dataset reference; group/all panels and unknown/ambiguous posts become view-only. Links are at most 4,096 characters, dropping an oversized article reference. The literal overview route and terminal `index.html` alias accept shares; encoded path separators are not decoded. A fully valid explicit share takes priority over document memory, then session storage, then the normal fitted default. Duplicate/unknown `hpm_` keys or invalid version/view invalidate the share. Sharing does not change browser history, resource fetching, navigation, or map configuration. URLs are public, not a secrecy boundary; see [security](security.md).

中文：三项开关必须为布尔值，默认 `restore: true`、`share: true`、`random: false`。仅恢复当前标签页最近的有效视角及面板，不逐条回放历史；有效期 2 小时，最多 16 个作用域，每份快照 16 KiB。

中文：`random: true` 可选开启“随机一站”，仅使用已有文章数据、无后台文章请求，只定位并预览，不自动跳转或播放轨迹。没有唯一安全候选时隐藏按钮；有多个候选时优先排除当前单篇文章，否则排除上次随机文章。代表坐标不抖动，减少动态效果时立即定位。

These names are case-sensitive:

| Environment variable                  | Overrides                                |
| ------------------------------------- | ---------------------------------------- |
| `HEXO_POST_MAP_AMAP_KEY`              | `amap.key`                               |
| `HEXO_POST_MAP_AMAP_SERVICE_HOST`     | Security mode, selecting the proxy       |
| `HEXO_POST_MAP_AMAP_SECURITY_JS_CODE` | Security mode, selecting the client code |

If either security environment variable is defined, the **whole file-based security selection is replaced**. Defining just `HEXO_POST_MAP_AMAP_SERVICE_HOST` therefore overrides a file-based client code cleanly. Defining both environment security variables is an error, even if one is empty. Empty strings do not fall back to the file; unset unused variables. An empty key environment variable also fails validation.

No `${VARIABLE}` interpolation is performed inside YAML. Put `amap: {}` in the file and set real environment variables on the Hexo process, as shown in the READMEs. `amap: {}` is still required. Changing credentials requires rebuilding and redeploying the static output. Environment variables prevent accidental source commits; they do not make browser-delivered values secret.

## Placement and routes

Use `{% post_map %}` at most once in a mapped article to select its exact location. It takes priority over automatic `before` or `after` placement. Under `manual`, no tag means no card. A tag on an unmapped post renders nothing while the plugin is enabled. When the plugin is disabled its tag is not registered, so remove the tag if Hexo reports an unknown tag.

The overview uses one representative location per published mapped post. A detail-disabled post can still appear there. Invalid map data remains a build error even when detail cards are disabled. An empty site generates an empty-state overview.

The route belongs to the site root. Keep `overview.path` relative and do not repeat the Hexo root. These two configurations produce `/map/` and `/blog/map/` respectively:

```yaml test=root-config
root: /
post_map:
  overview:
    path: map/
```

```yaml test=root-config
root: /blog/
post_map:
  overview:
    path: map/
```

Similarly, `root: /blog/` with `overview.path: travel/` produces `/blog/travel/` and `/blog/travel/posts.json`. Add that URL to your theme's menu yourself. Do not create a separate source page at the same route; use an unused `overview.path` if it would collide. Rebuild with `hexo clean` after changing routes to remove stale generated files.

Assets are emitted under `hexo-post-map/assets/` relative to the site root: `runtime.js`, `post-map.js`, `overview-map.js`, `style.css`, and `placeholder.svg`. Enabled sites inject the provider-free runtime into every rendered HTML page. Only HTML initially containing a plugin map marker also includes the static stylesheet, preserving the no-JavaScript fallback. An index or archive showing full mapped post content can therefore also contain a card and static CSS.

Processed recorded tracks are emitted separately at `hexo-post-map/tracks/<sha256>.json`, also relative to the site root. The digest addresses the public JSON bytes, so a CDN may cache these files as immutable for a long time. Keep HTML and overview JSON on the site's normal revalidation policy, and retain old track hashes while new HTML/CDN caches roll out. The raw authoring file is not a deployment artifact from this plugin. No separate track option belongs in `_config.yml`; track source, privacy, simplification, and playback are article Front Matter fields.

Detail and overview feature scripts are loaded dynamically when needed; AMap remains lazy. Ordinary pages load no map UI or provider resources until map content is inserted. The runtime handles conventional light-DOM PJAX replacement automatically and loads missing feature scripts/styles using the runtime's asset base, respecting roots such as `/blog/`. See [compatibility](compatibility.md) for the versioned manual lifecycle API and retry boundaries.

## Exact diagnostic examples

The plugin message portion is shown below; Hexo may wrap it with its own log prefix or stack:

```text
[hexo-post-map] amap.key: must be a non-empty string
[hexo-post-map] amap.security: must set exactly one security mode
[hexo-post-map] cluster.max_zoom: must be a finite number from 2 to 20
[hexo-post-map] cluster.grid_size: must be a positive finite number
[hexo-post-map] post.position: must be one of: before, after, manual
[hexo-post-map] amap.map_style: must be an official style name or an amap://styles/... URI
```

These errors identify a field, never its credential value. For post diagnostics see [Front Matter](front-matter.md). For provider failure, SDK conflicts, CSP, and privacy see [security](security.md).

中文要点：启用后配置严格校验；空值不是“未配置”；环境变量的安全模式整体覆盖文件中的模式。路径不含 Hexo `root` 前缀，导航需按主题单独设置。
