import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parsePlan, parseProposal, parseUnit } from './schema.ts';
import type { ElementoPlan, PlanOp, StudyUnit } from './types.ts';

/** Planes de antes de los elementos ligeros (spec `.scratch/planes`, decisión 6, «convertir y retirar»): cada unidad del
 * plan pasa a ser un tema enlazado a ella, los cambios del plan pendientes caducan y las unidades propuestas que no
 * quedan enlazadas a ningún tema se archivan. Lee y escribe los ficheros en bruto, porque el esquema nuevo ya no lee
 * los viejos. Solo actúa si queda algún plan o cambio del formato viejo; se ejecuta al arrancar el plugin. Los planes
 * se reescriben los últimos: si algo falla a medias, el siguiente arranque lo repite. */

const RECORD_FILE = /^[A-Za-z0-9_-]{1,128}\.json$/;
type Raw = Record<string, unknown>;

export interface ResultadoMigracion { planes: number; cambios: number; unidadesArchivadas: number }

/** El id del tema que sustituye a una unidad de un plan viejo; estable, para traducir también los cambios viejos. */
export const elementoDeUnidad = (unitId: string) => `t-${unitId}`.slice(0, 128);

function leer(dir: string): { id: string; raw: Raw }[] {
  if (!fs.existsSync(dir)) return [];
  const out: { id: string; raw: Raw }[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!RECORD_FILE.test(name)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as unknown;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) out.push({ id: name.slice(0, -5), raw: raw as Raw });
    } catch { /* un fichero ilegible se deja como está: el almacén ya lo salta */ }
  }
  return out;
}

function escribir(dir: string, id: string, record: unknown): void {
  const temporary = path.join(dir, `.${id}-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, path.join(dir, `${id}.json`));
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

const esPlanViejo = (raw: Raw) => Array.isArray(raw.unitIds) && raw.elementos === undefined;
const esCambioViejo = (raw: Raw) => Array.isArray(raw.ops) && raw.ops.some(op => !!op && typeof op === 'object' && 'unitId' in op);

export function migrarPlanes(root: string, now: string): ResultadoMigracion {
  const dirPlanes = path.join(root, 'plans');
  const dirCambios = path.join(root, 'proposals');
  const dirUnidades = path.join(root, 'units');
  const planes = leer(dirPlanes);
  const viejos = planes.filter(p => esPlanViejo(p.raw));
  const cambiosViejos = leer(dirCambios).filter(c => esCambioViejo(c.raw));
  const resultado: ResultadoMigracion = { planes: 0, cambios: 0, unidadesArchivadas: 0 };
  if (viejos.length === 0 && cambiosViejos.length === 0) return resultado;

  const unidades = new Map<string, StudyUnit>();
  for (const { raw } of leer(dirUnidades)) { try { const u = parseUnit(raw); unidades.set(u.id, u); } catch { /* ilegible: fuera */ } }
  const titulo = (unitId: string) => unidades.get(unitId)?.title.trim().slice(0, 500) || unitId;

  // Una unidad queda enlazada a un solo tema: gana el plan vivo actualizado más recientemente.
  const orden = [...viejos].sort((a, b) =>
    Number(a.raw.archived === true) - Number(b.raw.archived === true) || String(b.raw.updatedAt).localeCompare(String(a.raw.updatedAt)));
  const enlazadas = new Set<string>();
  for (const { raw } of planes) {
    if (esPlanViejo(raw) || !Array.isArray(raw.elementos)) continue;
    for (const e of raw.elementos as { unitId?: unknown }[]) if (typeof e?.unitId === 'string') enlazadas.add(e.unitId);
  }
  const nuevos = orden.flatMap(({ id, raw }) => {
    const elementos: ElementoPlan[] = [];
    for (const unitId of (raw.unitIds as unknown[]).filter((x): x is string => typeof x === 'string')) {
      const tema: ElementoPlan = { id: elementoDeUnidad(unitId), tipo: 'tema', titulo: titulo(unitId), hecho: false };
      if (unidades.has(unitId) && !enlazadas.has(unitId)) { tema.unitId = unitId; enlazadas.add(unitId); }
      elementos.push(tema);
    }
    const { unitIds: _u, archived, ...resto } = raw;
    try {
      return [{ id, plan: parsePlan({ ...resto, revision: Number(raw.revision) + 1, updatedAt: now, estado: archived === true ? 'archivado' : 'activo', elementos, origen: 'manual' }) }];
    } catch { return []; /* un plan viejo ilegible se queda como está: el almacén lo salta */ }
  });

  // Las unidades primero: una propuesta que no queda en ningún tema se archiva; una enlazada ya está en el plan.
  for (const u of unidades.values()) {
    if (u.status !== 'propuesta') continue;
    const status = enlazadas.has(u.id) ? 'activa' : 'archivada';
    escribir(dirUnidades, u.id, parseUnit({ ...u, status, revision: u.revision + 1, updatedAt: now }));
    if (status === 'archivada') resultado.unidadesArchivadas++;
  }

  for (const { id, raw } of cambiosViejos) {
    const ops: PlanOp[] = (raw.ops as Raw[]).map(op => {
      const unitId = String(op.unitId);
      if (op.op === 'add') return { op: 'add', tipo: 'tema', titulo: titulo(unitId), ...(op.index === undefined ? {} : { index: op.index as number }) };
      if (op.op === 'remove') return { op: 'remove', elementoId: elementoDeUnidad(unitId) };
      return { op: 'move', elementoId: elementoDeUnidad(unitId), index: op.index as number };
    });
    const pendiente = raw.status === 'pendiente';
    try {
      escribir(dirCambios, id, parseProposal({
        ...raw, ops, revision: Number(raw.revision) + 1,
        ...(pendiente ? { status: 'obsoleta', decidedAt: now } : {}),
      }));
      resultado.cambios++;
    } catch { /* un cambio viejo ilegible se queda como está: el almacén lo salta */ }
  }

  for (const { id, plan } of nuevos) { escribir(dirPlanes, id, plan); resultado.planes++; }
  return resultado;
}
