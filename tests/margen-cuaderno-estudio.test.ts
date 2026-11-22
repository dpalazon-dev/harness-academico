/**
 * El margen del cuaderno (ticket 12b) sin pantalla: anclaje de un comentario a un fragmento, qué pasa cuando David
 * edita, orden del margen, trozos resaltados y apilado.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BloqueCuaderno, Comentario } from "../components/estudio/cuadernos.ts";
import { anclaDeSeleccion, apilar, colocar, resolverAncla, segmentos, visibles } from "../components/estudio/margen.ts";
import type { Nota } from "../components/estudio/pagina.ts";

const nota = (id: string, text: string, symbol: Nota["symbol"] = null): Nota => ({ id, kind: "nota", symbol, text, locator: "", quote: "" });
const comentario = (id: string, anchor: Comentario["anchor"], state: Comentario["state"] = "abierto"): Comentario => ({
	id, anchor, persona: "tutor", kind: "pregunta", state, createdAt: "2026-11-16T10:00:00.000Z", thread: [{ id: `m-${id}`, role: "tutor", text: "¿Seguro?", at: "2026-11-16T10:00:00.000Z" }],
});

const A = nota("a", "Un embedding es un vector denso aprendido.");
const B = nota("b", "Dijkstra no admite pesos negativos.", "C:");
const ancla = (b: Nota, frase: string) => {
	const texto = b.symbol ? `${b.symbol} ${b.text}` : b.text;
	const i = texto.indexOf(frase);
	return anclaDeSeleccion(b, i, i + frase.length)!;
};

describe("anclaje de un fragmento", () => {
	it("la selección de un párrafo da un ancla con su texto, su posición y lo que lo rodea", () => {
		const a = ancla(A, "vector denso");
		assert.deepEqual([a.blockId, a.text, a.start, a.end], ["a", "vector denso", 19, 31]);
		assert.equal(a.prefix, "Un embedding es un ");
		assert.equal(a.suffix, " aprendido.");
	});

	it("una selección vacía o de solo espacios no se ancla; los límites invertidos valen", () => {
		assert.equal(anclaDeSeleccion(A, 5, 5), null);
		assert.equal(anclaDeSeleccion(nota("x", "a    b"), 1, 5), null);
		assert.equal(anclaDeSeleccion(A, 31, 19)!.text, "vector denso");
	});

	it("se reencuentra en el mismo párrafo aunque se edite lo de antes, y con el símbolo cuenta en los límites", () => {
		const a = ancla(A, "vector denso");
		const editado = nota("a", "Resumiendo: un embedding es un vector denso aprendido.");
		assert.deepEqual(resolverAncla([editado, B], a), { blockId: "a", start: 31, end: 43 });
		const c = ancla(B, "pesos negativos");
		assert.deepEqual(resolverAncla([A, B], c), { blockId: "b", start: 22, end: 37 });
	});

	it("sobrevive a editar otros párrafos y a mover el suyo", () => {
		const a = ancla(A, "vector denso");
		assert.equal(resolverAncla([nota("z", "Nuevo"), B, A], a)?.blockId, "a");
		assert.equal(resolverAncla([A, nota("b", "Otra cosa distinta")], a)?.blockId, "a");
	});

	it("si el párrafo se parte, el fragmento se encuentra en el párrafo que lo conserva", () => {
		const a = ancla(A, "vector denso");
		const partido = [nota("a", "Un embedding es"), nota("n", "un vector denso aprendido.")];
		assert.deepEqual(resolverAncla(partido, a), { blockId: "n", start: 3, end: 15 });
	});

	it("si la frase se borra o se cambia queda sin sitio; si hay dos candidatos no se adivina", () => {
		const a = ancla(A, "vector denso");
		assert.equal(resolverAncla([nota("a", "Un embedding es una lista de números.")], a), null);
		assert.equal(resolverAncla([nota("a", "otra cosa"), nota("b", "vector denso"), nota("c", "un vector denso")], a), null);
		assert.equal(resolverAncla([], a), null);
	});

	it("dos apariciones en el mismo párrafo se distinguen por lo que las rodea", () => {
		const p = nota("p", "El vector denso A y el vector denso B son distintos.");
		const segunda = anclaDeSeleccion(p, p.text.lastIndexOf("vector denso"), p.text.lastIndexOf("vector denso") + 12)!;
		assert.deepEqual(resolverAncla([p], segunda), { blockId: "p", start: 23, end: 35 });
	});
});

describe("orden del margen", () => {
	it("los anclados van por su posición en la página y los sin frase, al final, como llegaron", () => {
		const blocks: BloqueCuaderno[] = [A, B];
		const huerfano1 = comentario("h1", { blockId: "z", text: "desaparecida", start: 0, end: 12, prefix: "", suffix: "" });
		const huerfano2 = comentario("h2", { blockId: "z", text: "también", start: 0, end: 7, prefix: "", suffix: "" });
		const enB = comentario("cb", ancla(B, "pesos negativos"));
		const enA2 = comentario("ca2", ancla(A, "aprendido"));
		const enA1 = comentario("ca1", ancla(A, "embedding"));
		const orden = colocar(blocks, [huerfano1, enB, enA2, huerfano2, enA1]).map(p => [p.item.id, p.sitio?.blockId ?? null]);
		assert.deepEqual(orden, [["ca1", "a"], ["ca2", "a"], ["cb", "b"], ["h1", null], ["h2", null]]);
	});

	it("los descartados no se ven y un cuaderno sin comentarios no tiene margen", () => {
		const c1 = comentario("c1", ancla(A, "embedding")), c2 = comentario("c2", ancla(A, "denso"), "descartado"), c3 = comentario("c3", ancla(A, "aprendido"), "atendido");
		assert.deepEqual(visibles([c1, c2, c3]).map(c => c.id), ["c1", "c3"]);
		assert.deepEqual(visibles(undefined), []);
	});
});

describe("trozos resaltados", () => {
	it("parte el texto donde empieza o acaba un rango y dice qué rangos cubren cada trozo", () => {
		const trozos = segmentos("0123456789", [{ id: "x", start: 2, end: 6 }, { id: "y", start: 4, end: 8 }]);
		assert.deepEqual(trozos.map(s => [s.texto, s.ids]), [["01", []], ["23", ["x"]], ["45", ["x", "y"]], ["67", ["y"]], ["89", []]]);
		assert.equal(trozos.map(s => s.texto).join(""), "0123456789");
	});

	it("sin rangos es un solo trozo, y los cortes parten sin resaltar (el símbolo del párrafo)", () => {
		assert.deepEqual(segmentos("? algo", []), [{ texto: "? algo", inicio: 0, ids: [] }]);
		assert.deepEqual(segmentos("? algo", [], [1, 2]).map(s => s.texto), ["?", " ", "algo"]);
		assert.deepEqual(segmentos("", []), []);
	});
});

describe("apilado del margen", () => {
	it("cada comentario a la altura de su párrafo si cabe", () => {
		assert.deepEqual(apilar([{ deseo: 0, alto: 40 }, { deseo: 100, alto: 40 }]), [0, 100]);
	});

	it("uno alto empuja a los siguientes, con un hueco entre ellos", () => {
		assert.deepEqual(apilar([{ deseo: 10, alto: 100 }, { deseo: 50, alto: 30 }, { deseo: 60, alto: 30 }], 8), [10, 118, 156]);
	});

	it("los que no tienen sitio van justo después del último", () => {
		assert.deepEqual(apilar([{ deseo: 20, alto: 40 }, { deseo: null, alto: 30 }, { deseo: null, alto: 30 }], 8), [20, 68, 106]);
		assert.deepEqual(apilar([]), []);
	});
});

describe("respuestas del tutor sin leer (limitación del 12c)", () => {
	it("una respuesta que llega con el hilo cerrado queda sin leer; con ese hilo abierto, no", async () => {
		const { SIN_HILOS, conRespuestaNueva, sinRespuestaNueva } = await import("../components/estudio/margen.ts");
		const cerrado = conRespuestaNueva(SIN_HILOS, "c1");
		assert.deepEqual(cerrado.sinLeer, { c1: true });
		assert.equal(conRespuestaNueva({ ...SIN_HILOS, abierto: "c1" }, "c1").sinLeer, undefined, "David la está leyendo");
		assert.deepEqual(conRespuestaNueva({ ...SIN_HILOS, abierto: "c2" }, "c1").sinLeer, { c1: true }, "otro hilo abierto no la lee");
		assert.equal(Object.keys(sinRespuestaNueva(cerrado, "c1").sinLeer ?? {}).length, 0);
		assert.equal(sinRespuestaNueva(SIN_HILOS, "c1"), SIN_HILOS, "sin nada que limpiar no cambia");
	});
});
