import fs from "node:fs/promises";
import path from "node:path";
import type { ToolResult } from "@paperclipai/plugin-sdk";
import type { BrainRoots } from "./brain-paths.js";
import { agentBrainDir } from "./brain-paths.js";
import type { ObsidianBrainConfig } from "./config.js";

const INDEX_VERSION = 1;
const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_MAX_CHUNK = 720;
const TOP_K_MAX = 15;

export type SemanticIndexChunk = {
  relFromCompany: string;
  chunkIndex: number;
  text: string;
  embedding: number[];
};

export type SemanticIndexFile = {
  version: number;
  modelId: string;
  updatedAt: string;
  chunks: SemanticIndexChunk[];
};

function indexPath(roots: BrainRoots): string {
  return path.join(roots.companyBrainBase, ".semantic-index", "chunks.json");
}

/** @public — exported for unit tests */
export function chunkMarkdown(raw: string, maxChars: number): string[] {
  const paras = raw
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  let buf = "";
  for (const p of paras) {
    if (buf.length + p.length + 2 <= maxChars) {
      buf = buf ? `${buf}\n\n${p}` : p;
    } else {
      if (buf) out.push(buf);
      if (p.length <= maxChars) {
        buf = p;
      } else {
        for (let i = 0; i < p.length; i += maxChars) {
          out.push(p.slice(i, i + maxChars));
        }
        buf = "";
      }
    }
  }
  if (buf) out.push(buf);
  return out.length > 0 ? out : raw.trim() ? [raw.trim().slice(0, maxChars)] : [];
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}

const extractorPromises = new Map<string, Promise<(text: string, options: object) => Promise<unknown>>>();

async function getExtractor(modelId: string): Promise<(text: string, options: object) => Promise<unknown>> {
  let p = extractorPromises.get(modelId);
  if (!p) {
    p = (async () => {
      const { pipeline } = await import("@xenova/transformers");
      return pipeline("feature-extraction", modelId) as Promise<(text: string, options: object) => Promise<unknown>>;
    })();
    extractorPromises.set(modelId, p);
  }
  return p;
}

async function embedText(text: string, modelId: string): Promise<number[]> {
  const extractor = await getExtractor(modelId);
  const out = await extractor(text, { pooling: "mean", normalize: true });
  const data = (out as { data?: Float32Array }).data;
  if (!data) {
    throw new Error("Embedding pipeline returned no data tensor");
  }
  return Array.from(data);
}

async function loadIndex(roots: BrainRoots): Promise<SemanticIndexFile> {
  const p = indexPath(roots);
  try {
    const raw = await fs.readFile(p, "utf-8");
    const parsed = JSON.parse(raw) as SemanticIndexFile;
    if (!parsed.chunks || !Array.isArray(parsed.chunks)) {
      return { version: INDEX_VERSION, modelId: DEFAULT_MODEL, updatedAt: new Date().toISOString(), chunks: [] };
    }
    return parsed;
  } catch {
    return { version: INDEX_VERSION, modelId: DEFAULT_MODEL, updatedAt: new Date().toISOString(), chunks: [] };
  }
}

async function saveIndex(roots: BrainRoots, index: SemanticIndexFile): Promise<void> {
  const p = indexPath(roots);
  await fs.mkdir(path.dirname(p), { recursive: true });
  index.updatedAt = new Date().toISOString();
  await fs.writeFile(p, JSON.stringify(index, null, 0), "utf-8");
}

async function walkMdFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.name.toLowerCase().endsWith(".md")) {
        out.push(full);
      }
    }
  }
  await walk(rootDir);
  return out;
}

function relFromCompany(absFile: string, companyBrainBase: string): string {
  const rel = path.relative(companyBrainBase, absFile);
  return rel.replace(/\\/g, "/");
}

async function indexOneFile(
  index: SemanticIndexFile,
  absFile: string,
  relFromCompany: string,
  modelId: string,
  maxChunk: number,
): Promise<void> {
  const text = await fs.readFile(absFile, "utf-8");
  const parts = chunkMarkdown(text, maxChunk);
  index.chunks = index.chunks.filter((c) => c.relFromCompany !== relFromCompany);
  let idx = 0;
  for (const part of parts) {
    if (!part.trim()) continue;
    const embedding = await embedText(part.slice(0, 8000), modelId);
    index.chunks.push({
      relFromCompany,
      chunkIndex: idx,
      text: part,
      embedding,
    });
    idx += 1;
  }
}

export async function reindexSemanticScope(
  cfg: ObsidianBrainConfig,
  roots: BrainRoots,
  agentId: string,
  scope: "agent" | "common" | "full",
): Promise<{ indexedFiles: number; chunkCount: number }> {
  const modelId = cfg.embeddingModelId?.trim() || DEFAULT_MODEL;
  const maxChunk = typeof cfg.maxChunkChars === "number" && cfg.maxChunkChars > 0 ? cfg.maxChunkChars : DEFAULT_MAX_CHUNK;
  let index = await loadIndex(roots);
  index.modelId = modelId;
  index.version = INDEX_VERSION;

  const toIndex: { abs: string; rel: string }[] = [];

  if (scope === "agent" || scope === "full") {
    const files =
      scope === "full"
        ? await walkMdFiles(roots.agentRoot)
        : await walkMdFiles(path.join(roots.agentRoot, agentId));
    for (const abs of files) {
      toIndex.push({ abs, rel: relFromCompany(abs, roots.companyBrainBase) });
    }
  }
  if (scope === "common" || scope === "full") {
    const files = await walkMdFiles(roots.commonRoot);
    for (const abs of files) {
      toIndex.push({ abs, rel: relFromCompany(abs, roots.companyBrainBase) });
    }
  }

  if (scope === "agent") {
    index.chunks = index.chunks.filter((c) => !c.relFromCompany.startsWith(`agents/${agentId}/`));
  } else if (scope === "common") {
    index.chunks = index.chunks.filter((c) => !c.relFromCompany.startsWith("common/"));
  } else {
    index.chunks = [];
  }

  for (const { abs, rel } of toIndex) {
    await indexOneFile(index, abs, rel, modelId, maxChunk);
  }

  await saveIndex(roots, index);
  return { indexedFiles: toIndex.length, chunkCount: index.chunks.length };
}

export async function reindexSingleAgentFile(
  cfg: ObsidianBrainConfig,
  roots: BrainRoots,
  agentId: string,
  relativePath: string,
): Promise<void> {
  if (cfg.semanticSearchEnabled === false) return;
  const modelId = cfg.embeddingModelId?.trim() || DEFAULT_MODEL;
  const maxChunk = typeof cfg.maxChunkChars === "number" && cfg.maxChunkChars > 0 ? cfg.maxChunkChars : DEFAULT_MAX_CHUNK;
  const norm = relativePath.replace(/\\/g, "/").trim().replace(/^\/+/, "");
  if (!norm || /^common\//i.test(norm)) return;
  const abs = path.join(agentBrainDir(roots, agentId), norm);
  let index = await loadIndex(roots);
  index.modelId = modelId;
  const relFromCompany = `agents/${agentId}/${norm}`;
  try {
    const st = await fs.stat(abs);
    if (!st.isFile()) return;
  } catch {
    index.chunks = index.chunks.filter((c) => c.relFromCompany !== relFromCompany);
    await saveIndex(roots, index);
    return;
  }
  await indexOneFile(index, abs, relFromCompany, modelId, maxChunk);
  await saveIndex(roots, index);
}

export async function reindexSingleCommonFile(
  cfg: ObsidianBrainConfig,
  roots: BrainRoots,
  relativePath: string,
): Promise<void> {
  if (cfg.semanticSearchEnabled === false) return;
  const modelId = cfg.embeddingModelId?.trim() || DEFAULT_MODEL;
  const maxChunk = typeof cfg.maxChunkChars === "number" && cfg.maxChunkChars > 0 ? cfg.maxChunkChars : DEFAULT_MAX_CHUNK;
  const norm = relativePath.replace(/\\/g, "/").trim().replace(/^\/+/, "").replace(/^common\//i, "");
  if (!norm) return;
  const abs = path.join(roots.commonRoot, norm);
  let index = await loadIndex(roots);
  index.modelId = modelId;
  const relFromCompany = `common/${norm}`;
  try {
    const st = await fs.stat(abs);
    if (!st.isFile()) return;
  } catch {
    index.chunks = index.chunks.filter((c) => c.relFromCompany !== relFromCompany);
    await saveIndex(roots, index);
    return;
  }
  await indexOneFile(index, abs, relFromCompany, modelId, maxChunk);
  await saveIndex(roots, index);
}

export async function runSemanticSearch(
  cfg: ObsidianBrainConfig,
  roots: BrainRoots,
  agentId: string,
  params: Record<string, unknown>,
): Promise<ToolResult> {
  if (cfg.semanticSearchEnabled === false) {
    return { error: "Semantic search is disabled in Obsidian Brain plugin settings (semanticSearchEnabled)." };
  }
  const query = typeof params.query === "string" ? params.query.trim() : "";
  if (!query) {
    return { error: "query is required" };
  }
  const scopeRaw = String(params.scope ?? "agent").toLowerCase();
  const scope = scopeRaw === "common" ? "common" : scopeRaw === "both" ? "both" : "agent";
  let topK = typeof params.topK === "number" && params.topK > 0 ? Math.floor(params.topK) : 5;
  topK = Math.min(topK, TOP_K_MAX);
  const reindexFirst = params.reindexFirst === true;

  const modelId = cfg.embeddingModelId?.trim() || DEFAULT_MODEL;

  try {
    if (reindexFirst) {
      await reindexSemanticScope(cfg, roots, agentId, scope === "both" ? "full" : scope);
    }

    let index = await loadIndex(roots);
    if (index.chunks.length === 0) {
      await reindexSemanticScope(cfg, roots, agentId, scope === "both" ? "full" : scope);
      index = await loadIndex(roots);
    }

    const qEmb = await embedText(query.slice(0, 8000), modelId);

    const matches: { score: number; relFromCompany: string; chunkIndex: number; text: string }[] = [];
    for (const ch of index.chunks) {
      if (scope === "agent") {
        if (!ch.relFromCompany.startsWith(`agents/${agentId}/`)) continue;
      } else if (scope === "common") {
        if (!ch.relFromCompany.startsWith("common/")) continue;
      } else {
        if (!(ch.relFromCompany.startsWith(`agents/${agentId}/`) || ch.relFromCompany.startsWith("common/"))) {
          continue;
        }
      }
      const score = cosineSimilarity(qEmb, ch.embedding);
      matches.push({
        score,
        relFromCompany: ch.relFromCompany,
        chunkIndex: ch.chunkIndex,
        text: ch.text,
      });
    }

    matches.sort((a, b) => b.score - a.score);
    const top = matches.slice(0, topK);

    const lines = top.map(
      (m, i) =>
        `${i + 1}. score=${m.score.toFixed(4)} path=${m.relFromCompany}#${m.chunkIndex}\n---\n${m.text.slice(0, 2000)}`,
    );

    return {
      content:
        top.length === 0
          ? "No indexed chunks matched this scope. Run obsidian_brain.reindex_semantic or write notes first."
          : `Semantic search (${scope}, top ${top.length}):\n\n${lines.join("\n\n")}`,
      data: {
        scope,
        topK: top.length,
        results: top.map((m) => ({
          score: m.score,
          relFromCompany: m.relFromCompany,
          chunkIndex: m.chunkIndex,
          text: m.text,
        })),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `semantic search failed: ${msg}` };
  }
}
