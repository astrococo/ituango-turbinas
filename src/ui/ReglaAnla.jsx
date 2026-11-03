/* ============================================================
   Analítica — Regla operativa (Res. ANLA 1891) y bandas: día por
   día, el promedio regulado frente a la banda, el vertedero y el
   caudal total descargado, con el estado regulatorio del periodo.
   ============================================================ */
import { useMemo, useState } from "react";
import { ETIQUETA_ESTADO_REGLA } from "../modelo.js";
import { estadisticasRegla } from "../analitica.js";
import { useDatos } from "../datos/fuentes.jsx";
import { useHistoricoDiario, filtrarPeriodo } from "../datos/historico.js";
import { GraficoSeries, Estado, fmtNum, ESTADO } from "./graficos.jsx";
import { Proposito, Tarjeta, Kpi, RequiereConexion, SelectorPeriodo, fechaCorta } from "./comunes.jsx";
import { descargarCSV } from "./base.jsx";
import { TIPO_ESTADO } from "./Tablero.jsx";

const COLOR_ESTADO = (T) => ({ cumple: ESTADO.bien, por_encima: ESTADO.critico, por_debajo: ESTADO.serio, excepcion: ESTADO.aviso, sin_base: T.lineSoft });
const ICONO = { cumple: "✓", por_encima: "▲", por_debajo: "▼", excepcion: "!", sin_base: "–" };

/* Calendario de estados: una columna por semana, una fila por día de la semana. */
function Calendario({ T, dias }) {
  if (!dias.length) return null;
  const colores = COLOR_ESTADO(T);
  const primero = new Date(dias[0].dia + "T00:00:00Z");
  const offset = (primero.getUTCDay() + 6) % 7; // lunes = 0
  const celdas = [...Array(offset).fill(null), ...dias];
  const semanas = Math.ceil(celdas.length / 7);
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ display: "grid", gridTemplateRows: "repeat(7, 16px)", gridAutoFlow: "column", gridAutoColumns: "16px", gap: 3, width: semanas * 19 }}>
        {celdas.map((d, i) => (d ? (
          <div key={i} title={`${fechaCorta(d.dia)}: ${ETIQUETA_ESTADO_REGLA[d.regla.estado]}${d.regla.qReg != null ? ` · ${fmtNum(d.regla.qReg, 1)} m³/s` : ""}${d.parcial ? " (parcial)" : ""}`}
            style={{ width: 16, height: 16, borderRadius: 3, background: colores[d.regla.estado], opacity: d.parcial ? 0.5 : 1, color: d.regla.estado === "excepcion" ? "#0b0b0b" : "#fff", fontSize: 10, fontWeight: 800, display: "grid", placeItems: "center" }}>
            {ICONO[d.regla.estado]}
          </div>
        ) : <div key={i} />))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 10, fontSize: 12, color: T.inkMuted }}>
        {Object.keys(ICONO).map((k) => (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 14, height: 14, borderRadius: 3, background: colores[k], color: k === "excepcion" ? "#0b0b0b" : "#fff", fontSize: 9, fontWeight: 800, display: "grid", placeItems: "center" }}>{ICONO[k]}</span>{ETIQUETA_ESTADO_REGLA[k]}
          </span>
        ))}
        <span>Semitransparente: día incompleto</span>
      </div>
    </div>
  );
}

export default function ReglaAnla({ T }) {
  const d = useDatos();
  const { datos, error, cargando } = useHistoricoDiario();
  const [periodo, setPeriodo] = useState("90");
  const dias = useMemo(() => filtrarPeriodo(datos?.dias, periodo), [datos, periodo]);
  const est = useMemo(() => estadisticasRegla(dias), [dias]);
  const s = useMemo(() => {
    if (!dias.length) return null;
    const t = dias.map((x) => `${x.dia} 12:00`);
    return {
      t,
      regla: [
        { nombre: "Promedio regulado del día", datos: dias.map((x) => x.regla.qReg), indice: 0, ancho: 2.2, puntos: dias.length <= 120 },
        { nombre: "Banda mín.", datos: dias.map((x) => x.regla.banda?.min ?? null), color: T.inkFaint, dash: true, ancho: 1.2 },
        { nombre: "Banda máx.", datos: dias.map((x) => x.regla.banda?.max ?? null), color: T.inkFaint, dash: true, ancho: 1.2 },
      ],
      descarga: [
        { nombre: "Total descargado (media)", datos: dias.map((x) => x.descargado.qMedia), indice: 2, ancho: 2 },
        { nombre: "Total descargado (máx.)", datos: dias.map((x) => x.descargado.qMax), indice: 2, ancho: 1, dash: true },
        { nombre: "Vertedero (media)", datos: dias.map((x) => x.vertedero.qMedia), indice: 1, ancho: 2 },
        { nombre: "Vertedero (máx.)", datos: dias.map((x) => x.vertedero.qMax), indice: 1, ancho: 1, dash: true },
        { nombre: "Entrada (balance)", datos: dias.map((x) => x.balance.qEntrada), indice: 6, ancho: 1.6 },
      ],
      nivel: [{ nombre: "Nivel al inicio del día", datos: dias.map((x) => x.nivel.ini), indice: 0, decimales: 3 }, { nombre: "Mínimo", datos: dias.map((x) => x.nivel.min), indice: 2, ancho: 1, decimales: 3, oculta: true }, { nombre: "Máximo", datos: dias.map((x) => x.nivel.max), indice: 1, ancho: 1, decimales: 3, oculta: true }],
    };
  }, [dias, T]);

  const guia = (
    <Proposito T={T} id="regla" titulo="Regla operativa (Res. 1891) y bandas ANLA" fuente="Histórico diario calculado cada hora con el código de la app (mismas reglas que la app de Hidrometría)"
      para="Revisar el cumplimiento de la regla operativa día por día: promedio regulado frente a la banda del ±4,70 % sobre el día anterior, vertimientos (excepción) y caudal total descargado (vertedero + turbinas)."
      logras="Ver el estado regulatorio de un periodo (cuántos días cumplen, por encima, por debajo o en excepción), detectar patrones y preparar reportes con los mismos números que Hidrometría."
      resultados="Indicadores del periodo, calendario de estados, gráficos de la regla, del vertedero y del descargado, y la tabla diaria con márgenes frente a la banda, descargable en CSV." />
  );
  if (!d.conectado) return <>{guia}<RequiereConexion T={T} que="el histórico de la regla operativa" /></>;
  return (
    <>
      {guia}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <SelectorPeriodo T={T} valor={periodo} onChange={setPeriodo} />
        {datos && <span style={{ fontSize: 12.5, color: T.inkFaint }}>Histórico desde {fechaCorta(datos.estado.primerDia)} · actualizado {fechaCorta(String(datos.estado.generado).slice(0, 16).replace("T", " "))} UTC</span>}
        {cargando && <span style={{ fontSize: 12.5, color: T.inkFaint }}>Cargando…</span>}
        {error && <Estado T={T} tipo="critico" compacto>{error.message}</Estado>}
      </div>
      {dias.length > 0 && (
        <>
          <div className="itu-kpis" style={{ marginBottom: 16 }}>
            <Kpi T={T} rotulo="Cumplimiento" valor={est.pctCumple} decimales={0} unidad="%" nota={`${est.conteo.cumple} de ${est.evaluados} días evaluados (sin excepciones ni días sin base)`} />
            <Kpi T={T} rotulo="Por encima de la banda" valor={est.conteo.por_encima} decimales={0} unidad="días" />
            <Kpi T={T} rotulo="Por debajo de la banda" valor={est.conteo.por_debajo} decimales={0} unidad="días" />
            <Kpi T={T} rotulo="Excepción (vertimiento)" valor={est.conteo.excepcion} decimales={0} unidad="días" />
            <Kpi T={T} rotulo="Racha actual cumpliendo" valor={est.rachaActual} decimales={0} unidad="días" nota={`Máxima del periodo: ${est.rachaMax} días`} />
            <Kpi T={T} rotulo="Volumen vertido" valor={dias.reduce((a, x) => a + (x.vertedero.volHm3 || 0), 0)} decimales={1} unidad="hm³" nota={`${dias.filter((x) => x.vertedero.conVertimiento).length} días con vertimiento`} />
          </div>
          <Tarjeta T={T} titulo="Calendario de cumplimiento" subtitulo="Cada cuadro es un día (columnas = semanas, de lunes a domingo). Pase el puntero para ver el detalle.">
            <Calendario T={T} dias={dias} />
          </Tarjeta>
          <Tarjeta T={T} titulo="Promedio regulado frente a la banda" subtitulo="Banda del día = promedio del día anterior ± 4,70 %. Un punto fuera de la franja verde incumple, salvo los días con vertimiento (excepción).">
            <GraficoSeries T={T} x={s.t} series={s.regla} unidad="m³/s" ejeY="m³/s" grupo="regla" nombreArchivo="regla_1891" bandas={[{ desde: 1, hasta: 2, relleno: "rgba(12,163,12,0.10)" }]} />
          </Tarjeta>
          <Tarjeta T={T} titulo="Vertedero, total descargado y entrada al embalse" subtitulo="Total descargado = caudal regulado (P / F.C.) + vertedero. Entrada = descargado + cambio de volumen del embalse (balance de masa con el nivel del radar).">
            <GraficoSeries T={T} x={s.t} series={s.descarga} unidad="m³/s" ejeY="m³/s" grupo="regla" nombreArchivo="vertedero_descargado" incluirCero />
          </Tarjeta>
          <Tarjeta T={T} titulo="Nivel del embalse"><GraficoSeries T={T} x={s.t} series={s.nivel} unidad="msnm" ejeY="msnm" decimales={3} grupo="regla" alto={200} nombreArchivo="nivel_diario" /></Tarjeta>
          <Tarjeta T={T} titulo="Detalle diario" accion={<button onClick={() => descargarCSV(dias.map((x) => ({
            fecha: x.dia, minutos: x.minutos, q_regulado_m3s: x.regla.qReg, banda_min: x.regla.banda?.min ?? "", banda_max: x.regla.banda?.max ?? "", estado: ETIQUETA_ESTADO_REGLA[x.regla.estado],
            margen_a_max_m3s: x.regla.margenSup ?? "", margen_a_min_m3s: x.regla.margenInf ?? "", vertedero_media_m3s: x.vertedero.qMedia, vertedero_max_m3s: x.vertedero.qMax, volumen_vertido_hm3: x.vertedero.volHm3,
            descargado_media_m3s: x.descargado.qMedia, descargado_max_m3s: x.descargado.qMax, entrada_balance_m3s: x.balance.qEntrada ?? "", nivel_inicio_msnm: x.nivel.ini, nivel_fin_msnm: x.nivel.fin, energia_MWh: x.energia, fc_medio: x.fc,
          })), `regla_1891_${periodo}.csv`)} style={{ padding: "4px 10px", fontSize: 12, border: `1px solid ${T.line}`, borderRadius: 6, background: T.panelSoft, color: T.inkMuted, cursor: "pointer" }}>CSV</button>}>
            <div className="itu-tabla" style={{ maxHeight: 460, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
                <thead><tr style={{ color: T.inkFaint, textAlign: "right", position: "sticky", top: 0, background: T.panel }}>
                  {["Fecha", "Q regulado", "Banda", "Margen", "Estado", "Vertedero máx.", "Descargado medio", "Entrada", "Δ nivel", "Energía"].map((h, i) => <th key={h} style={{ padding: "6px 8px", textAlign: i === 0 || i === 4 ? "left" : "right", whiteSpace: "nowrap" }}>{h}</th>)}
                </tr></thead>
                <tbody>{dias.slice().reverse().map((x) => (
                  <tr key={x.dia} style={{ borderTop: `1px solid ${T.lineSoft}`, textAlign: "right", color: T.ink }}>
                    <td style={{ textAlign: "left", padding: "5px 8px", whiteSpace: "nowrap" }}>{fechaCorta(x.dia)} {x.dia.slice(0, 4)}{x.parcial ? " *" : ""}</td>
                    <td style={{ padding: "5px 8px", fontWeight: 700 }}>{fmtNum(x.regla.qReg, 1)}</td>
                    <td style={{ padding: "5px 8px", whiteSpace: "nowrap", color: T.inkMuted }}>{x.regla.banda ? `${fmtNum(x.regla.banda.min, 1)} – ${fmtNum(x.regla.banda.max, 1)}` : "—"}</td>
                    <td style={{ padding: "5px 8px", color: T.inkMuted }}>{x.regla.banda && x.regla.estado !== "excepcion" ? (x.regla.qReg > x.regla.banda.max ? `+${fmtNum(x.regla.qReg - x.regla.banda.max, 1)}` : x.regla.qReg < x.regla.banda.min ? `−${fmtNum(x.regla.banda.min - x.regla.qReg, 1)}` : `${fmtNum(Math.min(x.regla.margenSup, x.regla.margenInf), 1)} libre`) : "—"}</td>
                    <td style={{ textAlign: "left", padding: "5px 8px" }}><Estado T={T} compacto tipo={TIPO_ESTADO[x.regla.estado]}>{ETIQUETA_ESTADO_REGLA[x.regla.estado]}</Estado></td>
                    <td style={{ padding: "5px 8px" }}>{x.vertedero.conVertimiento ? fmtNum(x.vertedero.qMax, 0) : "0"}</td>
                    <td style={{ padding: "5px 8px" }}>{fmtNum(x.descargado.qMedia, 1)}</td>
                    <td style={{ padding: "5px 8px" }}>{fmtNum(x.balance.qEntrada, 0)}</td>
                    <td style={{ padding: "5px 8px" }}>{x.nivel.deltaH != null ? `${x.nivel.deltaH >= 0 ? "+" : ""}${fmtNum(x.nivel.deltaH * 100, 0)} cm` : "—"}</td>
                    <td style={{ padding: "5px 8px" }}>{fmtNum(x.energia, 0)} MWh</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <p style={{ fontSize: 12, color: T.inkFaint, margin: "8px 0 0" }}>* Día incompleto (menos del 90 % de los minutos), por ejemplo el día en curso. Caudales en m³/s.</p>
          </Tarjeta>
        </>
      )}
    </>
  );
}
