import { initApp } from './app';
import './styles.css';

const root = document.getElementById('app');
if (root) {
  void initApp(root);
}
