# Site configuration / 站点配置

Put `post_map` in the Hexo site's `_config.yml`. Only the boolean `enabled: true` activates the plugin. An absent section or any other `enabled` value is a no-op. Once enabled, unknown keys and invalid values fail `hexo generate`; credential values are not included in diagnostics.

## Complete file-based example

All credential strings are placeholders. Use one security field, not both, and omit unused fields rather than leaving empty YAML values (`null`).

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
| `cluster.grid_size`              | `60`       | Finite positive number, in screen pixels (`gridSizePx` inside the browser decision code)                        |
| `cluster.max_zoom`               | `18`       | Finite number in `[2, 20]`; overview zoom cap and overlap-list threshold                                        |
| `amap`                           | required   | Object; use `{}` when credentials come entirely from the environment                                            |
| `amap.key`                       | none       | Non-empty Web/JS API key unless supplied by the environment                                                     |
| `amap.map_style`                 | `normal`   | Official short name or a complete `amap://styles/...` URI; shared by detail and overview maps                   |
| `amap.security.service_host`     | none       | Absolute HTTPS proxy URL without embedded username/password                                                     |
| `amap.security.security_js_code` | none       | Non-empty client security code; mutually exclusive with `service_host`                                          |

The default small-screen detail height is `180px` at widths up to 600px. Theme CSS can override `.hpm-detail { --hpm-mobile-height: 200px; }`. A zero or percentage height is accepted but can make a card invisible when its containing block has no usable height; `px` or `rem` is usually easier to size.

## Environment precedence

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

The route belongs to the site root: `root: /blog/` with `overview.path: travel/` produces `/blog/travel/` and `/blog/travel/posts.json`. Add that URL to your theme's menu yourself. Do not create a separate source page at the same route; use an unused `overview.path` if it would collide. Rebuild with `hexo clean` after changing routes to remove stale generated files.

Assets are emitted under `hexo-post-map/assets/` relative to the site root. Asset tags are injected only into rendered HTML containing a plugin map marker; an index or archive showing full mapped post content can therefore also contain a card and its assets.

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
