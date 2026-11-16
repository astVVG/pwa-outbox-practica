if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.tipo === 'OUTBOX_SINCRONIZADO') {
      console.log('[UI] Confirmación recibida del Service Worker. Actualizando bandeja...');
      renderizarColaOutbox();
    }
  });
}

const formulario = document.getElementById('form-incidencia');
const btnEnviar = formulario.querySelector('button[type="submit"]');
let enviando = false;
const inputTitulo = document.getElementById('titulo');
const inputDescripcion = document.getElementById('descripcion');
const listaOutbox = document.getElementById('lista-outbox');
const btnPurgar = document.getElementById('btn-purgar');
const badgeRed = document.getElementById('badge-red');

function actualizarIndicadorRed() {
  if (navigator.onLine) {
    badgeRed.textContent = 'En Línea';
    badgeRed.className = 'badge online';
  } else {
    badgeRed.textContent = 'Sin Conexión';
    badgeRed.className = 'badge offline';
  }
}

// READ: dibuja la bandeja de salida con lo que hay en IndexedDB
function renderizarColaOutbox() {
  return obtenerTodosLosRegistros().then((registros) => {
    listaOutbox.innerHTML = '';

    registros.forEach((item) => {
      const li = document.createElement('li');
      li.className = item.estado;

      const titulo = document.createElement('span');
      titulo.className = 'titulo';
      titulo.textContent = item.titulo;

      const estado = document.createElement('span');
      estado.className = 'estado';
      estado.textContent = item.estado;

      const hora = document.createElement('span');
      hora.className = 'hora';
      hora.textContent = new Date(item.fechaCreacion).toLocaleTimeString('es-MX');

      li.appendChild(titulo);
      li.appendChild(estado);
      li.appendChild(hora);
      listaOutbox.appendChild(li);
    });
  });
}

function procesarEnvioReporte(datosFormulario) {
  const endpoint = 'https://jsonplaceholder.typicode.com/posts';

  return fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datosFormulario)
  })
    .then((respuesta) => {
      if (!respuesta.ok) throw new Error('Error HTTP del servidor');
      return respuesta.json();
    })
    .then(() => {
      // Envío exitoso en vivo: registrar en bitácora local como sincronizado
      return guardarRegistro({
        ...datosFormulario,
        estado: 'sincronizado',
        fechaCreacion: Date.now()
      });
    })
    .catch(() => {
      console.warn('[Outbox] Sin conexión. Encolando en IndexedDB...');

      return guardarRegistro({
        ...datosFormulario,
        estado: 'pendiente',
        fechaCreacion: Date.now()
      })
        .then(() => {
          // Detección de soporte para Background Sync API
          if ('serviceWorker' in navigator && 'SyncManager' in window) {
            return navigator.serviceWorker.ready
              .then((registro) => {
                console.log('[Outbox] Registrando etiqueta sync-reportes en el SW...');
                return registro.sync.register('sync-reportes');
              })
              .catch((error) => console.error('[Outbox] No se pudo registrar el sync:', error));
          }
        });
    })
    .then(() => {
      return renderizarColaOutbox();
    });
}

function sincronizarPendientesFallback() {
  console.log('[Outbox] Conexión detectada. Buscando registros pendientes...');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        console.log('[Outbox] No hay transacciones pendientes por sincronizar.');
        return;
      }

      // Convertir cada registro pendiente en una promesa de envío + actualización
      const promesasDeEnvio = pendientes.map((item) => {
        return fetch('https://jsonplaceholder.typicode.com/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.titulo, body: item.descripcion })
        })
          .then((res) => {
            if (!res.ok) throw new Error('Falla al reintentar envío');
            // Actualizar estado en IndexedDB de 'pendiente' a 'sincronizado'
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      // Esperar a que todos los reenvíos concluyan
      return Promise.all(promesasDeEnvio);
    })
    .then(() => {
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error('[Outbox] Error durante la sincronización masiva:', error);
    });
}

// DELETE: elimina los registros ya sincronizados
function purgarSincronizados() {
  return obtenerTodosLosRegistros()
    .then((registros) => {
      const sincronizados = registros.filter((item) => item.estado === 'sincronizado');
      return Promise.all(sincronizados.map((item) => eliminarRegistro(item.id)));
    })
    .then(() => {
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error('[Outbox] Error al purgar sincronizados:', error);
    });
}

// RE-ARMADO DE BACKGROUND SYNC: Chrome descarta la etiqueta 'sync-reportes' tras agotar sus
// reintentos (p. ej. con red inestable) y los registros quedan 'pendiente' para siempre.
// Si hay pendientes, se vuelve a registrar la etiqueta. Esta función NO envía nada:
// el único que hace el POST sigue siendo sw.js, así que no hay peticiones duplicadas.
function reprogramarSyncSiHayPendientes() {
  if (!('serviceWorker' in navigator) || !('SyncManager' in window)) {
    return Promise.resolve();
  }

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const hayPendientes = registros.some((item) => item.estado === 'pendiente');
      if (!hayPendientes) return;

      return navigator.serviceWorker.ready
        .then((registro) => {
          console.log('[Outbox] Hay pendientes: re-armando etiqueta sync-reportes...');
          return registro.sync.register('sync-reportes');
        });
    })
    .catch((error) => console.error('[Outbox] No se pudo re-armar el sync:', error));
}


formulario.addEventListener('submit', (e) => {
  e.preventDefault();
  if (enviando) return;               // ignora un segundo envío en curso
  enviando = true;
  btnEnviar.disabled = true;
  btnEnviar.textContent = 'Enviando...';

  const datos = {
    titulo: inputTitulo.value.trim(),
    descripcion: inputDescripcion.value.trim()
  };

  procesarEnvioReporte(datos)
    .then(() => formulario.reset())
    .catch((error) => console.error('[Outbox] Error al procesar el envío:', error))
    .then(() => {
      enviando = false;
      btnEnviar.disabled = false;
      btnEnviar.textContent = 'Enviar Reporte';
    });
});

btnPurgar.addEventListener('click', () => {
  purgarSincronizados();
});

// Escuchar el regreso de la conectividad
window.addEventListener('online', () => {
  actualizarIndicadorRed();

  // Degradación elegante: Solo sincronizar desde UI si el navegador NO soporta Background Sync (ej. Safari/iOS)
  if (!('SyncManager' in window)) {
    console.log('[Outbox] Navegador sin SyncManager. Ejecutando fallback por evento online...');
    sincronizarPendientesFallback();
  }
});

window.addEventListener('offline', actualizarIndicadorRed);

// Al cargar la página: READ de lo que haya quedado en IndexedDB
actualizarIndicadorRed();
renderizarColaOutbox().catch((error) => {
  console.error('[Outbox] No se pudo leer la bandeja al iniciar:', error);
});

// Re-armar el sync si quedaron pendientes atascados de una sesión anterior
reprogramarSyncSiHayPendientes();

// Re-armar al volver a la app o al recuperar conexión (listeners separados: no tocan el de arriba)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') reprogramarSyncSiHayPendientes();
});
window.addEventListener('online', reprogramarSyncSiHayPendientes);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js');
  });
}