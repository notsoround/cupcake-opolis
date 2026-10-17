/**
 * Cupcake Task Queue — async background task management
 * ────────────────────────────────────────────────────────────────────────────
 * When a task is estimated to take >10 seconds (or is explicitly flagged as
 * long-running), Cupcake delegates it to a background worker so the main
 * agent stays responsive. Results are delivered back to the originating channel.
 *
 * Usage:
 *   import { taskQueue } from "./task-queue.js";
 *   const taskId = await taskQueue.enqueue({
 *     description: "Research competitors in the SaaS space",
 *     prompt: "Do a deep research on...",
 *     channel: "telegram",
 *     replyTo: { chat_id: 123, message_id: 456 },
 *     estimatedSeconds: 60,
 *   });
 *
 * Env vars:
 *   CUPCAKE_TASK_QUEUE_MAX_CONCURRENT=3   — max parallel background tasks (default: 3)
 *   CUPCAKE_TASK_QUEUE_TIMEOUT_MS=300000  — task timeout in ms (default: 5 minutes)
 */

import { emitActivity } from "../logging/activity-log.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("cupcake/task-queue");

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "timeout" | "cancelled";

export type TaskPriority = "low" | "normal" | "high";

export type TaskReplyTarget = {
  /** Channel to deliver result on (telegram, slack, web, etc.) */
  channel: string;
  /** Channel-specific reply metadata (chat_id, thread_id, etc.) */
  chat_id?: number;
  thread_id?: number;
  message_id?: number;
  user_id?: number;
  session_id?: string;
};

export type BackgroundTask = {
  id: string;
  /** Human description for logging/notification */
  description: string;
  /** The full prompt to run in the background agent session */
  prompt: string;
  /** Where to deliver the result */
  replyTo: TaskReplyTarget;
  /** Estimated runtime in seconds (used for queue prioritization) */
  estimatedSeconds?: number;
  priority: TaskPriority;
  status: TaskStatus;
  createdAtMs: number;
  startedAtMs?: number;
  completedAtMs?: number;
  /** The agent's response text */
  result?: string;
  /** Error message if failed */
  error?: string;
  /** Number of retry attempts */
  attempts: number;
  maxAttempts: number;
};

export type TaskEnqueueOptions = {
  description: string;
  prompt: string;
  replyTo: TaskReplyTarget;
  estimatedSeconds?: number;
  priority?: TaskPriority;
  maxAttempts?: number;
};

// ─── Task runner (executes via openclaw subagent CLI) ─────────────────────────

type TaskRunner = (task: BackgroundTask) => Promise<string>;

let customRunner: TaskRunner | null = null;

/** Register a custom task runner (e.g., OpenClaw agent runner). */
export function registerTaskRunner(runner: TaskRunner): void {
  customRunner = runner;
  log.info("Custom task runner registered");
}

async function defaultTaskRunner(task: BackgroundTask): Promise<string> {
  // Default: shell out to openclaw CLI for isolated agent execution
  const { spawn } = await import("node:child_process");

  return new Promise((resolve, reject) => {
    const timeout = parseInt(process.env.CUPCAKE_TASK_QUEUE_TIMEOUT_MS ?? "300000", 10);
    const child = spawn("openclaw", ["run", "--non-interactive", "--"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    child.stdin?.write(task.prompt);
    child.stdin?.end();

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Task timed out after ${timeout}ms`));
    }, timeout);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout.trim() || "(no output)");
      } else {
        reject(new Error(`openclaw exited with code ${code}: ${stderr.slice(0, 500)}`));
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ─── Notification delivery ────────────────────────────────────────────────────

type NotifyFn = (
  task: BackgroundTask,
  result: string | null,
  error: string | null,
) => Promise<void>;

let notifyFn: NotifyFn | null = null;

/** Register a notification callback to deliver results back to the channel. */
export function registerResultNotifier(fn: NotifyFn): void {
  notifyFn = fn;
  log.info("Result notifier registered");
}

async function deliverResult(task: BackgroundTask): Promise<void> {
  if (notifyFn) {
    try {
      await notifyFn(task, task.result ?? null, task.error ?? null);
    } catch (err) {
      log.error("Failed to deliver task result", { taskId: task.id, error: String(err) });
    }
    return;
  }

  // Fallback: log only
  if (task.status === "completed") {
    log.info("Task completed (no notifier registered)", {
      taskId: task.id,
      description: task.description,
      channel: task.replyTo.channel,
    });
  } else {
    log.error("Task failed (no notifier registered)", {
      taskId: task.id,
      error: task.error,
    });
  }
}

// ─── Task Queue ───────────────────────────────────────────────────────────────

class TaskQueueImpl {
  private queue: BackgroundTask[] = [];
  private running = new Map<string, BackgroundTask>();
  private completed: BackgroundTask[] = [];
  private maxConcurrent: number;
  private processing = false;

  constructor() {
    this.maxConcurrent = parseInt(process.env.CUPCAKE_TASK_QUEUE_MAX_CONCURRENT ?? "3", 10);
  }

  get size(): number {
    return this.queue.length;
  }
  get activeCount(): number {
    return this.running.size;
  }

  async enqueue(opts: TaskEnqueueOptions): Promise<string> {
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const task: BackgroundTask = {
      id,
      description: opts.description,
      prompt: opts.prompt,
      replyTo: opts.replyTo,
      estimatedSeconds: opts.estimatedSeconds,
      priority: opts.priority ?? "normal",
      status: "queued",
      createdAtMs: Date.now(),
      attempts: 0,
      maxAttempts: opts.maxAttempts ?? 2,
    };

    this.queue.push(task);
    this.sortQueue();

    emitActivity({
      event: "tool_call",
      tool: "task-queue/enqueue",
      channel: opts.replyTo.channel,
      session_id: opts.replyTo.session_id,
      content: opts.description,
      meta: { taskId: id, priority: task.priority, estimatedSeconds: task.estimatedSeconds },
    });

    log.info("Task enqueued", {
      taskId: id,
      description: opts.description,
      queueSize: this.queue.length,
    });
    this.processNext();
    return id;
  }

  cancel(taskId: string): boolean {
    const idx = this.queue.findIndex((t) => t.id === taskId);
    if (idx !== -1) {
      this.queue[idx]!.status = "cancelled";
      this.queue.splice(idx, 1);
      log.info("Task cancelled", { taskId });
      return true;
    }
    return false;
  }

  getStatus(taskId: string): BackgroundTask | null {
    return (
      this.running.get(taskId) ??
      this.queue.find((t) => t.id === taskId) ??
      this.completed.find((t) => t.id === taskId) ??
      null
    );
  }

  getAll(): { queued: BackgroundTask[]; running: BackgroundTask[]; recent: BackgroundTask[] } {
    return {
      queued: [...this.queue],
      running: [...this.running.values()],
      recent: this.completed.slice(-10),
    };
  }

  private sortQueue(): void {
    const order: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };
    this.queue.sort((a, b) => order[a.priority] - order[b.priority]);
  }

  private async processNext(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0 && this.running.size < this.maxConcurrent) {
      const task = this.queue.shift()!;
      this.running.set(task.id, task);
      this.runTask(task); // fire-and-forget
    }

    this.processing = false;
  }

  private async runTask(task: BackgroundTask): Promise<void> {
    task.status = "running";
    task.startedAtMs = Date.now();
    task.attempts++;

    log.info("Task started", { taskId: task.id, attempt: task.attempts });

    try {
      const runner = customRunner ?? defaultTaskRunner;
      const result = await runner(task);
      task.status = "completed";
      task.result = result;
      task.completedAtMs = Date.now();

      emitActivity({
        event: "tool_result",
        tool: "task-queue/complete",
        channel: task.replyTo.channel,
        session_id: task.replyTo.session_id,
        duration_ms: task.completedAtMs - (task.startedAtMs ?? task.completedAtMs),
        content: result.slice(0, 500),
        meta: { taskId: task.id },
      });

      log.info("Task completed", {
        taskId: task.id,
        durationMs: task.completedAtMs - (task.startedAtMs ?? 0),
      });

      await deliverResult(task);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (task.attempts < task.maxAttempts) {
        log.warn("Task failed, will retry", {
          taskId: task.id,
          error: errorMsg,
          attempt: task.attempts,
        });
        task.status = "queued";
        this.running.delete(task.id);
        this.queue.unshift(task); // retry at front of queue
        setTimeout(() => this.processNext(), 2000 * task.attempts);
        return;
      }

      task.status =
        err instanceof Error && err.message.includes("timed out") ? "timeout" : "failed";
      task.error = errorMsg;
      task.completedAtMs = Date.now();

      emitActivity({
        event: "error",
        channel: task.replyTo.channel,
        session_id: task.replyTo.session_id,
        error: `Background task failed: ${errorMsg}`,
        meta: { taskId: task.id },
      });

      log.error("Task failed permanently", { taskId: task.id, error: errorMsg });
      await deliverResult(task);
    } finally {
      this.running.delete(task.id);
      // Keep last 50 completed tasks
      if (task.completedAtMs) {
        this.completed.push(task);
        if (this.completed.length > 50) this.completed.shift();
      }
      this.processNext();
    }
  }
}

// Singleton
export const taskQueue = new TaskQueueImpl();

// ─── Helper: should this task be delegated? ───────────────────────────────────

/**
 * Heuristics to decide if a task should be backgrounded.
 * Returns true if the task should be delegated to the queue.
 */
export function shouldDelegate(opts: { message: string; estimatedSeconds?: number }): boolean {
  const { message, estimatedSeconds } = opts;

  // Explicit threshold
  if (estimatedSeconds !== undefined && estimatedSeconds > 10) return true;

  // Keyword heuristics for long-running operations
  const longRunningKeywords = [
    "research",
    "analyze all",
    "scan all",
    "audit",
    "generate report",
    "read every",
    "process all",
    "summarize all",
    "extract from all",
    "batch",
    "crawl",
    "scrape",
    "download all",
    "convert all",
    "comprehensive",
    "thorough",
    "in-depth",
    "deep dive",
  ];

  const lowerMsg = message.toLowerCase();
  return longRunningKeywords.some((kw) => lowerMsg.includes(kw));
}
