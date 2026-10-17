import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const DESIGN_PORT = 5173;

/** Serves a placeholder image for signed photo URLs in `dev:design` mock mode. */
function mockStorage(): Plugin {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><rect width="160" height="160" fill="#d5d0c3"/><path d="M0 125l42-44 30 30 28-38 60 52v35H0z" fill="#8a8576"/><circle cx="118" cy="44" r="14" fill="#f3f1ea"/></svg>';
  return {
    name: "mock-storage",
    configureServer(server) {
      server.middlewares.use("/__mock/storage", (_request, response) => {
        response.setHeader("content-type", "image/svg+xml");
        response.end(svg);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const design = mode === "design";
  return {
    plugins: [react(), ...(design ? [mockStorage()] : [])],
    // MapLibre v6 loads its worker relative to its own module URL, which breaks
    // when Vite pre-bundles it into .vite/deps.
    optimizeDeps: { exclude: ["maplibre-gl"] },
    build: {
      rollupOptions: {
        // Dev-only code (the mock backend) must never ship. Declaring it free of
        // side effects lets the bundler drop it, since production never calls it.
        treeshake: {
          moduleSideEffects: (id) =>
            !id.replaceAll("\\", "/").includes("/src/dev/"),
        },
      },
    },
    // `vite --mode design` runs the UI against an in-browser mock backend.
    ...(design && {
      server: { port: DESIGN_PORT, strictPort: true },
      define: {
        "import.meta.env.VITE_MOCK": JSON.stringify("true"),
        "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
          `http://127.0.0.1:${DESIGN_PORT}/__mock`,
        ),
        "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("mock"),
        "import.meta.env.VITE_LOCAL_DEMO": JSON.stringify("true"),
      },
    }),
  };
});
