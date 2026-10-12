import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const PROJECT_ROOT = process.cwd();
const BACKUP_MEDIA_DIR = path.join(PROJECT_ROOT, "backup/media");
const PUBLIC_MEDIA_DIR = path.join(PROJECT_ROOT, "public/media");
const MANIFEST_PATH = path.join(PROJECT_ROOT, "src/_data/mediaManifest.json");

function getSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash("sha256");
  hashSum.update(fileBuffer);
  return hashSum.digest("hex");
}

function restoreFiles(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) {
    console.error(`Backup directory not found: ${srcDir}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      count += restoreFiles(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(srcPath, destPath);
      const sz = fs.statSync(destPath).size;
      const relPath = path.relative(PROJECT_ROOT, destPath);
      console.log(`Restored: ${relPath} (${(sz / (1024 * 1024)).toFixed(2)} MB)`);
      count++;
    }
  }

  return count;
}

function updateManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.warn(`Manifest not found at ${MANIFEST_PATH}, skipping manifest update.`);
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  let updatedCount = 0;

  for (const asset of manifest.assets) {
    const fullPath = path.join(PROJECT_ROOT, asset.filePath);
    if (fs.existsSync(fullPath)) {
      const stats = fs.statSync(fullPath);
      const sha256 = getSha256(fullPath);
      if (asset.fileSize !== stats.size || asset.sha256 !== sha256) {
        asset.fileSize = stats.size;
        asset.sha256 = sha256;
        updatedCount++;
      }
    }
  }

  manifest.totalBytes = manifest.assets.reduce((acc, a) => acc + (a.fileSize || 0), 0);
  manifest.generatedAt = new Date().toISOString();

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`Updated manifest with ${updatedCount} recalculated entries.`);
  console.log(`Total verified bytes: ${(manifest.totalBytes / (1024 * 1024)).toFixed(2)} MB`);
}

function main() {
  console.log(`=== Restoring Media from ${path.relative(PROJECT_ROOT, BACKUP_MEDIA_DIR)} ===\n`);
  const restored = restoreFiles(BACKUP_MEDIA_DIR, PUBLIC_MEDIA_DIR);
  console.log(`\nSuccessfully restored ${restored} file(s) from backup.`);

  console.log("\n=== Updating mediaManifest.json ===");
  updateManifest();
}

main();
