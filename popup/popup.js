/**
 * Image Extractor - Popup Script
 * 负责协调图片提取、展示和下载
 */

// ========== 全局状态 ==========
const state = {
  images: [],              // 所有提取的图片（原始数据）
  filteredImages: [],      // 过滤后的图片
  selectedImages: new Set(), // 已选中的图片索引（基于 filteredImages）
  isAllSelected: false,    // 是否全选
  minResolution: 500,      // 默认最小分辨率 500px
  isRenaming: false,       // 是否开启重命名
  renamePrefix: ''         // 重命名缀
};

// ========== DOM 元素 ==========
const elements = {
  loader: document.getElementById('loader'),
  emptyState: document.getElementById('emptyState'),
  masonry: document.getElementById('masonry'),
  stats: document.getElementById('stats'),
  filterStats: document.getElementById('filterStats'),
  refreshBtn: document.getElementById('refreshBtn'),
  selectAllBtn: document.getElementById('selectAllBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  // Rename controls
  renameToggle: document.getElementById('renameToggle'),
  renamePrefix: document.getElementById('renamePrefix')
};

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', init);

async function init() {
  // 绑定事件
  elements.refreshBtn.addEventListener('click', extractImages);
  elements.selectAllBtn.addEventListener('click', toggleSelectAll);
  elements.downloadBtn.addEventListener('click', downloadSelected);

  // 绑定筛选按钮事件
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const minRes = parseInt(btn.dataset.min, 10);
      setMinResolution(minRes, btn);
    });
  });

  // Rename control events
  elements.renameToggle.addEventListener('change', toggleRename);
  elements.renamePrefix.addEventListener('input', (e) => {
    const sanitized = sanitizeFilenamePart(e.target.value);
    e.target.value = sanitized;
    state.renamePrefix = sanitized;
  });

  // 开始提取图片
  await extractImages();
}

// ========== 分辨率筛选 ==========
function setMinResolution(minRes, activeBtn) {
  state.minResolution = minRes;

  // 更新按钮状态
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  activeBtn.classList.add('active');

  // 重新过滤并渲染
  applyFilter();
}

function applyFilter() {
  // 清空选择
  state.selectedImages.clear();

  // 根据分辨率过滤
  state.filteredImages = state.images.filter(img => {
    const maxDim = Math.max(img.width || 0, img.height || 0);
    return maxDim >= state.minResolution;
  });

  // 更新筛选统计
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

  if (hidden > 0) {
    elements.filterStats.textContent = `已过滤 ${hidden} 张`;
  } else {
    elements.filterStats.textContent = '';
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
    // 获取所有标签页
    const tabs = await chrome.tabs.query({});

    // 过滤掉 Chrome 内部页面
    const validTabs = tabs.filter(tab =>
      tab.url &&
      !tab.url.startsWith('chrome://') &&
      !tab.url.startsWith('chrome-extension://') &&
      !tab.url.startsWith('edge://') &&
      !tab.url.startsWith('about:')
    );

    if (validTabs.length === 0) {
      showEmptyState();
      return;
    }

    // 向每个标签页注入内容脚本并提取图片
    const imagePromises = validTabs.map(async (tab) => {
      try {
        // 注入并执行内容脚本
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

    // 等待所有提取完成
    const allImages = await Promise.all(imagePromises);

    // 扁平化并去重
    const flatImages = allImages.flat();
    const seenUrls = new Set();
    state.images = flatImages.filter(img => {
      if (seenUrls.has(img.src)) return false;
      seenUrls.add(img.src);
      return true;
    });

    if (state.images.length === 0) {
      showEmptyState();
    } else {
      // 应用筛选（默认 500px）
      applyFilter();
    }
  } catch (error) {
    console.error('提取图片时出错:', error);
    showEmptyState();
  }
}

/**
 * 在页面中执行的图片提取函数
 * 会被注入到每个标签页中执行
 */
function extractImagesFromPage() {
  const images = [];
  const seenSrcs = new Set();

  // 提取所有 <img> 标签
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

  // 提取背景图片
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

  // 提取 <picture> 和 <source>
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
    // 过滤太小的图片（可能是图标）- 提取时只过滤非常小的
    const width = img.naturalWidth || img.width || 0;
    const height = img.naturalHeight || img.height || 0;
    if (width > 0 && width < 30 && height > 0 && height < 30) return false;

    // 过滤 data URL（base64 图标等）
    if (src.startsWith('data:') && src.length < 1000) return false;

    // 过滤常见的追踪像素和占位图
    if (src.includes('pixel') || src.includes('tracking') || src.includes('spacer')) return false;

    return true;
  }

  return images;
}

// ========== 渲染图片 ==========
function renderImages() {
  hideLoader();
  elements.emptyState.classList.add('hidden');
  elements.masonry.classList.remove('hidden');
  elements.masonry.innerHTML = '';

  updateStats();

  state.filteredImages.forEach((image, index) => {
    const card = createImageCard(image, index);
    elements.masonry.appendChild(card);
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

  // 分辨率标签
  const resolutionTag = document.createElement('div');
  resolutionTag.className = 'resolution-tag';

  // 图片加载成功时更新分辨率
  img.onload = () => {
    if (!image.width || !image.height) {
      image.width = img.naturalWidth;
      image.height = img.naturalHeight;
    }
    resolutionTag.textContent = `${image.width} × ${image.height}`;
    updateResolutionTagClass(resolutionTag, image.width, image.height);
  };

  // 图片加载失败时隐藏卡片
  img.onerror = () => {
    card.style.display = 'none';
  };

  // 如果已有分辨率信息，直接显示
  if (image.width && image.height) {
    resolutionTag.textContent = `${image.width} × ${image.height}`;
    updateResolutionTagClass(resolutionTag, image.width, image.height);
  } else {
    resolutionTag.textContent = '...';
  }

  const checkIndicator = document.createElement('div');
  checkIndicator.className = 'check-indicator';

  const sourceTag = document.createElement('div');
  sourceTag.className = 'source-tag';
  sourceTag.textContent = image.tabTitle || 'Unknown';

  card.appendChild(img);
  card.appendChild(checkIndicator);
  card.appendChild(resolutionTag);
  card.appendChild(sourceTag);

  // 点击选择/取消选择
  card.addEventListener('click', () => toggleImageSelection(card, index));

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

// ========== 选择逻辑 ==========
function toggleImageSelection(card, index) {
  if (state.selectedImages.has(index)) {
    state.selectedImages.delete(index);
    card.classList.remove('selected');
  } else {
    state.selectedImages.add(index);
    card.classList.add('selected');
  }

  updateSelectAllButton();
  updateDownloadButton();
  updateStats();
}

function toggleSelectAll() {
  const cards = document.querySelectorAll('.image-card');

  if (state.isAllSelected) {
    // 取消全选
    state.selectedImages.clear();
    cards.forEach(card => card.classList.remove('selected'));
  } else {
    // 全选
    cards.forEach((card, index) => {
      if (card.style.display !== 'none') {
        state.selectedImages.add(index);
        card.classList.add('selected');
      }
    });
  }

  state.isAllSelected = !state.isAllSelected;
  updateSelectAllButton();
  updateDownloadButton();
  updateStats();
}

function updateSelectAllButton() {
  const btn = elements.selectAllBtn;
  const visibleCards = document.querySelectorAll('.image-card:not([style*="display: none"])');
  state.isAllSelected = visibleCards.length > 0 && state.selectedImages.size === visibleCards.length;

  if (state.isAllSelected) {
    btn.classList.add('active');
    btn.innerHTML = '<span class="checkbox-icon">☑</span> 取消全选';
  } else {
    btn.classList.remove('active');
    btn.innerHTML = '<span class="checkbox-icon">☐</span> 全选';
  }
}

function updateDownloadButton() {
  const btn = elements.downloadBtn;
  const count = state.selectedImages.size;

  btn.disabled = count === 0;
  btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
    </svg>
    下载选中${count > 0 ? ` (${count})` : ''}
  `;
}

// ========== 下载功能 ==========
async function downloadSelected() {
  if (state.selectedImages.size === 0) return;

  // 使用 filteredImages 的索引获取图片 URL
  const selectedIndices = Array.from(state.selectedImages);
  const total = selectedIndices.length;
  // Calculate padding
  const padding = total.toString().length;

  // 发送下载请求到 background script
  for (let i = 0; i < total; i++) {
    const index = selectedIndices[i];
    const url = state.filteredImages[index].src;
    let filename = null;

    if (state.isRenaming && state.renamePrefix) {
      // Get original extension
      let ext = '.jpg'; // default
      try {
        const urlObj = new URL(url);
        const parts = urlObj.pathname.split('.');
        if (parts.length > 1) {
          const potentialExt = '.' + parts.pop().toLowerCase();
          if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico'].includes(potentialExt)) {
            ext = potentialExt;
          }
        }
      } catch (e) {
        // ignore
      }

      // Format number with leading zeros
      const num = (i + 1).toString().padStart(padding, '0');
      filename = `${state.renamePrefix}_${num}${ext}`;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'download',
        url: url,
        filename: filename
      });

      if (!response?.success) {
        throw new Error(response?.error || '下载请求未成功执行');
      }
    } catch (error) {
      console.error('下载失败:', url, error);
    }
  }

  // 清空选择
  state.selectedImages.clear();
  document.querySelectorAll('.image-card.selected').forEach(card => {
    card.classList.remove('selected');
  });
  updateSelectAllButton();
  updateDownloadButton();
  updateStats();
}

function toggleRename(e) {
  state.isRenaming = e.target.checked;
  elements.renamePrefix.disabled = !state.isRenaming;

  if (state.isRenaming) {
    elements.renamePrefix.focus();
  }
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

  if (selected > 0) {
    elements.stats.textContent = `已选择 ${selected} / ${total} 张图片`;
  } else {
    elements.stats.textContent = `共 ${total} 张图片`;
  }
}

function showLoader() {
  elements.loader.classList.remove('hidden');
  elements.emptyState.classList.add('hidden');
  elements.masonry.classList.add('hidden');
}

function hideLoader() {
  elements.loader.classList.add('hidden');
}

function showEmptyState() {
  elements.loader.classList.add('hidden');
  elements.emptyState.classList.remove('hidden');
  elements.masonry.classList.add('hidden');
  elements.stats.textContent = '未找到图片';
}
