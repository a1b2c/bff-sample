import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FeatureManifest, loadManifest, parseManifest, publicPath } from '../src/index.ts';

const valid: FeatureManifest = {
  name: 'auth',
  version: 'v1',
  prefix: '/auth',
  handler: 'src/auth.handler.ts',
};

describe('parseManifest', () => {
  it('returns a valid manifest unchanged', () => {
    expect(parseManifest(valid)).toEqual(valid);
  });

  it('accepts multi-digit versions and nested prefixes', () => {
    expect(() => parseManifest({ ...valid, version: 'v12', prefix: '/admin/users' })).not.toThrow();
  });

  it.each(['1', 'v0', 'V1', 'v1.0', 'v'])('rejects version %j', (version) => {
    expect(() => parseManifest({ ...valid, version })).toThrow(/at version/);
  });

  it.each(['auth', '/', '/auth/', '/Auth', '/auth//users', '/auth_x'])(
    'rejects prefix %j',
    (prefix) => {
      expect(() => parseManifest({ ...valid, prefix })).toThrow(/at prefix/);
    },
  );

  it.each(['Auth', '1auth', 'auth_x', ''])('rejects name %j', (name) => {
    expect(() => parseManifest({ ...valid, name })).toThrow(/at name/);
  });

  it('rejects unknown keys, so typos are caught', () => {
    expect(() => parseManifest({ ...valid, verison: 'v1' })).toThrow(/Unrecognized key: "verison"/);
  });

  it('rejects missing fields', () => {
    const { handler: _handler, ...withoutHandler } = valid;
    expect(() => parseManifest(withoutHandler)).toThrow(/at handler/);
  });

  it('names the source in the error', () => {
    expect(() => parseManifest({}, 'features/auth/feature.json')).toThrow(
      /^Invalid features\/auth\/feature\.json:/,
    );
  });
});

describe('loadManifest', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'feature-manifest-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeFeature(manifest: unknown, handlerFile: string | null = valid.handler) {
    writeFileSync(join(dir, 'feature.json'), JSON.stringify(manifest));
    if (handlerFile) {
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, handlerFile), '');
    }
  }

  it('returns the manifest with absolute dir and entry paths', () => {
    writeFeature(valid);

    const loaded = loadManifest(dir);

    expect(loaded).toMatchObject(valid);
    expect(loaded.dir).toBe(dir);
    expect(loaded.entry).toBe(join(dir, 'src', 'auth.handler.ts'));
  });

  it('resolves a relative folder to absolute paths', () => {
    writeFeature(valid);

    const loaded = loadManifest(relative(process.cwd(), dir));

    expect(isAbsolute(loaded.dir)).toBe(true);
    expect(isAbsolute(loaded.entry)).toBe(true);
  });

  it('throws when the handler file does not exist', () => {
    writeFeature(valid, null);
    expect(() => loadManifest(dir)).toThrow(/handler not found at .*auth\.handler\.ts/);
  });

  it('throws with the file path when the manifest is invalid', () => {
    writeFeature({ ...valid, version: 'one' });
    expect(() => loadManifest(dir)).toThrow(/feature\.json:[\s\S]*at version/);
  });

  it('throws when feature.json is missing', () => {
    expect(() => loadManifest(dir)).toThrow(/ENOENT/);
  });
});

describe('publicPath', () => {
  it('joins version and prefix', () => {
    expect(publicPath(valid)).toBe('/v1/auth');
    expect(publicPath({ ...valid, version: 'v2', prefix: '/admin/users' })).toBe('/v2/admin/users');
  });
});
