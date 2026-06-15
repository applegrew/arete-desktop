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
import { Calendar, CalendarApi } from './components/Calendar';
import { InputNumber, InputNumberApi } from './components/InputNumber';
import { Slider, SliderApi } from './components/Slider';
import { Rating, RatingApi } from './components/Rating';
import { InputSwitch, InputSwitchApi } from './components/InputSwitch';
import { Password, PasswordApi } from './components/Password';
import { Chips, ChipsApi } from './components/Chips';
import { ColorPicker, ColorPickerApi } from './components/ColorPicker';
import { InputMask, InputMaskApi } from './components/InputMask';
import { InputOtp, InputOtpApi } from './components/InputOtp';
import { MultiSelect, MultiSelectApi } from './components/MultiSelect';
import { AutoComplete, AutoCompleteApi } from './components/AutoComplete';
import { RadioButton, RadioButtonApi } from './components/RadioButton';
import { SelectButton, SelectButtonApi } from './components/SelectButton';
import { CascadeSelect, CascadeSelectApi } from './components/CascadeSelect';
import { TreeSelect, TreeSelectApi } from './components/TreeSelect';
import { ProgressBar, ProgressBarApi } from './components/ProgressBar';
import { ProgressSpinner, ProgressSpinnerApi } from './components/ProgressSpinner';
import { Avatar, AvatarApi, AvatarGroup, AvatarGroupApi } from './components/Avatar';
import { Message, MessageApi, Messages, MessagesApi } from './components/Message';
import { Toast, ToastApi } from './components/Toast';
import { Panel, PanelApi } from './components/Panel';
import { Fieldset, FieldsetApi } from './components/Fieldset';
import { ScrollPanel, ScrollPanelApi } from './components/ScrollPanel';
import { Accordion, AccordionApi } from './components/Accordion';
import { TabView, TabViewApi } from './components/TabView';
import { Splitter, SplitterApi } from './components/Splitter';
import { Toolbar, ToolbarApi } from './components/Toolbar';
import { Timeline, TimelineApi } from './components/Timeline';
import { DataView, DataViewApi } from './components/DataView';
import { OrganizationChart, OrganizationChartApi } from './components/OrganizationChart';
import { Carousel, CarouselApi } from './components/Carousel';
import { Galleria, GalleriaApi } from './components/Galleria';
import { OrderList, OrderListApi } from './components/OrderList';
import { PickList, PickListApi } from './components/PickList';

export { Text, Image, Card, Row, Column, Button, Divider, TextField, CheckBox, Chart, ChartApi, Embed, EmbedApi, DataTable, DataTableApi, Form, FormApi, Calendar, CalendarApi, InputNumber, InputNumberApi, Slider, SliderApi, Rating, RatingApi, InputSwitch, InputSwitchApi, Password, PasswordApi, Chips, ChipsApi, ColorPicker, ColorPickerApi, InputMask, InputMaskApi, InputOtp, InputOtpApi, MultiSelect, MultiSelectApi, AutoComplete, AutoCompleteApi, RadioButton, RadioButtonApi, SelectButton, SelectButtonApi, CascadeSelect, CascadeSelectApi, TreeSelect, TreeSelectApi, ProgressBar, ProgressBarApi, ProgressSpinner, ProgressSpinnerApi, Avatar, AvatarApi, AvatarGroup, AvatarGroupApi, Message, MessageApi, Messages, MessagesApi, Toast, ToastApi, Panel, PanelApi, Fieldset, FieldsetApi, ScrollPanel, ScrollPanelApi, Accordion, AccordionApi, TabView, TabViewApi, Splitter, SplitterApi, Toolbar, ToolbarApi, Timeline, TimelineApi, DataView, DataViewApi, OrganizationChart, OrganizationChartApi, Carousel, CarouselApi, Galleria, GalleriaApi, OrderList, OrderListApi, PickList, PickListApi };

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
  Calendar,
  InputNumber,
  Slider,
  Rating,
  InputSwitch,
  Password,
  Chips,
  ColorPicker,
  InputMask,
  InputOtp,
  MultiSelect,
  AutoComplete,
  RadioButton,
  SelectButton,
  CascadeSelect,
  TreeSelect,
  ProgressBar,
  ProgressSpinner,
  Avatar,
  AvatarGroup,
  Message,
  Messages,
  Toast,
  Panel,
  Fieldset,
  ScrollPanel,
  Accordion,
  TabView,
  Splitter,
  Toolbar,
  Timeline,
  DataView,
  OrganizationChart,
  Carousel,
  Galleria,
  OrderList,
  PickList,
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
    'self-contained form for showing OR collecting a record\'s fields. Provide `fields` ([{name, label?, type?, value?, options?}]). Two variants via `readOnly`: set readOnly:true to DISPLAY a record (label/value pairs, no inputs) — use for "show details of X"; leave it false (default) for an EDITABLE form (create/edit) and set `action` + a submit button appears. On submit the auto-context is `{ values }` (each field name → current value), reported back to you on the next turn. Field `type`: text | number | longText | richText | obscured | checkbox | select (with `options`: ["a","b"] or [{label,value}]). Use `richText` for a WYSIWYG editor (bold/italic/lists/links) whose value is an HTML string — for rich notes/descriptions/replies. Prefer Form over hand-built Rows of TextFields for any "form", "edit", "create", or single-record detail view.',
  Calendar:
    'a date picker. Set `selectionMode`: "single" (one date), "multiple" (array of dates), or "range" (two-date tuple). Use `minDate`/`maxDate` for bounds. Set `showTime` for time selection. Set `action` to get the selected date(s) back on change.',
  InputNumber:
    'numeric input with increment/decrement buttons. Set `min`, `max`, `step`. Use `currency` + `locale` for currency formatting. Set `prefix`/`suffix` for symbols. Set `action` for change events.',
  Slider:
    'range slider. Set `min`, `max`, `step`. `orientation`: "horizontal" (default) or "vertical" (set height via inline style). Set `action` for change events.',
  Rating:
    'star rating input. `stars` (default 5), `cancel` (allow deselect, default true), `readonly` to display only. Set `action` for change events.',
  InputSwitch:
    'toggle switch (boolean). Set `label` for adjacent text. Set `action` for change events with auto-context `{ value }`.',
  Password:
    'password input with built-in strength meter. Set `feedback:true` (default) for the strength bar, `toggleMask` for show/hide icon. Set `action` for change events.',
  Chips:
    'tag/token entry — type and press enter to add chips. `value`: string array, `max`: limit chips, `separator`: split char (default comma). Set `action` for change events.',
  ColorPicker:
    'color picker (popup or inline). `format`: "hex" (default), "rgb", or "hsb". Set `inline:true` to show the picker without a popup. Set `action` for change events.',
  InputMask:
    'masked text input. `mask` is required (e.g. "(999) 999-9999", "99-999999"). `slotChar` (default "_") is the placeholder character. Set `action` for change events.',
  InputOtp:
    'OTP (one-time password) input with separate character slots. `length` (default 4), `mask:true` to hide characters, `integerOnly` for digits only. Set `action` for change events.',
  MultiSelect:
    'multi-select dropdown with checkboxes. `options`: array of strings or [{label, value}]. `filter:true` for search. Set `action` for change events.',
  AutoComplete:
    'type-ahead input with suggestion dropdown. `suggestions`: array of items to search against. `field`: key into suggestion objects for display. `multiple:true` for multiple values. Set `action` for selection events.',
  RadioButton:
    'radio button group. `options`: array of strings or [{label, value}]. The selected `value` is reported on change. Set `action` for selection events.',
  SelectButton:
    'segmented button group (toggle bar). `options`: [{label, value}]. `multiple:true` for multi-select. Set `action` for selection events.',
  CascadeSelect:
    'cascading/hierarchical dropdown. `options`: tree of objects with `label` + `children` keys. Set `action` for selection events.',
  TreeSelect:
    'tree-structured dropdown with expandable nodes. `options`: tree array. `selectionMode`: "single", "multiple", or "checkbox". `filter:true` for search. Set `action` for selection events.',
  ProgressBar:
    'progress bar. `value`: 0-100. `mode`: "determinate" (default) or "indeterminate" (ignores value). `showValue` displays the percentage label. Set `color` for custom bar color.',
  ProgressSpinner:
    'spinning loading indicator. `strokeWidth` (default "2"), `animationDuration` (default "2s"). Set `label` for descriptive text below.',
  Avatar:
    'circular or square avatar. Show `label` (initials), `icon` (primeicons class), or `image` (URL). `shape`: "circle" (default) or "square". `size`: "normal", "large", "xlarge".',
  AvatarGroup:
    'overlapping group of avatars. `items`: array of avatar objects ({label?, icon?, image?, shape?, size?}).',
  Message:
    'single inline message banner. `severity`: "success", "info", "warn", or "error". `text` is the message. Optionally set `icon`.',
  Messages:
    'stack of multiple message banners. `items`: array of message objects ({severity?, text, icon?}).',
  Toast:
    'popup toast notification that auto-dismisses. `summary` (title), `detail` (body), `severity`, `life` (ms, default 3000), `sticky:true` to stay until dismissed. `position`: "top-right" (default), "top-left", "bottom-right", "bottom-left", "top-center", "bottom-center".',
  Panel:
    'collapsible content panel with header. `header` (title), `child` (component ID to render inside), `toggleable` for collapse/expand, `collapsed` for initial state.',
  Fieldset:
    'grouped field container with legend border. `legend` (title), `child` (component ID), `toggleable`, `collapsed`. Use for grouping form fields.',
  ScrollPanel:
    'scrollable container with custom scrollbars. `child`: component ID. `style.width`/`style.height` control dimensions (default 100% × 200px).',
  Accordion:
    'vertical accordion with expandable sections. `tabs`: [{header, child?, icon?, disabled?}]. `multiple:true` to allow multiple sections open. `activeIndex` for programmatic control.',
  TabView:
    'tabbed container with horizontal tabs. `tabs`: [{header, child?, icon?, disabled?}]. `activeIndex` (0-based). `scrollable:true` for overflow tabs.',
  Splitter:
    'resizable split panels. `panels`: [{child?, size?, minSize?}]. `layout`: "horizontal" (default) or "vertical". Each `size` is a percentage of total.',
  Toolbar:
    'toolbar with left/center/right sections. `left`, `center`, `right`: arrays of component IDs. Use for action bars, headers, or status strips.',
  Timeline:
    'vertical or horizontal timeline. `items`: [{icon?, color?, label?, content?, child?}]. `align`: "left", "right", or "alternate". `layout`: "vertical" (default) or "horizontal".',
  DataView:
    'flexible data list/grid with optional pagination. `data`: array of objects. `layout`: "list" (default) or "grid". `paginator:true` + `rows` for paging. `rowsPerPageOptions`: [5,10,25].',
  OrganizationChart:
    'hierarchical org chart. `value`: tree node with `label`, `children`, optional `title`, `image`. `collapsible` to toggle branches. `selectionMode`: "single" or "multiple". Set `action` for node click.',
  Carousel:
    'rotating carousel of child components. `items`: array of component IDs. `numVisible` (default 1), `numScroll`, `circular`, `autoplayInterval` (ms).',
  Galleria:
    'image/content gallery with thumbnails. `items`: array of component IDs. `showThumbnails` (default true), `circular`, `autoplayInterval`.',
  OrderList:
    'reorderable list with up/down buttons and drag-drop. `value` or `options`: array of items. `dragdrop:true` for drag reorder. `filter:false` to hide search. Set `action` for order change events.',
  PickList:
    'dual list transfer (pick) component — move items between source and target. `source`: available items array, `target`: selected items array. `sourceHeader`/`targetHeader` for column labels. `filter:false` to hide search. Set `action` for transfer events.',
};
