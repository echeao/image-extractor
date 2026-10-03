/**
 * Image Extractor - Popup Script
 * 负责协调图片提取、展示和下载 (全矢量 SVG 图标版本，零 Emoji)
 */

// ========== 全局状态 ==========
const state = {
  images: [],              // 所有提取的图片（原始数据）
  filteredImages: [],      // 过滤后的图片
  selectedImages: new Set(), // 已选中的图片 URL (src) 集合（Set 结构去重解耦）
  isAllSelected: false,    // 是否全选
  minResolution: 1000,     // 默认最小分辨率 1000px
  isRenaming: false,       // 是否开启重命名
  renamePrefix: '',        // 重命名前缀
  downloadFolder: 'images' // 默认存储文件夹
};

// ========== DOM 元素 ==========
const elements = {
  loader: document.getElementById('loader'),
  emptyState: document.getElementById('emptyState'),
  masonry: document.getElementById('masonry'),
  stats: document.getElementById('stats'),
  filterStats: document.getElementById('filterStats'),
  openGalleryBtn: document.getElementById('openGalleryBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  selectAllBtn: document.getElementById('selectAllBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  renameToggle: document.getElementById('renameToggle'),
  renamePrefix: document.getElementById('renamePrefix'),
  downloadFolder: document.getElementById('downloadFolder'),
  autoCloseTabsToggle: document.getElementById('autoCloseTabsToggle')
};

// ========== 设置持久化存储 ==========
const STORAGE_KEY = 'imageExtractorSettings';

/**
 * 保存设置到 chrome.storage.local (包含重命名设置及关页选项)
 */
async function saveSettings() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const currentSettings = result[STORAGE_KEY] || {};
    const updatedSettings = {
      ...currentSettings,
      isRenaming: state.isRenaming,
      renamePrefix: state.renamePrefix,
      autoCloseTabs: state.autoCloseTabs,
      downloadFolder: state.downloadFolder
    };
    await chrome.storage.local.set({ [STORAGE_KEY]: updatedSettings });
  } catch (error) {
    console.error('Popup 保存设置失败:', error);
  }
}

/**
 * 从 chrome.storage.local 加载已保存的配置
 */
async function loadSettings() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const settings = result[STORAGE_KEY];
    if (settings) {
      state.isRenaming = settings.isRenaming ?? false;
      state.renamePrefix = settings.renamePrefix ?? '';
      state.autoCloseTabs = settings.autoCloseTabs ?? false;
      if (settings.downloadFolder) state.downloadFolder = settings.downloadFolder;
    }
  } catch (error) {
    console.error('Popup 加载设置失败:', error);
  }
}

/**
 * 将配置应用到 UI 元素
 */
function applySettingsToUI() {
  if (elements.renameToggle) elements.renameToggle.checked = state.isRenaming;
  if (elements.autoCloseTabsToggle) elements.autoCloseTabsToggle.checked = state.autoCloseTabs;
  if (elements.downloadFolder) elements.downloadFolder.value = state.downloadFolder;
  if (elements.renamePrefix) {
    elements.renamePrefix.value = state.renamePrefix;
    elements.renamePrefix.disabled = !state.isRenaming;
  }
}

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', init);

async function init() {
  // 绑定主画廊与核心按钮事件
  if (elements.openGalleryBtn) {
    elements.openGalleryBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('gallery/gallery.html') });
    });
  }
  if (elements.refreshBtn) elements.refreshBtn.addEventListener('click', extractImages);
  if (elements.selectAllBtn) elements.selectAllBtn.addEventListener('click', toggleSelectAll);
  if (elements.downloadBtn) elements.downloadBtn.addEventListener('click', downloadSelected);

  // 绑定分辨率筛选按钮事件
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const minRes = parseInt(btn.dataset.min, 10);
      setMinResolution(minRes, btn);
    });
  });

  // 批量重命名与自动关页控制
  if (elements.renameToggle) elements.renameToggle.addEventListener('change', toggleRename);
  if (elements.autoCloseTabsToggle) {
    elements.autoCloseTabsToggle.addEventListener('change', (e) => {
      state.autoCloseTabs = e.target.checked;
      saveSettings();
    });
  }
  if (elements.downloadFolder) {
    elements.downloadFolder.addEventListener('input', (e) => {
      const sanitized = sanitizeFilenamePart(e.target.value);
      state.downloadFolder = sanitized || 'images';
      saveSettings();
    });
  }
  if (elements.renamePrefix) {
    elements.renamePrefix.addEventListener('input', (e) => {
      const sanitized = sanitizeFilenamePart(e.target.value);
      e.target.value = sanitized;
      state.renamePrefix = sanitized;
      saveSettings(); // 即时保存前缀设置
    });
  }

  // 实例化剪切板智能拆分与重命名助手
  if (window.ClipboardSmartPaste) {
    new window.ClipboardSmartPaste({
      folderInput: elements.downloadFolder,
      prefixInput: elements.renamePrefix,
      renameToggle: elements.renameToggle,
      onApply: (data) => {
        if (typeof data.folder === 'string') {
          state.downloadFolder = sanitizeFilenamePart(data.folder) || 'images';
          if (elements.downloadFolder) elements.downloadFolder.value = state.downloadFolder;
        }
        if (typeof data.prefix === 'string') {
          state.renamePrefix = sanitizeFilenamePart(data.prefix);
          if (elements.renamePrefix) elements.renamePrefix.value = state.renamePrefix;
        }
        if (typeof data.isRenaming === 'boolean') {
          state.isRenaming = data.isRenaming;
          if (elements.renameToggle) elements.renameToggle.checked = state.isRenaming;
          if (elements.renamePrefix) elements.renamePrefix.disabled = !state.isRenaming;
        }
        saveSettings();
      }
    });
  }

  // 跨上下文设置实时同步：画廊页中切换自动关页开关时，popup 内存状态
  // 不会自动更新，会导致下载时仍传旧值 (autoClose=false)
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
    const next = changes[STORAGE_KEY].newValue;
    if (!next || typeof next.autoCloseTabs !== 'boolean') return;
    if (next.autoCloseTabs !== state.autoCloseTabs) {
      state.autoCloseTabs = next.autoCloseTabs;
      if (elements.autoCloseTabsToggle) elements.autoCloseTabsToggle.checked = next.autoCloseTabs;
    }
  });

  // 监听标签页关闭事件，当标签页被后台自动关闭或用户手动关闭时实时平滑清理对应图片
  chrome.tabs.onRemoved.addListener(handleTabRemoved);

  // 加载已保存设置并渲染到 UI
  await loadSettings();
  applySettingsToUI();

  // 开始提取图片
  await extractImages();
}

// ========== 分辨率筛选 ==========
function setMinResolution(minRes, activeBtn) {
  state.minResolution = minRes;

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  if (activeBtn) activeBtn.classList.add('active');

  applyFilter();
}

/**
 * 校验单张图片是否满足当前的分辨率筛选规则
 * @param {Object} img 图片元数据
 * @returns {boolean}
 */
function isImagePassingCurrentFilter(img) {
  if (state.minResolution === 0) return true;
  const maxDim = Math.max(img.width || 0, img.height || 0);
  return maxDim >= state.minResolution;
}

// 防抖重新筛选定时器
let debouncedFilterTimer = null;
function scheduleDebouncedApplyFilter() {
  if (debouncedFilterTimer) clearTimeout(debouncedFilterTimer);
  debouncedFilterTimer = setTimeout(() => {
    applyFilter();
  }, 120);
}

/**
 * 当图片真实物理分辨率被异步解码/探测解析完成后的回调处理
 * 
 * @param {Object} image 单张图片数据对象
 * @param {number} realWidth 真实自然宽度 (px)
 * @param {number} realHeight 真实自然高度 (px)
 * @param {HTMLElement} [cardElement=null] 对应的卡片 DOM 元素（若已渲染）
 */
function handleImageDimensionResolved(image, realWidth, realHeight, cardElement = null) {
  if (!image || !realWidth || !realHeight) return;
  if (image.width === realWidth && image.height === realHeight) return;

  image.width = realWidth;
  image.height = realHeight;

  const matchesFilter = isImagePassingCurrentFilter(image);
  const inFilteredIndex = state.filteredImages.findIndex(item => item.src === image.src);

  if (!matchesFilter && inFilteredIndex !== -1) {
    // 真实尺寸不满足当前筛选条件（如实测只有 200x200 的 WebP 图），从列表中剔除
    state.filteredImages.splice(inFilteredIndex, 1);
    if (state.selectedImages.has(image.src)) {
      state.selectedImages.delete(image.src);
      updateDownloadButton();
    }

    if (cardElement && cardElement.parentNode) {
      cardElement.remove();
    } else {
      const card = document.querySelector(`.image-card[data-src="${CSS.escape(image.src)}"]`);
      if (card) card.remove();
    }

    updateFilterStats();
    updateStats();
    updateSelectAllButton();

    if (state.filteredImages.length === 0) {
      showEmptyState();
    }
  } else if (matchesFilter && inFilteredIndex === -1) {
    // 探测出真实尺寸符合大图条件，加入列表并重新渲染
    scheduleDebouncedApplyFilter();
  }
}

function applyFilter() {
  state.selectedImages.clear();

  state.filteredImages = state.images.filter(img => isImagePassingCurrentFilter(img));

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
      elements.filterStats.textContent = `已过滤 ${hidden} 张`;
    } else {
      elements.filterStats.textContent = '';
    }
  }
}

// ========== 图片提取 ==========
async function extractImages() {
  showLoader();
  state.images = [];
  state.filteredImages = [];
  state.selectedImages.clear();
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
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractImagesFromPage
        });

        if (results && results[0] && results[0].result) {
          return results[0].result.map(img => ({
            ...img,
            tabTitle: tab.title || 'Unknown',
            tabId: tab.id
          }));
        }
      } catch (error) {
        console.log(`无法从标签页提取图片: ${tab.url}`, error);
      }
      return [];
    });

    const allImages = await Promise.all(imagePromises);
    const flatImages = allImages.flat();
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
      // 启动轻量尺寸探测池
      probeImageDimensions(state.images);
    }
  } catch (error) {
    console.error('提取图片时出错:', error);
    showEmptyState();
  }
}

/**
 * 针对所有初始宽度或高度为 0 的图片进行异步轻量尺寸探测
 * @param {Array<Object>} images
 */
function probeImageDimensions(images) {
  if (!Array.isArray(images) || images.length === 0) return;
  const zeroDimImages = images.filter(img => !img.width || !img.height);

  zeroDimImages.forEach(image => {
    if (!image.src || image.src.startsWith('data:image/svg')) return;
    const probeImg = new Image();
    probeImg.src = image.src;

    probeImg.onload = () => {
      const w = probeImg.naturalWidth || 0;
      const h = probeImg.naturalHeight || 0;
      if (w > 0 && h > 0) {
        handleImageDimensionResolved(image, w, h);
      }
    };

    probeImg.onerror = () => {};
  });
}

/**
 * 注入到标签页中执行的图片提取脚本
 */
function extractImagesFromPage() {
  const images = [];
  const seenSrcs = new Set();

  document.querySelectorAll('img').forEach(img => {
    const dataset = img.dataset || {};
    const rawHighRes = dataset.original || dataset.fullSrc || dataset.highRes || dataset.zoomImage || dataset.src || dataset.lazySrc;
    const currentImgSrc = img.src || '';
    const originalSrc = rawHighRes || currentImgSrc;

    const naturalW = img.naturalWidth || 0;
    const naturalH = img.naturalHeight || 0;

    if (originalSrc && !seenSrcs.has(originalSrc) && isValidImage(img, originalSrc)) {
      seenSrcs.add(originalSrc);
      images.push({
        src: originalSrc,
        width: naturalW,
        height: naturalH
      });
    }
  });

  // 提取 CSS 背景图（初始尺寸置 0，严禁使用 offsetWidth/offsetHeight 容器尺寸）
  document.querySelectorAll('*').forEach(el => {
    const style = window.getComputedStyle(el);
    const bgImage = style.backgroundImage;
    if (bgImage && bgImage !== 'none') {
      const urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
      if (urlMatch && urlMatch[1] && !seenSrcs.has(urlMatch[1])) {
        seenSrcs.add(urlMatch[1]);
        images.push({
          src: urlMatch[1],
          width: 0,
          height: 0
        });
      }
    }
  });

  // 提取 picture source 响应式图片
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
    const width = img.naturalWidth || 0;
    const height = img.naturalHeight || 0;
    if (width > 0 && width < 30 && height > 0 && height < 30) return false;
    if (src.startsWith('data:') && src.length < 1000) return false;
    if (src.includes('pixel') || src.includes('tracking') || src.includes('spacer')) return false;
    return true;
  }

  return images;
}

// ========== 渲染图片 ==========
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
  card.dataset.src = image.src;

  if (state.selectedImages.has(image.src)) {
    card.classList.add('selected');
  }

  const img = document.createElement('img');
  img.src = image.src;
  img.alt = `Image ${index + 1}`;
  img.loading = 'lazy';

  const resolutionTag = document.createElement('div');
  resolutionTag.className = 'resolution-tag';

  img.onload = () => {
    if (img.src === image.src && img.naturalWidth && img.naturalHeight) {
      handleImageDimensionResolved(image, img.naturalWidth, img.naturalHeight, card);
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

  // 使用 SVG 替代字符对勾
  const checkIndicator = document.createElement('div');
  checkIndicator.className = 'check-indicator';
  checkIndicator.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

  const sourceTag = document.createElement('div');
  sourceTag.className = 'source-tag';
  sourceTag.textContent = image.tabTitle || 'Unknown';

  card.appendChild(img);
  card.appendChild(checkIndicator);
  card.appendChild(resolutionTag);
  card.appendChild(sourceTag);

  card.addEventListener('click', () => toggleImageSelection(card, image));

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

// ========== 选择与下载逻辑 ==========
function toggleImageSelection(card, image) {
  if (!image || !image.src) return;
  if (state.selectedImages.has(image.src)) {
    state.selectedImages.delete(image.src);
    card.classList.remove('selected');
  } else {
    state.selectedImages.add(image.src);
    card.classList.add('selected');
  }

  updateSelectAllButton();
  updateDownloadButton();
  updateStats();
}

function toggleSelectAll() {
  const cards = document.querySelectorAll('.image-card');

  if (state.isAllSelected) {
    state.selectedImages.clear();
    cards.forEach(card => card.classList.remove('selected'));
    state.isAllSelected = false;
  } else {
    state.filteredImages.forEach(img => {
      if (img && img.src) state.selectedImages.add(img.src);
    });
    cards.forEach(card => {
      if (card.style.display !== 'none') {
        card.classList.add('selected');
      }
    });
    state.isAllSelected = true;
  }

  updateSelectAllButton();
  updateDownloadButton();
  updateStats();
}

function updateSelectAllButton() {
  const btn = elements.selectAllBtn;
  if (!btn) return;
  const visibleCards = document.querySelectorAll('.image-card:not([style*="display: none"])');
  state.isAllSelected = visibleCards.length > 0 && state.selectedImages.size === visibleCards.length;

  if (state.isAllSelected) {
    btn.classList.add('active');
    btn.innerHTML = '<span class="checkbox-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" ry="3" fill="currentColor"></rect><polyline points="9 11 12 14 22 4" stroke="#ffffff" stroke-width="2.5"></polyline></svg></span> 全选';
  } else {
    btn.classList.remove('active');
    btn.innerHTML = '<span class="checkbox-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" ry="3"></rect></svg></span> 全选';
  }
}

function updateDownloadButton() {
  const btn = elements.downloadBtn;
  if (!btn) return;
  const count = state.selectedImages.size;

  btn.disabled = count === 0;
  btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
    </svg>
    <span>下载选中${count > 0 ? ` (${count})` : ''}</span>
  `;
}

/**
 * 从图片 URL 中智能提取图片格式标识
 * @param {string} url
 * @returns {string}
 */
function getImageFormatFromUrl(url) {
  if (!url) return 'IMG';
  if (url.startsWith('data:image/')) {
    const mimeMatch = url.match(/data:image\/([a-zA-Z0-9+-]+);/);
    if (mimeMatch && mimeMatch[1]) {
      const rawMime = mimeMatch[1].toUpperCase();
      if (rawMime === 'JPEG') return 'JPG';
      if (rawMime === 'SVG+XML') return 'SVG';
      if (rawMime === 'WEBPG') return 'WEBP';
      return rawMime;
    }
  }

  try {
    const lowerUrl = url.toLowerCase();
    const cdnFormatMatch = lowerUrl.match(/(?:[?&](?:wx_fmt|format|fmt|f)=|format[,\/])([a-zA-Z0-9]+)/);
    if (cdnFormatMatch && cdnFormatMatch[1]) {
      const cdnFmt = cdnFormatMatch[1].toUpperCase();
      if (['PNG', 'JPG', 'JPEG', 'WEBP', 'WEBPG', 'GIF', 'SVG', 'BMP', 'AVIF', 'ICO'].includes(cdnFmt)) {
        if (cdnFmt === 'JPEG') return 'JPG';
        if (cdnFmt === 'WEBPG') return 'WEBP';
        return cdnFmt;
      }
    }

    const cleanUrl = url.split('?')[0].split('#')[0];
    const ext = cleanUrl.split('.').pop().toUpperCase();
    if (['PNG', 'JPG', 'JPEG', 'WEBP', 'WEBPG', 'GIF', 'SVG', 'BMP', 'AVIF', 'ICO'].includes(ext)) {
      if (ext === 'JPEG') return 'JPG';
      if (ext === 'WEBPG') return 'WEBP';
      return ext;
    }
  } catch (e) {}

  return 'IMG';
}

/**
 * 从 URL 中提取标准扩展名（含点号，小写）
 * @param {string} url
 * @returns {string}
 */
function getExtensionFromUrl(url) {
  try {
    const fmt = getImageFormatFromUrl(url);
    if (fmt && fmt !== 'IMG') {
      return '.' + fmt.toLowerCase();
    }
    const urlObj = new URL(url);
    const parts = urlObj.pathname.split('.');
    if (parts.length > 1) {
      const ext = parts.pop().toLowerCase();
      if (ext === 'jpeg') return '.jpg';
      if (ext === 'webpg') return '.webp';
      return '.' + ext;
    }
  } catch (e) {}
  return '';
}

// ========== 核心批量下载功能 ==========
async function downloadSelected() {
  const selectedImageList = state.filteredImages.filter(img => state.selectedImages.has(img.src));
  if (selectedImageList.length === 0) return;

  const total = selectedImageList.length;
  const padding = total.toString().length;
  const folder = state.downloadFolder || 'images';

  for (let i = 0; i < total; i++) {
    const image = selectedImageList[i];
    const url = image.src;
    let filename = null;

    if (state.isRenaming && state.renamePrefix) {
      const ext = getExtensionFromUrl(url) || '.jpg';
      const num = (i + 1).toString().padStart(padding, '0');
      filename = `${state.renamePrefix}_${num}${ext}`;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'download',
        url: url,
        filename: filename,
        folder: folder,
        tabId: image.tabId,
        autoClose: state.autoCloseTabs
      });

      if (!response?.success) {
        throw new Error(response?.error || '下载失败');
      }
      // 自动关页统一由后台 Service Worker 在下载落盘完成后执行
    } catch (error) {
      console.error('下载失败:', url, error);
    }
  }

  state.selectedImages.clear();
  document.querySelectorAll('.image-card.selected').forEach(card => {
    card.classList.remove('selected');
  });
  updateSelectAllButton();
  updateDownloadButton();
  updateStats();
}

// ========== 标签页关闭监听与同步清理 ==========

/**
 * 标签页关闭事件响应入口
 * @param {number} tabId 被关闭的标签页 ID
 */
function handleTabRemoved(tabId) {
  removeImagesByTabId(tabId);
}

/**
 * 根据被关闭的 tabId 清洗内存中的图片列表与 DOM 卡片
 * @param {number} tabId 被关闭的标签页 ID
 */
function removeImagesByTabId(tabId) {
  if (typeof tabId !== 'number') return;

  const removedSrcs = new Set();

  state.images = state.images.filter(img => {
    if (Array.isArray(img.tabIds)) {
      const idx = img.tabIds.indexOf(tabId);
      if (idx !== -1) {
        img.tabIds.splice(idx, 1);
      }
    }
    if (img.tabId === tabId) {
      img.tabId = (Array.isArray(img.tabIds) && img.tabIds.length > 0) ? img.tabIds[0] : null;
    }

    const isStillValid = (Array.isArray(img.tabIds) && img.tabIds.length > 0) || (img.tabId !== null && img.tabId !== undefined && img.tabId !== tabId);
    if (!isStillValid) {
      removedSrcs.add(img.src);
      return false;
    }
    return true;
  });

  if (removedSrcs.size === 0) return;

  state.filteredImages = state.filteredImages.filter(img => !removedSrcs.has(img.src));
  removedSrcs.forEach(src => state.selectedImages.delete(src));

  const cardsToExit = [];
  document.querySelectorAll('.image-card').forEach(card => {
    if (removedSrcs.has(card.dataset.src)) {
      card.classList.add('card-exiting');
      cardsToExit.push(card);
    }
  });

  setTimeout(() => {
    cardsToExit.forEach(card => card.remove());
    if (state.filteredImages.length === 0) {
      showEmptyState();
    }
    updateStats();
    updateFilterStats();
    updateSelectAllButton();
    updateDownloadButton();
  }, 250);
}

function toggleRename(e) {
  state.isRenaming = e.target.checked;
  if (elements.renamePrefix) elements.renamePrefix.disabled = !state.isRenaming;
  if (state.isRenaming && elements.renamePrefix) elements.renamePrefix.focus();
  saveSettings(); // 即时保存重命名开关
}

function sanitizeFilenamePart(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

// ========== UI 状态更新 ==========
function updateStats() {
  const total = state.filteredImages.length;
  const selected = state.selectedImages.size;

  if (elements.stats) {
    if (selected > 0) {
      elements.stats.textContent = `已选择 ${selected} / ${total} 张`;
    } else {
      elements.stats.textContent = `共 ${total} 张图片`;
    }
  }
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
  if (elements.stats) elements.stats.textContent = '未找到图片';
}
