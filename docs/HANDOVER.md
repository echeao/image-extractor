# Image Extractor 交接文档

> 面向下一次接手的工程快照。只记录「读代码不容易看出来」的信息：行为规格、决策原因、验证方法、已知限制与待办。
> 最近更新：2026-10-24，对应自动翻页与画廊 UI 重构（提交 `002d8d3`）之后的文档补齐。

## 一、交接速览

- 分支：`main`，最新提交 `002d8d3`（自动翻页 + 画廊 UI 重构，含空白图修复）已同步到 `origin/main`；功能代码没有未提交改动。
- 文档侧：新增本文件与 `AGENTS.md`，更新 `README.md`（提交 `916e837`）。
- Manifest 版本：`1.1.0`（`manifest.json`）。
- 唯一待办：在**真实分页站点**上重新加载扩展并复测（详见「七、已知限制」与「八、下一步」）。
- 本轮交付内容：
  1. 「当前网页」模式支持自动连续翻页抓取整个图集；
  2. 画廊顶栏 + 高级面板 UI 全面重构，解决拥挤问题并补齐移动端断点；
  3. 修复后续分页图片在瀑布流中显示为空白的问题（懒加载占位图被当作缩略图）。

## 二、代码地图

改动集中在四个文件，按需求定位：

| 关注点 | 位置 |
| --- | --- |
| 提取主流程 / 翻页触发条件 | [gallery/gallery.js:1070](file:///D:/code/chrome/image-extractor/gallery/gallery.js#L1070) `extractImages()`，翻页判定在 [:1210](file:///D:/code/chrome/image-extractor/gallery/gallery.js#L1210) |
| 自动翻页主循环 | [gallery/gallery.js:1337](file:///D:/code/chrome/image-extractor/gallery/gallery.js#L1337) `crawlPaginatedPages()` |
| 页内注入抓取脚本（自包含） | [gallery/gallery.js:1656](file:///D:/code/chrome/image-extractor/gallery/gallery.js#L1656) `scrapeImagesFromPage()` |
| 占位图识别 / 懒加载属性表 | [gallery/gallery.js:1711](file:///D:/code/chrome/image-extractor/gallery/gallery.js#L1711) `isPlaceholderImageUrl()`、[:1745](file:///D:/code/chrome/image-extractor/gallery/gallery.js#L1745) `LAZY_IMAGE_ATTRS` |
| 页面内下一页发现 | [gallery/gallery.js:1866](file:///D:/code/chrome/image-extractor/gallery/gallery.js#L1866) `findNextPageUrl()` |
| URL 归一化 / 下一页推导 | [gallery/gallery.js:1494](file:///D:/code/chrome/image-extractor/gallery/gallery.js#L1494) `normalizePageUrl()`、[:1517](file:///D:/code/chrome/image-extractor/gallery/gallery.js#L1517) `inferNextPageUrl()` |
| 页数上限约束（2–100，默认 20） | [gallery/gallery.js:552](file:///D:/code/chrome/image-extractor/gallery/gallery.js#L552) `clampPaginateMaxPages()` |
| 顶栏统计文案（含移动端紧凑文案） | [gallery/gallery.js:2460](file:///D:/code/chrome/image-extractor/gallery/gallery.js#L2460) `updateStats()` |
| 卡片缩略图失败回退原图 | [gallery/gallery.js:2282](file:///D:/code/chrome/image-extractor/gallery/gallery.js#L2282) `img.onerror` |
| 后台 HTML 兜底抓取 | 消息入口 [scripts/background.js:370](file:///D:/code/chrome/image-extractor/scripts/background.js#L370)，实现 [scripts/background.js:654](file:///D:/code/chrome/image-extractor/scripts/background.js#L654) |
| 自动翻页开关 / 上限输入框 | [gallery/gallery.html:60](file:///D:/code/chrome/image-extractor/gallery/gallery.html#L60) `#autoPaginateControl`、[:232](file:///D:/code/chrome/image-extractor/gallery/gallery.html#L232) `#paginateMaxPages` |

## 三、自动翻页行为规格

**生效范围**：仅 `extractScope === 'current'`（当前网页）且开关为开、来源标签页存在时触发。非当前网页模式下，顶栏 `#autoPaginateControl` 整块加 `.hidden` 隐藏，面板里的「自动翻页上限」行与提示由 `body:not(.scope-single)` 隐藏——注意 `scope-single` 这个类名指的是「当前网页（单页）模式」，不是「单张图」。在「当前网页」模式下打开开关会**立即重新扫描**并从头开始翻页，关闭则中止当前循环。

**下一页地址来源**（优先级从高到低）：

1. 页面显式声明：`link[rel=next]` / `a[rel=next]`；
2. 分页容器启发式：`[class*=pagination|pager|page-nav]`、`nav[aria-label*=page]` 等容器内，`[aria-current=page]` / `.current` / `.active` 的下一个兄弟链接；
3. 「下一页」语义标签匹配：中英日韩 + `› » → >`，同时用 `badAncestorPattern` / `badLabelPattern` 排除「下一篇文章」这类文章导航误判；
4. 页面没给出链接时按 URL 推导：`?page|paged|pg|p|pageNo|page_no=N → N+1`、末段纯数字 `+1`、尾斜杠路径追加 `2/`、无扩展名无查询串的路径追加 `/2/`。

**抓取通道**（双通道）：

- 首选在原标签页上下文里 `fetch(url, { credentials: 'include' })`，复用 Cookie/登录态，能穿透需要会话的分页；
- 页面上下文返回 `errorType === 'network'`（跨域/CORS/被拦）时，改由后台 Service Worker `fetchPageHtml` 抓取 HTML，再把 HTML 注入标签页走「HTML 解析模式」二次解析。后台侧限制：仅 http/https、15s 超时、校验 content-type、响应体上限 4MB、拒绝非扩展自身 sender。

**循环与停止条件**：串行抓取、每页间隔 360ms、`visited` 去重。命中以下任一情况立即停止并把原因显示在右下角提示里：

- 达到页数上限（默认 20，可调 2–100）；
- 下一页地址无效 / 未推进 / 与已访问页重复；
- 来源标签页被关闭（每页前做 `chrome.tabs.get` 存活探测）；
- 该页解析不到图片，或合并后**没有新增图片**（循环尾页常见的重复渲染）；
- 后台兜底失败、用户中止（关闭「自动翻页」开关会置 `state.crawlAbort`；来源标签页被关闭时 `removeImagesByTabId()` 同样立即熔断）、`runId` 已过期（重新扫描会作废旧循环）。

**状态字段**：`state.pagesScanned` 只累计真正贡献了图片的页数，`state.crawlPage` / `crawlTotalPages` 只用于顶栏进度显示，`state.isCrawling` 驱动顶栏呼吸/Spinner。这些字段与 `autoPaginate`、`paginateMaxPages` 一起写入 `chrome.storage.local` 的 settings（见 [gallery/gallery.js:98](file:///D:/code/chrome/image-extractor/gallery/gallery.js#L98)）。

## 四、图片解析规则（`scrapeImagesFromPage`）

该函数会被序列化注入目标页面，**必须完全自包含**，不能引用画廊作用域的任何变量或函数；新增逻辑请写在其函数体内。

- **占位图判定** `isPlaceholderImageUrl()`：`data:` URI 中仅放行长度 ≥1024 且非 SVG 的位图；非 http(s) 一律视为占位；URL 路径命中 `placeholder/blank/transparent/spacer/pixel/tracking/preloader/loader/loading/1x1/1px/dummy/no-image/noimg` 等词元（前后需分隔符）也判为占位。
- **原图来源优先级**：`LAZY_IMAGE_ATTRS` 里第一个非占位值 → `srcset` 系（`srcset` / `data-srcset` / `data-lazy-srcset` 合并后按 width、density 降序取最大）→ 当前可用的 `src`。
- **缩略图**只取当前非占位 `src`（且与原图不同）或 `data-thumb/thumbnail/preview/lowRes`，不再回退到占位图（这是空白图的根因）。
- 覆盖 25 个常见懒加载属性（`data-original`、`data-echo`、`data-flickity-lazyload`、`data-pswp-src`、`data-actualsrc`、`data-pagespeed-lazy-src` 等），以及 `<picture><source srcset>`、CSS `background-image`。
- **静态 HTML 模式**会展开 `<noscript>` 里的 `img/source/picture` 再解析一次——很多分页站把真实图片藏在 `<noscript>` 中，只有页面 JS 跑起来才会替换 `src`，而我们是提前解析 HTML。
- 尺寸探测：初始宽高为 0 的图片（背景图、WebP 等）由 `probeImageDimensions()` 后台并发探测真实尺寸，完成后走 `handleImageDimensionResolved()` 触发重新过滤。

## 五、UI 与响应式约定

顶栏结构顺序：brand-group → divider → 模式分段控件 → `#autoPaginateControl`（单行「自动翻页」胶囊 + Spinner）→ `.stats` → `.header-tools`（快速分辨率条 + 操作按钮）。高级面板为折叠式 `.filter-panel > .panel-inner > .panel-content > .panel-grid`，内含三张 `.panel-card`（图像筛选 / 提取与下载 / 视图与布局）+ footer。

断点：1360（header-tools 换到第二行，stats `margin-left:auto`）、1280、1080（隐藏品牌文字与分隔线，面板改为 2 列且第二张卡 `row 1 / span 2` 拉伸填满，避免出现空洞）、900、720（面板回到 1 列）、560（隐藏分辨率快捷条与按钮文字，stats 切紧凑文案）。

两个容易再次踩到的坑：

1. **≤720 的面板 1 列复位必须写成 `.panel-card:nth-child(n)`**。单独用 `.panel-card { grid-column: auto }` 的特权低于 1080 断点里的 `.panel-card:nth-child(2)`，会导致 390px 下第二张卡被裁切。
2. **移动端紧凑文案靠 CSS 伪元素**：≤560 时 `.stats { font-size: 0 }`，由 `.stats::after { content: attr(data-compact) }` 显示短文案；因此 `updateStats()` 必须同时维护 `textContent`（完整文案）和 `dataset.compact`（紧凑文案），只改一个会在窄屏显示错误或空白。

## 六、验证方法与已取得的证据

- 语法/差异检查（每次收尾都要跑）：
  ```bash
  node --check gallery/gallery.js && node --check scripts/background.js
  git diff --check
  ```
- 翻页与解析用**本地 mock 站点**验证：起一个临时静态服务器，把 `scrapeImagesFromPage` 从 `gallery.js` 里按文本切片提取成可执行片段（注入脚本自包含，因此可单测），在浏览器里跑真实函数。注意 `gallery.js` 是 CRLF，多行结束标记匹配不稳，用 `source.lastIndexOf('\n}', renderIdx)` 这类位置切片更可靠。
- 占位图修复的 10 类用例已全部命中真实 URL（`data-src`、`data-lazy-src`、`data-srcset 1200w`、`data-echo`、`<noscript>`、行内 `background-image`、`<picture data-srcset>`、`data-original` 等），结果 `hasPlaceholder:false`、`hasDataUri:false`，且 `nextUrl` 正确推进到 `/photos/3/`；实时 DOM 模式同样验证通过。
- UI 用双 iframe 缩放台（`scale` 参数）在 390 / 768 / 1024 / 1440、明暗主题、单页/全部标签页、面板展开收起组合下截图核验，无 console 报错。
  - 注意：browser-use 的可视区约 1150 CSS px、DPR 1.5，测 1440 布局需要缩放，不要按物理像素判断。
- 自动翻页端到端 mock：3 页 / 24 张，收尾提示「自动翻页停止：后续页面没有新增图片 · 共 3 页」。
- 所有临时验证产物（`gallery/preview*.html`、mock 脚本、测试构建脚本、临时目录）已删除，未提交。

## 七、已知限制

1. **图片地址只存在于 JS/JSON 中**、HTML 里完全没有 `img`/`noscript`/背景图的画廊仍抓不到（需要按站点写接口解析，或等页面渲染后走实时 DOM 模式）。
2. **需要 Referer/Cookie 的 CDN**：卡片 `<img>` 从 `chrome-extension://` 发起请求，部分站点会 403。目前只有卡片级「缩略图失败回退原图」的兜底，没有代理改写 Referer。
3. 后台兜底抓取不带页面上下文，纯前端路由（SPA 翻页靠 JS 改写 DOM）站点拿到的是同一份 HTML，会命中「没有新增图片」而停止。
4. 上限输入框的最小值为 2：无法只抓 1 页（此时应直接关闭自动翻页）。

## 八、下一步

1. 重新加载已解压扩展，在真实分页图集站点复测；若仍有空白图，抓一份该页 `<img>` 原始 HTML 片段，按第四节规则补充属性/占位判定。
2. 视需求考虑：为 Referer 受限站点增加下载期兜底（已有 `background.js` 下载管道可复用）、把上限最小值放宽到 1。
3. README 已补充「自动翻页抓取」特性与使用步骤，后续若有新功能记得同步 `README.md` 与本文件。

## 九、协作约定（沿用）

- **未经明确要求不 commit、不 push。**
- 沟通与产品文案一律中文。
- 功能需求先给具体方案，用户回复「确认」后再动手实现。
