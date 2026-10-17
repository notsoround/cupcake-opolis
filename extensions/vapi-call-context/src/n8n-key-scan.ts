/**
 * Read-only scanner for plaintext Cupcake webhook keys inside n8n workflow definitions
 * (`X-Cupcake-Key`, `X-Cupcake-Brain-Key`, any `X-Cupcake-*` header). It reports where
 * each key lives and a short SHA-256 fingerprint so keys can be matched against the new
 * env/credential store without ever printing a value.
 */
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type KeyFinding = {
  workflowId: string;
  workflowName: string;
  active: boolean;
  node: string;
  header: string;
  /** First 12 hex chars of sha256(value). Never the value itself. */
  fingerprint: string;
  location: "header-parameter" | "embedded-code";
};

const HEADER_NAME = /^x-cupcake[-a-z]*$/i;
const EMBEDDED = /["']?(x-cupcake[-a-z]*)["']?\s*:\s*["']([^"'\\\s]{8,})["']/gi;

export function fingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
}

/** An n8n expression that reads env/credentials is not a plaintext key. */
function isIndirect(value: string): boolean {
  return /^=?\s*\{\{[\s\S]*\$(env|credentials|vars)\b/.test(value);
}

function walk(value: unknown, visit: (node: unknown) => void): void {
  visit(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, visit);
    }
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      walk(item, visit);
    }
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function scanWorkflowNodes(workflow: {
  id: string;
  name: string;
  active: boolean;
  nodes: unknown;
}): KeyFinding[] {
  const findings: KeyFinding[] = [];
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  for (const node of nodes) {
    if (!isPlainRecord(node)) {
      continue;
    }
    const nodeName = typeof node.name === "string" ? node.name : "?";
    const seen = new Set<string>();
    const add = (header: string, value: string, location: KeyFinding["location"]) => {
      if (isIndirect(value)) {
        return;
      }
      const fp = fingerprint(value);
      const key = `${header.toLowerCase()}:${fp}:${location}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      findings.push({
        workflowId: workflow.id,
        workflowName: workflow.name,
        active: workflow.active,
        node: nodeName,
        header,
        fingerprint: fp,
        location,
      });
    };
    walk(node.parameters, (item) => {
      if (isPlainRecord(item)) {
        const record = item;
        if (
          typeof record.name === "string" &&
          HEADER_NAME.test(record.name) &&
          typeof record.value === "string" &&
          record.value.length >= 8
        ) {
          add(record.name, record.value, "header-parameter");
        }
      } else if (typeof item === "string" && /x-cupcake/i.test(item)) {
        for (const match of item.matchAll(EMBEDDED)) {
          const [, header, value] = match;
          if (header && value) {
            add(header, value, "embedded-code");
          }
        }
      }
    });
  }
  return findings;
}

/** Scan every workflow row. The caller must open the database read-only. */
export function scanN8nDatabase(db: DatabaseSync): KeyFinding[] {
  const rows = db
    .prepare("SELECT id, name, active, nodes FROM workflow_entity ORDER BY name")
    .all();
  const findings: KeyFinding[] = [];
  for (const row of rows) {
    let nodes: unknown;
    try {
      nodes = JSON.parse(String(row.nodes ?? "[]"));
    } catch {
      nodes = [];
    }
    findings.push(
      ...scanWorkflowNodes({
        id: String(row.id),
        name: String(row.name),
        active: Number(row.active) === 1,
        nodes,
      }),
    );
  }
  return findings;
}
