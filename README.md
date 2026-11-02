# Rastro Editor

Editor de video que corre en el navegador (celular y PC), sin servidor ni instalación.
Interfaz inspirada en Adobe Rush, transiciones tipo LightCut y rastreo de movimiento por punto.
Los videos se procesan en el dispositivo; nada se sube a ningún servidor.

## Funciones

| Área | Qué hace |
|---|---|
| **Medios** | Importa varios videos (MP4, WebM, MOV según el navegador). Formato del proyecto 16:9, 9:16 o 1:1. |
| **Editar** | Recorte de inicio y fin, dividir en el cursor, duplicar, reordenar, silenciar, filtros (Cálido, Frío, B/N, Vívido, Cine). |
| **Transiciones** | Corte, Fundido, Destello, Deslizar, Empujar, Zoom, Giro, Barrido, Círculo, Desenfoque y Glitch, con duración ajustable. Los clips se superponen durante la transición y el audio hace crossfade. |
| **Rastreo** | Marcas un punto y el editor lo sigue cuadro a cuadro, hacia adelante y hacia atrás. |
| **Texto y stickers** | Texto (3 tipografías, contorno o caja), aro de enfoque y stickers. Cualquier elemento puede seguir el objeto rastreado y se arrastra sobre la vista previa. |
| **Exportar** | Graba el lienzo con `MediaRecorder` a MP4 (si el navegador lo soporta) o WebM, con audio. |

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
  timeline.js     cálculo de posiciones y solapes de transición
  transitions.js  transiciones y filtros de color
  render.js       composición de cada cuadro, overlays y guías
  playback.js     reproducción, sincronía de video/audio, bucle principal
  tracker.js      rastreo de movimiento
  export.js       exportación con MediaRecorder
  panel.js        panel de herramientas (pestañas)
  timeline-ui.js  dibujo de la línea de tiempo
  actions.js      acciones de UI y eventos de puntero/teclado
```

## Rastreo: cómo funciona

`js/tracker.js` hace *template matching* con correlación cruzada normalizada (ZNCC):

1. Cada cuadro se reduce a 400 px de ancho, se pasa a gris y se desenfoca, para tolerar rotación y compresión.
2. Busca un parche de 21×21 en una ventana de ±24 px alrededor de la posición predicha (posición + velocidad), comparando contra la plantilla original y una adaptativa.
3. Refina con ajuste subpíxel (parábola).
4. Si el objeto se tapa unos cuadros, predice con la velocidad hasta 4 cuadros. Si sale de cuadro o no se recupera con confianza, marca el tramo como perdido.

Precisión medida en pruebas: error promedio de ~2 px en el clip de ejemplo y de ~6 px en un video real de 1280×720 (objeto con textura sobre fondo cambiante).

## Limitaciones conocidas

- El rastreo es **2D por punto** (posición). No es planar ni de cámara 3D como Mocha: no estima rotación, escala ni perspectiva.
- La exportación es en **tiempo real**: un video de 30 s tarda 30 s.
- El proyecto vive en memoria; recargar la página lo pierde.

## Hoja de ruta

- [ ] Tracking de 2 puntos (posición + rotación + escala)
- [ ] Tracking planar de 4 esquinas (homografía) para reemplazar pantallas y letreros
- [ ] Guardar y abrir proyectos (IndexedDB)
- [ ] Pista de música y control de volumen por clip
- [ ] Exportación más rápida que tiempo real con WebCodecs
- [ ] Deshacer / rehacer
