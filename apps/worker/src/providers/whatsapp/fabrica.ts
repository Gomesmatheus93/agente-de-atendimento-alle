import { contasWhatsapp, decifrar, numerosWhatsapp, type Db } from "@atendimento-academias/db";
import { eq } from "drizzle-orm";
import type { WhatsAppProvider } from "./WhatsAppProvider.js";
import { WhatsAppProviderAllowlist } from "./WhatsAppProviderAllowlist.js";
import { WhatsAppProviderCloudApi } from "./WhatsAppProviderCloudApi.js";
import { WhatsAppProviderStub } from "./WhatsAppProviderStub.js";

const API_VERSION_PADRAO = "v25.0";
const IDIOMA_TEMPLATE_PADRAO = "pt_BR";
// As credenciais vêm do banco; relê de vez em quando para trocar de token sem reiniciar o worker.
const VALIDADE_CACHE_MS = 60_000;

export class NumeroNaoConfigurado extends Error {}

interface Guardado {
  provider: WhatsAppProvider;
  em: number;
}

// Cada número da plataforma tem o próprio provider, com o token da conta a que ele pertence.
export class FabricaDeProviders {
  private readonly cache = new Map<number, Guardado>();

  constructor(private readonly db: Db) {}

  async para(numeroId: number): Promise<WhatsAppProvider> {
    // Desenvolvimento sem credenciais: simula o envio em vez de falar com a Meta.
    if (process.env.WHATSAPP_SIMULAR === "1") return comTravaDeTeste(new WhatsAppProviderStub());

    const guardado = this.cache.get(numeroId);
    if (guardado && Date.now() - guardado.em < VALIDADE_CACHE_MS) return guardado.provider;

    const [linha] = await this.db
      .select({
        phoneNumberId: numerosWhatsapp.phoneNumberId,
        ativo: numerosWhatsapp.ativo,
        exibicao: numerosWhatsapp.numeroExibicao,
        tokenCifrado: contasWhatsapp.tokenCifrado,
      })
      .from(numerosWhatsapp)
      .innerJoin(contasWhatsapp, eq(contasWhatsapp.id, numerosWhatsapp.contaId))
      .where(eq(numerosWhatsapp.id, numeroId));

    if (!linha) throw new NumeroNaoConfigurado(`Número ${numeroId} não existe na plataforma.`);
    if (!linha.ativo) throw new NumeroNaoConfigurado(`O número ${linha.exibicao} está desativado no painel.`);

    const provider = comTravaDeTeste(
      new WhatsAppProviderCloudApi({
        phoneNumberId: linha.phoneNumberId,
        accessToken: decifrar(linha.tokenCifrado),
        apiVersion: process.env.WHATSAPP_API_VERSION ?? API_VERSION_PADRAO,
        idiomaTemplate: process.env.WHATSAPP_TEMPLATE_LANG ?? IDIOMA_TEMPLATE_PADRAO,
      }),
    );

    this.cache.set(numeroId, { provider, em: Date.now() });
    return provider;
  }
}

// Lista vazia = sem trava (produção). Preenchida = só esses telefones recebem.
function comTravaDeTeste(provider: WhatsAppProvider): WhatsAppProvider {
  const permitidos = WhatsAppProviderAllowlist.parseLista(process.env.WHATSAPP_NUMEROS_PERMITIDOS);
  return permitidos.length === 0 ? provider : new WhatsAppProviderAllowlist(provider, permitidos);
}
