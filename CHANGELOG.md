# Historial de versiones

## 0.1.1 · 2026-09-29
- Pestaña «Registrar propietario»: nombre de organización y sede, y la organización se crea sola al confirmar el correo e ingresar.
- Botón «Reenviar correo de confirmación», mensajes claros para límite de correos y cuenta sin confirmar, y enlace de confirmación que regresa a esta página.

## 0.1.0 · 2026-09-29
- Esqueleto de la aplicación: verificación de compatibilidad del navegador, acceso con Supabase Auth y primera organización.
- Esquema inicial de base de datos (5 migraciones): tenencia por organización, sede y rol; sesiones, reclamaciones y evidencia inmutable; 24 vistas canónicas; motor de IA con cola de trabajos, hallazgos, prompts, memoria de casos y ciclo de aprendizaje; auditoría encadenada; almacenamiento privado.
- Despliegue automático a GitHub Pages con verificación de secretos.
