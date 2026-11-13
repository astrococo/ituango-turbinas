/* ============================================================
   Analítica — Indicadores de la central: factor de planta (nominal y
   real), horas equivalentes, energía equivalente del agua vertida,
   energía embalsada útil, aportes frente a la media histórica, tiempo
   en línea y arranques por unidad, e indicadores de sostenibilidad.
   Cálculos en src/indicadores.js.
   ============================================================ */
import { useMemo, useState } from "react";
import { useDatos } from "../datos/fuentes.jsx";
import { useVivo } from "../datos/vivo.jsx";
import { useHistoricoDiario } from "../datos/historico.js";
import { useAportes } from "../datos/aportes.js";
import {
  MW_NOMINAL_UNIDAD, CAPACIDAD_DISENO_MW, capacidadNominalMW, capacidadDemostrada, resumenIndicadores, indicadoresMensuales,
  energiaEmbalsada, sostenibilidad,
} from "../indicadores.js";
import { GraficoSeries, Estado, fmtNum } from "./graficos.jsx";
import { Proposito, Tarjeta, Kpi, RequiereConexion, SelectorRango, rangoUltimos, fechaCorta, Nota } from "./comunes.jsx";
import { BotonCSV } from "./base.jsx";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const nombreMes = (m) => `${MESES[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
const pct = (v, d = 1) => (v == null ? "—" : `${fmtNum(v, d)} %`);

export default function Indicadores({ T }) {
  const d = useDatos();
  const { vivo } = useVivo() || {};
  const { datos, error, cargando } = useHistoricoDiario();
  const aportes = useAportes();
  const todos = datos?.dias || [];
  const minD = todos[0]?.dia, maxD = todos[todos.length - 1]?.dia;
  const [rangoSel, setRango] = useState(null);
  const rango = rangoSel || rangoUltimos(maxD, "90", minD);
  const dias = useMemo(() => todos.filter((x) => x.dia >= rango.desde && x.dia <= rango.hasta), [todos, rango.desde, rango.hasta]);

  // La capacidad real demostrada se busca en TODO el histórico (no depende del periodo elegido)
  const capReal = useMemo(() => capacidadDemostrada(todos), [todos]);
  const opciones = useMemo(() => ({ capacidadReal: capReal ? capReal.mw : null }), [capReal]);
  const res = useMemo(() => resumenIndicadores(dias, opciones), [dias, opciones]);
  const mensual = useMemo(() => indicadoresMensuales(dias, opciones), [dias, opciones]);

  // Aportes del periodo: caudal medio y media histórica de los mismos meses
  const ap = aportes.datos;
  const apMeses = useMemo(() => (ap ? ap.olaya.filter((m) => m.mes >= rango.desde?.slice(0, 7) && m.mes <= rango.hasta?.slice(0, 7)) : []), [ap, rango.desde, rango.hasta]);
  const apPeriodo = useMemo(() => {
    const con = apMeses.filter((m) => m.media != null);
    if (!con.length) return null;
    const q = con.reduce((a, m) => a + m.q * m.dias, 0) / con.reduce((a, m) => a + m.dias, 0);
    const media = con.reduce((a, m) => a + m.media * m.dias, 0) / con.reduce((a, m) => a + m.dias, 0);
    return { q, media, pct: (q / media) * 100, meses: con.length };
  }, [apMeses]);

  const nivel = vivo && vivo.actual ? vivo.actual.nivel : null;
  const emb = useMemo(() => energiaEmbalsada(nivel, vivo && vivo.ultima ? vivo.ultima.t : null), [nivel, vivo]);
  const capNomHoy = capacidadNominalMW(maxD || "2099-01-01");
  const sost = useMemo(() => sostenibilidad({ nivel, caudalEntrada: vivo && vivo.resHoy ? vivo.resHoy.balance.qEntrada : null, qMedioAnual: ap ? ap.qMedioAnual : null, capacidadMW: capNomHoy }), [nivel, vivo, ap, capNomHoy]);

  if (!d.conectado) return <RequiereConexion T={T} que="los indicadores de la central" />;

  const xMes = mensual.map((_, i) => i), catMes = mensual.map((m) => nombreMes(m.mes));
  const xAp = apMeses.map((_, i) => i), catAp = apMeses.map((m) => nombreMes(m.mes));
  const csvMensual = mensual.map((m) => {
    const a = ap ? ap.olaya.find((x) => x.mes === m.mes) : null;
    return {
      mes: m.mes, dias_completos: m.dias, energia_mwh: Math.round(m.energia), factor_planta_nominal_pct: m.fpNominal != null ? +m.fpNominal.toFixed(2) : null,
      factor_planta_real_pct: m.fpReal != null ? +m.fpReal.toFixed(2) : null, horas_equivalentes: m.horasEquivalentes != null ? Math.round(m.horasEquivalentes) : null,
      energia_vertida_equivalente_mwh: Math.round(m.vertidaMWh), energia_vertida_pct: m.vertidaPct != null ? +m.vertidaPct.toFixed(2) : null,
      aportes_olaya_m3s: a ? +a.q.toFixed(1) : null, media_historica_m3s: a && a.media != null ? +a.media.toFixed(1) : null, aportes_pct_media: a && a.pct != null ? +a.pct.toFixed(1) : null,
      arranques: m.unidades.reduce((s, u) => s + u.arranques, 0),
    };
  });
  const th = { textAlign: "right", padding: "6px 8px", color: T.inkFaint, fontWeight: 600, whiteSpace: "nowrap" };
  const td = { textAlign: "right", padding: "6px 8px", color: T.ink, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };

  return (
    <>
      <Proposito T={T} id="indicadores" titulo="Indicadores de la central" fuente="Histórico diario (LoggerNet), curva cota-volumen, F.C. de Hidrometría e histórico de caudales de HydroForecast"
        para="Ver de un vistazo cómo se aprovechó la central y el agua en un periodo: factor de planta, energía equivalente del agua vertida, aportes frente a la media histórica, tiempo en línea por unidad e indicadores de sostenibilidad."
        logras="Comparar meses entre sí y con referencias del sector (XM, Climate Bonds, Lehner et al.), con las cifras sacadas de los mismos datos de la app."
        resultados="Indicadores del periodo, tabla y gráficos mes a mes, tiempo en línea y arranques por unidad, y sostenibilidad del embalse." />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <SelectorRango T={T} min={minD} max={maxD} valor={rango} onChange={setRango} />
        <span style={{ fontSize: 12, color: T.inkFaint }}>{cargando ? "Cargando histórico…" : error ? `Error: ${error}` : `Histórico desde ${fechaCorta(minD)} · solo días completos (${res.dias} días${res.diasIncompletos ? `; ${res.diasIncompletos} incompletos fuera del cálculo` : ""})`}</span>
      </div>

      <div className="itu-kpis" style={{ marginBottom: 14 }}>
        <Kpi T={T} rotulo="Energía generada" valor={res.energia / 1000} decimales={1} unidad="GWh" nota={`${res.dias} días completos · ${fmtNum(res.energia / Math.max(1, res.horas), 0)} MW en promedio`} />
        <Kpi T={T} rotulo="Factor de planta nominal" valor={res.fpNominal} decimales={1} unidad="%" tip={`Energía generada ÷ (capacidad nominal en operación × horas). Capacidad nominal: ${capNomHoy / MW_NOMINAL_UNIDAD} unidades × ${MW_NOMINAL_UNIDAD} MW = ${fmtNum(capNomHoy, 0)} MW (UG1–UG4; UG5–UG8 entran a finales de 2027 o comienzos de 2028; diseño: ${fmtNum(CAPACIDAD_DISENO_MW, 0)} MW).`}
          nota={`Sobre ${fmtNum(capNomHoy, 0)} MW nominales en operación`} />
        <Kpi T={T} rotulo="Factor de planta real" valor={res.fpReal} decimales={1} unidad="%" tip="Energía generada ÷ (capacidad real demostrada × horas). Capacidad real demostrada: la mayor potencia media de un día completo con todas las unidades en línea (sostenida 24 h, no un pico). Se busca en todo el histórico."
          nota={capReal ? `Sobre ${fmtNum(capReal.mw, 1)} MW demostrados (${fechaCorta(capReal.dia)})` : "Sin un día completo con todas las unidades"} />
        <Kpi T={T} rotulo="Horas equivalentes a plena carga" valor={res.horasEquivalentes} decimales={0} unidad="h" nota={`de ${fmtNum(res.horas, 0)} h del periodo, a ${fmtNum(capNomHoy, 0)} MW`} />
        <Kpi T={T} rotulo="Energía equivalente del agua vertida" valor={res.vertidaMWh / 1000} decimales={1} unidad="GWh" tip="Volumen vertido × F.C. del día ÷ 3600: la energía que ese volumen habría dado en las turbinas. Es una oportunidad, no una pérdida contable: parte del vertimiento puede ser obligado (creciente, regla, capacidad de las unidades)."
          nota={res.vertidaMWh > 0 ? `${pct(res.vertidaPct)} de lo generado · ${res.diasConVertimiento} días con vertimiento` : "Sin vertimiento en el periodo"} />
        <Kpi T={T} rotulo="Aportes frente a la media histórica" valor={apPeriodo ? apPeriodo.pct : null} decimales={0} unidad="% de la media"
          tip={`Caudal medio en Olaya (estación aguas arriba) en los meses del periodo frente a la media de esos mismos meses en los años anteriores (desde ${ap && ap.desde ? ap.desde.slice(0, 4) : "2015"}), como XM reporta los aportes hídricos.`}
          estado={apPeriodo ? <Estado T={T} compacto tipo={apPeriodo.pct >= 90 ? "bien" : apPeriodo.pct >= 60 ? "aviso" : "serio"}>{apPeriodo.pct >= 100 ? "Sobre la media" : "Bajo la media"}</Estado> : null}
          nota={apPeriodo ? `${fmtNum(apPeriodo.q, 0)} m³/s frente a ${fmtNum(apPeriodo.media, 0)} m³/s de media` : aportes.cargando ? "Cargando el histórico de caudales…" : "Sin histórico de caudales"} />
      </div>

      {mensual.length > 0 && (
        <Tarjeta T={T} titulo="Mes a mes" subtitulo="Solo días completos. Factor de planta nominal sobre la capacidad nominal en operación; real, sobre la capacidad demostrada." accion={<BotonCSV T={T} data={csvMensual} filename={`indicadores_mensuales_${rango.desde}_${rango.hasta}.csv`} />}>
          <div className="itu-tabla"><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead><tr>{["Mes", "Días", "Energía (GWh)", "F. planta nominal", "F. planta real", "Horas equiv.", "E. vertida eq. (GWh)", "Aportes Olaya (% media)", "Arranques"].map((h, i) => <th key={h} style={{ ...th, textAlign: i ? "right" : "left" }}>{h}</th>)}</tr></thead>
            <tbody>{mensual.map((m) => {
              const a = ap ? ap.olaya.find((x) => x.mes === m.mes) : null;
              return (
                <tr key={m.mes} style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                  <td style={{ ...td, textAlign: "left" }}>{nombreMes(m.mes)}</td>
                  <td style={td}>{m.dias}</td>
                  <td style={td}>{fmtNum(m.energia / 1000, 1)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{pct(m.fpNominal)}</td>
                  <td style={td}>{pct(m.fpReal)}</td>
                  <td style={td}>{fmtNum(m.horasEquivalentes, 0)}</td>
                  <td style={td}>{m.vertidaMWh > 0 ? `${fmtNum(m.vertidaMWh / 1000, 1)} (${pct(m.vertidaPct)})` : "—"}</td>
                  <td style={td}>{a && a.pct != null ? pct(a.pct, 0) : "—"}</td>
                  <td style={td}>{m.unidades.reduce((s, u) => s + u.arranques, 0)}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </Tarjeta>
      )}

      {mensual.length > 0 && (
        <div className="itu-2col">
          <Tarjeta T={T} titulo="Factor de planta por mes">
            <GraficoSeries T={T} tipoX="numero" categorias={catMes} ejeX="Mes" x={xMes} barras unidad="%" ejeY="%" decimales={1} alto={220} incluirCero nombreArchivo="factor_planta_mensual"
              series={[{ nombre: `Nominal (${fmtNum(capNomHoy, 0)} MW)`, datos: mensual.map((m) => m.fpNominal), indice: 0 }, { nombre: `Real (${capReal ? fmtNum(capReal.mw, 0) : "—"} MW demostrados)`, datos: mensual.map((m) => m.fpReal), indice: 6 }]} />
          </Tarjeta>
          <Tarjeta T={T} titulo="Energía equivalente del agua vertida por mes">
            <GraficoSeries T={T} tipoX="numero" categorias={catMes} ejeX="Mes" x={xMes} barras unidad="GWh" ejeY="GWh" decimales={1} alto={220} incluirCero nombreArchivo="energia_vertida_mensual"
              series={[{ nombre: "Energía equivalente vertida", datos: mensual.map((m) => m.vertidaMWh / 1000), indice: 1 }]} mensajeVacio="Sin vertimiento en el periodo." />
          </Tarjeta>
        </div>
      )}

      {apMeses.length > 0 && (
        <Tarjeta T={T} titulo="Aportes frente a la media histórica (Olaya)" subtitulo={`Caudal medio de cada mes frente a la media del mismo mes en los años anteriores con el mes completo${ap && ap.desde ? ` (registro desde ${ap.desde.slice(0, 4)})` : ""}. Franja: mínimo y máximo históricos de ese mes.`}>
          <GraficoSeries T={T} tipoX="numero" categorias={catAp} ejeX="Mes" x={xAp} unidad="m³/s" ejeY="m³/s" decimales={0} alto={240} nombreArchivo="aportes_media_historica"
            series={[
              { nombre: "Mínimo histórico del mes", datos: apMeses.map((m) => m.minHist ?? null), color: T.inkFaint, dash: true, ancho: 1 },
              { nombre: "Máximo histórico del mes", datos: apMeses.map((m) => m.maxHist ?? null), color: T.inkFaint, dash: true, ancho: 1 },
              { nombre: "Media histórica del mes", datos: apMeses.map((m) => m.media ?? null), color: T.ink, dash: true, ancho: 1.6, puntos: true },
              { nombre: "Caudal medio del mes", datos: apMeses.map((m) => m.q), indice: 0, ancho: 2.4, puntos: true },
            ]} bandas={[{ desde: 0, hasta: 1, relleno: "rgba(148,163,184,0.12)" }]} />
          {apMeses.some((m) => m.dias < 25) && <div style={{ fontSize: 11.5, color: T.inkFaint }}>El último mes está en curso ({apMeses[apMeses.length - 1].dias} días).</div>}
        </Tarjeta>
      )}

      {res.unidades.length > 0 && (
        <Tarjeta T={T} titulo="Tiempo en línea y arranques por unidad" subtitulo="Porcentaje de las horas del periodo en que cada unidad estuvo generando. No es la disponibilidad: sin el registro de indisponibilidades no se distingue una unidad disponible no despachada de una en mantenimiento.">
          <div className="itu-tabla"><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead><tr>{["Unidad", "Horas en línea", "Tiempo en línea", "Energía (GWh)", `F. planta (${MW_NOMINAL_UNIDAD} MW)`, "Arranques"].map((h, i) => <th key={h} style={{ ...th, textAlign: i ? "right" : "left" }}>{h}</th>)}</tr></thead>
            <tbody>{res.unidades.map((u) => (
              <tr key={u.unidad} style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{u.unidad}</td>
                <td style={td}>{fmtNum(u.horas, 0)} h</td>
                <td style={td}>{pct(u.pctTiempo, 0)}</td>
                <td style={td}>{fmtNum(u.energia / 1000, 1)}</td>
                <td style={td}>{pct(u.fpNominal)}</td>
                <td style={td}>{u.arranques}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </Tarjeta>
      )}

      <div className="itu-2col">
        <Tarjeta T={T} titulo="Energía embalsada útil" subtitulo="El agua entre el nivel mínimo técnico (390 msnm) y el nivel actual, convertida con el F.C. de Hidrometría al nivel actual (como XM reporta las reservas en energía).">
          {emb ? (
            <div className="itu-kpis">
              <Kpi T={T} rotulo="Energía embalsada útil" valor={emb.gwh} decimales={0} unidad="GWh" actualizado={vivo && vivo.ultima ? vivo.ultima.t : null} nota={`de ${fmtNum(emb.gwhMax, 0)} GWh en el NAMO`} />
              <Kpi T={T} rotulo="Volumen útil" valor={emb.pctUtil} decimales={1} unidad="%" nota={`${fmtNum(emb.vUtilHm3, 0)} de ${fmtNum(emb.vUtilMaxHm3, 0)} hm³`} />
              <Kpi T={T} rotulo="Horas a plena carga" valor={(emb.gwh * 1000) / capNomHoy} decimales={0} unidad="h" nota={`a ${fmtNum(capNomHoy, 0)} MW sin aportes (≈ ${fmtNum((emb.gwh * 1000) / capNomHoy / 24, 1)} días)`} />
            </div>
          ) : <div style={{ fontSize: 13, color: T.inkFaint }}>Sin nivel en vivo.</div>}
          <Nota T={T} rotulo="Cómo se valida">Con la curva cota-volumen de la app, subir de 408 a 420 msnm agrega 424 hm³ (≈ 206 GWh); EPM publicó para esa misma franja «cerca de 400 millones de m³» y «unos 187 GWh». El orden coincide; la diferencia sale de la curva y del F.C. usado.</Nota>
        </Tarjeta>

        <Tarjeta T={T} titulo="Sostenibilidad del embalse" subtitulo="Indicadores de referencia internacional calculados con las curvas oficiales del embalse (CGI, LIDAR 2012: volumen con la Ec.2 y área con la Tabla 3) y el histórico de caudales.">
          {sost ? (
            <div className="itu-tabla"><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <tbody>
                {[
                  ["Densidad de potencia", `${fmtNum(sost.densidad, 1)} W/m²`, `${fmtNum(capNomHoy, 0)} MW en operación sobre ${fmtNum(sost.areaNAMOKm2, 1)} km² de espejo en el NAMO; con los ${fmtNum(CAPACIDAD_DISENO_MW, 0)} MW de diseño: ${fmtNum(sost.densidadDiseno, 1)} W/m². Criterio de Climate Bonds para centrales desde 2020: más de 10 W/m².`, sost.densidad > 10 ? "bien" : sost.densidad > 5 ? "aviso" : "serio"],
                  ["Área inundada por MW", `${fmtNum(sost.haPorMW, 1)} ha/MW`, "Inverso de la densidad de potencia, con la capacidad en operación.", null],
                  ["Grado de regulación (DOR)", sost.dorTotal != null ? `${fmtNum(sost.dorTotal, 1)} %` : "—", sost.qMedioAnual ? `Volumen del embalse en el NAMO (${fmtNum(sost.vTotalNAMOHm3, 0)} hm³) frente al volumen medio anual del río en Olaya (${fmtNum(sost.qMedioAnual.q, 0)} m³/s, ${sost.qMedioAnual.desde}–${sost.qMedioAnual.hasta}). Con el volumen útil: ${fmtNum(sost.dorUtil, 1)} %. Lehner et al. (2011): desde 2 % el río se considera regulado; 100 % = guarda un año de caudal.` : "Falta el histórico de caudales.", sost.dorTotal != null ? (sost.dorTotal >= 2 ? "aviso" : "bien") : null],
                  ["Tiempo de residencia del agua", sost.residenciaDias != null ? `${fmtNum(sost.residenciaDias, 1)} días` : "—", `Volumen embalsado ÷ caudal de entrada de hoy${sost.residenciaMediaDias != null ? `; con el caudal medio anual: ${fmtNum(sost.residenciaMediaDias, 1)} días` : ""}. Influye en la calidad del agua y en las emisiones del embalse.`, null],
                ].map(([n, v, nota, tipo]) => (
                  <tr key={n} style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                    <td style={{ padding: "8px 8px", color: T.ink, fontWeight: 700, verticalAlign: "top", whiteSpace: "nowrap" }}>{n}</td>
                    <td style={{ padding: "8px 8px", verticalAlign: "top", whiteSpace: "nowrap" }}>{tipo ? <Estado T={T} compacto tipo={tipo}>{v}</Estado> : <b style={{ color: T.ink }}>{v}</b>}</td>
                    <td style={{ padding: "8px 8px", color: T.inkMuted, lineHeight: 1.45 }}>{nota}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          ) : <div style={{ fontSize: 13, color: T.inkFaint }}>Sin nivel en vivo.</div>}
          <Nota T={T} rotulo="Qué no se incluye y por qué">Huella hídrica (falta la evaporación medida sobre el embalse), disponibilidad e indisponibilidad forzada (falta el registro de indisponibilidades) y emisiones de gases de efecto invernadero (requieren un estudio G-res del embalse). El área del espejo sale de la Tabla 3 de la memoria del CGI (curvas de nivel del LIDAR de 2012), sin la sedimentación posterior.</Nota>
        </Tarjeta>
      </div>
    </>
  );
}
