import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

const ResourceName = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, 'Must be lowercase letters, digits and dashes');

/**
 * A feature's `feature.json`: what infra needs to deploy it and route traffic
 * to it. Plain data with no secrets, since the handler bundles it.
 */
export const FeatureManifest = z.strictObject({
  /** Lambda and construct name, e.g. 'auth'. Only used for AWS resource names. */
  name: ResourceName,
  /** API version the feature's routes live under, e.g. 'v1'. */
  version: z.string().regex(/^v[1-9]\d*$/, "Must look like 'v1'"),
  /** Path under the version, e.g. '/auth'. No trailing slash. */
  prefix: z
    .string()
    .regex(/^(\/[a-z0-9-]+)+$/, "Must look like '/auth' (lowercase, no trailing slash)"),
  /** Lambda entry file, relative to the folder holding `feature.json`. */
  handler: z.string().min(1),
  /** The DynamoDB table this feature uses. Features naming the same table share it. Defaults to no table. */
  table: ResourceName.optional(),
});
export type FeatureManifest = z.infer<typeof FeatureManifest>;

/** A manifest read from disk, plus where it was found. */
export interface LoadedFeatureManifest extends FeatureManifest {
  /** Absolute path of the feature's folder. */
  readonly dir: string;
  /** Absolute path of the Lambda entry file. */
  readonly entry: string;
}

/** Validates manifest data, throwing a readable error naming `source`. */
export function parseManifest(data: unknown, source = 'feature.json'): FeatureManifest {
  const result = FeatureManifest.safeParse(data);
  if (!result.success) throw new Error(`Invalid ${source}:\n${z.prettifyError(result.error)}`);
  return result.data;
}

/** Reads and validates `<dir>/feature.json` and checks its handler file exists. For infra and scripts. */
export function loadManifest(featureDir: string): LoadedFeatureManifest {
  const dir = resolve(featureDir);
  const file = join(dir, 'feature.json');
  const manifest = parseManifest(JSON.parse(readFileSync(file, 'utf8')), file);
  const entry = join(dir, manifest.handler);
  if (!existsSync(entry)) throw new Error(`Invalid ${file}: handler not found at ${entry}`);
  return { ...manifest, dir, entry };
}

/** The public path a feature's routes are mounted at, e.g. '/v1/auth'. */
export function publicPath(manifest: FeatureManifest): string {
  return `/${manifest.version}${manifest.prefix}`;
}
