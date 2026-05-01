/**
 * Xenova RAG 경로 vs RAG 이전(파일·청킹만) 대략 비교용 벤치마크.
 * 실행: repo 루트에서
 *   pnpm exec tsx packages/plugins/plugin-obsidian-brain/scripts/profile-xenova-rag.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { pipeline } from "@xenova/transformers";
import { chunkMarkdown } from "../src/semantic-search.js";

const MODEL = "Xenova/all-MiniLM-L6-v2";
const DIM = 384;

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

function randVec(): number[] {
  const v: number[] = [];
  for (let i = 0; i < DIM; i++) v.push(Math.random() * 2 - 1);
  return v;
}

async function main(): Promise<void> {
  const lines: string[] = [];
  const stamp = new Date().toISOString();
  const log = (s: string) => {
    lines.push(s);
    console.log(s);
  };

  log(`=== Xenova RAG 프로파일 (${stamp}) ===`);
  log(`Node ${process.version} | model ${MODEL}`);
  log("");

  log("--- 1) RAG 이전에 해당하는 비용(추정) ---");
  log("이전: obsidian_brain.read / list 로 전체 또는 큰 파일을 읽어 컨텍스트에 넣는 방식.");
  log("임베딩·벡터 인덱스 없음 → ML 로딩 0, 디스크 I/O + 토큰 비용이 병목.");
  log("");

  const sampleMd = [
    "# 제목\n\n" + "문단 내용입니다. ".repeat(80),
    "## 섹션\n\n" + "- 항목\n".repeat(40),
    "### 세부\n\n" + "`코드`와 설명. ".repeat(60),
  ].join("\n\n");

  const tChunk0 = performance.now();
  const chunks = chunkMarkdown(sampleMd, 720);
  const tChunk1 = performance.now();
  log(`chunkMarkdown(${sampleMd.length} chars → ${chunks.length} chunks): ${(tChunk1 - tChunk0).toFixed(3)} ms`);

  log(`(참고) 순수 CPU 청킹은 보통 <1–5 ms 수준; 실제 에이전트는 파일 크기에 비례한 read + LLM 토큰 비용이 지배적.`);
  log("");

  log("--- 2) RAG 이후: 벡터 검색 단계(임베딩 제외) CPU ---");
  const query = randVec();
  const corpus = Array.from({ length: 500 }, () => randVec());
  const tCos0 = performance.now();
  const scores = corpus.map((c) => cosineSimilarity(query, c));
  scores.sort((a, b) => b - a);
  const tCos1 = performance.now();
  log(`cosineSimilarity × ${corpus.length} chunks (${DIM}d): ${(tCos1 - tCos0).toFixed(3)} ms`);
  log("");

  log("--- 3) Xenova @xenova/transformers 파이프라인 ---");
  const tPipe0 = performance.now();
  const extractor = await pipeline("feature-extraction", MODEL);
  const tPipe1 = performance.now();
  log(`pipeline('feature-extraction') 첫 로드(모델 캐시 있으면 빨라짐): ${(tPipe1 - tPipe0).toFixed(1)} ms`);

  const embed = (text: string) => extractor(text, { pooling: "mean", normalize: true }) as Promise<{ data: Float32Array }>;

  const warmQueries = ["짧은 질의", "Obsidian Brain semantic search scope agent", sampleMd.slice(0, 2000)];
  for (let i = 0; i < warmQueries.length; i++) {
    const t0 = performance.now();
    const out = await embed(warmQueries[i]);
    const t1 = performance.now();
    log(`  embed[${i}] len=${warmQueries[i].length} → dim=${out.data.length}: ${(t1 - t0).toFixed(1)} ms`);
  }

  const shortBatch = chunks.slice(0, Math.min(8, chunks.length)).map((c, i) => `chunk${i}: ${c.slice(0, 400)}`);
  const tBatch0 = performance.now();
  for (const s of shortBatch) {
    await embed(s);
  }
  const tBatch1 = performance.now();
  log(`연속 embed ${shortBatch.length}개(재인덱스 시 청크당 1회에 해당): 총 ${(tBatch1 - tBatch0).toFixed(1)} ms (평균 ${((tBatch1 - tBatch0) / shortBatch.length).toFixed(1)} ms/청크)`);
  log("");

  log("--- 4) 요약: 이전 vs Xenova RAG ---");
  log("| 항목 | RAG 이전 | Xenova RAG 이후 |");
  log("|------|----------|-----------------|");
  log("| 검색 단위 | 파일/경로 단위 read | 청크 + 코사인 유사도 |");
  log("| 서버 ML | 없음 | @xenova/transformers (WASM/ONNX) |");
  log("| 디스크 인덱스 | 없음(또는 별도 검색 앱) | .semantic-index/chunks.json |");
  log("| 쿼리 지연 | 네트워크+디스크+LLM | + 쿼리 임베딩(~수–수십 ms~, 콜드는 모델 로드 초 단위 가능) |");
  log("| 재인덱스 | 해당 없음 | 청크 수 × 임베딩 시간 + JSON 저장 |");
  log("");
  log("끝.");

  const dir = path.dirname(fileURLToPath(import.meta.url));
  const outFile = path.join(dir, `xenova-rag-profile-${stamp.replace(/[:.]/g, "-")}.log`);
  await fs.writeFile(outFile, lines.join("\n"), "utf-8");
  log(`\n로그 저장: ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
