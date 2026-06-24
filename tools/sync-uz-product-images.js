#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const APTEKA_API = "https://main.apteka.uz/api/v1";
const APTEKA_SITE = "https://apteka.uz";
const APTEKA_MEDIA = "https://main.apteka.uz";
const GOPHARM_SITE = "https://gopharm.uz";
const GOPHARM_MEDIA = "https://cdn.gopharm.uz/drugs";

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
const outputFile = path.resolve(options.output || path.join(projectRoot, "assets/catalog/uzbekistan-product-images.js"));
const assetRoot = path.resolve(options.assets || path.join(projectRoot, "assets/products"));
const cacheFile = path.resolve(options.cache || path.join(projectRoot, "data/product-images/apteka-cache.json"));
const reportFile = path.resolve(options.report || path.join(projectRoot, "data/product-images/sync-report.json"));
const curatedFile = path.resolve(options.curated || path.join(projectRoot, "data/product-images/curated-sources.json"));
const concurrency = Math.min(5, Math.max(1, Number(options.concurrency) || 3));
const refresh = options.refresh === "true";
const maximumProducts = Math.max(1, Number(options.limit) || 180);
const requestedIds = new Set(
  String(options.ids || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const defaultTerms = [
  "Ибупрофен",
  "Парацетамол",
  "Нурофен",
  "Но-шпа",
  "Амоксициллин",
  "Азитромицин",
  "Цефтриаксон",
  "Цетиризин",
  "Лоратадин",
  "Кеторолак",
  "Диклофенак",
  "Нимесулид",
  "Цитрамон",
  "Аскорбиновая кислота",
  "Омепразол",
  "Метформин",
  "Каптоприл",
  "Эналаприл",
  "Амброксол",
  "Флуконазол",
  "Левомеколь",
  "Хлоргексидин",
  "Пантенол",
  "Линекс",
  "Регидрон",
  "Смекта",
  "Називин",
  "Спазмалгон",
  "Панадол",
  "Терафлю",
];

const searchTerms = String(options.terms || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (!searchTerms.length) searchTerms.push(...defaultTerms);

function readAssignment(fileName, assignment) {
  const source = fs.readFileSync(fileName, "utf8");
  const marker = `window.${assignment} =`;
  const start = source.indexOf(marker);
  const jsonStart = source.indexOf("{", start + marker.length);
  const jsonEnd = source.lastIndexOf("};");
  if (start < 0 || jsonStart < 0 || jsonEnd < jsonStart) {
    throw new Error(`Не удалось прочитать ${assignment} из ${fileName}`);
  }
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

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;quot;/gi, '"')
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&#039;/gi, "'");
}

function normalize(value) {
  return decodeEntities(value)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[®™]/g, "")
    .replace(/№/g, " n")
    .replace(/[^\p{L}\p{N}.,%/+]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value) {
  return normalize(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

function significantTokens(value) {
  const ignored = new Set([
    "ооо", "оао", "пао", "ао", "чao", "чао", "зао", "руп", "сп", "ооd", "ltd", "limited",
    "company", "pharm", "фарма", "завод", "медицинских", "препаратов", "узбекистан", "россия",
    "республика", "произведено", "healthcare", "international",
  ]);
  return normalize(value)
    .split(" ")
    .map((token) => token.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((token) => token.length >= 4 && !ignored.has(token));
}

function numberValue(raw) {
  const value = Number(String(raw || "").replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function canonicalAmount(rawNumber, rawUnit) {
  const value = numberValue(rawNumber);
  if (value === null) return "";
  const unit = normalize(rawUnit).replace(/\s/g, "");
  if (unit === "г" || unit === "g") return `${Math.round(value * 1000)}mg`;
  if (unit === "мг" || unit === "mg") return `${value}mg`;
  if (unit === "мкг" || unit === "mcg" || unit === "µg") return `${value}mcg`;
  if (unit === "мл" || unit === "ml") return `${value}ml`;
  if (unit === "ме" || unit === "iu") return `${value}iu`;
  if (unit === "%") return `${value}%`;
  return "";
}

function dosageTokens(value) {
  const text = normalize(value);
  const result = [];
  const ratioPattern = /(\d+(?:[.,]\d+)?)\s*(мкг|мг|г|ме|mcg|mg|g|iu)\s*\/\s*(?:(\d+(?:[.,]\d+)?)\s*)?(мл|ml|доз\w*)/giu;
  for (const match of text.matchAll(ratioPattern)) {
    const numerator = canonicalAmount(match[1], match[2]);
    const denominator = canonicalAmount(match[3] || "1", match[4].startsWith("доз") ? "ml" : match[4]);
    if (numerator && denominator) result.push(`${numerator}/${denominator}`);
  }
  const amountPattern = /(\d+(?:[.,]\d+)?)\s*(мкг|мг|г|мл|ме|mcg|mg|g|ml|iu|%)/giu;
  for (const match of text.matchAll(amountPattern)) {
    const amount = canonicalAmount(match[1], match[2]);
    if (amount && !result.some((item) => item.startsWith(`${amount}/`))) result.push(amount);
  }
  return Array.from(new Set(result));
}

function packageNumber(value) {
  const match = normalize(value).match(/(?:^|\s)n\s*(\d+)(?:\s|$)/i);
  return match ? Number(match[1]) : null;
}

function formFamily(value) {
  const text = normalize(value);
  const forms = [
    ["tablet", ["таблет", "tab"]],
    ["capsule", ["капсул", "caps"]],
    ["suspension", ["суспенз", "susp"]],
    ["solution", ["раствор", "solution", "sol"]],
    ["syrup", ["сироп", "syrup"]],
    ["drops", ["капл", "drops"]],
    ["spray", ["спрей", "spray"]],
    ["gel", ["гель", "gel"]],
    ["ointment", ["мазь", "ointment"]],
    ["cream", ["крем", "cream"]],
    ["powder", ["порош", "powder"]],
    ["suppository", ["суппозитор", "свеч"]],
    ["aerosol", ["аэрозол"]],
    ["lozenge", ["пастил", "леденц"]],
  ];
  return forms.find(([, tokens]) => tokens.some((token) => text.includes(token)))?.[0] || "";
}

function nameMatch(product, candidate) {
  const productName = compact(product.name);
  const brandName = compact(candidate.brand_name || candidate.name);
  const candidateName = compact(candidate.name);
  return Boolean(
    productName
    && (productName === brandName
      || candidateName.startsWith(productName)
      || productName.startsWith(brandName)
      || (productName.length >= 8 && candidateName.includes(productName))),
  );
}

function manufacturerMatch(product, candidate) {
  const expected = significantTokens(product.manufacturer);
  const actual = significantTokens(candidate.manufacturer_plain);
  if (!expected.length || !actual.length) return false;
  return expected.some((left) => actual.some((right) => left === right || left.startsWith(right) || right.startsWith(left)));
}

function compareIdentity(product, candidate) {
  const expectedDoses = dosageTokens([product.dosage, product.dosageFormDetails, product.subtitle].filter(Boolean).join(" "));
  const candidateDoses = dosageTokens(candidate.name);
  const expectedForm = formFamily([product.form, product.dosageFormDetails].filter(Boolean).join(" "));
  const candidateForm = formFamily(candidate.name);
  const expectedPack = packageNumber([product.packageSize, product.dosageFormDetails].filter(Boolean).join(" "));
  const candidatePack = packageNumber(candidate.name);
  const checks = {
    name: nameMatch(product, candidate),
    dosage: expectedDoses.length > 0
      ? candidateDoses.length > 0
        && expectedDoses.every((dose) => candidateDoses.includes(dose))
      : candidateDoses.length === 0,
    form: Boolean(expectedForm && candidateForm && expectedForm === candidateForm),
    package: expectedPack === null || (candidatePack !== null && expectedPack === candidatePack),
    manufacturer: manufacturerMatch(product, candidate),
  };
  return {
    accepted: Object.values(checks).every(Boolean),
    checks,
    expected: {
      name: product.name || "",
      dosage: expectedDoses.join(", "),
      form: expectedForm,
      packageSize: expectedPack ? `№${expectedPack}` : "",
      manufacturer: product.manufacturer || "",
    },
    actual: {
      name: candidate.name || "",
      dosage: candidateDoses.join(", "),
      form: candidateForm,
      packageSize: candidatePack ? `№${candidatePack}` : "",
      manufacturer: decodeEntities(candidate.manufacturer_plain || ""),
    },
  };
}

async function fetchResponse(url, accept = "*/*", attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: accept,
          "User-Agent": "DoriGo verified product image synchronizer/1.0",
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError;
}

async function fetchJson(url) {
  return (await fetchResponse(url, "application/json")).json();
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

function imageExtension(contentType, url) {
  if (contentType.includes("webp") || /\.webp(?:$|\?)/i.test(url)) return ".webp";
  if (contentType.includes("png") || /\.png(?:$|\?)/i.test(url)) return ".png";
  return ".jpg";
}

function validImage(buffer, contentType) {
  if (buffer.length < 2500 || !contentType.startsWith("image/")) return false;
  const webp = buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") === "WEBP";
  const png = buffer.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  return webp || png || jpeg;
}

async function downloadImage(url, productId, index) {
  const response = await fetchResponse(url, "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5");
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!validImage(buffer, contentType)) throw new Error("Файл не прошёл проверку формата изображения");
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const extension = imageExtension(contentType, url);
  const productDirectory = path.join(assetRoot, productId);
  const fileName = `${String(index + 1).padStart(2, "0")}-${hash.slice(0, 10)}${extension}`;
  const absolutePath = path.join(productDirectory, fileName);
  fs.mkdirSync(productDirectory, { recursive: true });
  fs.writeFileSync(absolutePath, buffer);
  return {
    hash,
    bytes: buffer.length,
    src: path.relative(projectRoot, absolutePath).replaceAll(path.sep, "/"),
  };
}

async function searchApteka(term, cache) {
  const key = normalize(term);
  if (!refresh && Array.isArray(cache.searches?.[key])) return cache.searches[key];
  const url = `${APTEKA_API}/search/drugs?q=${encodeURIComponent(term)}&page=1&per_page=50`;
  const payload = await fetchJson(url);
  if (!cache.searches) cache.searches = {};
  cache.searches[key] = Array.isArray(payload.data) ? payload.data : [];
  return cache.searches[key];
}

async function detailApteka(slug, cache) {
  if (!refresh && cache.details?.[slug]) return cache.details[slug];
  const payload = await fetchJson(`${APTEKA_API}/drugs/${encodeURIComponent(slug)}`);
  if (!cache.details) cache.details = {};
  cache.details[slug] = payload.data || {};
  return cache.details[slug];
}

function candidateForProduct(product, candidates) {
  const checked = candidates
    .filter((candidate) => candidate.image)
    .map((candidate) => ({ candidate, identity: compareIdentity(product, candidate) }));
  const accepted = checked.filter((item) => item.identity.accepted);
  if (accepted.length !== 1) {
    return {
      match: null,
      reason: accepted.length > 1 ? "ambiguous_exact_matches" : "no_strict_match",
      checked,
    };
  }
  return { match: accepted[0], reason: "", checked };
}

async function main() {
  const catalog = readAssignment(catalogFile, "DORIGO_UZ_CATALOG");
  const existingManifest = fs.existsSync(outputFile)
    ? readAssignment(outputFile, "DORIGO_UZ_PRODUCT_IMAGES")
    : { source: {}, products: {} };
  const cache = readJson(cacheFile, { searches: {}, details: {} });
  const curatedSources = readJson(curatedFile, {});
  const terms = searchTerms.map((value) => ({ raw: value, normalized: normalize(value) }));
  const candidatesByTerm = new Map();

  await mapLimit(terms, concurrency, async (term, index) => {
    const candidates = await searchApteka(term.raw, cache);
    candidatesByTerm.set(term.normalized, candidates);
    console.log(`Поиск ${index + 1}/${terms.length}: ${term.raw} — ${candidates.length}`);
  });
  writeJson(cacheFile, cache);

  const selected = [];
  for (const product of catalog.products) {
    if (requestedIds.size && !requestedIds.has(product.id)) continue;
    const productName = normalize(product.name);
    const term = terms.find((item) => productName.includes(item.normalized));
    if (term || requestedIds.has(product.id)) {
      selected.push({ product, candidates: term ? candidatesByTerm.get(term.normalized) || [] : [] });
    }
    if (selected.length >= maximumProducts) break;
  }

  const products = {};
  const report = {
    generatedAt: new Date().toISOString(),
    sources: [APTEKA_SITE, GOPHARM_SITE],
    selected: selected.length,
    matched: [],
    rejected: [],
  };

  let completed = 0;
  await mapLimit(selected, concurrency, async ({ product, candidates }) => {
    const curated = Array.isArray(curatedSources[product.id]) ? curatedSources[product.id] : [];
    const result = candidateForProduct(product, candidates);
    if (!result.match && !curated.length) {
      report.rejected.push({
        id: product.id,
        name: product.name,
        dosage: product.dosage,
        form: product.form,
        packageSize: product.packageSize,
        manufacturer: product.manufacturer,
        reason: result.reason,
        closest: result.checked
          .sort((a, b) => Object.values(b.identity.checks).filter(Boolean).length - Object.values(a.identity.checks).filter(Boolean).length)
          .slice(0, 3)
          .map((item) => ({ slug: item.candidate.slug, ...item.identity })),
      });
      return;
    }

    const candidate = result.match?.candidate || null;
    const identity = result.match?.identity || {
      actual: {
        name: product.name,
        dosage: product.dosage,
        form: product.form,
        packageSize: product.packageSize,
        manufacturer: product.manufacturer,
      },
      checks: {
        exactCatalogId: true,
        curatedSources: true,
      },
    };
    try {
      const detail = candidate ? await detailApteka(candidate.slug, cache) : null;
      const sourceImages = [];
      if (candidate?.image) {
        sourceImages.push({
          url: `${APTEKA_MEDIA}/${candidate.image.replace(/^\/+/, "")}`,
          sourceName: "Apteka.uz",
          sourceUrl: `${APTEKA_SITE}/offer/${candidate.slug}`,
          name: "Упаковка препарата",
        });
      }
      if (detail?.stores_apteka_slug) {
        sourceImages.push({
          url: `${GOPHARM_MEDIA}/${detail.stores_apteka_slug}.webp`,
          sourceName: "GoPharm.uz",
          sourceUrl: `${GOPHARM_SITE}/product/${detail.stores_apteka_slug}`,
          name: "Упаковка препарата, альтернативный снимок",
        });
      }
      curated.forEach((image) => {
        if (!image?.url || !image?.sourceUrl) return;
        sourceImages.push({
          url: image.url,
          sourceName: image.sourceName || "Проверенный открытый источник",
          sourceUrl: image.sourceUrl,
          name: image.name || "Дополнительный вид упаковки",
        });
      });

      const images = [];
      const hashes = new Set();
      for (const sourceImage of sourceImages) {
        try {
          const downloaded = await downloadImage(sourceImage.url, product.id, images.length);
          if (hashes.has(downloaded.hash)) continue;
          hashes.add(downloaded.hash);
          images.push({
            src: downloaded.src,
            name: sourceImage.name,
            sourceName: sourceImage.sourceName,
            sourceUrl: sourceImage.sourceUrl,
            verified: true,
            sha256: downloaded.hash,
            bytes: downloaded.bytes,
          });
        } catch (error) {
          report.rejected.push({
            id: product.id,
            name: product.name,
            reason: "image_download_failed",
            imageUrl: sourceImage.url,
            error: error.message,
          });
        }
      }

      if (!images.length) return;
      products[product.id] = {
        images,
        imageMatch: {
          verified: true,
          checkedAt: new Date().toISOString(),
          matchedName: identity.actual.name,
          dosage: product.dosage || identity.actual.dosage,
          form: product.form || identity.actual.form,
          packageSize: product.packageSize || identity.actual.packageSize,
          manufacturer: product.manufacturer || identity.actual.manufacturer,
          sourceProductId: candidate ? String(candidate.id) : `curated:${product.id}`,
        },
      };
      report.matched.push({
        id: product.id,
        name: product.name,
        candidate: candidate?.name || product.name,
        slug: candidate?.slug || "",
        images: images.length,
        identity,
      });
    } finally {
      completed += 1;
      if (completed % 10 === 0 || completed === selected.length) {
        console.log(`Карточки: ${completed}/${selected.length}, подтверждено: ${report.matched.length}`);
      }
    }
  });

  writeJson(cacheFile, cache);
  const mergedProducts = {
    ...(existingManifest.products || {}),
    ...products,
  };
  const payload = {
    source: {
      generatedAt: new Date().toISOString(),
      policy: "Название, дозировка, форма, упаковка и производитель должны совпасть.",
      providers: [
        { name: "Apteka.uz", url: APTEKA_SITE },
        { name: "GoPharm.uz", url: GOPHARM_SITE },
      ],
      matchedProducts: Object.keys(mergedProducts).length,
    },
    products: mergedProducts,
  };

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(
    outputFile,
    `window.DORIGO_UZ_PRODUCT_IMAGES = ${JSON.stringify(payload, null, 2)};\n`,
    "utf8",
  );
  writeJson(reportFile, report);
  console.log(`Подтверждено в этой партии: ${Object.keys(products).length}`);
  console.log(`Всего карточек с фото: ${Object.keys(mergedProducts).length}`);
  console.log(`Манифест: ${outputFile}`);
  console.log(`Отчёт: ${reportFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
