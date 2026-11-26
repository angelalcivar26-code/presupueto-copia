import type {Metadata} from 'next';
import './globals.css'; // Global styles
import Sidebar from '../components/Sidebar';
import VigilanteDatos from '../components/VigilanteDatos';
import AvisoLecturaParcial from '../components/AvisoLecturaParcial';
import { NOMBRE_INSTITUCION, NOMBRE_SISTEMA } from '../lib/marca';

export const metadata: Metadata = {
  title: `${NOMBRE_SISTEMA} · ${NOMBRE_INSTITUCION}`,
  description: `Herramienta interna de ${NOMBRE_SISTEMA.toLowerCase()} de ${NOMBRE_INSTITUCION}`,
  robots: { index: false, follow: false },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="es">
      <body suppressHydrationWarning>
        <VigilanteDatos />
        <AvisoLecturaParcial />
        <div className="flex min-h-screen" style={{ background: "#EEF1EF" }}>
          <Sidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <main className="flex-1">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
