---
paths:
  - "src/modules/transformations/**"
  - "src/modules/storage/**"
  - "src/**/*storage*.ts"
---

# File transformation & storage rules (spec §5)

- Process files as **streams** (`stream.pipeline`) — never buffer a whole upload or output in memory.
- Enforce the 30 s hard timeout (abort the pipeline, respond 504 `gateway_timeout`) and max upload size
  (abort immediately, 413 `payload_too_large`).
- Validate MIME type **and** extension against an explicit allowlist → 415 `unsupported_media_type`.
- YAML: safe schema only (no custom tags / class construction). XML: disable external entities and DTD loading.
- Images: max 4096×4096 input and output (400 otherwise), set decoder pixel limits against decompression bombs,
  strip EXIF, flatten alpha onto white for JPEG output. SVG is input-only; sanitise (`<script>`, `on*=` attributes,
  external URIs) before rasterising.
- All file I/O goes through the `StorageAdapter` interface (`local-storage` for dev/test, `s3-storage` for prod);
  services never touch `fs` or the S3 SDK directly. Storage keys are cryptographically random and never exposed
  to clients.
