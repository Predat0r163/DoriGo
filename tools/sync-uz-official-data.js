#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const API_URL = "https://uzpharm-control.uz/registries/api_mpip/server-response.php";
const DETAIL_URL = "https://uzpharm-control.uz/ru/registries/api-mpip/view";
const COLUMNS = [
  "DT_RowId",
  "box_group_id",
  "medicine_name",
  "inn_name",
  "box_group_id_display",
  "atc_code",
  "producer_name",
  "certificate_number",
  "links",
];

const args = process.argv.slice(2);
const options = Object.fromEntries(
  args
    .filter((arg) => arg.startsWith("--"))
    .map((arg) => {
      const [key, ...value] = arg.slice(2).split("=");
      return [key, value.join("=")];
    }),
);

const projectRoot = path.resolve(__dirname, "..");
const catalogFile = path.resolve(options.catalog || path.join(projectRoot, "assets/catalog/uzbekistan-drugs.js"));
const outputFile = path.resolve(options.output || path.join(projectRoot, "assets/catalog/uzbekistan-official-data.js"));
const cacheFile = path.resolve(options.cache || path.join(projectRoot, "data/registry-2026-30/official-api-cache.json"));
const detailCacheFile = path.resolve(
  options["detail-cache"] || path.join(projectRoot, "data/registry-2026-30/official-detail-cache.json"),
);
const reportFile = path.resolve(
  options.report || path.join(projectRoot, "data/registry-2026-30/official-sync-report.json"),
);
const chunkSize = Math.max(100, Number(options.chunk) || 5000);
const detailLimit = Math.max(0, Number(options.details) || 0);
const concurrency = Math.min(8, Math.max(1, Number(options.concurrency) || 4));
const minimumScore = Math.max(0, Number(options["min-score"]) || 12);
const refresh = options.refresh === "true";

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRegistration(value) {
  return String(value || "").toUpperCase().replace(/\s+/g, "");
}

function tokens(value) {
  return normalize(value).split(" ").filter((token) => token.length > 2);
}

function readAssignment(fileName, assignment) {
  const source = fs.readFileSync(fileName, "utf8");
  const marker = `window.${assignment} =`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`В ${fileName} не найдено присваивание ${marker}`);
  const jsonStart = source.indexOf("{", start + marker.length);
  const jsonEnd = source.lastIndexOf("};");
  if (jsonStart < 0 || jsonEnd < jsonStart) throw new Error(`Не удалось прочитать JSON из ${fileName}`);
  return JSON.parse(source.slice(jsonStart, jsonEnd + 1));
}

function readJson(fileName, fallback) {
  try {
    return JSON.parse(fs.readFileSync(fileName, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(fileName, value) {
  fs.mkdirSync(path.dirname(fileName), { recursive: true });
  fs.writeFileSync(fileName, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function apiUrl(start, length) {
  const params = new URLSearchParams({
    draw: "1",
    start: String(start),
    length: String(length),
    "search[value]": "",
    "search[regex]": "false",
    "order[0][column]": "0",
    "order[0][dir]": "asc",
  });
  COLUMNS.forEach((column, index) => {
    params.set(`columns[${index}][data]`, column);
    params.set(`columns[${index}][name]`, "");
    params.set(`columns[${index}][searchable]`, index === 1 || index === 8 ? "false" : "true");
    params.set(`columns[${index}][orderable]`, index === 8 ? "false" : "true");
    params.set(`columns[${index}][search][value]`, "");
    params.set(`columns[${index}][search][regex]`, "false");
  });
  return `${API_URL}?${params}`;
}

async function fetchText(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
          "User-Agent": "DoriGo registry synchronizer/1.0",
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 700));
    }
  }
  throw lastError;
}

async function fetchApiRows() {
  if (!refresh) {
    const cached = readJson(cacheFile, null);
    if (Array.isArray(cached?.rows) && cached.rows.length) {
      console.log(`Используется кэш официального API: ${cached.rows.length} строк`);
      return cached;
    }
  }

  const first = JSON.parse((await fetchText(apiUrl(0, chunkSize))).replace(/^\uFEFF/, ""));
  const total = Number(first.recordsTotal) || first.data.length;
  const rows = [...first.data];
  console.log(`Официальный API: получено ${rows.length} из ${total}`);

  for (let start = rows.length; start < total; start += chunkSize) {
    const page = JSON.parse((await fetchText(apiUrl(start, chunkSize))).replace(/^\uFEFF/, ""));
    rows.push(...page.data);
    console.log(`Официальный API: получено ${Math.min(rows.length, total)} из ${total}`);
  }

  const result = { fetchedAt: new Date().toISOString(), total, rows };
  writeJson(cacheFile, result);
  return result;
}

function matchScore(product, row) {
  const productName = normalize(product.name);
  const rowName = normalize(row.medicine_name);
  const productManufacturer = tokens(product.manufacturer);
  const rowManufacturer = normalize(row.producer_name);
  let score = 0;

  if (rowName === productName) score += 30;
  if (rowName.startsWith(productName) || productName.startsWith(rowName)) score += 14;
  tokens(product.name).forEach((token) => {
    if (rowName.includes(token)) score += 3;
  });
  if (product.dosage && rowName.includes(normalize(product.dosage))) score += 12;
  if (product.form && rowName.includes(normalize(product.form).replace(/ы$|и$|а$/u, ""))) score += 5;
  if (product.packageSize && normalize(row.medicine_name).includes(normalize(product.packageSize))) score += 3;
  if (product.atcCode && normalize(product.atcCode) === normalize(row.atc_code)) score += 6;
  productManufacturer.slice(0, 5).forEach((token) => {
    if (rowManufacturer.includes(token)) score += 2;
  });
  return score;
}

function rowLink(row) {
  const match = String(row.links || "").match(/href="([^"]+)"/i);
  return match?.[1]?.replaceAll("&amp;", "&") || `${DETAIL_URL}/${row.DT_RowId}`;
}

function buildMatches(products, rows) {
  const byRegistration = new Map();
  rows.forEach((row) => {
    const registration = normalizeRegistration(row.certificate_number);
    if (!registration) return;
    if (!byRegistration.has(registration)) byRegistration.set(registration, []);
    byRegistration.get(registration).push(row);
  });

  const matches = new Map();
  const rejected = [];
  products.forEach((product) => {
    const candidates = byRegistration.get(normalizeRegistration(product.registrationNumber)) || [];
    if (!candidates.length) {
      rejected.push({ product, reason: "registration_not_found", best: null });
      return;
    }
    const best = candidates
      .map((row) => ({ row, score: matchScore(product, row) }))
      .sort((a, b) => b.score - a.score || Number(a.row.DT_RowId) - Number(b.row.DT_RowId))[0];
    if (!best || best.score < minimumScore) {
      rejected.push({ product, reason: "low_confidence", best: best || null });
      return;
    }
    matches.set(product.id, best);
  });
  return { matches, rejected };
}

function extractDetail(html) {
  const links = Array.from(html.matchAll(/href="([^"]*download_medicine_file\?file_sha=\['([^']*)'\][^"]*)"/gi))
    .map((match) => ({ url: match[1].replaceAll("&amp;", "&"), sha: match[2] }))
    .filter((item) => item.sha);
  const rows = Array.from(html.matchAll(/<tr><td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td><\/tr>/gis));
  const plain = (value) => String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  const values = new Map(rows.map((match) => [plain(match[1]), plain(match[2])]));
  return {
    officialPackageName: values.get("Наименование упоковка") || "",
    officialRegistrationStartDate: values.get("Дата начала регистрационного удостоверения") || "",
    officialUpdatedAt: values.get("Oбновленная дата") || "",
    officialRetailPrice: values.get("Розничная цена") || "",
    instructionUrl: links[0]?.url || "",
    officialInstructionLanguage: links.length > 1 ? "ru/uz" : links.length ? "официальная" : "",
  };
}

function isoDate(value) {
  const match = String(value || "").match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}

async function mapLimit(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function enrichDetails(matches, patches) {
  const cache = readJson(detailCacheFile, {});
  if (detailLimit) {
    const pending = Array.from(matches.entries())
      .filter(([productId]) => !cache[productId])
      .sort(([, a], [, b]) => b.score - a.score || Number(a.row.DT_RowId) - Number(b.row.DT_RowId))
      .slice(0, detailLimit);

    let completed = 0;
    await mapLimit(pending, concurrency, async ([productId, match]) => {
      try {
        const html = await fetchText(rowLink(match.row));
        cache[productId] = {
          registryId: String(match.row.DT_RowId),
          fetchedAt: new Date().toISOString(),
          ...extractDetail(html),
        };
      } catch (error) {
        cache[productId] = {
          registryId: String(match.row.DT_RowId),
          fetchedAt: new Date().toISOString(),
          error: error.message,
        };
      }
      completed += 1;
      if (completed % 50 === 0 || completed === pending.length) {
        console.log(`Детальные карточки: ${completed} из ${pending.length}`);
        writeJson(detailCacheFile, cache);
      }
    });
  }

  Object.entries(cache).forEach(([productId, detail]) => {
    if (!patches[productId] || detail.error) return;
    Object.assign(patches[productId], {
      officialPackageName: detail.officialPackageName || patches[productId].officialPackageName,
      officialRegistrationStartDate: detail.officialRegistrationStartDate || "",
      officialUpdatedAt: detail.officialUpdatedAt || "",
      officialRetailPrice: detail.officialRetailPrice || "",
      instructionUrl: detail.instructionUrl || "",
      officialInstructionLanguage: detail.officialInstructionLanguage || "",
      sourceUpdatedAt: isoDate(detail.officialUpdatedAt) || patches[productId].sourceUpdatedAt,
    });
  });
}

async function main() {
  const catalog = readAssignment(catalogFile, "DORIGO_UZ_CATALOG");
  const api = await fetchApiRows();
  const { matches, rejected } = buildMatches(catalog.products, api.rows);
  const patches = {};

  matches.forEach(({ row, score }, productId) => {
    patches[productId] = {
      officialRegistryId: String(row.DT_RowId),
      officialPackageId: String(row.box_group_id_display || row.box_group_id || ""),
      officialPackageName: String(row.medicine_name || ""),
      officialMedicineName: String(row.medicine_name || ""),
      officialMatchScore: score,
      officialSyncedAt: api.fetchedAt,
      sourceUrl: rowLink(row),
    };
  });

  await enrichDetails(matches, patches);

  const payload = {
    source: {
      name: "Центр безопасности фармацевтической продукции Республики Узбекистан",
      apiUrl: API_URL,
      fetchedAt: api.fetchedAt,
      totalPackages: api.total,
      matchedProducts: matches.size,
    },
    products: patches,
  };

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(
    outputFile,
    `window.DORIGO_UZ_OFFICIAL_DATA = ${JSON.stringify(payload, null, 2)};\n`,
    "utf8",
  );
  writeJson(reportFile, {
    generatedAt: new Date().toISOString(),
    minimumScore,
    matched: matches.size,
    rejected: rejected.map(({ product, reason, best }) => ({
      id: product.id,
      name: product.name,
      subtitle: product.subtitle,
      registrationNumber: product.registrationNumber,
      manufacturer: product.manufacturer,
      reason,
      bestScore: best?.score ?? null,
      bestOfficialName: best?.row?.medicine_name || "",
      bestOfficialUrl: best ? rowLink(best.row) : "",
    })),
  });
  console.log(`Сопоставлено карточек: ${matches.size} из ${catalog.products.length}`);
  console.log(`Требуют ручной проверки: ${rejected.length}`);
  console.log(`Файл официальных данных: ${outputFile}`);
  console.log(`Отчёт: ${reportFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
