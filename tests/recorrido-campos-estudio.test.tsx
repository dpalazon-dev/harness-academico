/**
 * Tab y Mayús+Tab en las pantallas del armazón (historia 47, ticket 12):
 * el campo al que se va desde el enfocado, hacia delante y hacia atrás, con
 * vuelta al principio; con el foco fuera, el primero (o el último). Y qué
 * cuenta como campo: lo que se escribe o se elige, habilitado y visible.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { it } from "node:test";
import { parseHTML } from "linkedom";
import { camposDe, siguienteCampo } from "../components/estudio/recorrido-campos.tsx";

function pagina() {
	const { document } = parseHTML(`<html><body><main>
		<textarea id="volcado"></textarea>
		<button id="guardar">Guardar</button>
		<input id="archivo" type="file">
		<input id="oculto" type="hidden">
		<select id="tipo"><option>a</option></select>
		<input id="apagado" disabled>
		<input id="pagina" type="number">
	</main></body></html>`);
	// linkedom no maqueta: todo lo que está en el documento cuenta como visible.
	for (const el of document.querySelectorAll("*")) Object.assign(el, { getClientRects: () => [{}] });
	return document;
}

it("los campos son lo que se escribe o se elige, habilitado, en el orden del documento", () => {
	const doc = pagina();
	assert.deepEqual(camposDe(doc.querySelector("main")).map(el => el.id), ["volcado", "tipo", "pagina"]);
	assert.deepEqual(camposDe(null), []);
});

it("Tab avanza y Mayús+Tab retrocede, con vuelta; desde fuera, el primero o el último", () => {
	const doc = pagina();
	const campos = camposDe(doc.querySelector("main"));
	const [volcado, tipo, numero] = campos;
	assert.equal(siguienteCampo(campos, volcado!, false), tipo);
	assert.equal(siguienteCampo(campos, numero!, false), volcado, "del último vuelve al primero");
	assert.equal(siguienteCampo(campos, volcado!, true), numero, "hacia atrás desde el primero, el último");
	assert.equal(siguienteCampo(campos, tipo!, true), volcado);
	const fuera = doc.querySelector("#guardar");
	assert.equal(siguienteCampo(campos, fuera, false), volcado);
	assert.equal(siguienteCampo(campos, fuera, true), numero);
	assert.equal(siguienteCampo([], volcado!, false), null);
});
