/* ============================================================
   Piezas comunes de los módulos: encabezado "para qué sirve",
   tarjetas, indicadores, panel de conexión a los datos y selector
   de periodo.
   ============================================================ */
import { useState } from "react";
import { FONT_BODY, InfoTip } from "./base.jsx";
import { useDatos } from "../datos/fuentes.jsx";
import { useSesion } from "../datos/sesion.jsx";
import { Estado, fmtNum } from "./graficos.jsx";

const leerLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const escribirLocal = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

const estiloTarjeta = (T) => ({ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 12, padding: "14px 16px", boxShadow: T.cardShadow, marginBottom: 12 });

/* Texto de apoyo: corto, se muestra en una línea discreta; largo, queda en el ícono «i»
   junto al título (junto con el tip, si lo hay). Así las tarjetas no se llenan de texto. */
const LIMITE_SUBTITULO = 110;
const esCorto = (x) => typeof x === "string" && x.length <= LIMITE_SUBTITULO;
function ayudaDe(subtitulo, tip) {
  const largo = subtitulo && !esCorto(subtitulo) ? subtitulo : null;
  if (!largo) return tip || null;
  return tip ? <>{largo}<br /><br />{tip}</> : largo;
}

/* Encabezado de cada módulo: título y, a la vista solo si se pide, la guía
   (para qué sirve, qué logra, qué entrega). Queda recordado en este navegador. */
function Proposito({ T, id, titulo, para, logras, resultados, fuente, children }) {
  const clave = `ituango-guia-${id}`;
  const [abierta, setAbierta] = useState(() => leerLocal(clave) === "1");
  const alternar = () => { const n = !abierta; setAbierta(n); escribirLocal(clave, n ? "1" : "0"); };
  const caja = { background: T.panelSoft, borderRadius: 8, padding: "9px 11px", fontSize: 12.5, color: T.inkMuted, lineHeight: 1.45 };
  const rot = { fontSize: 11, fontWeight: 700, color: T.ink, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 };
  return (
    <section style={{ margin: "2px 0 12px" }} aria-labelledby={`tit-${id}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
          <h2 id={`tit-${id}`} style={{ margin: 0, fontSize: 18, fontWeight: 750, color: T.ink, letterSpacing: "-0.01em" }}>{titulo}</h2>
          {fuente && <InfoTip T={T} text={<><b>Fuente:</b> {fuente}</>} />}
        </div>
        <button onClick={alternar} aria-expanded={abierta} style={{ flexShrink: 0, border: `1px solid ${abierta ? T.teal : T.line}`, background: abierta ? T.panelSoft : "transparent", color: abierta ? T.ink : T.inkMuted, borderRadius: 999, padding: "3px 11px", fontSize: 12, cursor: "pointer", fontFamily: FONT_BODY }}>
          {abierta ? "Ocultar guía" : "Guía del módulo"}
        </button>
      </div>
      {abierta && (
        <div className="itu-guia" style={{ marginTop: 10 }}>
          <div style={caja}><div style={rot}>Para qué sirve</div>{para}</div>
          <div style={caja}><div style={rot}>Qué logra</div>{logras}</div>
          <div style={caja}><div style={rot}>Qué entrega</div>{resultados}</div>
        </div>
      )}
      {children}
    </section>
  );
}

function Tarjeta({ T, titulo, subtitulo, tip, accion, children, id }) {
  const ayuda = ayudaDe(subtitulo, tip);
  const corto = subtitulo && esCorto(subtitulo) ? subtitulo : null;
  return (
    <section style={estiloTarjeta(T)} id={id}>
      {(titulo || accion) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: corto ? 2 : 10 }}>
          <div style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: T.ink }}>{titulo}</h3>
            {ayuda && <InfoTip T={T} text={ayuda} />}
          </div>
          {accion}
        </div>
      )}
      {corto && <p style={{ margin: "0 0 10px", fontSize: 12, color: T.inkFaint, lineHeight: 1.4 }}>{corto}</p>}
      {children}
    </section>
  );
}

/* Nota plegable: el detalle metodológico queda a un clic. */
function Nota({ T, rotulo = "Cómo se calcula", children }) {
  const [ver, setVer] = useState(false);
  return (
    <div style={{ marginTop: 8 }}>
      <button onClick={() => setVer((x) => !x)} aria-expanded={ver} style={{ border: "none", background: "transparent", padding: 0, color: T.inkFaint, fontSize: 12, cursor: "pointer", fontFamily: FONT_BODY, textDecoration: "underline dotted", textUnderlineOffset: 3 }}>
        {ver ? `Ocultar: ${rotulo.toLowerCase()}` : `${rotulo} ›`}
      </button>
      {ver && <div style={{ marginTop: 6, fontSize: 12, color: T.inkMuted, lineHeight: 1.5, background: T.panelSoft, borderRadius: 8, padding: "8px 10px" }}>{children}</div>}
    </div>
  );
}

/* Indicador: valor grande, unidad, rótulo y nota. */
function Kpi({ T, rotulo, valor, unidad, decimales = 1, nota, estado, tip, grande = false, actualizado }) {
  return (
    <div style={{ background: T.panelSoft, border: `1px solid ${T.lineSoft}`, borderRadius: 10, padding: "11px 13px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", fontSize: 12, color: T.inkMuted, fontWeight: 600, gap: 4 }}>
        <span style={{ minWidth: 0 }}>{rotulo}</span>{tip && <InfoTip T={T} text={tip} />}
        {actualizado && <SelloHora T={T} cuando={actualizado} />}
      </div>
      <div style={{ marginTop: 4, display: "flex", alignItems: "baseline", gap: 5, flexWrap: "wrap" }}>
        <span style={{ fontSize: grande ? 28 : 22, fontWeight: 750, color: T.ink, letterSpacing: "-0.02em" }}>{typeof valor === "number" ? fmtNum(valor, decimales) : valor ?? "—"}</span>
        {unidad && <span style={{ fontSize: 12.5, color: T.inkFaint }}>{unidad}</span>}
      </div>
      {estado && <div style={{ marginTop: 6 }}>{estado}</div>}
      {nota && <div style={{ marginTop: 5, fontSize: 12, color: T.inkFaint, lineHeight: 1.4 }}>{nota}</div>}
    </div>
  );
}

/* Panel para conectar el repositorio de datos (token de solo lectura). */
function PanelConexion({ T, compacto = false }) {
  const d = useDatos();
  const sesion = useSesion();
  const [texto, setTexto] = useState(d.token);
  const [mostrar, setMostrar] = useState(false);
  const input = { width: "100%", padding: "8px 10px", fontSize: 13, background: T.panelSoft, border: `1px solid ${T.line}`, borderRadius: 7, color: T.ink, fontFamily: FONT_BODY };
  if (d.modo === "sesion") {
    return (
      <div style={{ ...estiloTarjeta(T) }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15.5, color: T.ink }}>Conexión a los datos de operación</h3>
        <Estado T={T} tipo="bien" compacto>Conectado con su sesión ({sesion.email})</Estado>
        {!compacto && <p style={{ margin: "10px 0 0", fontSize: 12.5, color: T.inkMuted, lineHeight: 1.5 }}>Los datos llegan por el servidor de la app, que verifica su sesión y que la cuenta esté aprobada. No necesita token.</p>}
      </div>
    );
  }
  return (
    <div style={{ ...estiloTarjeta(T), borderColor: d.conectado ? T.line : T.amber }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 15.5, color: T.ink }}>Conexión a los datos de operación</h3>
      <p style={{ margin: "0 0 12px", fontSize: 12.5, color: T.inkMuted, lineHeight: 1.5 }}>
        Los datos de LoggerNet y el histórico están en un repositorio privado. Pegue el <b>token de solo lectura</b> (empieza por <code>github_pat_</code>).
        {!compacto && " Se pide una sola vez: queda guardado en este navegador (desmarque «Recordar» en un equipo compartido). Se usa solo para leer el repositorio. HydroForecast es público y no lo necesita."}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
        <input type={mostrar ? "text" : "password"} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="github_pat_…" autoComplete="off" spellCheck={false} style={input} aria-label="Token de lectura" />
        <button onClick={() => setMostrar((m) => !m)} style={{ ...input, width: "auto", cursor: "pointer" }}>{mostrar ? "Ocultar" : "Ver"}</button>
      </div>
      {!compacto && (
        <div style={{ marginTop: 8 }}>
          <label style={{ fontSize: 12, color: T.inkMuted }}>Repositorio</label>
          <input value={d.repo} onChange={(e) => d.setRepo(e.target.value.trim())} style={{ ...input, marginTop: 3 }} />
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: T.inkMuted }}>
          <input type="checkbox" checked={d.recordar} onChange={(e) => d.setRecordar(e.target.checked)} /> Recordar en este equipo
        </label>
        <button onClick={async () => { d.setToken(texto); }} style={{ padding: "7px 16px", background: T.teal, color: T.onAccent, border: "none", borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Conectar</button>
        {d.conectado && <button onClick={() => d.verificar()} style={{ padding: "7px 12px", background: "transparent", color: T.inkMuted, border: `1px solid ${T.line}`, borderRadius: 7, fontSize: 12.5, cursor: "pointer" }}>Probar</button>}
        {d.conectado && <button onClick={() => { d.setToken(""); setTexto(""); }} style={{ padding: "7px 12px", background: "transparent", color: T.inkMuted, border: `1px solid ${T.line}`, borderRadius: 7, fontSize: 12.5, cursor: "pointer" }}>Desconectar</button>}
        {d.verificado && <Estado T={T} tipo={d.verificado.ok ? "bien" : "critico"} compacto>{d.verificado.txt}</Estado>}
      </div>
      {d.conectado && !compacto && <EnlaceOtroEquipo T={T} enlace={d.enlaceConfiguracion} />}
    </div>
  );
}

/* Enlace para conectar otro equipo con un clic (lleva el token: compártalo solo por un canal privado). */
function EnlaceOtroEquipo({ T, enlace }) {
  const [copiado, setCopiado] = useState(false);
  if (!enlace) return null;
  const copiar = async () => {
    try { await navigator.clipboard.writeText(enlace); setCopiado(true); setTimeout(() => setCopiado(false), 2500); } catch { window.prompt("Copie el enlace:", enlace); }
  };
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${T.lineSoft}`, fontSize: 12.5, color: T.inkMuted, lineHeight: 1.5 }}>
      <b style={{ color: T.ink }}>Otro equipo sin pegar el token:</b> abra en ese equipo este enlace una vez; la app queda conectada allí y la dirección se limpia sola. El enlace contiene el token: envíelo solo a usted mismo o por un canal privado, nunca en un grupo.
      <div style={{ marginTop: 6 }}>
        <button onClick={copiar} style={{ padding: "6px 12px", background: "transparent", color: T.ink, border: `1px solid ${T.line}`, borderRadius: 7, fontSize: 12.5, cursor: "pointer" }}>{copiado ? "Enlace copiado" : "Copiar enlace de conexión"}</button>
      </div>
    </div>
  );
}

/* Aviso cuando un módulo necesita el repositorio de datos. */
function RequiereConexion({ T, que = "este módulo" }) {
  return (
    <div>
      <div style={{ ...estiloTarjeta(T), fontSize: 13.5, color: T.inkMuted }}>Para ver {que} hace falta conectar el repositorio de datos de operación.</div>
      <PanelConexion T={T} />
    </div>
  );
}

/* Selector de periodo (botones de una fila). */
function SelectorPeriodo({ T, valor, onChange, opciones = [["7", "7 días"], ["30", "30 días"], ["90", "90 días"], ["365", "1 año"], ["todo", "Todo"]] }) {
  return (
    <div role="group" aria-label="Periodo" style={{ display: "inline-flex", flexWrap: "wrap", maxWidth: "100%", border: `1px solid ${T.line}`, borderRadius: 8, overflow: "hidden" }}>
      {opciones.map(([k, nombre]) => (
        <button key={k} onClick={() => onChange(k)} aria-pressed={valor === k}
          style={{ padding: "6px 12px", fontSize: 12.5, border: "none", borderRight: `1px solid ${T.line}`, background: valor === k ? T.accentSoft : T.panel, color: valor === k ? T.teal : T.inkMuted, fontWeight: valor === k ? 700 : 500, cursor: "pointer", fontFamily: FONT_BODY }}>
          {nombre}
        </button>
      ))}
    </div>
  );
}

/* Texto de antigüedad: "hace 12 min", "hace 3 h". */
function hace(min) {
  if (min == null) return "—";
  if (min < 1) return "hace menos de 1 min";
  if (min < 90) return `hace ${Math.round(min)} min`;
  if (min < 48 * 60) return `hace ${(min / 60).toLocaleString("es-CO", { maximumFractionDigits: 1 })} h`;
  return `hace ${Math.round(min / 1440)} días`;
}
const fechaCorta = (d) => { if (!d) return "—"; const [a, m, dd] = d.slice(0, 10).split("-"); return `${+dd} ${["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][+m - 1]}${d.length > 10 ? " " + d.slice(11, 16) : ""}`; };


/* Selector de rango de fechas: atajos (últimos N días) y fechas desde/hasta.
   min y max: primer y último día con datos ("AAAA-MM-DD"). valor: {desde, hasta}. */
const sumarDiasTxt = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
function rangoUltimos(max, dias, min) {
  if (!max) return { desde: null, hasta: null };
  if (dias === "todo") return { desde: min || max, hasta: max };
  const desde = sumarDiasTxt(max, -(+dias - 1));
  return { desde: min && desde < min ? min : desde, hasta: max };
}
function SelectorRango({ T, min, max, valor, onChange, atajos = [["7", "7 días"], ["30", "30 días"], ["90", "90 días"], ["365", "1 año"], ["todo", "Todo"]], etiqueta = "Rango" }) {
  const activo = atajos.find(([k]) => { const r = rangoUltimos(max, k, min); return r.desde === valor.desde && r.hasta === valor.hasta; })?.[0];
  const fecha = { padding: "5px 8px", fontSize: 12.5, background: T.panelSoft, border: `1px solid ${T.line}`, borderRadius: 7, color: T.ink, fontFamily: FONT_BODY, colorScheme: T.esOscuro ? "dark" : "light" };
  const fijar = (desde, hasta) => {
    if (!desde || !hasta) return;
    let a = desde, b = hasta;
    if (min && a < min) a = min; if (max && b > max) b = max; if (a > b) [a, b] = [b, a];
    onChange({ desde: a, hasta: b });
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }} role="group" aria-label={etiqueta}>
      <div style={{ display: "inline-flex", flexWrap: "wrap", border: `1px solid ${T.line}`, borderRadius: 8, overflow: "hidden" }}>
        {atajos.map(([k, nombre]) => (
          <button key={k} onClick={() => onChange(rangoUltimos(max, k, min))} aria-pressed={activo === k}
            style={{ padding: "6px 11px", fontSize: 12.5, border: "none", borderRight: `1px solid ${T.line}`, background: activo === k ? T.accentSoft : T.panel, color: activo === k ? T.teal : T.inkMuted, fontWeight: activo === k ? 700 : 500, cursor: "pointer", fontFamily: FONT_BODY }}>
            {nombre}
          </button>
        ))}
      </div>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: T.inkMuted }}>Desde
        <input type="date" value={valor.desde || ""} min={min || undefined} max={max || undefined} onChange={(e) => fijar(e.target.value, valor.hasta)} style={fecha} />
      </label>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: T.inkMuted }}>Hasta
        <input type="date" value={valor.hasta || ""} min={min || undefined} max={max || undefined} onChange={(e) => fijar(valor.desde, e.target.value)} style={fecha} />
      </label>
    </div>
  );
}
/* Rótulo "Actualizado …" para fichas. */
/* Hora del dato en una esquina: solo la hora si es de hoy; el detalle, al pasar el cursor. */
function SelloHora({ T, cuando }) {
  const txt = String(cuando).slice(0, 16).replace("T", " ");
  const hoy = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
  return <span title={`Actualizado ${fechaCorta(txt)}`} style={{ marginLeft: "auto", fontSize: 11, fontWeight: 500, color: T.inkFaint, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>◷ {txt.slice(0, 10) === hoy ? txt.slice(11) : fechaCorta(txt)}</span>;
}

function Actualizado({ T, cuando, prefijo = "Actualizado" }) {
  if (!cuando) return null;
  return <div style={{ fontSize: 11.5, color: T.inkFaint, marginTop: 5 }}>{prefijo} {fechaCorta(String(cuando).slice(0, 16).replace("T", " "))}</div>;
}

export { Nota, ayudaDe, esCorto, SelectorRango, rangoUltimos, Actualizado, sumarDiasTxt };
export { Proposito, Tarjeta, Kpi, PanelConexion, RequiereConexion, SelectorPeriodo, estiloTarjeta, hace, fechaCorta };
