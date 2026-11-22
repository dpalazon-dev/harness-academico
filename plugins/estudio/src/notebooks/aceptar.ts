import type { KbService } from '../kb/service.ts';
import { fields, id } from '../study/schema.ts';
import type { StudyStore } from '../study/store.ts';
import { StudyError } from '../study/types.ts';
import { MAX_BLOCKS, type Comment, type Notebook, type Propuesta } from './types.ts';

/* David's two answers to a proposal of the margin (ticket 12d). Nothing the tutor offers happens before one of them, and each
 * happens once: a second click, two at once, or a comment that moved meanwhile never duplicates a block or a draft. */

export interface Aceptacion {
  /** The offer becomes real: a retrieval question is a block of his page right after the paragraph; a fact is a KBOL draft with
   * origin tutor, waiting in «Por decidir». Accepting what is already accepted changes nothing. */
  aceptar(input: unknown): Promise<Notebook>;
  /** The offer is dropped and leaves no trace outside the comment. Discarding what is already discarded changes nothing. */
  descartar(input: unknown): Promise<Notebook>;
}

export interface AceptacionOptions { kb: Pick<KbService, 'captureFact'>; now: () => string; newId: () => string }

export function createAceptacion(store: StudyStore, { kb, now, newId }: AceptacionOptions): Aceptacion {
  const get = (notebookId: string): Notebook => {
    const nb = store.getNotebook(notebookId);
    if (!nb) throw new StudyError('NOT_FOUND', 'El cuaderno no existe');
    return nb;
  };

  function buscar(nb: Notebook, commentId: string, propuestaId: string): { comment: Comment; propuesta: Propuesta } {
    const comment = nb.comments?.find(c => c.id === commentId);
    if (!comment) throw new StudyError('NOT_FOUND', 'El comentario no existe');
    const propuesta = comment.propuestas?.find(p => p.id === propuestaId);
    if (!propuesta) throw new StudyError('NOT_FOUND', 'La propuesta no existe');
    return { comment, propuesta };
  }

  /** The comment with one proposal replaced; the rest of the notebook is carried over as it is. */
  const con = (nb: Notebook, comment: Comment, propuesta: Propuesta, blocks: Notebook['blocks'] = nb.blocks): Notebook =>
    store.saveNotebook({
      ...nb, blocks, revision: nb.revision + 1, updatedAt: now(),
      comments: (nb.comments ?? []).map(c => (c.id === comment.id ? { ...c, propuestas: (c.propuestas ?? []).map(p => (p.id === propuesta.id ? propuesta : p)) } : c)),
    }, nb.revision);

  const decisiones = new Map<string, Promise<Notebook>>();

  async function decidir(input: unknown, accion: 'aceptar' | 'descartar'): Promise<Notebook> {
    const r = fields(input, ['id', 'commentId', 'propuestaId'], 'input');
    const notebookId = id(r.id, 'input.id');
    const commentId = id(r.commentId, 'input.commentId');
    const propuestaId = id(r.propuestaId, 'input.propuestaId');
    const clave = JSON.stringify([notebookId, commentId, propuestaId]);

    async function aplicar(): Promise<Notebook> {
      const nb = get(notebookId);
      const { comment, propuesta } = buscar(nb, commentId, propuestaId);
      if (accion === 'descartar') {
        if (propuesta.estado === 'descartada') return nb;
        if (propuesta.estado === 'aceptada') throw new StudyError('INVALID_INPUT', 'La propuesta ya se aceptó: lo que creó se decide donde está (la página o «Por decidir»)');
        return con(nb, comment, { ...propuesta, estado: 'descartada' });
      }
      if (comment.state === 'descartado') throw new StudyError('INVALID_INPUT', 'El comentario está descartado');
      if (propuesta.tipo === 'conexion') throw new StudyError('INVALID_INPUT', 'Una conexión no se acepta: se abre');
      if (propuesta.estado === 'aceptada') return nb;
      if (propuesta.estado === 'descartada') throw new StudyError('INVALID_INPUT', 'La propuesta ya se descartó');
      if (propuesta.tipo === 'hecho') {
        const draft = await kb.captureFact({ documentId: propuesta.documentId, page: propuesta.pagina, quote: propuesta.cita, afirmacion: propuesta.afirmacion }, 'tutor');
        // Other proposals and the page can still change during citation verification.
        const current = get(notebookId);
        const { comment: updated } = buscar(current, commentId, propuestaId);
        return con(current, updated, { ...propuesta, estado: 'aceptada', borradorId: draft.id });
      }

      const at = nb.blocks.findIndex(b => b.id === comment.anchor.blockId);
      if (at === -1) throw new StudyError('NOT_FOUND', 'El párrafo de este comentario ya no está en la página: no hay dónde insertar la pregunta');
      if (nb.blocks.length >= MAX_BLOCKS) throw new StudyError('INVALID_INPUT', `Un cuaderno admite hasta ${MAX_BLOCKS} bloques: pasa parte del texto a otro cuaderno`);
      const bloque = { id: newId(), kind: 'recuperacion' as const, question: propuesta.pregunta, answer: propuesta.respuesta };
      return con(nb, comment, { ...propuesta, estado: 'aceptada', bloqueId: bloque.id }, [...nb.blocks.slice(0, at + 1), bloque, ...nb.blocks.slice(at + 1)]);
    }

    const anterior = decisiones.get(clave);
    const trabajo = anterior ? anterior.then(aplicar, aplicar) : aplicar();
    decisiones.set(clave, trabajo);
    try {
      return await trabajo;
    } finally {
      if (decisiones.get(clave) === trabajo) decisiones.delete(clave);
    }
  }

  return { aceptar: input => decidir(input, 'aceptar'), descartar: input => decidir(input, 'descartar') };
}
