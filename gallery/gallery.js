/**
 * ============================================================
 * Image Extractor - Gallery Script
 * ============================================================
 * 
 * 文件说明：
 * 这是画廊页面的主逻辑 JavaScript 文件，负责：
 * 1. 跨标签页注入与图片提取
 * 2. 瀑布流响应式渲染与 Badge 徽章渲染
 * 3. 分辨率快速/自定义筛选
 * 4. 深/亮色主题系统与画布背景切换
 * 5. 悬浮 Header 折叠面板平滑开合控制
 * 6. 批量下载、自动关闭对应标签页与右下角 Floating Toast 诊断
 * 
 * ============================================================
 */

// ============================================================
// 全局状态管理
// ============================================================
const state = {
    // ---------- 图片数据 ----------
    images: [],              // 从所有标签页提取的原始图片数组
    filteredImages: [],      // 经过分辨率筛选后的图片数组
    selectedImages: new Set(), // 用户选中的图片索引集合（Set 结构去重）

    // ---------- 选择状态 ----------
    isAllSelected: false,    // 是否已全选所有图片

    // ---------- 筛选设置 ----------
    minResolution: 500,      // 快速筛选：最小分辨率（像素）
    customMinWidth: 0,       // 自定义筛选：最小宽度
    customMinHeight: 0,      // 自定义筛选：最小高度

    // ---------- 交互模式 ----------
    clickAction: 'select',   // 鼠标点击行为: 'select'（选择） | 'preview'（预览）

    // ---------- 下载设置 ----------
    isRenaming: false,       // 是否开启批量重命名
    renamePrefix: '',        // 重命名前缀（如 image -> image_01.jpg）
    downloadFolder: 'images', // 下载到的子文件夹名称
    autoCloseTabs: false,    // 下载完成后是否自动关闭对应标签页

    // ---------- 显示与主题设置 ----------
    columnCount: 5,           // 瀑布流列数（1-8）
    theme: 'light',           // 主题: 'light'（亮色） | 'dark'（深色）
    isPanelOpen: false,       // 折叠面板展开状态
    canvasBg: 'default'       // 画布背景模式: 'default' | 'dark' | 'gray' | 'light' | 'checkerboard'
};

// ============================================================
// 设置持久化 (chrome.storage.local)
// ============================================================
const STORAGE_KEY = 'imageExtractorSettings';

/**
 * 保存设置到 chrome.storage.local
 */
async function saveSettings() {
    const settings = {
        minResolution: state.minResolution,
        customMinWidth: state.customMinWidth,
        customMinHeight: state.customMinHeight,
        clickAction: state.clickAction,
        downloadFolder: state.downloadFolder,
        columnCount: state.columnCount,
        theme: state.theme,
        isPanelOpen: state.isPanelOpen,
        canvasBg: state.canvasBg,
        autoCloseTabs: state.autoCloseTabs
    };
    try {
        await chrome.storage.local.set({ [STORAGE_KEY]: settings });
        console.log('设置已成功保存:', settings);
    } catch (error) {
        console.error('保存设置失败:', error);
    }
}

/**
 * 从 chrome.storage.local 加载保存的配置
 */
async function loadSettings() {
    try {
        const result = await chrome.storage.local.get(STORAGE_KEY);
        const settings = result[STORAGE_KEY];
        if (settings) {
            state.minResolution = settings.minResolution ?? 500;
            state.customMinWidth = settings.customMinWidth ?? 0;
            state.customMinHeight = settings.customMinHeight ?? 0;
            state.clickAction = settings.clickAction ?? 'select';
            state.downloadFolder = settings.downloadFolder ?? 'images';
            state.columnCount = settings.columnCount ?? 5;
            state.theme = settings.theme ?? ((window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');
            state.isPanelOpen = settings.isPanelOpen ?? false;
            state.canvasBg = settings.canvasBg ?? 'default';
            state.autoCloseTabs = settings.autoCloseTabs ?? false;
            console.log('设置已加载恢复:', settings);
        } else {
            state.theme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
        }
    } catch (error) {
        console.error('加载设置失败:', error);
    }
}

/**
 * 将状态同步更新应用到 UI 视图
 */
function applySettingsToUI() {
    // 1. 列数
    updateColumnCount(state.columnCount);

    // 2. 主题与面板状态
    applyTheme(state.theme);
    applyFilterPanelState(state.isPanelOpen);
    applyCanvasBg(state.canvasBg);

    // 3. 下载配置
    if (elements.downloadFolder) elements.downloadFolder.value = state.downloadFolder;
    if (elements.autoCloseTabsToggle) elements.autoCloseTabsToggle.checked = state.autoCloseTabs;

    // 4. 模式切换开关
    if (elements.mouseActionToggle) {
        elements.mouseActionToggle.checked = state.clickAction === 'preview';
        if (elements.switchText) elements.switchText.textContent = state.clickAction === 'preview' ? '预览模式' : '选择模式';
    }

    // 5. 尺寸与分辨率筛选按钮激活态
    if (state.customMinWidth > 0 || state.customMinHeight > 0) {
        if (elements.minWidth) elements.minWidth.value = state.customMinWidth || '';
        if (elements.minHeight) elements.minHeight.value = state.customMinHeight || '';
        document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    } else {
        document.querySelectorAll('.filter-btn').forEach(btn => {
            const minRes = parseInt(btn.dataset.min, 10);
            if (minRes === state.minResolution) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }
}

// ============================================================
// DOM 元素引用
// ============================================================
const elements = {
    // 主要容器
    loader: document.getElementById('loader'),
    emptyState: document.getElementById('emptyState'),
    masonry: document.getElementById('masonry'),

    // 统计文本
    stats: document.getElementById('stats'),
    filterStats: document.getElementById('filterStats'),

    // 关键操作按钮
    refreshBtn: document.getElementById('refreshBtn'),
    selectAllBtn: document.getElementById('selectAllBtn'),
    downloadBtn: document.getElementById('downloadBtn'),

    // 模式切换与高级面板按钮
    mouseActionToggle: document.getElementById('mouseActionToggle'),
    switchText: document.getElementById('switchText'),
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    togglePanelBtn: document.getElementById('togglePanelBtn'),
    filterPanel: document.getElementById('filterPanel'),
    canvasBgSelector: document.getElementById('canvasBgSelector'),

    // 尺寸筛选
    minWidth: document.getElementById('minWidth'),
    minHeight: document.getElementById('minHeight'),
    applyCustomFilter: document.getElementById('applyCustomFilter'),

    // 灯箱预览
    lightbox: document.getElementById('lightbox'),
    lightboxImg: document.getElementById('lightboxImg'),
    lightboxClose: document.getElementById('lightboxClose'),

    // 视图列数控制
    decreaseColumns: document.getElementById('decreaseColumns'),
    increaseColumns: document.getElementById('increaseColumns'),
    columnSlider: document.getElementById('columnSlider'),
    columnValue: document.getElementById('columnValue'),

    // 重命名与文件夹及自动关闭
    renameToggle: document.getElementById('renameToggle'),
    renamePrefix: document.getElementById('renamePrefix'),
    downloadFolder: document.getElementById('downloadFolder'),
    autoCloseTabsToggle: document.getElementById('autoCloseTabsToggle'),

    // 右下角 Floating 诊断 Toast 控件
    downloadDiagnostics: document.getElementById('downloadDiagnostics'),
    downloadDiagnosticsSummary: document.getElementById('downloadDiagnosticsSummary'),
    downloadDiagnosticsLog: document.getElementById('downloadDiagnosticsLog'),
    toggleLogBtn: document.getElementById('toggleLogBtn'),
    closeDiagnosticsBtn: document.getElementById('closeDiagnosticsBtn')
};

// ============================================================
// 初始化绑定
// ============================================================
document.addEventListener('DOMContentLoaded', init);

async function init() {
    // 绑定核心按钮
    if (elements.refreshBtn) elements.refreshBtn.addEventListener('click', extractImages);
    if (elements.selectAllBtn) elements.selectAllBtn.addEventListener('click', toggleSelectAll);
    if (elements.downloadBtn) elements.downloadBtn.addEventListener('click', downloadSelected);
    if (elements.mouseActionToggle) elements.mouseActionToggle.addEventListener('change', toggleClickAction);
    if (elements.applyCustomFilter) elements.applyCustomFilter.addEventListener('click', applyCustomResolution);

    // 绑定主题与面板开合
    if (elements.themeToggleBtn) elements.themeToggleBtn.addEventListener('click', toggleTheme);
    if (elements.togglePanelBtn) elements.togglePanelBtn.addEventListener('click', toggleFilterPanel);

    // 绑定画布背景选项
    if (elements.canvasBgSelector) {
        elements.canvasBgSelector.querySelectorAll('.bg-option').forEach(btn => {
            btn.addEventListener('click', () => setCanvasBg(btn.dataset.bg));
        });
    }

    // Lightbox 全屏预览事件
    if (elements.lightboxClose) elements.lightboxClose.addEventListener('click', closeLightbox);
    if (elements.lightbox) {
        elements.lightbox.addEventListener('click', (e) => {
            if (e.target === elements.lightbox) closeLightbox();
        });
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeLightbox();
    });

    // 重命名与路径及自动关闭标签页事件
    if (elements.renameToggle) elements.renameToggle.addEventListener('change', toggleRename);
    if (elements.renamePrefix) {
        elements.renamePrefix.addEventListener('input', (e) => {
            const sanitized = sanitizeFilenamePart(e.target.value);
            e.target.value = sanitized;
            state.renamePrefix = sanitized;
        });
    }
    if (elements.downloadFolder) {
        elements.downloadFolder.addEventListener('input', (e) => {
            const sanitized = sanitizeFolderInput(e.target.value);
            e.target.value = sanitized;
            state.downloadFolder = sanitized || 'images';
            saveSettings();
        });
    }
    if (elements.autoCloseTabsToggle) {
        elements.autoCloseTabsToggle.addEventListener('change', (e) => {
            state.autoCloseTabs = e.target.checked;
            saveSettings();
        });
    }

    // 诊断日志控制
    if (elements.toggleLogBtn) {
        elements.toggleLogBtn.addEventListener('click', () => {
            if (elements.downloadDiagnosticsLog) {
                elements.downloadDiagnosticsLog.classList.toggle('hidden');
            }
        });
    }
    if (elements.closeDiagnosticsBtn) {
        elements.closeDiagnosticsBtn.addEventListener('click', () => {
            if (elements.downloadDiagnostics) {
                elements.downloadDiagnostics.classList.add('hidden');
            }
        });
    }

    // 列数控制事件
    if (elements.columnSlider) {
        elements.columnSlider.addEventListener('input', (e) => {
            updateColumnCount(parseInt(e.target.value, 10));
            saveSettings();
        });
    }
    if (elements.decreaseColumns) {
        elements.decreaseColumns.addEventListener('click', () => {
            updateColumnCount(state.columnCount - 1);
            saveSettings();
        });
    }
    if (elements.increaseColumns) {
        elements.increaseColumns.addEventListener('click', () => {
            updateColumnCount(state.columnCount + 1);
            saveSettings();
        });
    }

    // 快速筛选预设按钮事件绑定
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const minRes = parseInt(btn.dataset.min, 10);
            setQuickFilter(minRes, btn);
        });
    });

    // 自定义输入回车逻辑
    if (elements.minWidth) elements.minWidth.addEventListener('keypress', (e) => { if (e.key === 'Enter') applyCustomResolution(); });
    if (elements.minHeight) elements.minHeight.addEventListener('keypress', (e) => { if (e.key === 'Enter') applyCustomResolution(); });

    // 加载配置并提取图片
    await loadSettings();
    applySettingsToUI();
    await extractImages();
}

// ============================================================
// 列数与筛选控制
// ============================================================
function updateColumnCount(count) {
    const newCount = Math.max(1, Math.min(8, count));
    state.columnCount = newCount;
    if (elements.masonry) elements.masonry.style.columnCount = newCount;
    if (elements.columnSlider) elements.columnSlider.value = newCount;
    if (elements.columnValue) elements.columnValue.textContent = newCount;
}

function setQuickFilter(minRes, activeBtn) {
    state.minResolution = minRes;
    state.customMinWidth = 0;
    state.customMinHeight = 0;

    if (elements.minWidth) elements.minWidth.value = '';
    if (elements.minHeight) elements.minHeight.value = '';

    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    if (activeBtn) activeBtn.classList.add('active');

    applyFilter();
    saveSettings();
}

function applyCustomResolution() {
    const width = parseInt(elements.minWidth.value, 10) || 0;
    const height = parseInt(elements.minHeight.value, 10) || 0;

    state.customMinWidth = width;
    state.customMinHeight = height;
    state.minResolution = 0;

    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));

    applyFilter();
    saveSettings();
}

function applyFilter() {
    state.selectedImages.clear();

    state.filteredImages = state.images.filter(img => {
        const width = img.width || 0;
        const height = img.height || 0;

        if (state.customMinWidth > 0 || state.customMinHeight > 0) {
            return width >= state.customMinWidth && height >= state.customMinHeight;
        }
        const maxDim = Math.max(width, height);
        return maxDim >= state.minResolution;
    });

    updateFilterStats();

    if (state.filteredImages.length === 0) {
        showEmptyState();
    } else {
        renderImages();
    }
}

function updateFilterStats() {
    const total = state.images.length;
    const filtered = state.filteredImages.length;
    const hidden = total - filtered;

    if (elements.filterStats) {
        if (hidden > 0) {
            elements.filterStats.textContent = `显示 ${filtered} 张，已过滤 ${hidden} 张`;
        } else {
            elements.filterStats.textContent = `共 ${total} 张图片`;
        }
    }
}

// ============================================================
// 跨标签页提取逻辑
// ============================================================
// ============================================================
// 跨标签页提取逻辑 (包含超时竞争防护与防卡死熔断)
// ============================================================
async function extractImages() {
    showLoader();

    state.images = [];
    state.filteredImages = [];
    state.selectedImages.clear();
    updateSelectAllButton();
    updateDownloadButton();

    try {
        const tabs = await chrome.tabs.query({});
        const validTabs = tabs.filter(tab =>
            tab.url &&
            !tab.url.startsWith('chrome://') &&
            !tab.url.startsWith('chrome-extension://') &&
            !tab.url.startsWith('edge://') &&
            !tab.url.startsWith('about:')
        );

        // 如果没有可提取的有效标签页，直接展示空状态并隐退 Loader
        if (validTabs.length === 0) {
            showEmptyState();
            return;
        }

        // 并行提取任务，给每个标签页注入赋予 2.5 秒超时控制，避免单页挂起死锁 Promise.all
        const imagePromises = validTabs.map(async (tab) => {
            try {
                const scriptPromise = chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: extractImagesFromPage
                });

                // 2.5 秒超时计时器
                const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 2500));

                // 使用 Promise.race 竞争，防止因标签页关闭/死锁导致挂起
                const results = await Promise.race([scriptPromise, timeoutPromise]);

                if (results && results[0] && results[0].result) {
                    return results[0].result.map(img => ({
                        ...img,
                        tabTitle: tab.title || 'Unknown',
                        tabId: tab.id
                    }));
                }
            } catch (error) {
                console.log(`无法从标签页提取图片或标签页已关闭: ${tab.url}`, error);
            }
            return [];
        });

        // 给全局 Promise.all 加上 6 秒全局熔断保护
        const globalTimeoutPromise = new Promise(resolve => setTimeout(() => resolve([]), 6000));
        const allImagesResult = await Promise.race([
            Promise.all(imagePromises),
            globalTimeoutPromise
        ]);

        // 数组扁平化与图片 URL 去重
        const flatImages = allImagesResult.flat();
        const seenUrls = new Set();
        state.images = flatImages.filter(img => {
            if (seenUrls.has(img.src)) return false;
            seenUrls.add(img.src);
            return true;
        });

        // 展示结果或展示未找到图片空状态
        if (state.images.length === 0) {
            showEmptyState();
        } else {
            applyFilter();
        }
    } catch (error) {
        console.error('提取图片出错:', error);
        showEmptyState();
    }
}

function extractImagesFromPage() {
    const images = [];
    const seenSrcs = new Set();

    document.querySelectorAll('img').forEach(img => {
        const src = img.src || img.dataset.src || img.dataset.lazySrc;
        if (src && !seenSrcs.has(src) && isValidImage(img, src)) {
            seenSrcs.add(src);
            images.push({
                src: src,
                width: img.naturalWidth || img.width,
                height: img.naturalHeight || img.height
            });
        }
    });

    document.querySelectorAll('*').forEach(el => {
        const style = window.getComputedStyle(el);
        const bgImage = style.backgroundImage;
        if (bgImage && bgImage !== 'none') {
            const urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
            if (urlMatch && urlMatch[1] && !seenSrcs.has(urlMatch[1])) {
                seenSrcs.add(urlMatch[1]);
                images.push({
                    src: urlMatch[1],
                    width: el.offsetWidth,
                    height: el.offsetHeight
                });
            }
        }
    });

    document.querySelectorAll('picture source').forEach(source => {
        const srcset = source.srcset;
        if (srcset) {
            const srcs = srcset.split(',').map(s => s.trim().split(' ')[0]);
            srcs.forEach(src => {
                if (src && !seenSrcs.has(src)) {
                    seenSrcs.add(src);
                    images.push({ src, width: 0, height: 0 });
                }
            });
        }
    });

    function isValidImage(img, src) {
        const width = img.naturalWidth || img.width || 0;
        const height = img.naturalHeight || img.height || 0;
        if (width > 0 && width < 30 && height > 0 && height < 30) return false;
        if (src.startsWith('data:') && src.length < 1000) return false;
        if (src.includes('pixel') || src.includes('tracking') || src.includes('spacer')) return false;
        return true;
    }

    return images;
}

// ============================================================
// 渲染瀑布流卡片
// ============================================================
function renderImages() {
    hideLoader();
    if (elements.emptyState) elements.emptyState.classList.add('hidden');
    if (elements.masonry) {
        elements.masonry.classList.remove('hidden');
        elements.masonry.innerHTML = '';
    }

    updateStats();

    state.filteredImages.forEach((image, index) => {
        const card = createImageCard(image, index);
        if (elements.masonry) elements.masonry.appendChild(card);
    });
}

function createImageCard(image, index) {
    const card = document.createElement('div');
    card.className = 'image-card';
    card.dataset.index = index;

    const img = document.createElement('img');
    img.src = image.src;
    img.alt = `Image ${index + 1}`;
    img.loading = 'lazy';

    const format = getImageFormatFromUrl(image.src);
    const formatBadge = document.createElement('div');
    formatBadge.className = `format-badge ${format.toLowerCase()}`;
    formatBadge.textContent = format;

    const cardInfoBar = document.createElement('div');
    cardInfoBar.className = 'card-info-bar';

    const resolutionTag = document.createElement('span');
    resolutionTag.className = 'resolution-tag';

    const sourceTag = document.createElement('span');
    sourceTag.className = 'source-tag';
    sourceTag.textContent = image.tabTitle || 'Unknown';

    cardInfoBar.appendChild(resolutionTag);
    cardInfoBar.appendChild(sourceTag);

    img.onload = () => {
        if (!image.width || !image.height) {
            image.width = img.naturalWidth;
            image.height = img.naturalHeight;
        }
        resolutionTag.textContent = `${image.width} × ${image.height}`;
        updateResolutionTagClass(resolutionTag, image.width, image.height);
    };

    img.onerror = () => {
        card.style.display = 'none';
    };

    if (image.width && image.height) {
        resolutionTag.textContent = `${image.width} × ${image.height}`;
        updateResolutionTagClass(resolutionTag, image.width, image.height);
    } else {
        resolutionTag.textContent = '...';
    }

    const checkIndicator = document.createElement('div');
    checkIndicator.className = 'check-indicator';

    card.appendChild(img);
    card.appendChild(formatBadge);
    card.appendChild(checkIndicator);
    card.appendChild(cardInfoBar);

    card.addEventListener('click', () => handleImageClick(card, index));

    return card;
}

function updateResolutionTagClass(tag, width, height) {
    const maxDim = Math.max(width, height);
    tag.classList.remove('low', 'high');
    if (maxDim >= 1000) {
        tag.classList.add('high');
    } else if (maxDim < 500) {
        tag.classList.add('low');
    }
}

// ============================================================
// 交互模式与事件处理
// ============================================================
function handleImageClick(card, index) {
    if (state.clickAction === 'preview') {
        const image = state.filteredImages[index];
        openLightbox(image);
    } else {
        toggleImageSelection(card, index);
    }
}

function toggleImageSelection(card, index) {
    if (state.selectedImages.has(index)) {
        state.selectedImages.delete(index);
        card.classList.remove('selected');
    } else {
        state.selectedImages.add(index);
        card.classList.add('selected');
    }
    updateStats();
    updateSelectAllButton();
    updateDownloadButton();
}

function toggleSelectAll() {
    if (state.isAllSelected) {
        state.selectedImages.clear();
        document.querySelectorAll('.image-card').forEach(card => card.classList.remove('selected'));
        state.isAllSelected = false;
    } else {
        state.filteredImages.forEach((_, index) => state.selectedImages.add(index));
        document.querySelectorAll('.image-card').forEach(card => card.classList.add('selected'));
        state.isAllSelected = true;
    }
    updateStats();
    updateSelectAllButton();
    updateDownloadButton();
}

function updateSelectAllButton() {
    if (!elements.selectAllBtn) return;
    const total = state.filteredImages.length;
    const selected = state.selectedImages.size;
    state.isAllSelected = total > 0 && selected === total;

    const iconSpan = elements.selectAllBtn.querySelector('.checkbox-icon');
    const textSpan = elements.selectAllBtn.querySelector('.btn-text') || elements.selectAllBtn;

    if (state.isAllSelected) {
        if (iconSpan) iconSpan.textContent = '☑';
        if (textSpan) textSpan.textContent = '取消全选';
        elements.selectAllBtn.classList.add('active');
    } else {
        if (iconSpan) iconSpan.textContent = '☐';
        if (textSpan) textSpan.textContent = '全选';
        elements.selectAllBtn.classList.remove('active');
    }
}

function updateDownloadButton() {
    if (!elements.downloadBtn) return;
    const selectedCount = state.selectedImages.size;
    elements.downloadBtn.disabled = selectedCount === 0;

    const textSpan = elements.downloadBtn.querySelector('.btn-text');
    if (textSpan) {
        textSpan.textContent = selectedCount > 0 ? `下载选中 (${selectedCount})` : '下载选中';
    }
}

function updateStats() {
    if (!elements.stats) return;
    const total = state.filteredImages.length;
    const selected = state.selectedImages.size;

    if (selected > 0) {
        elements.stats.textContent = `已选择 ${selected} / ${total} 张`;
    } else {
        elements.stats.textContent = `共 ${total} 张图片`;
    }
}

function toggleClickAction(e) {
    state.clickAction = e.target.checked ? 'preview' : 'select';
    if (elements.switchText) elements.switchText.textContent = state.clickAction === 'preview' ? '预览模式' : '选择模式';
    saveSettings();
}

function toggleRename(e) {
    state.isRenaming = e.target.checked;
    if (elements.renamePrefix) elements.renamePrefix.disabled = !state.isRenaming;
}

// ============================================================
// 核心下载执行 & 自动关闭已下载标签页 & 诊断
// ============================================================
async function downloadSelected() {
    const selectedIndices = Array.from(state.selectedImages);
    if (selectedIndices.length === 0) return;

    if (elements.downloadBtn) {
        elements.downloadBtn.disabled = true;
        const textSpan = elements.downloadBtn.querySelector('.btn-text');
        if (textSpan) textSpan.textContent = '下载处理中...';
    }

    const folder = state.downloadFolder || 'images';
    let successCount = 0;
    let failCount = 0;
    const successfulTabIds = new Set(); // 搜集下载成功的关联 tabId

    showDiagnostics(`开始批量下载 ${selectedIndices.length} 张图片到文件夹: ${folder}`);

    for (let i = 0; i < selectedIndices.length; i++) {
        const index = selectedIndices[i];
        const image = state.filteredImages[index];
        let filename = null;

        if (state.isRenaming && state.renamePrefix) {
            const ext = getExtensionFromUrl(image.src) || '.jpg';
            const num = String(i + 1).padStart(2, '0');
            filename = `${state.renamePrefix}_${num}${ext}`;
        }

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'download',
                url: image.src,
                filename: filename,
                folder: folder
            });

            if (response && response.success) {
                successCount++;
                if (image.tabId) successfulTabIds.add(image.tabId);
                appendDiagnosticsLog(`[${i + 1}/${selectedIndices.length}] 下载成功 ID: ${response.downloadId} (${filename || '原始文件名'})`);
            } else {
                failCount++;
                appendDiagnosticsLog(`[${i + 1}/${selectedIndices.length}] 下载失败: ${response?.error || '未知错误'}`);
            }
        } catch (error) {
            failCount++;
            appendDiagnosticsLog(`[${i + 1}/${selectedIndices.length}] 消息通信错误: ${error.message}`);
        }

        await new Promise(r => setTimeout(r, 120));
    }

    // 更新诊断汇总
    if (elements.downloadDiagnosticsSummary) {
        elements.downloadDiagnosticsSummary.textContent = `下载完成: 成功 ${successCount}，失败 ${failCount}`;
    }

    // 自动关闭已成功下载图片的标签页
    if (state.autoCloseTabs && successfulTabIds.size > 0) {
        try {
            const tabIdsToClose = Array.from(successfulTabIds);
            appendDiagnosticsLog(`正在自动关闭已下载图片关联的 ${tabIdsToClose.length} 个标签页...`);
            await chrome.tabs.remove(tabIdsToClose);
            appendDiagnosticsLog(`已成功关闭相关标签页！`);
        } catch (tabErr) {
            appendDiagnosticsLog(`自动关闭标签页提示: ${tabErr.message}`);
        }
    }

    updateDownloadButton();

    // 如果全部成功，5 秒后隐退诊断浮层
    if (failCount === 0) {
        setTimeout(() => {
            if (elements.downloadDiagnostics) {
                elements.downloadDiagnostics.classList.add('hidden');
            }
        }, 5000);
    }
}

// ============================================================
// 主题、折叠面板与画布处理函数
// ============================================================
function toggleTheme() {
    const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
    state.theme = nextTheme;
    applyTheme(nextTheme);
    saveSettings();
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (!elements.themeToggleBtn) return;
    
    const iconSun = elements.themeToggleBtn.querySelector('.icon-sun');
    const iconMoon = elements.themeToggleBtn.querySelector('.icon-moon');
    
    if (theme === 'dark') {
        if (iconSun) iconSun.classList.add('hidden');
        if (iconMoon) iconMoon.classList.remove('hidden');
        elements.themeToggleBtn.title = '当前：深色模式 (点击切换亮色)';
    } else {
        if (iconSun) iconSun.classList.remove('hidden');
        if (iconMoon) iconMoon.classList.add('hidden');
        elements.themeToggleBtn.title = '当前：亮色模式 (点击切换深色)';
    }
}

function toggleFilterPanel() {
    state.isPanelOpen = !state.isPanelOpen;
    applyFilterPanelState(state.isPanelOpen);
    saveSettings();
}

function applyFilterPanelState(isOpen) {
    if (!elements.filterPanel || !elements.togglePanelBtn) return;
    
    if (isOpen) {
        elements.filterPanel.classList.remove('collapsed');
        elements.togglePanelBtn.classList.add('active');
        elements.togglePanelBtn.title = '收起高级筛选面板';
    } else {
        elements.filterPanel.classList.add('collapsed');
        elements.togglePanelBtn.classList.remove('active');
        elements.togglePanelBtn.title = '展开高级筛选面板';
    }
}

function setCanvasBg(bgType) {
    state.canvasBg = bgType;
    applyCanvasBg(bgType);
    saveSettings();
}

function applyCanvasBg(bgType) {
    document.body.classList.remove('canvas-dark', 'canvas-gray', 'canvas-light', 'canvas-checkerboard');
    if (bgType !== 'default') {
        document.body.classList.add(`canvas-${bgType}`);
    }
    
    if (elements.canvasBgSelector) {
        elements.canvasBgSelector.querySelectorAll('.bg-option').forEach(btn => {
            if (btn.dataset.bg === bgType) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }
}

function getImageFormatFromUrl(url) {
    if (!url) return 'IMG';
    if (url.startsWith('data:image/')) {
        const mimeMatch = url.match(/data:image\/([a-zA-Z0-9+-]+);/);
        if (mimeMatch && mimeMatch[1]) {
            return mimeMatch[1].toUpperCase();
        }
    }
    try {
        const cleanUrl = url.split('?')[0].split('#')[0];
        const ext = cleanUrl.split('.').pop().toUpperCase();
        if (['PNG', 'JPG', 'JPEG', 'WEBP', 'GIF', 'SVG', 'BMP', 'AVIF', 'ICO'].includes(ext)) {
            return ext === 'JPEG' ? 'JPG' : ext;
        }
    } catch (e) {}
    return 'IMG';
}

function getExtensionFromUrl(url) {
    try {
        const urlObj = new URL(url);
        const parts = urlObj.pathname.split('.');
        if (parts.length > 1) return '.' + parts.pop().toLowerCase();
    } catch (e) {}
    return '';
}

function sanitizeFilenamePart(name) {
    return String(name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
}

function sanitizeFolderInput(folder) {
    return String(folder || '').replace(/\\/g, '/').replace(/[<>:"|?*\x00-\x1f]/g, '_').trim();
}

function openLightbox(image) {
    if (elements.lightboxImg) elements.lightboxImg.src = image.src;
    if (elements.lightbox) elements.lightbox.classList.remove('hidden');
}

function closeLightbox() {
    if (elements.lightbox) elements.lightbox.classList.add('hidden');
    if (elements.lightboxImg) elements.lightboxImg.src = '';
}

function showLoader() {
    if (elements.loader) elements.loader.classList.remove('hidden');
    if (elements.emptyState) elements.emptyState.classList.add('hidden');
    if (elements.masonry) elements.masonry.classList.add('hidden');
}

function hideLoader() {
    if (elements.loader) elements.loader.classList.add('hidden');
}

function showEmptyState() {
    hideLoader();
    if (elements.emptyState) elements.emptyState.classList.remove('hidden');
    if (elements.masonry) elements.masonry.classList.add('hidden');
    if (elements.stats) elements.stats.textContent = '未选/未找到图片';
}

function showDiagnostics(summary) {
    if (!elements.downloadDiagnostics) return;
    elements.downloadDiagnostics.classList.remove('hidden');
    if (elements.downloadDiagnosticsSummary) elements.downloadDiagnosticsSummary.textContent = summary;
    if (elements.downloadDiagnosticsLog) {
        elements.downloadDiagnosticsLog.textContent = '';
        elements.downloadDiagnosticsLog.classList.add('hidden'); // 默认收起精简日志
    }
}

function appendDiagnosticsLog(message) {
    if (!elements.downloadDiagnosticsLog) return;
    elements.downloadDiagnosticsLog.textContent += message + '\n';
    elements.downloadDiagnosticsLog.scrollTop = elements.downloadDiagnosticsLog.scrollHeight;
}
