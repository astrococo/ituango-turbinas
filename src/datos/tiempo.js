/* Fecha y hora de Colombia (UTC−5, sin horario de verano). Puro: sirve en
   el navegador y en Node (proceso automático). */
const ahoraColombia = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
const hoyColombia = () => ahoraColombia().slice(0, 10);
const sumarDias = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

export { ahoraColombia, hoyColombia, sumarDias };
