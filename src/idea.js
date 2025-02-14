import { Application, Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { createExitSignal, staticServer } from "./shared/server.ts";
import { promptGPT } from "./shared/openai.ts";

const app = new Application();
const router = new Router();
const kv = await Deno.openKv();

// Function to fetch all emotions from the database
async function getAllEmotions() {
    const emotions = kv.list({ prefix: ["emotions"] });
    const results = [];
    for await (const emotion of emotions) {
        results.push(emotion.value);
    }
    return results;
}

// Function to save an emotion to the database
async function saveEmotion(emotionData) {
    const emotionId = crypto.randomUUID();
    const emotionKey = ["emotions", emotionId];
    await kv.set(emotionKey, emotionData);
    console.log("Saved emotion to KV:", emotionData);
}

// Function to clear all emotions from the KV store
async function clearAllEmotionsFromKV() {
    const emotions = kv.list({ prefix: ["emotions"] });
    for await (const emotion of emotions) {
        await kv.delete(emotion.key);
    }
    console.log("All emotions cleared from KV.");
}

// GET route to fetch all stored emotions
router.get("/emotions", async (context) => {
    const allEmotions = await getAllEmotions();
    context.response.body = { emotions: allEmotions };
});

router.post("/submit", async (context) => {
    try {
        const body = context.request.body({ type: "json" });
        const data = await body.value;

        console.log("Received POST /submit with data:", data);

        if (!data || !data.journal) {
            throw new Error("Invalid request: Missing 'journal' field");
        }

        const newJournalEntry = data.journal;
        console.log("New journal entry:", newJournalEntry);

        // Extract emotion, valence, and arousal using GPT
        const emotionExtract = await promptGPT(
            `Based on the following written entry, what is the key word that represents the core emotion felt? Respond with a singular word in all caps, use no punctuation. Words should all be in past tense. \n\nEntry: ${newJournalEntry}`,
        );
        const scaleValence = await promptGPT(
            `Using Russell's circumplex model of affect, score the following emotion on a scale of 1-10 based on valence. 1 being negative, 10 being positive. Emotion: ${emotionExtract}. Respond with only a number.`,
        );
        const scaleArousal = await promptGPT(
            `Using Russell's circumplex model of affect, score the following emotion on a scale of 1-10 based on arousal. 1 being low, 10 being high. Emotion: ${emotionExtract}. Respond with only a number.`,
        );

        console.log("Extracted Emotion:", emotionExtract);
        console.log("Valence score:", scaleValence);
        console.log("Arousal score:", scaleArousal);

        const newEmotion = {
            emotion: emotionExtract,
            valence: parseInt(scaleValence, 10),
            arousal: parseInt(scaleArousal, 10),
        };

        await saveEmotion(newEmotion);

        // Return only the newly created emotion
        context.response.body = {
            message: "Emotion submitted and processed.",
            emotion: newEmotion,
        };
    } catch (error) {
        console.error("Error handling submit request:", error);
        context.response.status = 400;
        context.response.body = {
            error: error.message || "Failed to process the request.",
        };
    }
});

// Endpoint to clear all stored emotions manually
router.post("/clear", async (context) => {
    try {
        await clearAllEmotionsFromKV();
        context.response.body = { message: "All emotions cleared." };
    } catch (error) {
        console.error("Error clearing emotions:", error);
        context.response.status = 500;
        context.response.body = { error: "Failed to clear emotions." };
    }
});

app.use(router.routes());
app.use(router.allowedMethods());
app.use(staticServer);

console.log("\nListening on http://localhost:8000");

// Function to schedule a daily clear at midnight EST
function scheduleDailyClear() {
    // Calculate next midnight EST
    const now = new Date();

    // EST is typically UTC-5 or UTC-4 depending on DST. For simplicity,
    // let's assume standard EST (UTC-5) here. For a robust solution,
    // consider using a library that handles DST or a stable external scheduler.
    const offsetMinutes = 5 * 60; // 5 hours * 60 minutes
    // Convert current time to EST by subtracting 5 hours
    const estNow = new Date(now.getTime() - offsetMinutes * 60000);

    // Next midnight in EST
    const nextMidnightEST = new Date(
        estNow.getFullYear(),
        estNow.getMonth(),
        estNow.getDate() + 1,
        0,
        0,
        0,
        0,
    );

    // Convert that midnight EST time back to the server's local time
    const localNextMidnight = new Date(
        nextMidnightEST.getTime() + offsetMinutes * 60000,
    );

    const delay = localNextMidnight.getTime() - now.getTime();
    console.log(`Scheduling daily clear in ${delay / 1000 / 60} minutes.`);

    setTimeout(async () => {
        console.log("Clearing emotions at midnight EST...");
        await clearAllEmotionsFromKV();
        // Reschedule for the next midnight
        scheduleDailyClear();
    }, delay);
}

// Start the scheduling after the server is up and running
scheduleDailyClear();

await app.listen({ port: 8000, signal: createExitSignal() });
