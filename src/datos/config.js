/* Proyecto de Supabase para el ingreso con correo y contraseña. Son valores
   públicos por diseño (la seguridad la ponen las sesiones y las reglas del
   servidor, no estas claves). Vacíos = la app funciona como antes, con el
   token de GitHub. Los llena el despliegue «Desplegar seguridad (Supabase)». */
export const SUPABASE_URL = "";
export const SUPABASE_CLAVE_PUBLICA = "";
/* Dominios de correo aceptados al registrarse (el servidor también lo exige). */
export const DOMINIOS_PERMITIDOS = ["epm.com.co"];
