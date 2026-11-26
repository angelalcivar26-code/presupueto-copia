

export interface ResultadoMensual {
  mes: number; // 1-12
  saldoInicial: number;
  saldoFinal: number;
  detalle: Record<string, number>; // lineas intermedias (depositos, retiros, etc.), para poder auditar
}
