/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PAPERCLIP_LANGFUSE_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

