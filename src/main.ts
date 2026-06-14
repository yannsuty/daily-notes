import { initApp } from './app';
import { initVisualViewport } from './viewport';
import './styles.css';

initVisualViewport();

const root = document.getElementById('app');
if (root) {
  void initApp(root);
}
