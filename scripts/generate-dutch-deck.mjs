import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cacheDir = join(root, ".cache", "deck");
const htmlPath = join(cacheDir, "dutch-wordlist.html");
const sqlitePath = join(cacheDir, "nl-en.sqlite3");
const outPath = join(root, "src", "data", "dutch-deck.json");

const wordlistUrl =
  "https://en.wiktionary.org/wiki/Wiktionary:Frequency_lists/Dutch_wordlist";
const sqliteUrl =
  "https://download.wikdict.com/dictionaries/sqlite/2/nl-en.sqlite3";
const overrides = new Map(
  Object.entries({
    ik: ["I"],
    je: ["you", "your"],
    het: ["the", "it"],
    de: ["the"],
    dat: ["that"],
    is: ["is"],
    een: ["a", "one"],
    niet: ["not"],
    en: ["and"],
    wat: ["what"],
    van: ["of", "from"],
    we: ["we"],
    in: ["in"],
    ze: ["she", "they"],
    hij: ["he"],
    op: ["on"],
    te: ["to", "at"],
    zijn: ["are", "be", "his"],
    er: ["there"],
    maar: ["but", "only"],
    die: ["that", "who"],
    heb: ["have"],
    me: ["me"],
    met: ["with"],
    voor: ["for", "before"],
    als: ["if", "as"],
    ben: ["am"],
    was: ["was"],
    dit: ["this"],
    mijn: ["my"],
    om: ["around", "in order to"],
    aan: ["to", "on"],
    jij: ["you"],
    naar: ["to", "toward"],
    dan: ["then", "than"],
    hier: ["here"],
    weet: ["know"],
    kan: ["can"],
    geen: ["no", "not any"],
    nog: ["still", "yet"],
    moet: ["must", "have to"],
    wil: ["want"],
    wel: ["indeed", "well"],
    ja: ["yes"],
    zo: ["so", "like this"],
    heeft: ["has"],
    hebben: ["have"],
    hem: ["him"],
    goed: ["good", "well"],
    nee: ["no"],
    waar: ["where", "true"],
    nu: ["now"],
    hoe: ["how"],
    ga: ["go"],
    haar: ["her", "hair"],
    uit: ["out", "from"],
    doen: ["do"],
    ook: ["also", "too"],
    over: ["over", "about"],
    bent: ["are"],
    mij: ["me"],
    gaan: ["go"],
    of: ["or", "whether"],
    kom: ["come"],
    zou: ["would"],
    al: ["already", "all"],
    bij: ["with", "near"],
    daar: ["there"],
    ons: ["us", "our"],
    jullie: ["you"],
    hebt: ["have"],
    gaat: ["goes", "is going"],
    iets: ["something"],
    zal: ["will", "shall"],
    meer: ["more"],
    waarom: ["why"],
    had: ["had"],
    deze: ["this", "these"],
    laat: ["late", "let"],
    moeten: ["must", "have to"],
    "m'n": ["my"],
    jou: ["you"],
    doe: ["do"],
    wie: ["who"],
    kunnen: ["can", "be able to"],
    alles: ["everything"],
    denk: ["think"],
    door: ["through", "by"],
    echt: ["real", "really"],
    alleen: ["alone", "only"],
    "oké": ["okay"],
    eens: ["once", "sometime"],
    dus: ["so", "therefore"],
    weg: ["away", "road"],
    zien: ["see"],
    toch: ["still", "anyway"],
    man: ["man"],
    nooit: ["never"],
    terug: ["back"],
    laten: ["let", "leave"],
    nou: ["now", "well"],
    mee: ["with", "along"],
    misschien: ["maybe"],
    even: ["for a moment", "even"],
    iemand: ["someone"],
    komt: ["comes"],
    niets: ["nothing"],
    zei: ["said"],
    hou: ["hold", "love"],
    komen: ["come"],
    mensen: ["people"],
    onze: ["our"],
    nodig: ["necessary", "needed"],
    tot: ["until", "to"],
    worden: ["become", "be"],
    veel: ["much", "many"],
    weten: ["know"],
    leven: ["life", "live"],
    wij: ["we"],
    weer: ["again", "weather"],
    gewoon: ["ordinary", "just"],
    kijk: ["look"],
    zeggen: ["say"],
    tijd: ["time"],
    zeg: ["say"],
    twee: ["two"],
    toen: ["then", "when"],
    tegen: ["against", "to"],
    zit: ["sit", "is located"],
    net: ["just", "neat"],
    dood: ["dead", "death"],
    uw: ["your"],
    wordt: ["becomes", "is"],
    maken: ["make"],
    mag: ["may", "is allowed"],
    "één": ["one"],
    "z'n": ["his"],
    omdat: ["because"],
    gedaan: ["done"],
    heel: ["very", "whole"],
    af: ["off", "finished"],
    altijd: ["always"],
    jouw: ["your"],
    zeker: ["sure", "certain"],
    geef: ["give"],
    zie: ["see"],
    wacht: ["wait"],
  }),
);

mkdirSync(cacheDir, { recursive: true });
mkdirSync(dirname(outPath), { recursive: true });

function download(url, path) {
  if (existsSync(path)) return;
  execFileSync("curl", ["-L", url, "-o", path], { stdio: "inherit" });
}

download(wordlistUrl, htmlPath);
download(sqliteUrl, sqlitePath);

const html = readFileSync(htmlPath, "utf8");
const frequencyRows = [...html.matchAll(/<li><span lang="nl"><a [^>]*>([^<]+)<\/a><\/span>\s+(\d+)<\/li>/g)]
  .map((match, index) => ({
    rank: index + 1,
    term: decodeHtml(match[1]),
    frequency: Number(match[2]),
  }))
  .filter((row) => isCleanTerm(row.term));

if (frequencyRows.length < 4000) {
  throw new Error(`Expected thousands of Dutch frequency rows, got ${frequencyRows.length}`);
}

const wantedSql = [
  "create temp table wanted(term text primary key);",
  ...frequencyRows.map((row) => `insert or ignore into wanted values (${sqlQuote(row.term.toLowerCase())});`),
  `select s.written_rep, s.trans_list, s.max_score, s.rel_importance
   from simple_translation s
   join wanted w on lower(s.written_rep) = w.term;`,
].join("\n");

const rows = execFileSync(
  "sqlite3",
  ["-separator", "\t", sqlitePath],
  { encoding: "utf8", input: wantedSql, maxBuffer: 64 * 1024 * 1024 },
)
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [written, translations, score, importance] = line.split("\t");
    return {
      written,
      translations: splitTranslations(translations),
      score: Number(score || 0),
      importance: Number(importance || 0),
    };
  });

const translationsByTerm = new Map();
for (const row of rows) {
  const key = row.written.toLowerCase();
  const existing = translationsByTerm.get(key);
  if (!existing || row.score > existing.score) {
    translationsByTerm.set(key, row);
  }
}

const deck = frequencyRows
  .map((row) => {
    const translation = translationsByTerm.get(row.term.toLowerCase());
    const override = overrides.get(row.term.toLowerCase());
    const translations = override || translation?.translations;
    if (!translations?.length) return null;
    return {
      id: `nl-${row.rank}`,
      language: "nl",
      ttsLang: "nl-NL",
      rank: row.rank,
      term: row.term,
      frequency: row.frequency,
      translations: translations.slice(0, 4),
    };
  })
  .filter(Boolean);

writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      version: 1,
      language: "nl",
      languageName: "Dutch",
      source:
        "Wiktionary Dutch frequency list joined with WikDict Dutch-English translations.",
      license:
        "WikDict data is derived from Wiktionary/DBnary under CC BY-SA. See README.",
      entries: deck,
    },
    null,
    2,
  )}\n`,
);

console.log(`Generated ${deck.length} Dutch entries at ${outPath}`);

function splitTranslations(value) {
  return [...new Set(
    String(value || "")
      .split(/\s+\|\s+/)
      .map((part) => part.replace(/\s*\([^)]*\)\s*/g, " ").trim())
      .map((part) => part.replace(/\s+/g, " "))
      .filter((part) => part && /^[A-Za-z][A-Za-z '\-.,]+$/.test(part))
      .map((part) => part.replace(/[.,]+$/g, ""))
      .filter((part) => part.length <= 42),
  )];
}

function isCleanTerm(term) {
  return (
    term.length > 1 &&
    term.length < 28 &&
    !/[A-Z]/.test(term) &&
    /^[a-zà-ÿ'’-]+$/i.test(term) &&
    !/^(ok|okay|uh|um|hm|ha|oh|ah|hé|ho|yo)$/i.test(term)
  );
}

function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&nbsp;", " ");
}

function sqlQuote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}
