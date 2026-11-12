/* ============================================================
   Analítica — Hidrología y pronóstico: caudales observados (Olaya,
   Sitio Presa, La Pintada), pronóstico vigente y cómo ha cambiado
   de una emisión a otra, aguas arriba y lluvia. Fuente:
   HydroForecast Ituango (en vivo) y su archivo en el repositorio.
   ============================================================ */
import { useCallback, useMemo, useState } from "react";
import { useDatos, useCargaPeriodica, sumarDias } from "../datos/fuentes.jsx";
import { useVivo } from "../datos/vivo.jsx";
import { errorPronosticoHF } from "../analitica.js";
import { GraficoSeries, Estado, fmtNum } from "./graficos.jsx";
import { Proposito, Tarjeta, SelectorRango, rangoUltimos, fechaCorta, Nota } from "./comunes.jsx";

const dia = (x) => String(x).slice(0, 10);

function leerCSVHistorico(texto) {
  const l = texto.trim().split(/\r?\n/); const cab = l[0].split(",");
  const ix = (c) => cab.indexOf(c);
  const iF = ix("Fecha"), iO = ix("CaudalOlaya_mean"), iP = ix("CaudalPintada_mean"), iS = ix("CaudalSitioPresa_mean"), iN = ix("NivelEmbalse_mean");
  return l.slice(1).map((r) => { const f = r.split(","); const n = (i) => (i < 0 || f[i] === "" ? null : +f[i]); return { d: f[iF].slice(0, 10), ol: n(iO), pi: n(iP), sp: n(iS), niv: n(iN) }; });
}

export default function Hidrologia({ T }) {
  const d = useDatos();
  const { vivo } = useVivo();
  const [rangoHist, setRangoHist] = useState(null);
  const [rangoAA, setRangoAA] = useState(null);
  const [horizonte, setHorizonte] = useState(90);
  const extra = useCargaPeriodica(useCallback(async () => {
    const r = {};
    const [pl, lm] = await Promise.all([d.leerHF("/api/precipitation/pluviometros?days=14", "pluviometros.json").catch(() => null), d.leerHF("/api/precipitation/modelo", "lluvia_modelo.json").catch(() => null)]);
    r.pluv = pl?.datos; r.modelo = lm?.datos;
    const aa = await d.leerHF("/api/aguas_arriba?hours=720", "aguas_arriba.json").catch(() => null);
    r.aguasArriba = aa?.datos;
    if (d.conectado) {
      r.tendencia = await d.leerJSON("hf/tendencia.json").catch(() => null);
      const csv = await d.leerTexto("hf/historico_diario.csv").catch(() => null);
      r.historico = csv ? leerCSVHistorico(csv) : null;
    }
    return r;
  }, [d]), [d], 30 * 60e3);

  const pron = vivo?.hf?.pronostico?.datos, obs = vivo?.hf?.observado?.datos, aa = extra.datos?.aguasArriba || vivo?.hf?.aguasArriba?.datos;
  const sPron = useMemo(() => {
    if (!pron || !pron.data) return null;
    const x = pron.data.slice(0, horizonte);
    return { t: x.map((r) => `${dia(r.timestamp)} 12:00`), s: [
      { nombre: "Sitio Presa (media)", datos: x.map((r) => r.QSitioPresa_pred_mean), indice: 0, ancho: 2.2 },
      { nombre: "Sitio Presa mín.", datos: x.map((r) => r.QSitioPresa_pred_min), color: T.inkFaint, ancho: 0.8 },
      { nombre: "Sitio Presa máx.", datos: x.map((r) => r.QSitioPresa_pred_max), color: T.inkFaint, ancho: 0.8 },
      { nombre: "Olaya (media)", datos: x.map((r) => r.QOlaya_pred_mean), indice: 1, ancho: 1.8, dash: true },
    ] };
  }, [pron, T, horizonte]);

  // Tendencia: últimas 4 emisiones sobre las fechas objetivo + observado
  const tend = useMemo(() => {
    const em = extra.datos?.tendencia?.emisiones;
    if (!em || !em.length) return null;
    const ult = em.slice(-4);
    const fechas = [...new Set(ult.flatMap((e) => e.fecha))].sort();
    const mapaObs = new Map((obs?.data || []).map((r) => [dia(r.timestamp), r.QSitioPresa_obs]));
    const s = ult.map((e, i) => ({ nombre: `Emitido ${fechaCorta(String(e.emision).slice(0, 16).replace("T", " "))}`, indice: i, ancho: i === ult.length - 1 ? 2.4 : 1.4, puntos: true, datos: fechas.map((f) => { const k = e.fecha.indexOf(f); return k >= 0 ? e.sp[k] : null; }) }));
    s.push({ nombre: "Observado", datos: fechas.map((f) => mapaObs.get(f) ?? null), color: T.ink, ancho: 2.4, puntos: true });
    // Acierto por anticipación (todas las emisiones archivadas)
    // solo días cerrados: el observado del día en curso es parcial
    const errores = errorPronosticoHF(em, mapaObs, vivo ? vivo.hoy : null);
    return { fechas: fechas.map((f) => `${f} 12:00`), s, errores, nEmisiones: em.length, primera: em[0].emision };
  }, [extra.datos, obs, T, vivo]);

  const hist = useMemo(() => {
    const h = extra.datos?.historico || [];
    const mapa = new Map(h.map((r) => [r.d, { ...r }]));
    for (const r of obs?.data || []) { const k = dia(r.timestamp); const x = mapa.get(k) || { d: k }; x.ol = r.QOlaya_obs ?? x.ol; x.sp = r.QSitioPresa_obs ?? x.sp; x.pi = r.QPintada_obs ?? x.pi; mapa.set(k, x); }
    const todas = [...mapa.values()].sort((a, b) => (a.d < b.d ? -1 : 1));
    if (!todas.length) return null;
    const min = todas[0].d, max = todas[todas.length - 1].d;
    const r = rangoHist || rangoUltimos(max, "365", min);
    const filas = todas.filter((x) => x.d >= r.desde && x.d <= r.hasta);
    return { min, max, rango: r, t: filas.map((r) => `${r.d} 12:00`), s: [
      { nombre: "Sitio Presa", datos: filas.map((r) => r.sp), indice: 0, ancho: 1.8 },
      { nombre: "Olaya", datos: filas.map((r) => r.ol), indice: 1, ancho: 1.4 },
      { nombre: "La Pintada", datos: filas.map((r) => r.pi), indice: 2, ancho: 1.2 },
    ] };
  }, [extra.datos, obs, rangoHist]);

  const sAA = useMemo(() => {
    if (!aa || !aa.serie) return null;
    const cols = (aa.estaciones || []).map((e) => e.col);
    const min = String(aa.serie[0]?.timestamp || "").slice(0, 10), max = String(aa.serie[aa.serie.length - 1]?.timestamp || "").slice(0, 10);
    const r = rangoAA || rangoUltimos(max, "7", min);
    const serie = aa.serie.filter((x) => String(x.timestamp).slice(0, 10) >= r.desde && String(x.timestamp).slice(0, 10) <= r.hasta);
    return { min, max, rango: r, t: serie.map((x) => x.timestamp), s: cols.map((c, i) => ({ nombre: (aa.estaciones.find((e) => e.col === c) || {}).nombre || c, datos: serie.map((x) => x[c] ?? null), indice: i, ancho: 1.6 })) };
  }, [aa, rangoAA]);

  const lluviaModelo = extra.datos?.modelo;
  const pluv = extra.datos?.pluv;
  return (
    <>
      <Proposito T={T} id="hidrologia" titulo="Hidrología y pronóstico" fuente="HydroForecast Ituango (en vivo; si no responde, el archivo diario del repositorio)"
        para="Ver qué agua viene: caudal observado en Olaya, Sitio Presa y La Pintada, el pronóstico de 90 días y cómo cambia de una emisión a otra, las estaciones aguas arriba con su tiempo de viaje y la lluvia."
        logras="Anticipar el caudal de entrada para planear el despacho y la regla operativa de los próximos días, y saber cuánto confiar en el pronóstico según su acierto reciente."
        resultados="Pronóstico vigente con su rango, comparación de las últimas emisiones con lo observado, error medio a 1, 3 y 7 días, histórico desde 2015, aguas arriba y lluvia observada y pronosticada por zona." />
      {sPron && (
        <Tarjeta T={T} titulo={`Pronóstico vigente (${horizonte} días)`} accion={<div style={{ display: "inline-flex", border: `1px solid ${T.line}`, borderRadius: 8, overflow: "hidden" }}>{[15, 30, 90].map((n) => <button key={n} onClick={() => setHorizonte(n)} aria-pressed={horizonte === n} style={{ padding: "6px 11px", fontSize: 12.5, border: "none", borderRight: `1px solid ${T.line}`, background: horizonte === n ? T.accentSoft : T.panel, color: horizonte === n ? T.teal : T.inkMuted, fontWeight: horizonte === n ? 700 : 500, cursor: "pointer" }}>{n} días</button>)}</div>} subtitulo={`Emitido ${fechaCorta(String(pron.generated_at).slice(0, 16).replace("T", " "))} · ${vivo.hf.pronostico.origen}. Franja = mínimo y máximo de Sitio Presa.`}>
          <GraficoSeries T={T} x={sPron.t} series={sPron.s} unidad="m³/s" ejeY="m³/s" decimales={0} nombreArchivo={`pronostico_${horizonte}d`} bandas={[{ desde: 1, hasta: 2 }]} />
        </Tarjeta>
      )}
      {tend && (
        <Tarjeta T={T} titulo="Cómo ha cambiado el pronóstico de Sitio Presa" subtitulo={`Últimas 4 emisiones frente a lo observado. Archivo desde ${fechaCorta(String(tend.primera).slice(0, 10))} (${tend.nEmisiones} emisiones); se guarda cada emisión nueva.`}>
          <GraficoSeries T={T} x={tend.fechas} series={tend.s} unidad="m³/s" ejeY="m³/s" decimales={0} nombreArchivo="tendencia_pronostico" />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            {tend.errores.map((e) => (
              <div key={e.L} style={{ fontSize: 12.5, color: T.inkMuted, background: T.panelSoft, borderRadius: 8, padding: "6px 10px" }}>
                A {e.L} día{e.L > 1 ? "s" : ""}: {e.mape != null ? <><b style={{ color: T.ink }}>{fmtNum(e.mape, 1)} %</b> de error medio ({e.n} día{e.n === 1 ? "" : "s"} comparado{e.n === 1 ? "" : "s"})</> : <span style={{ color: T.inkFaint }}>aún sin días para comparar</span>}
              </div>
            ))}
          </div>
          <Nota T={T} rotulo="Cómo se mide el error">Error medio absoluto en porcentaje del observado diario de Sitio Presa. Con pocas emisiones archivadas es solo indicativo; mejora a medida que se acumulan.</Nota>
        </Tarjeta>
      )}
      {hist && (
        <Tarjeta T={T} titulo="Caudal observado (diario)" accion={<SelectorRango T={T} min={hist.min} max={hist.max} valor={hist.rango} onChange={setRangoHist} atajos={[["90", "90 días"], ["365", "1 año"], ["1825", "5 años"], ["todo", "Desde 2015"]]} />}
          subtitulo={d.conectado ? "Histórico de HydroForecast (media diaria de datos de 15 min) completado con el observado reciente." : "Últimos 120 días (conecte el repositorio de datos para ver el histórico desde 2015)."}>
          <GraficoSeries T={T} x={hist.t} series={hist.s} unidad="m³/s" ejeY="m³/s" decimales={0} nombreArchivo="caudal_observado_diario" />
        </Tarjeta>
      )}
      {sAA && (
        <Tarjeta T={T} titulo="Aguas arriba (horario)" subtitulo={aa.nota} accion={<SelectorRango T={T} min={sAA.min} max={sAA.max} valor={sAA.rango} onChange={setRangoAA} atajos={[["1", "Hoy"], ["3", "3 días"], ["7", "7 días"], ["todo", "30 días"]]} />}>
          <GraficoSeries T={T} x={sAA.t} series={sAA.s} unidad="m³/s" ejeY="m³/s" decimales={0} nombreArchivo="aguas_arriba_horario" />
        </Tarjeta>
      )}
      <div className="itu-2col">
        {pluv && pluv.estaciones && (
          <Tarjeta T={T} titulo="Lluvia observada (pluviómetros)" subtitulo={`Último dato ${fechaCorta(String(pluv.ultimo_dato || "").slice(0, 16))}. Acumulados en mm.`}>
            <div className="itu-tabla"><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
              <thead><tr style={{ color: T.inkFaint, textAlign: "right" }}><th style={{ textAlign: "left", padding: "5px 8px" }}>Estación</th><th style={{ padding: "5px 8px" }}>6 h</th><th style={{ padding: "5px 8px" }}>24 h</th><th style={{ padding: "5px 8px" }}>72 h</th><th style={{ padding: "5px 8px" }}>7 días</th><th style={{ padding: "5px 8px" }}>Máx. 1 h (24 h)</th></tr></thead>
              <tbody>{Object.values(pluv.estaciones).map((e) => (
                <tr key={e.nombre} style={{ borderTop: `1px solid ${T.lineSoft}`, textAlign: "right", color: T.ink }}>
                  <td style={{ textAlign: "left", padding: "5px 8px" }}>{e.nombre}</td>
                  {["6h", "24h", "72h", "7d"].map((k) => <td key={k} style={{ padding: "5px 8px" }}>{fmtNum(e.totales?.[k], 1)}</td>)}
                  <td style={{ padding: "5px 8px" }}>{fmtNum(e.max_1h_24h, 1)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </Tarjeta>
        )}
        {lluviaModelo && (
          <Tarjeta T={T} titulo="Lluvia pronosticada por zona" subtitulo={Object.entries(lluviaModelo.zonas || {}).map(([k, v]) => `${k}: ${v}`).join(" · ")}>
            <div className="itu-tabla"><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
              <thead><tr style={{ color: T.inkFaint, textAlign: "right" }}><th style={{ textAlign: "left", padding: "5px 8px" }}>Fecha</th>
                {["wrf", "gefs", "aifs"].filter((m) => lluviaModelo[m]).map((m) => <th key={m} style={{ padding: "5px 8px" }} colSpan={3}>{m.toUpperCase()} (sur / norte / media)</th>)}
              </tr></thead>
              <tbody>{[...new Set(["wrf", "gefs", "aifs"].flatMap((m) => (lluviaModelo[m]?.dias || []).map((x) => x.fecha)))].sort().filter((f) => !vivo || !vivo.hoy || f >= vivo.hoy).slice(0, 10).map((f) => (
                <tr key={f} style={{ borderTop: `1px solid ${T.lineSoft}`, textAlign: "right", color: T.ink }}>
                  <td style={{ textAlign: "left", padding: "5px 8px", whiteSpace: "nowrap" }}>{fechaCorta(f)}</td>
                  {["wrf", "gefs", "aifs"].filter((m) => lluviaModelo[m]).map((m) => { const x = (lluviaModelo[m].dias || []).find((y) => y.fecha === f); return ["sur", "norte", "media"].map((z) => <td key={m + z} style={{ padding: "5px 6px" }}>{x ? fmtNum(x[z], 1) : "—"}</td>); })}
                </tr>
              ))}</tbody>
            </table></div>
            <p style={{ fontSize: 12, color: T.inkFaint, margin: "8px 0 0" }}>mm por día. Emisión WRF {lluviaModelo.wrf?.emision ?? "—"}, GEFS {lluviaModelo.gefs?.emision ?? "—"}.</p>
          </Tarjeta>
        )}
      </div>
      {!sPron && !hist && <Tarjeta T={T} titulo="Sin datos de HydroForecast">{vivo?.errores?.length ? vivo.errores.join(" · ") : "Consultando…"} {extra.error && <Estado T={T} tipo="critico" compacto>{extra.error.message}</Estado>}</Tarjeta>}
    </>
  );
}
