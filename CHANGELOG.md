# Historial de versiones

## 0.5.0 · 2026-09-29 · Laboratorio forense de imagen
- **Laboratorio de píxeles** en el visor: botón «Mejorar píxeles (automático)» que mide la foto y elige los ajustes, y modos Poca luz/sombras, Reflejos y brillos, Rayones finos, Relieve/abolladuras y Máximo forense (×2). Etapas reales sobre una copia: reducción de ruido bilateral, recuperación de sombras (Retinex), relleno de reflejos, contraste local CLAHE, claridad, enfoque con umbral, balance de blancos y ampliación ×2/×3. Ver original ⇄ mejorada.
- **Diagnóstico de calidad** por foto: luz, zonas oscuras, brillos, reflejos, contraste, nitidez, ruido, histograma y recomendaciones.
- **Lupa de píxeles** con valores RGB y coordenadas reales; **Zona ampliada**: recorte de la foto original a máxima resolución, mejorado (ampliar, rayones, relieve, reflejos) para ingreso, salida y reclamación.
- **Buscar novedades** (análisis reforzado): compara original y mejorada, confirma lo que aparece en ambas y clasifica cada zona (rayón, abolladura/deformación, mancha, golpe/fractura, reflejo) con lista de verificación de lo buscado y dibujo de las zonas.
- Visor con imágenes fijas arriba mientras se ajustan las herramientas.
- El informe PDF incorpora el análisis reforzado, la calidad de las fotos y las ampliaciones de la zona principal; motor `vision-local-2`.

## 0.4.0 · 2026-09-29
- Nueva pantalla **Reclamaciones** y expediente por reclamación: zona para cargar fotos (arrastrar, galería o cámara), huella SHA-256, etiqueta de vista y nota por foto; las fotos no se borran.
- Comparación de tres momentos (ingreso, salida, reclamación) por vista y análisis de visión digital (alineación, normalización de luz, mapa de cambios, SSIM, abstención) con veredicto orientativo: indicios / sin indicios / no concluyente.
- Visor con herramientas de mejora: brillo, contraste, gamma, saturación, nitidez, zoom, niveles automáticos, blanco y negro, invertir, bordes y ajustes rápidos (reducir reflejos, aclarar sombras, realzar rayones); modos lado a lado, las tres, cortina y diferencia; marcar zona; preguntas al motor; registro de hallazgos. El original nunca se modifica.
- **Informe PDF de demostración** (botón en expediente y en la Mesa): portada, resumen ejecutivo, datos del caso, cronología, cadena de custodia con hashes, comparación por vista con mapas de calor, hallazgos, metodología y límites, conclusión y firmas. Se guarda con su SHA-256.
- Migración 08: tabla claim_views con RLS y auditoría; política de inserción de comparaciones IA para revisores.
- CSP: img-src admite blob: y supabase.co.

## 0.3.0 · 2026-09-29
- Contraseña temporal con cambio obligatorio: quien entra con una clave temporal debe crear una propia antes de usar la aplicación; la marca se borra sola al cambiarla.
- Equipo y sedes: botón «Clave temporal» por miembro (genera la clave, cierra sus sesiones, la muestra una sola vez y permite enviarla desde el correo del administrador).
- Migración 07: marca en los metadatos de aplicación (no editable por el usuario), disparador que la borra al cambiar la contraseña y registro en auditoría.

## 0.2.2 · 2026-09-29
- Mensaje claro cuando se alcanza el límite de correos por hora y qué hacer mientras tanto.
- Al recuperar la contraseña la pestaña «Ingresar» queda marcada.

## 0.2.1 · 2026-09-29
- «Olvidé mi contraseña»: envía un enlace y abre una pantalla para definir la contraseña nueva (con confirmación).
- «Olvidé mi cuenta»: guía para encontrar el correo con el que te registraste y recuperarlo.
- Botón «Mostrar» en la contraseña, mensajes claros para enlaces vencidos o ya usados y para contraseñas débiles.

## 0.2.0 · 2026-09-29
- Aplicación con menú por rol y selector de sede: Panel, Sesiones, Captura, Mesa de comparación, Hallazgos y reclamaciones, Prompts, Motor IA, Auditoría y Equipo y sedes.
- Captura del Pasaporte Visual (24 vistas) con huella SHA-256 en el dispositivo, subida al bucket privado y estimación de calidad.
- Mesa de comparación: lado a lado, cortina y diferencia; zoom, brillo, contraste, invertir; marcado de zona; preguntas al motor por imagen; registro de hallazgos.
- Revisión humana de hallazgos (aceptar, corregir, rechazar, aprobar) que alimenta el ciclo de aprendizaje.
- Migración 06: agregar y quitar miembros por correo (solo administrador) con registro en auditoría.
- Pestaña «Soy del equipo» para que el personal cree su cuenta antes de ser agregado.

## 0.1.1 · 2026-09-29
- Pestaña «Registrar propietario»: nombre de organización y sede, y la organización se crea sola al confirmar el correo e ingresar.
- Botón «Reenviar correo de confirmación», mensajes claros para límite de correos y cuenta sin confirmar, y enlace de confirmación que regresa a esta página.

## 0.1.0 · 2026-09-29
- Esqueleto de la aplicación: verificación de compatibilidad del navegador, acceso con Supabase Auth y primera organización.
- Esquema inicial de base de datos (5 migraciones): tenencia por organización, sede y rol; sesiones, reclamaciones y evidencia inmutable; 24 vistas canónicas; motor de IA con cola de trabajos, hallazgos, prompts, memoria de casos y ciclo de aprendizaje; auditoría encadenada; almacenamiento privado.
- Despliegue automático a GitHub Pages con verificación de secretos.
