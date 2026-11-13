import { describe, it, expect } from "vitest";
import { calibrarDescarga, condicionCalibrada, filasHorario, horasEstables } from "../src/calibracion.js";
import { repartoPorUnidad, condicionVigente, etiquetaCondicionDescarga, CONDICION_DESCARGA_DEFECTO, GAMMA_ENSAYADO_MAX } from "../src/modelo.js";

/* Horas sintéticas generadas con el propio modelo a un nivel de almenara
   conocido: la calibración debe recuperarlo. */
function horasSinteticas(nivelAlm, { n = 24, sesgoWK = 0, desde = "2026-11-05" } = {}) {
  const cond = { modo: "manual", almManual: { norte: nivelAlm, sur: nivelAlm } };
  return Array.from({ length: n }, (_, i) => {
    const nivel = 414 + (i % 6), p = [250 + (i % 5) * 10, 240, 0, 260];
    const res = repartoPorUnidad(nivel, p, { cond, gammaMax: GAMMA_ENSAYADO_MAX, potenciaMaxMW: null });
    const q = res.porUnidad.slice(0, 4).map((u, k) => (p[k] > 0 ? u.q : null));
    return { t: `${desde} ${String(i % 24).padStart(2, "0")}:00`, nivel, p, linea: p.map((x) => (x > 0 ? 1 : 0)), qFC: q, qWK: q.map((x) => (x == null ? null : x * (1 + sesgoWK / 100))) };
  });
}

describe("condición de descarga calibrada", () => {
  it("recupera el nivel de almenara con el que se generaron los caudales", () => {
    const c = calibrarDescarga(horasSinteticas(221.3));
    expect(c.nivelAlmenara).toBeCloseTo(221.3, 1);
    expect(Math.abs(c.hidrometria.sesgo)).toBeLessThan(0.05);
    expect(Math.abs(c.wk.sesgo)).toBeLessThan(0.05);
  });
  it("con referencias que discrepan toma el punto medio", () => {
    const c = calibrarDescarga(horasSinteticas(221, { sesgoWK: 1.2 }));
    expect(c.nivelHidrometria).toBeCloseTo(221, 1);
    expect(c.nivelWK).toBeGreaterThan(c.nivelHidrometria); // a igual potencia, más caudal medido → menos salto → almenara más alta
    expect(c.nivelAlmenara).toBeCloseTo((c.nivelHidrometria + c.nivelWK) / 2, 1);
    expect(c.hidrometria.sesgo).toBeCloseTo(-c.wk.sesgo, 0);
  });
  it("sin horas de Hidrometría con la fórmula vigente no calibra (el WK solo no basta)", () => {
    expect(calibrarDescarga(horasSinteticas(221, { desde: "2026-10-20" }))).toBeNull();
    expect(calibrarDescarga(horasSinteticas(221, { n: 6 }))).toBeNull();
  });
  it("descarta horas con unidades en línea solo parte de la hora", () => {
    const h = horasSinteticas(221, { n: 2 });
    h[1].linea = [1, 0.5, 0, 1];
    expect(horasEstables(h)).toHaveLength(1);
  });
  it("condición, etiqueta y condición vigente", () => {
    const cal = calibrarDescarga(horasSinteticas(220.5));
    const cond = condicionCalibrada(cal);
    expect(cond.modo).toBe("manual");
    expect(cond.almManual.norte).toBe(cond.almManual.sur);
    expect(etiquetaCondicionDescarga(cond)).toMatch(/calibrada con Hidrometría y Winter-Kennedy: almenara equivalente 220,5\d msnm/);
    expect(condicionVigente({ condicionModelo: cond })).toBe(cond);
    expect(condicionVigente({ condicionModelo: CONDICION_DESCARGA_DEFECTO })).toBe(CONDICION_DESCARGA_DEFECTO);
    expect(condicionVigente(null)).toBe(CONDICION_DESCARGA_DEFECTO);
  });
  it("lee el horario por columnas", () => {
    const f = filasHorario({ t: ["a", "b"], nivel: [1, 2], qDesc: [3, 4], p: [[1], [2]], qFC: [[5], [6]], qWK: [[7], [8]], linea: [[1], [0]] });
    expect(f[1]).toEqual({ t: "b", nivel: 2, qDesc: 4, p: [2], qFC: [6], qWK: [8], linea: [0] });
  });
});
