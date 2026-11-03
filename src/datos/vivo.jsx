/* ============================================================
   Estado de la operación "en vivo" (cuasi real): se arma en el
   navegador con los CSV de hoy y de ayer que sube el relay (cada
   hora, o cada 15 min si así se programó), el histórico diario que
   calcula el proceso automático y HydroForecast. Se recarga cada
   5 minutos con la pestaña visible.
   Todo lo que se calcula aquí usa las mismas funciones que el
   histórico (src/analitica.js), así que el día en curso y los días
   cerrados se leen igual.
   ============================================================ */
import { createContext, useContext, useMemo } from "react";
import { leerLoggerNet, unirNivel } from "../operacion.js";
import { resumenDia, indiceRelativoUnidades, requeridoRestoDelDia, cierreProyectado, minutosDe } from "../analitica.js";
import { CONDICION_DESCARGA_DEFECTO, factorConversionHidrometria, bandaReglaOperativa, NAMO, volumenExtrapolado, nivelDesdeVolumenExtrapolado, potenciaBornesDesdeEje, P_MAXIMO_ESPERADO_MW } from "../modelo.js";
import { useDatos, useCargaPeriodica, hoyColombia, ahoraColombia, sumarDias } from "./fuentes.jsx";

const Contexto = createContext(null);
const P_LINEA = 20;

/* Promedio de los últimos n minutos (filas de minuto ya unidas al nivel). */
function promedioUltimos(filas, n) {
  const sub = filas.slice(-n);
  if (!sub.length) return null;
  const nU = sub[0].p.length;
  const m = (f) => { const v = sub.map(f).filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  return {
    desde: sub[0].t, hasta: sub[sub.length - 1].t, minutos: sub.length,
    p: Array.from({ length: nU }, (_, u) => m((r) => r.p[u])),
    qFC: Array.from({ length: nU }, (_, u) => m((r) => (r.p[u] > P_LINEA ? r.q[u] : null))),
    qWK: Array.from({ length: nU }, (_, u) => m((r) => (r.p[u] > P_LINEA && r.q2 ? r.q2[u] : null))),
    nivel: m((r) => r.nivel), qVert: m((r) => r.qVert),
    qComp: sub[0].qComp ? [0, 1, 2, 3].map((g) => m((r) => (r.qComp ? r.qComp[g] : null))) : null,
    aComp: sub[0].aComp ? [0, 1, 2, 3].map((g) => m((r) => (r.aComp ? r.aComp[g] : null))) : null,
  };
}
/* Nivel hace `min` minutos (el registro más cercano anterior). */
function nivelHace(filas, min) {
  if (!filas.length) return null;
  const objetivo = minutosDe(filas[filas.length - 1].t) - min;
  for (let i = filas.length - 1; i >= 0; i--) if (filas[i].nivel != null && minutosDe(filas[i].t) <= objetivo) return { t: filas[i].t, v: filas[i].nivel };
  return null;
}

async function cargarVivo(datos) {
  const hoy = hoyColombia(), ayer = sumarDias(hoy, -1);
  const errores = [];
  const tarea = (p, etiqueta) => p.then((v) => v, (e) => { if (e && e.codigo !== 404) errores.push(`${etiqueta}: ${e.message}`); return null; });
  const ruta = (c, d) => `${c}/${d.slice(0, 4)}/${d}.csv`;
  const [obs, pron, aa] = await Promise.all([
    tarea(datos.leerHF("/api/observed/daily?days=120", "observado.json"), "HydroForecast observado"),
    tarea(datos.leerHF("/api/forecast/quarterly_outlook", "ultimo.json"), "HydroForecast pronóstico"),
    tarea(datos.leerHF("/api/aguas_arriba?hours=96", "aguas_arriba.json"), "HydroForecast aguas arriba"),
  ]);
  const out = { hoy, ayer, consultado: ahoraColombia(), errores, hf: { observado: obs, pronostico: pron, aguasArriba: aa } };
  if (!datos.conectado) return out;
  const [gA, gH, nA, nH, diario, diarioAnt, estado] = await Promise.all([
    tarea(datos.leerTexto(ruta("loggernet", ayer)), "Generación de ayer"),
    tarea(datos.leerTexto(ruta("loggernet", hoy)), "Generación de hoy"),
    tarea(datos.leerTexto(ruta("nivel", ayer)), "Nivel de ayer"),
    tarea(datos.leerTexto(ruta("nivel", hoy)), "Nivel de hoy"),
    tarea(datos.leerJSON(`derivados/diario/${hoy.slice(0, 4)}.json`), "Histórico diario"),
    hoy.slice(5) <= "01-31" ? tarea(datos.leerJSON(`derivados/diario/${+hoy.slice(0, 4) - 1}.json`), "Histórico del año anterior") : Promise.resolve(null),
    tarea(datos.leerJSON("derivados/estado.json"), "Estado del proceso"),
  ]);
  const gen = [gA, gH].filter(Boolean).flatMap((t) => leerLoggerNet(t).filas);
  const niv = [nA, nH].filter(Boolean).flatMap((t) => leerLoggerNet(t).filas);
  const filas = niv.length ? unirNivel(gen, niv).filas : gen;
  const dias = [...(diarioAnt ? diarioAnt.dias : []), ...(diario ? diario.dias : [])];
  Object.assign(out, { filas, diario: dias, estadoProceso: estado, conGeneracionHoy: !!gH, columnas: gH ? leerLoggerNet(gH.slice(0, 2000)).columnas : null });
  return out;
}

/* Cálculos sobre lo cargado (puro: se puede probar). */
function calcularVivo(c) {
  if (!c) return null;
  const { hoy, ayer, filas = [], diario = [] } = c;
  const v = { ...c };
  const filaAyer = diario.find((d) => d.dia === ayer) || null;
  v.filaAyer = filaAyer;
  // Índice relativo por unidad con los últimos 30 días cerrados
  const cerrados = diario.filter((d) => d.dia < hoy && !d.parcial);
  v.indiceUnidades = cerrados.length ? indiceRelativoUnidades(cerrados.slice(-30)) : null;
  if (!filas.length) return v;
  const ultima = filas[filas.length - 1];
  v.ultima = ultima;
  v.edadMin = minutosDe(ahoraColombia()) - minutosDe(ultima.t);
  v.actual = promedioUltimos(filas, 15);
  v.actual.t = ultima.t;
  v.ultimaHora = promedioUltimos(filas, 60);
  const pTot = (p) => p.reduce((a, x) => a + (x != null && x > 0 ? x : 0), 0);
  v.actual.pTotal = pTot(v.actual.p);
  v.actual.enLinea = v.actual.p.map((p) => p != null && p > P_LINEA);
  v.actual.fc = factorConversionHidrometria(v.actual.nivel, ultima.t);
  v.actual.qReg = v.actual.pTotal / v.actual.fc;
  v.actual.qDesc = v.actual.qReg + Math.max(0, v.actual.qVert || 0);
  v.ultimaHora.pTotal = pTot(v.ultimaHora.p);
  v.ultimaHora.qReg = v.ultimaHora.pTotal / factorConversionHidrometria(v.ultimaHora.nivel, ultima.t);
  // Tendencia del nivel
  const nAhora = v.actual.nivel;
  v.tendencia = [60, 180, 360, 1440].map((min) => {
    const h = nivelHace(filas, min);
    return h && nAhora != null ? { min, desde: h.t, delta: nAhora - h.v, cmPorHora: ((nAhora - h.v) * 100) / ((minutosDe(ultima.t) - minutosDe(h.t)) / 60) } : { min, delta: null, cmPorHora: null };
  });
  const t6 = v.tendencia[2].cmPorHora;
  v.horasANAMO = nAhora != null && t6 != null && t6 > 0.05 ? ((NAMO - nAhora) * 100) / t6 : null;
  // Día en curso (resumen con el mismo código del histórico)
  const deHoy = filas.filter((r) => r.t.startsWith(hoy));
  if (deHoy.length) {
    const porHora = Array.from({ length: 24 }, () => []);
    for (const r of deHoy) porHora[+r.t.slice(11, 13)].push(r);
    // Banda de hoy: promedio regulado de ayer. Si el histórico de ayer quedó
    // incompleto (el proceso corrió antes de que llegara todo), se recalcula
    // con los minutos de ayer ya cargados.
    let qRegAnterior = filaAyer && !filaAyer.parcial ? filaAyer.regla.qReg : null;
    v.bandaProvisional = false;
    if (qRegAnterior == null) {
      const deAyer = filas.filter((r) => r.t.startsWith(ayer));
      if (filaAyer && filaAyer.parcial && deAyer.length <= filaAyer.minutos) { qRegAnterior = filaAyer.regla.qReg; v.bandaProvisional = true; }
      else if (deAyer.length > 0) {
        v.bandaProvisional = deAyer.length < 0.9 * 1440;
        const ph = Array.from({ length: 24 }, () => []);
        for (const r of deAyer) ph[+r.t.slice(11, 13)].push(r);
        qRegAnterior = resumenDia(ayer, ph, { conModelo: false }).regla.qReg;
      }
    }
    v.resHoy = resumenDia(hoy, porHora, { qRegAnterior, cond: CONDICION_DESCARGA_DEFECTO });
    const banda = qRegAnterior != null ? bandaReglaOperativa(qRegAnterior) : null;
    v.banda = banda;
    // Minutos que faltan del día desde el último dato (el promedio final se hace con los minutos con dato)
    const restoMin = Math.max(0, 1440 - (minutosDe(ultima.t) - minutosDe(`${hoy} 00:00`) + 1));
    v.restoMin = restoMin;
    const totalMin = v.resHoy.minutos + restoMin;
    v.requerido = requeridoRestoDelDia(v.resHoy.regla.qReg, v.resHoy.minutos, banda, v.actual.fc, totalMin);
    if (v.requerido) {
      // capacidad: 4 unidades de U1–U4 a 307 MW en el eje (≈ 303,6 MW en bornes)
      v.requerido.qCapacidad = (4 * potenciaBornesDesdeEje(P_MAXIMO_ESPERADO_MW)) / v.actual.fc;
      v.requerido.superaCapacidad = v.requerido.qMin > v.requerido.qCapacidad;
      v.requerido.yaPorEncima = v.requerido.qMax < 0;
    }
    v.cierreSiSigue = cierreProyectado(v.resHoy.regla.qReg, v.resHoy.minutos, v.ultimaHora.qReg, totalMin);
    // Nivel al final del día si el resto del día turbina como la última hora y entra lo de hoy
    const qIn = v.resHoy.balance.qEntrada;
    if (qIn != null && nAhora != null) {
      const resto = restoMin;
      const dV = ((qIn - (v.ultimaHora.qReg + Math.max(0, v.ultimaHora.qVert || 0))) * resto * 60) / 1e6;
      v.nivelFinDia = nivelDesdeVolumenExtrapolado(volumenExtrapolado(nAhora) + dV);
    }
  }
  return v;
}

function ProveedorVivo({ children }) {
  const datos = useDatos();
  const carga = useCargaPeriodica(() => cargarVivo(datos), [datos.conectado, datos.leerTexto, datos.leerJSON, datos.leerHF], 5 * 60e3);
  // calcularVivo corre solo cuando llegan datos nuevos (no al cambiar "cargando")
  const vivo = useMemo(() => calcularVivo(carga.datos), [carga.datos]);
  const valor = useMemo(() => ({ ...carga, vivo }), [carga, vivo]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}
const useVivo = () => useContext(Contexto);

export { ProveedorVivo, useVivo, calcularVivo, cargarVivo, promedioUltimos };
