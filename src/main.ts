import { initApp } from './app';
import { installGlobalErrorHandlers } from './logger';
import { initVisualViewport } from './viewport';
import './styles.css';

installGlobalErrorHandlers();
initVisualViewport();

const root = document.getElementById('app');
if (root) {
  void initApp(root);
}
