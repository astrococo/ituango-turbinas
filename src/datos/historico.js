/* Lectura del histórico que arma el proceso automático (derivados/ en el
   repositorio de datos). */
import { useCallback } from "react";
import { useDatos, useCargaPeriodica, hoyColombia, sumarDias } from "./fuentes.jsx";

/* Histórico diario de todos los años disponibles. */
function useHistoricoDiario() {
  const d = useDatos();
  const cargar = useCallback(async () => {
    if (!d.conectado) return null;
    const estado = await d.leerJSON("derivados/estado.json");
    const anios = estado.anios || [hoyColombia().slice(0, 4)];
    const partes = await Promise.all(anios.map((a) => d.leerJSON(`derivados/diario/${a}.json`).catch(() => null)));
    const dias = partes.filter(Boolean).flatMap((p) => p.dias).sort((a, b) => (a.dia < b.dia ? -1 : 1));
    return { estado, dias };
  }, [d]);
  return useCargaPeriodica(cargar, [cargar], 30 * 60e3);
}

/* Series horarias de los meses que cubren [desde, hasta]. */
function useHorario(desde, hasta) {
  const d = useDatos();
  const cargar = useCallback(async () => {
    if (!d.conectado || !desde || !hasta) return null;
    const meses = [];
    let m = desde.slice(0, 7);
    while (m <= hasta.slice(0, 7) && meses.length < 24) {
      meses.push(m);
      const [a, mm] = m.split("-").map(Number);
      m = mm === 12 ? `${a + 1}-01` : `${a}-${String(mm + 1).padStart(2, "0")}`;
    }
    const partes = await Promise.all(meses.map((x) => d.leerJSON(`derivados/horario/${x}.json`).catch(() => null)));
    const out = { t: [], nivel: [], qReg: [], qVert: [], qDesc: [], fc: [], p: [], qFC: [], qWK: [], fcWK: [], qMod: [], etaWK: [], etaMod: [], linea: [], qComp: [], aComp: [] };
    for (const p of partes.filter(Boolean)) {
      p.t.forEach((t, i) => {
        if (t.slice(0, 10) < desde || t.slice(0, 10) > hasta) return;
        for (const k of Object.keys(out)) out[k].push(p[k] ? p[k][i] : null);
      });
    }
    return out;
  }, [d, desde, hasta]);
  return useCargaPeriodica(cargar, [cargar], 0);
}

/* Filtra días por periodo ("7", "30", "90", "365", "todo"). */
function filtrarPeriodo(dias, periodo) {
  if (!dias || !dias.length || periodo === "todo") return dias || [];
  const hasta = dias[dias.length - 1].dia;
  const desde = sumarDias(hasta, -(+periodo - 1));
  return dias.filter((x) => x.dia >= desde);
}

export { useHistoricoDiario, useHorario, filtrarPeriodo };
