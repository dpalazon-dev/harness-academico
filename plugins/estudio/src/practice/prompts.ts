import type { StudyUnit, UnitKind } from '../study/types.ts';
import type { PracticeTask, TaskKind } from './types.ts';

/** What retrieval must look like for each kind of knowledge (method handoff, «Recuperación no equivale a flashcards»):
 * the task kind says how to ask; this says what a correct performance has to contain. */
export const KNOWLEDGE_BRIEF: Record<UnitKind, string> = {
  concepto: 'Es un concepto: la respuesta correcta lo define, lo distingue de los conceptos vecinos con los que se confunde, lo relaciona con otros y da un ejemplo propio. Una definición sola no basta.',
  procedimiento: 'Es un procedimiento: la tarea pide ejecutarlo sobre un caso concreto, con sus pasos en orden, las decisiones en cada paso y cómo comprobar el resultado. Describirlo en abstracto no basta.',
  argumento: 'Es un argumento: la respuesta reconstruye la tesis, sus premisas, la evidencia que las apoya y sus límites o contraargumentos, distinguiendo lo que afirma la fuente de la interpretación.',
  modelo: 'Es un modelo o sistema: la respuesta reconstruye sus componentes y las relaciones entre ellos (qué depende de qué, qué fluye, qué pasa si cambia una pieza), no solo una lista de partes.',
};
const KNOWLEDGE_UNKNOWN = 'Tipo de conocimiento no indicado: dedúcelo de la capacidad (hecho, concepto, procedimiento, argumento o sistema) y haz que la tarea pida la actuación que demostraría que ese conocimiento sigue disponible.';

const KIND_BRIEF: Record<TaskKind, string> = {
  guiada: 'Pregunta directa de recuperación: una pregunta concreta cuya respuesta el alumno debe producir de memoria.',
  libre: 'Reconstrucción libre: pedir que explique, sin mirar ninguna fuente, qué es, cómo funciona y por qué, con sus condiciones.',
  estructural: 'Reconstrucción estructural: pedir que reconstruya las piezas y sus relaciones (mapa, tabla o argumento), nombrando cada relación.',
  aplicada: 'Caso aplicado: un problema o situación concreta y nueva donde tenga que usar la capacidad para decidir o resolver algo.',
  comparacion: 'Comparación: pedir que distinga esta idea de la más parecida con la que se confunde, con un ejemplo y un contraejemplo.',
  transferencia: 'Transferencia: un caso en otro contexto o con otra representación distinta de la habitual, donde la capacidad siga aplicando.',
};

export const TASK_SYSTEM = `Eres el generador de tareas de recuperación de un sistema de estudio personal. El alumno produce primero su respuesta sin ayuda; solo después ve la referencia.
Escribe en español de España. Devuelve exclusivamente un objeto JSON, sin texto alrededor, con esta forma:
{"prompt": string, "cues": [string, string, string, string, string], "reference": string, "rubric": [string, ...]}
- "prompt": la consigna, autocontenida, sin revelar la respuesta.
- "cues": exactamente cinco pistas en orden creciente de ayuda: 1 una pregunta general que oriente, 2 la estructura de la respuesta, 3 una clave semántica, 4 información parcial, 5 un reconocimiento (por ejemplo, opciones entre las que está la correcta). Ninguna pista contiene la respuesta completa.
- "reference": la respuesta de referencia, completa y precisa, con las condiciones que importan.
- "rubric": de 2 a 8 criterios observables para contrastar la respuesta con la referencia.
No repitas ninguna de las consignas anteriores que se te den.`;

/** Sources stored as `documento:<id>` are incorporated papers; their text arrives as the excerpt instead. */
export const DOCUMENT_PREFIX = 'documento:';

export function taskRequest(unit: StudyUnit, kind: TaskKind, previousPrompts: readonly string[], excerpt: string | null = null): string {
  const external = unit.sources.filter(s => !s.path.startsWith(DOCUMENT_PREFIX));
  const lines = [
    `Tipo de tarea: ${KIND_BRIEF[kind]}`,
    unit.kind ? KNOWLEDGE_BRIEF[unit.kind] : KNOWLEDGE_UNKNOWN,
    `Unidad de estudio: ${unit.title}`,
    unit.capability && `Capacidad que debe demostrar: ${unit.capability}`,
    unit.criterion && `Criterio de éxito: ${unit.criterion}`,
    unit.notes && `Notas del sondeo sobre lo que ya sabe:\n${unit.notes}`,
    external.length > 0 && `Fuentes de la unidad: ${external.map(s => s.locator ? `${s.path} (${s.locator})` : s.path).join('; ')}`,
    excerpt && `Texto de la fuente estudiada. La referencia y la rúbrica deben apoyarse en él y no afirmar nada que no diga:
${excerpt}`,
    previousPrompts.length > 0 && `Consignas anteriores, que no debes repetir:\n${previousPrompts.map(p => `- ${p}`).join('\n')}`,
  ];
  return lines.filter(Boolean).join('\n\n');
}

export const JUDGE_SYSTEM = `Eres el contraste de un sistema de estudio personal. Comparas la respuesta congelada del alumno con la referencia y la rúbrica. No corriges la respuesta ni la reescribes.
Escribe en español de España. Devuelve exclusivamente un objeto JSON, sin texto alrededor, con esta forma:
{"fidelity": 0|1|2|3, "failureType": null|"acceso"|"precision"|"estructural"|"discriminacion"|"aplicacion"|"transferencia", "rationale": string}
- fidelity: 0 no la tenía, 1 errores importantes, 2 correcta pero incompleta, 3 completa.
- failureType: el cuello de botella principal, o null si la respuesta es completa. acceso = apenas pudo producir algo; precision = recuerda con errores; estructural = piezas sin relaciones; discriminacion = confunde con otra idea; aplicacion = sabe la teoría pero no la usa en el caso; transferencia = solo funciona en el contexto conocido.
- rationale: dos o tres frases que señalen qué criterios de la rúbrica cumple y cuáles no.`;

export function judgeRequest(task: PracticeTask, answer: string, excerpt: string | null = null): string {
  return [
    ...(excerpt ? [`Texto de la fuente estudiada (manda sobre la referencia si discrepan):
${excerpt}`] : []),
    `Consigna: ${task.prompt}`,
    `Referencia: ${task.reference}`,
    `Rúbrica:\n${task.rubric.map(r => `- ${r}`).join('\n')}`,
    `Respuesta congelada del alumno:\n${answer.trim() === '' ? '(vacía)' : answer}`,
  ].join('\n\n');
}

export const SCAFFOLD_SYSTEM = `Preparas la escalera de pistas y la rúbrica de una pregunta de recuperación que ha escrito el propio alumno, con su respuesta esperada. No cambias ni la pregunta ni la respuesta: son suyas.
Escribe en español de España. Devuelve exclusivamente un objeto JSON, sin texto alrededor, con esta forma:
{"cues": [string, string, string, string, string], "rubric": [string, ...]}
- "cues": exactamente cinco pistas en orden creciente de ayuda: 1 una pregunta general que oriente, 2 la estructura de la respuesta, 3 una clave semántica, 4 información parcial, 5 un reconocimiento. Ninguna pista contiene la respuesta completa. Sácalas solo de la respuesta dada.
- "rubric": de 1 a 6 criterios observables, sacados de la respuesta dada, para contrastar lo que el alumno recupere. No añadas exigencias que la respuesta no contiene.`;

export function scaffoldRequest(question: string, answer: string): string {
  return `Pregunta del alumno:\n${question}\n\nSu respuesta esperada:\n${answer}`;
}
