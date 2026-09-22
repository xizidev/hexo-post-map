# hexo-post-map

[English](README.md)

为 Hexo 文章添加矮地图卡片，并生成汇集全站文章的地图页面。通过 Front Matter 描述单个地点、多个地点或行程示意线；全国地图根据缩放自动聚合文章，同一地点的多次访问可展开为文章列表。

需要 **Node.js 20 及以上**、**Hexo 7 或 8**。插件使用高德 JS API 2.0，坐标统一为 **GCJ-02**。当前控件及降级提示使用中文。

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
  cluster:
    grid_size: 60
    max_zoom: 18
  amap:
    key: replace-with-your-web-key
    security:
      security_js_code: replace-with-your-security-js-code
```

以上凭据均为占位符。`amap.key` 和 `amap.security.security_js_code` 分别填写高德控制台生成的 Key 和安全密钥；不要同时再配置 `service_host`。

### 申请高德 Key

1. 注册并登录[高德开放平台](https://console.amap.com/)，进入“应用管理”，创建应用。
2. 在应用中添加 Key，服务平台选择 **Web 端（JS API）**，不要选择“Web 服务”。
3. 复制生成的 **Key** 和 **安全密钥（securityJsCode）**，填入上面的 `_config.yml`。
4. 按高德控制台的安全设置配置实际使用域名；本地预览时也要确认当前开发地址符合控制台限制。

2021 年 12 月 2 日后申请的 JS API Key 必须配合安全密钥使用，具体要求见[高德 JS API 准备说明](https://lbs.amap.com/api/javascript-api-v2/prerequisites)。

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

全国地图默认使用主题的 `page` 布局；没有该布局时降级为独立页面，也可以通过 `overview.layout: standalone` 主动选择独立页面。兼容目标是正常渲染 `post.content` 的传统主题；SPA/PJAX 主题可能需要单独适配导航生命周期，插件不会自动重新初始化。兼容测试覆盖 Landscape、NexT 和精简 Cactus 风格布局，不等于所有主题改版均已验证。

### 主题定制

主题只能通过下列变量定制地图，并将覆盖限定在 `.hpm-detail`、`.hpm-overview` 或两者；不要依赖插件内部组件选择器。插件内置安全的浅色、深色、强制颜色和减少动态效果默认值。

| 变量                    | 用途                                 |
| ----------------------- | ------------------------------------ |
| `--hpm-accent`          | 图钉、锚点、链接和焦点环             |
| `--hpm-accent-contrast` | 强调色上的文字和边框                 |
| `--hpm-cluster-surface` | 聚合圆表面                           |
| `--hpm-cluster-border`  | 聚合圆和缩略图边框                   |
| `--hpm-panel-surface`   | 支持背景滤镜时的玻璃面板表面         |
| `--hpm-panel-border`    | 文章面板边框                         |
| `--hpm-card-surface`    | 文章卡片、控件及面板的不透明降级背景 |
| `--hpm-text`            | 主要文字                             |
| `--hpm-muted`           | 日期、地点和次要边框                 |
| `--hpm-route-color`     | 详情地图的直线行程示意段             |
| `--hpm-tooltip-surface` | 详情地点名气泡表面                   |
| `--hpm-tooltip-border`  | 详情地点名气泡边框                   |
| `--hpm-tooltip-shadow`  | 详情地点名气泡阴影                   |
| `--hpm-tooltip-text`    | 详情地点名气泡文字                   |
| `--hpm-panel-radius`    | 桌面面板和移动抽屉圆角               |
| `--hpm-card-radius`     | 文章卡片圆角                         |

## 排错与隐私

- 地图未出现：检查 `post_map.enabled: true`、`map.points`、手动模式标签，以及主题是否渲染正文。
- 构建报错：按错误中的文章路径和字段修正。启用后无效配置会使构建失败；未配置插件则不影响构建。
- 空白或加载失败：检查 Key 类型、部署域名限制、安全模式是否唯一、代理是否可用、浏览器 CSP 报告及网络。修正配置或遇到 SDK 超时后刷新页面。
- 图片错误：使用安全的 HTTP(S) 或站点相对图片地址，确认外部访客也能访问。
- 敏感位置：使用城市或有意模糊后的坐标。详情中的全部坐标和全国地图位置都会公开。插件不会请求访客定位，但地图接近视口时即可能加载高德并联系第三方服务。

部署前请阅读[安全、CSP 与隐私说明](https://github.com/xizidev/hexo-post-map/blob/main/docs/security.md)。外部 SDK 不适合套用一份声称通用的 CSP，该文档列出已核实来源和 Report-Only 验证方法。

## 开发与反馈

[贡献指南](https://github.com/xizidev/hexo-post-map/blob/main/CONTRIBUTING.md)包含构建、npm 打包安装兼容测试、确定性浏览器测试及可选高德实网 smoke 的方法。普通问题使用 [GitHub Issues](https://github.com/xizidev/hexo-post-map/issues)，安全问题按 [SECURITY](https://github.com/xizidev/hexo-post-map/blob/main/SECURITY.md) 私下报告。

Front Matter 和站点配置是公开契约；内部模块与地图适配器不是公开扩展 API。插件使用 MIT 许可证，高德服务另有自己的条款与使用要求。
