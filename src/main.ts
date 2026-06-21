import { initApp } from './app';
import { initVisualViewport } from './viewport';
import { initSentry, isNativeAndroid } from './sentry';
import './styles.css';

if (isNativeAndroid()) {
  initSentry();
}

initVisualViewport();

const root = document.getElementById('app');
if (root) {
  void initApp(root);
}
