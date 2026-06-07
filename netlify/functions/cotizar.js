'use strict';
/* ===================================================================
   Ap-Ab — Netlify Function: /.netlify/functions/cotizar
   Hace TODO lo sensible en el servidor:
     1) Verifica que el usuario esté logueado (token de Supabase).
     2) Valida el límite: 2 cotizaciones rápidas GRATIS por semana,
        + créditos comprados (paquete de 10 por US$5). Todo en la BD.
     3) (Opcional) Modo IA: llama a Anthropic SOLO para extraer
        parámetros en JSON con el modelo más barato. max_tokens bajo.
     4) Calcula el precio con CÓDIGO (config.json) — nunca el LLM.
     5) Consume el cupo (gratis o crédito) y devuelve la cotización.

   La API key y el service_role NUNCA llegan al cliente: viven aquí,
   en variables de entorno de Netlify (ver README / .env.example).
   =================================================================== */

const { computeQuote } = require('./lib/pricing');
const config = require('../../config.json');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
// Cotizaciones rápidas GRATIS por ventana de 7 días (editable).
const FREE_PER_WEEK = 2;

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(obj),
  };
}

function baseUrl(env) {
  return String(env.SUPABASE_URL || '').replace(/\/+$/, '');
}

// --- Supabase: verificar el token y obtener el usuario ---
async function getUser(env, token) {
  try {
    const res = await fetch(`${baseUrl(env)}/auth/v1/user`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user && user.id ? user : null;
  } catch (_) {
    return null;
  }
}

// --- Supabase REST (service_role => salta RLS) ---
function restHeaders(env, extra) {
  return Object.assign(
    {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    extra || {}
  );
}

// Descuenta 1 cotización de forma ATÓMICA en Postgres (consume_quote).
// SELECT ... FOR UPDATE dentro de la función serializa peticiones
// simultáneas del mismo usuario -> sin condición de carrera.
async function consumeQuote(env, userId) {
  const res = await fetch(`${baseUrl(env)}/rest/v1/rpc/consume_quote`, {
    method: 'POST',
    headers: restHeaders(env, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      p_user: userId,
      p_free: FREE_PER_WEEK,
      p_window_secs: 7 * 24 * 60 * 60,
    }),
  });
  if (!res.ok) throw new Error('rpc_consume_' + res.status);
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

// --- Anthropic: extraer parámetros (SOLO en modo IA) ---
const ALLOWED = {
  tipo: ['landing', 'web_o_app_sencilla', 'app_con_backend', 'app_compleja', 'producto_con_ia'],
  complejidad: ['baja', 'media', 'alta'],
  plataformas: ['web', 'ios', 'android', 'escritorio'],
  addons: ['autenticacion', 'pagos', 'integraciones', 'ia_llm', 'diseno_personalizado', 'multiplataforma'],
};

async function extractParams(env, idea) {
  const model = env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
  const system =
    'Eres un extractor de parámetros para cotizar software. ' +
    'Devuelve EXCLUSIVAMENTE un objeto JSON válido (sin texto extra, sin markdown) con estas claves: ' +
    'tipo (uno de: landing, web_o_app_sencilla, app_con_backend, app_compleja, producto_con_ia), ' +
    'plataformas (array de: web, ios, android, escritorio), ' +
    'complejidad (baja|media|alta), ' +
    'addons (array de: autenticacion, pagos, integraciones, ia_llm, diseno_personalizado, multiplataforma), ' +
    'urgencia (true|false). Si algo no se menciona, infiere el valor más razonable.';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 220,
      system,
      messages: [{ role: 'user', content: String(idea).slice(0, 2000) }],
    }),
  });
  if (!res.ok) throw new Error('anthropic_' + res.status);
  const data = await res.json();
  const text = (data.content || []).map((c) => c.text || '').join('').trim();
  const clean = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  return JSON.parse(clean);
}

// Mezcla lo extraído por IA sobre los selectores, validando contra ALLOWED.
function mergeParams(selectors, extracted) {
  const out = Object.assign({}, selectors);
  if (!extracted || typeof extracted !== 'object') return out;
  if (ALLOWED.tipo.includes(extracted.tipo)) out.tipo = extracted.tipo;
  if (ALLOWED.complejidad.includes(extracted.complejidad)) out.complejidad = extracted.complejidad;
  if (Array.isArray(extracted.plataformas))
    out.plataformas = extracted.plataformas.filter((x) => ALLOWED.plataformas.includes(x));
  if (Array.isArray(extracted.addons))
    out.addons = extracted.addons.filter((x) => ALLOWED.addons.includes(x));
  if (typeof extracted.urgencia === 'boolean') out.urgencia = extracted.urgencia;
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  const env = process.env;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { error: 'server_misconfigured', detail: 'Faltan variables SUPABASE_* en Netlify.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return json(400, { error: 'bad_json' });
  }

  const token = body.token;
  if (!token) return json(401, { error: 'not_authenticated' });

  const user = await getUser(env, token);
  if (!user) return json(401, { error: 'invalid_session' });

  // --- Límite: 2 GRATIS/semana + créditos, descontado ATÓMICAMENTE ---
  // Si la BD falla, devolvemos 500: NO entregamos cotización sin registrar
  // el uso (antes era "best-effort"; ahora el consumo es parte del gate).
  const now = new Date();
  let source;
  let remainingFree = 0;
  let remainingCredits = 0;
  let consumed;
  try {
    consumed = await consumeQuote(env, user.id);
  } catch (e) {
    return json(500, { error: 'db_error' });
  }
  if (!consumed) return json(500, { error: 'db_error' });
  if (!consumed.allowed) {
    const nextAt = consumed.next_available
      ? new Date(consumed.next_available)
      : new Date(now.getTime() + SEVEN_DAYS_MS);
    return json(429, {
      error: 'rate_limited',
      free_per_week: FREE_PER_WEEK,
      next_available: nextAt.toISOString(),
      days_left: Math.max(1, Math.ceil((nextAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))),
      paid_credits: consumed.paid_credits || 0,
      can_buy: true,
    });
  }
  source = consumed.source;
  remainingFree = Math.max(0, FREE_PER_WEEK - (consumed.free_used || 0));
  remainingCredits = consumed.paid_credits || 0;

  // --- Parámetros desde los selectores (modo gratis) ---
  let params = {
    tipo: body.tipo,
    complejidad: body.complejidad,
    plataformas: Array.isArray(body.plataformas) ? body.plataformas : [],
    addons: Array.isArray(body.addons) ? body.addons : [],
    urgencia: !!body.urgencia,
  };

  // --- Modo IA (opcional, tras la bandera): solo extrae parámetros ---
  let ai_used = false;
  const aiEnabled = env.AI_MODE_ENABLED === 'true' && !!env.ANTHROPIC_API_KEY;
  if (body.mode === 'ia' && aiEnabled && body.idea && String(body.idea).trim()) {
    try {
      const extracted = await extractParams(env, body.idea);
      params = mergeParams(params, extracted);
      ai_used = true;
    } catch (_) {
      ai_used = false; // si la IA falla, seguimos con los selectores
    }
  }

  // --- Precio: SIEMPRE por código (el cupo ya se descontó atómicamente) ---
  const quote = computeQuote(config, params, now.toISOString().slice(0, 10));

  return json(200, {
    ok: true,
    mode: ai_used ? 'ia' : 'free',
    ai_used,
    ai_available: aiEnabled,
    source,
    free_per_week: FREE_PER_WEEK,
    remaining_free: remainingFree,
    remaining_credits: remainingCredits,
    quote,
  });
};
