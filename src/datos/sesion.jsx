/* ============================================================
   Sesión de usuario (Supabase Auth): ingreso con correo y contraseña,
   registro restringido a los dominios de la organización y aprobación
   del administrador. El perfil (rol y estado) vive en la tabla
   «perfiles»; los datos de operación se piden a las funciones del
   servidor con el token de la sesión (src/datos/fuentes.jsx).
   ============================================================ */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_CLAVE_PUBLICA, DOMINIOS_PERMITIDOS } from "./config.js";

const ACTIVO = !!(SUPABASE_URL && SUPABASE_CLAVE_PUBLICA);
let cliente = null;
const sb = () => {
  if (!cliente && ACTIVO) cliente = createClient(SUPABASE_URL, SUPABASE_CLAVE_PUBLICA, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "ituango-sesion" } });
  return cliente;
};
const redireccion = () => (typeof location !== "undefined" ? `${location.origin}${location.pathname}` : undefined);
const dominioOk = (correo) => DOMINIOS_PERMITIDOS.includes(String(correo).trim().toLowerCase().split("@")[1] || "");

/* Mensajes de Supabase Auth en español */
function traducir(e) {
  const m = String((e && (e.message || e.error_description)) || e || "");
  if (/invalid login credentials/i.test(m)) return "Correo o contraseña incorrectos.";
  if (/email not confirmed/i.test(m)) return "Falta confirmar el correo: revise su bandeja de entrada.";
  if (/already registered|already been registered|user already exists/i.test(m)) return "Ese correo ya tiene una cuenta. Ingrese o use «Olvidé mi contraseña».";
  if (/database error saving new user|organizaci/i.test(m)) return `Solo se permiten correos de ${DOMINIOS_PERMITIDOS.map((d) => "@" + d).join(", ")}.`;
  if (/password should be at least|weak password|at least \d+ characters/i.test(m)) return "La contraseña debe tener al menos 10 caracteres.";
  if (/rate limit|too many/i.test(m)) return "Demasiados intentos. Espere unos minutos.";
  if (/email address not authorized|error sending/i.test(m)) return "El servidor no pudo enviar el correo (falta configurar el correo propio). Pida ayuda al administrador.";
  if (/failed to fetch|network/i.test(m)) return "No hay conexión con el servidor.";
  return m || "Ocurrió un error.";
}

const Contexto = createContext(null);

function ProveedorSesion({ children }) {
  const [sesion, setSesion] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [cargando, setCargando] = useState(ACTIVO);
  const [recuperando, setRecuperando] = useState(false); // llegó con el enlace de «Olvidé mi contraseña»
  const tokenRef = useRef(null);

  const cargarPerfil = useCallback(async (s) => {
    if (!s) { setPerfil(null); return; }
    const { data } = await sb().from("perfiles").select("id,email,nombre,rol,estado").eq("id", s.user.id).maybeSingle();
    setPerfil(data || { id: s.user.id, email: s.user.email, rol: "usuario", estado: "pendiente" });
  }, []);

  useEffect(() => {
    if (!ACTIVO) return undefined;
    let vivo = true;
    sb().auth.getSession().then(async ({ data }) => {
      if (!vivo) return;
      setSesion(data.session); tokenRef.current = data.session ? data.session.access_token : null;
      await cargarPerfil(data.session); if (vivo) setCargando(false);
    });
    const { data: sub } = sb().auth.onAuthStateChange((evento, s) => {
      setSesion(s); tokenRef.current = s ? s.access_token : null;
      if (evento === "PASSWORD_RECOVERY") setRecuperando(true);
      if (evento === "SIGNED_IN" || evento === "SIGNED_OUT" || evento === "USER_UPDATED") cargarPerfil(s);
    });
    return () => { vivo = false; sub.subscription.unsubscribe(); };
  }, [cargarPerfil]);

  const ingresar = useCallback(async (correo, clave) => {
    const { error } = await sb().auth.signInWithPassword({ email: correo.trim().toLowerCase(), password: clave });
    if (error) throw new Error(traducir(error));
  }, []);
  const registrarse = useCallback(async (nombre, correo, clave) => {
    if (!dominioOk(correo)) throw new Error(`Solo se permiten correos de ${DOMINIOS_PERMITIDOS.map((d) => "@" + d).join(", ")}.`);
    if (clave.length < 10) throw new Error("La contraseña debe tener al menos 10 caracteres.");
    const { data, error } = await sb().auth.signUp({ email: correo.trim().toLowerCase(), password: clave, options: { data: { nombre: nombre.trim() }, emailRedirectTo: redireccion() } });
    if (error) throw new Error(traducir(error));
    return { confirmarCorreo: !data.session };
  }, []);
  const recuperar = useCallback(async (correo) => {
    const { error } = await sb().auth.resetPasswordForEmail(correo.trim().toLowerCase(), { redirectTo: redireccion() });
    if (error) throw new Error(traducir(error));
  }, []);
  const cambiarClave = useCallback(async (nueva) => {
    if (nueva.length < 10) throw new Error("La contraseña debe tener al menos 10 caracteres.");
    const { error } = await sb().auth.updateUser({ password: nueva });
    if (error) throw new Error(traducir(error));
    setRecuperando(false);
  }, []);
  const salir = useCallback(async () => { await sb().auth.signOut(); setPerfil(null); }, []);
  const recargarPerfil = useCallback(() => cargarPerfil(sesion), [cargarPerfil, sesion]);

  /* Llama a una función del servidor con el token de la sesión. */
  const llamar = useCallback(async (nombre, { metodo = "GET", query = "", cuerpo, cabeceras = {}, senal } = {}) => {
    const token = tokenRef.current;
    if (!token) throw Object.assign(new Error("Inicie sesión."), { codigo: 401 });
    let r;
    try {
      r = await fetch(`${SUPABASE_URL}/functions/v1/${nombre}${query}`, {
        method: metodo, cache: "no-store", signal: senal,
        headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_CLAVE_PUBLICA, ...(cuerpo !== undefined ? { "Content-Type": "application/json" } : {}), ...cabeceras },
        body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
      });
    } catch (e) { if (e && e.name === "AbortError") throw e; throw Object.assign(new Error("No hay conexión con el servidor."), { codigo: "red" }); }
    return r;
  }, []);

  const valor = useMemo(() => ({
    activo: ACTIVO, cargando, sesion, perfil, recuperando,
    email: sesion ? sesion.user.email : null,
    aprobado: !!(perfil && perfil.estado === "aprobado"),
    admin: !!(perfil && perfil.estado === "aprobado" && perfil.rol === "admin"),
    ingresar, registrarse, recuperar, cambiarClave, salir, llamar, recargarPerfil, dominios: DOMINIOS_PERMITIDOS,
  }), [cargando, sesion, perfil, recuperando, ingresar, registrarse, recuperar, cambiarClave, salir, llamar, recargarPerfil]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}
const useSesion = () => useContext(Contexto) || { activo: false };

export { ProveedorSesion, useSesion, traducir, dominioOk };
