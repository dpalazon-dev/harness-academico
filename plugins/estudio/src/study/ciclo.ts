import { DOCUMENT_PREFIX } from '../practice/prompts.ts';
import { capturas, VOLCADO_MAX, volcadoDe, type HechoCiclo, type HechosUnidad } from './hechos.ts';
import { fields, id, text } from './schema.ts';
import type { StudyStore } from './store.ts';
import { StudyError, type StudyUnit } from './types.ts';

/** Escritura de los hechos del ciclo (ADR 0004). Cada hecho se añade con la fecha del momento; nada se reescribe. */
export interface CicloService {
  /** El volcado inicial de una unidad. Es «lo que sabía antes»: se escribe una vez y no se cambia. */
  guardarVolcado(input: unknown): HechosUnidad;
  /** El que pidió el sondeador en una conversación: se guarda solo si la unidad aún no tiene volcado. */
  volcadoDelSondeo(unitId: string, texto: string, chatId: string): boolean;
  /** Se cerró el lector de una fuente de la unidad con capturas nuevas. */
  registrarFuenteTrabajada(input: unknown): HechosUnidad;
  /** Se cerró un bloque de trabajo sobre la unidad. */
  registrarCierreBloque(input: unknown, chatId?: string | null): HechosUnidad;
  hechos(unitId: string): HechoCiclo[];
}

export function createCiclo(store: StudyStore, now: () => string): CicloService {
  function unidad(unitId: string): StudyUnit {
    const unit = store.getUnit(unitId);
    if (!unit) throw new StudyError('NOT_FOUND', 'La unidad no existe');
    if (unit.status === 'archivada') throw new StudyError('INVALID_TRANSITION', 'La unidad está archivada');
    return unit;
  }

  function anadir(unitId: string, hecho: HechoCiclo): HechosUnidad {
    const actual = store.getHechos(unitId);
    const revision = actual?.revision ?? null;
    return store.saveHechos({ id: unitId, revision: (revision ?? 0) + 1, hechos: [...(actual?.hechos ?? []), hecho] }, revision);
  }

  const tieneVolcado = (unitId: string) => volcadoDe(store.getHechos(unitId)?.hechos ?? []) !== null;

  return {
    guardarVolcado(input) {
      const r = fields(input, ['unitId', 'texto'], 'input');
      const unit = unidad(id(r.unitId, 'input.unitId'));
      const texto = text(r.texto, VOLCADO_MAX, 'input.texto', { required: true }).trim();
      if (tieneVolcado(unit.id)) throw new StudyError('INVALID_TRANSITION', 'La unidad ya tiene volcado inicial: es lo que sabías antes y no se cambia');
      return anadir(unit.id, { tipo: 'volcado', fecha: now(), texto, origen: 'pagina', chatId: null });
    },

    volcadoDelSondeo(unitId, texto, chatId) {
      const unit = store.getUnit(unitId);
      const limpio = texto.trim().slice(0, VOLCADO_MAX);
      if (!unit || unit.status === 'archivada' || limpio === '' || tieneVolcado(unitId)) return false;
      anadir(unitId, { tipo: 'volcado', fecha: now(), texto: limpio, origen: 'sondeo', chatId });
      return true;
    },

    registrarFuenteTrabajada(input) {
      const r = fields(input, ['unitId', 'documentId', 'capturas'], 'input');
      const unit = unidad(id(r.unitId, 'input.unitId'));
      const documentoId = id(r.documentId, 'input.documentId');
      // Solo una fuente de la unidad: el lector se abre desde ella (spec, historias 28 y 29).
      if (!unit.sources.some(s => s.path === DOCUMENT_PREFIX + documentoId)) throw new StudyError('INVALID_TRANSITION', 'El documento no es una fuente de esta unidad');
      return anadir(unit.id, { tipo: 'fuente-trabajada', fecha: now(), documentoId, capturas: capturas(r.capturas, 'input.capturas') });
    },

    registrarCierreBloque(input, chatId = null) {
      const r = fields(input, ['unitId'], 'input');
      const unit = unidad(id(r.unitId, 'input.unitId'));
      return anadir(unit.id, { tipo: 'cierre-bloque', fecha: now(), chatId });
    },

    hechos: unitId => store.getHechos(unitId)?.hechos ?? [],
  };
}
