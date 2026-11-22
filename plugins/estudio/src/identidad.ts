import os from 'node:os';

/** Quién estudia (repositorio abierto): el nombre sale de `ESTUDIO_NOMBRE` (clave
 * opcional «nombre» de rutas.json, que la carcasa pasa al servidor) o, si falta,
 * del usuario de Windows con mayúscula inicial. En el equipo de David da «David»
 * y `human:david`, como antes. Lo leen los prompts del tutor y la base de
 * conocimiento (persona, autor de registros y commits); la interfaz no lo muestra. */
export function nombreEstudiante(env: Record<string, string | undefined> = process.env, usuario: () => string = () => os.userInfo().username): string {
  const propio = env.ESTUDIO_NOMBRE?.trim();
  if (propio) return propio.slice(0, 60);
  let base = '';
  try { base = usuario().trim(); } catch { /* sin usuario: nombre neutro */ }
  return base ? base.charAt(0).toLocaleUpperCase('es') + base.slice(1) : 'Estudiante';
}

/** El autor KBOL (`human:<slug>`): minúsculas sin tildes, solo letras, cifras y guiones. */
export function autorKbol(nombre: string = nombreEstudiante()): string {
  const slug = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `human:${slug || 'estudiante'}`;
}
