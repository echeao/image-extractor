<div align="center">

# <img src="icons/icon48.png" width="32" height="32" alt="Image Extractor icon" style="vertical-align: middle;" /> Image Extractor

### Chrome 图片提取器扩展

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-00C853?style=for-the-badge)](https://developer.chrome.com/docs/extensions/mv3/)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=google-chrome&logoColor=white)](https://chrome.google.com/webstore)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

从多个标签页提取图片，统一进入画廊进行筛选、预览和批量下载。

</div>

## ✨ 功能亮点

- 多标签页图片扫描：自动提取 `img`、CSS `background-image`、`srcset`、懒加载资源
- 瀑布流画廊：支持 1~8 列布局、图片来源标签、分辨率与画质标识
- 智能筛选：按分辨率、最小宽高、格式、比例快速过滤
- 批量下载：全选、反选、单图下载与批量下载一键完成
- 自动关页：下载完成后可自动关闭来源标签页，减少手动清理
- 命名助手：读取剪贴板文本，按 `文件夹 - 前缀` 方式快速生成命名
- 设置持久化：下载目录、重命名前缀、筛选状态、主题等自动保存

## 🚀 安装

### 开发者模式加载

```bash
git clone <your-repo-url>
cd image-extractor
```

1. 打开 `chrome://extensions/`
2. 打开右上角的 “开发者模式”
3. 点击 “加载已解压的扩展程序”
4. 选择当前项目目录

## 🧭 使用方式

1. 打开多个包含图片的网页
2. 点击浏览器工具栏中的扩展图标
3. 等待图片扫描完成
4. 在画廊页中筛选图片
5. 点击图片选择/取消选择
6. 点击 “下载选中” 保存到本地
7. 如开启自动关页，下载完成后会自动关闭相关标签页

## 🏗️ 项目结构

```text
image-extractor/
├── manifest.json
├── README.md
├── MANIFEST_DOCS.js
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   ├── icon128.png
│   └── icon512.png
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── gallery/
│   ├── gallery.html
│   ├── gallery.css
│   └── gallery.js
├── scripts/
│   ├── background.js
│   └── clipboard-smart-paste.js
└── generate-icons.*
```

## 🔧 关键实现

- `gallery/gallery.js`：图片提取、筛选、瀑布流、预览和批量下载逻辑
- `popup/popup.js`：快速筛选、快捷下载和设置同步
- `scripts/background.js`：下载处理、状态追踪和自动关页实现
- `scripts/clipboard-smart-paste.js`：剪贴板识别和命名辅助

## 🛡️ 权限说明

当前扩展声明的权限包括：

- `activeTab`
- `tabs`
- `scripting`
- `downloads`
- `storage`
- `alarms`
- `clipboardRead`
- `<all_urls>`

这些权限用于实现跨页面提取、图片下载、安全设置保存和自动关页等功能。

## 🧪 调试

- 打开 `chrome://extensions/`
- 找到扩展并查看 “Service Worker” 日志
- 重点检查 `background.js` 中的下载追踪与自动关页逻辑
- 画廊页和弹出页可通过开发者工具查看 `console` 输出

## 📄 许可证

本项目采用 [MIT License](LICENSE)。

---

<div align="center">

如果这个项目对你有帮助，欢迎给一个 Star！

</div>
