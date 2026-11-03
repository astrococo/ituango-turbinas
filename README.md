# Turbinas Ituango

Operación en vivo, analítica e ingeniería de las turbinas Francis del PH Ituango.

**Aplicación:** https://astrococo.github.io/ituango-turbinas/

## Qué hace

La app tiene tres grupos de módulos. Cada módulo empieza con una guía corta: para qué sirve, qué logra y qué entrega.

**Operación en vivo** (decisiones en caliente; datos del relay de LoggerNet y de HydroForecast, se actualizan solos cada 5 min)

| Módulo | Contenido |
|---|---|
| Tablero | Nivel y su tendencia, potencia y caudal por unidad (Hidrometría, Winter-Kennedy relativo y modelo), vertedero, caudal total descargado, entrada al embalse por balance. Regla operativa del día: promedio hasta ahora frente a la banda, lo que debe promediar el resto del día para cerrar dentro (m³/s y MW) y el cierre proyectado. Gráficos de 48 h, pronóstico y aguas arriba. |
| Despacho | Nivel del embalse hora a hora con el despacho de XM, lo generado (RT) o el programa plano. El nivel de las 00:00, el Q de ayer, el caudal de entrada y las horas ya cerradas se llenan con los datos en vivo. |
| Buscador | Unidades y apertura para un caudal (por defecto, el pronóstico de hoy en Sitio Presa) al nivel actual. |
| Vertedero | Caudal y apertura por compuerta (relay v2) y calculadora de aperturas con las fórmulas del Simulador de crecientes (Tabla 10.6 a presión, Tabla 10.1 a flujo libre, reglas de canal). |

**Analítica** (histórico que arma un proceso automático cada hora)

| Módulo | Contenido |
|---|---|
| Regla 1891 y ANLA | Cumplimiento por periodo, calendario de estados, regla, vertedero, total descargado, entrada y nivel día a día; tabla con márgenes y CSV. |
| Unidades | Cada máquina por separado: horas, energía, arranques, F.C. Winter-Kennedy, factor relativo y orden de mérito, η aparente frente al modelo y rendimiento relativo por tramo de carga. |
| Hidrología y pronóstico | Pronóstico de 90 días, cómo cambió entre emisiones y su error a 1, 3 y 7 días, histórico desde 2015, aguas arriba y lluvia. |
| Operación medida | Minuto a minuto: Hidrometría, Winter-Kennedy y modelo; verificación de la columna de LoggerNet. |

**Ingeniería**: Colina, Curvas y F.C., Descarga (almenaras N°1 y N°2), Referencia (escenarios 2023).

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

- **Relay de LoggerNet** (equipo corporativo): sube los archivos de la estación del vertedero a un repositorio **privado**, en CSV diarios.
- **Proceso automático** (GitHub Actions en ese repositorio, cada hora): con el mismo código de esta app (`src/analitica.js`), arma el histórico diario y horario y archiva HydroForecast.
- **La app** lee el repositorio con un token de solo lectura que cada usuario pega en *Conexión de datos*; el token queda solo en su navegador. HydroForecast es público.
- Las ocho unidades comparten la colina, pero cada máquina rinde distinto: el Winter-Kennedy de cada una (sin calibrar) se usa como índice relativo para compararlas.

También se pueden cargar los archivos `.dat` de LoggerNet desde el equipo (Operación medida): se procesan en el navegador y no se envían a ningún lado.

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
| `src/analitica.js` | Resúmenes por hora y por día, regla operativa, vertedero, descargado, índices por unidad (lo usan la app y el proceso automático) |
| `src/datos/` | Lectura del repositorio de datos y de HydroForecast; estado en vivo |
| `src/ItuangoSimulador.jsx`, `src/ui/` | Interfaz (gráficos de series con uPlot en `src/ui/graficos.jsx`) |
| `tests/` | Pruebas contra los datos publicados del ensayo y casos de regresión |
| `AUDITORIA.md` | Revisión de noviembre de 2026 y estado de cada punto |

Resultados de apoyo a la operación: no reemplazan los procedimientos de EPM.
