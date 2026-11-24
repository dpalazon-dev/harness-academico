"use client";

/**
 * «Escuchar» en el menú «⋯» del cuaderno y en cada comentario (ticket 12j). Desde la revisión de la cabecera (23-nov-2026) el
 * interruptor es una casilla del menú, no una píldora más junto al modo; los avisos de la voz siguen en la cabecera. El botón de
 * un comentario lo lee a demanda, con la casilla como esté. Ni la marca ni los textos de riddled.ai: solo su forma.
 */
import { SquareIcon, Volume2Icon } from "lucide-react";
import { DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { VozVista } from "./escuchar";

const TEXTO_AVISO = {
	"sin-espanol": "Sin voz en español: se usa la predeterminada.",
	fallo: "No se pudo leer en voz alta.",
} as const;

/** «Leer en voz alta los comentarios» en el menú «⋯» de la cabecera: una casilla, marcada si está encendido. Sin síntesis de voz
 * en el equipo se ve desactivada y dice por qué. */
export function OpcionEscuchar({ voz }: { voz: VozVista }) {
	const { disponible, activo, alternar } = voz;
	return (
		<DropdownMenuCheckboxItem
			checked={disponible && activo} disabled={!disponible} data-escuchar-interruptor
			onSelect={() => { if (disponible) alternar(); }}
			className="items-start"
		>
			<span className="min-w-0">
				<span className="block">Leer en voz alta los comentarios</span>
				<span className="block text-xs text-muted-foreground">{disponible ? "Con las voces de este equipo; nada sale de él" : "Este equipo no ofrece síntesis de voz"}</span>
			</span>
		</DropdownMenuCheckboxItem>
	);
}

/** Lo que la voz tiene que contar en la cabecera: que no hay voz española o que falló. Sin nada que contar no pinta nada. */
export function AvisoEscuchar({ voz }: { voz: VozVista }) {
	if (!voz.aviso) return null;
	return <span role="status" data-escuchar-aviso={voz.aviso} className="font-sans text-xs text-muted-foreground">{TEXTO_AVISO[voz.aviso]}</span>;
}

/** Lo que un comentario necesita para escucharse: el estado de la voz y cómo leer o parar. */
export type AccionesVoz = Pick<VozVista, "disponible" | "leyendo" | "leer" | "parar">;

/** El botón de un mensaje del tutor: «Escuchar», y «Detener» mientras suena ese mensaje. Sin voz en el equipo, no se pinta. */
export function BotonEscuchar({ mensajeId, texto, firma, voz, className }: { mensajeId: string; texto: string; firma: string; voz: AccionesVoz; className?: string }) {
	if (!voz.disponible) return null;
	const suena = voz.leyendo === mensajeId;
	return (
		<button
			type="button" data-recorrido data-escuchar-mensaje={mensajeId}
			aria-label={suena ? "Detener la lectura" : `Escuchar el comentario de ${firma}`}
			onClick={() => { if (suena) voz.parar(); else voz.leer(mensajeId, texto); }}
			className={cn("inline-flex h-6 items-center gap-1 rounded-md font-sans text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring", className)}
		>
			{suena ? <SquareIcon className="size-3" aria-hidden="true" /> : <Volume2Icon className="size-3.5" aria-hidden="true" />}
			{suena ? "Detener" : "Escuchar"}
		</button>
	);
}
