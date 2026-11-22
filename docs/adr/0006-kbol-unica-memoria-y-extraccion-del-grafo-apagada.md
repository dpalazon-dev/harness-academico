---
status: accepted
---

# KBOL es la única memoria del conocimiento y la extracción del grafo se apaga

El ADR 0005 dejó abierto que convivían dos memorias: el grafo de LearnHarness, que su extracción escribe a partir de lo que dice el tutor, y KBOL, que guarda lo que David confirma. El grafo no se muestra en el armazón y Estudio no lo lee, pero con la extracción activa (`graph.enabled`, activo por defecto) cada conversación de enseñanza podía gastar llamadas al modelo barato para hacerlo crecer, y el tutor seguía recibiendo herramientas para consultarlo. La extracción se apaga con ese ajuste, sin tocar el motor: no hacía falta cambiar el agente de enseñanza, como suponía el ADR 0005. KBOL queda como la única memoria del conocimiento, y cualquier vista en forma de grafo se construirá sobre KBOL. Decidido por David el 14 de noviembre de 2026: «Sí, apágala y escribe el ADR», y «en el nuevo harness usamos el sistema de conocimiento de KBOL y es de ahí donde tenemos que hacer el motor de grafos renderizados y demás».

## Opciones consideradas

- **Dejar la extracción activa sin mostrar el grafo**: gasta modelo en una memoria que nadie consulta y que nace de la prosa del tutor, no de lo que David produce y confirma.
- **Integrar el grafo de LearnHarness con las unidades**: mantendría dos fuentes de conocimiento y exige cambiar el agente de enseñanza.

## Consecuencias

- `graph.enabled` es `false` en los ajustes de los datos reales (`datos/`) y en los de prueba (`work/data-sistema-comun`). Con el interruptor apagado no hay extracción ni auditor, y el tutor pierde sus herramientas del grafo (`graphToolsEnabled` exige el interruptor). Es reversible desde Ajustes > Apariencia > «Extraction».
- El código del grafo de LearnHarness (extracción, almacén, `graph-view`, `Home`) se queda en el repositorio, inactivo. Retirarlo se decidiría aparte.
- Dirección propuesta por David, sin diseñar: un motor de grafo sobre KBOL que reutilice la forma de visualizar el grafo de LearnHarness. Partiría de las notas atómicas y de los enlaces que ya existen entre ellas para formar grupos, después grupos de grupos, y así sucesivamente hasta una jerarquía de temas. Al abrir el grafo se verían los grupos de nivel superior, y al acercarse se irían pintando los subgrupos hasta llegar a las notas atómicas. Los registros KBOL ya se enlazan entre sí por `basada_en`, `afecta_a`, `dependencias` y `derivada_de`, que el plugin lee hoy para la búsqueda (`plugins/estudio/src/kb/corpus.ts`). Quedan por decidir qué cuenta como nota atómica, cómo se forman y se nombran los grupos y dónde vive esa vista en el armazón.
