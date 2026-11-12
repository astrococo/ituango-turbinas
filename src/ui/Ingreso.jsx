/* Pantallas de acceso: ingreso, registro (solo correos de la organización),
   recuperación de contraseña, cuenta pendiente/revocada y cambio de
   contraseña. Se muestran antes de la app cuando la seguridad está activa. */
import { useState } from "react";
import { useSesion } from "../datos/sesion.jsx";
import { FONT_BODY } from "./base.jsx";

const CLAVE_TECNICO = "ituango-acceso-tecnico";
const leerLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const escribirLocal = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
/* Acceso técnico (token de GitHub, como antes): solo para el administrador si el servidor falla. */
const accesoTecnico = () => leerLocal(CLAVE_TECNICO) === "1" && !!leerLocal("ituango-turbinas-token");

function Marco({ T, titulo, sub, children }) {
  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.ink, fontFamily: FONT_BODY, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px", boxSizing: "border-box" }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <svg width="38" height="38" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="9" fill={T.teal} />
            <circle cx="16" cy="16" r="9" fill="none" stroke={T.onAccent} strokeWidth="2.2" />
            <path d="M16 7c3 3 3 6 0 9M25 16c-3 3-6 3-9 0M16 25c-3-3-3-6 0-9M7 16c3-3 6-3 9 0" fill="none" stroke={T.onAccent} strokeWidth="2" strokeLinecap="round" />
          </svg>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>Turbinas Ituango</div>
            <div style={{ fontSize: 12, color: T.inkMuted }}>Acceso para personal de la organización</div>
          </div>
        </div>
        <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 14, padding: "20px 20px 18px", boxShadow: T.cardShadow }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 17 }}>{titulo}</h2>
          {sub && <p style={{ margin: "0 0 14px", fontSize: 12.5, color: T.inkMuted, lineHeight: 1.5 }}>{sub}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

function useEstilos(T) {
  return {
    campo: { display: "block", fontSize: 12.5, color: T.inkMuted, marginBottom: 10 },
    input: { width: "100%", marginTop: 4, padding: "9px 11px", fontSize: 14, background: T.panelSoft, border: `1px solid ${T.line}`, borderRadius: 8, color: T.ink, fontFamily: FONT_BODY, boxSizing: "border-box" },
    boton: (on = true) => ({ width: "100%", padding: "10px 14px", marginTop: 4, background: on ? T.teal : T.disabledBg, color: on ? T.onAccent : T.inkFaint, border: "none", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: on ? "pointer" : "default" }),
    enlace: { background: "none", border: "none", padding: 0, color: T.teal, fontSize: 12.5, cursor: "pointer", textDecoration: "underline" },
  };
}

function Mensaje({ T, tipo, children }) {
  if (!children) return null;
  const c = tipo === "error" ? "#d03b3b" : tipo === "ok" ? "#0ca30c" : T.amber;
  return <div role={tipo === "error" ? "alert" : "status"} style={{ margin: "10px 0 0", padding: "8px 10px", borderRadius: 8, border: `1px solid ${c}`, color: T.ink, fontSize: 12.5, lineHeight: 1.45 }}>{children}</div>;
}

function PantallaIngreso({ T }) {
  const s = useSesion();
  const e = useEstilos(T);
  const [modo, setModo] = useState("ingresar"); // ingresar | registrar | recuperar
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [clave, setClave] = useState("");
  const [clave2, setClave2] = useState("");
  const [ver, setVer] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState(null); // {tipo, txt}
  const dominios = s.dominios.map((d) => "@" + d).join(", ");

  async function enviar(ev) {
    ev.preventDefault(); if (ocupado) return;
    setMsg(null); setOcupado(true);
    try {
      if (modo === "ingresar") await s.ingresar(correo, clave);
      else if (modo === "registrar") {
        if (clave !== clave2) throw new Error("Las contraseñas no coinciden.");
        const r = await s.registrarse(nombre, correo, clave);
        if (r.confirmarCorreo) { setMsg({ tipo: "ok", txt: "Cuenta creada. Le enviamos un correo para confirmar la dirección; después, el administrador aprueba el acceso." }); setModo("ingresar"); setClave(""); setClave2(""); }
      } else {
        await s.recuperar(correo);
        setMsg({ tipo: "ok", txt: "Si el correo tiene cuenta, le llegará un enlace para crear una contraseña nueva." });
      }
    } catch (x) { setMsg({ tipo: "error", txt: x.message }); }
    finally { setOcupado(false); }
  }
  const cambiar = (m) => { setModo(m); setMsg(null); };
  const titulo = { ingresar: "Ingresar", registrar: "Crear cuenta", recuperar: "Recuperar contraseña" }[modo];
  const sub = { ingresar: null, registrar: `Solo correos ${dominios}. El administrador aprueba cada cuenta antes de dar acceso a los datos.`, recuperar: "Escriba su correo y le enviaremos un enlace para crear una contraseña nueva." }[modo];
  return (
    <Marco T={T} titulo={titulo} sub={sub}>
      <form onSubmit={enviar} noValidate>
        {modo === "registrar" && (
          <label style={e.campo}>Nombre
            <input value={nombre} onChange={(x) => setNombre(x.target.value)} autoComplete="name" required style={e.input} />
          </label>
        )}
        <label style={e.campo}>Correo de la organización
          <input type="email" value={correo} onChange={(x) => setCorreo(x.target.value)} autoComplete="username" placeholder={`nombre${dominios.split(",")[0]}`} required style={e.input} />
        </label>
        {modo !== "recuperar" && (
          <label style={e.campo}>Contraseña{modo === "registrar" ? " (mínimo 10 caracteres)" : ""}
            <div style={{ position: "relative" }}>
              <input type={ver ? "text" : "password"} value={clave} onChange={(x) => setClave(x.target.value)} autoComplete={modo === "registrar" ? "new-password" : "current-password"} required minLength={modo === "registrar" ? 10 : undefined} style={{ ...e.input, paddingRight: 56 }} />
              <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? "Ocultar contraseña" : "Ver contraseña"} style={{ position: "absolute", right: 6, top: 9, background: "none", border: "none", color: T.inkMuted, fontSize: 12, cursor: "pointer", padding: "4px 6px" }}>{ver ? "Ocultar" : "Ver"}</button>
            </div>
          </label>
        )}
        {modo === "registrar" && (
          <label style={e.campo}>Repita la contraseña
            <input type={ver ? "text" : "password"} value={clave2} onChange={(x) => setClave2(x.target.value)} autoComplete="new-password" required style={e.input} />
          </label>
        )}
        <button type="submit" disabled={ocupado} style={e.boton(!ocupado)}>{ocupado ? "Un momento…" : titulo}</button>
      </form>
      <Mensaje T={T} tipo={msg && msg.tipo}>{msg && msg.txt}</Mensaje>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
        {modo === "ingresar" ? (
          <>
            <button type="button" style={e.enlace} onClick={() => cambiar("registrar")}>Crear cuenta</button>
            <button type="button" style={e.enlace} onClick={() => cambiar("recuperar")}>Olvidé mi contraseña</button>
          </>
        ) : <button type="button" style={e.enlace} onClick={() => cambiar("ingresar")}>Volver a ingresar</button>}
      </div>
      {modo === "ingresar" && leerLocal("ituango-turbinas-token") && (
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${T.lineSoft}`, fontSize: 12, color: T.inkFaint, lineHeight: 1.5 }}>
          Este equipo tiene guardado un token técnico de GitHub. <button type="button" style={{ ...e.enlace, fontSize: 12 }} onClick={() => { escribirLocal(CLAVE_TECNICO, "1"); location.reload(); }}>Entrar con el token</button>
        </div>
      )}
    </Marco>
  );
}

function PantallaEstado({ T }) {
  const s = useSesion();
  const e = useEstilos(T);
  const [revisando, setRevisando] = useState(false);
  const revocado = s.perfil && s.perfil.estado === "revocado";
  return (
    <Marco T={T} titulo={revocado ? "Acceso retirado" : "Cuenta en revisión"}
      sub={revocado ? "El administrador retiró el acceso de esta cuenta. Si cree que es un error, comuníquese con él." : "Su cuenta está creada. El administrador debe aprobarla antes de que pueda ver los datos de operación; vuelva a intentar más tarde."}>
      <div style={{ fontSize: 12.5, color: T.inkMuted, marginBottom: 12 }}>Cuenta: <b style={{ color: T.ink }}>{s.email}</b></div>
      {!revocado && <button style={e.boton(!revisando)} disabled={revisando} onClick={async () => { setRevisando(true); await s.recargarPerfil(); setRevisando(false); }}>{revisando ? "Revisando…" : "Ya me aprobaron: revisar"}</button>}
      <div style={{ marginTop: 12 }}><button style={e.enlace} onClick={() => s.salir()}>Salir</button></div>
    </Marco>
  );
}

function PantallaNuevaClave({ T, alTerminar }) {
  const s = useSesion();
  const e = useEstilos(T);
  const [clave, setClave] = useState("");
  const [clave2, setClave2] = useState("");
  const [msg, setMsg] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  async function enviar(ev) {
    ev.preventDefault(); setMsg(null);
    if (clave !== clave2) { setMsg({ tipo: "error", txt: "Las contraseñas no coinciden." }); return; }
    setOcupado(true);
    try { await s.cambiarClave(clave); setMsg({ tipo: "ok", txt: "Contraseña actualizada." }); if (alTerminar) setTimeout(alTerminar, 900); }
    catch (x) { setMsg({ tipo: "error", txt: x.message }); }
    finally { setOcupado(false); }
  }
  return (
    <Marco T={T} titulo="Contraseña nueva" sub="Mínimo 10 caracteres. Úsela la próxima vez que ingrese.">
      <form onSubmit={enviar}>
        <label style={e.campo}>Contraseña nueva<input type="password" value={clave} onChange={(x) => setClave(x.target.value)} autoComplete="new-password" style={e.input} /></label>
        <label style={e.campo}>Repita la contraseña<input type="password" value={clave2} onChange={(x) => setClave2(x.target.value)} autoComplete="new-password" style={e.input} /></label>
        <button type="submit" disabled={ocupado} style={e.boton(!ocupado)}>{ocupado ? "Guardando…" : "Guardar"}</button>
      </form>
      <Mensaje T={T} tipo={msg && msg.tipo}>{msg && msg.txt}</Mensaje>
      {alTerminar && <div style={{ marginTop: 12 }}><button style={e.enlace} onClick={alTerminar}>Cancelar</button></div>}
    </Marco>
  );
}

function Cargando({ T }) {
  return <div style={{ minHeight: "100vh", background: T.bg, color: T.inkFaint, fontFamily: FONT_BODY, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>Verificando la sesión…</div>;
}

/* Decide qué mostrar antes de la app. null = pasar a la app. */
function pantallaDeAcceso(s, T) {
  if (!s.activo || accesoTecnico()) return null;
  if (s.cargando) return <Cargando T={T} />;
  if (s.recuperando) return <PantallaNuevaClave T={T} />;
  if (!s.sesion) return <PantallaIngreso T={T} />;
  if (!s.perfil) return <Cargando T={T} />;
  if (!s.aprobado) return <PantallaEstado T={T} />;
  return null;
}

/* Menú del usuario en el encabezado. */
function MenuUsuario({ T, onCambiarClave }) {
  const s = useSesion();
  const [abierto, setAbierto] = useState(false);
  if (!s.activo || !s.sesion) return null;
  const inicial = (s.perfil && s.perfil.nombre ? s.perfil.nombre : s.email || "?").trim().charAt(0).toUpperCase();
  const item = { display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", color: T.ink, fontSize: 13, cursor: "pointer", textDecoration: "none", boxSizing: "border-box" };
  return (
    <div style={{ position: "relative" }}>
      <button className="itu-pill" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} aria-haspopup="menu" title={s.email} style={{ padding: "3px 10px 3px 3px" }}>
        <span style={{ width: 22, height: 22, borderRadius: "50%", background: T.teal, color: T.onAccent, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12 }}>{inicial}</span>
        <span className="lbl">{s.admin ? "Admin" : "Cuenta"}</span>
      </button>
      {abierto && (
        <>
          <div onClick={() => setAbierto(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 41, minWidth: 220, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 10, boxShadow: T.cardShadow, padding: "6px 0" }}>
            <div style={{ padding: "6px 12px 8px", borderBottom: `1px solid ${T.lineSoft}`, fontSize: 12, color: T.inkMuted, wordBreak: "break-all" }}>{s.perfil && s.perfil.nombre ? <b style={{ color: T.ink, display: "block" }}>{s.perfil.nombre}</b> : null}{s.email}</div>
            {s.admin && <a role="menuitem" href="#usuarios" style={item} onClick={() => setAbierto(false)}>Usuarios y accesos</a>}
            <button role="menuitem" style={item} onClick={() => { setAbierto(false); onCambiarClave(); }}>Cambiar contraseña</button>
            <button role="menuitem" style={item} onClick={() => { setAbierto(false); s.salir(); }}>Salir</button>
          </div>
        </>
      )}
    </div>
  );
}

export { PantallaIngreso, PantallaEstado, PantallaNuevaClave, pantallaDeAcceso, MenuUsuario, accesoTecnico, CLAVE_TECNICO, escribirLocal };
