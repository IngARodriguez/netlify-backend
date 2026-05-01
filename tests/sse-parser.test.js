import { test } from 'node:test';
import assert from 'node:assert/strict';

const { iterSSE } = await import('../public/tunnel/js/stream.js');

// Helpers
function streamFromChunks(chunks) {
  return new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

async function collect(asyncIterable) {
  const out = [];
  for await (const ev of asyncIterable) out.push(ev);
  return out;
}

test('single event with JSON data', async () => {
  const events = await collect(iterSSE({
    body: streamFromChunks(['data: {"hello":1}\n\n']),
  }));
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, { hello: 1 });
});

test('event: header is captured', async () => {
  const events = await collect(iterSSE({
    body: streamFromChunks(['event: message_start\ndata: {"x":1}\n\n']),
  }));
  assert.equal(events[0].event, 'message_start');
  assert.deepEqual(events[0].data, { x: 1 });
});

test('comment-only block surfaces as __comment__', async () => {
  const events = await collect(iterSSE({
    body: streamFromChunks([': keepalive\n\n']),
  }));
  assert.equal(events.length, 1);
  assert.equal(events[0].event, '__comment__');
  assert.equal(events[0].data, null);
  assert.match(events[0].raw, /keepalive/);
});

test(':edge_timeout comment is exposed (real production marker)', async () => {
  const events = await collect(iterSSE({
    body: streamFromChunks([':edge_timeout id=abc123\n\n']),
  }));
  assert.equal(events[0].event, '__comment__');
  assert.match(events[0].raw, /:edge_timeout/);
});

test('[DONE] sentinel is preserved as string', async () => {
  const events = await collect(iterSSE({
    body: streamFromChunks(['data: [DONE]\n\n']),
  }));
  assert.equal(events.length, 1);
  assert.equal(events[0].data, '[DONE]');
});

test('non-JSON data stays as string (Anthropic plain delta edge case)', async () => {
  const events = await collect(iterSSE({
    body: streamFromChunks(['data: just text\n\n']),
  }));
  assert.equal(events[0].data, 'just text');
});

test('three back-to-back events in one chunk', async () => {
  const events = await collect(iterSSE({
    body: streamFromChunks([
      'data: {"i":1}\n\ndata: {"i":2}\n\ndata: {"i":3}\n\n',
    ]),
  }));
  assert.equal(events.length, 3);
  assert.equal(events[0].data.i, 1);
  assert.equal(events[2].data.i, 3);
});

test('event split across chunks reconstructs (real network behaviour)', async () => {
  // El separador \n\n cae en el segundo chunk.
  const events = await collect(iterSSE({
    body: streamFromChunks(['data: {"par', 'tial":1}', '\n\n']),
  }));
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, { partial: 1 });
});

test('OpenAI chat-completions delta shape', async () => {
  const events = await collect(iterSSE({
    body: streamFromChunks([
      'data: {"choices":[{"delta":{"content":"Hola"}}]}\n\n',
    ]),
  }));
  assert.equal(events[0].data.choices[0].delta.content, 'Hola');
});

test('Anthropic content_block_delta shape', async () => {
  const events = await collect(iterSSE({
    body: streamFromChunks([
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hola"}}\n\n',
    ]),
  }));
  assert.equal(events[0].event, 'content_block_delta');
  assert.equal(events[0].data.delta.text, 'Hola');
});
