import { describe, it, expect } from "vitest";
import { CURVA_EMBALSE_CGI, volumenTotalHm3, areaEmbalseKm2, volumenHm3, volumenUtilHm3, volumenExtrapolado, nivelDesdeVolumenExtrapolado, nivelDesdeVolumen, NAMO } from "../src/modelo.js";

/* Memoria CGI I-M-2194-044-HID-VC-CVE-001 (2022): Tabla 3 (LIDAR 2012) y Ec.2 (2021) */
describe("curvas oficiales del embalse", () => {
  it("la Ec.2 reproduce los 46 puntos de volumen de la Tabla 3 (Tabla 5: error 0,00 %)", () => {
    expect(CURVA_EMBALSE_CGI).toHaveLength(46);
    for (const [c, , v] of CURVA_EMBALSE_CGI) expect(Math.abs(volumenTotalHm3(c) - v)).toBeLessThan(0.01);
  });
  it("es continua entre tramos y creciente", () => {
    for (const b of [220, 225, 255, 295, 330, 350, 380, 400, 415]) expect(Math.abs(volumenTotalHm3(b + 1e-7) - volumenTotalHm3(b))).toBeLessThan(0.001);
    let prev = -1;
    for (let h = 219; h <= 460; h += 0.05) { const v = volumenTotalHm3(h); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
  });
  it("volúmenes característicos de la Figura 4 (2.561, 965, 856 y 740 hm³)", () => {
    expect(Math.round(volumenTotalHm3(420))).toBe(2561);
    expect(Math.round(volumenUtilHm3(NAMO))).toBe(965);
    expect(Math.round(volumenTotalHm3(390) - volumenTotalHm3(350))).toBe(856);
    expect(Math.round(volumenTotalHm3(350))).toBe(740);
  });
  it("área: Tabla 3 interpolada y coherente con la pendiente del volumen", () => {
    expect(areaEmbalseKm2(420)).toBeCloseTo(37.9405, 4);
    expect(areaEmbalseKm2(417.5)).toBeCloseTo((35.5446 + 37.9405) / 2, 4);
    for (const c of [300, 350, 390, 400, 410, 420]) {
      const pendiente = (volumenTotalHm3(c + 0.05) - volumenTotalHm3(c - 0.05)) / 0.1; // hm³/m = km²
      expect(Math.abs(pendiente / areaEmbalseKm2(c) - 1)).toBeLessThan(0.012);
    }
  });
  it("las funciones de la app: topadas entre 390 y 420, sin topar sobre el NAMO, e inversas", () => {
    expect(volumenHm3(380)).toBeCloseTo(volumenTotalHm3(390), 9);
    expect(volumenHm3(425)).toBeCloseTo(volumenTotalHm3(420), 9);
    expect(volumenExtrapolado(430)).toBeCloseTo(2963.087, 2);
    for (const h of [391.3, 405.5, 419.9, 425, 432.5]) expect(nivelDesdeVolumenExtrapolado(volumenExtrapolado(h))).toBeCloseTo(h, 6);
    expect(nivelDesdeVolumen(volumenTotalHm3(410))).toBeCloseTo(410, 6);
  });
});
