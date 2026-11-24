/**
 * La cabecera del cuaderno con el propósito y la tinta (ticket 12f): una línea discreta con la tinta, el propósito escrito a
 * mano y, al escribir, las propuestas de un clic; «Solo escucha» como elección especial. Pintado en estático y, para el foco, el
 * teclado y los clics, montado sobre linkedom. La tinta pinta el subrayado de la frase y el filo de la tarjeta del margen.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { PROPUESTAS_A_LA_VISTA, PropositoCuaderno, TintaCuaderno, type CambioProposito } from "../components/estudio/proposito-cuaderno.tsx";
import { EditorCuadernoEstudio } from "../components/estudio/editor-cuadernos.tsx";
import { colorDeTinta } from "../components/estudio/tintas.ts";
import { PROPUESTAS_PROPOSITO, SOLO_ESCUCHA, type Cuaderno } from "../components/estudio/cuadernos.ts";

const nada = () => {};
const ESTADO = { tope: 40, usadas: 3, modeloEconomico: true };
const T = "2026-11-17T10:00:00.000Z";
const CUADERNO: Cuaderno = { id: "nb1", revision: 1, title: "Dijkstra", kind: "libre", unitId: null, documentId: null, areaId: null, createdAt: T, updatedAt: T, blocks: [] };
const NOTA = { id: "b1", kind: "nota" as const, symbol: null, text: "Funciona siempre que no haya ciclos negativos.", locator: "", quote: "" };
const COMENTARIO = {
	id: "c1", persona: "tutor", kind: "pregunta" as const, state: "abierto" as const, createdAt: T,
	anchor: { blockId: "b1", text: "ciclos negativos", start: 28, end: 44, prefix: "no haya ", suffix: "." },
	thread: [{ id: "m1", role: "tutor" as const, text: "¿Seguro?", at: T }],
};
const VISTA = { estado: ESTADO, leyendo: false, error: null };
const ACCIONES = { cambiar: nada, exportarMarkdown: nada, exportarAnki: nada, borrar: nada, practicar: nada, navegar: nada, cambiarModo: nada, fijarTope: nada };
const editor = (c: Cuaderno, extra: Partial<React.ComponentProps<typeof EditorCuadernoEstudio>> = {}) => renderToStaticMarkup(
	<EditorCuadernoEstudio cuaderno={c} unidades={[]} documentos={[]} guardado={{ tipo: "guardado" }} ocupado={false} proactivo={VISTA}
		acciones={{ ...ACCIONES, fijarProposito: nada }} {...extra} />,
);
const escapar = (s: string) => s.replace(/[()%]/g, "\\$&");

describe("la cabecera del cuaderno, sin propósito ni tinta", () => {
	it("la cabecera solo enseña lo esencial: el modo, «⋯» y el guardado; propósito, tinta y tope están en Propiedades", () => {
		const html = editor(CUADERNO);
		assert.match(html, /data-modo-interruptor/);
		assert.match(html, /data-mas-acciones/);
		assert.doesNotMatch(html, /Propósito del cuaderno/);
		assert.doesNotMatch(html, /Tinta de los comentarios/);
		assert.doesNotMatch(html, /data-tope/);
		assert.doesNotMatch(html, /data-escuchar-interruptor/, "la voz es una casilla del menú «⋯»");
		assert.doesNotMatch(html, /aria-label="Propiedades del cuaderno"/, "Propiedades se abre desde «⋯»");
		assert.match(html, /aria-label="Página"/);
		assert.equal((html.match(/data-block-id=/g) ?? []).length, 1, "la página sigue limpia: solo el hueco para escribir");
	});

	it("con «Solo escucha» guardado, la cabecera es coherente: apagado y «Cuando se lo pido», sin contador", () => {
		const html = editor({ ...CUADERNO, proposito: SOLO_ESCUCHA, modo: "a-peticion" });
		assert.match(html, /role="switch"[^>]*aria-checked="false"/);
		assert.match(html, />Cuando se lo pido</);
		assert.doesNotMatch(html, /3 de 40/);
	});
});

describe("el propósito y la tinta en Propiedades, pintados", () => {
	it("sin propósito: el campo vacío con su etiqueta y las propuestas a la vista, sin «Solo escucha»", () => {
		const html = renderToStaticMarkup(<PropositoCuaderno fijar={nada} />);
		assert.match(html, />Para qué</);
		assert.match(html, /<input[^>]*aria-label="Propósito del cuaderno"[^>]*placeholder="Para qué es este cuaderno…"/);
		assert.match(html, /<input[^>]*maxLength="200"/i);
		assert.match(html, /Pregúntame antes del examen/);
		assert.doesNotMatch(html, />Solo escucha</);
		assert.doesNotMatch(html, /data-escucha/);
	});

	it("con propósito lo muestra en el campo", () => {
		assert.match(renderToStaticMarkup(<PropositoCuaderno proposito="Preparar el examen de grafos" fijar={nada} />), /value="Preparar el examen de grafos"/);
	});

	it("un cuaderno que guardó «Solo escucha» lo cuenta y dice cómo quitarlo", () => {
		const html = renderToStaticMarkup(<PropositoCuaderno proposito={SOLO_ESCUCHA} fijar={nada} />);
		assert.match(html, /value="Solo escucha"/);
		assert.match(html, /data-escucha[^>]*>Solo escucha: el tutor no comenta por su cuenta; contesta cuando se lo pides\. Escribe otro propósito para quitarlo\./);
	});

	it("la tinta dice cuál es y a quién afecta", () => {
		const html = renderToStaticMarkup(<TintaCuaderno fijar={nada} />);
		assert.match(html, /aria-label="Tinta de los comentarios: Acento"/);
		assert.match(html, /El color de los comentarios del Profesor y de tus personajes con tinta «Acento»/);
		assert.match(renderToStaticMarkup(<TintaCuaderno tinta="verde" fijar={nada} />), /aria-label="Tinta de los comentarios: Verde"/);
	});
});

describe("la tinta pinta los comentarios del cuaderno", () => {
	const conComentario = (extra: Partial<Cuaderno> = {}) => editor({ ...CUADERNO, blocks: [NOTA], comments: [COMENTARIO], ...extra });

	it("sin tinta elegida, la del acento; con ella, la elegida, en el contenedor de la página", () => {
		assert.match(conComentario(), new RegExp(`data-notebook-id="nb1"[^>]*--tinta-margen:${escapar(colorDeTinta("acento"))}`));
		const rojo = conComentario({ tinta: "rojo" });
		assert.match(rojo, new RegExp(`--tinta-margen:${escapar(colorDeTinta("rojo"))}`));
		assert.doesNotMatch(rojo, new RegExp(`--tinta-margen:${escapar(colorDeTinta("acento"))}`));
	});

	it("el subrayado y el filo de la tarjeta leen la variable de la tinta, no un color fijo", () => {
		const html = conComentario({ tinta: "verde" });
		assert.match(html, /shadow-\[0_2px_0_0_var\(--tinta-margen\)\]/, "subrayado de la frase");
		// Guía de diseño: sin raya izquierda; la tinta tiñe el fondo de la tarjeta.
		assert.match(html, /<article[^>]*background-color:color-mix\(in oklab, var\(--tinta-margen/, "fondo teñido de la tarjeta");
		assert.doesNotMatch(html, /--tinta-margen:var\(--tinta-margen/, "sin variable que se refiera a sí misma");
	});
});

let root: Root | null = null;
let restore: (() => void) | null = null;

function montar() {
	const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
	const globals: Record<string, unknown> = {
		window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
		SVGElement: dom.window.SVGElement, IS_REACT_ACT_ENVIRONMENT: true,
	};
	const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	Object.assign(globalThis, globals);
	Object.assign(dom.window.HTMLElement.prototype, { focus() {}, attachEvent() {}, detachEvent() {} });
	Object.assign(dom.window.HTMLInputElement.prototype, { select() {} });
	root = createRoot(dom.document.querySelector("#root")!);
	restore = () => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } };
	return { dom };
}

afterEach(async () => {
	await act(async () => { root?.unmount(); });
	root = null;
	restore?.();
	restore = null;
});

async function pintar(props: Partial<React.ComponentProps<typeof PropositoCuaderno>> = {}) {
	const f = montar();
	const cambios: CambioProposito[] = [];
	await act(async () => { root!.render(<PropositoCuaderno fijar={c => cambios.push(c)} {...props} />); });
	const q = <E extends Element>(sel: string) => f.dom.document.querySelector<E>(sel);
	const evento = (tipo: string, extra: Record<string, unknown> = {}) =>
		Object.assign(new f.dom.window.Event(tipo, { bubbles: true, cancelable: true }), { key: "", detail: 1, button: 0, ...extra });
	const clic = async (el: Element) => { await act(async () => { el.dispatchEvent(evento("click")); }); };
	const escribir = async (el: Element, valor: string) => {
		await act(async () => {
			// El campo tiene el foco al escribir: React sigue el cambio desde el `focusin` (ver divergencias, pruebas DOM).
			el.dispatchEvent(evento("focusin"));
			(el as unknown as { value: string }).value = valor;
			el.dispatchEvent(evento("input"));
		});
	};
	const tecla = async (el: Element, key: string) => { await act(async () => { el.dispatchEvent(evento("keydown", { key })); }); };
	return { ...f, cambios, q, clic, escribir, tecla, evento };
}

describe("el propósito, montado", () => {
	it("las propuestas están a la vista, en su orden, sin «Solo escucha», que repetía el interruptor del modo", async () => {
		const f = await pintar();
		const botones = [...f.dom.document.querySelectorAll("[data-propuesta]")].map(b => b.textContent);
		assert.deepEqual(botones, ["Pregúntame antes del examen", "Busca mis errores", "Conéctalo con lo que ya sé"]);
		assert.deepEqual(botones, [...PROPUESTAS_A_LA_VISTA]);
		assert.deepEqual(PROPUESTAS_A_LA_VISTA, PROPUESTAS_PROPOSITO.filter(p => p !== SOLO_ESCUCHA));
	});

	it("elegir una propuesta rellena la línea y la guarda; David puede seguir editándola", async () => {
		const f = await pintar();
		await f.clic(f.dom.document.querySelectorAll("[data-propuesta]")[1]!);
		assert.deepEqual(f.cambios, [{ proposito: "Busca mis errores" }]);
		const campo = f.q<HTMLInputElement>("input")!;
		assert.equal(campo.value, "Busca mis errores");
		await f.escribir(campo, "Busca mis errores de notación");
		await f.tecla(campo, "Enter");
		assert.deepEqual(f.cambios.at(-1), { proposito: "Busca mis errores de notación" });
	});

	it("Intro guarda lo escrito en una línea; Escape lo deja como estaba; sin cambios no manda nada", async () => {
		const f = await pintar({ proposito: "Repasar" });
		const campo = f.q<HTMLInputElement>("input")!;
		await f.tecla(campo, "Enter");
		assert.deepEqual(f.cambios, [], "igual que lo guardado");
		await f.escribir(campo, "  Preparar   el examen ");
		await f.tecla(campo, "Escape");
		assert.equal(campo.value, "Repasar");
		assert.deepEqual(f.cambios, []);
		await f.escribir(campo, "  Preparar   el examen ");
		await f.tecla(campo, "Enter");
		assert.deepEqual(f.cambios, [{ proposito: "Preparar el examen" }]);
	});

	it("vaciar el campo quita el propósito", async () => {
		const f = await pintar({ proposito: "Repasar" });
		const campo = f.q<HTMLInputElement>("input")!;
		await f.escribir(campo, "   ");
		await f.tecla(campo, "Enter");
		assert.deepEqual(f.cambios, [{ proposito: null }]);
	});

	it("con «Solo escucha» elegido, la nota lo cuenta y cambiar de propósito es escribir otro o elegir otra propuesta", async () => {
		const f = await pintar({ proposito: SOLO_ESCUCHA });
		assert.match(f.q("[data-escucha]")!.textContent!, /^Solo escucha: el tutor no comenta por su cuenta/);
		await f.clic(f.dom.document.querySelectorAll("[data-propuesta]")[0]!);
		assert.deepEqual(f.cambios, [{ proposito: "Pregúntame antes del examen" }]);
	});
});
