/* ============================================================
   Vertedero: lo medido por compuerta (relay v2) y la calculadora de
   aperturas con las fórmulas del Simulador de crecientes:
   Tabla 10.6 de calibración de la compuerta radial (flujo a presión)
   y Tabla 10.1 del tránsito CMP (flujo libre), con las reglas de
   canal del proyecto (izquierdo C1, derecho C2–C4).
   ============================================================ */
import { useCallback, useMemo, useState } from "react";
import { decidirCanalYAperturas, caudalVertederoDetallado, caudalCompuerta, aperturaMax, qLibreTotal, ZV, A_MAX_ESTRUCTURAL, C1_MIN_OPERATIVO, UMBRAL_CANAL_IZQ_MAX, UMBRAL_CANAL_DER_MAX, NIVEL_MIN_TEC, NAME } from "../modelo.js";
import { useVivo } from "../datos/vivo.jsx";
import { useDatos, useCargaPeriodica } from "../datos/fuentes.jsx";
import { GraficoSeries, Estado, fmtNum } from "./graficos.jsx";
import { Proposito, Tarjeta, Kpi } from "./comunes.jsx";

export default function Vertedero({ T }) {
  const { vivo } = useVivo();
  const d = useDatos();
  const meta = useCargaPeriodica(useCallback(async () => (d.conectado ? d.leerJSON("meta/generacion.json").catch(() => null) : null), [d]), [d], 0);
  const nivelVivo = vivo?.actual?.nivel ?? null;
  const [nivel, setNivel] = useState(null);
  const [qObj, setQObj] = useState(600);
  const H = nivel ?? nivelVivo ?? 418;
  const calc = useMemo(() => {
    const dec = decidirCanalYAperturas(H, qObj);
    const det = caudalVertederoDetallado(H, dec.aperturas);
    return { ...dec, det, amax: aperturaMax(H), qLibre: qLibreTotal(H) };
  }, [H, qObj]);
  const capacidad = useMemo(() => {
    const am = aperturaMax(H);
    return { amax: am, qPorCompuertaEnAmax: caudalCompuerta(H, am).q, qLibrePorCompuerta: qLibreTotal(H) / 4 };
  }, [H]);

  // Medido por compuerta (si el relay ya sube esas columnas)
  const unidadApertura = meta.datos?.columnas?.find((c) => /^Open_Gate1/i.test(c.nombre))?.unidad ?? null;
  const medido = useMemo(() => {
    const f = vivo?.filas;
    if (!f || !f.length || !f.some((r) => r.qComp || r.aComp)) return null;
    const t = f.map((r) => r.t);
    const qC = [0, 1, 2, 3].map((g) => f.map((r) => (r.qComp ? r.qComp[g] : null)));
    const aC = [0, 1, 2, 3].map((g) => f.map((r) => (r.aComp ? r.aComp[g] : null)));
    const enMetros = unidadApertura != null && /^m$|metro/i.test(unidadApertura.trim());
    const qCalc = enMetros ? f.map((r) => (r.aComp && r.nivel != null ? caudalVertederoDetallado(r.nivel, r.aComp.map((a) => (a != null && a > 0.05 ? a : 0))).total : null)) : null;
    return { t, qC, aC, qTot: f.map((r) => r.qVert), qCalc, enMetros };
  }, [vivo, unidadApertura]);
  const sQ = useMemo(() => medido && [
    ...medido.qC.map((x, g) => ({ nombre: `C${g + 1}`, datos: x, indice: g, ancho: 1.6 })),
    { nombre: "Total medido", datos: medido.qTot, color: T.ink, ancho: 2.2 },
    ...(medido.qCalc ? [{ nombre: "Total con la Tabla 10.6 y las aperturas medidas", datos: medido.qCalc, indice: 6, dash: true, ancho: 1.8 }] : []),
  ], [medido, T]);
  const sA = useMemo(() => medido && medido.aC.map((x, g) => ({ nombre: `C${g + 1}`, datos: x, indice: g, ancho: 1.6, escalones: true })), [medido]);

  const input = { width: "100%", padding: "7px 9px", fontSize: 14, fontWeight: 600, background: T.panelSoft, border: `1px solid ${T.line}`, borderRadius: 7, color: T.ink };
  return (
    <>
      <Proposito T={T} id="vertedero" titulo="Vertedero" fuente="LoggerNet (posición, apertura y caudal por compuerta) · fórmulas del Simulador de crecientes"
        para="Seguir el vertedero en vivo (caudal y apertura de cada compuerta) y calcular qué aperturas dan un caudal de vertimiento a un nivel dado, con las mismas fórmulas del Simulador de crecientes."
        logras="Estimar el caudal vertido cuando falte la medición, revisar la medición contra la curva de calibración y preparar la maniobra (canal, número de compuertas, apertura y régimen)."
        resultados="Gráficos de 48 h por compuerta, comparación medido frente a calculado y la calculadora: canal, apertura por compuerta, régimen (a presión o libre) y caudal logrado." />
      <Tarjeta T={T} titulo="Calculadora de aperturas" subtitulo={`Reglas de canal del proyecto: menos de ${C1_MIN_OPERATIVO} m³/s no se abre (se prefiere embalsar); izquierdo (C1) hasta ${UMBRAL_CANAL_IZQ_MAX}; derecho (C2–C4) hasta ${UMBRAL_CANAL_DER_MAX}; ambos por encima. Si el canal asignado pasa de la apertura máxima a presión Amax(H), se prueba el siguiente.`}>
        <div className="itu-grid-form">
          <div><label style={{ fontSize: 12.5, color: T.inkMuted, fontWeight: 600 }}>Nivel del embalse (msnm)</label>
            <input type="number" step={0.01} min={NIVEL_MIN_TEC} max={NAME} value={nivel ?? (nivelVivo != null ? +nivelVivo.toFixed(2) : 418)} onChange={(e) => { const t = e.target.value.trim(); setNivel(t === "" || !Number.isFinite(+t) ? null : +t); }} style={{ ...input, marginTop: 5 }} />
            <div style={{ fontSize: 11.5, color: T.inkFaint, marginTop: 3 }}>{nivel == null && nivelVivo != null ? "Nivel actual del radar" : nivelVivo != null ? <button onClick={() => setNivel(null)} style={{ border: "none", background: "none", color: T.teal, padding: 0, cursor: "pointer", fontSize: 11.5 }}>Usar nivel actual ({fmtNum(nivelVivo, 2)})</button> : "Sin dato en vivo"}</div>
          </div>
          <div><label style={{ fontSize: 12.5, color: T.inkMuted, fontWeight: 600 }}>Caudal a verter (m³/s)</label>
            <input type="number" step={10} min={0} value={qObj} onChange={(e) => setQObj(Math.max(0, +e.target.value || 0))} style={{ ...input, marginTop: 5 }} />
          </div>
        </div>
        {H <= ZV ? <p style={{ color: T.inkMuted, fontSize: 13 }}>El nivel está por debajo de la cresta del vertedero ({ZV} msnm): no hay descarga.</p> : (
          <>
            <div className="itu-kpis" style={{ marginTop: 14 }}>
              <Kpi T={T} rotulo="Canal" valor={calc.canal === "cerrado" ? "Cerrado" : calc.canal[0].toUpperCase() + calc.canal.slice(1)} nota={calc.escalado ? `Se pasó del canal ${calc.canalAsignado} para no superar Amax(H)` : calc.canal === "cerrado" ? `Por debajo de ${C1_MIN_OPERATIVO} m³/s` : undefined} />
              <Kpi T={T} rotulo="Caudal logrado" valor={calc.det.total} decimales={1} unidad="m³/s" estado={qObj > 0 && calc.canal !== "cerrado" ? <Estado T={T} compacto tipo={Math.abs(calc.det.total - qObj) / qObj < 0.005 ? "bien" : "aviso"}>{Math.abs(calc.det.total - qObj) / qObj < 0.005 ? "Alcanza el objetivo" : calc.det.total < qObj ? "No alcanza: compuertas al máximo" : "Supera el objetivo"}</Estado> : null} />
              <Kpi T={T} rotulo="Apertura máx. a presión Amax(H)" valor={capacidad.amax} decimales={2} unidad="m" nota={`Estructural ${A_MAX_ESTRUCTURAL} m`} />
              <Kpi T={T} rotulo="Capacidad a flujo libre (4 compuertas)" valor={calc.qLibre} decimales={0} unidad="m³/s" />
            </div>
            <div className="itu-gate-row" style={{ marginTop: 12 }}>
              {calc.aperturas.map((A, g) => {
                const c = calc.det.detalle[g];
                return (
                  <div key={g} style={{ background: T.panelSoft, borderRadius: 10, padding: "10px 12px", border: `1px solid ${A > 0 ? T.teal : T.lineSoft}` }}>
                    <div style={{ fontSize: 12, color: T.inkMuted, fontWeight: 700 }}>C{g + 1} · canal {g === 0 ? "izquierdo" : "derecho"}</div>
                    <div style={{ fontSize: 20, fontWeight: 750, color: T.ink, marginTop: 2 }}>{fmtNum(A, 2)} <span style={{ fontSize: 12, color: T.inkFaint }}>m</span></div>
                    <div style={{ fontSize: 12, color: T.inkMuted }}>{fmtNum(c.q, 1)} m³/s · {c.tipo === "FP" ? "a presión" : c.tipo === "FL" ? "flujo libre" : "cerrada"}</div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Tarjeta>
      {medido ? (
        <>
          <Tarjeta T={T} titulo="Caudal por compuerta (48 h)" subtitulo={medido.qCalc ? "La línea punteada es el caudal que da la Tabla 10.6 con las aperturas medidas y el nivel del radar: si se separa del medido, revisar la medición o la calibración." : `Para comparar con la Tabla 10.6 hace falta que la apertura venga en metros${unidadApertura ? ` (el archivo dice "${unidadApertura}")` : " (unidad aún no conocida: llega con los metadatos del relay)"}.`}>
            <GraficoSeries T={T} x={medido.t} series={sQ} unidad="m³/s" ejeY="m³/s" grupo="vert" nombreArchivo="vertedero_compuertas" incluirCero />
          </Tarjeta>
          <Tarjeta T={T} titulo="Apertura por compuerta (48 h)" subtitulo={`Columna Open_GateX de LoggerNet${unidadApertura ? ` (${unidadApertura})` : ""}.`}>
            <GraficoSeries T={T} x={medido.t} series={sA} unidad={unidadApertura || ""} ejeY={unidadApertura || "apertura"} decimales={2} grupo="vert" alto={200} nombreArchivo="vertedero_aperturas" incluirCero />
          </Tarjeta>
        </>
      ) : (
        <Tarjeta T={T} titulo="Medición por compuerta">
          <p style={{ fontSize: 13, color: T.inkMuted, margin: 0, lineHeight: 1.5 }}>{d.conectado ? "Los archivos del relay todavía no traen la apertura ni el caudal por compuerta. Se activan al instalar la versión 2 del relay (sube todas las columnas de LoggerNet)." : "Conecte el repositorio de datos para ver el vertedero en vivo."}</p>
        </Tarjeta>
      )}
    </>
  );
}
