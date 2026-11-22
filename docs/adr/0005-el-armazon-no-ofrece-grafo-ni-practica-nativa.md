---
status: accepted
---

# El armazón no ofrece el grafo ni la práctica nativa de LearnHarness

El núcleo de LearnHarness trae su propio grafo de conocimiento, que escriben las conversaciones de enseñanza y que era su portada, y su propia conversación de práctica adaptativa. Estudio no usa el grafo (sus unidades tienen `graphNodeIds` siempre vacío) y guarda el conocimiento confirmado en KBOL; además, dos registros de práctica romperían el objetivo O3 de una única evidencia. El armazón nuevo no muestra el grafo ni ofrece la práctica nativa: toda práctica pasa por los intentos de Estudio. El grafo no se desmonta, porque desactivar sus escrituras o integrarlo con las unidades es un cambio del agente de enseñanza, no de interfaz. Decidido por David el 12 de noviembre de 2026.

## Consecuencias

- Quedan dos memorias en paralelo (el grafo que escribe el tutor nativo y KBOL). Es un problema abierto que se decidirá aparte. Resuelto en el ADR 0006 (14 de noviembre de 2026): KBOL es la única memoria y la extracción del grafo se apaga.
