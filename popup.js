/**
 * popup 逻辑：
 * 1. 在当前标签页注入抽取函数，拿到 HTML（选中区域 / 智能正文 / 整页）
 * 2. 交给 converter.js 转成 Markdown
 * 3. 支持复制到剪贴板、下载 .md 文件
 */
'use strict';

var output = document.getElementById('output');
var scopeSelect = document.getElementById('scope');
var copyBtn = document.getElementById('copy');
var downloadBtn = document.getElementById('download');
var stats = document.getElementById('stats');

var currentMd = '';
var currentTitle = '';

/**
 * 在目标页面上下文里执行（会被序列化注入，不能引用外层变量）。
 * @param {string} scope auto | smart | selection | full
 */
function extractInPage(scope) {
  var NOISE_BASE =
    'script,style,noscript,template,iframe,object,embed,svg,canvas,video,audio,' +
    'link,meta,base,button,input,select,textarea,form,[hidden],' +
    '[aria-hidden="true"],.ad,.ads,.advertisement,.advert,.google-auto-placed';
  // 整页抽取时再移除结构性噪音（文章内部的 header 常包裹标题，不能乱删）
  var NOISE_STRUCTURAL = 'nav,header,footer,aside,.sidebar,.nav,.menu';

  function clean(root, removeStructural) {
    var clone = root.cloneNode(true);
    var nodes = clone.querySelectorAll(NOISE_BASE +
      (removeStructural ? ',' + NOISE_STRUCTURAL : ''));
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
    }
    return clone;
  }

  var sel = window.getSelection ? window.getSelection() : null;
  var hasSelection = !!(sel && sel.rangeCount &&
    sel.toString().replace(/\s+/g, '').length > 0);

  // 1) 选中区域优先
  if (scope === 'selection' || (scope === 'auto' && hasSelection)) {
    var holder = document.createElement('div');
    holder.appendChild(sel.getRangeAt(0).cloneContents());
    return {
      html: clean(holder, false).innerHTML,
      url: location.href,
      title: document.title,
      scopeUsed: 'selection'
    };
  }

  // 2) 智能正文：在一组常见容器选择器里挑文字最多的那个
  var target = null;
  if (scope !== 'full') {
    var candidates = [
      'article', 'main', '[role="main"]',
      '.markdown-body', '.markdown', '.post-content', '.post',
      '.article-content', '.entry-content', '.content',
      '#content', '#main'
    ];
    var bestLen = 200;
    for (var c = 0; c < candidates.length; c++) {
      var found = document.querySelectorAll(candidates[c]);
      for (var j = 0; j < found.length; j++) {
        var text = found[j].innerText || found[j].textContent || '';
        var len = text.replace(/\s+/g, '').length;
        if (len > bestLen) {
          bestLen = len;
          target = found[j];
        }
      }
    }
  }

  // 3) 兜底：整个 body
  var usedFull = !target;
  target = target || document.body;
  var clone = clean(target, usedFull);

  return {
    html: clone.outerHTML,
    url: location.href,
    title: document.title,
    scopeUsed: usedFull ? 'full' : 'smart'
  };
}

function scopeLabel(used) {
  return { selection: '选中区域', smart: '智能正文', full: '整个网页' }[used] || '';
}

function convert() {
  output.value = '正在转换…';
  stats.textContent = '';

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs && tabs[0];
    if (!tab || !tab.id) {
      output.value = '无法获取当前标签页。';
      return;
    }

    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, func: extractInPage, args: [scopeSelect.value] },
      function (results) {
        if (chrome.runtime.lastError || !results || !results[0]) {
          output.value =
            '转换失败：当前页面不允许扩展访问。\n' +
            '（如 chrome://、Chrome 网上应用店、PDF 预览等页面）\n' +
            '请在普通网页（http/https/file）中重试。';
          return;
        }

        var data = results[0].result;
        if (!data || !data.html) {
          output.value = '没有可转换的内容。';
          return;
        }

        try {
          currentMd = window.Html2MD.convert(data.html, {
            baseUrl: data.url,
            title: data.scopeUsed === 'selection' ? '' : data.title
          });
          currentTitle = data.title || 'document';
          output.value = currentMd;
          stats.textContent = scopeLabel(data.scopeUsed) + ' · ' +
            currentMd.length + ' 字符';
        } catch (e) {
          output.value = '转换出错：' + (e && e.message ? e.message : e);
        }
      }
    );
  });
}

function slugify(name) {
  var slug = (name || 'document')
    .replace(/[\\/:*?"<>|#]+/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return slug || 'document';
}

copyBtn.addEventListener('click', function () {
  if (!currentMd) return;
  navigator.clipboard.writeText(currentMd).then(function () {
    var old = copyBtn.textContent;
    copyBtn.textContent = '已复制 ✓';
    setTimeout(function () { copyBtn.textContent = old; }, 1200);
  }, function () {
    // 个别环境剪贴板权限受限时的兜底
    output.focus();
    output.select();
    document.execCommand('copy');
  });
});

downloadBtn.addEventListener('click', function () {
  if (!currentMd) return;
  var blob = new Blob([currentMd], { type: 'text/markdown;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = slugify(currentTitle) + '.md';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
});

scopeSelect.addEventListener('change', convert);

convert();
