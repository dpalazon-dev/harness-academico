/**
 * La página de unidad del armazón de estudio (ticket 02), pintada en estático:
 * datos de la lectura del plugin dentro, marcado fuera.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PaginaUnidadEstudio } from "../components/estudio/unidad.tsx";
import type { LecturaUnidad } from "../components/estudio/tipos.ts";

const nada = () => {};
const acciones = { ajustar: nada, confirmar: nada, archivar: nada, aceptarSugerencia: nada, descartarSugerencia: nada, moverAEspacio: nada, estudiar: nada, discutir: nada, guardarVolcado: nada, paso: nada, nuevoCuaderno: nada, navegar: nada };
const AHORA = new Date("2026-11-13T10:00:00");

const BASE: LecturaUnidad = {
	id: "u1", revision: 3, titulo: "Caminos mínimos", estado: "activa", areaId: "a1",
	plan: { id: "p1", objetivo: "Dominar grafos" }, sugerencia: null,
	capacidad: "Explicar por qué Dijkstra encuentra el camino más corto",
	criterio: "Lo demuestro sin mirar sobre un grafo nuevo",
	tipo: "procedimiento", practica: null, practicaEfectiva: "ejecutar",
	etapa: { kind: "intervalo", label: "Recuperada · intervalo de 7 días", days: 7 },
	ciclo: { orientar: "pendiente", exponer: "hecho", reconstruir: "pendiente", mantener: "hecho" },
	volcado: null,
	fuentes: [{ path: "documento:d1", documentoId: "d1", titulo: "Cormen", paginas: 1300, localizador: "cap. 24", capturas: 4, ultimaCaptura: "2026-11-10T09:00:00.000Z", reconstruida: false }],
	notas: [{ cuadernoId: "nb1", cuaderno: "Dijkstra", id: "n1", simbolo: "→", texto: "Relaja aristas por distancia", cita: "", localizador: "p. 3" }],
	preguntas: [{ cuadernoId: "nb1", cuaderno: "Dijkstra", id: "q1", pregunta: "¿Por qué falla con pesos negativos?" }],
	cuadernos: [
		{ id: "nb1", titulo: "Dijkstra", tipo: "libre", notas: 1, preguntas: 1, actualizado: "2026-11-12T09:00:00.000Z" },
		{ id: "nb2", titulo: "Cuaderno sin título", tipo: "fuente", notas: 0, preguntas: 0, actualizado: "2026-11-11T09:00:00.000Z" },
	],
	intentos: [
		{ id: "a2", fecha: "2026-11-12T09:00:00.000Z", tarea: "libre", estado: "graded", fidelidad: 3 },
		{ id: "a1", fecha: "2026-11-05T09:00:00.000Z", tarea: "aplicada", estado: "abandoned", fidelidad: null },
	],
	proximoRepaso: "2026-11-19",
	conversaciones: [{
		id: "c1", title: "Dudas de Dijkstra", updatedAt: "2026-11-12T10:00:00.000Z",
		resumen: { tema: "Dijkstra con pesos negativos", abierto: ["¿Y Bellman-Ford?"], siguiente: "Probarlo con pesos negativos" }, resumenAntiguo: false, resumenError: null,
	}],
	paso: null,
};

const pagina = (cambios: Partial<LecturaUnidad> = {}, extra: Partial<React.ComponentProps<typeof PaginaUnidadEstudio>> = {}) =>
	renderToStaticMarkup(<PaginaUnidadEstudio unidad={{ ...BASE, ...cambios }} ahora={AHORA} ocupado={false} error={null} acciones={acciones} {...extra} />);

describe("PaginaUnidadEstudio", () => {
	it("pinta título en serifa, capacidad, criterio, tipo y etapa", () => {
		const html = pagina();
		assert.match(html, /<h1[^>]*font-title[^>]*>Caminos mínimos<\/h1>/);
		assert.match(html, /Explicar por qué Dijkstra encuentra el camino más corto/);
		assert.match(html, /Lo demuestro sin mirar sobre un grafo nuevo/);
		assert.match(html, /Procedimiento/);
		assert.match(html, /Recuperada · intervalo de 7 días/);
	});

	it("pinta los cuatro grupos del ciclo con su estado", () => {
		const html = pagina();
		for (const [grupo, estado] of [["Orientar", "Pendiente"], ["Exponer y capturar", "Hecho"], ["Reconstruir y contrastar", "Pendiente"], ["Mantener y usar", "Hecho"]]) {
			assert.match(html, new RegExp(`${grupo}</p><p[^>]*>${estado}<`), grupo);
		}
	});

	it("pinta fuentes con capturas y reconstrucción, notas, preguntas, intentos, próximo repaso y conversaciones", () => {
		const html = pagina();
		assert.match(html, /Cormen/);
		assert.match(html, /cap\. 24/);
		assert.match(html, /4 notas · sin reconstruir/);
		assert.match(html, /Relaja aristas por distancia/);
		assert.match(html, /¿Por qué falla con pesos negativos\?/);
		assert.match(html, /Reconstrucción libre[\s\S]*Completo/);
		assert.match(html, /Caso aplicado[\s\S]*Abandonado/);
		assert.match(html, /Próximo repaso: 19 nov/);
		assert.match(html, /Dudas de Dijkstra/);
	});

	it("deja ajustar el tipo y la forma de practicar, con la que se aplica por defecto", () => {
		const html = pagina();
		assert.match(html, /<select[^>]*aria-label="Tipo de conocimiento"/);
		assert.match(html, /<option value="procedimiento" selected="">Procedimiento<\/option>/);
		assert.match(html, /<select[^>]*aria-label="Forma de practicar"/);
		assert.match(html, /<option value="" selected="">Según el tipo: ejecutar<\/option>/);
	});

	it("muestra sus cuadernos, también vacíos, con enlace a su editor, y deja crear uno (ticket 09)", () => {
		const html = pagina();
		assert.match(html, /Cuadernos<\/h2>/);
		assert.match(html, /href="\/cuadernos\/nb1"[^>]*>[\s\S]*?Dijkstra[\s\S]*?1 nota · 1 pregunta/);
		assert.match(html, /href="\/cuadernos\/nb2"[^>]*>[\s\S]*?Cuaderno sin título[\s\S]*?0 notas</);
		assert.doesNotMatch(html, /Cuaderno libre|Nota de fuente|Síntesis/);
		assert.match(html, />Nuevo cuaderno</);
		assert.match(pagina({ cuadernos: [] }), /Ningún cuaderno vinculado a esta unidad/);
		assert.doesNotMatch(pagina({ estado: "archivada" }), />Nuevo cuaderno</);
	});

	it("una pregunta de recuperación se practica desde la unidad, salvo con un intento a medias (ticket 09)", () => {
		assert.match(pagina(), /¿Por qué falla con pesos negativos\?<\/span>[\s\S]*?>Practicar</);
		const enCurso = pagina({ intentos: [{ id: "a3", fecha: "2026-11-13T09:00:00.000Z", tarea: "libre", estado: "open", fidelidad: null }] });
		assert.doesNotMatch(enCurso, /pesos negativos\?<\/span><button/);
	});

	it("una unidad propuesta se puede confirmar o archivar", () => {
		const html = pagina({ estado: "propuesta" });
		assert.match(html, /Propuesta del tutor/);
		assert.match(html, />Confirmar</);
		assert.match(html, />Archivar</);
	});

	it("una unidad activa no ofrece confirmar", () => {
		assert.doesNotMatch(pagina(), />Confirmar</);
	});

	it("una unidad activa ofrece estudiar con el tutor; una propuesta o archivada, no", () => {
		assert.match(pagina(), /<button[^>]*>.*Estudiar con el tutor<\/button>/);
		assert.match(pagina({}, { ocupado: true }), /<button[^>]*disabled=""[^>]*>.*Estudiar con el tutor/);
		for (const estado of ["propuesta", "archivada"] as const) assert.doesNotMatch(pagina({ estado }), /Estudiar con el tutor/, estado);
	});

	it("una unidad sin fuentes dice qué hacer a continuación", () => {
		const html = pagina({ fuentes: [] });
		assert.match(html, /Ninguna fuente todavía/);
		assert.match(html, /Biblioteca/);
	});

	it("sin intentos, notas ni conversaciones lo dice", () => {
		const html = pagina({ intentos: [], notas: [], preguntas: [], conversaciones: [], proximoRepaso: null });
		assert.match(html, /Sin intentos todavía/);
		assert.match(html, /Sin notas ni preguntas/);
		assert.match(html, /Ninguna conversación/);
		assert.doesNotMatch(html, /Próximo repaso/);
	});

	it("enseña el error de la última operación", () => {
		assert.match(pagina({}, { error: "Unit u1 changed" }), /role="alert"[^>]*>Unit u1 changed/);
	});

	it("no muestra el grafo ni el conmutador de práctica", () => {
		const html = pagina();
		for (const fuera of ["home-mode-switch", "Graph", "Chains", "new-session-practice"]) assert.doesNotMatch(html, new RegExp(fuera), fuera);
	});

	it("sin volcado, ofrece escribirlo sin ayuda y avisa de que no se cambia", () => {
		const html = pagina();
		assert.match(html, /Lo que sabía antes/);
		assert.match(html, /<textarea[^>]*aria-label="Volcado inicial"/);
		assert.match(html, /qué sabes, qué crees, qué no sabes y qué te preguntas/);
		assert.match(html, /una vez guardado no se cambia/);
		assert.match(html, /<button[^>]*disabled=""[^>]*>Guardar volcado<\/button>/, "vacío no se guarda");
	});

	it("con volcado, lo muestra con su fecha y su origen, sin campo para reescribirlo", () => {
		const html = pagina({ volcado: { texto: "Sé que usa una cola.\n¿Y con pesos negativos?", fecha: "2026-11-12T09:00:00.000Z", origen: "sondeo" } });
		assert.match(html, /Lo que sabía antes/);
		assert.match(html, /Sé que usa una cola\.\n¿Y con pesos negativos\?/);
		assert.match(html, /Escrito el 12 de noviembre de 2026, al pedírtelo el tutor\./);
		assert.doesNotMatch(html, /<textarea/);
		assert.doesNotMatch(html, /Guardar volcado/);
	});

	it("una unidad archivada sin volcado no ofrece escribirlo", () => {
		const html = pagina({ estado: "archivada" });
		assert.doesNotMatch(html, /Volcado inicial/);
		assert.doesNotMatch(html, /Lo que sabía antes/);
	});
	it("una unidad activa sin intento a medias ofrece practicar; con uno a medias, retomarlo (ticket 06)", () => {
		assert.match(pagina(), /<button[^>]*>.*Practicar<\/button>/);
		assert.doesNotMatch(pagina(), /Retomar el intento/);
		const abierto = pagina({ intentos: [{ id: "a3", fecha: "2026-11-13T09:00:00.000Z", tarea: "guiada", estado: "open", fidelidad: null }, ...BASE.intentos] });
		assert.match(abierto, /<button[^>]*>.*Retomar el intento<\/button>/);
		assert.doesNotMatch(abierto, />Practicar</);
		const congelado = pagina({ intentos: [{ id: "a3", fecha: "2026-11-13T09:00:00.000Z", tarea: "guiada", estado: "frozen", fidelidad: null }] });
		assert.match(congelado, /Valorar el intento/);
		for (const estado of ["propuesta", "archivada"] as const) assert.doesNotMatch(pagina({ estado }), /Practicar<|Retomar el intento/, estado);
	});

	it("un intento terminado se puede discutir; uno abierto o abandonado, no", () => {
		const html = pagina({ intentos: [
			{ id: "a4", fecha: "2026-11-13T09:00:00.000Z", tarea: "guiada", estado: "frozen", fidelidad: null },
			{ id: "a3", fecha: "2026-11-13T08:00:00.000Z", tarea: "libre", estado: "open", fidelidad: null },
			...BASE.intentos,
		] });
		assert.equal(html.match(/>Discutir<\/button>/g)?.length, 2, "congelado y valorado");
	});

	it("cada fuente abre el lector con la unidad, para que lo capturado quede en ella (ticket 05)", () => {
		const html = pagina();
		assert.match(html, /<a href="\/biblioteca\/d1\?unidad=u1"[^>]*>.*Cormen/);
	});

	it("muestra su paso propuesto con motivo y botón (ticket 07); reconstruir es ese paso, no un botón por fuente", () => {
		const reconstruir = { tipo: "reconstruir" as const, accion: "Reconstruye sin mirar", motivo: "Capturaste 4 notas de «Cormen» y aún no lo has reconstruido.", boton: "Empezar reconstrucción" };
		const html = pagina({ paso: reconstruir });
		assert.match(html, /data-paso="reconstruir"/);
		assert.match(html, /Reconstruye sin mirar/);
		assert.match(html, /Capturaste 4 notas de «Cormen» y aún no lo has reconstruido\./);
		assert.match(html, />Empezar reconstrucción<\/button>/);
		assert.match(html, /4 notas · sin reconstruir/, "la fuente dice su estado");
		assert.doesNotMatch(html, /Reconstruir sin mirar/, "sin botón por fuente");
		assert.doesNotMatch(pagina(), /data-paso=/, "sin paso, nada");
	});

	it("una propuesta se decide en su recuadro: su paso no se repite", () => {
		const html = pagina({ estado: "propuesta", paso: { tipo: "decidir", accion: "Decide si entra en tu plan", motivo: "El tutor la propuso.", boton: "Revisar propuesta" } });
		assert.match(html, /El tutor propuso esta unidad/);
		assert.doesNotMatch(html, /data-paso=/);
	});

	it("el campo del volcado lleva el ancla a la que salta el paso «Escribe lo que ya sabes»", () => {
		assert.match(pagina(), /<textarea id="volcado"[^>]*aria-label="Volcado inicial"/);
	});

	it("una nota tomada de un pasaje enseña su cita aunque aún no tenga texto", () => {
		const html = pagina({ notas: [{ cuadernoId: "nb2", cuaderno: "Cormen", id: "n2", simbolo: null, texto: "", cita: "Dijkstra relaja cada arista una vez.", localizador: "p. 4" }] });
		assert.match(html, /<q[^>]*>Dijkstra relaja cada arista una vez\.<\/q>/);
		assert.match(html, /\(p\. 4\)/);
	});
	it("dice de qué plan es tema, con enlace a su página; sin plan, lo dice", () => {
		assert.match(pagina(), /Tema del plan <button[^>]*>«Dominar grafos»<\/button>/);
		assert.match(pagina({ plan: null }), /data-testid="plan-de-unidad"[^>]*>Sin plan</);
		assert.doesNotMatch(pagina(), /Subir|Bajar|Añadir al plan|Quitar del plan/);
	});

	it("enseña la capacidad y el criterio que sugirió el tutor, para aceptarlos o descartarlos", () => {
		const html = pagina({ sugerencia: { capacidad: "Relajar aristas", criterio: "Sin mirar" } });
		assert.match(html, /data-testid="sugerencia"[\s\S]*El tutor sugiere[\s\S]*Relajar aristas[\s\S]*Sabrás que puedes cuando: Sin mirar[\s\S]*>Aceptar<[\s\S]*>Descartar</);
		assert.doesNotMatch(pagina(), /data-testid="sugerencia"/);
		assert.doesNotMatch(pagina({ estado: "archivada", sugerencia: { capacidad: "x", criterio: "y" } }), /data-testid="sugerencia"/);
	});

	it("elige el espacio de la unidad entre los vivos o «Sin espacio» (ticket 11)", () => {
		const html = pagina({}, { espacios: [{ id: "a1", name: "Grafos" }, { id: "a2", name: "Doctorado" }] });
		assert.match(html, /aria-label="Espacio de la unidad"/);
		assert.match(html, /<option value="a1" selected="">Grafos<\/option>/);
		assert.match(html, /<option value="">Sin espacio<\/option>/);
		assert.doesNotMatch(pagina(), /Espacio de la unidad/, "sin la lista de espacios no se pinta");
	});
	it("cada conversación enseña lo que dejó su resumen, o por qué no lo tiene (ticket 11)", () => {
		const html = pagina();
		assert.match(html, /Dijkstra con pesos negativos/);
		assert.match(html, /Quedó abierto: ¿Y Bellman-Ford\?/);
		assert.match(html, /Siguiente paso: Probarlo con pesos negativos/);
		assert.doesNotMatch(html, /anterior a los últimos mensajes/);
		const c = BASE.conversaciones[0]!;
		assert.match(pagina({ conversaciones: [{ ...c, resumenAntiguo: true }] }), /El resumen es anterior a los últimos mensajes/);
		assert.match(pagina({ conversaciones: [{ ...c, resumen: null }] }), /Sin resumen todavía[^<]*«Resumir ahora»/);
		const fallo = pagina({ conversaciones: [{ ...c, resumen: null, resumenError: "El modelo no respondió" }] });
		assert.match(fallo, /El modelo no respondió/);
		assert.doesNotMatch(fallo, /Sin resumen todavía/);
	});
});
