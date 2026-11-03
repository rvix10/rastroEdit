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
  secciones: basico, tablet, tactil, audio, export, rastreo, acceso, pwa, 2puntos, 4esquinas, vista, rotacion, demux) — carga, pestañas, 390 px, importar, rastreo (precisión), sincronía
  del reloj con el video, exportación rápida (cuadros exactos, ffprobe, pausa, cancelar, respaldo en tiempo real),
  objetivos táctiles de 44 px y diseño vertical, línea de tiempo táctil (gestos con mouse y dedos reales), audio (volumen por clip y música medidos en el archivo exportado), exportación en 720p/1080p/4K (tamaño real, misma composición, calidad, disco), rastreo rápido (tiempo, sin trabas, mismo resultado sin Worker), accesibilidad y primer uso (contraste, nombres, teclado, avisos, bienvenida), app instalable (manifiesto, sin conexión, diagnóstico), rastreo de 2 puntos (giro, escala, texto anclado, arrastre, guardado), rastreo de 4 esquinas (plano en perspectiva contra la verdad, área, sin Worker, guardado, temblor, cubrir tramo sin rastrear), vista previa (cabe en cada pantalla y proporción, barra de tamaño con dedo, mouse y teclado), rotación, demuxer contra ffprobe, archivo `.rastro` (también en un navegador sin datos) y limpieza de videos. Genera
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
| `viewer.js` | Tamaño de la vista previa: `fitStage()` ajusta el lienzo al lugar con la proporción del proyecto; barra `#pvGrip` para cambiarlo (por diseño: `wide`/`tablet`/`phone`/`land`, en `localStorage` `rastro.pv`) |
| `playback.js` | Bucle `requestAnimationFrame`; al reproducir, el reloj del proyecto sigue al `<video>` activo (`videoClock`) |
| `tracker.js` | Coordina el rastreo: cuadros de análisis con `FrameSource` (hacia atrás, por tramos de 2 s decodificados en orden), pasadas adelante/atrás, suavizado y resultado |
| `trackcore.js` | Cálculo del rastreo sin DOM (`TrackCore`): ZNCC, desenfoque, plantilla adaptativa, subpíxel; con 2 puntos, plantilla original deformada con el giro/escala previstos; con 4 esquinas delega en `PlanarCore` |
| `planar.js` | Rastreo planar (4 esquinas) sin DOM: homografías (`hFit` DLT normalizado, `ransacH` con semilla fija); por cuadro: estimación gruesa ×4, paso fino cuadro a cuadro, verificación (amplia + fina) contra cuadros clave, prueba de unicidad, recuperación tras perderse; utilidades de cuadriláteros (`quadCenter`, `orderQuad`…) |
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
| `pwa.js` | App instalable: registra `sw.js`, guarda el aviso de instalación (`S.pwa`), `promptInstall()`, `isStandalone()` |
| `theme.js` | Apariencia: automática (sistema), clara u oscura (`setTheme`, `toggleTheme`); `data-theme` en `<html>`, preferencia en `localStorage` |
| `diag.js` | Diagnóstico (Proyectos → Este dispositivo): hardware, códecs por hardware/software, medición en «× tiempo real», informe |

Fuera de `js/`: `sw.js` (service worker: la app funciona sin conexión), `manifest.webmanifest`, `icons/`,
`css/fonts.css` + `fonts/` (fuentes incluidas: la app no se conecta a servicios externos), `privacy.html`
(política de privacidad), `android/` (app de Google Play: Trusted Web Activity; guía en `android/README.md`,
compila `.github/workflows/android.yml`) y `store/` (ficha de Play y material gráfico: `node store/generar.cjs`).

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
- Rastreo de 4 esquinas: `track.quad = [{x,y}×4]` (normalizadas, orden: arriba izq., arriba der., abajo der., abajo izq.;
  `orderQuad` ordena los toques) y `track.seed` = cruce de las diagonales (`quadCenter`). Cada muestra lleva `q` (8 números) y
  `x,y` = su centro. `quadAt(c, local)` da las esquinas en el lienzo. `trackXform` saca giro/escala del segmento entre los
  centros de los lados izquierdo y derecho, así los overlays que siguen funcionan igual que con 2 puntos. El overlay
  `kind: 'area'` (con `fill` 0–0,8) dibuja el plano relleno y su etiqueta en el centro; sin rastreo de 4 esquinas no se dibuja,
  y `clearTrack` lo quita. RANSAC usa `mulberry32` con semilla por cuadro: con y sin Worker el resultado es idéntico.
  Lo que no se pudo rastrear queda como hueco (`track.gaps`, en tiempo local; el panel lo muestra) y entre muestras se
  interpola. «Cubrir tramo sin rastrear» marca las esquinas en un hueco y las guarda como cuadro clave extra
  (`track.keys = [{seed, quad}]`): `runTrack(c, silent, { fill: key })` rastrea solo ese hueco y lo une; un `runTrack` normal
  rastrea todo y después cada cuadro clave en su hueco. El suavizado final de 4 esquinas solo quita ruido de ~1 px.
  Para medir cambios del rastreo planar: la sección `4esquinas` (perspectiva, temblor fuerte dibujado con verdad exacta,
  salto que deja un tramo sin rastrear); el filtro `perspective` de ffmpeg sirve para movimientos lineales o saltos
  (con `sin()` no coincide con la verdad calculada).
- Ajustar puntos marcados: en la pestaña Rastreo, los puntos que devuelve `editableMarks(c, local)` (render.js) se arrastran
  en la vista previa (`S.markDrag`, actions.js) con lupa ×3; mientras se marca, solo los toques pendientes. Al soltar se valida
  (esquinas sin cruces, puntos no muy juntos; si no, vuelven a donde estaban) y se hace `commit()`. Si ya había rastreo, queda
  `track.stale` (el panel pide volver a rastrear) y `runTrack` lo borra.
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
- Sin conexión (`sw.js`): precarga la lista `APP` y responde primero desde la red (si no hay o tarda más de 3 s, desde la
  copia). **Si agregas un archivo a `js/`, `css/` o `icons/`, súmalo a `APP`** (la sección `pwa` de la prueba lo revisa).
  Sube `CACHE` solo si cambia la forma de guardar; con red primero, una versión nueva nunca queda vieja.
- UI con `data-act="accion:arg"`, `data-tab`, `data-k` (inputs). No usar `alert/confirm/prompt`: confirmaciones dentro de la página.
- Textos de la interfaz en español, directos, desde el lado del usuario. Toast tras acciones ("Clip dividido", "Proyecto eliminado").
- Estilo visual: bordes gruesos (`2px solid var(--edge)`), sombras planas desplazadas (`--sh`, `--sh-lg`), botones en píldora
  y colores vivos (azul `--accent`, limón `--hi`, menta `--trk`, coral `--ov`). Fuente de la interfaz: Space Grotesk; Manrope,
  Unbounded y Caveat son solo para los textos del video.
- Temas: claro por defecto; el oscuro redefine los tokens en `@media (prefers-color-scheme: dark)` (si no hay `data-theme="light"`)
  y en `:root[data-theme="dark"]`. Si agregas un token, defínelo en los tres bloques. Texto sobre limón/menta/coral usa `--ink`
  (oscuro en ambos temas). Lo dibujado en el lienzo (vista previa) no depende del tema. La sección `acceso` revisa el contraste en los dos.
- Colores siempre desde los tokens de `:root` en `css/styles.css`. Debe funcionar a 360 px de ancho sin scroll horizontal
  ni texto cortado dentro de los botones (la sección `tablet` de la prueba revisa 360 px).
- Pantallas táctiles: dentro de `@media (pointer: coarse)` todo lo tocable mide al menos 44 px (al final de `styles.css`);
  en PC con mouse el diseño sigue compacto. Si agregas un control, súmalo ahí (la sección `tablet` de la prueba lo revisa).
  Algo que deba verse chico (insignias de transición) usa un `::before` invisible de 44×44 como área táctil.
- Vertical (< 900 px de ancho y ≥ 600 px de alto), dos diseños:
  - Tablet (≥ 960 px de alto): la página no se desplaza; vista previa y línea de tiempo quedan fijas y solo `#panel` tiene scroll.
  - Celular (< 960 px de alto): se desplaza la página entera (un solo scroll). `.stage` es `sticky` arriba y `.tabs` es una
    barra fija abajo (`--tabbar`); al cambiar de pestaña, `showPanel()` (panel.js) baja hasta el panel. Lo vertical que la
    línea de tiempo no puede desplazar pasa a la página (timeline-touch.js).
  Más bajo que 600 px (celular acostado) vuelve al scroll normal. La sección `tablet` de la prueba revisa los tres casos.
- Vista previa: el tamaño del lienzo en pantalla lo pone `fitStage()` (viewer.js), nunca CSS con `max-height` (en la grilla no
  se resuelve y el lienzo se salía con 9:16). En `wide` el visor llena su celda (`.viewer.fill`, `contain: size`) y la barra
  cambia `--tl-h` (alto de la línea de tiempo); en los demás, la barra cambia el alto máximo como fracción de `100svh`
  (estable aunque el navegador oculte sus barras). Doble toque o Enter: tamaño por defecto (más alto si el proyecto es 9:16).
- Sin servicios externos: nada de CDNs ni fuentes remotas (la sección `pwa` de la prueba lo revisa). Es lo que permite
  declarar en Play que la app no recopila ni comparte datos.
- Android: la app de Play abre la web publicada (no copia sus archivos), así que publicar en `main` la actualiza.
  Solo hace falta subir un AAB nuevo si cambia algo en `android/`. No se puede compilar aquí (sin SDK de Android):
  lo hace GitHub Actions; los registros se leen con las herramientas de GitHub.
- Sin dependencias ni paso de build salvo que se acuerde.

## Pendiente (en orden propuesto)

1. Poner una imagen o video dentro del plano rastreado (pantallas, letreros) con la homografía (malla de triángulos en el lienzo).
2. Medir la superficie del área a partir de un lado de largo conocido (vista cenital) o de las medidas del lote.
