<div align="center">

# <img src="https://raw.githubusercontent.com/feathericons/feather/master/icons/image.svg" width="32" height="32" alt="Image Icon"/> Image Extractor

### Chrome 图片提取器扩展

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=google-chrome&logoColor=white)](https://chrome.google.com/webstore)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-00C853?style=for-the-badge)](https://developer.chrome.com/docs/extensions/mv3/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

**从多个标签页一键提取图片，瀑布流展示，支持分辨率筛选和批量下载**

[功能特性](#功能特性) •
[快速开始](#快速开始) •
[使用指南](#使用指南) •
[技术架构](#技术架构) •
[贡献指南](#贡献指南)

---

</div>

## <img src="https://raw.githubusercontent.com/feathericons/feather/master/icons/star.svg" width="24" height="24" alt="Star"/> 功能特性

<table>
<tr>
<td width="50%">

### <img src="https://raw.githubusercontent.com/feathericons/feather/master/icons/search.svg" width="20" height="20" alt="Search"/> 多标签页图片提取
- 一键扫描所有打开的标签页
- 自动提取 `<img>` 标签图片
- 支持 CSS 背景图片提取
- 识别懒加载图片 (data-src)
- 提取响应式图片 (srcset)

</td>
<td width="50%">

### <img src="https://raw.githubusercontent.com/feathericons/feather/master/icons/layout.svg" width="20" height="20" alt="Layout"/> 瀑布流展示
- 优雅的瀑布流布局
- 支持 1-8 列自由切换
- 图片卡片显示分辨率
- 高/低分辨率颜色标识
- 显示图片来源标签页

</td>
</tr>
<tr>
<td width="50%">

### <img src="https://raw.githubusercontent.com/feathericons/feather/master/icons/sliders.svg" width="20" height="20" alt="Filter"/> 智能分辨率筛选
- 快速筛选预设 (100-1000px)
- 自定义最小宽度/高度
- 自动过滤小图标/追踪像素
- 筛选结果实时统计

</td>
<td width="50%">

### <img src="https://raw.githubusercontent.com/feathericons/feather/master/icons/download.svg" width="20" height="20" alt="Download"/> 批量下载
- 一键选择/取消全选
- 自定义下载文件夹
- 批量重命名 (前缀 + 序号)
- 自动保持原始扩展名

</td>
</tr>
<tr>
<td width="50%">

### <img src="https://raw.githubusercontent.com/feathericons/feather/master/icons/eye.svg" width="20" height="20" alt="Eye"/> 两种交互模式
- **选择模式**：点击添加到下载列表
- **预览模式**：点击打开 Lightbox 大图

</td>
<td width="50%">

### <img src="https://raw.githubusercontent.com/feathericons/feather/master/icons/save.svg" width="20" height="20" alt="Save"/> 设置持久化
- 自动保存用户偏好
- 下次打开自动恢复设置
- 包括筛选条件、列数、文件夹等

</td>
</tr>
</table>

## <img src="https://raw.githubusercontent.com/feathericons/feather/master/icons/zap.svg" width="24" height="24" alt="Zap"/> 快速开始

### 方式一：开发者模式安装

```bash
# 1. 克隆项目
git clone https://github.com/your-username/image-extractor.git

# 2. 进入项目目录
cd image-extractor
```

1. 打开 Chrome 浏览器，访问 `chrome://extensions/`
2. 开启右上角 **"开发者模式"**
3. 点击 **"加载已解压的扩展程序"**
4. 选择项目文件夹

### 方式二：打包安装

```bash
# 在 chrome://extensions/ 页面
# 点击 "打包扩展程序" -> 选择项目目录
# 生成 .crx 文件后拖入浏览器安装
```

## <img src="https://raw.githubusercontent.com/feathericons/feather/master/icons/book-open.svg" width="24" height="24" alt="Book"/> 使用指南

### 基本操作流程

```
1. 打开多个包含图片的网页
2. 点击工具栏的扩展图标
3. 等待图片提取完成
4. 使用筛选功能找到需要的图片
5. 点击图片选中/取消
6. 点击下载按钮
```

### 功能详解

#### <img src="https://raw.githubusercontent.com/feathericons/feather/master/icons/search.svg" width="18" height="18" alt="Search"/> 分辨率筛选

| 筛选类型 | 说明 |
|---------|------|
| **快速筛选** | 点击预设按钮，显示最大边 ≥ 指定像素的图片 |
| **自定义筛选** | 分别指定最小宽度和高度，更精确控制 |

#### <img src="https://raw.githubusercontent.com/feathericons/feather/master/icons/folder.svg" width="18" height="18" alt="Folder"/> 下载设置

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| **下载文件夹** | `images` | 图片保存到下载目录的子文件夹 |
| **批量重命名** | 关闭 | 开启后使用 `前缀_序号.扩展名` 格式 |

#### <img src="https://raw.githubusercontent.com/feathericons/feather/master/icons/command.svg" width="18" height="18" alt="Command"/> 快捷操作

| 操作 | 说明 |
|------|------|
| `Esc` | 关闭图片预览 |
| 点击预览背景 | 关闭图片预览 |
| `Enter` | 在筛选输入框中应用筛选 |

## <img src="https://raw.githubusercontent.com/feathericons/feather/master/icons/layers.svg" width="24" height="24" alt="Layers"/> 技术架构

### 项目结构

```
image-extractor/
├── manifest.json          # 扩展配置文件 (Manifest V3)
├── MANIFEST_DOCS.js       # 配置说明文档
├── scripts/
│   └── background.js      # Service Worker 后台脚本
├── gallery/
│   ├── gallery.html       # 画廊页面
│   ├── gallery.js         # 画廊逻辑
│   └── gallery.css        # 画廊样式
├── popup/
│   ├── popup.html         # 弹出页面
│   ├── popup.js           # 弹出页逻辑
│   └── popup.css          # 弹出页样式
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### 技术栈

| 技术 | 用途 |
|------|------|
| **Manifest V3** | Chrome 扩展最新规范 |
| **Service Worker** | 后台脚本，处理下载请求 |
| **chrome.scripting** | 向页面注入脚本提取图片 |
| **chrome.downloads** | 下载 API |
| **chrome.storage** | 本地存储用户设置 |
| **CSS Columns** | 瀑布流布局 |

### 核心 API

```javascript
// 向标签页注入脚本
chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractImagesFromPage
});

// 下载图片
chrome.downloads.download({
    url: imageUrl,
    filename: `${folder}/${filename}`,
    saveAs: false
});

// 保存设置
chrome.storage.local.set({ settings: userSettings });
```

## <img src="https://raw.githubusercontent.com/feathericons/feather/master/icons/tool.svg" width="24" height="24" alt="Tool"/> 开发指南

### 环境要求

- Chrome 88+ (支持 Manifest V3)
- 开启开发者模式

### 调试技巧

```javascript
// 在 gallery.js 中添加日志
console.log('设置已保存:', settings);

// 查看 Service Worker 日志
// chrome://extensions/ -> 点击 "Service Worker" 链接
```

### 修改后刷新

1. 修改代码后保存
2. 在 `chrome://extensions/` 点击刷新按钮
3. 重新打开画廊页面测试

## <img src="https://raw.githubusercontent.com/feathericons/feather/master/icons/shield.svg" width="24" height="24" alt="Shield"/> 权限说明

| 权限 | 用途 |
|------|------|
| `activeTab` | 访问当前标签页 |
| `tabs` | 获取所有标签页信息 |
| `scripting` | 向页面注入提取脚本 |
| `downloads` | 下载图片到本地 |
| `storage` | 保存用户设置 |
| `<all_urls>` | 访问任意网站内容 |

## <img src="https://raw.githubusercontent.com/feathericons/feather/master/icons/users.svg" width="24" height="24" alt="Users"/> 贡献指南

欢迎提交 Issue 和 Pull Request！

### 贡献步骤

```bash
# 1. Fork 本仓库

# 2. 创建功能分支
git checkout -b feature/amazing-feature

# 3. 提交更改
git commit -m 'Add some amazing feature'

# 4. 推送分支
git push origin feature/amazing-feature

# 5. 创建 Pull Request
```

### 代码规范

- 使用 ES6+ 语法
- 添加必要的中文注释
- 遵循现有代码风格

## <img src="https://raw.githubusercontent.com/feathericons/feather/master/icons/file-text.svg" width="24" height="24" alt="License"/> 开源协议

本项目采用 [MIT License](LICENSE) 开源协议。

## <img src="https://raw.githubusercontent.com/feathericons/feather/master/icons/heart.svg" width="24" height="24" alt="Heart"/> 致谢

- 感谢所有贡献者
- 图标来自 [Feather Icons](https://feathericons.com/)

---

<div align="center">

**如果这个项目对你有帮助，请给一个 Star！**

<img src="https://raw.githubusercontent.com/feathericons/feather/master/icons/star.svg" width="20" height="20" alt="Star"/>

Made with <img src="https://raw.githubusercontent.com/feathericons/feather/master/icons/heart.svg" width="16" height="16" alt="Heart"/> by [Your Name](https://github.com/your-username)

</div>
