/**
 * Cuadernos del armazón de estudio (ticket 09), pintados en estático: la lista
 * y el editor con los cuadernos que devuelve el plugin dentro, marcado fuera.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EditorCuadernoEstudio, ListaCuadernosEstudio, MenuInsertar, PropiedadesCuaderno } from "../components/estudio/editor-cuadernos.tsx";
import { practicable, recuento, rutaCuaderno, type Cuaderno, type Simbolo } from "../components/estudio/cuadernos.ts";
import { INSERTABLES, type Insertable } from "../components/estudio/pagina.ts";
import { rutaPracticar, textoVolver } from "../components/estudio/intento.tsx";
import { BarraSeleccion } from "../components/estudio/margen-cuaderno.tsx";

const nada = () => {};

const CUADERNO: Cuaderno = {
	id: "nb1", revision: 4, title: "Dijkstra", kind: "fuente", unitId: "u1", documentId: "d1", areaId: "a1",
	createdAt: "2026-11-10T09:00:00.000Z", updatedAt: "2026-11-12T09:00:00.000Z",
	blocks: [
		{ id: "n1", kind: "nota", symbol: "→", text: "Relaja aristas en orden de distancia", locator: "p. 3", quote: "Dijkstra relaja cada arista una vez." },
		{ id: "e1", kind: "error", wrong: "Funciona con pesos negativos", cause: "Lo confundí con Bellman-Ford", fix: "Exige pesos no negativos" },
		{ id: "q1", kind: "recuperacion", question: "¿Por qué falla con pesos negativos?", answer: "Porque fija la distancia al extraer el vértice." },
	],
};
const SUELTO: Cuaderno = { ...CUADERNO, id: "nb2", title: "Ideas sueltas", kind: "libre", unitId: null, documentId: null, blocks: [] };
const UNIDADES = [{ id: "u1", titulo: "Caminos mínimos" }];
const DOCUMENTOS = [{ id: "d1", titulo: "Introducción a los algoritmos" }];

const lista = (props: Partial<React.ComponentProps<typeof ListaCuadernosEstudio>> = {}) => renderToStaticMarkup(
	<ListaCuadernosEstudio cuadernos={[CUADERNO, SUELTO]} unidades={UNIDADES} documentos={DOCUMENTOS} ocupado={false} error={null}
		acciones={{ nuevo: nada, abrir: nada, exportarAnki: nada }} {...props} />,
);
const editor = (props: Partial<React.ComponentProps<typeof EditorCuadernoEstudio>> = {}) => renderToStaticMarkup(
	<EditorCuadernoEstudio cuaderno={CUADERNO} unidades={UNIDADES} documentos={DOCUMENTOS} guardado={{ tipo: "guardado" }} ocupado={false}
		acciones={{ cambiar: nada, exportarMarkdown: nada, exportarAnki: nada, borrar: nada, practicar: nada, navegar: nada }} {...props} />,
);

describe("ListaCuadernosEstudio", () => {
	it("pinta los cuadernos con lo que tienen y a qué están vinculados, cada uno con enlace a su editor, y sin su tipo", () => {
		const html = lista();
		assert.match(html, /<h1[^>]*font-title[^>]*>Cuadernos<\/h1>/);
		assert.match(html, /href="\/cuadernos\/nb1"[\s\S]*?Dijkstra[\s\S]*?1 nota · 1 error · 1 pregunta · Unidad: Caminos mínimos · Fuente: Introducción a los algoritmos/);
		assert.match(html, /href="\/cuadernos\/nb2"[\s\S]*?Ideas sueltas[\s\S]*?0 notas</);
		assert.doesNotMatch(html, /Nota de fuente|Cuaderno libre|Síntesis/);
	});

	it("ofrece crear un cuaderno y exportar a Anki solo si hay preguntas", () => {
		assert.match(lista(), /Nuevo cuaderno<\/button>/);
		assert.match(lista(), /Exportar todas las preguntas a Anki/);
		assert.doesNotMatch(lista({ cuadernos: [SUELTO] }), /Exportar todas las preguntas a Anki/);
	});

	it("un espacio sin cuadernos dice qué hacer, y avisa mientras carga y si falla", () => {
		assert.match(lista({ cuadernos: [] }), /Todavía no hay cuadernos en este espacio\. Crea uno o, desde el lector/);
		assert.match(lista({ cuadernos: null }), /Cargando…/);
		assert.match(lista({ error: "Estudio no respondió" }), /role="alert"[^>]*>Estudio no respondió/);
	});

	it("un vínculo a algo fuera del espacio se dice sin inventar su nombre", () => {
		assert.match(lista({ unidades: [], documentos: [] }), /Unidad: otra unidad · Fuente: documento no disponible/);
	});

	it("no pinta el grafo ni la práctica nativa", () => {
		assert.doesNotMatch(lista() + editor(), /grafo|Practice|Teach/i);
	});
});

describe("EditorCuadernoEstudio", () => {
	it("pinta solo el título y la página: sin tipo, sin selectores, sin leyenda, sin botones de añadir ni de exportar a la vista", () => {
		const html = editor();
		assert.match(html, /<input[^>]*aria-label="Título"[^>]*value="Dijkstra"/);
		assert.match(html, /role="status" data-estado="guardado"[^>]*>Guardado</);
		assert.doesNotMatch(html, /Nota de fuente|Nota de conocimiento|Síntesis|Cuaderno libre|name="kind"/);
		assert.doesNotMatch(html, /<select/);
		assert.doesNotMatch(html, /Leyenda de la notación|Exportar Markdown|Mover a la papelera|>Exportar preguntas a Anki</);
		assert.doesNotMatch(html, />(Nota|Error|Pregunta de recuperación)<\/button>/);
	});

	it("la unidad y la fuente no se ven en la página, aunque estén vinculadas: viven en Propiedades", () => {
		const html = editor();
		assert.doesNotMatch(html, /href="\/unidad\/|href="\/biblioteca\/|Caminos mínimos|Introducción a los algoritmos/);
	});

	it("un cuaderno nuevo muestra el título y la página vacía con una indicación discreta, con un solo hueco donde escribir", () => {
		const html = editor({ cuaderno: SUELTO, enfocarTitulo: true });
		assert.match(html, /placeholder="Título del cuaderno"/);
		assert.match(html, /placeholder="Escribe aquí\. «\/» inserta un error o una pregunta\. Selecciona texto para pedirle algo al tutor\."/);
		assert.equal((html.match(/<textarea/g) ?? []).length, 1);
		assert.match(html, /data-hueco=""/);
		assert.doesNotMatch(html, /aria-label="Acciones del bloque"/);
	});

	it("cada nota es un párrafo con su símbolo coloreado y su significado al pasar el ratón, y el texto se ve sin símbolo duplicado", () => {
		const html = editor();
		assert.match(html, /<span data-simbolo="→" title="Relación o mecanismo"[^>]*text-\[var\(--lh-accent\)\][^>]*>→<\/span>/);
		assert.match(html, /<textarea[^>]*name="text"[^>]*aria-label="Párrafo \(Relación o mecanismo\)"[^>]*>→ Relaja aristas en orden de distancia<\/textarea>/);
		assert.match(html, /<div aria-hidden="true" data-copia[^>]*>.*?→<\/span> Relaja aristas en orden de distancia/);
	});

	it("cada familia de símbolos se pinta con su tinta, y un párrafo sin símbolo no lleva color", () => {
		const nota = (symbol: Simbolo | null, text: string): Cuaderno["blocks"][number] => ({ id: `n-${symbol}-${text}`, kind: "nota", symbol, text, locator: "", quote: "" });
		const html = editor({ cuaderno: { ...SUELTO, blocks: [nota("?", "duda"), nota("X", "fallo"), nota("Δ", "cambio"), nota(null, "libre")] } });
		assert.match(html, /data-simbolo="\?"[^>]*--lh-warning/);
		assert.match(html, /data-simbolo="X"[^>]*--lh-error/);
		assert.match(html, /data-simbolo="Δ"[^>]*--lh-success/);
		assert.equal((html.match(/data-simbolo=/g) ?? []).length, 3);
		assert.match(html, /aria-label="Párrafo"[^>]*>libre<\/textarea>/);
	});

	it("la cita del lector se pinta sobre su párrafo, con el localizador, y se conserva aunque el párrafo esté vacío", () => {
		const html = editor();
		assert.match(html, /<blockquote[^>]*>Dijkstra relaja cada arista una vez\.<cite[^>]*>p\. 3<\/cite><\/blockquote>/);
		const soloCita = editor({ cuaderno: { ...SUELTO, blocks: [{ id: "c", kind: "nota", symbol: null, text: "", locator: "p. 1", quote: "Una frase." }] } });
		assert.match(soloCita, /<blockquote[^>]*>Una frase\.<cite[^>]*>p\. 1<\/cite><\/blockquote>/);
		assert.match(soloCita, /<textarea[^>]*name="text"[^>]*><\/textarea>/);
	});

	it("«Error» se pinta como bloque discreto de tres campos dentro de la página", () => {
		const html = editor();
		assert.match(html, /data-kind="error"[\s\S]*?>Error<\/p>[\s\S]*?Funciona con pesos negativos<\/textarea>[\s\S]*?Lo confundí con Bellman-Ford<\/textarea>[\s\S]*?Exige pesos no negativos<\/textarea>/);
		assert.match(html, /aria-label="Lo que creía \(la representación incorrecta\)"/);
		assert.match(html, /aria-label="Por qué lo creía \(causa probable\)"/);
		assert.match(html, /aria-label="Corrección"/);
	});

	it("«Pregunta de recuperación» lleva pregunta, respuesta y «Practicar», que se activa como antes", () => {
		const html = editor();
		assert.match(html, /data-kind="recuperacion"[\s\S]*?¿Por qué falla con pesos negativos\?<\/textarea>[\s\S]*?Porque fija la distancia al extraer el vértice\.<\/textarea>/);
		assert.match(html, /<button[^>]*>Practicar<\/button>/);
		assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*>Practicar/);
	});

	it("sin unidad o sin respuesta, la pregunta no se practica y dice por qué", () => {
		const sinUnidad = editor({ cuaderno: { ...CUADERNO, unitId: null } });
		assert.match(sinUnidad, /<button[^>]*disabled=""[^>]*>Practicar/);
		assert.match(sinUnidad, /Vincula el cuaderno a una unidad \(en Propiedades\) para practicar esta pregunta/);
		const sinRespuesta = editor({ cuaderno: { ...CUADERNO, blocks: [{ id: "q1", kind: "recuperacion", question: "¿Qué?", answer: " " }] } });
		assert.match(sinRespuesta, /Escribe la pregunta y tu respuesta para practicarla/);
		assert.equal(practicable(CUADERNO, CUADERNO.blocks[2]!), true);
		assert.equal(practicable(CUADERNO, CUADERNO.blocks[0]!), false);
	});

	it("tras un bloque de error o de pregunta queda un hueco para seguir escribiendo; tras un párrafo, no", () => {
		assert.match(editor(), /data-hueco=""/);
		const html = editor({ cuaderno: { ...CUADERNO, blocks: [CUADERNO.blocks[0]!] } });
		assert.doesNotMatch(html, /data-hueco/);
	});

	it("cada bloque de la página tiene su menú de acciones; el hueco no", () => {
		const html = editor();
		assert.equal((html.match(/aria-label="Acciones del bloque"/g) ?? []).length, 3);
	});

	it("la cabecera ofrece «Más acciones», desde donde se abren Propiedades; sus contenidos no están a la vista hasta abrirlos", () => {
		const html = editor();
		assert.doesNotMatch(html, /aria-label="Propiedades del cuaderno"/, "Propiedades se abre desde «⋯»");
		assert.match(html, /<button[^>]*aria-label="Más acciones"/);
		assert.doesNotMatch(html, /Exportar a Markdown|Con qué se relaciona este cuaderno/);
	});

	it("dice cuándo hay cambios sin guardar y por qué no se pudo guardar", () => {
		assert.match(editor({ guardado: { tipo: "sin-guardar" } }), /data-estado="sin-guardar"[^>]*>Sin guardar</);
		assert.match(editor({ guardado: { tipo: "error", motivo: "revisión obsoleta" } }), /data-estado="error"[^>]*text-destructive[^>]*>No se pudo guardar: revisión obsoleta</);
	});
});

describe("PropiedadesCuaderno", () => {
	const propiedades = (props: Partial<React.ComponentProps<typeof PropiedadesCuaderno>> = {}) => renderToStaticMarkup(
		<PropiedadesCuaderno cuaderno={CUADERNO} unidades={UNIDADES} documentos={DOCUMENTOS} ocupado={false} cambiar={nada} navegar={nada} {...props} />,
	);

	it("elige la unidad y la fuente, y no ofrece el tipo", () => {
		const html = propiedades();
		assert.match(html, /<select[^>]*name="unitId"/);
		assert.match(html, /<option value="u1" selected="">Caminos mínimos<\/option>/);
		assert.match(html, /<option value="d1" selected="">Introducción a los algoritmos<\/option>/);
		assert.match(html, /<option value="">Sin unidad<\/option>/);
		assert.match(html, /<option value="">Sin fuente<\/option>/);
		assert.doesNotMatch(html, /name="kind"|Tipo|Nota de fuente/);
		assert.match(html, /href="\/unidad\/u1"[^>]*>Abrir la unidad<\/a>/);
		assert.match(html, /href="\/biblioteca\/d1\?unidad=u1"[^>]*>Abrir la fuente<\/a>/);
		assert.doesNotMatch(propiedades({ cuaderno: SUELTO }), /Abrir la/);
	});

	it("un vínculo fuera del espacio sigue elegido, con su motivo", () => {
		assert.match(propiedades({ unidades: [], documentos: [] }), /<option value="u1" selected="">Unidad no activa<\/option>[\s\S]*<option value="d1" selected="">Documento no disponible<\/option>/);
	});
});

describe("MenuInsertar", () => {
	const menu = (opciones: readonly Insertable[] = INSERTABLES, seleccion = 0) => renderToStaticMarkup(
		<MenuInsertar opciones={opciones} seleccion={seleccion} elegir={nada} />,
	);

	it("ofrece «Error» y «Pregunta de recuperación», con la elegida marcada", () => {
		const html = menu();
		assert.match(html, /id="menu-insertar" role="listbox" aria-label="Insertar"/);
		assert.match(html, /id="menu-insertar-error" type="button" role="option" tabindex="-1" aria-selected="true" data-insertar="error"[^>]*><span>Error<\/span>/);
		assert.match(html, /role="option" tabindex="-1" aria-selected="false" data-insertar="recuperacion"[^>]*><span>Pregunta de recuperación<\/span>/);
		assert.match(menu(INSERTABLES, 1), /aria-selected="true" data-insertar="recuperacion"/);
	});

});

describe("rutas y recuento", () => {
	it("el editor tiene su ruta; recién creado, la marca para nombrarlo", () => {
		assert.equal(rutaCuaderno("nb1"), "/cuadernos/nb1");
		assert.equal(rutaCuaderno("nb1", { nuevo: true }), "/cuadernos/nb1?nuevo=1");
	});

	it("practicar una pregunta pasa por la pantalla de intento y vuelve al cuaderno", () => {
		const ruta = rutaPracticar("u1", { pregunta: { cuaderno: "nb1", bloque: "q1" }, volver: rutaCuaderno("nb1") });
		assert.equal(ruta, "/practicar/u1?cuaderno=nb1&bloque=q1&volver=%2Fcuadernos%2Fnb1");
		assert.equal(rutaPracticar("u1"), "/practicar/u1");
		assert.equal(textoVolver("/cuadernos/nb1"), "Volver al cuaderno");
		assert.equal(textoVolver(null), "Volver a la unidad");
	});

	it("cuenta notas, errores y preguntas", () => {
		assert.equal(recuento(CUADERNO), "1 nota · 1 error · 1 pregunta");
		assert.equal(recuento(SUELTO), "0 notas");
	});
});

describe("el margen del cuaderno (ticket 12b)", () => {
	const NOTA = "Un embedding es un vector denso aprendido.";
	const PAGINA: Cuaderno = { ...SUELTO, id: "nb3", title: "Embeddings", blocks: [
		{ id: "n1", kind: "nota", symbol: null, text: NOTA, locator: "", quote: "" },
		{ id: "n2", kind: "nota", symbol: "?", text: "¿Por qué no basta el one-hot?", locator: "", quote: "" },
	] };
	const anclaDe = (blockId: string, texto: string, frase: string) => {
		const start = texto.indexOf(frase);
		return { blockId, text: frase, start, end: start + frase.length, prefix: texto.slice(Math.max(0, start - 32), start), suffix: texto.slice(start + frase.length, start + frase.length + 32) };
	};
	const comentario = (id: string, anchor: ReturnType<typeof anclaDe>, extra: Partial<NonNullable<Cuaderno["comments"]>[number]> = {}): NonNullable<Cuaderno["comments"]>[number] => ({
		id, anchor, persona: "tutor", kind: "pregunta", state: "abierto", createdAt: "2026-11-16T10:00:00.000Z",
		thread: [{ id: `m-${id}`, role: "tutor", text: `Texto del tutor ${id}`, at: "2026-11-16T10:00:00.000Z" }], ...extra,
	});
	const conComentarios = (comments: NonNullable<Cuaderno["comments"]>, props: Partial<React.ComponentProps<typeof EditorCuadernoEstudio>> = {}) =>
		editor({ cuaderno: { ...PAGINA, comments }, ...props });

	it("sin comentarios la página es la limpia: ni margen ni barra, y la columna de siempre", () => {
		const html = editor({ cuaderno: PAGINA });
		assert.doesNotMatch(html, /data-margen|aria-label="Margen"|data-comentario|data-barra-seleccion/);
		assert.match(html, /max-w-\[64rem\]/);
	});

	it("el primer comentario no mueve el texto: la maquetación de la página es la misma con y sin margen", () => {
		const maquetacion = (html: string) => [
			html.match(/<div[^>]*@container\/pagina[^>]*>/)?.[0],
			html.match(/<div class="[^"]*@min-\[53rem\]\/pagina:grid[^"]*">/)?.[0],
			html.match(/<div class="[^"]*max-w-\[36rem\][^"]*"><div class="flex flex-wrap items-center/)?.[0],
		];
		const sin = maquetacion(editor({ cuaderno: PAGINA }));
		const con = maquetacion(conComentarios([comentario("c1", anclaDe("n1", NOTA, "vector denso"))]));
		assert.ok(sin.every(Boolean), "la rejilla existe también sin comentarios: " + JSON.stringify(sin));
		assert.deepEqual(con, sin);
	});

	it("un comentario aparece en el margen con quién lo escribe y qué se pidió, y su frase queda subrayada en la página", () => {
		const html = conComentarios([comentario("c1", anclaDe("n1", NOTA, "vector denso"))]);
		assert.match(html, /<aside[^>]*aria-label="Margen"/);
		assert.match(html, /data-margen-id="c1"[^>]*data-bloque="n1"[^>]*data-estado="abierto"/);
		assert.match(html, /<span data-firma="true">Tutor<\/span>[\s\S]*?<span>Pregunta<\/span>/);
		assert.match(html, /Texto del tutor c1/);
		assert.match(html, /<span[^>]*data-comentario="c1"[^>]*>vector denso<\/span>/);
		assert.match(html, /max-w-\[64rem\]/);
		assert.match(html, /aria-label="Descartar comentario"/);
	});

	it("el texto de David no cambia por un comentario: el párrafo sigue siendo el suyo, completo", () => {
		const sin = editor({ cuaderno: PAGINA });
		const con = conComentarios([comentario("c1", anclaDe("n1", NOTA, "vector denso")), comentario("c2", anclaDe("n2", "? ¿Por qué no basta el one-hot?", "one-hot"), { kind: "explicacion" })]);
		const campos = (html: string) => [...html.matchAll(/<textarea[^>]*>([^<]*)<\/textarea>/g)].map(m => m[1]);
		assert.deepEqual(campos(con), campos(sin));
		assert.ok(campos(con).includes(NOTA));
		assert.match(con, /<span>Explicación<\/span>/);
	});

	it("una explicación y una pregunta se distinguen en la tarjeta", () => {
		const html = conComentarios([comentario("c1", anclaDe("n1", NOTA, "embedding"), { kind: "explicacion" })]);
		assert.match(html, /data-margen-id="c1"[\s\S]*?<span>Explicación<\/span>/);
		assert.doesNotMatch(html, /<span>Pregunta<\/span>/);
	});

	it("un comentario descartado no se ve, y si solo hay descartados tampoco hay margen", () => {
		const html = conComentarios([comentario("c1", anclaDe("n1", NOTA, "vector denso"), { state: "descartado" })]);
		assert.doesNotMatch(html, /data-margen|Texto del tutor c1|data-comentario/);
		assert.match(html, /max-w-\[64rem\]/);
	});

	it("con la frase borrada el comentario va al final del margen como «sin su frase», con lo que se había comentado", () => {
		const html = conComentarios([
			comentario("c0", anclaDe("zz", "una frase que ya no está", "frase que ya no está")),
			comentario("c1", anclaDe("n2", "? ¿Por qué no basta el one-hot?", "one-hot")),
		]);
		assert.ok(html.indexOf('data-margen-id="c1"') < html.indexOf('data-margen-id="c0"'), "el anclado va antes que el huérfano");
		assert.match(html, /data-margen-id="c0"[^>]*data-sin-frase=""/);
		assert.match(html, /Sin su frase<\/span> · «frase que ya no está»/);
		assert.doesNotMatch(html, /data-margen-id="c1"[^>]*data-sin-frase/);
		assert.doesNotMatch(html, /data-comentario="c0"/);
	});

	it("una petición en curso se pinta pensando y una fallida dice por qué y se puede cerrar", () => {
		const anchor = anclaDe("n1", NOTA, "vector denso");
		const pensando = editor({ cuaderno: PAGINA, peticiones: [{ id: "p1", anchor, kind: "pregunta", estado: "pensando" }] });
		assert.match(pensando, /data-margen-id="p1"[^>]*data-estado="pensando"[\s\S]*?role="status"[^>]*>Pensando…/);
		assert.match(pensando, /data-comentario="p1"/);
		const fallida = editor({ cuaderno: PAGINA, peticiones: [{ id: "p2", anchor, kind: "explicacion", estado: "error", error: "Configura el modelo fuerte en Ajustes para que el tutor comente." }] });
		assert.match(fallida, /role="alert"[^>]*>No se pudo comentar: Configura el modelo fuerte en Ajustes para que el tutor comente\./);
		assert.match(fallida, /aria-label="Cerrar"/);
		assert.doesNotMatch(fallida, /Descartar comentario/);
		assert.match(fallida, /aria-label="Página"/, "la página sigue ahí");
	});

	it("la barra de un texto seleccionado ofrece «Pregúntame» y «Explícamelo»", () => {
		const html = renderToStaticMarkup(<BarraSeleccion pedir={nada} />);
		assert.match(html, /role="toolbar" aria-label="Pedir al tutor"/);
		assert.match(html, /data-pedir="pregunta"[^>]*>[\s\S]*?Pregúntame<\/button>/);
		assert.match(html, /data-pedir="explicacion"[^>]*>[\s\S]*?Explícamelo<\/button>/);
	});
});

describe("los hilos del margen (ticket 12c)", () => {
	const NOTA = "Un embedding es un vector denso aprendido.";
	const T = "2026-11-17T10:00:00.000Z";
	const PAGINA: Cuaderno = { ...SUELTO, id: "nb3", title: "Embeddings", blocks: [{ id: "n1", kind: "nota", symbol: null, text: NOTA, locator: "", quote: "" }] };
	const ancla = { blockId: "n1", text: "vector denso", start: 19, end: 31, prefix: "Un embedding es un ", suffix: " aprendido." };
	const hilo = [
		{ id: "m1", role: "tutor" as const, text: "¿Denso respecto a qué?", at: T },
		{ id: "m2", role: "david" as const, text: "Respecto a one-hot.", at: T },
		{ id: "m3", role: "tutor" as const, text: "¿Y qué ganas con ello?", at: T },
	];
	const con = (extra: Partial<NonNullable<Cuaderno["comments"]>[number]> = {}): Cuaderno => ({
		...PAGINA, comments: [{ id: "c1", anchor: ancla, persona: "tutor", kind: "pregunta", state: "abierto", createdAt: T, thread: hilo, ...extra }],
	});
	const acciones = { cambiar: nada, exportarMarkdown: nada, exportarAnki: nada, borrar: nada, practicar: nada, navegar: nada, responder: nada, abrirHilo: nada, cerrarHilo: nada, atender: async () => true };
	const vista = (cuaderno: Cuaderno, hilos?: React.ComponentProps<typeof EditorCuadernoEstudio>["hilos"], extra: Partial<typeof acciones> = {}) =>
		editor({ cuaderno, hilos, acciones: { ...acciones, ...extra } });
	const ABIERTO = { abierto: "c1", borradores: {}, espera: {} };

	it("un comentario con hilo se ve con su primer mensaje y ofrece seguirlo; sin conversación, «Responder»", () => {
		const html = vista(con());
		assert.match(html, /data-margen-id="c1"[^>]*data-estado="abierto"/);
		assert.match(html, /¿Denso respecto a qué\?/);
		assert.doesNotMatch(html, /Respecto a one-hot\./, "cerrado, solo el primer mensaje");
		assert.match(html, /data-abrir-hilo[^>]*>[\s\S]*?Seguir el hilo · 3<\/button>/);
		assert.match(vista(con({ thread: [hilo[0]!] })), /data-abrir-hilo[^>]*>[\s\S]*?Responder<\/button>/);
	});

	it("el hilo abierto muestra toda la conversación, quién habló, el campo para responder y «Volver a la nota»", () => {
		const html = vista(con(), { ...ABIERTO, borradores: { c1: "Mi borrador" } });
		assert.match(html, /data-hilo-abierto/);
		assert.match(html, /<ol[^>]*aria-label="Hilo del comentario"/);
		assert.match(html, /data-rol="tutor"[\s\S]*?Tutor[\s\S]*?¿Denso respecto a qué\?[\s\S]*?data-rol="david"[\s\S]*?Tú[\s\S]*?Respecto a one-hot\.[\s\S]*?data-rol="tutor"[\s\S]*?¿Y qué ganas con ello\?/);
		assert.match(html, /<textarea[^>]*name="respuesta-hilo"[^>]*aria-label="Tu respuesta al tutor"[^>]*placeholder="Responde al tutor…"[^>]*>Mi borrador<\/textarea>/);
		assert.match(html, /data-hilo-volver[^>]*>[\s\S]*?Volver a la nota<\/button>/);
		assert.doesNotMatch(html, /data-abrir-hilo/, "abierto, ya no hace falta el botón que lo abre");
	});

	it("el hilo abierto no cambia el texto de David: el párrafo es el mismo con y sin hilo", () => {
		const parrafo = (html: string) => html.match(/<textarea[^>]*name="text"[^>]*>[^<]*<\/textarea>/)![0];
		assert.equal(parrafo(vista(con(), ABIERTO)), parrafo(vista(PAGINA)));
		assert.match(parrafo(vista(con(), ABIERTO)), new RegExp(`>${NOTA}</textarea>`));
	});

	it("mientras el tutor piensa se ve lo que David acaba de decir y «Pensando…»; si falla, el motivo y «Reintentar»", () => {
		const pensando = vista(con({ thread: [hilo[0]!] }), { ...ABIERTO, espera: { c1: { estado: "pensando", pendiente: "Respecto a one-hot." } } });
		assert.match(pensando, /data-pendiente[\s\S]*?Respecto a one-hot\.[\s\S]*?role="status"[^>]*>Pensando…/);
		const error = vista(con({ thread: [hilo[0]!, hilo[1]!] }), { ...ABIERTO, espera: { c1: { estado: "error", error: "El modelo falló: caído" } } });
		assert.match(error, /role="alert"[^>]*>El modelo falló: caído[\s\S]*?Reintentar<\/button>/);
		const cerrado = vista(con(), { abierto: null, borradores: {}, espera: { c1: { estado: "pensando" } } });
		assert.match(cerrado, /role="status"[^>]*>Pensando…/, "también con el hilo cerrado se ve que llega una respuesta");
	});

	it("una respuesta sin leer se anuncia con un punto en la marca del atendido y en «Seguir el hilo», y no en los demás", () => {
		const nueva = { abierto: null, borradores: {}, espera: {}, sinLeer: { c1: true as const } };
		const atendido = vista(con({ state: "atendido" }), nueva);
		assert.match(atendido, /data-sin-leer/);
		assert.match(atendido, /aria-label="Reabrir el hilo atendido: «vector denso», con una respuesta nueva"/);
		const abierto = vista(con(), nueva);
		assert.match(abierto, /data-abrir-hilo[^>]*>[\s\S]*?data-sin-leer[\s\S]*?Seguir el hilo/);
		assert.doesNotMatch(vista(con({ state: "atendido" })), /data-sin-leer|respuesta nueva/);
		assert.doesNotMatch(vista(con(), { ...nueva, abierto: "c1" }), /data-sin-leer/, "con el hilo abierto ya se está leyendo");
	});

	it("un comentario atendido es una marca pequeña con su número de mensajes, sin su texto ni subrayado", () => {
		const html = vista(con({ state: "atendido" }));
		assert.match(html, /data-margen-id="c1"[^>]*data-estado="atendido"/);
		assert.match(html, /<button[^>]*data-abrir-hilo[^>]*aria-label="Reabrir el hilo atendido: «vector denso»"[^>]*>[\s\S]*?<span aria-hidden="true">3<\/span>/);
		assert.doesNotMatch(html, /¿Denso respecto a qué\?|data-comentario/);
		assert.doesNotMatch(html, /aria-label="Descartar comentario"/);
	});

	it("reabierto, un atendido muestra su historia y lo dice; al pulsar la marca no hay otro estado guardado", () => {
		const html = vista(con({ state: "atendido" }), ABIERTO);
		assert.match(html, /data-estado="atendido"[^>]*data-hilo-abierto/);
		assert.match(html, /· atendido/);
		assert.match(html, /Respecto a one-hot\./);
	});

	it("sin acciones de hilo el margen es el del 12b: sin «Responder» ni marca", () => {
		const html = editor({ cuaderno: con() });
		assert.match(html, /¿Denso respecto a qué\?/);
		assert.doesNotMatch(html, /data-abrir-hilo|Responder|Seguir el hilo/);
		const atendido = editor({ cuaderno: con({ state: "atendido" }) });
		assert.match(atendido, /data-margen-id="c1"/, "sin hilos, un atendido se sigue viendo como siempre");
	});

	it("Tab llega al margen: sus botones y el campo del hilo llevan la marca del recorrido", () => {
		const html = vista(con(), ABIERTO);
		assert.match(html, /data-hilo-volver/);
		assert.equal((html.match(/data-recorrido/g) ?? []).length, 2, "volver y enviar");
		assert.match(vista(con()), /data-abrir-hilo/);
		assert.match(vista(con()), /data-recorrido/);
	});

	it("un comentario antiguo, sin hilo propio más que el primer mensaje, se pinta como antes", () => {
		const html = vista(con({ thread: [hilo[0]!] }));
		assert.match(html, /¿Denso respecto a qué\?/);
		assert.match(html, /aria-label="Descartar comentario"/);
	});
});
