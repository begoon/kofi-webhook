import { google } from "googleapis";

import { env } from "node:process";

import TEST_DATA from "./data-example.ts";

const { GOOGLE_CREDENTIALS } = env;
if (!GOOGLE_CREDENTIALS) throw new Error("GOOGLE_CREDENTIALS not set");

const credentials = JSON.parse(atob(GOOGLE_CREDENTIALS));

const { private_key_id } = credentials;
console.log("±", cut(private_key_id));

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

    const msg = [
        `<${event.url}|платеж>`,
        event.email,
        event.from_name,
        `*${event.amount}*`,
        event.currency,
        (event.timestamp as string).replace("T" , " ").replace("Z", ""),
    ].join(" ");
    
    console.log(msg);
    await slack(msg);
}

async function check(email: string) {
    console.log("check", { email });
    const existing = await emails();
    return existing.includes(email);
}

async function emails() {
    console.log("emails");
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "payments!C:C",
    });

    const values = response.data.values?.map((v) => v[0]) ?? [];
    if (values.at(0) === "email") values.shift();

    const unique = [...new Set(values)];
    console.log({ emails: unique });
    return unique;
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

function cut(v: string) {
    return v.slice(0, 4) + ".." + v.slice(-4);
}

function cors(response: Response) {
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type");
    return response;
}

// ---

const SLACK_SERVICE = "https://hooks.slack.com/services/";

const { SLACK_SECRET } = env;
if (!SLACK_SECRET) throw new Error("missing SLACK_SECRET");

// const msg = `<${pdf}|карта> пользователя *${name}* сохранена (${size} байт, ${seconds} секунд)`;

export async function slack(text: string) {
    const response = await fetch(SLACK_SERVICE + SLACK_SECRET, {
        method: "POST",
        headers: { "Content-type": "application/json" },
        body: JSON.stringify({ text }),
    });
    return response;
}

// ---

Deno.serve(
    { port, onListen: () => console.log("listening on port", port) },
    async (req) => {
        const url = new URL(req.url);
        const method = req.method;
        console.log(method, url.pathname);
        if (method === "GET" && url.pathname === "/health") {
            return Response.json({
                version,
                sheets: cut(SPREADSHEET_ID),
                me: cut(private_key_id)
            });
        }
        if (method === "GET" && url.pathname === "/self") {
            await store(JSON.parse(TEST_DATA));
            return Response.json({ status: "self" });
        }
        if (method === "GET" && url.pathname.startsWith("/exist")) {
            const RE = new URLPattern({ pathname: "/exist/:email" });
            const match = RE.exec(req.url)
            if (match) {
                const email = match.pathname.groups.email;
                if (!email) return Response.json({ error: "email?" }, { status: 400 });

                const exist = await check(email);
                return cors(new Response("", { status: exist ? 200 : 404 }));
            } else {
                const all = await emails();
                return Response.json({ emails: all });
            }
        }
        if (method === "POST" && url.pathname === "/webhook") {
            const text = await req.text();
            webhook(text);
            return Response.json({ status: "ok" });
        }
        return new Response("ha?");
    }
);
