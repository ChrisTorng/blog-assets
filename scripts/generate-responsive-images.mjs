import { mkdir, readdir, rename, rm, writeFile } from "fs/promises";
import path from "path";
import sharp from "sharp";

const imageWidths = [320, 480, 768, 1024, 1280, 1600];
const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const outputFormats = [
  { key: "avif", extension: ".avif" },
  { key: "jpeg", extension: ".jpg" },
];
const assetRoot = process.cwd();
const sourceRoot = path.join(assetRoot, "images");
const outputRoot = path.join(assetRoot, "responsive");
const temporaryOutputRoot = path.join(assetRoot, ".responsive-build");
const websiteArg = process.argv.find((arg) =>
  arg.startsWith("--website-root="),
);
const websiteRoot = path.resolve(
  websiteArg?.slice("--website-root=".length) ||
    process.env.BLOG_REPO ||
    path.join(assetRoot, "..", "christorng.github.io"),
);
const manifestPath = path.join(websiteRoot, "data", "responsive-images.json");
const concurrency = Math.max(
  1,
  Number.parseInt(process.env.IMAGE_BUILD_CONCURRENCY || "4", 10),
);

function encodePath(relativePath) {
  return relativePath.split(path.sep).map(encodeURIComponent).join("/");
}

function originalUrl(relativePath) {
  return `/blog-assets/images/${encodePath(relativePath)}`;
}

function responsiveUrl(relativePath) {
  return `/blog-assets/responsive/${encodePath(relativePath)}`;
}

async function collectImageFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectImageFiles(absolutePath)));
    } else if (
      entry.isFile() &&
      supportedExtensions.has(path.extname(entry.name).toLowerCase())
    ) {
      files.push(absolutePath);
    }
  }

  return files;
}

async function resizeImage(sourcePath, width, format) {
  const image = sharp(sourcePath)
    .rotate()
    .resize({ width, withoutEnlargement: true });

  if (format === "avif") return image.avif({ quality: 58 }).toBuffer();

  return image
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

async function generateVariant(sourceMetadata, sourcePath, width, format) {
  const sourceRelative = path.relative(sourceRoot, sourcePath);
  const sourceDirectory = path.dirname(sourceRelative);
  const sourceBaseName = path.basename(
    sourceRelative,
    path.extname(sourceRelative),
  );
  const outputRelative = path.join(
    sourceDirectory,
    `${sourceBaseName}-${width}w${format.extension}`,
  );
  const outputPath = path.join(temporaryOutputRoot, outputRelative);
  const height = Math.max(
    1,
    Math.round((sourceMetadata.height * width) / sourceMetadata.width),
  );
  const resized = await resizeImage(sourcePath, width, format.key);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, resized);

  return { src: responsiveUrl(outputRelative), width, height };
}

async function generateImageEntry(sourcePath) {
  const sourceMetadata = await sharp(sourcePath).metadata();
  if (!sourceMetadata.width || !sourceMetadata.height) {
    throw new Error(
      `Unable to read dimensions: ${path.relative(assetRoot, sourcePath)}`,
    );
  }

  const sourceRelative = path.relative(sourceRoot, sourcePath);
  const widths = imageWidths.filter((width) => width < sourceMetadata.width);
  const formats = Object.fromEntries(
    outputFormats.map((format) => [format.key, []]),
  );

  for (const width of widths) {
    const variants = await Promise.all(
      outputFormats.map((format) =>
        generateVariant(sourceMetadata, sourcePath, width, format),
      ),
    );
    variants.forEach((variant, index) =>
      formats[outputFormats[index].key].push(variant),
    );
  }

  if (formats.jpeg.length === 0) {
    throw new Error(
      `Image is too small for responsive variants: ${sourceRelative}`,
    );
  }

  return {
    key: originalUrl(sourceRelative),
    entry: {
      width: sourceMetadata.width,
      height: sourceMetadata.height,
      formats,
      fallback: formats.jpeg[Math.max(0, formats.jpeg.length - 2)],
    },
    variantCount: widths.length * outputFormats.length,
  };
}

async function mapWithConcurrency(items, workerCount, callback) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await callback(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(workerCount, items.length) }, worker),
  );
  return results;
}

async function main() {
  const files = (await collectImageFiles(sourceRoot)).sort((a, b) =>
    a.localeCompare(b, "en"),
  );
  if (files.length === 0)
    throw new Error(`No source images found in ${sourceRoot}`);

  await rm(temporaryOutputRoot, { recursive: true, force: true });
  await mkdir(temporaryOutputRoot, { recursive: true });

  const results = await mapWithConcurrency(
    files,
    concurrency,
    generateImageEntry,
  );
  const manifest = Object.fromEntries(
    results.map(({ key, entry }) => [key, entry]),
  );
  const variantCount = results.reduce(
    (total, result) => total + result.variantCount,
    0,
  );

  await rm(outputRoot, { recursive: true, force: true });
  await rename(temporaryOutputRoot, outputRoot);
  await writeFile(
    `${manifestPath}.tmp`,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await rm(manifestPath, { force: true });
  await rename(`${manifestPath}.tmp`, manifestPath);

  console.log(
    `Generated ${variantCount} variants for ${files.length} source images`,
  );
  console.log(`Updated ${manifestPath}`);
}

main().catch(async (error) => {
  await rm(temporaryOutputRoot, { recursive: true, force: true }).catch(
    () => {},
  );
  console.error(error);
  process.exitCode = 1;
});
