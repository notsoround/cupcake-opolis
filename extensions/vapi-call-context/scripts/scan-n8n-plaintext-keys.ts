/**
 * READ-ONLY. Lists n8n workflows that carry plaintext X-Cupcake-* webhook keys.
 *
 *   node --import ./scripts/tsx.mjs \
 *     extensions/vapi-call-context/scripts/scan-n8n-plaintext-keys.ts [--db /root/.n8n/database.sqlite] [--json]
 *
 * Opens SQLite with readOnly: true (no WAL writes, no locks taken for writing). Prints
 * workflow, node, header name and a 12-char fingerprint; never a key value. Exit code 1
 * when any plaintext key is found, 0 when clean.
 */
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { scanN8nDatabase } from "../src/n8n-key-scan.js";

const { values } = parseArgs({
  options: {
    db: { type: "string", default: "/root/.n8n/database.sqlite" },
    json: { type: "boolean", default: false },
  },
});

const db = new DatabaseSync(String(values.db), { readOnly: true });
try {
  const findings = scanN8nDatabase(db);
  if (values.json) {
    process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`);
  } else if (findings.length === 0) {
    process.stdout.write("clean: no plaintext X-Cupcake-* keys in n8n workflows\n");
  } else {
    for (const f of findings) {
      process.stdout.write(
        `${f.active ? "ACTIVE  " : "inactive"} ${f.workflowId} "${f.workflowName}" / ${f.node}: ${f.header} (${f.location}, sha256:${f.fingerprint})\n`,
      );
    }
    process.stdout.write(`${findings.length} plaintext key reference(s) found\n`);
  }
  process.exitCode = findings.length ? 1 : 0;
} finally {
  db.close();
}
