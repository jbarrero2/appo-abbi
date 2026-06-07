'use strict';
/* ===================================================================
   Ap-Ab — lógica del cotizador (cliente)
   - Producción: autenticación con Supabase + Netlify Function.
   - Modo LOCAL de pruebas (backend_local.py en localhost): login y
     cotizador locales, sin costos, con la MISMA rúbrica (config.json).
   - El precio "oficial" SIEMPRE lo calcula el servidor (local o Netlify).
   - En modo prueba (demo o local) el precio se RECALCULA EN VIVO al
     cambiar los selectores (vista previa cliente con config.json).
   - ?demo=1: vista interactiva sin login (solo para explorar precios).
   =================================================================== */
(function () {
  var CFG = window.ABAB_PUBLIC || {};
  var DEMO = new URLSearchParams(location.search).get('demo') === '1';
  var AI_AVAILABLE = CFG.AI_MODE_ENABLED === true;

  var configured =
    CFG.SUPABASE_URL &&
    CFG.SUPABASE_ANON_KEY &&
    CFG.SUPABASE_URL.indexOf('TU-PROYECTO') === -1 &&
    CFG.SUPABASE_ANON_KEY.indexOf('TU_ANON') === -1;

  // Modo local de pruebas: sin Supabase y en localhost -> backend_local.py.
  var LOCAL = !configured && (location.hostname === '127.0.0.1' || location.hostname === 'localhost');
  if (LOCAL) AI_AVAILABLE = false; // el backend local no usa IA

  // Vista previa en vivo (recalcular al cambiar selectores) solo en pruebas.
  var liveEnabled = DEMO || LOCAL;

  var sb = null;
  if (configured && window.supabase) {
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  }

  // ---------- helpers de DOM ----------
  function $(id) { return document.getElementById(id); }
  function show(el) { el && el.classList.remove('hidden'); }
  function hide(el) { el && el.classList.add('hidden'); }

  // ---------- formato de dinero / fecha ----------
  var COP = new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0,
  });
  function money(n) { return COP.format(n); }
  function range(t) { return money(t.min) + ' – ' + money(t.max); }
  function fmtDate(iso) {
    var p = String(iso).split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  }

  var LABELS = {
    tipo: {
      landing: 'Landing', web_o_app_sencilla: 'Web/app sencilla', app_con_backend: 'App con backend',
      app_compleja: 'App compleja', producto_con_ia: 'Producto con IA',
    },
    complejidad: { baja: 'Baja', media: 'Media', alta: 'Alta' },
    addons: {
      autenticacion: 'Autenticación', pagos: 'Pagos', integraciones: 'Integraciones',
      ia_llm: 'IA/LLM', diseno_personalizado: 'Diseño personalizado', multiplataforma: 'Multiplataforma',
    },
  };

  // ---------- botón "Comprar 10 · US$5" ----------
  function setupBuy(user) {
    var btn = $('buyBtn');
    if (!btn) return;
    var link = (CFG.PAYMENT_LINK || '').trim();
    if (link) {
      var url = link;
      if (user && user.id) {
        var sep = url.indexOf('?') > -1 ? '&' : '?';
        url += sep + 'client_reference_id=' + encodeURIComponent(user.id);
        if (user.email) url += '&prefilled_email=' + encodeURIComponent(user.email);
      }
      btn.setAttribute('href', url);
    } else {
      btn.setAttribute('href', 'https://wa.me/573185990793?text=' +
        encodeURIComponent('Hola, quiero comprar 10 cotizaciones rápidas (US$5).'));
    }
  }

  function setQuota(data) {
    var qi = $('quotaInfo');
    if (!qi) return;
    if (!data) { qi.textContent = ''; return; }
    var parts = [];
    if (data.source === 'paid') parts.push('Usaste 1 crédito comprado');
    if (typeof data.remaining_free === 'number') {
      parts.push(data.remaining_free + ' gratis restante' + (data.remaining_free === 1 ? '' : 's') + ' esta semana');
    }
    if (data.remaining_credits > 0) {
      parts.push(data.remaining_credits + ' crédito' + (data.remaining_credits === 1 ? '' : 's') + ' comprado' + (data.remaining_credits === 1 ? '' : 's'));
    }
    qi.textContent = parts.join('  ·  ');
  }

  // ---------- selección de chips ----------
  function setupChips() {
    document.querySelectorAll('.chips').forEach(function (groupEl) {
      var single = groupEl.getAttribute('data-single') === '1';
      groupEl.addEventListener('click', function (e) {
        var chip = e.target.closest('.chip');
        if (!chip) return;
        if (single) {
          groupEl.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('on'); });
          chip.classList.add('on');
        } else {
          chip.classList.toggle('on');
        }
        // Vista previa en vivo (solo en demo/local): recalcula al instante.
        if (liveEnabled && clientCfg) livePreview(false);
      });
    });
  }

  function groupValues(name) {
    var el = document.querySelector('.chips[data-group="' + name + '"]');
    if (!el) return [];
    return Array.prototype.map.call(el.querySelectorAll('.chip.on'), function (c) {
      return c.getAttribute('data-value');
    });
  }
  function groupValue(name) { return groupValues(name)[0] || null; }

  function gatherParams() {
    return {
      tipo: groupValue('tipo'),
      complejidad: groupValue('complejidad'),
      plataformas: groupValues('plataformas'),
      addons: groupValues('addons'),
      urgencia: groupValue('urgencia') === 'si',
      idea: ($('idea').value || '').trim(),
    };
  }

  // ---------- render del comparador ----------
  function renderQuote(q, opts) {
    opts = opts || {};
    $('rMarket').textContent = range(q.mercado);
    $('rApab').textContent = range(q.apab);
    $('rLaunch').textContent = range(q.lanzamiento);

    if (q.launch_active) {
      $('rBadge').textContent = 'Precio de lanzamiento';
      $('rLaunchSub').textContent = '25% del mercado · válido hasta ' + fmtDate(q.vigencia_lanzamiento);
    } else {
      $('rBadge').textContent = 'Mejor precio';
      $('rLaunchSub').textContent = 'Precio Ap-Ab (la promo de lanzamiento finalizó)';
    }

    $('rSavings').textContent = range(q.ahorro);
    $('rSavingsPct').textContent = '(≈' + q.ahorro_pct + '%)';
    $('rDeposit').textContent = range(q.anticipo);
    $('rBalance').textContent = range(q.saldo);
    $('rNote1').textContent = (q.notas && q.notas[0]) || 'Precio estimado, sujeto a revisión.';
    $('rNote2').textContent = q.nota_referencia || '';

    var p = q.params || {};
    var parts = [];
    if (p.tipo) parts.push('Tipo: ' + (LABELS.tipo[p.tipo] || p.tipo));
    if (p.complejidad) parts.push('Complejidad: ' + (LABELS.complejidad[p.complejidad] || p.complejidad));
    if (p.addons && p.addons.length) {
      parts.push('Add-ons: ' + p.addons.map(function (a) { return LABELS.addons[a] || a; }).join(', '));
    }
    if (p.urgencia) parts.push('Con urgencia');
    var extra = opts.aiUsed ? '  ·  parámetros sugeridos por IA' : '';
    $('rParams').textContent = parts.join('  ·  ') + extra;

    var r = $('result');
    r.classList.add('show');
    if (!opts.noScroll) r.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- mensajes ----------
  function msg(kind, text) {
    var box = $('msgBox');
    box.className = 'msgbox show ' + kind;
    box.textContent = text;
  }
  function clearMsg() { var b = $('msgBox'); b.className = 'msgbox'; b.textContent = ''; }

  // ---------- cálculo en cliente (SOLO vista previa demo/local) ----------
  // Réplica exacta de netlify/functions/lib/pricing.js para mostrar el
  // precio en vivo mientras se prueba. El precio oficial lo da el servidor.
  var clientCfg = null;
  function r1000c(n) { return Math.round(n / 1000) * 1000; }
  function tierC(b, rg) { return { base: r1000c(b), min: r1000c(b * rg.min), max: r1000c(b * rg.max) }; }
  function computeClient(cfg, p) {
    var rg = cfg.rango || { min: 1, max: 1 };
    var tipos = Object.keys(cfg.tarifa_mercado_por_tipo);
    var comps = Object.keys(cfg.factor_complejidad);
    var addok = Object.keys(cfg.addons_mercado);
    var tipo = tipos.indexOf(p.tipo) > -1 ? p.tipo : 'web_o_app_sencilla';
    var comp = comps.indexOf(p.complejidad) > -1 ? p.complejidad : 'media';
    var addons = (p.addons || []).filter(function (a) { return addok.indexOf(a) > -1; });
    var base = cfg.tarifa_mercado_por_tipo[tipo] * cfg.factor_complejidad[comp] +
      addons.reduce(function (s, a) { return s + cfg.addons_mercado[a]; }, 0);
    if (p.urgencia) base *= (cfg.urgencia_factor || 1);
    var apab = base * cfg.factor_apab;
    var t = new Date();
    var today = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
    var active = today <= String(cfg.vigencia_lanzamiento);
    var lanz = active ? apab * cfg.descuento_lanzamiento : apab;
    var pct = base ? Math.round((1 - lanz / base) * 100) : 0;
    return {
      moneda: cfg.moneda, nota_referencia: cfg.nota_referencia, vigencia_lanzamiento: cfg.vigencia_lanzamiento,
      launch_active: active,
      params: { tipo: tipo, complejidad: comp, addons: addons, plataformas: p.plataformas || [], urgencia: !!p.urgencia },
      mercado: tierC(base, rg), apab: tierC(apab, rg), lanzamiento: tierC(lanz, rg),
      anticipo: tierC(lanz * cfg.anticipo, rg), saldo: tierC(lanz * cfg.saldo, rg), ahorro: tierC(base - lanz, rg),
      ahorro_pct: pct, notas: ['Precio estimado, sujeto a revisión.', cfg.nota_referencia],
    };
  }
  function livePreview(scroll) {
    if (!clientCfg) return;
    var p = gatherParams();
    if (!p.tipo) return;
    renderQuote(computeClient(clientCfg, p), { noScroll: !scroll });
    setQuota({ remaining_free: DEMO ? 1 : 2, remaining_credits: 0 });
  }

  // ---------- token (Supabase o backend local) ----------
  async function getToken() {
    if (LOCAL) return localStorage.getItem('apab_token');
    if (!sb) return null;
    var s = (await sb.auth.getSession()).data.session;
    return s ? s.access_token : null;
  }

  // ---------- cotización rápida (servidor) ----------
  var busy = false;
  async function cotizar() {
    if (busy) return;
    clearMsg();

    if (DEMO) {
      livePreview(true);
      msg('warn', 'Vista de ejemplo interactiva: cambia las opciones y el precio se recalcula al instante. Inicia sesión (sin ?demo=1) para tu cotización real.');
      return;
    }
    if (!sb && !LOCAL) { msg('err', 'El cotizador aún no está conectado a Supabase. Revisa assets/supabase-config.js (ver README).'); return; }

    var token = await getToken();
    if (!token) { showAuth(); return; }

    var params = gatherParams();
    if (!params.tipo) { msg('err', 'Elige un tipo de proyecto.'); return; }

    busy = true;
    var btn = $('cotizarBtn');
    var prev = btn.textContent;
    btn.textContent = 'Calculando…';
    btn.setAttribute('disabled', 'disabled');

    try {
      var aiOn = AI_AVAILABLE && $('aiToggle').classList.contains('on');
      var res = await fetch('/.netlify/functions/cotizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token,
          mode: aiOn ? 'ia' : 'free',
          idea: params.idea,
          tipo: params.tipo,
          complejidad: params.complejidad,
          plataformas: params.plataformas,
          addons: params.addons,
          urgencia: params.urgencia,
        }),
      });
      var data = await res.json().catch(function () { return {}; });

      if (res.status === 200 && data.ok) {
        renderQuote(data.quote, { aiUsed: data.ai_used });
        setQuota(data);
      } else if (res.status === 401) {
        showAuth();
        msg('err', 'Tu sesión expiró. Vuelve a entrar para cotizar.');
      } else if (res.status === 429) {
        $('result').classList.remove('show');
        var when = data.next_available ? fmtDate(data.next_available.slice(0, 10)) : 'en unos días';
        msg('warn', 'Usaste tus ' + (data.free_per_week || 2) + ' cotizaciones rápidas gratis de esta semana ' +
          '(se renuevan el ' + when + '). ¿Necesitas una ahora? Compra 10 por US$5 con el botón de arriba.');
        setQuota({ remaining_free: 0, remaining_credits: data.paid_credits || 0 });
        var br = $('buyRow');
        if (br) br.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        msg('err', 'No pudimos calcular la cotización ahora. Inténtalo de nuevo o escríbenos a abbiappo8@gmail.com.');
      }
    } catch (e) {
      msg('err', 'Error de conexión. Revisa tu internet o escríbenos a abbiappo8@gmail.com.');
    } finally {
      busy = false;
      btn.textContent = prev;
      btn.removeAttribute('disabled');
    }
  }

  // ---------- vistas ----------
  function showApp(email) {
    hide($('authView')); show($('appView'));
    if (email) { $('acctEmail').textContent = email; show($('acctEmail')); show($('logoutBtn')); }
    if (liveEnabled && clientCfg) livePreview(false);
  }
  function showAuth() {
    show($('authView')); hide($('appView'));
    hide($('acctEmail')); hide($('logoutBtn'));
  }

  // ---------- auth UI ----------
  var mode = 'login';
  function setMode(m) {
    mode = m;
    $('tabLogin').classList.toggle('on', m === 'login');
    $('tabSignup').classList.toggle('on', m === 'signup');
    $('authSubmit').textContent = m === 'login' ? 'Entrar →' : 'Crear cuenta →';
    $('password').setAttribute('autocomplete', m === 'login' ? 'current-password' : 'new-password');
    authMsg('');
  }
  function authMsg(text, ok) {
    var box = $('authMsg');
    if (!text) { box.className = 'formmsg'; box.textContent = ''; return; }
    box.className = 'formmsg ' + (ok ? 'ok' : 'err');
    box.textContent = text;
  }

  async function submitAuth() {
    if (!sb && !LOCAL) { authMsg('Configura Supabase en assets/supabase-config.js (ver README).'); return; }
    var email = $('email').value.trim();
    var password = $('password').value;
    if (!email || password.length < 6) { authMsg('Correo válido y contraseña de al menos 6 caracteres.'); return; }

    var btn = $('authSubmit');
    var prev = btn.textContent;
    btn.textContent = 'Un momento…';
    btn.setAttribute('disabled', 'disabled');
    try {
      if (LOCAL) {
        var rl = await fetch('/api/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, password: password, mode: mode }),
        });
        var dl = await rl.json().catch(function () { return {}; });
        if (!rl.ok || !dl.token) { authMsg(dl.error_es || 'No se pudo iniciar sesión.'); return; }
        localStorage.setItem('apab_token', dl.token);
        localStorage.setItem('apab_email', email);
        showApp(email);
        setupBuy({ id: email, email: email });
        return;
      }
      if (mode === 'login') {
        var r = await sb.auth.signInWithPassword({ email: email, password: password });
        if (r.error) { authMsg(translateAuthError(r.error.message)); return; }
        showApp(email);
      } else {
        var s = await sb.auth.signUp({ email: email, password: password });
        if (s.error) { authMsg(translateAuthError(s.error.message)); return; }
        if (s.data && s.data.session) {
          showApp(email);
        } else {
          authMsg('¡Cuenta creada! Revisa tu correo para confirmarla y luego entra.', true);
          setMode('login');
        }
      }
    } catch (e) {
      authMsg('No pudimos procesar la solicitud. Inténtalo de nuevo.');
    } finally {
      btn.textContent = prev;
      btn.removeAttribute('disabled');
    }
  }

  function translateAuthError(m) {
    m = (m || '').toLowerCase();
    if (m.indexOf('invalid login') > -1) return 'Correo o contraseña incorrectos.';
    if (m.indexOf('already registered') > -1 || m.indexOf('already been registered') > -1)
      return 'Ese correo ya tiene cuenta. Entra con tu contraseña.';
    if (m.indexOf('email not confirmed') > -1) return 'Confirma tu correo antes de entrar (revisa tu bandeja).';
    if (m.indexOf('password') > -1) return 'La contraseña debe tener al menos 6 caracteres.';
    return 'No se pudo: ' + m;
  }

  // ---------- ejemplo de respaldo (si no carga config.json) ----------
  var SAMPLE_QUOTE = {
    moneda: 'COP', launch_active: true, vigencia_lanzamiento: '2026-06-21',
    mercado: { base: 36000000, min: 30600000, max: 45000000 },
    apab: { base: 18000000, min: 15300000, max: 22500000 },
    lanzamiento: { base: 9000000, min: 7650000, max: 11250000 },
    anticipo: { base: 1800000, min: 1530000, max: 2250000 },
    saldo: { base: 7200000, min: 6120000, max: 9000000 },
    ahorro: { base: 27000000, min: 22950000, max: 33750000 },
    ahorro_pct: 75,
    nota_referencia: 'Tarifa de mercado según fuentes del sector en Colombia, 2026',
    notas: ['Precio estimado, sujeto a revisión.', 'Tarifa de mercado según fuentes del sector en Colombia, 2026'],
    params: { tipo: 'app_con_backend', complejidad: 'media', addons: ['autenticacion', 'pagos'], plataformas: ['web'], urgencia: false },
  };

  // ---------- init ----------
  function init() {
    setupChips();
    setupBuy(null);
    $('cotizarBtn').addEventListener('click', cotizar);
    $('tabLogin').addEventListener('click', function () { setMode('login'); });
    $('tabSignup').addEventListener('click', function () { setMode('signup'); });
    $('authForm').addEventListener('submit', function (e) { e.preventDefault(); submitAuth(); });

    var ai = $('aiToggle');
    if (AI_AVAILABLE) {
      ai.addEventListener('click', function () { ai.classList.toggle('on'); });
    } else {
      hide($('aiWrap'));
    }

    if ($('logoutBtn')) {
      $('logoutBtn').addEventListener('click', async function () {
        if (LOCAL) { localStorage.removeItem('apab_token'); localStorage.removeItem('apab_email'); showAuth(); return; }
        if (sb) await sb.auth.signOut();
        showAuth();
      });
    }

    // En pruebas (demo/local) carga la rúbrica para recalcular en vivo.
    if (liveEnabled) {
      fetch('config.json').then(function (r) { return r.json(); })
        .then(function (cfg) { clientCfg = cfg; if (!$('appView').classList.contains('hidden')) livePreview(false); })
        .catch(function () { clientCfg = null; });
    }

    // Modo ejemplo (?demo=1): cotizador interactivo sin login.
    if (DEMO) {
      show($('demoBanner'));
      showApp(null);
      $('quotaInfo').textContent = 'Ejemplo interactivo · cambia opciones y se recalcula';
      return;
    }

    // Modo local de pruebas (backend_local.py).
    if (LOCAL) {
      var ln = $('configNotice');
      ln.innerHTML = '<b>Modo local de pruebas.</b> Login y cotizador funcionan con un backend local (sin Supabase ni costos). Crea una cuenta con cualquier correo y contraseña (6+). El precio se recalcula en vivo al cambiar opciones.';
      show(ln);
      var ltk = localStorage.getItem('apab_token');
      if (ltk) { showApp(localStorage.getItem('apab_email')); setupBuy({ id: localStorage.getItem('apab_email'), email: localStorage.getItem('apab_email') }); }
      else showAuth();
      return;
    }

    // Aviso si faltan claves (y no es demo ni local).
    if (!configured) {
      var n = $('configNotice');
      n.innerHTML = '<b>Falta conectar Supabase.</b> Edita <code>assets/supabase-config.js</code> con tu URL y anon key (ver README). ' +
        'Mientras tanto puedes ver el diseño en <a href="?demo=1" style="color:var(--ember)">modo ejemplo</a>.';
      show(n);
      showAuth();
      return;
    }

    // Sesión actual (Supabase).
    sb.auth.getSession().then(function (r) {
      var sess = r.data.session;
      if (sess) { showApp(sess.user && sess.user.email); setupBuy(sess.user); }
      else showAuth();
    });
    sb.auth.onAuthStateChange(function (_evt, session) {
      if (session) { showApp(session.user && session.user.email); setupBuy(session.user); }
      else showAuth();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
