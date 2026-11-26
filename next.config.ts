import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  transpilePackages: ['motion'],
  // Pantallas antiguas que guardaban por su cuenta: llevan a la pantalla vigente (temporal, por si alguien las tenía guardadas).
  async redirects() {
    return [
      { source: '/parametros', destination: '/captaciones', permanent: false },
      { source: '/nomina', destination: '/proyeccion-egresos', permanent: false },
      { source: '/presupuesto-departamental', destination: '/proyeccion-egresos', permanent: false },
    ];
  },
  // Marca de cada compilación: separa los resultados guardados de una versión del programa y la siguiente
  env: { VERSION_BUILD: process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now()) },
};

export default nextConfig;
