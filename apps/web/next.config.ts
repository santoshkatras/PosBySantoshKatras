import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@stockkeep/ui', '@stockkeep/types'],
};

export default nextConfig;
