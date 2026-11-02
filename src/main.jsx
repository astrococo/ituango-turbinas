import React from "react";
import ReactDOM from "react-dom/client";
import ItuangoSimulador from "./ItuangoSimulador.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ItuangoSimulador />
  </React.StrictMode>
);

// Instalable y con copia sin conexión (red primero). Solo en producción.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("./sw.js").catch(() => {}); });
}
