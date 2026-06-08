'use strict';
/* ===================================================================
   Ap-Ab — Netlify Function: /.netlify/functions/cotizar
   COTIZACIÓN INSTANTÁNEA (heurística pura, GRATIS e ILIMITADA).
     1) Verifica login (token de Supabase).
     2) Calcula el precio con CÓDIGO (config.json) desde los selectores.
   Sin IA, sin texto libre, sin límite semanal (eso es la "específica").
   =================================================================== */

const { computeQuote } = require('./lib/pricing');
const config = require('../../config.json');

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

  if (!body.token) return json(401, { error: 'not_authenticated' });
  const user = await getUser(env, body.token);
  if (!user) return json(401, { error: 'invalid_session' });

  // La instantánea NO consume cupo (gratis e ilimitada).
  const params = {
    tipo: body.tipo,
    complejidad: body.complejidad,
    plataformas: Array.isArray(body.plataformas) ? body.plataformas : [],
    addons: Array.isArray(body.addons) ? body.addons : [],
    urgencia: !!body.urgencia,
  };

  const quote = computeQuote(config, params, new Date().toISOString().slice(0, 10));
  return json(200, { ok: true, mode: 'instantanea', quote });
};
