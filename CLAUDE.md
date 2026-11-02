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
- Prueba de humo: `node tests/smoke.cjs` (o solo algunas secciones: `node tests/smoke.cjs tactil 2puntos`;
  secciones: basico, tablet, tactil, audio, export, rastreo, acceso, 2puntos, rotacion, demux) — carga, pestañas, 390 px, importar, rastreo (precisión), sincronía
  del reloj con el video, exportación rápida (cuadros exactos, ffprobe, pausa, cancelar, respaldo en tiempo real),
  objetivos táctiles de 44 px y diseño vertical, línea de tiempo táctil (gestos con mouse y dedos reales), audio (volumen por clip y música medidos en el archivo exportado), exportación en 720p/1080p/4K (tamaño real, misma composición, calidad, disco), rastreo rápido (tiempo, sin trabas, mismo resultado sin Worker), accesibilidad y primer uso (contraste, nombres, teclado, avisos, bienvenida), rastreo de 2 puntos (giro, escala, texto anclado, arrastre, guardado), rotación, demuxer contra ffprobe, archivo `.rastro` (también en un navegador sin datos) y limpieza de videos. Genera
  `tests/fixtures/test.webm` con ffmpeg si no existe. Correrla antes de cada push.
- Pruebas de navegador: Playwright + Chromium (en el entorno de la nube ya vienen instalados: `require('playwright')`, sin `playwright install`).
  Levantar un servidor HTTP mínimo, abrir la página y revisar `pageerror` / errores de consola.
- Para acceder al estado desde una prueba: `await import('/js/state.js')` y `await import('/js/project.js')` dentro de `page.evaluate` (mismas instancias de módulo).
- Medir audio exportado: `ffmpeg -af pan=mono|c0=FL` (un canal; `-ac 1` suma ×√2) y Goertzel por frecuencia.
- Gestos táctiles en pruebas: `Input.dispatchTouchEvent` por CDP (`ctx.newCDPSession(page)`) con `hasTouch: true`;
  Chrome agrupa los movimientos por cuadro, así que espera ~50 ms antes de leer el estado tras un `touchMove`.
- `waitForFunction` con función `async` devuelve una promesa (siempre "verdadera"): hacer polling con `evaluate` en un bucle.
- Video de prueba con objeto conocido (centro = x 110+240t, y 330+120·sin 2t en 1280×720):
  ```bash
  ffmpeg -f lavfi -i "testsrc2=s=1280x720:d=4:r=30" -f lavfi -i "testsrc=s=60x60:d=4:r=30" -f lavfi -i "sine=f=440:d=4" \
    -filter_complex "[0:v]hue=s=0.35,eq=brightness=-0.15[bg];[1:v]format=yuv420p[ob];[bg][ob]overlay=x='80+t*240':y='300+120*sin(t*2)':eval=frame,format=yuv420p[v]" \
    -map "[v]" -map 2:a -c:v libvpx -b:v 3M -c:a libopus test.webm
  ```
  Usar WebM/VP8 para importar: el `<video>` del Chromium de Playwright no reproduce H.264 (aunque `VideoDecoder`
  y `VideoEncoder` sí lo soportan; AAC no se puede codificar ahí, por eso el audio sale en Opus).

## Arquitectura (`js/`)

| Módulo | Rol |
|---|---|
| `state.js` | Estado global `S`, lienzo `cv`/`ctx`, capas `L1`/`L2`, `nid()`, `setAspect()` |
| `util.js` | `clamp`, `ease`, `fmtT`, `toast`, `getSel`, `getOv`… |
| `demo.js` | Clips de ejemplo dibujados por código (`DEMOS`) |
| `clips.js` | Importar videos, `seekTo`, audio (WebAudio), `cloneClip` |
| `music.js` | Música de fondo (`S.music`): `<audio>` + WebAudio en la vista previa (`syncMusic`), `mixMusic` para exportar, `musicGainAt`/`musicTime` |
| `timeline.js` | `layout()` calcula `_start/_len/_d` (los clips se solapan en transiciones) |
| `transitions.js` | `TR` (transiciones) y `applyFilter` |
| `render.js` | `renderFrame(T)`: compone clips, transición, overlays y guías; `trackAt`, `trackXform`, `ovPos`/`ovSetAbs` |
| `playback.js` | Bucle `requestAnimationFrame`; al reproducir, el reloj del proyecto sigue al `<video>` activo (`videoClock`) |
| `tracker.js` | Coordina el rastreo: cuadros de análisis con `FrameSource` (hacia atrás, por tramos de 2 s decodificados en orden), pasadas adelante/atrás, suavizado y resultado |
| `trackcore.js` | Cálculo del rastreo sin DOM (`TrackCore`): ZNCC, desenfoque, plantilla adaptativa, subpíxel; con 2 puntos, plantilla original deformada con el giro/escala previstos |
| `track-worker.js` | Web Worker que corre `TrackCore` (si no hay Workers de módulo, `tracker.js` lo usa en el hilo principal) |
| `export.js` | Elige cómo exportar: rápida (`fastexport.js`) o, si no hay WebCodecs o falla, `MediaRecorder` en tiempo real (`S.fastBroken`) |
| `fastexport.js` | Exportación con WebCodecs: cuadro por cuadro (`renderFrame` + `VideoEncoder`) a 720p/1080p/4K (`exportSize`, `QUALITIES`), audio mezclado con `OfflineAudioContext` + `AudioEncoder`; escribe en disco (OPFS) |
| `frames.js` | `FrameSource`: cuadro exacto de un video con `VideoDecoder` (decodifica en orden); `drawRotated()` |
| `demux.js` | Índice de muestras de la pista de video de MP4/MOV y WebM/MKV (tiempos con cuadros B, rotación, listas de edición) |
| `mp4.js` | `Mp4Muxer`: escribe el .mp4 a medida que llegan las muestras (H.264/VP9/AV1 + AAC/Opus, audio intercalado, `moov` al final) en un `OpfsSink` (disco) o `MemorySink` |
| `panel.js` | HTML del panel de herramientas por pestaña (`S.tab`) |
| `timeline-ui.js` | Dibujo de la línea de tiempo (clips con `data-id`; bordes de recorte `.th` en el seleccionado) |
| `timeline-touch.js` | Gestos de la línea de tiempo: desplazar con inercia, regla, mantener y arrastrar para reordenar, bordes para recortar, dos dedos / Ctrl+rueda para zoom (`zoomAt`) |
| `actions.js` | `act(nombre:arg)` despachado por `data-act`; eventos de puntero y teclado |
| `store.js` | IndexedDB: `projects`, `media` (blobs de video), `meta` |
| `project.js` | Serializar, autoguardar, abrir/crear/eliminar, deshacer/rehacer (`P`), `collectMedia()`, archivo `.rastro` |
| `archive.js` | Zip mínimo sin dependencias (`zip`/`unzip`): escribe sin comprimir, lee por rebanadas, sin ZIP64 (máx. 4 GB) |

## Convenciones

- **Toda mutación del proyecto termina en `commit()`** (`project.js`): registra el paso de deshacer y programa el autoguardado.
  `act()` ya llama `commit()` al final; los flujos asíncronos (importar, rastrear, vincular) lo llaman al terminar.
  `commit()` compara instantáneas, así que llamarlo sin cambios no hace nada.
- Datos de un clip que se guardan: `CLIP_KEYS` en `project.js`. Si agregas un campo persistente, súmalo ahí.
  Lo que empieza con `_` (`_start`, `_lastT`…) y `el`, `scv`, `gain` es estado de ejecución.
- Videos guardados (`media`): se borran con `collectMedia()` cuando ningún proyecto ni el historial de deshacer
  los usa; corre al descartar el historial (abrir/crear proyecto, arranque) y al eliminar un proyecto.
- Archivo `.rastro`: zip con `project.json` (`{format:'rastro', v, name, data, media:[{id,name,type,file}]}`) y
  `media/<mediaId>.<ext>`. Si cambia la forma de `data`, sube `RASTRO_V` en `project.js` y mantén la lectura de versiones viejas.
  Al abrirlo siempre se crea un proyecto nuevo.
- Exportación rápida: mientras corre, `S.expFast` hace que el bucle de `playback.js` no mueva los videos ni dibuje;
  `S.expFrames` (clip → cuadro decodificado) tiene prioridad sobre `c.el` en `drawClipLayer`. Un clip cuyo archivo no se
  puede demuxar/decodificar cae a seek en su `<video>` (exacto pero lento: cada seek decodifica desde el keyframe).
  Si cambias cómo se mezcla el audio en `syncMedia()`, cambia también `mixAudio()` (y la música: `syncMusic()` / `mixMusic()`).
- Resolución de salida: durante la exportación rápida `S.W/S.H` (y el lienzo) pasan al tamaño de salida y se restauran
  al terminar, así que todo lo que se dibuje debe depender de `S.W/S.H` (nunca píxeles fijos). El nivel del códec
  depende del tamaño (4K necesita H.264 5.1). La resolución y calidad elegidas (`S.expOpt`) son preferencia del navegador
  (`localStorage`), no del proyecto. Los videos exportados quedan en OPFS (`rastro-export-*.mp4`); se borran al abrir la
  app y al terminar una exportación nueva (`cleanExports`).
- Audio: cada clip tiene `vol` (0–2, sin valor = 1; también en `CLIP_KEYS`). `S.music = { mediaId, name, dur, vol, in, fadeIn,
  fadeOut, loop }` va en `content()` y en el `.rastro` (v2); su archivo vive en `media` como los videos (`collectMedia` y
  `loadMediaFor` lo consideran). En `hydrate()` se borran del clip los campos de `CLIP_KEYS` que no vienen en los datos,
  para que deshacer revierta valores que vuelven a "por defecto".
- Coordenadas: el rastreo guarda `x,y` normalizados (0–1) **en el espacio del video fuente**; `mapSrc()` los lleva al lienzo.
  Overlays con `follow:true` guardan `x,y` como **desplazamiento** respecto al punto rastreado (normalizado al lienzo).
- Rastreo de 2 puntos: `track.seed2 = {x,y}` (mismo `t` que `seed`) y cada muestra lleva además `x2,y2`. `trackXform(c, local)`
  da ancla (punto 1), giro y escala respecto del cuadro de la semilla. Con 2 puntos, el desplazamiento del overlay está en
  ese cuadro de referencia y también gira/escala (`followRot`/`followScale`, por defecto activos). Para mover un overlay
  usa `ovSetAbs()` (inverso de `ovPos()`), nunca sumes deltas a `o.x/o.y` a mano; `setFollow()` cambia opciones sin saltos.
- Línea de tiempo: `.tl-inner` tiene `touch-action: none` y todos los gestos los maneja `timeline-touch.js`. Los toques
  (sin arrastre) se resuelven al soltar llamando `act()` con el `data-act` del elemento tocado; los clicks que genera el
  puntero dentro de la línea de tiempo se descartan (con `setPointerCapture` pueden llegar al contenedor), los de teclado no.
  Reordenar y recortar se aplican al soltar, con un solo `commit()`.
- Selectores de archivo (`#fileIn`, `#relinkIn`, `#rastroIn`, `#musicIn`): están fijos en `#pickers` (index.html), fuera
  del panel, y el panel los abre con `<label for>`. No pongas `<input type="file">` dentro del panel: se redibuja (al
  autoguardar, al terminar un rastreo…) y el archivo elegido se perdería si el diálogo estaba abierto.
- Rastreo: solo uno a la vez (`S.tracking`). El automático del ejemplo es silencioso (`S.trackSilent`) y cede el paso si
  la persona pide otro; quitar el clip que se rastrea pone `S.trackCancel`. El resultado debe ser idéntico con o sin Worker.
- Accesibilidad: todo lo tocable que no sea `<button>`/`<input>` (clips, barras, listas) lleva `tabindex="0"`,
  `role="button"` y `aria-label`; Enter/Espacio lo activa (actions.js) y el foco vuelve al mismo elemento tras redibujar.
  Los deslizadores llevan `aria-label`. Los avisos se anuncian por `#srLive` (role="status"); el panel no es `aria-live`.
  La sección `acceso` de la prueba revisa contraste AA, nombres y teclado en las 7 pestañas.
- Avisos: `toast(texto, { label: 'Deshacer', act: 'undo' })` agrega un botón; úsalo al eliminar algo.
- Atajos: Espacio, ←/→ (un cuadro; Shift: 1 s), Inicio/Fin, S dividir, Supr eliminar clip, Ctrl+Z/Y, Ctrl+S.
- Primer uso: la bienvenida (`welcomeCard` en panel.js) se ve mientras el proyecto tiene clips de ejemplo, hasta que se
  cierra (`localStorage` `rastro.welcome`). Un proyecto sin clips muestra en la vista previa qué hacer.
- UI con `data-act="accion:arg"`, `data-tab`, `data-k` (inputs). No usar `alert/confirm/prompt`: confirmaciones dentro de la página.
- Textos de la interfaz en español, directos, desde el lado del usuario. Toast tras acciones ("Clip dividido", "Proyecto eliminado").
- Colores siempre desde los tokens de `:root` en `css/styles.css`. Debe funcionar a 390 px de ancho sin scroll horizontal.
- Pantallas táctiles: dentro de `@media (pointer: coarse)` todo lo tocable mide al menos 44 px (al final de `styles.css`);
  en PC con mouse el diseño sigue compacto. Si agregas un control, súmalo ahí (la sección `tablet` de la prueba lo revisa).
  Algo que deba verse chico (insignias de transición) usa un `::before` invisible de 44×44 como área táctil.
- Vertical (< 900 px de ancho y ≥ 600 px de alto): la página no se desplaza; vista previa y línea de tiempo quedan fijas
  y solo `#panel` tiene scroll. Más bajo que eso (celular acostado) vuelve al scroll normal.
- Sin dependencias ni paso de build salvo que se acuerde.

## Pendiente (en orden propuesto)

1. Tracking planar de 4 esquinas (homografía) para reemplazar pantallas/letreros en perspectiva.
