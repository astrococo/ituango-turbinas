/* ============================================================
   Operación medida (LoggerNet): lectura y cálculo, sin interfaz.
   ------------------------------------------------------------
   Fuente: archivo plano TOA5 de LoggerNet (CR6, dato cada minuto) o
   los CSV diarios que deja el relay de LoggerNet en el
   repositorio privado. Columnas: GeneracionU1..4_MW_Avg (potencia en
   bornes), QTurbinadoU1..4_FC_Avg (= potencia / F.C. de Hidrometría:
   no es una medición), QTurbinado_U1..4_Avg (Winter-Kennedy, aún sin
   calibrar: se lee pero la app no lo usa) y Caudal_Total_Avg (vertedero). El nivel del
   embalse viene de otro archivo (All_Data, Nivel_Radar_msnm_Avg, cada
   5 min) y se une por hora con unirNivel.
   La hora es la del datalogger (se trata como hora de Colombia).
   ============================================================ */
import {
  bandaReglaOperativa,
  estadoReglaOperativa,
  CONDICION_DESCARGA_DISENO,
  FC_HIDROMETRIA_POR_NIVEL,
  factorConversionHidrometria,
  rendimientoGenerador,
  resolverGammaParaPotencia,
} from "./modelo.js";

const UNIDADES_LOGGERNET = [1, 2, 3, 4];
/* Unidades de las columnas que en LoggerNet vienen sin unidad (informadas por
   operación, 3-nov-2026). Se usan cuando meta/*.json no trae la unidad. */
const UNIDAD_COLUMNA = [
  [/^Pos[12]Comp\d/i, "%"],
  [/^MedComp\d/i, "mm"],
  [/^Open_Gate\d/i, "m"],
  [/^Caudal_Comp\d/i, "m³/s"],
  [/^Caudal_Total/i, "m³/s"],
  [/^QTurbinado/i, "m³/s"],
  [/^Generacion/i, "MW"],
  [/^Nivel_.*msnm/i, "msnm"],
];
function unidadColumna(nombre, unidadMeta) {
  if (unidadMeta && String(unidadMeta).trim()) return String(unidadMeta).trim();
  const u = UNIDAD_COLUMNA.find(([re]) => re.test(nombre));
  return u ? u[1] : null;
}
const P_EN_LINEA_MW = 20; // por debajo, la unidad se considera detenida (igual que el monitoreo)

/* Separa una línea CSV/TOA5 (campos de texto entre comillas, sin comillas escapadas). */
function separarCampos(linea) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') { q = !q; continue; }
    if (c === "," && !q) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}
const aNumero = (v) => {
  if (v == null || v === "" || /^(nan|-?inf)$/i.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* Lee texto TOA5 (4 líneas de cabecera) o CSV del relay (cabecera "timestamp,...").
   Devuelve { filas: [{t:"AAAA-MM-DD HH:MM", p:[4], q:[4], q2:[4], qVert, nivel}], columnas, formato, avisos }.
   Si el archivo solo trae nivel (All_Data), p y q quedan en null.
   Las filas incompletas o con hora inválida se descartan (se cuentan en avisos). */
function leerLoggerNet(texto) {
  const lineas = String(texto).split(/\r?\n/);
  const avisos = [];
  let i0, nombres, formato;
  if (/^"?TOA5"?,/.test(lineas[0] || "")) {
    formato = "TOA5"; nombres = separarCampos(lineas[1] || ""); i0 = 4;
  } else {
    formato = "CSV";
    // si el texto empieza a mitad del archivo (lectura parcial), no hay cabecera
    nombres = separarCampos(lineas[0] || ""); i0 = 1;
  }
  const idx = (re) => nombres.findIndex((n) => re.test(n));
  const iT = idx(/^timestamp$/i);
  if (iT < 0) return { filas: [], columnas: nombres, formato, avisos: ["El archivo no tiene la columna TIMESTAMP / timestamp"] };
  const iP = UNIDADES_LOGGERNET.map((u) => idx(new RegExp(`^GeneracionU${u}_MW`, "i")));
  const iQ = UNIDADES_LOGGERNET.map((u) => idx(new RegExp(`^QTurbinadoU${u}_FC`, "i")));
  const iQ2 = UNIDADES_LOGGERNET.map((u) => idx(new RegExp(`^QTurbinado_U${u}_`, "i")));
  const iV = idx(/^Caudal_Total_Avg$/i);
  // Vertedero por compuerta (relay v2): caudal y apertura de las compuertas 1..4
  const iQC = [1, 2, 3, 4].map((g) => idx(new RegExp(`^Caudal_Comp${g}_`, "i")));
  const iAC = [1, 2, 3, 4].map((g) => idx(new RegExp(`^Open_Gate${g}_`, "i")));
  const iDesc = idx(/^Caudal_Total_Descargado/i);
  const iTurb = idx(/^Caudal_Total_Turbinado/i);
  // Solo el radar: Nivel_embalse_msnm_Avg es otro sensor y no se usa.
  const iN = idx(/^Nivel_Radar_msnm/i);
  const soloNivel = iN >= 0 && iP.every((k) => k < 0);
  const faltan = [...iP.map((k, j) => (k < 0 ? `GeneracionU${j + 1}_MW_Avg` : null)), ...iQ.map((k, j) => (k < 0 ? `QTurbinadoU${j + 1}_FC_Avg` : null))].filter(Boolean);
  if (faltan.length && !soloNivel) avisos.push(`Faltan columnas: ${faltan.join(", ")}`);
  const porT = new Map();
  let descartadas = 0;
  for (let k = i0; k < lineas.length; k++) {
    const l = lineas[k];
    if (!l || l.length < 16) continue;
    const f = separarCampos(l);
    if (f.length !== nombres.length) { descartadas++; continue; }
    const m = f[iT].match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
    if (!m) { descartadas++; continue; }
    const t = `${m[1]} ${m[2]}:${m[3]}`;
    porT.set(t, {
      t,
      p: iP.map((c) => (c < 0 ? null : aNumero(f[c]))),
      q: iQ.map((c) => (c < 0 ? null : aNumero(f[c]))),
      q2: iQ2.map((c) => (c < 0 ? null : aNumero(f[c]))),
      qVert: iV < 0 ? null : aNumero(f[iV]),
      nivel: iN < 0 ? null : aNumero(f[iN]),
      ...(iQC.some((c) => c >= 0) ? { qComp: iQC.map((c) => (c < 0 ? null : aNumero(f[c]))) } : {}),
      ...(iAC.some((c) => c >= 0) ? { aComp: iAC.map((c) => (c < 0 ? null : aNumero(f[c]))) } : {}),
      ...(iDesc >= 0 ? { qDesc: aNumero(f[iDesc]) } : {}),
      ...(iTurb >= 0 ? { qTurbLog: aNumero(f[iTurb]) } : {}),
    });
  }
  if (descartadas) avisos.push(`${descartadas} líneas incompletas o sin hora válida descartadas`);
  const filas = [...porT.values()].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return { filas, columnas: nombres, formato, avisos, columnaNivel: iN < 0 ? null : nombres[iN], soloNivel, tieneQ2: iQ2.some((k) => k >= 0), tieneCompuertas: iQC.some((k) => k >= 0) || iAC.some((k) => k >= 0) };
}

const minutosDe = (t) => Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10), +t.slice(11, 13), +t.slice(14, 16)) / 60000;
/* Asigna a cada fila de generación el último nivel registrado a esa hora o
   antes, si no tiene más de `toleranciaMin` minutos (el nivel viene cada 5). */
function unirNivel(filas, filasNivel, toleranciaMin = 10) {
  const niv = filasNivel.filter((r) => r.nivel != null).map((r) => [minutosDe(r.t), r.nivel]);
  let j = 0, sinNivel = 0;
  const out = filas.map((r) => {
    const m = minutosDe(r.t);
    while (j + 1 < niv.length && niv[j + 1][0] <= m) j++;
    const ok = niv.length && niv[j][0] <= m && m - niv[j][0] <= toleranciaMin;
    if (!ok) sinNivel++;
    return ok ? { ...r, nivel: niv[j][1] } : { ...r, nivel: r.nivel ?? null };
  });
  return { filas: out, sinNivel };
}

/* Caudal regulado de Hidrometría en un minuto: potencia total en bornes /
   F.C. vigente (con el nivel del radar; sin nivel válido, 1,80). Es lo que
   usa la app de Hidrometría para la regla operativa (Q_regulado =
   Q_generado + descarga intermedia, que se toma 0). */
function caudalRegulado(r) {
  const P = r.p.reduce((s, x) => s + (x != null && x > 0 ? x : 0), 0);
  if (r.p.every((x) => x == null)) return null;
  return P / factorConversionHidrometria(r.nivel, r.t);
}
/* Caudal total de la columna QTurbinadoUx_FC de LoggerNet en un minuto. */
function caudalColumnaLoggerNet(r) {
  if (r.q.every((x) => x == null)) return null;
  return r.q.reduce((s, x, u) => s + (x != null && r.p[u] != null && r.p[u] > 0 ? x : 0), 0);
}

/* F.C. implícito (P/Q) de una unidad y, desde el cambio de regla, el nivel
   con el que Hidrometría lo calculó: nivel = (F.C. − b) / a. */
function fcImplicito(p, q) {
  return p != null && q != null && p > P_EN_LINEA_MW && q > 1e-6 ? p / q : null;
}
function nivelDesdeFC(fc, t) {
  if (fc == null || t < FC_HIDROMETRIA_POR_NIVEL.desde) return null;
  return (fc - FC_HIDROMETRIA_POR_NIVEL.b) / FC_HIDROMETRIA_POR_NIVEL.a;
}

/* Promedia en intervalos de `minutos` (15 por defecto). Cada intervalo lleva
   el promedio de P y Q por unidad (minutos con dato), el nivel (columna si
   existe; si no, el implícito en el F.C. desde el 29-oct-2026) y cuántos
   minutos tuvo. Las unidades en línea se cuentan con la potencia media. */
function agregarIntervalos(filas, minutos = 15) {
  const grupos = new Map();
  for (const r of filas) {
    const hh = +r.t.slice(11, 13), mm = +r.t.slice(14, 16);
    const m0 = Math.floor((hh * 60 + mm) / minutos) * minutos;
    const t = `${r.t.slice(0, 11)}${String(Math.floor(m0 / 60)).padStart(2, "0")}:${String(m0 % 60).padStart(2, "0")}`;
    if (!grupos.has(t)) grupos.set(t, { t, n: 0, sp: [0, 0, 0, 0], cp: [0, 0, 0, 0], sq: [0, 0, 0, 0], cq: [0, 0, 0, 0], sq2: [0, 0, 0, 0], cq2: [0, 0, 0, 0], sV: 0, cV: 0, sNiv: 0, cNiv: 0, sNivFC: 0, cNivFC: 0, sFC: [0, 0, 0, 0], cFC: [0, 0, 0, 0], sReg: 0, cReg: 0, sLog: 0, cLog: 0 });
    const g = grupos.get(t);
    g.n++;
    for (let u = 0; u < 4; u++) {
      if (r.p[u] != null) { g.sp[u] += r.p[u]; g.cp[u]++; }
      if (r.q[u] != null) { g.sq[u] += r.q[u]; g.cq[u]++; }
      if (r.q2 && r.q2[u] != null) { g.sq2[u] += r.q2[u]; g.cq2[u]++; }
      const fc = fcImplicito(r.p[u], r.q[u]);
      if (fc != null) {
        g.sFC[u] += fc; g.cFC[u]++;
        const nv = nivelDesdeFC(fc, r.t);
        if (nv != null) { g.sNivFC += nv; g.cNivFC++; }
      }
    }
    if (r.nivel != null) { g.sNiv += r.nivel; g.cNiv++; }
    if (r.qVert != null) { g.sV += r.qVert; g.cV++; }
    const qr = caudalRegulado(r); if (qr != null) { g.sReg += qr; g.cReg++; }
    const ql = caudalColumnaLoggerNet(r); if (ql != null) { g.sLog += ql; g.cLog++; }
  }
  return [...grupos.values()].sort((a, b) => (a.t < b.t ? -1 : 1)).map((g) => {
    const p = g.sp.map((s, u) => (g.cp[u] ? s / g.cp[u] : null));
    const q = g.sq.map((s, u) => (g.cq[u] ? s / g.cq[u] : null));
    const fc = g.sFC.map((s, u) => (g.cFC[u] ? s / g.cFC[u] : null));
    const q2 = g.sq2.map((s, u) => (g.cq2[u] ? s / g.cq2[u] : null));
    const nivelColumna = g.cNiv ? g.sNiv / g.cNiv : null;
    const nivelFC = g.cNivFC ? g.sNivFC / g.cNivFC : null;
    return { t: g.t, minutos: g.n, p, q, q2, qVert: g.cV ? g.sV / g.cV : null, fc, nivelColumna, nivelFC, qReg: g.cReg ? g.sReg / g.cReg : null, qLog: g.cLog ? g.sLog / g.cLog : null };
  });
}

/* Caudal del modelo para cada intervalo: con la potencia de cada unidad en
   línea (bornes → eje), el nivel del embalse y la condición de descarga,
   se busca en la colina la apertura que la entrega (mismo cálculo que el
   monitoreo). Caché por potencia (0,5 MW), nivel (0,02 m) y unidades.
   nivelDe(intervalo) decide el nivel; si devuelve null, no se calcula. */
function caudalModeloIntervalos(intervalos, { nivelDe, cond = CONDICION_DESCARGA_DISENO, gammaMax = 31.98, cache = new Map() } = {}) {
  return intervalos.map((iv) => {
    const nivel = nivelDe(iv);
    const enLinea = iv.p.map((p) => p != null && p > P_EN_LINEA_MW);
    const n = enLinea.filter(Boolean).length;
    const qMod = [null, null, null, null];
    const gamma = [null, null, null, null]; // apertura del distribuidor estimada (grados); null si la unidad no está en línea
    let ok = nivel != null;
    if (ok) {
      for (let u = 0; u < 4; u++) {
        if (!enLinea[u]) { qMod[u] = 0; continue; }
        const pb = Math.round(iv.p[u] * 2) / 2, nv = Math.round(nivel * 50) / 50;
        const clave = `${pb}|${nv}|${n}`;
        if (!cache.has(clave)) {
          const r = resolverGammaParaPotencia(nv, pb / rendimientoGenerador(pb), n, gammaMax, null, cond);
          cache.set(clave, r.resultado && r.alcanzable !== false ? { q: r.resultado.Q, g: r.gamma } : null);
        }
        const c = cache.get(clave);
        qMod[u] = c ? c.q : null;
        gamma[u] = c ? c.g : null;
        if (qMod[u] == null) ok = false;
      }
    }
    const qHid = iv.p.map((p, u) => (p != null && p > P_EN_LINEA_MW && iv.q[u] != null ? iv.q[u] : p != null && p > P_EN_LINEA_MW ? null : 0));
    const q2 = iv.q2 ? iv.p.map((p, u) => (p != null && p > P_EN_LINEA_MW ? iv.q2[u] : 0)) : [null, null, null, null];
    return {
      ...iv, nivel, n, qMod, gamma,
      qModTotal: ok ? qMod.reduce((s, x) => s + x, 0) : null,
      qHidTotal: iv.qReg,            // Hidrometría: potencia / F.C. vigente (regla de su app)
      qLogTotal: qHid.every((x) => x != null) ? qHid.reduce((s, x) => s + x, 0) : null, // columna de LoggerNet
      q2Total: q2.every((x) => x != null) ? q2.reduce((s, x) => s + x, 0) : null,
      pTotal: iv.p.reduce((s, x) => s + (x != null && x > 0 ? x : 0), 0),
    };
  });
}

/* Verifica cada minuto contra la regla de F.C. vigente: con el nivel de la
   columna si existe; si no, antes del cambio se compara con 1,62 y después
   solo se reporta el nivel implícito. Tolerancia relativa 0,2 %. */
function verificarFC(filas, tol = 0.002) {
  let antes = 0, antesOk = 0, despues = 0, despuesOk = 0, despuesSinNivel = 0;
  const niveles = [];
  for (const r of filas) {
    for (let u = 0; u < 4; u++) {
      const fc = fcImplicito(r.p[u], r.q[u]);
      if (fc == null) continue;
      if (r.t < FC_HIDROMETRIA_POR_NIVEL.desde) { antes++; if (Math.abs(fc / 1.62 - 1) <= tol) antesOk++; }
      else {
        despues++;
        niveles.push(nivelDesdeFC(fc, r.t));
        if (r.nivel != null) { if (Math.abs(fc / factorConversionHidrometria(r.nivel, r.t) - 1) <= tol) despuesOk++; }
        else despuesSinNivel++;
      }
    }
  }
  niveles.sort((a, b) => a - b);
  const q = (p) => (niveles.length ? niveles[Math.min(niveles.length - 1, Math.floor(p * (niveles.length - 1)))] : null);
  return { antes, antesOk, despues, despuesOk, despuesSinNivel, nivelImplicito: { p05: q(0.05), mediana: q(0.5), p95: q(0.95) } };
}

/* ¿La columna QTurbinadoUx_FC de LoggerNet sigue la regla de Hidrometría?
   Minuto a minuto, F.C. de la columna (ΣP/ΣQ de las unidades en línea)
   frente al F.C. de la regla con el nivel del radar. Tolerancia 0,2 %.
   Devuelve cuántos minutos coinciden y el primer y último minuto que no
   (con cuántos de ellos están en 1,62, es decir, con el factor anterior). */
function verificarColumnaLoggerNet(filas, tol = 0.002) {
  let n = 0, ok = 0, con162 = 0, primero = null, ultimo = null;
  for (const r of filas) {
    let P = 0, Q = 0;
    for (let u = 0; u < 4; u++) if (r.p[u] != null && r.p[u] > P_EN_LINEA_MW && r.q[u] != null && r.q[u] > 1e-6) { P += r.p[u]; Q += r.q[u]; }
    if (!(Q > 0)) continue;
    n++;
    const fc = P / Q, regla = factorConversionHidrometria(r.nivel, r.t);
    if (Math.abs(fc / regla - 1) <= tol) { ok++; continue; }
    if (Math.abs(fc / 1.62 - 1) <= tol) con162++;
    if (primero == null) primero = r.t;
    ultimo = r.t;
  }
  return { minutos: n, coinciden: ok, noCoinciden: n - ok, con162, primero, ultimo };
}

/* Regla operativa (Res. 1891) día por día con los datos medidos: promedio
   del caudal regulado (minutos con dato), banda = promedio del día anterior
   ± 4,70 %, estado; con vertimiento (> 1 m³/s en algún minuto) se marca
   excepción. Un día con menos del 90 % de los minutos queda "parcial". */
function reglaOperativaDiaria(filas) {
  const dias = new Map();
  for (const r of filas) {
    const d = r.t.slice(0, 10);
    if (!dias.has(d)) dias.set(d, { dia: d, s: 0, c: 0, vert: false, qVertMax: 0 });
    const g = dias.get(d);
    const q = caudalRegulado(r);
    if (q != null) { g.s += q; g.c++; }
    if (r.qVert != null && r.qVert > 1) { g.vert = true; g.qVertMax = Math.max(g.qVertMax, r.qVert); }
  }
  const lista = [...dias.values()].sort((a, b) => (a.dia < b.dia ? -1 : 1));
  return lista.map((g, k) => {
    const prom = g.c ? g.s / g.c : null;
    const ant = k > 0 && lista[k - 1].c ? lista[k - 1] : null;
    const contiguo = ant && minutosDe(`${g.dia} 00:00`) - minutosDe(`${ant.dia} 00:00`) === 1440;
    const banda = contiguo ? bandaReglaOperativa(ant.s / ant.c) : null;
    return { dia: g.dia, qPromedio: prom, minutos: g.c, parcial: g.c < 0.9 * 1440, conVertimiento: g.vert, qVertMax: g.qVertMax, banda, estado: estadoReglaOperativa(prom, banda, g.vert) };
  });
}

/* Resumen por unidad sobre los intervalos con modelo calculado: energía
   (MWh), volumen turbinado (hm³) según Hidrometría y según el modelo, horas
   en línea. El volumen solo suma los intervalos donde ambos existen. */
function resumenPorUnidad(intervalos) {
  return UNIDADES_LOGGERNET.map((u0, u) => {
    let E = 0, vH = 0, vM = 0, v2 = 0, h = 0, comparados = 0;
    for (const iv of intervalos) {
      const dt = iv.minutos / 60;
      const p = iv.p[u];
      if (p != null && p > P_EN_LINEA_MW) {
        E += p * dt; h += dt;
        const fcIv = iv.qReg > 0 && iv.pTotal > 0 ? iv.pTotal / iv.qReg : null; // F.C. medio del intervalo
        if (fcIv != null && iv.qMod && iv.qMod[u] != null) {
          vH += (p / fcIv) * dt * 3600; vM += iv.qMod[u] * dt * 3600; comparados += dt;
          if (iv.q2 && iv.q2[u] != null) v2 += iv.q2[u] * dt * 3600;
        }
      }
    }
    return { unidad: u0, energiaMWh: E, horasEnLinea: h, horasComparadas: comparados, volHidHm3: vH / 1e6, volModHm3: vM / 1e6, volQ2Hm3: v2 / 1e6, difPct: vM > 0 ? (vH / vM - 1) * 100 : null, difQ2Pct: vM > 0 && v2 > 0 ? (v2 / vM - 1) * 100 : null };
  });
}

/* ---------- Calidad del dato de LoggerNet ----------
   1) Exclusiones registradas (calidad/exclusiones.json del repositorio de
      datos): [{ desde, hasta, motivo }], horas de Colombia "AAAA-MM-DD HH:MM",
      ambos extremos incluidos. Son tramos confirmados como falla de la fuente
      (p. ej. el servidor que actualiza el archivo plano): se quitan del cálculo.
   2) Valores congelados: la potencia de todas las unidades idéntica (y no
      nula) durante `minCongelado` minutos seguidos o más. En la operación
      normal no se repite más de unos pocos minutos. Por defecto solo se
      SEÑALAN (no se quitan): el archivo plano es la misma fuente del cálculo
      oficial; para quitarlos, registre el tramo en las exclusiones.
   Las unidades detenidas (potencia 0) no se tocan: una parada real se ve igual.
   Devuelve { filas, excluidas: [...], congelados: [...] } con { desde, hasta, minutos, motivo }. */
function aplicarCalidad(filas, exclusiones = [], { minCongelado = 30, excluirCongelados = false } = {}) {
  const fuera = new Set(), excluidas = [], congelados = [];
  for (const e of exclusiones || []) {
    if (!e || !e.desde || !e.hasta) continue;
    const idx = [];
    filas.forEach((r, i) => { if (r.t >= e.desde && r.t <= e.hasta) idx.push(i); });
    idx.forEach((i) => fuera.add(i));
    if (idx.length) excluidas.push({ desde: filas[idx[0]].t, hasta: filas[idx[idx.length - 1]].t, minutos: idx.length, motivo: e.motivo || "Exclusión registrada" });
  }
  const clave = (r) => (r.p || []).map((x) => (x == null ? "n" : x)).join("|");
  for (let i = 0; i < filas.length;) {
    let j = i;
    const k = clave(filas[i]);
    while (j + 1 < filas.length && clave(filas[j + 1]) === k) j++;
    const suma = (filas[i].p || []).reduce((a, x) => a + (x || 0), 0);
    if (j - i + 1 >= minCongelado && suma > 0) {
      let n = 0;
      for (let q = i; q <= j; q++) if (!fuera.has(q)) { n++; if (excluirCongelados) fuera.add(q); }
      if (n) congelados.push({ desde: filas[i].t, hasta: filas[j].t, minutos: n, motivo: `Valores congelados: ${j - i + 1} min idénticos en todas las unidades` });
    }
    i = j + 1;
  }
  // Winter-Kennedy en 0 con la unidad generando (p. ej. al reiniciarse el registrador): sin dato, no cero
  let wkSinDato = 0;
  const salida = (fuera.size ? filas.filter((_, i) => !fuera.has(i)) : filas).map((r) => {
    if (!r.q2 || !r.p || !r.q2.some((q, i) => q != null && q < 1 && r.p[i] > P_EN_LINEA_MW)) return r;
    wkSinDato++;
    return { ...r, q2: r.q2.map((q, i) => (q != null && q < 1 && r.p[i] > P_EN_LINEA_MW ? null : q)) };
  });
  return { filas: salida, excluidas, congelados, wkSinDato };
}

export { aplicarCalidad, UNIDAD_COLUMNA, unidadColumna, UNIDADES_LOGGERNET, P_EN_LINEA_MW, separarCampos, leerLoggerNet, unirNivel, caudalRegulado, caudalColumnaLoggerNet, verificarColumnaLoggerNet, reglaOperativaDiaria, fcImplicito, nivelDesdeFC, agregarIntervalos, caudalModeloIntervalos, verificarFC, resumenPorUnidad };
