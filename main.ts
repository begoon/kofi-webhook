import { google } from "googleapis";

import { env } from "node:process";

import TEST_DATA from "./data-example.ts";

const { GOOGLE_CREDENTIALS } = env;
if (!GOOGLE_CREDENTIALS) throw new Error("GOOGLE_CREDENTIALS not set");

const credentials = JSON.parse(atob(GOOGLE_CREDENTIALS));

const { private_key_id } = credentials;
console.log("±", private_key_id.slice(0, 4) + ".." + private_key_id.slice(-4));

const oauth2Client = new google.auth.GoogleAuth({
    credentials: credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth: oauth2Client });

const { SPREADSHEET_ID } = env;
if (!SPREADSHEET_ID) throw new Error("SPREADSHEET_ID not set");

console.log({ SPREADSHEET_ID });

async function existing() {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "payments!A:A",
    });

    const existing = response.data.values?.length ?? 0;
    console.log({ existing });
    return existing;
}

await existing();

const MAIN_FIELDS = [
    "timestamp",
    "type",
    "email",
    "amount",
    "currency",
    "tier_name",
    "from_name",
    "kofi_transaction_id",
    "url",
];

async function store(event: Record<string, unknown>) {
    const row = await existing();

    const receivedFields = Object.keys(event);
    const otherFields = receivedFields
        .filter((field) => !MAIN_FIELDS.includes(field))
        .toSorted();
    
    const fields = [...MAIN_FIELDS, ...otherFields];
    console.assert(fields.length === receivedFields.length);

    const values = [];
    if (row === 0) values.push(fields);

    values.push(fields.map((v) => typeof event[v] != "object" ? event[v] : ""));

    const columns = "A".charCodeAt(0) + fields.length - 1;

    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `payments!A${row + 1}:${columns}${row + values.length}`,
        valueInputOption: "RAW",
        requestBody: { values },
    });
}


const port = Number(env.PORT) || 8000;

import meta from "./deno.json" with { type: "json" };
const { version } = meta;

async function webhook(text: string) {
    console.log(text);
    const [_, value] = text.split("=");
    const event = JSON.parse(decodeURIComponent(value));
    console.log(event);
    await store(event);
}

Deno.serve(
    { port, onListen: () => console.log("listening on port", port) },
    async (req) => {
        const url = new URL(req.url);
        const method = req.method;
        console.log(method, url.pathname);
        if (method === "GET" && url.pathname === "/health") {
            return Response.json({ version });
        }
        if (method === "GET" && url.pathname === "/self") {
            await store(JSON.parse(TEST_DATA));
            return Response.json({ status: "self" });
        }
        if (method === "POST" && url.pathname === "/webhook") {
            const text = await req.text();
            webhook(text);
            return Response.json({ status: "ok" });
        }
        return new Response("ha?");
    }
);
