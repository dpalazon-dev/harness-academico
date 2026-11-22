import fs from 'node:fs';
import path from 'node:path';

/* El libro del modo proactivo (ticket 12e): lo único que el plugin guarda del gasto del tutor cuando comenta solo.
 * Es el que corta el gasto (el tope diario) y el que mide (llamadas y tokens por hora), porque `usage.jsonl` del host
 * no distingue estas llamadas de las demás en segundo plano (los resúmenes de conversación también lo son).
 *
 * Tres archivos en la carpeta de datos del plugin: `lecturas-proactivas.jsonl`, una línea por llamada terminada,
 * `proactivo.json`, el tope configurado, y `proactivo-fallos.json`, los fallos seguidos de cada cuaderno (para que la cuenta
 * de tres no se reinicie con la aplicación). El recuento de hoy sale de las líneas, no de un contador aparte, para que no
 * haya dos fuentes que se puedan contradecir. */

/** Lecturas del tutor por su cuenta, por día local y entre todos los cuadernos. Conservador: con pausas de 8 s, un comentario
 * por párrafo y tres abiertos como mucho, una hora de escritura intensa gasta unas 10 a 15; 40 cubren tres horas largas. */
export const TOPE_POR_DEFECTO = 40;
/** El tope se puede subir, pero no sin límite: es la última defensa contra un fallo en otra parte. */
export const TOPE_MAXIMO = 500;

export type ResultadoLectura = 'comentado' | 'sin-comentario' | 'fallo';

export interface Lectura {
  at: string;
  /** Día local de `at`, `AAAA-MM-DD`. */
  dia: string;
  notebook: string;
  block: string;
  resultado: ResultadoLectura;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  ms: number;
}

export interface Libro {
  tope(): number;
  setTope(valor: number): void;
  /** Llamadas de hoy: las terminadas y las que están en curso. */
  usadasHoy(): number;
  /** Una llamada va a empezar; devuelve cómo cerrarla. Cuenta desde ya, para que dos a la vez no se salten el tope. */
  abrir(): { cerrar(lectura: Omit<Lectura, 'dia'>): void };
  /** Todas las líneas, de la más antigua a la más reciente. */
  lecturas(): Lectura[];
  /** Fallos seguidos de un cuaderno hoy: un acierto, apagar el modo o cambiar de día los reinician. Persisten entre procesos. */
  fallosSeguidos(cuaderno: string): number;
  /** Anota un fallo y devuelve cuántos van seguidos. */
  anotarFallo(cuaderno: string): number;
  olvidarFallos(cuaderno: string): void;
}

/** El día local de un instante, `AAAA-MM-DD`. */
export function diaLocal(instante: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instante));
}

export function createLibro(directory: string, { now, timeZone }: { now: () => string; timeZone: string }): Libro {
  const lineas = path.join(directory, 'lecturas-proactivas.jsonl');
  const ajustes = path.join(directory, 'proactivo.json');
  const archivoFallos = path.join(directory, 'proactivo-fallos.json');
  let enCurso = 0;

  const leerFallos = (): Record<string, { dia: string; n: number }> => {
    try {
      const v = JSON.parse(fs.readFileSync(archivoFallos, 'utf8')) as unknown;
      return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, { dia: string; n: number }> : {};
    } catch { return {}; }
  };
  const escribirFallos = (v: Record<string, { dia: string; n: number }>) => {
    // Best effort: a disk error here must not hide the model error that is being counted, nor turn a good read into a failure.
    try { fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(archivoFallos, `${JSON.stringify(v)}\n`, { mode: 0o600 }); } catch { /* sin disco: la cuenta se pierde, la lectura no */ }
  };
  const fallosDeHoy = (cuaderno: string): number => {
    const f = leerFallos()[cuaderno];
    return f && f.dia === diaLocal(now(), timeZone) && Number.isSafeInteger(f.n) && f.n > 0 ? f.n : 0;
  };

  const leerLineas = (): Lectura[] => {
    let raw: string;
    try { raw = fs.readFileSync(lineas, 'utf8'); } catch { return []; }
    return raw.split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l) as Lectura]; } catch { return []; } });
  };

  return {
    tope() {
      try {
        const v = (JSON.parse(fs.readFileSync(ajustes, 'utf8')) as { tope?: unknown }).tope;
        if (Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= TOPE_MAXIMO) return v as number;
      } catch { /* sin archivo o ilegible: el de por defecto */ }
      return TOPE_POR_DEFECTO;
    },
    setTope(valor) {
      if (!Number.isSafeInteger(valor) || valor < 0 || valor > TOPE_MAXIMO) throw new RangeError(`El tope debe ser un entero de 0 a ${TOPE_MAXIMO}`);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(ajustes, `${JSON.stringify({ tope: valor })}\n`, { mode: 0o600 });
    },
    usadasHoy() {
      const hoy = diaLocal(now(), timeZone);
      return leerLineas().filter(l => l.dia === hoy).length + enCurso;
    },
    abrir() {
      enCurso++;
      let cerrada = false;
      return {
        cerrar(lectura) {
          if (cerrada) return;
          cerrada = true;
          enCurso--;
          fs.mkdirSync(directory, { recursive: true });
          fs.appendFileSync(lineas, `${JSON.stringify({ ...lectura, dia: diaLocal(lectura.at, timeZone) })}\n`, { mode: 0o600 });
        },
      };
    },
    lecturas: leerLineas,
    fallosSeguidos: fallosDeHoy,
    anotarFallo(cuaderno) {
      const todos = leerFallos();
      const n = fallosDeHoy(cuaderno) + 1;
      escribirFallos({ ...todos, [cuaderno]: { dia: diaLocal(now(), timeZone), n } });
      return n;
    },
    olvidarFallos(cuaderno) {
      const todos = leerFallos();
      if (!(cuaderno in todos)) return;
      const { [cuaderno]: _olvidado, ...resto } = todos;
      escribirFallos(resto);
    },
  };
}
