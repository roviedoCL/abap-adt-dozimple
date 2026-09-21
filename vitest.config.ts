import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Los tests nunca tocan el llavero real: la clave del registro de auditoría vive en memoria.
    env: { ABAP_DZ_AUDIT_KEYSTORE: "memory" },
  },
});
