"use client";

/**
 * Cuadernos (ticket 09, historia 9; página limpia en el 12a de la segunda ronda): los cuadernos del espacio activo y
 * el editor de uno. El cuaderno es una página: el título y el texto de David, por párrafos. Un símbolo de la notación
 * al principio de un párrafo se reconoce y se colorea, con su significado al pasar el ratón; `/` inserta un bloque
 * de error o una pregunta de recuperación (que se practica en la pantalla de intento). La unidad y la fuente viven en
 * un panel de propiedades; exportar a Markdown y Anki y la papelera, en el menú «⋯». Traslada al armazón la vista de
 * cuadernos del plugin con las mismas operaciones: `cuadernos`, `crear-cuaderno`, `guardar-cuaderno`,
 * `borrar-cuaderno`, `exportar-markdown`, `exportar-anki` y, al practicar, `practicar-pregunta`.
 *
 * El editor guarda mientras se escribe, sin volver a pintar lo que se teclea. Se guarda en el formato de siempre
 * (`blocks`): cada párrafo es un bloque `nota` con el símbolo deducido de su inicio (`pagina.ts`).
 *
 * `ListaCuadernosEstudio` y `EditorCuadernoEstudio` son puras; `Cuadernos` y `EditorCuaderno` las conectan con el plugin.
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon, MoreHorizontalIcon, NotebookPenIcon, PlusIcon, SlidersHorizontalIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { cn } from "@/lib/utils";
import { llamarEstudio } from "./llamar";
import { camposDe, useRecorridoCampos } from "./recorrido-campos";
import { rutaPracticar } from "./intento";
import { rutaLector, type DetalleDocumento, type DocumentoEstudio } from "./documentos";
import { RUTA_CUADERNOS, crearCuaderno, descargar, nuevoBloque, practicable, recuento, rutaCuaderno, type AnclaComentario, type BloqueCuaderno, type Cuaderno, type EstadoProactivo, type LecturaProactiva, type ModoCuaderno, type Tinta, type TipoComentario } from "./cuadernos";
import { ModoProactivo, TopeDiario } from "./modo-proactivo";
import { AvisoEscuchar, OpcionEscuchar } from "./escuchar-cuaderno";
import { useEscuchar, type VozVista } from "./escuchar";
import { PropositoCuaderno, TintaCuaderno, type CambioProposito } from "./proposito-cuaderno";
import { PersonajeCuaderno, type CambioPersonaje } from "./personaje-cuaderno";
import { firmaDe, personajeDeCuaderno, tintaDeComentario, todos, type ListaPersonajes, type Personaje } from "./personajes";
import { colorDeTinta } from "./tintas";
import { CONFIG_PROACTIVA, abiertosSinAtender, comentadosPorElTutor, decidirLectura, estadoInicialLectura, parrafosParaLeer } from "./proactivo";
import { SIN_HILOS, anclaDeSeleccion, colocar, conRespuestaNueva, segmentos, sinRespuestaNueva, visibles, type EstadoHilos } from "./margen";
import type { AccionesPropuestas, EstadoDecision } from "./propuestas-margen";
import { BarraSeleccion, COLUMNAS_PAGINA, COLUMNA_TEXTO, Margen, claseMarca, type AccionesDibujos, type AccionesHilo, type ItemMargen, type PeticionMargen } from "./margen-cuaderno";
import { DibujoMermaid } from "./dibujo-mermaid";
import {
	bloquesParaGuardar, conTexto, dividirNota, focoAlFinal, focoAlInicio, insertarEspecial, moverBloque, opcionesDeBarra, partirTexto, quitarBloque, bloqueVacio, vecinoDeCampo, retrocederNota, significado,
	textoDeNota, tintaDe, type Foco, type Insertable, type Nota,
} from "./pagina";

/** Una unidad o un documento con el que se puede vincular un cuaderno. */
export interface Vinculable { id: string; titulo: string }

const campo = "lh-input rounded-md border border-border bg-background px-2.5 text-sm text-foreground";
const etiqueta = "text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground";

export interface AccionesLista {
	nuevo(): void;
	abrir(id: string): void;
	exportarAnki(): void;
}

export function ListaCuadernosEstudio({ cuadernos, unidades, documentos, ocupado, error, acciones }: {
	/** null mientras carga; del editado más recientemente al más antiguo. */
	cuadernos: Cuaderno[] | null;
	unidades: Vinculable[];
	documentos: Vinculable[];
	ocupado: boolean;
	error: string | null;
	acciones: AccionesLista;
}) {
	const unidad = new Map(unidades.map(u => [u.id, u.titulo]));
	const documento = new Map(documentos.map(d => [d.id, d.titulo]));
	const conPreguntas = cuadernos?.some(c => c.blocks.some(b => b.kind === "recuperacion")) ?? false;
	return (
		<div className="mx-auto w-full max-w-2xl px-6 pb-24 pt-14">
			<h1 className="font-title text-4xl tracking-tight">Cuadernos</h1>
			<p className="mt-2 text-muted-foreground">
				Tus notas, en tus palabras y con tu notación. Las preguntas de recuperación que escribas se practican como cualquier tarea y cuentan como evidencia.
			</p>
			<div className="mt-6 flex flex-wrap gap-2">
				<Button size="sm" disabled={ocupado} onClick={acciones.nuevo}><PlusIcon />Nuevo cuaderno</Button>
				{conPreguntas && <Button size="sm" variant="ghost" disabled={ocupado} onClick={acciones.exportarAnki}>Exportar todas las preguntas a Anki</Button>}
			</div>
			{error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}

			<section className="mt-10" aria-label="Cuadernos del espacio">
				{cuadernos === null ? (
					<p className="text-sm text-muted-foreground">Cargando…</p>
				) : cuadernos.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						Todavía no hay cuadernos en este espacio. Crea uno o, desde el lector, selecciona un pasaje y pulsa «Añadir a mis notas».
					</p>
				) : (
					<ul className="divide-y divide-border">
						{cuadernos.map(c => {
							const donde = [
								c.unitId ? `Unidad: ${unidad.get(c.unitId) ?? "otra unidad"}` : "",
								c.documentId ? `Fuente: ${documento.get(c.documentId) ?? "documento no disponible"}` : "",
							].filter(Boolean);
							return (
								<li key={c.id} data-notebook-id={c.id}>
									<a
										href={rutaCuaderno(c.id)}
										onClick={(e) => { e.preventDefault(); acciones.abrir(c.id); }}
										className="anillo-foco flex items-start gap-3 rounded-lg px-2 py-3 hover:bg-accent/60"
									>
										<NotebookPenIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
										<span className="min-w-0 flex-1">
											<span className="block truncate">{c.title}</span>
											<span className="block text-sm text-muted-foreground">{[recuento(c), ...donde].join(" · ")}</span>
										</span>
									</a>
								</li>
							);
						})}
					</ul>
				)}
			</section>
		</div>
	);
}

/** Lo que dice el indicador de guardado. */
export type EstadoGuardado = { tipo: "guardado" } | { tipo: "sin-guardar" } | { tipo: "guardando" } | { tipo: "error"; motivo: string } | { tipo: "aviso"; texto: string };

const TEXTO_GUARDADO = { guardado: "Guardado", "sin-guardar": "Sin guardar", guardando: "Guardando…" } as const;

export interface AccionesEditor {
	/** El cuaderno con el cambio hecho; se guarda solo, poco después. */
	cambiar(cuaderno: Cuaderno): void;
	exportarMarkdown(): void;
	exportarAnki(): void;
	borrar(): void;
	/** Practica una pregunta de recuperación en la pantalla de intento. */
	practicar(bloqueId: string): void;
	navegar(ruta: string): void;
	/** Pide al tutor un comentario sobre un fragmento (ticket 12b). Sin esta acción no se ofrece. */
	/** Sin `persona`, comenta el del cuaderno; con ella, el personaje a quien se pregunta (ticket 12g). */
	comentar?(ancla: AnclaComentario, tipo: TipoComentario, persona?: string): void;
	/** Descarta un comentario del margen; se queda descartado. */
	descartar?(comentarioId: string): void;
	/** Cierra una petición fallida del margen. */
	cerrarPeticion?(peticionId: string): void;
	/** Hilos de los comentarios (ticket 12c). Sin `responder` el margen no ofrece abrirlos. */
	abrirHilo?(comentarioId: string): void;
	cerrarHilo?(comentarioId: string): void;
	borradorHilo?(comentarioId: string, texto: string): void;
	/** David escribe en el hilo y el tutor contesta. */
	responder?(comentarioId: string, texto: string): void;
	reintentarHilo?(comentarioId: string): void;
	/** Marca el comentario como atendido; false si no se pudo y el hilo debe seguir abierto. */
	atender?(comentarioId: string): Promise<boolean>;
	/** Propuestas del tutor (ticket 12d): aceptar o descartar una. Sin `aceptar` el margen no las muestra. */
	aceptarPropuesta?(comentarioId: string, propuestaId: string): void;
	descartarPropuesta?(comentarioId: string, propuestaId: string): void;
	/** Quita un dibujo del tutor (ticket 12h); sin esta acción los dibujos se ven pero no se pueden quitar. */
	quitarDibujo?(comentarioId: string, dibujoId: string): void;
	/** El modo del tutor en este cuaderno (ticket 12e). Sin esta acción la cabecera no muestra el interruptor. */
	cambiarModo?(modo: ModoCuaderno): void;
	/** El tope diario de lecturas del tutor por su cuenta. */
	fijarTope?(tope: number): void;
	/** El propósito y la tinta del cuaderno (ticket 12f). Sin esta acción la cabecera no ofrece el campo. */
	fijarProposito?(cambio: CambioProposito): void;
	/** Los personajes (ticket 12g): el que comenta solo en el cuaderno, y crear, editar y borrar los de David. */
	elegirPersona?(id: string): void;
	guardarPersonaje?(cambio: CambioPersonaje): Promise<void>;
	borrarPersonaje?(id: string): Promise<void>;
}

/** Lo que la cabecera cuenta del modo proactivo: el gasto de hoy, si el tutor está leyendo y por qué falló un cambio de modo. */
export interface ProactivoVista { estado: EstadoProactivo | null; leyendo: boolean; error: string | null }

/** El color CSS de la tinta de un personaje; `undefined` deja la del cuaderno (ticket 12g). */
const tintaCss = (t: Tinta | undefined) => (t ? colorDeTinta(t) : undefined);

/** La tinta de la marca de una frase comentada: la del primer comentario que la subraya que lleve una. */
function tintaDeMarca(marcas: readonly { id: string; tinta?: string }[], ids: readonly string[]): React.CSSProperties | undefined {
	const tinta = ids.map(id => marcas.find(m => m.id === id)?.tinta).find(Boolean);
	return tinta ? ({ "--tinta-margen": tinta } as React.CSSProperties) : undefined;
}

/** El tipo de letra, el tamaño y la interlínea de un párrafo: el campo y su copia pintada han de coincidir al píxel. */
const PARRAFO = "font-prose text-[1.0625rem] leading-8";

export const ID_MENU_INSERTAR = "menu-insertar";
export const idOpcionInsertar = (kind: Insertable["kind"]) => `${ID_MENU_INSERTAR}-${kind}`;

/** El menú que abre `/`: dónde elegir qué insertar. Se opera con el teclado desde el párrafo; el ratón también vale. */
export function MenuInsertar({ opciones, seleccion, elegir }: {
	opciones: readonly Insertable[];
	seleccion: number;
	elegir(o: Insertable): void;
}) {
	return (
		<div id={ID_MENU_INSERTAR} role="listbox" aria-label="Insertar" className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-border bg-popover p-1 font-sans text-popover-foreground shadow-md">
			{opciones.map((o, k) => (
				<button
					key={o.kind} id={idOpcionInsertar(o.kind)} type="button" role="option" tabIndex={-1} aria-selected={k === seleccion} data-insertar={o.kind}
					// Con el ratón, el campo no pierde el foco ni el menú se cierra antes de elegir.
					onMouseDown={(e) => { e.preventDefault(); elegir(o); }}
					className={cn("flex w-full flex-col rounded-md px-2 py-1.5 text-left text-sm", k === seleccion && "bg-accent text-accent-foreground")}
				>
					<span>{o.etiqueta}</span>
					<span className="text-xs text-muted-foreground">{o.pista}</span>
				</button>
			))}
		</div>
	);
}

/** Unidad y fuente: lo que ya no está a la vista en la página. */
export function PropiedadesCuaderno({ cuaderno: c, unidades, documentos, ocupado, cambiar, navegar }: {
	cuaderno: Cuaderno;
	/** Las unidades activas del espacio; la vinculada se añade aunque no lo esté. */
	unidades: Vinculable[];
	/** Los documentos listos del espacio. */
	documentos: Vinculable[];
	ocupado: boolean;
	cambiar(parcial: Partial<Cuaderno>): void;
	navegar(ruta: string): void;
}) {
	const unidadVinculada = c.unitId ? unidades.find(u => u.id === c.unitId) ?? null : null;
	const fuenteVinculada = c.documentId ? documentos.find(d => d.id === c.documentId) ?? null : null;
	const ir = (ruta: string) => (e: React.MouseEvent) => { e.preventDefault(); navegar(ruta); };
	const rutaUnidad = unidadVinculada && `/unidad/${encodeURIComponent(unidadVinculada.id)}`;
	const rutaFuente = fuenteVinculada && rutaLector(fuenteVinculada.id, c.unitId ? { unidad: c.unitId } : {});
	const opcionesUnidad = c.unitId && !unidades.some(u => u.id === c.unitId) ? [...unidades, { id: c.unitId, titulo: "Unidad no activa" }] : unidades;
	const opcionesFuente = c.documentId && !documentos.some(d => d.id === c.documentId) ? [...documentos, { id: c.documentId, titulo: "Documento no disponible" }] : documentos;
	return (
		<div className="grid gap-6">
			<label className="grid gap-1.5">
				<span className={etiqueta}>Unidad</span>
				<select name="unitId" value={c.unitId ?? ""} disabled={ocupado} onChange={(e) => cambiar({ unitId: e.target.value || null })} className={cn(campo, "h-9 w-full min-w-0")}>
					<option value="">Sin unidad</option>
					{opcionesUnidad.map(u => <option key={u.id} value={u.id}>{u.titulo}</option>)}
				</select>
				<span className="text-sm text-muted-foreground">Con una unidad vinculada, las preguntas de recuperación de este cuaderno se pueden practicar.</span>
				{rutaUnidad && <a href={rutaUnidad} onClick={ir(rutaUnidad)} className="anillo-foco rounded-sm text-sm underline-offset-2 hover:underline">Abrir la unidad</a>}
			</label>
			<label className="grid gap-1.5">
				<span className={etiqueta}>Fuente</span>
				<select name="documentId" value={c.documentId ?? ""} disabled={ocupado} onChange={(e) => cambiar({ documentId: e.target.value || null })} className={cn(campo, "h-9 w-full min-w-0")}>
					<option value="">Sin fuente</option>
					{opcionesFuente.map(d => <option key={d.id} value={d.id}>{d.titulo}</option>)}
				</select>
				<span className="text-sm text-muted-foreground">El documento de la biblioteca del que salen tus notas.</span>
				{rutaFuente && <a href={rutaFuente} onClick={ir(rutaFuente)} className="anillo-foco rounded-sm text-sm underline-offset-2 hover:underline">Abrir la fuente</a>}
			</label>
		</div>
	);
}

export function EditorCuadernoEstudio({ cuaderno: c, unidades, documentos, guardado, ocupado, enfocarTitulo = false, peticiones = [], hilos = SIN_HILOS, decisiones = {}, proactivo, personajes, voz, acciones }: {
	cuaderno: Cuaderno;
	/** Las unidades activas del espacio; la vinculada se añade aunque no lo esté. */
	unidades: Vinculable[];
	/** Los documentos listos del espacio. */
	documentos: Vinculable[];
	guardado: EstadoGuardado;
	ocupado: boolean;
	/** Recién creado: el título se enfoca y se selecciona para nombrarlo. */
	enfocarTitulo?: boolean;
	/** Lo que se ha pedido al tutor y aún no es un comentario: pensando o fallido (ticket 12b). */
	peticiones?: PeticionMargen[];
	/** Qué hilo está abierto, lo escrito sin enviar y lo que se espera de cada uno (ticket 12c). */
	hilos?: EstadoHilos;
	/** Lo que pasa con las propuestas del tutor fuera de lo guardado, por id de propuesta (ticket 12d). */
	decisiones?: Readonly<Record<string, EstadoDecision>>;
	/** El modo del tutor y su gasto (ticket 12e); sin esto no se pinta el interruptor. */
	proactivo?: ProactivoVista;
	/** Los personajes del tutor (ticket 12g); sin ellos no hay selector ni «Preguntar a…» y los comentarios usan la tinta del cuaderno. */
	personajes?: ListaPersonajes | null;
	/** Escuchar al tutor (ticket 12j): el interruptor de la cabecera y el botón de cada comentario; sin esto no se pintan. */
	voz?: VozVista;
	acciones: AccionesEditor;
}) {
	const lista = useRef<HTMLOListElement>(null);
	const [resaltado, setResaltado] = useState<string | null>(null);
	const titulo = useRef<HTMLInputElement>(null);
	const raiz = useRef<HTMLDivElement>(null);
	// El núcleo reserva Tab para recorrer los campos de texto de la superficie activa: aquí, título y bloques en orden
	// (Mayús+Tab, hacia atrás).
	// También el margen: «Responder», las marcas de los atendidos y el hilo abierto, para llegar a ellos sin ratón.
	useRecorridoCampos(useCallback(() => camposDe(raiz.current, 'input[name="titulo"], textarea, [data-recorrido]'), []));
	const [tituloVisto, setTituloVisto] = useState(c.title);
	const [propiedades, setPropiedades] = useState(false);
	useEffect(() => { if (enfocarTitulo) { titulo.current?.focus(); titulo.current?.select(); } }, [enfocarTitulo]);

	// Un hueco al final para seguir escribiendo: la página vacía, o tras un bloque de error o de pregunta. Se convierte
	// en bloque al teclear en él y su id es el del bloque, así el campo no se rehace ni pierde el cursor.
	const hueco = useRef<Nota>(nuevoBloque("nota") as Nota);
	if (c.blocks.some(b => b.id === hueco.current.id)) hueco.current = nuevoBloque("nota") as Nota;
	const ultimo = c.blocks[c.blocks.length - 1];
	const vista: BloqueCuaderno[] = !ultimo || ultimo.kind !== "nota" ? [...c.blocks, hueco.current] : c.blocks;

	const [enfocado, setEnfocado] = useState<string | null>(null);
	const [seleccion, setSeleccion] = useState(0);
	const [menuCerrado, setMenuCerrado] = useState(false);

	/** Dónde dejar el cursor tras el siguiente cambio de la página. */
	const foco = useRef<Foco | null>(null);
	const aplicarFoco = (f: Foco) => {
		const el = [...(raiz.current?.querySelectorAll<HTMLElement>("[data-block-id]") ?? [])].find(x => x.dataset.blockId === f.id)
			?.querySelector<HTMLTextAreaElement>(`[data-campo="${f.campo}"]`);
		if (!el) return;
		el.focus();
		const pos = f.pos === "fin" ? el.value.length : f.pos;
		el.setSelectionRange(pos, pos);
	};
	useEffect(() => { if (foco.current) { const f = foco.current; foco.current = null; aplicarFoco(f); } });

	const cambiar = (parcial: Partial<Cuaderno>) => acciones.cambiar({ ...c, ...parcial });
	const aplicar = (r: { blocks: BloqueCuaderno[]; foco: Foco | null }) => { foco.current = r.foco; cambiar({ blocks: r.blocks }); };
	const bloque = (i: number, b: BloqueCuaderno) => cambiar({ blocks: c.blocks.map((x, j) => (j === i ? b : x)) });
	const textoCambiado = (i: number, b: Nota, crudo: string, pos: number) => {
		setSeleccion(0);
		setMenuCerrado(false);
		// Un pegado con saltos de línea (o Mayús+Intro) se reparte en párrafos: un bloque por línea.
		if (crudo.includes("\n")) { aplicar(partirTexto(c.blocks, i, b, crudo, pos, () => nuevoBloque("nota").id)); return; }
		if (i < c.blocks.length) bloque(i, conTexto(b, crudo));
		else if (crudo) cambiar({ blocks: [...c.blocks, conTexto(b, crudo)] });
	};

	const teclaParrafo = (e: React.KeyboardEvent<HTMLTextAreaElement>, i: number, b: Nota, opciones: readonly Insertable[] | null) => {
		if (e.nativeEvent.isComposing) return;
		const real = i < c.blocks.length;
		const area = e.currentTarget;
		const alInicio = area.selectionStart === 0 && area.selectionEnd === 0;
		const alFinal = area.selectionStart === area.value.length && area.selectionEnd === area.value.length;
		const sel = Math.min(seleccion, Math.max(0, (opciones?.length ?? 1) - 1));
		if (opciones && !menuCerrado) {
			if (e.key === "ArrowDown" && opciones.length) { e.preventDefault(); setSeleccion((sel + 1) % opciones.length); return; }
			if (e.key === "ArrowUp" && opciones.length) { e.preventDefault(); setSeleccion((sel + opciones.length - 1) % opciones.length); return; }
			if (e.key === "Enter" && opciones[sel]) { e.preventDefault(); elegir(i, opciones[sel]!); return; }
			if (e.key === "Escape") { e.preventDefault(); setMenuCerrado(true); return; }
		}
		if (e.key === "Backspace" && e.shiftKey && (e.ctrlKey || e.metaKey) && real) {
			// Quitar el párrafo entero, con su texto, sin pasar por el ratón.
			e.preventDefault();
			aplicar(quitarBloque(c.blocks, i));
		} else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && real) {
			e.preventDefault();
			const d = e.key === "ArrowUp" ? -1 : 1;
			foco.current = { id: b.id, campo: "texto", pos: area.selectionStart };
			cambiar({ blocks: moverBloque(c.blocks, i, d) });
		} else if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
			e.preventDefault();
			if (real) aplicar(dividirNota(c.blocks, i, area.selectionStart, nuevoBloque("nota").id));
		} else if (e.key === "Backspace" && alInicio && !e.ctrlKey && !e.metaKey) {
			const r = real ? retrocederNota(c.blocks, i) : null;
			if (r) { e.preventDefault(); aplicar(r); }
			else if (!real && !b.text && i > 0) { e.preventDefault(); aplicarFoco(focoAlFinal(vista[i - 1]!)); }
		} else if (e.key === "ArrowUp" && alInicio && i > 0 && !e.altKey) {
			e.preventDefault();
			aplicarFoco(focoAlFinal(vista[i - 1]!));
		} else if (e.key === "ArrowDown" && alFinal && i < vista.length - 1 && !e.altKey) {
			e.preventDefault();
			aplicarFoco(focoAlInicio(vista[i + 1]!));
		}
	};

	/** Las teclas de un campo de un bloque de error o de pregunta: las flechas salen del campo hacia el vecino, Retroceso quita el
	 * bloque si no tiene nada escrito, Ctrl+Mayús+Retroceso lo quita siempre y Alt con las flechas lo mueve. */
	const teclaTarjeta = (e: React.KeyboardEvent<HTMLTextAreaElement>, i: number, b: BloqueCuaderno, campo: string) => {
		if (e.nativeEvent.isComposing) return;
		const area = e.currentTarget;
		const sinSeleccion = area.selectionStart === area.selectionEnd;
		const ir = (f: Foco | null) => { if (f) { e.preventDefault(); aplicarFoco(f); } };
		if (e.key === "Backspace" && e.shiftKey && (e.ctrlKey || e.metaKey)) { e.preventDefault(); aplicar(quitarBloque(c.blocks, i)); }
		else if (e.key === "Backspace" && !e.ctrlKey && !e.metaKey && !e.altKey && bloqueVacio(b)) { e.preventDefault(); aplicar(quitarBloque(c.blocks, i)); }
		else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
			e.preventDefault();
			foco.current = { id: b.id, campo, pos: area.selectionStart };
			cambiar({ blocks: moverBloque(c.blocks, i, e.key === "ArrowUp" ? -1 : 1) });
		}
		else if (e.key === "ArrowUp" && sinSeleccion && area.selectionStart === 0 && !e.shiftKey) ir(vecinoDeCampo(vista, i, campo, -1));
		else if (e.key === "ArrowDown" && sinSeleccion && area.selectionStart === area.value.length && !e.shiftKey) ir(vecinoDeCampo(vista, i, campo, 1));
	};

	// El hueco se vuelve bloque al teclear la barra, así que el párrafo de la barra siempre es un bloque.
	const elegir = (i: number, o: Insertable) => aplicar(insertarEspecial(c.blocks, i, o.kind, nuevoBloque(o.kind).id));

	const quitar = (i: number) => aplicar(quitarBloque(c.blocks, i));
	const textoGuardado = guardado.tipo === "error" ? `No se pudo guardar: ${guardado.motivo}` : guardado.tipo === "aviso" ? guardado.texto : TEXTO_GUARDADO[guardado.tipo];
	const vacia = c.blocks.length === 0;

	// El margen: cada comentario y cada petición en curso con su sitio en la página. Sin ninguno, la página es la limpia.
	const items: ItemMargen[] = [
		...visibles(c.comments).map(x => ({ id: x.id, anchor: x.anchor, comentario: x, tinta: tintaCss(tintaDeComentario(x, personajes)), firma: firmaDe(x, personajes) })),
		...peticiones.map(x => ({ id: x.id, anchor: x.anchor, peticion: x })),
	];
	// Colocar recorre la página por cada comentario: solo se rehace cuando cambian la página o el margen, no al teclear en otro sitio.
	const puestos = useMemo(() => colocar(c.blocks, items), [c.blocks, c.comments, peticiones, personajes]);
	const conMargen = puestos.length > 0;
	// Un comentario atendido no subraya su frase: queda su marca pequeña en el margen.
	const marcasDe = (bloqueId: string) => puestos.flatMap(p => (p.sitio?.blockId === bloqueId && p.item.comentario?.state !== "atendido" ? [{ id: p.item.id, start: p.sitio.start, end: p.sitio.end, tinta: p.item.tinta }] : []));

	// Al cerrar un hilo con Escape el foco vuelve a su tarjeta, donde se abrió; al volver a la nota, al párrafo.
	const devolverFoco = useRef<string | null>(null);
	useEffect(() => {
		const id = devolverFoco.current;
		if (!id || hilos.abierto === id) return;
		devolverFoco.current = null;
		[...(raiz.current?.querySelectorAll<HTMLElement>("[data-margen-id]") ?? [])].find(x => x.dataset.margenId === id)?.querySelector<HTMLElement>("[data-abrir-hilo]")?.focus();
	});
	// «Volver a la nota» espera al servidor: lo que decide dónde dejar el cursor se lee al terminar, no al pulsar.
	const vigente = useRef({ puestos, c, vista });
	vigente.current = { puestos, c, vista };
	const accionesHilo: AccionesHilo | undefined = acciones.responder ? {
		abrir: (id) => acciones.abrirHilo?.(id),
		cerrar: (id) => { devolverFoco.current = id; acciones.cerrarHilo?.(id); },
		borrador: (id, texto) => acciones.borradorHilo?.(id, texto),
		enviar: (id, texto) => acciones.responder?.(id, texto),
		reintentar: (id) => acciones.reintentarHilo?.(id),
		volver: (id) => {
			// El párrafo anclado, o el que lo conserve; sin su frase, el del ancla si sigue o, si no, el último.
			void (async () => {
				if (acciones.atender && !(await acciones.atender(id))) return;
				const { puestos: ps, c: cuaderno, vista: v } = vigente.current;
				const puesto = ps.find(p => p.item.id === id);
				const bloqueId = puesto?.sitio?.blockId ?? (puesto && cuaderno.blocks.some(b => b.id === puesto.item.anchor.blockId) ? puesto.item.anchor.blockId : null);
				acciones.cerrarHilo?.(id);
				aplicarFoco(bloqueId ? { id: bloqueId, campo: "texto", pos: "fin" } : focoAlFinal(v[v.length - 1]!));
			})();
		},
	} : undefined;
	const accionesPropuestas: AccionesPropuestas | undefined = acciones.aceptarPropuesta && acciones.descartarPropuesta ? {
		aceptar: acciones.aceptarPropuesta, descartar: acciones.descartarPropuesta, abrir: acciones.navegar, estado: decisiones,
	} : undefined;
	/* Los dibujos del tutor (ticket 12h) cuelgan de su párrafo, en la columna del texto, y no son texto de David: cada uno es de un
	 * comentario que no esté descartado y se pinta con la tinta del personaje que lo dibujó, o la del cuaderno. */
	const accionesDibujos: AccionesDibujos = { quitar: acciones.quitarDibujo, clave: c.tinta ?? "" };
	const dibujosDe = (bloqueId: string) => puestos.flatMap(p => (p.sitio?.blockId === bloqueId && p.item.comentario?.dibujos
		? p.item.comentario.dibujos.map(d => ({ d, comentario: p.item.comentario!, item: p.item }))
		: []));
	const quitarDelMargen = (item: ItemMargen) => (item.peticion ? acciones.cerrarPeticion?.(item.id) : acciones.descartar?.(item.id));

	return (
		<div ref={raiz} className="@container/pagina mx-auto w-full max-w-[64rem] px-12 pb-24 pt-14" data-notebook-id={c.id} style={{ "--tinta-margen": colorDeTinta(c.tinta) } as React.CSSProperties}>
			<div className={COLUMNAS_PAGINA}>
			<div className={COLUMNA_TEXTO}>
			{/* La cabecera solo enseña lo esencial (revisión del 23-nov-2026): volver, el guardado, el modo del tutor y quién comenta, y
			 * «⋯». Lo demás (unidad, fuente, propósito, tinta y tope) está en Propiedades, y la voz es una casilla de «⋯». */}
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
				<a href={RUTA_CUADERNOS} onClick={(e) => { e.preventDefault(); acciones.navegar(RUTA_CUADERNOS); }} className="anillo-foco rounded-sm text-muted-foreground hover:text-foreground">Cuadernos</a>
				<span
					role="status"
					data-estado={guardado.tipo}
					className={cn("ml-auto text-xs", guardado.tipo === "error" ? "text-destructive" : "text-muted-foreground")}
				>{textoGuardado}</span>
				{proactivo && acciones.cambiarModo && acciones.fijarTope && (
					<ModoProactivo
						modo={c.modo ?? "proactivo"} aviso={c.aviso} estado={proactivo.estado} leyendo={proactivo.leyendo} error={proactivo.error}
						cambiarModo={acciones.cambiarModo} fijarTope={acciones.fijarTope}
					>
						{personajes && acciones.elegirPersona && acciones.guardarPersonaje && acciones.borrarPersonaje && (
							<PersonajeCuaderno lista={personajes} actual={personajeDeCuaderno(c, personajes)} elegir={acciones.elegirPersona} guardar={acciones.guardarPersonaje} borrar={acciones.borrarPersonaje} />
						)}
					</ModoProactivo>
				)}
				{voz && <AvisoEscuchar voz={voz} />}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button size="icon-sm" variant="ghost" aria-label="Más acciones" title="Más acciones" data-mas-acciones className="text-muted-foreground"><MoreHorizontalIcon /></Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-72 font-sans">
						<DropdownMenuItem data-abrir-propiedades onSelect={() => setPropiedades(true)}><SlidersHorizontalIcon />Propiedades…</DropdownMenuItem>
						{voz && <OpcionEscuchar voz={voz} />}
						<DropdownMenuSeparator />
						<DropdownMenuItem disabled={ocupado} onSelect={acciones.exportarMarkdown}>Exportar a Markdown</DropdownMenuItem>
						<DropdownMenuItem disabled={ocupado} onSelect={acciones.exportarAnki}>Exportar preguntas a Anki</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem variant="destructive" disabled={ocupado} onSelect={acciones.borrar}><Trash2Icon />Mover a la papelera</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			<input
				ref={titulo}
				name="titulo"
				aria-label="Título"
				value={tituloVisto}
				onChange={(e) => { setTituloVisto(e.target.value); if (e.target.value.trim()) cambiar({ title: e.target.value }); }}
				onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); aplicarFoco(focoAlInicio(vista[0]!)); } }}
				className="mt-12 w-full text-ellipsis bg-transparent font-title text-4xl tracking-tight outline-none placeholder:text-muted-foreground"
				placeholder="Título del cuaderno"
			/>

			<ol ref={lista} className="mt-10 space-y-1" aria-label="Página">
				{vista.map((b, i) => {
					const opciones = b.kind === "nota" && enfocado === b.id ? opcionesDeBarra(textoDeNota(b)) : null;
					return (
						<li key={b.id} data-kind={b.kind} data-block-id={b.id} data-hueco={i >= c.blocks.length ? "" : undefined} className="group relative">
							{i < c.blocks.length && (
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<button
											type="button" aria-label="Acciones del bloque" title="Acciones del bloque. Alt con ↑ ↓ lo mueve; Ctrl+Mayús+Retroceso lo quita"
											className="absolute -left-9 top-1 flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none hover:bg-accent focus-visible:opacity-100 group-focus-within:opacity-60 group-hover:opacity-60 data-[state=open]:opacity-100"
										><GripVerticalIcon className="size-4" /></button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="start" className="font-sans">
										<DropdownMenuItem disabled={i === 0} onSelect={() => cambiar({ blocks: moverBloque(c.blocks, i, -1) })}><ArrowUpIcon />Subir</DropdownMenuItem>
										<DropdownMenuItem disabled={i === c.blocks.length - 1} onSelect={() => cambiar({ blocks: moverBloque(c.blocks, i, 1) })}><ArrowDownIcon />Bajar</DropdownMenuItem>
										<DropdownMenuItem variant="destructive" onSelect={() => quitar(i)}><XIcon />Quitar</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							)}
							<Bloque
								bloque={b} cuaderno={c} ocupado={ocupado} primera={vacia && i === 0}
								marcas={marcasDe(b.id)} resaltado={resaltado} pedir={acciones.comentar && !ocupado ? acciones.comentar : undefined} personajes={personajes ? todos(personajes) : undefined}
								cambiar={(nuevo) => bloque(i, nuevo)}
								practicar={() => acciones.practicar(b.id)}
								enfocar={(dentro) => setEnfocado(actual => (dentro ? b.id : actual === b.id ? null : actual))}
								escribir={(crudo, pos) => textoCambiado(i, b as Nota, crudo, pos)}
								tecla={(e) => teclaParrafo(e, i, b as Nota, opciones)}
								teclaCampo={(e, campo) => teclaTarjeta(e, i, b, campo)}
								menu={opciones && opciones.length > 0 && !menuCerrado ? { opcionActiva: idOpcionInsertar(opciones[Math.min(seleccion, opciones.length - 1)]!.kind) } : undefined}
							/>
							{opciones && opciones.length > 0 && !menuCerrado && (
								<MenuInsertar
									opciones={opciones} seleccion={Math.min(seleccion, Math.max(0, opciones.length - 1))}
									elegir={(o) => elegir(i, o)}
								/>
							)}
							{dibujosDe(b.id).map(({ d, comentario, item }) => (
								<div key={d.id} style={item.tinta ? ({ "--tinta-margen": item.tinta } as React.CSSProperties) : undefined}>
									<DibujoMermaid
										id={d.id} codigo={d.mermaid} firma={item.firma ?? firmaDe(comentario)} clave={`${accionesDibujos.clave}|${item.tinta ?? ""}`}
										quitar={acciones.quitarDibujo && (() => acciones.quitarDibujo!(comentario.id, d.id))}
									/>
								</div>
							))}
						</li>
					);
				})}
			</ol>
			<div aria-hidden="true" className="h-40 cursor-text" onClick={() => aplicarFoco(focoAlFinal(vista[vista.length - 1]!))} />
			</div>
			{conMargen && <Margen puestos={puestos} lista={lista} resaltado={resaltado} resaltar={setResaltado} quitar={quitarDelMargen} hilos={hilos} acciones={accionesHilo} propuestas={accionesPropuestas} dibujos={accionesDibujos} voz={voz} />}
			</div>

			<Sheet open={propiedades} onOpenChange={setPropiedades}>
				<SheetContent side="right" className="gap-0 font-prose sm:max-w-sm" data-testid="propiedades-cuaderno">
					<SheetHeader>
						<SheetTitle>Propiedades</SheetTitle>
						<SheetDescription>Con qué se relaciona este cuaderno y cómo te acompaña el tutor.</SheetDescription>
					</SheetHeader>
					<div className="grid gap-8 overflow-y-auto px-4 pb-6">
						<PropiedadesCuaderno cuaderno={c} unidades={unidades} documentos={documentos} ocupado={ocupado} cambiar={cambiar} navegar={acciones.navegar} />
						{(acciones.fijarProposito || (proactivo?.estado && acciones.fijarTope)) && (
							<section aria-labelledby="propiedades-tutor" data-propiedades-tutor className="grid gap-6 border-t border-border pt-6">
								<h3 id="propiedades-tutor" className="font-sans text-sm font-medium text-foreground">Tutor</h3>
								{acciones.fijarProposito && <PropositoCuaderno proposito={c.proposito} fijar={acciones.fijarProposito} />}
								{proactivo?.estado && acciones.fijarTope && (
									<div className="grid gap-1.5">
										<span className={etiqueta}>Lecturas por su cuenta</span>
										<TopeDiario estado={proactivo.estado} fijarTope={acciones.fijarTope} />
										<span className="text-sm text-muted-foreground">Cuántas veces al día puede leer y comentar sin que se lo pidas, contando todos tus cuadernos.</span>
									</div>
								)}
								{acciones.fijarProposito && <TintaCuaderno tinta={c.tinta} fijar={acciones.fijarProposito} />}
							</section>
						)}
					</div>
				</SheetContent>
			</Sheet>
		</div>
	);
}

/** Una línea de campo que crece con su texto, para los bloques de error y de pregunta. */
function Campo({ name, etiqueta: pie, texto, valor, cambiar, tecla }: { name: string; etiqueta: string; texto: string; valor: string; cambiar(v: string): void; tecla?(e: React.KeyboardEvent<HTMLTextAreaElement>): void }) {
	return (
		<label className="grid gap-0.5">
			<span className="text-[11px] text-muted-foreground">{pie}</span>
			<textarea
				name={name} data-campo={name} aria-label={texto} placeholder="…" rows={1} value={valor}
				onChange={(e) => cambiar(e.target.value)} onKeyDown={tecla}
				className={cn(PARRAFO, "field-sizing-content block w-full resize-none bg-transparent p-0 outline-none placeholder:text-muted-foreground/50")}
			/>
		</label>
	);
}

/** Un bloque discreto dentro de la página: sin marco, una raya de color a la izquierda y su nombre en pequeño. */
function Tarjeta({ nombre, tinta, children }: { nombre: string; tinta: string; children: React.ReactNode }) {
	return (
		<div className="my-4 rounded-lg border-l-2 bg-muted/40 py-3 pl-4 pr-4" style={{ borderLeftColor: tinta }}>
			<p className={etiqueta}>{nombre}</p>
			<div className="mt-2 grid gap-3">{children}</div>
		</div>
	);
}

/** El párrafo: un campo de texto sin ver (texto transparente) y, encima, su copia con el símbolo coloreado. La copia da la
 * altura, así el campo crece sin medirlo, y deja pasar el ratón salvo en el símbolo, que dice qué significa. */
function Parrafo({ nota: b, primera, escribir, enfocar, tecla, marcas, resaltado, pedir, personajes, menu }: {
	nota: Nota; primera: boolean; escribir(crudo: string, pos: number): void; enfocar(dentro: boolean): void; tecla(e: React.KeyboardEvent<HTMLTextAreaElement>): void;
	/** Las frases comentadas de este párrafo, con sus límites en el texto que se ve. */
	marcas: readonly { id: string; start: number; end: number; tinta?: string }[];
	resaltado: string | null;
	/** Pedir al tutor un comentario del texto seleccionado; sin ella no se ofrece. */
	pedir?(ancla: AnclaComentario, tipo: TipoComentario, persona?: string): void;
	/** A quién se puede preguntar (ticket 12g). */
	personajes?: readonly Personaje[];
	/** El menú `/` de este párrafo mientras está abierto: lo que el campo dice de él a los lectores de pantalla. */
	menu?: { opcionActiva: string };
}) {
	const area = useRef<HTMLTextAreaElement>(null);
	const caja = useRef<HTMLDivElement>(null);
	const marcaSeleccion = useRef<HTMLSpanElement>(null);
	// Lo que David tiene seleccionado en este párrafo, para ofrecerle la barra junto a la selección.
	const [seleccion, setSeleccion] = useState<{ inicio: number; fin: number } | null>(null);
	const [barra, setBarra] = useState<{ top: number; left: number } | null>(null);
	useLayoutEffect(() => {
		const marca = marcaSeleccion.current, dentro = caja.current;
		if (!seleccion || !marca || !dentro) { setBarra(null); return; }
		const r = marca.getClientRects()[0] ?? marca.getBoundingClientRect();
		const o = dentro.getBoundingClientRect();
		setBarra({ top: r.top - o.top - 38, left: Math.max(0, Math.min(r.left - o.left, o.width - 340)) });
	}, [seleccion]);
	const pedirAlTutor = (tipo: TipoComentario, persona?: string) => {
		const ancla = seleccion && anclaDeSeleccion(b, seleccion.inicio, seleccion.fin);
		// El foco vuelve al párrafo (con el teclado estaba en la barra) y el cursor, al final de lo seleccionado.
		area.current?.focus();
		if (seleccion) area.current?.setSelectionRange(seleccion.fin, seleccion.fin);
		setSeleccion(null);
		if (ancla && pedir) pedir(ancla, tipo, persona);
	};
	const ponerCursor = (e: React.MouseEvent) => {
		e.preventDefault();
		area.current?.focus();
		const fin = (b.symbol?.length ?? 0) + 1;
		area.current?.setSelectionRange(fin, fin);
	};
	return (
		<div className="relative">
			{b.quote && (
				<blockquote className="mb-2 rounded-md bg-muted px-4 py-2 text-[0.9375rem] italic leading-7 text-muted-foreground">
					{b.quote}
					{b.locator && <cite className="ml-2 text-xs not-italic">{b.locator}</cite>}
				</blockquote>
			)}
			{!b.quote && b.locator && <p className="mb-1 text-xs text-muted-foreground">{b.locator}</p>}
			<div ref={caja} className="relative">
				<textarea
					ref={area} name="text" data-campo="texto" rows={1} value={textoDeNota(b)}
					{...(menu ? { role: "combobox", "aria-haspopup": "listbox", "aria-expanded": true, "aria-controls": ID_MENU_INSERTAR, "aria-activedescendant": menu.opcionActiva } : {})}
					aria-label={b.symbol ? `Párrafo (${significado(b.symbol)})` : "Párrafo"}
					placeholder={primera ? "Escribe aquí. «/» inserta un error o una pregunta. Selecciona texto para pedirle algo al tutor." : ""}
					onChange={(e) => { setSeleccion(null); escribir(e.target.value, e.target.selectionStart); }}
					onKeyDown={tecla}
					onSelect={(e) => {
						const t = e.currentTarget;
						setSeleccion(pedir && t.selectionStart !== t.selectionEnd && t.value.slice(t.selectionStart, t.selectionEnd).trim() ? { inicio: t.selectionStart, fin: t.selectionEnd } : null);
					}}
					onFocus={() => enfocar(true)}
						onBlur={(e) => {
							// Con Tab el foco pasa a la barra de este párrafo: la selección y la barra se quedan.
							if (!caja.current?.contains(e.relatedTarget as Node | null)) setSeleccion(null);
							enfocar(false);
						}}
					className={cn(PARRAFO, "absolute inset-0 size-full resize-none overflow-hidden border-0 bg-transparent p-0 text-transparent caret-foreground outline-none placeholder:text-muted-foreground/50")}
				/>
				<div aria-hidden="true" data-copia className={cn(PARRAFO, "pointer-events-none relative whitespace-pre-wrap break-words")}>
					{marcas.length === 0 && !seleccion ? (
						<>
							{b.symbol && <><span data-simbolo={b.symbol} title={significado(b.symbol)} onMouseDown={ponerCursor} className={cn("pointer-events-auto cursor-help", tintaDe(b.symbol))}>{b.symbol}</span>{" "}</>}
							{b.text}
						</>
					) : (
						<TextoMarcado b={b} marcas={marcas} seleccion={seleccion} resaltado={resaltado} ponerCursor={ponerCursor} marcaSeleccion={marcaSeleccion} />
					)}
					{"​"}
				</div>
				{seleccion && pedir && <BarraSeleccion top={barra?.top} left={barra?.left} pedir={pedirAlTutor} personajes={personajes} alSalir={(volver) => { setSeleccion(null); if (volver) area.current?.focus(); }} />}
			</div>
		</div>
	);
}

/** La copia pintada de un párrafo con frases comentadas y, si la hay, la selección que espera la barra: el texto partido
 * en trozos, el símbolo con su color y su significado, y cada frase comentada subrayada en tinta. */
function TextoMarcado({ b, marcas, seleccion, resaltado, ponerCursor, marcaSeleccion }: {
	b: Nota; marcas: readonly { id: string; start: number; end: number; tinta?: string }[]; seleccion: { inicio: number; fin: number } | null; resaltado: string | null;
	ponerCursor(e: React.MouseEvent): void; marcaSeleccion: React.RefObject<HTMLSpanElement | null>;
}) {
	const SEL = "__seleccion";
	const rangos = [...marcas, ...(seleccion ? [{ id: SEL, start: seleccion.inicio, end: seleccion.fin }] : [])];
	const largo = b.symbol?.length ?? 0;
	let primera = true;
	return (
		<>
			{segmentos(textoDeNota(b), rangos, b.symbol ? [largo, largo + 1] : []).map(s => {
				const base = b.symbol && s.inicio < largo
					? <span data-simbolo={b.symbol} title={significado(b.symbol)} onMouseDown={ponerCursor} className={cn("pointer-events-auto cursor-help", tintaDe(b.symbol))}>{s.texto}</span>
					: s.texto;
				const comentarios = s.ids.filter(id => id !== SEL);
				const elegido = s.ids.includes(SEL);
				if (comentarios.length === 0 && !elegido) return <Fragment key={s.inicio}>{base}</Fragment>;
				const ref = elegido && primera ? marcaSeleccion : undefined;
				if (elegido) primera = false;
				return (
					<span
						key={s.inicio} ref={ref} data-comentario={comentarios.length ? comentarios.join(" ") : undefined}
						style={comentarios.length ? tintaDeMarca(marcas, comentarios) : undefined}
						className={comentarios.length ? claseMarca(comentarios.includes(resaltado ?? "")) : undefined}
					>{base}</span>
				);
			})}
		</>
	);
}

function Bloque({ bloque: b, cuaderno, ocupado, primera, cambiar, practicar, enfocar, escribir, tecla, teclaCampo, menu, marcas, resaltado, pedir, personajes }: {
	bloque: BloqueCuaderno; cuaderno: Cuaderno; ocupado: boolean; primera: boolean; cambiar(b: BloqueCuaderno): void; practicar(): void;
	enfocar(dentro: boolean): void; escribir(crudo: string, pos: number): void; tecla(e: React.KeyboardEvent<HTMLTextAreaElement>): void;
	/** Las teclas de un campo de un bloque de error o de pregunta. */
	teclaCampo(e: React.KeyboardEvent<HTMLTextAreaElement>, campo: string): void; menu?: { opcionActiva: string };
	marcas: readonly { id: string; start: number; end: number; tinta?: string }[]; resaltado: string | null; pedir?(ancla: AnclaComentario, tipo: TipoComentario, persona?: string): void; personajes?: readonly Personaje[];
}) {
	if (b.kind === "nota") return <Parrafo nota={b} primera={primera} escribir={escribir} enfocar={enfocar} tecla={tecla} marcas={marcas} resaltado={resaltado} pedir={pedir} personajes={personajes} menu={menu} />;
	if (b.kind === "error") {
		return (
			<Tarjeta nombre="Error" tinta="var(--lh-error)">
				<Campo name="wrong" etiqueta="Lo que creías" texto="Lo que creía (la representación incorrecta)" valor={b.wrong} cambiar={(wrong) => cambiar({ ...b, wrong })} tecla={(e) => teclaCampo(e, "wrong")} />
				<Campo name="cause" etiqueta="Por qué lo creías" texto="Por qué lo creía (causa probable)" valor={b.cause} cambiar={(cause) => cambiar({ ...b, cause })} tecla={(e) => teclaCampo(e, "cause")} />
				<Campo name="fix" etiqueta="Corrección" texto="Corrección" valor={b.fix} cambiar={(fix) => cambiar({ ...b, fix })} tecla={(e) => teclaCampo(e, "fix")} />
			</Tarjeta>
		);
	}
	const motivo = !cuaderno.unitId ? "Vincula el cuaderno a una unidad (en Propiedades) para practicar esta pregunta."
		: !b.question.trim() || !b.answer.trim() ? "Escribe la pregunta y tu respuesta para practicarla." : null;
	return (
		<Tarjeta nombre="Pregunta de recuperación" tinta="var(--lh-accent)">
			<Campo name="question" etiqueta="Pregunta" texto="Pregunta que te harás sin mirar" valor={b.question} cambiar={(question) => cambiar({ ...b, question })} tecla={(e) => teclaCampo(e, "question")} />
			<Campo name="answer" etiqueta="Tu respuesta" texto="Tu respuesta esperada, completa y con sus condiciones" valor={b.answer} cambiar={(answer) => cambiar({ ...b, answer })} tecla={(e) => teclaCampo(e, "answer")} />
			<div className="flex items-center gap-3">
				<Button size="sm" variant="secondary" data-recorrido disabled={ocupado || !practicable(cuaderno, b)} onClick={practicar}>Practicar</Button>
				{motivo && <span className="text-sm text-muted-foreground">{motivo}</span>}
			</div>
		</Tarjeta>
	);
}

/** Las unidades activas y los documentos listos del espacio, para vincular. Un documento al que ya apunta un
 * cuaderno pero que no es del espacio (los incorporados antes de los espacios no tienen) se añade con su título. */
async function leerVinculables(cuadernos: Cuaderno[]): Promise<{ unidades: Vinculable[]; documentos: Vinculable[] }> {
	const [estado, docs] = await Promise.all([
		llamarEstudio<{ units: { id: string; title: string; status: string }[] }>("estado"),
		llamarEstudio<DocumentoEstudio[]>("documentos"),
	]);
	const documentos = docs.filter(d => d.status === "listo").map(d => ({ id: d.id, titulo: d.title }));
	const fuera = [...new Set(cuadernos.map(c => c.documentId).filter((id): id is string => !!id && !documentos.some(d => d.id === id)))];
	const ajenos = await Promise.all(fuera.map(id => llamarEstudio<DetalleDocumento>("documento", { id }).then(d => ({ id, titulo: d.document.title }), () => null)));
	return {
		unidades: estado.units.filter(u => u.status === "activa").map(u => ({ id: u.id, titulo: u.title })),
		documentos: [...documentos, ...ajenos.filter((d): d is Vinculable => d !== null)],
	};
}

/** Lo que el servidor guarda de la página: todo menos los comentarios y la revisión. */
const huellaDePagina = (c: Cuaderno) => JSON.stringify([c.title, c.unitId, c.documentId, c.blocks]);

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** La lista conectada: los cuadernos del espacio activo; se refresca con los avisos del plugin. */
export function Cuadernos() {
	const router = useRouter();
	const [cuadernos, setCuadernos] = useState<Cuaderno[] | null>(null);
	const [vinculables, setVinculables] = useState<{ unidades: Vinculable[]; documentos: Vinculable[] }>({ unidades: [], documentos: [] });
	const [ocupado, setOcupado] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const ultima = useRef(0);
	const leer = useCallback(async () => {
		const esta = ++ultima.current;
		try {
			const lista = await llamarEstudio<Cuaderno[]>("cuadernos");
			const v = await leerVinculables(lista);
			if (esta !== ultima.current) return;
			setCuadernos(lista);
			setVinculables(v);
		} catch (e) {
			if (esta === ultima.current) setError(mensaje(e));
		}
	}, []);
	useEffect(() => { void leer(); }, [leer]);
	useServerEvent("plugin-message", (m) => { if (m.pluginId === "estudio") void leer(); });
	useServerResync(() => void leer());

	const operar = async (accion: () => Promise<void>) => {
		setOcupado(true);
		setError(null);
		try { await accion(); } catch (e) { setError(mensaje(e)); }
		setOcupado(false);
	};

	return (
		<div className="relative h-dvh overflow-y-auto font-prose">
			<div className="lh-drag absolute inset-x-0 top-0 h-13" aria-hidden="true" />
			<ListaCuadernosEstudio
				cuadernos={cuadernos}
				unidades={vinculables.unidades}
				documentos={vinculables.documentos}
				ocupado={ocupado}
				error={error}
				acciones={{
					nuevo: () => void operar(async () => { const c = await crearCuaderno(); router.push(rutaCuaderno(c.id, { nuevo: true })); }),
					abrir: (id) => router.push(rutaCuaderno(id)),
					exportarAnki: () => void operar(async () => {
						const out = await llamarEstudio<{ filename: string; text: string; count: number }>("exportar-anki", {});
						if (out.count) descargar(out.filename, out.text); else setError("No hay preguntas completas que exportar.");
					}),
				}}
			/>
		</div>
	);
}

const RETARDO_GUARDADO = 700;

/** El editor conectado: guarda poco después de cada cambio, en orden, con la revisión que devolvió el último guardado. */
export function EditorCuaderno({ id, nuevo = false }: { id: string; nuevo?: boolean }) {
	const router = useRouter();
	const [cuaderno, setCuaderno] = useState<Cuaderno | null>(null);
	/** Escuchar al tutor (ticket 12j): cada comentario o respuesta nueva se lee si David lo encendió; escribir y Escape la cortan. */
	const voz = useEscuchar(cuaderno);
	const [vinculables, setVinculables] = useState<{ unidades: Vinculable[]; documentos: Vinculable[] }>({ unidades: [], documentos: [] });
	const [guardado, setGuardado] = useState<EstadoGuardado>({ tipo: "guardado" });
	const [ocupado, setOcupado] = useState(false);
	const [falta, setFalta] = useState<string | null>(null);
	/** Lo que se ha pedido al tutor y aún no es un comentario guardado. */
	const [peticiones, setPeticiones] = useState<PeticionMargen[]>([]);
	/** Los hilos del margen: cuál está abierto, lo escrito sin enviar y lo que se espera de cada uno. */
	const [hilos, setHilos] = useState<EstadoHilos>(SIN_HILOS);
	/** El modo proactivo (ticket 12e): el gasto de hoy, si el tutor está leyendo, si la última lectura falló y por qué no cambió el modo. */
	const [estadoProactivo, setEstadoProactivo] = useState<EstadoProactivo | null>(null);
	const [leyendo, setLeyendo] = useState(false);
	const [falloProactivo, setFalloProactivo] = useState(false);
	const [errorModo, setErrorModo] = useState<string | null>(null);
	/** Los personajes del tutor (ticket 12g); null hasta que llegan. */
	const [personajes, setPersonajes] = useState<ListaPersonajes | null>(null);
	/** Las propuestas del tutor que se están aceptando o fallaron, por id de propuesta (ticket 12d). */
	const [decisiones, setDecisiones] = useState<Record<string, EstadoDecision>>({});
	/** Sube al vencer la pausa, para volver a preguntar a la regla. */
	const [reloj, setReloj] = useState(0);

	/** Lo último escrito, la revisión guardada y si queda algo por guardar. */
	const actual = useRef<Cuaderno | null>(null);
	const revision = useRef(0);
	const pendiente = useRef(false);
	const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
	const cola = useRef<Promise<void>>(Promise.resolve());
	/** Lo que el servidor tiene de la página (sin los comentarios), para saber si un conflicto fue solo del margen. */
	const huella = useRef("");
	/** Lo que el tutor ya vio de cada párrafo, cuándo se tocó la página por última vez y cuándo acabó la última lectura. */
	const leidos = useRef<Record<string, string>>({});
	const ultimaEdicion = useRef<number | null>(null);
	const ultimaLectura = useRef<number | null>(null);
	/** Una sola lectura en vuelo, decidida en el mismo instante en que empieza y no cuando React repinta. */
	const leyendoRef = useRef(false);

	useEffect(() => {
		let vivo = true;
		llamarEstudio<Cuaderno[]>("cuadernos").then(async lista => {
			const c = lista.find(x => x.id === id);
			const v = await leerVinculables(c ? [c] : []);
			if (!vivo) return;
			setVinculables(v);
			if (!c) { setFalta("Este cuaderno no está en el espacio activo o se movió a la papelera."); return; }
			actual.current = c;
			revision.current = c.revision;
			huella.current = huellaDePagina(c);
			// Lo que ya estaba al abrir cuenta como visto: el tutor solo lee lo que David escriba o cambie desde ahora.
			leidos.current = estadoInicialLectura(parrafosParaLeer(c.blocks));
			setCuaderno(c);
		}, (e: unknown) => { if (vivo) setFalta(mensaje(e)); });
		return () => { vivo = false; };
	}, [id]);

	/** Los comentarios los escribe el servidor: lo que devuelve (al comentar, descartar o guardar) trae la revisión nueva y
	 * sus comentarios, y nunca toca lo que David tiene en la página. Una respuesta más vieja que la que ya se conoce se ignora. */
	const adoptar = useCallback((nuevo: Cuaderno) => {
		if (nuevo.revision < revision.current) return;
		revision.current = nuevo.revision;
		const servidor = { comments: nuevo.comments, modo: nuevo.modo, aviso: nuevo.aviso, proposito: nuevo.proposito, tinta: nuevo.tinta, persona: nuevo.persona };
		if (actual.current) actual.current = { ...actual.current, ...servidor };
		setCuaderno(c => (c ? { ...c, ...servidor } : c));
	}, []);

	/** Comentar desde otra operación sube la revisión mientras un guardado va en camino: si lo único que cambió en el
	 * servidor es el margen, se adopta su revisión y el guardado se repite. */
	const alinear = useCallback(async (): Promise<boolean> => {
		const lista = await llamarEstudio<Cuaderno[]>("cuadernos");
		const servidor = lista.find(x => x.id === id);
		if (!servidor || huellaDePagina(servidor) !== huella.current) return false;
		adoptar(servidor);
		return true;
	}, [id, adoptar]);

	const guardar = useCallback((): Promise<void> => {
		if (temporizador.current) { clearTimeout(temporizador.current); temporizador.current = null; }
		cola.current = cola.current.catch(() => {}).then(async () => {
			const c = actual.current;
			if (!c || !pendiente.current) return;
			pendiente.current = false;
			setGuardado({ tipo: "guardando" });
			try {
				const enviar = () => llamarEstudio<Cuaderno>("guardar-cuaderno", {
					id: c.id, expectedRevision: revision.current, title: c.title, kind: c.kind, unitId: c.unitId, documentId: c.documentId, blocks: bloquesParaGuardar(c.blocks),
				});
				// Un comentario que acaba justo antes sube la revisión: se adopta y se repite, y si llegan varios seguidos, otra vez.
				let out: Cuaderno | null = null;
				for (let intento = 0; !out; intento++) {
					try { out = await enviar(); } catch (e) {
						if (intento >= 3 || !/cambió mientras tanto/.test(mensaje(e)) || !(await alinear())) throw e;
					}
				}
				huella.current = huellaDePagina(out);
				adoptar(out);
				setGuardado(pendiente.current ? { tipo: "sin-guardar" } : { tipo: "guardado" });
			} catch (e) {
				pendiente.current = true;
				setGuardado({ tipo: "error", motivo: mensaje(e) });
				throw e;
			}
		});
		return cola.current;
	}, [alinear, adoptar]);

	// Salir del editor (la barra, ⌘K, un enlace) guarda lo pendiente.
	useEffect(() => () => { if (pendiente.current) void guardar().catch(() => {}); }, [guardar]);

	const cambiar = (c: Cuaderno) => {
		actual.current = c;
		pendiente.current = true;
		ultimaEdicion.current = Date.now();
		voz.parar();
		setFalloProactivo(false);
		setCuaderno(c);
		setGuardado({ tipo: "sin-guardar" });
		if (temporizador.current) clearTimeout(temporizador.current);
		temporizador.current = setTimeout(() => { void guardar().catch(() => {}); }, RETARDO_GUARDADO);
	};

	/** Guarda antes de actuar; si guardar falla, el indicador lo dice y no se actúa. */
	const trasGuardar = async (accion: () => Promise<void>) => {
		setOcupado(true);
		try {
			await guardar();
			await accion();
		} catch (e) {
			setGuardado({ tipo: "error", motivo: mensaje(e) });
		}
		setOcupado(false);
	};

	/** Pide al tutor un comentario: guarda la página, para que lo que lee sea lo que David ve, y espera su respuesta. */
	const comentar = (ancla: AnclaComentario, tipo: TipoComentario, persona?: string) => {
		// La tarjeta que espera ya lleva la firma y la tinta de a quien se preguntó.
		const quien = personajes && actual.current ? (persona ? todos(personajes).find(p => p.id === persona) : personajeDeCuaderno(actual.current, personajes)) : undefined;
		const peticion: PeticionMargen = {
			id: `peticion-${Date.now()}-${Math.random().toString(36).slice(2)}`, anchor: ancla, kind: tipo, estado: "pensando",
			...(quien ? { firma: quien.nombre, ...(quien.tinta !== "acento" ? { tinta: colorDeTinta(quien.tinta) } : {}) } : {}),
		};
		setPeticiones(p => [...p, peticion]);
		void (async () => {
			try {
				await guardar();
				const out = await llamarEstudio<Cuaderno>("comentar-cuaderno", { id, anchor: ancla, kind: tipo, ...(persona ? { persona } : {}) });
				adoptar(out);
				setPeticiones(p => p.filter(x => x.id !== peticion.id));
			} catch (e) {
				setPeticiones(p => p.map(x => (x.id === peticion.id ? { ...x, estado: "error" as const, error: mensaje(e) } : x)));
			}
		})();
	};

	/** Una escritura breve va en la misma cola que los guardados, para que no se crucen; devuelve su resultado. */
	const enCola = <T,>(trabajo: () => Promise<T>): Promise<T> => {
		const hecho = cola.current.catch(() => {}).then(trabajo);
		cola.current = hecho.then(() => {}, () => {});
		return hecho;
	};

	const descartar = (comentarioId: string) => {
		void enCola(async () => adoptar(await llamarEstudio<Cuaderno>("descartar-comentario", { id, commentId: comentarioId })))
			.catch((e: unknown) => setGuardado({ tipo: "error", motivo: mensaje(e) }));
		setHilos(h => {
			const { [comentarioId]: _espera, ...espera } = h.espera;
			const { [comentarioId]: _borrador, ...borradores } = h.borradores;
			return { abierto: h.abierto === comentarioId ? null : h.abierto, borradores, espera };
		});
	};

	/* Propuestas del tutor (ticket 12d). Aceptar una pregunta es lo único que escribe en la página de David, y solo porque él pulsó:
	 * se guarda antes lo suyo, el servidor inserta el bloque tras su párrafo y aquí se mete el mismo bloque en la página que David
	 * tiene delante, sin tocar lo que haya escrito entre medias (que se guarda después, ya con el bloque). */
	const decidiendo = useRef(new Set<string>());
	const marcarDecision = (propuestaId: string, estado: EstadoDecision | null) =>
		setDecisiones(d => { const { [propuestaId]: _antes, ...resto } = d; return estado ? { ...resto, [propuestaId]: estado } : resto; });
	const metiendoBloque = (out: Cuaderno, bloqueId: string) => {
		const i = out.blocks.findIndex(b => b.id === bloqueId);
		const nuevo = out.blocks[i];
		if (!nuevo || i === 0 || out.revision < revision.current) { adoptar(out); return; }
		const detras = out.blocks[i - 1]!.id;
		const insertar = (bloques: BloqueCuaderno[]) => {
			if (bloques.some(b => b.id === bloqueId)) return bloques;
			const j = bloques.findIndex(b => b.id === detras);
			return j === -1 ? [...bloques, nuevo] : [...bloques.slice(0, j + 1), nuevo, ...bloques.slice(j + 1)];
		};
		if (actual.current) actual.current = { ...actual.current, blocks: insertar(actual.current.blocks) };
		setCuaderno(c => (c ? { ...c, blocks: insertar(c.blocks) } : c));
		huella.current = huellaDePagina(out);
		adoptar(out);
	};
	const decidirPropuesta = (propuestaId: string, trabajo: () => Promise<void>) => {
		if (decidiendo.current.has(propuestaId)) return;
		decidiendo.current.add(propuestaId);
		marcarDecision(propuestaId, { enviando: true });
		void (async () => {
			try { await trabajo(); marcarDecision(propuestaId, null); }
			catch (e) { marcarDecision(propuestaId, { error: mensaje(e) }); }
			finally { decidiendo.current.delete(propuestaId); }
		})();
	};
	const aceptarPropuesta = (comentarioId: string, propuestaId: string) => decidirPropuesta(propuestaId, async () => {
		await guardar();
		const out = await enCola(() => llamarEstudio<Cuaderno>("aceptar-propuesta", { id, commentId: comentarioId, propuestaId }));
		const p = out.comments?.find(c => c.id === comentarioId)?.propuestas?.find(x => x.id === propuestaId);
		if (p?.tipo === "recuperacion" && p.bloqueId) metiendoBloque(out, p.bloqueId); else adoptar(out);
	});
	const descartarPropuesta = (comentarioId: string, propuestaId: string) => decidirPropuesta(propuestaId, async () => {
		adoptar(await enCola(() => llamarEstudio<Cuaderno>("descartar-propuesta", { id, commentId: comentarioId, propuestaId })));
	});

	/** Quitar un dibujo: el comentario, su hilo y la página no se tocan. */
	const quitarDibujo = (comentarioId: string, dibujoId: string) => {
		void enCola(async () => adoptar(await llamarEstudio<Cuaderno>("quitar-dibujo", { id, commentId: comentarioId, dibujoId })))
			.catch((e: unknown) => setGuardado({ tipo: "error", motivo: mensaje(e) }));
	};

	/* Hilos (ticket 12c). Escribir y contestar son dos llamadas: lo de David queda guardado aunque el tutor falle, y
	 * «Reintentar» solo repite la respuesta. La respuesta llega al cuaderno tal y como esté entonces: editar la página
	 * mientras el tutor piensa no la pierde. */
	const esperar = (comentarioId: string, espera: EstadoHilos["espera"][string] | null) =>
		setHilos(h => {
			const { [comentarioId]: _quitada, ...resto } = h.espera;
			return { ...h, espera: espera ? { ...resto, [comentarioId]: espera } : resto };
		});

	/** Hilos con una llamada en curso: un doble clic en «Reintentar» no manda dos veces lo mismo. */
	const enVuelo = useRef(new Set<string>());
	/** Un comentario que ya no está (descartado) no deja error en su hilo. */
	const sigueVivo = (comentarioId: string) => actual.current?.comments?.some(x => x.id === comentarioId && x.state !== "descartado") ?? false;

	const contestar = async (comentarioId: string) => {
		esperar(comentarioId, { estado: "pensando" });
		try {
			await guardar();
			adoptar(await llamarEstudio<Cuaderno>("contestar-comentario", { id, commentId: comentarioId }));
			// Si David ya volvió a la nota, la respuesta llegó dentro de una marca cerrada: se avisa con un punto hasta que la abra.
			setHilos(h => conRespuestaNueva(h, comentarioId));
			esperar(comentarioId, null);
		} catch (e) {
			esperar(comentarioId, sigueVivo(comentarioId) ? { estado: "error", error: mensaje(e) } : null);
		}
	};

	const responder = async (comentarioId: string, texto: string) => {
		if (enVuelo.current.has(comentarioId)) return;
		enVuelo.current.add(comentarioId);
		try { await responderYContestar(comentarioId, texto); } finally { enVuelo.current.delete(comentarioId); }
	};

	const responderYContestar = async (comentarioId: string, texto: string) => {
		setHilos(h => ({ ...h, borradores: { ...h.borradores, [comentarioId]: "" } }));
		esperar(comentarioId, { estado: "pensando", pendiente: texto });
		try {
			adoptar(await enCola(() => llamarEstudio<Cuaderno>("responder-comentario", { id, commentId: comentarioId, text: texto })));
		} catch (e) {
			esperar(comentarioId, { estado: "error", error: mensaje(e), pendiente: texto });
			return;
		}
		await contestar(comentarioId);
	};

	const atender = (comentarioId: string): Promise<boolean> =>
		enCola(async () => { adoptar(await llamarEstudio<Cuaderno>("atender-comentario", { id, commentId: comentarioId })); return true; })
			.catch((e: unknown) => { setGuardado({ tipo: "error", motivo: mensaje(e) }); return false; });

	/* El modo proactivo (ticket 12e). La regla (`decidirLectura`) dice cuándo; el plugin impone los límites que protegen el
	 * gasto. Una lectura nunca mueve el foco ni abre un hilo: el comentario llega cerrado al margen. */
	useEffect(() => {
		let vivo = true;
		llamarEstudio<EstadoProactivo>("estado-proactivo").then(e => { if (vivo) setEstadoProactivo(e); }, () => { if (vivo) setErrorModo("No se pudo leer el estado del tutor: no comentará solo hasta que se recargue el cuaderno."); });
		return () => { vivo = false; };
	}, [id]);

	const leerParrafo = async (blockId: string) => {
		const c = actual.current;
		if (!c || leyendoRef.current) return;
		if (parrafosParaLeer(c.blocks).every(p => p.id !== blockId)) return;
		leyendoRef.current = true;
		setLeyendo(true);
		try {
			// El plugin lee el cuaderno guardado: lo que el tutor lee es lo que David ve.
			await guardar();
			// Si David volvió a escribir mientras se guardaba, no es momento: la regla esperará a la siguiente pausa.
			if (Date.now() - (ultimaEdicion.current ?? 0) < CONFIG_PROACTIVA.pausaMs) return;
			const enviado = parrafosParaLeer(actual.current?.blocks ?? []).find(p => p.id === blockId)?.texto;
			if (enviado === undefined) return;
			const out = await llamarEstudio<LecturaProactiva>("lectura-proactiva", { id, blockId });
			adoptar(out.cuaderno);
			setEstadoProactivo(out.estado);
			// Sin comentario u omitida cuenta como leída: no se vuelve a pedir lo mismo. Solo un fallo espera a la siguiente pausa.
			if (out.resultado === "fallo") setFalloProactivo(true);
			else if (out.motivo !== "en-vuelo") leidos.current = { ...leidos.current, [blockId]: enviado };
		} catch {
			setFalloProactivo(true);
		} finally {
			ultimaLectura.current = Date.now();
			leyendoRef.current = false;
			setLeyendo(false);
		}
	};

	useEffect(() => {
		if (!cuaderno || !estadoProactivo) return;
		const decision = decidirLectura({
			ahora: Date.now(), ultimaEdicion: ultimaEdicion.current, ultimaLlamadaFin: ultimaLectura.current,
			parrafos: parrafosParaLeer(cuaderno.blocks), leidos: leidos.current, comentados: comentadosPorElTutor(cuaderno.comments),
			abiertos: abiertosSinAtender(cuaderno.comments), enVuelo: leyendo, fallo: falloProactivo,
			// El tope no entra aquí: lo comprueba el plugin, que además pasa el cuaderno a «Cuando se lo pido» con su aviso. Si lo bajara
			// el cliente solo, el cuaderno seguiría en «Lee y comenta solo» sin comentar y sin decir por qué.
			activo: (cuaderno.modo ?? "proactivo") === "proactivo" && estadoProactivo.modeloEconomico,
		});
		if (decision.accion === "leer") { void leerParrafo(decision.blockId); return; }
		if (decision.accion === "esperar") {
			const t = setTimeout(() => setReloj(n => n + 1), decision.enMs + 20);
			return () => clearTimeout(t);
		}
	}, [cuaderno, estadoProactivo, leyendo, falloProactivo, reloj]);

	const refrescarEstado = () => llamarEstudio<EstadoProactivo>("estado-proactivo").then(setEstadoProactivo, () => {});

	const cambiarModo = (modo: ModoCuaderno) => {
		setErrorModo(null);
		void enCola(async () => adoptar(await llamarEstudio<Cuaderno>("modo-cuaderno", { id, modo })))
			.then(() => {
				// Al volver a activarlo, lo escrito mientras estaba apagado no se lee de golpe: cuenta como visto.
				if (modo === "proactivo" && actual.current) leidos.current = estadoInicialLectura(parrafosParaLeer(actual.current.blocks));
				setFalloProactivo(false);
			})
			.catch((e: unknown) => setErrorModo(mensaje(e)))
			.finally(() => void refrescarEstado());
	};

	/** El propósito y la tinta. «Solo escucha» y salir de él cambian también el modo: lo que dice el servidor manda. */
	const fijarProposito = (cambio: CambioProposito) => {
		setErrorModo(null);
		voz.parar();
		const modoAntes = actual.current?.modo ?? "proactivo";
		void enCola(async () => adoptar(await llamarEstudio<Cuaderno>("proposito-cuaderno", { id, ...cambio })))
			.then(() => {
				// Si el tutor vuelve a leer, lo escrito mientras estaba apagado no se lee de golpe: cuenta como visto.
				if (modoAntes === "a-peticion" && (actual.current?.modo ?? "proactivo") === "proactivo" && actual.current) leidos.current = estadoInicialLectura(parrafosParaLeer(actual.current.blocks));
				setFalloProactivo(false);
			})
			.catch((e: unknown) => setErrorModo(mensaje(e)))
			.finally(() => void refrescarEstado());
	};

	/** Los personajes: se leen al abrir y tras cada cambio. Elegir el del cuaderno va por la cola, como el propósito. */
	const cargarPersonajes = useCallback(() => llamarEstudio<ListaPersonajes>("personajes").then(setPersonajes, () => {}), []);
	useEffect(() => { void cargarPersonajes(); }, [cargarPersonajes]);
	const elegirPersona = (personaId: string) => {
		void enCola(async () => adoptar(await llamarEstudio<Cuaderno>("persona-cuaderno", { id, persona: personaId })))
			.catch((e: unknown) => setErrorModo(mensaje(e)));
	};
	const guardarPersonaje = async (cambio: CambioPersonaje) => { await llamarEstudio("guardar-personaje", cambio); await cargarPersonajes(); };
	const borrarPersonaje = async (personaId: string) => { await llamarEstudio("borrar-personaje", { id: personaId }); await cargarPersonajes(); };

	const fijarTope = (tope: number) => {
		setErrorModo(null);
		llamarEstudio<EstadoProactivo>("tope-proactivo", { tope }).then(setEstadoProactivo, (e: unknown) => setErrorModo(mensaje(e)));
	};

	if (!cuaderno) {
		return (
			<div className="relative h-dvh overflow-y-auto font-prose">
				<div className="lh-drag absolute inset-x-0 top-0 h-13" aria-hidden="true" />
				<div className="mx-auto w-full max-w-2xl px-6 pt-14">
					<p className={cn("text-sm", falta ? "text-destructive" : "text-muted-foreground")} role={falta ? "alert" : undefined}>{falta ?? "Cargando…"}</p>
					{falta && <Button className="mt-4" size="sm" variant="outline" onClick={() => router.push(RUTA_CUADERNOS)}>Ir a Cuadernos</Button>}
				</div>
			</div>
		);
	}
	return (
		<div className="relative h-dvh overflow-y-auto font-prose">
			<div className="lh-drag absolute inset-x-0 top-0 h-13" aria-hidden="true" />
			<EditorCuadernoEstudio
				cuaderno={cuaderno}
				unidades={vinculables.unidades}
				documentos={vinculables.documentos}
				guardado={guardado}
				ocupado={ocupado}
				enfocarTitulo={nuevo}
				peticiones={peticiones}
				hilos={hilos}
				decisiones={decisiones}
				proactivo={{ estado: estadoProactivo, leyendo, error: errorModo }}
				personajes={personajes}
				voz={voz}
				acciones={{
					cambiar, comentar, descartar, atender, aceptarPropuesta, descartarPropuesta, quitarDibujo, cambiarModo, fijarTope, fijarProposito, elegirPersona, guardarPersonaje, borrarPersonaje,
						abrirHilo: (comentarioId) => setHilos(h => ({ ...sinRespuestaNueva(h, comentarioId), abierto: comentarioId })),
						cerrarHilo: (comentarioId) => setHilos(h => (h.abierto === comentarioId ? { ...h, abierto: null } : h)),
						borradorHilo: (comentarioId, texto) => { voz.parar(); setHilos(h => ({ ...h, borradores: { ...h.borradores, [comentarioId]: texto } })); },
						responder: (comentarioId, texto) => void responder(comentarioId, texto),
						reintentarHilo: (comentarioId) => {
							const pendiente = hilos.espera[comentarioId]?.pendiente;
							if (pendiente) void responder(comentarioId, pendiente);
							else if (!enVuelo.current.has(comentarioId)) {
								enVuelo.current.add(comentarioId);
								void contestar(comentarioId).finally(() => enVuelo.current.delete(comentarioId));
							}
						},
					cerrarPeticion: (peticionId) => setPeticiones(p => p.filter(x => x.id !== peticionId)),
					navegar: (ruta) => router.push(ruta),
					exportarMarkdown: () => void trasGuardar(async () => {
						const out = await llamarEstudio<{ filename: string; text: string }>("exportar-markdown", { id });
						descargar(out.filename, out.text, "text/markdown");
					}),
					exportarAnki: () => void trasGuardar(async () => {
						const out = await llamarEstudio<{ filename: string; text: string; count: number }>("exportar-anki", { id });
						if (out.count) descargar(out.filename, out.text); else setGuardado({ tipo: "aviso", texto: "No hay preguntas completas que exportar." });
					}),
					borrar: () => {
						if (!window.confirm(`¿Mover «${cuaderno.title}» a la papelera? Sale de Cuadernos y de su unidad; el archivo queda en la papelera de los datos de Estudio.`)) return;
						void trasGuardar(async () => {
							await llamarEstudio("borrar-cuaderno", { id, expectedRevision: revision.current });
							router.push(RUTA_CUADERNOS);
						});
					},
					practicar: (bloqueId) => {
						const unitId = actual.current?.unitId;
						if (!unitId) return;
						void trasGuardar(async () => {
							router.push(rutaPracticar(unitId, { pregunta: { cuaderno: id, bloque: bloqueId }, volver: rutaCuaderno(id) }));
						});
					},
				}}
			/>
		</div>
	);
}
