/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" in the demo build (no server; data stays in the browser). */
  readonly VITE_DEMO?: string;
  /** Repository link shown in the demo banner. */
  readonly VITE_REPO_URL?: string;
}
