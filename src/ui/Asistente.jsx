/* Asistente con IA (Claude): preguntas en lenguaje natural sobre la
   operación, respondidas con las herramientas de src/asistente.js. */
import { useState, useRef, useEffect } from "react";
import { useVivo } from "../datos/vivo.jsx";
import { useDatos } from "../datos/fuentes.jsx";
import { ahoraColombia } from "../datos/tiempo.js";
import { MODELOS, preguntar, preguntarLocal, preguntarGitHub, listarModelosLocales, URL_LOCAL_DEFECTO } from "../asistente.js";
import { Proposito, Tarjeta } from "./comunes.jsx";
import { Estado } from "./graficos.jsx";

const CLAVE_API = "ituango-asistente-clave";
const CLAVE_MODELO = "ituango-asistente-modelo";
const CLAVE_ESPACIO = "ituango-asistente-espacio";
const CLAVE_PROVEEDOR = "ituango-asistente-proveedor";
const CLAVE_URL_LOCAL = "ituango-asistente-url-local";
const CLAVE_MODELO_LOCAL = "ituango-asistente-modelo-local";
const leerLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const escribirLocal = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

const SUGERENCIAS = [
  "¿Cómo va la regla 1891 hoy y cuánto debo generar el resto del día para cerrar dentro de la banda?",
  "¿Qué apertura tiene cada unidad ahora y alguna pasa del 97 %?",
  "Si genero 900 MW constantes las próximas 10 horas, ¿dónde queda el nivel del embalse?",
  "Resume la última semana: cumplimiento de la regla, vertimientos y horas por unidad.",
  "¿Qué caudal pronostica HydroForecast para los próximos 5 días?",
];
const NOMBRE_HERR = { estado_actual: "estado en vivo", historico_diario: "histórico diario", serie_horaria: "serie horaria", pronostico_caudal: "pronóstico HydroForecast", simular_nivel: "simulación de nivel", punto_operacion: "punto de operación en la colina" };

/* Markdown mínimo: párrafos, viñetas, negrita y tablas con "|". */
function Texto({ T, texto }) {
  const lineas = texto.split("\n");
  const out = [];
  const negrita = (s, k) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <b key={`${k}-${i}`} style={{ color: T.ink }}>{p.slice(2, -2)}</b> : p));
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    if (/^\s*\|/.test(l)) {
      const tabla = [];
      while (i < lineas.length && /^\s*\|/.test(lineas[i])) { tabla.push(lineas[i]); i++; }
      i--;
      const filas = tabla.filter((x) => !/^\s*\|[\s:|-]+\|\s*$/.test(x)).map((x) => x.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
      out.push(
        <div key={i} className="itu-tabla" style={{ margin: "6px 0" }}><table style={{ borderCollapse: "collapse", fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
          <tbody>{filas.map((f, k) => <tr key={k} style={{ borderTop: k ? `1px solid ${T.lineSoft}` : "none" }}>{f.map((c, j) => k === 0 ? <th key={j} style={{ padding: "4px 8px", textAlign: "left", color: T.inkFaint }}>{c}</th> : <td key={j} style={{ padding: "4px 8px", color: T.ink }}>{negrita(c, `${k}${j}`)}</td>)}</tr>)}</tbody>
        </table></div>);
    } else if (/^\s*[-*•]\s+/.test(l)) out.push(<div key={i} style={{ paddingLeft: 14, textIndent: -10 }}>• {negrita(l.replace(/^\s*[-*•]\s+/, ""), i)}</div>);
    else if (/^#{1,4}\s/.test(l)) out.push(<div key={i} style={{ fontWeight: 700, color: T.ink, marginTop: 6 }}>{l.replace(/^#+\s/, "")}</div>);
    else if (l.trim() === "") out.push(<div key={i} style={{ height: 6 }} />);
    else out.push(<div key={i}>{negrita(l, i)}</div>);
  }
  return <div style={{ fontSize: 13.5, lineHeight: 1.55, color: T.inkMuted }}>{out}</div>;
}

export default function Asistente({ T }) {
  const { vivo } = useVivo() || {};
  const datos = useDatos();
  const [clave, setClave] = useState(() => leerLocal(CLAVE_API) || "");
  const [borrador, setBorrador] = useState(clave);
  const [recordar, setRecordar] = useState(() => !!leerLocal(CLAVE_API));
  const [modelo, setModelo] = useState(() => leerLocal(CLAVE_MODELO) || MODELOS[0][0]);
  const [espacio, setEspacio] = useState(() => leerLocal(CLAVE_ESPACIO) || "");
  const [proveedor, setProveedor] = useState(() => leerLocal(CLAVE_PROVEEDOR) || "github"); // "github" (Claude vía GitHub) | "local" (Ollama) | "claude" (clave propia)
  const [urlLocal, setUrlLocal] = useState(() => leerLocal(CLAVE_URL_LOCAL) || URL_LOCAL_DEFECTO);
  const [modeloLocal, setModeloLocal] = useState(() => leerLocal(CLAVE_MODELO_LOCAL) || "");
  const [modelosLocales, setModelosLocales] = useState(null);
  const [conexion, setConexion] = useState({ estado: "sin_probar", msg: "" });
  const [historial, setHistorial] = useState([]); // mensajes del proveedor activo
  const [vista, setVista] = useState([]); // [{ rol, texto, pasos }]
  const [pregunta, setPregunta] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  const ctrl = useRef(null);
  const fin = useRef(null);

  useEffect(() => { escribirLocal(CLAVE_API, recordar && clave ? clave : null); }, [recordar, clave]);
  useEffect(() => { escribirLocal(CLAVE_MODELO, modelo); }, [modelo]);
  useEffect(() => { escribirLocal(CLAVE_ESPACIO, espacio.trim() || null); }, [espacio]);
  useEffect(() => { escribirLocal(CLAVE_PROVEEDOR, proveedor); setVista([]); setHistorial([]); setError(null); }, [proveedor]);
  useEffect(() => { escribirLocal(CLAVE_URL_LOCAL, urlLocal.trim() || null); }, [urlLocal]);
  useEffect(() => { escribirLocal(CLAVE_MODELO_LOCAL, modeloLocal || null); }, [modeloLocal]);
  const local = proveedor === "local";
  const github = proveedor === "github";
  const listo = github ? datos.conectado : local ? !!modeloLocal : !!clave;
  const [espera, setEspera] = useState(null);

  async function probarConexion() {
    setConexion({ estado: "probando", msg: "" });
    try {
      const ms = await listarModelosLocales(urlLocal);
      setModelosLocales(ms);
      if (!ms.length) { setConexion({ estado: "aviso", msg: "Ollama responde, pero no tiene modelos descargados (ollama pull qwen3:8b)." }); return; }
      if (!ms.includes(modeloLocal)) setModeloLocal(ms.find((m) => /^qwen3/.test(m)) || ms[0]);
      setConexion({ estado: "bien", msg: `Conectado: ${ms.length} modelo(s) disponible(s).` });
    } catch (e) { setModelosLocales(null); setConexion({ estado: "critico", msg: e.message }); }
  }

  useEffect(() => { if (fin.current) fin.current.scrollIntoView({ block: "nearest" }); }, [vista, ocupado]);

  async function enviar(texto) {
    const q = (texto ?? pregunta).trim();
    if (!q || !listo || ocupado) return;
    setError(null); setPregunta(""); setOcupado(true);
    const pasos = [];
    setVista((v) => [...v, { rol: "usuario", texto: q }, { rol: "asistente", texto: "", pasos }]);
    ctrl.current = new AbortController();
    try {
      const ctx = { vivo, leerJSON: datos.conectado ? datos.leerJSON : () => Promise.reject(new Error("Sin conexión al repositorio de datos.")), ahora: ahoraColombia() };
      const comun = {
        ctx, senal: ctrl.current.signal, historial: [...historial, { role: "user", content: q }],
        onPaso: (p) => { pasos.push(p); setVista((v) => { const c = v.slice(); c[c.length - 1] = { ...c[c.length - 1], pasos: pasos.slice() }; return c; }); },
      };
      if (github) {
        const previos = vista.filter((m) => m.texto).map((m) => ({ rol: m.rol, texto: m.texto }));
        const r = await preguntarGitHub({ datos, pregunta: q, historial: previos, modelo, senal: ctrl.current.signal, onEstado: setEspera });
        setVista((v) => { const c = v.slice(); c[c.length - 1] = { rol: "asistente", texto: r.texto || "(sin texto)", pasos: r.pasos, uso: r.uso, nota: r.ultimoDato ? `Dato usado: ${r.ultimoDato} · ${r.modelo}` : r.modelo }; return c; });
      } else {
        const res = local ? await preguntarLocal({ ...comun, url: urlLocal, modelo: modeloLocal })
          : await preguntar({ ...comun, clave, espacio: espacio.trim() || null, modelo });
        setHistorial(res.mensajes);
        setVista((v) => { const c = v.slice(); c[c.length - 1] = { rol: "asistente", texto: res.texto || "(sin texto)", pasos: pasos.slice(), uso: res.uso }; return c; });
      }
    } catch (e) {
      setVista((v) => v.slice(0, -2));
      setError(e.name === "AbortError" ? "Consulta cancelada." : e.message);
      setPregunta(q);
    } finally { setOcupado(false); setEspera(null); }
  }

  const entrada = { padding: "8px 10px", borderRadius: 6, border: `1px solid ${T.line}`, background: T.panel, color: T.ink, fontSize: 13, boxSizing: "border-box" };
  const boton = (activo = true) => ({ padding: "8px 14px", borderRadius: 6, border: "none", background: activo ? T.teal : T.disabledBg, color: activo ? T.onAccent : T.inkFaint, fontWeight: 700, fontSize: 13, cursor: activo ? "pointer" : "default" });
  const chip = { padding: "5px 10px", borderRadius: 999, border: `1px solid ${T.line}`, background: T.panelSoft, color: T.inkMuted, fontSize: 12.5, cursor: "pointer", textAlign: "left" };

  return (
    <>
      <Proposito T={T} id="asistente" titulo="Asistente (IA)" fuente="Claude vía GitHub (cualquier equipo), modelo local (Ollama, gratis) o Claude con clave propia, con herramientas que leen los datos de la app y usan sus modelos"
        para="Hacer preguntas en lenguaje natural sobre la operación: cómo va el día, qué pasó en un periodo, qué apertura o caudal tendría un punto de operación, o dónde quedaría el nivel con un programa de potencia."
        logras="Respuestas en segundos que cruzan varios módulos, con las cifras sacadas de los datos (el asistente no tiene cifras propias: consulta herramientas y dice cuáles usó)."
        resultados="Respuesta escrita con las cifras y la hora del dato, y la lista de consultas que hizo (estado en vivo, histórico, serie horaria, HydroForecast, simulación de nivel, colina)." />

      <Tarjeta T={T} titulo="Configuración" subtitulo="Elija dónde corre el modelo de IA. Las herramientas y los datos que consulta son los mismos en los tres casos.">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {[["github", "Claude vía GitHub · cualquier equipo"], ["local", "Modelo local (Ollama) · gratis"], ["claude", "Claude con clave propia"]].map(([id, n]) => (
            <button key={id} onClick={() => setProveedor(id)} disabled={ocupado} style={{ ...chip, borderRadius: 6, padding: "7px 12px", fontWeight: proveedor === id ? 700 : 400, color: proveedor === id ? T.onAccent : T.inkMuted, background: proveedor === id ? T.teal : T.panelSoft, borderColor: proveedor === id ? T.teal : T.line }}>{n}</button>
          ))}
        </div>

        {github ? (
          <>
            <div style={{ padding: "10px 12px", borderRadius: 8, background: T.panelSoft, border: `1px solid ${T.amber}`, color: T.ink, fontSize: 12.5, lineHeight: 1.5, marginBottom: 12 }}>
              <b>Funciona en cualquier equipo, sin instalar nada.</b> La pregunta va al repositorio de datos y GitHub Actions la responde con Claude usando la clave guardada allí como secret (nunca llega al navegador); tarda de 30 a 90 segundos. Las cifras que el asistente consulte se envían a la API de Anthropic: úselo solo si la política de EPM lo permite. Requiere que su token de GitHub tenga permiso de escritura (<i>Contents: Read and write</i>) en el repositorio de datos.
            </div>
            <label style={{ fontSize: 12.5, color: T.inkMuted, display: "block", maxWidth: 360 }}>Modelo
              <select value={modelo} onChange={(e) => setModelo(e.target.value)} style={{ ...entrada, width: "100%", marginTop: 4 }}>
                {MODELOS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
              </select>
            </label>
          </>
        ) : local ? (
          <>
            <div style={{ padding: "10px 12px", borderRadius: 8, background: T.panelSoft, border: `1px solid ${T.line}`, color: T.ink, fontSize: 12.5, lineHeight: 1.5, marginBottom: 12 }}>
              <b>Los datos no salen de este computador.</b> El modelo corre en Ollama, instalado en este equipo; la página le habla en <code>localhost</code>. Requiere Ollama abierto, un modelo con herramientas (recomendado <code>qwen3:8b</code>) y la variable <code>OLLAMA_ORIGINS</code> con esta dirección. La primera vez Chrome pide permiso para acceder a la red local: acéptelo. Las respuestas son más lentas y menos precisas que con Claude.
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ fontSize: 12.5, color: T.inkMuted, flex: "1 1 240px" }}>Dirección de Ollama
                <input value={urlLocal} onChange={(e) => setUrlLocal(e.target.value)} placeholder={URL_LOCAL_DEFECTO} style={{ ...entrada, width: "100%", marginTop: 4 }} />
              </label>
              <label style={{ fontSize: 12.5, color: T.inkMuted, flex: "1 1 220px" }}>Modelo
                {modelosLocales && modelosLocales.length ? (
                  <select value={modeloLocal} onChange={(e) => setModeloLocal(e.target.value)} style={{ ...entrada, width: "100%", marginTop: 4 }}>
                    {modelosLocales.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                ) : <input value={modeloLocal} onChange={(e) => setModeloLocal(e.target.value.trim())} placeholder="qwen3:8b" style={{ ...entrada, width: "100%", marginTop: 4 }} />}
              </label>
              <button onClick={probarConexion} disabled={conexion.estado === "probando"} style={{ ...boton(conexion.estado !== "probando"), marginBottom: 1 }}>{conexion.estado === "probando" ? "Probando…" : "Probar conexión"}</button>
            </div>
            {conexion.msg && <div style={{ marginTop: 8 }}><Estado T={T} tipo={conexion.estado}>{conexion.msg}</Estado></div>}
          </>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: T.inkMuted, marginBottom: 8 }}>Necesita una clave de la API de Anthropic (Claude Console: platform.claude.com), de pago por uso. Créela dentro de un espacio de trabajo con límite de gasto. La clave se guarda solo en este navegador si marca «Recordar».</div>
            <div style={{ padding: "10px 12px", borderRadius: 8, background: T.panelSoft, border: `1px solid ${T.amber}`, color: T.ink, fontSize: 12.5, lineHeight: 1.5, marginBottom: 12 }}>
              <b>Datos que salen de la app.</b> Cada pregunta, y las cifras de operación que el asistente consulte para responderla, se envían a la API de Anthropic con su clave. Úselo solo si la política de EPM lo permite para estos datos. Nada se envía hasta que usted haga una pregunta; el resto de la app no usa la IA.
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ fontSize: 12.5, color: T.inkMuted, flex: "1 1 260px" }}>Clave de API
                <input type="password" autoComplete="off" value={borrador} onChange={(e) => setBorrador(e.target.value)} onBlur={() => setClave(borrador.trim())} placeholder="sk-ant-…" style={{ ...entrada, width: "100%", marginTop: 4 }} />
              </label>
              <label style={{ fontSize: 12.5, color: T.inkMuted, flex: "1 1 220px" }}>Modelo
                <select value={modelo} onChange={(e) => setModelo(e.target.value)} style={{ ...entrada, width: "100%", marginTop: 4 }}>
                  {MODELOS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 12.5, color: T.inkMuted, flex: "1 1 220px" }}>ID del espacio de trabajo (opcional)
                <input value={espacio} onChange={(e) => setEspacio(e.target.value)} placeholder="wrkspc_… (solo si la clave no es de un espacio)" style={{ ...entrada, width: "100%", marginTop: 4 }} />
              </label>
              <label style={{ fontSize: 12.5, color: T.inkMuted, display: "flex", gap: 6, alignItems: "center", paddingBottom: 9 }}>
                <input type="checkbox" checked={recordar} onChange={(e) => setRecordar(e.target.checked)} /> Recordar en este equipo
              </label>
              {clave && <button onClick={() => { setClave(""); setBorrador(""); }} style={{ ...chip, marginBottom: 4 }}>Borrar clave</button>}
            </div>
          </>
        )}
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12.5 }}>
          <Estado T={T} compacto tipo={listo ? "bien" : "neutro"}>{github ? (datos.conectado ? "Token de GitHub listo" : "Falta el token de GitHub") : local ? (modeloLocal ? `Modelo: ${modeloLocal}` : "Sin modelo") : clave ? "Clave lista" : "Sin clave"}</Estado>
          <Estado T={T} compacto tipo={vivo && vivo.ultima ? "bien" : "aviso"}>{vivo && vivo.ultima ? `Datos en vivo: ${vivo.ultima.t}` : "Sin datos en vivo"}</Estado>
          <Estado T={T} compacto tipo={datos.conectado ? "bien" : "aviso"}>{datos.conectado ? "Histórico disponible" : "Sin token del repositorio: no hay histórico"}</Estado>
        </div>
      </Tarjeta>

      <Tarjeta T={T} titulo="Conversación" accion={vista.length > 0 && !ocupado ? <button onClick={() => { setVista([]); setHistorial([]); setError(null); }} style={chip}>Nueva conversación</button> : null}>
        {vista.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 12.5, color: T.inkFaint }}>Ejemplos:</span>
            {SUGERENCIAS.map((s) => <button key={s} style={chip} disabled={!listo || ocupado} onClick={() => enviar(s)}>{s}</button>)}
          </div>
        )}
        {vista.map((m, i) => (
          <div key={i} style={{ margin: "8px 0", padding: "10px 12px", borderRadius: 8, background: m.rol === "usuario" ? T.accentSoft : T.panelSoft }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: T.inkFaint, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>{m.rol === "usuario" ? "Usted" : "Asistente"}</div>
            {m.pasos && m.pasos.length > 0 && <div style={{ fontSize: 12, color: T.inkFaint, marginBottom: 6 }}>Consultó: {m.pasos.map((p) => NOMBRE_HERR[p.nombre] || p.nombre).join(" · ")}</div>}
            {m.rol === "usuario" ? <div style={{ fontSize: 13.5, color: T.ink }}>{m.texto}</div> : m.texto ? <Texto T={T} texto={m.texto} /> : <div style={{ fontSize: 13, color: T.inkFaint }}>{github && espera ? (espera.fase === "enviada" ? "Pregunta enviada a GitHub…" : `GitHub está respondiendo… ${espera.segundos} s (normal: 30–90 s)`) : "Pensando…"}</div>}
            {m.nota && <div style={{ fontSize: 11, color: T.inkFaint, marginTop: 6 }}>{m.nota}</div>}
            {m.uso && <div style={{ fontSize: 11, color: T.inkFaint, marginTop: 6 }}>Tokens: {m.uso.input_tokens} de entrada · {m.uso.output_tokens} de salida (última llamada){local && m.uso.input_tokens >= 3900 ? " · cerca del límite de contexto de Ollama: suba OLLAMA_CONTEXT_LENGTH" : ""}</div>}
          </div>
        ))}
        {error && <div style={{ margin: "8px 0" }}><Estado T={T} tipo="critico">{error}</Estado></div>}
        <div ref={fin} />
        <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "flex-end" }}>
          <textarea value={pregunta} onChange={(e) => setPregunta(e.target.value)} rows={2} placeholder={listo ? "Escriba su pregunta… (Enter para enviar, Mayús+Enter para nueva línea)" : github ? "Conecte primero el token del repositorio de datos (arriba a la derecha)" : local ? "Primero pruebe la conexión con Ollama y elija un modelo" : "Ingrese primero la clave de API"}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }} disabled={!listo}
            style={{ ...entrada, flex: 1, resize: "vertical", fontFamily: "inherit" }} />
          {ocupado ? <button style={boton(true)} onClick={() => ctrl.current && ctrl.current.abort()}>Cancelar</button>
            : <button style={boton(listo && !!pregunta.trim())} disabled={!listo || !pregunta.trim()} onClick={() => enviar()}>Enviar</button>}
        </div>
      </Tarjeta>
    </>
  );
}
