/**
 * Bundle Daemon
 *
 * Uses esbuild to bundle the Fastify daemon into a single ESM file
 * (dist-daemon/daemon.js). Resolves all workspace dependencies.
 *
 * Packages with native bindings or WASM are NOT bundled — they are
 * copied to dist-daemon/node_modules/ by this script.
 *
 * After copying, @electron/rebuild rebuilds native .node files for
 * the target Electron version so serial port access works in the app.
 *
 * Run with: pnpm build:daemon
 */

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const DAEMON_DIR = path.join(ROOT_DIR, 'packages', 'daemon');
const OUT_DIR = path.join(ROOT_DIR, 'dist-daemon');

// Packages with native bindings or WASM that esbuild cannot inline.
// These are copied to dist-daemon/node_modules/ instead.
const EXTERNAL_PACKAGES = [
  '@electric-sql/pglite',
  '@meshtastic/transport-node-serial',
  'serialport',
];

// Windows reserved filenames that cause NSIS packaging failures
const EXCLUDE_FILES = new Set(['nul', 'con', 'prn', 'aux']);

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`  Warning: Source not found: ${src}`);
    return;
  }
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (EXCLUDE_FILES.has(entry.name.toLowerCase())) continue;

    if (entry.isSymbolicLink()) {
      const real = fs.realpathSync(srcPath);
      if (fs.statSync(real).isDirectory()) {
        copyDir(real, destPath);
      } else {
        fs.copyFileSync(real, destPath);
      }
      continue;
    }

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function resolvePackagePath(packageName) {
  // pnpm stores packages in node_modules/.pnpm; workspace packages expose
  // them via symlinks in each package's own node_modules.
  const candidates = [
    path.join(DAEMON_DIR, 'node_modules', packageName),
    path.join(ROOT_DIR, 'node_modules', packageName),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.realpathSync(candidate);
    }
  }
  return null;
}

function getElectronVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  const version = (pkg.devDependencies || {}).electron || '';
  // Strip semver range prefix (^, ~, >=, etc.)
  return version.replace(/^[^0-9]*/, '');
}

async function bundle() {
  console.log('');
  console.log('========================================');
  console.log('  Bundle Daemon (esbuild)');
  console.log('========================================');
  console.log('');

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1. Bundle daemon TypeScript to ESM JS
  const result = await esbuild.build({
    entryPoints: [path.join(DAEMON_DIR, 'src', 'index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: path.join(OUT_DIR, 'daemon.js'),

    external: EXTERNAL_PACKAGES,

    // esbuild needs createRequire available for any CJS sub-dependencies
    banner: {
      js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
    },

    sourcemap: false,
    minify: false,
    treeShaking: true,
    logLevel: 'info',
  });

  if (result.errors.length > 0) {
    console.error('Build errors:', result.errors);
    process.exit(1);
  }

  const stats = fs.statSync(path.join(OUT_DIR, 'daemon.js'));
  console.log(`\n  Output: dist-daemon/daemon.js (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);

  // 2. Write package.json so Node treats the bundle as ESM
  fs.writeFileSync(path.join(OUT_DIR, 'package.json'), JSON.stringify({
    name: 'meshtastic-foreman-server',
    version: JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')).version,
    type: 'module',
    private: true
  }, null, 2) + '\n');

  // 3. Copy external packages to dist-daemon/node_modules/
  console.log('\n  Copying external packages...');
  const nmDir = path.join(OUT_DIR, 'node_modules');
  if (fs.existsSync(nmDir)) fs.rmSync(nmDir, { recursive: true, force: true });
  fs.mkdirSync(nmDir, { recursive: true });

  for (const pkg of EXTERNAL_PACKAGES) {
    const real = resolvePackagePath(pkg);
    if (real) {
      copyDir(real, path.join(nmDir, pkg));
      console.log(`    Copied: ${pkg}`);
    } else {
      console.warn(`    Not found (skipping): ${pkg}`);
    }
  }

  // 4. Rebuild native modules for the target Electron version
  const electronVersion = getElectronVersion();
  if (!electronVersion) {
    console.warn('\n  Warning: electron not found in devDependencies — skipping native rebuild.');
    console.warn('  Serial port may not work in the packaged app.');
  } else {
    console.log(`\n  Rebuilding native modules for Electron ${electronVersion}...`);
    try {
      execSync(
        `npx @electron/rebuild --version ${electronVersion} --module-dir "${OUT_DIR}"`,
        { cwd: ROOT_DIR, stdio: 'inherit' }
      );
      console.log('  Native rebuild complete.');
    } catch (err) {
      console.warn(`  Warning: native rebuild failed: ${err.message}`);
      console.warn('  Serial port may not work in the packaged app.');
    }
  }

  console.log('');
  console.log('  Bundle complete!');
  console.log('');
}

bundle().catch((err) => {
  console.error('bundle-daemon failed:', err);
  process.exit(1);
});
