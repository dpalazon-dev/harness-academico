import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseEstructura, type EstructuraV1 } from './estructura.ts';

const SHA256 = /^[0-9a-f]{64}$/;

/** A content-addressed artifact of the DI store (`<almacen>/sha256/<hex>`), checked against its hash before use. */
export function readArtifact(almacen: string, sha256: string): Buffer {
  if (!SHA256.test(sha256)) throw new Error(`Huella no válida: ${sha256}`);
  let bytes: Buffer;
  try { bytes = fs.readFileSync(path.join(almacen, 'sha256', sha256)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`El artefacto ${sha256.slice(0, 12)}… no está en el almacén`);
    throw error;
  }
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error(`El artefacto ${sha256.slice(0, 12)}… no coincide con su huella`);
  return bytes;
}

export function readEstructura(almacen: string, sha256: string): EstructuraV1 {
  return parseEstructura(JSON.parse(readArtifact(almacen, sha256).toString('utf8')));
}
