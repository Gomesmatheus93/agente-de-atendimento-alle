import { pedidoDeDescadastro, variantesDoTelefone } from "@atendimento-academias/db";
import { mascararTelefone, normalizarTelefone, parseListaDestinatarios } from "@atendimento-academias/shared";
import { describe, expect, it } from "vitest";
import { extrairPedidoDeCadastro } from "../src/evo/integracao.js";
import { ipPrivado, motivoUrlRecusada } from "../src/rede/urlExterna.js";

// Regras pequenas que já deram (ou dariam) problema: telefone, "sair", marcação do EVO, URLs do n8n.

describe("telefone", () => {
  it("normaliza com e sem 55, com máscara", () => {
    expect(normalizarTelefone("(11) 91234-5678")).toBe("5511912345678");
    expect(normalizarTelefone("+55 11 91234-5678")).toBe("5511912345678");
    expect(normalizarTelefone("1133334444")).toBe("551133334444");
    expect(normalizarTelefone("123")).toBeNull();
  });

  it("considera o número com e sem o nono dígito (a Meta às vezes manda sem)", () => {
    expect(variantesDoTelefone("551191234567")).toEqual(expect.arrayContaining(["551191234567", "5511991234567"]));
  });

  it("mascara o telefone para o log", () => {
    expect(mascararTelefone("5511912345678")).toBe("5511****5678");
    expect(mascararTelefone("123")).toBe("****");
  });

  it("lê a lista de destinatários: nome; telefone, repetidos e inválidos", () => {
    const lista = parseListaDestinatarios("Maria; 11 91234-5678\nJoão; 11912345678\nsem telefone\n21 98888-7777");
    expect(lista.validos.map((l) => l.telefone)).toEqual(["5511912345678", "5521988887777"]);
    expect(lista.duplicados).toBe(1);
    expect(lista.invalidos).toHaveLength(1);
    expect(lista.validos[0]!.colunas).toEqual(["Maria"]);
  });
});

describe("pedido para sair das campanhas", () => {
  it.each(["sair", "SAIR", "Parar", "parar promoções", "Não quero mais receber"])("'%s' tira da lista", (texto) => {
    expect(pedidoDeDescadastro(texto)).toBe("sair");
  });
  it("'voltar' recoloca", () => expect(pedidoDeDescadastro("voltar")).toBe("voltar"));
  it.each(["quero sair mais cedo do treino", "posso parar o plano?", "oi"])("'%s' não é pedido", (texto) => {
    expect(pedidoDeDescadastro(texto)).toBeNull();
  });
});

describe("marcação de cadastro no EVO na resposta do bot", () => {
  it("tira a marcação do texto e lê os dados", () => {
    const r = extrairPedidoDeCadastro('Pronto, Ana!\n[CADASTRAR_EVO]{"nome":"Ana Souza","email":"ana@x.com"}');
    expect(r.texto).toBe("Pronto, Ana!");
    expect(r.dados).toMatchObject({ nome: "Ana Souza", email: "ana@x.com" });
  });
  it("marcação inválida não cadastra, mas some do texto", () => {
    const r = extrairPedidoDeCadastro("Ok [CADASTRAR_EVO]{nome: quebrado}");
    expect(r.dados).toBeNull();
    expect(r.texto).not.toContain("CADASTRAR_EVO");
  });
});

describe("URL do n8n (contra SSRF)", () => {
  it("reconhece endereços internos", () => {
    for (const ip of ["127.0.0.1", "10.2.3.4", "172.20.0.1", "192.168.0.10", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
      expect(ipPrivado(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "177.71.0.1", "2804:14c::1"]) expect(ipPrivado(ip), ip).toBe(false);
  });

  it("em produção exige https para endereço público", () => {
    const antes = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(motivoUrlRecusada("https://n8n.exemplo.com/webhook/x")).toBeNull();
      expect(motivoUrlRecusada("http://n8n.exemplo.com/x")).toMatch(/https/);
      expect(motivoUrlRecusada("https://localhost/x")).toMatch(/interno/);
      expect(motivoUrlRecusada("https://169.254.169.254/latest")).toMatch(/interno/);
      expect(motivoUrlRecusada("https://user:senha@n8n.exemplo.com/x")).toMatch(/usuário/);
    } finally {
      process.env.NODE_ENV = antes;
    }
  });
});
