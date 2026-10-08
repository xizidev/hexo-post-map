# hexo-post-map

[English](README.md)

为 Hexo 文章添加矮地图卡片，并生成汇集全站文章的地图页面。通过 Front Matter 描述单个地点、多个地点或行程示意线；全国地图根据缩放自动聚合文章，同一地点的多次访问可展开为文章列表。

需要 **Node.js 20 及以上**、**Hexo 7 或 8**。插件使用高德 JS API 2.0；文章手写地点使用 **GCJ-02**，可选的真实轨迹文件使用 **WGS84**。当前控件及降级提示使用中文。

## 安装与启用

在 Hexo 站点目录执行：

```sh
npm install hexo-post-map
```

仅安装不会改变站点。在站点的 `_config.yml`（不是主题配置）中加入：

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
      random: false # 设为 true 可启用可选的随机文章预览
  cluster:
    grid_size: 60
    max_zoom: 18
  amap:
    key: replace-with-your-web-key
    map_style: dark
    security:
      security_js_code: replace-with-your-security-js-code
```

以上凭据均为占位符。`amap.key` 和 `amap.security.security_js_code` 分别填写高德控制台生成的 Key 和安全密钥；不要同时再配置 `service_host`。

`overview.exploration` 仅接受 `restore`、`share`、`random` 三项严格布尔值，默认值如上。返回恢复会在当前标签页保留最近的地图视角和文章面板，支持 PJAX 导航或刷新，有效期为 2 小时；内存和 sessionStorage 各最多保留 16 个地图作用域，每份快照不超过 16 KiB。恢复不会抢焦点、滚动页面或逐条回放历史记录。`restore: false` 仅清除当前地图作用域；sessionStorage 被阻止时，当前文档降级为有界内存保存。分享、随机选择与返回恢复分别配置。

这是有效期为 2 小时的标签页会话，不是账户收藏或跨设备同步。传统跳转会保存最近有效状态，在重新加载总览时恢复；真正的浏览器前进/后退缓存（BFCache）返回保留原有控制器。常规 PJAX 根节点替换会恢复当前文档中的最近状态。仅改变 URL 而保留原根节点的路由不会重新应用分享参数，主题需替换根节点或显式管理生命周期。旧 HTML 缺少探索配置或 `overviewUrl` 时仍保留地图和文章列表，但不提供新控制按钮。

`share: true` 时，生成的总览页和标签嵌入的总览地图都会在具备完整能力的地图加载后显示“分享地图”。点击复制当前视角和单篇文章预览；聚合组或全部文章面板仅分享视角。剪贴板被拒绝、不支持或访问受限时，地图根内显示带标签的只读输入框供手动复制；Escape 或关闭按钮会将焦点返回分享按钮。链接使用当前浏览器 origin 和配置的总览路由，支持站点根 `/` 和 `/blog/` 子目录。`restore: false` 不影响分享；`share: false` 隐藏按钮并完全忽略输入的分享参数。嵌入地图不会读取宿主文章 URL 上的分享查询。

将 `random: true` 可选开启“随机一站”；具备完整能力的总览地图加载成功且存在唯一安全文章 URL 时才显示按钮。它从已有文章数据集中均匀选择；有其他候选时，优先排除当前单篇预览，否则排除上一次随机选择，仅有一篇时允许重复。地图使用文章原始代表坐标，目标缩放为 `min(max_zoom, max(current_zoom, 11))`，并打开预览；启用减少动态效果时立即定位。随机选择无后台文章请求、不修改浏览器历史、不自动跳转文章或播放轨迹，由读者决定是否打开文章。

v1 分享仅包含 `hpm_v=1`、`hpm_center=经度,纬度`（最多 6 位小数）、`hpm_zoom`（最多 2 位小数）和可选 `hpm_post`，文章引用必须精确匹配当前数据集中唯一的安全 URL。链接不超过 4,096 字符；过长的文章引用会被省略。总览页仅匹配字面路由及末尾 `index.html` 别名；有效显式分享优先于缓存，不改地址栏、不抢焦点。重复、未知或无效 `hpm_` 参数会使整份分享失效；未知或歧义文章降级为仅视角。分享会将视角和文章引用公开给接收者及通常的 URL 日志，不是保密通道；链接不包含高德凭据、代理配置、文章正文、图片或轨迹。

### 申请高德 Key

1. 注册并登录[高德开放平台](https://console.amap.com/)，进入“应用管理”，创建应用。
2. 在应用中添加 Key，服务平台选择 **Web 端（JS API）**，不要选择“Web 服务”。
3. 复制生成的 **Key** 和 **安全密钥（securityJsCode）**，填入上面的 `_config.yml`。
4. 按高德控制台的安全设置配置实际使用域名；本地预览时也要确认当前开发地址符合控制台限制。

2021 年 12 月 2 日后申请的 JS API Key 必须配合安全密钥使用，具体要求见[高德 JS API 准备说明](https://lbs.amap.com/api/javascript-api-v2/prerequisites)。

### 选择底图样式

`amap.map_style` 同时控制文章详情卡片和全站足迹地图的底图，默认值为 `normal`。可以直接填写高德官方样式短名称：

```yaml
post_map:
  amap:
    map_style: dark
```

支持的官方名称包括 `normal`、`dark`、`light`、`whitesmoke`、`fresh`、`grey`、`graffiti`、`macaron`、`blue`、`darkblue` 和 `wine`。如需使用已经发布的 GeoHUB 自定义样式，请填写完整的高德样式 URI：

```yaml
post_map:
  amap:
    map_style: amap://styles/d6bf8c1d69cea9f5c696185ad4ac4c86
```

样式预览和 GeoHUB 发布方法见[高德自定义地图文档](https://lbs.amap.com/api/javascript-api-v2/guide/map/map-style)。修改样式后需要重新生成 Hexo 站点。使用 `service_host` 时，还要确认代理支持高德文档所述的 `webapi.amap.com` 自定义样式上游请求。

### 本地预览与 Bucket 部署

配置完成后，可以先在本地预览：

```sh
npx hexo clean
npx hexo server
```

发布到对象存储 Bucket 时，在本地重新生成静态站点：

```sh
npx hexo clean
npx hexo generate
```

将生成的 `public/` 目录上传到 Bucket 即可。Key 和客户端安全密钥在 Hexo 构建时写入静态页面，Bucket 不需要安装 Node.js，也不需要额外设置环境变量。修改 Key、安全模式或地图配置后，必须重新执行构建并上传；如果前面还有 CDN，请同步刷新相关页面和静态资源缓存。

这种文件配置最适合“本地构建、上传静态文件”的博客，但 **Web Key、客户端安全密钥和文章坐标都会发送给浏览器，不能视为私密数据**。请在高德控制台限制可用域名和额度，不要把同一个 Key 用于无关项目。如果博客源码仓库公开，不要提交真实凭据，可改用下方的环境变量。

### 生产代理与环境变量（可选）

高德建议生产环境把安全密钥保存在服务端，并按[官方安全代理说明](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode)部署 HTTPS 代理。此时将客户端安全密钥替换为代理地址：

```yaml
post_map:
  # 其余配置保持不变
  amap:
    key: replace-with-your-web-key
    security:
      service_host: https://maps.example.com/_AMapService
```

`/_AMapService` 是高德规定的固定代理前缀。插件只使用这个代理地址，不会替你创建或托管代理服务。`security_js_code` 和 `service_host` 两种安全模式必须且只能选择一种。

如果不希望把凭据写入 `_config.yml`，可以保留 `amap: {}`，在执行 Hexo 的同一终端中设置环境变量。下面示例选择代理模式：

```sh
export HEXO_POST_MAP_AMAP_KEY='replace-with-your-web-key'
export HEXO_POST_MAP_AMAP_SERVICE_HOST='https://maps.example.com/_AMapService'
npx hexo clean
npx hexo generate
```

使用客户端安全密钥时，取消 `HEXO_POST_MAP_AMAP_SERVICE_HOST`，改为设置 `HEXO_POST_MAP_AMAP_SECURITY_JS_CODE`。环境变量只避免凭据进入源码仓库，不会让发送给浏览器的 Web Key 或客户端安全密钥变成秘密。

文件配置及环境变量的准确优先级见[配置参考](https://github.com/xizidev/hexo-post-map/blob/main/docs/configuration.md)。

## 文章写法

以下是同一个 schema 的四种用法，写在文章 YAML Front Matter 的起止 `---` 之间。示例坐标仅作说明，实际使用应填写目标地点的 GCJ-02 坐标；插件不根据名称查坐标，也不转换坐标系。

### 不展示地图

省略 `map`，文章既没有详情地图，也不进入全国地图：

```yaml test=post-map
title: 普通文章
```

### 单个地点

```yaml test=post-map
title: 魔都
thumbnail: https://example.com/shanghai.jpg
map:
  zoom: 11
  points:
    - id: shanghai
      name: 上海
      longitude: 121.4737
      latitude: 31.2304
```

唯一的地点会自动作为全国地图上的文章代表位置。

### 多个地点，不连线

```yaml test=post-map
title: 衢州一日游
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

详情卡片展示所有地点，`representative` 指定全国地图上代表这篇文章的唯一位置。

### 多个地点，带行程示意线

```yaml test=post-map
title: 武功山真的很美
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

`route` 按顺序直线连接地点 ID，只表达行程顺序，不是导航道路或徒步轨迹。没有写入 `route` 的点仍然显示。ID 只在当前文章中唯一，不需要维护跨文章的 `place_id`，也不会随机偏移坐标。

`map` 和地点对象中的未知字段都会报错。完整规则和错误示例见 [Front Matter 参考](https://github.com/xizidev/hexo-post-map/blob/main/docs/front-matter.md)。

### 添加 GPX 真实轨迹

在 `map` 内，`points` 仍然必填并使用 GCJ-02 坐标；`track` 是可选项，其中 GPX 或 GeoJSON 坐标使用 WGS84。即使真实轨迹加载失败，地点仍能支撑详情卡片和全国地图。

```yaml test=post-map-track
title: 坐火车去南京
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

`source` 是相对于文章源文件的本地路径。对于 `source/_posts/nanjing.md`，示例会解析到 `source/_posts/tracks/nanjing.gpx`。文件必须位于 Hexo 的 `source_dir` 内；远程 URL、绝对路径、目录穿越和逃逸到目录外的符号链接都会使构建失败。

GPX 输入必须使用 GPX 1.1 namespace `http://www.topografix.com/GPX/1/1`。解析器只从该 namespace 内的 `trk` > `trkseg` > `trkpt` 层级读取轨迹段和轨迹点。使用 GPX 1.0 namespace 的文件会被立即拒绝，因为它的根 namespace 不是要求的 GPX 1.1 namespace。在其他方面有效的 GPX 1.1 文档中，仅含路线（`rte`/`rtept`）和仅含航点（`wpt`）的内容会被忽略，不提取为轨迹；如果最终没有受支持的轨迹段，校验会因无可用轨迹而失败。

```xml test=track-source-gpx
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
  <trk>
    <trkseg>
      <trkpt lon="118.7900" lat="32.0800" />
      <trkpt lon="118.8000" lat="32.0800" />
      <trkpt lon="118.8100" lat="32.0800" />
      <trkpt lon="118.8200" lat="32.0800" />
    </trkseg>
  </trk>
</gpx>
```

这段四点示例约长 2.8 千米，因此按上方配置从首尾各裁剪 300 米后仍保留可用线段。

### 添加仅展示的 GeoJSON 轨迹

```yaml test=post-map-track
title: 漫步南京
map:
  representative: old-city
  points:
    - id: old-city
      name: 南京老城
      longitude: 118.7872
      latitude: 32.0415
  track:
    source: ./tracks/nanjing.geojson
    playback: false
```

GeoJSON 源可以直接是 `LineString` 或 `MultiLineString` Geometry，也可以把这些线型 geometry 放在受支持的 `Feature`、`FeatureCollection` 或 `GeometryCollection` 容器中。其他标准 geometry（`Point`、`MultiPoint`、`Polygon`、`MultiPolygon`）会被忽略，不作为轨迹；如果最终没有可用线，构建失败。WGS84 坐标顺序为 `[longitude, latitude, optional elevation]`；更后面的坐标维度和外部属性会被忽略。

```json test=track-source-geojson
{
  "type": "LineString",
  "coordinates": [
    [118.79, 32.08, 10],
    [118.791, 32.081, 14]
  ]
}
```

无论哪种格式，最终都必须至少有一个轨迹段，在同一轨迹段中包含两个空间位置不同的可用点。多个相互分离的单点段、空轨迹或只重复同一坐标的线都会校验失败。

支持 `.gpx`、`.geojson` 和 GeoJSON `.json`。`privacy.trim_start_meters`、`privacy.trim_end_meters` 默认都是 `0`，`simplify_tolerance_meters` 默认 `5`，`playback` 默认 `true`。每个源文件最大 8 MiB、最多 200,000 个原始点，发布资源最多 2,000 个点。

构建顺序固定为：隐私裁剪 → 统计 → 简化 → SHA-256 哈希。因此裁剪会影响所有公开坐标和统计值，但按距离裁剪不能匿名化轨迹：附近地标和路线形状仍可能暴露敏感地点。请根据自己的风险判断使用有意模糊的公开地点，并设置足够的裁剪距离。

距离、累计爬升和记录时长会在数据完整时由服务端渲染，禁用 JavaScript 也能阅读。轨迹不会自动播放；开启“减少动态效果”时，连续播放与重新播放不可用，但仍可手动拖动原生进度条。`playback: false` 只显示低调的完整轨迹线，不显示播放控件。

处理后的轨迹发布为 `hexo-post-map/tracks/<sha256>.json`；插件不会发布原始 GPX/GeoJSON 文件、文件名、路径、绝对时间戳、元数据或任意属性。内容哈希文件适合配置长期不可变 CDN 缓存，HTML 则继续使用站点通常的重新验证策略。发布新构建时，应保留旧哈希，直到新 HTML 和 CDN 缓存完成切换。

轨迹 JSON 只会由接近视口的文章详情地图请求。全国地图完全不会请求或暴露轨迹，`map/posts.json` 仍是只含代表点的版本 1 格式。获取、校验或 WGS84 到 GCJ-02 转换失败时，会保留地点图钉并退回 `route` 示意线。哈希资源地址会遵循 Hexo `root`，包括 `/blog/` 子路径部署。

## 位置与外观

默认卡片位于正文前，高 220px，小屏幕高 180px。`post.position: after` 放到正文后；`manual` 模式在正文中用标签指定位置：

```text
{% post_map %}
```

每篇文章最多一个标签；标签也可以覆盖 `before` 或 `after` 的自动位置。手动模式不写标签时，详情不显示地图，但文章仍进入全国地图。`post.enabled: false` 可以全站关闭详情卡片。

卡片接近视口时开始加载并自动允许交互。正常加载及成功状态保持静默；JavaScript、高德服务或地图初始化失败时，会显示简洁错误，同时保留地点链接。SDK 加载超时后，需要**刷新页面**才能重试。

详情地点使用内联 SVG 定位图钉。点击图钉，或聚焦后按 Enter、空格，会显示轻量的自定义地点名气泡；按 Escape、再次点击或点击地图空白处可关闭。单点图钉中央显示圆点；`route` 中的地点在相同图钉形状中按顺序编号，气泡显示“序号 · 地点名称”。插件不会打开地图服务商的信息窗，也不会添加外部地图链接。路线始终以直线示意段连接，不表示可导航道路。

代表图片按顺序选择第一个安全可用的来源：`thumbnail`、正文中最先出现的 `<img src>` 或 `.live-photo[data-photo-src]`、内置占位图。这样可以直接兼容 LivePhotosKit 风格的标记，并在地图上使用其实况照片静态图。已选中的图片若加载失败，则显示占位图。每篇文章只使用一张代表图片。

## 全国地图与重复访问

构建后访问 `/map/`，再按主题的菜单设置方式添加入口，插件不会修改主题或导航。Hexo 使用 `root: /blog/` 时，页面地址为 `/blog/map/`，数据地址为 `/blog/map/posts.json`；`overview.path` 仍写相对路径 `map/`，不要重复填写站点根路径。

地图初始视野包含全部文章代表位置。每张缩略图通过短线连接到可见坐标圆点，不会遮住位置锚点。文章根据当前缩放和屏幕距离自动合并或展开；聚合圆会随文章数量分为小、中、大三档，同时点击后仍通过缩放展开。如果放大不能分离文章，或已达到最大缩放，则打开与缩略图预览、**全部文章**入口共用的有界文章面板（移动端为底部抽屉）。面板限制最大高度，文章列表只在面板内部滚动。文章卡片统一使用 4:3 缩略图视窗，横图和竖图都居中裁切；标题最多两行，日期和地点保持单行。整个卡片都可进入文章。地图不可用时仍保留按时间排序的文章列表。

`cluster.grid_size` 必须是有限正数，单位为像素；`cluster.max_zoom` 范围为 2–20（含边界），默认 18。多篇文章可以填写完全相同的坐标。

全国地图默认使用主题的 `page` 布局；没有该布局时降级为独立页面，也可以通过 `overview.layout: standalone` 主动选择独立页面。兼容目标是正常渲染 `post.content` 的传统主题。兼容测试覆盖 Landscape、NexT 和精简 Cactus 风格布局，不等于所有主题改版均已验证。

### PJAX 与生命周期接入

启用插件后，每个 HTML 页面都会加载不含地图服务商代码的 `runtime.js`。普通页面不会加载地图界面资源或高德资源。首次打开的地图页面还会包含静态 CSS，保证禁用 JavaScript 时的降级内容可用；详情、全国地图的功能脚本（IIFE）和高德仍按需加载。常规 PJAX 在普通 DOM（light DOM）中插入、移除或替换地图内容时，插件会自动处理初始化和清理。

需要手动接入时，在运行时已加载且内容插入后调用以下方法，`container` 为已插入的容器元素：

```js
if (window.HexoPostMap?.apiVersion === 1) {
  window.HexoPostMap.refresh(container);
}
```

移除容器前可以调用 `window.HexoPostMap.destroy(container)`，但常规 PJAX 不要求这一步。两个方法都默认作用于 `document`，也接受属于当前文档的元素或文档片段；无效作用域会抛出 `TypeError`。方法会立即返回，不等待高德加载或初始化完成。关闭的或未被观察的 Shadow Root、其他文档、被禁止执行的运行时脚本，以及非标准页面切换方式，不在自动兼容保证内。

本地功能脚本或样式加载失败时，修复资源问题后可调用 `refresh(container)` 重试；高德 SDK 加载超时仍需完整刷新页面。完整接入边界和生命周期说明见[兼容性文档](https://github.com/xizidev/hexo-post-map/blob/main/docs/compatibility.md)。

### 主题定制

主题只能通过下列变量定制地图，并将覆盖限定在 `.hpm-detail`、`.hpm-overview` 或两者；不要依赖插件内部组件选择器。插件内置安全的浅色、深色、强制颜色和减少动态效果默认值。

| 变量                          | 用途                                 |
| ----------------------------- | ------------------------------------ |
| `--hpm-accent`                | 图钉、锚点、链接和焦点环             |
| `--hpm-accent-contrast`       | 强调色上的文字和边框                 |
| `--hpm-cluster-surface`       | 聚合圆表面                           |
| `--hpm-cluster-border`        | 聚合圆和缩略图边框                   |
| `--hpm-panel-surface`         | 支持背景滤镜时的玻璃面板表面         |
| `--hpm-panel-border`          | 文章面板边框                         |
| `--hpm-card-surface`          | 文章卡片、控件及面板的不透明降级背景 |
| `--hpm-text`                  | 主要文字                             |
| `--hpm-muted`                 | 日期、地点和次要边框                 |
| `--hpm-route-color`           | 详情地图的直线行程示意段             |
| `--hpm-track-color`           | 完整真实轨迹线                       |
| `--hpm-track-progress-color`  | 播放进度线和移动标记                 |
| `--hpm-track-control-surface` | 统计与播放控件表面                   |
| `--hpm-track-control-border`  | 统计与播放控件边框                   |
| `--hpm-tooltip-surface`       | 详情地点名气泡表面                   |
| `--hpm-tooltip-border`        | 详情地点名气泡边框                   |
| `--hpm-tooltip-shadow`        | 详情地点名气泡阴影                   |
| `--hpm-tooltip-text`          | 详情地点名气泡文字                   |
| `--hpm-panel-radius`          | 桌面面板和移动抽屉圆角               |
| `--hpm-card-radius`           | 文章卡片圆角                         |

## 排错与隐私

- 地图未出现：检查 `post_map.enabled: true`、`map.points`、手动模式标签，以及主题是否渲染正文。
- 构建报错：按错误中的文章路径和字段修正。启用后无效配置会使构建失败；未配置插件则不影响构建。
- 轨迹构建报错：检查文章相对本地路径的后缀、是否仍在源码树内、8 MiB/200,000 点上限，以及隐私裁剪后是否还剩可用几何。
- 空白或加载失败：检查 Key 类型、部署域名限制、安全模式是否唯一、代理是否可用、浏览器 CSP 报告及网络。修正配置或遇到 SDK 超时后刷新页面。
- 图片错误：使用安全的 HTTP(S) 或站点相对图片地址，确认外部访客也能访问。
- 敏感位置：使用城市或有意模糊后的坐标。详情中的全部坐标和全国地图位置都会公开。插件不会请求访客定位，但地图接近视口时即可能加载高德并联系第三方服务。

部署前请阅读[安全、CSP 与隐私说明](https://github.com/xizidev/hexo-post-map/blob/main/docs/security.md)。外部 SDK 不适合套用一份声称通用的 CSP，该文档列出已核实来源和 Report-Only 验证方法。

## 开发与反馈

[贡献指南](https://github.com/xizidev/hexo-post-map/blob/main/CONTRIBUTING.md)包含构建、npm 打包安装兼容测试、确定性浏览器测试及可选高德实网 smoke 的方法。普通问题使用 [GitHub Issues](https://github.com/xizidev/hexo-post-map/issues)，安全问题按 [SECURITY](https://github.com/xizidev/hexo-post-map/blob/main/SECURITY.md) 私下报告。

Front Matter、站点配置、文档列出的主题变量，以及带版本号的 `window.HexoPostMap` 生命周期 API 是公开契约；内部模块与地图适配器不是公开扩展 API。插件使用 MIT 许可证，高德服务另有自己的条款与使用要求。
