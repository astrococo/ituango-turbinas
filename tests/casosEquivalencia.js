/* Batería de casos para comprobar que una reorganización del código no
   cambia ningún resultado del modelo. Recibe un objeto con las funciones
   (m) y devuelve resultados serializables con los que se genera
   tests/datos/linea_base_modelo.json (ver tests/equivalencia.test.js). */
export function calcularCasos(m) {
  const conds = [
    m.CONDICION_DESCARGA_DISENO,
    { modo: "ase", qRio: 1350 },
    { modo: "ase", qRio: 2200 },
    { modo: "ase", qRio: 450 },
    { modo: "manual", almManual: 224.3 },
    { modo: "ase", qRio: 200 },
    { modo: "manual", almManual: { norte: 224.3, sur: 222.5 } },
  ];
  const out = {};
  const r6 = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === "number" ? +v.toPrecision(12) : v)));
  out.hill = [];
  for (const H of [110, 150, 179.2, 197.3, 230, 330]) for (const g of [4.87, 10, 21.5, 26.5, 30.2, 31.98]) out.hill.push(r6(m.evaluarHillChart(H, g)));
  out.unidad = []; out.inversos = []; out.optimo = [];
  conds.forEach((c, ci) => {
    for (const nivel of [390, 400, 408.3, 415, 420, 430]) for (const n of [1, 2, 4, 6, 8]) for (const g of [8, 21.5, 29.83]) {
      out.unidad.push(r6(m.evaluarTurbinaUnidad(nivel, g, n, c)));
    }
    for (const nivel of [395, 408.21, 419]) for (const n of [1, 3, 6]) {
      out.inversos.push(r6({
        q: m.resolverGammaParaCaudal(nivel, 140, n, 30.2, c),
        p: m.resolverGammaParaPotencia(nivel, 250, n, 29.294, 307, c),
        pico: m.picoEficiencia(nivel, n, 26.5, 307, c),
        lim: m.resolverGammaConLimitePotencia(nivel, 1e6, n, 30.2, 307, c),
      }));
    }
    out.optimo.push(r6(m.buscarPuntoOptimo(600, 408.3, 4, 29.294, null, c)));
    out.optimo.push(r6(m.buscarPuntoOptimo(900, 412, 4, 30.2, [70, 0, 60, 100], c)));
    out.optimo.push(r6(m.buscarPuntoOptimo(1300, 410, 8, 30.2, null, c)));
    out.optimo.push(r6(m.buscarPuntoOptimo(1300, 410, 8, 30.2, [100, 100, 0, 80, 90, 0, 100, 60], c)));
    if (ci === 0) out.optimo.push(r6(m.buscarPuntoOptimo(300, 400)));
  });
  out.vertedero = [];
  for (const H of [402, 408, 415, 420, 428]) for (const A of [0.5, 3, 8, 15, 21.5]) out.vertedero.push(r6(m.caudalVertederoDetallado(H, [A, A, 0, A])));
  out.canal = [];
  for (const H of [405, 410, 418]) for (const q of [100, 300, 900, 2500]) out.canal.push(r6(m.decidirCanalYAperturas(H, q)));
  out.volumen = [390, 405.5, 419.9, 425, 432].map((H) => r6([m.volumenExtrapolado(H), m.volumenUtilHm3(H), m.nivelDesdeVolumenExtrapolado(m.volumenExtrapolado(H))]));
  out.mallas = r6([m.construirMallaProto("H", "Q", 12, 12), m.construirMallaModelo("P11", 12, 12)]);
  out.curva = r6(m.curvaEficienciaEnH(197.3, 1.1));
  out.almenara = [];
  for (const z of ["norte", "sur"]) for (const q of [0, 200, 400, 500, 777, 1350, 2100, 2660, 3000]) for (const g of [0, 100, 168.75, 400, 675, 800]) out.almenara.push(r6(m.nivelAlmenaraASE(z, q, g)));
  return out;
}
