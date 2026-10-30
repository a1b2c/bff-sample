import { describe, expect, it } from 'vitest';
import { createCatalogService } from '../src/catalog.service.ts';

describe('catalog service', () => {
  it('ping reports the catalog feature as up', () => {
    expect(createCatalogService().ping()).toEqual({ status: 'ok', feature: 'catalog' });
  });
});
