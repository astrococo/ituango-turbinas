import { describe, it, expect } from "vitest";
import { calcularVivo } from "../src/datos/vivo.jsx";
import { leerLoggerNet, unirNivel } from "../src/operacion.js";
import { resumirDias, filaDiaria, requeridoRestoDelDia, cierreProyectado, validarDespachoDia, aperturaIntervalos, resumenHora, serieHoraria } from "../src/analitica.js";
import { pctFromDeg, degFromPct, CONDICION_DESCARGA_DEFECTO } from "../src/modelo.js";
import { ejecutarHerramienta, preguntar, HERRAMIENTAS } from "../src/asistente.js";

/* Datos sintéticos (sin cifras de operación): dos días de 4 unidades. */
function csvGen(dia, pU) {
  const cab = "timestamp,GeneracionU1_MW_Avg,GeneracionU2_MW_Avg,GeneracionU3_MW_Avg,GeneracionU4_MW_Avg,QTurbinadoU1_FC_Avg,QTurbinadoU2_FC_Avg,QTurbinadoU3_FC_Avg,QTurbinadoU4_FC_Avg,QTurbinado_U1_Avg,QTurbinado_U2_Avg,QTurbinado_U3_Avg,QTurbinado_U4_Avg,Caudal_Total_Avg";
  const l = [cab];
  for (let m = 0; m < 1440; m++) {
    const t = `${dia} ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    l.push([t, ...pU, ...pU.map((p) => (p / 1.8).toFixed(3)), ...pU.map((p, u) => (p / (1.7 + 0.05 * u)).toFixed(3)), 0].join(","));
  }
  return l.join("\n");
}
function csvNivel(dia, n0, dn) {
  const l = ["timestamp,Nivel_Radar_msnm_Avg"];
  for (let m = 0; m < 1440; m += 5) l.push(`${dia} ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")},${(n0 + (dn * m) / 1440).toFixed(4)}`);
  return l.join("\n");
}

describe("analítica y estado en vivo", () => {
  const g1 = leerLoggerNet(csvGen("2026-11-10", [200, 200, 200, 0])).filas;
  const g2 = leerLoggerNet(csvGen("2026-11-11", [205, 205, 205, 0])).filas;
  const n1 = leerLoggerNet(csvNivel("2026-11-10", 410, 0.2)).filas;
  const n2 = leerLoggerNet(csvNivel("2026-11-11", 410.2, 0.2)).filas;
  const filas = unirNivel([...g1, ...g2], [...n1, ...n2]).filas;
  const dias = resumirDias(filas, { conModelo: false });

  it("regla diaria: promedio, banda del día anterior y estado", () => {
    expect(dias).toHaveLength(2);
    const fc1 = 0.0119 * 410.1 - 3.178; // F.C. medio aprox. del primer día
    expect(dias[0].regla.qReg).toBeGreaterThan(600 / (fc1 + 0.01));
    expect(dias[0].regla.estado).toBe("sin_base");
    expect(dias[1].regla.banda.min).toBeCloseTo(dias[0].regla.qReg * 0.953, 1);
    expect(dias[1].regla.estado).toBe("cumple");
  });
  it("F.C. Winter-Kennedy por unidad (P / Q_WK) y unidad detenida sin índice", () => {
    expect(dias[0].unidades[0].fcWK).toBeCloseTo(1.7, 2);
    expect(dias[0].unidades[2].fcWK).toBeCloseTo(1.8, 2);
    expect(dias[0].unidades[3].fcWK).toBeNull();
    expect(dias[0].unidades[3].horas).toBe(0);
  });
  it("lo que debe promediar el resto del día para cerrar en la banda", () => {
    const r = requeridoRestoDelDia(500, 720, { min: 476.5, max: 523.5 }, 1.8);
    expect(r.qMin).toBeCloseTo(453, 0);
    expect(r.qMax).toBeCloseTo(547, 0);
    expect(r.pMax).toBeCloseTo(547 * 1.8, 0);
    expect(cierreProyectado(500, 720, 520)).toBeCloseTo(510, 6);
  });
  it("calcularVivo arma el día en curso con la banda de ayer", () => {
    const v = calcularVivo({ hoy: "2026-11-11", ayer: "2026-11-10", filas, diario: [filaDiaria(dias[0])], errores: [], hf: {} });
    expect(v.resHoy.dia).toBe("2026-11-11");
    expect(v.banda.base).toBeCloseTo(dias[0].regla.qReg, 6);
    expect(v.actual.pTotal).toBeCloseTo(615, 6);
    expect(v.tendencia[0].cmPorHora).toBeGreaterThan(0);
    expect(v.indiceUnidades[0].factor).toBeLessThan(v.indiceUnidades[2].factor);
  });
});

describe("calidad y validación por día", () => {
  const g = leerLoggerNet(csvGen("2026-11-20", [200, 200, 0, 0])).filas.filter((r) => !(r.t >= "2026-11-20 10:00" && r.t < "2026-11-20 10:30"));
  const n = leerLoggerNet(csvNivel("2026-11-20", 410, 0.1)).filas;
  const filas = unirNivel(g, n).filas;
  const [dia] = resumirDias(filas, { conModelo: false });
  it("cuenta minutos y el hueco más largo", () => {
    expect(dia.calidad.minutosGen).toBe(1410);
    expect(dia.calidad.maxHuecoMin).toBe(30);
    expect(dia.calidad.vertedero).toBeNull();
  });
  it("la columna de LoggerNet hecha con 1,8 no coincide con la regla por nivel", () => {
    expect(dia.calidad.columnaFC.minutos).toBe(1410);
    expect(dia.calidad.columnaFC.coinciden).toBe(0);
  });
  it("no valida el despacho con un día incompleto", () => {
    expect(validarDespachoDia({ ...dia, parcial: true })).toBeNull();
  });
  it("apertura estimada: intervalos de 15 min iguales al cálculo horario y equivalencia en %", () => {
    const hora = filas.filter((r) => r.t.startsWith("2026-11-20 08:"));
    const iv = aperturaIntervalos(hora, 4, { minutos: 15, cond: CONDICION_DESCARGA_DEFECTO });
    expect(iv).toHaveLength(4);
    expect(iv[0].t).toBe("2026-11-20 08:00");
    expect(iv[1].t).toBe("2026-11-20 08:15");
    const ref = resumenHora("2026-11-20 08:00", hora.slice(0, 15), 4, { cond: CONDICION_DESCARGA_DEFECTO });
    expect(iv[0].gamma[0]).toBe(ref.gamma[0]);
    expect(iv[0].gamma[0]).toBeGreaterThan(4.87);
    expect(iv[0].gamma[0]).toBeLessThan(31.98);
    expect(iv[0].gamma[3]).toBeNull(); // unidad detenida
    expect(pctFromDeg(30.2)).toBeCloseTo(100, 12);
    expect(degFromPct(97)).toBeCloseTo(29.294, 12);
    expect(pctFromDeg(26.5)).toBeCloseTo(87.748, 3);
  });
  it("serie horaria incluye la apertura por unidad", () => {
    const d = resumirDias(filas.filter((r) => r.t.startsWith("2026-11-20 0")), { cond: CONDICION_DESCARGA_DEFECTO });
    const s = serieHoraria(d);
    expect(s.gamma.length).toBe(s.t.length);
    expect(s.gamma[0][0]).toBeGreaterThan(0);
    expect(s.gamma[0][3]).toBeNull();
  });
});

describe("asistente: herramientas y bucle del agente (API simulada)", () => {
  const g1 = leerLoggerNet(csvGen("2026-11-10", [200, 200, 200, 0])).filas;
  const g2 = leerLoggerNet(csvGen("2026-11-11", [205, 205, 205, 0])).filas.filter((r) => r.t < "2026-11-11 12:00");
  const n1 = leerLoggerNet(csvNivel("2026-11-10", 410, 0.2)).filas;
  const n2 = leerLoggerNet(csvNivel("2026-11-11", 410.2, 0.2)).filas;
  const filas = unirNivel([...g1, ...g2], [...n1, ...n2]).filas;
  const dias = resumirDias(filas, { cond: CONDICION_DESCARGA_DEFECTO });
  const vivo = calcularVivo({ hoy: "2026-11-11", ayer: "2026-11-10", filas, diario: [filaDiaria(dias[0])], errores: [], hf: {} });
  const ctx = { vivo, leerJSON: async (ruta) => { if (ruta === "derivados/diario/2026.json") return { dias: dias.map(filaDiaria) }; throw new Error("404"); }, ahora: "2026-11-11 12:00" };

  it("cada herramienta responde sin error con datos sintéticos", async () => {
    const est = await ejecutarHerramienta(ctx, "estado_actual", {});
    expect(est.ultimo_dato).toBe("2026-11-11 11:59");
    expect(est.promedio_15_min.potencia_unidad_mw[0]).toBe(205);
    expect(est.apertura_ultima_hora_cerrada.por_unidad_pct[0]).toBeGreaterThan(0);
    expect(est.apertura_ultima_hora_cerrada.por_unidad_pct[3]).toBeNull();
    expect(est.regla_1891_hoy.banda_m3s.min).toBeCloseTo(dias[0].regla.qReg * 0.953, 1);
    const hist = await ejecutarHerramienta(ctx, "historico_diario", { desde: "2026-11-10", hasta: "2026-11-11" });
    expect(hist.dias.map((d) => d.dia)).toEqual(["2026-11-10", "2026-11-11"]);
    expect((await ejecutarHerramienta(ctx, "historico_diario", { desde: "2026-01-01", hasta: "2026-11-11" })).error).toMatch(/120/);
    const sim = await ejecutarHerramienta(ctx, "simular_nivel", { potencias_mw: [600, 600, 600], caudal_entrada_m3s: 300 });
    expect(sim.horas).toHaveLength(3);
    expect(sim.horas[0].unidades).toBe(2);
    expect(sim.nivel_final_msnm).toBeLessThan(sim.supuestos.nivel_inicial_msnm + 0.5);
    const pto = await ejecutarHerramienta(ctx, "punto_operacion", { nivel_msnm: 410, potencias_unidad_mw: [250, 250] });
    expect(pto.unidades).toHaveLength(2);
    expect(pto.unidades[0].apertura_pct).toBeCloseTo(pctFromDeg(pto.unidades[0].apertura_grados), 0);
    expect((await ejecutarHerramienta(ctx, "pronostico_caudal", {})).error).toBeTruthy();
    expect((await ejecutarHerramienta(ctx, "no_existe", {})).error).toMatch(/desconocida/);
    expect(HERRAMIENTAS.map((h) => h.name).sort()).toEqual(["estado_actual", "historico_diario", "pronostico_caudal", "punto_operacion", "serie_horaria", "simular_nivel"]);
  });

  it("bucle: pide una herramienta, recibe el resultado y responde", async () => {
    const llamadas = [];
    const respuestas = [
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "estado_actual", input: {} }], usage: { input_tokens: 1, output_tokens: 1 } },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Listo." }], usage: { input_tokens: 2, output_tokens: 1 } },
    ];
    const fetchFn = async (url, op) => { llamadas.push({ url, op, cuerpo: JSON.parse(op.body) }); return { ok: true, json: async () => respuestas[llamadas.length - 1] }; };
    const pasos = [];
    const res = await preguntar({ clave: "k", modelo: "claude-sonnet-5-5", historial: [{ role: "user", content: "¿cómo vamos?" }], ctx, fetchFn, onPaso: (p) => pasos.push(p.nombre) });
    expect(llamadas).toHaveLength(2);
    expect(llamadas[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(llamadas[0].op.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(llamadas[0].cuerpo.tools).toHaveLength(6);
    const resultado = llamadas[1].cuerpo.messages[2].content[0];
    expect(resultado.type).toBe("tool_result");
    expect(JSON.parse(resultado.content).ultimo_dato).toBe("2026-11-11 11:59");
    expect(pasos).toEqual(["estado_actual"]);
    expect(res.mensajes[res.mensajes.length - 1].content[0].text).toBe("Listo.");
  });

  it("clave inválida: mensaje claro", async () => {
    const fetchFn = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "invalid x-api-key" } }) });
    await expect(preguntar({ clave: "x", modelo: "m", historial: [{ role: "user", content: "hola" }], ctx, fetchFn })).rejects.toThrow(/401/);
  });
});

describe("asistente con modelo local (Ollama, API simulada)", () => {
  it("bucle en formato OpenAI: llamada a herramienta con argumentos en texto, respuesta sin <think>", async () => {
    const llamadas = [];
    const respuestas = [
      { choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "punto_operacion", arguments: "{\"nivel_msnm\": 410, \"potencias_unidad_mw\": [250]}" } }] } }], usage: { prompt_tokens: 10, completion_tokens: 2 } },
      { choices: [{ message: { role: "assistant", content: "<think>razono</think>\nApertura estimada lista." } }], usage: { prompt_tokens: 20, completion_tokens: 4 } },
    ];
    const fetchFn = async (url, op) => { llamadas.push({ url, cuerpo: JSON.parse(op.body) }); return { ok: true, json: async () => respuestas[llamadas.length - 1] }; };
    const { preguntarLocal } = await import("../src/asistente.js");
    const pasos = [];
    const res = await preguntarLocal({ url: "http://localhost:11434/", modelo: "qwen3:8b", historial: [{ role: "user", content: "¿apertura?" }], ctx: { vivo: null, leerJSON: async () => { throw new Error("x"); } }, fetchFn, onPaso: (p) => pasos.push(p) });
    expect(llamadas[0].url).toBe("http://localhost:11434/v1/chat/completions");
    expect(llamadas[0].cuerpo.tools[0].type).toBe("function");
    expect(llamadas[0].cuerpo.messages[0].role).toBe("system");
    expect(pasos[0]).toEqual({ nombre: "punto_operacion", entrada: { nivel_msnm: 410, potencias_unidad_mw: [250] } });
    const tool = llamadas[1].cuerpo.messages.find((m) => m.role === "tool");
    expect(tool.tool_call_id).toBe("c1");
    expect(JSON.parse(tool.content).unidades[0].apertura_pct).toBeGreaterThan(0);
    expect(res.texto).toBe("Apertura estimada lista.");
    expect(res.uso).toEqual({ input_tokens: 20, output_tokens: 4 });
  });
  it("errores claros: sin conexión, modelo no descargado, lista de modelos", async () => {
    const { preguntarLocal, listarModelosLocales } = await import("../src/asistente.js");
    const ctx = { vivo: null, leerJSON: async () => ({}) };
    await expect(preguntarLocal({ url: "http://localhost:11434", modelo: "m", historial: [], ctx, fetchFn: async () => { throw new TypeError("Failed to fetch"); } })).rejects.toThrow(/OLLAMA_ORIGINS/);
    await expect(preguntarLocal({ url: "http://localhost:11434", modelo: "qwen3:8b", historial: [], ctx, fetchFn: async () => ({ ok: false, status: 404, json: async () => ({ error: { message: "model \"qwen3:8b\" not found, try pulling it first" } }) }) })).rejects.toThrow(/ollama pull qwen3:8b/);
    expect(await listarModelosLocales("http://localhost:11434/v1", async (u) => { expect(u).toBe("http://localhost:11434/v1/models"); return { ok: true, json: async () => ({ data: [{ id: "qwen3:8b" }, { id: "llama3.1:8b" }] }) }; })).toEqual(["llama3.1:8b", "qwen3:8b"]);
  });
});

describe("asistente vía GitHub (despacho y respuesta simulados)", () => {
  it("envía el evento, espera el archivo de la rama asistente y devuelve la respuesta", async () => {
    const { preguntarGitHub, idPregunta, rutaRespuesta } = await import("../src/asistente.js");
    expect(idPregunta(new Date("2026-11-11T19:30:05Z"))).toMatch(/^20261111T143005-[a-z0-9]{6}$/);
    let carga = null, lecturas = 0;
    const datos = {
      despachar: async (ev, c) => { expect(ev).toBe("asistente"); carga = c; return true; },
      leerRama: async (ruta, rama) => { expect(rama).toBe("asistente"); expect(ruta).toBe(rutaRespuesta(carga.id)); lecturas++; return lecturas < 3 ? null : JSON.stringify({ id: carga.id, texto: "Listo.", pasos: [{ nombre: "estado_actual", entrada: {} }], modelo: "claude-sonnet-5-5", ultimoDato: "2026-11-11 14:25" }); },
    };
    const estados = [];
    const r = await preguntarGitHub({ datos, pregunta: "¿cómo vamos?", historial: [{ rol: "usuario", texto: "a" }, { rol: "asistente", texto: "b" }], modelo: "claude-sonnet-5-5", intervaloMs: 1, onEstado: (e) => estados.push(e.fase) });
    expect(carga.id).toMatch(/^\d{8}T\d{6}-[a-z0-9]{6}$/);
    expect(carga.historial).toHaveLength(2);
    expect(r.texto).toBe("Listo.");
    expect(r.pasos[0].nombre).toBe("estado_actual");
    expect(estados[0]).toBe("enviada");
  });
  it("propaga el error que deja el flujo y avisa si no llega a tiempo", async () => {
    const { preguntarGitHub } = await import("../src/asistente.js");
    const datos = (txt) => ({ despachar: async () => true, leerRama: async () => txt });
    await expect(preguntarGitHub({ datos: datos(JSON.stringify({ error: "Falta el secret ANTHROPIC_API_KEY" })), pregunta: "x", intervaloMs: 1 })).rejects.toThrow(/ANTHROPIC_API_KEY/);
    await expect(preguntarGitHub({ datos: datos(null), pregunta: "x", intervaloMs: 1, esperaMaxMs: 20 })).rejects.toThrow(/Actions/);
  });
});

describe("límites del servicio gratuito", () => {
  const ok = (texto) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ choices: [{ message: { role: "assistant", content: texto } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) });
  const lim = (msg) => ({ ok: false, status: 429, headers: { get: () => null }, json: async () => ({ error: { message: msg } }) });
  const ctx = { vivo: null, leerJSON: async () => ({}) };
  it("lee la espera del mensaje", async () => {
    const { segundosDeEspera } = await import("../src/asistente.js");
    expect(segundosDeEspera(null, "Please try again in 21.8325s.")).toBeCloseTo(21.8325);
    expect(segundosDeEspera(null, "try again in 1m3.5s")).toBeCloseTo(63.5);
    expect(segundosDeEspera({ headers: { get: () => "7" } }, "")).toBe(7);
  });
  it("cambia de modelo ante el límite por minuto y espera si todos están llenos", async () => {
    const { preguntarLocal } = await import("../src/asistente.js");
    const usados = []; const esperas = [];
    const seq = [lim("Rate limit reached on tokens per minute (TPM). Please try again in 10s."), lim("tokens per minute (TPM). Please try again in 4s."), ok("listo")];
    const fetchFn = async (u, op) => { usados.push(JSON.parse(op.body).model); return seq.shift(); };
    const r = await preguntarLocal({ url: "https://x/openai", clave: "k", modelo: "a", modelosAlternos: ["b"], esperar429: 120, historial: [{ role: "user", content: "hola" }], ctx, fetchFn, dormir: async (ms) => esperas.push(ms) });
    expect(usados).toEqual(["a", "b", "a"]);
    expect(esperas).toEqual([5000]); // espera la menor (4 s) + 1
    expect(r.texto).toBe("listo");
    expect(r.modelo).toBe("a");
  });
  it("cupo diario agotado: sigue con otro modelo y, si no queda ninguno, avisa", async () => {
    const { preguntarLocal } = await import("../src/asistente.js");
    const seq = [lim("Rate limit reached on tokens per day (TPD)"), ok("con b")];
    const r = await preguntarLocal({ url: "https://x/openai", clave: "k", modelo: "a", modelosAlternos: ["b"], esperar429: 60, historial: [{ role: "user", content: "x" }], ctx, fetchFn: async () => seq.shift(), dormir: async () => {} });
    expect(r.modelo).toBe("b");
    const seq2 = [lim("tokens per day (TPD)"), lim("requests per day (RPD)")];
    await expect(preguntarLocal({ url: "https://x/openai", clave: "k", modelo: "a", modelosAlternos: ["b"], esperar429: 60, historial: [{ role: "user", content: "x" }], ctx, fetchFn: async () => seq2.shift(), dormir: async () => {} })).rejects.toThrow(/cupo gratuito de hoy/);
  });
  it("si el servicio no acepta un parámetro opcional, reintenta sin él; el contexto va en la pregunta", async () => {
    const { preguntarLocal } = await import("../src/asistente.js");
    const cuerpos = [];
    const seq = [{ ok: false, status: 400, headers: { get: () => null }, json: async () => ({ error: { message: "unsupported parameter reasoning_effort" } }) }, ok("bien")];
    const r = await preguntarLocal({ url: "https://x/openai", clave: "k", modelo: "a", opciones: { reasoning_effort: "low" }, contexto: "{\"nivel\":419}", historial: [{ role: "user", content: "¿nivel?" }], ctx, fetchFn: async (u, op) => { cuerpos.push(JSON.parse(op.body)); return seq.shift(); } });
    expect(cuerpos[0].reasoning_effort).toBe("low");
    expect(cuerpos[1].reasoning_effort).toBeUndefined();
    expect(cuerpos[0].messages[1].content).toMatch(/Contexto ya consultado.*419/);
    expect(r.texto).toBe("bien");
  });
});
