# Security, CSP, and privacy / 安全与隐私

## What a static site publishes

All detail coordinates are embedded in HTML. The overview `posts.json` contains titles, links, dates, representative images, place names, and representative coordinates. These are public files, not an access-controlled database. Do not publish a home address, a private location, or a precise sensitive itinerary unintentionally. Use a deliberately approximate GCJ-02 point when appropriate.

The AMap Web key is public. In client mode, `security_js_code` is public too. Supplying them through environment variables does not change this. Proxy mode publishes only the Web key and proxy URL; the proxy's security code remains server-side if the proxy is configured correctly. Keep credentials out of Git, issue reports, screenshots, logs, and test artifacts. Rotate exposed credentials through your provider account.

Map loading contacts AMap and may reveal ordinary request metadata such as the visitor's IP address to the provider. Detail loading is lazy near the viewport, **not consent-gated by the activation button**. That button controls interaction only. This plugin does not call browser geolocation or add its own analytics. Site owners remain responsible for the third-party services, images, disclosures, and consent behavior appropriate to their site.

## AMap setup

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

Start with your site's CSP in `Content-Security-Policy-Report-Only`. On the actual production origin, exercise the detail map, overview, clustering, and both image/fallback paths. Inspect request destinations and CSP violations. Check dynamically loaded map data, tiles, styles, workers, and any blob/data resources before deciding which additional sources or directives your deployed SDK actually needs. Add only verified sources; do not infer a broad wildcard allowlist from this table. Also test theme inline styles/scripts and AMap's dynamically generated styles. The plugin emits external JavaScript and a non-executable JSON data block, but cannot guarantee compatibility with every strict CSP or with future vendor SDK changes.

If your policy cannot permit required vendor resources, keep the readable fallbacks or disable the map feature. Do not silently remove CSP or add unrestricted `*`, `unsafe-eval`, or `unsafe-inline` to silence reports. No universal production-ready CSP is claimed here.

## Failure and SDK coexistence

If the SDK, map initialization, or overview data fails, readable place/article links remain. After an SDK **load timeout**, reload the page to retry; the timed-out page does not start another SDK request. Correct key, proxy, network, or CSP problems first.

The plugin can reuse an already initialized compatible AMap 2.x SDK. It will not replace an incompatible SDK or take over another component's in-flight SDK load. A theme that also loads AMap must coordinate initialization; conflicting versions or loaders can trigger fallback. SPA/PJAX lifecycle integration is not part of the public API.

## Reporting

Follow [SECURITY.md](../SECURITY.md) for vulnerability disclosure. General rendering problems belong in a sanitized issue, including versions and a minimal reproduction without credentials or private coordinates.

中文要点：环境变量不等于客户端保密；精确坐标、Web Key、客户端安全码会公开。生产环境建议 HTTPS 代理，交互激活按钮不是第三方加载同意开关。CSP 必须在真实部署上先以 Report-Only 验证；上述官方端点不是完整来源清单。SDK 加载超时后需要刷新页面。
