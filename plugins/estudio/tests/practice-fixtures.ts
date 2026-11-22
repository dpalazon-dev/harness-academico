import { answerHash } from '../src/practice/schema.ts';
import type { PracticeAttempt, PracticeTask } from '../src/practice/types.ts';
import { NOW } from './study-fixtures.ts';

export const MODEL = { provider: 'test', id: 'strong' };

export function task(overrides: Partial<PracticeTask> = {}): PracticeTask {
  return {
    id: 't1', revision: 1, unitId: 'u1', kind: 'libre',
    prompt: 'Explica sin mirar por qué la derivada es un límite.',
    cues: ['¿Qué mide la derivada?', 'Piensa en secantes que se acercan.', 'Cociente incremental.', 'lim h→0 de (f(x+h)-f(x))/h', '¿Es la pendiente de la tangente?'],
    reference: 'La derivada es el límite del cociente incremental cuando h tiende a 0.',
    rubric: ['Menciona el cociente incremental', 'Menciona el paso al límite'],
    createdAt: NOW, model: MODEL, ...overrides,
  };
}

export function attempt(overrides: Partial<PracticeAttempt> = {}): PracticeAttempt {
  return {
    id: 'a1', revision: 1, unitId: 'u1', taskId: 't1', taskKind: 'libre', openedAt: NOW, confidence: 60,
    cueLevel: 0, cueLevelAtFreeze: null, answer: '', answerHash: null, frozenAt: null, status: 'open',
    contextLabel: 'libre', judgments: [], grades: [], ...overrides,
  };
}

export function frozen(answer = 'Es el límite del cociente incremental.', overrides: Partial<PracticeAttempt> = {}): PracticeAttempt {
  return attempt({ answer, answerHash: answerHash(answer), frozenAt: NOW, cueLevelAtFreeze: 0, status: 'frozen', ...overrides });
}
