/**
 * La página del cuaderno (ticket 12a) sin pantalla: deducción del símbolo (la misma que la del plugin), huecos que no se
 * guardan, menú `/` y las ediciones de párrafos.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composeNote, deduceNote } from "../plugins/estudio/src/notebooks/types.ts";
import { SIMBOLOS, type BloqueCuaderno } from "../components/estudio/cuadernos.ts";
import {
	INSERTABLES, bloquesParaGuardar, componerNota, deducirNota, dividirNota, insertarEspecial, moverBloque, notaVacia, opcionesDeBarra,
	partirTexto, quitarBloque, bloqueVacio, camposDeBloque, vecinoDeCampo, retrocederNota, textoDeNota, tintaDe, type Nota,
} from "../components/estudio/pagina.ts";

const nota = (id: string, text: string, extra: Partial<Nota> = {}): Nota => ({ id, kind: "nota", symbol: null, text, locator: "", quote: "", ...extra });

describe("deducción del símbolo", () => {
	it("coincide con la del plugin para los 18 símbolos y para los casos sin símbolo", () => {
		const casos = [
			...SIMBOLOS.map(s => `${s} algo`), "? ", "?  dos", "?pegado", "  → sangría", "Dijo → que", "→\nsalto", "Ideal", "", "texto libre",
		];
		for (const c of casos) assert.deepEqual(deducirNota(c), deduceNote(c), JSON.stringify(c));
		for (const s of SIMBOLOS) assert.equal(componerNota(s, "x"), composeNote(s, "x"));
		assert.equal(componerNota(null, "x"), composeNote(null, "x"));
	});

	it("la lista de símbolos del cliente es la del plugin", async () => {
		const { SYMBOLS } = await import("../plugins/estudio/src/notebooks/types.ts");
		assert.deepEqual([...SIMBOLOS], [...SYMBOLS]);
	});

	it("cada símbolo tiene su tinta", () => {
		for (const s of SIMBOLOS) assert.match(tintaDe(s), /^text-/, s);
	});

	it("una nota antigua con símbolo se compone como el párrafo que se verá", () => {
		assert.equal(textoDeNota(nota("a", "Relaja aristas", { symbol: "→" })), "→ Relaja aristas");
		assert.equal(textoDeNota(nota("b", "I think so")), "I think so");
	});
});

describe("huecos y guardado", () => {
	it("una nota sin texto, símbolo ni cita es un hueco; con cita o con símbolo, no", () => {
		assert.equal(notaVacia(nota("a", "")), true);
		assert.equal(notaVacia(nota("a", "", { quote: "cita" })), false);
		assert.equal(notaVacia(nota("a", "", { symbol: "?" })), false);
		assert.equal(notaVacia(nota("a", "", { locator: "p. 2" })), false);
		assert.equal(notaVacia({ id: "e", kind: "error", wrong: "", cause: "", fix: "" }), false);
	});

	it("al guardar se quitan los huecos y se conserva el resto, en orden", () => {
		const bloques: BloqueCuaderno[] = [nota("a", "uno"), nota("b", ""), nota("c", "", { quote: "q", locator: "p. 2" }), nota("d", "")];
		assert.deepEqual(bloquesParaGuardar(bloques).map(b => b.id), ["a", "c"]);
	});
});

describe("menú /", () => {
	it("solo se abre con una barra seguida de una palabra y filtra sin importar tildes ni mayúsculas", () => {
		assert.equal(opcionesDeBarra("hola"), null);
		assert.equal(opcionesDeBarra("/ dos palabras"), null);
		assert.equal(opcionesDeBarra("a /"), null);
		assert.deepEqual(opcionesDeBarra("/")?.map(o => o.kind), ["error", "recuperacion"]);
		assert.deepEqual(opcionesDeBarra("/err")?.map(o => o.kind), ["error"]);
		assert.deepEqual(opcionesDeBarra("/ERR")?.map(o => o.kind), ["error"]);
		assert.deepEqual(opcionesDeBarra("/pregunta")?.map(o => o.kind), ["recuperacion"]);
		assert.deepEqual(opcionesDeBarra("/recuperacion")?.map(o => o.kind), ["recuperacion"]);
		assert.deepEqual(opcionesDeBarra("/zzz"), []);
		assert.equal(INSERTABLES.length, 2);
	});

	it("elegir una opción convierte el párrafo de la barra en el bloque, con su id, y enfoca su primer campo", () => {
		const out = insertarEspecial([nota("a", "uno"), nota("b", "/er")], 1, "error", "nuevo");
		assert.deepEqual(out.blocks[1], { id: "nuevo", kind: "error", wrong: "", cause: "", fix: "" });
		assert.deepEqual(out.foco, { id: "nuevo", campo: "wrong", pos: 0 });
		const q = insertarEspecial([nota("a", "/")], 0, "recuperacion", "q");
		assert.deepEqual(q.blocks[0], { id: "q", kind: "recuperacion", question: "", answer: "" });
		assert.equal(q.foco?.campo, "question");
	});
});

describe("ediciones de párrafos", () => {
	it("Intro parte el párrafo en el cursor y deduce el símbolo de cada mitad", () => {
		const out = dividirNota([nota("a", "uno dos")], 0, 3, "b");
		assert.deepEqual(out.blocks.map(b => b.kind === "nota" && [b.id, b.symbol, b.text]), [["a", null, "uno"], ["b", null, " dos"]]);
		assert.deepEqual(out.foco, { id: "b", campo: "texto", pos: 0 });
		// Lo que queda tras el cursor empieza por un símbolo: el párrafo nuevo lo reconoce.
		const sim = dividirNota([nota("a", "idea → relación")], 0, 5, "b");
		assert.deepEqual(sim.blocks.map(b => b.kind === "nota" && [b.symbol, b.text]), [[null, "idea "], ["→", "relación"]]);
		const alFinal = dividirNota([nota("a", "dato", { symbol: "#" })], 0, 6, "b");
		assert.deepEqual(alFinal.blocks.map(b => b.kind === "nota" && [b.symbol, b.text]), [["#", "dato"], [null, ""]]);
	});

	it("Intro conserva la cita y el localizador en la primera mitad", () => {
		const out = dividirNota([nota("a", "comentario", { quote: "cita", locator: "p. 3" })], 0, 10, "b");
		assert.equal((out.blocks[0] as Nota).quote, "cita");
		assert.equal((out.blocks[0] as Nota).locator, "p. 3");
		assert.equal((out.blocks[1] as Nota).quote, "");
	});

	it("Retroceso en un párrafo vacío lo quita y enfoca el final del anterior", () => {
		const out = retrocederNota([nota("a", "uno"), nota("b", "")], 1)!;
		assert.deepEqual(out.blocks.map(b => b.id), ["a"]);
		assert.deepEqual(out.foco, { id: "a", campo: "texto", pos: "fin" });
		assert.equal(retrocederNota([nota("a", "")], 0), null);
		assert.equal(retrocederNota([nota("a", "uno"), nota("b", "", { quote: "q" })], 1), null);
	});

	it("Retroceso en un párrafo con texto lo une al anterior y deja el cursor en la unión", () => {
		const out = retrocederNota([nota("a", "uno"), nota("b", " dos")], 1)!;
		assert.deepEqual(out.blocks.map(b => b.kind === "nota" && [b.id, b.text]), [["a", "uno dos"]]);
		assert.deepEqual(out.foco, { id: "a", campo: "texto", pos: 3 });
		assert.equal(retrocederNota([nota("a", "uno"), nota("b", "dos", { quote: "q" })], 1), null);
		assert.equal(retrocederNota([{ id: "e", kind: "error", wrong: "", cause: "", fix: "" }, nota("b", "dos")], 1), null);
	});

	it("mover un bloque lo intercambia con su vecino y no sale de los extremos", () => {
		const b = [nota("a", "1"), nota("b", "2"), nota("c", "3")];
		assert.deepEqual(moverBloque(b, 0, 1).map(x => x.id), ["b", "a", "c"]);
		assert.deepEqual(moverBloque(b, 2, -1).map(x => x.id), ["a", "c", "b"]);
		assert.equal(moverBloque(b, 0, -1), b);
		assert.equal(moverBloque(b, 2, 1), b);
	});
});

describe("texto pegado con saltos de línea (limitación del 12a)", () => {
	const ids = () => { let n = 0; return () => `n${++n}`; };

	it("cada línea pasa a ser un párrafo, con su símbolo deducido, y el cursor queda donde terminó el pegado", () => {
		const crudo = "→ uno\n? dos\ntres";
		const out = partirTexto([nota("a", "")], 0, nota("a", ""), crudo, crudo.length, ids());
		assert.deepEqual(out.blocks.map(b => b.kind === "nota" && [b.id, b.symbol, b.text]), [["a", "→", "uno"], ["n1", "?", "dos"], ["n2", null, "tres"]]);
		assert.deepEqual(out.foco, { id: "n2", campo: "texto", pos: 4 });
	});

	it("las líneas en blanco no crean párrafos vacíos y lo que seguía al cursor queda en el último párrafo", () => {
		// «ab|cd» con «X, línea en blanco, Y» pegado entre medias: «abX» e «Ycd»
		const crudo = "abX\n\nYcd";
		const out = partirTexto([nota("p", "ab"), nota("q", "fin")], 0, nota("p", "ab"), crudo, 6, ids());
		assert.deepEqual(out.blocks.map(b => b.kind === "nota" && [b.id, b.text]), [["p", "abX"], ["n1", "Ycd"], ["q", "fin"]]);
		assert.deepEqual(out.foco, { id: "n1", campo: "texto", pos: 1 });
	});

	it("un salto al final deja un párrafo nuevo con el cursor; el primer párrafo conserva la cita y el localizador", () => {
		const crudo = "texto\n";
		const b = nota("a", "texto", { quote: "cita", locator: "p. 2" });
		const out = partirTexto([b], 0, b, crudo, crudo.length, ids());
		assert.equal(out.blocks.length, 2);
		assert.equal((out.blocks[0] as Nota).quote, "cita");
		assert.equal((out.blocks[1] as Nota).quote, "");
		assert.deepEqual(out.foco, { id: "n1", campo: "texto", pos: 0 });
	});

	it("en el hueco final los párrafos se añaden tras los bloques existentes", () => {
		const hueco = nota("h", "");
		const e: BloqueCuaderno = { id: "e", kind: "error", wrong: "", cause: "", fix: "" };
		const out = partirTexto([e], 1, hueco, "uno\ndos", 7, ids());
		assert.deepEqual(out.blocks.map(b => b.id), ["e", "h", "n1"]);
	});
});

describe("salir de los bloques con el teclado (limitación del 12a)", () => {
	const err: BloqueCuaderno = { id: "e", kind: "error", wrong: "", cause: "", fix: "" };
	const preg: BloqueCuaderno = { id: "q", kind: "recuperacion", question: "", answer: "" };
	const vista = [nota("a", "uno"), err, preg, nota("h", "")];

	it("cada bloque tiene sus campos en orden", () => {
		assert.deepEqual(camposDeBloque(err), ["wrong", "cause", "fix"]);
		assert.deepEqual(camposDeBloque(preg), ["question", "answer"]);
		assert.deepEqual(camposDeBloque(vista[0]!), ["texto"]);
	});

	it("la flecha de abajo pasa al campo siguiente y, desde el último, al principio del bloque siguiente", () => {
		assert.deepEqual(vecinoDeCampo(vista, 1, "wrong", 1), { id: "e", campo: "cause", pos: 0 });
		assert.deepEqual(vecinoDeCampo(vista, 1, "fix", 1), { id: "q", campo: "question", pos: 0 });
		assert.deepEqual(vecinoDeCampo(vista, 0, "texto", 1), { id: "e", campo: "wrong", pos: 0 });
	});

	it("la flecha de arriba pasa al campo anterior y, desde el primero, al final del bloque anterior", () => {
		assert.deepEqual(vecinoDeCampo(vista, 1, "fix", -1), { id: "e", campo: "cause", pos: "fin" });
		assert.deepEqual(vecinoDeCampo(vista, 2, "question", -1), { id: "e", campo: "fix", pos: "fin" });
		assert.deepEqual(vecinoDeCampo(vista, 3, "texto", -1), { id: "q", campo: "answer", pos: "fin" });
	});

	it("en los extremos de la página no hay adónde ir", () => {
		assert.equal(vecinoDeCampo(vista, 0, "texto", -1), null);
		assert.equal(vecinoDeCampo(vista, 3, "texto", 1), null);
	});

	it("un bloque de error o de pregunta sin nada escrito es un bloque vacío; con algo, no", () => {
		assert.equal(bloqueVacio(err), true);
		assert.equal(bloqueVacio(preg), true);
		assert.equal(bloqueVacio({ ...err, cause: "x" }), false);
		assert.equal(bloqueVacio({ ...preg, answer: "x" }), false);
		assert.equal(bloqueVacio(nota("a", "")), false, "un párrafo vacío lo trata Retroceso con retrocederNota");
	});

	it("quitar un bloque deja el cursor en el final del anterior o, si era el primero, en el principio del siguiente", () => {
		const a = quitarBloque([nota("a", "uno"), { ...err, wrong: "x" }, nota("b", "dos")], 1);
		assert.deepEqual(a.blocks.map(b => b.id), ["a", "b"]);
		assert.deepEqual(a.foco, { id: "a", campo: "texto", pos: "fin" });
		const primero = quitarBloque([err, nota("b", "dos")], 0);
		assert.deepEqual(primero.foco, { id: "b", campo: "texto", pos: 0 });
		assert.equal(quitarBloque([err], 0).foco, null);
	});
});
