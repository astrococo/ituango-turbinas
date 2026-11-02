/* Pruebas de referencia del modelo de la colina y del salto neto.
   Cada prueba compara contra un dato publicado (no contra la propia app),
   salvo la de regresión, que asegura que la condición de diseño sigue
   dando exactamente lo mismo que la versión anterior de la app.

   Fuentes:
   - informe del ensayo de modelo (2013): tabla de 186 puntos,
     35 puntos de búsqueda/repetibilidad del BEP, Tabla 4.1 (95,288 %).
   - estudio de ampliación de GE (2023): escenarios 3.1.1 y 4.2, nota (3).
   - estudio de almenaras de la ASE (2026): Tablas 4-2 y 4-3. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  HILL_PROTO_186, WAE_PUNTOS, ESCENARIOS_2023_EPM_GE, ASE_ALMENARA, ASE_Q_GENERACION,
  CONDICION_DESCARGA_DISENO, unidadesPorAlmenara, buscarPuntoOptimo, resolverUnidadesConPotencias, GAMMAS_HILL,
  factorConversionHidrometria, textoHoraColombia, potenciaBornesDesdeEje,
  parsearResumenHorarioXM, numeroDesdeTexto, unidadesMinimasParaPotencia, rendimientoGenerador, simularDespachoHorario,
  volumenExtrapolado, nivelDesdeVolumenExtrapolado, resolverGammaParaPotencia, evaluarUnidadEnAlmenara, resolverPorUnidadConPorcentajes,
  evaluarHillChart, evaluarTurbinaUnidad, nivelAlmenaraASE, nivelAlmenaraSegunCondicion,
  picoEficiencia, resolverGammaConLimitePotencia, P_MAXIMO_ESPERADO_MW,
  interpolarEntreAperturas, precalcularGammas,
} from "../src/modelo.js";

function leerCSV(nombre) {
  const txt = readFileSync(new URL(`./datos/${nombre}`, import.meta.url), "utf8").replace(/^﻿/, "");
  const [cab, ...filas] = txt.trim().split(/\r?\n/);
  const cols = cab.split(",");
  return filas.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], isNaN(+v) ? v : +v])));
}
const media = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const ASE_NORTE_1350 = { modo: "ase", qRio: 1350 }; // con ≤ 4 unidades solo opera la almenara N°1

describe("1. Datos de la colina", () => {
  it("los 186 puntos embebidos coinciden con el CSV del paquete de datos", () => {
    const csv = leerCSV("ituango_hill_prototipo_186.csv");
    expect(HILL_PROTO_186.length).toBe(186);
    const clave = (g, n) => `${g}|${n}`;
    const mapa = new Map(csv.map((r) => [clave(r.gamma_deg, r.n11_rpm), r]));
    for (const [g, n11, q11, p11, eta, H, Q, P] of HILL_PROTO_186) {
      const r = mapa.get(clave(g, n11));
      expect(r, `punto γ=${g} n11=${n11}`).toBeDefined();
      expect([q11, p11, eta, H, Q, P]).toEqual([r.Q11_lps, r.P11_proto_kW, r.eta_proto_pct, r.H_proto_m, r.Q_proto_m3s, r.P_proto_MW]);
    }
  });
});

describe("2. Colina frente a escenarios GE 2023 (salto neto dado)", () => {
  for (const e of ESCENARIOS_2023_EPM_GE) {
    it(`${e.id}: Q y P dentro de 0,1 %`, () => {
      const r = evaluarHillChart(e.saltoNeto_m, e.gamma_deg);
      expect(Math.abs(r.Q / e.Q_m3s - 1)).toBeLessThan(0.001);
      expect(Math.abs(r.P / e.P_turbina_MW - 1)).toBeLessThan(0.001);
    });
  }
});

describe("3. Prueba fuera de muestra: 35 puntos BEP no usados por la app", () => {
  const pts = [...leerCSV("ituango_bep_busqueda_25.csv"), ...leerCSV("ituango_bep_repetibilidad_10.csv")];
  const err = pts.map((p) => {
    const r = evaluarHillChart(p.H_proto_m, p.gamma_deg);
    return { eta: r.eta - p.eta_proto_pct, q: r.Q / p.Q_proto_m3s - 1 };
  });
  it("error medio absoluto de eficiencia < 0,15 pp y máximo < 0,25 pp", () => {
    expect(err.length).toBe(35);
    expect(media(err.map((e) => Math.abs(e.eta)))).toBeLessThan(0.15);
    expect(Math.max(...err.map((e) => Math.abs(e.eta)))).toBeLessThan(0.25);
  });
  // En caudal, la serie BEP (24/07/2013) queda ~0,27 % por encima de la fila
  // de la colina en la misma apertura (reproducibilidad del ajuste de
  // apertura entre series del mismo ensayo); por eso el umbral es 0,5 %.
  it("error medio absoluto de caudal < 0,5 %", () => {
    expect(media(err.map((e) => Math.abs(e.q)))).toBeLessThan(0.005);
  });
});

describe("4. Eficiencia ponderada (Tabla 4.1 = 95,288 %)", () => {
  it("con el interpolador queda a menos de 0,1 pp", () => {
    const w = WAE_PUNTOS.reduce((s, r) => s + r[8], 0);
    const eta = WAE_PUNTOS.reduce((s, r) => s + evaluarHillChart(r[5], r[4]).eta * r[8], 0) / w;
    expect(Math.abs(eta - 95.288)).toBeLessThan(0.1);
  });
});

describe("5. Condición de diseño", () => {
  // La regresión numérica completa está en tests/equivalencia.test.js.
  it("sin condición explícita se usa la de diseño, con los niveles del pliego", () => {
    for (const [nivel, g, n, alm] of [[408.3, 26.5, 1, 214.9], [408.3, 29.83, 3, 217.5], [410.9, 30.2, 4, 218.8]]) {
      const r = evaluarTurbinaUnidad(nivel, g, n);
      const d = evaluarTurbinaUnidad(nivel, g, n, CONDICION_DESCARGA_DISENO);
      expect(r.P).toBe(d.P);
      expect(r.nivelAlmenara).toBe(alm);
    }
  });
});

describe("6. Tabla de almenara de la ASE", () => {
  it("en los nodos devuelve exactamente los valores publicados", () => {
    for (const zona of ["norte", "sur"]) {
      for (const [qRio, niveles] of ASE_ALMENARA[zona].filas) {
        niveles.forEach((nv, j) => {
          if (nv == null) return;
          const r = nivelAlmenaraASE(zona, qRio, ASE_Q_GENERACION[j]);
          expect(r.nivel).toBeCloseTo(nv, 9);
          expect(r.fueraDeTabla).toBe(false);
        });
      }
    }
  });
  it("interpola linealmente entre caudales del río", () => {
    // Norte, 1 unidad: 1350 → 224,79 ; 1500 → 226,70
    const r = nivelAlmenaraASE("norte", 1425, 168.75);
    expect(r.nivel).toBeCloseTo((224.79 + 226.7) / 2, 9);
  });
  it("río > 2660 m³/s: usa la fila de 2660 y lo marca", () => {
    const a = nivelAlmenaraASE("norte", 3000, 168.75);
    expect(a.nivel).toBeCloseTo(228.28, 9);
    expect(a.rioSobreMax).toBe(true);
    expect(a.fueraDeTabla).toBe(true);
  });
  it("río < 500 m³/s: extrapola con la pendiente 500-1000 de la misma tabla y lo marca", () => {
    // Norte, 1 unidad: 500 → 222,78 ; 1000 → 225,70. A 250: 222,78 − 0,5·2,92
    const a = nivelAlmenaraASE("norte", 250, 168.75);
    expect(a.nivel).toBeCloseTo(222.78 - 0.5 * (225.7 - 222.78), 9);
    expect(a.extrapRioBajo).toBe(true);
    expect(a.fueraDeTabla).toBe(true);
    // Sur, 0 unidades: 500 → 221,16 ; 1000 → 222,80. A 300: 221,16 − 0,4·1,64
    expect(nivelAlmenaraASE("sur", 300, 0).nivel).toBeCloseTo(221.16 - 0.4 * (222.8 - 221.16), 9);
  });
  it("la extrapolación no baja de la corona del jarillón de cada descarga (220 N°1 / 218 N°2)", () => {
    // Norte, río 0, 0 unidades: 222,60 − (225,50 − 222,60) = 219,70 < 220
    const a = nivelAlmenaraASE("norte", 0, 0);
    expect(a.nivel).toBe(220);
    expect(a.enPiso).toBe(true);
    expect(nivelAlmenaraASE("sur", 0, 0).nivel).toBeGreaterThanOrEqual(218);
  });
  it("celdas no simuladas por la ASE: último valor de la fila + incremento de la fila más cercana", () => {
    // Norte, río 500, 2 unidades (337,5): 222,78 + (226,20 − 225,70) de la fila de 1000
    const b = nivelAlmenaraASE("norte", 500, 337.5);
    expect(b.nivel).toBeCloseTo(222.78 + (226.2 - 225.7), 9);
    expect(b.completada).toBe(true);
    // Sur, río 500, 4 unidades (675): 221,32 + (224,42 − 223,00) de la fila de 1000
    expect(nivelAlmenaraASE("sur", 500, 675).nivel).toBeCloseTo(221.32 + (224.42 - 223.0), 9);
  });
  it("turbinado > 675 m³/s por almenara: pendiente del último tramo de la fila", () => {
    // Norte, río 1350: 3 → 226,16 ; 4 → 227,37 unidades. Con 843,75 m³/s: 227,37 + 1,21
    const a = nivelAlmenaraASE("norte", 1350, 843.75);
    expect(a.nivel).toBeCloseTo(227.37 + (227.37 - 226.16), 9);
    expect(a.extrapGen).toBe(true);
  });
  it("la zona sur usa la almenara N°2", () => {
    expect(nivelAlmenaraASE("sur", 1350, 675).nivel).toBeCloseTo(225.62, 9);
  });
});

describe("7. Cadena completa: embalse → almenara → pérdida → colina", () => {
  it("con la almenara de cada escenario GE (modo manual) reproduce su potencia (< 0,1 %)", () => {
    for (const e of ESCENARIOS_2023_EPM_GE) {
      const n = e.id.startsWith("Escenario 1") || e.id.startsWith("Escenario 2 (3.1.1)") ? 1 : 4;
      const r = evaluarTurbinaUnidad(e.embalse_m, e.gamma_deg, n, { modo: "manual", almManual: e.almenara_m });
      expect(Math.abs(r.P / e.P_turbina_MW - 1), e.id).toBeLessThan(0.001);
    }
  });
  it("el nivel de almenara usado es coherente con el caudal resultante (iteración convergida)", () => {
    const r = evaluarTurbinaUnidad(408.3, 29.83, 3, ASE_NORTE_1350);
    const alm = nivelAlmenaraSegunCondicion(ASE_NORTE_1350, "norte", 3, r.Q).nivel;
    expect(Math.abs(alm - r.nivelAlmenara)).toBeLessThan(1e-4);
  });
  it("condición ASE: 1 unidad a 408,3 m queda a menos de 0,6 m de la almenara informada a GE (224,3)", () => {
    const r = evaluarTurbinaUnidad(408.3, 29.83, 1, ASE_NORTE_1350);
    expect(Math.abs(r.nivelAlmenara - 224.3)).toBeLessThan(0.6);
    // Y la potencia queda a menos de 1 % de la del escenario 1 de GE (306,07 MW)
    expect(Math.abs(r.P / 306.07 - 1)).toBeLessThan(0.01);
  });
  it("nota (3) de GE 2023: a 26,5° con 1 unidad la potencia está entre el teórico (277) y lo medido (283) ±2 %", () => {
    const r = evaluarTurbinaUnidad(408.3, 26.5, 1, ASE_NORTE_1350);
    expect(r.P).toBeGreaterThan(277 * 0.98);
    expect(r.P).toBeLessThan(283 * 1.02);
    // La condición de diseño, en cambio, sobreestima (> 300 MW): era el error corregido.
    expect(evaluarTurbinaUnidad(408.3, 26.5, 1).P).toBeGreaterThan(300);
  });
});

describe("8. Límite garantizado de 307 MW por unidad", () => {
  it("el pico de eficiencia y la máxima potencia nunca superan 307 MW (390-420 msnm, 1-4 ud)", () => {
    for (let nivel = 390; nivel <= 420; nivel += 5) {
      for (let n = 1; n <= 4; n++) {
        const pico = picoEficiencia(nivel, n, 30.2, P_MAXIMO_ESPERADO_MW, ASE_NORTE_1350);
        if (pico.resultado) expect(pico.resultado.P).toBeLessThanOrEqual(P_MAXIMO_ESPERADO_MW + 0.01);
        const max = resolverGammaConLimitePotencia(nivel, 1e6, n, 30.2, P_MAXIMO_ESPERADO_MW, ASE_NORTE_1350);
        if (max.resultado) expect(max.resultado.P).toBeLessThanOrEqual(P_MAXIMO_ESPERADO_MW + 0.01);
      }
    }
  });
});

describe("9. Interpolación y transposición (oct-2026)", () => {
  it("reproduce los 186 puntos de la tabla: Q y P con error medio < 0,1 % y P máximo < 0,5 %", () => {
    const eq = [], ep = [];
    for (const [g, , , , , H, Q, P] of HILL_PROTO_186) {
      const r = evaluarHillChart(H, g);
      if (!r) continue; // punto en el borde del dominio
      eq.push(Math.abs(r.Q / Q - 1)); ep.push(Math.abs(r.P / P - 1));
    }
    expect(eq.length).toBe(186);
    expect(media(eq)).toBeLessThan(0.001);
    expect(media(ep)).toBeLessThan(0.001);
    expect(Math.max(...ep)).toBeLessThan(0.005);
  });
  it("validación cruzada dejando fuera cada apertura ≥ 14°: eficiencia con error medio < 0,25 pp y sesgo < 0,1 pp", () => {
    const gammas = [...new Set(HILL_PROTO_186.map((r) => r[0]))].sort((a, b) => a - b);
    const err = [];
    for (const g of gammas.slice(1, -1).filter((x) => x >= 14)) {
      const filas = HILL_PROTO_186.filter((r) => r[0] !== g);
      const pre = precalcularGammas(filas, 0, 1, 2, 3, 4);
      const gs = gammas.filter((x) => x !== g);
      for (const r of HILL_PROTO_186.filter((x) => x[0] === g)) {
        const v = interpolarEntreAperturas(pre, gs, g, r[1]);
        if (v) err.push(v.eta - r[4]);
      }
    }
    expect(err.length).toBeGreaterThan(100);
    expect(media(err.map(Math.abs))).toBeLessThan(0.25);
    expect(Math.abs(media(err))).toBeLessThan(0.1);
  });
  it("Q y P crecen con la apertura (requisito de las búsquedas por bisección)", () => {
    let violaciones = 0, total = 0;
    for (let H = 115; H <= 330; H += 5) {
      let prev = null;
      for (let g = 4.87; g <= 31.98; g += 0.1) {
        const r = evaluarHillChart(H, g);
        if (!r) { prev = null; continue; }
        if (prev) { total++; if (r.Q < prev.Q - 1e-9 || r.P < prev.P - 1e-9) violaciones++; }
        prev = r;
      }
    }
    expect(total).toBeGreaterThan(5000);
    expect(violaciones).toBe(0);
  });
  it("en una apertura ensayada coincide con la fila de la tabla (sin mezclar aperturas)", () => {
    for (const [g, n11, q11, , eta] of HILL_PROTO_186.filter((r) => r[0] === 22.03)) {
      const v = interpolarEntreAperturas(precalcularGammas(HILL_PROTO_186, 0, 1, 2, 3, 4), [...new Set(HILL_PROTO_186.map((r) => r[0]))].sort((a, b) => a - b), g, n11);
      expect(v.Q11).toBeCloseTo(q11, 9);
      expect(v.eta).toBeCloseTo(eta, 9);
    }
  });
});

describe("10. Operación conjunta de las almenaras (U1-U4 → N°1, U5-U8 → N°2)", () => {
  it("reparto de unidades: las primeras 4 van a la N°1", () => {
    expect(unidadesPorAlmenara(3)).toEqual({ norte: 3, sur: 0 });
    expect(unidadesPorAlmenara(4)).toEqual({ norte: 4, sur: 0 });
    expect(unidadesPorAlmenara(6)).toEqual({ norte: 4, sur: 2 });
    expect(unidadesPorAlmenara(8)).toEqual({ norte: 4, sur: 4 });
  });
  it("con ≤ 4 unidades el resultado es el de la almenara N°1 sola", () => {
    const r = evaluarTurbinaUnidad(408.3, 21.5, 3, ASE_NORTE_1350);
    const n1 = evaluarUnidadEnAlmenara(408.3, 21.5, "norte", 3, ASE_NORTE_1350);
    expect(r.P).toBe(n1.P);
    expect(r.nivelAlmenara).toBe(n1.nivelAlmenara);
    expect(r.dosAlmenaras).toBeUndefined();
  });
  it("con 6 unidades: 4 en la N°1 y 2 en la N°2, cada una con el caudal de sus propias unidades", () => {
    const r = evaluarTurbinaUnidad(408.3, 29.83, 6, ASE_NORTE_1350);
    const N = r.porAlmenara.norte, S = r.porAlmenara.sur;
    expect(N.unidades).toBe(4);
    expect(S.unidades).toBe(2);
    expect(N.nivelAlmenara).toBeCloseTo(nivelAlmenaraASE("norte", 1350, 4 * N.Q).nivel, 4);
    expect(S.nivelAlmenara).toBeCloseTo(nivelAlmenaraASE("sur", 1350, 2 * S.Q).nivel, 4);
    expect(r.Q).toBeCloseTo((4 * N.Q + 2 * S.Q) / 6, 9);
    expect(r.P).toBeCloseTo((4 * N.P + 2 * S.P) / 6, 9);
    expect(r.Pmax).toBe(Math.max(N.P, S.P));
    // La N°2 (menos unidades, nivel más bajo en la tabla) da más salto y más potencia
    expect(S.saltoNeto).toBeGreaterThan(N.saltoNeto);
  });
  it("el límite de 307 MW se aplica a la unidad más cargada, no al promedio", () => {
    const r = resolverGammaConLimitePotencia(412, 1e6, 6, 30.2, P_MAXIMO_ESPERADO_MW, ASE_NORTE_1350);
    const ev = r.resultado;
    expect(ev.Pmax).toBeLessThanOrEqual(P_MAXIMO_ESPERADO_MW + 0.05);
    expect(ev.P).toBeLessThanOrEqual(ev.Pmax);
  });
  it("modo manual: cada almenara usa su propio nivel", () => {
    const c = { modo: "manual", almManual: { norte: 224.3, sur: 222.0 } };
    const r = evaluarTurbinaUnidad(408.3, 21.5, 6, c);
    expect(r.porAlmenara.norte.nivelAlmenara).toBe(224.3);
    expect(r.porAlmenara.sur.nivelAlmenara).toBe(222.0);
  });
  it("% por unidad: U5-U8 descargan en la N°2 y el nivel de cada almenara depende solo de sus unidades operativas", () => {
    const d = resolverPorUnidadConPorcentajes(408.3, [90, 90, 0, 0, 90, 0, 0, 0], 30.2, 307, undefined, ASE_NORTE_1350);
    expect(d[0].zona).toBe("norte");
    expect(d[4].zona).toBe("sur");
    // U5 sola en la N°2 da lo mismo que una unidad sola en la N°2 con esa potencia
    const s = evaluarUnidadEnAlmenara(408.3, d[4].gamma, "sur", 1, ASE_NORTE_1350);
    expect(d[4].resultado.P).toBeCloseTo(s.P, 4);
    expect(d[0].resultado.saltoNeto).not.toBeCloseTo(d[4].resultado.saltoNeto, 2);
  });
});

describe("11. Despacho intradiario (XM)", () => {
  const TABLA = [
    "Resumen horario (9/10/2026)\t24 horas",
    "Hora\tDespacho XM\tBanda inferior\tBanda superior\tPromedio RT\tMín RT\tMáx RT\tDesviación prom.\tEstado",
    "00:00 - 00:59\t700.0 MW\t665.0 MW\t735.0 MW\t690.9 MW\t678.2 MW\t706.6 MW\t-9.1 MW / -1.31%\tDentro de banda",
    "02:00 - 02:59\t600.0 MW\t570.0 MW\t630.0 MW\t584.2 MW\t582.7 MW\t585.3 MW\t-15.8 MW / -2.63%\tDentro de banda",
    "16:00 - 16:59\t630.0 MW\t598.5 MW\t661.5 MW\t\t\t\t+0.0 MW / +0.00%\tSin dato RT",
  ].join("\n");
  it("lee el resumen horario: despacho, bandas y Promedio RT; 'Sin dato RT' queda sin RT", () => {
    const r = parsearResumenHorarioXM(TABLA);
    expect(r.horas[0]).toEqual({ hora: 0, despacho: 700, rt: 690.9, bandaInf: 665, bandaSup: 735 });
    expect(r.horas[2].rt).toBe(584.2);
    expect(r.horas[16]).toEqual({ hora: 16, despacho: 630, rt: null, bandaInf: 598.5, bandaSup: 661.5 });
    expect(r.horas[1]).toBeNull();
    expect(r.avisos.some((a) => a.startsWith("Faltan las horas"))).toBe(true);
  });
  it("acepta columnas simples y números con coma o punto", () => {
    const r = parsearResumenHorarioXM("0\t1.234,5\t1.200,0\n1;650;");
    expect(r.horas[0].despacho).toBe(1234.5);
    expect(r.horas[0].rt).toBe(1200);
    expect(r.horas[1].despacho).toBe(650);
    expect(["1,234.5", "1.234,5", "700.0", "0,5", "1,200", "-9.1"].map(numeroDesdeTexto)).toEqual([1234.5, 1234.5, 700, 0.5, 1200, -9.1]);
  });
  it("unidades mínimas sin pasar de 307 MW en el eje por unidad (la potencia del despacho es en bornes)", () => {
    expect(unidadesMinimasParaPotencia(0)).toBe(0);
    expect(unidadesMinimasParaPotencia(580)).toBe(2);
    expect(unidadesMinimasParaPotencia(607)).toBe(2); // 307 MW en el eje ≈ 303,6 MW en bornes
    expect(unidadesMinimasParaPotencia(608)).toBe(3);
    expect(unidadesMinimasParaPotencia(630)).toBe(3);
    expect(unidadesMinimasParaPotencia(1300, 4)).toBe(4); // no pasa de las disponibles
  });
  it("rendimiento del generador: valores del estudio de ampliación de GE (2023) por % de carga", () => {
    expect(rendimientoGenerador(302.4)).toBeCloseTo(0.9891, 9);
    expect(rendimientoGenerador(151.2)).toBeCloseTo(0.9855, 9);
    expect(rendimientoGenerador(100)).toBeCloseTo(0.9855, 9); // bajo 50 % de carga se usa el de 50 %
  });
  it("continuidad: sin generación el nivel sube lo que da el volumen de entrada", () => {
    const s = simularDespachoHorario({ nivelInicial: 411.6, horas: Array(24).fill({ potenciaMW: 0, unidades: 0 }), qEntrada: 400 });
    expect(s.Hfinal).toBeCloseTo(nivelDesdeVolumenExtrapolado(volumenExtrapolado(411.6) + (400 * 86400) / 1e6), 6);
  });
  it("cada hora usa la colina con la potencia en el eje (bornes / rendimiento del generador)", () => {
    const cond = { modo: "ase", qRio: 400 };
    const s = simularDespachoHorario({ nivelInicial: 411.6, horas: [{ potenciaMW: 580, unidades: 2 }], qEntrada: 0, cond });
    const r = resolverGammaParaPotencia(411.6, 290 / rendimientoGenerador(290), 2, 30.2, 307, cond);
    expect(s.detalle[0].qTurbinado).toBeCloseTo(2 * r.resultado.Q, 9);
    expect(s.detalle[0].pEjeLograda).toBeCloseTo(290 / rendimientoGenerador(290), 3);
  });
  it("hora con más potencia de la que dan las unidades: se marca como no alcanzable", () => {
    const s = simularDespachoHorario({ nivelInicial: 411.6, horas: [{ potenciaMW: 750, unidades: 2 }, { potenciaMW: 300, unidades: 0 }], qEntrada: 400, cond: { modo: "ase", qRio: 400 } });
    expect(s.detalle[0].alcanzable).toBe(false);
    expect(s.detalle[1].sinUnidades).toBe(true);
  });
});

describe("12. Factor de conversión de Hidrometría (F.C.)", () => {
  it("1,62 fijo hasta el 29-oct-2026 14:30 (hora de Colombia) y 0,0119·nivel − 3,178 desde entonces", () => {
    expect(factorConversionHidrometria(412, "2026-10-29 14:29")).toBe(1.62);
    expect(factorConversionHidrometria(412, "2026-10-29 14:30")).toBeCloseTo(0.0119 * 412 - 3.178, 12);
    expect(factorConversionHidrometria(400, "2026-11-02T08:00:00")).toBeCloseTo(1.582, 12);
    expect(factorConversionHidrometria(400, "2026-01-01")).toBe(1.62);
  });
  it("una fecha como Date se pasa a hora de Colombia (UTC−5)", () => {
    expect(textoHoraColombia(new Date("2026-10-29T19:29:00Z"))).toBe("2026-10-29 14:29");
    expect(factorConversionHidrometria(412, new Date("2026-10-29T19:29:00Z"))).toBe(1.62);
    expect(factorConversionHidrometria(412, new Date("2026-10-29T19:30:00Z"))).toBeCloseTo(1.7248, 12);
  });
  it("bornes = eje × rendimiento del generador", () => {
    const pb = potenciaBornesDesdeEje(300);
    expect(pb / 300).toBeCloseTo(0.9891, 4);
  });
});

describe("13. Correcciones de la auditoría (nov-2026)", () => {
  it("Buscador con poco caudal: no elige una opción por debajo de la apertura mínima ensayada", () => {
    const r = buscarPuntoOptimo(80, 407.31, 4, 29.294, null, { modo: "ase", qRio: 400 });
    expect(r.mejor.alcanzable).not.toBe(false);
    expect(r.mejor.gamma).toBeGreaterThan(GAMMAS_HILL[0] + 0.01);
    expect(r.mejor.Qtotal_turbinado).toBeLessThanOrEqual(80 * 1.001);
    // y había opciones no cumplibles (más unidades) que se descartaron
    expect(r.todas.some((o) => o.alcanzable === false)).toBe(true);
  });
  it("Buscador: si varias opciones turbinan lo mismo, elige la de mayor eficiencia", () => {
    const r = buscarPuntoOptimo(300, 410, 4, 29.294, null, { modo: "ase", qRio: 400 });
    const empatadas = r.todas.filter((o) => o.alcanzable !== false && Math.abs(o.Qtotal_turbinado - r.mejor.Qtotal_turbinado) <= 1);
    expect(r.mejor.eta).toBe(Math.max(...empatadas.map((o) => o.eta)));
  });
  it("unidades a distinta potencia en la misma almenara ven el mismo nivel, con el caudal total real", () => {
    const cond = { modo: "ase", qRio: 450 };
    const res = resolverUnidadesConPotencias(408.3, [300, 90, 90, 90], 30.2, 307, cond);
    const niveles = res.unidades.map((u) => u.resultado.nivelAlmenara);
    expect(Math.max(...niveles) - Math.min(...niveles)).toBeLessThan(1e-6);
    const qTotal = res.unidades.reduce((t, u) => t + u.resultado.Q, 0);
    expect(niveles[0]).toBeCloseTo(nivelAlmenaraASE("norte", 450, qTotal).nivel, 2);
  });
});

describe("14. Despacho: fecha y horas de poca potencia", () => {
  it("toma la fecha del resumen horario (día/mes/año)", () => {
    expect(parsearResumenHorarioXM("Resumen horario (9/10/2026)\t24 horas\n00:00 - 00:59\t700.0 MW").fecha).toBe("2026-10-09");
    expect(parsearResumenHorarioXM("00:00 - 00:59\t700.0 MW").fecha).toBeNull();
  });
  it("si con las unidades pedidas cada una queda bajo la apertura mínima, usa menos unidades (no caudal cero)", () => {
    // A 411,6 msnm una unidad en la apertura mínima ensayada (4,87°) da unos 18,5 MW en el eje
    const s = simularDespachoHorario({ nivelInicial: 411.6, horas: [{ potenciaMW: 24, unidades: 4 }, { potenciaMW: 3, unidades: 2 }], qEntrada: 0, cond: { modo: "ase", qRio: 400 } });
    const [d, e] = s.detalle;
    expect(d.unidadesPedidas).toBe(4);
    expect(d.unidades).toBe(1);
    expect(d.unidadesReducidas).toBe(true);
    expect(d.qTurbinado).toBeGreaterThan(0);
    expect(d.alcanzable).toBe(true);
    // 3 MW no se logran ni con una unidad: caudal de la apertura mínima, marcado
    expect(e.enMinimoEnsayado).toBe(true);
    expect(e.qTurbinado).toBeGreaterThan(0);
    expect(e.alcanzable).toBe(false);
  });
});
