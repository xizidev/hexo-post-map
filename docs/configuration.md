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

# Local author command (0.7.0+)

Install or upgrade with `npm install hexo-post-map@latest` in the Hexo blog directory, then run `npx hexo post-map-editor --port 4001`. This command requires plugin 0.7.0 or newer; it is absent from 0.6.x. The editor starts its own local service and does not require a running blog development or production server. Upgrading does not change public maps or article schemas, and using only the editor requires no build, deployment or OSS upload.

Only `127.0.0.1` is supported, with integer ports 1–65535 and default 4001. Add the opt-in `--open` flag to launch the system's default browser with the complete local URL. Without it no browser is opened; a launch failure prints a fixed safe notice and keeps the server available for manual use. Open the complete URL printed for this launch; every restart creates a new credential. Stop with Ctrl+C before reusing the port. A conflict does not terminate another process or choose another port.

The authorization fragment is held by the current server and page, not a saved account session or draft. It has no fixed TTL and expires when the server stops; closing a page does not stop that server. The plugin does not create a persisted token store or authentication cookies. Browser history may retain the launch URL. Refreshing the complete URL while the server runs authorizes a new page but does not restore its draft. An already loaded page retains its own memory independently of server shutdown.

`--open` acknowledges an OS handoff, not page readiness. Errors and nonzero exits during the five-second observation window produce a safe notice; a still-running handler without an error is treated as handed off. Shutdown cancels observation without terminating a handed-off browser or its handler. The terminal URL remains available for manual use regardless of the result.

The Places and Route tabs keep their orderings separate: changing place order cannot reorder route occurrences, and removing an occurrence cannot delete its place. Start/end/repeated-stop labels do not change the underlying YAML. Tab and expanded-coordinate state are page-local UI state; switching or an in-memory lifecycle remount preserves pending inputs. Manual addition expands coordinates, and map/search selection reveals Places. The export footer is outside the tab panels, with a bounded active editing area on desktop and mobile.

The footer distinguishes an empty draft, unfinished input and actual errors. With no added places it shows subdued guidance and hides copy/download/YAML preview. Incomplete or invalid input blocks stale export without immediately marking fields red; blur or Confirm Add reveals nearby Chinese feedback. Missing representatives, single-stop routes and other validation failures use specific Chinese messages instead of schema paths or raw English diagnostics. Export controls still require the current draft and inputs to pass the existing strict validation, and search candidates still require explicit addition. This changes no article schema or configuration option.

The editor reuses existing `post_map.amap` configuration from the site's `_config.yml` and its environment overrides, independently of `post_map.enabled`. Select exactly one security mode: the browser-visible client code (`HEXO_POST_MAP_AMAP_SECURITY_JS_CODE` / `security_js_code`) or an existing controlled proxy (`HEXO_POST_MAP_AMAP_SERVICE_HOST` / `service_host`), together with the Web Key (`HEXO_POST_MAP_AMAP_KEY` / `key`). A client code is not a server secret. Do not put credentials in exported YAML. Missing or invalid settings fall back to manual editing; SDK/network failure also leaves manual editing and export available.

The author search reuses this same JS API configuration and loads only `AMap.PlaceSearch` on explicit Enter/button submission. It accepts a keyword (up to 100 characters) and optional city (up to 60); an empty city searches nationwide and a specified city restricts the search. Ten POIs at most are shown with city/address in a bounded list. Selection fills an uncommitted candidate and centers only the preview (zoom 15); it never writes the article's zoom, representative or route. Confirm Add before the point appears in exported YAML. Query changes, imports and destruction invalidate stale results; a ten-second search timeout preserves manual editing. No search configuration, service-side key, autocomplete, geolocation or navigation API is added. AMap account permissions, domain restrictions and current quotas apply; see the [official search guide](https://lbs.amap.com/api/javascript-api-v2/guide/services/autocomplete) and [quota/price page](https://lbs.amap.com/pages/base_service_price).

Different search candidates require replacement confirmation when new-point fields are unconfirmed; cancellation preserves their exact text and current results. Search quota/rate and key/permission failures use fixed messages based on the [official error reference](https://lbs.amap.com/api/web-service/tools/info), with unknown failures remaining generic. This classification does not guarantee every future SDK error format or provider account condition.

Map clicks also ask before replacing different unconfirmed new-place inputs; cancelling keeps their exact text. **放弃新增地点** is available for a pending candidate or new-place edit, including after selecting an existing place. It clears only the uncommitted candidate, new-place fields and their feedback. Committed places, route, representative, zoom and existing-place raw inputs are preserved, and invalid existing-place edits continue to block export.

Drafts, raw form inputs and feedback state are memory-only and are cleared by refresh or closing. The command does not read or write articles, call generate/deploy/watch, or save a draft. Copy/download the `map:` block into front matter yourself. Import only that block (not full front matter): one document, at most 128 KiB UTF-8 input/output, 200 points, 1000 route stops, and 50 alias expansions. Invalid imports preserve the draft. Deleting a representative requires selecting a replacement. Optional new zoom is 2–20, while any finite imported zoom is preserved with preview limits. Existing track fields remain read-only, with omitted defaults preserved; relative `track.source` paths are resolved only when the target article is built, never by the editor.
