/* ============================================================
   Analítica — Validación y confiabilidad: qué se verifica de lo que
   entrega la app, contra qué, con qué resultado y qué tan confiable
   es cada número. Se recalcula solo con cada día que llega.
   ============================================================ */
import { useCallback, useMemo, useState } from "react";
import { textoHoraColombia } from "../modelo.js";
import { useDatos, useCargaPeriodica } from "../datos/fuentes.jsx";
import { useVivo } from "../datos/vivo.jsx";
import { errorPronosticoHF } from "../analitica.js";
import { useHistoricoDiario } from "../datos/historico.js";
import { GraficoSeries, Estado, fmtNum } from "./graficos.jsx";
import { Proposito, Tarjeta, Kpi, RequiereConexion, SelectorRango, rangoUltimos, fechaCorta } from "./comunes.jsx";

const mediana = (a) => { const b = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!b.length) return null; const n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };
const cuantil = (a, p) => { const b = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * (b.length - 1) + 0.5))] : null; };
const NIVEL = { alta: { tipo: "bien", txt: "Alta" }, media: { tipo: "aviso", txt: "Media" }, baja: { tipo: "critico", txt: "Baja" }, relativa: { tipo: "neutro", txt: "Solo relativa" }, sin: { tipo: "neutro", txt: "Sin datos" } };

export default function Confiabilidad({ T }) {
  const d = useDatos();
  const { vivo } = useVivo();
  const { datos, error } = useHistoricoDiario();
  const minD = datos?.dias?.[0]?.dia, maxD = datos?.dias?.[datos.dias.length - 1]?.dia;
  const [rangoSel, setRango] = useState(null);
  const rango = rangoSel || rangoUltimos(maxD, "90", minD);
  const dias = useMemo(() => (datos?.dias || []).filter((x) => x.dia >= rango.desde && x.dia <= rango.hasta), [datos, rango.desde, rango.hasta]);
  const tend = useCargaPeriodica(useCallback(async () => (d.conectado ? d.leerJSON("hf/tendencia.json").catch(() => null) : null), [d]), [d], 30 * 60e3);

  const m = useMemo(() => {
    if (!dias.length) return null;
    const cerrados = dias.filter((x) => !x.parcial || x.dia < (vivo?.hoy || "9999"));
    const conCal = cerrados.filter((x) => x.calidad);
    const completos = conCal.filter((x) => x.calidad.minutosGen >= 0.95 * 1440 && x.calidad.minutosNivel >= 0.95 * 1440);
    const huecoMax = Math.max(0, ...conCal.filter((x) => x.dia < (vivo?.hoy || "9999")).map((x) => x.calidad.maxHuecoMin));
    const congelado = Math.max(0, ...conCal.map((x) => x.calidad.nivelCongeladoMin));
    const difS = conCal.map((x) => x.nivel.difSensores).filter((x) => x != null);
    const col = conCal.filter((x) => x.calidad.columnaFC && x.dia >= "2026-10-31");
    const colMin = col.reduce((a, x) => a + x.calidad.columnaFC.minutos, 0), colOk = col.reduce((a, x) => a + x.calidad.columnaFC.coinciden, 0);
    const vert = conCal.filter((x) => x.calidad.vertedero);
    const vMin = vert.reduce((a, x) => a + x.calidad.vertedero.minutos, 0);
    const vErr = vMin ? vert.reduce((a, x) => a + x.calidad.vertedero.errMedianaPct * x.calidad.vertedero.minutos, 0) / vMin : null;
    const rel = conCal.map((x) => x.calidad.modeloVsHidrometria).filter((x) => x != null);
    const relDesde = conCal.filter((x) => x.dia >= "2026-10-30").map((x) => x.calidad.modeloVsHidrometria).filter((x) => x != null);
    const val = cerrados.map((x) => x.validacion).filter(Boolean);
    const eAyer = val.map((x) => x.errCmEntradaAyer).filter((x) => x != null), eMismo = val.map((x) => x.errCmMismoDia);
    return {
      nDias: cerrados.length, completos: completos.length, huecoMax, congelado,
      difSensores: difS.length ? mediana(difS) : null,
      columna: colMin ? { pct: (100 * colOk) / colMin, minutos: colMin } : null,
      vertedero: vMin ? { err: vErr, minutos: vMin, dias: vert.length, errMax: Math.max(...vert.map((x) => x.calidad.vertedero.errMaxAbsPct)) } : null,
      modelo: rel.length ? { med: mediana(rel), min: Math.min(...rel), max: Math.max(...rel), medDesde: mediana(relDesde) } : null,
      despacho: val.length ? { n: val.length, ayerMed: mediana(eAyer.map(Math.abs)), ayerP90: cuantil(eAyer.map(Math.abs), 0.9), mismoMed: mediana(eMismo.map(Math.abs)), mismoP90: cuantil(eMismo.map(Math.abs), 0.9), sesgoMismo: mediana(eMismo) } : null,
    };
  }, [dias, vivo]);

  // Pronóstico de HydroForecast: error a 1, 3 y 7 días con las emisiones archivadas y el observado diario
  const pron = useMemo(() => {
    const em = tend.datos?.emisiones, obs = vivo?.hf?.observado?.datos?.data;
    if (!em || !obs) return null;
    const o = new Map(obs.map((r) => [String(r.timestamp).slice(0, 10), r.QSitioPresa_obs]));
    return errorPronosticoHF(em, o, vivo.hoy);
  }, [tend.datos, vivo]);

  const hoy = vivo?.hoy;
  const s = useMemo(() => {
    if (!dias.length) return null;
    const t = dias.map((x) => `${x.dia} 12:00`);
    return {
      t,
      nivel: [
        { nombre: "Con la entrada del día anterior (como pronóstico)", datos: dias.map((x) => x.validacion?.errCmEntradaAyer ?? null), indice: 1, puntos: true, ancho: 1.4 },
        { nombre: "Con la entrada del mismo día (solo el modelo)", datos: dias.map((x) => x.validacion?.errCmMismoDia ?? null), indice: 0, puntos: true, ancho: 1.8 },
      ],
      modelo: [{ nombre: "Q modelo / Q Hidrometría (central)", datos: dias.map((x) => x.calidad?.modeloVsHidrometria ?? null), indice: 0, puntos: true }],
      completitud: [
        { nombre: "Generación", datos: dias.map((x) => (x.calidad && x.dia !== hoy ? (100 * x.calidad.minutosGen) / 1440 : null)), indice: 0, puntos: true },
        { nombre: "Nivel", datos: dias.map((x) => (x.calidad && x.dia !== hoy ? (100 * x.calidad.minutosNivel) / 1440 : null)), indice: 2, puntos: true, dash: true },
      ],
      vertedero: [{ nombre: "Tabla 10.6 − LoggerNet (mediana del día)", datos: dias.map((x) => x.calidad?.vertedero?.errMedianaPct ?? null), indice: 1, puntos: true, soloPuntos: true }],
    };
  }, [dias, hoy]);

  const guia = (
    <Proposito T={T} id="confiabilidad" titulo="Validación y confiabilidad" fuente="Verificaciones automáticas con cada día que llega, más las pruebas del modelo"
      para="Saber cuánto confiar en cada número que entrega la app: qué se verifica, contra qué referencia y con qué resultado."
      logras="Usar los resultados con su margen de error conocido, detectar a tiempo datos malos (huecos, sensores congelados o desfasados) y ver si el modelo se separa de la operación."
      resultados="Tabla de verificaciones con su estado, nivel de confianza de cada salida y gráficos día a día: error del nivel proyectado, modelo frente a Hidrometría, completitud de datos y vertedero frente a la Tabla 10.6." />
  );
  if (!d.conectado) return <>{guia}<RequiereConexion T={T} que="las verificaciones con los datos de operación" /></>;

  const fila = (que, contra, resultado, criterio, conf) => ({ que, contra, resultado, criterio, conf });
  const filas = m ? [
    fila("Datos de LoggerNet completos", "1.440 minutos por día (generación y nivel)", `${m.completos} de ${m.nDias} días ≥ 95 %; hueco máximo ${fmtNum(m.huecoMax, 0)} min`, "≥ 95 % de los minutos", m.completos >= 0.95 * m.nDias ? NIVEL.alta : NIVEL.media),
    fila("Nivel del radar sin congelarse", "Cambios del valor minuto a minuto", `Máximo ${fmtNum(m.congelado, 0)} min seguidos con el mismo valor`, "< 3 h", m.congelado < 180 ? NIVEL.alta : NIVEL.media),
    fila("Segundo sensor de nivel", "Radar", m.difSensores != null ? `Diferencia mediana ${fmtNum(m.difSensores, 2)} m${Math.abs(m.difSensores) > 5 ? " (otra referencia o sensor fuera de servicio: la app usa solo el radar)" : ""}` : "Sin dato", "< 0,5 m", m.difSensores == null ? NIVEL.sin : Math.abs(m.difSensores) < 0.5 ? NIVEL.alta : NIVEL.baja),
    fila("Caudal regulado (P / F.C.)", "Columna QTurbinadoUx_FC de LoggerNet (Hidrometría), desde el 31-oct", m.columna ? `${fmtNum(m.columna.pct, 2)} % de ${m.columna.minutos.toLocaleString("es-CO")} minutos coinciden (±0,2 %)` : "Sin datos", "100 %", m.columna ? (m.columna.pct > 99.5 ? NIVEL.alta : NIVEL.media) : NIVEL.sin),
    fila("Regla operativa diaria", "Recálculo independiente (pandas) y tablero de Hidrometría", "Mismo estado en todos los días revisados y diferencias de redondeo (3-nov-2026); promedio y banda iguales a los del tablero de Hidrometría", "Mismo estado todos los días", NIVEL.alta),
    fila("Caudal del vertedero", "Tabla 10.6 de calibración con las aperturas medidas", m.vertedero ? `Diferencia media ${fmtNum(m.vertedero.err, 2)} %, máx. ${fmtNum(m.vertedero.errMax, 1)} % (${m.vertedero.minutos.toLocaleString("es-CO")} min en ${m.vertedero.dias} días)` : "Sin vertimiento en el rango", "< 1 %", m.vertedero ? (Math.abs(m.vertedero.err) < 1 ? NIVEL.alta : NIVEL.media) : NIVEL.sin),
    fila("Modelo de la turbina", "Caudal de Hidrometría (P / F.C.), central completa", m.modelo ? `Q modelo / Q Hidrometría entre ${fmtNum(m.modelo.min, 3)} y ${fmtNum(m.modelo.max, 3)}${m.modelo.medDesde != null ? `; desde el F.C. por nivel, ${fmtNum(m.modelo.medDesde, 3)}` : ""}` : "Sin datos", "±3 %", m.modelo ? (Math.abs((m.modelo.medDesde ?? m.modelo.med) - 1) <= 0.03 ? NIVEL.media : NIVEL.baja) : NIVEL.sin),
    fila("Nivel proyectado a 24 h (Despacho)", "Nivel medido del radar a las 24 h, días sin vertimiento", m.despacho ? `Con la entrada de ayer: ${fmtNum(m.despacho.ayerMed, 1)} cm (P90 ${fmtNum(m.despacho.ayerP90, 0)} cm). Solo el modelo: ${fmtNum(m.despacho.mismoMed, 1)} cm (P90 ${fmtNum(m.despacho.mismoP90, 0)} cm). ${m.despacho.n} días` : "Sin días evaluables", "< 10 cm (mediana)", m.despacho ? (m.despacho.ayerMed < 10 ? NIVEL.media : NIVEL.baja) : NIVEL.sin),
    fila("Pronóstico de HydroForecast (Sitio Presa)", "Observado diario", pron ? pron.map((p) => `${p.L} d: ${p.mape != null ? `${fmtNum(p.mape, 1)} % (${p.n} día${p.n === 1 ? "" : "s"})` : "aún sin días"}`).join(" · ") : "Sin emisiones archivadas", "Indicativo con pocas emisiones", pron && pron.some((p) => p.n >= 10) ? NIVEL.media : NIVEL.relativa),
    fila("Colina (diagrama de la turbina)", "186 puntos del ensayo de modelo (2013) y 35 BEP fuera de muestra", "Error medio 0,035 % en Q y 0,06 % en P; 0,08 pp en η (pruebas automáticas en cada publicación)", "< 0,5 %", NIVEL.alta),
    fila("Winter-Kennedy por unidad", "Sin referencia: no está calibrado", "Se usa solo para comparar unidades y ver tendencias", "Calibración pendiente", NIVEL.relativa),
  ] : [];

  return (
    <>
      {guia}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <SelectorRango T={T} min={minD} max={maxD} valor={rango} onChange={setRango} />
        {datos && <span style={{ fontSize: 12.5, color: T.inkFaint }}>Último dato {fechaCorta(datos.estado.ultimoDato)} · verificaciones actualizadas {fechaCorta(textoHoraColombia(new Date(datos.estado.generado)))}</span>}
        {error && <Estado T={T} tipo="critico" compacto>{error.message}</Estado>}
      </div>
      {m && (
        <>
          <Tarjeta T={T} titulo="¿Qué tan confiable es cada resultado?" subtitulo="Cada fila compara una salida de la app con una referencia independiente, en el rango de fechas elegido. Las de la regla y la colina son pruebas fijas; las demás se recalculan solas cada hora.">
            <div className="itu-tabla">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.8, lineHeight: 1.45 }}>
                <thead><tr style={{ color: T.inkFaint, textAlign: "left" }}>
                  {["Qué se verifica", "Contra qué", "Resultado", "Criterio", "Confianza"].map((h) => <th key={h} style={{ padding: "6px 8px", borderBottom: `1px solid ${T.line}` }}>{h}</th>)}
                </tr></thead>
                <tbody>{filas.map((f) => (
                  <tr key={f.que} style={{ borderTop: `1px solid ${T.lineSoft}`, verticalAlign: "top" }}>
                    <td style={{ padding: "7px 8px", color: T.ink, fontWeight: 600, minWidth: 150 }}>{f.que}</td>
                    <td style={{ padding: "7px 8px", color: T.inkMuted, minWidth: 160 }}>{f.contra}</td>
                    <td style={{ padding: "7px 8px", color: T.ink, minWidth: 220 }}>{f.resultado}</td>
                    <td style={{ padding: "7px 8px", color: T.inkMuted, whiteSpace: "nowrap" }}>{f.criterio}</td>
                    <td style={{ padding: "7px 8px" }}><Estado T={T} compacto tipo={f.conf.tipo}>{f.conf.txt}</Estado></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Tarjeta>
          {m.despacho && (
            <div className="itu-kpis" style={{ marginBottom: 16 }}>
              <Kpi T={T} rotulo="Error típico del nivel a 24 h" valor={m.despacho.ayerMed} unidad="cm" nota="Mediana del error absoluto usando como entrada la del día anterior: es lo que verá el operador con un pronóstico sencillo" />
              <Kpi T={T} rotulo="Error del modelo de la turbina en el nivel" valor={m.despacho.mismoMed} unidad="cm" nota={`Con la entrada correcta; sesgo mediano ${fmtNum(m.despacho.sesgoMismo, 1)} cm. Mide el modelo frente al caudal de Hidrometría`} />
              {m.modelo && <Kpi T={T} rotulo="Q modelo / Q Hidrometría" valor={m.modelo.medDesde ?? m.modelo.med} decimales={3} nota="Mediana diaria. Las dos son estimaciones: la fórmula del F.C. no es una medición del caudal" />}
              {m.vertedero && <Kpi T={T} rotulo="Vertedero: Tabla 10.6 frente a LoggerNet" valor={m.vertedero.err} decimales={2} unidad="%" nota="LoggerNet calcula el caudal con la apertura: la coincidencia confirma que usan la misma calibración" />}
            </div>
          )}
          <Tarjeta T={T} titulo="Error del nivel proyectado a 24 h, día a día" subtitulo="Positivo = la app proyectó más alto que lo medido. La entrada al embalse es lo que más pesa: 10 m³/s sostenidos 24 h son unos 2,5 cm.">
            <GraficoSeries T={T} x={s.t} series={s.nivel} unidad="cm" ejeY="cm" grupo="conf" nombreArchivo="validacion_nivel" referencias={[{ y: 0, rotulo: "0", dash: false, incluir: true }, { y: 10, rotulo: "+10 cm" }, { y: -10, rotulo: "−10 cm" }]} />
          </Tarjeta>
          <div className="itu-2col">
            <Tarjeta T={T} titulo="Modelo frente a Hidrometría" subtitulo="El salto del 29–30 de octubre es el cambio de fórmula del F.C. (de 1,62 a 0,0119·N − 3,178).">
              <GraficoSeries T={T} x={s.t} series={s.modelo} unidad="" ejeY="relación" decimales={3} grupo="conf" alto={220} nombreArchivo="validacion_modelo" referencias={[{ y: 1, rotulo: "1,00", incluir: true }]} />
            </Tarjeta>
            <Tarjeta T={T} titulo="Completitud de los datos" subtitulo="Porcentaje de los 1.440 minutos del día con dato (sin el día en curso).">
              <GraficoSeries T={T} x={s.t} series={s.completitud} unidad="%" ejeY="%" decimales={1} grupo="conf" alto={220} nombreArchivo="validacion_completitud" yMax={100.5} />
            </Tarjeta>
          </div>
          {m.vertedero && (
            <Tarjeta T={T} titulo="Vertedero: Tabla 10.6 frente a LoggerNet (días con vertimiento)">
              <GraficoSeries T={T} x={s.t} series={s.vertedero} unidad="%" ejeY="%" decimales={2} grupo="conf" alto={200} nombreArchivo="validacion_vertedero" referencias={[{ y: 0, rotulo: "0", dash: false, incluir: true }]} />
            </Tarjeta>
          )}
        </>
      )}
    </>
  );
}
