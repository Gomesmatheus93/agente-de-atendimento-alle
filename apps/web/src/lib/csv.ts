// Planilha CSV para abrir no Excel em português: separador ";", BOM UTF-8 (acentos certos) e aspas em
// toda célula. Texto que começa com = + - @ ganha um apóstrofo na frente: sem isso, uma mensagem de
// cliente como "=HYPERLINK(...)" viraria fórmula ao abrir a planilha.
function celula(valor: string): string {
  const seguro = /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
  return `"${seguro.replace(/"/g, '""')}"`;
}

export function baixarCsv(nomeArquivo: string, linhas: string[][]): void {
  const texto = "﻿" + linhas.map((linha) => linha.map(celula).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeArquivo.endsWith(".csv") ? nomeArquivo : `${nomeArquivo}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function nomeDeArquivo(base: string): string {
  const hoje = new Date().toLocaleDateString("pt-BR").replace(/\//g, "-");
  return `${base.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w-]+/g, "-").replace(/-+/g, "-").toLowerCase()}-${hoje}`;
}
