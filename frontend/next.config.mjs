/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export", // ✅ enables static HTML export (replaces `next export`)

  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true, // required for static export if using next/image
  },
};

export default nextConfig;
