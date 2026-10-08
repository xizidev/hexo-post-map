# Overview Exploration v0.6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为全国文章地图加入可恢复的探索状态、安全分享和可选随机探索，保持现有静态博客、PJAX、详情地图和轨迹功能兼容。

**Architecture:** overview 专用纯模块负责文章引用、快照、会话缓存和分享协议；高德适配器只负责已验证视图，面板只负责选择与滚动。小型 exploration coordinator 组合这些能力，沿用现有 runtime 的根节点发现与销毁，不接管主题路由；分享降级 UI 和随机选择分别放在独立模块。

**Tech Stack:** TypeScript 6、Node.js >=20、Hexo >=7 <9、现有 esbuild/Vitest 3/Happy DOM/Playwright Chromium、AMap JS API 2.0；不新增依赖或第三方服务。

**Spec:** [已确认设计稿](../specs/2026-10-08-overview-exploration-design.md)，用户确认日期 2026-10-08。

## Global Constraints

- 工作目录：`/Users/hif/blog/blog_source/.codex-worktrees/hexo-post-map-v05`；分支 `codex/overview-exploration`；设计提交 `39680c89d9feff8cb9e2b4121633701d2cb5f6e1`，功能基线 v0.5.0 的 `2fbd9b14ebf7a926243e7dfb3f5172bbf6522372`。
- 沿用用户指定的子代理方式：各任务按依赖顺序实现、独立 review；不并行修改共享文件。主代理核对 diff 与测试证据，最后进行整分支 review。
- `restore: true`、`share: true`、`random: false`；严格布尔配置。旧 HTML 缺少探索配置或 `overviewUrl` 时关闭新增功能而保留地图。
- 不增加筛选、地图引擎、付费 API、后端、定位请求、轨迹回放改动或统计上报；高德自身的服务条件不等于插件许可证。
- Front Matter、GCJ-02 地点、WGS84 轨迹、`posts.json` version 1、固定资源路由、公开 runtime API version 1 不变。
- 新 JS 仅进入 overview 包；`runtime.js` 保持 provider-free 且压缩后 <=8,192 bytes；普通页面和详情页面不加载探索资源。
- 不调用 `history.pushState`、`history.replaceState`、`sessionStorage.clear()`、`execCommand`，不改变地址栏、主题 history state 或 `scrollRestoration`；不使用 localStorage、cookies、unload/beforeunload。
- 内存和 sessionStorage 都限制为 16 个作用域、每份快照 16 KiB UTF-8、有效期 2 小时；聚合组最多 128 个文章引用，200 ms 合并写入。
- 分享参数仅为 `hpm_v`、`hpm_center`、`hpm_zoom`、可选 `hpm_post`；版本 1，链接 <=4,096 个字符，中心最多 6 位小数、缩放最多 2 位小数。
- 分享使用当前浏览 origin 与构建时地图路由；只有字面终端 `index.html` 是目录别名，不解码百分号分隔符。文章只用当前数据集中的唯一安全 URL 引用。
- 自动恢复不抢焦点或滚动页面。按钮标签固定为“分享地图”“随机一站”，复制成功为“链接已复制”；交互区域 >=44 px。
- 随机目标缩放为 `min(max_zoom, max(current_zoom, 11))`；不抖动坐标，不自动进入文章或播放轨迹。
- 保持 package 版本 0.5.0 和 release-please 流程；本计划不授权 GitHub 推送、PR、保护规则 bypass、npm 发布、真实博客依赖变更或 OSS 上传。
- 本地浏览器地址只用 `127.0.0.1`。真实博客仅通过已有临时副本 smoke 验证，测试凭据、文章修改和构建产物不得写回真实博客。

## Review Focus

1. 中文、百分号和长引用按 UTF-8 字节限制，`%2F` 不得变成路由分隔符，未知或重复引用不得导航；Tasks 1、4 的边界测试固定此行为。
2. sessionStorage getter、读取、写入或淘汰分别抛错时，内存恢复仍工作；关闭恢复只能删除自己的当前作用域，Tasks 1、3 固定此行为。
3. fetch/provider 待定期间 PJAX 替换路由或根节点，旧 controller 不得应用旧 URL、创建新 UI 或覆盖新快照；Tasks 3、4、6 固定此行为。
4. 面板尺寸、字体或 content-visibility 改变时优先恢复文章锚点；滚动不得每像素测量全部卡片或重新加载图片，Tasks 2、6 固定此行为。
5. 同 origin 不同端口/根路径/数据源不得共用快照；存活 BFCache 和重复 refresh 不重新恢复，Tasks 1、3、6 固定此行为。

---

## File and Interface Map

以下路径均相对工作目录。所有新接口为内部接口，不扩大公开扩展 API。

| 文件                                                                                           | 职责                                                                     |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `src/browser/overview/exploration-types.ts`                                                    | 视图、滚动、面板、快照与开关的共同类型；不导入 SDK/DOM 实现。            |
| `src/browser/overview/post-index.ts`                                                           | 一次构建唯一安全 URL 索引和歧义集合，恢复、分享、随机共用。              |
| `src/browser/overview/snapshot.ts`                                                             | 纯快照白名单验证、引用解析、作用域和大小限制。                           |
| `src/browser/overview/snapshot-cache.ts`                                                       | 有界文档内存与 best-effort sessionStorage；可注入时间和 storage getter。 |
| `src/browser/providers/types.ts`、`amap-sdk.ts`、`amap-overview.ts`                            | 可选 overview 视图能力、初始视图、结束事件及清理。                       |
| `src/browser/overview/panel.ts`                                                                | 区分关闭原因、焦点选项、滚动锚点读写；保留延迟图片。                     |
| `src/browser/overview/exploration.ts`                                                          | 恢复优先级、候选快照、200 ms 合并、toolbar 与生命周期组合。              |
| `src/browser/overview/share.ts`、`share-controls.ts`                                           | 纯 v1 URL codec；用户触发复制与根节点内手动复制降级。                    |
| `src/browser/overview/random.ts`                                                               | 可注入 RNG 的等概率选择；不持有 DOM 或调用 SDK。                         |
| `src/browser/overview/index.ts`                                                                | 接入 coordinator 和面板 port；保留数据/provider 加载和失败处理。         |
| `src/config/{types,defaults,resolve}.ts`、`src/templates/overview.ts`、`src/hexo/generator.ts` | 严格开关、惰性 JSON 和已有 Hexo normalizer 生成的 `overviewUrl`。        |
| `src/browser/styles/index.css`                                                                 | toolbar 与手动复制框；复用既有 CSS tokens 和响应式边界。                 |
| `test/browser/overview-*.test.ts`、现有 config/generator/docs 测试                             | 新功能的纯函数、组件、生命周期和契约测试；既有 overview 测试保留。       |
| `e2e/overview-exploration.spec.ts`、现有 SDK/fixtures/PJAX/BFCache 测试                        | 发布产物上的桌面/移动、导航、分享与性能回归。                            |
| `README.md`、`README.zh-CN.md`、`docs/{configuration,compatibility,security,releases}.md`      | 可复制配置、真实兼容边界、隐私与降级说明。                               |

共享类型在 Task 1 定义一次，后续任务只引用：

```ts
type OverviewView = { readonly center: Coordinate; readonly zoom: number };
type ExplorationFlags = {
  readonly restore: boolean;
  readonly share: boolean;
  readonly random: boolean;
};
type PanelScroll = {
  readonly top: number;
  readonly anchor?: { readonly url: string; readonly offset: number };
};
type OverviewPanelState =
  | { readonly mode: 'closed' }
  | { readonly mode: 'all'; readonly scroll: PanelScroll }
  | { readonly mode: 'single'; readonly urls: readonly [string]; readonly scroll: PanelScroll }
  | { readonly mode: 'group'; readonly urls: readonly string[]; readonly scroll: PanelScroll };
type OverviewSnapshot = {
  readonly version: 1;
  readonly savedAt: number;
  readonly view: OverviewView;
  readonly panel: OverviewPanelState;
};
type OverviewPostIndex = {
  readonly unique: ReadonlyMap<string, OverviewPost>;
  readonly ambiguous: ReadonlySet<string>;
};
type SnapshotContext = {
  readonly now: number;
  readonly maxZoom: number;
  readonly index: OverviewPostIndex;
};
```

`Coordinate` 复用 `src/domain/types.ts` 的 readonly `[longitude, latitude]`；`OverviewPost` 复用现有模板类型。快照引用最多 4,096 个字符，滚动像素范围 `[0, 1_000_000]`、锚点偏移 `[-1_000_000, 1_000_000]`；这些内部界限不改变文章 URL 或坐标。

## Dependency and Delivery Order

`Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6`。每个任务先验证新增测试失败，再实现、验证通过、review、显式路径提交。功能实现阶段各步都记录真实测试结果，不将本计划中的 Expected 当成已运行证据。

### Task 1: 有界状态协议与会话缓存

**Files:** Create `src/browser/overview/{exploration-types,post-index,snapshot,snapshot-cache}.ts`；Test `test/browser/overview-snapshot.test.ts`、`test/browser/overview-cache.test.ts`。

**Interfaces:**

- Consumes: `Coordinate`、`OverviewPost`、现有 `safeUrl(value, 'post')`；索引额外拒绝 URL userinfo。
- Produces: 上述共享类型；`createPostIndex(posts: readonly OverviewPost[]): OverviewPostIndex`；`createSnapshot(view: OverviewView, panel: OverviewPanelState, context: SnapshotContext): OverviewSnapshot | undefined`；`readSnapshot(raw: unknown, context: SnapshotContext): OverviewSnapshot | undefined`；`encodeSnapshot(snapshot: OverviewSnapshot, context: SnapshotContext): string | undefined`。
- Produces: `createOverviewScope(origin: string, overviewUrl: string, dataUrl: string): string | undefined`；只使用 origin、地图 pathname、数据 origin/pathname，查询/片段不入作用域，userinfo 拒绝。
- Produces: `SnapshotCache` 的 `read(scope: string, context: SnapshotContext): OverviewSnapshot | undefined`、`save(scope: string, snapshot: OverviewSnapshot, context: SnapshotContext): void`、`remove(scope: string): void`；`createSnapshotCache(options: { storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined }): SnapshotCache`；`getDocumentSnapshotCache(owner: Window): SnapshotCache`。

- [ ] **Step 1: 写协议、索引和缓存的失败测试。** 各测试文件定义 `a`、`b` 为不同安全 URL 的 OverviewPost，`now = 10_000_000`，`view = { center: [121.49, 31.24], zoom: 11 }`；缓存 helper 只用内存 Storage 替身，不读真实浏览数据。

  ```ts
  it('closes an incomplete group but keeps its view', () => {
    const context = { now, maxZoom: 18, index: createPostIndex([a]) };
    const raw = {
      version: 1,
      savedAt: now,
      view,
      panel: { mode: 'group', urls: [a.url, b.url], scroll: { top: 400 } },
    };
    expect(readSnapshot(raw, context)).toMatchObject({ view, panel: { mode: 'closed' } });
    expect(readSnapshot({ ...raw, savedAt: now - 7_200_000 }, context)).toBeUndefined();
  });
  ```

  同步增加具名测试：`rejects nonfinite coordinates and unknown snapshot fields`、`clamps zoom to 2..maxZoom`、`ignores duplicate URL selection and anchor`、`stores all mode without post array`、`falls back to view-only above 128 refs or 16384 UTF-8 bytes`、`never serializes credentials images bodies or track metadata`、`isolates ports roots and data paths without decoding separators`、`retains the 16 most recently saved scopes`、`recovers from every storage exception using memory`。过期/未来时间、非法 mode 和损坏 JSON 拒绝整份快照；重复/未知/超长引用关闭 single/group，坏 anchor 丢弃并保留像素 fallback；负数 top clamp 到 0，过大 top/offset clamp 到上述界限。缓存删除测试断言不调用 clear、不碰其他 key。

- [ ] **Step 2: 验证红灯。** Run `npm run test:run -- test/browser/overview-snapshot.test.ts test/browser/overview-cache.test.ts`；Expected FAIL：新增模块/导出不存在。不得以 fixture 或配置错误替代预期失败。
- [ ] **Step 3: 实现纯协议和缓存。** 用一次 URL 索引避免重复扫描；对解析输入白名单校验，serialization 构造允许字段而非 spread 原输入。超限 group/单篇引用降为 closed，坏 scroll/anchor 降为有界像素；非法 view/版本/时间拒绝整个快照。作用域用结构化 tuple 序列化，不猜数据文件父路径。

  存储命名空间使用 `hexo-post-map.overview-state.v1`，文档共享对象使用 `Symbol.for('hexo-post-map.overview-cache.v1')`；memory 与 storage 都按保存时间淘汰到 16 项，时间有效区间为 `0 <= now - savedAt < 7_200_000`。storage envelope 只含 version、scope 和允许快照；读取长度先限制到 512 KiB，再解析并限项。storage getter 全部延迟访问且被 try/catch 包裹；先接受有效内存快照，再尝试持久化，失败不抛给地图。`remove` 仅删除当前 scope 的内存与插件 envelope 记录。

- [ ] **Step 4: 验证绿灯。** Run 同 Step 2 命令及 `npm run typecheck`；Expected 所有新增测试 PASS、typecheck exit 0。
- [ ] **Step 5: Review 后显式提交。**

  ```bash
  git add src/browser/overview/exploration-types.ts src/browser/overview/post-index.ts src/browser/overview/snapshot.ts src/browser/overview/snapshot-cache.ts test/browser/overview-snapshot.test.ts test/browser/overview-cache.test.ts
  git commit -m "feat: add bounded overview session snapshots"
  ```

### Task 2: 高德视图能力与不抢焦点的面板恢复

**Files:** Modify `src/browser/providers/{types,amap-sdk,amap-overview}.ts`、`src/browser/overview/panel.ts`、`test/browser/overview.test.ts`、`test/browser/amap-redraw.test.ts`；Create `test/browser/overview-view.test.ts`、`test/browser/overview-panel-state.test.ts`。

**Interfaces:**

- Consumes: Task 1 的 `OverviewView`、`PanelScroll`；现有 `MapHandle`、`OverviewMapOptions`、`renderPostPanel`。
- Produces: `OverviewMapHandle extends MapHandle`，可选 `getView(): OverviewView | undefined`、`setView(view: OverviewView, options: { immediately: boolean }): void`、`focusPost(post: OverviewPost, zoom: number, options: { immediately: boolean }): void`、`onViewEnd(listener: () => void): () => void`；以上四项以 `?` 标记，旧替身仍兼容。
- Produces: `OverviewMapOptions.initialView?: OverviewView`；`OverviewMapProvider.mountOverview(...): Promise<OverviewMapHandle>`。
- Produces: `AMapSdkMap.getCenter?(): { getLng(): number; getLat(): number }`、`setZoomAndCenter?(zoom: number, center: Coordinate, immediately: boolean, duration?: number): void`；读取复制成原始 tuple，不缓存 LngLat 对象。
- Produces: `PanelCloseReason = 'user' | 'replace' | 'teardown'`；PanelHandle 增加 `getScroll(): PanelScroll`、`restoreScroll(scroll: PanelScroll): void`，`destroy(reason?: PanelCloseReason): void` 默认 user。面板 options 增加 `focusOnOpen?: boolean`、`onScroll?: () => void`，`onClose?: (reason: PanelCloseReason) => void`。

- [ ] **Step 1: 写地图与面板失败测试。** 新测试中的 provider helper 使用现有 fake SDK 模式，`mounted` 为 resolved handle；面板 helper 给 scroller/rows 明确滚动几何，不假设 Happy DOM 自动布局。

  ```ts
  it('uses initial view instead of fitting posts', async () => {
    const mounted = await mountWithFakeSdk({ initialView: { center: [121.49, 31.24], zoom: 11 } });
    expect(mounted.handle.getView?.()).toEqual({ center: [121.49, 31.24], zoom: 11 });
    expect(mounted.map.setBounds).not.toHaveBeenCalled();
  });
  it('restores a panel without moving page focus', () => {
    outside.focus();
    const panel = renderPostPanel([a, b], 'mobile', { container: root, focusOnOpen: false });
    panel.restoreScroll({ top: 400, anchor: { url: b.url, offset: -12 } });
    expect(document.activeElement).toBe(outside);
    expect(panel.getScroll().anchor).toEqual({ url: b.url, offset: -12 });
  });
  ```

  增加 `detaches moveend zoomend and subscribers on destroy`、`ignores view callbacks before ready and after abort`、`keeps original representative coordinates and zoom bounds`、`preserves duplicate-coordinate clusters and no-op-fit zoom advance`、`distinguishes user close replacement and teardown`。覆盖锚点缺失/歧义、响应式卡片高度变化、content-visibility、像素 clamp 和 Escape；只有 user close 恢复焦点，focus 使用 preventScroll。验证 1,000 行滚动不进行全行 geometry 扫描或重建图片。

- [ ] **Step 2: 验证红灯。** Run `npm run test:run -- test/browser/overview-view.test.ts test/browser/overview-panel-state.test.ts`；Expected FAIL：可选视图/面板方法尚未提供。
- [ ] **Step 3: 实现适配器与面板能力。** `getCenter` 返回 LngLat，视图设置用 `setZoomAndCenter(zoom, center, immediately, duration?)`，订阅 moveend/zoomend；这些接口已按[官方 AMap 2.0 手册](https://a.amap.com/jsapi/static/doc/20230922/index.html#map)核验。同步 SDK 类型与单元测试替身；新的 SDK 成员保持可选，缺失时不暴露探索能力，普通 fitting 仍可用。initialView 在构造/complete 阶段优先于默认 fit；setView/focusPost 验证有限数值、坐标和 zoom，订阅在 ready 后启用并逐项清理，业务错误不输出 SDK 原始详情。

  面板在创建时建立 row/URL 索引；锚点只在合并 checkpoint 时读取，用有序 rows 的二分定位，禁止每次 scroll 全量测量。restoreScroll 在 DOM 已挂载后应用一次并限制实际范围；尺寸变化仍优先 URL+偏移。关闭/替换/teardown 都清理图片 observer 和监听器，只有 user close 回调恢复焦点；保留前 2 张立即加载和其余延迟图片规则。

- [ ] **Step 4: 验证绿灯与 provider 回归。** Run `npm run test:run -- test/browser/overview-view.test.ts test/browser/overview-panel-state.test.ts test/browser/overview.test.ts test/browser/amap-redraw.test.ts test/browser/amap.test.ts`，再 `npm run typecheck`；Expected 全部 PASS、监听/marker 不随重复操作增长、详情既有测试不退化。
- [ ] **Step 5: Review 后显式提交。**

  ```bash
  git add src/browser/providers/types.ts src/browser/providers/amap-sdk.ts src/browser/providers/amap-overview.ts src/browser/overview/panel.ts test/browser/overview.test.ts test/browser/amap-redraw.test.ts test/browser/overview-view.test.ts test/browser/overview-panel-state.test.ts
  git commit -m "feat: expose overview view and panel checkpoints"
  ```

### Task 3: 接通返回恢复、配置与 PJAX 生命周期

**Files:** Create `src/browser/overview/exploration.ts`、`test/browser/overview-exploration.test.ts`；Modify `src/browser/overview/index.ts`、`src/browser/styles/index.css`、`src/config/{types,defaults,resolve}.ts`、`src/templates/overview.ts`、`src/hexo/generator.ts`、`test/config/resolve.test.ts`、`test/hexo/generator.test.ts`、`test/browser/overview.test.ts`、`test/docs/examples.test.ts`、`README.md`、`README.zh-CN.md`、`docs/configuration.md`。

**Interfaces:**

- Consumes: Tasks 1–2 的快照/cache、OverviewMapHandle 和面板能力；`ResolvedPluginConfig.overview.exploration: ExplorationFlags`（服务端定义同结构配置类型，不导入浏览器实现）。模板新增必需 `OverviewTemplateModel.overviewUrl: string`；所有 renderOverview 调用点显式传入。
- Produces: `readBrowserExplorationConfig(raw: unknown, origin: string): { readonly overviewUrl: string; readonly flags: ExplorationFlags } | undefined`，缺字段或不安全配置仅禁用新功能，不使旧地图失败。
- Produces: `OverviewPanelPort`：`read(): OverviewPanelState`、`open(state: OverviewPanelState, options: { focus: boolean; origin?: HTMLElement; resolveOrigin?: FocusOriginResolver }): void`。
- Produces: `ExplorationOptions` 包含 `root`、`canvas`、`toolbar`、`showList`、`overviewUrl`、`dataUrl`、`flags`、`maxZoom`、`posts`、`panel: OverviewPanelPort` 和 `isCurrent: () => boolean`；HTMLElement/readonly post 等类型沿用现有定义。
- Produces: `createExplorationController(options: ExplorationOptions): ExplorationController`；controller 提供 readonly `initialView?: OverviewView`、`activate(handle: OverviewMapHandle): void`、`changed(): void`、`isCurrent(): boolean`、`destroy(options: { save: boolean }): void`。Task 4 在此接口内加入分享优先级，调用者不改签名。

- [ ] **Step 1: 写配置、SSR 和恢复失败测试。** config helper 使用现有 validConfig；controller helper 提供完整可选能力、独立内存 storage、可控时间和 fake timers，并允许把旧 handle 换成仅 MapHandle。对 exploration 的 null/array/未知 key、三项各自的 string/number/null 写参数化 ConfigValidationError.fieldPath 断言，错误文本不包含值或凭据；同时验证 defaults 深冻结。

  ```ts
  it('defines strict exploration defaults', () => {
    expect(resolveConfig(validConfig, {})?.overview.exploration).toEqual({
      restore: true,
      share: true,
      random: false,
    });
  });
  it('coalesces saves and preserves an open panel on teardown', async () => {
    const f = await explorationFixture({ restore: true, share: false, random: false });
    f.openAll();
    f.emitViewEnd(20);
    vi.advanceTimersByTime(199);
    expect(f.storage.setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(f.storage.setItem).toHaveBeenCalledTimes(1);
    f.destroy();
    expect(f.readSaved()?.panel.mode).toBe('all');
  });
  ```

  增加 `restores memory before session without taking focus`、`persists user close as closed`、`does not save failed partial initialization`、`ignores late old-controller timers after replacement`、`reads current URL only after data and provider readiness`、`does not restore twice on refresh or persisted pageshow`、`clears only this scope when restore is false`、`leaves all-off legacy HTML and legacy handles usable`。明确断言 getter 抛错的 PJAX 内存恢复；不同 live 根各自面板不串扰；不调用 history/scrollRestoration/unload。SSR 测试断言 `/map/`、`/blog/map/`、中文/百分号自定义 path 的 overviewUrl 来自 publicUrl，detail JSON 和 posts.json 无新增字段。

- [ ] **Step 2: 验证红灯。** Run `npm run test:run -- test/config/resolve.test.ts test/hexo/generator.test.ts test/browser/overview-exploration.test.ts`；Expected FAIL：缺失配置/SSR 字段及 coordinator。
- [ ] **Step 3: 实现恢复与配置。** 将 exploration 嵌套对象加入现有严格 validator/defaults/deepFreeze；generator 调用已有 `publicUrl(config.overview.path, hexo, 'post')` 传递 overviewUrl，仅 overview 惰性 JSON 暴露开关。

  数据和 provider 代码 ready 后、mount 前创建 coordinator，检查 root/config 当前性，读取 memory→session，传递 initialView；成功且 handle 完整时才 activate/恢复面板。view end/面板变化更新有效候选，scroll 只调度 checkpoint；一个 200 ms timer 合并读取/序列化，离开在 SDK 销毁前刷新最后有效候选。teardown 不把面板记为 closed；旧 controller 的 timer/回调依靠世代和根节点身份失效，不能写回新 controller；无效 DOM 不重新生成候选。失败路径 `destroy({ save: false })`，正常离开 `destroy({ save: true })`。persisted pagehide 仅 checkpoint，不 destroy；不增 unload/beforeunload。

  index.ts 只实现 panel port 与组合调用；配置文本、toolbar 和新控件纳入 isCurrent，同根重复 refresh 复用 controller。CSS 在本任务先使全部文章按钮位于 toolbar 且保持原有布局，后续按钮沿用该容器。缺能力不应用/保存恢复、不显示新操作；旧 HTML 不读取恢复。restore:false 执行作用域清除但不捕获后续状态。README 中英文与 configuration 同时加入严格开关、2 小时/当前标签页/16 scope 边界、不会逐条历史回放的说明。

- [ ] **Step 4: 验证绿灯。** Run `npm run test:run -- test/config/resolve.test.ts test/hexo/generator.test.ts test/browser/overview-exploration.test.ts test/browser/overview.test.ts test/browser/runtime.test.ts test/browser/runtime-resources.test.ts test/docs/examples.test.ts`，再 `npm run typecheck`；Expected 全部 PASS，文档示例可解析且字段一致。
- [ ] **Step 5: Review 后显式提交。**

  ```bash
  git add src/browser/overview/exploration.ts src/browser/overview/index.ts src/browser/styles/index.css src/config/types.ts src/config/defaults.ts src/config/resolve.ts src/templates/overview.ts src/hexo/generator.ts test/browser/overview-exploration.test.ts test/browser/overview.test.ts test/config/resolve.test.ts test/hexo/generator.test.ts test/docs/examples.test.ts README.md README.zh-CN.md docs/configuration.md
  git commit -m "feat: restore overview exploration across navigation"
  ```

### Task 4: v1 安全分享与手动复制降级

**Files:** Create `src/browser/overview/share.ts`、`src/browser/overview/share-controls.ts`、`test/browser/overview-share.test.ts`、`test/browser/overview-share-controls.test.ts`；Modify `src/browser/overview/exploration.ts`、`src/browser/styles/index.css`、`test/browser/overview-exploration.test.ts`、`README.md`、`README.zh-CN.md`、`docs/configuration.md`、`docs/security.md`。

**Interfaces:**

- Consumes: OverviewView、OverviewPanelState、OverviewPostIndex、coordinator 的 panel port、可选 getView。
- Produces: `OverviewShareState` 为 `{ readonly view: OverviewView; readonly postUrl?: string }`；`ShareContext` 为 `{ readonly origin: string; readonly overviewUrl: string; readonly maxZoom: number; readonly index: OverviewPostIndex }`。
- Produces: `readOverviewShare(locationHref: string, context: ShareContext): OverviewShareState | undefined`；`createOverviewShare(view: OverviewView, panel: OverviewPanelState, context: ShareContext): string | undefined`。
- Produces: `createShareControls(options: { root: HTMLElement; toolbar: HTMLElement; getLink: () => string | undefined; isCurrent: () => boolean }): { readonly button: HTMLButtonElement; isCurrent(): boolean; destroy(): void }`。clipboard 仅在 button click 内访问，不加全局权限管理器。

- [ ] **Step 1: 写 codec 和 UI 失败测试。** context 固定为 `{ origin: 'http://127.0.0.1:4000', overviewUrl: '/blog/map/', maxZoom: 18, index: createPostIndex([a]) }`，其中 a.url 为 `/blog/上海%2F外滩/`。构造 link 后用 URLSearchParams 检查，不依赖参数转义后的视觉字符串。

  ```ts
  it('shares only public plugin parameters at the current origin', () => {
    const link = createOverviewShare(
      { center: [121.491234567, 31.241234567], zoom: 11.123 },
      { mode: 'single', urls: ['/blog/上海%2F外滩/'], scroll: { top: 800 } },
      context,
    )!;
    const url = new URL(link);
    expect(url.origin).toBe('http://127.0.0.1:4000');
    expect(url.pathname).toBe('/blog/map/');
    expect(url.searchParams.get('hpm_center')).toBe('121.491235,31.241235');
    expect(url.searchParams.get('hpm_zoom')).toBe('11.12');
    expect(url.searchParams.get('hpm_post')).toBe('/blog/上海%2F外滩/');
    expect([...url.searchParams.keys()]).toEqual(['hpm_v', 'hpm_center', 'hpm_zoom', 'hpm_post']);
    expect(url.hash).toBe('');
  });
  ```

  增加 `rejects duplicate or unknown hpm keys invalid version and oversized input`、`matches only the literal map route and terminal index.html alias`、`rejects nonfinite center without invalidating map`、`downgrades unknown ambiguous or malicious post references to view-only`、`drops overlong article ref to keep link within 4096 characters`、`shares group and all as view-only`、`explicit share wins over both caches`、`share false never consumes query`。UI 测试覆盖点击才复制、成功 aria-live、getter/Promise 拒绝或 API 缺失时只读 input、label、关闭/Escape/focus、无 execCommand、销毁后 Promise 不创建 UI；输出不含 Key、安全密钥、proxy、image/body/track。

- [ ] **Step 2: 验证红灯。** Run `npm run test:run -- test/browser/overview-share.test.ts test/browser/overview-share-controls.test.ts test/browser/overview-exploration.test.ts`；Expected FAIL：codec/控件尚未实现、显式 share 未优先。
- [ ] **Step 3: 实现 codec、优先级和控件。** URL 构造仅用当前 origin+overviewUrl 和白名单参数；长度先限 4,096，逐键防重复/未知版本，数值严格解析，不额外 decode 文章引用，不将参数变成 href/fetch。只有完全有效视图生效；single 从 index 查找，未知/歧义降级。coordinator mount 前采用 share→memory→session→default，成功后开单篇但 focus:false；share:false 完全跳过解析。

  成功 mount 后放入“分享地图”；用户点击以实时 getView/panel 生成链接。失败、pending 或无完整能力不显示。clipboard 成功反馈“链接已复制”，失败根内渲染带 label 的 readonly input、小关闭按钮；Escape 和关闭返回分享按钮并 preventScroll。控制自身拥有 aria-live，错误只降级分享；Promise 回调先检查 current/disposed，不承诺取消已提交的 OS 写入。toolbar/复制框使用既有 tokens，手机不遮 attribution/面板关闭，forced-colors/reduced-motion 仍可用。同步中英文 README、配置和 security 的 v1 参数/两种 root/手动复制/非保密边界说明。

- [ ] **Step 4: 验证绿灯。** Run 同 Step 2 命令，加 `npm run test:run -- test/docs/examples.test.ts test/browser/provider-bundles.test.ts` 和 `npm run typecheck`；Expected 全部 PASS，share 不进入 runtime/detail bundle。
- [ ] **Step 5: Review 后显式提交。**

  ```bash
  git add src/browser/overview/share.ts src/browser/overview/share-controls.ts src/browser/overview/exploration.ts src/browser/styles/index.css test/browser/overview-share.test.ts test/browser/overview-share-controls.test.ts test/browser/overview-exploration.test.ts README.md README.zh-CN.md docs/configuration.md docs/security.md
  git commit -m "feat: share overview views and article previews"
  ```

### Task 5: 可选随机一站

**Files:** Create `src/browser/overview/random.ts`、`test/browser/overview-random.test.ts`；Modify `src/browser/overview/exploration.ts`、`src/browser/styles/index.css`、`test/browser/overview-exploration.test.ts`、`README.md`、`README.zh-CN.md`、`docs/configuration.md`。

**Interfaces:**

- Consumes: 一次构建的 OverviewPostIndex、OverviewMapHandle.focusPost、现有 panel port；current single 为唯一 URL，否则 undefined。
- Produces: `chooseRandomPost(index: OverviewPostIndex, excludedUrl: string | undefined, rng: () => number): OverviewPost | undefined`；`randomTargetZoom(currentZoom: number, maxZoom: number): number`。coordinator 私有 lastRandomUrl 只属于当前 controller。

- [ ] **Step 1: 写确定性选择和交互失败测试。** `a`、`b`、`c` 为三篇唯一安全 URL 文章；固定 rng 覆盖候选序列端点和等宽区间。

  ```ts
  it('avoids immediate repeats and never samples an empty set', () => {
    const rng = vi.fn(() => 0);
    expect(chooseRandomPost(createPostIndex([]), undefined, rng)).toBeUndefined();
    expect(rng).not.toHaveBeenCalled();
    expect(chooseRandomPost(createPostIndex([a, b]), a.url, rng)).toBe(b);
    expect(chooseRandomPost(createPostIndex([a]), a.url, rng)).toBe(a);
    expect(randomTargetZoom(4, 18)).toBe(11);
    expect(randomTargetZoom(15, 18)).toBe(15);
    expect(randomTargetZoom(4, 8)).toBe(8);
  });
  ```

  增加 `excludes unsafe empty and duplicate URLs`、`samples remaining candidates in equal intervals`、`defaults random off and hides zero-candidate button`、`excludes current single before last random choice`、`keeps coordinates exact and honors reduced motion`、`rapid clicks and disposal cannot reopen an old panel`。交互断言只打开预览并允许用户 focus，location/history/fetch/track-playback 不调用；开关关闭时 RNG 不调用，候选仅用已有 index。

- [ ] **Step 2: 验证红灯。** Run `npm run test:run -- test/browser/overview-random.test.ts test/browser/overview-exploration.test.ts`；Expected FAIL：选择模块或按钮缺失。
- [ ] **Step 3: 实现纯选择与按钮。** 保留唯一安全候选顺序；>=2 时排除指定 URL，均匀取剩余集合，只有 1 篇允许重复，0 篇不 RNG。非法 RNG 返回值不操作地图。目标 zoom 按确切公式，focusPost 不改变代表坐标；coordinator 成功 mount、random:true、有候选时才显示“随机一站”。每次动作使用当前操作世代，视图结束只保存视图，不异步重新打开先前面板；减少动态效果时 immediately:true。关闭和新操作使过期结果无权更新面板。中英文 README 和配置示例同时说明可选、无后台请求、只预览不自动导航。
- [ ] **Step 4: 验证绿灯。** Run 同 Step 2 命令及 `npm run test:run -- test/browser/overview.test.ts test/docs/examples.test.ts`、`npm run typecheck`；Expected 全部 PASS，已有图片/聚合/全部文章行为保留。
- [ ] **Step 5: Review 后显式提交。**

  ```bash
  git add src/browser/overview/random.ts src/browser/overview/exploration.ts src/browser/styles/index.css test/browser/overview-random.test.ts test/browser/overview-exploration.test.ts README.md README.zh-CN.md docs/configuration.md
  git commit -m "feat: add optional random article exploration"
  ```

### Task 6: 发布产物回归、真实博客副本验收与文档封口

**Files:** Create `e2e/overview-exploration.spec.ts`；Modify `e2e/fake-sdk.ts`、`e2e/fixtures.ts`、`e2e/pjax-runtime.spec.ts`、`e2e/bfcache.spec.ts`、`e2e/accessibility.spec.ts`、`test/browser/provider-bundles.test.ts`、`test/integration/{pack-and-build.mjs,generated-output.test.ts,real-blog-smoke.mjs,real-blog-smoke.test.ts}`、`test/docs/examples.test.ts`、`README.md`、`README.zh-CN.md`、`docs/compatibility.md`、`docs/security.md`、`docs/releases.md`。

**Interfaces:**

- Consumes: Tasks 1–5 的实际打包产物、既有 network fixture、SDK Map 和 runner-lifecycle 临时目录/审计机制；不导入源码替代浏览器 bundle。
- Produces: fixtures.ts 新增 `installOverviewExplorationFixture(page: Page, options: { count: number; flags: ExplorationFlags }): Promise<void>`，仅改测试 HTML/数据；唯一 URL 使用存在的普通文章路径加公开测试 query，保留真实点击导航。e2e 文件内的 `clickVisibleArticle(page: Page): Promise<void>` 选当前 scroller 中完整可见的卡片，避免先滚到被遮挡的首行。
- Produces: fake SDK 的 getCenter/setZoomAndCenter/结束事件/销毁实现与已核验的 AMap 契约一致；完整导航、标准 PJAX、真正 BFCache、分享新标签、密集列表回归和 packed 输出断言。
- Produces: 可核对的最终验收报告：运行环境、命令、通过数、skip 原因、真实博客零变更审计、未发布状态；保留既有 CI Node 20/22/24 × Hexo 7.1.1/7.3.0/8.1.2 矩阵和 theme/root 组合。

- [ ] **Step 1: 写面向发布产物的失败验收测试。** 桌面/移动参数化；30/1,000 篇 synthetic fixture 给每篇唯一 URL，另留现有重复 URL fixture 作歧义回归。全导航返回强制新文档和真 BFCache 分开测，不用 request routing 的测试冒充真 BFCache。

  ```ts
  test('returns with view panel and scroll but no stolen focus', async ({ page, network }) => {
    await installOverviewExplorationFixture(page, {
      count: 30,
      flags: { restore: true, share: true, random: false },
    });
    await page.goto('/blog/map/');
    await page.getByRole('button', { name: /^全部文章/ }).click();
    const scroller = page.locator('.hpm-panel__scroller');
    await scroller.evaluate((node) => {
      node.scrollTop = 400;
    });
    await clickVisibleArticle(page);
    await page.goBack();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBe(400);
    await expect(page.getByRole('button', { name: '关闭文章面板' })).not.toBeFocused();
    const requested = Object.keys(network.local);
    expect(
      requested.filter(
        (path) => path.includes('/hexo-post-map/tracks/') || /\.(gpx|geojson)$/u.test(path),
      ),
    ).toEqual([]);
  });
  ```

  用 network 记录实际请求集合而非只查单个假路径，断言 restore/share/random 不增正文、GPX/GeoJSON 或轨迹请求。继续增加具名验收：`new tab share wins over receiver cache`、`clipboard denied is keyboard-operable`、`ordinary-page query is ignored`、`replacement while pending cannot mutate new root`、`refresh and live BFCache keep one controller`、`random preview does not navigate`、`large-list scroll keeps row nodes and loaded-image requests stable`。最后一项比较原 row 节点、完整 measurement 调用计数和同 URL 图片请求次数，而非易波动的硬编码 FPS；检查移动 toolbar 不盖 attribution/关闭按钮，所有 target >=44 px，forced-colors/reduced-motion 可用。

- [ ] **Step 2: 验证红灯。** Run `npm run test:e2e -- e2e/overview-exploration.spec.ts`；Expected 初始 FAIL 定位到 e2e/fake-sdk.ts 尚未提供已核验视图能力或 packed/runner 缺少探索契约，不能由无浏览器/服务安装失败冒充。已经满足验收的行为不要求人为破坏实现来制造红灯；任何实际功能缺口回到所属任务补失败单元测试和实现后重新 review。
- [ ] **Step 3: 补齐替身、packed 契约和交付文档。** SDK fixture 真实保存 center、zoom，视图改变触发结束事件并在销毁后失效；仅测试 helper 可控时间/随机，不改变生产逻辑。packed matrix 断言 overviewUrl/root/探索默认值、显式全关、strict 无效值错误和 detail/posts.json 字段不变。real-blog runner 仍只修改 temporary copy、使用 dummy credentials、保留 cancellation 和 repository byte audit。最终文档准确写明传统导航/PJAX/URL-only 路由边界、2 小时 session 非账户收藏、storage/clipboard 降级、旧 HTML、免费插件与高德条件；releases 只记录待发布功能，不伪造 0.6 tag/npm 已发布。
- [ ] **Step 4: 执行完整验证并逐项记录。**

  Run `npm run check`、`npm run test:e2e`、`npm run test:integration`、`node test/integration/real-blog-smoke.mjs`、`git diff --check`。Expected 各命令 exit 0；本地 integration 覆盖当前 Node 上所有 Hexo/theme/root cells，其他 Node majors 的运行必须由实际环境/CI 提供，不冒充已覆盖。检查 runtime 压缩体积 <=8,192 bytes 和 provider/overview/detail import 边界；快照与分享链接不泄露 source/track/config 凭据，不把本来公开的 SDK 配置字段误判为分享内容。

  `npm run test:amap-smoke` 只在已有合法测试凭据可用时执行，不读取/复制真实博客密钥。凭据门控跳过如实列出，不能写成实网验证通过。真 BFCache 用现有独立 Chromium/CSP 本地服务器；只监听 127.0.0.1。真实博客审计必须证明没有源码、配置、依赖、凭据或 public 变更。

- [ ] **Step 5: Review 后显式提交验收与文档。**

  ```bash
  git add e2e/overview-exploration.spec.ts e2e/fake-sdk.ts e2e/fixtures.ts e2e/pjax-runtime.spec.ts e2e/bfcache.spec.ts e2e/accessibility.spec.ts test/browser/provider-bundles.test.ts test/integration/pack-and-build.mjs test/integration/generated-output.test.ts test/integration/real-blog-smoke.mjs test/integration/real-blog-smoke.test.ts test/docs/examples.test.ts README.md README.zh-CN.md docs/compatibility.md docs/security.md docs/releases.md
  git commit -m "test: verify overview exploration release boundaries"
  ```

## Final Acceptance and Handoff

- [ ] 各任务的失败→通过、review 结果与提交路径均可复核；没有混入真实博客或其他工作树变更。
- [ ] 整分支 review 对照设计稿检查数据校验、focus、race/销毁、超限、性能和兼容边界；发现缺口先补回归再修复。
- [ ] 主代理重新运行最终验证，报告实际通过/skip 项，不沿用上一任务的旧输出当结论。
- [ ] 交付隔离分支与本地验收说明；只有之后获得相应发布授权，才进入 PR/合并/release-please/npm/真实博客升级。

本计划待用户整体 review。确认后按已有子代理方式逐项执行，不再逐项询问已确定的配置、范围或设计选择。
