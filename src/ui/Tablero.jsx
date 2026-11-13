/* ============================================================
   Tablero en vivo: estado actual de la central y de la regla
   operativa, para decidir en caliente.
   ============================================================ */
import { useMemo, useState } from "react";
import { useHorario } from "../datos/historico.js";
import { useVivo } from "../datos/vivo.jsx";
import { useDatos } from "../datos/fuentes.jsx";
import { useAportes } from "../datos/aportes.js";
import { energiaEmbalsada, capacidadNominalMW } from "../indicadores.js";
import { ETIQUETA_ESTADO_REGLA, NAMO, repartoPorUnidad, etiquetaCondicionDescarga, factorConversionHidrometria, pctFromDeg } from "../modelo.js";
import { minutosDe, tramosCumplimiento, aperturaIntervalos } from "../analitica.js";
import { GraficoSeries, Estado, BarraBanda, fmtNum, colorSerie, aSeg } from "./graficos.jsx";
import { Proposito, Tarjeta, Kpi, PanelConexion, hace, fechaCorta, SelectorRango, rangoUltimos, Nota } from "./comunes.jsx";
import { GraficoApertura } from "./Apertura.jsx";
import { evaluarAlertas } from "../alertas.js";

const TIPO_ESTADO = { cumple: "bien", por_encima: "critico", por_debajo: "serio", excepcion: "aviso", sin_base: "neutro" };
const P_LINEA = 20;

function Frescura({ T, edadMin, ultimo }) {
  const tipo = edadMin == null ? "neutro" : edadMin <= 90 ? "bien" : edadMin <= 180 ? "aviso" : "critico";
  return <Estado T={T} tipo={tipo}>Último dato {fechaCorta(ultimo)} · {hace(edadMin)}</Estado>;
}

const fmtSesgo = (e) => (e && Number.isFinite(e.sesgo) ? `${e.sesgo >= 0 ? "+" : "−"}${fmtNum(Math.abs(e.sesgo), 1)} %` : "—");

export default function Tablero({ T, condDescarga }) {
  const { vivo, cargando, error, recargar, cuando } = useVivo();
  const datos = useDatos();
  const v = vivo;
  // Indicadores de la central: energía embalsada útil y aportes del mes frente a la media histórica
  const aportes = useAportes();
  const nivelAhora = v && v.actual ? v.actual.nivel : null;
  const emb = useMemo(() => energiaEmbalsada(nivelAhora, v && v.ultima ? v.ultima.t : null), [nivelAhora, v]);
  const apMes = aportes.datos && aportes.datos.olaya.length ? aportes.datos.olaya[aportes.datos.olaya.length - 1] : null;

  // Rango de los gráficos: hasta 2 días con el dato de cada minuto (hoy y ayer,
  // ya cargados); más días, con los promedios horarios del histórico más las
  // horas de hoy.
  const hoy = v ? v.hoy : null;
  const minD = v && v.estadoProceso ? v.estadoProceso.primerDia : null;
  const [rangoSel, setRango] = useState(null);
  const rango = rangoSel || (v ? { desde: v.ayer, hasta: v.hoy } : { desde: null, hasta: null });
  const porMinuto = v && rango.desde >= v.ayer;
  const horario = useHorario(!porMinuto ? rango.desde : null, !porMinuto ? rango.hasta : null);

  const series = useMemo(() => {
    if (!v) return null;
    const bandaDe = (d) => (d === v.hoy ? v.banda : (v.diario || []).find((x) => x.dia === d)?.regla.banda);
    const acumular = (t, qReg, pesos) => {
      let dia = null, s = 0, c = 0;
      return qReg.map((q, i) => { const d = t[i].slice(0, 10); if (d !== dia) { dia = d; s = 0; c = 0; } if (q != null) { const w = pesos ? pesos[i] : 1; s += q * w; c += w; } return c ? s / c : null; });
    };
    if (porMinuto) {
      if (!v.filas || !v.filas.length) return null;
      const f = v.filas.filter((r) => r.t.slice(0, 10) >= rango.desde && r.t.slice(0, 10) <= rango.hasta);
      if (!f.length) return null;
      const t = f.map((r) => r.t);
      const nU = f[0].p.length;
      const pTot = f.map((r) => r.p.reduce((a, x) => a + (x != null && x > 0 ? x : 0), 0));
      const qReg = f.map((r, i) => (r.p.every((x) => x == null) ? null : pTot[i] / factorConversionHidrometria(r.nivel, r.t)));
      const qVert = f.map((r) => (r.qVert != null ? Math.max(0, r.qVert) : null));
      const qDesc = qReg.map((q, i) => (q == null ? null : q + (qVert[i] || 0)));
      return { paso: "minuto", t, nU, pTot, qReg, qVert, qDesc, acum: acumular(t, qReg), bMin: t.map((x) => bandaDe(x.slice(0, 10))?.min ?? null), bMax: t.map((x) => bandaDe(x.slice(0, 10))?.max ?? null), nivel: f.map((r) => r.nivel), p: Array.from({ length: nU }, (_, u) => f.map((r) => (r.p[u] != null ? Math.max(0, r.p[u]) : null))) };
    }
    const h = horario.datos;
    if (!h) return null;
    // filas horarias: histórico + horas de hoy que aún no estén
    const filas = h.t.map((t, i) => ({ t, nivel: h.nivel[i], p: h.p[i] || [], linea: h.linea[i] || [], qReg: h.qReg[i], qVert: h.qVert[i] }));
    if (v.resHoy && rango.hasta >= v.hoy) {
      const ya = new Set(filas.map((r) => r.t));
      v.resHoy.horas.forEach((x) => { if (x && !ya.has(x.t)) filas.push({ t: x.t, nivel: x.nivel, p: x.p, linea: x.linea, qReg: x.qReg, qVert: x.qVert }); });
    }
    if (!filas.length) return null;
    const t = filas.map((r) => r.t);
    const nU = filas.reduce((k, r) => Math.max(k, r.p.length), 0);
    const pU = Array.from({ length: nU }, (_, u) => filas.map((r) => (r.p[u] != null ? Math.max(0, r.p[u]) * (r.linea[u] ?? 0) : 0)));
    const pTot = filas.map((_, i) => pU.reduce((a, s) => a + (s[i] || 0), 0));
    const qReg = filas.map((r) => r.qReg), qVert = filas.map((r) => (r.qVert != null ? Math.max(0, r.qVert) : null));
    return { paso: "hora", t, nU, pTot, qReg, qVert, qDesc: qReg.map((q, i) => (q == null ? null : q + (qVert[i] || 0))), acum: acumular(t, qReg), bMin: t.map((x) => bandaDe(x.slice(0, 10))?.min ?? null), bMax: t.map((x) => bandaDe(x.slice(0, 10))?.max ?? null), nivel: filas.map((r) => r.nivel), p: pU };
  }, [v, porMinuto, rango.desde, rango.hasta, horario.datos, condDescarga]);

  // Franja de cumplimiento: promedio acumulado de cada día frente a su banda
  const cumplimiento = useMemo(() => {
    if (!series) return null;
    const xs = series.t.map(aSeg);
    const { tramos, total } = tramosCumplimiento(xs, series.acum, series.bMin, series.bMax);
    const h = (seg) => `${Math.floor(seg / 3600)} h ${String(Math.round((seg % 3600) / 60)).padStart(2, "0")} min`;
    let dentroInst = 0, conDato = 0;
    series.qReg.forEach((q, i) => { if (q != null && series.bMin[i] != null) { conDato++; if (q >= series.bMin[i] && q <= series.bMax[i]) dentroInst++; } });
    return {
      tramos,
      leyenda: [
        { tipo: "dentro", rotulo: "Promedio del día dentro de la banda", duracion: h(total.dentro) },
        { tipo: "encima", rotulo: "Por encima", duracion: h(total.encima) },
        { tipo: "debajo", rotulo: "Por debajo", duracion: h(total.debajo) },
      ],
      pctInst: conDato ? (100 * dentroInst) / conDato : null,
    };
  }, [series]);

  const sNivel = useMemo(() => series && [{ nombre: "Nivel del embalse (radar)", datos: series.nivel, decimales: 3 }], [series]);
  const sPot = useMemo(() => series && [
    ...series.p.map((d, u) => ({ nombre: `U${u + 1}`, datos: d, indice: u, ancho: 1.6 })),
    { nombre: "Total", datos: series.pTot, color: T.ink, ancho: 2.2 },
  ], [series, T]);
  // Vista de la gráfica de caudales: dos paneles (regla arriba, vertedero abajo) o un panel con dos ejes
  const [vistaQ, setVistaQ] = useState(() => { try { return localStorage.getItem("ituango-vista-caudales") || "paneles"; } catch { return "paneles"; } });
  const elegirVistaQ = (v) => { setVistaQ(v); try { localStorage.setItem("ituango-vista-caudales", v); } catch { /* sin almacenamiento */ } };
  const sQRegla = useMemo(() => series && [
    { nombre: "Q regulado (P / F.C.)", datos: series.qReg, indice: 0, ancho: 1.4 },
    { nombre: "Promedio acumulado del día", datos: series.acum, indice: 6, ancho: 2.4 },
    { nombre: "Banda mín.", datos: series.bMin, color: T.inkFaint, dash: true, ancho: 1.2, escalones: true },
    { nombre: "Banda máx.", datos: series.bMax, color: T.inkFaint, dash: true, ancho: 1.2, escalones: true },
  ], [series, T]);
  const sQVert = useMemo(() => series && [
    { nombre: "Vertedero", datos: series.qVert, indice: 1, ancho: 1.6 },
    { nombre: "Total descargado", datos: series.qDesc, indice: 2, ancho: 1.6 },
  ], [series]);
  const sQDosEjes = useMemo(() => series && [
    { nombre: "Q regulado (P / F.C.)", datos: series.qReg, indice: 0, ancho: 1.4 },
    { nombre: "Promedio acumulado del día", datos: series.acum, indice: 6, ancho: 2.4 },
    { nombre: "Total descargado", datos: series.qDesc, indice: 2, ancho: 1.6, oculta: true },
    { nombre: "Banda mín.", datos: series.bMin, color: T.inkFaint, dash: true, ancho: 1.2, escalones: true },
    { nombre: "Banda máx.", datos: series.bMax, color: T.inkFaint, dash: true, ancho: 1.2, escalones: true },
    { nombre: "Vertedero (eje derecho)", datos: series.qVert, indice: 1, ancho: 1.6, eje: "derecho" },
  ], [series, T]);

  // Apertura del distribuidor estimada por unidad en el rango de los gráficos:
  // hasta 48 h, cada 15 min con el dato de cada minuto; más días, por hora
  // (histórico + horas de hoy). Mismo cálculo que el resumen horario.
  const apertura = useMemo(() => {
    if (!v) return null;
    if (porMinuto) {
      if (!v.filas || !v.filas.length) return null;
      const f = v.filas.filter((r) => r.t.slice(0, 10) >= rango.desde && r.t.slice(0, 10) <= rango.hasta);
      if (!f.length) return null;
      const nU = f[0].p.length;
      const iv = aperturaIntervalos(f, nU, { minutos: 15, cond: condDescarga || v.condicion });
      return { paso: "15 min", t: iv.map((x) => x.t), filas: iv.map((x) => x.gamma), lineas: iv.map((x) => x.linea), pasoH: iv.map((x) => x.min / 60), nU };
    }
    const h = horario.datos;
    if (!h) return null;
    const filas = h.t.map((t, i) => ({ t, g: h.gamma[i], l: h.linea[i] }));
    if (v.resHoy && rango.hasta >= v.hoy) {
      const ya = new Set(filas.map((r) => r.t));
      v.resHoy.horas.forEach((x) => { if (x && !ya.has(x.t)) filas.push({ t: x.t, g: x.gamma, l: x.linea }); });
    }
    if (!filas.length) return null;
    const nU = filas.reduce((k, r) => Math.max(k, r.g ? r.g.length : 0), 0);
    return { paso: "hora", t: filas.map((r) => r.t), filas: filas.map((r) => r.g), lineas: filas.map((r) => r.l), pasoH: 1, nU };
  }, [v, porMinuto, rango.desde, rango.hasta, horario.datos, condDescarga]);

  // Modelo por unidad con el promedio de los últimos 15 min
  const modelo = useMemo(() => {
    if (!v || !v.actual || v.actual.nivel == null) return null;
    const pb = Array.from({ length: 8 }, (_, i) => (v.actual.p[i] != null && v.actual.p[i] > P_LINEA ? v.actual.p[i] : 0));
    // Condición de la app (por defecto, la calibrada con Hidrometría y WK); con la ASE, el río = descargado actual
    const base = condDescarga || v.condicion;
    const cond = base.modo === "ase" ? { ...base, qRio: v.actual.qDesc } : base;
    const fact = v.indiceUnidades ? Array.from({ length: 8 }, (_, i) => v.indiceUnidades[i]?.factor ?? null) : null;
    return { comun: repartoPorUnidad(v.actual.nivel, pb, { cond, gammaMax: 31.98, potenciaMaxMW: null }), wk: fact ? repartoPorUnidad(v.actual.nivel, pb, { cond, gammaMax: 31.98, potenciaMaxMW: null, factores: fact }) : null, cond };
  }, [v, condDescarga]);

  // HydroForecast
  const hf = useMemo(() => {
    if (!v || !v.hf) return null;
    const out = {};
    const pr = v.hf.pronostico?.datos, ob = v.hf.observado?.datos;
    if (pr && pr.data) {
      const d = pr.data.slice(0, 15);
      out.pron = { t: d.map((x) => String(x.timestamp).slice(0, 10) + " 12:00"), sp: d.map((x) => x.QSitioPresa_pred_mean), spMin: d.map((x) => x.QSitioPresa_pred_min), spMax: d.map((x) => x.QSitioPresa_pred_max), ol: d.map((x) => x.QOlaya_pred_mean), emitido: pr.generated_at, origen: v.hf.pronostico.origen };
      out.hoy = d.find((x) => String(x.timestamp).slice(0, 10) === v.hoy) || null;
    }
    if (ob && ob.data) out.obs = ob.data.slice(-1)[0];
    if (v.hf.aguasArriba?.datos) out.aa = v.hf.aguasArriba.datos;
    if (out.pron && ob && ob.data) {
      // observado (30 días) + pronóstico en una sola serie temporal
      const o = ob.data.slice(-30);
      const t = [...o.map((x) => String(x.timestamp).slice(0, 10) + " 12:00"), ...out.pron.t.filter((x) => x > String(o[o.length - 1]?.timestamp).slice(0, 10) + " 12:00")];
      const idx = new Map(out.pron.t.map((x, i) => [x, i]));
      const io = new Map(o.map((x) => [String(x.timestamp).slice(0, 10) + " 12:00", x]));
      out.comb = { t,
        spObs: t.map((x) => io.get(x)?.QSitioPresa_obs ?? null), olObs: t.map((x) => io.get(x)?.QOlaya_obs ?? null),
        sp: t.map((x) => (idx.has(x) ? out.pron.sp[idx.get(x)] : null)), spMin: t.map((x) => (idx.has(x) ? out.pron.spMin[idx.get(x)] : null)), spMax: t.map((x) => (idx.has(x) ? out.pron.spMax[idx.get(x)] : null)),
        ol: t.map((x) => (idx.has(x) ? out.pron.ol[idx.get(x)] : null)) };
    }
    return out;
  }, [v]);
  const sHF = useMemo(() => hf && hf.comb && [
    { nombre: "Sitio Presa observado", datos: hf.comb.spObs, indice: 0, ancho: 2.2 },
    { nombre: "Sitio Presa pronóstico", datos: hf.comb.sp, indice: 0, dash: true, ancho: 2 },
    { nombre: "Pronóstico mín.", datos: hf.comb.spMin, color: T.inkFaint, ancho: 0.8 },
    { nombre: "Pronóstico máx.", datos: hf.comb.spMax, color: T.inkFaint, ancho: 0.8 },
    { nombre: "Olaya observado", datos: hf.comb.olObs, indice: 1, ancho: 1.8 },
    { nombre: "Olaya pronóstico", datos: hf.comb.ol, indice: 1, dash: true, ancho: 1.6 },
  ], [hf, T]);
  const sAA = useMemo(() => {
    if (!hf || !hf.aa || !hf.aa.serie) return null;
    const s = hf.aa.serie.slice(-96);
    const cols = (hf.aa.estaciones || []).map((e) => e.col).filter(Boolean);
    return { t: s.map((x) => x.timestamp), series: cols.map((c, i) => ({ nombre: (hf.aa.estaciones.find((e) => e.col === c) || {}).nombre || c, datos: s.map((x) => x[c] ?? null), indice: i })) };
  }, [hf]);

  const guia = (
    <Proposito T={T} id="tablero" titulo="Tablero en vivo"
      fuente={v && v.ultima ? <>Relay de LoggerNet (dato cada minuto) · HydroForecast · se actualiza solo cada 5 min{cuando ? `, última consulta ${cuando.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}` : ""}</> : "Relay de LoggerNet y HydroForecast"}
      para="Ver en una sola pantalla cómo está la central ahora: nivel y su tendencia, potencia y caudal por unidad, vertedero, caudal descargado y cómo va el día frente a la regla operativa de la Res. 1891."
      logras="Decidir en caliente: cuánto puede generar el resto del día sin salir de la banda, si el embalse sube o baja y a qué ritmo, y qué viene por el río según HydroForecast y las estaciones aguas arriba."
      resultados="Indicadores con estado (✓ / ! / ✕), el caudal que debe promediar el resto del día para cerrar dentro de la banda (en m³/s y en MW), el cierre proyectado, el caudal y la apertura del distribuidor de cada unidad (Hidrometría, Winter-Kennedy y modelo; apertura en % y grados) y gráficos del rango elegido (por defecto, las últimas 48 h)." />
  );
  if (!datos.conectado && !(v && v.hf && (v.hf.pronostico || v.hf.observado))) return <>{guia}<PanelConexion T={T} /></>;

  const alertas = v && v.ultima ? evaluarAlertas(v) : null;
  const reg = v && v.resHoy ? v.resHoy.regla : null;
  const a = v && v.actual;
  const nUA = a ? a.enLinea.filter(Boolean).length : 0;
  return (
    <>
      {guia}
      {!datos.conectado && <PanelConexion T={T} compacto />}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
        {v && v.ultima && <Frescura T={T} edadMin={v.edadMin} ultimo={v.ultima.t} />}
        {cargando && <span style={{ fontSize: 12.5, color: T.inkFaint }}>Actualizando…</span>}
        <button onClick={recargar} style={{ padding: "5px 12px", borderRadius: 999, border: `1px solid ${T.line}`, background: T.panel, color: T.inkMuted, fontSize: 12.5, cursor: "pointer" }}>Actualizar ahora</button>
        {error && <Estado T={T} tipo="critico" compacto>{error.message}</Estado>}
        {v && v.errores && v.errores.length > 0 && <span style={{ fontSize: 12, color: T.inkFaint }}>{v.errores.join(" · ")}</span>}
        {v && v.edadMin > 90 && <span style={{ fontSize: 12, color: T.inkMuted }}>Si el dato tiene más de 1 h, revise que el relay siga corriendo en el equipo corporativo (tarea "EPM Relay LoggerNet").</span>}
      </div>

      {alertas && (
        <Tarjeta T={T} titulo="Agente de vigilancia" subtitulo="Reglas fijas sobre el dato en vivo (sin IA): frescura del dato, regla 1891 del día, vertimiento, nivel frente al NAMO y apertura estimada > 97 %. El proceso automático evalúa lo mismo en cada corrida y, si aparece una alerta nueva, la publica en el issue «Alertas de operación» del repositorio de datos (GitHub avisa por correo)."
          accion={<Estado T={T} tipo={alertas.some((x) => x.nivel === "critico") ? "critico" : alertas.some((x) => x.nivel === "aviso") ? "aviso" : "bien"}>{alertas.filter((x) => x.nivel !== "info").length ? `${alertas.filter((x) => x.nivel !== "info").length} alerta(s)` : "Sin alertas"}</Estado>}>
          {alertas.length === 0 && <p style={{ fontSize: 13, color: T.inkMuted, margin: 0 }}>Todo dentro de lo esperado con el último dato ({v.ultima.t}).</p>}
          {alertas.map((x) => (
            <div key={x.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0", borderTop: `1px solid ${T.lineSoft}` }}>
              <Estado T={T} compacto tipo={x.nivel === "info" ? "neutro" : x.nivel}>{x.nivel === "critico" ? "Crítica" : x.nivel === "aviso" ? "Aviso" : "Nota"}</Estado>
              <div style={{ fontSize: 13, color: T.inkMuted, lineHeight: 1.5 }}><b style={{ color: T.ink }}>{x.titulo}.</b> {x.detalle}</div>
            </div>
          ))}
        </Tarjeta>
      )}

      {a && (
        <div className="itu-kpis" style={{ marginBottom: 16 }}>
          <Kpi T={T} grande rotulo="Nivel del embalse" actualizado={a.t} valor={a.nivel} decimales={2} unidad="msnm"
            nota={a.nivel == null ? "Sin dato del radar" : <>{v.tendencia[2].cmPorHora != null ? `${v.tendencia[2].cmPorHora >= 0 ? "Sube" : "Baja"} ${fmtNum(Math.abs(v.tendencia[2].cmPorHora), 1)} cm/h (6 h)` : ""}{v.tendencia[3].delta != null ? ` · ${fmtNum(v.tendencia[3].delta * 100, 0)} cm en 24 h` : ""}<br />A {fmtNum(NAMO - a.nivel, 2)} m del NAMO ({NAMO}){v.horasANAMO != null ? `; al ritmo de 6 h, en ${fmtNum(v.horasANAMO, 0)} h` : ""}</>} />
          <Kpi T={T} grande rotulo="Potencia" actualizado={a.t} valor={a.pTotal} decimales={0} unidad="MW" nota={`${nUA} ${nUA === 1 ? "unidad" : "unidades"} en línea · promedio de 15 min`} />
          <Kpi T={T} grande rotulo="Q regulado ahora" actualizado={a.t} valor={a.qReg} decimales={1} unidad="m³/s" nota={`P / F.C. ${fmtNum(a.fc, 3)} (Hidrometría, nivel del radar)`} tip="Caudal regulado de Hidrometría: potencia total en bornes dividida por el factor de conversión vigente (0,0119·Nivel − 3,178 desde el 29-oct-2026)." />
          <Kpi T={T} grande rotulo="Vertedero" actualizado={a.t} valor={a.qVert != null ? Math.max(0, a.qVert) : null} decimales={1} unidad="m³/s"
            estado={a.qVert != null ? <Estado T={T} tipo={a.qVert > 1 ? "aviso" : "bien"} compacto>{a.qVert > 1 ? "Vertiendo" : "Sin vertimiento"}</Estado> : null}
            nota={a.aComp ? `Aperturas: ${a.aComp.map((x, g) => `C${g + 1} ${fmtNum(x, 2)}`).join(" · ")}` : undefined} />
          <Kpi T={T} grande rotulo="Total descargado" actualizado={a.t} valor={a.qDesc} decimales={1} unidad="m³/s" nota="Turbinado (Hidrometría) + vertedero" />
          {v.resHoy && <Kpi T={T} grande rotulo="Entrada al embalse hoy" actualizado={v.resHoy.ultimo} valor={v.resHoy.balance.qEntrada} decimales={0} unidad="m³/s" nota={v.resHoy.balance.qEntrada != null ? `Balance de masa en ${fmtNum(v.resHoy.balance.horas, 1)} h: descargado + cambio de volumen` : "Faltan al menos 6 h de datos de hoy"} />}
          {emb && (() => { const cap = capacidadNominalMW(v.hoy); return <Kpi T={T} grande rotulo="Energía embalsada útil" actualizado={a.t} valor={emb.gwh} decimales={0} unidad="GWh"
            tip="El agua entre el nivel mínimo técnico (390 msnm) y el nivel actual, convertida con el F.C. de Hidrometría. Detalle en Analítica → Indicadores de la central."
            nota={`${fmtNum(emb.pctUtil, 1)} % del volumen útil · ≈ ${fmtNum((emb.gwh * 1000) / cap, 0)} h a ${fmtNum(cap, 0)} MW`} />; })()}
          {apMes && apMes.pct != null && <Kpi T={T} grande rotulo="Aportes del mes (Olaya)" valor={apMes.pct} decimales={0} unidad="% de la media"
            tip="Caudal medio del mes en Olaya frente a la media del mismo mes en los años anteriores, como XM reporta los aportes hídricos. Detalle en Analítica → Indicadores de la central."
            estado={<Estado T={T} compacto tipo={apMes.pct >= 90 ? "bien" : apMes.pct >= 60 ? "aviso" : "serio"}>{apMes.pct >= 100 ? "Sobre la media" : "Bajo la media"}</Estado>}
            nota={`${fmtNum(apMes.q, 0)} m³/s en ${apMes.dias} días frente a ${fmtNum(apMes.media, 0)} m³/s de media`} />}
        </div>
      )}

      {v && v.resHoy && reg && (
        <Tarjeta T={T} titulo={`Regla operativa hoy (${fechaCorta(v.hoy)})`} subtitulo={`Promedio regulado del día frente a la banda de la Res. 1891: promedio de ayer ${fmtNum(v.banda?.base, 1)} m³/s ± 4,70 %. Con ${fmtNum(v.resHoy.minutos / 60, 1)} h de datos.`}
          accion={<Estado T={T} tipo={TIPO_ESTADO[reg.estado]}>{ETIQUETA_ESTADO_REGLA[reg.estado] || reg.estado}{v.resHoy.parcial ? " (día en curso)" : ""}</Estado>}>
          {v.bandaProvisional && <p style={{ fontSize: 12.5, color: T.amber, margin: "0 0 8px" }}>Banda provisional: el día de ayer no está completo en los datos.</p>}
          {reg.estado === "excepcion" && <p style={{ fontSize: 12.5, color: T.inkMuted, margin: "0 0 8px" }}>Hoy hubo vertimiento: la validación de la regla queda suspendida. Los valores se muestran como seguimiento.</p>}
          <BarraBanda T={T} valor={reg.qReg} min={v.banda?.min} max={v.banda?.max} marcas={[{ v: v.cierreSiSigue, rotulo: "Cierre si sigue como la última hora" }]} />
          <div className="itu-kpis" style={{ marginTop: 14 }}>
            <Kpi T={T} rotulo="Promedio regulado hasta ahora" valor={reg.qReg} unidad="m³/s" nota={`Banda ${fmtNum(v.banda?.min, 1)} – ${fmtNum(v.banda?.max, 1)} m³/s`} />
            {v.requerido && reg.estado !== "excepcion" && <Kpi T={T} rotulo="Para cerrar dentro de la banda" valor={`${fmtNum(Math.max(0, v.requerido.qMin), 0)} – ${fmtNum(Math.max(0, v.requerido.qMax), 0)}`} unidad="m³/s"
              nota={<>Promedio de las {fmtNum(v.restoMin / 60, 1)} h que faltan del día (desde el último dato, {v.ultima.t.slice(11)}). Con el F.C. actual: <b style={{ color: T.ink }}>{fmtNum(Math.max(0, v.requerido.pMin), 0)} – {fmtNum(Math.max(0, v.requerido.pMax), 0)} MW</b>.</>}
              estado={v.requerido.yaPorEncima ? <Estado T={T} tipo="critico" compacto>Aun parando todo, cierra por encima</Estado> : v.requerido.superaCapacidad ? <Estado T={T} tipo="critico" compacto>Pide más de la capacidad de U1–U4 ({fmtNum(v.requerido.qCapacidad, 0)} m³/s): cierra por debajo</Estado> : null} />}
            {v.cierreSiSigue != null && <Kpi T={T} rotulo="Cierre si sigue como la última hora" valor={v.cierreSiSigue} unidad="m³/s" nota={`Última hora: ${fmtNum(v.ultimaHora.pTotal, 0)} MW → ${fmtNum(v.ultimaHora.qReg, 1)} m³/s`}
              estado={v.banda ? <Estado T={T} compacto tipo={v.cierreSiSigue > v.banda.max ? "critico" : v.cierreSiSigue < v.banda.min ? "serio" : "bien"}>{v.cierreSiSigue > v.banda.max ? "Cerraría por encima" : v.cierreSiSigue < v.banda.min ? "Cerraría por debajo" : "Cerraría dentro"}</Estado> : null} />}
            {v.nivelFinDia != null && <Kpi T={T} rotulo="Nivel estimado a las 24:00" valor={v.nivelFinDia} decimales={2} unidad="msnm" nota="Si entra lo mismo que hoy y se descarga como en la última hora" />}
            {v.filaAyer && <Kpi T={T} rotulo={`Ayer (${fechaCorta(v.ayer)})`} valor={v.filaAyer.regla.qReg} unidad="m³/s" estado={<Estado T={T} compacto tipo={TIPO_ESTADO[v.filaAyer.regla.estado]}>{ETIQUETA_ESTADO_REGLA[v.filaAyer.regla.estado]}</Estado>} nota={v.filaAyer.regla.banda ? `Banda ${fmtNum(v.filaAyer.regla.banda.min, 1)} – ${fmtNum(v.filaAyer.regla.banda.max, 1)}` : undefined} />}
          </div>
          <Nota T={T} rotulo="Cuándo queda en excepción">Si hay vertimiento en el día, la validación queda suspendida (excepción), igual que en la app de Hidrometría. La descarga intermedia se toma como 0.</Nota>
        </Tarjeta>
      )}

      {a && modelo && (
        <Tarjeta T={T} titulo="Unidades ahora" subtitulo={`Promedio de los últimos 15 min. El caudal de Hidrometría por unidad es la columna de LoggerNet (P / F.C., el mismo factor para todas); el Winter-Kennedy (WK) es la medición de cada máquina, aún sin calibrar: sirve para comparar unidades, no como caudal absoluto. Modelo: colina común con la condición de descarga ${etiquetaCondicionDescarga(modelo.cond)}${modelo.cond.calibrada ? ` (últimos 7 días: sesgo ${fmtSesgo(modelo.cond.calibrada.hidrometria)} frente a Hidrometría y ${fmtSesgo(modelo.cond.calibrada.wk)} frente a WK)` : ""}.`}>
          <div className="itu-tabla">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
              <thead><tr style={{ color: T.inkFaint, textAlign: "right" }}>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>Unidad</th><th style={{ padding: "6px 8px" }}>P (MW)</th><th style={{ padding: "6px 8px" }}>Q Hidrometría</th><th style={{ padding: "6px 8px" }}>Q WK (sin calibrar)</th><th style={{ padding: "6px 8px" }}>Q modelo</th><th style={{ padding: "6px 8px" }}>Apertura modelo (% · °)</th><th style={{ padding: "6px 8px" }}>F.C. WK (30 d)</th><th style={{ padding: "6px 8px" }}>Factor relativo</th>
              </tr></thead>
              <tbody>{a.p.map((p, u) => {
                const m = modelo.comun.porUnidad[u], idx = v.indiceUnidades ? v.indiceUnidades[u] : null;
                const on = a.enLinea[u];
                return (
                  <tr key={u} style={{ borderTop: `1px solid ${T.lineSoft}`, color: on ? T.ink : T.inkFaint, textAlign: "right" }}>
                    <td style={{ textAlign: "left", padding: "6px 8px" }}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: colorSerie(T, u), marginRight: 6 }} />U{u + 1} {on ? "" : "· detenida"}</td>
                    <td style={{ padding: "6px 8px", fontWeight: 700 }}>{fmtNum(on ? p : 0, 1)}</td>
                    <td style={{ padding: "6px 8px" }}>{on ? fmtNum(a.qFC[u], 1) : "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{on ? fmtNum(a.qWK[u], 1) : "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{on && m ? fmtNum(m.qColina, 1) : "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{on && m ? <>{fmtNum(pctFromDeg(m.gamma), 1)} %<span style={{ color: T.inkFaint, fontSize: 11 }}> · {fmtNum(m.gamma, 1)}°</span></> : "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{idx && idx.fcWK ? fmtNum(idx.fcWK, 3) : "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{idx && idx.factor ? fmtNum(idx.factor, 3) : "—"}</td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: `1px solid ${T.line}`, fontWeight: 700, textAlign: "right", color: T.ink }}>
                <td style={{ textAlign: "left", padding: "6px 8px" }}>Total</td><td style={{ padding: "6px 8px" }}>{fmtNum(a.pTotal, 1)}</td><td style={{ padding: "6px 8px" }}>{fmtNum(a.qReg, 1)}</td>
                <td style={{ padding: "6px 8px" }}>{fmtNum(a.qWK.reduce((s, x, u) => s + (a.enLinea[u] && x ? x : 0), 0), 1)}</td><td style={{ padding: "6px 8px" }}>{fmtNum(modelo.comun.qTotal, 1)}</td><td /><td /><td />
              </tr></tbody>
            </table>
          </div>
          <Nota T={T} rotulo="Qué es el factor relativo">Factor relativo = F.C. WK de la unidad / media de las unidades en los últimos 30 días (&gt; 1: más MW por m³/s que la media). Detalle e historia en Analítica → Unidades.</Nota>
        </Tarjeta>
      )}

      {v && v.filas && v.filas.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", margin: "4px 0 14px" }}>
          <b style={{ fontSize: 13.5, color: T.ink }}>Gráficos:</b>
          <SelectorRango T={T} min={minD || v.ayer} max={v.hoy} valor={rango} onChange={setRango} atajos={[["1", "Hoy"], ["2", "48 h"], ["7", "7 días"], ["30", "30 días"], ["90", "90 días"]]} />
          <span style={{ fontSize: 12, color: T.inkFaint }}>{porMinuto ? "Dato de cada minuto." : horario.cargando ? "Cargando promedios horarios…" : "Promedios horarios (histórico + horas de hoy)."}</span>
        </div>
      )}
      {series && (
        <>
          <Tarjeta T={T} titulo={`Caudales (${fechaCorta(rango.desde)} – ${fechaCorta(rango.hasta)})`} accion={
            <div role="group" aria-label="Vista de la gráfica" style={{ display: "inline-flex", border: `1px solid ${T.line}`, borderRadius: 7, overflow: "hidden" }}>
              {[["paneles", "Dos paneles"], ["ejes", "Un panel, dos ejes"]].map(([k, n]) => (
                <button key={k} onClick={() => elegirVistaQ(k)} aria-pressed={vistaQ === k} style={{ padding: "4px 10px", fontSize: 12, border: "none", cursor: "pointer", background: vistaQ === k ? T.panelSoft : "transparent", color: vistaQ === k ? T.teal : T.inkMuted, fontWeight: vistaQ === k ? 700 : 500 }}>{n}</button>
              ))}
            </div>} subtitulo={`La regla se juzga con el promedio acumulado del día (línea gruesa), no con el valor de cada minuto. La banda (líneas punteadas) es la de cada día; la franja de abajo marca cuándo el promedio estuvo dentro o fuera.${cumplimiento && cumplimiento.pctInst != null ? ` El caudal instantáneo estuvo dentro de la banda el ${fmtNum(cumplimiento.pctInst, 0)} % del tiempo (seguimiento).` : ""}`}>
            {vistaQ === "paneles" ? (
              <>
                <GraficoSeries T={T} x={series.t} series={sQRegla} unidad="m³/s" ejeY="Q regulado (m³/s)" grupo="vivo" tramos={cumplimiento ? cumplimiento.tramos : null} leyendaTramos={cumplimiento ? cumplimiento.leyenda : null} nombreArchivo={`caudal_regulado_${rango.desde}_${rango.hasta}`} bandas={[{ desde: 2, hasta: 3, relleno: "rgba(12,163,12,0.08)" }]} />
                <GraficoSeries T={T} x={series.t} series={sQVert} unidad="m³/s" ejeY="m³/s" grupo="vivo" alto={170} incluirCero nombreArchivo={`vertedero_descargado_${rango.desde}_${rango.hasta}`} />
              </>
            ) : (
              <GraficoSeries T={T} x={series.t} series={sQDosEjes} unidad="m³/s" ejeY="Q regulado (m³/s)" ejeY2="vertedero (m³/s)" unidad2="m³/s" incluirCero2 grupo="vivo" tramos={cumplimiento ? cumplimiento.tramos : null} leyendaTramos={cumplimiento ? cumplimiento.leyenda : null} nombreArchivo={`caudales_${rango.desde}_${rango.hasta}`} bandas={[{ desde: 3, hasta: 4, relleno: "rgba(12,163,12,0.08)" }]} />
            )}
          </Tarjeta>
          <div className="itu-2col">
            <Tarjeta T={T} titulo="Nivel del embalse"><GraficoSeries T={T} x={series.t} series={sNivel} unidad="msnm" ejeY="msnm" decimales={3} grupo="vivo" alto={220} nombreArchivo={`nivel_${rango.desde}_${rango.hasta}`} referencias={[{ y: NAMO, rotulo: `NAMO ${NAMO}` }]} /></Tarjeta>
            <Tarjeta T={T} titulo="Potencia por unidad"><GraficoSeries T={T} x={series.t} series={sPot} unidad="MW" ejeY="MW" decimales={1} grupo="vivo" alto={220} nombreArchivo={`potencia_${rango.desde}_${rango.hasta}`} incluirCero /></Tarjeta>
          </div>
          {apertura && apertura.nU > 0 && (
            <Tarjeta T={T} titulo={`Apertura del distribuidor por unidad (${fechaCorta(rango.desde)} – ${fechaCorta(rango.hasta)})`}
              subtitulo={apertura.paso === "15 min" ? "Promedio de cada 15 minutos (la hora marca el inicio del intervalo), en % y su equivalente en grados (eje derecho y tooltip). Se cuenta la unidad si estuvo en línea al menos la mitad del intervalo." : "Promedio de cada hora, en % y su equivalente en grados (eje derecho y tooltip). Se cuenta la unidad si estuvo en línea al menos media hora."}>
              <GraficoApertura T={T} x={apertura.t} filas={apertura.filas} lineas={apertura.lineas} nU={apertura.nU} pasoH={apertura.pasoH} grupo="vivo" nombreArchivo={`apertura_${rango.desde}_${rango.hasta}`} mensajeVacio="Sin apertura calculable en el periodo (ninguna unidad en línea, o días del histórico anteriores al cálculo de la apertura)." />
            </Tarjeta>
          )}
        </>
      )}

      {(hf && (sHF || sAA)) && (
        <div className="itu-2col">
          {sHF && (
            <Tarjeta T={T} titulo="Caudal que llega: observado y pronóstico" subtitulo={`HydroForecast Ituango · pronóstico emitido ${fechaCorta(String(hf.pron.emitido).replace("T", " "))} · ${hf.pron.origen}. Franja = mínimo y máximo del pronóstico.`}>
              <GraficoSeries T={T} x={hf.comb.t} series={sHF} unidad="m³/s" ejeY="m³/s" decimales={0} alto={240} nombreArchivo="hydroforecast" bandas={[{ desde: 2, hasta: 3 }]} verticales={[{ x: `${v.hoy} 12:00`, rotulo: "hoy" }]} />
              {hf.hoy && hf.hoy.QSitioPresa_pred_mean != null && <p style={{ fontSize: 12.5, color: T.inkMuted, margin: "8px 0 0" }}>Hoy: Sitio Presa {fmtNum(hf.hoy.QSitioPresa_pred_mean, 0)} m³/s ({fmtNum(hf.hoy.QSitioPresa_pred_min, 0)} – {fmtNum(hf.hoy.QSitioPresa_pred_max, 0)}); Olaya {fmtNum(hf.hoy.QOlaya_pred_mean, 0)} m³/s.</p>}
            </Tarjeta>
          )}
          {sAA && (
            <Tarjeta T={T} titulo="Aguas arriba (96 h)" subtitulo={hf.aa.nota}>
              <GraficoSeries T={T} x={sAA.t} series={sAA.series} unidad="m³/s" ejeY="m³/s" decimales={0} alto={240} nombreArchivo="aguas_arriba" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, marginTop: 10 }}>
                {(hf.aa.estaciones || []).map((e) => (
                  <div key={e.col} style={{ fontSize: 12, color: T.inkMuted, background: T.panelSoft, borderRadius: 8, padding: "7px 9px" }}>
                    <b style={{ color: T.ink }}>{e.nombre}</b> {fmtNum(e.q, 0)} m³/s <span style={{ color: T.inkFaint }}>({fechaCorta(String(e.timestamp || ""))})</span><br />24 h: {e.cambio_24h >= 0 ? "+" : ""}{fmtNum(e.cambio_24h, 0)} m³/s{e.viaje_texto ? ` · ${e.viaje_texto}` : e.viaje_h ? ` · ~${e.viaje_h} h a Olaya` : ""}
                  </div>
                ))}
              </div>
            </Tarjeta>
          )}
        </div>
      )}
      {v && datos.conectado && v.filas && !v.filas.length && !cargando && <Tarjeta T={T} titulo="Sin datos de LoggerNet">No se encontraron archivos de hoy ni de ayer en el repositorio. Revise el relay.</Tarjeta>}
    </>
  );
}

export { TIPO_ESTADO };
