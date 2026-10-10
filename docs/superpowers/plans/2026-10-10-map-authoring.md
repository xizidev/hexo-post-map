# Map Authoring Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供只在 127.0.0.1 运行的地图选点助手，支持地点、代表点和行程示意线编辑，安全导入并生成现有文章契约的 `map:` YAML。

**Architecture:** Hexo Console 命令按需加载独立的作者服务与页面；草稿模型和 YAML 适配保持纯数据逻辑，高德适配只处理地图交互。作者资产打包到 `dist/author/`，与公开读者资源、文章加载及轨迹编译隔离。

**Tech Stack:** TypeScript、Node 内置 HTTP/crypto、现有 YAML 与 Zod、esbuild、高德 JS API 2.0 加载器、Vitest/Happy DOM、Playwright。

**Spec:** [地图选点助手设计](../specs/2026-10-09-map-authoring-design.md)

状态：实施计划待整体审阅及执行方式确认；下面的命令和 Expected 是执行要求，不是已经完成的验证。

## Global Constraints

- 基于 v0.6.1；Node >=20、Hexo >=7 <9，保留 Node 20/22/24 与 Hexo 7/8 的兼容矩阵。不安装新的全局 CLI、不添加新的地图引擎或收费必选服务。
- `npx hexo post-map-editor --port 4001`；默认 4001，只绑定 `127.0.0.1`；CLI 端口限 1–65535 整数，不支持 `--host`。端口冲突失败，不终止其他进程或自动换端口。
- 作者命令不调用文章 load/generate/deploy/watch，不写 `source/`、`public/`、配置或数据库；区分 Hexo 初始化本身的行为。普通构建与服务不启动作者监听。
- 原 Front Matter/schema、GCJ-02、坐标精度、读者 API 与版本 1 数据协议不变；无 `place_id`、导航、搜索、逆地理编码、自动定位或轨迹编辑。
- 输入/输出各不超过 128 KiB UTF-8，地点不超过 200，线路引用不超过 1000；别名展开上限 50。不截断数据，不收紧正常文章构建的限制。
- 草稿仅在页面内存中；无 localStorage/sessionStorage、自动保存、源文章读写或 beforeunload。常驻“刷新或关闭页面会清空草稿，请导出后保存”。
- HTML/脚本不含凭据；bootstrap 只提供协议约定字段。每次启动使用新的 256 位令牌，片段 `#session=` → `X-HPM-Editor-Session`，不进入查询、应用存储、YAML 或高德请求。
- 精确 Host/Origin 检查，固定资源白名单，无 CORS 放行或通用代理；响应 `no-store`、`strict-origin`、`nosniff`、`DENY`。除显式本次访问地址外不记录令牌，不输出凭据、完整 YAML 或源路径。
- 现有 `dist/assets/` 五项资源白名单不变，`runtime.js` <=8192 字节；读者依赖图不引入作者模型、YAML、HTTP 或作者 UI。
- 手动编辑与导出不依赖地图；错误不清空有效草稿。只读 track 保留原字段、值和省略状态，不读取文件或注入归一化默认值。
- 新建 zoom 可选且 2–20，默认不输出；导入的任何有限 zoom 保留并提示预览限制。空地图 `[104, 35]`、zoom 4；地图视野不回写草稿 zoom。
- 桌面左右布局、移动端上下布局，列表内部滚动；控件目标至少 44 px；键盘、可见标签/焦点、浅深色、强制颜色及减少动态效果可用；不遮挡高德署名、不增加全图毛玻璃。
- 用户本地体验并明确认可之前，禁止版本提升、发布分支合并、标签、GitHub Release 和 npm 发布；不上传 OSS。预览及测试不代表发布许可。
- 开始实现时重新核对分支、HEAD 和脏文件；按 worktree 技能落实隔离。保存博客已有修改，暂不改真实博客依赖、配置或文章；每次提交只暂存任务路径。

## Review Focus

1. 空白和未完成的指数坐标不能被当作零提交；完整有限指数按数值校验，输入错误时旧 YAML 不得冒充当前导出。Task 5 固定测试。
2. 删除导入点后新增同名或同坐标点不能复用旧 ID、继承旧路线；删除代表点后即使只剩一处也必须重新选择。Task 1 固定测试。
3. YAML 别名循环、多字节边界和 `__proto__` 字段不得绕过数量/结构校验或改变对象原型。Task 2 固定测试。
4. 重复 Host、跨站 Origin、失效令牌、编码路径穿越及重启后旧 URL 不能读取凭据；4000 端口博客进程不受影响。Tasks 3、6、7 固定测试。
5. 导入替换、pagehide/BFCache 和迟到 SDK/剪贴板回调不能覆盖新草稿、重复绑定或在销毁后更新 UI。Tasks 4、5、7 固定测试。

---

## File and Interface Map

路径相对插件仓库；新增接口均为内部接口，不挂到 `window.HexoPostMap`。

| 文件                                                            | 责任                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------ |
| `src/author/{types,limits,draft}.ts`                            | 草稿、稳定 ID、代表点和线路关系；无 SDK/DOM。                |
| `src/author/yaml.ts`                                            | 有界 YAML 解析、现有领域校验、保留原始 track、导出往返检查。 |
| `src/author/{protocol,config,server,entry}.ts`                  | 最小 bootstrap、配置提取、固定 HTTP 路由、包内资产定位。     |
| `src/hexo/author-command.ts`、`src/hexo/register.ts`            | 命令注册、参数、按需 require、Hexo 停止生命周期。            |
| `src/browser/author/{map,marker}.ts`                            | SDK 加载、候选点、图钉选择/拖动、示意线与覆盖物清理。        |
| `src/browser/author/{controller,view,export-controls,index}.ts` | 表单状态、增量 DOM、导入确认、导出反馈、页面生命周期。       |
| `src/author/editor.html`、`src/browser/author/style.css`        | 不含站点数据的独立页面与响应式样式。                         |
| `scripts/build.mjs`                                             | 独立作者 Node/browser 产物与依赖图约束。                     |
| `test/author/`、`test/browser/author-*.test.ts`                 | 模型、codec、授权、配置、命令、地图和页面测试。              |
| `test/integration/author-*.mjs`、`e2e/author-*.ts`              | 同一候选包的命令/浏览器验收及受控服务生命周期。              |
| 现有 README、配置/安全/兼容性文档与 CI                          | 用户使用说明、可复制示例和现有矩阵中的新验收。               |

顺序为 Task 1 → 2 → 3 → 4 → 5 → 6 → 7。Task 3 与 Task 4 的实现边界独立，但共享接口先定下来；任务评审通过后才进入下一个。

### Task 1: 草稿状态与稳定引用

**Files:** Create `src/author/types.ts`、`src/author/limits.ts`、`src/author/draft.ts`；Test `test/author/draft.test.ts`。

**Interfaces:**

- Consumes: `postMapSchema` 的类型、现有 `Coordinate`。`AuthorMapInput = z.input<typeof postMapSchema>`，`AuthorPoint = AuthorMapInput['points'][number]`，`AuthorPointInput = Pick<AuthorPoint, 'name' | 'longitude' | 'latitude'>`，不取有默认值的 schema output 作为原始输入。
- Produces: `AuthorIssue { fieldPath: string; message: string; line?: number; column?: number }`；`AuthorDraftError extends Error`，只携带 `issues: readonly AuthorIssue[]`。
- Produces: `AuthorDraft` 的 readonly 字段：`points: readonly AuthorPoint[]`、`representativeId?: string`、`representativeMode: 'implicit' | 'explicit' | 'pending'`、`route: readonly string[]`、`zoom?: number`、`track?: AuthorMapInput['track']`、`importedIds: readonly string[]`、`nextPointOrdinal: number`、`revision: number`。
- Produces: `createAuthorDraft(map?: AuthorMapInput): AuthorDraft`；`addAuthorPoint(draft: AuthorDraft, input: AuthorPointInput): AuthorDraft`；`updateAuthorPoint(draft: AuthorDraft, id: string, patch: Partial<AuthorPointInput>): AuthorDraft`；`moveAuthorPoint(draft: AuthorDraft, id: string, direction: 'up' | 'down'): AuthorDraft`；`selectAuthorRepresentative(draft: AuthorDraft, id: string): AuthorDraft`；`deleteAuthorPoint(draft: AuthorDraft, id: string): AuthorDraft`；`setAuthorRoute(draft: AuthorDraft, ids: readonly string[]): AuthorDraft`；`setAuthorZoom(draft: AuthorDraft, zoom: number | undefined): AuthorDraft`；`draftMapInput(draft: AuthorDraft): AuthorMapInput`。
- Produces: `AUTHOR_MAX_YAML_BYTES = 131072`、`AUTHOR_MAX_POINTS = 200`、`AUTHOR_MAX_ROUTE_STOPS = 1000`、`AUTHOR_MAX_ALIAS_COUNT = 50`。

- [ ] **Step 1: 写失败测试。** 定义 `point(name, longitude = 118.123456789, latitude = 32.123456789): AuthorPointInput` 测试 helper；独立测试使用全新草稿，不用真实文章。

  ```ts
  it('keeps repeated stops independent from point order', () => {
    const a = addAuthorPoint(createAuthorDraft(), point('A'));
    const b = addAuthorPoint(a, point('B'));
    const route = setAuthorRoute(b, ['point-1', 'point-2', 'point-1']);
    const reordered = moveAuthorPoint(route, 'point-2', 'up');
    expect(draftMapInput(reordered).route).toEqual(['point-1', 'point-2', 'point-1']);
    expect(draftMapInput(reordered).representative).toBe('point-1');
    expect(reordered.points.map((p) => p.id)).toEqual(['point-2', 'point-1']);
  });
  ```

  具名断言：`never reuses deleted imported or generated IDs`；`requires explicit selection after representative deletion with one survivor`；`adding another point does not resolve a pending representative`；`removes every reference to a deleted point`；`blocks empty draft and one-stop route`；`keeps coincident points and precision`；`keeps imported explicit single representative`；`rejects unknown IDs and point 201 or stop 1001`；`preserves imported finite zoom but bounds newly set zoom to 2..20`。只改名称/坐标不改 ID，改前草稿不被原地修改。

- [ ] **Step 2: 验证红灯。** Run `npm run test:run -- test/author/draft.test.ts`；Expected FAIL：新增模块或导出缺失。
- [ ] **Step 3: 实现纯草稿。** ID 使用单调递增计数并避开当前点和全部导入 ID；不靠数组长度发号。有效变化增加 revision；边界排序为 no-op；未知 ID、非法坐标或超限抛 `AuthorDraftError`。新增名称必须非空，编辑可暂存空名称；线路可暂存一项，但 `draftMapInput` 禁止输出。删除代表点进入 pending，新增地点也不能自动推选；新建首点 implicit，非 pending 草稿新增第二点转 explicit。导入 zoom/track 原值复制保留；`setAuthorZoom` 只接受 undefined 或 2–20 有限值。
- [ ] **Step 4: 验证绿灯。** Run 同 Step 2 及 `npm run typecheck`；Expected 所有新增测试 PASS、typecheck exit 0。
- [ ] **Step 5: Review 后显式提交。** `git add src/author/types.ts src/author/limits.ts src/author/draft.ts test/author/draft.test.ts`，`git commit -m "feat: add map authoring draft model"`。

### Task 2: 安全 YAML 往返与只读轨迹

**Files:** Create `src/author/yaml.ts`；Test `test/author/yaml.test.ts`。

**Interfaces:**

- Consumes: Task 1 的 draft/types/limits；现有 `postMapSchema.safeParse`、`normalizePostMapDocument(raw: unknown, sourcePath: string)`；只验证其结果，不使用归一化 track 序列化。
- Produces: `AuthorImportResult = { ok: true; map: AuthorMapInput } | { ok: false; issues: readonly AuthorIssue[] }`；`AuthorExportResult = { ok: true; yaml: string; map: AuthorMapInput; revision: number } | { ok: false; issues: readonly AuthorIssue[] }`。
- Produces: `importAuthorYaml(source: string): AuthorImportResult`；`exportAuthorYaml(draft: AuthorDraft): AuthorExportResult`。所有错误使用固定字段描述，不含输入文本或真实源路径；领域校验使用固定虚拟名称 `author-map.yaml`。

- [ ] **Step 1: 写失败测试。** 定义 `roundTrip(source: string): AuthorExportResult` helper：成功导入后 `createAuthorDraft(map)` 再导出。fixture 只含测试名、数字与相对 track 路径。

  ```ts
  it('retains omitted track defaults and repeated route stops', () => {
    const draft = createAuthorDraft({
      points: [{ id: 'a', name: 'A: #一\n二', longitude: 118.123456789, latitude: 32 }],
      representative: 'a',
      route: ['a', 'a'],
      zoom: 21,
      track: { source: 'walk.gpx' },
    });
    const out = exportAuthorYaml(draft);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('Expected valid export');
    const back = importAuthorYaml(out.yaml);
    expect(back).toMatchObject({ ok: true, map: { track: { source: 'walk.gpx' } } });
    expect(out.map.track).toEqual({ source: 'walk.gpx' });
    expect(out.map.route).toEqual(['a', 'a']);
    expect(out.yaml).not.toContain('---');
    expect(normalizePostMapDocument(out.map, 'author-map.yaml')?.map.zoom).toBe(21);
  });
  ```

  具名测试覆盖单/多点语义、中文/引号/多行名、未知字段、整篇文章、第二文档、重复键、自定义标签、合并键、循环、超 50 展开别名和 `__proto__`。断言 `Object.prototype` 未改变；131072 字节恰好边界与多字节超限、不超过/超过 200 点和 1000 项均覆盖；拒绝 Infinity/NaN，保持长小数。所有拒绝均返回 issues，不返回被截断地图。省略 privacy/simplify/playback 与显式值都要往返一致。

- [ ] **Step 2: 验证红灯。** Run `npm run test:run -- test/author/yaml.test.ts`；Expected FAIL：codec 导出缺失。
- [ ] **Step 3: 实现 codec。** 先按 UTF-8 字节限制，再用 `parseDocument` 的严格重复键解析；检查文档错误/警告、标签和合并键，`toJS({ maxAliasCount: 50 })` 后执行有界、非递归的容器检查并拒绝循环和危险原型字段。根对象只允许 map；执行数量、strict schema 和引用归一化校验，再白名单复制原始合法字段。`stringify({ map })` 后重新导入、核对语义并检查输出字节；不手写 YAML、执行内容或读取 track 文件。
- [ ] **Step 4: 验证绿灯。** Run 同 Step 2 及 `npm run test:run -- test/domain test/tracks`、`npm run typecheck`；Expected 新增与既有领域测试 PASS、typecheck exit 0。
- [ ] **Step 5: Review 后显式提交。** `git add src/author/yaml.ts test/author/yaml.test.ts`，`git commit -m "feat: add safe map YAML import and export"`。

### Task 3: 最小配置协议与回环 HTTP 服务

**Files:** Create `src/author/protocol.ts`、`src/author/config.ts`、`src/author/server.ts`；Test `test/author/config.test.ts`、`test/author/server.test.ts`。

**Interfaces:**

- Consumes: `BrowserProviderConfig`（type-only）及现有 `resolveConfig(raw: unknown, env: NodeJS.ProcessEnv)`。
- Produces: `AuthorBootstrap = { version: 1; mode: 'map'; mapConfig: BrowserProviderConfig; defaultZoom: number } | { version: 1; mode: 'manual'; message: string }`；`readAuthorBootstrap(raw: unknown): AuthorBootstrap` 严格校验，非法载荷抛固定错误。
- Produces: `resolveAuthorBootstrap(raw: unknown, env: NodeJS.ProcessEnv): AuthorBootstrap`；复制配置并单独启用解析，不修改 raw 或普通发布开关，缺少/非法配置返回无凭据 manual。该模块不得导入 HTTP。
- Produces: `startAuthorServer(options: { port: number; assetDirectory: string; bootstrap: AuthorBootstrap }): Promise<AuthorServerHandle>`；handle 为 `{ origin: string; url: string; closed: Promise<void>; close(): Promise<void> }`。仅内部测试可使用 port 0 获取实际端口，CLI 不接受 0。assetDirectory 为可信包内路径。

- [ ] **Step 1: 写失败测试。** 用临时目录的 `editor.html/editor.js/editor.css` 固定测试资产和虚构 key；测试 HTTP 客户端从返回 URL 的片段取令牌。对重复/缺失 Host 使用原始 TCP 请求；清理由 afterEach close、临时目录释放完成。

  ```ts
  it('does not expose credentials before authorization', async () => {
    const handle = await startAuthorServer({ port: 0, assetDirectory, bootstrap });
    const response = await fetch(handle.origin + '/api/bootstrap');
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('test-key');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    await handle.close();
    await handle.closed;
  });
  ```

  定义配置测试：disabled 仍复用有效设置、缺失配置/双安全模式/非法字段进入 manual、环境覆盖与原 resolver 一致、raw 深冻结不被修改。服务测试覆盖精确 Host、重复 Host、Origin、缺少/错误/重启旧令牌、HEAD bootstrap=405、静态 HEAD 无正文、POST=405、未知/编码穿越=404、凭据不出现在资产和错误中、所有响应安全头、幂等 close 和端口释放；禁止反射输入。协议测试拒绝多余站点字段、manual 内的 mapConfig 和未知版本。

- [ ] **Step 2: 验证红灯。** Run `npm run test:run -- test/author/config.test.ts test/author/server.test.ts`；Expected FAIL：新增服务/协议缺失。
- [ ] **Step 3: 实现服务和协议。** `randomBytes(32)` 生成 base64url 令牌；固定四路由，不用用户路径拼文件名；检查 rawHeaders 中 Host/Origin 的唯一性及精确值，再做方法与令牌校验。设置 Node 对重复头的处理，使应用可拒绝重复 Host；token 比较不暴露差异。HTTP 服务只接收已校验 bootstrap，不接收 Hexo 实例；错误统一清理为固定状态/文本。关闭停止监听、释放闲置连接、令牌失效，正常 resolve closed；使用 strict-origin 而非 no-referrer。
- [ ] **Step 4: 验证绿灯。** Run 同 Step 2 及 `npm run typecheck`；Expected 所有授权与协议测试 PASS、typecheck exit 0。
- [ ] **Step 5: Review 后显式提交。** `git add src/author/protocol.ts src/author/config.ts src/author/server.ts test/author/config.test.ts test/author/server.test.ts`，`git commit -m "feat: add loopback authoring server"`。

### Task 4: 高德作者地图适配

**Files:** Create `src/browser/author/map.ts`、`src/browser/author/marker.ts`；Test `test/browser/author-map.test.ts`。

**Interfaces:**

- Consumes: Task 1 的 `AuthorDraft`，现有 `Coordinate`、`BrowserProviderConfig`、`loadAMapApi<TApi extends AMapSdkApi>`。不导入读者 `amap.ts` controller 集合或 YAML。
- Produces: `AuthorMapOptions { config: BrowserProviderConfig; defaultZoom: number; signal: AbortSignal; onCandidate(coordinate: Coordinate): void; onSelect(id: string): void; onMove(id: string, coordinate: Coordinate): void; onWarning(message: string): void }`；`AuthorMapHandle { render(draft: AuthorDraft, selectedId?: string, options?: { fitView?: boolean }): void; setCandidate(coordinate: Coordinate | undefined): void; destroy(): void }`。
- Produces: `createAuthorMap(container: HTMLElement, options: AuthorMapOptions): Promise<AuthorMapHandle>`；`createAuthorMarker(label: string, selected: boolean): HTMLElement` 返回固定 SVG 定位图钉，名称仅作为可访问文本，不作为 HTML。

- [ ] **Step 1: 写失败测试。** Happy DOM fixture 的 typed fake SDK 提供 Map click、Marker click/dragend、Polyline 更新与监听计数；定义测试 helper `lnglat(longitude: number, latitude: number): { lnglat: { getLng(): number; getLat(): number } }`，`marker` 引用本次 render 创建的 fake Marker。不把 reader 的无参 fake emit 当真实取坐标证明。

  ```ts
  it('commits marker movement only on dragend', async () => {
    const handle = await createAuthorMap(container, options);
    handle.render(draft, 'point-1');
    marker.emit('dragging', lnglat(118.5, 32.5));
    expect(options.onMove).not.toHaveBeenCalled();
    marker.emit('dragend', lnglat(118.5, 32.5));
    expect(options.onMove).toHaveBeenCalledExactlyOnceWith('point-1', [118.5, 32.5]);
  });
  ```

  具名测试：`starts empty at fixed center and zoom without location plugin`；`selects a marker without creating candidate or info window`；`renders A B A without changing representative or zoom`；`updates only changed marker and route`；`keeps legal unrenderable coordinates exportable with warning`；`does not refit for name edits or pan`；`destroys late SDK result after abort`；`removes all owned listeners and overlays once`。map dblclick 不确认新增；无效事件不发送坐标；先 render 新草稿再迟到旧点事件不能选择/移动不存在的 ID。

- [ ] **Step 2: 验证红灯。** Run `npm run test:run -- test/browser/author-map.test.ts`；Expected FAIL：作者适配缺失。
- [ ] **Step 3: 实现适配。** 复用 SDK 单次加载/20 秒超时边界；作者事件类型独立定义并做 runtime guard，不扩大 reader SDK 行为。标记按 ID 增量维护，只有选中点可拖动；点击标记阻止地图候选行为。线路按引用顺序重建 path，单项不画线。只有显式 fitView 时适配点范围；候选、地图视野与草稿 zoom 分离。SDK 异常仅显示固定 warning；abort 后返回或销毁迟到实例，destroy 幂等。
- [ ] **Step 4: 验证绿灯。** Run 同 Step 2 及 `npm run test:run -- test/browser/amap-redraw.test.ts`、`npm run typecheck`；Expected 作者与既有高德回归 PASS。
- [ ] **Step 5: Review 后显式提交。** `git add src/browser/author/map.ts src/browser/author/marker.ts test/browser/author-map.test.ts`，`git commit -m "feat: add authoring map point interactions"`。

### Task 5: 编辑页面与导出生命周期

**Files:** Create `src/browser/author/controller.ts`、`src/browser/author/view.ts`、`src/browser/author/export-controls.ts`、`src/browser/author/index.ts`、`src/browser/author/style.css`、`src/author/editor.html`；Test `test/browser/author-controller.test.ts`、`test/browser/author-export.test.ts`、`test/browser/author-lifecycle.test.ts`。

**Interfaces:**

- Consumes: Tasks 1–4 的纯草稿/codec/protocol/map 接口。
- Produces: `AuthorEditorSession { draft: AuthorDraft; selectedId?: string }`（只在模块内存持有）；`AuthorEditorHandle { destroy(): void }`；`mountAuthorEditor(root: HTMLElement, bootstrap: AuthorBootstrap, session: AuthorEditorSession, options?: { mapFactory?: typeof createAuthorMap }): AuthorEditorHandle`。
- Produces: `createAuthorView(root: HTMLElement): AuthorView`；AuthorView 的 readonly 字段为 `map: HTMLElement`、`form: HTMLFormElement`、`pointList: HTMLElement`、`routeList: HTMLElement`、`importDialog: HTMLDialogElement`、`deleteDialog: HTMLDialogElement`、`export: HTMLElement`、`status: HTMLElement`，不依赖页面全局选择器。
- Produces: `createAuthorExportControls(root: HTMLElement, getCurrent: () => AuthorExportResult, isPendingInvalid: () => boolean): { refresh(): void; destroy(): void }`；每次点击重新查询当前 revision/有效性，而非复用旧字符串。
- Produces: `startAuthorPage(owner: Window): { destroy(): void }`，启动时严格读取片段和 bootstrap；pagehide 销毁 UI/地图，persisted pageshow 从同一 session 重挂一次；缺少令牌、403 或网络失败仍可进入无凭据手动模式。

- [ ] **Step 1: 写失败测试。** 用真实 editor.html fixture 建 DOM，mapFactory 替身记录 render/destroy，fake timers 控制反馈；测试不安装实际 SDK、不访问真实存储或剪贴板。

  ```ts
  it('cannot copy an old valid export while coordinates are incomplete', () => {
    longitudeInput.value = '';
    longitudeInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(session.draft.points[0]?.longitude).toBe(118.123456789);
    expect(copyButton.disabled).toBe(true);
    expect(downloadButton.disabled).toBe(true);
    expect(status.textContent).toContain('坐标');
  });
  ```

  增加具名测试覆盖候选点确认、手动新增、第一代表点标记、线路 A→B→A/一项无效、独立键盘排序、删除引用次数确认/取消/重新选择、原子导入替换/失败保留草稿和选中、恶意名称仅文本、导入 track 只读/zoom 21 保留、clipboard 拒绝降级、成功约 3000ms 消失、只点击时复制/下载、URL revoke、销毁后 timer/clipboard/SDK 不更新、新 draft 不被旧回调覆盖、BFCache 重挂一次。坐标输入对空白和不完整指数拒绝，完整有限指数按数值校验；未完成表单隔离于 committed draft，不用 Number 空字符串。

- [ ] **Step 2: 验证红灯。** Run `npm run test:run -- test/browser/author-controller.test.ts test/browser/author-export.test.ts test/browser/author-lifecycle.test.ts`；Expected FAIL：新增页面/导出入口缺失。
- [ ] **Step 3: 实现页面。** 使用可见标签和代表点 radio；局部更新地点行与覆盖物，合并输入校验/预览任务，不在键入或滚动时全量重建。导入先解析成功、确认后整体替换；候选点未确认不进入 points；删除先统计路线引用和代表点。预览只显示当前有效 YAML 或标记旧文本过期，copy/download 每次重新验有效性，下载名 `post-map.yaml`。名称/错误以 textContent 展示，剪贴板降级为带标签 readonly textarea；3000ms 状态定时器归当前 controller 所有。常驻清空说明及“行程示意线”“真实轨迹配置已保留，选点助手仅预览地点和示意线”；焦点确认后恢复，不抢编辑焦点。样式及 HTML 与主题隔离，列表有界、44px 操作、颜色/动态媒体规则和可见署名。生命周期按 generation/abort 忽略迟到回调，token 只保留内存，不传地图配置。
- [ ] **Step 4: 验证绿灯。** Run 同 Step 2 及 `npm run typecheck`；Expected 新增 DOM/生命周期测试全部 PASS。
- [ ] **Step 5: Review 后显式提交。** 仅暂存本 task Files 中的九个新文件，`git commit -m "feat: add local map authoring editor"`。

### Task 6: Hexo 命令与独立 npm 产物

**Files:** Create `src/hexo/author-command.ts`、`src/author/entry.ts`；Modify `src/hexo/register.ts`、`scripts/build.mjs`、`package.json`、`test/package-contents.test.ts`、`test/browser/provider-bundles.test.ts`；Test `test/author/command.test.ts`。

**Interfaces:**

- Consumes: Task 3 server/config/protocol，Task 5 完整页面入口；`Hexo.extend.console.register`、filter `before_exit`/unregister。
- Produces: `AuthorSessionOptions { port: number; rawConfig: unknown; env: NodeJS.ProcessEnv }`；`AuthorSessionModule { startAuthorSession(options: AuthorSessionOptions): Promise<AuthorServerHandle> }`。`src/author/entry.ts` 导出实现，包内目录由 bundled `__dirname` 定位。
- Produces: `parseAuthorPort(args: Record<string, unknown>): number`；`registerAuthorCommand(instance: Hexo, load?: () => Promise<AuthorSessionModule>): void`，默认 loader 仅在命令执行时 `require('./author/server.cjs')`，build 将该 require 标记 external，普通插件 require 不加载 author Node bundle。
- Produces: `dist/author/server.cjs`（entry Node20 CJS）、`editor.html`、`editor.js`（IIFE ES2020）、`editor.css`；现有 exports 和公开资产名不变。

- [ ] **Step 1: 写失败测试。** Hexo 替身分别记录 console/filter、loader 调用、load/generate/watch/deploy、close 和日志；`load` 注入 Task 3 server handle，不运行真实进程。

  ```ts
  it('registers without starting author code when publication is disabled', () => {
    instance.config.post_map = { enabled: false };
    registerPlugin(instance);
    expect(instance.extend.console.get('post-map-editor')).toBeDefined();
    expect(instance.load).not.toHaveBeenCalled();
    expect(instance.generate).not.toHaveBeenCalled();
  });
  ```

  具名测试：缺失/非法配置也注册、默认/字符串端口、0/65536/小数/重复数组/空值/host 拒绝、EADDRINUSE 不换端口不 kill、启动地址只显示本次工具、Ctrl+C/退出释放监听和自身 handler、不移除宿主 signal listener、正常生成不调用 lazy loader。包测试要求四项 author 资源存在且无 source map/秘密；metafile 证明 runtime/detail/overview 无 `src/author/`、`src/browser/author/`、YAML 或 HTTP，runtime <=8192；普通生成 routes 不含 author/bootstrap。

- [ ] **Step 2: 验证红灯。** Run `npm run test:run -- test/author/command.test.ts test/package-contents.test.ts test/browser/provider-bundles.test.ts`；Expected FAIL：命令/author 资产缺失，不因任意网络错误判红灯成立。
- [ ] **Step 3: 接入命令和 build。** `registerPlugin` 在 config resolve 的 try/early return 前注册命令；继续保持原 before_generate 配置失败。端口仅允许十进制整数字符串/整数 number；新增任务描述/help，不提供 host。命令 await closed，before_exit 关闭服务并清理自身监听；SIGTERM 使用 scoped handler，保留 Hexo SIGINT 机制与其他插件 handler。按需 bundle 不把服务器拉入主入口；作者依赖可复用现有 devDependencies 打包，无新 runtime 安装要求。生成器继续显式五资源 allowlist，不递归发布 dist；新增 runtime 作者路径 guard。`check` 保持 format/lint/typecheck 后运行 build，再运行 test:run，确保干净 checkout 的包内容测试检查当前产物而不是旧 dist；不修改版本或发布脚本。
- [ ] **Step 4: 验证绿灯。** Run `npm run build`、同 Step 2、`npm run check`、`npm pack --dry-run --json`；Expected 全部 PASS、完整产物存在、五个读者资源不变，主入口和作者 bundle 无反向错误 require。
- [ ] **Step 5: Review 后显式提交。** 仅暂存本 task Files 中的八个路径，`git commit -m "feat: package on-demand Hexo map editor"`。

### Task 7: 候选包验收、文档与本地体验交付

**Files:** Create `test/integration/author-server.mjs`、`test/integration/author-editor.test.ts`、`e2e/author-fixtures.ts`、`e2e/author-editor.spec.ts`；Modify `test/integration/pack-and-build.mjs`、`test/integration/real-blog-smoke.mjs`、`test/integration/real-blog-smoke.test.ts`、`e2e/fake-sdk.ts`、`playwright.config.ts`、`.github/workflows/ci.yml`、`README.md`、`README.zh-CN.md`、`docs/configuration.md`、`docs/security.md`、`docs/compatibility.md`、`test/docs/examples.test.ts`。

**Interfaces:**

- Consumes: 已打包的同一候选 tgz、现有 `HPM_PACKED_TARBALL`、`withTemporaryWorkspace` runner 和真实博客副本审计；不使用源码替换已安装 package。
- Produces: `withPackedAuthorServer(options: { site: string; port: number; env: NodeJS.ProcessEnv }, work: (handle: { origin: string; url: string }) => Promise<void>): Promise<void>`（author-server.mjs）。从命令输出接收本次 fragment URL，进程 stdout 不转发到快照/CI；关闭、取消、异常和端口冲突均释放仅自己创建的 child。复用 runner 的进程组/取消模式，不留下作者监听。
- Produces: `e2e/author-fixtures.ts` 导出 auto network fixture 与 editorUrl fixture；只允许 reader 4179 和 author 4180 的明确 origin，本地其余地址及远端默认拒绝，高德 SDK 用增强 fake-sdk 替换。editorUrl 由受控 packed worker 返回，不硬编码/打印 token。
- Produces: 测试专用 `HPM_AUTHOR_READY_FILE` 传递就绪信息。Playwright 配置首次生成随机 run ID，并通过环境传给 worker；文件为系统临时目录下的 `hpm-author-browser-<run ID>.json`，内容严格为 `{ origin, url }`，以 0600 权限创建。packed runner 的 author 子进程就绪后由测试 supervisor 写入，fixture 有界等待并校验固定 4180 origin；退出先停自己的服务再移除该文件。此桥接不进入生产 server、包、公开目录、快照或日志，runner 取消测试覆盖残留清理。
- Produces: `--serve` packed runner 同时在 4179 服务读者 fixture，并在 4180 运行已安装作者命令；退出等待两个服务清理。Node 矩阵每格复用其 tgz 测试 author 命令；浏览器仍保持既有 reader 断言。

- [ ] **Step 1: 写失败验收。** `author-editor.test.ts` 用临时 Node 子进程替身测试 supervisor 的 URL 接收、缺失/损坏就绪文件、退出/取消和端口冲突清理，不在 Vitest 单测中重新 npm install。packed runner 在各自已安装 fixture 中运行真实 Hexo 7.1.1/7.3.0/8.1.2 的 help、disabled/missing config、有效虚构凭据、端口冲突、停止重启和跨站未授权 bootstrap；比较执行前后 source/public/config/db 字节，预先同步 Hexo 初始化版本或单独报告宿主 package 行为。

  ```ts
  test('does not add an author page to generated public output', async () => {
    expect(publicPaths.some((path) => /author|editor|bootstrap/u.test(path))).toBe(false);
    expect(readerAssetNames).toEqual([
      'overview-map.js',
      'placeholder.svg',
      'post-map.js',
      'runtime.js',
      'style.css',
    ]);
  });
  ```

  浏览器具名断言：desktop/mobile 完成选点→代表点→A B A→复制下载；地图网络失败仍手动编辑；失败导入保留现状；删除代表点禁用导出；200 点列表内部滚动/44px 操作/键盘排序；恶意名称无 HTML；readonly track 不发文件请求；BFCache 重挂一次、迟到回调无更新。使用真正 packed 页面，fake 仅替换 SDK；声明布局取证 viewport 1280×800、390×844，截图验证署名与面板不重叠。README 两种语言的新 YAML 示例通过 codec/domain，文档不得将客户端安全码描述成秘密。

- [ ] **Step 2: 验证红灯。** Run `npm run test:run -- test/integration/author-editor.test.ts test/docs/examples.test.ts` 及 `npm run test:e2e -- e2e/author-editor.spec.ts`；Expected FAIL：新 runner/验收或文档入口未接入；旧用例必须保持可运行。
- [ ] **Step 3: 实现验收和文档。** 增强 fake Map emit/Marker drag 传真实事件形状而不破坏 reader；隔离 author network fixture，保留外网拒绝。同一 tgz 校验安装完整性后在 Node 20/22/24、Hexo 7/8、landscape/next/cactus-minimal、`/`/`/blog/` 已有矩阵加入命令验收；CI 不修改发布/权限流程。真实博客临时副本增加本工具导出的单/多点、往返线及只读 track 文章，验证正常生成、详情代表点、轨迹隐私和原始仓库字节不变。双语 README 与配置/安全/兼容文档写明入口、127.0.0.1、端口、现有 Key 两模式、降级、清空警告、导入限制、只读 track 相对路径及不保存文章。
- [ ] **Step 4: 完整验证与分离报告。** Run `npm run check`、`npm run build`，将一次 `npm pack --json --pack-destination <mktemp 目录>` 的实际 tgz 绝对路径设为 `HPM_PACKED_TARBALL`；该值贯穿 `npm run test:integration`、`npm run test:e2e` 和 `node test/integration/real-blog-smoke.mjs`，不得每次暗中重打包。Expected 本地 18 个主题/根路径/Hexo 单元、全量单测、Chromium 新旧回归、真实博客 `/` 和 `/blog/` 都 PASS；CI 分别确认 Node 20/22/24，不以本机单版本代替。

  使用现有凭据门控 `npm run test:amap-smoke`，另行记录作者页真实高德点击/拖动与两安全模式中实际可用的一种；无有效凭据或未运行时明确写未验证，不以 fake SDK 声称域名、代理或联网成功。完整分支审查后修复发现并重跑受影响验证；只对已审查同一 tgz 承诺结果。

- [ ] **Step 5: Review 后显式提交。** 仅暂存本 task Files 中列出的验收、文档和 CI 路径，`git commit -m "test: verify and document packed map authoring workflow"`。提交不提升版本、不推送发布分支、不创建 release。

## Local Experience and Release Gate

完整验证后，从真实博客的临时副本安装已验候选包，以现有配置方式提供地图设置，不输出真实 Key。先核对 4001；若占用，说明实际拥有者并请求另选端口，不关闭未知服务。启动作者工具并提供 `127.0.0.1` 的本次完整会话 URL；需要文章地图对照时使用副本的 4000 预览，保留原博客已运行服务及脏文件。

体验建议为：新建单点，新增第二点并选代表点，编排往返线，复制后重新导入，删除代表点再选，地图失败时手动输入，下载 YAML。提示刷新会清空草稿及相对 track 仍需原文章构建。用户体验期间不自动关闭所需本地服务、不发版；用户反馈触发修复并重验。

用户明确体验认可后，进入独立的版本准备与发布流程；重新核对分支/远端、测试与文档、版本策略和发布权限，再处理 GitHub/PR/npm 和博客依赖升级。用户已有 OSS 上传方式不被替换，本计划不执行上传。

## Plan Review and Execution Handoff

推荐采用子代理逐任务实现和独立审查，因为 YAML 安全、回环授权和现有公开资源兼容是不同故障边界。也可由主代理顺序实现，在完整分支上独立审查；无论方式，以上接口、测试先行和本地体验后发版门槛相同。计划整体审阅并确定方式后开始，任务之间不再逐项请求确认。
