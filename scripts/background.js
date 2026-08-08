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
 * 2. 监听来自画廊页面的消息，处理图片下载请求与落盘下载完成后自动关页
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

// ============================================================
// 标签页与下载关联任务追踪器 (chrome.storage.session 持久化)
// ============================================================
// MV3 Service Worker 在空闲约 30 秒后会被 Chrome 终止，仅存在内存中的
// Map 会随之丢失，导致下载落盘完成后 onChanged 触发时找不到关联记录，
// 自动关页功能失效。因此将追踪状态持久化到 chrome.storage.session：
// 它仅随浏览器重启而清空，可跨 Service Worker 重启存活。
const SESSION_STATE_KEY = 'downloadTabTracker';

// 记录处于下载中的 downloadId 及其关联标签页
let pendingDownloadTabs = new Map(); // downloadId -> { tabId: number, autoClose: boolean }
// 记录每个 tabId 尚在排队/下载中的图片总任务数
let tabPendingCounts = new Map();   // tabId -> number

/**
 * Service Worker 启动时从 chrome.storage.session 恢复追踪状态。
 * 注意：扩展 SW 按经典脚本解析，不支持顶层 await（会导致注册失败），
 * 因此这里只发起加载，各事件处理器内部等待该 Promise 完成后再处理。
 */
async function loadTrackerState() {
    try {
        const result = await chrome.storage.session.get(SESSION_STATE_KEY);
        const saved = result[SESSION_STATE_KEY];
        if (saved) {
            pendingDownloadTabs = new Map(
                Object.entries(saved.pendingDownloadTabs || {}).map(([id, info]) => [Number(id), info])
            );
            tabPendingCounts = new Map(
                Object.entries(saved.tabPendingCounts || {}).map(([tabId, count]) => [Number(tabId), count])
            );
        }
    } catch (error) {
        console.log('恢复下载追踪状态失败:', error);
    }
}

/**
 * 扫描并结算所有已终态/已消失的追踪记录（幂等，可反复执行）。
 *
 * 两个用途：
 * 1. SW 启动时自愈：清理旧版本竞态缺陷遗留的、永远无法消费的 pending
 *    记录与归不了零的计数（这类污染会导致自动关页永久失效）；
 * 2. 周期性兑底：MV3 下 onChanged 事件在 SW 被终止期间可能丢失，
 *    由 chrome.alarms 定时唤醒后重扫，确保悬挂任务最终被结算、标签页必被关闭。
 */
async function sweepFinishedDownloads() {
    if (pendingDownloadTabs.size === 0) {
        syncSweepAlarm();
        return;
    }

    for (const [downloadId] of [...pendingDownloadTabs]) {
        try {
            const items = await chrome.downloads.search({ id: downloadId });
            const item = items && items[0];
            if (!item) {
                // 下载项已从历史移除，无法再收到事件，按中断结算
                console.log(`[自动关页] 扫描: 下载 ${downloadId} 已从历史移除，按中断结算`);
                handleDownloadFinished(downloadId, 'interrupted');
            } else if (item.state === 'complete' || item.state === 'interrupted') {
                console.log(`[自动关页] 扫描: 下载 ${downloadId} 已终态 (${item.state})，执行结算`);
                handleDownloadFinished(downloadId, item.state);
            }
        } catch (err) {
            console.log('扫描结算下载追踪记录失败:', err);
        }
    }

    syncSweepAlarm();
}

// ============================================================
// 周期性兑底扫描定时器 (chrome.alarms)
// ============================================================
// chrome.downloads.onChanged 事件在 Service Worker 被终止期间可能无法可靠
// 唤醒 SW（MV3 已知缺陷），一旦 complete 事件丢失，追踪记录将永久悬挂。
// alarms 由浏览器内核调度，不依赖下载事件，能确保 SW 被唤醒重扫。
const SWEEP_ALARM_NAME = 'autoCloseTabSweep';

/**
 * 根据当前是否存在未完成的追踪记录，同步创建/清除兑底扫描定时器
 */
function syncSweepAlarm() {
    try {
        if (pendingDownloadTabs.size > 0) {
            chrome.alarms.create(SWEEP_ALARM_NAME, { periodInMinutes: 0.5 });
        } else {
            chrome.alarms.clear(SWEEP_ALARM_NAME);
        }
    } catch (err) {
        console.log('同步兑底扫描定时器失败:', err);
    }
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== SWEEP_ALARM_NAME) return;
    console.log('[自动关页] 定时器唤醒，执行兑底扫描');
    trackerStateReady.then(sweepFinishedDownloads);
});

const trackerStateReady = loadTrackerState().then(sweepFinishedDownloads);

/**
 * 将追踪状态写回 chrome.storage.session（异步，任何失败都不影响主流程）
 */
function saveTrackerState() {
    try {
        chrome.storage.session.set({
            [SESSION_STATE_KEY]: {
                pendingDownloadTabs: Object.fromEntries(pendingDownloadTabs),
                tabPendingCounts: Object.fromEntries(tabPendingCounts)
            }
        }).catch(err => console.log('保存下载追踪状态失败:', err));
    } catch (err) {
        console.log('保存下载追踪状态失败:', err);
    }
}

function setPendingDownload(downloadId, info) {
    pendingDownloadTabs.set(downloadId, info);
    saveTrackerState();
    syncSweepAlarm();
}

function deletePendingDownload(downloadId) {
    pendingDownloadTabs.delete(downloadId);
    saveTrackerState();
    syncSweepAlarm();
}

function incrementTabCount(tabId) {
    tabPendingCounts.set(tabId, (tabPendingCounts.get(tabId) || 0) + 1);
    saveTrackerState();
}

/**
 * 递减某个标签页的待下载任务数，返回剩余数量
 */
function decrementTabCount(tabId) {
    const remaining = (tabPendingCounts.get(tabId) || 1) - 1;
    if (remaining <= 0) {
        tabPendingCounts.delete(tabId);
    } else {
        tabPendingCounts.set(tabId, remaining);
    }
    saveTrackerState();
    return remaining;
}

/**
 * 下载进入终态 (complete / interrupted) 后的统一处理入口（幂等）。
 *
 * 只有登记过追踪记录的下载才会被处理；处理前立即删除记录，
 * 保证 onChanged 事件与注册后的补偿查询即使同时到达也只生效一次。
 *
 * @param {number} downloadId - 下载 ID
 * @param {string} finalState - 终态：'complete' | 'interrupted'
 */
function handleDownloadFinished(downloadId, finalState) {
    const info = pendingDownloadTabs.get(downloadId);
    if (!info) return; // 未登记或已处理过，直接跳过

    deletePendingDownload(downloadId);

    const { tabId, autoClose } = info;
    if (!autoClose || !tabId) return;
    // 防御：计数记录不存在时不做任何递减/关页，避免误关仍有下载进行的标签页
    if (!tabPendingCounts.has(tabId)) {
        console.log(`[自动关页] 下载 ${downloadId} 终态 (${finalState})，但标签页 ${tabId} 无计数记录，跳过`);
        return;
    }

    const remaining = decrementTabCount(tabId);
    console.log(`[自动关页] 下载 ${downloadId} 终态 (${finalState})，标签页 ${tabId} 剩余任务数: ${remaining}`);
    // 仅当此 tabId 的所有下载任务全部结束且该图下载成功时，才关闭标签页
    if (remaining <= 0 && finalState === 'complete') {
        console.log(`[自动关页] 标签页 ${tabId} 所有下载已落盘完成，执行关闭`);
        chrome.tabs.remove(tabId).then(() => {
            console.log(`[自动关页] 标签页 ${tabId} 已成功关闭`);
        }).catch(err => {
            console.log(`后台自动关闭标签页 (ID: ${tabId}) 失败:`, err);
        });
    }
}

/**
 * 监听 Chrome 下载任务状态改变，当关联标签页的所有图片在磁盘保存完毕后平滑关页
 */
chrome.downloads.onChanged.addListener((delta) => {
    if (!delta.state) return;
    const finalState = delta.state.current;
    if (finalState !== 'complete' && finalState !== 'interrupted') return;

    console.log(`[自动关页] onChanged 事件: 下载 ${delta.id} -> ${finalState}`);
    // 等待追踪状态恢复完成后再处理，避免状态尚未加载时误判
    trackerStateReady.then(() => {
        handleDownloadFinished(delta.id, finalState);
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
        // 等待追踪状态恢复完成后再处理下载请求
        trackerStateReady.then(() => {
            const tabId = request.tabId;
            const autoClose = Boolean(request.autoClose);

            console.log(`[自动关页] 收到下载请求: tabId=${tabId}, autoClose=${autoClose}, url=${request.url}`);

            // 如果开启了自动关页且有合法 tabId，递增计数
            if (autoClose && tabId) {
                incrementTabCount(tabId);
            } else if (!autoClose) {
                console.log('[自动关页] 警告: autoClose 为 false，不会登记关页追踪（请确认前端开关状态与设置同步）');
            } else {
                console.log(`[自动关页] 警告: tabId 无效 (${tabId})，无法登记关页追踪`);
            }

            // 调用下载函数，处理图片下载
            downloadImage(request.url, request.filename, request.folder)
                .then(result => {
                    // 登记失败绝不能阻塞 sendResponse，否则前端会一直等待
                    try {
                        if (autoClose && tabId && result.downloadId) {
                            setPendingDownload(result.downloadId, { tabId, autoClose });
                            console.log(`[自动关页] 已登记下载 ${result.downloadId} -> 标签页 ${tabId}，当前该页计数: ${tabPendingCounts.get(tabId)}`);

                            // 竞态补偿：小图/缓存资源可能在登记之前就已完成落盘，
                            // onChanged 的 complete 事件会因查不到记录而被永久错过，
                            // 导致计数无法归零、标签页永不关闭。因此登记后立即主动
                            // 查询一次当前状态，若已终态则直接处理（幂等，不重复关页）。
                            chrome.downloads.search({ id: result.downloadId })
                                .then(items => {
                                    const item = items && items[0];
                                    if (item && (item.state === 'complete' || item.state === 'interrupted')) {
                                        handleDownloadFinished(result.downloadId, item.state);
                                    }
                                })
                                .catch(err => console.log('补偿查询下载状态失败:', err));
                        }
                    } catch (err) {
                        console.log('登记下载追踪失败:', err);
                    }
                    sendResponse({ success: true, ...result });
                })
                .catch(error => {
                    try {
                        if (autoClose && tabId) {
                            decrementTabCount(tabId);
                        }
                    } catch (err) {
                        console.log('递减下载追踪计数失败:', err);
                    }
                    sendResponse({ success: false, error: error.message });
                });
        });

        // 重要：返回 true 表示我们会异步调用 sendResponse
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
