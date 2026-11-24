"use client";

/**
 * El propósito del cuaderno (ticket 12f), con las palabras de David, y la tinta de sus comentarios. Desde la revisión de la
 * cabecera (23-nov-2026) viven en la sección «Tutor» de Propiedades, no en la cabecera: las propuestas de un clic están
 * siempre a la vista y «Solo escucha» ya no se ofrece, porque repetía el interruptor del modo.
 */
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MAX_PROPOSITO, PROPUESTAS_PROPOSITO, SOLO_ESCUCHA, type Tinta } from "./cuadernos";
import { TINTAS, colorDeTinta, tintaDe } from "./tintas";

/** Lo que cambia David: una clave ausente se queda como está; `null` quita el propósito. */
export interface CambioProposito { proposito?: string | null; tinta?: Tinta }

export interface PropositoCuadernoProps {
	proposito?: string;
	tinta?: Tinta;
	fijar(cambio: CambioProposito): void;
}

/** Una línea: sin saltos y con los espacios colapsados, como la guarda el plugin. */
const enUnaLinea = (s: string) => s.replace(/\s+/g, " ").trim();

const etiqueta = "text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground";

/** Las propuestas de un clic que se ofrecen. «Solo escucha» ya no es una: apagar al tutor es el interruptor de la cabecera. Un
 * cuaderno que la guardó sigue en «Solo escucha» y la nota lo dice. */
export const PROPUESTAS_A_LA_VISTA = PROPUESTAS_PROPOSITO.filter(p => p !== SOLO_ESCUCHA);

/** El propósito en Propiedades: el campo con su etiqueta y, debajo, las propuestas de un clic, siempre a la vista. */
export function PropositoCuaderno({ proposito, fijar }: Pick<PropositoCuadernoProps, "proposito" | "fijar">) {
	const guardado = proposito ?? "";
	const campo = useRef<HTMLInputElement>(null);

	// Lo que llega del servidor se pone en el campo sin rehacerlo: el foco y lo que David siga escribiendo no se pierden.
	useEffect(() => { if (campo.current && campo.current !== document.activeElement) campo.current.value = guardado; }, [guardado]);

	const confirmar = () => {
		const linea = enUnaLinea(campo.current?.value ?? "");
		if (campo.current) campo.current.value = linea;
		if (linea !== guardado) fijar({ proposito: linea || null });
	};
	const elegir = (texto: string) => {
		if (campo.current) campo.current.value = texto;
		if (texto !== guardado) fijar({ proposito: texto });
	};

	return (
		<div className="grid gap-1.5 font-sans">
			<label className="grid gap-1.5">
				<span className={etiqueta}>Para qué</span>
				{/* Sin controlar, como el tope: el valor guardado se pone con el efecto de arriba. */}
				<input
					ref={campo} type="text" name="proposito" aria-label="Propósito del cuaderno" placeholder="Para qué es este cuaderno…"
					defaultValue={guardado} maxLength={MAX_PROPOSITO} autoComplete="off"
					onBlur={confirmar}
					onKeyDown={(e) => {
						if (e.nativeEvent.isComposing) return;
						if (e.key === "Enter") { e.preventDefault(); confirmar(); }
						else if (e.key === "Escape") {
							// El desenfoque que sigue ve lo guardado y no cambia nada (si el panel se cierra con el mismo Escape, tampoco).
							e.preventDefault(); e.currentTarget.value = guardado; e.currentTarget.blur();
						}
					}}
					className="lh-input h-9 w-full min-w-0 rounded-md border border-border bg-background px-2.5 text-sm text-foreground placeholder:text-muted-foreground"
				/>
			</label>
			<div role="group" aria-label="Propuestas de propósito" data-propuestas className="flex flex-wrap gap-1.5">
				{PROPUESTAS_A_LA_VISTA.map(texto => (
					<Button
						key={texto} type="button" size="xs" variant="outline" data-propuesta
						onClick={() => elegir(texto)}
						className={cn("rounded-full px-2.5 text-xs font-normal", guardado === texto && "bg-accent")}
					>{texto}</Button>
				))}
			</div>
			<span className="text-sm text-muted-foreground">El tutor lo tiene en cuenta al comentar.</span>
			{guardado === SOLO_ESCUCHA && (
				<p data-escucha className="text-sm text-muted-foreground">
					Solo escucha: el tutor no comenta por su cuenta; contesta cuando se lo pides. Escribe otro propósito para quitarlo.
				</p>
			)}
		</div>
	);
}

/** La tinta de los comentarios del cuaderno, en Propiedades. Solo la siguen los personajes de tinta «Acento», como el Profesor:
 * los demás llevan la suya. */
export function TintaCuaderno({ tinta, fijar }: Pick<PropositoCuadernoProps, "tinta" | "fijar">) {
	const actual = tintaDe(tinta);
	const nombre = TINTAS.find(t => t.id === actual)!.etiqueta;
	return (
		<div className="grid gap-1.5 font-sans">
			<span className={etiqueta}>Tinta</span>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button" data-tinta aria-label={`Tinta de los comentarios: ${nombre}`}
						className="lh-input inline-flex h-9 w-full items-center gap-2 rounded-md border border-border bg-background px-2.5 text-sm text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent"
					>
						<span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: colorDeTinta(actual) }} />
						{nombre}
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="font-sans">
					<DropdownMenuRadioGroup value={actual} onValueChange={(v) => fijar({ tinta: v as Tinta })}>
						{TINTAS.map(t => (
							<DropdownMenuRadioItem key={t.id} value={t.id}>
								<span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: colorDeTinta(t.id) }} />
								{t.etiqueta}
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				</DropdownMenuContent>
			</DropdownMenu>
			<span className="text-sm text-muted-foreground">El color de los comentarios del Profesor y de tus personajes con tinta «Acento»; los demás personajes usan el suyo.</span>
		</div>
	);
}
