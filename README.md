# LUXION — guía de instalación para principiantes

## 1. ¿Qué contiene la carpeta?

- `index.html`: la estructura y los textos de las cinco pantallas.
- `styles.css`: los colores, tamaños, botones y distribución visual.
- `app.js`: el funcionamiento: horario, tareas, temporizadores, racha, registro de agua, temario y copias.
- `manifest.json`: le explica al navegador el nombre y la forma de instalar LUXION como aplicación.
- `sw.js`: guarda los archivos principales para abrir LUXION sin internet después de la primera visita.
- `icon-192.png` y `icon-512.png`: iconos necesarios para que Chrome pueda instalar la PWA.
- `google-drive-backup.gs`: pequeño programa que guardarás dentro de Google Apps Script para crear una copia JSON en tu Drive.

## 2. Abrir la carpeta en tu computadora

1. Descarga `LUXION-PWA.zip` y descomprímelo.
2. Crea una carpeta llamada `LUXION` donde puedas encontrarla fácilmente.
3. Copia dentro los archivos del ZIP. No cambies sus nombres.
4. No abras `index.html` con doble clic para probar la instalación: el modo PWA necesita una dirección HTTPS o un servidor local. Para la prueba más sencilla, publícala con GitHub Pages o Netlify como se explica abajo.

## 3. Publicar gratis con GitHub Pages

1. Entra en https://github.com/ y crea una cuenta o inicia sesión.
2. Pulsa **New repository** (nuevo repositorio).
3. Ponle el nombre `luxion-pwa` y marca **Public**. Pulsa **Create repository**.
4. Dentro del repositorio, pulsa **Add file → Upload files**.
5. Arrastra TODOS los archivos de la carpeta LUXION a esa página. Debes ver `index.html`, `styles.css`, `app.js`, `manifest.json`, `sw.js`, `icon-192.png` e `icon-512.png` en la raíz del repositorio.
6. En la parte inferior pulsa **Commit changes**.
7. Abre **Settings → Pages**.
8. En **Build and deployment**, selecciona **Deploy from a branch**. En Branch elige **main** y **/(root)**. Pulsa **Save**.
9. Espera a que GitHub muestre la dirección de tu página. Normalmente tiene esta forma: `https://TU-USUARIO.github.io/luxion-pwa/`.
10. Abre esa dirección en Chrome. No uses `file://` ni una vista previa de archivos.

### Alternativa con Netlify

1. Entra en https://app.netlify.com/ y crea una cuenta.
2. Busca la opción para añadir un sitio manualmente (**Deploy manually**).
3. Arrastra la carpeta LUXION descomprimida al espacio de publicación.
4. Netlify te dará una dirección HTTPS que termina en `netlify.app`. Ábrela desde el celular.

## 4. Instalar en el celular o computadora

### Android con Chrome

1. Abre la dirección publicada en Chrome.
2. Espera unos segundos a que cargue por completo.
3. Abre el menú de los tres puntos ⋮.
4. Pulsa **Instalar aplicación** o **Agregar a pantalla principal**.
5. Confirma. LUXION aparecerá como una app en tu pantalla de inicio.
6. Abre la app instalada una vez con internet. Luego activa el modo avión y comprueba que las cinco pestañas sigan abriendo.

### iPhone / iPad

1. Abre la dirección con Safari.
2. Pulsa **Compartir**.
3. Elige **Añadir a pantalla de inicio**.
4. Confirma el nombre y pulsa **Añadir**.

En iPhone algunas funciones y notificaciones dependen de la versión de iOS y de cómo se haya añadido la app. No asumas que tendrá las mismas funciones de Chrome en Android.

### Computadora

En Chrome o Edge abre la dirección publicada. Busca el icono de instalación junto a la barra de direcciones o el menú del navegador y selecciona **Instalar LUXION**.

## 5. Conectar la copia gratuita con Google Drive

Esta configuración se hace una sola vez.

### A. Crear el programa de Google Apps Script

1. Abre https://script.google.com/ con la cuenta de Google donde quieres guardar tus copias.
2. Pulsa **Nuevo proyecto**.
3. Borra el código de ejemplo que aparece en el editor.
4. Abre el archivo `google-drive-backup.gs` que viene en la carpeta LUXION.
5. Copia todo su contenido y pégalo en el editor de Apps Script.
6. Arriba, cambia el nombre del proyecto a `LUXION Backup`.
7. En el panel izquierdo abre **Configuración del proyecto** (icono de engranaje).
8. Busca **Propiedades del script** y pulsa **Añadir propiedad del script**.
9. En el nombre escribe exactamente `LUXION_KEY`.
10. En el valor escribe una clave larga que inventes, de al menos 12 caracteres. Ejemplo de formato: `Luxion-2026-MiClave-83`. No uses ese ejemplo como tu clave real.
11. Guarda la propiedad.

### B. Publicar el programa

1. Pulsa **Implementar → Nueva implementación**.
2. En tipo de implementación selecciona **Aplicación web**.
3. En **Ejecutar como**, selecciona **Yo**.
4. En **Quién tiene acceso**, elige **Cualquier persona** si aparece disponible. Esta opción permite que la PWA envíe el archivo sin pedirte iniciar sesión cada vez; por eso debes mantener la clave privada y no compartir la dirección.
5. Pulsa **Implementar** y acepta los permisos de Google Drive que se soliciten.
6. Copia la dirección de la aplicación web. Debe terminar en `/exec`.

Si tu cuenta no permite elegir **Cualquier persona**, la política de la cuenta puede impedir este método. No cambies la seguridad de una cuenta institucional; usa la copia descargable manual.

### C. Pegar la dirección en LUXION

1. Abre LUXION desde su dirección HTTPS.
2. En Inicio, pulsa **Configurar Google Drive**.
3. Pega la dirección `/exec` en el primer campo.
4. Pega exactamente la clave que guardaste como `LUXION_KEY` en el segundo campo.
5. Pulsa **Guardar configuración**.
6. Abre tu Google Drive. Se creará una carpeta llamada `LUXION - Copias de seguridad` y dentro un archivo `LUXION_BACKUP.json`.
7. Cuando LUXION guarde cambios y haya internet, enviará una nueva copia y actualizará ese archivo.

Para restaurar una copia de Drive: abre Google Drive, descarga `LUXION_BACKUP.json` en el dispositivo, vuelve a LUXION y pulsa **Restaurar copia**. Selecciona el archivo descargado.

**Importante:** el navegador guarda primero los datos en el dispositivo. El envío a Drive se intenta cuando hay conexión y LUXION puede ejecutarse. No es una sincronización instantánea garantizada si la app está cerrada, el navegador está suspendido o el sistema ahorra batería. Descarga una copia manual de vez en cuando.

## 6. Activar alertas y pantalla encendida

1. Abre LUXION y pulsa **Activar alertas**. Acepta los permisos cuando el navegador los solicite.
2. Para evitar que la pantalla se apague durante un bloque, pulsa **Mantener pantalla encendida: OFF**. El botón cambiará a ON si el navegador acepta la solicitud.
3. Apaga esta opción al acabar para ahorrar batería.

Las notificaciones y los sonidos de inicio/fin se comprueban mientras LUXION está abierta y activa. Una PWA estática no puede prometer una alarma exacta cuando el navegador está cerrado o el teléfono ha detenido la app. Usa la alarma nativa del teléfono como respaldo para las 5:30 a. m. y las 10:00 p. m.

## 7. Cómo usar el sistema

- Marca cada tarea al terminarla. El día se gana solo con el 100% de las tareas que correspondan a ese día.
- Si una tarea se retrasa, LUXION la marca y crea una reparación razonable. No multiplica series, no restringe comida y no recorta sueño.
- El modo de emergencia es para trabajo imprevisto real y tiene un máximo de cuatro usos por mes. LUXION no puede bloquear otras aplicaciones como redes sociales; ese control depende de tu decisión o de las herramientas de bienestar digital del teléfono.
- Añade un vaso de 250 ml con el contador de agua. No fuerces una cantidad de agua si no tienes sed.
- En Estudio, marca un tema como **Estudiado** o **Dominado**. “Dominado” significa que puedes explicarlo y resolver preguntas sin mirar apuntes. El temario incluido es una base general de ingeniería, no reemplaza el prospecto oficial del examen de tu universidad; ajusta los temas cuando tengas ese documento.
- En domingo, usa el temporizador de simulacro y guarda el puntaje.
- En Rostro, suspende cualquier producto que cause ardor persistente, irritación o brotes importantes. El protector solar de amplio espectro FPS 30 o superior es la parte más importante para prevenir que las manchas se oscurezcan.

## 8. Cómo actualizar LUXION cuando haya una nueva versión

1. Abre tu repositorio de GitHub.
2. Antes de subir cambios, abre `sw.js` y cambia `luxion-shell-v1` por `luxion-shell-v2` (y usa v3, v4, etc. en futuras actualizaciones). Eso le indica al navegador que debe preparar una copia nueva.
3. Pulsa **Add file → Upload files** y sube los archivos actualizados reemplazando los anteriores.
4. Pulsa **Commit changes**.
5. Abre LUXION con internet. Si no aparece la nueva versión, cierra y vuelve a abrir la app; a veces el navegador conserva la versión anterior en caché.

## Aviso sobre datos

El registro principal está guardado en el almacenamiento del navegador del dispositivo. Si borras los datos del navegador, puedes perder la copia local. Descarga respaldos con regularidad. La clave de Drive se conserva en el navegador de ese dispositivo; no compartas el teléfono desbloqueado ni el enlace del Apps Script. No uses LUXION para guardar contraseñas ni información altamente sensible.
