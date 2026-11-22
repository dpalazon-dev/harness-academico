import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { EstructuraV1 } from '../src/documents/estructura.ts';

export const ORIGINAL = Buffer.from('%PDF-1.7 fake original');
export const ORIGINAL_SHA = createHash('sha256').update(ORIGINAL).digest('hex');

export function estructura(): EstructuraV1 {
  return {
    perfil: 'estructura-v1', original_sha256: ORIGINAL_SHA,
    paginas: [{ p: 1 }, { p: 2 }],
    unidades: [
      { clave: 'seccion=1;pagina=1', paginas: [1], texto: '1 Introduction\nAnomaly detection in water treatment plants is hard.', titulo: '1 Introduction', numero: '1', ruta: ['1 Introduction'], tipo: 'introduccion', referencias: ['3'] },
      { clave: 'seccion=1;tabla=1', paginas: [1], texto: 'SWaT F1 0.89', leyenda: 'Table 1: Results on SWaT', ruta: ['1 Introduction'], tipo: 'introduccion' },
      { clave: 'seccion=2;pagina=2', paginas: [2], texto: '2 Method\nWe use a graph neural net-\nwork with “attention” over sensors.', titulo: '2 Method', numero: '2', ruta: ['2 Method'], tipo: 'metodo', referencias: [] },
      { clave: 'seccion=2;figura=1', paginas: [2], texto: 'Figure 1: Architecture', leyenda: 'Figure 1: Architecture', ruta: ['2 Method'], tipo: 'metodo' },
    ],
    referencias: [{ clave: '3', texto: 'Goh et al. A dataset to support research in ICS security.', paginas: [2], seccion: 'seccion=2;pagina=2' }],
    avisos: [],
  };
}

/** A temporary DI store holding the original and the structure, as `<almacen>/sha256/<hex>`. */
export function tempAlmacen(t: TestContext, e: EstructuraV1 = estructura()): { almacen: string; estructuraSha: string } {
  const almacen = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-almacen-'));
  t.after(() => fs.rmSync(almacen, { recursive: true, force: true }));
  fs.mkdirSync(path.join(almacen, 'sha256'));
  const bytes = Buffer.from(JSON.stringify(e));
  const estructuraSha = createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(path.join(almacen, 'sha256', ORIGINAL_SHA), ORIGINAL);
  fs.writeFileSync(path.join(almacen, 'sha256', estructuraSha), bytes);
  return { almacen, estructuraSha };
}
