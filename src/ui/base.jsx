/* ============================================================
   COMPONENTES BASE DE LA INTERFAZ — temas, tipografías, controles
   (Slider, BotonGrupo, Etiqueta…) y utilidades de gráficos.
   Separado de ItuangoSimulador.jsx en oct-2026 sin cambios.
   ============================================================ */
import { useState, useEffect, useRef } from "react";

/* ============================================================
   TEMAS — claro / oscuro
   ============================================================ */
/* Paleta alineada con HydroForecast Ituango y Material Flotante: pizarra
   (slate) con acento azul cielo. Todos los textos cumplen contraste ≥ 4,5:1
   sobre panel y panelSoft; onAccent es el texto sobre un botón de acento. */
const THEMES = {
  dark: {
    bg: "#0b1220", bgDeep: "#020617", panel: "#111a2e", panelSoft: "#18233a",
    line: "#2a3852", lineSoft: "#1f2b44", ink: "#f1f5f9", inkMuted: "#cbd5e1",
    inkFaint: "#94a3b8", teal: "#38bdf8", tealSoft: "#7dd3fc", amber: "#fbbf24",
    amberSoft: "#78350f", red: "#f87171", cyan: "#22d3ee", cardShadow: "0 10px 30px -12px rgba(0,0,0,0.6)",
    disabledBg: "#0f172a", accentSoft: "rgba(56,189,248,0.14)", onAccent: "#0b1220", esOscuro: true,
  },
  light: {
    bg: "#eef2f7", bgDeep: "#e2e8f0", panel: "#ffffff", panelSoft: "#f1f5f9",
    line: "#cbd5e1", lineSoft: "#e2e8f0", ink: "#0f172a", inkMuted: "#334155",
    inkFaint: "#5b6b80", teal: "#0369a1", tealSoft: "#075985", amber: "#b45309",
    amberSoft: "#fde68a", red: "#b91c1c", cyan: "#0e7490", cardShadow: "0 6px 20px -8px rgba(15,23,42,0.15)",
    disabledBg: "#f1f5f9", accentSoft: "rgba(3,105,161,0.10)", onAccent: "#ffffff", esOscuro: false,
  },
};

/* Alto contraste: fondo/texto en blanco y negro puro, acentos más
   saturados y bordes más marcados — para monitores de sala de control
   o condiciones de poca luz. Se aplica como capa sobre el tema base. */
function aplicarAltoContraste(T, theme, activo) {
  if (!activo) return T;
  if (theme === "dark") {
    return { ...T, bg: "#000000", bgDeep: "#000000", panel: "#0A0A0A", panelSoft: "#141414",
      line: "#555555", lineSoft: "#333333", ink: "#FFFFFF", inkMuted: "#DDDDDD", inkFaint: "#AAAAAA",
      teal: "#5cd0ff", amber: "#FFC93D", red: "#FF5C4D", cyan: "#5CE1FF", accentSoft: "rgba(92,208,255,0.2)", onAccent: "#000000" };
  }
  return { ...T, bg: "#FFFFFF", bgDeep: "#FFFFFF", panel: "#FFFFFF", panelSoft: "#F0F0F0",
    line: "#555555", lineSoft: "#999999", ink: "#000000", inkMuted: "#1A1A1A", inkFaint: "#444444",
    teal: "#00507a", amber: "#8A5300", red: "#8A241A", cyan: "#00596B", accentSoft: "rgba(0,80,122,0.12)", onAccent: "#ffffff" };
}

const FONT_BODY = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const FONT_DISPLAY = FONT_BODY;

/* ============================================================
   ESTILOS RESPONSIVOS GLOBALES (inyectados una sola vez)
   ============================================================ */
function GlobalStyles({ T, theme, altoContraste }) {
  return (
    <style>{`
      html, body { margin:0; background:${T.bg}; color-scheme:${theme === "dark" ? "dark" : "light"}; }
      *, *::before, *::after { box-sizing:border-box; }
      :focus-visible { outline:2px solid ${T.teal}; outline-offset:2px; }
      button { font-family:${FONT_BODY}; }
      .itu-grid { display:grid; grid-template-columns: 320px 1fr; gap:20px; }
      .itu-grid-form { display:grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap:14px; }
      .itu-kpis { display:grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap:10px; }
      .itu-2col { display:grid; grid-template-columns: 1fr 1fr; gap:20px; }
      .itu-2col > *, .itu-kpis > *, .itu-guia > * { min-width:0; }
      .itu-4col { display:grid; grid-template-columns: repeat(4, 1fr); gap:12px; }
      @media (max-width: 760px) { .itu-2col { grid-template-columns: 1fr; } }
      @media (max-width: 560px) { .itu-4col { grid-template-columns: repeat(2, 1fr); } }
      .itu-tabla { overflow-x:auto; -webkit-overflow-scrolling:touch; }
      .itu-tabla table td:first-child, .itu-tabla table th:first-child { position:sticky; left:0; background:${T.panel}; z-index:1; }
      .itu-top { position:sticky; top:0; z-index:40; background:${theme === "dark" ? "rgba(11,18,32,0.88)" : "rgba(238,242,247,0.9)"}; backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); border-bottom:1px solid ${T.lineSoft}; }
      .itu-grupos { display:flex; gap:6px; overflow-x:auto; scrollbar-width:none; padding-bottom:6px; }
      .itu-grupos::-webkit-scrollbar { display:none; }
      .itu-grupos a { white-space:nowrap; padding:5px 12px; font-size:12.5px; font-weight:600; letter-spacing:0.01em; color:${T.inkMuted}; text-decoration:none; border:1px solid ${T.line}; border-radius:999px; }
      .itu-grupos a:hover { color:${T.ink}; border-color:${T.teal}; }
      .itu-grupos a.on { color:${T.onAccent}; background:${T.teal}; border-color:${T.teal}; }
      .itu-guia { display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; }
      @media (max-width: 820px) { .itu-guia { grid-template-columns: 1fr; } }
      .itu-grafico .u-select { background: ${T.accentSoft}; }
      .itu-grafico .u-cursor-x, .itu-grafico .u-cursor-y { border-color: ${T.inkFaint} !important; }
      .itu-tabs { display:flex; gap:2px; overflow-x:auto; scrollbar-width:none; }
      .itu-tabs::-webkit-scrollbar { display:none; }
      .itu-tabs a { white-space:nowrap; padding:9px 12px; font-size:14px; color:${T.inkMuted}; text-decoration:none; border-bottom:2px solid transparent; border-radius:6px 6px 0 0; }
      .itu-tabs a:hover { color:${T.ink}; background:${T.accentSoft}; }
      .itu-tabs a[aria-current="page"] { color:${T.teal}; border-bottom-color:${T.teal}; font-weight:600; }
      @media (max-width: 900px) { .itu-tabs { -webkit-mask-image:linear-gradient(to right,#000 88%,transparent); mask-image:linear-gradient(to right,#000 88%,transparent); padding-right:28px; } }
      .itu-pill { border-radius:9999px; padding:5px 12px; font-size:12.5px; border:1px solid ${T.line}; background:${T.panel}; color:${T.inkMuted}; display:inline-flex; align-items:center; gap:6px; white-space:nowrap; cursor:pointer; text-decoration:none; }
      .itu-pill:hover { color:${T.ink}; border-color:${T.teal}; }
      @media (max-width: 640px) { .itu-pill .lbl { display:none; } .itu-h1 { font-size:16px !important; } .itu-sub { display:none; } }
      @media (max-width: 880px) { .itu-grid { grid-template-columns: 1fr; } }
      .itu-diagrama-card { display:grid; grid-template-columns: 400px 1fr; gap:20px; align-items:center; }
      ${altoContraste ? `
      button { min-height: 42px; }
      input[type=range] { height: 8px !important; }
      .itu-num-input, input[type=number] { border-width: 2px !important; }
      ` : ""}
      @media (max-width: 760px) { .itu-diagrama-card { grid-template-columns: 1fr; } }
      .itu-header-row { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; }
      .itu-metrics-grid { display:grid; grid-template-columns: 1fr 1fr; gap:12px 20px; }
      @media (max-width: 420px) { .itu-metrics-grid { grid-template-columns: 1fr; } }
      .itu-h1 { font-size: 19px; }
      .itu-gate-row { display:grid; grid-template-columns: repeat(4, 1fr); gap:8px; }
      @media (max-width: 520px) { .itu-gate-row { grid-template-columns: repeat(2, 1fr); } }
      .itu-num-input {
        width: 100%; box-sizing:border-box; padding:6px 8px; font-family:${FONT_BODY}; font-size:13px; font-weight:600;
        background:${T.panelSoft}; border:1px solid ${T.line}; border-radius:6px; color:${T.ink};
      }
      .itu-num-input:disabled { color:${T.inkFaint}; background:${T.disabledBg}; cursor:not-allowed; }
      .itu-water-rect { transition: y 0.6s cubic-bezier(.4,0,.2,1), height 0.6s cubic-bezier(.4,0,.2,1); }
      .itu-gate-fill { transition: y 0.5s cubic-bezier(.4,0,.2,1), height 0.5s cubic-bezier(.4,0,.2,1), opacity 0.4s; }
      .itu-jet { stroke-dasharray: 6 5; animation: itu-flow 0.9s linear infinite; transition: opacity 0.4s; }
      @keyframes itu-flow { to { stroke-dashoffset: -22; } }
      .itu-wave { animation: itu-wave-move 3.2s ease-in-out infinite; transform-origin: center; }
      @keyframes itu-wave-move { 0%,100% { transform: translateY(0px); } 50% { transform: translateY(1.4px); } }
      .itu-turbine-dot { transition: fill 0.4s, opacity 0.4s; }
      .itu-play-btn { transition: transform 0.15s, opacity 0.15s; }
      .itu-play-btn:active { transform: scale(0.96); }
      input[type=range]::-webkit-slider-thumb {
        -webkit-appearance: none; width: 13px; height: 13px; border-radius: 50%;
        background: ${T.teal}; cursor: pointer; margin-top: -4.5px;
        box-shadow: 0 0 0 3px ${T.accentSoft};
      }
      input[type=range] { -webkit-appearance: none; }
      input[type=range]::-webkit-slider-runnable-track { height: 4px; background: ${T.line}; border-radius: 2px; }
      input[type=range]:disabled::-webkit-slider-thumb { background: ${T.inkFaint}; }
    `}</style>
  );
}

/* ============================================================
   TOOLTIP INFORMATIVO
   ============================================================ */
/* Ayuda emergente: se posiciona fija y dentro de la pantalla (en el
   teléfono no se sale por los lados). Clic o toque para abrir/cerrar. */
function InfoTip({ text, T }) {
  const [pos, setPos] = useState(null);
  const caja = useRef(null);
  const abrir = (el) => {
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(360, vw - 24);
    const left = Math.max(12, Math.min(vw - w - 12, r.left + r.width / 2 - w / 2));
    const arriba = r.top > vh * 0.45;
    setPos({ left, w, top: arriba ? undefined : r.bottom + 8, bottom: arriba ? vh - r.top + 8 : undefined });
  };
  useEffect(() => {
    if (!pos) return undefined;
    const dentro = (e) => caja.current && caja.current.contains(e.target);
    const cerrar = (e) => { if (!dentro(e)) setPos(null); };
    const cerrarSiempre = () => setPos(null);
    window.addEventListener("scroll", cerrar, true);
    window.addEventListener("resize", cerrarSiempre);
    document.addEventListener("pointerdown", cerrar, true);
    return () => {
      window.removeEventListener("scroll", cerrar, true);
      window.removeEventListener("resize", cerrarSiempre);
      document.removeEventListener("pointerdown", cerrar, true);
    };
  }, [pos]);
  // Con mouse: se abre al pasar por encima. Con el dedo (o clic): un toque abre y
  // un toque fuera cierra. El hover no se usa en pantallas táctiles, porque el
  // navegador lo simula justo antes del toque y el clic lo volvía a cerrar.
  return (
    <span
      ref={caja}
      style={{ display: "inline-block", marginLeft: 6 }}
      onPointerEnter={(e) => { if (e.pointerType === "mouse") abrir(e.currentTarget); }}
      onPointerLeave={(e) => { if (e.pointerType === "mouse") setPos(null); }}
      onClick={(e) => { e.stopPropagation(); if (!pos) abrir(e.currentTarget); }}
    >
      <span role="button" tabIndex={0} aria-label="Más información" aria-expanded={!!pos}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (pos) setPos(null); else abrir(e.currentTarget); } if (e.key === "Escape") setPos(null); }}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 18, height: 18, borderRadius: "50%", border: `1px solid ${T.inkMuted}`,
          fontSize: 11, color: T.inkMuted, cursor: "help", fontFamily: FONT_BODY, fontWeight: 700, lineHeight: 1,
        }}>i</span>
      {pos && (
        <div role="tooltip" style={{
          position: "fixed", zIndex: 1000, left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.w,
          maxHeight: "60vh", overflowY: "auto",
          background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8,
          padding: "9px 11px", fontSize: 12.5, color: T.inkMuted, lineHeight: 1.45, fontWeight: 400, textTransform: "none", letterSpacing: 0,
          boxShadow: "0 10px 30px rgba(0,0,0,0.35)", fontFamily: FONT_BODY,
        }}>{text}</div>
      )}
    </span>
  );
}

function Etiqueta({ children, T, tip }) {
  return (
    <div style={{
      fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, letterSpacing: "0.01em",
      color: T.inkMuted, marginBottom: 7,
      display: "flex", alignItems: "center",
    }}>{children}{tip && <InfoTip text={tip} T={T} />}</div>
  );
}

/* Encabezado de tarjeta de gráfico, estilo "Vasslab": título claro en
   sans-serif (no monospace en mayúsculas) + subtítulo descriptivo
   siempre visible + ícono de ayuda opcional con más detalle al pasar
   el mouse. */
function ChartHeader({ titulo, subtitulo, T, tip, accion }) {
  // Subtítulo corto a la vista; largo, dentro del ícono «i» (con el tip)
  const corto = typeof subtitulo === "string" && subtitulo.length <= 110 ? subtitulo : null;
  const largo = subtitulo && !corto ? subtitulo : null;
  const ayuda = largo ? (tip ? <>{largo}<br /><br />{tip}</> : largo) : tip;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontFamily: FONT_BODY, fontSize: 15, fontWeight: 700, color: T.ink, letterSpacing: "-0.01em" }}>{titulo}</h3>
          {ayuda && <InfoTip text={ayuda} T={T} />}
        </div>
        {accion && <div style={{ flexShrink: 0 }}>{accion}</div>}
      </div>
      {corto && (
        <p style={{ margin: "2px 0 0", fontFamily: FONT_BODY, fontSize: 12, color: T.inkFaint, lineHeight: 1.4 }}>{corto}</p>
      )}
    </div>
  );
}

/* Exporta un arreglo de objetos a un archivo .csv y dispara la descarga.
   Columnas = las claves del primer objeto (todas las filas deben tener
   la misma forma, que es el caso de los datos de estas gráficas). */
function descargarCSV(filas, nombreArchivo) {
  if (!filas || filas.length === 0) return;
  const columnas = Object.keys(filas[0]);
  const escapar = (v) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lineas = [columnas.join(","), ...filas.map((f) => columnas.map((c) => escapar(f[c])).join(","))];
  const csv = "\uFEFF" + lineas.join("\n"); // BOM: acentos correctos al abrir en Excel
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo.endsWith(".csv") ? nombreArchivo : nombreArchivo + ".csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* Botón compacto "⬇ CSV" para colocar en accion={} de ChartHeader. */
/* Mismo aspecto que los botones Tabla / CSV / PNG de los gráficos. */
function BotonCSV({ data, filename, T, rotulo = "CSV", titulo = "Descargar estos datos en CSV" }) {
  return (
    <button
      onClick={() => descargarCSV(data, filename)}
      title={titulo}
      style={{ border: `1px solid ${T.line}`, background: T.panel, color: T.inkMuted, borderRadius: 6, padding: "3px 9px", fontSize: 12, cursor: "pointer", fontFamily: FONT_BODY, whiteSpace: "nowrap" }}
    >
      {rotulo}
    </button>
  );
}


function Slider({ label, value, min, max, step, onChange, unit, format, T, tip, disabled, showInput = true }) {
  const disp = format ? format(value) : value;
  // Buffer de texto local: permite borrar/escribir libremente sin que el
  // campo salte a un valor por defecto en cada tecleo (parseFloat('') es
  // NaN, y antes eso hacía caer siempre a un fallback). Solo se confirma
  // (onChange) cuando el texto es un número válido; si se deja inválido o
  // vacío al perder el foco, se revierte al último valor válido.
  const fmtPaso = (v) => {
    const dec = step && step < 1 ? Math.min(4, (String(step).split(".")[1] || "").length) : 0;
    return Number.isFinite(v) ? String(Number(v.toFixed(dec))) : String(v);
  };
  const [texto, setTexto] = useState(fmtPaso(value));
  const [editando, setEditando] = useState(false);
  useEffect(() => { if (!editando) setTexto(fmtPaso(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  function alTeclear(e) {
    const t = e.target.value;
    setTexto(t);
    const n = parseFloat(t);
    if (Number.isFinite(n)) onChange(n);
  }
  function alPerderFoco() {
    setEditando(false);
    setTexto(fmtPaso(Number.isFinite(parseFloat(texto)) ? parseFloat(texto) : value));
  }
  return (
    <div style={{ marginBottom: 16, opacity: disabled ? 0.5 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <Etiqueta T={T} tip={tip}>{label}</Etiqueta>
        {showInput ? (
          <input
            type="number" value={texto} step={step} min={min} max={max} disabled={disabled}
            onChange={alTeclear} onBlur={alPerderFoco} onFocus={() => setEditando(true)}
            className="itu-num-input" style={{ width: 84, textAlign: "right", color: T.teal }}
          />
        ) : <span style={{ fontFamily: FONT_BODY, fontSize: 14, fontWeight: 600, color: T.teal }}>{disp}{unit}</span>}
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: T.teal, height: 4, background: T.line, borderRadius: 2, cursor: disabled ? "not-allowed" : "pointer", marginTop: 4 }}
      />
    </div>
  );
}

function BotonGrupo({ label, options, value, onChange, T, tip }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <Etiqueta T={T} tip={tip}>{label}</Etiqueta>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {options.map((opt) => (
          <button
            key={opt.value} onClick={() => onChange(opt.value)}
            style={{
              flex: "1 1 auto", minWidth: 40, padding: "8px 8px", fontSize: 13, fontFamily: FONT_BODY, fontWeight: 500,
              border: `1px solid ${value === opt.value ? T.teal : T.line}`,
              background: value === opt.value ? T.accentSoft : "transparent",
              color: value === opt.value ? T.teal : T.inkMuted,
              borderRadius: 4, cursor: "pointer", transition: "all 0.15s",
            }}
          >{opt.label}</button>
        ))}
      </div>
    </div>
  );
}

function ThemeSwitch({ theme, setTheme, T }) {
  const isDark = theme === "dark";
  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      title={isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      style={{
        display: "flex", alignItems: "center", gap: 7, padding: "8px 14px",
        background: T.panel, border: `1px solid ${T.line}`, borderRadius: 20,
        color: T.inkMuted, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 500, cursor: "pointer", flexShrink: 0,
      }}
    >
      <span>{isDark ? "🌙" : "☀"}</span><span>{isDark ? "Oscuro" : "Claro"}</span>
    </button>
  );
}


const axisLabel = (text, angle = 0, side = "left") => ({
  value: text, angle,
  position: angle ? (side === "right" ? "right" : "left") : "insideBottom",
  offset: angle ? -2 : -10,
  style: { fontSize: 12.5, fontFamily: FONT_BODY, fontWeight: 600, fill: "currentColor" },
});
/* Número para mostrar, con la convención de Colombia (coma decimal, punto de
   miles), igual que Material Flotante y HydroForecast. "—" si no hay valor. */
const fx = (v, d = 1) => (v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmtTick = (v) => {
  const av = Math.abs(v);
  if (av === 0) return "0";
  if (av >= 100) return fx(v, 0);
  if (av >= 1) return fx(Math.round(v * 10) / 10, Number.isInteger(Math.round(v * 10) / 10) ? 0 : 1);
  const p = parseFloat(v.toPrecision(2)); // valores <1 (ej. P₁₁ en MW, ~0,001-0,01): suficientes decimales
  return p.toLocaleString("es-CO", { maximumFractionDigits: 6 });
};
const tickStyleFor = (T) => ({ fontSize: 11.5, fill: T.inkMuted, fontFamily: FONT_BODY });
export {
  THEMES,
  aplicarAltoContraste,
  FONT_DISPLAY,
  FONT_BODY,
  GlobalStyles,
  InfoTip,
  Etiqueta,
  ChartHeader,
  descargarCSV,
  BotonCSV,
  Slider,
  BotonGrupo,
  ThemeSwitch,
  axisLabel,
  fmtTick,
  tickStyleFor,
  fx,
};
