import { tokenInput, providerSel } from './dom.js';
import { FAST_MODEL } from './models.js';

const FALLBACK_GREETINGS = [
  'Llegaste tarde, igual te recibo.',
  'El silencio era cómodo, pero bueno.',
  'Justo pensaba en ti. Mentira.',
  'Tres, dos, uno. Ya.',
  '¿Traes café o tema?',
  'Me debes una historia.',
  'No tengo todo el día (sí tengo).',
  'Habla rápido, mañana llueve.',
  'Otra noche, otro mortal curioso.',
  '¿Tu plan o el mío?',
  'Disparas tú. Yo esquivo.',
  'Bienvenido al borde del mapa.',
  'Sin promesas, solo respuestas.',
  'Te estaba esperando, casi.',
  'Cuenta. Tengo sed de ruido.',
  'El reloj no avisa. Yo sí.',
  '¿Qué se rompe primero?',
  'Aquí no hay reglas. Casi.',
  'Pregunta como si pagaras.',
  'Una idea. La que sea.',
  '¿Hablamos en serio o jugamos?',
  'Soy todo oídos, sin oídos.',
  'Última función, primer acto.',
  'Ven con preguntas raras.',
  'No traigas excusas, traigas datos.',
  'Tu silencio es ruidoso. Habla.',
  'El próximo chiste lo cuentas tú.',
  'Empezamos por lo difícil.',
  'Improvisa. Yo te sigo.',
  'Adelante, no muerdo. A veces.',
];

const GREETING_MOODS = [
  'noir como detective de los 40',
  'oracular como bola de cristal averiada',
  'absurdo y surrealista',
  'sarcástico pero con cariño',
  'cinematográfico — apertura de película',
  'directo y cortante',
  'hacker / cyberpunk',
  'nostálgico de algo que nunca pasó',
  'juguetón con doble sentido',
  'poético — una imagen visual fugaz',
  'paranoico, en broma',
  'desafiante, como reto',
  'enigmático con pregunta retórica',
  'casual de bar a las 3 am',
  'minimalista zen',
  'tono de instructor de yoga harto',
  'tono de presentador de circo',
  'apocalíptico contenido',
  'pseudo-científico inventado',
  'como nota de la nevera',
  'como mensaje en una botella',
  'como advertencia en aeropuerto',
  'como descripción de menú raro',
  'observación micro-cotidiana',
  'tono de robot que no entendió bien',
];

export function pickFallbackGreeting() {
  return FALLBACK_GREETINGS[Math.floor(Math.random() * FALLBACK_GREETINGS.length)];
}

function buildGreetingPrompt() {
  const mood = GREETING_MOODS[Math.floor(Math.random() * GREETING_MOODS.length)];
  const seed = Math.random().toString(36).slice(2, 10);
  return [
    'Eres el saludo de bienvenida de un chat llamado "Outpost".',
    'Devuelve UNA sola frase corta (máx 12 palabras), en español.',
    'Estilo de esta vez: ' + mood + '.',
    'Que sorprenda, que NO suene genérica, que rompa la expectativa de un asistente.',
    'Sin comillas, sin emojis, sin "hola", sin "en qué te ayudo", sin presentarte.',
    'Inventa algo que un usuario no haya leído antes; puede ser declarativa, pregunta, observación rara, fragmento poético o frase suelta.',
    'Devuelve solo esa frase, nada más.',
    '(seed: ' + seed + ')',
  ].join('\n');
}

export async function fetchDynamicGreeting(controller) {
  const token = tokenInput.value.trim();
  if (!token) return null;
  const provider = providerSel.value;
  const model = FAST_MODEL[provider];
  if (!model) return null;

  let url, body, extract;
  if (provider === 'openai') {
    url = 'https://api.openai.com/v1/chat/completions';
    body = {
      model,
      messages: [{ role: 'user', content: buildGreetingPrompt() }],
      max_tokens: 50,
      temperature: 1.0,
    };
    extract = (r) => r.body.choices[0].message.content;
  } else {
    url = 'https://api.anthropic.com/v1/messages';
    body = {
      model,
      max_tokens: 50,
      temperature: 1.0,
      messages: [{ role: 'user', content: buildGreetingPrompt() }],
    };
    extract = (r) => r.body.content[0].text;
  }

  try {
    const r = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, method: 'POST', body, timeoutMs: 15000 }),
      signal: controller && controller.signal,
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (data.status !== 'done' || !data.response) return null;
    let text = String(extract(data.response) || '').trim();
    text = text.replace(/^[«"'`]+|[»"'`]+$/g, '').trim();
    if (!text || text.length > 100) return null;
    return text;
  } catch {
    return null;
  }
}
