import type { ReactNode } from "react";
import { Card } from "../Card.js";
import { Button } from "./Button.js";
import { Icone } from "./Icone.js";

interface EstadoVazioProps {
  titulo: string;
  descricao: string;
  acao?: ReactNode;
}

export function EstadoVazio({ titulo, descricao, acao }: EstadoVazioProps) {
  return (
    <Card className="flex flex-col items-center gap-2 py-14 text-center">
      <span className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent-text">
        <Icone nome="inbox" tamanho={22} />
      </span>
      <h3 className="font-heading text-base font-semibold">{titulo}</h3>
      <p className="max-w-md text-sm text-ink-2">{descricao}</p>
      {acao && <div className="mt-3">{acao}</div>}
    </Card>
  );
}

interface EstadoErroProps {
  mensagem: string;
  onTentarNovamente: () => void;
}

export function EstadoErro({ mensagem, onTentarNovamente }: EstadoErroProps) {
  return (
    <Card role="alert" className="flex flex-col items-center gap-2 border-red-200 py-12 text-center">
      <span className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-status-falhou">
        <Icone nome="alerta" tamanho={22} />
      </span>
      <h3 className="font-heading text-base font-semibold">Não foi possível carregar</h3>
      <p className="max-w-md text-sm text-ink-2">{mensagem}</p>
      <Button variante="secundario" className="mt-3" onClick={onTentarNovamente}>
        Tentar novamente
      </Button>
    </Card>
  );
}

export function Esqueleto({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-xl bg-slate-200/60 ${className}`} />;
}
