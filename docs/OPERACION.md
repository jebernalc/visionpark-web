# Guía de operación

## Entornos

| Elemento | Dónde vive |
| --- | --- |
| Sitio web | GitHub Pages (rama `main`) |
| Base de datos, Auth, Storage, Realtime | Proyecto Supabase `visionpark` (región São Paulo) |
| Trabajadores de IA | Servidor GPU privado, repositorio `visionpark-ai` (privado) |

## Cómo llega un análisis a la GPU

1. El navegador sube la foto al bucket privado `evidence` con la ruta `organización/sede/sesión/archivo` y registra la fila en `evidence_files` con su hash SHA-256.
2. Un disparador crea el trabajo en `inference_jobs`.
3. El trabajador de GPU llama a `claim_next_job(worker, tarea)` (solo con la clave de servicio, guardada en el servidor GPU) y procesa.
4. Los resultados se escriben en `ai_detections`, `ai_comparisons` y `findings`; Realtime avisa al navegador.
5. Ningún resultado es oficial hasta que un revisor lo pasa de `AI_GENERATED` a `HUMAN_REVIEWED` y luego a `APPROVED`.

## Reglas que no se rompen

- Los originales son inmutables: la base de datos rechaza `UPDATE` (salvo hash del servidor y sello de tiempo) y `DELETE` sobre `evidence_files`.
- La auditoría es de solo inserción y encadena cada registro con el hash del anterior.
- Las migraciones nunca se editan después de aplicadas: se crea una nueva.
- La clave de servicio nunca entra a este repositorio.

## Pendientes antes de operar con datos reales

- Activar protección de contraseñas filtradas y verificación en dos pasos en Supabase Auth.
- Definir la política de retención por tipo de caso con el concepto jurídico.
- Elegir el mecanismo de sello de tiempo (RFC 3161) y el espejo de evidencia con bloqueo de objetos.
