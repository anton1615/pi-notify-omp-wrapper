import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import upstreamNotifyExtension from "./upstream-pi-notify/index";

type InteractiveContext = { hasUI: boolean };
type InteractiveNotificationHandler = (event: unknown, ctx: InteractiveContext) => Promise<unknown> | unknown;
type ToolExecutionStartEvent = { toolName?: string };

function createMainOnlyApi(pi: ExtensionAPI): ExtensionAPI {
    const wrappedPi = Object.create(pi) as ExtensionAPI;
    const originalOn = pi.on.bind(pi) as unknown as (event: string, handler: unknown) => void;
    const interactiveNotificationHandlers: InteractiveNotificationHandler[] = [];

    originalOn("tool_execution_start", async (eventData: ToolExecutionStartEvent, ctx: InteractiveContext) => {
        if (eventData.toolName !== "ask") return;
        for (const handler of interactiveNotificationHandlers) {
            await handler(eventData, ctx);
        }
    });

    wrappedPi.on = ((event: string, handler: unknown) => {
        if (event !== "agent_end") {
            originalOn(event, handler);
            return;
        }

        const wrappedHandler: InteractiveNotificationHandler = async (eventData, ctx) => {
            if (!ctx.hasUI) return;
            return await (handler as InteractiveNotificationHandler)(eventData, ctx);
        };

        interactiveNotificationHandlers.push(wrappedHandler);
        originalOn("agent_end", wrappedHandler);
        originalOn("session_compact", wrappedHandler);
    }) as ExtensionAPI["on"];


    return wrappedPi;
}

export default function notifyMainOnlyExtension(pi: ExtensionAPI): void {
    upstreamNotifyExtension(createMainOnlyApi(pi));
}
