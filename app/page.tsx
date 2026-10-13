import type { Viewport } from 'next';
import { env } from 'cloudflare:workers';
import Workbench from '../components/workbench/Workbench';
import './globals.css';
import '../components/workbench/workbench.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#ffffff',
};

/**
 * Fictional demo (?demo=1) is opt-in per deployment: set DOT_WORKBENCH_ALLOW_DEMO=1.
 * Unset (default) = live only; ?demo=1 is ignored.
 */
function allowDemo(): boolean {
  try {
    return (env as { DOT_WORKBENCH_ALLOW_DEMO?: string }).DOT_WORKBENCH_ALLOW_DEMO === '1';
  } catch {
    return false;
  }
}

export default function Page() {
  return <Workbench allowDemo={allowDemo()} endpoint="/api/state" />;
}
