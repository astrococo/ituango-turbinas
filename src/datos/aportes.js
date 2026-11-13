/* Caudales diarios de largo plazo (histórico de HydroForecast desde 2015 más lo
   observado reciente) para los aportes frente a la media histórica. */
import { useCallback, useMemo } from "react";
import { useDatos, useCargaPeriodica } from "./fuentes.jsx";
import { useVivo } from "./vivo.jsx";
import { caudalesDiarios, aportesMensuales, caudalMedioAnual } from "../indicadores.js";

function useAportes() {
  const d = useDatos();
  const { vivo } = useVivo() || {};
  const cargar = useCallback(async () => (d.conectado ? d.leerTexto("hf/historico_diario.csv").catch(() => null) : null), [d]);
  const csv = useCargaPeriodica(cargar, [cargar], 6 * 3600e3);
  const observado = vivo && vivo.hf && vivo.hf.observado ? vivo.hf.observado.datos : null;
  return useMemo(() => {
    if (!csv.datos && !observado) return { cargando: csv.cargando, datos: null };
    const diarios = caudalesDiarios(csv.datos, observado);
    const olaya = aportesMensuales(diarios.olaya);
    return {
      cargando: csv.cargando,
      datos: {
        olaya, sitioPresa: aportesMensuales(diarios.sitioPresa), qMedioAnual: caudalMedioAnual(diarios.olaya),
        desde: [...diarios.olaya.keys()].sort()[0] || null,
      },
    };
  }, [csv.datos, csv.cargando, observado]);
}

export { useAportes };
