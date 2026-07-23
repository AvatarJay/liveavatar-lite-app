import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  skipTrailingSlashRedirect: true,

  async headers() {
    return [
      {
        source: "/avatar",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://chasing-the-flames.myshopify.com https://www.chasingtheflames.com https://chasingtheflames.com;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;