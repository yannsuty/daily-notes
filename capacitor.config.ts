import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'fr.dailynote.app',
  appName: 'Daily Note',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
