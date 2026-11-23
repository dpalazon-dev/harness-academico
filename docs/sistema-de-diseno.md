# Sistema de diseño

Reglas de interfaz de HarnessAcademico. Valen para todo el código nuevo y para el que se toque. El código heredado de LearnHarness se adapta cuando se modifica por otro motivo, salvo lo que esta guía cambia en los tokens (afecta a toda la app desde el primer día).

Decisiones visuales elegidas por David el 23-nov-2026 sobre una maqueta con variantes: texto mínimo de 12 px subiendo el token, foco con contorno del acento (y fondo con barra en las listas), interruptor con pista, control segmentado para elegir entre pocas opciones, primario neutro, y estados en bloque en las páginas y en una línea en la barra lateral.

## Referente

Una herramienta de pensamiento tranquila, del tipo de Linear o Notion: superficies planas, un color de texto fuerte y uno apagado, bordes finos, sin sombras salvo en lo que flota (menús, diálogos), movimiento corto y solo cuando explica un cambio. La página es del contenido (la prosa del tutor, las notas de David); los controles se retiran a la periferia y aparecen cuando hacen falta.

En la práctica:
- Antes de añadir un control a una cabecera, pregúntate si cabe en un menú «⋯» o en un popover. La cabecera de Cuadernos con ocho controles es el contraejemplo.
- Un estado se dice con palabras, no solo con un punto de color.
- Si dos controles hacen cosas distintas, no pueden tener la misma forma.

## La base (no se cambia)

| Pieza | Dónde | Para qué |
|---|---|---|
| shadcn/ui, estilo «new-york», sobre Radix | `components/ui/`, `components.json` | Todos los controles. Las piezas nuevas se traen con su código (no hay paquete) desde el paraguas `radix-ui` 1.6.7, que ya está en `package.json` |
| Tailwind 4 | `app/globals.css` (`@theme inline`) | Utilidades. Solo con los tokens de esta guía |
| Tokens | `app/globals.css` | Color, tipografía, radios y espaciado. Cada tema los rellena |
| 12 temas | `src/core/themes.ts`, `docs/themes.md` | Paletas. Ningún componente escribe un color literal |
| lucide-react | — | Iconos. Tamaño por defecto `size-4`; `size-3` en controles `xs` |
| motion | — | Animaciones de entrada y de cambio de tamaño |
| streamdown | `components/ai-elements/message.tsx` | Markdown de las respuestas del tutor |

No se migra a otra librería de componentes. Lo que falte se añade a `components/ui/` con la receta de shadcn.

## Controles: una sola forma por función

| Función | Pieza | Estado en `components/ui/` | Notas |
|---|---|---|---|
| Acción | `Button` | Existe | Variantes en «Jerarquía de botones». Nunca un `<button>` nativo con clases propias |
| Acción solo con icono | `Button size="icon-sm"` (o `icon-xs`) + `Hint` | Existen | El `Hint` lleva el nombre y el atajo. `aria-label` obligatorio |
| Encender o apagar algo con efecto inmediato | `Switch` + texto visible | **A crear** (Radix Switch) | Sustituye a `Toggle` de `components/settings/controls.tsx` y a las píldoras con punto de Cuadernos (`modo-proactivo.tsx`, `escuchar-cuaderno.tsx`). La etiqueta va al lado, nunca solo en `title` |
| Elegir una opción entre 2 y 4, visibles a la vez | `ToggleGroup type="single"` con forma segmentada | **A crear** (Radix ToggleGroup) | Rangos de la agenda, valoración del intento. Navegación con flechas de Radix |
| Elegir una opción entre muchas | `Select` | **A crear** (Radix Select) | Sustituye a los 11 `<select>` nativos y a `ThinSelect`. Con buscador si pasan de ~12 opciones: `Command` dentro de `Popover` |
| Elegir un color o una apariencia | `RadioGroup` con muestras | **A crear** (Radix RadioGroup) | Tintas, personajes. Cada muestra con nombre visible o `aria-label` |
| Lista de acciones sobre un objeto | `DropdownMenu` | Existe | Menú «⋯», clic derecho de las filas |
| Contenido o ajustes flotantes, con controles dentro | `Popover` | **A crear** (Radix Popover) | La barra del margen de Cuadernos, la futura entrada «Tutor: …». Escape cierra y el foco vuelve al disparador |
| Buscar y ejecutar | `Command` (en `Dialog` o `Popover`) | Existe | Paleta ⌘K, menú «/» del editor |
| Explicar un control | `Hint` (tooltip) | Existe | Solo información extra. Lo imprescindible se ve sin pasar el ratón |
| Confirmar algo que no se puede deshacer | `AlertDialog` | **A crear** (Radix AlertDialog) | Prohibido `window.confirm`. Botón con el verbo («Mover a la papelera»), no «Aceptar» |
| Ventana con un formulario o una tarea | `Dialog` / `Sheet` | Existen | `Sheet` para paneles laterales (Propiedades) |
| Texto de una línea / de varias | `Input` / `Textarea` | Existen | Hace falta añadir `size="sm"` y la variante `ghost` (sin borde, para títulos y campos en línea). Ningún archivo define su propia constante `campo` |
| Etiqueta de estado o recuento, no interactiva | `Badge` | **A crear** (cva) | Absorbe `StatusBadge`. El color de un estado viene de los tokens `--lh-error/success/warning` o de `--lh-accent` |
| Ficha de acción (sugerencias del inicio) | `Button variant="outline" size="sm"` con `rounded-full` | Existe | Es un botón, no una etiqueta: la forma redonda se reserva a acciones sugeridas |
| Sección plegable | `Collapsible` | Existe | Con chevron que gira y `aria-controls` |
| Aviso, error o información en la página | `Alert` | **A crear** (cva) | Ver «Estados» |
| Carga de contenido con forma conocida | `Skeleton` | Existe | Ver «Estados» |
| Tecla o atajo | `Kbd` | Existe | Texto del atajo con `formatBinding` («Ctrl+K» en Windows, nunca «⌘K») |

Regla de los cinco minutos: si vas a escribir un control que no está en esta tabla, para. O encaja en una pieza existente, o la pieza nueva entra primero en `components/ui/` y en esta tabla.

## Jerarquía de botones

- **Un solo primario por pantalla**: la acción que la pantalla recomienda. `variant="default"`: fondo del color del texto (`--primary`), sin acento del tema.
- **Secundario**: `outline`. Para la segunda acción importante.
- **Terciario**: `ghost`. Para acciones frecuentes y de poco peso (barras de herramientas, «Más»).
- **En línea**: `link`. Dentro de una frase o de un aviso («Reintentar», «Abrir Ajustes»).
- **Destructivo**: `destructive` solo en el botón final de un `AlertDialog`. En un menú, la acción destructiva va al final, separada, con texto en `--lh-error`.
- Los diálogos llevan el primario a la derecha y «Cancelar» (`ghost` u `outline`) a su izquierda.
- Etiquetas con verbo en infinitivo y el objeto cuando haga falta: «Crear plan», «Practicar», «Mover a la papelera». Nunca «Aceptar», «OK» o «Enviar» a secas.
- Tamaños: `default` (36 px) en páginas, `sm` (32 px) en cabeceras y tarjetas, `xs` (24 px) solo en filas densas y en el margen.

## Tipografía

- **Escala**: la de `@theme inline` en `globals.css`. Nada de `text-[11px]`, `text-[13px]` ni `text-[0.8125rem]`. Los títulos de página usan `text-3xl` (32 px), no `text-4xl`, que está fuera de la escala.
- **Mínimo 12 px.** `--text-xs` pasa de 11 a 12 px (decisión 1A). Quedan prohibidos 9, 10 y 11 px en cualquier sitio, incluidos los rótulos en mayúsculas.
- **Dos colores de texto**: `foreground` y `muted-foreground`. **Sin opacidad añadida** sobre `muted-foreground` (`/40`, `/50`, `/70`, `/80`): si algo tiene que pesar menos, se quita o se pliega. Excepción única: el `placeholder` de un campo usa `muted-foreground` sin más.
- **Familias**: JetBrains Mono (`font-ui`) en el cromo; la fuente de lectura (`font-sans`, Source Sans 3 por defecto) en la prosa, los campos (`lh-input`) y los textos largos de la interfaz; `font-title` en el título de cada página. No se mezclan dentro de un mismo control.
- **Rótulos de sección** (el «eyebrow» en mayúsculas): `text-xs uppercase tracking-wide text-muted-foreground`, nada más. Se usa poco; un título de sección en `text-sm font-medium` suele bastar.
- Mayúscula solo al principio de frase y en nombres propios («Crear plan», no «Crear Plan»).

## Espaciado, radios y superficies

- **Espaciado**: múltiplos de 4 px de Tailwind. Ritmo habitual: `gap-1`/`gap-2` dentro de un control, `gap-3`/`gap-4` entre controles, `gap-6`/`gap-8` entre secciones, `py-10` en la cabecera de una página.
- **Radios**: `rounded-sm` (4 px) en marcas pequeñas y casillas, `rounded-md` (8 px) en botones, campos y filas, `rounded-lg` (12 px) en tarjetas y popovers, `rounded-xl` (16 px) en diálogos. `rounded-full` solo en interruptores, avatares y fichas de acción.
- **Superficies**: `background` (página), `card` (tarjetas y paneles), `popover` (lo que flota), `accent` (hover y selección). Bordes de 1 px en `border`. Sin sombra salvo en `popover` y `dialog` (`shadow-md`).
- **Color**: siempre por token. Prohibidos los hexadecimales en componentes (los de `agenda.tsx` pasan a tokens `--lh-*`). El acento del tema (`--lh-accent`) se usa para el foco, el interruptor encendido y la selección; no para botones primarios.

## Foco visible

- Todo control interactivo muestra el foco de teclado con **un contorno de 2 px del acento del tema, separado 2 px** (decisión 2B): `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lh-accent)]`. Se aplica una sola vez en la base de cada pieza de `components/ui/` (Button, Input, Textarea, Switch, Select, ToggleGroup…), no en cada uso.
- La regla global de `globals.css` que quita el contorno (`*:focus-visible { outline: none }`) se sustituye: el contorno sigue sin verse con el ratón (`:focus-visible` ya lo distingue) y vuelve con el teclado.
- **Filas de lista** (barra lateral, paleta, menús): fondo `accent` y barra interior de 3 px a la izquierda (decisión 2C), sin contorno.
- El foco nunca se pierde: al cerrar un popover, un diálogo o un menú, vuelve al control que lo abrió (Radix lo hace si se usa la pieza).
- Todo lo que se hace con el ratón se puede hacer con el teclado, y los atajos se ven en `Hint` o en Ajustes › Teclado, no solo en `title`.

## Estados: carga, vacío y error

Cada lectura asíncrona distingue **cuatro estados**: cargando, error, vacío y con datos. Ninguna pantalla se queda en «Cargando…» si la lectura falla.

| Estado | En páginas (decisión 6A) | En la barra lateral, menús y filas (decisión 6B) |
|---|---|---|
| Cargando | `Skeleton` con la forma de lo que viene, tras 300 ms (antes, nada) | Indicador pequeño con texto: «Leyendo el plan…» |
| Error | `Alert` en el sitio del contenido: qué falló, en una frase, y el botón «Reintentar». `role="alert"` | Una línea en `--lh-error` con «Reintentar» como `link` |
| Vacío | Título breve, una frase de qué hacer y, si cabe, el primario de la pantalla («Crear plan») | Una frase con el enlace de la acción |
| Acción en curso | El botón que la lanzó muestra un indicador y queda deshabilitado; el resto de la pantalla sigue usable | Igual |
| Guardado automático | Estado visible: «Guardado», «Guardando…», «No se pudo guardar: …» con «Reintentar». Si falla, se avisa al salir | — |

Las lecturas que se anuncian a lectores de pantalla usan `role="status"`; los errores, `role="alert"`. Los márgenes los pone la pieza, no cada pantalla.

## Textos

- Español de España, tuteo, frases cortas y activas. Vocabulario de `GLOSSARY.md` (espacio, plan, unidad, fuente, tutor…).
- **Sin jerga interna**: nada de identificadores («reconstruir»), nombres de diseño («regulador», «Brier»), términos técnicos del proveedor («endpoint», «tok», «slot») ni inglés. Si una idea técnica es necesaria, se explica con palabras llanas y el detalle se pliega.
- **«tutor»** para el agente en toda la interfaz; nunca «modelo» ni «asistente» cuando se habla de quien enseña.
- Los errores dicen qué pasó y qué hacer, sin culpar: «No se pudo leer el plan. Vuelve a intentarlo».
- Los botones dicen qué harán («Mover a la papelera»); las confirmaciones nombran la consecuencia («ya no podrás cambiarla»).
- Atajos con la notación de la plataforma (`formatBinding`): «Ctrl+K» en Windows.
- Por defecto, respuestas y textos escuetos: una línea antes que un párrafo.

## Inventario: controles hechos a mano que deben pasar a `components/ui/`

Plan, no se migra en esta sesión. Ordenado por impacto (frecuencia × visibilidad × daño a la accesibilidad o a la coherencia). Rutas bajo `components/`.

| # | Patrón | Dónde | Pieza | Problema que arregla |
|---|---|---|---|---|
| 1 | Campos nativos con clases propias y constantes `campo` duplicadas (~20) y campos en línea sin borde (6 + 8 `CommitInput`) | `estudio/editor-cuadernos.tsx:50`, `lector.tsx:233`, `paleta.tsx:260`, `biblioteca.tsx:206`, `inicio.tsx:100,283`, `unidad.tsx:383`, `personaje-cuaderno.tsx:137`, `hilo-margen.tsx:83`, `proposito-cuaderno.tsx:74`; `settings/controls.tsx:233` | `Input`/`Textarea` con `size="sm"` y `variant="ghost"` | Alturas de h-6 a h-9, bordes distintos, sin foco visible, placeholders con opacidad |
| 2 | Dos interruptores distintos: `Toggle` de Ajustes (16 usos) y píldoras con punto de Cuadernos | `settings/controls.tsx:109-171`; `estudio/modo-proactivo.tsx:51-64`, `escuchar-cuaderno.tsx:24-38` | `Switch` | Misma función, dos formas; la explicación solo en `title`; sin foco visible |
| 3 | `<select>` nativo (11) y `ThinSelect` | `estudio/barra-lateral.tsx:417,421,425`, `biblioteca.tsx:266`, `editor-cuadernos.tsx:230,239`, `intento.tsx:272`, `unidad.tsx:152,165,179`; `settings/controls.tsx:190` | `Select` | El menú de Windows no sigue el tema; 11 px en la barra; `outline-none` sin sustituto |
| 4 | Error, carga y vacío como párrafos sueltos (~23 errores, ~11 cargas, ~6 vacíos) | `estudio/barra-lateral.tsx:213,248,297,299`, `biblioteca.tsx:133,138`, `por-decidir.tsx:49,50`, `progreso.tsx:166,168`, `unidad.tsx:119,527`, `agenda.tsx:305,372`… | `Alert`, `Skeleton`, pieza `Empty` | Pantallas en «Cargando…» para siempre; márgenes y tamaños distintos; sin `role="status"` |
| 5 | Botones nativos con clases (30, frente a 66 `Button`) y tres constantes de botón | `estudio/agenda.tsx:187,329`, `biblioteca.tsx:148,244`, `lector.tsx:162`, `inicio.tsx:120`, `unidad.tsx:287,303`, `hilo-margen.tsx:32`, `margen-cuaderno.tsx:77`, `propuestas-margen.tsx:31` | `Button` (`ghost`, `link`, `xs`, `icon-xs`) | Sin foco visible en la mayoría |
| 6 | `window.confirm` (5) | `estudio/biblioteca.tsx:294`, `editor-cuadernos.tsx:1225`, `intento.tsx:465,470`, `personaje-cuaderno.tsx:114` | `AlertDialog` | Diálogo nativo fuera del tema, «Aceptar» genérico, no se puede probar |
| 7 | Popovers con posición calculada a mano | `estudio/margen-cuaderno.tsx:84-135`, `editor-cuadernos.tsx:192-200` | `Popover` (+ `Command` para el «/») | Sin Escape ni gestión de foco; acciones solo en `title` |
| 8 | Chips con `aria-pressed` usados como grupo de elección; etiquetas de estado de 9–10 px | `estudio/agenda.tsx:204-211`, `intento.tsx:282`, `inicio.tsx:256`, `margen-cuaderno.tsx:198`; `barra-lateral.tsx:236,272`, `biblioteca.tsx:150` | `ToggleGroup` segmentado, `Badge` | Sin navegación con flechas; tamaños ilegibles |
| 9 | Paletas de color con `aria-pressed` | `estudio/personaje-cuaderno.tsx:148-158`, `proposito-cuaderno.tsx:57-60` | `RadioGroup` con muestras | Es una elección única; nombre solo en `title` |
| 10 | Plegables a mano | `estudio/contexto-card.tsx:22-32`, `barra-lateral.tsx:445-456` | `Collapsible` | Sin `aria-controls` ni foco visible |
| 11 | Tokens: tamaños sueltos (9/10/11/11,5/13/15 px en ~16 archivos), hexadecimales y opacidades sobre `muted-foreground` | `estudio/agenda.tsx:234-237,337`, `barra-lateral.tsx:236,460`, `hilo-margen.tsx:66,77`, `editor-cuadernos.tsx:51,559`, `inicio.tsx:106`; `settings/controls.tsx:60,77` | Escala y tokens | Contraste y coherencia con los temas |

Orden de trabajo recomendado: el cambio de tokens (`--text-xs` y el foco global) primero, porque arregla toda la app de golpe; luego crear `Switch`, `Select`, `Alert`, `AlertDialog`, `Popover`, `ToggleGroup`, `Badge` y `RadioGroup` en `components/ui/`; después migrar por pantallas, empezando por la cabecera de Cuadernos y la barra lateral, que son las más vistas.

## Fuentes

Reglas tomadas de guías públicas, adaptadas:

| Regla de esta guía | Fuente |
|---|---|
| Un solo primario por vista; en vistas de solo lectura, ninguno; como mucho 2 o 3 acciones por grupo | Carbon, [Button › Usage](https://carbondesignsystem.com/components/button/usage/); Primer, [Button](https://primer.style/product/components/button/) |
| `destructive` solo para destruir, normalmente con confirmación | Primer, [Button](https://primer.style/product/components/button/) |
| Etiquetas de botón con verbo y objeto («Crear plan»), mayúscula solo inicial | Carbon, [Button › Usage](https://carbondesignsystem.com/components/button/usage/); Primer, [Content](https://primer.style/product/getting-started/foundations/content/) |
| Vacío: título breve en positivo, una acción, nunca un callejón sin salida; el vacío sustituye al componente | Carbon, [Empty states](https://carbondesignsystem.com/patterns/empty-states-pattern/); Primer, [Empty states](https://primer.style/product/ui-patterns/empty-states/) |
| Carga: nada por debajo de ~1 s (aquí, 300 ms para el esqueleto); esqueleto solo para áreas de contenido, nunca en botones ni campos; indicador pequeño para el resto; `role="status"` siempre presente | Primer, [Loading](https://primer.style/product/ui-patterns/loading/); Carbon, [Loading](https://carbondesignsystem.com/patterns/loading-pattern/) |
| Error junto a su causa, persistente hasta resolverse, en dos líneas como mucho y diciendo qué hacer; sin avisos flotantes para errores con sitio | Carbon, [Notifications](https://carbondesignsystem.com/patterns/notification-pattern/); Primer, [Notification messaging](https://primer.style/product/ui-patterns/notification-messaging/) |
| Foco con `:focus-visible`; no se quita nunca el indicador sin poner otro; todo operable con teclado | Primer, [Focus management](https://primer.style/accessibility/focus-management/); Carbon, [Keyboard](https://carbondesignsystem.com/guidelines/accessibility/keyboard/). El grosor de 2 px con separación es decisión nuestra: ninguna de las dos guías da un valor |
| 12 px como mínimo, reservado a etiquetas y ayudas, nunca al cuerpo | Carbon, [Type sets](https://carbondesignsystem.com/elements/typography/type-sets/) (`label-01`); Primer, [Typography](https://primer.style/product/primitives/typography/) |
| Voz activa, tuteo, sin humor en errores ni esperas, sin culpar, el mismo término para la misma acción | Primer, [Content](https://primer.style/product/getting-started/foundations/content/) |
