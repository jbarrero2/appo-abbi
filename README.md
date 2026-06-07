# Ap-Ab — Web-app (landing + login + cotizador)

Sitio de **Ap-Ab** evolucionado de landing estática a web-app, **manteniendo la misma marca**.
Todo corre en **planes gratuitos**: **Netlify** (hosting + Forms + 1 Function) y **Supabase** (auth + Postgres).
El único costo posible es el **pago por uso del LLM** (Anthropic), y solo si usas el **Modo IA** del cotizador.

> Hoy ya funciona el **modo gratis** del cotizador (precio 100% por código, sin API).
> El **Modo IA** está activado en el código; solo necesita tu API key de Anthropic para operar.

---

## 🗂 Estructura

```
ap-ab-web/
├─ index.html              Landing (misma marca) + secciones de confianza + form de contacto
├─ cotizador.html          Página protegida: login/registro + cotizador + comparador
├─ styles.css              Hoja de marca compartida (edita :root para re-tematizar)
├─ config.json             RÚBRICA de precios (editable)
├─ assets/
│  ├─ supabase-config.js   ← EDITA AQUÍ tus claves PÚBLICAS de Supabase
│  └─ cotizador.js         Lógica del cotizador (cliente)
├─ netlify/functions/
│  ├─ cotizar.js           Backend: valida login + límite 7 días + IA + calcula precio
│  └─ lib/pricing.js       Cálculo determinista (función pura)
├─ netlify.toml            Config de Netlify
├─ schema.sql              SQL para Supabase (tabla del límite)
├─ .env.example            Plantilla de variables del backend (NO subir el .env real)
└─ README.md               Esta guía
```

---

## ✅ Puesta en marcha (≈20 min, todo gratis)

### 1) Supabase (auth + base de datos)
1. Entra a <https://supabase.com> → **New project** (plan Free). Guarda la contraseña de la BD.
2. Menú **SQL Editor** → **New query** → pega el contenido de [`schema.sql`](schema.sql) → **Run**.
3. (Recomendado para menos fricción) **Authentication → Providers → Email**: deja activado *Email*.
   Si quieres que la gente entre **sin confirmar correo**, en **Authentication → Sign In / Providers**
   desactiva *Confirm email*. (Si lo dejas activado, deberán confirmar por correo antes de entrar.)
4. **Project Settings → API**. Copia:
   - **Project URL** → p.ej. `https://abcdxyz.supabase.co`
   - **anon public** (clave pública) → para el cliente
   - **service_role** (clave **SECRETA**) → para el backend (Netlify)

### 2) Conecta el cliente
Edita **`assets/supabase-config.js`** y reemplaza:
```js
SUPABASE_URL: "https://TU-PROYECTO.supabase.co",   // tu Project URL
SUPABASE_ANON_KEY: "TU_ANON_KEY_PUBLICA",          // tu anon public
AI_MODE_ENABLED: true                               // true = muestra el Asistente IA
```
> La `anon key` es pública por diseño (la protege RLS). **No** pongas aquí la `service_role` ni la key de Anthropic.

### 3) Despliega en Netlify
**Opción simple (sin git):**
1. Entra a <https://app.netlify.com> → **Add new site → Deploy manually**.
2. Arrastra la carpeta `ap-ab-web/` completa. Listo: tienes HTTPS gratis.

**Opción con git (recomendada para actualizar fácil):** sube la carpeta a un repo y **Add new site → Import**.

### 4) Variables de entorno del backend (Netlify)
En **Site → Settings → Environment variables**, agrega (ver [`.env.example`](.env.example)):

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | tu Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | la **service_role** (secreta) |
| `AI_MODE_ENABLED` | `true` |
| `ANTHROPIC_API_KEY` | tu key de <https://console.anthropic.com> |
| `ANTHROPIC_MODEL` | `claude-haiku-4-5` (verifica el string vigente en docs.claude.com) |
| `STRIPE_WEBHOOK_SECRET` | (opcional) para el paquete de 10 · US$5 — lo conecta tu arquitecto |
| `PACK_SIZE` | (opcional) `10` |

Tras agregarlas, haz **Deploys → Trigger deploy → Clear cache and deploy**.

### 5) Formulario de contacto → tu correo
El form ya usa **Netlify Forms** (gratis). Para recibir los mensajes en **abbiappo8@gmail.com**:
- Netlify → **Forms** → (verás el form `contacto` tras el primer envío) → **Settings → Form notifications**
  → **Add notification → Email notification** → pon `abbiappo8@gmail.com`.

> Nota: Netlify Forms solo funciona en el sitio **desplegado** (no en local con `file://`).

---

## 🧮 El cotizador

- **Sin login no se cotiza.** El usuario crea cuenta o entra (Supabase).
- **Modo gratis (por defecto):** elige tipo, plataformas, complejidad, add-ons y urgencia.
  El precio lo calcula el **código** con [`config.json`](config.json) — **cero costo de API**.
- **Modo IA (opcional):** activa *"Autocompletar con IA"*, describe el proyecto en texto libre y la
  función llama a Anthropic **solo para extraer parámetros** (JSON). **El precio siempre lo calcula el código.**
- **Límite:** **2 cotizaciones rápidas gratis por semana** por usuario, validado en el **servidor** (tabla `quote_limits`). Quien necesite más puede **comprar 10 por US$5** (créditos que no caducan).

### Comparador (3 niveles, de mayor a menor)
1. **Tarifa promedio del mercado** (referencia, en gris/tachada)
2. **Precio Ap-Ab** = 50% del mercado
3. **Precio de lanzamiento** = 25% del mercado → destacado, degradado ember→dorado
   + *"Ahorras $X (≈75%) frente al mercado"* y *"20% al iniciar / 80% al entregar"*.
   Todo se muestra como **rango** (min/max del config).

### Editar precios
Abre [`config.json`](config.json) y cambia los valores (tarifas por tipo, factores, add-ons, vigencia, etc.).
Redeploya y listo. La fórmula está documentada en [`netlify/functions/lib/pricing.js`](netlify/functions/lib/pricing.js).

### Apagar el Modo IA (volver a 100% gratis)
Pon `AI_MODE_ENABLED=false` en Netlify **y** `AI_MODE_ENABLED: false` en `assets/supabase-config.js`. Redeploy.

### Paquete de pago (10 cotizaciones rápidas · US$5)
La parte de "internet/pago" la integra tu arquitecto (ver **[HANDOFF.md](HANDOFF.md)**). Resumen:
1. Crea un **Payment Link** de US$5 en Stripe y pégalo en `assets/supabase-config.js` → `PAYMENT_LINK`.
2. Conecta el webhook `stripe-webhook` (evento `checkout.session.completed`) y pon `STRIPE_WEBHOOK_SECRET` en Netlify.
3. Al pagar, el webhook acredita **+10** al usuario (función `add_quote_credits` de `schema.sql`).
Si dejas `PAYMENT_LINK` vacío, el botón abre WhatsApp para coordinar el pago manualmente.

---

## 👀 Ver el diseño sin configurar nada
Abre **`cotizador.html?demo=1`**: muestra el cotizador con una cotización de **ejemplo** (sin login).
La cotización **real** siempre exige login + servidor.

## 🧪 Probar en local

**Opción fácil (sin configurar nada) — `backend_local.py`:**
Doble clic al archivo del Escritorio **`Ap-Ab — Probar.command`** (o `python3 backend_local.py 4321 open`).
Levanta la UI **y** un backend local que hace login y cotizador de prueba con la MISMA rúbrica
(`config.json`), sin Supabase ni costos. Ideal para **ajustar precios**: edita `config.json`, vuelve a
cotizar y ves el cambio al instante (lee el config en caliente). El límite 2/semana viene apagado para
probar libre; actívalo con `APAB_ENFORCE_LIMIT=1 python3 backend_local.py`. Es solo para pruebas: NO se
despliega (el `.gitignore` excluye `.local_data.json`).

**Opción fiel a producción — Netlify CLI:**
Con la [Netlify CLI](https://docs.netlify.com/cli/get-started/): `netlify dev` levanta el sitio y las
Functions reales en `http://localhost:8888`. Necesitas un `.env` local (copia de `.env.example`) y las
claves en `assets/supabase-config.js`.

---

## 🔒 Seguridad (criterios cumplidos)
- La **API key de Anthropic** y la **service_role** viven **solo** en variables de entorno del backend.
- El **límite (2 gratis/semana + créditos)** se valida en el **servidor** (no se puede saltar desde el navegador).
- **Sin login no hay cotización real.** El `?demo=1` es solo una vista de diseño.
- HTTPS gratis con Netlify. Sitio mobile-first y liviano (carga rápida).

## 💵 Costos
- Netlify Free: hosting + 100 envíos/mes de Forms + 125k invocaciones/mes de Functions.
- Supabase Free: auth + Postgres.
- Anthropic: **solo** si usas el Modo IA. Con `claude-haiku-4-5` y `max_tokens` bajo, cada extracción
  cuesta una fracción de centavo. El límite de 2/semana por usuario acota el gasto casi a cero.
