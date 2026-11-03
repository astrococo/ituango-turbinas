# Auditoría · Turbinas Ituango

Fecha: 2-nov-2026. Revisión de cada pestaña, campo y resultado. Un revisor independiente usó la app en PC y en teléfono y verificó cada hallazgo con números. Después de las correcciones, un segundo revisor confirmó 9 de los 10 puntos y encontró los problemas de la última tabla, que también se corrigieron.

## Modelo y cálculos

| Estado | Punto | Detalle |
|---|---|---|
| ✅ Corregido | Buscador con poco caudal | Con poco caudal, "Buscar punto óptimo" y "Automático" podían repartirlo entre tantas unidades que cada una quedaba bajo la apertura mínima ensayada (4,87°): resultado no cumplible, con η ≈ 38 %. Ahora esas opciones se descartan. Si varias turbinan lo mismo (±1 m³/s), se elige la de mayor eficiencia. Antes se prefería la de más unidades. |
| ✅ Corregido | Bornes y eje | El despacho de XM, el Promedio RT, el % operativo de Hidrometría y la "potencia objetivo" son potencia en bornes. Ahora todos se pasan al eje con el rendimiento del generador antes de entrar a la colina. Antes solo lo hacía el despacho, y quedaba una diferencia de 1,2 % en caudal entre módulos. |
| ✅ Corregido | % por unidad con potencias distintas | Cada unidad calculaba el nivel de su almenara como si todas las de esa almenara turbinaran su mismo caudal. Ahora la almenara recibe la suma real, con una iteración de punto fijo. Ejemplo: [100, 30, 30, 30] % antes daba 227,70 y 225,00 msnm para la misma almenara. |
| ✅ Corregido | Capacidad máxima sin el límite de 307 MW | "Unidades requeridas" y el F.C. del modelo usaban la apertura máxima sin el tope de 307 MW. Desde unos 411 msnm sobreestimaban la capacidad: por ejemplo, 190 m³/s y 333 MW con una unidad a 420 msnm. |
| ✅ Corregido | Aviso de 307 MW en la exploración | Con unidades en las dos almenaras, el aviso usaba la potencia promedio. Ahora usa la de la unidad más cargada. |
| ✅ Corregido | Unidades mínimas en el despacho | 307 MW es un límite en el eje, que equivale a unos 303,6 MW en bornes. La tolerancia para dar una potencia por "alcanzable" bajó de 1 % a 0,1 %. |
| ✅ Corregido | Despacho bajo el mínimo ensayado | Antes la hora quedaba con caudal cero. Ahora se reparte entre menos unidades. Si ni una alcanza, se usa el caudal de la apertura mínima y se marca. |
| ✅ Nuevo | Factor de conversión de Hidrometría | Igual que en la app de Hidrometría: 1,62 hasta el 29-oct-2026 14:35; desde entonces 0,0119·nivel − 3,178 con el nivel del radar, entre 390 y 420 msnm (fuera de ese rango o sin nivel, 1,80). Se aplica según la fecha de cada dato. Con 2-3 unidades y el río bajo coincide con el modelo dentro de ±2 % entre 400 y 420 msnm. Con 4 unidades y el río alto, el F.C. de la fórmula es 2-4 % mayor que el del modelo. |
| ✅ Nuevo | Operación medida (LoggerNet) | Generación y caudal por unidad cada minuto, y nivel del radar cada 5 min. Se verifica que el caudal de Hidrometría sea potencia / F.C. Los caudales Winter-Kennedy se leen pero no se usan hasta que estén calibrados. |
| ⚠️ Atención | Tablas de almenara fuera de lo simulado | Con el río bajo 500 m³/s, o con 3-4 unidades y el río entre 500 y 1000 m³/s, el nivel de la almenara se estima a partir de la propia tabla. Conviene que la Asesoría simule esos casos. |
| ⚠️ Atención | Caudal de entrada al embalse | Es la entrada que más pesa en el despacho: 10 m³/s sostenidos 24 h equivalen a unos 2,5 cm de nivel. La app lo recibe como pronóstico del usuario. |
| ✅ Correcto | Colina frente al ensayo | 186 puntos: error medio de 0,035 % en Q y 0,06 % en P. 35 puntos BEP fuera de muestra: error de 0,08 pp en η. En el BEP publicado: Q −0,4 %, P −0,5 %, η −0,10 pp. |
| ✅ Correcto | Pruebas automáticas | 57 pruebas: colina, almenaras, operación conjunta, límites, despacho, F.C., LoggerNet y regresión de 935 casos. |

## Interfaz

| Estado | Punto | Detalle |
|---|---|---|
| ✅ Corregido | Página única muy larga | Se organizó en pestañas: Buscador, Despacho, Operación medida, Colina, Curvas y F.C., Descarga y Referencia. Cada pestaña tiene enlace propio (#despacho, etc.). |
| ✅ Corregido | Teléfono | Rejillas adaptables y ayudas emergentes dentro de la pantalla. Las colinas se desplazan de lado con números legibles. No hay desbordamiento horizontal a 390 px en ninguna pestaña. |
| ✅ Corregido | Números | Coma decimal y punto de miles (es-CO), como Material Flotante y HydroForecast. Los campos se redondean según su paso; antes se veía 71.19205298013244. |
| ✅ Corregido | Contraste | Nueva paleta pizarra con acento azul cielo. Textos con contraste de al menos 4,5:1 en tema claro y oscuro. Colores de las aperturas con al menos 3:1 en los dos. |
| ✅ Corregido | Gráficas de F.C. | Eje con escala automática y 3 decimales; incluyen las dos reglas de Hidrometría. |
| ✅ Corregido | Textos desactualizados | El título de la página y las referencias a un simulador que la app ya no tiene. |
| ✅ Nuevo | Instalable | Manifiesto, íconos y copia sin conexión (primero la red). El tema y el contraste se recuerdan en el navegador. |
| ✅ Nuevo | Despacho | Fecha del despacho (tomada del texto pegado), aviso cuando falta el despacho y columna "Q Hidrometría". |

## Segunda revisión (después de las correcciones)

| Estado | Punto | Detalle |
|---|---|---|
| ✅ Corregido | Ayudas "i" en el teléfono | Un toque las abría y el mismo toque las volvía a cerrar. Ahora un toque abre y un toque fuera cierra; con mouse se abren al pasar por encima. Probado en las 7 pestañas con pantalla táctil de 390 px. |
| ✅ Corregido | Caudal Winter-Kennedy en el CSV | Estaba oculto en pantalla pero salía en la descarga. Ya no sale. |
| ✅ Corregido | Errores de GitHub | Un token sin acceso o un nombre de repositorio mal escrito se mostraban como "sin archivos". Ahora se dice que el token no tiene acceso al repositorio. |
| ✅ Corregido | Números con punto decimal | Quedaban en el BEP, el rango de apertura, la tabla de escenarios de 2023 y el eje del F.C. de Operación medida. |
| ✅ Corregido | Contraste | Leyendas de las gráficas, etiquetas de los escenarios en la colina y resumen vacío del despacho. |
| ✅ Corregido | Despacho con poca potencia | Cuando hay que bajar unidades, se elige la cantidad que turbina menos agua. Ejemplo: con 60 MW y 4 unidades pedidas, antes quedaba en 3 unidades con η ≈ 43 %. |
| ✅ Corregido | Nivel del embalse | Mismo paso (0,01 m) en el Buscador y en la Colina. |
| ℹ️ Nota | Modelo en Operación medida | Busca la apertura hasta 31,98° y sin el tope de 307 MW, para no recortar la potencia medida. |

## Alineación con la app de Hidrometría (2-nov-2026)

| Estado | Punto | Detalle |
|---|---|---|
| ✅ Nuevo | Regla operativa (Res. 1891) | Caudal regulado = potencia / F.C.; la banda del día es el promedio de ayer ± 4,70 %; se cumple con el promedio final del día; con vertimiento la validación se suspende. Con los datos de LoggerNet, la app reproduce el tablero de Hidrometría (promedio de ayer, banda y promedio acumulado del día) con diferencias de 0,1 m³/s o menos. |
| ✅ Corregido | "Sin dato XM" | La tabla de Hidrometría muestra 0,0 MW en las horas sin dato de XM. Antes se leía como despacho de cero y además se perdía el Promedio RT de esa hora. Ahora queda como dato faltante y el RT se conserva. |
| ✅ Nuevo | Estado por hora y energía del día | Por debajo, dentro o por encima de la banda, o sin dato, como en la app de Hidrometría; también la energía de XM y la de RT en las horas comunes. |
| ✅ Nuevo | Programa para simular el nivel | Despacho de XM, Promedio RT o la operación plana que pide la regla (caudal regulado constante = promedio de ayer). Ituango opera plano por la Res. 1891: un despacho de XM con forma de precios (alto de noche, bajo a media mañana) no es lo que va a turbinar. |
| ⚠️ Atención | Columna de caudal de LoggerNet | `QTurbinadoUx_FC` siguió con 1,62 durante casi un día después del cambio de regla; desde el 30-oct-2026 a media mañana aplica la fórmula con el nivel del radar. La app calcula el caudal de Hidrometría con la regla, no con esa columna. |

## Reestructuración (3-nov-2026)

Segunda auditoría completa con un objetivo distinto: que la app sirva para decidir en caliente y para consultar el histórico, con la mayor parte de los datos automatizados.

| Estado | Punto | Detalle |
|---|---|---|
| ✅ Nuevo | Estructura en tres grupos | **Operación en vivo** (Tablero, Despacho, Buscador, Vertedero), **Analítica** (Regla 1891 y ANLA, Unidades, Hidrología y pronóstico, Operación medida) e **Ingeniería** (Colina, Curvas y F.C., Descarga, Referencia). Cada módulo abre con una guía: para qué sirve, qué logra y qué entrega. |
| ✅ Nuevo | Datos automáticos | El Tablero se arma solo con los CSV del relay y HydroForecast y se recarga cada 5 min. El Despacho llena el nivel de las 00:00, el Q regulado de ayer, el caudal de entrada y las horas ya cerradas (Promedio RT, unidades, nivel medido). El Buscador toma el nivel actual y el pronóstico de hoy. La condición de descarga toma el caudal del río del caudal descargado actual. Todo se puede cambiar a mano. |
| ✅ Nuevo | Histórico automático | Un proceso en el repositorio de datos (GitHub Actions, cada hora) calcula con el mismo código de la app (`src/analitica.js`) el resumen de cada día y de cada hora, y archiva HydroForecast (cada emisión del pronóstico). Así el día en curso y los días cerrados se calculan igual. |
| ✅ Nuevo | Regla del día en curso | Además del promedio hasta ahora, la app calcula qué debe promediar el resto del día para cerrar dentro de la banda (en m³/s y, con el F.C. actual, en MW) y el cierre si se sigue como la última hora. |
| ✅ Nuevo | Cada unidad por separado | La colina es la misma para las ocho unidades, pero el Winter-Kennedy de cada una muestra que no rinden igual. Se usa como **índice relativo** (no calibrado): F.C. WK por unidad, factor frente a la media, orden de mérito y rendimiento frente al modelo por tramo de carga (dividir por el modelo descuenta el efecto del nivel del embalse). `repartoPorUnidad` y `ordenDeMerito` en `src/modelo.js` admiten factores por unidad; con factor 1 dan la colina común. |
| ✅ Nuevo | Vertedero | Caudal y apertura por compuerta en vivo (relay v2) y calculadora de aperturas con las fórmulas del Simulador de crecientes. Si la apertura viene en metros, se compara el caudal medido con el de la Tabla 10.6. |
| ✅ Corregido | Despacho sin programa de XM | Sin el despacho de XM pegado, el programa XM eran ceros y se mostraba "por debajo" de la regla y un nivel que solo subía. Ahora XM no se simula ni se compara si no se pegó, y el programa por defecto es el plano. |
| ✅ Mejorado | Gráficos | Series de tiempo con uPlot: zoom arrastrando, doble clic para volver, cursor sincronizado entre gráficos del mismo módulo, tooltip con todos los valores, leyenda que prende y apaga series, franjas (banda de la regla, rango del pronóstico), tabla de datos y descarga CSV o PNG. Un solo eje Y por gráfico. Paleta categórica validada para daltonismo; los estados llevan siempre ícono y texto. |
| ⚠️ Atención | Winter-Kennedy sin calibrar | El η aparente con WK puede pasar de 100 %: se lee como comparación y tendencia. Con el WK calibrado, los mismos gráficos darán valores absolutos. |
| ⚠️ Atención | F.C. sobre 420 msnm | La regla de Hidrometría está cargada como válida entre 390 y 420 msnm; fuera de ese rango usa 1,80. Si el embalse pasa de 420, confirmar con Hidrometría qué aplican. |
