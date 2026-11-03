# Rastro para Android (Google Play)

La app de Android es una **Trusted Web Activity (TWA)**: abre la app web publicada
(`https://rvix10.github.io/rastroEdit/`) en Chrome, a pantalla completa y sin barra de direcciones.
Se usa la misma biblioteca que Bubblewrap, la herramienta oficial de Google (`androidbrowserhelper`).
La app web se sigue actualizando sola: publicar en `main` actualiza también la app de Android, sin subir nada nuevo a Play.

## Cómo se compila

GitHub Actions (`.github/workflows/android.yml`) compila en cada cambio de `android/`, o a mano desde
**Actions → Android (Play Store) → Run workflow**. El resultado queda como artefacto `rastro-android`:

| Archivo | Para qué |
|---|---|
| `app-debug.apk` | Probar en la tablet ya (firma de prueba) |
| `app-release.apk` | Probar la versión de publicación (firmada si hay llave) |
| `app-release.aab` | **Subir a Google Play** (firmado si hay llave) |

Todo lo propio de la app está en `android/gradle.properties`: paquete, dirección, nombre y versión.
El número interno de versión (`versionCode`) sale del número de ejecución de Actions, así que siempre crece.

## 1. Probar en la tablet (sin publicar)

1. Descarga el artefacto `rastro-android` de la última ejecución en Actions y descomprímelo.
2. Pasa `app-debug.apk` a la tablet e instálalo (Android pedirá permitir apps de esta fuente).
3. Se abre con barra de direcciones arriba: es normal hasta configurar `assetlinks.json` (paso 3).

## 2. Llave de subida (una sola vez, en tu computadora)

La llave firma lo que subes a Play. **Guárdala y respáldala**: si la pierdes, hay que pedirle a Google que la cambie.
Nunca la subas al repo (`.gitignore` ya ignora `*.jks`).

```bash
keytool -genkeypair -v -keystore rastro-upload.jks -alias rastro -keyalg RSA -keysize 2048 -validity 10000
```

Luego, en GitHub: **Settings → Secrets and variables → Actions → New repository secret**:

| Secreto | Valor |
|---|---|
| `RASTRO_KEYSTORE_B64` | el archivo en base64: `base64 -w0 rastro-upload.jks` (en Mac: `base64 -i rastro-upload.jks`) |
| `RASTRO_KEYSTORE_PASSWORD` | la contraseña del almacén |
| `RASTRO_KEY_ALIAS` | `rastro` |
| `RASTRO_KEY_PASSWORD` | la contraseña de la llave (si no pusiste otra, la misma) |

En la siguiente compilación, el paso «Huella de la llave de subida» muestra su **SHA-256**.

## 3. assetlinks.json (sin barra de direcciones)

Android confirma que la app y el sitio son del mismo dueño leyendo
`https://rvix10.github.io/.well-known/assetlinks.json`, **en la raíz del dominio**. Como la app web está en
`/rastroEdit/`, ese archivo no puede ir en este repo. Dos opciones:

- **Gratis y rápida:** crea el repo `rvix10.github.io`, activa Pages en él y agrega
  `.well-known/assetlinks.json` (más un archivo vacío `.nojekyll`, para que Pages publique la carpeta con punto).
- **Dominio propio** (por ejemplo `rastro.app`): apúntalo a este repo en Settings → Pages, cambia `rastro.host` en
  `gradle.properties` y pon el archivo en este repo, en `.well-known/assetlinks.json`.

Contenido (plantilla en `android/assetlinks.json`): las huellas SHA-256 de **dos** llaves.
1. La **llave de firma de la app** que guarda Google: Play Console → tu app → Prueba y lanzamiento → Configuración → Integridad de la app.
2. Tu **llave de subida** (paso 2), para que también funcionen los APK que instales tú.

Verificación: `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://rvix10.github.io&relation=delegate_permission/common.handle_all_urls`

## 4. Publicar en Google Play

1. Cuenta de desarrollador en Play Console (pago único). Las cuentas personales nuevas deben hacer una
   **prueba cerrada** con un grupo de testers durante un tiempo antes de producción: revisa el requisito vigente en Play Console.
2. **Crear app**: nombre «Rastro» (revisa antes que el nombre no tenga conflictos de marca), idioma español, app, gratuita
   (las suscripciones se agregan después dentro de la app).
3. **Ficha de Play Store**: textos en `store/ficha.md`; imágenes en `store/` (ícono 512, imagen destacada 1024×500,
   capturas de teléfono, tablet 7" y tablet 10"; se regeneran con `node store/generar.cjs`).
4. **Política de privacidad**: `https://rvix10.github.io/rastroEdit/privacy.html`.
5. **Seguridad de los datos**: la app **no recopila ni comparte datos** (todo se procesa en el dispositivo; sin cuentas,
   anuncios ni analítica).
6. **Contenido de la app**: sin anuncios; clasificación de contenido (cuestionario); público objetivo mayor de 13 años.
7. **Firma de apps de Google Play**: aceptar (Google guarda la llave de firma; tú subes con tu llave de subida).
8. Subir `app-release.aab` a **Prueba interna**, instalar desde Play en la tablet y revisar; después, prueba cerrada y producción.

## Pendiente de decidir antes de la primera subida

- **Identificador del paquete**: `io.github.rvix10.rastro` (`rastro.applicationId`). No se puede cambiar después de publicar.
- **Nombre** de la app y **dominio** (si se usa uno propio, conviene decidirlo antes, porque cambia `rastro.host`).
