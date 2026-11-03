/* ============================================================
   Analítica de operación: resúmenes por hora y por día, regla
   operativa (Res. ANLA 1891), vertedero, caudal descargado y
   comportamiento de cada unidad.
   ------------------------------------------------------------
   Sin interfaz ni red: lo usan igual el proceso automático del
   repositorio de datos (Node, GitHub Actions) y la app (navegador),
   para que los números del histórico y los del día en curso salgan
   del mismo código.

   Entradas: filas de minuto de leerLoggerNet ya unidas al nivel
   (unirNivel): { t, p[], q[], q2[], qVert, nivel, qComp?, aComp?,
   qDesc?, qTurbLog?, nivel2? }.

   Definiciones (las mismas de la app de Hidrometría):
   - Caudal regulado (Q_reg) = Σ potencia en bornes / F.C. vigente.
   - Caudal total descargado (ANLA) = Q_reg + caudal del vertedero.
   - Banda del día = promedio regulado del día anterior ± 4,70 %.
   Índices por unidad (Winter-Kennedy SIN CALIBRAR, solo relativos):
   - F.C. WK = P / Q_WK (MW por m³/s): compara unidades entre sí y en
     el tiempo; no es un caudal absoluto.
   - η aparente WK = P_eje / (ρ·g·Q_WK·H_neto del modelo).
   ============================================================ */
import {
  bandaReglaOperativa,
  estadoReglaOperativa,
  factorConversionHidrometria,
  rendimientoGenerador,
  resolverUnidadesConPotencias,
  simularDespachoHorario,
  caudalVertederoDetallado,
  volumenExtrapolado,
  RHO_AGUA_PROTOTIPO,
  G_SITIO,
  REGLA_OPERATIVA_RES1891,
} from "./modelo.js";
import { P_EN_LINEA_MW, caudalRegulado, verificarColumnaLoggerNet } from "./operacion.js";

const VERSION_ANALITICA = 3; // 2: estabilidad del WK continua entre horas; 3: calidad y validación por día
const UMBRAL_VERTIMIENTO_M3S = 1; // > 1 m³/s en el vertedero = hay vertimiento (igual que la regla diaria)
const GAMMA_MAX_MODELO = 31.98;
const MIN_ESTABLE = 10; // minutos seguidos en línea antes de usar el Winter-Kennedy de una unidad
const LINEA_ESTABLE = 0.95; // fracción de la hora en línea para los índices horarios de eficiencia // borde de los ensayos: el modelo no se recorta para comparar con lo medido

const enLinea = (p) => p != null && p > P_EN_LINEA_MW;
const prom = (s, c) => (c > 0 ? s / c : null);
const r3 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000);
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const minutosDe = (t) => Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10), +t.slice(11, 13), +t.slice(14, 16)) / 60000;
const diaSiguiente = (d) => new Date(Date.parse(d + "T00:00:00Z") + 864e5).toISOString().slice(0, 10);
const diaAnterior = (d) => new Date(Date.parse(d + "T00:00:00Z") - 864e5).toISOString().slice(0, 10);

/* Acumulador de una serie: suma, cuenta, mínimo, máximo. */
function acum() { return { s: 0, c: 0, min: Infinity, max: -Infinity }; }
function sumar(a, v) { if (v == null || !Number.isFinite(v)) return; a.s += v; a.c++; if (v < a.min) a.min = v; if (v > a.max) a.max = v; }
const mediaDe = (a) => prom(a.s, a.c);

/* Resumen de un grupo de minutos (una hora o un día). nU = número de unidades. */
/* estado: { seguidos[], previo } para encadenar horas seguidas (la estabilidad
   del Winter-Kennedy y los arranques no se reinician a las :00). */
function nuevoEstado(nU) { return { seguidos: Array(nU).fill(0), previo: null }; }
function resumirMinutos(filas, nU, estado = nuevoEstado(nU)) {
  const P = Array.from({ length: nU }, acum), Qfc = Array.from({ length: nU }, acum), Qwk = Array.from({ length: nU }, acum);
  const minLinea = Array(nU).fill(0), arranques = Array(nU).fill(0), energia = Array(nU).fill(0);
  const sumPwk = Array(nU).fill(0), sumQwk = Array(nU).fill(0);
  const nivel = acum(), nivel2 = acum(), qReg = acum(), qVert = acum(), qDescHid = acum(), qDescLog = acum(), fc = acum();
  const qComp = [acum(), acum(), acum(), acum()], aComp = [acum(), acum(), acum(), acum()];
  let minVert = 0, nUnidMin = acum(), primero = null, ultimo = null, nivelIni = null, nivelFin = null, minutos = 0;
  let previo = estado.previo;
  const seguidos = estado.seguidos; // minutos seguidos en línea (para descartar arranques en los índices WK)
  for (const r of filas) {
    minutos++;
    if (primero == null) primero = r.t;
    ultimo = r.t;
    if (r.nivel != null) { if (nivelIni == null) nivelIni = { t: r.t, v: r.nivel }; nivelFin = { t: r.t, v: r.nivel }; }
    let n = 0;
    for (let u = 0; u < nU; u++) {
      const p = r.p[u];
      if (enLinea(p)) {
        n++; minLinea[u]++; sumar(P[u], p); energia[u] += p / 60;
        sumar(Qfc[u], r.q[u]);
        seguidos[u]++;
        const wk = r.q2 ? r.q2[u] : null;
        // Índices WK solo con la unidad estable (≥ MIN_ESTABLE minutos seguidos en línea)
        if (wk != null && wk > 1 && seguidos[u] >= MIN_ESTABLE) { sumar(Qwk[u], wk); sumPwk[u] += p; sumQwk[u] += wk; }
        if (previo && !enLinea(previo.p[u])) arranques[u]++;
      } else seguidos[u] = 0;
    }
    sumar(nUnidMin, n);
    sumar(nivel, r.nivel); sumar(nivel2, r.nivel2);
    const qr = caudalRegulado(r);
    sumar(qReg, qr);
    if (qr != null) sumar(fc, factorConversionHidrometria(r.nivel, r.t));
    sumar(qVert, r.qVert);
    if (r.qVert != null && r.qVert > UMBRAL_VERTIMIENTO_M3S) minVert++;
    if (qr != null) sumar(qDescHid, qr + (r.qVert != null && r.qVert > 0 ? r.qVert : 0));
    sumar(qDescLog, r.qDesc);
    if (r.qComp) r.qComp.forEach((v, g) => sumar(qComp[g], v));
    if (r.aComp) r.aComp.forEach((v, g) => sumar(aComp[g], v));
    previo = r;
  }
  estado.previo = previo;
  return { P, Qfc, Qwk, minLinea, arranques, energia, sumPwk, sumQwk, nivel, nivel2, qReg, qVert, qDescHid, qDescLog, fc, qComp, aComp, minVert, nUnidMin, primero, ultimo, nivelIni, nivelFin, minutos };
}

/* Caudal del modelo y salto neto por unidad para una hora (potencia media
   de cada unidad en línea, nivel medio). Condición de descarga: la de la
   app (ASE) con el caudal del río = caudal total descargado de esa hora. */
function modeloHora(nivel, pBornes, qRio, condBase) {
  if (nivel == null || !pBornes.some((p) => p > 0)) return null;
  const pEje = pBornes.map((p) => (p > 0 ? p / rendimientoGenerador(p) : 0));
  const cond = condBase && condBase.modo === "ase" && Number.isFinite(qRio) ? { ...condBase, qRio } : condBase;
  const { unidades } = resolverUnidadesConPotencias(nivel, pEje, GAMMA_MAX_MODELO, null, cond);
  return unidades.map((u, i) => (pEje[i] > 0 && u.resultado && u.alcanzable !== false
    ? { q: u.resultado.Q, h: u.resultado.saltoNeto, eta: u.resultado.eta, gamma: u.gamma, pEje: pEje[i] }
    : null));
}

/* Una hora: promedios y, si se pide, el modelo. */
function resumenHora(t, filas, nU, { cond = null, conModelo = true, estado } = {}) {
  const m = resumirMinutos(filas, nU, estado);
  const pU = m.P.map((a) => r2(mediaDe(a)));
  const frac = m.minLinea.map((c) => (m.minutos ? c / m.minutos : 0));
  // Para el modelo, solo unidades en línea al menos la mitad de la hora
  const pModelo = pU.map((p, u) => (frac[u] >= 0.5 && p != null ? p : 0));
  const qDesc = mediaDe(m.qDescHid);
  const mod = conModelo ? modeloHora(mediaDe(m.nivel), pModelo, qDesc, cond) : null;
  const fcWK = m.sumQwk.map((q, u) => (q > 0 ? r3(m.sumPwk[u] / q) : null));
  const etaWK = mod ? mod.map((x, u) => {
    const qwk = mediaDe(m.Qwk[u]);
    return x && qwk && frac[u] >= LINEA_ESTABLE ? r2((100 * x.pEje * 1e6) / (RHO_AGUA_PROTOTIPO * G_SITIO * qwk * x.h)) : null;
  }) : Array(nU).fill(null);
  return {
    t, min: m.minutos,
    nivel: r3(mediaDe(m.nivel)), nivel2: r3(mediaDe(m.nivel2)),
    p: pU, linea: frac.map(r2), e: m.energia.map(r1),
    qFC: m.Qfc.map((a) => r2(mediaDe(a))), qWK: m.Qwk.map((a) => r2(mediaDe(a))), fcWK,
    qMod: mod ? mod.map((x) => (x ? r2(x.q) : null)) : null,
    etaMod: mod ? mod.map((x) => (x ? r2(x.eta) : null)) : null,
    hNeto: mod ? mod.map((x) => (x ? r2(x.h) : null)) : null,
    gamma: mod ? mod.map((x) => (x ? r2(x.gamma) : null)) : null,
    etaWK,
    qReg: r2(mediaDe(m.qReg)), fc: r3(mediaDe(m.fc)),
    qVert: r2(mediaDe(m.qVert)), qVertMax: m.qVert.c ? r2(m.qVert.max) : null, minVert: m.minVert,
    qDesc: r2(qDesc), qDescLog: r2(mediaDe(m.qDescLog)),
    qComp: m.qComp.some((a) => a.c) ? m.qComp.map((a) => r2(mediaDe(a))) : null,
    aComp: m.aComp.some((a) => a.c) ? m.aComp.map((a) => r3(mediaDe(a))) : null,
  };
}

/* Agrupa filas de minuto por día y por hora. */
function agruparPorDia(filas) {
  const dias = new Map();
  for (const r of filas) {
    const d = r.t.slice(0, 10), h = +r.t.slice(11, 13);
    if (!dias.has(d)) dias.set(d, Array.from({ length: 24 }, () => []));
    dias.get(d)[h].push(r);
  }
  return dias;
}
const numeroUnidades = (filas) => filas.reduce((n, r) => Math.max(n, r.p ? r.p.length : 0), 0);

/* Resumen de un día. qRegAnterior: promedio regulado del día anterior
   (para la banda). nivelSiguiente: nivel a las 00:00 del día siguiente, si
   existe (cierra el balance a 24 h). */
function resumenDia(dia, horasFilas, { qRegAnterior = null, nivelSiguiente = null, cond = null, conModelo = true, nU = null } = {}) {
  const todas = horasFilas.flat();
  const n = nU ?? numeroUnidades(todas);
  const m = resumirMinutos(todas, n);
  const est = nuevoEstado(n);
  const horas = horasFilas.map((f, h) => {
    if (!f.length) { est.seguidos.fill(0); est.previo = null; return null; }
    return resumenHora(`${dia} ${String(h).padStart(2, "0")}:00`, f, n, { cond, conModelo, estado: est });
  });
  const qReg = mediaDe(m.qReg);
  const banda = qRegAnterior != null ? bandaReglaOperativa(qRegAnterior) : null;
  const conVert = m.minVert > 0;
  // Balance de masa: caudal de entrada = descargado medio + cambio de volumen / tiempo
  let qEntrada = null, deltaH = null, spanH = null;
  const fin = nivelSiguiente != null ? { t: `${diaSiguiente(dia)} 00:00`, v: nivelSiguiente } : m.nivelFin;
  if (m.nivelIni && fin && qReg != null) {
    const seg = (minutosDe(fin.t) - minutosDe(m.nivelIni.t)) * 60;
    if (seg >= 6 * 3600) {
      const dV = (volumenExtrapolado(fin.v) - volumenExtrapolado(m.nivelIni.v)) * 1e6;
      qEntrada = mediaDe(m.qDescHid) + dV / seg; deltaH = fin.v - m.nivelIni.v; spanH = seg / 3600;
    }
  }
  // Índices por unidad en el día (ponderados por energía en las horas con dato)
  const porUnidad = Array.from({ length: n }, (_, u) => {
    let sQm = 0, sQf = 0, sEw = 0, sEm = 0, cE = 0;
    for (const h of horas) {
      if (!h || h.linea[u] < LINEA_ESTABLE) continue;
      if (h.qMod && h.qMod[u] != null && h.qFC[u] != null) { sQm += h.qMod[u]; sQf += h.qFC[u]; }
      if (h.etaWK[u] != null && h.etaMod && h.etaMod[u] != null) { sEw += h.etaWK[u]; sEm += h.etaMod[u]; cE++; }
    }
    return {
      horas: r2(m.minLinea[u] / 60), energia: r1(m.energia[u]), arranques: m.arranques[u],
      pMedia: r2(mediaDe(m.P[u])), pMax: m.P[u].c ? r2(m.P[u].max) : null,
      qFC: r2(mediaDe(m.Qfc[u])), qWK: r2(mediaDe(m.Qwk[u])),
      fcWK: m.sumQwk[u] > 0 ? r3(m.sumPwk[u] / m.sumQwk[u]) : null,
      relModFC: sQf > 0 ? r3(sQm / sQf) : null,
      etaWK: cE ? r2(sEw / cE) : null, etaMod: cE ? r2(sEm / cE) : null,
    };
  });
  const calidad = calidadDia(todas, dia);
  // Modelo de la colina frente al caudal de Hidrometría (central completa, horas con modelo)
  let sMod = 0, sHid = 0;
  for (const h of horas) {
    if (!h || !h.qMod || h.qReg == null) continue;
    const ok = h.p.every((p, u) => !(h.linea[u] >= 0.5) || h.qMod[u] != null);
    if (!ok) continue;
    sMod += h.qMod.reduce((a, x) => a + (x || 0), 0); sHid += h.qReg;
  }
  calidad.modeloVsHidrometria = sHid > 0 ? r3(sMod / sHid) : null;
  return {
    calidad,
    v: VERSION_ANALITICA, dia, minutos: m.minutos, parcial: m.minutos < 0.9 * 1440, primero: m.primero, ultimo: m.ultimo,
    regla: {
      qReg: r2(qReg), banda: banda ? { base: r2(banda.base), min: r2(banda.min), max: r2(banda.max) } : null,
      estado: estadoReglaOperativa(qReg, banda, conVert),
      margenSup: banda && qReg != null ? r2(banda.max - qReg) : null, margenInf: banda && qReg != null ? r2(qReg - banda.min) : null,
    },
    nivel: { ini: m.nivelIni ? r3(m.nivelIni.v) : null, fin: fin ? r3(fin.v) : null, min: m.nivel.c ? r3(m.nivel.min) : null, max: m.nivel.c ? r3(m.nivel.max) : null, media: r3(mediaDe(m.nivel)), deltaH: r3(deltaH), difSensores: m.nivel2.c && m.nivel.c ? r3(mediaDe(m.nivel2) - mediaDe(m.nivel)) : null },
    energia: r1(m.energia.reduce((a, b) => a + b, 0)), pMedia: r2(m.energia.reduce((a, b) => a + b, 0) / Math.max(1, m.minutos / 60)),
    unidadesMedia: r2(mediaDe(m.nUnidMin)), fc: r3(mediaDe(m.fc)),
    vertedero: { qMedia: r2(mediaDe(m.qVert)), qMax: m.qVert.c ? r2(m.qVert.max) : null, minutos: m.minVert, volHm3: r3(((mediaDe(m.qVert) || 0) * m.minutos * 60) / 1e6), conVertimiento: conVert, aMax: m.aComp.some((a) => a.c) ? m.aComp.map((a) => (a.c ? r3(a.max) : null)) : null },
    descargado: { qMedia: r2(mediaDe(m.qDescHid)), qMax: m.qDescHid.c ? r2(m.qDescHid.max) : null, qMin: m.qDescHid.c ? r2(m.qDescHid.min) : null, qMediaLoggerNet: r2(mediaDe(m.qDescLog)) },
    balance: { qEntrada: r1(qEntrada), horas: r2(spanH) },
    unidades: porUnidad, horas,
  };
}

/* Resumen de varios días seguidos (filas de minuto ya unidas al nivel).
   anterior: { dia, qReg } del día previo al primero, si se conoce. */
function resumirDias(filas, { cond = null, conModelo = true, anterior = null } = {}) {
  const porDia = agruparPorDia(filas);
  const dias = [...porDia.keys()].sort();
  const nU = numeroUnidades(filas);
  const nivel00 = new Map();
  for (const r of filas) if (r.nivel != null && r.t.slice(11) === "00:00") nivel00.set(r.t.slice(0, 10), r.nivel);
  const out = [];
  let prev = anterior;
  for (const d of dias) {
    const qRegAnterior = prev && prev.dia === diaAnterior(d) && prev.qReg != null ? prev.qReg : null;
    const res = resumenDia(d, porDia.get(d), { qRegAnterior, nivelSiguiente: nivel00.get(diaSiguiente(d)) ?? null, cond, conModelo, nU });
    out.push(res);
    prev = { dia: d, qReg: res.regla.qReg };
  }
  return out;
}


/* Calidad de los datos de un día y verificaciones que no dependen del modelo:
   - completitud (minutos de generación y con nivel), hueco más largo;
   - nivel del radar "congelado" (mismo valor seguido) y diferencia con el 2.º sensor;
   - columna QTurbinadoUx_FC de LoggerNet frente a la regla del F.C.;
   - vertedero: caudal medido frente a la Tabla 10.6 con las aperturas medidas (m). */
function calidadDia(filas, dia) {
  let maxHueco = 0, conNivel = 0, congelado = 0, run = 0, prevN = null, prevT = null;
  const errVert = [];
  for (const r of filas) {
    const t = minutosDe(r.t);
    if (prevT != null && t - prevT - 1 > maxHueco) maxHueco = t - prevT - 1;
    prevT = t;
    if (r.nivel != null) {
      conNivel++;
      if (prevN != null && r.nivel === prevN) { run++; if (run > congelado) congelado = run; } else run = 0;
      prevN = r.nivel;
    }
    if (r.qVert != null && r.qVert > 5 && r.aComp && r.nivel != null && r.aComp.every((a) => a != null)) {
      const calc = caudalVertederoDetallado(r.nivel, r.aComp.map((a) => (a > 0.02 ? a : 0))).total;
      errVert.push((calc - r.qVert) / r.qVert);
    }
  }
  if (filas.length) {
    const ini = minutosDe(`${dia} 00:00`), fin = minutosDe(`${dia} 23:59`);
    maxHueco = Math.max(maxHueco, minutosDe(filas[0].t) - ini, fin - minutosDe(filas[filas.length - 1].t));
  }
  const vc = verificarColumnaLoggerNet(filas);
  errVert.sort((a, b) => a - b);
  return {
    minutosGen: filas.length, minutosNivel: conNivel, maxHuecoMin: maxHueco, nivelCongeladoMin: congelado,
    columnaFC: vc.minutos ? { minutos: vc.minutos, coinciden: vc.coinciden } : null,
    vertedero: errVert.length ? { minutos: errVert.length, errMedianaPct: r2(100 * errVert[Math.floor(errVert.length / 2)]), errMaxAbsPct: r2(100 * Math.max(Math.abs(errVert[0]), Math.abs(errVert[errVert.length - 1]))) } : null,
  };
}

/* Prueba del despacho intradiario con un día ya cerrado: se simula el nivel
   hora a hora con la potencia y las unidades reales (lo que hace la app) y
   se compara con el nivel medido a las 24 h.
   - qEntradaAyer: caudal de entrada del día anterior (balance), como
     "pronóstico" sencillo: es el error que vería el operador.
   - con la entrada del propio día, el error mide solo el modelo de la
     turbina frente al caudal de Hidrometría con el que se hizo el balance. */
function validarDespachoDia(res, { qEntradaAyer = null, cond = null } = {}) {
  if (!res || res.parcial || res.vertedero.conVertimiento || res.nivel.ini == null || res.nivel.fin == null || res.balance.qEntrada == null || res.balance.horas < 23.9) return null;
  if (res.horas.some((h) => !h || h.min < 50)) return null;
  const horas = res.horas.map((h) => ({
    potenciaMW: h.e.reduce((a, x) => a + (x || 0), 0) / (h.min / 60),
    unidades: h.linea.filter((x) => x >= 0.5).length,
    qRio: h.qDesc,
  }));
  const sim = (q) => {
    const s = simularDespachoHorario({ nivelInicial: res.nivel.ini, horas, qEntrada: q, cond: cond || undefined });
    return { errCm: r1((s.Hfinal - res.nivel.fin) * 100), qTurbMedio: r1(s.qTurbMedio) };
  };
  const mismo = sim(res.balance.qEntrada);
  const ayer = qEntradaAyer != null ? sim(qEntradaAyer) : null;
  return { errCmMismoDia: mismo.errCm, errCmEntradaAyer: ayer ? ayer.errCm : null, qEntradaAyer: r1(qEntradaAyer), qEntrada: res.balance.qEntrada, qTurbModelo: mismo.qTurbMedio, qRegulado: res.regla.qReg };
}

/* Día en curso: qué promedio debe tener el resto del día para cerrar dentro
   de la banda. qAcum = promedio regulado hasta ahora, minutos = minutos con
   dato, minutosDia = minutos con dato + minutos que faltan del día (1440 si
   no hay huecos). Devuelve null si ya no hay minutos por delante. */
function requeridoRestoDelDia(qAcum, minutos, banda, fcActual, minutosDia = 1440) {
  if (qAcum == null || !banda) return null;
  const resto = minutosDia - minutos;
  if (resto <= 0) return null;
  const qMin = (banda.min * minutosDia - qAcum * minutos) / resto;
  const qMax = (banda.max * minutosDia - qAcum * minutos) / resto;
  return { resto, qMin, qMax, pMin: fcActual ? qMin * fcActual : null, pMax: fcActual ? qMax * fcActual : null };
}
function cierreProyectado(qAcum, minutos, qResto, minutosDia = 1440) {
  if (qAcum == null || qResto == null) return null;
  const resto = Math.max(0, minutosDia - minutos);
  return (qAcum * minutos + qResto * resto) / (minutos + resto);
}

/* Estadísticas del estado regulatorio sobre una lista de resúmenes diarios. */
function estadisticasRegla(dias) {
  const conteo = { cumple: 0, por_encima: 0, por_debajo: 0, excepcion: 0, sin_base: 0 };
  let racha = 0, rachaMax = 0;
  const completos = dias.filter((d) => !d.parcial);
  for (const d of completos) {
    conteo[d.regla.estado] = (conteo[d.regla.estado] || 0) + 1;
    if (d.regla.estado === "cumple") { racha++; rachaMax = Math.max(rachaMax, racha); } else if (d.regla.estado !== "excepcion" && d.regla.estado !== "sin_base") racha = 0;
  }
  const evaluados = conteo.cumple + conteo.por_encima + conteo.por_debajo;
  return { dias: completos.length, evaluados, conteo, pctCumple: evaluados ? (100 * conteo.cumple) / evaluados : null, rachaActual: racha, rachaMax };
}

/* Serie horaria compacta (columnas) de un mes, a partir de los resúmenes diarios. */
function serieHoraria(dias) {
  const cols = { t: [], nivel: [], qReg: [], qVert: [], qDesc: [], fc: [], p: [], qFC: [], qWK: [], fcWK: [], qMod: [], etaWK: [], etaMod: [], linea: [], qComp: [], aComp: [] };
  for (const d of dias) for (const h of d.horas) {
    if (!h) continue;
    cols.t.push(h.t); cols.nivel.push(h.nivel); cols.qReg.push(h.qReg); cols.qVert.push(h.qVert); cols.qDesc.push(h.qDesc); cols.fc.push(h.fc);
    cols.p.push(h.p); cols.qFC.push(h.qFC); cols.qWK.push(h.qWK); cols.fcWK.push(h.fcWK); cols.qMod.push(h.qMod); cols.etaWK.push(h.etaWK); cols.etaMod.push(h.etaMod); cols.linea.push(h.linea);
    cols.qComp.push(h.qComp); cols.aComp.push(h.aComp);
  }
  return cols;
}
/* Fila diaria compacta para el histórico (sin el detalle horario). */
function filaDiaria(d) {
  const { horas, ...resto } = d;
  return resto;
}

/* Índice relativo por unidad (orden de mérito): F.C. WK de cada unidad
   frente a la media de las unidades con dato, en un conjunto de días.
   factor > 1 = la unidad entrega más MW por unidad de caudal WK que la
   media. Es relativo y depende de la calibración de cada WK. */
function indiceRelativoUnidades(dias, { minHoras = 6 } = {}) {
  const n = dias.reduce((k, d) => Math.max(k, d.unidades.length), 0);
  const sP = Array(n).fill(0), sQ = Array(n).fill(0), hs = Array(n).fill(0);
  for (const d of dias) d.unidades.forEach((u, i) => {
    if (u.fcWK != null && u.energia > 0 && u.horas >= 1) { sP[i] += u.energia; sQ[i] += u.energia / u.fcWK; hs[i] += u.horas; }
  });
  const fc = sP.map((p, i) => (hs[i] >= minHoras && sQ[i] > 0 ? p / sQ[i] : null));
  const validos = fc.filter((x) => x != null);
  const media = validos.length ? validos.reduce((a, b) => a + b, 0) / validos.length : null;
  return fc.map((x, i) => ({ unidad: i + 1, fcWK: x, horas: hs[i], factor: x != null && media ? x / media : null }));
}

export {
  VERSION_ANALITICA, UMBRAL_VERTIMIENTO_M3S, GAMMA_MAX_MODELO,
  resumirMinutos, resumenHora, resumenDia, resumirDias, agruparPorDia, numeroUnidades,
  requeridoRestoDelDia, cierreProyectado, calidadDia, validarDespachoDia, estadisticasRegla, serieHoraria, filaDiaria, indiceRelativoUnidades,
  diaSiguiente, diaAnterior, minutosDe,
};
export const BANDA_RES1891 = REGLA_OPERATIVA_RES1891.bandaRelativa;
