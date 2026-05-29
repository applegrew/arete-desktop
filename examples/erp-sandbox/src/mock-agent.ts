import type { A2uiMessage } from '@a2ui/web_core/v0_9';
import { basicCatalog } from '@a2ui/react/v0_9';

const CATALOG_ID = basicCatalog.id;

let surfaceCounter = 0;
const nextSurfaceId = (prefix: string) => `${prefix}-sfc-${++surfaceCounter}`;

export interface ContentEmission {
  kind: 'a2ui';
  targetSurfaceId: string;
  messages: A2uiMessage[];
}

export interface PageOpEmission {
  kind: 'pageOp';
  op:
    | { name: 'pinSurface'; surfaceId: string; pageId: string; region?: string }
    | { name: 'unpinSurface'; surfaceId: string; pageId: string }
    | { name: 'moveSurface'; surfaceId: string; pageId: string; targetRegion: string }
    | { name: 'setPageRegion'; pageId: string; regionId: string; surfaceId: string | null }
    | {
        name: 'setPageLayout';
        pageId: string;
        layout: {
          kind: 'grid';
          rows: number;
          cols: number;
          regions: { id: string }[];
        };
      };
}

export type Emission = ContentEmission | PageOpEmission;

export interface FixtureContext {
  chatSurfaceIds: string[];
  recentPinnedSurfaceId: string | null;
}

export interface Fixture {
  id: string;
  prompt: string;
  build: (ctx: FixtureContext) => Emission[];
}

const cardComponents = (titleText: string, bodyText: string) => [
  { id: 'root', component: 'Card', child: 'inner-column' },
  { id: 'inner-column', component: 'Column', children: ['title-text', 'body-text'] },
  { id: 'title-text', component: 'Text', text: titleText, variant: 'h3' },
  { id: 'body-text', component: 'Text', text: bodyText },
];

export const reshapeReportsAs3x3: Fixture = {
  id: 'reports-3x3',
  prompt: 'Make Reports a 3x3 grid',
  build: () => [
    {
      kind: 'pageOp',
      op: {
        name: 'setPageLayout',
        pageId: 'reports',
        layout: {
          kind: 'grid',
          rows: 3,
          cols: 3,
          regions: Array.from({ length: 9 }, (_, i) => ({ id: `r${i}` })),
        },
      },
    },
  ],
};

const addInvoices: Fixture = {
  id: 'add-invoices',
  prompt: 'Add an outstanding-invoices panel',
  build: () => {
    const sid = nextSurfaceId('invoices');
    return [
      {
        kind: 'a2ui',
        targetSurfaceId: sid,
        messages: [
          {
            version: 'v0.9',
            createSurface: { surfaceId: sid, catalogId: CATALOG_ID },
          },
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId: sid,
              components: cardComponents(
                'Outstanding invoices',
                '3 invoices overdue · $12,400 total',
              ),
            },
          } as A2uiMessage,
        ] as A2uiMessage[],
      },
    ];
  },
};

const addKpi: Fixture = {
  id: 'add-kpi',
  prompt: 'Show KPI summary',
  build: () => {
    const sid = nextSurfaceId('kpi');
    return [
      {
        kind: 'a2ui',
        targetSurfaceId: sid,
        messages: [
          {
            version: 'v0.9',
            createSurface: { surfaceId: sid, catalogId: CATALOG_ID },
          } as A2uiMessage,
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId: sid,
              components: cardComponents('Quarterly KPI', 'Revenue +12% · NPS 58'),
            },
          } as A2uiMessage,
        ],
      },
    ];
  },
};

const swapKpi: Fixture = {
  id: 'swap-kpi',
  prompt: 'Swap KPI card body to sparkline',
  build: ({ recentPinnedSurfaceId }) =>
    recentPinnedSurfaceId
      ? [
          {
            kind: 'a2ui',
            targetSurfaceId: recentPinnedSurfaceId,
            messages: [
              {
                version: 'v0.9',
                updateComponents: {
                  surfaceId: recentPinnedSurfaceId,
                  components: [
                    {
                      id: 'body-text',
                      component: 'Text',
                      text: 'Revenue trending up ▁▂▄▆█▇',
                    },
                  ],
                },
              } as A2uiMessage,
            ],
          },
        ]
      : [],
};

const groupApprovals: Fixture = {
  id: 'group-approvals',
  prompt: 'Group approvals by urgency',
  build: () => {
    const sid = nextSurfaceId('approvals');
    return [
      {
        kind: 'a2ui',
        targetSurfaceId: sid,
        messages: [
          {
            version: 'v0.9',
            createSurface: { surfaceId: sid, catalogId: CATALOG_ID },
          },
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId: sid,
              components: [
                { id: 'root', component: 'Column', children: ['c1', 'c2', 'c3'] },
                { id: 'c1', component: 'Card', child: 'col1' },
                { id: 'col1', component: 'Column', children: ['t1', 'b1'] },
                { id: 't1', component: 'Text', text: 'Urgent', variant: 'h3' },
                { id: 'b1', component: 'Text', text: '2 approvals needed' },
                { id: 'c2', component: 'Card', child: 'col2' },
                { id: 'col2', component: 'Column', children: ['t2', 'b2'] },
                { id: 't2', component: 'Text', text: 'This week', variant: 'h3' },
                { id: 'b2', component: 'Text', text: '5 approvals pending' },
                { id: 'c3', component: 'Card', child: 'col3' },
                { id: 'col3', component: 'Column', children: ['t3', 'b3'] },
                { id: 't3', component: 'Text', text: 'Later', variant: 'h3' },
                { id: 'b3', component: 'Text', text: '3 approvals queued' },
              ],
            },
          } as A2uiMessage,
        ],
      },
    ];
  },
};

const pinSecondCard: Fixture = {
  id: 'pin-second',
  prompt: 'Pin the second card to Tickets',
  build: ({ chatSurfaceIds }) => {
    const sid = chatSurfaceIds[1];
    if (!sid) return [];
    return [
      {
        kind: 'pageOp',
        op: { name: 'pinSurface', surfaceId: sid, pageId: 'tickets' },
      },
    ];
  },
};

export const fixtures: Fixture[] = [
  addInvoices,
  addKpi,
  swapKpi,
  groupApprovals,
  pinSecondCard,
  reshapeReportsAs3x3,
];

export function findFixture(prompt: string): Fixture | undefined {
  const lc = prompt.toLowerCase();
  if (lc.includes('grid') || lc.includes('3x3')) return reshapeReportsAs3x3;
  if (lc.includes('sparkline') || lc.includes('swap')) return swapKpi;
  if (lc.includes('group') || lc.includes('approval') || lc.includes('urgency'))
    return groupApprovals;
  if (lc.includes('second') || lc.includes('pin the')) return pinSecondCard;
  return fixtures.find((f) => lc.includes(f.id.split('-')[1] ?? f.id));
}
