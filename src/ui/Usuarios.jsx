/* Administración de usuarios (solo el administrador): aprobar o retirar
   cuentas, cambiar el rol, dar una contraseña temporal, eliminar, y ver
   los últimos accesos. Todo pasa por la función «admin» del servidor. */
import { useCallback, useEffect, useState } from "react";
import { useSesion } from "../datos/sesion.jsx";
import { Tarjeta } from "./comunes.jsx";
import { Estado } from "./graficos.jsx";

const fecha = (iso) => (iso ? new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" }) : "—");
const ACCION = { registro: "Se registró", ingreso: "Ingresó", pregunta: "Preguntó al asistente", "admin:aprobar": "Aprobó", "admin:revocar": "Retiró el acceso", "admin:rol": "Cambió el rol", "admin:clave": "Dio clave temporal", "admin:eliminar": "Eliminó" };
const ESTADO_TIPO = { aprobado: "bien", pendiente: "aviso", revocado: "critico" };

export default function Usuarios({ T }) {
  const s = useSesion();
  const [datos, setDatos] = useState(null);
  const [msg, setMsg] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const [filtro, setFiltro] = useState("todos");

  const pedir = useCallback(async (cuerpo) => {
    const r = await s.llamar("admin", { metodo: "POST", cuerpo });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.error) throw new Error((j && j.error) || `El servidor respondió ${r.status}.`);
    return j;
  }, [s]);
  const cargar = useCallback(async () => {
    try { setDatos(await pedir({ accion: "listar" })); } catch (e) { setMsg({ tipo: "critico", txt: e.message }); }
  }, [pedir]);
  useEffect(() => { if (s.admin) cargar(); }, [s.admin, cargar]);

  if (!s.admin) return <Tarjeta T={T} titulo="Usuarios">Solo el administrador ve este módulo.</Tarjeta>;

  async function accion(u, a, extra = {}) {
    if (a === "eliminar" && !window.confirm(`¿Eliminar la cuenta ${u.email}? No se puede deshacer; la persona tendría que registrarse de nuevo.`)) return;
    if (a === "clave" && !window.confirm(`¿Crear una contraseña temporal para ${u.email}? La actual deja de servir.`)) return;
    setOcupado(u.id + a); setMsg(null);
    try {
      const r = await pedir({ accion: a, id: u.id, ...extra });
      if (r.claveTemporal) setMsg({ tipo: "bien", txt: `Contraseña temporal de ${u.email}: ${r.claveTemporal} — désela por un canal privado y pídale que la cambie (menú de la cuenta → Cambiar contraseña).`, fija: true });
      else setMsg({ tipo: "bien", txt: `Listo: ${u.email}.` });
      await cargar();
    } catch (e) { setMsg({ tipo: "critico", txt: e.message }); }
    finally { setOcupado(null); }
  }

  const usuarios = (datos && datos.usuarios) || [];
  const pendientes = usuarios.filter((u) => u.estado === "pendiente").length;
  const lista = filtro === "todos" ? usuarios : usuarios.filter((u) => u.estado === filtro);
  const btn = (color) => ({ padding: "5px 10px", borderRadius: 6, border: `1px solid ${color || T.line}`, background: "transparent", color: color || T.inkMuted, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" });
  const chip = (on) => ({ padding: "5px 11px", borderRadius: 999, border: `1px solid ${on ? T.teal : T.line}`, background: on ? T.teal : T.panelSoft, color: on ? T.onAccent : T.inkMuted, fontSize: 12.5, cursor: "pointer" });

  return (
    <>
      <Tarjeta T={T} titulo="Usuarios" subtitulo="Cada cuenta nueva queda pendiente hasta que usted la apruebe. Solo se aceptan registros con correo de la organización."
        accion={<button style={btn()} onClick={cargar}>Actualizar</button>}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {[["todos", `Todos (${usuarios.length})`], ["pendiente", `Pendientes (${pendientes})`], ["aprobado", "Aprobados"], ["revocado", "Retirados"]].map(([k, n]) => (
            <button key={k} style={chip(filtro === k)} onClick={() => setFiltro(k)}>{n}</button>
          ))}
        </div>
        {msg && <div style={{ marginBottom: 10 }}><Estado T={T} tipo={msg.tipo}>{msg.txt}</Estado></div>}
        {!datos ? <div style={{ fontSize: 13, color: T.inkFaint }}>Cargando…</div> : !lista.length ? <div style={{ fontSize: 13, color: T.inkFaint }}>No hay cuentas en esta vista.</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {lista.map((u) => {
              const yo = u.id === datos.yo;
              const oc = (a) => ocupado === u.id + a;
              return (
                <div key={u.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 12px", borderRadius: 10, border: `1px solid ${u.estado === "pendiente" ? T.amber : T.lineSoft}`, background: T.panelSoft }}>
                  <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: T.ink, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis" }}>{u.nombre || u.email.split("@")[0]}{yo ? " (usted)" : ""}</div>
                    <div style={{ fontSize: 12, color: T.inkMuted, wordBreak: "break-all" }}>{u.email}</div>
                    <div style={{ fontSize: 11.5, color: T.inkFaint, marginTop: 2 }}>Registro {fecha(u.creado)} · último acceso {fecha(u.ultimo_acceso)}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <Estado T={T} compacto tipo={ESTADO_TIPO[u.estado] || "neutro"}>{u.estado}{u.rol === "admin" ? " · admin" : ""}</Estado>
                    {!yo && u.estado !== "aprobado" && <button style={btn(T.teal)} disabled={!!ocupado} onClick={() => accion(u, "aprobar")}>{oc("aprobar") ? "…" : "Aprobar"}</button>}
                    {!yo && u.estado === "aprobado" && <button style={btn()} disabled={!!ocupado} onClick={() => accion(u, "revocar")}>{oc("revocar") ? "…" : "Retirar acceso"}</button>}
                    {!yo && u.estado === "aprobado" && <button style={btn()} disabled={!!ocupado} onClick={() => accion(u, "rol", { rol: u.rol === "admin" ? "usuario" : "admin" })}>{u.rol === "admin" ? "Quitar admin" : "Hacer admin"}</button>}
                    <button style={btn()} disabled={!!ocupado} onClick={() => accion(u, "clave")}>{oc("clave") ? "…" : "Clave temporal"}</button>
                    {!yo && <button style={btn("#d03b3b")} disabled={!!ocupado} onClick={() => accion(u, "eliminar")}>{oc("eliminar") ? "…" : "Eliminar"}</button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Tarjeta>

      <Tarjeta T={T} titulo="Últimos accesos" subtitulo="Registros, ingresos, preguntas al asistente y acciones de administración (60 más recientes).">
        {!datos ? null : !datos.accesos || !datos.accesos.length ? <div style={{ fontSize: 13, color: T.inkFaint }}>Sin registros todavía.</div> : (
          <div className="itu-tabla"><table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%" }}>
            <thead><tr>{["Cuándo", "Quién", "Qué", "Detalle"].map((h) => <th key={h} style={{ textAlign: "left", padding: "5px 8px", color: T.inkFaint, fontWeight: 600 }}>{h}</th>)}</tr></thead>
            <tbody>{datos.accesos.map((a, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                <td style={{ padding: "5px 8px", whiteSpace: "nowrap", color: T.inkMuted }}>{fecha(a.en)}</td>
                <td style={{ padding: "5px 8px", color: T.ink, wordBreak: "break-all" }}>{a.email}</td>
                <td style={{ padding: "5px 8px", color: T.ink }}>{ACCION[a.accion] || a.accion}</td>
                <td style={{ padding: "5px 8px", color: T.inkMuted, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.detalle || ""}>{a.detalle || ""}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Tarjeta>
    </>
  );
}
