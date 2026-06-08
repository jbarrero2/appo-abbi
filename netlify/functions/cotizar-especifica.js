'use strict';
/* ===================================================================
   Ap-Ab — Netlify Function: /.netlify/functions/cotizar-especifica
   COTIZACIÓN ESPECÍFICA (con DeepSeek). 2 gratis/semana + créditos.
     action 'start'   -> consume 1 cupo (consume_quote, 2/sem); DeepSeek
                         genera mockup HTML + MASTER DRA + parámetros;
                         guarda el DRA server-side (quote_sessions) y
                         devuelve SOLO el mockup + el precio (no el DRA).
     action 'iterate' -> refina el mockup/plan con la sugerencia del
                         usuario (NO consume cupo). Tope de ajustes.
   El precio SIEMPRE lo calcula el código (misma rúbrica que la instantánea).
   La API key de DeepSeek vive SOLO aquí (env). Si falta -> 503.
   =================================================================== */

const { computeQuote } = require('./lib/pricing');
const config = require('../../config.json');

const FREE_PER_WEEK = 2;
const MAX_ITERS = 12;

function json(s, o) {
  return { statusCode: s, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(o) };
}
function baseUrl(env) { return String(env.SUPABASE_URL || '').replace(/\/+$/, ''); }
function restHeaders(env, extra) {
  return Object.assign({ apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }, extra || {});
}

async function getUser(env, token) {
  try {
    const res = await fetch(`${baseUrl(env)}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const u = await res.json();
    return u && u.id ? u : null;
  } catch (_) { return null; }
}

async function consumeQuote(env, userId) {
  const res = await fetch(`${baseUrl(env)}/rest/v1/rpc/consume_quote`, {
    method: 'POST',
    headers: restHeaders(env, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ p_user: userId, p_free: FREE_PER_WEEK, p_window_secs: 7 * 24 * 60 * 60 }),
  });
  if (!res.ok) throw new Error('rpc_consume_' + res.status);
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

// ---------- DeepSeek (OpenAI-compatible) ----------
const ALLOWED = {
  tipo: ['landing', 'web_o_app_sencilla', 'app_con_backend', 'app_compleja', 'producto_con_ia'],
  complejidad: ['baja', 'media', 'alta'],
  plataformas: ['web', 'ios', 'android', 'escritorio'],
  addons: ['autenticacion', 'pagos', 'integraciones', 'ia_llm', 'diseno_personalizado', 'multiplataforma'],
};

const DRA_TEMPLATE =
  '# MASTER DRA: [Nombre del Proyecto]\\n\\n' +
  '## 1. VISION ARQUITECTONICA\\n[1-2 parrafos del objetivo del sistema]\\n\\n' +
  '## 2. REGLAS ESTRICTAS DE SISTEMA\\n' +
  '- Frontend: HTML5, CSS3 y Vanilla JS exclusivamente (Sin React, sin frameworks).\\n' +
  '- Backend: Python puro o FastAPI (especificar segun el proyecto).\\n' +
  '- UI/UX: Estetica Glassmorphism estricta, colores oscuros, cero caracteres de emoji.\\n\\n' +
  '## 3. ESPECIFICACIONES DE FRONTEND (UI/UX)\\n[pantallas/vistas y elementos interactivos]\\n\\n' +
  '## 4. ESPECIFICACIONES DE BACKEND Y LOGICA\\n[rutas, endpoints o funciones core]\\n\\n' +
  '## 5. ESTRUCTURA DE DATOS (Si aplica)\\n[esquemas JSON o almacenamiento]';

function systemPrompt(isIterate) {
  return (
    'Eres Arquitecto de Software Senior y Disenador UI de Ap-Ab. ' +
    (isIterate
      ? 'Vas a REFINAR un plan existente segun el cambio que pida el usuario. '
      : 'A partir de la descripcion del usuario vas a planear el producto. ') +
    'Devuelve EXCLUSIVAMENTE un objeto JSON valido (sin markdown, sin texto fuera del JSON) con EXACTAMENTE estas claves: ' +
    '"nombre_proyecto" (string corto), ' +
    '"dra" (string Markdown que sigue EXACTAMENTE esta plantilla, mismos titulos y orden: ' + DRA_TEMPLATE + ' ), ' +
    '"mockup_html" (string: UN documento HTML completo y autocontenido en un solo archivo, con <style> embebido y, si hace falta, <script> vanilla; muestra la PANTALLA PRINCIPAL del producto como mockup realista; estetica glassmorphism, fondo oscuro #0a0b08, acentos #ff5b2e y #ffab4d, tipografia sans-serif; SIN emojis, SIN imagenes externas, SIN frameworks ni CDNs), ' +
    '"params" (objeto con: "tipo" uno de [' + ALLOWED.tipo.join(', ') + '], ' +
    '"complejidad" uno de [baja, media, alta], ' +
    '"addons" subconjunto de [' + ALLOWED.addons.join(', ') + '], ' +
    '"urgencia" true|false, ' +
    '"plataformas" subconjunto de [web, ios, android, escritorio]). ' +
    'Infiere "params" del alcance real descrito. No incluyas explicaciones fuera del JSON.'
  );
}

async function callDeepSeek(env, messages) {
  const model = env.DEEPSEEK_MODEL || 'deepseek-chat';
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: 8000, temperature: 0.4, response_format: { type: 'json_object' } }),
  });
  if (!res.ok) throw new Error('deepseek_' + res.status);
  const data = await res.json();
  const text = ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim();
  const clean = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  return JSON.parse(clean);
}

function cleanParams(p) {
  p = p || {};
  return {
    tipo: ALLOWED.tipo.includes(p.tipo) ? p.tipo : 'web_o_app_sencilla',
    complejidad: ALLOWED.complejidad.includes(p.complejidad) ? p.complejidad : 'media',
    addons: Array.isArray(p.addons) ? p.addons.filter((a) => ALLOWED.addons.includes(a)) : [],
    plataformas: Array.isArray(p.plataformas) ? p.plataformas.filter((x) => ALLOWED.plataformas.includes(x)) : [],
    urgencia: !!p.urgencia,
  };
}

// ---------- quote_sessions (DRA server-side) ----------
async function createSession(env, userId, out) {
  const res = await fetch(`${baseUrl(env)}/rest/v1/quote_sessions`, {
    method: 'POST',
    headers: restHeaders(env, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify([{ user_id: userId, nombre_proyecto: out.nombre_proyecto, dra: out.dra, params: out.params, iter_count: 0 }]),
  });
  if (!res.ok) throw new Error('session_create_' + res.status);
  const rows = await res.json();
  return rows && rows[0] ? rows[0] : null;
}
async function getSession(env, sessionId, userId) {
  const url = `${baseUrl(env)}/rest/v1/quote_sessions?session_id=eq.${encodeURIComponent(sessionId)}&user_id=eq.${encodeURIComponent(userId)}&select=*`;
  const res = await fetch(url, { headers: restHeaders(env) });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows && rows[0] ? rows[0] : null;
}
async function updateSession(env, sessionId, out, iterCount) {
  await fetch(`${baseUrl(env)}/rest/v1/quote_sessions?session_id=eq.${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    headers: restHeaders(env, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ nombre_proyecto: out.nombre_proyecto, dra: out.dra, params: out.params, iter_count: iterCount }),
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  const env = process.env;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: 'server_misconfigured' });
  if (!env.DEEPSEEK_API_KEY) return json(503, { error: 'especifica_unavailable', detail: 'Falta DEEPSEEK_API_KEY en el backend.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }
  if (!body.token) return json(401, { error: 'not_authenticated' });
  const user = await getUser(env, body.token);
  if (!user) return json(401, { error: 'invalid_session' });

  const action = body.action === 'iterate' ? 'iterate' : 'start';
  const text = String(body.text || '').trim().slice(0, 4000);
  if (!text) return json(400, { error: 'empty_text' });

  // ---------- ITERATE ----------
  if (action === 'iterate') {
    const sess = await getSession(env, body.session_id, user.id);
    if (!sess) return json(404, { error: 'session_not_found' });
    if ((sess.iter_count || 0) >= MAX_ITERS) {
      return json(429, { error: 'max_iters', detail: 'Llegaste al máximo de ajustes. Envía la solicitud final.' });
    }
    let out;
    try {
      out = await callDeepSeek(env, [
        { role: 'system', content: systemPrompt(true) },
        { role: 'user', content:
          'PLAN ACTUAL (DRA):\n' + (sess.dra || '') +
          '\n\nPARAMS ACTUALES: ' + JSON.stringify(sess.params || {}) +
          '\n\nCAMBIO SOLICITADO POR EL USUARIO:\n' + text +
          '\n\nDevuelve el JSON COMPLETO actualizado (nombre_proyecto, dra, mockup_html, params).' },
      ]);
    } catch (e) { return json(502, { error: 'ai_error' }); }
    out.params = cleanParams(out.params);
    const iterCount = (sess.iter_count || 0) + 1;
    await updateSession(env, sess.session_id, out, iterCount);
    const quote = computeQuote(config, out.params, new Date().toISOString().slice(0, 10));
    return json(200, { ok: true, mockup_html: out.mockup_html || '', quote, nombre_proyecto: out.nombre_proyecto || '', iter_count: iterCount, iters_left: MAX_ITERS - iterCount });
  }

  // ---------- START ----------
  let consumed;
  try { consumed = await consumeQuote(env, user.id); }
  catch (e) { return json(500, { error: 'db_error' }); }
  if (!consumed) return json(500, { error: 'db_error' });
  if (!consumed.allowed) {
    const nextAt = consumed.next_available ? new Date(consumed.next_available) : new Date(Date.now() + 7 * 864e5);
    return json(429, {
      error: 'rate_limited', free_per_week: FREE_PER_WEEK, next_available: nextAt.toISOString(),
      days_left: Math.max(1, Math.ceil((nextAt.getTime() - Date.now()) / 864e5)),
      paid_credits: consumed.paid_credits || 0, can_buy: true,
    });
  }

  let out;
  try {
    out = await callDeepSeek(env, [
      { role: 'system', content: systemPrompt(false) },
      { role: 'user', content: 'Descripcion del proyecto del usuario:\n' + text },
    ]);
  } catch (e) {
    return json(502, { error: 'ai_error', detail: 'No se pudo generar el plan. Inténtalo de nuevo.' });
  }
  out.params = cleanParams(out.params);

  let sess;
  try { sess = await createSession(env, user.id, out); } catch (e) { sess = null; }
  const quote = computeQuote(config, out.params, new Date().toISOString().slice(0, 10));

  return json(200, {
    ok: true,
    session_id: sess ? sess.session_id : null,
    mockup_html: out.mockup_html || '',
    nombre_proyecto: out.nombre_proyecto || '',
    quote,
    source: consumed.source,
    remaining_free: Math.max(0, FREE_PER_WEEK - (consumed.free_used || 0)),
    remaining_credits: consumed.paid_credits || 0,
    iters_left: MAX_ITERS,
  });
};
