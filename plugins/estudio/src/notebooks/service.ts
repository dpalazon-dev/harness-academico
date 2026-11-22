import type { SearchDoc } from '../kb/search.ts';
import { fields, id, text } from '../study/schema.ts';
import type { StudyStore } from '../study/store.ts';
import { StudyError } from '../study/types.ts';
import { ankiExport, deduceNote, MAX_BLOCKS, MAX_TEXT, MAX_TITLE, NOTEBOOK_KINDS, notebookMarkdown, notebookSearchText, parseBlock, type Block, type Notebook, type NotebookKind } from './types.ts';

export interface NotebookService {
  list(): Notebook[];
  create(input: unknown): Notebook;
  save(input: unknown): Notebook;
  trash(input: unknown): void;
  /** Appends a passage from the reader to the source note of its document, creating that note if needed. */
  notePassage(input: unknown): Notebook;
  markdown(input: unknown): { filename: string; text: string };
  /** Sin id, las preguntas de todos los cuadernos que `incluir` acepte (los del espacio activo). */
  anki(input: unknown, incluir?: (nb: Notebook) => boolean): { filename: string; text: string; count: number };
  /** The question and answer of a retrieval block, and the unit it is practised for. */
  question(input: unknown): { unitId: string; question: string; answer: string };
  searchDocs(): SearchDoc[];
}

export interface NotebookOptions {
  now: () => string; newId: () => string;
  /** Space a new notebook belongs to: the active one. */
  area?: () => string | null;
}

const fileName = (title: string, ext: string) => `${title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80) || 'cuaderno'}.${ext}`;

/** The limits David can reach by pasting or writing a lot, said in Spanish before the schema (in English, for the model and for
 * programmers) can refuse the page. */
function limitesDeLaPagina(title: unknown, blocks: unknown[]): void {
  const demasiado = (que: string, max: number) => new StudyError('INVALID_INPUT', `${que} admite hasta ${max} caracteres: ${que === 'El título' ? 'acórtalo' : 'divídelo en varios'}`);
  if (typeof title === 'string' && title.length > MAX_TITLE) throw demasiado('El título', MAX_TITLE);
  if (blocks.length > MAX_BLOCKS) throw new StudyError('INVALID_INPUT', `Un cuaderno admite hasta ${MAX_BLOCKS} bloques: pasa parte del texto a otro cuaderno`);
  for (const b of blocks) {
    for (const valor of Object.values((b ?? {}) as Record<string, unknown>)) {
      if (typeof valor === 'string' && valor.length > MAX_TEXT) throw demasiado('Un párrafo', MAX_TEXT);
    }
  }
}

export function createNotebookService(store: StudyStore, { now, newId, area = () => null }: NotebookOptions): NotebookService {
  function get(notebookId: string): Notebook {
    const nb = store.getNotebook(notebookId);
    if (!nb) throw new StudyError('NOT_FOUND', 'El cuaderno no existe');
    return nb;
  }

  function links(unitId: unknown, documentId: unknown): { unitId: string | null; documentId: string | null } {
    const unit = unitId === null || unitId === undefined || unitId === '' ? null : id(unitId, 'input.unitId');
    const document = documentId === null || documentId === undefined || documentId === '' ? null : id(documentId, 'input.documentId');
    if (unit && !store.getUnit(unit)) throw new StudyError('NOT_FOUND', 'La unidad no existe');
    if (document && !store.getDocument(document)) throw new StudyError('NOT_FOUND', 'El documento no existe');
    return { unitId: unit, documentId: document };
  }

  function kind(value: unknown): NotebookKind {
    if (!NOTEBOOK_KINDS.includes(value as NotebookKind)) throw new StudyError('INVALID_INPUT', 'Tipo de cuaderno no válido');
    return value as NotebookKind;
  }

  return {
    list: () => store.listNotebooks().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),

    create(input) {
      const r = fields(input, ['title', 'kind', 'unitId', 'documentId'], 'input');
      const at = now();
      const vinculos = links(r.unitId, r.documentId);
      // Nacido de una unidad, es del espacio de la unidad, como la nota de fuente de un pasaje; si no, del espacio activo.
      const areaId = (vinculos.unitId ? store.getUnit(vinculos.unitId)?.areaId : null) ?? area();
      return store.saveNotebook({
        id: newId(), revision: 1, title: text(r.title, 300, 'input.title', { required: true }).trim(), kind: kind(r.kind ?? 'libre'),
        ...vinculos, blocks: [], createdAt: at, updatedAt: at, areaId,
      }, null);
    },

    save(input) {
      const r = fields(input, ['id', 'expectedRevision', 'title', 'kind', 'unitId', 'documentId', 'blocks'], 'input');
      const current = get(id(r.id, 'input.id'));
      if (!Number.isSafeInteger(r.expectedRevision)) throw new StudyError('INVALID_INPUT', 'expectedRevision must be an integer');
      if (!Array.isArray(r.blocks)) throw new StudyError('INVALID_INPUT', 'blocks must be a list');
      limitesDeLaPagina(r.title, r.blocks);
      // A note typed on the page carries its symbol at the start of the text; it is separated here. A note that did not
      // change keeps what it had, so an old one without symbol whose text happens to start like one is not rewritten.
      const before = new Map(current.blocks.map(b => [b.id, b]));
      const blocks = r.blocks.map((b, i) => parseBlock(b, `input.blocks[${i}]`)).map((b): Block => {
        if (b.kind !== 'nota' || b.symbol !== null) return b;
        const prev = before.get(b.id);
        return prev?.kind === 'nota' && prev.text === b.text ? b : { ...b, ...deduceNote(b.text) };
      });
      return store.saveNotebook({
        ...current, revision: (r.expectedRevision as number) + 1, title: text(r.title, 300, 'input.title', { required: true }).trim(), kind: kind(r.kind),
        ...links(r.unitId, r.documentId), blocks, updatedAt: now(),
      }, r.expectedRevision as number);
    },

    trash(input) {
      const r = fields(input, ['id', 'expectedRevision'], 'input');
      if (!Number.isSafeInteger(r.expectedRevision)) throw new StudyError('INVALID_INPUT', 'expectedRevision must be an integer');
      store.trashNotebook(id(r.id, 'input.id'), r.expectedRevision as number);
    },

    notePassage(input) {
      const r = fields(input, ['documentId', 'page', 'quote', 'unitId'], 'input');
      const { unitId, documentId } = links(r.unitId, r.documentId);
      const doc = documentId ? store.getDocument(documentId) : null;
      if (!doc || !documentId) throw new StudyError('NOT_FOUND', 'El documento no existe');
      if (!Number.isSafeInteger(r.page) || (r.page as number) < 1) throw new StudyError('INVALID_INPUT', 'page must be a positive integer');
      const quote = text(r.quote, 4000, 'input.quote', { required: true }).trim();
      const at = now();
      // Read from a unit, the passage goes to that unit's note of this source, so it shows on the unit's page;
      // read from the library, to the source note that belongs to no unit.
      const existing = store.listNotebooks().filter(n => n.kind === 'fuente' && n.documentId === documentId && n.unitId === unitId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      const nb = existing ?? store.saveNotebook({ id: newId(), revision: 1, title: doc.title, kind: 'fuente', unitId, documentId, blocks: [], createdAt: at, updatedAt: at, areaId: (unitId ? store.getUnit(unitId)?.areaId : null) ?? doc.areaId ?? area() }, null);
      // The block starts with the quote and its page; what it means is for David to write.
      const block = { id: newId(), kind: 'nota' as const, symbol: null, text: '', locator: `p. ${r.page as number}`, quote };
      return store.saveNotebook({ ...nb, revision: nb.revision + 1, blocks: [...nb.blocks, block], updatedAt: at }, nb.revision);
    },

    markdown(input) {
      const nb = get(id(fields(input, ['id'], 'input').id, 'input.id'));
      const unit = nb.unitId ? store.getUnit(nb.unitId)?.title : undefined;
      const document = nb.documentId ? store.getDocument(nb.documentId)?.title : undefined;
      return { filename: fileName(nb.title, 'md'), text: notebookMarkdown(nb, { ...(unit ? { unit } : {}), ...(document ? { document } : {}) }) };
    },

    anki(input, incluir = () => true) {
      const r = fields(input ?? {}, ['id'], 'input');
      const notebooks = r.id === undefined ? store.listNotebooks().filter(incluir) : [get(id(r.id, 'input.id'))];
      const out = ankiExport(notebooks);
      return { filename: fileName(notebooks.length === 1 ? notebooks[0]!.title : 'estudio-preguntas', 'txt'), ...out };
    },

    question(input) {
      const r = fields(input, ['notebookId', 'blockId'], 'input');
      const nb = get(id(r.notebookId, 'input.notebookId'));
      const block = nb.blocks.find(b => b.id === r.blockId);
      if (!block || block.kind !== 'recuperacion') throw new StudyError('NOT_FOUND', 'La pregunta no existe');
      if (!block.question.trim() || !block.answer.trim()) throw new StudyError('INVALID_INPUT', 'Escribe la pregunta y tu respuesta antes de practicarla');
      if (!nb.unitId) throw new StudyError('INVALID_TRANSITION', 'Vincula el cuaderno a una unidad para practicar sus preguntas');
      return { unitId: nb.unitId, question: block.question, answer: block.answer };
    },

    searchDocs() {
      return store.listNotebooks().map(nb => ({
        id: `cuaderno:${nb.id}`, kind: 'nota', title: nb.title, text: notebookSearchText(nb),
        links: [nb.unitId, nb.documentId].filter((x): x is string => !!x),
      }));
    },
  };
}
