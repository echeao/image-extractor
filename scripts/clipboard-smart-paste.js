/**
 * ============================================================
 * Image Extractor - 剪切板智能拆分与自动粘贴模块 (Clipboard Smart Paste)
 * ============================================================
 * 
 * 模块职责：
 * 自动读取系统剪切板中的文本，识别短横线（如 "-"、"–"、"—"）及其分隔符，
 * 将文本拆分为文件夹名称与文件名前缀，并提供优雅的悬浮卡片 (Popover) 供用户一键或选词填入。
 * 
 * 核心特性：
 * 1. 自动触发：当用户聚焦 (focus) 存储文件夹或重名输入框时智能检测剪切板。
 * 2. 智能解析：如 "Molly Cute - Stiletto Sonata" 拆分为 [📁 文件夹: Molly Cute] 与 [📄 文件名: Stiletto Sonata]。
 * 3. 一键联动：点击“一键应用”自动填充存储文件夹、重命名前缀，并自动开启批量重命名开关。
 * 4. 词块拆分 (Tag Chip)：包含多个分隔符时支持用户单独点击任意词块填入输入框。
 * 5. 防打扰机制：对于已被拒绝或已应用的文本，在未变更剪切板前不重复自动弹出。
 * ============================================================
 */

class ClipboardSmartPaste {
  /**
   * 构造函数：初始化组件实例与全局配置
   * @param {Object} options - 初始化配置对象
   * @param {HTMLElement} options.folderInput - 存储文件夹输入框 DOM 元素
   * @param {HTMLElement} options.prefixInput - 文件名前缀输入框 DOM 元素
   * @param {HTMLElement} [options.renameToggle] - 批量重命名 Switch 开关 DOM 元素
   * @param {Function} options.onApply - 数据变更后的回调保存函数 (folder, prefix, isRenaming) => void
   */
  constructor(options = {}) {
    this.folderInput = options.folderInput;
    this.prefixInput = options.prefixInput;
    this.renameToggle = options.renameToggle;
    this.onApply = options.onApply || (() => {});

    // 当前操作与状态记录
    this.popoverEl = null;          // 悬浮 Popover DOM 容器
    this.lastIgnoredText = '';       // 上一次用户主动关闭的文本 (避免重复骚扰)
    this.activeInput = null;        // 当前聚焦激活的输入框 DOM

    // 绑定内部方法的 this 上下文
    this.handleFocus = this.handleFocus.bind(this);
    this.handleOutsideClick = this.handleOutsideClick.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);

    // 执行初始化绑定
    this.init();
  }

  /**
   * 初始化事件监听与 DOM 结构准备
   */
  init() {
    if (this.folderInput) {
      this.folderInput.addEventListener('focus', (e) => this.handleFocus(e.target));
      this.folderInput.addEventListener('click', (e) => this.handleFocus(e.target));
    }
    if (this.prefixInput) {
      this.prefixInput.addEventListener('focus', (e) => this.handleFocus(e.target));
      this.prefixInput.addEventListener('click', (e) => this.handleFocus(e.target));
    }

    // 监听全局点击事件以关闭 Popover
    document.addEventListener('mousedown', this.handleOutsideClick);
    document.addEventListener('keydown', this.handleKeyDown);
  }

  /**
   * 输入框获得焦点时的处理函数
   * @param {HTMLElement} inputEl - 获得焦点的 DOM 元素
   */
  async handleFocus(inputEl) {
    this.activeInput = inputEl;

    try {
      // 尝试读取剪切板纯文本
      const text = await navigator.clipboard.readText();
      const cleaned = String(text || '').trim();

      // 无文本或文本未发生变化且已被忽略时，不弹出
      if (!cleaned || cleaned === this.lastIgnoredText) {
        return;
      }

      // 执行解析与卡片展示
      const parseResult = this.parseClipboardText(cleaned);
      this.renderPopover(inputEl, parseResult);
    } catch (err) {
      // 剪切板未授权或无法读取时静默处理
      console.log('ClipboardSmartPaste: 无法读取剪切板内容', err);
    }
  }

  /**
   * 字符串拆解逻辑：根据短横线/破折号切割文本
   * @param {string} text - 剪切板原始文本
   * @returns {Object} 结构化解析对象
   */
  parseClipboardText(text) {
    // 使用正则支持半角短横线 `-`、EN dash `–`、EM dash `—` 及其左右空格
    const parts = text
      .split(/\s*[-–——]\s*/)
      .map(part => part.trim())
      .filter(Boolean);

    const isPair = parts.length === 2;
    const isMulti = parts.length > 2;

    return {
      rawText: text,
      parts: parts,
      isPair: isPair,
      isMulti: isMulti,
      // 候选文件夹名 (取第1部分)
      folderCandidate: parts.length > 0 ? parts[0] : '',
      // 候选文件名前缀 (取第2部分，若无则取剩余部分拼接)
      prefixCandidate: parts.length > 1 ? parts.slice(1).join('_') : ''
    };
  }

  /**
   * 动态创建或获取 Popover 卡片容器
   * @returns {HTMLElement} Popover DOM 元素
   */
  getOrCreatePopover() {
    if (this.popoverEl) return this.popoverEl;

    const el = document.createElement('div');
    el.id = 'smartPastePopover';
    el.className = 'smart-paste-popover hidden';
    document.body.appendChild(el);
    this.popoverEl = el;
    return el;
  }

  /**
   * 渲染并显示悬浮 Popover 卡片
   * @param {HTMLElement} targetEl - 锚点 DOM 元素
   * @param {Object} parseResult - 剪切板解析数据
   */
  renderPopover(targetEl, parseResult) {
    const popover = this.getOrCreatePopover();
    const { rawText, parts, isPair, isMulti, folderCandidate, prefixCandidate } = parseResult;

    // 清理多余内容与拼接 HTML
    let bodyHtml = `
      <div class="popover-header">
        <div class="popover-title-group">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
          </svg>
          <span>使用剪切板内容命名？</span>
        </div>
        <button class="popover-close-btn" id="smartCloseBtn" title="忽略/关闭">&times;</button>
      </div>
      <div class="clipboard-preview" title="${this.escapeHtml(rawText)}">
        ${this.escapeHtml(rawText)}
      </div>
    `;

    // 若切割出了 2 个及以上的片段（如 "Molly Cute - Stiletto Sonata"）
    if (parts.length >= 2) {
      bodyHtml += `
        <div class="smart-parse-preview">
          <div class="parse-pair-row">
            <span class="parse-tag-label">📁 存储文件夹:</span>
            <span class="parse-tag-value" title="${this.escapeHtml(folderCandidate)}">${this.escapeHtml(folderCandidate)}</span>
          </div>
          <div class="parse-pair-row">
            <span class="parse-tag-label">📄 重命名前缀:</span>
            <span class="parse-tag-value" title="${this.escapeHtml(prefixCandidate)}">${this.escapeHtml(prefixCandidate)}</span>
          </div>
        </div>
      `;

      // 若包含 3 个及以上词块，增加 Tag 拆字选择面板
      if (isMulti) {
        bodyHtml += `
          <div style="font-size:11px; color:#94a3b8; margin:4px 0 6px;">点击词块直接填入当前框:</div>
          <div class="smart-tags-wrapper">
            ${parts.map((p, idx) => `<span class="smart-chip-tag" data-tag="${this.escapeHtml(p)}">${idx + 1}. ${this.escapeHtml(p)}</span>`).join('')}
          </div>
        `;
      }

      bodyHtml += `
        <div class="popover-actions">
          <button class="btn-popover-action btn-popover-primary" id="smartApplyAllBtn">⚡ 一键应用两者</button>
          <button class="btn-popover-action btn-popover-sub" id="smartApplyFolderBtn">📁 仅填文件夹</button>
          <button class="btn-popover-action btn-popover-sub" id="smartApplyPrefixBtn">📄 仅填文件名</button>
        </div>
      `;
    } else {
      // 未检测到短横线分割的单条文本
      bodyHtml += `
        <div style="font-size:11px; color:#94a3b8; margin-bottom:8px;">检测到未带短横线分隔符，可选择粘贴：</div>
        <div class="popover-actions">
          <button class="btn-popover-action btn-popover-primary" id="smartApplyCurrentBtn">📋 粘贴到当前框</button>
          <button class="btn-popover-action btn-popover-sub" id="smartApplyFolderBtn">📁 填为文件夹</button>
          <button class="btn-popover-action btn-popover-sub" id="smartApplyPrefixBtn">📄 填为文件名</button>
        </div>
      `;
    }

    popover.innerHTML = bodyHtml;
    popover.classList.remove('hidden');

    // 重新计算并绑定坐标与按钮事件
    this.positionPopover(targetEl, popover);
    this.bindPopoverEvents(parseResult);
  }

  /**
   * 将 Popover 定位在目标输入框的正下方
   * @param {HTMLElement} targetEl - 输入框 DOM
   * @param {HTMLElement} popover - 悬浮卡片 DOM
   */
  positionPopover(targetEl, popover) {
    const rect = targetEl.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    // 默认展示在输入框下方
    let top = rect.bottom + scrollTop + 6;
    let left = rect.left + scrollLeft;

    // 防止超出屏幕右侧边界
    const popoverWidth = 320;
    if (left + popoverWidth > window.innerWidth - 16) {
      left = window.innerWidth - popoverWidth - 16;
    }
    if (left < 16) left = 16;

    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  }

  /**
   * 为 Popover 内部的交互按钮绑定点击事件
   * @param {Object} parseResult - 剪切板解析数据
   */
  bindPopoverEvents(parseResult) {
    const { rawText, folderCandidate, prefixCandidate } = parseResult;

    // 关闭按钮
    const closeBtn = document.getElementById('smartCloseBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.lastIgnoredText = rawText;
        this.hidePopover();
      });
    }

    // ⚡ 一键应用两者
    const applyAllBtn = document.getElementById('smartApplyAllBtn');
    if (applyAllBtn) {
      applyAllBtn.addEventListener('click', () => {
        if (this.folderInput) this.folderInput.value = folderCandidate;
        if (this.prefixInput) this.prefixInput.value = prefixCandidate;
        if (this.renameToggle) this.renameToggle.checked = true;

        this.onApply({
          folder: folderCandidate,
          prefix: prefixCandidate,
          isRenaming: true
        });

        this.hidePopover();
      });
    }

    // 📁 仅填文件夹
    const applyFolderBtn = document.getElementById('smartApplyFolderBtn');
    if (applyFolderBtn) {
      applyFolderBtn.addEventListener('click', () => {
        const val = folderCandidate || rawText;
        if (this.folderInput) this.folderInput.value = val;

        this.onApply({
          folder: val
        });

        this.hidePopover();
      });
    }

    // 📄 仅填文件名前缀
    const applyPrefixBtn = document.getElementById('smartApplyPrefixBtn');
    if (applyPrefixBtn) {
      applyPrefixBtn.addEventListener('click', () => {
        const val = prefixCandidate || rawText;
        if (this.prefixInput) this.prefixInput.value = val;
        if (this.renameToggle) this.renameToggle.checked = true;

        this.onApply({
          prefix: val,
          isRenaming: true
        });

        this.hidePopover();
      });
    }

    // 📋 粘贴到当前激活输入框
    const applyCurrentBtn = document.getElementById('smartApplyCurrentBtn');
    if (applyCurrentBtn && this.activeInput) {
      applyCurrentBtn.addEventListener('click', () => {
        this.activeInput.value = rawText;

        if (this.activeInput === this.folderInput) {
          this.onApply({ folder: rawText });
        } else if (this.activeInput === this.prefixInput) {
          if (this.renameToggle) this.renameToggle.checked = true;
          this.onApply({ prefix: rawText, isRenaming: true });
        }

        this.hidePopover();
      });
    }

    // Tag Chip 点击填入当前框
    const chipBtns = this.popoverEl.querySelectorAll('.smart-chip-tag');
    chipBtns.forEach(chip => {
      chip.addEventListener('click', (e) => {
        const tagText = e.target.dataset.tag;
        if (this.activeInput && tagText) {
          this.activeInput.value = tagText;

          if (this.activeInput === this.folderInput) {
            this.onApply({ folder: tagText });
          } else if (this.activeInput === this.prefixInput) {
            if (this.renameToggle) this.renameToggle.checked = true;
            this.onApply({ prefix: tagText, isRenaming: true });
          }
        }
        this.hidePopover();
      });
    });
  }

  /**
   * 隐藏 Popover 卡片
   */
  hidePopover() {
    if (this.popoverEl) {
      this.popoverEl.classList.add('hidden');
    }
  }

  /**
   * 处理点击卡片外部区域时自动收起
   * @param {MouseEvent} e - 鼠标点击事件对象
   */
  handleOutsideClick(e) {
    if (!this.popoverEl || this.popoverEl.classList.contains('hidden')) return;

    // 若点击的不是 Popover 内部，且不是输入的 input 元素本身，则隐藏
    if (!this.popoverEl.contains(e.target) &&
        e.target !== this.folderInput &&
        e.target !== this.prefixInput) {
      this.hidePopover();
    }
  }

  /**
   * 键盘事件监听 (Esc 快捷关闭)
   * @param {KeyboardEvent} e - 键盘事件对象
   */
  handleKeyDown(e) {
    if (e.key === 'Escape') {
      this.hidePopover();
    }
  }

  /**
   * HTML 转义工具函数
   * @param {string} str - 原始字符串
   * @returns {string} 安全转义后的字符串
   */
  escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// 导出为全局变量供 Popup 与 Gallery 脚本直接调用
window.ClipboardSmartPaste = ClipboardSmartPaste;
