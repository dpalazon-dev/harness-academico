import { createHash } from 'node:crypto';
import { parseAttempt, parseAttemptCommand, validateInstant } from './schema.ts';
import { AssessmentError } from './types.ts';
import type { AttemptAggregate, AttemptCommand } from './types.ts';

/** Returns a detached next record; the caller must persist before revealing the reference. */
export function transitionAttempt(attempt: AttemptAggregate, command: AttemptCommand, now: string): AttemptAggregate {
  const next = parseAttempt(attempt);
  const input = parseAttemptCommand(command);
  const at = validateInstant(now, 'now');
  const lastEvent = next.grades.at(-1)?.gradedAt ?? next.frozenAt ?? next.openedAt;
  if (at < lastEvent) throw new AssessmentError('INVALID_INPUT', 'now precedes the latest attempt event');
  if (next.revision === Number.MAX_SAFE_INTEGER) throw new AssessmentError('INVALID_INPUT', 'attempt revision would overflow');
  const requireStatus = (...allowed: AttemptAggregate['status'][]) => {
    if (!allowed.includes(next.status)) throw new AssessmentError('INVALID_TRANSITION', `${input.type} is not allowed from ${next.status}`);
  };
  switch (input.type) {
    case 'saveAnswer':
      requireStatus('open');
      next.answer = input.answer;
      break;
    case 'freeze':
      requireStatus('open');
      next.frozenAt = at;
      next.answerHash = createHash('sha256').update(next.answer, 'utf8').digest('hex');
      next.status = 'frozen';
      break;
    case 'grade':
    case 'correctGrade':
      requireStatus(input.type === 'grade' ? 'frozen' : 'graded');
      if (input.marks.length !== next.snapshot.rubric.length) throw new AssessmentError('INVALID_INPUT', 'grade requires one mark per criterion');
      next.grades.push({ score: input.score, marks: [...input.marks], diagnosis: input.diagnosis, gradedAt: at, evaluator: 'self', correction: input.type === 'correctGrade' });
      next.status = 'graded';
      break;
    case 'abandon':
      requireStatus('open', 'frozen');
      next.status = 'abandoned';
      break;
  }
  next.revision++;
  return parseAttempt(next);
}
