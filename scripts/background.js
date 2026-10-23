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
 * - 接收触发点击操作时处于激活状态的标签页 tab 对象
 * - 将其 tab.id 作为 sourceTabId 参数透传至画廊，便于画廊精确锁定当前来源网页
 */
chrome.action.onClicked.addListener((tab) => {
    // 构造画廊目标 URL：若存在合法的触发标签页 ID，则拼装 sourceTabId 查询参数
    const targetUrl = tab && typeof tab.id === 'number'
        ? chrome.runtime.getURL(`gallery/gallery.html?sourceTabId=${tab.id}`)
        : chrome.runtime.getURL('gallery/gallery.html');

    // 使用 chrome.tabs.create 创建画廊新标签页
    chrome.tabs.create({
        url: targetUrl
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
// 记录每个 tabId 是否有至少 1 张图片成功落盘（用于确保关页决策确定性）
let tabSuccessFlags = new Map();    // tabId -> boolean

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
            tabSuccessFlags = new Map(
                Object.entries(saved.tabSuccessFlags || {}).map(([tabId, flag]) => [Number(tabId), Boolean(flag)])
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
                tabPendingCounts: Object.fromEntries(tabPendingCounts),
                tabSuccessFlags: Object.fromEntries(tabSuccessFlags)
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
 * 安全关闭指定的浏览器标签页（具备扩展自身画廊防误杀保护）
 * 
 * @param {number} tabId - 目标标签页 ID
 */
async function safelyCloseTab(tabId) {
    try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab) return;
        const tabUrl = tab.url || tab.pendingUrl || '';

        // 核心安全红线：严格禁止关闭扩展自身的画廊页面 (gallery.html) 或内部页面
        if (tabUrl.includes(chrome.runtime.id) || tabUrl.startsWith('chrome-extension://')) {
            console.log(`[自动关页拦截] 标签页 ${tabId} 为扩展画廊或内部页面，已安全拦截跳过关闭`);
            return;
        }

        await chrome.tabs.remove(tabId);
        console.log(`[自动关页] 标签页 ${tabId} 已平滑安全关闭`);
    } catch (err) {
        console.log(`后台自动关闭标签页 (ID: ${tabId}) 异常:`, err);
    }
}

/**
 * 下载进入终态 (complete / interrupted) 后的统一处理入口（权威幂等）。
 *
 * 只有登记过追踪记录的下载才会被处理；处理前立即从 pendingDownloadTabs 中删除记录，
 * 保证全局 onChanged 事件与 executeImageDownload 内部的权威补偿即使同时到达也只生效一次。
 *
 * @param {number} downloadId - 下载 ID
 * @param {string} finalState - 终态：'complete' | 'interrupted'
 */
function handleDownloadFinished(downloadId, finalState) {
    const info = pendingDownloadTabs.get(downloadId);
    if (!info) return; // 未登记或已处理过，直接跳过

    // 关键：原子性立即从 Map 中移除，彻底阻断并发双重扣减
    deletePendingDownload(downloadId);

    const { tabId, autoClose } = info;
    if (!autoClose || !tabId) return;

    // 记录该标签页是否存在至少 1 张成功落盘的图片
    if (finalState === 'complete') {
        tabSuccessFlags.set(tabId, true);
        saveTrackerState();
    }

    // 防御：计数记录不存在时不做任何递减/关页，避免误关仍有下载进行的标签页
    if (!tabPendingCounts.has(tabId)) {
        console.log(`[自动关页] 下载 ${downloadId} 终态 (${finalState})，但标签页 ${tabId} 无计数记录，跳过`);
        return;
    }

    const remaining = decrementTabCount(tabId);
    console.log(`[自动关页] 下载 ${downloadId} 终态 (${finalState})，标签页 ${tabId} 剩余待完成任务数: ${remaining}`);

    // 确定性关页决策：仅当此 tabId 的所有下载任务全部出清 (remaining <= 0) 且该标签页至少有 1 张成功落盘时才关闭
    if (remaining <= 0) {
        const hasSuccess = tabSuccessFlags.get(tabId) || false;
        // 清理该标签页的历史成功标记
        tabSuccessFlags.delete(tabId);
        saveTrackerState();

        if (hasSuccess) {
            console.log(`[自动关页] 标签页 ${tabId} 所有关联下载已全部完成且存在成功落盘，执行安全关闭`);
            safelyCloseTab(tabId);
        } else {
            console.log(`[自动关页] 标签页 ${tabId} 所有关联下载均失败/中断，跳过关闭标签页`);
        }
    }
}

// ============================================================
// 下载预期相对路径表与强制命名拦截器 (Chrome 官方权威命名管道)
// ============================================================
// 记录处于下载中任务预期的完整保存路径 (含子文件夹与自定义重命名)，
// 用于在 chrome.downloads.onDeterminingFilename 中强力拦截并生效，
// 彻底解决服务器响应头覆盖文件名或 Chrome 剥离子目录导致文件夹创建失效的问题。
const plannedDownloadPaths = new Map(); // downloadId -> string

/**
 * 监听 Chrome 确定最终落盘路径与文件名事件
 * 
 * 核心机制说明：
 * 1. 强制覆盖服务器返回的 Content-Disposition 响应头，绝不让服务器原文件名打乱用户的自定义重命名；
 * 2. 强制 Chrome 创建并写入指定的子文件夹 (例如 images/ 或用户自定义目录)，杜绝路径被 Chrome 抹杀后散落至根目录；
 * 3. 兼容 Data URL / Fetch 兜底下载，确保即便使用兜底通道，仍然强制落盘到目标子文件夹。
 */
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    const plannedPath = plannedDownloadPaths.get(item.id);
    if (plannedPath) {
        console.log(`[强制命名拦截] 匹配下载任务 ${item.id} -> 强制应用目标落盘路径: ${plannedPath}`);
        suggest({
            filename: plannedPath,
            conflictAction: 'uniquify'
        });
        return;
    }
});

/**
 * 监听 Chrome 下载任务状态改变，当关联标签页的所有图片在磁盘保存完毕后平滑关页
 */
chrome.downloads.onChanged.addListener((delta) => {
    if (!delta.state) return;
    const finalState = delta.state.current;
    if (finalState !== 'complete' && finalState !== 'interrupted') return;

    console.log(`[自动关页] onChanged 事件: 下载 ${delta.id} -> ${finalState}`);
    // 清理预期路径记录
    plannedDownloadPaths.delete(delta.id);

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
    // 批量下载前预先登记目标标签页的任务总数，防止首张图片极速落盘提前误关标签页
    if (request.action === 'registerBatchDownloads') {
        trackerStateReady.then(() => {
            const tabId = Number(request.tabId);
            const count = Number(request.totalCount) || 0;
            if (tabId && count > 0) {
                const current = tabPendingCounts.get(tabId) || 0;
                tabPendingCounts.set(tabId, current + count);
                saveTrackerState();
                console.log(`[自动关页] 批量预登记任务: tabId=${tabId}, 新增任务数=${count}, 当前待完成总数=${tabPendingCounts.get(tabId)}`);
            }
            sendResponse({ success: true });
        });
        return true;
    }

    // 处理单张图片下载请求 (支持真实落盘终态确认与 Fetch 防盗链兜底)
    if (request.action === 'download') {
        trackerStateReady.then(async () => {
            const result = await executeImageDownload(request);
            sendResponse(result);
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

    // 自动翻页跨域兜底：由后台使用宿主权限抓取后续分页 HTML
    if (request.action === 'fetchPageHtml') {
        if (!sender || sender.id !== chrome.runtime.id) {
            sendResponse({ success: false, error: '未授权的请求来源' });
            return false;
        }

        fetchPageHtmlViaBackground(request.url)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
});

// ============================================================
// 下载核心调度与防盗链兜底机制
// ============================================================

/**
 * 完整下载调度：优先原生下载，若失败/中断则自动启动 Fetch 兜底，并等待终态落盘确认
 * 杜绝仅仅创建任务就虚报下载成功的严重缺陷
 * 
 * @param {object} request - 下载请求参数
 * @returns {Promise<{ success: boolean, downloadId?: number, filename?: string, error?: string }>}
 */
async function executeImageDownload(request) {
    const { url, filename: suggestedFilename, folder = 'images', tabId, autoClose, isPreRegistered } = request;

    // 确定规范化文件名与存储相对路径
    let filename = suggestedFilename ? suggestedFilename : getFilenameFromUrl(url);
    filename = sanitizeFilename(filename);

    if (!hasImageExtension(filename)) {
        const ext = getExtensionFromUrl(url);
        filename += (ext || '.jpg');
    }

    const safeFolder = sanitizeFolderPath(folder);
    const downloadPath = safeFolder ? `${safeFolder}/${filename}` : filename;

    // 若未预先登记且开启自动关页，递增计数
    if (autoClose && tabId && !isPreRegistered) {
        incrementTabCount(tabId);
    }

    let initialDownloadId = null;
    let finalDownloadId = null;

    try {
        // 阶段 1：尝试 Chrome 原生下载通道
        try {
            initialDownloadId = await chrome.downloads.download({
                url: url,
                filename: downloadPath,
                saveAs: false,
                conflictAction: 'uniquify'
            });
            finalDownloadId = initialDownloadId;

            // 登记预期落盘路径，确保 onDeterminingFilename 拦截生效
            plannedDownloadPaths.set(initialDownloadId, downloadPath);

            // 登记关页追踪记录
            if (autoClose && tabId) {
                setPendingDownload(initialDownloadId, { tabId, autoClose });
            }
        } catch (firstErr) {
            console.log(`[原生下载初次创建失败] 准备触发 Fetch 兜底: ${firstErr.message}`);
        }

        // 阶段 2：等待原生下载是否真正成功落盘 (支持排队中 in_progress 持续等待)
        let completion = null;
        if (initialDownloadId) {
            completion = await waitForDownloadCompletion(initialDownloadId, 25000);
        }

        // 阶段 3：若原生下载确已中断 (interrupted / 403 防盗链 / 报错)，启动 Fetch Blob 兜底
        if (!completion || !completion.success) {
            console.log(`[下载自愈] 原生下载确已中断 (${completion?.error || '创建失败'})，启动 Fetch 双轨通道: ${url}`);
            try {
                // 清除失效的旧 downloadId 路径拦截
                if (initialDownloadId) {
                    plannedDownloadPaths.delete(initialDownloadId);
                }

                // 核心计数守恒保障：
                // 若 initialDownloadId 尚未被全局 onChanged 处理，直接清除它避免后续重复扣减；
                // 若已被全局 onChanged 扣减（pending 记录已不存在），则在此补偿 +1，维持兜底任务的计数守恒
                if (autoClose && tabId) {
                    if (initialDownloadId && pendingDownloadTabs.has(initialDownloadId)) {
                        deletePendingDownload(initialDownloadId);
                    } else if (initialDownloadId && !pendingDownloadTabs.has(initialDownloadId)) {
                        incrementTabCount(tabId);
                    }
                }

                const fallbackId = await downloadViaFetchFallback(url, downloadPath);
                finalDownloadId = fallbackId;

                // 为兜底任务同样登记强制落盘路径
                plannedDownloadPaths.set(fallbackId, downloadPath);

                if (autoClose && tabId) {
                    setPendingDownload(fallbackId, { tabId, autoClose });
                }

                completion = await waitForDownloadCompletion(fallbackId, 25000);
            } catch (fallbackErr) {
                console.error(`[下载自愈] Fetch 兜底通道亦失败: ${fallbackErr.message}`);
                completion = { success: false, error: fallbackErr.message };
            }
        }

        // 阶段 4：根据真实落盘结果回执前端与权威终态结算
        if (completion && completion.success) {
            // 权威终态补偿：若因小图/缓存极速落盘导致全局 onChanged 错过了 pending 记录，此处权威执行终态结算
            if (finalDownloadId && pendingDownloadTabs.has(finalDownloadId)) {
                console.log(`[权威补偿结算] 检测到下载 ${finalDownloadId} 极速落盘未被捕获，执行结算`);
                handleDownloadFinished(finalDownloadId, 'complete');
            }

            return {
                success: true,
                downloadId: finalDownloadId,
                filename: filename
            };
        } else {
            // 下载最终彻底失败（原生与兜底均未成功），执行失败结算与清理
            if (finalDownloadId) plannedDownloadPaths.delete(finalDownloadId);
            if (finalDownloadId && pendingDownloadTabs.has(finalDownloadId)) {
                handleDownloadFinished(finalDownloadId, 'interrupted');
            } else if (autoClose && tabId && !isPreRegistered && tabPendingCounts.has(tabId)) {
                decrementTabCount(tabId);
            }

            return {
                success: false,
                downloadId: finalDownloadId,
                error: completion?.error || '下载被目标服务器中断或拦截 (403 防盗链/网络错误)'
            };
        }
    } catch (unexpectedErr) {
        if (finalDownloadId) plannedDownloadPaths.delete(finalDownloadId);
        if (finalDownloadId && pendingDownloadTabs.has(finalDownloadId)) {
            handleDownloadFinished(finalDownloadId, 'interrupted');
        } else if (autoClose && tabId && !isPreRegistered && tabPendingCounts.has(tabId)) {
            decrementTabCount(tabId);
        }

        return {
            success: false,
            error: unexpectedErr.message
        };
    }
}

/**
 * 通过 Fetch 获取图片二进制流并转为 Base64 Data URL 下载 (防盗链与 403 强力兜底机制)
 * @param {string} url - 图片原始 URL
 * @param {string} downloadPath - 保存相对路径
 * @returns {Promise<number>} Chrome 下载任务 ID
 */
async function downloadViaFetchFallback(url, downloadPath) {
    console.log(`[防盗链兜底] 触发 Fetch 请求: ${url}`);
    const response = await fetch(url, {
        mode: 'cors',
        credentials: 'include'
    });

    if (!response.ok) {
        throw new Error(`HTTP 状态异常: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    const dataUrl = await blobToDataUrl(blob);

    const downloadId = await chrome.downloads.download({
        url: dataUrl,
        filename: downloadPath,
        saveAs: false,
        conflictAction: 'uniquify'
    });

    return downloadId;
}

/**
 * 将 Blob 转换为 Base64 Data URL (兼容无 DOM/FileReader 限制的 Service Worker 环境)
 * @param {Blob} blob - 图片 Blob 对象
 * @returns {Promise<string>} Base64 Data URL
 */
async function blobToDataUrl(blob) {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const len = bytes.byteLength;
    const chunkSize = 8192;
    for (let i = 0; i < len; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
    }
    const base64 = btoa(binary);
    const mimeType = blob.type || 'image/jpeg';
    return `data:${mimeType};base64,${base64}`;
}

/**
 * 等待指定的 Chrome 下载任务真正达到落盘终态 (complete / interrupted)
 * 绝不单凭分配了 downloadId 就虚报成功
 * 
 * @param {number} downloadId - 下载 ID
 * @param {number} timeoutMs - 超时时间
 * @returns {Promise<{ success: boolean, state: string, error?: string, filename?: string }>}
 */
function waitForDownloadCompletion(downloadId, timeoutMs = 15000) {
    return new Promise((resolve) => {
        let isResolved = false;
        let timer = null;

        const cleanup = () => {
            if (timer) clearTimeout(timer);
            chrome.downloads.onChanged.removeListener(onChangedHandler);
        };

        const doResolve = (result) => {
            if (isResolved) return;
            isResolved = true;
            cleanup();
            resolve(result);
        };

        const checkCurrentState = async () => {
            try {
                const items = await chrome.downloads.search({ id: downloadId });
                const item = items && items[0];
                if (item) {
                    if (item.state === 'complete') {
                        doResolve({ success: true, state: 'complete', filename: item.filename });
                        return true;
                    } else if (item.state === 'interrupted') {
                        doResolve({ success: false, state: 'interrupted', error: item.error || '下载被中断' });
                        return true;
                    }
                }
            } catch (err) {
                // 忽略主动查询异常
            }
            return false;
        };

        const onChangedHandler = (delta) => {
            if (delta.id !== downloadId || !delta.state) return;
            const state = delta.state.current;
            if (state === 'complete') {
                doResolve({ success: true, state: 'complete' });
            } else if (state === 'interrupted') {
                const error = delta.error ? delta.error.current : '下载被中断';
                doResolve({ success: false, state: 'interrupted', error });
            }
        };

        chrome.downloads.onChanged.addListener(onChangedHandler);

        // 立即主动查询一次
        checkCurrentState().then(finished => {
            if (!finished) {
                timer = setTimeout(async () => {
                    const finishedNow = await checkCurrentState();
                    if (!finishedNow) {
                        doResolve({ success: false, state: 'timeout', error: '下载超时未完成' });
                    }
                }, timeoutMs);
            }
        });
    });
}

/**
 * 抓取分页 HTML（自动翻页跨域兜底通道）
 *
 * 同源分页由来源标签页自行 fetch，以复用页面登录态与同站 Cookie；
 * 仅当下一分页跨域或页面上下文请求被拦截时，才由后台使用宿主权限代为抓取。
 *
 * @param {string} url - 目标分页地址
 * @returns {Promise<{ success: boolean, html?: string, finalUrl?: string, status?: number, error?: string }>}
 */
async function fetchPageHtmlViaBackground(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return { success: false, error: '无效的翻页地址' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { success: false, error: '仅支持 HTTP/HTTPS 翻页地址' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch(parsed.href, {
            credentials: 'include',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'Accept': 'text/html,application/xhtml+xml'
            }
        });

        if (!response.ok) {
            return { success: false, status: response.status, error: `HTTP ${response.status}` };
        }

        const contentType = response.headers.get('content-type') || '';
        if (contentType && !/html|xml/i.test(contentType)) {
            return { success: false, status: response.status, error: '目标地址不是 HTML 页面' };
        }

        const html = await response.text();
        if (html.length > 4_000_000) {
            return { success: false, status: response.status, error: '页面内容过大，已跳过' };
        }

        return {
            success: true,
            html,
            finalUrl: response.url || parsed.href,
            status: response.status
        };
    } catch (error) {
        const message = error?.name === 'AbortError' ? '页面请求超时' : error.message;
        return { success: false, error: message };
    } finally {
        clearTimeout(timer);
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
    // 支持的图片格式列表（包含 webpg / avif 等扩展名）
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.webpg', '.svg', '.bmp', '.ico', '.avif'];
    const lowerFilename = filename.toLowerCase();

    // 检查文件名是否以任一图片扩展名结尾
    return imageExtensions.some(ext => lowerFilename.endsWith(ext));
}

/**
 * 从 URL 路径及查询参数中提取标准扩展名
 * 
 * 例如: https://example.com/image.png -> .png
 * 例如: https://example.com/pic?wx_fmt=webp -> .webp
 * 例如: https://example.com/pic.webpg -> .webp
 * 
 * @param {string} url - 图片 URL
 * @returns {string} 扩展名（包含点号）或空字符串
 */
function getExtensionFromUrl(url) {
    try {
        const lowerUrl = url.toLowerCase();

        // 1. 探测动态 CDN 参数 (如 wx_fmt=webp, format=webp 等)
        const cdnFormatMatch = lowerUrl.match(/(?:[?&](?:wx_fmt|format|fmt|f)=|format[,\/])([a-zA-Z0-9]+)/);
        if (cdnFormatMatch && cdnFormatMatch[1]) {
            const fmt = cdnFormatMatch[1].toLowerCase();
            if (['png', 'jpg', 'jpeg', 'webp', 'webpg', 'gif', 'svg', 'bmp', 'avif', 'ico'].includes(fmt)) {
                if (fmt === 'jpeg') return '.jpg';
                if (fmt === 'webpg') return '.webp';
                return '.' + fmt;
            }
        }

        // 2. 探测标准 pathname 后缀
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        const parts = pathname.split('.');

        if (parts.length > 1) {
            const ext = parts.pop().toLowerCase();
            if (['png', 'jpg', 'jpeg', 'webp', 'webpg', 'gif', 'svg', 'bmp', 'avif', 'ico'].includes(ext)) {
                if (ext === 'jpeg') return '.jpg';
                if (ext === 'webpg') return '.webp';
                return '.' + ext;
            }
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
