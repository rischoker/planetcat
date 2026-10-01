/* =====================================================================
   GATO SWING · Configuración de red
   ---------------------------------------------------------------------
   El juego usa WebRTC (PeerJS) entre la pantalla (host) y los celulares.
   - La señalización va por WebSocket seguro (wss, puerto 443): pasa por
     casi todos los proxies.
   - Los datos van P2P. Si la red bloquea UDP (proxy de universidad,
     empresa, datos móviles con CGNAT), se usan servidores TURN por
     TCP/TLS en el puerto 443.
   Para máxima fiabilidad pon tus propias credenciales TURN abajo
   (Metered Open Relay da 20 GB/mes gratis; Cloudflare Calls también).
   ===================================================================== */
window.GATO_CONFIG = {
  // Prefijo de las salas en el servidor de señalización (no lo cambies
  // a menos que montes tu propio servidor).
  roomPrefix: 'gatoswing-v1-',

  // Servidor de señalización PeerJS. Vacío = servidor público gratuito
  // (0.peerjs.com, wss/443). Si tienes uno propio (p. ej. en Render):
  //   peer: { host: 'mi-peerserver.onrender.com', port: 443, path: '/', secure: true, key: 'peerjs' }
  peer: {},

  // STUN/TURN. Agrupados para que el navegador no tarde en recolectarlos.
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
    // TURN público "de mejor esfuerzo" (puede estar saturado o caído):
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443?transport=tcp',
        'turns:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    // Agrega aquí tu TURN propio, por ejemplo:
    // { urls: ['turn:TU_SERVIDOR:3478', 'turns:TU_SERVIDOR:443?transport=tcp'], username: 'usuario', credential: 'clave' },
  ],

  // Opcional: credenciales TURN temporales de Metered (https://www.metered.ca/tools/openrelay/).
  // Si llenas ambos campos, se piden al iniciar y se suman a iceServers.
  meteredTurn: { appName: '', apiKey: '' },

  // Segundos sin noticias de un celular antes de marcarlo desconectado.
  staleSeconds: 6,
};

// Permite sobrescribir la configuración sin editar este archivo (pruebas / despliegues propios)
if (window.GATO_CONFIG_OVERRIDE) {
  for (var k in window.GATO_CONFIG_OVERRIDE) window.GATO_CONFIG[k] = window.GATO_CONFIG_OVERRIDE[k];
}
