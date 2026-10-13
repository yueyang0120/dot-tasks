export function assertNodeVersion(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    throw new Error('DOT Tasks needs Node.js 22.13 or newer. Install a current Node.js LTS release, then retry.');
  }
}

export function selectMode(args, saved = null) {
  const unknown = args.filter(arg => !['--demo', '--empty'].includes(arg));
  if (unknown.length || (args.includes('--demo') && args.includes('--empty'))) {
    throw new Error('Usage: npm run setup [-- --demo | --empty]');
  }
  if (args.includes('--empty')) return 'empty';
  if (args.includes('--demo')) return 'demo';
  return saved?.mode === 'empty' ? 'empty' : 'demo';
}
