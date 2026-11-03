import { describe, it, expect } from "vitest";
import { evaluarAlertas, compararAlertas } from "../src/alertas.js";
import { degFromPct } from "../src/modelo.js";

/* Estados sintéticos (sin cifras de operación). */
const base = () => ({
  hoy: "2026-11-20", edadMin: 10, ultima: { t: "2026-11-20 10:05" },
  actual: { nivel: 410, qVert: 0 }, tendencia: [{}, {}, { cmPorHora: 0 }, {}], horasANAMO: null,
  banda: { min: 95.3, max: 104.7 }, restoMin: 830,
  requerido: { qMin: 90, qMax: 110, pMin: 150, pMax: 180, qCapacidad: 700, superaCapacidad: false, yaPorEncima: false },
  cierreSiSigue: 100, resHoy: { regla: { estado: "cumple", qReg: 100 }, horas: [] },
});
const ids = (v) => evaluarAlertas(v).map((x) => x.id);

describe("agente de vigilancia", () => {
  it("sin novedades no hay alertas", () => { expect(ids(base())).toEqual([]); });
  it("dato atrasado: aviso > 90 min, crítico > 180 min", () => {
    expect(evaluarAlertas({ ...base(), edadMin: 120 })[0]).toMatchObject({ id: "dato_atrasado", nivel: "aviso" });
    expect(evaluarAlertas({ ...base(), edadMin: 200 })[0]).toMatchObject({ id: "dato_atrasado", nivel: "critico" });
  });
  it("regla 1891: ya por encima, capacidad y cierre proyectado", () => {
    expect(ids({ ...base(), requerido: { ...base().requerido, yaPorEncima: true } })).toContain("regla_por_encima");
    expect(ids({ ...base(), requerido: { ...base().requerido, superaCapacidad: true } })).toContain("regla_capacidad");
    expect(ids({ ...base(), cierreSiSigue: 106 })).toContain("cierre_encima");
    expect(ids({ ...base(), cierreSiSigue: 90 })).toContain("cierre_debajo");
    // en excepción (vertimiento) la regla no se evalúa
    expect(ids({ ...base(), cierreSiSigue: 106, resHoy: { regla: { estado: "excepcion" }, horas: [] } })).not.toContain("cierre_encima");
  });
  it("vertimiento por encima de 1 m³/s", () => {
    expect(ids({ ...base(), actual: { nivel: 410, qVert: 0.8 } })).not.toContain("vertimiento");
    expect(ids({ ...base(), actual: { nivel: 410, qVert: 5 } })).toContain("vertimiento");
  });
  it("nivel: sobre el NAMO crítico; < 24 h para llegar, aviso", () => {
    expect(evaluarAlertas({ ...base(), actual: { nivel: 420.2, qVert: 0 } })[0]).toMatchObject({ id: "nivel_namo", nivel: "critico" });
    expect(ids({ ...base(), horasANAMO: 12, tendencia: [{}, {}, { cmPorHora: 5 }, {}] })).toContain("nivel_sube");
    expect(ids({ ...base(), horasANAMO: 30 })).not.toContain("nivel_sube");
  });
  it("apertura de la última hora cerrada: > 97 % aviso, > 100 % crítico", () => {
    const horas = Array(24).fill(null);
    horas[8] = { t: "2026-11-20 08:00", gamma: [degFromPct(96), degFromPct(98), degFromPct(101), null], p: [1, 2, 3, 0] };
    horas[9] = { t: "2026-11-20 09:00", gamma: [degFromPct(96), degFromPct(98), degFromPct(101), null], p: [1, 2, 3, 0] };
    horas[10] = { t: "2026-11-20 10:00", gamma: [degFromPct(110), null, null, null], p: [1, 0, 0, 0] }; // hora en curso: no cuenta
    const a = evaluarAlertas({ ...base(), resHoy: { regla: { estado: "cumple", qReg: 100 }, horas } });
    expect(a.find((x) => x.id === "apertura_u1")).toBeUndefined();
    expect(a.find((x) => x.id === "apertura_u2").nivel).toBe("aviso");
    expect(a.find((x) => x.id === "apertura_u3").nivel).toBe("critico");
    expect(a[0].nivel).toBe("critico"); // ordenadas por gravedad
  });
  it("notifica solo lo nuevo y no repite antes de 6 h", () => {
    const n1 = [{ id: "vertimiento", nivel: "aviso", titulo: "V", detalle: "" }];
    const r1 = compararAlertas(n1, null, "2026-11-20 10:00");
    expect(r1.aNotificar.map((x) => x.id)).toEqual(["vertimiento"]);
    const r2 = compararAlertas(n1, { alertas: r1.alertas, notificadas: r1.notificadas }, "2026-11-20 11:00");
    expect(r2.aNotificar).toEqual([]);
    expect(r2.alertas[0].desde).toBe("2026-11-20 10:00");
    const r3 = compararAlertas([], { alertas: r2.alertas, notificadas: r2.notificadas }, "2026-11-20 12:00");
    expect(r3.resueltas.map((x) => x.id)).toEqual(["vertimiento"]);
    const r4 = compararAlertas(n1, { alertas: r3.alertas, notificadas: r3.notificadas }, "2026-11-20 13:00");
    expect(r4.aNotificar).toEqual([]); // reaparece antes de 6 h: no se repite el aviso
    const r5 = compararAlertas(n1, { alertas: [], notificadas: r4.notificadas }, "2026-11-20 16:30");
    expect(r5.aNotificar.map((x) => x.id)).toEqual(["vertimiento"]);
  });
});
