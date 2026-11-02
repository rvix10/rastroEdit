# Rastro Editor

Editor de video que corre en el navegador (celular y PC), sin servidor ni instalación.
Interfaz inspirada en Adobe Rush, transiciones tipo LightCut y rastreo de movimiento por punto (o por dos puntos, con giro y escala).
Los videos se procesan en el dispositivo; nada se sube a ningún servidor.

## Funciones

| Área | Qué hace |
|---|---|
| **Medios** | Importa varios videos (MP4, WebM, MOV según el navegador). Formato del proyecto 16:9, 9:16 o 1:1. |
| **Editar** | Recorte de inicio y fin, dividir en el cursor, duplicar, reordenar, silenciar, volumen por clip (0–200 %), filtros (Cálido, Frío, B/N, Vívido, Cine). |
| **Música** | Música de fondo para todo el proyecto: volumen, desde qué segundo de la canción empieza, fundido de entrada y salida, y repetición si es más corta que el video. Se escucha igual en la vista previa y en el video exportado. |
| **Tablet y celular** | En pantallas táctiles los controles miden al menos 44 px. En vertical, la vista previa y la línea de tiempo quedan fijas y solo se desplaza el panel. |
| **Línea de tiempo táctil** | Deslizar para desplazar, dos dedos para zoom, mantener presionado un clip y arrastrarlo para reordenar, bordes del clip seleccionado para recortar (con mouse: arrastrar directo y Ctrl + rueda). |
| **Transiciones** | Corte, Fundido, Destello, Deslizar, Empujar, Zoom, Giro, Barrido, Círculo, Desenfoque y Glitch, con duración ajustable. Los clips se superponen durante la transición y el audio hace crossfade. |
| **Rastreo** | Marcas un punto y el editor lo sigue cuadro a cuadro, hacia adelante y hacia atrás. Con **2 puntos** sobre el mismo objeto mide también su giro y su escala: los textos y stickers que lo siguen giran y cambian de tamaño con él (se puede apagar cada cosa por elemento). |
| **Texto y stickers** | Texto (3 tipografías, contorno o caja), aro de enfoque y stickers. Cualquier elemento puede seguir el objeto rastreado y se arrastra sobre la vista previa. |
| **Proyectos** | Autoguardado en el navegador (IndexedDB), con los videos incluidos. Lista de proyectos, nuevo, duplicar, renombrar y eliminar. Si falta un video, se marca y se puede volver a vincular. |
| **Pasar a otro equipo** | *Guardar .rastro* crea un archivo con el proyecto y sus videos; *Abrir .rastro* lo agrega como proyecto nuevo en otro navegador o dispositivo. |
| **Deshacer / rehacer** | Hasta 60 pasos. Botones en la barra superior, o `Ctrl+Z` / `Ctrl+Shift+Z` (`Ctrl+Y`). `Ctrl+S` fuerza el guardado. |
| **Exportar** | MP4 en **720p, 1080p o 4K** y calidad Ligera, Normal o Alta (muestra el peso máximo), armado cuadro por cuadro con WebCodecs (H.264 o VP9, audio AAC u Opus): no depende de reproducir en tiempo real, cada cuadro es exacto y el texto se dibuja a la resolución de salida. El video se escribe en el disco a medida que se codifica. En navegadores sin WebCodecs, graba el lienzo con `MediaRecorder` en tiempo real. Si cambias de pestaña, se pausa y sigue al volver. |

## Cómo correrlo

Usa módulos ES, así que necesita un servidor HTTP (abrir `index.html` con doble clic no funciona):

```bash
python3 -m http.server 8080
# o
npx serve .
```

Abre `http://localhost:8080`.

### Probar en el celular

Publícalo con GitHub Pages: **Settings → Pages → Deploy from a branch → `main` / root**.
Queda en `https://<usuario>.github.io/rastroEdit/`.

## Estructura

```
index.html
css/styles.css
js/
  main.js         arranque y proyecto de ejemplo
  state.js        estado global (S), lienzo y capas
  util.js         utilidades (formato de tiempo, easing, toast…)
  demo.js         clips de ejemplo generados por código
  clips.js        importación de videos, búsqueda de cuadros, audio
  music.js        música de fondo (vista previa y exportación)
  timeline.js     cálculo de posiciones y solapes de transición
  transitions.js  transiciones y filtros de color
  render.js       composición de cada cuadro, overlays y guías
  playback.js     reproducción, sincronía de video/audio, bucle principal
  tracker.js      rastreo de movimiento
  export.js       exportación: elige la rápida o MediaRecorder
  fastexport.js   exportación con WebCodecs (cuadro por cuadro + audio fuera de línea)
  frames.js       cuadros exactos de un video con VideoDecoder
  demux.js        índice de MP4/MOV y WebM/MKV
  mp4.js          escritura del .mp4
  panel.js        panel de herramientas (pestañas)
  timeline-ui.js  dibujo de la línea de tiempo
  actions.js      acciones de UI y eventos de puntero/teclado
  store.js        acceso a IndexedDB (proyectos, videos, preferencias)
  project.js      serializar, autoguardar, abrir/crear/eliminar, deshacer/rehacer, archivo .rastro
  archive.js      zip mínimo (sin dependencias) para los archivos .rastro
tests/smoke.cjs   prueba de humo en Chromium (Playwright)
```

## Pruebas

```bash
node tests/smoke.cjs
```

Abre el editor en Chromium (Playwright) a 1280 y 390 px, importa un video de prueba generado con `ffmpeg`,
rastrea un objeto de trayectoria conocida, exporta y revisa que no haya errores en la consola.

## Rastreo: cómo funciona

`js/tracker.js` hace *template matching* con correlación cruzada normalizada (ZNCC):

1. Cada cuadro se reduce a 400 px de ancho, se pasa a gris y se desenfoca, para tolerar rotación y compresión.
2. Busca un parche de 21×21 en una ventana de ±24 px alrededor de la posición predicha (posición + velocidad), comparando contra la plantilla original y una adaptativa.
3. Refina con ajuste subpíxel (parábola).
4. Si el objeto se tapa unos cuadros, predice con la velocidad hasta 4 cuadros. Si sale de cuadro o no se recupera con confianza, marca el tramo como perdido.
5. Con **2 puntos**, ambos se buscan sobre los mismos cuadros. El ángulo y la distancia entre ellos, comparados con el cuadro donde se marcaron, dan el giro y la escala. Ese giro y escala previstos se usan para deformar la plantilla original de cada punto antes de compararla: sin esto, al girar el objeto la plantilla deja de parecerse y el rastreo se desvía (en la prueba, de 29 px a 7 px de error tras 2,8 s y 80° de giro).

Precisión medida en pruebas: error promedio de ~2 px en el clip de ejemplo y de ~6 px en un video real de 1280×720 (objeto con textura sobre fondo cambiante).

## Limitaciones conocidas

- El rastreo es 2D: por punto (posición) o por 2 puntos (posición, giro y escala). No es planar ni de cámara 3D como Mocha: no estima perspectiva.
- Los proyectos se guardan **solo en ese navegador y dispositivo**: no se sincronizan. En ventanas privadas no se guarda nada.
- Los videos ocupan espacio del navegador; si se agota, el proyecto se guarda igual pero ese video habrá que volver a vincularlo.

## Hoja de ruta

- [x] Tracking de 2 puntos (posición + rotación + escala)
- [ ] Tracking planar de 4 esquinas (homografía) para reemplazar pantallas y letreros
- [x] Guardar y abrir proyectos (IndexedDB)
- [x] Pista de música y control de volumen por clip
- [x] Exportación más rápida que tiempo real con WebCodecs
- [x] Deshacer / rehacer
- [x] Exportar / importar proyecto como archivo (.rastro) para pasarlo a otro equipo
