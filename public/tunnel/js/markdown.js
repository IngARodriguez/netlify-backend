import { escapeHtml } from './dom.js';

export function renderMarkdown(text) {
  if (!text) return '';
  const codeBlocks = [];
  const inlineCodes = [];

  let s = String(text).replace(/```([a-zA-Z0-9_+\-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    codeBlocks.push({ lang, code });
    return ' CB' + (codeBlocks.length - 1) + ' ';
  });

  s = s.replace(/`([^`\n]+)`/g, (_, code) => {
    inlineCodes.push(code);
    return ' IC' + (inlineCodes.length - 1) + ' ';
  });

  s = escapeHtml(s);

  s = s.replace(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm, (_, h, content) => {
    const lvl = h.length;
    return '<h' + lvl + '>' + content + '</h' + lvl + '>';
  });

  s = s.replace(/^---+$|^\*\*\*+$/gm, '<hr>');

  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[\s(])_([^_\n]+?)_(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>');

  s = s.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (m, txt, url) => {
    if (!/^(https?:\/\/|mailto:|\/)/i.test(url)) return m;
    return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + txt + '</a>';
  });

  const lines = s.split('\n');
  const out = [];
  let listType = null;
  const closeList = () => {
    if (listType) out.push('</' + listType + '>');
    listType = null;
  };
  for (const line of lines) {
    const ul = line.match(/^\s*[-*+]\s+(.+)$/);
    const ol = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ul) {
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
      out.push('<li>' + ul[1] + '</li>');
    } else if (ol) {
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
      out.push('<li>' + ol[1] + '</li>');
    } else {
      closeList();
      out.push(line);
    }
  }
  closeList();
  s = out.join('\n');

  s = s.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>');

  s = s.split(/\n{2,}/).map((block) => {
    block = block.trim();
    if (!block) return '';
    if (/^<(h[1-6]|ul|ol|pre|blockquote|hr)/i.test(block)) return block;
    if (/^ CB\d+ $/.test(block)) return block;
    return '<p>' + block.replace(/\n/g, '<br>') + '</p>';
  }).filter(Boolean).join('\n');

  s = s.replace(/ IC(\d+) /g, (_, idx) =>
    '<code class="md-inline">' + escapeHtml(inlineCodes[Number(idx)]) + '</code>');

  s = s.replace(/ CB(\d+) /g, (_, idx) => {
    const { lang, code } = codeBlocks[Number(idx)];
    const langAttr = lang ? ' data-lang="' + escapeHtml(lang) + '"' : '';
    return '<pre class="md-code"' + langAttr + '><code>' + escapeHtml(code) + '</code></pre>';
  });

  return s;
}
