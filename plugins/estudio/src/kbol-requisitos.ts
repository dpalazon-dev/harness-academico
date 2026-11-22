import * as fs from 'node:fs';
import * as path from 'node:path';

/** KBOL y uv son opcionales en el compilado (equipos sin ellos arrancan igual).
 * Solo incorporar PDF y guardar en la base de conocimiento los necesitan: aquí
 * se comprueba antes de lanzar nada, con un mensaje que dice qué falta. */
export const GUIA_KBOL = 'Instala uv (https://docs.astral.sh/uv/) y KBOL (https://github.com/dpalazon-dev/KBOL), y apunta "uv" en rutas.json y ESTUDIO_KBOL_DIR si KBOL no está en tu carpeta de usuario.';

export function comprobarKbol(uso: string, config: { kbolDir: string; uv: string }, carpeta = '.', existe = fs.existsSync): void {
  const faltan: string[] = [];
  if (!existe(path.join(config.kbolDir, carpeta))) faltan.push(`KBOL en ${path.join(config.kbolDir, carpeta)}`);
  if (path.isAbsolute(config.uv) && !existe(config.uv)) faltan.push(`uv en ${config.uv}`);
  if (faltan.length > 0) throw new Error(`${uso} necesita KBOL y uv. Falta ${faltan.join(' y ')}. ${GUIA_KBOL}`);
}

/** Traduce el ENOENT de un `uv` sin ruta (no está en el PATH) a la misma guía. */
export function errorDeUv(uv: string, error: NodeJS.ErrnoException): string | null {
  return error.code === 'ENOENT' && !path.isAbsolute(uv) ? `No encuentro uv en el PATH. ${GUIA_KBOL}` : null;
}
