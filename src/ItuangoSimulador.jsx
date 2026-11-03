/* ============================================================
   PH Ituango — Curvas características de las turbinas (diagrama colinar)
   ------------------------------------------------------------
   Este archivo contiene solo la interfaz de la app:
     - ItuangoColinaTurbina (componente principal)
     - ColinaModulo (buscador, despacho, diagramas y exploración)
     - PanelCondicionDescarga (nivel de la almenara)
     - ChartFamilia, InputNumeroLibre
   El modelo (cálculos) está en ./modelo.js, la lectura de LoggerNet en
   ./operacion.js y los controles comunes en ./ui/.
   ============================================================ */
import { useState, useMemo, useRef, useEffect } from "react";
import { ResponsiveContainer, LineChart, CartesianGrid, XAxis, YAxis, Tooltip as RTooltip, ReferenceLine, Line, Legend } from "recharts";
import OperacionMedida from "./ui/OperacionMedida.jsx";
import { useVivo, ProveedorVivo } from "./datos/vivo.jsx";
import { tramosCumplimiento } from "./analitica.js";
import { ProveedorDatos, useDatos } from "./datos/fuentes.jsx";
import { Proposito, PanelConexion } from "./ui/comunes.jsx";
import { GraficoSeries } from "./ui/graficos.jsx";
import { EQUIV_APERTURA, referenciasApertura, NOTA_APERTURA } from "./ui/Apertura.jsx";
import Tablero from "./ui/Tablero.jsx";
import ReglaAnla from "./ui/ReglaAnla.jsx";
import Unidades from "./ui/Unidades.jsx";
import Hidrologia from "./ui/Hidrologia.jsx";
import Vertedero from "./ui/Vertedero.jsx";
import Confiabilidad from "./ui/Confiabilidad.jsx";
import {
  ASE_Q_RIO_MAX,
  ASE_Q_RIO_MIN,
  CONDICION_DESCARGA_DEFECTO,
  CONDICION_DESCARGA_DISENO,
  ESCENARIOS_2023_EPM_GE,
  GAMMAS_HILL,
  GAMMA_AMPLIADO_MAX,
  GAMMA_ENSAYADO_MAX,
  GAMMA_NORMAL_MAX,
  GAMMA_ORIGINAL_MAX,
  HILL_PROTO_186,
  H_REFERENCIA_MODELO,
  K_PERDIDA_CARGA,
  MARGEN_FRECUENCIA_PCT,
  NAME,
  NAMO,
  NIVEL_MIN_TEC,
  NOTA_LIMITE_GARANTIZADO,
  N_TURBINAS_MAX,
  P_MAXIMO_ESPERADO_MW,
  FACTOR_HIDROMETRIA_MW_POR_M3S,
  SERVOMOTOR_2023,
  UNIDADES_DISPONIBLES_HOY,
  WAE_PUNTOS,
  buscarPuntoOptimo,
  caudalVertederoDetallado,
  construirMallaModelo,
  construirMallaProto,
  curvaEficienciaEnH,
  decidirCanalYAperturas,
  degFromPct,
  etiquetaCondicionDescarga,
  etiquetaRango,
  evaluarHillChart,
  evaluarTurbinaUnidad,
  gammaMecanicoDeRango,
  marchingSquares,
  nivelAlmenara,
  nivelAlmenaraASE,
  nivelAlmenaraSegunCondicion,
  pctFromDeg,
  picoEficiencia,
  resolverGammaConLimitePotencia,
  resolverGammaParaCaudal,
  resolverGammaParaPotencia,
  volumenUtilHm3,
  unidadesPorAlmenara,
  ZONAS,
  NOMBRE_ALMENARA,
  parsearResumenHorarioXM,
  simularDespachoHorario,
  unidadesMinimasParaPotencia,
  potenciaBornesDesdeEje,
  factorConversionHidrometria,
  rendimientoGenerador,
  textoHoraColombia,
  programaDespacho,
  resumenEnergiaDespacho,
  estadoHoraDespacho,
  ETIQUETA_ESTADO_HORA,
  bandaReglaOperativa,
  estadoReglaOperativa,
  ETIQUETA_ESTADO_REGLA,
} from "./modelo.js";
import {
  BotonCSV,
  BotonGrupo,
  ChartHeader,
  CustomTooltip,
  Etiqueta,
  FONT_BODY,
  GlobalStyles,
  Slider,
  THEMES,
  aplicarAltoContraste,
  axisLabel,
  fmtTick,
  tickStyleFor,
  zoomBrush,
  fx,
} from "./ui/base.jsx";

/* ============================================================
   MÓDULO SEPARADO — COLINA DE TURBINA
   ------------------------------------------------------------
   Reproduce, con los datos reales disponibles, el tipo de gráficos
   de las Figuras 4.1-4.8 del informe de ensayo (2013): familias de
   curvas de apertura constante (gamma) y curvas de eficiencia vs.
   caudal/potencia a salto fijo. NO incluye las isolíneas de
   eficiencia suavizadas (requieren un algoritmo de contorno 2D no
   especificado por la fuente) ni los polígonos de "área de operación
   continua/temporal" (no vienen con coordenadas en los datos
   extraídos) — se documenta esta limitación en vez de aproximarla.
   ============================================================ */
// 12 tonos con la misma luminosidad (OKLCH L=0,63): contraste ≥ 3:1 sobre fondo claro y oscuro
const COLORES_GAMMA = ["#9773D0", "#5F85DD", "#0095D1", "#00A1AA", "#00A374", "#579D47", "#87920B", "#B08000", "#C57118", "#CF664C", "#CF616D", "#C3639C"];
/* Fuera del componente para que su referencia sea estable entre renders
   — si se recrean en cada render, invalidan el useMemo de marching
   squares y lo obligan a recalcular contornos en cada movimiento de
   slider (era una de las causas de lentitud del módulo). */
const NIVELES_MODELO = [70, 75, 80, 83, 85, 87, 88, 89, 90, 91, 92, 93, 93.5, 94];
const NIVELES_PROTO = [70, 75, 80, 83, 85, 87, 88, 89, 90, 91, 92, 93, 93.5, 94, 94.5, 95, 95.4, 95.8, 96, 96.2];

function ChartFamilia({ ejeX, ejeY, xLabel, yLabel, xDomain, yDomain, waeCampoX, waeCampoY, waeEscala, bepXY, grid, niveles, puntoActualXY, lineasPorGamma, gammaCercana, T, puntosExtra, unidadY }) {
  const width = 860, height = 380, mL = 66, mR = 20, mT = 14, mB = 46;
  const plotW = width - mL - mR, plotH = height - mT - mB;
  // Zoom por selección: arrastra un rectángulo sobre el gráfico para
  // acercarte a esa región; "Reiniciar zoom" vuelve al dominio completo.
  const [zoomDom, setZoomDom] = useState(null); // { x:[min,max], y:[min,max] }
  const xDom = zoomDom ? zoomDom.x : xDomain;
  const yDom = zoomDom ? zoomDom.y : yDomain;
  const sx = (x) => mL + ((x - xDom[0]) / (xDom[1] - xDom[0])) * plotW;
  const sy = (y) => mT + plotH - ((y - yDom[0]) / (yDom[1] - yDom[0])) * plotH;
  const sxInv = (xPix) => xDom[0] + ((xPix - mL) / plotW) * (xDom[1] - xDom[0]);
  const syInv = (yPix) => yDom[0] + ((mT + plotH - yPix) / plotH) * (yDom[1] - yDom[0]);
  const contornos = useMemo(() => niveles.map((nivel) => ({ nivel, segs: marchingSquares(grid, nivel) })), [grid, niveles]);
  const ticksX = useMemo(() => { const n = 6; return Array.from({ length: n + 1 }, (_, i) => xDom[0] + (i / n) * (xDom[1] - xDom[0])); }, [xDom]);
  const ticksY = useMemo(() => { const n = 6; return Array.from({ length: n + 1 }, (_, i) => yDom[0] + (i / n) * (yDom[1] - yDom[0])); }, [yDom]);
  const campoX = ejeX === "n11" ? "n11" : "H";

  // Todos los puntos reales (de las 12 aperturas ensayadas) en un solo arreglo, para buscar el más cercano al mouse.
  const puntosTodos = useMemo(() => {
    const arr = [];
    lineasPorGamma.forEach(({ gamma: g, puntos }) => puntos.forEach((p) => arr.push({ ...p, gamma: g })));
    return arr;
  }, [lineasPorGamma]);

  const svgRef = useRef(null);
  const [hover, setHover] = useState(null); // {xPix, yPix, punto}
  const [arrastre, setArrastre] = useState(null); // {x0,y0,x1,y1} en píxeles del viewBox

  function coordsDesdeEvento(evt) {
    const rect = svgRef.current.getBoundingClientRect();
    return { xPix: ((evt.clientX - rect.left) / rect.width) * width, yPix: ((evt.clientY - rect.top) / rect.height) * height };
  }
  function alBajarMouse(evt) {
    evt.preventDefault();
    const { xPix, yPix } = coordsDesdeEvento(evt);
    if (xPix < mL || xPix > width - mR || yPix < mT || yPix > mT + plotH) return;
    setArrastre({ x0: xPix, y0: yPix, x1: xPix, y1: yPix });
  }
  function alMoverMouse(evt) {
    const { xPix, yPix } = coordsDesdeEvento(evt);
    if (arrastre) {
      const xc = Math.max(mL, Math.min(width - mR, xPix)), yc = Math.max(mT, Math.min(mT + plotH, yPix));
      setArrastre((a) => ({ ...a, x1: xc, y1: yc }));
      return;
    }
    if (xPix < mL || xPix > width - mR || yPix < mT || yPix > mT + plotH) { setHover(null); return; }
    let mejor = null, mejorD = Infinity;
    for (const p of puntosTodos) {
      const dx = sx(p[campoX]) - xPix, dy = sy(p[ejeY]) - yPix;
      const d = dx * dx + dy * dy;
      if (d < mejorD) { mejorD = d; mejor = p; }
    }
    if (mejor) setHover({ xPix: sx(mejor[campoX]), yPix: sy(mejor[ejeY]), punto: mejor });
  }
  function alSoltarMouse() {
    if (!arrastre) return;
    const anchoPix = Math.abs(arrastre.x1 - arrastre.x0), altoPix = Math.abs(arrastre.y1 - arrastre.y0);
    if (anchoPix > 10 && altoPix > 10) {
      const xA = sxInv(Math.min(arrastre.x0, arrastre.x1)), xB = sxInv(Math.max(arrastre.x0, arrastre.x1));
      const yA = syInv(Math.max(arrastre.y0, arrastre.y1)), yB = syInv(Math.min(arrastre.y0, arrastre.y1));
      setZoomDom({ x: [xA, xB], y: [yA, yB] });
    }
    setArrastre(null);
  }

  // En pantallas angostas la gráfica conserva 620 px de ancho y se desplaza
  // de lado: así los números de los ejes siguen siendo legibles.
  return (
    <div style={{ position: "relative", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      {zoomDom && (
        <button onClick={() => setZoomDom(null)} style={{
          position: "absolute", top: 0, right: 0, zIndex: 6, padding: "4px 10px", fontSize: 11, fontFamily: FONT_BODY, fontWeight: 600,
          border: `1px solid ${T.teal}`, borderRadius: 5, cursor: "pointer", background: T.panel, color: T.teal,
        }}>↺ Reiniciar zoom</button>
      )}
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", minWidth: 620, height: "auto", display: "block", cursor: "crosshair", userSelect: "none" }}
        onMouseDown={alBajarMouse} onMouseMove={alMoverMouse} onMouseUp={alSoltarMouse} onMouseLeave={() => { setHover(null); setArrastre(null); }}>
        {ticksY.map((v, i) => (
          <g key={i}>
            <line x1={mL} y1={sy(v)} x2={width - mR} y2={sy(v)} stroke={T.lineSoft} strokeDasharray="2 4" />
            <text x={mL - 8} y={sy(v) + 4} fontSize="11" fill={T.inkMuted} fontFamily={FONT_BODY} textAnchor="end">{fmtTick(v)}</text>
          </g>
        ))}
        {ticksX.map((v, i) => (
          <g key={i}>
            <line x1={sx(v)} y1={mT} x2={sx(v)} y2={mT + plotH} stroke={T.lineSoft} strokeDasharray="2 4" />
            <text x={sx(v)} y={mT + plotH + 16} fontSize="11" fill={T.inkMuted} fontFamily={FONT_BODY} textAnchor="middle">{fmtTick(v)}</text>
          </g>
        ))}
        <text x={mL + plotW / 2} y={mT + plotH + 34} fontSize="12.5" fontWeight="600" fill={T.ink} fontFamily={FONT_BODY} textAnchor="middle">{xLabel}</text>
        <text x={14} y={mT + plotH / 2} fontSize="12.5" fontWeight="600" fill={T.ink} fontFamily={FONT_BODY} textAnchor="middle" transform={`rotate(-90, 14, ${mT + plotH / 2})`}>{yLabel}</text>

        {/* Isolíneas de eficiencia, por marching squares sobre la malla interpolada */}
        {contornos.map(({ nivel, segs }) => (
          <g key={nivel}>
            {segs.map((s, i) => (
              <line key={i} x1={sx(s[0][0])} y1={sy(s[0][1])} x2={sx(s[1][0])} y2={sy(s[1][1])} stroke="#5FA85A" strokeWidth={Number.isInteger(nivel) ? 1.1 : 0.7} opacity={0.75} />
            ))}
          </g>
        ))}

        {/* Familia de curvas de apertura constante (γ), la más cercana resaltada */}
        {lineasPorGamma.map(({ gamma: g, puntos }, i) => {
          const pts = puntos.filter((p) => xDom[0] <= p[campoX] && p[campoX] <= xDom[1]);
          if (pts.length < 2) return null;
          const d = pts.map((p, k) => `${k === 0 ? "M" : "L"} ${sx(p[campoX])} ${sy(p[ejeY])}`).join(" ");
          const activo = g === gammaCercana;
          return <path key={g} d={d} fill="none" stroke={activo ? T.teal : COLORES_GAMMA[i]} strokeWidth={activo ? 3 : 1.3} opacity={activo ? 1 : 0.6} />;
        })}

        {/* WAE, BEP, punto actual */}
        {WAE_PUNTOS.map((p, i) => <circle key={i} cx={sx(p[waeCampoX])} cy={sy(p[waeCampoY] * (waeEscala || 1))} r={4} fill={T.amber} stroke={T.bg} strokeWidth={1} />)}
        <circle cx={sx(bepXY[0])} cy={sy(bepXY[1])} r={7} fill={T.red} stroke={T.bg} strokeWidth={1.5} />
        {puntoActualXY && <circle cx={sx(puntoActualXY[0])} cy={sy(puntoActualXY[1])} r={6} fill="none" stroke={T.ink} strokeWidth={2.2} />}
        {puntosExtra && puntosExtra.map((p, i) => (
          <g key={i}>
            <rect x={sx(p.x) - 5} y={sy(p.y) - 5} width={10} height={10} fill="#8E4EC6" stroke={T.bg} strokeWidth={1.2} transform={`rotate(45, ${sx(p.x)}, ${sy(p.y)})`} />
            <line x1={sx(p.x) + 7} y1={sy(p.y)} x2={sx(p.x) + 16} y2={sy(p.y) - 8 - i * 13} stroke="#8E4EC6" strokeWidth={0.8} opacity={0.6} />
            <text x={sx(p.x) + 18} y={sy(p.y) - 6 - i * 13} fontSize="10" fill={T.ink} fontFamily={FONT_BODY} fontWeight="700">{p.label}</text>
          </g>
        ))}
        {hover && <circle cx={hover.xPix} cy={hover.yPix} r={5} fill={T.cyan} stroke={T.bg} strokeWidth={1.5} />}
        {arrastre && (
          <rect x={Math.min(arrastre.x0, arrastre.x1)} y={Math.min(arrastre.y0, arrastre.y1)}
            width={Math.abs(arrastre.x1 - arrastre.x0)} height={Math.abs(arrastre.y1 - arrastre.y0)}
            fill={T.teal} fillOpacity={0.15} stroke={T.teal} strokeWidth={1} strokeDasharray="3 2" />
        )}
      </svg>
      {/* Leyenda como HTML normal (no SVG) para que pueda envolver en varias líneas en pantallas angostas, sin encimarse. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", padding: "8px 4px 2px", fontFamily: FONT_BODY, fontSize: 11.5, color: T.inkMuted, alignItems: "center" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke={T.teal} strokeWidth="3" /></svg>Apertura seleccionada</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke={COLORES_GAMMA[3]} strokeWidth="1.3" /></svg>Otras aperturas ensayadas</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke="#5FA85A" strokeWidth="1.3" /></svg>Isolíneas de eficiencia</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><svg width="10" height="10"><circle cx="5" cy="5" r="4" fill={T.amber} /></svg>WAE</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><svg width="10" height="10"><circle cx="5" cy="5" r="4" fill={T.red} /></svg>BEP</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="none" stroke={T.ink} strokeWidth="2" /></svg>Tu selección</span>
        {puntosExtra && <span style={{ display: "flex", alignItems: "center", gap: 5 }}><svg width="10" height="10"><rect x="1" y="1" width="8" height="8" fill="#8E4EC6" transform="rotate(45,5,5)" /></svg>Escenarios 2023</span>}
        <span style={{ marginLeft: "auto", fontSize: 10.5, color: T.inkFaint }}>Arrastra sobre el gráfico para hacer zoom</span>
      </div>
      {hover && (
        <div style={{
          position: "absolute", left: `${(hover.xPix / width) * 100}%`, top: `${(hover.yPix / height) * 100}%`,
          transform: "translate(12px, -110%)", background: T.panel, border: `1px solid ${T.line}`, borderRadius: 6,
          padding: "7px 10px", fontFamily: FONT_BODY, fontSize: 11, color: T.ink, boxShadow: T.cardShadow, pointerEvents: "none", whiteSpace: "nowrap", zIndex: 5,
        }}>
          <div style={{ color: T.teal, fontWeight: 700 }}>Apertura = {fx(pctFromDeg(hover.punto.gamma), 1)} % (γ = {fx(hover.punto.gamma, 2)}°)</div>
          <div>Q = {fx(hover.punto.Q, 1)} m³/s · P = {fx(hover.punto.P, 1)} MW</div>
          <div>η = {fx(hover.punto.eta, 2)}% · H = {fx(hover.punto.H, 1)} m</div>
        </div>
      )}
    </div>
  );
}


/* Panel de la condición de descarga: define el nivel de la almenara que
   usa todo el módulo y muestra, para el punto explorado, la diferencia
   frente a la condición de diseño. */
function PanelCondicionDescarga({ cond, setCond, T, nivelEmbalse, nUnidades, gamma }) {
  const set = (cambios) => setCond({ ...cond, ...cambios });
  const manual = typeof cond.almManual === "object" && cond.almManual ? cond.almManual : { norte: 224.3, sur: 224.3 };
  const rep = unidadesPorAlmenara(nUnidades, cond);
  const conCond = evaluarTurbinaUnidad(nivelEmbalse, gamma, nUnidades, cond);
  const conDiseno = evaluarTurbinaUnidad(nivelEmbalse, gamma, nUnidades, CONDICION_DESCARGA_DISENO);
  const qRio = cond.qRio ?? 1350;
  const filasTabla = [0, 1, 2, 3, 4].map((n) => {
    const dis = nivelAlmenara(n);
    const n1 = nivelAlmenaraASE("norte", qRio, n * 168.75);
    const n2 = nivelAlmenaraASE("sur", qRio, n * 168.75);
    return { n, dis, n1, n2 };
  });
  const celda = { padding: "4px 8px", borderBottom: `1px solid ${T.line}`, textAlign: "right", fontVariantNumeric: "tabular-nums" };
  const qTurbTotal = conCond ? conCond.Q * (rep.norte + rep.sur) : 0;
  const lineaGrupo = (r, z) => (
    <div key={z}>
      {NOMBRE_ALMENARA[z]}, {rep[z]} ud.: almenara <b style={{ color: T.ink }}>{fx(r.nivelAlmenara, 2)}</b> msnm · salto neto <b style={{ color: T.ink }}>{fx(r.saltoNeto, 2)}</b> m · Q {fx(r.Q, 1)} m³/s · P <b style={{ color: T.ink }}>{fx(r.P, 1)}</b> MW por unidad
      {r.avisosAlmenara && r.avisosAlmenara.length > 0 && <span style={{ color: T.amber }}> · ⚠ {r.avisosAlmenara.join("; ")}</span>}
    </div>
  );
  return (
    <div>
      <ChartHeader titulo="Condición de descarga (nivel de las almenaras)" T={T}
        subtitulo="Define el nivel de las almenaras aguas abajo que usan la exploración, el Buscador, el despacho intradiario y los diagramas. El salto neto de cada unidad es: nivel del embalse − nivel de SU almenara − pérdida de carga."
        tip="La colina de la turbina (ensayo 2013, GE) no cambia. Lo que cambia es el nivel de las almenaras: con el lecho del río colmatado (contingencia de abril/2018) quedan varios metros por encima de la condición de diseño y el salto neto disminuye. GE solo tiene datos para las condiciones de diseño y exige restituirlas (dragado / cota de embalse); los niveles de la Asesoría (ASE) reflejan la condición actual sin dragado y difieren de los de GE." />
      <div style={{ fontSize: 12.5, color: T.inkMuted, fontFamily: FONT_BODY, marginBottom: 10, lineHeight: 1.5 }}>
        Operación conjunta: las unidades 1-4 descargan en la <b>almenara N°1 (norte)</b>, hoy en operación; las unidades 5-8 descargan en la <b>almenara N°2 (sur)</b>, que operará a partir de inicios de 2028. Con n unidades activas se despachan en orden 1 → 8: la N°1 recibe hasta 4 y la N°2 el resto. Cada almenara solo recibe el caudal de sus unidades; el caudal del río es uno solo.
      </div>
      <BotonGrupo T={T} label="Condición" value={cond.modo} onChange={(v) => set({ modo: v })}
        tip="Actual: tablas HEC-RAS de la Asesoría (ASE, 2026), río colmatado. Diseño: niveles del pliego (Tabla 7.5.2), los únicos con los que GE tiene datos. Manual: niveles medidos (p. ej. Hidrometría)."
        options={[
          { value: "ase", label: "Actual: río colmatado (ASE 2026)" },
          { value: "diseno", label: "Diseño GE / pliego (río dragado)" },
          { value: "manual", label: "Manual (niveles medidos)" },
        ]} />
      {cond.modo === "ase" && (
        <Slider T={T} label="Caudal del río Cauca en D4'" value={qRio} min={150} max={ASE_Q_RIO_MAX} step={10} unit=" m³/s"
          onChange={(v) => set({ qRio: v })}
          tip="Caudal del río aguas abajo de la descarga N°4 (incluye lo turbinado por ambas almenaras y lo vertido). La estación Descarga R está unos 600 m más abajo. La ASE simuló 500 a 2660 m³/s; por debajo de 500 se extrapola con la pendiente entre 500 y 1000 m³/s, sin bajar de la corona del jarillón (220 msnm N°1, 218 msnm N°2), y se avisa." />
      )}
      {cond.modo === "manual" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
          <Slider T={T} label="Almenara N°1 (U1-U4)" value={manual.norte} min={205} max={235} step={0.01} unit=" msnm"
            onChange={(v) => set({ almManual: { ...manual, norte: v } })} tip="Nivel medido o supuesto de la almenara N°1." />
          <Slider T={T} label="Almenara N°2 (U5-U8)" value={manual.sur} min={205} max={235} step={0.01} unit=" msnm"
            onChange={(v) => set({ almManual: { ...manual, sur: v } })} tip="Nivel medido o supuesto de la almenara N°2 (operará desde inicios de 2028)." />
        </div>
      )}
      {cond.modo === "ase" && qRio < ASE_Q_RIO_MIN && (
        <div style={{ fontSize: 12, color: T.amber, fontFamily: FONT_BODY, marginBottom: 8 }}>
          ⚠ Caudal del río por debajo de lo simulado por la ASE ({ASE_Q_RIO_MIN} m³/s): el nivel de las almenaras se extrapola linealmente con la pendiente entre 500 y 1000 m³/s de la misma tabla. Es una estimación; conviene pedir a la ASE simular caudales bajos.
        </div>
      )}
      {cond.modo === "ase" && qRio > ASE_Q_RIO_MAX && (
        <div style={{ fontSize: 12, color: T.amber, fontFamily: FONT_BODY, marginBottom: 8 }}>
          ⚠ Caudal del río por encima de lo simulado por la ASE ({ASE_Q_RIO_MAX} m³/s): se usa la fila de {ASE_Q_RIO_MAX} m³/s (no se extrapola hacia crecientes).
        </div>
      )}
      {cond.modo === "ase" && conCond && qRio < qTurbTotal - 1 && (
        <div style={{ fontSize: 12, color: T.red, fontFamily: FONT_BODY, marginBottom: 8 }}>
          ⚠ El caudal del río ({Math.round(qRio)} m³/s) es menor que lo turbinado en el punto explorado ({Math.round(qTurbTotal)} m³/s). No es físicamente posible: el río en D4' incluye todo lo turbinado.
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20, alignItems: "start" }}>
        <div style={{ overflowX: "auto" }}>
          <Etiqueta T={T} tip="Valores con cada unidad a 168,75 m³/s (caudal de diseño por unidad, Tabla 4-1 de la ASE). En los cálculos se usa el caudal real de cada unidad.">Nivel de cada almenara (msnm) según sus unidades a 168,75 m³/s</Etiqueta>
          <table style={{ borderCollapse: "collapse", fontSize: 12, fontFamily: FONT_BODY, color: T.ink, width: "100%" }}>
            <thead>
              <tr style={{ color: T.inkMuted }}>
                <th style={{ ...celda, textAlign: "left" }}>Unidades en la almenara</th>
                <th style={celda}>Diseño</th>
                <th style={celda}>ASE N°1 · {Math.round(qRio)} m³/s</th>
                <th style={celda}>ASE N°2 · {Math.round(qRio)} m³/s</th>
              </tr>
            </thead>
            <tbody>
              {filasTabla.map((f) => (
                <tr key={f.n}>
                  <td style={{ ...celda, textAlign: "left" }}>{f.n}{f.n === 2 ? " *" : ""}</td>
                  <td style={celda}>{fx(f.dis, 2)}</td>
                  <td style={celda}>{fx(f.n1.nivel, 2)}{f.n1.fueraDeTabla ? " †" : ""}</td>
                  <td style={celda}>{fx(f.n2.nivel, 2)}{f.n2.fueraDeTabla ? " †" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: T.inkFaint, fontFamily: FONT_BODY, marginTop: 4, lineHeight: 1.4 }}>
            * Diseño con 2 unidades: interpolado (no está en el pliego). † Valor estimado fuera de lo simulado por la ASE (caudal del río bajo 500 m³/s, celda no simulada completada con el incremento de la fila más cercana, o extrapolación); se indica el motivo en el punto explorado.
          </div>
        </div>
        <div style={{ fontSize: 12.5, fontFamily: FONT_BODY, color: T.inkMuted, lineHeight: 1.6 }}>
          <Etiqueta T={T}>Punto explorado ({fx(nivelEmbalse, 2)} msnm, {fx(pctFromDeg(gamma), 1)}% = {fx(gamma, 2)}°, {rep.norte + rep.sur} ud.: {rep.norte} en N°1{rep.sur > 0 ? `, ${rep.sur} en N°2` : ""})</Etiqueta>
          {conCond && conDiseno ? (
            <>
              <div style={{ fontWeight: 600, color: T.ink }}>Condición elegida</div>
              {ZONAS.filter((z) => conCond.porAlmenara[z]).map((z) => lineaGrupo(conCond.porAlmenara[z], z))}
              <div style={{ fontWeight: 600, color: T.ink, marginTop: 4 }}>Diseño (río dragado)</div>
              {ZONAS.filter((z) => conDiseno.porAlmenara[z]).map((z) => lineaGrupo(conDiseno.porAlmenara[z], z))}
              <div style={{ marginTop: 4 }}>Diferencia por la condición de descarga (promedio por unidad): salto {fx(conCond.saltoNeto - conDiseno.saltoNeto, 2)} m · potencia {fx((conCond.P / conDiseno.P - 1) * 100, 1)}%</div>
            </>
          ) : (
            <div style={{ color: T.amber }}>Sin resultado: el salto neto queda fuera del rango ensayado de la colina.</div>
          )}
          <div style={{ fontSize: 11, color: T.inkFaint, marginTop: 6 }}>
            Fuentes: diseño — pliego, Tabla 7.5.2 (citada en el estudio de ampliación de GE, 2023). Actual — estudio de almenaras de la ASE (2026), Tablas 4-2 y 4-3, HEC-RAS calibrado con niveles del río de 2025; corona de los jarillones: num. 4.2. Las garantías de GE (307 MW por unidad, 30,2°) siguen aplicando como límites.
          </div>
        </div>
      </div>
    </div>
  );
}

/* Número es-CO con los decimales que traiga el dato (máximo 3). */
const fxa = (v) => (v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toLocaleString("es-CO", { maximumFractionDigits: 3 }));

function InputNumeroLibre({ value, onChange, className, style, min, max, step, disabled }) {
  const dec = step && step < 1 ? Math.min(4, (String(step).split(".")[1] || "").length) : 0;
  const fmtPaso = (v) => (Number.isFinite(v) ? String(Number(v.toFixed(Math.max(dec, 2)))) : String(v));
  const [texto, setTexto] = useState(fmtPaso(value));
  const [editando, setEditando] = useState(false);
  useEffect(() => { if (!editando) setTexto(fmtPaso(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      type="number" value={texto} min={min} max={max} step={step} className={className} style={style} disabled={disabled}
      onChange={(e) => { setTexto(e.target.value); const n = parseFloat(e.target.value); if (Number.isFinite(n)) onChange(n); }}
      onFocus={() => setEditando(true)}
      onBlur={() => { setEditando(false); setTexto(fmtPaso(Number.isFinite(parseFloat(texto)) ? parseFloat(texto) : value)); }}
    />
  );
}

/* ============================================================
   DESPACHO INTRADIARIO — nivel del embalse hora a hora con el
   programa de XM. Entradas: nivel inicial, caudal de entrada
   PRONOSTICADO (lo ingresa el usuario; general y, si se quiere, por
   hora), despacho XM por hora (se puede pegar el "Resumen horario"),
   Promedio RT (opcional), unidades por hora (por defecto, el mínimo
   que entrega la potencia sin pasar de 307 MW) y nivel medido
   (opcional, para comparar). Escenarios: despacho, banda XM ±b % (banda operativa de la generación RT), RT y
   caudal de entrada ± sensibilidad. Cálculo: simularDespachoHorario
   (modelo.js). Validación con la operación ene-oct 2026:
   el script de validación del repositorio de datos.
   ============================================================ */
const NOMBRE_PROGRAMA = { xm: "Despacho XM", rt: "Promedio RT (y XM donde falta)", rtPlano: "Promedio RT (y plano donde falta)", plano: "Plano por regla operativa" };
const nombrePrograma = (modo, progs) => (modo === "rt" && progs && progs.rt && progs.rt.conPlano ? NOMBRE_PROGRAMA.rtPlano : NOMBRE_PROGRAMA[modo]);
const HORAS_DIA = Array.from({ length: 24 }, (_, i) => i);
const filaDespachoVacia = (h) => ({ hora: h, despacho: 0, rt: null, unidades: null, qEntrada: null, nivelMedido: null });

function InputOpcional({ value, onChange, placeholder, step, style }) {
  const [texto, setTexto] = useState(value == null ? "" : String(value));
  useEffect(() => { setTexto(value == null ? "" : String(value)); }, [value]);
  return (
    <input
      type="number" value={texto} step={step} placeholder={placeholder} className="itu-num-input" style={style}
      onChange={(e) => {
        setTexto(e.target.value);
        const t = e.target.value.trim();
        if (t === "") { onChange(null); return; }
        const n = parseFloat(t);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

function TooltipNivel({ active, payload, label, T }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 6, padding: "8px 12px", fontFamily: FONT_BODY, fontSize: 11, color: T.ink, boxShadow: T.cardShadow }}>
      <div style={{ color: T.inkFaint, marginBottom: 4 }}>Hora {label}:00</div>
      {payload.map((p, i) => p.value != null && <div key={i} style={{ color: p.color }}>{p.name}: {fx(Number(p.value), 3)} msnm</div>)}
    </div>
  );
}

function PanelDespachoIntradiario({ T, condDescarga, gammaMax, etiquetaTecho }) {
  const [fecha, setFecha] = useState(() => textoHoraColombia(new Date()).slice(0, 10));
  const [nivelInicial, setNivelInicial] = useState(407.31);
  const [qEntrada, setQEntrada] = useState(300);
  const [sensQ, setSensQ] = useState(75);
  const [bandaPct, setBandaPct] = useState(5);
  const [programa, setPrograma] = useState("xm"); // xm | rt | plano: potencia con que se simula el nivel
  const [qAyer, setQAyer] = useState(null); // promedio regulado del día anterior (m³/s), regla operativa
  const [unidadesDisp, setUnidadesDisp] = useState(UNIDADES_DISPONIBLES_HOY);
  const [filas, setFilas] = useState(() => HORAS_DIA.map(filaDespachoVacia));
  const [texto, setTexto] = useState("");
  const [msgCarga, setMsgCarga] = useState(null);
  const editar = (h, campo, v) => setFilas((prev) => prev.map((f) => (f.hora === h ? { ...f, [campo]: v } : f)));

  /* Datos en vivo: nivel de las 00:00, Q regulado de ayer, caudal de entrada
     y, en las horas ya pasadas, la potencia real (Promedio RT), las unidades
     en línea y el nivel medido. Se llenan solos la primera vez. */
  const { vivo } = useVivo() || {};
  const [vivoAplicado, setVivoAplicado] = useState(false);
  const opcionesEntrada = useMemo(() => {
    if (!vivo) return [];
    const o = [];
    const pr = vivo.hf?.pronostico?.datos?.data;
    const hoyP = pr && pr.find((x) => String(x.timestamp).slice(0, 10) === vivo.hoy);
    if (hoyP && hoyP.QSitioPresa_pred_mean != null) o.push({ k: "hf", q: hoyP.QSitioPresa_pred_mean, txt: "Pronóstico HydroForecast de hoy (Sitio Presa)" });
    if (vivo.resHoy && vivo.resHoy.balance.qEntrada != null) o.push({ k: "hoy", q: vivo.resHoy.balance.qEntrada, txt: `Balance de masa de hoy (${fx(vivo.resHoy.balance.horas, 1)} h)` });
    if (vivo.filaAyer && vivo.filaAyer.balance.qEntrada != null) o.push({ k: "ayer", q: vivo.filaAyer.balance.qEntrada, txt: "Balance de masa de ayer" });
    return o;
  }, [vivo]);
  const [fuenteEntrada, setFuenteEntrada] = useState(null);
  function llenarConVivo(v, kEntrada) {
    if (!v) return;
    setFecha(v.hoy);
    const n00 = (v.filas || []).find((r) => r.t === `${v.hoy} 00:00` && r.nivel != null);
    if (n00) setNivelInicial(+n00.nivel.toFixed(3));
    const qBase = v.banda ? v.banda.base : v.filaAyer && !v.filaAyer.parcial ? v.filaAyer.regla.qReg : null;
    if (qBase != null) {
      setQAyer(+qBase.toFixed(2));
      // sin programa de XM pegado: lo generado en las horas cerradas y el plano en el resto
      if (!filas.some((f) => f.despacho > 0)) setPrograma("rt");
    }
    const op = opcionesEntrada.find((x) => x.k === kEntrada) || opcionesEntrada[0];
    if (op) { setQEntrada(Math.round(op.q)); setFuenteEntrada(op.k); }
    const horaActual = v.ultima ? +v.ultima.t.slice(11, 13) : 24;
    const nivelHora = new Map((v.filas || []).filter((r) => r.t.startsWith(v.hoy) && r.t.slice(14) === "00" && r.nivel != null).map((r) => [+r.t.slice(11, 13), r.nivel]));
    setFilas((prev) => prev.map((f) => {
      const h = v.resHoy ? v.resHoy.horas[f.hora] : null;
      const completa = h && h.min >= 50 && f.hora < horaActual; // solo horas ya cerradas
      return {
        ...f,
        rt: completa ? +(h.e.reduce((a, x) => a + (x || 0), 0) / (h.min / 60)).toFixed(1) : f.rt,
        unidades: completa ? h.linea.filter((x) => x >= 0.5).length : f.unidades,
        nivelMedido: nivelHora.has(f.hora) ? +nivelHora.get(f.hora).toFixed(3) : f.nivelMedido,
      };
    }));
    setMsgCarga({ ok: true, txt: `Datos en vivo de ${v.hoy}: nivel de las 00:00, Q regulado de ayer, caudal de entrada y, en las horas ya cerradas, Promedio RT, unidades en línea y nivel medido. El despacho de XM se pega abajo.` });
  }
  useEffect(() => {
    if (!vivoAplicado && vivo && vivo.resHoy) { llenarConVivo(vivo); setVivoAplicado(true); }
  }, [vivo]); // eslint-disable-line react-hooks/exhaustive-deps

  function cargarTabla() {
    const r = parsearResumenHorarioXM(texto);
    const leidas = r.horas.filter(Boolean);
    if (!leidas.length) {
      setMsgCarga({ ok: false, txt: "No se reconoció ninguna fila horaria. Pega las filas tal como salen del resumen (\"00:00 - 00:59  700.0 MW ...\") o en dos o tres columnas: hora, despacho, Promedio RT." });
      return;
    }
    // Si la tabla pegada no trae Promedio RT para una hora, se conserva el que ya había (p. ej. el de los datos en vivo).
    setFilas((prev) => prev.map((f) => { const x = r.horas[f.hora]; return x ? { ...f, despacho: x.despacho, rt: x.rt != null ? x.rt : f.rt } : f; }));
    if (r.fecha) setFecha(r.fecha);
    const conRT = leidas.filter((x) => x.rt != null).length;
    const conBanda = leidas.find((x) => x.bandaSup != null && x.despacho > 0);
    let nota = "";
    if (conBanda) {
      const pct = (conBanda.bandaSup / conBanda.despacho - 1) * 100;
      if (Math.abs(pct - bandaPct) > 0.05) nota = ` La tabla trae una banda de ±${fx(pct, 1)} %; la configurada aquí es ±${bandaPct} %.`;
    }
    setMsgCarga({ ok: true, txt: `${leidas.length} horas cargadas, ${conRT} con Promedio RT.${nota} ${r.fecha ? ` Fecha del despacho: ${r.fecha}.` : ""} Las unidades, el caudal de entrada por hora y el nivel medido no se tocaron.`, avisos: r.avisos });
  }

  const fcInicio = factorConversionHidrometria(nivelInicial, `${fecha} 00:00`);
  const calc = useMemo(() => {
    const b = bandaPct / 100;
    // Sin despacho de XM pegado, los programas XM y "RT + XM" no existen (serían ceros):
    // no se simulan ni se comparan. RT solo se usa solo si cubre las 24 h.
    const hayXM = filas.some((f) => f.despacho > 0);
    const progXMBase = programaDespacho(filas, "xm");
    const progXM = hayXM ? progXMBase : null;
    const hayRT = filas.some((f) => f.rt != null);
    const progPlano = programaDespacho(filas, "plano", { qObjetivo: qAyer, fc: fcInicio });
    // RT: lo generado donde hay dato; en el resto, XM si se pegó, si no el plano
    let progRT = null;
    if (hayRT && hayXM) progRT = programaDespacho(filas, "rt");
    else if (hayRT && progPlano) progRT = { potencias: filas.map((f, i) => (f.rt != null ? f.rt : progPlano.potencias[i])), rellenadas: [], conPlano: true };
    else if (hayRT && filas.every((f) => f.rt != null)) progRT = programaDespacho(filas, "rt");
    const progs = { xm: progXM, rt: progRT, plano: progPlano };
    const modo = progs[programa] ? programa : progs.plano ? "plano" : progs.rt ? "rt" : "xm";
    const prog = progs[modo] || progXMBase;
    const esc = (pot, qin) => simularDespachoHorario({
      nivelInicial, qEntrada: qin, cond: condDescarga, gammaMax,
      horas: filas.map((f, i) => {
        const P = pot[i];
        return { potenciaMW: P, unidades: f.unidades != null ? f.unidades : unidadesMinimasParaPotencia(P, unidadesDisp), qEntrada: f.qEntrada == null ? undefined : f.qEntrada + (qin - qEntrada) };
      }),
    });
    const principal = esc(prog.potencias, qEntrada);
    // Banda operativa de la generación: el despacho de XM ± banda (la misma
    // con la que se juzga el Promedio RT de cada hora). Se define con XM,
    // sea cual sea el programa simulado; sin despacho de XM no hay banda.
    // inf = generación XM −b (turbina menos, el nivel queda más alto); sup = XM +b.
    const inf = hayXM ? esc(progXMBase.potencias.map((p) => p * (1 - b)), qEntrada) : null;
    const sup = hayXM ? esc(progXMBase.potencias.map((p) => p * (1 + b)), qEntrada) : null;
    const qMenos = esc(prog.potencias, qEntrada - sensQ);
    const qMas = esc(prog.potencias, qEntrada + sensQ);
    const comparar = Object.fromEntries(Object.entries(progs).filter(([k, v]) => v && k !== modo).map(([k, v]) => [k, esc(v.potencias, qEntrada)]));
    const grafica = Array.from({ length: 25 }, (_, i) => ({
      hora: i, principal: principal.serie[i].nivel, bandaInf: inf ? inf.serie[i].nivel : null, bandaSup: sup ? sup.serie[i].nivel : null,
      xm: comparar.xm ? comparar.xm.serie[i].nivel : null, rt: comparar.rt ? comparar.rt.serie[i].nivel : null, plano: comparar.plano ? comparar.plano.serie[i].nivel : null,
      qMenos: qMenos.serie[i].nivel, qMas: qMas.serie[i].nivel,
      medido: i < 24 ? filas[i].nivelMedido : null,
    }));
    const errMedido = filas.filter((f) => f.nivelMedido != null).map((f) => principal.serie[f.hora].nivel - f.nivelMedido);
    // Regla operativa: caudal regulado de Hidrometría (P / F.C.) con el nivel al inicio de cada hora
    const banda = bandaReglaOperativa(qAyer);
    // F.C. de cada hora: con el nivel medido a esa hora si existe; si no, el simulado
    const fcH = (i) => factorConversionHidrometria(filas[i].nivelMedido ?? principal.detalle[i].Hinicio, `${fecha} ${String(i).padStart(2, "0")}:00`);
    const qReg = (p, i) => (p == null ? null : p / fcH(i));
    const promedio = (vals) => { const v = vals.filter((x) => x != null); return v.length ? { q: v.reduce((a2, x) => a2 + x, 0) / v.length, horas: v.length } : null; };
    const regla = {
      banda,
      xm: hayXM ? promedio(filas.map((f, i) => qReg(f.despacho, i))) : null,
      rt: promedio(filas.map((f, i) => qReg(f.rt, i))),
      principal: promedio(prog.potencias.map((p, i) => qReg(p, i))),
      porHora: filas.map((f, i) => ({ xm: qReg(f.despacho, i), rt: qReg(f.rt, i), principal: qReg(prog.potencias[i], i) })),
    };
    return { modo, prog, progs, principal, inf, sup, qMenos, qMas, comparar, grafica, errMedido, regla, energia: resumenEnergiaDespacho(hayXM ? filas : filas.map((f) => ({ ...f, despacho: null }))), estados: filas.map((f) => estadoHoraDespacho(hayXM ? f.despacho : null, f.rt, bandaPct)), hayXM };
  }, [filas, nivelInicial, qEntrada, sensQ, bandaPct, unidadesDisp, condDescarga, gammaMax, programa, qAyer, fcInicio, fecha]);

  /* Banda operacional del día (Res. 1891): caudal regulado medido (minuto a
     minuto, si la fecha es hoy y hay datos en vivo), total descargado, promedio
     acumulado medido y su proyección con el programa en las horas que faltan,
     frente a la banda. La franja inferior muestra cuándo el promedio acumulado
     queda dentro o fuera (la regla se juzga con el promedio final del día). */
  const bandaDia = useMemo(() => {
    const banda = calc.regla.banda;
    const medido = vivo && vivo.hoy === fecha && vivo.filas ? vivo.filas.filter((r) => r.t.startsWith(fecha)) : [];
    const PASO = 5; // minutos entre puntos del gráfico
    const n = 1440 / PASO;
    const qMin = new Map(), qVertMin = new Map();
    for (const r of medido) {
      const m = +r.t.slice(11, 13) * 60 + +r.t.slice(14, 16);
      if (r.p.every((x) => x == null)) continue;
      const P = r.p.reduce((a2, x2) => a2 + (x2 != null && x2 > 0 ? x2 : 0), 0);
      qMin.set(m, P / factorConversionHidrometria(r.nivel, r.t));
      qVertMin.set(m, r.qVert != null ? Math.max(0, r.qVert) : 0);
    }
    const ultimoMin = qMin.size ? Math.max(...qMin.keys()) : -1;
    // Promedios acumulados minuto a minuto: medido hasta el último dato; después, el programa
    const cumMed = new Array(1440).fill(null), cumProy = new Array(1440).fill(null);
    let sMed = 0, cMed = 0, sProg = 0, cProg = 0;
    for (let j = 0; j < 1440; j++) {
      if (qMin.has(j)) { sMed += qMin.get(j); cMed++; }
      else if (j > ultimoMin) { const qp = calc.regla.porHora[Math.floor(j / 60)].principal; if (qp != null) { sProg += qp; cProg++; } }
      if (j <= ultimoMin && cMed) cumMed[j] = sMed / cMed;
      if (j >= ultimoMin && cMed + cProg) cumProy[j] = (sMed + sProg) / (cMed + cProg);
    }
    const x = [], qReg = [], qDesc = [], acumMed = [], acumProy = [], qProg = [], bMin = [], bMax = [];
    for (let k = 0; k <= n; k++) {
      const m = Math.min(1439, k * PASO);
      x.push((k * PASO) / 60);
      qReg.push(qMin.has(m) ? qMin.get(m) : null);
      qDesc.push(qMin.has(m) ? qMin.get(m) + (qVertMin.get(m) || 0) : null);
      acumMed.push(cumMed[m]);
      acumProy.push(cumProy[m]);
      qProg.push(calc.regla.porHora[Math.floor(m / 60)].principal);
      bMin.push(banda ? banda.min : null); bMax.push(banda ? banda.max : null);
    }
    // tramos: medido (sólido) y proyectado (tenue)
    const valor = x.map((_, i) => acumMed[i] ?? acumProy[i]);
    const { tramos } = tramosCumplimiento(x, valor, bMin, bMax);
    const corte = ultimoMin >= 0 ? (ultimoMin + 1) / 60 : 0;
    const partidos = [];
    for (const t of tramos) {
      if (t.x1 <= corte) partidos.push(t);
      else if (t.x0 >= corte) partidos.push({ ...t, proyectado: true });
      else { partidos.push({ ...t, x1: corte }); partidos.push({ ...t, x0: corte, proyectado: true }); }
    }
    const dur = (tipo, proy) => partidos.filter((t) => t.tipo === tipo && !!t.proyectado === proy).reduce((a2, t) => a2 + (t.x1 - t.x0), 0);
    const hm = (h) => `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, "0")} min`;
    // tiempo con el caudal instantáneo dentro de la banda (seguimiento)
    let dentroInst = 0;
    if (banda) for (const q of qMin.values()) if (q >= banda.min && q <= banda.max) dentroInst++;
    const leyenda = [
      { tipo: "dentro", rotulo: "Promedio acumulado dentro de la banda", duracion: hm(dur("dentro", false)) },
      { tipo: "encima", rotulo: "Por encima", duracion: hm(dur("encima", false)) },
      { tipo: "debajo", rotulo: "Por debajo", duracion: hm(dur("debajo", false)) },
    ];
    if (corte < 24) leyenda.push({ tipo: "proyectado", proyectado: true, rotulo: `Proyección con el programa (${nombrePrograma(calc.modo, calc.progs)}) desde las ${String(Math.floor(corte)).padStart(2, "0")}:${String(Math.round((corte % 1) * 60)).padStart(2, "0")}` });
    const series = [
      { nombre: "Banda mín.", datos: bMin, color: T.inkFaint, dash: true, ancho: 1.2 },
      { nombre: "Banda máx.", datos: bMax, color: T.inkFaint, dash: true, ancho: 1.2 },
      { nombre: "Q regulado medido", datos: qReg, indice: 0, ancho: 1.2 },
      { nombre: "Total descargado medido", datos: qDesc, indice: 2, ancho: 1.2, oculta: true },
      { nombre: "Q regulado del programa", datos: qProg, indice: 1, ancho: 1.4, dash: true, escalones: true },
      { nombre: "Promedio acumulado medido", datos: acumMed, indice: 6, ancho: 2.6 },
      { nombre: "Promedio acumulado proyectado", datos: acumProy, indice: 6, ancho: 2.2, dash: true },
    ];
    return { x, series, tramos: partidos, leyenda, cierre: acumProy[acumProy.length - 1], minutosMedidos: qMin.size, dentroInst, banda, corte };
  }, [calc, vivo, fecha, T]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Potencia por hora: despacho de XM, generación real y programa simulado. */
  const seriesPotencia = useMemo(() => {
    const x = [...HORAS_DIA, 24];
    const ext = (arr) => [...arr, arr[arr.length - 1]];
    const s = [];
    const bandas = [];
    if (calc.hayXM) {
      const k = bandaPct / 100;
      s.push({ nombre: `XM −${bandaPct} %`, datos: ext(filas.map((f) => (f.despacho != null ? f.despacho * (1 - k) : null))), indice: 1, dash: true, ancho: 1, escalones: true });
      s.push({ nombre: `XM +${bandaPct} %`, datos: ext(filas.map((f) => (f.despacho != null ? f.despacho * (1 + k) : null))), indice: 1, dash: true, ancho: 1, escalones: true });
      bandas.push({ desde: 0, hasta: 1, relleno: "rgba(235,104,52,0.10)" });
      s.push({ nombre: "Despacho XM", datos: ext(filas.map((f) => (f.despacho != null ? f.despacho : null))), indice: 1, ancho: 1.8, escalones: true });
    }
    if (filas.some((f) => f.rt != null)) s.push({ nombre: "Generación real (RT)", datos: ext(filas.map((f) => f.rt)), indice: 0, ancho: 2.2, escalones: true });
    s.push({ nombre: `Programa simulado (${nombrePrograma(calc.modo, calc.progs)})`, datos: ext(calc.prog.potencias), indice: 6, ancho: 1.6, dash: true, escalones: true });
    if (calc.regla.banda) {
      s.push({ nombre: "Banda 1891 mín. (MW, F.C. de las 00:00)", datos: x.map(() => calc.regla.banda.min * fcInicio), color: T.inkFaint, dash: true, ancho: 1 });
      s.push({ nombre: "Banda 1891 máx. (MW)", datos: x.map(() => calc.regla.banda.max * fcInicio), color: T.inkFaint, dash: true, ancho: 1 });
    }
    return { x, s, bandas };
  }, [calc, filas, fcInicio, T, bandaPct]);

  const seriesNivel = useMemo(() => {
    const g = calc.grafica;
    const s = [
      { nombre: `Entrada −${sensQ} m³/s`, datos: g.map((x) => x.qMenos), color: T.inkFaint, dash: true, ancho: 1.2 },
      { nombre: `Entrada +${sensQ} m³/s`, datos: g.map((x) => x.qMas), color: T.inkFaint, dash: true, ancho: 1.2 },
      { nombre: `Despacho XM −${bandaPct} %`, datos: g.map((x) => x.bandaInf), indice: 1, dash: true, ancho: 1.2 },
      { nombre: `Despacho XM +${bandaPct} %`, datos: g.map((x) => x.bandaSup), indice: 1, dash: true, ancho: 1.2 },
      { nombre: nombrePrograma(calc.modo, calc.progs), datos: g.map((x) => x.principal), indice: 0, ancho: 2.6 },
    ];
    if (calc.comparar.xm) s.push({ nombre: "Despacho XM", datos: g.map((x) => x.xm), indice: 1, ancho: 1.6 });
    if (calc.comparar.rt) s.push({ nombre: "Promedio RT", datos: g.map((x) => x.rt), indice: 3, ancho: 1.8 });
    if (calc.comparar.plano) s.push({ nombre: "Plano por regla", datos: g.map((x) => x.plano), indice: 6, ancho: 1.6 });
    s.push({ nombre: "Nivel medido", datos: g.map((x) => x.medido), color: T.ink, soloPuntos: true, puntos: true });
    return { x: g.map((x) => x.hora), s };
  }, [calc, T, sensQ, bandaPct]); // eslint-disable-line react-hooks/exhaustive-deps
  const det = calc.principal.detalle;
  // Apertura por hora: la del programa simulado (igual para cada unidad en
  // línea) y, si la fecha es hoy, la estimada de cada unidad con lo medido.
  const seriesApertura = (() => {
    const x = [...HORAS_DIA, 24];
    const ext = (arr) => [...arr, arr[arr.length - 1]];
    const pct = (g) => (g != null && g > 0 ? +pctFromDeg(g).toFixed(2) : null);
    const s = [];
    const hReal = vivo && vivo.hoy === fecha && vivo.resHoy ? vivo.resHoy.horas : null;
    if (hReal) {
      const nU = hReal.reduce((k, h) => Math.max(k, h && h.gamma ? h.gamma.length : 0), 0);
      for (let u = 0; u < nU; u++) {
        const datos = HORAS_DIA.map((h) => pct(hReal[h] && hReal[h].gamma ? hReal[h].gamma[u] : null));
        if (datos.some((v) => v != null)) s.push({ nombre: `U${u + 1} real (estimada)`, datos: ext(datos), indice: u, ancho: 1.8, escalones: true });
      }
    }
    s.push({ nombre: `Programa simulado (cada unidad en línea)`, datos: ext(det.map((d) => (d.qTurbinado > 0 ? pct(d.gamma) : null))), color: T.ink, dash: true, ancho: 2.2, escalones: true });
    return { x, s, conReal: !!hReal };
  })();
  const noAlcanzables = det.filter((d) => d.potenciaMW > 0 && !d.alcanzable && !d.enMinimoEnsayado);
  const bajoMinimo = det.filter((d) => d.enMinimoEnsayado);
  const reducidas = det.filter((d) => d.unidadesReducidas && !d.enMinimoEnsayado);
  const vacio = filas.every((f) => !(f.despacho > 0) && !(f.rt > 0)) && calc.modo !== "plano";
  const sobreDisponibles = filas.filter((f) => f.unidades != null && f.unidades > unidadesDisp);
  const fmt = (v, d = 1) => fx(v, d);
  const celda = { padding: "3px 6px", borderBottom: `1px solid ${T.lineSoft}`, whiteSpace: "nowrap" };
  const entradaCelda = { width: 72, padding: "3px 4px", fontSize: 12 };
  const colorEstado = { sin_dato_xm: T.inkMuted, sin_dato_rt: T.inkMuted, por_debajo: T.amber, dentro: T.teal, por_encima: T.amber };
  const colorRegla = { cumple: T.teal, por_encima: T.red, por_debajo: T.red, excepcion: T.amber, sin_base: T.inkMuted };
  const estadoReglaDe = (x) => (x ? estadoReglaOperativa(x.q, calc.regla.banda) : "sin_base");
  const csv = det.map((d, i) => ({
    hora: d.hora, despacho_xm_mw: filas[i].despacho, promedio_rt_mw: filas[i].rt, estado_hora: ETIQUETA_ESTADO_HORA[calc.estados[i]],
    programa_simulado: nombrePrograma(calc.modo, calc.progs), potencia_programa_mw: +d.potenciaMW.toFixed(2), unidades: d.unidades,
    p_bornes_unidad_mw: +d.pBornesUnidad.toFixed(2), p_eje_unidad_mw: +d.pEjeUnidad.toFixed(2), apertura_pct: +pctFromDeg(d.gamma).toFixed(2), apertura_grados: +d.gamma.toFixed(3),
    eta_pct: d.eta != null ? +d.eta.toFixed(2) : null, q_turbinado_modelo_m3s: +d.qTurbinado.toFixed(2),
    q_regulado_hidrometria_m3s: calc.regla.porHora[i].principal != null ? +calc.regla.porHora[i].principal.toFixed(2) : null, q_entrada_m3s: d.qEntrada,
    nivel_fin: +d.Hfin.toFixed(4), [`nivel_fin_xm_menos_${bandaPct}pct`]: calc.inf ? +calc.inf.serie[i + 1].nivel.toFixed(4) : null, [`nivel_fin_xm_mas_${bandaPct}pct`]: calc.sup ? +calc.sup.serie[i + 1].nivel.toFixed(4) : null,
    nivel_medido_inicio_hora: filas[i].nivelMedido,
  }));
  const resumen = { padding: "10px 12px", background: T.panelSoft, borderRadius: 8, fontSize: 12.5, fontFamily: FONT_BODY, color: T.inkMuted, lineHeight: 1.6 };

  return (
    <div>
      <ChartHeader titulo="Variación del nivel del embalse según despacho de potencia (intradiario)" subtitulo="Nivel del embalse hora a hora con el programa de XM, la banda operativa de la generación (despacho XM ± banda), la generación real (Promedio RT) y el caudal de entrada pronosticado." T={T}
        tip={`Cada hora: la potencia total (en bornes) se reparte en partes iguales entre las unidades de esa hora, se pasa al eje de la turbina con el rendimiento del generador (98,55-98,91 %, estudio de ampliación de GE, 2023), se busca en la colina la apertura que la entrega con el nivel al inicio de la hora y la condición de descarga elegida arriba, con el techo de ${etiquetaTecho} y ${P_MAXIMO_ESPERADO_MW} MW por unidad. El caudal turbinado y el caudal de entrada dan el cambio de volumen (curvas cota-volumen) y el nivel al final de la hora. No incluye vertimiento. Validado con la operación de enero a octubre de 2026: con las unidades reales y el caudal de entrada correcto, el error es de pocos centímetros por día; lo que más pesa es el caudal de entrada (unos 2,5 cm por día por cada 10 m³/s).`} />

      {vivo && vivo.resHoy && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "9px 12px", marginBottom: 12, borderRadius: 8, background: T.accentSoft, fontSize: 12.5, color: T.inkMuted }}>
          <b style={{ color: T.ink }}>Datos en vivo</b>
          <span>Caudal de entrada:</span>
          {opcionesEntrada.map((o) => (
            <button key={o.k} onClick={() => { setQEntrada(Math.round(o.q)); setFuenteEntrada(o.k); }} aria-pressed={fuenteEntrada === o.k} title={o.txt}
              style={{ padding: "3px 10px", borderRadius: 999, fontSize: 12, cursor: "pointer", border: `1px solid ${fuenteEntrada === o.k ? T.teal : T.line}`, background: fuenteEntrada === o.k ? T.panel : "transparent", color: fuenteEntrada === o.k ? T.teal : T.inkMuted }}>
              {o.k === "hf" ? "HydroForecast" : o.k === "hoy" ? "Balance hoy" : "Balance ayer"} {fx(o.q, 0)}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <button onClick={() => llenarConVivo(vivo, fuenteEntrada)} style={{ padding: "4px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: `1px solid ${T.teal}`, background: "transparent", color: T.teal, fontWeight: 600 }}>Volver a llenar con datos en vivo</button>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14, marginBottom: 12 }}>
        <div>
          <Etiqueta T={T} tip="Día del despacho. Define qué factor de conversión de Hidrometría aplica en la columna Q Hidrometría (1,62 hasta el 29-oct-2026 14:35; desde entonces depende del nivel). Se toma del texto pegado si lo trae.">Fecha del despacho</Etiqueta>
          <input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} className="itu-num-input" />
        </div>
        <div>
          <Etiqueta T={T} tip="Nivel del embalse a las 00:00 (inicio de la hora 0).">Nivel embalse inicial (msnm)</Etiqueta>
          <InputNumeroLibre step={0.01} min={NIVEL_MIN_TEC} max={NAME} value={nivelInicial} onChange={(n) => setNivelInicial(Math.max(NIVEL_MIN_TEC, Math.min(NAME, n)))} className="itu-num-input" />
        </div>
        <div>
          <Etiqueta T={T} tip="Caudal de entrada al embalse pronosticado para el día (m³/s). Se usa en todas las horas que no tengan un valor propio en la columna 'Q entrada' de la tabla. Es la entrada que más pesa en el resultado: 10 m³/s durante 24 h cambian el nivel unos 2,5 cm.">Caudal de entrada pronosticado (m³/s)</Etiqueta>
          <InputNumeroLibre step={1} min={0} value={qEntrada} onChange={(n) => setQEntrada(Math.max(0, n))} className="itu-num-input" />
        </div>
        <div>
          <Etiqueta T={T} tip="Incertidumbre del pronóstico de caudal de entrada, para las curvas punteadas. 75 m³/s: entre julio y octubre de 2026, en 1 de cada 10 días el caudal de entrada cambió 75 m³/s o más frente al día anterior (balance de masa con los datos de Hidrometría).">Sensibilidad caudal ± (m³/s)</Etiqueta>
          <InputNumeroLibre step={5} min={0} value={sensQ} onChange={(n) => setSensQ(Math.max(0, n))} className="itu-num-input" />
        </div>
        <div>
          <Etiqueta T={T} tip="Banda operativa de la generación, alrededor del despacho de XM (por defecto ±5 %): el Promedio RT de cada hora debe quedar entre XM × (1 − banda) y XM × (1 + banda). Con ella se marca el estado de cada hora, se dibuja la franja en el gráfico de potencia y se calcula el rango de nivel a las 24 h. Siempre se aplica al despacho de XM, no al programa simulado.">Banda RT vs XM ± (%)</Etiqueta>
          <InputNumeroLibre step={0.5} min={0} max={50} value={bandaPct} onChange={(n) => setBandaPct(Math.max(0, Math.min(50, n)))} className="itu-num-input" />
        </div>
        <div>
          <Etiqueta T={T} tip="Promedio diario del caudal regulado de AYER según Hidrometría (Q_regulado = potencia / F.C. + descarga intermedia, que se toma 0). Con él se calcula la banda de la regla operativa de hoy (±4,70 %, Res. ANLA 1891) y el programa plano. En la app de Hidrometría aparece como 'Promedio ayer'.">Q regulado promedio de ayer (m³/s)</Etiqueta>
          <InputOpcional step={0.1} value={qAyer} placeholder="p. ej. 500" onChange={(v) => setQAyer(v != null && v > 0 ? v : null)} style={{ width: "100%" }} />
        </div>
        <div>
          <Etiqueta T={T} tip="Con qué potencia se simula el nivel. Despacho XM: el programa de XM (una hora sin dato repite la anterior). Promedio RT: lo generado donde ya hay dato y XM en el resto. Plano por regla operativa: caudal regulado constante igual al promedio de ayer, que es como opera hoy Ituango por la Res. 1891.">Programa para el nivel</Etiqueta>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {[["xm", "XM"], ["rt", "RT"], ["plano", "Plano"]].map(([v, l]) => {
              const disponible = !!calc.progs[v];
              return (
                <button key={v} onClick={() => disponible && setPrograma(v)} disabled={!disponible} title={disponible ? "" : v === "xm" ? "Falta pegar el despacho de XM" : v === "rt" ? "Falta el despacho de XM para las horas sin RT" : "Falta el Q regulado promedio de ayer"} style={{
                  flex: "1 1 40px", padding: "7px 4px", fontSize: 12, fontFamily: FONT_BODY, fontWeight: 600, opacity: disponible ? 1 : 0.5,
                  border: `1px solid ${calc.modo === v ? T.teal : T.line}`, borderRadius: 4, cursor: disponible ? "pointer" : "not-allowed",
                  background: calc.modo === v ? T.panelSoft : "transparent", color: calc.modo === v ? T.teal : T.inkMuted,
                }}>{l}</button>
              );
            })}
          </div>
        </div>
        <div>
          <Etiqueta T={T} tip="Unidades disponibles hoy. Las horas sin número de unidades propio usan el mínimo que entrega la potencia sin pasar de 307 MW por unidad, sin superar este número.">Unidades disponibles</Etiqueta>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {Array.from({ length: N_TURBINAS_MAX }, (_, i) => i + 1).map((n) => (
              <button key={n} onClick={() => setUnidadesDisp(n)} style={{
                flex: "1 1 26px", padding: "7px 3px", fontSize: 12, fontFamily: FONT_BODY, fontWeight: 600,
                border: `1px solid ${unidadesDisp === n ? T.teal : T.line}`, borderRadius: 4, cursor: "pointer",
                background: unidadesDisp === n ? T.panelSoft : "transparent", color: unidadesDisp === n ? T.teal : T.inkMuted,
              }}>{n}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <Etiqueta T={T} tip="Copia la tabla 'Resumen horario' (despacho XM, bandas, Promedio RT…) y pégala aquí. Las horas 'Sin dato RT' quedan solo con el despacho. También sirven dos o tres columnas: hora, despacho, Promedio RT.">Pegar resumen horario de XM</Etiqueta>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={4}
          placeholder={"00:00 - 00:59\t700.0 MW\t665.0 MW\t735.0 MW\t690.9 MW ..."}
          style={{ width: "100%", boxSizing: "border-box", fontFamily: "ui-monospace, monospace", fontSize: 11.5, padding: 8, borderRadius: 6, border: `1px solid ${T.line}`, background: T.panel, color: T.ink, resize: "vertical" }} />
        <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
          <button onClick={cargarTabla} style={{ padding: "7px 14px", background: T.teal, color: T.onAccent, border: "none", borderRadius: 6, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Cargar tabla</button>
          <button onClick={() => { setFilas(HORAS_DIA.map(filaDespachoVacia)); setMsgCarga(null); }} style={{ padding: "7px 14px", background: "transparent", color: T.inkMuted, border: `1px solid ${T.line}`, borderRadius: 6, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Vaciar la tabla</button>
        </div>
        {msgCarga && (
          <div style={{ marginTop: 6, fontSize: 12, fontFamily: FONT_BODY, color: msgCarga.ok ? T.inkMuted : T.amber }}>
            {msgCarga.txt}{msgCarga.avisos && msgCarga.avisos.length > 0 && <span style={{ color: T.amber }}> ⚠ {msgCarga.avisos.join("; ")}</span>}
          </div>
        )}
      </div>

      {vacio && <div style={{ ...resumen, marginBottom: 12, color: T.ink }}>Pegue el resumen horario de XM (o escriba el despacho en la tabla), o use el programa plano con el Q regulado de ayer. Sin potencia, el nivel solo refleja el caudal de entrada.</div>}
      <div style={{ ...resumen, marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.teal }}>
          Nivel a las 24 h ({nombrePrograma(calc.modo, calc.progs)}): {fx(calc.principal.Hfinal, 3)} msnm ({calc.principal.deltaH >= 0 ? "+" : ""}{fx(calc.principal.deltaH * 100, 1)} cm)
        </div>
        <div>{calc.inf ? <>Banda operativa de la generación (despacho XM ±{bandaPct} %): {fx(calc.sup.Hfinal, 3)} a {fx(calc.inf.Hfinal, 3)} msnm</> : <>Banda operativa de la generación: pegue el despacho de XM (se define como XM ±{bandaPct} %)</>} · caudal de entrada ±{sensQ} m³/s: {fx(calc.qMenos.Hfinal, 3)} a {fx(calc.qMas.Hfinal, 3)} msnm
          {Object.entries(calc.comparar).map(([k, v]) => <span key={k}> · {nombrePrograma(k, calc.progs)}: {fx(v.Hfinal, 3)} msnm</span>)}</div>
        <div>Caudal turbinado medio (modelo): {fx(calc.principal.qTurbMedio, 1)} m³/s frente a {fx(qEntrada, 0)} m³/s de entrada pronosticada{calc.prog.rellenadas.length > 0 && <> · horas sin dato propio (se repite la anterior): {calc.prog.rellenadas.join(", ")}</>}.</div>
        <div>
          <b style={{ color: T.ink }}>Energía RT vs despacho XM</b> (banda ±{bandaPct} %): XM {fx(calc.energia.xm, 0)} MWh en {calc.energia.hXM} h con dato · RT {fx(calc.energia.rt, 0)} MWh en {calc.energia.hRT} h
          {calc.energia.hComun > 0 && <> · en las {calc.energia.hComun} h con ambos: {fx(calc.energia.rtComun, 0)} frente a {fx(calc.energia.xmComun, 0)} MWh ({calc.energia.difComunPct >= 0 ? "+" : ""}{fx(calc.energia.difComunPct, 1)} %)</>}.
          {" "}{["por_debajo", "dentro", "por_encima", "sin_dato_xm"].map((k) => { const n = calc.estados.filter((x) => x === k).length; return n ? `${ETIQUETA_ESTADO_HORA[k]}: ${n} h. ` : ""; })}
        </div>
        {calc.regla.banda ? (
          <div>
            <b style={{ color: T.ink }}>Regla operativa (Res. 1891):</b> banda de hoy {fx(calc.regla.banda.min, 1)} a {fx(calc.regla.banda.max, 1)} m³/s (promedio de ayer {fx(qAyer, 1)} ± 4,70 %; con el F.C. de las 00:00, {fx(calc.regla.banda.min * fcInicio, 0)} a {fx(calc.regla.banda.max * fcInicio, 0)} MW).
            {[["xm", "Despacho XM"], ["rt", "Promedio RT hasta ahora"], ["principal", `Programa simulado (${nombrePrograma(calc.modo, calc.progs)})`]].map(([k, l]) => {
              const x = calc.regla[k]; if (!x) return null;
              const est = estadoReglaDe(x);
              return <div key={k}>· {l}: promedio {fx(x.q, 1)} m³/s en {x.horas} h → <b style={{ color: colorRegla[est] }}>{ETIQUETA_ESTADO_REGLA[est]}</b></div>;
            })}
            <div style={{ fontSize: 11.5, color: T.inkFaint }}>El cumplimiento se define con el promedio regulado final del día; lo horario es seguimiento. Con vertimiento la validación se suspende.</div>
          </div>
        ) : <div style={{ fontSize: 11.5, color: T.inkFaint }}>Escriba el Q regulado promedio de ayer para ver la regla operativa (Res. 1891) y el programa plano.</div>}
        {calc.errMedido.length > 0 && <div>Frente al nivel medido ({calc.errMedido.length} h): diferencia máxima {fx(Math.max(...calc.errMedido.map(Math.abs)) * 100, 1)} cm.</div>}
        <div style={{ fontSize: 11.5, color: T.inkFaint }}>Almenara: {etiquetaCondicionDescarga(condDescarga)} (panel Condición de descarga; el caudal del río en D4' incluye lo turbinado). F.C. de Hidrometría a {fx(nivelInicial, 2)} msnm: {fx(fcInicio, 3)}.</div>
        {noAlcanzables.length > 0 && <div style={{ color: T.amber, fontWeight: 600 }}>⚠ Horas {noAlcanzables.map((d) => d.hora).join(", ")}: la potencia no se alcanza con esas unidades, el techo de apertura {etiquetaTecho} (se elige en "Rango de apertura" del Buscador) y {P_MAXIMO_ESPERADO_MW} MW por unidad. Aumenta las unidades de esa hora o revisa el techo; el nivel se calcula con la potencia máxima alcanzable.</div>}
        {reducidas.length > 0 && <div style={{ color: T.amber, fontWeight: 600 }}>⚠ Horas {reducidas.map((d) => `${d.hora} (${d.unidadesPedidas}→${d.unidades} ud.)`).join(", ")}: con las unidades pedidas, cada una quedaría por debajo de la apertura mínima ensayada ({fx(pctFromDeg(GAMMAS_HILL[0]), 1)} % = {fx(GAMMAS_HILL[0], 2)}°); se calculó con la cantidad de unidades que turbina menos agua.</div>}
        {bajoMinimo.length > 0 && <div style={{ color: T.amber, fontWeight: 600 }}>⚠ Horas {bajoMinimo.map((d) => d.hora).join(", ")}: la potencia es menor que la de una unidad en la apertura mínima ensayada ({fx(pctFromDeg(GAMMAS_HILL[0]), 1)} % = {fx(GAMMAS_HILL[0], 2)}°); se tomó el caudal de esa apertura mínima con una unidad.</div>}
        {sobreDisponibles.length > 0 && <div style={{ color: T.amber, fontWeight: 600 }}>⚠ Horas {sobreDisponibles.map((f) => f.hora).join(", ")}: más unidades que las disponibles ({unidadesDisp}).</div>}
      </div>

      {calc.regla.banda && (
        <>
          <ChartHeader titulo="Banda operacional del día (Res. 1891)" T={T}
            subtitulo={`Caudal regulado y total descargado frente a la banda (promedio de ayer ${fx(qAyer, 1)} m³/s ± 4,70 %). La regla se cumple si el promedio acumulado al final del día queda dentro; la franja de abajo muestra cuándo estuvo dentro o fuera${bandaDia.corte < 24 ? " y, tenue, la proyección con el programa" : ""}.`} />
          <GraficoSeries T={T} tipoX="numero" ejeX="Hora" x={bandaDia.x} series={bandaDia.series} unidad="m³/s" ejeY="m³/s" decimales={1} alto={290} grupo="desp" nombreArchivo={`banda_1891_${fecha}`}
            bandas={[{ desde: 0, hasta: 1, relleno: "rgba(12,163,12,0.10)" }]} tramos={bandaDia.tramos} leyendaTramos={bandaDia.leyenda}
            verticales={bandaDia.corte > 0 && bandaDia.corte < 24 ? [{ x: bandaDia.corte, rotulo: "último dato" }] : []} />
          <div className="itu-kpis" style={{ margin: "4px 0 18px" }}>
            <div style={{ ...resumen, padding: "8px 12px" }}><b style={{ color: T.ink }}>Cierre proyectado:</b> {fx(bandaDia.cierre, 1)} m³/s → <b style={{ color: colorRegla[estadoReglaOperativa(bandaDia.cierre, bandaDia.banda)] }}>{ETIQUETA_ESTADO_REGLA[estadoReglaOperativa(bandaDia.cierre, bandaDia.banda)]}</b></div>
            {bandaDia.minutosMedidos > 0 && <div style={{ ...resumen, padding: "8px 12px" }}><b style={{ color: T.ink }}>Caudal instantáneo dentro de la banda:</b> {fx(bandaDia.dentroInst / 60, 1)} h de {fx(bandaDia.minutosMedidos / 60, 1)} h medidas ({fx((100 * bandaDia.dentroInst) / bandaDia.minutosMedidos, 0)} %). Es seguimiento: la regla se juzga con el promedio del día.</div>}
          </div>
        </>
      )}

      <ChartHeader titulo="Potencia por hora: despacho, generación real y programa" T={T} subtitulo={`MW en bornes. Franja = banda operativa de la generación: despacho de XM ±${bandaPct} % (solo en las horas con dato de XM); el Promedio RT de cada hora debe quedar dentro. Las líneas punteadas grises son la banda de la regla 1891 expresada en MW con el F.C. de las 00:00.`} />
      <GraficoSeries T={T} tipoX="numero" ejeX="Hora" x={seriesPotencia.x} series={seriesPotencia.s} bandas={seriesPotencia.bandas} unidad="MW" ejeY="MW" decimales={0} alto={240} grupo="desp" nombreArchivo={`potencia_horaria_${fecha}`} />

      <ChartHeader titulo="Apertura del distribuidor por hora" T={T} subtitulo={seriesApertura.conReal ? "Programa simulado (todas las unidades en línea con la misma apertura) frente a la apertura estimada de cada unidad con su potencia medida en las horas ya transcurridas. En % y su equivalente en grados (eje derecho y tooltip)." : "Apertura de cada unidad en línea con el programa simulado (todas con la misma apertura). En % y su equivalente en grados (eje derecho y tooltip). Para la fecha de hoy se agrega la estimada de cada unidad con lo medido."} />
      <GraficoSeries T={T} tipoX="numero" ejeX="Hora" x={seriesApertura.x} series={seriesApertura.s} unidad="%" ejeY="apertura (%)" decimales={1} alto={240} grupo="desp" nombreArchivo={`apertura_horaria_${fecha}`} referencias={referenciasApertura(T)} equivalente={EQUIV_APERTURA} />
      <p style={{ fontSize: 11.5, color: T.inkFaint, margin: "-6px 0 14px", lineHeight: 1.5, fontFamily: FONT_BODY }}>{NOTA_APERTURA} El techo del programa es el elegido en "Rango de apertura" ({etiquetaTecho}).</p>

      <ChartHeader titulo="Nivel del embalse — evolución intradiaria" T={T} accion={<BotonCSV data={csv} filename="despacho_intradiario.csv" T={T} />} />
      <GraficoSeries T={T} tipoX="numero" ejeX="Hora" grupo="desp" x={seriesNivel.x} series={seriesNivel.s} unidad="msnm" ejeY="msnm" decimales={3} alto={300} nombreArchivo="despacho_nivel" bandas={[{ desde: 0, hasta: 1, relleno: "rgba(148,163,184,0.10)" }, { desde: 2, hasta: 3 }]} />

      <div style={{ marginTop: 14, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: FONT_BODY, color: T.ink }}>
          <thead>
            <tr style={{ color: T.inkFaint, textAlign: "left" }}>
              {["Hora", "Despacho XM (MW)", `Banda XM ±${bandaPct} % (MW)`, "Promedio RT (MW)", "Desv.", "Estado", "Programa (MW)", "Unidades", "MW/unidad", "Apertura", "η (%)", "Q turbinado (modelo)", "Q regulado (Hidrometría)", "Q entrada", "Nivel fin", "Nivel medido (hh:00)"].map((h) => (
                <th key={h} style={{ ...celda, borderBottom: `1px solid ${T.line}`, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {det.map((d, i) => {
              const f = filas[i];
              const lo = f.despacho != null ? f.despacho * (1 - bandaPct / 100) : null, hi = f.despacho != null ? f.despacho * (1 + bandaPct / 100) : null;
              const est = calc.estados[i];
              const fuera = est === "por_debajo" || est === "por_encima";
              const auto = unidadesMinimasParaPotencia(d.potenciaMW, unidadesDisp);
              const qr = calc.regla.porHora[i].principal;
              const fueraRegla = calc.regla.banda && qr != null && (qr < calc.regla.banda.min - 1e-9 || qr > calc.regla.banda.max + 1e-9);
              const alerta = (d.potenciaMW > 0 && !d.alcanzable) || (f.unidades != null && f.unidades > unidadesDisp);
              return (
                <tr key={i}>
                  <td style={celda}>{String(i).padStart(2, "0")}:00</td>
                  <td style={celda}><InputOpcional step={10} value={f.despacho} placeholder="sin dato" onChange={(v) => editar(i, "despacho", v == null ? null : Math.max(0, v))} style={entradaCelda} /></td>
                  <td style={{ ...celda, color: T.inkMuted }}>{lo != null ? `${fx(lo, 1)}-${fx(hi, 1)}` : "—"}</td>
                  <td style={celda}><InputOpcional step={1} value={f.rt} placeholder="—" onChange={(v) => editar(i, "rt", v == null ? null : Math.max(0, v))} style={entradaCelda} /></td>
                  <td style={{ ...celda, color: fuera ? T.amber : T.inkMuted, fontWeight: fuera ? 700 : 400 }}>{f.rt != null && f.despacho > 0 ? `${f.rt >= f.despacho ? "+" : ""}${fx((f.rt / f.despacho - 1) * 100, 1)} %` : ""}</td>
                  <td style={{ ...celda, color: colorEstado[est], fontWeight: 600 }}>{ETIQUETA_ESTADO_HORA[est]}</td>
                  <td style={{ ...celda, color: calc.prog.rellenadas.includes(i) ? T.amber : T.ink }}>{fmt(d.potenciaMW, 1)}{calc.prog.rellenadas.includes(i) ? " *" : ""}</td>
                  <td style={celda}><InputOpcional step={1} value={f.unidades} placeholder={String(auto)} onChange={(v) => editar(i, "unidades", v == null ? null : Math.max(0, Math.min(N_TURBINAS_MAX, Math.round(v))))} style={{ ...entradaCelda, width: 52 }} /></td>
                  <td style={celda}>{d.unidades > 0 ? fmt(d.pBornesUnidad) : "—"}</td>
                  <td style={celda}>{d.qTurbinado > 0 ? `${fx(pctFromDeg(d.gamma), 1)} % (${fx(d.gamma, 2)}°)` : "—"}</td>
                  <td style={celda}>{fmt(d.eta, 2)}</td>
                  <td style={celda}>{fmt(d.qTurbinado)}</td>
                  <td style={{ ...celda, color: fueraRegla ? T.red : T.inkMuted, fontWeight: fueraRegla ? 700 : 400 }}>{qr != null && d.potenciaMW > 0 ? fmt(qr) : "—"}</td>
                  <td style={celda}><InputOpcional step={1} value={f.qEntrada} placeholder={String(qEntrada)} onChange={(v) => editar(i, "qEntrada", v == null ? null : Math.max(0, v))} style={entradaCelda} /></td>
                  <td style={{ ...celda, fontWeight: 600 }}>{fx(d.Hfin, 3)}</td>
                  <td style={celda}><InputOpcional step={0.01} value={f.nivelMedido} placeholder="—" onChange={(v) => editar(i, "nivelMedido", v)} style={{ ...entradaCelda, width: 84 }} /></td>
                  {alerta && <td style={{ ...celda, color: T.amber, fontWeight: 700 }}>†</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ fontSize: 11.5, color: T.inkFaint, fontFamily: FONT_BODY, marginTop: 6, lineHeight: 1.5 }}>
          Despacho, Promedio RT, Programa y MW/unidad: potencia en bornes. Estado: comparación del Promedio RT con el despacho de XM ± banda, como en la app de Hidrometría; "Sin dato XM" no se evalúa ni se toma como cero. Programa: potencia con que se simula el nivel (* = hora sin dato propio, repite la anterior). Unidades vacías = mínimo que entrega la potencia (número en gris). Q turbinado: caudal del modelo de la colina. Q regulado: potencia / F.C. de Hidrometría con el nivel al inicio de la hora (1,62 hasta el 29-oct-2026 14:35; desde entonces 0,0119·nivel − 3,178 entre 390 y 420 msnm, y 1,80 sin nivel válido); en rojo, fuera de la banda de la regla operativa. † hora que no se puede cumplir o con más unidades que las disponibles.
        </div>
      </div>
    </div>
  );
}

function ColinaModulo({ T, tab, condDescarga, setCondDescarga }) {
  const [gamma, setGamma] = useState(21.5);
  /* Nivel del embalse es la fuente de verdad; Salto neto (H) se deriva
     automáticamente de él (según γ y las unidades activas, usando el
     mismo modelo de almenara + pérdida de carga ya validado). Si el
     usuario edita el Salto neto directamente, se retro-calcula el
     Nivel del embalse equivalente — así ambos campos siempre quedan
     acoplados y consistentes, sin importar cuál se edite. */
  const [nivelEmbalseExploracion, setNivelEmbalseExploracion] = useState(407.31);
  const [permitirSobreNAMO, setPermitirSobreNAMO] = useState(false);
  const [nTurbActivasExploracion, setNTurbActivasExploracion] = useState(1);
  const [Hsel, setHsel] = useState(197.3);
  const [avisoNivelExploracion, setAvisoNivelExploracion] = useState(null);
  /* Condición de descarga (nivel de la almenara) — compartida por TODO el
     módulo: exploración, Buscador, despacho intradiario y diagramas. Por
     defecto, la condición ACTUAL del río colmatado (ASE 2026) con
     Q río = 400 m³/s (caudales bajos de 2026); cada almenara toma su nivel de su propia tabla. */
  // condDescarga / setCondDescarga vienen del componente principal (se muestran en la cabecera)

  useEffect(() => {
    const r = evaluarTurbinaUnidad(nivelEmbalseExploracion, gamma, nTurbActivasExploracion, condDescarga);
    if (r && Number.isFinite(r.saltoNeto)) { setHsel(r.saltoNeto); setAvisoNivelExploracion(null); }
    else setAvisoNivelExploracion("El nivel del embalse y la apertura actuales no producen un salto neto dentro del rango ensayado (109-336 m) — no se puede calcular Q/P/η con confianza.");
  }, [nivelEmbalseExploracion, gamma, nTurbActivasExploracion, condDescarga]);

  function alEditarNivelEmbalse(valorCrudo) {
    // Validación: el nivel del embalse del proyecto opera entre el nivel
    // mínimo técnico (390 msnm) y el NAME (432.5 msnm).
    const valor = Math.max(NIVEL_MIN_TEC, Math.min(NAME, valorCrudo));
    setNivelEmbalseExploracion(valor);
  }
  function alEditarSaltoNeto(valorCrudo) {
    // Retro-cálculo: dado el H neta deseado (y γ, unidades activas),
    // se resuelve qué nivel de embalse lo produce — invirtiendo la
    // misma ecuación de salto neto + pérdida de carga + almenara.
    const valor = Math.max(50, Math.min(340, valorCrudo)); // rango físico razonable del salto neto (cubre el dominio ensayado)
    const ev = evaluarHillChart(valor, gamma);
    if (ev) {
      const hLoss = K_PERDIDA_CARGA * ev.Q ** 2;
      // Mismo nivel de almenara que usa el cálculo directo (condición de
      // descarga elegida y caudal de la unidad a este salto neto).
      // Almenara promedio de las unidades activas (cada grupo en su almenara)
      const rep = unidadesPorAlmenara(nTurbActivasExploracion, condDescarga);
      const nRep = rep.norte + rep.sur;
      const almProm = nRep > 0
        ? ZONAS.reduce((acc, z) => acc + (rep[z] > 0 ? rep[z] * nivelAlmenaraSegunCondicion(condDescarga, z, rep[z], ev.Q).nivel : 0), 0) / nRep
        : nivelAlmenaraSegunCondicion(condDescarga, "norte", 0, ev.Q).nivel;
      const nivelCalc = valor + hLoss + almProm;
      alEditarNivelEmbalse(nivelCalc); // aplica el mismo rango válido de nivel del embalse
    } else {
      setHsel(valor); // fuera del rango ensayado: se muestra igual, pero sin nivel de embalse consistente
      setAvisoNivelExploracion("Este salto neto está fuera del rango cubierto por los 186 puntos ensayados — no se puede retro-calcular un nivel de embalse consistente.");
    }
  }

  /* Buscador de punto de máxima eficiencia — INDEPENDIENTE del simulador
     principal y de la exploración manual de arriba (Salto neto H). El
     caudal objetivo y el nivel del embalse aquí son valores que el
     usuario ingresa directamente, sin vincularse a ningún otro campo. */
  const [qObjetivoOptimo, setQObjetivoOptimo] = useState(600);
  /* Con datos en vivo: nivel actual del radar y, como caudal, el pronóstico de
     HydroForecast para hoy en Sitio Presa (si no hay, el balance de hoy). Una vez. */
  const { vivo } = useVivo() || {};
  const [vivoAplicadoColina, setVivoAplicadoColina] = useState(false);
  const caudalVivo = useMemo(() => {
    if (!vivo) return null;
    const pr = vivo.hf?.pronostico?.datos?.data;
    const h = pr && pr.find((x) => String(x.timestamp).slice(0, 10) === vivo.hoy);
    if (h && h.QSitioPresa_pred_mean != null) return { q: h.QSitioPresa_pred_mean, txt: "pronóstico HydroForecast de hoy en Sitio Presa" };
    if (vivo.resHoy && vivo.resHoy.balance.qEntrada != null) return { q: vivo.resHoy.balance.qEntrada, txt: "balance de masa de hoy" };
    return null;
  }, [vivo]);
  function aplicarVivoColina() {
    if (vivo && vivo.actual && vivo.actual.nivel != null) setNivelEmbalseExploracion(+vivo.actual.nivel.toFixed(2));
    if (caudalVivo) setQObjetivoOptimo(Math.round(caudalVivo.q));
  }
  useEffect(() => {
    if (!vivoAplicadoColina && vivo && vivo.actual && vivo.actual.nivel != null) { aplicarVivoColina(); setVivoAplicadoColina(true); }
  }, [vivo]); // eslint-disable-line react-hooks/exhaustive-deps
  /* Default "normal" (97% = margen de 3% reservado para respuesta a
     frecuencia, pedido por el ingeniero de operaciones) — antes el
     default era "original" (26.5°). "Ampliado" (100%) sigue disponible
     para cuando se necesite usar deliberadamente la reserva. */
  const [rangoOptimo, setRangoOptimo] = useState("normal");
  const [unidadesDisponiblesOptimo, setUnidadesDisponiblesOptimo] = useState(UNIDADES_DISPONIBLES_HOY);
  const [resultadoOptimo, setResultadoOptimo] = useState(null);
  // Un resultado calculado con otra condición de descarga ya no es válido.
  useEffect(() => { setResultadoOptimo(null); }, [condDescarga]);
  /* Ajuste de caudal del embalse: positivo = caudal adicional que se toma
     del volumen almacenado (el nivel baja un poco) para poder turbinar
     más que lo que entra en el instante y así operar más cerca del punto
     de máxima eficiencia; negativo = caudal que se guarda en el embalse
     (el nivel sube un poco), turbinando menos que la entrada.
     CORREGIDO (antes se aplicaba implícitamente): ahora es un interruptor
     ON/OFF explícito (considerarAjusteEmbalse), por defecto APAGADO. Con
     el interruptor apagado, TODA la lógica del buscador (incluidos
     "Maximizar eficiencia" y "Maximizar potencia", que antes tomaban agua
     del embalse en silencio) se limita ESTRICTAMENTE a lo que las
     unidades pueden generar con el caudal de entrada ingresado — nunca
     toma ni guarda agua del embalse, ni aunque el campo tenga un valor
     distinto de 0 guardado. Con el interruptor encendido, si el punto
     buscado requiere más agua de la que entra, se toma del embalse y se
     indica explícitamente cuánto ("considerando el ajuste de caudal se
     lograrían..."), nunca de forma implícita. */
  const [considerarAjusteEmbalse, setConsiderarAjusteEmbalse] = useState(false);
  const [ajusteEmbalse, setAjusteEmbalse] = useState(0);
  const totalDisponibleOptimo = qObjetivoOptimo + (considerarAjusteEmbalse ? ajusteEmbalse : 0);

  /* % OPERATIVO POR UNIDAD (corregido según dato real de Hidrometría EPM:
     nivel 408.21 m, U2 al 71.7%, U4 al 60.1%, U1/U3 inoperativas — la
     suma NO da 100% y no tiene por qué). Cada unidad tiene un % propio e
     INDEPENDIENTE de las demás: % = potencia objetivo de esa unidad /
     300 MW (POTENCIA_BASE_PCT_MW, verificado arriba). 0% = unidad
     inoperativa (detenida). Un interruptor explícito
     (usarPesosPersonalizados) activa este modo — mientras esté apagado,
     el comportamiento de siempre (búsqueda automática de n, reparto
     equitativo) no cambia en nada. */
  const [usarPesosPersonalizados, setUsarPesosPersonalizados] = useState(false);
  const [pesosUnidades, setPesosUnidades] = useState({});
  useEffect(() => {
    setPesosUnidades((prev) => {
      const next = {};
      for (let i = 0; i < unidadesDisponiblesOptimo; i++) {
        next[i] = typeof prev[i] === "number" ? prev[i] : 70;
      }
      return next;
    });
  }, [unidadesDisponiblesOptimo]);
  function editarPesoUnidad(i, valor) {
    setPesosUnidades((prev) => ({ ...prev, [i]: Math.max(0, Math.min(100, valor)) }));
  }
  const porcentajesPorUnidad = useMemo(
    () => Array.from({ length: unidadesDisponiblesOptimo }, (_, i) => Math.max(0, pesosUnidades[i] ?? 70)),
    [pesosUnidades, unidadesDisponiblesOptimo]
  );
  /* SOLO para la ATRIBUCIÓN informativa en "Maximizar eficiencia" y
     "Maximizar potencia" (donde, por definición, TODAS las unidades
     operan en el mismo punto físico — no tiene sentido darles % de
     dispatch independientes ahí): normaliza los % independientes a
     fracciones que suman 1, únicamente para repartir el total ya
     calculado entre unidades a efectos de planeación (de entrada / de
     embalse). Esto NO es el reparto físico real (eso lo maneja
     resolverPorUnidadConPorcentajes sin normalizar) — es solo cómo se
     le atribuye a cada unidad su parte de un total compartido. */
  const pesosFraccionActivos = useMemo(() => {
    const valores = porcentajesPorUnidad;
    const suma = valores.reduce((s, v) => s + v, 0);
    const n = valores.length;
    if (suma <= 0) return Array(n).fill(1 / n);
    return valores.map((v) => v / suma);
  }, [porcentajesPorUnidad]);
  function pesosFraccionPara(nUsadas) {
    const valores = pesosFraccionActivos.slice(0, nUsadas);
    const suma = valores.reduce((s, v) => s + v, 0);
    if (suma <= 0) return Array(nUsadas).fill(1 / nUsadas);
    return valores.map((v) => v / suma);
  }

  /* Con unidades en las dos almenaras (n > 4), agrega al resultado el
     detalle por almenara: misma apertura, mismo nivel de embalse y misma
     condición con que se calculó, así que es el mismo punto desglosado. */
  function guardarResultadoOptimo(r) {
    if (r && r.mejor && r.mejor.gamma != null && !r.mejor.porAlmenara) {
      const ev = evaluarTurbinaUnidad(nivelEmbalseExploracion, r.mejor.gamma, r.mejor.n, condDescarga);
      if (ev && ev.dosAlmenaras) r = { ...r, mejor: { ...r.mejor, porAlmenara: ev.porAlmenara, unidadesPorAlmenara: unidadesPorAlmenara(r.mejor.n, condDescarga) } };
    }
    setResultadoOptimo(r);
  }

  function buscarOptimo() {
    const gammaMaxMecanico = gammaMecanicoDeRango(rangoOptimo);
    const porcentajes = usarPesosPersonalizados ? porcentajesPorUnidad : null;
    const r = buscarPuntoOptimo(totalDisponibleOptimo, nivelEmbalseExploracion, unidadesDisponiblesOptimo, gammaMaxMecanico, porcentajes, condDescarga);
    guardarResultadoOptimo(r);
    // Ya NO se traslada el resultado a "Apertura del distribuidor (γ)" de
    // la exploración manual — son módulos independientes a propósito.
  }

  /* "Maximizar eficiencia": busca, entre 1 y las unidades disponibles, la
     combinación que da la MAYOR eficiencia posible (respetando el techo
     mecánico de 30.2° y el de potencia de 307 MW).
     CORREGIDO: antes ignoraba SIEMPRE el caudal de entrada como techo y
     tomaba agua del embalse en silencio para llegar al pico ideal. Ahora
     respeta el interruptor "considerarAjusteEmbalse":
       - Apagado (default): el pico de cada n se topa estrictamente al
         caudal de entrada disponible (qObjetivoOptimo/n por unidad) — si
         el pico ideal de esa n necesita más agua de la que entra, se
         evalúa el mejor punto ALCANZABLE con esa agua, no el pico ideal.
         Se elige la n con mayor eficiencia ENTRE LAS ALCANZABLES con el
         caudal de entrada. El embalse queda en 0, siempre.
       - Encendido: igual que el comportamiento original — ignora el
         caudal de entrada como techo, calcula el pico ideal, y aplica el
         ajuste de embalse necesario para lograrlo (mostrado explícito). */
  function maximizarEficiencia() {
    const gammaMaxMecanico = gammaMecanicoDeRango(rangoOptimo);
    let mejor = null;
    for (let n = 1; n <= unidadesDisponiblesOptimo; n++) {
      const pico = picoEficiencia(nivelEmbalseExploracion, n, gammaMaxMecanico, P_MAXIMO_ESPERADO_MW, condDescarga);
      if (!pico.resultado) continue;
      const totalIdeal = pico.resultado.Q * n;
      const excedeEntrada = totalIdeal > qObjetivoOptimo + 1e-6;
      let gamma = pico.gamma, resultado = pico.resultado, limitadoPorPotencia = pico.limitadoPorPotencia, limitadoPorAgua = false;
      const necesitariaEmbalse = excedeEntrada ? Math.max(0, Math.round((totalIdeal - qObjetivoOptimo) * 100) / 100) : 0;
      if (excedeEntrada && !considerarAjusteEmbalse) {
        const rLim = resolverGammaParaCaudal(nivelEmbalseExploracion, qObjetivoOptimo / n, n, gammaMaxMecanico, condDescarga);
        // con tan poca agua por unidad quedaría bajo la apertura mínima ensayada: esa n no es viable
        if (!rLim.resultado || rLim.debajoDelMinimoEnsayado) continue;
        gamma = rLim.gamma; resultado = rLim.resultado; limitadoPorPotencia = false; limitadoPorAgua = true;
      }
      // La eficiencia pico varía apenas centésimas de % entre distintos n
      // (por el nivel de almenara, que cambia levemente con el número de
      // unidades) — una diferencia así no es real, es ruido del modelo.
      // Por eso, ante una diferencia menor a 0.05 puntos porcentuales, se
      // prefiere el n MAYOR (reparte la carga entre más unidades), en vez
      // de aferrarse a la diferencia insignificante.
      const actual = { n, gamma, eta: resultado.eta, P: resultado.P, Q: resultado.Q, saltoNeto: resultado.saltoNeto, limitadoPorPotencia, limitadoPorAgua, necesitariaEmbalse, etaIdeal: pico.resultado.eta };
      if (!mejor) { mejor = actual; continue; }
      const diff = actual.eta - mejor.eta;
      if (diff > 0.05 || (diff > -0.05 && n > mejor.n)) mejor = actual;
    }
    if (!mejor) return;
    const totalNecesario = mejor.Q * mejor.n;
    const ajuste = considerarAjusteEmbalse ? Math.max(0, Math.round((totalNecesario - qObjetivoOptimo) * 100) / 100) : 0;
    setAjusteEmbalse(ajuste);
    guardarResultadoOptimo({
      mejor: {
        n: mejor.n, gamma: mejor.gamma, qPorUnidad: mejor.Q, eta: mejor.eta, P: mejor.P, Q: mejor.Q, saltoNeto: mejor.saltoNeto,
        alcanzable: true, limitadoPorPotencia: mejor.limitadoPorPotencia, aguaLimitada: mejor.limitadoPorAgua,
        Qtotal_turbinado: totalNecesario, Ptotal: mejor.P * mejor.n,
        // Todas las unidades participantes operan en el MISMO punto físico
        // (mismo γ/Q/η — igual que siempre); el % por unidad aquí solo
        // atribuye, para planeación, cuánto de "entrada" vs "embalse" le
        // corresponde a cada una — no cambia su operación real.
        porUnidadAtribucion: usarPesosPersonalizados ? pesosFraccionPara(mejor.n).map((peso, i) => ({
          unidad: i + 1, peso, Q: mejor.Q, gamma: mejor.gamma, eta: mejor.eta,
          deEntrada: qObjetivoOptimo * peso, deEmbalse: ajuste * peso,
        })) : null,
      },
      todas: [],
      esMaximizacion: true,
      considerarAjusteEmbalse,
      necesitariaEmbalseParaIdeal: !considerarAjusteEmbalse && mejor.limitadoPorAgua ? mejor.necesitariaEmbalse : 0,
      etaIdealSinAgua: !considerarAjusteEmbalse && mejor.limitadoPorAgua ? mejor.etaIdeal : null,
    });
  }

  /* "Maximizar potencia": empuja la apertura hasta el techo de potencia
     máxima garantizada (307 MW), o hasta el techo mecánico del rango
     elegido si ese se alcanza antes. Validado contra 3 crecientes reales
     con agua de sobra (abril 2025, mayo 2026).
     CORREGIDO: misma lógica de interruptor que "Maximizar eficiencia" —
     apagado (default) topa cada n al caudal de entrada disponible y
     elige la n con mayor potencia total ALCANZABLE con esa agua (el
     embalse queda en 0, siempre); encendido, mantiene el comportamiento
     original (empuja al techo ideal y aplica el ajuste de embalse
     necesario, mostrado explícito). */
  function maximizarPotencia() {
    const gammaMaxMecanico = gammaMecanicoDeRango(rangoOptimo);
    let mejor = null;
    for (let n = 1; n <= unidadesDisponiblesOptimo; n++) {
      const r = resolverGammaConLimitePotencia(nivelEmbalseExploracion, 1e6, n, gammaMaxMecanico, P_MAXIMO_ESPERADO_MW, condDescarga);
      if (!r.resultado) continue;
      const totalIdeal = r.resultado.Q * n;
      const excedeEntrada = totalIdeal > qObjetivoOptimo + 1e-6;
      let gamma = r.gamma, resultado = r.resultado, limitadoPorPotencia = r.limitadoPorPotencia, limitadoPorAgua = false;
      const necesitariaEmbalse = excedeEntrada ? Math.max(0, Math.round((totalIdeal - qObjetivoOptimo) * 100) / 100) : 0;
      if (excedeEntrada && !considerarAjusteEmbalse) {
        const rLim = resolverGammaParaCaudal(nivelEmbalseExploracion, qObjetivoOptimo / n, n, gammaMaxMecanico, condDescarga);
        if (!rLim.resultado || rLim.debajoDelMinimoEnsayado) continue;
        gamma = rLim.gamma; resultado = rLim.resultado; limitadoPorPotencia = false; limitadoPorAgua = true;
      }
      const actual = { n, gamma, eta: resultado.eta, P: resultado.P, Q: resultado.Q, saltoNeto: resultado.saltoNeto, limitadoPorPotencia, limitadoPorAgua, necesitariaEmbalse, PidealTotal: r.resultado.P * n };
      // Ante potencias totales prácticamente iguales (±1 MW), la de mayor
      // eficiencia: la misma energía con menos agua.
      if (!mejor) { mejor = actual; continue; }
      const diffTotal = actual.P * actual.n - mejor.P * mejor.n;
      if (diffTotal > 1 || (diffTotal > -1 && actual.eta > mejor.eta)) mejor = actual;
    }
    if (!mejor) return;
    const totalNecesario = mejor.Q * mejor.n;
    const ajuste = considerarAjusteEmbalse ? Math.max(0, Math.round((totalNecesario - qObjetivoOptimo) * 100) / 100) : 0;
    setAjusteEmbalse(ajuste);
    guardarResultadoOptimo({
      mejor: {
        n: mejor.n, gamma: mejor.gamma, qPorUnidad: mejor.Q, eta: mejor.eta, P: mejor.P, Q: mejor.Q, saltoNeto: mejor.saltoNeto,
        alcanzable: true, limitadoPorPotencia: mejor.limitadoPorPotencia, aguaLimitada: mejor.limitadoPorAgua,
        Qtotal_turbinado: totalNecesario, Ptotal: mejor.P * mejor.n,
        porUnidadAtribucion: usarPesosPersonalizados ? pesosFraccionPara(mejor.n).map((peso, i) => ({
          unidad: i + 1, peso, Q: mejor.Q, gamma: mejor.gamma, eta: mejor.eta,
          deEntrada: qObjetivoOptimo * peso, deEmbalse: ajuste * peso,
        })) : null,
      },
      todas: [],
      esMaximizacion: true,
      esMaximizacionPotencia: true,
      considerarAjusteEmbalse,
      necesitariaEmbalseParaIdeal: !considerarAjusteEmbalse && mejor.limitadoPorAgua ? mejor.necesitariaEmbalse : 0,
      PtotalIdealSinAgua: !considerarAjusteEmbalse && mejor.limitadoPorAgua ? mejor.PidealTotal : null,
    });
  }

  /* "Garantizar potencia objetivo" (pedido explícito: la potencia como
     variable de ENTRADA — "¿cómo debe ser la operación óptima para
     garantizar X MW con las condiciones de entrada, nivel de embalse,
     ajuste de caudal del embalse, unidades disponibles y rango de
     apertura?"). Para cada n de 1 a las unidades disponibles, reparte el
     objetivo en partes iguales (Pobjetivo/n) y resuelve con
     resolverGammaParaPotencia (ya respeta el techo mecánico Y los 307 MW
     garantizados). Se prefiere el n MAYOR que SÍ alcanza el objetivo
     completo (reparte la carga entre más unidades, más cerca de sus
     picos individuales); si ninguna n alcanza el objetivo completo, se
     queda con la que entrega la mayor potencia total posible. Respeta el
     mismo interruptor de embalse que "Maximizar eficiencia/potencia":
     apagado, topa el caudal necesario al caudal de entrada disponible (y
     reporta, sin aplicar, cuánta agua de embalse haría falta para el
     objetivo completo); encendido, toma del embalse lo que haga falta. */
  const [potenciaObjetivoMW, setPotenciaObjetivoMW] = useState(600);
  function garantizarPotencia() {
    const gammaMaxMecanico = gammaMecanicoDeRango(rangoOptimo);
    const Pobjetivo = potenciaObjetivoMW;
    if (!Pobjetivo || Pobjetivo <= 0) return;
    let mejor = null;
    for (let n = 1; n <= unidadesDisponiblesOptimo; n++) {
      // El objetivo es potencia en bornes (como el despacho y lo que mide Hidrometría):
      // se pasa al eje de la turbina con el rendimiento del generador.
      const pBornesUnidad = Pobjetivo / n;
      const pObjetivoUnidad = pBornesUnidad / rendimientoGenerador(pBornesUnidad);
      const r = resolverGammaParaPotencia(nivelEmbalseExploracion, pObjetivoUnidad, n, gammaMaxMecanico, P_MAXIMO_ESPERADO_MW, condDescarga);
      if (r.debajoDelMinimoEnsayado) continue;
      if (!r.resultado) continue;
      const QnecesarioIdeal = r.resultado.Q * n;
      const excedeEntrada = QnecesarioIdeal > qObjetivoOptimo + 1e-6;
      let gamma = r.gamma, resultado = r.resultado, limitadoPorAgua = false;
      const necesitariaEmbalse = excedeEntrada ? Math.max(0, Math.round((QnecesarioIdeal - qObjetivoOptimo) * 100) / 100) : 0;
      // Objetivo alcanzado sin tocar agua: r.alcanzable ya indica si el
      // techo mecánico/307 MW impidió llegar exactamente a pObjetivoUnidad.
      let alcanzaObjetivo = r.alcanzable;
      if (excedeEntrada && !considerarAjusteEmbalse) {
        const rLim = resolverGammaParaCaudal(nivelEmbalseExploracion, qObjetivoOptimo / n, n, gammaMaxMecanico, condDescarga);
        if (!rLim.resultado || rLim.debajoDelMinimoEnsayado) continue;
        gamma = rLim.gamma; resultado = rLim.resultado; limitadoPorAgua = true; alcanzaObjetivo = false;
      }
      const actual = {
        n, gamma, resultado, limitadoPorAgua, alcanzaObjetivo,
        limitadoPorPotencia: !!r.limitadoPorPotencia, necesitariaEmbalse,
        Qtotal: resultado.Q * n, Ptotal: resultado.P * n,
      };
      if (!mejor) { mejor = actual; continue; }
      // Preferencia: primero, que alcance el objetivo completo. Entre las
      // que lo alcanzan: primero, la que NO necesite tocar el embalse
      // (aunque el interruptor esté encendido y lo permita, no tiene
      // sentido tomar agua si una n ya cumple el objetivo solo con la
      // entrada); si varias no lo necesitan (o varias sí), la de MAYOR n
      // (reparte más). Si ninguna alcanza el objetivo completo, la que
      // entregue la mayor potencia total posible.
      if (actual.alcanzaObjetivo && !mejor.alcanzaObjetivo) { mejor = actual; continue; }
      if (actual.alcanzaObjetivo && mejor.alcanzaObjetivo) {
        const actualSinEmbalse = actual.necesitariaEmbalse === 0;
        const mejorSinEmbalse = mejor.necesitariaEmbalse === 0;
        if (actualSinEmbalse && !mejorSinEmbalse) { mejor = actual; continue; }
        if (actualSinEmbalse === mejorSinEmbalse && actual.n > mejor.n) mejor = actual;
        continue;
      }
      if (!actual.alcanzaObjetivo && !mejor.alcanzaObjetivo) { if (actual.Ptotal > mejor.Ptotal + 0.5) mejor = actual; }
    }
    if (!mejor) return;
    const ajuste = considerarAjusteEmbalse ? Math.max(0, Math.round((mejor.Qtotal - qObjetivoOptimo) * 100) / 100) : 0;
    setAjusteEmbalse(ajuste);
    guardarResultadoOptimo({
      mejor: {
        n: mejor.n, gamma: mejor.gamma, qPorUnidad: mejor.resultado.Q, eta: mejor.resultado.eta,
        P: mejor.resultado.P, Q: mejor.resultado.Q, saltoNeto: mejor.resultado.saltoNeto,
        alcanzable: mejor.alcanzaObjetivo, limitadoPorPotencia: mejor.limitadoPorPotencia, aguaLimitada: mejor.limitadoPorAgua,
        Qtotal_turbinado: mejor.Qtotal, Ptotal: mejor.Ptotal, PtotalBornes: potenciaBornesDesdeEje(mejor.resultado.P) * mejor.n,
      },
      todas: [],
      esGarantizarPotencia: true,
      potenciaObjetivoMW: Pobjetivo,
      considerarAjusteEmbalse,
      necesitariaEmbalseParaObjetivo: !considerarAjusteEmbalse && mejor.limitadoPorAgua ? mejor.necesitariaEmbalse : 0,
    });
  }

  /* "Automático": decide POR SÍ SOLO, según el caudal de entrada realmente
     disponible (sin tocar el embalse salvo que el propio modo lo requiera),
     cuál de las tres lógicas ya validadas aplica — la misma decisión que,
     al revisar 7 crecientes reales, explicaba cuándo la operación real se
     parecía al pico de eficiencia y cuándo al techo de potencia:
       1) Si el caudal de entrada alcanza incluso para llevar TODAS las
          unidades a 307 MW, no tiene sentido quedarse en el pico de
          eficiencia — el agua sobrante se vertiría de todas formas, así
          que se usa el techo de potencia (como abril/mayo 2025-2026).
       2) Si alcanza para el pico de eficiencia pero no para 307 MW, se usa
          el pico de eficiencia (no hay agua de sobra que se estuviera
          desperdiciando por no llegar a 307 MW).
       3) Si ni siquiera alcanza para el pico de eficiencia, se reparte el
          caudal disponible en partes iguales entre las unidades — la
          misma lógica de "agua limitada" de "Buscar punto óptimo".
     En los casos 2 y 3 no se toca el embalse (ajuste queda en 0); solo el
     caso 1 puede implicar tomar agua del embalse, y se muestra igual de
     transparente que en los otros dos botones. */
  function decidirAutomatico() {
    const gammaMaxMecanico = gammaMecanicoDeRango(rangoOptimo);
    // Con % operativo personalizado (independiente por unidad), el
    // dispatch de cada unidad ya está completamente definido por el
    // usuario — no hay nada que "decidir" entre pico de eficiencia,
    // techo de potencia o reparto equitativo (esos 3 modos, por
    // definición, ponen a TODAS las unidades en el MISMO punto físico,
    // lo cual pisotearía los % elegidos unidad por unidad). Por eso,
    // con % personalizado activo, "Automático" es exactamente el mismo
    // resultado que "Buscar punto óptimo".
    if (usarPesosPersonalizados) {
      const r = buscarPuntoOptimo(totalDisponibleOptimo, nivelEmbalseExploracion, unidadesDisponiblesOptimo, gammaMaxMecanico, porcentajesPorUnidad, condDescarga);
      setResultadoOptimo({ ...r, esAutomatico: true, modoElegido: "personalizado" });
      return;
    }
    let mejor = null;
    const nsAProbar = Array.from({ length: unidadesDisponiblesOptimo }, (_, i) => i + 1);
    let mejorDetallePorUnidad = null;
    for (const n of nsAProbar) {
      const pico = picoEficiencia(nivelEmbalseExploracion, n, gammaMaxMecanico, P_MAXIMO_ESPERADO_MW, condDescarga);
      const maxPot = resolverGammaConLimitePotencia(nivelEmbalseExploracion, 1e6, n, gammaMaxMecanico, P_MAXIMO_ESPERADO_MW, condDescarga);
      if (!pico.resultado || !maxPot.resultado) continue;
      const totalParaPico = pico.resultado.Q * n;
      const totalParaMaxPotencia = maxPot.resultado.Q * n;
      let actual, detallePorUnidad = null;
      if (qObjetivoOptimo >= totalParaMaxPotencia) {
        actual = { n, modo: "potencia", gamma: maxPot.gamma, eta: maxPot.resultado.eta, P: maxPot.resultado.P, Q: maxPot.resultado.Q, saltoNeto: maxPot.resultado.saltoNeto, limitadoPorPotencia: maxPot.limitadoPorPotencia, aguaLimitada: false };
      } else if (qObjetivoOptimo >= totalParaPico) {
        actual = { n, modo: "eficiencia", gamma: pico.gamma, eta: pico.resultado.eta, P: pico.resultado.P, Q: pico.resultado.Q, saltoNeto: pico.resultado.saltoNeto, limitadoPorPotencia: pico.limitadoPorPotencia, aguaLimitada: false };
      } else {
        const qEquitativo = qObjetivoOptimo / n;
        const r = resolverGammaParaCaudal(nivelEmbalseExploracion, qEquitativo, n, gammaMaxMecanico, condDescarga);
        if (!r.resultado || r.debajoDelMinimoEnsayado) continue;
        actual = { n, modo: "limitada", gamma: r.gamma, eta: r.resultado.eta, P: r.resultado.P, Q: r.resultado.Q, saltoNeto: r.resultado.saltoNeto, limitadoPorPotencia: false, aguaLimitada: true, alcanzable: r.alcanzable !== false };
      }
      const totalTurbinadoActual = actual.Q * actual.n;
      if (!mejor) { mejor = actual; mejorDetallePorUnidad = detallePorUnidad; continue; }
      const diffTotal = totalTurbinadoActual - mejor.Q * mejor.n;
      if (diffTotal > 1 || (diffTotal > -1 && actual.eta > mejor.eta)) { mejor = actual; mejorDetallePorUnidad = detallePorUnidad; }
    }
    if (!mejor) return;
    const totalNecesario = mejor.Q * mejor.n;
    // Solo el modo "potencia" puede requerir tomar agua del embalse; en
    // los otros dos modos, el reparto ya es exactamente lo que permite el
    // caudal de entrada, así que el ajuste vuelve a 0.
    const ajuste = mejor.modo === "potencia" ? Math.max(0, Math.round((totalNecesario - qObjetivoOptimo) * 100) / 100) : 0;
    setAjusteEmbalse(ajuste);
    guardarResultadoOptimo({
      mejor: {
        n: mejor.n, gamma: mejor.gamma, qPorUnidad: mejor.Q, eta: mejor.eta, P: mejor.P, Q: mejor.Q, saltoNeto: mejor.saltoNeto,
        alcanzable: mejor.alcanzable !== false, limitadoPorPotencia: mejor.limitadoPorPotencia, aguaLimitada: mejor.aguaLimitada,
        Qtotal_turbinado: totalNecesario, Ptotal: mejor.P * mejor.n,
        // Modo "limitada" con pesos personalizados: reparto REAL (cada
        // unidad puede tener γ/Q/η distinto). Modos "potencia"/"eficiencia":
        // todas operan igual — el % solo atribuye entrada/embalse.
        porUnidad: mejor.modo === "limitada" && mejorDetallePorUnidad ? mejorDetallePorUnidad : null,
        porUnidadAtribucion: usarPesosPersonalizados && mejor.modo !== "limitada" ? pesosFraccionPara(mejor.n).map((peso, i) => ({
          unidad: i + 1, peso, Q: mejor.Q, gamma: mejor.gamma, eta: mejor.eta,
          deEntrada: qObjetivoOptimo * peso, deEmbalse: ajuste * peso,
        })) : null,
      },
      todas: [],
      esAutomatico: true,
      modoElegido: mejor.modo,
    });
  }

  /* Si el caudal objetivo total supera lo que las unidades activas pueden
     turbinar, el remanente tiene que descargarse por el vertedero — se
     reutiliza la misma regla de canal ya validada del simulador de
     crecientes (izquierdo 150-500 m³/s, derecho 500-1500, ambos >1500,
     cerrado <150) para decidir por cuál canal y con qué apertura. */
  /* Qué pasa con el caudal que NO se turbina: no desaparece, va a alguna
     parte. CORREGIDO (pedido explícito): con el interruptor de ajuste de
     embalse APAGADO, el excedente no se manda por defecto al vertedero —
     se ALMACENA en el embalse (el nivel sube ligeramente), igual que
     "ajusteEmbalse negativo" ya lo describe en el resto de la app. Tiene
     sentido: si el interruptor está apagado, el análisis ya declaró que
     NO toma agua del embalse para turbinar más — el complemento físico
     de esa misma decisión es que el agua no usada se queda en el embalse
     en vez de descargarse, salvo que el usuario decida explícitamente lo
     contrario (encendiendo el interruptor). Con el interruptor ENCENDIDO,
     se mantiene el comportamiento anterior: cualquier excedente que ni
     siquiera el ajuste de embalse alcanza a aprovechar (techo mecánico o
     de potencia ya tocado) sí se modela pasando por el vertedero — ese es
     un caso genuino de "las unidades no pueden con más agua", no una
     decisión de no tomar del embalse. */
  const excedenteVertedero = useMemo(() => {
    if (!resultadoOptimo) return null;
    const totalTurbinado = resultadoOptimo.mejor.Q * resultadoOptimo.mejor.n;
    const excedente = totalDisponibleOptimo - totalTurbinado;
    if (excedente <= 0.5) return null; // dentro de tolerancia: no hay excedente real que gestionar
    if (!considerarAjusteEmbalse) {
      // Ajuste de embalse apagado: el excedente se almacena, no se vierte.
      return { excedente, totalTurbinado, almacenaEnEmbalse: true };
    }
    const { aperturas, canal } = decidirCanalYAperturas(nivelEmbalseExploracion, excedente);
    const qLogrado = caudalVertederoDetallado(nivelEmbalseExploracion, aperturas).total;
    return { excedente, totalTurbinado, canal, aperturas, qLogrado, almacenaEnEmbalse: false };
  }, [resultadoOptimo, totalDisponibleOptimo, nivelEmbalseExploracion, considerarAjusteEmbalse]);


  const puntoActual = useMemo(() => evaluarHillChart(Hsel, gamma), [Hsel, gamma]);
  const detalleSaltoExploracion = useMemo(
    () => evaluarTurbinaUnidad(nivelEmbalseExploracion, gamma, nTurbActivasExploracion, condDescarga),
    [nivelEmbalseExploracion, gamma, nTurbActivasExploracion, condDescarga]
  );
  const gammaCercana = useMemo(() => GAMMAS_HILL.reduce((mejor, g) => (Math.abs(g - gamma) < Math.abs(mejor - gamma) ? g : mejor), GAMMAS_HILL[0]), [gamma]);

  const lineasPorGamma = useMemo(() => GAMMAS_HILL.map((g) => ({
    gamma: g,
    puntos: HILL_PROTO_186.filter((r) => r[0] === g).sort((a, b) => a[1] - b[1]).map((r) => ({
      n11: r[1], Q11: r[2], P11: r[3], Q11_m3s: r[2] / 1000, P11_MW: r[3] / 1000, eta: r[4], H: r[5], Q: r[6], P: r[7],
    })),
  })), []);

  const [n11min, n11max] = useMemo(() => {
    const ns = HILL_PROTO_186.map((r) => r[1]);
    return [Math.floor(Math.min(...ns) - 1), Math.ceil(Math.max(...ns) + 1)];
  }, []);
  const [Hmin, Hmax] = useMemo(() => {
    const hs = HILL_PROTO_186.map((r) => r[5]);
    return [Math.floor(Math.min(...hs) - 5), Math.ceil(Math.max(...hs) + 5)];
  }, []);
  const dominioY = (campoIdx) => {
    const vs = HILL_PROTO_186.map((r) => r[campoIdx]);
    return [0, Math.ceil(Math.max(...vs) * 1.05)];
  };

  const curvasEficiencia = useMemo(() => H_REFERENCIA_MODELO.map((ref) => ({ ...ref, puntos: curvaEficienciaEnH(ref.H, 0.4) })), []);

  const cardStyle = { background: T.panel, border: `1px solid ${T.line}`, borderRadius: 10, padding: "16px 20px", boxShadow: T.cardShadow, marginBottom: 16 };


  const gridModeloQ = useMemo(() => construirMallaModelo("Q11", 60, 60), []);
  const gridModeloP = useMemo(() => construirMallaModelo("P11", 60, 60), []);
  const gridProtoQ = useMemo(() => construirMallaProto("H", "Q", 60, 60), []);
  const gridProtoP = useMemo(() => construirMallaProto("H", "P", 60, 60), []);

  /* Diagrama: caudal turbinable total (y, por lo tanto, cuántas unidades
     hacen falta) según el número de unidades activas y el nivel del
     embalse, en el rango de operación normal (390-420 msnm = NAMO). Cada
     línea es la capacidad MÁXIMA (a la apertura máxima del rango elegido)
     con esa cantidad de unidades — permite ver, para un caudal objetivo,
     cuántas unidades como mínimo se necesitan a cada nivel. */
  /* F.C. — Factor Potencia/Caudal turbinado (MW / (m³/s)) por unidad, a la
     apertura máxima del rango elegido, en función del nivel del embalse
     y del volumen útil (%). Volumen útil 100% = volumen útil en el NAMO
     (420 msnm); 0% = volumen útil en el nivel mínimo técnico (390 msnm). */
  const volUtilMaxHm3 = useMemo(() => volumenUtilHm3(NAMO), []);
  const diagramaFC = useMemo(() => {
    const gMax = gammaMecanicoDeRango(rangoOptimo);
    const puntos = [];
    for (let H = NIVEL_MIN_TEC; H <= NAMO; H += 0.5) {
      // capacidad real: apertura máxima del rango, sin pasar de 307 MW en el eje
      const r = resolverGammaConLimitePotencia(H, 1e6, nTurbActivasExploracion, gMax, P_MAXIMO_ESPERADO_MW, condDescarga).resultado;
      const volUtilPct = volUtilMaxHm3 > 0 ? (volumenUtilHm3(H) / volUtilMaxHm3) * 100 : 0;
      puntos.push({
        H, volUtilPct,
        FC: r && r.Q > 0 ? potenciaBornesDesdeEje(r.P) / r.Q : null,
        FC_hidrometria: factorConversionHidrometria(H),
        FC_anterior: FACTOR_HIDROMETRIA_MW_POR_M3S,
      });
    }
    return puntos;
  }, [rangoOptimo, nTurbActivasExploracion, volUtilMaxHm3, condDescarga]);

  const diagramaTurbinasVsNivel = useMemo(() => {
    const gMax = gammaMecanicoDeRango(rangoOptimo);
    const puntos = [];
    for (let H = NIVEL_MIN_TEC; H <= NAMO; H += 0.5) {
      const fila = { H };
      for (let n = 1; n <= N_TURBINAS_MAX; n++) {
        const r = resolverGammaConLimitePotencia(H, 1e6, n, gMax, P_MAXIMO_ESPERADO_MW, condDescarga).resultado;
        fila[`n${n}`] = r ? r.Q * n : null;
      }
      puntos.push(fila);
    }
    return puntos;
  }, [rangoOptimo, condDescarga]);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {tab === "descarga" && (<>
      <Proposito T={T} id="descarga" titulo="Condición de descarga (almenaras)" fuente="Estudio ASE 2026 (río colmatado), diseño GE / pliego, o niveles medidos" para="Fijar la condición aguas abajo, es decir, el nivel de las almenaras, que usan todos los cálculos de la app." logras="Que el salto neto refleje el estado real del río: con el río colmatado la almenara sube y se pierde salto. A medida que avancen los dragados, la condición se acercará a la de diseño." resultados="Nivel de cada almenara (N°1: U1–U4; N°2: U5–U8 desde 2028) según el caudal del río y el turbinado, con avisos cuando se extrapola." />
      <div style={cardStyle}>
        <PanelCondicionDescarga cond={condDescarga} setCond={setCondDescarga} T={T}
          nivelEmbalse={nivelEmbalseExploracion} nUnidades={nTurbActivasExploracion} gamma={gamma} />
      </div>
      </>)}

      {tab === "buscador" && (<>
      <Proposito T={T} id="buscador" titulo="Buscador de configuración" fuente="Modelo de la colina (ensayo 2013, transpuesto al prototipo) con la condición de descarga elegida" para="Encontrar cuántas unidades usar y con qué apertura para turbinar un caudal de entrada con la mayor eficiencia, sin pasar de 307 MW por unidad." logras="Decidir la configuración de máquinas para un caudal dado (el pronóstico de Sitio Presa, el promedio regulado de ayer o el que se quiera) y ver la potencia que se obtiene. Con datos en vivo, el nivel y el caudal se llenan solos." resultados="Para 1 a N unidades: apertura, caudal y potencia por unidad, eficiencia y salto neto, con la opción recomendada; también el modo “garantizar potencia objetivo”." />
      <div style={cardStyle}>
        <ChartHeader titulo="Buscador de punto de máxima eficiencia" subtitulo="A partir del caudal de entrada en Sitio Presa y el nivel del embalse, busca automáticamente la apertura del distribuidor, el salto neto y cuántas unidades usar para la mayor eficiencia posible, sin superar 307 MW por unidad." T={T}
          tip={`Prueba de 1 a N unidades activas (según lo que marques como disponible), repartiendo el caudal en partes iguales entre ellas. Para cada conteo de unidades, busca la apertura que logra ese caudal por unidad — respetando dos techos: el mecánico del distribuidor elegido en "Rango de apertura" (${fx(pctFromDeg(gammaMecanicoDeRango(rangoOptimo)), 0)}% = ${fx(gammaMecanicoDeRango(rangoOptimo), 2)}°) y la potencia máxima garantizada (${P_MAXIMO_ESPERADO_MW} MW, el estudio de ampliación de GE (2023)) — el que sea más restrictivo manda. Descarta las opciones que no se pueden cumplir (por ejemplo, cuando el caudal repartido deja cada unidad bajo la apertura mínima ensayada) y elige la que turbina más caudal; si varias turbinan lo mismo (±1 m³/s), la de mayor eficiencia. El nivel del embalse es el mismo de la exploración; la apertura resultante no se traslada a la exploración.`} />
        {vivo && vivo.actual && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "8px 12px", marginBottom: 12, borderRadius: 8, background: T.accentSoft, fontSize: 12.5, color: T.inkMuted }}>
            <b style={{ color: T.ink }}>Datos en vivo</b>
            <span>Nivel actual {fx(vivo.actual.nivel, 2)} msnm{caudalVivo ? ` · caudal ${fx(caudalVivo.q, 0)} m³/s (${caudalVivo.txt})` : ""}</span>
            <span style={{ flex: 1 }} />
            <button onClick={aplicarVivoColina} style={{ padding: "4px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: `1px solid ${T.teal}`, background: "transparent", color: T.teal, fontWeight: 600 }}>Usar condiciones actuales</button>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 8 }}>
          <div>
            <Etiqueta T={T} tip={`Caudal total que ingresa por Sitio Presa (suma de lo que deben turbinar todas las unidades activas). Sin tope automático: si pides más de lo que las unidades pueden turbinar respetando la apertura máxima y los ${P_MAXIMO_ESPERADO_MW} MW por unidad, el buscador te lo indica (†). El excedente que no se turbina se almacena en el embalse (el nivel sube) mientras el ajuste de caudal del embalse esté apagado; solo se modela pasando por el vertedero si ni siquiera con ese ajuste encendido las unidades pueden aprovecharlo.`}>Caudal Entrada Sitio Presa</Etiqueta>
            <InputNumeroLibre min={1} step={1} value={qObjetivoOptimo}
              onChange={(n) => setQObjetivoOptimo(Math.max(1, n))}
              className="itu-num-input" />
          </div>
          <div>
            <Etiqueta T={T} tip="Nivel del embalse — el mismo campo que 'Nivel del embalse' en Colina de la turbina — exploración y simulación (abajo). Editarlo aquí también actualiza el Salto neto (H) de la exploración, y viceversa.">Nivel del embalse</Etiqueta>
            <InputNumeroLibre step={0.1} min={NIVEL_MIN_TEC} max={NAME} value={nivelEmbalseExploracion} onChange={alEditarNivelEmbalse} className="itu-num-input" />
          </div>
          <div>
            <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
              <input type="checkbox" checked={considerarAjusteEmbalse} onChange={(e) => setConsiderarAjusteEmbalse(e.target.checked)} />
              <Etiqueta T={T} tip="Interruptor ON/OFF: decide si el análisis puede tomar agua adicional del embalse (o guardar agua en él) por ENCIMA del caudal de entrada. APAGADO (default): toda la lógica de abajo se limita ESTRICTAMENTE a lo que las unidades pueden generar con el caudal de entrada ingresado — el campo de ajuste no se usa, aunque tenga un valor guardado. ENCENDIDO: el campo de abajo se suma al caudal de entrada, y 'Maximizar eficiencia'/'Maximizar potencia'/'Garantizar potencia objetivo' pueden tomar del embalse lo necesario para llegar al punto ideal, indicándolo siempre de forma explícita en el resultado.">
                Considerar ajuste de caudal del embalse
              </Etiqueta>
            </label>
            <InputNumeroLibre step={1} value={ajusteEmbalse} onChange={setAjusteEmbalse} className="itu-num-input" disabled={!considerarAjusteEmbalse} style={!considerarAjusteEmbalse ? { opacity: 0.45 } : undefined} />
            <div style={{ fontSize: 11, color: T.inkFaint, fontFamily: FONT_BODY, marginTop: 3 }}>
              {considerarAjusteEmbalse
                ? <>Total disponible a repartir: <b style={{ color: T.ink }}>{fx(totalDisponibleOptimo, 1)} m³/s</b> ({qObjetivoOptimo} entrada {ajusteEmbalse >= 0 ? "+" : "−"} {fx(Math.abs(ajusteEmbalse), 1)} embalse)</>
                : <>Ajuste de embalse APAGADO — el análisis se limita a los {qObjetivoOptimo} m³/s de entrada, sin tomar ni guardar agua del embalse.</>}
            </div>
          </div>
          <div>
            <Etiqueta T={T} tip="Cuántas unidades están realmente disponibles para esta búsqueda (4 hoy — U1-U4, almenara N°1; las U5-U8, almenara N°2, entran a partir de inicios de 2028). El buscador solo prueba combinaciones dentro de este límite.">Unidades disponibles</Etiqueta>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {Array.from({ length: N_TURBINAS_MAX }, (_, i) => i + 1).map((n) => (
                <button key={n} onClick={() => setUnidadesDisponiblesOptimo(n)} style={{
                  flex: "1 1 30px", padding: "8px 4px", fontSize: 12, fontFamily: FONT_BODY, fontWeight: 600,
                  border: `1px solid ${unidadesDisponiblesOptimo === n ? T.teal : T.line}`, borderRadius: 4, cursor: "pointer",
                  background: unidadesDisponiblesOptimo === n ? T.panelSoft : "transparent", color: unidadesDisponiblesOptimo === n ? T.teal : T.inkMuted,
                }}>{n}</button>
              ))}
            </div>
          </div>
          <div>
            <Etiqueta T={T} tip={`Techo MECÁNICO del distribuidor que el buscador tiene permitido usar, en % de apertura (100% = 30.2°, el límite ampliado y garantizado por GE/EPM en 2023). Normal (97%, default): margen operativo diario, reservando el 3% restante (${MARGEN_FRECUENCIA_PCT}%) exclusivamente para responder a cambios de frecuencia del sistema eléctrico colombiano — pedido explícito del ingeniero de operaciones. Original (88% ≈ 26.5°): límite mecánico previo al estudio de 2023. Ampliado (100% = 30.2°): usa deliberadamente TODA la apertura garantizada, incluida la reserva de frecuencia — solo para cuando eso sea la intención. El otro techo, la potencia máxima garantizada (${P_MAXIMO_ESPERADO_MW} MW), siempre aplica además de este — el que sea más restrictivo manda.`}>Rango de apertura (techo mecánico)</Etiqueta>
            <div style={{ display: "flex", gap: 4 }}>
              {[
                { v: "original", l: `Original ≤${fx(pctFromDeg(GAMMA_ORIGINAL_MAX), 0)}%` },
                { v: "normal", l: "Normal ≤97%" },
                { v: "ampliado", l: "Ampliado =100%" },
              ].map((o) => (
                <button key={o.v} onClick={() => setRangoOptimo(o.v)} style={{
                  flex: 1, padding: "8px 6px", fontSize: 12, fontFamily: FONT_BODY, fontWeight: 600,
                  border: `1px solid ${rangoOptimo === o.v ? T.teal : T.line}`, borderRadius: 4, cursor: "pointer",
                  background: rangoOptimo === o.v ? T.panelSoft : "transparent", color: rangoOptimo === o.v ? T.teal : T.inkMuted,
                }}>{o.l}</button>
              ))}
            </div>
            {rangoOptimo === "ampliado" && (
              <div style={{ fontSize: 11, color: T.amber, fontFamily: FONT_BODY, marginTop: 4, fontWeight: 600 }}>
                ⚠ Estás habilitando el 100% de apertura — incluye la reserva del {MARGEN_FRECUENCIA_PCT}% normalmente destinada a respuesta de frecuencia.
              </div>
            )}
          </div>
        </div>

        <div style={{ marginBottom: 12, padding: "10px 12px", background: T.panelSoft, borderRadius: 6 }}>
          <Etiqueta T={T} tip="La potencia como variable de ENTRADA: en vez de buscar el máximo posible, indicas cuántos MW totales necesitas garantizar y la app resuelve la operación (apertura por unidad, cuántas unidades usar) que lo logra, respetando el caudal de entrada, el nivel del embalse, el interruptor de ajuste de embalse, las unidades disponibles y el techo mecánico elegidos arriba. Si el objetivo no es alcanzable ni con el rango mecánico ni con los 307 MW garantizados por unidad, entrega el máximo posible y lo indica.">
            Garantizar potencia objetivo (MW en bornes)
          </Etiqueta>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
            <InputNumeroLibre min={0} step={10} value={potenciaObjetivoMW} onChange={setPotenciaObjetivoMW} className="itu-num-input" style={{ width: 100 }} />
            <span style={{ fontSize: 12, color: T.inkFaint, fontFamily: FONT_BODY }}>MW totales en bornes (como el despacho)</span>
            <button onClick={garantizarPotencia} style={{
              padding: "8px 16px", background: "transparent", color: T.cyan, border: `1.5px solid ${T.cyan}`, borderRadius: 6,
              fontFamily: FONT_BODY, fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}>🎯 Garantizar potencia objetivo</button>
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginBottom: 6 }}>
            <input type="checkbox" checked={usarPesosPersonalizados} onChange={(e) => setUsarPesosPersonalizados(e.target.checked)} />
            <Etiqueta T={T} tip="% OPERATIVO por unidad, verificado contra un dato real de Hidrometría EPM (nivel 408.21 m: U2 al 71.7%, U4 al 60.1%, U1/U3 inoperativas — la suma NO da 100% y no tiene por qué). Cada unidad tiene su propio % INDEPENDIENTE de las demás: % = potencia objetivo de esa unidad / 300 MW. 0% = unidad inoperativa (detenida). Reemplaza el reparto equitativo (Qtotal/n) en 'Buscar punto óptimo' y en 'Automático' — cada unidad opera exactamente en el punto que le corresponde según su %, no según cuánta agua sobra o falta. No aplica a 'Maximizar eficiencia' / 'Maximizar potencia' (ahí, por definición, todas las unidades ya operan en el mismo punto físico); en esos dos modos el % solo se usa, normalizado, para ATRIBUIR el total entre unidades a efectos de planeación.">
              Usar % operativo personalizado por unidad
            </Etiqueta>
          </label>
          {usarPesosPersonalizados && (
            <>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
                {Array.from({ length: unidadesDisponiblesOptimo }, (_, i) => i).map((i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 11.5, color: T.inkFaint, fontFamily: FONT_BODY }}>U{i + 1}</span>
                    <InputNumeroLibre step={1} min={0} max={100} value={pesosUnidades[i] ?? 70} onChange={(v) => editarPesoUnidad(i, v)} className="itu-num-input" style={{ width: 60 }} />
                    <span style={{ fontSize: 11.5, color: T.inkFaint, fontFamily: FONT_BODY }}>%</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: T.teal, fontFamily: FONT_BODY, marginTop: 4, fontWeight: 600 }}>
                % operativo personalizado activo — cada unidad opera de forma independiente según su propio %; 0% = inoperativa. No es necesario que sumen 100%.
              </div>
            </>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={buscarOptimo} style={{
            padding: "10px 20px", background: T.teal, color: T.bgDeep, border: "none", borderRadius: 6,
            fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
          }}>Buscar punto óptimo</button>
          <button onClick={maximizarEficiencia} title={considerarAjusteEmbalse ? "Busca la mayor eficiencia posible entre las unidades disponibles (ignora el caudal de entrada como techo) y calcula automáticamente el ajuste de embalse necesario para lograrla." : "Busca la mayor eficiencia ALCANZABLE con el caudal de entrada disponible, sin tomar agua del embalse. Activa 'Considerar ajuste de caudal del embalse' arriba para ignorar el caudal de entrada como techo."}
            style={{
              padding: "10px 20px", background: "transparent", color: T.teal, border: `1.5px solid ${T.teal}`, borderRadius: 6,
              fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
            }}>⚡ Maximizar eficiencia</button>
          <button onClick={maximizarPotencia} title={considerarAjusteEmbalse ? "Empuja la apertura hasta la potencia máxima garantizada (307 MW) o el techo mecánico del rango elegido, lo que se alcance primero — sin importar la eficiencia. Calcula automáticamente el ajuste de embalse necesario." : "Empuja la apertura hasta el máximo ALCANZABLE con el caudal de entrada disponible, sin tomar agua del embalse. Activa 'Considerar ajuste de caudal del embalse' arriba para ignorar el caudal de entrada como techo."}
            style={{
              padding: "10px 20px", background: "transparent", color: T.amber, border: `1.5px solid ${T.amber}`, borderRadius: 6,
              fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
            }}>🔋 Maximizar potencia</button>
          <button onClick={decidirAutomatico} title="Decide por sí solo entre las tres lógicas anteriores, según el caudal de entrada realmente disponible: usa el techo de potencia si hay agua de sobra hasta para eso, el pico de eficiencia si alcanza para ese pero no más, o reparte equitativamente si el agua es limitada. Nunca toma agua del embalse por sí mismo."
            style={{
              padding: "10px 20px", background: "transparent", color: T.ink, border: `1.5px solid ${T.ink}`, borderRadius: 6,
              fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
            }}>🤖 Automático</button>
        </div>
        <div style={{ fontSize: 11.5, color: T.inkFaint, fontFamily: FONT_BODY, marginTop: 6 }}>
          {considerarAjusteEmbalse
            ? <>Ajuste de embalse ENCENDIDO: "Maximizar eficiencia", "Maximizar potencia" y "Garantizar potencia objetivo" pueden tomar agua del embalse y ajustan el campo "Considerar ajuste de caudal del embalse" por ti, mostrando cuánto tomarían.</>
            : <>Ajuste de embalse APAGADO: todos los botones se limitan estrictamente a los {qObjetivoOptimo} m³/s de entrada — ninguno toca el embalse. Si el objetivo no es alcanzable solo con esa agua, se indica cuánta agua adicional del embalse haría falta, sin aplicarla.</>}
          {" "}"Automático" decide cuál de las tres lógicas (potencia, eficiencia o reparto equitativo) aplica según el caudal de entrada, y nunca toca el embalse por sí mismo.
        </div>

        {resultadoOptimo && (
          <div style={{ marginTop: 16 }}>
            <div style={{ padding: "12px 14px", background: T.panelSoft, borderRadius: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.teal, fontFamily: FONT_BODY, marginBottom: 4 }}>
                {resultadoOptimo.mejor.gamma != null
                  ? <>Con {resultadoOptimo.mejor.n} unidad(es) a este nivel: cada una turbina {fx(resultadoOptimo.mejor.Q, 1)} m³/s a {fx(pctFromDeg(resultadoOptimo.mejor.gamma), 1)}% ({fx(resultadoOptimo.mejor.gamma, 2)}°) — eficiencia {fx(resultadoOptimo.mejor.eta, 2)}%</>
                  : <>Con {resultadoOptimo.mejor.n} unidad(es) a este nivel, con reparto personalizado por unidad (ver tabla abajo) — eficiencia promedio ponderada {fx(resultadoOptimo.mejor.eta, 2)}%</>}
              </div>
              <div style={{ fontSize: 12.5, color: T.inkMuted, fontFamily: FONT_BODY, lineHeight: 1.5 }}>
                {resultadoOptimo.mejor.gamma != null && <>{fx(resultadoOptimo.mejor.P, 1)} MW por unidad en el eje ({fx(resultadoOptimo.mejor.P * resultadoOptimo.mejor.n, 1)} MW total; ≈ {fx(potenciaBornesDesdeEje(resultadoOptimo.mejor.P) * resultadoOptimo.mejor.n, 1)} MW en bornes) · </>}
                salto neto {resultadoOptimo.mejor.saltoNeto != null ? fx(resultadoOptimo.mejor.saltoNeto, 1) : "—"} m ·
                capacidad turbinable total: <b style={{ color: T.ink }}>{fx(resultadoOptimo.mejor.Qtotal_turbinado, 1)} m³/s</b> ({fx(resultadoOptimo.mejor.Ptotal, 1)} MW) de los {qObjetivoOptimo} m³/s de entrada
                {considerarAjusteEmbalse && ajusteEmbalse !== 0 && ` más ${ajusteEmbalse > 0 ? "" : "menos "}${fx(Math.abs(ajusteEmbalse), 1)} m³/s ${ajusteEmbalse > 0 ? "tomados del" : "guardados en el"} embalse (nivel ${ajusteEmbalse > 0 ? "bajando" : "subiendo"} ligeramente)`}
                {resultadoOptimo.mejor.limitadoPorPotencia && " (el límite es la potencia máxima garantizada de 307 MW por unidad a este salto, no el caudal de entrada)"}.
              </div>
              {resultadoOptimo.mejor.porAlmenara && (
                <div style={{ fontSize: 12.5, color: T.inkMuted, fontFamily: FONT_BODY, lineHeight: 1.5, marginTop: 6 }}>
                  Operación conjunta de las dos almenaras (misma apertura; cada grupo con su propio nivel de almenara y salto neto — los valores de arriba son el promedio por unidad):
                  {ZONAS.filter((z) => resultadoOptimo.mejor.porAlmenara[z]).map((z) => {
                    const g = resultadoOptimo.mejor.porAlmenara[z];
                    const nz = resultadoOptimo.mejor.unidadesPorAlmenara[z];
                    return (
                      <div key={z}>
                        · {NOMBRE_ALMENARA[z]}, {nz} ud.: almenara {fx(g.nivelAlmenara, 2)} msnm · salto neto {fx(g.saltoNeto, 2)} m · {fx(g.Q, 1)} m³/s y <b style={{ color: T.ink }}>{fx(g.P, 1)} MW</b> por unidad ({fx(g.P * nz, 1)} MW del grupo) · η {fx(g.eta, 2)}%
                        {g.avisosAlmenara.length > 0 && <span style={{ color: T.amber }}> · ⚠ {g.avisosAlmenara.join("; ")}</span>}
                      </div>
                    );
                  })}
                </div>
              )}
              {resultadoOptimo.mejor.porUnidad && (
                <div style={{ marginTop: 10, overflowX: "auto" }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: T.ink, fontFamily: FONT_BODY, marginBottom: 4 }}>Reparto real por unidad (% operativo independiente, base 300 MW):</div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: FONT_BODY }}>
                    <thead><tr style={{ color: T.inkFaint, textAlign: "left" }}>
                      {["Unidad", "Almenara", "% operativo", "Apertura", "Salto neto (m)", "Q (m³/s)", "P (MW)", "η (%)", ""].map((h) => <th key={h} style={{ padding: "4px 8px", borderBottom: `1px solid ${T.line}` }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {resultadoOptimo.mejor.porUnidad.map((d) => (
                        <tr key={d.unidad} style={{ color: T.ink, opacity: d.inoperativa ? 0.6 : 1 }}>
                          <td style={{ padding: "4px 8px" }}>U{d.unidad}</td>
                          <td style={{ padding: "4px 8px" }}>{d.unidad <= 4 ? "N°1" : "N°2"}</td>
                          <td style={{ padding: "4px 8px" }}>{fx(d.pct, 1)}%</td>
                          <td style={{ padding: "4px 8px" }}>{fx(pctFromDeg(d.gamma), 1)}% ({fx(d.gamma, 2)}°)</td>
                          <td style={{ padding: "4px 8px" }}>{d.resultado && d.resultado.saltoNeto != null ? fx(d.resultado.saltoNeto, 2) : "—"}</td>
                          <td style={{ padding: "4px 8px" }}>{d.resultado ? fx(d.resultado.Q, 1) : "—"}</td>
                          <td style={{ padding: "4px 8px" }}>{d.resultado ? fx(d.resultado.P, 1) : "—"}</td>
                          <td style={{ padding: "4px 8px" }}>{d.resultado ? fx(d.resultado.eta, 2) : "—"}</td>
                          <td style={{ padding: "4px 8px", color: T.amber, fontWeight: 700 }}>
                            {d.inoperativa ? "inoperativa" : !d.alcanzable ? (d.debajoDelMinimoEnsayado ? "† por debajo del mínimo estable" : "† no alcanza el objetivo") : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {resultadoOptimo.mejor.porUnidadAtribucion && (
                <div style={{ marginTop: 10, overflowX: "auto" }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: T.ink, fontFamily: FONT_BODY, marginBottom: 4 }}>
                    Atribución por unidad (todas operan igual — mismo γ/Q/η; el % solo reparte el total para planeación):
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: FONT_BODY }}>
                    <thead><tr style={{ color: T.inkFaint, textAlign: "left" }}>
                      {["Unidad", "% asignado", "De entrada (m³/s)", "De embalse (m³/s)"].map((h) => <th key={h} style={{ padding: "4px 8px", borderBottom: `1px solid ${T.line}` }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {resultadoOptimo.mejor.porUnidadAtribucion.map((d) => (
                        <tr key={d.unidad} style={{ color: T.ink }}>
                          <td style={{ padding: "4px 8px" }}>U{d.unidad}</td>
                          <td style={{ padding: "4px 8px" }}>{fx(d.peso * 100, 1)}%</td>
                          <td style={{ padding: "4px 8px" }}>{fx(d.deEntrada, 1)}</td>
                          <td style={{ padding: "4px 8px" }}>{fx(d.deEmbalse, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {resultadoOptimo.esMaximizacion && !resultadoOptimo.esMaximizacionPotencia && (
                <div style={{ marginTop: 8, fontSize: 12, color: T.teal, fontFamily: FONT_BODY, lineHeight: 1.5 }}>
                  {resultadoOptimo.considerarAjusteEmbalse
                    ? <>⚡ Considerando el ajuste de caudal del embalse: se lograría el punto de máxima eficiencia posible con {resultadoOptimo.mejor.n} unidad(es) a este nivel, sin la restricción de no superar el caudal de entrada. El campo "Considerar ajuste de caudal del embalse" ya quedó en {fx(ajusteEmbalse, 1)} m³/s para reflejarlo.</>
                    : <>⚡ Sin considerar ajuste de embalse (apagado): esta es la MEJOR eficiencia alcanzable con {resultadoOptimo.mejor.n} unidad(es) usando solo los {qObjetivoOptimo} m³/s de entrada.
                      {resultadoOptimo.necesitariaEmbalseParaIdeal > 0 && <> Para llegar al verdadero pico de eficiencia (η={fx(resultadoOptimo.etaIdealSinAgua, 2)}%) haría falta tomar {fx(resultadoOptimo.necesitariaEmbalseParaIdeal, 1)} m³/s adicionales del embalse — no aplicados; activa "Considerar ajuste de caudal del embalse" arriba para incluirlos.</>}
                    </>}
                </div>
              )}
              {resultadoOptimo.esMaximizacionPotencia && (
                <div style={{ marginTop: 8, fontSize: 12, color: T.amber, fontFamily: FONT_BODY, lineHeight: 1.5 }}>
                  {resultadoOptimo.considerarAjusteEmbalse
                    ? <>🔋 Considerando el ajuste de caudal del embalse: se lograría el punto de máxima potencia posible (techo de 307 MW o mecánico) con {resultadoOptimo.mejor.n} unidad(es) a este nivel, sacrificando algo de eficiencia a cambio de más generación. El campo "Considerar ajuste de caudal del embalse" ya quedó en {fx(ajusteEmbalse, 1)} m³/s para reflejarlo.</>
                    : <>🔋 Sin considerar ajuste de embalse (apagado): esta es la MÁXIMA potencia alcanzable con {resultadoOptimo.mejor.n} unidad(es) usando solo los {qObjetivoOptimo} m³/s de entrada.
                      {resultadoOptimo.necesitariaEmbalseParaIdeal > 0 && <> Para llegar al techo de potencia (P={fx(resultadoOptimo.PtotalIdealSinAgua, 1)} MW total) haría falta tomar {fx(resultadoOptimo.necesitariaEmbalseParaIdeal, 1)} m³/s adicionales del embalse — no aplicados; activa "Considerar ajuste de caudal del embalse" arriba para incluirlos.</>}
                    </>}
                </div>
              )}
              {resultadoOptimo.esGarantizarPotencia && (
                <div style={{ marginTop: 8, fontSize: 12, color: T.cyan, fontFamily: FONT_BODY, lineHeight: 1.5 }}>
                  🎯 Objetivo: garantizar {fx(resultadoOptimo.potenciaObjetivoMW, 1)} MW totales en bornes.{" "}
                  {resultadoOptimo.mejor.alcanzable
                    ? <>Se logra con {resultadoOptimo.mejor.n} unidad(es) a {fx(pctFromDeg(resultadoOptimo.mejor.gamma), 1)}% ({fx(resultadoOptimo.mejor.gamma, 2)}°) cada una{resultadoOptimo.considerarAjusteEmbalse && ajusteEmbalse > 0 ? <>, considerando el ajuste de caudal del embalse ({fx(ajusteEmbalse, 1)} m³/s adicionales, campo ya actualizado)</> : ""}.</>
                    : <>No se alcanza el objetivo completo con las condiciones dadas — se entrega el máximo posible: {fx(resultadoOptimo.mejor.PtotalBornes ?? resultadoOptimo.mejor.Ptotal, 1)} MW totales en bornes ({fx(resultadoOptimo.mejor.Ptotal, 1)} MW en el eje) con {resultadoOptimo.mejor.n} unidad(es).
                      {resultadoOptimo.necesitariaEmbalseParaObjetivo > 0 && <> Para completar el objetivo haría falta tomar {fx(resultadoOptimo.necesitariaEmbalseParaObjetivo, 1)} m³/s adicionales del embalse — no aplicados; activa "Considerar ajuste de caudal del embalse" arriba para incluirlos.</>}
                      {resultadoOptimo.necesitariaEmbalseParaObjetivo === 0 && <> El objetivo excede lo que el rango mecánico y/o los 307 MW garantizados por unidad permiten con las unidades disponibles, incluso con agua de sobra.</>}
                    </>}
                </div>
              )}
              {resultadoOptimo.esAutomatico && (
                <div style={{ marginTop: 8, fontSize: 12, color: T.ink, fontFamily: FONT_BODY, lineHeight: 1.5 }}>
                  🤖 Modo elegido automáticamente: <b>{resultadoOptimo.modoElegido === "potencia" ? "máxima potencia (307 MW)" : resultadoOptimo.modoElegido === "eficiencia" ? "pico de eficiencia" : resultadoOptimo.modoElegido === "personalizado" ? "% operativo personalizado por unidad" : "reparto equitativo (agua limitada)"}</b>, porque
                  {resultadoOptimo.modoElegido === "potencia" && " el caudal de entrada alcanza incluso para llevar todas las unidades hasta el techo de potencia — no tiene sentido quedarse en el pico de eficiencia y verter el resto."}
                  {resultadoOptimo.modoElegido === "eficiencia" && " el caudal de entrada alcanza para el pico de eficiencia, pero no para más — llevarlas más allá solo sacrificaría eficiencia sin que sobre agua que se estuviera desperdiciando."}
                  {resultadoOptimo.modoElegido === "personalizado" && " tienes activo el % operativo personalizado por unidad — cada unidad opera en el punto que le corresponde según su propio %, sin buscar un óptimo compartido."}
                  {resultadoOptimo.modoElegido === "limitada" && ` el caudal de entrada no alcanza ni siquiera para el pico de eficiencia de todas las unidades — se reparte en partes iguales, igual que en "Buscar punto óptimo".`}
                </div>
              )}
            </div>
            {excedenteVertedero && excedenteVertedero.almacenaEnEmbalse && (
              <div style={{ padding: "10px 12px", background: T.panelSoft, border: `1px solid ${T.teal}`, borderRadius: 6, marginBottom: 10 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: T.teal, fontFamily: FONT_BODY, marginBottom: 4 }}>
                  💧 Caudal excedente: {fx(excedenteVertedero.excedente, 1)} m³/s — se almacena en el embalse
                </div>
                <div style={{ fontSize: 12, color: T.inkMuted, fontFamily: FONT_BODY, lineHeight: 1.55 }}>
                  El ajuste de caudal del embalse está APAGADO — el análisis no toma agua del embalse, pero tampoco descarta la que no se turbina: ese excedente ({fx(excedenteVertedero.excedente, 1)} m³/s) se queda en el embalse y el nivel sube ligeramente, igual que un "ajuste negativo" (guardar caudal). No se modela pasando por el vertedero — eso solo aplica cuando las unidades no pueden aprovechar más agua ni con el ajuste de embalse encendido. Si esta agua debe descargarse en vez de almacenarse (por ejemplo, en crecientes con el embalse cerca del NAMO), enciende el ajuste de embalse.
                </div>
              </div>
            )}
            {excedenteVertedero && !excedenteVertedero.almacenaEnEmbalse && (
              <div style={{ padding: "10px 12px", background: T.panelSoft, border: `1px solid ${T.amber}`, borderRadius: 6, marginBottom: 10 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: T.amber, fontFamily: FONT_BODY, marginBottom: 4 }}>
                  ⚠ Caudal excedente al vertedero: {fx(excedenteVertedero.excedente, 1)} m³/s
                </div>
                <div style={{ fontSize: 12, color: T.inkMuted, fontFamily: FONT_BODY, lineHeight: 1.55 }}>
                  {resultadoOptimo.esGarantizarPotencia
                    ? "Las unidades ya están operando en el punto que entrega la potencia objetivo (o el máximo posible) — no necesitan turbinar más agua para ese objetivo."
                    : `Las unidades ya están operando a su punto de mayor eficiencia posible a este nivel (limitado por ${resultadoOptimo.mejor.limitadoPorPotencia ? "la potencia máxima de 307 MW" : "el rango mecánico del distribuidor"}) — no pueden aprovechar más agua aunque esté disponible, ni siquiera con el ajuste de caudal del embalse encendido.`} Lo que sobra se descarga por el vertedero.
                  Canal: <b style={{ color: T.ink }}>{excedenteVertedero.canal}</b>
                  {" "}· Apertura: [{excedenteVertedero.aperturas.map((a) => fx(a, 2)).join(", ")}] m (C1, C2, C3, C4)
                  {" "}· Caudal logrado por el vertedero con esa apertura: {fx(excedenteVertedero.qLogrado, 1)} m³/s.
                  {Math.abs(excedenteVertedero.qLogrado - excedenteVertedero.excedente) > 1 && " El vertedero no alcanza a evacuar exactamente el excedente con las reglas de canal vigentes — ver nota de umbral mínimo operativo (150 m³/s) si el excedente es muy pequeño."}
                </div>
              </div>
            )}
            {resultadoOptimo.todas.length > 0 && !resultadoOptimo.todas.some((o) => o.gamma == null) && (
            <div style={{ fontSize: 12, color: T.inkFaint, fontFamily: FONT_BODY }}>
              Comparación de las {resultadoOptimo.todas.length} opciones evaluadas:{" "}
              {resultadoOptimo.todas.map((o, i) => (
                <span key={o.n}>{i > 0 && " · "}<b style={{ color: o.n === resultadoOptimo.mejor.n ? T.teal : T.inkFaint }}>{o.n}u</b>: {fx(pctFromDeg(o.gamma), 0)}% ({fx(o.gamma, 1)}°) η={fx(o.eta, 2)}%{!o.alcanzable && "†"}</span>
              ))}
              {resultadoOptimo.todas.some((o) => !o.alcanzable) && " · † no alcanza el caudal por unidad exacto (rango mecánico o límite de 307 MW)."}
            </div>
            )}
            <div style={{ fontSize: 11.5, color: T.inkFaint, fontFamily: FONT_BODY, marginTop: 8 }}>
              Este resultado es independiente de "Colina de la turbina — exploración y simulación" (abajo) — no traslada γ ni unidades activas allá. El nivel del embalse sí es el mismo campo en ambos módulos.
            </div>
          </div>
        )}
      </div>
      </>)}

      {tab === "despacho" && (<>
      <Proposito T={T} id="despacho" titulo="Despacho intradiario" fuente="Modelo de la colina + curvas cota-volumen; datos en vivo del relay y HydroForecast" para="Proyectar el nivel del embalse hora a hora con el despacho de XM, la generación real (RT) o el programa plano, y revisar la regla operativa del día." logras="Saber, antes de que termine el día, si el programa deja el embalse donde se quiere y si el promedio regulado queda dentro de la banda de la Res. 1891." resultados="Nivel a las 24 h con bandas de sensibilidad, estado de cada hora (XM frente a RT), caudal regulado por hora y su promedio frente a la banda, apertura del distribuidor por hora (programa y, hoy, la estimada de cada unidad, en % y grados), tabla horaria y CSV. El nivel de las 00:00, el Q de ayer, el caudal de entrada y las horas ya cerradas se llenan con los datos en vivo; el despacho de XM se pega." />
      <div style={cardStyle}>
        <PanelDespachoIntradiario T={T} condDescarga={condDescarga} gammaMax={gammaMecanicoDeRango(rangoOptimo)} etiquetaTecho={etiquetaRango(rangoOptimo)} />
      </div>
      </>)}

      {tab === "operacion" && (<>
        <Proposito T={T} id="operacion" titulo="Operación medida" fuente="LoggerNet (relay al repositorio privado, o un archivo .dat / CSV local)" para="Revisar, minuto a minuto, la generación y el caudal medidos frente al modelo de la colina, y validar el factor de conversión de Hidrometría." logras="Confirmar que los números de Hidrometría salen bien y medir cuánto se separa el modelo de lo operado, por unidad." resultados="Volúmenes por unidad (Hidrometría, Winter-Kennedy relativo y modelo), regla diaria, verificación de la columna de LoggerNet, apertura del distribuidor estimada por unidad (en % y grados), gráficos interactivos y CSV." />
        <div style={cardStyle}>
          <OperacionMedida T={T} condDescarga={condDescarga} />
        </div>
      </>)}

      {tab === "colina" && (<>
      <Proposito T={T} id="colina" titulo="Colina de la turbina" fuente="Ensayo de modelo físico (2013), transposición IEC 60193; ampliación de rango 2023" para="Explorar el diagrama colinar del prototipo: para un nivel del embalse y una apertura, qué caudal, potencia y eficiencia da la turbina." logras="Entender dónde opera cada máquina y qué tan lejos está de su mejor punto. La colina es la misma para las ocho unidades; las diferencias medidas entre máquinas están en Analítica → Unidades." resultados="Familias de curvas por apertura, isolíneas de eficiencia, punto de operación y los escenarios documentados de 2023." />
      <div style={cardStyle}>
        <ChartHeader titulo="Colina de la turbina — exploración y simulación" subtitulo="Ensayo de modelo físico (2013), transpuesto al prototipo según IEC 60193. Punto de máxima eficiencia del ensayo (BEP): H = 198,29 m, Q = 146,67 m³/s, P = 273,41 MW, γ = 21,5°, η = 96,48 %." T={T}
          tip="Reproduce las familias de curvas de apertura constante (γ), las isolíneas de eficiencia (trazadas por marching squares sobre una malla interpolada de la colina — eficiencia de MODELO en los gráficos n₁₁, de PROTOTIPO con step-up IEC 60193 en los de escala real) y los 6 puntos WAE reales. No incluye los polígonos de área de operación (sin coordenadas en los datos extraídos)." />
        <div className="itu-2col" style={{ marginTop: 10 }}>
          <div>
            <Slider label="Apertura del distribuidor (%)" value={pctFromDeg(gamma)} min={pctFromDeg(GAMMAS_HILL[0])} max={pctFromDeg(GAMMA_ENSAYADO_MAX)} step={0.1}
              onChange={(p) => setGamma(degFromPct(p))} unit="%" T={T}
              tip={`Apertura de los álabes directrices, en % (100% = 30.2° = límite ampliado y garantizado por GE/EPM en 2023). Rango ensayado en el modelo físico: ${fx(pctFromDeg(GAMMAS_HILL[0]), 0)}%-${fx(pctFromDeg(GAMMA_ENSAYADO_MAX), 0)}%. Límite mecánico original: ${fx(pctFromDeg(GAMMA_ORIGINAL_MAX), 0)}%. Operación normal recomendada: hasta 97% (el ${MARGEN_FRECUENCIA_PCT}% restante hasta 100% se reserva para respuesta a frecuencia). Por encima de 100% (hasta el máximo ensayado, ~${fx(pctFromDeg(GAMMA_ENSAYADO_MAX), 0)}%) solo está disponible para exploración/investigación — no es un rango habilitado para operación continua.`} />
            <div style={{ fontSize: 11, color: T.inkFaint, fontFamily: FONT_BODY, marginTop: -10, marginBottom: 8 }}>
              {fx(pctFromDeg(gamma), 1)} % ≈ {fx(gamma, 2)}° (100 % = 30,2°)
            </div>
            {gamma > GAMMA_NORMAL_MAX && gamma <= GAMMA_AMPLIADO_MAX && (
              <div style={{
                marginBottom: 10, padding: "6px 10px", borderRadius: 5, fontSize: 11.5, fontFamily: FONT_BODY,
                background: "rgba(212,120,45,0.08)", border: `1px solid ${T.amber}`, color: T.amber, fontWeight: 600,
              }}>
                ⚠ {fx(pctFromDeg(gamma), 1)}% está dentro de la reserva del {MARGEN_FRECUENCIA_PCT}% (97%-100%) destinada a respuesta de frecuencia del sistema eléctrico colombiano — no es operación normal.
              </div>
            )}
            {gamma > GAMMA_AMPLIADO_MAX && (
              <div style={{
                marginBottom: 10, padding: "6px 10px", borderRadius: 5, fontSize: 11.5, fontFamily: FONT_BODY,
                background: "rgba(212,120,45,0.12)", border: `1px solid ${T.amber}`, color: T.amber, fontWeight: 600,
              }}>
                ⚠ {fx(pctFromDeg(gamma), 1)}% ({fx(gamma, 2)}°) está fuera de la operación garantizada (por encima del 100% = 30.2°, el límite ampliado habilitado en 2023). Válido solo para exploración del rango ensayado en el modelo físico, hasta ~106% (31.98°).
              </div>
            )}
          </div>
          <div>
            <Slider label="Salto neto (H)" value={Hsel} min={50} max={340} step={0.5} onChange={alEditarSaltoNeto} unit=" m" T={T}
              tip="Salto neto del prototipo. Se calcula automáticamente a partir del Nivel del embalse (y viceversa si lo editas aquí directamente) — ambos campos quedan siempre acoplados." />
          </div>
        </div>
        <div className="itu-2col" style={{ marginTop: 4, marginBottom: 4 }}>
          <div>
            <Slider label="Nivel del embalse" value={nivelEmbalseExploracion} min={NIVEL_MIN_TEC} max={permitirSobreNAMO ? NAME : NAMO} step={0.01} onChange={alEditarNivelEmbalse} unit=" msnm" T={T}
              tip={`Nivel del embalse. Rango normal de operación: ${NIVEL_MIN_TEC}-${NAMO} msnm (NAMO). Determina el salto neto vía: H_neta = Nivel_embalse − Nivel_almenara − pérdida de carga (h=k·Q²). El nivel de la almenara sale de la "Condición de descarga" elegida arriba (diseño, río colmatado ASE o manual). La colina reproduce los escenarios GE 2023 con error <0.15% cuando se usa la almenara de cada escenario. A nivel del embalse más alto, para la MISMA potencia se necesita menor apertura y menor caudal por unidad (a mayor salto, se logra la misma potencia con menos agua) — es física esperada, no un error.`} />
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 11.5, color: T.inkFaint, fontFamily: FONT_BODY, cursor: "pointer" }}>
              <input type="checkbox" checked={permitirSobreNAMO} onChange={(e) => { setPermitirSobreNAMO(e.target.checked); if (!e.target.checked && nivelEmbalseExploracion > NAMO) alEditarNivelEmbalse(NAMO); }} />
              Permitir explorar sobre NAMO ({NAMO} msnm) — gestión de creciente
            </label>
          </div>
          <div>
            <Etiqueta T={T} tip="Cuántas unidades generan a la vez, todas con la misma apertura. Las 4 primeras (U1-U4) descargan en la almenara N°1; de la 5 a la 8 (U5-U8, desde inicios de 2028) en la N°2. El nivel de cada almenara depende solo de sus propias unidades. No cambia el número de unidades del Buscador de arriba.">Unidades activas</Etiqueta>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {Array.from({ length: N_TURBINAS_MAX }, (_, i) => i + 1).map((n) => (
                <button key={n} onClick={() => setNTurbActivasExploracion(n)} style={{
                  flex: "1 1 40px", padding: "8px 6px", fontSize: 12.5, fontFamily: FONT_BODY, fontWeight: 600,
                  border: `1px solid ${nTurbActivasExploracion === n ? T.teal : T.line}`, borderRadius: 4, cursor: "pointer",
                  background: nTurbActivasExploracion === n ? T.panelSoft : "transparent", color: nTurbActivasExploracion === n ? T.teal : T.inkMuted,
                }}>{n}</button>
              ))}
            </div>
          </div>
        </div>
        {nivelEmbalseExploracion > NAMO && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10, padding: "9px 12px", background: T.panelSoft, border: `1px solid ${T.amber}`, borderRadius: 6, fontSize: 12.5, color: T.amber, fontFamily: FONT_BODY, lineHeight: 1.5 }}>
            <span>⚠</span>
            <span>Nivel del embalse ({fx(nivelEmbalseExploracion, 2)} msnm) por encima del NAMO ({NAMO} msnm) — fuera del rango normal de operación de las unidades. Esto es válido para gestionar una creciente (el embalse puede subir hasta el NAME, {NAME} msnm), pero no representa la operación normal esperada del proyecto.</span>
          </div>
        )}
        {avisoNivelExploracion && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "9px 12px", background: T.panelSoft, border: `1px solid ${T.amber}`, borderRadius: 6, marginBottom: 10, fontSize: 12, color: T.inkMuted, fontFamily: FONT_BODY, lineHeight: 1.5 }}>
            <span style={{ color: T.amber }}>⚠</span>
            <span>{avisoNivelExploracion}</span>
          </div>
        )}
        <div className="itu-4col" style={{ marginTop: 4 }}>
          {[
            ["Caudal", puntoActual ? fx(puntoActual.Q, 1) : "—", "m³/s"],
            ["Potencia", puntoActual ? fx(puntoActual.P, 1) : "—", "MW"],
            ["Eficiencia", puntoActual ? fx(puntoActual.eta, 2) : "—", "%"],
            ["n₁₁", puntoActual ? fx(puntoActual.n11, 2) : "—", "rpm"],
          ].map(([lbl, val, unit], i) => (
            <div key={i}>
              <Etiqueta T={T}>{lbl}</Etiqueta>
              <div style={{ fontFamily: FONT_BODY, fontSize: 20, fontWeight: 800, color: T.teal }}>{val}<span style={{ fontSize: 12, fontWeight: 500, color: T.inkFaint }}> {unit}</span></div>
            </div>
          ))}
        </div>
        {detalleSaltoExploracion && (
          <div style={{ marginTop: 8, fontSize: 12, color: T.inkMuted, fontFamily: FONT_BODY, lineHeight: 1.5 }}>
            Condición: {etiquetaCondicionDescarga(condDescarga)}.
            {ZONAS.filter((z) => detalleSaltoExploracion.porAlmenara && detalleSaltoExploracion.porAlmenara[z]).map((z) => {
              const g = detalleSaltoExploracion.porAlmenara[z];
              return (
                <div key={z}>
                  {NOMBRE_ALMENARA[z]}{g.unidades > 0 ? `, ${g.unidades} ud.` : " (sin unidades operando)"}: almenara {fx(g.nivelAlmenara, 2)} msnm · salto bruto {fx(g.saltoBruto, 2)} m · pérdida {fx(g.hLoss, 2)} m · salto neto {fx(g.saltoNeto, 2)} m
                  {detalleSaltoExploracion.dosAlmenaras && <> · {fx(g.Q, 1)} m³/s y {fx(g.P, 1)} MW por unidad</>}
                  {g.avisosAlmenara.length > 0 && <span style={{ color: T.amber }}> · ⚠ {g.avisosAlmenara.join("; ")}</span>}
                </div>
              );
            })}
            {detalleSaltoExploracion.dosAlmenaras && <div>Con unidades en las dos almenaras, la colina de arriba se muestra con el salto neto promedio ({fx(detalleSaltoExploracion.saltoNeto, 2)} m); el detalle por grupo es el de estas líneas.</div>}
          </div>
        )}
        {!puntoActual && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: T.amber, fontFamily: FONT_BODY }}>
            Combinación de γ y H fuera del rango cubierto por los 186 puntos ensayados — sin datos para interpolar con confianza.
          </div>
        )}
        {puntoActual && puntoActual.P > 0 && (
          <div style={{ marginTop: 6, fontSize: 12, color: T.inkMuted, fontFamily: FONT_BODY, lineHeight: 1.5 }}>
            {(() => {
              const pb = potenciaBornesDesdeEje(puntoActual.P);
              const fc = factorConversionHidrometria(nivelEmbalseExploracion);
              const qH = pb / fc;
              return <>Hidrometría reportaría este punto como {fx(qH, 1)} m³/s (potencia en bornes {fx(pb, 1)} MW / F.C. {fx(fc, 3)} a {fx(nivelEmbalseExploracion, 2)} msnm), frente a {fx(puntoActual.Q, 1)} m³/s del modelo ({fx((qH / puntoActual.Q - 1) * 100, 1)} %). Con el factor fijo anterior (1,62) serían {fx(pb / FACTOR_HIDROMETRIA_MW_POR_M3S, 1)} m³/s. En las unidades solo se mide la potencia.</>;
            })()}
          </div>
        )}
        {puntoActual && Math.max(puntoActual.P, detalleSaltoExploracion && detalleSaltoExploracion.Pmax ? detalleSaltoExploracion.Pmax : 0) > P_MAXIMO_ESPERADO_MW && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 10, padding: "9px 12px", background: T.panelSoft, border: `1px solid ${T.red}`, borderRadius: 6, fontSize: 12.5, color: T.red, fontFamily: FONT_BODY, lineHeight: 1.5 }}>
            <span>⚠</span>
            <span>La potencia de {detalleSaltoExploracion && detalleSaltoExploracion.dosAlmenaras ? "la unidad más cargada" : "esta unidad"} ({fx(Math.max(puntoActual.P, detalleSaltoExploracion && detalleSaltoExploracion.Pmax ? detalleSaltoExploracion.Pmax : 0), 1)} MW en el eje) supera la potencia máxima garantizada (307 MW, estudio de ampliación 2023). Este punto de la colina está fuera del rango garantizado de operación del proyecto, aunque exista en el ensayo físico.</span>
          </div>
        )}
      </div>

            <div style={{ margin: "26px 4px 4px", fontFamily: FONT_BODY }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>Semejanza hidráulica (variables reducidas)</div>
        <div style={{ fontSize: 12.5, color: T.inkFaint, marginTop: 2 }}>Curvas en n₁₁, Q₁₁, P₁₁ — la base de comparación entre el modelo ensayado y el prototipo real, según IEC 60193.</div>
      </div>

      <div style={cardStyle}>
        <ChartHeader titulo="Caudal por apertura constante — variables reducidas" subtitulo={`Análogo a la Figura 4.1 (n₁₁-Q₁₁). Cada línea es una apertura γ realmente ensayada; la resaltada es la más cercana a tu selección (${fx(pctFromDeg(gammaCercana), 1)} % = ${fx(gammaCercana, 2)}°). Aperturas ensayadas: ${GAMMAS_HILL.map((g) => `${fx(pctFromDeg(g), 1)} %`).join(", ")} (100 % = 30,2°).`} T={T}
          accion={<BotonCSV data={lineasPorGamma.flatMap((l) => l.puntos.map((p) => ({ apertura_pct: +pctFromDeg(l.gamma).toFixed(2), gamma_grados: l.gamma, ...p })))} filename="n11_q11.csv" T={T} />} />
        <ChartFamilia ejeX="n11" ejeY="Q11_m3s" xLabel="n₁₁ (rpm)" yLabel="Q₁₁ (m³/s)" xDomain={[n11min, n11max]} yDomain={[0, dominioY(2)[1] / 1000]} waeCampoX={0} waeCampoY={1} waeEscala={0.001} bepXY={[51.96, 0.63245]} grid={gridModeloQ} niveles={NIVELES_MODELO} puntoActualXY={puntoActual ? [puntoActual.n11, puntoActual.Q11 / 1000] : null} lineasPorGamma={lineasPorGamma} gammaCercana={gammaCercana} T={T} />
      </div>

      <div style={cardStyle}>
        <ChartHeader titulo="Potencia por apertura constante — variables reducidas" subtitulo="Análogo a la Figura 4.2 (n₁₁-P₁₁)." T={T}
          accion={<BotonCSV data={lineasPorGamma.flatMap((l) => l.puntos.map((p) => ({ apertura_pct: +pctFromDeg(l.gamma).toFixed(2), gamma_grados: l.gamma, ...p })))} filename="n11_p11.csv" T={T} />} />
        <ChartFamilia ejeX="n11" ejeY="P11_MW" xLabel="n₁₁ (rpm)" yLabel="P₁₁ (MW)" xDomain={[n11min, n11max]} yDomain={[0, dominioY(3)[1] / 1000]} waeCampoX={0} waeCampoY={2} waeEscala={0.001} bepXY={[51.96, 0.00595]} grid={gridModeloP} niveles={NIVELES_MODELO} puntoActualXY={puntoActual ? [puntoActual.n11, puntoActual.P11 / 1000] : null} lineasPorGamma={lineasPorGamma} gammaCercana={gammaCercana} T={T} />
      </div>

            <div style={{ margin: "30px 4px 4px", fontFamily: FONT_BODY }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>Prototipo (escala real)</div>
        <div style={{ fontSize: 12.5, color: T.inkFaint, marginTop: 2 }}>Caudal, potencia y eficiencia en unidades reales (m³/s, MW) para la turbina completa — incluye el nuevo diagrama de unidades requeridas según el nivel del embalse.</div>
      </div>

      <div style={cardStyle}>
        <ChartHeader titulo="Caudal por apertura constante — escala de prototipo" subtitulo="Análogo a la Figura 4.5 (H-proto vs. Q-proto)." T={T}
          accion={<BotonCSV data={lineasPorGamma.flatMap((l) => l.puntos.map((p) => ({ apertura_pct: +pctFromDeg(l.gamma).toFixed(2), gamma_grados: l.gamma, ...p })))} filename="H_Q_prototipo.csv" T={T} />} />
        <ChartFamilia ejeX="H" ejeY="Q" xLabel="H-proto (m)" yLabel="Q-proto (m³/s)" xDomain={[Hmin, Hmax]} yDomain={dominioY(6)} waeCampoX={5} waeCampoY={6} bepXY={[198.29, 146.67]} grid={gridProtoQ} niveles={NIVELES_PROTO} puntoActualXY={puntoActual ? [Hsel, puntoActual.Q] : null} lineasPorGamma={lineasPorGamma} gammaCercana={gammaCercana} T={T}
          puntosExtra={ESCENARIOS_2023_EPM_GE.map((e) => ({ x: e.saltoNeto_m, y: e.Q_m3s, label: e.id }))} />
      </div>

      <div style={cardStyle}>
        <ChartHeader titulo="Potencia por apertura constante — escala de prototipo" subtitulo="Análogo a la Figura 4.6 (H-proto vs. P-proto)." T={T}
          accion={<BotonCSV data={lineasPorGamma.flatMap((l) => l.puntos.map((p) => ({ apertura_pct: +pctFromDeg(l.gamma).toFixed(2), gamma_grados: l.gamma, ...p })))} filename="H_P_prototipo.csv" T={T} />} />
        <ChartFamilia ejeX="H" ejeY="P" xLabel="H-proto (m)" yLabel="P-proto (MW)" xDomain={[Hmin, Hmax]} yDomain={dominioY(7)} waeCampoX={5} waeCampoY={7} bepXY={[198.29, 273.41]} grid={gridProtoP} niveles={NIVELES_PROTO} puntoActualXY={puntoActual ? [Hsel, puntoActual.P] : null} lineasPorGamma={lineasPorGamma} gammaCercana={gammaCercana} T={T}
          puntosExtra={ESCENARIOS_2023_EPM_GE.map((e) => ({ x: e.saltoNeto_m, y: e.P_turbina_MW, label: e.id }))} />
      </div>
      </>)}

      {tab === "curvas" && (<>
      <Proposito T={T} id="curvas" titulo="Curvas y F.C." fuente="Modelo de la colina con la condición de descarga elegida" para="Ver cuánta agua y potencia caben según el nivel del embalse y cuántas unidades estén en línea, y comparar el F.C. del modelo con el de Hidrometría." logras="Saber la capacidad de la central a cada nivel y el número de unidades que se necesita para un caudal." resultados="Curvas de caudal máximo por número de unidades y F.C. frente al nivel (modelo y fórmula de Hidrometría)." />
      <div style={cardStyle}>
        <ChartHeader titulo="Unidades requeridas según el nivel del embalse" subtitulo={`Caudal turbinable máximo total (apertura máxima del rango, sin pasar de ${P_MAXIMO_ESPERADO_MW} MW por unidad), según cuántas unidades estén activas, en el rango de operación normal (${NIVEL_MIN_TEC}-${NAMO} msnm = NAMO). Rango de apertura: ${etiquetaRango(rangoOptimo)}.`} T={T}
          tip="Cada línea es la capacidad máxima con N unidades activas (a la apertura máxima del rango elegido), calculada con el mismo modelo de colina ya validado. Para un caudal objetivo, mira en qué línea (de abajo hacia arriba) se alcanza o supera ese valor a tu nivel de embalse — esa es la cantidad mínima de unidades necesaria."
          accion={<BotonCSV data={diagramaTurbinasVsNivel} filename="unidades_requeridas_vs_nivel.csv" T={T} />} />
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={diagramaTurbinasVsNivel} margin={{ top: 10, right: 20, left: 64, bottom: 10 }}>
            <CartesianGrid stroke={T.lineSoft} strokeDasharray="2 4" />
            <XAxis dataKey="H" type="number" domain={[NIVEL_MIN_TEC, NAMO]} tick={tickStyleFor(T)} tickFormatter={fmtTick} />
            <YAxis type="number" tick={tickStyleFor(T)} tickFormatter={fmtTick} label={{ value: "Caudal turbinable total (m³/s)", angle: -90, position: "left", offset: -2, style: { fontSize: 12.5, fontWeight: 600, fill: T.ink, fontFamily: FONT_BODY, textAnchor: "middle" } }} />
            <RTooltip content={<CustomTooltip unidad="m³/s" T={T} labelPrefix="Nivel = " labelSuffix=" msnm" />} />
            <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 11.5, fontFamily: FONT_BODY, paddingTop: 20 }} />
            {Array.from({ length: N_TURBINAS_MAX }, (_, i) => i + 1).map((n) => (
              <Line key={n} type="monotone" dataKey={`n${n}`} name={`${n} unidad(es)`} stroke={COLORES_GAMMA[(n - 1) % COLORES_GAMMA.length]} strokeWidth={n === nTurbActivasExploracion ? 3 : 1.4} dot={false} isAnimationActive={false} connectNulls />
            ))}
            <ReferenceLine x={nivelEmbalseExploracion <= NAMO ? nivelEmbalseExploracion : null} stroke={T.ink} strokeDasharray="4 3" label={{ value: "Tu nivel", fontSize: 10, fill: T.ink }} />
            {zoomBrush(T, "H")}
          </LineChart>
        </ResponsiveContainer>
        <div style={{ textAlign: "center", fontSize: 12.5, fontWeight: 600, color: T.ink, fontFamily: FONT_BODY, marginTop: 4 }}>Nivel del embalse (msnm)</div>
      </div>

      <div style={cardStyle}>
        <ChartHeader titulo="F.C. — Factor Potencia/Caudal vs. nivel del embalse" subtitulo={`F.C. = potencia en bornes / caudal turbinado (MW por m³/s), por unidad. Modelo a la apertura máxima del rango elegido (${etiquetaRango(rangoOptimo)}) con ${nTurbActivasExploracion} unidad(es) y la condición de descarga elegida; Hidrometría: 1,62 fijo hasta el 29-oct-2026 14:35 y desde entonces 0,0119·nivel − 3,178 (390-420 msnm; fuera de ese rango, 1,80).`} T={T}
          tip="A mayor nivel del embalse, mayor salto neto: con el mismo caudal se obtiene más potencia (F.C. más alto), o sea que para la misma potencia se necesita menos caudal. El F.C. del modelo depende también de la carga y del nivel de la almenara (caudal del río y unidades en servicio); el de Hidrometría solo del nivel. Con 2-3 unidades entre 200 y 290 MW por unidad y el río bajo, los dos coinciden dentro de ±2 % entre 400 y 420 msnm (±1 % cerca de 408-412 msnm). Con 4 unidades y el río alto, la almenara sube y la fórmula da un F.C. 2-4 % mayor que el modelo, es decir, reporta 2-4 % menos caudal."
          accion={<BotonCSV data={diagramaFC} filename="fc_vs_nivel_embalse.csv" T={T} />} />
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={diagramaFC} margin={{ top: 10, right: 20, left: 76, bottom: 10 }}>
            <CartesianGrid stroke={T.lineSoft} strokeDasharray="2 4" />
            <XAxis dataKey="H" type="number" domain={[NIVEL_MIN_TEC, NAMO]} tick={tickStyleFor(T)} tickFormatter={fmtTick} />
            <YAxis width={52} type="number" tick={tickStyleFor(T)} domain={["auto", "auto"]} tickFormatter={(v) => fx(v, 2)} label={axisLabel("F.C. (MW / (m³/s))", -90)} />
            <RTooltip content={<CustomTooltip unidad="MW/(m³/s)" T={T} labelPrefix="Nivel = " labelSuffix=" msnm" decimales={3} decimalesEtiqueta={2} />} />
            <Legend wrapperStyle={{ fontSize: 11.5, fontFamily: FONT_BODY, paddingTop: 14 }} />
            <Line type="monotone" dataKey="FC" name="Modelo (apertura máxima)" stroke={T.teal} strokeWidth={2.2} dot={false} isAnimationActive={false} connectNulls />
            <Line type="linear" dataKey="FC_hidrometria" name="Hidrometría desde 29-oct-2026" stroke={T.ink} strokeDasharray="6 3" strokeWidth={1.6} dot={false} isAnimationActive={false} />
            <Line type="linear" dataKey="FC_anterior" name="Hidrometría antes (1,62)" stroke={T.inkFaint} strokeDasharray="2 3" strokeWidth={1.4} dot={false} isAnimationActive={false} />
            {zoomBrush(T, "H")}
          </LineChart>
        </ResponsiveContainer>
        <div style={{ textAlign: "center", fontSize: 12.5, fontWeight: 600, color: T.ink, fontFamily: FONT_BODY, marginTop: 4 }}>Nivel del embalse (msnm)</div>
      </div>

      <div style={cardStyle}>
        <ChartHeader titulo="F.C. — Factor Potencia/Caudal vs. volumen útil" subtitulo="Mismo F.C., contra el volumen útil del embalse (0% = nivel mínimo técnico 390 msnm; 100% = NAMO 420 msnm)." T={T}
          tip="El volumen útil (%) es una forma habitual de expresar cuánta reserva operativa tiene el embalse, independiente de la geometría exacta cota-volumen."
          accion={<BotonCSV data={diagramaFC} filename="fc_vs_volumen_util.csv" T={T} />} />
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={diagramaFC} margin={{ top: 10, right: 20, left: 76, bottom: 10 }}>
            <CartesianGrid stroke={T.lineSoft} strokeDasharray="2 4" />
            <XAxis dataKey="volUtilPct" type="number" domain={[0, 100]} tick={tickStyleFor(T)} tickFormatter={fmtTick} />
            <YAxis width={52} type="number" tick={tickStyleFor(T)} domain={["auto", "auto"]} tickFormatter={(v) => fx(v, 2)} label={axisLabel("F.C. (MW / (m³/s))", -90)} />
            <RTooltip content={<CustomTooltip unidad="MW/(m³/s)" T={T} labelPrefix="Vol. útil = " labelSuffix=" %" decimales={3} />} />
            <Legend wrapperStyle={{ fontSize: 11.5, fontFamily: FONT_BODY, paddingTop: 14 }} />
            <Line type="monotone" dataKey="FC" name="Modelo (apertura máxima)" stroke={T.amber} strokeWidth={2.2} dot={false} isAnimationActive={false} connectNulls />
            <Line type="linear" dataKey="FC_hidrometria" name="Hidrometría desde 29-oct-2026" stroke={T.ink} strokeDasharray="6 3" strokeWidth={1.6} dot={false} isAnimationActive={false} />
            <Line type="linear" dataKey="FC_anterior" name="Hidrometría antes (1,62)" stroke={T.inkFaint} strokeDasharray="2 3" strokeWidth={1.4} dot={false} isAnimationActive={false} />
            {zoomBrush(T, "volUtilPct")}
          </LineChart>
        </ResponsiveContainer>
        <div style={{ textAlign: "center", fontSize: 12.5, fontWeight: 600, color: T.ink, fontFamily: FONT_BODY, marginTop: 4 }}>Volumen útil (%)</div>
      </div>

      <div style={cardStyle}>
        <ChartHeader titulo="Eficiencia vs. caudal a salto fijo" subtitulo="Análogo a las Figuras 4.3/4.7, para los tres saltos de referencia del informe (Hmin-Hnom-Hmax)." T={T}
          accion={<BotonCSV data={curvasEficiencia.flatMap((c) => c.puntos.filter((p) => p.eta >= 0).map((p) => ({ salto: c.label, ...p })))} filename="eficiencia_vs_caudal.csv" T={T} />} />
        <ResponsiveContainer width="100%" height={300}>
          <LineChart margin={{ top: 10, right: 24, left: 64, bottom: 36 }}>
            <CartesianGrid stroke={T.lineSoft} strokeDasharray="2 4" />
            <XAxis dataKey="Q" type="number" tick={tickStyleFor(T)} tickFormatter={fmtTick} label={axisLabel("Caudal (m³/s)")} />
            <YAxis dataKey="eta" type="number" domain={[0, 100]} tick={tickStyleFor(T)} tickFormatter={fmtTick} label={axisLabel("Eficiencia (%)", -90)} />
            <RTooltip content={<CustomTooltip unidad="%" T={T} labelPrefix="Q = " labelSuffix=" m³/s" />} />
            <Legend wrapperStyle={{ fontSize: 10.5, fontFamily: FONT_BODY , paddingTop: 14 }} />
            {curvasEficiencia.map((c) => (
              <Line key={c.H} data={c.puntos.filter((p) => p.eta >= 0)} dataKey="eta" name={c.label} stroke={c.color} strokeWidth={2} dot={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={cardStyle}>
        <ChartHeader titulo="Eficiencia vs. potencia a salto fijo" subtitulo="Análogo a las Figuras 4.4/4.8, para los tres saltos de referencia del informe." T={T}
          accion={<BotonCSV data={curvasEficiencia.flatMap((c) => c.puntos.filter((p) => p.eta >= 0).map((p) => ({ salto: c.label, ...p })))} filename="eficiencia_vs_potencia.csv" T={T} />} />
        <ResponsiveContainer width="100%" height={300}>
          <LineChart margin={{ top: 10, right: 24, left: 64, bottom: 36 }}>
            <CartesianGrid stroke={T.lineSoft} strokeDasharray="2 4" />
            <XAxis dataKey="P" type="number" tick={tickStyleFor(T)} tickFormatter={fmtTick} label={axisLabel("Potencia (MW)")} />
            <YAxis dataKey="eta" type="number" domain={[0, 100]} tick={tickStyleFor(T)} tickFormatter={fmtTick} label={axisLabel("Eficiencia (%)", -90)} />
            <RTooltip content={<CustomTooltip unidad="%" T={T} labelPrefix="P = " labelSuffix=" MW" />} />
            <Legend wrapperStyle={{ fontSize: 10.5, fontFamily: FONT_BODY , paddingTop: 14 }} />
            {curvasEficiencia.map((c) => (
              <Line key={c.H} data={c.puntos.filter((p) => p.eta >= 0)} dataKey="eta" name={c.label} stroke={c.color} strokeWidth={2} dot={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      </>)}

      {tab === "referencia" && (<>
      <Proposito T={T} id="referencia" titulo="Referencia" fuente="Estudio de ampliación de GE (2023)" para="Consultar los escenarios del estudio de ampliación 2023 y cómo los reproduce el modelo." logras="Tener a mano la referencia oficial de potencia, caudal y apertura para validar el modelo." resultados="Tabla de escenarios y comparación con el modelo." />
      <div style={{ margin: "30px 4px 4px", fontFamily: FONT_BODY }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>Escenarios reales documentados</div>
        <div style={{ fontSize: 12.5, color: T.inkFaint, marginTop: 2 }}>Puntos de operación real evaluados por GE/EPM (estudio de ampliación 2023) — no proyecciones del modelo, datos tomados directamente de los documentos.</div>
      </div>

      <div style={cardStyle}>
        <ChartHeader titulo="Estudio de ampliación 2023" subtitulo="Los puntos morados (◆) en las gráficas de arriba son estos 6 escenarios reales, no proyecciones mías." T={T}
          tip="Estudio de ampliación de GE (2023): extiende el límite mecánico del distribuidor de 26.5° (87,7 %) a 30.2° (100 %) (carrera del servomotor de 390 a 433 mm). Numeral 3.1.1 (2 escenarios, 1 unidad, evaluación exploratoria — NO garantizados) y (4 escenarios, condición de potencias en generador/subestación). Todos los valores de esta tarjeta están tomados directamente del documento, no calculados por mi modelo (aunque mi modelo los reproduce con error <0.15% en Q y P — ver validación)." />
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, fontFamily: FONT_BODY }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.line}` }}>
                {["", "Caudal", "Salto neto", "Apertura (% · γ)", "P. turbina", "P. bornes generador", "P. subestación"].map((h, i) => (
                  <th key={i} style={{ textAlign: i === 0 ? "left" : "right", padding: "6px 8px", color: T.inkFaint, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ESCENARIOS_2023_EPM_GE.map((e) => (
                <tr key={e.id} style={{ borderBottom: `1px solid ${T.lineSoft}` }}>
                  <td style={{ padding: "6px 8px", color: T.ink, fontWeight: 700 }}>
                    {e.id}{e.garantizado === false && <span style={{ color: T.red, fontWeight: 700 }}> ✗</span>}
                    <div style={{ fontWeight: 400, color: T.inkFaint, fontSize: 11 }}>{e.descripcion}</div>
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: T.ink }}>{fxa(e.Q_m3s)} m³/s</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: T.ink }}>{fxa(e.saltoNeto_m)} m</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: T.ink }}>{fx(pctFromDeg(e.gamma_deg), 1)} %<div style={{ color: T.inkFaint, fontSize: 10.5 }}>{fxa(e.gamma_deg)}°</div></td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: e.P_turbina_MW > P_MAXIMO_ESPERADO_MW ? T.red : T.ink, fontWeight: e.P_turbina_MW > P_MAXIMO_ESPERADO_MW ? 700 : 400 }}>{fxa(e.P_turbina_MW)} MW</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: T.ink }}>{fxa(e.P_bornes_generador_MW)} MW <span style={{ color: T.inkMuted, fontSize: 10.5 }}>(η = {fxa(e.eta_generador_pct)} %)</span></td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: T.teal, fontWeight: 700 }}>
                    {e.P_subestacion_MW != null ? `${fxa(e.P_subestacion_MW)} MW` : <span style={{ color: T.inkFaint, fontWeight: 400 }}>— (solo 1 unidad, sin subestación)</span>}
                    {e.eta_transformador_pct != null && <span style={{ color: T.inkFaint, fontSize: 10.5, fontWeight: 400 }}> (η transformador = {fxa(e.eta_transformador_pct)} %)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 12, color: T.inkMuted, marginTop: 10, fontFamily: FONT_BODY, lineHeight: 1.5 }}>
          ✗ = nota 4 del documento: estas condiciones NO se consideran dentro del rango de operación garantizado del proyecto (son una evaluación exploratoria, no una garantía contractual).
          En los escenarios de 4 unidades, la potencia en bornes/transformador/subestación es el <b>total de las 4 unidades</b>; la potencia turbina mostrada es <b>por unidad</b>.
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 10, padding: "9px 12px", background: T.panelSoft, border: `1px solid ${T.red}`, borderRadius: 6, fontSize: 12, color: T.red, fontFamily: FONT_BODY, lineHeight: 1.5 }}>
          <span>⚠</span>
          <span>{NOTA_LIMITE_GARANTIZADO}</span>
        </div>
        <div style={{ height: 1, background: T.line, margin: "14px 0" }} />
        <div style={{ fontSize: 12.5, color: T.ink, fontWeight: 700, marginBottom: 6, fontFamily: FONT_BODY }}>Modificación mecánica que habilita el rango ampliado</div>
        <div style={{ fontSize: 12, color: T.inkMuted, fontFamily: FONT_BODY, lineHeight: 1.6 }}>
          Apertura máxima del distribuidor: {SERVOMOTOR_2023.aperturaOriginal_deg}° ({fx(pctFromDeg(SERVOMOTOR_2023.aperturaOriginal_deg), 1)} %) → {SERVOMOTOR_2023.aperturaModificada_deg}° ({fx(pctFromDeg(SERVOMOTOR_2023.aperturaModificada_deg), 1)} %) (incremento de {SERVOMOTOR_2023.incrementoApertura_deg}° = {fx(pctFromDeg(SERVOMOTOR_2023.incrementoApertura_deg), 1)} puntos de %).
          Carrera del servomotor: {SERVOMOTOR_2023.carreraOriginal_mm} mm → {SERVOMOTOR_2023.carreraModificada_mm} mm (incremento de {SERVOMOTOR_2023.incrementoCarrera_mm} mm).
          Fuente: {SERVOMOTOR_2023.fuente}.
        </div>
      </div>

      <div style={{ fontSize: 12, color: T.inkFaint, lineHeight: 1.65, fontFamily: FONT_BODY, marginBottom: 30 }}>
        Fuente: ensayo de modelo físico (2013), transpuesto al prototipo según IEC 60193
        (N=180 rpm, D=4.05972 m — existe una discrepancia documentada con 4.0584 m en los pies de las Figuras 4.3/4.4).
        186 puntos de la tabla final de transposición, 12 aperturas ensayadas (4.87°-31.98°, es decir {fx(pctFromDeg(GAMMAS_HILL[0]), 1)} %-{fx(pctFromDeg(GAMMA_ENSAYADO_MAX), 1)} %), 6 puntos WAE
        (círculos ámbar) con sus pesos porcentuales de la Tabla 4.1. Punto resaltado en negro: tu selección actual
        de γ y H. Isolíneas de eficiencia (verde) trazadas con marching squares sobre una malla de 60×60 nodos,
        interpolada con el mismo método PCHIP (en el BEP publicado el modelo da Q −0,4 %, P −0,5 % y η −0,10 pp) — usan la eficiencia MEDIDA
        del modelo (sin step-up, máx. ~94.7%) en los gráficos n₁₁, y la eficiencia de PROTOTIPO (con la corrección
        de escala por Reynolds de IEC 60193, máx. 96.48%) en los de escala real, igual que en las figuras originales.
        <b> No incluye</b> los polígonos de área de operación continua/temporal — no hay coordenadas numéricas de
        esos polígonos en la extracción disponible, y no se aproximaron a ojo para evitar inventar información.
      </div>

      <div style={cardStyle}>
        <ChartHeader titulo="Glosario de siglas y parámetros" subtitulo="Términos usados en las gráficas y tarjetas de este módulo." T={T} />
        <div className="itu-2col" style={{ gap: "4px 24px", fontSize: 12.5, fontFamily: FONT_BODY, color: T.inkMuted, lineHeight: 1.6 }}>
          {[
            ["γ (gamma)", "Apertura del distribuidor / álabes directrices. El modelo físico y las curvas de la colina están en grados; la interfaz la muestra en % (100% = 30.2°, el límite ampliado garantizado por GE/EPM en 2023) porque es más fácil de visualizar en operación."],
            ["H", "Salto neto: diferencia de nivel entre el embalse y la almenara, menos la pérdida de carga."],
            ["n₁₁", "Velocidad unitaria reducida: n·D/√H — permite comparar el modelo ensayado con el prototipo."],
            ["Q₁₁, P₁₁", "Caudal y potencia unitarios reducidos: Q/(D²√H), P/(D²·H^1.5)."],
            ["Q-proto, P-proto", "Caudal y potencia reales del prototipo (turbina completa), en m³/s y MW."],
            ["η (eta)", "Eficiencia de la turbina, en %."],
            ["BEP", "Best Efficiency Point — punto de máxima eficiencia del ensayo."],
            ["WAE", "Weighted Average Efficiency — puntos de eficiencia ponderada de la Tabla 4.1 del informe."],
            ["Amax(H) / Apertura Máxima", "Umbral de apertura que separa flujo a presión (por debajo) de flujo libre (por encima), para un nivel H dado."],
            ["FP / FL", "Flujo a Presión (orificio sumergido) / Flujo Libre (por encima de Amax(H))."],
            ["NAMO", "Nivel de Aguas Máximas Normales — 420 msnm, techo normal de operación."],
            ["NAME", "Nivel de Aguas Máximas Extraordinarias — 432.5 msnm, máximo absoluto para gestión de creciente."],
            ["F.C.", "Factor Potencia/Caudal: Potencia / Caudal turbinado, en MW por m³/s."],
            ["Volumen útil (%)", "Volumen almacenado entre el nivel mínimo técnico (390 msnm) y el nivel actual, como % del volumen útil total (390-420 msnm)."],
            ["D, N", "Diámetro del rodete (m) y velocidad de rotación (rpm) del prototipo."],
            ["k (pérdida de carga)", "Coeficiente de la fórmula h_pérdida = k·Q², documento de ampliación 2023."],
          ].map(([term, def], i) => (
            <div key={i}><b style={{ color: T.ink }}>{term}:</b> {def}</div>
          ))}
        </div>
      </div>
      </>)}

    </div>

  );
}

/* ============================================================
   APP — CURVAS CARACTERÍSTICAS TURBINAS (DIAGRAMA COLINAR)
   Módulo independiente: solo el shell (tema, contraste, encabezado)
   alrededor de ColinaModulo, que ya trae toda su propia lógica.
   ============================================================ */

/* Estructura de la app: tres grupos de módulos.
   - Operación en vivo: decisiones en caliente con los datos del relay y HydroForecast.
   - Analítica y consulta: histórico, cumplimiento y comportamiento de las máquinas.
   - Ingeniería de la máquina: el modelo (colina, curvas, almenaras, referencia). */
const GRUPOS = [
  { k: "vivo", nombre: "Operación en vivo", tabs: [["tablero", "Tablero"], ["despacho", "Despacho"], ["buscador", "Buscador"], ["vertedero", "Vertedero"]] },
  { k: "analitica", nombre: "Analítica", tabs: [["regla", "Regla 1891 y ANLA"], ["unidades", "Unidades"], ["hidrologia", "Hidrología y pronóstico"], ["operacion", "Operación medida"], ["confiabilidad", "Validación"]] },
  { k: "ingenieria", nombre: "Ingeniería", tabs: [["colina", "Colina"], ["curvas", "Curvas y F.C."], ["descarga", "Descarga"], ["referencia", "Referencia"]] },
];
const PESTANAS = [...GRUPOS.flatMap((g) => g.tabs), ["datos", "Conexión de datos"]];
const MODULO_COLINA = new Set(["buscador", "despacho", "operacion", "colina", "curvas", "descarga", "referencia"]);
const leerPref = (k, def) => { try { return localStorage.getItem(k) || def; } catch { return def; } };
const guardarPref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
const pestanaDeHash = () => {
  const h = (typeof location !== "undefined" ? location.hash : "").replace(/^#/, "");
  return PESTANAS.some(([k]) => k === h) ? h : "tablero";
};

export default function ItuangoColinaTurbina() {
  return (
    <ProveedorDatos>
      <ProveedorVivo>
        <Aplicacion />
      </ProveedorVivo>
    </ProveedorDatos>
  );
}

function Aplicacion() {
  const [theme, setTheme] = useState(() => leerPref("ituango-turbinas-tema", "dark"));
  const [altoContraste, setAltoContraste] = useState(() => leerPref("ituango-turbinas-contraste", "0") === "1");
  const [tab, setTab] = useState(pestanaDeHash);
  const [condDescarga, setCondDescarga] = useState(CONDICION_DESCARGA_DEFECTO);
  const datos = useDatos();
  const { vivo, cargando: cargandoVivo, error: errorVivo } = useVivo();
  const T = aplicarAltoContraste(THEMES[theme], theme, altoContraste);
  useEffect(() => { guardarPref("ituango-turbinas-tema", theme); }, [theme]);
  useEffect(() => { guardarPref("ituango-turbinas-contraste", altoContraste ? "1" : "0"); }, [altoContraste]);
  useEffect(() => {
    const alCambiar = () => { setTab(pestanaDeHash()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", alCambiar);
    return () => window.removeEventListener("hashchange", alCambiar);
  }, []);
  useEffect(() => {
    const nombre = PESTANAS.find(([k]) => k === tab)?.[1];
    document.title = `${nombre} · Turbinas Ituango`;
  }, [tab]);
  /* El caudal del río en D4' (condición ASE) se toma una vez del caudal total
     descargado actual, si el usuario no lo ha cambiado. */
  const [rioVivo, setRioVivo] = useState(false);
  useEffect(() => {
    if (rioVivo || !vivo || !vivo.actual || !Number.isFinite(vivo.actual.qDesc)) return;
    setCondDescarga((c) => (c === CONDICION_DESCARGA_DEFECTO ? { ...c, qRio: Math.round(vivo.actual.qDesc), origenQRio: "vivo" } : c));
    setRioVivo(true);
  }, [vivo, rioVivo]);
  const grupo = GRUPOS.find((g) => g.tabs.some(([k]) => k === tab)) || null;
  const edad = vivo && vivo.edadMin;
  const estadoDatos = !datos.conectado ? { c: T.amber, txt: "Sin datos de operación" } : edad == null ? (cargandoVivo && !vivo ? { c: T.inkFaint, txt: "Conectando…" } : { c: "#d03b3b", txt: errorVivo ? "Error de datos" : "Sin datos de hoy" }) : edad <= 90 ? { c: "#0ca30c", txt: `Datos ${vivo.ultima.t.slice(11)}` } : { c: "#d03b3b", txt: `Datos con ${Math.round(edad / 60)} h de atraso` };

  return (
    <div style={{ background: T.bg, color: T.ink, fontFamily: FONT_BODY, minHeight: "100vh" }}>
      <GlobalStyles T={T} theme={theme} altoContraste={altoContraste} />
      <header className="itu-top">
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "10px max(16px, env(safe-area-inset-left)) 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <a href="#tablero" style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, textDecoration: "none" }}>
              <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true" style={{ flexShrink: 0 }}>
                <rect width="32" height="32" rx="9" fill={T.teal} />
                <circle cx="16" cy="16" r="9" fill="none" stroke={T.onAccent} strokeWidth="2.2" />
                <path d="M16 7c3 3 3 6 0 9M25 16c-3 3-6 3-9 0M16 25c-3-3-3-6 0-9M7 16c3-3 6-3 9 0" fill="none" stroke={T.onAccent} strokeWidth="2" strokeLinecap="round" />
              </svg>
              <div style={{ minWidth: 0 }}>
                <h1 className="itu-h1" style={{ margin: 0, fontWeight: 700, color: T.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Turbinas Ituango</h1>
                <div className="itu-sub" style={{ fontSize: 12, color: T.inkMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Operación en vivo, analítica e ingeniería de las unidades</div>
              </div>
            </a>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
              <a className="itu-pill" href="#datos" title="Conexión a los datos de operación y antigüedad del último dato">
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: estadoDatos.c }} />
                <span className="lbl">{estadoDatos.txt}</span>
              </a>
              <a className="itu-pill" href="#descarga" title="Condición de descarga (nivel de las almenaras) que usan todos los cálculos">
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: condDescarga.modo === "ase" ? T.teal : T.amber }} />
                <span className="lbl">{condDescarga.modo === "ase" ? `Río ${Math.round(condDescarga.qRio)} m³/s` : condDescarga.modo === "manual" ? "Almenaras manual" : "Diseño"}</span>
              </a>
              <button className="itu-pill" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title={theme === "dark" ? "Tema claro" : "Tema oscuro"} aria-label="Cambiar tema">{theme === "dark" ? "☀" : "🌙"}</button>
              <button className="itu-pill" onClick={() => setAltoContraste((v) => !v)} title="Alto contraste" aria-pressed={altoContraste} style={altoContraste ? { borderColor: T.teal, color: T.teal } : undefined}>
                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M8 1.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" /></svg>
              </button>
            </div>
          </div>
          <nav aria-label="Secciones" style={{ marginTop: 8 }}>
            <div className="itu-grupos" role="tablist" aria-label="Grupos de módulos">
              {GRUPOS.map((g) => (
                <a key={g.k} href={`#${g.tabs[0][0]}`} role="tab" aria-selected={grupo && grupo.k === g.k} className={grupo && grupo.k === g.k ? "on" : ""}>{g.nombre}</a>
              ))}
            </div>
            <div className="itu-tabs">
              {(grupo || GRUPOS[0]).tabs.map(([k, nombre]) => (
                <a key={k} href={`#${k}`} aria-current={tab === k ? "page" : undefined}>{nombre}</a>
              ))}
            </div>
          </nav>
        </div>
      </header>

      <main style={{ maxWidth: 1240, margin: "0 auto", padding: "18px max(16px, env(safe-area-inset-left)) 40px" }}>
        {tab === "tablero" && <Tablero T={T} condDescarga={condDescarga} />}
        {tab === "vertedero" && <Vertedero T={T} />}
        {tab === "regla" && <ReglaAnla T={T} />}
        {tab === "unidades" && <Unidades T={T} />}
        {tab === "hidrologia" && <Hidrologia T={T} />}
        {tab === "confiabilidad" && <Confiabilidad T={T} />}
        {tab === "datos" && (
          <>
            <PanelConexion T={T} />
            <div style={{ fontSize: 13, color: T.inkMuted, lineHeight: 1.6, maxWidth: 820 }}>
              <p><b style={{ color: T.ink }}>De dónde salen los datos.</b> Un relay en un equipo de la red corporativa lee los archivos de LoggerNet de la estación del vertedero y los sube cada hora a un repositorio privado (un CSV por día). Un proceso automático en ese repositorio arma el histórico (regla operativa, vertedero, descargado, índices por unidad) y archiva HydroForecast. La app lee esos archivos con el token; nada se envía a otro lado.</p>
              {vivo && vivo.estadoProceso && <p>Histórico: {vivo.estadoProceso.dias} días desde {vivo.estadoProceso.primerDia}; último proceso {String(vivo.estadoProceso.generado).slice(0, 16).replace("T", " ")} UTC.</p>}
              {vivo && vivo.columnas && <p>Columnas del archivo de hoy: {vivo.columnas.length}. {vivo.columnas.some((c) => /^Open_Gate/i.test(c)) ? "Incluye compuertas (relay versión 2)." : "Sin columnas de compuertas: falta instalar la versión 2 del relay."}</p>}
            </div>
          </>
        )}
        {MODULO_COLINA.has(tab) && <ColinaModulo T={T} tab={tab} condDescarga={condDescarga} setCondDescarga={setCondDescarga} />}
        <footer style={{ marginTop: 24, fontSize: 12, color: T.inkFaint, lineHeight: 1.6 }}>
          Modelo de colina del ensayo de 2013 transpuesto al prototipo (IEC 60193), con datos del fabricante, de los estudios hidráulicos y de Hidrometría. Datos de operación: LoggerNet (vía relay) y HydroForecast Ituango. Resultados de apoyo a la operación: no reemplazan los procedimientos de EPM.
        </footer>
      </main>
    </div>
  );
}
