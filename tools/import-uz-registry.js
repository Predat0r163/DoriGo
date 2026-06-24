#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const XLSX = require(path.resolve(__dirname, "../vendor/xlsx.full.min.js"));
XLSX.set_fs(fs);

const args = process.argv.slice(2);
const options = Object.fromEntries(
  args
    .filter((arg) => arg.startsWith("--"))
    .map((arg) => {
      const [key, ...value] = arg.slice(2).split("=");
      return [key, value.join("=")];
    }),
);
const inputFiles = args.filter((arg) => !arg.startsWith("--"));

if (!inputFiles.length) {
  console.error("Использование:");
  console.error('  node tools/import-uz-registry.js "Реестр.xlsx" --edition="№30, 2026" --published=2026-01-01');
  process.exit(1);
}

const outputFile = options.output
  ? path.resolve(options.output)
  : path.resolve(__dirname, "../assets/catalog/uzbekistan-drugs.js");
const sourceUrl = options["source-url"]
  || "https://uzpharm-control.uz/pages/state-register-of-medicines-and-medical-products";
const sourceName = "Центр безопасности фармацевтической продукции Республики Узбекистан";

const normalize = (value) => String(value ?? "")
  .trim()
  .toLowerCase()
  .replace(/ё/g, "е")
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .trim();

const aliases = {
  name: [
    "торговое наименование", "торговое название", "наименование лекарственного средства", "название препарата",
    "trade name", "dori vositasining savdo nomi", "savdo nomi",
  ],
  mnn: [
    "международное непатентованное наименование", "мнн", "inn",
    "xalqaro patentlanmagan nomi", "xalqaro nomi",
  ],
  formDetails: ["лекарственная форма", "форма выпуска", "dosage form", "dori shakli"],
  dosage: ["дозировка", "доза", "dosage", "dozasi"],
  packageSize: ["упаковка", "фасовка", "количество в упаковке", "packaging", "qadoqlanishi"],
  manufacturer: ["производитель", "фирма производитель", "manufacturer", "ishlab chiqaruvchi"],
  country: ["страна", "страна производитель", "страна производителя", "country", "mamlakat"],
  pharmacotherapeuticGroup: [
    "фармакотерапевтическая группа", "фармакотерапев тическая группа",
    "pharmacotherapeutic group", "farmakoterapevtik guruh",
  ],
  registrationNumber: [
    "регистрационный номер", "номер регистрационного удостоверения", "рег номер",
    "registration number", "qayd etish raqami", "ro yxatdan o tkazish raqami",
  ],
  registrationDate: ["дата регистрации", "registration date", "qayd etilgan sana"],
  registrationChangeDate: [
    "дата изменения к регистрационному удостоверению", "дата изменения",
    "registration change date",
  ],
  atcCode: ["код атх", "атх код", "atc", "atc code"],
  prescriptionStatus: [
    "условия отпуска", "рецептурность", "отпуск", "prescription", "retsept",
  ],
};

const aliasLookup = new Map();
Object.entries(aliases).forEach(([field, names]) => {
  names.forEach((name) => aliasLookup.set(normalize(name), field));
});

function headerField(value) {
  const header = normalize(value);
  if (!header) return "";
  if (header.includes("торгов") && (header.includes("назван") || header.includes("наимен"))) return "name";
  if (header.includes("международ") && header.includes("назван")) return "mnn";
  if (header.includes("лекарствен") && header.includes("форм")) return "formDetails";
  if (header.includes("страна") && header.includes("производ")) return "country";
  if (header.includes("фирма") && header.includes("производ")) return "manufacturer";
  if (header.includes("фармакотерапев") && header.includes("груп")) return "pharmacotherapeuticGroup";
  if ((header.includes("регис") || header.includes("registr")) && header.includes("удостовер") && !header.includes("дата")) {
    return "registrationNumber";
  }
  if (header.includes("дата") && header.includes("изменен")) return "registrationChangeDate";
  if (header.includes("дата") && (header.includes("регис") || header.includes("перерегис"))) return "registrationDate";
  if (header.includes("услов") && header.includes("отпуск")) return "prescriptionStatus";
  if (aliasLookup.has(header)) return aliasLookup.get(header);
  for (const [alias, field] of aliasLookup) {
    if (header.includes(alias) || alias.includes(header)) return field;
  }
  return "";
}

function findHeaderRow(rows) {
  let best = { index: -1, score: 0, fields: [] };
  rows.slice(0, 50).forEach((row, index) => {
    const fields = row.map(headerField);
    const score = new Set(fields.filter(Boolean)).size;
    if (score > best.score) best = { index, score, fields };
  });
  return best.score >= 3 ? best : null;
}

function stableId(product) {
  const base = normalize(product.name)
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .slice(0, 48) || "medicine";
  const identity = [
    product.registrationNumber,
    product.name,
    product.dosageFormDetails,
    product.manufacturer,
  ].join("|");
  const suffix = crypto.createHash("sha1").update(identity).digest("hex").slice(0, 10);
  return `uz-${base}-${suffix}`;
}

function tradeName(raw) {
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const primary = lines.find((line) => !line.startsWith("(")) || "";
  return primary.replace(/\s+/g, " ").trim();
}

function canonicalForm(raw) {
  const value = normalize(raw);
  const forms = [
    ["таблет", "Таблетки"],
    ["капсул", "Капсулы"],
    ["лиофилизат", "Лиофилизат"],
    ["концентрат", "Концентрат"],
    ["раствор", "Раствор"],
    ["порош", "Порошок"],
    ["суспенз", "Суспензия"],
    ["сироп", "Сироп"],
    ["капл", "Капли"],
    ["спрей", "Спрей"],
    ["аэрозол", "Аэрозоль"],
    ["маз", "Мазь"],
    ["крем", "Крем"],
    ["гель", "Гель"],
    ["суппозитор", "Суппозитории"],
    ["пластыр", "Пластырь"],
    ["гранул", "Гранулы"],
    ["эмульс", "Эмульсия"],
    ["настойк", "Настойка"],
    ["масло", "Масло"],
    ["имплант", "Имплантат"],
    ["вакцин", "Вакцина"],
    ["газ", "Газ медицинский"],
  ];
  return forms.find(([token]) => value.includes(token))?.[1] || "Другая форма";
}

function extractDosage(raw) {
  const match = String(raw || "").match(
    /\d+(?:[.,]\d+)?\s*(?:мг\/мл|мкг\/мл|ме\/мл|мг\/доз[аы]?|мкг\/доз[аы]?|мг|мкг|ме|г|мл|%)/i,
  );
  return match ? match[0].replace(/\s+/g, " ").trim() : "";
}

function extractPackage(raw) {
  const match = String(raw || "").match(/(?:N|№)\s*\d+/i);
  return match ? match[0].replace(/\s+/g, "").replace(/^N/i, "№") : "";
}

function categoryFor(atcCode, group) {
  const categories = {
    A: "Пищеварительный тракт и обмен веществ",
    B: "Кровь и органы кроветворения",
    C: "Сердечно-сосудистая система",
    D: "Дерматология",
    G: "Мочеполовая система и половые гормоны",
    H: "Гормональные препараты системного действия",
    J: "Противомикробные препараты системного действия",
    L: "Противоопухолевые и иммуномодулирующие препараты",
    M: "Костно-мышечная система",
    N: "Нервная система",
    P: "Противопаразитарные препараты",
    R: "Дыхательная система",
    S: "Органы чувств",
    V: "Прочие препараты",
  };
  const first = String(atcCode || "").trim().charAt(0).toUpperCase();
  const latinFirst = ({ А: "A", В: "B", С: "C", Д: "D", Г: "G", Н: "H", Ж: "J", Л: "L", М: "M", Р: "P", Т: "T" })[first] || first;
  if (categories[latinFirst]) return categories[latinFirst];
  return "Не классифицировано";
}

function prescription(raw) {
  const value = normalize(raw);
  if (!value) return { prescriptionStatus: "Не указано", rxRequired: false };
  const rx = value.includes("рецепт") || value.includes("retsept");
  const otc = value.includes("без рецепт") || value.includes("retseptsiz") || value.includes("otc");
  if (otc) return { prescriptionStatus: "Без рецепта", rxRequired: false };
  if (rx) return { prescriptionStatus: "По рецепту", rxRequired: true };
  return { prescriptionStatus: String(raw).trim(), rxRequired: false };
}

function readProducts(fileName) {
  const workbook = XLSX.readFile(path.resolve(fileName), { cellDates: true });
  const products = [];
  workbook.SheetNames.forEach((sheetName) => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: "",
    });
    const header = findHeaderRow(rows);
    if (!header) return;
    rows.slice(header.index + 1).forEach((row) => {
      const data = {};
      header.fields.forEach((field, column) => {
        if (field && !data[field]) data[field] = String(row[column] ?? "").trim();
      });
      if (!data.name || normalize(data.name).includes("наименование")) return;
      const rx = prescription(data.prescriptionStatus);
      const name = tradeName(data.name);
      const dosageFormDetails = String(data.formDetails || "").replace(/\s+/g, " ").trim();
      const form = canonicalForm(dosageFormDetails);
      const dosage = extractDosage(dosageFormDetails);
      const packageSize = extractPackage(dosageFormDetails);
      const product = {
        name,
        fullTradeName: String(data.name || "").replace(/\s+/g, " ").trim(),
        subtitle: [dosage, form, packageSize].filter(Boolean).join(", "),
        mnn: data.mnn || "",
        ingredient: data.mnn || "",
        dosage,
        form,
        packageSize,
        dosageFormDetails,
        manufacturer: data.manufacturer || "",
        country: data.country || "",
        registrationNumber: data.registrationNumber || "",
        registrationDate: data.registrationDate || "",
        registrationChangeDate: data.registrationChangeDate || "",
        atcCode: data.atcCode || "",
        pharmacotherapeuticGroup: data.pharmacotherapeuticGroup || "",
        category: categoryFor(data.atcCode, data.pharmacotherapeuticGroup),
        ...rx,
        description: "",
        usage: "",
        composition: "",
        indications: "",
        contraindications: "",
        storageConditions: "",
        instructionUrl: "",
        images: [],
        sourceName,
        sourceUrl,
        sourceUpdatedAt: options.published || "",
        sourceDocument: path.basename(fileName),
        sourceVerified: true,
      };
      product.id = stableId(product);
      products.push(product);
    });
  });
  return products;
}

const byIdentity = new Map();
inputFiles.flatMap(readProducts).forEach((product) => {
  const key = normalize([
    product.registrationNumber,
    product.name,
    product.dosageFormDetails,
    product.manufacturer,
  ].join("|"));
  if (!key) return;
  byIdentity.set(key, { ...(byIdentity.get(key) || {}), ...product });
});

const products = Array.from(byIdentity.values()).sort((a, b) =>
  a.name.localeCompare(b.name, "ru") || a.registrationNumber.localeCompare(b.registrationNumber, "ru"));
const payload = {
  source: {
    name: sourceName,
    url: sourceUrl,
    edition: options.edition || "",
    publishedAt: options.published || "",
    importedAt: new Date().toISOString(),
    files: inputFiles.map((file) => path.basename(file)),
  },
  products,
};

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(
  outputFile,
  `window.DORIGO_UZ_CATALOG = ${JSON.stringify(payload, null, 2)};\n`,
  "utf8",
);
console.log(`Импортировано карточек: ${products.length}`);
console.log(`Файл каталога: ${outputFile}`);
