"use client";

/**
 * El margen del cuaderno (ticket 12b): lo que el tutor escribe junto a una frase de David, a petición. Tres piezas:
 * la barra que aparece con un texto seleccionado («Pregúntame», «Explícamelo»), la tarjeta de un comentario y la
 * columna que las coloca a la altura de su frase. Los comentarios nunca entran en la página: viven aparte, en tinta.
 *
 * Con sitio de sobra (un contenedor de 53rem o más) el margen queda a la derecha de la página y cada
 * tarjeta a la altura de su frase, sin pisar a la anterior; con poco, debajo de la página, en orden. El sitio del margen
 * se reserva siempre (la rejilla existe con o sin comentarios) para que el primer comentario no mueva el texto. Sin
 * comentarios no se pinta nada dentro y la página es la limpia del 12a.
 */
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { LightbulbIcon, MessageCircleQuestionIcon, MessageSquareIcon, PenLineIcon, UsersIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnclaComentario, Comentario, TipoComentario } from "./cuadernos";
import { PETICIONES, apilar, type EstadoHilos, type Puesto } from "./margen";
import { colorDePersonaje, firmaDe, type Personaje } from "./personajes";
import { EstadoEspera, HiloMargen } from "./hilo-margen";
import { PropuestasMargen, type AccionesPropuestas } from "./propuestas-margen";
import { DibujoMermaid } from "./dibujo-mermaid";
import { BotonEscuchar, type AccionesVoz } from "./escuchar-cuaderno";
import { colorDeTinta } from "./tintas";

/** La tinta de los comentarios: la variable que pone la página del cuaderno según su tinta (ticket 12f). Fuera de una página, la del acento. */
export const TINTA_MARGEN = `var(--tinta-margen, ${colorDeTinta(undefined)})`;

/** Una petición hecha al tutor que aún no es un comentario guardado: pensando, o fallida (el mensaje dice por qué). */
export interface PeticionMargen {
	id: string;
	anchor: AnclaComentario;
	kind: TipoComentario;
	/** A quién se preguntó: su firma y su tinta, para que la tarjeta que espera ya sea suya. */
	firma?: string;
	tinta?: string;
	estado: "pensando" | "error";
	error?: string;
}

/** Lo que se pinta en el margen: un comentario guardado o una petición en curso. */
export interface ItemMargen {
	id: string;
	anchor: AnclaComentario;
	comentario?: Comentario;
	peticion?: PeticionMargen;
	/** La tinta del personaje que escribió el comentario (un color CSS); sin ella, la del cuaderno (ticket 12g). */
	tinta?: string;
	/** El nombre vigente de quien lo escribió (un personaje renombrado firma con el nuevo); sin él, la firma guardada. */
	firma?: string;
}

/** Desde 53rem de ancho de contenedor el margen va a la derecha de la página; por debajo, debajo. Las clases van
 * enteras en el texto: Tailwind no las encuentra si se construyen por partes. */
export const COLUMNAS_PAGINA = "@min-[53rem]/pagina:grid @min-[53rem]/pagina:grid-cols-[minmax(0,36rem)_19rem] @min-[53rem]/pagina:justify-center @min-[53rem]/pagina:gap-x-8";

/** La columna del texto: la de siempre (36rem, centrada) cuando el margen va debajo; en la rejilla, la primera columna. */
export const COLUMNA_TEXTO = "mx-auto w-full min-w-0 max-w-[36rem] @min-[53rem]/pagina:mx-0 @min-[53rem]/pagina:max-w-none";

/** Marca de lo comentado en la copia pintada del párrafo: un subrayado en tinta, más fuerte si se señala su tarjeta. */
export function claseMarca(resaltado: boolean): string {
	return cn(
		"rounded-[2px] shadow-[0_2px_0_0_var(--tinta-margen)]",
		resaltado ? "bg-[color-mix(in_oklab,var(--tinta-margen)_30%,transparent)]" : "bg-[color-mix(in_oklab,var(--tinta-margen)_14%,transparent)]",
	);
}

/** La barra de un texto seleccionado. No quita el foco al campo (`mousedown` no hace nada), para no perder la selección. */
export function BarraSeleccion({ top, left, pedir, personajes, alSalir }: {
	top?: number; left?: number;
	/** Sin `persona`, comenta el del cuaderno. */
	pedir(kind: TipoComentario, persona?: string): void;
	/** Los personajes a quien preguntar (ticket 12g); sin ellos no hay «Preguntar a…». */
	personajes?: readonly Personaje[];
	/** `volver`: Escape, y el foco regresa al párrafo. */ alSalir?(volver?: boolean): void;
}) {
	const [eligiendo, setEligiendo] = useState(false);
	const boton = "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-foreground hover:bg-accent focus-visible:bg-accent focus-visible:outline-none";
	return (
		<div
			role="toolbar" aria-label="Pedir al tutor" data-barra-seleccion
			// Con el teclado se llega a los botones con Tab desde el párrafo: la barra se queda mientras el foco esté en ella.
			onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) alSalir?.(); }}
			onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); alSalir?.(true); } }}
			style={{ top, left }}
			className="absolute z-20 flex flex-col rounded-lg border border-border bg-popover p-0.5 font-sans text-popover-foreground shadow-md"
		>
			<div className="flex gap-0.5">
				{(["pregunta", "explicacion", "dibujo"] as const).map(kind => (
				<button
					key={kind} type="button" data-pedir={kind} data-recorrido
					onMouseDown={(e) => { e.preventDefault(); pedir(kind); }}
					// Intro y espacio no pasan por `mousedown`: su clic llega con `detail` 0.
					onClick={(e) => { if (e.detail === 0) pedir(kind); }}
					className={boton}
				>
					{kind === "pregunta" ? <MessageCircleQuestionIcon className="size-3.5" /> : kind === "explicacion" ? <LightbulbIcon className="size-3.5" /> : <PenLineIcon className="size-3.5" />}
					{PETICIONES[kind].boton}
				</button>
			))}
			{personajes && personajes.length > 0 && (
				<button
					type="button" data-preguntar-a data-recorrido aria-expanded={eligiendo}
					onMouseDown={(e) => { e.preventDefault(); setEligiendo(v => !v); }}
					onClick={(e) => { if (e.detail === 0) setEligiendo(v => !v); }}
					className={cn(boton, "text-muted-foreground")}
				>
					<UsersIcon className="size-3.5" />Preguntar a…
				</button>
			)}
			</div>
			{eligiendo && personajes && (
				<div role="group" aria-label="Preguntar a" data-personajes-barra className="mt-0.5 flex flex-col border-t border-border pt-0.5">
					{personajes.map(p => (
						<div key={p.id} className="flex items-center">
							<button
								type="button" data-pedir-a={p.id} data-recorrido title={`Pregúntale: ${p.descripcion}`}
								onMouseDown={(e) => { e.preventDefault(); pedir("pregunta", p.id); }}
								onClick={(e) => { if (e.detail === 0) pedir("pregunta", p.id); }}
								className={cn(boton, "flex-1 justify-start font-normal")}
							>
								<span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: colorDePersonaje(p) }} />
								{p.nombre}
							</button>
							<button
								type="button" data-explicar-a={p.id} data-recorrido aria-label={`Explica, ${p.nombre}`} title="Pídele que te lo explique"
								onMouseDown={(e) => { e.preventDefault(); pedir("explicacion", p.id); }}
								onClick={(e) => { if (e.detail === 0) pedir("explicacion", p.id); }}
								className={cn(boton, "px-1.5 font-normal text-muted-foreground")}
							>
								<LightbulbIcon className="size-3.5" aria-hidden="true" />
							</button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

/** Lo que se puede hacer con los dibujos del tutor (ticket 12h): quitar uno, y la clave que cambia con la tinta del cuaderno. */
export interface AccionesDibujos { quitar?(comentarioId: string, dibujoId: string): void; clave: string }

/** Lo que se puede hacer con el hilo de un comentario; el editor conectado lo guarda y llama al tutor. */
export interface AccionesHilo {
	abrir(comentarioId: string): void;
	/** Escape: cierra el hilo sin darlo por atendido. */
	cerrar(comentarioId: string): void;
	borrador(comentarioId: string, texto: string): void;
	enviar(comentarioId: string, texto: string): void;
	reintentar(comentarioId: string): void;
	/** «Volver a la nota»: lo da por atendido y deja el cursor al final de su párrafo. */
	volver(comentarioId: string): void;
}

const recorte = (s: string, max: number) => (s.length > max ? `${s.slice(0, max).trimEnd()}…` : s);

/**
 * Una tarjeta del margen: quién, qué pidió David, lo que escribió el tutor y cómo quitarla. Con hilos, también cómo
 * abrirlo: la tarjeta cerrada muestra el primer mensaje y «Responder»; abierta, la conversación entera y el campo para
 * escribir. Un comentario atendido es solo una marca pequeña que reabre el hilo con su historia.
 */
export function TarjetaMargen({ item, sitio, top, resaltar, quitar, hilos, acciones, propuestas, dibujos, voz }: {
	item: ItemMargen;
	/** null: la frase ya no está en la página. */
	sitio: Puesto<ItemMargen>["sitio"];
	top?: number;
	resaltar(dentro: boolean): void;
	quitar(): void;
	hilos?: EstadoHilos;
	acciones?: AccionesHilo;
	/** Lo que se puede hacer con lo que el tutor propone (ticket 12d); sin ello, las propuestas no se muestran. */
	propuestas?: AccionesPropuestas;
	/** Los dibujos del tutor (ticket 12h): en el hilo, y en la tarjeta de un comentario sin su frase, que no tiene párrafo del que colgar. */
	dibujos?: AccionesDibujos;
	/** Escuchar el comentario (ticket 12j): su botón lee el primer mensaje del tutor y, en el hilo, cada mensaje suyo tiene el suyo. */
	voz?: AccionesVoz;
}) {
	const { comentario: c, peticion: p } = item;
	const tutor = c?.thread.find(m => m.role === "tutor");
	const kind = c?.kind ?? p!.kind;
	const error = p?.estado === "error";
	const abierto = !!c && hilos?.abierto === c.id;
	const espera = c ? hilos?.espera[c.id] : undefined;
	const nueva = !!c && !abierto && !!hilos?.sinLeer?.[c.id];
	const puesto = cn(
		"@min-[53rem]/pagina:absolute @min-[53rem]/pagina:inset-x-0 @min-[53rem]/pagina:top-[var(--top)]",
	);
	const tinta = c ? item.tinta : p?.tinta;
	const estilo = { "--top": top === undefined ? undefined : `${top}px`, ...(tinta ? { "--tinta-margen": tinta } : {}) } as React.CSSProperties;

	if (c?.state === "atendido" && !abierto && acciones) {
		const mensajes = c.thread.length;
		return (
			<article data-margen-id={item.id} data-bloque={sitio?.blockId} data-estado="atendido" data-sin-frase={sitio ? undefined : ""} style={estilo} className={cn("font-prose", puesto)}>
				<button
					type="button" data-recorrido data-abrir-hilo onClick={() => acciones.abrir(c.id)}
					aria-label={`Reabrir el hilo atendido: «${recorte(c.anchor.text, 50)}»${nueva ? ", con una respuesta nueva" : ""}`} title="Hilo atendido: pulsa para reabrirlo"
					className="inline-flex h-6 items-center gap-1 rounded-full border border-border px-2 font-sans text-[11px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
					style={{ borderColor: `color-mix(in oklab, ${TINTA_MARGEN} 45%, transparent)` }}
				>
					<MessageSquareIcon className="size-3" style={{ color: TINTA_MARGEN }} />
					<span aria-hidden="true">{mensajes}</span>
					{nueva && <span aria-hidden="true" data-sin-leer className="size-1.5 rounded-full" style={{ backgroundColor: TINTA_MARGEN }} />}
				</button>
				{/* Lo que el tutor ofreció y David aún no decidió no se esconde con el hilo. */}
				{propuestas && c.propuestas?.some(x => x.estado === "pendiente") && <PropuestasMargen comentario={c} acciones={propuestas} soloPendientes />}
			</article>
		);
	}

	return (
		<article
			data-margen-id={item.id} data-bloque={sitio?.blockId} data-estado={c ? c.state : p!.estado} data-sin-frase={sitio ? undefined : ""} data-hilo-abierto={abierto ? "" : undefined}
			onMouseEnter={() => resaltar(true)} onMouseLeave={() => resaltar(false)} onFocus={() => resaltar(true)} onBlur={() => resaltar(false)}
			style={{ ...estilo, backgroundColor: `color-mix(in oklab, ${TINTA_MARGEN} 10%, var(--card))`, ...(error ? { outline: "1px solid var(--lh-error)" } : {}) }}
			className={cn("group/margen rounded-md px-3 py-1 font-prose text-[0.8125rem] leading-[1.35rem] text-foreground/90", puesto)}
		>
			<header className="flex items-center gap-1.5 font-sans text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
				<span data-firma>{c ? item.firma ?? firmaDe(c) : p?.firma ?? "Tutor"}</span>
				<span aria-hidden="true">·</span>
				<span>{PETICIONES[kind].etiqueta}</span>
				{abierto && c.state === "atendido" && <span className="normal-case tracking-normal">· atendido</span>}
				<button
					type="button" onClick={quitar}
					aria-label={p ? "Cerrar" : "Descartar comentario"} title={p ? "Cerrar" : "Descartar"}
					className="ml-auto inline-flex size-5 items-center justify-center rounded-md opacity-60 outline-none hover:bg-accent hover:opacity-100 focus-visible:opacity-100 group-hover/margen:opacity-100"
				><XIcon className="size-3.5" /></button>
			</header>
			{!sitio && (
				<p className="mt-1 text-xs italic text-muted-foreground">
					<span className="not-italic font-sans font-medium uppercase tracking-[0.08em] text-[10px]">Sin su frase</span> · «{recorte(item.anchor.text, 70)}»
				</p>
			)}
			{p?.estado === "pensando" && <p className="mt-1 text-muted-foreground motion-safe:animate-pulse" role="status">{p.kind === "dibujo" ? "Dibujando…" : "Pensando…"}</p>}
			{error && <p role="alert" className="mt-1 text-destructive">No se pudo comentar: {p!.error}</p>}
			{c && abierto && hilos && acciones && (
				<HiloMargen
					comentario={c} firma={item.firma} espera={espera} borrador={hilos.borradores[c.id] ?? ""}
					cambiarBorrador={(texto) => acciones.borrador(c.id, texto)}
					enviar={(texto) => acciones.enviar(c.id, texto)} volver={() => acciones.volver(c.id)}
					cerrar={() => acciones.cerrar(c.id)} reintentar={() => acciones.reintentar(c.id)} voz={voz}
						dibujos={dibujos && c.dibujos ? { lista: c.dibujos, ...dibujos } : undefined}
				/>
			)}
			{c && abierto && propuestas && <PropuestasMargen comentario={c} acciones={propuestas} />}
			{c && !abierto && (
				<>
					<p className="mt-1 whitespace-pre-wrap">{tutor?.text ?? ""}</p>
					{!sitio && dibujos && c.dibujos?.map(d => (
						<DibujoMermaid key={d.id} id={d.id} codigo={d.mermaid} firma={item.firma ?? firmaDe(c)} clave={dibujos.clave} compacto quitar={dibujos.quitar && (() => dibujos.quitar!(c.id, d.id))} />
					))}
					{espera && <EstadoEspera espera={espera} />}
					{propuestas && <PropuestasMargen comentario={c} acciones={propuestas} />}
					{acciones && (
						<button
							type="button" data-recorrido data-abrir-hilo onClick={() => acciones.abrir(c.id)}
							className="mt-1.5 inline-flex h-6 items-center gap-1 rounded-md font-sans text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
						>
							<MessageSquareIcon className="size-3.5" />
							{nueva && <span data-sin-leer role="img" aria-label="Respuesta nueva" className="size-1.5 rounded-full" style={{ backgroundColor: TINTA_MARGEN }} />}
							{c.thread.length > 1 ? `Seguir el hilo · ${c.thread.length}` : "Responder"}
						</button>
					)}
					{voz && tutor && <BotonEscuchar mensajeId={tutor.id} texto={tutor.text} firma={item.firma ?? firmaDe(c)} voz={voz} className="ml-2 mt-1.5" />}
				</>
			)}
		</article>
	);
}

/**
 * La columna del margen: las tarjetas en el orden de la página y, al final, las que se quedaron sin su frase. Con
 * sitio, cada una se coloca a la altura de su frase midiendo la página, y se apilan sin pisarse.
 */
export function Margen({ puestos, lista, resaltado, resaltar, quitar, hilos, acciones, propuestas, dibujos, voz }: {
	puestos: Puesto<ItemMargen>[];
	/** La lista de párrafos de la página, de donde se mide dónde está cada frase. */
	lista: RefObject<HTMLElement | null>;
	resaltado: string | null;
	resaltar(id: string | null): void;
	quitar(item: ItemMargen): void;
	hilos?: EstadoHilos;
	acciones?: AccionesHilo;
	propuestas?: AccionesPropuestas;
	dibujos?: AccionesDibujos;
	voz?: AccionesVoz;
}) {
	const columna = useRef<HTMLElement>(null);
	const [tops, setTops] = useState<Record<string, number>>({});

	const huella = puestos.map(p => `${p.item.id}:${p.sitio ? `${p.sitio.blockId}.${p.sitio.start}` : "-"}:${p.item.comentario?.thread.length ?? 0}:${p.item.comentario?.state ?? "-"}:${hilos?.abierto === p.item.id ? "a" : "c"}:${hilos?.espera[p.item.id]?.estado ?? "-"}:${(p.item.comentario?.propuestas ?? []).map(x => `${x.id}${x.estado[0]}${propuestas?.estado[x.id]?.error ? "e" : ""}`).join(",")}:${p.item.comentario?.dibujos?.length ?? 0}`).join("|");
	useLayoutEffect(() => {
		const col = columna.current, pagina = lista.current;
		if (!col || !pagina) return;
		const medir = () => {
			const base = col.getBoundingClientRect().top;
			const tarjetas = [...col.querySelectorAll<HTMLElement>("[data-margen-id]")];
			const dondeEsta = (el: HTMLElement): number | null => {
				const id = el.dataset.margenId!;
				const marca = [...pagina.querySelectorAll<HTMLElement>("[data-comentario]")].find(m => m.dataset.comentario!.split(" ").includes(id));
				const parrafo = el.dataset.bloque ? [...pagina.querySelectorAll<HTMLElement>("[data-block-id]")].find(x => x.dataset.blockId === el.dataset.bloque) : null;
				const ref = marca ?? parrafo;
				return ref ? ref.getBoundingClientRect().top - base : null;
			};
			const posiciones = apilar(tarjetas.map(el => ({ deseo: dondeEsta(el), alto: el.offsetHeight })));
			const siguiente = Object.fromEntries(tarjetas.map((el, i) => [el.dataset.margenId!, Math.round(posiciones[i]!)]));
			setTops(antes => {
				const mismas = Object.keys(siguiente).length === Object.keys(antes).length && Object.entries(siguiente).every(([k, v]) => antes[k] === v);
				return mismas ? antes : siguiente;
			});
		};
		medir();
		const observador = new ResizeObserver(medir);
		observador.observe(pagina);
		observador.observe(col);
		for (const t of col.querySelectorAll("[data-margen-id]")) observador.observe(t);
		return () => observador.disconnect();
	}, [huella, lista]);

	return (
		<aside ref={columna} aria-label="Margen" data-margen className={cn("mx-auto mt-12 grid w-full max-w-[36rem] gap-5 border-t border-border pt-6 @min-[53rem]/pagina:max-w-none", "@min-[53rem]/pagina:relative @min-[53rem]/pagina:mt-0 @min-[53rem]/pagina:block @min-[53rem]/pagina:border-t-0 @min-[53rem]/pagina:pt-0")}>
			{puestos.map(({ item, sitio }) => (
				<TarjetaMargen
					key={item.id} item={item} sitio={sitio} top={tops[item.id]}
					resaltar={(dentro) => resaltar(dentro ? item.id : resaltado === item.id ? null : resaltado)}
					quitar={() => quitar(item)} hilos={hilos} acciones={acciones} propuestas={propuestas} dibujos={dibujos} voz={voz}
				/>
			))}
		</aside>
	);
}
