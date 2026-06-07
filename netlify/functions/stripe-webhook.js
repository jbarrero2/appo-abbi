'use strict';
/* ===================================================================
   Ap-Ab — Webhook de pago (Stripe) → acredita +10 cotizaciones.
   Endurecido para producción:
     • Verifica la firma (HMAC-SHA256, sin dependencias).
     • Anti-replay: rechaza firmas fuera de tolerancia (±5 min).
     • IDEMPOTENTE: deduplica por event.id en Postgres (credit_purchase),
       así si Stripe reenvía el mismo evento NO acredita doble.

   Requiere (ver HANDOFF.md):
     STRIPE_WEBHOOK_SECRET, PACK_SIZE (opc, def 10),
     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
   El Payment Link debe llevar ?client_reference_id=<id de usuario>
   (el frontend lo añade solo). Pruébalo en modo test de Stripe.
   =================================================================== */

const crypto = require('crypto');
const TOLERANCE_SECONDS = 300; // anti-replay: descarta firmas viejas (>5 min)

function baseUrl(env) {
  return String(env.SUPABASE_URL || '').replace(/\/+$/, '');
}

function parseSig(sigHeader) {
  const parts = {};
  String(sigHeader || '').split(',').forEach((kv) => {
    const i = kv.indexOf('=');
    if (i > -1) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  });
  return parts;
}

function verifyStripe(rawBody, parts, secret) {
  if (!parts || !parts.t || !parts.v1 || !secret) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${parts.t}.${rawBody}`, 'utf8')
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  } catch (_) {
    return false;
  }
}

// Acredita SOLO si el evento es nuevo (idempotente). true = acreditó.
async function creditPurchase(env, eventId, userId, n) {
  const res = await fetch(`${baseUrl(env)}/rest/v1/rpc/credit_purchase`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_event_id: eventId, p_user: userId, p_n: n }),
  });
  if (!res.ok) throw new Error('rpc_' + res.status);
  return await res.json(); // true si acreditó, false si ya estaba procesado
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'method' };

  const env = process.env;
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || '';
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const parts = parseSig(sig);

  // 1) Firma válida
  if (!verifyStripe(raw, parts, env.STRIPE_WEBHOOK_SECRET)) {
    return { statusCode: 400, body: 'invalid_signature' };
  }
  // 2) Anti-replay: el timestamp de la firma debe estar dentro de tolerancia
  const t = parseInt(parts.t, 10);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!t || Math.abs(nowSec - t) > TOLERANCE_SECONDS) {
    return { statusCode: 400, body: 'timestamp_out_of_tolerance' };
  }

  let evt;
  try {
    evt = JSON.parse(raw);
  } catch (_) {
    return { statusCode: 400, body: 'bad_json' };
  }

  if (evt.type === 'checkout.session.completed') {
    const session = evt.data && evt.data.object ? evt.data.object : {};
    const userId = session.client_reference_id;
    const pack = parseInt(env.PACK_SIZE || '10', 10) || 10;
    if (userId && evt.id) {
      try {
        // Idempotente por evt.id: reenvíos de Stripe NO acreditan doble.
        await creditPurchase(env, evt.id, userId, pack);
        // (si devuelve false ya estaba procesado; respondemos 200 igual)
      } catch (e) {
        return { statusCode: 500, body: 'credit_failed' }; // Stripe reintentará
      }
    }
  }

  return { statusCode: 200, body: 'ok' };
};
