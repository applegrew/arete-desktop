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

export { Text, Image, Card, Row, Column, Button, Divider, TextField, CheckBox, Chart, ChartApi };

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
];

export const primeReactCatalog = new Catalog<ReactComponentImplementation>(
  'https://a2ui.org/specification/v0_9/basic_catalog.json',
  COMPONENT_LIST,
);
