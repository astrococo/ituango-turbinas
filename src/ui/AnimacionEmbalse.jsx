/* ============================================================
   Animación del embalse con los datos medidos:
   A. Perfil del embalse (como la Figura 4 de la memoria CGI
      I-M-2194-044-HID-VC-CVE-001): niveles característicos, volúmenes
      y el agua subiendo o bajando con el nivel del radar.
   B. Sección encañonada equivalente: en cada cota, el ancho del espejo
      es proporcional al área ocupada (Tabla 3 de la memoria).
   C. Vertedero visto desde aguas arriba (plano del vertedero): 4
      compuertas radiales de 16,50 × 21,50 m entre pilas de 5 m, cresta
      del azud 401,00, losa de aproximación 396,00, puente 435,00; cada
      compuerta se levanta con su apertura medida (Open_GateX de
      LoggerNet) y muestra su caudal (Caudal_CompX).
   Escala vertical real en los tres; la horizontal de A es esquemática
   y la de C, a escala del plano.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from "react";
import { useVivo } from "../datos/vivo.jsx";
import { useHorario } from "../datos/historico.js";
import { volumenTotalHm3, areaEmbalseKm2, NAMO, NAME, NIVEL_MIN_TEC, ZV } from "../modelo.js";
import { fmtNum } from "./graficos.jsx";
import { Tarjeta, SelectorRango, rangoUltimos, fechaCorta, Nota } from "./comunes.jsx";

const NIVEL_MIN_FISICO = 350;
const FONDO = 219;
const ASIENTO = 400.09;      // cota inferior del asiento de la compuerta
const ALTO_COMPUERTA = 21.5; // m
const ANCHO_COMPUERTA = 16.5;
const ANCHO_PILA = 5;
const LOSA = 396;
const PUENTE = 435;
const V390 = volumenTotalHm3(NIVEL_MIN_TEC), VNAMO = volumenTotalHm3(NAMO), V350 = volumenTotalHm3(NIVEL_MIN_FISICO);
const VELOCIDADES = [[2, "Lenta"], [8, "Normal"], [24, "Rápida"], [60, "Muy rápida"]];

/* ---------- A. Perfil del embalse ---------- */
const PA = { w: 1000, h: 430, cMin: 205, cMax: 445, top: 18, bot: 412 };
const yA = (c) => PA.top + ((PA.cMax - c) / (PA.cMax - PA.cMin)) * (PA.bot - PA.top);
const X_PIE = 440, X_CIMA = 730, C_CIMA = 437; // ladera esquemática entre el fondo (219) y la cima
const xLadera = (c) => X_PIE + ((c - FONDO) / (C_CIMA - FONDO)) * (X_CIMA - X_PIE);
const X_COMP_A = xLadera(ZV) + 14; // compuerta del vertedero en el perfil

function Perfil({ T, f, agua, terreno, concreto }) {
  const n = f ? f.nivel : null;
  const abierto = f && f.aComp && f.aComp.some((a) => a > 0.02);
  const xL = 70;
  // agua: hasta la ladera; sobre la cresta del vertedero llega hasta la compuerta
  const aguaPts = n == null ? null : n <= ZV
    ? [[xL, yA(FONDO)], [X_PIE, yA(FONDO)], [xLadera(n), yA(n)], [xL, yA(n)]]
    : [[xL, yA(FONDO)], [X_PIE, yA(FONDO)], [xLadera(ZV), yA(ZV)], [X_COMP_A, yA(ZV)], [X_COMP_A, yA(n)], [xL, yA(n)]];
  const lineas = [
    [NAME, "Nivel máximo extraordinario", "432,50"], [NAMO, "Nivel normal de operación (NAMO)", "420,00"],
    [NIVEL_MIN_TEC, "Nivel mínimo técnico", "390,00"], [NIVEL_MIN_FISICO, "Nivel mínimo físico", "350,00"],
  ];
  const corchete = (c0, c1, x, txt) => (
    <g>
      <line x1={x} x2={x} y1={yA(c1) + 2} y2={yA(c0) - 2} stroke={T.inkMuted} strokeWidth="1" markerStart="url(#flechaA)" markerEnd="url(#flechaA)" />
      <text x={x + 8} y={(yA(c0) + yA(c1)) / 2 + 4} fontSize="11.5" fill={T.inkMuted}>{txt}</text>
    </g>
  );
  const xCapt = xLadera(NIVEL_MIN_FISICO);
  return (
    <svg viewBox={`0 0 ${PA.w} ${PA.h}`} width="100%" role="img" aria-label={`Perfil del embalse con el nivel ${n != null ? fmtNum(n, 2) : "sin dato"} msnm`} style={{ display: "block" }}>
      <defs>
        <linearGradient id="aguaA" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={agua} stopOpacity="0.55" /><stop offset="1" stopColor={agua} stopOpacity="0.22" /></linearGradient>
        <marker id="flechaA" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill={T.inkMuted} /></marker>
        <pattern id="rocaA" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill={terreno} /><circle cx="2" cy="2" r="0.9" fill={T.line} /></pattern>
      </defs>
      {/* agua */}
      {aguaPts && <polygon points={aguaPts.map((p) => p.join(",")).join(" ")} fill="url(#aguaA)" style={{ transition: "all 120ms linear" }} />}
      {n != null && <line x1={xL} x2={n <= ZV ? xLadera(n) : X_COMP_A} y1={yA(n)} y2={yA(n)} stroke={agua} strokeWidth="2.2" />}
      {/* terreno: fondo y ladera (esquemática) */}
      <polygon points={`40,${yA(FONDO)} ${X_PIE},${yA(FONDO)} ${xLadera(ZV)},${yA(ZV)} ${xLadera(ZV)},${PA.h} 40,${PA.h}`} fill="url(#rocaA)" stroke={T.inkFaint} strokeWidth="1" />
      {/* vertedero: azud a 401, compuerta radial y rápida */}
      <polygon points={`${xLadera(ZV)},${yA(ZV)} ${X_COMP_A + 46},${yA(ZV)} ${X_COMP_A + 120},${yA(330)} ${PA.w - 20},${yA(262)} ${PA.w - 20},${PA.h} ${xLadera(ZV)},${PA.h}`} fill="url(#rocaA)" stroke={T.inkFaint} strokeWidth="1" />
      <path d={`M${X_COMP_A + 46},${yA(ZV)} L${X_COMP_A + 120},${yA(330)} L${PA.w - 20},${yA(262)}`} fill="none" stroke={concreto} strokeWidth="5" />
      {abierto && n > ZV && <path d={`M${X_COMP_A + 2},${yA(ZV) - 3} L${X_COMP_A + 46},${yA(ZV) - 3} L${X_COMP_A + 120},${yA(330) - 3} L${PA.w - 20},${yA(262) - 3}`} fill="none" stroke={agua} strokeWidth="3.5" strokeDasharray="10 8" className="itu-flujo" />}
      <rect x={X_COMP_A - 4} y={yA(PUENTE)} width="10" height={yA(ZV) - yA(PUENTE)} fill={concreto} />
      <rect x={X_COMP_A - 10} y={yA(PUENTE) - 4} width="60" height="6" fill={concreto} />
      <text x={X_COMP_A + 12} y={yA(ZV) + 14} fontSize="11" fill={T.inkMuted}>▼ {fmtNum(ZV, 2)} cresta del vertedero</text>
      <text x={X_COMP_A - 8} y={yA(PUENTE) - 10} fontSize="11.5" fontWeight="700" fill={T.ink}>Vertedero</text>
      {/* captación a 350 y conducción (esquemática) a la casa de máquinas */}
      <rect x={xCapt - 26} y={yA(NIVEL_MIN_FISICO) - 12} width="30" height="14" rx="2" fill={concreto} />
      <path d={`M${xCapt},${yA(NIVEL_MIN_FISICO) - 5} L${X_COMP_A + 40},${yA(345)} L${X_COMP_A + 40},${yA(232)} L${X_COMP_A + 62},${yA(232)}`} fill="none" stroke={concreto} strokeWidth="5" strokeLinejoin="round" />
      <rect x={X_COMP_A + 62} y={yA(240)} width="96" height="24" rx="4" fill={T.panelSoft} stroke={concreto} />
      <text x={X_COMP_A + 110} y={yA(240) + 16} fontSize="11" textAnchor="middle" fill={T.ink}>Casa de máquinas</text>
      <text x={xCapt - 30} y={yA(NIVEL_MIN_FISICO) + 18} fontSize="11" fill={T.inkMuted} textAnchor="end">Estructura de captación ▼ 350,00</text>
      {/* niveles característicos */}
      {lineas.map(([c, rot, txt]) => (
        <g key={c}>
          <line x1={xL} x2={xLadera(Math.min(c, ZV)) + (c > ZV ? 20 : 0)} y1={yA(c)} y2={yA(c)} stroke={T.inkFaint} strokeWidth="0.9" strokeDasharray="5 4" />
          <text x={xL + 4} y={yA(c) - 4} fontSize="11" fill={T.inkMuted}>{rot} = {txt} msnm</text>
        </g>
      ))}
      {/* volúmenes de la Figura 4 recalculados con la Ec.2 */}
      {corchete(NIVEL_MIN_TEC, NAMO, 330, `Volumen útil = ${fmtNum(VNAMO - V390, 0)} hm³`)}
      {corchete(NIVEL_MIN_FISICO, NIVEL_MIN_TEC, 330, `Volumen mínimo técnico = ${fmtNum(V390 - V350, 0)} hm³`)}
      {corchete(FONDO, NIVEL_MIN_FISICO, 330, `Volumen muerto = ${fmtNum(V350, 0)} hm³`)}
      {corchete(FONDO, NAMO, 54, "")}
      <text x={40} y={yA(300)} fontSize="11.5" fill={T.inkMuted} transform={`rotate(-90 40 ${yA(300)})`} textAnchor="middle">Volumen total = {fmtNum(VNAMO, 0)} hm³</text>
      {/* nivel actual */}
      {n != null && (
        <g>
          <rect x={545} y={yA(n) + 6} width="250" height="22" rx="5" fill={T.panel} stroke={agua} />
          <text x={555} y={yA(n) + 21} fontSize="12.5" fontWeight="700" fill={T.ink}>Nivel {fmtNum(n, 2)} msnm · {fmtNum(f.vt, 1)} hm³</text>
        </g>
      )}
      <text x={PA.w - 20} y={PA.h - 6} fontSize="10.5" textAnchor="end" fill={T.inkFaint}>Escala vertical real; horizontal esquemática (como la Figura 4 de la memoria)</text>
    </svg>
  );
}

/* ---------- B. Sección encañonada equivalente ---------- */
const PB = { w: 460, h: 430, cx: 230, semi: 200 };
const A_MAX_B = areaEmbalseKm2(PA.cMax);
const semiAncho = (c) => (areaEmbalseKm2(Math.max(FONDO, c)) / A_MAX_B) * PB.semi;
const COTAS_B = Array.from({ length: Math.round((PA.cMax - FONDO) / 1) + 1 }, (_, i) => FONDO + i);

function Canon({ T, f, agua, terreno }) {
  const n = f ? f.nivel : null;
  const izq = COTAS_B.map((c) => [PB.cx - semiAncho(c), yA(c)]);
  const der = COTAS_B.map((c) => [PB.cx + semiAncho(c), yA(c)]).reverse();
  const roca = [[8, PA.h], [8, yA(PA.cMax)], ...izq.slice().reverse(), [PB.cx, yA(FONDO)], ...der.slice().reverse(), [PB.w - 8, yA(PA.cMax)], [PB.w - 8, PA.h]];
  const aguaPts = n == null ? null : (() => {
    const cs = COTAS_B.filter((c) => c < n).concat([n]);
    return [...cs.map((c) => [PB.cx - semiAncho(c), yA(c)]), ...cs.slice().reverse().map((c) => [PB.cx + semiAncho(c), yA(c)])];
  })();
  return (
    <svg viewBox={`0 0 ${PB.w} ${PB.h}`} width="100%" role="img" aria-label="Sección encañonada equivalente del embalse" style={{ display: "block" }}>
      <defs>
        <linearGradient id="aguaB" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={agua} stopOpacity="0.6" /><stop offset="1" stopColor={agua} stopOpacity="0.25" /></linearGradient>
        <pattern id="rocaB" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill={terreno} /><circle cx="2" cy="2" r="0.9" fill={T.line} /></pattern>
      </defs>
      <polygon points={roca.map((p) => p.join(",")).join(" ")} fill="url(#rocaB)" stroke={T.inkFaint} strokeWidth="1" />
      {aguaPts && <polygon points={aguaPts.map((p) => p.join(",")).join(" ")} fill="url(#aguaB)" />}
      {[[NAME, "432,50"], [NAMO, "420,00"], [NIVEL_MIN_TEC, "390,00"], [NIVEL_MIN_FISICO, "350,00"], [300, "300"], [250, "250"]].map(([c, t]) => (
        <g key={c}>
          <line x1={PB.cx - semiAncho(c) - 6} x2={PB.cx + semiAncho(c) + 6} y1={yA(c)} y2={yA(c)} stroke={T.inkFaint} strokeWidth="0.8" strokeDasharray="4 4" />
          <text x={PB.cx + semiAncho(c) + 10} y={yA(c) + 4} fontSize="10.5" fill={T.inkMuted}>{t}</text>
        </g>
      ))}
      {n != null && (
        <g>
          <line x1={PB.cx - semiAncho(n)} x2={PB.cx + semiAncho(n)} y1={yA(n)} y2={yA(n)} stroke={agua} strokeWidth="2.2" />
          <text x={PB.cx} y={yA(n) - 8} fontSize="12.5" fontWeight="700" textAnchor="middle" fill={T.ink}>Área {fmtNum(f.area, 2)} km²</text>
        </g>
      )}
      <text x={PB.cx} y={PA.h - 6} fontSize="10.5" textAnchor="middle" fill={T.inkFaint}>Ancho en cada cota ∝ área ocupada (Tabla 3, LIDAR 2012)</text>
    </svg>
  );
}

/* ---------- C. Vertedero visto desde aguas arriba ---------- */
const PC = { w: 560, h: 400, cMin: 390, cMax: 440, top: 14, bot: 372 };
const yC = (c) => PC.top + ((PC.cMax - c) / (PC.cMax - PC.cMin)) * (PC.bot - PC.top);
const MURO_IZQ = 7, MURO_DER = 3;
const ANCHO_TOTAL = MURO_IZQ + 4 * ANCHO_COMPUERTA + 3 * ANCHO_PILA + MURO_DER;
const ESC = (PC.w - 120) / ANCHO_TOTAL; // px por metro
const X0C = 24;
const xBahia = (g) => X0C + (MURO_IZQ + g * (ANCHO_COMPUERTA + ANCHO_PILA)) * ESC;

function VertederoFrente({ T, f, agua, concreto, metal }) {
  const n = f ? f.nivel : null;
  const xFin = X0C + ANCHO_TOTAL * ESC;
  return (
    <svg viewBox={`0 0 ${PC.w} ${PC.h}`} width="100%" role="img" aria-label="Vertedero: compuertas radiales vistas desde aguas arriba" style={{ display: "block" }}>
      {/* losa de aproximación y azud */}
      <rect x={X0C} y={yC(LOSA)} width={xFin - X0C} height={yC(LOSA - 3) - yC(LOSA)} fill={concreto} opacity="0.85" />
      {/* muros y pilas */}
      <rect x={X0C} y={yC(PUENTE)} width={MURO_IZQ * ESC} height={yC(LOSA - 3) - yC(PUENTE)} fill={concreto} />
      <rect x={xFin - MURO_DER * ESC} y={yC(PUENTE)} width={MURO_DER * ESC} height={yC(LOSA - 3) - yC(PUENTE)} fill={concreto} />
      {[0, 1, 2].map((p) => {
        const x = xBahia(p) + ANCHO_COMPUERTA * ESC;
        return <path key={p} d={`M${x},${yC(PUENTE)} L${x + ANCHO_PILA * ESC},${yC(PUENTE)} L${x + ANCHO_PILA * ESC},${yC(399)} L${x + (ANCHO_PILA * ESC) / 2},${yC(397)} L${x},${yC(399)} Z`} fill={concreto} />;
      })}
      {/* compuertas */}
      {[0, 1, 2, 3].map((g) => {
        const a = f && f.aComp ? Math.max(0, f.aComp[g] || 0) : 0;
        const q = f && f.qComp ? f.qComp[g] : null;
        const x = xBahia(g), w = ANCHO_COMPUERTA * ESC;
        const inf = ASIENTO + a, sup = Math.min(PUENTE - 0.5, ASIENTO + ALTO_COMPUERTA + a);
        const abierta = a > 0.02 && n != null && n > ASIENTO;
        return (
          <g key={g}>
            <rect x={x + 1} y={yC(sup)} width={w - 2} height={yC(inf) - yC(sup)} fill={metal} stroke={T.inkFaint} strokeWidth="0.8" style={{ transition: "y 150ms linear, height 150ms linear" }} />
            <line x1={x + 4} y1={yC(sup) + 4} x2={x + w - 4} y2={yC(inf) - 4} stroke={T.red} strokeWidth="0.8" opacity="0.7" />
            <line x1={x + w - 4} y1={yC(sup) + 4} x2={x + 4} y2={yC(inf) - 4} stroke={T.red} strokeWidth="0.8" opacity="0.7" />
            {abierta && <rect x={x + 1} y={yC(inf)} width={w - 2} height={yC(ZV) - yC(inf)} fill={agua} opacity="0.85" className="itu-flujo-v" />}
            <text x={x + w / 2} y={yC(PUENTE) + 14} fontSize="12" fontWeight="700" textAnchor="middle" fill={T.ink}>C{g + 1}</text>
            <text x={x + w / 2} y={yC(LOSA - 3) + 14} fontSize="10.5" textAnchor="middle" fill={T.inkMuted}>{f && f.aComp ? `${fmtNum(a, 2)} m` : "—"}</text>
            <text x={x + w / 2} y={yC(LOSA - 3) + 27} fontSize="10.5" textAnchor="middle" fill={abierta ? T.teal : T.inkFaint} fontWeight={abierta ? 700 : 400}>{q != null ? `${fmtNum(q, 0)} m³/s` : "—"}</text>
          </g>
        );
      })}
      {/* puente y casetas de los mecanismos */}
      <rect x={X0C} y={yC(PUENTE) - 5} width={xFin - X0C} height="5" fill={T.red} opacity="0.55" />
      {[X0C + (MURO_IZQ * ESC) / 2, ...[0, 1, 2].map((p) => xBahia(p) + (ANCHO_COMPUERTA + ANCHO_PILA / 2) * ESC)].map((cx, i) => (
        <g key={i}><rect x={cx - 9} y={yC(PUENTE) - 19} width="18" height="14" fill={T.panelSoft} stroke={T.inkFaint} strokeWidth="0.8" /><path d={`M${cx - 12},${yC(PUENTE) - 19} L${cx},${yC(PUENTE) - 26} L${cx + 12},${yC(PUENTE) - 19} Z`} fill={T.inkFaint} /></g>
      ))}
      {/* agua aguas arriba (delante de las compuertas) */}
      {n != null && n > LOSA && (
        <g>
          <rect x={X0C} y={yC(n)} width={xFin - X0C} height={yC(LOSA) - yC(n)} fill={agua} opacity="0.2" style={{ transition: "y 150ms linear, height 150ms linear" }} />
          <line x1={X0C} x2={xFin} y1={yC(n)} y2={yC(n)} stroke={agua} strokeWidth="2.2" />
        </g>
      )}
      {/* cotas del plano */}
      {[[PUENTE, "435,00 puente"], [NAME, "432,50 NAME"], [NAMO, "420,00 NAMO"], [ASIENTO + ALTO_COMPUERTA, "421,59 tope compuerta cerrada"], [ZV, "401,00 cresta del azud"], [LOSA, "396,00 losa de aproximación"]].map(([c, t]) => (
        <g key={t}>
          <line x1={xFin} x2={xFin + 8} y1={yC(c)} y2={yC(c)} stroke={T.inkFaint} />
          <text x={xFin + 10} y={yC(c) + 4} fontSize="9.5" fill={T.inkMuted}>{t.split(" ")[0]}</text>
        </g>
      ))}
      {n != null && <text x={X0C + 4} y={yC(n) - 5} fontSize="11.5" fontWeight="700" fill={T.ink}>Nivel {fmtNum(n, 2)} msnm</text>}
      <text x={X0C} y={PC.h - 4} fontSize="10.5" fill={T.inkFaint}>Compuertas radiales de 16,50 × 21,50 m; pilas de 5 m; apertura y caudal medidos (LoggerNet)</text>
    </svg>
  );
}

/* ---------- Componente con reproducción ---------- */
export default function AnimacionEmbalse({ T, vistaInicial = "todo" }) {
  const { vivo } = useVivo() || {};
  const hoy = vivo ? vivo.hoy : null;
  const minLN = (vivo && vivo.estadoProceso && vivo.estadoProceso.primerDia) || null;
  const [escala, setEscala] = useState("horaria");
  const [rangoSel, setRango] = useState(null);
  const rango = useMemo(() => {
    if (!hoy) return { desde: null, hasta: null };
    if (escala === "continua") { const r = rangoSel || { desde: vivo.ayer, hasta: hoy }; return { desde: r.desde < vivo.ayer ? vivo.ayer : r.desde, hasta: r.hasta }; }
    const r = rangoSel || rangoUltimos(hoy, "7", minLN);
    return minLN && r.desde < minLN ? { ...r, desde: minLN } : r;
  }, [rangoSel, hoy, escala, minLN, vivo]);
  const horario = useHorario(escala === "horaria" ? rango.desde : null, escala === "horaria" ? rango.hasta : null);

  const cuadros = useMemo(() => {
    let filas = [];
    if (!rango.desde) return [];
    if (escala === "continua") {
      // dato de cada minuto de hoy y ayer; se toma uno cada 5 min
      filas = (vivo && vivo.filas ? vivo.filas : []).filter((r) => r.t.slice(0, 10) >= rango.desde && r.t.slice(0, 10) <= rango.hasta && r.nivel != null && +r.t.slice(14, 16) % 5 === 0)
        .map((r) => ({ t: r.t.slice(0, 16), nivel: r.nivel, aComp: r.aComp || null, qComp: r.qComp || null, qVert: r.qVert }));
    } else {
      const h = horario.datos;
      if (!h) return [];
      filas = h.t.map((t, i) => ({ t, nivel: h.nivel[i], aComp: h.aComp[i], qComp: h.qComp[i], qVert: h.qVert[i] }));
      if (vivo && vivo.resHoy && rango.hasta >= vivo.hoy) {
        const ya = new Set(filas.map((r) => r.t));
        vivo.resHoy.horas.forEach((x) => { if (x && !ya.has(x.t)) filas.push({ t: x.t, nivel: x.nivel, aComp: x.aComp || null, qComp: x.qComp || null, qVert: x.qVert }); });
      }
      filas = filas.filter((r) => Number.isFinite(r.nivel));
    }
    return filas.map((r) => { const vt = volumenTotalHm3(r.nivel); return { ...r, vt, vu: Math.max(0, vt - V390), area: areaEmbalseKm2(r.nivel) }; });
  }, [escala, rango.desde, rango.hasta, vivo, horario.datos]);

  const [i, setI] = useState(null);
  const [play, setPlay] = useState(false);
  const [vel, setVel] = useState(8);
  const idx = cuadros.length ? Math.min(i == null ? cuadros.length - 1 : i, cuadros.length - 1) : null;
  const f = idx != null ? cuadros[idx] : null;
  // al cambiar de datos, mostrar el último cuadro
  useEffect(() => { setI(null); setPlay(false); }, [escala, rango.desde, rango.hasta]);
  const ref = useRef({ ultimo: 0, acum: 0 });
  useEffect(() => {
    if (!play || !cuadros.length) return undefined;
    let id;
    ref.current = { ultimo: performance.now(), acum: 0 };
    const paso = (ahora) => {
      const r = ref.current; r.acum += ((ahora - r.ultimo) / 1000) * vel; r.ultimo = ahora;
      if (r.acum >= 1) {
        const k = Math.floor(r.acum); r.acum -= k;
        setI((prev) => { const base = prev == null || prev >= cuadros.length - 1 ? (prev == null ? 0 : prev) : prev; const nx = base + k; if (nx >= cuadros.length - 1) { setPlay(false); return cuadros.length - 1; } return nx; });
      }
      id = requestAnimationFrame(paso);
    };
    id = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(id);
  }, [play, vel, cuadros.length]);
  const reproducir = () => { if (!play && (idx == null || idx >= cuadros.length - 1)) setI(0); setPlay((p) => !p); };

  // resumen del rango
  const resumen = useMemo(() => {
    if (!cuadros.length) return null;
    const ns = cuadros.map((c) => c.nivel);
    const a = cuadros[0], b = cuadros[cuadros.length - 1];
    return { min: Math.min(...ns), max: Math.max(...ns), dV: b.vt - a.vt, horasVert: cuadros.filter((c) => c.qVert > 1).length };
  }, [cuadros]);

  const agua = T.esOscuro ? "#38bdf8" : "#0284c7";
  const terreno = T.esOscuro ? "#1c283d" : "#e7e2d6";
  const concreto = T.esOscuro ? "#64748b" : "#9aa5b4";
  const metal = T.esOscuro ? "#334155" : "#cbd5e1";
  const [vista, setVista] = useState(vistaInicial);
  const boton = (activo) => ({ padding: "6px 11px", fontSize: 12.5, border: "none", borderRight: `1px solid ${T.line}`, background: activo ? T.accentSoft : T.panel, color: activo ? T.teal : T.inkMuted, fontWeight: activo ? 700 : 500, cursor: "pointer" });
  const grupo = { display: "inline-flex", border: `1px solid ${T.line}`, borderRadius: 8, overflow: "hidden" };
  const kpi = (r, v) => <div style={{ minWidth: 0 }}><div style={{ fontSize: 11.5, color: T.inkFaint }}>{r}</div><div style={{ fontSize: 15, fontWeight: 700, color: T.ink, fontVariantNumeric: "tabular-nums" }}>{v}</div></div>;

  return (
    <Tarjeta T={T} id="animacion-embalse" titulo="Animación del embalse y del vertedero"
      subtitulo="Reproduce el nivel medido del radar y la apertura y el caudal de cada compuerta (LoggerNet). Volumen con la Ec.2 y área con la Tabla 3 de la memoria CGI; vertedero según su plano."
      accion={hoy && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <div style={grupo} role="group" aria-label="Escala">
            {[["continua", "Continua (5 min)"], ["horaria", "Horaria"]].map(([k, r]) => <button key={k} aria-pressed={escala === k} onClick={() => { setEscala(k); setRango(null); }} style={boton(escala === k)}>{r}</button>)}
          </div>
          <SelectorRango T={T} min={escala === "continua" ? vivo.ayer : minLN || hoy} max={hoy} valor={rango} onChange={setRango} atajos={escala === "continua" ? [["1", "Hoy"], ["2", "48 h"]] : [["7", "7 días"], ["30", "30 días"], ["90", "90 días"], ["todo", "Todo"]]} />
        </div>
      )}>
      <style>{`
        @keyframes itu-flujo { to { stroke-dashoffset: -36; } }
        @keyframes itu-flujo-v { 0% { opacity: .55 } 50% { opacity: .95 } 100% { opacity: .55 } }
        .itu-flujo { animation: itu-flujo 0.9s linear infinite; }
        .itu-flujo-v { animation: itu-flujo-v 1.2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .itu-flujo, .itu-flujo-v { animation: none; } }
      `}</style>
      {/* controles de reproducción */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <button onClick={reproducir} disabled={!cuadros.length} aria-label={play ? "Pausar" : "Reproducir"} style={{ ...boton(true), border: `1px solid ${T.line}`, borderRadius: 8, minWidth: 104 }}>{play ? "❚❚ Pausar" : "▶ Reproducir"}</button>
        <div style={grupo} role="group" aria-label="Velocidad">
          {VELOCIDADES.map(([v, r]) => <button key={v} aria-pressed={vel === v} onClick={() => setVel(v)} style={boton(vel === v)}>{r}</button>)}
        </div>
        <div style={grupo} role="group" aria-label="Vista">
          {[["todo", "Todo"], ["perfil", "Perfil"], ["canon", "Cañón"], ["vertedero", "Vertedero"]].map(([k, r]) => <button key={k} aria-pressed={vista === k} onClick={() => setVista(k)} style={boton(vista === k)}>{r}</button>)}
        </div>
      </div>
      <input type="range" min={0} max={Math.max(0, cuadros.length - 1)} value={idx ?? 0} onChange={(e) => { setPlay(false); setI(+e.target.value); }} disabled={!cuadros.length} aria-label="Momento de la animación" style={{ width: "100%", accentColor: T.teal }} />
      {f ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, margin: "8px 0 12px", padding: "9px 12px", background: T.panelSoft, borderRadius: 10 }}>
          {kpi("Fecha y hora", `${fechaCorta(f.t.slice(0, 10))} ${f.t.slice(11, 16)}`)}
          {kpi("Nivel", `${fmtNum(f.nivel, 2)} msnm`)}
          {kpi("Volumen útil", `${fmtNum(f.vu, 1)} hm³ · ${fmtNum((f.vu / (VNAMO - V390)) * 100, 1)} %`)}
          {kpi("Volumen total", `${fmtNum(f.vt, 1)} hm³`)}
          {kpi("Área", `${fmtNum(f.area, 2)} km²`)}
          {kpi("Vertedero", f.qVert != null ? `${fmtNum(Math.max(0, f.qVert), 0)} m³/s` : "—")}
        </div>
      ) : <div style={{ fontSize: 13, color: T.inkFaint, padding: "18px 0" }}>{escala === "horaria" && horario.cargando ? "Cargando…" : "Sin datos de nivel en el rango elegido."}</div>}
      {(vista === "todo" || vista === "perfil") && <div style={{ overflowX: "auto" }}><div style={{ minWidth: 720 }}><Perfil T={T} f={f} agua={agua} terreno={terreno} concreto={concreto} /></div></div>}
      {vista === "todo" ? (
        <div className="itu-2col" style={{ marginTop: 12 }}>
          <div><div style={{ fontSize: 12.5, fontWeight: 700, color: T.ink, marginBottom: 4 }}>Sección encañonada (equivalente)</div><Canon T={T} f={f} agua={agua} terreno={terreno} /></div>
          <div><div style={{ fontSize: 12.5, fontWeight: 700, color: T.ink, marginBottom: 4 }}>Vertedero desde aguas arriba</div><VertederoFrente T={T} f={f} agua={agua} concreto={concreto} metal={metal} /></div>
        </div>
      ) : vista === "canon" ? <Canon T={T} f={f} agua={agua} terreno={terreno} /> : vista === "vertedero" ? <VertederoFrente T={T} f={f} agua={agua} concreto={concreto} metal={metal} /> : null}
      {resumen && <p style={{ fontSize: 12.5, color: T.inkMuted, margin: "10px 0 0" }}>En el rango: nivel entre {fmtNum(resumen.min, 2)} y {fmtNum(resumen.max, 2)} msnm; el volumen cambió {resumen.dV >= 0 ? "+" : "−"}{fmtNum(Math.abs(resumen.dV), 1)} hm³; {resumen.horasVert} {escala === "horaria" ? "horas" : "cuadros de 5 min"} con vertimiento.</p>}
      <Nota T={T} rotulo="Qué es medido y qué es esquemático">
        Medido: el nivel (radar), la apertura de cada compuerta (Open_GateX, en metros: el caudal calculado con la Tabla 10.6 con esas aperturas coincide con el de LoggerNet en menos de 1 %) y su caudal (Caudal_CompX). Calculado con la memoria CGI: volumen (Ec.2) y área (Tabla 3). Del plano del vertedero: compuertas de 16,50 × 21,50 m, pilas de 5 m, asiento 400,09, cresta 401,00, losa 396,00 y puente 435,00; la numeración C1–C4 va de izquierda a derecha visto desde el embalse (C1 es el canal izquierdo). En el perfil la escala vertical es real y la horizontal, esquemática, igual que en la Figura 4; la conducción y la casa de máquinas solo indican su posición. La sección encañonada es equivalente: su ancho en cada cota es proporcional al área del espejo, no el perfil topográfico de un corte. En la vista del vertedero la compuerta se dibuja subiendo su apertura; en la realidad gira sobre su eje (radial).
      </Nota>
    </Tarjeta>
  );
}
