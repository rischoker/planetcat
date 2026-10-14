/* =====================================================================
   GATO SWING · Configuración
   ---------------------------------------------------------------------
   Esta versión corre en Render: la pantalla y los celulares hablan con el
   MISMO servidor (Socket.IO por HTTPS en el puerto 443). No usa WebRTC,
   STUN ni TURN, así que atraviesa los proxies de la academia.
   ===================================================================== */
window.GATO_CONFIG = {
  // Segundos sin noticias de un celular antes de marcarlo desconectado.
  staleSeconds: 6,
};

// Permite sobrescribir la configuración sin editar este archivo (pruebas)
if (window.GATO_CONFIG_OVERRIDE) {
  for (var k in window.GATO_CONFIG_OVERRIDE) window.GATO_CONFIG[k] = window.GATO_CONFIG_OVERRIDE[k];
}
