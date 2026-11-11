import { useState } from "react";
import type { WhatsappConnection } from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { QueryError } from "@/components/QueryError";
import { SectionCard } from "@/components/SectionCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAccess } from "@/lib/access";
import { META_APP_ID, META_ES_CONFIG_ID } from "@/lib/config";
import { ApiError } from "@/lib/restaurant";
import {
  useConnectWhatsapp,
  useDisconnectWhatsapp,
  useSetWhatsappAutoSend,
  useWhatsappIntegration,
} from "@/lib/whatsapp";
import { startWhatsappSignup } from "@/lib/whatsapp-sdk";
import { useDocumentTitle } from "@/lib/use-document-title";

const CONNECTION_MESSAGES = {
  unavailable: "WhatsApp no está disponible en este entorno.",
  connectFailed: "No pudimos conectar WhatsApp. Probá de nuevo.",
  disconnectFailed: "No pudimos desconectar WhatsApp. Probá de nuevo.",
  switchFailed: "No pudimos guardar el interruptor. Probá de nuevo.",
} as const;

/** "Integraciones": connect the local's own WhatsApp Business number through Meta. */
export function IntegrationsPage() {
  useDocumentTitle("Integraciones");
  const { can } = useAccess();
  const canEdit = can("integrations.edit");
  const integration = useWhatsappIntegration();
  const connectMutation = useConnectWhatsapp();
  const autoSendMutation = useSetWhatsappAutoSend();
  const disconnectMutation = useDisconnectWhatsapp();
  const [connecting, setConnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unavailableByBuild = !META_APP_ID || !META_ES_CONFIG_ID;
  const unavailableByApi = integration.error instanceof ApiError && integration.error.code === "WHATSAPP_UNAVAILABLE";
  const connection = integration.data?.connection ?? null;
  const stats = integration.data?.stats ?? { sent: 0, free: 0, failed: 0 };
  // A disconnected row is still stored (token cleared); `error` keeps the link and shows the reason.
  const showConnection = connection?.status === "connected" || connection?.status === "error";

  async function handleConnect() {
    if (unavailableByBuild) return;
    setConnecting(true);
    setError(null);
    try {
      const result = await startWhatsappSignup(META_APP_ID, META_ES_CONFIG_ID);
      await connectMutation.mutateAsync(result);
    } catch (err: unknown) {
      // The API's Spanish reason (number already in another local) or the signup's own ("Cancelaste…");
      // a network failure keeps the generic text.
      const reason = err instanceof ApiError || err?.constructor === Error ? (err as Error).message : "";
      setError(reason || CONNECTION_MESSAGES.connectFailed);
    } finally {
      setConnecting(false);
    }
  }

  async function handleAutoSend(autoSend: boolean) {
    setError(null);
    try {
      await autoSendMutation.mutateAsync(autoSend);
    } catch {
      setError(CONNECTION_MESSAGES.switchFailed);
    }
  }

  async function handleDisconnect() {
    setError(null);
    try {
      await disconnectMutation.mutateAsync();
      setConfirmDisconnect(false);
    } catch {
      setError(CONNECTION_MESSAGES.disconnectFailed);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-display text-[28px] font-extrabold sm:text-[32px]">Integraciones</h1>
        <span className="text-sm text-muted">Conectá las herramientas del local con Menucito.</span>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <SectionCard
        title="WhatsApp Business"
        description="Avisá a tus clientes cuando cambia el estado del pedido."
      >
        {unavailableByBuild || unavailableByApi ? (
          <Notice tone="warning">{CONNECTION_MESSAGES.unavailable}</Notice>
        ) : integration.isLoading ? (
          <div className="py-6 text-center text-muted">Cargando WhatsApp…</div>
        ) : integration.isError ? (
          <QueryError
            message="No pudimos cargar WhatsApp."
            onRetry={() => void integration.refetch()}
            retrying={integration.isRefetching}
          />
        ) : showConnection && connection ? (
          <ConnectedCard
            connection={connection}
            stats={stats}
            canEdit={canEdit}
            onAutoSend={(checked) => void handleAutoSend(checked)}
            onDisconnect={() => setConfirmDisconnect(true)}
            onReconnect={() => void handleConnect()}
            reconnecting={connecting}
            pending={autoSendMutation.isPending || disconnectMutation.isPending}
          />
        ) : (
          <NotConnectedCard canEdit={canEdit} connecting={connecting} onConnect={() => void handleConnect()} />
        )}
      </SectionCard>

      <section className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-4 sm:p-6">
        <h2 className="m-0 font-display text-xl font-extrabold">Próximamente</h2>
        {["PedidosYa", "Rappi"].map((name) => (
          <div key={name} className="flex items-center justify-between gap-3 rounded-xl bg-bg px-4 py-3 text-sm text-muted">
            <span className="font-bold">{name}</span>
            <span>Próximamente</span>
          </div>
        ))}
      </section>

      {confirmDisconnect && connection && (
        <ConfirmDialog
          title="Desconectar WhatsApp"
          confirmLabel="Desconectar"
          danger
          pending={disconnectMutation.isPending}
          onConfirm={() => void handleDisconnect()}
          onCancel={() => setConfirmDisconnect(false)}
        >
          Los avisos automáticos dejan de salir. El número y el historial de avisos quedan guardados.
        </ConfirmDialog>
      )}
    </div>
  );
}

function NotConnectedCard({
  canEdit,
  connecting,
  onConnect,
}: {
  canEdit: boolean;
  connecting: boolean;
  onConnect: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm text-muted">
        <li>Usá el número de WhatsApp Business del local, no uno compartido.</li>
        <li>Seguís usando WhatsApp Business en el celular: los mensajes también llegan ahí.</li>
        <li>
          Menucito solo manda avisos gratis, cuando el cliente te escribió en las últimas 24 horas. Meta igual
          pide cargar una tarjeta al conectar.
        </li>
      </ul>
      {canEdit ? (
        <Button
          type="button"
          disabled={connecting}
          onClick={onConnect}
          className="min-h-11 self-start px-5 text-sm font-bold"
        >
          {connecting ? "Conectando…" : "Conectar con WhatsApp"}
        </Button>
      ) : (
        <p className="m-0 text-sm text-muted">Pedile al dueño o a un usuario con permiso que conecte el número.</p>
      )}
    </div>
  );
}

function ConnectedCard({
  connection,
  stats,
  canEdit,
  onAutoSend,
  onDisconnect,
  onReconnect,
  reconnecting,
  pending,
}: {
  connection: WhatsappConnection;
  stats: { sent: number; free: number; failed: number };
  canEdit: boolean;
  onAutoSend: (checked: boolean) => void;
  onDisconnect: () => void;
  onReconnect: () => void;
  reconnecting: boolean;
  pending: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-bg px-4 py-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-bold text-ink">{connection.displayName || "WhatsApp Business"}</span>
          <span className="text-sm text-muted">+{connection.displayPhone}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={connection.status === "connected" ? "success" : "warning"}>
            {connection.status === "connected" ? "Conectado" : connection.status === "error" ? "Error" : "Desconectado"}
          </Badge>
          <Badge tone="subtle">
            Cuenta de Meta · {connection.businessVerified ? "verificada" : "pendiente"}
          </Badge>
        </div>
      </div>

      {connection.status === "error" && (
        <Notice tone="warning">
          {connection.statusDetail || "Meta informó un problema con la cuenta. Volvé a conectar el número."}
        </Notice>
      )}

      <div className="flex items-center justify-between gap-4 rounded-xl border border-line px-4 py-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-bold text-ink">Enviar avisos automáticos al cambiar el estado</span>
          <span className="text-xs text-muted">
            {connection.autoSend ? "Encendido" : "Apagado"}
          </span>
        </div>
        <Switch
          checked={connection.autoSend}
          disabled={!canEdit || pending}
          onCheckedChange={onAutoSend}
          aria-label="Enviar avisos automáticos al cambiar el estado"
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold text-muted">Avisos de los últimos 30 días</span>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Enviados", value: stats.sent },
            { label: "Gratis", value: stats.free },
            { label: "Fallidos", value: stats.failed },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-line bg-white px-3 py-2 text-center">
              <span className="block text-xl font-extrabold text-ink">{stat.value}</span>
              <span className="text-xs text-muted">{stat.label}</span>
            </div>
          ))}
        </div>
      </div>

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {connection.status === "error" && (
            <Button
              type="button"
              disabled={reconnecting || pending}
              onClick={onReconnect}
              className="min-h-11 px-4 text-sm font-bold"
            >
              {reconnecting ? "Conectando…" : "Volver a conectar"}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={onDisconnect}
            className="min-h-11 px-4 text-sm font-bold text-danger"
          >
            Desconectar
          </Button>
        </div>
      )}
    </div>
  );
}
