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
    filteredImages: [],      // 经过组合筛选后的图片数组
    selectedImages: new Set(), // 用户选中的图片索引集合（Set 结构去重）

    // ---------- 选择状态 ----------
    isAllSelected: false,    // 是否已全选所有可见图片
    lastSelectedIndex: null, // 上一次手动的选中索引（用于 Shift 键连续范围选择）

    // ---------- 筛选设置 ----------
    minResolution: 1000,     // 快速筛选：默认最小分辨率 1000px（优先精选高清大图）
    customMinWidth: 0,       // 自定义筛选：最小宽度
    customMinHeight: 0,      // 自定义筛选：最小高度
    selectedFormat: 'all',   // 图片格式筛选: 'all' | 'PNG' | 'JPG' | 'WEBP' | 'SVG' | 'GIF'
    selectedRatio: 'all',    // 图像比例筛选: 'all' | 'landscape' | 'portrait' | 'square'

    // ---------- 交互模式 ----------
    clickAction: 'select',   // 默认点击行为: 'select'（选择模式）

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
 *
 * 采用读-改-写合并策略：先读取当前存储再覆盖本页面管理的字段，
 * 避免整对象覆盖写把其他上下文（popup）刚写入的新值回滚掉。
 */
async function saveSettings() {
    try {
        const result = await chrome.storage.local.get(STORAGE_KEY);
        const current = result[STORAGE_KEY] || {};
        const settings = {
            ...current,
            minResolution: state.minResolution,
            customMinWidth: state.customMinWidth,
            customMinHeight: state.customMinHeight,
            selectedFormat: state.selectedFormat,
            selectedRatio: state.selectedRatio,
            downloadFolder: state.downloadFolder,
            columnCount: state.columnCount,
            theme: state.theme,
            isPanelOpen: state.isPanelOpen,
            canvasBg: state.canvasBg,
            autoCloseTabs: state.autoCloseTabs,
            isRenaming: state.isRenaming,        // 保存重命名开关状态
            renamePrefix: state.renamePrefix     // 保存重命名前缀文本
        };
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
            state.minResolution = settings.minResolution ?? 1000;
            state.customMinWidth = settings.customMinWidth ?? 0;
            state.customMinHeight = settings.customMinHeight ?? 0;
            state.selectedFormat = settings.selectedFormat ?? 'all';
            state.selectedRatio = settings.selectedRatio ?? 'all';
            state.downloadFolder = settings.downloadFolder ?? 'images';
            state.columnCount = settings.columnCount ?? 5;
            state.theme = settings.theme ?? ((window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');
            state.isPanelOpen = settings.isPanelOpen ?? false;
            state.canvasBg = settings.canvasBg ?? 'default';
            state.autoCloseTabs = settings.autoCloseTabs ?? false;
            state.isRenaming = settings.isRenaming ?? false;      // 恢复重命名开关状态
            state.renamePrefix = settings.renamePrefix ?? '';    // 恢复重命名前缀文本
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

    // 3. 下载配置与自动关页选项恢复
    if (elements.downloadFolder) elements.downloadFolder.value = state.downloadFolder;
    if (elements.autoCloseTabsToggle) elements.autoCloseTabsToggle.checked = state.autoCloseTabs;

    // 4. 重命名开关与前缀输入框UI恢复
    if (elements.renameToggle) elements.renameToggle.checked = state.isRenaming;
    if (elements.renamePrefix) {
        elements.renamePrefix.value = state.renamePrefix;
        elements.renamePrefix.disabled = !state.isRenaming;
    }

    // 4. 尺寸与分辨率筛选按钮激活态
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

    // 5. 格式与比例 Chip 标签激活态
    document.querySelectorAll('#formatFilterGroup .chip-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.format === state.selectedFormat);
    });
    document.querySelectorAll('#ratioFilterGroup .chip-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.ratio === state.selectedRatio);
    });
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
    invertSelectBtn: document.getElementById('invertSelectBtn'),
    downloadBtn: document.getElementById('downloadBtn'),

    // 筛选与重置按钮
    resetFilterBtn: document.getElementById('resetFilterBtn'),
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
    if (elements.invertSelectBtn) elements.invertSelectBtn.addEventListener('click', invertSelection);
    if (elements.downloadBtn) elements.downloadBtn.addEventListener('click', downloadSelected);
    if (elements.resetFilterBtn) elements.resetFilterBtn.addEventListener('click', resetAllFilters);
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

    // 绑定格式筛选 Chip 标签事件
    document.querySelectorAll('#formatFilterGroup .chip-btn').forEach(btn => {
        btn.addEventListener('click', () => setFormatFilter(btn.dataset.format, btn));
    });

    // 绑定比例筛选 Chip 标签事件
    document.querySelectorAll('#ratioFilterGroup .chip-btn').forEach(btn => {
        btn.addEventListener('click', () => setRatioFilter(btn.dataset.ratio, btn));
    });

    // Lightbox 全屏预览与全局键盘快捷键
    if (elements.lightboxClose) elements.lightboxClose.addEventListener('click', closeLightbox);
    if (elements.lightbox) {
        elements.lightbox.addEventListener('click', (e) => {
            if (e.target === elements.lightbox) closeLightbox();
        });
    }

    // 全局快捷键监听（Esc 关闭预览 / 面板，Ctrl+A 全选可见图片）
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeLightbox();
            if (state.isPanelOpen) applyFilterPanelState(false);
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
            // 当焦点未在输入框中时，触发一键全选
            if (!['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
                e.preventDefault();
                toggleSelectAll();
            }
        }
    });

    // 重命名与路径及自动关闭标签页事件
    if (elements.renameToggle) elements.renameToggle.addEventListener('change', toggleRename);
    if (elements.renamePrefix) {
        elements.renamePrefix.addEventListener('input', (e) => {
            const sanitized = sanitizeFilenamePart(e.target.value);
            e.target.value = sanitized;
            state.renamePrefix = sanitized;
            saveSettings(); // 即时持久化保存重命名前缀
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

    // 跨上下文设置实时同步：popup 中切换自动关页/重命名等开关时，
    // 已打开的画廊页内存状态不会自动更新，导致下载时仍传旧值
    // (autoClose=false)。监听 storage 变更实时同步共享开关与 UI。
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
        const next = changes[STORAGE_KEY].newValue;
        if (!next) return;

        if (typeof next.autoCloseTabs === 'boolean' && next.autoCloseTabs !== state.autoCloseTabs) {
            state.autoCloseTabs = next.autoCloseTabs;
            if (elements.autoCloseTabsToggle) elements.autoCloseTabsToggle.checked = next.autoCloseTabs;
        }
        if (typeof next.isRenaming === 'boolean' && next.isRenaming !== state.isRenaming) {
            state.isRenaming = next.isRenaming;
            if (elements.renameToggle) elements.renameToggle.checked = next.isRenaming;
            if (elements.renamePrefix) elements.renamePrefix.disabled = !next.isRenaming;
        }
        if (typeof next.renamePrefix === 'string' && next.renamePrefix !== state.renamePrefix) {
            state.renamePrefix = next.renamePrefix;
            if (elements.renamePrefix) elements.renamePrefix.value = next.renamePrefix;
        }
        if (typeof next.downloadFolder === 'string' && next.downloadFolder !== state.downloadFolder) {
            state.downloadFolder = next.downloadFolder;
            if (elements.downloadFolder) elements.downloadFolder.value = next.downloadFolder;
        }
    });

    // 加载配置并提取图片
    await loadSettings();
    applySettingsToUI();
    await extractImages();
}

// ============================================================
// 列数与筛选控制
// ============================================================
/**
 * 动态更新画廊网格列数 (支持 1-8 列)
 * @param {number} count 目标列数
 * @returns {void}
 * 
 * 详细逻辑：
 * 1. 限制目标列数在 [1, 8] 范围内；
 * 2. 更新全局状态 state.columnCount；
 * 3. 动态调整 CSS 自定义变量 --column-count 及 grid-template-columns 网格平铺规则；
 * 4. 同步更新滑动条输入框 (columnSlider) 与数字文本显示 (columnValue)。
 */
function updateColumnCount(count) {
    const newCount = Math.max(1, Math.min(8, count));
    state.columnCount = newCount;
    if (elements.masonry) {
        elements.masonry.style.setProperty('--column-count', newCount);
        elements.masonry.style.gridTemplateColumns = `repeat(${newCount}, 1fr)`;
    }
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

/**
 * 设置图片文件格式筛选条件 (PNG / JPG / WEBP / SVG / GIF / all)
 * @param {string} format 目标格式
 * @param {HTMLElement} activeBtn 激活的 Chip 按钮
 */
function setFormatFilter(format, activeBtn) {
    state.selectedFormat = format;
    document.querySelectorAll('#formatFilterGroup .chip-btn').forEach(btn => btn.classList.remove('active'));
    if (activeBtn) activeBtn.classList.add('active');

    applyFilter();
    saveSettings();
}

/**
 * 设置图像宽高比例筛选条件 (landscape / portrait / square / all)
 * @param {string} ratio 目标宽高比类别
 * @param {HTMLElement} activeBtn 激活的 Chip 按钮
 */
function setRatioFilter(ratio, activeBtn) {
    state.selectedRatio = ratio;
    document.querySelectorAll('#ratioFilterGroup .chip-btn').forEach(btn => btn.classList.remove('active'));
    if (activeBtn) activeBtn.classList.add('active');

    applyFilter();
    saveSettings();
}

/**
 * 一键重置所有筛选过滤条件为默认状态 (默认 1000px 分辨率)
 */
function resetAllFilters() {
    state.minResolution = 1000;
    state.customMinWidth = 0;
    state.customMinHeight = 0;
    state.selectedFormat = 'all';
    state.selectedRatio = 'all';

    if (elements.minWidth) elements.minWidth.value = '';
    if (elements.minHeight) elements.minHeight.value = '';

    applySettingsToUI();
    applyFilter();
    saveSettings();
}

/**
 * 联合应用分辨率、自定义尺寸、文件格式与比例综合筛选
 */
function applyFilter() {
    state.selectedImages.clear();
    state.lastSelectedIndex = null;

    state.filteredImages = state.images.filter(img => {
        const width = img.width || 0;
        const height = img.height || 0;

        // 1. 分辨率尺寸校验
        let sizeMatch = false;
        if (state.customMinWidth > 0 || state.customMinHeight > 0) {
            sizeMatch = width >= state.customMinWidth && height >= state.customMinHeight;
        } else {
            const maxDim = Math.max(width, height);
            sizeMatch = maxDim >= state.minResolution;
        }
        if (!sizeMatch) return false;

        // 2. 文件格式校验
        if (state.selectedFormat !== 'all') {
            const format = getImageFormatFromUrl(img.src).toUpperCase();
            const targetFormat = state.selectedFormat.toUpperCase();
            if (targetFormat === 'JPG') {
                if (format !== 'JPG' && format !== 'JPEG') return false;
            } else if (format !== targetFormat) {
                return false;
            }
        }

        // 3. 图像宽高比例校验
        if (state.selectedRatio !== 'all' && width > 0 && height > 0) {
            const ratio = width / height;
            if (state.selectedRatio === 'landscape' && ratio <= 1.1) return false; // 横图
            if (state.selectedRatio === 'portrait' && ratio >= 0.9) return false;  // 竖图
            if (state.selectedRatio === 'square' && (ratio < 0.9 || ratio > 1.1)) return false; // 方形
        }

        return true;
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
// 跨标签页提取逻辑 (包含超时竞争防护与防卡死熔断)
// ============================================================
async function extractImages() {
    showLoader();

    state.images = [];
    state.filteredImages = [];
    state.selectedImages.clear();
    state.lastSelectedIndex = null;
    updateSelectAllButton();
    updateDownloadButton();

    try {
        const tabs = await chrome.tabs.query({});
        const validTabs = tabs.filter(tab => {
            const pageUrl = tab.url || tab.pendingUrl || '';
            if (pageUrl) {
                return !pageUrl.startsWith('chrome://') &&
                       !pageUrl.startsWith('chrome-extension://') &&
                       !pageUrl.startsWith('edge://') &&
                       !pageUrl.startsWith('about:');
            }
            return true; // 即使 MV3 中非激活标签页 url 字段为 undefined，依然保留其 ID 进行提取与后续关页
        });

        if (validTabs.length === 0) {
            showEmptyState();
            return;
        }

        const imagePromises = validTabs.map(async (tab) => {
            try {
                const scriptPromise = chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: extractImagesFromPage
                });

                const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 2500));
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

        const globalTimeoutPromise = new Promise(resolve => setTimeout(() => resolve([]), 6000));
        const allImagesResult = await Promise.race([
            Promise.all(imagePromises),
            globalTimeoutPromise
        ]);

        const flatImages = allImagesResult.flat();
        const urlMap = new Map();

        flatImages.forEach(img => {
            if (!urlMap.has(img.src)) {
                const initialTabIds = typeof img.tabId === 'number' ? [img.tabId] : [];
                urlMap.set(img.src, {
                    ...img,
                    tabIds: initialTabIds
                });
            } else {
                const existing = urlMap.get(img.src);
                if (typeof img.tabId === 'number' && Array.isArray(existing.tabIds)) {
                    if (!existing.tabIds.includes(img.tabId)) {
                        existing.tabIds.push(img.tabId);
                    }
                }
            }
        });

        state.images = Array.from(urlMap.values());

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
// 渲染瀑布流卡片 (支持悬浮快捷工具栏与勾选指示器)
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

/**
 * 创建包含缩略图、格式 Badge、Hover 工具栏与底层元数据栏的图片卡片 DOM
 * @param {Object} image 单张图片元数据对象
 * @param {number} index 当前图片在 filteredImages 中的索引
 * @returns {HTMLDivElement} 卡片 DOM 元素
 */
function createImageCard(image, index) {
    const card = document.createElement('div');
    card.className = 'image-card';
    card.dataset.index = index;

    if (state.selectedImages.has(index)) {
        card.classList.add('selected');
    }

    const img = document.createElement('img');
    img.src = image.src;
    img.alt = `Image ${index + 1}`;
    img.loading = 'lazy';

    // 格式 Badge 与 4K/2K/FHD 画质徽章
    const format = getImageFormatFromUrl(image.src);
    const formatBadge = document.createElement('div');
    formatBadge.className = `format-badge ${format.toLowerCase()}`;
    formatBadge.textContent = format;

    // 计算图片分辨率尺寸与像素量，用于识别高画质徽章 (4K / 2K / FHD)
    const maxDimension = Math.max(image.width || 0, image.height || 0);
    const pixelCount = (image.width || 0) * (image.height || 0);

    // 针对大图保留 is-large 标识类（可在样式中做高亮扩展，CSS 中取消强制 span 2 跨列以确保列数排布准确）
    if ((image.width >= 2400 || pixelCount >= 3800000) && (image.width >= image.height)) {
        card.classList.add('is-large');
    }

    if (maxDimension >= 3840 || pixelCount >= 8000000) {
        formatBadge.classList.add('badge-4k');
        formatBadge.textContent = '4K UHD';
    } else if (maxDimension >= 2560 || pixelCount >= 3600000) {
        formatBadge.classList.add('badge-2k');
        formatBadge.textContent = '2K QHD';
    } else if (maxDimension >= 1920 || pixelCount >= 2000000) {
        formatBadge.classList.add('badge-fhd');
        formatBadge.textContent = 'FHD 1080P';
    }

    // 勾选指示器 Badge (注入 SVG 对勾图标)
    const checkIndicator = document.createElement('div');
    checkIndicator.className = 'check-indicator';
    checkIndicator.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

    // Hover 悬浮工具栏（提供放大预览、复制 URL、单图下载 3 个快捷按钮）
    const hoverTools = document.createElement('div');
    hoverTools.className = 'card-hover-tools';

    const previewBtn = document.createElement('button');
    previewBtn.className = 'hover-tool-btn';
    previewBtn.title = '放大预览图片';
    previewBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
    previewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openLightbox(image);
    });

    const copyBtn = document.createElement('button');
    copyBtn.className = 'hover-tool-btn';
    copyBtn.title = '复制图片链接';
    copyBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
    copyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(image.src);
            showDiagnostics(`已复制图片 URL 到剪贴板: ${image.src.substring(0, 50)}...`);
        } catch (err) {
            console.error('复制 URL 失败:', err);
        }
    });

    const singleDownloadBtn = document.createElement('button');
    singleDownloadBtn.className = 'hover-tool-btn';
    singleDownloadBtn.title = '单图快速下载';
    singleDownloadBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>`;
    singleDownloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadSingleImage(image);
    });

    hoverTools.appendChild(previewBtn);
    hoverTools.appendChild(copyBtn);
    hoverTools.appendChild(singleDownloadBtn);

    // 底部信息栏
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

        // 二次检测大图 Bento 跨列与徽章状态
        const maxD = Math.max(image.width, image.height);
        const pixels = image.width * image.height;
        if ((image.width >= 2400 || pixels >= 3800000) && (image.width >= image.height)) {
            card.classList.add('is-large');
        }

        if (maxD >= 3840 || pixels >= 8000000) {
            formatBadge.classList.add('badge-4k');
            formatBadge.textContent = '4K UHD';
        } else if (maxD >= 2560 || pixels >= 3600000) {
            formatBadge.classList.add('badge-2k');
            formatBadge.textContent = '2K QHD';
        } else if (maxD >= 1920 || pixels >= 2000000) {
            formatBadge.classList.add('badge-fhd');
            formatBadge.textContent = 'FHD 1080P';
        }
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

    card.appendChild(img);
    card.appendChild(formatBadge);
    card.appendChild(checkIndicator);
    card.appendChild(hoverTools);
    card.appendChild(cardInfoBar);

    // 点击事件绑定（支持普通点击与 Shift 键连续范围选取）
    card.addEventListener('click', (e) => handleImageClick(card, index, e));

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
// 交互模式与事件处理 (多选、Shift 连选、反选)
// ============================================================

/**
 * 处理卡片点击逻辑（支持按住 Shift 键跨范围批量多选）
 * @param {HTMLDivElement} card 卡片 DOM
 * @param {number} index 卡片当前索引
 * @param {MouseEvent} event 鼠标点击事件
 */
function handleImageClick(card, index, event) {
    if (event && event.shiftKey && state.lastSelectedIndex !== null && state.lastSelectedIndex !== index) {
        const start = Math.min(state.lastSelectedIndex, index);
        const end = Math.max(state.lastSelectedIndex, index);

        for (let i = start; i <= end; i++) {
            state.selectedImages.add(i);
        }

        document.querySelectorAll('.image-card').forEach(c => {
            const idx = parseInt(c.dataset.index, 10);
            if (state.selectedImages.has(idx)) {
                c.classList.add('selected');
            }
        });

        updateStats();
        updateSelectAllButton();
        updateDownloadButton();
    } else {
        toggleImageSelection(card, index);
    }
    state.lastSelectedIndex = index;
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

/**
 * 反向选择图片（反选）
 */
function invertSelection() {
    state.filteredImages.forEach((_, index) => {
        if (state.selectedImages.has(index)) {
            state.selectedImages.delete(index);
        } else {
            state.selectedImages.add(index);
        }
    });

    document.querySelectorAll('.image-card').forEach(card => {
        const idx = parseInt(card.dataset.index, 10);
        if (state.selectedImages.has(idx)) {
            card.classList.add('selected');
        } else {
            card.classList.remove('selected');
        }
    });

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
        if (iconSpan) {
            iconSpan.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" ry="3" fill="currentColor"></rect><polyline points="9 11 12 14 22 4" stroke="#ffffff" stroke-width="2.5"></polyline></svg>`;
        }
        if (textSpan) textSpan.textContent = '取消全选';
        elements.selectAllBtn.classList.add('active');
    } else {
        if (iconSpan) {
            iconSpan.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" ry="3"></rect></svg>`;
        }
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
    saveSettings(); // 即时保存重命名开关设置
}

/**
 * 从图片元数据对象中强类型安全地提取所有合法的标签页 ID (number[])
 * @param {Object} img 图片元数据
 * @returns {number[]} 清洗后的标签页 ID 数组
 */
function extractTabIdsFromImg(img) {
    const ids = [];
    if (!img) return ids;
    if (Array.isArray(img.tabIds)) {
        img.tabIds.forEach(id => {
            const num = Number(id);
            if (Number.isInteger(num) && !ids.includes(num)) ids.push(num);
        });
    }
    if (img.tabId) {
        const num = Number(img.tabId);
        if (Number.isInteger(num) && !ids.includes(num)) ids.push(num);
    }
    return ids;
}

/**
 * 触发单张图片快速下载
 * @param {Object} image 单张图片元数据对象
 */
async function downloadSingleImage(image) {
    const folder = state.downloadFolder || 'images';
    showDiagnostics(`正在下载单张图片...`);
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'download',
            url: image.src,
            folder: folder,
            tabId: image.tabId,
            autoClose: state.autoCloseTabs
        });
        if (response && response.success) {
            appendDiagnosticsLog(`单图下载请求提交成功 ID: ${response.downloadId}`);
            if (elements.downloadDiagnosticsSummary) {
                elements.downloadDiagnosticsSummary.textContent = '单图下载成功！';
            }

            // 若开启自动关页：关页统一由后台 Service Worker 在下载落盘完成后执行
            // （后台基于 storage.session 持久化追踪 + 终态补偿查询，跨 SW 重启可靠）
            if (state.autoCloseTabs) {
                const tabIdsToClose = extractTabIdsFromImg(image);
                if (tabIdsToClose.length > 0) {
                    if (elements.downloadDiagnosticsLog) elements.downloadDiagnosticsLog.classList.remove('hidden');
                    appendDiagnosticsLog(`[自动关页] 已登记 ${tabIdsToClose.length} 个关联标签页 (IDs: ${tabIdsToClose.join(', ')})，后台将在下载落盘完成后自动关闭。`);
                } else {
                    appendDiagnosticsLog(`[单图关页提示] 该图片未绑定有效来源标签页 ID (tabId: ${image.tabId})`);
                }
            }

            setTimeout(() => {
                if (elements.downloadDiagnostics) elements.downloadDiagnostics.classList.add('hidden');
            }, 4000);
        } else {
            appendDiagnosticsLog(`下载失败: ${response?.error || '未知错误'}`);
        }
    } catch (err) {
        appendDiagnosticsLog(`下载发送异常: ${err.message}`);
    }
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
    const successfulTabIds = new Set(); // 搜集下载成功的关联 tabId 集合

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
                folder: folder,
                tabId: image.tabId,
                autoClose: state.autoCloseTabs
            });

            if (response && response.success) {
                successCount++;
                extractTabIdsFromImg(image).forEach(id => successfulTabIds.add(id));
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

    // 先恢复按钮可用状态，避免关页等待期间按钮一直被禁用
    updateDownloadButton();
    
    // 自动关页统一由后台 Service Worker 在下载落盘完成后执行：
    // 后台基于 storage.session 持久化追踪每个 tabId 的任务计数，并在登记时
    // 补偿查询终态，可跨 SW 休眠/重启存活；前端不再双轨轮询关页，
    // 避免与后台计数机制互相干扰。
    if (state.autoCloseTabs) {
        if (successfulTabIds.size > 0) {
            if (elements.downloadDiagnosticsLog) elements.downloadDiagnosticsLog.classList.remove('hidden');
            appendDiagnosticsLog(`[自动关页] 已为 ${successfulTabIds.size} 个关联标签页登记自动关闭，后台将在对应下载落盘完成后自动关闭。`);
        } else {
            appendDiagnosticsLog(`[关页提示] 未收集到任何关联标签页 ID 或图片下载均未成功，跳过自动关页。`);
        }
    }

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
