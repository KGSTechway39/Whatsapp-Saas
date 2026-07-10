// Ambient declarations so a standalone `tsc --noEmit` accepts CSS side-effect
// imports (e.g. `import "./globals.css"`). At build time Next.js/Turbopack
// handles these through the bundler; TypeScript only needs to know the modules
// exist so the type-check step in scripts/production-check.sh stays green.
declare module "*.css";
declare module "*.scss";
