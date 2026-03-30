import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';

const requiredFiles = [
  'dist/manifest.json',
  'dist/background.js',
  'dist/popup.html',
];

async function ensureFile(path) {
  await access(path, constants.R_OK);
}

function fail(message) {
  console.error(`\n[verify-extension-build] ${message}`);
  process.exitCode = 1;
}

async function main() {
  for (const file of requiredFiles) {
    try {
      await ensureFile(file);
    } catch {
      fail(`Missing ${file}. Run \`npm run build\` and load \`dist/\` as unpacked extension.`);
      return;
    }
  }

  const manifestText = await readFile('dist/manifest.json', 'utf8');
  const manifest = JSON.parse(manifestText);
  const serviceWorker = manifest?.background?.service_worker;

  if (!serviceWorker) {
    fail('dist/manifest.json has no background.service_worker entry.');
    return;
  }

  try {
    await ensureFile(`dist/${serviceWorker}`);
  } catch {
    fail(
      `Service worker file dist/${serviceWorker} is missing. This often causes \"Service worker registration failed. Status code: 3\".`,
    );
    return;
  }

  console.log('[verify-extension-build] Build output looks valid.');
  console.log('[verify-extension-build] Load the unpacked extension from dist/ (not project root or public/).');
}

await main();
