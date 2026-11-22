/**
 * Biblioteca y lector del armazón de estudio (ticket 05), pintados en
 * estático: lecturas del plugin dentro, marcado fuera.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BibliotecaEstudio } from "../components/estudio/biblioteca.tsx";
import { LectorEstudio } from "../components/estudio/lector.tsx";
import { ANCLA_SUBIR, entidadesDe, rutaLector } from "../components/estudio/documentos.ts";
import type { DetalleDocumento, DocumentoEstudio, PaginaDocumento } from "../components/estudio/documentos.ts";

const nada = () => {};
const promesa = () => new Promise<never>(() => {});

const DOC: DocumentoEstudio = {
	id: "d1", revision: 2, title: "Introducción a los algoritmos", path: "C:/libros/cormen.pdf", status: "listo", error: null,
	startedAt: "2026-11-10T09:00:00.000Z", finishedAt: "2026-11-10T09:05:00.000Z", paginas: 120,
	contraste: { recuerdo: 0.987, respaldo: 0.99, paginasSinTexto: [3, 4] }, revisar: ["tabla 2 partida"], areaId: "a1",
};
const DETALLE: DetalleDocumento = {
	document: DOC,
	secciones: [
		{ clave: "s1", titulo: "Grafos", numero: "22", tipo: null, paginas: [10, 11] },
		{ clave: "s2", titulo: "Caminos mínimos", numero: "24", tipo: null, paginas: [40, 41, 42] },
		{ clave: "s2b", titulo: "Caminos mínimos", numero: "24", tipo: null, paginas: [43] },
	],
	tablas: [{ clave: "t1", leyenda: "Costes", paginas: [41] }], figuras: [], referencias: [{ clave: "r1", texto: "Dijkstra 1959" }], avisos: [],
};

const accionesBiblioteca = {
	subir: nada, incorporarRuta: nada, leer: nada, detalle: nada, vincular: nada, registrarEnBase: nada, reintentar: nada, borrar: nada,
};
const biblioteca = (props: Partial<React.ComponentProps<typeof BibliotecaEstudio>> = {}) => renderToStaticMarkup(
	<BibliotecaEstudio documentos={[DOC]} subiendo={null} detalle={null} unidades={[]} ocupado={false} error={null} acciones={accionesBiblioteca} {...props} />,
);

describe("BibliotecaEstudio", () => {
	it("pinta el título en serifa, la zona para arrastrar PDF y la incorporación desde una ruta", () => {
		const html = biblioteca();
		assert.match(html, /<h1[^>]*font-title[^>]*>Biblioteca<\/h1>/);
		assert.match(html, /role="group" aria-label="Añadir documentos"/);
		assert.match(html, /Arrastra aquí tus PDF/);
		assert.match(html, /Elegir archivos/);
		assert.match(html, /accept="application\/pdf,.pdf"/);
		assert.match(html, /Desde una ruta del disco/);
	});

	it("la zona de subir lleva el ancla a la que salta «Añadir material» del inicio (ticket 04, segunda ronda)", () => {
		assert.match(biblioteca(), new RegExp(`id="${ANCLA_SUBIR}"[^>]*role="group" aria-label="Añadir documentos"`));
	});

	it("cada documento listo enseña su estado, sus datos y las acciones de leer, estructura y borrar", () => {
		const html = biblioteca();
		assert.match(html, /data-document-id="d1" data-status="listo"/);
		assert.match(html, /Introducción a los algoritmos/);
		assert.match(html, />Listo</);
		assert.match(html, /120 páginas · texto recuperado: 98,7 % · 2 páginas sin capa de texto · 1 avisos que revisar/);
		assert.match(html, />Leer</);
		assert.match(html, /Estructura y vínculos/);
		assert.match(html, />Borrar</);
	});

	it("enseña el estado de la incorporación: en curso o con error y reintento", () => {
		const html = biblioteca({ documentos: [
			{ ...DOC, id: "d2", status: "procesando", paginas: null, contraste: null, revisar: [] },
			{ ...DOC, id: "d3", status: "error", error: "Document Intelligence no respondió", paginas: null, contraste: null, revisar: [] },
		] });
		assert.match(html, />Incorporando</);
		assert.match(html, /Extrayendo texto y estructura desde las/);
		assert.match(html, />Error</);
		assert.match(html, /Document Intelligence no respondió/);
		assert.match(html, />Reintentar</);
		assert.doesNotMatch(html, />Leer</, "solo se lee lo ya incorporado");
	});

	it("durante una subida enseña su progreso en la zona de soltar", () => {
		const html = biblioteca({ subiendo: { name: "grafos.pdf", sent: 1024 * 1024, total: 4 * 1024 * 1024 } });
		assert.match(html, /data-state="uploading"/);
		assert.match(html, /Subiendo «grafos.pdf»: 1,0 MiB de 4,0 MiB/);
		assert.match(html, /<progress[^>]*max="4194304"[^>]*value="1048576"/);
	});

	it("un espacio sin documentos dice qué hacer", () => {
		assert.match(biblioteca({ documentos: [] }), /Todavía no hay documentos en este espacio\. Arrastra un PDF/);
	});

	it("la estructura enseña las secciones sin repetir y deja vincular el documento a una unidad activa", () => {
		const html = biblioteca({ detalle: DETALLE, unidades: [{ id: "u1", title: "Caminos mínimos", revision: 4 }] });
		assert.match(html, /aria-expanded="true"/);
		assert.match(html, /22 Grafos/);
		assert.equal(html.match(/24 Caminos mínimos/g)?.length, 1);
		assert.match(html, /1 tablas · 0 figuras · 1 referencias bibliográficas/);
		assert.match(html, /Vincular a una unidad/);
		assert.match(html, /<option value="u1"[^>]*>Caminos mínimos<\/option>/);
		assert.match(html, /Registrar en la base de conocimiento/);
		assert.match(html, /Revisar: tabla 2 partida/);
	});

	it("sin unidades activas no ofrece vincular", () => {
		assert.match(biblioteca({ detalle: DETALLE, unidades: [] }), /No hay unidades activas en este espacio/);
	});

	it("enseña el error de la última operación", () => {
		assert.match(biblioteca({ error: "El documento no existe" }), /role="alert"[^>]*>El documento no existe/);
	});

	it("no muestra el grafo ni el conmutador de práctica", () => {
		assert.doesNotMatch(biblioteca(), /grafo|Practice|Teach/i);
	});
});

const PAGINA: PaginaDocumento = {
	documentId: "d1", title: "Introducción a los algoritmos", page: 41, total: 120,
	blocks: [
		{ clave: "s2", kind: "seccion", heading: "24 Caminos mínimos", text: "24 Caminos mínimosDijkstra relaja cada arista una vez.\n\nCon pesos negativos falla." },
		{ clave: "t1", kind: "tabla", heading: "Costes", text: "V | E\n1 | 2" },
	],
};
const accionesLector = {
	cerrar: nada, ir: nada, preguntar: nada, verificar: promesa, capturarHecho: promesa, anotar: promesa, copiar: nada, abrirCuaderno: nada,
};
const lector = (props: Partial<React.ComponentProps<typeof LectorEstudio>> = {}) => renderToStaticMarkup(
	<LectorEstudio pagina={PAGINA} detalle={DETALLE} unidad={null} capturas={0} ocupado={false} error={null} acciones={accionesLector} {...props} />,
);

describe("LectorEstudio", () => {
	it("pinta la página con su texto en párrafos, sin repetir el título de la sección, y sus tablas", () => {
		const html = lector();
		assert.match(html, /data-document-id="d1" data-page="41"/);
		assert.match(html, /<h1[^>]*font-title[^>]*>Introducción a los algoritmos<\/h1>/);
		assert.match(html, /<h3[^>]*>24 Caminos mínimos<\/h3>/);
		assert.match(html, /<p[^>]*>Dijkstra relaja cada arista una vez\.<\/p><p[^>]*>Con pesos negativos falla\.<\/p>/);
		assert.match(html, /data-kind="tabla"/);
		assert.match(html, /Tabla: Costes/);
	});

	it("ofrece pasar de página y saltar desde el índice, que marca la sección actual", () => {
		const html = lector();
		assert.match(html, /aria-label="Página anterior"/);
		assert.match(html, /aria-label="Página siguiente"/);
		assert.match(html, /aria-label="Página"[^>]*value="41"|value="41"[^>]*aria-label="Página"/);
		assert.match(html, /de 120/);
		assert.match(html, /<nav aria-label="Índice"/);
		assert.match(html, /aria-current="true"[^>]*><span[^>]*>24 Caminos mínimos/);
	});

	it("abierto desde Biblioteca vuelve a ella y no habla de unidad", () => {
		const html = lector();
		assert.match(html, /Volver a la Biblioteca/);
		assert.doesNotMatch(html, /Leyendo para/);
	});

	it("abierto desde una unidad lo dice, vuelve a ella y cuenta las capturas nuevas de esta lectura", () => {
		const html = lector({ unidad: { id: "u1", titulo: "Caminos mínimos" }, capturas: 2 });
		assert.match(html, /Volver a la unidad/);
		assert.match(html, /Leyendo para «Caminos mínimos»\. Lo que anotes queda en la unidad; llevas 2 capturas nuevas en esta lectura\./);
	});

	it("con un pasaje seleccionado ofrece preguntar al tutor, guardarlo como hecho, añadirlo a las notas y copiarlo", () => {
		const html = lector({ seleccionInicial: "Dijkstra relaja cada arista una vez." });
		assert.match(html, /aria-label="Pasaje seleccionado"/);
		assert.match(html, /<blockquote[^>]*>Dijkstra relaja cada arista una vez\.<\/blockquote>/);
		for (const salida of ["Preguntar al tutor", "Guardar como hecho", "Añadir a mis notas", "Copiar con referencia", "Descartar"]) assert.match(html, new RegExp(`>${salida}<`));
	});

	it("sin selección no ofrece las salidas del pasaje", () => {
		assert.doesNotMatch(lector(), /Preguntar al tutor/);
	});

	it("una página sin texto extraído lo dice", () => {
		assert.match(lector({ pagina: { ...PAGINA, blocks: [] } }), /Esta página no tiene texto extraído/);
	});

	it("enseña el error de la última operación", () => {
		assert.match(lector({ error: "No se pudo registrar la fuente trabajada" }), /role="alert"[^>]*>No se pudo registrar/);
	});
});

describe("rutaLector", () => {
	it("lleva la unidad y la página cuando las hay", () => {
		assert.equal(rutaLector("d1"), "/biblioteca/d1");
		assert.equal(rutaLector("d1", { unidad: "u1" }), "/biblioteca/d1?unidad=u1");
		assert.equal(rutaLector("d1", { unidad: "u1", pagina: 41 }), "/biblioteca/d1?unidad=u1&pagina=41");
	});
});

describe("entidadesDe", () => {
	it("cada línea es una entidad con su clase; un nombre suelto va sin ella, para reutilizarlo o hacerlo concepto", () => {
		assert.deepEqual(entidadesDe("dataset: SWaT\nMétodo: GDN\nmétrica:F1\natención\n\n"), [
			{ nombre: "SWaT", clase_entidad: "dataset" }, { nombre: "GDN", clase_entidad: "metodo" }, { nombre: "F1", clase_entidad: "metrica" }, { nombre: "atención" },
		]);
	});
});
