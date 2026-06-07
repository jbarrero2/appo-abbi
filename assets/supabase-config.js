/* ===================================================================
   Ap-Ab — configuración PÚBLICA del cliente (cotizador.html)
   -------------------------------------------------------------------
   Estos dos valores son PÚBLICOS por diseño (la "anon key" de Supabase
   está pensada para vivir en el navegador y está protegida por RLS).
   NO pongas aquí la service_role ni la API key de Anthropic: esas van
   SOLO en las variables de entorno de Netlify (ver README).

   Cómo obtenerlos: panel de Supabase → Project Settings → API.
   Reemplaza los dos valores de abajo y listo.
   =================================================================== */
window.ABAB_PUBLIC = {
  SUPABASE_URL: "https://tcqnangrmpeboykjtmjo.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjcW5hbmdybXBlYm95a2p0bWpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NjU1NDMsImV4cCI6MjA5NjQ0MTU0M30.EGACr_5Q3wrotCSKFC2Jbv7HgjqbxxAwohbBaLrMnBI",

  // Debe coincidir con la variable AI_MODE_ENABLED del backend.
  // true  -> muestra el Asistente IA (texto libre) en el cotizador.
  // false -> solo modo gratis con selectores.
  AI_MODE_ENABLED: true,

  // Botón "Comprar 10 cotizaciones rápidas · US$5".
  // Pega aquí tu enlace de pago (p.ej. un Stripe Payment Link de US$5).
  // El sitio le añade ?client_reference_id=<id de usuario> para que el
  // webhook acredite las 10 al usuario correcto (ver HANDOFF.md).
  // Si lo dejas vacío, el botón abre WhatsApp para coordinar el pago.
  PAYMENT_LINK: ""
};
