'use strict';
/* ===================================================================
   Ap-Ab — cálculo DETERMINISTA del precio (cero costo de API).
   El LLM (modo IA) solo extrae parámetros; el precio SIEMPRE se
   calcula aquí, con los valores editables de config.json.

   Fórmula (según la rúbrica):
     mercado            = tarifa_mercado[tipo] * factor_complejidad + Σ addons
                          (× urgencia_factor si urgencia = true)
     precio_apab        = mercado * factor_apab            (50% del mercado)
     precio_lanzamiento = precio_apab * descuento_lanzamiento (si hay vigencia)
     anticipo / saldo   = lanzamiento * 20% / 80%
     ahorro_%           = 1 - (lanzamiento / mercado)      (≈75%)
   Todo se muestra como RANGO (rango.min / rango.max).
   =================================================================== */

function round1000(n) { return Math.round(n / 1000) * 1000; }

// Construye un nivel de precio con su rango min/max.
function tier(base, rango) {
  return {
    base: round1000(base),
    min: round1000(base * rango.min),
    max: round1000(base * rango.max),
  };
}

/**
 * Normaliza/valida parámetros contra el config. Devuelve valores seguros
 * (con defaults sensatos) para no romper nunca el cálculo.
 */
function resolveParams(config, params) {
  const p = params || {};
  const tipos = Object.keys(config.tarifa_mercado_por_tipo);
  const complejidades = Object.keys(config.factor_complejidad);
  const addonsValidos = Object.keys(config.addons_mercado);

  const tipo = tipos.includes(p.tipo) ? p.tipo : 'web_o_app_sencilla';
  const complejidad = complejidades.includes(p.complejidad) ? p.complejidad : 'media';
  const addons = Array.isArray(p.addons)
    ? p.addons.filter((a) => addonsValidos.includes(a))
    : [];
  // dedup
  const addonsUnicos = Array.from(new Set(addons));
  const plataformas = Array.isArray(p.plataformas) ? p.plataformas.slice(0, 8) : [];
  const urgencia = !!p.urgencia;

  return { tipo, complejidad, addons: addonsUnicos, plataformas, urgencia };
}

/**
 * Calcula la cotización completa.
 * @param {object} config   - config.json (rúbrica)
 * @param {object} params   - { tipo, plataformas, complejidad, addons, urgencia }
 * @param {string} todayStr - fecha de hoy "YYYY-MM-DD" (para la vigencia)
 */
function computeQuote(config, params, todayStr) {
  const rango = config.rango || { min: 1, max: 1 };
  const r = resolveParams(config, params);

  const base = config.tarifa_mercado_por_tipo[r.tipo];
  const fc = config.factor_complejidad[r.complejidad];
  const addonsSum = r.addons.reduce((s, a) => s + (config.addons_mercado[a] || 0), 0);

  let mercadoBase = base * fc + addonsSum;
  if (r.urgencia) mercadoBase *= (config.urgencia_factor || 1);

  const apabBase = mercadoBase * config.factor_apab;

  // ¿Sigue vigente el descuento de lanzamiento?
  const launchActive = String(todayStr) <= String(config.vigencia_lanzamiento);
  const lanzamientoBase = launchActive
    ? apabBase * config.descuento_lanzamiento
    : apabBase;

  const anticipoBase = lanzamientoBase * config.anticipo;
  const saldoBase = lanzamientoBase * config.saldo;
  const ahorroBase = mercadoBase - lanzamientoBase;
  const ahorroPct = Math.round((1 - lanzamientoBase / mercadoBase) * 100);

  return {
    moneda: config.moneda,
    nota_referencia: config.nota_referencia,
    vigencia_lanzamiento: config.vigencia_lanzamiento,
    launch_active: launchActive,
    params: r,
    mercado: tier(mercadoBase, rango),
    apab: tier(apabBase, rango),
    lanzamiento: tier(lanzamientoBase, rango),
    anticipo: tier(anticipoBase, rango),
    saldo: tier(saldoBase, rango),
    ahorro: tier(ahorroBase, rango),
    ahorro_pct: ahorroPct,
    notas: [
      'Precio estimado, sujeto a revisión.',
      config.nota_referencia,
    ],
  };
}

module.exports = { computeQuote, resolveParams, round1000 };
