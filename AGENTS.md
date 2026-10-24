# Image Extractor — Agent 指引

Chrome 扩展（Manifest V3），无构建系统、无第三方依赖、无测试框架：直接编辑源文件，在 `chrome://extensions/` 以「加载已解压的扩展程序」方式验证。

## 协作规则

- 未经明确要求，不 commit、不 push。
- 沟通与产品/UI 文案一律中文。
- 功能需求先给具体方案，得到「确认」后再动手实现。

## 改动后必做

```bash
node --check gallery/gallery.js && node --check scripts/background.js
git diff --check
```

## 关键约束

- `gallery/gallery.js` 里的 `scrapeImagesFromPage()` 会被序列化注入目标页面执行，**必须完全自包含**：不能引用画廊作用域的任何变量、函数或常量，新增逻辑写在函数体内。
- 该文件是 CRLF 行尾；若写脚本按文本切片提取代码（例如本地 mock 验证），用位置切片而不是多行结束标记匹配。
- 设置统一存在 `chrome.storage.local` 的同一个 key 下，新增设置项需同时更新 `saveSettings()` / `loadSettings()` / `state` 初始值。
- CSS 断点为 1360 / 1280 / 1080 / 900 / 720 / 560；≤720 的面板复位要用 `.panel-card:nth-child(n)` 才能压过高优先级选择器；≤560 的紧凑统计文案依赖 `.stats::after { content: attr(data-compact) }`，改 `updateStats()` 时要同时维护 `textContent` 和 `dataset.compact`。

## 文件职责

- `gallery/gallery.js`：提取主流程、自动翻页循环、瀑布流渲染、筛选、预览、批量下载
- `gallery/gallery.html` / `gallery.css`：顶栏（模式切换、自动翻页开关、统计）+ 折叠式高级面板
- `scripts/background.js`：Service Worker，下载管道、状态追踪、自动关页、`fetchPageHtml` 跨域分页兜底
- `popup/`：弹窗快速筛选与下载
- `docs/HANDOVER.md`：完整交接文档（行为规格、验证方法、已知限制、待办）
