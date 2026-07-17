// ─────────────────────────────────────────────────────────────────────────────
//  Número de orden consecutivo
//
//  Formato: SC{NNN}-{YY}CD  →  ej. SC001-26CD
//    · SC      = prefijo fijo
//    · NNN     = consecutivo (por año), con al menos 3 dígitos
//    · YY      = últimos 2 dígitos del año (2026 → "26")
//    · CD      = sufijo fijo (Córdoba)
//
//  El consecutivo se reinicia por año (porque el sufijo incluye el año). La
//  sugerencia es editable: el usuario puede sobrescribirla en el formulario.
// ─────────────────────────────────────────────────────────────────────────────

export function anioSufijo(d: Date = new Date()): string {
  return String(d.getFullYear()).slice(-2);
}

// Devuelve el siguiente número consecutivo a partir de los números ya existentes.
export function siguienteNumeroOrden(numeros: string[], d: Date = new Date()): string {
  const yy = anioSufijo(d);
  const re = new RegExp(`^SC(\\d+)-${yy}CD$`, 'i');

  let max = 0;
  for (const n of numeros) {
    const m = re.exec((n ?? '').trim());
    if (m) {
      const v = parseInt(m[1], 10);
      if (v > max) max = v;
    }
  }

  return `SC${String(max + 1).padStart(3, '0')}-${yy}CD`;
}
