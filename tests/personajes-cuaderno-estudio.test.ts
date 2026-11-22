/** Ticket 12g: a quién se firma cada comentario y con qué tinta (reglas puras del cliente). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FIRMA_BORRADO, FIRMA_TUTOR, firmaDe, personajeDeCuaderno, tintaDeComentario, type ListaPersonajes } from "../components/estudio/personajes.ts";

const L: ListaPersonajes = {
	predefinidos: [
		{ id: "profesor", nombre: "Profesor", descripcion: "Porqués y mecanismos", tinta: "acento", predefinido: true },
		{ id: "esceptico", nombre: "Escéptico", descripcion: "Condiciones", tinta: "rojo", predefinido: true },
	],
	propios: [{ id: "p-1", nombre: "Abogado", descripcion: "Lleva la contraria", tinta: "ambar", predefinido: false }],
	max: { personajes: 12, nombre: 40, descripcion: 400 },
};

describe("personajes en el cliente", () => {
	it("el personaje del cuaderno es el elegido; sin elección o con uno borrado, el Profesor", () => {
		assert.equal(personajeDeCuaderno({ persona: "esceptico" }, L).nombre, "Escéptico");
		assert.equal(personajeDeCuaderno({ persona: "p-1" }, L).nombre, "Abogado");
		assert.equal(personajeDeCuaderno({}, L).nombre, "Profesor");
		assert.equal(personajeDeCuaderno({ persona: "p-borrado" }, L).nombre, "Profesor");
	});

	it("la firma es la que guardó el comentario; sin ella, «Tutor» (de antes) o «Personaje borrado»", () => {
		assert.equal(firmaDe({ persona: "p-1", firma: "Abogado" }), "Abogado");
		assert.equal(firmaDe({ persona: "p-borrado", firma: "Abogado" }), "Abogado", "borrar el personaje no cambia la firma");
		assert.equal(firmaDe({ persona: "tutor" }), FIRMA_TUTOR);
		assert.equal(firmaDe({ persona: "p-raro" }), FIRMA_BORRADO);
	});

	it("la firma sigue el nombre vigente del personaje: renombrarlo cambia la de los comentarios antiguos, y borrarlo deja el nombre copiado", () => {
		const renombrado: ListaPersonajes = { ...L, propios: [{ ...L.propios[0]!, nombre: "Fiscal" }] };
		assert.equal(firmaDe({ persona: "p-1", firma: "Abogado" }, renombrado), "Fiscal");
		assert.equal(firmaDe({ persona: "p-1", firma: "Abogado" }, L), "Abogado");
		assert.equal(firmaDe({ persona: "p-borrado", firma: "Abogado" }, L), "Abogado", "borrado: el respaldo guardado");
		assert.equal(firmaDe({ persona: "p-1" }, renombrado), "Fiscal", "sin nombre copiado, el vigente");
		assert.equal(firmaDe({ persona: "tutor", firma: "Tutor" }, L), "Tutor", "los de antes de los personajes siguen firmando «Tutor»");
		assert.equal(firmaDe({ persona: "p-raro" }, L), FIRMA_BORRADO);
		assert.equal(firmaDe({ persona: "p-1", firma: "Abogado" }, null), "Abogado", "sin lista aún, el respaldo");
	});

	it("la tinta: la del personaje; la del cuaderno si es el acento, el tutor de antes o aún no hay lista; la neutra si se borró", () => {
		assert.equal(tintaDeComentario({ persona: "esceptico" }, L), "rojo");
		assert.equal(tintaDeComentario({ persona: "p-1" }, L), "ambar");
		assert.equal(tintaDeComentario({ persona: "profesor" }, L), undefined);
		assert.equal(tintaDeComentario({ persona: "tutor" }, L), undefined);
		assert.equal(tintaDeComentario({ persona: "esceptico" }, null), undefined);
		assert.equal(tintaDeComentario({ persona: "p-borrado" }, L), "texto");
	});
});
