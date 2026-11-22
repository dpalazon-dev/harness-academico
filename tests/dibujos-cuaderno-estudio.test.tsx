/**
 * Los dibujos del tutor en Cuadernos (ticket 12h), pintados en estático y en puro: el botón «Dibújalo», el dibujo bajo su párrafo,
 * en el hilo y en la tarjeta de un comentario sin su frase, el error de un Mermaid que no compila, y lo que se le pasa al
 * renderizador (la tinta y el tema, y nunca una directiva del modelo). El render real de Mermaid se comprueba a mano en la app.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EditorCuadernoEstudio } from "../components/estudio/editor-cuadernos.tsx";
import { BarraSeleccion } from "../components/estudio/margen-cuaderno.tsx";
import { DibujoMarco, altoMinimo, directivaDeTema, mezclar, sinDirectivas } from "../components/estudio/dibujo-mermaid.tsx";
import { PETICIONES } from "../components/estudio/margen.ts";
import { SIN_HILOS } from "../components/estudio/margen.ts";
import type { Cuaderno, Comentario } from "../components/estudio/cuadernos.ts";

const nada = () => {};
const GRAFO = 'flowchart TD\n  A["Elegir el nodo"] --> B["Relajar vecinos"]';
const T = "2026-11-20T10:00:00.000Z";

const comentario = (extra: Partial<Comentario> = {}): Comentario => ({
	id: "c1", anchor: { blockId: "n1", text: "relaja", start: 0, end: 6, prefix: "", suffix: " aristas" }, persona: "tutor", firma: "Profesor", kind: "dibujo", state: "abierto", createdAt: T,
	thread: [{ id: "m1", role: "tutor", text: "Los pasos, en esquema.", at: T }],
	dibujos: [{ id: "d1", mermaid: GRAFO, mensajeId: "m1" }],
	...extra,
});
const CUADERNO: Cuaderno = {
	id: "nb1", revision: 3, title: "Dijkstra", kind: "libre", unitId: null, documentId: null, areaId: null, createdAt: T, updatedAt: T,
	blocks: [
		{ id: "n1", kind: "nota", symbol: null, text: "relaja aristas en orden", locator: "", quote: "" },
		{ id: "n2", kind: "nota", symbol: null, text: "Otro párrafo", locator: "", quote: "" },
	],
	comments: [comentario()],
};
const editor = (props: Partial<React.ComponentProps<typeof EditorCuadernoEstudio>> = {}) => renderToStaticMarkup(
	<EditorCuadernoEstudio cuaderno={CUADERNO} unidades={[]} documentos={[]} guardado={{ tipo: "guardado" }} ocupado={false}
		acciones={{ cambiar: nada, exportarMarkdown: nada, exportarAnki: nada, borrar: nada, practicar: nada, navegar: nada, quitarDibujo: nada }} {...props} />,
);
const conComentarios = (comments: Comentario[]) => ({ cuaderno: { ...CUADERNO, comments } });

describe("«Dibújalo»", () => {
	it("es la tercera petición de la barra de la selección y pide un dibujo", () => {
		const html = renderToStaticMarkup(<BarraSeleccion pedir={nada} />);
		assert.match(html, /data-pedir="dibujo"[^>]*>[\s\S]*?Dibújalo/);
		assert.ok(html.indexOf('data-pedir="explicacion"') < html.indexOf('data-pedir="dibujo"'));
		assert.deepEqual(PETICIONES.dibujo, { boton: "Dibújalo", etiqueta: "Dibujo" });
	});

	it("una petición de dibujo en curso dice que dibuja, no que piensa", () => {
		const html = editor({ cuaderno: { ...CUADERNO, comments: [] }, peticiones: [{ id: "p1", anchor: { blockId: "n1", text: "relaja", start: 0, end: 6, prefix: "", suffix: "" }, kind: "dibujo", estado: "pensando" }] });
		assert.match(html, /role="status"[^>]*>Dibujando…/);
	});
});

describe("el dibujo bajo el párrafo", () => {
	it("cuelga de su párrafo, dentro de la página, con quién lo dibujó y cómo quitarlo", () => {
		const html = editor();
		const li = /<li[^>]*data-block-id="n1"[\s\S]*?<\/li>/.exec(html)![0];
		assert.match(li, /data-dibujo="d1"/);
		assert.match(li, /<figcaption[\s\S]*?Dibujo[\s\S]*?data-firma="true">Profesor/);
		assert.match(li, /data-quitar-dibujo[^>]*aria-label="Quitar el dibujo"/);
		assert.equal(/<li[^>]*data-block-id="n2"[\s\S]*?<\/li>/.exec(html)![0].includes("data-dibujo"), false, "no cuelga de otro párrafo");
	});

	it("no es texto de David: el párrafo y los bloques guardados siguen como estaban", () => {
		const html = editor();
		assert.equal(html.includes("flowchart"), false, "el código no se pinta como texto de la página mientras no hay error");
		assert.equal(CUADERNO.blocks.length, 2);
	});

	it("sin dibujos la página es la de siempre: nada de figuras", () => {
		assert.equal(editor({ cuaderno: { ...CUADERNO, comments: [comentario({ dibujos: undefined, kind: "pregunta" })] } }).includes("data-dibujo"), false);
		assert.equal(editor({ cuaderno: { ...CUADERNO, comments: undefined } }).includes("data-dibujo"), false);
	});

	it("un comentario descartado se lleva su dibujo", () => {
		assert.equal(editor(conComentarios([comentario({ state: "descartado" })])).includes("data-dibujo"), false);
	});

	it("un comentario atendido conserva su dibujo bajo el párrafo", () => {
		assert.match(editor(conComentarios([comentario({ state: "atendido" })])), /<li[^>]*data-block-id="n1"[\s\S]*?data-dibujo="d1"/);
	});

	it("sin la acción de quitar no hay botón, pero el dibujo se ve", () => {
		const html = editor({ acciones: { cambiar: nada, exportarMarkdown: nada, exportarAnki: nada, borrar: nada, practicar: nada, navegar: nada } });
		assert.match(html, /data-dibujo="d1"/);
		assert.equal(html.includes("data-quitar-dibujo"), false);
	});

	it("con la frase perdida, el dibujo va en la tarjeta del margen, que no tiene párrafo del que colgar", () => {
		const perdido = comentario({ anchor: { blockId: "n1", text: "frase que ya no está", start: 0, end: 20, prefix: "", suffix: "" } });
		const html = editor(conComentarios([perdido]));
		const tarjeta = /<article[^>]*data-margen-id="c1"[\s\S]*?<\/article>/.exec(html)![0];
		assert.match(tarjeta, /data-sin-frase/);
		assert.match(tarjeta, /data-dibujo="d1"/);
	});
});

describe("el dibujo en el hilo", () => {
	it("con el hilo abierto, el dibujo cuelga del mensaje del tutor que lo trajo, además de bajo el párrafo", () => {
		const c = comentario({
			thread: [
				{ id: "m1", role: "tutor", text: "Una pregunta.", at: T }, { id: "m2", role: "david", text: "Dibújalo.", at: T }, { id: "m3", role: "tutor", text: "Aquí va.", at: T },
			],
			dibujos: [{ id: "d9", mermaid: GRAFO, mensajeId: "m3" }], kind: "pregunta",
		});
		const html = editor({ ...conComentarios([c]), hilos: { ...SIN_HILOS, abierto: "c1" }, acciones: { cambiar: nada, exportarMarkdown: nada, exportarAnki: nada, borrar: nada, practicar: nada, navegar: nada, responder: nada, abrirHilo: nada, cerrarHilo: nada, quitarDibujo: nada } });
		const hilo = /<div[^>]*data-hilo="c1"[\s\S]*?<\/ol>/.exec(html)![0];
		const mensajes = hilo.split("<li ").slice(1);
		assert.equal(mensajes.length, 3);
		assert.equal(mensajes[0]!.includes("data-dibujo"), false);
		assert.equal(mensajes[1]!.includes("data-dibujo"), false);
		assert.match(mensajes[2]!, /data-dibujo="hilo-d9"/);
		assert.match(html, /<li[^>]*data-block-id="n1"[\s\S]*?data-dibujo="d9"/);
	});
});

describe("un Mermaid que no compila", () => {
	it("muestra el error y el texto del diagrama, sin romper nada", () => {
		const html = renderToStaticMarkup(<DibujoMarco id="d1" estado={{ error: "Parse error on line 2" }} codigo={'flowchart TD\n  A --> '} firma="Profesor" quitar={nada} />);
		assert.match(html, /data-estado="error"/);
		assert.match(html, /role="alert"[^>]*>No se pudo dibujar: Parse error on line 2/);
		assert.match(html, /data-dibujo-codigo[^>]*>flowchart TD\n  A --&gt; </);
		assert.match(html, /data-quitar-dibujo/, "con error también se puede quitar");
	});

	it("escapa el texto del diagrama: el código del modelo nunca entra como marcado", () => {
		const html = renderToStaticMarkup(<DibujoMarco id="d1" estado={{ error: "<img src=x onerror=alert(1)>" }} codigo={'A["<script>alert(1)</script>"]'} firma="Profesor" />);
		assert.equal(html.includes("<script>"), false);
		assert.equal(html.includes("<img"), false);
		assert.match(html, /&lt;script&gt;/);
	});

	it("mientras se pinta dice que dibuja, y listo lo deja en una imagen con su descripción", () => {
		assert.match(renderToStaticMarkup(<DibujoMarco id="d1" estado={null} codigo={GRAFO} firma="Profesor" />), /role="status"[^>]*>Dibujando…/);
		const listo = renderToStaticMarkup(<DibujoMarco id="d1" estado={{ svg: "<svg></svg>" }} codigo={GRAFO} firma="Escéptico" />);
		assert.match(listo, /data-estado="listo"[\s\S]*?role="img"[^>]*aria-label="Dibujo de Escéptico"[^>]*><svg><\/svg>/);
	});
});

describe("lo que se le pasa al renderizador", () => {
	it("sinDirectivas quita las directivas del modelo, también las de varias líneas", () => {
		assert.equal(sinDirectivas(`%%{init: {"securityLevel": "loose", "theme": "forest"}}%%\n${GRAFO}`), GRAFO);
		assert.equal(sinDirectivas(`%%{\n  init: {"themeVariables": {}}\n}%%\n${GRAFO}`), GRAFO);
		assert.equal(sinDirectivas(GRAFO), GRAFO);
		assert.equal(sinDirectivas(`%%%%{a}%%{init: {"theme":"forest"}}%%\n${GRAFO}`).includes("%%{"), false, "una directiva anidada no se reconstruye");
		assert.equal(sinDirectivas(`---\nconfig:\n  theme: forest\n---\n${GRAFO}`), GRAFO);
	});

	it("la directiva del tema usa los colores de la tinta, del texto y del fondo, y es un JSON que se lee", () => {
		const d = directivaDeTema({ tinta: "#336699", texto: "#111111", fondo: "#fafafa" }, "ui-sans-serif, sans-serif");
		assert.match(d, /^%%\{init: \{"theme":"base","themeVariables":\{/);
		assert.ok(d.endsWith("}}%%"));
		const json = JSON.parse(d.slice("%%{init: ".length, -"}%%".length)) as { theme: string; themeVariables: Record<string, string> };
		const v = json.themeVariables;
		assert.equal((json as unknown as { htmlLabels: boolean }).htmlLabels, false, "etiquetas de texto SVG: sin HTML dentro del dibujo, y sin etiquetas recortadas");
		assert.equal(v.lineColor, "#336699");
		assert.equal(v.primaryBorderColor, "#336699");
		assert.equal(v.primaryTextColor, "#111111");
		assert.equal(v.background, "#fafafa");
		assert.equal(v.primaryColor, mezclar("#336699", "#fafafa", 14), "el relleno es la tinta muy diluida sobre el fondo");
		assert.equal(v.fontFamily, "ui-sans-serif, sans-serif", "la letra es la de la configuración del renderizador, la que mide las etiquetas");
		for (const [clave, valor] of Object.entries(v)) if (clave !== "fontFamily") assert.match(valor, /^#[0-9a-f]{6}$/, "solo colores que Mermaid sabe leer");
	});

	it("un diagrama muy alto no se encoge hasta ser una línea: su alto mínimo es el 60 % del natural", () => {
		assert.equal(altoMinimo('<svg id="x" width="100%" style="max-width: 682px;" viewBox="0.5 0 682.47 757.95" role="graphics-document">'), 455);
		assert.equal(altoMinimo('<svg viewBox="0 0 100 9000">'), 5400);
		assert.equal(altoMinimo("<svg></svg>"), 0);
		assert.equal(altoMinimo('<svg viewBox="0 0 100 NaN">'), 0);
		const html = renderToStaticMarkup(<DibujoMarco id="d1" estado={{ svg: '<svg viewBox="0 0 100 1000"></svg>' }} codigo="x" firma="Profesor" />);
		assert.match(html, /--alto-min:600px/);
	});

	it("mezclar da el color intermedio y respeta los extremos", () => {
		assert.equal(mezclar("#000000", "#ffffff", 50), "#808080");
		assert.equal(mezclar("#336699", "#ffffff", 100), "#336699");
		assert.equal(mezclar("#336699", "#ffffff", 0), "#ffffff");
	});
});
