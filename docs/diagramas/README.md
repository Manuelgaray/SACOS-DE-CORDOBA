# Diagramas — Sistema de Control de Producción (Sacos de Córdoba)

Diagramas UML del sistema, en formato **SVG** (escalable, se inserta directo en Word, PDF o presentaciones).

## Contenido

| Archivo | Tipo | Descripción |
|---|---|---|
| `casos-de-uso-general.svg` | Diagrama de casos de uso | Actores y los 5 casos de uso del sistema |
| `cu01-inicio-de-sesion.svg` | Diagrama de actividad | Flujo del inicio de sesión |
| `cu02-navegacion.svg` | Diagrama de actividad | Flujo de navegación entre módulos |
| `cu03-creacion-de-ordenes.svg` | Diagrama de actividad | Flujo de creación de una orden |
| `cu04-uso-de-filtros.svg` | Diagrama de actividad | Flujo de filtrado de órdenes |
| `cu05-captura-de-avance.svg` | Diagrama de actividad | Flujo de captura de avance por área |

## Actores

- **Jefe de producción** — crea órdenes y consulta el avance.
- **Supervisor de área** — captura el avance de producción de su área.
- **Servicio de Autenticación** — actor secundario que valida las credenciales.

## Estilo

Diagramas de casos de uso UML clásicos sobre **fondo oscuro**: actor (figura),
frontera del sistema (rectángulo con título), casos de uso (elipses) y
relaciones **«include» / «extend»** hacia los casos de uso de validación.

Cada caso de uso está descompuesto en sus acciones principales:

- **CU-01, CU-02, CU-04** → actor **Usuario**
- **CU-03** → actor **Jefe de producción**
- **CU-05** → actor **Supervisor de área**

El diagrama general muestra los tres actores y los 5 casos de uso del sistema.

## Cómo verlos / convertirlos

- **Ver:** abre cualquier `.svg` en el navegador (doble clic).
- **Insertar en Word:** Insertar → Imágenes → selecciona el `.svg` (Word 2016+ soporta SVG).
- **Convertir a PNG/JPG:** ábrelo en el navegador y exporta, o usa una herramienta como Inkscape / un convertidor en línea.
