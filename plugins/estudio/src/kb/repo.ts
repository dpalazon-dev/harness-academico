import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newKbId, parseRecord, recordPath, renderRecord } from './records.ts';
import { FOLDER, type KbPersona, type KbRol } from './types.ts';
import { comprobarKbol, errorDeUv } from '../kbol-requisitos.ts';
import { autorKbol, nombreEstudiante } from '../identidad.ts';

export interface KbConfig {
  /** Git repository holding the knowledge base (`kb/` inside). */
  kbDir: string;
  /** KBOL checkout whose `kbol validar` checks every record before it is written. */
  kbolDir: string;
  uv: string;
}

export function kbConfig(env: NodeJS.ProcessEnv = process.env, home = env.USERPROFILE ?? env.HOME ?? '.'): KbConfig {
  return {
    kbDir: env.ESTUDIO_KB_DIR ?? path.join(home, 'Learning'),
    kbolDir: env.ESTUDIO_KBOL_DIR ?? path.join(home, 'KBOL'),
    uv: env.ESTUDIO_UV ?? 'uv',
  };
}

export const AMBITO = 'estudio';
export const AUTHOR = autorKbol();

interface Run { code: number | null; stdout: string; stderr: string }

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, { cwd, env, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout?.setEncoding('utf8').on('data', c => { stdout += c; });
    child.stderr?.setEncoding('utf8').on('data', c => { stderr += c; });
    child.on('error', error => reject(new Error(errorDeUv(command, error) ?? `No se pudo ejecutar ${command}: ${error.message}`)));
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

async function git(kbDir: string, args: string[]): Promise<string> {
  const r = await run('git', ['-c', 'core.autocrlf=false', ...args], kbDir, {
    ...process.env, GIT_AUTHOR_NAME: nombreEstudiante(), GIT_AUTHOR_EMAIL: `${AUTHOR.slice('human:'.length)}@learning.local`, GIT_COMMITTER_NAME: 'Estudio', GIT_COMMITTER_EMAIL: 'estudio@learning.local',
  });
  if (r.code !== 0) throw new Error(`git ${args[0]} falló: ${(r.stderr || r.stdout).trim().slice(-1000)}`);
  return r.stdout.trim();
}

export interface KbFile { path: string; text: string }
export interface StoredRecord { path: string; header: Record<string, unknown>; body: string }

export interface KbRepo {
  readonly config: KbConfig;
  ensureInitialized(): Promise<void>;
  /** The person and role a `pregunta` names as responsible; records only, no governance. */
  owner(): { persona: string; rol: string };
  list(): StoredRecord[];
  get(id: string): StoredRecord | null;
  validate(files: readonly KbFile[]): Promise<string[]>;
  commit(files: readonly KbFile[], message: string, alsoAdd?: readonly string[]): Promise<string>;
}

const README = `# Learning

Base de conocimiento de estudio de ${nombreEstudiante()}, en formato KBOL (registros en modo propuesta, validados con \`kbol validar\`).
Sin gobernanza: sin arranque, integración ni aprobaciones. Cada lote confirmado en la app Estudio es un commit.

- \`kb/fuentes\`: papers (original y estructura de Document Intelligence); los PDF están en el almacén, fuera de git.
- \`kb/hechos\`: lo que afirma una fuente, con cita literal verificada.
- \`kb/entidades\`: tareas, métodos, datasets, métricas, conceptos y familias de modelos.
- \`kb/preguntas\`, \`kb/hipotesis\`, \`kb/sintesis\`: interpretación propia.
- \`kb/personas\`: persona y rol de ${nombreEstudiante()}, solo como referencia de las preguntas.
`;

export function openKbRepo(config: KbConfig, now: () => string): KbRepo {
  const kbRoot = path.join(config.kbDir, 'kb');

  function readAll(): StoredRecord[] {
    if (!fs.existsSync(kbRoot)) return [];
    const out: StoredRecord[] = [];
    for (const folder of new Set(Object.values(FOLDER))) {
      const dir = path.join(kbRoot, folder);
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.md')).sort()) {
        try {
          const { header, body } = parseRecord(fs.readFileSync(path.join(dir, name), 'utf8'));
          out.push({ path: `kb/${folder}/${name}`, header, body });
        } catch { /* an unreadable file is skipped here; kbol validar reports it */ }
      }
    }
    return out;
  }

  function owner(): { persona: string; rol: string } {
    const records = readAll();
    const persona = records.find(r => r.header.type === 'persona')?.header.id;
    const rol = records.find(r => r.header.type === 'rol')?.header.id;
    if (typeof persona !== 'string' || typeof rol !== 'string') throw new Error('La base no está inicializada: faltan la persona y el rol de quien estudia');
    return { persona, rol };
  }

  async function validate(files: readonly KbFile[]): Promise<string[]> {
    if (files.length > 0) comprobarKbol('Guardar en la base de conocimiento', config);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-kbval-'));
    try {
      const errors: string[] = [];
      for (const [i, file] of files.entries()) {
        const target = path.join(dir, `${i}-${path.basename(file.path)}`);
        fs.writeFileSync(target, file.text, 'utf8');
        const r = await run(config.uv, ['run', '--no-sync', 'kbol', 'validar', '--modo', 'propuesta', target], config.kbolDir, { ...process.env, PYTHONIOENCODING: 'utf-8' });
        let resultado: { estado?: string; errores?: unknown[] } | undefined;
        try { resultado = JSON.parse(r.stdout).resultado; } catch { /* reported below */ }
        if (!resultado) errors.push(`${file.path}: kbol validar no devolvió un resultado (${(r.stderr || r.stdout).trim().slice(-300)})`);
        else if (resultado.estado !== 'completado' || (resultado.errores ?? []).length > 0) {
          errors.push(`${file.path}: ${(resultado.errores ?? []).map(e => typeof e === 'string' ? e : JSON.stringify(e)).join('; ') || resultado.estado}`);
        }
      }
      return errors;
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }

  async function commit(files: readonly KbFile[], message: string, alsoAdd: readonly string[] = []): Promise<string> {
    const errors = await validate(files);
    if (errors.length > 0) throw new Error(`KBOL rechaza el lote, no se ha escrito nada:\n${errors.join('\n')}`);
    // What each path held before, so a failed batch restores files already in the repository instead of deleting them.
    const previous = new Map<string, string | null>();
    try {
      for (const file of files) {
        const target = path.join(config.kbDir, file.path);
        previous.set(file.path, fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, file.text, 'utf8');
      }
      const paths = [...previous.keys(), ...alsoAdd];
      await git(config.kbDir, ['add', '--', ...paths]);
      // Only this batch: whatever else David has staged in the repository stays out of the commit.
      await git(config.kbDir, ['commit', '-q', '-m', message, '--', ...paths]);
      return await git(config.kbDir, ['rev-parse', 'HEAD']);
    } catch (error) {
      await git(config.kbDir, ['reset', '-q', '--', ...previous.keys()]).catch(() => {});
      for (const [p, text] of previous) {
        if (text === null) fs.rmSync(path.join(config.kbDir, p), { force: true });
        else fs.writeFileSync(path.join(config.kbDir, p), text, 'utf8');
      }
      throw error;
    }
  }

  return {
    config,
    owner,
    list: readAll,
    get: id => readAll().find(r => r.header.id === id) ?? null,
    validate,
    commit,

    async ensureInitialized() {
      fs.mkdirSync(config.kbDir, { recursive: true });
      if (!fs.existsSync(path.join(config.kbDir, '.git'))) await git(config.kbDir, ['init', '-q', '-b', 'main']);
      if (readAll().some(r => r.header.type === 'persona')) return;
      for (const folder of new Set(Object.values(FOLDER))) fs.mkdirSync(path.join(kbRoot, folder), { recursive: true });
      const rolId = newKbId('rol'), personaId = newKbId('persona');
      const common = { clase: 'registro' as const, ambito: AMBITO, autor: AUTHOR, eventos: [] as [], sources: [] };
      const rol: KbRol = { ...common, id: rolId, type: 'rol', title: 'Responsable del estudio', description: 'Rol de referencia para las preguntas de la base de estudio; sin gobernanza.', estado: 'propuesta', ambitos: [AMBITO], capacidades: ['ratificar'], regla_aprobacion: 'uno' };
      const persona: KbPersona = { ...common, id: personaId, type: 'persona', title: nombreEstudiante(), description: 'Autor y lector único de la base de estudio.', estado: 'propuesta', naturaleza: 'humana', identidad_ref: `declarada:${AUTHOR.slice('human:'.length)}`, ocupa: [{ rol: rolId, desde: now() }] };
      // An existing repository keeps its own README and attributes.
      const extra: string[] = [];
      for (const [name, text] of [['README.md', README], ['.gitattributes', '* text eol=lf\n']] as const) {
        const target = path.join(config.kbDir, name);
        if (fs.existsSync(target)) continue;
        fs.writeFileSync(target, text, 'utf8');
        extra.push(name);
      }
      await commit([
        { path: recordPath(rol), text: renderRecord(rol, '# Responsable del estudio\n\nRol de referencia; la base no usa la gobernanza de KBOL.') },
        { path: recordPath(persona), text: renderRecord(persona, `# ${nombreEstudiante()}\n\nAutor y lector único de la base de estudio.`) },
      ], 'Inicia la base de conocimiento de estudio', extra);
    },
  };
}
