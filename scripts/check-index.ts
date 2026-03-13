import { Index } from "@upstash/vector";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const index = new Index();

async function main() {
  const stats = await index.info();
  console.log("\n📊 Upstash Vector Index Stats:");
  console.log(`   Vector count:  ${stats.vectorCount}`);
  console.log(`   Pending count: ${stats.pendingVectorCount}`);
  console.log(`   Dimension:     ${stats.dimension}`);
  console.log(`   Similarity:    ${stats.similarityFunction}`);

  // Spot-check: fetch a known slug
  const sample = await index.fetch(["two-sum", "sliding-window-maximum", "merge-intervals"], {
    includeMetadata: true,
  });
  console.log("\n🔍 Spot check (3 slugs):");
  sample.forEach((r) => {
    if (r) {
      console.log(`   ✓ ${r.id} — "${(r.metadata as { title: string }).title}" (${(r.metadata as { difficulty: string }).difficulty})`);
    } else {
      console.log(`   ✗ not found`);
    }
  });
}

main().catch(console.error);
