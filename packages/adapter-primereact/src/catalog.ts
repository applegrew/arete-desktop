import { Catalog } from '@a2ui/web_core/v0_9';
import type { ReactComponentImplementation } from '@a2ui/react/v0_9';
import { Text } from './components/Text';
import { Image } from './components/Image';
import { Card } from './components/Card';
import { Row } from './components/Row';
import { Column } from './components/Column';
import { Button } from './components/Button';
import { Divider } from './components/Divider';
import { TextField } from './components/TextField';
import { CheckBox } from './components/CheckBox';
import { Chart, ChartApi } from './components/Chart';
import { Embed, EmbedApi } from './components/Embed';
import { DataTable, DataTableApi } from './components/DataTable';
import { Form, FormApi } from './components/Form';

export { Text, Image, Card, Row, Column, Button, Divider, TextField, CheckBox, Chart, ChartApi, Embed, EmbedApi, DataTable, DataTableApi, Form, FormApi };

const COMPONENT_LIST: ReactComponentImplementation[] = [
  Text,
  Image,
  Card,
  Row,
  Column,
  Button,
  Divider,
  TextField,
  CheckBox,
  Chart,
  Embed,
  DataTable,
  Form,
];

export const primeReactCatalog = new Catalog<ReactComponentImplementation>(
  'https://a2ui.org/specification/v0_9/basic_catalog.json',
  COMPONENT_LIST,
);

/**
 * Agent-facing rendering notes per component — the gotchas an adapter author
 * knows about how a spec maps to pixels, surfaced into the agent's system
 * prompt so it can reason about the rendered result, not just prop shapes.
 */
export const componentAgentHints: Record<string, string> = {
  Chart:
    'bar/line: a single data series — the x-axis `labels` identify each bar and there is NO per-bar legend; put the heading in `title`. pie/doughnut: a legend is shown listing each `labels` entry. `labels` and `data` must be equal length. Set `action` to make segments clickable for drill-down.',
  Button:
    'set `action.event.name` to make it interactive; clicking dispatches that event back to you on the next turn.',
  TextField:
    'the field value binds through the surface data model (e.g. {path:"/field"}); read the current value from the data model, not from the component spec.',
  CheckBox: 'value is a boolean; like TextField it reflects live data-model state.',
  DataTable:
    'the canonical primitive for ANY tabular data or list of records (tickets, invoices, users…). Provide `columns` ([{field, header}]) and `data` (array of row objects keyed by each column `field`). Set `rowsPerPage` for built-in pagination — do NOT build your own pager with buttons. Columns sort by default. Set `action` to make rows clickable (auto-context {row, index}). For large datasets use lazy paging: `lazy:true` + `totalRecords` + `rowsPerPage` + `first` + `pageAction`, with only the current page in `data`; on the pageAction, update the same surface with the next page. Prefer this over Rows/Columns of Text or emoji for any grid/list of data.',
  Embed:
    'a sandboxed iframe the FRAMEWORK creates to render MCP-UI tool resources (HTML/URL). Do NOT emit Embed components yourself; they appear automatically when an MCP tool returns UI. You may reference an existing one if the user asks about it.',
  Form:
    'self-contained form for showing OR collecting a record\'s fields. Provide `fields` ([{name, label?, type?, value?, options?}]). Two variants via `readOnly`: set readOnly:true to DISPLAY a record (label/value pairs, no inputs) — use for "show details of X"; leave it false (default) for an EDITABLE form (create/edit) and set `action` + a submit button appears. On submit the auto-context is `{ values }` (each field name → current value), reported back to you on the next turn. Field `type`: text | number | longText | obscured | checkbox | select (with `options`: ["a","b"] or [{label,value}]). Prefer Form over hand-built Rows of TextFields for any "form", "edit", "create", or single-record detail view.',
};
