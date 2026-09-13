/**
 * Html2MD - 轻量级 HTML 转 Markdown 转换器（无第三方依赖）
 *
 * 支持：标题、段落、有序/无序列表（含嵌套）、引用、围栏代码块（语言识别）、
 *      行内代码、链接、图片、粗体、斜体、删除线、表格（GFM）、分割线等。
 *
 * 暴露：window.Html2MD.convert(html, options)
 *   options.baseUrl 用于把相对链接解析为绝对链接
 *   options.title   当正文不含 h1 时，作为一级标题补在开头
 */
(function (global) {
  'use strict';

  /* ---------- 标签分类 ---------- */

  // 这些节点的内容不参与转换
  var DROP_TAGS = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, IFRAME: 1, OBJECT: 1,
    EMBED: 1, SVG: 1, CANVAS: 1, VIDEO: 1, AUDIO: 1, PARAM: 1, SOURCE: 1,
    TRACK: 1, LINK: 1, META: 1, BASE: 1, TITLE: 1, HEAD: 1, BUTTON: 1,
    INPUT: 1, SELECT: 1, TEXTAREA: 1, LABEL: 1, FORM: 1, DIALOG: 1
  };

  // 容器型块级标签（没有专用处理器时，按块递归处理子节点）
  var BLOCK_TAGS = {
    ADDRESS: 1, ARTICLE: 1, ASIDE: 1, DD: 1, DETAILS: 1, DIV: 1, DL: 1,
    FIELDSET: 1, FIGURE: 1, FOOTER: 1, HEADER: 1, HGROUP: 1, MAIN: 1,
    NAV: 1, SECTION: 1
  };

  // 已知的行内标签；不在此集合也不在块级集合里的未知标签按块级处理
  var INLINE_TAGS = {
    A: 1, ABBR: 1, ACRONYM: 1, B: 1, BDI: 1, BDO: 1, BR: 1, CITE: 1,
    CODE: 1, DATA: 1, DEL: 1, DFN: 1, EM: 1, FONT: 1, I: 1, IMG: 1,
    INS: 1, KBD: 1, MARK: 1, METER: 1, NOBR: 1, OUTPUT: 1, PICTURE: 1,
    PROGRESS: 1, Q: 1, S: 1, SAMP: 1, SMALL: 1, SPAN: 1, STRIKE: 1,
    STRONG: 1, SUB: 1, SUP: 1, TIME: 1, U: 1, VAR: 1, WBR: 1
  };

  var HARD_BREAK = '\u0001'; // 行内 <br> 的临时占位，空白归一化时不会被吞掉

  /* ---------- 工具函数 ---------- */

  function repeat(str, n) {
    return new Array(n + 1).join(str);
  }

  // 对“裸文本”做 Markdown 转义（代码块/行内代码内容不走这里）
  function escapeText(text) {
    return String(text)
      .replace(/\\/g, '\\\\')
      .replace(/([\\`*_~[\]#>])/g, '\\$1');
  }

  // 防止段落开头被误识别为列表/标题等
  function protectStart(line) {
    return line
      .replace(/^([-*+])(\s)/, '\\$1$2')
      .replace(/^(\d+)([.)])(\s)/, '\\$1$2$3');
  }

  function resolveUrl(url, base) {
    try {
      return new URL(url, base || undefined).href;
    } catch (e) {
      return url;
    }
  }

  // URL 含括号或空格时用尖括号包裹，避免 Markdown 链接截断
  function wrapUrl(url) {
    return /[()\s]/.test(url) ? '<' + url + '>' : url;
  }

  function titlePart(title) {
    if (!title) return '';
    return ' "' + String(title).replace(/"/g, '\\"') + '"';
  }

  function withIndent(text, indent) {
    if (!indent) return text;
    return text.split('\n').map(function (l) { return indent + l; }).join('\n');
  }

  // 行内累积文本 -> 段落（空白折叠、<br> 转换）
  // 空白集合包含 nbsp 与 BOM（云文档导出常见残留），统一折叠为普通空格
  var WS_RE = /[ \t\r\n\f\u00a0\ufeff]+/g;
  function composeInline(raw, indent) {
    var norm = raw.replace(WS_RE, ' ');
    var lines = norm.split(HARD_BREAK).map(function (l) {
      return protectStart(l.replace(/^ +| +$/g, ''));
    });
    // 占位符夹在两个空格与换行之间，保证后续行尾空白清理不会误删硬换行
    var text = lines.join('  ' + HARD_BREAK + '\n');
    if (!text.trim()) return '';
    return withIndent(text, indent);
  }

  function singleLine(text) {
    return text.replace(WS_RE, ' ').replace(HARD_BREAK, ' ').trim();
  }

  /* ---------- 行内元素 ---------- */

  function inlineChildren(conv, node) {
    var out = '';
    var children = node.childNodes;
    for (var i = 0; i < children.length; i++) {
      var ch = children[i];
      if (ch.nodeType === 3) { // Text
        out += escapeText(ch.data);
      } else if (ch.nodeType === 1) { // Element
        if (DROP_TAGS[ch.tagName]) continue;
        out += renderInline(conv, ch);
      }
    }
    return out;
  }

  function wrapInline(content, mark) {
    if (!content || !content.trim()) return content || '';
    return mark + content + mark;
  }

  function imageMd(conv, el) {
    var src = el.getAttribute('src');
    if (!src) return '';
    src = resolveUrl(src.trim(), conv.baseUrl);
    var alt = (el.getAttribute('alt') || '').replace(/\s+/g, ' ').replace(/[[\]]/g, '');
    return '![' + alt + '](' + wrapUrl(src) + titlePart(el.getAttribute('title')) + ')';
  }

  function linkMd(conv, el) {
    var href = el.getAttribute('href');
    var inner = inlineChildren(conv, el);
    if (href == null || /^\s*(javascript|vbscript):/i.test(href)) return inner;
    href = resolveUrl(href.trim(), conv.baseUrl);
    var label = singleLine(inner);
    if (!label) return '';
    return '[' + label + '](' + wrapUrl(href) + titlePart(el.getAttribute('title')) + ')';
  }

  function inlineCode(el) {
    var content = el.textContent.replace(/\r\n?/g, '\n');
    var fence = fenceFor(content);
    var pad = /^`|`$/.test(content) ? ' ' : '';
    return fence + pad + content + pad + fence;
  }

  // 选择比内容中最长反引号串更长的围栏
  function fenceFor(content) {
    var max = 2;
    var runs = content.match(/`+/g);
    if (runs) {
      runs.forEach(function (r) { if (r.length > max) max = r.length; });
    }
    return repeat('`', max + 1);
  }

  function renderInline(conv, el) {
    switch (el.tagName) {
      case 'BR': return HARD_BREAK;
      case 'IMG': return imageMd(conv, el);
      case 'A': return linkMd(conv, el);
      case 'CODE': return inlineCode(el);
      case 'B':
      case 'STRONG': return wrapInline(inlineChildren(conv, el), '**');
      case 'I':
      case 'EM':
      case 'CITE':
      case 'DFN': return wrapInline(inlineChildren(conv, el), '*');
      case 'S':
      case 'DEL':
      case 'STRIKE': return wrapInline(inlineChildren(conv, el), '~~');
      case 'Q': return '"' + inlineChildren(conv, el) + '"';
      // 下划线/插入/标记/上下标等保留纯文本
      case 'U':
      case 'INS':
      case 'MARK':
      case 'SMALL':
      case 'SUB':
      case 'SUP':
      case 'ABBR':
      case 'TIME':
      case 'KBD':
      case 'SAMP':
      case 'VAR':
      default: return inlineChildren(conv, el);
    }
  }

  /* ---------- 块级元素处理器 ---------- */

  function heading(level) {
    return function (conv, el, indent) {
      var text = singleLine(inlineChildren(conv, el));
      if (!text) return '';
      return indent + repeat('#', level) + ' ' + text;
    };
  }

  function para(conv, el, indent) {
    return composeInline(inlineChildren(conv, el), indent);
  }

  function detectLang(pre, codeEl) {
    var sources = [
      codeEl && codeEl.className,
      pre.className,
      codeEl && codeEl.getAttribute('data-lang'),
      pre.getAttribute('data-lang')
    ].filter(Boolean).join(' ');
    var m = sources.match(/(?:language-|lang-|brush:\s*|highlight-source-|source-)([A-Za-z0-9_+#.-]+)/);
    return m ? m[1].toLowerCase() : '';
  }

  function codeBlock(conv, el, indent) {
    var codeEl = el.querySelector('code');
    var holder = codeEl || el;
    var content = holder.textContent.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    var lang = detectLang(el, codeEl);
    var fence = fenceFor(content);
    var body = withIndent(content, indent);
    return indent + fence + lang + '\n' + body + '\n' + indent + fence;
  }

  function blockquote(conv, el, indent) {
    var inner = renderBlocks(conv, el, '');
    if (!inner) return '';
    return inner.split('\n').map(function (l) {
      return l === '' ? indent + '>' : indent + '> ' + l;
    }).join('\n');
  }

  function list(ordered) {
    return function (conv, el, indent) {
      var lines = [];
      var start = parseInt(el.getAttribute('start'), 10);
      var num = ordered && start >= 1 ? start : 1;
      var children = el.children;
      for (var i = 0; i < children.length; i++) {
        var li = children[i];
        if (li.tagName !== 'LI') continue;
        var marker = ordered ? (num++) + '. ' : '- ';
        var childIndent = indent + repeat(' ', marker.length);
        var inner = renderBlocks(conv, li, childIndent);
        var ls = inner.split('\n');
        // 第一行去掉子缩进，放到 marker 后面；其余行保持缩进
        var first = ls[0].indexOf(childIndent) === 0
          ? ls[0].slice(childIndent.length) : ls[0];
        lines.push(indent + marker + protectStart(first));
        for (var j = 1; j < ls.length; j++) lines.push(ls[j]);
      }
      return lines.join('\n');
    };
  }

  function table(conv, el, indent) {
    var rows = Array.prototype.slice.call(el.querySelectorAll('tr'));
    if (!rows.length) return renderBlocks(conv, el, indent);

    var matrix = rows.map(function (tr) {
      return Array.prototype.slice.call(tr.children)
        .filter(function (c) { return c.tagName === 'TH' || c.tagName === 'TD'; })
        .map(function (c) {
          return { isHead: c.tagName === 'TH', text: cellText(conv, c) };
        });
    }).filter(function (r) { return r.length; });
    if (!matrix.length) return '';

    var cols = 0;
    matrix.forEach(function (r) { cols = Math.max(cols, r.length); });

    var headerRow;
    var bodyRows;
    var firstAllHead = matrix[0].length === cols && matrix[0].every(function (c) { return c.isHead; });
    if (firstAllHead) {
      headerRow = matrix[0];
      bodyRows = matrix.slice(1);
    } else {
      // GFM 表格必须有表头，源表没有 th 时使用空表头
      headerRow = [];
      for (var h = 0; h < cols; h++) headerRow.push({ isHead: false, text: '' });
      bodyRows = matrix;
    }

    function pad(row) {
      var cells = row.map(function (c) { return c.text; });
      while (cells.length < cols) cells.push('');
      return cells;
    }
    function line(cells) {
      return indent + '| ' + cells.join(' | ') + ' |';
    }

    var out = [line(pad(headerRow)), indent + '|' + repeat(' --- |', cols)];
    bodyRows.forEach(function (r) { out.push(line(pad(r))); });
    return out.join('\n');
  }

  function cellText(conv, cell) {
    return singleLine(inlineChildren(conv, cell))
      .replace(/\|/g, '\\|')
      .replace(new RegExp(HARD_BREAK, 'g'), '<br>');
  }

  var BLOCK_HANDLERS = {
    H1: heading(1), H2: heading(2), H3: heading(3),
    H4: heading(4), H5: heading(5), H6: heading(6),
    P: para,
    PRE: codeBlock,
    BLOCKQUOTE: blockquote,
    UL: list(false),
    OL: list(true),
    HR: function (conv, el, indent) { return indent + '---'; },
    TABLE: table,
    DT: function (conv, el, indent) {
      var t = singleLine(inlineChildren(conv, el));
      return t ? indent + '**' + t + '**' : '';
    },
    DD: function (conv, el, indent) {
      return renderBlocks(conv, el, indent);
    },
    FIGCAPTION: function (conv, el, indent) {
      var t = singleLine(inlineChildren(conv, el));
      return t ? indent + '*' + t + '*' : '';
    },
    SUMMARY: function (conv, el, indent) {
      var t = singleLine(inlineChildren(conv, el));
      return t ? indent + '**' + t + '**' : '';
    },
    ADDRESS: function (conv, el, indent) {
      var t = singleLine(inlineChildren(conv, el));
      return t ? indent + '*' + t + '*' : '';
    }
  };

  /* ---------- 块级递归主体 ---------- */

  function renderBlocks(conv, node, indent) {
    var blocks = [];
    var buf = '';

    function flush() {
      var text = composeInline(buf, indent);
      if (text) blocks.push(text);
      buf = '';
    }

    var children = node.childNodes;
    for (var i = 0; i < children.length; i++) {
      var ch = children[i];
      if (ch.nodeType === 3) {
        buf += escapeText(ch.data);
      } else if (ch.nodeType === 1) {
        var tag = ch.tagName;
        if (DROP_TAGS[tag]) continue;
        var handler = BLOCK_HANDLERS[tag];
        if (handler) {
          flush();
          var rendered = handler(conv, ch, indent);
          if (rendered) blocks.push(rendered);
        } else if (BLOCK_TAGS[tag] || !INLINE_TAGS[tag]) {
          flush();
          var nested = renderBlocks(conv, ch, indent);
          if (nested) blocks.push(nested);
        } else {
          buf += renderInline(conv, ch);
        }
      }
    }
    flush();
    return blocks.join('\n\n');
  }

  function stripNoise(root) {
    var noisy = root.querySelectorAll('[hidden],[aria-hidden="true"],template,script,style,noscript');
    Array.prototype.forEach.call(noisy, function (n) {
      if (n.parentNode) n.parentNode.removeChild(n);
    });
  }

  /* ---------- 入口 ---------- */

  function convert(html, options) {
    options = options || {};
    var doc = new DOMParser().parseFromString(String(html == null ? '' : html), 'text/html');
    var root = doc.body || doc;
    stripNoise(root);

    var conv = { baseUrl: options.baseUrl || null };
    var md = renderBlocks(conv, root, '');

    // 正文没有 h1 时，用页面标题补一个一级标题（选中区域转换时不传 title）
    if (options.title && !root.querySelector('h1')) {
      var titleMd = '# ' + singleLine(escapeText(String(options.title)));
      md = md ? titleMd + '\n\n' + md : titleMd;
    }

    return md
      .replace(/[ \t]+$/gm, '')   // 去掉每行尾部空白（占位符保护硬换行）
      .replace(new RegExp(HARD_BREAK, 'g'), '') // 释放 <br> 硬换行
      .replace(/\n{3,}/g, '\n\n') // 最多保留一个空行
      .replace(/^\s+|\s+$/g, '') + '\n';
  }

  global.Html2MD = { convert: convert };
})(typeof window !== 'undefined' ? window : this);
