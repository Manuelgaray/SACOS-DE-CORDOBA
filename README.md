# SuperSacos Pro

Sistema web de gestión de órdenes de producción para Sacos de Córdoba.

Permite ver el tablero de producción por líneas, listar y buscar órdenes, capturar
el avance por área y **crear órdenes subiendo el PDF del diseño** (hecho en AutoCAD),
sin tener que volver a teclear todas las especificaciones.

> **Estado actual:** la app guarda todo en una base de datos **PostgreSQL local**
> (usuarios, órdenes, PDFs y avances de producción). Los datos se **comparten** entre
> los navegadores/equipos que apunten a esa base de datos.

---

## Antes de empezar

Necesitas:

1. **Node.js 18 o superior** — https://nodejs.org (versión LTS).
2. **PostgreSQL 16 o 17** instalado y corriendo — https://www.postgresql.org/download/
   Durante la instalación se define la contraseña del usuario `postgres`; anótala.

Verifícalos en una terminal:

```bash
node --version
```

> En Windows, `psql` suele estar en `C:\Program Files\PostgreSQL\17\bin`. Si el comando
> `psql` no se reconoce, usa la ruta completa o agrégala al PATH.

---

## Instalación desde cero (clon nuevo)

Sigue los pasos **en este orden** (el 1 es requisito de los demás):

### 1. Instalar dependencias

```bash
cd supersacos-pro
npm install
```

### 2. Crear la base de datos y su usuario

La app se conecta con un **usuario dedicado** (`supersacos_app`) a una base de datos
**`supersacos`**, no con el superusuario `postgres`. Conéctate como `postgres`
(te pedirá su contraseña) y ejecuta:

```sql
CREATE ROLE supersacos_app LOGIN PASSWORD 'Sacos_app_2026';
CREATE DATABASE supersacos OWNER supersacos_app;
```

Luego, ya conectado a la base `supersacos` como `postgres`:

```sql
GRANT ALL ON SCHEMA public TO supersacos_app;
```

### 3. Configurar `.env.local`

Copia `.env.example` a `.env.local` y ajusta la contraseña (la que pusiste arriba):

```
DATABASE_URL=postgresql://supersacos_app:Sacos_app_2026@localhost:5432/supersacos
```

### 4. Crear las tablas y los usuarios

```bash
# Crea todas las tablas (usuarios, clientes, specs, ordenes, avances)
psql -U supersacos_app -d supersacos -f db/schema.sql

# Siembra los usuarios con contraseña hasheada (lee DATABASE_URL de .env.local)
node scripts/seed-users.mjs
```

> Si la base ya existía de una versión anterior, corre también
> `node scripts/migrate.mjs` (agrega columnas/tablas nuevas sin borrar datos;
> en una base recién creada no hace falta, pero no daña).

### 5. Arrancar

```bash
npm run dev
```

Abre **http://localhost:3000**. Te redirige a la página de login.
(Antes de arrancar, `predev` copia solo el visor de PDF a `/public` — automático.)

---

## Llevar tus datos a otra máquina (respaldo/restauración)

**Clonar el repositorio NO copia los datos**: las órdenes, clientes, PDFs y avances
viven en tu PostgreSQL local. Para presentarlos en otra máquina:

```bash
# En la máquina ORIGEN (respaldar todo, PDFs incluidos):
pg_dump -U supersacos_app -d supersacos -F c -f supersacos.backup

# En la máquina DESTINO (después de los pasos 1-3 de la instalación,
# SIN correr schema.sql — el respaldo trae las tablas):
pg_restore -U supersacos_app -d supersacos supersacos.backup
```

Copia el archivo `supersacos.backup` por USB o red. Los usuarios y contraseñas
viajan dentro del respaldo (no hace falta re-sembrarlos).

---

## Iniciar sesión

El login valida las credenciales en el servidor contra la tabla `usuarios` de
PostgreSQL (contraseñas hasheadas con bcrypt). Cuentas sembradas por defecto:

| Email | Contraseña | Rol | Área |
|---|---|---|---|
| `manueljgg2004@gmail.com` | `manu` | admin | — |
| `diseno@sacos.com` | `dise` | diseno (encargado de diseños) | — |
| `corte@sacos.com` | `corte` | supervisor | Corte |
| `small@sacos.com` | `small` | supervisor | Small |
| `tips@sacos.com` | `tips` | supervisor | Tips |

> ⚠ **Cambia estas contraseñas.** El admin puede crear/editar/eliminar usuarios
> desde la app (menú **Usuarios**); el seed de `scripts/seed-users.mjs` es solo el
> arranque inicial o el respaldo si te quedas sin acceso.
>
> La sesión es **única por usuario**: si la cuenta ya está activa en otro
> dispositivo, el login se rechaza hasta cerrar sesión allá (o ~2.5 min si el
> dispositivo se apagó sin cerrar sesión).

Solo los roles **admin** y **diseno** ven el botón "Nueva orden" y pueden subir PDFs;
los demás solo consultan y capturan avance.

---

## Crear una orden (subir PDF)

En **Órdenes → Nueva orden** (visible solo para admin/diseño):

1. Sube el **PDF** del diseño (máximo 10 MB).
2. Captura la **carátula**: No. de orden, cliente, spec, medida, cantidad, carga,
   tipo de saco, No. orden de cliente, embarcar a, grado, FMF, línea y status.
3. Guarda. La orden se guarda en la base de datos y aparece en el dashboard y en
   producción; al abrirla se muestra el PDF embebido con el diseño y especificaciones.

---

## Estructura del proyecto

La organización sigue **Screaming Architecture**: las carpetas de la raíz "gritan"
lo que hace el sistema (dominios del negocio), no la tecnología. Cada módulo agrupa
sus pantallas (`ui/`), sus endpoints (`api/`) y su lógica.

```
supersacos-pro/
├── app/                            # ENRUTADOR de Next.js (obligatorio) — stubs de
│                                   #   1-3 líneas que conectan cada URL con su módulo
├── autenticacion/                  # Login, sesión única por usuario, roles
│   ├── ui/login.tsx                #   Pantalla de login
│   ├── auth.ts                     #   Sesión en el navegador + permisos por rol
│   ├── auth-server.ts              #   Identidad del usuario en el servidor
│   └── api/                        #   login, logout, session-check
├── ordenes/                        # Carátula, PDF embebido, consecutivo, estado
│   ├── ui/                         #   Lista, detalle y nueva orden
│   ├── orden-num.ts                #   Número consecutivo SC001-26CD
│   ├── orden-map.ts               #   Mapeo fila Postgres → tipo Orden
│   └── api/                        #   crear orden, cambiar estado, servir PDF
├── produccion/                     # Captura de avance por área, líneas, progreso
│   ├── ui/                         #   Hub de áreas + captura por área
│   ├── produccion.ts               #   Plantillas por tipo de saco + motor de avance
│   ├── produccion-store.tsx        #   Estado global (órdenes + avances)
│   └── api/                        #   avances (captura), data (carga inicial)
├── explosion-materiales/           # BOM del área de corte + extracción PDF/OCR
│   ├── ui/ExplosionMateriales.tsx  #   Tabla editable + resultados por grupo
│   ├── explosion.ts                #   Cálculo (piezas, longitud lineal)
│   ├── pdf-corte.ts                #   Extracción de texto/OCR del PDF
│   └── api/                        #   extraer (con y sin orden), guardar
├── usuarios/                       # Administración de cuentas + perfil propio
│   ├── ui/                         #   Panel admin de usuarios + Mi perfil
│   └── api/                        #   CRUD de usuarios (solo admin), perfil
├── dashboard/
│   └── ui/dashboard.tsx            # Resumen general
├── compartido/                     # Base común a todos los módulos
│   ├── db.ts                       #   Conexión a PostgreSQL (solo servidor)
│   ├── mock-data.ts                #   Tipos (Orden, Area...) + etiquetas + fechas
│   └── ui/                         #   AppShell, Sidebar, TopBar, Modal, Logo...
├── db/
│   └── schema.sql                  # Tablas (usuarios, ordenes, avances)
├── scripts/
│   ├── seed-users.mjs              # Siembra usuarios con contraseña hasheada
│   └── migrate.mjs                 # Migraciones aditivas de esquema (idempotentes)
├── .env.local                      # DATABASE_URL (NO se sube a git)
├── package.json
└── README.md
```

---

## Cómo se ve en cada dispositivo

- **Desktop / laptop / tablet:** sidebar a la izquierda con navegación.
- **Móvil:** barra superior con botón de salir y navegación inferior.

---

## Problemas comunes

### "npm no se reconoce como comando"
Node.js no está instalado o no está en el PATH. Reinstala Node.js y reinicia la terminal.

### Error al arrancar: "Falta DATABASE_URL"
No existe `.env.local` o no tiene la línea `DATABASE_URL`. Revisa el paso "Base de datos".

### "password authentication failed" / no conecta a la base
La contraseña de `DATABASE_URL` no coincide con la del usuario `supersacos_app`, o
PostgreSQL no está corriendo. Verifica el servicio de PostgreSQL y la contraseña.

### La página carga en blanco
Abre las herramientas de desarrollador (F12) → pestaña Console y revisa errores.

---

## Notas

- Los datos se **comparten** entre navegadores/equipos que apunten a la misma base de
  datos. Para que otra computadora la use, debe poder conectarse a este PostgreSQL
  (misma red) y tener el `DATABASE_URL` correcto.
- La **sesión** se guarda en el navegador (localStorage); no es una auth "segura" con
  cookies httpOnly. La autorización del servidor para subir órdenes confía en el header
  `x-user-email`. Suficiente para uso local en la planta.
- Respaldo: como todo (incluidos los PDFs) vive en PostgreSQL, basta respaldar la base
  con `pg_dump -U supersacos_app supersacos > respaldo.sql`.
