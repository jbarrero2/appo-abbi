'use strict';
/* ===================================================================
   Ap-Ab — cotizador (cliente)
   Dos opciones tras login:
     • INSTANTÁNEA: heurística pura, gratis e ilimitada (selectores).
     • ESPECÍFICA: DeepSeek genera un mockup HTML + plan; se itera por
       chat; el precio lo calcula el código (misma rúbrica); el DRA vive
       en el servidor y se envía con "Solicitud final".
   Modo LOCAL (backend_local.py) y ?demo=1 (instantánea con preview en vivo).
   =================================================================== */
(function () {
  var CFG = window.ABAB_PUBLIC || {};
  var DEMO = new URLSearchParams(location.search).get('demo') === '1';
  var configured =
    CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY &&
    CFG.SUPABASE_URL.indexOf('TU-PROYECTO') === -1 &&
    CFG.SUPABASE_ANON_KEY.indexOf('TU_ANON') === -1;
  var LOCAL = !configured && (location.hostname === '127.0.0.1' || location.hostname === 'localhost');
  var liveEnabled = DEMO || LOCAL; // preview en vivo de la instantánea

  var sb = null;
  if (configured && window.supabase) sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

  function $(id) { return document.getElementById(id); }
  function show(el) { el && el.classList.remove('hidden'); }
  function hide(el) { el && el.classList.add('hidden'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  function money(n) { return COP.format(n); }
  function range(t) { return money(t.min) + ' – ' + money(t.max); }
  function fmtDate(iso) { var p = String(iso).split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2]); return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }).format(d); }

  var LABELS = {
    tipo: { landing: 'Landing', web_o_app_sencilla: 'Web/app sencilla', app_con_backend: 'App con backend', app_compleja: 'App compleja', producto_con_ia: 'Producto con IA' },
    complejidad: { baja: 'Baja', media: 'Media', alta: 'Alta' },
    addons: { autenticacion: 'Autenticación', pagos: 'Pagos', integraciones: 'Integraciones', ia_llm: 'IA/LLM', diseno_personalizado: 'Diseño personalizado', multiplataforma: 'Multiplataforma' },
  };

  // ---------- comparador (HTML) ----------
  function comp(q) {
    var launchSub = q.launch_active ? '25% del mercado · válido hasta ' + fmtDate(q.vigencia_lanzamiento) : 'Precio Ap-Ab (promo de lanzamiento finalizada)';
    var badge = q.launch_active ? 'Precio de lanzamiento' : 'Mejor precio';
    var p = q.params || {}, parts = [];
    if (p.tipo) parts.push('Tipo: ' + (LABELS.tipo[p.tipo] || p.tipo));
    if (p.complejidad) parts.push('Complejidad: ' + (LABELS.complejidad[p.complejidad] || p.complejidad));
    if (p.addons && p.addons.length) parts.push('Add-ons: ' + p.addons.map(function (a) { return LABELS.addons[a] || a; }).join(', '));
    if (p.urgencia) parts.push('Con urgencia');
    return '' +
      '<div class="result"><div class="restitle">Tu cotización estimada</div>' +
      '<div class="tiers">' +
      '<div class="tier market"><div class="k">Tarifa promedio del mercado</div><div class="v">' + range(q.mercado) + '</div><div class="sub">Referencia del sector</div></div>' +
      '<div class="tier"><div class="k">Precio Ap-Ab</div><div class="v">' + range(q.apab) + '</div><div class="sub">50% del mercado</div></div>' +
      '<div class="tier launch"><span class="badge">' + badge + '</span><div class="k">' + badge + '</div><div class="v">' + range(q.lanzamiento) + '</div><div class="sub">' + launchSub + '</div></div>' +
      '</div>' +
      '<div class="savings">Ahorras <b>' + range(q.ahorro) + '</b> <span class="pct">(≈' + q.ahorro_pct + '%)</span> frente al mercado.</div>' +
      '<div class="pay"><div class="paycard"><div class="k">Anticipo · 20%</div><div class="amt">' + range(q.anticipo) + '</div><div class="when">Al iniciar el proyecto</div></div>' +
      '<div class="paycard"><div class="k">Saldo · 80%</div><div class="amt">' + range(q.saldo) + '</div><div class="when">Solo al entregar</div></div></div>' +
      '<div class="notes"><div class="n">› ' + esc((q.notas && q.notas[0]) || 'Precio estimado, sujeto a revisión.') + '</div><div class="n">› ' + esc(q.nota_referencia || '') + '</div></div>' +
      '<div class="params-used">' + esc(parts.join('  ·  ')) + '</div></div>';
  }
  function renderInto(id, q, scroll) {
    $(id).innerHTML = comp(q);
    if (scroll) $(id).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- mensajes / botones ----------
  function msg(id, kind, text) { var b = $(id); if (!b) return; if (!text) { b.className = 'msgbox'; b.textContent = ''; return; } b.className = 'msgbox show ' + kind; b.textContent = text; }
  function setBtn(id, busy, text) { var b = $(id); if (!b) return; if (busy) { b.dataset.prev = b.textContent; b.textContent = text; b.setAttribute('disabled', 'disabled'); } else { b.textContent = text || b.dataset.prev || b.textContent; b.removeAttribute('disabled'); } }
  function setQuota(id, data) {
    var qi = $(id); if (!qi) return; var parts = [];
    if (data.source === 'paid') parts.push('Usaste 1 crédito comprado');
    if (typeof data.remaining_free === 'number') parts.push(data.remaining_free + ' gratis restante' + (data.remaining_free === 1 ? '' : 's') + ' esta semana');
    if (data.remaining_credits > 0) parts.push(data.remaining_credits + ' crédito' + (data.remaining_credits === 1 ? '' : 's') + ' comprado' + (data.remaining_credits === 1 ? '' : 's'));
    qi.textContent = parts.join('  ·  ');
  }

  // ---------- botón comprar ----------
  function setupBuy(user) {
    var btn = $('buyBtn'); if (!btn) return;
    var link = (CFG.PAYMENT_LINK || '').trim();
    if (link) {
      var url = link;
      if (user && user.id) { var sep = url.indexOf('?') > -1 ? '&' : '?'; url += sep + 'client_reference_id=' + encodeURIComponent(user.id); if (user.email) url += '&prefilled_email=' + encodeURIComponent(user.email); }
      btn.setAttribute('href', url);
    } else {
      btn.setAttribute('href', 'https://wa.me/573185990793?text=' + encodeURIComponent('Hola, quiero comprar 10 cotizaciones específicas (US$5).'));
    }
  }

  // ---------- chips (instantánea) ----------
  function setupChips() {
    document.querySelectorAll('.chips').forEach(function (g) {
      var single = g.getAttribute('data-single') === '1';
      g.addEventListener('click', function (e) {
        var chip = e.target.closest('.chip'); if (!chip) return;
        if (single) { g.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('on'); }); chip.classList.add('on'); }
        else chip.classList.toggle('on');
        if (liveEnabled && clientCfg && !$('instantPanel').classList.contains('hidden')) renderInto('instantResult', computeClient(clientCfg, gatherInstant()), false);
      });
    });
  }
  function gv(name) { var el = document.querySelector('.chips[data-group="' + name + '"]'); if (!el) return []; return Array.prototype.map.call(el.querySelectorAll('.chip.on'), function (c) { return c.getAttribute('data-value'); }); }
  function gatherInstant() { return { tipo: gv('tipo')[0] || null, complejidad: gv('complejidad')[0] || null, plataformas: gv('plataformas'), addons: gv('addons'), urgencia: gv('urgencia')[0] === 'si' }; }

  // ---------- cálculo en cliente (preview instantánea en demo/local) ----------
  var clientCfg = null;
  function r1000c(n) { return Math.round(n / 1000) * 1000; }
  function tierC(b, rg) { return { base: r1000c(b), min: r1000c(b * rg.min), max: r1000c(b * rg.max) }; }
  function computeClient(cfg, p) {
    var rg = cfg.rango || { min: 1, max: 1 };
    var tipos = Object.keys(cfg.tarifa_mercado_por_tipo), comps = Object.keys(cfg.factor_complejidad), addok = Object.keys(cfg.addons_mercado);
    var tipo = tipos.indexOf(p.tipo) > -1 ? p.tipo : 'web_o_app_sencilla';
    var comp2 = comps.indexOf(p.complejidad) > -1 ? p.complejidad : 'media';
    var addons = (p.addons || []).filter(function (a) { return addok.indexOf(a) > -1; });
    var base = cfg.tarifa_mercado_por_tipo[tipo] * cfg.factor_complejidad[comp2] + addons.reduce(function (s, a) { return s + cfg.addons_mercado[a]; }, 0);
    if (p.urgencia) base *= (cfg.urgencia_factor || 1);
    var apab = base * cfg.factor_apab;
    var t = new Date(), today = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
    var active = today <= String(cfg.vigencia_lanzamiento);
    var lanz = active ? apab * cfg.descuento_lanzamiento : apab;
    var pct = base ? Math.round((1 - lanz / base) * 100) : 0;
    return { moneda: cfg.moneda, nota_referencia: cfg.nota_referencia, vigencia_lanzamiento: cfg.vigencia_lanzamiento, launch_active: active,
      params: { tipo: tipo, complejidad: comp2, addons: addons, plataformas: p.plataformas || [], urgencia: !!p.urgencia },
      mercado: tierC(base, rg), apab: tierC(apab, rg), lanzamiento: tierC(lanz, rg), anticipo: tierC(lanz * cfg.anticipo, rg), saldo: tierC(lanz * cfg.saldo, rg), ahorro: tierC(base - lanz, rg),
      ahorro_pct: pct, notas: ['Precio estimado, sujeto a revisión.', cfg.nota_referencia] };
  }

  // ---------- token ----------
  async function getToken() { if (LOCAL) return localStorage.getItem('apab_token'); if (!sb) return null; var s = (await sb.auth.getSession()).data.session; return s ? s.access_token : null; }

  // ---------- navegación ----------
  function showChooser() { show($('chooser')); hide($('instantPanel')); hide($('especificaPanel')); }
  function showInstant() { hide($('chooser')); show($('instantPanel')); hide($('especificaPanel')); if (liveEnabled && clientCfg) renderInto('instantResult', computeClient(clientCfg, gatherInstant()), false); }
  function showEspecifica() { hide($('chooser')); hide($('instantPanel')); show($('especificaPanel')); }

  // ---------- INSTANTÁNEA ----------
  async function doInstant() {
    msg('instantMsg', '', '');
    if (DEMO) { if (clientCfg) renderInto('instantResult', computeClient(clientCfg, gatherInstant()), true); return; }
    var token = await getToken(); if (!token) { showAuth(); return; }
    var p = gatherInstant(); if (!p.tipo) { msg('instantMsg', 'err', 'Elige un tipo de proyecto.'); return; }
    setBtn('instantBtn', true, 'Calculando…');
    try {
      var res = await fetch('/.netlify/functions/cotizar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ token: token }, p)) });
      var data = await res.json().catch(function () { return {}; });
      if (res.status === 200 && data.ok) renderInto('instantResult', data.quote, true);
      else if (res.status === 401) { showAuth(); msg('instantMsg', 'err', 'Tu sesión expiró. Entra de nuevo.'); }
      else msg('instantMsg', 'err', 'No se pudo calcular. Inténtalo de nuevo.');
    } catch (e) { msg('instantMsg', 'err', 'Error de conexión.'); }
    finally { setBtn('instantBtn', false, 'Cotización instantánea →'); }
  }

  // ---------- ESPECÍFICA ----------
  var espSession = { id: null, itersLeft: 12 };
  function especificaAvailable() { return CFG.ESPECIFICA_ENABLED !== false && !DEMO; }
  function addChat(role, text) { var d = document.createElement('div'); d.className = 'm ' + (role === 'user' ? 'user' : 'ai'); d.textContent = text; $('espChatLog').appendChild(d); $('espChatLog').scrollTop = $('espChatLog').scrollHeight; }
  function updateIters() { var n = espSession.itersLeft; $('espIters').textContent = n > 0 ? ('Te quedan ' + n + ' ajustes en esta sesión.') : 'Llegaste al máximo de ajustes. Envía la solicitud final.'; }
  function espChildren(fn) { Array.prototype.forEach.call($('espResultWrap').children, fn); }
  function renderEsp(data) {
    show($('espResultWrap')); espChildren(function (ch) { ch.classList.remove('hidden'); });
    $('mockupFrame').srcdoc = data.mockup_html || '<!doctype html><body style="background:#0a0b08;color:#9a988a;font-family:sans-serif;padding:24px">Sin vista previa.</body>';
    $('espResult').innerHTML = comp(data.quote);
    updateIters();
  }
  function showBuyOnly() { show($('espResultWrap')); espChildren(function (ch) { if (ch.id !== 'buyRow') ch.classList.add('hidden'); }); }

  async function espGenerate() {
    msg('espMsg', '', '');
    if (DEMO) { msg('espMsg', 'warn', 'La cotización específica (IA) requiere iniciar sesión. Aquí en el ejemplo puedes probar la instantánea.'); return; }
    if (!especificaAvailable()) { msg('espMsg', 'warn', 'La específica no está disponible ahora mismo.'); return; }
    var token = await getToken(); if (!token) { showAuth(); return; }
    var text = $('espText').value.trim();
    if (text.length < 12) { msg('espMsg', 'err', 'Describe tu proyecto con un poco más de detalle (mínimo una frase).'); return; }
    setBtn('espGenBtn', true, 'Generando… (puede tardar ~20s)');
    try {
      var res = await fetch('/.netlify/functions/cotizar-especifica', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token, action: 'start', text: text }) });
      var data = await res.json().catch(function () { return {}; });
      if (res.status === 200 && data.ok) {
        espSession.id = data.session_id; espSession.itersLeft = (data.iters_left != null ? data.iters_left : 12);
        renderEsp(data); setQuota('espQuota', data);
        $('espChatLog').innerHTML = ''; addChat('user', text); addChat('ai', 'Generé una primera versión. Pídeme ajustes o envía la solicitud final.');
      } else if (res.status === 401) { showAuth(); msg('espMsg', 'err', 'Tu sesión expiró. Entra de nuevo.'); }
      else if (res.status === 429) { var when = data.next_available ? fmtDate(data.next_available.slice(0, 10)) : 'pronto'; msg('espMsg', 'warn', 'Usaste tus 2 cotizaciones específicas de esta semana (se renuevan el ' + when + '). Compra 10 por US$5 con el botón de abajo.'); showBuyOnly(); }
      else if (res.status === 503) msg('espMsg', 'warn', 'La cotización específica aún no está activa (falta la API key de DeepSeek en el backend).');
      else msg('espMsg', 'err', data.error === 'ai_error' ? 'La IA no pudo generar el plan. Inténtalo de nuevo.' : 'No se pudo generar. Inténtalo de nuevo.');
    } catch (e) { msg('espMsg', 'err', 'Error de conexión.'); }
    finally { setBtn('espGenBtn', false, 'Generar plan y cotización →'); }
  }

  async function espIterate() {
    var text = $('espChatInput').value.trim(); if (!text || !espSession.id) return;
    var token = await getToken(); if (!token) { showAuth(); return; }
    $('espChatInput').value = ''; addChat('user', text); setBtn('espChatBtn', true, '…');
    try {
      var res = await fetch('/.netlify/functions/cotizar-especifica', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token, action: 'iterate', session_id: espSession.id, text: text }) });
      var data = await res.json().catch(function () { return {}; });
      if (res.status === 200 && data.ok) { espSession.itersLeft = (data.iters_left != null ? data.iters_left : espSession.itersLeft); renderEsp(data); addChat('ai', 'Listo, actualicé la vista previa y el precio.'); }
      else if (res.status === 429) { addChat('ai', 'Llegamos al máximo de ajustes de esta sesión. Envía la solicitud final y seguimos contigo.'); espSession.itersLeft = 0; updateIters(); }
      else if (res.status === 401) { showAuth(); }
      else addChat('ai', 'No pude aplicar ese cambio, inténtalo de nuevo.');
    } catch (e) { addChat('ai', 'Error de conexión.'); }
    finally { setBtn('espChatBtn', false, 'Enviar'); }
  }

  async function solicitudFinal() {
    if (!espSession.id) return;
    var token = await getToken(); if (!token) { showAuth(); return; }
    setBtn('solicitudBtn', true, 'Enviando…');
    try {
      var res = await fetch('/.netlify/functions/solicitud-final', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token, session_id: espSession.id }) });
      var data = await res.json().catch(function () { return {}; });
      if (res.status === 200 && data.ok) {
        try { var fd = new URLSearchParams({ 'form-name': 'solicitud', email: data.email || '', proyecto: data.nombre_proyecto || '', mensaje: 'Nueva solicitud de cotización específica. Requerimientos en Supabase (tabla solicitudes).' }); fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: fd.toString() }); } catch (_) {}
        msg('espMsg', 'warn', '¡Solicitud enviada! Recibimos tus requerimientos y te contactamos pronto.');
        setBtn('solicitudBtn', false, 'Solicitud enviada ✓'); $('solicitudBtn').setAttribute('disabled', 'disabled');
        return;
      } else if (res.status === 401) { showAuth(); msg('espMsg', 'err', 'Tu sesión expiró.'); }
      else msg('espMsg', 'err', 'No se pudo enviar la solicitud. Inténtalo de nuevo o escríbenos.');
    } catch (e) { msg('espMsg', 'err', 'Error de conexión.'); }
    setBtn('solicitudBtn', false, 'Enviar solicitud final →');
  }

  // ---------- vistas / auth ----------
  function showApp(email) { hide($('authView')); show($('appView')); showChooser(); if (email) { $('acctEmail').textContent = email; show($('acctEmail')); show($('logoutBtn')); } }
  function showAuth() { show($('authView')); hide($('appView')); hide($('acctEmail')); hide($('logoutBtn')); }

  var mode = 'login';
  function setMode(m) { mode = m; $('tabLogin').classList.toggle('on', m === 'login'); $('tabSignup').classList.toggle('on', m === 'signup'); $('authSubmit').textContent = m === 'login' ? 'Entrar →' : 'Crear cuenta →'; $('password').setAttribute('autocomplete', m === 'login' ? 'current-password' : 'new-password'); authMsg(''); }
  function authMsg(text, ok) { var b = $('authMsg'); if (!text) { b.className = 'formmsg'; b.textContent = ''; return; } b.className = 'formmsg ' + (ok ? 'ok' : 'err'); b.textContent = text; }

  async function submitAuth() {
    if (!sb && !LOCAL) { authMsg('Configura Supabase en assets/supabase-config.js (ver README).'); return; }
    var email = $('email').value.trim(), password = $('password').value;
    if (!email || password.length < 6) { authMsg('Correo válido y contraseña de al menos 6 caracteres.'); return; }
    setBtn('authSubmit', true, 'Un momento…');
    try {
      if (LOCAL) {
        var rl = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: password, mode: mode }) });
        var dl = await rl.json().catch(function () { return {}; });
        if (!rl.ok || !dl.token) { authMsg(dl.error_es || 'No se pudo iniciar sesión.'); return; }
        localStorage.setItem('apab_token', dl.token); localStorage.setItem('apab_email', email);
        showApp(email); setupBuy({ id: email, email: email }); return;
      }
      if (mode === 'login') {
        var r = await sb.auth.signInWithPassword({ email: email, password: password });
        if (r.error) { authMsg(translateAuthError(r.error.message)); return; }
        showApp(email);
      } else {
        var s = await sb.auth.signUp({ email: email, password: password });
        if (s.error) { authMsg(translateAuthError(s.error.message)); return; }
        if (s.data && s.data.session) showApp(email);
        else { authMsg('¡Cuenta creada! Revisa tu correo para confirmarla y luego entra.', true); setMode('login'); }
      }
    } catch (e) { authMsg('No pudimos procesar la solicitud. Inténtalo de nuevo.'); }
    finally { setBtn('authSubmit', false, mode === 'login' ? 'Entrar →' : 'Crear cuenta →'); }
  }
  function translateAuthError(m) {
    m = (m || '').toLowerCase();
    if (m.indexOf('invalid login') > -1) return 'Correo o contraseña incorrectos.';
    if (m.indexOf('already registered') > -1 || m.indexOf('already been registered') > -1) return 'Ese correo ya tiene cuenta. Entra con tu contraseña.';
    if (m.indexOf('email not confirmed') > -1) return 'Confirma tu correo antes de entrar (revisa tu bandeja).';
    if (m.indexOf('password') > -1) return 'La contraseña debe tener al menos 6 caracteres.';
    return 'No se pudo: ' + m;
  }

  // ---------- init ----------
  function init() {
    setupChips(); setupBuy(null);
    $('chooseInstant').addEventListener('click', showInstant);
    $('chooseEspecifica').addEventListener('click', showEspecifica);
    $('backFromInstant').addEventListener('click', showChooser);
    $('backFromEsp').addEventListener('click', showChooser);
    $('instantBtn').addEventListener('click', doInstant);
    $('espGenBtn').addEventListener('click', espGenerate);
    $('espChatBtn').addEventListener('click', espIterate);
    $('espChatInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); espIterate(); } });
    $('solicitudBtn').addEventListener('click', solicitudFinal);
    $('tabLogin').addEventListener('click', function () { setMode('login'); });
    $('tabSignup').addEventListener('click', function () { setMode('signup'); });
    $('authForm').addEventListener('submit', function (e) { e.preventDefault(); submitAuth(); });
    if ($('logoutBtn')) $('logoutBtn').addEventListener('click', async function () { if (LOCAL) { localStorage.removeItem('apab_token'); localStorage.removeItem('apab_email'); showAuth(); return; } if (sb) await sb.auth.signOut(); showAuth(); });

    if (liveEnabled) fetch('config.json').then(function (r) { return r.json(); }).then(function (cfg) { clientCfg = cfg; if (!$('instantPanel').classList.contains('hidden')) renderInto('instantResult', computeClient(clientCfg, gatherInstant()), false); }).catch(function () {});

    if (DEMO) { show($('demoBanner')); showApp(null); return; }

    if (LOCAL) {
      var ln = $('configNotice'); ln.innerHTML = '<b>Modo local de pruebas.</b> Login y cotizador con backend local. La instantánea funciona sin costos; la específica necesita tu DEEPSEEK_API_KEY en el .env local.'; show(ln);
      var tk = localStorage.getItem('apab_token');
      if (tk) { showApp(localStorage.getItem('apab_email')); setupBuy({ id: localStorage.getItem('apab_email'), email: localStorage.getItem('apab_email') }); } else showAuth();
      return;
    }

    if (!configured) { var n = $('configNotice'); n.innerHTML = '<b>Falta conectar Supabase.</b> Edita <code>assets/supabase-config.js</code> (ver README). Mientras, prueba el <a href="?demo=1" style="color:var(--ember)">modo ejemplo</a>.'; show(n); showAuth(); return; }

    sb.auth.getSession().then(function (r) { var s = r.data.session; if (s) { showApp(s.user && s.user.email); setupBuy(s.user); } else showAuth(); });
    sb.auth.onAuthStateChange(function (_e, session) { if (session) { showApp(session.user && session.user.email); setupBuy(session.user); } else showAuth(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
