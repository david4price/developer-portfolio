import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// Next.js reads env files only from this app's directory. Load the workspace-level `.env` too, so
// one file configures every app locally. It is absent in CI and image builds, where
// NEXT_PUBLIC_API_BASE_URL comes from the real environment.
const workspaceEnv = resolve(process.cwd(), '../../.env');
if (existsSync(workspaceEnv)) process.loadEnvFile(workspaceEnv);

const nextConfig: NextConfig = {
  // Static export: the site is plain files on a CDN and needs no Node.js server at runtime.
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
