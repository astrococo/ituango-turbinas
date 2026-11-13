/* ============================================================
   Analítica — Comportamiento de cada unidad. Las 4 unidades (y las
   4 futuras) comparten la misma colina, pero cada máquina rinde
   distinto. Con los datos de cada minuto se comparan:
   - P / F.C. (Hidrometría): igual para todas por construcción;
   - Winter-Kennedy (WK) de cada unidad, sin calibrar: índice
     RELATIVO (sirve para comparar máquinas y ver tendencias);
   - el modelo de la colina con la condición de descarga actual.
   ============================================================ */
import { useMemo, useState } from "react";
import { UNIDADES_CENTRAL, ordenDeMerito, textoHoraColombia } from "../modelo.js";
import { indiceRelativoUnidades } from "../analitica.js";
import { useDatos } from "../datos/fuentes.jsx";
import { useHistoricoDiario, useHorario } from "../datos/historico.js";
import { GraficoSeries, Estado, fmtNum, colorSerie } from "./graficos.jsx";
import { Proposito, Tarjeta, RequiereConexion, SelectorRango, rangoUltimos, fechaCorta, Nota } from "./comunes.jsx";
import { GraficoApertura } from "./Apertura.jsx";

const mediana = (a) => { const b = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!b.length) return null; const n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };

export default function Unidades({ T }) {
  const d = useDatos();
  const { datos, error } = useHistoricoDiario();
  const minD = datos?.dias?.[0]?.dia, maxD = datos?.dias?.[datos.dias.length - 1]?.dia;
  const [rangoSel, setRango] = useState(null);
  const rango = rangoSel || rangoUltimos(maxD, "30", minD);
  const periodo = `${rango.desde}_${rango.hasta}`;
  const dias = useMemo(() => (datos?.dias || []).filter((x) => x.dia >= rango.desde && x.dia <= rango.hasta), [datos, rango.desde, rango.hasta]);
  const nU = dias.reduce((k, x) => Math.max(k, x.unidades.length), 0);
  const cerrados = useMemo(() => dias.filter((x) => !x.parcial), [dias]);
  const indice = useMemo(() => (cerrados.length ? indiceRelativoUnidades(cerrados) : []), [cerrados]);
  const merito = useMemo(() => ordenDeMerito(indice.filter((x) => x.factor != null).map((x) => x.unidad), indice.map((x) => x.factor)), [indice]);
  // Curva de rendimiento relativo: horario del periodo (máx. 92 días para no descargar de más)
  const rangoCurva = useMemo(() => {
    if (!dias.length) return [null, null];
    const hasta = dias[dias.length - 1].dia;
    const desde = dias.length > 92 ? dias[dias.length - 92].dia : dias[0].dia;
    return [desde, hasta];
  }, [dias]);
  const horario = useHorario(rangoCurva[0], rangoCurva[1]);

  const resumen = useMemo(() => Array.from({ length: nU }, (_, u) => {
    const us = dias.map((x) => x.unidades[u]).filter(Boolean);
    const h = us.reduce((a, x) => a + (x.horas || 0), 0);
    const e = us.reduce((a, x) => a + (x.energia || 0), 0);
    const arr = us.reduce((a, x) => a + (x.arranques || 0), 0);
    const pondera = (k) => { let s = 0, w = 0; us.forEach((x) => { if (x[k] != null && x.horas >= 1) { s += x[k] * x.horas; w += x.horas; } }); return w ? s / w : null; };
    // Q WK / Q Hidrometría = F.C. Hidrometría / F.C. WK (por día, ponderado por horas)
    let s = 0, w = 0;
    dias.forEach((x) => { const un = x.unidades[u]; if (un && un.fcWK && x.fc && un.horas >= 1) { s += (x.fc / un.fcWK) * un.horas; w += un.horas; } });
    return { u, horas: h, energia: e, arranques: arr, pMedia: h ? e / h : null, fcWK: indice[u]?.fcWK ?? null, factor: indice[u]?.factor ?? null, etaWK: pondera("etaWK"), etaMod: pondera("etaMod"), relModFC: pondera("relModFC"), relWKFC: w ? s / w : null };
  }), [dias, nU, indice]);

  const s = useMemo(() => {
    if (!dias.length) return null;
    const t = dias.map((x) => `${x.dia} 12:00`);
    const por = (f) => Array.from({ length: nU }, (_, u) => ({ nombre: `U${u + 1}`, indice: u, datos: dias.map((x) => (x.unidades[u] && x.unidades[u].horas >= 1 ? f(x.unidades[u], x) : null)), puntos: dias.length <= 60 }));
    return {
      t,
      fcWK: [...por((un) => un.fcWK), { nombre: "F.C. Hidrometría (vigente)", datos: dias.map((x) => x.fc), color: T.inkFaint, dash: true, ancho: 1.6 }],
      relWK: por((un, x) => (un.fcWK && x.fc ? x.fc / un.fcWK : null)),
      relMod: por((un) => un.relModFC),
      eta: [...por((un) => un.etaWK), { nombre: "η modelo (mediana de las unidades)", datos: dias.map((x) => mediana(x.unidades.map((un) => un.etaMod))), color: T.inkFaint, dash: true, ancho: 1.6 }],
      // horas en línea: 0 h es un dato (unidad detenida); los días incompletos no se grafican (no son paradas)
      horas: Array.from({ length: nU }, (_, u) => ({ nombre: `U${u + 1}`, indice: u, datos: dias.map((x) => (x.parcial || !x.unidades[u] ? null : x.unidades[u].horas)), nulos: dias.map((x) => (x.parcial ? "día incompleto en los datos" : "")), puntos: dias.length <= 60 })),
    };
  }, [dias, nU, T]);

  // Curva: Q modelo / Q WK por tramos de potencia (10 MW), mediana por unidad, solo horas completas en línea
  const curva = useMemo(() => {
    const h = horario.datos;
    if (!h || !h.t.length) return null;
    const tramos = new Map();
    h.t.forEach((_, i) => {
      const p = h.p[i], qm = h.qMod[i], qw = h.qWK[i], l = h.linea[i];
      if (!p || !qm || !qw || !l) return;
      p.forEach((pu, u) => {
        if (pu == null || qm[u] == null || qw[u] == null || qw[u] <= 0 || (l[u] ?? 0) < 0.95) return;
        const b = Math.round(pu / 10) * 10;
        if (!tramos.has(b)) tramos.set(b, Array.from({ length: nU }, () => []));
        tramos.get(b)[u].push(qm[u] / qw[u]);
      });
    });
    const xs = [...tramos.keys()].sort((a, b) => a - b);
    return { x: xs, series: Array.from({ length: nU }, (_, u) => ({ nombre: `U${u + 1}`, indice: u, puntos: true, datos: xs.map((b) => (tramos.get(b)[u].length >= 3 ? mediana(tramos.get(b)[u]) : null)), decimales: 3 })) };
  }, [horario.datos, nU]);

  // Apertura del distribuidor estimada, hora a hora (mismo periodo que la curva)
  const apertura = useMemo(() => {
    const h = horario.datos;
    if (!h || !h.t.length) return null;
    const conDato = h.gamma.some((g) => g && g.some((x) => x != null));
    return { t: h.t, filas: h.gamma, lineas: h.linea, conDato };
  }, [horario.datos]);

  const guia = (
    <Proposito T={T} id="unidades" titulo="Comportamiento de cada unidad" fuente="LoggerNet (cada minuto) · Winter-Kennedy sin calibrar como índice relativo · modelo de la colina"
      para="Comparar las máquinas entre sí: aunque las ocho comparten el mismo diagrama colinar (U1–U4 casa de máquinas norte; U5–U8 sur, desde 2028), cada una rinde distinto en eficiencia y caudal."
      logras="Saber qué unidad entrega más energía por metro cúbico, en qué orden conviene ponerlas en línea, cómo cambia su rendimiento con la carga y si la diferencia entre el caudal de Hidrometría (P / F.C.) y el Winter-Kennedy se reduce con el tiempo (por ejemplo, con los dragados del río)."
      resultados="Tabla por unidad (horas, energía, arranques, F.C. WK, factor relativo, η aparente frente al modelo), orden de mérito, gráficos diarios y por tramo de potencia, y la apertura del distribuidor de cada unidad hora a hora (en % y grados, estimada con el modelo). El WK no está calibrado: todo índice con WK es relativo." />
  );
  if (!d.conectado) return <>{guia}<RequiereConexion T={T} que="el histórico por unidad" /></>;
  const th = { padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" };
  return (
    <>
      {guia}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <SelectorRango T={T} min={minD} max={maxD} valor={rango} onChange={setRango} />
        {datos && <span style={{ fontSize: 12.5, color: T.inkFaint }}>Último dato {fechaCorta(datos.estado.ultimoDato)} · histórico actualizado {fechaCorta(textoHoraColombia(new Date(datos.estado.generado)))}</span>}
        {error && <Estado T={T} tipo="critico" compacto>{error.message}</Estado>}
      </div>
      {dias.length > 0 && (
        <>
          <Tarjeta T={T} titulo={`Resumen por unidad (${fechaCorta(dias[0].dia)} – ${fechaCorta(dias[dias.length - 1].dia)})`}
            subtitulo="F.C. WK = MW por m³/s con el caudal Winter-Kennedy (solo con la unidad estable, ≥ 10 min seguidos en línea). Factor relativo = F.C. WK / media de las unidades: > 1 rinde más que la media.">
            <div className="itu-tabla">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
                <thead><tr style={{ color: T.inkFaint }}>
                  <th style={{ ...th, textAlign: "left" }}>Unidad</th><th style={th}>Horas</th><th style={th}>Energía</th><th style={th}>Arranques</th><th style={th}>P media</th><th style={th}>F.C. WK</th><th style={th}>Factor relativo</th><th style={th}>Q WK / Q Hidrom.</th><th style={th}>Q modelo / Q Hidrom.</th><th style={th}>η aparente WK</th><th style={th}>η modelo</th>
                </tr></thead>
                <tbody>{resumen.map((r) => {
                  const info = UNIDADES_CENTRAL[r.u];
                  return (
                    <tr key={r.u} style={{ borderTop: `1px solid ${T.lineSoft}`, textAlign: "right", color: T.ink }}>
                      <td style={{ textAlign: "left", padding: "6px 8px", whiteSpace: "nowrap" }}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: colorSerie(T, r.u), marginRight: 6 }} />U{r.u + 1} <span style={{ color: T.inkFaint, fontSize: 11.5 }}>{info ? info.casa : ""}</span></td>
                      <td style={th}>{fmtNum(r.horas, 0)}</td><td style={th}>{fmtNum(r.energia / 1000, 1)} GWh</td><td style={th}>{r.arranques}</td><td style={th}>{fmtNum(r.pMedia, 1)} MW</td>
                      <td style={{ ...th, fontWeight: 700 }}>{fmtNum(r.fcWK, 3)}</td><td style={th}>{fmtNum(r.factor, 3)}</td>
                      <td style={th}>{fmtNum(r.relWKFC, 3)}</td><td style={th}>{fmtNum(r.relModFC, 3)}</td>
                      <td style={{ ...th, color: r.etaWK > 100 ? T.inkFaint : undefined }} title={r.etaWK > 100 ? "Más de 100 %: el Winter-Kennedy no está calibrado; es un índice relativo, no una eficiencia real" : undefined}>{r.etaWK != null ? `${fmtNum(r.etaWK, 1)} %${r.etaWK > 100 ? " *" : ""}` : "—"}</td><td style={th}>{r.etaMod != null ? `${fmtNum(r.etaMod, 1)} %` : "—"}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
            {resumen.some((r) => r.etaWK > 100) && <div style={{ fontSize: 11.5, color: T.inkFaint, marginTop: 6 }}>* Más de 100 %: el Winter-Kennedy no está calibrado; el η aparente se usa solo para comparar unidades, no es la eficiencia real.</div>}
            <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13, color: T.inkMuted }}>
              <b style={{ color: T.ink }}>Orden de mérito (índice WK del periodo):</b>
              {merito.length ? merito.map((u, i) => <span key={u} style={{ padding: "2px 10px", borderRadius: 999, border: `1px solid ${T.line}`, background: T.panelSoft }}>{i + 1}. U{u}</span>) : "sin datos suficientes"}
            </div>
            <Nota T={T} rotulo="Cómo leer el orden de mérito">
              Con la misma colina y el mismo salto, repartir la potencia por igual entre las unidades en línea es lo más eficiente; lo que cambia con estos factores es <i>cuáles</i> unidades conviene usar primero. El η aparente WK puede pasar de 100 % porque el WK no está calibrado: se lee como tendencia y comparación, no como eficiencia real.
              Q modelo / Q Hidrom. &gt; 1 quiere decir que el modelo (con el río colmatado) pide más agua que la fórmula del F.C.
            </Nota>
          </Tarjeta>
          <Tarjeta T={T} titulo="F.C. Winter-Kennedy por unidad, día a día" subtitulo="Sube con el nivel del embalse (más salto). La separación entre unidades es la diferencia de rendimiento relativo (o de calibración del WK). Punteada: F.C. de la fórmula de Hidrometría.">
            <GraficoSeries T={T} x={s.t} series={s.fcWK} unidad="MW/(m³/s)" ejeY="MW por m³/s" decimales={3} grupo="unid" nombreArchivo="fc_wk_unidades" />
          </Tarjeta>
          <div className="itu-2col">
            <Tarjeta T={T} titulo="Q Winter-Kennedy / Q Hidrometría" subtitulo="1,00 = el WK coincide con P / F.C. El salto del 29-oct es el cambio de fórmula del F.C.">
              <GraficoSeries T={T} x={s.t} series={s.relWK} unidad="" ejeY="relación" decimales={3} grupo="unid" alto={220} nombreArchivo="relacion_wk_hidrometria" referencias={[{ y: 1, rotulo: "1,00", incluir: true }]} />
            </Tarjeta>
            <Tarjeta T={T} titulo="Q modelo / Q Hidrometría" subtitulo="Colina común con el río colmatado (ASE) y el caudal descargado de cada hora.">
              <GraficoSeries T={T} x={s.t} series={s.relMod} unidad="" ejeY="relación" decimales={3} grupo="unid" alto={220} nombreArchivo="relacion_modelo_hidrometria" referencias={[{ y: 1, rotulo: "1,00", incluir: true }]} />
            </Tarjeta>
          </div>
          <div className="itu-2col">
            <Tarjeta T={T} titulo="η aparente (WK) frente al modelo" subtitulo="Media diaria de las horas completas en línea.">
              <GraficoSeries T={T} x={s.t} series={s.eta} unidad="%" ejeY="%" decimales={1} grupo="unid" alto={220} nombreArchivo="eta_unidades" />
            </Tarjeta>
            <Tarjeta T={T} titulo="Horas en línea por día">
              <GraficoSeries T={T} x={s.t} series={s.horas} unidad="h" ejeY="h" decimales={1} grupo="unid" alto={220} nombreArchivo="horas_unidades" incluirCero yMax={24} />
            </Tarjeta>
          </div>
          <Tarjeta T={T} titulo="Apertura del distribuidor por unidad, hora a hora" subtitulo={`Apertura estimada (en % y su equivalente en grados) de cada unidad en línea, promedio de cada hora, entre ${fechaCorta(rangoCurva[0])} y ${fechaCorta(rangoCurva[1])}${dias.length > 92 ? " (últimos 92 días del periodo)" : ""}. Con la misma potencia, una unidad que pide más apertura que otra está rindiendo distinto, o el nivel y el salto cambiaron.`}>
            {horario.cargando && !apertura && <div style={{ fontSize: 13, color: T.inkFaint }}>Cargando series horarias…</div>}
            {apertura && apertura.conDato && <GraficoApertura T={T} x={apertura.t} filas={apertura.filas} lineas={apertura.lineas} nU={nU} pasoH={1} grupo="unidH" nombreArchivo="apertura_unidades_horaria" />}
            {apertura && !apertura.conDato && <div style={{ fontSize: 13, color: T.inkFaint }}>El histórico de este periodo todavía no tiene la apertura por hora; el proceso automático la agrega en su próximo recálculo.</div>}
          </Tarjeta>
          <Tarjeta T={T} titulo="Rendimiento relativo al modelo según la carga" subtitulo={`Q modelo / Q Winter-Kennedy por tramo de 10 MW (mediana de las horas completas en línea, al menos 3 por tramo) entre ${fechaCorta(rangoCurva[0])} y ${fechaCorta(rangoCurva[1])}. Al dividir por el modelo se descuenta el efecto del nivel del embalse: queda cuánto rinde cada máquina frente a la colina común, carga por carga. Más alto = turbina menos agua de la que predice el modelo (relativo: WK sin calibrar).`}>
            {horario.cargando && !curva && <div style={{ fontSize: 13, color: T.inkFaint }}>Cargando series horarias…</div>}
            {curva && curva.x.length > 0 && <GraficoSeries T={T} x={curva.x} tipoX="numero" ejeX="MW en bornes" series={curva.series} unidad="" ejeY="Q modelo / Q WK" decimales={3} nombreArchivo="curva_rendimiento_unidades" referencias={[{ y: 1, rotulo: "1,00 = como el modelo" }]} />}
            {curva && !curva.x.length && <div style={{ fontSize: 13, color: T.inkFaint }}>Sin horas suficientes en el periodo.</div>}
          </Tarjeta>
        </>
      )}
    </>
  );
}
