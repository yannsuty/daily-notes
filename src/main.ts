import { initApp } from './app';
import { initVisualViewport } from './viewport';
import { initSentry } from './sentry';
import './styles.css';

initSentry();
initVisualViewport();

const root = document.getElementById('app');
if (root) {
  void initApp(root);
}
