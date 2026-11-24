"use client";

/**
 * La barra lateral del armazón de estudio (ADR 0001, ticket 01): el espacio
 * activo como menú en la cabecera, Inicio, «Por decidir» con su panel cuando hay
 * decisiones pendientes (ticket 02 de la segunda ronda), los planes del espacio, plegables, con sus temas, tareas e
 * hitos y el ciclo de cada tema con unidad, y las unidades sin plan (spec de planes), Biblioteca (ticket 05), Cuadernos (ticket 09),
 * las conversaciones del espacio, agrupables por fecha o por unidad del plan y filtrables por actividad y fecha
 * (ticket 03 de la segunda ronda), y, abajo, la actividad en segundo plano, Progreso y Ajustes. Plegable a
 * iconos con su botón y con ⌘B; el asa de su borde derecho cambia el ancho (asa-barra.tsx). Bajo el espacio, el botón de la paleta de búsqueda y acciones (⌘K, ticket 08).
 *
 * Cada conversación tiene su menú (clic derecho, botón de «más» o la tecla de menú) para renombrarla en línea,
 * exportarla como Markdown o borrarla; F2 sobre la fila la renombra (ticket 12). Las piezas son las del núcleo:
 * `RenameRow`, `DeleteSessionDialog`, `ActivitySection`, la ruta de Markdown y el evento `lh:chat-renamed`.
 *
 * `BarraLateralEstudio` es pura (datos dentro, marcado fuera) para que el
 * render estático la fije; `BarraLateral` la conecta con el plugin y el router.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3Icon, CheckIcon, ChevronRightIcon, ChevronsUpDownIcon, GraduationCapIcon, HomeIcon, InboxIcon, LibraryIcon, ListFilterIcon, Loader2Icon, MessageSquareIcon, MoreHorizontalIcon, NotebookPenIcon, PlusIcon, QuoteIcon, SearchIcon, SettingsIcon, TargetIcon, XIcon } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { bindingForAction, formatBinding, kbdEventForAction } from "@/src/core";
import {
	DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
	DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarHeader, SidebarMenu,
	SidebarMenuAction, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarProvider, SidebarTrigger,
} from "@/components/ui/sidebar";
import { commitChatRename, downloadChatMarkdown, RenameRow } from "@/components/sidebar";
import { DeleteSessionDialog } from "@/components/delete-session-dialog";
import { ActivitySection } from "@/components/activity-dock";
import type { ChatListItem } from "@/src/core";
import { useSettingsDialog } from "@/components/settings/settings-dialog.tsx";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { useOptionalInteractionLayers } from "@/components/interaction-layers";
import { cn } from "@/lib/utils";
import {
	ACTIVIDADES, agruparConversaciones, FECHAS, FILTROS_INICIALES, filtrosConversaciones, recordarFiltros,
	type ConversacionLista, type FiltrosConversaciones, type OrigenConversacion,
} from "./conversaciones";
import { llamarEstudio } from "./llamar";
import { BarraCiclo } from "./ciclo";
import type { LecturaPlanes } from "./tipos";
import { TIPO_ELEMENTO, fechaHito, rutaPlan } from "./plan";
import { usePorDecidir } from "./por-decidir";
import { RUTA_BIBLIOTECA } from "./documentos";
import { RUTA_CUADERNOS } from "./cuadernos";
import { recordarPlegadas, seccionesPlegadas, type IdSeccion } from "./secciones";
import { AsaAnchoBarra, ProveedorAncho, useEstadoAncho } from "./asa-barra";
import { anidarRamas, ETIQUETA_ESTADO, LINEA_ACTIVA, repartir, SIN_META, useMetaConversaciones, type MetaConversacion } from "./estado-conversaciones";

export interface Espacio {
	id: string;
	name: string;
	archived: boolean;
	revision?: number;
}

export interface DatosBarraLateral {
	/** null mientras carga o si Estudio no responde. */
	espacios: { areas: Espacio[]; activeAreaId: string | null } | null;
	conversaciones: ConversacionLista[] | null;
	/** Los planes del espacio activo y sus unidades sin plan; null mientras carga o si Estudio no responde. */
	planes: LecturaPlanes | null;
	ruta: string;
	ahora?: Date;
	/** El error de la última operación de espacios, si falló. */
	error?: string | null;
	/** El atajo de la paleta como se muestra («Ctrl+K», «⌘K»). */
	atajoPaleta?: string;
	/** Las secciones plegadas; las demás, desplegadas. */
	plegadas?: readonly IdSeccion[];
	/** Cuántas decisiones esperan a David en el espacio activo; sin ninguna, o mientras se leen, no hay «Por decidir». */
	porDecidir?: number;
	/** Cómo se agrupan y filtran las conversaciones. */
	filtros?: FiltrosConversaciones;
}

export interface AccionesBarraLateral {
	elegirEspacio(id: string | null): void;
	crearEspacio(nombre: string): void;
	renombrarEspacio(id: string, nombre: string): void;
	archivarEspacio(id: string): void;
	/** Devuelve un espacio archivado a la lista de espacios. */
	recuperarEspacio(id: string): void;
	/** Asigna al espacio activo las unidades, planes, documentos, cuadernos y conversaciones que no tienen ninguno. */
	traerSinEspacio(): void;
	/** Crea un plan en el espacio activo con su objetivo y lo abre. */
	crearPlan(objetivo: string): void;
	abrirAjustes(): void;
	navegar(ruta: string): void;
	abrirPaleta(): void;
	renombrarConversacion(id: string, titulo: string): void;
	exportarConversacion(id: string): void;
	/** Pide ya el resumen de la conversación (tema, qué quedó abierto, qué sigue), sin esperar a la pausa. */
	resumirConversacion(id: string): void;
	/** Abre el diálogo de borrado del núcleo para esa conversación. */
	borrarConversacion(conversacion: ConversacionLista): void;
	/** Pliega una sección desplegada o despliega una plegada. */
	alternarSeccion(seccion: IdSeccion): void;
	/** Abre el panel con las decisiones pendientes. */
	abrirPorDecidir(): void;
	/** Cambia la agrupación o un filtro de las conversaciones. */
	cambiarFiltros(filtros: FiltrosConversaciones): void;
	/** Harness conversacional: fija la conversación arriba o la quita de Fijadas. */
	fijarConversacion?(id: string, fijada: boolean): void;
	/** Harness conversacional: la manda a Archivadas o la devuelve a la lista. */
	archivarConversacion?(id: string, archivada: boolean): void;
}

export const RUTA_PROGRESO = "/progreso";

/** Pantallas dedicadas (ticket 06): practicar y un intento ocupan la ventana, sin barra lateral. */
export const sinBarraLateral = (ruta: string | null): boolean => ruta !== null && /^\/(practicar|intento)\//.test(ruta);

type Edicion = { modo: "crear" } | { modo: "renombrar"; id: string; nombre: string } | null;

export function BarraLateralEstudio({
	espacios, conversaciones, planes, ruta, ahora, error, atajoPaleta = "Ctrl+K", plegadas = [], porDecidir = 0, filtros = FILTROS_INICIALES, acciones,
	meta = metaVacia,
}: DatosBarraLateral & { acciones: AccionesBarraLateral; /** Estado en vivo y marcas de cada conversación (núcleo). */ meta?: (id: string) => MetaConversacion }) {
	const [edicion, setEdicion] = useState<Edicion>(null);
	/** Al elegir «Nuevo» o «Renombrar», el menú no devuelve el foco a su botón: va al campo. */
	const editarAlCerrar = useRef(false);
	/** La conversación con su menú abierto y la que se está renombrando en su fila. */
	const [menu, setMenu] = useState<string | null>(null);
	const [renombrando, setRenombrando] = useState<string | null>(null);
	/** «Renombrar» desde el menú: el campo aparece cuando el menú ya ha cerrado, o su foco devuelto al botón lo cerraría. */
	const renombrarAlCerrar = useRef<string | null>(null);
	const visibles = espacios?.areas.filter(a => !a.archived) ?? [];
	const archivados = espacios?.areas.filter(a => a.archived) ?? [];
	const activo = visibles.find(a => a.id === espacios?.activeAreaId) ?? null;
	const nombre = espacios === null ? "Estudio" : activo?.name ?? "Todos los espacios";
	const todos = espacios !== null && activo === null;
	/** Los planes plegados en esta barra; los demás se ven desplegados. */
	const [plegados, setPlegados] = useState<string[]>([]);
	const alternarPlan = (id: string) => setPlegados(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
	/** El campo del objetivo de un plan nuevo, abierto con el «+» de la sección. */
	const [creandoPlan, setCreandoPlan] = useState(false);
	// Harness conversacional (diseño 1A): búsqueda, Fijadas arriba y Archivadas aparte; el resto, en los grupos de siempre.
	const [busqueda, setBusqueda] = useState("");
	// Variante A de los filtros (24-nov-2026): el buscador solo se ve tras pulsar la lupa o mientras tiene texto.
	const [buscando, setBuscando] = useState(false);
	const [verArchivadas, setVerArchivadas] = useState(false);
	const reparto = conversaciones ? repartir(conversaciones, meta, busqueda) : null;
	const grupos = reparto ? agruparConversaciones(reparto.resto, filtros, { ahora, planes, todos }) : [];
	/** Una fila de conversación: en Fijadas, en su grupo o en Archivadas; `nivel` sangra las ramas bajo su origen. */
	const fila = (c: ConversacionLista, nivel = 0, activa = false) => (
									<SidebarMenuItem key={c.id} style={nivel > 0 ? { paddingLeft: `${nivel * 12}px` } : undefined} data-nivel-rama={nivel || undefined}>
										{renombrando === c.id ? (
											<RenameRow
												chat={comoFila(c)}
												onCommit={(titulo) => {
													setRenombrando(null);
													if (titulo.trim() && titulo.trim() !== c.title) acciones.renombrarConversacion(c.id, titulo);
												}}
												onCancel={() => setRenombrando(null)}
											/>
										) : <>
											<SidebarMenuButton
												isActive={ruta === `/chat/${c.id}`}
												onClick={() => acciones.navegar(`/chat/${c.id}`)}
												onContextMenu={(e) => { e.preventDefault(); setMenu(c.id); }}
												onKeyDown={(e) => {
													// F2 renombra la fila enfocada, no la conversación abierta en la cabecera.
													if (e.key === "F2" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
														e.preventDefault();
														setRenombrando(c.id);
													}
													// La tecla de menú y Mayús+F10 abren el menú de la fila, como el clic derecho.
													if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey)) {
														e.preventDefault();
														setMenu(c.id);
													}
												}}
												data-testid="conversacion"
												data-conversacion={c.id}
												data-actividad={c.origen}
												title={c.unidad ? `${ETIQUETA_ACTIVIDAD[c.origen]} · ${c.unidad.titulo}` : ETIQUETA_ACTIVIDAD[c.origen]}
												className={cn("text-muted-foreground data-[active=true]:text-sidebar-accent-foreground", activa && "h-auto py-1.5")}
											>
												<IconoEstado estado={meta(c.id).estado} origen={c.origen} />
												<span className="grid min-w-0"><span className="truncate"><span className="sr-only">{ETIQUETA_ACTIVIDAD[c.origen]}{meta(c.id).estado !== "terminada" ? ` (${ETIQUETA_ESTADO[meta(c.id).estado]})` : ""}: </span>{c.title}</span>{activa && meta(c.id).estado !== "terminada" && <span aria-hidden className="truncate text-xs text-muted-foreground">{LINEA_ACTIVA[meta(c.id).estado as Exclude<MetaConversacion["estado"], "terminada">]}</span>}</span>
											</SidebarMenuButton>
											<DropdownMenu open={menu === c.id} onOpenChange={(abierto) => setMenu(abierto ? c.id : null)}>
												<DropdownMenuTrigger asChild>
													<SidebarMenuAction showOnHover aria-label={`Más acciones de «${c.title}»`} title="Más acciones" data-testid="conversacion-mas">
														<MoreHorizontalIcon />
													</SidebarMenuAction>
												</DropdownMenuTrigger>
												<DropdownMenuContent
													side="right"
													align="start"
													className="w-56 font-prose"
													data-testid="menu-conversacion"
													onCloseAutoFocus={(e) => {
														const id = renombrarAlCerrar.current;
														renombrarAlCerrar.current = null;
														if (id) { e.preventDefault(); setRenombrando(id); }
													}}
												>
													<DropdownMenuItem onSelect={() => { renombrarAlCerrar.current = c.id; }}>
														Renombrar<DropdownMenuShortcut>F2</DropdownMenuShortcut>
													</DropdownMenuItem>
													<DropdownMenuItem onSelect={() => acciones.exportarConversacion(c.id)}>Exportar como Markdown</DropdownMenuItem>
													<DropdownMenuItem onSelect={() => acciones.resumirConversacion(c.id)}>Resumir ahora</DropdownMenuItem>
													{acciones.fijarConversacion && <DropdownMenuItem onSelect={() => acciones.fijarConversacion?.(c.id, !meta(c.id).fijada)}>{meta(c.id).fijada ? "Quitar de fijadas" : "Fijar arriba"}</DropdownMenuItem>}
													{acciones.archivarConversacion && <DropdownMenuItem onSelect={() => acciones.archivarConversacion?.(c.id, !meta(c.id).archivada)}>{meta(c.id).archivada ? "Sacar de archivadas" : "Archivar"}</DropdownMenuItem>}
													<DropdownMenuSeparator />
													<DropdownMenuItem variant="destructive" onSelect={() => acciones.borrarConversacion(c)}>Borrar…</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										</>}
									</SidebarMenuItem>
	);
	const propsSeccion = (id: IdSeccion) => ({ seccion: id, plegada: plegadas.includes(id), onAlternar: () => acciones.alternarSeccion(id) });

	return (
		<Sidebar collapsible="icon" className="font-prose">
			<SidebarHeader className="gap-1 p-2">
				<div className="lh-drag flex h-9 items-center justify-end group-data-[collapsible=icon]:justify-center">
					<SidebarTrigger aria-label="Plegar o desplegar la barra lateral" className="lh-no-drag text-muted-foreground" />
				</div>
				{edicion ? (
					<CampoEspacio
						inicial={edicion.modo === "renombrar" ? edicion.nombre : ""}
						etiqueta={edicion.modo === "crear" ? "Nombre del espacio nuevo" : "Nuevo nombre del espacio"}
						onAceptar={(valor) => {
							if (edicion.modo === "crear") acciones.crearEspacio(valor);
							else acciones.renombrarEspacio(edicion.id, valor);
							setEdicion(null);
						}}
						onCancelar={() => setEdicion(null)}
					/>
				) : (
					<SidebarMenu>
						<SidebarMenuItem>
							<DropdownMenu>
								<DropdownMenuTrigger asChild disabled={espacios === null}>
									<SidebarMenuButton size="lg" data-testid="menu-espacio" tooltip={nombre} className="data-[state=open]:bg-sidebar-accent">
										<span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary font-title text-base text-primary-foreground">
											{nombre.charAt(0).toLocaleUpperCase("es")}
										</span>
										<span className="grid flex-1 text-left leading-tight">
											<span className="truncate font-medium">{nombre}</span>
											<span className="truncate text-xs text-muted-foreground">Espacio</span>
										</span>
										<ChevronsUpDownIcon className="ml-auto size-4 text-muted-foreground" />
									</SidebarMenuButton>
								</DropdownMenuTrigger>
								<DropdownMenuContent
									className="w-60 font-prose"
									align="start"
									onCloseAutoFocus={(e) => {
										if (editarAlCerrar.current) e.preventDefault();
										editarAlCerrar.current = false;
									}}
								>
									<DropdownMenuLabel className="text-xs text-muted-foreground">Espacios</DropdownMenuLabel>
									{visibles.map(a => (
										<DropdownMenuItem key={a.id} onSelect={() => acciones.elegirEspacio(a.id)}>
											<span className="flex-1 truncate">{a.name}</span>
											{a.id === activo?.id && <CheckIcon className="size-4" />}
										</DropdownMenuItem>
									))}
									<DropdownMenuItem onSelect={() => acciones.elegirEspacio(null)}>
										<span className="flex-1">Todos</span>
										{activo === null && <CheckIcon className="size-4" />}
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuItem onSelect={() => { editarAlCerrar.current = true; setEdicion({ modo: "crear" }); }}>
										Nuevo espacio…
									</DropdownMenuItem>
									{activo && <>
										<DropdownMenuItem onSelect={() => { editarAlCerrar.current = true; setEdicion({ modo: "renombrar", id: activo.id, nombre: activo.name }); }}>
											Renombrar «{activo.name}»…
										</DropdownMenuItem>
										<DropdownMenuItem onSelect={acciones.traerSinEspacio}>Traer aquí lo que no tiene espacio</DropdownMenuItem>
										<DropdownMenuItem onSelect={() => acciones.archivarEspacio(activo.id)}>
											Archivar «{activo.name}»
										</DropdownMenuItem>
									</>}
									{archivados.length > 0 && <>
										<DropdownMenuSeparator />
										<DropdownMenuLabel className="text-xs text-muted-foreground">Archivados</DropdownMenuLabel>
										{archivados.map(a => (
											<DropdownMenuItem key={a.id} onSelect={() => acciones.recuperarEspacio(a.id)}>
												<span className="truncate">Recuperar «{a.name}»</span>
											</DropdownMenuItem>
										))}
									</>}
								</DropdownMenuContent>
							</DropdownMenu>
						</SidebarMenuItem>
					</SidebarMenu>
				)}
				{error && <p role="alert" className="px-2 text-xs text-destructive group-data-[collapsible=icon]:hidden">{error}</p>}
				<BotonPaleta atajo={atajoPaleta} onAbrir={acciones.abrirPaleta} />
			</SidebarHeader>

			<SidebarContent>
				<SidebarGroup>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton isActive={ruta === "/"} onClick={() => acciones.navegar("/")} tooltip="Inicio" data-testid="inicio">
								<HomeIcon />Inicio
							</SidebarMenuButton>
						</SidebarMenuItem>
						{porDecidir > 0 && (
							<SidebarMenuItem>
								<SidebarMenuButton
									onClick={acciones.abrirPorDecidir}
									tooltip={`Por decidir (${porDecidir})`}
									aria-label={`Por decidir: ${porDecidir} ${porDecidir === 1 ? "pendiente" : "pendientes"}`}
									data-testid="por-decidir"
									className="relative"
								>
									<InboxIcon />Por decidir
									{/* Plegada la barra a iconos, la insignia de shadcn se oculta: el total va sobre el icono. */}
									<span aria-hidden data-icono-por-decidir className="absolute right-0.5 top-0.5 hidden h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] leading-none text-primary-foreground tabular-nums group-data-[collapsible=icon]:flex">
										{porDecidir > 9 ? "9+" : porDecidir}
									</span>
								</SidebarMenuButton>
								<SidebarMenuBadge className="bg-primary text-primary-foreground tabular-nums">{porDecidir}</SidebarMenuBadge>
							</SidebarMenuItem>
						)}
					</SidebarMenu>
				</SidebarGroup>

				<SeccionBarra
					{...propsSeccion("plan")}
					titulo="Planes"
					accion={
						<button
							type="button"
							onClick={() => setCreandoPlan(true)}
							aria-label="Nuevo plan"
							title="Nuevo plan"
							data-testid="nuevo-plan-barra"
							className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
						>
							<PlusIcon className="size-3.5" />
						</button>
					}
				>
					{creandoPlan && (
						<div className="mb-1 px-1">
							<CampoEspacio
								inicial=""
								etiqueta="Objetivo del plan nuevo"
								onAceptar={(objetivo) => { setCreandoPlan(false); acciones.crearPlan(objetivo); }}
								onCancelar={() => setCreandoPlan(false)}
							/>
						</div>
					)}
					{planes === null ? (
						<p className="px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">Cargando…</p>
					) : planes.planes.length === 0 && planes.sinPlan.length === 0 ? (
						<p className="px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
							Este espacio aún no tiene plan. Escribe en Inicio qué quieres conseguir y el tutor te propondrá uno, o créalo con «+».
						</p>
					) : (
						<SidebarMenu>
							{planes.planes.map(p => {
								const abierto = !plegados.includes(p.id);
								const propuesto = p.estado === "propuesto";
								return (
									<SidebarMenuItem key={p.id} data-plan={p.id}>
										<SidebarMenuButton
											isActive={ruta === rutaPlan(p.id)}
											onClick={() => acciones.navegar(rutaPlan(p.id))}
											tooltip={propuesto ? `${p.objetivo} (propuesto)` : p.objetivo}
											className="pr-14"
										>
											<TargetIcon />
											<span className={cn("truncate", propuesto && "italic text-muted-foreground")}>{p.objetivo}</span>
										</SidebarMenuButton>
										<SidebarMenuBadge className="right-7 text-[10px] font-normal text-muted-foreground tabular-nums">
											{propuesto ? "propuesto" : `${p.hechos}/${p.total}`}
										</SidebarMenuBadge>
										{p.elementos.length > 0 && (
											<SidebarMenuAction onClick={() => alternarPlan(p.id)} aria-expanded={abierto} aria-label={`${abierto ? "Plegar" : "Desplegar"} «${p.objetivo}»`}>
												<ChevronRightIcon className={cn("transition-transform", abierto && "rotate-90")} />
											</SidebarMenuAction>
										)}
										{abierto && p.elementos.length > 0 && (
											<SidebarMenuSub>
												{p.elementos.map(e => {
													const Icono = TIPO_ELEMENTO[e.tipo].icono;
													const destino = e.unidad ? `/unidad/${e.unidad.id}` : rutaPlan(p.id);
													return (
														<SidebarMenuSubItem key={e.id} data-elemento={e.tipo}>
															<SidebarMenuSubButton
																asChild
																isActive={e.unidad !== null && ruta === destino}
																className="h-auto py-1"
															>
																<button type="button" onClick={() => acciones.navegar(destino)} title={e.titulo}>
																	<Icono aria-label={TIPO_ELEMENTO[e.tipo].nombre} />
																	<span className="grid min-w-0 flex-1 gap-1">
																		<span className={cn("truncate", e.hecho && "text-muted-foreground line-through")}>{e.titulo}</span>
																		{e.unidad && <BarraCiclo ciclo={e.unidad.ciclo} className="w-16" />}
																		{e.fecha && <span className="text-[10px] text-muted-foreground">{fechaHito(e.fecha)}</span>}
																	</span>
																</button>
															</SidebarMenuSubButton>
														</SidebarMenuSubItem>
													);
												})}
											</SidebarMenuSub>
										)}
									</SidebarMenuItem>
								);
							})}
							{planes.sinPlan.length > 0 && <>
								<li className="px-2 pt-2 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground group-data-[collapsible=icon]:hidden">Unidades sin plan</li>
								{planes.sinPlan.map(u => (
									<SidebarMenuItem key={u.id}>
										<SidebarMenuButton
											isActive={ruta === `/unidad/${u.id}`}
											onClick={() => acciones.navegar(`/unidad/${u.id}`)}
											tooltip={u.propuesta ? `${u.titulo} (propuesta)` : u.titulo}
											className="h-auto py-1.5"
										>
											<GraduationCapIcon />
											<span className="grid min-w-0 flex-1 gap-1">
												<span className={cn("truncate", u.propuesta && "italic text-muted-foreground")}>{u.titulo}</span>
												{!u.propuesta && <BarraCiclo ciclo={u.ciclo} className="w-20" />}
											</span>
										</SidebarMenuButton>
										{u.propuesta && <SidebarMenuBadge className="text-[10px] font-normal text-muted-foreground">propuesta</SidebarMenuBadge>}
									</SidebarMenuItem>
								))}
							</>}
						</SidebarMenu>
					)}
				</SeccionBarra>

				<SeccionBarra {...propsSeccion("materiales")} titulo="Materiales">
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton isActive={ruta === RUTA_BIBLIOTECA || ruta.startsWith(`${RUTA_BIBLIOTECA}/`)} onClick={() => acciones.navegar(RUTA_BIBLIOTECA)} tooltip="Biblioteca">
								<LibraryIcon />Biblioteca
							</SidebarMenuButton>
						</SidebarMenuItem>
						<SidebarMenuItem>
							<SidebarMenuButton isActive={ruta === RUTA_CUADERNOS || ruta.startsWith(`${RUTA_CUADERNOS}/`)} onClick={() => acciones.navegar(RUTA_CUADERNOS)} tooltip="Cuadernos">
								<NotebookPenIcon />Cuadernos
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SeccionBarra>

				<SeccionBarra
					{...propsSeccion("conversaciones")}
					titulo="Conversaciones"
					className="group-data-[collapsible=icon]:hidden"
					accion={conversaciones && conversaciones.length > 0 ? (
						<AccionesConversaciones
							buscando={buscando || busqueda !== ""}
							onBuscar={() => {
								if (buscando || busqueda !== "") { setBusqueda(""); setBuscando(false); } else setBuscando(true);
							}}
							filtros={filtros}
							todos={todos}
							onCambiar={acciones.cambiarFiltros}
						/>
					) : undefined}
				>
					{conversaciones === null ? (
						<p className="px-2 text-xs text-muted-foreground">Cargando…</p>
					) : conversaciones.length === 0 ? (
						<p className="px-2 text-xs text-muted-foreground">Aún no hay conversaciones en este espacio.</p>
					) : <>
					{(buscando || busqueda !== "") && (
						<div className="px-2 pt-1">
							<div className="flex h-7 items-center gap-1.5 rounded-md bg-sidebar-accent px-2 text-sidebar-foreground focus-within:ring-[3px] focus-within:ring-ring/50">
								<SearchIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
								<input
									type="search"
									autoFocus
									value={busqueda}
									onChange={(e) => setBusqueda(e.target.value)}
									onBlur={() => { if (!busqueda) setBuscando(false); }}
									onKeyDown={(e) => {
										if (e.key !== "Escape") return;
										e.preventDefault(); e.stopPropagation();
										setBusqueda(""); setBuscando(false);
									}}
									placeholder="Buscar por título"
									aria-label="Buscar conversaciones por título"
									data-testid="buscar-conversaciones"
									className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
								/>
							</div>
						</div>
					)}
					<FichasFiltros filtros={filtros} onCambiar={acciones.cambiarFiltros} />
					{reparto && reparto.activas.length > 0 && (
						<div className="mb-2" data-testid="conversaciones-activas">
							<p className="truncate px-2 pb-1 pt-2 text-xs text-muted-foreground">Activas</p>
							<SidebarMenu>{reparto.activas.map(c => fila(c, 0, true))}</SidebarMenu>
						</div>
					)}
					{reparto && reparto.fijadas.length > 0 && (
						<div className="mb-2" data-testid="conversaciones-fijadas">
							<p className="truncate px-2 pb-1 pt-2 text-xs text-muted-foreground">Fijadas</p>
							<SidebarMenu>{anidarRamas(reparto.fijadas, meta).map(({ conversacion: c, nivel }) => fila(c, nivel))}</SidebarMenu>
						</div>
					)}
					{grupos.length === 0 && reparto?.fijadas.length === 0 && reparto?.activas.length === 0 && <p className="px-2 pt-1 text-xs text-muted-foreground">{busqueda.trim() ? "Ninguna conversación con ese título." : "Ninguna conversación con estos filtros."}</p>}
					{grupos.map(g => (
						<div key={g.clave} className="mb-2">
							<p data-grupo-conversaciones={g.etiqueta} title={g.etiqueta} className="truncate px-2 pb-1 pt-2 text-[11px] text-muted-foreground/80">
								{g.numero !== null && <span className="tabular-nums">{g.numero} · </span>}{g.etiqueta}
							</p>
							<SidebarMenu>
								{anidarRamas(g.conversaciones, meta).map(({ conversacion: c, nivel }) => fila(c, nivel))}
							</SidebarMenu>
						</div>
					))}
					{reparto && reparto.archivadas.length > 0 && (
						<div className="mb-2" data-testid="conversaciones-archivadas">
							<button
								type="button"
								aria-expanded={verArchivadas || busqueda.trim() !== ""}
								onClick={() => setVerArchivadas(v => !v)}
								className="w-full rounded-md px-2 pb-1 pt-2 text-left text-xs text-muted-foreground underline-offset-2 hover:underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
							>
								Archivadas ({reparto.archivadas.length})
							</button>
							{(verArchivadas || busqueda.trim() !== "") && <SidebarMenu>{reparto.archivadas.map(c => fila(c))}</SidebarMenu>}
						</div>
					)}
					</>}
				</SeccionBarra>
			</SidebarContent>

			<SidebarFooter>
				{/* Los procesos en segundo plano (ActivitySection del núcleo), encima de Progreso y Ajustes; plegada la barra, no se ven. */}
				<div className="-mx-2 group-data-[collapsible=icon]:hidden">
					<ActivitySection />
				</div>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton isActive={ruta.startsWith(RUTA_PROGRESO)} onClick={() => acciones.navegar(RUTA_PROGRESO)} tooltip="Progreso">
							<BarChart3Icon />Progreso
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton onClick={acciones.abrirAjustes} tooltip="Ajustes" data-testid="settings-entry">
							<SettingsIcon />Ajustes
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>
			<AsaAnchoBarra />
		</Sidebar>
	);
}

const ETIQUETA_ACTIVIDAD = Object.fromEntries(ACTIVIDADES.map(a => [a.id, a.etiqueta])) as Record<OrigenConversacion, string>;
const ICONO_ACTIVIDAD = { unidad: GraduationCapIcon, pasaje: QuoteIcon, intento: TargetIcon, libre: MessageSquareIcon } as const;

function IconoActividad({ origen }: { origen: OrigenConversacion }) {
	const Icono = ICONO_ACTIVIDAD[origen];
	return <Icono aria-hidden />;
}

const metaVacia = () => SIN_META;

/** Diseño 1A: giro mientras el tutor trabaja, punto ámbar si te espera; terminada, el icono de su origen (decisión de David). */
function IconoEstado({ estado, origen }: { estado: MetaConversacion["estado"]; origen: OrigenConversacion }) {
	if (estado === "trabajando") return <Loader2Icon aria-hidden className="animate-spin" data-estado="trabajando" />;
	if (estado === "te-espera") return <span aria-hidden data-estado="te-espera" className="flex size-4 shrink-0 items-center justify-center"><span className="size-2 rounded-full bg-warning" /></span>;
	return <IconoActividad origen={origen} />;
}

const claseIcono = "relative flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-sidebar-accent aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-foreground";

/** Filtros que recortan la lista (no cuenta cómo se agrupa). */
const filtrosActivos = (f: FiltrosConversaciones) => f.actividad !== FILTROS_INICIALES.actividad || f.fecha !== FILTROS_INICIALES.fecha;

/** Variante A (elegida por David el 24-nov-2026): lupa y filtro en la cabecera de «Conversaciones», en lugar de un
 * buscador fijo y tres selectores nativos. El filtro abre un menú con agrupar, actividad y fecha; un punto avisa de
 * que hay filtros puestos. */
function AccionesConversaciones({ buscando, onBuscar, filtros, todos, onCambiar }: {
	buscando: boolean;
	onBuscar(): void;
	filtros: FiltrosConversaciones;
	todos: boolean;
	onCambiar(filtros: FiltrosConversaciones): void;
}) {
	const activos = filtrosActivos(filtros);
	return (
		<div className="flex shrink-0 items-center gap-0.5 group-data-[collapsible=icon]:hidden">
			<button type="button" onClick={onBuscar} aria-pressed={buscando} aria-label="Buscar conversaciones" title="Buscar conversaciones" data-testid="lupa-conversaciones" className={claseIcono}>
				<SearchIcon className="size-3.5" />
			</button>
			<DropdownMenu>
				<DropdownMenuTrigger
					aria-label={activos ? "Filtrar conversaciones (hay filtros puestos)" : "Filtrar conversaciones"}
					title="Agrupar y filtrar"
					data-testid="filtro-conversaciones"
					data-filtros-activos={activos || undefined}
					className={claseIcono}
				>
					<ListFilterIcon className="size-3.5" />
					{activos && <span aria-hidden className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" />}
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-52">
					<DropdownMenuLabel className="text-xs text-muted-foreground">Agrupar</DropdownMenuLabel>
					<DropdownMenuRadioGroup value={filtros.agrupar} onValueChange={(v) => onCambiar({ ...filtros, agrupar: v as FiltrosConversaciones["agrupar"] })}>
						<DropdownMenuRadioItem value="fecha">Por fecha</DropdownMenuRadioItem>
						<DropdownMenuRadioItem value="unidad">{todos ? "Por plan" : "Por unidad del plan"}</DropdownMenuRadioItem>
					</DropdownMenuRadioGroup>
					<DropdownMenuSeparator />
					<DropdownMenuLabel className="text-xs text-muted-foreground">Actividad</DropdownMenuLabel>
					<DropdownMenuRadioGroup value={filtros.actividad} onValueChange={(v) => onCambiar({ ...filtros, actividad: v as FiltrosConversaciones["actividad"] })}>
						<DropdownMenuRadioItem value="toda">Toda</DropdownMenuRadioItem>
						{ACTIVIDADES.map(a => <DropdownMenuRadioItem key={a.id} value={a.id}>{a.etiqueta}</DropdownMenuRadioItem>)}
					</DropdownMenuRadioGroup>
					<DropdownMenuSeparator />
					<DropdownMenuLabel className="text-xs text-muted-foreground">Fecha</DropdownMenuLabel>
					<DropdownMenuRadioGroup value={filtros.fecha} onValueChange={(v) => onCambiar({ ...filtros, fecha: v as FiltrosConversaciones["fecha"] })}>
						{FECHAS.map(f => <DropdownMenuRadioItem key={f.id} value={f.id}>{f.etiqueta}</DropdownMenuRadioItem>)}
					</DropdownMenuRadioGroup>
					{activos && <>
						<DropdownMenuSeparator />
						<DropdownMenuItem onSelect={() => onCambiar({ ...filtros, actividad: FILTROS_INICIALES.actividad, fecha: FILTROS_INICIALES.fecha })}>Quitar filtros</DropdownMenuItem>
					</>}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

/** Los filtros puestos, como fichas que se quitan con ✕; sin filtros no ocupa nada. */
function FichasFiltros({ filtros, onCambiar }: { filtros: FiltrosConversaciones; onCambiar(filtros: FiltrosConversaciones): void }) {
	const fichas: { clave: string; etiqueta: string; quitar(): void }[] = [];
	if (filtros.actividad !== FILTROS_INICIALES.actividad) {
		fichas.push({ clave: "actividad", etiqueta: ETIQUETA_ACTIVIDAD[filtros.actividad as OrigenConversacion], quitar: () => onCambiar({ ...filtros, actividad: FILTROS_INICIALES.actividad }) });
	}
	if (filtros.fecha !== FILTROS_INICIALES.fecha) {
		fichas.push({ clave: "fecha", etiqueta: FECHAS.find(f => f.id === filtros.fecha)?.etiqueta ?? filtros.fecha, quitar: () => onCambiar({ ...filtros, fecha: FILTROS_INICIALES.fecha }) });
	}
	if (fichas.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-1 px-2 pb-1 pt-1" data-testid="fichas-filtros">
			{fichas.map(f => (
				<span key={f.clave} data-ficha-filtro={f.clave} className="inline-flex items-center gap-0.5 rounded-full bg-sidebar-accent py-0.5 pl-2 pr-0.5 text-[11px] text-sidebar-foreground">
					{f.etiqueta}
					<button type="button" onClick={f.quitar} aria-label={`Quitar el filtro ${f.etiqueta}`} className="anillo-foco rounded-full p-0.5 text-muted-foreground hover:text-sidebar-foreground">
						<XIcon className="size-3" />
					</button>
				</span>
			))}
		</div>
	);
}

/** Una sección con jerarquía: la cabecera, en negrita al tamaño del cuerpo y con chevrón, pliega y despliega sus
 * elementos, que van un punto más pequeños y con sangría. Plegada la barra a iconos no hay cabecera. */
function SeccionBarra({ seccion, plegada, onAlternar, titulo, descripcion, accion, className, children }: {
	seccion: IdSeccion;
	plegada: boolean;
	onAlternar(): void;
	titulo: string;
	descripcion?: string;
	/** Un botón junto a la cabecera, como el «+» de Planes. */
	accion?: React.ReactNode;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<SidebarGroup className={className}>
			<div className="flex items-center gap-1">
			<button
				type="button"
				aria-expanded={!plegada}
				aria-controls={`seccion-${seccion}`}
				onClick={onAlternar}
				title={descripcion}
				data-seccion={seccion}
				className="flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-left text-sm font-bold text-sidebar-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
			>
				<ChevronRightIcon aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", !plegada && "rotate-90")} />{titulo}
			</button>
			{accion}
			</div>
			{/* Plegada, sus elementos siguen en la barra de iconos, como antes de haber secciones. */}
			<div
				id={`seccion-${seccion}`}
				data-elementos={seccion}
				className={cn("pl-3 [&_[data-sidebar=menu-button]]:text-[11.5px] group-data-[collapsible=icon]:pl-0", plegada && "hidden group-data-[collapsible=icon]:block")}
			>
				{children}
			</div>
		</SidebarGroup>
	);
}

/** `RenameRow` del núcleo pide una fila de la lista de sesiones; de una conversación del espacio basta su título y
 * su fecha: sin turno en marcha ni pregunta pendiente, su segunda línea es «hace cuánto». */
export function comoFila(c: ConversacionLista): ChatListItem {
	return {
		id: c.id, title: c.title, createdAt: c.updatedAt, updatedAt: c.updatedAt, kind: "teach", messageCount: 0, phase: "teach",
		pendingQuestion: false, pendingProblem: false, busy: false, compacting: false,
	} as ChatListItem;
}

/** El botón que abre la paleta (ticket 08), con su atajo; plegada la barra, solo la lupa. */
function BotonPaleta({ atajo, onAbrir }: { atajo: string; onAbrir(): void }) {
	return (
		<button
			type="button"
			onClick={onAbrir}
			aria-label={`Buscar o hacer (${atajo})`}
			title={`Buscar o hacer (${atajo})`}
			data-testid="abrir-paleta"
			className="mt-1 flex h-8 w-full items-center gap-2 rounded-md border border-sidebar-border bg-background/60 px-2.5 text-sm text-muted-foreground outline-none transition-colors hover:border-border hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
		>
			<SearchIcon className="size-3.5 shrink-0" />
			<span className="flex-1 truncate text-left group-data-[collapsible=icon]:hidden">Buscar o hacer…</span>
			<Kbd className="group-data-[collapsible=icon]:hidden">{atajo}</Kbd>
		</button>
	);
}

/** Campo en línea para nombrar un espacio: Intro acepta, Escape cancela. */
function CampoEspacio({ inicial, etiqueta, onAceptar, onCancelar }: {
	inicial: string;
	etiqueta: string;
	onAceptar: (valor: string) => void;
	onCancelar: () => void;
}) {
	const [valor, setValor] = useState(inicial);
	const ref = useRef<HTMLInputElement>(null);
	const capas = useOptionalInteractionLayers();
	useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
	return (
		<input
			ref={ref}
			value={valor}
			aria-label={etiqueta}
			placeholder={etiqueta}
			spellCheck={false}
			onChange={(e) => setValor(e.target.value)}
			onBlur={onCancelar}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					if (valor.trim()) onAceptar(valor.trim());
					else onCancelar();
				}
				if (e.key === "Escape") {
					if (capas && !capas.isElementEligible(e.currentTarget)) return;
					// Reclamado: que no llegue también a la cadena de Escape de la conversación.
					capas?.claimEscape(e);
					e.stopPropagation();
					onCancelar();
				}
			}}
			className="lh-input h-12 w-full rounded-md border border-sidebar-border bg-background px-3 text-sm outline-none focus:border-ring group-data-[collapsible=icon]:hidden"
		/>
	);
}

/** El proveedor de la barra de shadcn, gobernado por el estado del núcleo
 * (preferencia guardada, cierre en ventana estrecha y ⌘B). El núcleo aplica
 * la preferencia guardada después de montar; sin animación hasta entonces, la
 * barra no se despliega a la vista en cada carga. */
export function ProveedorBarraLateral({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: React.ReactNode }) {
	const [animar, setAnimar] = useState(false);
	useEffect(() => {
		// Dos fotogramas: el primero ya pinta el estado guardado, el segundo activa las transiciones.
		let segundo = 0;
		const primero = requestAnimationFrame(() => { segundo = requestAnimationFrame(() => setAnimar(true)); });
		return () => { cancelAnimationFrame(primero); cancelAnimationFrame(segundo); };
	}, []);
	// El ancho que David fija arrastrando el borde (asa-barra.tsx); arrastrando, sin transiciones.
	const ancho = useEstadoAncho();
	return (
		<ProveedorAncho value={ancho}>
			<SidebarProvider
				open={open}
				onOpenChange={(siguiente) => { if (siguiente !== open) onToggle(); }}
				className={cn("min-h-0 h-dvh", (!animar || ancho.arrastrando) && "[&_*]:transition-none")}
				style={{ "--sidebar-width": `${ancho.ancho}px` } as React.CSSProperties}
			>
				{children}
			</SidebarProvider>
		</ProveedorAncho>
	);
}

/** La barra conectada: lee espacios, plan y conversaciones del plugin y se
 * refresca con los avisos del servidor; lo pendiente de decidir y su panel, con
 * `usePorDecidir`. */
export function BarraLateral() {
	const ruta = usePathname();
	const router = useRouter();
	const { open: abrirAjustes } = useSettingsDialog();
	const [espacios, setEspacios] = useState<DatosBarraLateral["espacios"]>(null);
	const [conversaciones, setConversaciones] = useState<ConversacionLista[] | null>(null);
	const [planes, setPlanes] = useState<LecturaPlanes | null>(null);
	const porDecidir = usePorDecidir();
	const [error, setError] = useState<string | null>(null);
	const [borrando, setBorrando] = useState<ConversacionLista | null>(null);
	// Como la preferencia de la barra del núcleo: se lee al montar, porque el servidor no ve el almacenamiento.
	const [plegadas, setPlegadas] = useState<IdSeccion[]>([]);
	const [filtros, setFiltros] = useState<FiltrosConversaciones>(FILTROS_INICIALES);
	useEffect(() => { setPlegadas(seccionesPlegadas()); setFiltros(filtrosConversaciones()); }, []);
	const cambiarFiltros = useCallback((siguientes: FiltrosConversaciones) => { recordarFiltros(siguientes); setFiltros(siguientes); }, []);
	const alternarSeccion = useCallback((seccion: IdSeccion) => {
		const siguiente = plegadas.includes(seccion) ? plegadas.filter(s => s !== seccion) : [...plegadas, seccion];
		recordarPlegadas(siguiente);
		setPlegadas(siguiente);
	}, [plegadas]);

	const leer = useCallback(async () => {
		try {
			// Los planes van aparte: si su lectura falla, el menú de espacios y las conversaciones siguen.
			const plan = llamarEstudio<LecturaPlanes>("planes").then(setPlanes, () => setPlanes(null));
			const [e, c] = await Promise.all([
				llamarEstudio<NonNullable<DatosBarraLateral["espacios"]>>("espacios"),
				llamarEstudio<ConversacionLista[]>("conversaciones"),
			]);
			setEspacios(e);
			setConversaciones(c);
			await plan;
		} catch {
			setEspacios(null);
			setConversaciones(prev => prev ?? []);
		}
	}, []);

	const pendiente = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const leerPronto = useCallback(() => {
		if (pendiente.current) clearTimeout(pendiente.current);
		pendiente.current = setTimeout(() => { pendiente.current = undefined; void leer(); }, 250);
	}, [leer]);
	useEffect(() => () => { if (pendiente.current) clearTimeout(pendiente.current); }, []);
	useEffect(() => { void leer(); }, [leer, ruta]);
	useServerEvent("chats-changed", leerPronto);
	useServerEvent("turn-settled", leerPronto);
	useServerEvent("plugin-message", (m) => { if (m.pluginId === "estudio") leerPronto(); });
	useServerResync(() => void leer());
	// Renombrar desde la cabecera del chat, desde esta barra o desde otra pieza: el título cambia al momento.
	useEffect(() => {
		const renombrada = (e: Event) => {
			const { id, title } = (e as CustomEvent<{ id: string; title: string }>).detail;
			setConversaciones(prev => prev?.map(c => (c.id === id ? { ...c, title } : c)) ?? prev);
		};
		window.addEventListener("lh:chat-renamed", renombrada);
		return () => window.removeEventListener("lh:chat-renamed", renombrada);
	}, []);

	/** Como en la barra del núcleo: fuera de la lista al momento y, si estaba abierta, de vuelta al inicio. */
	const borrada = useCallback((id: string, _modo: unknown, graphRevision: number) => {
		setBorrando(null);
		setConversaciones(prev => prev?.filter(c => c.id !== id) ?? prev);
		if (ruta === `/chat/${id}`) router.push("/");
		window.dispatchEvent(new CustomEvent("lh:graph-revision", { detail: { revision: graphRevision } }));
	}, [ruta, router]);

	const operar = useCallback(async (operation: string, input: unknown) => {
		setError(null);
		try {
			await llamarEstudio(operation, input);
		} catch (e) {
			setError(e instanceof Error ? e.message : "No se pudo completar la acción.");
		}
		await leer();
	}, [leer]);

	const revision = (id: string) => espacios?.areas.find(a => a.id === id)?.revision;
	const meta = useMetaConversaciones();
	/** Fijar y archivar viven en el registro del núcleo; la lista se refresca con chats-changed. */
	const marcarConversacion = useCallback(async (id: string, marcas: { pinned?: boolean; archived?: boolean }) => {
		setError(null);
		try {
			const res = await fetch(`/api/chats/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(marcas) });
			if (!res.ok) throw new Error();
		} catch {
			setError("No se pudo cambiar la conversación.");
		}
	}, []);
	// El atajo admite cambios del usuario y depende del sistema: se calcula en el cliente.
	const [atajoPaleta, setAtajoPaleta] = useState("Ctrl+K");
	useEffect(() => { setAtajoPaleta(formatBinding(bindingForAction("command-palette"))); }, []);

	return (<>
		<BarraLateralEstudio
			espacios={espacios}
			conversaciones={conversaciones}
			planes={planes}
			ruta={ruta}
			error={error}
			atajoPaleta={atajoPaleta}
			plegadas={plegadas}
			porDecidir={porDecidir.total}
			filtros={filtros}
			acciones={{
				elegirEspacio: (id) => void operar("activar-espacio", { areaId: id }),
				crearEspacio: (nombre) => void operar("crear-espacio", { name: nombre }),
				renombrarEspacio: (id, nombre) => void operar("editar-espacio", { id, expectedRevision: revision(id), name: nombre }),
				archivarEspacio: (id) => void operar("editar-espacio", { id, expectedRevision: revision(id), archived: true }),
				recuperarEspacio: (id) => void operar("editar-espacio", { id, expectedRevision: revision(id), archived: false }),
				traerSinEspacio: () => void operar("traer-sin-espacio", {}),
				crearPlan: (objetivo) => void (async () => {
					setError(null);
					try {
						const plan = await llamarEstudio<{ id: string }>("crear-plan", { goal: objetivo });
						router.push(rutaPlan(plan.id));
					} catch (e) {
						setError(e instanceof Error ? e.message : "No se pudo crear el plan.");
					}
					await leer();
				})(),
				abrirAjustes: () => abrirAjustes(),
				navegar: (destino) => router.push(destino),
				abrirPaleta: () => window.dispatchEvent(new CustomEvent(kbdEventForAction("command-palette"))),
				renombrarConversacion: (id, titulo) => void commitChatRename(id, titulo),
				exportarConversacion: (id) => downloadChatMarkdown(id),
				resumirConversacion: (id) => void operar("resumir-conversacion", { chatId: id }),
				borrarConversacion: (c) => setBorrando(c),
				alternarSeccion,
				abrirPorDecidir: porDecidir.abrir,
				cambiarFiltros,
				fijarConversacion: (id, fijada) => void marcarConversacion(id, { pinned: fijada }),
				archivarConversacion: (id, archivada) => void marcarConversacion(id, { archived: archivada }),
			}}
			meta={meta}
		/>
		{porDecidir.panel}
		<DeleteSessionDialog chat={borrando} onClose={() => setBorrando(null)} onDeleted={borrada} />
	</>);
}
