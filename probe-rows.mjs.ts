import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { databaseEnvSchema, loadEnv } from "@hamboom/config";
import { signDevToken } from "@hamboom/realtime";
import { boardRoots, createBoardDoc, decodeMessage, encodeMessage, getSchemaVersion, MSG_TYPES, writeElement } from "@hamboom/ydoc-schema";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import pg from "pg";
import * as syncProtocol from "y-protocols/sync";
import { WebSocket } from "ws";
import * as Y from "yjs";

const SECRET = "hamboom-compaction-secret-at-least-32-chars";
const PORT = 15392;
const env = loadEnv(databaseEnvSchema);
const board = randomUUID();
const token = signDevToken({ sub: randomUUID(), boardId: board, role: "editor", exp: Math.floor(Date.now()/1000)+3600 }, SECRET);

const child = spawn(process.execPath, ["--env-file-if-exists=.env", "apps/realtime/src/main.ts"], {
  env: { ...process.env, RT_PORT: String(PORT), RT_DEV_JWT_SECRET: SECRET, RT_SNAPSHOT_DIR: ".hamboom/snapshots-probe", RT_SNAPSHOT_EVERY_UPDATES: "99999", RT_SNAPSHOT_EVERY_MS: "99999999", APP_ENV: "local", LOG_LEVEL: "warn" },
  stdio: ["ignore", "pipe", "pipe"],
});
await new Promise((r) => { child.stdout.on("data", (c) => { if (String(c).includes("آماده")) r(); }); });

const doc = createBoardDoc();
process.stdout.write(`clientID=${doc.clientID} metaAtStart=${String(getSchemaVersion(doc))}\n`);
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/rt?board=${board}&token=${token}`);
ws.on("message", (d) => {
  const m = decodeMessage(new Uint8Array(d));
  if (m?.type !== MSG_TYPES.SYNC) return;
  const reply = encoding.createEncoder();
  syncProtocol.readSyncMessage(decoding.createDecoder(m.payload), reply, doc, "probe", () => {});
  if (encoding.length(reply) > 0) ws.send(encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(reply) }));
});
await new Promise((r) => ws.once("open", r));
await new Promise((r) => setTimeout(r, 500));
for (let i = 0; i < 2; i++) {
  const before = Y.encodeStateVector(doc);
  doc.transact(() => { writeElement(boardRoots(doc).elements, { id:`e${i}`, type:"rectangle", x:0,y:0,width:9,height:9,angle:0,index:"a1",frameId:null,groupIds:[],locked:false,strokeColor:"#111",backgroundColor:"#FFF9B1",fillStyle:"solid",strokeWidth:1,strokeStyle:"solid",roughness:0,opacity:100,roundness:null,seed:1,version:1,versionNonce:1,updated:0,isDeleted:false,boundElements:null,link:null,customData:{hb:{schema:1,kind:"sticky",createdBy:"u",lastEditedBy:"u",createdAt:0}} }); });
  const enc = encoding.createEncoder();
  syncProtocol.writeUpdate(enc, Y.encodeStateAsUpdate(doc, before));
  ws.send(encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(enc) }));
  await new Promise((r) => setTimeout(r, 300));
}
const db = new pg.Client({ connectionString: env.DATABASE_URL });
await db.connect();
const rows = await db.query("SELECT seq, payload FROM board_updates WHERE board_id=$1 ORDER BY seq", [board]);
for (const r of rows.rows) {
  const d = new Y.Doc();
  Y.applyUpdate(d, new Uint8Array(r.payload));
  process.stdout.write(`seq=${r.seq} bytes=${r.payload.length} metaKeys=${JSON.stringify([...boardRoots(d).meta.keys()])} elements=${boardRoots(d).elements.size} clients=${JSON.stringify([...Y.decodeStateVector(Y.encodeStateVector(d)).entries()])}\n`);
}
await db.query("DELETE FROM board_updates WHERE board_id=$1", [board]);
await db.end(); ws.close(); child.kill("SIGKILL");
