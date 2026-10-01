import { LIMITE_IMAGEM_TEMPLATE_BYTES, TIPOS_IMAGEM_TEMPLATE } from "@atendimento-academias/shared";

export interface ImagemLida {
  base64: string;
  mimeType: (typeof TIPOS_IMAGEM_TEMPLATE)[number];
  // data: URL para mostrar a prévia na tela.
  previa: string;
}

// Imagem de cabeçalho de template: a Meta aceita só JPG e PNG, até 5 MB. Erro vira mensagem para o toast.
export function lerImagemDeTemplate(arquivo: File): Promise<ImagemLida> {
  if (!(TIPOS_IMAGEM_TEMPLATE as readonly string[]).includes(arquivo.type)) {
    return Promise.reject(new Error("Use uma imagem JPG ou PNG."));
  }
  if (arquivo.size > LIMITE_IMAGEM_TEMPLATE_BYTES) {
    return Promise.reject(new Error("A imagem pode ter no máximo 5 MB."));
  }

  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => {
      const previa = String(leitor.result);
      resolve({ base64: previa.slice(previa.indexOf(",") + 1), mimeType: arquivo.type as ImagemLida["mimeType"], previa });
    };
    leitor.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    leitor.readAsDataURL(arquivo);
  });
}
