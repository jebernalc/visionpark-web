# Historial de versiones

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
