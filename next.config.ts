import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/avatar",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://lawnmowergrass.com;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;