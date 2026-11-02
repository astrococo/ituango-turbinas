# Auditoría · Turbinas Ituango

Fecha: 2-nov-2026. Revisión de cada pestaña, campo y resultado. Un revisor independiente usó la app en PC y en teléfono, y cada hallazgo se verificó con números.

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
| ✅ Nuevo | Factor de conversión de Hidrometría | 1,62 hasta el 29-oct-2026 14:30; desde entonces 0,0119·nivel − 3,178, según la fecha de cada dato. Con 2-3 unidades y el río bajo coincide con el modelo dentro de ±2 % entre 400 y 420 msnm. Con 4 unidades y el río alto da un F.C. 2-4 % mayor. |
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
