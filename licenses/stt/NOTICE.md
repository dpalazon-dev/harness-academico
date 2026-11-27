# Dictado local: componentes de terceros

HarnessAcademico incluye, en `resources/stt`, un motor de reconocimiento de voz que funciona sin conexión.

## whisper.cpp (`bin/`)

Programa `parakeet-cli` y bibliotecas `parakeet` y `ggml`, de [whisper.cpp](https://github.com/ggml-org/whisper.cpp), versión `b5907`.
Copyright (c) 2023-2026 The ggml authors. Licencia MIT: ver `whisper.cpp-LICENSE.txt`.

## Parakeet TDT 0.6B v3 (`models/ggml-parakeet-tdt-0.6b-v3-q8_0.bin`)

- Modelo original: [nvidia/parakeet-tdt-0.6b-v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), de NVIDIA, con licencia [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).
- Modificación: conversión al formato GGUF y cuantización a 8 bits (`q8_0`) por ggml-org, publicada en [ggml-org/parakeet-GGUF](https://huggingface.co/ggml-org/parakeet-GGUF) con licencia MIT.

HarnessAcademico distribuye el archivo convertido sin otros cambios.
