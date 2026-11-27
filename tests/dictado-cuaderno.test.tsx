import assert from "node:assert/strict";
import { test } from "node:test";
import { insertarEnTexto } from "../components/estudio/dictado-cuaderno.tsx";

// Dictar en el cuaderno (ticket 12i): dónde entra el texto y que llega por el camino del teclado.

test("inserta en el cursor con un espacio solo donde hace falta", () => {
	assert.deepEqual(insertarEnTexto("", 0, 0, "Hola"), { valor: "Hola", pos: 4 });
	assert.deepEqual(insertarEnTexto("Primera idea", 12, 12, "y segunda"), { valor: "Primera idea y segunda", pos: 22 });
	assert.deepEqual(insertarEnTexto("Primera idea ", 13, 13, "y segunda"), { valor: "Primera idea y segunda", pos: 22 });
	assert.deepEqual(insertarEnTexto("Antes después", 6, 6, "en medio"), { valor: "Antes en medio después", pos: 14 });
	assert.deepEqual(insertarEnTexto("Fin.", 3, 3, "al"), { valor: "Fin al.", pos: 6 });
});

test("sustituye la selección y no toca el resto", () => {
	assert.deepEqual(insertarEnTexto("uno DOS tres", 4, 7, "dos"), { valor: "uno dos tres", pos: 7 });
});

test("un dictado vacío no cambia nada y fuera de rango se acota", () => {
	assert.deepEqual(insertarEnTexto("texto", 2, 2, "   "), { valor: "texto", pos: 2 });
	assert.deepEqual(insertarEnTexto("texto", 99, 99, "más"), { valor: "texto más", pos: 9 });
});
