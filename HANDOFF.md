# Ap-Ab — Traspaso para el arquitecto (prompt de integración)

> **Para quien integra:** este documento describe TODO lo que ya está construido en la web-app de
> Ap-Ab y exactamente lo que falta para ponerla en producción ("conectarla a internet"). El código
> está listo; faltan **cuentas, claves y el cableado del pago**. Sigue las secciones marcadas con ✅ TODO.
> Puedes pegar este archivo como prompt/brief a tu asistente de código.

---

## 1) Qué es

Web-app de **Ap-Ab** (compañía de software, Bogotá). Es una landing de marca + login + un **cotizador
de "cotización rápida"**. Objetivo: confianza y conversión, **al menor costo posible**.

- **Marca (NO cambiar):** fondo `#0a0b08`, texto crema `#f3f0e6`, acentos ember `#ff5b2e` / naranja
  `#ffab4d` / dorado `#e9c46a`. Fuentes Google: Bricolage Grotesque, Hanken Grotesk, Space Mono.
  Estética oscura, grilla blueprint, glow ember, botones píldora. Mobile-first y rápida.
- **Costo:** todo en planes **gratuitos** (Netlify + Supabase). Único costo variable: la API de
  Anthropic (solo si se usa el Modo IA) y la comisión de Stripe por venta del paquete.

## 2) Stack

| Capa | Servicio | Plan |
|---|---|---|
| Hosting + Functions + Forms | **Netlify** | Free |
| Auth + Postgres | **Supabase** | Free |
| LLM (extrae parámetros, opcional) | **Anthropic** `claude-haiku-4-5` | pago por uso |
| Pago del paquete US$5 | **Stripe** (Payment Link + webhook) | comisión por venta |

Sin framework ni build: HTML/CSS/JS plano + Supabase JS por CDN. Funciones Node sin dependencias
(solo `fetch` y `crypto` nativos), empaquetadas por esbuild.

## 3) Mapa de archivos

```
index.html                      Landing (marca + confianza: proceso, garantías, FAQ, portafolio, contacto)
cotizador.html                  Protegida: login/registro + cotizador + comparador 3 niveles + botón compra
styles.css                      Marca compartida (edita :root para re-tematizar)
config.json                     RÚBRICA de precios (editable)
assets/supabase-config.js       Config PÚBLICA: URL + anon key + AI_MODE_ENABLED + PAYMENT_LINK   ← EDITAR
assets/cotizador.js             Cliente: auth + llamada a la función + render + botón compra
netlify/functions/cotizar.js    Backend: valida login + límite (2/sem + créditos) + IA + precio
netlify/functions/lib/pricing.js  Cálculo determinista (función pura, testeable)
netlify/functions/stripe-webhook.js  Webhook de pago (SCAFFOLD) → acredita +10
netlify.toml                    publish="." , functions, included_files=["config.json"]
schema.sql                      Tabla quote_limits + RLS + función add_quote_credits
.env.example                    Variables del backend (NO subir el .env real)
serve.py                        Solo para previsualizar en local (no es del deploy)
```

## 4) Cómo funciona el cotizador (reglas de negocio)

- **Sin login no se cotiza.** Auth por email + contraseña (Supabase).
- **Cotización rápida GRATIS:** **máximo 2 por semana** por usuario (ventana móvil de 7 días).
- **Paquete de pago:** **10 cotizaciones por US$5** (créditos que **no caducan**). Se consumen
  después de agotar las 2 gratis de la semana.
- **Precio:** lo calcula **siempre el código** (`pricing.js` + `config.json`). Modo gratis = selectores.
  Modo IA (opcional) = el usuario escribe en texto libre y Anthropic **solo extrae parámetros** (JSON);
  el precio nunca lo decide el LLM.
- **Comparador (3 niveles, como rango):** mercado (tachado) → Ap-Ab (50%) → **lanzamiento (25%, destacado)**
  + "ahorras ≈75%" + pago **20% al iniciar / 80% al entregar** + notas fijas.
- Todo el conteo de límite/créditos se valida en el **servidor** (`quote_limits`); el cliente no puede saltarlo.

### Contrato de la función `POST /.netlify/functions/cotizar`
```jsonc
// request
{ "token": "<supabase access_token>", "mode": "free|ia", "idea": "texto (modo ia)",
  "tipo": "app_con_backend", "complejidad": "media",
  "plataformas": ["web"], "addons": ["autenticacion","pagos"], "urgencia": false }
// 200
{ "ok": true, "mode": "free", "ai_used": false, "source": "free|paid",
  "free_per_week": 2, "remaining_free": 1, "remaining_credits": 0, "quote": { /* niveles con min/base/max */ } }
// 429 (sin cupo)
{ "error": "rate_limited", "free_per_week": 2, "next_available": "ISO", "days_left": 5, "paid_credits": 0, "can_buy": true }
// 401 sin/又 token inválido · 500 server_misconfigured/db_error
```

---

## 5) ✅ TODO — Integración (lo que falta para producción)

### A. Supabase
1. Crear proyecto (Free).
2. **SQL Editor** → pegar y ejecutar `schema.sql` (crea `quote_limits` + RLS + `add_quote_credits`).
3. **Authentication → Email**: activado. Para menos fricción, **desactivar "Confirm email"**
   (si lo dejas activo, el usuario debe confirmar antes de entrar; el frontend ya contempla ambos casos).
4. **Project Settings → API** → copiar **Project URL**, **anon public** y **service_role** (secreta).

### B. Frontend (`assets/supabase-config.js`)
- `SUPABASE_URL` y `SUPABASE_ANON_KEY` (públicas).
- `AI_MODE_ENABLED: true` (debe coincidir con el backend).
- `PAYMENT_LINK`: el Stripe Payment Link (paso D). Si se deja vacío, el botón abre WhatsApp.

### C. Netlify
1. **Deploy** (arrastrar la carpeta, o conectar repo).
2. **Environment variables** (Site → Settings → Environment variables): ver `.env.example`
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `AI_MODE_ENABLED=true`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL=claude-haiku-4-5`
   - (pago) `STRIPE_WEBHOOK_SECRET`, `PACK_SIZE=10`
3. **Forms → notifications**: enviar el formulario `contacto` a **abbiappo8@gmail.com**.
4. Redeploy con *Clear cache*.

### D. Pago del paquete (Stripe) — el botón "Comprar 10 · US$5"
1. Stripe → **Payment Link** de **US$5** (producto "10 cotizaciones rápidas Ap-Ab").
2. Pegar ese enlace en `PAYMENT_LINK`. El sitio le añade automáticamente
   `?client_reference_id=<id de usuario logueado>` (y `prefilled_email`).
3. Stripe → **Developers → Webhooks → Add endpoint**:
   - URL: `https://TU-SITIO.netlify.app/.netlify/functions/stripe-webhook`
   - Evento: `checkout.session.completed`
   - Copiar el **Signing secret** → `STRIPE_WEBHOOK_SECRET` en Netlify.
4. El webhook (`stripe-webhook.js`) ya: **verifica la firma**, **rechaza réplicas** (tolerancia de
   tiempo ±5 min) y acredita con `credit_purchase(event.id, user, 10)` — **idempotente**: si Stripe
   reenvía el mismo evento NO acredita doble (dedupe por `event.id` en la tabla `processed_webhooks`).
   **Pruébalo en modo test de Stripe** antes de producción.
> Alternativa más simple sin Stripe: dejar `PAYMENT_LINK` vacío → el botón coordina el pago por
> WhatsApp y tú acreditas a mano corriendo `select add_quote_credits('<uuid>', 10);` en Supabase.

### E. Dominio + correo (opcional)
- Conectar dominio propio en Netlify (HTTPS automático).
- Verificar que las notificaciones de Netlify Forms lleguen bien (revisar spam la primera vez).

---

## 6) Editar la rúbrica de precios
Todo en `config.json` (tarifas por tipo, factores de complejidad, add-ons, `urgencia_factor`,
`vigencia_lanzamiento`, `rango` min/max). La fórmula está documentada en `pricing.js`.
**Decisiones tomadas (ajustables):** la urgencia (+25%) multiplica el *mercado* para mantener el
ahorro en ≈75%; "multiplataforma" es un add-on explícito (las plataformas son informativas);
tras `vigencia_lanzamiento` el lanzamiento pasa solo a 50% automáticamente.

## 7) Criterios de aceptación (cumplidos en el código)
- [x] API key de Anthropic y `service_role` **solo** en el backend (env de Netlify).
- [x] Límite (2 gratis/semana + créditos) validado en el **servidor**, **atómico** (`consume_quote` con `SELECT … FOR UPDATE`, sin carrera entre pestañas).
- [x] Webhook de pago **idempotente** (dedupe por `event.id` en `processed_webhooks`) + **anti-replay** (tolerancia ±5 min). El consumo del cupo ya **no es best-effort**: si la BD falla → 500 (no se entrega cotización sin contarla).
- [x] Sin login no hay cotización real (`?demo=1` es solo vista de diseño).
- [x] Modo gratis funciona sin ninguna llamada a API.
- [x] Comparador con 3 niveles + ahorro + pago 20/80, como rango.
- [x] Formulario de contacto corto (nombre, correo, mensaje) vía Netlify Forms.
- [x] Secciones de proceso, garantías/por qué confiar, FAQ y contacto real (correo + WhatsApp + Bogotá + 24h).
- [ ] (TODO integrador) Pago real del paquete US$5 con Stripe en producción.

## 8) Checklist de prueba post-deploy
1. Registro + login con un correo de prueba.
2. Cotizar 2 veces (gratis) → la 3ª debe mostrar el aviso 429 + el botón de compra.
3. (Si Stripe) pagar en test → el webhook acredita 10 → se puede cotizar de nuevo.
4. Enviar el formulario de contacto → llega a abbiappo8@gmail.com.
5. Revisar mobile (mobile-first) y que la marca se vea idéntica.
