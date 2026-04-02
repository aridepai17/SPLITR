import { inngest } from "./client";

export const testFunction = inngest.createFunction(
    { id: "test-function" },
    { event: "test/event" },
    async ({ event, step }) => {
        await step.sleep("1s")
    }
)