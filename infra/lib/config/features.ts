import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type LoadedFeatureManifest, loadManifest } from '@repo/feature-manifest';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Every feature in `features/`, so adding a feature needs no infra change. */
export function loadFeatures(): LoadedFeatureManifest[] {
  const featuresDir = join(REPO_ROOT, 'features');
  return readdirSync(featuresDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => loadManifest(join(featuresDir, entry.name)));
}
