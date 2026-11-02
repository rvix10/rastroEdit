# Rastro Editor — guía para Claude

Editor de video web (estilo Adobe Rush + transiciones tipo LightCut + rastreo de movimiento).
Todo corre en el navegador del usuario: sin backend, sin build, sin dependencias.

## Correr y probar

```bash
python3 -m http.server 8080   # abrir http://localhost:8080
```

- Módulos ES nativos: no abrir `index.html` con `file://`.
- Verificar sintaxis: `for f in js/*.js; do node --check --input-type=module < $f; done`
- Formato: `prettier --write js/*.js css/styles.css` (config en `.prettierrc`; una sentencia por línea).
- Prueba de humo: `node tests/smoke.cjs` — carga, pestañas, 390 px, importar, rastreo (precisión), sincronía
  del reloj con el video, exportación con pausa en segundo plano y limpieza de videos. Genera
  `tests/fixtures/test.webm` con ffmpeg si no existe. Correrla antes de cada push.
- Pruebas de navegador: Playwright + Chromium (en el entorno de la nube ya vienen instalados: `require('playwright')`, sin `playwright install`).
  Levantar un servidor HTTP mínimo, abrir la página y revisar `pageerror` / errores de consola.
- Para acceder al estado desde una prueba: `await import('/js/state.js')` y `await import('/js/project.js')` dentro de `page.evaluate` (mismas instancias de módulo).
- `waitForFunction` con función `async` devuelve una promesa (siempre "verdadera"): hacer polling con `evaluate` en un bucle.
- Video de prueba con objeto conocido (centro = x 110+240t, y 330+120·sin 2t en 1280×720):
  ```bash
  ffmpeg -f lavfi -i "testsrc2=s=1280x720:d=4:r=30" -f lavfi -i "testsrc=s=60x60:d=4:r=30" -f lavfi -i "sine=f=440:d=4" \
    -filter_complex "[0:v]hue=s=0.35,eq=brightness=-0.15[bg];[1:v]format=yuv420p[ob];[bg][ob]overlay=x='80+t*240':y='300+120*sin(t*2)':eval=frame,format=yuv420p[v]" \
    -map "[v]" -map 2:a -c:v libvpx -b:v 3M -c:a libopus test.webm
  ```
  Usar WebM/VP8: el Chromium de Playwright no decodifica H.264.

## Arquitectura (`js/`)

| Módulo | Rol |
|---|---|
| `state.js` | Estado global `S`, lienzo `cv`/`ctx`, capas `L1`/`L2`, `nid()`, `setAspect()` |
| `util.js` | `clamp`, `ease`, `fmtT`, `toast`, `getSel`, `getOv`… |
| `demo.js` | Clips de ejemplo dibujados por código (`DEMOS`) |
| `clips.js` | Importar videos, `seekTo`, audio (WebAudio), `cloneClip` |
| `timeline.js` | `layout()` calcula `_start/_len/_d` (los clips se solapan en transiciones) |
| `transitions.js` | `TR` (transiciones) y `applyFilter` |
| `render.js` | `renderFrame(T)`: compone clips, transición, overlays y guías |
| `playback.js` | Bucle `requestAnimationFrame`; al reproducir, el reloj del proyecto sigue al `<video>` activo (`videoClock`) |
| `tracker.js` | Rastreo 2D por punto (ZNCC, desenfoque, plantilla adaptativa, subpíxel) |
| `export.js` | `MediaRecorder` sobre `cv.captureStream()` + audio; se pausa si la pestaña pasa a segundo plano |
| `panel.js` | HTML del panel de herramientas por pestaña (`S.tab`) |
| `timeline-ui.js` | Dibujo de la línea de tiempo |
| `actions.js` | `act(nombre:arg)` despachado por `data-act`; eventos de puntero y teclado |
| `store.js` | IndexedDB: `projects`, `media` (blobs de video), `meta` |
| `project.js` | Serializar, autoguardar, abrir/crear/eliminar, deshacer/rehacer (`P`), `collectMedia()` |

## Convenciones

- **Toda mutación del proyecto termina en `commit()`** (`project.js`): registra el paso de deshacer y programa el autoguardado.
  `act()` ya llama `commit()` al final; los flujos asíncronos (importar, rastrear, vincular) lo llaman al terminar.
  `commit()` compara instantáneas, así que llamarlo sin cambios no hace nada.
- Datos de un clip que se guardan: `CLIP_KEYS` en `project.js`. Si agregas un campo persistente, súmalo ahí.
  Lo que empieza con `_` (`_start`, `_lastT`…) y `el`, `scv`, `gain` es estado de ejecución.
- Videos guardados (`media`): se borran con `collectMedia()` cuando ningún proyecto ni el historial de deshacer
  los usa; corre al descartar el historial (abrir/crear proyecto, arranque) y al eliminar un proyecto.
- Coordenadas: el rastreo guarda `x,y` normalizados (0–1) **en el espacio del video fuente**; `mapSrc()` los lleva al lienzo.
  Overlays con `follow:true` guardan `x,y` como **desplazamiento** respecto al punto rastreado (normalizado al lienzo).
- UI con `data-act="accion:arg"`, `data-tab`, `data-k` (inputs). No usar `alert/confirm/prompt`: confirmaciones dentro de la página.
- Textos de la interfaz en español, directos, desde el lado del usuario. Toast tras acciones ("Clip dividido", "Proyecto eliminado").
- Colores siempre desde los tokens de `:root` en `css/styles.css`. Debe funcionar a 390 px de ancho sin scroll horizontal.
- Sin dependencias ni paso de build salvo que se acuerde.

## Pendiente (en orden propuesto)

1. Exportar / importar proyecto como archivo `.rastro` (JSON + videos en un zip) para moverlo entre equipos.
2. Tracking de 2 puntos: posición + rotación + escala; overlays que hereden rotación/escala.
3. Tracking planar de 4 esquinas (homografía) para reemplazar pantallas/letreros en perspectiva.
4. Pista de música y volumen por clip.
5. Exportación más rápida que tiempo real con WebCodecs (hoy `MediaRecorder` va a 1×).
6. Arrastrar clips para reordenar y recortar desde los bordes en la línea de tiempo.
