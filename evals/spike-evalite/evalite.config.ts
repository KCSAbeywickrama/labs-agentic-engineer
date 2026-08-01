import { defineConfig } from "evalite/config";

// A full simulated /start interview is many real model turns.
export default defineConfig({
  testTimeout: 900_000,
});
