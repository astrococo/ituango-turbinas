/* Apertura del distribuidor por unidad: gráfico en % (100 % = 30,2°) con la
   equivalencia en grados (eje derecho, tooltip, tabla y CSV) y un resumen
   por unidad. LoggerNet no mide la posición del distribuidor: la apertura
   es la que da el modelo de la colina para la potencia medida. */
import { useMemo } from "react";
import { pctFromDeg, degFromPct, GAMMA_ORIGINAL_MAX, GAMMA_NORMAL_MAX, GAMMA_AMPLIADO_MAX } from "../modelo.js";
import { GraficoSeries, fmtNum, colorSerie, ESTADO } from "./graficos.jsx";

const EQUIV_APERTURA = { f: degFromPct, unidad: "°", decimales: 2, decimalesEje: 1, rotulo: "grados (°)" };
const PCT_NORMAL = pctFromDeg(GAMMA_NORMAL_MAX); // 97 %
const PCT_ORIGINAL = pctFromDeg(GAMMA_ORIGINAL_MAX); // 87,7 %

const NOTA_APERTURA = "Apertura estimada con el modelo de la colina (ensayo 2013, transpuesto al prototipo): LoggerNet no mide la posición del distribuidor. Para cada unidad en línea se busca la apertura que entrega su potencia media con el nivel del embalse y el caudal descargado (río colmatado, ASE). 100 % = 30,2°; 97 % = 29,29° (techo de operación normal); 87,7 % = 26,5° (límite original).";

function referenciasApertura(T) {
  return [
    { y: PCT_ORIGINAL, rotulo: `${fmtNum(PCT_ORIGINAL, 1)} % = 26,5° (límite original)`, color: T.inkFaint },
    { y: PCT_NORMAL, rotulo: `${fmtNum(PCT_NORMAL, 0)} % = ${fmtNum(GAMMA_NORMAL_MAX, 2)}° (techo normal)`, color: ESTADO.aviso },
    { y: 100, rotulo: `100 % = ${fmtNum(GAMMA_AMPLIADO_MAX, 1)}° (límite ampliado)`, color: ESTADO.critico },
  ];
}

const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

/* Por qué una unidad no tiene apertura en un intervalo. linea = fracción del
   intervalo con la unidad en línea (P > umbral). Los vacíos del gráfico son
   casi siempre la unidad detenida: no faltan datos. */
function motivoSinApertura(linea) {
  if (linea == null) return "sin dato";
  if (linea <= 0) return "detenida";
  if (linea < 0.5) return "arranque o parada";
  return "fuera del modelo";
}

/* filas: [[grados por unidad] | null] alineadas con x. pasoH: horas que
   representa cada fila (número o arreglo). lineas: [[fracción en línea por
   unidad] | null] alineadas con x (opcional) para explicar los vacíos. */
function GraficoApertura({ T, x, filas, lineas = null, nU, pasoH = 1, alto = 260, grupo, nombreArchivo = "apertura_distribuidor", resumen = true, escalones = false, mensajeVacio = "Sin unidades en línea con apertura calculable en el periodo." }) {
  const series = useMemo(() => Array.from({ length: nU }, (_, u) => ({
    nombre: `U${u + 1}`, indice: u, ancho: 1.8,
    datos: filas.map((g) => (g && g[u] != null && g[u] > 0 ? r2(pctFromDeg(g[u])) : null)),
    nulos: lineas ? lineas.map((l) => motivoSinApertura(l ? l[u] : null)) : null,
  })), [filas, lineas, nU]);
  const stats = useMemo(() => series.map((s) => {
    let suma = 0, peso = 0, min = Infinity, max = -Infinity, hNormal = 0, hAmpl = 0, hDet = 0, hTrans = 0, hOtro = 0;
    s.datos.forEach((v, i) => {
      const w = Array.isArray(pasoH) ? pasoH[i] : pasoH;
      if (v == null) {
        const m = s.nulos ? s.nulos[i] : null;
        if (m === "detenida") hDet += w; else if (m === "arranque o parada") hTrans += w; else if (m) hOtro += w;
        return;
      }
      suma += v * w; peso += w;
      if (v < min) min = v;
      if (v > max) max = v;
      if (v > PCT_NORMAL + 1e-9) hNormal += w;
      if (v > 100 + 1e-9) hAmpl += w;
    });
    return { u: s.indice, hDet, hTrans, hOtro, horas: peso, media: peso ? suma / peso : null, min: peso ? min : null, max: peso ? max : null, hNormal, hAmpl };
  }), [series, pasoH]);
  const hayDatos = series.some((s) => s.datos.some((v) => v != null));
  if (!hayDatos) return <div style={{ fontSize: 13, color: T.inkFaint, padding: "8px 0" }}>{mensajeVacio}</div>;
  const th = { padding: "5px 8px", textAlign: "right", whiteSpace: "nowrap" };
  const fmtH = (h) => (h < 1 ? `${fmtNum(h * 60, 0)} min` : `${fmtNum(h, 1)} h`);
  const deg = (p) => (p == null ? "" : ` · ${fmtNum(degFromPct(p), 2)}°`);
  return (
    <>
      <GraficoSeries T={T} x={x} series={series} unidad="%" ejeY="apertura (%)" decimales={1} alto={alto} grupo={grupo} nombreArchivo={nombreArchivo}
        referencias={referenciasApertura(T)} equivalente={EQUIV_APERTURA} escalones={escalones} />
      {resumen && (
        <div className="itu-tabla">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
            <thead><tr style={{ color: T.inkFaint }}>
              <th style={{ ...th, textAlign: "left" }}>Unidad</th><th style={th}>En línea (con apertura)</th>{lineas && <th style={th}>Detenida</th>}{lineas && <th style={th}>Arranque o parada</th>}<th style={th}>Media</th><th style={th}>Mínima</th><th style={th}>Máxima</th><th style={th}>Rango (máx. − mín.)</th><th style={th}>Sobre 97 %</th><th style={th}>Sobre 100 %</th>
            </tr></thead>
            <tbody>{stats.filter((r) => r.horas > 0 || r.hDet > 0 || r.hTrans > 0).map((r) => (
              <tr key={r.u} style={{ borderTop: `1px solid ${T.lineSoft}`, color: T.ink, textAlign: "right" }}>
                <td style={{ ...th, textAlign: "left" }}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: colorSerie(T, r.u), marginRight: 6 }} />U{r.u + 1}</td>
                <td style={th}>{fmtH(r.horas)}</td>{lineas && <td style={{ ...th, color: T.inkMuted }}>{r.hDet > 0 ? fmtH(r.hDet) : "—"}</td>}{lineas && <td style={{ ...th, color: T.inkMuted }}>{r.hTrans > 0 ? fmtH(r.hTrans) : "—"}</td>}
                <td style={{ ...th, fontWeight: 700 }}>{r.media != null ? <>{fmtNum(r.media, 1)} %<span style={{ color: T.inkFaint, fontWeight: 400 }}>{deg(r.media)}</span></> : "—"}</td>
                <td style={th}>{r.min != null ? <>{fmtNum(r.min, 1)} %<span style={{ color: T.inkFaint }}>{deg(r.min)}</span></> : "—"}</td>
                <td style={th}>{r.max != null ? <>{fmtNum(r.max, 1)} %<span style={{ color: T.inkFaint }}>{deg(r.max)}</span></> : "—"}</td>
                <td style={th}>{r.horas > 0 ? <>{fmtNum(r.max - r.min, 1)} pp<span style={{ color: T.inkFaint }}> · {fmtNum(degFromPct(r.max - r.min), 2)}°</span></> : "—"}</td>
                <td style={{ ...th, color: r.hNormal > 0 ? ESTADO.serio : T.ink }}>{r.hNormal > 0 ? fmtH(r.hNormal) : "—"}</td>
                <td style={{ ...th, color: r.hAmpl > 0 ? ESTADO.critico : T.ink, fontWeight: r.hAmpl > 0 ? 700 : 400 }}>{r.hAmpl > 0 ? fmtH(r.hAmpl) : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p style={{ fontSize: 11.5, color: T.inkFaint, margin: "8px 0 0", lineHeight: 1.5 }}>{NOTA_APERTURA} {lineas ? "Los tramos sin línea son intervalos con la unidad detenida (sin generación) o en arranque o parada (en línea menos de la mitad del intervalo): no son datos faltantes; el tooltip y la tabla dicen cuál es el caso." : ""}</p>
    </>
  );
}

export { GraficoApertura, motivoSinApertura, EQUIV_APERTURA, referenciasApertura, NOTA_APERTURA, PCT_NORMAL, PCT_ORIGINAL };
