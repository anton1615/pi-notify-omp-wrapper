import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import notifyExtension from "./index";

interface FakeContext {
    hasUI: boolean;
}

type EventHandler = (event: unknown, ctx: FakeContext) => Promise<void> | void;

function createHarness() {
    const handlers = new Map<string, EventHandler[]>();

    return {
        pi: {
            on(event: string, handler: EventHandler) {
                const existing = handlers.get(event) ?? [];
                existing.push(handler);
                handlers.set(event, existing);
            },
        },
        async emit(event: string, ctx: FakeContext, payload: Record<string, unknown> = {}) {
            for (const handler of handlers.get(event) ?? []) {
                await handler(payload, ctx);
            }
        },
    };
}

const originalEnv = {
    TMUX: process.env.TMUX,
    WT_SESSION: process.env.WT_SESSION,
    KITTY_WINDOW_ID: process.env.KITTY_WINDOW_ID,
    TERM_PROGRAM: process.env.TERM_PROGRAM,
    ITERM_SESSION_ID: process.env.ITERM_SESSION_ID,
    PI_NOTIFY_SOUND_CMD: process.env.PI_NOTIFY_SOUND_CMD,
};

let writes: string[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);

beforeEach(() => {
    writes = [];
    delete process.env.TMUX;
    delete process.env.WT_SESSION;
    delete process.env.KITTY_WINDOW_ID;
    delete process.env.TERM_PROGRAM;
    delete process.env.ITERM_SESSION_ID;
    delete process.env.PI_NOTIFY_SOUND_CMD;
    process.stdout.write = ((chunk: string | Uint8Array) => {
        writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
    }) as typeof process.stdout.write;
});

afterEach(() => {
    process.stdout.write = originalWrite as typeof process.stdout.write;
    for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
});

describe("pi-notify main-only wrapper", () => {
    test("notifies for interactive agent completion", async () => {
        const harness = createHarness();
        notifyExtension(harness.pi as never);

        await harness.emit("agent_end", { hasUI: true });

        expect(writes).toEqual(["\u001b]777;notify;Pi;Ready for input\u0007"]);
    });

    test("notifies for interactive ask waits", async () => {
        const harness = createHarness();
        notifyExtension(harness.pi as never);

        await harness.emit("tool_execution_start", { hasUI: true }, { toolName: "ask", toolCallId: "ask-1" });

        expect(writes).toEqual(["\u001b]777;notify;Pi;Ready for input\u0007"]);
    });

    test("suppresses ask notifications for non-interactive sessions", async () => {
        const harness = createHarness();
        notifyExtension(harness.pi as never);

        await harness.emit("tool_execution_start", { hasUI: false }, { toolName: "ask", toolCallId: "ask-1" });

        expect(writes).toEqual([]);
    });

    test("suppresses completion notifications for non-interactive sessions", async () => {
        const harness = createHarness();
        notifyExtension(harness.pi as never);

        await harness.emit("agent_end", { hasUI: false });

        expect(writes).toEqual([]);
    });
});
