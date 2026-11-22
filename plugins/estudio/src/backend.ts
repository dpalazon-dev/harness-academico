import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PluginBackendContext } from 'learnharness-plugin-api';
import { PROBE_INSTRUCTIONS, STUDY_INSTRUCTIONS, TEACH_INSTRUCTIONS } from './instructions.ts';
import { createOperations } from './operations.ts';
import { createLecturas } from './armazon.ts';
import { leerInicio, leerPorDecidir } from './inicio.ts';
import { createAgenda, createHecho } from './agenda.ts';
import { createRitmo } from './ritmo.ts';
import { createPaleta } from './paleta.ts';
import { createPracticeService } from './practice/service.ts';
import { DOCUMENT_PREFIX } from './practice/prompts.ts';
import { createDocumentService, documentConfig } from './documents/incorporar.ts';
import { fields, id, text } from './study/schema.ts';
import { StudyError, type StudyUnit } from './study/types.ts';
import { kbConfig, openKbRepo } from './kb/repo.ts';
import { createKbService } from './kb/service.ts';
import { createKbSearch } from './kb/corpus.ts';
import { extractProbeDump, extractProbeResults, ingestProbeResults } from './probe.ts';
import { createCiclo } from './study/ciclo.ts';
import { openStudyStore } from './study/store.ts';
import { createAreaService, inArea, type AreaFilter } from './study/areas.ts';
import { createStudyTools } from './tools.ts';
import { createSessionService } from './sessions/service.ts';
import { createContextos } from './sessions/contexto.ts';
import { filasConversaciones } from './sessions/lista.ts';
import { createUploadService } from './documents/subidas.ts';
import { createNotebookService } from './notebooks/service.ts';
import { createAceptacion } from './notebooks/aceptar.ts';
import { createMargen } from './notebooks/margen.ts';
import { createLibro } from './notebooks/libro-proactivo.ts';
import { createPersonajes } from './notebooks/personajes.ts';
import { documentLinks, removeDocument } from './documents/borrar.ts';

export { CHANGED_TOPIC } from './topics.ts';
import { CHANGED_TOPIC } from './topics.ts';
const TIME_ZONE = 'Europe/Madrid';
/** Characters of source text handed to the model per task. */
const EXCERPT_MAX = 12000;

export async function activate(ctx: PluginBackendContext): Promise<() => Promise<void>> {
  if (ctx.signal.aborted) throw new Error('Estudio se desactivó mientras arrancaba.');
  const now = () => new Date().toISOString();
  const study = openStudyStore(path.join(ctx.dataDirectory, 'study'));
  const ops = createOperations(study, now);
  const ciclo = createCiclo(study, now);
  const areas = createAreaService(study, now, randomUUID);
  /** What every view shows: the active space, or everything («Todos»). */
  const filter = () => areas.activeId();
  let disposed = false;
  let invalidateSearch = () => {};
  const changed = () => { invalidateSearch(); if (!disposed && !ctx.signal.aborted) ctx.events.emit(CHANGED_TOPIC); };
  const docConfig = documentConfig();
  const documents = createDocumentService(study, { config: docConfig, now, newId: randomUUID, signal: ctx.signal, onChange: changed, area: filter });
  const sourceExcerpt = (unit: StudyUnit): string | null => {
    const parts = unit.sources.filter(s => s.path.startsWith(DOCUMENT_PREFIX))
      .map(s => documents.excerpt(s.path.slice(DOCUMENT_PREFIX.length), s.locator, EXCERPT_MAX))
      .filter((x): x is string => !!x);
    return parts.length > 0 ? parts.join('\n\n').slice(0, EXCERPT_MAX) : null;
  };
  // The knowledge base is opened lazily: nothing is created on disk until David uses it.
  const kbRepo = openKbRepo(kbConfig(), now);
  const kb = createKbService(study, kbRepo, documents, now);
  const practice = createPracticeService(study, { inference: ctx.inference, now, newId: randomUUID, timeZone: TIME_ZONE, signal: ctx.signal, sourceExcerpt });
  const kbRecords = () => { try { return kbRepo.list(); } catch { return []; } };
  const libraryDir = path.join(ctx.dataDirectory, 'biblioteca');
  const uploads = createUploadService({
    partsDir: path.join(ctx.dataDirectory, 'subidas'), libraryDir, newId: randomUUID,
    incorporate: (file, title) => documents.incorporate({ path: file, title }),
  });
  const sessions = createSessionService({ store: study, learning: ctx.learning, inference: ctx.inference, today: f => practice.today(f), area: () => areas.active(), kbRecords, now, signal: ctx.signal, onChange: () => changed() });
  const lecturas = createLecturas(study, { now, timeZone: TIME_ZONE, conversaciones: f => sessions.list(f), planActual: f => ops.currentPlan(f) });
  // La agenda del inicio (ticket 05 de la segunda ronda): por día, lo hecho y lo pendiente del espacio activo.
  const fuentesAgenda = {
    store: study, sesiones: () => ctx.learning.listSessions(), sesion: (chatId: string) => ctx.learning.getSession(chatId),
    hoy: (f: AreaFilter) => practice.today(f), ruta: (f: AreaFilter) => practice.overview(f), pasos: (f: AreaFilter) => lecturas.pasos(f), now, timeZone: TIME_ZONE,
  };
  const hecho = createHecho(fuentesAgenda);
  const agenda = createAgenda(fuentesAgenda, hecho);
  // El ritmo (ticket 06 de la segunda ronda), con la misma definición de día estudiado que la agenda.
  const ritmo = createRitmo({ hecho, trazas: f => practice.progress(f).units.map(u => [...u.trace].reverse()), now, timeZone: TIME_ZONE });
  const contexto = createContextos({ store: study, lecturas, espacioActivo: filter, registrar: (chatId, vinculo) => sessions.register(chatId, vinculo) });
  const notebooks = createNotebookService(study, { now, newId: randomUUID, area: filter });
  const kbSearch = createKbSearch({
    records: () => kbRepo.list(), documents: () => study.listDocuments(), almacen: docConfig.almacen,
    conversations: () => sessions.searchDocs(), notebooks: () => notebooks.searchDocs(),
  });
  invalidateSearch = () => kbSearch.invalidate();
  const personajes = createPersonajes(ctx.dataDirectory);
  const margen = createMargen(study, { inference: ctx.inference, signal: ctx.signal, now, newId: randomUUID, buscar: q => kbSearch.search(q, { k: 8 }), libro: createLibro(ctx.dataDirectory, { now, timeZone: TIME_ZONE }), personajes });
  // Las propuestas del margen (ticket 12d): aceptar crea el bloque o el borrador, descartar no deja rastro.
  const aceptacion = createAceptacion(study, { kb, now, newId: randomUUID });
  const paleta = createPaleta({
    search: (q, o) => kbSearch.search(q, o), store: study, conversaciones: f => sessions.list(f),
    registro: recordId => { try { return kbRepo.get(recordId)?.header ?? null; } catch { return null; } },
  });

  const assertActive = () => { if (disposed || ctx.signal.aborted) throw new Error('Estudio está desactivado.'); };
  const write = <T>(fn: (input: unknown) => T) => (input: unknown) => { assertActive(); const result = fn(input); changed(); return result; };
  const writeAsync = <T>(fn: (input: unknown) => Promise<T>) => async (input: unknown) => { assertActive(); const result = await fn(input); changed(); return result; };

  const searchInput = (input: unknown) => {
    const r = fields(input, ['consulta', 'entidad', 'tipos', 'k'], 'input');
    const consulta = typeof r.consulta === 'string' ? r.consulta.slice(0, 1000) : '';
    if (consulta.trim() === '' && typeof r.entidad !== 'string') throw new StudyError('INVALID_INPUT', 'Escribe una consulta o elige una entidad');
    return kbSearch.search(consulta, {
      ...(typeof r.entidad === 'string' ? { entidad: r.entidad } : {}),
      ...(Array.isArray(r.tipos) ? { tipos: r.tipos.filter((x): x is string => typeof x === 'string') } : {}),
      ...(Number.isSafeInteger(r.k) ? { k: r.k as number } : {}),
    });
  };

  const unregister = [
    ctx.handle('espacios', () => { assertActive(); return areas.view(); }),
    ctx.handle('crear-espacio', write(areas.create)),
    ctx.handle('editar-espacio', write(areas.edit)),
    ctx.handle('activar-espacio', write(areas.activate)),
    ctx.handle('mover-a-espacio', write(areas.move)),
    ctx.handle('traer-sin-espacio', write(() => areas.adopt(ctx.learning.listSessions().filter(s => s.messageCount > 0).map(s => s.id)))),
    ctx.handle('estado', () => { assertActive(); return ops.state(filter()); }),
    ctx.handle('plan', () => { assertActive(); return lecturas.plan(filter()); }),
    ctx.handle('inicio', () => {
      assertActive();
      return leerInicio({
        lecturas, estado: f => ops.state(f), planActual: f => ops.currentPlan(f), hoy: f => practice.today(f), ruta: f => practice.overview(f),
        conversaciones: f => sessions.list(f), now, timeZone: TIME_ZONE,
      }, filter());
    }),
    ctx.handle('por-decidir', () => {
      assertActive();
      return leerPorDecidir({ estado: f => ops.state(f), planActual: f => ops.currentPlan(f), borradores: () => kb.drafts(), caducidad: ops.staleReason }, filter());
    }),
    ctx.handle('agenda', input => { assertActive(); return agenda(input, filter()); }),
    ctx.handle('ritmo', () => { assertActive(); return ritmo(filter()); }),
    ctx.handle('unidad', input => { assertActive(); return lecturas.unidad(id(fields(input, ['id'], 'input').id, 'input.id'), filter()); }),
    // Hechos del ciclo (ADR 0004): el volcado desde la página de unidad; la fuente trabajada, al cerrar el lector.
    ctx.handle('guardar-volcado', write(ciclo.guardarVolcado)),
    ctx.handle('registrar-fuente-trabajada', write(ciclo.registrarFuenteTrabajada)),
    ctx.handle('registrar-cierre-bloque', write(input => ciclo.registrarCierreBloque(input))),
    ctx.handle('crear-plan', write(input => ops.createPlan(input, filter()))),
    ctx.handle('crear-unidad', write(input => ops.createUnit(input, undefined, undefined, filter()))),
    ctx.handle('editar-unidad', write(ops.editUnit)),
    ctx.handle('confirmar-unidad', write(ops.confirmUnit)),
    ctx.handle('archivar-unidad', write(ops.archiveUnit)),
    ctx.handle('proponer-cambio', write(input => ops.proposePlanChange(input, 'david', filter()))),
    ctx.handle('aplicar-propuesta', input => {
      assertActive();
      try { return ops.applyProposal(input); } finally { changed(); }
    }),
    ctx.handle('rechazar-propuesta', write(ops.rejectProposal)),
    ctx.handle('hoy', () => { assertActive(); return practice.today(filter()); }),
    ctx.handle('ruta', () => { assertActive(); return practice.overview(filter()); }),
    ctx.handle('progreso', () => { assertActive(); return practice.progress(filter()); }),
    ctx.handle('pagina', input => { assertActive(); return documents.page(input); }),
    ctx.handle('documento-vinculos', input => { assertActive(); return documentLinks(study, id(fields(input, ['id'], 'input').id, 'input.id')); }),
    ctx.handle('borrar-documento', write(input => removeDocument(study, input, { libraryDir, now }))),
    ctx.handle('cuadernos', () => { assertActive(); const f = filter(); return notebooks.list().filter(n => inArea(n, f)); }),
    ctx.handle('crear-cuaderno', write(notebooks.create)),
    // Saving is frequent while David writes: it refreshes search, but does not make every open view re-read the state.
    ctx.handle('guardar-cuaderno', input => { assertActive(); const nb = notebooks.save(input); invalidateSearch(); return nb; }),
    // Margin (ticket 12b): the tutor comments on a fragment on request; the comment lives in the notebook, never in the page.
    ctx.handle('comentar-cuaderno', writeAsync(margen.comentar)),
    ctx.handle('descartar-comentario', write(margen.descartar)),
    // Threads (ticket 12c): David writes, the tutor answers in a second call so a failed answer can be asked again.
    ctx.handle('responder-comentario', write(margen.responder)),
    ctx.handle('contestar-comentario', writeAsync(margen.contestar)),
    ctx.handle('atender-comentario', write(margen.atender)),
    // Dibujos (ticket 12h): «Dibújalo» es `comentar-cuaderno` con kind «dibujo»; pedirlo en un hilo es `contestar-comentario`. Esto solo quita uno.
    ctx.handle('quitar-dibujo', write(margen.quitarDibujo)),
    ctx.handle('aceptar-propuesta', writeAsync(aceptacion.aceptar)),
    ctx.handle('descartar-propuesta', writeAsync(aceptacion.descartar)),
    // El modo proactivo (ticket 12e): el tutor lee y comenta solo. El interruptor, la lectura de un párrafo y el tope diario.
    ctx.handle('modo-cuaderno', writeAsync(margen.modo)),
    // El propósito y la tinta del cuaderno (ticket 12f); «Solo escucha» toca el modo.
    ctx.handle('proposito-cuaderno', writeAsync(margen.fijarProposito)),
    // Los personajes (ticket 12g): la lista, crear o editar uno propio, borrarlo, y el que comenta solo en un cuaderno.
    ctx.handle('personajes', async () => { assertActive(); return personajes.lista(); }),
    ctx.handle('guardar-personaje', async input => { assertActive(); const p = personajes.guardar(input); changed(); return p; }),
    ctx.handle('borrar-personaje', async input => { assertActive(); personajes.borrar(input); changed(); return null; }),
    ctx.handle('persona-cuaderno', write(margen.fijarPersona)),
    ctx.handle('lectura-proactiva', writeAsync(margen.leer)),
    ctx.handle('estado-proactivo', async () => { assertActive(); return margen.estado(); }),
    ctx.handle('tope-proactivo', async input => { assertActive(); return margen.fijarTope(input); }),
    ctx.handle('borrar-cuaderno', write(input => { notebooks.trash(input); return null; })),
    ctx.handle('anotar-pasaje', write(notebooks.notePassage)),
    ctx.handle('exportar-markdown', input => { assertActive(); return notebooks.markdown(input); }),
    ctx.handle('exportar-anki', input => { assertActive(); const f = filter(); return notebooks.anki(input, n => inArea(n, f)); }),
    ctx.handle('practicar-pregunta', writeAsync(async input => {
      const r = fields(input, ['notebookId', 'blockId', 'confidence'], 'input');
      const q = notebooks.question({ notebookId: r.notebookId, blockId: r.blockId });
      return practice.startOwn({ unitId: q.unitId, confidence: r.confidence, question: q.question, answer: q.answer });
    })),
    ctx.handle('subir-inicio', input => { assertActive(); return uploads.start(input); }),
    ctx.handle('subir-trozo', input => { assertActive(); return uploads.chunk(input); }),
    ctx.handle('subir-fin', write(uploads.finish)),
    ctx.handle('subir-cancelar', input => { assertActive(); uploads.cancel(input); return null; }),
    ctx.handle('intento', input => {
      assertActive();
      const shown = practice.attempt(input);
      return { ...shown, titulo: study.getUnit(shown.attempt.unitId)?.title ?? shown.attempt.unitId };
    }),
    ctx.handle('empezar', writeAsync(practice.start)),
    ctx.handle('pista', write(practice.cue)),
    ctx.handle('abrir-fuente', writeAsync(practice.openSource)),
    ctx.handle('guardar-respuesta', input => { assertActive(); return practice.saveAnswer(input); }),
    ctx.handle('congelar', writeAsync(practice.freeze)),
    ctx.handle('autoevaluar', write(practice.grade)),
    ctx.handle('abandonar', write(practice.abandon)),
    ctx.handle('documentos', () => { assertActive(); const f = filter(); return documents.list().filter(d => inArea(d, f)); }),
    ctx.handle('documento', input => { assertActive(); return documents.detail(input); }),
    ctx.handle('incorporar-documento', write(documents.incorporate)),
    ctx.handle('verificar-cita', input => { assertActive(); return documents.verify(input); }),
    ctx.handle('vincular-documento', write(input => {
      const r = fields(input, ['unitId', 'expectedRevision', 'documentId', 'locator'], 'input');
      const documentId = id(r.documentId, 'input.documentId');
      if (study.getDocument(documentId)?.status !== 'listo') throw new StudyError('INVALID_TRANSITION', 'Solo se vinculan documentos ya incorporados');
      if (typeof r.locator === 'string' && r.locator.trim() !== '') documents.checkLocator(documentId, r.locator);
      const source = r.locator === undefined || r.locator === '' ? { path: DOCUMENT_PREFIX + documentId } : { path: DOCUMENT_PREFIX + documentId, locator: r.locator };
      return ops.addSource(r.unitId as string, r.expectedRevision, source);
    })),
    ctx.handle('kb-registrar-documento', writeAsync(kb.registerDocument)),
    ctx.handle('kb-capturar-hecho', writeAsync(input => kb.captureFact(input, 'david'))),
    ctx.handle('kb-pregunta', writeAsync(input => kb.addQuestion(input, 'david'))),
    ctx.handle('kb-sintesis', writeAsync(input => kb.addSynthesis(input, 'david'))),
    ctx.handle('kb-entidades', () => { assertActive(); return kb.entities(); }),
    // ⌘K (ticket 08): la misma búsqueda, agrupada por tipo, con su destino y filtrada por el espacio activo.
    ctx.handle('paleta', input => { assertActive(); return paleta(input, filter()); }),
    ctx.handle('kb-confirmar', writeAsync(kb.confirm)),
    ctx.handle('kb-descartar', writeAsync(kb.discard)),
    // La creación de conversaciones del núcleo la llama con el id de la conversación nueva (ADR 0003).
    ctx.handle('contexto-conversacion', write(contexto)),
    ctx.handle('conversaciones', () => { assertActive(); return filasConversaciones(sessions.list(filter()), study, f => ops.currentPlan(f)); }),
    ctx.handle('resumir-conversacion', writeAsync(input => sessions.summarizeNow(id(fields(input, ['chatId'], 'input').chatId, 'input.chatId')))),
    ctx.registerInstructions({ agents: ['prober', 'teacher'], text: STUDY_INSTRUCTIONS }),
    ctx.registerInstructions({ agents: ['prober'], text: PROBE_INSTRUCTIONS }),
    ctx.registerInstructions({ agents: ['teacher'], text: TEACH_INSTRUCTIONS }),
    ctx.registerInstructions({ agents: ['prober', 'teacher'], text: context => sessions.briefingFor(context) }),
    ctx.registerTools({
      agents: ['prober', 'teacher'],
      create: context => createStudyTools(ops, context, assertActive, kb, searchInput, () => areas.forChat(context.chatId), {
        registrar: (unitId, chatId) => ciclo.registrarCierreBloque({ unitId }, chatId),
        unidad: () => study.getConversation(context.chatId)?.unitId ?? null,
      }).map(tool => {
        const execute = tool.execute;
        return { ...tool, execute: async (...args: Parameters<typeof execute>) => { const result = await execute(...args); changed(); return result; } };
      }),
    }),
    // Borrar una conversación en el núcleo solo avisa de que la lista cambió: su registro, con el vínculo a la
    // unidad (ticket 03), va a la papelera de Estudio para que nada apunte a ella (ticket 12).
    ctx.events.on(event => {
      if (event.type !== 'chats-changed' || disposed) return;
      invalidateSearch();
      if (sessions.forgetDeleted()) changed();
    }),
    ctx.events.on(event => {
      if (event.type !== 'turn-settled' || disposed) return;
      sessions.onTurnSettled(event.chatId);
      invalidateSearch();
      const record = ctx.learning.getSession(event.chatId);
      if (!record) return;
      const created = ingestProbeResults(study, extractProbeResults(record), now(), chatId => areas.forChat(chatId));
      const dump = extractProbeDump(record);
      const dumped = dump !== null && ciclo.volcadoDelSondeo(dump.unitId, dump.texto, event.chatId);
      const exposed = practice.recordSessionExposure(event.chatId);
      if (created.length > 0 || dumped || exposed > 0) changed();
    }),
  ];

  // Lo borrado mientras Estudio no estaba activo.
  sessions.forgetDeleted();
  sessions.catchUp();

  return async () => {
    disposed = true;
    sessions.dispose();
    for (const off of unregister) off();
  };
}
