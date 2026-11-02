# Turbinas Ituango

Colina de las turbinas Francis del PH Ituango, punto de operación, despacho intradiario y operación medida.

**Aplicación:** https://astrococo.github.io/ituango-turbinas/

## Qué hace

| Pestaña | Contenido |
|---|---|
| Buscador | Apertura, número de unidades y salto neto para un caudal de entrada: máxima eficiencia, máxima potencia, potencia objetivo o automático. |
| Despacho | Nivel del embalse hora a hora con el despacho de XM (se pega el resumen horario), la banda ±%, el Promedio RT y el caudal de entrada pronosticado. |
| Operación medida | Generación por unidad de LoggerNet (cada minuto) y caudal de Hidrometría frente al caudal del modelo con la misma potencia. |
| Colina | Exploración de la colina y familias de curvas en variables reducidas y a escala de prototipo. |
| Curvas y F.C. | Unidades requeridas por nivel, factor potencia/caudal (modelo y Hidrometría) y eficiencia a salto fijo. |
| Descarga | Nivel de las almenaras N°1 (U1-U4) y N°2 (U5-U8, desde 2028) según el caudal del río: río colmatado, diseño o manual. |
| Referencia | Escenarios de la ampliación de 2023, fuentes y glosario. |

## Modelo

- **Colina:** 186 puntos del ensayo de modelo (2013), transpuestos al prototipo según IEC 60193. Interpolación PCHIP a lo largo de n₁₁ y entre aperturas.
- **Potencia:** P = η·ρ·g·Q·H.
- **Salto neto:** nivel del embalse − nivel de la almenara − k·Q². La almenara sale de las tablas de río colmatado (2026). Fuera de lo simulado, se extrapola con la pendiente de la propia tabla y se marca.
- **Límites:**
  - 307 MW por unidad en el eje (≈ 303,6 MW en bornes);
  - apertura de 30,2° (100 %), con el 97 % como operación normal;
  - mínima ensayada: 4,87°.
- **Potencia de XM y de LoggerNet:** está en bornes. Se pasa al eje con el rendimiento del generador (98,55–98,91 %).
- **Factor de conversión de Hidrometría (MW por m³/s), como en su app:**
  - 1,62 hasta el 29-oct-2026 14:35;
  - desde entonces, 0,0119·nivel − 3,178 con el nivel del radar, válido entre 390 y 420 msnm; sin nivel válido, 1,80.
- **Regla operativa (Res. 1891), como en la app de Hidrometría:**
  - caudal regulado = potencia / F.C. (la descarga intermedia se toma 0);
  - banda del día = promedio de ayer ± 4,70 %;
  - cumple si el promedio final del día queda dentro;
  - con vertimiento, la validación se suspende.
- **Despacho:** cada hora se compara el Promedio RT con el despacho de XM ± banda ("Sin dato XM" no se evalúa ni cuenta como cero). El nivel se puede simular con el despacho de XM, con lo generado (RT) o con la operación plana que pide la regla.

## Datos de operación

El relay de LoggerNet (en el equipo corporativo) deja la generación, el caudal por unidad y el nivel del embalse en un repositorio **privado**, en CSV diarios. La app los lee con un token de solo lectura que cada usuario pega en la pestaña *Operación medida*. El token queda solo en su navegador.

También se pueden cargar los archivos `.dat` de LoggerNet desde el equipo: se procesan en el navegador y no se envían a ningún lado.

## Desarrollo

```
npm install
npm run dev      # http://localhost:5173
npm test         # pruebas del modelo (colina, almenaras, despacho, F.C., LoggerNet, regresión)
npm run build    # versión publicable en dist/
```

Cada cambio en `main` corre las pruebas, construye y publica en GitHub Pages (`.github/workflows/publicar.yml`).

| Ruta | Contenido |
|---|---|
| `src/modelo.js` | Modelo sin interfaz: colina, almenaras, embalse, buscador, despacho, F.C. |
| `src/operacion.js` | Lectura de LoggerNet y comparación con el modelo |
| `src/ItuangoSimulador.jsx`, `src/ui/` | Interfaz |
| `tests/` | Pruebas contra los datos publicados del ensayo y casos de regresión |
| `AUDITORIA.md` | Revisión de noviembre de 2026 y estado de cada punto |

Resultados de apoyo a la operación: no reemplazan los procedimientos de EPM.
