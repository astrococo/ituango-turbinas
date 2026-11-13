import { describe, it, expect } from "vitest";
import {
  capacidadNominalMW, capacidadDemostrada, resumenIndicadores, indicadoresMensuales, energiaEmbalsada, caudalesDiarios,
  aportesMensuales, caudalMedioAnual, sostenibilidad, energiaVertidaMWh, CAPACIDAD_DISENO_MW,
} from "../src/indicadores.js";
import { volumenUtilHm3, NAMO } from "../src/modelo.js";

const dia = (d, { energia = 24000, pMedia = 1000, horas = [24, 24, 24, 24], arranques = [0, 0, 0, 0], volHm3 = 0, fc = 1.8, parcial = false } = {}) => ({
  dia: d, parcial, energia, pMedia, fc, vertedero: { volHm3, conVertimiento: volHm3 > 0 },
  unidades: horas.map((h, i) => ({ horas: h, energia: (energia / 4) * (h / 24), arranques: arranques[i] })),
});

describe("indicadores de la central", () => {
  it("capacidad nominal en operación y de diseño", () => {
    expect(capacidadNominalMW("2026-11-12")).toBe(1200);
    expect(CAPACIDAD_DISENO_MW).toBe(2400);
  });
  it("factor de planta nominal y real, horas equivalentes y solo días completos", () => {
    const dias = [dia("2026-10-01", { energia: 14400 }), dia("2026-10-02", { energia: 28800, pMedia: 1200 }), dia("2026-10-03", { energia: 5000, parcial: true })];
    const cap = capacidadDemostrada(dias);
    expect(cap).toEqual({ mw: 1200, dia: "2026-10-02" });
    const r = resumenIndicadores(dias, { capacidadReal: 1250 });
    expect(r.dias).toBe(2);
    expect(r.diasIncompletos).toBe(1);
    expect(r.fpNominal).toBeCloseTo((43200 / (1200 * 48)) * 100, 6); // 75 %
    expect(r.fpReal).toBeCloseTo((43200 / (1250 * 48)) * 100, 6);
    expect(r.horasEquivalentes).toBeCloseTo(36, 6);
  });
  it("la capacidad demostrada exige todas las unidades el día completo", () => {
    expect(capacidadDemostrada([dia("2026-10-01", { pMedia: 1300, horas: [24, 24, 24, 10] })])).toBeNull();
  });
  it("energía equivalente vertida = volumen × F.C. / 3600", () => {
    expect(energiaVertidaMWh(dia("2026-10-01", { volHm3: 1, fc: 1.8 }))).toBeCloseTo(500, 6);
    const r = resumenIndicadores([dia("2026-10-01", { volHm3: 1, fc: 1.8 })]);
    expect(r.vertidaPct).toBeCloseTo((500 / 24000) * 100, 6);
    expect(r.diasConVertimiento).toBe(1);
  });
  it("tiempo en línea y arranques por unidad", () => {
    const r = resumenIndicadores([dia("2026-10-01", { horas: [24, 12, 0, 24], arranques: [0, 1, 0, 2] })]);
    expect(r.unidades.map((u) => Math.round(u.pctTiempo))).toEqual([100, 50, 0, 100]);
    expect(r.unidades.map((u) => u.arranques)).toEqual([0, 1, 0, 2]);
  });
  it("mes a mes", () => {
    const m = indicadoresMensuales([dia("2026-09-30"), dia("2026-10-01"), dia("2026-10-02")]);
    expect(m.map((x) => [x.mes, x.dias])).toEqual([["2026-09", 1], ["2026-10", 2]]);
  });
  it("energía embalsada útil", () => {
    const e = energiaEmbalsada(NAMO, "2026-11-12 12:00");
    expect(e.pctUtil).toBeCloseTo(100, 6);
    expect(e.gwh).toBeCloseTo((volumenUtilHm3(NAMO) * 1e6 * e.fc) / 3600 / 1000, 6);
    expect(energiaEmbalsada(390).gwh).toBe(0);
  });
  it("aportes frente a la media del mismo mes en años anteriores con el mes completo", () => {
    const csv = ["Fecha,CaudalOlaya_mean,CaudalSitioPresa_mean",
      ...Array.from({ length: 30 }, (_, i) => `2024-11-${String(i + 1).padStart(2, "0")},1000,`),
      ...Array.from({ length: 30 }, (_, i) => `2025-11-${String(i + 1).padStart(2, "0")},600,`),
      ...Array.from({ length: 10 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")},400,`),
    ].join("\n");
    const d = caudalesDiarios(csv, { data: [{ timestamp: "2026-11-11T00:00:00", QOlaya_obs: 400 }] });
    const a = aportesMensuales(d.olaya);
    const nov26 = a.find((x) => x.mes === "2026-11");
    expect(nov26.dias).toBe(11);
    expect(nov26.media).toBeCloseTo(800, 6);
    expect(nov26.pct).toBeCloseTo(50, 6);
    expect(a.find((x) => x.mes === "2024-11").media).toBeUndefined(); // sin años anteriores
  });
  it("sostenibilidad: densidad de potencia, DOR y tiempo de residencia", () => {
    const s = sostenibilidad({ nivel: 419.85, caudalEntrada: 671, qMedioAnual: { q: 1000, desde: "2017", hasta: "2025" }, capacidadMW: 1200 });
    expect(s.areaNAMOKm2).toBeGreaterThan(20);
    expect(s.densidad).toBeCloseTo(1200 / s.areaNAMOKm2, 6); // MW/km² = W/m²
    expect(s.densidadDiseno).toBeCloseTo(2 * s.densidad, 6);
    expect(s.dorTotal).toBeGreaterThan(s.dorUtil);
    expect(s.residenciaDias).toBeGreaterThan(s.residenciaMediaDias);
    expect(caudalMedioAnual(new Map([["2020-01-01", 1]]))).toBeNull(); // año incompleto
  });
});
