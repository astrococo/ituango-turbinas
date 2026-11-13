/* ============================================================
   Indicadores de la central: factor de planta (nominal y real),
   horas equivalentes, energía equivalente del agua vertida, energía
   embalsada útil, aportes frente a la media histórica, tiempo en línea
   por unidad e indicadores de sostenibilidad (densidad de potencia,
   grado de regulación y tiempo de residencia).
   Solo usa datos que la app ya tiene: histórico diario (LoggerNet),
   curva cota-volumen, F.C. de Hidrometría e histórico de caudales de
   HydroForecast. Funciones puras: las usan la pestaña Indicadores, el
   Tablero y el asistente.
   ============================================================ */
import { volumenHm3, volumenUtilHm3, areaEmbalseKm2, factorConversionHidrometria, NAMO, NIVEL_MIN_TEC, UNIDADES_DISPONIBLES_HOY } from "./modelo.js";

/* Capacidad nominal: 300 MW por unidad. En operación hoy UG1–UG4 (1.200 MW);
   UG5–UG8 entran a finales de 2027 / comienzos de 2028 (diseño: 2.400 MW).
   Al entrar nuevas unidades se agrega una fila con la fecha. */
const MW_NOMINAL_UNIDAD = 300;
const UNIDADES_EN_OPERACION = [{ desde: "2022-01-01", unidades: UNIDADES_DISPONIBLES_HOY }];
const CAPACIDAD_DISENO_MW = 8 * MW_NOMINAL_UNIDAD;
const unidadesEnOperacion = (dia) => UNIDADES_EN_OPERACION.filter((x) => x.desde <= dia).slice(-1)[0]?.unidades ?? UNIDADES_DISPONIBLES_HOY;
const capacidadNominalMW = (dia) => unidadesEnOperacion(dia) * MW_NOMINAL_UNIDAD;

/* Capacidad real demostrada: la mayor potencia media de un día completo con
   todas las unidades en operación (se sostuvo 24 h; no es un pico). */
function capacidadDemostrada(dias) {
  let mejor = null;
  for (const d of dias || []) {
    if (d.parcial || !Number.isFinite(d.pMedia)) continue;
    const n = unidadesEnOperacion(d.dia);
    const todas = (d.unidades || []).filter((u) => u && u.horas >= 23.5).length >= n;
    if (todas && (!mejor || d.pMedia > mejor.mw)) mejor = { mw: d.pMedia, dia: d.dia };
  }
  return mejor;
}

/* Energía equivalente del agua vertida (MWh): volumen vertido × F.C. / 3600.
   Es la energía que ese volumen habría dado en las turbinas con el F.C. del día
   (oportunidad), no una pérdida contable: parte del vertimiento puede ser obligado. */
const energiaVertidaMWh = (d) => (d && d.vertedero && Number.isFinite(d.vertedero.volHm3) && d.vertedero.volHm3 > 0 ? (d.vertedero.volHm3 * 1e6 * (Number.isFinite(d.fc) ? d.fc : factorConversionHidrometria(d.nivel ? d.nivel.media : NAMO, `${d.dia} 12:00`))) / 3600 : 0);

/* Resumen de un conjunto de días (solo días completos para los factores). */
function resumenIndicadores(dias, { capacidadReal = null } = {}) {
  const todos = dias || [];
  const completos = todos.filter((d) => !d.parcial && Number.isFinite(d.energia));
  const horas = completos.length * 24;
  const energia = completos.reduce((a, d) => a + d.energia, 0);
  const capNom = completos.reduce((a, d) => a + capacidadNominalMW(d.dia) * 24, 0); // MWh posibles a capacidad nominal
  const vertida = completos.reduce((a, d) => a + energiaVertidaMWh(d), 0);
  const nU = completos.reduce((k, d) => Math.max(k, (d.unidades || []).length), 0);
  const unidades = Array.from({ length: nU }, (_, i) => {
    const h = completos.reduce((a, d) => a + (d.unidades[i] ? d.unidades[i].horas || 0 : 0), 0);
    const e = completos.reduce((a, d) => a + (d.unidades[i] ? d.unidades[i].energia || 0 : 0), 0);
    return {
      unidad: `U${i + 1}`, horas: h, pctTiempo: horas ? (h / horas) * 100 : null, energia: e,
      fpNominal: horas ? (e / (MW_NOMINAL_UNIDAD * horas)) * 100 : null,
      arranques: completos.reduce((a, d) => a + (d.unidades[i] ? d.unidades[i].arranques || 0 : 0), 0),
    };
  });
  return {
    dias: completos.length, diasIncompletos: todos.length - completos.length, horas, energia,
    fpNominal: capNom ? (energia / capNom) * 100 : null,
    fpReal: capacidadReal && horas ? (energia / (capacidadReal * horas)) * 100 : null,
    horasEquivalentes: completos.length ? energia / capacidadNominalMW(completos[completos.length - 1].dia) : null,
    vertidaMWh: vertida, vertidaPct: energia ? (vertida / energia) * 100 : null,
    diasConVertimiento: completos.filter((d) => d.vertedero && d.vertedero.conVertimiento).length,
    unidades,
  };
}

/* Agrupa por mes (AAAA-MM) y resume cada mes. */
function indicadoresMensuales(dias, opciones) {
  const meses = new Map();
  for (const d of dias || []) { const m = d.dia.slice(0, 7); if (!meses.has(m)) meses.set(m, []); meses.get(m).push(d); }
  return [...meses.entries()].sort().map(([mes, ds]) => ({ mes, ...resumenIndicadores(ds, opciones) }));
}

/* Energía embalsada útil a un nivel: volumen útil (sobre el mínimo técnico) × F.C. / 3600. */
function energiaEmbalsada(nivel, fecha) {
  if (!Number.isFinite(nivel)) return null;
  const vUtil = volumenUtilHm3(nivel), vUtilMax = volumenUtilHm3(NAMO);
  const fc = factorConversionHidrometria(nivel, fecha || "2099-01-01 00:00");
  const gwh = (vUtil * 1e6 * fc) / 3600 / 1000;
  return { vUtilHm3: vUtil, vUtilMaxHm3: vUtilMax, pctUtil: vUtilMax ? (vUtil / vUtilMax) * 100 : null, fc, gwh, gwhMax: (vUtilMax * 1e6 * fc) / 3600 / 1000 };
}

/* Caudal diario por estación desde el histórico (CSV) y lo observado reciente. */
const ESTACIONES = { olaya: ["CaudalOlaya_mean", "QOlaya_obs"], sitioPresa: ["CaudalSitioPresa_mean", "QSitioPresa_obs"] };
function caudalesDiarios(csv, observado) {
  const out = { olaya: new Map(), sitioPresa: new Map() };
  if (csv) {
    const [cab, ...filas] = String(csv).trim().split("\n");
    const col = cab.split(",");
    const idx = Object.fromEntries(Object.entries(ESTACIONES).map(([k, [c]]) => [k, col.indexOf(c)]));
    for (const l of filas) {
      const c = l.split(",");
      for (const k of Object.keys(out)) { const v = parseFloat(c[idx[k]]); if (idx[k] >= 0 && Number.isFinite(v) && v > 0) out[k].set(c[0].slice(0, 10), v); }
    }
  }
  for (const r of (observado && observado.data) || []) {
    const d = String(r.timestamp).slice(0, 10);
    for (const [k, [, o]] of Object.entries(ESTACIONES)) { const v = r[o]; if (Number.isFinite(v) && v > 0) out[k].set(d, v); }
  }
  return out;
}

/* Aportes mensuales frente a la media histórica del mismo mes (años anteriores
   con el mes completo, ≥ 25 días), como los reporta XM. */
const MIN_DIAS_MES = 25;
function aportesMensuales(diarios) {
  const meses = new Map();
  for (const [d, v] of diarios) { const m = d.slice(0, 7); if (!meses.has(m)) meses.set(m, []); meses.get(m).push(v); }
  const mensual = [...meses.entries()].sort().map(([mes, vs]) => ({ mes, q: vs.reduce((a, b) => a + b, 0) / vs.length, dias: vs.length }));
  return mensual.map((x) => {
    const prev = mensual.filter((y) => y.mes.slice(5) === x.mes.slice(5) && y.mes < x.mes && y.dias >= MIN_DIAS_MES);
    if (!prev.length) return x;
    const media = prev.reduce((a, y) => a + y.q, 0) / prev.length;
    return { ...x, media, anios: prev.length, minHist: Math.min(...prev.map((y) => y.q)), maxHist: Math.max(...prev.map((y) => y.q)), pct: (x.q / media) * 100 };
  });
}

/* Caudal medio anual de largo plazo (años completos, ≥ 350 días). */
function caudalMedioAnual(diarios) {
  const anios = new Map();
  for (const [d, v] of diarios) { const a = d.slice(0, 4); if (!anios.has(a)) anios.set(a, []); anios.get(a).push(v); }
  const completos = [...anios.entries()].filter(([, vs]) => vs.length >= 350).map(([a, vs]) => ({ a, q: vs.reduce((x, y) => x + y, 0) / vs.length }));
  if (!completos.length) return null;
  return { q: completos.reduce((x, y) => x + y.q, 0) / completos.length, desde: completos[0].a, hasta: completos[completos.length - 1].a, anios: completos.length };
}

/* Sostenibilidad (indicadores de referencia internacional):
   - Densidad de potencia (W/m²) = capacidad / área del espejo de agua; criterio de
     Climate Bonds para centrales desde 2020: > 10 W/m² (antes de 2020: > 5 W/m²).
   - Grado de regulación DOR (%) = volumen del embalse / volumen medio anual del río × 100
     (Lehner et al., 2011): ≥ 2 % = río regulado; ≥ 100 % = guarda un año de caudal.
   - Tiempo de residencia (días) = volumen embalsado / caudal de entrada.
   El área sale de la curva cota-área vigente del CGI (Tabla 3 de la memoria
   I-M-2194-044-HID-VC-CVE-001, LIDAR 2012), interpolada cada 5 m. */
function areaEspejoKm2(nivel) {
  return areaEmbalseKm2(nivel);
}
function sostenibilidad({ nivel, caudalEntrada, qMedioAnual, capacidadMW }) {
  if (!Number.isFinite(nivel)) return null;
  const area = areaEspejoKm2(nivel), areaNAMO = areaEspejoKm2(NAMO);
  const vAnual = qMedioAnual ? (qMedioAnual.q * 365.25 * 86400) / 1e6 : null; // hm³
  const vTotal = volumenHm3(Math.min(NAMO, nivel)), vTotalNAMO = volumenHm3(NAMO);
  return {
    areaKm2: area, areaNAMOKm2: areaNAMO,
    densidad: (capacidadMW * 1e6) / (areaNAMO * 1e6), densidadDiseno: (CAPACIDAD_DISENO_MW * 1e6) / (areaNAMO * 1e6),
    haPorMW: (areaNAMO * 100) / capacidadMW,
    dorTotal: vAnual ? (vTotalNAMO / vAnual) * 100 : null, dorUtil: vAnual ? (volumenUtilHm3(NAMO) / vAnual) * 100 : null,
    residenciaDias: Number.isFinite(caudalEntrada) && caudalEntrada > 0 ? (vTotal * 1e6) / caudalEntrada / 86400 : null,
    residenciaMediaDias: qMedioAnual ? (vTotal * 1e6) / qMedioAnual.q / 86400 : null,
    vTotalHm3: vTotal, qMedioAnual,
  };
}

export {
  MW_NOMINAL_UNIDAD, UNIDADES_EN_OPERACION, CAPACIDAD_DISENO_MW, unidadesEnOperacion, capacidadNominalMW, capacidadDemostrada,
  energiaVertidaMWh, resumenIndicadores, indicadoresMensuales, energiaEmbalsada, caudalesDiarios, aportesMensuales, caudalMedioAnual,
  areaEspejoKm2, sostenibilidad, MIN_DIAS_MES,
};
