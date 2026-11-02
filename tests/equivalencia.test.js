/* Prueba de regresión: cualquier cambio en un resultado del modelo hace
   fallar esta prueba. Si el cambio es intencional, se regenera la línea
   base (tests/datos/linea_base_modelo.json) en el mismo commit y se
   documenta en el historial técnico.
   Historial de la línea base:
   - 3016ae7: versión con almenara configurable (antes de separar módulos);
     la separación en módulos la reprodujo exactamente.
   - punto 4 (oct-2026): PCHIP entre aperturas, relación de gravedades y
     P = η·ρ·g·Q·H; diferencias resumidas en el historial técnico.
   - operación conjunta de almenaras (oct-2026): U1-U4 → N°1, U5-U8 → N°2,
     tabla ASE completada y extrapolada con caudales bajos del río. Antes de
     regenerar se verificó que la condición de diseño y la manual con n ≤ 4
     dan exactamente lo mismo; ver el historial técnico. Se agregaron casos con 8
     unidades, río de 200 m³/s y almenaras manuales distintas.
   - auditoría de nov-2026: solo cambian 15 de 29 casos del Buscador. 14 son
     del "% por unidad" (el % es potencia en bornes y ahora se pasa al eje;
     la almenara recibe la suma real de caudales de sus unidades) y 1 es
     el criterio de desempate (antes 8 unidades con η 66 %, ahora 3 con
     η 93,7 %, mismo caudal). Colina, almenaras, inversos, vertedero y
     volúmenes, idénticos. */
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as m from "../src/modelo.js";
import { calcularCasos } from "./casosEquivalencia.js";

it("los resultados del modelo coinciden con la línea base", () => {
  const base = JSON.parse(readFileSync(new URL("./datos/linea_base_modelo.json", import.meta.url), "utf8"));
  const ahora = JSON.parse(JSON.stringify(calcularCasos(m)));
  for (const k of Object.keys(base)) expect(ahora[k], k).toEqual(base[k]);
});
