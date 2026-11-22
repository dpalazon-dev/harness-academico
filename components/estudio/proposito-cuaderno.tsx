"use client";

/**
 * El propósito del cuaderno (ticket 12f): una línea en la cabecera, con las palabras de David, y la tinta de sus comentarios.
 * Es la forma de la línea «Tell Riddled» de riddled.ai (una frase escrita a mano junto al modo), sin su marca ni sus textos.
 * Las propuestas de un clic salen al escribir, no están siempre a la vista; «Solo escucha» es la elección que apaga al tutor.
 */
import { useEffect, useRef, useState, type FocusEvent } from "react";
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

/** Se pinta dentro de la línea del modo (un contenedor que envuelve): el campo con su tinta y, debajo, las propuestas y la nota. */
export function PropositoCuaderno({ proposito, tinta, fijar }: PropositoCuadernoProps) {
	const guardado = proposito ?? "";
	const campo = useRef<HTMLInputElement>(null);
	const [dentro, setDentro] = useState(false);

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
	const actual = tintaDe(tinta);
	const nombre = TINTAS.find(t => t.id === actual)!.etiqueta;

	return (
		<>
			<div
				className="flex min-w-[14rem] flex-1 items-center gap-1.5 font-sans text-xs"
				onFocus={() => setDentro(true)}
				onBlur={(e: FocusEvent<HTMLDivElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDentro(false); }}
			>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button" data-tinta aria-label={`Tinta de los comentarios: ${nombre}`} title="Tinta de los comentarios de este cuaderno"
							className="inline-flex size-6 shrink-0 items-center justify-center rounded-full outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent"
						><span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: colorDeTinta(actual) }} /></button>
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
				{/* Sin controlar, como el tope: el valor guardado se pone con el efecto de arriba. */}
				<input
					ref={campo} type="text" name="proposito" aria-label="Propósito del cuaderno" placeholder="Para qué es este cuaderno…"
					defaultValue={guardado} maxLength={MAX_PROPOSITO} autoComplete="off"
					onBlur={confirmar}
					onKeyDown={(e) => {
						if (e.nativeEvent.isComposing) return;
						if (e.key === "Enter") { e.preventDefault(); confirmar(); }
						else if (e.key === "Escape") {
							// El desenfoque que sigue ve lo guardado y no cambia nada.
							e.preventDefault(); e.currentTarget.value = guardado; e.currentTarget.blur();
						}
					}}
					className="h-7 min-w-0 flex-1 border-0 border-b border-transparent bg-transparent px-1 text-foreground outline-none placeholder:text-muted-foreground hover:border-border focus-visible:border-foreground/40"
				/>
			</div>
			{dentro && (
				<div role="group" aria-label="Propuestas de propósito" data-propuestas className="flex basis-full flex-wrap gap-1.5 font-sans">
					{PROPUESTAS_PROPOSITO.map(texto => (
						<Button
							key={texto} type="button" size="xs" variant="outline" data-propuesta
							// El campo no pierde el foco: la línea se rellena y David puede seguir escribiendo.
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => elegir(texto)}
							className={cn("rounded-full px-2.5 text-[11px] font-normal", guardado === texto && "bg-accent")}
						>{texto}</Button>
					))}
				</div>
			)}
			{guardado === SOLO_ESCUCHA && (
				<p data-escucha className="basis-full font-sans text-xs leading-5 text-muted-foreground">
					Solo escucha: el tutor no comenta por su cuenta; contesta cuando se lo pides.
				</p>
			)}
		</>
	);
}
