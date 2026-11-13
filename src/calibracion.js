/* ============================================================
   Condición de descarga calibrada.
   El caudal que entrega el modelo depende del nivel de la almenara (salto
   neto = embalse − almenara − pérdidas). Ese nivel no se mide; las tablas
   de la ASE (río colmatado) y del diseño (río dragado) lo estiman. Aquí se
   busca el nivel de almenara EQUIVALENTE con el que el caudal del modelo
   coincide en promedio con las dos mediciones de caudal:
     - Hidrometría (P / F.C., columna de LoggerNet), con la fórmula vigente
       desde el 29-oct-2026 (FC_HIDROMETRIA_POR_NIVEL.desde);
     - Winter-Kennedy (WK) de cada unidad (segunda referencia: aún no está
       calibrado; sin horas de Hidrometría con la fórmula vigente no se calibra).
   Para cada referencia se halla el nivel que anula el sesgo (el sesgo crece
   casi en línea recta con el nivel de la almenara: secante, 4 evaluaciones)
   y se toma el punto medio entre los dos niveles. Es un nivel equivalente:
   además del nivel real absorbe pequeños errores de la colina y de las
   pérdidas. Se calibra con horas estables (unidades en línea toda la hora).
   ============================================================ */
import { repartoPorUnidad, FC_HIDROMETRIA_POR_NIVEL, GAMMA_ENSAYADO_MAX } from "./modelo.js";

const VERSION_CALIBRACION = 2; // cambia si cambia el método (invalida lo guardado)
const VENTANA_DIAS = 7;
const MAX_HORAS = 48;          // muestra pareja de la ventana (el modelo es costoso)
const MIN_HORAS = 12;          // menos horas estables: no se calibra
const RANGO_NIVEL = [205, 235]; // msnm, límites del ajuste

/* Horas útiles de las filas horarias (formato de derivados/horario o de
   derivados/dias/*.json → horas): unidades en línea toda la hora o detenidas. */
function horasEstables(horas) {
  const out = [];
  for (const h of horas || []) {
    if (!h || !Number.isFinite(h.nivel) || !Array.isArray(h.p) || !Array.isArray(h.linea)) continue;
    const on = h.linea.map((l) => l === 1);
    if (!on.some(Boolean) || h.linea.some((l) => l > 0 && l < 1)) continue;
    const qWK = on.map((o, k) => (o ? h.qWK && h.qWK[k] : 0));
    const qFC = on.map((o, k) => (o ? h.qFC && h.qFC[k] : 0));
    if (on.some((o, k) => o && !(h.p[k] > 0))) continue;
    out.push({
      t: h.t, nivel: h.nivel, p: h.p.map((p, k) => (on[k] ? p : 0)), on,
      qWK: qWK.every((q, k) => !on[k] || q > 0) ? qWK.reduce((a, q) => a + (q || 0), 0) : null,
      qHidro: h.t >= FC_HIDROMETRIA_POR_NIVEL.desde && qFC.every((q, k) => !on[k] || q > 0) ? qFC.reduce((a, q) => a + (q || 0), 0) : null,
    });
  }
  return out;
}

/* derivados/horario/AAAA-MM.json viene por columnas → filas */
function filasHorario(mes) {
  if (!mes || !Array.isArray(mes.t)) return [];
  return mes.t.map((t, i) => ({ t, nivel: mes.nivel && mes.nivel[i], qDesc: mes.qDesc && mes.qDesc[i], p: mes.p && mes.p[i], qFC: mes.qFC && mes.qFC[i], qWK: mes.qWK && mes.qWK[i], linea: mes.linea && mes.linea[i] }));
}

const condManual = (nivel) => ({ modo: "manual", almManual: { norte: nivel, sur: nivel } });
const qModelo = (h, cond) => repartoPorUnidad(h.nivel, h.p, { cond, gammaMax: GAMMA_ENSAYADO_MAX, potenciaMaxMW: null }).porUnidad.reduce((a, u, k) => a + (h.on[k] ? u.q : 0), 0);

/* Sesgo (%) y error medio absoluto (%) del modelo frente a una referencia */
function estadisticas(qMod, horas, ref) {
  const pares = horas.map((h, i) => [qMod[i], h[ref]]).filter(([, r]) => r != null && r > 0);
  if (!pares.length) return null;
  const sm = pares.reduce((a, [m]) => a + m, 0), sr = pares.reduce((a, [, r]) => a + r, 0);
  return { sesgo: ((sm - sr) / sr) * 100, mae: (pares.reduce((a, [m, r]) => a + Math.abs(m - r) / r, 0) / pares.length) * 100, horas: pares.length };
}

/* Calibra con las horas dadas. Devuelve null si no alcanza. */
function calibrarDescarga(horasFuente, { maxHoras = MAX_HORAS, condReferencia = null } = {}) {
  let horas = horasEstables(horasFuente);
  const conWK = horas.filter((h) => h.qWK != null).length, conH = horas.filter((h) => h.qHidro != null).length;
  // Hidrometría (con la fórmula vigente del F.C.) es obligatoria: el WK aún no
  // está calibrado y solo entra como segunda referencia.
  if (conH < MIN_HORAS) return null;
  const horasTotales = horas.length;
  if (horas.length > maxHoras) { const paso = horas.length / maxHoras; horas = Array.from({ length: maxHoras }, (_, i) => horas[Math.floor(i * paso)]); }
  const refs = ["qHidro", conWK >= MIN_HORAS ? "qWK" : null].filter(Boolean);
  const cache = new Map();
  const evaluar = (nivel) => {
    const k = nivel.toFixed(3);
    if (!cache.has(k)) cache.set(k, horas.map((h) => qModelo(h, condManual(nivel))));
    return cache.get(k);
  };
  const sesgo = (nivel, ref) => estadisticas(evaluar(nivel), horas, ref).sesgo;
  const recortar = (x) => Math.min(RANGO_NIVEL[1], Math.max(RANGO_NIVEL[0], x));
  const secante = (a, b, ref) => { const sa = sesgo(a, ref), sb = sesgo(b, ref); return sb === sa ? b : recortar(b - (sb * (b - a)) / (sb - sa)); };
  // 1) dos puntos, 2) raíz lineal de cada referencia, 3) un punto en medio y una secante más
  const a = 216, b = 226;
  const raiz0 = Object.fromEntries(refs.map((r) => [r, secante(a, b, r)]));
  const medio0 = recortar(refs.reduce((s, r) => s + raiz0[r], 0) / refs.length);
  const raiz = Object.fromEntries(refs.map((r) => [r, secante(Math.abs(medio0 - a) < Math.abs(medio0 - b) ? a : b, medio0, r)]));
  const nivel = Math.round((refs.reduce((s, r) => s + raiz[r], 0) / refs.length) * 20) / 20; // 0,05 m
  const qFinal = evaluar(nivel);
  const out = {
    nivelAlmenara: nivel,
    nivelHidrometria: raiz.qHidro != null ? Math.round(raiz.qHidro * 100) / 100 : null,
    nivelWK: raiz.qWK != null ? Math.round(raiz.qWK * 100) / 100 : null,
    referencias: refs.map((r) => (r === "qHidro" ? "hidrometria" : "wk")),
    horas: horas.length, horasEstables: horasTotales, desde: horas[0].t, hasta: horas[horas.length - 1].t,
    hidrometria: estadisticas(qFinal, horas, "qHidro"), wk: estadisticas(qFinal, horas, "qWK"),
  };
  if (condReferencia) {
    const qRef = horas.map((h) => qModelo(h, typeof condReferencia === "function" ? condReferencia(h) : condReferencia));
    out.comparacion = { hidrometria: estadisticas(qRef, horas, "qHidro"), wk: estadisticas(qRef, horas, "qWK") };
  }
  return out;
}

/* Condición de descarga a partir de una calibración (o null) */
function condicionCalibrada(cal) {
  if (!cal || !Number.isFinite(cal.nivelAlmenara)) return null;
  return { modo: "manual", almManual: { norte: cal.nivelAlmenara, sur: cal.nivelAlmenara }, calibrada: { desde: cal.desde, hasta: cal.hasta, horas: cal.horas, referencias: cal.referencias, nivelHidrometria: cal.nivelHidrometria, nivelWK: cal.nivelWK, hidrometria: cal.hidrometria, wk: cal.wk, comparacion: cal.comparacion || null } };
}

export { VERSION_CALIBRACION, VENTANA_DIAS, MAX_HORAS, MIN_HORAS, filasHorario, horasEstables, calibrarDescarga, condicionCalibrada, estadisticas };
