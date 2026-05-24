import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cacheDir = join(root, ".cache", "deck");
const sourcePath = join(cacheDir, "complete-hsk-vocabulary.json");
const outPath = join(root, "src", "data", "mandarin-deck.json");
const sourceUrl = "https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/complete.json";
const overrides = new Map(
  Object.entries({
    的: ["of", "possessive particle"],
    我: ["I", "me"],
    你: ["you"],
    是: ["be", "is"],
    了: ["completed action particle"],
    不: ["not"],
    在: ["at", "in"],
    有: ["have", "there is"],
    人: ["person", "people"],
    这: ["this"],
    中: ["middle", "in"],
    大: ["big"],
    来: ["come"],
    上: ["up", "on"],
    个: ["individual measure word"],
    国: ["country"],
    到: ["arrive", "to"],
    说: ["speak", "say"],
    们: ["plural marker"],
    为: ["for", "as"],
    子: ["child", "suffix"],
    和: ["and"],
    你们: ["you"],
    我们: ["we", "us"],
    他们: ["they", "them"],
    什么: ["what"],
    没有: ["not have", "there is not"],
    可以: ["can", "may"],
    现在: ["now"],
    知道: ["know"],
    时候: ["time", "moment"],
    中国: ["China"],
    喜欢: ["like"],
    学生: ["student"],
    老师: ["teacher"],
    朋友: ["friend"],
    今天: ["today"],
    明天: ["tomorrow"],
    昨天: ["yesterday"],
  }),
);

mkdirSync(cacheDir, { recursive: true });
mkdirSync(dirname(outPath), { recursive: true });

if (!existsSync(sourcePath)) {
  execFileSync("curl", ["-L", sourceUrl, "-o", sourcePath], { stdio: "inherit" });
}

const source = JSON.parse(readFileSync(sourcePath, "utf8"));
const cleaned = source
  .map(cleanEntry)
  .filter(Boolean)
  .filter((entry) => isUsefulEntry(entry));

const characters = cleaned
  .filter((entry) => entry.kind === "character")
  .sort(compareEntryScore)
  .slice(0, 500);

const words = cleaned
  .filter((entry) => entry.kind === "word")
  .filter((entry) => entry.hskLevel <= 4)
  .sort(compareEntryScore)
  .slice(0, 1000);

if (characters.length < 500 || words.length < 1000) {
  throw new Error(`Expected 500 characters and 1000 words, got ${characters.length} characters and ${words.length} words`);
}

const deck = interleave(characters, words).map((entry, index) => ({
  id: `zh-${index + 1}`,
  language: "zh",
  ttsLang: "zh-CN",
  rank: index + 1,
  term: entry.term,
  pinyin: entry.pinyin,
  kind: entry.kind,
  hskLevel: entry.hskLevel,
  frequency: entry.frequency,
  translations: entry.translations.slice(0, 4),
}));

writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      version: 1,
      language: "zh",
      languageName: "Mandarin",
      script: "Simplified Chinese",
      source:
        "Complete HSK Vocabulary joined from HSK 3.0, CC-CEDICT, and SUBTLEX/HanLP-derived frequency metadata.",
      license:
        "Complete HSK Vocabulary is MIT licensed. CC-CEDICT-derived definitions are CC BY-SA.",
      entries: deck,
    },
    null,
    2,
  )}\n`,
);

console.log(`Generated ${deck.length} Mandarin entries at ${outPath}`);

function cleanEntry(row) {
  const term = String(row.simplified || "").trim();
  const form = row.forms?.[0];
  const pinyin = normalizePinyin(form?.transcriptions?.pinyin);
  const translations = cleanMeanings(form?.meanings || []);
  const hskLevel = hskLevelFor(row.level || []);
  const frequency = Number(row.frequency || 999_999);
  const kind = [...term].length === 1 ? "character" : "word";

  if (!term || !pinyin || !translations.length || hskLevel > 9) return null;

  return {
    term,
    pinyin,
    translations: overrides.get(term) || translations,
    hskLevel,
    frequency,
    kind,
    pos: row.pos || [],
  };
}

function hskLevelFor(levels) {
  const newLevels = levels
    .map((level) => /^new(?:est)?-(\d+)/.exec(level)?.[1])
    .filter(Boolean)
    .map(Number);
  if (newLevels.length) return Math.min(...newLevels);

  const oldLevels = levels
    .map((level) => /^old-(\d+)/.exec(level)?.[1])
    .filter(Boolean)
    .map(Number);
  return oldLevels.length ? Math.min(...oldLevels) + 1 : 99;
}

function cleanMeanings(meanings) {
  return [...new Set(
    meanings
      .flatMap((meaning) => String(meaning).split(/\s*;\s*/))
      .map((meaning) => meaning.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim())
      .map((meaning) => meaning.replace(/^to be /, "be "))
      .map((meaning) => meaning.replace(/^to /, ""))
      .filter((meaning) => /^[A-Za-z][A-Za-z0-9 '&,./-]+$/.test(meaning))
      .filter((meaning) => meaning.length >= 2 && meaning.length <= 48),
  )];
}

function isUsefulEntry(entry) {
  if (!/^\p{Script=Han}+$/u.test(entry.term)) return false;
  if ([...entry.term].length > 4) return false;
  if (entry.pos.some((part) => ["nr", "ns", "nt", "nz", "j", "i", "l"].includes(part))) return false;

  const text = entry.translations.join(" ").toLowerCase();
  return !/(surname|variant of|old variant|abbr\.|abbreviation|archaic|used in names|classifier for)/.test(text);
}

function compareEntryScore(left, right) {
  return score(left) - score(right);
}

function score(entry) {
  const kindPenalty = entry.kind === "character" ? 0 : 200;
  return entry.hskLevel * 100_000 + entry.frequency + kindPenalty;
}

function interleave(characters, words) {
  const result = [];
  let characterIndex = 0;
  let wordIndex = 0;

  while (characterIndex < characters.length || wordIndex < words.length) {
    if (characterIndex < characters.length) result.push(characters[characterIndex++]);
    for (let count = 0; count < 2 && wordIndex < words.length; count += 1) {
      result.push(words[wordIndex++]);
    }
  }

  return result.slice(0, 1500);
}

function normalizePinyin(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
