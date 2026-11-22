import fs from 'node:fs';
import path from 'node:path';
import { DOCUMENT_PREFIX } from '../practice/prompts.ts';
import { fields, id } from '../study/schema.ts';
import type { StudyStore } from '../study/store.ts';
import { StudyError } from '../study/types.ts';

export interface DocumentLinks { units: { id: string; title: string }[]; notebooks: { id: string; title: string }[] }

/** Units that use the document as a source and notebooks attached to it. */
export function documentLinks(store: StudyStore, documentId: string): DocumentLinks {
  const source = DOCUMENT_PREFIX + documentId;
  return {
    units: store.listUnits().filter(u => u.status !== 'archivada' && u.sources.some(s => s.path === source)).map(u => ({ id: u.id, title: u.title })),
    notebooks: store.listNotebooks().filter(n => n.documentId === documentId).map(n => ({ id: n.id, title: n.title })),
  };
}

/** Removes a source from the app. Units stop using it, notebooks keep their notes and quotes without the link, the
 * record and an uploaded PDF go to the trash. The Document Intelligence store is shared with the knowledge base,
 * whose citations resolve against it, so nothing is deleted there. */
export function removeDocument(store: StudyStore, input: unknown, options: { libraryDir: string; now: () => string }): DocumentLinks {
  const r = fields(input, ['id', 'expectedRevision'], 'input');
  const documentId = id(r.id, 'input.id');
  const doc = store.getDocument(documentId);
  if (!doc) throw new StudyError('NOT_FOUND', 'El documento no existe');
  if (doc.status === 'procesando') throw new StudyError('INVALID_TRANSITION', 'Espera a que termine la incorporación para borrarlo');
  if (doc.revision !== r.expectedRevision) throw new StudyError('CONFLICT', 'El documento cambió; vuelve a intentarlo');
  const links = documentLinks(store, documentId);
  const source = DOCUMENT_PREFIX + documentId;
  for (const link of links.units) {
    const unit = store.getUnit(link.id)!;
    store.saveUnit({ ...unit, revision: unit.revision + 1, sources: unit.sources.filter(s => s.path !== source), updatedAt: options.now() }, unit.revision);
  }
  for (const link of links.notebooks) {
    const nb = store.getNotebook(link.id)!;
    store.saveNotebook({ ...nb, revision: nb.revision + 1, documentId: null, updatedAt: options.now() }, nb.revision);
  }
  store.trashDocument(documentId, doc.revision);
  // Only a copy the app made on upload is moved; a PDF incorporated from David's own folders is never touched.
  const library = path.resolve(options.libraryDir);
  const file = path.resolve(doc.path);
  if (path.dirname(file) === library && fs.existsSync(file)) {
    const bin = path.join(library, '.papelera');
    fs.mkdirSync(bin, { recursive: true });
    fs.renameSync(file, path.join(bin, path.basename(file)));
  }
  return links;
}
