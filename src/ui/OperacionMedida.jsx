/* ============================================================
   Pestaña "Operación medida": generación y caudal por unidad de
   LoggerNet (dato cada minuto) frente al modelo de la colina.
   Fuentes: repositorio privado del relay (token de solo lectura,
   guardado solo en este navegador si se pide) o un archivo local
   (.dat de LoggerNet o CSV del relay), que se procesa en el
   navegador y no se envía a ningún lado.
   ============================================================ */
import { useState, useMemo, useEffect } from "react";
import { FC_HIDROMETRIA_POR_NIVEL, etiquetaCondicionDescarga, NIVEL_MIN_TEC, NAME, ETIQUETA_ESTADO_REGLA, pctFromDeg } from "../modelo.js";
import { leerLoggerNet, unirNivel, agregarIntervalos, caudalModeloIntervalos, verificarColumnaLoggerNet, reglaOperativaDiaria, caudalRegulado, resumenPorUnidad, P_EN_LINEA_MW } from "../operacion.js";
import { BotonCSV, ChartHeader, Etiqueta, FONT_BODY } from "./base.jsx";
import { useDatos } from "../datos/fuentes.jsx";
import { GraficoSeries } from "./graficos.jsx";
import { SelectorRango, rangoUltimos, sumarDiasTxt } from "./comunes.jsx";
import { GraficoApertura } from "./Apertura.jsx";

const CARPETA_GEN = "loggernet";
const CARPETA_NIVEL = "nivel";
const MAX_LOCAL_MB = 40;
/* QTurbinado_U1..4_Avg son los caudales Winter-Kennedy, aún sin calibrar
   (operaciones, nov-2026): se muestran como índice RELATIVO entre unidades
   (y frente a P / F.C.), siempre rotulados "sin calibrar". */
const MOSTRAR_WINTER_KENNEDY = true;

async function gh(url, token, raw = false) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: raw ? "application/vnd.github.raw" : "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
  if (r.status === 401) throw new Error("El token no es válido o venció (401).");
  if (r.status === 404) throw new Error("No se encontró el repositorio o la carpeta (404). Revise el nombre y que el token tenga acceso a ese repositorio.");
  if (!r.ok) throw new Error(`GitHub respondió ${r.status}.`);
  return raw ? r.text() : r.json();
}

/* Lee un archivo local grande sin cargarlo entero: cabecera + últimos MAX_LOCAL_MB. */
async function leerArchivoLocal(file) {
  if (file.size <= MAX_LOCAL_MB * 1048576) return { texto: await file.text(), recortado: false };
  const cab = await file.slice(0, 65536).text();
  const cabLineas = cab.split(/\r?\n/).slice(0, /^"?TOA5/.test(cab) ? 4 : 1).join("\n");
  const cola = await file.slice(file.size - MAX_LOCAL_MB * 1048576).text();
  return { texto: cabLineas + "\n" + cola.slice(cola.indexOf("\n") + 1), recortado: true };
}

/* Une varias lecturas: las de generación entre sí y las de nivel (All_Data) entre sí; luego el nivel a cada minuto. */
function combinarLecturas(lecturas) {
  const gen = lecturas.filter((r) => !r.soloNivel && r.filas.length);
  const niv = lecturas.filter((r) => r.soloNivel);
  const porT = new Map();
  gen.forEach((r) => r.filas.forEach((f) => porT.set(f.t, f)));
  const filasGen = [...porT.values()].sort((a, b) => (a.t < b.t ? -1 : 1));
  const filasNiv = niv.flatMap((r) => r.filas).sort((a, b) => (a.t < b.t ? -1 : 1));
  const avisos = [...new Set(lecturas.flatMap((r) => r.avisos))];
  let sinNivel = filasGen.length;
  let filas = filasGen;
  if (filasNiv.length) ({ filas, sinNivel } = unirNivel(filasGen, filasNiv));
  if (!filasNiv.length) avisos.push("Sin datos de nivel del embalse (archivo All_Data / carpeta nivel)");
  else if (sinNivel) avisos.push(`${sinNivel.toLocaleString("es-CO")} minutos sin nivel del radar a menos de 10 min`);
  return { filas, avisos, formato: [...new Set(lecturas.map((r) => r.formato))].join(" + "), columnaNivel: filasNiv.length ? "Nivel_Radar_msnm_Avg" : null, tieneQ2: gen.some((r) => r.tieneQ2), minutosNivel: filasNiv.length };
}

const fmt = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d }));

export default function OperacionMedida({ T, condDescarga }) {
  const [fuente, setFuente] = useState("github");
  // Token y repositorio compartidos con el resto de la app (panel de conexión)
  const ctxDatos = useDatos();
  const { repo, setRepo, token, setToken, recordar, setRecordar } = ctxDatos;
  // Borradores: el token y el repositorio se aplican al salir del campo (no en cada tecla)
  const [repoTxt, setRepoTxt] = useState(repo);
  const [tokenTxt, setTokenTxt] = useState(token);
  useEffect(() => { setRepoTxt(repo); }, [repo]);
  useEffect(() => { setTokenTxt(token); }, [token]);
  // Rango de fechas a cargar (por defecto, los últimos 3 días). Se baja también el día anterior al primero: es la base de su banda.
  const hoyTxt = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
  const [rango, setRango] = useState(() => rangoUltimos(hoyTxt, "3"));
  const [estado, setEstado] = useState(null); // {tipo:'info'|'error'|'ok', txt}
  const [lectura, setLectura] = useState(null); // {filas, avisos, origen, columnaNivel}
  const [modoNivel, setModoNivel] = useState("auto"); // auto | columna | fc | fijo
  const [nivelFijo, setNivelFijo] = useState(411.5);
  const [calculo, setCalculo] = useState(null);
  const [progreso, setProgreso] = useState(null);


  async function cargarGitHub() {
    const tk = (tokenTxt || token).trim(), rp = (repoTxt || repo).trim();
    if (tk !== token) setToken(tk);
    if (rp !== repo) setRepo(rp);
    if (!tk) { setEstado({ tipo: "error", txt: "Falta el token de solo lectura del repositorio de datos." }); return; }
    setEstado({ tipo: "info", txt: "Consultando GitHub…" }); setLectura(null); setCalculo(null);
    try {
      const hoy = new Date(Date.now() - 5 * 3600e3);
      const base = sumarDiasTxt(rango.desde, -1);
      const anios = [];
      for (let a = +base.slice(0, 4); a <= +rango.hasta.slice(0, 4); a++) anios.push(a);
      void hoy;
      // GitHub responde 404 tanto si falta la carpeta como si el token no ve el repositorio:
      // primero se comprueba el repositorio, para dar el error correcto.
      try { await gh(`https://api.github.com/repos/${rp}`, tk); }
      catch (e) { throw new Error(/404/.test(e.message) ? `El token no tiene acceso a ${rp}, o el repositorio no existe (404). Revise el nombre y que el token sea de ese repositorio.` : e.message); }
      const listar = async (carpeta) => {
        let out = [];
        for (const a of anios) {
          try { out = out.concat((await gh(`https://api.github.com/repos/${rp}/contents/${carpeta}/${a}`, tk)).filter((x) => /\d{4}-\d{2}-\d{2}\.csv$/.test(x.name))); }
          catch (e) { if (!/404/.test(e.message)) throw e; }
        }
        return out.sort((a, b) => (a.name < b.name ? -1 : 1));
      };
      // un día más: es la base de la banda de la regla operativa del primer día mostrado
      const enRango = (f) => { const d = f.name.slice(0, 10); return d >= base && d <= rango.hasta; };
      const gen = (await listar(CARPETA_GEN)).filter(enRango);
      if (gen.length > 32) throw new Error("Para más de 31 días use Analítica → Regla 1891 o Unidades (histórico precalculado): aquí se descarga el dato de cada minuto.");
      if (!gen.length) throw new Error(`El repositorio no tiene todavía archivos en ${CARPETA_GEN}/: revise que el relay esté corriendo.`);
      const nombres = new Set(gen.map((f) => f.name));
      const niv = (await listar(CARPETA_NIVEL)).filter((f) => nombres.has(f.name));
      const todos = [...gen, ...niv];
      const lecturas = [];
      for (const [k, f] of todos.entries()) {
        setEstado({ tipo: "info", txt: `Descargando ${f.path} (${k + 1} de ${todos.length})…` });
        lecturas.push(leerLoggerNet(await gh(`https://api.github.com/repos/${rp}/contents/${f.path}`, tk, true)));
      }
      const r = combinarLecturas(lecturas);
      setLectura({ ...r, origen: `${rp} · ${gen[0].name.slice(0, 10)} a ${gen[gen.length - 1].name.slice(0, 10)}` });
      setEstado({ tipo: "ok", txt: `${r.filas.length.toLocaleString("es-CO")} minutos de generación y ${r.minutosNivel.toLocaleString("es-CO")} registros de nivel, de ${todos.length} archivo(s).` });
    } catch (e) { setEstado({ tipo: "error", txt: e.message }); }
  }

  async function cargarArchivos(files) {
    if (!files || !files.length) return;
    setEstado({ tipo: "info", txt: `Leyendo ${files.length} archivo(s)…` }); setLectura(null); setCalculo(null);
    try {
      const lecturas = []; const notas = [];
      for (const file of files) {
        const { texto, recortado } = await leerArchivoLocal(file);
        const r = leerLoggerNet(texto);
        if (!r.filas.length) throw new Error(`${file.name}: ${r.avisos.join(" ") || "no se encontraron filas de datos."}`);
        lecturas.push(r);
        if (recortado) notas.push(`${file.name} pesa ${(file.size / 1048576).toFixed(0)} MB: se leyeron los últimos ${MAX_LOCAL_MB} MB.`);
      }
      const r = combinarLecturas(lecturas);
      if (!r.filas.length) throw new Error("Falta el archivo de generación (Caudal_Vertedero).");
      setLectura({ ...r, origen: [...files].map((f) => f.name).join(" + ") });
      setEstado({ tipo: "ok", txt: `${r.filas.length.toLocaleString("es-CO")} minutos de generación y ${r.minutosNivel.toLocaleString("es-CO")} registros de nivel. ${notas.join(" ")}` });
    } catch (e) { setEstado({ tipo: "error", txt: e.message }); }
  }

  const intervalos = useMemo(() => (lectura ? agregarIntervalos(lectura.filas, 15) : null), [lectura]);
  const verif = useMemo(() => (lectura ? verificarColumnaLoggerNet(lectura.filas) : null), [lectura]);
  const regla = useMemo(() => (lectura ? reglaOperativaDiaria(lectura.filas) : null), [lectura]);
  // Seguimiento intradiario de la regla: caudal regulado (15 min) y promedio acumulado del día
  const graficaRegla = useMemo(() => {
    if (!lectura || !regla) return [];
    const porDia = Object.fromEntries(regla.map((d) => [d.dia, d]));
    const out = []; let dia = null, s = 0, c = 0, sI = 0, cI = 0, tI = null;
    for (const r of lectura.filas) {
      const d = r.t.slice(0, 10);
      if (d !== dia) { dia = d; s = 0; c = 0; }
      const q = caudalRegulado(r); if (q == null) continue;
      s += q; c++;
      const t15 = r.t.slice(0, 14) + String(Math.floor(+r.t.slice(14, 16) / 15) * 15).padStart(2, "0");
      if (t15 !== tI) { if (tI) out[out.length - 1].qReg = sI / cI; tI = t15; sI = 0; cI = 0; const b = porDia[d] && porDia[d].banda; out.push({ t: t15, acumulado: null, qReg: null, min: b ? b.min : null, max: b ? b.max : null }); }
      sI += q; cI++;
      out[out.length - 1].acumulado = s / c;
      out[out.length - 1].qVert = r.qVert;
    }
    if (out.length) out[out.length - 1].qReg = sI / cI;
    return out;
  }, [lectura, regla]);
  const nivelDe = useMemo(() => (iv) => {
    if (modoNivel === "fijo") return nivelFijo;
    if (modoNivel === "columna") return iv.nivelColumna;
    if (modoNivel === "fc") return iv.nivelFC;
    return iv.nivelColumna ?? iv.nivelFC ?? nivelFijo;
  }, [modoNivel, nivelFijo]);

  // Cálculo del modelo por tandas, para no congelar la página
  useEffect(() => {
    if (!intervalos) return undefined;
    let cancelado = false;
    const cache = new Map();
    const out = [];
    (async () => {
      for (let i = 0; i < intervalos.length; i += 48) {
        if (cancelado) return;
        out.push(...caudalModeloIntervalos(intervalos.slice(i, i + 48), { nivelDe, cond: condDescarga, cache }));
        setProgreso(Math.min(1, (i + 48) / intervalos.length));
        await new Promise((r) => setTimeout(r, 0));
      }
      if (!cancelado) { setCalculo(out); setProgreso(null); }
    })();
    return () => { cancelado = true; };
  }, [intervalos, nivelDe, condDescarga]);

  const resumen = useMemo(() => (calculo ? resumenPorUnidad(calculo) : null), [calculo]);
  const totales = useMemo(() => {
    if (!calculo) return null;
    let E = 0, vH = 0, vM = 0, v2 = 0, h = 0, sinModelo = 0, vVert = 0;
    for (const iv of calculo) {
      const dt = iv.minutos / 60;
      E += iv.pTotal * dt;
      if (iv.qVert != null) vVert += iv.qVert * dt * 3600;
      if (iv.qModTotal != null && iv.qHidTotal != null) { vH += iv.qHidTotal * dt * 3600; vM += iv.qModTotal * dt * 3600; if (iv.q2Total != null) v2 += iv.q2Total * dt * 3600; h += dt; } else if (iv.pTotal > 0) sinModelo++;
    }
    return { E, vH, vM, v2, h, sinModelo, vVert, qH: h ? vH / (h * 3600) : null, qM: h ? vM / (h * 3600) : null, q2: h && v2 > 0 ? v2 / (h * 3600) : null };
  }, [calculo]);
  const grafica = useMemo(() => (calculo || []).map((iv) => ({
    t: iv.t, P: iv.pTotal, qHid: iv.qHidTotal, qMod: iv.qModTotal, q2: iv.q2Total, qVert: iv.qVert, nivel: iv.nivel,
    fcHid: iv.qHidTotal > 0 ? iv.pTotal / iv.qHidTotal : null, fcMod: iv.qModTotal > 0 ? iv.pTotal / iv.qModTotal : null,
    ...Object.fromEntries(iv.p.map((p, u) => [`U${u + 1}`, p != null && p > 0 ? p : 0])),
  })), [calculo]);
  const csv = useMemo(() => (calculo || []).map((iv) => ({
    fecha_hora: iv.t, minutos: iv.minutos, nivel_usado_msnm: iv.nivel != null ? +iv.nivel.toFixed(3) : null, unidades_en_linea: iv.n,
    q_vertedero_m3s: iv.qVert != null ? +iv.qVert.toFixed(2) : null,
    ...Object.fromEntries(iv.p.flatMap((p, u) => [[`p_u${u + 1}_mw`, p != null ? +p.toFixed(2) : null], [`q_fc_u${u + 1}_m3s`, iv.q[u] != null ? +iv.q[u].toFixed(2) : null],
      ...(MOSTRAR_WINTER_KENNEDY ? [[`q_winter_kennedy_u${u + 1}_m3s`, iv.q2 && iv.q2[u] != null ? +iv.q2[u].toFixed(2) : null]] : []), [`q_modelo_u${u + 1}_m3s`, iv.qMod[u] != null ? +iv.qMod[u].toFixed(2) : null],
      [`apertura_modelo_u${u + 1}_pct`, iv.gamma && iv.gamma[u] != null ? +pctFromDeg(iv.gamma[u]).toFixed(2) : null], [`apertura_modelo_u${u + 1}_grados`, iv.gamma && iv.gamma[u] != null ? +iv.gamma[u].toFixed(3) : null]])),
  })), [calculo]);

  const caja = { padding: "10px 12px", background: T.panelSoft, borderRadius: 8, fontSize: 12.5, fontFamily: FONT_BODY, color: T.inkMuted, lineHeight: 1.6 };
  const boton = (activo) => ({ padding: "7px 12px", borderRadius: 6, border: `1px solid ${activo ? T.teal : T.line}`, background: activo ? T.panelSoft : "transparent", color: activo ? T.teal : T.inkMuted, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" });
  const entrada = { width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 6, border: `1px solid ${T.line}`, background: T.panel, color: T.ink, fontFamily: FONT_BODY, fontSize: 13 };

  const sRegla = useMemo(() => ({ x: (graficaRegla || []).map((g) => g.t), s: [
    { nombre: "Banda mín.", datos: (graficaRegla || []).map((g) => g.min ?? null), color: T.inkFaint, dash: true, ancho: 1.2, escalones: true },
    { nombre: "Banda máx.", datos: (graficaRegla || []).map((g) => g.max ?? null), color: T.inkFaint, dash: true, ancho: 1.2, escalones: true },
    { nombre: "Caudal regulado (15 min)", datos: (graficaRegla || []).map((g) => g.qReg ?? null), indice: 1, ancho: 1.3 },
    { nombre: "Promedio acumulado del día", datos: (graficaRegla || []).map((g) => g.acumulado ?? null), indice: 0, ancho: 2.4 },
  ] }), [graficaRegla, T]);
  const sOp = useMemo(() => {
    const g = grafica || [];
    const x = g.map((r) => r.t);
    return {
      x,
      p: [{ nombre: "Total", datos: g.map((r) => r.P), color: T.ink, ancho: 2.2 }, ...["U1", "U2", "U3", "U4"].map((u, i) => ({ nombre: u, datos: g.map((r) => r[u]), indice: i, ancho: 1.3 }))],
      q: [
        { nombre: "Hidrometría", datos: g.map((r) => r.qHid), indice: 0, ancho: 1.8 },
        { nombre: "Modelo", datos: g.map((r) => r.qMod), indice: 2, ancho: 1.8 },
        ...(MOSTRAR_WINTER_KENNEDY && lectura && lectura.tieneQ2 ? [{ nombre: "Winter-Kennedy (sin calibrar)", datos: g.map((r) => r.q2), indice: 6, ancho: 1.4, dash: true }] : []),
        { nombre: "Vertedero", datos: g.map((r) => r.qVert), indice: 1, ancho: 1.2 },
      ],
      fc: [
        { nombre: "Hidrometría", datos: g.map((r) => r.fcHid), indice: 0, ancho: 1.8 },
        { nombre: "Modelo", datos: g.map((r) => r.fcMod), indice: 2, ancho: 1.8 },
        ...(MOSTRAR_WINTER_KENNEDY && lectura && lectura.tieneQ2 ? [{ nombre: "Winter-Kennedy (sin calibrar)", datos: g.map((r) => (r.q2 > 0 ? r.P / r.q2 : null)), indice: 6, ancho: 1.4, dash: true }] : []),
      ],
    };
  }, [grafica, T, lectura]);

  return (
    <div>
      <ChartHeader titulo="Operación medida (LoggerNet)" T={T}
        subtitulo="Generación por unidad (dato de cada minuto) y el caudal que reporta Hidrometría (potencia / F.C.), frente al caudal que da el modelo de la colina con la misma potencia."
        tip={`El modelo busca la apertura hasta 105,9 % = 31,98° (máximo ensayado; 100 % = 30,2°) y sin el tope de 307 MW, para no recortar la potencia medida. El caudal por unidad de LoggerNet no es una medición: es la potencia dividida entre el F.C. de Hidrometría (1,62 hasta el 29-oct-2026 14:35; desde entonces 0,0119·nivel − 3,178 entre 390 y 420 msnm y 1,80 sin nivel válido). La app calcula el caudal de Hidrometría con esa regla y el nivel del radar, como la app de Hidrometría; la columna de LoggerNet se usa solo para verificar. El modelo pasa la potencia de bornes al eje con el rendimiento del generador y busca en la colina la apertura que la entrega, con el nivel del embalse y la condición de descarga de la pestaña Descarga.`} />

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        <button style={boton(fuente === "github")} onClick={() => setFuente("github")}>Repositorio de datos (GitHub)</button>
        <button style={boton(fuente === "archivo")} onClick={() => setFuente("archivo")}>Archivo local</button>
      </div>

      {fuente === "github" ? (
        <div className="itu-grid-form" style={{ marginBottom: 12 }}>
          <div>
            <Etiqueta T={T} tip="Repositorio privado donde el relay deja un CSV por día (carpeta loggernet/AAAA/).">Repositorio</Etiqueta>
            <input value={repoTxt} onChange={(e) => setRepoTxt(e.target.value)} onBlur={() => repoTxt.trim() !== repo && setRepo(repoTxt.trim())} style={entrada} spellCheck={false} />
          </div>
          <div>
            <Etiqueta T={T} tip="Token fine-grained de GitHub con permiso Contents: Read-only, solo para el repositorio de datos. Se usa solo desde este navegador; no se envía a ningún otro sitio.">Token de solo lectura</Etiqueta>
            <input type="password" value={tokenTxt} onChange={(e) => setTokenTxt(e.target.value)} onBlur={() => tokenTxt.trim() !== token && setToken(tokenTxt)} style={entrada} autoComplete="off" placeholder="github_pat_…" />
            <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, fontSize: 12, color: T.inkMuted, fontFamily: FONT_BODY }}>
              <input type="checkbox" checked={recordar} onChange={(e) => setRecordar(e.target.checked)} /> Recordar en este equipo
            </label>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <Etiqueta T={T} tip="Días a descargar (dato de cada minuto). Se baja también el día anterior al primero, que es la base de la banda de la regla.">Fechas</Etiqueta>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <SelectorRango T={T} max={hoyTxt} valor={rango} onChange={setRango} atajos={[["1", "Hoy"], ["3", "3 días"], ["7", "7 días"], ["14", "14 días"], ["31", "31 días"]]} />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button onClick={cargarGitHub} style={{ ...boton(true), background: T.teal, color: T.onAccent, border: "none", width: "100%", padding: "9px 12px" }}>Cargar datos</button>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 12 }}>
          <Etiqueta T={T} tip={`Seleccione los dos archivos de LoggerNet: CR6Series_Ituango_Vertedero_Caudal_Vertedero.dat (generación) y CR6Series_Ituango_Vertedero_All_Data.dat (nivel del embalse), o los CSV del relay. Se procesan en este navegador y no se envían a ningún lado. Si un archivo pesa más de ${MAX_LOCAL_MB} MB se leen la cabecera y los últimos ${MAX_LOCAL_MB} MB.`}>Archivos de LoggerNet (.dat) o del relay (.csv)</Etiqueta>
          <input type="file" multiple accept=".dat,.csv,.txt" onChange={(e) => cargarArchivos(e.target.files)} style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: T.ink, maxWidth: "100%" }} />
        </div>
      )}
      {estado && <div style={{ ...caja, marginBottom: 12, color: estado.tipo === "error" ? T.red : estado.tipo === "ok" ? T.inkMuted : T.ink }}>{estado.txt}</div>}

      {lectura && (
        <>
          <div className="itu-grid-form" style={{ marginBottom: 12 }}>
            <div>
              <Etiqueta T={T} tip="Nivel del embalse para el modelo. Automático: el radar (Nivel_Radar_msnm_Avg del archivo All_Data); si falta, desde el 29-oct-2026 14:35, el nivel con el que Hidrometría calculó su F.C. (se despeja de potencia/caudal); si tampoco, el valor fijo.">Nivel del embalse</Etiqueta>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {[["auto", "Automático"], ["columna", "Radar"], ["fc", "Del F.C."], ["fijo", "Fijo"]].map(([v, l]) => (
                  <button key={v} style={boton(modoNivel === v)} onClick={() => setModoNivel(v)} disabled={v === "columna" && !lectura.columnaNivel}>{l}</button>
                ))}
              </div>
            </div>
            <div>
              <Etiqueta T={T}>Nivel fijo (msnm)</Etiqueta>
              <input type="number" step={0.01} min={NIVEL_MIN_TEC} max={NAME} value={nivelFijo} onChange={(e) => { const n = parseFloat(e.target.value); if (Number.isFinite(n)) setNivelFijo(n); }} style={entrada} />
            </div>
          </div>

          <div style={{ ...caja, marginBottom: 12 }}>
            <div><b style={{ color: T.ink }}>{lectura.origen}</b> · {lectura.filas[0].t} a {lectura.filas[lectura.filas.length - 1].t} · {lectura.formato}{lectura.columnaNivel ? " · nivel: radar" : " · sin nivel del radar"}</div>
            {lectura.avisos.length > 0 && <div style={{ color: T.amber }}>⚠ {lectura.avisos.join(" · ")}</div>}
            {verif && verif.minutos > 0 && (
              <div>
                Columna QTurbinadoUx_FC de LoggerNet frente a la regla de Hidrometría (potencia / F.C. con el nivel del radar): coincide en {fmt((verif.coinciden / verif.minutos) * 100, 1)} % de los minutos con generación
                {verif.noCoinciden > 0 && <>; no coincide en {verif.noCoinciden.toLocaleString("es-CO")}, entre {verif.primero} y {verif.ultimo}{verif.con162 === verif.noCoinciden ? ", donde todavía usaba 1,62" : verif.con162 > 0 ? ` (${verif.con162.toLocaleString("es-CO")} con 1,62)` : ""}</>}.
                {" "}La app usa siempre la regla, como la app de Hidrometría.
              </div>
            )}
            <div style={{ fontSize: 11.5, color: T.inkFaint }}>Modelo con la condición de descarga: {etiquetaCondicionDescarga(condDescarga)}. Unidad en línea: más de {P_EN_LINEA_MW} MW. Promedios de 15 minutos.</div>
          </div>

          {progreso != null && <div style={{ ...caja, marginBottom: 12 }}>Calculando el modelo… {Math.round(progreso * 100)} %</div>}

          {calculo && totales && (
            <>
              <div className="itu-kpis" style={{ marginBottom: 12 }}>
                {[
                  ["Energía", fmt(totales.E, 0), "MWh"],
                  ["Caudal medio, Hidrometría", fmt(totales.qH, 1), "m³/s"],
                  ["Caudal medio, modelo", fmt(totales.qM, 1), "m³/s"],
                  ...((MOSTRAR_WINTER_KENNEDY && lectura.tieneQ2) ? [["Caudal medio, Winter-Kennedy (sin calibrar)", fmt(totales.q2, 1), "m³/s"]] : []),
                  ["Volumen vertido", fmt(totales.vVert / 1e6, 2), "hm³"],
                  ["Hidrometría frente al modelo", totales.vM > 0 ? `${totales.vH >= totales.vM ? "+" : ""}${fmt((totales.vH / totales.vM - 1) * 100, 1)}` : "—", "%"],
                ].map(([l, v, u]) => (
                  <div key={l} style={{ padding: "10px 12px", border: `1px solid ${T.line}`, borderRadius: 8 }}>
                    <div style={{ fontSize: 11.5, color: T.inkMuted, fontFamily: FONT_BODY }}>{l}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: T.teal, fontFamily: FONT_BODY }}>{v}<span style={{ fontSize: 12, color: T.inkFaint, fontWeight: 500 }}> {u}</span></div>
                  </div>
                ))}
              </div>
              {totales.sinModelo > 0 && <div style={{ ...caja, color: T.amber, marginBottom: 12 }}>⚠ {totales.sinModelo} intervalos con generación sin caudal del modelo (sin nivel, o potencia fuera de lo alcanzable con la colina); no entran en los promedios.</div>}

              {regla && regla.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <ChartHeader titulo="Regla operativa (Res. 1891)" T={T}
                    subtitulo="Caudal regulado = potencia / F.C. (descarga intermedia = 0). Banda del día = promedio de ayer ± 4,70 %. Cumple si el promedio final del día queda dentro; con vertimiento se suspende la validación."
                    accion={<BotonCSV data={regla.map((d) => ({ dia: d.dia, q_regulado_promedio_m3s: d.qPromedio != null ? +d.qPromedio.toFixed(2) : null, minutos: d.minutos, banda_min_m3s: d.banda ? +d.banda.min.toFixed(2) : null, banda_max_m3s: d.banda ? +d.banda.max.toFixed(2) : null, vertimiento: d.conVertimiento, estado: ETIQUETA_ESTADO_REGLA[d.estado] }))} filename="regla_operativa_diaria.csv" T={T} />} />
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, fontFamily: FONT_BODY, color: T.ink }}>
                      <thead><tr style={{ color: T.inkFaint }}>
                        {["Día", "Q regulado promedio (m³/s)", "Banda (m³/s)", "Estado", ""].map((h, k) => <th key={k} style={{ padding: "5px 8px", borderBottom: `1px solid ${T.line}`, textAlign: k === 0 || k === 3 ? "left" : "right", fontWeight: 600 }}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {regla.map((d) => (
                          <tr key={d.dia}>
                            <td style={{ padding: "5px 8px" }}>{d.dia}</td>
                            <td style={{ padding: "5px 8px", textAlign: "right" }}>{fmt(d.qPromedio, 1)}</td>
                            <td style={{ padding: "5px 8px", textAlign: "right", color: T.inkMuted }}>{d.banda ? `${fmt(d.banda.min, 1)} a ${fmt(d.banda.max, 1)}` : "sin día anterior"}</td>
                            <td style={{ padding: "5px 8px", fontWeight: 700, color: { cumple: T.teal, por_encima: T.red, por_debajo: T.red, excepcion: T.amber, sin_base: T.inkMuted }[d.estado] }}>{ETIQUETA_ESTADO_REGLA[d.estado]}</td>
                            <td style={{ padding: "5px 8px", color: T.inkMuted, fontSize: 11.5 }}>{d.parcial ? `parcial: ${d.minutos.toLocaleString("es-CO")} de 1.440 min` : ""}{d.conVertimiento ? `${d.parcial ? " · " : ""}vertimiento hasta ${fmt(d.qVertMax, 0)} m³/s` : ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <GraficoSeries T={T} x={sRegla.x} series={sRegla.s} unidad="m³/s" ejeY="m³/s" grupo="om" nombreArchivo="regla_15min" bandas={[{ desde: 0, hasta: 1, relleno: "rgba(12,163,12,0.08)" }]} />
                </div>
              )}

              <ChartHeader titulo="Potencia en bornes" T={T} accion={<BotonCSV data={csv} filename="operacion_medida_15min.csv" T={T} />} />
              <GraficoSeries T={T} x={sOp.x} series={sOp.p} unidad="MW" ejeY="MW" grupo="om" alto={240} nombreArchivo="potencia_15min" incluirCero />

              <ChartHeader titulo="Caudal turbinado total" subtitulo="Hidrometría (potencia / F.C. con el nivel del radar, como su app) frente al modelo de la colina con la misma potencia y al Winter-Kennedy (sin calibrar, relativo); también el vertedero." T={T} />
              <GraficoSeries T={T} x={sOp.x} series={sOp.q} unidad="m³/s" ejeY="m³/s" grupo="om" alto={240} nombreArchivo="caudal_15min" />

              <ChartHeader titulo="Factor de conversión (MW por m³/s)" subtitulo="Potencia total / caudal total de Hidrometría, del modelo y del Winter-Kennedy." T={T} />
              <GraficoSeries T={T} x={sOp.x} series={sOp.fc} unidad="MW/(m³/s)" ejeY="MW por m³/s" decimales={3} grupo="om" alto={220} nombreArchivo="fc_15min" verticales={[{ x: FC_HIDROMETRIA_POR_NIVEL.desde, rotulo: "F.C. por nivel" }]} />

              <ChartHeader titulo="Apertura del distribuidor por unidad" subtitulo="Promedio de cada intervalo de 15 min, en % y su equivalente en grados (eje derecho y tooltip): la apertura que da el modelo de la colina para la potencia medida de cada unidad, con la condición de descarga elegida arriba." T={T} />
              <GraficoApertura T={T} x={sOp.x} filas={(calculo || []).map((iv) => iv.gamma || null)} nU={4} pasoH={(calculo || []).map((iv) => (iv.minutos || 15) / 60)} grupo="om" nombreArchivo="apertura_15min" />

              <div className="itu-tabla" style={{ marginTop: 12 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, fontFamily: FONT_BODY, color: T.ink }}>
                  <thead><tr style={{ color: T.inkFaint, textAlign: "right" }}>
                    {["Unidad", "Horas en línea", "Energía (MWh)", "Volumen modelo (hm³)", "Volumen Hidrometría (hm³)", "Hidrometría vs modelo", ...((MOSTRAR_WINTER_KENNEDY && lectura.tieneQ2) ? ["Volumen Winter-Kennedy, sin calibrar (hm³)", "Winter-Kennedy vs modelo (relativo)"] : [])].map((h, i) => <th key={h} style={{ padding: "5px 8px", borderBottom: `1px solid ${T.line}`, textAlign: i ? "right" : "left", fontWeight: 600 }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {resumen.map((r) => (
                      <tr key={r.unidad}>
                        <td style={{ padding: "5px 8px" }}>U{r.unidad}</td>
                        <td style={{ padding: "5px 8px", textAlign: "right" }}>{fmt(r.horasEnLinea, 1)}</td>
                        <td style={{ padding: "5px 8px", textAlign: "right" }}>{fmt(r.energiaMWh, 0)}</td>
                        <td style={{ padding: "5px 8px", textAlign: "right" }}>{fmt(r.volModHm3, 3)}</td>
                        <td style={{ padding: "5px 8px", textAlign: "right" }}>{fmt(r.volHidHm3, 3)}</td>
                        <td style={{ padding: "5px 8px", textAlign: "right" }}>{r.difPct != null ? `${r.difPct >= 0 ? "+" : ""}${fmt(r.difPct, 1)} %` : "—"}</td>
                        {(MOSTRAR_WINTER_KENNEDY && lectura.tieneQ2) && <td style={{ padding: "5px 8px", textAlign: "right" }}>{fmt(r.volQ2Hm3, 3)}</td>}
                        {(MOSTRAR_WINTER_KENNEDY && lectura.tieneQ2) && <td style={{ padding: "5px 8px", textAlign: "right" }}>{r.difQ2Pct != null ? `${r.difQ2Pct >= 0 ? "+" : ""}${fmt(r.difQ2Pct, 1)} %` : "—"}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ fontSize: 11.5, color: T.inkFaint, fontFamily: FONT_BODY, marginTop: 6 }}>Volúmenes en las horas en que hay caudal de Hidrometría y del modelo. Diferencia positiva: esa fuente reporta más agua que el modelo.</div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
