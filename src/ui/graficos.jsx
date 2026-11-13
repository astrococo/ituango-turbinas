/* ============================================================
   Gráficos de series de tiempo (uPlot): rápidos con miles de puntos,
   con zoom (arrastrar), doble clic para volver, cursor sincronizado
   entre gráficos del mismo grupo, leyenda que prende/apaga series,
   tooltip con todos los valores, bandas sombreadas, líneas de
   referencia, tabla de datos y descarga CSV / PNG.

   Un eje Y por defecto; una serie con eje: "derecho" usa un segundo eje
   (ejeY2) para magnitudes de escala muy distinta (p. ej. caudal regulado
   frente al vertedero). tipoX "hora": horas del día 0–24 como "HH:MM".
   Las horas son de Colombia y se tratan como UTC para no moverlas
   con la zona del navegador.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { FONT_BODY, descargarCSV } from "./base.jsx";

/* Paleta categórica validada (orden fijo, nunca por rango) y estados. */
const SERIE = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};
const ESTADO = { bien: "#0ca30c", aviso: "#fab219", serio: "#ec835a", critico: "#d03b3b" };
const colorSerie = (T, i) => (T.esOscuro ? SERIE.dark : SERIE.light)[i % 8];

/* "AAAA-MM-DD HH:MM" (hora de Colombia) → segundos, como si fuera UTC */
const aSeg = (t) => Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10), +(t.slice(11, 13) || 0), +(t.slice(14, 16) || 0)) / 1000;
const deSeg = (s) => new Date(s * 1000).toISOString().slice(0, 16).replace("T", " ");
const fmtNum = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d }));
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/* Decimales de las marcas del eje según el paso entre ellas. */
const decimalesPaso = (incr) => (!incr || incr >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(incr) - 1e-9)));
/* Marcas del eje de tiempo en español: horas "06:00" (y la fecha a las 00:00) o fechas "3 nov". */
function etiquetasTiempo(u, splits, a, e, incr) {
  let anioPrevio = null;
  return splits.map((s, i) => {
    const d = new Date(s * 1000);
    const fecha = `${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
    const anio = d.getUTCFullYear();
    if (incr < 86400) {
      const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
      return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 ? `${hm}\n${fecha}` : hm;
    }
    const conAnio = i === 0 || anio !== anioPrevio;
    anioPrevio = anio;
    return incr >= 28 * 86400 ? `${MESES[d.getUTCMonth()]}${conAnio || d.getUTCMonth() === 0 ? `\n${anio}` : ""}` : `${fecha}${conAnio ? `\n${anio}` : ""}`;
  });
}

/* Horas del día (número 0–24) → "HH:MM" */
const hhmm = (h) => { const m = Math.round(h * 60); return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };

/* Plugin: tooltip flotante con todos los valores de la posición del cursor. */
function pluginTooltip(T, decimales, unidad, fmtX, equivalente = null) {
  let tip;
  return {
    hooks: {
      init: (u) => {
        tip = document.createElement("div");
        Object.assign(tip.style, {
          position: "absolute", pointerEvents: "none", zIndex: 20, display: "none", padding: "8px 10px", borderRadius: "8px",
          background: T.panel, border: `1px solid ${T.line}`, boxShadow: T.cardShadow, fontFamily: FONT_BODY, fontSize: "12px",
          color: T.ink, minWidth: "140px", whiteSpace: "nowrap",
        });
        u.over.appendChild(tip);
        u.over.addEventListener("mouseleave", () => { tip.style.display = "none"; });
      },
      setCursor: (u) => {
        const i = u.cursor.idx;
        if (i == null || u.cursor.left < 0) { tip.style.display = "none"; return; }
        tip.replaceChildren();
        const cab = document.createElement("div");
        cab.textContent = fmtX(u.data[0][i]);
        Object.assign(cab.style, { color: T.inkFaint, marginBottom: "4px", fontSize: "11.5px" });
        tip.appendChild(cab);
        let n = 0;
        u.series.forEach((s, k) => {
          if (k === 0 || !s.show || s._oculta) return;
          const v = u.data[k][i];
          const motivoNulo = v == null && s._nulos ? s._nulos[i] : null;
          const fila = document.createElement("div");
          Object.assign(fila.style, { display: "flex", alignItems: "center", gap: "8px", lineHeight: "1.55" });
          const clave = document.createElement("span");
          Object.assign(clave.style, { width: "14px", height: "3px", borderRadius: "2px", background: s._dash ? `repeating-linear-gradient(90deg, ${s._color} 0 4px, transparent 4px 7px)` : s._color, flexShrink: 0 });
          const val = document.createElement("b");
          val.textContent = motivoNulo || `${fmtNum(v, s._dec ?? decimales)}${s._unidad ?? unidad ? " " + (s._unidad ?? unidad) : ""}`;
          Object.assign(val.style, { color: motivoNulo ? T.inkMuted : T.ink, fontWeight: motivoNulo ? "500" : "700", fontVariantNumeric: "tabular-nums" });
          if (equivalente && v != null && Number.isFinite(v) && !s._sinEquiv) {
            const eq = document.createElement("span");
            eq.textContent = ` (${fmtNum(equivalente.f(v), equivalente.decimales ?? 2)}${equivalente.unidad})`;
            Object.assign(eq.style, { color: T.inkMuted, fontWeight: "400" });
            val.appendChild(eq);
          }
          const nom = document.createElement("span");
          nom.textContent = s.label;
          nom.style.color = T.inkMuted;
          fila.append(clave, val, nom);
          tip.appendChild(fila); n++;
        });
        if (!n) { tip.style.display = "none"; return; }
        tip.style.display = "block";
        const w = tip.offsetWidth, h = tip.offsetHeight;
        const left = u.cursor.left + 14 + w > u.over.clientWidth ? u.cursor.left - w - 14 : u.cursor.left + 14;
        const top = Math.min(Math.max(0, u.cursor.top - h / 2), u.over.clientHeight - h);
        tip.style.left = `${Math.max(0, left)}px`; tip.style.top = `${Math.max(0, top)}px`;
      },
    },
  };
}

/* Plugin: líneas horizontales de referencia y franjas (y1..y2) con rótulo. */
function pluginReferencias(T, refs) {
  return {
    hooks: {
      drawClear: (u) => {
        const ctx = u.ctx;
        for (const r of refs) {
          if (r.y1 == null || r.y2 == null) continue;
          const y1 = u.valToPos(r.y1, "y", true), y2 = u.valToPos(r.y2, "y", true);
          ctx.save(); ctx.fillStyle = r.relleno || T.accentSoft;
          ctx.fillRect(u.bbox.left, Math.min(y1, y2), u.bbox.width, Math.abs(y2 - y1)); ctx.restore();
        }
      },
      draw: (u) => {
        const ctx = u.ctx, dpr = devicePixelRatio || 1;
        for (const r of refs) {
          const ys = r.y != null ? [r.y] : [];
          for (const yv of ys) {
            const y = u.valToPos(yv, "y", true);
            if (y < u.bbox.top || y > u.bbox.top + u.bbox.height) continue;
            ctx.save(); ctx.strokeStyle = r.color || T.inkFaint; ctx.lineWidth = 1.5 * dpr; ctx.setLineDash(r.dash === false ? [] : [6 * dpr, 4 * dpr]);
            ctx.beginPath(); ctx.moveTo(u.bbox.left, y); ctx.lineTo(u.bbox.left + u.bbox.width, y); ctx.stroke();
            if (r.rotulo && !r.enLeyenda) {
              // Rótulo sobre una pastilla del color del panel para que no lo tapen las series;
              // r.rotuloPos "inicio" lo pone a la izquierda (por defecto, a la derecha)
              ctx.setLineDash([]); ctx.font = `${11 * dpr}px ${FONT_BODY}`;
              const w = ctx.measureText(r.rotulo).width, pad = 4 * dpr, alto = 15 * dpr;
              const x0 = r.rotuloPos === "inicio" ? u.bbox.left + 6 * dpr : u.bbox.left + u.bbox.width - w - 2 * pad - 4 * dpr;
              const yTxt = y - alto - 2 * dpr < u.bbox.top ? y + 2 * dpr : y - alto - 2 * dpr;
              ctx.globalAlpha = 0.88; ctx.fillStyle = T.panel; ctx.fillRect(x0, yTxt, w + 2 * pad, alto);
              ctx.globalAlpha = 1; ctx.fillStyle = T.inkMuted; ctx.textAlign = "left"; ctx.textBaseline = "middle";
              ctx.fillText(r.rotulo, x0 + pad, yTxt + alto / 2);
            }
            ctx.restore();
          }
        }
      },
    },
  };
}

/* Plugin: línea vertical (p. ej. "ahora" o el cambio de F.C.). */
function pluginVerticales(T, xs) {
  return {
    hooks: {
      draw: (u) => {
        const ctx = u.ctx, dpr = devicePixelRatio || 1;
        for (const v of xs) {
          const x = u.valToPos(v.x, "x", true);
          if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) continue;
          ctx.save(); ctx.strokeStyle = v.color || T.inkFaint; ctx.lineWidth = 1 * dpr; ctx.setLineDash([3 * dpr, 3 * dpr]);
          ctx.beginPath(); ctx.moveTo(x, u.bbox.top); ctx.lineTo(x, u.bbox.top + u.bbox.height); ctx.stroke();
          if (v.rotulo) { ctx.setLineDash([]); ctx.font = `${11 * dpr}px ${FONT_BODY}`; ctx.fillStyle = T.inkMuted; ctx.fillText(v.rotulo, x + 4 * dpr, u.bbox.top + 12 * dpr); }
          ctx.restore();
        }
      },
    },
  };
}

/* Plugin: franja de estado al pie del área del gráfico (p. ej. dentro / fuera de la banda).
   tramos: [{ x0, x1, tipo }] en las unidades del eje X (segundos si es tiempo). */
const COLOR_TRAMO = { dentro: ESTADO.bien, encima: ESTADO.critico, debajo: ESTADO.serio, excepcion: ESTADO.aviso, proyectado: "#94a3b8" };
function pluginFranjas(tramos) {
  return {
    hooks: {
      draw: (u) => {
        if (!tramos || !tramos.length) return;
        const ctx = u.ctx, dpr = devicePixelRatio || 1, h = 9 * dpr;
        const y = u.bbox.top + u.bbox.height - h;
        for (const t of tramos) {
          const a = Math.max(u.bbox.left, u.valToPos(t.x0, "x", true)), b = Math.min(u.bbox.left + u.bbox.width, u.valToPos(t.x1, "x", true));
          if (b <= a) continue;
          ctx.save(); ctx.fillStyle = COLOR_TRAMO[t.tipo] || "#94a3b8";
          if (t.proyectado) {
            // proyección: segmentos cortados (se distingue de lo medido sin depender solo del color)
            ctx.globalAlpha = 0.75;
            for (let xx = a; xx < b; xx += 9 * dpr) ctx.fillRect(xx, y, Math.min(6 * dpr, b - xx), h);
          } else { ctx.globalAlpha = 0.9; ctx.fillRect(a, y, b - a, h); }
          ctx.restore();
        }
      },
    },
  };
}

/* Gráfico de series.
   x: arreglo de "AAAA-MM-DD HH:MM" (tipo "tiempo") o números (tipo "numero").
   series: [{ nombre, datos:[...], color?, indice?, dash?, ancho?, unidad?, decimales?, area?, oculta?, puntos?, eje?: "derecho",
              unirHuecos?: une los puntos a través de valores vacíos (curvas con x propias en una x común),
              nulos?: [...] texto que explica un valor vacío (p. ej. "detenida"), en tooltip, tabla y CSV }]
   bandas: [{ desde: i, hasta: j, relleno }] (índices de series: rellena entre ambas)
   referencias: [{ y, rotulo, color, dash } | { y1, y2, relleno }]
   verticales: [{ x (mismo tipo que x), rotulo, color }]
   equivalente: { f, unidad, decimales, rotulo } — otra unidad del mismo valor
     (p. ej. apertura en % → grados): eje derecho, tooltip, tabla y CSV.
     Debe ser un objeto estable (constante de módulo). Una serie con
     sinEquiv: true no la muestra. */
function GraficoSeries({ T, x, series, tipoX = "tiempo", unidad = "", decimales = 1, alto = 260, ejeY, ejeX, bandas = [], referencias = [], verticales = [], grupo, nombreArchivo = "serie", yMin, yMax, incluirCero = false, escalones = false, barras = false, tramos = null, leyendaTramos = null, equivalente = null, ejeY2 = null, unidad2 = null, incluirCero2 = false, mensajeVacio = null, categorias = null }) {
  // categorias: rótulos del eje X (p. ej. meses); x = 0, 1, 2… Las barras de varias series van lado a lado.
  const esCat = Array.isArray(categorias) && categorias.length > 0;
  const esHora = tipoX === "hora";
  const conY2 = series.some((s) => s.eje === "derecho");
  const caja = useRef(null);
  const plot = useRef(null);
  const [ocultas, setOcultas] = useState(() => new Set(series.map((s, i) => (s.oculta ? i : null)).filter((i) => i != null)));
  const [verTabla, setVerTabla] = useState(false);
  const [zoom, setZoom] = useState(false);
  const xs = useMemo(() => (tipoX === "tiempo" ? x.map(aSeg) : x.slice()), [x, tipoX]);
  // Serie diaria (un punto por día, a las 12:00): marcas por fecha, nunca por hora
  const esDiario = tipoX === "tiempo" && x.length > 0 && x.every((t) => typeof t === "string" && t.endsWith(" 12:00"));
  const sinDatos = series.every((s) => !s.datos.some((v) => v != null && Number.isFinite(v)));
  const fmtX = useMemo(() => (tipoX === "tiempo"
    ? (s) => { const d = new Date(s * 1000); return esDiario ? `${d.getUTCDate()} ${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}` : `${d.getUTCDate()} ${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; }
    : esCat ? (v) => categorias[Math.round(v)] ?? ""
    : esHora ? (v) => `${ejeX ? ejeX + " " : ""}${hhmm(v)}`
    : (v) => `${ejeX || ""} ${fmtNum(v, Number.isInteger(v) ? 0 : 2)}`), [tipoX, ejeX, esHora, esDiario, esCat, categorias]);
  const colores = series.map((s, i) => s.color || colorSerie(T, s.indice ?? i));

  useEffect(() => {
    if (!caja.current) return undefined;
    const ancho = caja.current.clientWidth || 600;
    const datos = [xs, ...series.map((s) => s.datos.map((v) => (v == null || !Number.isFinite(v) ? null : v)))];
    const conBarra = series.map((s, i) => (barras || s.barras ? i : null)).filter((i) => i != null);
    const nBarras = conBarra.length, idxBarra = new Map(conBarra.map((i, k) => [i, k]));
    const ejeComun = { stroke: T.inkFaint, grid: { stroke: T.lineSoft, width: 1 }, ticks: { stroke: T.lineSoft, width: 1 }, font: `11px ${FONT_BODY}`, labelFont: `600 12px ${FONT_BODY}` };
    const opts = {
      width: ancho, height: alto,
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1e3), "Etc/UTC"),
      scales: {
        x: { time: tipoX === "tiempo", ...(esDiario ? { range: (u, mn, mx) => [mn - 43200, mx + 43200] } : {}) },
        y: { range: (u, mn, mx) => {
          let a = yMin ?? mn, b = yMax ?? mx;
          if (incluirCero) a = Math.min(0, a);
          for (const r of referencias) { if (r.y != null && r.incluir) { a = Math.min(a, r.y); b = Math.max(b, r.y); } }
          if (a == null || b == null) return [0, 1];
          if (a === b) { a -= 1; b += 1; }
          const pad = (b - a) * 0.06;
          return [yMin ?? a - (incluirCero && a === 0 ? 0 : pad), yMax ?? b + pad];
        } },
        ...(esHora ? { x: { time: false, range: (u, mn, mx) => [Math.min(0, mn), Math.max(24, mx)] } } : {}),
        ...(esCat ? { x: { time: false, range: () => [-0.5, categorias.length - 0.5] } } : {}),
        ...(conY2 ? { y2: { range: (u, mn, mx) => {
          let a = mn, b = mx;
          if (a == null || b == null) return [0, 1];
          if (incluirCero2) a = Math.min(0, a);
          if (a === b) { a -= 1; b += 1; }
          const pad = (b - a) * 0.06;
          return [incluirCero2 && a === 0 ? 0 : a - pad, b + pad];
        } } } : {}),
      },
      axes: [
        { ...ejeComun, label: tipoX === "tiempo" ? undefined : ejeX, ...(esDiario ? { incrs: [86400, 2 * 86400, 3 * 86400, 7 * 86400, 14 * 86400, 28 * 86400, 2 * 28 * 86400, 3 * 28 * 86400, 6 * 28 * 86400, 365 * 86400] } : {}), ...(esHora ? { incrs: [1, 2, 3, 4, 6], splits: (u, ax, mn, mx, incr) => { const out = []; for (let h = Math.ceil(mn / incr) * incr; h <= mx + 1e-9; h += incr) out.push(h); return out; } } : {}), ...(esCat ? { splits: () => categorias.map((_, i) => i), grid: { show: false } } : {}), values: tipoX === "tiempo" ? etiquetasTiempo : esCat ? (u, v) => v.map((n) => categorias[Math.round(n)] ?? "") : esHora ? (u, v) => v.map((n) => hhmm(n)) : (u, v, a, e, incr) => v.map((n) => fmtNum(n, decimalesPaso(incr))) },
        { ...ejeComun, label: ejeY, size: 62, values: (u, v, a, e, incr) => v.map((n) => fmtNum(n, decimalesPaso(incr))) },
        ...(conY2 ? [{ ...ejeComun, scale: "y2", side: 1, grid: { show: false }, label: ejeY2, size: 62, values: (u, v, a, e, incr) => v.map((n) => fmtNum(n, decimalesPaso(incr))) }] : []),
        ...(equivalente && !conY2 ? [{ ...ejeComun, scale: "y", side: 1, grid: { show: false }, label: equivalente.rotulo, size: 58, values: (u, v, a, e, incr) => { const dec = equivalente.decimalesEje ?? decimalesPaso(Math.abs(equivalente.f(incr) - equivalente.f(0))); return v.map((n) => fmtNum(equivalente.f(n), dec)); } }] : []),
      ],
      series: [
        {},
        ...series.map((s, i) => {
          // puntos aislados (sin vecinos con dato) se dibujan como punto: si no, no se verían
          const d = s.datos, aislado = !s.soloPuntos && d.some((v, k) => v != null && (k === 0 || d[k - 1] == null) && (k === d.length - 1 || d[k + 1] == null));
          return ({
          label: s.nombre, show: !ocultas.has(i), stroke: colores[i], scale: s.eje === "derecho" ? "y2" : "y", width: s.ancho ?? 2, dash: s.dash ? [6, 4] : undefined,
          fill: s.area ? colores[i] + "22" : barras || s.barras ? colores[i] + "cc" : undefined, spanGaps: !!s.unirHuecos,
          points: { show: s.puntos ?? (aislado && !s.unirHuecos && !(barras || s.barras)), size: s.soloPuntos ? 8 : 6, fill: colores[i], stroke: s.soloPuntos ? T.panel : colores[i] },
          paths: s.soloPuntos ? () => null : (barras || s.barras) && esCat && nBarras === 2 ? uPlot.paths.bars({ size: [0.38, 70], align: idxBarra.get(i) === 0 ? -1 : 1 }) : barras || s.barras ? uPlot.paths.bars({ size: [0.7, 40] }) : escalones || s.escalones ? uPlot.paths.stepped({ align: 1 }) : undefined,
          _color: colores[i], _dash: s.dash, _unidad: s.unidad ?? (s.eje === "derecho" ? unidad2 : undefined), _dec: s.decimales, _sinEquiv: s.sinEquiv, _nulos: s.nulos,
        }); }),
      ],
      // uPlot: [serie superior, serie inferior]
      bands: bandas.map((b) => ({ series: [b.hasta + 1, b.desde + 1], fill: b.relleno || T.accentSoft })),
      legend: { show: false },
      cursor: { sync: grupo ? { key: grupo } : undefined, drag: { x: true, y: false, setScale: true }, points: { size: 7 } },
      hooks: { setScale: [(u, k) => { if (k === "x") setZoom(u.scales.x.min > xs[0] + 1e-9 || u.scales.x.max < xs[xs.length - 1] - 1e-9); }] },
      plugins: [pluginTooltip(T, decimales, unidad, fmtX, equivalente), pluginReferencias(T, referencias), pluginVerticales(T, verticales.map((v) => ({ ...v, x: tipoX === "tiempo" && typeof v.x === "string" ? aSeg(v.x) : v.x }))), pluginFranjas(tramos ? tramos.map((t) => ({ ...t, x0: tipoX === "tiempo" && typeof t.x0 === "string" ? aSeg(t.x0) : t.x0, x1: tipoX === "tiempo" && typeof t.x1 === "string" ? aSeg(t.x1) : t.x1 })) : null)],
    };
    const u = new uPlot(opts, datos, caja.current);
    plot.current = u;
    u.over.addEventListener("dblclick", () => u.setScale("x", { min: xs[0], max: xs[xs.length - 1] }));
    const ro = new ResizeObserver(() => { if (caja.current) u.setSize({ width: caja.current.clientWidth, height: alto }); });
    ro.observe(caja.current);
    return () => { ro.disconnect(); u.destroy(); plot.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xs, series, T, alto, tipoX, ejeY, ejeX, unidad, decimales, grupo, esCat, JSON.stringify(referencias), JSON.stringify(bandas), JSON.stringify(verticales), JSON.stringify(tramos), yMin, yMax, incluirCero, escalones, barras, equivalente, ejeY2, unidad2, incluirCero2]);

  function alternar(i) {
    setOcultas((prev) => {
      const n = new Set(prev);
      if (n.has(i)) n.delete(i); else n.add(i);
      if (plot.current) plot.current.setSeries(i + 1, { show: !n.has(i) });
      return n;
    });
  }
  function descargarPNG() {
    const u = plot.current; if (!u) return;
    const c = document.createElement("canvas");
    c.width = u.ctx.canvas.width; c.height = u.ctx.canvas.height;
    const g = c.getContext("2d"); g.fillStyle = T.panel; g.fillRect(0, 0, c.width, c.height); g.drawImage(u.ctx.canvas, 0, 0);
    const a = document.createElement("a"); a.href = c.toDataURL("image/png"); a.download = `${nombreArchivo}.png`; a.click();
  }
  const valEq = (v) => (equivalente && v != null && Number.isFinite(v) ? +equivalente.f(v).toFixed(equivalente.decimales ?? 2) : null);
  const unidadDe = (s) => s.unidad ?? (s.eje === "derecho" ? unidad2 : null) ?? unidad;
  const filasCSV = () => x.map((t, k) => Object.fromEntries([[tipoX === "tiempo" ? "fecha_hora" : esHora ? "hora" : esCat ? (ejeX || "categoria") : (ejeX || "x"), esHora ? hhmm(t) : esCat ? categorias[k] : t], ...series.flatMap((s) => {
    const col = [`${s.nombre}${unidadDe(s) ? ` (${unidadDe(s)})` : ""}`, s.datos[k]];
    const cols = equivalente && !s.sinEquiv ? [col, [`${s.nombre} (${equivalente.unidad})`, valEq(s.datos[k])]] : [col];
    if (s.nulos) cols.push([`${s.nombre} (estado)`, s.datos[k] == null ? s.nulos[k] || "" : ""]);
    return cols;
  })]));

  const boton = { border: `1px solid ${T.line}`, background: T.panel, color: T.inkMuted, borderRadius: 6, padding: "3px 9px", fontSize: 12, cursor: "pointer", fontFamily: FONT_BODY };
  return (
    <div className="itu-grafico" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", alignItems: "center", marginBottom: 6 }}>
        {series.length > 1 && series.map((s, i) => (
          <button key={i} onClick={() => alternar(i)} aria-pressed={!ocultas.has(i)} title={ocultas.has(i) ? "Mostrar" : "Ocultar"}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: "2px 0", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12.5, color: ocultas.has(i) ? T.inkFaint : T.inkMuted, textDecoration: ocultas.has(i) ? "line-through" : "none" }}>
            <span aria-hidden="true" style={{ width: 18, height: s.soloPuntos ? 8 : 3, borderRadius: s.soloPuntos ? "50%" : 2, flexShrink: 0, ...(s.soloPuntos ? { width: 8 } : {}), background: s.dash ? `repeating-linear-gradient(90deg, ${colores[i]} 0 5px, transparent 5px 8px)` : colores[i], opacity: ocultas.has(i) ? 0.35 : 1 }} />{s.nombre}
          </button>
        ))}
        {referencias.filter((r) => r.enLeyenda && r.rotulo && r.y != null).map((r, i) => (
          <span key={`ref${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: T.inkFaint }}>
            <span aria-hidden="true" style={{ width: 18, height: 2, flexShrink: 0, background: `repeating-linear-gradient(90deg, ${r.color || T.inkFaint} 0 5px, transparent 5px 8px)` }} />{r.rotulo}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        {zoom && <button style={boton} onClick={() => plot.current && plot.current.setScale("x", { min: xs[0], max: xs[xs.length - 1] })}>Ver todo</button>}
        <button style={boton} onClick={() => setVerTabla((v) => !v)} aria-pressed={verTabla}>{verTabla ? "Gráfico" : "Tabla"}</button>
        <button style={boton} onClick={() => descargarCSV(filasCSV(), `${nombreArchivo}.csv`)}>CSV</button>
        <button style={boton} onClick={descargarPNG}>PNG</button>
      </div>
      {sinDatos && !verTabla && <div style={{ padding: "26px 12px", textAlign: "center", fontSize: 12.5, color: T.inkFaint, border: `1px dashed ${T.line}`, borderRadius: 8 }}>{mensajeVacio || "Sin datos para graficar en este periodo."}</div>}
      <div ref={caja} style={{ width: "100%", display: verTabla || sinDatos ? "none" : "block", touchAction: "pan-y" }} />
      {verTabla && <TablaSeries T={T} x={esCat ? categorias : x} series={series} unidad={unidad} unidad2={unidad2} decimales={decimales} tipoX={tipoX} ejeX={ejeX} fmtX={fmtX} xs={xs} equivalente={equivalente} />}
      {!verTabla && leyendaTramos && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 6, fontSize: 12, color: T.inkMuted }}>
          {leyendaTramos.map((l) => (
            <span key={l.tipo} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span aria-hidden="true" style={{ width: 14, height: 8, borderRadius: 2, background: l.proyectado ? `repeating-linear-gradient(90deg, ${COLOR_TRAMO.dentro} 0 4px, transparent 4px 6px)` : COLOR_TRAMO[l.tipo], opacity: 0.9 }} />
              {l.rotulo}{l.duracion ? <b style={{ color: T.ink, fontWeight: 600 }}>&nbsp;{l.duracion}</b> : null}
            </span>
          ))}
        </div>
      )}
      {!verTabla && (tipoX === "tiempo" || esHora) && <div style={{ fontSize: 11, color: T.inkFaint, marginTop: 2 }}>Arrastre sobre el gráfico para acercar; doble clic para volver.</div>}
    </div>
  );
}

function TablaSeries({ T, x, series, unidad, unidad2, decimales, tipoX, ejeX, fmtX, xs, equivalente }) {
  const unidadDe = (s) => s.unidad ?? (s.eje === "derecho" ? unidad2 : null) ?? unidad;
  const filas = x.map((_, k) => k).reverse().slice(0, 500);
  return (
    <div className="itu-tabla" style={{ maxHeight: 320, overflowY: "auto", border: `1px solid ${T.lineSoft}`, borderRadius: 8 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
        <thead><tr style={{ position: "sticky", top: 0, background: T.panelSoft }}>
          <th style={{ textAlign: "left", padding: "5px 8px", color: T.inkFaint }}>{tipoX === "tiempo" ? "Fecha y hora" : tipoX === "hora" ? "Hora" : ejeX}</th>
          {series.map((s, i) => <th key={i} style={{ textAlign: "right", padding: "5px 8px", color: T.inkFaint }}>{s.nombre}{unidadDe(s) ? ` (${unidadDe(s)})` : ""}</th>)}
        </tr></thead>
        <tbody>{filas.map((k) => (
          <tr key={k} style={{ borderTop: `1px solid ${T.lineSoft}` }}>
            <td style={{ padding: "4px 8px", color: T.inkMuted }}>{tipoX === "hora" ? hhmm(xs[k]) : typeof x[k] === "string" && tipoX !== "tiempo" ? x[k] : fmtX(xs[k])}</td>
            {series.map((s, i) => <td key={i} style={{ textAlign: "right", padding: "4px 8px", color: T.ink }}>{s.datos[k] == null && s.nulos && s.nulos[k] ? <span style={{ color: T.inkFaint }}>{s.nulos[k]}</span> : fmtNum(s.datos[k], s.decimales ?? decimales)}{equivalente && !s.sinEquiv && s.datos[k] != null && Number.isFinite(s.datos[k]) ? <span style={{ color: T.inkFaint }}> ({fmtNum(equivalente.f(s.datos[k]), equivalente.decimales ?? 2)}{equivalente.unidad})</span> : null}</td>)}
          </tr>
        ))}</tbody>
      </table>
      {x.length > 500 && <div style={{ padding: 6, fontSize: 11, color: T.inkFaint }}>Últimos 500 de {x.length.toLocaleString("es-CO")} registros; el CSV trae todos.</div>}
    </div>
  );
}

/* Curvas con x propias (p. ej. eficiencia a tres saltos) → una x común ordenada y
   series con null donde una curva no tiene punto (usar unirHuecos en la serie). */
function unirCurvas(curvas, campoX, campoY) {
  const xs = [...new Set(curvas.flatMap((c) => c.puntos.map((p) => p[campoX])).filter((v) => Number.isFinite(v)))].sort((a, b) => a - b);
  const idx = new Map(xs.map((v, i) => [v, i]));
  return { x: xs, datos: curvas.map((c) => { const d = Array(xs.length).fill(null); c.puntos.forEach((p) => { const i = idx.get(p[campoX]); if (i != null && Number.isFinite(p[campoY])) d[i] = p[campoY]; }); return d; }) };
}

/* Indicador de estado: siempre ícono + texto, nunca solo color. */
const ICONO_ESTADO = { bien: "✓", aviso: "!", serio: "▲", critico: "✕", neutro: "–" };
function Estado({ tipo = "neutro", children, T, compacto = false }) {
  const color = ESTADO[tipo] || T.inkFaint;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: compacto ? "1px 8px" : "3px 10px", borderRadius: 999, border: `1px solid ${color}`, background: `${color}1f`, color: T.ink, fontSize: compacto ? 12 : 12.5, fontWeight: 600, whiteSpace: "nowrap" }}>
      <span aria-hidden="true" style={{ display: "inline-grid", placeItems: "center", width: 15, height: 15, borderRadius: "50%", background: color, color: tipo === "aviso" ? "#0b0b0b" : "#fff", fontSize: 10, fontWeight: 800 }}>{ICONO_ESTADO[tipo]}</span>
      {children}
    </span>
  );
}

/* Barra de banda: dónde está un valor dentro de [min, max] (p. ej. Q regulado del día frente a la banda 1891). */
function BarraBanda({ T, valor, min, max, rango, marcas = [], unidad = "m³/s", decimales = 1 }) {
  if (min == null || max == null) return null;
  const [a, b] = rango || [min - (max - min) * 0.6, max + (max - min) * 0.6];
  const pos = (v) => `${Math.max(0, Math.min(100, ((v - a) / (b - a)) * 100))}%`;
  const dentro = valor != null && valor >= min && valor <= max;
  return (
    <div style={{ position: "relative", height: 46, marginTop: 6 }} role="img" aria-label={`Valor ${fmtNum(valor, decimales)} ${unidad}; banda ${fmtNum(min, decimales)} a ${fmtNum(max, decimales)} ${unidad}`}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 16, height: 10, borderRadius: 5, background: T.lineSoft }} />
      <div style={{ position: "absolute", left: pos(min), width: `calc(${pos(max)} - ${pos(min)})`, top: 16, height: 10, borderRadius: 5, background: `${ESTADO.bien}55`, border: `1px solid ${ESTADO.bien}` }} />
      {marcas.map((m, i) => m.v != null && (
        <div key={i} title={m.rotulo} style={{ position: "absolute", left: pos(m.v), top: 12, height: 18, borderLeft: `2px dashed ${T.inkFaint}` }} />
      ))}
      {valor != null && (
        <div style={{ position: "absolute", left: pos(valor), top: 8, transform: "translateX(-50%)", width: 4, height: 26, borderRadius: 2, background: dentro ? T.ink : ESTADO.critico, boxShadow: `0 0 0 2px ${T.panel}` }} />
      )}
      <div style={{ position: "absolute", left: pos(min), top: 30, transform: "translateX(-50%)", fontSize: 11, color: T.inkFaint, fontVariantNumeric: "tabular-nums" }}>{fmtNum(min, decimales)}</div>
      <div style={{ position: "absolute", left: pos(max), top: 30, transform: "translateX(-50%)", fontSize: 11, color: T.inkFaint, fontVariantNumeric: "tabular-nums" }}>{fmtNum(max, decimales)}</div>
    </div>
  );
}

export { unirCurvas, hhmm, COLOR_TRAMO, GraficoSeries, Estado, BarraBanda, colorSerie, ESTADO, SERIE, aSeg, deSeg, fmtNum, MESES };
