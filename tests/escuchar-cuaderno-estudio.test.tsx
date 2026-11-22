/**
 * «Escuchar» en el cuaderno (ticket 12j): el interruptor de la cabecera, el botón de cada comentario y el gancho que decide
 * qué se lee. El gancho se monta sobre linkedom con un doble de `speechSynthesis` en el global (el cliente externo).
 * Lo que no se comprueba aquí, porque no hay oídos: que lo que suena sea inteligible.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { BotonEscuchar, EscucharCuaderno } from "../components/estudio/escuchar-cuaderno.tsx";
import { mensajesDelTutor, nuevosDelTutor, useEscuchar, type VozVista } from "../components/estudio/escuchar.ts";
import { parar } from "../components/estudio/voz.ts";
import type { Comentario } from "../components/estudio/cuadernos.ts";

const T = "2026-11-17T10:00:00.000Z";
const espera = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const comentario = (id: string, textos: string[], extra: Partial<Comentario> = {}): Comentario => ({
	id, persona: "tutor", kind: "pregunta", state: "abierto", createdAt: T,
	anchor: { blockId: "n1", text: "x", start: 0, end: 1, prefix: "", suffix: "" },
	thread: textos.map((text, i) => ({ id: `${id}-m${i}`, role: i % 2 === 0 ? "tutor" as const : "david" as const, text, at: T })),
	...extra,
});

describe("qué mensajes del tutor hay y cuáles son nuevos", () => {
	it("solo cuentan los mensajes del tutor, en orden", () => {
		const ms = mensajesDelTutor([comentario("c1", ["uno", "tu respuesta", "dos"]), comentario("c2", ["tres"])]);
		assert.deepEqual(ms.map(m => m.id), ["c1-m0", "c1-m2", "c2-m0"]);
		assert.deepEqual(mensajesDelTutor(undefined), []);
	});

	it("nuevo es el que no estaba entre los vistos", () => {
		const ms = mensajesDelTutor([comentario("c1", ["uno", "ok", "dos"])]);
		assert.deepEqual(nuevosDelTutor(new Set(["c1-m0"]), ms).map(m => m.id), ["c1-m2"]);
		assert.deepEqual(nuevosDelTutor(new Set(["c1-m0", "c1-m2"]), ms), []);
	});
});

const vista = (extra: Partial<VozVista> = {}): VozVista => ({ disponible: true, activo: false, leyendo: null, aviso: null, alternar() {}, leer() {}, parar() {}, ...extra });

describe("el interruptor de la cabecera", () => {
	it("es un interruptor con nombre en español y su estado anunciado, apagado por defecto", () => {
		const html = renderToStaticMarkup(<EscucharCuaderno voz={vista()} />);
		assert.match(html, /role="switch"/);
		assert.match(html, /aria-checked="false"/);
		assert.match(html, /data-escuchar-interruptor/);
		assert.match(html, />Escuchar</);
		assert.doesNotMatch(html, /disabled/);
		assert.match(renderToStaticMarkup(<EscucharCuaderno voz={vista({ activo: true })} />), /aria-checked="true"/);
	});

	it("sin síntesis de voz está desactivado y lo dice", () => {
		const html = renderToStaticMarkup(<EscucharCuaderno voz={vista({ disponible: false })} />);
		assert.match(html, /aria-disabled="true"/);
		assert.match(html, /Sin voz en este equipo/);
	});

	it("el aviso de que no hay voz en español sale como estado discreto, y el fallo también", () => {
		assert.match(renderToStaticMarkup(<EscucharCuaderno voz={vista({ activo: true, aviso: "sin-espanol" })} />), /role="status"[^>]*>Sin voz en español: se usa la predeterminada\./);
		assert.match(renderToStaticMarkup(<EscucharCuaderno voz={vista({ activo: true, aviso: "fallo" })} />), /No se pudo leer en voz alta\./);
		assert.doesNotMatch(renderToStaticMarkup(<EscucharCuaderno voz={vista({ activo: true })} />), /role="status"/);
	});
});

describe("el botón de cada comentario", () => {
	it("dice «Escuchar» con su nombre accesible, y «Detener» mientras lee ese mensaje", () => {
		const parado = renderToStaticMarkup(<BotonEscuchar mensajeId="m1" texto="Hola" firma="Profesor" voz={vista()} />);
		assert.match(parado, /data-escuchar-mensaje="m1"/);
		assert.match(parado, /aria-label="Escuchar el comentario de Profesor"/);
		assert.match(parado, />Escuchar</);
		const leyendo = renderToStaticMarkup(<BotonEscuchar mensajeId="m1" texto="Hola" firma="Profesor" voz={vista({ leyendo: "m1" })} />);
		assert.match(leyendo, /aria-label="Detener la lectura"/);
		assert.match(leyendo, />Detener</);
		// Leer otro mensaje no cambia este botón.
		assert.match(renderToStaticMarkup(<BotonEscuchar mensajeId="m1" texto="Hola" firma="Profesor" voz={vista({ leyendo: "m2" })} />), />Escuchar</);
	});

	it("no se pinta si el equipo no tiene voz", () => {
		assert.equal(renderToStaticMarkup(<BotonEscuchar mensajeId="m1" texto="Hola" firma="Profesor" voz={vista({ disponible: false })} />), "");
	});
});

/* ---- El gancho, montado de verdad ---- */

class Frase {
	text: string; lang = ""; voice: unknown = null;
	onstart: (() => void) | null = null; onend: (() => void) | null = null; onerror: ((e: { error: string }) => void) | null = null;
	constructor(text: string) { this.text = text; }
}
const voz = (name: string, lang: string) => ({ name, lang, localService: true, default: false, voiceURI: name });
let dicho: Frase[] = [];
let cancelaciones = 0;
function instalarVoz(voces: unknown[]) {
	dicho = []; cancelaciones = 0;
	Object.assign(globalThis, {
		SpeechSynthesisUtterance: Frase,
		speechSynthesis: {
			getVoices: () => voces, speak: (f: Frase) => { dicho.push(f); }, cancel: () => { cancelaciones++; },
			addEventListener() {}, removeEventListener() {},
		},
	});
}

let root: Root | null = null;
let restore: (() => void) | null = null;
let almacen = new Map<string, string>();
let vozActual: VozVista | null = null;

/** Un componente mínimo: el gancho con el interruptor y un botón por mensaje del tutor. */
function Prueba({ cuaderno }: { cuaderno: { id: string; comments?: Comentario[] } | null }) {
	const v = useEscuchar(cuaderno);
	vozActual = v;
	return (
		<div>
			<EscucharCuaderno voz={v} />
			{mensajesDelTutor(cuaderno?.comments).map(m => <BotonEscuchar key={m.id} mensajeId={m.id} texto={m.texto} firma="Tutor" voz={v} />)}
		</div>
	);
}

async function montar(cuaderno: { id: string; comments?: Comentario[] } | null) {
	const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
	const w = dom.window as unknown as Record<string, unknown>;
	w.localStorage = {
		getItem: (k: string) => almacen.get(k) ?? null, setItem: (k: string, v: string) => { almacen.set(k, v); }, removeItem: (k: string) => { almacen.delete(k); },
	};
	const globals: Record<string, unknown> = { window: dom.window, document: dom.document, HTMLElement: w.HTMLElement, Element: w.Element, Node: w.Node, SVGElement: w.SVGElement, IS_REACT_ACT_ENVIRONMENT: true };
	const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	Object.assign(globalThis, globals);
	restore = () => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } };
	root = createRoot(dom.document.querySelector("#root")!);
	const pintar = async (c: typeof cuaderno) => { await act(async () => { root!.render(<Prueba cuaderno={c} />); }); await act(async () => { await espera(10); }); };
	await pintar(cuaderno);
	const evento = (tipo: string, extra: Record<string, unknown> = {}) => Object.assign(new (dom.window as unknown as { Event: typeof Event }).Event(tipo, { bubbles: true, cancelable: true }), extra);
	const clic = async (el: Element | null) => { assert.ok(el, "el elemento existe"); await act(async () => { el.dispatchEvent(evento("click", { detail: 1 })); }); await act(async () => { await espera(10); }); };
	const interruptor = () => dom.document.querySelector<HTMLElement>("[data-escuchar-interruptor]")!;
	return { dom, doc: dom.document, pintar, clic, interruptor, evento, esperar: (ms: number) => act(async () => { await espera(ms); }) };
}

beforeEach(() => { almacen = new Map(); instalarVoz([voz("Helena", "es-ES")]); });
afterEach(async () => {
	await act(async () => { root?.unmount(); });
	root = null; vozActual = null;
	restore?.(); restore = null;
	parar();
	Reflect.deleteProperty(globalThis, "speechSynthesis");
	Reflect.deleteProperty(globalThis, "SpeechSynthesisUtterance");
});

const CON = (...cs: Comentario[]) => ({ id: "nb1", comments: cs });
const VIEJO = comentario("c1", ["¿Qué pasa con los pesos negativos?"]);

describe("el gancho de Escuchar", () => {
	it("empieza apagado y no lee nada al abrir, ni los comentarios que ya estaban", async () => {
		const p = await montar(CON(VIEJO));
		assert.equal(p.interruptor().getAttribute("aria-checked"), "false");
		assert.equal(dicho.length, 0);
	});

	it("encendido, no lee los comentarios antiguos ni al encender ni al recargar, y recuerda el interruptor por cuaderno", async () => {
		const p = await montar(CON(VIEJO));
		await p.clic(p.interruptor());
		assert.equal(p.interruptor().getAttribute("aria-checked"), "true");
		assert.equal(dicho.length, 0, "al encender no se lee lo que ya estaba");
		assert.equal(almacen.get("estudio.cuaderno.escuchar.nb1"), "1");
		// Recargar: se desmonta y se vuelve a montar con lo mismo.
		await act(async () => { root!.unmount(); });
		restore?.(); root = null;
		const q = await montar(CON(VIEJO));
		assert.equal(q.interruptor().getAttribute("aria-checked"), "true", "se recuerda");
		assert.equal(dicho.length, 0, "recargar no lee lo antiguo");
		// Otro cuaderno no hereda el estado.
		await q.pintar({ id: "nb2", comments: [] });
		assert.equal(q.interruptor().getAttribute("aria-checked"), "false");
	});

	it("encendido, un comentario nuevo se lee, ya limpio de marcas y de diagramas", async () => {
		const p = await montar(CON(VIEJO));
		await p.clic(p.interruptor());
		const nuevo = comentario("c2", ["**Ojo**: ¿y si hay ciclos?\n```mermaid\ngraph LR\nA-->B\n```"]);
		await p.pintar(CON(VIEJO, nuevo));
		assert.equal(dicho.length, 1);
		assert.equal(dicho[0]!.text, "Ojo: ¿y si hay ciclos?");
		assert.equal(vozActual!.leyendo, "c2-m0");
	});

	it("una respuesta nueva del tutor en un hilo se lee; la del propio David no", async () => {
		const hilo = comentario("c1", ["Pregunta", "Mi respuesta"]);
		const p = await montar(CON(hilo));
		await p.clic(p.interruptor());
		await p.pintar(CON({ ...hilo, thread: [...hilo.thread, { id: "c1-m2", role: "tutor", text: "Entonces ¿qué cambia?", at: T }] }));
		assert.equal(dicho.length, 1);
		assert.equal(dicho[0]!.text, "Entonces ¿qué cambia?");
		await p.pintar(CON({ ...hilo, thread: [...hilo.thread, { id: "c1-m2", role: "tutor", text: "Entonces ¿qué cambia?", at: T }, { id: "c1-m3", role: "david", text: "Nada", at: T }] }));
		assert.equal(dicho.length, 1);
	});

	it("apagado no lee, y lo que llegó mientras estaba apagado no se lee al encender", async () => {
		const p = await montar(CON(VIEJO));
		await p.pintar(CON(VIEJO, comentario("c2", ["Nuevo en silencio"])));
		assert.equal(dicho.length, 0);
		await p.clic(p.interruptor());
		assert.equal(dicho.length, 0);
	});

	it("si llegan varios a la vez lee solo el último, y una lectura nueva sustituye a la anterior", async () => {
		const p = await montar(CON(VIEJO));
		await p.clic(p.interruptor());
		await p.pintar(CON(VIEJO, comentario("c2", ["Primero"]), comentario("c3", ["Segundo"])));
		assert.deepEqual(dicho.map(d => d.text), ["Segundo."]);
		await p.pintar(CON(VIEJO, comentario("c2", ["Primero"]), comentario("c3", ["Segundo"]), comentario("c4", ["Tercero"])));
		assert.deepEqual(dicho.map(d => d.text), ["Segundo.", "Tercero."]);
		assert.ok(cancelaciones >= 2, "la segunda cancela la primera");
	});

	it("apagar el interruptor detiene la lectura y olvida el recuerdo", async () => {
		const p = await montar(CON(VIEJO));
		await p.clic(p.interruptor());
		await p.pintar(CON(VIEJO, comentario("c2", ["Algo largo"])));
		const antes = cancelaciones;
		await p.clic(p.interruptor());
		assert.equal(vozActual!.leyendo, null);
		assert.ok(cancelaciones > antes);
		assert.equal(almacen.has("estudio.cuaderno.escuchar.nb1"), false);
	});

	it("el botón de un comentario lee aunque el interruptor esté apagado, y pulsarlo otra vez detiene", async () => {
		const p = await montar(CON(VIEJO));
		assert.equal(p.interruptor().getAttribute("aria-checked"), "false");
		const boton = () => p.doc.querySelector<HTMLElement>('[data-escuchar-mensaje="c1-m0"]');
		await p.clic(boton());
		assert.equal(dicho.length, 1);
		assert.equal(dicho[0]!.text, "¿Qué pasa con los pesos negativos?");
		assert.equal(boton()!.getAttribute("aria-label"), "Detener la lectura");
		await p.clic(boton());
		assert.equal(vozActual!.leyendo, null);
		assert.equal(boton()!.getAttribute("aria-label"), "Escuchar el comentario de Tutor");
	});

	it("Escape detiene la lectura", async () => {
		const p = await montar(CON(VIEJO));
		await p.clic(p.doc.querySelector('[data-escuchar-mensaje="c1-m0"]'));
		assert.equal(vozActual!.leyendo, "c1-m0");
		const e = p.evento("keydown", { key: "Escape" });
		await act(async () => { p.doc.dispatchEvent(e); });
		assert.equal(vozActual!.leyendo, null);
		// Con nada que detener, Escape no toca el motor.
		const antes = cancelaciones;
		await act(async () => { p.doc.dispatchEvent(p.evento("keydown", { key: "Escape" })); });
		assert.equal(cancelaciones, antes);
	});

	it("terminar la lectura limpia el estado del botón", async () => {
		const p = await montar(CON(VIEJO));
		await p.clic(p.doc.querySelector('[data-escuchar-mensaje="c1-m0"]'));
		await act(async () => { dicho[0]!.onend?.(); });
		assert.equal(vozActual!.leyendo, null);
	});

	it("sin voz en español avisa una sola vez, y sigue leyendo con la predeterminada", async () => {
		instalarVoz([voz("David", "en-US")]);
		const p = await montar(CON(VIEJO));
		await p.clic(p.interruptor());
		await p.esperar(10);
		assert.equal(vozActual!.aviso, "sin-espanol");
		assert.equal(p.doc.querySelectorAll('[role="status"]').length, 1);
		await p.pintar(CON(VIEJO, comentario("c2", ["Uno"])));
		await p.pintar(CON(VIEJO, comentario("c2", ["Uno"]), comentario("c3", ["Dos"])));
		assert.equal(p.doc.querySelectorAll('[role="status"]').length, 1, "el aviso no se repite");
		assert.equal(dicho.length, 2);
		assert.equal((dicho[1]!.voice as { name: string }).name, "David");
	});

	it("si el motor falla, lo dice y no se rompe nada", async () => {
		const p = await montar(CON(VIEJO));
		await p.clic(p.doc.querySelector('[data-escuchar-mensaje="c1-m0"]'));
		await act(async () => { dicho[0]!.onerror?.({ error: "synthesis-failed" }); });
		assert.equal(vozActual!.aviso, "fallo");
		await p.clic(p.doc.querySelector('[data-escuchar-mensaje="c1-m0"]'));
		assert.equal(vozActual!.aviso, null, "una lectura nueva limpia el fallo");
	});

	it("sin síntesis de voz el interruptor está desactivado, no hay botones y nada se rompe", async () => {
		Reflect.deleteProperty(globalThis, "speechSynthesis");
		const p = await montar(CON(VIEJO));
		assert.equal(p.interruptor().getAttribute("aria-disabled"), "true");
		assert.equal(p.doc.querySelector("[data-escuchar-mensaje]"), null);
		await p.clic(p.interruptor());
		assert.equal(p.interruptor().getAttribute("aria-checked"), "false");
		assert.equal(almacen.size, 0);
	});

	it("sin cuaderno todavía (cargando) no hace nada", async () => {
		const p = await montar(null);
		assert.equal(dicho.length, 0);
		await p.pintar(CON(VIEJO));
		assert.equal(dicho.length, 0, "lo que hay al cargar cuenta como visto");
	});
});
