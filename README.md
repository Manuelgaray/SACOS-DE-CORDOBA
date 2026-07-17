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

## Base de datos (una sola vez)

La app se conecta con un **usuario dedicado** (`supersacos_app`) a una base de datos
**`supersacos`**, no con el superusuario `postgres`.

### 1. Crear la base de datos y el usuario

Conéctate como `postgres` (te pedirá su contraseña) y ejecuta:

```sql
CREATE ROLE supersacos_app LOGIN PASSWORD 'Sacos_app_2026';
CREATE DATABASE supersacos OWNER supersacos_app;
```

Luego, ya conectado a la base `supersacos` como `postgres`:

```sql
GRANT ALL ON SCHEMA public TO supersacos_app;
```

### 2. Configurar `.env.local`

Crea el archivo `.env.local` en la carpeta `supersacos-pro` con la cadena de conexión
(usa la misma contraseña que pusiste arriba):

```
DATABASE_URL=postgresql://supersacos_app:Sacos_app_2026@localhost:5432/supersacos
```

### 3. Crear las tablas y los usuarios

```bash
# Crea las tablas y siembra 2 órdenes de ejemplo
psql -U supersacos_app -d supersacos -f db/schema.sql

# Siembra los usuarios con contraseña hasheada (lee DATABASE_URL de .env.local)
node scripts/seed-users.mjs
```

---

## Instalación y arranque

1. Abre una terminal en la carpeta `supersacos-pro`.
2. Instala dependencias:
   ```bash
   npm install
   ```
3. Arranca el servidor de desarrollo:
   ```bash
   npm run dev
   ```
4. Abre **http://localhost:3000**. Te redirige a la página de login.

---

## Iniciar sesión

El login valida las credenciales en el servidor contra la tabla `usuarios` de
PostgreSQL (contraseñas hasheadas con bcrypt). Cuentas sembradas por defecto:

| Email | Contraseña | Rol | Puede subir órdenes |
|---|---|---|---|
| `manueljgg2004@gmail.com` | `manu` | admin | ✅ |
| `diseno@sacos.com` | `dise` | diseno (encargado de diseños) | ✅ |
| `supervisor@sacos.com` | `super` | supervisor | ❌ |

> ⚠ **Cambia estas contraseñas.** Para agregar, quitar o editar usuarios y roles,
> edita el arreglo `USUARIOS` en [`scripts/seed-users.mjs`](scripts/seed-users.mjs)
> y vuelve a correr `node scripts/seed-users.mjs`.

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

```
supersacos-pro/
├── db/
│   └── schema.sql                  # Tablas (usuarios, ordenes, avances) + órdenes demo
├── scripts/
│   └── seed-users.mjs              # Siembra usuarios con contraseña hasheada
├── src/
│   ├── app/
│   │   ├── page.tsx                # Redirige a /login
│   │   ├── login/page.tsx          # Login
│   │   ├── api/                    # Backend (route handlers que hablan con Postgres)
│   │   │   ├── login/              # POST: valida credenciales
│   │   │   ├── data/               # GET: órdenes + avances
│   │   │   ├── ordenes/            # POST: crear orden; [id]/pdf, [id]/estado
│   │   │   └── avances/            # POST: capturar avance
│   │   └── (app)/                  # Rutas protegidas (dashboard, ordenes, produccion)
│   ├── components/                 # Sidebar, TopBar, MobileNav, AppShell, LogoMark
│   └── lib/
│       ├── db.ts                   # Conexión a PostgreSQL (pool de pg, solo servidor)
│       ├── auth.ts                 # Login (cliente) + roles
│       ├── orden-map.ts            # Mapeo fila Postgres → tipo Orden
│       ├── mock-data.ts            # Tipos + helpers
│       └── produccion.ts           # Motor de avance por área
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
