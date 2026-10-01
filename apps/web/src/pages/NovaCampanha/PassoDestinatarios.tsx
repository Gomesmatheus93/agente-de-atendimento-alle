import {
  calcularCusto,
  MAX_TELEFONES_POR_CAMPANHA,
  normalizarTelefone,
  type ListaDestinatarios,
} from "@atendimento-academias/shared";
import { useRef, type ChangeEvent } from "react";
import { Button } from "../../components/ui/Button.js";
import { toast } from "../../components/ui/Toast.js";
import { formatarMoeda, formatarNumero, formatarTelefone } from "../../lib/format.js";

const MAX_INVALIDOS_VISIVEIS = 5;
const MAX_LINHAS_NA_PREVIA = 4;

interface PassoDestinatariosProps {
  texto: string;
  lista: ListaDestinatarios;
  precoUnitario: number;
  onTexto: (texto: string) => void;
}

export function PassoDestinatarios({ texto, lista, precoUnitario, onTexto }: PassoDestinatariosProps) {
  const inputArquivo = useRef<HTMLInputElement>(null);
  const excedeLimite = lista.validos.length > MAX_TELEFONES_POR_CAMPANHA;

  async function aoEscolherArquivo(evento: ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    evento.target.value = "";
    if (!arquivo) return;

    try {
      // A linha inteira é mantida: as colunas além do telefone é que personalizam a mensagem.
      const linhas = (await arquivo.text())
        .split(/\r?\n/)
        .map((linha) => linha.trim())
        .filter((linha) => linha !== "");

      if (linhas.length === 0) {
        toast.erro(`O arquivo ${arquivo.name} está vazio.`);
        return;
      }
      onTexto([texto.trimEnd(), ...linhas].filter((parte) => parte !== "").join("\n"));
      toast.sucesso(`${formatarNumero(linhas.length)} linha(s) importada(s) de ${arquivo.name}.`);
    } catch {
      toast.erro(`Não foi possível ler o arquivo ${arquivo.name}.`);
    }
  }

  function removerInvalidos() {
    onTexto(
      texto
        .split(/\r?\n/)
        .filter((linha) => linha.trim() === "" || linha.split(/[;,\t|]/).some((celula) => normalizarTelefone(celula.trim())))
        .join("\n"),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label htmlFor="telefones" className="text-sm font-medium">
          Destinatários (um por linha)
          <span className="mt-1 block text-xs font-normal text-ink-2">
            Só o telefone, ou com o nome junto: <span className="font-mono">Nome; telefone</span>. Aceita máscara, com ou sem
            55, e separador <span className="font-mono">;</span> <span className="font-mono">,</span> ou tabulação. Números
            repetidos são unificados.
          </span>
        </label>
        <div>
          <input ref={inputArquivo} type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" tabIndex={-1} onChange={aoEscolherArquivo} />
          <Button variante="secundario" onClick={() => inputArquivo.current?.click()}>
            Importar arquivo (.csv ou .txt)
          </Button>
        </div>
      </div>

      <textarea
        id="telefones"
        rows={10}
        className="rounded-lg px-3 py-2 font-mono text-sm"
        placeholder={"Maria Silva; 11 91234-5678\nJoão Souza; (21) 98888-7777\n+55 31 97777-6666"}
        value={texto}
        aria-describedby="resumo-telefones"
        onChange={(evento) => onTexto(evento.target.value)}
      />

      <ul id="resumo-telefones" className="flex flex-wrap gap-2 text-xs">
        <li className="rounded-full bg-accent/10 px-2.5 py-1 font-medium text-accent-text">
          ✓ {formatarNumero(lista.validos.length)} válido(s)
        </li>
        <li
          className={`rounded-full px-2.5 py-1 font-medium ${lista.invalidos.length > 0 ? "bg-red-50 text-red-700" : "bg-slate-200/60 text-ink-2"}`}
        >
          {lista.invalidos.length > 0 ? "✕ " : ""}
          {formatarNumero(lista.invalidos.length)} inválido(s)
        </li>
        {lista.duplicados > 0 && (
          <li className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-800">
            {formatarNumero(lista.duplicados)} repetido(s) unificado(s)
          </li>
        )}
        <li className="rounded-full bg-slate-200/60 px-2.5 py-1 text-ink-2">
          {lista.colunas === 0
            ? "Nenhuma coluna além do telefone"
            : `${formatarNumero(lista.colunas)} coluna(s) para personalizar`}
        </li>
        <li className={`rounded-full px-2.5 py-1 ${excedeLimite ? "bg-red-50 font-medium text-red-700" : "bg-slate-200/60 text-ink-2"}`}>
          Limite: {formatarNumero(MAX_TELEFONES_POR_CAMPANHA)} por campanha
        </li>
        <li className="rounded-full bg-slate-200/60 px-2.5 py-1 font-medium text-ink">
          Custo estimado: {formatarMoeda(calcularCusto(lista.validos.length, precoUnitario))}
        </li>
      </ul>

      {lista.colunas > 0 && lista.validos.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-card-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-app-bg text-ink-2">
              <tr>
                <th className="px-3 py-2 font-medium">Telefone</th>
                {Array.from({ length: lista.colunas }, (_, indice) => (
                  <th key={indice} className="px-3 py-2 font-medium">
                    Coluna {indice + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lista.validos.slice(0, MAX_LINHAS_NA_PREVIA).map((linha) => (
                <tr key={linha.telefone} className="border-t border-card-border">
                  <td className="px-3 py-2 font-mono">{formatarTelefone(linha.telefone)}</td>
                  {Array.from({ length: lista.colunas }, (_, indice) => (
                    <td key={indice} className={linha.colunas[indice]?.trim() ? "px-3 py-2" : "px-3 py-2 text-ink-3"}>
                      {linha.colunas[indice]?.trim() || "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {lista.validos.length > MAX_LINHAS_NA_PREVIA && (
            <p className="border-t border-card-border px-3 py-2 text-xs text-ink-2">
              e mais {formatarNumero(lista.validos.length - MAX_LINHAS_NA_PREVIA)}
            </p>
          )}
        </div>
      )}

      {lista.invalidos.length > 0 && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50/70 p-4 text-sm">
          <p className="font-medium text-red-800">Corrija ou remova as linhas sem telefone válido:</p>
          <ul className="mt-1 list-inside list-disc text-xs text-red-800">
            {lista.invalidos.slice(0, MAX_INVALIDOS_VISIVEIS).map((item) => (
              <li key={item.linha}>
                linha {item.linha}: <span className="font-mono">{item.valor}</span>
              </li>
            ))}
            {lista.invalidos.length > MAX_INVALIDOS_VISIVEIS && (
              <li>e mais {lista.invalidos.length - MAX_INVALIDOS_VISIVEIS}</li>
            )}
          </ul>
          <Button variante="secundario" className="mt-3 px-3 py-1 text-xs" onClick={removerInvalidos}>
            Remover inválidos
          </Button>
        </div>
      )}
    </div>
  );
}
