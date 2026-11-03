import { describe, it, expect } from "vitest";
import { calcularVivo } from "../src/datos/vivo.jsx";
import { leerLoggerNet, unirNivel } from "../src/operacion.js";
import { resumirDias, filaDiaria, requeridoRestoDelDia, cierreProyectado } from "../src/analitica.js";

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
