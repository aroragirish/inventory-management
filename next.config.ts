import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      /**
       * Stock files are uploaded through a server action. The framework default
       * is 1 MB, which a big Tally export can exceed; 4 MB also stays under the
       * 4.5 MB request ceiling that serverless hosts such as Vercel enforce, so
       * the friendly message in the action is what the operator actually sees.
       */
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
