/* ============================================================
   Asistente (agente con IA) con herramientas que leen SOLO los datos que
   la app ya tiene (estado en vivo, histórico del repositorio privado,
   HydroForecast) y los modelos de la app (colina, simulación de nivel).
   El modelo no inventa cifras: las pide a las herramientas, y las
   herramientas usan el mismo código que los módulos de la app.
   Motores: servidor de la app (Groq, gratis), GitHub Actions (Groq) u
   Ollama en el equipo (preguntarLocal); Claude (preguntar) se conserva
   para pruebas.
   ============================================================ */
import {
  NAMO, CONDICION_DESCARGA_DEFECTO, pctFromDeg, GAMMA_ENSAYADO_MAX, P_MAXIMO_ESPERADO_MW,
  factorConversionHidrometria, simularDespachoHorario, unidadesMinimasParaPotencia, repartoPorUnidad,
} from "./modelo.js";
import { evaluarAlertas } from "./alertas.js";
import { resumenIndicadores, capacidadDemostrada, capacidadNominalMW, energiaEmbalsada } from "./indicadores.js";

const URL_API = "https://api.anthropic.com/v1/messages";
const MODELOS = [
  ["claude-sonnet-5-5", "Claude Sonnet 5.5 (recomendado)"],
  ["claude-haiku-5-5", "Claude Haiku 5.5 (más rápido y económico)"],
  ["claude-opus-5-5", "Claude Opus 5.5 (más capaz, más costoso)"],
];
const MAX_VUELTAS = 8;

const r = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const pct = (g) => (g == null || !(g > 0) ? null : r(pctFromDeg(g), 1));

const SISTEMA = `Eres el asistente de operación de la central hidroeléctrica Ituango (EPM) dentro de la app "Turbinas Ituango". Respondes en español, breve y concreto, a ingenieros de operación. Trata al usuario de «usted».
Reglas:
- No inventes cifras ni fechas. Toda cifra de operación sale de una herramienta; si la herramienta no trae el dato exacto (una fecha, una hora, un valor por unidad), dilo o pide el detalle con otra herramienta (p. ej. historico_diario), nunca lo deduzcas. Cita la hora del dato (hora de Colombia).
- Cuando calcules algo con un modelo (apertura, caudal del modelo, simulación de nivel), dilo: es una estimación.
- Conceptos de la app:
  * Caudal regulado (Hidrometría) = potencia en bornes / F.C. El F.C. es 1,62 hasta el 29-oct-2026 14:35; desde entonces 0,0119·nivel − 3,178 (nivel entre 390 y 420 msnm) y 1,80 fuera de ese rango.
  * Regla operativa de la Res. ANLA 1891: el promedio diario del caudal regulado debe quedar dentro del promedio del día anterior ±4,70 %. Si en el día hay vertimiento (> 1 m³/s), la regla queda en excepción.
  * Banda operativa de la generación: el Promedio RT de cada hora debe quedar dentro del despacho de XM ±5 %.
  * Apertura del distribuidor: 100 % = 30,2° (límite ampliado), 97 % = 29,29° (techo de operación normal; el 3 % restante es reserva para frecuencia), 87,7 % = 26,5° (límite original). LoggerNet no mide la apertura: la app la estima con el modelo de la colina (ensayo 2013) a partir de la potencia medida.
  * El caudal Winter-Kennedy (WK) de cada unidad NO está calibrado: solo sirve como índice relativo entre unidades.
  * Hoy operan U1–U4 (almenara N°1); U5–U8 entran desde 2028. Potencia máxima garantizada: 307 MW en el eje por unidad. NAMO ${NAMO} msnm.
- Si te piden una decisión operativa, entrega los números y las opciones; la decisión es del ingeniero.
- Elección de herramienta:
  * Promedios, totales, máximos o comparaciones de un periodo (un mes, una semana, varios días): usa resumen_periodo (una sola llamada, hasta 366 días). historico_diario solo si piden el detalle día a día (máx. 10 días) y serie_horaria solo para horas puntuales.
  * Factor de planta: nominal = energía / (capacidad nominal en operación, hoy 4 × 300 MW = 1.200 MW, × horas); real = sobre la capacidad real demostrada (mayor potencia media de un día completo). Da los dos si piden «factor de planta».
  * «Promedio de generación» de una unidad o de la central: entrega la potencia media (MW) y la energía (MWh) del periodo; aclara si el promedio es sobre las horas en línea o sobre todo el periodo.
  * Simulaciones: pasa a simular_nivel SOLO las horas que pidió el usuario (p. ej. 10 h a 900 MW = 10 valores de 900). No agregues horas con 0 MW ni supongas paradas.
  * El despacho de XM NO está en tus datos: se pega en la pestaña Despacho de la app. Si preguntan por el cumplimiento del despacho, dilo en una frase y entrega la potencia medida de la última hora cerrada. La banda de despacho (XM ±5 %, hora a hora) y la regla 1891 (caudal regulado del día) son controles distintos: no los mezcles.
- Formato: respuesta corta (3 a 8 líneas). La cifra pedida primero, en negrita, con su unidad y la hora o el periodo del dato. Tablas solo si piden detalle hora a hora o por unidad. No repitas los supuestos completos; menciona solo los que cambian la lectura.`;

const HERRAMIENTAS = [
  { name: "estado_actual", description: "Estado en vivo de la central con el último dato de LoggerNet: nivel y su tendencia, potencia y caudal por unidad, apertura estimada por unidad, vertedero, caudal descargado, entrada al embalse de hoy, regla 1891 del día (promedio, banda, lo requerido el resto del día, cierre si sigue como la última hora), nivel estimado a las 24:00, pronóstico de HydroForecast para hoy y alertas activas.", input_schema: { type: "object", properties: {} } },
  { name: "resumen_periodo", description: "Resumen agregado de un periodo (1 a 366 días), calculado con el histórico diario: factor de planta nominal y real, horas equivalentes, energía equivalente del agua vertida, tiempo en línea por unidad, energía, potencia media y máxima de la central y de cada unidad (sobre las horas en línea y sobre todo el periodo), horas en línea y arranques por unidad, nivel (inicio, fin, mín., máx.), días extremos con su fecha (mayor y menor energía, nivel más alto y más bajo), caudal regulado medio, entrada media, días con vertimiento y días de la regla 1891 dentro/fuera/en excepción. Úsala para promedios, totales y comparaciones de meses o semanas.", input_schema: { type: "object", properties: { desde: { type: "string", description: "AAAA-MM-DD" }, hasta: { type: "string", description: "AAAA-MM-DD (puede ser hoy: el día en curso cuenta parcial)" } }, required: ["desde", "hasta"] } },
  { name: "historico_diario", description: "Detalle día a día entre dos fechas (máximo 10 días; para periodos largos use resumen_periodo): regla 1891 (promedio regulado, banda, estado), nivel (inicio, fin, mín., máx.), energía, potencia media, vertimiento, caudal descargado, caudal de entrada (balance de masa) y, por unidad, horas en línea, energía, arranques, potencia media y máxima.", input_schema: { type: "object", properties: { desde: { type: "string", description: "AAAA-MM-DD" }, hasta: { type: "string", description: "AAAA-MM-DD" } }, required: ["desde", "hasta"] } },
  { name: "serie_horaria", description: "Promedios horarios entre dos fechas (máximo 2 días): nivel, caudal regulado, vertedero, descargado, F.C. y, por unidad, potencia, fracción de la hora en línea y apertura estimada (%).", input_schema: { type: "object", properties: { desde: { type: "string", description: "AAAA-MM-DD" }, hasta: { type: "string", description: "AAAA-MM-DD" } }, required: ["desde", "hasta"] } },
  { name: "pronostico_caudal", description: "Pronóstico diario de HydroForecast (Sitio Presa y Olaya: media, mínimo y máximo, hasta 15 días) y lo observado de los últimos 7 días.", input_schema: { type: "object", properties: {} } },
  { name: "simular_nivel", description: "Simula el nivel del embalse hora a hora con el modelo de la app (colina + curvas cota-volumen; sin vertimiento) para un programa de potencia total en bornes. Unidades: el mínimo que entrega la potencia (máx. 4). Devuelve nivel por hora, caudal turbinado, apertura por unidad y el caudal regulado (Hidrometría) resultante.", input_schema: { type: "object", properties: { potencias_mw: { type: "array", items: { type: "number" }, description: "Potencia total en bornes (MW) de cada hora a simular, en orden (1 a 24 valores)." }, caudal_entrada_m3s: { type: "number", description: "Caudal de entrada al embalse. Si falta, el balance de masa de hoy." }, nivel_inicial_msnm: { type: "number", description: "Si falta, el nivel actual." } }, required: ["potencias_mw"] } },
  { name: "punto_operacion", description: "Para un nivel del embalse y una potencia por unidad, la apertura del distribuidor (% y grados), el caudal turbinado, la eficiencia y el salto neto de cada unidad, con la colina común (estimación del modelo).", input_schema: { type: "object", properties: { nivel_msnm: { type: "number" }, potencias_unidad_mw: { type: "array", items: { type: "number" }, description: "Potencia en bornes de cada unidad en línea (MW), p. ej. [250, 250, 250]." } }, required: ["nivel_msnm", "potencias_unidad_mw"] } },
];

/* ---------- Herramientas: ctx = { vivo, leerJSON(ruta) } ---------- */
function estadoActual({ vivo: v }) {
  if (!v || !v.ultima) return { error: "No hay datos en vivo cargados (revise la conexión al repositorio de datos)." };
  const a = v.actual;
  const hAct = +v.ultima.t.slice(11, 13);
  const hCerrada = v.resHoy ? v.resHoy.horas.slice(0, hAct).reverse().find((x) => x && x.gamma) : null;
  const hfHoy = v.hf && v.hf.pronostico && v.hf.pronostico.datos && v.hf.pronostico.datos.data ? v.hf.pronostico.datos.data.find((x) => String(x.timestamp).slice(0, 10) === v.hoy) : null;
  return {
    ultimo_dato: v.ultima.t, antiguedad_min: r(v.edadMin, 0),
    nivel_msnm: r(a.nivel, 3),
    tendencia_nivel_cm_h: Object.fromEntries(v.tendencia.map((x) => [`${x.min / 60}h`, r(x.cmPorHora, 2)])),
    horas_para_NAMO: r(v.horasANAMO, 1),
    promedio_15_min: {
      potencia_total_mw: r(a.pTotal, 1), potencia_unidad_mw: a.p.map((p) => r(p, 1)), en_linea: a.enLinea,
      fc: r(a.fc, 4), caudal_regulado_m3s: r(a.qReg, 1), vertedero_m3s: r(a.qVert, 1), descargado_m3s: r(a.qDesc, 1),
    },
    potencia_ultima_hora_cerrada: hCerrada ? { hora: `${hCerrada.t} (promedio de esa hora)`, total_mw: r((hCerrada.p || []).reduce((x, y) => x + (y || 0), 0), 1), por_unidad_mw: (hCerrada.p || []).map((x) => r(x, 1)) } : null,
    despacho_xm: { disponible: false, nota: "El despacho de XM no llega al asistente (se pega en la pestaña Despacho). Sin él no se puede decir si una hora cumple la banda XM ±5 %: no calcules esa banda con la potencia medida." },
    apertura_ultima_hora_cerrada: hCerrada ? { hora: `${hCerrada.t} (promedio de esa hora)`, por_unidad_pct: hCerrada.gamma.map(pct), por_unidad_grados: hCerrada.gamma.map((g) => r(g, 2)), nota: "estimada con el modelo de la colina; null = unidad detenida o en arranque/parada" } : null,
    entrada_hoy_m3s: v.resHoy ? r(v.resHoy.balance.qEntrada, 1) : null,
    regla_1891_hoy: v.resHoy ? {
      promedio_regulado_m3s: r(v.resHoy.regla.qReg, 2), minutos_con_dato: v.resHoy.minutos, estado_hasta_ahora: v.resHoy.regla.estado,
      banda_m3s: v.banda ? { base_ayer: r(v.banda.base, 2), min: r(v.banda.min, 2), max: r(v.banda.max, 2) } : null, banda_provisional: !!v.bandaProvisional,
      requerido_resto_del_dia: v.requerido ? { horas_restantes: r(v.restoMin / 60, 2), q_min_m3s: r(v.requerido.qMin, 1), q_max_m3s: r(v.requerido.qMax, 1), p_min_mw: r(v.requerido.pMin, 0), p_max_mw: r(v.requerido.pMax, 0), supera_capacidad_U1_U4: v.requerido.superaCapacidad, ya_por_encima: v.requerido.yaPorEncima } : null,
      cierre_si_sigue_como_ultima_hora_m3s: r(v.cierreSiSigue, 2),
      ...(v.resHoy.regla.estado === "excepcion" ? { nota_excepcion: "Hubo vertimiento > 1 m³/s en el día: la regla queda en excepción TODO el día aunque el vertimiento pare; la banda y lo requerido son solo referencia." } : {}),
    } : null,
    nivel_estimado_24h_msnm: r(v.nivelFinDia, 3),
    energia_embalsada_util: (() => { const e = energiaEmbalsada(a.nivel, v.ultima.t); return e ? { gwh: r(e.gwh, 0), pct_volumen_util: r(e.pctUtil, 1), horas_a_capacidad_nominal: r((e.gwh * 1000) / capacidadNominalMW(v.hoy), 0), nota: "volumen útil sobre 390 msnm × F.C. de Hidrometría" } : null; })(),
    hydroforecast_hoy: hfHoy ? { sitio_presa_media: r(hfHoy.QSitioPresa_pred_mean, 0), sitio_presa_min: r(hfHoy.QSitioPresa_pred_min, 0), sitio_presa_max: r(hfHoy.QSitioPresa_pred_max, 0), olaya_media: r(hfHoy.QOlaya_pred_mean, 0) } : null,
    alertas: evaluarAlertas(v).map((x) => ({ nivel: x.nivel, titulo: x.titulo, detalle: x.detalle })),
  };
}

const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
function validarRango(desde, hasta, max) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde || "") || !/^\d{4}-\d{2}-\d{2}$/.test(hasta || "")) return "Fechas en formato AAAA-MM-DD.";
  if (hasta < desde) return "'hasta' es anterior a 'desde'.";
  if (diasEntre(desde, hasta) > max) return `Máximo ${max} días por consulta.`;
  return null;
}

async function historicoDiario(ctx, { desde, hasta }) {
  const e = validarRango(desde, hasta, (ctx.limites && ctx.limites.historicoDias) || 10); if (e) return { error: e };
  const anios = [...new Set([desde.slice(0, 4), hasta.slice(0, 4)])];
  const partes = await Promise.all(anios.map((a) => ctx.leerJSON(`derivados/diario/${a}.json`).catch(() => null)));
  const dias = partes.filter(Boolean).flatMap((p) => p.dias).filter((d) => d.dia >= desde && d.dia <= hasta).sort((a, b) => (a.dia < b.dia ? -1 : 1));
  if (!dias.length) return { error: `No hay días en el histórico entre ${desde} y ${hasta}.` };
  // Formato de tabla (columnas + filas): la mitad de tamaño que objetos con nombres repetidos
  return {
    nota: "parcial = día incompleto (o en curso). Por unidad: [horas en línea, energía MWh, arranques, P media en línea MW, P máx MW].",
    columnas: ["dia", "parcial", "regla_q_m3s", "banda_min", "banda_max", "regla_estado", "nivel_ini", "nivel_fin", "energia_mwh", "p_media_mw", "vertimiento", "entrada_m3s", "U1", "U2", "U3", "U4"],
    filas: dias.map((d) => [
      d.dia, !!d.parcial, r(d.regla.qReg, 1), d.regla.banda ? r(d.regla.banda.min, 1) : null, d.regla.banda ? r(d.regla.banda.max, 1) : null, d.regla.estado,
      d.nivel ? r(d.nivel.ini, 2) : null, d.nivel ? r(d.nivel.fin, 2) : null, r(d.energia, 0), r(d.pMedia, 0),
      d.vertedero ? !!d.vertedero.conVertimiento : null, d.balance ? r(d.balance.qEntrada, 0) : null,
      ...[0, 1, 2, 3].map((i) => { const u = (d.unidades || [])[i]; return u ? [r(u.horas, 1), r(u.energia, 0), u.arranques, r(u.pMedia, 0), r(u.pMax, 0)] : null; }),
    ]),
  };
}

async function resumenPeriodo(ctx, { desde, hasta }) {
  const e = validarRango(desde, hasta, 366); if (e) return { error: e };
  const anios = [...new Set([desde.slice(0, 4), hasta.slice(0, 4)])];
  const partes = await Promise.all(anios.map((a) => ctx.leerJSON(`derivados/diario/${a}.json`).catch(() => null)));
  const dias = partes.filter(Boolean).flatMap((p) => p.dias).filter((d) => d.dia >= desde && d.dia <= hasta).sort((a, b) => (a.dia < b.dia ? -1 : 1));
  if (!dias.length) return { error: `No hay días en el histórico entre ${desde} y ${hasta}.` };
  const horasPeriodo = dias.reduce((a, d) => a + (Number.isFinite(d.minutos) ? d.minutos / 60 : 24), 0);
  const suma = (f) => dias.reduce((a, d) => { const v = f(d); return Number.isFinite(v) ? a + v : a; }, 0);
  const maximo = (f) => dias.reduce((a, d) => { const v = f(d); return Number.isFinite(v) && (a == null || v > a) ? v : a; }, null);
  const minimo = (f) => dias.reduce((a, d) => { const v = f(d); return Number.isFinite(v) && (a == null || v < a) ? v : a; }, null);
  const energia = suma((d) => d.energia);
  const conRegla = dias.filter((d) => d.regla && Number.isFinite(d.regla.qReg));
  const cuenta = (est) => dias.filter((d) => d.regla && d.regla.estado === est).length;
  const nivIni = dias.find((d) => d.nivel), nivFin = [...dias].reverse().find((d) => d.nivel);
  const unidades = [0, 1, 2, 3].map((i) => {
    const horas = suma((d) => (d.unidades && d.unidades[i] ? d.unidades[i].horas : NaN));
    const en = suma((d) => (d.unidades && d.unidades[i] ? d.unidades[i].energia : NaN));
    return {
      unidad: `U${i + 1}`, horas_en_linea: r(horas, 1), energia_mwh: r(en, 0),
      p_media_en_linea_mw: horas > 0 ? r(en / horas, 1) : null, p_media_periodo_mw: horasPeriodo > 0 ? r(en / horasPeriodo, 1) : null,
      p_max_mw: r(maximo((d) => (d.unidades && d.unidades[i] ? d.unidades[i].pMax : NaN)), 1),
      arranques: suma((d) => (d.unidades && d.unidades[i] ? d.unidades[i].arranques : NaN)),
    };
  });
  const parciales = dias.filter((d) => d.parcial).map((d) => d.dia);
  // Factor de planta: capacidad nominal en operación y capacidad real demostrada (en todo el histórico)
  let historico = dias;
  try {
    const est = await ctx.leerJSON("derivados/estado.json");
    if (est && Array.isArray(est.anios)) historico = (await Promise.all(est.anios.map((a) => ctx.leerJSON(`derivados/diario/${a}.json`).catch(() => null)))).filter(Boolean).flatMap((p) => p.dias);
  } catch { /* con los días del periodo */ }
  const capReal = capacidadDemostrada(historico);
  const ind = resumenIndicadores(dias, { capacidadReal: capReal ? capReal.mw : null });
  // Días extremos (solo días completos, para no comparar un día a medias)
  const completos = dias.filter((d) => !d.parcial && Number.isFinite(d.energia));
  const extremo = (f, mayor) => completos.reduce((a, d) => (a == null || (mayor ? f(d) > f(a) : f(d) < f(a)) ? d : a), null);
  const dMax = extremo((d) => d.energia, true), dMin = extremo((d) => d.energia, false);
  const nMax = completos.filter((d) => d.nivel).reduce((a, d) => (!a || d.nivel.max > a.nivel.max ? d : a), null);
  const nMin = completos.filter((d) => d.nivel).reduce((a, d) => (!a || d.nivel.min < a.nivel.min ? d : a), null);
  return {
    periodo: { desde: dias[0].dia, hasta: dias[dias.length - 1].dia, dias_con_datos: dias.length, horas_con_datos: r(horasPeriodo, 1), dias_parciales: parciales.length ? parciales : undefined },
    central: {
      energia_mwh: r(energia, 0), p_media_mw: horasPeriodo > 0 ? r(energia / horasPeriodo, 1) : null,
      p_media_diaria_max_mw: r(maximo((d) => d.pMedia), 1), p_media_diaria_min_mw: r(minimo((d) => d.pMedia), 1),
      caudal_regulado_medio_m3s: conRegla.length ? r(conRegla.reduce((a, d) => a + d.regla.qReg, 0) / conRegla.length, 1) : null,
      entrada_media_m3s: r(suma((d) => (d.balance ? d.balance.qEntrada : NaN)) / Math.max(1, dias.filter((d) => d.balance && Number.isFinite(d.balance.qEntrada)).length), 1),
      dias_con_vertimiento: dias.filter((d) => d.vertedero && d.vertedero.conVertimiento).length,
    },
    dias_extremos: completos.length ? {
      mayor_energia: dMax ? { dia: dMax.dia, energia_mwh: r(dMax.energia, 0), p_media_mw: r(dMax.pMedia, 1) } : null,
      menor_energia: dMin ? { dia: dMin.dia, energia_mwh: r(dMin.energia, 0), p_media_mw: r(dMin.pMedia, 1) } : null,
      nivel_mas_alto: nMax ? { dia: nMax.dia, max_msnm: r(nMax.nivel.max, 2) } : null,
      nivel_mas_bajo: nMin ? { dia: nMin.dia, min_msnm: r(nMin.nivel.min, 2) } : null,
      nota: "solo días completos",
    } : null,
    nivel_msnm: nivIni ? { inicio: r(nivIni.nivel.ini, 2), fin: r(nivFin.nivel.fin, 2), min: r(minimo((d) => (d.nivel ? d.nivel.min : NaN)), 2), max: r(maximo((d) => (d.nivel ? d.nivel.max : NaN)), 2) } : null,
    indicadores: {
      dias_completos: ind.dias, factor_planta_nominal_pct: r(ind.fpNominal, 1), capacidad_nominal_mw: capacidadNominalMW(hasta),
      factor_planta_real_pct: r(ind.fpReal, 1), capacidad_real_demostrada: capReal ? { mw: r(capReal.mw, 1), dia: capReal.dia, nota: "mayor potencia media de un día completo con todas las unidades" } : null,
      horas_equivalentes_plena_carga: r(ind.horasEquivalentes, 0), energia_equivalente_vertida_mwh: r(ind.vertidaMWh, 0), energia_vertida_pct_de_lo_generado: r(ind.vertidaPct, 1),
      tiempo_en_linea_pct: Object.fromEntries(ind.unidades.map((u) => [u.unidad, r(u.pctTiempo, 0)])),
    },
    regla_1891_dias: { cumple: cuenta("cumple"), por_encima: cuenta("por_encima"), por_debajo: cuenta("por_debajo"), excepcion: cuenta("excepcion"), sin_banda: dias.filter((d) => d.regla && !d.regla.banda).length },
    unidades,
    nota: "p_media_en_linea = energía / horas en línea; p_media_periodo = energía / horas con datos del periodo. Energía en bornes (LoggerNet).",
  };
}

async function serieHorariaHerr(ctx, { desde, hasta }) {
  const e = validarRango(desde, hasta, (ctx.limites && ctx.limites.horariaDias) || 2); if (e) return { error: e };
  const meses = [...new Set([desde.slice(0, 7), hasta.slice(0, 7)])];
  const partes = await Promise.all(meses.map((m) => ctx.leerJSON(`derivados/horario/${m}.json`).catch(() => null)));
  const filas = [];
  for (const p of partes.filter(Boolean)) p.t.forEach((t, i) => {
    if (t.slice(0, 10) < desde || t.slice(0, 10) > hasta) return;
    filas.push([t, r(p.nivel[i], 2), r(p.qReg[i], 1), r(p.qVert[i], 1), r(p.qDesc[i], 0), (p.p[i] || []).map((x) => r(x, 0)), p.gamma ? (p.gamma[i] || []).map(pct) : null]);
  });
  // Horas de hoy (aún no en el histórico)
  const v = ctx.vivo;
  if (v && v.resHoy && hasta >= v.hoy) {
    const ya = new Set(filas.map((x) => x[0]));
    v.resHoy.horas.forEach((h) => { if (h && !ya.has(h.t) && h.t >= desde && h.t.slice(0, 10) <= hasta) filas.push([h.t, r(h.nivel, 2), r(h.qReg, 1), r(h.qVert, 1), r(h.qDesc, 0), h.p.map((x) => r(x, 0)), (h.gamma || []).map(pct)]); });
  }
  if (!filas.length) return { error: `No hay horas entre ${desde} y ${hasta}.` };
  return { nota: "Hora = inicio de la hora (Colombia), promedio de esa hora. apertura_pct estimada con el modelo; null = detenida o en arranque/parada.", columnas: ["hora", "nivel_msnm", "q_regulado_m3s", "vertedero_m3s", "descargado_m3s", "p_mw_U1_U4", "apertura_pct_U1_U4"], filas };
}

function pronosticoCaudal({ vivo: v }) {
  const pr = v && v.hf && v.hf.pronostico && v.hf.pronostico.datos;
  const ob = v && v.hf && v.hf.observado && v.hf.observado.datos;
  if (!pr && !ob) return { error: "HydroForecast no está disponible ahora." };
  return {
    emitido: pr ? pr.generated_at || null : null,
    pronostico: pr && pr.data ? pr.data.slice(0, 15).map((x) => ({ dia: String(x.timestamp).slice(0, 10), sitio_presa_media: r(x.QSitioPresa_pred_mean, 0), sitio_presa_min: r(x.QSitioPresa_pred_min, 0), sitio_presa_max: r(x.QSitioPresa_pred_max, 0), olaya_media: r(x.QOlaya_pred_mean, 0) })) : null,
    observado_7_dias: ob && ob.data ? ob.data.slice(-7).map((x) => ({ dia: String(x.timestamp).slice(0, 10), sitio_presa: r(x.QSitioPresa_obs, 0), olaya: r(x.QOlaya_obs, 0) })) : null,
  };
}

function simularNivel({ vivo: v }, { potencias_mw, caudal_entrada_m3s, nivel_inicial_msnm }) {
  if (!Array.isArray(potencias_mw) || !potencias_mw.length || potencias_mw.length > 24 || potencias_mw.some((p) => !Number.isFinite(p) || p < 0)) return { error: "potencias_mw: de 1 a 24 valores ≥ 0." };
  const nivel = Number.isFinite(nivel_inicial_msnm) ? nivel_inicial_msnm : v && v.actual ? v.actual.nivel : null;
  const qIn = Number.isFinite(caudal_entrada_m3s) ? caudal_entrada_m3s : v && v.resHoy ? v.resHoy.balance.qEntrada : null;
  if (nivel == null) return { error: "Falta el nivel inicial (no hay dato en vivo)." };
  if (qIn == null) return { error: "Falta el caudal de entrada (no hay balance de hoy): páselo en caudal_entrada_m3s." };
  const sim = simularDespachoHorario({ nivelInicial: nivel, qEntrada: qIn, cond: CONDICION_DESCARGA_DEFECTO, horas: potencias_mw.map((P) => ({ potenciaMW: P, unidades: unidadesMinimasParaPotencia(P, 4) })) });
  const t0 = v && v.ultima ? v.ultima.t : null;
  return {
    supuestos: { nivel_inicial_msnm: r(nivel, 3), caudal_entrada_m3s: r(qIn, 1), desde: t0, condicion_descarga: "río colmatado (ASE)", techo_apertura: "100 % (30,2°) y 307 MW en el eje por unidad", sin_vertimiento: true },
    nivel_final_msnm: r(sim.Hfinal, 3), cambio_cm: r(sim.deltaH * 100, 1),
    horas_simuladas: potencias_mw.length,
    columnas: ["hora", "potencia_mw", "unidades", "apertura_pct", "q_turbinado_m3s", "q_regulado_hidrometria_m3s", "nivel_fin_msnm", "alcanzable"],
    filas: sim.detalle.map((d, i) => [i + 1, d.potenciaMW, d.unidades, pct(d.gamma), r(d.qTurbinado, 1),
      d.potenciaMW > 0 ? r(d.potenciaMW / factorConversionHidrometria(d.Hinicio, t0 || "2099-01-01 00:00"), 1) : 0,
      r(d.Hfin, 3), !!(d.alcanzable || d.potenciaMW === 0)]),
  };
}

function puntoOperacion(_, { nivel_msnm, potencias_unidad_mw }) {
  if (!Number.isFinite(nivel_msnm) || !Array.isArray(potencias_unidad_mw) || !potencias_unidad_mw.length || potencias_unidad_mw.length > 4) return { error: "nivel_msnm y de 1 a 4 potencias por unidad." };
  const res = repartoPorUnidad(nivel_msnm, potencias_unidad_mw, { cond: CONDICION_DESCARGA_DEFECTO, gammaMax: GAMMA_ENSAYADO_MAX, potenciaMaxMW: null });
  return {
    nota: `Colina común (ensayo 2013), río colmatado (ASE). Límite garantizado ${P_MAXIMO_ESPERADO_MW} MW en el eje por unidad; apertura hasta el máximo ensayado.`,
    unidades: res.porUnidad.filter((u) => u.pBornes > 0).map((u) => ({ unidad: `U${u.id}`, p_bornes_mw: u.pBornes, p_eje_mw: r(u.pEje, 2), apertura_pct: pct(u.gamma), apertura_grados: r(u.gamma, 2), q_m3s: r(u.q, 1), eficiencia_pct: r(u.eta, 2), salto_neto_m: r(u.saltoNeto, 2), alcanzable: u.alcanzable })),
    q_total_m3s: r(res.qTotal, 1), fc_modelo: r(res.fc, 4),
  };
}

const EJECUTORES = {
  estado_actual: (ctx) => estadoActual(ctx),
  resumen_periodo: resumenPeriodo,
  historico_diario: historicoDiario,
  serie_horaria: serieHorariaHerr,
  pronostico_caudal: (ctx) => pronosticoCaudal(ctx),
  simular_nivel: simularNivel,
  punto_operacion: puntoOperacion,
};

async function ejecutarHerramienta(ctx, nombre, entrada) {
  const f = EJECUTORES[nombre];
  if (!f) return { error: `Herramienta desconocida: ${nombre}` };
  try {
    const salida = await f(ctx, entrada || {});
    // Tope de tamaño (el plan gratuito de Groq admite ~8.000 tokens por petición)
    const max = ctx.maxCaracteresHerramienta;
    if (max && salida && !salida.error && JSON.stringify(salida).length > max) {
      return { error: `El resultado es demasiado grande para el servicio gratuito (${JSON.stringify(salida).length} caracteres). Use resumen_periodo para promedios o totales, o pida menos días.` };
    }
    return salida;
  } catch (e) { return { error: String(e && e.message ? e.message : e) }; }
}

/* Bucle del agente: llama a la API, ejecuta las herramientas que pida y
   repite hasta que responda (o MAX_VUELTAS). onPaso informa cada llamada
   a herramienta. fetchFn se puede reemplazar en las pruebas. */
async function preguntar({ clave, espacio = null, modelo, historial, ctx, onPaso = () => {}, fetchFn = fetch, senal }) {
  const mensajes = historial.slice();
  for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
    const resp = await fetchFn(URL_API, {
      method: "POST", signal: senal,
      headers: { "content-type": "application/json", "x-api-key": clave, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true", ...(espacio ? { "anthropic-workspace-id": espacio } : {}) },
      body: JSON.stringify({ model: modelo, max_tokens: 2048, system: `${SISTEMA}\nFecha y hora actual (Colombia): ${ctx.ahora || "desconocida"}.`, tools: HERRAMIENTAS, messages: mensajes }),
    });
    const cuerpo = await resp.json().catch(() => null);
    if (!resp.ok) {
      const msg = cuerpo && cuerpo.error ? cuerpo.error.message : `HTTP ${resp.status}`;
      throw new Error(resp.status === 401 ? "La clave de API no es válida (401)."
        : resp.status === 400 && /workspace/i.test(msg) ? `La clave no está asociada a un espacio de trabajo: cree la clave dentro de un espacio de trabajo o escriba su ID en la configuración (${msg}).`
        : resp.status === 404 && /workspace/i.test(msg) ? `El ID del espacio de trabajo no existe o la clave no tiene acceso (${msg}).`
        : `Error de la API (${resp.status}): ${msg}`);
    }
    mensajes.push({ role: "assistant", content: cuerpo.content });
    if (cuerpo.stop_reason !== "tool_use") return { mensajes, uso: cuerpo.usage, texto: (cuerpo.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim() };
    const resultados = [];
    for (const b of cuerpo.content.filter((x) => x.type === "tool_use")) {
      onPaso({ nombre: b.name, entrada: b.input });
      const salida = await ejecutarHerramienta(ctx, b.name, b.input);
      resultados.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(salida), ...(salida && salida.error ? { is_error: true } : {}) });
    }
    mensajes.push({ role: "user", content: resultados });
  }
  throw new Error(`El asistente no terminó en ${MAX_VUELTAS} pasos.`);
}

/* ---------- Modelo local (Ollama u otro servidor compatible con OpenAI) ----------
   Mismo bucle y mismas herramientas, en formato /v1/chat/completions. Corre
   en el computador del usuario: los datos no salen de ese equipo. */
const URL_LOCAL_DEFECTO = "http://localhost:11434";
const HERRAMIENTAS_OPENAI = HERRAMIENTAS.map((h) => ({ type: "function", function: { name: h.name, description: h.description, parameters: h.input_schema } }));
const baseLocal = (url) => (url || URL_LOCAL_DEFECTO).trim().replace(/\/+$/, "").replace(/\/v1$/, "");
// Algunos modelos (p. ej. Qwen3) escriben su razonamiento entre <think>…</think>
const limpiarRazonamiento = (t) => String(t || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();

function errorConexionLocal(base, e) {
  if (e && e.name === "AbortError") return e;
  return new Error(`No se pudo conectar con ${base}. Revise que Ollama esté abierto, que la variable OLLAMA_ORIGINS incluya https://astrococo.github.io y que Chrome tenga permitido el acceso a la red local para esta página.`);
}

async function listarModelosLocales(url, fetchFn = fetch) {
  const base = baseLocal(url);
  let resp;
  try { resp = await fetchFn(`${base}/v1/models`); } catch (e) { throw errorConexionLocal(base, e); }
  if (!resp.ok) throw new Error(`El servidor local respondió HTTP ${resp.status}.`);
  const cuerpo = await resp.json();
  return (cuerpo.data || []).map((m) => m.id).filter(Boolean).sort();
}

/* Segundos que pide esperar un 429: cabecera retry-after o el texto «try again in 21.8s» / «1m3.2s». */
function segundosDeEspera(resp, msg) {
  const hv = resp && resp.headers && resp.headers.get ? resp.headers.get("retry-after") : null;
  const h = hv != null && hv !== "" ? Number(hv) : NaN;
  if (Number.isFinite(h) && h >= 0) return h;
  const m = /try again in (?:(\d+)m)?([\d.]+)s/i.exec(String(msg || ""));
  return m ? (m[1] ? +m[1] * 60 : 0) + +m[2] : NaN;
}

/* También sirve para un servicio en la nube compatible con OpenAI (p. ej. Groq): url = base sin /v1, clave = Bearer.
   - modelosAlternos: si un modelo llega a su límite (por minuto o por día), se sigue con el siguiente
     (en Groq cada modelo tiene su propio cupo).
   - esperar429: segundos totales que se puede esperar a que se libere el cupo por minuto.
   - opciones: campos extra del cuerpo (p. ej. reasoning_effort, max_tokens); si el servicio no los
     acepta, se reintenta sin ellos.
   - contexto: texto que se agrega a la pregunta (p. ej. el estado en vivo ya consultado) para
     ahorrar una vuelta. */
/* Señal que se cancela con la del usuario o al vencer ms. */
function senalConTiempo(senal, ms) {
  if (!ms) return { senal, limpiar: () => {} };
  const c = new AbortController();
  const t = setTimeout(() => { const e = new Error("tiempo"); e.name = "TimeoutError"; c.abort(e); }, ms);
  const alAbortar = () => c.abort(senal.reason);
  if (senal) { if (senal.aborted) c.abort(senal.reason); else senal.addEventListener("abort", alAbortar, { once: true }); }
  return { senal: c.signal, limpiar: () => { clearTimeout(t); if (senal) senal.removeEventListener("abort", alAbortar); } };
}
/* Petición muy grande (413): reemplaza el resultado de herramienta más largo por un aviso. */
function recortarMasLargo(mensajes) {
  let k = -1, largo = 0;
  mensajes.forEach((m, i) => { if (m.role === "tool" && String(m.content).length > largo && !/demasiado grande/.test(m.content)) { k = i; largo = String(m.content).length; } });
  if (k < 0 || largo < 400) return false;
  mensajes[k] = { ...mensajes[k], content: JSON.stringify({ error: "Resultado demasiado grande para el servicio gratuito. Use resumen_periodo para promedios o totales, o pida menos días." }) };
  return true;
}

async function preguntarLocal({ url, modelo, historial, ctx, onPaso = () => {}, fetchFn = fetch, senal, clave = null, esperar429 = 0, modelosAlternos = [], opciones = {}, contexto = null, dormir = (ms) => new Promise((ok) => setTimeout(ok, ms)), plazoMs = 0, tiempoLlamadaMs = 0 }) {
  const base = baseLocal(url);
  const inicio = Date.now();
  const restante = () => (plazoMs ? plazoMs - (Date.now() - inicio) : Infinity);
  const sinTiempo = () => new Error("El asistente tardó demasiado (el servicio gratuito está lento u ocupado). Intente de nuevo o haga una pregunta más concreta.");
  if (!modelo) throw new Error("Elija un modelo local (botón «Probar conexión»).");
  const sistema = { role: "system", content: `${SISTEMA}\nFecha y hora actual (Colombia): ${ctx.ahora || "desconocida"}.\nPara cualquier cifra de operación, llama primero a la herramienta que corresponda.` };
  const mensajes = historial.slice();
  if (contexto && mensajes.length && mensajes[mensajes.length - 1].role === "user") {
    const u = mensajes[mensajes.length - 1];
    mensajes[mensajes.length - 1] = { role: "user", content: `${u.content}\n\n[Contexto ya consultado, no repitas la consulta: ${contexto}]` };
  }
  const modelos = [modelo, ...modelosAlternos.filter((m) => m && m !== modelo)];
  const agotados = new Set(); // modelos sin cupo diario
  const ocupados = new Set(); // modelos en su límite por minuto
  let espera = Infinity;
  let k = 0, extra = { ...opciones }, esperado = 0, usado = modelo;
  for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
    let resp, cuerpo, msg;
    for (let intento = 0; intento < 12; intento++) {
      usado = modelos[k];
      if (restante() < 3000) throw sinTiempo();
      const limite = Math.min(tiempoLlamadaMs || Infinity, restante());
      const st = senalConTiempo(senal, Number.isFinite(limite) ? limite : 0);
      try {
        resp = await fetchFn(`${base}/v1/chat/completions`, {
          method: "POST", signal: st.senal, headers: { "content-type": "application/json", ...(clave ? { Authorization: `Bearer ${clave}` } : {}) },
          body: JSON.stringify({ model: usado, messages: [sistema, ...mensajes], tools: HERRAMIENTAS_OPENAI, stream: false, temperature: 0.2, ...extra }),
        });
        cuerpo = await resp.json().catch(() => null);
      } catch (e) {
        if (senal && senal.aborted) throw e;
        if (e && (e.name === "TimeoutError" || (st.senal && st.senal.aborted && st.senal.reason && st.senal.reason.name === "TimeoutError"))) {
          // El modelo no respondió a tiempo: otro modelo, si queda tiempo
          const sig = modelos.findIndex((m, j) => j !== k && !agotados.has(m));
          if (sig >= 0 && restante() > 8000) { k = sig; continue; }
          throw sinTiempo();
        }
        throw clave ? new Error(`No se pudo conectar con ${base}.`) : errorConexionLocal(base, e);
      } finally { st.limpiar(); }
      if (resp.ok) break;
      msg = cuerpo && cuerpo.error ? cuerpo.error.message || cuerpo.error : `HTTP ${resp.status}`;
      // Petición muy grande: recortar el resultado de herramienta más largo y reintentar
      if ((resp.status === 413 || /too large|reduce your message/i.test(String(msg))) && recortarMasLargo(mensajes)) continue;
      // Parámetro opcional no aceptado: reintentar sin los extras
      if (resp.status === 400 && Object.keys(extra).length && /reasoning|max_tokens|unsupported|unknown|unrecognized/i.test(String(msg))) { extra = {}; continue; }
      if (resp.status !== 429) break;
      const diario = /per day|TPD|RPD/i.test(String(msg));
      (diario ? agotados : ocupados).add(usado);
      const s = segundosDeEspera(resp, msg);
      if (!diario) espera = Math.min(espera, Number.isFinite(s) ? s : 20);
      // Otro modelo con cupo: seguir con él de inmediato
      const sig = modelos.findIndex((m) => !agotados.has(m) && !ocupados.has(m));
      if (sig >= 0) { k = sig; continue; }
      if (ocupados.size === 0) break; // todos sin cupo diario
      // Todos en su límite por minuto: esperar lo que pide el servicio (dentro del presupuesto)
      const seg = Math.min(espera, 60) + 1;
      if (esperar429 <= 0 || esperado + seg > esperar429 || seg * 1000 > restante() - 8000) break;
      esperado += seg;
      await dormir(seg * 1000);
      ocupados.clear(); espera = Infinity;
      k = modelos.findIndex((m) => !agotados.has(m));
    }
    if (!resp.ok) {
      if (clave && resp.status === 401) throw new Error("La clave del servicio no es válida (401).");
      if (clave && resp.status === 429) throw new Error(/per day|TPD|RPD/i.test(String(msg)) ? "Se acabó el cupo gratuito de hoy del servicio de IA; se renueva cada día." : "El servicio gratuito de IA está ocupado en este momento; intente de nuevo en un minuto.");
      if (clave && (resp.status === 413 || /too large/i.test(String(msg)))) throw new Error("La consulta quedó muy grande para el servicio gratuito. Pida un periodo más corto o un dato más puntual.");
      throw new Error(/not found/i.test(String(msg)) ? `El modelo «${usado}» no está descargado en Ollama (ollama pull ${usado}).` : /does not support tools/i.test(String(msg)) ? `El modelo «${usado}» no admite herramientas; use uno con «tools», p. ej. qwen3:8b.` : `Error del modelo${clave ? "" : " local"}: ${msg}`);
    }
    const m = cuerpo && cuerpo.choices && cuerpo.choices[0] ? cuerpo.choices[0].message : null;
    if (!m) throw new Error("Respuesta vacía del modelo.");
    const llamadas = Array.isArray(m.tool_calls) ? m.tool_calls : [];
    mensajes.push({ role: "assistant", content: m.content || "", ...(llamadas.length ? { tool_calls: llamadas } : {}) });
    const uso = cuerpo.usage ? { input_tokens: cuerpo.usage.prompt_tokens, output_tokens: cuerpo.usage.completion_tokens } : null;
    if (!llamadas.length) return { mensajes, uso, texto: limpiarRazonamiento(m.content), modelo: usado };
    for (const [i, c] of llamadas.entries()) {
      const nombre = c.function && c.function.name;
      let entrada = c.function ? c.function.arguments : {};
      if (typeof entrada === "string") { try { entrada = entrada.trim() ? JSON.parse(entrada) : {}; } catch { entrada = {}; } }
      onPaso({ nombre, entrada });
      const salida = await ejecutarHerramienta(ctx, nombre, entrada);
      mensajes.push({ role: "tool", tool_call_id: c.id || `llamada_${vuelta}_${i}`, content: JSON.stringify(salida) });
    }
  }
  throw new Error(`El asistente no terminó en ${MAX_VUELTAS} pasos.`);
}

/* ---------- Claude vía GitHub (cualquier equipo) ----------
   La pregunta va al repositorio de datos como repository_dispatch
   «asistente»; GitHub Actions ejecuta este mismo agente con la clave
   guardada como secret y deja la respuesta en la rama «asistente».
   datos = { despachar(evento, carga), leerRama(ruta, rama) }. */
const RAMA_RESPUESTAS = "asistente";
function idPregunta(fecha = new Date()) {
  const c = new Date(fecha.getTime() - 5 * 3600e3).toISOString(); // hora de Colombia (UTC−5)
  const al = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  return `${c.slice(0, 4)}${c.slice(5, 7)}${c.slice(8, 10)}T${c.slice(11, 13)}${c.slice(14, 16)}${c.slice(17, 19)}-${al}`;
}
const rutaRespuesta = (id) => `respuestas/${id.slice(0, 4)}-${id.slice(4, 6)}/${id}.json`;
const esperar = (ms, senal) => new Promise((ok, mal) => {
  const t = setTimeout(ok, ms);
  if (senal) senal.addEventListener("abort", () => { clearTimeout(t); const e = new Error("cancelada"); e.name = "AbortError"; mal(e); }, { once: true });
});

async function preguntarGitHub({ datos, pregunta, historial = [], modelo, onEstado = () => {}, senal, esperaMaxMs = 300000, intervaloMs = 4000 }) {
  const id = idPregunta();
  const hist = historial.slice(-6).map((m) => ({ rol: m.rol, texto: String(m.texto || "").slice(0, 6000) }));
  await datos.despachar("asistente", { id, pregunta: String(pregunta).slice(0, 4000), historial: hist, modelo });
  const t0 = Date.now();
  onEstado({ fase: "enviada", segundos: 0, id });
  while (Date.now() - t0 < esperaMaxMs) {
    await esperar(intervaloMs, senal);
    const txt = await datos.leerRama(rutaRespuesta(id), RAMA_RESPUESTAS).catch(() => null);
    if (txt) {
      const r = JSON.parse(txt);
      if (r.error) throw new Error(r.error);
      return { texto: r.texto, pasos: r.pasos || [], uso: r.uso || null, modelo: r.modelo, ultimoDato: r.ultimoDato, id };
    }
    onEstado({ fase: "esperando", segundos: Math.round((Date.now() - t0) / 1000), id });
  }
  throw new Error(`GitHub no respondió en ${Math.round(esperaMaxMs / 60000)} minutos. Revise en el repositorio de datos la pestaña Actions (flujo «Asistente (Claude)»); la respuesta puede llegar después con el id ${id}.`);
}

export { MODELOS, HERRAMIENTAS, SISTEMA, ejecutarHerramienta, segundosDeEspera, preguntar, preguntarLocal, preguntarGitHub, idPregunta, rutaRespuesta, listarModelosLocales, limpiarRazonamiento, URL_LOCAL_DEFECTO };
