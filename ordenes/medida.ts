// Medidas del saco: en la captura se separan las dimensiones de la unidad, y en
// la base se guardan juntas ("36 x 36 x 50 in"). Lo usan la nueva orden y el
// registro de diseños.

/** Combina las dimensiones con la unidad elegida. Respeta lo escrito si el
 *  usuario ya incluyó comillas o una unidad (in/cm/pulg). */
export function combinarMedida(dims: string, unidad: string): string {
  const d = dims.trim();
  if (!d) return '';
  if (/["”]|\b(cm|in|pulg)\b/i.test(d)) return d;
  return `${d} ${unidad === 'cm' ? 'cm' : 'in'}`;
}

/** Inverso de combinarMedida: separa "36 x 36 x 50 in" en dimensiones + unidad. */
export function separarMedida(medida: string): { dims: string; unidad?: 'pulg' | 'cm' } {
  const m = medida.trim();
  if (!m) return { dims: '' };
  const cm = m.match(/^(.*?)\s*cm$/i);
  if (cm) return { dims: cm[1].trim(), unidad: 'cm' };
  const pulg = m.match(/^(.*?)\s*(?:in|pulg\.?)$/i);
  if (pulg) return { dims: pulg[1].trim(), unidad: 'pulg' };
  return { dims: m };
}

export const TIPOS_SACO = ['U-PANEL', '4-PANEL', 'BAFFLE', 'TUBULAR'];
export const GRADOS = ['', 'GRADO ALIMENTO', 'GRADO INDUSTRIAL'];
