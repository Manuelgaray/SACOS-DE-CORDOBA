// ─────────────────────────────────────────────────────────────────────────────
//  Familias de material del formato de almacén.
//
//  La clave de la tela viene DENTRO del código del rollo: SCFLF6CW48RAF lleva
//  6CW48 (6 oz por 48" de ancho) y SCFLF3CW42SCP lleva 3CW42. Todos los rollos
//  de la misma tela comparten ese código, así que el sistema los agrupa solo:
//  el renglón sombreado del papel es la familia y su cantidad es la SUMA de sus
//  rollos.
//
//  Los materiales que no traen esa clave (cintas, cordeles, portadocumentos,
//  etiquetas: SCW050RWPP4.5MUL, ETQ-3050) no forman familia — cada uno va en su
//  propio renglón con su consumo.
// ─────────────────────────────────────────────────────────────────────────────

// Dígitos + CW + dígitos, pegados al código (admite espacios por si se teclea).
const RE_FAMILIA = /(\d+)\s*CW\s*(\d+)/i;

/** Clave de familia de un código de material, o null si no la tiene. */
export function familiaDeMaterial(codigo: string): string | null {
  const m = (codigo ?? '').match(RE_FAMILIA);
  return m ? `${m[1]}CW${m[2]}` : null;
}

/** Clave con la que se agrupa un renglón: su familia o su propio código. */
export function claveDeMaterial(codigo: string): string {
  return familiaDeMaterial(codigo) ?? (codigo ?? '').trim().toUpperCase();
}

export interface RenglonAgrupable {
  material: string;
  cantidad: number;
  unidad: string;
}

export interface GrupoMaterial<T extends RenglonAgrupable> {
  clave: string;
  /** true cuando la clave es una familia de tela (lleva renglón sombreado). */
  esFamilia: boolean;
  unidad: string;
  /** Suma de las cantidades de los rollos: lo que va en el renglón sombreado. */
  total: number;
  renglones: T[];
}

/**
 * Agrupa los renglones por familia, conservando el orden de captura. La suma se
 * calcula aquí: nunca se teclea, así no puede quedar desfasada de sus rollos.
 */
export function agruparMateriales<T extends RenglonAgrupable>(renglones: T[]): GrupoMaterial<T>[] {
  const grupos: GrupoMaterial<T>[] = [];
  const porClave = new Map<string, GrupoMaterial<T>>();

  for (const r of renglones) {
    const clave = claveDeMaterial(r.material);
    let g = porClave.get(clave);
    if (!g) {
      g = {
        clave,
        esFamilia: familiaDeMaterial(r.material) !== null,
        unidad: r.unidad,
        total: 0,
        renglones: [],
      };
      porClave.set(clave, g);
      grupos.push(g);
    }
    g.total += Number(r.cantidad) || 0;
    if (!g.unidad) g.unidad = r.unidad;
    g.renglones.push(r);
  }

  return grupos;
}
