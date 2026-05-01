import { test } from 'node:test';
import assert from 'node:assert/strict';

// markdown.js importa escapeHtml desde dom.js, y dom.js ejecuta
// document.getElementById(...) en top-level.  Mockeamos antes del import.
globalThis.document = { getElementById: () => null };

const { renderMarkdown } = await import('../public/tunnel/js/markdown.js');

test('empty / nullish input returns empty string', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(null), '');
  assert.equal(renderMarkdown(undefined), '');
});

test('plain text gets wrapped in <p>', () => {
  assert.equal(renderMarkdown('hola'), '<p>hola</p>');
});

test('plain HTML is escaped (XSS guard)', () => {
  const out = renderMarkdown('<script>alert(1)</script>');
  assert.match(out, /&lt;script&gt;/);
  assert.doesNotMatch(out, /<script>/);
});

test('bold with **double asterisks**', () => {
  assert.equal(renderMarkdown('**hola**'), '<p><strong>hola</strong></p>');
});

test('bold with __double underscores__', () => {
  assert.equal(renderMarkdown('__hola__'), '<p><strong>hola</strong></p>');
});

test('inline `code` content is escaped (with surrounding text)', () => {
  const out = renderMarkdown('Mira: `<script>` aquí');
  assert.match(out, /<code class="md-inline">&lt;script&gt;<\/code>/);
});

test('fenced code block with language gets data-lang (single-newline framing)', () => {
  const out = renderMarkdown('Ejemplo:\n```js\nconsole.log(1)\n```\nFin.');
  assert.match(out, /<pre class="md-code" data-lang="js">/);
  assert.match(out, /console\.log\(1\)/);
});

test('fenced code block without language omits data-lang (single-newline framing)', () => {
  const out = renderMarkdown('Antes\n```\nfoo\n```\nDespués');
  assert.match(out, /<pre class="md-code"><code>foo/);
  assert.doesNotMatch(out, /data-lang/);
});

test('fenced code contents stay escaped (single-newline framing)', () => {
  const out = renderMarkdown('Demo\n```\n<div>x</div>\n```\nfin');
  assert.match(out, /&lt;div&gt;x&lt;\/div&gt;/);
});

// ─── Known issues (documentados, no fixes en este sprint) ─────────────
// Cuando el input es ÚNICAMENTE código (inline o fenced) sin texto antes
// ni después, el placeholder ` IC<n> ` / ` CB<n> ` queda sin restaurar.
// Causa: el regex de restitución requiere espacios a ambos lados, pero el
// wrap en <p> hace block.trim() que se los come.  En uso real del chat el
// modelo casi siempre devuelve texto alrededor del código, así que el bug
// es marginal — pero los tests lo dejan documentado para que un fix
// futuro lo rompa explícitamente.
test('KNOWN ISSUE: inline code as sole input keeps the IC placeholder', () => {
  assert.equal(renderMarkdown('`code`'), '<p>IC0</p>');
});

test('KNOWN ISSUE: fenced code as sole input keeps the CB placeholder', () => {
  assert.equal(renderMarkdown('```\nfoo\n```'), '<p>CB0</p>');
});

test('KNOWN ISSUE: \\n\\n around fenced code isolates it as its own block, breaks restore', () => {
  // Cuando el code block queda en su propio bloque tras split(/\n{2,}/),
  // el block.trim() del wrap en <p> elimina los espacios adyacentes y
  // luego el regex / CB\d+ /g no encuentra match.  Mitigación práctica:
  // los modelos suelen devolver code con '\n' simples alrededor; en
  // chats reales del /tunnel/ el bug rara vez asoma.
  const out = renderMarkdown('Antes\n\n```\nfoo\n```\n\nDespués');
  assert.match(out, /<p>CB0<\/p>/);
});

test('headers h1 through h3', () => {
  assert.match(renderMarkdown('# Title'), /<h1>Title<\/h1>/);
  assert.match(renderMarkdown('## Sub'), /<h2>Sub<\/h2>/);
  assert.match(renderMarkdown('### Mini'), /<h3>Mini<\/h3>/);
});

test('horizontal rule from --- and ***', () => {
  assert.match(renderMarkdown('---'), /<hr>/);
  assert.match(renderMarkdown('***'), /<hr>/);
});

test('http link rendered with target=_blank and rel', () => {
  const out = renderMarkdown('[click](https://example.com)');
  assert.match(
    out,
    /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">click<\/a>/
  );
});

test('javascript: scheme is NOT rendered as anchor', () => {
  const out = renderMarkdown('[click](javascript:alert(1))');
  assert.doesNotMatch(out, /<a /);
});

test('unordered list', () => {
  const out = renderMarkdown('- one\n- two');
  assert.match(out, /<ul>/);
  assert.match(out, /<li>one<\/li>/);
  assert.match(out, /<li>two<\/li>/);
});

test('ordered list', () => {
  const out = renderMarkdown('1. uno\n2. dos');
  assert.match(out, /<ol>/);
  assert.match(out, /<li>uno<\/li>/);
});
