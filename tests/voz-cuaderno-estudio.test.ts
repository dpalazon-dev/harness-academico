/**
 * La voz del cuaderno (ticket 12j): la síntesis de voz del navegador con las voces del sistema, detrás de un módulo pequeño.
 * La limpieza del texto y la elección de voz son funciones puras; hablar, parar y las voces se prueban contra un doble de
 * `speechSynthesis` puesto en el global, que es el cliente externo (no hay parámetros añadidos para probar).
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { elegirVoz, estadoVoz, hablar, limpiarParaVoz, parar, vozDisponible } from "../components/estudio/voz.ts";

const espera = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const voz = (name: string, lang: string, extra: Record<string, unknown> = {}) => ({ name, lang, localService: true, default: false, voiceURI: name, ...extra }) as unknown as SpeechSynthesisVoice;

describe("limpiarParaVoz", () => {
	it("quita el Markdown y deja solo lo que se dice", () => {
		assert.equal(limpiarParaVoz("**Ojo**: _esto_ usa `dijkstra()` y [la guía](https://x.org/a)."), "Ojo: esto usa dijkstra() y la guía.");
		assert.equal(limpiarParaVoz("## Idea\n- uno\n- dos\n1. tres"), "Idea. uno. dos. tres.");
		assert.equal(limpiarParaVoz("> Una cita\nOtra línea."), "Una cita. Otra línea.");
	});

	it("no lee los diagramas Mermaid ni otros bloques de código", () => {
		assert.equal(limpiarParaVoz("Mira el esquema:\n```mermaid\nflowchart TD\n  A-->B\n```\nEso es todo."), "Mira el esquema: Eso es todo.");
		assert.equal(limpiarParaVoz("Así:\n```python\nprint(1)\n```\nFin."), "Así: Fin.");
		assert.equal(limpiarParaVoz("```mermaid\ngraph LR\nA-->B\n```"), "");
		// Un bloque sin cerrar (respuesta cortada) tampoco se lee.
		assert.equal(limpiarParaVoz("Ahí va:\n```mermaid\ngraph LR\nA-->B"), "Ahí va:");
	});

	it("no lee el bloque de propuestas, ni cerrado ni cortado", () => {
		assert.equal(limpiarParaVoz('¿Seguro?\n<propuestas>[{"tipo":"hecho"}]</propuestas>'), "¿Seguro?");
		assert.equal(limpiarParaVoz('¿Seguro?\n<propuestas>[{"tipo":"he'), "¿Seguro?");
	});

	it("quita direcciones y etiquetas HTML, y no confunde guiones bajos de identificadores ni asteriscos de cuentas", () => {
		assert.equal(limpiarParaVoz("Mira https://example.com/a?b=1 y <b>esto</b>."), "Mira y esto.");
		assert.equal(limpiarParaVoz("La variable snake_case_larga vale 2 * 3 * 4."), "La variable snake_case_larga vale 2 * 3 * 4.");
		assert.equal(limpiarParaVoz("Si x < 5 y y > 3, entonces sí."), "Si x < 5 y y > 3, entonces sí.");
		assert.equal(limpiarParaVoz("En 1990) hubo un cambio."), "En 1990) hubo un cambio.");
	});

	it("separa los renglones con un punto cuando no traen puntuación, para que haya pausa", () => {
		assert.equal(limpiarParaVoz("Primero\nSegundo?\n\nTercero"), "Primero. Segundo? Tercero.");
	});

	it("una tabla se lee sin barras y sin su fila de guiones", () => {
		assert.equal(limpiarParaVoz("| a | b |\n|---|---|\n| 1 | 2 |"), "a b. 1 2.");
	});

	it("devuelve vacío si no queda nada que decir", () => {
		assert.equal(limpiarParaVoz(""), "");
		assert.equal(limpiarParaVoz("  \n\n "), "");
		assert.equal(limpiarParaVoz("---"), "");
	});
});

describe("elegirVoz", () => {
	it("prefiere es-ES, luego cualquier español, y ninguna si no hay", () => {
		const mx = voz("Sabina", "es-MX"), es = voz("Helena", "es-ES"), en = voz("David", "en-US");
		assert.equal(elegirVoz([en, mx, es]), es);
		assert.equal(elegirVoz([en, mx]), mx);
		assert.equal(elegirVoz([en]), null);
		assert.equal(elegirVoz([]), null);
	});

	it("reconoce es_ES con guion bajo y mayúsculas distintas", () => {
		const v = voz("X", "ES_es");
		assert.equal(elegirVoz([voz("Y", "en-GB"), v]), v);
	});

	it("solo usa voces locales: una voz de red enviaría el texto fuera", () => {
		const red = voz("Google español", "es-ES", { localService: false });
		const local = voz("Helena", "es-MX");
		assert.equal(elegirVoz([red]), null);
		assert.equal(elegirVoz([red, local]), local);
	});
});

/** Un doble de `speechSynthesis` y de `SpeechSynthesisUtterance`: anota lo dicho y deja disparar los eventos a mano. */
class Frase {
	text: string; lang = ""; voice: SpeechSynthesisVoice | null = null;
	onstart: (() => void) | null = null; onend: (() => void) | null = null; onerror: ((e: { error: string }) => void) | null = null;
	constructor(text: string) { this.text = text; }
}
function instalar(voces: SpeechSynthesisVoice[], opciones: { retraso?: boolean; falla?: boolean } = {}) {
	const dicho: Frase[] = [];
	const escuchas = new Set<() => void>();
	let lista = opciones.retraso ? [] : voces;
	const synth = {
		cancelaciones: 0,
		getVoices: () => lista,
		speak(f: Frase) { if (opciones.falla) throw new Error("sin motor"); dicho.push(f); queueMicrotask(() => f.onstart?.()); },
		cancel() { this.cancelaciones++; const ultima = dicho[dicho.length - 1]; if (ultima && !(ultima as unknown as { acabada?: boolean }).acabada) { (ultima as unknown as { acabada: boolean }).acabada = true; ultima.onerror?.({ error: "canceled" }); } },
		addEventListener(_t: string, f: () => void) { escuchas.add(f); },
		removeEventListener(_t: string, f: () => void) { escuchas.delete(f); },
		cargar() { lista = voces; for (const f of [...escuchas]) f(); },
		escuchas,
	};
	Object.assign(globalThis, { speechSynthesis: synth, SpeechSynthesisUtterance: Frase });
	return { synth, dicho };
}
afterEach(() => { parar(); Reflect.deleteProperty(globalThis, "speechSynthesis"); Reflect.deleteProperty(globalThis, "SpeechSynthesisUtterance"); });

describe("hablar y parar", () => {
	it("sin síntesis de voz: no está disponible, el estado lo dice y hablar avisa del fallo sin lanzar", async () => {
		assert.equal(vozDisponible(), false);
		assert.equal(await estadoVoz(), "sin-soporte");
		const fin: boolean[] = [];
		hablar("hola", (fallo) => fin.push(fallo));
		assert.deepEqual(fin, [true]);
	});

	it("dice el texto con la voz española elegida", async () => {
		const es = voz("Helena", "es-ES");
		const { dicho } = instalar([voz("David", "en-US"), es]);
		hablar("Hola, ¿qué tal?", () => {});
		await espera(5);
		assert.equal(dicho.length, 1);
		assert.equal(dicho[0]!.text, "Hola, ¿qué tal?");
		assert.equal(dicho[0]!.voice, es);
		assert.equal(dicho[0]!.lang, "es-ES");
		assert.equal(await estadoVoz(), "espanol");
	});

	it("sin voz española usa la predeterminada y el estado lo dice", async () => {
		const en = voz("David", "en-US");
		const { dicho } = instalar([en]);
		assert.equal(await estadoVoz(), "sin-espanol");
		hablar("Hola", () => {});
		await espera(5);
		assert.equal(dicho.length, 1);
		assert.equal(dicho[0]!.voice, en);
	});

	it("si el navegador solo ofrece voces de red, no habla y lo avisa como fallo", async () => {
		const { dicho } = instalar([voz("Google español", "es-ES", { localService: false })]);
		const fin: boolean[] = [];
		hablar("hola", (f) => fin.push(f));
		await espera(5);
		assert.equal(dicho.length, 0);
		assert.deepEqual(fin, [true]);
	});

	it("espera a que lleguen las voces (voiceschanged) y habla con la española", async () => {
		const es = voz("Helena", "es-ES");
		const { synth, dicho } = instalar([es], { retraso: true });
		hablar("Hola", () => {});
		await espera(5);
		assert.equal(dicho.length, 0);
		synth.cargar();
		await espera(5);
		assert.equal(dicho[0]!.voice, es);
		assert.equal(synth.escuchas.size, 0);
	});

	it("si las voces no llegan nunca, habla igualmente con la predeterminada", async () => {
		const { dicho } = instalar([], { retraso: true });
		hablar("Hola", () => {});
		await espera(1700);
		assert.equal(dicho.length, 1);
		assert.equal(dicho[0]!.voice, null);
	});

	it("una lectura nueva sustituye a la anterior, que termina sin fallo", async () => {
		const { synth, dicho } = instalar([voz("Helena", "es-ES")]);
		const a: boolean[] = [], b: boolean[] = [];
		hablar("uno", (f) => a.push(f));
		await espera(5);
		hablar("dos", (f) => b.push(f));
		await espera(5);
		assert.deepEqual(a, [false]);
		assert.deepEqual(dicho.map(x => x.text), ["uno", "dos"]);
		assert.ok(synth.cancelaciones >= 2);
		dicho[1]!.onend?.();
		assert.deepEqual(b, [false]);
	});

	it("una lectura que aún espera las voces y es sustituida no llega a hablar", async () => {
		const { synth, dicho } = instalar([voz("Helena", "es-ES")], { retraso: true });
		const a: boolean[] = [];
		hablar("viejo", (f) => a.push(f));
		hablar("nuevo", () => {});
		synth.cargar();
		await espera(5);
		assert.deepEqual(dicho.map(x => x.text), ["nuevo"]);
		assert.deepEqual(a, [false]);
	});

	it("parar corta la lectura, avisa una vez y no deja nada pendiente", async () => {
		const { synth, dicho } = instalar([voz("Helena", "es-ES")]);
		const fin: boolean[] = [];
		hablar("largo", (f) => fin.push(f));
		await espera(5);
		parar();
		parar();
		assert.deepEqual(fin, [false]);
		assert.ok(synth.cancelaciones >= 1);
		dicho[0]!.onend?.();
		assert.deepEqual(fin, [false]);
	});

	it("un fallo del motor se avisa como fallo y no lanza", async () => {
		instalar([voz("Helena", "es-ES")], { falla: true });
		const fin: boolean[] = [];
		hablar("hola", (f) => fin.push(f));
		await espera(5);
		assert.deepEqual(fin, [true]);
	});

	it("un error real del motor es fallo; cancelar no lo es", async () => {
		const { dicho } = instalar([voz("Helena", "es-ES")]);
		const fin: boolean[] = [];
		hablar("hola", (f) => fin.push(f));
		await espera(5);
		dicho[0]!.onerror?.({ error: "synthesis-failed" });
		assert.deepEqual(fin, [true]);
	});

	it("un texto vacío no se dice y termina sin fallo", async () => {
		const { dicho } = instalar([voz("Helena", "es-ES")]);
		const fin: boolean[] = [];
		hablar("   ", (f) => fin.push(f));
		await espera(5);
		assert.equal(dicho.length, 0);
		assert.deepEqual(fin, [false]);
	});
});
