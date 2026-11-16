const formulario = document.getElementById('form-incidencia');
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
      console.warn('[Outbox] Sin conexión. Encolando transacción localmente...');
      // Falla de red: guardar en IndexedDB como pendiente para reenvío posterior
      return guardarRegistro({
        ...datosFormulario,
        estado: 'pendiente',
        fechaCreacion: Date.now()
      });
    })
    .then(() => {
      // Actualizar la lista visual en ambos escenarios
      return renderizarColaOutbox();
    });
}

function sincronizarPendientes() {
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

formulario.addEventListener('submit', (e) => {
  e.preventDefault();

  const datos = {
    titulo: inputTitulo.value.trim(),
    descripcion: inputDescripcion.value.trim()
  };

  procesarEnvioReporte(datos).then(() => {
    formulario.reset();
  });
});

btnPurgar.addEventListener('click', () => {
  purgarSincronizados();
});

// Escuchar el regreso de la conectividad
window.addEventListener('online', () => {
  actualizarIndicadorRed();
  sincronizarPendientes();
});

window.addEventListener('offline', actualizarIndicadorRed);

// Al cargar la página: READ de lo que haya quedado en IndexedDB
actualizarIndicadorRed();
renderizarColaOutbox().catch((error) => {
  console.error('[Outbox] No se pudo leer la bandeja al iniciar:', error);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js');
  });
}
