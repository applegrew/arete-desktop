import type { PageOpName } from '../types/page-ops';

/**
 * JSON schemas for every page operation. These are published verbatim so consumers
 * can wrap them into an agent toolset (parallel to A2UI's `SendA2uiToClientToolset`)
 * without hand-rolling each schema.
 */
export const pageOpSchemas: Record<PageOpName, Record<string, unknown>> = {
  pinSurface: {
    name: 'pinSurface',
    type: 'object',
    required: ['surfaceId', 'pageId'],
    properties: {
      surfaceId: { type: 'string', description: 'Source surface (typically a chat-scroll surface)' },
      pageId: { type: 'string', description: 'Target Page tab id' },
      region: {
        type: 'string',
        description: 'Optional explicit region id; harness picks first empty region if omitted',
      },
    },
    additionalProperties: false,
  },
  unpinSurface: {
    name: 'unpinSurface',
    type: 'object',
    required: ['surfaceId', 'pageId'],
    properties: {
      surfaceId: { type: 'string' },
      pageId: { type: 'string', description: 'Target Page tab id' },
    },
    additionalProperties: false,
  },
  setPageLayout: {
    name: 'setPageLayout',
    type: 'object',
    required: ['pageId', 'layout'],
    properties: {
      pageId: { type: 'string' },
      layout: {
        type: 'object',
        required: ['kind'],
        oneOf: [
          {
            properties: {
              kind: { const: 'grid' },
              rows: { type: 'integer', minimum: 1 },
              cols: { type: 'integer', minimum: 1 },
              regions: { type: 'array', items: { $ref: '#/$defs/region' } },
            },
            required: ['kind', 'rows', 'cols', 'regions'],
          },
          {
            properties: {
              kind: { const: 'split' },
              direction: { enum: ['row', 'column'] },
              regions: { type: 'array', items: { $ref: '#/$defs/region' } },
            },
            required: ['kind', 'direction', 'regions'],
          },
          {
            properties: {
              kind: { const: 'dock' },
              regions: { type: 'array', items: { $ref: '#/$defs/region' } },
            },
            required: ['kind', 'regions'],
          },
        ],
      },
    },
    $defs: {
      region: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
          gridArea: { type: 'string' },
        },
      },
    },
    additionalProperties: false,
  },
  moveSurface: {
    name: 'moveSurface',
    type: 'object',
    required: ['surfaceId', 'pageId', 'targetRegion'],
    properties: {
      surfaceId: { type: 'string' },
      pageId: { type: 'string', description: 'Target Page tab id' },
      targetRegion: { type: 'string' },
    },
    additionalProperties: false,
  },
  setPageRegion: {
    name: 'setPageRegion',
    type: 'object',
    required: ['pageId', 'regionId'],
    properties: {
      pageId: { type: 'string' },
      regionId: { type: 'string' },
      surfaceId: { type: ['string', 'null'] },
    },
    additionalProperties: false,
  },
};
