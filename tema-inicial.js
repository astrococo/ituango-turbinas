/* Fondo inicial según el tema guardado, antes de que cargue la app (evita el destello).
   Va en un archivo aparte para que la política de seguridad no necesite permitir scripts en línea. */
try { var t = localStorage.getItem("ituango-turbinas-tema"); document.documentElement.style.background = t === "light" ? "#eef2f7" : "#0b1220"; } catch (e) { document.documentElement.style.background = "#0b1220"; }
