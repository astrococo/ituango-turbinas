/* ============================================================
   Embalse: volumen útil, volumen total y área ocupada en el tiempo,
   con las curvas oficiales del embalse (memoria CGI
   I-M-2194-044-HID-VC-CVE-001, 2022: chequeo 2015 con el LIDAR de 2012).
   - Volumen: Ec.2 (2021) del documento, 10 tramos, 219–460 msnm.
   - Área: Tabla 3 del documento interpolada en línea recta cada 5 m.
   Escalas: continua (dato de 5 min del radar, hasta 7 días), horaria
   (promedio horario del histórico) y diaria (media diaria; histórico de
   HydroForecast desde nov-2018 y LoggerNet desde jul-2026).
   ============================================================ */
import { useCallback, useMemo, useState } from "react";
import { useDatos, useCargaPeriodica, sumarDias } from "../datos/fuentes.jsx";
import { useVivo } from "../datos/vivo.jsx";
import { useHorario, useHistoricoDiario } from "../datos/historico.js";
import { leerLoggerNet } from "../operacion.js";
import { volumenTotalHm3, areaEmbalseKm2, CURVA_EMBALSE_CGI, NAMO, NAME, NIVEL_MIN_TEC } from "../modelo.js";
import { GraficoSeries, Estado, fmtNum } from "./graficos.jsx";
import { Tarjeta, Kpi, SelectorRango, rangoUltimos, fechaCorta, Nota } from "./comunes.jsx";

const NIVEL_MIN_FISICO = 350; // toma de la estructura de captación (Figura 4 de la memoria)
const V_NAMO = volumenTotalHm3(NAMO);
const V_390 = volumenTotalHm3(NIVEL_MIN_TEC);
const V_UTIL_NAMO = V_NAMO - V_390;
const A_NAMO = areaEmbalseKm2(NAMO);
const EQ_UTIL = { f: (v) => (v / V_UTIL_NAMO) * 100, unidad: "%", decimales: 1, rotulo: "% del volumen útil" };
const EQ_TOTAL = { f: (v) => (v / V_NAMO) * 100, unidad: "%", decimales: 1, rotulo: "% del volumen al NAMO" };
const EQ_AREA = { f: (a) => (a / A_NAMO) * 100, unidad: "%", decimales: 1, rotulo: "% del área al NAMO" };
const DESDE_HF = "2018-11-01";
const MAX_DIAS_CONTINUA = 7;

/* Volumen total, útil y área para un nivel (null si no hay nivel) */
function estadoEmbalse(nivel) {
  if (!Number.isFinite(nivel)) return null;
  const vt = volumenTotalHm3(nivel);
  return { vt, vu: Math.max(0, vt - V_390), area: areaEmbalseKm2(nivel) };
}

/* Niveles característicos: valores de la Figura 4 de la memoria frente a la curva */
const CARACTERISTICOS = [
  { nombre: "Nivel máximo extraordinario (NAME)", cota: NAME, doc: null },
  { nombre: "Nivel normal de operación (NAMO)", cota: NAMO, doc: "Volumen total 2.561 hm³" },
  { nombre: "Nivel mínimo técnico", cota: NIVEL_MIN_TEC, doc: "Volumen útil 965 hm³ (390–420)" },
  { nombre: "Nivel mínimo físico (captación)", cota: NIVEL_MIN_FISICO, doc: "Volumen mínimo técnico 856 hm³ (350–390); muerto 740 hm³" },
];

function BotonesEscala({ T, valor, onChange }) {
  const op = [["continua", "Continua (5 min)"], ["horaria", "Horaria"], ["diaria", "Diaria"]];
  return (
    <div style={{ display: "inline-flex", border: `1px solid ${T.line}`, borderRadius: 8, overflow: "hidden" }} role="group" aria-label="Escala de tiempo">
      {op.map(([k, r]) => <button key={k} onClick={() => onChange(k)} aria-pressed={valor === k} style={{ padding: "6px 11px", fontSize: 12.5, border: "none", borderRight: `1px solid ${T.line}`, background: valor === k ? T.accentSoft : T.panel, color: valor === k ? T.teal : T.inkMuted, fontWeight: valor === k ? 700 : 500, cursor: "pointer" }}>{r}</button>)}
    </div>
  );
}

export default function Embalse({ T, historicoHF }) {
  const d = useDatos();
  const { vivo } = useVivo() || {};
  const diario = useHistoricoDiario();
  const hoy = vivo ? vivo.hoy : null;
  const primerDiaLN = (vivo && vivo.estadoProceso && vivo.estadoProceso.primerDia) || (diario.datos && diario.datos.estado && diario.datos.estado.primerDia) || null;

  const [escala, setEscala] = useState("diaria");
  const [rangoSel, setRango] = useState(null);
  const minEscala = escala === "diaria" ? (historicoHF && historicoHF.some((r) => r.niv != null) ? DESDE_HF : primerDiaLN) : primerDiaLN;
  const atajos = escala === "continua" ? [["1", "Hoy"], ["2", "48 h"], ["7", "7 días"]]
    : escala === "horaria" ? [["7", "7 días"], ["30", "30 días"], ["90", "90 días"], ["todo", "Todo"]]
    : [["90", "90 días"], ["365", "1 año"], ["1825", "5 años"], ["todo", "Desde 2018"]];
  const rango = useMemo(() => {
    if (!hoy) return { desde: null, hasta: null };
    let r = rangoSel || rangoUltimos(hoy, escala === "continua" ? "2" : escala === "horaria" ? "30" : "365", minEscala);
    if (minEscala && r.desde < minEscala) r = { ...r, desde: minEscala };
    if (escala === "continua" && sumarDias(r.hasta, -(MAX_DIAS_CONTINUA - 1)) > r.desde) r = { ...r, desde: sumarDias(r.hasta, -(MAX_DIAS_CONTINUA - 1)) };
    return r;
  }, [rangoSel, hoy, escala, minEscala]);
  const cambiarEscala = (e) => { setEscala(e); setRango(null); };

  // Continua: archivos de nivel de 5 min del radar, día por día
  const cargarContinua = useCallback(async () => {
    if (escala !== "continua" || !d.conectado || !rango.desde) return null;
    const dias = [];
    for (let x = rango.desde; x <= rango.hasta && dias.length < MAX_DIAS_CONTINUA; x = sumarDias(x, 1)) dias.push(x);
    const textos = await Promise.all(dias.map((x) => d.leerTexto(`nivel/${x.slice(0, 4)}/${x}.csv`).catch(() => null)));
    return textos.filter(Boolean).flatMap((t) => leerLoggerNet(t).filas).filter((r) => r.nivel != null).sort((a, b) => (a.t < b.t ? -1 : 1));
  }, [escala, d, rango.desde, rango.hasta]);
  const continua = useCargaPeriodica(cargarContinua, [cargarContinua], escala === "continua" ? 5 * 60e3 : 0);
  const horario = useHorario(escala === "horaria" ? rango.desde : null, escala === "horaria" ? rango.hasta : null);

  // Serie de niveles según la escala
  const serie = useMemo(() => {
    if (!rango.desde) return null;
    if (escala === "continua") {
      const f = continua.datos;
      if (!f || !f.length) return null;
      return { t: f.map((r) => r.t.slice(0, 16)), nivel: f.map((r) => r.nivel), fuente: "Radar de nivel (LoggerNet), dato de 5 min" };
    }
    if (escala === "horaria") {
      const h = horario.datos;
      if (!h) return null;
      const filas = h.t.map((t, i) => ({ t, n: h.nivel[i] }));
      if (vivo && vivo.resHoy && rango.hasta >= vivo.hoy) {
        const ya = new Set(filas.map((r) => r.t));
        vivo.resHoy.horas.forEach((x) => { if (x && !ya.has(x.t)) filas.push({ t: x.t, n: x.nivel }); });
      }
      if (!filas.length) return null;
      return { t: filas.map((r) => r.t), nivel: filas.map((r) => r.n), fuente: "Promedio horario del radar (histórico del proceso automático y horas de hoy)" };
    }
    // Diaria: LoggerNet (radar) donde hay día procesado; antes, HydroForecast (mismo radar, media de 15 min)
    const mapa = new Map();
    for (const r of historicoHF || []) if (r.niv != null) mapa.set(r.d, { media: r.niv, min: r.nmin, max: r.nmax, fuente: "hf" });
    for (const x of (diario.datos && diario.datos.dias) || []) if (x.nivel && Number.isFinite(x.nivel.media)) mapa.set(x.dia, { media: x.nivel.media, min: x.nivel.min, max: x.nivel.max, fuente: "ln", parcial: x.parcial });
    const dias = [...mapa.keys()].filter((k) => k >= rango.desde && k <= rango.hasta).sort();
    if (!dias.length) return null;
    const g = dias.map((k) => mapa.get(k));
    return { t: dias.map((k) => `${k} 12:00`), nivel: g.map((x) => x.media), nmin: g.map((x) => x.min ?? null), nmax: g.map((x) => x.max ?? null), fuente: "Media diaria del radar: HydroForecast (datos de 15 min) hasta que hay días de LoggerNet, y LoggerNet desde entonces", diaria: true };
  }, [escala, rango.desde, rango.hasta, continua.datos, horario.datos, diario.datos, historicoHF, vivo]);

  const graf = useMemo(() => {
    if (!serie) return null;
    const e = serie.nivel.map(estadoEmbalse);
    const de = (arr, k) => arr.map((x) => (x ? x[k] : null));
    const eMin = serie.diaria ? serie.nmin.map(estadoEmbalse) : null, eMax = serie.diaria ? serie.nmax.map(estadoEmbalse) : null;
    const conBanda = (k, nombre, indice) => [
      { nombre, datos: de(e, k), indice, ancho: 2 },
      ...(serie.diaria ? [
        { nombre: "Mínimo del día", datos: de(eMin, k), color: T.inkFaint, ancho: 0.8 },
        { nombre: "Máximo del día", datos: de(eMax, k), color: T.inkFaint, ancho: 0.8 },
      ] : []),
    ];
    return {
      util: conBanda("vu", "Volumen útil", 0),
      total: conBanda("vt", "Volumen total", 1),
      area: conBanda("area", "Área ocupada", 2),
      bandas: serie.diaria ? [{ desde: 1, hasta: 2 }] : [],
      primero: serie.t[0], ultimo: serie.t[serie.t.length - 1],
    };
  }, [serie, T]);

  // Estado actual y cambio en 24 h
  const actual = useMemo(() => {
    if (!vivo || !vivo.actual || !Number.isFinite(vivo.actual.nivel)) return null;
    const e = estadoEmbalse(vivo.actual.nivel);
    const f = vivo.filas || [];
    let hace = null;
    if (f.length) {
      const fin = f[f.length - 1].t;
      const objetivo = `${sumarDias(fin.slice(0, 10), -1)}${fin.slice(10)}`;
      for (let i = f.length - 1; i >= 0; i--) if (f[i].nivel != null && f[i].t <= objetivo) { hace = { t: f[i].t, n: f[i].nivel }; break; }
    }
    const dV = hace ? e.vt - volumenTotalHm3(hace.n) : null;
    return { nivel: vivo.actual.nivel, t: vivo.ultima ? vivo.ultima.t : null, ...e, dV, qNeto: dV != null ? (dV * 1e6) / 86400 : null, haceT: hace ? hace.t : null, hastaNAMO: V_NAMO - e.vt };
  }, [vivo]);

  // Curvas oficiales (para la tarjeta de respaldo)
  const curvas = useMemo(() => {
    const x = Array.from({ length: 460 - 219 + 1 }, (_, i) => 219 + i);
    const nodos = new Map(CURVA_EMBALSE_CGI.map(([c, a, v]) => [c, { a: a / 100, v }]));
    return {
      x,
      s: [
        { nombre: "Volumen (Ec.2, 2021)", datos: x.map(volumenTotalHm3), indice: 1, ancho: 2.2 },
        { nombre: "Volumen, Tabla 3 (LIDAR 2012)", datos: x.map((c) => (nodos.has(c) ? nodos.get(c).v : null)), indice: 1, soloPuntos: true, puntos: true },
        { nombre: "Área (Tabla 3, interpolada)", datos: x.map(areaEmbalseKm2), indice: 2, ancho: 2, eje: "derecho", dash: true },
        { nombre: "Área, Tabla 3 (LIDAR 2012)", datos: x.map((c) => (nodos.has(c) ? nodos.get(c).a : null)), indice: 2, soloPuntos: true, puntos: true, eje: "derecho" },
      ],
    };
  }, []);
  const verticalesCurva = useMemo(() => [
    { x: NIVEL_MIN_FISICO, rotulo: "Mín. físico", color: T.inkFaint },
    { x: NIVEL_MIN_TEC, rotulo: "Mín. técnico", color: T.inkFaint },
    { x: NAMO, rotulo: "NAMO", color: T.inkFaint },
    { x: NAME, rotulo: "NAME", color: T.inkFaint },
  ], [T]);

  const subt = serie ? `${serie.fuente}. Del ${fechaCorta(graf.primero.slice(0, 10))} al ${fechaCorta(graf.ultimo.slice(0, 10))}${serie.diaria ? "; franja = mínimo y máximo del día" : ""}.` : "";
  const cargando = (escala === "continua" && continua.cargando) || (escala === "horaria" && horario.cargando) || (escala === "diaria" && diario.cargando && !historicoHF);
  const vacio = cargando ? "Cargando…" : d.conectado ? "Sin datos de nivel en el rango elegido." : "Conecte el repositorio de datos para ver el histórico.";
  const control = hoy && (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <BotonesEscala T={T} valor={escala} onChange={cambiarEscala} />
      <SelectorRango T={T} min={minEscala || hoy} max={hoy} valor={rango} onChange={setRango} atajos={atajos} />
    </div>
  );

  return (
    <>
      <Tarjeta T={T} id="embalse" titulo="Embalse: volumen y área ocupada"
        subtitulo="Volumen y área calculados con el nivel del radar y las curvas oficiales del embalse (CGI, memoria I-M-2194-044-HID-VC-CVE-001, 2022; LIDAR de 2012).">
        {actual ? (
          <div className="itu-kpis">
            <Kpi T={T} rotulo="Nivel del embalse" valor={actual.nivel} decimales={2} unidad="msnm" actualizado={actual.t} />
            <Kpi T={T} rotulo="Volumen útil" valor={actual.vu} decimales={1} unidad="hm³" nota={`${fmtNum((actual.vu / V_UTIL_NAMO) * 100, 1)} % de ${fmtNum(V_UTIL_NAMO, 1)} hm³ (390–420 msnm)`} tip="Volumen sobre el nivel mínimo técnico (390 msnm). Sobre el NAMO supera el 100 %." />
            <Kpi T={T} rotulo="Volumen total" valor={actual.vt} decimales={1} unidad="hm³" nota={`${fmtNum((actual.vt / V_NAMO) * 100, 1)} % del volumen al NAMO (${fmtNum(V_NAMO, 1)} hm³)`} tip="Todo el volumen almacenado desde el fondo del embalse (cota 219), con la Ec.2 de la memoria." />
            <Kpi T={T} rotulo="Área ocupada" valor={actual.area} decimales={2} unidad="km²" nota={`${fmtNum(actual.area * 100, 0)} ha · ${fmtNum((actual.area / A_NAMO) * 100, 1)} % del área al NAMO`} tip="Área del espejo de agua: Tabla 3 de la memoria (curvas de nivel cada 5 m del LIDAR 2012) interpolada en línea recta." />
            <Kpi T={T} rotulo={actual.hastaNAMO >= 0 ? "Espacio hasta el NAMO" : "Sobre el NAMO"} valor={Math.abs(actual.hastaNAMO)} decimales={1} unidad="hm³" nota={actual.hastaNAMO >= 0 ? `${fmtNum((NAMO - actual.nivel) * 100, 0)} cm por debajo de 420 msnm` : `${fmtNum((actual.nivel - NAMO) * 100, 0)} cm por encima de 420 msnm`} tip="Diferencia entre el volumen al NAMO (420 msnm) y el volumen actual." />
            <Kpi T={T} rotulo="Cambio del volumen en 24 h" valor={actual.dV} decimales={2} unidad="hm³" nota={actual.qNeto != null ? `${actual.qNeto >= 0 ? "+" : "−"}${fmtNum(Math.abs(actual.qNeto), 0)} m³/s netos (entrada − salida) desde ${fechaCorta(actual.haceT)}` : "Sin el nivel de hace 24 h"} tip="Volumen ahora menos volumen hace 24 h, con el nivel del radar. Dividido entre 86.400 s da el caudal neto medio que entró (+) o salió (−) del embalse." />
          </div>
        ) : <Estado T={T} tipo="neutro">Sin nivel actual del radar.</Estado>}
      </Tarjeta>

      <Tarjeta T={T} titulo="Variación del volumen útil" subtitulo={subt} accion={control}>
        <GraficoSeries T={T} x={serie ? serie.t : []} series={graf ? graf.util : []} unidad="hm³" ejeY="Volumen útil (hm³)" decimales={1} alto={280} grupo="embalse" equivalente={EQ_UTIL} bandas={graf ? graf.bandas : []}
          referencias={[{ y: V_UTIL_NAMO, rotulo: "NAMO (420 msnm)", color: T.inkFaint, dash: true }]} nombreArchivo={`volumen_util_${escala}`} mensajeVacio={vacio} />
      </Tarjeta>
      <Tarjeta T={T} titulo="Variación del volumen total" subtitulo={subt}>
        <GraficoSeries T={T} x={serie ? serie.t : []} series={graf ? graf.total : []} unidad="hm³" ejeY="Volumen total (hm³)" decimales={1} alto={280} grupo="embalse" equivalente={EQ_TOTAL} bandas={graf ? graf.bandas : []}
          referencias={[{ y: V_NAMO, rotulo: "NAMO (420 msnm)", color: T.inkFaint, dash: true }, { y: V_390, rotulo: "Mínimo técnico (390 msnm)", color: T.inkFaint, dash: true }]} nombreArchivo={`volumen_total_${escala}`} mensajeVacio={vacio} />
      </Tarjeta>
      <Tarjeta T={T} titulo="Variación del área ocupada por el embalse" subtitulo={subt}>
        <GraficoSeries T={T} x={serie ? serie.t : []} series={graf ? graf.area : []} unidad="km²" ejeY="Área (km²)" decimales={2} alto={280} grupo="embalse" equivalente={EQ_AREA} bandas={graf ? graf.bandas : []}
          referencias={[{ y: A_NAMO, rotulo: "NAMO (420 msnm)", color: T.inkFaint, dash: true }]} nombreArchivo={`area_embalse_${escala}`} mensajeVacio={vacio} />
        <Nota T={T}>Para cada nivel del radar: volumen total con la Ec.2 de la memoria (10 tramos polinómicos, 219–460 msnm); volumen útil = volumen total − {fmtNum(V_390, 3)} hm³ (volumen a 390 msnm), en cero por debajo del mínimo técnico; área con la Tabla 3 interpolada en línea recta entre cotas cada 5 m. En la escala diaria la línea es la media del día y la franja, el volumen o el área con el nivel mínimo y máximo del día. Los porcentajes del eje derecho son sobre los valores al NAMO.</Nota>
      </Tarjeta>

      <Tarjeta T={T} titulo="Curvas del embalse (respaldo técnico)"
        subtitulo="Curva vigente del Consorcio Generación Ituango: chequeo 2015 con curvas de nivel cada 5 m del LIDAR de 2012 (Tabla 3) y ecuación de volumen de 2021 (Ec.2). Memoria I-M-2194-044-HID-VC-CVE-001, rev. 0, 29-jul-2022.">
        <GraficoSeries T={T} tipoX="numero" ejeX="Cota del embalse (msnm)" x={curvas.x} series={curvas.s} unidad="hm³" ejeY="Volumen (hm³)" ejeY2="Área (km²)" unidad2="km²" decimales={2} alto={320} verticales={verticalesCurva} nombreArchivo="curvas_embalse_cgi" />
        <div className="itu-tabla" style={{ marginTop: 12 }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
          <thead><tr style={{ color: T.inkFaint, textAlign: "right" }}><th style={{ textAlign: "left", padding: "5px 8px" }}>Nivel característico</th><th style={{ padding: "5px 8px" }}>Cota (msnm)</th><th style={{ padding: "5px 8px" }}>Volumen total (hm³)</th><th style={{ padding: "5px 8px" }}>Área (km²)</th><th style={{ textAlign: "left", padding: "5px 8px" }}>Memoria (Figura 4)</th></tr></thead>
          <tbody>{CARACTERISTICOS.map((c) => (
            <tr key={c.nombre} style={{ borderTop: `1px solid ${T.lineSoft}`, textAlign: "right", color: T.ink }}>
              <td style={{ textAlign: "left", padding: "5px 8px" }}>{c.nombre}</td>
              <td style={{ padding: "5px 8px" }}>{fmtNum(c.cota, 2)}</td>
              <td style={{ padding: "5px 8px" }}>{fmtNum(volumenTotalHm3(c.cota), 1)}</td>
              <td style={{ padding: "5px 8px" }}>{fmtNum(areaEmbalseKm2(c.cota), 2)}</td>
              <td style={{ textAlign: "left", padding: "5px 8px", color: T.inkMuted }}>{c.doc || "—"}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <p style={{ fontSize: 12.5, color: T.inkMuted, margin: "8px 0 0", lineHeight: 1.5 }}>
          Con la curva: volumen útil (390–420) {fmtNum(V_UTIL_NAMO, 1)} hm³, mínimo técnico (350–390) {fmtNum(V_390 - volumenTotalHm3(NIVEL_MIN_FISICO), 1)} hm³ y muerto (≤ 350) {fmtNum(volumenTotalHm3(NIVEL_MIN_FISICO), 1)} hm³: coinciden con la Figura 4 de la memoria (965, 856 y 740 hm³) al redondear.
        </p>
        <Nota T={T} rotulo="Cómo se validó">
          La Ec.2 reproduce los 46 puntos de volumen de la Tabla 3 con diferencia máxima de 0,009 hm³ (como dice la Tabla 5 de la memoria: error 0,00 %) y es continua entre tramos (saltos ≤ 0,0003 hm³). La hoja «Curva Cota vs Volumen» de DatosAplicación.xlsx es esa misma ecuación cada 0,25 m (diferencia ≤ 0,000001 hm³). El área de la Tabla 3, integrada por trapecios (el método de la memoria), da los volúmenes de la tabla con diferencia ≤ 0,005 hm³, y la pendiente de la Ec.2 coincide con el área de la tabla en ±1,1 %. La hoja «Curva Cota vs Área» del Excel (405–420) no viene de la memoria (3.850 ha a 420 frente a 3.794,05 de la Tabla 3), y la hoja «Datos Técnicos» usa la curva inicial de 1997 y 2009 (2.720 hm³ a 420), que la memoria reemplaza; la app no usa ninguna de las dos. La memoria da el NAME como 432,9 msnm en la Figura 3 y 432,50 en la Figura 4; la app usa 432,5. Es la batimetría de 2012: la sedimentación posterior no está incluida.
        </Nota>
      </Tarjeta>
    </>
  );
}
