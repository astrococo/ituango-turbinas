/* ============================================================
   Agente de vigilancia: reglas fijas (sin IA) sobre el estado en vivo.
   Lo usan la app (Tablero) y el proceso automático, que además avisa
   por GitHub cuando aparece una alerta nueva. Los umbrales son los
   mismos que ya usa la app; no hay umbrales nuevos:
   - dato atrasado: > 90 min aviso, > 180 min crítico (indicador de frescura)
   - regla 1891: lo requerido el resto del día (ya por encima, o por encima
     de la capacidad de U1–U4) y el cierre si sigue como la última hora
   - vertimiento: > 1 m³/s (umbral de la regla diaria)
   - nivel: por encima del NAMO, o menos de 24 h para llegar con la
     tendencia de 6 h
   - apertura estimada: > 97 % (techo normal) aviso, > 100 % crítico,
     con el promedio de la última hora cerrada
   Puro: entra el objeto de calcularVivo, salen las alertas.
   ============================================================ */
import { NAMO, pctFromDeg, GAMMA_NORMAL_MAX } from "./modelo.js";
import { UMBRAL_VERTIMIENTO_M3S } from "./analitica.js";

const PCT_NORMAL = pctFromDeg(GAMMA_NORMAL_MAX); // 97 %
const NIVELES = { critico: 3, aviso: 2, info: 1 };
const f = (v, d = 0) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d }));

function evaluarAlertas(v) {
  const a = [];
  if (!v) return a;
  const add = (id, nivel, titulo, detalle) => a.push({ id, nivel, titulo, detalle });

  // 1. Frescura del dato
  if (v.edadMin != null && v.edadMin > 90) {
    add("dato_atrasado", v.edadMin > 180 ? "critico" : "aviso", "Datos de LoggerNet atrasados",
      `Último dato ${v.ultima.t} (hace ${f(v.edadMin / 60, 1)} h). Revise que el relay siga corriendo en el equipo corporativo (tarea "EPM Relay LoggerNet").`);
  } else if (v.hoy && v.diario && !v.ultima) {
    add("sin_datos", "aviso", "Sin datos de LoggerNet de hoy ni de ayer", "No se encontraron los archivos del relay.");
  }

  const act = v.actual;
  const reg = v.resHoy ? v.resHoy.regla : null;
  const excepcion = reg && reg.estado === "excepcion";

  // 2. Regla operativa (Res. 1891) del día en curso
  if (v.requerido && v.banda && !excepcion && v.restoMin > 0) {
    const r = v.requerido;
    if (r.yaPorEncima) {
      add("regla_por_encima", "critico", "Regla 1891: el día cierra por encima de la banda aun parando",
        `Promedio regulado de hoy ${f(reg.qReg, 1)} m³/s con banda ${f(v.banda.min, 1)}–${f(v.banda.max, 1)} m³/s; faltan ${f(v.restoMin / 60, 1)} h.`);
    } else if (r.superaCapacidad) {
      add("regla_capacidad", "critico", "Regla 1891: cerrar dentro pide más que la capacidad de U1–U4",
        `Haría falta un promedio de al menos ${f(r.qMin, 0)} m³/s (${f(r.pMin, 0)} MW) las ${f(v.restoMin / 60, 1)} h que faltan; la capacidad es ${f(r.qCapacidad, 0)} m³/s.`);
    } else if (v.cierreSiSigue != null && (v.cierreSiSigue > v.banda.max || v.cierreSiSigue < v.banda.min)) {
      const arriba = v.cierreSiSigue > v.banda.max;
      add(arriba ? "cierre_encima" : "cierre_debajo", "aviso", `Regla 1891: si sigue como la última hora, cierra ${arriba ? "por encima" : "por debajo"}`,
        `Cierre proyectado ${f(v.cierreSiSigue, 1)} m³/s (banda ${f(v.banda.min, 1)}–${f(v.banda.max, 1)}). Para cerrar dentro, el resto del día: ${f(Math.max(0, r.qMin), 0)}–${f(Math.max(0, r.qMax), 0)} m³/s, ${f(Math.max(0, r.pMin), 0)}–${f(Math.max(0, r.pMax), 0)} MW con el F.C. actual.`);
    }
  }
  if (v.bandaProvisional) add("banda_provisional", "info", "Banda de hoy provisional", "El día de ayer no está completo en los datos; la banda se calculó con lo que hay.");

  // 3. Vertimiento
  if (act && act.qVert != null && act.qVert > UMBRAL_VERTIMIENTO_M3S) {
    add("vertimiento", "aviso", "Vertimiento en curso",
      `Vertedero ${f(act.qVert, 1)} m³/s (promedio de 15 min). Con vertimiento en el día, la regla 1891 queda en excepción.`);
  }

  // 4. Nivel del embalse
  if (act && act.nivel != null) {
    if (act.nivel > NAMO) add("nivel_namo", "critico", "Nivel por encima del NAMO", `Nivel ${f(act.nivel, 2)} msnm; NAMO ${f(NAMO, 1)} msnm.`);
    else if (v.horasANAMO != null && v.horasANAMO < 24) {
      add("nivel_sube", "aviso", "El nivel llegaría al NAMO en menos de 24 h",
        `Nivel ${f(act.nivel, 2)} msnm subiendo ${f(v.tendencia[2].cmPorHora, 1)} cm/h (tendencia de 6 h): unas ${f(v.horasANAMO, 0)} h para el NAMO (${f(NAMO, 1)} msnm).`);
    }
  }

  // 5. Apertura estimada del distribuidor (última hora cerrada)
  if (v.resHoy && v.ultima) {
    const hActual = +v.ultima.t.slice(11, 13);
    const h = v.resHoy.horas.slice(0, hActual).reverse().find((x) => x && x.gamma);
    if (h) {
      h.gamma.forEach((g, u) => {
        if (g == null) return;
        const p = pctFromDeg(g);
        if (p > PCT_NORMAL + 1e-9) {
          add(`apertura_u${u + 1}`, p > 100 + 1e-9 ? "critico" : "aviso", `U${u + 1}: apertura estimada ${f(p, 1)} %`,
            `Hora ${h.t.slice(11)}: ${f(p, 1)} % (${f(g, 2)}°), por encima del ${p > 100 ? "100 % (30,2°, límite ampliado)" : "97 % (techo de operación normal)"}. Estimada con el modelo de la colina a partir de la potencia medida (${f(h.p[u], 1)} MW).`);
        }
      });
    }
  }
  return a.sort((x, y) => NIVELES[y.nivel] - NIVELES[x.nivel]);
}

/* Une las alertas nuevas con las anteriores: conserva "desde" de las que
   siguen activas y decide cuáles se notifican (críticas o avisos que no
   estaban activos y no se avisaron en las últimas `horasSilencio` h). */
function compararAlertas(nuevas, anterior, ahora, { horasSilencio = 6 } = {}) {
  const previas = new Map(((anterior && anterior.alertas) || []).map((x) => [x.id, x]));
  const notificadas = { ...((anterior && anterior.notificadas) || {}) };
  const mins = (t) => Date.parse(t.replace(" ", "T") + ":00Z") / 60000;
  const aNotificar = [];
  const alertas = nuevas.map((x) => {
    const p = previas.get(x.id);
    const desde = p ? p.desde : ahora;
    if (!p && x.nivel !== "info") {
      const ult = notificadas[x.id];
      if (!ult || mins(ahora) - mins(ult) >= horasSilencio * 60) { aNotificar.push(x); notificadas[x.id] = ahora; }
    }
    return { ...x, desde };
  });
  const resueltas = [...previas.values()].filter((p) => !nuevas.some((x) => x.id === p.id) && p.nivel !== "info");
  return { alertas, notificadas, aNotificar, resueltas };
}

export { evaluarAlertas, compararAlertas };
