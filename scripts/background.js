/**
 * ============================================================
 * Image Extractor - Background Service Worker
 * ============================================================
 * 
 * 文件说明：
 * 这是扩展的后台脚本，使用 Manifest V3 的 Service Worker 模式运行。
 * Service Worker 在需要时启动，空闲时自动休眠，以节省系统资源。
 * 
 * 主要职责：
 * 1. 监听扩展图标点击事件，打开画廊页面
 * 2. 监听来自画廊页面的消息，处理图片下载请求
 * 
 * Service Worker 生命周期说明：
 * - 不会一直运行，Chrome 会在空闲时终止它
 * - 当有事件触发时（如点击图标、收到消息），会重新启动
 * - 所以不能依赖全局变量保存状态，需要使用 chrome.storage
 * 
 * ============================================================
 */

// ============================================================
// 事件监听器
// ============================================================

/**
 * 监听扩展图标点击事件
 * 
 * chrome.action.onClicked:
 * - 当用户点击工具栏中的扩展图标时触发
 * - 只有当没有设置 popup 页面时才会触发
 * - 如果设置了 default_popup，点击会打开 popup 而不触发此事件
 */
chrome.action.onClicked.addListener(() => {
    // 使用 chrome.tabs.create 创建新标签页
    chrome.tabs.create({
        // chrome.runtime.getURL 将相对路径转换为完整的扩展 URL
        // 例如: chrome-extension://abc123/gallery/gallery.html
        url: chrome.runtime.getURL('gallery/gallery.html')
    });
});

/**
 * 监听来自扩展其他部分的消息
 * 
 * chrome.runtime.onMessage:
 * - 用于扩展内部不同脚本之间的通信
 * - 可以接收来自 content script、popup、其他页面的消息
 * 
 * 参数说明：
 * @param {object} request - 发送的消息对象
 * @param {object} sender - 发送者信息（包含 tab、url 等）
 * @param {function} sendResponse - 用于发送响应的回调函数
 * @returns {boolean} - 返回 true 表示会异步发送响应
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 根据 action 字段判断消息类型
    if (request.action === 'download') {
        // 调用下载函数，处理图片下载
        downloadImage(request.url, request.filename, request.folder)
            .then(result => sendResponse({ success: true, ...result }))
            .catch(error => sendResponse({ success: false, error: error.message }));

        // 重要：返回 true 表示我们会异步调用 sendResponse
        // 如果不返回 true，sendResponse 会立即失效
        return true;
    }

    if (request.action === 'getDownloadStatus') {
        getDownloadStatus(request.downloadId)
            .then(result => sendResponse({ success: true, ...result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
});

// ============================================================
// 下载功能
// ============================================================

/**
 * 下载图片到本地
 * 
 * 使用 chrome.downloads API 将图片下载到用户的下载目录
 * Chrome 会自动创建不存在的子文件夹
 * 
 * @param {string} url - 图片的完整 URL
 * @param {string} suggestedFilename - 建议使用的文件名（可选）
 *                                     如果用户开启了批量重命名，这里会传入自定义文件名
 * @param {string} folder - 下载到的子文件夹名称
 *                          默认为 'images'，用户可以自定义
 * @throws {Error} 下载失败时抛出错误
 */
async function downloadImage(url, suggestedFilename, folder = 'images') {
    try {
        let filename;

        // 确定文件名：优先使用传入的名称，否则从 URL 提取
        if (suggestedFilename) {
            filename = suggestedFilename;
        } else {
            filename = getFilenameFromUrl(url);
        }

        filename = sanitizeFilename(filename);

        // 确保文件名有正确的图片扩展名
        if (!hasImageExtension(filename)) {
            // 尝试从 URL 获取扩展名
            const ext = getExtensionFromUrl(url);
            if (ext) {
                filename += ext;
            } else {
                // 如果无法确定扩展名，默认使用 .jpg
                filename += '.jpg';
            }
        }

        const safeFolder = sanitizeFolderPath(folder);
        const downloadPath = safeFolder ? `${safeFolder}/${filename}` : filename;

        // 执行下载
        // chrome.downloads.download 返回一个 Promise（在 Manifest V3 中）
        const downloadId = await chrome.downloads.download({
            url: url,                              // 要下载的 URL
            filename: downloadPath,               // 保存路径（相对于下载目录）
            saveAs: false,                        // false = 使用默认位置，不弹出另存为对话框
            conflictAction: 'uniquify'            // 重名时自动追加序号，避免下载失败
        });

        return {
            downloadId,
            requestedFilename: filename,
            requestedPath: downloadPath
        };
    } catch (error) {
        console.error('下载失败:', url, error);
        throw error; // 将错误传递给调用者
    }
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 从 URL 中提取文件名
 * 
 * 例如: https://example.com/path/to/image.jpg?size=large
 *       -> 提取出 "image.jpg"
 * 
 * @param {string} url - 图片 URL
 * @returns {string} 提取的文件名
 */
function getFilenameFromUrl(url) {
    try {
        // 使用 URL 对象解析 URL
        const urlObj = new URL(url);
        let pathname = urlObj.pathname;

        // 获取路径的最后一部分作为文件名
        // 例如: /path/to/image.jpg -> image.jpg
        let filename = pathname.split('/').pop() || '';

        // 移除 URL 中的查询参数
        // 例如: image.jpg?size=large -> image.jpg
        filename = filename.split('?')[0];

        // 如果无法提取有效文件名，或文件名过长，生成一个随机名称
        if (!filename || filename.length > 100) {
            // 使用时间戳 + 随机字符串确保唯一性
            filename = 'image_' + Date.now() + '_' + Math.random().toString(36).substring(7);
        }

        // 替换非法字符为下划线
        filename = sanitizeFilename(filename);

        return filename;
    } catch {
        // 如果 URL 解析失败，返回默认文件名
        return 'image_' + Date.now();
    }
}

/**
 * 检查文件名是否有图片扩展名
 * 
 * @param {string} filename - 要检查的文件名
 * @returns {boolean} 如果有图片扩展名返回 true
 */
function hasImageExtension(filename) {
    // 支持的图片格式列表
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico'];
    const lowerFilename = filename.toLowerCase();

    // 检查文件名是否以任一图片扩展名结尾
    return imageExtensions.some(ext => lowerFilename.endsWith(ext));
}

/**
 * 从 URL 路径中提取扩展名
 * 
 * 例如: https://example.com/image.png -> .png
 * 
 * @param {string} url - 图片 URL
 * @returns {string} 扩展名（包含点号）或空字符串
 */
function getExtensionFromUrl(url) {
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        const parts = pathname.split('.');

        // 如果路径中有点号，最后一部分就是扩展名
        if (parts.length > 1) {
            return '.' + parts.pop().toLowerCase();
        }
    } catch (e) {
        // URL 解析失败，忽略
    }
    return '';
}

/**
 * 规范化文件名，避免非法字符或路径穿越。
 *
 * @param {string} filename - 原始文件名
 * @returns {string} 安全文件名
 */
function sanitizeFilename(filename) {
    const normalized = String(filename || '')
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
        .replace(/\.+$/g, '')
        .trim();

    return normalized || `image_${Date.now()}`;
}

/**
 * 规范化下载目录，允许使用 / 创建多级目录。
 *
 * @param {string} folder - 用户输入的目录
 * @returns {string} 安全的相对目录路径
 */
function sanitizeFolderPath(folder) {
    const raw = String(folder || '').replace(/\\/g, '/').trim();
    if (!raw) {
        return 'images';
    }

    const safeSegments = raw
        .split('/')
        .map(segment => segment.replace(/[<>:"|?*\x00-\x1f]/g, '_').trim())
        .filter(segment => segment && segment !== '.' && segment !== '..');

    return safeSegments.join('/') || 'images';
}

/**
 * 查询下载项的当前状态和最终路径。
 *
 * @param {number} downloadId - 下载 ID
 * @returns {Promise<object>} 下载状态
 */
async function getDownloadStatus(downloadId) {
    if (!Number.isInteger(downloadId)) {
        throw new Error('无效的下载 ID');
    }

    const items = await chrome.downloads.search({ id: downloadId });
    const item = items[0];

    if (!item) {
        throw new Error(`未找到下载项: ${downloadId}`);
    }

    return {
        downloadId,
        state: item.state,
        filename: item.filename || '',
        finalUrl: item.finalUrl || item.url || '',
        danger: item.danger || 'safe',
        error: item.error || '',
        exists: item.exists ?? null,
        byExtensionName: item.byExtensionName || '',
        byExtensionId: item.byExtensionId || ''
    };
}
