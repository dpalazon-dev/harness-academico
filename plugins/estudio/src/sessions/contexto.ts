import type { LecturasArmazon, EstadoGrupo } from '../armazon.ts';
import { fields, id, text } from '../study/schema.ts';
import type { StudyStore } from '../study/store.ts';
import { StudyError } from '../study/types.ts';
import type { Origen } from './types.ts';

/** Conversaciones con contexto (ADR 0003): «Estudiar con el tutor», «Preguntar al tutor» por un pasaje y «Discutir»
 * un intento abren una conversación nueva cuyo primer mensaje lleva ese contexto. El núcleo crea la conversación y
 * escribe el mensaje; aquí se compone su texto y se registra la conversación en su espacio y con su unidad. */

export type TipoContexto = Exclude<Origen, 'libre'>;

/** Lo que el núcleo escribe como mensaje de contexto: `content` lo lee el modelo; `details`, la tarjeta del chat. */
export interface ContextoConversacion {
  content: string;
  details: { tipo: TipoContexto; titulo: string; lineas: string[]; unidadId: string | null };
}

/** Una cita se copia entera hasta este tamaño; el tutor puede leer el resto con estudio_buscar. */
const PASSAGE_MAX = 2000;
const ANSWER_MAX = 4000;
const DUMP_MAX = 8000;
const REFERENCE_MAX = 4000;
const ATTEMPTS = 5;

const GRUPO_EN: Record<EstadoGrupo, string> = { hecho: 'done', pendiente: 'pending', vacio: 'not started' };
const GRUPO_ES: Record<EstadoGrupo, string> = { hecho: 'hecho', pendiente: 'pendiente', vacio: 'sin empezar' };
const INTENTO_ES: Record<string, string> = { open: 'en curso', frozen: 'sin valorar', graded: 'valorado', abandoned: 'abandonado' };

const cut = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}…` : value);
const quoted = (value: string) => value.split('\n').map(line => `> ${line}`);

export interface DepsContexto {
  store: StudyStore;
  lecturas: LecturasArmazon;
  /** El espacio activo, o null con «Todos»: la conversación queda en él cuando su contexto no tiene espacio propio. */
  espacioActivo: () => string | null;
  registrar: (chatId: string, vinculo: { areaId: string | null; unitId: string | null; origen: TipoContexto }) => void;
}

export function createContextos(deps: DepsContexto): (input: unknown) => ContextoConversacion {
  const { store } = deps;

  function unidadActiva(unitId: string) {
    const unit = store.getUnit(unitId);
    if (!unit) throw new StudyError('NOT_FOUND', 'La unidad no existe');
    if (unit.status !== 'activa') throw new StudyError('INVALID_TRANSITION', 'Solo se estudian unidades activas');
    return unit;
  }

  function deUnidad(unitId: string): ContextoConversacion {
    unidadActiva(unitId);
    const u = deps.lecturas.unidad(unitId, null);
    const ciclo = (labels: Record<EstadoGrupo, string>, names: [string, string, string, string]) =>
      [u.ciclo.orientar, u.ciclo.exponer, u.ciclo.reconstruir, u.ciclo.mantener].map((g, i) => `${names[i]} ${labels[g]}`).join('; ');
    const fuentes = u.fuentes.map(f => ({
      en: `«${f.titulo}»: ${f.capturas} note(s) captured${f.capturas > 0 ? (f.reconstruida ? ', reconstructed since' : ', not reconstructed yet') : ''}`,
      es: `«${f.titulo}»: ${f.capturas} nota(s)${f.capturas > 0 ? (f.reconstruida ? ', reconstruida' : ', sin reconstruir') : ''}`,
    }));
    const intentos = u.intentos.slice(0, ATTEMPTS).map(i => ({
      en: `${i.fecha.slice(0, 10)} ${i.tarea}, ${i.estado}${i.fidelidad === null ? '' : `, fidelity ${i.fidelidad}/3`}`,
      es: `${i.fecha.slice(0, 10)} ${i.tarea}, ${INTENTO_ES[i.estado] ?? i.estado}${i.fidelidad === null ? '' : `, fidelidad ${i.fidelidad}/3`}`,
    }));
    const content = [
      `[Study context] — the learner opened this conversation from the unit «${u.titulo}» to study it with you.`,
      ...(u.capacidad ? [`What he wants to be able to do: ${u.capacidad}`] : []),
      ...(u.criterio ? [`How he will know he can: ${u.criterio}`] : []),
      `Stage: ${u.etapa.label}${u.tipo ? ` · knowledge kind: ${u.tipo}` : ''} · practice: ${u.practicaEfectiva}`,
      `Study cycle: ${ciclo(GRUPO_EN, ['orient', 'expose and capture', 'reconstruct and contrast', 'maintain and use'])}.`,
      ...(fuentes.length ? ['Sources:', ...fuentes.map(f => `- ${f.en}`)] : ['No sources linked yet.']),
      ...(intentos.length ? ['Recent attempts, most recent first:', ...intentos.map(i => `- ${i.en}`)] : ['No attempts yet.']),
      ...(u.proximoRepaso ? [`Next review fixed by the regulator: ${u.proximoRepaso}`] : []),
      ...(u.volcado
        ? [`His initial dump for this unit (${u.volcado.fecha.slice(0, 10)}), written by him without AI: what he knew, believed, did not know and wondered before studying it.`, ...quoted(cut(u.volcado.texto, DUMP_MAX))]
        : ['He has not written his initial dump for this unit yet.']),
      '',
      u.volcado
        ? 'Work on this unit unless he asks for something else. Start from his initial dump: do not ask him for it again; open each strand where it shows what he knows, believes wrongly or wonders.'
        : "Work on this unit unless he asks for something else. Once the opening framing is settled, ask for his initial dump with ask_user_question and no options, so he writes freely what he already knows of it, what he believes, what he knows he does not know and the questions he has. His answer is kept as the unit's initial dump.",
    ].join('\n');
    const lineas = [
      ...(u.capacidad ? [`Capacidad: ${u.capacidad}`] : []),
      ...(u.criterio ? [`Criterio: ${u.criterio}`] : []),
      `Etapa: ${u.etapa.label}`,
      `Ciclo: ${ciclo(GRUPO_ES, ['orientar', 'exponer y capturar', 'reconstruir y contrastar', 'mantener y usar'])}`,
      ...fuentes.map(f => `Fuente ${f.es}`),
      ...intentos.map(i => `Intento ${i.es}`),
      ...(u.proximoRepaso ? [`Próximo repaso: ${u.proximoRepaso}`] : []),
      u.volcado ? `Tu volcado inicial: ${cut(u.volcado.texto, 300)}` : 'Sin volcado inicial: el tutor te lo pedirá al empezar.',
    ];
    return { content, details: { tipo: 'unidad', titulo: u.titulo, lineas, unidadId: u.id } };
  }

  function dePasaje(r: Record<string, unknown>): ContextoConversacion & { areaId: string | null } {
    const doc = store.getDocument(id(r.documentId, 'input.documentId'));
    if (!doc || doc.status !== 'listo') throw new StudyError('INVALID_TRANSITION', 'El documento no está disponible');
    if (!Number.isSafeInteger(r.page) || (r.page as number) < 1) throw new StudyError('INVALID_INPUT', 'page must be a positive integer');
    const page = r.page as number;
    const quote = cut(text(r.quote, 8000, 'input.quote', { required: true }).trim(), PASSAGE_MAX);
    const unit = r.unitId === undefined || r.unitId === null ? null : unidadActiva(id(r.unitId, 'input.unitId'));
    const content = [
      `[Study context] — the learner opened this conversation from the reader, about this passage of «${doc.title}», page ${page}:`,
      ...quoted(quote),
      ...(unit ? [`He was reading it while studying the unit «${unit.title}».`] : []),
      '',
      'He wants to talk about this passage. Before explaining, ask what he understands of it in his own words; cite the page when you use it.',
    ].join('\n');
    return {
      content, areaId: unit?.areaId ?? doc.areaId,
      details: { tipo: 'pasaje', titulo: `${doc.title}, p. ${page}`, lineas: [quote, ...(unit ? [`Unidad: ${unit.title}`] : [])], unidadId: unit?.id ?? null },
    };
  }

  function deIntento(attemptId: string): ContextoConversacion & { areaId: string | null } {
    const attempt = store.getAttempt(attemptId);
    if (!attempt) throw new StudyError('NOT_FOUND', 'El intento no existe');
    if (attempt.status !== 'frozen' && attempt.status !== 'graded') throw new StudyError('INVALID_TRANSITION', 'Solo se discute un intento terminado');
    const unit = store.getUnit(attempt.unitId);
    const task = store.getTask(attempt.taskId);
    const title = unit?.title ?? attempt.unitId;
    const answer = cut(attempt.answer.trim(), ANSWER_MAX);
    const judgment = attempt.judgments.at(-1);
    const grade = attempt.grades.at(-1);
    const content = [
      `[Study context] — the learner opened this conversation to discuss a finished retrieval attempt on the unit «${title}» (${(attempt.frozenAt ?? attempt.openedAt).slice(0, 10)}).`,
      ...(task ? [`Task (${task.kind}): ${task.prompt}`] : [`Task kind: ${attempt.taskKind}`]),
      `His answer, frozen before he saw the contrast${attempt.cueLevelAtFreeze === 6 ? ' (he opened the source: not recalled)' : ''}:`,
      ...(answer ? quoted(answer) : ['> (empty)']),
      ...(task ? ['Reference:', ...quoted(cut(task.reference, REFERENCE_MAX)), ...(task.rubric.length ? ['Rubric:', ...task.rubric.map(x => `- ${x}`)] : [])] : []),
      ...(judgment ? [`Model's contrast: fidelity ${judgment.fidelity}/3${judgment.failureType ? `, failure ${judgment.failureType}` : ''}. ${judgment.rationale}`] : []),
      ...(grade ? [`His own grade: fidelity ${grade.fidelity}/3${grade.failureType ? `, failure ${grade.failureType}` : ''}`] : []),
      '',
      'Help him learn from the gap between his answer and the reference. Ask him first what he thinks he missed and why, before explaining.',
    ].join('\n');
    const lineas = [
      ...(task ? [`Tarea: ${task.prompt}`] : []),
      `Tu respuesta: ${answer || '(vacía)'}`,
      ...(judgment ? [`Contraste: fidelidad ${judgment.fidelity}/3. ${judgment.rationale}`] : []),
      ...(grade ? [`Tu valoración: fidelidad ${grade.fidelity}/3`] : []),
    ];
    return { content, areaId: unit?.areaId ?? null, details: { tipo: 'intento', titulo: `Intento sobre ${title}`, lineas, unidadId: attempt.unitId } };
  }

  return input => {
    const r = fields(input, ['chatId', 'tipo', 'unitId', 'documentId', 'page', 'quote', 'attemptId'], 'input');
    const chatId = id(r.chatId, 'input.chatId');
    let contexto: ContextoConversacion;
    let areaId: string | null;
    if (r.tipo === 'unidad') {
      contexto = deUnidad(id(r.unitId, 'input.unitId'));
      areaId = store.getUnit(contexto.details.unidadId!)!.areaId;
    } else if (r.tipo === 'pasaje') {
      ({ areaId, ...contexto } = dePasaje(r));
    } else if (r.tipo === 'intento') {
      ({ areaId, ...contexto } = deIntento(id(r.attemptId, 'input.attemptId')));
    } else throw new StudyError('INVALID_INPUT', 'input.tipo must be unidad, pasaje or intento');
    // La conversación queda en el espacio de lo que la origina; sin espacio propio, en el activo.
    deps.registrar(chatId, { areaId: areaId ?? deps.espacioActivo(), unitId: contexto.details.unidadId, origen: contexto.details.tipo });
    return contexto;
  };
}
