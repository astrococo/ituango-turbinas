/* ============================================================
   MODELO — PH Ituango (sin interfaz)
   Curvas del embalse, vertedero, colina de la turbina, nivel de la
   almenara y buscador del punto de operación. Funciones puras: no
   dependen de React ni del navegador, y las pruebas (tests/) las
   importan directamente. Separado de ItuangoSimulador.jsx en oct-2026
   sin cambiar ningún cálculo (ver tests/equivalencia.test.js).
   ============================================================ */

/* ============================================================
   CURVAS TÉCNICAS (DatosAplicación.xlsx, validadas contra datos reales)
   ============================================================ */
const COTA_VOLUMEN = [[390.0,1595.974],[390.25,1602.7772],[390.5,1609.5998],[390.75,1616.4417],[391.0,1623.303],[391.25,1630.1836],[391.5,1637.0834],[391.75,1644.0026],[392.0,1650.941],[392.25,1657.8986],[392.5,1664.8754],[392.75,1671.8715],[393.0,1678.8867],[393.25,1685.9211],[393.5,1692.9746],[393.75,1700.0473],[394.0,1707.139],[394.25,1714.2499],[394.5,1721.3798],[394.75,1728.5288],[395.0,1735.6968],[395.25,1742.8839],[395.5,1750.09],[395.75,1757.3151],[396.0,1764.5591],[396.25,1771.8222],[396.5,1779.1042],[396.75,1786.4051],[397.0,1793.725],[397.25,1801.0638],[397.5,1808.4215],[397.75,1815.798],[398.0,1823.1935],[398.25,1830.6078],[398.5,1838.041],[398.75,1845.493],[399.0,1852.9639],[399.25,1860.4536],[399.5,1867.9621],[399.75,1875.4894],[400.0,1883.0354],[400.25,1890.5829],[400.5,1898.1551],[400.75,1905.7518],[401.0,1913.373],[401.25,1921.0186],[401.5,1928.6886],[401.75,1936.3828],[402.0,1944.1012],[402.25,1951.8437],[402.5,1959.6102],[402.75,1967.4007],[403.0,1975.215],[403.25,1983.0532],[403.5,1990.915],[403.75,1998.8005],[404.0,2006.7096],[404.25,2014.6422],[404.5,2022.5981],[404.75,2030.5774],[405.0,2038.5799],[405.25,2046.6057],[405.5,2054.6545],[405.75,2062.7263],[406.0,2070.8211],[406.25,2078.9387],[406.5,2087.0791],[406.75,2095.2423],[407.0,2103.428],[407.25,2111.6364],[407.5,2119.8672],[407.75,2128.1204],[408.0,2136.3959],[408.25,2144.6937],[408.5,2153.0136],[408.75,2161.3556],[409.0,2169.7196],[409.25,2178.1056],[409.5,2186.5134],[409.75,2194.943],[410.0,2203.3944],[410.25,2211.8673],[410.5,2220.3618],[410.75,2228.8777],[411.0,2237.415],[411.25,2245.9737],[411.5,2254.5536],[411.75,2263.1546],[412.0,2271.7768],[412.25,2280.4199],[412.5,2289.084],[412.75,2297.7689],[413.0,2306.4746],[413.25,2315.201],[413.5,2323.9479],[413.75,2332.7155],[414.0,2341.5035],[414.25,2350.3119],[414.5,2359.1405],[414.75,2367.9895],[415.0,2376.8585],[415.25,2385.7643],[415.5,2394.7014],[415.75,2403.6695],[416.0,2412.6682],[416.25,2421.6971],[416.5,2430.7559],[416.75,2439.8441],[417.0,2448.9616],[417.25,2458.1079],[417.5,2467.283],[417.75,2476.4865],[418.0,2485.7182],[418.25,2494.978],[418.5,2504.2657],[418.75,2513.5811],[419.0,2522.9242],[419.25,2532.2948],[419.5,2541.6929],[419.75,2551.1185],[420.0,2560.5715]];

/* ============================================================
   CONSTANTES FÍSICAS Y GEOMÉTRICAS (Datos Técnicos)
   ============================================================ */
const ZV = 401.0;
const A_MAX_ESTRUCTURAL = 21.5;
const K_AMAX = 0.66;
const N_TURBINAS_MAX = 8; // capacidad estructural total (4 casa de máquinas norte, ya operativas + 4 casa de máquinas sur, futuras)
/* A la fecha (oct-2026, según operaciones) solo operan las unidades 1-4
   (casa de máquinas norte, almenara N°1). Las unidades 5-8 (casa de
   máquinas sur, almenara N°2) entrarán en operación a partir de inicios
   de 2028. Este valor es el
   límite por defecto que usa el despacho automático (piloto y buscador);
   la exploración manual de la colina sigue permitiendo ver las 8 (útil
   para anticipar la ampliación), pero la automática no las usa a menos
   que el usuario lo habilite explícitamente. */
const UNIDADES_DISPONIBLES_HOY = 4;
const NAMO = 420.0;
const NAME = 432.5;
const NIVEL_MIN_TEC = 390.0;

/* Reglas operativas de canal indicadas por el proyecto */
const C1_MIN_OPERATIVO = 150.0;   // m3/s — mínimo individual de C1 en operación (evita erosión por caída parabólica)
const UMBRAL_CANAL_IZQ_MAX = 500.0;   // hasta aquí, solo canal izquierdo (C1)
const UMBRAL_CANAL_DER_MAX = 1500.0;  // entre 500 y 1500, canal derecho (C2,C3,C4); sobre 1500, ambos canales

/* ============================================================
   INTERPOLACIÓN LINEAL SOBRE PARES ORDENADOS
   ============================================================ */
function interp1(x, pairs) {
  const n = pairs.length;
  if (x <= pairs[0][0]) return pairs[0][1];
  if (x >= pairs[n - 1][0]) return pairs[n - 1][1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pairs[mid][0] <= x) lo = mid; else hi = mid;
  }
  const [x0, y0] = pairs[lo];
  const [x1, y1] = pairs[hi];
  if (x1 === x0) return y0;
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

function volumenHm3(H) {
  return interp1(Math.max(390, Math.min(420, H)), COTA_VOLUMEN);
}
/* Volumen CON extrapolación lineal por encima de 420 msnm (la curva
   Cota-Volumen del proyecto solo llega hasta ahí). Se usa en TODO cálculo
   de balance de continuidad que pueda involucrar niveles sobre el NAMO —
   antes esto solo se hacía al resolver H2 dentro de la bisección, pero NO
   al calcular S1 (el volumen de partida de cada paso), lo que producía un
   desbalance artificial que "congelaba" el nivel apenas superaba 420,
   incluso con un desequilibrio enorme entre caudal de entrada y salida. */
function volumenExtrapolado(H) {
  if (H <= 420) return volumenHm3(H);
  const pendiente = (volumenHm3(420) - volumenHm3(419.5)) / 0.5;
  return volumenHm3(420) + (H - 420) * pendiente;
}
const VOL_EN_390 = COTA_VOLUMEN[0][1];
function volumenUtilHm3(H) {
  return Math.max(0, volumenHm3(H) - VOL_EN_390);
}
function nivelDesdeVolumen(Shm3) {
  const inv = COTA_VOLUMEN.map(([c, v]) => [v, c]);
  return interp1(Shm3, inv);
}
/* Inversa de volumenExtrapolado: convierte volumen a nivel, extrapolando
   linealmente por encima del volumen correspondiente a 420 msnm (con la
   misma pendiente), en vez de quedar topada en 420 como nivelDesdeVolumen
   puro — necesaria en el mismo lugar donde se usa volumenExtrapolado. */
function nivelDesdeVolumenExtrapolado(Shm3) {
  const volEn420 = volumenHm3(420);
  if (Shm3 <= volEn420) return nivelDesdeVolumen(Shm3);
  const pendiente = (volumenHm3(420) - volumenHm3(419.5)) / 0.5; // Hm3 por metro
  return 420 + (Shm3 - volEn420) / pendiente;
}
const FACTOR_UNIDADES_C = Math.sqrt(3.28084); // C está en unidades inglesas (pie^0.5); Le y hvert en metros
function qLibreTotal(H) {
  // Fórmula OFICIAL de flujo libre pleno (Tabla 10.1, tránsito de la
  // Creciente Máxima Probable — CMP): Q = C · Le · hvert^1.5 / √3.28084,
  // validada contra los 54 puntos reales del tránsito con error <0.15%.
  // C y Le se interpolan de esos mismos 54 puntos reales (H=410.22 a
  // 432.95 msnm). Por debajo de 410.22 no hay puntos reales de este
  // tránsito — se usa el valor más bajo disponible (410.22), sin
  // extrapolar más allá de lo medido.
  const hvert = H - ZV;
  if (hvert <= 0) return 0;
  const Hc = Math.max(CMP_COEF_LIBRE[0][0], Math.min(CMP_COEF_LIBRE[CMP_COEF_LIBRE.length - 1][0], H));
  const C = interp1(Hc, CMP_COEF_LIBRE.map(([h, c]) => [h, c]));
  const Le = interp1(Hc, CMP_COEF_LIBRE.map(([h, , le]) => [h, le]));
  return (C * Le * Math.pow(hvert, 1.5)) / FACTOR_UNIDADES_C;
}
function aperturaMax(H) {
  return Math.max(0, Math.min(A_MAX_ESTRUCTURAL, K_AMAX * (H - ZV)));
}
/* Margen de apertura, por encima de Amax(H), en el que el flujo libre
   alcanza (satura en) su capacidad máxima — dato REAL, no supuesto: en la
   creciente de abril 2025 (OperacionCompuertasAbril2025.xlsx), a H entre
   407.94 y 408.65 msnm, la compuerta C2 operó en flujo libre con A=8.02 m
   consistentemente, con un margen A-Amax(H) de 2.97 a 3.44 m (promedio
   ≈3.2 m) — y el caudal real alcanzado (531-610 m³/s) ya estaba muy cerca
   del techo de la curva envolvente digitalizada para esos niveles. Antes
   este margen se extendía erróneamente hasta la apertura estructural
   completa (21.5 m), lo que subestimaba el caudal a aperturas moderadas
   (8 m) en ~14%, forzando al piloto a simular aperturas exageradas
   (~20 m) para lograr caudales que en la realidad ya se logran con ~8 m. */
const MARGEN_FL_SATURACION = 3.2;

/* Interpolación bilineal sobre la Tabla 10.6 oficial (calibración de la
   compuerta radial, por compuerta = tabla original /4, validada exacta
   contra la fórmula de orificio en régimen de flujo a presión — ver nota
   en TABLA_CALIBRACION_VERTEDERO). Reemplaza la fórmula de orificio +
   ajuste de flujo libre por la tabla OFICIAL completa: ya no hace falta
   aproximar el flujo libre, la tabla lo da directamente medido/calculado
   por el diseñador para cada combinación real de nivel y apertura.
   Donde la fuente no reporta un valor (celda vacía — esa apertura no es
   físicamente alcanzable a ese nivel, por la geometría de la compuerta),
   se usa el último valor válido de esa fila (la apertura máxima
   reportada a ese nivel), sin extrapolar más allá de lo medido. */
function indiceInferior(arr, valor) {
  if (valor <= arr[0]) return 0;
  if (valor >= arr[arr.length - 1]) return arr.length - 2;
  let i = 0;
  while (i < arr.length - 1 && arr[i + 1] <= valor) i++;
  return i;
}
function valorTablaFila(fila, aperturas, A) {
  // Dentro de una fila (H fijo), interpola en A, usando el último valor
  // válido si A excede lo reportado en esa fila.
  let ultimoValido = null, ultimoA = null;
  for (let j = 0; j < fila.length; j++) {
    if (fila[j] == null) break;
    ultimoValido = fila[j];
    ultimoA = aperturas[j];
  }
  if (ultimoValido == null) return null;
  if (A >= ultimoA) return ultimoValido;
  const j = indiceInferior(aperturas.slice(0, aperturas.indexOf(ultimoA) + 1), A);
  const a0 = aperturas[j], a1 = aperturas[j + 1], q0 = fila[j], q1 = fila[j + 1];
  if (q0 == null || q1 == null) return ultimoValido;
  return q0 + ((A - a0) / (a1 - a0)) * (q1 - q0);
}
function caudalCompuertaTabla(H, A) {
  const { niveles, aperturas, porCompuerta } = TABLA_CALIBRACION_VERTEDERO;
  const Hc = Math.max(niveles[0], Math.min(niveles[niveles.length - 1], H));
  const Ac = Math.max(0, A);
  const i = indiceInferior(niveles, Hc);
  const h0 = niveles[i], h1 = niveles[i + 1];
  const q0 = valorTablaFila(porCompuerta[i], aperturas, Ac);
  const q1 = valorTablaFila(porCompuerta[i + 1], aperturas, Ac);
  if (q0 == null && q1 == null) return 0;
  if (q0 == null) return q1;
  if (q1 == null) return q0;
  const w = h1 > h0 ? (Hc - h0) / (h1 - h0) : 0;
  return q0 + w * (q1 - q0);
}
function caudalCompuerta(H, A) {
  if (A <= 0 || H <= ZV) return { q: 0, tipo: "cerrada" };
  const amax = aperturaMax(H);
  if (A <= amax) {
    // Flujo a presión (FP): Tabla 10.6 oficial (calibración de la
    // compuerta radial, dividida entre 4), validada exacta (<0.15%)
    // contra la fórmula de orificio y contra caudales reales de abril 2025.
    return { q: Math.max(0, caudalCompuertaTabla(H, A)), tipo: "FP" };
  }
  // Flujo libre (FL): se interpola de forma CONTINUA entre el valor de la
  // Tabla 10.6 justo en el umbral Amax(H) y el techo de flujo libre pleno
  // — ahora calculado con la fórmula OFICIAL del tránsito CMP (Tabla 10.1:
  // Q=C·Le·hvert^1.5/√3.28084), no una aproximación digitalizada. La
  // saturación se alcanza en Amax(H)+MARGEN_FL_SATURACION (margen real,
  // observado en la creciente de abril 2025: compuertas en flujo libre
  // ya prácticamente en su techo con apertura Amax(H)+~3.2 m).
  const qEnUmbral = Math.max(0, caudalCompuertaTabla(H, amax));
  const qPlena = Math.max(qEnUmbral, qLibreTotal(H) / 4);
  const aSaturacion = amax + MARGEN_FL_SATURACION;
  if (A >= aSaturacion || aSaturacion <= amax) return { q: qPlena, tipo: "FL" };
  const frac = (A - amax) / (aSaturacion - amax);
  const q = qEnUmbral + frac * (qPlena - qEnUmbral);
  return { q, tipo: "FL" };
}

/* aperturasArr: [A_C1, A_C2, A_C3, A_C4] en metros (0 = cerrada) */
function caudalVertederoDetallado(H, aperturasArr) {
  const detalle = aperturasArr.map((A) => caudalCompuerta(H, A));
  const total = detalle.reduce((s, d) => s + d.q, 0);
  return { total, detalle };
}

/* Reparte el caudal objetivo de vertedero entre compuertas según las
   reglas de canal del proyecto. Dentro de un canal, el reparto en
   ESTADO ESTABLE es equitativo entre las compuertas activas — si el
   canal derecho está operando, C2, C3 y C4 están abiertas (nunca dos en
   cero mientras la tercera sostiene todo el caudal); lo escalonado es
   el CAMINO para llegar a esa meta (ver simularConPiloto), no el
   reparto final. */
function decidirCanalYAperturas(H, targetVertedero) {
  if (targetVertedero < C1_MIN_OPERATIVO) {
    // Por debajo del mínimo operativo del canal izquierdo (150 m3/s): se
    // prefiere embalsar (dejar subir el nivel, aprovechando esa energía
    // potencial vía turbinas) antes que abrir una compuerta a un caudal
    // artificialmente alto solo para cumplir el mínimo — nunca se fuerza
    // el canal abierto por debajo de su rango operativo real.
    return { aperturas: [0, 0, 0, 0], canal: "cerrado" };
  }
  // Canal "asignado" por caudal: izquierdo (150-500), derecho (500-1500),
  // ambos (>1500) — regla original del proyecto, RESTAURADA. La creciente
  // de abril 2025 (OperacionCompuertasAbril2025.xlsx) mostró las 4
  // compuertas abiertas incluso con caudal <1500 m³/s, pero esto se debe
  // a que las condiciones hidrológicas PREVIAS al evento ya exigían ambos
  // canales abiertos (el archivo empieza a mitad de operación, no desde
  // un estado "en frío" con canal derecho recién asignado) — no significa
  // que el umbral de 1500 no sea válido. Por eso el umbral se mantiene tal
  // cual; lo que sí se corrigió (ver más abajo) es evitar aperturas
  // exageradas cuando el canal asignado necesitaría superar Amax(H).
  const amax = aperturaMax(H);
  const opciones = [
    { activas: [true, false, false, false], nombre: "izquierdo" },
    { activas: [false, true, true, true], nombre: "derecho" },
    { activas: [true, true, true, true], nombre: "ambos" },
  ];
  let idxAsignado = 0;
  if (targetVertedero >= UMBRAL_CANAL_IZQ_MAX) idxAsignado = 1;   // 500-1500: canal derecho
  if (targetVertedero > UMBRAL_CANAL_DER_MAX) idxAsignado = 2;    // >1500: ambos canales

  // Escalación por Apertura Máxima: si el canal asignado por caudal
  // necesita superar Amax(H) (flujo libre), se prueba si el SIGUIENTE
  // canal (más compuertas) logra el mismo caudal sin superarla — en tal
  // caso se prefiere, porque reparte el mismo caudal en más compuertas a
  // una apertura más moderada y controlable (flujo a presión), en vez de
  // forzar pocas compuertas cerca de su máximo estructural. Si NINGÚN
  // canal disponible logra flujo a presión (nivel muy bajo, cerca de la
  // cresta del vertedero), se acepta el flujo libre como límite físico
  // real — no hay más compuertas que abrir para evitarlo.
  for (let idx = idxAsignado; idx < opciones.length; idx++) {
    const { activas, nombre } = opciones[idx];
    const { A } = resolverAperturaComun(H, activas, targetVertedero);
    const logueEscalada = idx > idxAsignado;
    if (A <= amax || idx === opciones.length - 1) {
      return { aperturas: activas.map((a) => (a ? A : 0)), canal: nombre, escalado: logueEscalada, canalAsignado: opciones[idxAsignado].nombre };
    }
    // si A > amax (flujo libre) y todavía hay un canal con más compuertas por probar, continuar al siguiente
  }
  // (no debería llegarse aquí; el bucle siempre retorna en la última opción)
  const { A } = resolverAperturaComun(H, opciones[2].activas, targetVertedero);
  return { aperturas: [A, A, A, A], canal: "ambos" };
}

function resolverAperturaComun(H, activasArr, qObjetivoVertedero) {
  const nActivas = activasArr.filter(Boolean).length;
  if (nActivas === 0) return { A: 0, alcanzable: qObjetivoVertedero <= 1e-6 };
  if (qObjetivoVertedero <= 0) return { A: 0, alcanzable: true };
  // El techo de búsqueda ya NO es la apertura estructural completa (21.5 m):
  // el caudal se SATURA (deja de crecer) en Amax(H)+MARGEN_FL_SATURACION —
  // abrir más allá de ahí no entrega más caudal (ver caudalCompuerta), así
  // que si el objetivo no se alcanza ni siquiera saturado, no tiene sentido
  // reportar una apertura mayor: eso nunca ocurre en la operación real
  // (creciente de abril 2025: máximo observado ~8 m, nunca cerca de 21.5 m).
  const amax = aperturaMax(H);
  const hiBound = Math.min(A_MAX_ESTRUCTURAL, amax + MARGEN_FL_SATURACION);
  const qAt = (A) => {
    const arr = activasArr.map((a) => (a ? A : 0));
    return caudalVertederoDetallado(H, arr).total;
  };
  const qMax = qAt(hiBound);
  if (qObjetivoVertedero >= qMax) return { A: hiBound, alcanzable: qObjetivoVertedero <= qMax * 1.001 };
  let lo = 0, hi = hiBound;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (qAt(mid) < qObjetivoVertedero) lo = mid; else hi = mid;
  }
  return { A: (lo + hi) / 2, alcanzable: true };
}
const TABLA_CALIBRACION_VERTEDERO = {
  niveles: [401, 401.5, 402, 402.5, 403, 403.5, 404, 404.5, 405, 405.5, 406, 406.5, 407, 407.5, 408, 408.5, 409, 409.5, 410, 410.5, 411, 411.5, 412, 412.5, 413, 413.5, 414, 414.5, 415, 415.5, 416, 416.5, 417, 417.5, 418, 418.5, 419, 419.5, 420, 420.5, 421, 421.5, 422, 422.5, 423, 423.5, 424, 424.5, 425, 425.5, 426, 426.5, 427, 427.5, 428, 428.5, 429, 429.5, 430, 430.5, 431, 431.5, 432, 432.5, 433],
  aperturas: [0.3, 0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5, 21.5],
  porCompuerta: [[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],[7.375,10.42,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],[11.492,18.047,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],[14.482,23.3,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],[16.955,27.57,71.16,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],[19.108,31.26,84.198,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],[21.043,34.56,95.47,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],[22.815,37.57,105.547,161.775,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],[24.457,40.358,114.74,178.85,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],[25.997,42.962,123.252,194.43,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],[27.45,45.42,131.213,208.85,276.382,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],[28.83,47.75,138.715,222.338,296.882,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],[30.148,49.972,145.833,235.053,316.055,387.135,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],[31.41,52.1,152.62,247.115,334.13,412.135,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],[32.623,54.145,159.118,258.615,351.275,435.705,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],[33.792,56.112,165.36,269.625,367.623,458.062,539.595,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],[34.922,58.017,171.375,280.202,383.272,479.38,567.285,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],[36.017,59.858,177.185,290.395,398.31,499.788,593.685,678.803,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],[37.083,61.645,182.812,300.243,412.798,519.395,618.96,710.39,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],[38.115,63.383,188.27,309.775,426.795,538.288,643.24,740.633,829.403,null,null,null,null,null,null,null,null,null,null,null,null,null,null],[39.12,65.073,193.575,319.025,440.348,556.54,666.64,769.688,864.712,null,null,null,null,null,null,null,null,null,null,null,null,null,null],[40.1,66.72,198.738,328.012,453.495,574.212,689.242,797.688,898.635,991.148,null,null,null,null,null,null,null,null,null,null,null,null,null],[41.057,68.33,203.77,336.76,466.272,591.357,711.13,824.735,931.325,1030.033,null,null,null,null,null,null,null,null,null,null,null,null,null],[41.992,69.9,208.68,345.288,478.707,608.018,732.362,850.923,962.903,1067.5,1163.872,null,null,null,null,null,null,null,null,null,null,null,null],[42.907,71.438,213.477,353.61,490.83,624.235,752.995,876.33,993.48,1103.695,1206.21,null,null,null,null,null,null,null,null,null,null,null,null],[43.805,72.94,218.17,361.74,502.658,640.04,773.08,901.02,1023.143,1138.743,1247.11,null,null,null,null,null,null,null,null,null,null,null,null],[44.682,74.415,222.765,369.69,514.215,655.465,792.655,925.05,1051.967,1172.743,1286.71,1393.188,null,null,null,null,null,null,null,null,null,null,null],[45.542,75.86,227.265,377.475,525.518,670.535,811.758,948.472,1080.025,1205.785,1325.128,1437.428,null,null,null,null,null,null,null,null,null,null,null],[46.388,77.278,231.678,385.1,536.582,685.275,830.42,971.33,1107.372,1237.945,1362.463,1480.345,null,null,null,null,null,null,null,null,null,null,null],[47.218,78.67,236.01,392.58,547.423,699.702,848.673,993.663,1134.06,1269.29,1398.803,1522.053,1638.487,null,null,null,null,null,null,null,null,null,null],[48.035,80.037,240.262,399.918,558.055,713.84,866.543,1015.505,1160.132,1299.88,1434.22,1562.648,1684.652,null,null,null,null,null,null,null,null,null,null],[48.835,81.382,244.44,407.125,568.485,727.702,884.05,1036.888,1185.635,1329.765,1468.785,1602.215,1729.582,1850.398,null,null,null,null,null,null,null,null,null],[49.625,82.707,248.55,414.205,578.73,741.305,901.217,1057.835,1210.598,1358.995,1502.555,1640.83,1773.378,1899.75,null,null,null,null,null,null,null,null,null],[50.403,84.01,252.59,421.168,588.795,754.663,918.065,1078.378,1235.057,1387.608,1535.582,1678.555,1816.115,1947.852,null,null,null,null,null,null,null,null,null],[51.167,85.293,256.57,428.015,598.692,767.788,934.607,1098.537,1259.04,1415.642,1567.912,1715.45,1857.87,1994.795,2125.838,null,null,null,null,null,null,null,null],[51.92,86.555,260.488,434.757,608.428,780.692,950.862,1118.332,1282.575,1443.132,1599.59,1751.568,1898.707,2040.66,2177.07,null,null,null,null,null,null,null,null],[52.663,87.8,264.345,441.395,618.01,793.388,966.845,1137.783,1305.688,1470.11,1630.655,1786.957,1938.685,2085.515,2227.125,null,null,null,null,null,null,null,null],[53.395,89.03,268.15,447.935,627.445,805.883,982.567,1156.905,1328.398,1496.6,1661.135,1821.658,1977.855,2129.425,2276.077,2417.517,null,null,null,null,null,null,null],[54.117,90.24,271.9,454.38,636.74,818.188,998.04,1175.717,1350.725,1522.63,1691.07,1855.713,2016.263,2172.448,2324.0,2470.655,null,null,null,null,null,null,null],[54.83,91.435,275.6,460.735,645.903,830.31,1013.28,1194.235,1372.688,1548.223,1720.48,1889.15,2053.952,2214.635,2370.955,2522.675,null,null,null,null,null,null,null],[55.535,92.615,279.25,467.002,654.938,842.258,1028.293,1212.467,1394.307,1573.4,1749.398,1922.007,2090.965,2256.032,2416.997,2573.645,2725.762,null,null,null,null,null,null],[56.23,93.78,282.853,473.19,663.847,854.038,1043.088,1230.432,1415.595,1598.178,1777.845,1954.312,2127.332,2296.685,2462.177,2623.622,2780.835,null,null,null,null,null,null],[56.917,94.93,286.413,479.295,672.643,865.658,1057.678,1248.138,1436.568,1622.58,1805.845,1986.092,2163.088,2336.63,2506.545,2672.665,2834.838,null,null,null,null,null,null],[57.595,96.067,289.925,485.325,681.32,877.125,1072.068,1265.595,1457.24,1646.62,1833.418,2017.37,2198.262,2375.905,2550.14,2720.825,2887.83,3051.023,null,null,null,null,null],[58.265,97.192,293.397,491.28,689.893,888.442,1086.267,1282.815,1477.622,1670.312,1860.58,2048.173,2232.883,2414.54,2593.003,2768.148,2939.867,3108.055,null,null,null,null,null],[58.928,98.302,296.83,497.163,698.357,899.617,1100.285,1299.805,1497.725,1693.675,1887.352,2078.517,2266.975,2452.568,2635.168,2814.675,2990.997,3164.062,null,null,null,null,null],[59.583,99.4,300.223,502.978,706.72,910.658,1114.125,1316.578,1517.565,1716.72,1913.75,2108.425,2300.56,2490.012,2676.67,2860.445,3041.27,3219.093,null,null,null,null,null],[60.233,100.487,303.577,508.728,714.987,921.562,1127.797,1333.14,1537.148,1739.457,1939.79,2137.915,2333.665,2526.903,2717.537,2905.495,3090.725,3273.2,3452.895,null,null,null,null],[60.873,101.562,306.895,514.41,723.158,932.342,1141.303,1349.497,1556.483,1761.905,1965.483,2167.005,2366.305,2563.265,2757.8,2949.855,3139.403,3326.425,3510.932,null,null,null,null],[61.508,102.625,310.178,520.033,731.237,942.997,1154.652,1365.66,1575.58,1784.068,1990.845,2195.707,2398.5,2599.115,2797.483,2993.56,3187.335,3378.812,3568.025,null,null,null,null],[62.138,103.677,313.425,525.595,739.23,953.535,1167.85,1381.632,1594.45,1805.957,2015.888,2224.04,2430.27,2634.48,2836.61,3036.635,3234.557,3430.4,3624.218,3816.075,null,null,null],[62.758,104.72,316.64,531.1,747.138,963.955,1180.898,1397.425,1613.1,1827.588,2040.622,2252.017,2461.63,2669.375,2875.205,3079.108,3281.1,3481.225,3679.552,3876.173,null,null,null],[63.375,105.752,319.822,536.548,754.96,974.265,1193.805,1413.037,1631.535,1848.963,2065.062,2279.65,2492.595,2703.82,2913.287,3121.003,3326.99,3531.318,3734.065,3935.355,null,null,null],[63.985,106.775,322.973,541.94,762.702,984.467,1206.572,1428.483,1649.767,1870.095,2089.218,2306.952,2523.18,2737.83,2950.88,3162.34,3372.258,3580.707,3787.798,3993.66,4198.462,null,null],[64.588,107.785,326.092,547.278,770.37,994.565,1219.207,1443.76,1667.797,1890.99,2113.095,2333.935,2553.4,2771.425,2988.0,3203.148,3416.925,3629.427,3840.775,4051.125,4260.665,null,null],[65.188,108.787,329.185,552.565,777.96,1004.56,1231.713,1458.878,1685.635,1911.658,2136.705,2360.61,2583.265,2804.617,3024.665,3243.44,3461.017,3677.503,3893.032,4107.788,4321.972,null,null],[65.78,109.782,332.248,557.805,785.475,1014.457,1244.092,1473.842,1703.285,1932.105,2160.057,2386.985,2612.787,2837.42,3060.89,3283.238,3504.552,3724.955,3944.597,4163.677,4382.422,null,null],[66.368,110.767,335.28,562.992,792.923,1024.26,1256.35,1488.655,1720.755,1952.335,2183.16,2413.073,2641.983,2869.85,3096.69,3322.56,3547.555,3771.812,3995.5,4218.828,4442.05,4665.47,null],[66.95,111.743,338.288,568.135,800.298,1033.97,1268.487,1503.32,1738.05,1972.36,2206.023,2438.883,2670.858,2901.915,3132.082,3361.423,3590.043,3818.093,4045.758,4273.267,4500.89,4728.948,null],[67.528,112.71,341.267,573.23,807.607,1043.588,1280.513,1517.845,1755.175,1992.182,2228.648,2464.42,2699.423,2933.633,3167.077,3399.84,3632.032,3863.82,4095.403,4327.02,4558.967,4791.587,null],[68.103,113.67,344.223,578.28,814.85,1053.118,1292.425,1532.233,1772.132,2011.812,2251.048,2489.698,2727.69,2965.008,3201.693,3437.827,3673.543,3909.012,4144.45,4380.115,4616.315,4853.415,null],[68.67,114.62,347.152,583.288,822.03,1062.562,1304.227,1546.487,1788.93,2031.25,2273.225,2514.72,2755.668,2996.057,3235.935,3475.4,3714.59,3953.69,4192.925,4432.573,4672.96,4914.467,5157.552],[69.233,115.565,350.058,588.253,829.148,1071.925,1315.925,1560.61,1805.572,2050.503,2295.19,2539.497,2783.363,3026.785,3269.82,3512.573,3755.188,3997.865,4240.845,4484.417,4728.925,4974.77,5222.43],[69.793,116.5,352.94,593.175,836.202,1081.207,1327.52,1574.608,1822.062,2069.577,2316.945,2564.032,2810.785,3057.207,3303.358,3549.352,3795.35,4041.56,4288.23,4535.67,4784.235,5034.35,5286.512],[70.345,117.427,355.798,598.058,843.2,1090.408,1339.013,1588.48,1838.405,2088.48,2338.497,2588.338,2837.945,3087.327,3336.56,3585.758,3835.095,4084.785,4335.097,4586.35,4838.915,5093.233,5349.825]]
};
const CMP_COEF_LIBRE = [[410.22,3.32,63.6],[410.81,3.34,63.45],[412.08,3.38,63.12],[414.5,3.46,62.49],[415.82,3.49,62.15],[417.95,3.55,61.59],[418.04,3.55,61.57],[418.45,3.56,61.46],[419.45,3.59,61.2],[420.5,3.61,60.93],[420.91,3.62,60.82],[421.75,3.64,60.61],[422.58,3.65,60.39],[423.38,3.67,60.18],[423.67,3.68,60.11],[424.11,3.69,59.99],[424.78,3.7,59.82],[424.85,3.7,59.8],[425.4,3.71,59.66],[425.95,3.72,59.51],[426.45,3.73,59.38],[426.82,3.74,59.29],[426.9,3.74,59.27],[427.32,3.75,59.16],[427.7,3.75,59.06],[427.9,3.76,59.01],[428.07,3.76,58.96],[428.52,3.77,58.85],[428.55,3.77,58.84],[429.05,3.78,58.71],[429.56,3.79,58.57],[430.05,3.8,58.45],[430.39,3.8,58.36],[430.5,3.81,58.33],[430.62,3.81,58.3],[430.86,3.81,58.24],[430.92,3.81,58.22],[431.1,3.82,58.17],[431.31,3.82,58.12],[431.34,3.82,58.11],[431.59,3.82,58.05],[431.67,3.83,58.03],[431.82,3.83,57.99],[432.0,3.83,57.94],[432.04,3.83,57.93],[432.25,3.84,57.88],[432.31,3.84,57.86],[432.44,3.84,57.83],[432.59,3.84,57.79],[432.61,3.84,57.78],[432.78,3.85,57.74],[432.84,3.85,57.72],[432.9,3.85,57.71],[432.95,3.85,57.69]];
// columnas: [H (msnm), C (coeficiente empirico, unidades inglesas pie^0.5), Le (longitud efectiva, m)] -- Tabla 10.1, transito CMP a flujo libre
const HILL_PROTO_186 = [[4.87,39.94,120.53,0.77,65.28,335.68,36.35,77.61],[4.87,42.22,118.75,0.74,63.52,300.34,33.88,62.97],[4.87,43.99,117.04,0.7,61.56,276.66,32.04,53.18],[4.87,45.97,115.01,0.66,58.54,253.36,30.13,43.54],[4.87,47.93,112.69,0.61,55.15,233.02,28.32,35.46],[4.87,49.99,110.51,0.55,51.06,214.25,26.63,28.38],[4.87,52.11,108.57,0.47,44.36,197.13,25.09,21.38],[4.87,54.0,106.82,0.4,38.31,183.57,23.82,16.32],[4.87,55.97,105.08,0.32,31.39,170.88,22.61,11.82],[4.87,57.94,103.09,0.23,22.47,159.46,21.43,7.48],[4.87,59.93,100.53,0.11,11.3,149.05,20.2,3.32],[8.0,40.01,213.0,1.67,80.66,334.38,64.11,168.5],[8.0,41.99,210.72,1.65,80.29,303.67,60.44,143.6],[8.0,44.0,207.01,1.6,79.45,276.55,56.66,121.31],[8.0,46.0,202.53,1.55,78.68,253.06,53.03,102.88],[8.0,47.99,197.8,1.49,77.56,232.42,49.63,87.18],[8.0,49.99,193.17,1.42,75.18,214.27,46.54,73.06],[8.0,52.0,190.88,1.39,74.93,197.98,44.21,63.9],[8.0,53.95,187.36,1.31,72.01,183.96,41.83,53.99],[8.0,55.97,183.92,1.22,68.33,170.87,39.57,45.02],[8.0,57.96,180.62,1.13,63.94,159.34,37.53,37.25],[8.0,60.01,176.61,1.01,58.57,148.69,35.45,30.08],[8.0,61.96,172.59,0.86,50.98,139.44,33.55,23.24],[8.0,63.92,167.57,0.7,42.99,131.02,31.57,17.33],[8.0,65.9,161.67,0.5,31.45,123.28,29.55,11.16],[8.0,68.02,153.21,0.25,16.52,115.7,27.13,5.05],[11.02,39.98,325.06,2.73,86.23,334.9,97.92,275.52],[11.02,41.96,320.38,2.72,87.25,304.14,91.97,237.79],[11.02,43.95,315.29,2.69,87.71,277.22,86.41,204.71],[11.02,45.94,308.66,2.65,88.18,253.69,80.92,176.39],[11.02,48.05,301.46,2.6,88.54,231.92,75.57,151.2],[11.02,49.98,293.85,2.5,87.41,214.3,70.81,129.23],[11.02,51.98,287.9,2.42,86.41,198.11,66.7,111.26],[11.02,53.96,283.21,2.35,85.14,183.85,63.21,96.41],[11.02,55.97,277.92,2.26,83.29,170.89,59.8,82.94],[11.02,57.93,272.5,2.15,80.81,159.51,56.65,71.15],[11.02,59.97,266.54,2.0,76.92,148.86,53.53,59.72],[11.02,61.98,260.88,1.84,72.24,139.37,50.69,49.73],[11.02,63.99,255.69,1.67,67.19,130.75,48.12,41.19],[11.02,65.95,250.07,1.49,61.28,123.08,45.66,33.56],[11.02,67.96,243.2,1.28,54.02,115.92,43.1,26.3],[11.02,69.96,234.96,1.03,44.83,109.39,40.45,19.33],[14.01,39.95,432.33,3.73,88.57,335.52,130.35,377.45],[14.01,41.95,427.41,3.77,90.54,304.25,122.71,329.37],[14.01,43.95,421.36,3.77,91.89,277.19,115.47,286.58],[14.01,45.96,413.23,3.76,93.29,253.46,108.29,249.47],[14.01,47.95,403.27,3.67,93.36,232.86,101.29,214.56],[14.01,49.94,393.73,3.56,92.83,214.67,94.95,184.39],[14.01,51.94,385.1,3.46,92.3,198.41,89.29,159.33],[14.01,53.95,377.17,3.35,91.29,183.95,84.2,137.77],[14.01,55.93,369.78,3.24,89.98,171.17,79.63,119.52],[14.01,57.95,362.39,3.12,88.34,159.43,75.32,103.36],[14.01,59.97,354.59,2.96,85.71,148.88,71.22,88.55],[14.01,62.01,346.72,2.77,82.12,139.23,67.34,75.03],[14.01,63.96,339.31,2.58,78.16,130.86,63.89,63.68],[14.01,65.95,330.32,2.33,72.49,123.08,60.32,52.44],[14.01,67.92,321.5,2.08,66.37,116.04,57.01,42.78],[14.01,69.93,311.45,1.8,59.29,109.47,53.64,33.92],[16.0,39.95,508.74,4.45,89.71,335.47,153.38,449.74],[16.0,42.01,504.49,4.54,92.31,303.42,144.65,394.76],[16.0,44.0,497.46,4.58,94.46,276.57,136.18,346.65],[16.0,45.99,486.57,4.52,95.3,253.15,127.43,299.53],[16.0,47.96,475.04,4.4,95.05,232.71,119.28,257.08],[16.0,49.95,464.26,4.28,94.6,214.6,111.95,221.45],[16.0,51.94,453.9,4.16,94.07,198.43,105.24,191.41],[16.0,53.93,444.88,4.06,93.62,184.08,99.35,166.84],[16.0,55.97,436.47,3.94,92.73,170.92,93.93,145.05],[16.0,58.0,428.47,3.83,91.73,159.13,88.97,126.53],[16.0,59.97,419.67,3.67,89.71,148.86,84.28,109.66],[16.0,61.97,409.99,3.47,86.87,139.4,79.68,94.01],[16.0,63.96,397.89,3.19,82.32,130.86,74.92,78.64],[16.0,65.97,386.0,2.88,76.69,123.02,70.47,64.78],[16.0,67.93,374.67,2.59,70.89,116.02,66.43,53.24],[16.0,69.9,362.21,2.28,64.58,109.56,62.41,43.02],[18.0,39.99,583.58,5.18,91.12,334.73,175.74,522.3],[18.0,41.99,577.26,5.29,94.0,303.6,165.56,460.35],[18.0,43.97,566.61,5.27,95.37,276.91,155.2,399.38],[18.0,45.94,553.97,5.17,95.86,253.66,145.23,344.09],[18.0,47.99,541.64,5.07,96.02,232.47,135.93,295.66],[18.0,49.95,530.07,4.95,95.86,214.6,127.82,256.2],[18.0,51.95,518.7,4.84,95.68,198.38,120.25,222.41],[18.0,53.94,508.23,4.7,94.91,183.99,113.47,193.09],[18.0,56.02,498.01,4.57,94.11,170.6,107.07,167.5],[18.0,57.98,488.91,4.45,93.35,159.26,101.56,147.11],[18.0,59.98,479.51,4.29,91.73,148.8,96.28,128.04],[18.0,61.95,468.09,4.05,88.82,139.52,91.01,109.88],[18.0,63.93,454.45,3.78,85.28,131.01,85.62,93.2],[18.0,65.95,438.01,3.38,79.26,123.09,79.99,76.04],[18.0,67.96,423.27,3.02,73.16,115.92,75.01,61.98],[18.0,70.02,409.89,2.67,66.73,109.2,70.5,50.06],[20.0,39.99,659.45,5.93,92.24,334.76,198.6,597.56],[20.0,41.98,649.65,5.98,94.46,303.74,186.37,521.01],[20.0,43.98,636.77,5.92,95.44,276.77,174.37,448.79],[20.0,45.95,623.09,5.83,96.03,253.58,163.32,387.51],[20.0,47.98,609.4,5.72,96.31,232.61,152.98,333.95],[20.0,49.95,597.17,5.61,96.4,214.54,143.97,290.14],[20.0,51.93,585.9,5.5,96.37,198.5,135.88,253.25],[20.0,53.95,574.36,5.37,95.91,183.94,128.22,220.41],[20.0,55.95,563.68,5.24,95.48,171.05,121.35,193.1],[20.0,58.02,552.97,5.09,94.48,159.05,114.79,168.06],[20.0,59.99,541.57,4.89,92.74,148.78,108.73,146.17],[20.0,61.99,527.92,4.63,90.02,139.3,102.56,125.32],[20.0,63.95,510.54,4.27,85.75,130.93,96.16,105.19],[20.0,65.96,491.12,3.85,80.43,123.04,89.67,86.46],[20.0,67.92,474.52,3.46,74.84,116.05,84.14,71.2],[20.0,69.93,457.96,3.06,68.51,109.46,78.87,57.63],[22.03,39.96,726.34,6.52,92.13,335.2,218.89,658.69],[22.03,41.95,714.21,6.53,93.9,304.22,205.05,570.73],[22.03,43.96,699.62,6.47,94.94,276.99,191.66,491.06],[22.03,46.0,685.03,6.38,95.6,252.96,179.34,422.6],[22.03,47.99,671.34,6.29,96.15,232.45,168.48,366.92],[22.03,49.96,658.46,6.18,96.25,214.53,158.75,319.38],[22.03,51.97,645.87,6.07,96.38,198.2,149.67,278.58],[22.03,53.97,634.64,5.96,96.36,183.8,141.62,244.38],[22.03,55.94,624.07,5.85,96.17,171.09,134.36,215.4],[22.03,58.02,612.75,5.7,95.46,159.05,127.2,188.18],[22.03,60.02,599.1,5.46,93.5,148.61,120.21,162.75],[22.03,61.96,583.24,5.16,90.72,139.47,113.38,139.77],[22.03,63.95,564.58,4.76,86.61,130.89,106.32,117.44],[22.03,65.96,542.77,4.31,81.45,123.04,99.1,96.77],[22.03,67.99,523.21,3.87,75.97,115.83,92.68,79.46],[22.03,70.0,505.38,3.46,70.29,109.27,86.96,65.07],[24.0,39.98,789.07,7.04,91.6,334.91,237.69,710.48],[24.0,41.96,774.04,7.02,93.02,304.05,222.16,612.21],[24.0,43.95,759.5,6.96,93.99,277.11,208.11,528.14],[24.0,45.96,745.19,6.89,94.83,253.47,195.28,457.37],[24.0,47.98,731.02,6.8,95.5,232.58,183.51,397.14],[24.0,49.99,717.4,6.71,95.98,214.19,172.82,346.18],[24.0,52.0,704.72,6.6,96.08,197.97,163.21,302.49],[24.0,53.99,692.97,6.5,96.2,183.67,154.59,266.16],[24.0,56.02,681.48,6.39,96.2,170.6,146.51,234.29],[24.0,57.97,670.6,6.26,95.8,159.29,139.31,207.15],[24.0,59.93,656.88,6.03,94.15,149.05,132.0,180.49],[24.0,61.93,639.1,5.69,91.37,139.57,124.28,154.43],[24.0,63.94,617.11,5.23,87.03,130.94,116.24,129.07],[24.0,65.95,593.78,4.75,82.06,123.1,108.44,106.74],[24.0,67.97,571.23,4.28,76.9,115.9,101.22,87.9],[24.0,69.98,551.24,3.82,71.17,109.32,94.87,71.92],[26.0,39.98,843.25,7.44,90.58,334.95,254.03,750.97],[26.0,41.96,826.95,7.4,91.83,304.1,237.37,645.86],[26.0,43.94,812.55,7.36,92.96,277.25,222.7,559.26],[26.0,45.96,798.87,7.31,93.88,253.48,209.35,485.43],[26.0,47.97,784.68,7.24,94.67,232.66,197.01,422.8],[26.0,49.97,771.5,7.16,95.27,214.38,185.93,370.02],[26.0,51.97,758.73,7.08,95.71,198.25,175.84,325.11],[26.0,53.97,746.37,6.97,95.89,183.8,166.56,286.01],[26.0,55.98,734.31,6.86,95.89,170.82,157.97,252.13],[26.0,57.97,722.09,6.71,95.34,159.32,150.02,222.03],[26.0,59.99,705.75,6.42,93.4,148.77,141.69,191.84],[26.0,61.95,686.99,6.07,90.72,139.5,133.56,164.69],[26.0,63.94,665.64,5.65,87.08,130.95,125.38,139.31],[26.0,65.93,640.25,5.12,82.14,123.16,116.95,115.28],[26.0,67.96,614.43,4.59,76.68,115.9,108.88,94.28],[26.0,69.98,591.71,4.1,71.06,109.32,101.84,77.09],[29.0,40.01,922.3,7.96,88.62,334.48,277.65,801.88],[29.0,41.96,905.27,7.93,89.85,304.08,259.84,691.71],[29.0,43.93,889.59,7.89,91.02,277.37,243.87,599.93],[29.0,45.98,874.68,7.85,92.05,253.28,229.13,520.55],[29.0,47.96,861.9,7.81,92.98,232.79,216.46,456.5],[29.0,49.94,848.84,7.76,93.8,214.67,204.71,401.66],[29.0,51.96,836.46,7.7,94.45,198.31,193.89,353.86],[29.0,53.96,824.59,7.62,94.87,183.89,184.06,312.86],[29.0,55.93,812.7,7.53,95.1,171.12,174.99,277.47],[29.0,57.99,797.34,7.32,94.16,159.23,165.61,241.93],[29.0,59.99,776.2,6.94,91.73,148.77,155.84,207.22],[29.0,61.94,753.08,6.5,88.55,139.55,146.43,176.31],[29.0,63.94,729.08,6.04,85.06,130.94,137.32,149.03],[29.0,65.92,702.87,5.53,80.69,123.2,128.41,124.38],[29.0,67.92,675.14,4.98,75.65,116.04,119.71,102.39],[29.0,69.93,649.08,4.44,70.26,109.49,111.79,83.79],[31.98,39.95,993.97,8.39,86.59,335.44,299.65,848.05],[31.98,41.95,975.17,8.35,87.85,304.29,280.0,729.32],[31.98,43.98,957.99,8.31,89.03,276.81,262.35,630.01],[31.98,45.94,943.73,8.28,90.07,253.65,247.4,550.72],[31.98,47.98,929.56,8.25,91.08,232.57,233.34,481.63],[31.98,49.92,917.62,8.23,92.04,214.87,221.4,426.63],[31.98,51.96,906.12,8.2,92.86,198.31,210.04,376.88],[31.98,53.95,894.75,8.15,93.48,183.93,199.74,334.63],[31.98,55.96,882.5,8.06,93.75,170.93,189.92,296.55],[31.98,57.98,863.69,7.76,92.22,159.28,179.42,256.81],[31.98,59.98,837.09,7.27,89.14,148.83,168.09,217.29],[31.98,61.94,809.08,6.74,85.47,139.55,157.32,182.84],[31.98,63.97,780.89,6.21,81.64,130.82,147.02,153.0],[31.98,65.95,753.28,5.7,77.67,123.1,137.57,128.15],[31.98,67.97,723.44,5.13,72.76,115.87,128.18,105.3],[31.98,69.94,694.66,4.58,67.62,109.43,119.61,86.24]];
// columnas: [gamma_deg, n11_rpm, Q11_lps, P11_proto_kW, eta_proto_pct, H_proto_m, Q_proto_m3s, P_proto_MW]

/* ============================================================
   MODELO DE TURBINA — COLINA HIDRÁULICA (ensayo de modelo 2013,
   transposición IEC 60193 al prototipo; ampliación de rango 2023)
   ------------------------------------------------------------
   Fuente: 186 puntos de la tabla final de transposición al
   prototipo (12 aperturas de álabes directrices, 4.87°-31.98°).
   N=180 rpm, D=4.05972 m (valor usado en el ejemplo de escala del
   propio informe; existe una discrepancia documentada con 4.0584 m
   en los pies de figura 4.3/4.4, que se conserva como nota).
   Variables reducidas: n11=n·D/√H, Q11=Q/(D²√H), P11=P/(D²·H^1.5).
   Interpolación (el informe no especifica el método de contorneado
   usado en el ensayo): PCHIP (cúbica monótona, sin overshoot) a lo largo
   de n11 dentro de cada apertura ensayada, y también PCHIP entre
   aperturas (desde oct-2026; antes era lineal entre las dos aperturas
   vecinas, lo que subestimaba la eficiencia ~0,4 pp entre aperturas
   ensayadas — ver tests/modelo.test.js, validación cruzada).

   Transposición al prototipo (oct-2026): se usa la misma relación de
   gravedades que la tabla de transposición del informe,
   H_p = (n·D/n11)²·g_m/g_p, con g_m = 9,81 (laboratorio) y
   g_p = 9,7805 m/s² (sitio, valor del estudio de ampliación de GE, 2023). Con ella
   los 186 puntos de la tabla se reproducen con error medio de 0,04 %
   en caudal (antes 0,22 %). La potencia se calcula como
   P = η·ρ·g_p·Q·H con ρ = 996,2 kg/m³ (agua a 28,1 °C, temperatura del
   prototipo en el informe), en lugar de interpolar P11, que la tabla
   publica redondeado a 0,01 kW (error de hasta 5,6 % en cargas bajas).
   ============================================================ */
const G_MODELO = 9.81; // m/s², laboratorio (ensayo de modelo)
const G_SITIO = 9.7805; // m/s², PH Ituango (estudio de ampliación de GE, 2023, componentes de pérdida)
const RHO_AGUA_PROTOTIPO = 996.2; // kg/m³, agua a 28,1 °C
const N_TURBINA_RPM = 180;
const D_TURBINA_M = 4.05972; // ejemplo de escala del informe (ver discrepancia con 4.0584 m en notas)
const K_PERDIDA_CARGA = 0.000139635145108057; // h_loss = k*Q^2, revisión 2023 (por unidad)
const GAMMA_ORIGINAL_MAX = 26.5; // apertura mecánica original del distribuidor (grados)
const GAMMA_AMPLIADO_MAX = 30.2; // apertura extendida estudiada en 2023 (grados)
/* Factor de conversión (F.C.) que usa Hidrometría para ESTIMAR el caudal
   de cada unidad: Q = P_bornes / F.C. (MW por m³/s). No es una medición:
   en las unidades solo se mide la potencia. Los límites de la app siguen
   siendo la apertura mecánica y los 307 MW; el F.C. sirve para comparar
   con el modelo, para la regla operativa y para leer LoggerNet.
   Regla de la app de Hidrometría (nov-2026):
   - Hasta el 29-oct-2026 14:35 (hora de Colombia): 1,62 fijo (los "185
     m³/s máximos" que se citaban salen de 300 MW / 1,62).
   - Desde entonces: F.C. = 0,0119·N − 3,178, con N = nivel del embalse
     (radar), válido entre 390 y 420 msnm; sin nivel válido: 1,80.
     Ej.: 1,582 a 400 msnm, 1,725 a 412 msnm, 1,820 a 420 msnm.
   La columna QTurbinadoUx_FC de LoggerNet aplicó la fórmula desde el
   30-oct-2026 11:34 (antes seguía en 1,62); ver src/operacion.js. */
const FACTOR_HIDROMETRIA_MW_POR_M3S = 1.62;
const FC_HIDROMETRIA_POR_NIVEL = Object.freeze({ a: 0.0119, b: -3.178, desde: "2026-10-29 14:35", nivelMin: 390, nivelMax: 420, sinNivel: 1.8 });
/* Fecha y hora de Colombia (UTC−5, sin horario de verano) como texto
   "AAAA-MM-DD HH:MM". Acepta Date, milisegundos o texto "AAAA-MM-DD[ T]HH:MM[:SS]"
   (el texto se toma tal cual, ya en hora de Colombia). */
function textoHoraColombia(fecha) {
  if (fecha == null) return null;
  if (typeof fecha === "string") {
    const m = fecha.trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    return m ? `${m[1]} ${m[2] ?? "00"}:${m[3] ?? "00"}` : null;
  }
  const ms = fecha instanceof Date ? fecha.getTime() : Number(fecha);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms - 5 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
}
/* F.C. de Hidrometría vigente en una fecha (por defecto, el actual). */
function factorConversionHidrometria(nivelEmbalse, fecha = new Date()) {
  const R = FC_HIDROMETRIA_POR_NIVEL;
  const t = textoHoraColombia(fecha);
  if (t != null && t < R.desde) return FACTOR_HIDROMETRIA_MW_POR_M3S;
  const N = Number(nivelEmbalse);
  if (nivelEmbalse == null || !Number.isFinite(N) || N < R.nivelMin || N > R.nivelMax) return R.sinNivel;
  return R.a * N + R.b;
}

/* ============================================================
   REGLA OPERATIVA (Res. ANLA 1891), como la aplica Hidrometría:
   - Q_regulado = Q_generado + Q_descarga_intermedia; la fuente no trae
     la descarga intermedia y se toma 0. Q_generado = P_bornes / F.C.
   - Banda del día: promedio regulado del día anterior ± 4,70 %
     (variación permitida total 9,4 %).
   - Cumplimiento diario: el promedio regulado FINAL del día dentro de la
     banda. Lo horario o instantáneo es solo seguimiento.
   - Con vertimiento se suspende la validación (excepción hidráulica).
   ============================================================ */
const REGLA_OPERATIVA_RES1891 = Object.freeze({ bandaRelativa: 0.047 });
function bandaReglaOperativa(qPromedioDiaAnterior, banda = REGLA_OPERATIVA_RES1891.bandaRelativa) {
  if (!(qPromedioDiaAnterior > 0)) return null;
  return { base: qPromedioDiaAnterior, min: qPromedioDiaAnterior * (1 - banda), max: qPromedioDiaAnterior * (1 + banda) };
}
/* "cumple" | "por_encima" | "por_debajo" | "excepcion" (vertimiento) | "sin_base" */
function estadoReglaOperativa(qPromedio, banda, conVertimiento = false) {
  if (conVertimiento) return "excepcion";
  if (!banda || qPromedio == null || !Number.isFinite(qPromedio)) return "sin_base";
  if (qPromedio > banda.max + 1e-9) return "por_encima";
  if (qPromedio < banda.min - 1e-9) return "por_debajo";
  return "cumple";
}
const ETIQUETA_ESTADO_REGLA = Object.freeze({ cumple: "Cumple", por_encima: "Por encima", por_debajo: "Por debajo", excepcion: "Excepción (vertimiento)", sin_base: "Sin base" });
/* Potencia máxima GARANTIZADA por unidad: 307 MW — límite absoluto y
   explícito del estudio de ampliación de GE (2023): "no deberá exceder
   los límites de operación garantizada (potencia máx. de la turbina de
   307 MW)... la potencia no deberá ser superior al máximo de 307 MW."
   Este límite aplica SIEMPRE (no solo fuera de los escenarios 1-4), y es
   distinto de los escenarios específicos 3.1.1/4.2, que son evaluaciones
   puntuales — NO están dentro del rango de operación garantizado del
   proyecto (nota 4 del del documento). */
const P_MAXIMO_ESPERADO_MW = 307;
const GAMMA_ENSAYADO_MAX = 31.98; // máxima apertura con puntos experimentales reales (2013)

/* BASE DEL "% OPERATIVO POR UNIDAD" (Hidrometría EPM) — verificado con
   datos reales de operación (nivel embalse 408.21 m s.n.m., canales
   cerrados, U1 y U3 inoperativas):
     U2: Q=132.727 m³/s, P=215.018 MW → EPM reporta 71.7%
     U4: Q=111.254 m³/s, P=180.232 MW → EPM reporta 60.1%
   215.018/300 = 71.673% ≈ 71.7% ✓  |  180.232/300 = 60.077% ≈ 60.1% ✓
   Coincide, a la precisión reportada, con % = P_unidad / 300 MW — el
   mismo 300 MW documentado como "P_subestacion_MW" del Escenario 1
   (3.1.1, condiciones actuales) del estudio de ampliación 2023
   (ESCENARIOS_2023_EPM_GE). Esta es la base que usa Hidrometría EPM
   para el % operativo de cada unidad — INDEPENDIENTE por unidad, no
   una fracción de un total que deba sumar 100% (así lo confirmó el
   ingeniero de operaciones con este mismo ejemplo real: 71.7%+60.1%
   no suman 100 y no tienen por qué). No se intenta reproducir el par
   Q/P exacto de esta tabla con el modelo de colina (al resolver Q por
   colina para 132.727 m³/s, el modelo da P≈235.8 MW, no 215.0 MW — la
   colina es una idealización del ensayo de fábrica, no telemetría real;
   la base de 300 MW se validó contra el %, no contra el par Q/P). */
const POTENCIA_BASE_PCT_MW = 300;

/* ============================================================
   APERTURA EN PORCENTAJE — pedido por el ingeniero de operaciones:
   más fácil visualizar % que grados. BASE ELEGIDA: 100% = 30.2°
   (GAMMA_AMPLIADO_MAX, la apertura ampliada y garantizada por GE/EPM
   en el estudio 2023 — es el único límite de apertura que el
   documento fuente respalda numéricamente como techo de operación).
   No hay en ningún documento disponible una carrera 0-100% del
   servomotor distinta a esta — los 390/433 mm del estudio de ampliación de GE (2023)
   son el INCREMENTO de carrera estudiado en 2023, no la carrera total
   desde cierre completo, así que no sirven para derivar el 100% por
   sí solos. Con esta base, 31.98° (máximo ensayado en el modelo físico
   de 2013) cae en ~106% — fuera del 100%, tal como ya se advertía en
   grados; el motor físico interno (colina, GAMMAS_HILL, HILL_PROTO_186)
   sigue trabajando en grados sin ningún cambio — la conversión es solo
   una capa de presentación/entrada en la interfaz. */
function pctFromDeg(deg) { return (deg / GAMMA_AMPLIADO_MAX) * 100; }
function degFromPct(pct) { return (pct / 100) * GAMMA_AMPLIADO_MAX; }

/* Margen de maniobra del 3% pedido por el ingeniero de operaciones:
   los distribuidores operan normalmente hasta el 97% (GAMMA_NORMAL_MAX),
   reservando el 3% restante (hasta el 100% = 30.2°, ya garantizado por
   GE/EPM) exclusivamente para atender cambios de frecuencia del sistema
   eléctrico colombiano. Este 97% pasa a ser el techo mecánico POR
   DEFECTO de todo el Buscador; el 100% completo sigue disponible como
   opción explícita ("Ampliado"), marcada como reserva de frecuencia. */
const MARGEN_FRECUENCIA_PCT = 3;
const GAMMA_NORMAL_MAX = GAMMA_AMPLIADO_MAX * (1 - MARGEN_FRECUENCIA_PCT / 100); // ≈29.29°

/* Techo mecánico según el selector de rango de apertura del Buscador. */
function gammaMecanicoDeRango(rango) {
  if (rango === "ampliado") return GAMMA_AMPLIADO_MAX;
  if (rango === "normal") return GAMMA_NORMAL_MAX;
  return GAMMA_ORIGINAL_MAX; // "original"
}
function etiquetaRango(rango) {
  const g = (v, d) => v.toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d });
  if (rango === "ampliado") return `ampliado = 100 % (30,2°, usa la reserva de frecuencia)`;
  if (rango === "normal") return `normal ≤ 97 % (${g(GAMMA_NORMAL_MAX, 2)}°)`;
  return `original ≤ ${g(pctFromDeg(GAMMA_ORIGINAL_MAX), 0)} % (26,5°)`;
}

/* ============================================================
   NIVEL DE LA ALMENARA (aguas abajo) — CONDICIÓN DE DESCARGA
   ------------------------------------------------------------
   El salto neto depende del nivel de la almenara, y ese nivel NO es una
   constante: depende del nivel del río Cauca en las descargas (colmatado
   desde la contingencia de abril/2018), del caudal del río y del caudal
   turbinado por las unidades de la MISMA almenara. Cada almenara recibe
   4 unidades: N°1 = zona norte (U1-U4), N°2 = zona sur (U5-U8).

   OPERACIÓN CONJUNTA DE LAS DOS ALMENARAS (oct-2026)
   Las unidades 1-4 descargan en la almenara N°1 (norte) y las 5-8 en la
   N°2 (sur); cada almenara solo recibe el caudal de sus propias unidades.
   Con n unidades activas, el orden de despacho es 1 → 8 (el mismo que ya
   usaba la app): la almenara N°1 recibe min(n, 4) unidades y la N°2 el
   resto. Cada grupo se evalúa con el nivel de SU almenara; el caudal del
   río (en D4', aguas abajo de las 4 descargas) es uno solo e incluye lo
   turbinado por ambas. También se puede fijar el reparto explícito con
   cond.unidadesPorAlmenara = { norte, sur }.

   Tres condiciones seleccionables (ninguna se mezcla con otra):

   1) "diseno" — Condición de DISEÑO (río dragado). Valores del pliego de
      condiciones, cl. 7.5.4.2, Tabla 7.5.2, citados por GE en
      el estudio de ampliación de GE (2023) y en las características
      básicas del proyecto (num. 1.2.1): 213,0 (estático), 214,9 (1 ud),
      217,5 (3 ud), 218,8 (4 ud), por almenara. 2 unidades NO está en la
      fuente: se interpola entre 1 y 3. Es la única condición para la que
      GE (fabricante) tiene datos; GE exige restituir esas condiciones
      (dragado / cota de embalse).
      (Referencia histórica: la factibilidad F-PHI-DHE-ANA de 2007 usaba
      214,4 con 1 ud y 217,4 con 4 ud — no se usa aquí.)

   2) "ase" — Condición ACTUAL, río colmatado (sin dragado). Memoria
      estudio de almenaras de la ASE (2026),
      modelación HEC-RAS en estado permanente calibrada con los niveles del
      río monitoreados en 2025: Tabla 4-2 (almenara N°1) y Tabla 4-3
      (almenara N°2, columna "N.E Alm N°2"), en función del caudal del río
      en D4' (500 a 2660 m³/s) y del caudal turbinado por la almenara
      (0 a 675 m³/s). Cómo se usa (todo marcado en la app):
      a) Dentro de la tabla: interpolación bilineal.
      b) Celdas que la ASE no simuló (con 500 y 1000 m³/s en el río): se
         completan con el último valor simulado de esa fila más el
         incremento por generación de la fila más cercana que sí lo tiene
         (la tabla muestra que el nivel sube con el caudal turbinado).
      c) Caudal turbinado > 675 m³/s (4 × 168,75; hoy cada unidad pasa más
         que su caudal de diseño): extrapolación lineal con la pendiente
         del último tramo de la fila.
      d) Caudal del río < 500 m³/s (situación actual frecuente): se
         extrapola linealmente con la pendiente entre las filas de 500 y
         1000 m³/s de la misma columna, sin bajar de la corona del jarillón
         a la salida de las descargas (220 msnm almenara N°1, 218 msnm
         almenara N°2; misma memoria, num. 4.2), que es el control
         hidráulico aguas abajo mientras las descargas evacuan.
      e) Caudal del río > 2660 m³/s: se usa la fila de 2660 (no se
         extrapola hacia crecientes).
      Nota: estos datos de la Asesoría difieren de los de GE (p. ej. GE 2023
      usó 224,3 m con 1 unidad y 408,3 m de embalse — valor informado por
      EPM; la tabla ASE da 224,79 m con 1 unidad y Q río = 1350 m³/s).

   3) "manual" — nivel de cada almenara ingresado directamente (p. ej.
      lectura de Hidrometría): almManual = { norte, sur } (msnm).
   ============================================================ */
const ALMENARA_PUNTOS = [
  [0, 213, "estático — pliego, Tabla 7.5.2 (citada en el estudio de ampliación de GE, 2023)"],
  [1, 214.9, "1 unidad al 100% — pliego, Tabla 7.5.2"],
  [2, 216.2, "interpolado linealmente entre 1 y 3 unidades — NO está en la fuente"],
  [3, 217.5, "3 unidades al 100% — pliego, Tabla 7.5.2"],
  [4, 218.8, "4 unidades al 100% — pliego, Tabla 7.5.2"],
];
/* Condición de diseño (pliego): nivel de UNA almenara con nAlmenara
   unidades propias (0 a 4). */
function nivelAlmenara(nAlmenara) {
  return interp1(Math.max(0, Math.min(4, nAlmenara)), ALMENARA_PUNTOS.map(([n, h]) => [n, h]));
}

const UNIDADES_POR_ALMENARA = 4;
const ZONAS = ["norte", "sur"];
const NOMBRE_ALMENARA = { norte: "Almenara N°1 (U1-U4)", sur: "Almenara N°2 (U5-U8)" };
/* Reparto de n unidades activas entre almenaras (orden de despacho 1 → 8),
   salvo que la condición fije el reparto explícito. */
function unidadesPorAlmenara(nTurbActivas, cond) {
  if (cond && cond.unidadesPorAlmenara) {
    const u = cond.unidadesPorAlmenara;
    return { norte: Math.max(0, Math.min(4, Math.round(u.norte || 0))), sur: Math.max(0, Math.min(4, Math.round(u.sur || 0))) };
  }
  const n = Math.max(0, Math.min(2 * UNIDADES_POR_ALMENARA, Math.round(nTurbActivas)));
  return { norte: Math.min(n, UNIDADES_POR_ALMENARA), sur: Math.max(0, n - UNIDADES_POR_ALMENARA) };
}

/* Caudal de generación por almenara simulado por la ASE (Tabla 4-1):
   0, ½, 1, 2, 3 y 4 unidades de 168,75 m³/s. */
const ASE_Q_GENERACION = [0, 84.38, 168.75, 337.5, 506.25, 675.0];
/* Niveles en la almenara (msnm) por caudal del río Cauca (m³/s, punto D4').
   null = combinación no simulada por la ASE (Tabla 4-1: con 500 y 1000 m³/s
   en el río no se simulan todas las unidades). Valores transcritos tal cual. */
const ASE_ALMENARA = {
  norte: {
    nombre: "Almenara N°1 (zona norte, U1-U4)",
    fuente: "estudio de almenaras de la ASE (2026), Tabla 4-2 (río colmatado)",
    coronaJarillon: 220.0,
    filas: [
      [500, [222.60, 222.70, 222.78, null, null, null]],
      [1000, [225.50, 225.60, 225.70, 226.20, null, null]],
      [1350, [224.61, 224.70, 224.79, 225.29, 226.16, 227.37]],
      [1500, [226.50, 226.60, 226.70, 227.30, 228.00, 229.00]],
      [2000, [227.35, 227.45, 227.65, 228.30, 229.00, 230.00]],
      [2660, [227.79, 227.95, 228.28, 228.79, 229.65, 230.86]],
    ],
  },
  sur: {
    nombre: "Almenara N°2 (zona sur, U5-U8)",
    fuente: "estudio de almenaras de la ASE (2026), Tabla 4-3, columna N.E Alm N°2 (río colmatado)",
    coronaJarillon: 218.0,
    filas: [
      [500, [221.16, 221.20, 221.32, null, null, null]],
      [1000, [222.80, 222.90, 223.00, 223.12, 223.67, 224.42]],
      [1350, [223.74, 223.85, 224.02, 224.24, 224.80, 225.62]],
      [1500, [224.35, 224.45, 224.50, 224.58, 224.81, 225.45]],
      [2000, [225.40, 225.50, 225.60, 225.76, 226.01, 226.55]],
      [2660, [226.78, 226.95, 227.10, 227.16, 227.43, 227.96]],
    ],
  },
};
const ASE_Q_RIO_MIN = 500;
const ASE_Q_RIO_MAX = 2660;
const CONDICION_DESCARGA_DISENO = Object.freeze({ modo: "diseno" });
const CONDICION_DESCARGA_DEFECTO = Object.freeze({ modo: "ase", qRio: 400, almManual: Object.freeze({ norte: 224.3, sur: 224.3 }) });

/* Condición vigente para el modelo: la calibrada por el proceso automático
   (derivados/estado.json → condicionModelo, ver src/calibracion.js); si no
   hay calibración, la de la ASE. */
function condicionVigente(estadoProceso) {
  const c = estadoProceso && estadoProceso.condicionModelo;
  if (c && c.modo === "manual" && c.calibrada && c.almManual && Number.isFinite(c.almManual.norte) && Number.isFinite(c.almManual.sur)) return c;
  return CONDICION_DESCARGA_DEFECTO;
}

/* Tabla completa (regla b): cada celda lleva su origen ("ase" o "completada"). */
function completarTablaASE(filas) {
  return filas.map(([qRio, niveles], i) => {
    const jUlt = niveles.reduce((u, v, j) => (v != null ? j : u), -1);
    const celdas = niveles.map((v, j) => {
      if (v != null) return { v, origen: "ase" };
      // fila más cercana (en caudal del río) que tenga la columna j y la jUlt
      let mejor = null;
      filas.forEach(([q2, n2], k) => {
        if (k === i || n2[j] == null || n2[jUlt] == null) return;
        const d = Math.abs(q2 - qRio);
        if (!mejor || d < mejor.d || (d === mejor.d && q2 > mejor.q)) mejor = { d, q: q2, n: n2 };
      });
      return { v: niveles[jUlt] + (mejor.n[j] - mejor.n[jUlt]), origen: "completada", desde: mejor.q };
    });
    return [qRio, celdas];
  });
}
const ASE_TABLA_COMPLETA = { norte: completarTablaASE(ASE_ALMENARA.norte.filas), sur: completarTablaASE(ASE_ALMENARA.sur.filas) };

/* Nivel en una fila (caudal del río fijo) para un caudal turbinado: lineal
   dentro de la tabla; sobre 675 m³/s, pendiente del último tramo (regla c). */
function aseEnFila(celdas, qGen) {
  const xs = ASE_Q_GENERACION;
  const ult = xs.length - 1;
  if (qGen > xs[ult]) {
    const m = (celdas[ult].v - celdas[ult - 1].v) / (xs[ult] - xs[ult - 1]);
    return { v: celdas[ult].v + m * (qGen - xs[ult]), completada: celdas[ult].origen !== "ase" || celdas[ult - 1].origen !== "ase", extrapGen: true };
  }
  let j = 0;
  while (j < ult - 1 && xs[j + 1] <= qGen) j++;
  const w = (qGen - xs[j]) / (xs[j + 1] - xs[j]);
  const usaCompletada = (w < 1 && celdas[j].origen !== "ase") || (w > 0 && celdas[j + 1].origen !== "ase");
  return { v: celdas[j].v * (1 - w) + celdas[j + 1].v * w, completada: usaCompletada, extrapGen: false };
}
/* Nivel de la almenara según la tabla ASE (reglas a-e). */
function nivelAlmenaraASE(zona, qRio, qGenAlmenara) {
  const z = ASE_TABLA_COMPLETA[zona] ? zona : "norte";
  const filas = ASE_TABLA_COMPLETA[z];
  const qGen = Math.max(0, qGenAlmenara || 0);
  const rioSobreMax = qRio > ASE_Q_RIO_MAX;
  const extrapRioBajo = qRio < ASE_Q_RIO_MIN;
  const qR = Math.min(qRio, ASE_Q_RIO_MAX);
  let i = 0;
  while (i < filas.length - 2 && filas[i + 1][0] <= qR) i++;
  const [r0, c0] = filas[i];
  const [r1, c1] = filas[i + 1];
  const a = aseEnFila(c0, qGen);
  const b = aseEnFila(c1, qGen);
  const w = (qR - r0) / (r1 - r0); // < 0 si el río está por debajo de 500 (extrapolación, regla d)
  let nivel = a.v * (1 - w) + b.v * w;
  const corona = ASE_ALMENARA[z].coronaJarillon;
  const enPiso = nivel < corona;
  if (enPiso) nivel = corona;
  const completada = (w < 1 && a.completada) || (w > 0 && b.completada) || (extrapRioBajo && (a.completada || b.completada));
  const extrapGen = a.extrapGen || b.extrapGen;
  const avisos = [];
  if (extrapRioBajo) avisos.push(`río ${Math.round(qRio)} m³/s < ${ASE_Q_RIO_MIN} (extrapolado con la pendiente 500-1000)`);
  if (rioSobreMax) avisos.push(`río ${Math.round(qRio)} m³/s > ${ASE_Q_RIO_MAX} (se usa la fila de ${ASE_Q_RIO_MAX})`);
  if (extrapGen) avisos.push(`turbinado ${Math.round(qGen)} m³/s > 675 (extrapolado)`);
  if (completada) avisos.push("celda no simulada por la ASE (completada)");
  if (enPiso) avisos.push(`limitado a la corona del jarillón (${corona} msnm)`);
  return { nivel, fueraDeTabla: avisos.length > 0, extrapRioBajo, rioSobreMax, extrapGen, completada, enPiso, avisos };
}
/* Nivel de UNA almenara (zona) con nAlmenara unidades propias a qUnidad
   cada una, para la condición elegida. */
function nivelAlmenaraSegunCondicion(cond, zona, nAlmenara, qUnidad) {
  const c = cond || CONDICION_DESCARGA_DISENO;
  const z = zona === "sur" ? "sur" : "norte";
  const nZ = Math.max(0, Math.min(4, Math.round(nAlmenara)));
  if (c.modo === "manual") {
    const m = c.almManual;
    const v = typeof m === "number" ? m : m && Number.isFinite(m[z]) ? m[z] : null;
    if (Number.isFinite(v)) return { nivel: v, fuente: "manual", zona: z, fueraDeTabla: false, avisos: [] };
  }
  if (c.modo === "ase") {
    // qAlmenara: caudal total de esa almenara fijado desde afuera (unidades a
    // distinta potencia, ver resolverUnidadesConPotencias); si no, nZ × qUnidad.
    const qGen = c.qAlmenara && Number.isFinite(c.qAlmenara[z]) ? c.qAlmenara[z] : nZ * Math.max(0, qUnidad || 0);
    return { ...nivelAlmenaraASE(z, c.qRio, qGen), fuente: "ase", zona: z, qGenAlmenara: qGen };
  }
  return { nivel: nivelAlmenara(nZ), fuente: "diseno", zona: z, fueraDeTabla: false, avisos: [] };
}
function etiquetaCondicionDescarga(cond) {
  const c = cond || CONDICION_DESCARGA_DISENO;
  if (c.modo === "manual" && c.calibrada) {
    const n = c.almManual && Number(c.almManual.norte);
    return `calibrada con Hidrometría y Winter-Kennedy: almenara equivalente ${Number.isFinite(n) ? n.toFixed(2).replace(".", ",") : "—"} msnm`;
  }
  if (c.modo === "manual") {
    const m = c.almManual || {};
    return typeof m === "number" ? `almenaras manual ${m.toFixed(2)} msnm` : `almenaras manual N°1 ${Number(m.norte).toFixed(2)} / N°2 ${Number(m.sur).toFixed(2)} msnm`;
  }
  if (c.modo === "ase") return `río colmatado (ASE 2026), Q río ${Math.round(c.qRio)} m³/s`;
  return "diseño GE / pliego (río dragado)";
}

const GAMMAS_HILL = [...new Set(HILL_PROTO_186.map((r) => r[0]))].sort((a, b) => a - b);

/* PCHIP (Fritsch-Carlson): interpolación cúbica monótona por tramos,
   pasa exactamente por los datos, sin oscilaciones espurias entre
   puntos — no asume ninguna forma de curva no presente en los datos. */
function pchipPendientes(xs, ys) {
  const n = xs.length;
  const h = new Array(n - 1), delta = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; delta[i] = (ys[i + 1] - ys[i]) / h[i]; }
  const m = new Array(n);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1] === 0 || delta[i] === 0 || (delta[i - 1] > 0) !== (delta[i] > 0)) { m[i] = 0; continue; }
    const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
    m[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
  }
  return m;
}
function pchipEval(xs, ys, ms, x) {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
  const h = xs[hi] - xs[lo], t = (x - xs[lo]) / h;
  const h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t;
  const h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
  return h00 * ys[lo] + h10 * h * ms[lo] + h01 * ys[hi] + h11 * h * ms[hi];
}
/* Pre-cálculo de las pendientes PCHIP por cada apertura ensayada — se
   hace UNA sola vez al cargar, no en cada consulta. Antes, cada
   evaluación de la colina (miles de veces al construir las mallas de
   contorno, y repetidamente durante la simulación cuando el modelo de
   turbina es "colina") volvía a filtrar los 186 puntos y a resolver el
   sistema PCHIP desde cero — esta era la causa principal de la lentitud. */
function precalcularGammas(datos, idxGamma, idxN11, idxQ11, idxP11, idxEta) {
  const gammas = [...new Set(datos.map((r) => r[idxGamma]))].sort((a, b) => a - b);
  const porGamma = {};
  for (const g of gammas) {
    const puntos = datos.filter((r) => r[idxGamma] === g).sort((a, b) => a[idxN11] - b[idxN11]);
    const xs = puntos.map((p) => p[idxN11]);
    const q11s = puntos.map((p) => p[idxQ11]);
    const p11s = puntos.map((p) => p[idxP11]);
    const etas = puntos.map((p) => p[idxEta]);
    porGamma[g] = {
      xs, q11s, p11s, etas,
      mQ: pchipPendientes(xs, q11s), mP: pchipPendientes(xs, p11s), mE: pchipPendientes(xs, etas),
    };
  }
  return { gammas, porGamma };
}
const PRECALC_PROTO = precalcularGammas(HILL_PROTO_186, 0, 1, 2, 3, 4);

/* Interpola Q11, P11 y η a una apertura cualquiera para un n11 dado:
   PCHIP en n11 dentro de cada apertura ensayada y luego PCHIP entre las
   aperturas. Dominio igual que antes: si alguna de las dos aperturas
   ensayadas vecinas no cubre ese n11, devuelve null (no se extrapola).
   Entre aperturas se usan solo las contiguas que sí cubren ese n11. */
const N11_TOLERANCIA_BORDE = 0.03; // rpm: resolución publicada de n11 (0,01) + diferencia residual de constantes de transposición (~0,02 %)
function interpolarEntreAperturas(precalc, gammas, gamma, n11) {
  const enApertura = (g) => {
    const c = precalc.porGamma[g];
    // Tolerancia en los bordes: n11 y H están publicados redondeados y la
    // tabla deja un residuo de ~0,02 % entre ambos, así que un punto de la
    // propia tabla puede caer hasta ~0,02 rpm fuera del rango. Dentro de esa
    // tolerancia se toma el valor del borde (no es extrapolación).
    if (!c || n11 < c.xs[0] - N11_TOLERANCIA_BORDE || n11 > c.xs[c.xs.length - 1] + N11_TOLERANCIA_BORDE) return null;
    const x = Math.min(Math.max(n11, c.xs[0]), c.xs[c.xs.length - 1]);
    return { Q11: pchipEval(c.xs, c.q11s, c.mQ, x), P11: pchipEval(c.xs, c.p11s, c.mP, x), eta: pchipEval(c.xs, c.etas, c.mE, x) };
  };
  let iLo, iHi;
  if (gamma <= gammas[0]) iLo = iHi = 0;
  else if (gamma >= gammas[gammas.length - 1]) iLo = iHi = gammas.length - 1;
  else {
    iHi = gammas.findIndex((g) => g >= gamma);
    iLo = gammas[iHi] === gamma ? iHi : iHi - 1;
  }
  const rLo = enApertura(gammas[iLo]);
  if (!rLo) return null;
  if (iLo === iHi) return rLo;
  if (!enApertura(gammas[iHi])) return null;
  let i0 = iLo, i1 = iHi;
  while (i0 - 1 >= 0 && enApertura(gammas[i0 - 1])) i0--;
  while (i1 + 1 < gammas.length && enApertura(gammas[i1 + 1])) i1++;
  const xs = gammas.slice(i0, i1 + 1);
  const vals = xs.map(enApertura);
  const out = {};
  for (const k of ["Q11", "P11", "eta"]) {
    const ys = vals.map((v) => v[k]);
    out[k] = pchipEval(xs, ys, pchipPendientes(xs, ys), gamma);
  }
  return out;
}

function n11DeH(H) {
  return (N_TURBINA_RPM * D_TURBINA_M) / Math.sqrt(H * G_SITIO / G_MODELO);
}
/* Evalúa la colina para un salto neto H y una apertura gamma dados.
   Devuelve también las variables reducidas (n11, Q11, P11 interpolado
   de la tabla, que se usa en los gráficos en variables reducidas). */
function evaluarHillChart(H, gamma) {
  const n11 = n11DeH(H);
  const r = interpolarEntreAperturas(PRECALC_PROTO, GAMMAS_HILL, gamma, n11);
  if (!r) return null;
  const { Q11, P11, eta } = r;
  const Q = (Q11 / 1000) * D_TURBINA_M ** 2 * Math.sqrt(H * G_SITIO / G_MODELO);
  const P = ((eta / 100) * RHO_AGUA_PROTOTIPO * G_SITIO * Q * H) / 1e6; // MW
  return { n11, Q11, P11, eta, Q, P };
}

/* Una unidad de la almenara `zona`, con nAlmenara unidades propias en el
   mismo punto: salto neto = embalse − almenara − k·Q². Se itera porque Q
   depende del salto y, con la condición ASE, la almenara depende de Q. */
function evaluarUnidadEnAlmenara(nivelEmbalse, gamma, zona, nAlmenara, cond) {
  let alm = nivelAlmenaraSegunCondicion(cond, zona, nAlmenara, 0);
  let hLoss = 0;
  let resultado = null;
  for (let i = 0; i < 40; i++) {
    const Hneta = nivelEmbalse - alm.nivel - hLoss;
    if (Hneta <= 0) return null;
    resultado = evaluarHillChart(Hneta, gamma);
    if (!resultado) return null;
    const hLossNueva = K_PERDIDA_CARGA * resultado.Q ** 2;
    const almNueva = nivelAlmenaraSegunCondicion(cond, zona, nAlmenara, resultado.Q);
    const convergio = Math.abs(hLossNueva - hLoss) < 1e-5 && Math.abs(almNueva.nivel - alm.nivel) < 1e-5;
    hLoss = hLossNueva;
    alm = almNueva;
    if (convergio) break;
  }
  const saltoBruto = nivelEmbalse - alm.nivel;
  return {
    ...resultado, saltoBruto, hLoss, saltoNeto: saltoBruto - hLoss, nivelAlmenara: alm.nivel,
    zona, unidades: nAlmenara, fuenteAlmenara: alm.fuente, almenaraFueraDeTabla: !!alm.fueraDeTabla, avisosAlmenara: alm.avisos || [],
  };
}

/* Unidad "promedio" de las nTurbActivas unidades activas, todas con la misma
   apertura gamma (supuesto de la app). Si todas están en una sola almenara,
   es exactamente esa unidad. Si hay unidades en las dos almenaras, cada
   grupo se evalúa con su propia almenara y se devuelve el promedio por
   unidad (Q y P promedio; η = P total / potencia hidráulica total) y el
   detalle en porAlmenara. Pmax = mayor potencia de una unidad (para el
   límite garantizado de 307 MW, que aplica a CADA unidad).
   cond: condición de descarga; por defecto la de diseño. */
function evaluarTurbinaUnidad(nivelEmbalse, gamma, nTurbActivas, cond = CONDICION_DESCARGA_DISENO) {
  const rep = unidadesPorAlmenara(nTurbActivas, cond);
  const grupos = ZONAS.filter((z) => rep[z] > 0);
  if (grupos.length === 0) grupos.push("norte"); // 0 unidades: almenara N°1 en reposo
  const porAlmenara = {};
  for (const z of grupos) {
    const r = evaluarUnidadEnAlmenara(nivelEmbalse, gamma, z, rep[z], cond);
    if (!r) return null;
    porAlmenara[z] = r;
  }
  if (grupos.length === 1) {
    const r = porAlmenara[grupos[0]];
    return { ...r, Pmax: r.P, porAlmenara };
  }
  const n = rep.norte + rep.sur;
  const N = porAlmenara.norte, S = porAlmenara.sur;
  const prom = (k) => (rep.norte * N[k] + rep.sur * S[k]) / n;
  const Q = prom("Q"), P = prom("P");
  const pHid = (r) => (RHO_AGUA_PROTOTIPO * G_SITIO * r.Q * r.saltoNeto) / 1e6;
  const eta = (100 * (rep.norte * N.P + rep.sur * S.P)) / (rep.norte * pHid(N) + rep.sur * pHid(S));
  return {
    n11: prom("n11"), Q11: prom("Q11"), P11: prom("P11"), eta, Q, P, Pmax: Math.max(N.P, S.P),
    saltoBruto: prom("saltoBruto"), hLoss: prom("hLoss"), saltoNeto: prom("saltoNeto"), nivelAlmenara: prom("nivelAlmenara"),
    fuenteAlmenara: N.fuenteAlmenara, almenaraFueraDeTabla: N.almenaraFueraDeTabla || S.almenaraFueraDeTabla,
    avisosAlmenara: [...N.avisosAlmenara.map((a) => `N°1: ${a}`), ...S.avisosAlmenara.map((a) => `N°2: ${a}`)],
    porAlmenara, dosAlmenaras: true,
  };
}

/* Problema inverso: dado un caudal objetivo por unidad, encuentra la
   apertura gamma (bisección) que lo logra a ese nivel de embalse.
   gammaMax: 26.5 (rango original) o 30.2 (rango ampliado 2023). */
function resolverGammaParaCaudal(nivelEmbalse, qObjetivoUnidad, nTurbActivas, gammaMax, cond = CONDICION_DESCARGA_DISENO) {
  if (qObjetivoUnidad <= 1e-6) return { gamma: 0, resultado: null, alcanzable: true };
  const rMax = evaluarTurbinaUnidad(nivelEmbalse, gammaMax, nTurbActivas, cond);
  if (!rMax) return { gamma: 0, resultado: null, alcanzable: false };
  if (qObjetivoUnidad >= rMax.Q) return { gamma: gammaMax, resultado: rMax, alcanzable: qObjetivoUnidad <= rMax.Q * 1.01 };
  // Por debajo del caudal que da la apertura mínima REALMENTE ensayada
  // (GAMMAS_HILL[0]=4.87°) no hay datos que respalden un punto de
  // operación intermedio — y evaluarTurbinaUnidad SATURA cualquier
  // apertura menor a esa al valor de 4.87°, así que sin este chequeo la
  // bisección de abajo terminaría devolviendo γ≈0 con "alcanzable: true"
  // aunque en realidad esté entregando el caudal de 4.87° (más del
  // objetivo), no el objetivo pedido. Se marca explícitamente como no
  // alcanzable en vez de reportar un punto de operación ficticio.
  const rMin = evaluarTurbinaUnidad(nivelEmbalse, GAMMAS_HILL[0], nTurbActivas, cond);
  if (rMin && qObjetivoUnidad < rMin.Q) {
    return { gamma: GAMMAS_HILL[0], resultado: rMin, alcanzable: false, debajoDelMinimoEnsayado: true, qMinimoEnsayado: rMin.Q };
  }
  let lo = 0, hi = gammaMax;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const r = evaluarTurbinaUnidad(nivelEmbalse, mid, nTurbActivas, cond);
    if (!r || r.Q < qObjetivoUnidad) lo = mid; else hi = mid;
  }
  const gammaFinal = (lo + hi) / 2;
  return { gamma: gammaFinal, resultado: evaluarTurbinaUnidad(nivelEmbalse, gammaFinal, nTurbActivas, cond), alcanzable: true };
}

/* Problema inverso por POTENCIA (para la calculadora de despacho
   intradiario, punto 4 del pedido del ingeniero de operaciones): dado
   un objetivo de potencia por unidad, encuentra por bisección la
   apertura gamma que lo logra a ese nivel de embalse — misma lógica que
   resolverGammaParaCaudal, pero bisectando sobre P en vez de Q (P
   también crece monótonamente con γ, igual que Q, dentro del rango
   ensayado). Respeta DOS techos, igual que el resto del buscador: el
   mecánico (gammaMax) y la potencia máxima GARANTIZADA por unidad
   (potenciaMaxMW, 307 MW del estudio de ampliación de GE, 2023); el efectivo
   es el más restrictivo de los dos a este nivel de embalse (a niveles
   bajos, el techo mecánico por sí solo puede superar 307 MW, igual que
   ya maneja picoEficiencia/resolverGammaConLimitePotencia). Si el
   objetivo supera lo alcanzable dentro de esos techos, devuelve el
   máximo posible y marca alcanzable=false. */
function resolverGammaParaPotencia(nivelEmbalse, pObjetivoUnidad, nTurbActivas, gammaMax, potenciaMaxMW, cond = CONDICION_DESCARGA_DISENO) {
  // Unidad detenida (0 MW pedidos): distribuidor cerrado, sin caudal turbinado.
  // No se usa evaluarTurbinaUnidad(nivelEmbalse, 0, ...) porque esa función
  // SATURA cualquier apertura por debajo de la mínima ensayada (4.87°) al
  // valor de esa apertura — devolvería caudal/potencia como si la unidad
  // estuviera generando, lo cual es físicamente incorrecto para 0 MW.
  if (pObjetivoUnidad <= 1e-6) return { gamma: 0, resultado: { Q: 0, P: 0, eta: 0, saltoNeto: null }, alcanzable: true };
  // Techo mecánico EFECTIVO: si la potencia en gammaMax ya supera la
  // garantizada, se recorta a la apertura donde se alcanza exactamente
  // potenciaMaxMW (misma bisección que resolverGammaConLimitePotencia).
  let gammaMaxEfectivo = gammaMax;
  if (potenciaMaxMW != null) {
    const rEnMecanico = evaluarTurbinaUnidad(nivelEmbalse, gammaMax, nTurbActivas, cond);
    if (rEnMecanico && (rEnMecanico.Pmax ?? rEnMecanico.P) > potenciaMaxMW) {
      let loP = 0, hiP = gammaMax;
      for (let i = 0; i < 30; i++) {
        const mid = (loP + hiP) / 2;
        const r = evaluarTurbinaUnidad(nivelEmbalse, mid, nTurbActivas, cond);
        if (!r || (r.Pmax ?? r.P) < potenciaMaxMW) loP = mid; else hiP = mid;
      }
      gammaMaxEfectivo = (loP + hiP) / 2;
    }
  }
  // Por debajo de la potencia que da la apertura mínima REALMENTE ensayada
  // (GAMMAS_HILL[0]=4.87°) no hay datos del modelo que respalden un punto
  // de operación intermedio — y en la práctica una unidad no se sostiene
  // establemente en aperturas tan bajas: o genera al menos ese mínimo, o
  // está detenida. Se marca explícitamente como no alcanzable en vez de
  // inventar un punto sin respaldo en los 186 puntos ensayados.
  const rMin = evaluarTurbinaUnidad(nivelEmbalse, GAMMAS_HILL[0], nTurbActivas, cond);
  if (rMin && pObjetivoUnidad < rMin.P) {
    return { gamma: 0, resultado: { Q: 0, P: 0, eta: 0, saltoNeto: rMin.saltoNeto }, alcanzable: false, debajoDelMinimoEnsayado: true, pMinimoEnsayado: rMin.P };
  }
  const rMax = evaluarTurbinaUnidad(nivelEmbalse, gammaMaxEfectivo, nTurbActivas, cond);
  if (!rMax) return { gamma: 0, resultado: null, alcanzable: false };
  if (pObjetivoUnidad >= rMax.P) {
    return { gamma: gammaMaxEfectivo, resultado: rMax, alcanzable: pObjetivoUnidad <= rMax.P * 1.001, limitadoPorPotencia: gammaMaxEfectivo < gammaMax - 1e-6 };
  }
  let lo = 0, hi = gammaMaxEfectivo;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const r = evaluarTurbinaUnidad(nivelEmbalse, mid, nTurbActivas, cond);
    if (!r || r.P < pObjetivoUnidad) lo = mid; else hi = mid;
  }
  const gammaFinal = (lo + hi) / 2;
  return { gamma: gammaFinal, resultado: evaluarTurbinaUnidad(nivelEmbalse, gammaFinal, nTurbActivas, cond), alcanzable: true, limitadoPorPotencia: false };
}

/* Igual que resolverGammaParaCaudal, pero además respeta un límite de
   potencia por unidad (307 MW, garantía del estudio de ampliación de GE (2023)):
   primero se busca por bisección la apertura γ a la que se alcanzaría
   exactamente esa potencia (P crece con γ, igual que Q); si esa apertura
   es menor que la mecánica (30.2°), se usa como techo EFECTIVO de la
   búsqueda de caudal — es decir, la potencia manda si es más restrictiva
   que el límite mecánico del distribuidor. */
/* Punto de MÁXIMA EFICIENCIA real de una unidad a un salto dado — busca
   sobre γ (no sobre caudal) cuál valor da la mayor eficiencia posible,
   respetando dos techos: el mecánico (30.2°) y el de potencia (307 MW,
   garantía del estudio de ampliación de GE (2023)). El de potencia es un
   TECHO, no una meta — si el pico natural de eficiencia ya está por
   debajo de 307 MW, no se empuja la apertura más allá solo para
   "alcanzar" la potencia máxima (eso reduce la eficiencia sin necesidad,
   como se confirmó numéricamente: en H=415, forzar Q más alto llevaba de
   η=96.38% en el pico real a η=95.87% en el punto de 307 MW). */
function picoEficiencia(nivelEmbalse, nTurbActivas, gammaMaxMecanico, potenciaMaxMW, cond = CONDICION_DESCARGA_DISENO) {
  const gammaMin = GAMMAS_HILL[0];
  let gammaMaxEfectivo = gammaMaxMecanico;
  const rTope = evaluarTurbinaUnidad(nivelEmbalse, gammaMaxMecanico, nTurbActivas, cond);
  let limitadoPorPotencia = false;
  if (rTope && (rTope.Pmax ?? rTope.P) > potenciaMaxMW) {
    let lo = gammaMin, hi = gammaMaxMecanico;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const r = evaluarTurbinaUnidad(nivelEmbalse, mid, nTurbActivas, cond);
      if (!r || (r.Pmax ?? r.P) < potenciaMaxMW) lo = mid; else hi = mid;
    }
    gammaMaxEfectivo = (lo + hi) / 2;
    limitadoPorPotencia = true;
  }
  let mejorEta = -1, mejorGamma = gammaMaxEfectivo, mejorR = null;
  const pasos = 260;
  for (let i = 0; i <= pasos; i++) {
    const g = gammaMin + (i / pasos) * (gammaMaxEfectivo - gammaMin);
    const r = evaluarTurbinaUnidad(nivelEmbalse, g, nTurbActivas, cond);
    if (r && r.eta > mejorEta) { mejorEta = r.eta; mejorGamma = g; mejorR = r; }
  }
  return { gamma: mejorGamma, resultado: mejorR, limitadoPorPotencia: limitadoPorPotencia && mejorGamma >= gammaMaxEfectivo - 0.01 };
}

function resolverGammaConLimitePotencia(nivelEmbalse, qObjetivoUnidad, nTurbActivas, gammaMaxMecanico, potenciaMaxMW, cond = CONDICION_DESCARGA_DISENO) {
  const rEnMecanico = evaluarTurbinaUnidad(nivelEmbalse, gammaMaxMecanico, nTurbActivas, cond);
  let gammaMaxEfectivo = gammaMaxMecanico;
  let limitadoPorPotencia = false;
  if (rEnMecanico && (rEnMecanico.Pmax ?? rEnMecanico.P) > potenciaMaxMW) {
    let lo = 0, hi = gammaMaxMecanico;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const r = evaluarTurbinaUnidad(nivelEmbalse, mid, nTurbActivas, cond);
      if (!r || (r.Pmax ?? r.P) < potenciaMaxMW) lo = mid; else hi = mid;
    }
    gammaMaxEfectivo = (lo + hi) / 2;
    limitadoPorPotencia = true;
  }
  const r = resolverGammaParaCaudal(nivelEmbalse, qObjetivoUnidad, nTurbActivas, gammaMaxEfectivo, cond);
  return { ...r, limitadoPorPotencia: limitadoPorPotencia && r.gamma >= gammaMaxEfectivo * 0.999 };
}
const WAE_PUNTOS = [[52.09,338.42,2.97,89.98,12.6,197.3,78.24,135.34,8],[52.09,418,3.8,93.23,14.98,197.3,96.64,173.21,10],[52.09,496.97,4.61,95.21,17.35,197.3,114.9,210.32,15],[52.09,576.43,5.41,96.3,19.73,197.3,133.27,246.74,22],[52.09,648.12,6.09,96.38,22.13,197.3,149.85,277.66,25],[52.09,719.37,6.73,96.01,24.55,197.3,166.32,307,20]];
// columnas: [n11_rpm, Q11_lps, P11_proto_kW, eta_proto_pct, gamma_deg, H_proto_m, Q_proto_m3s, P_proto_MW, weight_pct]

/* Tres saltos de referencia del informe (Hmin-Hnom-Hmax), usados en las
   Figuras 4.3/4.4/4.7/4.8 para las curvas de eficiencia vs. caudal/potencia. */
const H_REFERENCIA_MODELO = [
  { H: 166.9, label: "Hp=166.9 m (Hmin)", color: "#7BC96F" },
  { H: 197.3, label: "Hp=197.3 m (Hnom)", color: "#4E9DE0" },
  { H: 207.0, label: "Hp=207.0 m (Hmax)", color: "#E0A94E" },
];

/* Curva de eficiencia vs. caudal (o potencia) a UN salto neto fijo,
   barriendo la apertura gamma dentro del rango ensayado (4.87°-31.98°).
   Reproduce el tipo de curva de las Figuras 4.3/4.4/4.7/4.8. */
function curvaEficienciaEnH(H, pasoGamma = 0.3) {
  const pts = [];
  for (let g = GAMMAS_HILL[0]; g <= GAMMA_ENSAYADO_MAX; g += pasoGamma) {
    const r = evaluarHillChart(H, g);
    if (r) pts.push({ gamma: g, Q11: r.Q11, P11: r.P11, eta: r.eta, Q: r.Q, P: r.P });
  }
  return pts;
}
const HILL_MODELO_186 = [[4.87,39.94,120.53,0.748,63.47],[4.87,42.22,118.75,0.717,61.75],[4.87,43.99,117.04,0.685,59.81],[4.87,45.97,115.01,0.639,56.82],[4.87,47.93,112.69,0.589,53.46],[4.87,49.99,110.51,0.534,49.4],[4.87,52.11,108.57,0.454,42.72],[4.87,54.0,106.82,0.383,36.69],[4.87,55.97,105.08,0.306,29.8],[4.87,57.94,103.09,0.211,20.9],[4.87,59.93,100.53,0.096,9.75],[8.0,40.01,213.0,1.643,78.88],[8.0,41.99,210.72,1.618,78.54],[8.0,44.0,207.01,1.573,77.73],[8.0,46.0,202.53,1.524,76.98],[8.0,47.99,197.8,1.468,75.88],[8.0,49.99,193.17,1.389,73.53],[8.0,52.0,190.88,1.368,73.3],[8.0,53.95,187.36,1.29,70.4],[8.0,55.97,183.92,1.2,66.74],[8.0,57.96,180.62,1.102,62.36],[8.0,60.01,176.61,0.985,57.01],[8.0,61.96,172.59,0.835,49.44],[8.0,63.92,167.57,0.68,41.47],[8.0,65.9,161.67,0.474,29.95],[8.0,68.02,153.21,0.225,15.03],[11.02,39.98,325.06,2.684,84.41],[11.02,41.96,320.38,2.679,85.46],[11.02,43.95,315.29,2.651,85.94],[11.02,45.94,308.66,2.611,86.44],[11.02,48.05,301.46,2.561,86.82],[11.02,49.98,293.85,2.465,85.72],[11.02,51.98,287.9,2.387,84.75],[11.02,53.96,283.21,2.314,83.5],[11.02,55.97,277.92,2.221,81.66],[11.02,57.93,272.5,2.112,79.2],[11.02,59.97,266.54,1.965,75.33],[11.02,61.98,260.88,1.804,70.67],[11.02,63.99,255.69,1.642,65.63],[11.02,65.95,250.07,1.462,59.74],[11.02,67.96,243.2,1.249,52.5],[11.02,69.96,234.96,0.996,43.33],[14.01,39.95,432.33,3.67,86.74],[14.01,41.95,427.41,3.711,88.73],[14.01,43.95,421.36,3.716,90.11],[14.01,45.96,413.23,3.702,91.53],[14.01,47.95,403.27,3.616,91.63],[14.01,49.94,393.73,3.511,91.13],[14.01,51.94,385.1,3.415,90.62],[14.01,53.95,377.17,3.308,89.64],[14.01,55.93,369.78,3.197,88.35],[14.01,57.95,362.39,3.076,86.73],[14.01,59.97,354.59,2.919,84.12],[14.01,62.01,346.72,2.733,80.56],[14.01,63.96,339.31,2.544,76.61],[14.01,65.95,330.32,2.293,70.96],[14.01,67.92,321.5,2.04,64.86],[14.01,69.93,311.45,1.761,57.8],[16.0,39.95,508.74,4.374,87.89],[16.0,42.01,504.49,4.468,90.53],[16.0,44.0,497.46,4.512,92.71],[16.0,45.99,486.57,4.454,93.57],[16.0,47.96,475.04,4.338,93.35],[16.0,49.95,464.26,4.22,92.93],[16.0,51.94,453.9,4.103,92.42],[16.0,53.93,444.88,4.003,92.0],[16.0,55.97,436.47,3.89,91.13],[16.0,58.0,428.47,3.778,90.15],[16.0,59.97,419.67,3.618,88.14],[16.0,61.97,409.99,3.422,85.33],[16.0,63.96,397.89,3.144,80.8],[16.0,65.97,386.0,2.838,75.19],[16.0,67.93,374.67,2.543,69.4],[16.0,69.9,362.21,2.235,63.12],[18.0,39.99,583.58,5.098,89.32],[18.0,41.99,577.26,5.207,92.23],[18.0,43.97,566.61,5.189,93.63],[18.0,45.94,553.97,5.101,94.15],[18.0,47.99,541.64,4.997,94.34],[18.0,49.95,530.07,4.883,94.2],[18.0,51.95,518.7,4.77,94.05],[18.0,53.94,508.23,4.637,93.3],[18.0,56.02,498.01,4.506,92.52],[18.0,57.98,488.91,4.388,91.78],[18.0,59.98,479.51,4.228,90.18],[18.0,61.95,468.09,3.995,87.29],[18.0,63.93,454.45,3.722,83.77],[18.0,65.95,438.01,3.331,77.77],[18.0,67.96,423.27,2.967,71.69],[18.0,70.02,409.89,2.616,65.28],[20.0,39.99,659.45,5.832,90.46],[20.0,41.98,649.65,5.889,92.71],[20.0,43.98,636.77,5.835,93.71],[20.0,45.95,623.09,5.747,94.32],[20.0,47.98,609.4,5.64,94.63],[20.0,49.95,597.17,5.533,94.74],[20.0,51.93,585.9,5.428,94.73],[20.0,53.95,574.36,5.297,94.29],[20.0,55.95,563.68,5.176,93.88],[20.0,58.02,552.97,5.024,92.9],[20.0,59.99,541.57,4.83,91.17],[20.0,61.99,527.92,4.569,88.48],[20.0,63.95,510.54,4.206,84.22],[20.0,65.96,491.12,3.791,78.92],[20.0,67.92,474.52,3.404,73.35],[20.0,69.93,457.96,3.003,67.04],[22.03,39.96,726.34,6.418,90.32],[22.03,41.95,714.21,6.436,92.12],[22.03,43.96,699.62,6.377,93.18],[22.03,46.0,685.03,6.291,93.88],[22.03,47.99,671.34,6.203,94.45],[22.03,49.96,658.46,6.092,94.57],[22.03,51.97,645.87,5.985,94.72],[22.03,53.97,634.64,5.881,94.72],[22.03,55.94,624.07,5.773,94.55],[22.03,58.02,612.75,5.627,93.87],[22.03,60.02,599.1,5.388,91.92],[22.03,61.96,583.24,5.088,89.15],[22.03,63.95,564.58,4.699,85.06],[22.03,65.96,542.77,4.245,79.93],[22.03,67.99,523.21,3.812,74.45],[22.03,70.0,505.38,3.402,68.79],[24.0,39.98,789.07,6.931,89.76],[24.0,41.96,774.04,6.909,91.21],[24.0,43.95,759.5,6.853,92.22],[24.0,45.96,745.19,6.788,93.09],[24.0,47.98,731.02,6.708,93.78],[24.0,49.99,717.4,6.618,94.29],[24.0,52.0,704.72,6.51,94.42],[24.0,53.99,692.97,6.411,94.56],[24.0,56.02,681.48,6.306,94.58],[24.0,57.97,670.6,6.181,94.2],[24.0,59.93,656.88,5.949,92.57],[24.0,61.93,639.1,5.616,89.81],[24.0,63.94,617.11,5.162,85.49],[24.0,65.95,593.78,4.679,80.54],[24.0,67.97,571.23,4.213,75.39],[24.0,69.98,551.24,3.758,69.68],[26.0,39.98,843.25,7.323,88.77],[26.0,41.96,826.95,7.284,90.05],[26.0,43.94,812.55,7.25,91.21],[26.0,45.96,798.87,7.202,92.16],[26.0,47.97,784.68,7.136,92.97],[26.0,49.97,771.5,7.063,93.59],[26.0,51.97,758.73,6.981,94.06],[26.0,53.97,746.37,6.882,94.26],[26.0,55.98,734.31,6.772,94.29],[26.0,57.97,722.09,6.622,93.75],[26.0,59.99,705.75,6.339,91.84],[26.0,61.95,686.99,5.992,89.18],[26.0,63.94,665.64,5.57,85.55],[26.0,65.93,640.25,5.049,80.63],[26.0,67.96,614.43,4.518,75.19],[26.0,69.98,591.71,4.028,69.59],[29.0,40.01,922.3,7.831,86.82],[29.0,41.96,905.27,7.798,88.08],[29.0,43.93,889.59,7.768,89.29],[29.0,45.98,874.68,7.728,90.34],[29.0,47.96,861.9,7.695,91.29],[29.0,49.94,848.84,7.649,92.14],[29.0,51.96,836.46,7.592,92.82],[29.0,53.96,824.59,7.52,93.26],[29.0,55.93,812.7,7.432,93.51],[29.0,57.99,797.34,7.219,92.59],[29.0,59.99,776.2,6.845,90.18],[29.0,61.94,753.08,6.408,87.02],[29.0,63.94,729.08,5.957,83.55],[29.0,65.92,702.87,5.443,79.2],[29.0,67.92,675.14,4.897,74.17],[29.0,69.93,649.08,4.367,68.8],[31.98,39.95,993.97,8.243,84.78],[31.98,41.95,975.17,8.211,86.07],[31.98,43.98,957.99,8.179,87.28],[31.98,45.94,943.73,8.156,88.33],[31.98,47.98,929.56,8.128,89.38],[31.98,49.92,917.62,8.112,90.36],[31.98,51.96,906.12,8.085,91.2],[31.98,53.95,894.75,8.04,91.84],[31.98,55.96,882.5,7.955,92.13],[31.98,57.98,863.69,7.658,90.62],[31.98,59.98,837.09,7.172,87.56],[31.98,61.94,809.08,6.643,83.91],[31.98,63.97,780.89,6.12,80.1],[31.98,65.95,753.28,5.612,76.13],[31.98,67.97,723.44,5.044,71.24],[31.98,69.94,694.66,4.494,66.11]];
// columnas: [gamma_deg, n11_rpm, Q11_lps, P11_model_kW, eta_model_pct] -- eficiencia MEDIDA del modelo (sin step-up), usada en Fig. 4.1/4.2

/* ============================================================
   COLINA A ESCALA DE MODELO (n11-Q11, eficiencia MEDIDA sin
   step-up) — corresponde a las Figuras 4.1/4.2 del informe.
   Distinta de la eficiencia de PROTOTIPO (con step-up IEC 60193)
   usada en las Figuras 4.5/4.6, ya calculada arriba.
   ============================================================ */
const GAMMAS_MODELO = [...new Set(HILL_MODELO_186.map((r) => r[0]))].sort((a, b) => a - b);
const PRECALC_MODELO = precalcularGammas(HILL_MODELO_186, 0, 1, 2, 3, 4);
function evaluarModeloEnN11Gamma(n11, gamma) {
  return interpolarEntreAperturas(PRECALC_MODELO, GAMMAS_MODELO, gamma, n11);
}

/* ============================================================
   MARCHING SQUARES — algoritmo estándar de trazado de isolíneas
   sobre una malla de celdas (no requiere que la malla esté
   alineada a los ejes; cada celda se define por 4 esquinas con
   posición (x,y) y valor (z) propios). Celdas con alguna esquina
   inválida (fuera del rango ensayado) se omiten, para no
   extrapolar donde no hay datos.
   ============================================================ */
function marchingSquares(grid, nivel) {
  const segmentos = [];
  const ni = grid.length, nj = grid[0].length;
  const lerp = (a, b) => {
    const t = (nivel - a.z) / (b.z - a.z);
    return [a.x + t * (b.x - a.x), a.y + t * (b.y - a.y)];
  };
  for (let i = 0; i < ni - 1; i++) {
    for (let j = 0; j < nj - 1; j++) {
      const c00 = grid[i][j], c10 = grid[i + 1][j], c11 = grid[i + 1][j + 1], c01 = grid[i][j + 1];
      if (!c00 || !c10 || !c11 || !c01 || !c00.valido || !c10.valido || !c11.valido || !c01.valido) continue;
      const b00 = c00.z >= nivel ? 1 : 0, b10 = c10.z >= nivel ? 1 : 0, b11 = c11.z >= nivel ? 1 : 0, b01 = c01.z >= nivel ? 1 : 0;
      const caso = b00 * 1 + b10 * 2 + b11 * 4 + b01 * 8;
      if (caso === 0 || caso === 15) continue;
      const eBottom = b00 !== b10 ? lerp(c00, c10) : null;
      const eRight = b10 !== b11 ? lerp(c10, c11) : null;
      const eTop = b01 !== b11 ? lerp(c01, c11) : null;
      const eLeft = b00 !== b01 ? lerp(c00, c01) : null;
      const pares = {
        1: [[eLeft, eBottom]], 2: [[eBottom, eRight]], 3: [[eLeft, eRight]],
        4: [[eRight, eTop]], 5: [[eLeft, eBottom], [eRight, eTop]],
        6: [[eBottom, eTop]], 7: [[eLeft, eTop]], 8: [[eTop, eLeft]],
        9: [[eBottom, eTop]], 10: [[eLeft, eBottom], [eRight, eTop]],
        11: [[eRight, eTop]], 12: [[eLeft, eRight]], 13: [[eBottom, eRight]], 14: [[eLeft, eBottom]],
      }[caso] || [];
      for (const [p1, p2] of pares) if (p1 && p2) segmentos.push([p1, p2]);
    }
  }
  return segmentos;
}

/* Malla (gamma × n11) a escala de MODELO — para contornos de Fig. 4.1/4.2. */
function construirMallaModelo(ejeY, nGamma = 70, nN11 = 70) {
  const n11min = Math.min(...HILL_MODELO_186.map((r) => r[1]));
  const n11max = Math.max(...HILL_MODELO_186.map((r) => r[1]));
  const grid = [];
  for (let i = 0; i < nGamma; i++) {
    const g = GAMMAS_MODELO[0] + (i / (nGamma - 1)) * (GAMMAS_MODELO[GAMMAS_MODELO.length - 1] - GAMMAS_MODELO[0]);
    const fila = [];
    for (let j = 0; j < nN11; j++) {
      const n11 = n11min + (j / (nN11 - 1)) * (n11max - n11min);
      const r = evaluarModeloEnN11Gamma(n11, g);
      fila.push(r ? { x: n11, y: ejeY === "Q11" ? r.Q11 / 1000 : r.P11 / 1000, z: r.eta, valido: true } : { valido: false });
    }
    grid.push(fila);
  }
  return grid;
}

/* Malla (gamma × H) a escala de PROTOTIPO — para contornos de Fig. 4.5/4.6.
   ejeX: "n11" (Fig 4.1/4.2 en escala prototipo) o "H" (Fig 4.5/4.6). */
function construirMallaProto(ejeX, ejeY, nGamma = 70, nH = 70) {
  const Hs = HILL_PROTO_186.map((r) => r[5]);
  const Hmin = Math.min(...Hs), Hmax = Math.max(...Hs);
  const grid = [];
  for (let i = 0; i < nGamma; i++) {
    const g = GAMMAS_HILL[0] + (i / (nGamma - 1)) * (GAMMAS_HILL[GAMMAS_HILL.length - 1] - GAMMAS_HILL[0]);
    const fila = [];
    for (let j = 0; j < nH; j++) {
      const H = Hmin + (j / (nH - 1)) * (Hmax - Hmin);
      const r = evaluarHillChart(H, g);
      const x = ejeX === "n11" ? (r ? r.n11 : null) : H;
      const y = r ? (ejeY === "Q" ? r.Q : r.P) : null;
      fila.push(r ? { x, y, z: r.eta, valido: true } : { valido: false });
    }
    grid.push(fila);
  }
  return grid;
}

/* ============================================================
   BUSCADOR DE PUNTO DE MÁXIMA EFICIENCIA
   ------------------------------------------------------------
   Dado un caudal TOTAL objetivo y el nivel del embalse, busca —
   entre 1 y 4 unidades activas — cuántas unidades usar y a qué
   apertura cada una para lograr ese caudal total con la MAYOR
   eficiencia posible. No inventa física nueva: reutiliza
   resolverGammaParaCaudal (ya validado) para cada conteo de
   unidades candidato, y compara la eficiencia resultante.
   Lógica: repartir el caudal entre más unidades generalmente
   acerca cada una a su propio punto óptimo (evita aperturas muy
   bajas o muy altas, donde la eficiencia cae); pero no siempre —
   por eso se prueban las 4 opciones y se compara, en vez de
   asumir cuál es mejor. */
/* Resuelve el punto de operación de CADA unidad activa por separado,
   dado un % OPERATIVO INDEPENDIENTE por unidad (corrección del ingeniero
   de operaciones con datos reales de Hidrometría EPM: cada unidad tiene
   su propio % — NO una fracción de un total que deba sumar 100%. Ver
   POTENCIA_BASE_PCT_MW arriba para la verificación numérica). "porcentajes"
   es un array 0-100 por posición de unidad, cada uno independiente:
   0% = unidad inoperativa (detenida, sin caudal). Para cada unidad con
   %>0, el objetivo de potencia es (pct/100)*POTENCIA_BASE_PCT_MW, resuelto
   con resolverGammaParaPotencia (ya respeta el techo mecánico Y el de
   307 MW garantizados). nTurbActivas usado en la física es el número de
   unidades REALMENTE operativas (%>0) — el nivel de almenara (y por tanto
   el salto neto de todas) depende de cuántas generan simultáneamente, no
   de cuántas están "disponibles" pero detenidas. */
function resolverPorUnidadConPorcentajes(nivelEmbalse, porcentajes, gammaMaxMecanico, potenciaMaxMW, potenciaBaseMW = POTENCIA_BASE_PCT_MW, cond = CONDICION_DESCARGA_DISENO) {
  // El % de Hidrometría es sobre potencia medida (en bornes): se pasa al eje
  // con el rendimiento del generador antes de entrar a la colina.
  const pBornes = porcentajes.map((pct) => (pct > 1e-6 ? (pct / 100) * potenciaBaseMW : 0));
  const pEje = pBornes.map((p) => (p > 0 ? p / rendimientoGenerador(p) : 0));
  const res = resolverUnidadesConPotencias(nivelEmbalse, pEje, gammaMaxMecanico, potenciaMaxMW, cond);
  return porcentajes.map((pct, i) => {
    const zona = i < UNIDADES_POR_ALMENARA ? "norte" : "sur";
    if (pBornes[i] <= 0) {
      return {
        unidad: i + 1, zona, pct: 0, pObjetivo: 0, gamma: 0,
        resultado: { Q: 0, P: 0, eta: 0, saltoNeto: null },
        alcanzable: true, limitadoPorPotencia: false, inoperativa: true,
      };
    }
    const r = res.unidades[i];
    return {
      unidad: i + 1, zona, pct, pObjetivo: pBornes[i], pObjetivoEje: pEje[i], gamma: r.gamma, resultado: r.resultado,
      alcanzable: r.alcanzable === undefined ? true : r.alcanzable,
      limitadoPorPotencia: !!r.limitadoPorPotencia,
      debajoDelMinimoEnsayado: !!r.debajoDelMinimoEnsayado, inoperativa: false,
      nivelAlmenara: r.resultado ? r.resultado.nivelAlmenara : null,
    };
  });
}

/* Unidades con potencias distintas (en el eje; 0 = detenida), posición
   i → almenara (U1-U4 N°1, U5-U8 N°2). Cada almenara recibe la SUMA de los
   caudales de sus unidades: se itera (punto fijo) hasta que el caudal total
   de cada almenara no cambie más de 0,01 m³/s. Así una unidad a 300 MW y
   otra a 90 MW ven la misma almenara, como en la realidad. */
function resolverUnidadesConPotencias(nivelEmbalse, potenciasEje, gammaMax, potenciaMaxMW, cond = CONDICION_DESCARGA_DISENO, maxIter = 12) {
  const base = cond || CONDICION_DESCARGA_DISENO;
  const zonaDe = (i) => (i < UNIDADES_POR_ALMENARA ? "norte" : "sur");
  const nEn = { norte: 0, sur: 0 };
  potenciasEje.forEach((p, i) => { if (p > 1e-6) nEn[zonaDe(i)]++; });
  let qAlm = null;
  let unidades = [];
  for (let it = 0; it < maxIter; it++) {
    unidades = potenciasEje.map((p, i) => {
      if (!(p > 1e-6)) return { gamma: 0, resultado: { Q: 0, P: 0, eta: 0, saltoNeto: null }, alcanzable: true };
      const z = zonaDe(i);
      const c = { ...base, unidadesPorAlmenara: { norte: z === "norte" ? nEn.norte : 0, sur: z === "sur" ? nEn.sur : 0 } };
      if (qAlm) c.qAlmenara = { [z]: qAlm[z] };
      return resolverGammaParaPotencia(nivelEmbalse, p, nEn[z], gammaMax, potenciaMaxMW, c);
    });
    const nuevo = { norte: 0, sur: 0 };
    unidades.forEach((u, i) => { nuevo[zonaDe(i)] += u.resultado ? u.resultado.Q : 0; });
    const convergio = qAlm && Math.abs(nuevo.norte - qAlm.norte) < 0.01 && Math.abs(nuevo.sur - qAlm.sur) < 0.01;
    qAlm = nuevo;
    if (convergio || base.modo !== "ase") break;
  }
  return { unidades, qAlmenara: qAlm };
}

/* Las 8 unidades de la central. Comparten la misma colina (ensayo de
   modelo de 2013), pero cada máquina real se comporta distinto: los índices
   medidos por unidad (Winter-Kennedy relativo, ver src/analitica.js) entran
   como un factor de eficiencia relativa por unidad (1,00 = colina común).
   U1–U4: casa de máquinas norte, almenara N°1 (en servicio).
   U5–U8: casa de máquinas sur, almenara N°2 (entrada prevista a inicios de 2028). */
const UNIDADES_CENTRAL = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8].map((id) => Object.freeze({
  id, casa: id <= 4 ? "norte" : "sur", almenara: id <= 4 ? "norte" : "sur", enServicio: id <= 4,
  nombre: `U${id}`, casaNombre: id <= 4 ? "Casa de máquinas norte" : "Casa de máquinas sur",
})));

/* Caudal de cada unidad para un reparto de potencia (MW en bornes por unidad,
   8 posiciones; 0 = detenida), con la colina común y, si se dan, factores
   de eficiencia relativa por unidad: factor > 1 = la unidad entrega más MW
   por m³/s que la colina común → turbina factor veces menos caudal.
   Devuelve por unidad { pBornes, pEje, gamma, q, qColina, eta, saltoNeto,
   alcanzable } y los totales. */
function repartoPorUnidad(nivelEmbalse, potenciasBornes, { cond = CONDICION_DESCARGA_DISENO, gammaMax = GAMMA_AMPLIADO_MAX, potenciaMaxMW = P_MAXIMO_ESPERADO_MW, factores = null } = {}) {
  const pb = Array.from({ length: 8 }, (_, i) => Math.max(0, potenciasBornes[i] || 0));
  const pe = pb.map((p) => (p > 0 ? p / rendimientoGenerador(p) : 0));
  const { unidades } = resolverUnidadesConPotencias(nivelEmbalse, pe, gammaMax, potenciaMaxMW, cond);
  const porUnidad = unidades.map((u, i) => {
    const f = factores && Number.isFinite(factores[i]) && factores[i] > 0 ? factores[i] : 1;
    const qc = u.resultado ? u.resultado.Q : 0;
    return {
      id: i + 1, pBornes: pb[i], pEje: pe[i], gamma: u.gamma, qColina: qc, q: qc / f, factor: f,
      eta: u.resultado && u.resultado.P > 0 ? u.resultado.eta * f : null, saltoNeto: u.resultado ? u.resultado.saltoNeto : null,
      alcanzable: u.alcanzable !== false, limitadoPorPotencia: !!u.limitadoPorPotencia,
    };
  });
  const qTotal = porUnidad.reduce((a, u) => a + u.q, 0);
  const pTotal = pb.reduce((a, p) => a + p, 0);
  return { porUnidad, qTotal, pTotal, fc: qTotal > 0 ? pTotal / qTotal : null };
}

/* Orden de mérito para poner unidades en línea: de mayor a menor factor de
   eficiencia relativa entre las disponibles (sin factor = 1). Con la misma
   colina y el mismo salto, repartir la potencia por igual entre las unidades
   en línea es lo más eficiente; lo que cambia con los factores es CUÁLES
   unidades conviene usar. */
function ordenDeMerito(disponibles, factores = null) {
  return disponibles.slice().sort((a, b) => {
    const fa = factores && Number.isFinite(factores[a - 1]) ? factores[a - 1] : 1;
    const fb = factores && Number.isFinite(factores[b - 1]) ? factores[b - 1] : 1;
    return fb - fa || a - b;
  });
}

function buscarPuntoOptimo(Qtotal, nivelEmbalse, nUnidadesDisponibles = N_TURBINAS_MAX, gammaMaxMecanico = GAMMA_AMPLIADO_MAX, porcentajesPersonalizados = null, cond = CONDICION_DESCARGA_DISENO) {
  /* % operativo independiente por unidad (corrección del ingeniero de
     operaciones, reemplaza el reparto equitativo "Qtotal/n" cuando el
     usuario define explícitamente qué % le corresponde a cada unidad
     activa — cada unidad tiene un objetivo de potencia propio, fijo,
     NO derivado de repartir Qtotal). Se activa SOLO si se pasan
     porcentajes — si no, el comportamiento de abajo (búsqueda automática
     de n y reparto equitativo) queda exactamente igual que antes. */
  if (porcentajesPersonalizados && porcentajesPersonalizados.length === nUnidadesDisponibles) {
    const detalle = resolverPorUnidadConPorcentajes(nivelEmbalse, porcentajesPersonalizados, gammaMaxMecanico, P_MAXIMO_ESPERADO_MW, undefined, cond);
    const nOperativas = detalle.filter((d) => !d.inoperativa).length;
    const Qtotal_turbinado = detalle.reduce((s, d) => s + (d.resultado ? d.resultado.Q : 0), 0);
    const Ptotal = detalle.reduce((s, d) => s + (d.resultado ? d.resultado.P : 0), 0);
    const etaPonderada = Qtotal_turbinado > 0
      ? detalle.reduce((s, d) => s + (d.resultado ? d.resultado.eta * d.resultado.Q : 0), 0) / Qtotal_turbinado
      : 0;
    const mejor = {
      n: nOperativas, gamma: null, qPorUnidad: null, eta: etaPonderada,
      P: nOperativas > 0 ? Ptotal / nOperativas : 0, Q: nOperativas > 0 ? Qtotal_turbinado / nOperativas : 0,
      saltoNeto: detalle.find((d) => d.resultado && !d.inoperativa)?.resultado?.saltoNeto ?? null,
      alcanzable: detalle.every((d) => d.alcanzable), limitadoPorPotencia: detalle.some((d) => d.limitadoPorPotencia),
      aguaLimitada: false, Qtotal_turbinado, Ptotal, porUnidad: detalle, pesado: true,
    };
    return { mejor, todas: [mejor] };
  }
  const opciones = [];
  for (let n = 1; n <= nUnidadesDisponibles; n++) {
    const qEquitativo = Qtotal / n;
    const pico = picoEficiencia(nivelEmbalse, n, gammaMaxMecanico, P_MAXIMO_ESPERADO_MW, cond);
    let gamma, resultado, limitadoPorPotencia, aguaLimitada, alcanzable;
    if (pico.resultado && qEquitativo >= pico.resultado.Q) {
      // Agua suficiente (o de sobra): cada unidad opera en SU propio pico de
      // eficiencia a este salto — no tiene sentido forzarlas más allá solo
      // porque hay más caudal disponible; lo que no se turbina se vierte.
      // No hay un "objetivo" que se pueda fallar aquí (es una búsqueda de
      // máximo, no de un caudal puntual), así que siempre es alcanzable.
      gamma = pico.gamma; resultado = pico.resultado; limitadoPorPotencia = pico.limitadoPorPotencia; aguaLimitada = false; alcanzable = true;
    } else {
      // Agua limitada: no alcanza para que todas lleguen a su pico individual
      // — se reparte equitativamente entre las unidades disponibles (todas
      // absorben su parte, igual que en la operación real observada). Aquí sí
      // se propaga el "alcanzable" real de la resolución (en vez de darlo
      // siempre por sentado): si por algún motivo la apertura no llega
      // exactamente al caudal por unidad repartido, debe quedar reflejado.
      const r = resolverGammaParaCaudal(nivelEmbalse, qEquitativo, n, gammaMaxMecanico, cond);
      gamma = r.gamma; resultado = r.resultado; limitadoPorPotencia = false; aguaLimitada = true;
      alcanzable = r.alcanzable === undefined ? true : r.alcanzable;
    }
    if (resultado) {
      opciones.push({
        n, gamma, qPorUnidad: qEquitativo, eta: resultado.eta, P: resultado.P, Q: resultado.Q, saltoNeto: resultado.saltoNeto,
        alcanzable, limitadoPorPotencia, aguaLimitada,
        Qtotal_turbinado: resultado.Q * n, Ptotal: resultado.P * n,
        // Con unidades en las dos almenaras (n > 4), detalle por grupo: cada
        // almenara tiene su propio nivel, salto neto, Q y P por unidad.
        porAlmenara: resultado.dosAlmenaras ? resultado.porAlmenara : null,
        unidadesPorAlmenara: unidadesPorAlmenara(n, cond),
      });
    }
  }
  if (opciones.length === 0) return null;
  /* Criterio de selección (nov-2026):
     1) Se descartan las opciones que no se pueden cumplir (por ejemplo,
        repartir poco caudal entre muchas unidades deja cada una por debajo
        de la apertura mínima ensayada, 4,87°). Solo si ninguna se puede
        cumplir se elige entre todas.
     2) La que turbina MÁS caudal total (aprovecha más agua, vierte menos).
     3) Si turbinan prácticamente lo mismo (±1 m³/s), la de MAYOR eficiencia
        (más energía con la misma agua). Antes se prefería la de más
        unidades, lo que con agua limitada bajaba la eficiencia. */
  const cumplibles = opciones.filter((o) => o.alcanzable !== false);
  const candidatas = cumplibles.length ? cumplibles : opciones;
  const opcionesOrdenadas = [...candidatas].sort((a, b) => {
    const difCaudal = b.Qtotal_turbinado - a.Qtotal_turbinado;
    if (Math.abs(difCaudal) > 1) return difCaudal;
    return b.eta - a.eta;
  });
  return { mejor: opcionesOrdenadas[0], todas: opciones };
}

/* ============================================================
   ESTUDIO DE AMPLIACIÓN 2023 — solicitud de EPM a GE para evaluar
   extender el límite mecánico del distribuidor de 26.5° a 30.2°
   (carrera del servomotor de 390 a 433 mm) y acercarse a ~300 MW
   por unidad ante el menor salto neto actual. Datos publicados en
   el documento 2023 (grupo "3.1.1 - condiciones actuales"),
   verificados: h_loss=k·Q² reproduce los valores de la tabla con
   diferencia <0.002 m. Validado contra mi propio modelo de colina:
   error <0.15% en Q y P frente a estos dos escenarios.
   ============================================================ */
const ESCENARIOS_2023_EPM_GE = [
  {
    id: "Escenario 1 (3.1.1)", descripcion: "1 unidad — evaluación individual para acercarse a 300 MW",
    embalse_m: 408.3, almenara_m: 224.3, saltoBruto_m: 184, Q_m3s: 185.21, saltoNeto_m: 179.21, gamma_deg: 29.83,
    P_turbina_MW: 306.07, eta_generador_pct: 98.91, P_bornes_generador_MW: 302.73,
    eta_transformador_pct: 99.76, P_subestacion_MW: 300.0, fuente: "Estudio de ampliación de GE (2023)",
    garantizado: false, notaGarantia: "Nota 4 del: estas condiciones NO se consideran dentro del rango de operación garantizado del proyecto.",
  },
  {
    id: "Escenario 2 (3.1.1)", descripcion: "1 unidad — apertura máxima estudiada (30.2°)",
    embalse_m: 408.3, almenara_m: 224.3, saltoBruto_m: 184, Q_m3s: 187.11, saltoNeto_m: 179.11, gamma_deg: 30.2,
    P_turbina_MW: 308.497, eta_generador_pct: 98.91, P_bornes_generador_MW: 305.13,
    eta_transformador_pct: 99.76, P_subestacion_MW: 302.4, fuente: "Estudio de ampliación de GE (2023)",
    garantizado: false, notaGarantia: "Nota 4 del: estas condiciones NO se consideran dentro del rango de operación garantizado del proyecto.",
  },
  {
    id: "Escenario 1 (4.2)", descripcion: "1Ug_300MW GER — Q mayorados río 1500 m³/s",
    embalse_m: 411, almenara_m: 225.62, saltoBruto_m: 185.4, Q_m3s: 188.07, saltoNeto_m: 180.44, gamma_deg: 30.2,
    P_turbina_MW: 312.26, eta_generador_pct: 98.91, P_bornes_generador_MW: 308.86,
    eta_transformador_pct: null, P_subestacion_MW: null, fuente: "Estudio de ampliación de GE (2023)",
    garantizado: null, notaGarantia: "Terminal de generador (1 unidad) — no incluye transformador/subestación.",
  },
  {
    id: "Escenario 2 (4.2)", descripcion: "4Ugs_1200MW Subestación — Q mayorados río 1500 m³/s",
    embalse_m: 410.9, almenara_m: 228.35, saltoBruto_m: 182.55, Q_m3s: 186.1, saltoNeto_m: 177.71, gamma_deg: 30.2,
    P_turbina_MW: 304.56, eta_generador_pct: 98.91, P_bornes_generador_MW: 1204.95,
    eta_transformador_pct: 99.76, P_subestacion_MW: 1200.1, fuente: "Estudio de ampliación de GE (2023)",
    garantizado: null, notaGarantia: "Valores de potencia en bornes/transformador/subestación son el TOTAL de las 4 unidades; potencia turbina es por unidad.",
  },
  {
    id: "Escenario 3 (4.2)", descripcion: "4Ugs_1200MW Subestación — Q mayorados río 1350 m³/s",
    embalse_m: 410.6, almenara_m: 228.03, saltoBruto_m: 182.57, Q_m3s: 186.12, saltoNeto_m: 177.73, gamma_deg: 30.2,
    P_turbina_MW: 304.61, eta_generador_pct: 98.91, P_bornes_generador_MW: 1205.18,
    eta_transformador_pct: 99.76, P_subestacion_MW: 1200.3, fuente: "Estudio de ampliación de GE (2023)",
    garantizado: null, notaGarantia: "Valores de potencia en bornes/transformador/subestación son el TOTAL de las 4 unidades; potencia turbina es por unidad.",
  },
  {
    id: "Escenario 4 (4.2)", descripcion: "4Ugs_1200MW Subestación — Q mayorados río ~750 m³/s",
    embalse_m: 410.8, almenara_m: 226.5, saltoBruto_m: 184.3, Q_m3s: 187.32, saltoNeto_m: 179.40, gamma_deg: 30.2,
    P_turbina_MW: 309.32, eta_generador_pct: 98.91, P_bornes_generador_MW: 1223.78,
    eta_transformador_pct: 99.76, P_subestacion_MW: 1218.8, fuente: "Estudio de ampliación de GE (2023)",
    garantizado: null, notaGarantia: "Valores de potencia en bornes/transformador/subestación son el TOTAL de las 4 unidades; potencia turbina es por unidad.",
  },
];
/* Límite absoluto, aplica siempre, independiente de escenario: "no deberá
   exceder los límites de operación garantizada (potencia máx. de la
   turbina de 307 MW)... la potencia no deberá ser superior al máximo de
   307 MW" (estudio de ampliación de GE, 2023).
   GE garantiza que operar hasta 30.2° no genera riesgo de cavitación,
   vibración ni pulsación de presión — pero NO garantiza potencia/eficiencia
   específica fuera de las condiciones exactas de los escenarios 1 y 2. */
const NOTA_LIMITE_GARANTIZADO = "Límite garantizado: 307 MW máx. por unidad, en toda condición. La ampliación a 30.2° está garantizada libre de riesgo de cavitación/vibración, pero la potencia/eficiencia exactas solo están validadas para las condiciones específicas de los escenarios evaluados — fuera de ellas, no hay garantía de valores específicos, solo el tope de 307 MW.";
const SERVOMOTOR_2023 = {
  aperturaOriginal_deg: 26.5, aperturaModificada_deg: 30.2, incrementoApertura_deg: 3.7,
  carreraOriginal_mm: 390, carreraModificada_mm: 433, incrementoCarrera_mm: 43,
  fuente: "Estudio de ampliación de GE (2023)",
};

/* ============================================================
   DESPACHO INTRADIARIO (XM)
   ------------------------------------------------------------
   XM programa la generación de la central hora a hora ("Despacho XM",
   MW) y EPM mide la generación real ("Promedio RT", MW). Ambas son
   potencia en bornes de los generadores: el Promedio RT coincide con la
   suma de "Energía Unidad i" de Hidrometría (9-oct-2026, 00-02 h: 690,9 /
   691,6 MW y 584,2 / 583,7 MW). Para entrar a la colina se pasa a
   potencia en el eje de la turbina con el rendimiento del generador.
   ============================================================ */
/* Rendimiento del generador (incluye cojinete de empuje) por % de carga,
   estudio de ampliación de GE (2023). Carga = P / (336 MVA × cos φ 0,9). */
const RENDIMIENTO_GENERADOR_PCT = [[50, 98.55], [60, 98.7], [70, 98.79], [80, 98.85], [90, 98.89], [100, 98.91]];
const P_NOMINAL_GENERADOR_MW = 336 * 0.9;
function rendimientoGenerador(pBornesMW) {
  const carga = Math.min(100, Math.max(50, (pBornesMW / P_NOMINAL_GENERADOR_MW) * 100));
  return interp1(carga, RENDIMIENTO_GENERADOR_PCT) / 100;
}
/* Potencia en bornes a partir de la potencia en el eje (P_b = P_e·η_gen(P_b)). */
function potenciaBornesDesdeEje(pEjeMW) {
  let pb = pEjeMW;
  for (let i = 0; i < 4; i++) pb = pEjeMW * rendimientoGenerador(pb);
  return pb;
}
/* Mínimo de unidades que entregan la potencia (en bornes) sin pasar de los
   307 MW garantizados en el eje de cada turbina. No es una regla de despacho: en la
   operación real el número de unidades varía (p. ej. 500-550 MW se han
   generado con 2 y con 3 unidades); por eso en la app es editable. */
function unidadesMinimasParaPotencia(pTotalMW, nMax = N_TURBINAS_MAX, pMaxUnidadBornes = potenciaBornesDesdeEje(P_MAXIMO_ESPERADO_MW)) {
  // pTotalMW en bornes (como el despacho de XM); el límite de 307 MW es en el
  // eje de la turbina: en bornes son unos 303,6 MW por unidad.
  if (!(pTotalMW > 0)) return 0;
  return Math.min(nMax, Math.ceil(pTotalMW / pMaxUnidadBornes - 1e-9));
}
/* Número desde texto: acepta "1,234.5", "1.234,5", "700.0" y "0,5". */
function numeroDesdeTexto(t) {
  let s = String(t).trim().replace(/\s/g, "");
  const c = s.lastIndexOf(","), d = s.lastIndexOf(".");
  if (c >= 0 && d >= 0) s = c > d ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (c >= 0) s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
/* Lee el "Resumen horario" copiado de la tabla de despacho (una fila por
   hora: "00:00 - 00:59  700.0 MW  665.0 MW  735.0 MW  690.9 MW ...").
   Columnas: Despacho XM, Banda inferior, Banda superior, Promedio RT, Mín
   RT, Máx RT, Desviación. "Sin dato RT" → rt = null. También acepta filas
   simples "hora despacho [rt]" (números separados por tabulador o ;).
   Devuelve 24 posiciones (null si la hora no vino) y avisos. */
function parsearResumenHorarioXM(texto) {
  const horas = Array(24).fill(null);
  const avisos = [];
  for (const linea of String(texto).split(/\r?\n/)) {
    const l = linea.trim();
    if (!l) continue;
    let m = l.match(/^(\d{1,2}):\d{2}\s*-\s*\d{1,2}:\d{2}/);
    let h, despacho, rt = null, bandaInf = null, bandaSup = null;
    if (m) {
      h = +m[1];
      const mw = [...l.slice(m[0].length).matchAll(/(-?[\d.,]+)\s*MW/gi)].map((x) => numeroDesdeTexto(x[1]));
      if (mw.length < 1 || mw[0] == null) { avisos.push(`Hora ${h}: sin valor de despacho`); continue; }
      despacho = mw[0]; bandaInf = mw[1] ?? null; bandaSup = mw[2] ?? null;
      // "Sin dato XM": el 0,0 MW de la tabla no es un despacho de cero.
      // "Sin dato RT": la hora aún no tiene generación medida.
      if (/sin dato xm/i.test(l)) { despacho = null; bandaInf = null; bandaSup = null; }
      rt = !/sin dato rt/i.test(l) && mw.length >= 7 ? mw[3] : null;
    } else {
      const partes = l.split(/\t|;|\s{2,}/).map((x) => x.trim()).filter(Boolean);
      const hh = partes[0] && partes[0].match(/^(\d{1,2})(?::\d{2})?$/);
      if (!hh || partes.length < 2) continue; // encabezados y títulos
      h = +hh[1];
      despacho = numeroDesdeTexto(partes[1].replace(/MW/i, ""));
      rt = partes[2] != null ? numeroDesdeTexto(partes[2].replace(/MW/i, "")) : null;
      if (despacho == null) { avisos.push(`Hora ${h}: despacho no numérico`); continue; }
    }
    if (!(h >= 0 && h <= 23)) { avisos.push(`Hora ${h} fuera de 0-23`); continue; }
    if (horas[h]) avisos.push(`Hora ${h} repetida: se usa la última`);
    horas[h] = { hora: h, despacho, rt, bandaInf, bandaSup };
  }
  const faltan = horas.map((x, i) => (x ? null : i)).filter((x) => x != null);
  if (faltan.length && faltan.length < 24) avisos.push(`Faltan las horas ${faltan.join(", ")}`);
  const sinXM = horas.filter((x) => x && x.despacho == null).map((x) => x.hora);
  if (sinXM.length) avisos.push(`Sin dato de XM en las horas ${sinXM.join(", ")}`);
  // Fecha del despacho, si viene en el texto: "(9/10/2026)" (día/mes/año) o "2026-10-09"
  let fecha = null;
  const f1 = String(texto).match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  const f2 = String(texto).match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (f1) fecha = `${f1[3]}-${f1[2].padStart(2, "0")}-${f1[1].padStart(2, "0")}`;
  else if (f2) fecha = `${f2[1]}-${f2[2]}-${f2[3]}`;
  return { horas, avisos, fecha };
}
/* Estado de una hora en la comparación "Energía RT vs Despacho", con la
   misma lógica de la app de Hidrometría: sin dato de XM o de RT no se
   evalúa; si no, se compara el Promedio RT con el despacho ± banda. */
function estadoHoraDespacho(despacho, rt, bandaPct = 5) {
  if (despacho == null) return "sin_dato_xm";
  if (rt == null) return "sin_dato_rt";
  const b = bandaPct / 100;
  if (rt < despacho * (1 - b) - 1e-9) return "por_debajo";
  if (rt > despacho * (1 + b) + 1e-9) return "por_encima";
  return "dentro";
}
const ETIQUETA_ESTADO_HORA = Object.freeze({ sin_dato_xm: "Sin dato XM", sin_dato_rt: "Sin dato RT", por_debajo: "Por debajo", dentro: "Dentro de banda", por_encima: "Por encima" });
/* Potencia de cada hora para simular el nivel, según el programa elegido:
   - "xm": despacho de XM; una hora sin dato de XM repite la última hora con
     dato (o la siguiente, si es al comienzo del día).
   - "rt": Promedio RT donde lo hay; en el resto, el despacho de XM.
   - "plano": la operación que pide la regla operativa: caudal regulado
     constante = qObjetivo (m³/s) → P = qObjetivo × F.C. de Hidrometría.
   Devuelve { potencias: [24], rellenadas: [horas sin dato propio] }. */
function programaDespacho(filas, modo, { qObjetivo = null, fc = null } = {}) {
  if (modo === "plano") {
    if (!(qObjetivo > 0) || !(fc > 0)) return null;
    return { potencias: Array(filas.length).fill(qObjetivo * fc), rellenadas: [] };
  }
  const base = filas.map((f) => (modo === "rt" ? (f.rt ?? f.despacho ?? null) : (f.despacho ?? null)));
  const rellenadas = [];
  const primera = base.find((v) => v != null) ?? 0;
  let ultima = null;
  const potencias = base.map((v, i) => {
    if (v != null) { ultima = v; return v; }
    rellenadas.push(i);
    return ultima ?? primera;
  });
  return { potencias, rellenadas };
}
/* Energía (MWh) de XM y de RT; "comun" = horas que tienen los dos. */
function resumenEnergiaDespacho(filas) {
  let xm = 0, rt = 0, xmComun = 0, rtComun = 0, hXM = 0, hRT = 0, hComun = 0;
  for (const f of filas) {
    if (f.despacho != null) { xm += f.despacho; hXM++; }
    if (f.rt != null) { rt += f.rt; hRT++; }
    if (f.despacho != null && f.rt != null) { xmComun += f.despacho; rtComun += f.rt; hComun++; }
  }
  return { xm, rt, xmComun, rtComun, hXM, hRT, hComun, difComunPct: xmComun > 0 ? (rtComun / xmComun - 1) * 100 : null };
}
/* Nivel del embalse hora a hora para un programa de potencia.
   horas[i]: { potenciaMW (bornes, total de la central), unidades,
               qEntrada? (m³/s; si falta, se usa qEntrada general),
               qRio? (m³/s en D4' para la tabla ASE; si falta, el de cond) }
   Cada hora: potencia por unidad en bornes → eje (rendimiento del
   generador) → apertura por bisección en la colina con el nivel al inicio
   de la hora y la condición de descarga → caudal turbinado → continuidad
   con las curvas cota-volumen. No hay vertimiento (debe sumarse aparte). */
function simularDespachoHorario({ nivelInicial, horas, qEntrada, cond = CONDICION_DESCARGA_DISENO, gammaMax = GAMMA_AMPLIADO_MAX, potenciaMaxMW = P_MAXIMO_ESPERADO_MW, conRendimientoGenerador = true }) {
  let H = nivelInicial;
  const serie = [{ hora: 0, nivel: H }];
  const detalle = [];
  horas.forEach((x, i) => {
    const P = Math.max(0, x.potenciaMW || 0);
    const n = Math.max(0, Math.round(x.unidades || 0));
    const qIn = Number.isFinite(x.qEntrada) ? x.qEntrada : qEntrada;
    const c = cond && cond.modo === "ase" && Number.isFinite(x.qRio) ? { ...cond, qRio: x.qRio } : cond;
    let r = { gamma: 0, resultado: null, alcanzable: P <= 0 };
    let pBornesU = 0, pEjeU = 0, qTurb = 0, nUsadas = n, reducidas = false, enMinimo = false;
    const resolver = (k) => {
      const pb = P / k;
      const pe = conRendimientoGenerador ? pb / rendimientoGenerador(pb) : pb;
      return { pb, pe, r: resolverGammaParaPotencia(H, pe, k, gammaMax, potenciaMaxMW, c) };
    };
    if (P > 0 && n > 0) {
      let x = resolver(n);
      // Por debajo de la apertura mínima ensayada (4,87°) la unidad no tiene un
      // punto estable: se reparte la potencia entre menos unidades. De las
      // cantidades posibles (1 a n−1) se toma la que turbina menos agua, es
      // decir, la de mayor eficiencia.
      if (x.r.debajoDelMinimoEnsayado && n > 1) {
        reducidas = true;
        let mejor = null;
        for (let k = n - 1; k >= 1; k--) {
          const y = resolver(k);
          if (y.r.debajoDelMinimoEnsayado || !y.r.resultado) continue;
          const q = y.r.resultado.Q * k;
          if (!mejor || q < mejor.q - 1e-9) mejor = { k, y, q };
        }
        if (mejor) { nUsadas = mejor.k; x = mejor.y; } else { nUsadas = 1; x = resolver(1); }
      }
      pBornesU = x.pb; pEjeU = x.pe; r = x.r;
      if (r.debajoDelMinimoEnsayado) {
        // Ni con una unidad: se toma el caudal de la apertura mínima ensayada
        // (lo menos que puede turbinar una unidad en línea), no cero.
        const rMin = evaluarTurbinaUnidad(H, GAMMAS_HILL[0], 1, c);
        qTurb = rMin ? rMin.Q : 0; enMinimo = true;
      } else {
        qTurb = r.resultado ? r.resultado.Q * nUsadas : 0;
      }
    }
    const Hfin = nivelDesdeVolumenExtrapolado(Math.max(0, volumenExtrapolado(H) + ((qIn - qTurb) * 3600) / 1e6));
    const res = r.resultado;
    detalle.push({
      hora: i, potenciaMW: P, unidades: nUsadas, unidadesPedidas: n, unidadesReducidas: reducidas, enMinimoEnsayado: enMinimo,
      pBornesUnidad: pBornesU, pEjeUnidad: pEjeU, qEntrada: qIn,
      gamma: enMinimo ? GAMMAS_HILL[0] : r.gamma, qUnidad: nUsadas > 0 ? qTurb / (enMinimo ? 1 : nUsadas) : 0, qTurbinado: qTurb,
      pEjeLograda: res ? res.P : 0, eta: res && res.P > 0 ? res.eta : null, saltoNeto: res ? res.saltoNeto : null,
      alcanzable: P > 0 && n === 0 ? false : enMinimo ? false : r.alcanzable !== false, sinUnidades: P > 0 && n === 0,
      limitadoPorPotencia: !!r.limitadoPorPotencia, debajoDelMinimoEnsayado: !!r.debajoDelMinimoEnsayado, pMinimoEnsayado: r.pMinimoEnsayado,
      Hinicio: H, Hfin,
    });
    H = Hfin;
    serie.push({ hora: i + 1, nivel: H });
  });
  const qTurbMedio = detalle.reduce((a, d) => a + d.qTurbinado, 0) / Math.max(1, detalle.length);
  return { serie, detalle, Hfinal: H, deltaH: H - nivelInicial, qTurbMedio };
}

export {
  RENDIMIENTO_GENERADOR_PCT,
  P_NOMINAL_GENERADOR_MW,
  rendimientoGenerador,
  potenciaBornesDesdeEje,
  unidadesMinimasParaPotencia,
  numeroDesdeTexto,
  parsearResumenHorarioXM,
  simularDespachoHorario,
  estadoHoraDespacho,
  ETIQUETA_ESTADO_HORA,
  programaDespacho,
  resumenEnergiaDespacho,
  COTA_VOLUMEN,
  ZV,
  A_MAX_ESTRUCTURAL,
  K_AMAX,
  N_TURBINAS_MAX,
  UNIDADES_DISPONIBLES_HOY,
  NAMO,
  NAME,
  NIVEL_MIN_TEC,
  C1_MIN_OPERATIVO,
  UMBRAL_CANAL_IZQ_MAX,
  UMBRAL_CANAL_DER_MAX,
  interp1,
  volumenHm3,
  volumenExtrapolado,
  VOL_EN_390,
  volumenUtilHm3,
  nivelDesdeVolumen,
  nivelDesdeVolumenExtrapolado,
  FACTOR_UNIDADES_C,
  qLibreTotal,
  aperturaMax,
  MARGEN_FL_SATURACION,
  indiceInferior,
  valorTablaFila,
  caudalCompuertaTabla,
  caudalCompuerta,
  caudalVertederoDetallado,
  decidirCanalYAperturas,
  resolverAperturaComun,
  TABLA_CALIBRACION_VERTEDERO,
  CMP_COEF_LIBRE,
  HILL_PROTO_186,
  N_TURBINA_RPM,
  D_TURBINA_M,
  K_PERDIDA_CARGA,
  GAMMA_ORIGINAL_MAX,
  GAMMA_AMPLIADO_MAX,
  FACTOR_HIDROMETRIA_MW_POR_M3S,
  FC_HIDROMETRIA_POR_NIVEL,
  condicionVigente,
  textoHoraColombia,
  factorConversionHidrometria,
  REGLA_OPERATIVA_RES1891,
  bandaReglaOperativa,
  estadoReglaOperativa,
  ETIQUETA_ESTADO_REGLA,
  P_MAXIMO_ESPERADO_MW,
  GAMMA_ENSAYADO_MAX,
  POTENCIA_BASE_PCT_MW,
  pctFromDeg,
  degFromPct,
  MARGEN_FRECUENCIA_PCT,
  GAMMA_NORMAL_MAX,
  gammaMecanicoDeRango,
  etiquetaRango,
  ALMENARA_PUNTOS,
  nivelAlmenara,
  ASE_Q_GENERACION,
  ASE_ALMENARA,
  ASE_Q_RIO_MIN,
  ASE_Q_RIO_MAX,
  CONDICION_DESCARGA_DISENO,
  CONDICION_DESCARGA_DEFECTO,
  aseEnFila,
  completarTablaASE,
  ZONAS,
  nivelAlmenaraASE,
  nivelAlmenaraSegunCondicion,
  unidadesPorAlmenara,
  evaluarUnidadEnAlmenara,
  ASE_TABLA_COMPLETA,
  UNIDADES_POR_ALMENARA,
  NOMBRE_ALMENARA,
  etiquetaCondicionDescarga,
  GAMMAS_HILL,
  pchipPendientes,
  pchipEval,
  precalcularGammas,
  interpolarEntreAperturas,
  G_MODELO,
  G_SITIO,
  RHO_AGUA_PROTOTIPO,
  PRECALC_PROTO,
  n11DeH,
  evaluarHillChart,
  evaluarTurbinaUnidad,
  resolverGammaParaCaudal,
  resolverGammaParaPotencia,
  picoEficiencia,
  resolverGammaConLimitePotencia,
  WAE_PUNTOS,
  H_REFERENCIA_MODELO,
  curvaEficienciaEnH,
  HILL_MODELO_186,
  GAMMAS_MODELO,
  PRECALC_MODELO,
  evaluarModeloEnN11Gamma,
  marchingSquares,
  construirMallaModelo,
  construirMallaProto,
  resolverPorUnidadConPorcentajes,
  resolverUnidadesConPotencias,
  UNIDADES_CENTRAL,
  repartoPorUnidad,
  ordenDeMerito,
  buscarPuntoOptimo,
  ESCENARIOS_2023_EPM_GE,
  NOTA_LIMITE_GARANTIZADO,
  SERVOMOTOR_2023,
};
