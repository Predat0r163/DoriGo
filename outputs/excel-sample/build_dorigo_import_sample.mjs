import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const outputDir = __dirname;
const outputPath = path.join(outputDir, "dorigo-example-pharmacy-upload.xlsx");
const previewPath = path.join(outputDir, "dorigo-example-pharmacy-upload.png");

const catalogText = await fs.readFile(path.join(projectRoot, "assets/catalog/uzbekistan-drugs.js"), "utf8");
const jsonText = catalogText
  .replace(/^window\.DORIGO_UZ_CATALOG\s*=\s*/, "")
  .replace(/;\s*$/, "");
const catalog = JSON.parse(jsonText);
const products = Array.isArray(catalog.products) ? catalog.products : [];

const normalize = (value) => String(value || "").toLowerCase().replaceAll("ё", "е");
const used = new Set();
const findProduct = (spec) => {
  if (spec.id) return products.find((product) => product.id === spec.id);
  const terms = (spec.terms || []).map(normalize);
  const product = products.find((item) => {
    if (used.has(item.id)) return false;
    const haystack = normalize([
      item.name,
      item.fullTradeName,
      item.subtitle,
      item.mnn,
      item.ingredient,
      item.dosage,
      item.form,
    ].join(" "));
    return terms.every((term) => haystack.includes(term));
  });
  return product || null;
};

const specs = [
  { id: "uz-ибупрофен-efbbf794c9", barcode: "478001000001", price: 6000, purchase: 4200, stock: 24, expiry: "12.2026" },
  { id: "uz-парацетамол-76642dde2d", barcode: "478001000002", price: 4500, purchase: 2800, stock: 36, expiry: "10.2026" },
  { id: "uz-амброксол-e06150d041", barcode: "478001000003", price: 12500, purchase: 8500, stock: 18, expiry: "07.2026" },
  { id: "uz-цетиризин-дс-adf9407d90", barcode: "478001000004", price: 7200, purchase: 4700, stock: 15, expiry: "09.2026" },
  { terms: ["цитрамон"], barcode: "478001000005", price: 7200, purchase: 4100, stock: 22, expiry: "08.2026" },
  { terms: ["диклофенак"], barcode: "478001000006", price: 9800, purchase: 6400, stock: 16, expiry: "11.2026" },
  { terms: ["кеторолак"], barcode: "478001000007", price: 8200, purchase: 5200, stock: 12, expiry: "06.2026" },
  { terms: ["омепразол"], barcode: "478001000008", price: 14500, purchase: 9200, stock: 20, expiry: "12.2026" },
  { terms: ["но-шпа"], barcode: "478001000009", price: 18500, purchase: 12100, stock: 10, expiry: "05.2026" },
  { terms: ["амоксициллин"], barcode: "478001000010", price: 19800, purchase: 13200, stock: 8, expiry: "07.2026" },
  { terms: ["лоратадин"], barcode: "478001000011", price: 6800, purchase: 4300, stock: 25, expiry: "03.2027" },
  { terms: ["аскорбин"], barcode: "478001000012", price: 3000, purchase: 1600, stock: 40, expiry: "04.2027" },
  { terms: ["називин"], barcode: "478001000013", price: 16000, purchase: 10400, stock: 14, expiry: "09.2026" },
];

const headers = [
  "ID DoriGo",
  "Штрихкод",
  "Название",
  "МНН",
  "Дозировка",
  "Форма",
  "Количество в упаковке",
  "Производитель",
  "Категория",
  "Цена",
  "Закупочная цена",
  "Остаток",
  "Рецептурность",
  "Срок годности",
];

const rows = specs
  .map((spec) => {
    const product = findProduct(spec);
    if (!product || used.has(product.id)) return null;
    used.add(product.id);
    return [
      product.id,
      spec.barcode,
      product.name || "",
      product.mnn || product.ingredient || "",
      product.dosage || "",
      product.form || "",
      product.packageSize || "",
      product.manufacturer || "",
      product.category || "",
      spec.price,
      spec.purchase,
      spec.stock,
      product.prescriptionStatus || (product.rxRequired ? "По рецепту" : "Без рецепта"),
      spec.expiry,
    ];
  })
  .filter(Boolean)
  .slice(0, 12);

if (rows.length < 8) {
  throw new Error(`Too few catalog matches for a useful sample: ${rows.length}`);
}

const workbook = Workbook.create();
workbook.comments.setSelf({ displayName: "DoriGo" });
const sheet = workbook.worksheets.add("Товары");
sheet.showGridLines = false;
sheet.getRange("B:B").format.numberFormat = "@";
sheet.getRange("N:N").format.numberFormat = "@";

const matrix = [headers, ...rows];
sheet.getRangeByIndexes(0, 0, matrix.length, headers.length).values = matrix;
sheet.getRangeByIndexes(1, 1, rows.length, 1).formulas = rows.map((row) => [`="${row[1]}"`]);
sheet.freezePanes.freezeRows(1);

const usedRange = sheet.getRangeByIndexes(0, 0, matrix.length, headers.length);
usedRange.format.borders = { preset: "inside", style: "thin", color: "#E5EAF3" };
sheet.getRange("A1:N1").format = {
  fill: "#07A85A",
  font: { bold: true, color: "#FFFFFF" },
  wrapText: true,
};
sheet.getRange(`A2:I${matrix.length}`).format = { wrapText: true };
sheet.getRange(`B2:B${matrix.length}`).format.numberFormat = "@";
sheet.getRange(`J2:L${matrix.length}`).format.numberFormat = "#,##0";
sheet.getRange(`N2:N${matrix.length}`).format.numberFormat = "@";
sheet.getRange("A:A").format.columnWidth = 28;
sheet.getRange("B:B").format.columnWidth = 16;
sheet.getRange("C:C").format.columnWidth = 24;
sheet.getRange("D:D").format.columnWidth = 18;
sheet.getRange("E:E").format.columnWidth = 13;
sheet.getRange("F:F").format.columnWidth = 16;
sheet.getRange("G:G").format.columnWidth = 18;
sheet.getRange("H:H").format.columnWidth = 28;
sheet.getRange("I:I").format.columnWidth = 22;
sheet.getRange("J:L").format.columnWidth = 14;
sheet.getRange("M:M").format.columnWidth = 16;
sheet.getRange("N:N").format.columnWidth = 14;

const tableRange = `A1:N${matrix.length}`;
const table = sheet.tables.add(tableRange, true, "DorigoUpload");
table.style = "TableStyleMedium4";

const note = workbook.worksheets.add("Инструкция");
note.showGridLines = false;
note.getRange("A1:D1").merge();
note.getRange("A1").values = [["DoriGo: пример загрузки товаров аптеки"]];
note.getRange("A1").format = {
  fill: "#EAF8F0",
  font: { bold: true, color: "#062456", size: 16 },
};
note.getRange("A3:B9").values = [
  ["Что делать", "Откройте кабинет аптеки → Товары и остатки → Загрузить Excel."],
  ["Главный лист", "Загрузчик читает первый лист: Товары."],
  ["ID DoriGo", "Главный ключ. По нему система сопоставляет строку с единым каталогом."],
  ["Цена / Остаток", "Это данные конкретной аптеки, их можно менять."],
  ["Срок годности", "Формат ММ.ГГГГ, например 12.2026."],
  ["Новые препараты", "Аптека не создает карточку препарата, а подключает существующую из каталога."],
  ["Источник каталога", catalog.source?.url || "https://uzpharm-control.uz/"],
];
note.getRange("A3:B9").format = { wrapText: true };
note.getRange("A3:A9").format = {
  fill: "#F4F7FB",
  font: { bold: true, color: "#062456" },
};
note.getRange("A:A").format.columnWidth = 24;
note.getRange("B:B").format.columnWidth = 86;

const inspect = await workbook.inspect({
  kind: "table",
  sheetId: "Товары",
  range: `A1:N${Math.min(matrix.length, 8)}`,
  include: "values",
  tableMaxRows: 8,
  tableMaxCols: 14,
  maxChars: 5000,
});
console.log(inspect.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 20 },
  summary: "formula error scan",
});
console.log(errors.ndjson);

const preview = await workbook.render({
  sheetName: "Товары",
  range: `A1:N${matrix.length}`,
  scale: 1,
  format: "png",
});
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(`Saved ${outputPath}`);
