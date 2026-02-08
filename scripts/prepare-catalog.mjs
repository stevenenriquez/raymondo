import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const generatedPath = resolve('src/data/catalog.generated.json');
const fallbackPath = resolve('src/data/catalog.sample.json');
const remoteUrl = process.env.CATALOG_URL;

async function writeCatalog(payload) {
  const parsed = JSON.parse(payload);
  if (!Array.isArray(parsed.projects)) {
    throw new Error('Catalog payload is missing a projects array.');
  }
  await writeFile(generatedPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
}

async function main() {
  if (remoteUrl) {
    const response = await fetch(remoteUrl, { headers: { 'cache-control': 'no-cache' } });
    if (!response.ok) {
      throw new Error(`Failed to fetch CATALOG_URL (${response.status})`);
    }

    const text = await response.text();
    await writeCatalog(text);
    console.log(`Catalog fetched from ${remoteUrl}`);
    return;
  }

  const fallback = await readFile(fallbackPath, 'utf8');
  await writeCatalog(fallback);
  console.log('Catalog prepared from local fallback data.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
