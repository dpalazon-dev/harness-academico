"use client";

/**
 * Las propuestas del tutor dentro de la tarjeta del margen (ticket 12d). Van bajo el comentario, en la misma tinta, sin
 * tocar la página limpia: cada una es una oferta con un botón claro para aceptar y otro para descartar, y no hace nada hasta
 * que David pulsa. Lo aceptado deja una línea corta que dice dónde quedó; lo descartado desaparece de la tarjeta.
 *
 *  - Pregunta de recuperación: la pregunta y la respuesta propuesta (un borrador que David edita), «Añadir a la página».
 *  - Hecho para la base: la afirmación y la cita de su fuente, «Guardar en Por decidir».
 *  - Conexión: un enlace a la unidad o al cuaderno; no se acepta, se abre, y se puede descartar.
 */
import { BookOpenIcon, CheckIcon, LinkIcon, NotebookPenIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { rutaCuaderno, type Comentario, type Propuesta } from "./cuadernos";

/** Lo que pasa con una propuesta fuera de lo guardado: se está aceptando, o falló y el mensaje dice por qué. */
export interface EstadoDecision { enviando?: boolean; error?: string }

/** Lo que David puede hacer con una propuesta; el editor conectado llama al plugin. */
export interface AccionesPropuestas {
	aceptar(comentarioId: string, propuestaId: string): void;
	descartar(comentarioId: string, propuestaId: string): void;
	abrir(ruta: string): void;
	/** Por id de propuesta. */
	estado: Readonly<Record<string, EstadoDecision>>;
}

export const rutaDestino = (d: Extract<Propuesta, { tipo: "conexion" }>["destino"]): string => (d.tipo === "unidad" ? `/unidad/${encodeURIComponent(d.id)}` : rutaCuaderno(d.id));

const ETIQUETA = "font-sans text-[10px] uppercase tracking-[0.08em] text-muted-foreground";
const BOTON = "inline-flex h-6 items-center gap-1 rounded-md px-2 font-sans text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

function Acciones({ etiquetaAceptar, aceptar, descartar, enviando }: { etiquetaAceptar?: string; aceptar?(): void; descartar(): void; enviando?: boolean }) {
	return (
		<div className="mt-1.5 flex items-center gap-1">
			{aceptar && (
				<button
					type="button" data-recorrido data-aceptar-propuesta disabled={enviando} onClick={aceptar}
					className={cn(BOTON, "text-foreground hover:bg-accent")}
					style={{ backgroundColor: "color-mix(in oklab, var(--tinta-margen) 14%, transparent)" }}
				>
					<CheckIcon className="size-3.5" aria-hidden="true" />{enviando ? "Guardando…" : etiquetaAceptar}
				</button>
			)}
			<button type="button" data-recorrido data-descartar-propuesta disabled={enviando} onClick={descartar} className={cn(BOTON, "text-muted-foreground hover:bg-accent hover:text-foreground")}>
				<XIcon className="size-3.5" aria-hidden="true" />Descartar
			</button>
		</div>
	);
}

function Una({ comentarioId, p, acciones }: { comentarioId: string; p: Propuesta; acciones: AccionesPropuestas }) {
	const estado = acciones.estado[p.id];
	const error = estado?.error && <p role="alert" className="mt-1 text-xs text-destructive">{estado.error}</p>;
	const aceptar = () => acciones.aceptar(comentarioId, p.id);
	const descartar = () => acciones.descartar(comentarioId, p.id);

	if (p.estado === "aceptada") {
		const texto = p.tipo === "recuperacion" ? "Pregunta añadida tras el párrafo" : p.tipo === "hecho" ? "Guardado como borrador: míralo en «Por decidir»" : "";
		return texto ? <p data-propuesta={p.tipo} data-estado="aceptada" className="mt-2 inline-flex items-center gap-1 font-sans text-xs text-muted-foreground"><CheckIcon className="size-3" aria-hidden="true" />{texto}</p> : null;
	}
	if (p.estado !== "pendiente") return null;

	if (p.tipo === "recuperacion") {
		return (
			<section data-propuesta="recuperacion" data-estado="pendiente" aria-label="Pregunta de recuperación propuesta" className="mt-2.5 border-t border-border/60 pt-2">
				<p className={ETIQUETA}><NotebookPenIcon className="mr-1 inline size-3 align-[-1px]" aria-hidden="true" />Propone una pregunta</p>
				<p data-campo-propuesta="pregunta" className="mt-1 font-medium">{p.pregunta}</p>
				<p className="mt-1 text-xs text-muted-foreground"><span className="font-sans">Respuesta propuesta, la editas tú:</span> <span data-campo-propuesta="respuesta" className="whitespace-pre-wrap">{p.respuesta}</span></p>
				<Acciones etiquetaAceptar="Añadir a la página" aceptar={aceptar} descartar={descartar} enviando={estado?.enviando} />
				{error}
			</section>
		);
	}
	if (p.tipo === "hecho") {
		return (
			<section data-propuesta="hecho" data-estado="pendiente" aria-label="Hecho para la base propuesto" className="mt-2.5 border-t border-border/60 pt-2">
				<p className={ETIQUETA}><BookOpenIcon className="mr-1 inline size-3 align-[-1px]" aria-hidden="true" />Propone un hecho para tu base</p>
				<p data-campo-propuesta="afirmacion" className="mt-1 font-medium">{p.afirmacion}</p>
				<p className="mt-1 text-xs italic text-muted-foreground" data-campo-propuesta="cita">«{p.cita.length > 160 ? `${p.cita.slice(0, 160).trimEnd()}…` : p.cita}» <span className="not-italic">(p. {p.pagina})</span></p>
				<p className="mt-1 text-xs text-muted-foreground">Quedará en «Por decidir»; no entra en la base hasta que lo confirmes.</p>
				<Acciones etiquetaAceptar="Guardar en Por decidir" aceptar={aceptar} descartar={descartar} enviando={estado?.enviando} />
				{error}
			</section>
		);
	}
	const ruta = rutaDestino(p.destino);
	return (
		<section data-propuesta="conexion" data-estado="pendiente" aria-label="Conexión propuesta" className="mt-2.5 border-t border-border/60 pt-2">
			<p className={ETIQUETA}><LinkIcon className="mr-1 inline size-3 align-[-1px]" aria-hidden="true" />Conecta con {p.destino.tipo === "unidad" ? "una unidad" : "un cuaderno"}</p>
			<a
				href={ruta} data-recorrido data-abrir-conexion onClick={(e) => { e.preventDefault(); acciones.abrir(ruta); }}
				className="mt-1 inline-block rounded-sm font-medium underline decoration-[color-mix(in_oklab,var(--tinta-margen)_60%,transparent)] underline-offset-2 outline-none hover:decoration-[var(--tinta-margen)] focus-visible:ring-2 focus-visible:ring-ring"
			>{p.titulo}</a>
			{p.motivo && <p className="mt-0.5 text-xs text-muted-foreground">{p.motivo}</p>}
			<Acciones descartar={descartar} />
		</section>
	);
}

/** Las propuestas pendientes de un comentario y lo ya aceptado; nada si no hay. */
export function PropuestasMargen({ comentario, acciones, soloPendientes = false }: { comentario: Comentario; acciones: AccionesPropuestas; soloPendientes?: boolean }) {
	const lista = (comentario.propuestas ?? []).filter(p => (soloPendientes ? p.estado === "pendiente" : p.estado !== "descartada"));
	if (lista.length === 0) return null;
	return <div data-propuestas={comentario.id}>{lista.map(p => <Una key={p.id} comentarioId={comentario.id} p={p} acciones={acciones} />)}</div>;
}
