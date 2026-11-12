/* ============================================================
   Asistente (agente con IA): Claude, vía la API de Anthropic, con
   herramientas que leen SOLO los datos que la app ya tiene (estado en
   vivo, histórico del repositorio privado, HydroForecast) y los modelos
   de la app (colina, simulación de nivel). El modelo no inventa cifras:
   las pide a las herramientas, y las herramientas usan el mismo código
   que los módulos de la app.
   La llamada sale del navegador con la clave de API del usuario
   (cabecera anthropic-dangerous-direct-browser-access). Nada se envía
   hasta que el usuario hace una pregunta.
   ============================================================ */
import {
  NAMO, CONDICION_DESCARGA_DEFECTO, pctFromDeg, GAMMA_ENSAYADO_MAX, P_MAXIMO_ESPERADO_MW,
  factorConversionHidrometria, simularDespachoHorario, unidadesMinimasParaPotencia, repartoPorUnidad,
} from "./modelo.js";
import { evaluarAlertas } from "./alertas.js";

const URL_API = "https://api.anthropic.com/v1/messages";
const MODELOS = [
  ["claude-sonnet-5-5", "Claude Sonnet 5.5 (recomendado)"],
  ["claude-haiku-5-5", "Claude Haiku 5.5 (más rápido y económico)"],
  ["claude-opus-5-5", "Claude Opus 5.5 (más capaz, más costoso)"],
];
const MAX_VUELTAS = 8;

const r = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const pct = (g) => (g == null || !(g > 0) ? null : r(pctFromDeg(g), 1));

const SISTEMA = `Eres el asistente de operación de la central hidroeléctrica Ituango (EPM) dentro de la app "Turbinas Ituango". Respondes en español, breve y concreto, a ingenieros de operación.
Reglas:
- No inventes cifras. Toda cifra de operación sale de una herramienta; si no hay dato, dilo. Cita la hora del dato (hora de Colombia).
- Cuando calcules algo con un modelo (apertura, caudal del modelo, simulación de nivel), dilo: es una estimación.
- Conceptos de la app:
  * Caudal regulado (Hidrometría) = potencia en bornes / F.C. El F.C. es 1,62 hasta el 29-oct-2026 14:35; desde entonces 0,0119·nivel − 3,178 (nivel entre 390 y 420 msnm) y 1,80 fuera de ese rango.
  * Regla operativa de la Res. ANLA 1891: el promedio diario del caudal regulado debe quedar dentro del promedio del día anterior ±4,70 %. Si en el día hay vertimiento (> 1 m³/s), la regla queda en excepción.
  * Banda operativa de la generación: el Promedio RT de cada hora debe quedar dentro del despacho de XM ±5 %.
  * Apertura del distribuidor: 100 % = 30,2° (límite ampliado), 97 % = 29,29° (techo de operación normal; el 3 % restante es reserva para frecuencia), 87,7 % = 26,5° (límite original). LoggerNet no mide la apertura: la app la estima con el modelo de la colina (ensayo 2013) a partir de la potencia medida.
  * El caudal Winter-Kennedy (WK) de cada unidad NO está calibrado: solo sirve como índice relativo entre unidades.
  * Hoy operan U1–U4 (almenara N°1); U5–U8 entran desde 2028. Potencia máxima garantizada: 307 MW en el eje por unidad. NAMO ${NAMO} msnm.
- Si te piden una decisión operativa, entrega los números y las opciones; la decisión es del ingeniero.`;

const HERRAMIENTAS = [
  { name: "estado_actual", description: "Estado en vivo de la central con el último dato de LoggerNet: nivel y su tendencia, potencia y caudal por unidad, apertura estimada por unidad, vertedero, caudal descargado, entrada al embalse de hoy, regla 1891 del día (promedio, banda, lo requerido el resto del día, cierre si sigue como la última hora), nivel estimado a las 24:00, pronóstico de HydroForecast para hoy y alertas activas.", input_schema: { type: "object", properties: {} } },
  { name: "historico_diario", description: "Resumen diario del histórico entre dos fechas (máximo 120 días): regla 1891 (promedio regulado, banda, estado), nivel (inicio, fin, mín., máx.), energía, potencia media, vertimiento, caudal descargado, caudal de entrada (balance de masa) y, por unidad, horas en línea, energía, arranques, potencia media y máxima.", input_schema: { type: "object", properties: { desde: { type: "string", description: "AAAA-MM-DD" }, hasta: { type: "string", description: "AAAA-MM-DD" } }, required: ["desde", "hasta"] } },
  { name: "serie_horaria", description: "Promedios horarios entre dos fechas (máximo 14 días): nivel, caudal regulado, vertedero, descargado, F.C. y, por unidad, potencia, fracción de la hora en línea y apertura estimada (%).", input_schema: { type: "object", properties: { desde: { type: "string", description: "AAAA-MM-DD" }, hasta: { type: "string", description: "AAAA-MM-DD" } }, required: ["desde", "hasta"] } },
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
  const e = validarRango(desde, hasta, (ctx.limites && ctx.limites.historicoDias) || 120); if (e) return { error: e };
  const anios = [...new Set([desde.slice(0, 4), hasta.slice(0, 4)])];
  const partes = await Promise.all(anios.map((a) => ctx.leerJSON(`derivados/diario/${a}.json`).catch(() => null)));
  const dias = partes.filter(Boolean).flatMap((p) => p.dias).filter((d) => d.dia >= desde && d.dia <= hasta).sort((a, b) => (a.dia < b.dia ? -1 : 1));
  return {
    nota: "parcial = día incompleto en los datos (o día en curso).",
    dias: dias.map((d) => ({
      dia: d.dia, parcial: d.parcial,
      regla: { promedio_regulado_m3s: r(d.regla.qReg, 2), banda_min: d.regla.banda ? r(d.regla.banda.min, 2) : null, banda_max: d.regla.banda ? r(d.regla.banda.max, 2) : null, estado: d.regla.estado },
      nivel: d.nivel ? { ini: r(d.nivel.ini, 3), fin: r(d.nivel.fin, 3), min: r(d.nivel.min, 3), max: r(d.nivel.max, 3) } : null,
      energia_mwh: r(d.energia, 0), potencia_media_mw: r(d.pMedia, 1), fc: r(d.fc, 4),
      vertedero: d.vertedero ? { q_media: r(d.vertedero.qMedia, 1), q_max: r(d.vertedero.qMax, 1), con_vertimiento: d.vertedero.conVertimiento } : null,
      descargado_q_media: d.descargado ? r(d.descargado.qMedia, 1) : null, entrada_q_m3s: d.balance ? r(d.balance.qEntrada, 1) : null,
      unidades: (d.unidades || []).map((u, i) => ({ unidad: `U${i + 1}`, horas: r(u.horas, 1), energia_mwh: r(u.energia, 0), arranques: u.arranques, p_media_mw: r(u.pMedia, 1), p_max_mw: r(u.pMax, 1) })),
    })),
  };
}

async function serieHorariaHerr(ctx, { desde, hasta }) {
  const e = validarRango(desde, hasta, (ctx.limites && ctx.limites.horariaDias) || 14); if (e) return { error: e };
  const meses = [...new Set([desde.slice(0, 7), hasta.slice(0, 7)])];
  const partes = await Promise.all(meses.map((m) => ctx.leerJSON(`derivados/horario/${m}.json`).catch(() => null)));
  const filas = [];
  for (const p of partes.filter(Boolean)) p.t.forEach((t, i) => {
    if (t.slice(0, 10) < desde || t.slice(0, 10) > hasta) return;
    filas.push({
      t, nivel: r(p.nivel[i], 3), q_regulado: r(p.qReg[i], 1), vertedero: r(p.qVert[i], 1), descargado: r(p.qDesc[i], 1), fc: r(p.fc[i], 4),
      p_mw: (p.p[i] || []).map((x) => r(x, 1)), en_linea: (p.linea[i] || []).map((x) => r(x, 2)), apertura_pct: p.gamma ? (p.gamma[i] || []).map(pct) : null,
    });
  });
  // Horas de hoy (aún no en el histórico)
  const v = ctx.vivo;
  if (v && v.resHoy && hasta >= v.hoy) {
    const ya = new Set(filas.map((x) => x.t));
    v.resHoy.horas.forEach((h) => { if (h && !ya.has(h.t)) filas.push({ t: h.t, nivel: r(h.nivel, 3), q_regulado: r(h.qReg, 1), vertedero: r(h.qVert, 1), descargado: r(h.qDesc, 1), fc: r(h.fc, 4), p_mw: h.p.map((x) => r(x, 1)), en_linea: h.linea, apertura_pct: (h.gamma || []).map(pct) }); });
  }
  return { nota: "Hora = inicio de la hora (Colombia). apertura_pct estimada con el modelo; null = detenida o en arranque/parada.", horas: filas };
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
    horas: sim.detalle.map((d, i) => ({
      hora: i + 1, potencia_mw: d.potenciaMW, unidades: d.unidades, apertura_pct: pct(d.gamma), q_turbinado_m3s: r(d.qTurbinado, 1),
      q_regulado_hidrometria_m3s: d.potenciaMW > 0 ? r(d.potenciaMW / factorConversionHidrometria(d.Hinicio, t0 || "2099-01-01 00:00"), 1) : 0,
      nivel_fin_msnm: r(d.Hfin, 3), alcanzable: d.alcanzable || d.potenciaMW === 0,
    })),
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
  historico_diario: historicoDiario,
  serie_horaria: serieHorariaHerr,
  pronostico_caudal: (ctx) => pronosticoCaudal(ctx),
  simular_nivel: simularNivel,
  punto_operacion: puntoOperacion,
};

async function ejecutarHerramienta(ctx, nombre, entrada) {
  const f = EJECUTORES[nombre];
  if (!f) return { error: `Herramienta desconocida: ${nombre}` };
  try { return await f(ctx, entrada || {}); } catch (e) { return { error: String(e && e.message ? e.message : e) }; }
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

/* También sirve para un servicio en la nube compatible con OpenAI (p. ej. Groq): url = base sin /v1, clave = Bearer. */
async function preguntarLocal({ url, modelo, historial, ctx, onPaso = () => {}, fetchFn = fetch, senal, clave = null, esperar429 = 0 }) {
  const base = baseLocal(url);
  if (!modelo) throw new Error("Elija un modelo local (botón «Probar conexión»).");
  const sistema = { role: "system", content: `${SISTEMA}\nFecha y hora actual (Colombia): ${ctx.ahora || "desconocida"}.\nPara cualquier cifra de operación, llama primero a la herramienta que corresponda.` };
  const mensajes = historial.slice();
  for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
    let resp, cuerpo;
    for (let intento = 0; ; intento++) {
      try {
        resp = await fetchFn(`${base}/v1/chat/completions`, {
          method: "POST", signal: senal, headers: { "content-type": "application/json", ...(clave ? { Authorization: `Bearer ${clave}` } : {}) },
          body: JSON.stringify({ model: modelo, messages: [sistema, ...mensajes], tools: HERRAMIENTAS_OPENAI, stream: false, temperature: 0.2 }),
        });
      } catch (e) { throw clave ? new Error(`No se pudo conectar con ${base}.`) : errorConexionLocal(base, e); }
      cuerpo = await resp.json().catch(() => null);
      // Límite por minuto del plan gratuito: esperar lo que pide el servicio y reintentar (hasta 2 veces)
      const espera = resp.status === 429 ? Number(resp.headers && resp.headers.get ? resp.headers.get("retry-after") : NaN) : NaN;
      if (resp.status === 429 && intento < 2 && esperar429 > 0 && Number.isFinite(espera) && espera <= esperar429) { await new Promise((ok) => setTimeout(ok, (espera + 1) * 1000)); continue; }
      break;
    }
    if (!resp.ok) {
      const msg = cuerpo && cuerpo.error ? cuerpo.error.message || cuerpo.error : `HTTP ${resp.status}`;
      if (clave && resp.status === 401) throw new Error("La clave del servicio no es válida (401).");
      if (clave && resp.status === 429) throw new Error(`Se alcanzó el límite gratuito del servicio (por minuto o por día). Intente en unos minutos. (${msg})`);
      if (clave && resp.status === 413) throw new Error(`La consulta quedó muy grande para el límite gratuito; pida un periodo más corto. (${msg})`);
      throw new Error(/not found/i.test(String(msg)) ? `El modelo «${modelo}» no está descargado en Ollama (ollama pull ${modelo}).` : /does not support tools/i.test(String(msg)) ? `El modelo «${modelo}» no admite herramientas; use uno con «tools», p. ej. qwen3:8b.` : `Error del modelo${clave ? "" : " local"}: ${msg}`);
    }
    const m = cuerpo && cuerpo.choices && cuerpo.choices[0] ? cuerpo.choices[0].message : null;
    if (!m) throw new Error("Respuesta vacía del modelo local.");
    const llamadas = Array.isArray(m.tool_calls) ? m.tool_calls : [];
    mensajes.push({ role: "assistant", content: m.content || "", ...(llamadas.length ? { tool_calls: llamadas } : {}) });
    const uso = cuerpo.usage ? { input_tokens: cuerpo.usage.prompt_tokens, output_tokens: cuerpo.usage.completion_tokens } : null;
    if (!llamadas.length) return { mensajes, uso, texto: limpiarRazonamiento(m.content) };
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

export { MODELOS, HERRAMIENTAS, SISTEMA, ejecutarHerramienta, preguntar, preguntarLocal, preguntarGitHub, idPregunta, rutaRespuesta, listarModelosLocales, limpiarRazonamiento, URL_LOCAL_DEFECTO };
