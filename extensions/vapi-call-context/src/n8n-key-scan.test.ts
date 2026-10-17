import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { fingerprint, scanN8nDatabase, scanWorkflowNodes } from "./n8n-key-scan.js";

// Synthetic placeholder values; nothing here is a real key.
const HEADER_VALUE = "placeholder-header-value-aaaa";
const CODE_VALUE = "placeholder-code-value-bbbb";

const nodes = [
  {
    name: "Post Commitment Charge",
    parameters: {
      headerParameters: {
        parameters: [
          { name: "Content-Type", value: "application/json" },
          { name: "X-Cupcake-Key", value: HEADER_VALUE },
        ],
      },
    },
  },
  {
    name: "Build Vapi Body",
    parameters: {
      jsCode: `const body = {"server": {"headers": {"X-Cupcake-Brain-Key": "${CODE_VALUE}"}}};`,
    },
  },
  {
    name: "Env-backed",
    parameters: {
      headerParameters: {
        parameters: [{ name: "X-Cupcake-Key", value: "={{ $env.CUPCAKE_KEY }}" }],
      },
    },
  },
];

describe("n8n plaintext key scan", () => {
  it("finds header parameters and keys embedded in Code nodes, never returning values", () => {
    const findings = scanWorkflowNodes({ id: "wf1", name: "Matts Mpesa", active: true, nodes });
    expect(findings).toEqual([
      expect.objectContaining({
        node: "Post Commitment Charge",
        header: "X-Cupcake-Key",
        location: "header-parameter",
        fingerprint: fingerprint(HEADER_VALUE),
      }),
      expect.objectContaining({
        node: "Build Vapi Body",
        header: "X-Cupcake-Brain-Key",
        location: "embedded-code",
        fingerprint: fingerprint(CODE_VALUE),
      }),
    ]);
    const serialized = JSON.stringify(findings);
    expect(serialized).not.toContain(HEADER_VALUE);
    expect(serialized).not.toContain(CODE_VALUE);
  });

  it("scans every workflow row from an n8n database", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE workflow_entity (id TEXT, name TEXT, active INTEGER, nodes TEXT)");
    db.prepare("INSERT INTO workflow_entity VALUES (?, ?, ?, ?)").run(
      "wf1",
      "A",
      1,
      JSON.stringify(nodes),
    );
    db.prepare("INSERT INTO workflow_entity VALUES (?, ?, ?, ?)").run("wf2", "B", 0, "not json");
    expect(scanN8nDatabase(db).map((f) => f.workflowId)).toEqual(["wf1", "wf1"]);
    db.close();
  });
});
