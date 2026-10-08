# Security, CSP, and privacy / 安全与隐私

## What a static site publishes

All detail coordinates are embedded in HTML. The overview `posts.json` contains titles, links, dates, representative images, place names, and representative coordinates. These are public files, not an access-controlled database. Do not publish a home address, a private location, or a precise sensitive itinerary unintentionally. Use a deliberately approximate GCJ-02 point when appropriate.

The AMap Web key is public. In client mode, `security_js_code` is public too. Supplying them through environment variables does not change this. Proxy mode publishes only the Web key and proxy URL; the proxy's security code remains server-side if the proxy is configured correctly. Keep credentials out of Git, issue reports, screenshots, logs, and test artifacts. Rotate exposed credentials through your provider account.

Map loading contacts AMap and may reveal ordinary request metadata such as the visitor's IP address to the provider. Detail loading is lazy near the viewport, **not consent-gated by the activation button**. That button controls interaction only. This plugin does not call browser geolocation or add its own analytics. Site owners remain responsible for the third-party services, images, disclosures, and consent behavior appropriate to their site.

## Overview share URL boundary

Return snapshots store only the validated view, panel mode, bounded article URL references, scroll state, and save time under the plugin's own session key. They expire after two hours, retain at most 16 scopes and 16 KiB per snapshot, and are not account bookmarks. The plugin does not use localStorage, cookies, geolocation, analytics, or storage-wide clearing. Blocked or throwing session storage falls back to bounded document memory; no storage permission request is made. Sharing and random previews do not request article bodies, raw GPX/GeoJSON, or track assets.

Sharing works on generated overview pages and tag-embedded overviews, always linking to the configured overview route at the current browser origin (including `/` and `/blog/` installations). Only the actual overview route and its literal terminal `index.html` alias consume incoming shares; embedded article maps ignore their host query. `share: false` skips query parsing independently of `restore`.

Version 1 publishes only `hpm_v=1`, `hpm_center`, `hpm_zoom`, and an optional `hpm_post`. Generated center/zoom precision is at most six/two decimals and the complete URL is limited to 4,096 characters. Parsing rejects duplicate or unknown `hpm_` keys, unsupported versions, nonfinite/invalid views, foreign origins, and other routes. Article references are decoded once by URLSearchParams and must exactly match a unique safe URL in the current dataset; unknown, ambiguous, malicious, or overlong references degrade to view-only. Query text never becomes a new href, fetch target, SDK configuration, or image/track resource. Output excludes Web Key, security code, proxy settings, article body, images, and tracks.

A share is not a confidential channel: its coordinates and article reference are visible to recipients and ordinary browser/server/referrer URL handling. The source dataset and published site remain public. Clipboard access happens only when the user clicks **分享地图**; getter failures, missing support, and rejected writes show a labeled read-only field inside that map root for manual copy. Escape/Close returns focus to the button. Disposed or replaced controls ignore late Promise results; an OS clipboard write already submitted cannot be canceled. No permission manager, analytics, history mutation, or legacy copy command is introduced.

中文要点：总览页与嵌入总览均可生成当前 origin 下的分享链接，嵌入地图不读取文章查询；`share: false` 完全跳过解析。v1 仅含版本、视角和可选唯一文章引用，最长 4,096 字符，不携带高德凭据、代理、正文、图片或轨迹。分享不是保密边界；剪贴板失败时地图根内提供带标签的只读手动复制框，销毁后的异步反馈失效，但不能撤回已提交的系统剪贴板写入。

## Recorded-track source boundary

A track reference is a build-time local input, not a browser URL. It resolves relative to its article and must remain inside canonical Hexo `source_dir`. The resolver rejects remote/absolute/traversing paths, unsupported suffixes, non-regular files, files over 8 MiB, and a symlink whose target escapes the source tree. GPX entity declarations are rejected, and neither parser performs network access. Parsing stops above 200,000 raw points; publication stops above 2,000 points while preserving segment endpoints.

Only the privacy-trimmed, simplified, canonical JSON is published at a SHA-256 content-addressed route. The detail HTML receives that route, sanitized statistics, and the playback choice. The raw source file, source filename/path, GPX metadata, absolute timestamps, GeoJSON properties, and pre-trim coordinates are excluded. When Hexo `post_asset_folder` or ordinary asset generation sees a referenced source file, the plugin filters that exact raw route before it can enter the public router. Unreferenced ordinary assets keep Hexo's normal behavior.

Start/end distance trimming happens before statistics, simplification, and hashing, but it is risk reduction, not anonymization. The remaining route shape, timing-independent context, or nearby landmarks can still identify a home or other sensitive location. Use an intentionally approximate public GCJ-02 representative point, inspect the generated track, and choose trimming distances appropriate to the itinerary. Do not publish a track when the residual disclosure is unacceptable.

Processed track JSON and its statistics are public static files. A content-addressed asset is suitable for a long immutable cache, so deletion from a later build does not retract copies already cached by a CDN, browser, archive, or reader. Treat the first publication as permanent disclosure and use a new source/trim configuration to create a new hash. Removing old hashes from storage is an operational cleanup, not a privacy guarantee.

## AMap setup

The plugin is free under MIT. Its license does not grant AMap service access or override the provider's account, quota, security, or commercial-use conditions; verify those conditions for your deployment. Exploration adds no paid API or backend.

Obtain a Web/JS API key and configure the allowed deployment domains in your provider account. Production deployments should use a security proxy. AMap's [security guide](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode) documents `serviceHost`, the fixed `/_AMapService` prefix, and proxying to `restapi.amap.com` (plus `webapi.amap.com` for custom styles). This plugin requires the browser-facing proxy URL to be HTTPS and does not operate the proxy for you. Restrict your proxy to the intended service paths and add suitable access and rate controls.

The SDK remains an online dependency. The npm package bundles the loader, not a saved copy of AMap's SDK or tiles. AMap's [loading guide](https://lbs.amap.com/api/javascript-api-v2/guide/abc/load) documents online SDK loading from `https://webapi.amap.com/maps` and disallows locally storing/rebundling the SDK. Sources checked on 2026-09-17.

## Content Security Policy

The official pages above identify service endpoints, but do **not** provide a complete, stable CSP allowlist for every resource dynamically loaded by JS API 2.0. The table distinguishes verified endpoints from deployment-specific work. It is not a complete CSP header and has not been validated against a live-key deployment.

| Source                     | Purpose and policy consideration                                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'self'`                   | Plugin scripts/CSS/placeholder, overview JSON and local images; relevant to `script-src`, `style-src`, `connect-src`, and `img-src`                               |
| `https://webapi.amap.com`  | Documented SDK script endpoint; allow it in `script-src` when maps are enabled. The official proxy guide also uses this origin for custom-style upstream requests |
| `https://restapi.amap.com` | Documented service endpoint; proxy mode contacts it from your server. Whether a browser needs it in `connect-src` depends on SDK requests and your security mode  |
| Your `service_host` origin | Browser-to-proxy requests; include the actual origin in applicable request directives when using a cross-origin proxy                                             |
| Your article image origins | Representative images; allow only the origins you use in `img-src`                                                                                                |
| `https://uri.amap.com`     | Destination of user-followed place links, not the plugin SDK source; account for your site's outbound-navigation rules separately                                 |

The provider-free runtime is included on every enabled HTML page. Map pages initially include an external stylesheet for their no-JavaScript fallback; the runtime also inserts same-origin feature scripts and, when missing, the stylesheet dynamically. Ordinary pages do not request map UI or provider resources until map content is present. Ensure your `script-src` and `style-src` policy permits these dynamic same-origin loads as well as the initial runtime and stylesheet. The plugin does not supply a universal nonce or hash policy for strict deployments.

Start with your site's CSP in `Content-Security-Policy-Report-Only`. On the actual production origin, exercise the detail map, overview, clustering, both image/fallback paths, and PJAX navigation from an ordinary page into map content. Inspect request destinations and CSP violations. Check dynamically loaded map data, tiles, styles, workers, and any blob/data resources before deciding which additional sources or directives your deployed SDK actually needs. Add only verified sources; do not infer a broad wildcard allowlist from this table. Also test theme inline styles/scripts and AMap's dynamically generated styles. The plugin emits external JavaScript and a non-executable JSON data block, but cannot guarantee compatibility with every strict CSP or with future vendor SDK changes.

If your policy cannot permit required vendor resources, keep the readable fallbacks or disable the map feature. Do not silently remove CSP or add unrestricted `*`, `unsafe-eval`, or `unsafe-inline` to silence reports. No universal production-ready CSP is claimed here.

## Failure and SDK coexistence

If local resources, the SDK, map initialization, or overview data fail, readable place/article links remain. After correcting a local feature bundle or stylesheet load failure, call the public `refresh(container)` method to retry. After an SDK **load timeout**, reload the page to retry; the timed-out page does not start another SDK request, even after `refresh`. Correct key, proxy, network, or CSP problems first.

The plugin can reuse an already initialized compatible AMap 2.x SDK. It will not replace an incompatible SDK or take over another component's in-flight SDK load. A theme that also loads AMap must coordinate initialization; conflicting versions or loaders can trigger fallback. Conventional light-DOM PJAX replacement is automatic. The versioned `window.HexoPostMap` API exposes `apiVersion: 1`, `refresh(scope?)`, and `destroy(scope?)` for explicit lifecycle integration; see [compatibility](compatibility.md) for valid scopes, timing, and unsupported automatic transitions. These methods do not bypass CSP or reset another component's SDK state.

## Reporting

Follow [SECURITY.md](../SECURITY.md) for vulnerability disclosure. General rendering problems belong in a sanitized issue, including versions and a minimal reproduction without credentials or private coordinates.

中文要点：环境变量不等于客户端保密；精确坐标、处理后的轨迹、Web Key、客户端安全码都会公开。轨迹源必须位于 `source_dir`，逃逸符号链接和超限输入会失败，引用的原始轨迹不会作为文章资源发布。首尾距离裁剪先于统计和哈希，但不是匿名化，CDN 缓存也可能长期保留已发布哈希。生产环境建议 HTTPS 代理，交互激活按钮不是第三方加载同意开关。CSP 必须在真实部署上先以 Report-Only 验证；上述官方端点不是完整来源清单。SDK 加载超时后需要刷新页面。
