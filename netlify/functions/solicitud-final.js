'use strict';
/* ===================================================================
   Ap-Ab — Netlify Function: /.netlify/functions/solicitud-final
   El cliente pulsa "Solicitud final": guardamos los requerimientos
   (MASTER DRA + params) en Supabase (tabla 'solicitudes'). El correo
   de aviso lo envía el cliente vía Netlify Forms (sin exponer el DRA).
   =================================================================== */

const config = require('../../config.json');
const { computeQuote } = require('./lib/pricing');

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
async function getSession(env, sessionId, userId) {
  const url = `${baseUrl(env)}/rest/v1/quote_sessions?session_id=eq.${encodeURIComponent(sessionId)}&user_id=eq.${encodeURIComponent(userId)}&select=*`;
  const res = await fetch(url, { headers: restHeaders(env) });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows && rows[0] ? rows[0] : null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  const env = process.env;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: 'server_misconfigured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }
  if (!body.token) return json(401, { error: 'not_authenticated' });
  const user = await getUser(env, body.token);
  if (!user) return json(401, { error: 'invalid_session' });
  if (!body.session_id) return json(400, { error: 'missing_session' });

  const sess = await getSession(env, body.session_id, user.id);
  if (!sess) return json(404, { error: 'session_not_found' });

  // Guardar el lead (DRA + params) en Supabase.
  try {
    const res = await fetch(`${baseUrl(env)}/rest/v1/solicitudes`, {
      method: 'POST',
      headers: restHeaders(env, { 'Content-Type': 'application/json' }),
      body: JSON.stringify([{
        user_id: user.id,
        email: user.email || (body.contacto || null),
        nombre_proyecto: sess.nombre_proyecto,
        dra: sess.dra,
        params: sess.params,
      }]),
    });
    if (!res.ok) return json(500, { error: 'save_failed' });
  } catch (e) {
    return json(500, { error: 'save_failed' });
  }

  const quote = computeQuote(config, sess.params || {}, new Date().toISOString().slice(0, 10));
  // Devolvemos datos NO sensibles para que el cliente dispare el correo de aviso
  // (Netlify Forms) y muestre confirmación. El DRA NO se devuelve.
  return json(200, {
    ok: true,
    nombre_proyecto: sess.nombre_proyecto || 'Proyecto',
    email: user.email || null,
    quote,
  });
};
