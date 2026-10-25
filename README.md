# Ensaya

App de [theaipeoplehub](https://theaipeoplehub.com) para grupos de música: repertorio con audio, partituras,
ensayos, setlists y modo escenario.

- Node.js 20+ con una sola dependencia (`postgres`), páginas renderizadas en el servidor, sin build.
- Login con **Keycloak** (OpenID Connect, Authorization Code + PKCE) e invitaciones por email con la Admin API de Keycloak.
- PostgreSQL en el esquema `ensaya` (puede compartir base de datos con Keycloak y otras apps).
- Archivos en **Cloudflare R2** (o cualquier S3); en local, en disco.

## Funcionalidades

| Qué | Quién |
| --- | --- |
| Crear un grupo (quien lo crea lo gestiona) | Cualquier usuario con sesión |
| Invitar por email, reenviar, cancelar invitaciones, asignar roles, quitar miembros, editar o borrar el grupo | **Solo quien creó el grupo** |
| Aceptar o rechazar una invitación (enlace ligado a su email) | La persona invitada |
| Repertorio: canciones con tono, tempo, compás, duración, estado, etiquetas, letra con acordes (ChordPro) y transposición | Miembros |
| Subir audio (MP3, WAV, FLAC, M4A…), PDF, MusicXML e imágenes | Miembros |
| Reproductor de práctica: forma de onda, bucle A-B (también arrastrando), velocidad sin cambiar el tono, tono sin cambiar la velocidad, marcadores compartidos, cuenta de entrada | Miembros |
| Atril PDF: una o dos páginas, pedal Bluetooth / teclado / toques, pantalla completa, anotaciones a mano alzada en capa personal y capa del grupo | Miembros |
| MusicXML: visor con transposición, zoom, mostrar/ocultar partes e impresión | Miembros |
| Editor de partituras (notación ABC): vista en vivo, paleta de notas, transposición, reproducción, MIDI, impresión, aviso de conflictos | Miembros |
| Agenda: calendario mensual, ensayos y conciertos, asistencia, canciones a trabajar, objetivos, notas tras el ensayo, exportar a calendario (.ics) | Miembros |
| Setlists: añadir canciones, descansos y textos, ordenar arrastrando o con flechas, tono y nota por canción, duración total, duplicar, imprimir | Miembros |
| Modo escenario: letras y acordes a pantalla completa, pedal o flechas, transposición en vivo, tamaño de letra, desplazamiento automático, tema claro/oscuro y uso **sin conexión** | Miembros |
| Afinador cromático y metrónomo | Miembros |
| Borrar canciones, archivos, partituras, eventos o setlists | Quien los creó o quien creó el grupo |

## Variables de entorno

| Variable | Ejemplo | Para qué |
| --- | --- | --- |
| `DATABASE_URL` | URL interna de la Postgres en Render | Base de datos |
| `SESSION_SECRET` | cadena aleatoria larga | Firma de la cookie de sesión |
| `OIDC_ISSUER` | `https://keycloak-8s55.onrender.com/realms/theaipeoplehub` | Realm de Keycloak |
| `OIDC_CLIENT_ID` | `ensaya` | Cliente OIDC en Keycloak |
| `OIDC_CLIENT_SECRET` | (de Keycloak) | Secreto del cliente |
| `BASE_URL` | `https://ensaya.onrender.com` | URL pública (por defecto, la que da Render) |
| `R2_ACCOUNT_ID` | id de tu cuenta de Cloudflare | Almacenamiento R2 |
| `R2_BUCKET` | `ensaya` | Bucket de R2 |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | token de API de R2 | Credenciales de R2 |
| `MAX_UPLOAD_MB` | `300` | Tamaño máximo por archivo |
| `PLATFORM_URL` | `https://theaipeoplehub-platform.onrender.com` | Enlaces al portal y textos legales |
| `KEYCLOAK_ADMIN_CLIENT_ID` / `_SECRET` | opcional | Otro cliente para la Admin API (por defecto, el mismo cliente OIDC) |

Sin las variables `R2_*` los archivos se guardan en disco (`STORAGE_DIR`), que en el plan gratuito de Render se borra en cada despliegue.

## Keycloak

1. Clients → Create client → `ensaya` (OpenID Connect). Activa **Client authentication** y **Service accounts roles**; deja **Standard flow** activado.
2. Valid redirect URIs: `https://<tu-app>/*` (cubre `/auth/callback` y la vuelta de las invitaciones `/invitaciones/...`).
   Valid post logout redirect URIs: `https://<tu-app>/*`. Web origins: `https://<tu-app>`.
3. Pestaña **Service accounts roles** → Assign role → filtra por clientes → `realm-management`: **manage-users** y **view-users**.
4. Realm settings → **Email**: configura el SMTP (remitente, host, puerto, usuario). Sin SMTP la invitación se crea igual y el creador puede copiar su enlace.
5. Copia el secreto (pestaña Credentials) a `OIDC_CLIENT_SECRET`.

### Cómo funcionan las invitaciones

Keycloak no trae enlaces mágicos de serie, así que se usa su email de *acciones requeridas* (`execute-actions-email`):
un enlace firmado, de un solo uso, que caduca en 7 días.

- Si la persona no tiene cuenta, la app la crea en Keycloak y el enlace le pide nombre y contraseña.
- Si ya tiene cuenta, el enlace solo confirma su email.
- Al terminar, Keycloak la devuelve a `/invitaciones/<token>`, entra y acepta. La invitación solo vale para el email invitado y verificado.
- La invitación también aparece en su portada al entrar con ese email.

## Cloudflare R2

1. R2 → Create bucket `ensaya` (privado).
2. R2 → Manage API tokens → Create token con permiso *Object Read & Write* para ese bucket.
3. Copia Account ID, Access Key ID y Secret Access Key a las variables `R2_*`.

Los archivos pasan por la app (subida en streaming y descarga con soporte de `Range`), así que el bucket no necesita CORS ni acceso público.

## En local

```bash
npm install
DATABASE_URL=postgres://localhost/ensaya SESSION_SECRET=dev \
OIDC_ISSUER=http://localhost:8080/realms/theaipeoplehub OIDC_CLIENT_ID=ensaya OIDC_CLIENT_SECRET=... \
npm start
```

## Base de datos

`db/schema.sql` se ejecuta en cada arranque y es idempotente: crea el esquema `ensaya` y sus tablas. Las fechas se guardan en
UTC y se muestran en hora de España (`APP_TIMEZONE`, por defecto `Europe/Madrid`).

## Librerías de cliente incluidas

En `public/vendor/`: [abcjs](https://github.com/paulrosen/abcjs) (MIT), [OpenSheetMusicDisplay](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay) (BSD-3) y [PDF.js](https://github.com/mozilla/pdf.js) (Apache-2.0).
La reproducción del editor descarga los sonidos de instrumentos de `paulrosen.github.io`.
