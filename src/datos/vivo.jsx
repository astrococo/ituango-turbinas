/* ============================================================
   Estado de la operación "en vivo" (cuasi real): se arma en el
   navegador con los CSV de hoy y de ayer que sube el relay (cada
   hora, o cada 15 min si así se programó), el histórico diario que
   calcula el proceso automático y HydroForecast. Se recarga cada
   5 minutos con la pestaña visible.
   Todo lo que se calcula aquí usa las mismas funciones que el
   histórico (src/analitica.js), así que el día en curso y los días
   cerrados se leen igual.
   ============================================================ */
import { createContext, useContext, useMemo } from "react";
import { leerLoggerNet, unirNivel, aplicarCalidad } from "../operacion.js";
import { useDatos, useCargaPeriodica, hoyColombia, ahoraColombia, sumarDias } from "./fuentes.jsx";
import { calcularVivo, promedioUltimos } from "./vivoCalculo.js";

const Contexto = createContext(null);

async function cargarVivo(datos) {
  const hoy = hoyColombia(), ayer = sumarDias(hoy, -1);
  const errores = [];
  const tarea = (p, etiqueta) => p.then((v) => v, (e) => { if (e && e.codigo !== 404) errores.push(`${etiqueta}: ${e.message}`); return null; });
  const ruta = (c, d) => `${c}/${d.slice(0, 4)}/${d}.csv`;
  const [obs, pron, aa] = await Promise.all([
    tarea(datos.leerHF("/api/observed/daily?days=120", "observado.json"), "HydroForecast observado"),
    tarea(datos.leerHF("/api/forecast/quarterly_outlook", "ultimo.json"), "HydroForecast pronóstico"),
    tarea(datos.leerHF("/api/aguas_arriba?hours=96", "aguas_arriba.json"), "HydroForecast aguas arriba"),
  ]);
  const out = { hoy, ayer, consultado: ahoraColombia(), errores, hf: { observado: obs, pronostico: pron, aguasArriba: aa } };
  if (!datos.conectado) return out;
  const [gA, gH, nA, nH, diario, diarioAnt, estado, exclusiones] = await Promise.all([
    tarea(datos.leerTexto(ruta("loggernet", ayer)), "Generación de ayer"),
    tarea(datos.leerTexto(ruta("loggernet", hoy)), "Generación de hoy"),
    tarea(datos.leerTexto(ruta("nivel", ayer)), "Nivel de ayer"),
    tarea(datos.leerTexto(ruta("nivel", hoy)), "Nivel de hoy"),
    tarea(datos.leerJSON(`derivados/diario/${hoy.slice(0, 4)}.json`), "Histórico diario"),
    hoy.slice(5) <= "01-31" ? tarea(datos.leerJSON(`derivados/diario/${+hoy.slice(0, 4) - 1}.json`), "Histórico del año anterior") : Promise.resolve(null),
    tarea(datos.leerJSON("derivados/estado.json"), "Estado del proceso"),
    tarea(datos.leerJSON("calidad/exclusiones.json"), "Exclusiones de calidad"),
  ]);
  // Tramos confirmados como falla de la fuente: fuera del cálculo; valores congelados: se señalan
  const calidad = aplicarCalidad([gA, gH].filter(Boolean).flatMap((t) => leerLoggerNet(t).filas), Array.isArray(exclusiones) ? exclusiones : []);
  const gen = calidad.filas;
  const niv = [nA, nH].filter(Boolean).flatMap((t) => leerLoggerNet(t).filas);
  const filas = niv.length ? unirNivel(gen, niv).filas : gen;
  const dias = [...(diarioAnt ? diarioAnt.dias : []), ...(diario ? diario.dias : [])];
  Object.assign(out, { filas, diario: dias, estadoProceso: estado, calidadFuente: { excluidas: calidad.excluidas, congelados: calidad.congelados }, conGeneracionHoy: !!gH, columnas: gH ? leerLoggerNet(gH.slice(0, 2000)).columnas : null });
  return out;
}

function ProveedorVivo({ children }) {
  const datos = useDatos();
  const carga = useCargaPeriodica(() => cargarVivo(datos), [datos.conectado, datos.leerTexto, datos.leerJSON, datos.leerHF], 5 * 60e3);
  // calcularVivo corre solo cuando llegan datos nuevos (no al cambiar "cargando")
  const vivo = useMemo(() => calcularVivo(carga.datos), [carga.datos]);
  const valor = useMemo(() => ({ ...carga, vivo }), [carga, vivo]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}
const useVivo = () => useContext(Contexto);

export { ProveedorVivo, useVivo, calcularVivo, cargarVivo, promedioUltimos };
