/* ============================================================
   Fuentes de datos de la app, compartidas por todos los módulos:
   - Repositorio privado de datos (GitHub): CSV del relay de LoggerNet
     (día en curso) y el histórico que arma el proceso automático
     (derivados/). Requiere un token de solo lectura, que se guarda
     solo en este navegador si el usuario lo pide.
   - HydroForecast Ituango (Space público): pronóstico, observado y
     aguas arriba. Si no responde, se usa el archivo del repositorio.
   Las respuestas se guardan en memoria con su ETag: una consulta que
   no cambió responde 304 y no gasta cupo de la API de GitHub.
   ============================================================ */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ahoraColombia, hoyColombia, sumarDias } from "./tiempo.js";

const REPO_DATOS_DEFECTO = "astrococo/ituango-turbinas-datos";
const CLAVE_TOKEN = "ituango-turbinas-token";
const CLAVE_REPO = "ituango-turbinas-repo";
const API_HF = "https://jdguarnizor-hydroforecast-ituango.hf.space";
const leerLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const escribirLocal = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

const cache = new Map(); // url → { etag, cuerpo }
class ErrorDatos extends Error { constructor(msg, codigo) { super(msg); this.codigo = codigo; } }

async function pedirGitHub(repo, token, ruta, { raw = true } = {}) {
  const url = `https://api.github.com/repos/${repo}/contents/${ruta}`;
  const h = { Authorization: `Bearer ${token}`, Accept: raw ? "application/vnd.github.raw" : "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const previo = cache.get(url);
  if (previo && previo.etag) h["If-None-Match"] = previo.etag;
  let r;
  try { r = await fetch(url, { headers: h, cache: "no-store" }); }
  catch { throw new ErrorDatos("No hay conexión con GitHub.", "red"); }
  if (r.status === 304 && previo) return previo.cuerpo;
  if (r.status === 401) throw new ErrorDatos("El token no es válido o venció (401).", 401);
  if (r.status === 404) throw new ErrorDatos(`No existe ${ruta} (o el token no ve el repositorio).`, 404);
  if (r.status === 403) throw new ErrorDatos("GitHub limitó las consultas por un rato (403). Intente en unos minutos.", 403);
  if (!r.ok) throw new ErrorDatos(`GitHub respondió ${r.status}.`, r.status);
  const cuerpo = raw ? await r.text() : await r.json();
  const etag = r.headers.get("ETag");
  if (etag) cache.set(url, { etag, cuerpo });
  return cuerpo;
}
async function pedirHF(ruta, ms = 15000) {
  const c = new AbortController(); const to = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(API_HF + ruta, { signal: c.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(to); }
}

const Contexto = createContext(null);

/* Proveedor: guarda el token y el repositorio y expone funciones de lectura. */
function ProveedorDatos({ children }) {
  const [repo, setRepo] = useState(() => leerLocal(CLAVE_REPO) || REPO_DATOS_DEFECTO);
  const [token, setTokenEstado] = useState(() => leerLocal(CLAVE_TOKEN) || "");
  const [recordar, setRecordar] = useState(() => !!leerLocal(CLAVE_TOKEN));
  const [verificado, setVerificado] = useState(null); // null | {ok, txt}
  useEffect(() => { escribirLocal(CLAVE_REPO, repo === REPO_DATOS_DEFECTO ? null : repo); }, [repo]);
  useEffect(() => { escribirLocal(CLAVE_TOKEN, recordar && token ? token : null); }, [recordar, token]);
  const setToken = useCallback((t) => { setTokenEstado(t.trim()); setVerificado(null); }, []);

  const leerTexto = useCallback((ruta) => {
    if (!token) return Promise.reject(new ErrorDatos("Falta el token de lectura del repositorio de datos.", "token"));
    return pedirGitHub(repo, token, ruta, { raw: true });
  }, [repo, token]);
  const leerJSON = useCallback(async (ruta) => JSON.parse(await leerTexto(ruta)), [leerTexto]);
  const listar = useCallback((ruta) => pedirGitHub(repo, token, ruta, { raw: false }), [repo, token]);
  // Envía un evento repository_dispatch al repositorio de datos (requiere token con Contents: Read and write)
  const despachar = useCallback(async (evento, carga) => {
    if (!token) throw new ErrorDatos("Falta el token del repositorio de datos.", "token");
    let r;
    try {
      r = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
        body: JSON.stringify({ event_type: evento, client_payload: carga }),
      });
    } catch { throw new ErrorDatos("No hay conexión con GitHub.", "red"); }
    if (r.status === 204) return true;
    if (r.status === 401) throw new ErrorDatos("El token no es válido o venció (401).", 401);
    if (r.status === 403 || r.status === 404) throw new ErrorDatos("El token no tiene permiso de escritura en el repositorio de datos: en GitHub, edite el token y dé «Contents: Read and write».", r.status);
    const cuerpo = await r.json().catch(() => null);
    throw new ErrorDatos(`GitHub respondió ${r.status}${cuerpo && cuerpo.message ? `: ${cuerpo.message}` : ""}.`, r.status);
  }, [repo, token]);
  // Lee un archivo de otra rama sin caché; null si todavía no existe
  const leerRama = useCallback(async (ruta, rama) => {
    const r = await fetch(`https://api.github.com/repos/${repo}/contents/${ruta}?ref=${encodeURIComponent(rama)}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.raw", "X-GitHub-Api-Version": "2022-11-28" }, cache: "no-store" });
    if (r.status === 404) return null;
    if (!r.ok) throw new ErrorDatos(`GitHub respondió ${r.status}.`, r.status);
    return r.text();
  }, [repo, token]);
  const verificar = useCallback(async () => {
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
      if (r.status === 401) throw new Error("El token no es válido o venció.");
      if (r.status === 404) throw new Error(`El token no tiene acceso a ${repo}.`);
      if (!r.ok) throw new Error(`GitHub respondió ${r.status}.`);
      setVerificado({ ok: true, txt: "Conectado al repositorio de datos." });
      return true;
    } catch (e) { setVerificado({ ok: false, txt: e.message }); return false; }
  }, [repo, token]);

  /* HydroForecast: primero el Space; si falla, el archivo del repositorio. */
  const leerHF = useCallback(async (rutaApi, archivo) => {
    try { return { datos: await pedirHF(rutaApi), origen: "HydroForecast (en vivo)" }; }
    catch (e) {
      if (token && archivo) {
        try { return { datos: await (async () => JSON.parse(await pedirGitHub(repo, token, `hf/${archivo}`)))(), origen: "Archivo del repositorio (HydroForecast)" }; }
        catch { /* sigue */ }
      }
      throw new ErrorDatos(`HydroForecast no respondió (${e.name === "AbortError" ? "tiempo agotado" : e.message}).`, "hf");
    }
  }, [repo, token]);

  const valor = useMemo(() => ({ repo, setRepo, token, setToken, recordar, setRecordar, conectado: !!token, verificado, verificar, leerTexto, leerJSON, listar, leerHF, despachar, leerRama }),
    [repo, token, recordar, verificado, verificar, leerTexto, leerJSON, listar, leerHF, despachar, leerRama, setToken]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}
const useDatos = () => useContext(Contexto);

/* Carga periódica: llama a `cargar` al montar, cada `cadaMs` (solo con la
   pestaña visible) y al volver a la pestaña. Mantiene el último resultado
   mientras recarga. */
function useCargaPeriodica(cargar, deps, cadaMs = 5 * 60e3) {
  const [estado, setEstado] = useState({ datos: null, error: null, cargando: false, cuando: null });
  const ultimaId = useRef(0);
  const correr = useCallback(async () => {
    // Cada corrida tiene su número: si llega tarde una anterior (otro token,
    // otro repositorio), se descarta.
    const id = ++ultimaId.current;
    setEstado((e) => ({ ...e, cargando: true }));
    try {
      const datos = await cargar();
      if (id === ultimaId.current) setEstado({ datos, error: null, cargando: false, cuando: new Date() });
    } catch (e) {
      if (id === ultimaId.current) setEstado((prev) => ({ ...prev, error: e, cargando: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    correr();
    const id = cadaMs ? setInterval(() => { if (document.visibilityState === "visible") correr(); }, cadaMs) : null;
    const alVolver = () => { if (cadaMs && document.visibilityState === "visible") correr(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => { ultimaId.current++; if (id) clearInterval(id); document.removeEventListener("visibilitychange", alVolver); };
  }, [correr, cadaMs]);
  return useMemo(() => ({ ...estado, recargar: correr }), [estado, correr]);
}

export { ProveedorDatos, useDatos, useCargaPeriodica, ErrorDatos, ahoraColombia, hoyColombia, sumarDias, REPO_DATOS_DEFECTO, API_HF };
