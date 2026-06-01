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

export { Text, Image, Card, Row, Column, Button, Divider, TextField, CheckBox, Chart, ChartApi, Embed, EmbedApi };

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
  Embed:
    'a sandboxed iframe the FRAMEWORK creates to render MCP-UI tool resources (HTML/URL). Do NOT emit Embed components yourself; they appear automatically when an MCP tool returns UI. You may reference an existing one if the user asks about it.',
};
