// Parser SSE async-iterable.  Acepta chunks raw del fetch body y emite
// objetos { event, data, raw }.  Comentarios SSE (líneas que empiezan con
// ":") se exponen como event "__comment__" para que el caller pueda
// detectar marcadores como ":edge_timeout".

export async function* iterSSE(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      while (true) {
        const idx = buf.indexOf('\n\n');
        if (idx < 0) break;
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const ev = parseEventBlock(block);
        if (ev) yield ev;
      }
    }
    if (buf.trim()) {
      const ev = parseEventBlock(buf);
      if (ev) yield ev;
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

function parseEventBlock(block) {
  let event = '';
  let dataStr = '';
  let hadComment = false;
  for (const line of block.split('\n')) {
    if (!line) continue;
    if (line.startsWith(':')) { hadComment = true; continue; }
    if (line.startsWith('event:')) {
      event = line.replace(/^event:\s*/, '').trim();
    } else if (line.startsWith('data:')) {
      const part = line.replace(/^data:\s?/, '');
      dataStr += (dataStr ? '\n' : '') + part;
    }
  }
  if (!dataStr && hadComment) {
    return { event: '__comment__', data: null, raw: block };
  }
  if (!dataStr) return null;
  if (dataStr === '[DONE]') return { event, data: '[DONE]', raw: block };
  let data = dataStr;
  try { data = JSON.parse(dataStr); } catch {}
  return { event, data, raw: block };
}
