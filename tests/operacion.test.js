/* Lectura de LoggerNet y cálculo de la pestaña "Operación medida". */
import { describe, it, expect } from "vitest";
import { leerLoggerNet, unirNivel, agregarIntervalos, caudalModeloIntervalos, verificarFC, resumenPorUnidad, nivelDesdeFC } from "../src/operacion.js";
import { factorConversionHidrometria, resolverGammaParaPotencia, rendimientoGenerador } from "../src/modelo.js";

// Cabeceras reales de los dos archivos de la estación CR6 del vertedero (nov-2026)
const CAB_GEN = `"TOA5","2623799_Ituango_Vertedero","CR6","11955","CR6.Std.13.02","CPU:CR6_Nivel_Embalse_ConPB_V09102024.CR6","56567","Caudal_Vertedero"
"TIMESTAMP","RECORD","Pos1Comp1_Avg","Pos2Comp1_Avg","Pos1Comp2_Avg","Pos2Comp2_Avg","Pos1Comp3_Avg","Pos2Comp3_Avg","Pos1Comp4_Avg","Pos2Comp4_Avg","MedComp1_Avg","MedComp2_Avg","MedComp3_Avg","MedComp4_Avg","Caudal_Total_Avg","Open_Gate1_Avg","Open_Gate2_Avg","Open_Gate3_Avg","Open_Gate4_Avg","Caudal_Comp1_Avg","Caudal_Comp2_Avg","Caudal_Comp3_Avg","Caudal_Comp4_Avg","GeneracionU1_MW_Avg","GeneracionU2_MW_Avg","GeneracionU3_MW_Avg","GeneracionU4_MW_Avg","Caudal_Total_Turbinado_Avg","Caudal_Total_Descargado_Avg","QTurbinadoU1_FC_Avg","QTurbinadoU2_FC_Avg","QTurbinadoU3_FC_Avg","QTurbinadoU4_FC_Avg","QTurbinado_U1_Avg","QTurbinado_U2_Avg","QTurbinado_U3_Avg","QTurbinado_U4_Avg"
"TS","RN","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"","","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg","Avg"`;
const CAB_NIV = `"TOA5","2623799_Ituango_Vertedero","CR6","11955","CR6.Std.13.02","CPU:CR6_Nivel_Embalse_ConPB_V09102024.CR6","56567","All_Data"
"TIMESTAMP","RECORD","Nivel_embalse_msnm_Avg","Nivel_embalse_4_20mA_Avg","Nivel_Radar_msnm_Avg","Nivel_Radar_4_20mA_Avg","PRESION_BAROMET_mB_Avg","PRESION_BAROMET_mB_Redu_Avg","Batt_Volt_Min","Velocidad_Aire_Vertedero","Direccion_Aire_Vertedero","CLM_WDirSTD","Velocidad_1_Aire_Vertedero"
"TS","RN","","","","","","","","m/s","Deg","Deg","m/s"
"","","Avg","Avg","Avg","Avg","Avg","Avg","Min","WVc","WVc","WVc","Avg"`;
// Filas reales del 2-jul-2026 (las que compartió operaciones)
const FILAS_JUL = [
  '"2026-07-02 09:50:00",31908,7.719999,7.719999,0,0,0,0,0,0,156,0,0,0,149.5115,1.56,0,0,0,149.5115,0,0,0,156.0622,156.4061,0.08515247,154.9727,288.5963,438.1079,96.33466,96.54694,0.05256325,95.66215,100.9667,93.56666,0,108.7333',
  '"2026-07-02 09:51:00",31909,7.719999,7.719999,0,0,0,0,0,0,154.6667,0,0,0,148.2969,1.546667,0,0,0,148.2969,0,0,0,157.222,157.9039,0.08515247,155.6472,290.6532,438.9502,97.05061,97.47152,0.05256325,96.07854,101.9667,94.66666,0,108.7333',
];
const NIVEL_JUL = ['"2026-07-02 09:50:00",6381,379.7771,-8.420487,406.8338,8.047512,984.0385,984.0385,13.3639,0,0,0,0', '"2026-07-02 09:55:00",6382,379.7111,-8.526072,406.8341,8.04765,983.999,983.999,13.34976,0,0,0,0'];
const ceros = (n) => Array(n).fill(0).join(",");
function filaGen(t, nivel, p) {
  const fc = factorConversionHidrometria(nivel, t);
  const q = p.map((x) => x / fc);
  return `"${t}:00",1,${ceros(12)},0,${ceros(8)},${p.join(",")},${q.reduce((a, b) => a + b, 0)},${q.reduce((a, b) => a + b, 0)},${q.map((x) => x.toFixed(3)).join(",")},${p.map((x) => (x / 1.66).toFixed(3)).join(",")}`;
}
const toa5 = (filas) => [CAB_GEN, ...filas].join("\r\n");
const fila = filaGen;
describe("Lectura del archivo de LoggerNet", () => {
  it("lee las filas reales de julio: potencia, caudal F.C. (= P/1,62), QTurbinado_Ux y vertedero; descarta la línea a medio escribir", () => {
    const r = leerLoggerNet([CAB_GEN, ...FILAS_JUL, '"2026-07-02 09:52:00",31910,7.7'].join("\r\n"));
    expect(r.formato).toBe("TOA5");
    expect(r.filas.length).toBe(2);
    expect(r.filas[0]).toMatchObject({ t: "2026-07-02 09:50", p: [156.0622, 156.4061, 0.08515247, 154.9727], q2: [100.9667, 93.56666, 0, 108.7333], qVert: 149.5115, nivel: null });
    for (let u = 0; u < 4; u++) expect(r.filas[0].p[u] / r.filas[0].q[u]).toBeCloseTo(1.62, 5);
    expect(r.tieneQ2).toBe(true);
    expect(r.avisos.some((a) => a.includes("1 líneas"))).toBe(true);
  });
  it("del archivo All_Data toma el radar (Nivel_Radar_msnm_Avg), no Nivel_embalse_msnm_Avg", () => {
    const r = leerLoggerNet([CAB_NIV, ...NIVEL_JUL].join("\r\n"));
    expect(r.soloNivel).toBe(true);
    expect(r.columnaNivel).toBe("Nivel_Radar_msnm_Avg");
    expect(r.filas[0].nivel).toBeCloseTo(406.8338, 9);
    expect(r.avisos).toEqual([]);
  });
  it("une el nivel (cada 5 min) a cada minuto con el último valor de hasta 10 min antes", () => {
    const gen = leerLoggerNet([CAB_GEN, ...FILAS_JUL].join("\n")).filas;
    const niv = leerLoggerNet([CAB_NIV, ...NIVEL_JUL].join("\n")).filas;
    const u = unirNivel([...gen, { ...gen[0], t: "2026-07-02 10:20" }], niv);
    expect(u.filas[0].nivel).toBeCloseTo(406.8338, 9);
    expect(u.filas[1].nivel).toBeCloseTo(406.8338, 9);
    expect(u.filas[2].nivel).toBeNull(); // 25 min después del último nivel
    expect(u.sinNivel).toBe(1);
  });
  it("lee el CSV del relay (cabecera timestamp)", () => {
    const r = leerLoggerNet("timestamp,GeneracionU1_MW_Avg,GeneracionU2_MW_Avg,GeneracionU3_MW_Avg,GeneracionU4_MW_Avg,QTurbinadoU1_FC_Avg,QTurbinadoU2_FC_Avg,QTurbinadoU3_FC_Avg,QTurbinadoU4_FC_Avg\n2026-10-20 10:00:00,300,0,0,0,185.185,0,0,0\n");
    expect(r.formato).toBe("CSV");
    expect(r.filas[0].q[0]).toBeCloseTo(185.185, 6);
    expect(r.columnaNivel).toBeNull();
  });
});

describe("Factor de conversión implícito en los datos", () => {
  it("antes del 29-oct-2026 14:30 el F.C. implícito es 1,62; después da el nivel con que se calculó", () => {
    const gen = leerLoggerNet(toa5([fila("2026-10-29 14:29", 411.6, [300, 0, 0, 0]), fila("2026-10-29 14:30", 411.6, [300, 0, 0, 0])])).filas;
    const filas = unirNivel(gen, [{ t: "2026-10-29 14:25", nivel: 411.6 }]).filas;
    const v = verificarFC(filas);
    expect(v).toMatchObject({ antes: 1, antesOk: 1, despues: 1, despuesOk: 1 });
    expect(nivelDesdeFC(0.0119 * 411.6 - 3.178, "2026-10-30 00:00")).toBeCloseTo(411.6, 9);
    expect(nivelDesdeFC(1.62, "2026-10-01 00:00")).toBeNull();
  });
});

describe("Agregación y caudal del modelo", () => {
  const filas = unirNivel(leerLoggerNet(toa5(Array.from({ length: 30 }, (_, i) => fila(`2026-11-02 08:${String(i).padStart(2, "0")}`, 411.9, [290, 0, 0, 290])))).filas,
    Array.from({ length: 7 }, (_, i) => ({ t: `2026-11-02 08:${String(i * 5).padStart(2, "0")}`, nivel: 411.9 }))).filas;
  it("promedios de 15 minutos con el número de minutos", () => {
    const iv = agregarIntervalos(filas, 15);
    expect(iv.length).toBe(2);
    expect(iv[0]).toMatchObject({ t: "2026-11-02 08:00", minutos: 15 });
    expect(iv[0].p[0]).toBeCloseTo(290, 9);
    expect(iv[0].nivelColumna).toBeCloseTo(411.9, 9);
    expect(iv[0].nivelFC).toBeCloseTo(411.9, 2); // el caudal viene redondeado a 0,001 m³/s
  });
  it("el modelo usa bornes → eje y las unidades en línea; coincide con resolverGammaParaPotencia", () => {
    const cond = { modo: "ase", qRio: 400 };
    const iv = caudalModeloIntervalos(agregarIntervalos(filas, 15), { nivelDe: (x) => x.nivelColumna, cond });
    const r = resolverGammaParaPotencia(411.9, 290 / rendimientoGenerador(290), 2, 31.98, null, cond);
    expect(iv[0].n).toBe(2);
    expect(iv[0].qMod[0]).toBeCloseTo(r.resultado.Q, 9);
    expect(iv[0].qMod[1]).toBe(0);
    expect(iv[0].qModTotal).toBeCloseTo(2 * r.resultado.Q, 9);
    const res = resumenPorUnidad(iv);
    expect(res[0].energiaMWh).toBeCloseTo(290 * 0.5, 6);
    expect(res[0].volModHm3).toBeCloseTo((r.resultado.Q * 1800) / 1e6, 9);
    expect(res[1].energiaMWh).toBe(0);
    expect(res[0].volQ2Hm3).toBeCloseTo((290 / 1.66) * 1800 / 1e6, 6);
  });
});
