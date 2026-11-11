/**
 * Meta's Facebook SDK, loaded only on the Integrations page. Embedded Signup answers with an OAuth
 * `code` and, through a `WA_EMBEDDED_SIGNUP` message, the WABA and phone number ids.
 */

interface FacebookAuthResponse {
  code?: string;
}

interface FacebookLoginResponse {
  status?: string;
  authResponse?: FacebookAuthResponse | null;
}

interface FacebookSdk {
  init(options: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(
    callback: (response: FacebookLoginResponse) => void,
    options: {
      config_id: string;
      response_type: string;
      override_default_response_type: boolean;
      extras: { featureType: string; sessionInfoVersion: string };
    },
  ): void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

const SDK_URL = "https://connect.facebook.net/en_US/sdk.js";

/** The version is only for the SDK loader; the API pins the Graph version it calls. */
const SDK_VERSION = "v23.0";

let sdkPromise: Promise<FacebookSdk> | null = null;

function loadSdk(appId: string): Promise<FacebookSdk> {
  if (window.FB) {
    window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: SDK_VERSION });
    return Promise.resolve(window.FB);
  }
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<FacebookSdk>((resolve, reject) => {
    window.fbAsyncInit = () => {
      if (!window.FB) {
        reject(new Error("El SDK de Facebook no cargó"));
        return;
      }
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: SDK_VERSION });
      resolve(window.FB);
    };
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => reject(new Error("No pudimos cargar el SDK de Facebook"));
    document.body.appendChild(script);
  });
  return sdkPromise;
}

export interface WhatsappSignupResult {
  code: string;
  wabaId: string;
  /** Missing when the coexistence flow only reports the WABA; the API looks it up. */
  phoneNumberId?: string;
}

interface EmbeddedSignupMessage {
  type?: string;
  event?: string;
  data?: { waba_id?: string; phone_number_id?: string };
}

/** Runs Embedded Signup with coexistence and resolves with the three ids the API needs. */
export async function startWhatsappSignup(appId: string, configId: string): Promise<WhatsappSignupResult> {
  const sdk = await loadSdk(appId);

  return new Promise<WhatsappSignupResult>((resolve, reject) => {
    let code: string | null = null;
    let session: { wabaId: string; phoneNumberId?: string } | null = null;

    function finish() {
      if (!code || !session) return;
      window.removeEventListener("message", onMessage);
      resolve({ code, ...session });
    }

    function onMessage(event: MessageEvent) {
      const hostname = (() => {
        try {
          return new URL(event.origin).hostname;
        } catch {
          return "";
        }
      })();
      if (!/\.facebook\.com$/.test(hostname)) return;
      const message = event.data as EmbeddedSignupMessage | null;
      if (message?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (message.event === "CANCEL" || message.event === "ERROR") {
        window.removeEventListener("message", onMessage);
        reject(new Error("Cancelaste la conexión con WhatsApp"));
        return;
      }
      // "FINISH" for a new number; coexistence ends with "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      // which may carry only the WABA.
      if (message.event?.startsWith("FINISH") && message.data?.waba_id) {
        session = { wabaId: message.data.waba_id, phoneNumberId: message.data.phone_number_id || undefined };
        finish();
      }
    }

    window.addEventListener("message", onMessage);

    sdk.login(
      (response) => {
        code = response.authResponse?.code ?? null;
        if (!code) {
          window.removeEventListener("message", onMessage);
          reject(new Error("Meta no devolvió el código de conexión"));
          return;
        }
        finish();
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
      },
    );
  });
}
