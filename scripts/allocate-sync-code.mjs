import { execFileSync } from "node:child_process";

const code = process.argv.slice(2).join(" ").trim();

if (!code) {
  console.error("Usage: node scripts/allocate-sync-code.mjs <sync-code>");
  process.exit(1);
}

if (code.length < 4 || code.length > 128 || !/^[\x21-\x7e]+$/.test(code)) {
  console.error("Sync code must be 4-128 printable non-space ASCII characters.");
  process.exit(1);
}

const now = Date.now();
const emptySnapshot = JSON.stringify({
  languages: {
    nl: { progress: {}, totals: { answered: 0, correct: 0, streak: 0 } },
    zh: { progress: {}, totals: { answered: 0, correct: 0, streak: 0 } },
  },
});

const sql = [
  "delete from sync_state;",
  "delete from sync_codes;",
  `insert into sync_codes (code, created_at, last_used_at) values (${sqlString(code)}, ${now}, ${now});`,
  `insert into sync_state (code, revision, snapshot_json, updated_at) values (${sqlString(code)}, 0, ${sqlString(emptySnapshot)}, ${now});`,
].join(" ");

execFileSync("wrangler", ["d1", "execute", "flashlang", "--remote", "--command", sql], { stdio: "inherit" });

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}
