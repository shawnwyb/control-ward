import { installMockBackend } from "./mockBackend";

// Imported first in main.tsx so the mock is in place before the Supabase client
// captures `fetch`. The condition is statically false in production builds, so
// the mock is tree-shaken out.
if (import.meta.env.DEV && import.meta.env.VITE_MOCK === "true")
  installMockBackend();
