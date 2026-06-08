# Ap-Ab — Traspaso para el arquitecto

> Web-app de **Ap-Ab** (compañía de software, Bogotá): landing + login + cotizador con DOS modos.
> Corre en **planes gratuitos** (Netlify + Supabase); el único costo variable es **DeepSeek** (solo en la
> cotización específica) y la comisión de **Stripe** (solo si venden el pack). El código está listo y
> probado en local; faltan **cuentas, claves y el despliegue**. Todo lo secreto va en variables de entorno,
> nunca en el repo. La marca/diseño NO se tocan.

---

## 1) Arquitectura
| Capa | Servicio | Plan |
|---|---|---|
| Hosting + Functions + Forms | **Netlify** | Free |
| Auth + Postgres | **Supabase** | Free (proyecto ya creado: `tcqnangrmpeboykjtmjo`) |
| LLM de la específica | **DeepSeek** (`deepseek-chat`, OpenAI-compatible) | pago por uso |
| Pago del pack US$5 | **Stripe** (Payment Link + webhook) | comisión por venta |

Sin framework ni build: HTML/CSS/JS plano + Supabase JS por CDN. Funciones Node sin dependencias (solo
`fetch` y `crypto` nativos), empaquetadas por esbuild.

## 2) Las dos cotizaciones (tras login)
- **Instantánea** — heurística pura con `config.json`. **Gratis e ILIMITADA**. Sin IA. Función `cotizar.js`.
- **Específica** — con **DeepSeek**: genera un **mockup HTML** (el cliente lo ajusta por chat), arma un
  **MASTER DRA** (documento de requerimientos, **oculto al cliente**, vive en `quote_sessions`) y calcula
  el **precio con la misma rúbrica**. Límite **2/semana + pack de 10 por US$5** (el pack aplica SOLO aquí).
  Al pulsar **"Solicitud final"** se guarda el lead (DRA + params) en Supabase `solicitudes` y se envía un
  correo de aviso (Netlify Forms `solicitud`). Funciones `cotizar-especifica.js` y `solicitud-final.js`.
- **El precio SIEMPRE lo calcula el código** (`lib/pricing.js` + `config.json`), nunca el LLM.

## 3) Mapa de archivos
```
index.html                         Landing (marca + confianza) + form de contacto (Netlify Forms)
cotizador.html                     Login + selector (instantánea / específica) + mockup + chat
styles.css                         Marca compartida
config.json                        RÚBRICA de precios (editable)
assets/supabase-config.js          PÚBLICO: SUPABASE_URL + ANON_KEY + ESPECIFICA_ENABLED + PAYMENT_LINK
assets/cotizador.js                Lógica del cotizador (cliente)
netlify/functions/
  cotizar.js                       Instantánea (auth + precio determinista, ilimitada)
  cotizar-especifica.js            Específica (DeepSeek -> mockup + DRA + precio; 2/sem + créditos)
  solicitud-final.js               Guarda el lead en Supabase 'solicitudes'
  stripe-webhook.js                Acredita el pack (idempotente + anti-replay)
  lib/pricing.js                   Cálculo determinista (función pura)
schema.sql                         Tablas + funciones (correr en Supabase)
netlify.toml · .env.example · README.md
backend_local.py · serve.py        Solo pruebas locales (no se despliegan)
```

## 4) Base de datos (`schema.sql` — idempotente, re-correr es seguro)
- Tablas: `quote_limits` (cupo 2/sem + créditos), `processed_webhooks` (idempotencia de pagos),
  `quote_sessions` (DRA server-side de la específica), `solicitudes` (leads finales).
- Funciones: `consume_quote` (descuenta cupo ATÓMICO, sin carreras), `credit_purchase`
  (acredita el pack IDEMPOTENTE por `event.id`), `add_quote_credits` (acreditar manual).

---

## 5) ✅ TODO — Despliegue (lo que falta)

### A. Supabase
1. (Ya hay proyecto `tcqnangrmpeboykjtmjo`.) **SQL Editor** → pegar y correr **`schema.sql`** completo.
2. **Authentication → Email**: activado. Recomendado desactivar "Confirm email" (menos fricción).
3. **Project Settings → API**: copiar **service_role** (secreta) para Netlify. (La URL + anon ya están en
   `assets/supabase-config.js`.)

### B. Netlify — deploy + variables de entorno
Importar el repo (o arrastrar la carpeta). En **Site → Settings → Environment variables**:
| Variable | Valor |
|---|---|
| `SUPABASE_URL` | `https://tcqnangrmpeboykjtmjo.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | la **service_role** (secreta) |
| `DEEPSEEK_API_KEY` | la key de DeepSeek (Jerónimo la tiene; **solo backend**) |
| `DEEPSEEK_MODEL` | `deepseek-chat` |
| `STRIPE_WEBHOOK_SECRET` | (cuando conecten el pack) `whsec_...` |
| `PACK_SIZE` | (opcional) `10` |
Luego: **Deploys → Trigger deploy → Clear cache and deploy**.

### C. Netlify Forms → correo
Dos formularios llegan a **abbiappo8@gmail.com** (Forms → notifications → Email):
- `contacto` (formulario de la landing).
- `solicitud` (aviso de "Solicitud final"; el detalle completo queda en Supabase `solicitudes`).

### D. Pago del pack (10 específicas · US$5) — Stripe
1. Crear un **Payment Link** de US$5 y pegarlo en `assets/supabase-config.js` → `PAYMENT_LINK`
   (el sitio le añade `?client_reference_id=<id de usuario>`).
2. **Webhook** → `https://TU-SITIO.netlify.app/.netlify/functions/stripe-webhook`, evento
   `checkout.session.completed`; copiar el signing secret a `STRIPE_WEBHOOK_SECRET`.
3. `stripe-webhook.js` ya verifica firma, **rechaza réplicas (±5 min)** y acredita con
   `credit_purchase(event.id, user, 10)` (idempotente: reenvíos NO acreditan doble).
   Si dejan `PAYMENT_LINK` vacío, el botón coordina el pago por WhatsApp y se acredita a mano:
   `select add_quote_credits('<uuid>', 10);`

### E. Git / dominio
- Repo: **github.com/jbarrero2/appo-abbi** (commits listos en `main`, falta `git push`).
- Conectar dominio en Netlify (HTTPS automático).

### F. APPO Planner (pipeline interno, aparte)
`APPO_Planner_MOD.zip` — servidor Python/FastAPI cuyo prompt ya emite el **contrato MASTER DRA** y usa
`deepseek-chat`. Es independiente de la web; alimenta a APPO con el plano. Correr: `pip install -r
requirements.txt`, `DEEPSEEK_API_KEY` en `.env`, `uvicorn main:app`.

---

## 6) Contratos de API (functions)
```jsonc
// POST /.netlify/functions/cotizar  (instantánea)
req:  { token, tipo, complejidad, plataformas[], addons[], urgencia }
res:  { ok, mode:"instantanea", quote }

// POST /.netlify/functions/cotizar-especifica
req:  { token, action:"start"|"iterate", text, session_id? }
res(start):    { ok, session_id, mockup_html, nombre_proyecto, quote, source, remaining_free, remaining_credits, iters_left }
res(iterate):  { ok, mockup_html, quote, nombre_proyecto, iter_count, iters_left }
errores: 401 sesión · 429 rate_limited(+can_buy) · 503 especifica_unavailable(falta key) · 502 ai_error

// POST /.netlify/functions/solicitud-final
req:  { token, session_id }   res: { ok, nombre_proyecto, email, quote }   // guarda en 'solicitudes'

// POST /.netlify/functions/stripe-webhook   (Stripe -> acredita +10, idempotente)
```
`quote` = niveles `{base,min,max}` para mercado/apab/lanzamiento/anticipo/saldo/ahorro + `ahorro_pct` + `params`.

## 7) Seguridad (cumplido en el código)
- `service_role`, `DEEPSEEK_API_KEY`, secretos de Stripe → **solo** en env del backend. La `anon` es pública.
- `.env` está **gitignored** (no entra al repo). El ZIP de entrega tampoco lo incluye.
- Límite **atómico** (`consume_quote` con `SELECT … FOR UPDATE`) → sin carreras entre pestañas.
- Webhook **idempotente** (dedupe por `event.id`) + **anti-replay**.
- El **MASTER DRA** vive server-side (`quote_sessions`); al cliente solo le llega el mockup + el precio.
- Sin login no hay cotización; la instantánea es ilimitada, la específica 2/semana + pack.

## 8) Checklist de prueba post-deploy
1. Registro + login.
2. **Instantánea**: cambiar opciones → precio inmediato (ilimitado).
3. **Específica**: describir un proyecto → mockup + precio; ajustar por chat; a la 3ª de la semana → aviso + pack.
4. **Solicitud final** → llega correo a abbiappo8@gmail.com y queda fila en Supabase `solicitudes`.
5. (Si Stripe) pagar en test → webhook acredita 10 → vuelve a poder cotizar específicas.
6. Revisar mobile y que la marca se vea idéntica.
```text
Probar la específica en local (dev): poner DEEPSEEK_API_KEY en un .env y abrir "Ap-Ab — Probar.command".
```
